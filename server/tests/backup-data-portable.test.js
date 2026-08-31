'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const cryptoHelper = require('../src/security/crypto');
const backupData = require('../src/modules/backup/portable-data');
const secureJson = require('../src/security/secure-json');

function fakeDb(tables) {
  const contracts = [
    backupData.recoverySchemaContract('security'),
    backupData.recoverySchemaContract('credentials')
  ];
  const columns = Object.assign({}, ...contracts.map((entry) => entry.tables));
  return {
    prepare(sql) {
      const pragmaTable = /PRAGMA\s+table_info\s*\(\s*"?([a-z0-9_]+)"?\s*\)/i.exec(sql);
      if (pragmaTable) {
        const names = pragmaTable[1] === 'cases'
          ? ['id', 'owner_user_id']
          : (columns[pragmaTable[1]] || []);
        return { all: () => names.map((name, cid) => ({ cid, name })) };
      }
      const match = /FROM\s+([a-z0-9_]+)/i.exec(sql);
      const table = match && match[1];
      return {
        all() {
          const defaults = Object.fromEntries((columns[table] || []).map((column) => [column, '']));
          return (tables[table] || []).map((row) => ({ ...defaults, ...row }));
        }
      };
    }
  };
}

test('portables Schema 3 wickelt interne Secrets auf einen neuen ENCRYPTION_KEY um', (t) => {
  const previous = process.env.ENCRYPTION_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
  });
  process.env.ENCRYPTION_KEY = '11'.repeat(32);
  const rows = {
    office_ai_config: [{ provider: 'openai', api_key_encrypted: cryptoHelper.encrypt('ai-geheimnis') }],
    smtp_config: [{ id: 1, password_encrypted: cryptoHelper.encrypt('smtp-geheimnis') }],
    calendar_connections: [{
      id: 'cal-1',
      password_encrypted: '',
      client_secret_encrypted: cryptoHelper.encrypt('oauth-client-secret'),
      access_token_encrypted: cryptoHelper.encrypt('access-token'),
      refresh_token_encrypted: cryptoHelper.encrypt('refresh-token')
    }],
    doc_mounts: [{
      id: 'mount-1',
      config_json: JSON.stringify({
        url: 'https://example.invalid/dav',
        username: 'test',
        passEnc: cryptoHelper.encrypt('dav-passwort'),
        clientSecretEnc: '',
        refreshEnc: '',
        accessEnc: ''
      })
    }]
  };
  const portable = backupData.portableCredentialsData(fakeDb(rows), cryptoHelper);
  assert.equal(portable.version, 3);
  assert.equal(portable.portableSecrets, true);
  assert.equal(portable.officeAiConfig[0].api_key_encrypted, '');
  assert.equal(JSON.parse(portable.docMounts[0].config_json).passEnc, '');

  const recoveryKey = 'extern-verwahrter-recovery-key-fuer-portable-tests';
  const envelope = secureJson.encryptJson(portable, recoveryKey, 'credentials/3');
  const serializedEnvelope = JSON.stringify(envelope);
  for (const secret of ['ai-geheimnis', 'smtp-geheimnis', 'dav-passwort', 'refresh-token']) {
    assert.ok(!serializedEnvelope.includes(secret), `äußere Hülle darf ${secret} nicht offen enthalten`);
  }

  process.env.ENCRYPTION_KEY = '22'.repeat(32);
  const decoded = secureJson.decryptJson(envelope, recoveryKey, 'credentials/3').payload;
  const restored = backupData.rehydratePortableSecrets(decoded, cryptoHelper);
  assert.equal(cryptoHelper.decryptStrict(restored.officeAiConfig[0].api_key_encrypted), 'ai-geheimnis');
  assert.equal(cryptoHelper.decryptStrict(restored.smtpConfig[0].password_encrypted), 'smtp-geheimnis');
  assert.equal(
    cryptoHelper.decryptStrict(JSON.parse(restored.docMounts[0].config_json).passEnc),
    'dav-passwort'
  );
  assert.ok(!Object.hasOwn(restored.officeAiConfig[0], '__recovery_secrets'));
});

test('kaputtes internes Secret verhindert ein halbfertiges portables Abbild', (t) => {
  const previous = process.env.ENCRYPTION_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
  });
  process.env.ENCRYPTION_KEY = '33'.repeat(32);
  const db = fakeDb({
    office_ai_config: [{ provider: 'openai', api_key_encrypted: 'kein-gueltiger-ciphertext' }]
  });
  assert.throws(
    () => backupData.portableCredentialsData(db, cryptoHelper),
    /kann mit dem aktuellen ENCRYPTION_KEY nicht entschlüsselt/
  );
});

test('Büro-JSON entfernt Mount-Secrets und den historischen Maps-Ciphertext', () => {
  const db = fakeDb({
    office_profile: [{ id: 1, name: 'Büro', maps_api_key_encrypted: 'alt-cipher' }],
    doc_mounts: [{
      id: 'mount-1',
      config_json: JSON.stringify({ url: 'https://example.invalid', username: 'u', passEnc: 'cipher' })
    }]
  });
  const office = backupData.officeData(db);
  assert.equal(office.tables.office_profile[0].maps_api_key_encrypted, '');
  const config = JSON.parse(office.tables.doc_mounts[0].config_json);
  assert.equal(config.url, 'https://example.invalid');
  assert.ok(!Object.hasOwn(config, 'passEnc'));
});

test('Recovery-Bundle ist disjunkt und bindet beide Artefakte an dieselbe DB-Revision', (t) => {
  const previous = process.env.ENCRYPTION_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
  });
  process.env.ENCRYPTION_KEY = '77'.repeat(32);
  const db = fakeDb({
    users: [{ id: 1, username: 'admin', password_hash: 'hash' }],
    api_tokens: [{ id: 'token-1', token_hash: 'hash' }],
    office_ai_config: [{
      provider: 'openai',
      api_key_encrypted: cryptoHelper.encrypt('nur-im-credentials-artefakt')
    }]
  });
  const bundle = backupData.createPortableRecoveryBundle(db, cryptoHelper, {
    generationId: '08fb73c9-4571-4de3-a0bd-d339209bfc58',
    createdAt: '2026-07-28T09:00:00.000Z'
  });
  assert.equal(bundle.security.recoveryGeneration.generationId, bundle.generationId);
  assert.equal(bundle.credentials.recoveryGeneration.generationId, bundle.generationId);
  assert.equal(bundle.security.recoveryGeneration.sourceRevision, bundle.sourceRevision);
  assert.equal(bundle.credentials.recoveryGeneration.sourceRevision, bundle.sourceRevision);
  assert.equal(bundle.security.recoveryGeneration.artifactScope, 'security');
  assert.equal(bundle.credentials.recoveryGeneration.artifactScope, 'credentials');
  assert.ok(Array.isArray(bundle.security.users));
  assert.ok(Array.isArray(bundle.security.apiTokens));
  assert.ok(!Object.hasOwn(bundle.security, 'officeAiConfig'));
  assert.ok(Array.isArray(bundle.credentials.officeAiConfig));
  assert.ok(!Object.hasOwn(bundle.credentials, 'users'));
  assert.match(bundle.sourceRevision, /^[0-9a-f]{64}$/);
});

test('Generator und Recovery-Prüfung teilen dieselbe Registrierung verschlüsselter Felder', () => {
  const locations = new Set(
    backupData.portableSecretLocations().map(({ table, column }) => `${table}.${column}`)
  );
  for (const expected of [
    'smtp_config.password_encrypted',
    'calendar_connections.refresh_token_encrypted',
    'office_ai_config.api_key_encrypted',
    'user_settings_overrides.value_encrypted',
    'map_settings.google_maps_api_key_encrypted',
    'mail_accounts.imap_pass_encrypted',
    'bank_connections.pin_encrypted',
    'bank_gateway_config.password_encrypted'
  ]) {
    assert.ok(locations.has(expected), `${expected} fehlt in der gemeinsamen Registrierung`);
  }
  assert.deepEqual(
    backupData.portableMountSecretFields(),
    ['passEnc', 'clientSecretEnc', 'refreshEnc', 'accessEnc']
  );
});

function recoverySchemaDb(options) {
  const opt = options || {};
  const db = new Database(':memory:');
  const contracts = [
    backupData.recoverySchemaContract('security'),
    backupData.recoverySchemaContract('credentials')
  ];
  const tables = Object.assign({}, ...contracts.map((entry) => entry.tables));
  for (const [table, expected] of Object.entries(tables)) {
    if (table === opt.omitTable) continue;
    const columns = expected.filter((column) =>
      !(table === opt.omitColumnTable && column === opt.omitColumn)
    );
    db.exec(`CREATE TABLE "${table}" (${columns.map((column) => `"${column}" TEXT`).join(',')})`);
  }
  db.exec('CREATE TABLE cases (id TEXT PRIMARY KEY, owner_user_id TEXT)');
  return db;
}

test('portable Generatoren und Validatoren arbeiten bei fehlenden Pflichttabellen/-spalten fail-closed', () => {
  let db = recoverySchemaDb({ omitTable: 'users' });
  assert.throws(
    () => backupData.portableSecurityData(db, cryptoHelper),
    (error) => error.code === 'BACKUP_REQUIRED_TABLE_MISSING' && error.table === 'users'
  );
  db.close();

  db = recoverySchemaDb({ omitColumnTable: 'office_ai_config', omitColumn: 'updated_at' });
  assert.throws(
    () => backupData.portableCredentialsData(db, cryptoHelper),
    (error) => error.code === 'BACKUP_REQUIRED_COLUMNS_MISMATCH'
      && error.table === 'office_ai_config'
      && error.missingColumns.includes('updated_at')
  );
  db.close();

  db = recoverySchemaDb();
  db.prepare(`
    INSERT INTO office_ai_config(provider,api_key_encrypted,model,endpoint,updated_at)
    VALUES ('openai','','','','2026-07-28T12:00:00.000Z')
  `).run();
  const bundle = backupData.createPortableRecoveryBundle(db, cryptoHelper);
  const omitted = JSON.parse(JSON.stringify(bundle.security));
  omitted.omittedTables = ['users'];
  assert.throws(
    () => backupData.validatePortableRecoveryPayload(omitted, 'security'),
    /verpflichtende Tabellen oder Spalten.*users/
  );
  const incompleteColumns = JSON.parse(JSON.stringify(bundle.credentials));
  incompleteColumns.recoverySchema.tables.office_ai_config =
    incompleteColumns.recoverySchema.tables.office_ai_config.filter((column) => column !== 'updated_at');
  assert.throws(
    () => backupData.validatePortableRecoveryPayload(incompleteColumns, 'credentials'),
    /Spaltenvertrag für office_ai_config/
  );
  const incompleteRow = JSON.parse(JSON.stringify(bundle.credentials));
  delete incompleteRow.officeAiConfig[0].updated_at;
  assert.throws(
    () => backupData.validatePortableRecoveryPayload(incompleteRow, 'credentials'),
    /Pflichttabelle office_ai_config.*vollständigen Spaltenvertrag/
  );
  db.close();
});

test('portabler Security-Restore enthält und ersetzt das Audit-Protokoll nicht', () => {
  const db = recoverySchemaDb();
  const bundle = backupData.createPortableRecoveryBundle(db, cryptoHelper);
  assert.equal(Object.hasOwn(bundle.security, 'auditLog'), false);
  assert.equal(
    backupData.restoreDefinitions('security').some((entry) => entry.table === 'audit_log'),
    false
  );
  db.close();
});
