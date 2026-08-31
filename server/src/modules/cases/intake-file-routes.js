// Datei-Zwischenspeicher des gefuehrten Fallbeginns (Nutzerwunsch 2026-07-18): Original-Dateien
// eines Intake-Laufs liegen bis zu dessen Abschluss auf dem Server, damit ein gespeicherter
// Zwischenstand mitsamt Dateien exakt fortgesetzt werden kann. Rechte wie die uebrigen
// Fall-Arbeitsstaende: Lesen mit Fall-Sichtrecht, Schreiben/Loeschen mit Fall-Bearbeitungsrecht.
// Bewusst KEINE Kopplung an einen Fall (der existiert beim Intake noch nicht) - der Schluessel ist
// die draft_id des Zwischenstands (office_json case_intakes).

const crypto = require('crypto');
const express = require('express');
const db = require('../../database/index');
const { requireAuth, requireViewCases, requireEditCases } = require('../../middleware/authentication');

const router = express.Router();
router.use(requireAuth);

// 25 MB je Datei (wie der Posteingang-Upload); Gesamtdeckel je Lauf 300 MB als Ausufer-Schutz.
const MAX_FILE = 25 * 1024 * 1024;
const MAX_DRAFT_TOTAL = 300 * 1024 * 1024;

const listStmt = db.prepare('SELECT id, file_name, mime_type, size, created_at FROM intake_files WHERE draft_id = ? ORDER BY created_at, file_name');
const totalStmt = db.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM intake_files WHERE draft_id = ?');
const getStmt = db.prepare('SELECT * FROM intake_files WHERE draft_id = ? AND id = ?');
const dupStmt = db.prepare('SELECT id FROM intake_files WHERE draft_id = ? AND file_name = ? AND size = ?');
const insStmt = db.prepare('INSERT INTO intake_files (id, draft_id, file_name, mime_type, size, data, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
const delOneStmt = db.prepare('DELETE FROM intake_files WHERE draft_id = ? AND id = ?');
const delDraftStmt = db.prepare('DELETE FROM intake_files WHERE draft_id = ?');

function cleanDraftId(v) {
  const s = String(v || '').trim();
  return /^[a-zA-Z0-9._-]{4,80}$/.test(s) ? s : null;
}

router.get('/:draftId', requireViewCases, (req, res) => {
  const draftId = cleanDraftId(req.params.draftId);
  if (!draftId) return res.status(400).json({ error: 'Ungültige Lauf-Kennung.' });
  res.json({ files: listStmt.all(draftId).map(r => ({ id: r.id, fileName: r.file_name, mimeType: r.mime_type, size: r.size, createdAt: r.created_at })) });
});

router.get('/:draftId/:fileId', requireViewCases, (req, res) => {
  const draftId = cleanDraftId(req.params.draftId);
  if (!draftId) return res.status(400).json({ error: 'Ungültige Lauf-Kennung.' });
  const row = getStmt.get(draftId, String(req.params.fileId || ''));
  if (!row) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader('X-Filename', encodeURIComponent(row.file_name || 'datei'));
  res.send(row.data);
});

router.post('/:draftId', requireEditCases, (req, res) => {
  const draftId = cleanDraftId(req.params.draftId);
  if (!draftId) return res.status(400).json({ error: 'Ungültige Lauf-Kennung.' });
  const fileName = String(req.body?.fileName || '').slice(0, 300).trim();
  const mimeType = String(req.body?.mimeType || 'application/octet-stream').slice(0, 120);
  const b64 = String(req.body?.dataBase64 || '');
  if (!fileName || !b64) return res.status(400).json({ error: 'fileName und dataBase64 erforderlich.' });
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (_e) { return res.status(400).json({ error: 'dataBase64 ist nicht lesbar.' }); }
  if (!buf.length) return res.status(400).json({ error: 'Leere Datei.' });
  if (buf.length > MAX_FILE) return res.status(413).json({ error: 'Datei größer als 25 MB.' });
  if (totalStmt.get(draftId).total + buf.length > MAX_DRAFT_TOTAL) return res.status(413).json({ error: 'Zwischenspeicher dieses Laufs ist voll (max. 300 MB).' });
  // Dublettenschutz (Name+Groesse): erneutes Hochladen derselben Datei ueberschreibt nicht,
  // sondern liefert die bestehende Kennung - der Client darf gefahrlos mehrfach hochladen.
  const dup = dupStmt.get(draftId, fileName, buf.length);
  if (dup) return res.json({ id: dup.id, deduped: true });
  const id = crypto.randomUUID();
  insStmt.run(id, draftId, fileName, mimeType, buf.length, buf, req.session.userId);
  res.status(201).json({ id });
});

router.delete('/:draftId/:fileId', requireEditCases, (req, res) => {
  const draftId = cleanDraftId(req.params.draftId);
  if (!draftId) return res.status(400).json({ error: 'Ungültige Lauf-Kennung.' });
  delOneStmt.run(draftId, String(req.params.fileId || ''));
  res.json({ ok: true });
});

router.delete('/:draftId', requireEditCases, (req, res) => {
  const draftId = cleanDraftId(req.params.draftId);
  if (!draftId) return res.status(400).json({ error: 'Ungültige Lauf-Kennung.' });
  delDraftStmt.run(draftId);
  res.json({ ok: true });
});

module.exports = router;
