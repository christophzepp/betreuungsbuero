#!/usr/bin/env node
/* Vorlagen-Update-Workflow (PDF-Umbauplan Phase 5.6, 13.08.2026): tauscht die eingebettete
   Behoerdenvorlage eines Dokuments gegen eine NEUE Fassung - wiederholbar statt Einmalaktion.

   Ablauf je Dokumenttyp:
   - OVERLAY-Dokument (karten/<reportId>.json existiert): neue flache PDF wird uebernommen und
     die Rechteck-Karte automatisch NEU GEPRAEGT (overlay-praegen --anwenden); danach Probe
     erzeugen - die Slots koennen in der neuen Fassung gewandert sein: SICHTPRUEFUNG PFLICHT.
   - ACROFORM-Dokument (keine Karte): Feld-Diff neue PDF vs. V159.pdfFields-Mappings; nur wenn
     KEIN gemapptes Feld fehlt (oder --trotzdem), wird die Base64-Zeile ersetzt.

   Jede Uebernahme wird mit sha256 alt/neu in vorlagen/versionen.log protokolliert.

   Aufruf:
     node vorlage-tauschen.js <reportId> <neue.pdf> [--anwenden] [--stand "04/2027"] [--trotzdem] */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { PDFDocument } = require('pdf-lib');

const HTML = path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html');
const [reportId, neuePfad] = [process.argv[2], process.argv[3]];
const ANWENDEN = process.argv.includes('--anwenden');
const TROTZDEM = process.argv.includes('--trotzdem');
const standIdx = process.argv.indexOf('--stand');
const STAND = standIdx > -1 ? process.argv[standIdx + 1] : '';
if (!reportId || !neuePfad || !fs.existsSync(neuePfad)) { console.error('Aufruf: node vorlage-tauschen.js <reportId> <neue.pdf> [--anwenden] [--stand "…"]'); process.exit(1); }

const sha = b => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  const lines = fs.readFileSync(HTML, 'utf8').split('\n');
  const v159Idx = lines.findIndex(l => l.startsWith('const V159={'));
  const v159 = JSON.parse(lines[v159Idx].slice('const V159='.length, -1));
  const cfg = v159.pdfTemplates[reportId];
  if (!cfg || !cfg.elementId) { console.error('Kein pdfTemplates-Eintrag mit elementId für', reportId); process.exit(1); }
  const tplIdx = lines.findIndex(l => l.includes('id="' + cfg.elementId + '"') && l.includes('base64"'));
  const tagMatch = /^(\s*<script\b[^>]*)>([^<]*)(<\/script>\s*)$/.exec(lines[tplIdx] || '');
  if (!tagMatch) { console.error('Vorlagenzeile nicht gefunden:', cfg.elementId); process.exit(1); }

  const altBytes = Buffer.from(tagMatch[2].trim(), 'base64');
  const neuBytes = fs.readFileSync(neuePfad);
  const kartenPfad = path.join(__dirname, 'karten', reportId + '.json');
  const istOverlay = fs.existsSync(kartenPfad);
  console.log('Dokument:', reportId, '| Vorlage:', cfg.elementId, '| Typ:', istOverlay ? 'Overlay (Karte vorhanden)' : 'AcroForm');
  console.log('alt: sha256=' + sha(altBytes).slice(0, 16) + '… (' + Math.round(altBytes.length / 1024) + ' KB)');
  console.log('neu: sha256=' + sha(neuBytes).slice(0, 16) + '… (' + Math.round(neuBytes.length / 1024) + ' KB)');

  if (istOverlay) {
    /* Neue flache Fassung uebernehmen und Karte neu praegen. */
    fs.writeFileSync(path.join(__dirname, 'vorlagen', cfg.elementId + '.pdf'), neuBytes);
    if (!ANWENDEN) { console.log('(Dry-Run: neue Fassung liegt in vorlagen/; mit --anwenden wird gepraegt + uebernommen. Danach Probe sichten!)'); return; }
    execFileSync('node', [path.join(__dirname, 'overlay-praegen.js'), reportId, '--anwenden'], { stdio: 'inherit' });
    try {
      execFileSync('node', [path.join(__dirname, 'probe-fuellen.js'), reportId], { stdio: 'inherit' });
      execFileSync('node', [path.join(__dirname, 'seiten-rendern.js'), path.join(__dirname, 'vorlagen', cfg.elementId + '.probe.pdf')], { stdio: 'inherit' });
      console.log('SICHTPRUEFUNG PFLICHT: vorlagen/render/' + cfg.elementId + '.probe_s<N>.png - Slots der neuen Fassung koennen gewandert sein!');
    } catch (_e) { console.log('Probe/Render fehlgeschlagen - manuell pruefen.'); }
  } else {
    /* AcroForm: Feld-Diff gegen die Mappings. */
    const neuPdf = await PDFDocument.load(neuBytes, { ignoreEncryption: true });
    const neueFelder = new Set(neuPdf.getForm().getFields().map(f => f.getName()));
    const mappings = v159.pdfFields[reportId] || [];
    const fehlend = mappings.filter(m => m.pdfType !== '/Tbl' && !neueFelder.has(m.name)).map(m => m.name);
    console.log('Mappings:', mappings.length, '| Felder in neuer Fassung:', neueFelder.size, '| davon fehlend:', fehlend.length);
    if (fehlend.length) console.log('FEHLEND:', JSON.stringify(fehlend.slice(0, 15)));
    if (fehlend.length && !TROTZDEM) { console.log(ANWENDEN ? 'ABBRUCH: gemappte Felder fehlen in der neuen Fassung (--trotzdem erzwingt).' : '(Dry-Run)'); process.exit(fehlend.length && ANWENDEN ? 1 : 0); }
    if (!ANWENDEN) { console.log('(Dry-Run - mit --anwenden uebernehmen)'); return; }
    lines[tplIdx] = tagMatch[1] + '>' + neuBytes.toString('base64') + tagMatch[3];
    if (STAND) { cfg.version = STAND; const kat = (v159.catalog || []).find(e => e.id === reportId); if (kat) kat.templateDate = STAND; }
    cfg.mappingVersion = (cfg.mappingVersion || 0) + 1;
    lines[v159Idx] = 'const V159=' + JSON.stringify(v159) + ';';
    if (lines[v159Idx].includes('<scr' + 'ipt') || lines[v159Idx].includes('</scr' + 'ipt')) { console.error('Abbruch: Script-Tag-Sequenz.'); process.exit(1); }
    fs.writeFileSync(HTML, lines.join('\n'));
    console.log('ANGEWENDET.');
  }

  fs.appendFileSync(path.join(__dirname, 'vorlagen', 'versionen.log'),
    new Date().toISOString() + ' ' + reportId + ' ' + cfg.elementId + ' alt=' + sha(altBytes) + ' neu=' + sha(neuBytes) + (STAND ? ' stand=' + STAND : '') + (ANWENDEN ? ' ANGEWENDET' : ' dry-run') + '\n');
  console.log('Protokolliert in vorlagen/versionen.log');
})().catch(e => { console.error(e); process.exit(1); });
