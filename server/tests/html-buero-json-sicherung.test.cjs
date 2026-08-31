'use strict';

/* Pruefstand fuer die Vervollstaendigung der JSON-Sicherungswege (25.08.2026):
     - die Gesamtsicherungs-ZIP nutzt dieselbe ANGEREICHERTE Sammlung wie der Einzel-Export,
     - der lokale Buero-JSON-Export traegt die nur-lokalen Bestaende (Kontaktmonitor,
       Qualifikationen, Vorschlagslisten, Karten-Einstellungen, Stammdaten-Vorschlaege),
     - der Import spielt sie zurueck, ohne gepflegte Arbeit zu ueberschreiben,
     - die loadBueroLocal-Whitelist verwirft aiChats/caseOuttakes/fileNameStyle nicht mehr
       (der Vorbefund: Export las diese Felder, die Whitelist warf sie bei jedem Neuladen weg).

   Wie in datenschutz.test.cjs wird der Code AUS DER AUSLIEFERUNGSDATEI geschnitten und in
   einem vm-Kontext ausgefuehrt - gemessen wird die Auslieferung, kein Nachbau. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

function schnipsel(von, bis) {
  const a = html.indexOf(von);
  assert.ok(a >= 0, `Anker fehlt in der Auslieferungsdatei: ${von}`);
  const b = html.indexOf(bis, a);
  assert.ok(b > a, `Endanker fehlt hinter "${von}": ${bis}`);
  assert.equal(html.indexOf(von, a + 1), -1, `Anker ist nicht eindeutig: ${von}`);
  return html.slice(a, b);
}

/* Wegwerf-localStorage: gleiches Verhalten wie im Browser, aber pruefbar. */
function speicherStub(anfang) {
  const ablage = Object.assign({}, anfang || {});
  return {
    getItem: (k) => (k in ablage ? ablage[k] : null),
    setItem: (k, v) => { ablage[k] = String(v); },
    _roh: ablage
  };
}

/* ═══════════ 1. ZIP nutzt die angereicherte Sammlung (mit Rueckfall) ═══════════ */

test('Gesamtsicherung: die ZIP-JSON entsteht aus der ANGEREICHERTEN Sammlung', () => {
  /* Sektion exakt wie html-runtime-modes.test.cjs geschnitten - dort gilt weiterhin das
     Verbot von /api/admin/-Text; die Anreicherung darf also nur AUFGERUFEN werden. */
  const zip = schnipsel('  window.downloadAllCasesZip=async function(){', '\n\n  /* ===== Sammel-Indikator:');
  assert.ok(zip.includes("typeof window.__bueroorgCollectDataAngereichert==='function'?window.__bueroorgCollectDataAngereichert():window.__bueroorgCollectData()"),
    'Die ZIP sammelt weiterhin roh - ihre JSON bleibt hinter dem Einzel-Export zurueck');
  assert.doesNotMatch(zip, /\/api\/admin\//, 'Kein /api/admin/-Text in der ZIP-Sektion (Pin des Betriebsarten-Pruefstands)');
  assert.ok(html.includes('window.__bueroorgCollectDataAngereichert=daBueroDatenAngereichert;'),
    'Die angereicherte Sammlung ist nicht als window-Funktion veroeffentlicht');
});

/* ═══════════ 2. Lokaler Export traegt die nur-lokalen Bestaende (ausgefuehrt) ═══════════ */

function exportLokalKontext() {
  /* Der Lokal-Zweig ab den beiden neuen Vorbereitungs-Konstanten bis zur Feldliste. Der
     gepinnte Listenschwanz (datenschutz.test.cjs) wird wortgleich angehaengt, damit der
     Ausschnitt vollstaendig ausfuehrbar ist. */
  const kern = schnipsel('      const sregLokal=', 'ui_prefs:{fileNameStyle:')
    + "ui_prefs:{fileNameStyle:L.fileNameStyle||''},datenschutz:L.datenschutz||null};";
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(
    `this.sammeln=function(L,localStorage,window){const ciEntries=L.caseIntakes||[];const data={};\n${kern}\nreturn data.officeJson;};`,
    ctx, { filename: 'buero-json-export-lokal.js' }
  );
  return ctx;
}

test('Lokal-Export: Kontaktmonitor, Qualifikationen, Karten und beide Vorschlags-Bestaende wandern mit', () => {
  const ctx = exportLokalKontext();
  const L = {
    aiChats: [{ id: 'chat-1' }],
    caseOuttakes: [{ id: 'out-1' }],
    kontaktmonitor: [{ caseId: '7', turnusDays: 30 }],
    qualifikationen: { entries: { 'anna|beispiel': { qualification: 'B.A.' } } },
    mapSettings: { activeProvider: 'here', hereApiKey: 'k-1' },
    stammdatenSuggestions: { plz: ['04103'] },
    suggestionRegistry: { version: 1, fields: { sd_titel: { groups: [] } } },
    fileNameStyle: 'spaces',
    datenschutz: null
  };
  /* localStorage traegt den FUEHRENDEN Registry-Stand - er muss den Spiegel schlagen. */
  const ls = speicherStub({ bb_suggestion_registry_v1: JSON.stringify({ version: 1, fields: { km_art: { groups: [] } } }) });
  const oj = ctx.sammeln(L, ls, {});
  assert.equal(oj.ai_chats.entries[0].id, 'chat-1', 'KI-Chats fehlen im Lokal-Export');
  assert.equal(oj.case_outtakes.entries[0].id, 'out-1', 'Fallabschluss-Laeufe fehlen im Lokal-Export');
  assert.equal(oj.kontaktmonitor.entries[0].caseId, '7', 'Der Kontaktmonitor fehlt im Lokal-Export');
  assert.ok(oj.qualifikationen.entries['anna|beispiel'], 'Die Qualifikationen fehlen im Lokal-Export');
  assert.equal(oj.map_settings.hereApiKey, 'k-1', 'Die Karten-Einstellungen fehlen im Lokal-Export');
  assert.deepEqual(Array.from(oj.stammdaten_suggestions.plz), ['04103'], 'Die Stammdaten-Vorschlaege fehlen');
  assert.ok(oj.suggestion_registry.fields.km_art, 'Der localStorage-Stand der Registry muss fuehren');
  assert.equal(oj.suggestion_registry.fields.sd_titel, undefined, 'Der bueroLocal-Spiegel hat den localStorage-Stand verdraengt');
  assert.equal(oj.ui_prefs.fileNameStyle, 'spaces');
});

test('Lokal-Export: Rueckfaelle - Registry-Spiegel und Live-Kanal der Stammdaten-Vorschlaege', () => {
  const ctx = exportLokalKontext();
  const L = { suggestionRegistry: { version: 1, fields: { sd_titel: {} } }, stammdatenSuggestions: {} };
  /* Kein localStorage-Stand -> der bueroLocal-Spiegel greift; keine gepflegten
     Stammdaten-Vorschlaege -> der Live-Kanal (wie beim Aussendienst-Sammler) greift. */
  const oj = ctx.sammeln(L, speicherStub(), { __stammdatenSuggestions: { ort: ['Leipzig'] } });
  assert.ok(oj.suggestion_registry.fields.sd_titel, 'Ohne localStorage muss der bueroLocal-Spiegel exportiert werden');
  assert.deepEqual(Array.from(oj.stammdaten_suggestions.ort), ['Leipzig'], 'Der Live-Kanal wurde nicht als Rueckfall genutzt');
});

/* ═══════════ 3. Import spielt zurueck, ohne gepflegte Arbeit zu ueberschreiben ═══════════ */

function importLokalKontext() {
  const kern = schnipsel('          /* Lückenschluss 25.08.2026 (Gegenstück', '          const dsSic=data.officeJson.datenschutz;');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(
    `this.einspielen=function(L,data,localStorage,window){\n${kern}\n};`,
    ctx, { filename: 'buero-json-import-lokal.js' }
  );
  return ctx;
}

test('Import: Kontaktmonitor merged nach caseId, Qualifikationen je Person - Bestand gewinnt', () => {
  const ctx = importLokalKontext();
  const L = {
    kontaktmonitor: [{ caseId: '1', turnusDays: 30 }],
    qualifikationen: { entries: { alt: { qualification: 'bleibt' } } }
  };
  ctx.einspielen(L, { officeJson: {
    kontaktmonitor: { entries: [{ caseId: '1', turnusDays: 90 }, { caseId: '2', turnusDays: 60 }] },
    qualifikationen: { entries: { alt: { qualification: 'aus-sicherung' }, neu: { qualification: 'kommt' } } }
  } }, speicherStub(), {});
  assert.equal(L.kontaktmonitor.length, 2, 'Der fehlende Fall wurde nicht ergaenzt');
  assert.equal(L.kontaktmonitor[0].turnusDays, 30, 'Eine alte Sicherung hat den gepflegten Turnus ueberschrieben');
  assert.equal(L.kontaktmonitor[1].caseId, '2');
  assert.equal(L.qualifikationen.entries.alt.qualification, 'bleibt', 'Der gepflegte Personendatensatz wurde ueberschrieben');
  assert.equal(L.qualifikationen.entries.neu.qualification, 'kommt', 'Die fehlende Person wurde nicht ergaenzt');
});

test('Import: Registry und Karten-Einstellungen NUR bei Leerstand', () => {
  const ctx = importLokalKontext();
  /* (1) Leerstand: Registry landet in localStorage + Spiegel und wird adoptiert. */
  const leer = {};
  const ls1 = speicherStub();
  let adoptiert = null;
  ctx.einspielen(leer, { officeJson: {
    suggestion_registry: { version: 1, fields: { km_art: {} } },
    map_settings: { activeProvider: 'google', googleMapsApiKey: 'g-1' }
  } }, ls1, { __suggestionRegistry: { adopt: (d) => { adoptiert = d; } } });
  assert.ok(ls1._roh.bb_suggestion_registry_v1, 'Der fuehrende localStorage-Schluessel wurde nicht gesetzt');
  assert.ok(leer.suggestionRegistry.fields.km_art, 'Der bueroLocal-Spiegel wurde nicht gesetzt');
  assert.ok(adoptiert && adoptiert.fields.km_art, 'Die laufende Sitzung uebernimmt den Stand nicht (adopt fehlt)');
  assert.equal(leer.mapSettings.googleMapsApiKey, 'g-1', 'Leere Karten-Einstellungen wurden nicht befuellt');

  /* (2) Gepflegter Bestand: NICHTS davon darf angefasst werden. */
  const gepflegt = { mapSettings: { activeProvider: 'here', hereApiKey: 'eigen' } };
  const ls2 = speicherStub({ bb_suggestion_registry_v1: JSON.stringify({ version: 1, fields: { sd_titel: {} } }) });
  let adoptiert2 = false;
  ctx.einspielen(gepflegt, { officeJson: {
    suggestion_registry: { version: 1, fields: { km_art: {} } },
    map_settings: { activeProvider: 'google', googleMapsApiKey: 'fremd' }
  } }, ls2, { __suggestionRegistry: { adopt: () => { adoptiert2 = true; } } });
  assert.ok(JSON.parse(ls2._roh.bb_suggestion_registry_v1).fields.sd_titel, 'Die gepflegte Registry wurde ueberschrieben');
  assert.equal(adoptiert2, false, 'Trotz gepflegter Registry wurde adoptiert');
  assert.equal(gepflegt.mapSettings.hereApiKey, 'eigen', 'Eingetragene API-Schluessel wurden ueberschrieben');
  assert.equal(gepflegt.mapSettings.googleMapsApiKey, undefined, 'Die fremde Sicherung hat die Karten-Konfiguration vermischt');

  /* (3) Stammdaten-Vorschlaege: fehlende Felder ergaenzen, Sitzungswerte gewinnen. */
  const st = { stammdatenSuggestions: { plz: ['04103'] } };
  const fenster = { __stammdatenSuggestions: { plz: ['04103'] } };
  ctx.einspielen(st, { officeJson: { stammdaten_suggestions: { plz: ['99999'], ort: ['Leipzig'] } } }, speicherStub(), fenster);
  assert.deepEqual(st.stammdatenSuggestions.plz, ['04103'], 'Das gepflegte Feld wurde ueberschrieben');
  assert.deepEqual(st.stammdatenSuggestions.ort, ['Leipzig'], 'Das fehlende Feld wurde nicht ergaenzt');
  assert.deepEqual(fenster.__stammdatenSuggestions.plz, ['04103'], 'Der Sitzungswert im Live-Kanal muss gewinnen');
  assert.deepEqual(fenster.__stammdatenSuggestions.ort, ['Leipzig'], 'Der Live-Kanal bekam die Ergaenzung nicht');
});

/* ═══════════ 4. Vorbefund: die Whitelist verschluckt die Exportfelder nicht mehr ═══════════ */

test('loadBueroLocal: aiChats, caseOuttakes und fileNameStyle ueberleben das Neuladen', () => {
  const kern = schnipsel('function loadBueroLocal(){', 'function saveBueroLocal(){');
  const gespeichert = JSON.stringify({
    aiChats: [{ id: 'chat-1' }],
    caseOuttakes: [{ id: 'out-1' }],
    fileNameStyle: 'underscore',
    kontaktmonitor: [{ caseId: '7' }],
    voelligFremd: 'bleibt draussen'
  });
  const ctx = {
    console,
    BUERO_LOCAL_KEY: 'betreuungsbuero.bueroLocal.v1',
    localStorage: speicherStub({ 'betreuungsbuero.bueroLocal.v1': gespeichert }),
    emptyOfficeProfile: () => ({}),
    emptyMapSettings: () => ({ activeProvider: 'osm', googleMapsApiKey: '', hereApiKey: '' })
  };
  vm.createContext(ctx);
  vm.runInContext(`${kern}\nthis.ergebnis=loadBueroLocal();`, ctx, { filename: 'load-buero-local.js' });
  const L = ctx.ergebnis;
  assert.equal(L.aiChats.length, 1, 'KI-Chat-Verlaeufe werden weiterhin bei jedem Neuladen verworfen');
  assert.equal(L.caseOuttakes.length, 1, 'Fallabschluss-Laeufe werden weiterhin bei jedem Neuladen verworfen');
  assert.equal(L.fileNameStyle, 'underscore', 'Die eigene Dateinamen-Wahl geht weiterhin beim Neuladen verloren');
  assert.equal(L.kontaktmonitor.length, 1, 'Bestandsfeld der Whitelist beschaedigt');
  assert.equal(L.voelligFremd, undefined, 'Die Whitelist laesst ploetzlich Fremdfelder durch');

  /* Ein unsinniger Stil-Wert wird zur leeren Vorgabe - kein Durchreichen von Muell. */
  ctx.localStorage = speicherStub({ 'betreuungsbuero.bueroLocal.v1': JSON.stringify({ fileNameStyle: 'quatsch' }) });
  vm.runInContext(`this.ergebnis2=loadBueroLocal();`, ctx, { filename: 'load-buero-local-2.js' });
  assert.equal(ctx.ergebnis2.fileNameStyle, '', 'Unbekannte Stil-Werte muessen zur Buero-Vorgabe werden');
});

/* ═══════════ 5. Online-Feldliste traegt datenschutz ═══════════ */

test('Online-Export: die officeJson-Feldliste holt auch datenschutz (Nicht-Admin-Weg)', () => {
  /* moduleData (Admin-Dump) blieb fuer Nicht-Admins null - erst der eigene oj('datenschutz')-
     Abruf bringt die DSGVO-Nachweise in die Buero-JSON einer berechtigten Nicht-Admin-Person. */
  assert.ok(html.includes("case_outtakes:await oj('case_outtakes'),datenschutz:await oj('datenschutz'),ui_prefs:await oj('ui_prefs')"),
    'Der Online-Export laesst die Datenschutz-Dokumentation fuer Nicht-Admins weiterhin weg');
});
