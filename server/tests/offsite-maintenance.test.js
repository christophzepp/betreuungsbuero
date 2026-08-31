'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const maintenance = require('../tools/offsite-maintenance');
const status = require('../src/modules/backup/offsite-maintenance-status');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-offsite-maintenance-'));
  const secrets = path.join(root, 'secrets');
  const receipts = path.join(root, 'receipts');
  fs.mkdirSync(secrets, { mode: 0o700 });
  fs.mkdirSync(receipts, { mode: 0o700 });
  const password = path.join(secrets, 'restic-password');
  const credentials = path.join(secrets, 'maintenance-backend.env');
  const log = path.join(root, 'restic.log');
  const fakeRestic = path.join(root, 'restic-fixture.sh');
  const grandchild = path.join(root, 'grandchild-fixture.sh');
  fs.writeFileSync(password, 'nicht-im-beleg\n', { mode: 0o600 });
  fs.writeFileSync(credentials, [
    'AWS_ACCESS_KEY_ID=maintenance-delete-id',
    'AWS_SECRET_ACCESS_KEY=maintenance-delete-secret',
    ''
  ].join('\n'), { mode: 0o600 });
  fs.writeFileSync(grandchild, [
    '#!/bin/sh',
    'base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)',
    // Ignorierte Signaldispositionen werden an sleep vererbt. Der Prozess
    // überlebt damit SIGTERM sicher und beweist, dass der Supervisor nach der
    // Gnadenfrist wirklich die gesamte Prozessgruppe mit SIGKILL beendet.
    "trap '' TERM HUP INT",
    'printf "%s\\n" "$$" > "$base/grandchild.pid"',
    'sleep 5',
    'printf "survived\\n" > "$base/grandchild-survived"',
    ''
  ].join('\n'), { mode: 0o700 });
  fs.writeFileSync(fakeRestic, [
    '#!/bin/sh',
    'base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)',
    'forbidden=',
    '[ -z "${SESSION_SECRET+x}" ] || forbidden=SESSION_SECRET',
    '[ -z "${ENCRYPTION_KEY+x}" ] || forbidden=ENCRYPTION_KEY',
    '[ -z "${DOCUMENT_RECOVERY_KEY+x}" ] || forbidden=DOCUMENT_RECOVERY_KEY',
    '[ -z "${SETUP_TOKEN+x}" ] || forbidden=SETUP_TOKEN',
    '[ -z "$forbidden" ] || { printf "LEAK:%s\\n" "$forbidden" >> "$base/restic.log"; exit 91; }',
    '[ -n "${PATH:-}" ] || exit 92',
    'printf "%s|%s|%s\\n" "$*" "${AWS_ACCESS_KEY_ID:-}" "${AWS_SECRET_ACCESS_KEY:-}" >> "$base/restic.log"',
    'case "$*" in',
    '  *" forget "*)',
    '    if [ -f "$base/hang-tree" ]; then',
    '      "$base/grandchild-fixture.sh" &',
    '      wait',
    '    fi',
    '    [ ! -f "$base/hang-forget" ] || sleep 5',
    '    [ ! -f "$base/fail-forget" ] || exit 23',
    '    ;;',
    '  *" check"*) [ ! -f "$base/fail-check" ] || exit 24 ;;',
    'esac',
    'exit 0',
    ''
  ].join('\n'), { mode: 0o700 });
  return {
    root,
    receipts,
    password,
    credentials,
    log,
    fakeRestic,
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); }
  };
}

function argv(f) {
  return [
    '--repository', 's3:https://storage.example.invalid/buero',
    '--password-file', f.password,
    '--credential-env-file', f.credentials,
    '--status-dir', f.receipts,
    '--job-id', 'nacht-job',
    '--tag', 'buero',
    '--keep-daily', '14',
    '--keep-monthly', '12',
    '--keep-yearly', '10',
    '--restic-bin', f.fakeRestic
  ];
}

function inspect(f, overrides) {
  return status.inspectReceipt({
    statusDir: f.receipts,
    repository: 's3:https://storage.example.invalid/buero',
    jobId: 'nacht-job',
    tag: 'buero',
    policy: { daily: 14, monthly: 12, yearly: 10 },
    now: new Date(),
    ...(overrides || {})
  });
}

test('getrennte Wartung führt taggebunden forget/prune und check aus und schreibt sicheren Beleg', () => {
  const f = fixture();
  const forbiddenKeys = [
    'SESSION_SECRET', 'ENCRYPTION_KEY', 'DOCUMENT_RECOVERY_KEY', 'SETUP_TOKEN'
  ];
  const oldSecrets = Object.fromEntries(forbiddenKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of forbiddenKeys) process.env[key] = `darf-nicht-zu-restic-${key}`;
    assert.equal(maintenance.main(argv(f)), 0);

    const identity = status.expectedIdentity({
      repository: 's3:https://storage.example.invalid/buero',
      jobId: 'nacht-job',
      tag: 'buero',
      policy: { daily: 14, monthly: 12, yearly: 10 }
    });
    const log = fs.readFileSync(f.log, 'utf8');
    assert.match(
      log,
      new RegExp(
        `forget --tag ${identity.jobTag} --group-by tags `
          + '--keep-daily 14 --keep-monthly 12 --keep-yearly 10 --prune'
      )
    );
    assert.match(log, / check\|maintenance-delete-id\|maintenance-delete-secret/);
    assert.doesNotMatch(log, /LEAK:/);

    const result = inspect(f);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'ok');
    assert.equal(result.policyFingerprint, identity.policyFingerprint);

    const receipt = fs.readFileSync(
      path.join(f.receipts, status.receiptFileName('nacht-job')),
      'utf8'
    );
    assert.doesNotMatch(receipt, /storage\.example|nicht-im-beleg|delete-secret|credentials/);
    if (process.platform !== 'win32') {
      assert.equal(
        fs.statSync(path.join(f.receipts, status.receiptFileName('nacht-job'))).mode & 0o777,
        0o600
      );
    }
  } finally {
    for (const key of forbiddenKeys) {
      if (oldSecrets[key] === undefined) delete process.env[key];
      else process.env[key] = oldSecrets[key];
    }
    f.cleanup();
  }
});

test('SFTP-Wartung funktioniert ohne Provider-Credential-Datei und erbt keine Provider-Rechte', () => {
  const f = fixture();
  const oldAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const oldSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
  try {
    process.env.AWS_ACCESS_KEY_ID = 'darf-nicht-geerbt-werden';
    process.env.AWS_SECRET_ACCESS_KEY = 'ebenfalls-nicht';
    const args = argv(f);
    const credentialIndex = args.indexOf('--credential-env-file');
    args.splice(credentialIndex, 2);
    args[args.indexOf('--repository') + 1] = 'sftp:backup.example.invalid:/srv/restic';
    assert.equal(maintenance.main(args), 0);
    const log = fs.readFileSync(f.log, 'utf8');
    assert.doesNotMatch(log, /darf-nicht-geerbt|ebenfalls-nicht/);
    for (const line of log.trim().split('\n')) {
      assert.match(line, /\|\|$/);
    }
  } finally {
    if (oldAccessKey === undefined) delete process.env.AWS_ACCESS_KEY_ID;
    else process.env.AWS_ACCESS_KEY_ID = oldAccessKey;
    if (oldSecretKey === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = oldSecretKey;
    f.cleanup();
  }
});

test('Beleg ist bei geänderter Policy, Überfälligkeit oder unsicherem Modus nicht grün', () => {
  const f = fixture();
  try {
    assert.equal(maintenance.main(argv(f)), 0);
    assert.equal(inspect(f, {
      policy: { daily: 15, monthly: 12, yearly: 10 }
    }).status, 'mismatch');
    assert.equal(inspect(f, {
      now: new Date(Date.now() + 9 * 24 * 3600000),
      maxAgeHours: 8 * 24
    }).status, 'overdue');
    if (process.platform !== 'win32') {
      const receipt = path.join(f.receipts, status.receiptFileName('nacht-job'));
      fs.chmodSync(receipt, 0o644);
      assert.equal(inspect(f).status, 'invalid');
    }
  } finally {
    f.cleanup();
  }
});

test('fehlgeschlagene Wartung überschreibt einen alten Erfolg sichtbar mit Fehler', () => {
  const f = fixture();
  try {
    assert.equal(maintenance.main(argv(f)), 0);
    fs.writeFileSync(path.join(f.root, 'fail-forget'), '1\n');
    assert.equal(maintenance.main(argv(f)), 2);
    const result = inspect(f);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
    assert.equal(result.warningCode, 'offsite_maintenance_failed');
  } finally {
    f.cleanup();
  }
});

test('bestehender Wartungs-Lock wird weder gelöscht noch als Lauf übergangen', () => {
  const f = fixture();
  try {
    const lock = path.join(
      f.receipts,
      `${status.receiptFileName('nacht-job')}.lock`
    );
    fs.writeFileSync(lock, 'anderer lauf\n', { mode: 0o600 });
    assert.equal(maintenance.main(argv(f)), 70);
    assert.equal(fs.readFileSync(lock, 'utf8'), 'anderer lauf\n');
    assert.equal(fs.existsSync(
      path.join(f.receipts, status.receiptFileName('nacht-job'))
    ), false);
  } finally {
    f.cleanup();
  }
});

test('Wartungs-Writer lehnt ein für Gruppe oder andere offenes Statusverzeichnis ab', () => {
  const f = fixture();
  try {
    if (process.platform === 'win32') return;
    fs.chmodSync(f.receipts, 0o777);
    assert.throws(
      () => maintenance._test.statusDirectory(f.receipts),
      /exakt mit Modus 0700/
    );
    assert.equal(maintenance.main(argv(f)), 70);
    assert.equal(
      fs.existsSync(path.join(f.receipts, status.receiptFileName('nacht-job'))),
      false
    );
  } finally {
    f.cleanup();
  }
});

test('verwaister Wartungs-Lock wird sicher übernommen und der Lauf fortgesetzt', () => {
  const f = fixture();
  try {
    const lock = path.join(
      f.receipts,
      `${status.receiptFileName('nacht-job')}.lock`
    );
    fs.writeFileSync(lock, JSON.stringify({
      format: 'Betreuungsbuero-Offsite-Wartungslock/1',
      pid: process.pid,
      startedAt: '2000-01-01T00:00:00.000Z',
      token: 'ab'.repeat(16)
    }) + '\n', { mode: 0o600 });
    assert.equal(
      maintenance.main([...argv(f), '--timeout-seconds', '1']),
      0
    );
    assert.equal(fs.existsSync(lock), false);
    assert.equal(inspect(f).ok, true);
  } finally {
    f.cleanup();
  }
});

test('aktiver gültiger Wartungs-Lock bleibt fail-closed unverändert', () => {
  const f = fixture();
  try {
    const lock = path.join(
      f.receipts,
      `${status.receiptFileName('nacht-job')}.lock`
    );
    const content = JSON.stringify({
      format: 'Betreuungsbuero-Offsite-Wartungslock/1',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      token: 'cd'.repeat(16)
    }) + '\n';
    fs.writeFileSync(lock, content, { mode: 0o600 });
    assert.equal(maintenance.main(argv(f)), 70);
    assert.equal(fs.readFileSync(lock, 'utf8'), content);
  } finally {
    f.cleanup();
  }
});

test('hängendes Restic endet an der Zeitgrenze und hinterlässt einen Fehlerbeleg', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'hang-forget'), '1\n');
    const before = Date.now();
    assert.equal(
      maintenance.main([...argv(f), '--timeout-seconds', '1']),
      2
    );
    assert.ok(Date.now() - before < 4500);
    const receipt = JSON.parse(fs.readFileSync(
      path.join(f.receipts, status.receiptFileName('nacht-job')),
      'utf8'
    ));
    assert.equal(receipt.forgetPruneExitCode, 124);
    assert.equal(receipt.failedStep, 'forget_prune_timeout');
    assert.equal(inspect(f).status, 'failed');
  } finally {
    f.cleanup();
  }
});

test('Restic-Zeitgrenze beendet unter POSIX auch einen SIGTERM-ignorierenden Enkelprozess', async () => {
  const f = fixture();
  let grandchildPid = 0;
  try {
    if (process.platform === 'win32') return;
    fs.writeFileSync(path.join(f.root, 'hang-tree'), '1\n');
    const before = Date.now();
    /* Zeitgrenze 3s statt 1s (31.08.2026): Der Prüffall braucht als VORAUSSETZUNG einen
       laufenden Enkelprozess - dafür müssen erst zwei Shells starten und die PID-Datei
       schreiben. Bei 1 Sekunde räumte die Wartung unter Last genau richtig ab, bevor der
       Enkel überhaupt existierte; der Prüffall meldete dann "wurde tatsächlich gestartet"
       rot und beschuldigte damit eine Funktion, die einwandfrei gearbeitet hatte. Länger
       warten schwächt die Zusage nicht ab: gemessen wird weiterhin, dass die Zeitgrenze
       greift (Rückgabe 2) und den SIGTERM-ignorierenden Enkel mitnimmt. */
    assert.equal(
      maintenance.main([...argv(f), '--timeout-seconds', '3']),
      2
    );
    assert.ok(Date.now() - before < 9000);

    const pidFile = path.join(f.root, 'grandchild.pid');
    assert.equal(fs.existsSync(pidFile), true, 'der Enkelprozess wurde tatsächlich gestartet');
    grandchildPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    assert.ok(Number.isSafeInteger(grandchildPid) && grandchildPid > 1);

    const processExists = () => {
      try {
        process.kill(grandchildPid, 0);
        return true;
      } catch (error) {
        if (error && error.code === 'ESRCH') return false;
        throw error;
      }
    };
    const deadline = Date.now() + 2000;
    while (processExists() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(processExists(), false, 'der Enkelprozess darf nicht weiterlaufen');
    assert.equal(fs.existsSync(path.join(f.root, 'grandchild-survived')), false);

    const receipt = JSON.parse(fs.readFileSync(
      path.join(f.receipts, status.receiptFileName('nacht-job')),
      'utf8'
    ));
    assert.equal(receipt.forgetPruneExitCode, 124);
    assert.equal(receipt.failedStep, 'forget_prune_timeout');
  } finally {
    if (grandchildPid > 1) {
      try { process.kill(grandchildPid, 'SIGKILL'); } catch (_ignore) { /* bereits beendet */ }
    }
    f.cleanup();
  }
});

test('Absturz vor Lock-Veröffentlichung hinterlässt nie partielles finales JSON', () => {
  const f = fixture();
  try {
    if (process.platform === 'win32') return;
    const lock = path.join(f.receipts, 'atomic-before.lock');
    const moduleFile = require.resolve('../tools/offsite-maintenance');
    const childSource = [
      "'use strict';",
      'const maintenance = require(process.argv[1]);',
      'maintenance._test.acquireLock(',
      '  process.argv[2], new Date().toISOString(), 60000, {',
      '    afterCandidateFsync() { process.kill(process.pid, "SIGKILL"); }',
      '  }',
      ');'
    ].join('\n');
    const child = spawnSync(process.execPath, [
      '-e', childSource, moduleFile, lock
    ], { stdio: 'ignore' });
    assert.equal(child.status, null);
    assert.equal(child.signal, 'SIGKILL');
    assert.equal(fs.existsSync(lock), false);

    const candidates = fs.readdirSync(f.receipts)
      .filter((name) => name.startsWith(`.${path.basename(lock)}.`)
        && name.endsWith('.candidate'));
    assert.equal(candidates.length, 1);
    const candidate = path.join(f.receipts, candidates[0]);
    const value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    assert.equal(value.format, 'Betreuungsbuero-Offsite-Wartungslock/1');
    assert.match(value.token, /^[0-9a-f]{32}$/);

    const ownership = maintenance._test.acquireLock(
      lock,
      new Date().toISOString(),
      60000
    );
    assert.match(maintenance._test.readLock(lock).token, /^[0-9a-f]{32}$/);
    maintenance._test.releaseLock(lock, ownership);
    assert.equal(fs.existsSync(lock), false);
  } finally {
    f.cleanup();
  }
});

test('Absturz nach atomarer Lock-Veröffentlichung hinterlässt vollständigen übernehmbaren Lock', () => {
  const f = fixture();
  try {
    if (process.platform === 'win32') return;
    const lock = path.join(f.receipts, 'atomic-after.lock');
    const moduleFile = require.resolve('../tools/offsite-maintenance');
    const childSource = [
      "'use strict';",
      'const maintenance = require(process.argv[1]);',
      'maintenance._test.acquireLock(',
      '  process.argv[2], new Date().toISOString(), 60000, {',
      '    afterLinkFsync() { process.kill(process.pid, "SIGKILL"); }',
      '  }',
      ');'
    ].join('\n');
    const child = spawnSync(process.execPath, [
      '-e', childSource, moduleFile, lock
    ], { stdio: 'ignore' });
    assert.equal(child.status, null);
    assert.equal(child.signal, 'SIGKILL');

    const abandoned = maintenance._test.readLock(lock);
    assert.ok(Number.isSafeInteger(abandoned.pid) && abandoned.pid > 1);
    assert.match(abandoned.token, /^[0-9a-f]{32}$/);

    const ownership = maintenance._test.acquireLock(
      lock,
      new Date().toISOString(),
      60000
    );
    assert.notEqual(maintenance._test.readLock(lock).token, abandoned.token);
    maintenance._test.releaseLock(lock, ownership);
    assert.equal(fs.existsSync(lock), false);
  } finally {
    f.cleanup();
  }
});

test('Statusmonitor meldet fehlende externe Konfiguration eindeutig', () => {
  const result = status.inspectReceipt({
    statusDir: '',
    repository: 's3:https://storage.example.invalid/buero',
    jobId: 'nacht-job',
    tag: 'buero',
    policy: { daily: 14, monthly: 12, yearly: 10 }
  });
  assert.equal(result.configured, false);
  assert.equal(result.status, 'not_configured');
  assert.equal(result.warningCode, 'offsite_maintenance_not_configured');
  const component = status.preflightComponent({
    statusDir: '',
    repository: 's3:https://storage.example.invalid/buero',
    jobId: 'nacht-job',
    tag: 'buero',
    policy: { daily: 14, monthly: 12, yearly: 10 }
  });
  assert.equal(component.id, 'offsiteMaintenance');
  assert.equal(component.required, true);
  assert.equal(component.ok, false);
  assert.match(component.policyFingerprint, /^[0-9a-f]{64}$/);
});
