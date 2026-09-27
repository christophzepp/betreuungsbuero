'use strict';

// AP-01: real case routes, permission guards and disk-backed SQLite; no live instance.
// Login itself is not covered: the isolated HTTP harness supplies synthetic sessions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const express = require('express');
const fixture = require('./fixtures/server-first/pilot-case.json');

test('Server-first: Referenzfall bleibt über echte Schreib-, Lese- und Rechtepfade erhalten', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'server-first-pilot-'));
  let db, server;
  t.after(async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    if (db?.open) db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  process.env.RUNTIME_ROOT = temp;
  process.env.DB_PATH = path.join(temp, 'pilot.sqlite3');
  process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'documents');
  db = require('../src/database/index');
  for (const id of [1, 2, 3]) {
    db.prepare('INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)')
      .run(id, `sf-user-${id}`, 'not-a-login-hash', `Synthetisch ${id}`);
  }
  const initial = JSON.stringify(fixture.stammdaten);
  db.prepare('INSERT INTO cases (id, label, stammdaten_json, owner_user_id) VALUES (?, ?, ?, ?)')
    .run(fixture.caseId, 'Synthetischer Referenzfall', initial, 1);
  db.prepare('INSERT INTO case_access (case_id, user_id, level) VALUES (?, ?, ?)')
    .run(fixture.caseId, 3, 'read');
  db.prepare('INSERT INTO case_reports (case_id, report_id, data_json, updated_by) VALUES (?, ?, ?, ?)')
    .run(fixture.caseId, 'reference-report', JSON.stringify(fixture.report), 1);
  const permissions = { mode: 'online', canViewCases: true, canEditCases: true,
    canViewDocuments: true, canEditDocuments: true };
  const actors = {
    owner: { ...permissions, userId: 1 },
    foreign: { ...permissions, userId: 2 },
    reader: { ...permissions, userId: 3 },
    noEdit: { ...permissions, userId: 1, canEditCases: false },
    noDocuments: { ...permissions, userId: 1, canViewDocuments: false, canEditDocuments: false },
    local: { ...permissions, userId: 1, mode: 'local' },
  };
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { req.session = actors[req.get('X-Test-Actor')]; next(); });
  app.use('/api', require('../src/middleware/authentication').requireOnlineMode);
  app.use('/api/cases', require('../src/modules/cases/routes'));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}/api/cases/${fixture.caseId}`;
  const stored = () => JSON.parse(db.prepare('SELECT stammdaten_json FROM cases WHERE id=?')
    .get(fixture.caseId).stammdaten_json);
  const reset = () => db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(initial, fixture.caseId);
  async function request(suffix, actor = 'owner', patches) {
    const response = await fetch(endpoint + suffix, {
      method: patches ? 'PATCH' : 'GET',
      headers: { 'content-type': 'application/json', 'X-Test-Actor': actor },
      ...(patches ? { body: JSON.stringify({ patches }) } : {}),
    });
    const body = /application\/json/.test(response.headers.get('content-type') || '')
      ? await response.json() : await response.text();
    return { status: response.status, body };
  }

  await t.test('Gesundheit und Lebensunterhalt: PATCH, GET und unabhängiges Wiederöffnen stimmen überein', async () => {
    reset();
    const updated = structuredClone(fixture.stammdaten);
    updated.healthInfo.notes = 'Synthetische bestätigte Änderung';
    updated.livelihood.expenses[0].monthly = '750.55';
    const result = await request('/stammdaten', 'owner', [
      { path: 'healthInfo', value: updated.healthInfo },
      { path: 'livelihood', value: updated.livelihood },
    ]);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.deepEqual(stored(), updated);
    assert.deepEqual((await request('/stammdaten')).body.data, updated);
    const reopened = spawnSync(process.execPath, ['-e', `
      const Database = require(process.argv[1]);
      const db = new Database(process.argv[2], {readonly: true, fileMustExist: true});
      process.stdout.write(db.prepare('SELECT stammdaten_json FROM cases WHERE id=?').get(process.argv[3]).stammdaten_json);
      db.close();
    `, require.resolve('better-sqlite3'), process.env.DB_PATH, fixture.caseId], { encoding: 'utf8' });
    assert.equal(reopened.status, 0, reopened.stderr);
    assert.deepEqual(JSON.parse(reopened.stdout), updated);
  });

  await t.test('Unbekannte Felder, null, leer, false, Nullbetrag, Archiv und Bericht bleiben erhalten', async () => {
    reset();
    const result = await request('/stammdaten', 'owner', [{ path: 'healthInfo.notes', value: '' }]);
    assert.equal(result.status, 200);
    const expected = structuredClone(fixture.stammdaten);
    expected.healthInfo.notes = '';
    assert.deepEqual(stored(), expected);
    assert.deepEqual((await request('/reports')).body.reports, [{ reportId: 'reference-report', data: fixture.report }]);
  });

  await t.test('Fehlende Sitzung, fremder Fall, Lesefreigabe, fehlendes Bearbeitungsrecht und Lokalmodus schreiben nichts', async () => {
    reset();
    for (const [actor, status] of [['anonymous', 401], ['foreign', 403], ['reader', 403], ['noEdit', 403], ['local', 403]]) {
      const result = await request('/stammdaten', actor, [{ path: 'healthInfo.notes', value: 'nicht zulässig' }]);
      assert.equal(result.status, status, actor);
      assert.deepEqual(stored(), fixture.stammdaten, actor);
    }
    assert.equal((await request('/stammdaten', 'reader')).status, 200);
    assert.equal((await request('/stammdaten', 'foreign')).status, 403);
  });

  await t.test('Teilrechte geben Berichte als nicht verfügbar zurück und lassen gespeicherte Berichte intakt', async () => {
    const loaded = await request('/load', 'noDocuments');
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.reports, null);
    assert.deepEqual(loaded.body.stammdaten.data, stored());
    const denied = await request('/reports/reference-report', 'noDocuments', [{ path: 'fields.note.value', value: '' }]);
    assert.equal(denied.status, 403);
    assert.deepEqual((await request('/reports')).body.reports[0].data, fixture.report);
  });

  await t.test('Ungültige Patch-Liste übernimmt auch vorangehende gültige Teiländerungen nicht', async () => {
    reset();
    const result = await request('/stammdaten', 'owner', [
      { path: 'healthInfo.notes', value: 'darf nicht gespeichert werden' },
      { path: '__proto__.serverFirstPolluted', value: true },
    ]);
    assert.equal(result.status, 400);
    assert.deepEqual(stored(), fixture.stammdaten);
    assert.equal({}.serverFirstPolluted, undefined);
  });

  for (const profile of require('./fixtures/server-first/reference-cases.cjs')()) {
    await t.test(`${profile.id}: ${profile.kind} bewahrt alle Fachwerte bei Teiländerung und Neuladen`, async () => {
      db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify(profile.data), fixture.caseId);
      const expected = structuredClone(profile.data);
      expected.healthInfo.notes = 'Referenzänderung: ÄÖÜ ß, 0,00 EUR';
      assert.equal((await request('/stammdaten', 'owner', [
        { path: 'healthInfo.notes', value: expected.healthInfo.notes },
      ])).status, 200);
      assert.deepEqual(stored(), expected);
      assert.deepEqual((await request('/load')).body.stammdaten.data, expected);
      if (profile.kind === 'large') {
        assert.equal(stored().exportHistory.length, 500);
        assert.equal(stored().exportHistory[499].amount, '4.99');
        assert.equal(stored().healthInfo.diagnoses.length, 100);
      }
      if (profile.kind === 'historical') {
        assert.equal(stored().livelihood.income[0].monthly, '0.00');
        assert.deepEqual(stored().unknownLegacyField.obsolete['früherer-Schlüssel'], ['ÄÖÜ ß', 0, false, null]);
        assert.equal(stored().archives[0].version, 0);
      }
    });
  }

  await t.test('SQLite-Schreibfehler meldet HTTP 500 und bewahrt den letzten bestätigten Stand', async () => {
    reset();
    db.exec(`CREATE TRIGGER sf_reject_case_write BEFORE UPDATE ON cases
      BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END`);
    try {
      const result = await request('/stammdaten', 'owner', [
        { path: 'healthInfo.notes', value: 'darf keinen Erfolg melden' },
      ]);
      assert.equal(result.status, 500);
      assert.notEqual(result.body.ok, true);
      assert.deepEqual(stored(), fixture.stammdaten);
      assert.deepEqual((await request('/stammdaten')).body.data, fixture.stammdaten);
    } finally { db.exec('DROP TRIGGER sf_reject_case_write'); }
  });

  await t.test('SF-REF-004: getrennte Teiländerungen bleiben erhalten; gleicher Alt-Pfad ist dokumentiert last-write-wins', async () => {
    reset();
    for (const [field, value] of [['healthInfo.notes', 'A'], ['person.firstName', 'Synthetisch B']]) {
      assert.equal((await request('/stammdaten', 'owner', [{ path: field, value }])).status, 200);
    }
    assert.equal(stored().healthInfo.notes, 'A');
    assert.equal(stored().person.firstName, 'Synthetisch B');
    assert.equal((await request('/stammdaten', 'owner', [{ path: 'healthInfo.notes', value: 'B' }])).status, 200);
    assert.equal(stored().healthInfo.notes, 'B'); // Known legacy limitation; AP-07 replaces this contract.
  });
});
