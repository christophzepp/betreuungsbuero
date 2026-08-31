'use strict';

/*
 * Wiederanlauf-Schutz nach dem Einspielen einer Datenbank auf einer Installation mit
 * neuem ENCRYPTION_KEY. Der Zustand liegt absichtlich in der Datenbank: dadurch reist
 * die Kennung des bisherigen internen Schlüssels mit der SQLite-Vollsicherung mit.
 *
 * Im Quarantänemodus sind ausschließlich Admin-Anmeldung, Status und die portable
 * Schema-3-Wiederherstellung erreichbar. Der Prozess bleibt auch nach der Freigabe bis
 * zum Neustart gesperrt, damit kein beim Start ausgelassener Hintergrunddienst halb
 * initialisiert nachträglich losläuft.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_ROOT } = require('../../config/paths');
const cryptoHelper = require('../../security/crypto');
const backupData = require('../backup/portable-data');

const TABLE = 'recovery_security_state';
const MARKER_NAME = '.recovery-quarantine';
const MARKER_FORMAT = 'Betreuungsbuero-Recovery-Quarantaene/1';
const PROGRESS_MARKER_PREFIX = '.betreuungsbuero-restore-in-progress-';
const PROGRESS_MARKER_FORMAT = 'Betreuungsbuero-Restore-In-Progress/1';
const instances = new WeakMap();

const DIRECT_SECRET_COLUMNS = Object.freeze([
  ...backupData.portableSecretLocations().map(({ table, column }) =>
    Object.freeze([table, column])
  ),
  // Historische Installationen können den Google-Maps-Schlüssel zusätzlich noch
  // in office_profile tragen. Die Migration kopiert ihn zwar nach map_settings,
  // der Quarantäne-Check darf sich darauf aber nicht still verlassen.
  Object.freeze(['office_profile', 'maps_api_key_encrypted'])
]);
const MOUNT_SECRET_FIELDS = Object.freeze(backupData.portableMountSecretFields());

function currentEncryptionKeyId(env) {
  const hex = String((env || process.env).ENCRYPTION_KEY || '');
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    const error = new Error('ENCRYPTION_KEY fehlt oder ist kein 32-Byte-Hexschlüssel.');
    error.code = 'RECOVERY_ENCRYPTION_KEY_INVALID';
    throw error;
  }
  const id = crypto.scryptSync(
    Buffer.from(hex, 'hex'),
    Buffer.from('Betreuungsbuero-Internal-Key-ID/v1', 'utf8'),
    20,
    { N: 16384, r: 8, p: 1 }
  ).toString('hex');
  return `dek_${id}`;
}

function tableExists(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function columnExists(db, table, column) {
  if (!tableExists(db, table)) return false;
  return db.prepare(`PRAGMA table_info("${table}")`).all().some((entry) => entry.name === column);
}

function validateEncryptedState(db) {
  const failures = [];
  let checked = 0;
  for (const [table, column] of DIRECT_SECRET_COLUMNS) {
    if (!columnExists(db, table, column)) continue;
    const rows = db.prepare(
      `SELECT "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}"<>''`
    ).all();
    for (const row of rows) {
      checked++;
      try { cryptoHelper.decryptStrict(row.value); }
      catch (_error) { failures.push({ table, column }); }
    }
  }
  if (columnExists(db, 'doc_mounts', 'config_json')) {
    for (const row of db.prepare("SELECT config_json FROM doc_mounts WHERE config_json<>''").all()) {
      let config;
      try { config = JSON.parse(row.config_json || '{}'); }
      catch (_error) {
        failures.push({ table: 'doc_mounts', column: 'config_json' });
        continue;
      }
      for (const field of MOUNT_SECRET_FIELDS) {
        if (!config[field]) continue;
        checked++;
        try { cryptoHelper.decryptStrict(config[field]); }
        catch (_error) { failures.push({ table: 'doc_mounts', column: `config_json.${field}` }); }
      }
    }
  }
  return { ok: failures.length === 0, checked, failures };
}

function inspectRestoreMarker(env) {
  const dataRoot = path.resolve(String(
    (env || process.env).DOCUMENTS_DATA_ROOT
    || (env || process.env).DATA_DIR
    || DATA_ROOT
  ));
  const file = path.join(dataRoot, MARKER_NAME);
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') return { present: false, valid: false, file, dataRoot };
    return { present: true, valid: false, file, dataRoot, error: error.message || String(error) };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return {
      present: true,
      valid: false,
      file,
      dataRoot,
      error: 'Der Recovery-Marker ist keine reguläre Datei.'
    };
  }
  if (stat.size < MARKER_FORMAT.length || stat.size > 4096) {
    return { present: true, valid: false, file, dataRoot, error: 'Der Recovery-Marker hat eine ungültige Größe.' };
  }
  let text;
  try {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    try { text = fs.readFileSync(descriptor, 'utf8'); }
    finally { fs.closeSync(descriptor); }
  } catch (error) {
    return { present: true, valid: false, file, dataRoot, error: error.message || String(error) };
  }
  const lines = String(text).replace(/\r/g, '').trimEnd().split('\n');
  const fields = {};
  for (const line of lines.slice(1)) {
    const separator = line.indexOf('=');
    if (separator < 1) {
      return { present: true, valid: false, file, dataRoot, error: 'Der Recovery-Marker enthält eine ungültige Zeile.' };
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!['RESTORED_AT', 'SNAPSHOT', 'BACKGROUND_JOBS'].includes(key) || Object.hasOwn(fields, key)) {
      return { present: true, valid: false, file, dataRoot, error: 'Der Recovery-Marker enthält unbekannte oder doppelte Felder.' };
    }
    fields[key] = value;
  }
  const valid = lines[0] === MARKER_FORMAT
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(fields.RESTORED_AT || ''))
    && /^[^/\\\0]{1,255}$/.test(String(fields.SNAPSHOT || ''))
    && fields.BACKGROUND_JOBS === 'DISABLED_UNTIL_ADMIN_RELEASE';
  return {
    present: true,
    valid,
    file,
    dataRoot,
    restoredAt: String(fields.RESTORED_AT || ''),
    snapshot: String(fields.SNAPSHOT || ''),
    ...(valid ? {} : { error: 'Der Recovery-Marker hat nicht das erwartete Format.' })
  };
}

function canonicalDataRoot(env) {
  const raw = path.resolve(String(
    (env || process.env).DOCUMENTS_DATA_ROOT
    || (env || process.env).DATA_DIR
    || DATA_ROOT
  ));
  const parent = path.dirname(raw);
  let canonicalParent = parent;
  try { canonicalParent = fs.realpathSync(parent); }
  catch (_error) { /* Ein fehlender Parent wird vom Marker-Leseweg fail-closed behandelt. */ }
  return path.join(canonicalParent, path.basename(raw));
}

function restoreProgressMarkerPath(env) {
  const dataRoot = canonicalDataRoot(env);
  const targetHash = crypto.createHash('sha256').update(dataRoot, 'utf8').digest('hex');
  return {
    dataRoot,
    targetHash,
    file: path.join(
      path.dirname(dataRoot),
      `${PROGRESS_MARKER_PREFIX}${targetHash.slice(0, 24)}`
    )
  };
}

function inspectRestoreProgressMarker(env) {
  const location = restoreProgressMarkerPath(env);
  let named;
  let descriptor;
  let text;
  try {
    named = fs.lstatSync(location.file);
    if (named.isSymbolicLink() || !named.isFile()) {
      return {
        ...location,
        present: true,
        valid: false,
        error: 'Der Restore-Fortschrittsmarker ist keine reguläre Datei.'
      };
    }
    if (named.size < PROGRESS_MARKER_FORMAT.length || named.size > 4096) {
      return {
        ...location,
        present: true,
        valid: false,
        error: 'Der Restore-Fortschrittsmarker hat eine ungültige Größe.'
      };
    }
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    descriptor = fs.openSync(location.file, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino) {
      throw new Error('Der Restore-Fortschrittsmarker wurde während des Öffnens ausgetauscht.');
    }
    text = fs.readFileSync(descriptor, 'utf8');
    const after = fs.fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || after.ctimeMs !== opened.ctimeMs) {
      throw new Error('Der Restore-Fortschrittsmarker wurde während des Lesens verändert.');
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { ...location, present: false, valid: false };
    }
    return {
      ...location,
      present: true,
      valid: false,
      error: error.message || String(error)
    };
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_error) { /* eigener Lesedeskriptor */ }
    }
  }

  const lines = String(text).replace(/\r/g, '').trimEnd().split('\n');
  const fields = {};
  for (const line of lines.slice(1)) {
    const separator = line.indexOf('=');
    if (separator < 1) {
      return {
        ...location,
        present: true,
        valid: false,
        error: 'Der Restore-Fortschrittsmarker enthält eine ungültige Zeile.'
      };
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!['STARTED_AT', 'SNAPSHOT', 'DATA_TARGET_SHA256', 'STATE'].includes(key)
        || Object.hasOwn(fields, key)) {
      return {
        ...location,
        present: true,
        valid: false,
        error: 'Der Restore-Fortschrittsmarker enthält unbekannte oder doppelte Felder.'
      };
    }
    fields[key] = value;
  }
  const valid = lines[0] === PROGRESS_MARKER_FORMAT
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(fields.STARTED_AT || ''))
    && /^[^/\\\0\r\n\t]{1,255}$/.test(String(fields.SNAPSHOT || ''))
    && String(fields.DATA_TARGET_SHA256 || '').toLowerCase() === location.targetHash
    && fields.STATE === 'ACTIVATING';
  return {
    ...location,
    present: true,
    valid,
    startedAt: String(fields.STARTED_AT || ''),
    snapshot: String(fields.SNAPSHOT || ''),
    ...(valid ? {} : {
      error: 'Der Restore-Fortschrittsmarker hat nicht das erwartete Format.'
    })
  };
}

function create(db, options) {
  const env = options && options.env || process.env;
  let releasedThisProcess = false;
  /* Ergebnis der Selbstheilungs-Pruefung dieses Starts - fuer status(), damit eine
     verweigerte Heilung nicht unsichtbar bleibt (Adversarial-Befund 7). */
  let selbstheilungsBefund = { geprueft: false };

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id INTEGER PRIMARY KEY CHECK (id=1),
      encryption_key_id TEXT NOT NULL DEFAULT '',
      target_encryption_key_id TEXT NOT NULL DEFAULT '',
      quarantine INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      activated_at TEXT NOT NULL DEFAULT '',
      required_generation_id TEXT NOT NULL DEFAULT '',
      security_generation_id TEXT NOT NULL DEFAULT '',
      credentials_generation_id TEXT NOT NULL DEFAULT '',
      security_source_revision TEXT NOT NULL DEFAULT '',
      credentials_source_revision TEXT NOT NULL DEFAULT '',
      token_disposition TEXT NOT NULL DEFAULT '',
      released_at TEXT NOT NULL DEFAULT ''
    )
  `);
  if (!columnExists(db, TABLE, 'target_encryption_key_id')) {
    db.exec(`ALTER TABLE ${TABLE} ADD COLUMN target_encryption_key_id TEXT NOT NULL DEFAULT ''`);
  }
  /* Adversarial-Befund 25.08.2026: Nach einem Wechsel der Datenwurzel (Umzug, geaendertes
     DOCUMENTS_DATA_ROOT) sucht der Marker-Leseweg an der NEUEN Wurzel - ein an der alten Wurzel
     liegender Restore-Marker wird unsichtbar, und die Selbstheilung haette mitten in einem
     Gesamt-Restore freigegeben. Nur die Datenbank selbst weiss noch, wo ihre Marker liegen
     muessten: die zuletzt gebundene KANONISCHE Wurzel reist deshalb hier mit, und die
     Selbstheilung verweigert bei Abweichung. */
  if (!columnExists(db, TABLE, 'bound_data_root')) {
    db.exec(`ALTER TABLE ${TABLE} ADD COLUMN bound_data_root TEXT NOT NULL DEFAULT ''`);
  }

  const get = db.prepare(`SELECT * FROM ${TABLE} WHERE id=1`);
  const insert = db.prepare(`
    INSERT INTO ${TABLE}
      (id,encryption_key_id,target_encryption_key_id,quarantine,reason,activated_at)
    VALUES (1,@keyId,@targetKeyId,@quarantine,@reason,@activatedAt)
  `);
  const activateStmt = db.prepare(`
    UPDATE ${TABLE}
       SET quarantine=1,reason=@reason,
           activated_at=CASE WHEN activated_at='' THEN @now ELSE activated_at END,
           released_at=''
     WHERE id=1
  `);

  function discardEphemeralAccess() {
    // Sitzungen und noch nicht eingelöste OAuth-Codes dürfen aus einer
    // zurückgespielten SQLite-Datei niemals wieder lebendig werden.
    if (tableExists(db, 'sessions')) db.prepare('DELETE FROM sessions').run();
    if (tableExists(db, 'mcp_auth_codes')) db.prepare('DELETE FROM mcp_auth_codes').run();
  }

  function activate(reason, targetKeyId) {
    const now = new Date().toISOString();
    db.transaction(() => {
      activateStmt.run({ reason: String(reason || 'encryption_key_changed'), now });
      db.prepare(`
        UPDATE ${TABLE}
           SET target_encryption_key_id=?,
               required_generation_id='',security_generation_id='',credentials_generation_id='',
               security_source_revision='',credentials_source_revision='',token_disposition=''
         WHERE id=1
      `).run(String(targetKeyId || ''));
      discardEphemeralAccess();
    })();
  }

  /*
   * Selbstheilung (Vorfall 25.08.2026): Ein Server, der EINMAL ohne gültigen ENCRYPTION_KEY
   * startete, ging fail-closed in Quarantäne ("encryption_key_invalid", Zielschlüssel leer).
   * Der nächste Start MIT Schlüssel verglich den Zielschlüssel, fand eine Abweichung und
   * meldete "encryption_key_changed_during_recovery" - obwohl sich nie ein Schlüssel geändert
   * hatte; die Statusseite zeigte zwei IDENTISCHE Schlüssel neben der Meldung, der Schlüssel
   * habe sich geändert. Der einzige Ausweg verlangte Sicherheit.json.enc/Zugangsdaten.json.enc
   * derselben Generation - Dateien, die eine Installation ohne serverseitige Vollsicherung nie
   * besessen hat. Eine Sackgasse.
   *
   * Dieser Zweig unterscheidet den harmlosen Fall ("Schlüssel war kurz weg, Daten unverändert,
   * kein Restore-Marker") vom echten Gefahrenfall. Er hebt die Quarantäne NUR auf, wenn ALLES
   * zugleich gilt - jede einzelne Bedingung ist fail-closed:
   *   (a) der Quarantänegrund gehört zur Schlüssel-Familie (Unbekanntes und disaster_restore*
   *       heilen NIE selbst),
   *   (b) es wurde noch kein Wiederherstellungs-Artefakt eingelesen (sonst läuft der
   *       ordentliche Freigabeweg, den die Selbstheilung nicht überholen darf),
   *   (c) der gebundene Schlüssel ist exakt der aktuelle - oder es wurde noch nie einer
   *       gebunden, weil die Datenbank während des Ausfalls entstand,
   *   (d) es liegt kein Restore-Marker und kein Fortschrittsmarker vor - auch kein ungültiger:
   *       "hier wurde zurückgespielt" ist genau der Fall, für den die Quarantäne gebaut wurde,
   *   (e) JEDES gespeicherte Geheimnis lässt sich mit dem aktuellen Schlüssel öffnen.
   * Ein eingespielter Fremd- oder Altbestand unter anderem Schlüssel scheitert an (c) und (e);
   * ein Disaster-Restore an (a) und (d). Wer die Datenbankdatei selbst beschreiben kann, kann
   * die Quarantäne ohnehin direkt umsetzen - die Selbstheilung öffnet keine neue Fläche.
   */
  const SELBSTHEILBARE_GRUENDE = new Set([
    'encryption_key_invalid',
    'encryption_key_changed',
    'encryption_key_changed_during_recovery',
    'legacy_secret_decryption_failed'
  ]);

  function generationenGesetzt(zeile) {
    return !!(String(zeile.required_generation_id || '')
      || String(zeile.security_generation_id || '')
      || String(zeile.credentials_generation_id || ''));
  }

  /* Die voll aufgeloeste Datenwurzel. canonicalDataRoot() realpatht bewusst nur den Elternpfad
     (fuer den Fortschrittsmarker-Dateinamen); fuer die Selbstheilung reicht das nicht: das
     Restore-Werkzeug LEHNT Symlink-Ziele ab und arbeitet mit dem Realpfad - laeuft der Server
     ueber einen Alias, rechnet er sonst einen anderen Marker-Hash und uebersieht den Marker.
     Liefert '' bei Aufloesungsfehlern (haengender Alias, halb getauschter Baum) - fail-closed. */
  function kanonischeDatenwurzel() {
    const roh = path.resolve(String(
      env.DOCUMENTS_DATA_ROOT || env.DATA_DIR || DATA_ROOT
    ));
    try { return fs.realpathSync(roh); } catch (_error) { return ''; }
  }

  function selbstheilungMoeglich(zeile, aktuellerKeyId) {
    if (!aktuellerKeyId) return { ok: false, blocker: 'schluessel_fehlt' };
    if (!SELBSTHEILBARE_GRUENDE.has(String(zeile.reason || ''))) {
      return { ok: false, blocker: 'grund_nicht_selbstheilbar' };
    }
    if (generationenGesetzt(zeile)) return { ok: false, blocker: 'artefaktweg_begonnen' };
    const gebunden = String(zeile.encryption_key_id || '');
    if (gebunden && gebunden !== aktuellerKeyId) return { ok: false, blocker: 'schluessel_abweichend' };
    /* Adversarial-Befund 25.08.2026: Marker-ABWESENHEIT ist pfadabhaengig und dadurch von
       Marker-UNSICHTBARKEIT ununterscheidbar. Deshalb dreifach: (1) unaufloesbare Wurzel heilt
       nie, (2) gewechselte Wurzel heilt nie, (3) Marker werden am konfigurierten UND am voll
       aufgeloesten Pfad gesucht, Fortschrittsmarker zusaetzlich per Praefix-Suche im
       Elternverzeichnis - egal, fuer welchen Wurzel-Hash sie geschrieben wurden. */
    const kanonisch = kanonischeDatenwurzel();
    if (!kanonisch) return { ok: false, blocker: 'datenwurzel_unaufloesbar' };
    const gebundeneWurzel = String(zeile.bound_data_root || '');
    if (gebundeneWurzel && gebundeneWurzel !== kanonisch) {
      return { ok: false, blocker: 'datenwurzel_gewechselt' };
    }
    const umgebungen = [env];
    if (String(env.DOCUMENTS_DATA_ROOT || env.DATA_DIR || '') !== kanonisch) {
      umgebungen.push({ ...env, DOCUMENTS_DATA_ROOT: kanonisch, DATA_DIR: '' });
    }
    for (const umgebung of umgebungen) {
      if (inspectRestoreMarker(umgebung).present) return { ok: false, blocker: 'restore_marker_vorhanden' };
      if (inspectRestoreProgressMarker(umgebung).present) return { ok: false, blocker: 'fortschrittsmarker_vorhanden' };
    }
    let nachbarn = [];
    try { nachbarn = fs.readdirSync(path.dirname(kanonisch)); }
    catch (_error) { return { ok: false, blocker: 'datenwurzel_unaufloesbar' }; }
    if (nachbarn.some((name) => name.startsWith(PROGRESS_MARKER_PREFIX))) {
      return { ok: false, blocker: 'fortschrittsmarker_vorhanden' };
    }
    const validation = validateEncryptedState(db);
    if (!validation.ok) {
      return { ok: false, blocker: 'geheimnis_unlesbar',
        detail: (validation.failures || []).slice(0, 3).map((x) => `${x.table}.${x.column}`).join(', ') };
    }
    return { ok: true, geprueft: validation.checked, kanonisch };
  }

  function selbstheilen(zeile, aktuellerKeyId, befund) {
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`
        UPDATE ${TABLE}
           SET encryption_key_id=?,target_encryption_key_id='',quarantine=0,reason='',
               activated_at='',released_at=?,bound_data_root=?
         WHERE id=1
      `).run(aktuellerKeyId, now, befund.kanonisch || '');
      /* Sitzungen aus der Quarantänezeit gelten wie bei der Aktivierung als verbraucht. */
      discardEphemeralAccess();
    })();
    console.warn(
      `[recovery] Quarantäne (${zeile.reason}) automatisch aufgehoben: der ENCRYPTION_KEY ist `
      + (String(zeile.encryption_key_id || '') ? 'unverändert derselbe wie vor dem Vorfall' : 'erstmals gebunden')
      + `, alle ${befund.geprueft} gespeicherten Geheimnisse sind damit lesbar, und es liegt `
      + 'kein Restore-Marker vor. Ein Fremd- oder Altbestand hätte diese Prüfungen nicht bestanden.'
    );
  }

  let keyId = '';
  try { keyId = currentEncryptionKeyId(env); }
  catch (_error) { /* Status enthält die genaue Meldung; Initialisierung bleibt möglich. */ }

  let row = get.get();
  if (!row) {
    const validation = keyId ? validateEncryptedState(db) : { ok: false };
    const quarantine = !keyId || !validation.ok;
    insert.run({
      /* Adversarial-Befund 25.08.2026: Ein Erststart mit FALSCHEM Schluessel darf diesen nicht
         als gebundenen Schluessel eintragen - sonst kann der spaeter korrigierte richtige
         Schluessel nie mehr heilen (gebunden != aktuell). Gebunden wird erst nach bestandener
         Pruefung; der Zielschluessel zeigt weiterhin den zuletzt versuchten. */
      keyId: quarantine ? '' : keyId,
      targetKeyId: quarantine ? keyId : '',
      quarantine: quarantine ? 1 : 0,
      reason: !keyId ? 'encryption_key_invalid' : (!validation.ok ? 'legacy_secret_decryption_failed' : ''),
      activatedAt: quarantine ? new Date().toISOString() : ''
    });
    if (quarantine) discardEphemeralAccess();
  } else if (!keyId) {
    /* Ein Schlüssel-Ausfall darf einen ERNSTEREN Quarantänegrund nicht überschreiben - sonst
       sähe der Neustart mit Schlüssel nur noch die harmlose Schlüssel-Familie, und die
       Selbstheilung könnte einen Disaster-Zustand freigeben. Genau dieses Überschreiben war
       Teil der Sackgasse vom 25.08.2026. */
    if (!Number(row.quarantine)
      || (SELBSTHEILBARE_GRUENDE.has(String(row.reason || '')) && !generationenGesetzt(row))) {
      activate('encryption_key_invalid', '');
    } else discardEphemeralAccess();
  } else if (Number(row.quarantine)) {
    const heilung = selbstheilungMoeglich(row, keyId);
    if (heilung.ok) {
      selbstheilen(row, keyId, heilung);
      selbstheilungsBefund = { geprueft: true, geheilt: true, geprüfteGeheimnisse: heilung.geprueft };
    } else {
      const grund = String(row.reason || '');
      if (SELBSTHEILBARE_GRUENDE.has(grund) && String(row.target_encryption_key_id || '') !== keyId) {
        /* Ehrliches Etikett (Adversarial-Befunde 4+6): "changed_during_recovery" nur, wenn
           wirklich ein ANDERER Schluessel gebunden ist. Unlesbare Geheimnisse heissen
           legacy_secret_decryption_failed; sonst bleibt der bestehende Familien-Grund stehen.
           Die Vorfalls-Anzeige "Schluessel geaendert" neben zwei identischen Schluesseln
           entstand genau durch das alte Pauschal-Etikett. */
        const gebunden = String(row.encryption_key_id || '');
        const neuerGrund = (gebunden && gebunden !== keyId)
          ? 'encryption_key_changed_during_recovery'
          : (heilung.blocker === 'geheimnis_unlesbar' ? 'legacy_secret_decryption_failed' : grund);
        if (generationenGesetzt(row)) {
          /* Adversarial-Befund 2: activate() loescht die Generationsfelder - damit waere der
             begonnene Artefakt-Freigabeweg nach EINEM weiteren Neustart wieder heilbar gewesen
             und haette Paar-Vollstaendigkeit, Token-Entscheidung und Admin-Bestaetigung
             uebersprungen. Der Zielschluessel muss trotzdem aktuell bleiben (artifactsComplete
             vergleicht ihn), also nur er - ohne Reset der uebrigen Felder. */
          db.prepare(`UPDATE ${TABLE} SET target_encryption_key_id=?, reason=? WHERE id=1`)
            .run(keyId, neuerGrund);
          discardEphemeralAccess();
        } else {
          activate(neuerGrund, keyId);
        }
      } else {
        /* Ernster Grund (disaster_restore & Co.) oder unveraenderter Zielschluessel:
           nichts umetikettieren, nichts loeschen. */
        discardEphemeralAccess();
      }
      selbstheilungsBefund = { geprueft: true, geheilt: false,
        blocker: heilung.blocker || '', detail: heilung.detail || '' };
      console.warn(`[recovery] Selbstheilung geprüft und verweigert (${heilung.blocker || 'unbekannt'}`
        + (heilung.detail ? `: ${heilung.detail}` : '') + '). Die Quarantäne bleibt bestehen.');
    }
  } else if (row.encryption_key_id && row.encryption_key_id !== keyId) {
    activate('encryption_key_changed', keyId);
  } else if (!row.encryption_key_id) {
    const validation = validateEncryptedState(db);
    if (!validation.ok) activate('legacy_secret_decryption_failed', keyId);
    else db.prepare(`UPDATE ${TABLE} SET encryption_key_id=? WHERE id=1`).run(keyId);
  }

  /* Wurzel-Bindung im Normalbetrieb (nach allen Zustandsuebergaengen dieses Starts):
     Nur ein NICHT quarantaenisierter Server schreibt seine kanonische Datenwurzel fest.
     Altbestaende fuellen das Feld so beim naechsten normalen Start nach - erst danach kann
     der Wurzelwechsel-Schutz der Selbstheilung greifen (dokumentierte Restluecke fuer
     Bestaende, die seit dem 25.08.2026 nie normal liefen). */
  {
    const zwischenstand = get.get();
    const kanonisch = kanonischeDatenwurzel();
    if (zwischenstand && !Number(zwischenstand.quarantine) && kanonisch
      && String(zwischenstand.bound_data_root || '') !== kanonisch) {
      db.prepare(`UPDATE ${TABLE} SET bound_data_root=? WHERE id=1`).run(kanonisch);
    }
  }

  // Der Fortschrittsmarker liegt außerhalb des ausgetauschten Datenbaums und
  // deckt deshalb auch das SIGKILL-/Stromausfallfenster vor dessen Aktivierung
  // ab. Der normale Marker reist anschließend in der neuen Datenwurzel mit.
  let restoreMarker = inspectRestoreMarker(env);
  let restoreProgressMarker = inspectRestoreProgressMarker(env);
  if (restoreMarker.present || restoreProgressMarker.present) {
    row = get.get();
    const markerReason = restoreProgressMarker.present
      ? (restoreProgressMarker.valid
        ? 'disaster_restore_in_progress'
        : 'disaster_restore_progress_marker_invalid')
      : (restoreMarker.valid
        ? 'disaster_restore'
        : 'disaster_restore_marker_invalid');
    if (!Number(row.quarantine)
        || String(row.reason || '') !== markerReason
        || (keyId && String(row.target_encryption_key_id || '') !== keyId)) {
      activate(markerReason, keyId);
    } else discardEphemeralAccess();
  }

  function status() {
    const state = get.get();
    const selbstheilung = selbstheilungsBefund;
    restoreMarker = inspectRestoreMarker(env);
    restoreProgressMarker = inspectRestoreProgressMarker(env);
    let currentKeyId = '';
    let encryptionKeyError = '';
    try { currentKeyId = currentEncryptionKeyId(env); }
    catch (error) { encryptionKeyError = error.message || String(error); }
    const artifactsComplete = !!(state
      && state.security_generation_id
      && state.security_generation_id === state.credentials_generation_id
      && state.security_source_revision
      && state.security_source_revision === state.credentials_source_revision
      && state.target_encryption_key_id
      && state.target_encryption_key_id === currentKeyId
      && currentKeyId);
    const disasterRestoreState = String(state && state.reason || '')
      .startsWith('disaster_restore');
    return {
      active: !!(state && Number(state.quarantine)) || releasedThisProcess,
      databaseQuarantine: !!(state && Number(state.quarantine)),
      pendingRestart: releasedThisProcess,
      reason: state && state.reason || '',
      activatedAt: state && state.activated_at || '',
      releasedAt: state && state.released_at || '',
      storedEncryptionKeyId: state && state.encryption_key_id || '',
      targetEncryptionKeyId: state && state.target_encryption_key_id || '',
      currentEncryptionKeyId: currentKeyId,
      encryptionKeyValid: !!currentKeyId,
      encryptionKeyError,
      requiredGenerationId: state && state.required_generation_id || '',
      securityGenerationId: state && state.security_generation_id || '',
      credentialsGenerationId: state && state.credentials_generation_id || '',
      securitySourceRevision: state && state.security_source_revision || '',
      credentialsSourceRevision: state && state.credentials_source_revision || '',
      tokenDisposition: state && state.token_disposition || '',
      /* Warum eine Quarantaene trotz Selbstheilung bestehen blieb - fuer die Statusseite,
         damit der Blocker benannt ist statt unsichtbar (Adversarial-Befund 7). */
      selbstheilung,
      restoreMarker: {
        present: restoreMarker.present,
        valid: restoreMarker.valid,
        restoredAt: restoreMarker.restoredAt || '',
        snapshot: restoreMarker.snapshot || '',
        error: restoreMarker.error || ''
      },
      restoreProgressMarker: {
        present: restoreProgressMarker.present,
        valid: restoreProgressMarker.valid,
        startedAt: restoreProgressMarker.startedAt || '',
        snapshot: restoreProgressMarker.snapshot || '',
        error: restoreProgressMarker.error || ''
      },
      artifactsComplete,
      readyToRelease: artifactsComplete
        && !restoreProgressMarker.present
        && (!disasterRestoreState || (restoreMarker.present && restoreMarker.valid))
        && ['discard', 'restore'].includes(String(state && state.token_disposition || ''))
    };
  }

  function isActive() {
    return status().active;
  }

  function recordArtifactRestore(scope, generationId, sourceRevision, tokenDisposition) {
    if (!['security', 'credentials'].includes(scope)) {
      throw new Error('Unbekannter Wiederherstellungsumfang.');
    }
    const generation = String(generationId || '').trim();
    const revision = String(sourceRevision || '').trim();
    if (!generation || !revision) {
      const error = new Error('Generation und Quellrevision der Wiederherstellung fehlen.');
      error.code = 'RESTORE_GENERATION_MISSING';
      throw error;
    }
    const state = get.get();
    const otherGeneration = scope === 'security'
      ? String(state.credentials_generation_id || '')
      : String(state.security_generation_id || '');
    const otherRevision = scope === 'security'
      ? String(state.credentials_source_revision || '')
      : String(state.security_source_revision || '');
    if (otherGeneration && otherGeneration !== generation) {
      const error = new Error('Sicherheits- und Zugangsdaten stammen nicht aus derselben Sicherungsgeneration.');
      error.code = 'RESTORE_GENERATION_MISMATCH';
      throw error;
    }
    if (otherRevision && otherRevision !== revision) {
      const error = new Error('Sicherheits- und Zugangsdaten stammen nicht aus derselben Datenbankrevision.');
      error.code = 'RESTORE_SOURCE_REVISION_MISMATCH';
      throw error;
    }
    const generationColumn = scope === 'security' ? 'security_generation_id' : 'credentials_generation_id';
    const revisionColumn = scope === 'security' ? 'security_source_revision' : 'credentials_source_revision';
    db.prepare(`
      UPDATE ${TABLE}
         SET ${generationColumn}=?,${revisionColumn}=?,
             required_generation_id=CASE
               WHEN required_generation_id='' THEN ?
               ELSE required_generation_id
             END
             ${scope === 'security' ? ',token_disposition=?' : ''}
       WHERE id=1
    `).run(...(
      scope === 'security'
        ? [generation, revision, generation, String(tokenDisposition || '')]
        : [generation, revision, generation]
    ));
    return status();
  }

  function release() {
    const state = status();
    if (!state.databaseQuarantine) {
      const error = new Error('Der Server befindet sich nicht im Wiederherstellungsmodus.');
      error.code = 'RECOVERY_NOT_ACTIVE';
      throw error;
    }
    if (state.restoreProgressMarker.present) {
      const error = new Error(
        'Der Gesamt-Restore ist laut dauerhaftem Fortschrittsmarker noch nicht vollständig abgeschlossen.'
      );
      error.code = 'RECOVERY_RESTORE_IN_PROGRESS';
      error.detail = {
        valid: state.restoreProgressMarker.valid,
        error: state.restoreProgressMarker.error || ''
      };
      throw error;
    }
    if (!state.artifactsComplete) {
      const error = new Error('Sicherheit und Zugangsdaten derselben Generation müssen vollständig wiederhergestellt sein.');
      error.code = 'RECOVERY_ARTIFACTS_INCOMPLETE';
      throw error;
    }
    if (!['discard', 'restore'].includes(state.tokenDisposition)) {
      const error = new Error('Für alte API- und Zugriffstokens fehlt eine ausdrückliche Entscheidung.');
      error.code = 'RECOVERY_TOKEN_DECISION_MISSING';
      throw error;
    }
    const validation = validateEncryptedState(db);
    if (!validation.ok) {
      const error = new Error('Mindestens ein wiederhergestelltes Geheimnis kann mit dem aktuellen ENCRYPTION_KEY nicht gelesen werden.');
      error.code = 'RECOVERY_SECRET_VALIDATION_FAILED';
      error.detail = { failures: validation.failures };
      throw error;
    }
    restoreMarker = inspectRestoreMarker(env);
    const disasterRestore = String(state.reason || '').startsWith('disaster_restore');
    let releasedMarker = '';
    if (disasterRestore) {
      if (!restoreMarker.present || !restoreMarker.valid) {
        const error = new Error('Der vom Gesamt-Restore gesetzte Recovery-Marker fehlt oder ist ungültig.');
        error.code = 'RECOVERY_MARKER_INVALID';
        error.detail = { error: restoreMarker.error || 'Marker fehlt.' };
        throw error;
      }
      releasedMarker = path.join(
        restoreMarker.dataRoot,
        `.recovery-quarantine.released-${Date.now()}-${crypto.randomUUID()}`
      );
    }
    const now = new Date().toISOString();
    // Zuerst die DB freigeben und erst danach den Marker atomar umbenennen. Stürzt
    // der Prozess zwischen beiden Schritten ab, liegt der Marker weiterhin da und
    // aktiviert beim Neustart wieder fail-closed die Quarantäne. Die umgekehrte
    // Reihenfolge könnte eine quarantänisierte DB ohne gültigen Marker hinterlassen.
    db.prepare(`
      UPDATE ${TABLE}
         SET encryption_key_id=?,target_encryption_key_id='',quarantine=0,reason='',released_at=?
       WHERE id=1
    `).run(state.currentEncryptionKeyId, now);
    if (releasedMarker) {
      try {
        fs.renameSync(restoreMarker.file, releasedMarker);
        try {
          const directory = fs.openSync(restoreMarker.dataRoot, fs.constants.O_RDONLY);
          try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
        } catch (_error) { /* nicht jedes Dateisystem erlaubt Verzeichnis-fsync */ }
      } catch (cause) {
        // Im laufenden Prozess sofort wieder schließen. Die bereits geprüften
        // Generationen bleiben erhalten, sodass der Admin die Freigabe nach
        // Behebung des Dateisystemfehlers wiederholen kann.
        db.prepare(`
          UPDATE ${TABLE}
             SET target_encryption_key_id=?,quarantine=1,reason=?,released_at=''
           WHERE id=1
        `).run(state.currentEncryptionKeyId, state.reason || 'disaster_restore');
        const error = new Error('Der Recovery-Marker konnte nicht kontrolliert freigegeben werden.');
        error.code = 'RECOVERY_MARKER_RELEASE_FAILED';
        error.detail = { cause: cause.message || String(cause) };
        throw error;
      }
      restoreMarker = inspectRestoreMarker(env);
    }
    releasedThisProcess = true;
    return status();
  }

  function rawGate(req, res, next) {
    if (!isActive()) return next();
    // /api/setup wird im Produktionsserver absichtlich vor Session- und API-Gate
    // montiert. Auch ein ausnahmsweise unvollständiger Disaster-Stand darf diesen
    // Administrator-Anlegeweg deshalb nicht am Recovery-Gate vorbeiführen.
    if (/^\/(?:api\/)?setup(?:\/|$)/.test(req.path)
        || /^\/(?:webdav|mcp)(?:\/|$)/.test(req.path)
        || /^\/oauth(?:\/|$)/.test(req.path)
        || /^\/\.well-known\/oauth-/.test(req.path)
        || /^\/api\/documents\/strom(?:\/|$)/.test(req.path)) {
      return res.status(503).json({
        error: 'Der Server befindet sich im geschützten Wiederherstellungsmodus.',
        code: 'RECOVERY_MODE_ACTIVE'
      });
    }
    return next();
  }

  const allowedApi = new Set([
    'GET /me',
    'POST /login',
    'POST /logout',
    'GET /admin/recovery/status',
    'POST /admin/recovery/release',
    'GET /admin/recovery-key/status',
    'GET /admin/backup-encryption/status',
    'POST /admin/restore-encrypted/preview',
    'POST /admin/restore-encrypted'
  ]);

  function apiGate(req, res, next) {
    if (!isActive() || allowedApi.has(`${req.method} ${req.path}`)) return next();
    return res.status(503).json({
      error: 'Der Server befindet sich im geschützten Wiederherstellungsmodus. '
        + 'Bis zur geprüften Wiederherstellung sind ausschließlich Admin-Login und Restore verfügbar.',
      code: 'RECOVERY_MODE_ACTIVE',
      recovery: status()
    });
  }

  return {
    activate,
    apiGate,
    isActive,
    rawGate,
    recordArtifactRestore,
    release,
    status,
    validateEncryptedState: () => validateEncryptedState(db)
  };
}

function ensure(db, options) {
  if (!db || typeof db.prepare !== 'function') throw new Error('Recovery-Modus benötigt eine SQLite-Datenbank.');
  if (!instances.has(db)) instances.set(db, create(db, options));
  return instances.get(db);
}

module.exports = {
  ensure,
  _test: {
    DIRECT_SECRET_COLUMNS,
    MOUNT_SECRET_FIELDS,
    MARKER_FORMAT,
    MARKER_NAME,
    PROGRESS_MARKER_FORMAT,
    PROGRESS_MARKER_PREFIX,
    currentEncryptionKeyId,
    inspectRestoreMarker,
    inspectRestoreProgressMarker,
    restoreProgressMarkerPath,
    validateEncryptedState
  }
};
