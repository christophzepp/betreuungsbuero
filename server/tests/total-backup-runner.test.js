'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  runTotalBackup,
  pruefeZiel,
  targetMarker,
  inspectOffsiteBacklog,
  TARGET_MARKER,
  TARGET_MARKER_HEADER,
  _test
} = require('../src/modules/backup/runner');

function fakeSpawn(code, out, err, gesehen) {
  return (file, args, options) => {
    gesehen.push({ file, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => {
      if (out) child.stdout.emit('data', Buffer.from(out));
      if (err) child.stderr.emit('data', Buffer.from(err));
      child.emit('close', code, null);
    });
    return child;
  };
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code !== 'ESRCH';
  }
}

function writeClosedManifest(snapshot) {
  const files = [];
  const visit = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relative === 'MANIFEST.tsv' || relative === 'MANIFEST.tsv.sha256') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full, relative);
      else if (entry.isFile()) files.push(relative);
    }
  };
  visit(snapshot, '');
  files.sort();
  const manifest = files.map((relative) => {
    const bytes = fs.readFileSync(path.join(snapshot, ...relative.split('/')));
    return [
      crypto.createHash('sha256').update(bytes).digest('hex'),
      String(bytes.length),
      Buffer.from(relative, 'utf8').toString('base64')
    ].join('\t');
  }).join('\n') + '\n';
  fs.writeFileSync(path.join(snapshot, 'MANIFEST.tsv'), manifest);
  fs.writeFileSync(
    path.join(snapshot, 'MANIFEST.tsv.sha256'),
    crypto.createHash('sha256').update(Buffer.from(manifest)).digest('hex') + '\n'
  );
  return crypto.createHash('sha256').update(Buffer.from(manifest)).digest('hex');
}

async function main() {
  const serverDir = path.resolve(__dirname, '..');
  const dataDir = path.join(serverDir, 'data-test-does-not-matter');
  const outside = path.join(path.parse(serverDir).root, 'Volumes', 'Sicherung', 'Betreuung');

  assert.strictEqual(pruefeZiel(outside, dataDir, serverDir), path.resolve(outside));
  assert.throws(() => pruefeZiel('relative/sicherung', dataDir, serverDir), /absoluten Zielpfad/);
  assert.throws(() => pruefeZiel(serverDir, dataDir, serverDir), /(?:Server-\/Projekt|Daten)verzeichnis/);
  assert.throws(() => pruefeZiel(path.join(serverDir, 'backup'), dataDir, serverDir), /(?:Server-\/Projekt|Daten)verzeichnis/);
  assert.throws(() => pruefeZiel(path.parse(serverDir).root, dataDir, serverDir), /Wurzelverzeichnis/);
  assert.throws(
    () => _test.appFileFor({ outputsDir: path.join(os.tmpdir(), 'nicht-vorhandene-app-ausgabe') }, serverDir),
    /erwartete ausgelieferte App-Datei fehlt/
  );

  const aliasTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'total-backup-alias-'));
  try {
    const echt = path.join(aliasTmp, 'echt');
    const alias = path.join(aliasTmp, 'alias');
    fs.mkdirSync(path.join(echt, 'server'), { recursive: true });
    fs.symlinkSync(echt, alias);
    assert.throws(
      () => pruefeZiel(path.join(alias, 'server', 'backup'), path.join(echt, 'data'), path.join(echt, 'server')),
      /Server-\/Projektverzeichnis/
    );
  } finally {
    fs.rmSync(aliasTmp, { recursive: true, force: true });
  }

  const emptyMarkerTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'total-backup-empty-marker-'));
  try {
    const emptyMarker = path.join(emptyMarkerTarget, TARGET_MARKER);
    fs.writeFileSync(emptyMarker, '');
    assert.throws(() => targetMarker(emptyMarkerTarget), /Adminbereich initialisiert/);
    assert.strictEqual(fs.readFileSync(emptyMarker, 'utf8'), '');
  } finally {
    fs.rmSync(emptyMarkerTarget, { recursive: true, force: true });
  }

  const gesehen = [];
  const runnerTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'total-backup-runner-target-'));
  const runnerTargetId = '55555555-5555-4555-8555-555555555555';
  fs.writeFileSync(path.join(runnerTarget, TARGET_MARKER),
    `${TARGET_MARKER_HEADER}\nTARGET_ID=${runnerTargetId}\nCREATED_AT=2026-07-28T00:00:00Z\n`);
  const announcedSnapshot = path.join(runnerTarget, 'Gesamtsicherung_20260728_100000_job-manual');
  fs.mkdirSync(announcedSnapshot);
  fs.writeFileSync(path.join(announcedSnapshot, 'STATUS.txt'), 'VOLLSTAENDIG\n');
  fs.writeFileSync(path.join(announcedSnapshot, 'MANIFEST.tsv'), '');
  const ok = await runTotalBackup({
    serverDir,
    dataDir: serverDir, // vorhandener Testordner; Ziel liegt ausserhalb
    dbPath: path.join(serverDir, 'package.json'),
    scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
    destination: runnerTarget,
    label: 'Nacht Sicherung',
    baseEnvironment: {
      PATH: process.env.PATH || '/usr/bin:/bin',
      HOME: os.tmpdir(),
      ENCRYPTION_KEY: 'nur-fuer-lokale-recovery-pruefung',
      DOCUMENT_RECOVERY_KEY: 'nur-fuer-lokale-recovery-pruefung',
      SESSION_SECRET: 'darf-nicht-zum-backup-kind',
      SETUP_TOKEN: 'darf-nicht-zum-backup-kind'
    },
    spawnFn: fakeSpawn(0, `SNAPSHOT=${announcedSnapshot}\nSTATUS=VOLLSTAENDIG DATEIEN=5\n`, '', gesehen)
  });
  assert.strictEqual(ok.code, 0);
  assert.match(ok.text, /VOLLSTAENDIG/);
  assert.strictEqual(gesehen.length, 1);
  assert.strictEqual(gesehen[0].options.shell, false);
  assert.equal(gesehen[0].options.env.ENCRYPTION_KEY, 'nur-fuer-lokale-recovery-pruefung');
  assert.equal(gesehen[0].options.env.DOCUMENT_RECOVERY_KEY, 'nur-fuer-lokale-recovery-pruefung');
  assert.equal(Object.hasOwn(gesehen[0].options.env, 'SESSION_SECRET'), false);
  assert.equal(Object.hasOwn(gesehen[0].options.env, 'SETUP_TOKEN'), false);
  assert.ok(gesehen[0].args.includes('--require-marker'));
  assert.ok(gesehen[0].args.includes('--db'));
  assert.ok(gesehen[0].args.includes('--data-dir'));
  assert.ok(gesehen[0].args.includes('--destination'));
  assert.ok(gesehen[0].args.includes('--expected-target-id'));
  assert.ok(gesehen[0].args.includes('--job-id'));
  assert.ok(gesehen[0].args.includes('Nacht Sicherung'));
  assert.deepStrictEqual(
    gesehen[0].args.slice(
      gesehen[0].args.indexOf('--consistency-retries'),
      gesehen[0].args.indexOf('--consistency-retries') + 2
    ),
    ['--consistency-retries', '2']
  );

  assert.deepStrictEqual(
    _test.retentionArgs({ enabled: true, daily: 7, monthly: 6, yearly: 5 }),
    [
      '--retention-daily', '7',
      '--retention-monthly', '6',
      '--retention-yearly', '5',
      '--retention-diagnostic', '6'
    ]
  );
  assert.throws(
    () => _test.retentionArgs({ enabled: true, diagnostic: 2, daily: 0, monthly: 0, yearly: 0 }),
    /mindestens eine/
  );
  assert.deepStrictEqual(_test.retentionArgs({ enabled: false, daily: 99 }), []);
  assert.deepStrictEqual(
    _test.capacityArgs({ retention: { enabled: true, minFreeGb: 2 } }),
    ['--capacity-warning-bytes', String(2 * 1024 * 1024 * 1024)]
  );

  const markerInfo = targetMarker(runnerTarget);
  await assert.rejects(
    runTotalBackup({
      serverDir,
      dataDir: serverDir,
      dbPath: path.join(serverDir, 'package.json'),
      scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
      destination: runnerTarget,
      expectedTargetId: '00000000-0000-4000-8000-000000000000',
      spawnFn: fakeSpawn(0, '', '', [])
    }),
    /Falscher Sicherungsdatenträger/
  );
  assert.match(markerInfo.targetId, /^[0-9a-f-]{36}$/);

  // Die lokale Schreibschranke darf bereits nach einer vollständig
  // validierten, auch über mehrere stdout-Chunks verteilten SNAPSHOT-Zeile
  // fallen. Offsite/Retention des Kindprozesses können danach weiterlaufen.
  const splitSnapshot = path.join(runnerTarget, 'Gesamtsicherung_20260728_110000_job-split');
  fs.mkdirSync(splitSnapshot);
  fs.writeFileSync(path.join(splitSnapshot, 'STATUS.txt'), 'VOLLSTAENDIG\n');
  fs.writeFileSync(path.join(splitSnapshot, 'MANIFEST.tsv'), '');
  const diagnosticSnapshot = path.join(
    runnerTarget,
    'Gesamtsicherung_20260728_105900_job-split_UNVOLLSTAENDIG'
  );
  let childClosed = false;
  let localReadyCount = 0;
  let localResolve;
  const localReady = new Promise((resolve) => { localResolve = resolve; });
  const splitRun = runTotalBackup({
    serverDir,
    dataDir: serverDir,
    dbPath: path.join(serverDir, 'package.json'),
    scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
    destination: runnerTarget,
    jobId: 'split',
    onLocalSnapshotReady(info) {
      localReadyCount += 1;
      localResolve(info);
    },
    spawnFn() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit(
          'data',
          Buffer.from(`DIAGNOSE_SNAPSHOT=${diagnosticSnapshot}\nSNAP`)
        );
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from(`SHOT=${splitSnapshot}\n`));
          setTimeout(() => {
            childClosed = true;
            child.stdout.emit('data', Buffer.from('STATUS=VOLLSTAENDIG DATEIEN=3\n'));
            child.emit('close', 0, null);
          }, 20);
        });
      });
      return child;
    }
  });
  const localInfo = await localReady;
  assert.equal(childClosed, false, 'lokale Bestätigung kam erst nach Ende der Offsite-Phase');
  assert.equal(localInfo.snapshot, fs.realpathSync(splitSnapshot));
  const splitResult = await splitRun;
  assert.equal(localReadyCount, 1, 'Diagnose-Snapshot hat die lokale Bestätigung ausgelöst');
  assert.deepStrictEqual(splitResult.diagnosticSnapshots, [diagnosticSnapshot]);

  await assert.rejects(
    runTotalBackup({
      serverDir,
      dataDir: serverDir,
      dbPath: path.join(serverDir, 'package.json'),
      scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
      destination: runnerTarget,
      spawnFn: fakeSpawn(
        0,
        `SNAPSHOT=${splitSnapshot}\nSNAPSHOT=${splitSnapshot}\n`,
        '',
        []
      )
    }),
    /mehr als einen finalen lokalen Snapshot/
  );

  const offsiteTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'total-backup-offsite-'));
  try {
    const passwordFile = path.join(offsiteTemp, 'restic-password');
    const credentialEnvFile = path.join(offsiteTemp, 'restic-backend.env');
    fs.writeFileSync(passwordFile, 'test-passwort');
    fs.chmodSync(passwordFile, 0o600);
    fs.writeFileSync(credentialEnvFile, [
      '# Nur explizit freigegebene Provider-Werte',
      'AWS_ACCESS_KEY_ID=fixture-access-id',
      'AWS_SECRET_ACCESS_KEY=fixture-secret-key',
      ''
    ].join('\n'));
    fs.chmodSync(credentialEnvFile, 0o600);
    assert.deepStrictEqual(_test.resticCredentialEnvironment(credentialEnvFile).env, {
      AWS_ACCESS_KEY_ID: 'fixture-access-id',
      AWS_SECRET_ACCESS_KEY: 'fixture-secret-key'
    });
    const sanitizedResticEnvironment = _test.resticProcessEnvironment(
      {
        AWS_ACCESS_KEY_ID: 'fixture-access-id',
        AWS_SECRET_ACCESS_KEY: 'fixture-secret-key'
      },
      {
        PATH: '/usr/bin:/bin',
        HOME: '/tmp/restic-home',
        HTTPS_PROXY: 'https://proxy.example.invalid',
        SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
        SESSION_SECRET: 'nicht-vererben',
        ENCRYPTION_KEY: 'nicht-vererben',
        DOCUMENT_RECOVERY_KEY: 'nicht-vererben',
        SETUP_TOKEN: 'nicht-vererben'
      }
    );
    assert.equal(sanitizedResticEnvironment.PATH, '/usr/bin:/bin');
    assert.equal(sanitizedResticEnvironment.HTTPS_PROXY, 'https://proxy.example.invalid');
    assert.equal(sanitizedResticEnvironment.SSH_AUTH_SOCK, '/tmp/ssh-agent.sock');
    assert.equal(sanitizedResticEnvironment.AWS_ACCESS_KEY_ID, 'fixture-access-id');
    for (const key of [
      'SESSION_SECRET', 'ENCRYPTION_KEY', 'DOCUMENT_RECOVERY_KEY', 'SETUP_TOKEN'
    ]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(sanitizedResticEnvironment, key),
        false
      );
    }
    const sanitizedBackupEnvironment = _test.backupProcessEnvironment(
      { AWS_ACCESS_KEY_ID: 'fixture-access-id' },
      {
        PATH: '/usr/bin:/bin',
        SESSION_SECRET: 'nicht-vererben',
        SETUP_TOKEN: 'nicht-vererben',
        ENCRYPTION_KEY: 'ab'.repeat(32),
        DOCUMENT_RECOVERY_KEY: 'drk1_' + 'A'.repeat(43),
        DOCUMENT_RECOVERY_KEY_FILE: '/run/secrets/document-recovery-key'
      }
    );
    assert.equal(sanitizedBackupEnvironment.ENCRYPTION_KEY, 'ab'.repeat(32));
    assert.equal(
      sanitizedBackupEnvironment.DOCUMENT_RECOVERY_KEY_FILE,
      '/run/secrets/document-recovery-key'
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(sanitizedBackupEnvironment, 'SESSION_SECRET'),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(sanitizedBackupEnvironment, 'SETUP_TOKEN'),
      false
    );
    const invalidCredentialFile = path.join(offsiteTemp, 'restic-backend-invalid.env');
    fs.writeFileSync(invalidCredentialFile, 'UNERLAUBTES_GEHEIMNIS=nicht-laden\n');
    fs.chmodSync(invalidCredentialFile, 0o600);
    assert.throws(
      () => _test.resticCredentialEnvironment(invalidCredentialFile),
      /nicht freigegebenen Schlüssel/
    );
    assert.deepStrictEqual(
      _test.offsiteArgs({
        enabled: true,
        mode: 'restic',
        repository: 's3:https://storage.example.invalid/backup',
        passwordFile,
        tag: 'nacht'
      }),
      [
        '--offsite-mode', 'restic',
        '--offsite-repository', 's3:https://storage.example.invalid/backup',
        '--offsite-password-file', passwordFile,
        '--offsite-tag', 'nacht',
        '--offsite-required', 'yes',
        '--offsite-retention-mode', 'external',
        '--offsite-max-pending', '14',
        '--offsite-check-days', '7',
        '--offsite-read-slices', '7'
      ]
    );
    assert.strictEqual(_test.offsiteJobTag('nacht'), _test.offsiteJobTag('nacht'));
    assert.notStrictEqual(_test.offsiteJobTag('nacht'), _test.offsiteJobTag('monat'));
    assert.match(_test.offsiteJobTag('nacht'), /^bb-job-[0-9a-f]{24}$/);
    assert.throws(
      () => _test.offsiteArgs({
        enabled: true,
        mode: 'restic',
        repository: 's3:https://storage.example.invalid/backup',
        passwordFile,
        retentionMode: 'inline'
      }),
      /getrennte Offsite-Wartung/
    );
    assert.throws(
      () => _test.offsiteArgs({
        enabled: true,
        mode: 'restic',
        repository: '/Volumes/NAS/restic',
        passwordFile
      }),
      /Remote-restic-Repository/
    );
    if (process.platform !== 'win32') {
      fs.chmodSync(passwordFile, 0o640);
      assert.throws(
        () => _test.offsiteArgs({
          enabled: true,
          mode: 'restic',
          repository: 's3:https://storage.example.invalid/backup',
          passwordFile
        }),
        /0600/
      );
      fs.chmodSync(passwordFile, 0o600);
    }

    // Ein vorhandener Pending-Sidecar darf einen normalen/manualen Lauf nicht
    // automatisch in einen reinen Remote-Retry verwandeln. Erst der
    // persistierte Scheduler-Retry setzt resumeOffsiteOnly ausdrücklich.
    const resumeJob = 'resume-test';
    const resumeOffsite = {
      enabled: true,
      mode: 'restic',
      repository: 's3:https://storage.example.invalid/backup',
      passwordFile,
      tag: 'nacht'
    };
    const resumeIdentity = _test.offsiteProfileIdentity(resumeOffsite, resumeJob);
    const resumeSidecar = `${splitSnapshot}.offsite-pending`;
    fs.writeFileSync(resumeSidecar, [
      'FORMAT=Betreuungsbuero-Offsite-Pending/1',
      `SNAPSHOT=${path.basename(splitSnapshot)}`,
      `MANIFEST_SHA=${'a'.repeat(64)}`,
      `PROFILE_SHA=${resumeIdentity.profileSha}`,
      `JOB_ID=${resumeJob}`,
      `TARGET_ID=${markerInfo.targetId}`,
      'CREATED_AT=2026-07-28T00:00:00Z',
      ''
    ].join('\n'));
    const foreignProfileSidecar = `${announcedSnapshot}.offsite-pending`;
    fs.writeFileSync(foreignProfileSidecar, [
      'FORMAT=Betreuungsbuero-Offsite-Pending/1',
      `SNAPSHOT=${path.basename(announcedSnapshot)}`,
      `MANIFEST_SHA=${'b'.repeat(64)}`,
      `PROFILE_SHA=${'c'.repeat(64)}`,
      `JOB_ID=${resumeJob}`,
      `TARGET_ID=${markerInfo.targetId}`,
      'CREATED_AT=2026-07-27T00:00:00Z',
      ''
    ].join('\n'));
    const pendingMatches = _test.pendingOffsiteSnapshots(
      runnerTarget, resumeJob, resumeIdentity.profileSha, markerInfo.targetId
    );
    assert.strictEqual(pendingMatches.length, 1);
    assert.deepStrictEqual(
      _test.offsiteBacklogSummary(
        runnerTarget, resumeJob, resumeIdentity.profileSha, markerInfo.targetId
      ),
      {
        total: 2,
        currentProfile: 1,
        foreignProfile: 1,
        otherJob: 0,
        foreignTarget: 0,
        invalid: 0
      }
    );
    const inspectedBacklog = inspectOffsiteBacklog({
      destination: runnerTarget,
      jobId: resumeJob,
      expectedTargetId: markerInfo.targetId,
      offsite: resumeOffsite
    });
    assert.strictEqual(inspectedBacklog.pendingForJob, 2);
    assert.strictEqual(inspectedBacklog.blocksProfileChange, true);
    assert.strictEqual(inspectedBacklog.warning, true);

    const normalPendingArgs = [];
    const normalPendingResult = await runTotalBackup({
      serverDir,
      dataDir: serverDir,
      dbPath: path.join(serverDir, 'package.json'),
      scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
      destination: runnerTarget,
      jobId: resumeJob,
      offsite: resumeOffsite,
      resticCredentialEnvFile: credentialEnvFile,
      baseEnvironment: {
        PATH: process.env.PATH || '/usr/bin:/bin',
        SESSION_SECRET: 'nicht-an-sicherungskind',
        SETUP_TOKEN: 'nicht-an-sicherungskind',
        ENCRYPTION_KEY: 'ab'.repeat(32),
        DOCUMENT_RECOVERY_KEY_FILE: '/run/secrets/document-recovery-key'
      },
      spawnFn: fakeSpawn(
        0,
        `SNAPSHOT=${splitSnapshot}\nSTATUS=VOLLSTAENDIG DATEIEN=3\n`,
        '',
        normalPendingArgs
      )
    });
    assert.strictEqual(
      normalPendingArgs[0].args.includes('--resume-offsite-only'),
      false,
      'normaler Lauf wurde durch alten Pending-Sidecar zum Remote-only-Retry'
    );
    assert.strictEqual(normalPendingArgs[0].options.env.AWS_ACCESS_KEY_ID, 'fixture-access-id');
    assert.strictEqual(normalPendingArgs[0].options.env.AWS_SECRET_ACCESS_KEY, 'fixture-secret-key');
    assert.strictEqual(normalPendingArgs[0].options.env.ENCRYPTION_KEY, 'ab'.repeat(32));
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(normalPendingArgs[0].options.env, 'SESSION_SECRET'),
      false
    );
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(normalPendingArgs[0].options.env, 'SETUP_TOKEN'),
      false
    );
    assert.notStrictEqual(process.env.AWS_SECRET_ACCESS_KEY, 'fixture-secret-key');
    assert.strictEqual(
      normalPendingArgs[0].args.some((arg) => String(arg).includes('fixture-secret-key')),
      false
    );
    assert.strictEqual(normalPendingResult.offsiteBacklog.foreignProfile, 1);

    const explicitRetryArgs = [];
    let explicitRetryError;
    try {
      await runTotalBackup({
        serverDir,
        dataDir: path.join(offsiteTemp, 'absichtlich-fehlende-daten'),
        dbPath: path.join(offsiteTemp, 'absichtlich-fehlende.sqlite3'),
        scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
        destination: runnerTarget,
        jobId: resumeJob,
        resumeOffsiteOnly: true,
        resumeSnapshot: path.basename(splitSnapshot),
        // Darf im Remote-only-Pfad weder gelesen noch validiert werden.
        recoveryKeyFingerprint: 'absichtlich-ungueltig',
        offsite: resumeOffsite,
        appFile: path.join(offsiteTemp, 'absichtlich-fehlende-app.html'),
        spawnFn: fakeSpawn(
          75,
          `LOCAL_COMPLETE=1\nOFFSITE_PENDING=1\nRESUME_SNAPSHOT=${splitSnapshot}\n`,
          'restic nicht erreichbar\n',
          explicitRetryArgs
        )
      });
    } catch (error) {
      explicitRetryError = error;
    }
    assert.ok(explicitRetryError);
    assert.strictEqual(explicitRetryError.localComplete, true);
    assert.strictEqual(explicitRetryError.offsitePending, true);
    assert.strictEqual(explicitRetryError.resumeOnly, true);
    assert.strictEqual(explicitRetryError.offsiteBacklog.foreignProfile, 1);
    assert.ok(explicitRetryArgs[0].args.includes('--resume-offsite-only'));
    assert.deepStrictEqual(
      explicitRetryArgs[0].args.slice(
        explicitRetryArgs[0].args.indexOf('--resume-snapshot'),
        explicitRetryArgs[0].args.indexOf('--resume-snapshot') + 2
      ),
      ['--resume-snapshot', path.basename(splitSnapshot)]
    );
    assert.strictEqual(explicitRetryArgs[0].args.includes('--expected-recovery-fingerprint'), false);
    fs.unlinkSync(resumeSidecar);
    fs.unlinkSync(foreignProfileSidecar);

    // Crashfenster: Der Remote-Status wurde bereits dauerhaft als OK
    // veröffentlicht und der Pending-Sidecar entfernt, nur die App-DB konnte
    // den Erfolg vor dem Prozessabbruch noch nicht übernehmen.
    fs.mkdirSync(path.join(splitSnapshot, 'verwaltung'), { recursive: true });
    fs.writeFileSync(path.join(splitSnapshot, 'verwaltung', 'JOB-ID.txt'), `${resumeJob}\n`);
    fs.writeFileSync(
      path.join(splitSnapshot, 'verwaltung', 'TARGET-ID.txt'),
      `${markerInfo.targetId}\n`
    );
    let reconciledManifestSha = writeClosedManifest(splitSnapshot);
    const receiptFile = `${splitSnapshot}.offsite-status`;
    const validReceipt = [
      'OK',
      'Format: Betreuungsbuero-Offsite-Status/2',
      `Snapshot: ${path.basename(splitSnapshot)}`,
      `Target-ID: ${markerInfo.targetId}`,
      `Manifest-SHA-256: ${reconciledManifestSha}`,
      `Restic-Job-Tag: ${resumeIdentity.jobTag}`,
      `Job-ID: ${resumeJob}`,
      `Profil-SHA-256: ${resumeIdentity.profileSha}`,
      `Restic-Snapshot-ID: ${'d'.repeat(64)}`,
      ''
    ].join('\n');
    fs.writeFileSync(receiptFile, validReceipt);
    let reconcileSpawned = false;
    const reconciled = await runTotalBackup({
      serverDir,
      dataDir: path.join(offsiteTemp, 'absichtlich-fehlende-daten'),
      dbPath: path.join(offsiteTemp, 'absichtlich-fehlende.sqlite3'),
      scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
      destination: runnerTarget,
      jobId: resumeJob,
      resumeOffsiteOnly: true,
      resumeSnapshot: path.basename(splitSnapshot),
      offsite: resumeOffsite,
      resticCredentialEnvFile: credentialEnvFile,
      spawnFn() {
        reconcileSpawned = true;
        throw new Error('Der bestätigte Snapshot darf nicht erneut hochgeladen werden.');
      }
    });
    assert.strictEqual(reconcileSpawned, false);
    assert.strictEqual(reconciled.reconciledAfterCrash, true);
    assert.strictEqual(reconciled.resumedOffsite, true);
    assert.strictEqual(reconciled.offsitePending, false);
    assert.strictEqual(reconciled.snapshot, fs.realpathSync(splitSnapshot));
    assert.match(reconciled.text, /RECONCILED_OFFSITE=OK/);

    fs.writeFileSync(path.join(splitSnapshot, 'STATUS.txt'), 'BESCHAEDIGT\n');
    await assert.rejects(
      runTotalBackup({
        serverDir,
        dataDir: path.join(offsiteTemp, 'absichtlich-fehlende-daten'),
        dbPath: path.join(offsiteTemp, 'absichtlich-fehlende.sqlite3'),
        scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
        destination: runnerTarget,
        jobId: resumeJob,
        resumeOffsiteOnly: true,
        resumeSnapshot: path.basename(splitSnapshot),
        offsite: resumeOffsite,
        resticCredentialEnvFile: credentialEnvFile,
        spawnFn: fakeSpawn(0, '', '', [])
      }),
      /weder eine passende wartende Generation noch einen gültigen positiven Abschlussbeleg/
    );
    fs.writeFileSync(path.join(splitSnapshot, 'STATUS.txt'), 'VOLLSTAENDIG\n');
    reconciledManifestSha = writeClosedManifest(splitSnapshot);
    const refreshedReceipt = validReceipt.replace(
      `Manifest-SHA-256: ${validReceipt.match(/Manifest-SHA-256: ([0-9a-f]+)/)[1]}`,
      `Manifest-SHA-256: ${reconciledManifestSha}`
    );
    fs.writeFileSync(
      receiptFile,
      refreshedReceipt.replace(`Job-ID: ${resumeJob}`, 'Job-ID: anderer-job')
    );
    await assert.rejects(
      runTotalBackup({
        serverDir,
        dataDir: path.join(offsiteTemp, 'absichtlich-fehlende-daten'),
        dbPath: path.join(offsiteTemp, 'absichtlich-fehlende.sqlite3'),
        scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
        destination: runnerTarget,
        jobId: resumeJob,
        resumeOffsiteOnly: true,
        resumeSnapshot: path.basename(splitSnapshot),
        offsite: resumeOffsite,
        resticCredentialEnvFile: credentialEnvFile,
        spawnFn: fakeSpawn(0, '', '', [])
      }),
      /weder eine passende wartende Generation noch einen gültigen positiven Abschlussbeleg/
    );

    await assert.rejects(
      runTotalBackup({
        serverDir,
        dataDir: offsiteTemp,
        dbPath: path.join(serverDir, 'package.json'),
        scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
        destination: runnerTarget,
        offsite: {
          enabled: true,
          mode: 'restic',
          repository: 's3:https://storage.example.invalid/backup',
          passwordFile
        },
        spawnFn: fakeSpawn(0, '', '', [])
      }),
      /außerhalb von Anwendung, Dokumentenspeicher und Sicherungsziel/
    );

    const heartbeatSecretFile = path.join(offsiteTemp, 'heartbeat-secret');
    const heartbeatSecret = Buffer.from('0123456789abcdef0123456789abcdef');
    fs.writeFileSync(heartbeatSecretFile, heartbeatSecret);
    if (process.platform !== 'win32') {
      fs.chmodSync(heartbeatSecretFile, 0o644);
      assert.throws(
        () => _test.heartbeatConfig({
          enabled: true,
          url: 'https://monitor.example.invalid/backup-ok',
          secretFile: heartbeatSecretFile
        }),
        /0600/
      );
    }
    fs.chmodSync(heartbeatSecretFile, 0o600);
    const heartbeatConfig = _test.heartbeatConfig({
      enabled: true,
      url: 'https://monitor.example.invalid/backup-ok',
      secretFile: heartbeatSecretFile,
      timeoutMs: 1000
    });
    let heartbeatCall;
    await _test.sendSuccessHeartbeat(heartbeatConfig,
      { event: 'backup_complete', jobId: 'nacht' }, (url, options, callback) => {
      const request = new EventEmitter();
      request.setTimeout = () => {};
      request.destroy = (error) => request.emit('error', error);
      request.end = (body) => {
        heartbeatCall = { url: String(url), options, body };
        const response = new EventEmitter();
        response.statusCode = 204;
        response.resume = () => {};
        callback(response);
        process.nextTick(() => response.emit('end'));
      };
      return request;
    });
    const expectedSignature = require('crypto')
      .createHmac('sha256', heartbeatSecret)
      .update(heartbeatCall.body)
      .digest('hex');
    assert.equal(
      heartbeatCall.options.headers['x-betreuungsbuero-signature'],
      `sha256=${expectedSignature}`
    );
    assert.doesNotMatch(heartbeatCall.body.toString('utf8'), /0123456789abcdef/);

    const deadlineStarted = Date.now();
    await assert.rejects(
      _test.sendSuccessHeartbeat({
        ...heartbeatConfig,
        timeoutMs: 25
      }, { event: 'backup_complete', jobId: 'deadline' }, (_url, _options, callback) => {
        const request = new EventEmitter();
        request.setTimeout = () => {};
        request.destroy = (error) => request.emit('error', error);
        request.end = () => {
          const response = new EventEmitter();
          response.statusCode = 200;
          response.resume = () => {};
          callback(response);
          // Absichtlich weder end noch Fehler: Nur die absolute Deadline darf
          // diesen bereits erfolgreichen Backupjob wieder freigeben.
        };
        return request;
      }),
      /absolute Zeitgrenze/
    );
    assert.ok(Date.now() - deadlineStarted < 1000, 'absolute Heartbeat-Deadline hing');

    let degradedPayload;
    const degradedResult = await runTotalBackup({
      serverDir,
      dataDir: serverDir,
      dbPath: path.join(serverDir, 'package.json'),
      scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
      destination: runnerTarget,
      offsite: {
        enabled: true,
        mode: 'restic',
        repository: 's3:https://storage.example.invalid/backup',
        passwordFile,
        required: false
      },
      heartbeat: {
        enabled: true,
        url: 'https://monitor.example.invalid/backup-ok',
        secretFile: heartbeatSecretFile,
        timeoutMs: 1000
      },
      heartbeatRequestFn(_url, _options, callback) {
        const request = new EventEmitter();
        request.setTimeout = () => {};
        request.destroy = (error) => request.emit('error', error);
        request.end = (body) => {
          degradedPayload = JSON.parse(String(body));
          const response = new EventEmitter();
          response.statusCode = 204;
          response.resume = () => {};
          callback(response);
          process.nextTick(() => response.emit('end'));
        };
        return request;
      },
      spawnFn: fakeSpawn(
        0,
        `SNAPSHOT=${splitSnapshot}\nWARNUNG=OFFSITE_NICHT_ERFORDERLICH RC=75\nSTATUS=VOLLSTAENDIG DATEIEN=3\n`,
        '',
        []
      )
    });
    assert.equal(degradedResult.degraded, true);
    assert.equal(degradedPayload.event, 'backup_degraded');
    assert.equal(degradedPayload.protection, 'local-only-degraded');

    const heartbeatFailure = await runTotalBackup({
      serverDir,
      dataDir: serverDir,
      dbPath: path.join(serverDir, 'package.json'),
      scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
      destination: runnerTarget,
      heartbeat: {
        enabled: true,
        url: 'https://monitor.example.invalid/backup-ok',
        secretFile: heartbeatSecretFile,
        timeoutMs: 1000
      },
      heartbeatRequestFn() {
        const request = new EventEmitter();
        request.setTimeout = () => {};
        request.destroy = (error) => request.emit('error', error);
        request.end = () => process.nextTick(() => request.emit('error', new Error('Monitor offline')));
        return request;
      },
      spawnFn: fakeSpawn(
        0,
        `SNAPSHOT=${splitSnapshot}\nSTATUS=VOLLSTAENDIG DATEIEN=3\n`,
        '',
        []
      )
    });
    assert.equal(heartbeatFailure.code, 0, 'Monitorfehler löste eine neue Vollaufnahme aus');
    assert.equal(heartbeatFailure.heartbeatOk, false);
    assert.match(heartbeatFailure.text, /WARNUNG=DEAD_MAN_HEARTBEAT_FEHLER/);
  } finally {
    fs.rmSync(offsiteTemp, { recursive: true, force: true });
  }

  await assert.rejects(
    runTotalBackup({
      serverDir,
      dataDir: serverDir,
      dbPath: path.join(serverDir, 'package.json'),
      scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
      destination: runnerTarget,
      spawnFn: fakeSpawn(2, 'STATUS=UNVOLLSTAENDIG\n', '', [])
    }),
    /UNVOLLSTÄNDIGE Gesamtsicherung/
  );
  await assert.rejects(
    runTotalBackup({
      serverDir,
      dataDir: serverDir,
      dbPath: path.join(serverDir, 'package.json'),
      scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
      destination: runnerTarget,
      spawnFn: fakeSpawn(64, '', 'Zielmarke fehlt', [])
    }),
    /Rückgabecode 64.*Zielmarke fehlt/
  );

  const signale = [];
  await assert.rejects(
    runTotalBackup({
      serverDir,
      dataDir: serverDir,
      dbPath: path.join(serverDir, 'package.json'),
      scriptPath: path.join(serverDir, 'tools', 'gesamt-backup.sh'),
      destination: runnerTarget,
      timeoutMs: 20,
      spawnFn() {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = (signal) => {
          signale.push(signal);
          process.nextTick(() => child.emit('close', null, signal));
          return true;
        };
        return child;
      }
    }),
    /Zeitlimit/
  );
  assert.deepStrictEqual(signale, ['SIGTERM']);

  // Integrationsnachweis: Der echte POSIX-Runner beendet bei einem Zeitlimit
  // nicht nur die wartende Shell, sondern deren gesamte neue Prozessgruppe.
  // So darf insbesondere kein tar/restic/sqlite-Unterprozess weiterlaufen.
  if (process.platform !== 'win32') {
    const processTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'total-backup-process-group-'));
      const targetTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'total-backup-process-target-'));
    let childPid = 0;
    try {
      const processServer = path.join(processTemp, 'server');
      const processData = path.join(processServer, 'data');
      const processDb = path.join(processData, 'fixture.sqlite3');
      const processScript = path.join(processServer, 'hang-backup.sh');
      const processApp = path.join(processTemp, 'fixture-app.html');
      const childPidFile = path.join(processTemp, 'child.pid');
      fs.mkdirSync(processData, { recursive: true });
      fs.writeFileSync(processDb, 'fixture');
      fs.writeFileSync(processApp, '<html>fixture</html>');
      fs.writeFileSync(path.join(targetTemp, TARGET_MARKER),
        `${TARGET_MARKER_HEADER}\nTARGET_ID=66666666-6666-4666-8666-666666666666\n` +
        'CREATED_AT=2026-07-28T00:00:00Z\n');
      fs.writeFileSync(processScript, [
        '#!/usr/bin/env bash',
        "trap 'exit 143' TERM INT",
        'sleep 30 &',
        `printf '%s\\n' "$!" > ${JSON.stringify(childPidFile)}`,
        'wait'
      ].join('\n') + '\n');
      fs.chmodSync(processScript, 0o700);
      await assert.rejects(
        runTotalBackup({
          serverDir: processServer,
          dataDir: processData,
          dbPath: processDb,
          scriptPath: processScript,
          appFile: processApp,
          destination: targetTemp,
          timeoutMs: 1000,
          consistencyRetries: 0
        }),
        /Zeitlimit/
      );
      childPid = Number(fs.readFileSync(childPidFile, 'utf8').trim());
      assert.ok(Number.isInteger(childPid) && childPid > 0);
      for (let attempt = 0; attempt < 20 && processAlive(childPid); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.strictEqual(processAlive(childPid), false, 'Unterprozess lief nach Timeout weiter');
    } finally {
      if (childPid && processAlive(childPid)) {
        try { process.kill(childPid, 'SIGKILL'); } catch (_error) { /* bereits beendet */ }
      }
      fs.rmSync(processTemp, { recursive: true, force: true });
      fs.rmSync(targetTemp, { recursive: true, force: true });
    }
  }

  assert.strictEqual(TARGET_MARKER, '.betreuungsbuero-backup-ziel');
  fs.rmSync(runnerTarget, { recursive: true, force: true });
  console.log('total-backup-runner: OK');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
