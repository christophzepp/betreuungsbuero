'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const backupData = require('../src/modules/backup/portable-data');
const cryptoHelper = require('../src/security/crypto');

const helper = path.join(__dirname, '..', 'tools', 'verify-portable-recovery-revision.js');
const encryptionKey = 'a7'.repeat(32);

function createRecoveryDatabase(file, options) {
  const opt = options || {};
  const db = new Database(file);
  const contracts = [
    backupData.recoverySchemaContract('security'),
    backupData.recoverySchemaContract('credentials')
  ];
  const tables = Object.assign({}, ...contracts.map((entry) => entry.tables));
  for (const [table, expectedColumns] of Object.entries(tables)) {
    if (table === opt.omitTable) continue;
    db.exec(
      `CREATE TABLE "${table}" (`
      + expectedColumns.map((column) => `"${column}" TEXT`).join(',')
      + ')'
    );
  }
  db.exec('CREATE TABLE cases (id TEXT PRIMARY KEY, owner_user_id TEXT)');
  if (!opt.omitTable) {
    const previous = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = encryptionKey;
    try {
      db.prepare(`
        INSERT INTO office_ai_config(provider,api_key_encrypted,model,endpoint,updated_at)
        VALUES (?,?,?,?,?)
      `).run(
        'openai',
        cryptoHelper.encrypt('nicht-in-ausgaben-zeigen'),
        'test',
        '',
        '2026-07-28T12:00:00.000Z'
      );
    } finally {
      if (previous === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = previous;
    }
  }
  return db;
}

function invoke(database, revision, key, extraArgs) {
  const env = { ...process.env };
  if (key === undefined) delete env.ENCRYPTION_KEY;
  else env.ENCRYPTION_KEY = key;
  return spawnSync(
    process.execPath,
    [helper, database, revision, ...(extraArgs || [])],
    { encoding: 'utf8', env }
  );
}

test('CLI prüft die echte portable Recovery-Revision einer SQLite-Kopie fail-closed', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-revision-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'database.sqlite3');
  const db = createRecoveryDatabase(file);

  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = encryptionKey;
  let expected;
  try {
    expected = backupData.portableRecoverySourceRevision(db, cryptoHelper);
  } finally {
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
    db.close();
  }

  const success = invoke(file, expected, encryptionKey);
  assert.equal(success.status, 0);
  assert.equal(success.stdout, `OK|PORTABLE_RECOVERY_SOURCE_REVISION|${expected}\n`);
  assert.equal(success.stderr, '');

  const mismatch = invoke(file, '00'.repeat(32), encryptionKey);
  assert.equal(mismatch.status, 65);
  assert.equal(mismatch.stdout, '');
  assert.equal(mismatch.stderr, 'ERROR|RECOVERY_REVISION_MISMATCH\n');

  const wrongKey = 'b8'.repeat(32);
  const decryptionFailure = invoke(file, expected, wrongKey);
  assert.equal(decryptionFailure.status, 65);
  assert.equal(decryptionFailure.stdout, '');
  assert.equal(decryptionFailure.stderr, 'ERROR|RECOVERY_SECRET_DECRYPT_FAILED\n');
  assert.ok(!decryptionFailure.stderr.includes(wrongKey));
  assert.ok(!decryptionFailure.stderr.includes('nicht-in-ausgaben-zeigen'));

  const missingKey = invoke(file, expected, undefined);
  assert.equal(missingKey.status, 78);
  assert.equal(missingKey.stdout, '');
  assert.equal(missingKey.stderr, 'ERROR|ENCRYPTION_KEY_INVALID\n');

  const invalidArguments = invoke(file, expected, encryptionKey, ['unerwartet']);
  assert.equal(invalidArguments.status, 64);
  assert.equal(invalidArguments.stdout, '');
  assert.equal(invalidArguments.stderr, 'ERROR|INVALID_ARGUMENTS\n');
});

test('CLI verwirft unvollständiges Recovery-Schema und SQLite-Sidecars', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-revision-schema-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const incompleteFile = path.join(temp, 'incomplete.sqlite3');
  const incomplete = createRecoveryDatabase(incompleteFile, { omitTable: 'users' });
  incomplete.close();
  const schemaFailure = invoke(incompleteFile, '11'.repeat(32), encryptionKey);
  assert.equal(schemaFailure.status, 65);
  assert.equal(schemaFailure.stdout, '');
  assert.equal(schemaFailure.stderr, 'ERROR|RECOVERY_SCHEMA_INVALID\n');

  const sidecarFile = path.join(temp, 'sidecar.sqlite3');
  const complete = createRecoveryDatabase(sidecarFile);
  complete.close();
  fs.writeFileSync(sidecarFile + '-wal', '');
  const sidecarFailure = invoke(sidecarFile, '22'.repeat(32), encryptionKey);
  assert.equal(sidecarFailure.status, 65);
  assert.equal(sidecarFailure.stdout, '');
  assert.equal(sidecarFailure.stderr, 'ERROR|DATABASE_SIDECAR_PRESENT\n');
});
