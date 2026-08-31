// Mail-Einstellungen (SMTP-Konfiguration) - urspruenglich Teil von routes/admin.js, aber dessen
// blanket router.use(requireAdmin) haette auch nicht-admin-aber-per can_manage_mail_settings
// freigeschaltete Nutzer ausgesperrt (Nutzerwunsch: Mail-Einstellungen sollen ueber die
// Admin-Nutzerverwaltung auch fuer einzelne berechtigte Nutzer erreichbar sein, ohne vollen
// Admin-Zugang). Eigener, kleiner Router mit requireMailSettings (isAdmin ODER das neue Flag),
// unter denselben URL-Pfaden wie zuvor gemountet (siehe index.js) - bestehende Client-Fetch-Aufrufe
// bleiben dadurch unveraendert.

const express = require('express');
const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const { requireMailSettings } = require('../../middleware/authentication');
const { logAction } = require('../../middleware/audit');
const mail = require('./service');

const router = express.Router();
// Nur auf /smtp-config* scopen, NICHT unconditional router.use(requireMailSettings) - dieser Router
// wird unter demselben '/api/admin'-Praefix wie adminRoutes gemountet (siehe index.js), ein
// ungescoptes router.use() wuerde sonst JEDE /api/admin/*-Anfrage (auch /users etc.) zuerst durch
// diese Middleware laufen lassen und nicht-admin-aber-nur-mail-berechtigte Nutzer dort faelschlich
// mit 403 abweisen, bevor die Anfrage adminRoutes ueberhaupt erreichen kann.
router.use('/smtp-config', requireMailSettings);

const getSmtpConfigStmt = db.prepare('SELECT * FROM smtp_config WHERE id = 1');
const upsertSmtpConfigStmt = db.prepare(`
  INSERT INTO smtp_config (id, host, port, secure, username, password_encrypted, from_address, admin_recipient, signature, transport, graph_connection_id, send_account_id)
  VALUES (1, @host, @port, @secure, @username, @passwordEncrypted, @fromAddress, @adminRecipient, @signature, @transport, @graphConnectionId, @sendAccountId)
  ON CONFLICT(id) DO UPDATE SET host = excluded.host, port = excluded.port, secure = excluded.secure,
    username = excluded.username, password_encrypted = excluded.password_encrypted,
    from_address = excluded.from_address, admin_recipient = excluded.admin_recipient, signature = excluded.signature,
    transport = excluded.transport, graph_connection_id = excluded.graph_connection_id,
    send_account_id = excluded.send_account_id, updated_at = datetime('now')
`);
// Vereinheitlichung (2026-07-18): der Systemversand verweist auf ein Postfach-Konto. Zur Auswahl
// stehen die bueroweiten Konten; ein (noch) referenziertes privates Konto wird mit angeboten,
// damit die Anzeige nie "leer" luegt.
const listSendAccountsStmt = db.prepare("SELECT id, label, kind, email, visibility FROM mail_accounts WHERE visibility != 'private' ORDER BY sort_order, created_at");
const getAccountByIdStmt = db.prepare('SELECT id, label, kind, email, visibility FROM mail_accounts WHERE id = ?');
function sendAccountChoices(row) {
  const list = listSendAccountsStmt.all().map((a) => ({ id: a.id, label: a.label, kind: a.kind, email: a.email }));
  if (row?.send_account_id && !list.some((a) => a.id === row.send_account_id)) {
    const cur = getAccountByIdStmt.get(row.send_account_id);
    if (cur) list.unshift({ id: cur.id, label: cur.label + ' (privat)', kind: cur.kind, email: cur.email });
  }
  return list;
}
// Verfügbare Microsoft-Verbindungen (aus dem Kalender-/Aufgaben-OAuth) für die Auswahl der
// Versandart "Microsoft 365". authorized = refresh_token vorhanden (also autorisiert + mailfähig,
// sofern der Mail.Send-Scope bei der Autorisierung erteilt wurde).
const listMsConnStmt = db.prepare("SELECT id, display_name, account_label, enabled, refresh_token_encrypted FROM calendar_connections WHERE provider = 'microsoft' ORDER BY display_name COLLATE NOCASE");
function msConnections() {
  return listMsConnStmt.all().map((c) => ({
    id: c.id,
    label: c.display_name || c.account_label || 'Microsoft-Konto',
    enabled: !!c.enabled,
    authorized: !!c.refresh_token_encrypted
  }));
}

router.get('/smtp-config', (req, res) => {
  const row = getSmtpConfigStmt.get();
  res.json({
    host: row?.host || '', port: row?.port || 587, secure: !!row?.secure,
    username: row?.username || '', fromAddress: row?.from_address || '', adminRecipient: row?.admin_recipient || '',
    signature: row?.signature || '',
    transport: row?.transport || 'smtp', graphConnectionId: row?.graph_connection_id || '',
    graphConnections: msConnections(),
    hasPassword: !!row?.password_encrypted, updatedAt: row?.updated_at || null,
    // Vereinheitlichung: Verweis auf das Standard-Versandkonto + Auswahlliste; legacyActive zeigt
    // an, dass (noch) die Alt-Zugangsdaten dieser Zeile aktiv sind (kein Konto referenziert).
    sendAccountId: row?.send_account_id || '',
    sendAccounts: sendAccountChoices(row),
    legacyActive: !row?.send_account_id && !!(row && (row.transport === 'microsoft' ? row.graph_connection_id : row.host))
  });
});

router.get('/smtp-config/reveal', (req, res) => {
  const row = getSmtpConfigStmt.get();
  if (!row) return res.json({ password: '' });
  res.json({ password: cryptoHelper.decrypt(row.password_encrypted) });
});

router.put('/smtp-config', (req, res) => {
  const { host, port, secure, username, password, fromAddress, adminRecipient, signature, transport, graphConnectionId, sendAccountId } = req.body || {};
  const existing = getSmtpConfigStmt.get();
  // Vereinheitlichter Client schickt nur noch {sendAccountId, adminRecipient, signature} - alle
  // Alt-Felder bleiben bei Abwesenheit UNVERAENDERT erhalten (Fallback-Daten nicht wegputzen).
  // Leeres password-Feld bedeutet weiterhin "unveraendert lassen".
  const passwordEncrypted = password ? cryptoHelper.encrypt(password) : (existing ? existing.password_encrypted : cryptoHelper.encrypt(''));
  const tp = transport === 'microsoft' ? 'microsoft' : (transport === 'smtp' ? 'smtp' : (existing?.transport || 'smtp'));
  let accId = sendAccountId != null ? String(sendAccountId) : (existing?.send_account_id || '');
  if (accId && !getAccountByIdStmt.get(accId)) return res.status(400).json({ error: 'Das gewählte Versandkonto wurde nicht gefunden.' });
  upsertSmtpConfigStmt.run({
    host: host != null ? String(host).trim() : (existing?.host || ''),
    port: port != null ? (Number(port) || 587) : (existing?.port || 587),
    secure: secure != null ? (secure ? 1 : 0) : (existing?.secure ? 1 : 0),
    username: username != null ? String(username).trim() : (existing?.username || ''),
    passwordEncrypted,
    fromAddress: fromAddress != null ? String(fromAddress).trim() : (existing?.from_address || ''),
    adminRecipient: adminRecipient != null ? String(adminRecipient).trim() : (existing?.admin_recipient || ''),
    // signature==null (Feld nicht mitgeschickt) laesst die gespeicherte Signatur unangetastet
    signature: signature != null ? String(signature) : (existing?.signature || ''),
    transport: tp,
    graphConnectionId: graphConnectionId != null ? String(graphConnectionId) : (existing?.graph_connection_id || ''),
    sendAccountId: accId
  });
  logAction(req, 'smtp-config.update', 'smtp-config', 'default', { sendAccountId: accId, transport: tp, passwordChanged: !!password });
  res.json({ ok: true });
});

router.post('/smtp-config/test', async (req, res) => {
  try {
    await mail.sendTestMail();
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Testmail konnte nicht gesendet werden.' });
  }
});

module.exports = router;
