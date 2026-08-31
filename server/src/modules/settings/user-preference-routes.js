const express = require('express');
const db = require('../../database/index');
const { requireAuth, requireViewCases } = require('../../middleware/authentication');
const themePrefs = require('./theme-preferences');

const router = express.Router();
const ALLOWED_KEYS = new Set(['case-overview', 'mobile-navigation', 'dashboard', 'mode-intro']);
const MAX_PREFS_BYTES = 32 * 1024;
const DASHBOARD_CARD_SIZES = new Set(['compact', 'normal']);
const DASHBOARD_PANEL_SIZES = new Set([
  '1x1', '2x1', '3x1', '4x1',
  '1x2', '2x2', '3x2', '4x2',
  '1x3', '2x3', '3x3', '4x3'
]);

const getPrefs = db.prepare(`
  SELECT data_json, updated_at
  FROM user_ui_prefs
  WHERE user_id = ? AND pref_key = ?
`);
const upsertPrefs = db.prepare(`
  INSERT INTO user_ui_prefs (user_id, pref_key, data_json, updated_at)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, pref_key) DO UPDATE SET
    data_json = excluded.data_json,
    updated_at = excluded.updated_at
`);

function markOfficeMaterialization() {
  try {
    const service = require('../documents/materializations').current();
    if (service && typeof service.markOfficeDirty === 'function') service.markOfficeDirty();
  } catch (_error) { /* Der periodische Scanner bleibt das Sicherheitsnetz. */ }
}

router.use(requireAuth);

router.get('/theme', (req, res) => {
  res.json({ prefs: themePrefs.getThemeSettings(req.session.userId) });
});

router.put('/theme', (req, res) => {
  const source = req.body && typeof req.body.prefs === 'object' ? req.body.prefs : req.body;
  const prefs = themePrefs.setThemeSettings(req.session.userId, source, req.session.userId);
  res.json({ ok: true, prefs });
});

// Dashboard und Modus-Intro speichern ausschließlich nicht-fachliche Oberflächenzustände. Auch ein
// Konto ohne Fallansicht darf deshalb sein Dashboard konfigurieren und den einmalig bestätigten
// Intro-Status speichern. Die Fachrouten prüfen ihre Rechte weiterhin selbst.
// Fallübersicht/mobile Navigation behalten den bisherigen Fall-Sichtschutz.
router.use('/:key', (req, res, next) => {
  if (req.params.key === 'dashboard' || req.params.key === 'mode-intro') return next();
  return requireViewCases(req, res, next);
});

function validKey(req, res) {
  const key = String(req.params.key || '');
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: 'Unbekannte Oberflaechenpraeferenz.' });
    return null;
  }
  return key;
}

function dashboardPrefsValid(prefs) {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return false;
  if (prefs.version !== 1) return false;
  if (!Number.isInteger(prefs.columns) || prefs.columns < 1 || prefs.columns > 4) return false;
  if (!Array.isArray(prefs.cards) || prefs.cards.length > 7) return false;
  if (!Array.isArray(prefs.panels) || prefs.panels.length > 64) return false;

  const ids = new Set();
  for (const card of prefs.cards) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(String(card.id || ''))) return false;
    if (!DASHBOARD_CARD_SIZES.has(String(card.size || ''))) return false;
    if (ids.has(`card:${card.id}`)) return false;
    ids.add(`card:${card.id}`);
  }
  for (const panel of prefs.panels) {
    if (!panel || typeof panel !== 'object' || Array.isArray(panel)) return false;
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(String(panel.id || ''))) return false;
    if (!DASHBOARD_PANEL_SIZES.has(String(panel.size || ''))) return false;
    if (ids.has(`panel:${panel.id}`)) return false;
    ids.add(`panel:${panel.id}`);
  }
  return true;
}

function modeIntroPrefsValid(prefs) {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return false;
  if (prefs.version !== 1) return false;
  if (typeof prefs.localSeen !== 'boolean' || typeof prefs.onlineSeen !== 'boolean') return false;
  return Object.keys(prefs).every((key) => ['version', 'localSeen', 'onlineSeen'].includes(key));
}

router.get('/:key', (req, res) => {
  const key = validKey(req, res);
  if (!key) return;
  const row = getPrefs.get(req.session.userId, key);
  if (!row) return res.json({ prefs: null, updatedAt: null });
  try {
    return res.json({ prefs: JSON.parse(row.data_json), updatedAt: row.updated_at });
  } catch (_error) {
    return res.json({ prefs: null, updatedAt: row.updated_at });
  }
});

router.put('/:key', (req, res) => {
  const key = validKey(req, res);
  if (!key) return;
  const prefs = req.body && req.body.prefs;
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
    return res.status(400).json({ error: 'prefs muss ein Objekt sein.' });
  }
  if (key === 'dashboard' && !dashboardPrefsValid(prefs)) {
    return res.status(400).json({ error: 'Das Dashboard-Layout ist ungueltig.' });
  }
  if (key === 'mode-intro' && !modeIntroPrefsValid(prefs)) {
    return res.status(400).json({ error: 'Der Modus-Intro-Status ist ungueltig.' });
  }
  const data = JSON.stringify(prefs);
  if (Buffer.byteLength(data, 'utf8') > MAX_PREFS_BYTES) {
    return res.status(413).json({ error: 'Oberflaechenpraeferenz ist zu gross.' });
  }
  upsertPrefs.run(req.session.userId, key, data);
  markOfficeMaterialization();
  const row = getPrefs.get(req.session.userId, key);
  return res.json({ ok: true, prefs, updatedAt: row && row.updated_at });
});

module.exports = router;
