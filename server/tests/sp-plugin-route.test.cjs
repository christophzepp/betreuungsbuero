'use strict';

/*
 * Auslieferung des Super-Productivity-Plugins „Betreuungsbüro Sync" (Nutzerwunsch 30.08.2026).
 * Geprüft wird der Vertrag der Route - AUSGEFÜHRT gegen einen echten Server auf listen(0):
 * Anmeldezwang, Auskunft mit Version aus dem Manifest, und ein ZIP, das genau die vier
 * Plugin-Dateien trägt und wieder auspackbar ist. Zusätzlich ein Ordner-Umschalter
 * (SP_PLUGIN_DIR), damit der Fall „Plugin fehlt" ohne Eingriff am echten Ordner prüfbar ist.
 */

const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const express = require('express');

const echterOrdner = path.join(__dirname, '..', '..', 'sp-plugin');
const leererOrdner = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plugin-leer-'));

function baueApp(pluginDir) {
  process.env.SP_PLUGIN_DIR = pluginDir;
  delete require.cache[require.resolve('../src/config/paths')];
  delete require.cache[require.resolve('../src/integrations/sp-plugin/routes')];
  const routen = require('../src/integrations/sp-plugin/routes');
  const app = express();
  app.use((req, _res, next) => {
    if (req.get('X-Test-User')) req.session = { userId: Number(req.get('X-Test-User')), mode: 'online' };
    next();
  });
  app.use('/api/sp-plugin', routen);
  return app;
}

let server; let base = '';
before(async () => {
  server = http.createServer(baueApp(echterOrdner));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(leererOrdner, { recursive: true, force: true });
  delete process.env.SP_PLUGIN_DIR;
});

function hole(url, angemeldet) {
  return fetch(`${base}${url}`, { headers: angemeldet ? { 'X-Test-User': '1' } : {} });
}

/* Store-only-ZIP auslesen: Namen und Inhalte aus den lokalen Kopfsätzen. Bewusst ohne
   Fremdbibliothek - der Server packt selbst ohne eine solche. */
function zipEintraege(buffer) {
  const eintraege = new Map();
  let i = 0;
  while (i + 30 <= buffer.length && buffer.readUInt32LE(i) === 0x04034b50) {
    const methode = buffer.readUInt16LE(i + 8);
    const packed = buffer.readUInt32LE(i + 18);
    const nameLen = buffer.readUInt16LE(i + 26);
    const extraLen = buffer.readUInt16LE(i + 28);
    const name = buffer.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const daten = buffer.slice(i + 30 + nameLen + extraLen, i + 30 + nameLen + extraLen + packed);
    eintraege.set(name, methode === 8 ? zlib.inflateRawSync(daten) : daten);
    i += 30 + nameLen + extraLen + packed;
  }
  return eintraege;
}

test('ohne Anmeldung liefert die Plugin-Route 401', async () => {
  for (const url of ['/api/sp-plugin', '/api/sp-plugin/download']) {
    const res = await hole(url, false);
    assert.equal(res.status, 401, `${url} war ohne Sitzung erreichbar`);
  }
});

test('Auskunft nennt Version, Dateien und Größe aus dem echten Plugin-Ordner', async () => {
  const res = await hole('/api/sp-plugin', true);
  assert.equal(res.status, 200);
  const info = await res.json();
  assert.equal(info.available, true, 'Das mitgelieferte Plugin muss gefunden werden.');
  assert.equal(info.id, 'betreuungsbuero-sync');
  const manifest = JSON.parse(fs.readFileSync(path.join(echterOrdner, 'manifest.json'), 'utf8'));
  assert.equal(info.version, manifest.version, 'Die Version muss aus dem Manifest kommen, nicht aus dem Code.');
  assert.deepEqual(info.files.map((f) => f.name), ['manifest.json', 'plugin.js', 'sync-core.js', 'README.md'],
    'Die Auslieferung ist eine feste Liste - kein Durchsuchen des Ordners.');
  assert.ok(info.size > 1000, 'Die Größenangabe fehlt oder ist unplausibel.');
});

test('Der Download ist ein auspackbares ZIP mit genau den vier Plugin-Dateien', async () => {
  const res = await hole('/api/sp-plugin/download', true);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const manifest = JSON.parse(fs.readFileSync(path.join(echterOrdner, 'manifest.json'), 'utf8'));
  assert.match(res.headers.get('content-disposition') || '', /attachment; filename="betreuungsbuero-sync-.+\.zip"/);
  assert.ok((res.headers.get('content-disposition') || '').includes(manifest.version),
    'Der Dateiname muss die Version tragen - sonst liegen mehrere Stände namensgleich im Downloads-Ordner.');

  const buffer = Buffer.from(await res.arrayBuffer());
  assert.equal(buffer.readUInt32LE(0), 0x04034b50, 'Keine ZIP-Signatur.');
  const eintraege = zipEintraege(buffer);
  assert.deepEqual([...eintraege.keys()], ['manifest.json', 'plugin.js', 'sync-core.js', 'README.md']);
  /* Inhalte identisch zum Quellordner - das Paket ist eine Kopie, keine Umschreibung. */
  for (const [name, daten] of eintraege) {
    assert.deepEqual(daten, fs.readFileSync(path.join(echterOrdner, name)), `${name} weicht vom Original ab.`);
  }
  /* Und es ist wirklich das Plugin: Manifest lesbar, Kennung und Hooks stehen drin. */
  const m = JSON.parse(eintraege.get('manifest.json').toString('utf8'));
  assert.equal(m.id, 'betreuungsbuero-sync');
  assert.ok(Array.isArray(m.hooks) && m.hooks.length, 'Das Manifest im Paket hat keine Hooks.');
});

test('Fehlt der Plugin-Ordner, sagt die Route das klar statt ein leeres ZIP zu liefern', async () => {
  const zweit = http.createServer(baueApp(leererOrdner));
  await new Promise((resolve) => zweit.listen(0, '127.0.0.1', resolve));
  const zweitBase = `http://127.0.0.1:${zweit.address().port}`;
  try {
    const info = await (await fetch(`${zweitBase}/api/sp-plugin`, { headers: { 'X-Test-User': '1' } })).json();
    assert.equal(info.available, false);
    assert.deepEqual(info.files, []);
    const dl = await fetch(`${zweitBase}/api/sp-plugin/download`, { headers: { 'X-Test-User': '1' } });
    assert.equal(dl.status, 404);
    assert.match((await dl.json()).error, /nicht hinterlegt/);
  } finally {
    zweit.close();
    /* Für die übrigen Tests wieder auf den echten Ordner zeigen. */
    baueApp(echterOrdner);
  }
});

/* ---- Verdrahtung in der Anwendung (Nutzerwunsch: „Baue es und verdrahte es") ---- */
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs',
  'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

test('Die Anwendung bietet das Plugin dort an, wo der passende Token entsteht', () => {
  /* Bewusst NICHT bei den Kalender-/Aufgaben-Verbindungen: Das Plugin läuft auf dem Rechner des
     Nutzers und meldet sich mit demselben API-Token an wie die Browser-Erweiterung. */
  assert.ok(html.includes('function spPluginSectionHTML()'), 'Die Plugin-Karte fehlt.');
  const dialog = html.slice(html.indexOf('${freshTokenHTML()}'), html.indexOf('${freshTokenHTML()}') + 400);
  assert.ok(dialog.includes('${installSectionHTML()}') && dialog.includes('${spPluginSectionHTML()}'),
    'Die Karte hängt nicht im Erweiterungs-Dialog neben der Installationskarte.');
  assert.match(html, /renderInstallBox\(\);\s*\n\s*renderSpPluginBox\(\);/,
    'Der Renderer wird nach dem Zeichnen nicht aufgerufen - die Karte bliebe auf „wird geprüft" stehen.');
  assert.ok(html.includes("href=\"/api/sp-plugin/download\""), 'Der Download-Knopf zeigt nicht auf die Route.');
  assert.ok(html.includes("fetch('/api/sp-plugin',{credentials:'same-origin'})"),
    'Version und Verfügbarkeit werden nicht vom Server geholt.');
  /* Fristen sind Nur-Export - das muss an der Ausgabestelle stehen, nicht nur in der README. */
  assert.ok(html.includes('Fristen und Wiedervorlagen kommen schreibgeschützt an'),
    'Der Hinweis auf die schreibgeschützten Fristen fehlt an der Karte.');
  /* Vorführung: keine Auslieferung, wie bei den übrigen Downloads. */
  assert.match(html, /async function renderSpPluginBox\(\)\{[\s\S]{0,400}?if\(window\.__demoModus\)\{/,
    'In der Vorführung darf kein Plugin ausgeliefert werden.');
});

test('Server: Route hängt eingebaut und der Plugin-Ordner ist eine eigene Pfad-Konstante', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.ok(index.includes("app.use('/api/sp-plugin', require('./src/integrations/sp-plugin/routes'));"),
    'Die Route ist nicht eingehängt.');
  const paths = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'paths.js'), 'utf8');
  assert.match(paths, /SP_PLUGIN_ROOT = configuredPath\(\s*process\.env\.SP_PLUGIN_DIR/,
    'Der Plugin-Ordner gehört als konfigurierbare Konstante zu den übrigen Pfaden.');
  assert.ok(paths.includes('  SP_PLUGIN_ROOT,'), 'SP_PLUGIN_ROOT wird nicht exportiert.');
  const xlsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'simple-xlsx.js'), 'utf8');
  assert.ok(xlsx.includes('module.exports = { workbook, flatten, zipStore,'),
    'zipStore muss regulär exportiert sein - die Auslieferung soll keinen zweiten ZIP-Schreiber mitbringen.');
});

test('„Kalender, Aufgaben & Kontakte" weist zu Super Productivity den Weg (Nutzerfrage 30.08.2026)', () => {
  /* Kein vierter Verbindungsknopf: Super Productivity ist kein Server, den das Büro anbindet,
     sondern läuft auf dem Rechner der Nutzerin. Der Wegweiser nennt deshalb beide echten Wege. */
  const i = html.indexOf('+ Vikunja (CalDAV)</button>');
  assert.ok(i > 0, 'Die Aufgaben-Verbindungsreihe wurde nicht gefunden.');
  const umfeld = html.slice(i, i + 1400);
  assert.ok(umfeld.includes('<strong>Super Productivity</strong> wird nicht hier verbunden'),
    'Der Wegweiser fehlt direkt unter den Aufgaben-Verbindungen.');
  assert.ok(umfeld.includes("window.openEinstellungenApp('erweiterung')"),
    'Der Verweis führt nicht zur Seite mit dem Plugin-Download.');
  assert.ok(umfeld.includes('Aufgaben-Feed'), 'Die plugin-freie Alternative (CalDAV-Feed) fehlt im Wegweiser.');
  assert.ok(!umfeld.includes("showAddCalendarForm('super"),
    'Super Productivity darf keine Server-Verbindung vortäuschen.');
});

test('Lokal-Modus: der Reiter „Bürostammdaten" zeichnet in den Bereich, aus dem er gerufen wurde', () => {
  /* Nutzerfund 30.08.2026: Der Reiter wurde aktiv, blieb aber ohne Inhalt - ldOfficeRenderBody
     schrieb fest in #adminSettingsModeBody, den Bereich des ANDEREN Einstiegs. */
  assert.match(html, /if\(tab==='office'\)\{\s*\n\s*ldOfficeHost=body;/,
    'Der aufrufende Bereich wird nicht gemerkt.');
  assert.match(html, /const body=\(ldOfficeHost&&ldOfficeHost\.isConnected\)\?ldOfficeHost:document\.getElementById\('adminSettingsModeBody'\);/,
    'Der Renderer nutzt weiterhin nur den festen Bereich - der Reiter bliebe leer.');
  /* Der alte Einstieg muss weiter funktionieren: Fallback auf den Standardbereich. */
  assert.ok(html.includes("document.getElementById('adminSettingsModeBody')"),
    'Der Rückfall auf den Umschalter-Bereich fehlt.');
});
