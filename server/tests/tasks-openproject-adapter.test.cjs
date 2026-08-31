/* OpenProject-Adapter (PLAN-AUFGABEN-SYNC, Etappe 2) gegen eine nachgebaute APIv3.
 *
 * Geprüft wird der Vertrag, auf den sich Dispatch und Runner verlassen: einheitliches
 * Aufgabenformat, lockVersion als etag, 409 wird zur verständlichen Konfliktmeldung,
 * Statuszuordnung entscheidet "erledigt", und die Projekt-Kennung weicht bei Kollision aus.
 */
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'op-adapter-'));
process.env.DB_PATH = path.join(temp, 'test.sqlite3');
process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
process.env.ENCRYPTION_KEY = '11'.repeat(32);

const cryptoHelper = require('../src/security/crypto');
const op = require('../src/integrations/tasks/openproject');

function mockServer() {
  const state = {
    patches: [],
    conflictOnce: false,
    createBodies: [],
    createdProjects: [],
    takenIdentifiers: new Set(['mustermann-max'])
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/hal+json' }); res.end(JSON.stringify(obj)); };
      const url = req.url.split('?')[0];
      if (url === '/api/v3/users/me') return json(200, { name: 'Büro Betreuung' });
      if (url === '/api/v3/projects' && req.method === 'GET') {
        return json(200, { _embedded: { elements: [{ id: 7, name: 'Fall Mustermann' }, { id: 9, name: 'Verwaltung' }] } });
      }
      if (url === '/api/v3/projects' && req.method === 'POST') {
        const b = JSON.parse(body);
        state.createdProjects.push(b);
        if (state.takenIdentifiers.has(b.identifier)) {
          return json(422, { message: 'identifier ist bereits vergeben.' });
        }
        state.takenIdentifiers.add(b.identifier);
        return json(201, { id: 31, name: b.name });
      }
      if (url === '/api/v3/statuses') {
        return json(200, { _embedded: { elements: [
          { id: 1, name: 'Neu', isClosed: false },
          { id: 12, name: 'Abgeschlossen', isClosed: true }
        ] } });
      }
      if (url === '/api/v3/projects/7/work_packages' && req.method === 'GET') {
        return json(200, { _embedded: { elements: [
          { id: 101, subject: 'Antrag stellen', description: { raw: 'Formular X' }, dueDate: '2026-08-10', lockVersion: 4,
            _links: { status: { href: '/api/v3/statuses/1', title: 'Neu' }, priority: { title: 'Hoch' } } },
          { id: 102, subject: 'Alt erledigt', description: { raw: '' }, dueDate: null, lockVersion: 9,
            _links: { status: { href: '/api/v3/statuses/12', title: 'Abgeschlossen' }, priority: { title: 'Normal' } } }
        ] } });
      }
      if (url === '/api/v3/work_packages/101' && req.method === 'GET') {
        return json(200, { id: 101, subject: 'Antrag stellen', lockVersion: 4, _links: { status: { href: '/api/v3/statuses/1' } } });
      }
      if (url === '/api/v3/work_packages/101' && req.method === 'PATCH') {
        state.patches.push(JSON.parse(body));
        if (state.conflictOnce) { state.conflictOnce = false; return json(409, { message: 'Update conflict' }); }
        return json(200, { id: 101, lockVersion: 5 });
      }
      if (url === '/api/v3/projects/7/work_packages' && req.method === 'POST') {
        const b = JSON.parse(body);
        state.createBodies.push(b);
        if (!b._links || !b._links.type) return json(422, { message: 'Type ist kein gültiger Wert.' });
        return json(201, { id: 555 });
      }
      if (url === '/api/v3/types') return json(200, { _embedded: { elements: [{ id: 3, name: 'Task' }] } });
      return json(404, { message: 'not found ' + url });
    });
  });
  return { server, state };
}

function connFor(port) {
  return {
    id: 'conn-op-test', provider: 'openproject',
    calendar_url: `http://127.0.0.1:${port}`,
    password_encrypted: cryptoHelper.encrypt('op-token'),
    task_list_id: '7', task_status_open: '', task_status_done: ''
  };
}

test('OpenProject-Adapter: Vertrag der Dispatch-Schicht', async (t) => {
  const { server, state } = mockServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const conn = connFor(port);
  t.after(() => server.close());

  await t.test('testConnection meldet den Anzeigenamen', async () => {
    const r = await op.testConnection(conn);
    assert.equal(r.ok, true);
    assert.equal(r.displayName, 'Büro Betreuung');
  });

  await t.test('Projekte werden zu Aufgabenlisten', async () => {
    const lists = await op.listTaskLists(conn);
    assert.deepEqual(lists.map((l) => l.remoteId), ['7', '9']);
    assert.equal(lists[0].name, 'Fall Mustermann');
  });

  await t.test('fetchTodos: lockVersion=etag, geschlossener Status=erledigt, Priorität übersetzt', async () => {
    const todos = await op.fetchTodos(conn);
    assert.equal(todos.length, 2);
    const [a, b] = todos;
    assert.equal(a.uid, '101');
    assert.equal(a.etag, '4');
    assert.equal(a.done, false);
    assert.equal(a.priority, 'high');
    assert.equal(a.dueAt, '2026-08-10');
    assert.equal(b.done, true, 'isClosed-Status muss als erledigt ankommen.');
  });

  await t.test('updateTodo: Statuswechsel nur bei echtem offen/erledigt-Wechsel', async () => {
    await op.pushTodo(conn, { uid: '101', title: 'Antrag stellen', description: 'Formular X', dueAt: '2026-08-10', done: false });
    const ohneWechsel = state.patches.at(-1);
    assert.equal(ohneWechsel._links, undefined, 'Ohne Statuswechsel darf kein Status gesendet werden (Zwischenstatus bliebe sonst nicht stehen).');
    await op.pushTodo(conn, { uid: '101', title: 'Antrag stellen', description: '', dueAt: '', done: true });
    const mitWechsel = state.patches.at(-1);
    assert.equal(mitWechsel._links.status.href, '/api/v3/statuses/12');
    assert.equal(mitWechsel.dueDate, null, 'Leeres Datum muss als null gesendet werden.');
  });

  await t.test('409 wird zur deutschen Konfliktmeldung', async () => {
    state.conflictOnce = true;
    await assert.rejects(
      () => op.pushTodo(conn, { uid: '101', title: 'X', description: '', dueAt: '', done: false }),
      (err) => err.code === 'CONFLICT' && /Konflikt \(409\)/.test(err.message)
    );
  });

  await t.test('createTodo reicht bei 422 den ersten Typ nach', async () => {
    const r = await op.pushTodo(conn, { title: 'Neue Aufgabe', description: '', dueAt: '2026-09-01', done: false, calendarRef: '7' });
    assert.equal(r.uid, '555');
    assert.equal(state.createBodies.length, 2, 'Erst ohne Typ, nach 422 mit Typ.');
    assert.equal(state.createBodies[1]._links.type.href, '/api/v3/types/3');
  });

  await t.test('createProject weicht bei vergebener Kennung aus', async () => {
    const p = await op.createProject(conn, 'Mustermann, Max');
    assert.equal(p.remoteId, '31');
    const identifiers = state.createdProjects.map((x) => x.identifier);
    assert.ok(identifiers.includes('mustermann-max'), 'Erster Versuch mit der naheliegenden Kennung.');
    assert.ok(identifiers.includes('mustermann-max-2'), 'Kollision muss mit -2 ausweichen.');
  });
});

test('projectIdentifier: URL-tauglich, Umlaute transliteriert', () => {
  assert.equal(op.projectIdentifier('Müller, Jörg (Fall 12)', 1), 'mueller-joerg-fall-12');
  assert.equal(op.projectIdentifier('123', 1), 'f-123', 'Muss mit einem Buchstaben beginnen.');
  assert.equal(op.projectIdentifier('Meier', 3), 'meier-3');
});

test('priorityFromTitle: deutsche und englische Instanzen', () => {
  assert.equal(op._internal.priorityFromTitle('Immediate'), 'high');
  assert.equal(op._internal.priorityFromTitle('Hoch'), 'high');
  assert.equal(op._internal.priorityFromTitle('Niedrig'), 'low');
  assert.equal(op._internal.priorityFromTitle('Normal'), 'normal');
});
