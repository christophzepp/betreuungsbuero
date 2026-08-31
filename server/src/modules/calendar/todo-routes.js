// Aufgabenverwaltung (Phase 7, Plan Abschnitt AB/AE) - analog zu routes/calendar.js aufgebaut
// (buerobezogen sichtbar, gleiche Rechte-Middleware, gleiche Mehrfach-Verbindungs-Dispatch-Schicht
// ueber calendar-sync.js). Siehe dortige Kommentare fuer die grundlegenden Entscheidungen.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_ROOT: DEFAULT_DATA_ROOT } = require('../../config/paths');
const db = require('../../database/index');
const { requireAuth, requireViewCases, requireEditCases } = require('../../middleware/authentication');
const sync = require('./sync');
const syncRunner = require('../sync/runner');
const officeEvents = require('../office/events');
const { createModuleFiles } = require('../documents/module-files');
const {
  nurSichtbareNachLabel,
  fallZuordnung,
  darfBearbeiten,
  darfZuordnungSehen,
  darfZuordnungBearbeiten
} = require('../cases/case-visibility');
const moduleFiles = createModuleFiles({ db, documents: require('../documents/routes').intern });

const router = express.Router();
router.use(requireAuth);
// Echtzeit (2026-07-19): erfolgreiche Schreiboperationen an alle Fenster/Nutzer melden.
router.use(officeEvents.middleware('todos'));

// Nur lesender Altbestands-Fallback; neue Aufgabenanlagen werden zentral als doc_files gespeichert.
const DATA_ROOT = path.resolve(DEFAULT_DATA_ROOT);
const ATTACHMENTS_DIR = path.join(DATA_ROOT, 'todo-attachments');
function attachmentFilePath(todoId, attId) { return path.join(ATTACHMENTS_DIR, todoId, attId); }

const listStmt = db.prepare('SELECT * FROM todos ORDER BY (due_at = \'\'), due_at');
// Multi-User-Sichtbarkeit (Nutzerwunsch): öffentliche (büroweite) Aufgaben + eigene private.
const listVisibleStmt = db.prepare("SELECT * FROM todos WHERE visibility = 'public' OR owner_user_id = ? ORDER BY (due_at = ''), due_at");
const getStmt = db.prepare('SELECT * FROM todos WHERE id = ?');
const insertStmt = db.prepare(`
  INSERT INTO todos
    (id, title, description, due_at, start_at, done, priority, recurrence_rule, case_label,
     item_type, case_id, source_type, source_id, source_module, source_ref,
     source, connection_id, calendar_ref, external_uid, external_href, external_etag,
     owner_user_id, visibility, updated_by)
  VALUES
    (@id, @title, @description, @dueAt, @startAt, @done, @priority, @recurrenceRule, @caseLabel,
     @itemType, @caseId, @sourceType, @sourceId, @sourceModule, @sourceRef,
     @source, @connectionId, @calendarRef, @externalUid, @externalHref, @externalEtag,
     @ownerUserId, @visibility, @userId)
`);
const updateStmt = db.prepare(`
  UPDATE todos SET title=@title, description=@description, due_at=@dueAt, start_at=@startAt, done=@done, priority=@priority, recurrence_rule=@recurrenceRule,
    case_label=@caseLabel, item_type=@itemType, case_id=@caseId, source_type=@sourceType, source_id=@sourceId,
    source_module=@sourceModule, source_ref=@sourceRef, external_uid=@externalUid, external_href=@externalHref,
    external_etag=@externalEtag, updated_at=datetime('now'), updated_by=@userId
  WHERE id=@id
`);
const deleteStmt = db.prepare('DELETE FROM todos WHERE id = ?');
const getConnectionStmt = db.prepare('SELECT * FROM calendar_connections WHERE id = ?');
const listAttachmentsStmt = db.prepare('SELECT * FROM todo_attachments WHERE todo_id = ? ORDER BY created_at');
const getAttachmentStmt = db.prepare('SELECT * FROM todo_attachments WHERE id = ? AND todo_id = ?');
const insertAttachmentStmt = db.prepare(`
  INSERT INTO todo_attachments (id, todo_id, filename, mime_type, size, created_by)
  VALUES (@id, @todoId, @filename, @mimeType, @size, @userId)
`);
const deleteAttachmentStmt = db.prepare('DELETE FROM todo_attachments WHERE id = ? AND todo_id = ?');
const deleteAttachmentsForTodoStmt = db.prepare('DELETE FROM todo_attachments WHERE todo_id = ?');
const setAttachmentFilenameStmt = db.prepare('UPDATE todo_attachments SET filename = ? WHERE id = ? AND todo_id = ?');
const syncDocumentFollowupStmt = db.prepare(`
  UPDATE doc_files SET resubmit_at = @dueAt, resubmit_note = @description, updated_at = datetime('now')
   WHERE id = @sourceId AND deleted_at = ''
`);
const clearDocumentFollowupStmt = db.prepare(`
  UPDATE doc_files SET resubmit_at = '', resubmit_note = '', updated_at = datetime('now')
   WHERE id = ?
`);

function normalizeItemType(value, title, description) {
  const explicit = String(value || '').trim().toLowerCase();
  if (explicit === 'task' || explicit === 'followup' || explicit === 'deadline') return explicit;
  if (/^\s*wiedervorlage\s*:/i.test(String(title || '')) || /\[wiedervorlage\]/i.test(String(description || ''))) return 'followup';
  if (/^\s*frist\s*:/i.test(String(title || ''))) return 'deadline';
  return 'task';
}

function syncDocumentFollowup(todo, remove) {
  if (!todo || todo.sourceType !== 'document' || !todo.sourceId) return;
  if (remove || todo.done) {
    const result = clearDocumentFollowupStmt.run(todo.sourceId);
    if (result.changes) officeEvents.emit('documents', { method: remove ? 'DELETE' : 'PUT', sourceId: todo.sourceId });
    return;
  }
  const dueAt = String(todo.dueAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) {
    clearDocumentFollowupStmt.run(todo.sourceId);
    return;
  }
  const result = syncDocumentFollowupStmt.run({
    sourceId: todo.sourceId,
    dueAt,
    description: String(todo.description || '').slice(0, 500)
  });
  if (result.changes) officeEvents.emit('documents', { method: 'PUT', sourceId: todo.sourceId });
}

function publicTodo(row) {
  const assignment = fallZuordnung(row.case_id, row.case_label);
  return {
    id: row.id, title: row.title, description: row.description, dueAt: row.due_at, startAt: row.start_at || '',
    done: !!row.done, priority: row.priority, recurrenceRule: row.recurrence_rule || '',
    caseLabel: assignment.caseLabel,
    itemType: normalizeItemType(row.item_type, row.title, row.description), caseId: assignment.caseId,
    sourceType: row.source_type || '', sourceId: row.source_id || '',
    sourceModule: row.source_module || '', sourceRef: row.source_ref || '',
    source: row.source, connectionId: row.connection_id || null, calendarRef: row.calendar_ref || '',
    visibility: row.visibility === 'private' ? 'private' : 'public', ownerUserId: row.owner_user_id == null ? null : row.owner_user_id,
    updatedAt: row.updated_at
  };
}
function publicAttachment(row) {
  return { id: row.id, filename: row.filename, mimeType: row.mime_type, size: row.size, createdAt: row.created_at };
}

function itemVisible(row, session) {
  if (!row || !session || !session.userId) return false;
  return row.visibility !== 'private'
    || Number(row.owner_user_id) === Number(session.userId);
}

function connectionVisible(row, session) {
  if (!row || !session || !session.userId) return false;
  return row.visibility !== 'private'
    || Number(row.owner_user_id) === Number(session.userId);
}

function assignmentForUpdate(body, row) {
  const hasId = Object.prototype.hasOwnProperty.call(body, 'caseId');
  const hasLabel = Object.prototype.hasOwnProperty.call(body, 'caseLabel');
  if (hasId) return fallZuordnung(body.caseId, hasLabel ? body.caseLabel : row.case_label);
  if (hasLabel) {
    if (String(body.caseLabel || '').trim() === String(row.case_label || '').trim()) {
      return fallZuordnung(row.case_id, body.caseLabel);
    }
    return fallZuordnung('', body.caseLabel);
  }
  return fallZuordnung(row.case_id, row.case_label);
}

function rejectInvalidAssignment(res, assignment) {
  if (assignment.invalidId) {
    res.status(400).json({ error: 'Die angegebene Fall-ID existiert nicht.' });
    return true;
  }
  if (assignment.ambiguous) {
    res.status(409).json({
      error: 'Die Fallbezeichnung ist mehrfach vorhanden. Bitte den Fall ausdrücklich über seine ID auswählen.'
    });
    return true;
  }
  return false;
}

router.get('/', requireViewCases, (req, res) => {
  const visible = nurSichtbareNachLabel(req.session, listVisibleStmt.all(req.session.userId));
  res.json({ todos: visible.map(publicTodo) });
});

// v189: Zwilling zu /api/calendar/events/attachments-map. Gemessen: 55 Einzelabrufe je
// Seitenaufbau. Gefiltert auf genau die Aufgaben, die GET / ohnehin herausgibt.
const listAllAttachmentsStmt = db.prepare('SELECT * FROM todo_attachments ORDER BY created_at');
router.get('/attachments-map', requireViewCases, (req, res) => {
  const sichtbar = new Set(
    nurSichtbareNachLabel(req.session, listVisibleStmt.all(req.session.userId)).map((t) => t.id)
  );
  const map = {};
  for (const row of listAllAttachmentsStmt.all()) {
    if (!sichtbar.has(row.todo_id)) continue;
    (map[row.todo_id] = map[row.todo_id] || []).push(publicAttachment(row));
  }
  res.json({ map });
});

router.post('/', requireEditCases, async (req, res) => {
  const {
    title, description, dueAt, startAt, priority, recurrenceRule, caseLabel, caseId,
    itemType, sourceType, sourceId, sourceModule, sourceRef, connectionId, calendarRef
  } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Titel erforderlich.' });
  // Eine ausdrücklich neu angelegte Wiedervorlage muss auf den Vorgang zeigen, der später erneut
  // geprüft werden soll. Titelpräfixe alter Sicherungen werden weiterhin als Altbestand importiert;
  // moderne Clients senden itemType='followup' und müssen deshalb die Quellenfelder mitliefern.
  if (
    String(itemType || '').trim().toLowerCase() === 'followup'
    && (
      !String(sourceType || '').trim()
      || (!String(sourceId || '').trim() && !String(sourceRef || '').trim())
    )
  ) {
    return res.status(400).json({
      error: 'Für eine Wiedervorlage muss ein verknüpftes Element ausgewählt werden.'
    });
  }
  const assignment = fallZuordnung(caseId, caseLabel);
  if (rejectInvalidAssignment(res, assignment)) return;
  if (assignment.caseId && !darfBearbeiten(req.session, assignment.caseId)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const id = crypto.randomUUID();
  const row = {
    id, title: String(title), description: description || '', dueAt: dueAt || '', startAt: startAt || '', done: 0,
    priority: priority || 'normal', recurrenceRule: recurrenceRule || '',
    caseLabel: assignment.caseLabel,
    itemType: normalizeItemType(itemType, title, description), caseId: assignment.caseId,
    sourceType: sourceType || '', sourceId: sourceId || '', sourceModule: sourceModule || '', sourceRef: sourceRef || '',
    source: 'local', connectionId: null, calendarRef: '', externalUid: '', externalHref: '', externalEtag: '',
    ownerUserId: null, visibility: 'public', userId: req.session.userId
  };
  // Speicherort-Auswahl (Nutzerwunsch, wie bei Terminen): connectionId undefined -> altes Verhalten
  // (Auto-Push nur bei genau EINER aktiven Verbindung); '' / 'local' -> bewusst lokal; sonst gezielt in
  // die gewaehlte aktive Verbindung. Wiederkehrende Aufgaben werden NIE gespiegelt (je Anbieter eigenes,
  // inkompatibles Wiederholungsmodell) - der Speicherort wird dann ignoriert und die Aufgabe bleibt lokal.
  //
  // Fristen/Wiedervorlagen (PLAN-AUFGABEN-SYNC, Etappe 1): duerfen jetzt ebenfalls hinaus - aber NUR
  // bei ausdruecklich gewaehltem Ziel (die Fristenverwaltung sendet ihre Standard-Aufgabenliste mit).
  // Der Auto-Push bei genau einer Verbindung bleibt bewusst auf 'task' beschraenkt, damit sich
  // bestehende Einzel-Verbindungs-Bueros nicht unangekuendigt anders verhalten. Draussen schuetzt
  // der Nur-Export-Waechter in sync/runner.js diese Eintraege vor Fremdaenderungen.
  const exportableType = row.itemType === 'deadline' || row.itemType === 'followup';
  let target = null;
  if ((row.itemType === 'task' || exportableType) && !row.recurrenceRule) {
    if (connectionId === undefined) {
      if (!exportableType) {
        const enabled = sync.listEnabledConnections()
          .filter((connection) => connectionVisible(connection, req.session));
        if (enabled.length === 1) target = enabled[0];
      }
    } else if (connectionId && connectionId !== 'local') {
      const conn = getConnectionStmt.get(connectionId);
      if (conn && conn.enabled && connectionVisible(conn, req.session)) target = conn;
    }
  }
  if (target) {
    try {
      const pushed = await sync.pushTodo(target, { title: row.title, description: row.description, dueAt: row.dueAt, done: false, priority: row.priority, caseId: row.caseId, calendarRef: (calendarRef || '') });
      row.source = target.provider;
      row.connectionId = target.id;
      row.calendarRef = pushed.calendarRef || '';
      row.externalUid = pushed.uid || '';
      row.externalHref = pushed.href || '';
      row.ownerUserId = target.owner_user_id == null ? null : Number(target.owner_user_id);
      row.visibility = target.visibility === 'private' ? 'private' : 'public';
    } catch (error) {
      console.warn('[todos] Aufgabe konnte nicht gespiegelt werden:', error.message);
    }
  }
  insertStmt.run(row);
  syncDocumentFollowup(row, false);
  res.status(201).json({ todo: publicTodo(getStmt.get(id)) });
});

router.put('/:id', requireEditCases, async (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
  if (!itemVisible(row, req.session)) {
    return res.status(403).json({ error: 'Diese private Aufgabe gehört einem anderen Konto.' });
  }
  const currentAssignment = fallZuordnung(row.case_id, row.case_label);
  if (!darfZuordnungBearbeiten(req.session, currentAssignment)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const body = req.body || {};
  const {
    title, description, dueAt, startAt, done, priority, recurrenceRule, caseLabel, caseId,
    itemType, sourceType, sourceId, sourceModule, sourceRef
  } = body;
  const assignment = row.source_type === 'document'
    ? currentAssignment
    : assignmentForUpdate(body, row);
  if (rejectInvalidAssignment(res, assignment)) return;
  if (assignment.caseId && !darfBearbeiten(req.session, assignment.caseId)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const next = {
    id: row.id, title: title != null ? String(title) : row.title, description: description != null ? description : row.description,
    dueAt: dueAt != null ? dueAt : row.due_at, startAt: startAt != null ? startAt : (row.start_at || ''), done: done != null ? (done ? 1 : 0) : row.done,
    priority: priority != null ? priority : row.priority, recurrenceRule: recurrenceRule != null ? recurrenceRule : (row.recurrence_rule || ''),
    caseLabel: assignment.caseLabel,
    itemType: normalizeItemType(itemType != null ? itemType : row.item_type, title != null ? title : row.title, description != null ? description : row.description),
    caseId: assignment.caseId,
    sourceType: sourceType != null ? sourceType : (row.source_type || ''),
    sourceId: sourceId != null ? sourceId : (row.source_id || ''),
    sourceModule: sourceModule != null ? sourceModule : (row.source_module || ''),
    sourceRef: sourceRef != null ? sourceRef : (row.source_ref || ''),
    externalUid: row.external_uid, externalHref: row.external_href, externalEtag: row.external_etag,
    userId: req.session.userId
  };
  // Auch Fristen/Wiedervorlagen ziehen ihre LOKALEN Aenderungen nach draussen nach (Nur-Export
  // heisst: das Buero schreibt, niemand sonst) - deshalb hier nicht mehr auf 'task' beschraenkt.
  if (row.connection_id && (next.itemType === 'task' || next.itemType === 'deadline' || next.itemType === 'followup') && !next.recurrenceRule) {
    const conn = getConnectionStmt.get(row.connection_id);
    if (conn && conn.enabled) {
      try {
        const pushed = await sync.pushTodo(conn, { uid: row.external_uid, href: row.external_href, title: next.title, description: next.description, dueAt: next.dueAt, done: !!next.done, priority: next.priority, caseId: next.caseId, calendarRef: row.calendar_ref || '' });
        next.externalUid = pushed.uid || next.externalUid;
        next.externalHref = pushed.href || next.externalHref;
      } catch (error) {
        console.warn('[todos] Änderung konnte nicht gespiegelt werden:', error.message);
      }
    }
  }
  updateStmt.run(next);
  try {
    for (const attachment of listAttachmentsStmt.all(row.id)) {
      const moved = moduleFiles.moveTo({
        module: 'todo-attachment', ownerId: row.id, slot: attachment.id,
        caseId: next.caseId, caseLabel: next.caseLabel,
        filename: attachment.filename, date: next.dueAt || next.startAt || row.created_at
      });
      if (moved && moved.row && moved.row.name !== attachment.filename) {
        setAttachmentFilenameStmt.run(moved.row.name, attachment.id, row.id);
      }
    }
  } catch (error) {
    return res.status(409).json({ error: 'Aufgabe wurde aktualisiert, ihre Anlagen konnten aber nicht vollständig nachgezogen werden: ' + (error.message || error) });
  }
  syncDocumentFollowup(next, false);
  res.json({ todo: publicTodo(getStmt.get(row.id)) });
});

router.delete('/:id', requireEditCases, async (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
  if (!itemVisible(row, req.session)) {
    return res.status(403).json({ error: 'Diese private Aufgabe gehört einem anderen Konto.' });
  }
  const assignment = fallZuordnung(row.case_id, row.case_label);
  if (!darfZuordnungBearbeiten(req.session, assignment)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  if (row.connection_id) {
    const conn = getConnectionStmt.get(row.connection_id);
    if (conn && conn.enabled) {
      try { await sync.deleteRemoteTodo(conn, row); } catch (error) { console.warn('[todos] Löschen konnte nicht gespiegelt werden:', error.message); }
    }
  }
  for (const att of listAttachmentsStmt.all(row.id)) {
    moduleFiles.unlink('todo-attachment', row.id, att.id);
    try { fs.unlinkSync(attachmentFilePath(row.id, att.id)); } catch (_e) { /* Legacy-Fallback */ }
  }
  deleteAttachmentsForTodoStmt.run(row.id);
  deleteStmt.run(row.id);
  syncDocumentFollowup({
    sourceType: row.source_type || '',
    sourceId: row.source_id || ''
  }, true);
  res.json({ ok: true });
});

// ===== Anlagen an Aufgaben (Nutzerwunsch) =====
router.get('/:id/attachments', requireViewCases, (req, res) => {
  const todo = getStmt.get(req.params.id);
  if (!todo) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
  if (!itemVisible(todo, req.session)) {
    return res.status(403).json({ error: 'Diese private Aufgabe gehört einem anderen Konto.' });
  }
  const assignment = fallZuordnung(todo.case_id, todo.case_label);
  if (!darfZuordnungSehen(req.session, assignment)) {
    return res.status(403).json({ error: 'Dieser Fall ist Ihrem Konto nicht zugeordnet.' });
  }
  res.json({ attachments: listAttachmentsStmt.all(req.params.id).map(publicAttachment) });
});
router.post('/:id/attachments', requireEditCases, (req, res) => {
  const { id } = req.params;
  const todo = getStmt.get(id);
  if (!todo) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
  if (!itemVisible(todo, req.session)) {
    return res.status(403).json({ error: 'Diese private Aufgabe gehört einem anderen Konto.' });
  }
  const assignment = fallZuordnung(todo.case_id, todo.case_label);
  if (!darfZuordnungBearbeiten(req.session, assignment)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const { filename, mimeType, dataBase64 } = req.body || {};
  if (!filename || !dataBase64) return res.status(400).json({ error: 'Dateiname und Inhalt erforderlich.' });
  let bytes;
  try { bytes = Buffer.from(dataBase64, 'base64'); } catch (_e) { return res.status(400).json({ error: 'Ungültige Dateidaten.' }); }
  if (bytes.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Datei ist zu groß (maximal 25 MB).' });
  const attId = crypto.randomUUID();
  let central;
  try {
    central = moduleFiles.store({
      module: 'todo-attachment', ownerId: id, slot: attId,
      caseId: assignment.caseId, caseLabel: assignment.caseLabel,
      filename, mimeType: mimeType || 'application/octet-stream', bytes,
      createdBy: req.session.userId, date: todo.due_at || todo.start_at || todo.created_at,
      detail: { todoId: id, attachmentId: attId }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Aufgabenanlage konnte nicht sicher im Dokumentenspeicher abgelegt werden: ' + (error.message || error) });
  }
  insertAttachmentStmt.run({ id: attId, todoId: id, filename: central.name, mimeType: mimeType || 'application/octet-stream', size: bytes.length, userId: req.session.userId });
  res.status(201).json({ attachment: publicAttachment(getAttachmentStmt.get(attId, id)) });
});
router.get('/:id/attachments/:attId', requireViewCases, (req, res) => {
  const { id, attId } = req.params;
  const todo = getStmt.get(id);
  if (!todo) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
  if (!itemVisible(todo, req.session)) {
    return res.status(403).json({ error: 'Diese private Aufgabe gehört einem anderen Konto.' });
  }
  const assignment = fallZuordnung(todo.case_id, todo.case_label);
  if (!darfZuordnungSehen(req.session, assignment)) {
    return res.status(403).json({ error: 'Dieser Fall ist Ihrem Konto nicht zugeordnet.' });
  }
  const row = getAttachmentStmt.get(attId, id);
  if (!row) return res.status(404).json({ error: 'Anlage nicht gefunden.' });
  const central = moduleFiles.resolve('todo-attachment', id, attId, false);
  const filePath = (central && central.filePath) || attachmentFilePath(id, attId);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht mehr auf dem Server vorhanden.' });
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  const disposition = req.query.inline === '1' ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(row.filename)}"`);
  fs.createReadStream(filePath).pipe(res);
});
router.delete('/:id/attachments/:attId', requireEditCases, (req, res) => {
  const { id, attId } = req.params;
  const todo = getStmt.get(id);
  if (!todo) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
  if (!itemVisible(todo, req.session)) {
    return res.status(403).json({ error: 'Diese private Aufgabe gehört einem anderen Konto.' });
  }
  const assignment = fallZuordnung(todo.case_id, todo.case_label);
  if (!darfZuordnungBearbeiten(req.session, assignment)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  if (!getAttachmentStmt.get(attId, id)) return res.status(404).json({ error: 'Anlage nicht gefunden.' });
  deleteAttachmentStmt.run(attId, id);
  moduleFiles.unlink('todo-attachment', id, attId);
  try { fs.unlinkSync(attachmentFilePath(id, attId)); } catch (_e) { /* ignore */ }
  res.json({ ok: true });
});

// Anlage an die verknuepfte Vikunja-/OpenProject-Aufgabe senden (PLAN-AUFGABEN-SYNC, Etappe 5):
// bewusste Einzelaktion ("verknuepfen statt spiegeln") - Dokumente wandern nur auf Knopfdruck in
// ein Zielsystem, nie im Hintergrund.
router.post('/:id/attachments/:attId/send-remote', requireEditCases, async (req, res) => {
  const { id, attId } = req.params;
  const todo = getStmt.get(id);
  if (!todo) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
  if (!itemVisible(todo, req.session)) {
    return res.status(403).json({ error: 'Diese private Aufgabe gehört einem anderen Konto.' });
  }
  const assignment = fallZuordnung(todo.case_id, todo.case_label);
  if (!darfZuordnungBearbeiten(req.session, assignment)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const att = getAttachmentStmt.get(attId, id);
  if (!att) return res.status(404).json({ error: 'Anlage nicht gefunden.' });
  if (!todo.connection_id || !todo.external_uid) {
    return res.status(400).json({ error: 'Diese Aufgabe ist mit keiner Verbindung verknüpft.' });
  }
  const conn = getConnectionStmt.get(todo.connection_id);
  if (!conn || !conn.enabled || !sync.isTaskApiProvider(conn.provider)) {
    return res.status(400).json({ error: 'Anhänge lassen sich nur zu Vikunja-(API)- oder OpenProject-Aufgaben übertragen.' });
  }
  const central = moduleFiles.resolve('todo-attachment', id, attId, false);
  const filePath = (central && central.filePath) || attachmentFilePath(id, attId);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht mehr auf dem Server vorhanden.' });
  try {
    await sync.taskApiAdapter(conn.provider).uploadAttachment(conn, todo.external_uid, {
      filename: att.filename, mimeType: att.mime_type, bytes: fs.readFileSync(filePath)
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Übertragung fehlgeschlagen.' });
  }
});

// Abgleich-Logik lebt seit dem automatischen Minutentakt-Sync in sync-runner.js (ein Codepfad fuer
// Route UND Timer) - dort auch der Fix, dass startAt/recurrenceRule gespiegelter Aufgaben als
// LOKALE Zusatzfelder erhalten bleiben statt bei jedem Pull geleert zu werden.
router.post('/sync', requireEditCases, async (req, res) => {
  const result = await syncRunner.syncTodos(req.session.userId);
  if (!result.ran) return res.status(400).json({ error: 'Keine aktive Kalenderverbindung vorhanden.' });
  const visible = nurSichtbareNachLabel(req.session, listVisibleStmt.all(req.session.userId));
  res.json({ todos: visible.map(publicTodo), errors: result.errors });
});

module.exports = router;
