'use strict';

/* Pruefstand fuer die Recovery-Selbstheilung (Vorfall 25.08.2026).

   Nachgestellt wird der echte Hergang: Server startet EINMAL ohne ENCRYPTION_KEY, geht in
   Quarantaene - und der naechste Start MIT unveraendertem Schluessel muss die Quarantaene
   selbst aufheben, statt in der "encryption_key_changed_during_recovery"-Sackgasse zu enden.
   Jeder Gefahrenfall (fremder Schluessel, Restore-Marker, Disaster-Grund, laufender
   Artefakt-Restore) muss weiterhin fail-closed in der Quarantaene bleiben. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const mode = require('../src/modules/recovery/mode');

const SCHLUESSEL_A = crypto.randomBytes(32).toString('hex');
const SCHLUESSEL_B = crypto.randomBytes(32).toString('hex');

function sandkasten() {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'selbstheilung-'));
  const daten = path.join(wurzel, 'data');
  fs.mkdirSync(daten, { recursive: true });
  return { wurzel, daten, dbPfad: path.join(wurzel, 'probe.sqlite3') };
}

/* Jeder "Serverstart" ist eine FRISCHE Datenbankverbindung - ensure() haelt seine Instanz
   je db-Objekt in einer WeakMap, eine neue Verbindung erzwingt einen neuen Durchlauf. */
function start(sk, schluessel) {
  const db = new Database(sk.dbPfad);
  const env = { DOCUMENTS_DATA_ROOT: sk.daten };
  if (schluessel) env.ENCRYPTION_KEY = schluessel;
  const instanz = mode.ensure(db, { env });
  const zeile = db.prepare('SELECT * FROM recovery_security_state WHERE id=1').get();
  return { db, instanz, zeile };
}

function geheimnisAblegen(sk, schluessel) {
  /* Ein echtes Geheimnis unter dem gegebenen Schluessel, in einer Spalte, die der
     Quarantaene-Check tatsaechlich prueft (office_profile.maps_api_key_encrypted). */
  const alt = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = schluessel;
  try {
    const ch = require('../src/security/crypto');
    const wert = ch.encrypt('streng-geheimer-kartenschluessel');
    const db = new Database(sk.dbPfad);
    db.exec('CREATE TABLE IF NOT EXISTS office_profile (id INTEGER PRIMARY KEY, maps_api_key_encrypted TEXT)');
    db.prepare('INSERT INTO office_profile (id, maps_api_key_encrypted) VALUES (1, ?)').run(wert);
    db.close();
  } finally {
    if (alt === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = alt;
  }
}

/* validateEncryptedState entschluesselt ueber security/crypto, das process.env liest -
   fuer die Dauer eines Starts muss der Prozess-Schluessel dem env-Schluessel entsprechen. */
function mitProzessSchluessel(schluessel, tu) {
  const alt = process.env.ENCRYPTION_KEY;
  if (schluessel) process.env.ENCRYPTION_KEY = schluessel; else delete process.env.ENCRYPTION_KEY;
  try { return tu(); }
  finally { if (alt === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = alt; }
}

test('Der Vorfall vom 25.08.: Schluessel kurz weg -> Selbstheilung statt Sackgasse', () => {
  const sk = sandkasten();
  try {
    /* Normaler Betrieb bindet Schluessel A und legt ein Geheimnis ab. */
    let lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 0);
    const gebunden = lauf.zeile.encryption_key_id;
    assert.ok(gebunden.startsWith('dek_'));
    lauf.db.close();
    geheimnisAblegen(sk, SCHLUESSEL_A);

    /* Start OHNE Schluessel: fail-closed in Quarantaene - das ist richtig so. */
    lauf = mitProzessSchluessel('', () => start(sk, ''));
    assert.equal(Number(lauf.zeile.quarantine), 1);
    assert.equal(lauf.zeile.reason, 'encryption_key_invalid');
    lauf.db.close();

    /* Start MIT demselben Schluessel: vorher die Sackgasse, jetzt die Selbstheilung. */
    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 0, 'die Sackgasse ist zurueck');
    assert.notEqual(lauf.zeile.reason, 'encryption_key_changed_during_recovery');
    assert.equal(lauf.zeile.encryption_key_id, gebunden, 'der gebundene Schluessel wechselte');
    assert.ok(lauf.zeile.released_at, 'die Freigabe ist nicht dokumentiert');
    assert.equal(lauf.instanz.isActive(), false);
    lauf.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});

test('Frische Datenbank waehrend des Ausfalls: erster Schluessel wird nachgebunden', () => {
  const sk = sandkasten();
  try {
    let lauf = mitProzessSchluessel('', () => start(sk, ''));
    assert.equal(Number(lauf.zeile.quarantine), 1);
    assert.equal(lauf.zeile.encryption_key_id, '', 'es darf nie ein Schluessel gebunden gewesen sein');
    lauf.db.close();

    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 0, 'Erststart-Nachholung verweigert');
    assert.ok(lauf.zeile.encryption_key_id.startsWith('dek_'));
    lauf.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});

test('Gefahrenfall 1: fremder Schluessel bleibt in Quarantaene', () => {
  const sk = sandkasten();
  try {
    let lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    lauf.db.close();
    geheimnisAblegen(sk, SCHLUESSEL_A);

    /* Start mit ANDEREM Schluessel: weder heilen noch freigeben. */
    lauf = mitProzessSchluessel(SCHLUESSEL_B, () => start(sk, SCHLUESSEL_B));
    assert.equal(Number(lauf.zeile.quarantine), 1, 'fremder Schluessel wurde freigegeben');
    lauf.db.close();

    /* Auch nach einem zwischenzeitlichen Ausfall heilt der fremde Schluessel nicht. */
    lauf = mitProzessSchluessel('', () => start(sk, ''));
    lauf.db.close();
    lauf = mitProzessSchluessel(SCHLUESSEL_B, () => start(sk, SCHLUESSEL_B));
    assert.equal(Number(lauf.zeile.quarantine), 1, 'Ausfall+fremder Schluessel wurde freigegeben');
    lauf.db.close();

    /* Der URSPRUENGLICHE Schluessel dagegen heilt - der Admin hat den Fehlgriff korrigiert. */
    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 0, 'der zurueckgekehrte Originalschluessel heilt nicht');
    lauf.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});

test('Gefahrenfall 2: Restore-Marker blockiert die Selbstheilung - auch ein unguueltiger', () => {
  const sk = sandkasten();
  try {
    let lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    lauf.db.close();
    lauf = mitProzessSchluessel('', () => start(sk, ''));
    lauf.db.close();

    /* Ein Marker, der nicht einmal dem Format entspricht: present zaehlt, valid nicht. */
    fs.writeFileSync(path.join(sk.daten, mode._test.MARKER_NAME), 'kaputt');
    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 1, 'Marker wurde ignoriert');
    lauf.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});

test('Gefahrenfall 3: Disaster-Grund heilt nie - und ein Schluessel-Ausfall ueberschreibt ihn nicht mehr', () => {
  const sk = sandkasten();
  try {
    let lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    lauf.db.close();

    /* Disaster-Zustand von Hand setzen (so hinterlaesst ihn der Gesamt-Restore in der DB). */
    const db = new Database(sk.dbPfad);
    db.prepare(`UPDATE recovery_security_state
      SET quarantine=1, reason='disaster_restore', activated_at='2026-08-25T00:00:00Z'
      WHERE id=1`).run();
    db.close();

    /* Der Schluessel-Ausfall dazwischen: der Grund muss DISASTER bleiben. Vorher
       ueberschrieb dieser Start den Grund mit encryption_key_invalid - genau das Loch,
       durch das die Selbstheilung einen Disaster-Zustand haette freigeben koennen. */
    lauf = mitProzessSchluessel('', () => start(sk, ''));
    assert.equal(lauf.zeile.reason, 'disaster_restore', 'Schluessel-Ausfall klaut den Disaster-Grund');
    lauf.db.close();

    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 1, 'Disaster-Zustand wurde selbst geheilt');
    /* Zweites Loch derselben Analyse: die Eskalation bei abweichendem Zielschluessel darf
       den Disaster-Grund NICHT zu "encryption_key_changed_during_recovery" umetikettieren -
       der laege in der selbstheilbaren Familie, und der naechste Start heilte ihn frei. */
    assert.equal(lauf.zeile.reason, 'disaster_restore', 'Disaster-Grund wurde umetikettiert');
    lauf.db.close();

    /* Und auch beim x-ten Start mit Schluessel bleibt alles stehen. */
    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 1);
    assert.equal(lauf.zeile.reason, 'disaster_restore');
    lauf.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});

test('Gefahrenfall 4: laufender Artefakt-Restore wird nicht ueberholt', () => {
  const sk = sandkasten();
  try {
    let lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    lauf.db.close();
    const db = new Database(sk.dbPfad);
    db.prepare(`UPDATE recovery_security_state
      SET quarantine=1, reason='encryption_key_invalid',
          security_generation_id='gen-1'
      WHERE id=1`).run();
    db.close();

    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 1, 'der begonnene Freigabeweg wurde ueberholt');
    lauf.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});

test('Selbstheilung raeumt Sitzungen ab', () => {
  const sk = sandkasten();
  try {
    let lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    lauf.db.close();
    lauf = mitProzessSchluessel('', () => start(sk, ''));
    lauf.db.close();
    /* Eine Sitzung aus der Quarantaenezeit. */
    const db = new Database(sk.dbPfad);
    db.exec("CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL)");
    db.prepare("INSERT INTO sessions (sid, data, expires_at) VALUES ('alt','{}',9999999999)").run();
    db.close();

    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 0);
    const uebrig = lauf.db.prepare('SELECT COUNT(*) n FROM sessions').get().n;
    assert.equal(uebrig, 0, 'Quarantaene-Sitzungen ueberleben die Selbstheilung');
    lauf.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});

/* ─── Nachtraege aus der adversarialen Pruefung (25.08.2026 abends) ───
   Drei Angreifer + Skeptiker-Gegenpruefung fanden 7 bestaetigte Befunde. Jeder bekommt hier
   sein nachgestelltes Szenario - ausgefuehrt, nicht gegrept. */

test('Angriff 1: Symlink-Alias macht den Fortschrittsmarker nicht mehr unsichtbar', () => {
  const sk = sandkasten();
  try {
    /* Der Server laeuft ueber einen Alias, das Restore-Werkzeug verlangt den Realpfad -
       es schreibt seinen Fortschrittsmarker fuer den REALPFAD-Hash. */
    const alias = path.join(sk.wurzel, 'daten-alias');
    fs.symlinkSync(sk.daten, alias);
    const skAlias = { ...sk, daten: alias };

    let lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(skAlias, SCHLUESSEL_A));
    lauf.db.close();
    lauf = mitProzessSchluessel('', () => start(skAlias, ''));
    lauf.db.close();

    /* Marker fuer den REALPFAD (so rechnet ihn das Werkzeug). */
    const ort = mode._test.restoreProgressMarkerPath({ DOCUMENTS_DATA_ROOT: fs.realpathSync(alias) });
    fs.writeFileSync(ort.file, 'halbfertig');

    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(skAlias, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 1,
      'Selbstheilung gab mitten im Gesamt-Restore frei (Alias-Blindheit)');
    assert.equal(lauf.instanz.status().selbstheilung.blocker, 'fortschrittsmarker_vorhanden');
    lauf.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});

test('Angriff 1b: gewechselte Datenwurzel heilt nicht (die alte traegt die Marker)', () => {
  const sk = sandkasten();
  try {
    /* Normalbetrieb bindet die kanonische Wurzel in der DB fest. */
    let lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(lauf.zeile.bound_data_root, fs.realpathSync(sk.daten), 'Wurzel-Bindung fehlt');
    lauf.db.close();
    lauf = mitProzessSchluessel('', () => start(sk, ''));
    lauf.db.close();

    /* Start mit Schluessel, aber ANDERER Wurzel (Umzug im Wartungsfenster). */
    const neueWurzel = path.join(sk.wurzel, 'data-neu');
    fs.mkdirSync(neueWurzel, { recursive: true });
    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start({ ...sk, daten: neueWurzel }, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 1, 'fremde Wurzel wurde freigeheilt');
    assert.equal(lauf.instanz.status().selbstheilung.blocker, 'datenwurzel_gewechselt');
    lauf.db.close();

    /* Mit der ALTEN Wurzel heilt es weiterhin. */
    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 0, 'die richtige Wurzel heilt nicht mehr');
    lauf.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});

test('Angriff 2+5: der begonnene Artefakt-Freigabeweg ueberlebt Ausfall UND Eskalation', () => {
  const sk = sandkasten();
  try {
    let lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    lauf.db.close();
    lauf = mitProzessSchluessel('', () => start(sk, ''));
    lauf.db.close();

    /* Der Admin hat waehrend der Quarantaene das Sicherheits-Artefakt eingelesen. */
    const db = new Database(sk.dbPfad);
    db.prepare(`UPDATE recovery_security_state
      SET security_generation_id='gen-2026-08', token_disposition='restore' WHERE id=1`).run();
    db.close();

    /* Noch ein Schluessel-Ausfall dazwischen: darf die Felder NICHT abraeumen. */
    let zeile = mitProzessSchluessel('', () => start(sk, ''));
    assert.equal(zeile.zeile.security_generation_id, 'gen-2026-08', 'Keyless-Start loescht den Artefaktweg');
    assert.equal(zeile.zeile.token_disposition, 'restore');
    zeile.db.close();

    /* Start mit Schluessel: Heilung verweigert, Eskalation erhaelt die Felder,
       Zielschluessel wird trotzdem aktuell (artifactsComplete vergleicht ihn). */
    zeile = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(zeile.zeile.quarantine), 1, 'Artefaktweg wurde ueberholt');
    assert.equal(zeile.zeile.security_generation_id, 'gen-2026-08', 'Eskalation loescht den Artefaktweg');
    assert.equal(zeile.zeile.token_disposition, 'restore', 'Token-Entscheidung geloescht');
    assert.ok(zeile.zeile.target_encryption_key_id.startsWith('dek_'), 'Zielschluessel nicht aktualisiert');
    assert.equal(zeile.instanz.status().selbstheilung.blocker, 'artefaktweg_begonnen');
    zeile.db.close();

    /* Und auch der NAECHSTE Neustart heilt nicht frei - das war der Kern des Angriffs. */
    zeile = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(zeile.zeile.quarantine), 1, 'zweiter Neustart ueberholte den Freigabeweg');
    zeile.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});

test('Angriff 3: falscher Erstschluessel wird nicht gebunden - der richtige heilt spaeter', () => {
  const sk = sandkasten();
  try {
    /* Legacy-Datenbank: Geheimnis unter A, aber noch keine Recovery-Zeile. */
    const db = new Database(sk.dbPfad);
    db.close();
    geheimnisAblegen(sk, SCHLUESSEL_A);

    /* Erststart mit FALSCHEM Schluessel B: Quarantaene, aber B darf nicht als
       gebundener Schluessel enden. */
    let lauf = mitProzessSchluessel(SCHLUESSEL_B, () => start(sk, SCHLUESSEL_B));
    assert.equal(Number(lauf.zeile.quarantine), 1);
    assert.equal(lauf.zeile.encryption_key_id, '', 'der falsche Schluessel wurde gebunden');
    lauf.db.close();

    /* Der korrigierte richtige Schluessel heilt - vorher eine Wiedereinspiel-Sackgasse. */
    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 0, 'der richtige Schluessel heilt die Erststart-Panne nicht');
    lauf.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});

test('Angriff 4+6: ehrliche Etiketten - kein "Schluessel geaendert" bei identischen Schluesseln', () => {
  const sk = sandkasten();
  try {
    let lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    lauf.db.close();
    /* Ein Altwert, der unter einem VERSCHOLLENEN Schluessel liegt. */
    geheimnisAblegen(sk, SCHLUESSEL_B);
    lauf = mitProzessSchluessel('', () => start(sk, ''));
    lauf.db.close();

    /* Start mit A (== gebunden): Die Heilung scheitert am unlesbaren Altwert - der Grund
       muss das SAGEN statt faelschlich einen Schluesselwechsel zu behaupten. */
    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.equal(Number(lauf.zeile.quarantine), 1);
    assert.equal(lauf.zeile.reason, 'legacy_secret_decryption_failed',
      'identische Schluessel wurden als "geaendert" etikettiert');
    const sh = lauf.instanz.status().selbstheilung;
    assert.equal(sh.blocker, 'geheimnis_unlesbar');
    assert.match(sh.detail, /office_profile\.maps_api_key_encrypted/, 'der Blocker nennt die Fundstelle nicht');
    lauf.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});

test('Angriff 7: die verweigerte Heilung ist im Status sichtbar', () => {
  const sk = sandkasten();
  try {
    let lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    assert.deepEqual(lauf.instanz.status().selbstheilung, { geprueft: false },
      'ohne Quarantaene darf kein Heilungsbefund behauptet werden');
    lauf.db.close();
    lauf = mitProzessSchluessel('', () => start(sk, ''));
    lauf.db.close();
    fs.writeFileSync(path.join(sk.daten, mode._test.MARKER_NAME), 'kaputt');
    lauf = mitProzessSchluessel(SCHLUESSEL_A, () => start(sk, SCHLUESSEL_A));
    const sh = lauf.instanz.status().selbstheilung;
    assert.equal(sh.geprueft, true);
    assert.equal(sh.geheilt, false);
    assert.equal(sh.blocker, 'restore_marker_vorhanden');
    lauf.db.close();
  } finally { fs.rmSync(sk.wurzel, { recursive: true, force: true }); }
});
