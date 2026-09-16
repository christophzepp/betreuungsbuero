'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'case-deletion-'));
process.env.RUNTIME_ROOT = temp;
process.env.DB_PATH = path.join(temp, 'db.sqlite3');
process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
const db = require('../src/database');
require('../src/modules/documents/schema').ensure(db);
const { createDocumentStorage, joinRoot } = require('../src/modules/documents/storage');
const { createCaseDeletion } = require('../src/modules/cases/delete-case');
const dataRoot = process.env.DOCUMENTS_DATA_ROOT;
const storageRoot = path.join(temp, 'documents');
const storage = createDocumentStorage({ db, dataRoot, readConfig: () => ({ storageRoot }) });
const deletion = createCaseDeletion({ db, dataRoot, storage });
const all = { calendar: true, tasks: true, deadlines: true, followups: true };
const none = { calendar: false, tasks: false, deadlines: false, followups: false };
let server, base;

function insert(table, values) {
  const complete = { ...values };
  for (const col of db.prepare(`PRAGMA table_info(${table})`).all()) {
    if (col.notnull && col.dflt_value == null && !(col.name in complete)) complete[col.name] = /INT/.test(col.type) ? 0 : /BLOB/.test(col.type) ? Buffer.from('test') : '';
  }
  const keys = Object.keys(complete);
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => complete[k]));
}
function write(file, content = 'Inhalt') { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; }
function caseRow(id, archived = 0) {
  insert('cases', { id, label: 'Gleich, Greta', stammdaten_json: JSON.stringify({ person: { lastName: 'Gleich', firstName: 'Greta', birthDate: id } }), owner_user_id: 1, archived });
  storage.caseRootInfo(id, true);
  return db.prepare('SELECT * FROM cases WHERE id=?').get(id);
}
function fileRow(id, caseId, folder = '', deleted = false) {
  const placed = storage.placeBuffer({ id, name: id + '.txt', area: 'case', case_id: caseId, folder_id: folder }, Buffer.from(id));
  insert('doc_files', { id, name: placed.name, area: 'case', case_id: caseId, storage_relpath: placed.storageRelpath, deleted_at: deleted ? '2026-09-01' : '' });
  return { row: db.prepare('SELECT * FROM doc_files WHERE id=?').get(id), path: placed.filePath };
}
function related(id) {
  insert('calendar_events', { id: id + '-event', title: 'Termin', case_id: id, case_label: 'Gleich, Greta' });
  for (const type of ['task', 'deadline', 'followup']) insert('todos', { id: id + '-' + type, title: type, item_type: type, case_id: id, case_label: 'Gleich, Greta', description: 'Notiz', done: type === 'task' ? 1 : 0 });
}
async function request(id, options = all, admin = true) {
  const res = await fetch(base + '/api/cases/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'content-type': 'application/json', 'x-admin': admin ? '1' : '0' }, body: JSON.stringify(options == null ? {} : { deleteRelated: options }) });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  insert('users', { id: 1, username: 'admin', password_hash: 'x', is_admin: 1 });
  insert('office_json', { key: 'documents_config', data_json: JSON.stringify({ storageLayout: 'real-folders-v1', storageRoot }) });
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { userId: 1, username: 'admin', isAdmin: req.get('x-admin') === '1', allowCaseManagement: true, canViewCases: true, canEditCases: true }; next(); });
  app.use('/api/cases', require('../src/modules/cases/routes'));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(temp, { recursive: true, force: true }); });

test('only admins can delete; an explicit choice is required; missing cases return 404', async () => {
  caseRow('authorization');
  assert.equal((await request('authorization', all, false)).status, 403);
  assert.equal((await request('authorization', null)).status, 400);
  assert.equal((await request('authorization', { ...all, tasks: 'true' })).status, 400);
  assert.ok(db.prepare('SELECT 1 FROM cases WHERE id=?').get('authorization'));
  assert.equal((await request('missing')).status, 404);
});

test('populated archived case: all owned rows and files disappear, same-name case and office data remain', async () => {
  const id = 'full'; caseRow(id, 1); caseRow('unrelated'); related(id); related('unrelated');
  const main = fileRow('full-file', id), other = fileRow('other-file', 'unrelated');
  const versionPath = write(path.join(storageRoot, 'Büroorganisation', '_Verwaltung & Sicherungen', '_Technik', 'Versionen', 'full-version.txt'));
  const versionSidecar = write(storage.sidecarPath(versionPath, main.row.id), '{"caseId":"full"}');
  insert('doc_versions', { id: 'full-version', file_id: main.row.id, name: 'v.txt', storage_relpath: path.relative(storageRoot, versionPath) });
  const legacy = write(path.join(dataRoot, 'files', 'full-file.txt'));
  const oldDoc = write(path.join(dataRoot, 'case-documents', id, 'legacy-document'));
  const photo = write(path.join(dataRoot, 'case-doku-photos', id, 'legacy-photo'));
  const eventAttachment = write(path.join(dataRoot, 'calendar-event-attachments', id + '-event', 'event-attachment'));
  const todoAttachment = write(path.join(dataRoot, 'todo-attachments', id + '-task', 'todo-attachment'));
  const inbox = write(path.join(dataRoot, 'inbox-documents', 'full-inbox'));
  insert('calendar_event_attachments', { id: 'event-attachment', event_id: id + '-event' });
  insert('todo_attachments', { id: 'todo-attachment', todo_id: id + '-task' });
  for (const table of ['case_contacts', 'case_doku_entries', 'case_documents', 'bank_payment_orders', 'bank_recurring_payments']) insert(table, { id: table + '-full', case_id: id });
  insert('case_reports', { case_id: id, report_id: 'initial' });
  insert('inbox_documents', { id: 'full-inbox', case_id: id });
  insert('betreuung_overview_entries', { case_id: id, period_start: '2026-01-01' });
  insert('case_access', { case_id: id, user_id: 1 });
  insert('doc_annotations', { id: 'annotation', file_id: main.row.id });
  insert('doc_text', { file_id: main.row.id, page: 1, text: 'Suchbarer Fallinhalt' });
  insert('doc_links', { module: 'case-document', owner_id: 'case_documents-full', file_id: main.row.id });
  insert('doc_module_import', { quelle: 'case-document', quell_id: 'case_documents-full', file_id: main.row.id });
  insert('outgoing_invoices', { id: 'invoice', case_id: id, case_label: 'Gleich, Greta', verwendungszweck: 'Honorarforderung' });
  insert('doc_import_jobs', { id: 'import', mount_id: 'mount', target_json: JSON.stringify({ area: 'case', caseId: id }) });
  const result = await request(id);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.warnings, []);
  for (const file of [main.path, versionPath, versionSidecar, legacy, oldDoc, photo, eventAttachment, todoAttachment, inbox]) assert.equal(fs.existsSync(file), false, file);
  for (const table of ['cases', 'doc_files', 'doc_versions', 'doc_annotations', 'calendar_events', 'todos', 'doc_import_jobs']) {
    const column = table === 'doc_versions' || table === 'doc_annotations' ? 'file_id' : table === 'cases' || table === 'doc_import_jobs' ? 'id' : 'case_id';
    const value = column === 'file_id' ? main.row.id : table === 'doc_import_jobs' ? 'import' : id;
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE ${column}=?`).get(value).n, 0, table);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM doc_text WHERE file_id=?').get(main.row.id).n, 0);
  assert.ok(fs.existsSync(other.path));
  assert.ok(db.prepare('SELECT * FROM calendar_events WHERE case_id=?').get('unrelated'));
  assert.equal(db.prepare('SELECT case_id FROM outgoing_invoices WHERE id=?').get('invoice').case_id, '');
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='case.delete' AND target_id=?").get(id));
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

for (let mask = 0; mask < 16; mask++) test('independent related-entry selection ' + mask, async () => {
  const id = 'options-' + mask; caseRow(id); related(id);
  const options = Object.fromEntries(Object.keys(all).map((key, index) => [key, !!(mask & (1 << index))]));
  assert.equal((await request(id, options)).status, 200);
  for (const [table, suffix, key] of [['calendar_events', 'event', 'calendar'], ['todos', 'task', 'tasks'], ['todos', 'deadline', 'deadlines'], ['todos', 'followup', 'followups']]) {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id + '-' + suffix);
    assert.equal(!!row, !options[key], key);
    if (row) { assert.equal(row.case_id, ''); assert.equal(row.case_label, ''); assert.match(row.description, /Ehemaliger Fall: Gleich, Greta/); }
  }
});

test('retained task/event/follow-up attachments and versions remain readable outside the deleted case folder', async () => {
  const id = 'retain'; caseRow(id); related(id);
  const attachment = fileRow('retain-attachment', id);
  const followup = fileRow('retain-followup', id);
  const legacyPath = write(path.join(dataRoot, 'todo-attachments', id + '-task', 'legacy'));
  const version = storage.copyToManagement({ ...attachment.row, id: 'retain-version' }, 'Versionen', attachment.row.id, 'alt.txt');
  insert('doc_versions', { id: 'retain-version', file_id: attachment.row.id, name: 'alt.txt', storage_relpath: version.storageRelpath });
  insert('todo_attachments', { id: 'retained-att', todo_id: id + '-task' });
  insert('calendar_event_attachments', { id: 'retained-event-att', event_id: id + '-event' });
  insert('doc_links', { module: 'todo-attachment', owner_id: id + '-task', slot: 'retained-att', file_id: attachment.row.id });
  insert('doc_links', { module: 'calendar-attachment', owner_id: id + '-event', slot: 'retained-event-att', file_id: attachment.row.id });
  db.prepare("UPDATE todos SET source_type='document',source_id=? WHERE id=?").run(followup.row.id, id + '-followup');
  const result = await request(id, none);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  for (const original of [attachment, followup]) {
    const row = db.prepare('SELECT * FROM doc_files WHERE id=?').get(original.row.id);
    assert.equal(row.area, 'office'); assert.equal(row.case_id, '');
    assert.equal(fs.readFileSync(storage.findBlobPath(row), 'utf8'), original.row.id);
    assert.equal(fs.existsSync(original.path), false);
  }
  const v = db.prepare('SELECT * FROM doc_versions WHERE id=?').get('retain-version');
  assert.equal(fs.readFileSync(joinRoot(storageRoot, v.storage_relpath), 'utf8'), 'retain-attachment');
  assert.ok(fs.existsSync(legacyPath));
  assert.equal(db.prepare('SELECT count(*) n FROM doc_links WHERE file_id=?').get(attachment.row.id).n, 2);
  assert.equal(db.prepare('SELECT source_id FROM todos WHERE id=?').get(id + '-followup').source_id, followup.row.id);
});

test('deadlines stored only in the case JSON survive, including metadata, completion and repetition', async () => {
  const id = 'list-deadlines'; caseRow(id); related(id);
  const deadlines = [
    { id: 'list-only', title: 'Anfangsbericht', dueDate: '2026-12-16', routing: 'none', priority: 'high', institution: 'Amtsgericht', note: 'Wichtige Notiz', category: 'anfangsbericht', formName: 'Bericht', baseDate: '2026-09-16', interval: 'quarterly' },
    { id: 'finished', title: 'Erledigte Frist', status: 'erledigt', dueDate: '' },
    { id: 'mirrored', title: 'Schon im Kalender', todoId: id + '-deadline', dueDate: '2026-12-01' }
  ];
  db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify({ fristen: deadlines }), id);
  assert.equal((await request(id, { ...all, deadlines: false })).status, 200);
  const kept = db.prepare("SELECT * FROM todos WHERE source_type='retained-deadline'").all();
  assert.equal(kept.length, 3, 'An existing deadline task is reused instead of duplicated');
  const first = kept.find(item => item.title === 'Anfangsbericht');
  assert.equal(first.case_id, ''); assert.equal(first.priority, 'high');
  assert.equal(first.due_at, '2026-12-16');
  assert.deepEqual(JSON.parse(first.recurrence_rule), { freq: 'monthly', interval: 3, until: '' });
  const metadata = JSON.parse(first.source_ref).deadline;
  for (const field of ['title', 'category', 'institution', 'formName', 'baseDate', 'note']) assert.equal(metadata[field], deadlines[0][field]);
  assert.equal(kept.find(item => item.title === 'Erledigte Frist').done, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM todos WHERE case_id=?').get(id).n, 0);
});

test('selected deletion also removes list-only deadlines', async () => {
  const id = 'remove-list-deadline'; caseRow(id);
  db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify({ fristen: [{ title: 'Wirklich löschen' }] }), id);
  assert.equal((await request(id, all)).status, 200);
  assert.equal(db.prepare('SELECT count(*) n FROM todos WHERE title=?').get('Wirklich löschen').n, 0);
});

test('dedicated case banking data is deleted while shared banking data remains', async () => {
  const id = 'bank-case'; caseRow(id);
  insert('bank_connections', { id: 'owned-bank', scope: 'case', case_id: id });
  insert('bank_accounts_discovered', { id: 'owned-account', connection_id: 'owned-bank' });
  insert('bank_transactions', { id: 'owned-transaction', connection_id: 'owned-bank', dedupe_hash: 'owned-transaction' });
  insert('bank_connections', { id: 'shared-bank', scope: 'office' });
  insert('bank_accounts_discovered', { id: 'shared-account', connection_id: 'shared-bank', manual_case_id: id });
  assert.equal((await request(id)).status, 200);
  assert.equal(db.prepare('SELECT 1 FROM bank_connections WHERE id=?').get('owned-bank'), undefined);
  assert.equal(db.prepare('SELECT 1 FROM bank_transactions WHERE id=?').get('owned-transaction'), undefined);
  const shared = db.prepare('SELECT * FROM bank_accounts_discovered WHERE id=?').get('shared-account');
  assert.equal(shared.manual_case_id, null); assert.equal(shared.case_assignment_mode, 'manual');
});

test('case intake bytes, OCR, mail assignments and case-specific office records are removed without touching other cases', async () => {
  const id = 'office-records'; caseRow(id);
  insert('office_json', { key: 'case_intakes', data_json: JSON.stringify({ entries: [{ id: 'draft', state: { targetCaseId: id } }, { id: 'other-draft', state: { targetCaseId: 'unrelated' } }] }) });
  insert('intake_files', { id: 'intake-file', draft_id: 'draft', data: Buffer.from('private') });
  insert('case_intake_ocr', { draft_id: 'draft', payload_json: '["private"]' });
  insert('office_json', { key: 'mailx_case_links', data_json: JSON.stringify({ one: { caseId: id }, two: { caseId: 'unrelated' } }) });
  insert('office_json', { key: 'ai_chats', data_json: JSON.stringify({ chats: [{ id: 'explicit', caseId: id }, { id: 'ambiguous', caseLabel: 'Gleich, Greta' }, { id: 'foreign', caseId: 'unrelated' }] }) });
  assert.equal((await request(id)).status, 200);
  assert.equal(db.prepare('SELECT 1 FROM intake_files WHERE draft_id=?').get('draft'), undefined);
  assert.equal(db.prepare('SELECT 1 FROM case_intake_ocr WHERE draft_id=?').get('draft'), undefined);
  const json = key => JSON.parse(db.prepare('SELECT data_json FROM office_json WHERE key=?').get(key).data_json);
  assert.deepEqual(json('case_intakes').entries.map(entry => entry.id), ['other-draft']);
  assert.deepEqual(json('mailx_case_links'), { two: { caseId: 'unrelated' } });
  assert.deepEqual(json('ai_chats').chats.map(entry => entry.id), ['ambiguous', 'foreign']);
});

test('a file move failure restores already moved files without deleting database rows', t => {
  const row = caseRow('move-failure'); const file = fileRow('move-failure-file', row.id);
  const extra = write(path.join(dataRoot, 'case-documents', row.id, 'old-file'));
  const original = fs.renameSync; let count = 0;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (String(target).includes('.ablage-case-delete-') && ++count === 2) throw new Error('simulated disk failure');
    return original(source, target);
  });
  assert.throws(() => deletion.remove(row, all), /simulated disk failure/);
  assert.ok(db.prepare('SELECT 1 FROM cases WHERE id=?').get(row.id));
  assert.equal(fs.readFileSync(file.path, 'utf8'), file.row.id); assert.equal(fs.readFileSync(extra, 'utf8'), 'Inhalt');
});

test('database failure rolls back removed files, retained attachment copies, and rows', () => {
  const id = 'rollback'; const row = caseRow(id); related(id); const file = fileRow('rollback-file', id);
  insert('doc_links', { module: 'todo-attachment', owner_id: id + '-task', slot: 'attachment', file_id: file.row.id });
  db.exec("CREATE TRIGGER reject_test_delete BEFORE DELETE ON cases WHEN OLD.id='rollback' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(() => deletion.remove(row, none), /test failure/);
  db.exec('DROP TRIGGER reject_test_delete');
  assert.equal(fs.readFileSync(file.path, 'utf8'), file.row.id);
  assert.equal(db.prepare('SELECT case_id FROM doc_files WHERE id=?').get(file.row.id).case_id, id);
  assert.equal(db.prepare('SELECT case_id FROM todos WHERE id=?').get(id + '-task').case_id, id);
  assert.equal(fs.readdirSync(path.join(dataRoot, 'case-deletions')).length, 0);
});

test('symlink and shared-root protection never removes unrelated files', () => {
  const id = 'symlink'; const row = caseRow(id); const info = storage.caseRootInfo(id, false);
  const root = joinRoot(storageRoot, info.storageRelpath);
  fs.rmSync(root, { recursive: true });
  const outside = path.join(temp, 'outside'); const content = write(path.join(outside, 'keep.txt'));
  fs.symlinkSync(outside, root, 'dir');
  assert.throws(() => deletion.remove(row, all), /symbolische Verknüpfung/);
  assert.equal(fs.readFileSync(content, 'utf8'), 'Inhalt');
  fs.unlinkSync(root);
});

test('a corrupt document path cannot turn file deletion into deleting an entire office folder', () => {
  const row = caseRow('bad-file-path');
  const officeFile = write(path.join(storageRoot, 'Büroorganisation', 'unrelated.txt'));
  insert('doc_files', { id: 'bad-file-path-doc', case_id: row.id, area: 'case', name: 'bad.txt', storage_relpath: 'Büroorganisation' });
  assert.throws(() => deletion.remove(row, all), /Dateiverweis zeigt auf einen Ordner/);
  assert.equal(fs.readFileSync(officeFile, 'utf8'), 'Inhalt');
  assert.ok(db.prepare('SELECT 1 FROM cases WHERE id=?').get(row.id));
});

test('post-commit file cleanup failure is reported and recoverable', t => {
  const row = caseRow('recover'); const file = fileRow('recover-file', row.id);
  const original = fs.rmSync;
  const mock = t.mock.method(fs, 'rmSync', (target, options) => {
    if (String(target).includes('.ablage-case-delete-')) throw new Error('simulated busy file');
    return original(target, options);
  });
  const result = deletion.remove(row, all);
  assert.equal(result.cleanupPending, true);
  assert.equal(fs.existsSync(file.path), false);
  assert.ok(fs.readdirSync(path.join(dataRoot, 'case-deletions')).length);
  mock.mock.restore(); deletion.recover();
  assert.equal(fs.readdirSync(path.join(dataRoot, 'case-deletions')).length, 0);
});
