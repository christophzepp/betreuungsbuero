'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

// Continues the real CLI restore from the rehearsal; never seeds a second fake target.
module.exports = async function recoveryStartup(t, options) {
  const { serverRoot, target, targetServer, targetData, targetDb, targetOutputs,
    sourceSecretFile, recoveryKey, password, fixture, attachmentId, pdfSha256, envelopes } = options;
  for (const name of ['index.js', 'src', 'frontend', 'tools', 'package-lock.json', 'node_modules']) {
    fs.cpSync(path.join(serverRoot, name), path.join(targetServer, name), { recursive: true });
  }
  assert.equal(fs.existsSync(path.join(targetServer, '.env')), false);
  const targetSecrets = path.join(target, 'secrets');
  fs.mkdirSync(targetSecrets, { mode: 0o700 });
  const targetKeyFile = path.join(targetSecrets, 'document-recovery-key');
  // Simulate separately held key material. The old instance encryption key is absent.
  for (const suffix of ['', '.meta.json']) {
    fs.copyFileSync(sourceSecretFile + suffix, targetKeyFile + suffix);
    fs.chmodSync(targetKeyFile + suffix, 0o600);
  }
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  Object.assign(env, {
    RUNTIME_ROOT: target, DB_PATH: targetDb, DOCUMENTS_DATA_ROOT: targetData,
    OUTPUTS_DIR: targetOutputs, RUNTIME_SECRETS_DIR: targetSecrets,
    DOCUMENT_RECOVERY_KEY_FILE: targetKeyFile,
    EXTENSION_ARTIFACTS_DIR: path.join(target, 'extension-artifacts'),
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    COOKIE_SECURE: '0', CALENDAR_SYNC_INTERVAL_SECONDS: '0',
  });
  const app = require('./server-first-app-harness.cjs')(targetServer, env);
  function client() {
    let cookie = '';
    return async (route, body, method) => {
      const response = await fetch(app.base + route, {
        method: method || (body === undefined ? 'GET' : 'POST'),
        headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const bytes = Buffer.from(await response.arrayBuffer());
      const json = /application\/json/.test(response.headers.get('content-type') || '') ? JSON.parse(bytes) : null;
      return { status: response.status, body: json, bytes, setCookie };
    };
  }
  const login = (request, id, override = {}) => request('/api/login', {
    username: `sf-restore-${id}`, password, mode: 'online', ...override,
  });
  const readStoredCase = () => {
    const db = new Database(targetDb, { readonly: true, fileMustExist: true });
    try { return JSON.parse(db.prepare('SELECT stammdaten_json FROM cases WHERE id=?').get(fixture.caseId).stammdaten_json); }
    finally { db.close(); }
  };
  const protectedState = () => {
    const db = new Database(targetDb, { readonly: true, fileMustExist: true });
    try {
      return {
        users: db.prepare('SELECT * FROM users ORDER BY id').all(),
        access: db.prepare('SELECT * FROM case_access ORDER BY case_id,user_id').all(),
        credentials: db.prepare('SELECT * FROM office_ai_config ORDER BY provider').all(),
        recovery: db.prepare('SELECT * FROM recovery_security_state ORDER BY id').all(),
      };
    } finally { db.close(); }
  };
  let admin = client();
  try {
    await t.test('Neuer Prozess startet in Quarantäne; echte Admin-Anmeldung, Fach-APIs und Leser bleiben gesperrt', async () => {
      await app.start();
      assert.equal((await login(client(), 1, { password: 'incorrect-synthetic-password' })).status, 401);
      assert.equal((await login(client(), 2)).status, 503);
      const result = await login(admin, 1);
      assert.equal(result.status, 200);
      assert.equal(result.body.recovery.active, true);
      assert.ok(!Object.hasOwn(result.body, 'aiConfig'));
      assert.match(result.setCookie, /HttpOnly/i);
      assert.equal((await admin('/api/me')).body.user.id, 1);
      for (const route of ['/api/cases', '/api/admin/users', `/api/documents/files/${attachmentId}`]) {
        const blocked = await admin(route);
        assert.equal(blocked.status, 503, route);
        assert.equal(blocked.body.code, 'RECOVERY_MODE_ACTIVE');
      }
    });
    await t.test('Fehlender/falscher Recovery-Schlüssel und vorzeitige Freigabe werden über echte APIs abgewiesen', async () => {
      const before = readStoredCase();
      const protectedBefore = protectedState();
      for (const key of ['', crypto.randomBytes(32).toString('hex')]) {
        const result = await admin('/api/admin/restore-encrypted/preview', {
          envelope: envelopes.credentials, recoveryKey: key,
        });
        assert.equal(result.status, 400);
      }
      const released = await admin('/api/admin/recovery/release', { confirm: true, adminPassword: password });
      assert.equal(released.status, 409);
      assert.equal(released.body.code, 'RECOVERY_ARTIFACTS_INCOMPLETE');
      assert.deepEqual(readStoredCase(), before);
      assert.deepEqual(protectedState(), protectedBefore);
      assert.equal((await admin('/api/me')).body.recovery.active, true);
    });
    await t.test('Abbildpaar wird über Vorschau und Bestätigung wiederhergestellt; Freigabe verlangt Neustart', async () => {
      for (const [scope, envelope] of Object.entries(envelopes)) {
        const body = { envelope, recoveryKey, ...(scope === 'security' ? { tokenDisposition: 'discard' } : {}) };
        const preview = await admin('/api/admin/restore-encrypted/preview', body);
        assert.equal(preview.status, 200, JSON.stringify(preview.body));
        const applied = await admin('/api/admin/restore-encrypted', { ...body, previewToken: preview.body.previewToken, confirm: true });
        assert.equal(applied.status, 200, JSON.stringify(applied.body));
      }
      const released = await admin('/api/admin/recovery/release', { confirm: true, adminPassword: password });
      assert.equal(released.status, 200, JSON.stringify(released.body));
      assert.equal(released.body.restartRequired, true);
      assert.equal(released.body.recovery.pendingRestart, true);
      assert.equal((await admin('/api/cases')).status, 503);
      assert.equal(fs.existsSync(path.join(targetData, '.recovery-quarantine')), false);
      await app.stop();
    });
    await t.test('Nach Prozessneustart funktionieren Anmeldung, Fall-/PDF-Lesen, Schreibrechte und Abmelden', async () => {
      await app.start();
      admin = client();
      const loggedIn = await login(admin, 1);
      assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn.body));
      assert.equal(loggedIn.body.recovery.active, false);
      assert.equal(loggedIn.body.aiConfig.synthetic.apiKey, 'synthetic-provider-secret');
      const page = await admin('/');
      assert.equal(page.status, 200);
      assert.match(page.bytes.toString('utf8'), /<!doctype html/i);
      const template = await admin('/api/templates/stammdaten');
      assert.equal(template.status, 200);
      assert.deepEqual(template.bytes, fs.readFileSync(path.join(targetServer, 'assets/templates/Stammdaten_blank.xlsx')));
      const caseRoute = `/api/cases/${fixture.caseId}/stammdaten`;
      assert.deepEqual((await admin(caseRoute)).body.data, fixture.stammdaten);
      const reader = client();
      assert.equal((await login(reader, 2)).status, 200);
      assert.deepEqual((await reader(caseRoute)).body.data, fixture.stammdaten);
      if (options.beforeBrowser) {
        const result = await require('./server-first-browser.cjs')(app.base, password, fixture, 'after');
        assert.deepEqual(result.pdfHashes, options.beforeBrowser.pdfHashes, 'Regenerated application PDFs must match the source instance.');
      }
      const change = { patches: [{ path: 'healthInfo.notes', value: 'Nach Wiederanlauf bestätigt' }] };
      assert.equal((await reader(caseRoute, change, 'PATCH')).status, 403);
      assert.equal((await reader('/api/admin/users')).status, 403);
      assert.deepEqual(readStoredCase(), fixture.stammdaten);
      const downloaded = await reader(`/api/documents/files/${attachmentId}`);
      assert.equal(downloaded.status, 200);
      assert.equal(crypto.createHash('sha256').update(downloaded.bytes).digest('hex'), pdfSha256);
      assert.equal((await admin(caseRoute, change, 'PATCH')).status, 200);
      assert.equal((await admin(caseRoute)).body.data.healthInfo.notes, change.patches[0].value);
      assert.equal(readStoredCase().healthInfo.notes, change.patches[0].value);
      assert.equal((await reader('/api/logout', {})).status, 200);
      assert.equal((await reader(caseRoute)).status, 401);
    });
    if (options.beforeBrowser) {
      await t.test('Wiederhergestellte Oberfläche speichert eine Eingabe; Neuladen und unabhängige SQLite-Lesung bestätigen sie', async () => {
        const browser = require('./server-first-browser.cjs');
        const value = await browser.writeAfterRestore(app.base, password, fixture);
        const stored = readStoredCase();
        const expected = structuredClone(fixture.stammdaten);
        expected.healthInfo.notes = value;
        browser.assertRetained(stored, expected);
      });
    }
  } finally {
    await app.stop();
  }
};
