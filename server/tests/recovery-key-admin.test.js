'use strict';

/*
 * Isolierter HTTP-Vertragstest: eigene DB, eigenes Daten-/Secret-Verzeichnis und
 * listen(0). Produktivdaten und Produktivports werden nicht geöffnet.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

function fakeDb(tables) {
  const backupData = require('../src/modules/backup/portable-data');
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
        all: () => {
          const defaults = Object.fromEntries((columns[table] || []).map((column) => [column, '']));
          return (tables[table] || []).map((row) => ({ ...defaults, ...row }));
        }
      };
    }
  };
}

test('Admin kann Recovery-Key sicher erzeugen, prüfen, rotieren und portable Secrets restaurieren', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-key-admin-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  process.env.DB_PATH = path.join(temp, 'fixture.sqlite3');
  process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
  process.env.DOCUMENT_RECOVERY_KEY_FILE = path.join(temp, 'runtime', 'document-recovery-key');
  process.env.DOCUMENT_RECOVERY_KEY = '';
  process.env.ENCRYPTION_KEY = '44'.repeat(32);
  fs.mkdirSync(process.env.DOCUMENTS_DATA_ROOT);

  const db = require('../src/database/index');
  t.after(() => db.close());
  const auth = require('../src/middleware/authentication');
  const adminPassword = 'richtiges-admin-kennwort';
  const passwordHash = await auth.hashPassword(adminPassword);
  db.prepare(`
    INSERT INTO users (id,username,password_hash,display_name,is_admin,allow_online)
    VALUES (1,'key-admin',?,'Key Admin',1,1)
  `).run(passwordHash);

  const materializations = require('../src/modules/documents/materializations');
  const previousCurrent = materializations.current;
  let forcedRuns = 0;
  let failNextRecoveryPair = false;
  materializations.current = () => ({
    runOffice(options) {
      if (options && options.forceSecurity) forcedRuns++;
      if (failNextRecoveryPair) {
        failNextRecoveryPair = false;
        return [
          { artifactKind: 'security-encrypted', changed: true },
          { artifactKind: 'credentials-encrypted', changed: false, error: 'simulierter Publikationsfehler' }
        ];
      }
      return [
        { artifactKind: 'security-encrypted', changed: true },
        { artifactKind: 'credentials-encrypted', changed: true }
      ];
    }
  });
  t.after(() => { materializations.current = previousCurrent; });

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    req.session = {
      userId: 1,
      username: 'key-admin',
      displayName: 'Key Admin',
      isAdmin: req.headers['x-test-admin'] === '1'
    };
    req.sessionID = 'isolierte-key-session';
    next();
  });
  app.use('/api/admin', require('../src/modules/admin/routes'));
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  const request = async (route, body, admin = true, method) => {
    const response = await fetch(base + route, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-test-admin': admin ? '1' : '0'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { response, body: await response.json() };
  };

  let result = await request('/recovery-key/status', undefined, false);
  assert.equal(result.response.status, 200, 'Live-DB-Rechte haben Vorrang vor einem veralteten Session-Flag');

  db.prepare('UPDATE users SET allow_online=0 WHERE id=1').run();
  result = await request('/recovery-key/status');
  assert.equal(result.response.status, 403, 'Entzogener Onlinezugriff muss eine alte Admin-Sitzung sofort sperren');
  db.prepare('UPDATE users SET allow_online=1,active=0 WHERE id=1').run();
  result = await request('/recovery-key/status');
  assert.equal(result.response.status, 403, 'Deaktivierung muss eine alte Admin-Sitzung sofort sperren');
  db.prepare('UPDATE users SET active=1 WHERE id=1').run();

  result = await request('/recovery-key/status');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.configured, false);
  assert.ok(!Object.hasOwn(result.body, 'key'));

  for (const mutation of [
    { isAdmin: false },
    { active: false },
    { allowOnline: false }
  ]) {
    const blocked = await request('/users/1', mutation, true, 'PUT');
    assert.equal(blocked.response.status, 409);
    assert.equal(blocked.body.code, 'RESTORE_LAST_ACTIVE_ONLINE_ADMIN_REQUIRED');
    const unchanged = db.prepare('SELECT active,is_admin,allow_online FROM users WHERE id=1').get();
    assert.deepEqual(unchanged, { active: 1, is_admin: 1, allow_online: 1 });
  }

  result = await request('/recovery-key/rotate', {
    mode: 'generate',
    adminPassword: 'falsch',
    confirm: true,
    externalCopyAcknowledged: true
  });
  assert.equal(result.response.status, 403);

  result = await request('/recovery-key/rotate', {
    mode: 'generate',
    adminPassword,
    confirm: true,
    externalCopyAcknowledged: true
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(result.body.saved, true);
  assert.equal(result.body.snapshotsUpdated, true);
  assert.ok(result.body.recoveryKey.length >= 24);
  const generatedKey = result.body.recoveryKey;
  assert.equal(forcedRuns, 1);
  assert.equal(fs.statSync(process.env.DOCUMENT_RECOVERY_KEY_FILE).mode & 0o777, 0o600);

  result = await request('/recovery-key/status');
  assert.equal(result.body.configured, true);
  assert.equal(result.body.source, 'admin-panel');
  assert.match(result.body.keyId, /^drk_/);
  assert.ok(!JSON.stringify(result.body).includes(generatedKey));
  assert.ok(!Object.hasOwn(result.body, 'keyFingerprint'));

  result = await request('/recovery-key/verify', {
    recoveryKey: generatedKey,
    adminPassword
  });
  assert.equal(result.body.matches, true);
  assert.ok(!Object.hasOwn(result.body, 'keyFingerprint'));
  result = await request('/recovery-key/verify', {
    recoveryKey: 'anderer-ausreichend-langer-wiederherstellungsschluessel',
    adminPassword
  });
  assert.equal(result.body.matches, false);

  const importedKey = `drk1_${crypto.randomBytes(32).toString('base64url')}`;
  result = await request('/recovery-key/rotate', {
    mode: 'import',
    recoveryKey: importedKey,
    adminPassword,
    confirm: true,
    externalCopyAcknowledged: true
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.rotated, true);
  assert.ok(!Object.hasOwn(result.body, 'recoveryKey'));
  assert.equal(forcedRuns, 2);
  let activeKeyId = result.body.status.keyId;

  failNextRecoveryPair = true;
  result = await request('/recovery-key/rotate', {
    mode: 'generate',
    adminPassword,
    confirm: true,
    externalCopyAcknowledged: true
  });
  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, 'RECOVERY_KEY_SNAPSHOT_PAIR_FAILED');
  assert.equal(result.body.rollback.reverted, true);
  assert.ok(!Object.hasOwn(result.body, 'recoveryKey'));
  result = await request('/recovery-key/verify', {
    recoveryKey: importedKey,
    adminPassword
  });
  assert.equal(result.body.matches, true, 'nach Fehlschlag bleibt der vorherige externe Schlüssel aktiv');
  activeKeyId = require('../src/modules/recovery/key-store').shared().publicStatus().keyId;

  const auditText = JSON.stringify(db.prepare(
    "SELECT action,details_json FROM audit_log WHERE action LIKE 'recovery-key.%' ORDER BY id"
  ).all());
  assert.ok(!auditText.includes(generatedKey));
  assert.ok(!auditText.includes(importedKey));

  // Portables Schema 3: Quelle mit altem internen Schlüssel erzeugen, anschließend
  // auf einem sinngemäß frischen Server mit neuem ENCRYPTION_KEY wiederherstellen.
  const cryptoHelper = require('../src/security/crypto');
  const backupData = require('../src/modules/backup/portable-data');
  const secureJson = require('../src/security/secure-json');

  // Der Admin-Status meldet ein Abbild erst nach Datei-Hash, Entschlüsselung,
  // Generation und vollständigem Tabellenvertrag als verifiziert.
  const statusGenerationId = crypto.randomUUID();
  const statusSourceRevision = 'ab'.repeat(32);
  const statusRows = {};
  for (const scope of ['security', 'credentials']) {
    const generation = {
      generationId: statusGenerationId,
      sourceRevision: statusSourceRevision,
      artifactScope: scope
    };
    const payload = {
      type: scope === 'security' ? 'betreuungsbuero-sicherheit' : 'betreuungsbuero-zugangsdaten',
      version: 3,
      portableSecrets: true,
      omittedTables: [],
      recoverySchema: backupData.recoverySchemaContract(scope),
      recoveryGeneration: generation
    };
    for (const definition of backupData.restoreDefinitions(
      scope,
      scope === 'security' ? { tokenDisposition: 'restore' } : undefined
    )) payload[definition.key] = [];
    if (scope === 'security') payload.caseOwners = [];
    const kind = scope === 'security' ? 'security-encrypted' : 'credentials-encrypted';
    const bytes = Buffer.from(JSON.stringify(secureJson.encryptJson(payload, importedKey, `${scope}/3`, {
      keyId: activeKeyId,
      generationId: statusGenerationId,
      sourceRevision: statusSourceRevision
    })));
    const file = path.join(temp, `${kind}.json`);
    fs.writeFileSync(file, bytes);
    const sha = secureJson.sha256(bytes);
    statusRows[kind] = {
      id: `${kind}-file`,
      area: 'management',
      visibility: 'admin',
      managed: 1,
      artifact_kind: kind,
      deleted_at: null,
      sha256: sha,
      materialization_sha256: sha,
      materialization_source_revision: statusSourceRevision,
      materialization_status: 'ok',
      last_error: '',
      test_path: file
    };
  }
  const statusTest = require('../src/modules/admin/routes')._test.encryptedSnapshotState(null, {
    db: { prepare: () => ({ get: (kind) => statusRows[kind] }) },
    documents: { documentStorage: { findBlobPath: (row) => row.test_path } },
    recoveryKeyStore: require('../src/modules/recovery/key-store').shared(),
    currentSourceRevision: statusSourceRevision
  });
  assert.equal(statusTest['security-encrypted'].verified, true);
  assert.equal(statusTest['credentials-encrypted'].verified, true);
  const staleStatus = require('../src/modules/admin/routes')._test.encryptedSnapshotState(null, {
    db: { prepare: () => ({ get: (kind) => statusRows[kind] }) },
    documents: { documentStorage: { findBlobPath: (row) => row.test_path } },
    recoveryKeyStore: require('../src/modules/recovery/key-store').shared(),
    currentSourceRevision: 'ef'.repeat(32)
  });
  assert.equal(staleStatus['security-encrypted'].verified, false);
  assert.match(staleStatus['security-encrypted'].error, /veraltet/);
  fs.appendFileSync(statusRows['security-encrypted'].test_path, 'manipuliert');
  const tamperedStatus = require('../src/modules/admin/routes')._test.encryptedSnapshotState(null, {
    db: { prepare: () => ({ get: (kind) => statusRows[kind] }) },
    documents: { documentStorage: { findBlobPath: (row) => row.test_path } },
    recoveryKeyStore: require('../src/modules/recovery/key-store').shared(),
    currentSourceRevision: statusSourceRevision
  });
  assert.equal(tamperedStatus['security-encrypted'].verified, false);
  assert.match(tamperedStatus['security-encrypted'].error, /Prüfsumme/);

  process.env.ENCRYPTION_KEY = '55'.repeat(32);
  const sourceRows = {
    users: [{
      id: 1,
      username: 'key-admin',
      password_hash: passwordHash,
      display_name: 'Key Admin',
      is_admin: 1,
      allow_online: 1,
      active: 1
    }],
    office_ai_config: [{
      provider: 'openai',
      api_key_encrypted: cryptoHelper.encrypt('portabler-api-key'),
      model: 'test-model',
      endpoint: ''
    }],
    doc_mounts: [{
      id: 'dav-1',
      label: 'DAV',
      kind: 'webdav',
      config_json: JSON.stringify({
        url: 'https://example.invalid/dav',
        username: 'test',
        passEnc: cryptoHelper.encrypt('portables-dav-passwort')
      }),
      enabled: 1,
      created_by: 1
    }]
  };
  const bundle = backupData.createPortableRecoveryBundle(fakeDb(sourceRows), cryptoHelper);
  const portable = bundle.credentials;
  const restoreKey = 'portabler-aeusserer-wiederherstellungsschluessel';
  const envelope = secureJson.encryptJson(portable, restoreKey, 'credentials/3', {
    keyId: 'drk_test-generation',
    generationId: bundle.generationId,
    sourceRevision: bundle.sourceRevision
  });
  const securityEnvelope = secureJson.encryptJson(bundle.security, restoreKey, 'security/3', {
    keyId: 'drk_test-generation',
    generationId: bundle.generationId,
    sourceRevision: bundle.sourceRevision
  });
  process.env.ENCRYPTION_KEY = '66'.repeat(32);

  result = await request('/restore-encrypted/preview', {
    envelope: securityEnvelope,
    recoveryKey: restoreKey
  });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /ausdrückliche Entscheidung/);
  result = await request('/restore-encrypted/preview', {
    envelope: securityEnvelope,
    recoveryKey: restoreKey,
    tokenDisposition: 'discard'
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.tokenDisposition, 'discard');

  result = await request('/restore-encrypted/preview', { envelope, recoveryKey: restoreKey });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.portable, true);
  assert.equal(result.body.requiresOriginalEncryptionKey, false);
  const previewToken = result.body.previewToken;
  result = await request('/restore-encrypted', {
    envelope,
    recoveryKey: restoreKey,
    previewToken,
    confirm: true
  });
  assert.equal(result.response.status, 200);
  assert.equal(typeof result.body.summary.expected, 'number');
  assert.equal(result.body.summary.rejected, 0);
  assert.equal(result.body.restoreReport.rolledBack, false);
  assert.equal(typeof result.body.restored.office_ai_config, 'number');
  assert.equal(
    cryptoHelper.decryptStrict(db.prepare(
      "SELECT api_key_encrypted FROM office_ai_config WHERE provider='openai'"
    ).get().api_key_encrypted),
    'portabler-api-key'
  );
  assert.equal(
    cryptoHelper.decryptStrict(JSON.parse(
      db.prepare("SELECT config_json FROM doc_mounts WHERE id='dav-1'").get().config_json
    ).passEnc),
    'portables-dav-passwort'
  );

  // Echtes Schema 2 enthält den internen Ciphertext der damaligen Installation und
  // gerade keine portablen __recovery_secrets-Marker.
  process.env.ENCRYPTION_KEY = '55'.repeat(32);
  const legacyPayload = backupData.credentialsData(fakeDb(sourceRows));
  const legacyEnvelope = secureJson.encryptJson(legacyPayload, restoreKey, 'credentials/2');
  result = await request('/restore-encrypted/preview', {
    envelope: legacyEnvelope,
    recoveryKey: restoreKey
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.portable, false);
  assert.equal(result.body.requiresOriginalEncryptionKey, true);

  const malformedSecurityPayload = {
    type: 'betreuungsbuero-sicherheit',
    version: 2,
    caseOwners: []
  };
  for (const spec of backupData.registryFor('security')) malformedSecurityPayload[spec.key] = [];
  malformedSecurityPayload.users = [{
      id: 2,
      username: 'darf-nicht-angelegt-werden',
      password_hash: 'nicht-protokollieren',
      display_name: '',
      unbekannte_spalte: 'streng-vertraulicher-rohwert'
  }];
  result = await request('/restore-secrets', {
    ...malformedSecurityPayload,
    confirm: true
  });
  assert.equal(result.response.status, 410);
  assert.equal(result.body.code, 'LEGACY_PLAINTEXT_SECURITY_RESTORE_DISABLED');
  assert.ok(!JSON.stringify(result.body).includes('streng-vertraulicher-rohwert'));
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM users WHERE username='darf-nicht-angelegt-werden'").get().n,
    0
  );

  const sessionAuthority = require('../src/modules/admin/routes')._test;
  db.prepare('DELETE FROM sessions').run();
  db.prepare("INSERT INTO sessions(sid,data,expires_at) VALUES ('behalten','{}',?),('fremd','{}',?)")
    .run(Date.now() + 60000, Date.now() + 60000);
  let disposition = sessionAuthority.reconcileRestoredAdminSessions(db, {
    sessionID: 'behalten',
    session: { userId: 1 }
  });
  assert.equal(disposition.revoked, false);
  assert.deepEqual(db.prepare('SELECT sid FROM sessions').all(), [{ sid: 'behalten' }]);

  db.prepare('UPDATE users SET is_admin=0 WHERE id=1').run();
  assert.throws(
    () => sessionAuthority.assertActiveOnlineAdmin(db),
    (error) => error.code === 'RESTORE_LAST_ACTIVE_ONLINE_ADMIN_REQUIRED'
  );
  disposition = sessionAuthority.reconcileRestoredAdminSessions(db, {
    sessionID: 'behalten',
    session: { userId: 1 }
  });
  assert.equal(disposition.revoked, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  db.prepare('UPDATE users SET is_admin=1 WHERE id=1').run();
});
