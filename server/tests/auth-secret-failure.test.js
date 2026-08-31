'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');

test('ein nach dem Start beschädigtes Office-Secret beendet Login/Session-Wiederaufnahme nicht', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-secret-failure-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  process.env.DB_PATH = path.join(temp, 'fixture.sqlite3');
  process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
  process.env.ENCRYPTION_KEY = '91'.repeat(32);
  fs.mkdirSync(process.env.DOCUMENTS_DATA_ROOT);
  const db = require('../src/database/index');
  t.after(() => db.close());
  db.prepare(`
    INSERT INTO users(id,username,password_hash,display_name,is_admin,allow_online)
    VALUES (1,'admin',?,'Admin',1,1)
  `).run(await bcrypt.hash('test-password', 4));

  // Router laden initialisiert die Schlüsselkennung bei noch konsistentem Bestand.
  const authRoutes = require('../src/modules/auth/routes');
  db.prepare(`
    INSERT INTO office_ai_config(provider,api_key_encrypted,model,endpoint)
    VALUES ('openai','00:00:00','test','')
    ON CONFLICT(provider) DO UPDATE SET api_key_encrypted=excluded.api_key_encrypted
  `).run();
  const user = db.prepare('SELECT * FROM users WHERE id=1').get();
  const result = authRoutes._test.safeDecryptedOfficeConfig(user, 'online');
  assert.equal(result.secretConfigurationAvailable, false);
  assert.deepEqual(result.aiConfig, {});
  assert.deepEqual(result.sendCredentials, {});
  assert.equal(result.smtpConfigured, false);
  assert.ok(!JSON.stringify(result).includes('00:00:00'));
});
