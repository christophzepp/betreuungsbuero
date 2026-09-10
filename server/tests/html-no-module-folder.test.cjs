'use strict';

const assert = require('assert');
const { assertScriptInventory } = require('./helpers/html-scripts.cjs');
const fs = require('fs');
const path = require('path');

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

assertScriptInventory(html, htmlPath);

console.log('Explorer ohne Modulordner: zentraler Falldokumentationspfad, Scriptbestand und Syntax geprüft');
