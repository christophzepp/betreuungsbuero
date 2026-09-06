'use strict';

/* Pruefstand fuer den Briefkopf-Editor, Paket P4 (06.09.2026): Rundlauf und Politur.
     - ONLINE-Rundlauf AUSGEFUEHRT gegen die echten Router (office-json, user-prefs) mit
       Wegwerf-Datenbank: der Block unified-document-print-layout-v230 (Karte P1 + Zeichner P3)
       laeuft in einer vm, deren fetch auf den Testserver zeigt. Speichern -> Neuladen in einer
       frischen vm -> PDF-Kopf ueber Fake-page. Persoenliche Abweichung (Name/Titel/Funktionszeile)
       mit BEIDEN Sperren (Kartenfeld eigeneErlaubt, Sperrschalter briefkopf.eigeneErlaubt) und
       Realtime-Nachladen ueber das Ereignis betreuung:office-event.
     - LOKAL-Rundlauf: bueroLocal.briefkopf / briefkopfEigen ueber saveBueroLocal, Neuladen aus
       demselben Speicher.
     - __briefkopfEigenAnwenden als EINE Stelle fuer Effektiv-Karte und Editor-Vorschau.
     - Politur-Pins: Buerostammdaten-Hinweise (Logo = App-Marke, Sprunglink), Exportdialog-Zeile,
       Abschnitt „Meine Anpassung“ im Editor, Berichtsdruck-Seitenfuss der Vorschau, keine
       toten Reste (Fallbacks, Platzhaltertexte). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

function block(id) {
  const lines = html.split('\n');
  const a = lines.findIndex(l => l.includes(`<script id="${id}">`));
  assert.ok(a > 0, id + ' fehlt');
  const b = lines.findIndex((l, i) => i > a && l.trim() === '</' + 'script>');
  return lines.slice(a + 1, b).join('\n');
}
const V230 = block('unified-document-print-layout-v230');

/* ═══════════════════ Testserver: echte Router, Sitzung gestellt ═══════════════════ */

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briefkopf-rundlauf-'));
process.env.DB_PATH = path.join(TEMP, 'rundlauf.sqlite3');

let server = null;
let sitzung = { isAdmin: true, canViewCases: 1 };

function serverStarten() {
  if (server) return server;
  const express = require('express');
  const alterLog = console.log;
  let db;
  try {
    console.log = (...args) => { if (!String(args[0] || '').startsWith('[Fallrechte]')) alterLog(...args); };
    db = require('../src/database/index');
  } finally { console.log = alterLog; }
  db.prepare(`INSERT INTO users (id,username,password_hash,display_name,allow_local,allow_online,is_admin)
    VALUES (1,'rundlauf','x','Rundlauf',1,1,1)`).run();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = Object.assign({ userId: 1, mode: 'online' }, sitzung); next(); });
  app.use('/api/office-json', require('../src/modules/office/json-routes'));
  app.use('/api/user-prefs', require('../src/modules/settings/user-preference-routes'));
  server = app.listen(0);
  return server;
}
const basis = () => 'http://127.0.0.1:' + serverStarten().address().port;

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
      antwort.on('end', () => auf({ status: antwort.statusCode, json: text ? JSON.parse(text) : null }));
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

/* ═══════════════════ Sandbox: Karte + Zeichner mit Fake-pdf-lib ═══════════════════ */

function fakeFont(name) {
  return { name, widthOfTextAtSize: (t, size) => Math.round(String(t).length * size * 0.5 * 100) / 100 };
}
function fakePage(log) {
  const norm = o => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === 'object' && v.widthOfTextAtSize) ? v.name : v));
  return {
    drawText: (t, o) => log.push({ op: 'text', text: String(t), ...norm(o) }),
    drawRectangle: o => log.push({ op: 'rect', ...norm(o) }),
    drawLine: o => log.push({ op: 'line', ...norm(o) })
  };
}
const RGB = (r, g, b) => ({ type: 'RGB', red: r, green: g, blue: b });
const FONTS = () => ({ regular: fakeFont('R'), bold: fakeFont('B'), italic: fakeFont('I'), boldItalic: fakeFont('BI'), unicode: true, italicUnicode: true });
const OFFICE = { name: 'Betreuungsbüro Muster', degree: '', address: 'Musterstraße 1, 12345 Musterstadt', phone: '01234/5', email: 'post@muster.de', bank: 'Musterbank', iban: 'DE00', bic: 'BICX', tax: '11/222' };

/* opt.modus 'online' (fetch -> Testserver) oder 'lokal' (bueroLocal + saveBueroLocal);
   opt.gesperrt = Sperrschalter briefkopf.eigeneErlaubt; opt.bueroLocal = geteilter Lokalspeicher. */
function sandbox(opt) {
  opt = opt || {};
  const sb = { console, setTimeout, clearTimeout, Promise, JSON, Math };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  const lauscher = {};
  sb.document = {
    addEventListener(typ, fn) { (lauscher[typ] = lauscher[typ] || []).push(fn); },
    getElementById() { return null; },
    dispatchEvent(ev) { (lauscher[ev.type] || []).forEach(fn => fn(ev)); return true; }
  };
  sb.CustomEvent = function (t, i) { this.type = t; this.detail = i && i.detail; };
  sb.addEventListener = () => {}; sb.dispatchEvent = () => {};
  sb.PDFLib = { rgb: RGB, StandardFonts: { Helvetica: 'Helvetica', HelveticaBold: 'Helvetica-Bold', HelveticaOblique: 'Helvetica-Oblique', HelveticaBoldOblique: 'Helvetica-BoldOblique' } };
  sb.OFFICE = Object.assign({}, OFFICE);
  sb.officeNameWithDegree = () => sb.OFFICE.name + (sb.OFFICE.degree ? ` (${sb.OFFICE.degree})` : '');
  sb.state = { caseData: { person: { firstName: 'Max', lastName: 'Mustermann' }, care: { fileNumber: 'XVII 123/24', courtName: 'Amtsgericht Musterstadt' } }, reports: {} };
  sb.fullName = () => 'Max Mustermann';
  sb.isEmpty = v => v === undefined || v === null || v === '';
  sb.todayDE = () => '06.09.2026';
  sb.pdfSafeText = v => String(v ?? '');
  sb.__pdfSafeTextOriginal = v => String(v ?? '');
  sb.__sigStore = { caregiverCached: () => ({ caregiver: { name: 'Sabine Kraft' } }) };
  sb.__docPlaceDate = () => ({ place: 'Musterstadt', dateDE: '06.09.2026', text: 'Musterstadt, 06.09.2026' });
  sb.OFFICIAL_PDF_TEMPLATES = {}; sb.OFFICIAL_STRUCTURED_TABLES = {}; sb.REPORTS = []; sb.SCHEMAS = {};
  sb.phase3ComponentBytes = async () => { throw new Error('nicht im Pruefstand'); };
  sb.embeddedPdfBytes = async () => null;
  sb.getDocumentOptions = () => ({ signatureId: 'none', ownSignature: false, foreignSignatures: 0 });
  sb.__einstellungenVorgabe = () => undefined;
  sb.__eigeneWahlGesperrt = (key) => key === 'briefkopf.eigeneErlaubt' && !!opt.gesperrt;
  if (opt.modus === 'lokal') {
    sb.__appMode = 'local';
    sb.bueroLocal = opt.bueroLocal || {};
    sb.saveBueroLocal = () => { sb.saveBueroLocal.anzahl = (sb.saveBueroLocal.anzahl || 0) + 1; };
    sb.fetch = async () => { throw new Error('lokal darf nicht fetchen'); };
  } else {
    sb.__appMode = 'online';
    sb.fetch = (url, init) => fetch(basis() + url, init);
  }
  vm.createContext(sb);
  vm.runInContext(V230, sb, { filename: 'v230.js' });
  return sb;
}
const kopfTexte = (sb, optionen) => { const log = []; sb.__unifiedLetterHead(fakePage(log), FONTS(), optionen); return log; };
const J = (x) => JSON.parse(JSON.stringify(x));   // vm-Objekte haben fremde Prototypen
const warteBis = async (fn, ms) => { const ende = Date.now() + (ms || 2000); while (Date.now() < ende) { if (fn()) return true; await new Promise(r => setTimeout(r, 25)); } return fn(); };

/* ═══════════════════ 1. Online-Rundlauf ═══════════════════ */

test('online: Speichern -> Neuladen (frische vm) -> PDF-Kopf zeichnet die gespeicherte Karte', async () => {
  const a = sandbox();
  await a.__briefkopfLaden();
  assert.equal(a.__briefkopfEffektiv().gepflegt, false, 'leere Ablage = Standard');
  assert.equal(kopfTexte(a).filter(e => e.op === 'rect').length, 1, 'Standard: Band als Rechteck');

  const karte = a.__briefkopfStandardKarte();
  karte.band = Object.assign(karte.band, { stil: 'linie', hoehe: 1.2, text: '' });
  karte.falz = { an: true, loch: true };
  karte.kopfLinks.zeilen[1].t = 'Rechtliche Betreuungen · Verfahrenspflegschaften';
  const gespeichert = await a.__briefkopfSpeichern(karte);
  assert.equal(gespeichert.ausgangspunkt, 'eigen', 'geaenderte Klassisch-Karte wird als „eigen“ abgelegt');

  const server = await ruf('GET', '/api/office-json/briefkopf');
  assert.equal(server.status, 200);
  assert.equal(server.json.data.band.stil, 'linie');
  assert.equal(server.json.data.version, 1);

  const b = sandbox();
  assert.equal(b.__briefkopfEffektiv().gepflegt, false, 'vor dem Laden gilt Standard');
  await b.__briefkopfLaden();
  const eff = b.__briefkopfEffektiv();
  assert.equal(eff.gepflegt, true);
  assert.equal(eff.band.stil, 'linie');
  const log = kopfTexte(b);
  assert.equal(log.filter(e => e.op === 'rect').length, 0, 'kein Band mehr');
  assert.ok(log.some(e => e.op === 'line' && e.thickness === 1.2), 'Linie 1,2 pt');
  assert.ok(log.some(e => e.op === 'line' && e.end && e.end.x === 14), 'Falzmarke');
  assert.ok(log.some(e => e.text === 'Rechtliche Betreuungen · Verfahrenspflegschaften'), 'Funktionszeile aus der Karte');
});

test('online: Realtime - ein anderes Fenster aendert die Vorgabe, das Ereignis laedt nach', async () => {
  sitzung = { isAdmin: true, canViewCases: 1 };
  const a = sandbox();
  await a.__briefkopfLaden();
  const vorher = a.__briefkopfEffektiv();
  /* „anderes Fenster“: direkter PUT am Router */
  const neu = a.__briefkopfStandardKarte();
  neu.farbe = '#123456'; neu.band.text = 'Kanzlei BÜRO';
  const put = await ruf('PUT', '/api/office-json/briefkopf', { data: neu });
  assert.equal(put.status, 200);
  assert.equal(a.__briefkopfEffektiv().farbe, vorher.farbe, 'ohne Ereignis bleibt der alte Stand');
  a.document.dispatchEvent(new a.CustomEvent('betreuung:office-event', { detail: { area: 'officeJson', payload: { method: 'PUT', path: '/briefkopf' } } }));
  assert.ok(await warteBis(() => a.__briefkopfEffektiv().farbe === '#123456'), 'nach dem Ereignis ist die neue Karte wirksam');
  assert.ok(kopfTexte(a).some(e => e.text === 'Kanzlei ' + OFFICE.name), 'Bandtext aus der nachgeladenen Karte');
  a.document.dispatchEvent(new a.CustomEvent('betreuung:office-event', { detail: { area: 'finance', payload: { path: '/x' } } }));
  assert.equal(a.__briefkopfEffektiv().farbe, '#123456', 'fremde Bereiche stoeren nicht');
  /* Behebung 06.09.: Speichern schreibt Karte UND Sperrschalter (einstellungs_vorgaben) ueber denselben Bereich
     officeJson; die Client-Entprellung behaelt nur die letzte Nutzlast. Deshalb laedt auch das
     Sperrschalter-Ereignis nach - und der Editor schreibt den Sperrschalter zuerst. */
  neu.farbe = '#654321';
  assert.equal((await ruf('PUT', '/api/office-json/briefkopf', { data: neu })).status, 200);
  a.document.dispatchEvent(new a.CustomEvent('betreuung:office-event', { detail: { area: 'officeJson', payload: { method: 'PUT', path: '/einstellungs_vorgaben' } } }));
  assert.ok(await warteBis(() => a.__briefkopfEffektiv().farbe === '#654321'), 'das Sperrschalter-Ereignis laedt die Karte nach');
  const ed = html.slice(html.indexOf('/* ═══ BRIEFKOPF-EDITOR'), html.indexOf('/* ═══ BRIEFKOPF-EDITOR: ENDE ═══ */'));
  const sp = ed.indexOf('async function speichern(btn){');
  assert.ok(sp > 0);
  const speichern = ed.slice(sp, ed.indexOf('async function sperrschalterAngleichen', sp));
  assert.ok(speichern.indexOf('await sperrschalterAngleichen();') < speichern.indexOf('W.__briefkopfSpeichern(karte)'), 'Sperrschalter vor dem Briefkopf-PUT');
  assert.equal((speichern.match(/await sperrschalterAngleichen\(\);/g) || []).length, 1);
});

test('online: persoenliche Abweichung end-to-end - Name/Titel/Funktionszeile im PDF-Kopf, Kartenfeld und Sperrschalter sperren', async () => {
  const a = sandbox();
  await a.__briefkopfZuruecksetzen();
  await a.__briefkopfLaden();
  assert.equal(a.__briefkopfEffektiv().gepflegt, false);
  const e = await a.__briefkopfEigenSpeichern({ name: 'Erika Test', titel: 'M.A.', funktion: 'Fachkraft Rechtliche Betreuung' });
  assert.deepEqual(J(e), { version: 1, name: 'Erika Test', titel: 'M.A.', funktion: 'Fachkraft Rechtliche Betreuung' });
  const prefs = await ruf('GET', '/api/user-prefs/briefkopf-eigen');
  assert.equal(prefs.status, 200);
  assert.equal(prefs.json.prefs.name, 'Erika Test', 'im Personen-Speicher abgelegt');

  const b = sandbox();
  await b.__briefkopfLaden();
  assert.equal(b.__briefkopfEigenErlaubt(), true);
  const eff = b.__briefkopfEffektiv();
  assert.deepEqual(J(eff.eigen), J(e));
  /* Behebung 06.09. (Pruefer-Fund): der Titel der Person steht LITERAL im linken Kopf - der Baustein TITEL bleibt
     der Grad des Bueros, sonst bekaeme „INHABER (TITEL)“ in der Fusszeile den Grad der Mitarbeiterin. */
  assert.equal(eff.kopfLinks.zeilen[0].t, '**BETREUER, M.A.**', 'Titel literal hinter den Namen gestellt');
  assert.equal(eff.kopfLinks.zeilen[1].t, 'Fachkraft Rechtliche Betreuung', 'Funktionszeile ersetzt');
  assert.equal(b.__briefkopfWert('BETREUER'), 'Erika Test');
  b.OFFICE.degree = 'B.A.';
  assert.equal(b.__briefkopfWert('TITEL'), 'B.A.', 'TITEL = Grad des Bueros, nicht der Person');
  const log = kopfTexte(b);
  assert.deepEqual(log.slice(0, 2).map(x => [x.text, x.y, x.size]), [['Erika Test, M.A.', 800, 11.5], ['Fachkraft Rechtliche Betreuung', 788, 8.5]]);
  const fussLog = [];
  b.__unifiedLetterFooter(fakePage(fussLog), FONTS(), {});
  assert.equal(fussLog[0].text, 'Betreuungsbüro Muster (B.A.)', 'Fusszeile Zeile 1 = Inhaber:in mit Buerograd, nicht M.A. der Person');
  b.OFFICE.degree = '';
  assert.equal(b.__briefkopfStatus().text, 'Standard-Briefkopf · mit Ihrer Anpassung');

  /* Sperre 1: Kartenfeld eigeneErlaubt der Buerovorgabe */
  const gesperrt = b.__briefkopfStandardKarte(); gesperrt.eigeneErlaubt = false;
  await b.__briefkopfSpeichern(gesperrt);
  const c = sandbox();
  await c.__briefkopfLaden();
  assert.equal(c.__briefkopfEigenErlaubt(), false);
  assert.equal(c.__briefkopfEffektiv().eigen, null);
  assert.equal(c.__briefkopfWert('BETREUER'), 'Sabine Kraft', 'ohne Erlaubnis zaehlt die Betreuer:in des Falls');
  assert.equal(kopfTexte(c)[0].text, 'Sabine Kraft');
  assert.equal(c.__briefkopfStatus().text, 'Eigener Briefkopf des Büros');
  assert.equal((await ruf('GET', '/api/user-prefs/briefkopf-eigen')).json.prefs.name, 'Erika Test', 'die Abweichung bleibt gespeichert, wirkt nur nicht');

  /* Sperre 2: Sperrschalter briefkopf.eigeneErlaubt bei erlaubender Karte */
  await c.__briefkopfZuruecksetzen();
  const d = sandbox({ gesperrt: true });
  await d.__briefkopfLaden();
  assert.equal(d.__briefkopfEffektiv().gepflegt, false);
  assert.equal(d.__briefkopfEigenErlaubt(), false);
  assert.equal(d.__briefkopfWert('BETREUER'), 'Sabine Kraft');
  assert.equal(kopfTexte(d)[0].text, 'Sabine Kraft');

  /* Entfernen */
  const f = sandbox();
  await f.__briefkopfLaden();
  assert.equal(f.__briefkopfWert('BETREUER'), 'Erika Test');
  assert.equal(await f.__briefkopfEigenSpeichern(null), null);
  assert.equal(f.__briefkopfWert('BETREUER'), 'Sabine Kraft');
  const g = sandbox();
  await g.__briefkopfLaden();
  assert.equal(g.__briefkopfEigen(), null, 'nach dem Entfernen ist der Personen-Speicher leer');
});

/* ═══════════════════ 2. Lokal-Rundlauf ═══════════════════ */

test('lokal: Speichern in bueroLocal (saveBueroLocal) -> Neuladen aus demselben Speicher -> PDF-Kopf; Abweichung ebenso', async () => {
  const speicher = {};
  const a = sandbox({ modus: 'lokal', bueroLocal: speicher });
  assert.equal(a.__briefkopfEffektiv().gepflegt, false);
  const karte = a.__briefkopfStandardKarte();
  karte.band.stil = 'keins'; karte.band.an = false;
  await a.__briefkopfSpeichern(karte);
  assert.equal(a.saveBueroLocal.anzahl, 1, 'saveBueroLocal gerufen');
  assert.equal(speicher.briefkopf.band.stil, 'keins');
  await a.__briefkopfEigenSpeichern({ name: 'Lokale Person', titel: '', funktion: '' });
  assert.equal(a.saveBueroLocal.anzahl, 2);
  assert.equal(speicher.briefkopfEigen.name, 'Lokale Person');

  const b = sandbox({ modus: 'lokal', bueroLocal: speicher });
  const eff = b.__briefkopfEffektiv();
  assert.equal(eff.gepflegt, true, 'beim Start aus bueroLocal geladen');
  assert.equal(eff.band.stil, 'keins');
  assert.equal(eff.eigen.name, 'Lokale Person');
  const log = kopfTexte(b);
  assert.equal(log.filter(e => e.op === 'rect').length, 0, 'ohne Band kein Rechteck');
  assert.equal(log[0].text, 'Lokale Person');
  assert.equal(b.__unifiedLetterHead(fakePage([]), FONTS()), 724, 'Inhaltsstart bleibt bei der 22-pt-Zone');

  /* Sperrschalter lokal (Vorgaben gelten auch im Lokal-Betrieb) */
  const c = sandbox({ modus: 'lokal', bueroLocal: speicher, gesperrt: true });
  assert.equal(c.__briefkopfEffektiv().eigen, null);
  assert.equal(kopfTexte(c)[0].text, 'Sabine Kraft');
  await c.__briefkopfZuruecksetzen();
  assert.equal(speicher.briefkopf, null);
  assert.equal(sandbox({ modus: 'lokal', bueroLocal: speicher }).__briefkopfEffektiv().gepflegt, false);
});

/* ═══════════════════ 3. Eigen-Anwendung als EINE Funktion ═══════════════════ */

test('__briefkopfEigenAnwenden: Funktionszeile trifft die erste Zeile ohne Namensbaustein, sonst kommt sie dazu; Titel hinter BETREUER', () => {
  const s = sandbox({ modus: 'lokal' });
  const std = s.__briefkopfNormalisieren(s.__briefkopfStandardKarte());
  const k1 = s.__briefkopfEigenAnwenden(JSON.parse(JSON.stringify(std)), { name: 'A', titel: 'Dr.', funktion: 'Fachkraft' });
  assert.equal(k1.kopfLinks.zeilen.length, 2);
  assert.equal(k1.kopfLinks.zeilen[0].t, '**BETREUER, Dr.**', 'Titel literal (Behebung 06.09.)');
  assert.equal(k1.kopfLinks.zeilen[1].t, 'Fachkraft');
  assert.equal(k1.eigen.name, 'A');

  const linie = s.__briefkopfNormalisieren(s.__briefkopfAusgangspunkte.linie());
  const k2 = s.__briefkopfEigenAnwenden(JSON.parse(JSON.stringify(linie)), { funktion: 'Fachkraft', titel: 'Dr.' });
  assert.equal(k2.kopfLinks.zeilen[0].t, '**BÜRO**', 'BÜRO-Zeile bleibt');
  assert.equal(k2.kopfLinks.zeilen[1].t, 'BETREUER, Dr. · Rechtliche Betreuungen', 'Zeile mit Namensbaustein wird nicht ueberschrieben; Titel literal dort');
  assert.deepEqual(J(k2.kopfLinks.zeilen[2]), { t: 'Fachkraft', size: 8.5, color: 'grau', an: true }, 'Funktionszeile als neue Zeile');

  const k3 = s.__briefkopfEigenAnwenden(JSON.parse(JSON.stringify(std)), { name: '', titel: '', funktion: '' });
  assert.equal(k3.eigen, null);
  assert.deepEqual(J(k3.kopfLinks), J(std.kopfLinks), 'leere Abweichung aendert nichts');

  const mitTitel = JSON.parse(JSON.stringify(std)); mitTitel.kopfLinks.zeilen[0].t = '**BETREUER** (TITEL)';
  const k4 = s.__briefkopfEigenAnwenden(mitTitel, { titel: 'Dr.' });
  assert.equal(k4.kopfLinks.zeilen[0].t, '**BETREUER** (Dr.)', 'TITEL steht schon - nichts doppelt, nur literal ersetzt');
  assert.equal(s.__briefkopfZeile(k4.kopfLinks.zeilen[0].t, { eigen: k4.eigen }), '**Sabine Kraft** (Dr.)');
  assert.equal(s.__briefkopfWert('TITEL', { eigen: k4.eigen }), '', 'der Baustein TITEL kennt die Abweichung nicht mehr (Buerograd leer)');
  /* Behebung 06.09.: Zeilenmaximum 3 bleibt - tragen alle Zeilen Namensbausteine, findet die Funktionszeile keinen Platz */
  const voll = JSON.parse(JSON.stringify(std));
  voll.kopfLinks.zeilen = [{ t: '**BETREUER**', size: 11.5, color: 'ci', an: true }, { t: 'BÜRO', size: 8.5, color: 'grau', an: true }, { t: 'INHABER', size: 8.5, color: 'grau', an: true }];
  const k5 = s.__briefkopfEigenAnwenden(voll, { funktion: 'Fachkraft' });
  assert.equal(k5.kopfLinks.zeilen.length, 3, 'keine vierte Zeile');
  assert.deepEqual(k5.kopfLinks.zeilen.map(z => z.t), ['**BETREUER**', 'BÜRO', 'INHABER']);
  /* traegt KEINE Zeile einen Namensbaustein, darf auch Zeile 1 die Funktionszeile aufnehmen */
  const ohne = JSON.parse(JSON.stringify(std));
  ohne.kopfLinks.zeilen = [{ t: 'Rechtliche Betreuungen', size: 8.5, color: 'grau', an: true }];
  const k6 = s.__briefkopfEigenAnwenden(ohne, { funktion: 'Fachkraft' });
  assert.deepEqual(k6.kopfLinks.zeilen.map(z => z.t), ['Fachkraft']);
  /* Auszeichnungszeichen im Titel sind Text, keine Marken */
  const k7 = s.__briefkopfEigenAnwenden(JSON.parse(JSON.stringify(std)), { titel: 'Dipl.-Soz.*' });
  const runs7 = s.__briefkopfZeileRuns(k7.kopfLinks.zeilen[0].t, { eigen: k7.eigen });
  assert.equal(runs7.map(r => r.text).join(''), 'Sabine Kraft, Dipl.-Soz.*');
  assert.ok(runs7.every(r => r.bold && !r.italic), 'Sternchen im Titel wird nicht zu Kursiv');
});

/* ═══════════════════ 3b. Editor-Bedienung (ausgefuehrt aus der Auslieferung) ═══════════════════ */

test('Editor (ausgefuehrt): Chips kleben nicht an Marken, F/K/U ohne Auswahl haelt den Cursor', () => {
  const ed = html.slice(html.indexOf('/* ═══ BRIEFKOPF-EDITOR'), html.indexOf('/* ═══ BRIEFKOPF-EDITOR: ENDE ═══ */'));
  /* chipEinfuegen: die Zeile „const neu=vor+(…)+nach;“ wird als Funktion ausgefuehrt (Mockup Zeile 297 + Marken-Regel) */
  const chip = ed.match(/\n\s*(const neu=vor\+\(vor&&![^\n]*\+nach;)/);
  assert.ok(chip, 'Chip-Zeile fehlt');
  const chipFn = new Function('vor', 'tok', 'nach', chip[1] + 'return neu;');
  assert.equal(chipFn('**BETREUER**', 'TITEL', ''), '**BETREUER** TITEL', 'hinter einer schliessenden Marke kommt ein Leerzeichen');
  assert.equal(chipFn('', 'TELEFON', '**BETREUER**'), 'TELEFON **BETREUER**', 'vor einer oeffnenden Marke kommt ein Leerzeichen');
  assert.equal(chipFn('**', 'BÜRO', '**'), '**BÜRO**', 'zwischen den Marken kein Leerzeichen');
  assert.equal(chipFn('Tel. ', 'TELEFON', ''), 'Tel. TELEFON');
  assert.equal(chipFn('Tel.', 'TELEFON', ', Fax'), 'Tel. TELEFON, Fax');
  assert.equal(chipFn('Name **', 'TITEL', '** x'), 'Name **TITEL** x', 'oeffnende Marke nach Leerraum, schliessende vor Leerraum');
  assert.equal(chipFn('IBAN: ', 'IBAN', ''), 'IBAN: IBAN');
  assert.equal(chipFn('IBAN:', 'IBAN', ''), 'IBAN:IBAN', 'nach Doppelpunkt kein Leerzeichen (Mockup-Regel [\s(|:]$)');
  assert.equal(chipFn('(', 'TITEL', ')'), '(TITEL)');
  /* fmtAnwenden ohne Auswahl: ganze Zeile, Cursor bleibt an seiner Stelle (um die Marke verschoben) */
  const fmt = ed.match(/if\(a===e\)\{const war=re\.test\(v\);[^\n]*?\)\);\}/);
  assert.ok(fmt, 'F/K/U-Zeile fehlt');
  const fmtFn = new Function('a', 'e', 'v', 'm', 're', fmt[0] + ';return {a,e,v};');
  const re = m => new RegExp('^' + m.replace(/\*/g, '\\*') + '(.*)' + m.replace(/\*/g, '\\*') + '$');
  assert.deepEqual(fmtFn(5, 5, 'Rechtliche Betreuungen', '*', re('*')), { a: 6, e: 6, v: '*Rechtliche Betreuungen*' }, 'Marke gesetzt, Cursor eine Stelle weiter');
  assert.deepEqual(fmtFn(6, 6, '*Rechtliche Betreuungen*', '*', re('*')), { a: 5, e: 5, v: 'Rechtliche Betreuungen' }, 'Marke entfernt, Cursor zurueck');
  assert.deepEqual(fmtFn(0, 0, 'Name', '**', re('**')), { a: 2, e: 2, v: '**Name**' });
  assert.deepEqual(fmtFn(4, 4, 'Name', '__', re('__')), { a: 6, e: 6, v: '__Name__' }, 'am Zeilenende bleibt der Cursor vor der Schlussmarke');
  assert.ok(!/a=0;e=v\.length;/.test(ed), 'keine Vollauswahl mehr');
});

/* ═══════════════════ 4. Politur-Pins ═══════════════════ */

test('Buerostammdaten-Hinweise: Logo = App-Marke, Briefkopf ueber den Editor mit Sprunglink', () => {
  assert.ok(!html.includes('Wird dynamisch im Briefkopf der generierten Dokumente'), 'alter Hinweis muss weg sein');
  assert.ok(!html.includes('wirkt im Briefkopf am besten'), 'Logo-Hinweis darf den Briefkopf nicht mehr versprechen');
  assert.ok(!html.includes('erscheinen im Briefkopf hinter dem Namen'), 'Grad-Hinweis zeigt auf den Baustein TITEL');
  assert.ok(html.includes('Das Logo ist die App-Marke (Seitenleiste, Anmeldung) und wird nicht gedruckt.'));
  assert.ok(html.includes('onclick="return window.__briefkopfOeffnen?window.__briefkopfOeffnen():false">Einstellungen → Büro → Briefkopf</a>'));
  assert.equal((html.match(/Das Logo ist die App-Marke und wird nicht in den Briefkopf gedruckt/g) || []).length, 2, 'Online-Formular und Lokalvorgaben');
  assert.ok(html.includes('Baustein TITEL im Briefkopf'));
  const oeffnen = html.indexOf('window.__briefkopfOeffnen=function(){');
  assert.ok(oeffnen > 0);
  const quelle = html.slice(oeffnen, oeffnen + 600);
  assert.ok(quelle.includes("window.__einTabSpringe('letterhead')"), 'im offenen Menue umschalten');
  assert.ok(quelle.includes("window.openEinstellungenApp('briefkopf')"), 'sonst das Menue oeffnen');
});

test('Exportdialog: Briefkopf-Zeile mit Stand und Sprunglink nur bei Briefkopf-Ausgaben', () => {
  const a = html.indexOf('function exportBriefkopfZeile(){');
  assert.ok(a > 0);
  const q = html.slice(a, a + 900);
  assert.ok(q.includes("['letterhead','combined'].includes(activeExportMode)"));
  assert.ok(q.includes('window.__briefkopfStatus'));
  assert.ok(q.includes("closeModal();return window.__briefkopfOeffnen()"));
  assert.ok(q.includes("'Briefkopf gestalten':'Briefkopf ansehen'"), 'Wortwahl nach Recht');
  assert.ok(q.includes('window.__adSnapshotId'), 'Aussendienst ohne Menue: keine Zeile');
  assert.equal((html.match(/\$\{exportBriefkopfZeile\(\)\}/g) || []).length, 1, 'in der Zusammenfassung von renderExportDialog');
  assert.ok(html.includes("${esc(subject||'')}${typeof exportBriefkopfZeile==='function'?exportBriefkopfZeile():''}"), 'und in updateSummary() des v15721-Umbaus, der die Zusammenfassung neu schreibt');
});

test('Editor: Abschnitt „Meine Anpassung“, Buerovorgabe ohne Abweichung auf der Seite, Berichtsdruck-Seitenfuss fest', () => {
  const a = html.indexOf('/* ═══ BRIEFKOPF-EDITOR');
  const b = html.indexOf('/* ═══ BRIEFKOPF-EDITOR: ENDE ═══ */');
  assert.ok(a > 0 && b > a);
  const ed = html.slice(a, b);
  assert.ok(ed.includes('<span>Meine Anpassung</span><span class="set-reich set-reich-ich"'), 'Abschnitt mit Reichweiten-Marke Person');
  assert.ok(ed.includes('data-act="eigen-speichern">Für mich speichern</button>'));
  assert.ok(ed.includes('data-act="eigen-loeschen"'));
  assert.ok(ed.includes("if(d.act==='eigen-speichern'){eigenSpeichern(b,false);return}"));
  assert.ok(ed.indexOf("if(d.act==='eigen-speichern')") < ed.indexOf('if(S.readOnly)return;\n    if(d.fmt)'), 'auch in der Nur-Lese-Ansicht bedienbar');
  assert.ok(ed.includes('marke:true,eigen:null}'), 'die Seite zeigt die Buerovorgabe ohne persoenliche Abweichung');
  assert.ok(ed.includes('W.__briefkopfEigenAnwenden(k,eigenEntwurf())'), 'Vorschau ueber dieselbe Funktion wie die Zeichner');
  assert.ok(ed.includes('Das Büro erlaubt keine eigenen Anpassungen am Briefkopf'));
  assert.ok(ed.includes('class="bk-bericht-fuss"'), 'Berichtsdruck: fester Seitenfuss statt Kartenfusszeile');
  assert.ok(ed.includes('Im Berichtsdruck bleibt der Seitenfuß fest'));
  assert.ok(ed.includes('<em>Kursiv</em> nutzt den eingebetteten Schnitt Oblique.'), 'Hilfetext nennt den eingebetteten Schnitt (Behebung 06.09.)');
  assert.ok(!ed.includes('wird der Schnitt Oblique ergänzt'));
  assert.ok(ed.includes('function seitenKarte(){return Object.assign({},S.bk,{gepflegt:!!(S.dirty||gepflegt())})}'), 'Seite und PDF-Vorschau tragen den Stand „Standard gilt“ in den Resolver');
  assert.ok(ed.includes('karte:seitenKarte(),marke:true,eigen:null}'));
  assert.ok(ed.includes('const karte=norm(S.bk);karte.gepflegt=!!(S.dirty||gepflegt());'), 'Vorschau als PDF ebenso');
  assert.ok(ed.includes("px(842-(565+13*(Math.max(1,infZeilen)-1))-6)"), 'Infoblock von unten verankert wie im PDF');
  assert.ok(ed.includes("top:'+px(842-kopfKante()-4)"), 'Absenderzeile folgt der Kopfkante');
  assert.ok(ed.includes('842-folgeKante()'), 'Folgeseite: Inhaltsbeginn wie bkFolgeKopf');
  /* tote Rueckfaelle des Musterbriefs sind weg */
  assert.ok(!ed.includes('phase3DrawLetterFooter'), 'Musterbrief zeichnet nur noch ueber die P3-Fusszeile');
  assert.ok(!ed.includes("typeof W.__unifiedLetterSenderLine==='function'"), 'keine Kopie der Absenderzeile mehr');
  assert.ok(html.includes('.bk-eigen{border:1px solid var(--line)'), 'CSS hell');
  assert.ok(html.includes('#modal:has(.set-app) .set-inhalt .bk-eigen{'), 'CSS dunkel');
});

test('keine Platzhaltertexte mehr: „folgt in Paket P2“, „erst in P3“', () => {
  assert.ok(!html.includes('folgt in Paket P2'));
  assert.ok(!html.includes('werden erst in P3'));
  assert.ok(html.includes('ist in dieser Auslieferung nicht geladen.</p>'), 'Rueckfalltext ohne Editor-Block');
});
