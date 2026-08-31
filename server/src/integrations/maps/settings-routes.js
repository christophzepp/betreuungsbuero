// Karten-/Navigationseinstellungen (Nutzerwunsch Runde 12): aus den Buerostammdaten herausgeloest,
// eigenes buero-weites Singleton (gleiches Muster wie routes/office-profile.js). Lesen ist fuer JEDEN
// angemeldeten Nutzer erlaubt, Schreiben braucht Admin ODER can_manage_map_settings
// (requireMapSettingsEdit, siehe auth.js).

const express = require('express');
const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const mapProviders = require('./providers');
const { requireAuth, requireMapSettingsEdit } = require('../../middleware/authentication');
const { logAction } = require('../../middleware/audit');

const router = express.Router();

const getSettingsStmt = db.prepare('SELECT * FROM map_settings WHERE id = 1');
const upsertSettingsStmt = db.prepare(`
  INSERT INTO map_settings (id, active_provider, google_maps_api_key_encrypted, here_api_key_encrypted)
  VALUES (1, @activeProvider, @googleMapsApiKeyEncrypted, @hereApiKeyEncrypted)
  ON CONFLICT(id) DO UPDATE SET
    active_provider = excluded.active_provider,
    google_maps_api_key_encrypted = excluded.google_maps_api_key_encrypted,
    here_api_key_encrypted = excluded.here_api_key_encrypted,
    updated_at = datetime('now')
`);

const VALID_PROVIDERS = ['osm', 'google', 'here'];

function publicSettings(row) {
  return {
    activeProvider: VALID_PROVIDERS.includes(row?.active_provider) ? row.active_provider : 'osm',
    hasGoogleKey: !!row?.google_maps_api_key_encrypted,
    hasHereKey: !!row?.here_api_key_encrypted,
    updatedAt: row?.updated_at || null
  };
}

router.get('/', requireAuth, (req, res) => {
  res.json({ settings: publicSettings(getSettingsStmt.get()) });
});

router.put('/', requireMapSettingsEdit, (req, res) => {
  const b = req.body || {};
  const existing = getSettingsStmt.get();
  const activeProvider = VALID_PROVIDERS.includes(b.activeProvider) ? b.activeProvider : 'osm';
  // Leeres Schluesselfeld = unveraendert lassen (gleiches Muster wie SMTP-/AI-/Buerostammdaten-Zugangsdaten).
  const googleMapsApiKeyEncrypted = b.googleMapsApiKey ? cryptoHelper.encrypt(b.googleMapsApiKey) : (existing ? existing.google_maps_api_key_encrypted : cryptoHelper.encrypt(''));
  const hereApiKeyEncrypted = b.hereApiKey ? cryptoHelper.encrypt(b.hereApiKey) : (existing ? existing.here_api_key_encrypted : cryptoHelper.encrypt(''));
  upsertSettingsStmt.run({ activeProvider, googleMapsApiKeyEncrypted, hereApiKeyEncrypted });
  logAction(req, 'map-settings.update', 'map-settings', 'default', { activeProvider });
  res.json({ settings: publicSettings(getSettingsStmt.get()) });
});

router.get('/google-key/reveal', requireMapSettingsEdit, (req, res) => {
  const row = getSettingsStmt.get();
  if (!row || !row.google_maps_api_key_encrypted) return res.json({ apiKey: '' });
  res.json({ apiKey: cryptoHelper.decrypt(row.google_maps_api_key_encrypted) });
});

router.get('/here-key/reveal', requireMapSettingsEdit, (req, res) => {
  const row = getSettingsStmt.get();
  if (!row || !row.here_api_key_encrypted) return res.json({ apiKey: '' });
  res.json({ apiKey: cryptoHelper.decrypt(row.here_api_key_encrypted) });
});

// Adressvervollstaendigung (Nutzerwunsch Runde 12): freier, moeglicherweise unvollstaendiger
// Adresstext -> beste Treffer-Formatierung des aktuell aktiven Anbieters. Fuer jeden eingeloggten
// Nutzer erreichbar (reine Lese-/Hilfsfunktion, kein Schreibzugriff auf die Einstellungen selbst).
router.get('/complete-address', requireAuth, async (req, res) => {
  const query = String(req.query.query || '').trim();
  if (!query) return res.status(400).json({ error: 'Adresstext erforderlich.' });
  try {
    const formattedAddress = await mapProviders.completeAddress(query, mapProviders.resolveUserMapRow(req.session.userId, req.session.mode));
    res.json({ formattedAddress });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Adresse konnte nicht vervollständigt werden.' });
  }
});

module.exports = router;
