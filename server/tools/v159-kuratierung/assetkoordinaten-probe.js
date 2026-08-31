#!/usr/bin/env node
'use strict';
/* Sichtprobe der BS-10-Anker: schreibt je Anker seinen Namen (bzw. einen Musterbetrag) an die
   vorgesehene Stelle - mit derselben Geometrie, die v159CreateAssetInventoryPdf verwendet.
   Aufruf: assetkoordinaten-probe.js <ziel.pdf> */
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');

const ANKER = JSON.parse(fs.readFileSync(path.join(__dirname, 'assetkoordinaten-bs10.json'), 'utf8'));
const QUELLE = path.join(__dirname, 'vorlagen-2026-08', 'BS10_Vermoegensverzeichnis_01-2023.pdf');
const ziel = process.argv[2] || '/tmp/bs10-probe.pdf';

(async () => {
  const pdf = await PDFDocument.load(fs.readFileSync(QUELLE), { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const seiten = pdf.getPages();
  let anzahl = 0;
  for (const [name, rect] of Object.entries(ANKER)) {
    if (name === 'hinweis') continue;
    const betrag = /^(EUR|Gb\d+_Euro|Summe|Vermögen gesamt|mtl_|\)$)/.test(name.trim()) || name === ')';
    const text = betrag ? '12.345,67 €' : name.trim() || '(leerer Name)';
    /* Geometrie wie in put(): x+2, Grundlinie y+max(2,(height-9)/2), Groesse height*0.48. */
    const x = rect.x + 2;
    const y = rect.y + Math.max(2, (rect.height - 9) / 2) + (name === 'Geschäfts-Nr' ? 5 : 0);
    const breite = Math.max(10, rect.width - 4);
    let groesse = Math.min(9.2, Math.max(6.5, rect.height * 0.48));
    while (groesse > 5 && font.widthOfTextAtSize(text, groesse) > breite) groesse -= 0.25;
    const seite = seiten[rect.page];
    if (rect.clear) seite.drawRectangle({ x: x - 1, y: y - 2.5, width: breite + 2, height: groesse + 5, color: rgb(1, 1, 1) });
    seite.drawText(text, { x, y, size: groesse, font, color: rgb(0, 0, 0.75) });
    seite.drawRectangle({ x, y: y - 2, width: breite, height: groesse + 4, borderColor: rgb(1, 0, 0), borderWidth: 0.4 });
    anzahl++;
  }
  fs.writeFileSync(ziel, await pdf.save({ useObjectStreams: false }));
  console.log(`${anzahl} Anker geschrieben -> ${ziel}`);
})();
