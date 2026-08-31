#!/usr/bin/env node
'use strict';
/* Traegt Koordinatenzuordnungen fuer flache Original-PDFs in OFFICIAL_COORDINATE_MAPS ein.
   Sobald ein Dokument dort steht, hebt der Block flat-original-overlay-v253 die Sperre auf und
   schaltet es auf mode 'flat' / ready:true um; die Angaben werden dann direkt auf die
   Originalseiten geschrieben statt auf ein Ausfuellblatt.

   Der Lauf ist wiederholbar: vorhandene Eintraege werden ersetzt, nicht verdoppelt.
   Aufruf: node koordinaten-karten.js [pfad/zur/app.html] */

const fs = require('node:fs');
const path = require('node:path');

const WERKZEUG = __dirname;
const KARTEN = JSON.parse(fs.readFileSync(path.join(WERKZEUG, 'koordinaten-karten.json'), 'utf8'));
const APP = process.argv[2] || path.join(WERKZEUG, '..', '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');

let html = fs.readFileSync(APP, 'utf8');
const groesseVorher = html.length;

const ANKER = 'const OFFICIAL_COORDINATE_MAPS={\n';
if (!html.includes(ANKER)) throw new Error('OFFICIAL_COORDINATE_MAPS wurde nicht gefunden.');

/* Nur die Nutzdaten uebernehmen; "quelle" und "hinweis" sind Dokumentation der Werkzeugdatei. */
const eintraege = Object.entries(KARTEN).filter(([id]) => id !== 'hinweis');
const meldungen = [];

for (const [id, karte] of eintraege) {
  const nutz = {};
  if (karte.text) nutz.text = karte.text;
  if (karte.checks) nutz.checks = karte.checks;
  if (karte.tables) nutz.tables = karte.tables;
  const anzahl = Object.keys(nutz.text || {}).length
    + Object.values(nutz.checks || {}).reduce((n, o) => n + Object.keys(o).length, 0);

  const block = `  /* ${karte.quelle} */\n  ${id}:${JSON.stringify(nutz)},\n`;
  const vorhanden = new RegExp(`\\n  (?:/\\*[^*]*\\*/\\n  )?${id}:\\{(?:"text"|"checks"|"tables")[\\s\\S]*?\\},\\n`);
  if (vorhanden.test(html)) {
    html = html.replace(vorhanden, '\n' + block);
    meldungen.push(`  ersetzt  ${id}: ${anzahl} Positionen`);
  } else {
    html = html.replace(ANKER, ANKER + block);
    meldungen.push(`  neu      ${id}: ${anzahl} Positionen`);
  }
}

/* Schlusspruefung: Der Block muss weiterhin ein gueltiges Objektliteral sein. */
const start = html.indexOf(ANKER);
let tiefe = 0, i = html.indexOf('{', start), ende = -1;
while (i < html.length) {
  const c = html[i];
  if (c === '{') tiefe++;
  else if (c === '}') { tiefe--; if (!tiefe) { ende = i; break } }
  else if (c === '"' || c === "'") { const q = c; i++; while (html[i] !== q || html[i - 1] === '\\') i++; }
  i++;
}
if (ende < 0) throw new Error('Das Ende von OFFICIAL_COORDINATE_MAPS wurde nicht gefunden.');
/* eslint-disable no-new-func */
new Function(`return ${html.slice(html.indexOf('{', start), ende + 1)}`)();

for (const [id] of eintraege) {
  if (!new RegExp(`\\n  ${id}:\\{`).test(html)) throw new Error(`${id} wurde nicht eingetragen.`);
}

fs.writeFileSync(APP, html);
console.log(meldungen.join('\n'));
console.log(`  Dateigroesse  ${(groesseVorher / 1048576).toFixed(2)} MB -> ${(html.length / 1048576).toFixed(2)} MB`);
