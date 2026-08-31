// Posteingang (Nutzerwunsch Abschnitt BB): gescannte Eingangspost hochladen, OCR/KI-Ergebnisse
// und die anpassbare Vorschlagsliste speichern. Bueroweit (wie Kalender/Aufgaben) - Rechte laufen
// ueber die Fall-Rechte (requireViewCases/requireEditCases), da die Eingangspost fallbezogen
// weiterverarbeitet wird. Datei-Bytes auf der Platte (gleiches Muster wie case-documents in
// routes/cases.js), Metadaten in inbox_documents (siehe db.js).
const express = require('express');
const path = require('path');
const { DATA_ROOT: DEFAULT_DATA_ROOT } = require('../../config/paths');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../../database/index');
const { requireViewCases, requireEditCases } = require('../../middleware/authentication');
const {
  nurSichtbareNachLabel,
  fallZuordnung,
  darfBearbeiten,
  darfZuordnungSehen,
  darfZuordnungBearbeiten
} = require('../cases/case-visibility');
const { createModuleFiles } = require('../documents/module-files');
const moduleFiles = createModuleFiles({ db, documents: require('../documents/routes').intern });

const router = express.Router();
// Echtzeit (2026-07-19): erfolgreiche Schreiboperationen an alle Fenster/Nutzer melden.
router.use(require('../office/events').middleware('inbox'));

const DATA_ROOT = path.resolve(DEFAULT_DATA_ROOT);
// Nur lesender Altbestands-Fallback. Neue Bytes liegen als doc_files im Dokumentenspeicher.
const INBOX_DIR = path.join(DATA_ROOT, 'inbox-documents');
const inboxFilePath = (id) => path.join(INBOX_DIR, id);

const listStmt = db.prepare('SELECT * FROM inbox_documents ORDER BY created_at DESC');
const getStmt = db.prepare('SELECT * FROM inbox_documents WHERE id = ?');
const insertStmt = db.prepare(`
  INSERT INTO inbox_documents
    (id, file_name, mime_type, size, case_id, case_label, inbox_date, received_date, created_by)
  VALUES
    (@id, @fileName, @mimeType, @size, @caseId, @caseLabel, @inboxDate, @receivedDate, @createdBy)
`);
const updateStmt = db.prepare(`
  UPDATE inbox_documents SET case_id=@caseId, case_label=@caseLabel, sender=@sender, short_desc=@shortDesc,
    inbox_date=@inboxDate, received_date=@receivedDate, summary=@summary, ocr_text=@ocrText, ai_notes=@aiNotes,
    suggestions_json=@suggestionsJson, retention_json=@retentionJson, frist_json=@fristJson, status=@status, updated_at=datetime('now') WHERE id=@id
`);
const deleteStmt = db.prepare('DELETE FROM inbox_documents WHERE id = ?');
const setFilenameStmt = db.prepare("UPDATE inbox_documents SET file_name=?, updated_at=datetime('now') WHERE id=?");

function publicDoc(r) {
  let suggestions = [];
  try { suggestions = JSON.parse(r.suggestions_json || '[]'); } catch (_e) { suggestions = []; }
  let retention = null;
  try { retention = r.retention_json ? JSON.parse(r.retention_json) : null; } catch (_e) { retention = null; }
  let frist = null;
  try { frist = r.frist_json ? JSON.parse(r.frist_json) : null; } catch (_e) { frist = null; }
  const assignment = fallZuordnung(r.case_id, r.case_label);
  return {
    id: r.id, fileName: r.file_name, mimeType: r.mime_type, size: r.size,
    caseId: assignment.caseId, caseLabel: assignment.caseLabel,
    sender: r.sender, shortDesc: r.short_desc,
    inboxDate: r.inbox_date || r.received_date || String(r.created_at || '').slice(0, 10),
    receivedDate: r.received_date, summary: r.summary, ocrText: r.ocr_text,
    aiNotes: r.ai_notes, suggestions, retention, frist, status: r.status, createdAt: r.created_at
  };
}

function assignmentForUpdate(body, row) {
  const hasId = Object.prototype.hasOwnProperty.call(body, 'caseId');
  const hasLabel = Object.prototype.hasOwnProperty.call(body, 'caseLabel');
  if (hasId) return fallZuordnung(body.caseId, hasLabel ? body.caseLabel : row.case_label);
  if (hasLabel) {
    // Alte Clients senden nur das Label. Solange es unverändert ist, darf
    // dadurch eine bereits gespeicherte eindeutige ID nicht verloren gehen.
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
  /* Primär entscheidet case_id. Nur eindeutiger Altbestand ohne ID darf über
     case_label aufgelöst werden; ein mehrdeutiges Label bleibt unzugeordnet. */
  res.json({ documents: nurSichtbareNachLabel(req.session, listStmt.all()).map(publicDoc) });
});

router.post('/', requireEditCases, (req, res) => {
  const { fileName, mimeType, dataBase64, receivedDate, inboxDate, caseId, caseLabel } = req.body || {};
  if (!fileName || !dataBase64) return res.status(400).json({ error: 'fileName und dataBase64 erforderlich.' });
  const assignment = fallZuordnung(caseId, caseLabel);
  if (rejectInvalidAssignment(res, assignment)) return;
  if (assignment.caseId && !darfBearbeiten(req.session, assignment.caseId)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const bytes = Buffer.from(String(dataBase64), 'base64');
  if (bytes.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Datei darf höchstens 25 MB groß sein.' });
  const id = crypto.randomUUID();
  const day = String(inboxDate || receivedDate || new Date().toISOString()).slice(0, 10);
  let central;
  try {
    central = moduleFiles.store({
      module: 'inbox', ownerId: id, slot: '', filename: fileName,
      mimeType: String(mimeType || 'application/octet-stream'), bytes,
      caseId: assignment.caseId, caseLabel: assignment.caseLabel,
      createdBy: req.session.userId, date: day,
      detail: { inboxDate: day, caseId: assignment.caseId }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Posteingang konnte nicht sicher im Dokumentenspeicher abgelegt werden: ' + (error.message || error) });
  }
  insertStmt.run({
    id, fileName: central.name, mimeType: String(mimeType || 'application/octet-stream'),
    size: bytes.length, caseId: assignment.caseId, caseLabel: assignment.caseLabel,
    inboxDate: day, receivedDate: String(receivedDate || day).slice(0, 10),
    createdBy: req.session.userId
  });
  res.status(201).json({ document: publicDoc(getStmt.get(id)) });
});

router.get('/:id/file', requireViewCases, (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
  const assignment = fallZuordnung(row.case_id, row.case_label);
  if (!darfZuordnungSehen(req.session, assignment)) {
    return res.status(403).json({ error: 'Dieser Fall ist Ihrem Konto nicht zugeordnet.' });
  }
  const central = moduleFiles.resolve('inbox', row.id, '', false);
  const filePath = (central && central.filePath) || inboxFilePath(row.id);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.send(fs.readFileSync(filePath));
});

router.put('/:id', requireEditCases, (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
  const currentAssignment = fallZuordnung(row.case_id, row.case_label);
  if (!darfZuordnungBearbeiten(req.session, currentAssignment)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const b = req.body || {};
  const assignment = assignmentForUpdate(b, row);
  if (rejectInvalidAssignment(res, assignment)) return;
  if (assignment.caseId && !darfBearbeiten(req.session, assignment.caseId)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const pick = (val, prev) => (val == null ? prev : String(val));
  updateStmt.run({
    id: row.id,
    caseId: assignment.caseId,
    caseLabel: assignment.caseLabel,
    sender: pick(b.sender, row.sender),
    shortDesc: pick(b.shortDesc, row.short_desc),
    inboxDate: pick(b.inboxDate, row.inbox_date || row.received_date).slice(0, 10),
    receivedDate: pick(b.receivedDate, row.received_date).slice(0, 10),
    summary: pick(b.summary, row.summary),
    ocrText: pick(b.ocrText, row.ocr_text),
    aiNotes: pick(b.aiNotes, row.ai_notes),
    suggestionsJson: b.suggestions != null ? JSON.stringify(b.suggestions) : row.suggestions_json,
    retentionJson: b.retention !== undefined ? (b.retention ? JSON.stringify(b.retention) : '') : row.retention_json,
    fristJson: b.frist !== undefined ? (b.frist ? JSON.stringify(b.frist) : '') : row.frist_json,
    status: pick(b.status, row.status)
  });
  if (b.caseId !== undefined || b.caseLabel !== undefined) {
    const fresh = getStmt.get(row.id);
    try {
      const moved = moduleFiles.moveTo({
        module: 'inbox', ownerId: row.id, slot: '',
        caseId: fresh.case_id, caseLabel: fresh.case_label,
        filename: fresh.file_name, date: fresh.inbox_date || fresh.received_date
      });
      if (moved && moved.row && moved.row.name !== fresh.file_name) setFilenameStmt.run(moved.row.name, row.id);
    } catch (error) {
      return res.status(409).json({ error: 'Posteingangsdokument wurde aktualisiert, konnte aber nicht sicher in die Fallakte verschoben werden: ' + (error.message || error) });
    }
  }
  res.json({ document: publicDoc(getStmt.get(row.id)) });
});

router.delete('/:id', requireEditCases, (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
  const assignment = fallZuordnung(row.case_id, row.case_label);
  if (!darfZuordnungBearbeiten(req.session, assignment)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  moduleFiles.unlink('inbox', row.id, '');
  try { fs.unlinkSync(inboxFilePath(row.id)); } catch (_e) { /* Datei fehlt - Metadaten trotzdem entfernen */ }
  deleteStmt.run(row.id);
  res.json({ ok: true });
});

module.exports = router;
