// Bytes-Ablage der PDF-Vordrucke selbst gebauter Formulare (Formulareditor, 24.08.2026).
// Companion zu office_json['custom_forms']: dort steht die Formular-DEFINITION (Zustand,
// 15-MB-JSON-Deckel), hier liegen die PDF-BYTES - wie sich intake_files zu case_intakes verhaelt.
// Base64-in-JSON wie intake-file-routes.js; nutzt den globalen express.json-Deckel aus index.js.
// Rechte: Lesen = Dokumente ansehen, Schreiben/Loeschen = Buerostammdaten verwalten
// (deckungsgleich mit dem Schreibgate der custom_forms-Definition in json-routes.js).
const express = require('express');
const db = require('../../database');
const {
  requireAuth,
  requireViewDocuments,
  requireOfficeProfileEdit,
} = require('../../middleware/authentication');

const router = express.Router();
router.use(requireAuth);

const MAX_FILE = 5 * 1024 * 1024; // 5 MB (decodiert) - eine Vordruckseite in PDF ist weit kleiner

const getStmt = db.prepare('SELECT * FROM custom_form_templates WHERE form_id = ?');
const metaStmt = db.prepare('SELECT form_id, file_name, mime_type, size, updated_at FROM custom_form_templates WHERE form_id = ?');
const upsertStmt = db.prepare(`
  INSERT INTO custom_form_templates (form_id, file_name, mime_type, size, data, updated_at, updated_by)
  VALUES (@form_id, @file_name, @mime_type, @size, @data, datetime('now'), @updated_by)
  ON CONFLICT(form_id) DO UPDATE SET
    file_name=excluded.file_name, mime_type=excluded.mime_type, size=excluded.size,
    data=excluded.data, updated_at=excluded.updated_at, updated_by=excluded.updated_by`);
const delStmt = db.prepare('DELETE FROM custom_form_templates WHERE form_id = ?');

// Eigenformular-Kennungen sind immer custom_<slug>; hier zusaetzlich streng gefiltert,
// damit keine Pfad-/SQL-Sonderzeichen durchrutschen.
function cleanFormId(v) {
  const s = String(v || '').trim();
  return /^custom_[a-z0-9_]{1,72}$/.test(s) ? s : null;
}

// Nur Metadaten (ohne Bytes) - fuers Anzeigen "Vorlage hinterlegt: ja/nein, Groesse".
router.get('/:formId/meta', requireViewDocuments, (req, res) => {
  const formId = cleanFormId(req.params.formId);
  if (!formId) return res.status(400).json({ error: 'Ungültige Formular-Kennung.' });
  const row = metaStmt.get(formId);
  if (!row) return res.status(404).json({ error: 'Keine Vorlage hinterlegt.' });
  res.json({ ok: true, ...row });
});

// Die rohen PDF-Bytes (fuer Zuordnungseditor und Export).
router.get('/:formId', requireViewDocuments, (req, res) => {
  const formId = cleanFormId(req.params.formId);
  if (!formId) return res.status(400).json({ error: 'Ungültige Formular-Kennung.' });
  const row = getStmt.get(formId);
  if (!row) return res.status(404).json({ error: 'Keine Vorlage hinterlegt.' });
  res.setHeader('Content-Type', row.mime_type || 'application/pdf');
  res.setHeader('X-Filename', encodeURIComponent(row.file_name || 'vordruck.pdf'));
  res.send(row.data);
});

router.put('/:formId', requireOfficeProfileEdit, (req, res) => {
  const formId = cleanFormId(req.params.formId);
  if (!formId) return res.status(400).json({ error: 'Ungültige Formular-Kennung.' });
  const fileName = String((req.body && req.body.fileName) || 'vordruck.pdf').slice(0, 300).trim() || 'vordruck.pdf';
  const mimeType = String((req.body && req.body.mimeType) || 'application/pdf').slice(0, 120);
  const b64 = String((req.body && req.body.dataBase64) || '');
  if (!b64) return res.status(400).json({ error: 'dataBase64 erforderlich.' });
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (_e) { return res.status(400).json({ error: 'dataBase64 ist nicht lesbar.' }); }
  if (!buf.length) return res.status(400).json({ error: 'Leere Datei.' });
  if (buf.length > MAX_FILE) return res.status(413).json({ error: 'Vorlage größer als 5 MB.' });
  // %PDF-Signatur pruefen, damit nur echte PDF-Vordrucke landen.
  if (buf.slice(0, 5).toString('latin1') !== '%PDF-') {
    return res.status(415).json({ error: 'Nur PDF-Dateien werden als Vordruck akzeptiert.' });
  }
  upsertStmt.run({
    form_id: formId, file_name: fileName, mime_type: 'application/pdf',
    size: buf.length, data: buf, updated_by: (req.session && req.session.userId) || null,
  });
  res.status(201).json({ ok: true, size: buf.length });
});

router.delete('/:formId', requireOfficeProfileEdit, (req, res) => {
  const formId = cleanFormId(req.params.formId);
  if (!formId) return res.status(400).json({ error: 'Ungültige Formular-Kennung.' });
  delStmt.run(formId);
  res.json({ ok: true });
});

module.exports = router;
