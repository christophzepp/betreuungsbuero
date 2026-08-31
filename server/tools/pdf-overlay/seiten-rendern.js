#!/usr/bin/env node
/* Rendert JEDE Seite einer PDF als weiss hinterlegtes PNG (1240 px breit) nach
   vorlagen/render/<basisname>_s<N>.png - Arbeitsgrundlage fuer die Rechteck-Karten.
   (sips rendert nur Seite 1, deshalb wird jede Seite erst als Einzel-PDF extrahiert;
   transparente Vorlagen brauchen den PIL-Weissgrund, sonst erscheint alles schwarz.)
   Aufruf: node seiten-rendern.js vorlagen/tpl_v159_xyz.pdf */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PDFDocument } = require('pdf-lib');

const quelle = process.argv[2];
if (!quelle || !fs.existsSync(quelle)) { console.error('Aufruf: node seiten-rendern.js <pfad.pdf>'); process.exit(1); }
const basis = path.basename(quelle, '.pdf');
const zielDir = path.join(__dirname, 'vorlagen', 'render');
fs.mkdirSync(zielDir, { recursive: true });

(async () => {
  const pdf = await PDFDocument.load(fs.readFileSync(quelle), { ignoreEncryption: true });
  const n = pdf.getPageCount();
  for (let i = 0; i < n; i++) {
    const einzel = await PDFDocument.create();
    const [seite] = await einzel.copyPages(pdf, [i]);
    einzel.addPage(seite);
    const tmpPdf = path.join(zielDir, `${basis}_s${i + 1}.tmp.pdf`);
    fs.writeFileSync(tmpPdf, await einzel.save({ useObjectStreams: false }));
    const roh = path.join(zielDir, `${basis}_s${i + 1}.roh.png`);
    const ziel = path.join(zielDir, `${basis}_s${i + 1}.png`);
    execFileSync('sips', ['-s', 'format', 'png', '--resampleWidth', '1240', tmpPdf, '--out', roh], { stdio: 'ignore' });
    execFileSync('python3', ['-c', `
from PIL import Image
img=Image.open(${JSON.stringify(roh)}).convert('RGBA')
w=Image.new('RGBA',img.size,(255,255,255,255)); w.alpha_composite(img)
w.convert('RGB').save(${JSON.stringify(ziel)})
`]);
    fs.unlinkSync(tmpPdf); fs.unlinkSync(roh);
    console.log('Seite', i + 1, '->', ziel);
  }
  console.log(n + ' Seite(n) gerendert.');
})().catch(e => { console.error(e.message); process.exit(1); });
