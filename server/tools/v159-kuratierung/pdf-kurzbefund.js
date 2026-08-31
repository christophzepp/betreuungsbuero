#!/usr/bin/env node
'use strict';
/* Kurzbefund je PDF: Seiten, Groesse, Formularfelder (AcroForm) mit Typ und Name. */
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('@cantoo/pdf-lib');

(async () => {
  for (const datei of process.argv.slice(2)) {
    const bytes = fs.readFileSync(datei);
    let pdf;
    try {
      pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
    } catch (e) {
      console.log(`${path.basename(datei)}: LADEFEHLER ${e.message}`);
      continue;
    }
    const seiten = pdf.getPages();
    let felder = [];
    try { felder = pdf.getForm().getFields(); } catch (_e) {}
    const groesse = seiten[0] ? seiten[0].getSize() : { width: 0, height: 0 };
    console.log(`\n=== ${path.basename(datei)}`);
    console.log(`    ${seiten.length} Seiten, ${Math.round(groesse.width)}x${Math.round(groesse.height)}, ${Math.round(bytes.length / 1024)} KB, ${felder.length} Formularfelder`);
    felder.slice(0, 400).forEach((f) => {
      const typ = f.constructor.name.replace('PDF', '').replace('Field', '');
      let zusatz = '';
      try { if (typ === 'RadioGroup' || typ === 'Dropdown' || typ === 'OptionList') zusatz = ' {' + f.getOptions().join('|') + '}'; } catch (_e) {}
      console.log(`      ${typ.padEnd(11)} ${f.getName()}${zusatz}`);
    });
    if (felder.length > 400) console.log(`      … und ${felder.length - 400} weitere`);
  }
})();
