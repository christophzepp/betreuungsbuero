#!/usr/bin/env node
/* Nutzerwunsch 13.08.2026: Die Gruppe „Berichte an das Betreuungsgericht" in der linken
   Menüleiste fachlich sortieren: Anfangsbericht, Jahresbericht ohne Vermögenssorge,
   Jahresbericht mit Vermögenssorge, Betreuungsgerichtliche Genehmigung, Schlussbericht.
   Die Navigationsreihenfolge stammt aus der V159-Katalogzeile (REPORTS wird beim Laden per
   splice in Katalogreihenfolge neu aufgebaut); die Genehmigung steht nicht im Katalog und wird
   zur Laufzeit relativ zum Schlussbericht eingefügt (separater Patch im HTML: vor statt nach).
   Modi: --zeigen (Dry-Run), --anwenden (schreibt die Datei). Arbeitet wie v159-patch.js
   ausschließlich auf der EINEN Zeile `const V159={...};`. */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html');
const ANWENDEN = process.argv.includes('--anwenden');

const html = fs.readFileSync(HTML, 'utf8');
const lines = html.split('\n');
const idx = lines.findIndex(l => l.startsWith('const V159={'));
if (idx < 0) { console.error('V159-Zeile nicht gefunden'); process.exit(1); }
const v159 = JSON.parse(lines[idx].slice('const V159='.length, -1));

const WUNSCH = ['initial', 'annual_noassets', 'annual_assets', 'closing'];
const plaetze = [];
for (let i = 0; i < v159.catalog.length; i++) if (WUNSCH.includes(v159.catalog[i].id)) plaetze.push(i);
if (plaetze.length !== WUNSCH.length) { console.error('Erwartete Berichte nicht vollständig im Katalog:', plaetze.length); process.exit(1); }

console.log('Ist-Reihenfolge :', plaetze.map(i => v159.catalog[i].id).join(', '));
const eintraege = Object.fromEntries(plaetze.map(i => [v159.catalog[i].id, v159.catalog[i]]));
plaetze.forEach((platz, k) => { v159.catalog[platz] = eintraege[WUNSCH[k]]; });
console.log('Soll-Reihenfolge:', plaetze.map(i => v159.catalog[i].id).join(', '));

if (ANWENDEN) {
  lines[idx] = 'const V159=' + JSON.stringify(v159) + ';';
  if (lines[idx].includes('<script') || lines[idx].includes('</scr' + 'ipt')) { console.error('Abbruch: Script-Tag-Sequenz in der Zeile'); process.exit(1); }
  fs.writeFileSync(HTML, lines.join('\n'));
  console.log('ANGEWENDET.');
} else {
  console.log('(Dry-Run – mit --anwenden schreiben)');
}
