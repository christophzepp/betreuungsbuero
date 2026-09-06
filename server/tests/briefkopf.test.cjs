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
  assert.ok(!lese.includes("['briefkopf'"), 'Lesen soll bei der Vorgabe (Fall-Sichtrecht) bleiben - keine eigene Leseschranke');
});

test('Rechte (ausgefuehrt): Schreiben verlangt isAdmin || canManageOfficeProfile, Lesen das Fall-Sichtrecht', async () => {
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
  sitzung = {};
  assert.equal((await ruf('GET', '/api/office-json/briefkopf')).status, 403, 'Ohne Fall-Sichtrecht darf die Karte nicht lesbar sein');
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
});

/* ═══════════════════ 2. Verdrahtung in der Auslieferung ═══════════════════ */

test('Menue: Eintrag hinter den Buerostammdaten, Indikator, Sprungziel und Sperrschalter', () => {
  const n = html.indexOf('const EIN_NAV=');
  const nav = html.slice(n, html.indexOf('\n];', n));
  const st = nav.indexOf("{id:'stammdaten'"), bk = nav.indexOf("{id:'briefkopf',name:'Briefkopf',recht:'menuSettingsOfficeProfile',lokal:true,datei:true}");
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
  assert.ok(html.includes('Nur-Lese-Ansicht — Änderungen am Briefkopf erfordern die Berechtigung „Bürostammdaten bearbeiten" oder Admin-Rechte.'),
    'Nur-Lese-Hinweis fehlt');
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
