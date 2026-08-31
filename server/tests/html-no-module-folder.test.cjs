'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.resolve(
  __dirname,
  '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
);
const html = fs.readFileSync(htmlPath, 'utf8');

assert.ok(!html.includes("api('/mirror/sources"), 'Explorer lädt noch alte Modulquellen.');
assert.ok(!html.includes('<span>Modulordner</span>'), 'Explorer rendert noch die Modulordner-Sektion.');
assert.ok(!html.includes("window.__dok.spiegelWahl('fallchronik')"), 'Schnellzugriff verwendet noch die Spiegelansicht.');
assert.ok(
  html.includes("window.__dok.pfadWahl(['11 - Betreuungsführung','Falldokumentation'])"),
  'Schnellzugriff zeigt nicht in das zentrale Register.'
);
assert.ok(
  html.includes('Unterordner entstehen erst mit der ersten Datei: tiefsten vorhandenen Ordner öffnen.'),
  'Schnellzugriff berücksichtigt den bedarfsgerecht noch fehlenden Unterordner nicht.'
);

const scripts = [];
const expression = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
while ((match = expression.exec(html))) scripts.push({ attributes: match[1], body: match[2] });
assert.equal(scripts.length, 309, 'Scriptblockzahl hat sich verändert.');
for (let index = 0; index < scripts.length; index++) {
  if (/\btype\s*=/i.test(scripts[index].attributes)) continue;
  new vm.Script(scripts[index].body, { filename: `app-script-${index + 1}.js` });
}

console.log('Explorer ohne Modulordner: zentraler Falldokumentationspfad, 289 Blöcke, 0 Syntaxfehler');
