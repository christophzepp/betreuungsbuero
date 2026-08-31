'use strict';
/*
 * Vertragspruefstand "Controlling" (25.08.2026) - Server UND Client in einer Datei, weil der
 * Vertrag genau an der Naht zwischen beiden haengt: der Server nennt vier Dimensionen, der
 * Client multipliziert sie mit REM_RATES. Faellt eine Seite um, wird die andere still falsch.
 *
 * Festgenagelt werden die Zusagen, die man einer Zahl nicht ansieht:
 *   1. viewControlling ist ein eigenes Recht mit default AUS - Finanz- und Fallrecht ersetzen es nicht.
 *   2. Jede Sitzungsaufbau-Stelle traegt canViewControlling mit (auch die Auffrisch-Tabelle).
 *   3. Die Route ist damit geschuetzt, filtert ueber sichtbareFaelle, meldet vollstaendig/gesamt -
 *      und rechnet KEINE Euro (keine VBVG-Saetze, kein volles stammdaten_json).
 *   4. Die drei Stammdatenfelder stehen im Modell und in beiden Maskengenerationen, und ihr
 *      Wertevorrat ist derselbe wie im Verguetungsantrag und in REM_RATES.
 *   5. Die Ableitung des Verguetungsprofils ist DOM-frei (sie bewertet FREMDE, nie geladene Faelle)
 *      und kennzeichnet, ob die Werte aus dem Fall oder aus dem Antrag stammen.
 *   6. Eine fehlende Angabe wird getrennt gezaehlt und NIE als 0 mitaddiert.
 *   7. Eine unvollstaendige Auswertung sagt das ueber ihrer ersten Zahl.
 *
 * Vorgehen wie in verguetung-pipeline.test.cjs / html-formulareditor.test.cjs: Client-Code wird
 * im vm AUSGEFUEHRT statt gegrept. Wo Namen noetig sind, werden sie aus dem Quelltext ERMITTELT
 * (letzte Funktionsdeklaration vor der Fundstelle) - in der letzten Runde sind fest verdrahtete
 * Funktionsnamen beim Umbenennen rot geworden, ohne dass etwas kaputt war. Nur die Schnittmarken
 * der Extraktion sind Textanker; scheitert eine davon, sagt die Meldung "nicht extrahierbar".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

/* Fixture-Umgebung VOR jedem require eines Servermoduls setzen - database/index.js legt seine
   Datei beim Laden an und wuerde sonst die echte Datenbank anfassen. */
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'controlling-vertrag-'));
process.env.DB_PATH = path.join(TEMP, 'fixture.sqlite3');
process.env.DOCUMENTS_DATA_ROOT = path.join(TEMP, 'data');
process.env.SESSION_SECRET = 'controlling-vertrag-test-secret-mit-genug-entropie';
process.env.ENCRYPTION_KEY = '22'.repeat(32);
fs.mkdirSync(process.env.DOCUMENTS_DATA_ROOT, { recursive: true });

const SERVER = path.join(__dirname, '..');
const HTML_PFAD = path.join(SERVER, '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(HTML_PFAD, 'utf8');
const lies = (...teile) => fs.readFileSync(path.join(SERVER, ...teile), 'utf8');

/* ───────── Werkzeug ───────── */

/* Schnitt zwischen zwei eindeutigen Textmarken. Eindeutigkeit wird geprueft, damit ein spaeterer
   zweiter Treffer nicht stillschweigend eine falsche Region ausschneidet. */
function bereich(start, ende, name) {
  const a = html.indexOf(start);
  assert.ok(a >= 0, `${name}: Startmarke nicht gefunden - nicht extrahierbar`);
  assert.equal(html.indexOf(start, a + 1), -1, `${name}: Startmarke nicht eindeutig`);
  const b = html.indexOf(ende, a + start.length);
  assert.ok(b > a, `${name}: Endmarke nicht gefunden - nicht extrahierbar`);
  return html.slice(a, b);
}

/* Name der Funktion, in der eine Fundstelle liegt: die letzte Deklaration davor. So bleiben die
   Pruefungen an das VERHALTEN gebunden ("die Funktion, die den Warnhinweis erzeugt") statt an
   einen Bezeichner, der sich jederzeit aendern darf. */
function funktionUm(code, marke, was) {
  const i = code.indexOf(marke);
  assert.ok(i > 0, `${was}: Fundstelle "${marke}" fehlt`);
  const treffer = [...code.slice(0, i).matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)];
  assert.ok(treffer.length, `${was}: keine umschliessende Funktion gefunden`);
  return treffer[treffer.length - 1][1];
}

/* Werte aus einem vm-Kontext tragen die Prototypen IHRES Realms - deepStrictEqual vergleicht die
   mit und meldet sonst "same structure but not reference-equal". Deshalb alles, was aus der
   Auslieferung zurueckkommt, vor dem Vergleich in gewoehnliche Werte dieses Prozesses uebersetzen. */
const klar = (wert) => JSON.parse(JSON.stringify(wert));

/* Ein Objekt-/Array-Literal aus der HTML-Datei auswerten, statt es im Test zu wiederholen.
   Grund: jede Kopie einer Werteliste ist eine zweite Wahrheit, die auseinanderlaufen kann. */
function literalNach(marke, was) {
  const i = html.indexOf(marke);
  assert.ok(i >= 0, `${was}: "${marke}" fehlt`);
  const start = i + marke.length;
  const oeffner = html[start];
  assert.ok(oeffner === '{' || oeffner === '[', `${was}: hinter der Marke steht kein Literal`);
  const schliesser = oeffner === '{' ? '}' : ']';
  let tiefe = 0;
  for (let k = start; k < start + 200000; k++) {
    if (html[k] === oeffner) tiefe++;
    else if (html[k] === schliesser && --tiefe === 0) {
      return klar(vm.runInNewContext('(' + html.slice(start, k + 1) + ')'));
    }
  }
  assert.fail(`${was}: Literal nicht abgeschlossen`);
}

/* Alle .js-Dateien unter server/src - der Rechte-Scan soll auch Stellen finden, die es heute
   noch gar nicht gibt. */
function jsDateien(wurzel) {
  const out = [];
  for (const eintrag of fs.readdirSync(wurzel, { withFileTypes: true })) {
    const p = path.join(wurzel, eintrag.name);
    if (eintrag.isDirectory()) out.push(...jsDateien(p));
    else if (eintrag.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/* Kommentare weg: die Route DARF ueber Euro reden ("liefert bewusst keine"), sie darf nur nicht
   damit rechnen. Ohne diesen Schnitt wuerde der erklaerende Kopfkommentar den Test ausloesen. */
const ohneKommentare = (quelle) => quelle
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/* Die Satztabelle wird aus der Auslieferung gelesen, nicht abgeschrieben. */
const REM_RATES = literalNach('const REM_RATES=', 'REM_RATES');
const dimensionen = (i) => [...new Set(Object.keys(REM_RATES).map((k) => k.split('|')[i]))].sort();

/* ───────── 1. Das Recht selbst ───────── */

test('Recht: viewControlling steht im Katalog, default AUS, Admin geht vorbei', () => {
  const { PERMISSION_DEFS, PERMISSION_KEYS, parseUserPermissions, serializePermissions, hasPermission } =
    require('../src/middleware/authorization');

  assert.ok(PERMISSION_DEFS.viewControlling, 'viewControlling fehlt im Rechtekatalog');
  assert.equal(PERMISSION_DEFS.viewControlling.default, false,
    'viewControlling muss ein ausdruecklich zu vergebendes Recht bleiben');
  assert.equal(PERMISSION_DEFS.viewControlling.legacy, null,
    'viewControlling ist neu und darf keine Altspalte als Rueckfall haben');
  assert.ok(PERMISSION_KEYS.includes('viewControlling'), 'Recht wird nicht mitgespeichert/ausgeliefert');

  /* Bestandsnutzer ohne permissions_json duerfen das Recht nicht geschenkt bekommen. */
  const altnutzer = { is_admin: 0, can_view_cases: 1, can_view_finance: 1 };
  assert.equal(parseUserPermissions(altnutzer).online.viewControlling, false,
    'ein Bestandsnutzer erbt das Controlling-Recht - default greift nicht');
  assert.equal(parseUserPermissions(altnutzer).local.viewControlling, false);

  /* Neuanlage aus dem Admin-Formular: was nicht angehakt ist, bleibt aus. */
  const frisch = JSON.parse(serializePermissions({ local: {}, online: { viewFinance: true, viewAllCases: true } }, null));
  assert.equal(frisch.online.viewControlling, false,
    'Finanz- und Fallrecht duerfen das Controlling-Recht nicht mitbringen');

  /* Die im Vertrag zugesagte Admin-Umgehung. */
  assert.equal(hasPermission({ is_admin: 1 }, 'online', 'viewControlling'), true, 'Admin sieht den Reiter nicht');
  assert.equal(hasPermission({ is_admin: 0, permissions_json: JSON.stringify({ online: {}, local: {} }) }, 'online', 'viewControlling'), false);
});

/* ───────── 2. Sitzungsaufbau ───────── */

test('Sitzung: keine Aufbau-Stelle darf canViewControlling vergessen', () => {
  /* Statt drei Zeilennummern zu pinnen wird die REGEL geprueft: wo eine Sitzung (oder das an den
     Client gehende Nutzerobjekt) ein Finanzflag aus der Rechtematrix ableitet, muss das
     Controlling-Flag daneben stehen. Eine kuenftige fuenfte Stelle faellt damit von selbst auf.
     Reine Lesestellen (`session.canViewFinance` als Torwaechter) haben kein `!!` und bleiben
     ausserhalb - sie bauen keine Sitzung auf. */
  const ableitung = [];
  const tabellen = [];
  for (const datei of jsDateien(path.join(SERVER, 'src'))) {
    const quelle = fs.readFileSync(datei, 'utf8');
    const kurz = path.relative(SERVER, datei);
    for (const m of quelle.matchAll(/canViewFinance\s*[:=]\s*!!/g)) {
      const fenster = quelle.slice(Math.max(0, m.index - 900), m.index + 900);
      ableitung.push({ kurz, ok: /canViewControlling\s*[:=]\s*!!/.test(fenster) });
    }
    /* Die Auffrisch-Tabelle (Flag -> Rechtsschluessel) hat kein `!!`. Sie wird an einem Recht
       derselben Generation erkannt: initiatePayments steht in ihr, in der Alt-UI-Tabelle nicht. */
    for (const m of quelle.matchAll(/canInitiatePayments\s*:\s*'initiatePayments'/g)) {
      const fenster = quelle.slice(Math.max(0, m.index - 1600), m.index + 1600);
      tabellen.push({ kurz, ok: /canViewControlling\s*:\s*'viewControlling'/.test(fenster) });
    }
  }

  assert.ok(ableitung.length >= 4,
    `nur ${ableitung.length} Sitzungsaufbau-Stellen gefunden - der Scan greift nicht mehr`);
  assert.deepEqual(ableitung.filter((s) => !s.ok).map((s) => s.kurz), [],
    'diese Stellen bauen eine Sitzung ohne canViewControlling auf');

  assert.ok(tabellen.length >= 1, 'die Sitzungs-Auffrischtabelle wurde nicht gefunden');
  assert.deepEqual(tabellen.filter((s) => !s.ok).map((s) => s.kurz), [],
    'eine aufgefrischte Sitzung verliert das Controlling-Flag und bekommt 403');

  /* Der Torwaechter haengt am eigenen Flag, nicht am Finanzflag. */
  const wache = ohneKommentare(lies('src', 'middleware', 'authentication.js'));
  assert.match(wache, /requireViewControlling\s*=\s*requirePermission\('canViewControlling'/,
    'requireViewControlling prueft nicht das eigene Sitzungsflag');
  assert.match(wache, /module\.exports[\s\S]*requireViewControlling/, 'requireViewControlling wird nicht exportiert');
});

/* ───────── 3. Die Route als Quelltext: kein zweites Zahlenwerk ───────── */

test('Route: geschuetzt, sichtbarkeitsgefiltert - und ohne jede Euro-Rechnung', () => {
  const roh = lies('src', 'modules', 'controlling', 'routes.js');
  const code = ohneKommentare(roh);

  assert.match(code, /router\.get\(\s*'\/'\s*,\s*requireViewControlling/, 'die Route haengt nicht am eigenen Recht');
  assert.match(code, /requireAuth/, 'die Route ist nicht angemeldungspflichtig');
  assert.match(code, /sichtbareFaelle\s*\(/, 'die Route filtert nicht ueber die gemeinsame Fallsichtbarkeit');
  assert.match(code, /require\('\.\.\/cases\/case-visibility'\)/,
    'die Fallsichtbarkeit wird nicht aus dem gemeinsamen Modul geholt - eine eigene Kopie waere ein Leck');

  /* Kein Euro. Die verbotenen Zahlen kommen aus der ausgelieferten Satztabelle selbst, damit
     eine kuenftige VBVG-Anpassung diesen Test nicht veralten laesst. */
  assert.doesNotMatch(code, /REM_RATES|__remRates/, 'die Satztabelle wurde in den Server gedoppelt');
  for (const satz of [...new Set(Object.values(REM_RATES))]) {
    assert.doesNotMatch(code, new RegExp(`(^|[^\\d.])${satz}([^\\d]|$)`),
      `der VBVG-Satz ${satz} steht im Servercode - der Server darf keine Betraege kennen`);
  }
  for (const wort of [/€/, /\bEUR\b/i, /\beuro\b/i, /\bbetrag/i, /\bsumme\b/i]) {
    assert.doesNotMatch(code, wort, `die Route redet in Geld (${wort}) statt in Dimensionen`);
  }

  /* Kein volles stammdaten_json: jede Erwaehnung muss in einem json_extract stecken. */
  const alle = (code.match(/stammdaten_json/g) || []).length;
  const gezielt = (code.match(/json_extract\(\s*c\.stammdaten_json/g) || []).length;
  assert.ok(alle > 0, 'die Route liest gar keine Stammdaten mehr');
  assert.equal(alle, gezielt, 'stammdaten_json wird irgendwo ungefiltert angefasst');

  /* Und sie muss ueberhaupt haengen. */
  const index = lies('index.js');
  assert.match(index, /app\.use\(\s*'\/api\/controlling'/, 'die Route ist nicht eingehaengt');
});

/* ───────── 4. Die Route im Betrieb ───────── */

test('Route im Betrieb: Recht, Sichtbarkeit, Vertragsfelder', async (t) => {
  const express = require('express');
  const bcrypt = require('bcrypt');
  const db = require('../src/database/index');
  const { serializePermissions } = require('../src/middleware/authorization');
  const { createSessionMiddleware, requireOnlineMode } = require('../src/middleware/authentication');
  const authRoutes = require('../src/modules/auth/routes');
  const controllingRoutes = require('../src/modules/controlling/routes');

  let server;
  t.after(async () => {
    if (server) await new Promise((r) => server.close(r));
    db.close();
    fs.rmSync(TEMP, { recursive: true, force: true });
  });

  const hash = await bcrypt.hash('vertrag', 4);
  const nutzer = db.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, allow_local, allow_online, is_admin, permissions_json)
    VALUES (@id, @username, @hash, @name, 1, 1, @admin, @rechte)
  `);
  const rechte = (o) => serializePermissions({ local: {}, online: { viewAllCases: false, viewControlling: false, ...o } }, null);
  nutzer.run({ id: 1, username: 'chefin', hash, name: 'Chefin', admin: 1, rechte: rechte({}) });
  nutzer.run({ id: 2, username: 'controllerin', hash, name: 'Controllerin', admin: 0, rechte: rechte({ viewControlling: true }) });
  nutzer.run({ id: 3, username: 'finanzen', hash, name: 'Finanzen', admin: 0, rechte: rechte({ viewFinance: true, viewCases: true, viewAllCases: true }) });

  /* GEHEIM markiert Stammdaten, die der Reiter nie braucht - taucht das Wort in der Antwort auf,
     liefert die Route mehr aus, als der Vertrag erlaubt. */
  const fall = db.prepare(`
    INSERT INTO cases (id, label, file_number, stammdaten_json, owner_user_id, created_by, stammdaten_updated_by, archived)
    VALUES (@id, @label, @az, @json, @owner, @owner, @owner, @archiv)
  `);
  fall.run({
    id: 'f-eigen', label: 'Muster, Martha', az: '17 XVII 42/26', owner: 2, archiv: 0,
    json: JSON.stringify({
      person: { firstName: 'Martha', lastName: 'Muster' },
      rechtlicherBetreuer: 'anna',
      care: { startDate: '01.02.2026', endDate: '', endReason: '', remStage: '2', assetStatus: 'M', housingCategory: 'A' },
      health: { diagnose: 'GEHEIM-Diagnose' },
      banks: [{ iban: 'GEHEIM-IBAN' }]
    })
  });
  fall.run({
    id: 'f-fremd', label: 'Fremd, Frieda', az: '17 XVII 45/26', owner: 3, archiv: 0,
    json: JSON.stringify({
      rechtlicherBetreuer: { name: 'Bernd Bestand' },
      care: { startDate: '5.3.2019', remStage: '7', assetStatus: 'nm', housingCategory: 'S' }
    })
  });
  fall.run({
    id: 'f-archiv', label: 'Alt, Anton', az: '17 XVII 09/24', owner: 2, archiv: 1,
    json: JSON.stringify({ care: { startDate: '01.01.2024', endDate: '31.12.2025', endReason: 'Tod der betreuten Person' } })
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(createSessionMiddleware());
  app.use('/api', authRoutes);
  app.use('/api', requireOnlineMode);
  app.use('/api/controlling', controllingRoutes);
  server = await new Promise((ok, fehler) => {
    const s = app.listen(0, '127.0.0.1', () => ok(s));
    s.once('error', fehler);
  });
  const basis = `http://127.0.0.1:${server.address().port}`;

  async function hole(pfad, keks) {
    const antwort = await fetch(basis + pfad, { headers: keks ? { cookie: keks } : {} });
    const text = await antwort.text();
    let daten = null;
    try { daten = text ? JSON.parse(text) : null; } catch (_e) { daten = text; }
    return { status: antwort.status, daten, text };
  }
  async function anmelden(username) {
    const antwort = await fetch(basis + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'vertrag', mode: 'online' })
    });
    assert.equal(antwort.status, 200, `Anmeldung ${username} fehlgeschlagen`);
    return { keks: antwort.headers.get('set-cookie').split(';', 1)[0], user: (await antwort.json()).user };
  }

  await t.test('ohne Anmeldung 401', async () => {
    assert.equal((await hole('/api/controlling', '')).status, 401);
  });

  await t.test('Finanz- und Fallrecht ersetzen das Controlling-Recht nicht', async () => {
    const { keks, user } = await anmelden('finanzen');
    assert.equal(user.canViewControlling, false, 'die Anmeldung meldet das Flag nicht ausdruecklich als false');
    assert.equal(user.canViewFinance, true, 'Kontrollprobe: der Nutzer hat sehr wohl Finanzrechte');
    const { status, daten } = await hole('/api/controlling', keks);
    assert.equal(status, 403, 'wer nur Finanzen und alle Faelle sehen darf, kommt trotzdem ins Controlling');
    assert.match(String(daten.error), /Controlling/);
  });

  await t.test('Admin kommt ohne Zuteilung durch, Vertragsfelder stimmen', async () => {
    const { keks, user } = await anmelden('chefin');
    assert.equal(user.canViewControlling, true, 'Admins umgehen jedes Recht');
    const { status, daten } = await hole('/api/controlling', keks);
    assert.equal(status, 200);

    const heute = new Date();
    const zwei = (n) => String(n).padStart(2, '0');
    assert.equal(daten.stand, `${heute.getFullYear()}-${zwei(heute.getMonth() + 1)}-${zwei(heute.getDate())}`,
      'der Stand ist nicht das heutige ORTSdatum (toISOString datiert abends auf gestern)');
    assert.equal(daten.vollstaendig, true);
    assert.equal(daten.gesamt, 2, 'Standardbereich sind die aktiven Faelle');
    assert.equal(daten.faelle.length, 2);

    const eigen = daten.faelle.find((f) => f.caseId === 'f-eigen');
    /* Zwoelftes Feld seit dem Nachtrag vom 25.08.2026: `quelle` sagt, ob die drei
       Verguetungsangaben aus den Stammdaten stammen ('fall') oder aus dem letzten
       Verguetungsantrag zurueckgelesen wurden ('antrag'). Ohne diesen Rueckfall waere die
       Auswertung am ersten Tag leer - ohne die Herkunftsangabe waere sie unehrlich. */
    assert.deepEqual(Object.keys(eigen).sort(), [
      'archived', 'assetStatus', 'betreuer', 'caseId', 'endDate', 'endReason',
      'fileNumber', 'housingCategory', 'label', 'quelle', 'remStage', 'startDate'
    ], 'die Zeile weicht von den zwoelf Vertragsfeldern ab');
    assert.deepEqual(eigen, {
      caseId: 'f-eigen', label: 'Muster, Martha', fileNumber: '17 XVII 42/26', archived: false,
      betreuer: 'anna', startDate: '01.02.2026', endDate: '', endReason: '',
      remStage: '2', assetStatus: 'M', housingCategory: 'A', quelle: 'fall'
    });

    /* Kein Durchreichen der Fallakte und kein Euro in der Antwort. */
    const roh = JSON.stringify(daten);
    assert.doesNotMatch(roh, /GEHEIM/, 'die Route liefert Stammdaten aus, die der Reiter nie braucht');
    for (const satz of [...new Set(Object.values(REM_RATES))]) {
      assert.doesNotMatch(roh, new RegExp(`[:\\s,\\[]${satz}[,\\]\\s}]`), `Betrag ${satz} in der Antwort`);
    }

    /* Unbekannte Werte werden zu '' statt still in REM_RATES danebenzugreifen. */
    const fremd = daten.faelle.find((f) => f.caseId === 'f-fremd');
    assert.equal(fremd.remStage, '', "'7' ist keine Verguetungsstufe und darf nicht durchgereicht werden");
    assert.equal(fremd.assetStatus, 'NM', 'Kleinschreibung aus Altdaten wird auf den Antragswert normalisiert');
    assert.equal(fremd.housingCategory, 'S');
    assert.equal(fremd.betreuer, 'Bernd Bestand', 'Altbestand mit Objekt statt Personen-Key wird nicht aufgeloest');
    assert.equal(fremd.startDate, '5.3.2019', 'das Datum wird veraendert - der Server hat keine zweite Datumswahrheit');
  });

  await t.test('Fallsichtbarkeit greift und die Antwort gibt es zu', async () => {
    const { keks } = await anmelden('controllerin');
    const { status, daten } = await hole('/api/controlling', keks);
    assert.equal(status, 200);
    assert.deepEqual(daten.faelle.map((f) => f.caseId), ['f-eigen'], 'ein fremder Fall ist sichtbar');
    assert.equal(daten.gesamt, 2, 'gesamt muss VOR der Sichtbarkeitsfilterung zaehlen');
    assert.equal(daten.vollstaendig, false, 'eine gefilterte Auswertung gibt sich nicht als unvollstaendig zu erkennen');
  });

  await t.test('scope: active ist Standard, archived/all vorhanden, Unsinn faellt zurueck', async () => {
    const { keks } = await anmelden('chefin');
    const archiv = await hole('/api/controlling?scope=archived', keks);
    assert.deepEqual(archiv.daten.faelle.map((f) => f.caseId), ['f-archiv']);
    assert.equal(archiv.daten.faelle[0].archived, true);
    assert.equal(archiv.daten.faelle[0].endReason, 'Tod der betreuten Person');
    assert.equal((await hole('/api/controlling?scope=all', keks)).daten.gesamt, 3);
    assert.equal((await hole('/api/controlling?scope=quatsch', keks)).daten.gesamt, 2,
      'ein Tippfehler im Bereich darf keine leere Auswertung erzeugen');
  });
});

/* ───────── 5. Stammdatenfelder: Modell, Maske, Wertevorrat ───────── */

test('Stammdaten: die drei Verguetungsfelder stehen im Modell und in beiden Masken', () => {
  const felder = ['remStage', 'assetStatus', 'housingCategory'];

  /* Modell: der Vorgabe-Fall bringt die Felder mit, sonst gaebe es sie erst nach dem ersten
     Speichern und die Auswertung zaehlte Neuanlagen als Luecke. */
  const m = /caseData:\{person:\{\},care:\{([^}]*)\}/.exec(html);
  assert.ok(m, 'der Vorgabe-Fall (newState) ist nicht auffindbar');
  for (const f of felder) {
    assert.match(m[1], new RegExp(`${f}\\s*:\\s*''`), `${f} fehlt im Vorgabe-Fall`);
  }

  /* Maske: die Stammdatenmaske existiert in zwei Generationen (klassische Feldliste und
     v156-Raster). Beide muessen die Felder anbieten - sonst haengt es davon ab, welche Ansicht
     der Nutzer gerade offen hat, ob er die Angabe ueberhaupt pflegen kann. */
  for (const f of felder) {
    const pfad = `care\\.${f}`;
    assert.match(html, new RegExp(`\\['${pfad}',\\s*'[^']+'\\]`), `care.${f} fehlt in der klassischen Feldliste`);
    assert.match(html, new RegExp(`\\('${pfad}',\\s*'[^']+'\\)`), `care.${f} fehlt im v156-Raster`);
  }
});

test('Wertevorrat: Maske, Verguetungsantrag und REM_RATES sagen dasselbe', () => {
  const auswahl = literalNach('window.__careVerguetungsAuswahl=', 'Auswahllisten der Maske');
  const codes = (pfad) => auswahl[pfad].map((o) => o[0]).filter((v) => v !== '');

  /* Der Vertrag nennt die Codes ausdruecklich - sie sind die Sprache, in der Antrag, Stammdaten
     und Controlling miteinander reden. Wuerde hier uebersetzt, entstuende genau die zweite
     Wahrheit, die der Umbau beseitigen sollte. */
  assert.deepEqual(codes('care.remStage'), ['1', '2']);
  assert.deepEqual(codes('care.assetStatus'), ['M', 'NM']);
  assert.deepEqual(codes('care.housingCategory'), ['S', 'A']);

  /* Gegenprobe 1: der Verguetungsantrag. Stufe steht in der Felddefinition, Vermoegensstatus und
     Wohnform in den Auswahlfeldern der Abrechnungstabelle. */
  const stufe = /\{id:'rem_stage',[^}]*options:\[([^\]]*)\]/.exec(html);
  assert.ok(stufe, 'die Stufenauswahl des Antrags ist nicht auffindbar');
  const antragStufen = klar(vm.runInNewContext('[' + stufe[1] + ']')).filter((v) => v !== '');
  assert.deepEqual(antragStufen, codes('care.remStage'), 'Stammdatenfeld und Antrag kennen verschiedene Stufen');

  const tabelle = bereich('function renderRemunerationTable(', '\nfunction money(', 'Abrechnungstabelle');
  const spalte = (name) => {
    const s = new RegExp(`data-col="${name}">([\\s\\S]*?)</select>`).exec(tabelle);
    assert.ok(s, `Spalte ${name} der Abrechnungstabelle nicht auffindbar`);
    return [...s[1].matchAll(/<option value="([^"]*)"/g)].map((x) => x[1]).filter((v) => v !== '');
  };
  assert.deepEqual(spalte('status'), codes('care.assetStatus'), 'Vermoegensstatus weicht vom Antrag ab');
  assert.deepEqual(spalte('housing'), codes('care.housingCategory'), 'Wohnform weicht vom Antrag ab');

  /* Gegenprobe 2: die Satztabelle. Ein Wert, den REM_RATES nicht kennt, waere eine Auswahl, die
     im Controlling zwangslaeufig "nicht berechenbar" ergibt. */
  assert.deepEqual(codes('care.remStage').slice().sort(), dimensionen(0));
  assert.deepEqual(codes('care.assetStatus').slice().sort(), dimensionen(1));
  assert.deepEqual(codes('care.housingCategory').slice().sort(), dimensionen(2));

  /* Und die Maske muss eine AUSWAHL zeichnen: Freitext liesse die Satzsuche still ins Leere laufen. */
  const maske = bereich('function caseReviewAuswahlHTML(', '\n/* ===== Passfoto der betreuten Person', 'Maskenfeld');
  const kontext = {
    window: { __careVerguetungsAuswahl: auswahl },
    valueAt: () => '',
    caseReviewPlaceholder: () => '',
    esc: (s) => String(s),
    escAttr: (s) => String(s)
  };
  vm.createContext(kontext);
  const zeichne = vm.runInContext(
    `(function(){${maske}\nreturn ${funktionUm(maske, 'window.__careVerguetungsAuswahl||{})[path])return', 'Maskenfeld')};})()`,
    kontext, { filename: 'stammdaten-maske.js' });

  for (const [pfad, liste] of Object.entries(auswahl)) {
    const feld = zeichne(pfad, 'Beschriftung');
    assert.match(feld, new RegExp(`<select[^>]*data-casepath="${pfad.replace('.', '\\.')}"`),
      `${pfad} wird in der Maske nicht als Auswahl gezeichnet`);
    assert.deepEqual([...feld.matchAll(/<option value="([^"]*)"/g)].map((x) => x[1]), liste.map((o) => o[0]),
      `${pfad} bietet in der Maske andere Werte an als die Liste`);
    assert.match(feld, /<option value=""/, `${pfad} laesst sich nicht wieder leeren`);
  }
});

/* ───────── 6. Die Ableitung des Verguetungsprofils ───────── */

/* Die Funktion bewertet FREMDE Fallakten, die nie geladen sind - sie darf deshalb weder `state`
   noch das DOM anfassen. Beides wird hier zu einer Falle: jeder Zugriff wird protokolliert.
   Ein blosses Wegwerfen (die Funktion faengt alles ab) wuerde sonst unbemerkt bleiben. */
function profilLaden() {
  const i = html.indexOf("quelle:'antrag'");
  assert.ok(i > 0, 'die Ableitung des Verguetungsprofils ist nicht auffindbar');
  assert.equal(html.indexOf("quelle:'antrag'", i + 1), -1, 'mehrere Kandidaten fuer die Ableitung');
  const start = html.lastIndexOf('\nwindow.', i);
  assert.ok(start > 0, 'die Ableitung ist nicht global exportiert');
  const name = /^\nwindow\.([\w$]+)\s*=\s*function/.exec(html.slice(start, start + 120));
  assert.ok(name, 'die Ableitung ist keine benannte globale Funktion - nicht extrahierbar');
  const ende = html.indexOf('\n};', i);
  assert.ok(ende > i, 'das Ende der Ableitung ist nicht auffindbar');
  const code = html.slice(start + 1, ende + 3);

  const zugriffe = [];
  const kontext = { window: {} };
  for (const verboten of ['document', 'state', 'localStorage', 'fetch', 'alert', 'currentReport']) {
    Object.defineProperty(kontext, verboten, {
      get() { zugriffe.push(verboten); throw new Error(verboten + ' ist hier nicht erlaubt'); },
      configurable: true
    });
  }
  vm.createContext(kontext);
  vm.runInContext(code, kontext, { filename: 'verguetungsprofil.js' });
  const fn = kontext.window[name[1]];
  assert.equal(typeof fn, 'function', 'die Ableitung wurde nicht exportiert');
  return { profil: fn, zugriffe, code };
}

test('Verguetungsprofil: Fall schlaegt Antrag, Antrag wird gekennzeichnet, nichts wird geraten', () => {
  const { profil: roh, zugriffe, code } = profilLaden();
  const profil = (fall, berichte) => klar(roh(fall, berichte));

  const antrag = (stufe, zeilen) => ({ remuneration: { fields: { rem_stage: { value: stufe }, rem_sections: { value: zeilen } } } });

  /* Nur der Antrag hat Werte -> quelle 'antrag'. Das ist die Zusage, an der der Reiter haengt:
     Altfaelle ohne gepflegte Stammdaten sollen trotzdem zaehlen, aber erkennbar bleiben. */
  const nurAntrag = profil({}, antrag('2', [
    { from: '01.01.2025', status: 'M', housing: 'S' },
    { from: '01.07.2025', status: 'NM', housing: 'A' }
  ]));
  assert.equal(nurAntrag.quelle, 'antrag');
  assert.equal(nurAntrag.remStage, '2');
  assert.equal(nurAntrag.assetStatus, 'NM', 'es muss die LETZTE befuellte Abrechnungszeile gelten');
  assert.equal(nurAntrag.housingCategory, 'A');

  /* Gepflegte Stammdaten haben Vorrang - und zwar alles-oder-nichts. */
  const ausFall = profil({ care: { remStage: '1', assetStatus: 'm', housingCategory: 'a' } }, antrag('2', [{ status: 'NM', housing: 'S' }]));
  assert.equal(ausFall.quelle, 'fall');
  assert.deepEqual([ausFall.remStage, ausFall.assetStatus, ausFall.housingCategory], ['1', 'M', 'A'],
    'Kleinschreibung aus Altdaten wird nicht auf die Antragscodes normalisiert');

  const halberFall = profil({ care: { remStage: '2' } }, antrag('1', [{ status: 'NM', housing: 'S' }]));
  assert.equal(halberFall.quelle, 'fall', 'ein gepflegtes Fallfeld muss den ganzen Datensatz auf den Fall stellen');
  assert.equal(halberFall.assetStatus, '',
    'die Luecke wird aus dem Antrag nachgefuellt und trotzdem als "aus dem Fall" ausgegeben');

  /* Gar nichts da: leer, aber mit allen Schluesseln - der Reiter zaehlt daraus eine Luecke. */
  const leer = profil({}, {});
  assert.deepEqual(leer, { remStage: '', assetStatus: '', housingCategory: '', quelle: '' });

  /* Unsinn wird nicht geraten. */
  const unsinn = profil({ care: { remStage: '3', assetStatus: 'X', housingCategory: 'Q' } }, {});
  assert.deepEqual(unsinn, { remStage: '', assetStatus: '', housingCategory: '', quelle: '' },
    'unbekannte Codes werden durchgereicht und greifen spaeter still in REM_RATES daneben');

  /* Eine kaputte Fallakte darf die bueroweite Auswertung nicht abreissen lassen. */
  for (const kaputt of [null, undefined, 'Text', 42, { care: null }, { care: { remStage: { tief: true } } }]) {
    assert.doesNotThrow(() => roh(kaputt, kaputt), `wirft bei ${JSON.stringify(kaputt)}`);
  }
  assert.equal(profil(null, null).quelle, '');

  /* DOM-frei: weder waehrend der Laeufe angefasst noch im Quelltext erwaehnt. */
  assert.deepEqual(zugriffe, [], `die Ableitung greift auf ${zugriffe.join(', ')} zu - fremde Faelle sind nie geladen`);
  assert.doesNotMatch(code, /document|querySelector|getElementById|\bstate\./,
    'die Ableitung fasst DOM oder den geladenen Fall an');
  /* Und sie rechnet nicht selbst: die Saetze bleiben an EINER Stelle. */
  assert.doesNotMatch(code, /REM_RATES|__remRates/, 'die Ableitung greift selbst in die Satztabelle');
});

/* ───────── 7. Der Reiter: Luecken werden gezaehlt, nicht addiert ───────── */

/* Auswertung und Ausgabe des Reiters isoliert ausfuehrbar machen. Gestellt werden nur die
   Nachbarhelfer der Buerofinanzen-Schale (Text, Geld, Karten) - alles, was Zahlen erzeugt,
   stammt aus der Auslieferung selbst. */
function reiterLaden(jetzt) {
  const code = bereich('var ctlLauf = 0;', '  /* Nur die EIGENE Wurzel neu zeichnen.', 'Controlling-Reiter');
  const rechenkern = bereich('function daysInMonth(y,m){', '\nfunction monthFactor(', 'Monatsgrenze');

  const nAuswertung = funktionUm(code, 'vollstaendig:', 'Auswertung');
  const nAusgabe = funktionUm(code, 'bf-ctl-warnbox', 'Ausgabe');
  /* Die Einzelfallliste (Grundlage von PDF und Excel) liegt hinter der Zeichen-Grenze und wird
     deshalb getrennt geschnitten - sie gehoert aber in denselben Gueltigkeitsbereich. */
  const listeCode = bereich('  function ctlFallzeilen(a){', '  function ctlXlsxBytes(a){', 'Einzelfallliste');
  const nZeilen = funktionUm(listeCode, "'Betreuungsmonat','Monatswert','Status'", 'Einzelfallliste');
  const nStand = /if\(\s*([\w$]+)\.verboten\s*\)/.exec(code);
  assert.ok(nStand, 'der Zustandsspeicher des Reiters ist nicht auffindbar - nicht extrahierbar');

  const kontext = {
    window: { __remRates: REM_RATES, isBueroLocalMode: () => false, __currentUser: { isAdmin: true } },
    GRUEN: '#2e7d32', BLAU: '#2f6ca8', GRAU: '#8b8b8b',
    bfText: (s) => String(s == null ? '' : s),
    bfGeld: (n) => '[' + n + ']',
    bfLeer: (t) => '<p class="bf-leer">' + t + '</p>',
    bfKarte: (titel, inhalt) => '<section><h4>' + titel + '</h4>' + inhalt + '</section>',
    bfAnteile: (liste, leerText) => (liste && liste.length
      ? liste.map((x) => x.text + '=' + x.wert).join('|')
      : '<p class="bf-leer">' + leerText + '</p>'),
    bfSvgMonate: (monate, b) => (monate && monate.length
      ? '<svg data-monate="' + monate.length + '"></svg>'
      : '<p class="bf-leer">' + ((b && b.leer) || '') + '</p>')
  };
  vm.createContext(kontext);
  /* Uhr festnageln, wo die Frage an der Uhrzeit haengt. Der Reiter darf bei GLEICHER Datenlage
     vormittags nicht andere Zahlen liefern als nachmittags - genau das war der Fehler, und ohne
     eine feste Uhr liesse er sich nicht messen. */
  if (jetzt) {
    const fest = new Date(jetzt).getTime();
    assert.ok(Number.isFinite(fest), 'unbrauchbare Testuhrzeit');
    vm.runInContext(`(function(){
      var Echt = Date;
      function Fest(){
        if(arguments.length === 0) return new Echt(${fest});
        return new (Function.prototype.bind.apply(Echt, [null].concat(Array.prototype.slice.call(arguments))))();
      }
      Fest.now = function(){ return ${fest}; };
      Fest.UTC = Echt.UTC; Fest.parse = Echt.parse; Fest.prototype = Echt.prototype;
      globalThis.Date = Fest;
    })();`, kontext, { filename: 'uhr.js' });
  }
  vm.runInContext(rechenkern, kontext, { filename: 'rechenkern.js' });
  return vm.runInContext(
    `(function(){${code}\n${listeCode}\nreturn {auswerten:${nAuswertung},ausgabe:${nAusgabe},`
    + `fallzeilen:${nZeilen},setzeStand:function(s){${nStand[1]}=s;}};})()`,
    kontext, { filename: 'controlling-reiter.js' });
}

/* Ein Datum vor n Monaten als TT.MM.JJJJ - fuer den Fall, der noch in den ersten zwoelf
   Betreuungsmonaten steht (dort gilt der hoehere Satz). */
function vorMonaten(n) {
  const heute = new Date();
  const d = new Date(heute.getFullYear(), heute.getMonth() - n, 15, 12);
  const zwei = (x) => String(x).padStart(2, '0');
  return `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const VOLLSTAENDIGE_FAELLE = () => ([
  { caseId: 'a', label: 'Alt, Adam', betreuer: 'anna', startDate: '01.02.2020', endDate: '', archived: false,
    remStage: '2', assetStatus: 'M', housingCategory: 'A' },
  { caseId: 'b', label: 'Bald, Berta', betreuer: 'bert', startDate: vorMonaten(2), endDate: '', archived: false,
    remStage: '1', assetStatus: 'NM', housingCategory: 'S' }
]);
const LUECKEN_FAELLE = () => ([
  /* Vermoegensstatus fehlt - der Fall laeuft, ist aber nicht berechenbar. */
  { caseId: 'c', label: 'Cluecke, Cora', betreuer: 'anna', startDate: '01.02.2020', endDate: '', archived: false,
    remStage: '1', assetStatus: '', housingCategory: 'A' },
  /* Anfangsdatum unlesbar - die Dauer und damit der Satz sind unbekannt. */
  { caseId: 'd', label: 'Dunkel, Dora', betreuer: 'bert', startDate: 'Frühjahr 2019', endDate: '', archived: false,
    remStage: '2', assetStatus: 'NM', housingCategory: 'S' }
]);
const RUHENDE_FAELLE = () => ([
  { caseId: 'e', label: 'Ende, Emil', betreuer: 'anna', startDate: '01.01.2015', endDate: '31.12.2025', archived: false,
    remStage: '2', assetStatus: 'M', housingCategory: 'A' },
  { caseId: 'f', label: 'Fort, Frida', betreuer: 'anna', startDate: '01.01.2015', endDate: '', archived: true,
    remStage: '2', assetStatus: 'M', housingCategory: 'A' }
]);

test('Reiter: fehlende Angaben werden getrennt gezaehlt und nie als 0 mitaddiert', () => {
  const reiter = reiterLaden();
  const erwarteteSumme = REM_RATES['2|M|A|LATE'] + REM_RATES['1|NM|S|EARLY'];

  /* Erst die saubere Welt: zwei laufende, vollstaendig erfasste Faelle. */
  const sauber = reiter.auswerten({ stand: '2026-08-25', vollstaendig: true, gesamt: 2, faelle: VOLLSTAENDIGE_FAELLE() });
  assert.equal(sauber.laufend, 2);
  assert.equal(sauber.summe, erwarteteSumme, 'die Monatssumme stimmt nicht mit den VBVG-Saetzen ueberein');
  assert.equal(sauber.mitWert, 2);
  assert.equal(sauber.ohneWert, 0);
  assert.deepEqual([sauber.phase.EARLY, sauber.phase.LATE, sauber.phase.fehlt], [1, 1, 0],
    'die Grenze bei Monat 13 wird falsch gezogen - dort halbiert sich die Pauschale');

  /* Jetzt dieselbe Welt plus zwei Luecken. DER Kern des Vertrags: die Summe darf sich nicht
     bewegen. Wuerden Luecken als 0 mitgerechnet, blieben Summe UND Fallzahl unauffaellig,
     der Durchschnitt je Fall aber faellt - eine Zahl, die aussieht wie ein Ergebnis. */
  const mitLuecken = reiter.auswerten({
    stand: '2026-08-25', vollstaendig: true, gesamt: 6,
    faelle: [...VOLLSTAENDIGE_FAELLE(), ...LUECKEN_FAELLE(), ...RUHENDE_FAELLE()]
  });
  assert.equal(mitLuecken.summe, erwarteteSumme, 'eine fehlende Angabe wurde als 0 in die Summe gerechnet');
  assert.equal(mitLuecken.mitWert, 2, 'ein nicht berechenbarer Fall zaehlt als berechnet mit');
  assert.equal(mitLuecken.ohneWert, 2, 'die nicht berechenbaren Faelle werden nicht gesondert gezaehlt');
  assert.equal(mitLuecken.laufend, 4, 'beendete oder archivierte Faelle gelten als laufend');

  /* Jede Luecke landet in IHRER Kachel, nicht in einem Sammeltopf. */
  assert.deepEqual(klar(mitLuecken.verm), { M: 1, NM: 2, fehlt: 1 }, 'Vermoegensstatus: Luecke falsch gezaehlt');
  assert.deepEqual(klar(mitLuecken.wohn), { S: 2, A: 2, fehlt: 0 }, 'Wohnform: Luecke falsch gezaehlt');
  assert.deepEqual(klar(mitLuecken.phase), { EARLY: 1, LATE: 2, fehlt: 1 }, 'Betreuungsdauer: Luecke falsch gezaehlt');
  assert.equal(mitLuecken.baenderFehlt, 1, 'die Bestandsalterung verschweigt den Fall ohne lesbares Anfangsdatum');
  assert.equal(mitLuecken.baender.reduce((s, x) => s + x, 0), 3,
    'ein Fall ohne lesbaren Beginn wurde in ein Altersband einsortiert');

  /* Auch je Betreuer wird getrennt gefuehrt - sonst sieht eine halbe Akte nach halber Auslastung aus. */
  const anna = mitLuecken.betreuer.find((b) => b.key === 'anna');
  assert.equal(anna.faelle, 2, 'der lueckenhafte Fall faellt bei seinem Betreuer unter den Tisch');
  assert.equal(anna.summe, REM_RATES['2|M|A|LATE'], 'die Luecke wurde beim Betreuer als 0 addiert');
  assert.equal(anna.ohneWert, 1);

  /* Grep-Beleg zur Regel selbst: nirgends wird eine fehlende Angabe per ||0 zu einer Zahl. */
  const code = bereich('var ctlLauf = 0;', '  /* Nur die EIGENE Wurzel neu zeichnen.', 'Controlling-Reiter');
  assert.doesNotMatch(code, /summe\s*\+=[^;\n]*\|\|\s*0/,
    'eine fehlende Angabe wird per ||0 in die Summe gerechnet');
  assert.match(code, /===\s*null\s*\)[^;]*ohneWert\+\+;\s*else/,
    'die Auswertung trennt berechenbare und nicht berechenbare Faelle nicht mehr sichtbar');
});

test('Reiter: der Bildschirm zeigt die Luecken - auch wenn es keine gibt', () => {
  const reiter = reiterLaden();

  const mitLuecken = reiter.auswerten({
    stand: '2026-08-25', vollstaendig: true, gesamt: 6,
    faelle: [...VOLLSTAENDIGE_FAELLE(), ...LUECKEN_FAELLE(), ...RUHENDE_FAELLE()]
  });
  reiter.setzeStand({ a: mitLuecken });
  const mitText = reiter.ausgabe();

  assert.match(mitText, /Angabe fehlt: 1/, 'die Luecke steht nicht an der Kachel');
  assert.match(mitText, /Anfangsdatum fehlt: 1/, 'der Fall ohne lesbaren Beginn wird verschwiegen');
  assert.match(mitText, /Nicht berechenbar: 2/, 'die nicht berechenbaren Faelle stehen nicht neben der Summe');
  assert.match(mitText, /Pflegen/, 'es fehlt der Weg in die Datenadministration');
  assert.match(mitText, new RegExp('\\[' + (REM_RATES['2|M|A|LATE'] + REM_RATES['1|NM|S|EARLY']) + '\\]'),
    'die Monatssumme des Bueros erscheint nicht oder mit einem anderen Betrag');

  /* Ohne Luecke muss die Zeile TROTZDEM dastehen: "keine Luecke" soll eine gelesene Aussage
     sein und kein Zufall des Weglassens. */
  reiter.setzeStand({ a: reiter.auswerten({ stand: '2026-08-25', vollstaendig: true, gesamt: 2, faelle: VOLLSTAENDIGE_FAELLE() }) });
  const sauberText = reiter.ausgabe();
  assert.match(sauberText, /Angabe fehlt: 0/, 'ohne Luecke verschwindet die Zeile - dann sagt sie nichts mehr');
  assert.match(sauberText, /Nicht berechenbar: 0/);
  assert.doesNotMatch(sauberText, /Pflegen/, 'ohne Luecke wird trotzdem zum Pflegen aufgefordert');
});

/* ───────── 7a. Was „laufend“ heisst, haengt am Datum - nicht am belegten Feld ─────────
   Drei Befunde vom 25.08.2026, alle in derselben Auswertung: ein Enddatum in der Zukunft galt
   sofort als beendet, der Bezugspunkt war die aktuelle UHRZEIT statt der Tagesmitte, und ein
   Beginn in der Zukunft erbte die Meldung „Anfangsdatum fehlt“. Gemessen wird mit fester Uhr. */

const LAUFEND = (id, zusatz) => Object.assign({
  caseId: id, label: 'Fall ' + id, betreuer: 'anna', startDate: '01.01.2020', endDate: '',
  archived: false, remStage: '2', assetStatus: 'NM', housingCategory: 'A'
}, zusatz || {});
const EINGABE = (faelle) => ({ stand: '2026-08-25', vollstaendig: true, gesamt: faelle.length, faelle });

test('Reiter: ein Enddatum in der Zukunft beendet die Betreuung noch nicht', () => {
  const reiter = reiterLaden('2026-08-25T14:00:00');
  const satz = REM_RATES['2|NM|A|LATE'];

  const ohne = reiter.auswerten(EINGABE([LAUFEND('a'), LAUFEND('b')]));
  assert.equal(ohne.laufend, 2);
  assert.equal(ohne.summe, satz * 2);

  /* Aufhebungs- oder Wechselbeschluss zum 30.09.2026: die Betreuung laeuft noch fuenf Wochen
     und verdient in dieser Zeit die volle Pauschale. */
  const kuenftig = reiter.auswerten(EINGABE([LAUFEND('a', { endDate: '30.09.2026' }), LAUFEND('b')]));
  assert.equal(kuenftig.laufend, 2, 'ein Enddatum in der Zukunft nimmt den Fall sofort aus dem Bestand');
  assert.equal(kuenftig.summe, satz * 2, 'die Pauschale der noch laufenden Betreuung fehlt im Monatswert');
  assert.equal(kuenftig.ohneWert, 0);

  /* Ein Enddatum in der Vergangenheit beendet weiterhin. */
  const vorbei = reiter.auswerten(EINGABE([LAUFEND('a', { endDate: '31.07.2026' }), LAUFEND('b')]));
  assert.equal(vorbei.laufend, 1);
  assert.equal(vorbei.summe, satz);

  /* Ein Enddatum, das sich nicht LESEN laesst, gilt weiterhin als beendet - was nicht
     verstanden wird, deutet der Reiter nicht in „laufend“ um. */
  const unlesbar = reiter.auswerten(EINGABE([LAUFEND('a', { endDate: 'Ende 2025' }), LAUFEND('b')]));
  assert.equal(unlesbar.laufend, 1, 'ein unlesbares Enddatum wird jetzt als laufend gedeutet');

  /* Der Archivvorrang bleibt: archiviert ist archiviert, auch mit Zukunftsdatum. */
  const archiv = reiter.auswerten(EINGABE([LAUFEND('a', { endDate: '30.09.2026', archived: true }), LAUFEND('b')]));
  assert.equal(archiv.laufend, 1);

  /* Ein Fall, der GENAU heute endet, wird den ganzen Tag ueber gleich gezaehlt. */
  const heute = EINGABE([LAUFEND('a', { endDate: '25.08.2026' }), LAUFEND('b')]);
  const frueh = reiterLaden('2026-08-25T09:00:00').auswerten(heute);
  const spaet = reiterLaden('2026-08-25T17:00:00').auswerten(heute);
  assert.equal(frueh.laufend, spaet.laufend, 'ein heute endender Fall kippt mittags');
  assert.equal(frueh.summe, spaet.summe);
});

test('Reiter: dieselben Daten ergeben vormittags und nachmittags dieselben Zahlen', () => {
  /* Betreuungsbeginn HEUTE: `bis < start` war bis 12:00 Uhr wahr, weil die Falldaten auf der
     Tagesmitte liegen und der Vergleich gegen die aktuelle Uhrzeit lief. Ein Controlling-PDF
     vom Vormittag widersprach damit dem vom Nachmittag. */
  const heute = EINGABE([LAUFEND('n', { startDate: '25.08.2026', remStage: '1', assetStatus: 'M', housingCategory: 'S' })]);
  const v = reiterLaden('2026-08-25T10:00:00').auswerten(heute);
  const n = reiterLaden('2026-08-25T14:00:00').auswerten(heute);
  assert.equal(v.phase.fehlt, 0, 'ein Betreuungsbeginn von heute gilt vormittags als „Anfangsdatum fehlt“');
  assert.equal(v.phase.EARLY, 1);
  assert.equal(v.ohneWert, 0);
  assert.equal(v.summe, REM_RATES['1|M|S|EARLY']);
  assert.deepEqual(klar(v.phase), klar(n.phase), 'Vormittag und Nachmittag zaehlen verschieden');
  assert.equal(v.summe, n.summe, 'derselbe Fall ist vormittags anders viel wert als nachmittags');

  /* Und der Phasenwechsel am Jahrestag: der 13. Betreuungsmonat beginnt um 00:00, nicht mittags. */
  const jahrestag = EINGABE([LAUFEND('j', { startDate: '25.08.2025' })]);
  const j1 = reiterLaden('2026-08-25T10:00:00').auswerten(jahrestag);
  const j2 = reiterLaden('2026-08-25T17:00:00').auswerten(jahrestag);
  assert.deepEqual(klar(j1.phase), klar(j2.phase), 'der Phasenwechsel kippt erst mittags');
  assert.equal(j1.summe, j2.summe);
  assert.deepEqual(klar(j1.baender), klar(j2.baender), 'die Bestandsalterung kippt mittags');
});

test('Reiter: ein Beginn in der Zukunft ist kein fehlendes Anfangsdatum', () => {
  const reiter = reiterLaden('2026-08-25T14:00:00');
  const a = reiter.auswerten(EINGABE([
    LAUFEND('k', { startDate: '01.10.2026', remStage: '1', assetStatus: 'M', housingCategory: 'S' })
  ]));
  assert.equal(a.phase.fehlt, 0, 'ein lesbarer Beginn in der Zukunft wird als fehlend gemeldet');
  assert.equal(a.baenderFehlt, 0, 'die Bestandsalterung fordert zum Pflegen eines vollstaendigen Datums auf');
  assert.equal(a.laufend, 0, 'eine noch nicht begonnene Betreuung zaehlt als laufende Betreuung mit');
  assert.equal(a.ohneWert, 0, 'sie steht unter „Nicht berechenbar“, obwohl nichts zu rechnen ist');
  assert.equal(klar(a.wohn).S, 0, 'sie faellt in die Wohnform-Kachel der laufenden Faelle');
  assert.equal(a.kuenftig, 1, 'sie verschwindet spurlos aus der Auswertung');

  reiter.setzeStand({ a });
  const text = reiter.ausgabe();
  assert.match(text, /Betreuung beginnt erst später/, 'der Reiter verschweigt den noch nicht begonnenen Fall');
  assert.doesNotMatch(text, /Pflegen/, 'es wird weiterhin zum Pflegen eines vollstaendigen Datums aufgefordert');

  /* In der Einzelfallliste von PDF und Excel traegt er einen eigenen Status - „beendet“ waere
     schlicht falsch. */
  const zeilen = klar(reiter.fallzeilen(a));
  assert.equal(zeilen[1][zeilen[0].length - 1], 'beginnt erst',
    'die Einzelfallliste fuehrt den kuenftigen Fall als beendet');

  /* Gegenprobe: ohne kuenftigen Fall bleibt der Kopf unveraendert. */
  const b = reiter.auswerten(EINGABE([LAUFEND('a')]));
  assert.equal(b.kuenftig, 0);
  reiter.setzeStand({ a: b });
  assert.doesNotMatch(reiter.ausgabe(), /beginnt erst/);
});

test('Reiter: dieselbe Person ergibt EINE Zeile, egal wie ihr Name geschrieben ist', () => {
  /* Der Server loest den Betreuer nur zum Klarnamen auf, er normalisiert nicht: derselbe
     Mensch kommt als Personenschluessel ('anna beispiel'), als Klarname und als alter
     Freitext an. Nach Rohwert gruppiert zerfiel er in mehrere Zeilen mit getrennten
     Fallzahlen und Anteilen - die einzige Aussage dieser Tabelle. */
  const reiter = reiterLaden('2026-08-25T14:00:00');
  const satz = REM_RATES['2|NM|A|LATE'];
  const a = reiter.auswerten(EINGABE([
    LAUFEND('c1', { betreuer: 'anna beispiel' }),
    LAUFEND('c2', { betreuer: 'Anna Beispiel' }),
    LAUFEND('c3', { betreuer: '  ANNA   BEISPIEL ' }),
    LAUFEND('c4', { betreuer: 'Bernd Bestand' })
  ]));
  assert.equal(a.betreuer.length, 2, 'dieselbe Person erscheint in mehreren Zeilen');
  const anna = a.betreuer.find((b) => b.key === 'anna beispiel');
  assert.ok(anna, 'der Gruppierungsschluessel ist nicht normalisiert');
  assert.equal(anna.faelle, 3, 'die Fallzahl je Betreuer ist falsch aufgeteilt');
  assert.equal(anna.summe, satz * 3, 'der Monatswert je Betreuer ist falsch aufgeteilt');
  /* Die Buerosumme war schon vorher richtig - falsch war ausschliesslich die Aufteilung. */
  assert.equal(a.summe, satz * 4);

  reiter.setzeStand({ a });
  const text = reiter.ausgabe();
  assert.equal((text.match(/Anna Beispiel/g) || []).length, 1,
    'die Tabelle zeigt weiterhin zwei optisch gleiche Zeilen');
  assert.doesNotMatch(text, /anna beispiel/, 'der Name erscheint kleingeschrieben statt als Klarname');
  assert.match(text, /75\.0 %/, 'der Anteil je Betreuer ist falsch aufgeteilt');

  /* Faelle ohne Betreuer bleiben eine eigene, benannte Zeile. */
  const b = reiter.auswerten(EINGABE([LAUFEND('x', { betreuer: '' }), LAUFEND('y', { betreuer: 'Anna Beispiel' })]));
  reiter.setzeStand({ a: b });
  assert.match(reiter.ausgabe(), /nicht zugeordnet/, 'Faelle ohne Betreuer verlieren ihre eigene Zeile');
});

test('Reiter: eine unvollstaendige Auswertung sagt das ueber ihrer ersten Zahl', () => {
  const reiter = reiterLaden();

  const gefiltert = reiter.auswerten({
    stand: '2026-08-25', vollstaendig: false, gesamt: 9, faelle: VOLLSTAENDIGE_FAELLE()
  });
  assert.equal(gefiltert.vollstaendig, false);
  assert.equal(gefiltert.sichtbar, 2);
  assert.equal(gefiltert.gesamt, 9, 'gesamt wird nicht aus der Antwort uebernommen');

  reiter.setzeStand({ a: gefiltert });
  const text = reiter.ausgabe();
  const hinweis = /Diese Auswertung umfasst nur die Fälle, die Sie sehen dürfen \(2 von 9\)/;
  assert.match(text, hinweis, 'der Unvollstaendigkeits-Hinweis fehlt oder nennt die Zahlen nicht');
  assert.ok(text.search(hinweis) < text.indexOf('[' + gefiltert.summe + ']'),
    'der Hinweis steht UNTER der Summe - dann ist sie schon als bueroweit gelesen');

  /* Eine vollstaendige Auswertung darf den Hinweis nicht tragen, sonst nutzt er sich ab. */
  reiter.setzeStand({ a: reiter.auswerten({ stand: '2026-08-25', vollstaendig: true, gesamt: 2, faelle: VOLLSTAENDIGE_FAELLE() }) });
  assert.doesNotMatch(reiter.ausgabe(), /bf-ctl-warnbox/, 'der Hinweis steht auch bei vollstaendiger Sicht');

  /* Fehlt die Angabe des Servers ganz (alte Antwort), wird NICHT stillschweigend
     Vollstaendigkeit behauptet-freie Felder duerfen keine Aussage erfinden. */
  const ohneAngabe = reiter.auswerten({ faelle: VOLLSTAENDIGE_FAELLE() });
  assert.equal(ohneAngabe.gesamt, 2, 'ohne gesamt-Angabe muss die sichtbare Zahl gelten');

  /* Ein 403 des Servers wird als Rechtefrage benannt, nicht als leere Auswertung. */
  reiter.setzeStand({ verboten: true });
  const verboten = reiter.ausgabe();
  assert.match(verboten, /Berechtigung/, 'ein 403 erscheint nicht als Rechtehinweis');
  assert.doesNotMatch(verboten, /\[0\]/, 'ein 403 wird als 0-Euro-Auswertung gezeichnet');

  /* Und der Reiter selbst haengt am Recht, statt nur eine Absage zu holen. */
  const leiste = bereich('{ id:\'controlling\'', '];', 'Reiterleiste');
  assert.match(leiste, /darf\s*:/, 'der Controlling-Reiter ist nicht an ein Recht gebunden');
  assert.match(html, /if\(r\.darf\s*&&\s*!r\.darf\(\)\)\s*continue;/,
    'die Reiterleiste zeichnet Reiter ohne Recht trotzdem');
});

/* ───────── 8. Auslieferung ───────── */

test('Auslieferung: die Zahl der Skriptbloecke ist unveraendert 309', () => {
  assert.equal((html.match(/\n<script/g) || []).length, 309,
    'es wurde ein Skriptblock angelegt oder entfernt - neuer Code gehoert in einen vorhandenen Block');
});

/* ─── Nachtrag 25.08.2026: der Rueckfall auf den Verguetungsantrag ───

   Befund beim Zusammenbau: __caseVerguetungsprofil war gebaut, aber NIRGENDS aufgerufen -
   die Funktion war toter Code. Damit waeren alle Bestandsfaelle im Controlling leer gewesen,
   obwohl ihre Angaben seit Jahren im Verguetungsantrag stehen. Seitdem gibt es den Rueckfall
   an zwei Stellen: serverseitig fuer die Auswertung, clientseitig fuer die Uebernahme in die
   Stammdaten. Zwei Ableitungen sind eine Ableitung zu viel - deshalb pruefen wir sie hier
   gegen DIESELBEN Fixtures. Laufen sie auseinander, faellt es hier auf und nicht im Buero. */

const ANTRAG_FIXTURES = [
  { name: 'voller Antrag, letzte befuellte Zeile gilt',
    stufe: '2',
    zeilen: [{ status: 'NM', housing: 'A' }, { status: 'M', housing: 'S' }, {}],
    soll: { remStage: '2', assetStatus: 'M', housingCategory: 'S' } },
  { name: 'nur die Stufe gepflegt',
    stufe: '1', zeilen: [{}, {}],
    soll: { remStage: '1', assetStatus: '', housingCategory: '' } },
  { name: 'Kleinschreibung aus Altdaten',
    stufe: '', zeilen: [{ status: 'nm', housing: 's' }],
    soll: { remStage: '', assetStatus: 'NM', housingCategory: 'S' } },
  { name: 'unbekannte Werte werden verworfen, nicht geraten',
    stufe: '7', zeilen: [{ status: 'arm', housing: 'X' }],
    soll: null },
  { name: 'voellig leerer Antrag',
    stufe: '', zeilen: [], soll: null },
  /* Nachtrag Review 25.08.: Das Programm belegt rem_sections beim Seeden SELBST vor und raet die
     Wohnform aus der Unterkunftsart. Solche Zeilen tragen die Herkunft 'master' und duerfen NICHT
     als Angabe des Buueros gelten - sonst meldete die Kachel "Wohnform" eine gepflegte Angabe fuer
     Faelle, deren Wohnform nie jemand bestaetigt hat, und die Fallakte boete an, die Vermutung in
     die Stammdaten zu uebernehmen. Die alten Fixtures trugen gar kein source-Feld und haetten die
     Abweichung zwischen Server und Client nie bemerkt. */
  { name: 'vom Programm geratene Zeilen zaehlen nicht',
    stufe: '2', zeilen: [{ status: 'M', housing: 'S' }], quelleFeld: 'master',
    soll: { remStage: '2', assetStatus: '', housingCategory: '' } },
  { name: 'von Hand gesetzte Zeilen zaehlen weiter',
    stufe: '2', zeilen: [{ status: 'M', housing: 'S' }], quelleFeld: 'manual',
    soll: { remStage: '2', assetStatus: 'M', housingCategory: 'S' } },
];

const antragDoku = (fx) => JSON.stringify({
  fields: {
    rem_stage: { value: fx.stufe },
    rem_sections: fx.quelleFeld
      ? { value: fx.zeilen, source: fx.quelleFeld }
      : { value: fx.zeilen }
  }
});

test('Rueckfall: Server liest den Verguetungsantrag - und sagt es', async (t) => {
  /* EIGENER Datenbestand: der Prueffall oben schliesst seine Verbindung in t.after und raeumt
     TEMP ab. Ohne einen frischen Wurzelordner (und ohne geleerten Modul-Zwischenspeicher, damit
     database/index.js sich neu verbindet) liefe dieser Prueffall gegen eine geschlossene Datei. */
  const TEMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'controlling-rueckfall-'));
  process.env.DB_PATH = path.join(TEMP2, 'fixture.sqlite3');
  process.env.DOCUMENTS_DATA_ROOT = path.join(TEMP2, 'data');
  for (const key of Object.keys(require.cache)) {
    if (key.includes(path.join('server', 'src'))) delete require.cache[key];
  }
  const express = require('express');
  const bcrypt = require('bcrypt');
  const db = require('../src/database/index');
  const { serializePermissions } = require('../src/middleware/authorization');
  const { createSessionMiddleware, requireOnlineMode } = require('../src/middleware/authentication');
  const authRoutes = require('../src/modules/auth/routes');
  const controllingRoutes = require('../src/modules/controlling/routes');

  let server;
  t.after(async () => {
    if (server) await new Promise((r) => server.close(r));
    db.close();
    for (const key of Object.keys(require.cache)) {
      if (key.includes(path.join('server', 'src'))) delete require.cache[key];
    }
    fs.rmSync(TEMP2, { recursive: true, force: true });
  });

  const hash = await bcrypt.hash('vertrag', 4);
  db.prepare(`INSERT INTO users (id, username, password_hash, display_name, allow_local, allow_online, is_admin, permissions_json)
              VALUES (1, 'chefin', ?, 'Chefin', 1, 1, 1, ?)`)
    .run(hash, serializePermissions({ local: {}, online: {} }, null));

  const neuerFall = db.prepare('INSERT INTO cases (id, label, stammdaten_json) VALUES (?,?,?)');
  const neuerAntrag = db.prepare('INSERT INTO case_reports (case_id, report_id, data_json) VALUES (?,?,?)');

  /* Ein Fall, dessen Stammdaten GEPFLEGT sind - er darf sich vom Antrag nicht umstimmen lassen. */
  neuerFall.run('f-gepflegt', 'Gepflegt, Gerda',
    JSON.stringify({ care: { startDate: '01.01.2024', remStage: '1', assetStatus: 'NM', housingCategory: 'A' } }));
  neuerAntrag.run('f-gepflegt', 'remuneration', antragDoku({ stufe: '2', zeilen: [{ status: 'M', housing: 'S' }] }));

  /* Und je Fixture ein Fall mit LEEREN Stammdaten. */
  ANTRAG_FIXTURES.forEach((fx, i) => {
    neuerFall.run(`f-${i}`, `Antrag ${i}`, JSON.stringify({ care: { startDate: '01.01.2024' } }));
    neuerAntrag.run(`f-${i}`, 'remuneration', antragDoku(fx));
  });
  /* Ein Fall ganz ohne Antrag - er muss leer bleiben und darf nicht als 'antrag' gelten. */
  neuerFall.run('f-nichts', 'Ohne, Otto', JSON.stringify({ care: { startDate: '01.01.2024' } }));

  const app = express();
  app.use(express.json());
  app.use(createSessionMiddleware());
  app.use('/api/auth', authRoutes);
  app.use('/api/controlling', requireOnlineMode, controllingRoutes);
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const port = server.address().port;

  const anmelden = async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'chefin', password: 'vertrag', mode: 'online' }),
    });
    return r.headers.get('set-cookie').split(';')[0];
  };
  const cookie = await anmelden();
  const antwort = await fetch(`http://127.0.0.1:${port}/api/controlling`, { headers: { cookie } });
  const daten = await antwort.json();
  const holen = (id) => daten.faelle.find((f) => f.caseId === id);

  await t.test('gepflegte Stammdaten schlagen den Antrag', () => {
    const f = holen('f-gepflegt');
    assert.equal(f.quelle, 'fall');
    assert.equal(f.remStage, '1', 'der Antrag hat die Stammdaten ueberstimmt');
    assert.equal(f.assetStatus, 'NM');
    assert.equal(f.housingCategory, 'A');
  });

  await t.test('leere Stammdaten holen sich die Angaben aus dem Antrag', () => {
    ANTRAG_FIXTURES.forEach((fx, i) => {
      const f = holen(`f-${i}`);
      if (fx.soll === null) {
        assert.equal(f.quelle, '', `${fx.name}: nichts Verwertbares darf nicht als Quelle gelten`);
        assert.equal(f.remStage + f.assetStatus + f.housingCategory, '', `${fx.name}: es wurde geraten`);
        return;
      }
      assert.equal(f.quelle, 'antrag', `${fx.name}: Herkunft nicht gekennzeichnet`);
      assert.equal(f.remStage, fx.soll.remStage, `${fx.name}: Stufe`);
      assert.equal(f.assetStatus, fx.soll.assetStatus, `${fx.name}: Vermoegensstatus`);
      assert.equal(f.housingCategory, fx.soll.housingCategory, `${fx.name}: Wohnform`);
    });
  });

  await t.test('ohne Antrag bleibt der Fall ehrlich leer', () => {
    const f = holen('f-nichts');
    assert.equal(f.quelle, '');
    assert.equal(f.remStage, '');
  });

  await t.test('Client und Server leiten identisch ab', () => {
    /* Dieselben Fixtures durch die CLIENT-Funktion - laufen die beiden Ableitungen
       auseinander, zeigt der Reiter andere Zahlen als die Fallakte. */
    const a = html.indexOf('window.__caseVerguetungsprofil=function');
    const b = html.indexOf('function renderRemunerationTable(', a);
    assert.ok(a > 0 && b > a, 'Client-Ableitung nicht auffindbar');
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(html.slice(a, b), ctx, { filename: 'profil.js' });
    const profil = ctx.window.__caseVerguetungsprofil;

    ANTRAG_FIXTURES.forEach((fx) => {
      const reports = { remuneration: { fields: JSON.parse(antragDoku(fx)).fields } };
      const p = profil({ care: {} }, reports);
      const serverseitig = holen(`f-${ANTRAG_FIXTURES.indexOf(fx)}`);
      assert.equal(p.quelle, serverseitig.quelle, `${fx.name}: Herkunft weicht ab`);
      assert.equal(p.remStage, serverseitig.remStage, `${fx.name}: Stufe weicht ab`);
      assert.equal(p.assetStatus, serverseitig.assetStatus, `${fx.name}: Vermoegensstatus weicht ab`);
      assert.equal(p.housingCategory, serverseitig.housingCategory, `${fx.name}: Wohnform weicht ab`);
    });
  });
});

test('Die Ableitung ist kein toter Code mehr', () => {
  /* Genau das war der Befund: gebaut, aber nie aufgerufen. */
  const vorkommen = (html.match(/__caseVerguetungsprofil/g) || []).length;
  assert.ok(vorkommen >= 3, `__caseVerguetungsprofil kommt nur ${vorkommen}× vor - wird sie ueberhaupt benutzt?`);
  assert.ok(html.includes('window.__caseVerguetungUebernehmen'), 'Uebernahme in die Stammdaten fehlt');
  /* Die Zeile darf nur erscheinen, wenn wirklich etwas zu uebernehmen ist. */
  assert.ok(html.includes("if(!p||p.quelle!=='antrag')return ''"), 'Uebernahmezeile ohne Bedingung');
  /* Und der Reiter muss die Herkunft sichtbar machen. */
  assert.ok(html.includes("if(f && f.quelle === 'antrag') a.ausAntrag++"), 'Herkunft wird nicht gezaehlt');
  assert.ok(html.includes('stammen die Vergütungsangaben aus dem letzten Vergütungsantrag'),
    'der Reiter verschweigt, woher die Angaben kommen');
});
