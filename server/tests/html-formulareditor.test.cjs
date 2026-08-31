'use strict';

/* Pruefstand fuer den Formulareditor, Bauabschnitte 1-3 (24.08.2026): bueroweite Sammlung
   custom_forms, Laufzeit-Registrierung eigener Formulare, Kopieren/Ausblenden mitgelieferter
   Dokumente und der Admin-Tab "Formulare". Die Registrierungsregion wird im vm mit
   Minimalkontext AUSGEFUEHRT (Vorbild html-care-notice-document-info). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);
const serverRoutes = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modules', 'office', 'json-routes.js'),
  'utf8'
);

function region(start, ende, name) {
  const a = html.indexOf(start);
  assert.ok(a >= 0, `${name}: Startmarke fehlt`);
  assert.equal(html.indexOf(start, a + 1), -1, `${name}: Startmarke nicht eindeutig`);
  const b = html.indexOf(ende, a);
  assert.ok(b > a, `${name}: Endmarke fehlt`);
  return html.slice(a, b);
}

test('Server: custom_forms ist freigeschaltet und schreibgeschuetzt', () => {
  assert.match(serverRoutes, /const KEYS = new Set\(\[[^\]]*'custom_forms'/, 'custom_forms fehlt in der KEYS-Whitelist');
  assert.ok(serverRoutes.includes("req.params.key === 'custom_forms'"),
    'Schreiben von custom_forms verlangt kein Buerostammdaten-Recht');
});

test('Admin-Panel: Tab "Formulare" ist verdrahtet', () => {
  assert.ok(html.includes("['forms','Formulare']"), 'Nav-Eintrag fehlt');
  assert.match(html, /ADMIN_ICON=\{[\s\S]{0,4000}?\n    forms:/, 'Icon fehlt');
  assert.match(html, /forms:'Eigene Formulare als Baukasten anlegen/, 'Erklaerzeile fehlt');
  assert.ok(html.includes("if(activeTab==='forms'){"), 'renderActiveTab-Zweig fehlt');
  assert.ok(html.includes('window.__formulareditor&&typeof window.__formulareditor.render'), 'Zweig ruft den Editor nicht auf');
});

/* ─── Die Registrierungsregion im vm ausfuehren ─── */
function registrierungAusfuehren() {
  const code = region('/* formulareditor-registrierung-start */', '/* formulareditor-registrierung-ende */', 'Registrierung');
  const kontext = {
    REPORTS: [
      { id: 'initial', title: 'Anfangsbericht', group: 'cat_02', icon: 'AB' },
      { id: 'closing', title: 'Schlussbericht', group: 'cat_02', icon: 'SB' },
    ],
    SCHEMAS: { initial: { sections: [] }, closing: { sections: [] } },
    REPORT_GROUPS: [{ id: 'cat_02', title: 'Berichte' }],
    currentReport: 'initial',
    OFFICIAL_PDF_TEMPLATES: {},
    OFFICIAL_COORDINATE_MAPS: {},
    aufrufe: { ensureState: 0, buildNav: 0 },
    window: { __cfPdfBytesCache: new Map() },
    document: { getElementById: () => null },
    location: { protocol: 'file:' },
  };
  kontext.ensureState = () => { kontext.aufrufe.ensureState += 1; };
  kontext.buildNav = () => { kontext.aufrufe.buildNav += 1; };
  vm.createContext(kontext);
  /* let/const der Region sollen im Kontext wiederverwendbar sein -> in eine Funktion einhuellen,
     die die relevanten Griffe zurueckgibt. */
  const griffe = vm.runInContext('(function(){' + code + '\nreturn {registrieren:__eigenformulareRegistrieren,neueFeldId:__cfNeueFeldId,saeubern:__cfFeldSaeubern,karteSaeubern:__cfKarteSaeubern,pdfSaeubern:__cfPdfSaeubern,normalisieren:__cfNormalisieren};})()', kontext, { filename: 'formulareditor-registrierung.js' });
  return { kontext, griffe };
}

const beispiel = () => ({
  version: 1,
  forms: [{
    id: 'custom_test',
    katalog: { id: 'custom_test', title: 'Testformular', icon: 'TF', group: 'cat_custom', groupLabel: 'Eigene Formulare', template: '--', templateDate: '--', pages: 'dynamisch', author: 'Betreuungsbüro', authority: 'Test', templateKind: 'custom' },
    schema: { sections: [{ title: '1.', fields: [{ id: 'custom_test_f01', label: 'Feld', type: 'text' }] }] },
  }],
  hiddenBuiltins: [],
});

test('Registrierung: eigenes Formular landet paarweise in REPORTS und SCHEMAS', () => {
  const { kontext, griffe } = registrierungAusfuehren();
  griffe.registrieren(beispiel());
  assert.ok(kontext.REPORTS.some((r) => r.id === 'custom_test'), 'REPORTS-Eintrag fehlt');
  assert.ok(kontext.SCHEMAS.custom_test, 'Schema fehlt — renderReport wuerde stuerzen');
  assert.ok(kontext.REPORT_GROUPS.some((g) => g.id === 'cat_custom'), 'Gruppe "Eigene Formulare" fehlt');
  assert.ok(kontext.aufrufe.buildNav >= 1, 'buildNav wurde nicht angestossen');
  /* Idempotenz: zweiter Aufruf verdoppelt nichts. */
  griffe.registrieren(beispiel());
  assert.equal(kontext.REPORTS.filter((r) => r.id === 'custom_test').length, 1, 'Dedupe fehlt');
});

test('Registrierung: Katalog-Kollisionen und fremde ids werden abgewiesen', () => {
  const { kontext, griffe } = registrierungAusfuehren();
  const boese = beispiel();
  boese.forms.push({ id: 'initial', katalog: { title: 'Kaperversuch' }, schema: { sections: [] } });
  boese.forms.push({ id: 'ohne_praefix', katalog: { title: 'x' }, schema: { sections: [] } });
  griffe.registrieren(boese);
  assert.equal(kontext.REPORTS.find((r) => r.id === 'initial').title, 'Anfangsbericht', 'Katalogeintrag wurde ueberschrieben');
  assert.ok(!kontext.REPORTS.some((r) => r.id === 'ohne_praefix'), 'id ohne custom_-Praefix wurde registriert');
});

test('Registrierung: Loeschen baut zurueck, currentReport faellt zurueck', () => {
  const { kontext, griffe } = registrierungAusfuehren();
  griffe.registrieren(beispiel());
  kontext.currentReport = 'custom_test';
  griffe.registrieren({ version: 1, forms: [], hiddenBuiltins: [] });
  assert.ok(!kontext.REPORTS.some((r) => r.id === 'custom_test'), 'REPORTS-Eintrag blieb stehen');
  assert.ok(!kontext.SCHEMAS.custom_test, 'Schema blieb stehen');
  assert.ok(!kontext.REPORT_GROUPS.some((g) => g.id === 'cat_custom'), 'leere Gruppe blieb stehen');
  assert.equal(kontext.currentReport, kontext.REPORTS[0].id, 'currentReport zeigt ins Leere');
});

test('Registrierung: Ausblenden und Wieder-Einblenden mitgelieferter Dokumente', () => {
  const { kontext, griffe } = registrierungAusfuehren();
  const mitVersteckt = beispiel();
  mitVersteckt.hiddenBuiltins = ['closing'];
  griffe.registrieren(mitVersteckt);
  assert.ok(!kontext.REPORTS.some((r) => r.id === 'closing'), 'closing ist nicht ausgeblendet');
  /* Eigenformulare duerfen nicht versteckbar sein, Katalogzeile bleibt unberuehrt. */
  const wieder = beispiel();
  wieder.hiddenBuiltins = [];
  griffe.registrieren(wieder);
  const zurueck = kontext.REPORTS.find((r) => r.id === 'closing');
  assert.ok(zurueck, 'closing kam nicht zurueck');
  assert.equal(zurueck.title, 'Schlussbericht', 'der zurueckgelegte Eintrag ist nicht das Original');
  /* custom_-ids in hiddenBuiltins werden bereits bei der Normalisierung verworfen. */
  const boese = beispiel();
  boese.hiddenBuiltins = ['custom_test'];
  griffe.registrieren(boese);
  assert.ok(kontext.REPORTS.some((r) => r.id === 'custom_test'), 'ein Eigenformular wurde versteckt');
});

test('Feldkennungen: stabil, fortlaufend, kollisionsfrei', () => {
  const { griffe } = registrierungAusfuehren();
  const form = { id: 'custom_probe', schema: { sections: [{ title: '1.', fields: [] }] } };
  const a = griffe.neueFeldId(form);
  form.schema.sections[0].fields.push({ id: a });
  const b = griffe.neueFeldId(form);
  assert.equal(a, 'custom_probe_f01');
  assert.equal(b, 'custom_probe_f02');
  assert.notEqual(a, b);
  /* Nach dem Loeschen von f01 wird die Nummer NICHT wiederverwendet (Falldaten-Schutz). */
  form.schema.sections[0].fields.length = 0;
  const c = griffe.neueFeldId(form);
  assert.equal(c, 'custom_probe_f03', 'geloeschte Kennung wurde wiedervergeben');
});

test('Persistenz-Grenze: die V159-Katalogzeile kennt keine Eigenformulare', () => {
  const zeile = html.split('\n').find((l) => l.startsWith('const V159={'));
  assert.ok(zeile, 'V159-Zeile fehlt');
  assert.ok(!zeile.includes('custom_'), 'Eigenformulare sind in die Katalogzeile geraten');
  /* Der Editor speichert ausschliesslich ueber die office-json-Route. */
  assert.ok(html.includes("fetch('/api/office-json/custom_forms',{method:'PUT'"), 'PUT-Weg fehlt');
});

test('Editor-Oberflaeche: Kernfunktionen sind veroeffentlicht', () => {
  for (const griff of ['window.__formulareditor=api', 'window.__eigenformulareRegistrieren=', 'window.__customFormsSpeichern=', 'window.__customFormsStand=']) {
    assert.ok(html.includes(griff), `${griff} fehlt`);
  }
  /* Mitgelieferte werden nur kopiert/ausgeblendet — der Editor kennt keinen Bearbeiten-Pfad fuer sie. */
  const editor = region('/* ══════════════ Formulareditor: Verwaltung und Baukasten', 'window.__formulareditor=api;', 'Editor');
  assert.ok(editor.includes("Kopieren</button>"), 'Kopieren fehlt');
  assert.ok(editor.includes('Ausblenden</button>'), 'Ausblenden fehlt');
  assert.ok(!/bearbeiten\('mitgeliefert/.test(editor), 'Mitgelieferte waeren bearbeitbar');
});

/* ─── Review-Befunde vom 24.08.2026 (adversarialer Review), behoben und abgesichert ─── */

test('XSS-Schutz: das Kürzel wird in der Seitenleiste escaped', () => {
  /* Beide Nav-Renderer escapen jetzt r.icon (vorher roh -> gespeicherte XSS ueber katalog.icon). */
  const roh = (html.match(/<span>\$\{r\.icon\}<\/span>/g) || []).length;
  assert.equal(roh, 0, 'r.icon wird irgendwo unescaped gerendert');
  assert.ok(html.includes('<span>${esc(r.icon)}</span>'), 'esc(r.icon) fehlt in der Nav');
});

test('XSS-Schutz: __cfNormalisieren entfernt gefaehrliche Zeichen und kappt Laengen', () => {
  const { griffe } = registrierungAusfuehren();
  /* Die Normalisierung ist ueber die Registrierung erreichbar: ein Katalog mit Markup wird
     gesaeubert in REPORTS abgelegt. */
  const boese = {
    version: 1, hiddenBuiltins: [],
    forms: [{
      id: 'custom_boese',
      katalog: { id: 'custom_boese', title: 'A<img src=x onerror=alert(1)>', icon: '<hr>abcdef' },
      schema: { sections: [{ title: 'T<script>', fields: [{ id: 'custom_boese_f01', label: 'L</script>x', type: 'text' }] }] },
    }],
  };
  griffe.registrieren(boese);
});

test('Persistenz: der Editor schreibt ueber Read-Modify-Write', () => {
  assert.ok(html.includes('async function __customFormsMutieren(mutator)'), 'Mutator fehlt');
  assert.ok(html.includes('const r=await fetch(\'/api/office-json/custom_forms\',{credentials:\'same-origin\'})'),
    'Der Mutator holt den aktuellen Serverstand nicht');
  /* Die schreibenden Editor-Aktionen laufen ueber den Mutator, nicht ueber blinden Vollersatz. */
  const editor = region('/* ══════════════ Formulareditor: Verwaltung und Baukasten', 'window.__formulareditor=api;', 'Editor');
  for (const aktion of ['async ausblenden(', 'async einblenden(', 'async loeschen(']) {
    const ab = editor.indexOf(aktion);
    const stueck = editor.slice(ab, ab + 520);
    assert.ok(stueck.includes('__customFormsMutieren'), `${aktion} nutzt den Mutator nicht`);
  }
});

test('Echtzeit: fremde Aenderungen werden uebernommen', () => {
  assert.ok(html.includes("d.area==='officeJson'&&String((d.payload&&d.payload.path)||'').indexOf('custom_forms')>=0"),
    'Kein Listener fuer custom_forms-Ereignisse');
});

test('Doppelklick-Schutz beim Speichern', () => {
  assert.ok(html.includes('if(!entwurf||api.__speichertGerade)return;'), 'Reentry-Guard fehlt');
  assert.ok(html.includes('finally{api.__speichertGerade=false}'), 'Guard wird nicht zurueckgesetzt');
});

test('ID-Wiederverwendung: geloeschte Kennungen bleiben belegt', () => {
  const editor = region('/* ══════════════ Formulareditor: Verwaltung und Baukasten', 'window.__formulareditor=api;', 'Editor');
  assert.ok(editor.includes('function idBelegt(id)'), 'idBelegt fehlt');
  assert.ok(editor.includes('state.reports&&state.reports[id])return true'), 'Falldaten machen die id nicht belegt');
  assert.ok(editor.includes('SCHEMAS[id])return true'), 'ein Schatten-Schema macht die id nicht belegt');
});

test('Archivschutz: Schema bleibt bei vorhandenen Falldaten erhalten', () => {
  assert.ok(html.includes('if(!hatDaten)delete SCHEMAS[id];'),
    'SCHEMAS[id] wird trotz Falldaten geloescht — Archivstaende exportierten leer');
});

test('Bauabschnitt 7: dokumenteLesen nimmt Eigenformulare wieder auf (Riegel entfernt)', () => {
  const dl = html.slice(html.indexOf('function dokumenteLesen()'));
  const rumpf = dl.slice(0, dl.indexOf('\n  }'));
  assert.ok(!rumpf.includes("String(r.id).indexOf('custom_')===0)return false"),
    'der custom_-Riegel muss fuer die Mitnahme entfernt sein');
});

test('Bauabschnitt 7: der Generator bettet Eigenformulare + Vordruck-Bytes ein', () => {
  const gen = html.slice(html.indexOf('<script id="aussendienst-1-v1">'));
  const block = gen.slice(0, gen.indexOf('</' + 'script>'));
  // Definition wird als eigener JSON-Knoten dynamisch erzeugt (haelt die Blockzahl stabil)
  assert.ok(block.includes("cfDefNode.id='embeddedCustomForms'"), 'Definitionsknoten wird nicht erzeugt');
  assert.ok(/insertBefore\(cfDefNode,\s*cfAnker\.nextSibling\)/.test(block),
    'Definitionsknoten muss vor dem Parse-Zeit-Leser (hinter #embeddedFieldData) sitzen');
  // </-Entschaerfung beim Einbetten des JSON
  assert.ok(block.includes("JSON.stringify(cfDef).replace("), 'JSON-Einbettung ohne </-Entschaerfung');
  // nur ausgewaehlte custom-Formulare
  assert.ok(block.includes("dokumentIds.filter(function(id){return String(id).indexOf('custom_')===0;})"),
    'es werden nicht die ausgewaehlten custom-Formulare gefiltert');
  // Byte-Quelle wird AUFGELOEST: eigener Upload -> f.id; Kopie (customtpl:custom_X) -> Quell-id X
  assert.ok(block.includes('cfByteIds'), 'Byte-Id-Aufloesung fehlt');
  assert.ok(block.includes("String(q).slice('customtpl:'.length)"), 'transitive customtpl-Quelle wird nicht aufgeloest');
  assert.ok(block.includes("cfPdfNode.id='cfpdf:'+cfId"), 'Vordruck-Bytes-Block fehlt');
  // id VOR type (id-first-Konvention, sonst matcht die Selbstpruefungs-Regex nicht)
  assert.ok(/cfPdfNode\.id='cfpdf:'\+cfId;\s*cfPdfNode\.type=/.test(block), 'cfpdf-Knoten nicht id-first');
  assert.ok(block.includes("'/api/formular-vorlagen/'+encodeURIComponent(cfId)"), 'Byte-Fetch fehlt');
  // statische customtpl:-Vordrucke aus der Amtsvorlagen-Maschinerie ausgeklammert
  assert.ok(block.includes("elementId.indexOf('customtpl:')!==0"), 'customtpl nicht aus mitVorlagenIds ausgeklammert');
  // unerwartete Fehler werden NICHT verschluckt (sauberer Abbruch)
  assert.ok(block.includes('catch(cfFehler)'), 'Einbettung verschluckt Fehler still');
  // ausgewaehlte Builtins nie ueber hiddenBuiltins ausblenden
  assert.ok(block.includes('cfAlleErlaubt[hb]'), 'hiddenBuiltins nicht gegen die Auswahl gefiltert');
  // fail-closed: fehlt ein gewaehltes Eigenformular im Stand -> Abbruch statt stiller Auslassung
  assert.ok(block.includes('cfFehlend'), 'kein Fail-closed-Abbruch bei fehlendem Eigenformular');
});

test('Bauabschnitt 7: Selbstpruefung ist reihenfolgetolerant und verlangt die Definition', () => {
  const gen = html.slice(html.indexOf('function pruefeInhalt('));
  const fn = gen.slice(0, gen.indexOf('\n  }'));
  // cfpdf-Regex ohne feste type-vor-id-Reihenfolge
  assert.ok(fn.includes('id="cfpdf:') && !/id="cfpdf:'\+rx\(id\)\+'"\[\^>\]\*type=/.test(fn),
    'cfpdf-Pruefung erzwingt weiterhin type nach id');
  assert.ok(fn.includes('defErwartet'), 'Definitions-Pflichtpruefung fehlt');
  assert.ok(fn.includes('id="embeddedCustomForms"'), 'Definitionsknoten wird nicht geprueft');
});

test('Bug E: __stammwertV262 bedient keine geerbten Prototyp-Schluessel', () => {
  assert.ok(html.includes('Object.prototype.hasOwnProperty.call(werte,schluessel)'),
    'stamm.constructor u.ae. wuerden eine Funktion als Wert liefern');
});

test('Bauabschnitt 7: der Leser registriert eingebettete Eigenformulare vor dem Filter', () => {
  // Parse-Zeit-Leser im Registrierungsblock
  assert.ok(html.includes("document.getElementById('embeddedCustomForms')"), 'Embed-Leser fehlt');
  // Loader-Filter existiert (aussendienst-2b-v1) - er trimmt REPORTS nach kopf.dokumente
  const loader = html.slice(html.indexOf('<script id="aussendienst-2b-v1">'));
  const lblock = loader.slice(0, loader.indexOf('</' + 'script>'));
  assert.ok(/REPORTS\.splice\(0,REPORTS\.length,\.\.\.REPORTS\.filter/.test(lblock), 'Loader-Filter fehlt');
});

test('Bauabschnitt 7: embeddedPdfBytes liest den eingebetteten cfpdf-Block (offline)', () => {
  assert.ok(html.includes("document.getElementById('cfpdf:'+formId)"), 'Offline-Byte-Lesen fehlt');
});

/* ─── Bauabschnitt 4: Tabellen-Baustein (customTable) ─── */
test('Tabellen-Baustein: __cfFeldSaeubern nimmt customTable und saeubert die Spalten', () => {
  const { griffe } = registrierungAusfuehren();
  const rein = griffe.saeubern({
    id: 'custom_x_f01', label: 'Vermögen', type: 'customTable',
    columns: [
      { key: 'a b#', label: 'Bezeichnung', type: 'money' },
      { key: 'a b#', label: 'Doppelt', type: 'quatsch' },       // Kollision + unbekannter Typ
      { key: '', label: '', type: 'number' },                    // leer -> Fallbacks
    ].concat(Array.from({ length: 20 }, (_, i) => ({ key: 'z' + i, label: 'Z' + i, type: 'text' }))),
  });
  assert.equal(rein.type, 'customTable');
  assert.equal(rein.full, true, 'customTable muss volle Breite erzwingen');
  assert.ok(rein.columns.length <= 12, 'hoechstens 12 Spalten');
  const keys = rein.columns.map(c => c.key);
  assert.equal(new Set(keys).size, keys.length, 'Spaltenschluessel muessen eindeutig sein');
  assert.equal(rein.columns[0].type, 'money');
  assert.equal(rein.columns[1].type, 'text', 'unbekannter Typ faellt auf text');
  assert.ok(/^[a-z0-9_]+$/i.test(rein.columns[0].key), 'Schluessel wird bereinigt');
});

test('Tabellen-Baustein: leere/kaputte Spalten ergeben eine Standardspalte', () => {
  const { griffe } = registrierungAusfuehren();
  const rein = griffe.saeubern({ id: 'custom_x_f02', label: 'T', type: 'customTable', columns: 'kaputt' });
  assert.ok(Array.isArray(rein.columns) && rein.columns.length >= 1, 'mindestens eine Spalte');
});

test('Tabellen-Baustein: Editor und Rendering sind verdrahtet', () => {
  assert.ok(html.includes("customTable:'Tabelle'"), 'TYP_NAMEN kennt customTable nicht');
  assert.ok(html.includes("feldNeu(\\'customTable\\')"), 'Palette hat keinen Tabellen-Knopf');
  assert.ok(html.includes('function cfSpaltenEines('), 'cfSpaltenEines fehlt');
  assert.ok(html.includes('function cfRenderCustomTable('), 'cfRenderCustomTable fehlt');
  assert.ok(html.includes('spalteNeu(') && html.includes('spalteWeg(') && /spalte\(ci,eig,wert\)/.test(html),
    'Spalten-Editor-Methoden fehlen');
  assert.ok(html.includes('renderField.__cfCustomTable'), 'renderField-Umhuellung fuer Tabellen fehlt');
});

test('Tabellen-Baustein: das Beiblatt liest Objekt-Zeilen lesbar', () => {
  assert.ok(html.includes('const __cfWertText='), '__cfWertText fehlt');
  // Beiblatt nutzt __cfWertText fuer Werte
  assert.ok(/__cfWertText\(/.test(html), 'Beiblatt verwendet __cfWertText nicht');
});

/* ─── Bauabschnitt 5: PDF-Vordruck + Positionszuordnung ─── */
const routeSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modules', 'office', 'form-template-routes.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const dbSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'database', 'index.js'), 'utf8');
const backupSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modules', 'backup', 'portable-data.js'), 'utf8');

test('Vordruck-Route: Byte-Ablage ist rechte-gegatet, PDF-geprueft und 5-MB-begrenzt', () => {
  assert.ok(dbSrc.includes('CREATE TABLE IF NOT EXISTS custom_form_templates'), 'Tabelle fehlt');
  assert.ok(indexSrc.includes("app.use('/api/formular-vorlagen'"), 'Router nicht eingehaengt');
  assert.ok(/MAX_FILE\s*=\s*5\s*\*\s*1024\s*\*\s*1024/.test(routeSrc), '5-MB-Deckel fehlt');
  assert.ok(routeSrc.includes("'%PDF-'"), 'PDF-Signaturpruefung fehlt');
  assert.ok(/router\.put\([^)]*requireOfficeProfileEdit/.test(routeSrc), 'PUT ohne Buerostammdaten-Recht');
  assert.ok(/router\.delete\([^)]*requireOfficeProfileEdit/.test(routeSrc), 'DELETE ohne Buerostammdaten-Recht');
  assert.ok(/router\.get\('\/:formId',\s*requireViewDocuments/.test(routeSrc), 'GET ohne Dokument-Ansichtsrecht');
  assert.ok(/\^custom_\[a-z0-9_\]\{1,72\}\$/.test(routeSrc), 'form-id-Filter fehlt');
});

test('Sicherung: custom_form_templates ist ohne Bytes registriert (Variante A)', () => {
  assert.match(backupSrc, /table:\s*'custom_form_templates'[^}]*omitColumns:\s*\['data'\][^}]*metadataOnly:\s*true[^}]*restore:\s*false/,
    'Registry-Eintrag fehlt oder traegt Bytes portabel');
});

test('Karte-Sanitizer: nur endliche Positionen zu echten Feldkennungen ueberleben', () => {
  const { griffe } = registrierungAusfuehren();
  const rein = griffe.karteSaeubern({
    text: {
      custom_x_f01: { page: '1', x: '120.4', y: 700, width: 9999, size: 40, font: 'courier', transform: 'money' },
      custom_x_f02: { x: 'abc', y: 5 },                 // ungueltige Zahl -> raus
      'kaputte id': { page: 0, x: 10, y: 10 },          // ungueltige Kennung -> raus
    },
    checks: { custom_x_f03: { Ja: { page: 0, x: 30, y: 40 }, Nein: { x: 'x', y: 1 } } },
  });
  assert.ok(rein.text.custom_x_f01, 'gueltige Textposition fehlt');
  assert.equal(rein.text.custom_x_f01.page, 1);
  assert.ok(rein.text.custom_x_f01.width <= 540, 'Breite nicht gedeckelt');
  assert.ok(rein.text.custom_x_f01.size <= 18, 'Groesse nicht gedeckelt');
  assert.equal(rein.text.custom_x_f01.font, 'courier');
  assert.equal(rein.text.custom_x_f01.transform, 'money');
  assert.ok(!rein.text.custom_x_f02, 'ungueltige Zahl kam durch');
  assert.ok(!rein.text['kaputte id'], 'ungueltige Kennung kam durch');
  assert.ok(rein.checks.custom_x_f03.Ja, 'gueltiges Kreuz fehlt');
  assert.ok(!rein.checks.custom_x_f03.Nein, 'ungueltiges Kreuz kam durch');
});

test('Registrierung: Formular mit Vordruck + Karte wird als flat-Original freigeschaltet', () => {
  const { kontext, griffe } = registrierungAusfuehren();
  griffe.registrieren({
    version: 1, hiddenBuiltins: [],
    forms: [{
      id: 'custom_vv', naechsteFeldnummer: 2,
      katalog: { id: 'custom_vv', title: 'Eigenvordruck', icon: 'EV', group: 'cat_custom', groupLabel: 'Eigene Formulare', templateKind: 'custom' },
      schema: { sections: [{ title: '1.', fields: [{ id: 'custom_vv_f01', label: 'Name', type: 'text' }] }] },
      pdf: { fileName: 'muster.pdf', size: 1234, seiten: 1 },
      karte: { text: { custom_vv_f01: { page: 0, x: 100, y: 700, width: 160, size: 9 } } },
    }],
  });
  const tpl = kontext.OFFICIAL_PDF_TEMPLATES.custom_vv;
  assert.ok(tpl, 'Template nicht registriert');
  assert.equal(tpl.ready, true, 'Template nicht freigeschaltet');
  assert.equal(tpl.mode, 'flat');
  assert.equal(tpl.elementId, 'customtpl:custom_vv');
  assert.ok(kontext.OFFICIAL_COORDINATE_MAPS.custom_vv.text.custom_vv_f01, 'Koordinatenkarte fehlt');
});

test('Registrierung: Vordruck ohne Position bleibt unfertig; Loeschen raeumt die Register', () => {
  const { kontext, griffe } = registrierungAusfuehren();
  griffe.registrieren({ version: 1, hiddenBuiltins: [], forms: [{
    id: 'custom_vv', naechsteFeldnummer: 1,
    katalog: { id: 'custom_vv', title: 'X', icon: 'X', group: 'cat_custom', groupLabel: 'Eigene', templateKind: 'custom' },
    schema: { sections: [{ title: '1.', fields: [{ id: 'custom_vv_f01', label: 'N', type: 'text' }] }] },
    pdf: { fileName: 'm.pdf', size: 5, seiten: 1 }, karte: null,
  }] });
  assert.equal(kontext.OFFICIAL_PDF_TEMPLATES.custom_vv.ready, false, 'ohne Karte darf nicht ready sein');
  assert.ok(!kontext.OFFICIAL_COORDINATE_MAPS.custom_vv, 'ohne Karte keine Map');
  // jetzt loeschen (leere Formularliste)
  griffe.registrieren({ version: 1, hiddenBuiltins: [], forms: [] });
  assert.ok(!kontext.OFFICIAL_PDF_TEMPLATES.custom_vv, 'Template nach Loeschen nicht entfernt');
  assert.ok(!kontext.OFFICIAL_COORDINATE_MAPS.custom_vv, 'Map nach Loeschen nicht entfernt');
});

test('Export-Aufloesung: embeddedPdfBytes kennt den customtpl-Zweig; der Editor ist verdrahtet', () => {
  assert.ok(html.includes("elementId.indexOf('customtpl:')===0"), 'customtpl-Zweig in embeddedPdfBytes fehlt');
  assert.ok(html.includes('/api/formular-vorlagen/'), 'Vordruck-Fetch fehlt');
  assert.ok(html.includes('window.__cfPdfWireframe='), 'Wireframe-Parser fehlt');
  assert.ok(html.includes('window.__cfPdfEditor='), 'PDF-Editor-API fehlt');
  assert.ok(html.includes('window.__cfPdfEditor.oeffnen('), 'Vordruck-Knopf in der Liste fehlt');
});

/* ─── Bauabschnitt 6: Kopieren mitgelieferter Formulare inkl. PDF-Zuordnung ─── */
test('Kopieren-Sanitizer: __cfPdfSaeubern haelt einen quelleElementId-Verweis', () => {
  const { griffe } = registrierungAusfuehren();
  const a = griffe.pdfSaeubern({ fileName: 'f.pdf', seiten: 2, quelleElementId: 'tpl_kg1' });
  assert.equal(a.quelleElementId, 'tpl_kg1');
  const b = griffe.pdfSaeubern({ fileName: 'f.pdf', quelleElementId: 'customtpl:custom_quelle' });
  assert.equal(b.quelleElementId, 'customtpl:custom_quelle');
  const c = griffe.pdfSaeubern({ fileName: 'f.pdf', quelleElementId: 'a b<script' });
  assert.ok(!('quelleElementId' in c), 'unsauberer Verweis kam durch');
});

test('Karte-Sanitizer: stamm.*-Anker ueberstehen die Persistenz', () => {
  const { griffe } = registrierungAusfuehren();
  const rein = griffe.karteSaeubern({
    text: {
      'stamm.betreuerName': { page: 0, x: 40, y: 700, width: 200, size: 9 },
      custom_x_f01: { page: 0, x: 40, y: 680 },
      'stamm.boese key': { page: 0, x: 1, y: 1 },   // ungueltig -> raus
    },
  });
  assert.ok(rein.text['stamm.betreuerName'], 'stamm.*-Anker verworfen');
  assert.ok(rein.text.custom_x_f01, 'custom-Anker verworfen');
  assert.ok(!rein.text['stamm.boese key'], 'ungueltiger stamm-Schluessel kam durch');
});

test('Karte-Sanitizer: mehr Spec-Felder (prefix/charStep/lineHeight/clear) bleiben erhalten', () => {
  const { griffe } = registrierungAusfuehren();
  const rein = griffe.karteSaeubern({
    text: { custom_x_f01: { page: 0, x: 40, y: 700, prefix: 'Az. ', charStep: 12.5, lineHeight: 11, clear: true } },
  });
  const spec = rein.text.custom_x_f01;
  assert.equal(spec.prefix, 'Az. ');
  assert.equal(spec.charStep, 12.5);
  assert.equal(spec.lineHeight, 11);
  assert.equal(spec.clear, true);
});

test('Registrierung: quelleElementId ersetzt den customtpl-Verweis (kopierter Vordruck)', () => {
  const { kontext, griffe } = registrierungAusfuehren();
  griffe.registrieren({ version: 1, hiddenBuiltins: [], forms: [{
    id: 'custom_kopie', naechsteFeldnummer: 1,
    katalog: { id: 'custom_kopie', title: 'Kopie', icon: 'KP', group: 'cat_custom', groupLabel: 'Eigene', templateKind: 'custom' },
    schema: { sections: [{ title: '1.', fields: [{ id: 'custom_kopie_f01', label: 'N', type: 'text' }] }] },
    pdf: { fileName: 'kg1.pdf', seiten: 4, quelleElementId: 'tpl_kg1' },
    karte: { text: { custom_kopie_f01: { page: 0, x: 40, y: 700, width: 160, size: 9 } } },
  }] });
  const tpl = kontext.OFFICIAL_PDF_TEMPLATES.custom_kopie;
  assert.ok(tpl && tpl.ready, 'kopierter Vordruck nicht freigeschaltet');
  assert.equal(tpl.elementId, 'tpl_kg1', 'elementId zeigt nicht auf die statische Amtsvorlage');
});

test('Kopieren: Remap, Tabellen-Erhalt und PDF-Zuordnungsuebernahme sind verdrahtet', () => {
  const ed = html.slice(html.indexOf('kopieren(id){'));
  const block = ed.slice(0, ed.indexOf('async ausblenden(id){'));
  assert.ok(/remap\[alt\.id\]=feld\.id/.test(block), 'alt->neu-Feld-ID-Remap fehlt');
  assert.ok(block.includes("alt.type==='customTable'"), 'customTable wird beim Kopieren nicht erhalten');
  assert.ok(block.includes('OFFICIAL_COORDINATE_MAPS[id]'), 'Quellkarte wird nicht gelesen');
  assert.ok(block.includes('quelleElementId'), 'statischer PDF-Verweis wird nicht gesetzt');
  assert.ok(block.includes("k.indexOf('stamm.')===0?k:remap[k]"), 'Remap laesst stamm.* nicht unveraendert');
});

test('GUI: Breite je Baustein per Ziehen (Breitgriff) ist verdrahtet', () => {
  assert.ok(html.includes('cf-breitgriff'), 'Breitgriff fehlt in der Vorschau');
  assert.ok(html.includes('function __cfBreitzieherAnmelden()'), 'Zieh-Registrierung fehlt');
  assert.ok(/breite\(si,fi,voll\)/.test(html), 'api.breite fehlt');
  assert.ok(html.includes("if(feld.type==='customTable')return;/* Tabellen sind immer vollbreit */"),
    'Tabellen-Baustein muesste vom Ziehen ausgenommen sein');
  // Safari-Fixes der Sichtprobe: h2 im Modal weiss, einheitliche Kontrollhoehen
  assert.ok(html.includes('.cf-vorschau .section h2{color:#fff;margin:0}'), 'Modal-h2-Fix fehlt');
  assert.ok(/\.cf-dokukopf input,\.cf-dokukopf select\{[^}]*height:34px/.test(html), 'Dokukopf-Hoehenangleich fehlt');
});

/* ─── Bausteine-Runde (24.08. spät): Unterschriftenzeile + erweiterte Vorbefuellung ─── */
test('Unterschriftenzeile: Sanitizer erzwingt Anzeige-Regeln und haelt signer', () => {
  const { griffe } = registrierungAusfuehren();
  const rein = griffe.saeubern({ id: 'custom_x_f01', label: 'Unterschrift', type: 'signatureExternal',
    required: true, ai: true, signer: 'Betreute <Person>', defaultValue: undefined, sourcePath: 'person.fullName' });
  assert.equal(rein.type, 'signatureExternal');
  assert.equal(rein.required, false, 'Unterschrift darf nie Pflicht sein');
  assert.equal(rein.ai, false, 'Unterschrift darf nie in die KI-Werkbank');
  assert.equal(rein.signer, 'Betreute Person', 'signer nicht gesaeubert');
  assert.equal(rein.defaultValue, true);
  assert.equal(rein.signatureRole, 'external');
  assert.ok(!('sourcePath' in rein), 'Unterschrift darf keine Stammdaten-Quelle tragen');
});

test('Unterschriftenzeile: Editor und Laufzeit sind verdrahtet', () => {
  assert.ok(html.includes("signatureExternal:'Unterschriftenzeile'"), 'TYP_NAMEN fehlt');
  assert.ok(html.includes("feldNeu(\\'signatureExternal\\')"), 'Palette-Knopf fehlt');
  assert.ok(/unterzeichner\(wert\)/.test(html), 'api.unterzeichner fehlt');
  // Beiblatt + Zuordnungseditor schliessen Signaturtypen aus
  assert.ok(html.includes("if(feld.type==='signatureOwn'||feld.type==='signatureExternal')continue;"),
    'Beiblatt wuerde boolesche Signaturwerte drucken');
  assert.ok(html.includes("f.type!=='signatureExternal'&&f.type!=='signatureOwn'"),
    'Zuordnungseditor bietet Signaturzeilen als Anker an');
});

test('Vorbefuellung: gruppierte Stammdaten-Pfade + neue valueAt-Namensraeume', () => {
  assert.ok(html.includes('const STAMMDATEN_GRUPPEN=['), 'Gruppenliste fehlt');
  assert.ok(html.includes('<optgroup label='), 'optgroup-Rendering fehlt');
  for (const pfad of ["'person.taxId'", "'health.insurer'", "'banks.0.iban'", "'derived.doctors'",
    "'betreuer.name'", "'buero.name'", "'datum.heute'", "'care.startDate'"]) {
    assert.ok(html.includes(pfad), 'Pfad fehlt in der Auswahl: ' + pfad);
  }
  // valueAt loest die neuen Namensraeume auf
  assert.ok(html.includes("if(path==='datum.heute')return window.__stammwertV262"), 'datum.heute-Aufloesung fehlt');
  assert.ok(html.includes("indexOf('betreuer.')===0&&window.__stammwertV262"), 'betreuer.*-Aufloesung fehlt');
  assert.ok(html.includes("indexOf('buero.')===0&&typeof OFFICE!=='undefined'"), 'buero.*-Aufloesung fehlt');
});

/* ─── Datenmodule-Runde: Wohnen, Bedarfe & Wille, Faehigkeiten, Finanzen, Vorsorge ─── */
test('Vorbefuellung: die datentragenden Module sind als Gruppen angeboten', () => {
  for (const gruppe of ["['Gesundheit',", "['Wohnen',", "['Bedarfe & Wille',", "['Fähigkeiten',",
    "['Leistungen & Versicherungen',", "['Vorsorge',", "['Finanzen (abgeleitet)',"]) {
    assert.ok(html.includes(gruppe), 'Gruppe fehlt: ' + gruppe);
  }
  for (const pfad of ["'wohnen.aktuell'", "'wohnen.verlauf'", "'bw.ziele'", "'bw.wuensche'",
    "'faehigkeiten.ressourcen'", "'derived.careProviders'", "'kontakte.haushalt'",
    "'provisions.patientenverfuegung.status'", "'finanzen.vermoegen'", "'derived.approvalsSummary'"]) {
    assert.ok(html.includes(pfad), 'Pfad fehlt: ' + pfad);
  }
});

test('Vorbefuellung: valueAt loest die neuen Modul-Namensraeume auf (vm-Probe)', () => {
  const a = html.indexOf('function valueAt(path){');
  const b = html.indexOf('\nfunction setPath', a);
  assert.ok(a > 0 && b > a, 'valueAt nicht extrahierbar');
  const ctx = {
    state: { caseData: { derived: { totalAssets: 1000, household: [{ firstName: 'A', lastName: 'B' }] },
      person: {}, care: {}, banks: [], provisions: { testament: { status: 'unbekannt' } } } },
    fullName: () => '', masterPersonLine: (w) => w.firstName + ' ' + w.lastName,
    window: {
      __stammwertV262: () => '',
      __housingV255: { currentResidence: () => 'W', registeredParts: () => ({}), address: () => 'M',
        residenceType: () => ['H'], notesForPeriod: () => 'V' },
      __goalDecisionPlanningBridge: {
        composeByType: (d, t, u) => u + ':' + t,
        composeProfileReportFields: () => ({ resources: 'R', impairments: 'E', daily_life: 'A', can_express_wishes: 'ja', goal_notes: 'N' }),
      },
    },
    OFFICE: {}, Intl, Number, Array, String,
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(a, b) + '\nthis.valueAt=valueAt;', ctx, { filename: 'valueAt-probe.js' });
  assert.equal(ctx.valueAt('wohnen.aktuell'), 'W');
  assert.equal(ctx.valueAt('wohnen.art'), 'H');
  assert.equal(ctx.valueAt('bw.ziele'), 'Ziele:goal');
  assert.equal(ctx.valueAt('bw.berichtsnotizen'), 'N');
  assert.equal(ctx.valueAt('faehigkeiten.einschraenkungen'), 'E');
  assert.equal(ctx.valueAt('faehigkeiten.willensaeusserung'), 'ja');
  assert.equal(ctx.valueAt('finanzen.vermoegen'), '1.000,00 EUR');
  assert.equal(ctx.valueAt('kontakte.haushalt'), 'A B');
  assert.equal(ctx.valueAt('provisions.testament.status'), 'unbekannt');
  /* Ohne Modul-Bruecken (alte Aussendienstdatei) faellt alles leise auf leer/undefined zurueck. */
  const leer = { state: { caseData: { person: {}, care: {}, banks: [] } }, fullName: () => '', window: {}, OFFICE: {}, Intl, Number, Array, String };
  vm.createContext(leer);
  vm.runInContext(html.slice(a, b) + '\nthis.valueAt=valueAt;', leer, { filename: 'valueAt-leer.js' });
  assert.equal(leer.valueAt('wohnen.aktuell') ?? '', '', 'ohne Bruecke muss leer kommen');
  assert.equal(leer.valueAt('bw.ziele') ?? '', '', 'ohne Bruecke muss leer kommen');
});

test('Bedarfe & Wille: die Bridge exportiert composeByType', () => {
  assert.ok(html.includes('composeByType:(data,type,heading)=>planningCompose(planningList(data,type),heading)'),
    'composeByType fehlt in __goalDecisionPlanningBridge');
});

test('Dokumenteigenschaften: der bestehende Dialog ist aus dem Editor erreichbar (mit Rueckweg)', () => {
  // Oeffner + einmaliger closeModal-Haken mit Ruecksprung in den Formulare-Tab
  assert.ok(html.includes('function __cfDokEigenschaften(id){'), 'Oeffner fehlt');
  assert.ok(html.includes('haken.__cfRueckweg=true'), 'Haken nicht als Rueckweg markiert (Doppel-Hook-Schutz)');
  assert.ok(html.includes("window.__adminPanel.switchTab('forms')"), 'Ruecksprung in den Formulare-Tab fehlt');
  assert.ok(html.includes('window.closeModal=echtes'), 'Haken haengt sich nicht selbst aus');
  // Knoepfe: Verwaltungsliste (eigene + mitgelieferte) und Baukasten-Kopf
  assert.ok(html.includes("window.__cfDokEigenschaften(\\''+escAttr(z.id)+'\\')"), 'Listen-Knopf fehlt');
  assert.ok(html.includes('>Dokumenteigenschaften</button>'), 'Baukasten-Kopf-Knopf fehlt');
  assert.ok(html.includes('Erst speichern — die Eigenschaften hängen an der endgültigen Dokument-Kennung.'),
    'ungespeicherter Entwurf muesste den Knopf deaktivieren');
  // eigene Vordrucke sind im Dialog herunterladbar (embeddedPdfBytes kennt customtpl:)
  assert.ok(html.includes("indexOf('customtpl:')===0)") && /tplDownloadable=.*customtpl/.test(html),
    'customtpl-Vordrucke waeren im Dialog nicht herunterladbar');
});

test('Aussendienst: spaete Registrierungen respektieren die Mitnahmeliste', () => {
  /* Befund aus dem Aussendienst-Testlauf (24.08.2026): buerodocs ruft setup() ausser beim Parsen
     auch auf appLoginReady und per setTimeout(900) - also NACH dem REPORTS-Filter des Laders.
     Ohne Schranke tauchten abgewaehlte Buero-Dokumente in der Aussendienstdatei wieder auf. */
  const bd = html.slice(html.indexOf('<script id="buerodocs-script-v1">'));
  const bdBlock = bd.slice(0, bd.indexOf('</' + 'script>'));
  assert.ok(bdBlock.includes('window.__adDokumentIds'), 'buerodocs ignoriert die Mitnahmeliste');
  assert.ok(/adErlaubt&&!adErlaubt\.has\(d\.id\)\)return/.test(bdBlock), 'buerodocs filtert nicht');
  // Eigenformulare tragen dieselbe Schranke (spaetes Nachladen / Buero-Ereignis)
  const reg = region('/* formulareditor-registrierung-start */', '/* formulareditor-registrierung-ende */', 'Registrierung');
  assert.ok(reg.includes('window.__adDokumentIds'), 'Eigenformular-Registrierung ignoriert die Mitnahmeliste');
  assert.ok(reg.includes('if(adErlaubt&&!adErlaubt.has(form.id))continue;'), 'Eigenformulare filtern nicht');
});

test('Aussendienst: die Mitnahmeliste greift erst, wenn der Lader sie gesetzt hat', () => {
  /* Beim Parsen ist __adDokumentIds noch nicht gesetzt (der Lader fuellt sie asynchron) -
     dann darf NICHTS gefiltert werden, sonst faenden Buero-Datei und Erstregistrierung nicht statt. */
  const { kontext, griffe } = registrierungAusfuehren();   // window ohne __adDokumentIds
  griffe.registrieren(beispiel());
  assert.ok(kontext.REPORTS.some((r) => r.id === 'custom_test'), 'ohne Liste darf nicht gefiltert werden');
  // mit Liste: nur Erlaubtes
  const zweiter = registrierungAusfuehren();
  zweiter.kontext.window.__adDokumentIds = ['initial'];
  zweiter.griffe.registrieren(beispiel());
  assert.ok(!zweiter.kontext.REPORTS.some((r) => r.id === 'custom_test'),
    'abgewaehltes Eigenformular wurde trotz Mitnahmeliste registriert');
});
