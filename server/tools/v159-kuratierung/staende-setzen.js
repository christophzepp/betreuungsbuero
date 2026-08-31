#!/usr/bin/env node
'use strict';
/* Traegt kuratierte Stand-Angaben und Belegquellen in die V159-Katalogzeile ein und vereinheitlicht
   die Schreibweise der uebrigen Staende. Wiederholbar; bricht ab, wenn ein Dokument fehlt.
   Aufruf: node staende-setzen.js [pfad/zur/app.html] */
const fs = require('node:fs');
const path = require('node:path');

const WERKZEUG = __dirname;
const DATEN = JSON.parse(fs.readFileSync(path.join(WERKZEUG, 'staende-2026-08.json'), 'utf8'));
const APP = process.argv[2] || path.join(WERKZEUG, '..', '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');

const html = fs.readFileSync(APP, 'utf8');
const start = html.indexOf('const V159={');
const ende = html.indexOf(';\n', start);
if (start < 0 || ende < 0) throw new Error('Die V159-Zeile wurde nicht gefunden.');
const V159 = JSON.parse(html.slice(start + 'const V159='.length, ende));
const nachId = new Map(V159.catalog.map((e) => [e.id, e]));
const meldungen = [];

for (const [id, werte] of Object.entries(DATEN)) {
  if (id === 'hinweis') continue;
  const eintrag = nachId.get(id);
  if (!eintrag) throw new Error(`${id} steht nicht im Katalog.`);
  const vorher = eintrag.templateDate || '(leer)';
  eintrag.templateDate = werte.templateDate;
  if (werte.template) eintrag.template = werte.template;
  if (werte.sourceUrl) eintrag.sourceUrl = werte.sourceUrl;
  if (werte.sourceLabel) eintrag.sourceLabel = werte.sourceLabel;
  /* Der Beleg gehoert in die Datei, nicht in den Katalog: er begruendet die Angabe fuer spaetere
     Pruefungen, gehoert aber nicht in den Dialog. */
  meldungen.push(`  ${id.padEnd(36)} ${vorher} -> ${werte.templateDate}`);
}

/* Schreibweise vereinheitlichen: Monatsangaben als MM/JJJJ, damit im Dialog nicht drei Formate
   nebeneinander stehen. Datumsangaben (TT.MM.JJJJ) und ausformulierte Auskuenfte bleiben. */
const MONATE = { januar: '01', februar: '02', 'märz': '03', april: '04', mai: '05', juni: '06',
  juli: '07', august: '08', september: '09', oktober: '10', november: '11', dezember: '12' };
for (const eintrag of V159.catalog) {
  const stand = String(eintrag.templateDate || '');
  if (!stand || stand === '--') continue;
  const monat = stand.match(/^([A-Za-zäöü]+)\s+(\d{4})$/);
  if (monat && MONATE[monat[1].toLowerCase()]) {
    meldungen.push(`  ${eintrag.id.padEnd(36)} ${stand} -> ${MONATE[monat[1].toLowerCase()]}/${monat[2]}`);
    eintrag.templateDate = `${MONATE[monat[1].toLowerCase()]}/${monat[2]}`;
    continue;
  }
  const punkt = stand.match(/^(\d{2})\.(\d{4})$/);
  if (punkt) {
    meldungen.push(`  ${eintrag.id.padEnd(36)} ${stand} -> ${punkt[1]}/${punkt[2]}`);
    eintrag.templateDate = `${punkt[1]}/${punkt[2]}`;
  }
}

const zeile = JSON.stringify(V159);
if (/<\/?script/i.test(zeile)) throw new Error('Die neue V159-Zeile enthaelt eine Script-Tag-Sequenz.');
JSON.parse(zeile);
fs.writeFileSync(APP, html.slice(0, start + 'const V159='.length) + zeile + html.slice(ende));

const ohneStand = V159.catalog.filter((e) => !e.templateDate).length;
console.log(meldungen.join('\n'));
console.log(`  ---\n  noch ohne Stand: ${ohneStand} von ${V159.catalog.length}`);
