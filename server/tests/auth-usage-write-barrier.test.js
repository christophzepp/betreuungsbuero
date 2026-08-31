'use strict';

/*
 * Integrationstest der beiden Authentifizierungswege gegen eine ausschließlich
 * temporäre SQLite-Datei. Er beweist:
 *  - Authentifizierung/Downloads bleiben während der Sicherung möglich,
 *  - last_used_at bleibt währenddessen unverändert,
 *  - der nächste Zugriff holt den übersprungenen Statistik-Write nach.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcrypt');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-usage-write-barrier-'));
process.env.DB_PATH = path.join(temp, 'fixture.sqlite3');
process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
fs.mkdirSync(process.env.DOCUMENTS_DATA_ROOT, { recursive: true });

const db = require('../src/database/index');
const barrier = require('../src/middleware/application-write-barrier');
const extAuth = require('../src/integrations/extensions/authentication');
// Initialisiert zugleich das Dokumentenschema mit doc_webdav_tokens.
const webdav = require('../src/integrations/storage/webdav');

db.prepare(`
  INSERT INTO users
    (id, username, password_hash, display_name, is_admin, active)
  VALUES (1, 'barrier-user', 'x', 'Barrier User', 1, 1)
`).run();

const bearer = 'test-bearer-token';
db.prepare(`
  INSERT INTO api_tokens (id, user_id, token_hash, label)
  VALUES ('api-token-test', 1, ?, 'Test')
`).run(extAuth.hashToken(bearer));

const webdavPassword = 'test-webdav-password';
db.prepare(`
  INSERT INTO doc_webdav_tokens (id, user_id, label, pass_hash)
  VALUES ('webdav-token-test', 1, 'Test', ?)
`).run(bcrypt.hashSync(webdavPassword, 4));
const apiTimestampBefore = db.prepare(
  'SELECT last_used_at FROM api_tokens WHERE id=?'
).get('api-token-test').last_used_at;
const webdavTimestampBefore = db.prepare(
  'SELECT last_used_at FROM doc_webdav_tokens WHERE id=?'
).get('webdav-token-test').last_used_at;

function authResponse() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function webdavResponse() {
  return {
    statusCode: 200,
    headers: {},
    writeHead(code, headers) {
      this.statusCode = code;
      Object.assign(this.headers, headers || {});
      return this;
    },
    end(body) {
      this.body = body;
      return this;
    }
  };
}

test('Extension- und WebDAV-Nutzungstimestamps warten eine aktive Gesamtsicherung ab', async () => {
  barrier._test.resetForTests();
  const snapshot = await barrier.begin('Auth-Timestamp-Test');
  try {
    let extensionNext = false;
    extAuth.requireExtToken(
      {
        ip: '127.0.0.1',
        headers: { authorization: `Bearer ${bearer}` }
      },
      authResponse(),
      () => { extensionNext = true; }
    );
    assert.equal(extensionNext, true, 'Bearer-Authentifizierung bleibt während der Sicherung möglich');

    await webdav(
      {
        method: 'GET',
        url: '/',
        originalUrl: '/webdav/',
        headers: {
          authorization: `Basic ${Buffer.from(`barrier-user:${webdavPassword}`).toString('base64')}`
        }
      },
      webdavResponse()
    );

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      db.prepare('SELECT last_used_at FROM api_tokens WHERE id=?').get('api-token-test').last_used_at,
      apiTimestampBefore
    );
    assert.equal(
      db.prepare('SELECT last_used_at FROM doc_webdav_tokens WHERE id=?').get('webdav-token-test').last_used_at,
      webdavTimestampBefore
    );
  } finally {
    snapshot.release();
  }

  let extensionNext = false;
  extAuth.requireExtToken(
    {
      ip: '127.0.0.1',
      headers: { authorization: `Bearer ${bearer}` }
    },
    authResponse(),
    () => { extensionNext = true; }
  );
  assert.equal(extensionNext, true);

  await webdav(
    {
      method: 'GET',
      url: '/',
      originalUrl: '/webdav/',
      headers: {
        authorization: `Basic ${Buffer.from(`barrier-user:${webdavPassword}`).toString('base64')}`
      }
    },
    webdavResponse()
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(
    db.prepare('SELECT last_used_at FROM api_tokens WHERE id=?').get('api-token-test').last_used_at,
    /^\d{4}-\d{2}-\d{2}/
  );
  assert.match(
    db.prepare('SELECT last_used_at FROM doc_webdav_tokens WHERE id=?').get('webdav-token-test').last_used_at,
    /^\d{4}-\d{2}-\d{2}/
  );
  assert.equal(barrier.status().activeWrites, 0);
});

test.after(() => {
  barrier._test.resetForTests();
  try { db.close(); } catch (_error) { /* Test-Aufräumen */ }
  fs.rmSync(temp, { recursive: true, force: true });
});
