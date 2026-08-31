'use strict';

/*
 * Isolierter Vertragstest für gleichnamige Fälle. Eigene SQLite-Datei,
 * eigener Dokumentenbaum und listen(0); Produktivdaten werden nicht geöffnet.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'case-assignment-routes-'));
  const dbPath = path.join(temp, 'fixture.sqlite3');
  const dataRoot = path.join(temp, 'data');
  const storageRoot = path.join(temp, 'Dokumentenspeicher');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(storageRoot, { recursive: true });
  process.env.DB_PATH = dbPath;
  process.env.DOCUMENTS_DATA_ROOT = dataRoot;

  const originalLog = console.log;
  let db;
  try {
    console.log = (...args) => {
      if (!String(args[0] || '').startsWith('[Fallrechte] Kein Admin-Konto gefunden')) {
        originalLog(...args);
      }
    };
    db = require('../src/database/index');
  } finally {
    console.log = originalLog;
  }

  db.prepare(`
    INSERT INTO users
      (id,username,password_hash,display_name,allow_local,is_admin)
    VALUES (?,?,?,?,1,0)
  `).run(1, 'owner-a', 'x', 'Owner A');
  db.prepare(`
    INSERT INTO users
      (id,username,password_hash,display_name,allow_local,is_admin)
    VALUES (?,?,?,?,1,0)
  `).run(2, 'owner-b', 'x', 'Owner B');

  const insertCase = db.prepare(`
    INSERT INTO cases
      (id,label,stammdaten_json,owner_user_id,archived)
    VALUES (?,?,?,?,0)
  `);
  insertCase.run(
    'case-a',
    'Doppelt, Dana',
    JSON.stringify({ person: { lastName: 'Doppelt', firstName: 'Dana', birthDate: '1970-01-01' } }),
    1
  );
  insertCase.run(
    'case-b',
    'Doppelt, Dana',
    JSON.stringify({ person: { lastName: 'Doppelt', firstName: 'Dana', birthDate: '1980-02-02' } }),
    2
  );
  insertCase.run(
    'case-unique',
    'Eindeutig, Erika',
    JSON.stringify({ person: { lastName: 'Eindeutig', firstName: 'Erika', birthDate: '1990-03-03' } }),
    1
  );
  const fallSicht = require('../src/modules/cases/case-visibility');
  const viewAllWithoutWriteGrant = {
    userId: 1,
    isAdmin: false,
    canViewAllCases: true
  };
  assert.equal(fallSicht.darfSehen(viewAllWithoutWriteGrant, 'case-b'), true);
  assert.equal(fallSicht.darfBearbeiten(viewAllWithoutWriteGrant, 'case-b'), false,
    'Das reine Recht „alle Fälle sehen“ darf keine fremde Schreibfreigabe erzeugen.');
  db.prepare(`
    INSERT INTO office_json (key,data_json,updated_by)
    VALUES ('documents_config',?,1)
  `).run(JSON.stringify({ storageLayout: 'real-folders-v1', storageRoot }));

  const inboxColumns = new Set(
    db.prepare('PRAGMA table_info(inbox_documents)').all().map((column) => column.name)
  );
  const eventColumns = new Set(
    db.prepare('PRAGMA table_info(calendar_events)').all().map((column) => column.name)
  );
  assert.ok(inboxColumns.has('case_id'));
  assert.ok(eventColumns.has('case_id'));

  // Die DB-Schicht hält auch noch nicht umgestellte Einfügepfade kompatibel:
  // genau ein Label wird nachgezogen, zwei identische Labels bleiben leer.
  db.prepare(`
    INSERT INTO inbox_documents
      (id,file_name,mime_type,size,case_label,inbox_date,received_date)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    'inbox-unique-legacy', 'Alt-eindeutig.txt', 'text/plain', 0,
    'Eindeutig, Erika', '2026-07-01', '2026-07-01'
  );
  assert.equal(
    db.prepare('SELECT case_id FROM inbox_documents WHERE id=?').get('inbox-unique-legacy').case_id,
    'case-unique'
  );
  db.prepare(`
    INSERT INTO inbox_documents
      (id,file_name,mime_type,size,case_label,inbox_date,received_date)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    'inbox-ambiguous-legacy', 'Alt-mehrdeutig.txt', 'text/plain', 0,
    'Doppelt, Dana', '2026-07-01', '2026-07-01'
  );
  assert.equal(
    db.prepare('SELECT case_id FROM inbox_documents WHERE id=?').get('inbox-ambiguous-legacy').case_id,
    ''
  );
  db.prepare(`
    INSERT INTO inbox_documents
      (id,file_name,mime_type,size,case_id,case_label,inbox_date,received_date)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    'inbox-foreign', 'Fremd.txt', 'text/plain', 0, 'case-b',
    'Doppelt, Dana', '2026-07-01', '2026-07-01'
  );
  db.prepare(`
    INSERT INTO inbox_documents
      (id,file_name,mime_type,size,case_id,case_label,inbox_date,received_date)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    'inbox-invalid', 'Ungültige Alt-ID.txt', 'text/plain', 0, 'missing-case',
    'Eindeutig, Erika', '2026-07-01', '2026-07-01'
  );

  const insertEvent = db.prepare(`
    INSERT INTO calendar_events
      (id,title,start_at,end_at,case_id,case_label)
    VALUES (?,?,?,?,?,?)
  `);
  insertEvent.run(
    'event-unique-legacy', 'Alt eindeutig', '2026-07-01 10:00', '2026-07-01 11:00',
    '', 'Eindeutig, Erika'
  );
  assert.equal(
    db.prepare('SELECT case_id FROM calendar_events WHERE id=?').get('event-unique-legacy').case_id,
    'case-unique'
  );
  insertEvent.run(
    'event-ambiguous-legacy', 'Alt mehrdeutig', '2026-07-01 12:00', '2026-07-01 13:00',
    '', 'Doppelt, Dana'
  );
  assert.equal(
    db.prepare('SELECT case_id FROM calendar_events WHERE id=?').get('event-ambiguous-legacy').case_id,
    ''
  );
  insertEvent.run(
    'event-foreign', 'Fremder Termin', '2026-07-01 14:00', '2026-07-01 15:00',
    'case-b', 'Doppelt, Dana'
  );
  insertEvent.run(
    'event-invalid', 'Ungültige Alt-ID', '2026-07-01 16:00', '2026-07-01 17:00',
    'missing-case', 'Eindeutig, Erika'
  );

  db.prepare(`
    INSERT INTO todos
      (id,title,due_at,case_id,case_label)
    VALUES (?,?,?,?,?)
  `).run('todo-ambiguous-legacy', 'Alt mehrdeutig', '2026-07-01', '', 'Doppelt, Dana');
  db.prepare(`
    INSERT INTO todos
      (id,title,due_at,case_id,case_label)
    VALUES (?,?,?,?,?)
  `).run('todo-foreign', 'Fremde Aufgabe', '2026-07-01', 'case-b', 'Doppelt, Dana');
  db.prepare(`
    INSERT INTO todos
      (id,title,due_at,case_id,case_label)
    VALUES (?,?,?,?,?)
  `).run('todo-invalid', 'Ungültige Alt-ID', '2026-07-01', 'missing-case', 'Eindeutig, Erika');
  db.prepare(`
    INSERT INTO todos
      (id,title,due_at,case_id,case_label)
    VALUES (?,?,?,?,?)
  `).run('todo-unique-legacy', 'Alt eindeutig', '2026-07-01', '', 'Eindeutig, Erika');
  assert.equal(
    db.prepare('SELECT case_id FROM todos WHERE id=?').get('todo-unique-legacy').case_id,
    'case-unique'
  );
  db.prepare(`
    INSERT INTO todos
      (id,title,due_at,case_id,case_label)
    VALUES (?,?,?,?,?)
  `).run('todo-update-legacy', 'Später zugeordnet', '2026-07-01', '', '');
  db.prepare("UPDATE todos SET case_label='Eindeutig, Erika' WHERE id='todo-update-legacy'").run();
  assert.equal(
    db.prepare('SELECT case_id FROM todos WHERE id=?').get('todo-update-legacy').case_id,
    'case-unique'
  );
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_todos_case_id'").get());

  insertEvent.run(
    'event-private-owner-b', 'Privater fremder Termin', '2026-07-01 18:00', '2026-07-01 19:00',
    'case-a', 'Doppelt, Dana'
  );
  db.prepare(`
    UPDATE calendar_events
       SET visibility='private', owner_user_id=2
     WHERE id='event-private-owner-b'
  `).run();
  db.prepare(`
    INSERT INTO todos
      (id,title,due_at,case_id,case_label,visibility,owner_user_id)
    VALUES (?,?,?,?,?,'private',2)
  `).run(
    'todo-private-owner-b', 'Private fremde Aufgabe', '2026-07-01',
    'case-a', 'Doppelt, Dana'
  );

  const inboxRouter = require('../src/modules/mail/inbox-routes');
  const calendarRouter = require('../src/modules/calendar/routes');
  const todosRouter = require('../src/modules/calendar/todo-routes');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    const userId = Number(req.get('x-test-user') || 1);
    const isAdmin = req.get('x-test-admin') === '1';
    req.session = {
      userId,
      username: userId === 1 ? 'owner-a' : 'owner-b',
      displayName: userId === 1 ? 'Owner A' : 'Owner B',
      isAdmin,
      canViewCases: true,
      canEditCases: true,
      canViewAllCases: false
    };
    next();
  });
  app.use('/api/inbox', inboxRouter);
  app.use('/api/calendar', calendarRouter);
  app.use('/api/todos', todosRouter);

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(route, options, userId = 1, isAdmin = false) {
    const input = { ...(options || {}) };
    input.headers = {
      ...(input.headers || {}),
      'x-test-user': String(userId),
      'x-test-admin': isAdmin ? '1' : '0'
    };
    const response = await fetch(base + route, input);
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_error) { body = text; }
    return { response, body };
  }
  const json = (body) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const put = (body) => ({
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  try {
    let result = await request('/inbox');
    let ids = result.body.documents.map((row) => row.id);
    assert.ok(ids.includes('inbox-unique-legacy'));
    assert.ok(!ids.includes('inbox-ambiguous-legacy'),
      'mehrdeutiger Altbestand darf eingeschränkten Nutzern keinen OCR-Inhalt offenlegen');
    assert.ok(!ids.includes('inbox-foreign'));
    assert.ok(!ids.includes('inbox-invalid'));
    result = await request('/inbox', null, 1, true);
    ids = result.body.documents.map((row) => row.id);
    assert.ok(ids.includes('inbox-ambiguous-legacy'));
    assert.ok(ids.includes('inbox-invalid'));
    result = await request('/inbox/inbox-ambiguous-legacy/file');
    assert.equal(result.response.status, 403);
    result = await request('/inbox/inbox-invalid/file');
    assert.equal(result.response.status, 403);
    result = await request('/inbox/inbox-invalid', put({ sender: 'darf nicht ändern' }));
    assert.equal(result.response.status, 403);
    result = await request('/inbox/inbox-ambiguous-legacy', { method: 'DELETE' });
    assert.equal(result.response.status, 403);
    result = await request('/inbox/inbox-invalid', { method: 'DELETE' });
    assert.equal(result.response.status, 403);
    result = await request('/inbox/inbox-foreign/file');
    assert.equal(result.response.status, 403);

    result = await request('/calendar/events');
    ids = result.body.events.map((row) => row.id);
    assert.ok(ids.includes('event-unique-legacy'));
    assert.ok(!ids.includes('event-ambiguous-legacy'));
    assert.ok(!ids.includes('event-foreign'));
    assert.ok(!ids.includes('event-invalid'));
    assert.ok(!ids.includes('event-private-owner-b'));
    result = await request('/calendar/events', null, 1, true);
    ids = result.body.events.map((row) => row.id);
    assert.ok(ids.includes('event-ambiguous-legacy'));
    assert.ok(ids.includes('event-invalid'));
    result = await request('/calendar/events/event-ambiguous-legacy/attachments');
    assert.equal(result.response.status, 403);
    result = await request('/calendar/events/event-invalid/attachments');
    assert.equal(result.response.status, 403);
    result = await request('/calendar/events/event-invalid', put({ title: 'darf nicht ändern' }));
    assert.equal(result.response.status, 403);
    result = await request('/calendar/events/event-invalid/attachments', json({
      filename: 'gesperrt.txt',
      dataBase64: Buffer.from('gesperrt').toString('base64')
    }));
    assert.equal(result.response.status, 403);
    result = await request('/calendar/events/event-ambiguous-legacy', { method: 'DELETE' });
    assert.equal(result.response.status, 403);
    result = await request('/calendar/events/event-invalid/attachments/fake', { method: 'DELETE' });
    assert.equal(result.response.status, 403);
    result = await request('/calendar/events/event-foreign/attachments');
    assert.equal(result.response.status, 403);
    result = await request('/calendar/events/event-private-owner-b', put({ title: 'darf nicht ändern' }));
    assert.equal(result.response.status, 403);
    result = await request('/calendar/events/event-private-owner-b/attachments');
    assert.equal(result.response.status, 403);
    result = await request('/calendar/events/event-private-owner-b/attachments', json({
      filename: 'gesperrt.txt',
      dataBase64: Buffer.from('gesperrt').toString('base64')
    }));
    assert.equal(result.response.status, 403);
    result = await request('/calendar/events/event-private-owner-b/attachments/fake', { method: 'DELETE' });
    assert.equal(result.response.status, 403);
    result = await request('/calendar/events/event-private-owner-b', { method: 'DELETE' });
    assert.equal(result.response.status, 403);

    result = await request('/todos');
    ids = result.body.todos.map((row) => row.id);
    assert.ok(!ids.includes('todo-ambiguous-legacy'));
    assert.ok(!ids.includes('todo-foreign'));
    assert.ok(!ids.includes('todo-invalid'));
    assert.ok(!ids.includes('todo-private-owner-b'));
    result = await request('/todos', null, 1, true);
    ids = result.body.todos.map((row) => row.id);
    assert.ok(ids.includes('todo-ambiguous-legacy'));
    assert.ok(ids.includes('todo-invalid'));
    result = await request('/todos/todo-ambiguous-legacy/attachments');
    assert.equal(result.response.status, 403);
    result = await request('/todos/todo-invalid/attachments');
    assert.equal(result.response.status, 403);
    result = await request('/todos/todo-invalid', put({ title: 'darf nicht ändern' }));
    assert.equal(result.response.status, 403);
    result = await request('/todos/todo-invalid/attachments', json({
      filename: 'gesperrt.txt',
      dataBase64: Buffer.from('gesperrt').toString('base64')
    }));
    assert.equal(result.response.status, 403);
    result = await request('/todos/todo-ambiguous-legacy', { method: 'DELETE' });
    assert.equal(result.response.status, 403);
    result = await request('/todos/todo-invalid/attachments/fake', { method: 'DELETE' });
    assert.equal(result.response.status, 403);
    result = await request('/todos/todo-foreign/attachments');
    assert.equal(result.response.status, 403);
    result = await request('/todos/todo-private-owner-b', put({ title: 'darf nicht ändern' }));
    assert.equal(result.response.status, 403);
    result = await request('/todos/todo-private-owner-b/attachments');
    assert.equal(result.response.status, 403);
    result = await request('/todos/todo-private-owner-b/attachments', json({
      filename: 'gesperrt.txt',
      dataBase64: Buffer.from('gesperrt').toString('base64')
    }));
    assert.equal(result.response.status, 403);
    result = await request('/todos/todo-private-owner-b/attachments/fake', { method: 'DELETE' });
    assert.equal(result.response.status, 403);
    result = await request('/todos/todo-private-owner-b', { method: 'DELETE' });
    assert.equal(result.response.status, 403);

    result = await request('/todos', json({
      title: 'Wiedervorlage: Rücklauf prüfen',
      dueAt: '2026-07-09',
      itemType: 'followup'
    }));
    assert.equal(result.response.status, 400);
    assert.match(result.body.error, /verknüpftes Element/i);
    result = await request('/todos', json({
      title: 'Wiedervorlage: Rücklauf prüfen',
      dueAt: '2026-07-09',
      itemType: 'followup',
      sourceType: 'document',
      sourceId: 'source-document-1',
      sourceModule: 'documents',
      sourceRef: 'document:source-document-1'
    }));
    assert.equal(result.response.status, 201);
    assert.equal(result.body.todo.itemType, 'followup');
    assert.equal(result.body.todo.sourceType, 'document');
    assert.equal(result.body.todo.sourceId, 'source-document-1');

    result = await request('/inbox', json({
      fileName: 'Explizit.txt',
      mimeType: 'text/plain',
      dataBase64: Buffer.from('inbox explizit\n').toString('base64'),
      inboxDate: '2026-07-02',
      caseId: 'case-a',
      caseLabel: 'Eindeutig, Erika'
    }));
    assert.equal(result.response.status, 201);
    assert.equal(result.body.document.caseId, 'case-a');
    assert.equal(result.body.document.caseLabel, 'Doppelt, Dana');
    const explicitInboxId = result.body.document.id;
    let link = db.prepare(`
      SELECT f.area,f.case_id
        FROM doc_links l JOIN doc_files f ON f.id=l.file_id
       WHERE l.module='inbox' AND l.owner_id=?
    `).get(explicitInboxId);
    assert.deepEqual(link, { area: 'case', case_id: 'case-a' });
    result = await request(`/inbox/${explicitInboxId}`, put({
      caseLabel: 'Doppelt, Dana',
      sender: 'Legacy-Client'
    }));
    assert.equal(result.response.status, 200);
    assert.equal(result.body.document.caseId, 'case-a',
      'ein unverändertes Label eines alten Clients darf die gespeicherte ID nicht leeren');

    result = await request('/inbox', json({
      fileName: 'Mehrdeutig.txt',
      mimeType: 'text/plain',
      dataBase64: Buffer.from('inbox mehrdeutig\n').toString('base64'),
      inboxDate: '2026-07-02',
      caseLabel: 'Doppelt, Dana'
    }));
    assert.equal(result.response.status, 409);
    result = await request('/inbox', json({
      fileName: 'Mehrdeutiger Altbestand.txt',
      mimeType: 'text/plain',
      dataBase64: Buffer.from('inbox mehrdeutig\n').toString('base64'),
      inboxDate: '2026-07-02'
    }));
    assert.equal(result.response.status, 201);
    assert.equal(result.body.document.caseId, '');
    const ambiguousInboxId = result.body.document.id;
    db.prepare(`
      UPDATE inbox_documents SET case_id='', case_label='Doppelt, Dana' WHERE id=?
    `).run(ambiguousInboxId);
    link = db.prepare(`
      SELECT f.area,f.case_id
        FROM doc_links l JOIN doc_files f ON f.id=l.file_id
       WHERE l.module='inbox' AND l.owner_id=?
    `).get(ambiguousInboxId);
    assert.deepEqual(link, { area: 'office', case_id: '' });

    result = await request(`/inbox/${ambiguousInboxId}`, put({
      caseId: 'case-a',
      caseLabel: 'Doppelt, Dana'
    }));
    assert.equal(result.response.status, 403);
    result = await request(`/inbox/${ambiguousInboxId}`, put({
      caseId: 'case-a',
      caseLabel: 'Doppelt, Dana'
    }), 1, true);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.document.caseId, 'case-a');
    link = db.prepare(`
      SELECT f.area,f.case_id
        FROM doc_links l JOIN doc_files f ON f.id=l.file_id
       WHERE l.module='inbox' AND l.owner_id=?
    `).get(ambiguousInboxId);
    assert.deepEqual(link, { area: 'case', case_id: 'case-a' });

    result = await request(`/inbox/${ambiguousInboxId}`, put({
      caseId: 'case-b',
      caseLabel: 'Doppelt, Dana'
    }));
    assert.equal(result.response.status, 403);
    assert.equal(
      db.prepare('SELECT case_id FROM inbox_documents WHERE id=?').get(ambiguousInboxId).case_id,
      'case-a'
    );
    result = await request('/inbox', json({
      fileName: 'Ungültig.txt',
      dataBase64: Buffer.from('ungueltig').toString('base64'),
      caseId: 'nicht-vorhanden',
      caseLabel: 'Eindeutig, Erika'
    }));
    assert.equal(result.response.status, 400);

    result = await request('/calendar/events', json({
      title: 'Mehrdeutiger Termin',
      startAt: '2026-07-03 10:00',
      endAt: '2026-07-03 11:00',
      caseLabel: 'Doppelt, Dana',
      connectionId: 'local'
    }));
    assert.equal(result.response.status, 409);
    result = await request('/calendar/events', json({
      title: 'Mehrdeutiger Altbestand',
      startAt: '2026-07-03 10:00',
      endAt: '2026-07-03 11:00',
      connectionId: 'local'
    }));
    assert.equal(result.response.status, 201);
    assert.equal(result.body.event.caseId, '');
    const ambiguousEventId = result.body.event.id;
    db.prepare(`
      UPDATE calendar_events SET case_id='', case_label='Doppelt, Dana' WHERE id=?
    `).run(ambiguousEventId);
    result = await request(`/calendar/events/${ambiguousEventId}/attachments`, json({
      filename: 'Termin.txt',
      mimeType: 'text/plain',
      dataBase64: Buffer.from('terminanlage\n').toString('base64')
    }));
    assert.equal(result.response.status, 403);
    result = await request(`/calendar/events/${ambiguousEventId}/attachments`, json({
      filename: 'Termin.txt',
      mimeType: 'text/plain',
      dataBase64: Buffer.from('terminanlage\n').toString('base64')
    }), 1, true);
    assert.equal(result.response.status, 201);
    const eventAttachmentId = result.body.attachment.id;
    link = db.prepare(`
      SELECT f.area,f.case_id
        FROM doc_links l JOIN doc_files f ON f.id=l.file_id
       WHERE l.module='calendar-attachment' AND l.owner_id=? AND l.slot=?
    `).get(ambiguousEventId, eventAttachmentId);
    assert.deepEqual(link, { area: 'office', case_id: '' });
    result = await request(`/calendar/events/${ambiguousEventId}`, put({
      caseId: 'case-a',
      caseLabel: 'Doppelt, Dana'
    }));
    assert.equal(result.response.status, 403);
    result = await request(`/calendar/events/${ambiguousEventId}`, put({
      caseId: 'case-a',
      caseLabel: 'Doppelt, Dana'
    }), 1, true);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.event.caseId, 'case-a');
    link = db.prepare(`
      SELECT f.area,f.case_id
        FROM doc_links l JOIN doc_files f ON f.id=l.file_id
       WHERE l.module='calendar-attachment' AND l.owner_id=? AND l.slot=?
    `).get(ambiguousEventId, eventAttachmentId);
    assert.deepEqual(link, { area: 'case', case_id: 'case-a' });
    result = await request('/calendar/events', json({
      title: 'Fremder Termin',
      startAt: '2026-07-03 12:00',
      caseId: 'case-b',
      caseLabel: 'Doppelt, Dana',
      connectionId: 'local'
    }));
    assert.equal(result.response.status, 403);
    result = await request('/calendar/events', json({
      title: 'Expliziter Termin',
      startAt: '2026-07-03 12:30',
      caseId: 'case-a',
      caseLabel: 'Eindeutig, Erika',
      connectionId: 'local'
    }));
    assert.equal(result.response.status, 201);
    assert.equal(result.body.event.caseId, 'case-a');
    assert.equal(result.body.event.caseLabel, 'Doppelt, Dana');
    result = await request('/calendar/events', json({
      title: 'Ungültiger Termin',
      startAt: '2026-07-03 13:00',
      caseId: 'nicht-vorhanden',
      caseLabel: 'Eindeutig, Erika',
      connectionId: 'local'
    }));
    assert.equal(result.response.status, 400);

    result = await request('/todos', json({
      title: 'Mehrdeutige Aufgabe',
      dueAt: '2026-07-04',
      caseLabel: 'Doppelt, Dana',
      connectionId: 'local'
    }));
    assert.equal(result.response.status, 409);
    result = await request('/todos', json({
      title: 'Mehrdeutiger Altbestand',
      dueAt: '2026-07-04',
      connectionId: 'local'
    }));
    assert.equal(result.response.status, 201);
    assert.equal(result.body.todo.caseId, '');
    const ambiguousTodoId = result.body.todo.id;
    db.prepare(`
      UPDATE todos SET case_id='', case_label='Doppelt, Dana' WHERE id=?
    `).run(ambiguousTodoId);
    result = await request(`/todos/${ambiguousTodoId}/attachments`, json({
      filename: 'Aufgabe.txt',
      mimeType: 'text/plain',
      dataBase64: Buffer.from('aufgabenanlage\n').toString('base64')
    }));
    assert.equal(result.response.status, 403);
    result = await request(`/todos/${ambiguousTodoId}/attachments`, json({
      filename: 'Aufgabe.txt',
      mimeType: 'text/plain',
      dataBase64: Buffer.from('aufgabenanlage\n').toString('base64')
    }), 1, true);
    assert.equal(result.response.status, 201);
    const todoAttachmentId = result.body.attachment.id;
    result = await request(`/todos/${ambiguousTodoId}`, put({
      caseId: 'case-a',
      caseLabel: 'Doppelt, Dana'
    }));
    assert.equal(result.response.status, 403);
    result = await request(`/todos/${ambiguousTodoId}`, put({
      caseId: 'case-a',
      caseLabel: 'Doppelt, Dana'
    }), 1, true);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.todo.caseId, 'case-a');
    link = db.prepare(`
      SELECT f.area,f.case_id
        FROM doc_links l JOIN doc_files f ON f.id=l.file_id
       WHERE l.module='todo-attachment' AND l.owner_id=? AND l.slot=?
    `).get(ambiguousTodoId, todoAttachmentId);
    assert.deepEqual(link, { area: 'case', case_id: 'case-a' });
    result = await request('/todos', json({
      title: 'Fremde Aufgabe',
      dueAt: '2026-07-04',
      caseId: 'case-b',
      caseLabel: 'Doppelt, Dana',
      connectionId: 'local'
    }));
    assert.equal(result.response.status, 403);
    result = await request('/todos', json({
      title: 'Explizite Aufgabe',
      dueAt: '2026-07-04',
      caseId: 'case-a',
      caseLabel: 'Eindeutig, Erika',
      connectionId: 'local'
    }));
    assert.equal(result.response.status, 201);
    assert.equal(result.body.todo.caseId, 'case-a');
    assert.equal(result.body.todo.caseLabel, 'Doppelt, Dana');
    result = await request('/todos', json({
      title: 'Ungültige Aufgabe',
      dueAt: '2026-07-04',
      caseId: 'nicht-vorhanden',
      caseLabel: 'Eindeutig, Erika',
      connectionId: 'local'
    }));
    assert.equal(result.response.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + suffix); } catch (_error) { /* bereits entfernt */ }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log('case-assignment-routes: ID-Vorrang, Eindeutigkeit, Sichtbarkeit und Umhängen ok');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
