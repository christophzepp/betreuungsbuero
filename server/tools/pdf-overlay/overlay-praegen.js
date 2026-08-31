#!/usr/bin/env node
/* Schritt 3 der Overlay-Werkzeugkette (PDF-Umbauplan Phase 3, 13.08.2026):
   praegt einer flachen Originalvorlage echte AcroForm-Felder auf, anhand der
   Rechteck-Karte aus karten/<reportId>.json.

   Feldnamen = die BESTEHENDEN flatSchema-Feld-IDs (Design-Klarstellung des Plans):
   dadurch liest die auto-acro-Regelpipeline (v159CreateAcroPdf -> v159FieldValue ->
   reportFieldValue(reportId, field.id)) die Werte direkt aus den kuratierten
   Editor-Feldern; es entstehen KEINE neuen pdf_xxxx-Editor-Felder.

   Modi:
     node overlay-praegen.js rent_certificate            -> schreibt vorlagen/<elementId>.acroform.pdf (Abnahme-Artefakt)
     node overlay-praegen.js rent_certificate --anwenden -> schreibt zusaetzlich Base64 + Metadaten in die App-HTML
                                                            (pdfTemplates.mode='auto-acro', ready, pdfFields-Eintraege)

   Unterstuetzt: text (auch multiline), comb (maxLength+Kaestchenraster), checkbox,
   radio (Optionsgruppe {option:{x,y}}); Tab-Reihenfolge = Reihenfolge in der Karte. */
'use strict';
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const HTML = '/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html';
const reportId = process.argv[2];
const ANWENDEN = process.argv.includes('--anwenden');
if (!reportId) { console.error('Aufruf: node overlay-praegen.js <reportId> [--anwenden]'); process.exit(1); }

const karte = JSON.parse(fs.readFileSync(path.join(__dirname, 'karten', reportId + '.json'), 'utf8'));
const quelle = path.join(__dirname, 'vorlagen', karte.elementId + '.pdf');
if (!fs.existsSync(quelle)) { console.error('Vorlage fehlt - zuerst: node vorlage-export.js ' + karte.elementId); process.exit(1); }

/* Bildpixel (linke obere Ecke) -> PDF-Punkte (Ursprung unten links). */
function rectPt(f, seiteHoehePt) {
  const s = (karte.seitenBreitePt || 595.28) / (karte.bildBreite || 1240);
  return {
    x: f.x * s,
    y: seiteHoehePt - (f.y + f.height) * s,
    width: f.width * s,
    height: f.height * s
  };
}

(async () => {
  const pdf = await PDFDocument.load(fs.readFileSync(quelle), { ignoreEncryption: true });
  const form = pdf.getForm();
  /* Idempotenz: Overlay-Karten existieren nur fuer (urspruenglich) feldlose Vorlagen -
     jedes vorhandene Feld stammt aus einer frueheren Praegung und wird entfernt, damit
     Re-Praegen (Golden-Tests, vorlage-tauschen) deterministisch bleibt. */
  for (const feld of form.getFields()) { try { form.removeField(feld); } catch (_e) {} }
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const eintraege = [];

  for (const [feldId, f] of Object.entries(karte.felder)) {
    const seite = pdf.getPage(f.page);
    const r = rectPt(f, seite.getHeight());
    const basis = { x: r.x, y: r.y, width: r.width, height: r.height, borderWidth: 0, backgroundColor: undefined };
    if (f.typ === 'checkbox') {
      const cb = form.createCheckBox(feldId);
      cb.addToPage(seite, basis);
      eintraege.push({ feldId, pdfType: '/Btn', hasPdfOptions: false, page: f.page + 1 });
    } else if (f.typ === 'radio' && f.optionen) {
      const gruppe = form.createRadioGroup(feldId);
      for (const [wert, pos] of Object.entries(f.optionen)) {
        const pr = rectPt({ ...pos, width: pos.width || f.width || 24, height: pos.height || f.height || 24, }, seite.getHeight());
        gruppe.addOptionToPage(wert, seite, { x: pr.x, y: pr.y, width: pr.width, height: pr.height, borderWidth: 0 });
      }
      eintraege.push({ feldId, pdfType: '/Btn', hasPdfOptions: true, optionen: Object.keys(f.optionen), page: f.page + 1 });
    } else if (f.typ === 'tabelle') {
      f.zeilenY.forEach((yTop, r) => {
        for (const [spalte, sp] of Object.entries(f.spalten)) {
          const rr = rectPt({ x: sp.x, y: yTop, width: sp.width, height: f.zeilenHoehe || 30 }, seite.getHeight());
          const tf = form.createTextField(feldId + '__r' + r + '__' + spalte);
          tf.addToPage(seite, { x: rr.x, y: rr.y, width: rr.width, height: rr.height, borderWidth: 0 });
          tf.setFontSize(sp.groesse || 8);
        }
      });
      eintraege.push({ feldId, pdfType: '/Tbl', hasPdfOptions: false, page: f.page + 1, tabelle: { maxRows: f.zeilenY.length, spalten: Object.keys(f.spalten) } });
    } else {
      const tf = form.createTextField(feldId);
      tf.addToPage(seite, basis);
      tf.setFontSize(f.groesse || 9);
      if (f.multiline) tf.enableMultiline();
      if (f.comb && f.maxLength) { tf.setMaxLength(f.maxLength); tf.enableCombing(); }
      eintraege.push({ feldId, pdfType: '/Tx', hasPdfOptions: false, page: f.page + 1 });
    }
  }
  form.updateFieldAppearances(helv);

  const bytes = await pdf.save({ useObjectStreams: false });
  const ziel = path.join(__dirname, 'vorlagen', karte.elementId + '.acroform.pdf');
  fs.writeFileSync(ziel, bytes);

  /* Kontrolle: neu laden und Felder zaehlen. */
  const probe = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const feldZahl = probe.getForm().getFields().length;
  console.log('Gepraegt:', ziel, '(' + Math.round(bytes.length / 1024) + ' KB, ' + feldZahl + ' Felder, ' + probe.getPageCount() + ' Seiten)');
  const erwartet = Object.values(karte.felder).reduce((summe, f) =>
    summe + (f.typ === 'tabelle' ? (f.zeilenY || []).length * Object.keys(f.spalten || {}).length : 1), 0);
  if (feldZahl !== erwartet) { console.error('Feldzahl weicht von der Karte ab! (' + feldZahl + ' vs erwartet ' + erwartet + ')'); process.exit(1); }

  if (!ANWENDEN) { console.log('(Abnahme-Artefakt - mit --anwenden in die App-HTML uebernehmen)'); return; }

  /* --- Uebernahme in die App-HTML: Base64-Zeile + V159-Metadaten (Muster v159-patch.js) --- */
  const html = fs.readFileSync(HTML, 'utf8');
  const lines = html.split('\n');
  const tplIdx = lines.findIndex(l => l.includes('id="' + karte.elementId + '"') && l.includes('base64"'));
  if (tplIdx < 0) { console.error('Vorlagenzeile nicht gefunden.'); process.exit(1); }
  const tagMatch = /^(\s*<script\b[^>]*)>([^<]*)(<\/script>\s*)$/.exec(lines[tplIdx]);
  if (!tagMatch) { console.error('Vorlagenzeile hat unerwartete Form.'); process.exit(1); }
  lines[tplIdx] = tagMatch[1] + '>' + Buffer.from(bytes).toString('base64') + tagMatch[3];

  const v159Idx = lines.findIndex(l => l.startsWith('const V159={'));
  const v159 = JSON.parse(lines[v159Idx].slice('const V159='.length, -1));
  /* Dokumente der ETABLIERTEN Registry (z. B. Kindergeld kgan) haben keinen
     V159.pdfTemplates-Eintrag - dann anlegen: der Boot-Merge (Object.assign(old,cfg))
     traegt ihn in die Registry und stellt so den Modus um. */
  const cfg = v159.pdfTemplates[karte.reportId] || (v159.pdfTemplates[karte.reportId] = {});
  /* elementId IMMER auf die Karten-Vorlage setzen: der Laufzeit-Merge (Object.assign(old,cfg))
     laesst den V159-Wert gewinnen - zeigte der auf eine andere (alte) Vorlage, wuerde die
     Praegeung ins Leere laufen (Audit-Befund child_benefit_diversion, 13.08.2026). */
  cfg.elementId = karte.elementId;
  Object.assign(cfg, {
    mode: 'auto-acro', ready: true, tested: false, status: 'overlay-gepraegt',
    mappingVersion: (cfg.mappingVersion || 0) + 1, pdfFieldCount: feldZahl,
    note: 'AcroForm-Overlay (PDF-Umbauplan Phase 3): flache Originalvorlage einmalig mit echten Formularfeldern gepraegt; Feldnamen = kuratierte Schema-Feld-IDs.'
  });
  /* pdfFields-Eintraege: id=name=Schema-Feld-ID -> v159FieldValue liest reportFieldValue(id). */
  const schemaFelder = new Map();
  for (const s of (v159.flatSchemas[karte.reportId] || { sections: [] }).sections) for (const f of s.fields) schemaFelder.set(f.id, f);
  v159.pdfFields[karte.reportId] = eintraege.map(e => ({
    id: e.feldId, name: e.feldId, pdfType: e.pdfType, tabelle: e.tabelle || null,
    label: (schemaFelder.get(e.feldId) || {}).label || e.feldId,
    tooltip: (schemaFelder.get(e.feldId) || {}).label || e.feldId,
    type: (schemaFelder.get(e.feldId) || {}).type || 'text',
    options: e.optionen || [], sourcePath: null, deriveKey: null,
    hasPdfOptions: !!e.hasPdfOptions, bridgeField: null, page: e.page
  }));
  lines[v159Idx] = 'const V159=' + JSON.stringify(v159) + ';';
  if (lines[v159Idx].includes('<scr' + 'ipt') || lines[v159Idx].includes('</scr' + 'ipt')) { console.error('Abbruch: Script-Tag-Sequenz.'); process.exit(1); }
  fs.writeFileSync(HTML, lines.join('\n'));
  console.log('ANGEWENDET: Vorlage ersetzt, mode=auto-acro, ' + eintraege.length + ' pdfFields-Eintraege.');
})().catch(e => { console.error(e); process.exit(1); });
