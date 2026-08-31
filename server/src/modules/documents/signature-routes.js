// Unterschriften (Nutzerwunsch): mehrere hochladbare Signaturbilder statt der EINEN fest im Client
// einkodierten SIGNATURE_DATA. Jede Signatur gehoert einem Nutzer (owner_user_id) und ist entweder
// privat (nur er) oder bueroweit geteilt (alle berechtigten Nutzer).
//
// Sichtbarkeits-Muster bewusst identisch zu calendar_connections (siehe db.js ~502): sehen/nutzen darf
// man eine Signatur, wenn visibility='public' ODER owner_user_id = ich. AENDERN/LOESCHEN darf nur der
// Eigentuemer - oder ein Admin (der raeumt auch Signaturen ausgeschiedener Mitarbeiter auf).
//
// Bilddaten liegen als data:-URL in der Zeile (nicht als Datei): eine Unterschrift ist klein, und der
// Dokumenteneditor/PDF-Export setzt sie ohnehin als data:-URL ein - so bleibt der Weg derselbe wie
// bisher mit SIGNATURE_DATA. Groesse deshalb hart begrenzt (MAX_DATA_URL), damit die DB nicht
// unbemerkt mit Megabyte-PNGs volllaeuft.

const express = require('express');
const crypto = require('crypto');
const db = require('../../database/index');
const { requireAuth } = require('../../middleware/authentication');
const { darfBearbeiten } = require('../cases/case-visibility');

const router = express.Router();
router.use(requireAuth);

// ~2 MB data:-URL (Base64 ist ~4/3 der Bytes) - fuer eine Unterschrift sehr grosszuegig.
const MAX_DATA_URL = 2 * 1024 * 1024;
const ALLOWED_PREFIX = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

const listStmt = db.prepare(
  "SELECT id, owner_user_id, name, data_url, visibility, updated_at FROM signatures "
  + "WHERE visibility = 'public' OR owner_user_id = ? ORDER BY name COLLATE NOCASE, created_at"
);
// Admin-Verwaltungssicht (?all=1): ALLE Signaturen inkl. der privaten anderer Nutzer, mit Besitzernamen.
// Bewusst eine EIGENE Route-Variante statt die Standardliste fuer Admins aufzubohren: die Standardliste
// speist das Auswahl-Dropdown in Editor/Export - dort haetten fremde PRIVATE Unterschriften nichts zu
// suchen, auch nicht beim Admin.
// Beschriftungs-Kette wie in publicUser (routes/admin.js): Vor-/Nachname → display_name → username.
const listAllStmt = db.prepare(
  'SELECT s.id, s.owner_user_id, s.name, s.data_url, s.visibility, s.updated_at, '
  + "COALESCE("
  + "  NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''),"
  + "  NULLIF(TRIM(COALESCE(u.display_name,'')), ''),"
  + '  u.username'
  + ') AS owner_name '
  + 'FROM signatures s LEFT JOIN users u ON u.id = s.owner_user_id '
  + 'ORDER BY owner_name COLLATE NOCASE, s.name COLLATE NOCASE, s.created_at'
);
const userExistsStmt = db.prepare('SELECT id FROM users WHERE id = ?');
const getStmt = db.prepare('SELECT * FROM signatures WHERE id = ?');
const caseSignerStmt = db.prepare('SELECT owner_user_id, stammdaten_json FROM cases WHERE id = ?');
const activeUsersStmt = db.prepare(`
  SELECT id, first_name, last_name, display_name, username
    FROM users
   WHERE active = 1
   ORDER BY id
`);
const caregiverUserStmt = db.prepare(`
  SELECT id, first_name, last_name, display_name, username
    FROM users
   WHERE id = ?
`);
const caregiverSignatureStmt = db.prepare(`
  SELECT id, owner_user_id, name, data_url, visibility, updated_at
    FROM signatures
   WHERE owner_user_id = ?
   ORDER BY updated_at DESC, created_at DESC, name COLLATE NOCASE
   LIMIT 1
`);
const insertStmt = db.prepare(
  'INSERT INTO signatures (id, owner_user_id, name, data_url, visibility, updated_by) '
  + 'VALUES (@id, @ownerUserId, @name, @dataUrl, @visibility, @userId)'
);
const updateStmt = db.prepare(
  "UPDATE signatures SET name = @name, data_url = @dataUrl, visibility = @visibility, "
  + "updated_at = datetime('now'), updated_by = @userId WHERE id = @id"
);
const deleteStmt = db.prepare('DELETE FROM signatures WHERE id = ?');

function cleanName(v) {
  return String((v == null ? '' : v)).trim().slice(0, 80);
}
function cleanVisibility(v) {
  return v === 'public' ? 'public' : 'private';
}
// Gibt null zurueck, wenn die data:-URL nicht plausibel ist (Fremdformat/zu gross/kein Bild).
function cleanDataUrl(v) {
  const s = String((v == null ? '' : v)).trim();
  if (!s) return null;
  if (s.length > MAX_DATA_URL) return null;
  if (!ALLOWED_PREFIX.test(s)) return null;
  return s;
}
function mayWrite(req, row) {
  return !!row && (row.owner_user_id === req.session.userId || req.session.isAdmin);
}
function personKey(firstName, lastName) {
  return `${String(firstName || '').trim()} ${String(lastName || '').trim()}`
    .toLocaleLowerCase('de-DE').replace(/\s+/g, ' ').trim();
}
function caregiverUserId(row) {
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.stammdaten_json || '{}') || {}; } catch (_error) { data = {}; }
  const explicit = Number(data.rechtlicherBetreuerUserId);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;

  const stored = String(data.rechtlicherBetreuer || '').trim();
  /* Etappe 2 (29.08.2026): das Feld traegt eine Personen-ID - die Person kennt ihr Konto
     direkt. Der Namensabgleich darunter bleibt fuer den Lokal-/Altbestand. */
  if (stored) {
    const person = db.prepare('SELECT user_id FROM persons WHERE id = ?').get(stored);
    if (person) return person.user_id == null ? (row.owner_user_id == null ? null : Number(row.owner_user_id)) : Number(person.user_id);
  }
  const storedKey = stored.toLocaleLowerCase('de-DE').replace(/\s+/g, ' ').trim();
  if (storedKey) {
    const matches = activeUsersStmt.all().filter((user) => personKey(user.first_name, user.last_name) === storedKey);
    if (matches.length === 1) return Number(matches[0].id);
    const ownerMatch = matches.find((user) => Number(user.id) === Number(row.owner_user_id));
    if (ownerMatch) return Number(ownerMatch.id);
  }
  return row.owner_user_id == null ? null : Number(row.owner_user_id);
}
function caregiverToClient(userId) {
  const user = caregiverUserStmt.get(userId);
  if (!user) return null;
  const fullName = `${String(user.first_name || '').trim()} ${String(user.last_name || '').trim()}`.trim();
  return {
    userId: Number(user.id),
    firstName: user.first_name || '',
    lastName: user.last_name || '',
    name: fullName || user.display_name || user.username || ''
  };
}
function toClient(row, req) {
  return {
    id: row.id,
    name: row.name,
    dataUrl: row.data_url,
    visibility: row.visibility,
    ownerUserId: row.owner_user_id,
    // isOwn steuert im Client, ob Umbenennen/Teilen/Loeschen angeboten wird - eine geteilte fremde
    // Signatur darf man benutzen, aber nicht veraendern.
    isOwn: row.owner_user_id === req.session.userId,
    updatedAt: row.updated_at,
  };
}

/* Alle fuer mich SICHTBAREN Signaturen: meine eigenen + alle bueroweit geteilten. Diese Liste speist
   das Auswahl-Dropdown in Editor/Export - fremde PRIVATE Unterschriften gehoeren hier bewusst NICHT
   hinein, auch nicht fuer Admins (sonst haette ein Admin im Dokument die Privatunterschriften aller
   Kollegen zur Auswahl).
   ?all=1 (nur Admin) = Verwaltungssicht: ALLE Signaturen inkl. fremder privater, mit Besitzernamen. */
router.get('/', (req, res) => {
  if (String(req.query.all || '') === '1') {
    if (!req.session.isAdmin) return res.status(403).json({ error: 'Nur Administratoren können alle Unterschriften einsehen.' });
    const all = listAllStmt.all().map((r) => ({ ...toClient(r, req), ownerName: r.owner_name || '(unbekannt)' }));
    return res.json({ signatures: all });
  }
  const rows = listStmt.all(req.session.userId);
  res.json({ signatures: rows.map((r) => toClient(r, req)) });
});

/* Dynamische Dokumentoption „Unterschrift des Betreuers": Es wird ausschließlich die Signatur
   des dem konkreten Fall zugeordneten Betreuers ausgeliefert. Der Aufrufer muss den Fall bearbeiten
   dürfen; damit werden private Signaturen nicht über eine bloße Lesefreigabe offengelegt. */
router.get('/case/:caseId', (req, res) => {
  const caseId = String(req.params.caseId || '');
  if (!darfBearbeiten(req.session, caseId)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const row = caseSignerStmt.get(caseId);
  if (!row) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  const ownerUserId = caregiverUserId(row);
  if (!ownerUserId) return res.json({ signature: null, reason: 'no-caregiver' });
  const caregiver = caregiverToClient(ownerUserId);
  const signature = caregiverSignatureStmt.get(ownerUserId);
  if (!signature) return res.json({ signature: null, caregiver, ownerUserId, reason: 'no-signature' });
  return res.json({
    caregiver,
    signature: {
      id: signature.id,
      name: signature.name,
      dataUrl: signature.data_url,
      ownerUserId: signature.owner_user_id,
      updatedAt: signature.updated_at
    }
  });
});

/* Neue Signatur hochladen. Standard-Eigentuemer ist der angemeldete Nutzer.
   ownerUserId != ich ist NUR Admins erlaubt (Nutzerwunsch: „Der Admin sollte für alle User
   Unterschriften hochladen können") - z. B. wenn der Scan der Unterschrift zentral vorliegt. Fuer
   Nicht-Admins wird ein mitgeschicktes ownerUserId bewusst IGNORIERT statt mit einem Fehler
   quittiert: es gibt keinen legitimen Grund, dass ein normaler Client es setzt. */
router.post('/', (req, res) => {
  const name = cleanName(req.body && req.body.name);
  const dataUrl = cleanDataUrl(req.body && req.body.dataUrl);
  if (!name) return res.status(400).json({ error: 'Bitte einen Namen für die Unterschrift angeben.' });
  if (!dataUrl) return res.status(400).json({ error: 'Ungültige oder zu große Bilddatei (erlaubt: PNG, JPEG, WebP, SVG; max. 2 MB).' });
  let ownerUserId = req.session.userId;
  const wunsch = req.body && req.body.ownerUserId;
  if (req.session.isAdmin && wunsch != null && String(wunsch) !== '' && Number(wunsch) !== req.session.userId) {
    const ziel = Number(wunsch);
    if (!Number.isInteger(ziel) || !userExistsStmt.get(ziel)) return res.status(400).json({ error: 'Zielnutzer nicht gefunden.' });
    ownerUserId = ziel;
  }
  const id = crypto.randomUUID();
  insertStmt.run({
    id,
    ownerUserId,
    name,
    dataUrl,
    visibility: cleanVisibility(req.body && req.body.visibility),
    userId: req.session.userId,
  });
  res.status(201).json({ id });
});

// Aendern (Name, Sichtbarkeit, optional neues Bild). dataUrl weglassen = Bild unveraendert lassen.
router.put('/:id', (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Unterschrift nicht gefunden.' });
  if (!mayWrite(req, row)) return res.status(403).json({ error: 'Nur die eigene Unterschrift kann geändert werden.' });
  const hasNewImage = req.body && req.body.dataUrl != null && String(req.body.dataUrl).trim() !== '';
  const dataUrl = hasNewImage ? cleanDataUrl(req.body.dataUrl) : row.data_url;
  if (!dataUrl) return res.status(400).json({ error: 'Ungültige oder zu große Bilddatei (erlaubt: PNG, JPEG, WebP, SVG; max. 2 MB).' });
  const name = req.body && req.body.name != null ? cleanName(req.body.name) : row.name;
  if (!name) return res.status(400).json({ error: 'Bitte einen Namen für die Unterschrift angeben.' });
  const visibility = req.body && req.body.visibility != null ? cleanVisibility(req.body.visibility) : row.visibility;
  updateStmt.run({ id: row.id, name, dataUrl, visibility, userId: req.session.userId });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Unterschrift nicht gefunden.' });
  if (!mayWrite(req, row)) return res.status(403).json({ error: 'Nur die eigene Unterschrift kann gelöscht werden.' });
  deleteStmt.run(row.id);
  res.json({ ok: true });
});

module.exports = router;
