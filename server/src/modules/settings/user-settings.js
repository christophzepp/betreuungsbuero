// Multi-User-Zugangsdaten (Nutzerwunsch): pro Nutzer und Bereich eine eigene Uebersteuerung der
// bueroweiten Admin-Vorgaben. Standard ist immer die Admin-Vorgabe; ein Nutzer MIT der jeweiligen
// Berechtigung kann einen eigenen Wert hinterlegen, der dann NUR fuer ihn gilt. Loescht er ihn wieder,
// faellt er automatisch auf die Admin-Vorgabe zurueck. Werte liegen verschluesselt (AES-256-GCM,
// crypto.js) in user_settings_overrides (siehe db.js). Dieses Modul kapselt Store + Rechtepruefung +
// effektive Aufloesung, damit auth.js (Login), die Selbstbedienungs-Routen (routes/my-settings.js),
// der Mail-Versand und der Fahrtkostennachweis dieselbe Logik teilen.

const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const { hasPermission } = require('../../middleware/authorization');

// Bereich -> zugehoeriges Recht (Admin hat per Definition immer alle Rechte, siehe permissions.js).
// ai/send teilen sich manageCredentials (KI-Keys + Versandkonten), mail=manageMailSettings,
// maps=manageMapSettings. Kalender-Verbindungen bewusst NICHT hier (andere Datenform, Folge-Runde).
const AREA_PERMISSION = {
  ai: 'manageCredentials',
  send: 'manageCredentials',
  mail: 'manageMailSettings',
  maps: 'manageMapSettings'
};
const AREAS = Object.keys(AREA_PERMISSION);

const getStmt = db.prepare('SELECT value_encrypted FROM user_settings_overrides WHERE user_id = ? AND area = ?');
const upsertStmt = db.prepare(`
  INSERT INTO user_settings_overrides (user_id, area, value_encrypted, updated_at)
  VALUES (@userId, @area, @valueEncrypted, datetime('now'))
  ON CONFLICT(user_id, area) DO UPDATE SET value_encrypted = excluded.value_encrypted, updated_at = excluded.updated_at
`);
const deleteStmt = db.prepare('DELETE FROM user_settings_overrides WHERE user_id = ? AND area = ?');
const listForUserStmt = db.prepare('SELECT area, value_encrypted, updated_at FROM user_settings_overrides WHERE user_id = ?');
const listAllStmt = db.prepare('SELECT user_id, area, value_encrypted, updated_at FROM user_settings_overrides');

function isKnownArea(area) { return AREAS.includes(area); }
function areaPermission(area) { return AREA_PERMISSION[area] || null; }

// Darf dieser Nutzer im gegebenen Modus diesen Bereich uebersteuern? (Admin immer, sonst das Recht.)
function userMayOverride(user, mode, area) {
  const perm = AREA_PERMISSION[area];
  if (!perm) return false;
  return hasPermission(user, mode, perm);
}

// Roher (entschluesselter) Override-Wert oder null, wenn keiner gesetzt/defekt.
function getOverrideRaw(userId, area) {
  const row = getStmt.get(userId, area);
  if (!row || !row.value_encrypted) return null;
  try { return JSON.parse(cryptoHelper.decrypt(row.value_encrypted)); } catch (_e) { return null; }
}
function hasOverride(userId, area) {
  const row = getStmt.get(userId, area);
  return !!(row && row.value_encrypted);
}
function setOverride(userId, area, valueObj) {
  upsertStmt.run({ userId, area, valueEncrypted: cryptoHelper.encrypt(JSON.stringify(valueObj || {})) });
}
function clearOverride(userId, area) { deleteStmt.run(userId, area); }

// Effektiver Override: eigener Wert NUR wenn Recht vorhanden UND gesetzt; sonst null (=> Admin-Vorgabe).
function effectiveOverride(user, mode, area) {
  if (!user || !userMayOverride(user, mode, area)) return null;
  return getOverrideRaw(user.id, area);
}
// Quelle der aktuell wirksamen Werte eines Bereichs: 'user' (eigene) oder 'admin' (Vorgabe).
function overrideSource(user, mode, area) {
  return effectiveOverride(user, mode, area) ? 'user' : 'admin';
}

module.exports = {
  AREAS, AREA_PERMISSION, isKnownArea, areaPermission,
  userMayOverride, getOverrideRaw, hasOverride, setOverride, clearOverride,
  effectiveOverride, overrideSource, listForUserStmt, listAllStmt
};
