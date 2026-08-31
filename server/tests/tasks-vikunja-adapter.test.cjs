/* Vikunja-REST-Adapter (PLAN-AUFGABEN-SYNC, Etappe 3) gegen eine nachgebaute /api/v1.
 * Abgedeckt: die drei API-Eigenheiten (PUT=Anlegen/POST=Ändern, '0001-…'=kein Datum,
 * Seitenblättern über x-pagination-total-pages) und die Prioritätsübersetzung 0-5 ↔ drei Stufen.
 */
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vik-adapter-'));
process.env.DB_PATH = path.join(temp, 'test.sqlite3');
process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
process.env.ENCRYPTION_KEY = '22'.repeat(32);

const cryptoHelper = require('../src/security/crypto');
const vikunja = require('../src/integrations/tasks/vikunja');

function mockServer() {
  const state = { creates: [], updates: [], deletes: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const json = (code, obj, headers) => {
        res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {}));
        res.end(JSON.stringify(obj));
      };
      if (u.pathname === '/api/v1/user') return json(200, { username: 'buero', name: 'Büro' });
      if (u.pathname === '/api/v1/projects' && req.method === 'GET') {
        // Zwei Seiten, damit das Blättern nachweislich läuft.
        const page = Number(u.searchParams.get('page') || 1);
        const pages = { 1: [{ id: 1, title: 'Fall A', hex_color: '2f6fb0' }], 2: [{ id: 2, title: 'Archiv', is_archived: true }, { id: 3, title: 'Fall B' }] };
        return json(200, pages[page] || [], { 'x-pagination-total-pages': '2' });
      }
      if (u.pathname === '/api/v1/projects/1/tasks' && req.method === 'GET') {
        return json(200, [
          { id: 11, title: 'Bericht', description: 'Jahresbericht', due_date: '2026-08-20T00:00:00Z', done: false, priority: 3, updated: '2026-08-01T10:00:00Z' },
          { id: 12, title: 'Ohne Datum', description: '', due_date: '0001-01-01T00:00:00Z', done: true, priority: 0, updated: '2026-08-01T11:00:00Z' }
        ], { 'x-pagination-total-pages': '1' });
      }
      if (u.pathname === '/api/v1/projects/1/tasks' && req.method === 'PUT') {
        state.creates.push(JSON.parse(body));
        return json(201, { id: 77 });
      }
      if (u.pathname === '/api/v1/tasks/11' && req.method === 'POST') {
        state.updates.push(JSON.parse(body));
        return json(200, { id: 11 });
      }
      if (u.pathname === '/api/v1/tasks/11' && req.method === 'DELETE') {
        state.deletes.push('11');
        return json(200, {});
      }
      if (u.pathname === '/api/v1/projects' && req.method === 'PUT') {
        return json(201, { id: 40, title: JSON.parse(body).title });
      }
      return json(404, { message: 'not found ' + u.pathname });
    });
  });
  return { server, state };
}

test('Vikunja-Adapter: Vertrag der Dispatch-Schicht', async (t) => {
  const { server, state } = mockServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const conn = {
    id: 'conn-vik-test', provider: 'vikunja-api',
    calendar_url: `http://127.0.0.1:${server.address().port}`,
    password_encrypted: cryptoHelper.encrypt('vik-token'),
    task_list_id: '1'
  };
  t.after(() => server.close());

  await t.test('listTaskLists blättert und lässt Archiviertes weg', async () => {
    const lists = await vikunja.listTaskLists(conn);
    assert.deepEqual(lists.map((l) => l.remoteId), ['1', '3'], 'Seite 2 muss geholt, Archiv aussortiert werden.');
    assert.equal(lists[0].color, '#2f6fb0');
  });

  await t.test('fetchTodos: 0001-Datum wird leer, Priorität 3 wird hoch', async () => {
    const todos = await vikunja.fetchTodos(conn);
    assert.equal(todos[0].dueAt, '2026-08-20');
    assert.equal(todos[0].priority, 'high');
    assert.equal(todos[1].dueAt, '', 'Vikunjas 0001-01-01 heißt: kein Datum.');
    assert.equal(todos[1].done, true);
    assert.equal(todos[0].etag, '2026-08-01T10:00:00Z');
  });

  await t.test('Anlegen ist PUT, Ändern ist POST', async () => {
    const created = await vikunja.pushTodo(conn, { title: 'Neu', description: '', dueAt: '2026-09-01', done: false, priority: 'low' });
    assert.equal(created.uid, '77');
    assert.equal(state.creates.length, 1);
    assert.equal(state.creates[0].due_date, '2026-09-01T00:00:00Z');
    assert.equal(state.creates[0].priority, 1);

    await vikunja.pushTodo(conn, { uid: '11', title: 'Bericht', description: '', dueAt: '', done: true, priority: 'normal' });
    assert.equal(state.updates.length, 1);
    assert.equal(state.updates[0].done, true);
    assert.equal(state.updates[0].due_date, null, 'Leeres Datum muss als null gesendet werden.');
  });

  await t.test('deleteRemoteTodo und createProject', async () => {
    await vikunja.deleteRemoteTodo(conn, '11');
    assert.deepEqual(state.deletes, ['11']);
    const p = await vikunja.createProject(conn, 'Fall C');
    assert.equal(p.remoteId, '40');
  });
});

test('Prioritätsübersetzung ist in beide Richtungen stimmig', () => {
  const { priorityFromVikunja, priorityToVikunja } = vikunja._internal;
  assert.equal(priorityFromVikunja(5), 'high');
  assert.equal(priorityFromVikunja(3), 'high');
  assert.equal(priorityFromVikunja(2), 'normal');
  assert.equal(priorityFromVikunja(1), 'low');
  assert.equal(priorityFromVikunja(0), 'normal');
  assert.equal(priorityToVikunja('high'), 3);
  assert.equal(priorityToVikunja('low'), 1);
  assert.equal(priorityToVikunja('normal'), 0);
});
