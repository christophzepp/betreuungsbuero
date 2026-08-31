'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');

test('Dashboard-Layout wird benutzerspezifisch validiert, gespeichert und im Büroabbild gesichert', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-prefs-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  process.env.DB_PATH = path.join(temp, 'dashboard.sqlite3');

  delete require.cache[require.resolve('../src/database/index')];
  delete require.cache[require.resolve('../src/modules/settings/user-preference-routes')];
  delete require.cache[require.resolve('../src/modules/backup/portable-data')];
  const db = require('../src/database/index');
  t.after(() => db.close());

  const user = db.prepare(`
    INSERT INTO users(username,password_hash,display_name,active)
    VALUES ('dashboard-test','x','Dashboard Test',1)
  `).run();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {
      userId: Number(user.lastInsertRowid),
      mode: 'online',
      canViewCases: false
    };
    next();
  });
  app.use('/api/user-prefs', require('../src/modules/settings/user-preference-routes'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const layout = {
    version: 1,
    columns: 3,
    cards: [
      { id: 'calendar.today', size: 'normal' },
      { id: 'banking.accounts', size: 'compact' }
    ],
    panels: [
      { id: 'calendar.today', size: '2x1' },
      { id: 'tasks.quick', size: '1x1' },
      { id: 'finance.invoices', size: '3x2' }
    ]
  };
  const saved = await fetch(`${base}/api/user-prefs/dashboard`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefs: layout })
  });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).prefs, layout);

  const loaded = await fetch(`${base}/api/user-prefs/dashboard`);
  assert.equal(loaded.status, 200);
  assert.deepEqual((await loaded.json()).prefs, layout);

  const intro = { version: 1, localSeen: false, onlineSeen: true };
  const introSaved = await fetch(`${base}/api/user-prefs/mode-intro`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefs: intro })
  });
  assert.equal(introSaved.status, 200, 'Das fachneutrale Intro darf ohne Fall-Sichtrecht gespeichert werden.');
  assert.deepEqual((await introSaved.json()).prefs, intro);
  const introLoaded = await fetch(`${base}/api/user-prefs/mode-intro`);
  assert.equal(introLoaded.status, 200);
  assert.deepEqual((await introLoaded.json()).prefs, intro);

  const invalidIntro = await fetch(`${base}/api/user-prefs/mode-intro`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefs: { version: 1, onlineSeen: 'ja', localSeen: false } })
  });
  assert.equal(invalidIntro.status, 400);

  const unrelatedCasePrefs = await fetch(`${base}/api/user-prefs/case-overview`);
  assert.equal(unrelatedCasePrefs.status, 403, 'Nur das fachneutrale Dashboard darf ohne Fall-Sichtrecht geladen werden.');

  const invalid = await fetch(`${base}/api/user-prefs/dashboard`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prefs: {
        version: 1,
        columns: 5,
        cards: [{ id: 'calendar.today', size: 'riesig' }],
        panels: []
      }
    })
  });
  assert.equal(invalid.status, 400);

  const backupData = require('../src/modules/backup/portable-data');
  const office = backupData.officeData(db);
  const rows = office.tables.user_ui_prefs;
  assert.equal(rows.length, 2);
  const byKey = new Map(rows.map((row) => [row.pref_key, JSON.parse(row.data_json)]));
  assert.deepEqual(byKey.get('dashboard'), layout);
  assert.deepEqual(byKey.get('mode-intro'), intro, 'Der Intro-Status fehlt im Büro-JSON-Abbild.');
});
