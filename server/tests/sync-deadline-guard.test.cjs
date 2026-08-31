/* Nur-Export-Wächter für Fristen/Wiedervorlagen (PLAN-AUFGABEN-SYNC, Etappe 1;
 * Nutzerentscheidung 02.08.2026: "Aufgaben + Fristen (nur-Export)").
 *
 * Der Prüfstand fährt eine ECHTE (Wegwerf-)Datenbank hoch und ersetzt nur die Netzschicht
 * (sync.fetchTodos/pushTodo). Damit läuft exakt der produktive Runner-Code - Transaktionen,
 * Wächter, Reparatur, Journal - ohne dass irgendein Server angesprochen wird.
 */
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
process.env.DB_PATH = path.join(temp, 'test.sqlite3');
process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
process.env.ENCRYPTION_KEY = '33'.repeat(32);

const db = require('../src/database/index');
const sync = require('../src/modules/calendar/sync');
const runner = require('../src/modules/sync/runner');

const CONN_ID = 'conn-guard';
const REF = 'https://vikunja.test/dav/projects/9/';

function seedConnection(extra) {
  db.prepare('DELETE FROM calendar_connections').run();
  db.prepare(`
    INSERT INTO calendar_connections (id, provider, display_name, enabled, username, password_encrypted, todo_url, deadline_export)
    VALUES (?, 'vikunja', 'Vikunja Test', 1, 'buero', 'x', ?, ?)
  `).run(CONN_ID, REF, extra && extra.deadlineExport ? 1 : 0);
}

function seedTodo(row) {
  const base = {
    id: 'todo-' + Math.random().toString(36).slice(2, 10),
    title: '', description: '', due_at: '', start_at: '', done: 0, priority: 'normal',
    recurrence_rule: '', case_label: '', item_type: 'task', case_id: '',
    source_type: '', source_id: '', source_module: '', source_ref: '',
    source: 'local', connection_id: null, calendar_ref: '', external_uid: '', external_href: '',
    external_etag: '', owner_user_id: null, visibility: 'public'
  };
  const r = Object.assign(base, row);
  db.prepare(`
    INSERT INTO todos (id, title, description, due_at, start_at, done, priority, recurrence_rule, case_label,
      item_type, case_id, source_type, source_id, source_module, source_ref,
      source, connection_id, calendar_ref, external_uid, external_href, external_etag, owner_user_id, visibility)
    VALUES (@id, @title, @description, @due_at, @start_at, @done, @priority, @recurrence_rule, @case_label,
      @item_type, @case_id, @source_type, @source_id, @source_module, @source_ref,
      @source, @connection_id, @calendar_ref, @external_uid, @external_href, @external_etag, @owner_user_id, @visibility)
  `).run(r);
  return r;
}

function journalActions() {
  return db.prepare('SELECT action FROM sync_journal ORDER BY ts, id').all().map((r) => r.action);
}

test('Nur-Export-Wächter', async (t) => {
  const originalFetch = sync.fetchTodos;
  const originalPush = sync.pushTodo;
  t.afterEach(() => {
    sync.fetchTodos = originalFetch;
    sync.pushTodo = originalPush;
    db.prepare('DELETE FROM todos').run();
    db.prepare('DELETE FROM sync_journal').run();
  });

  await t.test('eingehende Änderung an einer Frist wird verworfen und zurückgeschrieben', async () => {
    seedConnection();
    const frist = seedTodo({
      title: 'Frist: Jahresbericht einreichen', item_type: 'deadline', due_at: '2026-09-30',
      source: 'vikunja', connection_id: CONN_ID, calendar_ref: REF,
      external_uid: 'uid-frist-1', external_href: REF + 'uid-frist-1.ics'
    });
    const pushed = [];
    sync.fetchTodos = async () => [{ uid: 'uid-frist-1', href: frist.external_href, etag: 'e2', title: 'GEÄNDERT von außen', description: '', dueAt: '2026-12-31', done: true, priority: 'normal' }];
    sync.pushTodo = async (_conn, todo) => { pushed.push(todo); return { uid: 'uid-frist-1', href: frist.external_href, calendarRef: REF }; };

    const result = await runner.syncTodos(null);
    assert.equal(result.ran, true);

    const local = db.prepare('SELECT * FROM todos WHERE id = ?').get(frist.id);
    assert.equal(local.title, 'Frist: Jahresbericht einreichen', 'Der Bürostand darf nicht überschrieben werden.');
    assert.equal(local.due_at, '2026-09-30');
    assert.equal(local.done, 0, 'Auch das Abhaken von außen wird verworfen.');
    assert.equal(pushed.length, 1, 'Der Bürostand muss zurückgeschrieben werden.');
    assert.equal(pushed[0].title, 'Frist: Jahresbericht einreichen');
    assert.ok(journalActions().includes('verworfen'), 'Das Verwerfen gehört ins Sync-Journal.');
  });

  await t.test('eine draußen gelöschte Frist wird NICHT lokal gelöscht, sondern neu exportiert', async () => {
    seedConnection();
    const frist = seedTodo({
      title: 'Frist: Widerspruch', item_type: 'deadline', due_at: '2026-08-15',
      source: 'vikunja', connection_id: CONN_ID, calendar_ref: REF,
      external_uid: 'uid-frist-2', external_href: REF + 'uid-frist-2.ics'
    });
    const pushed = [];
    sync.fetchTodos = async () => []; // draußen: weg
    sync.pushTodo = async (_conn, todo) => { pushed.push(todo); return { uid: 'uid-neu-9', href: REF + 'uid-neu-9.ics', calendarRef: REF }; };

    await runner.syncTodos(null);

    const local = db.prepare('SELECT * FROM todos WHERE id = ?').get(frist.id);
    assert.ok(local, 'Die Frist muss lokal überleben.');
    assert.equal(local.external_uid, 'uid-neu-9', 'Nach der Reparatur zeigt die Verknüpfung auf den neuen Eintrag.');
    assert.ok(pushed.length >= 1);
    assert.ok(journalActions().includes('wiederhergestellt'));
  });

  await t.test('normale Aufgaben bleiben beidseitig (der Wächter greift NICHT zu weit)', async () => {
    seedConnection();
    const task = seedTodo({
      title: 'Alt', item_type: 'task',
      source: 'vikunja', connection_id: CONN_ID, calendar_ref: REF,
      external_uid: 'uid-task-1', external_href: REF + 'uid-task-1.ics'
    });
    sync.fetchTodos = async () => [{ uid: 'uid-task-1', href: task.external_href, etag: 'e9', title: 'Neu von außen', description: '', dueAt: '', done: false, priority: 'normal' }];
    sync.pushTodo = async () => { throw new Error('Für normale Aufgaben darf keine Reparatur laufen.'); };

    await runner.syncTodos(null);
    const local = db.prepare('SELECT * FROM todos WHERE id = ?').get(task.id);
    assert.equal(local.title, 'Neu von außen', 'Normale Aufgaben übernehmen den entfernten Stand weiterhin.');
  });

  await t.test('Fristen-Export: unverknüpfte Fristen wandern in die Export-Verbindung', async () => {
    seedConnection({ deadlineExport: true });
    const frist = seedTodo({ title: 'Frist: Vermögensverzeichnis', item_type: 'deadline', due_at: '2026-10-01' });
    seedTodo({ title: 'Normale Aufgabe bleibt lokal', item_type: 'task' });
    // Zustandsbehafteter Mock: was exportiert wurde, liefert der Abruf danach auch zurück -
    // so, wie es das echte Zielsystem täte. Damit ist zugleich belegt, dass der Wächter den
    // frisch exportierten Eintrag NICHT als "draußen gelöscht" fehldeutet.
    const pushed = [];
    const remote = [];
    sync.fetchTodos = async () => remote.slice();
    sync.pushTodo = async (_conn, todo) => {
      pushed.push(todo);
      remote.push({ uid: 'uid-exp-1', href: REF + 'uid-exp-1.ics', etag: 'e1', title: todo.title, description: todo.description || '', dueAt: todo.dueAt || '', done: !!todo.done, priority: todo.priority || 'normal' });
      return { uid: 'uid-exp-1', href: REF + 'uid-exp-1.ics', calendarRef: REF };
    };

    await runner.syncTodos(null);

    const local = db.prepare('SELECT * FROM todos WHERE id = ?').get(frist.id);
    assert.equal(local.connection_id, CONN_ID, 'Die Frist muss nach dem Export verknüpft sein.');
    assert.equal(local.external_uid, 'uid-exp-1');
    assert.equal(pushed.length, 1, 'Nur die Frist wird exportiert, die normale Aufgabe nicht.');
    assert.equal(pushed[0].title, 'Frist: Vermögensverzeichnis');
    assert.ok(journalActions().includes('exportiert'));
    assert.ok(!journalActions().includes('wiederhergestellt'), 'Der eigene Export darf keine Reparatur auslösen.');
  });

  await t.test('ohne deadline_export exportiert der Lauf nichts', async () => {
    seedConnection({ deadlineExport: false });
    seedTodo({ title: 'Frist: bleibt im Büro', item_type: 'deadline', due_at: '2026-10-01' });
    sync.fetchTodos = async () => [];
    sync.pushTodo = async () => { throw new Error('Ohne Export-Haken darf nichts hinausgehen.'); };
    await runner.syncTodos(null);
    const rows = db.prepare("SELECT * FROM todos WHERE connection_id IS NOT NULL").all();
    assert.equal(rows.length, 0);
  });
});
