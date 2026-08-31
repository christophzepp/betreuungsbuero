// Selbstbedienungs-Zugangsdaten (Nutzerwunsch: Multi-User-Umbau). Jeder eingeloggte Nutzer sieht
// hier, WORAUS seine buerobezogenen Zugangsdaten je Bereich gerade stammen (Admin-Vorgabe oder
// eigene Eingaben); Nutzer MIT der jeweiligen Berechtigung koennen eigene Werte hinterlegen (PUT)
// oder wieder auf die Admin-Vorgabe zuruecksetzen (DELETE). Bereiche: ai/send (manageCredentials),
// mail (manageMailSettings), maps (manageMapSettings). Nur ONLINE-Modus relevant; im Lokal-Modus
// laeuft die Praezedenz ueber local_mode_defaults + Browser (unveraendert).

const express = require('express');
const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const { requireAuth } = require('../../middleware/authentication');
const mail = require('../mail/service');
const userSettings = require('./user-settings');

const router = express.Router();
router.use(requireAuth);

const getUserByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');

// ----- Admin-Vorgabe je Bereich: ist sie ueberhaupt nutzbar konfiguriert? -----
function decryptSafe(v) { try { return cryptoHelper.decrypt(v); } catch (_e) { return ''; } }
function adminAiConfigured() {
  for (const r of db.prepare('SELECT api_key_encrypted FROM office_ai_config').all()) {
    if (decryptSafe(r.api_key_encrypted)) return true;
  }
  return false;
}
function adminSendConfigured() {
  for (const r of db.prepare('SELECT username, password_encrypted FROM office_send_credentials').all()) {
    if (r.username || decryptSafe(r.password_encrypted)) return true;
  }
  return false;
}
function adminMailConfigured() { return mail.isConfigured(mail.getSmtpConfig()); }
function adminMapsConfigured() {
  const r = db.prepare('SELECT google_maps_api_key_encrypted, here_api_key_encrypted FROM map_settings WHERE id = 1').get();
  return !!(r && (decryptSafe(r.google_maps_api_key_encrypted) || decryptSafe(r.here_api_key_encrypted)));
}
const ADMIN_CONFIGURED = { ai: adminAiConfigured, send: adminSendConfigured, mail: adminMailConfigured, maps: adminMapsConfigured };

// Ist ein (eigener) Override-Wert nutzbar konfiguriert?
function overrideConfigured(area, val) {
  if (!val || typeof val !== 'object') return false;
  if (area === 'ai') return Object.values(val).some((p) => p && p.apiKey);
  if (area === 'send') return Object.values(val).some((s) => s && (s.username || s.password));
  if (area === 'mail') return mail.isOverrideConfigured(val);
  if (area === 'maps') return !!(val.googleMapsApiKey || val.hereApiKey);
  return false;
}

function areaStatus(user, mode, area) {
  const canOverride = userSettings.userMayOverride(user, mode, area);
  const hasOwn = userSettings.hasOverride(user.id, area);
  const own = (canOverride && hasOwn) ? userSettings.getOverrideRaw(user.id, area) : null;
  const usingOwn = !!own;
  const effectiveConfigured = usingOwn ? overrideConfigured(area, own) : (ADMIN_CONFIGURED[area] ? ADMIN_CONFIGURED[area]() : false);
  return { source: usingOwn ? 'user' : 'admin', canOverride, hasOwn, adminConfigured: ADMIN_CONFIGURED[area] ? ADMIN_CONFIGURED[area]() : false, effectiveConfigured };
}

// GET /api/my-settings : Status ALLER Bereiche (keine Geheimnisse) - fuers System-Status-Menue + Schalter.
/* Prueferfolg der BUERO-KI-Verbindung melden (Nutzerwunsch 30.08.2026: der gruene Haken darf
   erst leuchten, wenn eine Verbindung AKTIV getestet wurde - nicht schon beim Hinterlegen).
   Reine Anzeige, kein Geheimnis: gespeichert wird ok/Zeitpunkt/Name je Anbieter. Angenommen
   nur, wenn der Anbieter wirklich einen entschluesselbaren Buero-Schluessel hat - sonst
   liesse sich der Haken mit einem privaten Schluessel erschleichen. Melden darf jede
   angemeldete Person: getestet wird ja auch von Mitarbeitenden (Modellliste laden). */
router.post('/ai-geprueft', (req, res) => {
  const provider = String((req.body || {}).provider || '').trim();
  if (!provider) return res.status(400).json({ error: 'provider fehlt.' });
  const row = db.prepare('SELECT api_key_encrypted FROM office_ai_config WHERE provider = ?').get(provider);
  if (!row || !decryptSafe(row.api_key_encrypted)) {
    return res.status(409).json({ error: 'Für diesen Anbieter ist kein Büro-Schlüssel hinterlegt.' });
  }
  const alt = db.prepare("SELECT data_json FROM office_json WHERE key = 'ki_pruefstatus'").get();
  let obj = {}; try { obj = JSON.parse((alt || {}).data_json || '{}') || {}; } catch (_e) { obj = {}; }
  obj.anbieter = obj.anbieter || {};
  obj.anbieter[provider] = {
    ok: true,
    am: new Date().toISOString(),
    von: String(req.session.displayName || req.session.username || ''),
  };
  db.prepare("INSERT INTO office_json (key, data_json) VALUES ('ki_pruefstatus', ?) ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json")
    .run(JSON.stringify(obj));
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  const user = getUserByIdStmt.get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const mode = req.session.mode;
  const areas = {};
  for (const area of userSettings.AREAS) areas[area] = areaStatus(user, mode, area);
  res.json({ mode, areas });
});

// GET /api/my-settings/:area : die EIGENEN Override-Werte im Klartext (nur der Eigentuemer, nur mit
// Recht) - fuer das Ausfuellen des Einstellungsformulars auf "Eigene Eingaben".
router.get('/:area', (req, res) => {
  const { area } = req.params;
  if (!userSettings.isKnownArea(area)) return res.status(400).json({ error: 'Unbekannter Bereich.' });
  const user = getUserByIdStmt.get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (!userSettings.userMayOverride(user, req.session.mode, area)) {
    return res.status(403).json({ error: 'Keine Berechtigung, eigene Werte in diesem Bereich zu pflegen.' });
  }
  res.json({ area, value: userSettings.getOverrideRaw(user.id, area), hasOwn: userSettings.hasOverride(user.id, area) });
});

// PUT /api/my-settings/:area : eigenen Override setzen (Body = { value: {...} }). Nur mit Recht.
router.put('/:area', (req, res) => {
  const { area } = req.params;
  if (!userSettings.isKnownArea(area)) return res.status(400).json({ error: 'Unbekannter Bereich.' });
  const user = getUserByIdStmt.get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (!userSettings.userMayOverride(user, req.session.mode, area)) {
    return res.status(403).json({ error: 'Keine Berechtigung, eigene Werte in diesem Bereich zu pflegen.' });
  }
  const value = req.body && req.body.value;
  if (value == null || typeof value !== 'object') return res.status(400).json({ error: 'Ungueltiger Wert.' });
  userSettings.setOverride(user.id, area, value);
  res.json({ ok: true, source: 'user' });
});

// DELETE /api/my-settings/:area : eigenen Override loeschen -> Rueckfall auf Admin-Vorgabe. Nur mit Recht.
router.delete('/:area', (req, res) => {
  const { area } = req.params;
  if (!userSettings.isKnownArea(area)) return res.status(400).json({ error: 'Unbekannter Bereich.' });
  const user = getUserByIdStmt.get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (!userSettings.userMayOverride(user, req.session.mode, area)) {
    return res.status(403).json({ error: 'Keine Berechtigung, eigene Werte in diesem Bereich zu pflegen.' });
  }
  userSettings.clearOverride(user.id, area);
  res.json({ ok: true, source: 'admin' });
});

module.exports = router;
