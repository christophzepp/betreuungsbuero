'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('serverseitiger Modus-Guard sperrt local-Sitzungen und lässt Auth/Bearer-Verträge unberührt', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'online-mode-guard-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  process.env.DB_PATH = path.join(temp, 'fixture.sqlite3');
  const db = require('../src/database/index');
  t.after(() => db.close());
  const { requireOnlineMode } = require('../src/middleware/authentication');

  function invoke(session) {
    let nextCalled = false;
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    requireOnlineMode({ session }, response, () => { nextCalled = true; });
    return { nextCalled, response };
  }

  const local = invoke({ userId: 7, mode: 'local' });
  assert.equal(local.nextCalled, false);
  assert.equal(local.response.statusCode, 403);
  assert.equal(local.response.body.code, 'ONLINE_MODE_REQUIRED');

  assert.equal(invoke({ userId: 7, mode: 'online' }).nextCalled, true);
  assert.equal(invoke(undefined).nextCalled, true, 'sitzungslose Bearer-Routen behalten ihre eigene Authentifizierung');

  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const authMount = indexSource.indexOf("app.use('/api', authRoutes)");
  const modeMount = indexSource.indexOf("app.use('/api', requireOnlineMode)");
  const caseMount = indexSource.indexOf("app.use('/api/cases', caseRoutes)");
  assert.ok(authMount >= 0 && modeMount > authMount && caseMount > modeMount);
  assert.match(
    indexSource,
    /'\/api\/documents\/strom',\s*sessionMiddleware,\s*requireOnlineMode,/,
    'auch der vor dem JSON-Parser montierte Strom-Upload muss den Modus prüfen'
  );
});
