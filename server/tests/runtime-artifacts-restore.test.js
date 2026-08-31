'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', 'tools', 'restore-runtime-artifacts.js');
const guard = require('../src/modules/recovery/runtime-artifact-guard');

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function rebuildManifest(snapshot) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(snapshot, absolute).split(path.sep).join('/');
      if (relative === 'MANIFEST.tsv' || relative === 'MANIFEST.tsv.sha256') continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(relative);
    }
  }
  walk(snapshot);
  files.sort();
  const manifest = files.map((relative) => {
    const file = path.join(snapshot, ...relative.split('/'));
    return [
      sha(file),
      fs.statSync(file).size,
      Buffer.from(relative, 'utf8').toString('base64')
    ].join('\t');
  }).join('\n') + '\n';
  write(path.join(snapshot, 'MANIFEST.tsv'), manifest);
  write(path.join(snapshot, 'MANIFEST.tsv.sha256'), sha(path.join(snapshot, 'MANIFEST.tsv')) + '\n');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-artifacts-restore-'));
  const snapshot = path.join(root, 'snapshot');
  const extensionDir = path.join(root, 'extension-volume');
  const outputsDir = path.join(root, 'outputs-bind');
  const stateDir = path.join(root, 'restore-state');
  for (const directory of [snapshot, extensionDir, outputsDir, stateDir]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  write(path.join(snapshot, 'STATUS.txt'), 'VOLLSTAENDIG\n');
  write(
    path.join(snapshot, 'verwaltung', 'SNAPSHOT-FORMAT.txt'),
    'Betreuungsbuero-Gesamtsicherung/1\n'
  );
  write(
    path.join(snapshot, 'betrieb', 'browser-erweiterungen', 'manifest.json'),
    '{"firefox":{"storedName":"firefox__test.xpi"}}\n'
  );
  write(
    path.join(snapshot, 'betrieb', 'browser-erweiterungen', 'firefox__test.xpi'),
    'NEUE-ERWEITERUNG\n'
  );
  write(
    path.join(
      snapshot,
      'betrieb',
      'anwendung',
      'Betreuungsbuero_Dokumentenassistent_v999_99.html'
    ),
    '<!doctype html><title>neu</title>\n'
  );
  write(path.join(snapshot, 'inhalt', 'server-data', 'beleg.txt'), 'anderer Manifestinhalt\n');
  rebuildManifest(snapshot);
  write(path.join(extensionDir, 'unbekannt-alt.bin'), 'ALTER-ERWEITERUNGSSTAND\n');
  write(path.join(outputsDir, 'alt.html'), '<title>alt</title>\n');
  return { root, snapshot, extensionDir, outputsDir, stateDir };
}

function run(value, extra, env) {
  return spawnSync(process.execPath, [
    SCRIPT,
    '--snapshot', value.snapshot,
    '--extension-dir', value.extensionDir,
    '--outputs-dir', value.outputsDir,
    '--state-dir', value.stateDir,
    ...(extra || [])
  ], {
    encoding: 'utf8',
    env: { ...process.env, ...(env || {}) }
  });
}

function targetState(value) {
  function collect(root) {
    const result = {};
    function walk(directory, prefix) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute, relative);
        else result[relative] = fs.readFileSync(absolute).toString('base64');
      }
    }
    walk(root, '');
    return result;
  }
  return {
    extensions: collect(value.extensionDir),
    outputs: collect(value.outputsDir)
  };
}

test('Dry-run ist schreibfrei; Apply prüft alles und bewahrt unbekannten Altbestand', (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const before = targetState(value);

  const dry = run(value);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /DRY_RUN=1 MANIFEST=OK ERWEITERUNGEN=2 APP=1/);
  assert.deepEqual(targetState(value), before);
  assert.deepEqual(fs.readdirSync(value.stateDir), []);

  const applied = run(value, ['--apply', '--confirm-app-stopped']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /RESTORE=OK/);
  assert.equal(
    fs.readFileSync(path.join(value.extensionDir, 'firefox__test.xpi'), 'utf8'),
    'NEUE-ERWEITERUNG\n'
  );
  assert.equal(
    fs.readFileSync(
      path.join(value.outputsDir, 'Betreuungsbuero_Dokumentenassistent_v999_99.html'),
      'utf8'
    ),
    '<!doctype html><title>neu</title>\n'
  );
  assert.equal(fs.existsSync(path.join(value.stateDir, 'ACTIVE.json')), false);
  guard.assertNoIncompleteRuntimeRestore(value.stateDir);

  const transactions = fs.readdirSync(value.stateDir)
    .filter((name) => name.startsWith('runtime-artifacts-'));
  assert.equal(transactions.length, 1);
  const transaction = path.join(value.stateDir, transactions[0]);
  assert.equal(
    fs.readFileSync(path.join(transaction, 'old-extensions', 'unbekannt-alt.bin'), 'utf8'),
    'ALTER-ERWEITERUNGSSTAND\n'
  );
  assert.equal(
    fs.readFileSync(path.join(transaction, 'old-outputs', 'alt.html'), 'utf8'),
    '<title>alt</title>\n'
  );
});

test('Hashfehler, Traversal, Symlink und Spezialdatei schreiben kein Zielbyte', (t) => {
  const cases = [
    {
      name: 'manipulierter Hash',
      mutate(value) {
        fs.appendFileSync(
          path.join(value.snapshot, 'betrieb', 'browser-erweiterungen', 'firefox__test.xpi'),
          'MANIPULIERT\n'
        );
      }
    },
    {
      name: 'Traversal im Manifest',
      mutate(value) {
        const manifestFile = path.join(value.snapshot, 'MANIFEST.tsv');
        fs.appendFileSync(
          manifestFile,
          `${'0'.repeat(64)}\t0\t${Buffer.from('../ausbruch').toString('base64')}\n`
        );
        write(path.join(value.snapshot, 'MANIFEST.tsv.sha256'), sha(manifestFile) + '\n');
      }
    },
    {
      name: 'Symlink',
      mutate(value) {
        fs.symlinkSync(
          path.join(value.snapshot, 'STATUS.txt'),
          path.join(value.snapshot, 'betrieb', 'browser-erweiterungen', 'fremd-link')
        );
      }
    },
    {
      name: 'Spezialdatei',
      mutate(value) {
        const fifo = path.join(value.snapshot, 'betrieb', 'browser-erweiterungen', 'fremd-fifo');
        const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
        if (made.status !== 0) t.skip('mkfifo ist auf diesem Prüfstand nicht verfügbar.');
      }
    }
  ];

  for (const scenario of cases) {
    const value = fixture();
    t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
    const before = targetState(value);
    scenario.mutate(value);
    const result = run(value, ['--apply', '--confirm-app-stopped']);
    assert.notEqual(result.status, 0, scenario.name);
    assert.deepEqual(targetState(value), before, scenario.name);
    assert.deepEqual(fs.readdirSync(value.stateDir), [], scenario.name);
  }
});

test('Crashmarker sperrt den Start; --resume rollt zurück und veröffentlicht idempotent neu', (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));

  const interrupted = run(
    value,
    ['--apply', '--confirm-app-stopped'],
    {
      NODE_ENV: 'test',
      RUNTIME_ARTIFACT_RESTORE_TEST_FAIL_AT: 'after_extensions_clear'
    }
  );
  assert.notEqual(interrupted.status, 0);
  assert.match(interrupted.stderr, /INJIZIERTER_TESTABBRUCH/);
  assert.equal(fs.existsSync(path.join(value.stateDir, 'ACTIVE.json')), true);
  assert.throws(
    () => guard.assertNoIncompleteRuntimeRestore(value.stateDir),
    /Runtime-Artefakt-Restore ist unvollständig/
  );

  const resumed = run(
    value,
    ['--apply', '--confirm-app-stopped', '--resume']
  );
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /ROLLBACK=OK/);
  assert.match(resumed.stdout, /RESTORE=OK/);
  assert.equal(fs.existsSync(path.join(value.stateDir, 'ACTIVE.json')), false);
  assert.equal(
    fs.readFileSync(path.join(value.extensionDir, 'firefox__test.xpi'), 'utf8'),
    'NEUE-ERWEITERUNG\n'
  );

  const repeated = run(value, ['--apply', '--confirm-app-stopped']);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(
    fs.readFileSync(
      path.join(value.outputsDir, 'Betreuungsbuero_Dokumentenassistent_v999_99.html'),
      'utf8'
    ),
    '<!doctype html><title>neu</title>\n'
  );
});

test('--rollback stellt nach einem Crash den vollständigen unbekannten Altbestand wieder her', (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const before = targetState(value);
  const interrupted = run(
    value,
    ['--apply', '--confirm-app-stopped'],
    {
      NODE_ENV: 'test',
      RUNTIME_ARTIFACT_RESTORE_TEST_FAIL_AT: 'after_outputs_clear'
    }
  );
  assert.notEqual(interrupted.status, 0);

  const rolledBack = run(
    value,
    ['--apply', '--confirm-app-stopped', '--rollback']
  );
  assert.equal(rolledBack.status, 0, rolledBack.stderr);
  assert.match(rolledBack.stdout, /ROLLBACK=OK/);
  assert.deepEqual(targetState(value), before);
  assert.equal(fs.existsSync(path.join(value.stateDir, 'ACTIVE.json')), false);
});

test('Manipulierter ACTIVE-Marker kann keinen Pfad außerhalb der Ziele löschen', (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const id = 'ab'.repeat(12);
  const transactionDir = path.join(value.stateDir, `runtime-artifacts-${id}`);
  fs.mkdirSync(transactionDir);
  const sentinel = path.join(value.root, 'darf-nicht-geloescht-werden');
  write(path.join(sentinel, 'beleg.txt'), 'UNVERAENDERT\n');
  write(path.join(value.stateDir, 'ACTIVE.json'), JSON.stringify({
    format: 'Betreuungsbuero-Runtime-Artefakt-Restore/1',
    id,
    phase: 'PREPARING',
    snapshot: fs.realpathSync(value.snapshot),
    manifestSha256: fs.readFileSync(
      path.join(value.snapshot, 'MANIFEST.tsv.sha256'),
      'utf8'
    ).trim(),
    extensionDir: fs.realpathSync(value.extensionDir),
    outputsDir: fs.realpathSync(value.outputsDir),
    stateDir: fs.realpathSync(value.stateDir),
    transactionDir,
    extensionStageName: '../../darf-nicht-geloescht-werden',
    outputsStageName: `.bb-runtime-stage-${id}`
  }) + '\n');

  const result = run(
    value,
    ['--apply', '--confirm-app-stopped', '--rollback']
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unzulässige interne Restore-Pfade/);
  assert.equal(
    fs.readFileSync(path.join(sentinel, 'beleg.txt'), 'utf8'),
    'UNVERAENDERT\n'
  );
});
