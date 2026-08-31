// Kalender (Phase 7, Plan Abschnitt AB/AE) - Termine sind buerobezogen sichtbar (wie Faelle), nicht
// privat je Nutzer. Gleiche granulare Rechte wie Falldokumentation/Kontakte wiederverwendet
// (requireViewCases/requireEditCases), da Termine typischerweise fallbezogen sind (Personenname im
// Titel, siehe Client-seitiges Fall-Filtering) statt eine eigene Rechte-Spalte fuer dieses eine
// Feature einzufuehren. Seit Plan Abschnitt AE koennen MEHRERE Kalenderverbindungen gleichzeitig
// aktiv sein (Nextcloud/iCloud/Google/Microsoft) - die eigentliche Provider-Verzweigung lebt in
// calendar-sync.js, hier nur noch die Datenbank-Ablage und Auswahl DER richtigen Verbindung.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_ROOT: DEFAULT_DATA_ROOT } = require('../../config/paths');
const db = require('../../database/index');
const { requireAuth, requireViewCases, requireEditCases } = require('../../middleware/authentication');
const sync = require('./sync');
const syncRunner = require('../sync/runner');
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
router.use(require('../office/events').middleware('calendar'));

// Nur lesender Altbestands-Fallback; neue Terminanlagen werden zentral als doc_files gespeichert.
const DATA_ROOT = path.resolve(DEFAULT_DATA_ROOT);
const ATTACHMENTS_DIR = path.join(DATA_ROOT, 'calendar-event-attachments');
function attachmentFilePath(eventId, attId) { return path.join(ATTACHMENTS_DIR, eventId, attId); }

const listStmt = db.prepare('SELECT * FROM calendar_events ORDER BY start_at');
// Multi-User-Sichtbarkeit (Nutzerwunsch): jeder sieht öffentliche (büroweite) Termine + die eigenen
// privaten (owner_user_id = ich). Private Termine anderer Nutzer bleiben verborgen.
const listVisibleStmt = db.prepare("SELECT * FROM calendar_events WHERE visibility = 'public' OR owner_user_id = ? ORDER BY start_at");
const getStmt = db.prepare('SELECT * FROM calendar_events WHERE id = ?');
const insertStmt = db.prepare(`
  INSERT INTO calendar_events (id, title, description, location, online_url, color, start_at, end_at, all_day, recurrence_rule, case_id, case_label, reminder_at, source, connection_id, calendar_ref, external_uid, external_href, external_etag, owner_user_id, visibility, updated_by)
  VALUES (@id, @title, @description, @location, @onlineUrl, @color, @startAt, @endAt, @allDay, @recurrenceRule, @caseId, @caseLabel, @reminderAt, @source, @connectionId, @calendarRef, @externalUid, @externalHref, @externalEtag, @ownerUserId, @visibility, @userId)
`);
const updateStmt = db.prepare(`
  UPDATE calendar_events SET title=@title, description=@description, location=@location, online_url=@onlineUrl, color=@color, start_at=@startAt, end_at=@endAt,
    all_day=@allDay, recurrence_rule=@recurrenceRule, case_id=@caseId, case_label=@caseLabel, reminder_at=@reminderAt, external_uid=@externalUid, external_href=@externalHref, external_etag=@externalEtag, updated_at=datetime('now'), updated_by=@userId
  WHERE id=@id
`);
const deleteStmt = db.prepare('DELETE FROM calendar_events WHERE id = ?');
const getConnectionStmt = db.prepare('SELECT * FROM calendar_connections WHERE id = ?');
const listAttachmentsStmt = db.prepare('SELECT * FROM calendar_event_attachments WHERE event_id = ? ORDER BY created_at');
const getAttachmentStmt = db.prepare('SELECT * FROM calendar_event_attachments WHERE id = ? AND event_id = ?');
const insertAttachmentStmt = db.prepare(`
  INSERT INTO calendar_event_attachments (id, event_id, filename, mime_type, size, created_by)
  VALUES (@id, @eventId, @filename, @mimeType, @size, @userId)
`);
const deleteAttachmentStmt = db.prepare('DELETE FROM calendar_event_attachments WHERE id = ? AND event_id = ?');
const deleteAttachmentsForEventStmt = db.prepare('DELETE FROM calendar_event_attachments WHERE event_id = ?');
const setAttachmentFilenameStmt = db.prepare('UPDATE calendar_event_attachments SET filename = ? WHERE id = ? AND event_id = ?');

function publicEvent(row) {
  const assignment = fallZuordnung(row.case_id, row.case_label);
  return {
    id: row.id, title: row.title, description: row.description, location: row.location, onlineUrl: row.online_url || '',
    color: row.color || '', startAt: row.start_at, endAt: row.end_at, allDay: !!row.all_day, recurrenceRule: row.recurrence_rule || '',
    caseId: assignment.caseId, caseLabel: assignment.caseLabel,
    reminderAt: row.reminder_at || '', source: row.source, connectionId: row.connection_id || null, calendarRef: row.calendar_ref || '',
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

router.get('/events', requireViewCases, (req, res) => {
  const visible = nurSichtbareNachLabel(req.session, listVisibleStmt.all(req.session.userId));
  res.json({ events: visible.map(publicEvent) });
});

// v189: Sammelabruf der Anlagen-Metadaten. Gemessen: 110 Einzelabrufe je Seitenaufbau,
// zusammen über 834 s aufsummierter Wartezeit - siehe /api/todos/attachments-map für den
// Zwilling. Gefiltert auf genau die Termine, die GET /events ohnehin herausgibt.
// MUSS vor '/events/:id/attachments' stehen? Nein - andere Segmentzahl. Die Nähe zur
// Listenroute ist Absicht: beide antworten aus derselben Sichtbarkeitsmenge.
const listAllAttachmentsStmt = db.prepare('SELECT * FROM calendar_event_attachments ORDER BY created_at');
router.get('/events/attachments-map', requireViewCases, (req, res) => {
  const sichtbar = new Set(
    nurSichtbareNachLabel(req.session, listVisibleStmt.all(req.session.userId)).map((e) => e.id)
  );
  const map = {};
  for (const row of listAllAttachmentsStmt.all()) {
    if (!sichtbar.has(row.event_id)) continue;
    (map[row.event_id] = map[row.event_id] || []).push(publicAttachment(row));
  }
  res.json({ map });
});

// Aktive Kalenderverbindungen fuer die Speicherort-Auswahl bei Termin-/Aufgabenerstellung
// (Nutzerwunsch). Bewusst NUR die minimalen Anzeigefelder AKTIVER Verbindungen - keine Secrets/
// Konfigdetails (die vollstaendige, admin-geschuetzte Liste liegt unter /api/admin/calendar-
// connections). Ueber requireViewCases erreichbar, da genau diese Nutzer Termine/Aufgaben anlegen.
const listEnabledConnStmt = db.prepare("SELECT id, provider, display_name, owner_user_id, visibility FROM calendar_connections WHERE enabled = 1 ORDER BY display_name");
// Ausgewaehlte Kalender/Aufgabenlisten je Verbindung (mit Farbe) - fuer die Sichtbarkeits-Haekchen +
// Farbpunkte in Kalender-/Aufgaben-Ansicht (Nutzerwunsch mehrere Kalender je Konto).
const listSelCalsStmt = db.prepare("SELECT id, kind, remote_id, name, color, position FROM connection_calendars WHERE connection_id = ? AND selected = 1 ORDER BY kind, position, name");
router.get('/connections', requireViewCases, (req, res) => {
  const uid = req.session.userId;
  // Nur Verbindungen, deren Termine/Aufgaben fuer diesen Nutzer sichtbar sind (public ODER eigene) -
  // deckungsgleich mit listVisibleStmt.
  const conns = listEnabledConnStmt.all().filter((c) => (c.visibility !== 'private') || c.owner_user_id === uid);
  res.json({ connections: conns.map((c) => ({
    id: c.id, provider: c.provider, displayName: c.display_name || c.provider,
    calendars: listSelCalsStmt.all(c.id).map((cc) => ({ id: cc.id, kind: cc.kind, remoteId: cc.remote_id, name: cc.name || '', color: cc.color || '' }))
  })) });
});

router.post('/events', requireEditCases, async (req, res) => {
  const {
    title, description, location, onlineUrl, color, startAt, endAt, allDay,
    recurrenceRule, caseId, caseLabel, connectionId, calendarRef, reminderAt
  } = req.body || {};
  if (!title || !startAt) return res.status(400).json({ error: 'Titel und Start erforderlich.' });
  const assignment = fallZuordnung(caseId, caseLabel);
  if (rejectInvalidAssignment(res, assignment)) return;
  if (assignment.caseId && !darfBearbeiten(req.session, assignment.caseId)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const id = crypto.randomUUID();
  const row = {
    id, title: String(title), description: description || '', location: location || '', onlineUrl: onlineUrl || '', color: color || '',
    startAt, endAt: endAt || startAt, allDay: allDay ? 1 : 0, recurrenceRule: recurrenceRule || '',
    caseId: assignment.caseId, caseLabel: assignment.caseLabel, reminderAt: reminderAt || '',
    source: 'local', connectionId: null, calendarRef: '', externalUid: '', externalHref: '', externalEtag: '',
    ownerUserId: null, visibility: 'public', userId: req.session.userId
  };
  // Speicherort-Auswahl (Nutzerwunsch): Der Client kann jetzt explizit ein Ziel senden.
  //  - connectionId undefined  -> altes Verhalten: automatischer Push nur bei genau EINER aktiven Verbindung.
  //  - connectionId '' / 'local' -> bewusst lokal (kein Push).
  //  - connectionId = eine aktive Verbindung -> gezielt in genau diese spiegeln.
  // (Serientermine werden mitgespiegelt; recurrence.js uebersetzt das App-Modell in RRULE/Graph-Objekt.)
  let target = null;
  if (connectionId === undefined) {
    const enabled = sync.listEnabledConnections()
      .filter((connection) => connectionVisible(connection, req.session));
    if (enabled.length === 1) target = enabled[0];
  } else if (connectionId && connectionId !== 'local') {
    const conn = getConnectionStmt.get(connectionId);
    if (conn && conn.enabled && connectionVisible(conn, req.session)) target = conn;
  }
  if (target) {
    try {
      const pushed = await sync.pushEvent(target, { title: row.title, description: row.description, location: row.location, startAt: row.startAt, endAt: row.endAt, allDay: !!row.allDay, recurrenceRule: row.recurrenceRule, reminderAt: row.reminderAt, calendarRef: (calendarRef || '') });
      row.source = target.provider;
      row.connectionId = target.id;
      row.calendarRef = pushed.calendarRef || '';
      row.externalUid = pushed.uid || '';
      row.externalHref = pushed.href || '';
      row.ownerUserId = target.owner_user_id == null ? null : Number(target.owner_user_id);
      row.visibility = target.visibility === 'private' ? 'private' : 'public';
    } catch (error) {
      console.warn('[calendar] Termin konnte nicht gespiegelt werden:', error.message);
    }
  }
  insertStmt.run(row);
  res.status(201).json({ event: publicEvent(getStmt.get(id)) });
});

router.put('/events/:id', requireEditCases, async (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Termin nicht gefunden.' });
  if (!itemVisible(row, req.session)) {
    return res.status(403).json({ error: 'Dieser private Termin gehört einem anderen Konto.' });
  }
  const currentAssignment = fallZuordnung(row.case_id, row.case_label);
  if (!darfZuordnungBearbeiten(req.session, currentAssignment)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const body = req.body || {};
  const {
    title, description, location, onlineUrl, color, startAt, endAt,
    allDay, recurrenceRule, reminderAt
  } = body;
  const assignment = assignmentForUpdate(body, row);
  if (rejectInvalidAssignment(res, assignment)) return;
  if (assignment.caseId && !darfBearbeiten(req.session, assignment.caseId)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const next = {
    id: row.id, title: title != null ? String(title) : row.title, description: description != null ? description : row.description,
    location: location != null ? location : row.location, onlineUrl: onlineUrl != null ? onlineUrl : (row.online_url || ''),
    color: color != null ? color : (row.color || ''),
    startAt: startAt || row.start_at, endAt: endAt || row.end_at,
    allDay: allDay != null ? (allDay ? 1 : 0) : row.all_day, recurrenceRule: recurrenceRule != null ? recurrenceRule : (row.recurrence_rule || ''),
    caseId: assignment.caseId, caseLabel: assignment.caseLabel,
    reminderAt: reminderAt != null ? reminderAt : (row.reminder_at || ''),
    externalUid: row.external_uid, externalHref: row.external_href, externalEtag: row.external_etag,
    userId: req.session.userId
  };
  if (row.connection_id) {
    const conn = getConnectionStmt.get(row.connection_id);
    if (conn && conn.enabled) {
      try {
        const pushed = await sync.pushEvent(conn, { uid: row.external_uid, href: row.external_href, title: next.title, description: next.description, location: next.location, startAt: next.startAt, endAt: next.endAt, allDay: !!next.allDay, recurrenceRule: next.recurrenceRule, reminderAt: next.reminderAt });
        next.externalUid = pushed.uid || next.externalUid;
        next.externalHref = pushed.href || next.externalHref;
      } catch (error) {
        console.warn('[calendar] Änderung konnte nicht gespiegelt werden:', error.message);
      }
    }
  }
  updateStmt.run(next);
  try {
    for (const attachment of listAttachmentsStmt.all(row.id)) {
      const moved = moduleFiles.moveTo({
        module: 'calendar-attachment', ownerId: row.id, slot: attachment.id,
        caseId: next.caseId, caseLabel: next.caseLabel, filename: attachment.filename,
        date: next.startAt || row.created_at
      });
      if (moved && moved.row && moved.row.name !== attachment.filename) {
        setAttachmentFilenameStmt.run(moved.row.name, attachment.id, row.id);
      }
    }
  } catch (error) {
    return res.status(409).json({ error: 'Termin wurde aktualisiert, seine Anlagen konnten aber nicht vollständig nachgezogen werden: ' + (error.message || error) });
  }
  res.json({ event: publicEvent(getStmt.get(row.id)) });
});

router.delete('/events/:id', requireEditCases, async (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Termin nicht gefunden.' });
  if (!itemVisible(row, req.session)) {
    return res.status(403).json({ error: 'Dieser private Termin gehört einem anderen Konto.' });
  }
  const assignment = fallZuordnung(row.case_id, row.case_label);
  if (!darfZuordnungBearbeiten(req.session, assignment)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  if (row.connection_id) {
    const conn = getConnectionStmt.get(row.connection_id);
    if (conn && conn.enabled) {
      try { await sync.deleteRemoteEvent(conn, row); } catch (error) { console.warn('[calendar] Löschen konnte nicht gespiegelt werden:', error.message); }
    }
  }
  for (const att of listAttachmentsStmt.all(row.id)) {
    moduleFiles.unlink('calendar-attachment', row.id, att.id);
    try { fs.unlinkSync(attachmentFilePath(row.id, att.id)); } catch (_e) { /* Legacy-Fallback */ }
  }
  deleteAttachmentsForEventStmt.run(row.id);
  deleteStmt.run(row.id);
  res.json({ ok: true });
});

// ===== Anlagen an Termine (Nutzerwunsch) - dasselbe Base64-in-JSON-Muster wie
// routes/cases.js' Dokumenten-Zwischenspeicher (kein zusaetzliches multipart/form-data-Paket noetig).
router.get('/events/:id/attachments', requireViewCases, (req, res) => {
  const event = getStmt.get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Termin nicht gefunden.' });
  if (!itemVisible(event, req.session)) {
    return res.status(403).json({ error: 'Dieser private Termin gehört einem anderen Konto.' });
  }
  const assignment = fallZuordnung(event.case_id, event.case_label);
  if (!darfZuordnungSehen(req.session, assignment)) {
    return res.status(403).json({ error: 'Dieser Fall ist Ihrem Konto nicht zugeordnet.' });
  }
  res.json({ attachments: listAttachmentsStmt.all(req.params.id).map(publicAttachment) });
});
router.post('/events/:id/attachments', requireEditCases, (req, res) => {
  const { id } = req.params;
  const event = getStmt.get(id);
  if (!event) return res.status(404).json({ error: 'Termin nicht gefunden.' });
  if (!itemVisible(event, req.session)) {
    return res.status(403).json({ error: 'Dieser private Termin gehört einem anderen Konto.' });
  }
  const assignment = fallZuordnung(event.case_id, event.case_label);
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
      module: 'calendar-attachment', ownerId: id, slot: attId,
      caseId: assignment.caseId, caseLabel: assignment.caseLabel,
      filename, mimeType: mimeType || 'application/octet-stream', bytes,
      createdBy: req.session.userId, date: event.start_at || event.created_at,
      detail: { eventId: id, attachmentId: attId }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Terminanlage konnte nicht sicher im Dokumentenspeicher abgelegt werden: ' + (error.message || error) });
  }
  insertAttachmentStmt.run({ id: attId, eventId: id, filename: central.name, mimeType: mimeType || 'application/octet-stream', size: bytes.length, userId: req.session.userId });
  res.status(201).json({ attachment: publicAttachment(getAttachmentStmt.get(attId, id)) });
});
router.get('/events/:id/attachments/:attId', requireViewCases, (req, res) => {
  const { id, attId } = req.params;
  const event = getStmt.get(id);
  if (!event) return res.status(404).json({ error: 'Termin nicht gefunden.' });
  if (!itemVisible(event, req.session)) {
    return res.status(403).json({ error: 'Dieser private Termin gehört einem anderen Konto.' });
  }
  const assignment = fallZuordnung(event.case_id, event.case_label);
  if (!darfZuordnungSehen(req.session, assignment)) {
    return res.status(403).json({ error: 'Dieser Fall ist Ihrem Konto nicht zugeordnet.' });
  }
  const row = getAttachmentStmt.get(attId, id);
  if (!row) return res.status(404).json({ error: 'Anlage nicht gefunden.' });
  const central = moduleFiles.resolve('calendar-attachment', id, attId, false);
  const filePath = (central && central.filePath) || attachmentFilePath(id, attId);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht mehr auf dem Server vorhanden.' });
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  const disposition = req.query.inline === '1' ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(row.filename)}"`);
  fs.createReadStream(filePath).pipe(res);
});
router.delete('/events/:id/attachments/:attId', requireEditCases, (req, res) => {
  const { id, attId } = req.params;
  const event = getStmt.get(id);
  if (!event) return res.status(404).json({ error: 'Termin nicht gefunden.' });
  if (!itemVisible(event, req.session)) {
    return res.status(403).json({ error: 'Dieser private Termin gehört einem anderen Konto.' });
  }
  const assignment = fallZuordnung(event.case_id, event.case_label);
  if (!darfZuordnungBearbeiten(req.session, assignment)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  if (!getAttachmentStmt.get(attId, id)) return res.status(404).json({ error: 'Anlage nicht gefunden.' });
  deleteAttachmentStmt.run(attId, id);
  moduleFiles.unlink('calendar-attachment', id, attId);
  try { fs.unlinkSync(attachmentFilePath(id, attId)); } catch (_e) { /* ignore */ }
  res.json({ ok: true });
});

// Zieht Termine von ALLEN aktiven Kalenderverbindungen - die eigentliche Abgleich-Logik lebt seit
// dem automatischen Minutentakt-Sync in sync-runner.js (ein Codepfad fuer Route UND Timer).
router.post('/sync', requireEditCases, async (req, res) => {
  const result = await syncRunner.syncEvents(req.session.userId);
  if (!result.ran) return res.status(400).json({ error: 'Keine aktive Kalenderverbindung vorhanden.' });
  const visible = nurSichtbareNachLabel(req.session, listVisibleStmt.all(req.session.userId));
  res.json({ events: visible.map(publicEvent), errors: result.errors });
});

module.exports = router;
