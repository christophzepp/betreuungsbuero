'use strict';

/*
 * Vollständiger isolierter Wiederanlauf: eigene SQLite-Datei, zufälliger Port,
 * kein Zugriff auf Produktivdaten oder laufende Server.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

test('MCP-Module mit DB-Bereinigungstimer werden in Recovery nicht geladen', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(
    source,
    /if \(!recoveryMode\.isActive\(\)\) \{\s*app\.use\(require\('\.\/src\/integrations\/mcp\/oauth-routes'\)\);\s*app\.use\(require\('\.\/src\/integrations\/mcp\/routes'\)\);\s*\}/
  );
});

test('neuer ENCRYPTION_KEY erzwingt Admin-Quarantäne und atomaren Schema-3-Doppelrestore', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-bootstrap-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  process.env.DB_PATH = path.join(temp, 'restored.sqlite3');
  process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
  process.env.DOCUMENT_RECOVERY_KEY_FILE = path.join(temp, 'runtime', 'document-recovery-key');
  process.env.DOCUMENT_RECOVERY_KEY = '';
  process.env.SESSION_SECRET = 'isoliertes-session-secret-fuer-recovery-tests';
  process.env.ENCRYPTION_KEY = '81'.repeat(32);
  fs.mkdirSync(process.env.DOCUMENTS_DATA_ROOT);

  const db = require('../src/database/index');
  t.after(() => db.close());
  const cryptoHelper = require('../src/security/crypto');
  const backupData = require('../src/modules/backup/portable-data');
  const secureJson = require('../src/security/secure-json');
  const adminPassword = 'Wiederanlauf-Admin-2026!';
  const passwordHash = await bcrypt.hash(adminPassword, 4);
  db.prepare(`
    INSERT INTO users (id,username,password_hash,display_name,is_admin,allow_online)
    VALUES (1,'recovery-admin',?,'Recovery Admin',1,1)
  `).run(passwordHash);
  db.prepare(`
    INSERT INTO office_ai_config(provider,api_key_encrypted,model,endpoint)
    VALUES ('openai',?,'test','')
    ON CONFLICT(provider) DO UPDATE SET api_key_encrypted=excluded.api_key_encrypted
  `).run(cryptoHelper.encrypt('altes-portables-ai-geheimnis'));
  db.prepare(`
    INSERT INTO api_tokens(id,user_id,token_hash,label)
    VALUES ('alter-browser-token',1,'alter-token-hash','Altgerät')
  `).run();
  db.prepare(`
    INSERT INTO mcp_auth_codes
      (code_hash,client_id,user_id,scope,code_challenge,resource,redirect_uri,expires_at)
    VALUES ('alter-code','client-1',1,'mcp','challenge','','https://example.invalid/callback','2099-01-01T00:00:00Z')
  `).run();
  db.prepare('INSERT INTO office_profile(id,maps_api_key_encrypted) VALUES(1,?)')
    .run(cryptoHelper.encrypt('historischer-maps-schluessel'));

  const sourceBundle = backupData.createPortableRecoveryBundle(db, cryptoHelper, {
    generationId: '7cf8c650-9d8a-4abc-8ff1-fb9ad82c0f7a'
  });
  const wrongBundle = backupData.createPortableRecoveryBundle(db, cryptoHelper, {
    generationId: '117c515d-6476-4b9b-991f-017973a6860c'
  });
  const recoveryKey = 'extern-verwahrter-bootstrap-schluessel-2026';
  const envelope = (payload, schema, bundle) => secureJson.encryptJson(payload, recoveryKey, schema, {
    keyId: 'drk_563579c0-5a72-41f3-9ec6-031fb272a407',
    generationId: bundle.generationId,
    sourceRevision: bundle.sourceRevision
  });
  const securityEnvelope = envelope(sourceBundle.security, 'security/3', sourceBundle);
  const credentialsEnvelope = envelope(sourceBundle.credentials, 'credentials/3', sourceBundle);
  const wrongCredentialsEnvelope = envelope(wrongBundle.credentials, 'credentials/3', wrongBundle);
  const restoreMarker = path.join(process.env.DOCUMENTS_DATA_ROOT, '.recovery-quarantine');
  fs.writeFileSync(
    restoreMarker,
    'Betreuungsbuero-Recovery-Quarantaene/1\n'
      + 'RESTORED_AT=2026-07-28T09:30:00Z\n'
      + 'SNAPSHOT=Gesamtsicherung_Test\n'
      + 'BACKGROUND_JOBS=DISABLED_UNTIL_ADMIN_RELEASE\n'
  );

  // Simulierter Neuaufbau des Servers: DB bleibt, interner Installationsschlüssel ist neu.
  process.env.ENCRYPTION_KEY = '82'.repeat(32);
  const recoveryMode = require('../src/modules/recovery/mode').ensure(db);
  assert.equal(recoveryMode.status().active, true);
  assert.equal(recoveryMode.status().reason, 'disaster_restore');
  assert.equal(recoveryMode.status().restoreMarker.valid, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mcp_auth_codes').get().n, 0);

  const auth = require('../src/middleware/authentication');
  const app = express();
  app.use(recoveryMode.rawGate);
  app.use(express.json({ limit: '5mb' }));
  // Produktionsreihenfolge nachbilden: Der Erstinstallationsweg liegt vor dem
  // allgemeinen /api-Gate und muss deshalb bereits vom rohen Gate gesperrt werden.
  app.post('/api/setup', (_req, res) => res.json({ unsafe: true }));
  app.use(auth.createSessionMiddleware());
  app.use('/api', recoveryMode.apiGate);
  app.use('/api', require('../src/modules/auth/routes'));
  app.use('/api/admin', require('../src/modules/admin/routes'));
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = async (route, body, method) => {
    const response = await fetch(base + route, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { response, body: await response.json() };
  };

  let result = await request('/api/login', {
    username: 'recovery-admin',
    password: adminPassword,
    mode: 'online'
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.recovery.active, true);
  assert.ok(!Object.hasOwn(result.body, 'aiConfig'));
  result = await request('/api/setup', { username: 'zweiter-admin' });
  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, 'RECOVERY_MODE_ACTIVE');
  db.prepare(
    "INSERT INTO sessions(sid,data,expires_at) VALUES ('alte-fremde-sitzung','{}',?)"
  ).run(Date.now() + 3600000);

  result = await request('/api/admin/users');
  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, 'RECOVERY_MODE_ACTIVE');

  const previewAndRestore = async (restoreEnvelope, tokenDisposition) => {
    const preview = await request('/api/admin/restore-encrypted/preview', {
      envelope: restoreEnvelope,
      recoveryKey,
      ...(tokenDisposition ? { tokenDisposition } : {})
    });
    assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
    return request('/api/admin/restore-encrypted', {
      envelope: restoreEnvelope,
      recoveryKey,
      previewToken: preview.body.previewToken,
      confirm: true,
      ...(tokenDisposition ? { tokenDisposition } : {})
    });
  };

  const tokenPreview = await request('/api/admin/restore-encrypted/preview', {
    envelope: securityEnvelope,
    recoveryKey,
    tokenDisposition: 'restore'
  });
  assert.equal(tokenPreview.response.status, 200, JSON.stringify(tokenPreview.body));
  result = await request('/api/admin/restore-encrypted', {
    envelope: securityEnvelope,
    recoveryKey,
    previewToken: tokenPreview.body.previewToken,
    confirm: true,
    tokenDisposition: 'restore'
  });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /ausdrücklich bestätigt/);

  result = await previewAndRestore(securityEnvelope, 'discard');
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.sessionRevoked, false);
  assert.equal(result.body.generation.generationId, sourceBundle.generationId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM api_tokens').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE sid='alte-fremde-sitzung'").get().n, 0);

  // Ein Credential-Abbild einer anderen Generation wird innerhalb derselben DB-
  // Transaktion abgelehnt; der alte Ciphertext bleibt dadurch unangetastet.
  result = await previewAndRestore(wrongCredentialsEnvelope);
  assert.equal(result.response.status, 422);
  assert.equal(result.body.code, 'RESTORE_GENERATION_MISMATCH');
  assert.throws(
    () => cryptoHelper.decryptStrict(
      db.prepare("SELECT api_key_encrypted FROM office_ai_config WHERE provider='openai'").get().api_key_encrypted
    )
  );

  result = await previewAndRestore(credentialsEnvelope);
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(
    db.prepare('SELECT maps_api_key_encrypted FROM office_profile WHERE id=1').get().maps_api_key_encrypted,
    '',
    'der nicht portable historische Maps-Ciphertext muss nach dem Credential-Restore verschwinden'
  );
  assert.equal(
    cryptoHelper.decryptStrict(
      db.prepare("SELECT api_key_encrypted FROM office_ai_config WHERE provider='openai'").get().api_key_encrypted
    ),
    'altes-portables-ai-geheimnis'
  );

  db.prepare('UPDATE users SET is_admin=0 WHERE id=1').run();
  result = await request('/api/admin/recovery/release', {
    confirm: true,
    adminPassword
  });
  assert.equal(result.response.status, 403, 'ein veraltetes Admin-Sessionflag darf die Quarantäne nicht freigeben');
  db.prepare('UPDATE users SET is_admin=1 WHERE id=1').run();

  result = await request('/api/admin/recovery/release', {
    confirm: true,
    adminPassword
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.restartRequired, true);
  assert.equal(result.body.recovery.pendingRestart, true);
  assert.equal(fs.existsSync(restoreMarker), false);
  assert.equal(
    fs.readdirSync(process.env.DOCUMENTS_DATA_ROOT)
      .filter((name) => name.startsWith('.recovery-quarantine.released-')).length,
    1
  );

  // Auch nach erfolgreicher Prüfung läuft im alten Prozess nichts versehentlich an.
  result = await request('/api/admin/users');
  assert.equal(result.response.status, 503);
  assert.equal(recoveryMode.status().databaseQuarantine, false);
});

test('ein verlinkter oder beschädigter Restore-Marker öffnet den Server niemals', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-marker-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const dataRoot = path.join(temp, 'data');
  fs.mkdirSync(dataRoot);
  const external = path.join(temp, 'marker-target');
  fs.writeFileSync(
    external,
    'Betreuungsbuero-Recovery-Quarantaene/1\n'
      + 'RESTORED_AT=2026-07-28T09:30:00Z\n'
      + 'SNAPSHOT=Test\n'
      + 'BACKGROUND_JOBS=DISABLED_UNTIL_ADMIN_RELEASE\n'
  );
  fs.symlinkSync(external, path.join(dataRoot, '.recovery-quarantine'));
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE sessions (sid TEXT PRIMARY KEY,data TEXT NOT NULL,expires_at INTEGER NOT NULL);
    INSERT INTO sessions VALUES ('alt','{}',9999999999999);
  `);
  const mode = require('../src/modules/recovery/mode').ensure(db, {
    env: {
      ENCRYPTION_KEY: '93'.repeat(32),
      DOCUMENTS_DATA_ROOT: dataRoot
    }
  });
  assert.equal(mode.status().active, true);
  assert.equal(mode.status().reason, 'disaster_restore_marker_invalid');
  assert.equal(mode.status().restoreMarker.valid, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('ein langlebiger Restore-Fortschrittsmarker sperrt auch das SIGKILL-Fenster vor dem Datentausch', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-progress-marker-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const dataRoot = path.join(temp, 'data');
  fs.mkdirSync(dataRoot);
  const recoveryModule = require('../src/modules/recovery/mode');
  const location = recoveryModule._test.restoreProgressMarkerPath({
    DOCUMENTS_DATA_ROOT: dataRoot
  });
  fs.writeFileSync(
    location.file,
    'Betreuungsbuero-Restore-In-Progress/1\n'
      + 'STARTED_AT=2026-07-28T09:30:00Z\n'
      + 'SNAPSHOT=Gesamtsicherung_SIGKILL\n'
      + `DATA_TARGET_SHA256=${location.targetHash}\n`
      + 'STATE=ACTIVATING\n',
    { mode: 0o600 }
  );
  const inspected = recoveryModule._test.inspectRestoreProgressMarker({
    DOCUMENTS_DATA_ROOT: dataRoot
  });
  assert.equal(inspected.present, true);
  assert.equal(inspected.valid, true);

  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE sessions (sid TEXT PRIMARY KEY,data TEXT NOT NULL,expires_at INTEGER NOT NULL)');
  const mode = recoveryModule.ensure(db, {
    env: {
      ENCRYPTION_KEY: '95'.repeat(32),
      DOCUMENTS_DATA_ROOT: dataRoot
    }
  });
  assert.equal(mode.status().active, true);
  assert.equal(mode.status().reason, 'disaster_restore_in_progress');
  assert.equal(mode.status().restoreProgressMarker.valid, true);
  const generation = 'fortschrittsmarker-generation';
  const revision = 'b'.repeat(64);
  mode.recordArtifactRestore('security', generation, revision, 'discard');
  mode.recordArtifactRestore('credentials', generation, revision);
  assert.equal(mode.status().artifactsComplete, true);
  assert.equal(mode.status().readyToRelease, false);
  assert.throws(() => mode.release(), (error) =>
    error && error.code === 'RECOVERY_RESTORE_IN_PROGRESS'
  );

  fs.rmSync(location.file);
  assert.equal(mode.status().restoreProgressMarker.present, false);
  assert.equal(
    mode.status().readyToRelease,
    false,
    'ohne den nach vollständig aktiviertem Restore erwarteten Quarantänemarker darf keine Freigabe möglich sein'
  );
});

test('ein Dateisystemfehler bei der Freigabe lässt die DB in Quarantäne und die geprüfte Generation erhalten', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-release-error-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const dataRoot = path.join(temp, 'data');
  fs.mkdirSync(dataRoot);
  const marker = path.join(dataRoot, '.recovery-quarantine');
  fs.writeFileSync(
    marker,
    'Betreuungsbuero-Recovery-Quarantaene/1\n'
      + 'RESTORED_AT=2026-07-28T09:30:00Z\n'
      + 'SNAPSHOT=Test\n'
      + 'BACKGROUND_JOBS=DISABLED_UNTIL_ADMIN_RELEASE\n'
  );
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE sessions (sid TEXT PRIMARY KEY,data TEXT NOT NULL,expires_at INTEGER NOT NULL)');
  const mode = require('../src/modules/recovery/mode').ensure(db, {
    env: {
      ENCRYPTION_KEY: '94'.repeat(32),
      DOCUMENTS_DATA_ROOT: dataRoot
    }
  });
  const generation = 'feste-testgeneration';
  const revision = 'a'.repeat(64);
  mode.recordArtifactRestore('security', generation, revision, 'discard');
  mode.recordArtifactRestore('credentials', generation, revision);
  assert.equal(mode.status().readyToRelease, true);

  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulierter schreibgeschützter Datenträger'); };
  try {
    assert.throws(() => mode.release(), (error) =>
      error && error.code === 'RECOVERY_MARKER_RELEASE_FAILED'
    );
  } finally {
    fs.renameSync = originalRename;
  }
  const state = mode.status();
  assert.equal(state.databaseQuarantine, true);
  assert.equal(state.pendingRestart, false);
  assert.equal(state.securityGenerationId, generation);
  assert.equal(state.credentialsGenerationId, generation);
  assert.equal(state.readyToRelease, true);
  assert.equal(fs.existsSync(marker), true);
});
