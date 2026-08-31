#!/usr/bin/env node
'use strict';
/* Seitenbilder aus gescannten PDF-Vorlagen herausloesen. CCITT-Rohdaten bekommen einen
   TIFF-Kopf, damit sie ohne Zusatzwerkzeug lesbar werden. Aufruf: pdf-bild-tmp.js <pdf> <zielordner> [seiten] */
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, PDFName } = require('@cantoo/pdf-lib');

function tiffKopf(daten, breite, hoehe, k, schwarzIstEins) {
  const eintraege = [
    [256, 3, breite], [257, 3, hoehe], [258, 3, 1], [259, 3, k < 0 ? 4 : 3],
    [262, 3, schwarzIstEins ? 1 : 0], [273, 4, 0], [277, 3, 1], [278, 3, hoehe], [279, 4, daten.length]
  ];
  const n = eintraege.length, kopf = 8, off = kopf + 2 + n * 12 + 4;
  const b = Buffer.alloc(off + daten.length);
  b.write('II', 0, 'ascii'); b.writeUInt16LE(42, 2); b.writeUInt32LE(kopf, 4); b.writeUInt16LE(n, kopf);
  eintraege.forEach((e, i) => {
    const p = kopf + 2 + i * 12;
    b.writeUInt16LE(e[0], p); b.writeUInt16LE(e[1], p + 2); b.writeUInt32LE(1, p + 4);
    const v = e[0] === 273 ? off : e[2];
    if (e[1] === 3) b.writeUInt16LE(v, p + 8); else b.writeUInt32LE(v, p + 8);
  });
  b.writeUInt32LE(0, kopf + 2 + n * 12);
  daten.copy(b, off);
  return b;
}

(async () => {
  const [datei, ziel, seitenWunsch] = process.argv.slice(2);
  const name = path.basename(datei).replace(/\.pdf$/i, '');
  const pdf = await PDFDocument.load(fs.readFileSync(datei), { ignoreEncryption: true, throwOnInvalidObject: false });
  const nur = seitenWunsch ? seitenWunsch.split(',').map(Number) : null;
  pdf.getPages().forEach((seite, i) => {
    if (nur && !nur.includes(i + 1)) return;
    const res = pdf.context.lookup(seite.node.get(PDFName.of('Resources')));
    const xoRef = res && res.get ? res.get(PDFName.of('XObject')) : null;
    const xo = xoRef ? pdf.context.lookup(xoRef) : null;
    if (!xo) { console.log(`Seite ${i + 1}: kein Bild`); return; }
    xo.keys().forEach((k, j) => {
      const img = pdf.context.lookup(xo.get(k));
      const filter = String(img.dict.get(PDFName.of('Filter')) || '');
      const breite = Number(String(img.dict.get(PDFName.of('Width'))));
      const hoehe = Number(String(img.dict.get(PDFName.of('Height'))));
      const roh = Buffer.from(img.getContents());
      const stamm = `${ziel}/${name}_s${i + 1}${j ? '_' + j : ''}`;
      if (filter.includes('DCT')) fs.writeFileSync(stamm + '.jpg', roh);
      else if (filter.includes('CCITT')) {
        const dp = pdf.context.lookup(img.dict.get(PDFName.of('DecodeParms')));
        const K = dp && dp.get ? Number(String(dp.get(PDFName.of('K')) || 0)) : 0;
        const b1 = dp && dp.get ? String(dp.get(PDFName.of('BlackIs1')) || 'false') === 'true' : false;
        fs.writeFileSync(stamm + '.tif', tiffKopf(roh, breite, hoehe, K, b1));
      } else { console.log(`Seite ${i + 1}: ${filter} nicht unterstuetzt`); return; }
      console.log(`Seite ${i + 1}: ${filter} ${breite}x${hoehe}`);
    });
  });
})();
