#!/usr/bin/env node
'use strict';
/* Ersetzt V159.assetCoordinates durch die Anker fuer den Vordruck BS 10 (gen. 01.2023).
   Die alten 144 Positionen gehoerten zur BS-10-Fassung von 2012 und passen nicht mehr.
   Wiederholbar: ein zweiter Lauf schreibt dieselben Werte.
   Aufruf: node assetkoordinaten-setzen.js [pfad/zur/app.html] */
const fs = require('node:fs');
const path = require('node:path');

const WERKZEUG = __dirname;
const ANKER = JSON.parse(fs.readFileSync(path.join(WERKZEUG, 'assetkoordinaten-bs10.json'), 'utf8'));
const APP = process.argv[2] || path.join(WERKZEUG, '..', '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');

const html = fs.readFileSync(APP, 'utf8');
const start = html.indexOf('const V159={');
const ende = html.indexOf(';\n', start);
if (start < 0 || ende < 0) throw new Error('Die V159-Zeile wurde nicht gefunden.');
const V159 = JSON.parse(html.slice(start + 'const V159='.length, ende));

/* Die Namen muessen zu den Aufrufen in v159CreateAssetInventoryPdf passen; fehlt einer, bleibt die
   Angabe im Export unsichtbar. Deshalb wird gegen die tatsaechlich benutzten Namen geprueft. */
const erzeuger = html.slice(html.indexOf('async function v159CreateAssetInventoryPdf('));
const rumpf = erzeuger.slice(0, erzeuger.indexOf('\n}'));
const grenzen = [...rumpf.matchAll(/\.slice\(0,\s*(\d+)\)/g)].map((m) => Number(m[1]));
const zeilenGrenze = grenzen.length ? Math.max(...grenzen) : 2;
const gebraucht = new Set();
for (const treffer of rumpf.matchAll(/put(?:Amount)?\(\s*(?:`([^`]*)`|'([^']*)')/g)) {
  const roh = treffer[1] || treffer[2];
  if (!roh.includes('${')) { gebraucht.add(roh); continue }
  /* Zeilenvorlagen wie `bei ${i+1}` decken mehrere Nummern ab. Wie viele, sagt der Erzeuger selbst:
     jeder Wiederholblock ist mit .slice(0,N) gedeckelt. */
  for (let i = 0; i < zeilenGrenze; i++) gebraucht.add(roh.replace(/\$\{i\+(\d)\}/g, (_m, d) => String(i + Number(d))));
}
/* Ein Teil der Anker steht nicht im put-Aufruf, sondern in der Liste `aggregate` als Tripel
   [Kategorie, Textanker, Betragsanker]. Nur die beiden hinteren sind Anker. */
const aggregat = rumpf.slice(rumpf.indexOf('const aggregate=['));
for (const zeile of aggregat.slice(0, aggregat.indexOf(']\n') + 1).matchAll(/\['([^']*)','([^']*)',(?:'([^']*)'|null)\]/g)) {
  gebraucht.add(zeile[2]);
  if (zeile[3]) gebraucht.add(zeile[3]);
}

const neu = {};
for (const [name, rect] of Object.entries(ANKER)) { if (name !== 'hinweis') neu[name] = rect; }

const fehlend = [...gebraucht].filter((name) => !(name in neu));
if (fehlend.length) throw new Error(`Diese vom Erzeuger benutzten Anker fehlen: ${fehlend.map((x) => JSON.stringify(x)).join(', ')}`);
const ueberzaehlig = Object.keys(neu).filter((name) => !gebraucht.has(name));

for (const [name, rect] of Object.entries(neu)) {
  for (const schluessel of ['page', 'x', 'y', 'width', 'height']) {
    if (!Number.isFinite(rect[schluessel])) throw new Error(`${name}: ${schluessel} fehlt oder ist keine Zahl.`);
  }
  if (rect.page < 0 || rect.page > 5) throw new Error(`${name}: Seite ${rect.page} gibt es im Vordruck nicht.`);
  if (rect.y < 0 || rect.y + rect.height > 842) throw new Error(`${name}: liegt ausserhalb des Blattes.`);
  if (rect.x < 0 || rect.x + rect.width > 596) throw new Error(`${name}: ragt ueber den Rand.`);
}

const vorher = Object.keys(V159.assetCoordinates || {}).length;
V159.assetCoordinates = neu;
const zeile = JSON.stringify(V159);
if (/<\/?script/i.test(zeile)) throw new Error('Die neue V159-Zeile enthaelt eine Script-Tag-Sequenz.');
JSON.parse(zeile);
fs.writeFileSync(APP, html.slice(0, start + 'const V159='.length) + zeile + html.slice(ende));

console.log(`  Anker      ${vorher} (BS 10 von 2012) -> ${Object.keys(neu).length} (BS 10 von 01.2023)`);
console.log(`  vom Erzeuger benutzt: ${gebraucht.size}, alle vorhanden`);
if (ueberzaehlig.length) console.log(`  nicht benutzt: ${ueberzaehlig.join(', ')}`);
