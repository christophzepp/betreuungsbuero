'use strict';

/* Prüfstand für das einheitliche Einstellungsmenü (Online-Modus, 27.08.2026):
     1. Serverseitige Schranken der zwei neuen office_json-Schlüssel ('einstellungs_vorgaben',
        'rollen') - AUSGEFÜHRT gegen einen echten Router mit Wegwerf-Datenbank, nicht gegrept:
        Lesen für jede angemeldete Person, Schreiben nur Admin/Bürostammdaten-Recht.
     2. Die Vorgaben-Auflösung (Person > Rolle > Büro, zwingend/überschreibbar) - zeilengenau
        aus der Auslieferungsdatei geschnitten und im vm ausgeführt.
     3. Die Durchsetzung an den Effektiv-Lesern (stil, dlTarget, __defaultSendAccount) -
        ebenfalls ausgeschnitten und ausgeführt.
     4. Die SIEBTE Ausprägung der loadBueroLocal-Whitelist-Falle (Standard-Sendekonto und
        Standard-Kalender überlebten kein Neuladen) - als Roundtrip ausgeführt.
     5. Struktur-Pins: Blockzahl unverändert, GROUPS-Matcher, Sperr-Wächter in den beiden
        Vorlagen-Lesern. */

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
  const b = html.indexOf(bis, a);
  assert.ok(b > a, `Endanker fehlt hinter "${von}": ${bis}`);
  assert.equal(html.indexOf(von, a + 1), -1, `Anker ist nicht eindeutig: ${von}`);
  return html.slice(a, b);
}

/* ═══════════════════════════ 1. Serverseitige Schranken ═══════════════════════════ */

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'einstellungen-test-'));
process.env.DB_PATH = path.join(TEMP, 'einstellungen.sqlite3');

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
  app.use('/api/einstellungen-status', require('../src/modules/settings/status-routes'));
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

test('Server: Vorgaben und Rollen liest JEDE angemeldete Person - auch ohne Fallrechte', async () => {
  for (const key of ['einstellungs_vorgaben', 'rollen']) {
    sitzung = {};
    assert.equal((await ruf('GET', '/api/office-json/' + key)).status, 200,
      `GET ${key} ohne jedes Recht muss 200 liefern - sonst wirken Vorgaben nicht bei allen`);
    sitzung = { canViewCases: 1 };
    assert.equal((await ruf('GET', '/api/office-json/' + key)).status, 200);
  }
});

test('Server: Schreiben verlangt Admin oder Bürostammdaten-Recht', async () => {
  const faelle = [
    ['Admin', { isAdmin: true }, 200],
    ['Bürostammdaten verwalten', { canManageOfficeProfile: 1 }, 200],
    ['nur Fallrechte', { canViewCases: 1, canEditCases: 1 }, 403],
    ['nur Audit-Log', { canViewAuditLog: 1 }, 403],
    ['ohne alles', {}, 403]
  ];
  for (const key of ['einstellungs_vorgaben', 'rollen']) {
    for (const [name, s, erwartet] of faelle) {
      sitzung = s;
      const a = await ruf('PUT', '/api/office-json/' + key, { data: { version: 1 } });
      assert.equal(a.status, erwartet, `PUT ${key} als "${name}" ergab ${a.status} statt ${erwartet}`);
    }
  }
});

test('Server: Roundtrip - Gespeichertes kommt für eine rechtelose Sitzung zurück', async () => {
  sitzung = { canManageOfficeProfile: 1 };
  const vorgaben = { version: 1, vorgaben: [{ key: 'dateinamen.stil', stufe: 'buero', ziel: '', wert: 'underscore', zwingend: true }] };
  assert.equal((await ruf('PUT', '/api/office-json/einstellungs_vorgaben', { data: vorgaben })).status, 200);
  sitzung = {};
  const gelesen = await ruf('GET', '/api/office-json/einstellungs_vorgaben');
  assert.equal(gelesen.status, 200);
  assert.equal(JSON.parse(gelesen.text).data.vorgaben[0].wert, 'underscore', 'Geschriebenes kam nicht zurück');
});

test('Server: Rechte-Schablonen im rollen-Blob nur für Verwaltende (Redaktion)', async () => {
  sitzung = { isAdmin: true };
  const blob = {
    version: 1,
    rollen: [{ id: 'r1', name: 'Verwaltung', rechte: { local: { viewCases: true }, online: { viewCases: true } } }],
    zuweisungen: { 1: 'r1' }
  };
  assert.equal((await ruf('PUT', '/api/office-json/rollen', { data: blob })).status, 200);
  /* Einfache angemeldete Person: Namen und Zuweisungen ja (die Vorgaben-Auflösung braucht
     sie), die Rechte-Matrizen nein - die waren bislang nur über die admin-gegatete
     Nutzerliste sichtbar und das muss so bleiben. */
  sitzung = {};
  const normal = JSON.parse((await ruf('GET', '/api/office-json/rollen')).text).data;
  assert.equal(normal.rollen[0].rechte, null, 'Rechte-Schablone an Nicht-Verwaltende ausgeliefert');
  assert.equal(normal.rollen[0].name, 'Verwaltung', 'Rollenname muss lesbar bleiben');
  assert.equal(normal.zuweisungen['1'], 'r1', 'Zuweisungen müssen lesbar bleiben');
  sitzung = { canManageOfficeProfile: 1 };
  const verwaltend = JSON.parse((await ruf('GET', '/api/office-json/rollen')).text).data;
  assert.ok(verwaltend.rollen[0].rechte && verwaltend.rollen[0].rechte.local.viewCases === true,
    'Verwaltende müssen die Schablone unredigiert sehen');
});

test('Server: unbekannte Schlüssel verraten sich weiterhin nicht (Reihenfolge Recht vor Whitelist)', async () => {
  sitzung = {};
  assert.equal((await ruf('GET', '/api/office-json/gibtesnicht')).status, 403);
  sitzung = { canViewCases: 1 };
  assert.equal((await ruf('GET', '/api/office-json/gibtesnicht')).status, 404);
});

/* ═══════════════════════════ 2. Vorgaben-Auflösung (vm) ═══════════════════════════ */

const EIN_QUELLE = schnipsel('/* einstellungen-online-v1-start */', '/* einstellungen-online-v1-ende */');

function einKontext() {
  const ctx = {
    window: {
      __appMode: 'online',
      __currentUser: { id: 5, isAdmin: false },
      addEventListener: () => {},
      bueroLocal: {}
    },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    fetch: async () => ({ ok: false }),
    setTimeout: () => {},
    E: (s) => String(s == null ? '' : s),
    A: (s) => String(s == null ? '' : s),
    T: () => {},
    console
  };
  vm.createContext(ctx);
  const griffe = vm.runInContext('(function(){' + EIN_QUELLE
    + '\nreturn {einAufloesen,EIN_KATALOG,setVorgaben:(v)=>{einVorgaben=v;},setRollen:(r)=>{einRollenDaten=r;}};})()',
  ctx, { filename: 'einstellungen-baustein.js' });
  return { ctx, griffe };
}

test('Auflösung: Person schlägt Rolle schlägt Büro, zwingend reist mit', () => {
  const { griffe } = einKontext();
  griffe.setRollen({ rollen: [{ id: 'r1', name: 'Verwaltung' }], zuweisungen: { 5: 'r1' } });
  griffe.setVorgaben([
    { key: 'dateinamen.stil', stufe: 'buero', ziel: '', wert: 'underscore', zwingend: false },
    { key: 'dateinamen.stil', stufe: 'rolle', ziel: 'r1', wert: 'spaces', zwingend: true },
    { key: 'dateinamen.stil', stufe: 'person', ziel: '7', wert: 'underscore', zwingend: false }
  ]);
  const p = griffe.einAufloesen('dateinamen.stil', 7);
  assert.equal(p.stufe, 'person'); assert.equal(p.wert, 'underscore'); assert.equal(p.zwingend, false);
  const r = griffe.einAufloesen('dateinamen.stil', 5);
  assert.equal(r.stufe, 'rolle'); assert.equal(r.wert, 'spaces'); assert.equal(r.zwingend, true);
  const b = griffe.einAufloesen('dateinamen.stil', 9);
  assert.equal(b.stufe, 'buero'); assert.equal(b.wert, 'underscore');
  assert.equal(griffe.einAufloesen('gibt.es.nicht', 5), undefined);
});

test('Auflösung: __einstellungenVorgabe wirkt nur online und nur angemeldet', () => {
  const { ctx, griffe } = einKontext();
  griffe.setRollen({ rollen: [], zuweisungen: {} });
  griffe.setVorgaben([{ key: 'dateinamen.stil', stufe: 'buero', ziel: '', wert: 'underscore', zwingend: true }]);
  assert.equal(ctx.window.__einstellungenVorgabe('dateinamen.stil').wert, 'underscore');
  ctx.window.__appMode = 'local';
  assert.equal(ctx.window.__einstellungenVorgabe('dateinamen.stil'), undefined,
    'Im Lokal-Modus dürfen die Online-Vorgaben nicht greifen');
  ctx.window.__appMode = 'online'; ctx.window.__currentUser = null;
  assert.equal(ctx.window.__einstellungenVorgabe('dateinamen.stil'), undefined);
});

test('Auflösung: __eigeneWahlGesperrt genau bei Vorgabe-Wert AUS', () => {
  const { ctx, griffe } = einKontext();
  griffe.setRollen({ rollen: [], zuweisungen: {} });
  griffe.setVorgaben([{ key: 'betreff.eigeneErlaubt', stufe: 'buero', ziel: '', wert: false, zwingend: true }]);
  assert.equal(ctx.window.__eigeneWahlGesperrt('betreff.eigeneErlaubt'), true);
  griffe.setVorgaben([{ key: 'betreff.eigeneErlaubt', stufe: 'buero', ziel: '', wert: true, zwingend: true }]);
  assert.equal(ctx.window.__eigeneWahlGesperrt('betreff.eigeneErlaubt'), false);
  griffe.setVorgaben([]);
  assert.equal(ctx.window.__eigeneWahlGesperrt('betreff.eigeneErlaubt'), false, 'Ohne Vorgabe ist nichts gesperrt');
});

test('Katalog: die verdrahteten Schlüssel sind vollständig und eindeutig', () => {
  const { griffe } = einKontext();
  const keys = Array.from(griffe.EIN_KATALOG, (k) => k.key);
  for (const k of ['darstellung.farbschema', 'darstellung.dunkelAutomatik', 'dateinamen.stil',
    'dateinamen.downloadZiel', 'dateinamen.eigeneVorlagenErlaubt', 'betreff.eigeneErlaubt',
    'versand.standardkonto']) {
    assert.ok(keys.includes(k), `Katalog-Schlüssel fehlt: ${k}`);
  }
  assert.equal(new Set(keys).size, keys.length, 'Katalog-Schlüssel müssen eindeutig sein');
});

/* ═══════════════════ 3. Durchsetzung an den Effektiv-Lesern (vm) ═══════════════════ */

function leserKontext(vorgabe, bueroLocal, uiPrefs) {
  const ctx = {
    window: {
      __einstellungenVorgabe: (key) => (vorgabe && vorgabe.key === key) ? vorgabe : undefined,
      bueroLocal: bueroLocal || {},
      __uiPrefs: uiPrefs || {}
    }
  };
  vm.createContext(ctx);
  return ctx;
}

test('Leser: stil() folgt der zwingenden Vorgabe, sonst der eigenen Wahl', () => {
  const quelle = schnipsel('  function stil(){', '  window.__fileNameStyleEffective');
  const zwingend = leserKontext({ key: 'dateinamen.stil', wert: 'underscore', zwingend: true }, { fileNameStyle: 'spaces' });
  assert.equal(vm.runInContext('(function(){' + quelle + '\nreturn stil();})()', zwingend), 'underscore',
    'Die zwingende Vorgabe muss die eigene Wahl schlagen');
  const frei = leserKontext({ key: 'dateinamen.stil', wert: 'underscore', zwingend: false }, { fileNameStyle: 'spaces' });
  assert.equal(vm.runInContext('(function(){' + quelle + '\nreturn stil();})()', frei), 'spaces',
    'Die überschreibbare Vorgabe darf die eigene Wahl nicht schlagen');
  const ohneEigene = leserKontext({ key: 'dateinamen.stil', wert: 'underscore', zwingend: false }, {});
  assert.equal(vm.runInContext('(function(){' + quelle + '\nreturn stil();})()', ohneEigene), 'underscore',
    'Ohne eigene Wahl gilt die Vorgabe');
});

test('Leser: dlTarget() ebenso', () => {
  const quelle = schnipsel('  const DL_MODI=', '  window.__dlTargetInfo');
  const zwingend = leserKontext({ key: 'dateinamen.downloadZiel', wert: 'intern', zwingend: true }, { downloadTarget: 'downloads' });
  assert.equal(vm.runInContext('(function(){' + quelle + '\nreturn dlTarget();})()', zwingend), 'intern');
  const frei = leserKontext({ key: 'dateinamen.downloadZiel', wert: 'intern', zwingend: false }, { downloadTarget: 'downloads' });
  assert.equal(vm.runInContext('(function(){' + quelle + '\nreturn dlTarget();})()', frei), 'downloads');
});

test('Leser: __defaultSendAccount() ebenso', () => {
  const quelle = schnipsel('  function bl(){return', '  function saveBL(){');
  const bau = (vorgabe, lokal) => {
    const ctx = leserKontext(vorgabe, lokal, {});
    return vm.runInContext('(function(){var SEP="";' + quelle + '\nreturn window.__defaultSendAccount();})()', ctx);
  };
  assert.equal(bau({ key: 'versand.standardkonto', wert: 'k9', zwingend: true }, { defaultSendAccount: 'k1' }), 'k9');
  assert.equal(bau({ key: 'versand.standardkonto', wert: 'k9', zwingend: false }, { defaultSendAccount: 'k1' }), 'k1');
  assert.equal(bau({ key: 'versand.standardkonto', wert: 'k9', zwingend: false }, {}), 'k9');
});

test('Leser: die Sperr-Wächter stehen in beiden Vorlagen-Lesern', () => {
  assert.ok(html.includes("window.__eigeneWahlGesperrt('dateinamen.eigeneVorlagenErlaubt')"),
    'effectiveTpl ohne Sperr-Wächter für eigene Dateinamen-Vorlagen');
  assert.ok(html.includes("window.__eigeneWahlGesperrt('betreff.eigeneErlaubt')"),
    'betreffVorlageEffektiv ohne Sperr-Wächter für eigene Betreff-Bausteine');
});

/* ═════════════ 4. loadBueroLocal: siebte Ausprägung der Whitelist-Falle ═════════════ */

test('Lokal-Whitelist: Standard-Sendekonto und Standard-Kalender überleben das Neuladen', () => {
  const quelle = schnipsel('function loadBueroLocal(){', 'function saveBueroLocal(');
  const gespeichert = {
    defaultSendAccount: 'konto7',
    defaultCalendar: { connectionId: 'c1', calendarRef: 'ref1' },
    defaultTaskList: { connectionId: 'c1', calendarRef: 'ref2' },
    defaultFristCalendar: { connectionId: 'c1', calendarRef: 'ref3' },
    defaultFristTaskList: { connectionId: 'c1', calendarRef: 'ref4' },
    fileNameStyle: 'underscore'
  };
  const ctx = {
    BUERO_LOCAL_KEY: 'test',
    localStorage: { getItem: () => JSON.stringify(gespeichert) },
    emptyOfficeProfile: () => ({}),
    emptyMapSettings: () => ({})
  };
  vm.createContext(ctx);
  const ergebnis = vm.runInContext('(function(){' + quelle + '\nreturn loadBueroLocal();})()', ctx);
  assert.equal(ergebnis.defaultSendAccount, 'konto7', 'defaultSendAccount ging beim Neuladen verloren');
  assert.equal(ergebnis.defaultCalendar.calendarRef, 'ref1', 'defaultCalendar ging beim Neuladen verloren');
  assert.equal(ergebnis.defaultFristTaskList.calendarRef, 'ref4', 'defaultFristTaskList ging beim Neuladen verloren');
  assert.equal(ergebnis.fileNameStyle, 'underscore', 'Bestandsfeld beschädigt');
  /* Leerer Speicher: die neuen Felder haben saubere Leerwerte. */
  ctx.localStorage = { getItem: () => null };
  const leer = vm.runInContext('(function(){' + quelle + '\nreturn loadBueroLocal();})()', ctx);
  assert.equal(leer.defaultSendAccount, '');
  assert.equal(leer.defaultCalendar, null);
});

/* ═══════════════════════════ 5. Struktur-Pins ═══════════════════════════ */

test('Benachrichtigungen: eigener Bereich statt versteckt in den Mail-Einstellungen', () => {
  /* Die vier Schalter und die Tages-Übersicht lagen server-gestützt in mail_prefs, aber nur
     im Mail-Panel erreichbar - genau die „über mehrere Dialoge verstreut"-Lage des Entwurfs.
     Der neue Bereich nutzt DIESELBE Route, es darf keine zweite Wahrheit entstehen. */
  assert.ok(html.includes('window.__mxNotify={'), 'Brücke zu den Mail-Prefs fehlt');
  assert.ok(html.includes("jpost('/api/mailbox/prefs',{prefs},'PUT')"),
    'Die Brücke schreibt nicht über die bestehende Route');
  const arten = html.indexOf('const EIN_NARTEN=[');
  assert.ok(arten > 0, 'Liste der Benachrichtigungsarten fehlt');
  /* EIN_NARTEN trägt seit dem Umbau die KATALOG-Schlüssel (damit jede Zeile eine
     Vorgabespalte bekommt); die Feldnamen der Mail-Prefs liegen in NFELD. */
  const nfeld = html.indexOf('const NFELD={');
  assert.ok(nfeld > 0, 'Zuordnung Katalog-Schlüssel → Mail-Pref fehlt');
  for (const k of ['notifyMail', 'notifyEvents', 'notifyTasks', 'notifyFristen']) {
    assert.ok(html.slice(nfeld, nfeld + 400).includes(k), `Benachrichtigungsart fehlt: ${k}`);
  }
  assert.ok(html.includes('einSystemhinweisHTML'), 'Berechtigungs-Hinweis des Browsers fehlt');
  /* Nutzerrückfrage 27.08.: „wieso kann ich nicht für ALLE Benachrichtigungen Einstellungen
     setzen?" - vorher trug nur „Fristen" eine Vorgabespalte. Jetzt laufen alle vier über
     denselben Katalog-Bauer und werden auch alle vier durchgesetzt. */
  const alleVier = ['benachrichtigung.mail', 'benachrichtigung.termine',
    'benachrichtigung.aufgaben', 'benachrichtigung.fristen'];
  const keys = EIN_KAT_KEYS();
  for (const k of alleVier) assert.ok(keys.includes(k), `Katalog-Eintrag fehlt: ${k}`);
  assert.ok(html.includes("const arten=EIN_NARTEN.map(k=>einZeileHTML(EIN_KAT_MAP[k])).join('')"),
    'Die Meldungsarten kommen nicht aus dem Katalog - dann fehlt ihnen die Vorgabespalte');
  /* Durchsetzung an den drei Wirkorten (Fristen war bereits verdrahtet). */
  assert.ok(html.includes("window.__benachrichtigungAn('mail',MX.prefs&&MX.prefs.notifyMail)"),
    'Die Bürovorgabe für neue E-Mail wird nicht durchgesetzt');
  assert.ok(html.includes("window.__benachrichtigungAn('termine',np.notifyEvents)"),
    'Die Bürovorgabe für Termine wird nicht durchgesetzt');
  assert.ok(html.includes("window.__benachrichtigungAn('aufgaben',np.notifyTasks)"),
    'Die Bürovorgabe für Aufgaben wird nicht durchgesetzt');
  /* Eine überschreibbare Vorgabe muss greifen, solange die Person nichts eigenes gewählt hat. */
  assert.ok(html.includes('if(eigenerWert===undefined&&vg)return vg.wert!==false;'),
    'Überschreibbare Benachrichtigungs-Vorgaben wären wirkungslos');
  /* Bei zwingender Vorgabe muss das Feld den GELTENDEN Wert zeigen. Vorher zeigte es die
     weiterhin gespeicherte, aber unwirksame eigene Wahl - also das Gegenteil dessen, was
     gilt (am echten Server aufgefallen, zweite Ausprägung nach dem Fristen-Fall). */
  assert.ok(html.includes("const zeige=(v&&v.zwingend)?v.wert:eigene;"),
    'Die Zeile zeigt bei zwingender Vorgabe weiterhin die eigene Wahl');
  assert.ok(html.includes("+'<option value=\"ein\"'+(zeige!==false?' selected':'')"),
    'Der Schalter richtet sich nicht nach dem geltenden Wert');
  /* Der Zeitpunkt der Tagesmeldung war eine handgebaute Zeile OHNE Vorgabespalte
     (Nutzerrückfrage 27.08., vierter Fall desselben Musters). Jetzt zwei Katalog-Einträge -
     damit auch hier Büro/Rolle/Person steuerbar sind - und durchgesetzt in mxReminderTick. */
  for (const k of ['benachrichtigung.tagesmeldung', 'benachrichtigung.tagesmeldungZeit']) {
    assert.ok(EIN_KAT_KEYS().includes(k), `Katalog-Eintrag fehlt: ${k}`);
  }
  assert.ok(!html.includes('data-ein-ndigest'), 'Die handgebaute Zeile steht noch (ohne Vorgabespalte)');
  assert.ok(html.includes('window.__digestModus=function()') && html.includes('window.__digestZeit=function()'),
    'Leser für Modus/Uhrzeit der Tagesmeldung fehlen');
  assert.ok(html.includes("const digestModus=(typeof window.__digestModus==='function')?window.__digestModus()"),
    'mxReminderTick liest den Zeitpunkt nicht über die Vorgaben-Kette');
  assert.ok(html.includes("if(kat.typ==='zeit')return '<input type=\"time\""),
    'Feldart „zeit" fehlt im Katalog-Bauer');
  /* Die Seite entsteht erst in danach() - ohne Nach-Verdrahtung hingen Vorlauf und
     Steuerspalte in der Luft (im Prüflauf am echten Server aufgefallen). */
  const verdraht = html.indexOf('function einBenachrVerdrahten(host){');
  assert.ok(verdraht > 0 && html.slice(verdraht, verdraht + 500).includes('einSeiteVerdrahten(host);'),
    'Nach-Verdrahtung der Benachrichtigungs-Seite fehlt');
});

test('Benachrichtigungen: der Fristen-Vorlauf ist nicht mehr hart verdrahtet', () => {
  /* Die 7 stand an ZWEI Stellen im Code: im roten Fristen-Zähler und in der Tagesmeldung.
     Beide lesen jetzt denselben Wert, der Büro-/Rollen-/Personen-Vorgaben kennt. */
  assert.ok(html.includes('window.__fristenVorlaufTage=function()'), 'Vorlauf-Leser fehlt');
  assert.ok(!html.includes('return Math.round((due-today)/86400000)<=7;'),
    'Der Fristen-Indikator hat weiterhin die harte 7');
  assert.ok(html.includes('Math.round((due-today)/86400000)<=vorlauf'),
    'Der Fristen-Indikator liest den konfigurierten Vorlauf nicht');
  assert.ok(!html.includes('const limit=new Date(now+7*86400000)'),
    'Die Tagesmeldung hat weiterhin die harte 7');
  assert.ok(html.includes('new Date(now+vorlaufTage*86400000)'),
    'Die Tagesmeldung liest den konfigurierten Vorlauf nicht');
  const routen = lies('src', 'modules', 'mail', 'mailbox-routes.js');
  assert.match(routen, /fristenVorlauf: \(v\) => \(\(Number\(v\) >= 1 && Number\(v\) <= 60\)/,
    'Server prüft den Vorlauf nicht auf einen sinnvollen Bereich');
  /* fristenVorlauf darf NICHT in den Defaults stehen: sonst liefert GET den Schlüssel immer,
     der Client hält ihn für eine eigene Wahl - und eine überschreibbare Büro-Vorgabe könnte
     nie greifen (bestätigter Review-Befund: toter Zweig). */
  const defaults = /const PREF_DEFAULTS = \{[^}]*\}/.exec(routen);
  assert.ok(defaults, 'PREF_DEFAULTS nicht gefunden');
  assert.ok(!defaults[0].includes('fristenVorlauf'),
    'fristenVorlauf steht in den Defaults - die überschreibbare Vorgabe wäre wirkungslos');
  /* Teil-Merge statt Vollersatz: sonst löscht ein magerer PUT fremde Felder (Signatur, Bcc). */
  assert.ok(routen.includes("if (!Object.prototype.hasOwnProperty.call(p, key)) continue;"),
    'PUT /prefs ersetzt weiterhin den ganzen Datensatz statt nur die gesendeten Schlüssel');
  /* Eine zwingende Büro-Vorgabe muss die Fristenmeldung erzwingen können. */
  assert.ok(html.includes('window.__benachrichtigungAn=function'), 'Vorgabe-Wächter fehlt');
  assert.ok(html.includes("window.__benachrichtigungAn('fristen',np.notifyFristen)"),
    'Die Tagesmeldung fragt den Vorgabe-Wächter nicht');
});

test('Kuratierung: Gruppen-Überschriften und einheitliche Vorgabespalte', () => {
  const bereich = html.indexOf('function einSeiteBereich(bereich,titel,untertitel){');
  assert.ok(bereich > 0, 'einSeiteBereich nicht gefunden');
  assert.ok(html.slice(bereich, bereich + 800).includes("'<div class=\"set-abschnitt\">'"),
    'Bereichsseiten bauen keine Gruppen-Überschriften');
  /* Die Steuerspalte umbrach je nach Inhalt unterschiedlich - jetzt feste Zeilen. */
  assert.ok(html.includes('.set-vneu{display:flex;flex-direction:column'),
    'Vorgabespalte ist nicht auf feste Zeilen umgestellt');
  assert.ok(html.includes('class="set-vreihe set-vfuss"'), 'Fußzeile der Vorgabespalte fehlt');
  /* Darstellung: drei echte Einstellungen in zwei Gruppen. */
  /* Der Willkommensbildschirm hatte zwischenzeitlich KEINE Vorgabespalte (weil nichts
     durchgesetzt wurde) - das war eine wortlose Lücke. Jetzt gibt es die Spalte wieder UND
     der Modus-Intro-Block setzt sie durch (Nutzerrückfrage 27.08.). */
  assert.ok(!html.includes("nurEigen:true"), 'Der Willkommensbildschirm hat weiterhin keine Vorgabespalte');
  assert.ok(html.includes("window.__einstellungenVorgabe('darstellung.willkommen')"),
    'Der Modus-Intro-Block liest die Bürovorgabe nicht');
  assert.ok(html.includes('window.__einVorgabenBereit'),
    'Ohne Bereitschafts-Versprechen greift die Vorgabe beim ersten Start ins Leere');
  const launchIdx = html.indexOf('async function launch(detail){');
  assert.ok(launchIdx > 0, 'launch() nicht gefunden');
  const launchBlock = html.slice(launchIdx, launchIdx + 2200);
  assert.ok(launchBlock.includes('await window.__einVorgabenBereit()'),
    'launch() wartet die Vorgaben nicht ab');
  assert.ok(launchBlock.includes('if(vorgabe.wert===false)return;'),
    'Eine zwingende Vorgabe "aus" unterdrückt die Einführung nicht');
  const darst = EIN_KAT_KEYS().filter((k) => k.startsWith('darstellung.'));
  assert.deepEqual(darst.sort(), ['darstellung.dunkelAutomatik', 'darstellung.farbschema', 'darstellung.willkommen'],
    'Darstellungs-Seite hat nicht die drei erwarteten Einstellungen');
  assert.ok(html.includes("fetch('/api/user-prefs/mode-intro'"),
    'Willkommensbildschirm ist nicht an seine echte Route angeschlossen');
});

test('Vorgaben: je Person einzeln steuerbar, mehrere in einem Zug', () => {
  /* Nutzerrückfrage 27.08.: „wieso kann ich nur für einen User etwas festsetzen?"
     Die Personenwahl ist jetzt eine Mehrfachauswahl, und der Setzen-Handler legt JE
     ausgewählter Person eine eigene Zeile an - jede bleibt einzeln änder- und entfernbar. */
  assert.ok(html.includes('class="set-vpers" multiple size="4"'),
    'Personenwahl ist keine Mehrfachauswahl');
  const setz = html.indexOf("host.querySelectorAll('[data-ein-vsetzen]')");
  assert.ok(setz > 0, 'Setzen-Handler nicht gefunden');
  const block = html.slice(setz, setz + 1600);
  assert.ok(block.includes(".selectedOptions].map(o=>o.value)"),
    'Der Setzen-Handler liest nur eine einzelne Person');
  assert.ok(block.includes('ziele.forEach(zl=>neu.push({key,stufe,ziel:zl,wert,zwingend}))'),
    'Es entsteht keine eigene Vorgabe-Zeile je Person');
  assert.ok(block.includes("ziele.indexOf(String(z.ziel==null?'':z.ziel))>=0"),
    'Bestehende Zeilen der gewählten Personen werden nicht ersetzt');
});

test('Kuratierung: die Vorgabespalte hat gegliederte, volle Zeilen', () => {
  /* Vorher teilten sich Stufenwahl, Rollenliste und Personenliste EINE Flex-Zeile: der
     Stufentext war abgeschnitten ("Für einzelne Persone") und die Namensliste lief über den
     Rand des Kastens (Nutzerfund 27.08.). */
  assert.ok(html.includes("<span class=\"set-vlabel\">Gilt für</span>"), 'Beschriftung der Zielwahl fehlt');
  assert.ok(html.includes("<span class=\"set-vlabel\">Wert</span>"), 'Beschriftung des Wertfelds fehlt');
  assert.ok(html.includes("_rowR\" hidden>") && html.includes("_rowP\" hidden>"),
    'Rollen- und Personenwahl haben keine eigenen Zeilen');
  assert.ok(html.includes('class="set-vhint"'), 'Hinweis zur Mehrfachauswahl fehlt');
  /* Der Umbau auf Zeilen brachte einen eigenen Fehler mit: display:flex schlägt die
     UA-Regel [hidden]{display:none}, wodurch die Rollenliste dauerhaft sichtbar blieb. */
  assert.ok(html.includes('.set-vreihe[hidden]{display:none}'),
    'Ausgeblendete Zeilen bleiben sichtbar (display:flex schlägt [hidden])');
  /* Die Umschaltung muss die ZEILEN schalten, nicht die Selects darin. */
  const um = html.indexOf("host.querySelectorAll('[data-ein-stufe]')");
  assert.ok(um > 0 && html.slice(um, um + 600).includes("getElementById(kid+'_rowR')"),
    'Die Umschaltung greift noch auf die Selects statt auf die Zeilen');
});

test('Vorgaben: die Rollen-Wahl verschweigt sich nicht mehr', () => {
  /* Vorher war der Punkt ohne angelegte Rolle wortlos verschwunden - niemand erfuhr, warum. */
  assert.ok(html.includes(">Eine Rolle'+(rollen?'':' (noch keine angelegt)')+'</option>"),
    'Rollen-Wahl fehlt weiterhin, wenn keine Rolle angelegt ist');
  assert.ok(html.includes('data-ein-rollenhinweis'), 'Hinweis auf die Rollenverwaltung fehlt');
  assert.ok(html.includes('data-ein-zurollen'), 'Sprung zur Rollenverwaltung fehlt');
});

test('Mail-Prefs (ausgeführt): ein Teil-PUT löscht keine fremden Felder', async () => {
  /* Der schwerste Befund der Runde: Der frühere Vollersatz-PUT setzte jedes NICHT
     mitgeschickte Feld auf den Default. Ein einzelner Benachrichtigungs-Schalter hätte damit
     Signatur, Bcc und Sendeverzögerung gelöscht - und das alte Mail-Panel setzte bei jedem
     Speichern den Fristen-Vorlauf auf 7 zurück. Hier AUSGEFÜHRT gegen den echten Router. */
  const express = require('express');
  const alterLog = console.log;
  let db;
  try {
    console.log = (...a) => { if (!String(a[0] || '').startsWith('[Fallrechte]')) alterLog(...a); };
    db = require('../src/database/index');
  } finally { console.log = alterLog; }
  if (!db.prepare('SELECT 1 FROM users WHERE id = 2').get()) {
    db.prepare(`INSERT INTO users (id,username,password_hash,display_name,allow_local,allow_online,is_admin)
      VALUES (2,'mailpruef','x','Mailpruef',1,1,0)`).run();
  }
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: 2, mode: 'online' }; next(); });
  app.use('/api/mailbox', require('../src/modules/mail/mailbox-routes'));
  const srv = app.listen(0);
  const port = srv.address().port;
  const ruf2 = (methode, pfad, koerper) => new Promise((auf, ab) => {
    const daten = koerper === undefined ? null : JSON.stringify(koerper);
    const a = http.request({ port, method: methode, path: pfad,
      headers: daten ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(daten) } : {} },
    (r) => { let t = ''; r.on('data', (c) => { t += c; }); r.on('end', () => auf({ status: r.statusCode, daten: JSON.parse(t || '{}') })); });
    a.on('error', ab); if (daten) a.write(daten); a.end();
  });
  try {
    /* Vollständiger Stand wie ihn das alte Mail-Panel schreibt, plus eigener Vorlauf. */
    await ruf2('PUT', '/api/mailbox/prefs', { prefs: {
      sendDelay: 15, defaultBcc: 'archiv@buero.example', personalSignature: 'Mit freundlichen Grüßen',
      quoteStyle: 'bottom', fristenVorlauf: 14
    } });
    /* Ein einzelner Schalter - früher hätte das alles andere auf Standard gesetzt. */
    await ruf2('PUT', '/api/mailbox/prefs', { prefs: { notifyTasks: false } });
    const nach = (await ruf2('GET', '/api/mailbox/prefs')).daten.prefs;
    assert.equal(nach.notifyTasks, false, 'Der gesendete Schlüssel wurde nicht gespeichert');
    assert.equal(nach.personalSignature, 'Mit freundlichen Grüßen', 'Die Signatur wurde gelöscht');
    assert.equal(nach.defaultBcc, 'archiv@buero.example', 'Der Standard-Bcc wurde gelöscht');
    assert.equal(nach.sendDelay, 15, 'Die Sendeverzögerung wurde zurückgesetzt');
    assert.equal(nach.quoteStyle, 'bottom', 'Der Zitierstil wurde zurückgesetzt');
    assert.equal(nach.fristenVorlauf, 14, 'Der Fristen-Vorlauf wurde zurückgesetzt');
    /* Das alte Mail-Panel kennt fristenVorlauf nicht - sein Speichern darf ihn nicht kippen. */
    await ruf2('PUT', '/api/mailbox/prefs', { prefs: {
      sendDelay: 15, defaultAccountId: '', quoteStyle: 'bottom', signaturePosition: 'above',
      attachmentWarning: true, externalWarning: false, defaultBcc: 'archiv@buero.example',
      archiveToDoku: false, personalSignature: 'Neue Signatur',
      notifyMail: true, notifyEvents: true, notifyTasks: false, notifyFristen: true,
      digestMode: 'firstStart', digestTime: '09:00'
    } });
    const nach2 = (await ruf2('GET', '/api/mailbox/prefs')).daten.prefs;
    assert.equal(nach2.fristenVorlauf, 14, 'Das alte Mail-Panel setzt den Vorlauf weiterhin zurück');
    assert.equal(nach2.personalSignature, 'Neue Signatur', 'Das Panel konnte die Signatur nicht ändern');
    /* „Der Vorgabe folgen": null LÖSCHT den eigenen Wert, der Schlüssel verschwindet. */
    await ruf2('PUT', '/api/mailbox/prefs', { prefs: { fristenVorlauf: null } });
    const nach3 = (await ruf2('GET', '/api/mailbox/prefs')).daten.prefs;
    assert.equal(nach3.fristenVorlauf, undefined,
      'Der eigene Vorlauf lässt sich nicht löschen - kein Weg zurück zur Büro-Vorgabe');
  } finally { srv.close(); }
});

test('Layout: die Dialoggröße überlebt eingebettete Bausteine', () => {
  /* Mehrere Module verkleinern die Modal-Box, sobald ihr Inhalt erkannt wird - gedacht für
     ihren EIGENEN Dialog. Eingebettet schrumpfte das Einstellungsmenü dadurch von 1552 auf
     1080 px (Datenadministration, Nutzerfund 27.08.). Diese Regeln haben die höhere
     Spezifität, deshalb muss die Wirtsgröße ausdrücklich festgehalten sein. */
  assert.match(html, /#modal:has\(\.data-admin-view\):not\(:has\(\.admin-shell\)\) \.modal-box\{max-width:1080px/,
    'Die verkleinernde Regel ist weg - die Absicherung wäre dann sinnlos');
  assert.ok(html.includes('#modal .modal-box:has(.set-app){width:min(1560px,97vw)!important;max-width:none!important;height:min(950px,95vh)!important;max-height:95vh!important}'),
    'Die Dialoggröße ist nicht gegen eingebettete Module abgesichert');
  /* Der Mobil-Vollbildfall muss weiterhin gewinnen. */
  assert.ok(html.includes('html.mobile-online-active #modal:has(.set-app) .modal-box{width:100vw!important'),
    'Die mobile Vollbild-Regel verliert jetzt gegen die abgesicherte Größe');
});

test('Layout: der Dialog ist gegen den globalen Scroll-Vertrag abgeschirmt', () => {
  /* Die Regel `#modal:has(.modal-scroll) > .modal-box > #modalBody :has(.modal-scroll)` setzt
     display:flex + overflow:hidden auf JEDEN Vorfahren, der irgendwo eine .modal-scroll
     enthält. Die Systemdiagnose bringt eine mit - dadurch verlor .set-app sein Raster:
     Navigation und Inhalt lagen untereinander in voller Breite, der Inhaltsbereich fiel auf
     42 px zusammen (Nutzerfund 27.08.). */
  assert.match(html, /#modal:has\(\.modal-scroll\)[^{]*:has\(\.modal-scroll\)/,
    'Der globale Scroll-Vertrag ist nicht mehr da - die Abschirmung wäre dann sinnlos');
  assert.ok(html.includes('#modal #modalBody > .set-app{display:grid!important;overflow:hidden!important}'),
    'Das Raster des Dialogs ist nicht gegen den Scroll-Vertrag abgeschirmt');
  assert.ok(html.includes('#modal #modalBody > .set-app > .set-inhalt{display:block!important;overflow:auto!important'),
    'Der Inhaltsbereich kann weiterhin gekapert werden (fällt zusammen, kein Scrollen)');
  assert.ok(html.includes('#modal #modalBody > .set-app > .set-nav{display:flex!important'),
    'Die Navigation kann weiterhin gekapert werden');
});

test('Unterschriften: nur noch an EINER Stelle (Nutzerwunsch 27.08.)', () => {
  /* Vorher zweimal dieselbe Liste: „Konto & Anmeldung" (verwaltung:false) und „Büro ›
     Unterschriften" (verwaltung:true). Der einzige Unterschied war, ob ein Admin auch fremde
     Einträge ändern darf - das hängt jetzt an der Person, nicht am Aufrufort. */
  assert.ok(html.includes("window.__sigUI.mount('einSigVerwHost',{verwaltung:einIstAdmin()})"),
    'Die Verwaltungsrechte hängen weiterhin am Aufrufort statt an der Person');
  assert.ok(!html.includes('einKontoSigHost'),
    'Die Unterschriften stehen weiterhin doppelt unter Konto & Anmeldung');
  assert.ok(html.includes("{id:'unterschriften',name:'Unterschriften',lokal:true,datei:true},"),
    'Der Bereich bleibt admin-only - dann käme niemand an die eigene Unterschrift');
  const konto = html.indexOf('function einSeiteKonto(){');
  const kontoBlock = html.slice(konto, konto + 1600);
  assert.ok(!kontoBlock.includes('__sigUI'),
    'Konto & Anmeldung baut weiterhin eine eigene Unterschriften-Ansicht');
});

test('Erweiterung: alles an EINER Stelle (Nutzerwunsch 27.08.)', () => {
  /* Vorher drei Ansichten: persönliche Zugänge unter „Konto & Anmeldung", Installations-
     pakete PLUS alle Zugänge im Verwaltungs-Reiter - und der persönliche Baustein kann für
     Admins ohnehin alle Nutzer zeigen. Jetzt sammelt „Browser-Erweiterung" beides. */
  const bereich = html.indexOf("erweiterung:{unter:");
  assert.ok(bereich > 0, 'Bereich „Browser-Erweiterung" nicht gefunden');
  const block = html.slice(bereich, bereich + 1400);
  assert.ok(block.includes('einExtEinbettHost'), 'Die eigenen Zugänge fehlen im Bereich');
  assert.ok(block.includes("einAdminEinbetten('extension',pak,{nurPakete:true})"),
    'Die Installationspakete werden nicht ohne Dublette eingebettet');
  /* Der Verwaltungs-Reiter kann die Zugangsliste weglassen - sonst stünde sie doppelt. */
  assert.ok(html.includes('const nurPakete=!!(optE&&optE.nurPakete);'),
    'renderExtensionTab kennt die Option „nur Pakete" nicht');
  /* Konto & Anmeldung führt die Zugänge nicht mehr - sagt aber, wohin sie gezogen sind. */
  const konto2 = html.indexOf('function einSeiteKonto(){');
  const kontoBlock2 = html.slice(konto2, konto2 + 1600);
  assert.ok(!kontoBlock2.includes('einExtEinbettHost'),
    'Die Zugänge stehen weiterhin doppelt unter Konto & Anmeldung');
  /* Auch der Nutzermenü-Eintrag führt online in denselben Bereich. */
  assert.ok(html.includes("window.openEinstellungenApp('erweiterung')"),
    'Der Nutzermenü-Eintrag öffnet weiterhin einen eigenen Dialog');
  /* Sichtbar für alle mit dem Erweiterungs-Recht, nicht nur für Admins. */
  assert.ok(html.includes("sichtbar:()=>einIstAdmin()||einDarf('useExtension')"),
    'Der Bereich bleibt admin-only - dann kämen Nicht-Admins nicht an ihre Zugänge');
});

test('Kuratierung: eine Tabelle mit festen Spalten statt zweier versetzter', () => {
  /* Nutzerfund 27.08.: Die Zugangsdaten standen in einer ZWEITEN Tabelle - eigene
     Spaltenbreiten, sichtbar versetzt, und die vierte Spalte trug Inhalt ohne Überschrift.
     Jetzt sind sie eine weitere Bereichsgruppe DERSELBEN Tabelle. */
  assert.ok(html.includes('<tbody id="einHkBody">'), 'Die Tabelle hat keinen benannten Körper');
  assert.ok(html.includes('<colgroup><col style="width:32%">'), 'Feste Spaltenbreiten fehlen');
  assert.ok(html.includes('.set-hktab{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;table-layout:fixed}'),
    'table-layout:fixed fehlt - die Spalten können wieder auseinanderlaufen');
  assert.ok(html.includes("'<tr class=\"set-hk-gruppe\"><td colspan=\"4\">Zugangsdaten</td></tr>'"),
    'Zugangsdaten sind keine Bereichsgruppe der Haupttabelle');
  assert.ok(!html.includes("<h4>Zugangsdaten je Bereich</h4><table"),
    'Die zweite Tabelle existiert noch');
  /* Der Nachtrag darf nicht in eine inzwischen gewechselte Seite schreiben. */
  const zug = html.indexOf('async function einHerkunftZugang(');
  assert.ok(zug > 0 && html.slice(zug, zug + 700).includes('meine!==einGeneration'),
    'Nachlauf-Guard des Zugangsdaten-Nachtrags fehlt');
});

test('Kuratierung: „Woher kommt was" ist nach Bereichen gegliedert', () => {
  assert.ok(html.includes("'<tr class=\"set-hk-gruppe\"><td colspan=\"4\">'+E(einNavName(bereich))"),
    'Die Übersicht hat keine Bereichs-Überschriften');
  assert.ok(html.includes('class="set-hk-sprung" data-ein-hkziel='),
    'Die Zeilen springen nicht in ihren Bereich');
  assert.ok(html.includes('.set-hk-gruppe td{'), 'Stil der Bereichs-Überschrift fehlt');
});

/* Katalog-Schlüssel aus der Auslieferungsdatei lesen statt abschreiben. */
function EIN_KAT_KEYS() {
  const a = html.indexOf('const EIN_KATALOG=[');
  const b = html.indexOf('];', a);
  assert.ok(a > 0 && b > a, 'EIN_KATALOG nicht gefunden');
  return [...html.slice(a, b).matchAll(/\{key:'([^']+)'/g)].map((m) => m[1]);
}

test('Struktur: Blockzahl unverändert (NEUER script-Block ist verboten)', () => {
  assert.equal((html.match(/\n<script/g) || []).length, 309,
    'Die Zahl der script-Blöcke hat sich verändert - neuer Code gehört in bestehende Blöcke.');
});

test('Nutzer-Menü: Reihenfolge der Unterpunkte (Nutzervorgabe 30.08.2026)', () => {
  /* Wörtlich gewünscht, ohne Trennlinien:
     Einstellungen · KI-Direktverbindung · Passwort ändern · Erweiterungs-Zugänge ·
     Außendienst · Zu Lokal-Modus wechseln · Abmelden.
     Vorher stand der Modus-Wechsler auf Platz 3 - mitten im Klickweg der häufigen
     Einträge, obwohl er die ganze Arbeitsumgebung tauscht (offener Fall und Live-Sync
     sind danach weg). */
  const a = html.indexOf("'<button type=\"button\" data-user-menu-settings>Einstellungen</button>'");
  const b = html.indexOf('window.__performLogout=async()=>{', a);
  assert.ok(a > 0 && b > a, 'Der Rumpf des Nutzer-Menüs wurde nicht gefunden');
  const rumpf = html.slice(a, b);
  const platz = (marke) => {
    const i = rumpf.indexOf(marke);
    assert.ok(i >= 0, `Eintrag fehlt im Nutzer-Menü: ${marke}`);
    return i;
  };
  const folge = [
    'data-user-menu-settings>',
    'data-user-menu-ki>',
    'data-user-menu-pw>',
    'data-user-menu-ext-tokens>',
    /* Außendienst hängt sich zur Laufzeit hier ein - sein Anker ist der Modus-Wechsler. */
    'switchModeButtonHTML(user,mode)',
    'data-user-menu-logout>',
  ].map(platz);
  for (let i = 1; i < folge.length; i++) {
    assert.ok(folge[i] > folge[i - 1],
      `Die Reihenfolge im Nutzer-Menü stimmt nicht mehr (Position ${i + 1} steht zu weit oben)`);
  }

  /* Der Außendienst-Eintrag wird nachträglich eingehängt: Anker ist der Modus-Wechsler,
     Ersatzanker "Abmelden" - der Wechsler fehlt Konten ohne Wechselrecht, sonst rutschte
     Außendienst ans Menü-Ende. */
  assert.ok(html.includes("data-user-menu-mode-switch onclick=\"window.__switchMode('${targetMode}')\""),
    'Der Modus-Wechsler trägt keinen stabilen Anker mehr');
  assert.ok(html.includes("var anker=body.querySelector('[data-user-menu-mode-switch]')\n          ||body.querySelector('[data-user-menu-logout]');"),
    'Der Außendienst-Eintrag hängt sich nicht mehr vor dem Modus-Wechsler ein');
  /* Das Rechte-Gate des Wechslers erkennt ihn am TEXT - das darf das neue Attribut nicht ersetzen. */
  assert.ok(html.includes("['menuAdminModeSwitch',text=>text.includes('Zu Lokal-Modus wechseln')||text.includes('Zu Online-Modus wechseln')]"),
    'Das Rechte-Gate des Modus-Wechslers ist verloren gegangen');
});

test('Struktur: Dialog, Sidebar-Matcher und Whitelist-Einträge vorhanden', () => {
  assert.ok(html.includes('window.openEinstellungenApp'), 'openEinstellungenApp fehlt');
  /* Dritte Rückmeldung 27.08. abends: Der Einstieg sitzt online IM Nutzer-Menü, neben
     „Zu Lokal-Modus wechseln". Die eigene Einstellungen-Gruppe in der Seitenleiste entfällt
     dort ganz - der abgelöste Direktaufruf am Gruppenkopf ist restlos zurückgebaut. */
  assert.ok(!html.includes('data-einstellungen-app-menu'),
    'Der abgelöste Sidebar-Knopf „Alle Einstellungen" steht noch im Code');
  for (const rest of ['eoDirekt', 'data-eo-direkt', 'ausTaste']) {
    assert.ok(!html.includes(rest), `Rest des abgelösten Direktaufrufs im Code: ${rest}`);
  }
  /* 30.08.: das Menue ist der Standard ALLER Betriebsarten - der Eintrag steht ohne Modus-Gate. */
  assert.ok(html.includes("'<button type=\"button\" data-user-menu-settings>Einstellungen</button>'+"),
    'Der Eintrag „Einstellungen" fehlt im Nutzer-Menü');
  assert.ok(html.includes("if(setBtn)setBtn.addEventListener('click',()=>{if(window.openEinstellungenApp)window.openEinstellungenApp();});"),
    'Der Eintrag im Nutzer-Menü öffnet das Einstellungsmenü nicht');
  assert.ok(html.includes("['menuSettings',(text,node)=>!!node?.hasAttribute?.('data-user-menu-settings')]"),
    'Der Eintrag im Nutzer-Menü hängt nicht an menuSettings');
  assert.ok(html.includes('html.eo-vereint details[data-group-verbindungen]{display:none!important}'),
    'Die abgelöste Einstellungen-Gruppe wird online nicht verborgen');
  /* Die Klasse muss VOR den Netzabrufen sitzen, sonst blitzt die abgelöste Gruppe auf. */
  const ein = html.indexOf("try{document.documentElement.classList.add('eo-vereint');}catch(_e3){}");
  assert.ok(ein > 0, 'Die Vereinheitlichungs-Klasse wird nicht vor dem Laden gesetzt');
  assert.ok(ein < html.indexOf('einBereitP=einLaden(true);'),
    'Die Klasse wird erst nach dem Laden gesetzt - die abgelöste Gruppe blitzt auf');
  /* Der Einstieg liegt jetzt IM Nutzer-Menü: ein entzogenes menuAdmin würde ihn mitreißen,
     obwohl menuSettings erlaubt ist. Deshalb öffnet die Gruppe auch für dieses Recht. */
  /* auchWenn wuchs mit dem KI-Schnellzugriff um menuSettingsAi - deshalb nur der Anfang
     festgenagelt, sonst bricht der Pin bei jedem weiteren Eintrag im Nutzer-Menü. */
  assert.ok(html.includes("{key:'menuAdmin',selector:'details[data-user-menu]',body:'.ai-direct-body',auchWenn:['menuSettings'"),
    'Ein entzogenes menuAdmin nimmt den Einstieg ins Einstellungsmenü mit');
  assert.ok(html.includes("||(group.auchWenn||[]).some(k=>permissionValue(u,k));"),
    'auchWenn wird bei der Gruppen-Sichtbarkeit nicht ausgewertet');
  /* „Meine Einstellungen" ist online restlos im Menü aufgegangen; lokal bleibt es der
     einzige Weg zu diesen Angaben. */
  /* 30.08.: der Eintrag entfaellt auch lokal - openMySettings leitet ueberall ins Menue um. */
  assert.ok(!html.includes('data-user-menu-my-settings>Meine Einstellungen'),
    'Der Eintrag „Meine Einstellungen" erscheint online weiterhin im Nutzer-Menü');
  assert.ok(html.includes('id="einstellungen-online-style-v1"'), 'Style-Block fehlt');
  assert.ok(html.includes('window.openMySettingsKlassisch=window.openMySettings'),
    'Umleitung von „Meine Einstellungen" fehlt');
  const routen = lies('src', 'modules', 'office', 'json-routes.js');
  assert.match(routen, /const KEYS = new Set\(\[[^\]]*'einstellungs_vorgaben'/, 'einstellungs_vorgaben nicht in KEYS');
  assert.match(routen, /const KEYS = new Set\(\[[^\]]*'rollen'/, 'rollen nicht in KEYS');
});

test('Einbettung: die Bereiche rendern IM Dialog, nicht daneben (Nutzer-Rückmeldung 27.08.)', () => {
  /* Der Kern der Nachbesserung: Fremd-Bausteine nehmen einen Wirt entgegen statt stur ins
     geteilte Modal zu rendern - und der Dialog stellt diese Wirte bereit. */
  assert.ok(html.includes('renderTabInto:(tab,host,zusatz)=>renderTabInto(tab,host,Object.assign({nurOnline:true},zusatz||{}))'),
    '__adminPanel.renderTabInto fehlt - Admin-Bereiche wären nicht einbettbar');
  for (const wirt of ['einMsEinbettHost', 'einExtEinbettHost', 'einPwEinbettHost',
    'einDiagEinbettHost', 'einSvcEinbettHost', 'einEinbettWirt']) {
    assert.ok(html.includes(wirt), `Einbett-Wirt fehlt: ${wirt}`);
  }
  assert.ok(html.includes('window.openPasswordChangeForm=openPasswordChangeForm'),
    'Passwort-Formular nicht exportiert');
  assert.ok(html.includes('html.eo-vereint details[data-group-verbindungen]'),
    'Sidebar-Vereinheitlichung (die abgelöste Einstellungen-Gruppe online verborgen) fehlt');
  /* Die Wirt-Weichen der sechs gepatchten Dialog-Bauer. */
  for (const weiche of ["getElementById('einMsEinbettHost')", "getElementById('einExtEinbettHost')",
    "getElementById('einPwEinbettHost')", "getElementById('einDiagEinbettHost')",
    "getElementById('einSvcEinbettHost')", "getElementById('einAiEinbettHost')"]) {
    assert.ok(html.includes(weiche), `Wirt-Weiche fehlt: ${weiche}`);
  }
});

test('Einbettung: switchTab zerstört den Einstellungsdialog nicht mehr (schwerster Befund)', () => {
  /* switchTab schrieb bedingungslos die Admin-Shell ins geteilte Modal - und wird nach FAST
     JEDEM Speichern der Verwaltungs-Tabs gerufen (Nutzer sichern, Passwort zurücksetzen,
     KI/Versand/Mail speichern, Fall archivieren, Formular sichern). Eingebettet hätte das
     jedes Mal den umgebenden Dialog vernichtet. */
  const stelle = html.indexOf('async function switchTab(tab){');
  assert.ok(stelle > 0, 'switchTab nicht gefunden');
  const rumpf = html.slice(stelle, stelle + 900);
  assert.ok(rumpf.includes('if(einbettungAktiv()){'),
    'switchTab hat keine Einbettungs-Weiche - jedes Speichern zerstörte den Dialog');
  assert.ok(rumpf.indexOf('einbettungAktiv()') < rumpf.indexOf('adminShellHTML()'),
    'Die Weiche muss VOR dem Überschreiben von modalBody greifen');
  assert.ok(html.includes('window.__einTabSpringe'), 'Rückweg für Quer-Verweise fehlt');
});

test('Einbettung: das Menü räumt seine Wirte beim Schließen ab', () => {
  /* closeModal() leert #modalBody nicht - zurückgebliebene Wirte fingen spätere Aufrufe
     fremder Dialoge ab, die dann unsichtbar ins verborgene Modal rendern. */
  assert.ok(html.includes("if(b&&b.querySelector('.set-app')){"),
    'closeModal-Aufräumer für den eigenen Dialoginhalt fehlt');
  assert.ok(html.includes("window.__extTokens.vergessen()"),
    'Token-Klartext wird beim Schließen nicht vergessen');
  assert.match(html, /vergessen:function\(\)\{extFreshToken=null;\}/,
    'extTokens.vergessen fehlt');
});

test('Einbettung: eingebettete Erfolgspfade schließen nicht das ganze Menü', () => {
  assert.ok(html.includes('if(!eingebettet)closeModal();'),
    'saveGlobalServiceSettings schließt eingebettet weiterhin das Menü');
  assert.ok(html.includes("const eingebettet=!!document.getElementById('einSvcEinbettHost');"),
    'Einbettungs-Erkennung in saveGlobalServiceSettings fehlt');
  const pw = html.indexOf("toast('Passwort erfolgreich geändert.');");
  assert.ok(pw > 0, 'Passwort-Erfolgspfad nicht gefunden');
  assert.ok(html.slice(pw, pw + 400).includes('else closeModal();'),
    'Passwortwechsel schließt eingebettet weiterhin das ganze Menü');
});

test('Einbettung: KI-Direktverbindung und Mail sind vollständig verdrahtet', () => {
  /* Nutzerauftrag: beide Bereiche sollen im Menü WIRKEN, nicht nur verweisen.
     KI = eigene Browser-Verbindung (showAISettings) + Zugangsdaten + Büro-Vorgabe. */
  const ki = html.indexOf("else if(einAktiv==='ki'){");
  assert.ok(ki > 0, 'KI-Seite nicht gefunden');
  /* Bis zum NÄCHSTEN Seiten-Zweig schneiden statt Zeichen abzuzählen - dieselbe Falle wie
     bei der Mail-Seite (30.08.2026: der Büro-Hinweis schob showAISettings aus dem Fenster). */
  const kiEnde = html.indexOf("else if(einAktiv===", ki + 20);
  const kiBlock = html.slice(ki, kiEnde > ki ? kiEnde : ki + 2600);
  assert.ok(kiBlock.includes("id=\"einAiEinbettHost\""), 'KI-Seite ohne Wirt für showAISettings');
  assert.ok(kiBlock.includes('showAISettings()'), 'KI-Seite ruft showAISettings nicht auf');
  /* Zugangsdaten-Karte (27.08.) und Umschalter (30.08.) sind beide entfallen: Es gilt je
     Anbieter der Büro-Schlüssel, sonst der eigene. Der Admin-Block ist die Quelle der
     Büro-Schlüssel und heißt jetzt so. */
  assert.ok(kiBlock.includes('Zugänge des Büros'), 'KI-Seite ohne den Büro-Block');
  assert.ok(!kiBlock.includes('id="einKiQuelle"'), 'Der entfallene Umschalter ist zurück');
  const mail = html.indexOf("else if(einAktiv==='mail'){");
  assert.ok(mail > 0, 'Mail-Seite nicht gefunden');
  /* Bis zum NÄCHSTEN Seiten-Zweig schneiden statt 2600 Zeichen abzuzählen: Ein Einschub in die
     Mail-Seite (28.08.: der Wirt für das Standard-Ausgangskonto) schob den gesuchten Aufruf aus
     dem festen Fenster heraus - der Prüfstein schlug an, obwohl nichts fehlte. */
  const mailEnde = html.indexOf("else if(einAktiv===", mail + 10);
  const mailBlock = html.slice(mail, mailEnde > mail ? mailEnde : mail + 4000);
  assert.ok(mailBlock.includes("einMsKarten('einMailMs','mail')"), 'Mail-Seite ohne Zugangsdaten-Karte');
  assert.ok(mailBlock.includes("einAdminEinbetten('mail',a,{eigeneZugang:true})"),
    'Mail-Seite bettet den Baustein nicht mit Platz für die eigenen Zugangsdaten ein');
  assert.ok(mailBlock.includes('canManageMailSettings'), 'Mail-Seite ohne Rechteweiche für die Büro-Einstellung');
  /* EINE Ebene (Nutzerwunsch 27.08.): Die persönlichen Zugangsdaten stehen IM Abschnitt
     „Systemversand", direkt über der Büro-Einstellung - nicht mehr als eigene Karte obenauf. */
  assert.ok(mailBlock.includes("getElementById('mailEigeneZugangHost')"),
    'Die eigenen Zugangsdaten sitzen nicht im Systemversand-Abschnitt');
  assert.ok(html.includes('<div class="set-kartenkopf"><h3>Systemversand (Passwort-Mails, Direktversand)</h3>'),
    'Der Systemversand-Abschnitt trägt nicht den vereinheitlichten Namen');
  assert.ok(html.includes('const eigeneZugang=!!(optM&&optM.eigeneZugang);'),
    'Der Mail-Baustein kennt den Platz für die eigenen Zugangsdaten nicht');
  /* Die Benachrichtigungen standen im persönlichen Mail-Block ein ZWEITES Mal - auf denselben
     Werten. Der eigene Bereich ist jetzt die einzige Stelle. */
  assert.ok(!html.includes("id=\"mxpNMail\""), 'Benachrichtigungs-Schalter stehen weiterhin doppelt im Mail-Block');
  assert.ok(!html.includes("id=\"mxpDigestMode\""), 'Die Tagesmeldung steht weiterhin doppelt im Mail-Block');
  assert.ok(!html.includes("notifyMail:chk('mxpNMail')"),
    'Das Mail-Panel schreibt weiterhin die Benachrichtigungswerte mit');
  /* showAISettings darf das Modal nur noch standalone aufreißen. */
  assert.ok(html.includes("if(!wirt)document.getElementById('modal').classList.remove('hidden');\n}\nfunction saveAIRouterMode"),
    'showAISettings öffnet eingebettet weiterhin das Modal');
});

/* ═══════════════════════════════════════════════════════════════════════════════════════
   Ein Speicherweg für das Standard-Ausgangskonto (Entscheidung 27.08.2026)

   Die persönliche Wahl lag DREIFACH: mail_prefs.defaultAccountId (Konto), bueroLocal
   .defaultSendAccount (Browser) und ui_prefs.defaultSendAccount (büroweit). Beim Verfassen
   gewann immer mail_prefs - eine Änderung über die Einstellungszeile (die den Browser
   beschrieb) sah deshalb wirkungslos aus. Gewählt: der Wert hängt am KONTO und folgt der
   Person an jeden Arbeitsplatz. Die Pins hier halten fest, dass es bei EINEM Weg bleibt.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
test('Standard-Ausgangskonto: die persönliche Wahl hängt nur noch am Konto', () => {
  // 1) Der Katalog liest und schreibt die eigene Wahl am Konto, nicht mehr im Browser.
  const kat = html.indexOf("{key:'versand.standardkonto'");
  assert.ok(kat > 0, 'Katalogeintrag nicht gefunden');
  const katBlock = html.slice(kat, kat + 1600);
  assert.ok(katBlock.includes('einNPrefs&&einNPrefs.defaultAccountId'),
    'Der Katalog liest die eigene Wahl nicht am Konto');
  assert.ok(!katBlock.includes('bueroLocal.defaultSendAccount'),
    'Der Katalog liest weiterhin den stillgelegten Browser-Wert');

  const setzen = html.indexOf("if(key==='versand.standardkonto'){");
  assert.ok(setzen > 0, 'Schreibweg der eigenen Wahl nicht gefunden');
  const setzBlock = html.slice(setzen, setzen + 900);
  assert.ok(setzBlock.includes("__mxNotify.speichern({defaultAccountId:wert||''})"),
    'Die eigene Wahl wird nicht ans Konto geschrieben');
  assert.ok(setzBlock.includes("__setDefaultSendAccountLocal('')"),
    'Beim Setzen wird der Browser-Altwert nicht geräumt');

  // 2) Einmalige Übernahme: Browser-Altwert wandert ans Konto, aber NUR wenn dort nichts steht.
  const uebernahme = html.indexOf('async function einSendekontoUebernehmen()');
  assert.ok(uebernahme > 0, 'Die einmalige Übernahme fehlt');
  const uBlock = html.slice(uebernahme, uebernahme + 900);
  assert.ok(uBlock.includes('if(einNPrefs&&einNPrefs.defaultAccountId){'),
    'Die Übernahme prüft nicht, ob am Konto schon etwas steht');
  assert.ok(uBlock.includes('speichern({defaultAccountId:String(lokal)})'),
    'Die Übernahme schreibt den Altwert nicht ans Konto');
  assert.ok(uBlock.includes("__setDefaultSendAccountLocal('')"),
    'Die Übernahme räumt den Browser-Wert nicht ab');
  assert.ok(html.includes('await einSendekontoUebernehmen();'),
    'Die Übernahme wird beim Laden der eigenen Einstellungen nicht angestoßen');

  // 3) Effektiv-Leser und Verfassen-Fenster halten DIESELBE Reihenfolge ein.
  const eff = html.indexOf('window.__defaultSendAccount=function(){');
  assert.ok(eff > 0, 'Effektiv-Leser nicht gefunden');
  const effBlock = html.slice(eff, eff + 700);
  const reihenfolge = [
    "z.zwingend&&z.wert",                                  // 1. zwingende Vorgabe
    "window.__mxNotify.standardkonto()",                   // 2. eigene Wahl am Konto
    "bl().defaultSendAccount",                             // 3. Browser-Altwert (Rückfall)
    "if(z&&z.wert)return String(z.wert)",                  // 4. überschreibbare Vorgabe
    "up().defaultSendAccount"                              // 5. Büro-Altvorgabe
  ];
  let pos = 0;
  for (const stufe of reihenfolge) {
    const i = effBlock.indexOf(stufe, pos);
    assert.ok(i > 0, 'Effektiv-Leser: Stufe fehlt oder steht falsch: ' + stufe);
    pos = i;
  }

  // Der Leser MUSS über die Brücke gehen: MX steckt in einer IIFE, window.MX gibt es nicht.
  assert.ok(!effBlock.includes('window.MX'),
    'Der Effektiv-Leser greift auf window.MX zu - das ist nie gesetzt und damit tot');
  assert.ok(html.includes('standardkonto(){try{return (MX.prefs&&MX.prefs.defaultAccountId)||\'\';}catch(_e){return \'\';}}'),
    'Die Brücke __mxNotify.standardkonto fehlt');

  // 4) Kein toter Optionsbauer mehr, der das nie gesetzte window.MX las.
  assert.ok(!html.includes('__defaultSendAccountOptions'),
    'Der tote Optionsbauer __defaultSendAccountOptions steht noch im Code');

  /* 5) Das zweite Auswahlfeld im Mail-Block ist am 27.08. ganz entfallen - die Wahl sitzt als
     Stern in der Kontenliste (siehe „Standard-Ausgangskonto: der Stern sitzt in der
     Kontenliste"). Damit gibt es die gemeinsame Wahrheit, aber nur noch EINE Bedienstelle
     auf der Mail-Seite. */
  assert.ok(!html.includes('mxpDefAcc'),
    'Das abgelöste Auswahlfeld steht wieder im Mail-Block');
});

/* ═══════════════════════════════════════════════════════════════════════════════════════
   Das Admin-Panel ist online abgelöst (Nutzerwunsch 27.08. abends)

   Ziel des Umbaus: EINE Einstellungsebene für alle - auch für Admins. Geprüft wurde,
   ob wirklich jeder Panel-Reiter im Menü ankommt UND ob dabei Bedienelemente verloren
   gingen, die nur in der Panel-Hülle standen. Genau eines ging verloren.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
test('Admin-Panel: jeder Reiter hat einen Bereich im Einstellungsmenü', () => {
  const a = html.indexOf('const ADMIN_NAV_GROUPS');
  const gruppen = html.slice(a, html.indexOf('];', a));
  const reiter = [...gruppen.matchAll(/\['([a-z]+)',/g)].map((m) => m[1]);
  assert.ok(reiter.length >= 21, `Nur ${reiter.length} Panel-Reiter gefunden`);

  const n = html.indexOf('const EIN_NAV=');
  const nav = html.slice(n, html.indexOf('\n];', n));
  // Panel-Reiter -> Menü-Bereich. Beide Seiten müssen vorhanden sein.
  const ZUORDNUNG = {
    /* cases -> datenadmin: der eigene Bereich „Fälle" ist seit 29.08.2026 abgebaut (die
       Suche als sein letzter Vorsprung kam in die Datenadministration; siehe eigener Test). */
    users: 'nutzer', cases: 'datenadmin', dataadmin: 'datenadmin', vertretung: 'vertretung',
    datenschutz: 'datenschutz', localmode: 'lokal', mcpremote: 'mcp', extension: 'erweiterung',
    audit: 'audit', office: 'stammdaten', signatures: 'unterschriften', suggestions: 'vorschlaege',
    forms: 'formulare', caldav: 'kalender', send: 'versand', mail: 'mail', ai: 'ki',
    prompts: 'prompts', maps: 'karten', docs: 'explorer', banking: 'banking'
  };
  for (const r of reiter) {
    const ziel = ZUORDNUNG[r];
    assert.ok(ziel, `Panel-Reiter "${r}" hat keine Zuordnung zu einem Menü-Bereich`);
    assert.ok(nav.includes(`id:'${ziel}'`), `Menü-Bereich "${ziel}" (für Panel-Reiter "${r}") fehlt`);
  }
});

test('Admin-Panel: die Kopf-Aktion der Hülle ging verloren und ist wieder da', () => {
  /* adminShellHTML() rendert `head-actions` - beim Einbetten wird die Hülle NICHT gerendert,
     also war „Neuen Nutzer anlegen" im Einstellungsmenü schlicht nicht vorhanden: ein Admin
     konnte dort keinen Nutzer anlegen (am Prüfstand nachgewiesen). */
  assert.ok(html.includes('function einKopf(titel,unter,aktionen){'),
    'einKopf nimmt keine Kopf-Aktionen entgegen');
  /* Seit dem Personenregister (Etappe 1, 29.08.2026) legt der Kopf-Knopf PERSONEN an - Konten
     entstehen aus der Person heraus ("Konto anlegen"). */
  assert.ok(html.includes("kopfAktion:()=>'<button type=\"button\" class=\"btn\" onclick=\"window.__adminPanel&&window.__adminPanel.showPersonForm&&window.__adminPanel.showPersonForm()\">Neue Person anlegen</button>'"),
    'Der Knopf „Neue Person anlegen" fehlt im Bereich „Personen"');
  assert.ok(html.includes('eb.kopfAktion?eb.kopfAktion():'),
    'Kopf-Aktionen werden beim Rendern nicht durchgereicht');
  assert.ok(html.includes('showUserForm,newUserFromEmployee,deleteUser,'),
    'showUserForm ist nicht am __adminPanel veröffentlicht');
});

test('Admin-Panel: online führt kein Weg mehr in die alte Hülle', () => {
  /* Vier Zugänge führten online noch am Menü vorbei. Jeder bekommt eine Online-Weiche;
     der Lokal-Modus behält das Panel, weil es dort das Menü nicht gibt. */
  /* Der Eintrag im Nutzer-Menü ist online GANZ entfallen (Nutzerfrage 27.08.): „Einstellungen"
     in der Seitenleiste führt an dieselbe Stelle. Kein Zugangsverlust - der Eintrag erschien
     nur für Admins, und permissionValue() gibt Admins jedes Menürecht frei. */
  /* 30.08.: der Eintrag entfaellt in ALLEN Modi - openAdminPanel leitet ueberall um. */
  assert.ok(!html.includes('data-user-menu-admin>Admin-Panel'),
    'Der Eintrag „Admin-Panel" ist zurück im Nutzer-Menü');
  assert.ok(html.includes('if(!u||u.isAdmin)return true;'),
    'permissionValue gibt Admins nicht mehr jedes Menürecht frei - der Wegfall des Eintrags wäre dann ein Zugangsverlust');
  assert.ok(html.includes("if(adminBtn)adminBtn.addEventListener('click',()=>{if(window.__adminPanel?.open)window.__adminPanel.open()});"),
    'Am Klick steht weiterhin eine online unerreichbare Weiche (toter Code)');
  // Die Sicherung bleibt in openAdminPanel selbst.
  assert.ok(html.includes("return window.openEinstellungenApp('nutzer');"),
    'openAdminPanel ist online nicht mehr gegen einen übersehenen Aufruf gesichert');
  assert.ok(html.includes("try{return window.openEinstellungenApp('mail')}catch(_e){}"),
    'Der Mail-Kontendialog führt online weiterhin in den abgelösten Einzeldialog');
  assert.ok(html.includes("Promise.resolve(window.openEinstellungenApp('kalender')).then(nachher,nachher);"),
    'Die Rückkehr aus der Kalender-Autorisierung öffnet online weiterhin das Panel');
  assert.ok(html.includes("if(!window.__adSnapshotId&&window.openEinstellungenApp){\n              window.openEinstellungenApp('formulare');"),
    'Der Rückweg aus dem Eigenschaften-Dialog setzt online weiterhin den Titel „Admin-Panel"');
  /* Leerlauf: auf der Kalender-Seite stand ein Verweis auf genau diese Seite - er führte
     in den abgelösten Einzeldialog. */
  assert.ok(html.includes("const eingebettet=!!document.getElementById('einKalKarte');"),
    'Der Kalender-Verweis prüft die Einbettung nicht - er zeigt auf sich selbst');
});

/* ═══════════════════════════════════════════════════════════════════════════════════════
   Die alten Einzel-Einstellungsdialoge sind online abgeschaltet (Nutzerwunsch 27.08.)

   Gegattert wird der DIALOG SELBST, nicht seine Aufrufer: showAISettings allein hat rund
   30 Aufrufer (überwiegend Gate-Pfade wie „Bitte zuerst den KI-Zugang konfigurieren"), und
   jeder einzeln gepatchte Aufruf wäre eine Stelle, die man beim nächsten Mal vergisst.
   Seit 30.08. führen die Weichen in ALLEN Betriebsarten ins Menü (Ausnahme: Außendienst-Datei).
   ═══════════════════════════════════════════════════════════════════════════════════════ */
test('Altdialoge: jeder führt online in seinen Bereich des Einstellungsmenüs', () => {
  const ERWARTET = [
    ['ki', "if(!document.getElementById('einAiEinbettHost')&&!window.__adSnapshotId&&window.openEinstellungenApp)"],
    ['versand', "if(!document.getElementById('einSvcEinbettHost')&&!window.__adSnapshotId&&window.openEinstellungenApp)"],
    ['diagnose', "if(!window.__adSnapshotId&&window.openEinstellungenApp)return window.openEinstellungenApp('diagnose');"],
    ['konto', "if(!wirt&&!window.__adSnapshotId&&window.openEinstellungenApp)return window.openEinstellungenApp('konto');"],
    ['erweiterung', "if(!wirt&&!window.__adSnapshotId&&window.openEinstellungenApp)return window.openEinstellungenApp('erweiterung');"],
    ['karten', "return window.openEinstellungenApp('karten');"],
    ['stammdaten', "return window.openEinstellungenApp('stammdaten');"],
    ['datenadmin', "return window.openEinstellungenApp('datenadmin');"],
    ['banking', "return window.openEinstellungenApp('banking');"],
    ['mail', "return window.openEinstellungenApp('mail');"],
    ['kalender', "return window.openEinstellungenApp('kalender');"],
    ['nutzer', "return window.openEinstellungenApp('nutzer');"]
  ];
  for (const [bereich, code] of ERWARTET) {
    assert.ok(html.includes(code), `Der Altdialog für den Bereich "${bereich}" ist online nicht abgeschaltet`);
  }

  /* Die drei Dialoge, durch die das MENÜ selbst rendert, brauchen die Wirt-Prüfung ZUERST -
     sonst schickt die Online-Weiche den Einbettungsaufruf zurück ins Menü: Endlosschleife. */
  const ai = html.indexOf('function showAISettings(){');
  const aiKopf = html.slice(ai, ai + 700);
  assert.ok(aiKopf.indexOf("getElementById('einAiEinbettHost')") < aiKopf.indexOf("openEinstellungenApp('ki')"),
    'showAISettings prüft den Wirt nicht VOR der Online-Weiche - Endlosschleife');
  const svc = html.indexOf('function showGlobalServiceSettings(){');
  const svcKopf = html.slice(svc, svc + 600);
  assert.ok(svcKopf.indexOf("getElementById('einSvcEinbettHost')") < svcKopf.indexOf("openEinstellungenApp('versand')"),
    'showGlobalServiceSettings prüft den Wirt nicht VOR der Online-Weiche');
  const diag = html.indexOf('window.showSystemDiagnostics=async function(){');
  const diagKopf = html.slice(diag, diag + 700);
  assert.ok(diagKopf.indexOf("if(wirt){") < diagKopf.indexOf("openEinstellungenApp('diagnose')"),
    'showSystemDiagnostics prüft den Wirt nicht VOR der Online-Weiche');
});

test('Altdialoge: kein Unterdialog reißt das Menü aus dem geteilten Modal', () => {
  /* „Eigene Prompt-Vorgaben" schrieb direkt in #modalBody und ersetzte damit das ganze
     Einstellungsmenü. Jetzt rendert es in den Wirt; der Rückweg über showAISettings
     findet ihn wieder. */
  assert.ok(html.includes("var wirt=document.getElementById('einAiEinbettHost');\n  var mb=wirt||document.getElementById('modalBody'); if(!mb)return;"),
    'Der Unterdialog „eigene Prompt-Vorgaben" rendert weiterhin über das Menü hinweg');
  assert.ok(html.includes("var t=wirt?null:document.getElementById('modalTitle');"),
    'Der Unterdialog überschreibt eingebettet weiterhin den Modal-Titel');
  /* injectLockBanner deaktiviert ALLE Felder in #modalBody - im Menü läge damit alles lahm. */
  assert.ok(html.includes("if(body.querySelector('.set-app'))return;"),
    'Der Sperr-Banner kann das ganze Einstellungsmenü lahmlegen');
});

/* ═══════════════════════════════════════════════════════════════════════════════════════
   Indikatoren der Navigation (Nutzerwunsch 27.08.2026)

   Im Lokal-Modus trägt jeder Eintrag der Einstellungsleiste einen Indikator; beim Umbau aufs
   Online-Menü gingen sie verloren. Acht werden von den BESTEHENDEN Aktualisierern geerbt,
   sechs rechnen aus schon geladenen Daten, zwölf kommen aus einer Statusabfrage.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
test('Indikatoren: jeder Navigationseintrag hat einen', () => {
  const n = html.indexOf('const EIN_NAV=');
  const nav = html.slice(n, html.indexOf('\n];', n));
  const ids = [...nav.matchAll(/\{id:'([a-z]+)'/g)].map((m) => m[1]);
  /* 29 -> 28 am 29.08.2026: der Bereich „Fälle" ist im Bereich Datenadministration aufgegangen. */
  assert.ok(ids.length >= 28, `Nur ${ids.length} Navigationseinträge gefunden`);

  const a = html.indexOf('const EIN_STATUS={');
  const tab = html.slice(a, html.indexOf('\n};', a));
  for (const id of ids) {
    assert.ok(new RegExp(`\\b${id}:\\{`).test(tab),
      `Der Bereich "${id}" hat keinen Eintrag in EIN_STATUS - sein Indikator bliebe ein stummer Punkt`);
  }
  assert.ok(html.includes('+einIndikatorHTML(it.id)+'), 'Der Navigationsknopf zeichnet keinen Indikator');
});

test('Indikatoren: der Layout-Haken ist ein Attribut, keine Klasse', () => {
  /* setIndicator() und updateAIMenuUI() setzen `el.className='ai-status-indicator …'` NEU und
     wischen damit jede eigene Klasse weg. Am Prüfstand verloren dadurch fünf geerbte
     Indikatoren ihre Ausrichtung, sobald ihr Aktualisierer lief. */
  assert.ok(html.includes("data-ein-nav-ind=\"1\" "), 'Der Indikator trägt keinen Attribut-Haken');
  assert.ok(html.includes('.set-nav-btn>[data-ein-nav-ind]{flex:0 0 18px;margin-left:auto'),
    'Das Layout hängt nicht am Attribut');
  assert.ok(!html.includes('set-nav-ind"'), 'Der klassenbasierte Layout-Haken steht noch im Code');
  /* Beweis, dass die Gefahr real ist - beide Aktualisierer überschreiben className komplett. */
  assert.ok(html.includes("el.className=`ai-status-indicator ${state?'verified':''}`"),
    'setIndicator setzt className nicht mehr neu - der Kommentar dazu wäre irreführend');
});

test('Indikatoren: die geerbten Aktualisierer werden beim Öffnen angestoßen', () => {
  for (const ruf of ['__updateMailSettingsIndicator', '__updateCalConnIndicator',
    '__dokSettingsIndikator', '__bankRefreshIndicator', 'updateAIMenuUI',
    "CustomEvent('officeProfileReady')", "CustomEvent('mapSettingsReady')"]) {
    assert.ok(html.includes(ruf), `Der Aktualisierer ${ruf} wird beim Öffnen nicht angestoßen`);
  }
  /* Mail braucht `sofort`: Der abgelöste Leisten-Eintrag steckt online unter display:none, ist
     aber noch im DOM - sein Lauf beim Anmelden setzt die 60-Sekunden-Drossel, und der Aufruf
     beim Öffnen liefe wirkungslos ins Leere (am Prüfstand nachgewiesen). */
  assert.ok(html.includes('window.__updateMailSettingsIndicator(true)'),
    'Der Mail-Indikator läuft ohne „sofort" in die Drossel des versteckten Leisten-Eintrags');
  /* Fehlertest 30.08.: die drei netzgehenden Anstöße (Mail/Explorer/Banking) sind ONLINE-only -
     lokal setzte `sofort=true` die 403-Absage zurück und jeder Bereichswechsel erntete einen
     frischen 403 (gemessen: 14 in einem Durchlauf). */
  const anstoss = html.slice(html.indexOf('function einFremdeIndikatorenAnstossen(){'), html.indexOf('function einIstOnline(){'));
  assert.ok(/if\(einIstOnline\(\)\)\{\s*\n\s*try\{if\(window\.__updateMailSettingsIndicator\)/.test(anstoss),
    'Der Mail-Anstoß läuft wieder auch lokal - 403 je Bereichswechsel');
  assert.ok(anstoss.indexOf('__bankRefreshIndicator') < anstoss.indexOf('__updateCalConnIndicator')
    || anstoss.indexOf('einIstOnline()') >= 0,
    'Die Gate-Struktur des Indikator-Anstoßes ist verändert - bitte 403-Verhalten lokal prüfen');
  assert.ok(html.includes('einIndikatorenZeichnen();\n  einFremdeIndikatorenAnstossen();'),
    'Nach dem Neuzeichnen der Navigation werden die Indikatoren nicht gefüllt');
});

test('Indikatoren: die Statusabfrage hält die Rechte ein (ausgeführt)', async () => {
  const db = require('../src/database/index');
  /* OR REPLACE / eigene Kennungen: frühere Tests in DIESER Datei teilen sich die Datenbank
     und legen 'rollen' bereits an (erst als Primärschlüsselkonflikt aufgefallen). */
  db.prepare(`INSERT OR REPLACE INTO cases (id,label,file_number,created_at,created_by)
    VALUES ('ind-f1','Fall','1 XVII 9/26',datetime('now'),1)`).run();
  db.prepare(`INSERT OR REPLACE INTO signatures (id,owner_user_id,name,data_url,visibility,created_at,updated_at)
    VALUES ('ind-s1',1,'Meine','data:,x','private',datetime('now'),datetime('now'))`).run();
  db.prepare("INSERT OR REPLACE INTO office_json (key,data_json) VALUES ('rollen',?)")
    .run(JSON.stringify({ rollen: [{ id: 'r1' }, { id: 'r2' }], zuweisungen: {} }));
  const faelle = db.prepare('SELECT COUNT(*) AS n FROM cases').get().n;
  const aktive = db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get().n;
  const eigeneSig = db.prepare(
    "SELECT COUNT(*) AS n FROM signatures WHERE owner_user_id = 1 OR visibility = 'office'").get().n;

  // (1) Nicht-Admin ohne Zusatzrechte: nur der eigene Bestand, KEINE Bürozahlen.
  sitzung = { isAdmin: false };
  const eng = JSON.parse((await ruf('GET', '/api/einstellungen-status')).text).status;
  assert.equal(eng.unterschriften, eigeneSig, 'Eigene Unterschriften fehlen');
  for (const geheim of ['nutzer', 'faelle', 'rollen', 'audit', 'mcp', 'formulare']) {
    assert.equal(eng[geheim], undefined,
      `"${geheim}" wird ohne Recht ausgeliefert - der Indikator verriete die Bürogröße`);
  }

  // (2) Fallzahl nur für wen sie ohnehin kein Geheimnis ist.
  sitzung = { isAdmin: false, canViewAllCases: true };
  const fa = JSON.parse((await ruf('GET', '/api/einstellungen-status')).text).status;
  assert.equal(fa.faelle, faelle, 'canViewAllCases bekommt die Fallzahl nicht');
  assert.equal(fa.nutzer, undefined, 'canViewAllCases bekommt fälschlich die Nutzerzahl');

  // (3) Admin sieht alles.
  sitzung = { isAdmin: true };
  const adm = JSON.parse((await ruf('GET', '/api/einstellungen-status')).text).status;
  assert.equal(adm.nutzer, aktive, 'Nutzerzahl fehlt');
  assert.equal(adm.rollen, 2, 'Rollenzahl kommt nicht aus dem office_json-Blob');
  assert.equal(adm.faelle, faelle, 'Fallzahl fehlt');
  sitzung = {};
});

/* ═══════════════════════════════════════════════════════════════════════════════════════
   Schnellzugriff „KI-Direktverbindung" im Nutzer-Menü (Nutzerwunsch 27.08. spät)
   ═══════════════════════════════════════════════════════════════════════════════════════ */
test('KI-Schnellzugriff: Eintrag, Ziel und Recht', () => {
  /* Nutzerwunsch 27.08. spät: GENAU der Aufbau wie im Lokal-Modus - ein aufklappbares
     Untermenü mit Anbieterwahl, den beiden Anbieter-Links, der Verbindungszeile und
     „Zugang konfigurieren", nicht bloß ein Link. Dieselben Anker wie lokal, also bedient
     updateAIMenuUI() beides ohne eine Zeile neuen Code (am Prüfstand: ein Anbieterwechsel
     im Menü schlägt auf alle vier data-ai-provider-Felder durch). */
  assert.ok(html.includes("'<details class=\"ai-direct-menu no-print\" data-user-menu-ki>'"),
    'Der KI-Schnellzugriff ist kein aufklappbares Untermenü wie im Lokal-Modus');
  for (const teil of ['data-ai-provider', 'ai-provider-links', 'data-ai-status-label',
    "openAIProviderPage(\\'access\\')", "openAIProviderPage(\\'docs\\')"]) {
    assert.ok(html.includes(teil), `Dem KI-Untermenü fehlt der Baustein aus dem Lokal-Modus: ${teil}`);
  }
  assert.ok(html.includes("if(window.__adSnapshotId&&typeof showAISettings==='function')return showAISettings();")
    && html.includes("if(window.openEinstellungenApp)window.openEinstellungenApp('ki');"),
    '„Zugang konfigurieren" führt nicht in den KI-Bereich');
  assert.ok(html.includes('.sidebar-bottom .ai-direct-body>details.ai-direct-menu>summary{'),
    'Das verschachtelte Untermenü hat nicht die Knopf-Optik seiner Geschwister');
  /* Kein neuer Rechte-Eintrag nötig: MENU_PERMISSION_RULES ordnet die Beschriftung bereits zu. */
  assert.ok(html.includes("['menuSettingsAi',text=>text.includes('KI-Direktverbindung')]"),
    'Die Beschriftungs-Regel für menuSettingsAi fehlt - der Schnellzugriff wäre ungeschützt');
  /* Das Nutzer-Menü darf den Schnellzugriff nicht mitreißen, wenn nur menuAdmin fehlt. */
  assert.ok(html.includes("auchWenn:['menuSettings','menuSettingsAi']"),
    'Ein entzogenes menuAdmin nimmt den KI-Schnellzugriff mit');
});

test('KI-Indikator: hängt am Serverstand, nicht am toten Browser-Zustand', () => {
  /* data-ai-status liest state.ui.aiDirect.status - den KI-Zustand des BROWSERS. Online wird
     die KI serverseitig eingerichtet; ensureAIConfig() baut das Objekt bei JEDEM Aufruf neu,
     der Zustand überlebt nicht, und der Punkt stand dauerhaft auf „Nicht geprüft" (am
     Prüfstand an allen sechs Knoten nachgewiesen). */
  assert.ok(!/ki:\{fremd:'ai-status'\}/.test(html),
    'Der KI-Bereich erbt weiterhin den online toten Browser-Indikator');
  /* 30.08.: Gruen erst nach erfolgreichem Verbindungstest (Nutzerfrage "Die kann doch erst
     gruen werden, wenn mindestens eine Verbindung aktiv getestet, oder?"). Der Eintrag rechnet
     jetzt selbst aus ki + kiGeprueft. */
  assert.ok(html.includes('ki:{eigen:()=>{'),
    'Der KI-Bereich zieht seinen Stand nicht mehr aus ki+kiGeprueft');
  assert.ok(html.includes("const g=(einStatusZahlen&&einStatusZahlen.kiGeprueft)||0;"),
    'Der KI-Eintrag fragt den Pruefstatus nicht ab');
  assert.ok(html.includes("noch keine Verbindung erfolgreich geprüft"),
    'Der ungepruefte Zustand wird nicht erklaert');
  assert.ok(html.includes('data-ein-ki-status'), 'Der Schnellzugriff hat keinen eigenen Indikator');
  assert.ok(html.includes('function einKiIndikatorZeichnen()'), 'Der Zeichner des Schnellzugriffs fehlt');
  /* Ohne erzwungenes Neuladen bliebe der Punkt nach dem Einrichten IM Menü auf dem alten Stand. */
  assert.ok(html.includes('window.__einKiIndikator=async function(neu){'),
    'Der Indikator des Schnellzugriffs kann kein Neuladen erzwingen');
  assert.ok(html.includes('if(window.__einKiIndikator)window.__einKiIndikator(true);'),
    'Beim Schließen des Menüs zieht der Schnellzugriff seinen Stand nicht nach');
  /* Der Schlüssel selbst darf die Route NIE verlassen - nur gezählt werden. */
  const route = lies('src', 'modules', 'settings', 'status-routes.js');
  assert.match(route, /out\.ki = /, 'Die Route liefert keine KI-Zahl');
  assert.ok(/if \(klar\) n\+\+;/.test(route), 'Die Route zählt nicht, ob ein Schlüssel entschlüsselbar ist');
  assert.ok(!/api_key_encrypted:/.test(route) && !/out\.\w+ = klar/.test(route),
    'Die Route reicht einen Schlüssel nach außen');
});

test('Nutzerbereich: bleibt am unteren Rand stehen und scrollt nicht weg', () => {
  /* Gemeldet 27.08. („Der Userbereich fehlt komplett!"): Das Nutzer-Menü ist die LETZTE Zeile
     von .sidebar-bottom, und diese Leiste scrollt intern, sobald ein Fall viele Module
     mitbringt oder das Fenster niedrig ist. Nachgestellt bei 560px Fensterhöhe: 1653px Inhalt
     in einer 466px hohen Leiste - null sichtbare Pixel. Solange dort nur Abmelden und
     Moduswechsel lagen, war das ein Schönheitsfehler; seit der Einstieg ins Einstellungsmenü
     dort sitzt, verschließt es die Einstellungen komplett. */
  /* DREI unabhängige Absicherungen - zwei Anläufe (sticky, dann absolut) trafen den
     gemeldeten Fall nicht, und auf dem Prüfstand war er nicht nachstellbar.

     (1) Die Leiste blendet per `.sidebar-bottom.nav-ready>*:not(.nav-ok)` jedes direkte Kind
         aus, das der Sortierer nicht freigegeben hat - mit `visibility:hidden`, also
         UNSICHTBAR ABER MIT PLATZ. Genau das gemeldete Bild („nicht sichtbar, dafür unten
         viel leerer Platz"). Der Nutzerbereich ist davon ausgenommen. */
  assert.ok(html.includes('.sidebar-bottom.nav-ready>*:not(.nav-ok){visibility:hidden}'),
    'Das Staging-Gate der Leiste ist weg - dann ist die Ausnahme unten irreführend');
  assert.ok(html.includes('visibility:visible!important;'),
    'Der Nutzerbereich ist nicht vom Staging-Gate ausgenommen');
  /* (2) sticky hält ihn am unteren Rand, wenn die Leiste scrollt (an JEDER Scrollposition
         nachgemessen: 46 sichtbare Pixel bei 2313px Inhalt in 405px Leiste). */
  assert.ok(html.includes('  position:sticky;\n  bottom:0;\n  z-index:4;'),
    'Der Nutzerbereich bleibt beim Scrollen nicht am unteren Rand');
  /* (3) nav-ok wird beim Einfügen selbst gesetzt - dann kann auch eine Reihenfolge, in der
         der Sortierer VOR dem Einfügen lief, nichts mehr kaputt machen. */
  assert.ok(html.includes("el.classList.add('nav-ok');"),
    'Der Nutzerbereich verlässt sich auf die Freigabe durch den Sortierer');
  /* Kein position:absolute mehr: das nahm die Zeile aus dem Fluss und hinterliess zusammen
     mit einem unsichtbaren Menü genau den beklagten Leerraum. */
  assert.ok(!html.includes('.sidebar-bottom{padding-bottom:58px!important}'),
    'Der reservierte Leerstreifen steht noch im Code');
  /* Ohne deckenden Hintergrund schiene der scrollende Inhalt durch. Die Farbe kommt aus
     derselben Quelle wie die Leiste selbst, damit beide nie auseinanderlaufen. */
  assert.ok(html.includes('background:var(--sidebar-bg,#163952);'),
    'Der angeheftete Streifen hat keinen deckenden Hintergrund');
  assert.ok(html.includes('.sidebar{background:#163952;--sidebar-bg:#163952;'),
    'Die Leistenfarbe steht nicht als Variable bereit - Streifen und Leiste könnten auseinanderlaufen');
});

test('Sortierer: das Nutzer-Menü darf nie in eine Gruppe einsortiert werden', () => {
  /* URSACHE des dreifach gemeldeten „Userbereich fehlt" (27.08., am Gerät des Nutzers
     gemessen: Höhe 0, geerbtes visibility:hidden, position:static, kein Kind der Leiste mehr):
     findGroupChild ordnet Einträge teils per BESCHRIFTUNG zu - die Einstellungen-Gruppe hat
     `{match:text=>text.includes('KI-Direktverbindung')}`. Seit im Nutzer-Menü ein Eintrag mit
     genau diesem Text steht, passte der Matcher auf das GANZE Menü (Substring-Kollision, wie
     bei den Gruppen-Wrappern eine Ebene höher), und regroup() verschob es in die Gruppe, die
     online per display:none verborgen ist. Deshalb GRUNDSÄTZLICH ausnehmen - so kann keine
     künftige Beschriftung dasselbe auslösen. */
  assert.ok(html.includes("      if(child.hasAttribute('data-user-menu'))return false;"),
    'findGroupChild nimmt das Nutzer-Menü nicht aus - eine Beschriftung kann es in eine Gruppe ziehen');
  /* Der Matcher, der es ausgelöst hat, ist weiterhin da - ohne ihn wäre der Kommentar falsch. */
  assert.ok(html.includes("{match:text=>text.includes('KI-Direktverbindung')}"),
    'Der Beschriftungs-Matcher ist weg - dann ist die Ausnahme oben irreführend');
  /* Der Eintrag, der die Kollision verursacht hat, trägt genau diesen Text. */
  assert.ok(html.includes('data-user-menu-ki>') && html.includes('<span>KI-Direktverbindung</span>'),
    'Der KI-Schnellzugriff heißt anders - die Ausnahme bleibt trotzdem richtig, der Pin muss nachgezogen werden');
});

/* ═══════════════════════════════════════════════════════════════════════════════════════
   KI-Zugangsdaten: EIN Umschalter statt drei Masken (Nutzerentscheidung 27.08.2026)

   Vorher gab es drei Bedienstellen für zwei Ebenen: den KI-Dialog oben, die Karte
   „Büro-Vorgabe oder eigene" in der Mitte und den Admin-Block unten. Oben und Mitte
   schrieben denselben Speicher - wer oben speicherte, schaltete die Büro-Vorgabe für sich
   stillschweigend ab. Zur Laufzeit gewinnt zudem der Schlüssel im BROWSER vor beidem.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
test('KI-Zugangsdaten: EIN Block, der Büro-Schlüssel gewinnt je Anbieter', () => {
  /* Nutzerentscheidung 30.08.2026 („wenn der Admin oben Inhalte einträgt, gelten sie büroweit;
     sonst kann der Mitarbeitende eigene eingeben"): Umschalter und Doppelmaske sind weg.
     Neue Regel, an EINER Stelle: hat das Büro für einen Anbieter einen Schlüssel, gilt er. */
  assert.ok(!html.includes("einMsKarten('einKiMs','ai')"), 'Die mittlere Doppelmaske ist zurück');
  assert.ok(!html.includes('data-ein-ki-quelle='), 'Der Umschalter Büro/Eigene lebt noch');
  assert.ok(!html.includes('function einKiQuelleZeichnen'), 'Der Umschalter-Zeichner lebt noch');
  assert.ok(!html.includes('function einKiFelderSperren'), 'Die alte Feldsperre lebt noch');
  /* Zweite Runde 30.08. abends („nach wie vor zu komplex"): auch der separate Büro-Block ist
     weg - beim Admin IST das Schlüsselfeld der Maske der Büro-Schlüssel. */
  assert.ok(!html.includes("einAdminEinbetten('ai'"), 'Der eingebettete Büro-Block ist zurück');
  assert.ok(!html.includes('async function renderAiTab'), 'Die alte Büro-Kartenliste lebt noch');
  assert.ok(html.includes('gilt für das ganze Büro</label>'), 'Das Admin-Feld sagt nicht, dass es büroweit gilt');
  assert.ok(html.includes("window.__aiBueroKeyZeigen=") && html.includes("window.__aiBueroKeyEntfernen="),
    'Anzeigen/Entfernen des Büro-Schlüssels fehlen in der Maske');
  assert.ok(html.includes("fetch('/api/admin/ai-config/'+encodeURIComponent(p)"),
    'Das Admin-Speichern schreibt nicht an die Büro-Route');
  const admin = lies('src', 'modules', 'admin', 'routes.js');
  assert.match(admin, /router\.delete\('\/ai-config\/:provider'/, 'Die Lösch-Route für Büro-Schlüssel fehlt');
  assert.match(admin, /'openai', 'anthropic', 'gemini', 'ionos', 'poe', 'langdock', 'deutschlandgpt', 'ollama'/,
    'Der Server kennt nicht alle 8 Anbieter (poe/langdock/deutschlandgpt könnten nie büroweit gelten)');
  /* „Verbindung testen" fällt auf den Büro-Schlüssel zurück - transient, ohne ihn in den
     Browser-Speicher zu übernehmen (der Race-Fix holt pc danach frisch). */
  assert.ok(html.includes('if(off&&off.apiKey){pc=Object.assign({},pc,{apiKey:off.apiKey'),
    'Testen ohne eigenen Schlüssel nutzt den Büro-Schlüssel nicht');
  /* 30.08.: der Erfolg des BUERO-Schluessel-Tests wird dem Server gemeldet (Pruefstatus,
     Nutzerwunsch "gruen erst nach aktivem Test") - fire-and-forget, nur im Buero-Key-Fall. */
  assert.ok(html.includes('bueroKeyImTest=true'),
    'Der Test merkt sich nicht, dass der Büro-Schlüssel im Spiel war');
  assert.ok(html.includes("fetch('/api/my-settings/ai-geprueft'"),
    'Der Testerfolg wird dem Server nicht gemeldet');
});

test('KI-Pruefstatus: gruen erst nach aktivem Test, Key-Wechsel setzt zurueck', () => {
  /* Nutzerfrage 30.08.2026: „Die kann doch erst grün werden, wenn mindestens eine Verbindung
     aktiv getestet, oder?" - Ja. Der Haken hängt jetzt an einem gespeicherten Prüferfolg
     (office_json ki_pruefstatus), nicht am bloßen Vorhandensein eines Schlüssels. */
  const meine = lies('src', 'modules', 'settings', 'my-settings-routes.js');
  assert.match(meine, /router\.post\('\/ai-geprueft'/, 'Die Melde-Route fehlt');
  assert.ok(meine.includes("if (!row || !decryptSafe(row.api_key_encrypted))"),
    'Die Meldung wird ohne echten Büro-Schlüssel angenommen (Haken wäre erschleichbar)');
  const status = lies('src', 'modules', 'settings', 'status-routes.js');
  assert.ok(status.includes('out.kiGeprueft'), 'Die Statusabfrage liefert die geprüfte Anzahl nicht');
  assert.ok(status.includes("flags[row.provider] && flags[row.provider].ok"),
    'Geprüft zählt nicht: Flag UND entschlüsselbarer Schlüssel je Anbieter');
  const admin = lies('src', 'modules', 'admin', 'routes.js');
  assert.ok(admin.includes('function kiPruefstatusLoeschen(provider)'),
    'Es gibt keinen Weg, das Prüf-Flag zurückzusetzen');
  assert.ok(admin.includes('if (apiKey) kiPruefstatusLoeschen(provider);'),
    'Ein NEUER Schlüssel bleibt fälschlich als geprüft markiert');
  assert.ok(admin.includes("db.prepare('DELETE FROM office_ai_config WHERE provider = ?').run(provider);\n  kiPruefstatusLoeschen(provider);"),
    'Ein gelöschter Anbieter behält sein Prüf-Flag');
});

test('KI-Zugangsdaten: das Feld weicht dem Hinweis, wenn das Büro einen Schlüssel hat', () => {
  /* Entscheidung 30.08.2026: kein totes, gesperrtes Eingabefeld mehr - wo der Büro-Schlüssel
     gilt, steht ein Satz statt eines Feldes. */
  assert.ok(html.includes('window.__aiBueroSchluessel=function(provider){'),
    'Die Prüfung „hat das Büro einen Schlüssel?" fehlt');
  /* Prüfstand-Fund 30.08.2026: aiConfig trägt nach dem Zusammenführen AUCH eigene Schlüssel -
     die Herkunft muss der Server getrennt mitliefern, sonst behauptet die Oberfläche bei einem
     rein persönlichen Schlüssel „vom Büro hinterlegt". */
  const auth0 = lies('src', 'modules', 'auth', 'routes.js');
  assert.match(auth0, /const aiBueroAnbieter = aiAllowed/, 'Der Server liefert die Herkunfts-Liste nicht');
  assert.match(auth0, /return \{ aiConfig: ai, aiBueroAnbieter,/, 'aiBueroAnbieter fehlt in der Antwort');
  assert.ok(html.includes('const liste=window.__officeCredentials&&window.__officeCredentials.aiBueroAnbieter;'),
    'Der Client prüft wieder gegen aiConfig statt gegen die Herkunfts-Liste');
  /* Beide Übernahme-Stellen (Login und Nachladen) müssen das Feld durchreichen. */
  assert.equal((html.match(/aiBueroAnbieter:\(?(payload&&payload\.aiBueroAnbieter\)\|\||d\.aiBueroAnbieter\|\|)\[\]/g) || []).length, 2,
    'Login oder Nachladen reicht aiBueroAnbieter nicht durch');
  assert.ok(html.includes('ist vom Büro hinterlegt und gilt für alle.'),
    'Der Hinweis, der das Feld ersetzt, fehlt');
  assert.ok(html.includes('Das Büro hat für diesen Anbieter keinen Schlüssel hinterlegt – Ihr eigener gilt nur für Sie.'),
    'Der Hinweis am eigenen Feld fehlt');
  /* Der Speicher-Hinweis oben stimmt jetzt je Lage (vorher pauschal „im Browser gespeichert",
     was für die Büro-Vorgabe falsch war). */
  assert.ok(html.includes("Für diesen Anbieter gilt der <strong>Schlüssel des Büros</strong>"),
    'Der Speicher-Hinweis unterscheidet die beiden Fälle nicht');
  assert.ok(!html.includes('Die API-Keys werden im Browser gespeichert.'),
    'Der pauschale (für die Büro-Vorgabe falsche) Speicher-Hinweis ist zurück');
});

test('KI-Zugangsdaten: der Büro-Schlüssel gewinnt zur Laufzeit – Server und Client gleich', () => {
  /* Server löst JE ANBIETER auf (vorher Entweder-Oder je Nutzer: ein eigener Claude-Schlüssel
     setzte auch den büroweiten ChatGPT-Schlüssel außer Kraft). */
  const auth = lies('src', 'modules', 'auth', 'routes.js');
  assert.match(auth, /function aiJeAnbieter\(buero, eigen\)/, 'Die Auflösung je Anbieter fehlt');
  assert.match(auth, /const ai = aiAllowed \? aiJeAnbieter\(officeAiConfig\(\), aiOverride\) : \{\};/,
    'decryptedOfficeConfig nutzt die Auflösung je Anbieter nicht');
  assert.ok(!auth.includes("(aiOverride && typeof aiOverride === 'object') ? aiOverride : officeAiConfig()"),
    'Das alte Entweder-Oder je Nutzer ist zurück');
  /* Client: derselbe Vorrang - vorher gewann der Browser-Schlüssel. */
  assert.ok(html.includes('if(office&&office.apiKey){'), 'Im providerCall gewinnt wieder der Browser-Schlüssel');
  assert.ok(!html.includes('if(office&&office.apiKey&&!hasOwnKey){'), 'Der alte Browser-Vorrang lebt noch');
  /* Zweite Kopie derselben Regel (Transkription in der Betreuungsübersicht) mitgezogen. */
  assert.ok(html.includes('/* Büro-Schlüssel gewinnt (30.08.2026) - dieselbe Regel wie im providerCall-Wrapper. */'),
    'Die Transkriptions-Kopie der Regel wurde nicht mitgezogen');
});

test('KI-Zugangsdaten: eigene Werte wandern serverseitig mit, wenn das Recht da ist', () => {
  /* Der Server-PUT hing am Umschalter; jetzt am Recht „Zugangsdaten/API-Keys". Wo das Büro
     einen Schlüssel hat, gewinnt dieser ohnehin - der persönliche Wert schadet dort nicht. */
  assert.ok(html.includes("if(window.__appMode==='online'&&window.__einKiDarfEigene&&window.__einKiDarfEigene()){"),
    'Das Speichern hängt nicht am Recht (oder noch am entfallenen Umschalter)');
  assert.ok(html.includes('window.__einKiDarfEigene=einKiDarfEigene;'), 'Die Rechteprüfung ist nicht exportiert');
  const us = lies('src', 'modules', 'settings', 'user-settings.js');
  assert.match(us, /ai: 'manageCredentials'/, 'Das Recht für eigene KI-Zugangsdaten heißt anders');
  const ms = lies('src', 'modules', 'settings', 'my-settings-routes.js');
  assert.match(ms, /userMayOverride\(user, req\.session\.mode, area\)/, 'Die Route prüft das Recht nicht mehr');
  assert.ok(html.includes('function einKiDarfEigene(){') && html.includes('u.isAdmin||u.canManageCredentials'),
    'Der Client prüft das falsche Recht');
});

test('Standard-Ausgangskonto: der Stern sitzt in der Kontenliste, das Auswahlfeld ist weg', () => {
  /* Nutzerwunsch 27.08.: Oben die Konten, unten das Standardkonto - zusammenführen. Die Wahl
     sitzt jetzt als Stern in der Kontenzeile selbst; das zweite Auswahlfeld in den
     persönlichen Mail-Einstellungen ist entfallen. Geschrieben wird derselbe eine Speicher
     wie überall (mail_prefs.defaultAccountId). */
  assert.ok(!html.includes('mxpDefAcc'), 'Das doppelte Auswahlfeld steht noch in den Mail-Einstellungen');
  assert.ok(html.includes('function mxStandardStern(a){'), 'Der Stern in der Kontenzeile fehlt');
  assert.ok(html.includes('+mxStandardStern(a)'), 'Die Kontenzeile zeichnet den Stern nicht');
  assert.ok(html.includes('window.__mxA.standard('), 'Der Stern löst keine Aktion aus');
  assert.ok(html.includes("await window.__mxNotify.speichern({defaultAccountId:ziel});"),
    'Der Stern schreibt nicht in den gemeinsamen Speicher');
  /* Nochmal klicken hebt die eigene Wahl auf - sonst wäre man darin gefangen. */
  assert.ok(html.includes("const ziel=(eigen===String(id))?'':String(id);"),
    'Ein gesetzter Stern lässt sich nicht wieder lösen');
  /* Eine zwingende Bürovorgabe sperrt den Stern - an beiden Stellen. */
  assert.ok(html.includes('function mxStandardZwang(){'), 'Der Stern kennt die zwingende Vorgabe nicht');
  assert.ok(html.includes("if(mxStandardZwang()){toast('Das Standard-Ausgangskonto ist vom Büro festgelegt.');return}"),
    'Die Aktion lässt sich an der gesperrten Schaltfläche vorbei auslösen');
});

test('„Woher kommt was": der Hinweis auf den abgelösten Dialog ist entfernt', () => {
  assert.ok(!html.includes('löst den bisherigen Dialog'),
    'Der Hinweis auf „Meine Einstellungen" steht noch in der Überschrift');
  assert.ok(html.includes("+'<p>Für jede verdrahtete Einstellung: wer sie festgelegt hat und was für Sie gilt.</p></div>'"),
    'Der Einleitungssatz von „Woher kommt was" fehlt');
});

test('Standard-Ausgangskonto: auch die BÜRO-Ebene hat nur noch eine Stelle', () => {
  /* Nach dem Stern in der Kontenliste blieb die Doppelung eine Ebene höher: die Vorgabe unter
     „Versandwege" (einstellungs_vorgaben, Rang 1 bzw. 4) UND ein zweites Admin-Feld im
     Mail-Block, das ui_prefs.defaultSendAccount schrieb - Rang 5, also die schwächste Stufe.
     Wer das zweite benutzte, wurde von jeder Vorgabe still überstimmt. */
  assert.ok(!html.includes('adminComposeDefaultAccount'),
    'Das zweite Admin-Feld für das Standard-Ausgangskonto steht noch im Mail-Block');
  /* 28.08. nachgezogen: Der Verweis zeigte auf „Einstellungen → Versandwege". Dort steht das
     Standard-Ausgangskonto seit demselben Tag nicht mehr - es ist als Mail-Einstellung auf die
     Mail-Seite gewandert. Der Satz zeigte damit auf einen leeren Ort. */
  assert.ok(html.includes('steht in den Mail-Einstellungen unter „Standard-Ausgangskonto (E-Mail)"'),
    'Der Mail-Block sagt nicht, wo die Vorgabe jetzt gesetzt wird');
  /* Einmalige Übernahme in die RICHTIGE Ebene - als überschreibbare Vorgabe, damit niemandem
     die eigene Wahl genommen wird. */
  assert.ok(html.includes('async function einBueroSendekontoUebernehmen(){'),
    'Die Übernahme der Büro-Ebene fehlt');
  assert.ok(html.includes("stufe:'buero',ziel:'',wert:String(alt),zwingend:false}"),
    'Der Altwert wandert nicht als überschreibbare Büro-Vorgabe hinüber');
  /* Eine bereits vorhandene Vorgabe darf NICHT überschrieben werden - sie war ohnehin stärker. */
  assert.ok(html.includes("const schon=(einVorgaben||[]).some(z=>z&&z.key==='versand.standardkonto'&&z.stufe==='buero');"),
    'Die Übernahme prüft nicht, ob schon eine Büro-Vorgabe existiert');
  assert.ok(html.includes('await einBueroSendekontoUebernehmen();'),
    'Die Übernahme wird nicht angestoßen');
  /* Nur wer das Büro verwalten darf - sonst liefe der Vorgaben-PUT in einen 403. */
  assert.ok(html.includes("if(!(einIstAdmin()||(window.__currentUser||{}).canManageOfficeProfile))return;"),
    'Die Übernahme läuft auch ohne Verwaltungsrecht los');
  /* ui_prefs bleibt als letzte Stufe im Leser - für noch nicht übernommene Bestände. */
  assert.ok(html.includes('var v=up().defaultSendAccount;return v||\'\';};'),
    'Die Alt-Stufe ist aus dem Effektiv-Leser verschwunden - Bestände ohne Übernahme verlören ihren Wert');
});

/* ═══════════════════════════════════════════════════════════════════════════════════════
   Mail-Signaturen: zwei Texte + eine Wahl je Konto (Nutzerentscheidungen 28.08.2026)

   Vorher DREI Speicher mit fester, unsichtbarer Rangfolge: Konto > persönlich > Büro.
   Jetzt zwei Texte (Büro, persönlich) und je Konto die sichtbare Wahl, welcher gilt.
   Entschieden wurde: nur zwei Stufen, kein Rückfall im Leerfall, alte Konto-Texte verwerfen.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
test('Signaturen: die Auflösung folgt der Wahl am Konto, ohne Rückfall', () => {
  assert.ok(html.includes("if(acc&&acc.signatureSource==='personal'){"),
    'Die Auflösung liest die Wahl am Konto nicht');
  /* „Meine Signatur" ohne hinterlegten Text = KEINE Signatur (so entschieden) - der Rückfall
     auf die Büro-Signatur wäre bequemer, nähme die Wahl aber nicht wörtlich. */
  assert.ok(html.includes("return String(p.personalSignature||'');"),
    'Der Leerfall fällt weiterhin auf eine andere Signatur zurück');
  assert.ok(!html.includes("if(acc&&String(acc.signature||'').trim())return acc.signature;"),
    'Die abgelöste Stufe „Konto-Signatur" steht noch in der Auflösung');
});

test('Signaturen: der Kontodialog zeigt die Wahl statt eines dritten Textfelds', () => {
  assert.ok(!html.includes('Signatur dieses Kontos'), 'Der dritte Signaturtext steht noch im Kontodialog');
  assert.ok(html.includes("+'<select id=\"amSignatureSource\">'"), 'Das Wahlfeld fehlt im Kontodialog');
  assert.ok(html.includes('Persönliche Signatur der sendenden Person'),
    'Die zweite Stufe ist nicht benannt');
  /* Der Leerfall muss AN DER STELLE stehen, an der man ihn auslöst. */
  assert.ok(html.includes('sendet ohne Signatur.'), 'Der Leerfall wird nicht erklärt');
  /* Ohne diese Zeile sammelt amCollect() die Wahl ein, der PUT-Rumpf trägt sie aber nicht -
     Speichern meldete Erfolg, am Server blieb alles beim Alten (Prüfstand-Fund). */
  assert.ok(html.includes("signature:'',signatureSource:(e.signatureSource==='personal'?'personal':'office'),"),
    'Der PUT-Rumpf trägt die Wahl nicht zum Server');
});

test('Signaturen: die abgelösten Konto-Texte werden einmal gezeigt, bevor sie fort sind', () => {
  const db = lies('src', 'database', 'index.js');
  assert.match(db, /addColumnIfMissing\('mail_accounts', 'signature_source'/,
    'Die Spalte für die Signaturquelle fehlt');
  assert.match(db, /INSERT OR REPLACE INTO office_json \(key, data_json\) VALUES \('mail_signaturen_abgeloest'/,
    'Die abgelösten Texte werden nicht beiseitegelegt - das Verwerfen wäre unsichtbar');
  assert.match(db, /UPDATE mail_accounts SET signature = '' WHERE TRIM\(signature\) <> ''/,
    'Die Konto-Signaturen werden nicht geleert');
  assert.ok(html.includes('async function einAbgeloesteSignaturen(){'),
    'Die einmalige Anzeige der entfernten Texte fehlt');
  /* Klartext aus fremden Postfächern - Lese- UND Schreibschranke, sonst käme jeder mit
     Fall-Sichtrecht heran (Vorgabe der Route wäre requireViewCases). */
  const oj = lies('src', 'modules', 'office', 'json-routes.js');
  assert.equal((oj.match(/mail_signaturen_abgeloest/g) || []).length, 3,
    'Der Schlüssel fehlt in KEYS, in der Lese- oder in der Schreibschranke');
});

test('Systemversand: das benutzte Konto lässt sich nicht mehr still entziehen', () => {
  /* Bisher konnte genau dieses Konto ohne Warnung auf privat gestellt oder gelöscht werden -
     danach funktionierten Passwort-Mails nicht mehr, ohne Fehlermeldung. */
  const mb = lies('src', 'modules', 'mail', 'mailbox-routes.js');
  assert.match(mb, /function istSystemversandKonto\(id\)/, 'Die Prüfung auf das Systemversand-Konto fehlt');
  assert.equal((mb.match(/systemversand-in-benutzung/g) || []).length, 2,
    'Der Schutz greift nicht bei BEIDEN Wegen (auf privat stellen UND löschen)');
  assert.match(mb, /systemversandStilllegen/, 'Es gibt keinen Weg, es ausdrücklich doch zu tun');
  /* Leerstring, nicht NULL: die Spalte ist NOT NULL - ein NULL-Versuch scheitert still und der
     Verweis bliebe stehen (am Prüfstand aufgefallen). */
  assert.match(mb, /UPDATE smtp_config SET send_account_id = '', updated_at/,
    'Der Verweis wird mit NULL gelöst - das scheitert an der NOT-NULL-Spalte');
});

test('Systemversand: die Zuweisung sitzt in der Kontenzeile, das Auswahlfeld ist weg', () => {
  /* Schritt 1 des Konzepts (Nutzerwunsch 28.08.): Was ein Konto betrifft, hängt am Konto. */
  assert.ok(html.includes("buero:'<rect x=\"2\" y=\"7\" width=\"20\" height=\"14\" rx=\"2\" ry=\"2\"/>"),
    'Das Aktenkoffer-Symbol fehlt im Symbolsatz des Mail-Blocks');
  assert.ok(html.includes('function mxSystemversandKnopf(a){'), 'Der Systemversand-Marker fehlt in der Zeile');
  assert.ok(html.includes('+mxSystemversandKnopf(a)'), 'Die Kontenzeile zeichnet den Marker nicht');
  assert.ok(html.includes('async systemversand(id){'), 'Die Aktion fehlt');
  /* Private Konten: gesperrt MIT Begründung (so entschieden), nicht unsichtbar. */
  assert.ok(html.includes("titel='Nur büroweite Konten können den Systemversand tragen"),
    'Bei privaten Konten fehlt die Begründung');
  assert.ok(html.includes("if(!ist&&a&&a.visibility!=='public'){"),
    'Die Sperre lässt sich an der Schaltfläche vorbei auslösen');
  assert.ok(html.includes('<select id="adminSendAccount" hidden>'),
    'Das abgelöste Auswahlfeld ist noch sichtbar');
});

test('Fußleisten: die Sticky-Regel des KI-Dialogs greift nur auf DESSEN Leiste', () => {
  /* Gemeldet 28.08.: „Bei manchen ist die untere Leiste (Speichern) nicht richtig gesetzt,
     sodass man unter ihr keine Inhalte sehen kann." Ursache: die Regel zielte auf JEDE
     .button-row im geteilten Modal - auf der KI-Seite klebten dadurch NEUN Leisten
     gleichzeitig unten fest (die acht Anbieter-Reihen des Büro-Blocks mitgezählt) und
     verdeckten den Inhalt darunter. Nachgemessen: vorher 9 von 9 sticky, jetzt 1. */
  assert.ok(html.includes('#modal:has(.ai-config-grid) .ai-config-actions{position:sticky'),
    'Die Sticky-Regel zielt nicht auf die eigene Leiste des KI-Dialogs');
  assert.ok(!html.includes('#modal:has(.ai-config-grid) .button-row{position:sticky'),
    'Die alte Regel trifft weiterhin JEDE Knopfleiste im Modal');
  assert.ok(html.includes('<div class="button-row ai-config-actions">'),
    'Der KI-Dialog trägt die Klasse nicht - dann greift die Regel gar nicht mehr');
});

test('Feldhöhen: Textfeld, Dropdown und Uhrzeit stehen in einer Linie', () => {
  /* Gemeldet 28.08.: „Achte mal darauf dass die Kästen links (Felder, Drop-Down, Uhrzeit) die
     gleiche höhe haben." Ursache waren zwei Dinge. Erstens deckte der Selektor nur select und
     input[type=text] ab - ein input[type=time] (typ:'zeit') bekam gar keine Höhe und rutschte
     auf die Eigenhöhe des Browsers (gemessen: 31 gegen 24 Pixel). Jetzt greift die Regel über
     alle Eingabefelder ausser Ankreuzfeldern, mit fester Höhe und border-box, damit Polsterung
     und Rahmen nicht obendrauf kommen. */
  assert.ok(html.includes('.set-feld select,.set-feld input:not([type="checkbox"]):not([type="radio"])'),
    'Die linke Spalte deckt nicht alle Eingabefelder ab - Uhrzeitfelder fallen wieder heraus');
  assert.ok(html.includes('.set-vneu select:not([multiple]),.set-vneu input:not([type="checkbox"]):not([type="radio"])'),
    'Die rechte Vorgabenspalte deckt nicht alle Eingabefelder ab');
  /* Die Mindestbreite gilt weiter NUR für Dropdown und Textfeld: ein 200 Pixel breites
     Uhrzeitfeld sähe unsinnig aus. */
  assert.ok(html.includes('.set-feld select,.set-feld input[type="text"]{min-width:200px}'),
    'Die Mindestbreite gilt nicht mehr gezielt für Dropdown und Textfeld');
  /* Mehrfachauswahl (Personenwähler) bleibt mehrzeilig - eine feste Zeilenhöhe würde sie
     unbedienbar machen. */
  assert.match(html, /\.set-vneu select\[multiple\]\{[^}]*padding:5px 8px/,
    'Die Mehrfachauswahl wird in die Einzeilen-Höhe gezwungen');
});

test('Dokumentinfo-Höhe greift nur in ihrem eigenen Dialog', () => {
  /* Am Prüfstand über die CSSOM ermittelt: `#modal:has(.doc-info-actions) select{height:38px
     !important}` gewann gegen die Zeilenhöhe des Einstellungsmenüs (Versandwege: 38 statt 34).
     .doc-info-actions ist längst keine Kennung dieses Dialogs mehr, sondern die allgemeine
     Klasse für klebende Fußzeilen - fünf Dialoge tragen sie. Jetzt benannt, was gemeint war:
     die Karten und Raster, in denen der Dokumentinfo-Dialog seine Dropdowns baut. */
  assert.ok(!html.includes('#modal:has(.doc-info-actions) select{'),
    'Die Regel greift wieder auf JEDES Dropdown im geteilten Modal über');
  assert.ok(html.includes('#modal .export-options-card select,#modal .export-config-grid select,'),
    'Die Höhe des Dokumentinfo-Dialogs zielt nicht auf seine eigenen Behälter');
  assert.ok(html.includes('#modal .doc-options-card select,#modal #recipientContactArea select{'),
    'Der Empfängerblock des Dokumentinfo-Dialogs fällt aus der Regel');
  /* Gegenprobe im Aufbau: Diese Behälter gibt es im Dialog wirklich. */
  assert.ok(html.includes('class="export-config-grid"'), 'Der Behälter export-config-grid fehlt im Dialog');
  assert.ok(html.includes('class="doc-options-card"'), 'Der Behälter doc-options-card fehlt im Dialog');
  assert.ok(html.includes('id="recipientContactArea"'), 'Der Empfängerblock fehlt im Dialog');
});

test('Vorlagen & Formulare: der Speicherwege-Hinweis klebt nicht mehr unten', () => {
  /* Gemeldet 28.08.: „Die Erklärung zu den Speicherwegen muss nicht angeheftet bleiben, sondern
     kann einfach unten stehen." Ursache war ein EIGENER Rollkasten um die Tabelle
     (overflow:auto;max-height:56vh) - dadurch stand der Hinweis darunter dauerhaft am Rand und
     es gab zwei Rollbalken übereinander. */
  assert.ok(!html.includes('<div style="overflow:auto;max-height:56vh"><table class="cf-liste">'),
    'Die Formulartabelle hat wieder einen eigenen Rollkasten - der Hinweis klebt dann erneut unten');
  assert.ok(html.includes('<div style="overflow-x:auto"><table class="cf-liste">'),
    'Die Tabelle ist nicht mehr quer rollbar - breite Spalten schieben dann die Seite');
});

test('Mail-Einstellungen: Reihenfolge Systemversand → Signatur → Regeln → Vorlagen', () => {
  /* Nutzerwunsch 28.08.: „Systemversand über die E-Mail-Vorlagen … Eingangs-Regeln auch …
     Die E-Mail-Vorlagen sollten dann ganz unten sein." */
  const pos = (t) => {
    const i = html.indexOf(t);
    assert.ok(i > 0, `Baustein nicht gefunden: ${t}`);
    return i;
  };
  const sys = pos('<h3>Systemversand (Passwort-Mails, Direktversand)</h3>');
  const sig = pos('<h3>Signatur des Büros</h3>');
  const reg = pos('<h3>Eingangs-Regeln</h3>');
  const vor = pos('<h3>E-Mail-Vorlagen</h3>');
  assert.ok(sys < sig, 'Die Signatur des Büros steht nicht hinter dem Systemversand');
  assert.ok(sig < reg, 'Die Eingangs-Regeln stehen nicht hinter der Signatur');
  assert.ok(reg < vor, 'Die E-Mail-Vorlagen stehen nicht ganz unten');
});

test('Schritt 3: die Büro-Signatur hat einen eigenen Kasten und einen eigenen Speicherweg', () => {
  /* Entscheidung 28.08.: getrennt lassen, nur verschieben - die Büro-Signatur zieht aus dem
     Kasten „Systemversand" heraus, die persönliche bleibt bei den persönlichen Einstellungen. */
  assert.ok(html.includes('<div class="set-kartenkopf"><h3>Signatur des Büros</h3>'), 'Der eigene Kasten fehlt');
  assert.ok(!html.includes('<label>Signatur (wird im Mail-Editor automatisch unter die Nachricht gesetzt)</label>'),
    'Das Signaturfeld steckt noch im Systemversand-Kasten');
  assert.ok(html.includes('async function saveBueroSignatur(){'), 'Der eigene Speicherweg fehlt');
  /* NUR die Signatur hinausschicken - der Server lässt nicht mitgeschickte Felder unverändert,
     sonst würde dieser Knopf nebenbei Empfänger und Versandkonto mitspeichern. */
  assert.ok(html.includes("body:JSON.stringify({signature:text})"),
    'Der Signatur-Knopf schickt mehr als die Signatur');
  assert.ok(html.includes('saveSmtpConfig,saveBueroSignatur,sendTest'), 'Der Weg ist nicht nach außen gegeben');
  /* Der Mail-Baustein hält die Signatur zwischengespeichert - ohne Auffrischen zeigt das
     Verfassen-Fenster nach dem Speichern noch den alten Text. */
  assert.ok(html.includes('window.__mxSignaturNeu=function(text){'), 'Der Zwischenspeicher wird nicht aufgefrischt');
  /* Persönliche Signatur bleibt, wo sie war (so entschieden). */
  assert.ok(html.includes('Meine Signatur'), 'Die persönliche Signatur ist verschwunden');
});

test('Abgelöste Konto-Signaturen verschwinden, sobald die neue Büro-Signatur steht', () => {
  /* Entscheidung 28.08.: „Löschen, sobald die neuen Texte stehen." Genau das - nicht früher:
     solange die Büro-Signatur leer ist, bleiben die Alttexte sichtbar, sonst wären sie fort,
     bevor jemand sie übernehmen konnte. */
  assert.ok(html.includes('window.__einSigAltAbraeumen=async function(){'), 'Der Aufräumer fehlt');
  assert.ok(html.includes('if(text&&text.trim()&&window.__einSigAltAbraeumen)'),
    'Es wird auch bei LEERER Signatur aufgeräumt - dann sind die Alttexte zu früh weg');
  assert.ok(html.includes('Dieser Kasten verschwindet, sobald unten eine Signatur des Büros gespeichert ist'),
    'Der Hinweis sagt nicht, wann die Texte verschwinden');
  /* Der Weg von Hand bleibt daneben bestehen. */
  assert.ok(html.includes('data-ein-sig-alt-weg'), 'Der Knopf „Erledigt" ist verlorengegangen');
});

test('Reine Vorgabe-Regeln sagen, wo man sie umstellt', () => {
  /* Gemeldet 28.08.: „Wieso kann ich Eigene Dateinamen-Vorlagen erlaubt … nicht einstellen
     sondern nur erlaubt?" Antwort: nurVorgabe-Einträge sind Regeln ÜBER Personen, keine eigene
     Wahl - der Schalter sitzt rechts in der Vorgabespalte. Es sagte nur niemand. */
  assert.ok(html.includes('Regel für das ganze Büro – rechts unter „Vorgabe" umstellen.'),
    'Die Zeile sagt nicht, wo die Regel gesetzt wird');
  assert.ok(html.includes('Das legt die Bürovorgabe fest – eine eigene Wahl gibt es hier nicht.'),
    'Wer keine Vorgaben setzen darf, bekommt keine Erklärung');
  /* Links stand „erlaubt", rechts im selben Feld „ein" - dieselbe Sache, zwei Wörter. */
  assert.ok(html.includes("const w=kat.worte||['ein','aus'];return wert===false?w[1]:wert===true?w[0]:'—';"),
    'Die Beschriftung links folgt nicht der Wortwahl des Eintrags');
  assert.equal((html.match(/nurVorgabe:true,worte:\['erlaubt','gesperrt'\]/g) || []).length, 2,
    'Nicht beide Erlaubnis-Regeln sprechen dieselbe Sprache');
});

test('Datenadministration: fünf gleich gebaute Karten über die volle Breite (Variante B)', () => {
  /* Nutzerentscheidung 28.08. nach Mockup-Vergleich. Das äußere Raster .da-grid stellte je zwei
     Karten nebeneinander und STRECKTE dabei die kürzere auf die Höhe der längeren - die kurze
     Kalender-Karte stand mit 402 px leerem Innenraum neben der tiefen Sicherheits-Karte
     (am Mockup bei 1440 px Fensterbreite gemessen: 406 px leere Fläche insgesamt, danach 5 px). */
  assert.ok(!html.includes('<div class="da-grid">'), 'Das äußere Raster steht wieder im Aufbau');
  assert.ok(!html.includes('.da-grid{display:grid'), 'Die tote Regel des äußeren Rasters ist zurück');
  assert.ok(html.includes('return `${bueroSection}${adrSection}${credSection}${calSection}${secSection}`;'),
    'Die Karten stehen nicht mehr einzeln untereinander');
  /* Alle fünf teilen sich innen gleich auf - das ist der Kern der Variante. */
  assert.equal((html.match(/<div class="da-karte-zwei">/g) || []).length, 5,
    'Nicht alle fünf Karten sind innen zweispaltig');
  /* 28.08. nachgebessert: feste zwei Spalten liessen im ~1000px-Fenster nur EINEN 210px-Knopf
     je Haelfte zu - die vier Exporte standen untereinander. Jetzt entscheidet der Platz. */
  assert.ok(html.includes('.da-karte-zwei{display:grid;grid-template-columns:repeat(auto-fit,minmax(500px,1fr))'),
    'Das innere Raster richtet sich nicht mehr nach dem Platz');
  /* Der Schlüsselbereich sitzt rechts neben Restore: Trennlinie nach links statt nach oben. */
  assert.ok(html.includes('.da-karte-zwei>.da-recovery-panel{margin-top:0;padding-top:0;border-top:0;'),
    'Der Schlüsselbereich trägt noch seine obere Trennlinie aus der gestapelten Bauform');
  /* Nur DIREKTE Kinder: sonst verliert auch der Knopfblock im Schlüsselbereich seinen Abstand. */
  assert.ok(html.includes('.da-karte-zwei>.da-row{margin:0}'),
    'Die Nullmarge greift auf alle Zeilen durch, auch auf die im Schlüsselbereich');
  /* Auf dem Telefon muss das innere Raster einspaltig werden - sonst stehen zwei halbe
     Spalten auf 390 px Breite. */
  assert.ok(html.includes('.doku-filter-grid-v162,.da-karte-zwei,.fr-grid'),
    'Der Mobil-Vertrag zielt noch auf das entfallene äußere Raster');
});

test('Umbau-Notizen sind aus der Oberfläche verschwunden', () => {
  /* Nutzerwunsch 28.08.: „Lösche Hinweistexte" / „Schneide die alten Köpfe ab!" Es waren vier
     Sätze, die nur die Geschichte eigener Umbauten erzählten - für die Arbeit im Büro ohne Wert. */
  assert.ok(!html.includes('Bisher steckten diese Schalter in den Mail-Einstellungen'),
    'Die Herkunftsnotiz der Benachrichtigungen steht wieder da');
  assert.ok(!html.includes('Bis 28.08.2026 stand hier ein zweites Auswahlfeld'),
    'Die Notiz zum abgelösten Versandkonto-Feld steht wieder da');
  assert.ok(!html.includes('Bis 27.08.2026 stand hier ein zweites Feld'),
    'Die Notiz zum abgelösten Ausgangskonto-Feld steht wieder da');
  assert.ok(!html.includes('Zurzeit sendet das Programm noch über die früher hier hinterlegten Alt-Zugangsdaten'),
    'Die gelbe Altlast-Meldung ist zurück');
  /* Die Sätze, die eine ANWEISUNG enthalten, bleiben - nur der historische Teil ist weg. */
  assert.ok(html.includes('Welches Konto den Systemversand trägt, bestimmen Sie oben in der Kontenliste'),
    'Mit der Notiz ist auch die Anleitung verschwunden');
  assert.ok(html.includes('Welches Konto beim Verfassen vorausgewählt ist'),
    'Mit der Notiz ist auch der Verweis auf das Standard-Ausgangskonto verschwunden');
  /* 28.08. nachmittags entschieden: Die Ausweichstrecke ist nicht nur unangekündigt, sondern
     GANZ weg (Auswahl „Alt-Zugangsdaten entfernen"). Ohne zugewiesenes Konto meldet der
     Systemversand sauber „nicht konfiguriert", statt still über Zugangsdaten zu senden, die in
     der Oberfläche nirgends mehr sichtbar sind. */
  const svc = lies('src', 'modules', 'mail', 'service.js');
  assert.ok(!/  return row;\n\}/.test(svc),
    'Die Ausweichstrecke auf die Alt-Zugangsdaten ist zurück');
  assert.match(svc, /host: '', username: '', password_encrypted: '', graph_connection_id: null/,
    'Ohne Konto werden die Zugangsdaten-Felder nicht geleert - isConfigured() bliebe true');
  /* Empfänger und Signatur hängen NICHT am Konto und müssen überleben. */
  assert.match(svc, /Object\.assign\(\{\}, row, \{/,
    'Die Zeile wird ersetzt statt ergänzt - Empfänger und Signatur gingen verloren');
});

test('Vorschlagslisten: die linke Spalte reicht so weit wie die rechte', () => {
  /* Gemeldet 28.08.: „Die linke Liste sollte genausoweit nach unten reichen wie die rechte
     (im Rahmen der Bildschirmhöhe!)". Mit align-items:start blieb sie auf ihrer Eigenhöhe. */
  assert.ok(html.includes('.sreg-shell{display:grid;grid-template-columns:290px minmax(0,1fr);gap:16px;align-items:stretch}'),
    'Die linke Spalte wächst nicht mit der rechten mit');
  assert.ok(html.includes('.sreg-left{border:1px solid var(--line);border-radius:9px;background:#fff;overflow:hidden;'),
    'Die linke Spalte ist kein Flex-Behälter mehr - dann füllt die Liste den Rest nicht');
  /* Zweimal nachgezogen: 270px liessen 85px Bildschirm ungenutzt, 195px liessen 17px
     Überschuss - die Seite rollte dann um genau diese 17px. Mit 220px rollt nur noch
     INNERHALB der beiden Spalten. Der Wert steht an zwei Stellen (links und rechts) und wird
     im Prüfstein „beide Spalten sind gleich lang" auf Gleichheit geprüft. */
  assert.ok(html.includes('max-height:calc(90vh - 220px);min-height:min(360px,calc(90vh - 220px))'),
    'Die Deckelung an der Bildschirmhöhe stimmt nicht mehr');
});

test('Datenadministration: Knopfreihen stehen in Spalten', () => {
  /* Nutzerwunsch 28.08.: „Buttons sollten ordentlich gelayoutet und passend untereinander sein."
     Die Reihe war ein umbrechendes Flex mit dem Label als erstem Kind - die zweite Zeile begann
     deshalb unter dem LABEL statt unter dem ersten Knopf (Export der Büroorganisation: „CSV-Satz"
     stand 92 px weiter links als „Excel" darüber). Am Prüfstand nachgemessen: jetzt tragen alle
     Knöpfe des Bereichs dieselbe Breite (210 px) und es gibt nur noch zwei Spaltenkanten. */
  assert.ok(html.includes('.da-row{position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,210px));'),
    'Die Knopfreihe ist kein Spaltenraster mehr');
  assert.ok(html.includes('.da-row:has(>.da-row-label){padding-left:78px}'),
    'Die Rinne für das Kurz-Label fehlt - dann steht der Text auf den Knöpfen');
  assert.ok(html.includes('.da-row>.da-row-label{position:absolute;left:0;top:0;width:72px;height:28px;'),
    'Das Label zählt wieder als Rasterfeld und verschiebt die Spalten');
  /* Ohne stretch stehen ein einzeiliger und ein zweizeiliger Knopf nebeneinander verschieden hoch. */
  assert.ok(html.includes('gap:8px;align-items:stretch;margin:9px 0 0;justify-content:start}'),
    'Knöpfe einer Zeile sind nicht mehr gleich hoch');
  /* Der Fließtext läuft über die ganze Reihe und setzt oben an. */
  assert.ok(html.includes('.da-row>.da-note-inline{grid-column:1/-1;align-self:start}'),
    'Der Hinweistext sitzt wieder in einer Rasterspalte');
  /* 1fr hätte einen einzelnen Knopf auf 442 px aufgeblasen - deshalb die Obergrenze. */
  assert.ok(!html.includes('.da-row .btn{margin:0;min-width:210px'),
    'Die alte feste Mindestbreite ist zurück und sprengt die Spalten');
});

test('Standard-Ausgangskonto wird unter der Kontenliste gezeichnet', () => {
  /* Entscheidung 28.08.: direkt unter „E-Mail-Konten (Postfach)" - man sieht seine Konten und
     entscheidet darunter, welches vorausgewählt wird. Als Katalogzeile behält es dabei seine
     Vorgabespalte (Büro/Rolle/Person). */
  assert.ok(html.includes('<div id="einAusgangskontoWirt" class="card" style="margin-bottom:12px"></div>'),
    'Der Wirt fehlt');
  assert.ok(html.includes("const akKat=EIN_KAT_MAP['versand.standardkonto'];"), 'Die Zeile wird nicht geholt');
  assert.ok(html.includes("if(ak&&akKat){ak.innerHTML=einZeileHTML(akKat);einSeiteVerdrahten(ak);"),
    'Die Zeile wird nicht verdrahtet - Auswahl und Vorgabe hingen in der Luft');
  /* Der Wirt sitzt HINTER der Kontenliste, nicht davor. */
  const konten = html.indexOf('<div id="mxMailAccountsHost">');
  const wirt = html.indexOf('<div id="einAusgangskontoWirt" class="card" style="margin-bottom:12px"></div>');
  assert.ok(konten > 0 && wirt > konten, 'Der Wirt steht vor der Kontenliste');
  /* Wer kein Mail-Recht hat, bekommt den eingebetteten Baustein nicht - die eigene Wahl
     trotzdem. Zwei Zweige, die einander ausschließen, gleiche Kennung. */
  assert.equal((html.match(/id="einAusgangskontoWirt"/g) || []).length, 2,
    'Der Zweig ohne Mail-Recht hat keinen eigenen Wirt (oder es sind zu viele)');
});

test('Kalender: drei Abschnitte in der Reihenfolge, in der man arbeitet', () => {
  /* Nutzerentscheidung 28.08. nach Mockup-Vergleich. Vorher stand die büroweite Vorgabe ZWISCHEN
     der Überschrift „Verbindungen verwalten" und den Verbindungen - also über dem, wovon sie
     abhängt: bei einem frischen Büro vier leere Auswahlfelder über einer leeren Liste. */
  const pos = (t) => { const i = html.indexOf(t); assert.ok(i > 0, `fehlt: ${t}`); return i; };
  const eins = pos('<div class="cal-abschnitt">1 · Verbindungen</div>');
  const liste = pos('<div id="calConnList">');
  const anbieter = pos('<div class="cal-anbieter">');
  const zwei = pos("2 · Voreinstellungen");
  assert.ok(eins < liste && liste < anbieter && anbieter < zwei,
    'Verbindungen, Anbieter und Voreinstellungen stehen nicht in dieser Reihenfolge');
  /* Der Feed steht vor der Ablage, das Protokoll zuletzt. */
  const feed = pos("${_pers?'':feedTokenCardHTML()}");
  const ablage = pos('${kontaktAblage}');
  assert.ok(feed < ablage, 'Die Kontakt-Import-Ablage steht vor dem Aufgaben-Feed');
  /* Die alte Zwischenüberschrift führte nicht zu den Verbindungen. */
  assert.ok(!html.includes('<h4 class="set-abschnitt2">Verbindungen verwalten</h4>'),
    'Die irreführende Zwischenüberschrift ist zurück');
});

test('Kalender: die Verbindung ist eine Karte, „Entfernen" steht abgesetzt', () => {
  /* Die Zeile trug sieben Bedienelemente dreier Arten nebeneinander - „Neu verbinden" direkt
     neben dem roten „Entfernen". Jetzt drei Bänder: wer/Zustand, WAS abgeglichen wird, Schalter
     und Aktionen. Am Prüfstand gemessen: Trenner 1×38 px zwischen „Testen" und „Entfernen". */
  assert.ok(html.includes('<div class="cal-vschalter">${schalter}</div>'), 'Die Schalter haben kein eigenes Band');
  assert.ok(html.includes('<div class="cal-vaktionen conn-actions-row">${aktionen}</div>'), 'Die Aktionen haben kein eigenes Band');
  assert.ok(html.includes('<span class="cal-trenner"></span>'), 'Der Trenner vor „Entfernen" fehlt');
  /* Die Chips zeigen nur, was der Anbieter wirklich kann - erfunden wird nichts. */
  assert.ok(html.includes("const kannKontakte=canDiscover&&!isTaskApi&&!isVikunjaDav;"),
    'Kontakte werden auch bei Aufgaben-Anbietern angeboten');
  assert.ok(html.includes("teile.push(chip('Aufgaben',selCount?`${selCount} aktiv`:'keine',"),
    'Aufgaben-Anbieter bekommen keinen eigenen Chip');
  /* Kein Rückfall in die alte Zeile. */
  assert.ok(!html.includes('<div class="button-row conn-actions-row" style="margin:0">${actions}</div>'),
    'Die alte gedrängte Verbindungszeile ist zurück');
});

test('Kalender: Anbieter gruppiert, Kartentitel eine Ebene unter dem Seitentitel', () => {
  /* Sieben Knöpfe nebeneinander, zwei davon dasselbe Produkt - jetzt zwei benannte Gruppen. */
  assert.ok(html.includes('<div class="cal-agruppe">Kalender &amp; Kontakte</div>'), 'Die Gruppe Kalender fehlt');
  assert.ok(html.includes('<div class="cal-agruppe">Aufgaben</div>'), 'Die Gruppe Aufgaben fehlt');
  /* „Aufgaben-Feed" und „Sync-Protokoll" waren H3 wie der Seitentitel; gemessen standen die
     Kartentitel in DREI Größen nebeneinander (18 / 15,8 / 14,5 px). Jetzt alle als H4. */
  assert.equal((html.match(/<h4 class="cal-kartentitel">/g) || []).length, 5,
    'Nicht alle fünf Kartentitel stehen eine Ebene tiefer');
  assert.ok(!html.includes('<h3 style="margin-top:0">Sync-Protokoll</h3>'), 'Das Sync-Protokoll ist wieder H3');
  assert.ok(!html.includes('<h3 style="margin-top:0">Aufgaben-Feed (CalDAV)</h3>'), 'Der Aufgaben-Feed ist wieder H3');
  /* Der Seitentitel stand wortgleich noch einmal als Kartentitel darunter. */
  assert.ok(html.includes("+(darfVerbindungen?'<div id=\"einKalAdm\" class=\"set-einbett\"></div>':'<div id=\"einKalKarte\"></div>')"),
    'Die doppelte Einleitungskarte wird wieder unbedingt gezeichnet');
});

test('Versandwege: die Export-Karten sind online abgeschaltet – lokal bleiben sie', () => {
  /* Zweiter Anlauf, diesmal mit Nutzerfreigabe nach Gegenprobe. Der erste Anlauf am 28.08. war
     falsch: Verloren gingen damals nicht nur doppelte Schalter, sondern die BEISPIELE und die
     Detailansicht - und der Katalogzeile fehlte die fünfte Möglichkeit ganz.
     WER DAS WIEDER ANFASST: Die Abschaltung ist NUR zulässig, solange die Katalogzeile alles
     trägt. Genau das prüfen die Zusicherungen unten Punkt für Punkt - sie sind die Bedingung,
     unter der diese Löschung erlaubt ist, kein Beiwerk. */
  assert.ok(html.includes("const exportKarten = wirt ? `<div class=\"set-wegweiser\">"),
    'Die Export-Karten sind wieder bedingungslos da (oder der Wegweiser fehlt)');
  assert.ok(html.includes("</div>` : `<div class=\"export-options-card\">"),
    'Der Lokal-Zweig fehlt - dort ist dieser Dialog die EINZIGE Stelle für Dateiname und Speicherort');
  assert.ok(html.includes(">dorthin &rarr;</button>") && html.includes("window.__einSpringe('dateinamen')"),
    'Der Wegweiser führt nicht zu „Dateinamen & Betreff"');

  /* BEDINGUNG 1 - Dateiname: drei Möglichkeiten und ein Beispiel, das beide Muster zeigt. */
  assert.ok(html.includes("werte:[['spaces','Mit Leerzeichen'],['underscore','Unterstriche statt Leerzeichen']]"),
    'Die Zeile „Dateiname" hat Möglichkeiten verloren');
  assert.ok(html.includes("const anders=window.__fileNameStyleExample(stil==='underscore'?'spaces':'underscore');"),
    'Das Vergleichsbeispiel ist weg - genau das konnte die alte Karte');

  /* BEDINGUNG 2 - Speicherort: FÜNF Möglichkeiten (Vorgabe folgen + vier), inkl. „parallel". */
  assert.ok(html.includes("{key:'dateinamen.downloadZiel',bereich:'dateinamen',name:'Download-Ziel',typ:'wahlklapp',"),
    'Die Zeile „Download-Ziel" ist keine Klappzeile mehr');
  ['downloads', 'ask', 'parallel', 'intern'].forEach(w => {
    assert.ok(new RegExp("\\['" + w + "','").test(html),
      `Die Möglichkeit „${w}" fehlt in der Katalogzeile - dann darf die alte Karte nicht weg`);
  });

  /* BEDINGUNG 3 - der zweite Schalter und beide Browser-Hinweise stecken im Zusatz. */
  assert.ok(html.includes("onchange=\"window.__setInternalExportFolderPrompt(!this.checked)\">'"),
    'Das Ankreuzfeld „Nur externer Download" fehlt in der Katalogzeile');
  assert.ok(html.includes('funktioniert in jedem Browser – die Datei geht direkt zum Server'),
    'Der grüne Browser-Hinweis fehlt in der Katalogzeile');
  assert.ok(html.includes('Dieser Browser öffnet keinen Speichern-Dialog aus der App.'),
    'Die Safari/Firefox-Anleitung fehlt in der Katalogzeile');

  /* BEDINGUNG 4 - Rechte: „Dateinamen & Betreff" trägt KEIN Gate, ist also für jeden Online-
     Nutzer sichtbar. Die alten Karten hingen an menuSettingsSendAccounts; ihr Publikum ist damit
     eine echte Teilmenge, und niemand verliert eine Einstellung. */
  assert.ok(html.includes("{id:'dateinamen',name:'Dateinamen & Betreff',lokal:true,datei:true},"),
    'Die Navigation für „Dateinamen & Betreff" hat ein Rechte-Gate bekommen - dann verlieren Nutzer die Einstellung');

  /* Was NICHT betroffen ist: die Büro-Vorgabe im Admin-Panel (erscheint über beiden Zweigen,
     auch lokal) und das Standard-Ausgangskonto (steht bei den Mail-Konten). */
  assert.ok(html.includes("const fnVorgabeCard=(typeof window.__fileNameStyleAdminCardHTML==='function')"),
    'Die Büro-Vorgabe-Karten sind mit abgeschaltet worden');
  assert.ok(html.includes("{id:'versand',name:'Versandwege',lokal:true,datei:true}"), 'Der Bereich heißt nicht mehr Versandwege');
  assert.ok(html.includes("einSeiteBereich('versand','Versandwege'"), 'Die Seitenüberschrift passt nicht zum Namen');
  assert.ok(html.includes("{key:'versand.standardkonto',bereich:'mail'"),
    'Das Ausgangskonto ist versehentlich mit zurückgewandert');
});

test('Eingebettete Fußzeilen kleben nicht über dem Inhalt', () => {
  /* Gemeldet 28.08.: Auf „Versandwege" verdeckte die Speichern-Leiste den eBO.connect-Kasten.
     Ursache: `#modal:has(.doc-info-actions) .doc-info-actions{position:sticky}` - .doc-info-actions
     ist die allgemeine Klasse für klebende Fußzeilen (fünf Dialoge tragen sie). In einem
     eigenständigen Dialog ist das richtig, EINGEBETTET sitzt sie mitten auf einer langen Seite
     und alles darunter verschwindet dahinter. Fünfte Ausprägung derselben Bauart. */
  assert.ok(html.includes('#modal .set-einbett .doc-info-actions{position:static'),
    'Eingebettete Fußzeilen kleben wieder');
  /* Die Regel für eigenständige Dialoge bleibt - dort ist die Leiste der untere Rand. */
  assert.ok(html.includes('#modal:has(.doc-info-actions) .doc-info-actions{position:sticky;bottom:0'),
    'Die Sticky-Regel für eigenständige Dialoge wurde mitentfernt');
});

test('Dateinamen & Betreff trägt die Vorlagen je Dokumentart', () => {
  /* Die zweite Hälfte dessen, was beim Verkleinern verlorenging: die rund 100 Muster je
     Dokumentart. Am Prüfstand gezählt: 202 Felder (eigene + büroweite Vorgabe). */
  assert.ok(html.includes("+'<div id=\"einFnVorlagen\"></div>';"), 'Der Wirt für die Vorlagen fehlt');
  assert.ok(html.includes("window.__exportNameDetailsHTML('user')"), 'Die eigenen Muster fehlen');
  assert.ok(html.includes("window.__exportNameDetailsHTML('office')"), 'Die büroweite Vorgabe fehlt');
  /* Die büroweite Fassung nur für Vorgabeberechtigte. */
  assert.ok(html.includes("+(einDarfVorgaben()?window.__exportNameDetailsHTML('office'):'')"),
    'Jede Person könnte die Büro-Vorgabe ändern');
  /* Zugeklappt - sonst erschlagen 101 Felder je Bereich die Seite. */
  assert.ok(html.includes('<details class="fntpl-panel" data-fntpl-details><summary>'),
    'Die Detailansicht ist nicht mehr zugeklappt');
  assert.ok(html.includes('.fntpl-panel[open]>summary::before'), 'Der Klappblock hat keine Optik');
  /* 28.08. nachgebessert: Hier lag ein <details> UM den <details> des Bausteins - zwei
     Aufklapper ineinander, und „Vorlagen je Dokumentart" stand dreimal auf einer Seite. */
  assert.ok(!html.includes('<details class="set-klapp">'), 'Die zweite Klappebene ist zurück');
  assert.ok(html.includes("var titel=(scope==='office')?'Büro-Vorgabe je Dokumentart':'Eigene Muster je Dokumentart';"),
    'Der Aufklapp-Titel sagt nicht mehr, wessen Muster darin stehen');
});

test('Vorlagen-Panel: gegliedert statt Textwand, ohne feste Farben', () => {
  /* Gemeldet 28.08.: „Optimiere diese Ansichten! … weit entfernt von der hübschen Variante unter
     Versand." Drei konkrete Mängel: (1) Hinweis, Bausteinliste und drei Regeln standen in EINEM
     Absatz - dabei fehlte sogar das Leerzeichen zwischen „gespeichert." und „Bausteine";
     (2) 19 Bausteinwörter als fett-gepunkteter Fließtext mit „ · " dazwischen; (3) fest
     eingebaute Hellfarben, die den Dunkelmodus ignorierten. */
  assert.ok(!html.includes("+hint+''+'<span style=\"color:#8a97a1\">Bausteine"),
    'Hinweis und Bausteinliste kleben wieder aneinander');
  assert.ok(html.includes('<p class="fntpl-hint">'), 'Der Hinweis steht nicht mehr für sich');
  assert.ok(html.includes('<ul class="fntpl-regeln">'), 'Die drei Regeln stehen wieder im Fließtext');
  /* Bausteine nach Bedeutung gruppiert - vorher musste man 19 Wörter durchlesen. */
  assert.ok(html.includes("gruppe('Datum und Zeit',['JJMMTT','UHRZEIT'"), 'Die Bausteine sind nicht mehr gruppiert');
  assert.ok(html.includes("gruppe('Nur bei manchen Dateitypen',"), 'Die bedingten Bausteine sind nicht abgesetzt');
  assert.ok(!html.includes(".map(tokChip).join(' · ')"), 'Die Bausteine stehen wieder als Fließtext');
  /* Keine festen Farben mehr in den Zeilen - der Baustein erscheint in drei Wirten. */
  assert.ok(html.includes('<div class="fntpl-zeile">'), 'Die Zeilen tragen wieder Inline-Stile');
  assert.ok(!html.includes('border-bottom:1px solid #edf1f5'), 'Die feste Trennlinienfarbe ist zurück');
  assert.ok(html.includes('.fntpl-zeile input{flex:1;min-width:240px;border:1px solid var(--line)'),
    'Die Eingabefelder folgen nicht den Farbvariablen');
});

test('Klapp-Zeile: Bedienelement wie überall, Nachschlagen daneben', () => {
  /* Dritter Anlauf (28.08., nach Entwurfsvergleich). Erst nur ein Auswahlfeld - da fehlten die
     Erklärungen der übrigen Möglichkeiten. Dann Optionskarten mit Radios - 601 px Zeilenhöhe und
     ein Fremdkörper in der Design-Sprache („Ne, so geht es ja gar nicht!"). Jetzt: 34-px-Feld in
     .set-feld wie in jeder Nachbarzeile, darunter eine graue Erklärzeile, daneben ein stiller
     Auslöser für die Nachschlage-Liste. */
  assert.ok(html.includes("if(kat.typ==='wahlklapp'){"), 'Der Klapp-Typ fehlt');
  assert.ok(!html.includes("wahlkarten"), 'Die Optionskarten sind zurück');
  assert.ok(!html.includes('.set-optionen{display:grid'), 'Das Optionsraster ist zurück');
  /* EIN Schreibweg: Die Klappe ist reiner Lesestoff (<dl>), gesetzt wird über data-ein-eigene.
     einEigeneSetzen leitet beide Schlüssel bereits an die richtigen öffentlichen Setter. */
  assert.ok(html.includes("klappe='<details class=\"set-klappe\" data-ein-klappe=\"'"),
    'Die Nachschlage-Klappe fehlt');
  assert.ok(html.includes("<dl class=\"set-optliste\">"), 'Die Klappe ist keine reine Leseliste mehr');
  assert.ok(!html.includes('data-ein-karte'), 'Der zweite Schreibweg ist zurück');
  assert.match(html, /if\(key==='dateinamen\.downloadZiel'\)return window\.__setDownloadTarget/,
    'Der Normalweg schreibt nicht mehr über __setDownloadTarget');
  /* Die Klappe wird aus DERSELBEN Liste erzeugt wie die <option> - kein zweiter Textbestand. */
  assert.ok(html.includes('+werte.map(w=>eintrag(w[0],w[1],txt(w))).join('),
    'Die Klappe hat einen eigenen Textbestand bekommen');
});

test('Klapp-Zustand überlebt das Neuzeichnen', () => {
  /* einInhaltRender() baut den Inhalt als Zeichenkette neu auf. Eine im DOM gemerkte Klappe wäre
     danach zu - genau dann, wenn man aus der offenen Klappe heraus etwas gewählt hat. */
  assert.ok(html.includes('const EIN_KLAPPEN_OFFEN=new Set();'), 'Der Zustand lebt wieder im DOM');
  assert.ok(html.includes("EIN_KLAPPEN_OFFEN.has(kat.key)?' open':''"), 'Der Zustand wird nicht zurückgeschrieben');
  /* 'toggle' steigt nicht auf - der Lauscher muss in der Einfangphase hängen. */
  assert.ok(html.includes("},true);"), 'Der Lauscher hängt nicht in der Einfangphase');
  /* Der Prüfstand führt den Block ohne echtes document aus - ohne Wächter reißt der Modulkopf ab. */
  assert.ok(html.includes("if(typeof document!=='undefined'&&typeof document.addEventListener==='function'){"),
    'Die Anmeldung ist nicht gegen eine schlanke Umgebung abgesichert');
});

test('Download-Ziel behält alle fünf Möglichkeiten und beide Hinweise', () => {
  /* „parallel" ist kein eigener Speicherwert, sondern 'ask' PLUS die Ordner-Nachfrage im
     internen Speicher - der Zustand wird aus beiden Quellen zusammengesetzt. */
  assert.ok(html.includes("['parallel','Externer Download und interner Dokumentenspeicher'"),
    'Die fünfte Möglichkeit fehlt');
  assert.ok(html.includes("return (v==='ask'&&parallel)?'parallel':v;"),
    'Der Zustand „parallel" wird nicht aus beiden Quellen zusammengesetzt');
  assert.ok(html.includes('window.__setInternalExportFolderPrompt(!this.checked)'),
    'Der Schalter „Nur externer Download" fehlt');
  /* Die grüne Zeile sagt in Safari etwas ANDERES als in Chrome - sie darf nicht zusammengelegt
     werden. Beide Zweige müssen ihren eigenen Satz behalten. */
  assert.ok(html.includes('Ihr Browser unterstützt den Speichern-Dialog aus der App.'),
    'Die grüne Zeile für Chrome/Edge fehlt');
  assert.ok(html.includes('funktioniert in jedem Browser – die Datei geht direkt zum Server'),
    'Die grüne Zeile für Safari/Firefox fehlt - sie sagt etwas anderes als die für Chrome');
  assert.ok(html.includes('<details class="set-notiz warn set-warnklappe">'),
    'Der lange Browser-Hinweis steht nicht mehr hinter einer eigenen Klappe');
});

test('Signalfarben kommen aus den vorhandenen Variablen', () => {
  /* Die Anwendung definiert --ok und --warn bereits für hell UND dunkel. Meine erste Fassung
     legte dieselben Werte als Hexzahlen daneben, plus einen doppelten Dunkelmodus-Regelsatz -
     drei Wahrheiten für eine Farbe. */
  assert.ok(html.includes('.set-notiz.gut{color:var(--ok)}'), 'Grün kommt nicht aus --ok');
  assert.ok(html.includes('.set-notiz.warn{color:var(--warn)}'), 'Gelb kommt nicht aus --warn');
  assert.ok(!html.includes('.set-notiz.gut{color:#237a3b}'), 'Der feste Hellwert ist zurück');
  assert.ok(!html.includes(':root[data-theme="dark"] .set-notiz.gut'),
    'Der doppelte Dunkelmodus-Regelsatz ist zurück');
});

test('Der neue Feldtyp ist beiden Beschriftungs-Helfern bekannt', () => {
  /* Am Prüfstand aufgefallen: einWertLabel und einWertControl verzweigen auf kat.typ. Für den
     neuen 'wahlklapp' fiel beides durch - im Feld stand „Vorgabe folgen (ask)" statt des
     Klartexts, und die Vorgabespalte fiel auf die KONTO-Auswahl zurück („– Konto wählen –").
     Beide Helfer behandeln 'wahlklapp' jetzt wie 'wahl'; die Werteliste ist dieselbe. */
  assert.equal((html.match(/kat\.typ==='wahl'\|\|kat\.typ==='wahlklapp'/g) || []).length, 2,
    'Nicht beide Helfer kennen den Klapp-Typ');
  /* einControlWert braucht nichts: es liefert für alles außer Schalter und Zeit el.value. */
  assert.ok(html.includes("if(kat.typ==='zeit')return /^\\d{2}:\\d{2}$/.test(el.value||'')?el.value:'09:00';\n  return el.value;"),
    'Der Wertleser liefert für Auswahlfelder nicht mehr el.value');
});

test('Erklärzeile und Auslöser bleiben beieinander', () => {
  /* Gemessen bei 1500 px: Die Erklärzeile hatte flex:1 und dehnte sich über die ganze, dort
     785 px breite linke Spalte - der Auslöser „Alle 5 Möglichkeiten" trieb dadurch ans rechte
     Ende, rund 350 px vom Text entfernt, zu dem er gehört. Jetzt 12 px Abstand. */
  assert.ok(html.includes('.set-unterzeile>.set-beispiel{flex:0 1 auto;margin:0}'),
    'Die Erklärzeile dehnt sich wieder und schiebt den Auslöser weg');
  assert.ok(html.includes('.set-unterzeile{justify-content:flex-start}'),
    'Die Unterzeile drückt ihre Teile nicht mehr nach links');
  /* „sonst" und das zweite Muster gehören zusammen - sonst bricht die Zeile dazwischen um. */
  assert.ok(html.includes('.set-alt{opacity:.75;white-space:nowrap}'),
    'Das Alternativmuster bricht wieder vom Wort „sonst" ab');
});

test('Vorgabe-Box: Stand immer sichtbar, Felder auf Verlangen', () => {
  /* Gemessen bei 1500 px: Die Box war IMMER 220 px hoch und diktierte damit die Höhe fast jeder
     Zeile im ganzen Menü - links blieben 114-156 px tote Fläche („Besser aber immer noch nicht
     optimal gelayoutet!"). Jetzt 64 px im Ruhezustand; die Zeilen fallen auf 146/110/110 px,
     der tote Raum auf 14 px. Die Felder braucht man selten, den Stand oft. */
  assert.ok(html.includes('<div class="set-steuer set-vbox">'), 'Die Box trägt die neue Klasse nicht');
  assert.ok(html.includes('.set-steuer.set-vbox{display:flex'), 'Der Ruhezustand ist nicht mehr flach');
  assert.ok(html.includes('<details class="set-vklappe" data-ein-vklappe="'), 'Die Felder klappen nicht mehr');
  /* .set-steuer MUSS die äußere Klasse bleiben: daran hängt sel.closest('.set-steuer'), über das
     der Rollen-Hinweis gefunden wird. closest() liefert null statt eines Fehlers - der Hinweis
     stürbe also wortlos. */
  assert.ok(html.includes("sel.closest('.set-steuer')"), 'Der Rollen-Hinweis findet seinen Kasten nicht mehr');
  /* Der Stand steht AUSSERHALB der Klappe, sonst schaltet ein Klick aufs Löschkreuz sie um. */
  const stand = html.indexOf('<div class="set-vstand">');
  const klappe = html.indexOf('<details class="set-vklappe"');
  assert.ok(stand > 0 && klappe > stand, 'Die Marken stecken in der Klappe');
});

test('Der Stilblock der Box steht vor den Stufenfarben', () => {
  /* .set-vchip{border:1px solid var(--line)} und .set-m-buero{border-color:…} haben dieselbe
     Spezifität - die spätere Regel gewinnt. Stünde der Block hinter .set-marke, wären alle drei
     Stufen farblos. Am Prüfstand gegengeprüft: die Marke trägt rgb(227,207,164) = Büro. */
  const vchip = html.indexOf('.set-vchip{display:inline-flex');
  const marke = html.indexOf('.set-marke{');
  assert.ok(vchip > 0 && marke > 0, 'Eine der beiden Regeln fehlt');
  assert.ok(vchip < marke, 'Der Stilblock steht hinter .set-marke - die Stufenfarben gehen verloren');
  /* NUR Platzierung, keine Farbe: Das Löschkreuz behält --bad. Es ist das einzige zerstörende
     Bedienelement der Box und darf im Ruhezustand nicht neutral aussehen. */
  assert.ok(!/\.set-vchip>\.set-vz-weg\{[^}]*color:/.test(html),
    'Die Marke überschreibt die Warnfarbe des Löschkreuzes');
});

test('Klappzustand, Gedächtnis und Fokus überleben das Neuzeichnen', () => {
  /* einInhaltRender() baut alles neu. Gleiches Muster wie EIN_KLAPPEN_OFFEN - und derselbe
     Lauscher, nicht ein zweiter. */
  assert.ok(html.includes('const EIN_VORGABE_OFFEN=new Set();'), 'Der Klappzustand lebt wieder im DOM');
  assert.ok(html.includes("if(d.dataset.einVklappe){"), 'Die Boxen hängen nicht am vorhandenen Lauscher');
  /* Beide Kunden hängen an DEMSELBEN Lauscher - geprüft über die Reihenfolge, nicht über die
     Gesamtzahl: Die Seitenleiste bringt einen eigenen toggle-Lauscher mit (sie scrollt
     aufgeklappte Menüs ins Bild), der hiermit nichts zu tun hat. */
  const iKlappe = html.indexOf('if(d.dataset.einKlappe){');
  const iVklappe = html.indexOf('if(d.dataset.einVklappe){');
  assert.ok(iKlappe > 0 && iVklappe > iKlappe, 'Die Vorgabe-Boxen hängen nicht hinter der Klappen-Prüfung');
  assert.ok(!html.slice(iKlappe, iVklappe).includes("addEventListener('toggle'"),
    'Zwischen beiden liegt ein zweiter toggle-Lauscher statt einer Erweiterung');
  /* EIN_VLETZTE NUR im Erfolgszweig: an einem change-Lauscher hätte schon das Durchblättern
     eines Auswahlfelds jede andere Zeile des Menüs vorbelegt. */
  assert.ok(html.includes('EIN_VLETZTE={stufe:stufe,'), 'Das Gedächtnis für die nächste Zeile fehlt');
  assert.ok(!/addEventListener\('change'[^)]*EIN_VLETZTE/.test(html),
    'Das Gedächtnis hängt an einem change-Lauscher - schon Blättern würde vorbelegen');
  /* Der Generationsstempel: einSeiteVerdrahten läuft je Neuzeichnen bis zu ZWEIMAL. Ohne ihn
     liefe der Fokuswunsch bei den später gebauten Zeilen ins Leere. */
  assert.ok(html.includes('let EIN_FOKUS_ID=\'\',EIN_FOKUS_GEN=-1;'), 'Der Fokuswunsch fehlt');
  assert.ok(html.includes('else if(einGeneration>EIN_FOKUS_GEN+1)EIN_FOKUS_ID=\'\';'),
    'Der Fokuswunsch verfällt beim ersten Lauf und trifft die späten Zeilen nie');
});

test('Fremde Nutzer der Box bleiben unversehrt', () => {
  /* .set-steuer und .set-steuer-titel werden von zwei weiteren Bausteinen benutzt; .set-vneu
     von der Rollen-Seite. Ein zu weit gefasster Umbau hätte dort wortlos Schaden angerichtet. */
  assert.ok(html.includes('.set-steuer-titel{'), 'Die Titeltypografie wurde gelöscht');
  assert.ok(html.includes('.set-vneu{display:flex;flex-direction:column'), 'Die Formularspalte wurde umgebaut');
  /* Die Knopfregel ist auf die Box begrenzt - sonst schrumpfte „Rolle anlegen" mit. */
  assert.ok(html.includes('.set-vbox .set-vfuss .btn{'), 'Die Knopfregel greift zu weit');
  assert.ok(!html.includes('.set-vneu .btn{'), 'Die Knopfregel trifft auch die Rollen-Seite');
});

test('Feinschliff: der Zwingend-Hinweis erklärt das Formular und steht darin', () => {
  /* Gemessen: Der Satz „Wirkt nur zwingend …" stand AUSSERHALB der Klappe, war damit immer
     sichtbar und kostete 33 px - er war allein dafür verantwortlich, dass die drei
     Darstellungs-Zeilen 46 px toten Raum links hatten. Er erklärt aber das Formular („warum
     ist das Häkchen fest angehakt?"). Nach dem Umzug: Zeile 136 -> 105, toter Raum 46 -> 14. */
  const note = html.indexOf("Wirkt nur zwingend – jede Person hat hier stets eine eigene Wahl.");
  const zu = html.indexOf("+'</div></details>'", note);
  assert.ok(note > 0 && zu > note, 'Der Zwingend-Hinweis steht wieder außerhalb der Klappe');
});

test('Feinschliff: der lange Nachsatz des Schalters klappt weg', () => {
  /* Der Block „Nur externer Download" kostete 73 px; 38 davon waren zwei Nachsätze zu einem
     Sonderfall. Der erste Satz - WAS der Schalter tut - bleibt sichtbar: ein unerklärtes
     Ankreuzfeld wäre schlimmer als eine Zeile mehr. Download-Ziel: 263 -> 227 px. */
  assert.ok(html.includes('Die Datei wird nicht zusätzlich im internen Dokumentenspeicher abgelegt.'),
    'Der erklärende erste Satz des Schalters fehlt');
  assert.ok(html.includes('<details class="set-nachsatz"><summary>Was heißt das genau?</summary>'),
    'Der Nachsatz steht nicht mehr hinter einer Klappe');
  assert.ok(html.includes('Der Ordner-Picker des internen Speichers erscheint dann nicht.'),
    'Der Nachsatz-Inhalt ist verlorengegangen');
  /* Inline, damit die Klappe im Fließtext sitzt und keine eigene Zeile beansprucht. */
  assert.ok(html.includes('.set-nachsatz{display:inline}'), 'Die Nachsatz-Klappe bricht eine eigene Zeile auf');
});

test('Vorschlagslisten: beide Spalten sind gleich lang', () => {
  /* Gemeldet 28.08.: „die beiden listen sind immer noch nicht gleich lang!" Gemessen war links
     615 px (gedeckelt) und rechts 3158 px - die rechte Spalte lief 2500 px über den Bildschirm
     hinaus, und beim Scrollen verschwand die linke Liste ganz. Jetzt tragen BEIDE dieselbe
     Deckelung und rollen innen; am Prüfstand: 590/590 px, gleiche Unterkante, Seite rollt um 0. */
  assert.ok(html.includes('.sreg-panel{border:1px solid var(--line);border-radius:9px;background:#fff;padding:12px;min-width:0;'),
    'Die rechte Spalte ist kein Flex-Behälter mehr');
  assert.equal((html.match(/max-height:calc\(90vh - 220px\);min-height:min\(360px,calc\(90vh - 220px\)\)/g) || []).length, 2,
    'Die beiden Spalten tragen nicht dieselbe Deckelung');
  assert.ok(html.includes('#sregGroups{flex:1 1 auto;min-height:0;overflow:auto;'),
    'Die Einträge rollen nicht mehr innerhalb ihrer Spalte');
  /* Der Kopf der rechten Spalte (Titel, Sortierung, Speichern) darf NICHT mitrollen - sonst
     ist der Speichern-Knopf beim Arbeiten unerreichbar. Er steht außerhalb von #sregGroups. */
  const kopf = html.indexOf('class="sreg-head"');
  const gruppen = html.indexOf('<div id="sregGroups">');
  assert.ok(kopf > 0 && gruppen > kopf, 'Der Kopf der rechten Spalte ist in den Roller gerutscht');
  /* Schmales Fenster: untereinander gestellt braucht die rechte Spalte keine Deckelung -
     sonst rollte man in einem Roller in einem Roller. */
  assert.ok(html.includes('.sreg-panel{max-height:none;min-height:0;display:block}'),
    'Auf schmalen Fenstern bleibt die Deckelung stehen');
  /* Das Telefon-Profil gibt beide Roller frei. */
  assert.ok(html.includes('    .sreg-panel,\n'), 'Die rechte Spalte fehlt in der Telefon-Freigabe');
});

test('Vorschlagslisten füllen die Höhe exakt, ohne Fensterrechnung', () => {
  /* Gemeldet 28.08.: „der große Weißraum kann doch verringert werden unten". Die feste Zahl in
     calc(90vh - …) war dreimal daneben - 270 px ließen 85 px ungenutzt, 195 px erzeugten 17 px
     Überschuss, 220 px wieder Weißraum. Am Prüfstand fanden sich zwei Gründe:
       1. Der Dialog ist nicht 90vh hoch, sondern 95vh (855 px bei 900 px Fenster).
       2. Kopfzeile, Seitentitel und Fußzeile skalieren nicht mit - jede Konstante ist deshalb
          an einer anderen Fenstergröße falsch.
     Jetzt über Prozenthöhe. Gemessen bei 1100×700, 1500×900 und 1800×1100: beide Spalten exakt
     gleich, jeweils 2 px bis zur Kante, Seite rollt um 0. */
  assert.ok(html.includes('.set-inhalt:has(.sreg-shell)>.set-einbett{height:calc(100% - 52px);min-height:0}'),
    'Der Rahmen füllt die Höhe nicht mehr über Prozent');
  assert.ok(html.includes('.set-inhalt:has(.sreg-shell) .sreg-shell{height:100%;min-height:0}'),
    'Das Raster füllt den Rahmen nicht aus');
  /* 52 = Seitenüberschrift 44 + der 8-px-Rand darüber. Beide gemessen, beide
     fensterunabhängig - das ist der Unterschied zur alten vh-Rechnung. */
  assert.ok(html.includes('/* 52px = Seitenueberschrift 44 + der 8px-Rand darueber'),
    'Die Herkunft der Zahl ist nicht mehr dokumentiert');
  /* Ein Flex-Füllen des Inhaltsbereichs ist NICHT möglich: eine bestehende Schutzregel setzt
     dort display:block !important, um das Menü gegen fremde Modul-CSS abzuschirmen. */
  assert.ok(html.includes('#modal #modalBody > .set-app > .set-inhalt'),
    'Die Schutzregel des Inhaltsbereichs wurde entfernt');
  assert.ok(!html.includes('.set-inhalt:has(.sreg-shell){display:flex'),
    'Es wird wieder gegen die Schutzregel angekämpft');
  /* Nur ab 901 px - darunter stehen die Spalten untereinander. */
  const block = html.indexOf('@media(min-width:901px){\n  /* 52px');
  assert.ok(block > 0, 'Das Füllen gilt nicht mehr nur für breite Fenster');
});

test('Vorschlagslisten: der Kopf der rechten Spalte verschwendet keine Zeile', () => {
  /* Gemeldet 28.08.: „Oben in der rechten Liste wird recht viel Platz durch das schlechte
     Layout verschwendet." Zwei Ursachen, beide behoben - Kopf 125 -> 87 px, Liste 497 -> 535. */

  /* (1) REGRESSION VON MIR: Beim Austausch eines CSS-Blocks blieb eine schließende Klammer zu
     viel stehen. Ein verirrtes } verschluckt im CSS-Parser die NÄCHSTE Regel komplett - hier
     .sreg-head. Ohne sie fiel das Raster weg und die Knöpfe rutschten unter den Titel, statt
     danebenzustehen. Am Prüfstand über die CSSOM gefunden: die Grundregel existierte im
     Browser gar nicht, nur .sreg-head h4 und die Mobil-Fassung. */
  assert.ok(html.includes('.sreg-head{display:grid;grid-template-columns:minmax(0,1fr) auto;'),
    'Die Grundregel der Kopfzeile fehlt - Titel und Knöpfe stehen wieder untereinander');

  /* (2) Hinweis und Klapp-Links teilen sich eine Reihe statt zwei. */
  assert.ok(html.includes('<div class="sreg-text-actions"><span class="sreg-note">Ausgeblendete Standardwerte'),
    'Der Hinweis steht wieder als eigener Block über den Links');
  assert.ok(html.includes('.sreg-note{font-size:12px;color:#526879;margin:0}'),
    'Der Hinweis bringt seine alten Blockränder zurück');
  assert.ok(html.includes('.sreg-text-actions>.sreg-note{flex:1 1 200px;min-width:0}'),
    'Der Hinweis darf in der Reihe nicht mehr schrumpfen');
});

test('Der Stilblock der Vorschlagslisten hat ausgewogene Klammern', () => {
  /* Dieser Prüfstein hätte die Regression oben sofort gefangen: Eine überzählige schließende
     Klammer bricht im CSS keine Datei - sie verschluckt lautlos die nächste Regel. Der Bau
     lief weiter, die Blockzahl stimmte, die Suite war grün, und nur die Ansicht war kaputt. */
  const m = html.match(/<style id="suggestion-registry-style-v1">([\s\S]*?)<\/style>/);
  assert.ok(m, 'Der Stilblock der Vorschlagslisten wurde umbenannt oder entfernt');
  const ohneKommentare = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const auf = (ohneKommentare.match(/\{/g) || []).length;
  const zu = (ohneKommentare.match(/\}/g) || []).length;
  assert.equal(auf, zu, `Klammern im Stilblock unausgewogen: ${auf} auf, ${zu} zu - eine überzählige } verschluckt die nächste Regel`);
});

test('Falldaten: die Aktionsknöpfe stehen in jeder Zeile untereinander', () => {
  /* Gemeldet 28.08. („Behebe die Bugs in der GUI!", Bildschirmfoto der Falldaten-Tabelle):
     Die aktive Zeile trug „Schließen" als .btn.secondary, jede andere Zeile „Öffnen" als
     .btn.light. Am Prüfstand gemessen 87 px gegen 70 px - dadurch standen Umbenennen /
     Archivieren / Löschen der aktiven Zeile 17 px weiter rechts als in allen Zeilen darüber
     und darunter, und der gefüllte dunkle Knopf zog den Blick auf die falsche Stelle. */
  assert.ok(!html.includes('<button type="button" class="btn secondary" onclick="window.__onlineCaseSync.close()">Schließen</button>'),
    'Die aktive Zeile trägt wieder eine andere Knopfklasse als alle übrigen Zeilen');
  /* Die Datenadministration trägt seit dem 29.08. zusätzlich die Klasse da-akt-haupt (feste
     Breite neben dem Menüknopf). Entscheidend bleibt: Öffnen und Schließen tragen DIESELBE
     Knopfklasse - daran hing die ursprüngliche Schieflage.
     2 -> 1 seit Schritt 2b (29.08. abends): das Menü „Fälle" hat keine eigene Tabelle mehr,
     es zeigt die geteilte Falldaten-Karte - die Knöpfe existieren im Markup nur noch EINMAL. */
  assert.equal((html.match(/class="btn light( da-akt-haupt)?" title="Diesen Fall schließen"/g) || []).length, 1,
    'Schließen muss genau einmal existieren (geteilte Karte) und dieselbe Klasse wie Öffnen tragen');
  assert.equal((html.match(/class="btn light( da-akt-haupt)?" title="Diesen Fall öffnen"/g) || []).length, 1,
    'Öffnen trägt nicht mehr dieselbe Klasse wie Schließen');

  /* Die Ausrichtung hängt nicht mehr an der Beschriftungslänge: eine Tabellenspalte ist in
     jeder Zeile gleich breit, und das Raster teilt sie in gleich breite Spuren. Beide Zutaten
     sind nötig - siehe der Kommentar an der Regel; mit 1fr allein blieben die Knöpfe
     70/88/79/61 px, mit minmax(0,1fr) allein schrumpfte die Spalte auf 58 px. */
  assert.ok(html.includes('.data-admin-view .bu-table .da-akt-row{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:5px;width:max-content}'),
    'Das Raster der Aktionszelle fehlt oder hat eine der beiden nötigen Zutaten verloren');
  /* Zwei Aktionszellen seit Schritt 2b: die Falldaten-Karte (mit Menüknopf, deshalb
     Zusatzklasse da-akt-kurz) und die Archiv-Karte - die Sidebar-Menüs zeigen dieselben
     Karten, keine eigenen Tabellen mehr. Beide bauen die Zelle als Raster - daran hängt,
     dass die Knöpfe über alle Zeilen dieselbe Kante halten. */
  assert.equal((html.match(/<div class="da-akt-row( da-akt-kurz)?">/g) || []).length, 2,
    'Nicht alle Falllisten bauen die Aktionszelle als Raster');
  assert.ok(html.includes('<div class="da-akt-row da-akt-kurz">'),
    'Die Datenadministration nutzt nicht mehr die schmale Aktionszelle mit Menü');
});

test('Falldaten: die Aktionsspalte bleibt bei schmalem Fenster erreichbar', () => {
  /* Die Tabelle ist rund 1090 px breit; im Einstellungsmenü blieben bei einem 1120-px-Fenster
     nur 728 px für sie übrig (am Prüfstand gemessen). Die komplette Aktionsspalte lag also
     außerhalb - Öffnen/Umbenennen/Archivieren/Löschen waren ohne Querscrollen gar nicht zu
     erreichen, und nichts wies darauf hin. Sie klebt jetzt am rechten Rand fest. */
  assert.ok(html.includes('.data-admin-view .bu-table :is(th,td).da-akt{position:sticky;right:0;background:#fff}'),
    'Die Aktionsspalte klebt nicht mehr rechts fest');
  /* 3 -> 2 seit Schritt 2b: die Fälle-Tabelle des Sidebar-Menüs ist in der geteilten Karte
     aufgegangen; übrig sind Falldaten- und Archiv-Kopfzeile. */
  assert.equal((html.match(/<th class="da-akt"/g) || []).length, 2,
    'Die Kopfzelle der Aktionsspalte trägt die Klasse nicht (ohne sie klebt nur der Körper)');
  assert.ok(html.includes('.data-admin-view .bu-table th.da-akt{top:0;background:#dceaf4;z-index:3}'),
    'Die Kopfzelle der Aktionsspalte braucht top:0 UND right:0 samt eigener Ebene');

  /* Eine klebende Zelle malt ihren eigenen Hintergrund; der Zeilenhintergrund liegt darunter.
     Mit dem alten Inline-style am <tr> wäre die Aktionsspalte als weißer Block in der grünen
     Zeile stehen geblieben - deshalb färbt jetzt eine Klasse die ZELLEN. */
  assert.ok(!html.includes("' style=\"background:#e6f3e9\"'"),
    'Die aktive Fallzeile wird wieder per Inline-style am <tr> gefärbt');
  assert.ok(html.includes('.data-admin-view .bu-table tr.da-fall-aktiv>td:not(.da-akt){background:#e6f3e9}'),
    'Die Markierung der aktiven Zeile fehlt');
  assert.ok(html.includes('html[data-theme="dark"] #modal:has(.data-admin-view,.bu-table) .bu-table tr.da-fall-aktiv>td:not(.da-akt){background:#1d3b2c!important}'),
    'Im Dunkelmodus überschreibt die td-Regel die Markierung mit !important - die Gegenregel fehlt');
});

test('Datenadministration: gefüllte und umrandete Knöpfe sind gleich hoch', () => {
  /* min-height war 0. Ein gefüllter .btn hat keinen Rahmen und war damit 26 px hoch, ein
     .btn.light daneben durch seinen 1-px-Rahmen 28 px. Innerhalb EINER Reihe fiel das nicht
     auf (align-items:stretch gleicht sie an), wohl aber zwischen der Import- und der
     Export-Spalte derselben Karte - dort standen 26 px neben 28 px. */
  assert.ok(html.includes('.data-admin-view .da-row .btn,.data-admin-view .da-row .folder-zip-menu>summary{padding:6px 11px!important;font-size:12px;font-weight:600;height:auto!important;min-height:28px!important}'),
    'Die Untergrenze der Knopfhöhe fehlt - gefüllte Knöpfe sind wieder 2 px flacher');
});

test('Falldaten: die Auswahlfelder für Betreuer und Vertretung schneiden nicht mehr ab', () => {
  /* Im Bildschirmfoto vom 28.08. standen in beiden Spalten abgeschnittene Felder:
     „— nicht zugewiese" bzw. „— keine Vertretur", der Auswahlpfeil war ganz aus dem Bild
     geschoben - die Felder sahen aus wie kaputte Textfelder. Die Spalten sind rund 118 px
     breit, der alte Text braucht deutlich mehr. */
  assert.ok(!html.includes('<option value="">— nicht zugewiesen —</option>'),
    'Die überlange Leerzeile ist wieder da und wird in der Spalte abgeschnitten');
  assert.ok(!html.includes(".replace('— nicht zugewiesen —','— keine Vertretung —')"),
    'Die überlange Leerzeile der Vertretungsspalte ist wieder da');
  assert.ok(html.includes("return '<option value=\"\">— ohne —</option>'"),
    'Die kurze Leerzeile fehlt');
  /* Der volle Wortlaut darf nicht verloren gehen - er steht als Titel am Feld. */
  assert.ok(html.includes("s.title='Rechtlicher Betreuer dieses Falls – „ohne“ bedeutet: noch nicht zugewiesen'"),
    'Ohne Titel am Feld ist nach der Kürzung nicht mehr erkennbar, was „ohne" bedeutet');
  assert.ok(html.includes("s.title='Vertretung bei Abwesenheit – „ohne“ bedeutet: keine Vertretung hinterlegt'"),
    'Der Vertretungsspalte fehlt der erklärende Titel');
  /* Die Felder trugen 12px Schrift in einer 11px-Tabelle. */
  assert.equal((html.match(/style="max-width:170px;min-width:118px;font-size:11px;padding:3px 5px"/g) || []).length, 2,
    'Betreuer- und Vertretungsfeld müssen die Schriftgröße der Tabelle tragen');
});

test('Falldaten: die Markierung des aktiven Falls endet an der Aktionsspalte', () => {
  /* Nutzerfund 28.08. („Aktueller Fall ragt immer noch in die buttons rein!"): Die Markierung
     färbte ALLE Zellen der Zeile - am Prüfstand gemessen stand auch die Aktionszelle auf
     rgb(230,243,233). Zwischen und um die vier Knöpfe (5 px Lücke, 5 px Innenabstand) schien
     das Grün durch; die Knopfreihe der aktiven Zeile sah dadurch anders aus als in jeder
     anderen Zeile. Die festklebende Aktionsspalte ist eine Werkzeugspalte und bleibt in JEDER
     Zeile neutral - erkennbar bleibt der aktive Fall an der grünen Zeile davor, am „· aktiv"
     hinter dem Namen und an der Plakette in der Kartenkopfzeile. */
  assert.ok(!/tr\.da-fall-aktiv>td\{background/.test(html),
    'Die Markierung färbt wieder ALLE Zellen - das Grün läuft dann unter den Knöpfen durch');
  assert.ok(html.includes('.data-admin-view .bu-table tr.da-fall-aktiv>td:not(.da-akt){background:#e6f3e9}'),
    'Die Ausnahme für die Aktionsspalte fehlt im Hellmodus');
  assert.ok(!/\.bu-table tr\.da-fall-aktiv>td\{background:#1d3b2c/.test(html),
    'Die Ausnahme für die Aktionsspalte fehlt im Dunkelmodus');

  /* Damit die neutrale Spalte als eigene Spalte lesbar bleibt, trägt sie eine Trennkante.
     Sie steckt bewusst im box-shadow und NICHT in einem border: die Tabelle läuft mit
     border-collapse:collapse, dort malt die TABELLE die Rahmen - eine klebende Zelle, die sich
     verschiebt, ließe ihren Rahmen zurück (in Safari sichtbar). Ein inset-Schatten gehört der
     Zelle und wandert mit. */
  assert.ok(html.includes('.data-admin-view .bu-table :is(th,td).da-akt::after{content:\'\';position:absolute;top:0;bottom:0;'),
    'Die Trennkante der Aktionsspalte fehlt');
});

test('Standard-Ausgangskonto: eigene Karte statt rahmenlosem Block zwischen Karten', () => {
  /* Nutzerfund 28.08. („Der Bereich Standard-Ausgangskonto (E-Mail) ist schlecht gelayoutet"):
     Die Zeile ist die EINZIGE Katalogzeile der Mail-Seite und stand ohne Rahmen zwischen lauter
     Karten - am Prüfstand gemessen klebten Titel und Hilfetext am Seitenrand, das 200px breite
     Auswahlfeld stand in einer 890px breiten Spalte, und die Vorgabe-Box schwebte rechts daneben
     ohne Bezugsfläche. Beide Wirte (mit und ohne Mail-Recht) tragen jetzt dieselbe .card wie die
     Nachbarblöcke. */
  assert.ok(html.includes('<div id="einAusgangskontoWirt" class="card" style="margin-bottom:12px"></div>'),
    'Der Wirt im Mail-Baustein hat seine Karte verloren');
  assert.ok(html.includes(`+'<div id="einAusgangskontoWirt" class="card" style="margin-top:14px"></div>');`),
    'Der Wirt im Zweig ohne Mail-Recht hat seine Karte verloren');
  assert.ok(!/id="einAusgangskontoWirt"(?!\s+class="card")/.test(html),
    'Es gibt wieder einen Wirt ohne Karte');

  /* Ohne diese Regel stünde eine leere weiße Karte da, wo den Wirt niemand füllt - gezeichnet
     wird die Zeile ausschließlich vom Einstellungsmenü, den Mail-Baustein rendern aber auch der
     Admin-Reiter und der eigenständige Einstieg. Am Prüfstand geprüft: geleert -> display:none,
     Höhe 0; wieder gefüllt -> display:block, Höhe 157. */
  assert.ok(html.includes('#einAusgangskontoWirt.card:empty{display:none}'),
    'Die Schutzregel gegen die leere Karte fehlt');
  assert.ok(html.includes('#einAusgangskontoWirt.card>.set-zeile{padding:0;border-bottom:0}'),
    'Die Zeile bringt ihren eigenen Innenabstand zusätzlich zur Karte mit');
  assert.ok(html.includes('#einAusgangskontoWirt.card .set-name{font-size:15.8px;color:var(--blue);margin-bottom:2px}'),
    'Der Titel steht nicht im Format der Nachbar-Kartenüberschriften');
  assert.ok(html.includes('#einAusgangskontoWirt.card .set-feld select{min-width:320px}'),
    'Das Auswahlfeld steht wieder auf der 200px-Untergrenze der Katalogzeilen');

  /* Im Zweig ohne Mail-Recht stand über der Zeile eine Zwischenüberschrift „Standard-
     Ausgangskonto" - direkt darüber demselben Titel, den die Zeile selbst trägt. */
  assert.ok(!html.includes('<h4 class="set-abschnitt2">Standard-Ausgangskonto</h4>'),
    'Der Titel steht wieder doppelt: Zwischenüberschrift und Zeilenname direkt untereinander');
});

test('Datenadministration: das Kurz-Label läuft nicht mehr auf den ersten Knopf', () => {
  /* Im adversarialen Durchgang vom 28.08. gefunden, am Prüfstand nachgemessen: Das Label stand
     auf white-space:nowrap in einer 70px breiten Rinne. „AKTIVER FALL" ist 81,6px breit und lief
     damit 11,6px WEIT AUF den Knopf „Backup" — sichtbar, sobald ein Fall geöffnet ist, also genau
     in dem Zustand, den der Nutzer vor sich hatte. „SICHERUNG" (67,7px) ließ 2,3px Luft.
     Jetzt: 72px Kasten in einer 78px-Rinne, Umbruch erlaubt. Gemessen bei 1000/1120/1990px —
     „Aktiver Fall" bricht auf zwei Zeilen (49,8 + 28,4), engster Abstand 10,3px bei „SICHERUNG",
     kein Überlauf mehr, und die Knöpfe bleiben 210px breit (es geht keine Spalte verloren). */
  assert.ok(!/\.da-row>\.da-row-label\{[^}]*white-space:nowrap/.test(html),
    'Das Label steht wieder auf nowrap und läuft aus seiner Rinne heraus');
  assert.ok(html.includes('.da-row>.da-row-label{position:absolute;left:0;top:0;width:72px;height:28px;\n  display:flex;align-items:center;white-space:normal;line-height:1.15;'),
    'Der umbruchfähige Label-Kasten fehlt');
  assert.ok(html.includes('.da-row:has(>.da-row-label){padding-left:78px}'),
    'Die Rinne passt nicht mehr zur Kastenbreite - 72px Kasten + 6px Luft = 78px');
});

test('Falldaten: die Trennkante der Aktionsspalte liegt AUF dem Rahmen, nicht daneben', () => {
  /* Dritter Anlauf (29.08., Nutzerfund „doppelte Linie im rechten Bereich"): Die Kante war ein
     inset-box-shadow und lag NEBEN dem collapsed-Rahmen der Tabelle - im ungescrollten
     Normalzustand zwei Linien plus Schattenband. Jetzt ein ::after auf left:-1px, also exakt AUF
     der Rahmenposition: deckungsgleich im Stand, wandert mit, wenn die Spalte schwebt.
     Die Lehren der Vorrunden bleiben gepinnt: */
  assert.ok(html.includes(".da-akt::after{content:'';position:absolute;top:0;bottom:0;\n  left:-1px;width:1px;background:#aebbc5}"),
    'Die ::after-Trennlinie fehlt oder sitzt nicht mehr auf der Rahmenposition');
  /* (1) Kein box-shadow mehr an der Zelle - der inset lag neben dem Rahmen (Doppellinie), ein
     äußerer würde bei border-collapse gar nicht gemalt (Farbprobe 28.08.). */
  const regel = (html.match(/\.data-admin-view \.bu-table :is\(th,td\)\.da-akt\{[^}]*\}/) || [])[0] || '';
  assert.ok(regel, 'Die Regel der klebenden Aktionsspalte fehlt');
  assert.ok(!/box-shadow/.test(regel),
    'Ein box-shadow ist zurück an der Zelle - der lag neben dem Rahmen und ergab die Doppellinie');
  /* (2) Ein border wäre weiterhin falsch: bei border-collapse malt die TABELLE die Rahmen, eine
     verschobene Zelle ließe ihren zurück. */
  assert.ok(!/\.da-akt\{[^}]*border-left/.test(html),
    'Die Trennkante wurde auf einen border umgestellt - der bleibt beim Kleben zurück');
  /* (3) Dunkelmodus: die helle Linie braucht dort die dunkle Rahmenfarbe. */
  assert.ok(html.includes('.bu-table .da-akt::after{background:var(--cfdm-line)}'),
    'Die Trennlinie bleibt im Dunkelmodus hell und steht als Naht in der Tabelle');
});

test('Mail-Einstellungen: der Benachrichtigungs-Hinweis führt hin, statt nur zu zeigen', () => {
  /* Entscheidung 28.08.: weder löschen noch mit Schaltern füllen. Löschen verstößt gegen die
     Regel, dass eine fehlende Steuerungsmöglichkeit AN DER STELLE erklärt werden muss - es gibt
     mit „Neue E-Mail" (benachrichtigung.mail) sehr wohl eine mail-eigene Benachrichtigung, die
     man zuerst hier sucht. Schalter an dieser Stelle wären eine Falle: sie stünden über der
     Fußzeile „Speichern", und __mxP.save() schickt die Benachrichtigungswerte bewusst NICHT mit.
     Also: ein Verweis, der hinführt. */
  assert.ok(!html.includes('Wobei sich die Anwendung meldet und wann, steht unter'),
    'Der Hinweis ist wieder eine Sackgasse aus Fließtext');
  assert.ok(!html.includes('<h4 style="margin:0 0 3px;color:var(--blue);font-size:13.5px">Benachrichtigungen</h4>'),
    'Die Überschrift ist zurück - sie ließ den Verweis wie einen Formularteil aussehen');
  assert.ok(html.includes("+'<button type=\"button\" class=\"mx-btn\" onclick=\"window.__mxP.zuBenachrichtigungen()\">Zu den Benachrichtigungen →</button>'"),
    'Der Sprungknopf fehlt');

  /* Der Knopf NUR online. Diese Karte wird auch im Lokal-Modus gezeichnet: der Seitenleisten-
     Eintrag „Mail-Einstellungen" hängt nur an Rechten, nicht am Modus („in beiden Modi sichtbar"),
     und openMailSettingsOnly leitet dort nicht um. Das einheitliche Menü gibt es aber nur online -
     openEinstellungenApp steigt lokal mit einer Meldung aus, bevor es etwas zeichnet. Ein Knopf,
     der nur eine Meldung erzeugt, wäre genau die Sackgasse, gegen die dieser Verweis gebaut wurde.
     Am Prüfstand in beiden Modi gegengeprüft: online Satz + Knopf, lokal nur der Satz. */
  /* 30.08. Demo-Vollausbau: __wieOnline() = online ODER Vorführung. Der Bereich
     „Benachrichtigungen" ist seit der Angleichung auch in der Vorführung sichtbar, der
     Sprungknopf führt dort also hin. Im ECHTEN Lokal-/Datei-Betrieb bleibt es beim Satz
     ohne Knopf - dort ist __wieOnline() false, das geprüfte Verhalten also unverändert. */
  assert.ok(html.includes("+(window.__wieOnline()"),
    'Der Verweis unterscheidet die Modi nicht mehr - lokal führt der Knopf nur zu einer Meldung');
  assert.ok(html.includes('stellen Sie im Online-Modus unter „Benachrichtigungen" ein.</span>')
         && html.includes(":'<span>Ob und wann sich die Anwendung meldet"),
    'Der Lokal-Zweig fehlt oder verspricht einen Bereich, den es dort nicht gibt');
  assert.ok(html.includes('<strong>Neue E-Mail</strong>'),
    'Der Verweis nennt nicht mehr, was dort für Mail zu holen ist');

  /* Die Zeile gehört NICHT ins Formular: sie steht hinter der Speichern-Fußzeile. */
  const foot = html.indexOf('<div class="mx-card-foot"><span class="mx-hint">Speichert die Felder dieser Karte');
  const verweis = html.indexOf("+'<div class=\"mx-verweis\">'");
  assert.ok(foot > 0 && verweis > foot,
    'Der Verweis steht wieder VOR der Speichern-Fußzeile und sieht damit aus, als würde er mitgespeichert');

  /* Zwei Wege, weil die Mail-Karte auch außerhalb eines offenen Menüs gerendert werden kann. */
  assert.ok(html.includes("if(document.querySelector('.set-app')&&window.__einSpringe)window.__einSpringe('benachrichtigung');"),
    'Der Sprung im offenen Menü fehlt');
  assert.ok(html.includes("else if(window.openEinstellungenApp)window.openEinstellungenApp('benachrichtigung');"),
    'Der Weg für den Fall, dass das Menü noch nicht offen ist, fehlt');
  assert.ok(html.includes("{id:'benachrichtigung',name:'Benachrichtigungen'}"),
    'Der Bereichsschlüssel heißt anders - der Sprung liefe ins Leere');

  /* Als reine Fließtextzeile in Muted-Grau war der Verweis zu unauffällig (Nutzerfund 28.08.).
     Jetzt getönte Fläche mit blauer Akzentkante, Glockensymbol und Text in --ink. Die Tönung ist
     die einzige Farbe ohne Token und braucht deshalb je Thema eine Angabe - ohne sie stünde die
     Fläche im Dunkelmodus auf #f2f8fd, also fast weiß mitten in der dunklen Karte. */
  assert.ok(html.includes('html[data-theme="dark"] :is(.mx-verweis,.set-wegweiser){background:#1b2f3d;border-color:#3c5b71;'),
    'Im Dunkelmodus fehlt die Tönung - die Verweisfläche leuchtet dann fast weiß');
  assert.ok(html.includes('<span class="mx-verweis-icon" aria-hidden="true">'),
    'Das Glockensymbol der Verweiszeile fehlt');
  /* Ohne die Ausnahme schlägt `.mx-verweis>span` (0,1,1) die Regel `.mx-verweis-icon` (0,1,0),
     das Symbol wird 298px breit und der Text bricht auf acht Zeilen (am Prüfstand gemessen). */
  assert.ok(html.includes('.mx-verweis>span:not(.mx-verweis-icon){flex:1 1 240px;min-width:0}'),
    'Die Ausnahme für das Symbol fehlt - es bläht sich auf die Textbreite auf');

  /* Und die Dublette darf nicht zurückkommen: was hier gespeichert wird, ist abschließend. */
  const speichern = html.slice(html.indexOf('const prefs={', html.indexOf('window.__mxP=')), html.indexOf("/api/mailbox/prefs"));
  assert.ok(!/notify|digest|tagesmeldung/i.test(speichern),
    'Die Mail-Karte speichert wieder Benachrichtigungswerte - genau die Dublette, die am 27.08. entfernt wurde');
});

test('Systemversand: Wegweiser sehen nicht mehr aus wie Eingabefelder', () => {
  /* Nutzerfund 28.08. („layoute die Schrift im Teil Einstellung des Büros besser"): Dort standen
     zwei <label>, die NICHTS beschrifteten - das erste ein <select hidden>, das zweite gar nichts.
     Zusammen mit dem echten Feld darunter sahen alle drei gleich aus (kleines graues Label plus
     Text), obwohl zwei davon reine Wegweiser ohne Bedienelement waren. */
  assert.ok(!html.includes('<label>Standard-Versandkonto (büroweit)</label>'),
    'Das Label ohne Bedienelement ist zurück');
  assert.ok(!html.includes('Standard-Ausgangskonto für neue E-Mails</label>'),
    'Das zweite Label ohne Bedienelement ist zurück');
  assert.ok(html.includes('<div class="set-wegweiser">'), 'Der Wegweiser-Block fehlt');
  /* Zwei Wegweiser tragen inzwischen eine Liste: dieser hier im Systemversand und der auf
     „Versandwege", der seit dem 28.08. abends die abgeschalteten Export-Karten ersetzt. */
  assert.equal((html.match(/<div class="set-wegweiser-liste">/g) || []).length, 2,
    'Ein Wegweiser hat seine Liste verloren (oder es ist einer dazugekommen)');
  assert.ok(html.includes('<b>Standard-Versandkonto (büroweit)</b>')
         && html.includes('<b>Standard-Ausgangskonto für neue E-Mails</b>'),
    'Dem Wegweiser im Systemversand fehlt einer seiner beiden Einträge');

  /* SACHFEHLER, der dabei mit aufgefallen ist: Der zweite Verweis schickte zu „Einstellungen →
     Versandwege". Dort steht das Standard-Ausgangskonto seit dem 28.08. nicht mehr - es ist eine
     Mail-Einstellung und sitzt auf derselben Seite, zwei Karten weiter oben. Der Text zeigte auf
     einen Ort, an dem nichts mehr zu finden war. */
  assert.ok(!html.includes('Legen Sie unter <strong>Einstellungen &rarr; Versandwege</strong> fest'),
    'Der Verweis zeigt wieder auf Versandwege - dort steht das Standard-Ausgangskonto nicht mehr');
  assert.ok(html.includes('steht in den Mail-Einstellungen unter „Standard-Ausgangskonto (E-Mail)"'),
    'Der Verweis nennt den heutigen Ort nicht');

  /* Das versteckte <select> muss bleiben: saveSmtpConfig und sendTestMail lesen es aus. */
  assert.ok(html.includes('<select id="adminSendAccount" hidden>'),
    'Das versteckte Auswahlfeld ist beim Umbau verloren gegangen - Speichern liest es aus');
  assert.equal((html.match(/getElementById\('adminSendAccount'\)/g) || []).length, 2,
    'Die Leser des versteckten Auswahlfeldes haben sich geändert');
});

test('Mail-Einstellungen: Speichern-Zeilen kleben nicht am Feld darüber', () => {
  /* Nutzerfund 29.08. (zweite Meldung): „der speichern button hat immer noch zu wenig abstand
     nach oben" - .button-row bringt global KEINEN margin-top mit (Zeile 32 der Basis-CSS),
     und in den drei Mail-/Versand-Karten folgt die Knopfzeile direkt auf Eingabefeld bzw.
     Signatur-Editor. Fix bewusst je Stelle (12px inline) statt global an .button-row:
     die Klasse steckt in Dutzenden Dialogen, dort regeln die Vorelemente den Abstand selbst. */
  assert.ok(html.includes('<div class="button-row" style="margin-top:12px" ${isAdminUser?\'\':\'hidden\'}>'),
    'Speichern/Testmail-Zeile im Systemversand hat den Abstand verloren');
  assert.ok(/style="margin-top:12px">\s*<button type="button" class="btn" onclick="window\.__adminPanel\.saveBueroSignatur\(\)"/.test(html),
    'Speichern-Zeile der Büro-Signatur hat den Abstand verloren');
  assert.ok(/style="margin-top:12px">\s*<button type="button" class="btn light" onclick="window\.__adminPanel\.revealSendPassword/.test(html),
    'Knopfzeile der Versand-Zugangsdaten hat den Abstand verloren');
});

test('Mail-Einstellungen: jede Karte sagt an derselben Stelle, für wen sie gilt', () => {
  /* Nutzerfund 29.08.: „In den Mail-Einstellungen bleibt total unklar, was nur für mich gilt."
     Die Reichweite stand an sieben Karten auf sieben Arten da - im Titel, als Zwischenüberschrift,
     als winzige Fußzeile neben „Speichern", als Marke je Zeile - und bei Eingangs-Regeln und
     E-Mail-Vorlagen überhaupt nicht. Jetzt trägt jede Karte dieselbe Marke neben ihrem Titel. */
  /* Sieben seit dem 29.08.: „E-Mail-Links im Adressbuch" ist aus der persönlichen Karte
     herausgezogen (sie ist BÜROWEIT gespeichert, siehe eigener Prüfstein unten). */
  const koepfe = html.match(/<div class="set-kartenkopf"><h3>[^<]+<\/h3>\$\{reich\(/g) || [];
  assert.equal(koepfe.length, 7,
    'Nicht alle sieben Karten des Mail-Bausteins tragen die Reichweiten-Marke');

  /* Die Zuordnung ist am Datenmodell geprüft, nicht geraten:
       Persönliche E-Mail-Einstellungen -> mailbox/prefs, nur eigenes Konto     -> ich
       Signatur des Büros               -> smtp_config, büroweit                -> buero
       E-Mail-Konten / Eingangs-Regeln / E-Mail-Vorlagen -> je Eintrag owner_user_id
                                           + visibility private|public          -> beide
       Systemversand                    -> „Was für Sie gilt" + „Einstellung des Büros" -> beide */
  assert.ok(html.includes("<h3>Persönliche E-Mail-Einstellungen</h3>${reich('ich')}"),
    'Die persönlichen Einstellungen sind nicht als „Nur für Sie" markiert');
  assert.ok(html.includes("<h3>Signatur des Büros</h3>${reich('buero')}"),
    'Die Büro-Signatur ist nicht als „Ganzes Büro" markiert');
  ['E-Mail-Konten (Postfach)', 'Eingangs-Regeln', 'E-Mail-Vorlagen'].forEach(t => {
    assert.ok(new RegExp('<h3>' + t.replace(/[()]/g, '\\$&') + "</h3>\\$\\{reich\\('beide'").test(html),
      `„${t}" ist nicht als gemischt markiert - dort ist jeder Eintrag privat ODER büroweit`);
  });

  /* Die Katalogzeile „Standard-Ausgangskonto" liegt zwischen denselben Karten und bekommt die
     Marke nachträglich angehängt - NICHT im generischen Zeilenbauer, der bedient jede Seite. */
  assert.ok(html.includes('nm.insertAdjacentHTML(\'beforeend\',\'<span class="set-reich set-reich-beide"'),
    'Die Zeile „Standard-Ausgangskonto" fällt aus der Reihe - ihr fehlt die Marke');

  /* Drei Werte, drei Farben, beide Themen. */
  ['ich', 'buero', 'beide'].forEach(a => {
    assert.ok(html.includes('.set-reich-' + a + '{'), `Die Marke „${a}" hat keinen Stil`);
    assert.ok(html.includes('html[data-theme="dark"] .set-reich-' + a + '{'),
      `Die Marke „${a}" leuchtet im Dunkelmodus in Hellfarben`);
  });

  /* Die Fußzeile sagte erst „Gilt nur für dich." (während die Seite siezt), dann „Gilt nur für
     Sie." - seit die Karte ihre Reichweite als Marke neben dem Titel trägt, war auch das nur eine
     zweite Ausgabe derselben Aussage, und zwar direkt neben „Speichern", wo sie sich wie eine
     Eigenschaft des Knopfes las (Nutzerrückfrage vom 29.08.: „was meint das?"). */
  assert.ok(!html.includes('Gilt nur für dich.'), 'Die Fußzeile duzt wieder, während die Seite siezt');
  assert.ok(!html.includes('<span class="mx-hint">Gilt nur für Sie.</span>'),
    'Die Fußzeile sagt wieder dasselbe wie die Marke am Kartentitel');
});

test('Verarbeitungs-Log: eine Überschrift, eine Knopfreihe, gleich hohe Felder', () => {
  /* Nutzerfund 29.08.: „Die doppelte Überschrift ist nicht notwendig" und „die Felder im oberen
     Bereich müssen alle gleich hoch sein" – nachgereicht: „Filter zurücksetzen, Audit-Log leeren
     und Exportieren (CSV) müssen in die gleiche Zeile wie die Filter-Felder". */

  /* (1) Im Menü trägt die Seite den Titel, im Admin-Bereich der Baustein - deshalb entscheidet
     der Wirt, nicht ein fest verdrahtetes Weglassen. */
  assert.ok(html.includes("const eingebettet=!!(body.closest&&body.closest('.set-einbett'));"),
    'Der Baustein unterscheidet nicht mehr, ob er eingebettet ist - dann steht der Titel doppelt');
  assert.ok(html.includes("audit:{unter:'Büroweites Protokoll jeder ändernden Aktion"),
    'Der Seitentitel wiederholt sich wieder selbst statt den Hauptsatz zu tragen');
  assert.ok(!html.includes("audit:{unter:'Das Verarbeitungs-Log des Büros.'"),
    'Die Wiederholung des Seitentitels ist zurück');

  /* (2) Eine Höhe für alle Bedienelemente der Filterzeile. Ohne sie ist ein <input type=date> in
     Safari sichtbar höher als ein <select> - am Prüfstand mit 34px für alle neun gegengemessen. */
  assert.ok(html.includes('.cf-filterzeile :is(input,select){height:34px;'),
    'Die einheitliche Feldhöhe der Filterzeile fehlt');
  assert.ok(html.includes('.cf-filterzeile .btn{height:34px;'),
    'Die Knöpfe der Filterzeile halten nicht dieselbe Höhe wie die Felder');
  assert.equal((html.match(/<label style="display:block;font-size:11px;font-weight:700;color:#35434e">/g) || []).length, 0,
    'Inline-Beschriftungen sind zurück - sie schlagen die gemeinsame Regel');

  /* (3) Alle drei Knöpfe in der Filterzeile, keine zweite Reihe darunter mehr. */
  const zeile = html.slice(html.indexOf('const filterLeiste='), html.indexOf('const kopfzeile='));
  ['exportAuditLog()', '__auditFilterLeeren()', 'clearAuditLog()'].forEach(fn => {
    assert.ok(zeile.includes(fn), `„${fn}" steht nicht mehr in der Filterzeile`);
  });
  assert.ok(!/<div class="button-row" style="margin-bottom:10px">\s*<button type="button" class="btn light" onclick="window\.__adminPanel\.exportAuditLog\(\)">/.test(html),
    'Die separate Knopfreihe unter den Filtern ist zurück');
});

test('Datenschutz: die Kopfdaten stehen in einem Formular, nicht in einer Streuung', () => {
  /* Nutzerfund 29.08. („Das sieht furchtbar aus!"): Die sieben Felder lagen in einem
     auto-fit-Raster - bei breitem Fenster vier bis fünf Spalten, darin ein einzeiliges Feld neben
     einem zweizeiligen, Erklärtexte von einer bis drei Zeilen, rechts unten eine große Leere. */
  assert.ok(html.includes('.ds-kopfraster{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 18px;max-width:1120px}'),
    'Das feste 3-Spalten-Raster der Kopfdaten fehlt');
  assert.ok(html.includes('<div class="ds-raster ds-kopfraster">'), 'Die Kopfdaten nutzen das Raster nicht');

  /* Die Reihenfolge IST das Layout: erst die drei Namen (einzeilig), dann die drei zugehörigen
     Anschriften (dreizeilig), zuletzt das Datum. Wer sie umsortiert, bricht die Reihen auf. */
  const reihenfolge = ['name', 'vertreter', 'dsb', 'anschrift', 'aufsichtsbehoerde', 'dsbKontakt', 'stand']
    .map(k => html.indexOf("('" + k + "',"));
  reihenfolge.forEach((i, n) => {
    assert.ok(i > 0, `Feld ${n + 1} der Kopfdaten fehlt`);
    if (n) assert.ok(i > reihenfolge[n - 1],
      'Die Reihenfolge der Kopfdaten stimmt nicht mehr - dann steht ein einzeiliges Feld neben einem dreizeiligen');
  });

  /* Der #modal-Anker ist Pflicht: `.modal-box ... textarea` setzt height:auto/min-height:64px und
     hat mit (0,2,1) die höhere Spezifität. Ohne ihn war die Regel wirkungslos (68,59px statt 76). */
  assert.ok(html.includes('#modal .ds-kopfraster textarea{height:76px;min-height:76px;resize:vertical}'),
    'Die gemeinsame Höhe der drei Textfelder fehlt oder verliert wieder gegen .modal-box textarea');
  assert.ok(html.includes('#modal .set-einbett :is(.ds-erklaerung,.ds-vorschlag){max-width:1120px'),
    'Erklärung und Vorschlag laufen wieder über die volle Fensterbreite, das Formular darunter nicht');
});

test('Mail-Karten: die Marke sitzt in der Kopfzeile, nicht im Beschreibungstext', () => {
  /* Nutzerfund 29.08. („Alle neuen Ellipsen sind schlecht platziert"): Die Beschreibung unter dem
     Titel trug ein inline `margin-top:-6px`, das früher den Standard-Unterrand einer <h3> ausglich.
     Seit Titel und Marke in einer Kopfzeile mit `h3{margin:0}` stecken, zog dasselbe -6px den Text
     IN die Kopfzeile: am Prüfstand begann der Absatz 3px OBERHALB der Titelunterkante und lief
     damit durch die Marke. Jetzt bringt die Kopfzeile ihren Abstand selbst mit (gemessen: 7,5px
     unter dem Titel, Marke exakt mittig zum Titel, 10px dahinter). */
  assert.ok(html.includes('.set-kartenkopf{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 7px}'),
    'Die Kopfzeile bringt ihren Abstand nicht mehr selbst mit (oder richtet die Marke wieder auf der Grundlinie aus)');
  const koepfe = html.match(/<div class="set-kartenkopf">[\s\S]{0,400}?<p style="font-size:12px;color:var\(--muted\);margin[^"]*"/g) || [];
  assert.equal(koepfe.length, 7, 'Nicht alle sieben Kartenköpfe wurden gefunden');
  koepfe.forEach(k => {
    assert.ok(!/margin(-top)?:\s*-/.test(k),
      'Ein Beschreibungsabsatz zieht sich wieder mit einem negativen Rand in die Kopfzeile hinein');
  });
});

test('Einstellungsmenü: die Navigationsleiste springt beim Seitenwechsel nicht mehr nach oben', () => {
  /* Nutzerfund 29.08.: „Wechsle ich auf einen anderen Menüpunkt, springt die linke Leiste wieder
     ganz nach oben." Ursache: einRender() baut die Leiste bei JEDEM Seitenwechsel komplett neu -
     damit ist ihre Scrollposition weg. Bei zwanzig Einträgen verliert man so bei jedem Klick
     seine Stelle. Der Rollstand lebt jetzt außerhalb der Funktion und überdauert den Neuaufbau.
     Am Prüfstand: Leiste auf 544 gerollt, unten einen Eintrag geklickt -> danach immer noch 544,
     der gewählte Eintrag sichtbar. */
  assert.ok(html.includes('let einNavRoll=0;'), 'Der Rollstand der Leiste wird nicht mehr gemerkt');
  assert.ok(html.includes('navEl.scrollTop=einNavRoll;'), 'Der gemerkte Rollstand wird nicht wiederhergestellt');
  assert.ok(html.includes("navEl.addEventListener('scroll',()=>{einNavRoll=navEl.scrollTop;},{passive:true});"),
    'Ohne Scroll-Horcher bleibt der gemerkte Wert auf dem Stand des letzten Neuaufbaus stehen');

  /* Zweiter Schritt: Nach dem Wiederherstellen kann der gewählte Eintrag trotzdem außerhalb
     liegen - etwa wenn der Sprung aus einem Querverweis kam (__einSpringe) statt aus einem Klick
     in der Leiste. Dann wird er mittig gestellt. Geprüft: Leiste oben, Sprung auf „Datenschutz"
     ganz unten -> Leiste rollt mit, Eintrag sichtbar; und umgekehrt. */
  assert.ok(html.includes('if(ab.top<nb.top+4||ab.bottom>nb.bottom-4)'),
    'Der gewählte Eintrag wird nicht mehr ins Bild geholt');
  assert.ok(html.includes('navEl.scrollTop+=(ab.top-nb.top)-(nb.height-ab.height)/2;'),
    'Der Eintrag wird nicht mehr mittig gestellt');
  /* Die Bedingung ist wichtig: ohne sie ruckelte die Leiste bei JEDEM Klick, auch wenn der
     Eintrag längst sichtbar war. */
  assert.ok(!/if\(aktiv\)\{\s*navEl\.scrollTop\+=/.test(html),
    'Es wird wieder bedingungslos gescrollt - dann ruckelt die Leiste bei jedem Klick');
});

test('E-Mail-Links im Adressbuch: eigene Karte, ehrlich beschriftet', () => {
  /* Nutzerfrage 29.08.: „zu welchem Bereich gehört dieser Speichern-Knopf?" Das Feld
     „E-Mail-Links aus Adressbuch/Kontakten öffnen" stand INNERHALB der Karte „Persönliche
     E-Mail-Einstellungen", direkt unter deren Speichern-Fußzeile - dabei speichert dieser Knopf
     das Feld gar nicht (es wird sofort übernommen), und die Karte behauptete mit „Nur für Sie"
     etwas Falsches: setMailAddressLinkMode schreibt nach office_json/ui_prefs, und
     getMailAddressLinkMode liest diesen büroweiten Wert ZUERST. */
  assert.ok(html.includes('<div class="set-kartenkopf"><h3>E-Mail-Links im Adressbuch</h3>${reich(\'buero\''),
    'Das Feld steckt wieder in einer fremden Karte oder trägt die falsche Reichweite');
  assert.ok(html.includes('Wird sofort übernommen – der Speichern-Knopf der Karte darüber gilt dafür nicht.'),
    'Der Hinweis auf die Sofort-Übernahme fehlt');
  /* Und der Speichern-Knopf der persönlichen Karte sagt jetzt, was er speichert. */
  assert.ok(html.includes('<span class="mx-hint">Speichert die Felder dieser Karte – von der Sendeverzögerung bis zur Signatur.</span>'),
    'Der Speichern-Knopf sagt nicht mehr, wofür er gilt');
  /* Das Verhalten selbst ist unverändert gepinnt: büroweiter Speicher zuerst. */
  assert.ok(html.includes("const p=window.__uiPrefs&&window.__uiPrefs.mailAddressLinkMode;"),
    'Der büroweite Lesepfad hat sich geändert - dann stimmt die Marke „Ganzes Büro" nicht mehr');
});

test('Fallliste-Zusammenführung Schritt 1: Zeitstempel, Archiv-Karte, eine Trennlinie', () => {
  /* Nutzerentscheidung 29.08.: Die Datenadministration wird die EINE Fallliste; „Fälle" und
     „Fallarchiv" sollen in Schritt 2 abgebaut werden (samt Schnellzugriffen). Schritt 1 holt
     die beiden Dinge herüber, die den getrennten Menüs voraus waren. */

  /* (1) „Zuletzt bearbeitet" - stand bisher nur im Menü „Fälle". Gleiche Quelle
     (stammdatenUpdatedByName/At), kompakt formatiert. */
  assert.ok(html.includes('<th title="Person und Zeitpunkt der letzten Stammdaten-Änderung">Zuletzt bearbeitet</th>'),
    'Die Spalte „Zuletzt bearbeitet" fehlt in der Datenadministration');
  assert.ok(html.includes('const daZuletzt=c=>{'),
    'Der kompakte Zeitstempel-Formatierer fehlt');
  assert.ok(html.includes('${daZuletzt(c)}'), 'Die Zeilen nutzen den Zeitstempel nicht');

  /* (2) Fallarchiv als eigene Karte, mit den bewussten Entscheidungen des alten Menüs:
     KEIN Öffnen aus dem Archiv (Zurückholen ist der einzige Weg), Löschen bleibt Admin-Sache.
     Die Karte steht auch bei leerem Archiv da - dann mit einem Satz statt leerer Tabelle. */
  assert.ok(html.includes('<div class="da-title">Fallarchiv</div>'),
    'Die Fallarchiv-Karte fehlt in der Datenadministration');
  /* Der Ausschnitt beginnt am Archiv-Symbol, NICHT mehr an `const archivierte=` - die Zeile
     steht seit der Mehrfachauswahl (29.08.) weiter oben, weil beide Auswahlsätze gegen die
     aktuellen Listen abgeglichen werden müssen. Vom alten Anker aus umfasste der Ausschnitt
     die ganze Falltabelle und der „kein Öffnen"-Test schlug fälschlich an. */
  const archivBlock = html.slice(html.indexOf('const archivIcon='),
    html.indexOf('const dataSections='));
  assert.ok(archivBlock.includes("window.__onlineCaseSync.unarchive("),
    'Das Archiv bietet kein Zurückholen an');
  assert.ok(!archivBlock.includes('__onlineCaseSync.open('),
    'Das Archiv bietet wieder Öffnen an - Zurückholen soll der einzige Weg bleiben');
  assert.ok(html.includes('const darfLoeschen=!!window.__currentUser?.isAdmin;')
    && archivBlock.includes('darfLoeschen?`<button type="button" class="btn danger"'),
    'Löschen im Archiv hängt nicht mehr am Admin');
  assert.ok(archivBlock.includes('Kein Fall archiviert.'),
    'Der Leerzustand der Archiv-Karte fehlt');
  assert.ok(html.includes('${caseFallKarteHTML(false)}${caseArchivKarteHTML(false)}${dataSections}'),
    'Die Archiv-Karte ist nicht zwischen Falldaten und Datensektionen eingehängt');
});

test('Falldaten: die Aktionsspalte ist ein Menü – die Tabelle passt wieder ins Fenster', () => {
  /* Nutzerfund 29.08.: „Die Tabelle muss nun horizontal gescrollt werden." Gemessen war es
     schlimmer: die rechts klebende Aktionsspalte (377px = 31% der Tabelle) lag im UNGESCROLLTEN
     Zustand über 105px der neuen Spalte „Zuletzt bearbeitet" - deren Text war abgeschnitten,
     obwohl er da war. Vier Textknöpfe für vier sehr verschiedene Häufigkeiten.
     Jetzt: die tägliche Aktion sichtbar, die drei Ausnahmen im Menü. Nachgemessen:
       Aktionsspalte 377 -> 138 px
       1500px-Fenster: Tabelle 1206/Wrap 1101 (105 Überhang) -> 1101/1101, kein Scrollen
       1400px-Fenster: 1004/1004, kein Scrollen (Grenze liegt bei ~1370px)
       1280px-Fenster: scrollt noch um 83px - dort greift die klebende linke Seite. */
  assert.ok(html.includes('<div class="da-akt-row da-akt-kurz">'),
    'Die Aktionszelle trägt wieder alle vier Knöpfe nebeneinander');
  assert.ok(html.includes('onclick="window.__caseAktionsmenue(this)"'),
    'Der Menüknopf fehlt');
  assert.ok(html.includes('.data-admin-view .bu-table .da-akt-row.da-akt-kurz{grid-template-columns:92px 30px;'),
    'Die feste Breite der Hauptaktion fehlt - Öffnen und Schließen fluchten dann nicht mehr');

  /* Das Menü hängt bewusst NICHT als <details> in der Zelle: die Tabelle steckt in einem
     Scroll-Container (overflow:auto, max-height 340px), der es an seiner Kante abschneiden
     würde - bei der letzten Zeile wäre es unbenutzbar. Deshalb position:fixed. */
  assert.ok(html.includes('menue.className=\'da-akt-menue\';'), 'Das Aktionsmenü fehlt');
  assert.ok(html.includes('.da-akt-menue{position:fixed;'),
    'Das Menü ist nicht mehr fixed - der Scroll-Container schneidet es dann ab');
  /* Verankert im Dialog: am <body> überlebt es dessen Schließen und schwebt allein auf der
     Seite (am Prüfstand gesehen). fixed verhält sich dort nachweislich wie am Viewport. */
  assert.ok(html.includes("(document.getElementById('modal')||document.body).appendChild(menue);"),
    'Das Menü hängt wieder am body und überlebt das Schließen des Dialogs');
  /* Ein fixed-Overlay MUSS sich schließen, sobald etwas scrollt - sonst schwebt es neben der
     Zeile, zu der es gehört. Am Prüfstand durchgespielt: Scroll, Escape, Klick daneben,
     zweiter Klick auf denselben Knopf. */
  ["window.addEventListener('scroll',zu,true);", "window.addEventListener('resize',zu,true);",
   "function taste(ev){if(ev.key==='Escape'){zu();knopf.focus()}}"].forEach(t => {
    assert.ok(html.includes(t), `Ein Schließweg des Menüs fehlt: ${t}`);
  });
  /* Die Werte gehen als data-Attribute mit und werden per addEventListener verdrahtet - ein
     Fallname in einer Zeichenkette in einem inline-Handler müsste durch zwei Maskierungsebenen. */
  assert.ok(html.includes('data-fall="${escAttr(c.id)}" data-label="${escAttr(c.label||\'\')}"'),
    'Die Menüwerte gehen nicht mehr als data-Attribute mit');
  assert.ok(html.includes("b.addEventListener('click',()=>{zu();fn()});"),
    'Die Menüeinträge werden wieder über Zeichenketten verdrahtet');

  /* Linke Seite kleben: Wenn die Tabelle bei schmalem Fenster doch scrollt, bleiben Auswahl und
     Name stehen - ohne den Namen verliert man die Zuordnung der Zeile. */
  assert.ok(html.includes('.data-admin-view .bu-table :is(th,td).da-wahl{position:sticky;left:0;'),
    'Die Auswahlspalte klebt nicht mehr links');
  assert.ok(html.includes('.data-admin-view .bu-table :is(th,td).da-name{position:sticky;left:32px;'),
    'Die Namensspalte klebt nicht mehr links');
  /* Ohne Auswahlspalte (kein Verwaltungsrecht) darf der Name nicht um 32px versetzt kleben. */
  assert.ok(html.includes('.data-admin-view .bu-table:not(:has(.da-wahl)) :is(th,td).da-name{left:0}'),
    'Ohne Auswahlspalte entsteht links eine 32px-Lücke');
  assert.ok(html.includes('.data-admin-view .bu-table :is(th,td).da-name::after{'),
    'Der Namensspalte fehlt die mitwandernde Trennkante');
});

test('Mehrfachauswahl: das Anhaken lässt die Einstellungs-Schale stehen', () => {
  /* Nutzerfund 29.08.2026: „Wenn ich die Mehrauswahl nutzen will, wird das Menü auf einmal
     kleiner." Ursache: Die drei Auswahl-Handler schrieben stur nach #modalBody. Solange die
     Falladministration ein eigenes Modal war, stimmte das - seit sie im Einstellungsmenü nur
     noch EIN eingebetteter Baustein ist, warf jeder Haken die komplette Schale samt linker
     Navigation weg. Am Prüfstand nachgestellt und nachgemessen:
       Dialogbreite 1455 -> 1080 px, .set-nav weg, .set-app weg,
       Betreuer-/Vertretungsspalten zurück auf „— lädt …".
     Der Fix zeichnet gar nicht mehr neu - das Kästchen schaltet der Browser selbst um, nachzu-
     ziehen sind nur die Sammelknöpfe. Damit bleibt auch der Scrollstand der Tabelle stehen. */
  const block = html.slice(html.indexOf('function caseWahlKnoepfeNachziehen()'),
    html.indexOf('window.__caseArchivBulkDelete='));
  assert.ok(block, 'Der Auswahl-Block fehlt');
  assert.ok(!block.includes("getElementById('modalBody')"),
    'Ein Auswahl-Handler greift wieder nach #modalBody - das wirft die Einstellungs-Schale weg');
  assert.ok(!block.includes('caseAdminModalHTML()'),
    'Ein Auswahl-Handler zeichnet die ganze Karte neu - das verwirft Scrollstand und Betreuerspalten');
  assert.ok(block.includes('caseWahlKnoepfeNachziehen()'),
    'Die Sammelknöpfe werden nach dem Anhaken nicht nachgezogen');

  /* Die Knöpfe tragen Zähler und Beschriftung als data-Attribute - daraus baut
     caseWahlKnoepfeNachziehen() die neue Aufschrift, ohne die Karte anzufassen. */
  assert.ok(html.includes('data-wahl-zaehler="fall" data-wahl-text="Ausgewählte archivieren"'),
    'Dem Archivieren-Knopf fehlt der punktuelle Zähler');
  assert.ok(html.includes('data-wahl-zaehler="archiv" data-wahl-text="Ausgewählte zurückholen"'),
    'Dem Zurückholen-Knopf fehlt der punktuelle Zähler');
  assert.ok(html.includes('data-wahl-fall="${escAttr(c.id)}"'), 'Den Kästchen der Fallliste fehlt das Zielattribut');
});

test('Mehrfachauswahl auch im Fallarchiv – mit eigenen Sammelaktionen', () => {
  /* Nutzerwunsch 29.08.2026: „Zudem braucht auch die Archivliste die Mehrfachauswahl!"
     Andere Aktionen als oben (zurückholen/löschen statt archivieren), deshalb ein EIGENER
     Auswahlsatz: die beiden Tabellen zeigen disjunkte Fälle. Am Prüfstand belegt - „Alle
     abwählen" in der Fallliste ließ die 3 Haken im Archiv unberührt. */
  assert.ok(html.includes('const caseArchivSelected=new Set();'), 'Der eigene Auswahlsatz des Archivs fehlt');
  assert.ok(html.includes('data-wahl-archiv="${escAttr(c.id)}"'), 'Den Archivzeilen fehlen die Kästchen');
  assert.ok(html.includes('window.__caseArchivBulkUnarchive()') && html.includes('window.__caseArchivBulkDelete()'),
    'Dem Archiv fehlen die Sammelaktionen');

  /* Die Sammelaktion darf nichts erlauben, was einzeln verboten wäre: Zurückholen hängt an
     canManage, Löschen am Admin - dieselbe Verteilung wie an den Zeilenknöpfen. */
  const archivBlock = html.slice(html.indexOf('const archivIcon='), html.indexOf('const dataSections='));
  assert.ok(archivBlock.includes('${canManage?`<button type="button" class="btn" data-wahl-zaehler="archiv"'),
    'Sammel-Zurückholen hängt nicht mehr am Verwaltungsrecht');
  assert.ok(archivBlock.includes('${darfLoeschen?`<button type="button" class="btn danger" data-wahl-zaehler="archiv"'),
    'Sammel-Löschen hängt nicht mehr am Admin');
  assert.ok(archivBlock.includes('const archivWahl=canManage||darfLoeschen;'),
    'Die Auswahlspalte erscheint auch ohne jede erlaubte Sammelaktion');

  /* Unwiderruflich und mehrfach: die Rückfrage nennt die Fälle beim Namen. Eine blosse Zahl
     kann man nicht gegenprüfen. Am Prüfstand: „3 archivierte Fälle unwiderruflich … \n\n
     Auerbach, Margarete\nKilic, Emre\nMustermann, Max". */
  assert.ok(html.includes('Fälle unwiderruflich aus der Datenbank löschen?') && html.includes('${liste}'),
    'Die Löschabfrage nennt die Fälle nicht beim Namen');
});

test('Sammelaktionen: frische Liste, Grund bei Ablehnung, Auswahl bleibt bei Fehlschlag', () => {
  /* Drei Befunde derselben Prüfstandsrunde (29.08.2026):

     (1) fetchServerCases() hält die Fallliste 10 Sekunden im Zwischenspeicher fest.
         renderServerCasesPanel() wird aber fast nur aufgerufen, WEIL sich gerade etwas geändert
         hat. Gemessen: „2 von 2 archiviert", Tabelle unverändert - der Server hatte längst
         umgestellt. Mit force: Tabelle stimmt nach 1380 ms. */
  assert.ok(html.includes('serverCases=await fetchServerCases(true);'),
    'renderServerCasesPanel liest wieder aus dem 10-Sekunden-Zwischenspeicher');

  /* (2) Die Sammelaktionen verschluckten den Grund. Der Server lehnte drei Löschungen sachlich
         ab („Dieser Fall enthält Unterlagen …"), die Meldung sagte nur „0 von 3 gelöscht". */
  assert.ok(html.includes('async function bulkGrund(res)') && html.includes('function bulkMeldung(verb,ok,gesamt,gruende)'),
    'Den Sammelaktionen fehlt die Fehlerauskunft');
  const sammel = html.slice(html.indexOf('async function bulkArchiveServerCases'),
    html.indexOf('async function unarchiveServerCase'))
    + html.slice(html.indexOf('async function bulkUnarchiveServerCases'), html.indexOf('\n  // Phase 5:'));
  for (const stelle of ['archiviert', 'zurückgeholt', 'gelöscht']) {
    assert.ok(sammel.includes(`bulkMeldung('${stelle}'`), `Die Meldung für „${stelle}" nutzt die Fehlerauskunft nicht`);
  }
  assert.ok(!sammel.includes('caseAdminSelected.clear()') && !sammel.includes('caseArchivSelected.clear()'),
    'Eine Sammelaktion leert die Auswahl pauschal - abgelehnte Fälle müssen angehakt bleiben');
  assert.ok(sammel.includes('bulkWahlAufraeumen(caseAdminSelected,erledigt)')
    && sammel.includes('bulkWahlAufraeumen(caseArchivSelected,erledigt)')
    && sammel.includes('bulkWahlAufraeumen(satz||caseArchivSelected,erledigt)'),
    'Die erledigten Fälle werden nicht aus der Auswahl genommen');

  /* (3) Auswahl gegen die aktuelle Liste abgleichen - sonst zählt „Ausgewählte archivieren (1)"
         einen Fall mit, den die Tabelle nach einer Einzelaktion gar nicht mehr zeigt. */
  assert.ok(html.includes('[...caseAdminSelected].forEach(id=>{if(!activeCases.some(c=>c.id===id))caseAdminSelected.delete(id)});'),
    'Die Fall-Auswahl wird nicht gegen die aktuelle Liste abgeglichen');
  assert.ok(html.includes('[...caseArchivSelected].forEach(id=>{if(!archivierte.some(c=>c.id===id))caseArchivSelected.delete(id)});'),
    'Die Archiv-Auswahl wird nicht gegen die aktuelle Liste abgeglichen');

  /* (4) Nach jedem Neuzeichnen müssen die asynchron gefüllten Betreuer-/Vertretungsspalten
         wieder angestoßen werden - sonst stehen sie dauerhaft auf „— lädt …" (Prüfstand:
         153 ms nach dem Neuzeichnen wieder auf „— ohne —"). */
  assert.ok(html.includes("if(daNeu){try{if(window.__caseAdminFillBetreuer)window.__caseAdminFillBetreuer();}catch(_e){}}"),
    'Nach dem Neuzeichnen der Datenadministration bleiben die Betreuerspalten auf „lädt"');
});

test('Fall-Formulare legen sich über den Baustein, nicht über die Einstellungs-Schale', () => {
  /* Beim Nachmessen der Mehrfachauswahl (29.08.2026) fiel derselbe Fehler eine Tür weiter auf:
     „Neuen Fall anlegen" / „Umbenennen" / „Fall importieren" ersetzten #modalBody durch das
     Formular und legten den vorherigen Stand als Zeichenkette zurück. Eingebettet ist
     #modalBody die ganze Einstellungs-Oberfläche - und ein zurückgelegter HTML-Schnappschuss
     hat keine per addEventListener gesetzten Bindungen mehr. Am Prüfstand gemessen: nach
     „Neuen Fall anlegen" -> „Abbrechen" sah alles unversehrt aus, ein Klick auf
     „Bürostammdaten" in der linken Leiste ließ den Titel aber auf „Datenadministration"
     stehen - frisch geöffnet wechselt derselbe Klick. Die Schale war tot.
     Jetzt ersetzt das Formular nur #adminDataAdminBody (nur inline-Handler, übersteht das
     Zurücklegen). Nachgemessen: Dialogbreite bleibt 1160, .set-nav bleibt, Navigation lebt. */
  assert.ok(html.includes('function caseFormOeffnen(titel,inhalt)') && html.includes('function caseFormZurueck(stand)'),
    'Die gemeinsame Formular-Ein-/Ausblendung fehlt');

  const formBlock = html.slice(html.indexOf('function caseFormOeffnen(titel,inhalt)'),
    html.indexOf('function createServerCase()'));
  assert.ok(formBlock.includes("newCaseReturnState=caseFormOeffnen(editCaseId?'Fall umbenennen':'Neuen Fall anlegen'"),
    'openCaseForm greift wieder selbst nach dem Dialogkörper');
  assert.ok(html.includes("migReturnState=caseFormOeffnen('Fall importieren'"),
    'Das Importformular greift wieder selbst nach dem Dialogkörper');
  assert.ok(html.includes('caseFormZurueck(newCaseReturnState);') && html.includes('caseFormZurueck(migReturnState);'),
    'Die Rückwege nutzen die gemeinsame Funktion nicht');

  /* Der Baustein zählt nur, wenn er wirklich dargestellt wird: Über die Befehlsliste lässt
     sich „Neuen Fall anlegen" auch bei geschlossenem Einstellungsmenü auslösen. */
  assert.ok(html.includes('const eingebettet=(kandidat&&kandidat.getClientRects().length)?kandidat:null;'),
    'Ein unsichtbarer Baustein kann das Formular wieder verschlucken');

  /* Eingebettet bleibt der Dialogtitel „Einstellungen" - der Formularname wird zur Überschrift
     am Baustein, sonst stünde das Formular unbeschriftet da. */
  assert.ok(formBlock.includes('if(!eingebettet)modalTitle.textContent=titel;')
    && formBlock.includes('<h4 class="set-abschnitt2" style="margin-top:0">${titel}</h4>'),
    'Das eingebettete Formular bekommt keine eigene Überschrift');

  /* Ein Haken ist eine DOM-Eigenschaft, kein Attribut - er steht nicht im Schnappschuss.
     Ohne Wiederherstellung kam die Tabelle ohne Haken zurück, während der Sammelknopf weiter
     „Ausgewählte archivieren (1)" zählte. Wahrheit ist der Auswahlsatz. */
  assert.ok(formBlock.includes("wirt.querySelectorAll('[data-wahl-fall]').forEach(k=>{k.checked=caseAdminSelected.has(k.getAttribute('data-wahl-fall'))});")
    && formBlock.includes("wirt.querySelectorAll('[data-wahl-archiv]').forEach(k=>{k.checked=caseArchivSelected.has(k.getAttribute('data-wahl-archiv'))});"),
    'Nach dem Zurücklegen gehen die gesetzten Haken verloren');
});

test('Sammel-Löschen gibt es in BEIDEN Falltabellen', () => {
  /* Nutzerfund 29.08.2026 („Ausgewählte löschen fehlt noch"): Die Auswahl-Zeile der Falldaten
     bot nur „Ausgewählte archivieren" an - Löschen stand allein im „···"-Menü der einzelnen
     Zeile. Wer zehn Fälle wegräumen wollte, musste zehnmal durchs Menü. Die Rechteverteilung
     bleibt wie an den Einzelaktionen: Löschen ist Admin-Sache, in beiden Tabellen. */
  assert.ok(html.includes('${darfLoeschen?`<button type="button" class="btn danger" data-wahl-zaehler="fall" data-wahl-text="Ausgewählte löschen"'),
    'Der Falldaten-Tabelle fehlt das Sammel-Löschen');
  assert.ok(html.includes('window.__caseAdminBulkDelete=function(){bulkDeleteServerCases([...caseAdminSelected],caseAdminSelected)};'),
    'Das Sammel-Löschen der Falldaten hängt nicht am eigenen Auswahlsatz');
  assert.ok(html.includes('window.__caseArchivBulkDelete=function(){bulkDeleteServerCases([...caseArchivSelected],caseArchivSelected)};'),
    'Das Sammel-Löschen des Archivs hängt nicht am eigenen Auswahlsatz');

  /* EINE Funktion für beide Tabellen (Auswahlsatz als Parameter) - eine zweite Fassung wäre
     eine Kopie, die irgendwann auseinanderläuft. */
  assert.ok(html.includes('async function bulkDeleteServerCases(caseIds,satz)'),
    'Es gibt keine gemeinsame Löschfunktion mit übergebenem Auswahlsatz');
  assert.equal((html.match(/async function bulkDeleteServerCases/g) || []).length, 1,
    'Es gibt mehr als eine Löschfunktion');

  /* Aus der Fallliste heraus kann der gelöschte Fall der GEÖFFNETE sein - sonst zeigt die
     Arbeitsfläche einen Fall, den es nicht mehr gibt. Im Archiv konnte das nicht passieren,
     deshalb fehlte die Zeile bisher.
     Die REIHENFOLGE ist der eigentliche Punkt: erst nach dem erfolgreichen Löschen schließen,
     wie in deleteServerCase. Der Server verweigert Fälle mit Unterlagen (409) - vorher zu
     schließen machte den geöffneten Fall bei jeder Ablehnung grundlos zu. Beim Archivieren
     ist es umgekehrt richtig, dort muss der Fall vorher zu sein. */
  const loeschBlock = html.slice(html.indexOf('async function bulkDeleteServerCases(caseIds,satz)'),
    html.indexOf("bulkMeldung('gelöscht'"));
  const zu = loeschBlock.indexOf('if(window.__activeServerCaseId===caseId)closeServerCase();');
  assert.ok(zu > 0, 'Ein gelöschter aktiver Fall bleibt in der Arbeitsfläche stehen');
  assert.ok(zu > loeschBlock.indexOf("method:'DELETE'"),
    'Der aktive Fall wird VOR dem Löschen geschlossen - eine Ablehnung schlösse ihn dann grundlos');
});

test('Fallliste-Zusammenführung Schritt 2a: Suche in der Datenadministration, Bereich „Fälle" abgebaut', () => {
  /* Nutzerentscheidung 29.08.2026 („Braucht es Fälle noch?" - „ja" zum Vorschlag): Der
     Einstellungsbereich „Fälle" bot nach Schritt 1 + Sammelaktionen nur noch EINES, was die
     Datenadministration nicht hatte - die Suche. Erst kommt die Suche herüber, dann fällt der
     Bereich. Rechte geprüft: „Fälle" war admin-only, Admins sehen die Datenadministration
     immer - niemand verliert einen Zugang. */

  /* (1) Die Suche: ein Feld, filtert BEIDE Tabellen (Falldaten und Archiv). */
  assert.ok(html.includes('oninput="window.__caseAdminSuche(this.value)"'), 'Das Suchfeld fehlt');
  assert.ok(html.includes('value="${escAttr(caseAdminSuche)}"'),
    'Der Suchbegriff überlebt kein Neuzeichnen nach Aktionen');
  assert.ok(html.includes('filtert Falldaten und Fallarchiv'),
    'Es steht nicht dran, dass die Suche auch das Archiv filtert');
  for (const art of ['fall', 'archiv']) {
    assert.ok(html.includes(`data-da-tabelle="${art}"`), `Den ${art}-Zeilen fehlt das Suchziel`);
    assert.ok(html.includes(`data-da-suchleer="${art}"`), `Der ${art}-Tabelle fehlt die Leertreffer-Zeile`);
  }

  /* (2) Tippen zeichnet NICHT neu - Zeilen werden nur umgeblendet. Ein Neuzeichnen würfe
     Fokus, Scrollstand und die asynchron gefüllten Betreuerspalten weg (dieselbe Falle wie
     bei den Auswahlkästchen, am Prüfstand je einmal bewiesen). */
  const suche = html.slice(html.indexOf('window.__caseAdminSuche=function'),
    html.indexOf('window.__caseAdminToggleSelect='));
  assert.ok(suche.length > 0 && !suche.includes('caseAdminModalHTML()') && !suche.includes("getElementById('modalBody')"),
    'Der Suche-Handler zeichnet die Karte neu statt Zeilen umzublenden');
  assert.ok(html.includes('.data-admin-view .bu-table tr[hidden]{display:none}'),
    'tr[hidden] ist nicht festgeschrieben - eine display-Regel an Zeilen hebelte die Suche aus');

  /* (3) „Alle auswählen" nimmt nur die Treffer - sonst archiviert/löscht die Sammelaktion
     Fälle, die der Filter gerade verbirgt. Die Kästchen kommen aus dem SATZ, nicht pauschal. */
  assert.ok(html.includes("serverCases.filter(c=>!c.archived&&caseSucheTrifft(c))")
    && html.includes("serverCases.filter(c=>c.archived&&caseSucheTrifft(c))"),
    '„Alle auswählen" ignoriert die Suche');
  assert.ok(html.includes("forEach(k=>{k.checked=satz.has(k.getAttribute(attribut))})"),
    'Die Kästchen werden pauschal statt aus dem Auswahlsatz gesetzt');

  /* (4) Der Abbau: kein Nav-Eintrag, kein Einbett-Bauer, keine Statuszahl mehr für „faelle";
     alte Sprungziele (Admin-Tab 'cases') landen in der Datenadministration. */
  const n = html.indexOf('const EIN_NAV=');
  const nav = html.slice(n, html.indexOf('\n];', n));
  assert.ok(!nav.includes("id:'faelle'"), 'Der Bereich „Fälle" steht noch in der Navigation');
  assert.ok(!html.includes("faelle:{unter:"), 'Der Einbett-Bauer des Bereichs „Fälle" lebt noch');
  assert.ok(!html.includes("faelle:{zahl:'faelle'"), 'Die Statuszahl des Bereichs „Fälle" lebt noch');
  assert.ok(html.includes("cases:'datenadmin'"), "Der Sprung vom Admin-Tab 'cases' landet nicht in der Datenadministration");
  /* Die Datenadministration nutzt die Server-Zahl 'faelle' weiter - die Route bleibt. */
  assert.ok(html.includes("datenadmin:{zahl:'faelle'"), 'Die Fallzahl der Datenadministration ist mit gestorben');
});

test('Fallliste-Zusammenführung Schritt 2b: die Sidebar-Menüs zeigen die Karten der Datenadministration', () => {
  /* Nutzerwunsch 29.08.2026 (Screenshots der beiden Sidebar-Dialoge): „Fälle" und „Fallarchiv"
     sollen NICHT verschwinden, sondern die jeweilige Tabelle samt Knöpfen der
     Datenadministration zeigen. Vorher waren es drei verschieden mächtige Falllisten
     (Statuschips, Suche, Auswahl, Zeitstempel nur in der Datenadministration). Jetzt gibt es
     jede Karte im Markup genau EINMAL - die Dialoge sind nur noch Rahmen darum. */
  assert.ok(html.includes('return `<div class="data-admin-view">${caseFallKarteHTML(true)}</div>`;'),
    'Das Menü „Fälle" zeigt nicht die geteilte Falldaten-Karte');
  assert.ok(html.includes('return `<div class="data-admin-view">${caseArchivKarteHTML(true)}</div>`;'),
    'Das Menü „Fallarchiv" zeigt nicht die geteilte Archiv-Karte');

  /* Ohne den Anstoß blieben die Betreuer-/Vertretungsspalten des Fälle-Dialogs auf „— lädt …"
     - beim Öffnen UND bei der Live-Aktualisierung nach Aktionen (der Anstoß muss deshalb NACH
     dem Fälle-Zweig von renderServerCasesPanel stehen; vorher stand er darüber). */
  const openList = html.slice(html.indexOf('function openCaseListModal()'), html.indexOf('function caseListTriggerHTML()'));
  assert.ok(openList.includes('window.__caseAdminFillBetreuer'), 'Der Fälle-Dialog stößt die Betreuerspalten nicht an');
  /* 30.08. Demo-Vollausbau: demoBoot referenziert __renderOnlineCasesPanel jetzt VOR dessen
     Definition - deshalb auf die Zuweisung (mit '=') ankern, nicht auf die erste Erwähnung. */
  const panel = html.slice(html.indexOf('async function renderServerCasesPanel()'), html.indexOf('window.__renderOnlineCasesPanel='));
  assert.ok(panel.indexOf("textContent==='Fälle'") < panel.indexOf('if(daNeu)'),
    'Der Betreuer-Anstoß läuft vor dem Fälle-Zweig - dessen Neuzeichnen bliebe auf „— lädt …"');
  assert.ok(panel.includes("innerHTML=caseListModalHTML();daNeu=true;"),
    'Der Fälle-Zweig meldet sein Neuzeichnen nicht');

  /* Icon (Nutzerwunsch): die Person aus dem Fälle-Menü statt des Aktenordners an der
     Falldaten-Karte - Fälle sind Menschen. Der alte Ordner-Pfad ist raus. */
  assert.ok(html.includes('<div class="da-head">${FALL_ICON}<div class="da-head-main"><div class="da-title">Falldaten</div>'),
    'Die Falldaten-Karte trägt nicht das Personen-Symbol');
  /* Der Ordner-Pfad selbst lebt anderswo legitim weiter (Fallorganisation-Gruppe,
     Ordnergenerator, Datei-Explorer) - gestorben ist nur die Karten-Konstante. */
  assert.ok(!html.includes('const fallIcon='),
    'Die Aktenordner-Konstante der Falldaten-Karte lebt noch');

  /* Allein im Dialog braucht die Archiv-Karte eine EIGENE Suchzeile - in der
     Datenadministration filtert das eine Feld der Falldaten-Karte beide Tabellen mit. */
  assert.ok(html.includes('const sucheZeile=(einzeln&&archivierte.length)?caseSucheZeileHTML(\'\'):\'\';'),
    'Die allein stehende Archiv-Karte hat keine eigene Suche');
  assert.ok(html.includes('${archivBulk}${sucheZeile}'),
    'Die Archiv-Suchzeile ist nicht in die Karte eingehängt');
  /* Der Hinweis „filtert Falldaten und Fallarchiv" gehört NUR in die Datenadministration -
     im Einzeldialog steht kein Archiv daneben. */
  assert.ok(html.includes("caseSucheZeileHTML(einzeln?'':'filtert Falldaten und Fallarchiv')"),
    'Der Suchhinweis unterscheidet nicht zwischen Einzeldialog und Datenadministration');
});

test('Zählpunkte, KI-Haken, Zahnrad – die drei Wünsche vom 29.08. nachmittags', () => {
  /* (1) „Die Tooltips fehlen!": JEDER andere Zählpunkt der Seitenleiste erklärt sich beim
     Überfahren (Falldokumentation, Aufgaben, Fristen, Fallbeginn, Betreuungsübersicht, … -
     alle setzen el.title; am Bestand nachgeprüft). Nur die drei Fall-Zähler taten es nicht.
     Am Prüfstand: „3 Fälle auf dem Server" / „1 archivierter Fall". */
  assert.ok(html.includes("const fallZaehlTitel=n=>n?(n===1?'1 Fall auf dem Server':n+' Fälle auf dem Server'):'Noch kein Fall auf dem Server';"),
    'Der Titel-Bauer der Fall-Zähler fehlt');
  for (const stelle of ['data-case-admin-count title="${escAttr(fallZaehlTitel(activeCount))}"',
    'data-case-list-count title="${escAttr(fallZaehlTitel(activeCount))}"',
    'data-case-archive-count title="${escAttr(archivZaehlTitel(archivedCount))}"']) {
    assert.ok(html.includes(stelle), `Ein Fall-Zählpunkt hat seinen Tooltip verloren: ${stelle.slice(0, 30)}`);
  }

  /* (2) „Hier lieber einen Haken als eine Zahl": Die Frage an den KI-Punkt ist „eingerichtet -
     ja oder nein?", nicht „wie viele?". Der Haken zeigt den Zustand, die Zahl bleibt im
     Tooltip - an BEIDEN Auftritten (Nutzermenü-Schnellzugriff und Einstellungs-Navigation). */
  const kiZeichner = html.slice(html.indexOf('function einKiIndikatorZeichnen()'), html.indexOf('window.__einKiIndikator='));
  /* 30.08.: Haken bleibt, aber GRUEN erst nach erfolgreichem Verbindungstest (kiGeprueft>0). */
  assert.ok(kiZeichner.includes("el.textContent=(n&&g)?'✓':'•';"), 'Der KI-Schnellzugriff wird ohne gepruefte Verbindung gruen');
  assert.ok(kiZeichner.includes("erfolgreich geprüft"), 'Der Pruefstand fehlt im KI-Tooltip');
  assert.ok(!html.includes('st.haken'), 'Der tote haken-Sonderweg lebt noch im Indikator-Zeichner');

  /* (3) Zahnrad-Schnellzugriff im Nutzermenü, ZWISCHEN „Darstellung wechseln" und „Abmelden"
     (Nutzerwunsch, wörtlich). Nur online (lokal gibt es das Einstellungsmenü nicht) und am
     selben Recht wie der Einstellungen-Eintrag im Menükörper - sonst sähe ein Nutzer ohne
     menuSettings das Zahnrad trotzdem. */
  const theme = html.indexOf('data-user-menu-theme title="Darstellung wechseln"');
  const zahnrad = html.indexOf('data-user-menu-settings-quick title="Einstellungen"');
  const abmelden = html.indexOf('data-user-menu-logout-quick title="Abmelden"');
  assert.ok(theme > 0 && zahnrad > theme && abmelden > zahnrad,
    'Das Zahnrad sitzt nicht zwischen Darstellung wechseln und Abmelden');
  const zahnradKnopf = html.slice(html.indexOf("'<button type=\"button\" class=\"summary-icon-btn\" data-user-menu-settings-quick"), abmelden);
  assert.ok(zahnradKnopf.includes('window.openEinstellungenApp&&window.openEinstellungenApp()'),
    'Das Zahnrad öffnet nicht das Einstellungsmenü');
  assert.ok(zahnradKnopf.includes('event.stopPropagation()'),
    'Ein Klick aufs Zahnrad würde zugleich das Nutzermenü aufklappen');
  assert.ok(html.includes("['menuSettings',(text,node)=>!!node?.hasAttribute?.('data-user-menu-settings-quick')],"),
    'Das Zahnrad hängt nicht am menuSettings-Recht');
});

test('Kalender-Karten: Lesebreite statt Bandwurmzeilen, der Feed-Text ist gegliedert', () => {
  /* Nutzerwunsch 30.08.2026 („layoute hier die texte besser"): Die Kartentexte des Bereichs
     liefen ohne Breitenbegrenzung über die volle Modalbreite; der Feed-Text packte drei
     Aussagen samt Einrichtungspfad in einen Satz. Gemessen bei 1500px: 534px Textbreite. */
  assert.ok(html.includes('.cal-kartentext{font-size:12px;color:var(--muted);margin:2px 0 10px;line-height:1.55;max-width:80ch}'),
    'Die Lesebreiten-Klasse für Kartentexte fehlt');
  for (const t of ['Aufgaben samt Fristen', 'Erledigt-Rückmeldung', 'Super Productivity']) {
    assert.ok(html.includes(`<li>`) && html.includes(t), `Der Feed-Punkt „${t}“ fehlt`);
  }
  assert.ok(!html.includes('Schreibarmer CalDAV-Feed der büroweiten Aufgaben unter einer Token-URL'),
    'Der alte Bandwurm-Feedtext ist zurück');
  assert.equal((html.match(/class="cal-kartentext"/g) || []).length >= 4, true,
    'Nicht alle Kartentexte nutzen die Lesebreiten-Klasse');
});
