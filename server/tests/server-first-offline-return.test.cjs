'use strict';

// AP-00-X10 / AP-01: legacy return-file importer -> real HTTP -> disk SQLite.
// Synthetic sessions/cache/DOM; no browser, production instance or external provider.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const express = require('express');
const { PDFDocument } = require('@cantoo/pdf-lib');
const fixture = require('./fixtures/server-first/pilot-case.json');
const { createFieldClient } = require('./helpers/server-first-field-client.cjs');

test('Server-first: Außendienstrückgabe bis zur tatsächlichen Ablage', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'server-first-offline-'));
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
  process.env.DB_PATH = path.join(temp, 'offline.sqlite3');
  process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'documents');
  db = require('../src/database/index');
  for (const id of [1, 2, 3]) {
    db.prepare('INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)')
      .run(id, `sf-offline-${id}`, 'not-a-login-hash', `Synthetisch ${id}`);
  }
  const permissions = { mode: 'online', canViewCases: true, canEditCases: true,
    canViewDocuments: true, canEditDocuments: true, canUseFieldService: true };
  const actors = { owner: { ...permissions, userId: 1 }, delegate: { ...permissions, userId: 2 },
    reader: { ...permissions, userId: 3 }, noEdit: { ...permissions, userId: 1, canEditCases: false },
    noField: { ...permissions, userId: 1, canUseFieldService: false } };
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { req.session = actors[req.get('X-Test-Actor')]; next(); });
  app.use('/api', require('../src/middleware/authentication').requireOnlineMode);
  app.use('/api/cases', require('../src/modules/cases/routes'));
  app.use('/api/office-json', require('../src/modules/office/json-routes'));
  app.use('/api/calendar', require('../src/modules/calendar/routes'));
  app.use('/api/todos', require('../src/modules/calendar/todo-routes'));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const casePath = `/api/cases/${fixture.caseId}`;
  const ledgerPath = '/api/office-json/aussendienst_ledger';
  let actor, beforeRequest, afterResponse;
  async function request(url, options = {}) {
    const intercepted = beforeRequest && await beforeRequest(url, options);
    if (intercepted) return intercepted;
    const response = await fetch(base + url, { ...options,
      headers: { ...options.headers, 'X-Test-Actor': actor } });
    if (afterResponse) await afterResponse(url, options, response);
    return response;
  }
  function reset() {
    actor = 'owner'; beforeRequest = afterResponse = null;
    db.prepare(`INSERT INTO cases (id,label,owner_user_id,stammdaten_json) VALUES (?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET owner_user_id=1, stammdaten_json=excluded.stammdaten_json`)
      .run(fixture.caseId, 'Synthetischer Außendienstfall', JSON.stringify(fixture.stammdaten));
    db.prepare('DELETE FROM case_access WHERE case_id=?').run(fixture.caseId);
    for (const [userId, level] of [[2, 'write'], [3, 'read']]) {
      db.prepare('INSERT INTO case_access (case_id,user_id,level) VALUES (?,?,?)').run(fixture.caseId, userId, level);
    }
    db.prepare("DELETE FROM office_json WHERE key='aussendienst_ledger'").run();
  }
  const stored = (id = fixture.caseId) => JSON.parse(db.prepare('SELECT stammdaten_json FROM cases WHERE id=?').get(id).stammdaten_json);
  const ledger = () => JSON.parse(db.prepare('SELECT data_json FROM office_json WHERE key=?').get('aussendienst_ledger')?.data_json || '{}');
  const applied = () => Object.keys(ledger().applied || {});
  const changed = () => { const data = structuredClone(fixture.stammdaten); data.healthInfo.notes = 'Synthetischer Hausbesuch'; return data; };
  async function client(ids = [fixture.caseId]) {
    const caseEntries = [];
    for (const id of ids) {
      const response = await request(`/api/cases/${id}/load`);
      assert.equal(response.status, 200);
      const loaded = await response.json();
      const caseData = { ...loaded.stammdaten.data,
        documentationEntries: loaded.dokuEntries.entries.map(entry => ({ ...entry.data, id: entry.id })) };
      caseEntries.push({ caseId: id, label: 'Synthetischer Außendienstfall', state: { caseData } });
    }
    return createFieldClient({ caseEntries, request });
  }
  function reopen() {
    const result = spawnSync(process.execPath, ['-e', `
      const db = new (require(process.argv[1]))(process.argv[2], {readonly:true,fileMustExist:true});
      process.stdout.write(JSON.stringify({
        data:JSON.parse(db.prepare('SELECT stammdaten_json FROM cases WHERE id=?').get(process.argv[3]).stammdaten_json),
        ledger:JSON.parse(db.prepare("SELECT data_json FROM office_json WHERE key='aussendienst_ledger'").get().data_json)
      })); db.close();
    `, require.resolve('better-sqlite3'), process.env.DB_PATH, fixture.caseId], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }

  await t.test('Rückgabedatei erhält Altbestand und unabhängige Büroänderung; Wiederöffnen und Wiederholung', async () => {
    reset();
    const offline = changed(); offline.livelihood.expenses[0].monthly = '0';
    const c = await client(), packet = await c.load(fixture.stammdaten, offline);
    assert.equal(c.rows.length, 2);
    assert.ok(c.rows.every(row => row.wahl));
    const office = structuredClone(fixture.stammdaten), expected = structuredClone(offline);
    office.livelihood.expenses[0].description = expected.livelihood.expenses[0].description = 'Im Büro ergänzt';
    db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify(office), fixture.caseId);
    await c.apply();
    assert.equal(c.errors.length, 0);
    assert.equal(c.successes.length, 1);
    assert.deepEqual(stored(), expected);
    const reopened = reopen();
    assert.deepEqual(reopened.data, expected);
    assert.deepEqual(Object.values(reopened.ledger.applied).map(row => row.addr).sort(), Array.from(c.rows, row => row.addr).sort());
    assert.ok(Object.values(reopened.ledger.applied).every(row => row.caseId === fixture.caseId && row.snapshotId === 'SF-AD-001'));
    const again = await client(); await again.importText(packet); await again.apply();
    assert.ok(again.rows.every(row => row.ledgerState === 'applied' && !row.wahl));
    assert.equal(again.calls.filter(call => call.method === 'PATCH').length, 0);
    assert.deepEqual(stored(), expected);
  });

  await t.test('Unlesbare oder fremde Rückgabedateien führen zu keinem Schreibversuch', async () => {
    reset();
    for (const text of ['{', '{"typ":"anderes-format"}', '{"typ":"aussendienst-rueckgabe","data":"{"}']) {
      const c = await client();
      await assert.rejects(c.importText(text), /Einlesen fehlgeschlagen/);
      assert.equal(c.calls.length, 0); assert.equal(c.successes.length, 0);
      assert.deepEqual(stored(), fixture.stammdaten); assert.deepEqual(ledger(), {});
    }
  });

  await t.test('Konflikt bleibt unausgewählt; erneute Büroänderung nach der Vorschau wird nicht überschrieben', async () => {
    reset();
    const office = changed(); office.healthInfo.notes = 'Zwischenzeitlich im Büro';
    db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify(office), fixture.caseId);
    const conflict = await client(); await conflict.load(fixture.stammdaten, changed());
    assert.equal(conflict.rows[0].status, 'konflikt'); assert.equal(conflict.rows[0].wahl, false);
    await conflict.apply(); assert.deepEqual(stored(), office); assert.deepEqual(applied(), []);
    reset();
    const stale = await client(); await stale.load(fixture.stammdaten, changed());
    db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify(office), fixture.caseId);
    await stale.apply();
    assert.equal(stale.rows[0].status, 'konflikt');
    assert.equal(stale.calls.filter(call => call.method === 'PATCH').length, 0);
    assert.deepEqual(stored(), office); assert.deepEqual(applied(), []);
  });

  await t.test('Lesefreigabe, Rechteentzug, fehlendes Außendienstrecht und entfernter Fall erlauben keine Übernahme', async () => {
    for (const mode of ['reader', 'noEdit', 'noField', 'revoked', 'deleted']) {
      reset();
      const c = await client(); await c.load(fixture.stammdaten, changed());
      actor = mode === 'revoked' ? 'delegate' : mode === 'deleted' ? 'owner' : mode;
      if (mode === 'revoked') db.prepare('DELETE FROM case_access WHERE case_id=? AND user_id=2').run(fixture.caseId);
      if (mode === 'deleted') db.prepare('DELETE FROM cases WHERE id=?').run(fixture.caseId);
      await c.apply();
      assert.equal(c.successes.length, 0, mode); assert.match(c.message, /Schreiben fehlgeschlagen/, mode);
      assert.ok(c.calls.some(call => call.status === 403), mode); assert.deepEqual(applied(), [], mode);
      if (mode !== 'deleted') assert.deepEqual(stored(), fixture.stammdaten, mode);
    }
  });

  await t.test('Abbruch vor dem PATCH meldet Fehler; derselbe Import kann anschließend gespeichert werden', async () => {
    reset();
    const c = await client(); await c.load(fixture.stammdaten, changed());
    beforeRequest = async (_url, options) => { if (options.method === 'PATCH') throw Error('Synthetisch: Verbindung fehlt'); };
    await c.apply();
    assert.match(c.message, /Schreiben fehlgeschlagen/); assert.equal(c.successes.length, 0);
    assert.deepEqual(stored(), fixture.stammdaten); assert.deepEqual(applied(), []);
    beforeRequest = null; await c.apply();
    assert.deepEqual(stored(), changed()); assert.equal(applied().length, 1);
  });

  await t.test('HTTP 200 mit einer HTML-Anmeldeseite darf weder Speichern noch Importprotokoll bestätigen', async () => {
    for (const [route, method] of [[casePath + '/stammdaten', 'PATCH'], [ledgerPath, 'GET'], [ledgerPath, 'PUT']]) {
      reset();
      const c = await client();
      const invalidResponse = async (url, options) => url === route && (options.method || 'GET') === method
        ? new Response('<html>Synthetische Anmeldeseite</html>', { status: 200, headers: { 'content-type': 'text/html' } }) : null;
      if (method === 'GET') beforeRequest = invalidResponse;
      await c.load(fixture.stammdaten, changed());
      if (method === 'GET') assert.match(c.nodes.modalBody.innerHTML, /Ungültige Serverantwort/);
      beforeRequest = invalidResponse;
      await c.apply(); beforeRequest = null;
      assert.equal(c.successes.length, 0, `${method} ${route}: falsche Erfolgsbestätigung`);
      assert.match(c.message, /Schreiben fehlgeschlagen/); assert.match(c.message, /Serverantwort/);
      assert.deepEqual(applied(), []);
      assert.deepEqual(stored(), method === 'PUT' ? changed() : fixture.stammdaten);
    }
  });

  await t.test('Verlorene Antwort nach Commit: gespeicherte Daten bleiben; das getrennte Ledger bleibt unbestätigt', async () => {
    reset();
    const c = await client(), packet = await c.load(fixture.stammdaten, changed());
    afterResponse = async (_url, options, response) => {
      if (options.method === 'PATCH') { assert.equal(response.status, 200); await response.arrayBuffer(); throw Error('Synthetisch: Antwort verloren'); }
    };
    await c.apply(); afterResponse = null;
    assert.match(c.message, /Schreiben fehlgeschlagen/); assert.equal(c.successes.length, 0);
    assert.deepEqual(stored(), changed()); assert.deepEqual(applied(), []);
    const reopened = reopen(); assert.deepEqual(reopened.data, changed()); assert.deepEqual(reopened.ledger.applied, {});
    const again = await client(); await again.importText(packet); await again.apply();
    assert.equal(again.rows[0].status, 'gleich');
    assert.equal(again.calls.filter(call => call.method === 'PATCH').length, 0);
  });

  await t.test('Fehler beim Ledger-Schreiben wird gemeldet; der bereits gespeicherte Fall bleibt erhalten', async () => {
    reset();
    const c = await client(); await c.load(fixture.stammdaten, changed());
    beforeRequest = async (url, options) => {
      if (url === ledgerPath && options.method === 'PUT') throw Error('Synthetisch: Ledger nicht erreichbar');
    };
    await c.apply(); beforeRequest = null;
    assert.match(c.message, /Schreiben fehlgeschlagen/); assert.equal(c.successes.length, 0);
    assert.deepEqual(stored(), changed()); assert.deepEqual(applied(), []);
  });

  await t.test('Dokumentationsanlage durchläuft den Import und liegt bytegleich zentral vor; Wiederholung dupliziert nichts', async () => {
    reset();
    const entry = { id: 'sf-field-note', title: 'Synthetischer Hausbesuch', photos: [] };
    db.prepare('INSERT INTO case_doku_entries (id,case_id,data_json,updated_by) VALUES (?,?,?,1)')
      .run(entry.id, fixture.caseId, JSON.stringify(entry));
    const pdf = await PDFDocument.create(); pdf.addPage([72, 72]); const bytes = Buffer.from(await pdf.save());
    const before = { ...structuredClone(fixture.stammdaten), documentationEntries: [entry] };
    const offline = structuredClone(before);
    offline.documentationEntries[0].photos.push({ id: 'sf-field-attachment', filename: 'Synthetisch.pdf',
      mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + bytes.toString('base64') });
    const c = await client(), packet = await c.load(before, offline); await c.apply();
    assert.equal(c.errors.length, 0); assert.equal(c.successes.length, 1);
    const note = JSON.parse(db.prepare('SELECT data_json FROM case_doku_entries WHERE id=?').get(entry.id).data_json);
    assert.equal(note.photos.length, 1);
    const response = await request(casePath + `/doku-entries/${entry.id}/photos/${note.photos[0].id}`);
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    const again = await client(); await again.importText(packet); await again.apply();
    assert.equal(again.calls.filter(call => call.method === 'POST').length, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM doc_files WHERE case_id=?').get(fixture.caseId).n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM doc_module_import WHERE quelle='aussendienst-anlage'").get().n, 1);
  });
  await require('./helpers/server-first-ledger-regression.cjs')(t, { db, reset, client, stored, ledger });
  await require('./helpers/server-first-attachment-scope.cjs')(t, { db, reset, request, setActor: value => { actor = value; } });
  await require('./helpers/server-first-offline-values.cjs')(t, { db, reset, client, stored });
  await require('./helpers/server-first-offline-lists.cjs')(t, { db, reset, client, stored });
  await require('./helpers/server-first-kontaktmonitor.cjs')(t, { db, reset, request, ledger, setActor: value => { actor = value; } });
  await require('./helpers/server-first-plan-attachments.cjs')(t, { db, reset, request, setActor: value => { actor = value; } });
  await require('./helpers/server-first-plan-records.cjs')(t, { db, reset, request, setActor: value => { actor = value; } });
});
