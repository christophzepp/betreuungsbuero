'use strict';

/* Personenregister, Etappe 1 (29.08.2026) - AUSGEFUEHRT gegen echte Router mit Wegwerf-DB:
     1. Die einmalige Bestandsuebernahme (users + office_employees -> persons, Namensabgleich,
        Kennungs-Kollision laesst die zweite Kennung ehrlich leer).
     2. Die /api/persons-Routen: Lesen fuer alle Angemeldeten, Schreiben nur mit Recht,
        Kennung eindeutig (409), interne nie loeschen, externe schon.
     3. Konto anlegen verknuepft die vorhandene Person per Name statt zu doppeln;
        Konto loeschen laesst die Person zurueck.
     4. Die employees-Route ist eine Sicht auf persons (Loeschen = deaktivieren).
   Dazu Struktur-Pins am Client (Menue "Personen", Buerostammdaten nur Ansicht online). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

function frischeDb(t, vorher) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'personen-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  process.env.DB_PATH = path.join(temp, 'test.sqlite3');
  delete require.cache[require.resolve('../src/database/index')];
  for (const k of Object.keys(require.cache)) {
    if (/modules[\\/](office|admin)[\\/]/.test(k)) delete require.cache[k];
  }
  /* `vorher` darf Bestand anlegen, BEVOR die Migration laeuft - dafuer die DB einmal roh
     oeffnen, Bestand einspielen, wieder schliessen und dann regulaer laden. */
  if (vorher) {
    const Database = require('better-sqlite3');
    const roh = new Database(process.env.DB_PATH);
    roh.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '',
        allow_local INTEGER NOT NULL DEFAULT 1, allow_online INTEGER NOT NULL DEFAULT 0,
        is_admin INTEGER NOT NULL DEFAULT 0, allow_case_management INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE office_employees (id TEXT PRIMARY KEY, first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    `);
    vorher(roh);
    roh.close();
  }
  const db = require('../src/database/index');
  t.after(() => { try { db.close(); } catch (_e) {} });
  return db;
}

test('Bestandsübernahme: Nutzer + Mitarbeitende werden EINE Person je Mensch', (t) => {
  const db = frischeDb(t, (roh) => {
    roh.prepare("INSERT INTO users (username, password_hash, display_name) VALUES ('czepp','x','Christoph Zepp')").run();
    roh.exec("ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT ''");
    roh.exec("ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT ''");
    roh.exec("ALTER TABLE users ADD COLUMN ma_kennung TEXT NOT NULL DEFAULT ''");
    roh.prepare("UPDATE users SET first_name='Christoph', last_name='Zepp', ma_kennung='MA 1'").run();
    roh.exec("ALTER TABLE office_employees ADD COLUMN ma_kennung TEXT NOT NULL DEFAULT ''");
    /* Dieselbe Person NOCHMAL als Mitarbeiter-Eintrag (die klassische Doppelpflege) plus eine
       echte zweite Person - und eine Kennungs-Kollision (zweimal "MA 2"). */
    roh.prepare("INSERT INTO office_employees (id, first_name, last_name, role, email, ma_kennung) VALUES ('e1','Christoph','Zepp','Berufsbetreuer','alt@example.org','MA 9')").run();
    roh.prepare("INSERT INTO office_employees (id, first_name, last_name, role, ma_kennung) VALUES ('e2','Sabine','Falkner','Berufsbetreuerin','MA 2')").run();
    roh.prepare("INSERT INTO office_employees (id, first_name, last_name, role, ma_kennung) VALUES ('e3','Karim','Denizli','Verwaltung','MA 2')").run();
  });
  const personen = db.prepare('SELECT * FROM persons ORDER BY last_name').all();
  assert.equal(personen.length, 3, 'Doppelpflege wurde nicht zusammengeführt');
  const zepp = personen.find((p) => p.last_name === 'Zepp');
  assert.ok(zepp.user_id, 'Die Konto-Person verlor ihr Konto');
  /* Das Nutzerprofil gewinnt: Kennung MA 1 bleibt, der Mitarbeiter-Rest füllt nur Leeres auf. */
  assert.equal(zepp.kennung, 'MA 1');
  assert.equal(zepp.funktion, 'Berufsbetreuer', 'Leere Felder wurden nicht aus dem Mitarbeiter-Eintrag gefüllt');
  const falkner = personen.find((p) => p.last_name === 'Falkner');
  const denizli = personen.find((p) => p.last_name === 'Denizli');
  assert.equal(falkner.kennung, 'MA 2');
  assert.equal(denizli.kennung, '', 'Die Kennungs-Kollision wurde nicht ehrlich geleert');
});

test('Routen: Kennung eindeutig, interne nie löschen, Konto verknüpft per Name', async (t) => {
  const db = frischeDb(t, null);
  const express = require('express');
  const personsRoutes = require('../src/modules/office/persons-routes');

  const app = express();
  app.use(express.json());
  let session = { userId: 1, isAdmin: true };
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/persons', personsRoutes);
  const srv = app.listen(0);
  t.after(() => srv.close());
  const basis = `http://127.0.0.1:${srv.address().port}`;
  const ruf = (methode, weg, body) => fetch(basis + weg, {
    method: methode, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const p1 = await (await ruf('POST', '/api/persons', { firstName: 'Sabine', lastName: 'Falkner', funktion: 'Berufsbetreuerin', kennung: 'MA 2' })).json();
  assert.equal(p1.person.kennung, 'MA 2');

  /* Kennung doppelt (auch anders geschrieben) -> 409. */
  const doppelt = await ruf('POST', '/api/persons', { firstName: 'Karim', lastName: 'Denizli', kennung: 'ma 2' });
  assert.equal(doppelt.status, 409);

  /* Externe anlegen + löschen erlaubt; interne nur deaktivieren. */
  const ext = await (await ruf('POST', '/api/persons', { lastName: 'RA Dr. Hofmann, Mainz', art: 'extern' })).json();
  assert.equal(ext.person.art, 'extern');
  assert.equal((await ruf('DELETE', '/api/persons/' + p1.person.id)).status, 409, 'Interne Person ließ sich löschen - Kennung wäre wieder frei');
  assert.equal((await ruf('DELETE', '/api/persons/' + ext.person.id)).status, 200);

  /* Ohne Recht: lesen ja, schreiben nein. */
  session = { userId: 2, isAdmin: false, canManageOfficeProfile: false };
  assert.equal((await ruf('GET', '/api/persons')).status, 200);
  assert.equal((await ruf('POST', '/api/persons', { lastName: 'X' })).status, 403);
  session = { userId: 1, isAdmin: true };

  /* "Konto anlegen": ensurePersonForUser verknüpft die vorhandene Person per Name -
     KEINE zweite Person; die Person behält ihre Kennung und spiegelt sie ins Konto. */
  const info = db.prepare("INSERT INTO users (username, password_hash, display_name, first_name, last_name) VALUES ('sfalkner','x','Sabine Falkner','Sabine','Falkner')").run();
  personsRoutes.ensurePersonForUser(info.lastInsertRowid);
  const alle = db.prepare('SELECT * FROM persons').all();
  assert.equal(alle.length, 1, 'Konto anlegen hat die Person gedoppelt');
  assert.equal(alle[0].user_id, info.lastInsertRowid);
  assert.equal(db.prepare('SELECT ma_kennung FROM users WHERE id = ?').get(info.lastInsertRowid).ma_kennung, 'MA 2',
    'Die Kennung der Person wurde nicht ins Konto gespiegelt');

  /* Konto löschen -> Person bleibt (ohne Konto), Kennung bleibt belegt.
     WICHTIG (Bugjagd 30.08.2026): das Lösen der Verknüpfung muss VOR dem DELETE der
     users-Zeile laufen - foreign_keys ist AN, persons.user_id verweist auf users. Der
     nachgelagerte detach-Aufruf der ersten Fassung ließ JEDES Nutzer-Löschen mit einem
     Constraint-Fehler scheitern. Hier der harte Beweis in der richtigen Reihenfolge: */
  personsRoutes.detachPersonFromUser(info.lastInsertRowid);
  assert.doesNotThrow(() => db.prepare('DELETE FROM users WHERE id = ?').run(info.lastInsertRowid),
    'users-Zeile ließ sich nach dem Detach nicht löschen');
  db.prepare("INSERT INTO users (id, username, password_hash, first_name, last_name) VALUES (?, 'wieder','x','Sabine','Falkner')").run(info.lastInsertRowid);
  const danach = db.prepare('SELECT * FROM persons').all();
  assert.equal(danach.length, 1);
  assert.equal(danach[0].user_id, null);
  assert.equal(danach[0].kennung, 'MA 2');
});

test('employees-Route ist eine Sicht auf persons – Löschen deaktiviert nur', async (t) => {
  const db = frischeDb(t, null);
  const express = require('express');
  const profileRoutes = require('../src/modules/office/profile-routes');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: 1, isAdmin: true }; next(); });
  app.use('/api/office-profile', profileRoutes);
  const srv = app.listen(0);
  t.after(() => srv.close());
  const basis = `http://127.0.0.1:${srv.address().port}`;

  const neu = await (await fetch(basis + '/api/office-profile/employees', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Karim', lastName: 'Denizli', role: 'Verwaltung', maKennung: 'MA 3' }),
  })).json();
  assert.ok(neu.employee && neu.employee.maKennung === 'MA 3');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM persons').get().n, 1, 'Der Mitarbeiter landete nicht im Register');
  /* Etappe 4: die Alt-Tabelle existiert gar nicht mehr - haerter als "leer". */
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='office_employees'").get(), undefined,
    'Die Alt-Tabelle office_employees lebt noch');

  const liste1 = await (await fetch(basis + '/api/office-profile/employees')).json();
  assert.equal(liste1.employees.length, 1);

  await fetch(basis + '/api/office-profile/employees/' + neu.employee.id, { method: 'DELETE' });
  const liste2 = await (await fetch(basis + '/api/office-profile/employees')).json();
  assert.equal(liste2.employees.length, 0, 'Gelöschte Mitarbeitende erscheinen weiter');
  const person = db.prepare('SELECT * FROM persons').get();
  assert.equal(person.aktiv, 0, 'Löschen hat die Person hart entfernt - die Kennung wäre wieder frei');
  assert.equal(person.kennung, 'MA 3', 'Die Kennung der deaktivierten Person ging verloren');
});

test('Client: EIN Menü „Personen“, Bürostammdaten online nur Ansicht', () => {
  /* Menü + Untertitel + Statuszahl. */
  assert.ok(html.includes("{id:'nutzer',name:'Personen',admin:true}"), 'Der Menüpunkt heißt nicht „Personen“');
  assert.ok(html.includes("nutzer:{zahl:'personen',einheit:'aktive Person(en) im Verzeichnis.'"),
    'Der Zählpunkt zählt nicht das Personenverzeichnis');
  assert.ok(html.includes("out.personen = zahl('SELECT COUNT(*) AS n FROM persons WHERE aktiv = 1');")
    || fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'settings', 'status-routes.js'), 'utf8')
      .includes("out.personen = zahl('SELECT COUNT(*) AS n FROM persons WHERE aktiv = 1');"),
    'Die Statusabfrage liefert keine Personenzahl');

  /* Die Liste links zeigt PERSONEN; die frühere Spiegelleiste ist ersatzlos raus
     (es gibt keine zweite Liste mehr, aus der gespiegelt werden müsste). */
  assert.ok(html.includes('function renderPersonListHTML()') && html.includes('function filteredPersons()'),
    'Die Personenliste fehlt');
  assert.ok(html.includes("const mirrorBar='';"), 'Die Spiegelleiste „Mitarbeitende ohne Zugang“ lebt noch');
  assert.ok(html.includes('function personDetailHTML()') && html.includes('personKontoAnlegen'),
    'Das Personen-Formular bzw. „Konto anlegen“ fehlt');
  assert.ok(html.includes('selectPerson,showPersonForm,savePerson,personAktiv,personLoeschen,personKontoAnlegen,'),
    'Die Personen-Handler sind nicht exportiert');

  /* Bürostammdaten: online nur noch Ansicht mit Verweis; lokal bleibt der Editor. */
  assert.ok(html.includes("const empNurAnsicht=readOnly||window.__appMode==='online';"),
    'Die Mitarbeitendenliste der Bürostammdaten ist online wieder bearbeitbar');
  assert.ok(html.includes('Personen verwalten →'), 'Der Verweis auf das Personenverzeichnis fehlt');

  /* Excel-/Ansichts-Quelle: /api/persons liefert ALLE aktiven internen (auch Konto-Personen) -
     vorher fehlten Konto-Personen im Mitarbeiter-Blatt, wenn sie nicht dupliziert waren. */
  assert.equal((html.match(/filter\(p=>p\.aktiv&&p\.art!=='extern'\)\.map\(p=>\(\{/g) || []).length, 2,
    'Export (Büro-Excel) und Bürostammdaten-Ansicht lesen nicht beide aus dem Personenregister');
});

test('Etappe 2: Bestandswerte werden Personen-IDs, extern:-Werte werden Register-Personen', (t) => {
  const db = frischeDb(t, (roh) => {
    roh.exec("ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT ''");
    roh.exec("ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT ''");
    roh.prepare("INSERT INTO users (username, password_hash, first_name, last_name) VALUES ('czepp','x','Christoph','Zepp')").run();
    roh.exec(`CREATE TABLE cases (id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '',
      file_number TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by INTEGER, stammdaten_json TEXT NOT NULL DEFAULT '{}')`);
    roh.prepare("INSERT INTO cases (id, label, stammdaten_json) VALUES ('c1','Fall 1', ?)")
      .run(JSON.stringify({ rechtlicherBetreuer: 'christoph zepp', vertretung: 'extern:RA Dr. Hofmann, Mainz' }));
    roh.exec(`CREATE TABLE office_json (key TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by INTEGER)`);
    roh.prepare("INSERT INTO office_json (key, data_json) VALUES ('vertretungsplan', ?)")
      .run(JSON.stringify({ version: 1, eintraege: [{ id: 'vt-1', person: 'christoph zepp', vertretung: 'extern:RA Dr. Hofmann, Mainz', von: '', bis: '', notiz: '' }], externe: [{ id: 'ex-1', name: 'RA Dr. Hofmann, Mainz' }, { id: 'ex-2', name: 'Betreuungsverein Bingen e.V.' }] }));
    roh.prepare("INSERT INTO office_json (key, data_json) VALUES ('qualifikationen', ?)")
      .run(JSON.stringify({ entries: { 'christoph zepp': { stundenumfang: '40' }, 'nie gesehen': { stundenumfang: '10' } } }));
  });

  const personen = db.prepare('SELECT * FROM persons').all();
  const zepp = personen.find((p) => p.last_name === 'Zepp');
  const hofmann = personen.find((p) => /Hofmann/.test(p.last_name));
  const verein = personen.find((p) => /Betreuungsverein/.test(p.last_name));
  assert.ok(zepp && hofmann && verein, 'Nicht alle Personen (inkl. Externer aus Werten UND Verzeichnis) angelegt');
  assert.equal(hofmann.art, 'extern');
  assert.equal(verein.art, 'extern', 'Das Blob-Verzeichnis wurde nicht ins Register überführt');

  /* Fallfelder: Namensschlüssel -> ID des Nutzers, extern: -> ID der Register-Person. */
  const sd = JSON.parse(db.prepare("SELECT stammdaten_json FROM cases WHERE id='c1'").get().stammdaten_json);
  assert.equal(sd.rechtlicherBetreuer, zepp.id, 'Der Betreuer-Namensschlüssel wurde nicht zur ID');
  assert.equal(sd.vertretung, hofmann.id, 'Der extern:-Wert wurde nicht zur Personen-ID');

  /* Vertretungsplan: Werte migriert, externe[] entfernt. */
  const vp = JSON.parse(db.prepare("SELECT data_json FROM office_json WHERE key='vertretungsplan'").get().data_json);
  assert.equal(vp.eintraege[0].person, zepp.id);
  assert.equal(vp.eintraege[0].vertretung, hofmann.id);
  assert.equal(vp.externe, undefined, 'Das Blob-Verzeichnis lebt im Plan weiter');

  /* Qualifikationen: bekannter Schlüssel wird ID, unbekannter bleibt ehrlich stehen. */
  const qm = JSON.parse(db.prepare("SELECT data_json FROM office_json WHERE key='qualifikationen'").get().data_json);
  assert.equal(qm.entries[zepp.id].stundenumfang, '40', 'Der Stundenumfang hängt nicht an der Personen-ID');
  assert.equal(qm.entries['nie gesehen'].stundenumfang, '10', 'Ein nicht auflösbarer Schlüssel wurde weggeworfen');
  assert.equal(qm.entries['christoph zepp'], undefined, 'Der alte Namensschlüssel blieb zusätzlich stehen');

  /* Marker: die Migration läuft genau einmal. */
  assert.ok(db.prepare("SELECT 1 FROM office_json WHERE key='personen_e2'").get(), 'Der Einmal-Marker fehlt');
});

test('Etappe 2: gatherPersons liest das Register, Konsumenten hängen an der ID', () => {
  /* EINE Quelle für jede Personenliste: /api/persons; key = Personen-ID. Alle kommen zurück
     (auch deaktivierte/externe) - Anzeige-Karten brauchen Historie, die AUSWAHLEN filtern. */
  const gp = html.slice(html.indexOf('async function gatherPersons()'), html.indexOf('async function caseCounts()'));
  assert.ok(gp.includes("fetch('/api/persons'") && gp.includes('key:p.id,'),
    'gatherPersons liest nicht aus dem Register');
  assert.ok(gp.includes('window.__qmPersons=list;'),
    'gatherPersons pflegt den geteilten Cache nicht selbst (Controlling-Stunden hingen daran)');
  assert.ok(gp.includes('bueroLocal.persons'),
    'Der Außendienst-Rückfall auf die mitgereiste Personenliste fehlt');

  /* Stundenumfang: Namens-Aufrufer werden über den Cache zur ID aufgelöst; lokal (ohne
     Register) bleibt der Namensschlüssel selbst der Schlüssel. */
  assert.ok(html.includes('function qmSchluesselFuer(first,last)'),
    'Die Namens-zu-ID-Auflösung für den Stundenumfang fehlt');

  /* Außendienst-Datei: Personenliste reist mit UND steht in der loadBueroLocal-Whitelist
     (sonst würde sie still verworfen - die bekannte Whitelist-Falle). */
  assert.ok(html.includes("persons:Array.isArray(parsed.persons)?parsed.persons:[]"),
    'persons fehlt in der loadBueroLocal-Whitelist');
  assert.ok(html.includes("officeEmployees:[],persons:[],mapSettings"),
    'persons fehlt im Leerstand von loadBueroLocal');

  /* Der Unterschriften-Leser löst eine Personen-ID direkt zum Konto auf (Server). */
  const sig = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'documents', 'signature-routes.js'), 'utf8');
  assert.ok(sig.includes("SELECT user_id FROM persons WHERE id = ?"),
    'caregiverUserId kennt die Personen-ID nicht');

  /* Externe dürfen auch Fallverwalter anlegen (sonst wäre „Externe Person …" an der
     Fall-Vertretung für Nicht-Admins eine Sackgasse). */
  const pr = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'office', 'persons-routes.js'), 'utf8');
  assert.ok(pr.includes("art === 'extern' && (s.isAdmin || s.canManageOfficeProfile || s.allowCaseManagement)"),
    'Die Extern-Anlage verlangt wieder das Bürostammdaten-Recht');
});

test('Etappe 3: Personen-Feld an Finanz-Posten – Klarname nur mit Recht, sonst NUR die Kennung', async (t) => {
  const db = frischeDb(t, null);
  const express = require('express');
  for (const k of Object.keys(require.cache)) {
    if (/modules[\\/]finance[\\/]/.test(k)) delete require.cache[k];
  }
  const personsRoutes = require('../src/modules/office/persons-routes');
  const financeRoutes = require('../src/modules/finance/routes');
  /* finance_entries.updated_by verlangt einen ECHTEN Nutzer (Fremdschlüssel). */
  const uid = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('t','x')").run().lastInsertRowid);
  const app = express();
  app.use(express.json());
  let session = { userId: uid, isAdmin: true };
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/persons', personsRoutes);
  app.use('/api/finance', financeRoutes);
  const srv = app.listen(0);
  t.after(() => srv.close());
  const basis = `http://127.0.0.1:${srv.address().port}`;
  const ruf = (methode, weg, body) => fetch(basis + weg, {
    method: methode, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const zepp = (await (await ruf('POST', '/api/persons', { firstName: 'Christoph', lastName: 'Zepp', kennung: 'MA 1' })).json()).person;
  const ohneKennung = (await (await ruf('POST', '/api/persons', { firstName: 'Neu', lastName: 'Ohne' })).json()).person;
  const extern = (await (await ruf('POST', '/api/persons', { lastName: 'RA Hofmann', art: 'extern' })).json()).person;

  /* Anlegen mit Person (als Admin). */
  const posten = await (await ruf('POST', '/api/finance/entries', { kind: 'ausgabe', posten: 'Gehalt', frequenz: 'monatlich', summeMonatlich: 3200, personId: zepp.id })).json();
  assert.equal(posten.entry.personId, zepp.id);
  assert.equal(posten.entry.personName, 'Christoph Zepp');
  assert.equal(posten.entry.personKennung, 'MA 1');

  /* Ohne Kennung / extern: abgelehnt mit erklärendem Fehler. */
  assert.equal((await ruf('POST', '/api/finance/entries', { kind: 'ausgabe', posten: 'X', personId: ohneKennung.id })).status, 409);
  assert.equal((await ruf('POST', '/api/finance/entries', { kind: 'ausgabe', posten: 'X', personId: extern.id })).status, 400);

  /* OHNE Klarnamen-Recht: Liste liefert AUSSCHLIESSLICH die Kennung - weder Name noch ID
     verlassen den Server (fail-closed; es gibt clientseitig nichts zu entschlüsseln). */
  const uid2 = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('t2','x')").run().lastInsertRowid);
  session = { userId: uid2, isAdmin: false, canViewFinance: true, canEditFinance: true, canFinancePersonNames: false };
  const liste = await (await ruf('GET', '/api/finance/entries')).json();
  const e = liste.entries.find((x) => x.posten === 'Gehalt');
  assert.equal(e.personKennung, 'MA 1');
  assert.equal(e.personId, undefined, 'Die Personen-ID leckt an der Schranke vorbei');
  assert.equal(e.personName, undefined, 'Der Klarname leckt an der Schranke vorbei');

  /* Ohne Recht darf die Zuordnung auch nicht GESETZT oder GEÄNDERT werden - wer zuordnet,
     kennt die Zuordnung (Probezuordnungs-Loch). Posten selbst bleibt bearbeitbar. */
  assert.equal((await ruf('POST', '/api/finance/entries', { kind: 'ausgabe', posten: 'Y', personId: zepp.id })).status, 403);
  assert.equal((await ruf('PUT', '/api/finance/entries/' + e.id, { personId: null })).status, 403, 'Auch das Entfernen ist eine Änderung der Zuordnung');
  const nurPosten = await ruf('PUT', '/api/finance/entries/' + e.id, { posten: 'Gehalt (aktualisiert)' });
  assert.equal(nurPosten.status, 200, 'Ohne personId im Body muss der Posten normal bearbeitbar bleiben');
  assert.equal((await nurPosten.json()).entry.personKennung, 'MA 1', 'Die Zuordnung ging beim normalen Bearbeiten verloren');

  /* Mit Recht (kein Admin): Name + ID kommen, Ändern erlaubt. */
  const uid3 = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('t3','x')").run().lastInsertRowid);
  session = { userId: uid3, isAdmin: false, canViewFinance: true, canEditFinance: true, canFinancePersonNames: true };
  const liste2 = await (await ruf('GET', '/api/finance/entries')).json();
  assert.equal(liste2.entries[0].personName, 'Christoph Zepp');
  assert.equal((await ruf('PUT', '/api/finance/entries/' + e.id, { personId: null })).status, 200);
});

test('Etappe 3: Recht, Formular-Schranke, Excel-Spalte G, Auswertung', () => {
  /* Das 83. Einzelrecht - Katalog, Session, /api/me, Rechte-Matrix, Excel-Rechtespalte NUR am
     Ende (CZ), Zähltexte 82 -> 83. */
  const auth = fs.readFileSync(path.join(__dirname, '..', 'src', 'middleware', 'authorization.js'), 'utf8');
  assert.ok(auth.includes('financePersonNames:       { legacy: null, default: false },'), 'Das Recht fehlt im Katalog');
  const authRoutes = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'auth', 'routes.js'), 'utf8');
  assert.equal((authRoutes.match(/canFinancePersonNames/g) || []).length, 2, 'Session/me kennen das Recht nicht (beide Stellen)');
  assert.ok(html.includes("['financePersonNames','Personalkosten: Klarnamen sehen"), 'Die Rechte-Matrix zeigt das Recht nicht');
  assert.ok(html.includes("['CZ','financePersonNames']]"), 'Die Excel-Rechtespalte hängt nicht am Ende');
  assert.ok(html.includes('samt Profilen und den 83 Einzelrechten.'), 'Der Zähltext blieb auf 82');

  /* Formular: das Personen-Feld erscheint NUR mit Klarnamen-Recht (wer zuordnet, kennt die
     Zuordnung); ohne Recht wird eine bestehende Zuordnung als gesperrtes Pseudonym gezeigt
     und beim Speichern nicht angefasst (personId nur im Payload, wenn das Feld existierte). */
  assert.ok(html.includes('function financeDarfPersonen()'), 'Die Formular-Schranke fehlt');
  assert.ok(html.includes("if(personSel&&personSel.dataset.geladen==='1')payload.personId=personSel.value||null;"),
    'personId wird auch ohne gerendertes Feld gesendet - der Server würde 403 werfen');
  assert.ok(html.includes("p.aktiv!==false&&p.art!=='extern'&&String(p.maKennung||'').trim()"),
    'Die Personen-Auswahl filtert nicht auf aktive interne MIT Kennung');
  assert.ok(html.includes('function financePersonChip(e)') && (html.match(/financePersonChip\(e\)/g) || []).length >= 3,
    'Der Personen-Chip fehlt in den Tabellen');

  /* Excel: Spalte G trägt die KENNUNG (nie den Namen - das Blatt bleibt pseudonym); der
     Import löst sie nur MIT Recht zur ID auf und meldet Übersprungenes ehrlich. */
  assert.ok(html.includes("wa(rn,'G',e.personKennung,'text');") && html.includes("wo(rn,'G',e.personKennung,'text');"),
    'Der Export schreibt die Kennungs-Spalte nicht (laufend + einmalig)');
  assert.ok(html.includes("_kennung:bvStr(bvCell(row,'G'))"), 'Der Import liest die Kennungs-Spalte nicht');
  /* Bugjagd 30.08.2026: der Import schickt die Kennung als personKennung ROH an den Server
     (der sie fuer JEDEN Finanz-Bearbeiter aufloest) - vorher vernichtete der Rundlauf eines
     Nutzers ohne Klarnamen-Recht saemtliche Personen-Zuordnungen. */
  assert.ok(!html.includes('Personen-Spalte übersprungen'),
    'Der Import überspringt die Personen-Spalte wieder rechteabhängig (Zuordnungs-Vernichter)');
  assert.ok(html.includes('e.personKennung=k;'), 'Der Import reicht die Kennung nicht an den Server durch');
  const financeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'finance', 'routes.js'), 'utf8');
  assert.ok(financeSrc.includes("if (b.personKennung !== undefined) {"), 'Der Server kennt den personKennung-Weg nicht');
  assert.ok(financeSrc.includes('der Posten wurde ohne Personen-Zuordnung gespeichert'),
    'Unauflösbare Kennungen werfen statt ehrlich zu melden (Posten wäre nach dem Delete-all verloren)');
  /* Orakel zu: das Recht wird VOR dem Gleichheits-Kurzschluss geprüft. */
  const pruefen = financeSrc.slice(financeSrc.indexOf('function personIdPruefen'), financeSrc.indexOf('router.get(\'/entries\''));
  assert.ok(pruefen.indexOf('darfKlarnamen(req.session)') < pruefen.indexOf("(bestand || '') === gewuenscht"),
    'Der Gleichheits-Kurzschluss läuft wieder vor der Rechteprüfung (200/403-Orakel)');

  /* Controlling: „Personalkosten je Person“ - Beschriftung folgt dem Server (Name oder
     Kennung), Abschnitt zeigt sich nur mit mindestens einer Zuordnung. */
  assert.ok(html.includes('async function ctlPersonalkostenFuellen(lauf)') && html.includes('Personalkosten je Person'),
    'Die Auswertung fehlt im Controlling');
  assert.ok(html.includes('if(!labels.length){ kasten.hidden = true; return; }'),
    'Der Abschnitt stünde auch ohne eine einzige Zuordnung leer da');
});

test('Etappe 4: Alt-Tabelle weg (mit Sicherheitsgurt), alte Sicherungen klar abgelehnt', (t) => {
  /* 1) Eine Bestands-DB MIT Alt-Tabelle: Übernahme läuft, danach ist die Tabelle GELÖSCHT. */
  const db = frischeDb(t, (roh) => {
    roh.exec("ALTER TABLE office_employees ADD COLUMN ma_kennung TEXT NOT NULL DEFAULT ''");
    roh.prepare("INSERT INTO office_employees (id, first_name, last_name, role, ma_kennung) VALUES ('e1','Karim','Denizli','Verwaltung','MA 3')").run();
  });
  assert.ok(db.prepare("SELECT 1 FROM persons WHERE last_name='Denizli'").get(), 'Der Bestand wurde vor dem Abbau nicht übernommen');
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='office_employees'").get(), undefined,
    'Die Alt-Tabelle wurde nach der Übernahme nicht gelöscht');

  /* 2) Bugjagd 30.08.2026: der frühere separate "Sicherheitsgurt" war löchrig (persons nicht
     leer hieß NICHT übernommen - die Wertemigration legt selbst Externe an). Jetzt gilt:
     Übernahme und DROP laufen in EINER Transaktion (entweder beides oder nichts), und die
     Übernahme verschluckt keine Fehler mehr (kein try/catch, kein Leerheits-Gate). */
  const dbjs = fs.readFileSync(path.join(__dirname, '..', 'src', 'database', 'index.js'), 'utf8');
  const e1 = dbjs.slice(dbjs.indexOf('function personenBestandUebernehmen'), dbjs.indexOf('personenWerteAufIdUmschreiben'));
  assert.ok(e1.includes("if (altTabelle) db.exec('DROP TABLE office_employees');"),
    'Der DROP liegt nicht mehr in der Übernahme-Transaktion');
  assert.ok(e1.indexOf('db.transaction(') < e1.indexOf("db.exec('DROP TABLE office_employees')"),
    'Der DROP steht vor dem Transaktionsbeginn');
  assert.ok(!e1.includes('catch'), 'Die Übernahme verschluckt Fehler wieder (catch gefunden)');
  assert.ok(!e1.includes('if (n > 0) return;'), 'Das Alles-oder-nichts-Leerheits-Gate ist zurück');
  assert.ok(!dbjs.includes('CREATE TABLE IF NOT EXISTS office_employees'),
    'Die Alt-Tabelle wird auf frischen Datenbanken wieder angelegt');

  /* 3) Wiederherstellung: eine Vor-Register-Sicherung (officeEmployees da, persons fehlt)
     wird mit einer VERSTÄNDLICHEN Meldung abgelehnt - nicht mit "Tabelle persons fehlt". */
  const portable = require('../src/modules/backup/portable-data');
  assert.ok(!portable.TABLE_REGISTRY.some((e) => e.table === 'office_employees'),
    'Die Sicherungs-Registrierung kennt die Alt-Tabelle noch');
  const pd = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'backup', 'portable-data.js'), 'utf8');
  assert.ok(pd.includes("RESTORE_PRE_PERSONS_BACKUP"),
    'Die klare Ablehnung für Vor-Register-Sicherungen fehlt');
  assert.ok(pd.includes('vor dem Personenregister (August 2026) und kann nicht mehr eingelesen werden'),
    'Die Ablehnungsmeldung erklärt nicht, was die Sicherung ist');

  /* 4) Kein Server-Modul liest die Alt-Tabelle mehr (die Bestandsübernahme in database/index
     liest sie bewusst als Letzte - mit Existenz-Prüfung). */
  const treffer = [];
  const wurzeln = ['src/modules', 'src/integrations', 'src/middleware'];
  const ablaufen = (d) => {
    for (const eintrag of fs.readdirSync(d, { withFileTypes: true })) {
      const voll = path.join(d, eintrag.name);
      if (eintrag.isDirectory()) ablaufen(voll);
      else if (eintrag.name.endsWith('.js') && fs.readFileSync(voll, 'utf8').includes('FROM office_employees')) treffer.push(voll);
    }
  };
  for (const w of wurzeln) ablaufen(path.join(__dirname, '..', w));
  assert.deepEqual(treffer, [], 'Diese Module lesen noch die Alt-Tabelle');
});

test('Bugjagd 30.08.: Nutzer-Löschen löst die Person INNERHALB der Transaktion', () => {
  /* Der Fund: deleteUserTx löschte die users-Zeile, während persons.user_id noch auf sie
     zeigte (foreign_keys = ON) - der detach lief erst NACH der Transaktion. Folge: KEIN
     Nutzer ließ sich mehr löschen (SQLITE_CONSTRAINT). Pin: der detach steht jetzt im
     Transaktionskörper VOR dem DELETE. */
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'admin', 'routes.js'), 'utf8');
  const tx = admin.slice(admin.indexOf('const deleteUserTx'), admin.indexOf('assertActiveOnlineAdmin(db);', admin.indexOf('const deleteUserTx')));
  const detach = tx.indexOf('personen.detachPersonFromUser(userId);');
  const del = tx.indexOf('deleteUserStmt.run(userId);');
  assert.ok(detach > 0 && del > detach, 'detachPersonFromUser fehlt in deleteUserTx oder steht nach dem DELETE');
  assert.ok(!admin.includes('try { personen.detachPersonFromUser(user.id); } catch (_e) {}'),
    'Der zu späte detach-Aufruf nach der Transaktion lebt noch');
});

test('Bugjagd 30.08.: Stunden-Kaltcache – Auflösung wärmt sich selbst', () => {
  /* Der Fund: __qmGetStundenumfang/-Set lösen Namen über window.__qmPersons zur ID auf; auf
     kaltem Cache (Seite frisch geladen, direkt Personen/Bürostammdaten geöffnet) blieb der
     Namensschlüssel stehen -> Anzeige leer, Speichern spaltete die Daten (Wert unter dem
     Namensschlüssel, unauffindbar unter der ID). Pins auf beide Selbstheilungen: */
  assert.ok(html.includes("if(!(window.__qmPersons||[]).length)await gatherPersons();"),
    '__qmRefreshHours wärmt den Personen-Cache nicht');
  /* Nachschärfung gleicher Tag: NICHT auf __appMode==='online' begrenzen - im Außendienst
     reist das Register in bueroLocal.persons mit und braucht dieselbe Selbstheilung. */
  assert.ok(html.includes("if(k===norm(first,last)){"),
    '__qmSetStundenumfang schreibt bei kaltem Cache weiter unter den Namensschlüssel');
});

test('Bugjagd 30.08.: Bestandsübernahme heilt sich selbst (Riss-Szenario + Teilbestand)', (t) => {
  /* Der Fund: schlug die Übernahme fehl, legte die Wertemigration trotzdem Externe an und
     setzte ihren Marker. Beim nächsten Start blockierte das alte Leerheits-Gate ("persons
     nicht leer -> fertig") jede Wiederholung, und der alte DROP-Gurt warf office_employees
     samt NIE übernommener Mitarbeitender weg. Hier der hinterlassene Trümmerzustand: users
     voll, persons trägt NUR eine externe Person, Alt-Tabelle voll, E2-Marker gesetzt. */
  const db = frischeDb(t, (roh) => {
    roh.exec("ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT ''");
    roh.exec("ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT ''");
    roh.exec("ALTER TABLE users ADD COLUMN ma_kennung TEXT NOT NULL DEFAULT ''");
    roh.prepare("INSERT INTO users (id, username, password_hash, first_name, last_name, ma_kennung) VALUES (7,'heil','x','Christoph','Zepp','MA 1')").run();
    roh.exec(`CREATE TABLE persons (id TEXT PRIMARY KEY, art TEXT NOT NULL DEFAULT 'intern',
      user_id INTEGER UNIQUE REFERENCES users(id), first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '',
      salutation TEXT NOT NULL DEFAULT '', funktion TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '', mobile TEXT NOT NULL DEFAULT '', kennung TEXT NOT NULL DEFAULT '',
      joined_at TEXT NOT NULL DEFAULT '', left_at TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      aktiv INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    roh.prepare("INSERT INTO persons (id, art, last_name) VALUES ('x-extern','extern','RA Hofmann')").run();
    roh.exec("ALTER TABLE office_employees ADD COLUMN ma_kennung TEXT NOT NULL DEFAULT ''");
    roh.prepare("INSERT INTO office_employees (id, first_name, last_name, role, ma_kennung) VALUES ('e9','Miriam','Osei','Verwaltung','MA 4')").run();
    roh.exec(`CREATE TABLE office_json (key TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by INTEGER REFERENCES users(id))`);
    roh.prepare("INSERT INTO office_json (key, data_json) VALUES ('personen_e2','{}')").run();
  });
  /* Heilung: das Konto UND der Mitarbeiter sind jetzt Personen, die Externe blieb unangetastet,
     die Alt-Tabelle ist erst NACH der Übernahme gefallen. */
  const konto = db.prepare('SELECT * FROM persons WHERE user_id = 7').get();
  assert.ok(konto, 'Das Konto bekam trotz nicht-leerem Register keine Person (altes Gate?)');
  assert.equal(konto.kennung, 'MA 1');
  const osei = db.prepare("SELECT * FROM persons WHERE last_name = 'Osei'").get();
  assert.ok(osei && osei.user_id === null && osei.kennung === 'MA 4',
    'Der nie übernommene Mitarbeiter wurde beim Abbau weggeworfen statt übernommen');
  assert.ok(db.prepare("SELECT 1 FROM persons WHERE id = 'x-extern' AND art = 'extern'").get(), 'Die Externe ging verloren');
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='office_employees'").get(), undefined);

  /* Teilbestand: läuft die Übernahme erneut, entsteht KEINE zweite Person und keine
     Kennung-Dublette (habenKennung wird aus dem Register vorbelegt). */
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM persons').get().n, 3, 'Dubletten nach der Heilung');
});

test('Bugjagd 30.08.: Kennung ist rechtegeschützt, nur intern – und Namens-Match kapert keine Externen', async (t) => {
  const db = frischeDb(t, null);
  const express = require('express');
  const personsRoutes = require('../src/modules/office/persons-routes');
  const app = express();
  app.use(express.json());
  let session = { userId: 1, isAdmin: true };
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/persons', personsRoutes);
  const srv = app.listen(0);
  t.after(() => srv.close());
  const basis = `http://127.0.0.1:${srv.address().port}`;
  const ruf = (methode, weg, body) => fetch(basis + weg, {
    method: methode, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  /* 1) Kennung nur für INTERNE: eine externe Person mit Kennung ließe sich Personalkosten
     zuordnen und riss den Excel-Finanzimport (400 NACH dem Delete-all = Posten weg). */
  const intern = await (await ruf('POST', '/api/persons', { firstName: 'Sabine', lastName: 'Falkner', kennung: 'MA 2', notes: 'vertraulich' })).json();
  assert.equal(intern.person.kennung, 'MA 2');
  assert.equal((await ruf('POST', '/api/persons', { lastName: 'RA Hofmann', art: 'extern', kennung: 'MA 9' })).status, 400,
    'Externe Person nahm eine Kennung an');
  assert.equal((await ruf('PUT', '/api/persons/' + intern.person.id, { art: 'extern' })).status, 400,
    'Interne MIT Kennung ließ sich auf extern stellen (Kennung bliebe an einer Externen kleben)');

  /* 2) Die Kennung-zu-Name-Karte gibt es nur mit Klarnamen-Recht oder als Admin. Ohne beides
     fehlen kennung UND notes in der Antwort komplett - es gibt nichts zu entschlüsseln.
     Gemessen: vorher lieferte GET /api/persons jedem Angemeldeten beide Felder. */
  session = { userId: 2, isAdmin: false };
  let liste = (await (await ruf('GET', '/api/persons')).json()).persons;
  assert.ok(liste.length >= 1);
  assert.ok(liste.every((p) => !('kennung' in p) && !('notes' in p)),
    'Ohne Recht kommen kennung/notes weiter über die Leitung – das 83. Recht wäre wirkungslos');
  session = { userId: 2, isAdmin: false, canFinancePersonNames: true };
  liste = (await (await ruf('GET', '/api/persons')).json()).persons;
  assert.ok(liste.some((p) => p.kennung === 'MA 2'), 'Mit Klarnamen-Recht fehlt die Kennung');
  assert.ok(liste.every((p) => !('notes' in p)), 'notes (Admin-Notizfeld) leakt an Nicht-Admins');
  session = { userId: 1, isAdmin: true };

  /* 3) ensurePersonForUser: gleichnamige EXTERNE/DEAKTIVIERTE werden nicht mehr gekapert;
     eine explizite personId verknüpft deterministisch (Namens-Korrektur im Formular erzeugt
     keine Duplikat-Person mehr). */
  const extern = await (await ruf('POST', '/api/persons', { firstName: 'Miriam', lastName: 'Osei', art: 'extern' })).json();
  db.prepare("INSERT INTO users (id, username, password_hash, first_name, last_name) VALUES (21,'mosei','x','Miriam','Osei')").run();
  const pid1 = personsRoutes.ensurePersonForUser(21);
  assert.notEqual(pid1, extern.person.id, 'Der Namens-Match kaperte die gleichnamige EXTERNE Person');
  assert.equal(db.prepare('SELECT art FROM persons WHERE id = ?').get(extern.person.id).art, 'extern');

  db.prepare("INSERT INTO users (id, username, password_hash, first_name, last_name) VALUES (22,'sfalk','x','S.','Falkner-Korrigiert')").run();
  const pid2 = personsRoutes.ensurePersonForUser(22, intern.person.id);
  assert.equal(pid2, intern.person.id, 'Die explizite personId verknüpfte nicht die gewählte Person');
  assert.equal(db.prepare('SELECT user_id FROM persons WHERE id = ?').get(intern.person.id).user_id, 22);
  db.prepare("INSERT INTO users (id, username, password_hash, first_name, last_name) VALUES (23,'dritt','x','Karim','Denizli')").run();
  assert.throws(() => personsRoutes.ensurePersonForUser(23, intern.person.id), /Nutzerkonto/,
    'Eine bereits verknüpfte Person ließ sich einem zweiten Konto zuordnen');
});

test('Bugjagd 30.08.: Client-Pins der übrigen Fixes (QM, Excel-Mitarbeiter, Vertretungsplan, Konto anlegen)', () => {
  /* QM-Neuanlage: Fehlschlag wird gemeldet (Servermeldung!), Stunden erst NACH dem Neuladen
     - vorher kam "Mitarbeiter/in angelegt." auch beim Kennung-409, und die Stunden landeten
     als Waise unter dem Namensschlüssel. */
  assert.ok(html.includes("if(!erg||!erg.ok){toast((erg&&erg.error)||'Anlegen fehlgeschlagen.');return;}"),
    'saveNewEmployee feiert Fehlschläge wieder als Erfolg');
  const neu = html.indexOf("var erg=await window.__officeProfile.saveEmployee(null,");
  assert.ok(neu > 0 && html.indexOf('QM.persons=window.__qmPersons=await gatherPersons();', neu)
    < html.indexOf('await window.__qmSetStundenumfang(first,last,hours);', neu),
    'Die Stunden werden wieder VOR dem Personen-Neuladen geschrieben (Waisen-Eintrag)');
  assert.ok(html.includes("return {ok:res.ok,error:data.error||''};"), 'saveEmployee verschluckt die Servermeldung');

  /* Namensgleichheit: die aktive interne Person gewinnt die Auflösung. */
  assert.ok(html.includes("var p=alle.find(function(x){return x.aktiv!==false&&x.art!=='extern';})||alle[0];"),
    'qmSchluesselFuer nimmt wieder blind den ersten Namenstreffer');

  /* Außendienst: lokal angelegte Mitarbeitende werden in die Register-Liste gemerged. */
  assert.ok(html.includes('unsichtbar (Bugjagd 30.08.2026). Namensschluessel, wie im alten Lokalmodus.'),
    'gatherPersons kehrt im Außendienst wieder vor lokal Angelegten um');

  /* Excel-Mitarbeiter-Import: Konto-Zeilen bleiben dem employees-Zweig fern (sonst je Rundlauf
     eine Namens-Dublette bzw. ein stilles Kennung-409). */
  assert.ok(html.includes('const kontoZeile=(e)=>!!(e.extra.username&&kontoNamen.has(e.extra.username.toLowerCase()));'),
    'Der Mitarbeiter-Import trennt Konto-Zeilen nicht mehr ab');
  assert.ok(html.includes('nicht übernommen'), 'employees-PUT/POST-Fehler bleiben wieder stumm');

  /* Vertretungsplan: EIN In-flight-Riegel für Eintragen und Entfernen. */
  assert.ok(html.includes('let vtLauf=false;'), 'Der Vertretungsplan-Riegel fehlt');
  assert.equal((html.match(/if\(vtLauf\)return; vtLauf=true;/g) || []).length, 2,
    'Eintragen UND Entfernen müssen den Riegel nutzen');

  /* Fehlgeschlagenes Zuweisen: Auswahl springt auf den gespeicherten Stand zurück. */
  assert.ok(html.includes('function caseWahlZurueck(sel,attribut,caseId)'), 'Der Auswahl-Rollback fehlt');
  assert.ok((html.match(/caseWahlZurueck\((null|el),'data-(rb|vt)-case',caseId\)/g) || []).length >= 4,
    'Nicht alle Fehlerpfade setzen die Auswahl zurück');

  /* Konto anlegen: die Personen-ID reist bis zum POST /users mit. */
  assert.ok(html.includes('let kontoAnlegenPersonId=null;')
    && html.includes('if(isNew&&kontoAnlegenPersonId)payload.personId=kontoAnlegenPersonId;'),
    'personKontoAnlegen verlässt sich wieder auf den Namensabgleich');

  /* Personen-Formular: Kennung-Feld nur für interne; savePerson schickt sie für Externe nicht. */
  assert.ok(html.includes('perInternFelder'), 'Das Kennung-Feld steht Externen wieder offen');
  assert.ok(html.includes("if(!wirdExtern)body.kennung=v('perKennung');"), 'savePerson schickt die Kennung auch für Externe');

  /* Finanzformular-Race: das Personen-Select startet gesperrt, gesendet wird nur nach Füllung. */
  assert.ok(html.includes('<select id="financeFormPerson" disabled'), 'Das Personen-Select startet wieder offen');

  /* Server-Pins: POST /users prüft die Kennung VOR dem Anlegen (in einer Transaktion mit
     ensurePersonForUser), employees-API liefert die Kennung nur mit Recht/Admin. */
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'admin', 'routes.js'), 'utf8');
  assert.ok(admin.includes('personen.kennungKonflikt((req.body || {}).maKennung, personId'),
    'POST /users verschluckt Kennung-Konflikte wieder still');
  assert.ok(admin.includes('personen.ensurePersonForUser(userId, personId);'),
    'POST /users reicht die personId nicht an die Verknüpfung durch');
  const profil = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'office', 'profile-routes.js'), 'utf8');
  assert.ok(profil.includes('function darfEmployeeKennung(session)') && profil.includes('employeesBody(req.session)'),
    'Die employees-API liefert die Kennung-zu-Name-Karte wieder an jeden');
});
