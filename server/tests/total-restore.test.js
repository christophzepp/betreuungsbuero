'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const SCRIPT = path.resolve(__dirname, '..', 'tools', 'gesamt-restore.sh');
const RESCUE_SCRIPT = path.resolve(__dirname, '..', 'tools', 'notfall-rettung.sh');
const RUNTIME_SERVER_DIR = path.resolve(__dirname, '..');
const RESTORE_TEST_PASSWORD = 'Restore-Test-2026!';
const RESTORE_TEST_HASH = bcrypt.hashSync(RESTORE_TEST_PASSWORD, 4);

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function rebuildManifest(snapshot) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(snapshot, absolute);
      if (relative === 'MANIFEST.tsv' || relative === 'MANIFEST.tsv.sha256') continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(relative);
    }
  }
  walk(snapshot);
  files.sort();
  const manifest = files.map((relative) => {
    const file = path.join(snapshot, relative);
    return `${sha(file)}\t${fs.statSync(file).size}\t${Buffer.from(relative).toString('base64')}`;
  }).join('\n') + '\n';
  write(path.join(snapshot, 'MANIFEST.tsv'), manifest);
  write(path.join(snapshot, 'MANIFEST.tsv.sha256'), sha(path.join(snapshot, 'MANIFEST.tsv')) + '\n');
  return manifest;
}

function run(snapshot, serverDir, dataDir, dbFile, extra, env) {
  return spawnSync('bash', [
    SCRIPT,
    '--snapshot', snapshot,
    '--server-dir', serverDir,
    '--data-dir', dataDir,
    '--db', dbFile,
    ...(extra || [])
  ], {
    encoding: 'utf8',
    env: { ...process.env, ...(env || {}) }
  });
}

test('Restore ist im Dry-run read-only, prüft die vollständige Manifestmenge und aktiviert atomar in Quarantäne', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'betreuungsbuero-restore-test-'));
  try {
    const snapshot = path.join(root, 'snapshot');
    const serverDir = path.join(root, 'server');
    const restoreParent = path.join(root, 'restore');
    const dataDir = path.join(restoreParent, 'data');
    const dbFile = path.join(dataDir, 'betreuungsbuero.sqlite3');
    fs.mkdirSync(serverDir);
    fs.mkdirSync(dataDir, { recursive: true });
    write(path.join(serverDir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.2.3' }));
    write(path.join(dataDir, 'alt.txt'), 'alter Stand\n');
    const oldDb = new Database(dbFile);
    oldDb.exec('CREATE TABLE alt (id INTEGER PRIMARY KEY);');
    oldDb.close();

    write(path.join(snapshot, 'STATUS.txt'), 'VOLLSTAENDIG\n');
    write(path.join(snapshot, 'verwaltung', 'SNAPSHOT-FORMAT.txt'), 'Betreuungsbuero-Gesamtsicherung/1\n');
    write(path.join(snapshot, 'inhalt', 'server-data', 'Dokumentenspeicher', 'Fallakten', 'A', 'Akte', '260728 Test.txt'), 'neuer Inhalt\n');
    write(path.join(snapshot, 'betrieb', 'konfiguration', 'package.json'), JSON.stringify({ name: 'fixture', version: '1.2.3' }));
    const sourceDbFile = path.join(snapshot, 'datenbank', 'betreuungsbuero.sqlite3');
    fs.mkdirSync(path.dirname(sourceDbFile), { recursive: true });
    const sourceDb = new Database(sourceDbFile);
    sourceDb.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE neu (id INTEGER PRIMARY KEY, wert TEXT);
      INSERT INTO neu VALUES (1, 'ok');
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        allow_local INTEGER NOT NULL DEFAULT 1,
        allow_online INTEGER NOT NULL DEFAULT 0,
        is_admin INTEGER NOT NULL DEFAULT 0,
        allow_case_management INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        active INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO users (
        id, username, password_hash, display_name, allow_local, allow_online,
        is_admin, allow_case_management, active
      ) VALUES (
        1,
        'restore-admin',
        '${RESTORE_TEST_HASH}',
        'Restore Admin',
        1,
        1,
        1,
        1,
        1
      );
    `);
    sourceDb.close();
    const originalManifest = rebuildManifest(snapshot);

    const dry = run(snapshot, serverDir, dataDir, dbFile);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /DRY_RUN=1/);
    assert.equal(fs.readFileSync(path.join(dataDir, 'alt.txt'), 'utf8'), 'alter Stand\n');
    assert.equal(fs.existsSync(path.join(dataDir, '.recovery-quarantine')), false);

    if (fs.existsSync('/dev') && fs.statSync('/dev').isDirectory()) {
      const mountpoint = run(snapshot, serverDir, '/dev', dbFile);
      assert.notEqual(mountpoint.status, 0);
      assert.match(
        mountpoint.stderr,
        /selbst ein Mountpoint.*nicht atomar getauscht/,
        'ein Mount-Root darf niemals als atomar umbenennbares Datenziel gelten'
      );
    }

    const unsafeTargets = [
      {
        label: 'Datenziel ..',
        data: restoreParent + path.sep + '..',
        db: dbFile,
        extra: []
      },
      {
        label: 'Datenbankziel .',
        data: dataDir,
        db: restoreParent + path.sep + '.',
        extra: []
      },
      {
        label: 'Datenziel mit abschließendem Slash',
        data: dataDir + path.sep,
        db: dbFile,
        extra: []
      },
      {
        label: 'externe Wurzel ..',
        data: dataDir,
        db: dbFile,
        extra: ['--external-root-base', restoreParent + path.sep + '..']
      },
      {
        label: 'App-Ausgabe .',
        data: dataDir,
        db: dbFile,
        extra: [
          '--restore-runtime-artifacts',
          '--outputs-dir', restoreParent + path.sep + '.'
        ]
      }
    ];
    for (const unsafe of unsafeTargets) {
      const result = run(snapshot, serverDir, unsafe.data, unsafe.db, unsafe.extra);
      assert.notEqual(result.status, 0, unsafe.label);
      assert.match(
        result.stderr,
        /unsicheren Pfadabschnitt|sicheren letzten Pfadnamen|Schrägstrich enden/,
        unsafe.label
      );
    }

    const realParent = path.join(root, 'echter-ziel-elternordner');
    const linkedParent = path.join(root, 'verlinkter-ziel-elternordner');
    fs.mkdirSync(realParent);
    fs.symlinkSync(realParent, linkedParent);
    const symlinkTargets = [
      {
        label: 'Datenziel unter Symlink',
        data: path.join(linkedParent, 'data'),
        db: dbFile,
        extra: []
      },
      {
        label: 'DB-Ziel unter Symlink',
        data: dataDir,
        db: path.join(linkedParent, 'db.sqlite3'),
        extra: []
      },
      {
        label: 'externe Wurzel unter Symlink',
        data: dataDir,
        db: dbFile,
        extra: ['--external-root-base', path.join(linkedParent, 'extern')]
      },
      {
        label: 'App-Ausgabe unter Symlink',
        data: dataDir,
        db: dbFile,
        extra: [
          '--restore-runtime-artifacts',
          '--outputs-dir', path.join(linkedParent, 'outputs')
        ]
      }
    ];
    for (const unsafe of symlinkTargets) {
      const result = run(snapshot, serverDir, unsafe.data, unsafe.db, unsafe.extra);
      assert.notEqual(result.status, 0, unsafe.label);
      assert.match(result.stderr, /regulärer, direkter Ordner/, unsafe.label);
    }

    const missingParent = path.join(root, 'nicht-vorhanden');
    const missing = run(snapshot, serverDir, path.join(missingParent, 'data'), path.join(missingParent, 'db.sqlite3'));
    assert.notEqual(missing.status, 0);
    assert.equal(fs.existsSync(missingParent), false, 'Dry-run hat einen Zielordner erzeugt');

    write(path.join(snapshot, 'inhalt', 'server-data', 'eingeschleust.txt'), 'nicht manifestiert\n');
    const injected = run(snapshot, serverDir, dataDir, dbFile);
    assert.notEqual(injected.status, 0);
    assert.match(injected.stderr, /Dateimenge und Manifest stimmen nicht überein/);
    const rescueInjected = spawnSync('bash', [
      RESCUE_SCRIPT,
      '--snapshot', snapshot,
      '--output', path.join(root, 'rettung-darf-nicht-entstehen')
    ], { encoding: 'utf8' });
    assert.notEqual(rescueInjected.status, 0);
    assert.match(rescueInjected.stderr, /Dateimenge und Manifest stimmen nicht ueberein/);
    assert.equal(fs.existsSync(path.join(root, 'rettung-darf-nicht-entstehen')), false);
    fs.rmSync(path.join(snapshot, 'inhalt', 'server-data', 'eingeschleust.txt'));

    fs.symlinkSync('260728 Test.txt', path.join(snapshot, 'inhalt', 'server-data', 'Dokumentenspeicher', 'Fallakten', 'A', 'Akte', 'link'));
    const linked = run(snapshot, serverDir, dataDir, dbFile);
    assert.notEqual(linked.status, 0);
    assert.match(linked.stderr, /Link oder eine Spezialdatei/);
    fs.rmSync(path.join(snapshot, 'inhalt', 'server-data', 'Dokumentenspeicher', 'Fallakten', 'A', 'Akte', 'link'));

    write(path.join(snapshot, 'MANIFEST.tsv'), originalManifest + originalManifest.split('\n')[0] + '\n');
    write(path.join(snapshot, 'MANIFEST.tsv.sha256'), sha(path.join(snapshot, 'MANIFEST.tsv')) + '\n');
    const duplicate = run(snapshot, serverDir, dataDir, dbFile);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /Pfad mehrfach/);
    write(path.join(snapshot, 'MANIFEST.tsv'), originalManifest);
    write(path.join(snapshot, 'MANIFEST.tsv.sha256'), sha(path.join(snapshot, 'MANIFEST.tsv')) + '\n');

    const overlap = run(snapshot, serverDir, path.join(snapshot, 'restore-data'), path.join(snapshot, 'restore.sqlite3'));
    assert.notEqual(overlap.status, 0);
    assert.match(overlap.stderr, /nicht.*existieren|überlappen/);

    const noAdminDb = new Database(sourceDbFile);
    noAdminDb.prepare('UPDATE users SET allow_online=0').run();
    noAdminDb.close();
    rebuildManifest(snapshot);
    const noAdmin = run(snapshot, serverDir, dataDir, dbFile, ['--apply', '--confirm-app-stopped']);
    assert.notEqual(noAdmin.status, 0);
    assert.match(noAdmin.stderr, /keinen aktiven, anmeldbaren Online-Administrator/);
    assert.equal(fs.readFileSync(path.join(dataDir, 'alt.txt'), 'utf8'), 'alter Stand\n');
    const repairedAdminDb = new Database(sourceDbFile);
    repairedAdminDb.prepare('UPDATE users SET allow_online=1').run();
    repairedAdminDb.close();
    rebuildManifest(snapshot);

    const invalidHashDb = new Database(sourceDbFile);
    invalidHashDb.prepare("UPDATE users SET password_hash='scrypt:test'").run();
    invalidHashDb.close();
    rebuildManifest(snapshot);
    const invalidHash = run(snapshot, serverDir, dataDir, dbFile, ['--apply', '--confirm-app-stopped']);
    assert.notEqual(invalidHash.status, 0);
    assert.match(invalidHash.stderr, /keinen aktiven, anmeldbaren Online-Administrator/);
    const repairedHashDb = new Database(sourceDbFile);
    repairedHashDb.prepare('UPDATE users SET password_hash=?').run(RESTORE_TEST_HASH);
    repairedHashDb.close();
    rebuildManifest(snapshot);

    const incompatiblePrefixDb = new Database(sourceDbFile);
    incompatiblePrefixDb.prepare('UPDATE users SET password_hash=?').run(
      '$2y$' + RESTORE_TEST_HASH.slice(4)
    );
    incompatiblePrefixDb.close();
    rebuildManifest(snapshot);
    const incompatiblePrefix = run(
      snapshot, serverDir, dataDir, dbFile, ['--apply', '--confirm-app-stopped']
    );
    assert.notEqual(incompatiblePrefix.status, 0);
    assert.match(incompatiblePrefix.stderr, /keinen aktiven, anmeldbaren Online-Administrator/);
    const repairedPrefixDb = new Database(sourceDbFile);
    repairedPrefixDb.prepare('UPDATE users SET password_hash=?').run(RESTORE_TEST_HASH);
    repairedPrefixDb.close();
    rebuildManifest(snapshot);

    const emptyUsernameDb = new Database(sourceDbFile);
    emptyUsernameDb.prepare("UPDATE users SET username=''").run();
    emptyUsernameDb.close();
    rebuildManifest(snapshot);
    const emptyUsername = run(snapshot, serverDir, dataDir, dbFile, ['--apply', '--confirm-app-stopped']);
    assert.notEqual(emptyUsername.status, 0);
    assert.match(emptyUsername.stderr, /keinen aktiven, anmeldbaren Online-Administrator/);
    const repairedUsernameDb = new Database(sourceDbFile);
    repairedUsernameDb.prepare("UPDATE users SET username='restore-admin'").run();
    repairedUsernameDb.close();
    rebuildManifest(snapshot);

    const missingDisplayNameDb = new Database(sourceDbFile);
    missingDisplayNameDb.exec('ALTER TABLE users DROP COLUMN display_name;');
    missingDisplayNameDb.close();
    rebuildManifest(snapshot);
    const missingDisplayName = run(
      snapshot, serverDir, dataDir, dbFile, ['--apply', '--confirm-app-stopped']
    );
    assert.notEqual(missingDisplayName.status, 0);
    assert.match(missingDisplayName.stderr, /vollständige Benutzerstruktur.*display_name/);
    assert.equal(
      fs.readFileSync(path.join(dataDir, 'alt.txt'), 'utf8'),
      'alter Stand\n',
      'eine nicht startfähige Restore-DB darf den bisherigen Datenstand nicht austauschen'
    );
    const repairedDisplayNameDb = new Database(sourceDbFile);
    repairedDisplayNameDb.exec(
      "ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';"
    );
    repairedDisplayNameDb.prepare('UPDATE users SET display_name=?').run('Restore Admin');
    repairedDisplayNameDb.close();
    rebuildManifest(snapshot);

    // Harter Abbruch exakt nach dem atomaren Daten-Rename: EXIT-Traps laufen
    // bei SIGKILL nicht. Der Parent-Marker muss trotzdem liegen bleiben und
    // bereits mit dem neuen Datenbaum gestarteten Code fail-closed sperren.
    const wrapperBin = path.join(root, 'kill-wrapper-bin');
    fs.mkdirSync(wrapperBin);
    const realMv = spawnSync('sh', ['-c', 'command -v mv'], { encoding: 'utf8' }).stdout.trim();
    const canonicalDataDir = path.join(fs.realpathSync(path.dirname(dataDir)), path.basename(dataDir));
    const mvWrapper = path.join(wrapperBin, 'mv');
    write(
      mvWrapper,
      '#!/bin/sh\n'
        + '"$RESTORE_TEST_REAL_MV" "$@"\n'
        + 'rc=$?\n'
        + 'last=\n'
        + 'for arg in "$@"; do last=$arg; done\n'
        + 'if [ "$rc" -eq 0 ] && [ "$last" = "$RESTORE_TEST_KILL_TARGET" ]; then\n'
        + '  kill -"${RESTORE_TEST_SIGNAL:-KILL}" "$PPID"\n'
        + 'fi\n'
        + 'exit "$rc"\n'
    );
    fs.chmodSync(mvWrapper, 0o755);
    const recoveryTest = require('../src/modules/recovery/mode')._test;
    const commonCrashEnv = {
      PATH: wrapperBin + path.delimiter + process.env.PATH,
      RESTORE_TEST_REAL_MV: realMv,
      RESTORE_TEST_KILL_TARGET: canonicalDataDir
    };
    const terminated = run(
      snapshot,
      serverDir,
      dataDir,
      dbFile,
      ['--apply', '--confirm-app-stopped'],
      { ...commonCrashEnv, RESTORE_TEST_SIGNAL: 'TERM' }
    );
    assert.equal(
      terminated.status,
      143,
      JSON.stringify({
        signal: terminated.signal,
        error: terminated.error && terminated.error.message,
        stdout: terminated.stdout,
        stderr: terminated.stderr
      })
    );
    assert.equal(fs.readFileSync(path.join(dataDir, 'alt.txt'), 'utf8'), 'alter Stand\n');
    assert.equal(recoveryTest.inspectRestoreProgressMarker({
      DOCUMENTS_DATA_ROOT: dataDir
    }).present, false);
    const gracefulFailedNew = fs.readdirSync(restoreParent)
      .filter((name) => name.includes('restore-rollback-') && name.endsWith('-daten'))
      .map((name) => path.join(restoreParent, name))
      .find((directory) => fs.existsSync(path.join(directory, 'fehlgeschlagen-neue-daten')));
    assert.ok(gracefulFailedNew, 'der abgebrochene neue Stand muss auf demselben Dateisystem erhalten bleiben');
    assert.equal(
      fs.existsSync(path.join(
        gracefulFailedNew,
        'fehlgeschlagen-neue-daten',
        'Dokumentenspeicher',
        'Fallakten',
        'A',
        'Akte',
        '260728 Test.txt'
      )),
      true
    );

    const crashed = run(
      snapshot,
      serverDir,
      dataDir,
      dbFile,
      ['--apply', '--confirm-app-stopped'],
      { ...commonCrashEnv, RESTORE_TEST_SIGNAL: 'KILL' }
    );
    assert.equal(crashed.signal, 'SIGKILL', crashed.stderr);
    const progress = recoveryTest.inspectRestoreProgressMarker({
      DOCUMENTS_DATA_ROOT: dataDir
    });
    assert.equal(progress.present, true);
    assert.equal(progress.valid, true);
    assert.equal(
      fs.existsSync(path.join(dataDir, '.recovery-quarantine')),
      true,
      'die neue Datenwurzel muss schon vor jedem späteren Ziel quarantänisiert sein'
    );
    const crashDb = new Database(dbFile);
    const crashMode = require('../src/modules/recovery/mode').ensure(crashDb, {
      env: {
        ENCRYPTION_KEY: '71'.repeat(32),
        DOCUMENTS_DATA_ROOT: dataDir
      }
    });
    assert.equal(crashMode.status().active, true);
    assert.equal(crashMode.status().reason, 'disaster_restore_in_progress');
    assert.equal(crashMode.status().readyToRelease, false);
    crashDb.close();

    const crashRollbacks = fs.readdirSync(restoreParent)
      .filter((name) => name.includes('restore-rollback-') && name.endsWith('-daten'))
      .map((name) => path.join(restoreParent, name))
      .filter((directory) => fs.existsSync(path.join(directory, 'alter-datenstand')));
    assert.equal(crashRollbacks.length, 1);
    const failedAfterCrash = path.join(crashRollbacks[0], 'fehlgeschlagen-nach-sigkill');
    fs.renameSync(dataDir, failedAfterCrash);
    fs.renameSync(path.join(crashRollbacks[0], 'alter-datenstand'), dataDir);
    fs.rmSync(progress.file);

    const applied = run(snapshot, serverDir, dataDir, dbFile, ['--apply', '--confirm-app-stopped']);
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /STATUS=WIEDERHERGESTELLT_QUARANTAENE/);
    assert.equal(fs.existsSync(path.join(dataDir, 'alt.txt')), false);
    assert.equal(
      fs.readFileSync(path.join(dataDir, 'Dokumentenspeicher', 'Fallakten', 'A', 'Akte', '260728 Test.txt'), 'utf8'),
      'neuer Inhalt\n'
    );
    assert.equal(fs.existsSync(path.join(dataDir, '.recovery-quarantine')), true);
    const restoredDb = new Database(dbFile, { readonly: true });
    assert.equal(restoredDb.prepare('SELECT wert FROM neu WHERE id=1').pluck().get(), 'ok');
    restoredDb.close();
    const runtimeSmoke = spawnSync(process.execPath, ['-e', `
      (async () => {
        const db = require('./src/database');
        require('./src/integrations/extensions/site-profile-routes');
        const { verifyPassword } = require('./src/middleware/authentication');
        const user = db.prepare(
          'SELECT username, password_hash, display_name FROM users WHERE username=?'
        ).get('restore-admin');
        if (!user || user.display_name !== 'Restore Admin') {
          throw new Error('Der wiederhergestellte Administrator ist im Runtime-Schema nicht lesbar.');
        }
        if (!(await verifyPassword(process.env.RESTORE_TEST_PASSWORD, user.password_hash))) {
          throw new Error('Das wiederhergestellte Administratorkennwort ist nicht anmeldbar.');
        }
        db.close();
        process.stdout.write('RESTORE_RUNTIME_LOGIN_OK');
      })().catch((error) => {
        process.stderr.write(String(error && error.stack || error));
        process.exitCode = 1;
      });
    `], {
      cwd: RUNTIME_SERVER_DIR,
      encoding: 'utf8',
      env: {
        ...process.env,
        DB_PATH: dbFile,
        DOCUMENTS_DATA_ROOT: dataDir,
        DATA_DIR: dataDir,
        ENCRYPTION_KEY: '71'.repeat(32),
        SESSION_SECRET: 'restore-runtime-smoke-session-secret',
        RESTORE_TEST_PASSWORD
      }
    });
    assert.equal(runtimeSmoke.status, 0, runtimeSmoke.stderr);
    assert.match(runtimeSmoke.stdout, /RESTORE_RUNTIME_LOGIN_OK/);
    const rollback = /^ROLLBACK=(.+)$/m.exec(applied.stdout);
    const dataRollback = /^ROLLBACK_DATEN=(.+)$/m.exec(applied.stdout);
    const dbRollback = /^ROLLBACK_DB=(.+)$/m.exec(applied.stdout);
    assert.ok(rollback && dataRollback && dbRollback);
    assert.equal(path.dirname(dataRollback[1]), fs.realpathSync(restoreParent));
    assert.equal(dbRollback[1], dataRollback[1]);
    assert.equal(fs.readFileSync(path.join(dataRollback[1], 'alter-datenstand', 'alt.txt'), 'utf8'), 'alter Stand\n');
    const oldDbAfterRestore = new Database(
      path.join(dataRollback[1], 'alter-datenstand', 'betreuungsbuero.sqlite3'),
      { readonly: true }
    );
    assert.equal(
      oldDbAfterRestore.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='alt'"
      ).get().n,
      1
    );
    oldDbAfterRestore.close();
    assert.deepEqual(
      fs.readdirSync(rollback[1]).sort(),
      ['ROLLBACK-JOURNAL.txt', 'ROLLBACK-ZIELE.txt'],
      'der zentrale Ordner darf nur Journal und Zielverweise enthalten'
    );
    assert.equal(recoveryTest.inspectRestoreProgressMarker({
      DOCUMENTS_DATA_ROOT: dataDir
    }).present, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Restore ordnet externe Dokumentwurzeln neu zu und aktiviert optionale Laufzeit-Artefakte', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'betreuungsbuero-restore-external-test-'));
  try {
    const snapshot = path.join(root, 'snapshot');
    const serverDir = path.join(root, 'server');
    const restoreParent = path.join(root, 'restore');
    const dataDir = path.join(restoreParent, 'data');
    const dbParent = path.join(restoreParent, 'datenbank');
    const dbFile = path.join(dbParent, 'betreuungsbuero.sqlite3');
    const externalBase = path.join(root, 'wiederhergestellte-dokumentwurzeln');
    const outputsDir = path.join(root, 'ausgelieferte-app');
    const extensionDir = path.join(restoreParent, 'extension-artifacts');
    fs.mkdirSync(serverDir);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(dbParent);
    fs.mkdirSync(externalBase);
    fs.mkdirSync(outputsDir);
    write(path.join(serverDir, 'package.json'), JSON.stringify({ name: 'fixture', version: '2.0.0' }));
    write(path.join(serverDir, 'assets', 'templates', 'alt.xlsx'), 'alte Vorlage\n');
    write(path.join(extensionDir, 'alt.zip'), 'alte Erweiterung\n');
    write(path.join(externalBase, 'alt.txt'), 'alte externe Daten\n');
    write(path.join(outputsDir, 'alt.html'), '<p>alt</p>\n');
    const oldDb = new Database(dbFile);
    oldDb.exec('CREATE TABLE alt (id INTEGER PRIMARY KEY);');
    oldDb.close();

    write(path.join(snapshot, 'STATUS.txt'), 'VOLLSTAENDIG\n');
    write(path.join(snapshot, 'verwaltung', 'SNAPSHOT-FORMAT.txt'), 'Betreuungsbuero-Gesamtsicherung/1\n');
    write(path.join(snapshot, 'inhalt', 'server-data', 'Dokumentenspeicher', 'Büroorganisation', 'neu.txt'), 'neue Daten\n');
    write(path.join(snapshot, 'inhalt', 'externe-dokumentwurzeln', '001', 'Fallakte', 'Dokument.pdf'), 'PDF-Test\n');
    write(path.join(snapshot, 'betrieb', 'browser-erweiterungen', 'paket.zip'), 'neue Erweiterung\n');
    write(path.join(snapshot, 'betrieb', 'server-ressourcen', 'templates', 'Stammdaten_blank.xlsx'), 'neue Vorlage\n');
    write(path.join(snapshot, 'betrieb', 'anwendung', 'Betreuungsbuero_Dokumentenassistent_v2.html'), '<p>neu</p>\n');
    write(path.join(snapshot, 'betrieb', 'konfiguration', 'package.json'), JSON.stringify({ name: 'fixture', version: '2.0.0' }));
    const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');
    const emptyCaseId = 'fall-leere-wurzel';
    write(
      path.join(snapshot, 'verwaltung', 'WURZELN.tsv'),
      [
        'Art\tBereich\tQuelle_Base64_UTF8\tSnapshotziel_Base64_UTF8',
        `intern\tserver-data\t${b64('/alte/interne-daten')}\t${b64('inhalt/server-data')}`,
        `STORAGE\tbase\t${b64('/alter/externer-speicher')}\t${b64('inhalt/externe-dokumentwurzeln/001')}`,
        `CASE\t${Buffer.from(emptyCaseId, 'utf8').toString('hex')}\t${b64('/alte/leere-fallwurzel')}\t${b64('inhalt/externe-dokumentwurzeln/002')}`
      ].join('\n') + '\n'
    );

    const sourceDbFile = path.join(snapshot, 'datenbank', 'betreuungsbuero.sqlite3');
    fs.mkdirSync(path.dirname(sourceDbFile), { recursive: true });
    const sourceDb = new Database(sourceDbFile);
    sourceDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        allow_local INTEGER NOT NULL DEFAULT 1,
        allow_online INTEGER NOT NULL DEFAULT 0,
        is_admin INTEGER NOT NULL DEFAULT 0,
        allow_case_management INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        active INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO users (
        id, username, password_hash, display_name, allow_local, allow_online,
        is_admin, allow_case_management, active
      ) VALUES (
        1,
        'restore-admin',
        '${RESTORE_TEST_HASH}',
        'Restore Admin',
        1,
        1,
        1,
        1,
        1
      );
      CREATE TABLE office_json (
        key TEXT PRIMARY KEY,
        data_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_by INTEGER REFERENCES users(id)
      );
    `);
    sourceDb.prepare('INSERT INTO office_json(key,data_json) VALUES (?,?)').run(
      'documents_config',
      JSON.stringify({
        storageRoot: '/alter/externer-speicher',
        baseDir: '/alte/interne-daten',
        caseDirs: { [emptyCaseId]: '/alte/leere-fallwurzel' }
      })
    );
    sourceDb.close();
    rebuildManifest(snapshot);

    const missingMapping = run(snapshot, serverDir, dataDir, dbFile, ['--apply', '--confirm-app-stopped']);
    assert.notEqual(missingMapping.status, 0);
    assert.match(missingMapping.stderr, /external-root-base.*Pflicht/);
    assert.equal(fs.readFileSync(path.join(externalBase, 'alt.txt'), 'utf8'), 'alte externe Daten\n');

    const applied = run(snapshot, serverDir, dataDir, dbFile, [
      '--apply',
      '--confirm-app-stopped',
      '--external-root-base', externalBase,
      '--restore-runtime-artifacts',
      '--outputs-dir', outputsDir
    ]);
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /EXTERNE_WURZELN=WIEDERHERGESTELLT/);
    assert.match(applied.stdout, /SERVERVORLAGEN=WIEDERHERGESTELLT/);
    assert.match(applied.stdout, /BROWSER_ERWEITERUNGEN=WIEDERHERGESTELLT/);
    assert.match(applied.stdout, /HTML_APP=WIEDERHERGESTELLT/);
    assert.equal(
      fs.readFileSync(path.join(externalBase, '001', 'Fallakte', 'Dokument.pdf'), 'utf8'),
      'PDF-Test\n'
    );
    assert.equal(fs.readFileSync(path.join(extensionDir, 'paket.zip'), 'utf8'), 'neue Erweiterung\n');
    assert.equal(fs.readFileSync(path.join(serverDir, 'assets', 'templates', 'Stammdaten_blank.xlsx'), 'utf8'), 'neue Vorlage\n');
    assert.equal(
      fs.readFileSync(path.join(outputsDir, 'Betreuungsbuero_Dokumentenassistent_v2.html'), 'utf8'),
      '<p>neu</p>\n'
    );
    const restoredDb = new Database(dbFile, { readonly: true });
    const config = JSON.parse(
      restoredDb.prepare("SELECT data_json FROM office_json WHERE key='documents_config'").pluck().get()
    );
    restoredDb.close();
    assert.equal(config.storageRoot, path.join(fs.realpathSync(path.dirname(externalBase)), path.basename(externalBase), '001'));
    assert.equal(config.caseDirs[emptyCaseId], path.join(fs.realpathSync(path.dirname(externalBase)), path.basename(externalBase), '002'));
    assert.equal(fs.statSync(path.join(externalBase, '002')).isDirectory(), true);
    const rollback = /^ROLLBACK=(.+)$/m.exec(applied.stdout);
    const dataRollback = /^ROLLBACK_DATEN=(.+)$/m.exec(applied.stdout);
    const dbRollback = /^ROLLBACK_DB=(.+)$/m.exec(applied.stdout);
    const externalRollback = /^ROLLBACK_EXTERN=(.+)$/m.exec(applied.stdout);
    const templateRollback = /^ROLLBACK_VORLAGEN=(.+)$/m.exec(applied.stdout);
    const extensionRollback = /^ROLLBACK_ERWEITERUNGEN=(.+)$/m.exec(applied.stdout);
    const appRollback = /^ROLLBACK_APP=(.+)$/m.exec(applied.stdout);
    assert.ok(
      rollback && dataRollback && dbRollback && externalRollback
      && templateRollback && extensionRollback && appRollback
    );
    assert.deepEqual(
      fs.readdirSync(rollback[1]).sort(),
      ['ROLLBACK-JOURNAL.txt', 'ROLLBACK-ZIELE.txt']
    );
    assert.equal(path.dirname(dataRollback[1]), fs.realpathSync(restoreParent));
    assert.equal(path.dirname(dbRollback[1]), fs.realpathSync(dbParent));
    assert.equal(path.dirname(externalRollback[1]), fs.realpathSync(root));
    assert.equal(path.dirname(templateRollback[1]), fs.realpathSync(path.join(serverDir, 'assets')));
    assert.equal(path.dirname(extensionRollback[1]), fs.realpathSync(restoreParent));
    assert.equal(path.dirname(appRollback[1]), fs.realpathSync(root));
    assert.equal(
      fs.readFileSync(path.join(externalRollback[1], 'alte-externe-dokumentwurzeln', 'alt.txt'), 'utf8'),
      'alte externe Daten\n'
    );
    const oldRestoredDb = new Database(path.join(dbRollback[1], 'alte-datenbank.sqlite3'), { readonly: true });
    assert.equal(
      oldRestoredDb.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='alt'").get().n,
      1
    );
    oldRestoredDb.close();
    assert.equal(
      fs.readFileSync(path.join(extensionRollback[1], 'alte-browser-erweiterungen', 'alt.zip'), 'utf8'),
      'alte Erweiterung\n'
    );
    assert.equal(
      fs.readFileSync(path.join(templateRollback[1], 'alte-servervorlagen', 'alt.xlsx'), 'utf8'),
      'alte Vorlage\n'
    );
    assert.equal(fs.readFileSync(path.join(appRollback[1], 'alte-app-ausgabe', 'alt.html'), 'utf8'), '<p>alt</p>\n');
    const journal = fs.readFileSync(path.join(rollback[1], 'ROLLBACK-JOURNAL.txt'), 'utf8');
    const dataAt = journal.indexOf('ACTIVATE new-data');
    const verifiedAt = journal.indexOf('VERIFY active-db=ok');
    const externalAt = journal.indexOf('ACTIVATE external-roots');
    const templateAt = journal.indexOf('ACTIVATE server-templates');
    const appAt = journal.indexOf('ACTIVATE app-output');
    assert.ok(dataAt >= 0 && verifiedAt > dataAt);
    assert.ok(externalAt > verifiedAt);
    assert.ok(templateAt > externalAt && appAt > templateAt);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
