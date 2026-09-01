'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

function section(start, end) {
  const a = html.indexOf(start);
  assert.ok(a >= 0, `Startanker fehlt: ${start}`);
  const b = html.indexOf(end, a);
  assert.ok(b > a, `Endanker fehlt: ${end}`);
  return html.slice(a, b);
}

test('0.7.3 bietet einen echten leeren lokalen Fall mit stabiler ID an', () => {
  assert.match(html, /const APP_VERSION='0\.7\.3'/);
  assert.match(html, /id="startCreateEmptyCaseBtn"/);
  assert.match(html, /localCaseId:uuid\(\)/);
  assert.match(html, /globalThis\.crypto\?\.randomUUID/);
  const registry = section('<script id="case-registry-v161">', '</script>');
  assert.match(registry, /if\(s\?\.ui\?\.localCaseId\)return String\(s\.ui\.localCaseId\)/);
  assert.match(registry, /state\.ui\.localCaseId=/);
});

test('integrierte Arbeitsmappen werden angelegt und nach einem Neustart wiederhergestellt', () => {
  assert.match(html, /window\.__ensureLocalWorkbookArchives073=async function/);
  assert.match(html, /__curatedTemplateBytesAsync\?\.\(kind\)/);
  assert.match(html, /templateBook\('stammdaten',MASTER_NAME\)/);
  assert.match(html, /templateBook\('adressverzeichnis',ADDRESS_NAME\)/);
  assert.match(html, /masterOrigin:'embedded',addressOrigin:'embedded'/);
  assert.match(html, /restoreEmbeddedArchives/);
});

test('lokale Einzel- und Gesamtsicherung erzwingen den vollständigen Pflichtbestand', () => {
  const single = section('  async function collectSingleCaseBackupEntries(){', '  window.__collectSingleCaseBackupEntries=collectSingleCaseBackupEntries;');
  assert.match(single, /__ensureLocalWorkbookArchives073\(\{forBackup:true\}\)/);
  assert.match(single, /Fall-JSON, Stammdaten\.xlsx und Adressverzeichnis\.xlsx müssen enthalten sein/);

  const all = section('  window.downloadAllCasesZip=async function(){', '\n\n  \/* ===== Sammel-Indikator:');
  assert.match(all, /localRequiredCounts=\{json:0,master:0,address:0\}/);
  assert.match(all, /Betreuungsorganisation\.json/);
  assert.match(all, /Betreuungsorganisation\.xlsx/);
  assert.match(all, /Lokaler Arbeitsdatenexport abgebrochen: Pflichtbestand fehlt/);
});

test('Ordner- und ZIP-Import bevorzugen die verlustfreie Büroorganisations-JSON', () => {
  const folder = section('async function handleFolderFiles(files){', 'async function importBackupZip(file){');
  assert.match(folder, /const bueroJsonFile=/);
  assert.match(folder, /__dataAdmin\?\.importBueroJsonText/);
  assert.match(folder, /f!==bueroJsonFile/);

  const zip = section('async function importBackupZip(file){', 'async function importMultiCaseBackupZip');
  assert.match(zip, /rootBoJsonName/);
  assert.match(zip, /__dataAdmin\?\.importBueroJsonText/);
  assert.match(zip, /bueroImportedRoot\?\[\]:rootXlsxNames/);
});

