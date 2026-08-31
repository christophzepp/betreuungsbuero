#!/usr/bin/env node
/* Bereinigt eine Vorlage von eingebrannten personenbezogenen Daten (PDF-Umbauplan Phase 3,
   Echtdaten-Befund 13.08.2026): rendert jede Seite hochaufloesend (2480 px Breite ~ 300 dpi),
   WEISST die in regionen/<reportId>.regionen.json markierten Bereiche IM PIXELMATERIAL und
   baut die PDF ausschliesslich aus den bereinigten Bildern neu auf.

   Ergebnis ist BEWEISBAR datenfrei: die neue PDF enthaelt keinerlei Text-Objekte mehr
   (kein /Font, kein Tj) - es gibt nichts Verdecktes, das sich extrahieren liesse.
   (Preis: die Vorlage ist danach Rasterqualitaet ~300 dpi - fuer die betroffenen drei
   Vorlagen kein Verlust, sie waren Scans/Ausdrucke; die sauberere Endloesung bleibt die
   Beschaffung leerer Behoerdenfassungen, siehe Plan.)

   regionen/<reportId>.regionen.json:
     { "bildBreite": 2480, "seiten": { "1": [ {"x":..,"y":..,"width":..,"height":..}, ... ] } }
     (Pixel@2480, x/y = linke OBERE Ecke, Seitennummern 1-basiert)

   Aufruf:
     node vorlage-bereinigen.js <reportId> <elementId> --markieren   -> rote Rahmen statt Weiss
                                                                        (Sichtpruefung), PNGs unter
                                                                        vorlagen/render/<elementId>.markiert_s<N>.png
     node vorlage-bereinigen.js <reportId> <elementId>              -> vorlagen/<elementId>.bereinigt.pdf */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PDFDocument, PDFName } = require('pdf-lib');

const reportId = process.argv[2];
const elementId = process.argv[3];
const MARKIEREN = process.argv.includes('--markieren');
if (!reportId || !elementId) { console.error('Aufruf: node vorlage-bereinigen.js <reportId> <elementId> [--markieren]'); process.exit(1); }

const BILD_BREITE = 2480;
const regionen = JSON.parse(fs.readFileSync(path.join(__dirname, 'regionen', reportId + '.regionen.json'), 'utf8'));
if ((regionen.bildBreite || BILD_BREITE) !== BILD_BREITE) { console.error('Regionen muessen in px@' + BILD_BREITE + ' vorliegen.'); process.exit(1); }
const quelle = path.join(__dirname, 'vorlagen', elementId + '.pdf');
const renderDir = path.join(__dirname, 'vorlagen', 'render');
fs.mkdirSync(renderDir, { recursive: true });

(async () => {
  const pdf = await PDFDocument.load(fs.readFileSync(quelle), { ignoreEncryption: true });
  const n = pdf.getPageCount();
  const seitenPngs = [];
  for (let i = 0; i < n; i++) {
    const einzel = await PDFDocument.create();
    const [seite] = await einzel.copyPages(pdf, [i]);
    einzel.addPage(seite);
    const tmpPdf = path.join(renderDir, `${elementId}.tmp_s${i + 1}.pdf`);
    fs.writeFileSync(tmpPdf, await einzel.save({ useObjectStreams: false }));
    const roh = path.join(renderDir, `${elementId}.roh_s${i + 1}.png`);
    execFileSync('sips', ['-s', 'format', 'png', '--resampleWidth', String(BILD_BREITE), tmpPdf, '--out', roh], { stdio: 'ignore' });
    const ziel = MARKIEREN
      ? path.join(renderDir, `${elementId}.markiert_s${i + 1}.png`)
      : path.join(renderDir, `${elementId}.sauber_s${i + 1}.jpg`);
    const rects = JSON.stringify(regionen.seiten[String(i + 1)] || []);
    execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw
import json
img=Image.open(${JSON.stringify(roh)}).convert('RGBA')
w=Image.new('RGBA',img.size,(255,255,255,255)); w.alpha_composite(img)
w=w.convert('RGB')
d=ImageDraw.Draw(w)
for r in json.loads(${JSON.stringify(rects)}):
    box=(r['x'],r['y'],r['x']+r['width'],r['y']+r['height'])
    if ${MARKIEREN ? 'True' : 'False'}:
        d.rectangle(box, outline=(220,30,30), width=6)
    else:
        d.rectangle(box, fill=(255,255,255))
if ${MARKIEREN ? 'True' : 'False'}:
    w.save(${JSON.stringify(ziel)})
else:
    w.convert('L').save(${JSON.stringify(ziel)}, quality=82, optimize=True)
`]);
    fs.unlinkSync(tmpPdf); fs.unlinkSync(roh);
    seitenPngs.push(ziel);
    console.log('Seite', i + 1, (regionen.seiten[String(i + 1)] || []).length, 'Regionen ->', path.basename(ziel));
  }

  if (MARKIEREN) { console.log('Markierungs-Renders fertig (keine PDF gebaut).'); return; }

  /* Neuaufbau: reine Bild-PDF in Originalseitengroesse. */
  const neu = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const alt = pdf.getPage(i);
    const bild = await neu.embedJpg(fs.readFileSync(seitenPngs[i]));
    const seite = neu.addPage([alt.getWidth(), alt.getHeight()]);
    seite.drawImage(bild, { x: 0, y: 0, width: alt.getWidth(), height: alt.getHeight() });
  }
  const bytes = await neu.save({ useObjectStreams: false });
  const ziel = path.join(__dirname, 'vorlagen', elementId + '.bereinigt.pdf');
  fs.writeFileSync(ziel, bytes);

  /* Beweis der Datenfreiheit: keine Seite traegt Font-Ressourcen (ohne Font kann kein Text
     gerendert werden). KEIN naiver Byte-Scan - komprimierte Bild-Streams koennen zufaellig
     beliebige Bytefolgen enthalten. Info-Dict ist durch den Neuaufbau frisch. */
  const probe = await PDFDocument.load(bytes);
  let fontSeiten = 0;
  for (const seite of probe.getPages()) {
    const res = seite.node.Resources();
    const fonts = res && res.lookup(PDFName.of('Font'));
    /* pdf-lib legt bei addPage einen LEEREN Font-Container an - nur tatsaechliche
       Font-Eintraege zaehlen (ohne Font kein renderbarer/extrahierbarer Text). */
    if (fonts && typeof fonts.keys === 'function' && fonts.keys().length > 0) fontSeiten++;
  }
  console.log('Geschrieben:', ziel, '(' + Math.round(bytes.length / 1e6 * 10) / 10 + ' MB, ' + n + ' Seiten)');
  console.log('Datenfreiheits-Beweis: Seiten mit Font-Ressourcen = ' + fontSeiten + '/' + n + (fontSeiten ? '  !! PRUEFEN !!' : '  -> reine Bild-PDF, kein extrahierbarer Text'));
})().catch(e => { console.error(e); process.exit(1); });
