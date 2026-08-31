/* Webhook-Wecker (PLAN-AUFGABEN-SYNC, Etappe 3): Absicherung und Entprellung.
 * Der Endpunkt darf nur mit passendem Secret (HMAC-Signatur oder ?s=) einen Abgleich anstoßen -
 * und viele Aufrufe in kurzer Folge müssen zu EINEM Lauf zusammenfallen.
 */
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-'));
process.env.DB_PATH = path.join(temp, 'test.sqlite3');
process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
process.env.ENCRYPTION_KEY = '55'.repeat(32);

const express = require('express');
const db = require('../src/database/index');
const runner = require('../src/modules/sync/runner');
const hookRoutes = require('../src/modules/sync/hook-routes');

const SECRET = 'hook-secret-abc';
const CONN_ID = 'conn-hook';

function seed() {
  db.prepare('DELETE FROM calendar_connections').run();
  db.prepare(`
    INSERT INTO calendar_connections (id, provider, display_name, enabled, password_encrypted, calendar_url, webhook_secret)
    VALUES (?, 'vikunja-api', 'Vikunja', 1, 'x', 'http://vikunja.test', ?)
  `).run(CONN_ID, SECRET);
}

function post(port, pathName, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: pathName, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('Webhook-Wecker', async (t) => {
  seed();
  let syncRuns = 0;
  const originalSync = runner.syncTodos;
  runner.syncTodos = async () => { syncRuns += 1; return { ran: true, errors: [] }; };
  const app = express();
  app.use('/api/sync-hooks', hookRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => { server.close(); runner.syncTodos = originalSync; });

  await t.test('falsches Secret: 403, unbekannte Verbindung: 404, kein Lauf', async () => {
    assert.equal((await post(port, `/api/sync-hooks/vikunja/${CONN_ID}?s=falsch`, '{}')).status, 403);
    assert.equal((await post(port, '/api/sync-hooks/vikunja/gibts-nicht?s=x', '{}')).status, 404);
  });

  await t.test('richtiges Secret (?s=) und HMAC-Signatur werden angenommen', async () => {
    assert.equal((await post(port, `/api/sync-hooks/vikunja/${CONN_ID}?s=${SECRET}`, '{}')).status, 200);
    const payload = JSON.stringify({ event_name: 'task.updated' });
    const sig = crypto.createHmac('sha256', SECRET).update(payload, 'utf8').digest('hex');
    assert.equal((await post(port, `/api/sync-hooks/vikunja/${CONN_ID}`, payload, { 'X-Vikunja-Signature': sig })).status, 200);
    const badSig = crypto.createHmac('sha256', 'anderes-secret').update(payload, 'utf8').digest('hex');
    assert.equal((await post(port, `/api/sync-hooks/vikunja/${CONN_ID}`, payload, { 'X-Vikunja-Signature': badSig })).status, 403);
  });

  await t.test('viele Aufrufe fallen zu EINEM Lauf zusammen (Entprellung)', async () => {
    syncRuns = 0;
    for (let i = 0; i < 5; i += 1) {
      await post(port, `/api/sync-hooks/vikunja/${CONN_ID}?s=${SECRET}`, '{}');
    }
    assert.equal(syncRuns, 0, 'Vor Ablauf der Entprellzeit läuft nichts.');
    await new Promise((resolve) => setTimeout(resolve, 1900));
    assert.equal(syncRuns, 1, 'Fünf Wecker, ein Lauf.');
  });
});
