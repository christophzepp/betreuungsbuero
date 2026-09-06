'use strict';

/* Pruefstand fuer den Briefkopf-Editor, Paket P1 (06.09.2026): Daten und Anschluss.
     - office_json['briefkopf'] steht in der Whitelist und hat eine Schreibschranke
       (Admin oder Buerostammdaten-Recht), Lesen bleibt beim Fall-Sichtrecht - AUSGEFUEHRT
       gegen den echten Router mit Wegwerf-Datenbank (Muster datenschutz.test.cjs).
     - /api/user-prefs/briefkopf-eigen nimmt nur die drei erlaubten Felder an.
     - Der Menueeintrag, der Statusindikator, das Sprungziel, der Sperrschalter und die
       Sicherungswege (Whitelist + Export + Import) sind in der Auslieferung verdrahtet.
     - Der Baustein-Resolver wird aus der Auslieferungsdatei geschnitten und ausgefuehrt:
       Wortgrenzen, Beschriftungen, Wegfall leerer Abschnitte, Formatierungs-Runs und die
       Standardkarte (= heutige Literale). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');
const lies = (...teile) => fs.readFileSync(path.join(__dirname, '..', ...teile), 'utf8');

function schnipsel(von, bis) {
  const a = html.indexOf(von);
  assert.ok(a >= 0, `Anker fehlt in der Auslieferungsdatei: ${von}`);
  assert.equal(html.indexOf(von, a + 1), -1, `Anker ist nicht eindeutig: ${von}`);
  const b = html.indexOf(bis, a);
  assert.ok(b > a, `Endanker fehlt hinter "${von}": ${bis}`);
  return html.slice(a, b);
}

/* ═══════════════════ 1. Serverseitige Ablage und Rechte ═══════════════════ */

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briefkopf-test-'));
process.env.DB_PATH = path.join(TEMP, 'briefkopf.sqlite3');

let server = null;
let sitzung = {};

function serverStarten() {
  if (server) return server;
  const express = require('express');
  const alterLog = console.log;
  let db;
  try {
    console.log = (...args) => {
      if (!String(args[0] || '').startsWith('[Fallrechte]')) alterLog(...args);
    };
    db = require('../src/database/index');
  } finally { console.log = alterLog; }
  db.prepare(`INSERT INTO users (id,username,password_hash,display_name,allow_local,allow_online,is_admin)
    VALUES (1,'pruefstand','x','Pruefstand',1,1,0)`).run();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = Object.assign({ userId: 1, mode: 'online' }, sitzung); next(); });
  app.use('/api/office-json', require('../src/modules/office/json-routes'));
  app.use('/api/user-prefs', require('../src/modules/settings/user-preference-routes'));
  server = app.listen(0);
  return server;
}

function ruf(methode, pfad, koerper) {
  const port = serverStarten().address().port;
  const daten = koerper === undefined ? null : JSON.stringify(koerper);
  return new Promise((auf, ab) => {
    const anfrage = http.request({
      port, method: methode, path: pfad,
      headers: daten ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(daten) } : {}
    }, (antwort) => {
      let text = '';
      antwort.on('data', (c) => { text += c; });
      antwort.on('end', () => auf({ status: antwort.statusCode, text }));
    });
    anfrage.on('error', ab);
    if (daten) anfrage.write(daten);
    anfrage.end();
  });
}

test.after(() => {
  if (server) server.close();
  fs.rmSync(TEMP, { recursive: true, force: true });
});

test('Ablage: briefkopf steht in KEYS und in der Schreibschranke', () => {
  const quelle = lies('src', 'modules', 'office', 'json-routes.js');
  assert.match(quelle, /const KEYS = new Set\(\[[^\]]*'briefkopf'/, 'Whitelist-Eintrag fehlt - PUT liefe ins Leere');
  const a = quelle.indexOf('const SCHREIB_SCHRANKEN = new Map(');
  const b = quelle.indexOf('function schrankeFuer(', a);
  assert.ok(a > 0 && b > a, 'SCHREIB_SCHRANKEN nicht gefunden');
  assert.ok(quelle.slice(a, b).includes("['briefkopf', {"), 'Die Schreibschranke fuer briefkopf fehlt');
  const lese = quelle.slice(quelle.indexOf('const LESE_SCHRANKEN = new Map('), a);
  /* Nacharbeit 06.09.2026 P3 (Befund 7): die Seite ist fuer alle da - Lesen verlangt nur die Anmeldung. */
  assert.ok(lese.includes("['briefkopf', {\n    erlaubt: (session) => !!(session && session.userId),"), 'Die Leseschranke fuer briefkopf (nur Anmeldung) fehlt');
});

test('Rechte (ausgefuehrt): Schreiben verlangt isAdmin || canManageOfficeProfile, Lesen nur die Anmeldung', async () => {
  const karte = { data: { version: 1, farbe: '#1f4e78', band: { stil: 'linie', hoehe: 1.2 } } };
  const faelle = [
    ['Admin', { isAdmin: true }, 200],
    ['Buerostammdaten verwalten', { canManageOfficeProfile: 1 }, 200],
    /* Fall-Bearbeitung allein reicht NICHT - sonst stellte jede Sachbearbeitung den Buero-Kopf um. */
    ['nur Fallrechte', { canViewCases: 1, canEditCases: 1 }, 403],
    ['ohne alles', {}, 403]
  ];
  for (const [name, s, erwartet] of faelle) {
    sitzung = s;
    const a = await ruf('PUT', '/api/office-json/briefkopf', karte);
    assert.equal(a.status, erwartet, `PUT briefkopf als "${name}" ergab ${a.status} statt ${erwartet}`);
  }
  /* Gegenprobe: Geschriebenes kommt fuer eine Person mit blossem Fall-Sichtrecht zurueck. */
  sitzung = { canViewCases: 1 };
  const gelesen = await ruf('GET', '/api/office-json/briefkopf');
  assert.equal(gelesen.status, 200, 'Fall-Sichtrecht muss die Karte lesen duerfen (die Zeichner brauchen sie)');
  assert.equal(JSON.parse(gelesen.text).data.band.stil, 'linie', 'Geschriebenes kam nicht zurueck');
  /* Nacharbeit 06.09.2026 P3 (Befund 7): auch ohne Fall-Sichtrecht lesbar - die Seite ist fuer jede angemeldete Person da. */
  sitzung = {};
  assert.equal((await ruf('GET', '/api/office-json/briefkopf')).status, 200, 'Nacharbeit P3: ohne Fall-Sichtrecht muss die Karte lesbar sein');
  sitzung = { userId: null };
  assert.equal((await ruf('GET', '/api/office-json/briefkopf')).status, 401, 'ohne Anmeldung bleibt es dicht');
});

test('Persoenliche Abweichung (ausgefuehrt): briefkopf-eigen nimmt nur name/titel/funktion', async () => {
  sitzung = { canViewCases: 1 };
  const gut = { prefs: { version: 1, name: 'Erika Beispiel', titel: 'Dipl.-Soz.', funktion: 'Berufsbetreuerin' } };
  assert.equal((await ruf('PUT', '/api/user-prefs/briefkopf-eigen', gut)).status, 200, 'gueltige Abweichung abgewiesen');
  const zurueck = await ruf('GET', '/api/user-prefs/briefkopf-eigen');
  assert.equal(zurueck.status, 200);
  assert.equal(JSON.parse(zurueck.text).prefs.name, 'Erika Beispiel', 'Gespeichertes kam nicht zurueck');
  /* Fremde Felder (etwa Farben oder Fusszeile) gehoeren dem Buero und werden abgewiesen. */
  const fremd = { prefs: { version: 1, name: 'x', farbe: '#ff0000' } };
  assert.equal((await ruf('PUT', '/api/user-prefs/briefkopf-eigen', fremd)).status, 400, 'Fremdfelder muessen abgewiesen werden');
  const zuLang = { prefs: { version: 1, name: 'x'.repeat(121) } };
  assert.equal((await ruf('PUT', '/api/user-prefs/briefkopf-eigen', zuLang)).status, 400, 'Ueberlange Namen muessen abgewiesen werden');
  assert.equal((await ruf('PUT', '/api/user-prefs/briefkopf-eigen', { prefs: { version: 2, name: 'x' } })).status, 400, 'falsche Version muss abgewiesen werden');
  /* Nacharbeit P4: auch ein Konto OHNE Fall-Sichtrecht darf seine Anpassung pflegen (die Briefkopf-Seite
     ist fuer alle da); ohne Anmeldung bleibt es bei 401. */
  sitzung = { canViewCases: 0 };
  assert.equal((await ruf('PUT', '/api/user-prefs/briefkopf-eigen', gut)).status, 200, 'ohne Fall-Sichtrecht muss die Anpassung speicherbar sein');
  assert.equal((await ruf('GET', '/api/user-prefs/briefkopf-eigen')).status, 200, 'ohne Fall-Sichtrecht muss die Anpassung lesbar sein');
  assert.equal((await ruf('GET', '/api/user-prefs/dashboard')).status, 200, 'Dashboard-Ausnahme bleibt');
});

/* ═══════════════════ 2. Verdrahtung in der Auslieferung ═══════════════════ */

test('Menue: Eintrag hinter den Buerostammdaten, Indikator, Sprungziel und Sperrschalter', () => {
  const n = html.indexOf('const EIN_NAV=');
  const nav = html.slice(n, html.indexOf('\n];', n));
  /* Nacharbeit 06.09.2026 P3: der Eintrag traegt kein recht:-Gate mehr (Seite fuer alle sichtbar). */
  const st = nav.indexOf("{id:'stammdaten'"), bk = nav.indexOf("{id:'briefkopf',name:'Briefkopf',lokal:true,datei:true}");
  assert.ok(st > 0 && bk > st, 'Der Eintrag Briefkopf fehlt oder steht nicht hinter den Buerostammdaten');
  assert.ok(nav.indexOf("{id:'nutzer'") > bk, 'Der Eintrag Briefkopf muss VOR den Personen stehen (Gruppe Buero)');
  assert.ok(html.includes("briefkopf:'<path d=\"M4 4h16v16H4z\"/><path d=\"M4 9h16M8 13h8M8 16h5\"/>'"), 'Symbol (Blatt mit Kopfzeile) fehlt');
  const a = html.indexOf('const EIN_STATUS={');
  assert.ok(/\bbriefkopf:\{eigen:/.test(html.slice(a, html.indexOf('\n};', a))), 'EIN_STATUS.briefkopf fehlt');
  assert.ok(html.includes("'Eigener Briefkopf gepflegt.'") && html.includes("'Standard-Briefkopf gilt.'"), 'Statusworte fehlen');
  assert.ok(html.includes("letterhead:'briefkopf'"), 'EIN_TAB_NAV.letterhead fehlt');
  const k = html.indexOf('const EIN_KATALOG=[');
  const katalog = html.slice(k, html.indexOf('];', k));
  assert.ok(katalog.includes("{key:'briefkopf.eigeneErlaubt',bereich:'briefkopf'"), 'Sperrschalter fehlt im Katalog');
  assert.ok(html.includes("window.__eigeneWahlGesperrt('briefkopf.eigeneErlaubt')"), 'Der Sperrschalter wird nirgends abgefragt');
  /* Einbettung: Editor-Haken fuer P2, davor die vorlaeufige Seite; Nur-Lese wie Buerostammdaten. */
  const eb = html.slice(html.indexOf('const EIN_EINBETT={'), html.indexOf('const EIN_STATUS={'));
  assert.ok(eb.includes("briefkopf:{unter:'Aufbau, Felder, Farben und Fußzeile der Briefe des Büros."), 'Einbettung fehlt');
  assert.ok(eb.includes("window.__briefkopfEditor.render(host,{readOnly})"), 'Der Editor-Haken (P2) fehlt');
  assert.ok(eb.includes('<b>Büro</b> · Vorgabe für alle'), 'Reichweiten-Marke fehlt');
  /* Nacharbeit 06.09.2026 P3: den alten Nur-Lese-Hinweis traegt nur noch der Vorlaeufig-Rueckfall
     (einBriefkopfVorlaeufig, ohne Abschnitt „Meine Anpassung“); der Editor hat seine eigene Karte. */
  const vl = schnipsel('function einBriefkopfVorlaeufig(host,readOnly){', '/* ══════════ Indikatoren der Navigation');
  assert.ok(vl.includes('Nur-Lese-Ansicht — Änderungen am Briefkopf erfordern die Berechtigung „Bürostammdaten bearbeiten" oder Admin-Rechte.'),
    'Nur-Lese-Hinweis des Vorlaeufig-Rueckfalls fehlt');
});

test('Nacharbeit P3: Seite fuer alle, readOnly = weder Admin noch Buerostammdaten-Recht, Indikator zaehlt die Anpassung', () => {
  /* 1. EIN_NAV: kein recht:/admin:-Gate am Briefkopf */
  const n = html.indexOf('const EIN_NAV=');
  const nav = html.slice(n, html.indexOf('\n];', n));
  const z0 = nav.indexOf("{id:'briefkopf'");
  assert.ok(z0 > 0);
  assert.equal(nav.slice(z0, nav.indexOf('\n', z0)).trim(), "{id:'briefkopf',name:'Briefkopf',lokal:true,datei:true},");
  /* 2. readOnly-Ableitung in EIN_EINBETT.briefkopf - AUSGEFUEHRT gegen den echten Bauer */
  const eb = html.slice(html.indexOf('const EIN_EINBETT={'), html.indexOf('const EIN_STATUS={'));
  const ba = eb.indexOf('bauen:host=>{const u=window.__currentUser||{};', eb.indexOf("briefkopf:{unter:"));
  const ENDE = 'einBriefkopfVorlaeufig(host,readOnly);}';
  const be = eb.indexOf(ENDE, ba);
  assert.ok(ba > 0 && be > ba, 'Bauer der Briefkopf-Seite nicht gefunden');
  const bauen = eb.slice(ba + 'bauen:'.length, be + ENDE.length);
  assert.ok(bauen.includes('const readOnly=!(local||u.isAdmin||u.canManageOfficeProfile);'), 'readOnly-Ableitung veraendert');
  assert.ok(!bauen.includes('menuSettingsOfficeProfile') && !bauen.includes('__menuPermissionAllowed') && !bauen.includes('einDarf('),
    'das Menuerecht darf am Briefkopf nichts steuern');
  const ro = (user, local) => {
    const ctx = { window: { __currentUser: user, isBueroLocalMode: () => local, __briefkopfEditor: { render: (h, o) => { ctx.__ro = o.readOnly; } } },
      einBriefkopfVorlaeufig: () => { throw new Error('Editor-Haken nicht genutzt'); } };
    vm.createContext(ctx);
    vm.runInContext('(' + bauen + ')({})', ctx);
    return ctx.__ro;
  };
  assert.equal(ro({ isAdmin: true }, false), false, 'Admin bearbeitet');
  assert.equal(ro({ isAdmin: false, canManageOfficeProfile: true }, false), false, 'Buerostammdaten-Recht bearbeitet');
  assert.equal(ro({ isAdmin: false, canManageOfficeProfile: false, menuSettingsOfficeProfile: true }, false), true,
    'ohne Bearbeitungsrecht Nur-Lese - auch mit Menuerecht');
  assert.equal(ro(null, false), true, 'ohne Konto online: Nur-Lese');
  assert.equal(ro({ isAdmin: false }, true), false, 'lokal bearbeitet jede Person');
  /* 3. Indikator: gruener Haken auch bei (nur) gespeicherter Anpassung - AUSGEFUEHRT */
  const sa = html.indexOf('const EIN_STATUS={');
  const status = html.slice(sa, html.indexOf('\n};', sa) + 3);
  const ind = (buero, eigen, erlaubt) => {
    const ctx = { window: { __briefkopfBuero: () => buero, __briefkopfEigen: () => eigen } };
    if (erlaubt !== undefined) ctx.window.__briefkopfEigenErlaubt = () => erlaubt;
    vm.createContext(ctx);
    return vm.runInContext(status + '\nEIN_STATUS.briefkopf.eigen()', ctx);
  };
  let z = ind(null, null);
  assert.equal(z.ok, false); assert.equal(z.titel, 'Standard-Briefkopf gilt.');
  z = ind(null, { version: 1, name: 'Erika Test' });
  assert.equal(z.ok, true, 'nur gespeicherte Anpassung = Haken'); assert.equal(z.titel, 'Standard-Briefkopf gilt · mit Ihrer Anpassung.');
  z = ind({ version: 1 }, null);
  assert.equal(z.ok, true); assert.equal(z.titel, 'Eigener Briefkopf gepflegt.');
  z = ind({ version: 1 }, { version: 1, titel: 'Dipl.-Soz.päd.' });
  assert.equal(z.ok, true); assert.equal(z.titel, 'Eigener Briefkopf gepflegt · mit Ihrer Anpassung.');
  /* Nacharbeit 06.09.2026 (Befund 6): vom Buero gesperrte Anpassung - Haken bleibt, Titel sagt „ruht“ */
  z = ind(null, { version: 1, name: 'Erika Test' }, false);
  assert.equal(z.ok, true); assert.equal(z.titel, 'Standard-Briefkopf gilt · Ihre Anpassung ruht (vom Büro gesperrt).');
  z = ind({ version: 1 }, { version: 1, name: 'Erika Test' }, false);
  assert.equal(z.ok, true); assert.equal(z.titel, 'Eigener Briefkopf gepflegt · Ihre Anpassung ruht (vom Büro gesperrt).');
  z = ind({ version: 1 }, null, false);
  assert.equal(z.titel, 'Eigener Briefkopf gepflegt.', 'ohne Anpassung kein Zusatz');
  z = ind(null, { version: 1, name: 'Erika Test' }, true);
  assert.equal(z.titel, 'Standard-Briefkopf gilt · mit Ihrer Anpassung.');
  /* ohne die globalen Helfer (Block nicht geladen) faellt der Indikator auf den Punkt zurueck */
  const ctx0 = { window: {} }; vm.createContext(ctx0);
  assert.equal(vm.runInContext(status + '\nEIN_STATUS.briefkopf.eigen()', ctx0).ok, false);
  /* 4. Nur-Lese-Karte des Editors nennt den Weg zu „Meine Anpassung“ (Wortlaut Bauauftrag) */
  const ed = html.slice(html.indexOf('/* ═══ BRIEFKOPF-EDITOR'), html.indexOf('/* ═══ BRIEFKOPF-EDITOR: ENDE ═══ */'));
  assert.ok(ed.includes('Nur-Lese-Ansicht – Aufbau, Farben und Fußzeile sind Bürovorgabe (Admin oder Recht „Bürostammdaten bearbeiten“). Name, Titel und Funktionszeile für Ihre eigenen Ausgaben passen Sie rechts unter „Meine Anpassung“ an.</p></div>\';'),
    'RO_KARTE des Editors');
  assert.ok(!ed.includes('Änderungen am Briefkopf erfordern die Berechtigung'), 'alter Nur-Lese-Text im Editor weg');
  /* 5. nach eigenSpeichern wird der Indikator der Navigation neu gezeichnet */
  assert.ok(ed.includes("T(erg?'Meine Anpassung gespeichert – gilt ab jetzt für Ihre Ausgaben.':'Meine Anpassung entfernt – es gilt die Bürovorgabe.');\n"
    + "      try{if(typeof einIndikatorenZeichnen==='function')einIndikatorenZeichnen()}catch(_e){}"), 'Indikator nach eigenSpeichern');
});

test('Sicherungswege: Whitelist + lokaler Export + Import + Online-Export tragen briefkopf', () => {
  const wl = schnipsel('function loadBueroLocal(){', 'function saveBueroLocal(){');
  assert.ok(wl.includes('briefkopf:(parsed.briefkopf&&'), 'briefkopf fehlt in der loadBueroLocal-Whitelist');
  assert.ok(wl.includes('briefkopfEigen:(parsed.briefkopfEigen&&'), 'briefkopfEigen fehlt in der loadBueroLocal-Whitelist');
  assert.ok(wl.includes('datenschutz:null,briefkopf:null,briefkopfEigen:null}'), 'Leerstand fehlt');
  assert.ok(html.includes("data.officeJson.briefkopf=(L.briefkopf&&typeof L.briefkopf==='object')?L.briefkopf:null;"), 'Lokal-Export fehlt');
  assert.ok(html.includes("data.officeJson.ui_prefs.briefkopfEigen="), 'Lokal-Export der Abweichung fehlt');
  assert.ok(html.includes("Object.assign(data.officeJson,{briefkopf:await oj('briefkopf')});"), 'Online-Export fehlt');
  assert.ok(html.includes("if(bkSic&&typeof bkSic==='object'&&bkSic.version&&!(L.briefkopf&&L.briefkopf.version))L.briefkopf=bkSic;"),
    'Lokaler Import (nur bei Leerstand) fehlt');
  assert.ok(html.includes("if(!curB||!curB.data||!curB.data.version){"), 'Online-Import (nur bei Leerstand) fehlt');
  /* Das gepinnte ui_prefs-Literal des Lokal-Exports bleibt unangetastet (datenschutz.test.cjs). */
  assert.ok(html.includes("ui_prefs:{fileNameStyle:L.fileNameStyle||''},datenschutz:L.datenschutz||null}"), 'Export-Literal veraendert');
});

test('loadBueroLocal (ausgefuehrt): briefkopf und briefkopfEigen ueberleben das Neuladen', () => {
  const quelle = schnipsel('function loadBueroLocal(){', 'function saveBueroLocal(');
  const gespeichert = {
    briefkopf: { version: 1, farbe: '#123456', band: { stil: 'keins' } },
    briefkopfEigen: { version: 1, name: 'Erika Beispiel', titel: '', funktion: 'Berufsbetreuerin' },
    fileNameStyle: 'underscore'
  };
  const ctx = {
    BUERO_LOCAL_KEY: 'test',
    localStorage: { getItem: () => JSON.stringify(gespeichert) },
    emptyOfficeProfile: () => ({}),
    emptyMapSettings: () => ({})
  };
  vm.createContext(ctx);
  const L = vm.runInContext('(function(){' + quelle + '\nreturn loadBueroLocal();})()', ctx);
  assert.equal(L.briefkopf.farbe, '#123456', 'briefkopf ging beim Neuladen verloren');
  assert.equal(L.briefkopfEigen.name, 'Erika Beispiel', 'briefkopfEigen ging beim Neuladen verloren');
  assert.equal(L.fileNameStyle, 'underscore', 'Bestandsfeld beschaedigt');
  ctx.localStorage = { getItem: () => JSON.stringify({ briefkopf: [1, 2], briefkopfEigen: 'quatsch' }) };
  const kaputt = vm.runInContext('(function(){' + quelle + '\nreturn loadBueroLocal();})()', ctx);
  assert.equal(kaputt.briefkopf, null, 'Listen sind keine Karte');
  assert.equal(kaputt.briefkopfEigen, null, 'Zeichenketten sind keine Abweichung');
  ctx.localStorage = { getItem: () => null };
  const leer = vm.runInContext('(function(){' + quelle + '\nreturn loadBueroLocal();})()', ctx);
  assert.equal(leer.briefkopf, null);
  assert.equal(leer.briefkopfEigen, null);
});

/* ═══════════════════ 3. Resolver und Standardkarte (ausgefuehrt) ═══════════════════ */

function kartenKontext(profil, office, extra) {
  const quelle = schnipsel('/* ═══ BRIEFKOPF-KARTE: ANFANG ═══', '/* ═══ BRIEFKOPF-KARTE: ENDE ═══ */');
  const ctx = Object.assign({
    window: { __appMode: 'online', officeProfile: profil, addEventListener() {}, dispatchEvent() {} },
    document: { addEventListener() {} },
    CustomEvent: function (t, i) { this.type = t; this.detail = i && i.detail; },
    OFFICE: office,
    state: { caseData: { care: { fileNumber: '', courtName: 'Amtsgericht Musterstadt' } } },
    officeNameWithDegree: () => office.name + (office.degree ? ` (${office.degree})` : ''),
    unifiedCaregiverName: () => 'Sabine Kraft',
    console, JSON,
    fetch: async () => ({ ok: false })
  }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(quelle, ctx, { filename: 'briefkopf-karte.js' });
  return ctx.window;
}

const PROFIL = { companyName: '', contactName: 'Max Mustermensch', firstName: 'Max', lastName: 'Mustermensch', academicDegree: '',
  street: 'Musterstraße 1', postalCode: '12345', city: 'Musterstadt', formattedAddress: 'Musterstraße 1, 12345 Musterstadt',
  phone: '01234/5', email: 'm@x.de', fax: '', mobile: '', website: '', taxNumber: '', vatId: '' };
const OFF = { name: 'Max Mustermensch', degree: 'B.A.', address: 'Musterstraße 1, 12345 Musterstadt', phone: '01234/5', email: 'm@x.de',
  bank: 'Musterbank', iban: 'DE00', bic: 'BICX', tax: '11/222' };

test('Resolver: Wortgrenzen, Beschriftungen, Wegfall leerer Abschnitte und Zeilen', () => {
  const w = kartenKontext(PROFIL, OFF);
  assert.equal(w.__briefkopfZeile('BANK | IBAN: IBAN | BIC: BIC'), 'Musterbank | IBAN: DE00 | BIC: BICX', 'Beschriftung vor Doppelpunkt bleibt Text');
  assert.equal(w.__briefkopfZeile('Unser Zeichen: AZ'), '', 'Abschnitt mit leerem Baustein muss wegfallen');
  assert.equal(w.__briefkopfZeile('Tel. TELEFON · Fax FAX'), 'Tel. 01234/5', 'leerer Abschnitt hinter dem Trenner');
  assert.equal(w.__briefkopfZeile('**ORT, DATUM**', { ort: '', datum: '06.09.2026' }), '**06.09.2026**', 'Auszeichnung wandert zum Nachbarn');
  assert.equal(w.__briefkopfZeile('**INHABER (TITEL)**'), '**Max Mustermensch (B.A.)**', 'Grad in Klammern (= officeNameWithDegree)');
  assert.equal(w.__briefkopfZeile('BETREUERIN NAME ORT', { ort: 'Musterstadt' }), 'BETREUERIN NAME Musterstadt', 'nur ganze Woerter sind Bausteine');
  assert.equal(w.__briefkopfZeile('Seite SEITE von SEITEN'), '', 'ohne Seitenzahlen faellt die Zeile weg');
  assert.equal(w.__briefkopfZeile('Seite SEITE von SEITEN', { seite: 2, seiten: 3 }), 'Seite 2 von 3');
  assert.equal(w.__briefkopfZeile('WEB', { rueckfall: { WEB: 'www.x.de' } }), 'www.x.de', 'Musterdaten nur als Rueckfall leerer Felder');
  assert.equal(w.__briefkopfZeile('PLZ ORT'), '12345 Musterstadt', 'laengster Baustein zuerst');
  assert.equal(w.__briefkopfWert('BETREUER'), 'Sabine Kraft');
  assert.equal(w.__briefkopfWert('GERICHT'), 'Amtsgericht Musterstadt');
  assert.equal(w.__briefkopfWert('Fliesstext'), null, 'kein Baustein -> null');
  /* Behebung 06.09. (Vertrag 8): BUERO = OFFICE.name fuer die Standardkarte (wie heute), Firmenname erst fuer
     gepflegte Karten (Mockup); eine uebergebene Karte ohne Flag gilt als gepflegt (WYSIWYG). */
  const f = kartenKontext(Object.assign({}, PROFIL, { companyName: 'Betreuungsbüro Muster' }), OFF);
  assert.equal(f.__briefkopfWert('BÜRO'), 'Max Mustermensch', 'Standardkarte: OFFICE.name trotz Firmenname');
  assert.equal(f.__briefkopfWert('BÜRO', { karte: { gepflegt: true } }), 'Betreuungsbüro Muster');
  assert.equal(f.__briefkopfWert('BÜRO', { karte: {} }), 'Betreuungsbüro Muster', 'ohne Flag = gepflegt');
  assert.equal(f.__briefkopfWert('BÜRO', { karte: { gepflegt: false } }), 'Max Mustermensch');
  assert.equal(w.__briefkopfWert('BÜRO', { karte: { gepflegt: true } }), 'Max Mustermensch', 'ohne Firmenname bleibt der Name');
});

test('Runs: Zustandsautomat - ***fett kursiv***, Kursiv um Fett, offene Marke bleibt Text (Behebung 06.09.)', () => {
  const w = kartenKontext(PROFIL, OFF);
  const r = (t) => Array.from(w.__briefkopfRuns(t), (x) => [x.text, x.bold, x.italic, x.underline]);
  assert.deepEqual(r('***BETREUER***'), [['BETREUER', true, true, false]]);
  assert.deepEqual(r('__***X***__'), [['X', true, true, true]]);
  assert.deepEqual(r('*a **b** c*'), [['a ', false, true, false], ['b', true, true, false], [' c', false, true, false]]);
  assert.deepEqual(r('**a** b **c**'), [['a', true, false, false], [' b ', false, false, false], ['c', true, false, false]]);
  assert.deepEqual(r('5 * 3'), [['5 * 3', false, false, false]]);
  assert.deepEqual(r('Tel. **0151'), [['Tel. **0151', false, false, false]]);
  assert.deepEqual(r('a_b __c__'), [['a_b ', false, false, false], ['c', false, false, true]]);
});

test('Runs: Fett, Kursiv, Unterstrichen - auch verschachtelt', () => {
  const w = kartenKontext(PROFIL, OFF);
  assert.deepEqual(Array.from(w.__briefkopfRuns('**fett** und *kursiv* und __unter__ und **__beides__**'), (r) => [r.text, r.bold, r.italic, r.underline]), [
    ['fett', true, false, false], [' und ', false, false, false], ['kursiv', false, true, false],
    [' und ', false, false, false], ['unter', false, false, true], [' und ', false, false, false], ['beides', true, false, true]
  ]);
  /* Behebung 06.09.: eingesetzte WERTE sind nie Auszeichnung - Unterstriche in E-Mail-Adressen und Sternchen
     in Namen bleiben Text (Maskierung beim Einsetzen, Demaskierung in den Runs). */
  const m = kartenKontext(Object.assign({}, PROFIL, { email: 'max__mueller__x@web.de', contactName: '', firstName: '', lastName: '' }),
    Object.assign({}, OFF, { name: 'Anna *Stern* GmbH' }));
  assert.deepEqual(Array.from(m.__briefkopfZeileRuns('E-MAIL'), (r) => [r.text, r.underline]), [['max__mueller__x@web.de', false]]);
  assert.deepEqual(Array.from(m.__briefkopfZeileRuns('**INHABER**'), (r) => [r.text, r.bold, r.italic]), [['Anna *Stern* GmbH', true, false]]);
  assert.equal(m.__briefkopfKlartext('E-MAIL | INHABER', {}), 'max__mueller__x@web.de | Anna *Stern* GmbH');
  assert.equal(Array.from(m.__briefkopfZeilen([{ t: '__E-MAIL__', size: 7, color: 'ci' }]))[0].klartext, 'max__mueller__x@web.de');
  assert.equal(Array.from(m.__briefkopfZeilen([{ t: '__E-MAIL__', size: 7, color: 'ci' }]))[0].runs[0].underline, true, 'Auszeichnung der Vorlage wirkt weiter');
});

test('Standardkarte = heutige Literale, Ausgangspunkte, Normalisierung', () => {
  const w = kartenKontext(PROFIL, OFF);
  const k = w.__briefkopfStandardKarte();
  assert.equal(k.kopfLinks.zeilen[0].size, 11.5); assert.equal(k.kopfLinks.zeilen[1].size, 8.5);
  assert.equal(k.kopfRechts.zeilen[0].size, 7.3); assert.equal(k.band.hoehe, 22); assert.equal(k.band.textSize, 11.5);
  assert.equal(k.absender.zeilen[0].size, 7.6); assert.equal(k.info.zeilen[0].size, 9.3); assert.equal(k.info.zeilen[4].size, 10);
  assert.equal(k.fuss.zeilen.length, 4); assert.ok(k.fuss.zeilen.every((z) => z.size === 7.2 && z.color === 'ci'));
  assert.equal(k.folge.hoehe, 13); assert.equal(k.folge.textSize, 7.5);
  assert.equal(k.farbe, '#1f4e78'); assert.equal(k.grau, '#59636b');
  /* Die vier Fusszeilen der Standardkarte loesen sich zu den heutigen Texten auf. */
  assert.deepEqual(Array.from(w.__briefkopfZeilen(k.fuss.zeilen), (z) => z.klartext), [
    'Max Mustermensch (B.A.)', 'Musterstraße 1, 12345 Musterstadt | 01234/5 | m@x.de', 'Musterbank | IBAN: DE00 | BIC: BICX', 'USt.-Nr.: 11/222'
  ]);
  assert.equal(w.__briefkopfIstStandard(k), true);
  assert.equal(w.__briefkopfIstStandard(w.__briefkopfAusgangspunkte.linie()), false);
  assert.equal(w.__briefkopfAusgangspunkte.schlicht().band.stil, 'keins');
  const n = w.__briefkopfNormalisieren({ farbe: 'rot', kopfLinks: { zeilen: [{ t: 'x', size: 99, color: 'lila' }] }, band: { stil: 'linie', hoehe: 1.2 }, fuss: { konto: 2 } });
  assert.equal(n.farbe, '#1f4e78'); assert.equal(n.kopfLinks.zeilen[0].size, 16); assert.equal(n.kopfLinks.zeilen[0].color, 'ci');
  assert.equal(n.band.hoehe, 1.2, 'Linienstaerke darf nicht auf 0,5 gerastert werden'); assert.equal(n.fuss.konto, 2);
  assert.equal(n.fuss.zeilen.length, 4, 'fehlende Teile kommen aus der Standardkarte');
  assert.equal(w.__briefkopfEffektiv().gepflegt, false, 'ohne Vorgabe gilt der Standard');
});

test('Persoenliche Abweichung: wirkt nur, wenn Karte UND Sperrschalter es erlauben', async () => {
  const w = kartenKontext(PROFIL, OFF);
  w.__appMode = 'local';
  w.isBueroLocalMode = () => true;
  w.bueroLocal = { briefkopfEigen: { name: 'Erika Beispiel', titel: 'Dipl.-Soz.', funktion: 'Berufsbetreuerin' } };
  let k = await w.__briefkopfLaden();
  assert.equal(k.eigen.name, 'Erika Beispiel');
  assert.deepEqual(Array.from(w.__briefkopfZeilen(k.kopfLinks.zeilen), (z) => z.klartext), ['Erika Beispiel, Dipl.-Soz.', 'Berufsbetreuerin']);
  /* Buero sperrt ueber die Vorgabe: die Abweichung verschwindet ohne Neuladen (Cache-Schluessel). */
  w.__eigeneWahlGesperrt = (key) => key === 'briefkopf.eigeneErlaubt';
  k = w.__briefkopfEffektiv();
  assert.equal(k.eigen, null, 'Sperrschalter wirkt nicht');
  assert.deepEqual(Array.from(w.__briefkopfZeilen(k.kopfLinks.zeilen), (z) => z.klartext), ['Sabine Kraft', 'Rechtliche Betreuungen']);
  /* Karte selbst sperrt (eigeneErlaubt:false). */
  w.__eigeneWahlGesperrt = () => false;
  await w.__briefkopfSpeichern(Object.assign(w.__briefkopfStandardKarte(), { eigeneErlaubt: false }));
  assert.equal(w.bueroLocal.briefkopf.eigeneErlaubt, false, 'lokal nicht gespeichert');
  assert.equal(w.__briefkopfEffektiv().eigen, null, 'Kartenfeld eigeneErlaubt wirkt nicht');
  assert.equal(w.__briefkopfEffektiv().gepflegt, true);
  await w.__briefkopfZuruecksetzen();
  assert.equal(w.bueroLocal.briefkopf, null);
  assert.equal(w.__briefkopfEffektiv().gepflegt, false);
});

/* ═══════════════════ 4. Fallbezug der Abweichung (Nacharbeit 06.09.2026 P2, Fund 12) ═══════════════════ */

/* Online liefert der Prefs-Abruf eine gespeicherte Abweichung; alles andere bleibt ok:false. */
const FETCH_MIT_EIGEN = async (url) => (String(url).includes('/api/user-prefs/briefkopf-eigen')
  ? { ok: true, json: async () => ({ prefs: { version: 1, name: 'Erika Test', titel: 'M.A.', funktion: 'Fachkraft Rechtliche Betreuung' } }) }
  : { ok: false });
const klar = (w, k) => Array.from(w.__briefkopfZeilen(k.kopfLinks.zeilen), (z) => z.klartext);
const MIT_EIGEN = ['Erika Test, M.A.', 'Fachkraft Rechtliche Betreuung'];
const OHNE_EIGEN = ['Sabine Kraft', 'Rechtliche Betreuungen'];
const UUID = '11111111-2222-4333-8444-555555555555';
const befund = (w, k) => JSON.parse(JSON.stringify(w.__briefkopfEigenBefund(k)));   // vm-Objekte haben fremde Prototypen

test('Persoenliche Abweichung gilt nur im eigenen Fall (Fund 12)', async () => {
  /* ONLINE */
  const st = { caseData: { care: { fileNumber: '', courtName: 'Amtsgericht Musterstadt' } } };
  const w = kartenKontext(PROFIL, OFF, { fetch: FETCH_MIT_EIGEN, state: st });
  await w.__briefkopfLaden();
  assert.equal(w.__briefkopfEigen().name, 'Erika Test', 'Abweichung geladen');
  w.__currentUser = { id: 2, firstName: 'Erika', lastName: 'Test', displayName: 'etest' };

  /* (a) ohne Fallbezug → gilt */
  let b = befund(w);
  assert.deepEqual(b, { gilt: true, grund: 'ohne-fall', betreuer: '' });
  assert.equal(w.__briefkopfEigenGiltFuer(), true);
  assert.deepEqual(klar(w, w.__briefkopfEffektiv()), MIT_EIGEN);
  assert.equal(w.__briefkopfStatus().text, 'Standard-Briefkopf · mit Ihrer Anpassung', 'gepinnter Wortlaut bleibt');
  assert.equal(w.__briefkopfStatus().ruht, null);
  /* kein geladener Fall: ein Restwert im Fallfeld zaehlt nicht */
  st.ui = { caseLoaded: false }; st.caseData.rechtlicherBetreuer = 'sabine kraft';
  assert.equal(w.__briefkopfEigenBefund().grund, 'ohne-fall');
  delete st.ui; delete st.caseData.rechtlicherBetreuer;

  /* (b) online, Cache passend zum Fall, gleiche Nutzer-ID → gilt */
  w.__activeServerCaseId = 'c1';
  w.__sigStore = { caregiverCached: () => ({ caseId: 'c1', caregiver: { userId: 2, name: 'Erika Test' } }) };
  b = befund(w);
  assert.deepEqual(b, { gilt: true, grund: 'eigener-fall', betreuer: 'Erika Test' });
  assert.equal(w.__briefkopfEffektiv().eigen.name, 'Erika Test');
  assert.deepEqual(klar(w, w.__briefkopfEffektiv()), MIT_EIGEN);

  /* (c) fremder Fall: andere Nutzer-ID → Anpassung ruht, Betreuer:in des Falls, Buerovorgabe ohne Titel/Funktionszeile */
  w.__sigStore = { caregiverCached: () => ({ caseId: 'c1', caregiver: { userId: 5, name: 'Sabine Kraft' } }) };
  b = befund(w);
  assert.deepEqual(b, { gilt: false, grund: 'fremder-fall', betreuer: 'Sabine Kraft' });
  let k = w.__briefkopfEffektiv();
  assert.equal(k.eigen, null, 'Cache-Schluessel traegt den Fallbezug: ohne Invalidieren kippt die Karte');
  assert.equal(w.__briefkopfWert('BETREUER'), 'Sabine Kraft');
  assert.deepEqual(klar(w, k), OHNE_EIGEN, 'kein Titel, keine Funktionszeile der Person');
  const st1 = w.__briefkopfStatus();
  assert.equal(st1.eigen, null);
  assert.equal(st1.ruht.grund, 'fremder-fall');
  assert.equal(st1.text, 'Standard-Briefkopf · Ihre Anpassung ruht (Betreuung: Sabine Kraft)');
  assert.ok(st1.text.includes('ruht'));
  /* Namensgleichheit rettet nicht, wenn die Nutzer-ID abweicht; abweichender Name bei gleicher ID sperrt nicht */
  w.__sigStore = { caregiverCached: () => ({ caseId: 'c1', caregiver: { userId: 5, name: 'Erika Test' } }) };
  assert.equal(w.__briefkopfEigenBefund().gilt, false, 'ID gewinnt vor dem Namen');
  w.__sigStore = { caregiverCached: () => ({ caseId: 'c1', caregiver: { userId: 2, name: 'Sabine Kraft' } }) };
  assert.equal(w.__briefkopfEigenBefund().gilt, true);
  /* Cache ohne Nutzer-ID: Namensabgleich normalisiert (Grossschreibung, Umlaute, Titel-Trenner) */
  w.__sigStore = { caregiverCached: () => ({ caseId: 'c1', caregiver: { firstName: 'ERIKA', lastName: 'Test' } }) };
  assert.equal(w.__briefkopfEigenBefund().grund, 'eigener-fall');
  w.__sigStore = { caregiverCached: () => ({ caseId: 'c1', caregiver: { name: 'Sabine Kraft' } }) };
  assert.equal(w.__briefkopfEigenBefund().grund, 'fremder-fall');

  /* (e) Cache mit fremder caseId zaehlt nicht → ohne Fallbeleg gilt die Anpassung */
  w.__sigStore = { caregiverCached: () => ({ caseId: 'c9', caregiver: { userId: 5, name: 'Sabine Kraft' } }) };
  assert.deepEqual(befund(w), { gilt: true, grund: 'ohne-fall', betreuer: '' });
  assert.deepEqual(klar(w, w.__briefkopfEffektiv()), MIT_EIGEN);
  /* Fallfeld mit Personen-UUID: kalter Personen-Cache → kein Beleg (fail-open), einmaliger Hintergrund-Refresh */
  let refreshs = 0;
  w.__qmPersons = []; w.__qmRefreshPersons = async () => { refreshs += 1; return []; };
  st.caseData.rechtlicherBetreuer = UUID;
  assert.deepEqual(befund(w), { gilt: true, grund: 'kein-beleg', betreuer: '' });
  w.__briefkopfEigenBefund(); w.__briefkopfEigenBefund();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(refreshs, 1, 'Personen-Register hoechstens einmal nachgeladen');
  /* Register kennt die Person: Nutzer-ID entscheidet; ohne Konto der Name */
  w.__qmPersons = [{ key: UUID, userId: 5, name: 'Sabine Kraft' }];
  assert.deepEqual(befund(w), { gilt: false, grund: 'fremder-fall', betreuer: 'Sabine Kraft' });
  assert.equal(w.__briefkopfEffektiv().eigen, null);
  w.__qmPersons = [{ key: UUID, userId: 2, name: 'Sabine Kraft' }];
  assert.equal(w.__briefkopfEigenBefund().grund, 'eigener-fall');
  w.__qmPersons = [{ key: UUID, userId: null, name: 'Sabine Kraft' }];
  assert.equal(w.__briefkopfEigenBefund().gilt, false, 'Person ohne Konto: Namensvergleich');
  w.__qmPersons = [{ key: UUID, userId: null, name: 'Erika Test' }];
  assert.equal(w.__briefkopfEigenBefund().gilt, true);
  /* Befund 5 (Nacharbeit): das Fallfeld (frischere Wahrheit) geht dem Cache vor - der Cache deckt nur ein
     leeres oder (kaltes Register) unaufloesbares Fallfeld ab */
  w.__sigStore = { caregiverCached: () => ({ caseId: 'c1', caregiver: { userId: 2, name: 'Erika Test' } }) };
  w.__qmPersons = [{ key: UUID, userId: 5, name: 'Sabine Kraft' }];
  assert.deepEqual(befund(w), { gilt: false, grund: 'fremder-fall', betreuer: 'Sabine Kraft' }, 'Fallfeld ueber Register vor dem Cache');
  w.__qmPersons = [];
  assert.equal(w.__briefkopfEigenBefund().grund, 'eigener-fall', 'kaltes Register: der Cache deckt ab');
  /* Befund 4: ausdrueckliche Nutzer-ID der Betreuer:in (Serverwahrheit hoechster Prioritaet) geht allem vor */
  st.caseData.rechtlicherBetreuerUserId = 5;
  assert.deepEqual(befund(w), { gilt: false, grund: 'fremder-fall', betreuer: '' }, 'Override sperrt; kaltes Register, fremder Cache-Nutzer: kein Name');
  assert.equal(w.__briefkopfStatus().text, 'Standard-Briefkopf · Ihre Anpassung ruht (Betreuung: andere Person)');
  w.__qmPersons = [{ key: 'p-x', userId: 5, name: 'Sabine Kraft' }];
  assert.deepEqual(befund(w), { gilt: false, grund: 'fremder-fall', betreuer: 'Sabine Kraft' }, 'Name zur Nutzer-ID aus dem Register');
  st.caseData.rechtlicherBetreuerUserId = '2';
  assert.equal(w.__briefkopfEigenBefund().grund, 'eigener-fall', 'Override schlaegt das Personenfeld');
  st.caseData.rechtlicherBetreuerUserId = 0;
  assert.equal(w.__briefkopfEigenBefund().grund, 'eigener-fall', '0 ist kein Override (wie der Server) - Cache entscheidet');
  delete st.caseData.rechtlicherBetreuerUserId;
  st.caseData.care.rechtlicherBetreuerUserId = 5;
  assert.equal(w.__briefkopfEigenBefund().gilt, false, 'Alias care.rechtlicherBetreuerUserId');
  delete st.caseData.care.rechtlicherBetreuerUserId;
  delete st.caseData.rechtlicherBetreuer;

  /* (f) Identitaet unbekannt (Datei-Betrieb ohne Server): positiver Fremdbeleg sperrt NICHT (fail-open) */
  w.__sigStore = { caregiverCached: () => ({ caseId: 'c1', caregiver: { userId: 5, name: 'Sabine Kraft' } }) };
  w.__currentUser = null;
  assert.deepEqual(befund(w), { gilt: true, grund: 'identitaet-unbekannt', betreuer: 'Sabine Kraft' });
  assert.deepEqual(klar(w, w.__briefkopfEffektiv()), MIT_EIGEN);
  assert.equal(w.__briefkopfStatus().text, 'Standard-Briefkopf · mit Ihrer Anpassung');
  /* (g) Demo-Modus (Nacharbeit P4): Vorfuehrkonten gelten nie als Betreuer:in der Vorfuehrfaelle -
     Identitaet unbekannt, positiver Fremdbeleg sperrt nicht (die Anpassung bleibt in der Vorfuehrung ausprobierbar) */
  w.__currentUser = { id: 7, displayName: 'Demo 1' };
  w.__demoModus = true;
  assert.deepEqual(befund(w), { gilt: true, grund: 'identitaet-unbekannt', betreuer: 'Sabine Kraft' }, 'Demo-Modus muss fail-open bleiben');
  delete w.__demoModus;
  assert.equal(befund(w).grund, 'fremder-fall', 'ohne Demo-Flag zaehlt der Fremdbeleg wieder');
  w.__currentUser = null;
  /* Erlaubnis weg: ruht bleibt null (Buero-Regel, kein Fallbezug) */
  w.__eigeneWahlGesperrt = (key) => key === 'briefkopf.eigeneErlaubt';
  assert.equal(w.__briefkopfEffektiv().eigen, null);
  assert.equal(w.__briefkopfStatus().ruht, null);
  assert.equal(w.__briefkopfStatus().text, 'Standard-Briefkopf');
  w.__eigeneWahlGesperrt = () => false;
  /* Editor-Vorschau: eigen bewusst null, kein „ruht“ */
  w.__currentUser = { id: 2, firstName: 'Erika', lastName: 'Test' };
  w.__briefkopfVorschauSetzen(w.__briefkopfStandardKarte());
  assert.equal(w.__briefkopfStatus().ruht, null);
  w.__briefkopfVorschauSetzen(null);
  assert.equal(w.__briefkopfStatus().ruht.grund, 'fremder-fall');

  /* (d) LOKAL: nur das Fallfeld zaehlt, nie der lokale Unterschriftenspeicher */
  const st2 = { caseData: { care: { fileNumber: '', courtName: 'Amtsgericht Musterstadt' } } };
  const l = kartenKontext(PROFIL, OFF, { state: st2 });
  l.__appMode = 'local';
  l.isBueroLocalMode = () => true;
  l.bueroLocal = { briefkopfEigen: { name: 'Erika Test', titel: 'M.A.', funktion: 'Fachkraft Rechtliche Betreuung' } };
  await l.__briefkopfLaden();
  l.__currentUser = { id: 1, firstName: 'Erika', lastName: 'Test' };
  assert.equal(l.__briefkopfEigenBefund().grund, 'ohne-fall');
  st2.caseData.rechtlicherBetreuer = 'sabine kraft';   // Namensschluessel des Lokalmodus
  /* Befund 3: Namensschluessel wird fuer die Anzeige mit grossen Wortanfaengen gezeigt */
  assert.deepEqual(befund(l), { gilt: false, grund: 'fremder-fall', betreuer: 'Sabine Kraft' });
  assert.deepEqual(klar(l, l.__briefkopfEffektiv()), OHNE_EIGEN);
  assert.equal(l.__briefkopfStatus().text, 'Standard-Briefkopf · Ihre Anpassung ruht (Betreuung: Sabine Kraft)');
  st2.caseData.rechtlicherBetreuer = 'anna-lena müller';
  assert.equal(l.__briefkopfEigenBefund().betreuer, 'Anna-Lena Müller');
  st2.caseData.rechtlicherBetreuer = 'erika test';
  assert.deepEqual(befund(l), { gilt: true, grund: 'eigener-fall', betreuer: 'Erika Test' });
  assert.deepEqual(klar(l, l.__briefkopfEffektiv()), MIT_EIGEN);
  /* Alt-Alias care.legalGuardian */
  delete st2.caseData.rechtlicherBetreuer; st2.caseData.care.legalGuardian = 'Sabine Kraft';
  assert.equal(l.__briefkopfEigenBefund().gilt, false);
  delete st2.caseData.care.legalGuardian;
  /* lokaler Unterschriftenspeicher liefert immer die angemeldete Person - darf NIE als Beleg zaehlen */
  l.__activeServerCaseId = 'c1';
  l.__sigStore = { caregiverCached: () => ({ caseId: 'c1', caregiver: { userId: 1, name: 'Erika Test' } }) };
  st2.caseData.rechtlicherBetreuer = 'sabine kraft';
  assert.equal(l.__briefkopfEigenBefund().gilt, false, 'Cache lokal ignoriert (Fallfeld sagt fremd)');
  delete st2.caseData.rechtlicherBetreuer;
  assert.equal(l.__briefkopfEigenBefund().grund, 'ohne-fall', 'Cache lokal ignoriert (kein Fallfeld = kein Beleg)');
  /* Personen-UUID lokal ueber das mitgereiste Register */
  st2.caseData.rechtlicherBetreuer = UUID;
  l.__qmPersons = [{ key: UUID, userId: null, name: 'Sabine Kraft' }];
  assert.equal(l.__briefkopfEigenBefund().gilt, false);
  l.__qmPersons = [{ key: UUID, userId: null, name: 'Erika Test' }];
  assert.equal(l.__briefkopfEigenBefund().gilt, true);

  /* AUSSENDIENST (Befund 2): Pseudo-Nutzer ohne Namen; Identitaet = Nutzer-ID und Vor-/Nachname des Erstellers
     aus __adKopf. Der freie Anzeigename (ersteller) ist KEIN Vergleichswert: nur er → kein-beleg (fail-open),
     nie fremder-fall. Ohne Kopf oder 'unbekannt' → Identitaet unbekannt. */
  l.__adSnapshotId = 'AD-20260906-1';
  l.__currentUser = { displayName: 'Außendienst', allowCaseManagement: true };
  l.__adKopf = null;
  st2.caseData.rechtlicherBetreuer = 'sabine kraft';
  assert.deepEqual(befund(l), { gilt: true, grund: 'identitaet-unbekannt', betreuer: 'Sabine Kraft' });
  l.__adKopf = { ersteller: 'unbekannt' };
  assert.equal(l.__briefkopfEigenBefund().grund, 'identitaet-unbekannt');
  l.__adKopf = { ersteller: 'czepp' };
  assert.deepEqual(befund(l), { gilt: true, grund: 'kein-beleg', betreuer: 'Sabine Kraft' }, 'Nutzername als Anzeigename: kein Beleg, nie fremd');
  l.__adKopf = { ersteller: 'Zepp, Christoph' };
  assert.deepEqual(befund(l), { gilt: true, grund: 'kein-beleg', betreuer: 'Sabine Kraft' }, 'freier Anzeigename darf nicht sperren');
  assert.deepEqual(klar(l, l.__briefkopfEffektiv()), MIT_EIGEN);
  l.__adKopf = { ersteller: 'Erika Test' };
  assert.equal(l.__briefkopfEigenBefund().grund, 'kein-beleg', 'auch ein passender Anzeigename ist kein Vergleichswert');
  l.__adKopf = { ersteller: 'Zepp, Christoph', erstellerVorname: 'Erika', erstellerNachname: 'Test' };
  assert.deepEqual(befund(l), { gilt: false, grund: 'fremder-fall', betreuer: 'Sabine Kraft' });
  assert.deepEqual(klar(l, l.__briefkopfEffektiv()), OHNE_EIGEN);
  st2.caseData.rechtlicherBetreuer = 'erika test';
  assert.equal(l.__briefkopfEigenBefund().grund, 'eigener-fall');
  assert.deepEqual(klar(l, l.__briefkopfEffektiv()), MIT_EIGEN);
  /* Nutzer-ID des Erstellers gegen das mitgereiste Register (userId) - vor dem Namen */
  st2.caseData.rechtlicherBetreuer = UUID;
  l.__qmPersons = [{ key: UUID, userId: 7, name: 'Sabine Kraft' }];
  l.__adKopf = { ersteller: 'czepp', erstellerUserId: '7' };
  assert.deepEqual(befund(l), { gilt: true, grund: 'eigener-fall', betreuer: 'Sabine Kraft' }, 'ID gewinnt, auch ohne Namen');
  l.__adKopf = { ersteller: 'czepp', erstellerUserId: 3, erstellerVorname: 'Sabine', erstellerNachname: 'Kraft' };
  assert.equal(l.__briefkopfEigenBefund().grund, 'fremder-fall', 'ID vor Name');
  l.__qmPersons = [{ key: UUID, userId: null, name: 'Sabine Kraft' }];
  l.__adKopf = { ersteller: 'czepp', erstellerUserId: 3 };
  assert.equal(l.__briefkopfEigenBefund().grund, 'kein-beleg', 'Person ohne Konto, Ersteller ohne Namen: kein Beleg');
  l.__adKopf = { ersteller: 'czepp', erstellerUserId: 3, erstellerVorname: 'Erika', erstellerNachname: 'Test' };
  assert.equal(l.__briefkopfEigenBefund().grund, 'fremder-fall');
  /* ausdruecklich uebergebener Fall zaehlt auch ohne geladenen Fall */
  st2.ui = { caseLoaded: false };
  assert.equal(l.__briefkopfEigenBefund({ fall: { rechtlicherBetreuer: 'sabine kraft' } }).gilt, false);
  assert.equal(l.__briefkopfEigenBefund().grund, 'ohne-fall');
});

test('Fund 12: Verdrahtung - Cache-Frische, Aussendienst-Kopf, Editor-Texte', () => {
  const karte = schnipsel('/* ═══ BRIEFKOPF-KARTE: ANFANG ═══', '/* ═══ BRIEFKOPF-KARTE: ENDE ═══ */');
  assert.ok(karte.includes("window.addEventListener('caseCaregiverReady',()=>{briefkopfInvalidieren();});"), 'Betreuer:in nachgeladen → Karte neu bewerten');
  assert.ok(karte.includes("const gilt=erlaubt&&bkEigenGiltFuer();"), 'Schranke sitzt im Aufrufer briefkopfEffektiv');
  assert.ok(karte.includes("const schluessel=(erlaubt?'1':'0')+(gilt?'1':'0')+'|'+JSON.stringify(eigen);"), 'Cache-Schluessel traegt den Fallbezug');
  assert.ok(karte.includes('window.__briefkopfEigenGiltFuer=bkEigenGiltFuer;') && karte.includes('window.__briefkopfEigenBefund=bkEigenBefund;'));
  /* Online-Falloeffnung waermt den Betreuer-Cache und leert die Karte; Schliessen/Wechseln leert sie ebenfalls */
  const oeffnen = html.indexOf('      applyServerCaseToState(caseId,cached.data);\n');
  assert.ok(oeffnen > 0);
  const q = html.slice(oeffnen, oeffnen + 1500);
  assert.ok(q.includes('window.__sigStore?.ensureCaregiver?.(caseId,true)'), 'ensureCaregiver beim Oeffnen');
  assert.ok(q.includes('window.__briefkopfInvalidieren?.()'), 'Invalidierung beim Oeffnen');
  const schliessen = html.indexOf('  function closeServerCase(){');
  assert.ok(html.slice(schliessen, schliessen + 2200).includes('window.__briefkopfInvalidieren?.()'), 'Invalidierung beim Schliessen');
  const wechsel = html.indexOf('  window.switchToCase=function(id){');
  assert.ok(html.slice(wechsel, wechsel + 1200).includes('window.__briefkopfInvalidieren?.()'), 'Invalidierung beim lokalen Fallwechsel');
  /* Aussendienst-Boot stellt den Kopf (ersteller) zur Laufzeit bereit */
  const boot = html.indexOf('  window.__adSnapshotId=kennung;\n');
  assert.ok(boot > 0);
  assert.ok(html.slice(boot, boot + 400).includes("window.__adKopf=(typeof kopf==='object'&&kopf)?kopf:null;"));
  assert.ok(html.slice(boot - 600, boot).includes("if(d&&d.kopf&&typeof d.kopf==='object')var kopf=d.kopf;"));
  /* Befund 2: der AD-Kopf traegt Nutzer-ID und Vor-/Nachname des Erstellers (Vergleichswerte), nicht nur den Anzeigenamen */
  assert.ok(html.includes("erstellerUserId:(window.__currentUser&&window.__currentUser.id!=null)?String(window.__currentUser.id):null,"), 'erstellerUserId im AD-Kopf');
  assert.ok(html.includes("erstellerVorname:(window.__currentUser&&window.__currentUser.firstName)||'',") && html.includes("erstellerNachname:(window.__currentUser&&window.__currentUser.lastName)||'',"), 'Vor-/Nachname im AD-Kopf');
  /* Befund 10: Leser-403 an der Waermstelle nur dokumentiert */
  assert.ok(q.includes('Befund 10'), 'Kommentar zum stillen 403 an der Waermstelle');
  /* Editor: Hilfetext, Live-Hinweise, Marke - gepinnte Literale bleiben */
  const a = html.indexOf('/* ═══ BRIEFKOPF-EDITOR');
  const ed = html.slice(a, html.indexOf('/* ═══ BRIEFKOPF-EDITOR: ENDE ═══ */'));
  assert.ok(ed.includes('Name, Titel und Funktionszeile für Ihre Ausgaben. Sie erscheinen auf Bürodokumenten ohne Fallbezug und auf Ausgaben zu Fällen, die Sie als rechtliche:r Betreuer:in führen. Bei Fällen anderer Betreuer:innen steht deren Name; Titel und Funktionszeile folgen dann der Bürovorgabe. Leere Felder übernehmen die Vorgabe.'));
  assert.ok(!ed.includes('dürfen Sie für Ihre Ausgaben anpassen'), 'alter Hilfetext weg');
  assert.ok(ed.includes("die Betreuung – dort wird die Bürovorgabe mit diesem Namen gedruckt.</div>'"));
  assert.ok(ed.includes('Ohne Anmeldung (Datei-/Außendienstbetrieb) gilt Ihre Anpassung für alle Ausgaben.'));
  assert.ok(ed.includes("W.__briefkopfEigenBefund==='function'?W.__briefkopfEigenBefund():null"));
  assert.ok(ed.includes("'Keine eigene Anpassung gespeichert.')+'</div>'+eigenLiveHinweis()+hinweisSchalter"), 'Live-Hinweis unter der Statuszeile');
  assert.ok(ed.includes('<span>Meine Anpassung</span><span class="set-reich set-reich-ich" title="Gilt für Ihre Ausgaben ohne Fallbezug und für Fälle, die Sie als Betreuer:in führen">Person</span>'));
  assert.ok(ed.includes("T(erg?'Meine Anpassung gespeichert – gilt ab jetzt für Ihre Ausgaben.'"), 'Toast unveraendert');
  /* Befund 8: Statuszeile im fremden Fall */
  assert.ok(ed.includes("(g?(eigenRuht()?'Gespeichert – ruht im geöffneten Fall.':'Gespeichert – gilt für Ihre Ausgaben.'):'Keine eigene Anpassung gespeichert.')+'</div>'+eigenLiveHinweis()+hinweisSchalter"), 'Statuszeile ruht/gilt');
});

/* ═══════════════════ 5. Befunde 1/3 (Nacharbeit 06.09.2026): der Druck folgt der Statuszeile ═══════════════════ */

test('Befunde 1/3: im fremden Fall druckt BETREUER die Betreuer:in des Falls, nicht die angemeldete Person', async () => {
  /* LOKAL: der lokale Unterschriftenspeicher liefert IMMER die angemeldete Person (ensureCaregiver) - bisher stand
     deshalb „Erika Test“ im Kopf, waehrend die Statuszeile „ruht (Betreuung: Sabine Kraft)“ meldete. */
  const st = { caseData: { care: { fileNumber: '', courtName: 'Amtsgericht Musterstadt' } } };
  const l = kartenKontext(PROFIL, OFF, { state: st, unifiedCaregiverName: () => 'Erika Test' });
  l.__appMode = 'local'; l.isBueroLocalMode = () => true;
  l.bueroLocal = { briefkopfEigen: { name: 'Erika Test', titel: 'M.A.', funktion: 'Fachkraft Rechtliche Betreuung' } };
  await l.__briefkopfLaden();
  l.__currentUser = { id: 1, firstName: 'Erika', lastName: 'Test' };
  l.__activeServerCaseId = 'c1';
  l.__sigStore = { caregiverCached: () => ({ caseId: 'c1', caregiver: { userId: 1, name: 'Erika Test' } }) };
  assert.equal(l.__briefkopfWert('BETREUER'), 'Erika Test', 'ohne Fallbezug: eigener Name (Anpassung)');
  st.caseData.rechtlicherBetreuer = 'sabine kraft';
  assert.equal(l.__briefkopfWert('BETREUER'), 'Sabine Kraft', 'fremder Fall: Betreuer:in des Falls, Wortanfaenge gross');
  assert.deepEqual(klar(l, l.__briefkopfEffektiv()), OHNE_EIGEN);
  assert.equal(l.__briefkopfStatus().text, 'Standard-Briefkopf · Ihre Anpassung ruht (Betreuung: Sabine Kraft)');
  /* Register kennt die Person (Schluessel ist eine ID, der Name trifft genau eine Person): Schreibweise aus dem Register */
  l.__qmPersons = [{ key: 'p-7', userId: null, firstName: 'Sabine', lastName: 'Kraft', name: 'Sabine Kraft' }, { key: 'p-8', userId: null, name: 'Erika Test' }];
  assert.equal(l.__briefkopfWert('BETREUER'), 'Sabine Kraft');
  assert.equal(l.__briefkopfEigenBefund().betreuer, 'Sabine Kraft');
  /* eigener Fall: Anpassung wirkt wieder (Cache-Schluessel traegt den Fallbezug) */
  st.caseData.rechtlicherBetreuer = 'erika test';
  assert.equal(l.__briefkopfWert('BETREUER'), 'Erika Test');
  assert.deepEqual(klar(l, l.__briefkopfEffektiv()), MIT_EIGEN);
  /* ausdruecklicher Kontext-Name geht weiter vor (Zeichner mit betreuer:) */
  st.caseData.rechtlicherBetreuer = 'sabine kraft';
  assert.equal(l.__briefkopfWert('BETREUER', { betreuer: 'Kontext Person' }), 'Kontext Person');
  /* Fall geschlossen (caseLoaded=false): wieder der eigene Name */
  st.ui = { caseLoaded: false };
  assert.equal(l.__briefkopfWert('BETREUER'), 'Erika Test');
  delete st.ui;

  /* DEMO: das Fallfeld traegt die feste Personen-ID 'demo-pers-1', das Demo-Konto nur einen Anzeigenamen. Kaltes
     Register: kein Beleg (fail-open) und Nachladen; warmes Register: Betreuer des Vorfuehrfalls im Kopf. */
  const d = kartenKontext(PROFIL, OFF, { state: { caseData: { rechtlicherBetreuer: 'demo-pers-1', care: { fileNumber: '', courtName: '' } } }, unifiedCaregiverName: () => 'Demo 1' });
  d.__appMode = 'local'; d.__demoModus = true; d.isBueroLocalMode = () => true;
  d.bueroLocal = { briefkopfEigen: { name: 'Demo Eins', titel: '', funktion: '' } };
  await d.__briefkopfLaden();
  d.__currentUser = { id: 40, displayName: 'Demo 1' };
  /* Nacharbeit P4: im Demo-Modus gelten Vorfuehrkonten nie als Betreuer:in - Identitaet unbekannt, die Anpassung
     bleibt in der Vorfuehrung ausprobierbar (fail-open), auch bei warmem Register. */
  d.__qmPersons = [];
  assert.equal(befund(d).grund, 'identitaet-unbekannt', 'Demo-Modus: fail-open');
  assert.equal(d.__briefkopfWert('BETREUER'), 'Demo Eins');
  d.__qmPersons = [{ key: 'demo-pers-1', userId: null, firstName: 'Max', lastName: 'Mustermensch', name: 'Max Mustermensch' }];
  assert.deepEqual(befund(d), { gilt: true, grund: 'identitaet-unbekannt', betreuer: 'Max Mustermensch' }, 'auch mit warmem Register bleibt die Vorfuehrung fail-open');
  assert.equal(d.__briefkopfWert('BETREUER'), 'Demo Eins', 'Demo: die Anpassung bleibt ausprobierbar');
  assert.equal(d.__briefkopfStatus().text, 'Standard-Briefkopf · mit Ihrer Anpassung');
  /* Ohne Demo-Flag (lokaler Betrieb mit Nicht-UUID-Schluessel): kaltes Register = kein Beleg + Nachladen,
     warmes Register = Betreuer:in des Vorfuehrfalls im Kopf. */
  delete d.__demoModus;
  d.__briefkopfEigenBefund._warm = false;
  let refreshs = 0; d.__qmPersons = []; d.__qmRefreshPersons = async () => { refreshs += 1; return []; };
  assert.deepEqual(befund(d), { gilt: true, grund: 'kein-beleg', betreuer: '' }, 'kaltes Register: der Schluessel ist kein Name und kein Beleg');
  d.__briefkopfEigenBefund();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(refreshs, 1, 'Register-Refresh auch fuer Nicht-UUID-Schluessel, hoechstens einmal');
  assert.equal(d.__briefkopfWert('BETREUER'), 'Demo Eins');
  d.__qmPersons = [{ key: 'demo-pers-1', userId: null, firstName: 'Max', lastName: 'Mustermensch', name: 'Max Mustermensch' }];
  assert.deepEqual(befund(d), { gilt: false, grund: 'fremder-fall', betreuer: 'Max Mustermensch' });
  assert.equal(d.__briefkopfWert('BETREUER'), 'Max Mustermensch', 'Demo: Betreuer des Vorfuehrfalls, nicht „Demo 1“');
  assert.equal(d.__briefkopfStatus().text, 'Standard-Briefkopf · Ihre Anpassung ruht (Betreuung: Max Mustermensch)');

  /* ONLINE mit kaltem Betreuer-Cache: Fallfeld + Register liefern den Namen, nicht der Bueroname aus unifiedCaregiverName */
  const sto = { caseData: { rechtlicherBetreuer: UUID, care: { fileNumber: '', courtName: '' } } };
  const o = kartenKontext(PROFIL, OFF, { fetch: FETCH_MIT_EIGEN, state: sto, unifiedCaregiverName: () => 'Max Mustermensch (B.A.)' });
  await o.__briefkopfLaden();
  o.__currentUser = { id: 2, firstName: 'Erika', lastName: 'Test' };
  o.__qmPersons = [{ key: UUID, userId: 5, name: 'Sabine Kraft' }];
  assert.equal(o.__briefkopfWert('BETREUER'), 'Sabine Kraft');
  assert.deepEqual(klar(o, o.__briefkopfEffektiv()), OHNE_EIGEN);
  /* Cache-Fall ohne Fallfeld: Name aus dem Cache (wie bisher), Anpassung ruht */
  delete sto.caseData.rechtlicherBetreuer;
  o.__activeServerCaseId = 'c1';
  o.__sigStore = { caregiverCached: () => ({ caseId: 'c1', caregiver: { userId: 5, name: 'Sabine Kraft-Cache' } }) };
  assert.equal(o.__briefkopfWert('BETREUER'), 'Sabine Kraft-Cache');
});
