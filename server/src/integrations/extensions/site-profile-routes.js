// Session-authentifizierte Verwaltung der Site-Profile (trainierte Formular-Zuordnungen) fuer die
// HAUPT-APP ("Online-Formulare"-Modul). Dieselbe Tabelle site_profiles wie die Extension-Bearer-
// Route (routes/ext.js), aber per Cookie-Session statt Bearer-Token. Zweck: bueroweit geteilte
// Profile zentral ansehen/umbenennen/URL-Muster-bearbeiten/Feld-Zuordnung-entfernen/loeschen.
// Das Neu-ERFASSEN geaenderter Felder bleibt bewusst der Extension vorbehalten (die Selektor-Ketten
// muessen von der echten, ge-oeffneten Seite gepickt werden) - hier gibt es nur Metadaten-Pflege.
const express = require('express');
const crypto = require('crypto');
const db = require('../../database/index');
const { requireAuth, requireViewCases, requireEditCases } = require('../../middleware/authentication');
const { logAction } = require('../../middleware/audit');

const router = express.Router();

const listStmt = db.prepare('SELECT id, name, url_pattern, mapping_json, updated_at, updated_by, apply_count, field_hits, field_misses, last_applied_at FROM site_profiles WHERE deleted = 0 ORDER BY updated_at DESC');
const getStmt = db.prepare('SELECT * FROM site_profiles WHERE id = ? AND deleted = 0');
const updateStmt = db.prepare("UPDATE site_profiles SET name=@name, url_pattern=@urlPattern, mapping_json=@mappingJson, updated_at=datetime('now'), updated_by=@userId WHERE id=@id");
const softDeleteStmt = db.prepare("UPDATE site_profiles SET deleted=1, updated_at=datetime('now'), updated_by=? WHERE id=?");
const userNameStmt = db.prepare('SELECT username, display_name FROM users WHERE id = ?');

// Mapping vor dem Speichern normalisieren/deckeln (identisch zur Extension-Fassade in routes/ext.js).
function normalizedMapping(m) {
  m = m && typeof m === 'object' ? m : {};
  return JSON.stringify({
    version: 1,
    urlPatterns: Array.isArray(m.urlPatterns) ? m.urlPatterns.map(String).slice(0, 10) : [],
    contextDefault: String(m.contextDefault || 'auto'),
    fields: Array.isArray(m.fields) ? m.fields.slice(0, 200) : [],
    actions: Array.isArray(m.actions) ? m.actions.slice(0, 40) : [],
    // Portal-Metadaten (Nutzerwunsch 2026-07-17): Einstiegs-/Login-URL + freie Notiz (z. B. wo das
    // Konto im Browser-Passwortmanager liegt). NIE Zugangsdaten - nur Wegweiser.
    portalUrl: String(m.portalUrl || '').slice(0, 500),
    portalNote: String(m.portalNote || '').slice(0, 500)
  });
}
function profileStale(row) {
  const hits = row.field_hits || 0, misses = row.field_misses || 0, tot = hits + misses;
  if ((row.apply_count || 0) < 4 || tot < 4) return false;
  return misses / tot > 0.30;
}
function publicProfile(row) {
  let mapping = {};
  try { mapping = JSON.parse(row.mapping_json || '{}'); } catch (_e) { mapping = {}; }
  let byName = '';
  if (row.updated_by) { const u = userNameStmt.get(row.updated_by); byName = u ? (u.display_name || u.username) : ''; }
  return {
    id: row.id, name: row.name, urlPattern: row.url_pattern, mapping, updatedAt: row.updated_at, updatedBy: byName,
    stats: { applyCount: row.apply_count || 0, fieldHits: row.field_hits || 0, fieldMisses: row.field_misses || 0, lastAppliedAt: row.last_applied_at || '', stale: profileStale(row) }
  };
}

router.use(requireAuth);

// Alle angelernten Formulare (bueroweit).
router.get('/', requireViewCases, (req, res) => {
  res.json({ profiles: listStmt.all().map(publicProfile) });
});

// Neuen Eintrag aus der HAUPT-APP anlegen (Nutzerwunsch 2026-07-17: "+ Portal hinterlegen" im
// Online-Formulare-Menü). Typisch ein PORTAL ohne Feld-Zuordnungen (portalUrl/portalNote im
// mapping); trainiert wird spaeter ueber die Extension - derselbe Eintrag waechst dann mit.
const insertStmt = db.prepare('INSERT INTO site_profiles (id, name, url_pattern, mapping_json, updated_by) VALUES (@id, @name, @urlPattern, @mappingJson, @userId)');
router.post('/', requireEditCases, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name fehlt.' });
  const mappingJson = normalizedMapping(req.body?.mapping);
  const id = crypto.randomUUID();
  insertStmt.run({ id, name, urlPattern: String(req.body?.urlPattern || JSON.parse(mappingJson).urlPatterns[0] || ''), mappingJson, userId: req.session.userId });
  logAction(req, 'siteProfile.create', 'site_profile', id, { name });
  res.status(201).json({ id });
});

// Metadaten aktualisieren: Name / URL-Muster / (optional) bearbeitetes mapping (z. B. Feld entfernt).
router.put('/:id', requireEditCases, (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Profil nicht gefunden.' });
  const name = String(req.body && req.body.name != null ? req.body.name : row.name).slice(0, 120);
  const urlPattern = String(req.body && req.body.urlPattern != null ? req.body.urlPattern : row.url_pattern).slice(0, 500);
  const mappingJson = (req.body && req.body.mapping && typeof req.body.mapping === 'object')
    ? normalizedMapping(req.body.mapping) : row.mapping_json;
  updateStmt.run({ id: row.id, name, urlPattern, mappingJson, userId: req.session.userId });
  logAction(req, 'site-profile.update', 'site-profile', row.id, { name });
  res.json({ profile: publicProfile(getStmt.get(row.id)) });
});

// Ganzes Formular loeschen (Soft-Delete, wie die Extension-Route).
router.delete('/:id', requireEditCases, (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Profil nicht gefunden.' });
  softDeleteStmt.run(req.session.userId, row.id);
  logAction(req, 'site-profile.delete', 'site-profile', row.id, { name: row.name });
  res.json({ ok: true });
});

module.exports = router;
