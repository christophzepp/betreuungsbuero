// Mail-Engine (Phase 5, siehe Plan Abschnitt Q): buerobezogene Mail-Konfiguration (smtp_config,
// eine einzige Zeile). Zwei Versandarten (Nutzerwunsch):
//   - transport='smtp'      : klassischer SMTP-Versand über nodemailer (Passwort AES-verschluesselt).
//   - transport='microsoft' : Microsoft Graph /me/sendMail über eine autorisierte Microsoft-
//                             Kalenderverbindung (OAuth) - umgeht die von Microsoft abgeschaltete
//                             SMTP-Basic-Authentifizierung.
// Alle vier Aufrufstellen (routes/mail.js, routes/cases.js send-mail, routes/mail-settings.js test,
// routes/auth.js forgot-password) laufen unveraendert durch die Funktionen hier - die Verzweigung
// passiert zentral in deliver().

const nodemailer = require('nodemailer');
const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const microsoftMail = require('../../integrations/mail/microsoft-mail');

const getConfigStmt = db.prepare('SELECT * FROM smtp_config WHERE id = 1');
const getSendAccountStmt = db.prepare('SELECT * FROM mail_accounts WHERE id = ?');

// Vereinheitlichung (Nutzerwunsch 2026-07-18): Zugangsdaten liegen in mail_accounts (Postfach-
// Konten); smtp_config traegt nur noch Systemfelder (admin_recipient, signature) + den Verweis
// send_account_id. accountToCfg() formt ein Konto in die alte smtp_config-Zeilengestalt, damit
// isConfigured()/deliver()/buildTransport() und alle Aufrufstellen unveraendert weiterarbeiten.
function accountToCfg(acc, sysRow) {
  if (!acc) return null;
  const address = acc.email || acc.smtp_user || acc.imap_user || '';
  return {
    id: 1,
    transport: acc.kind === 'microsoft' ? 'microsoft' : 'smtp',
    host: acc.smtp_host || '',
    port: acc.smtp_port || 587,
    secure: acc.smtp_secure ? 1 : 0,
    username: acc.smtp_user || '',
    password_encrypted: acc.smtp_pass_encrypted || '',
    from_address: acc.from_name ? `"${acc.from_name}" <${address}>` : address,
    admin_recipient: sysRow ? (sysRow.admin_recipient || '') : '',
    signature: sysRow ? (sysRow.signature || '') : '',
    graph_connection_id: acc.graph_connection_id || null
  };
}

// Effektive Systemversand-Konfiguration: das referenzierte Konto - und NUR das.
//
// 28.08.2026 (Entscheidung des Nutzers, Auswahl "Alt-Zugangsdaten entfernen"): Bis hierher fiel
// diese Funktion ohne send_account_id still auf die Alt-Felder der smtp_config-Zeile zurueck.
// Das war als Ueberbrueckung der Vereinheitlichung gedacht, hat sich aber verstetigt: Der
// Systemversand lief monatelang ueber Zugangsdaten, die in der Oberflaeche nirgends mehr
// sichtbar oder aenderbar waren. Jetzt gilt: kein zugewiesenes Konto = nicht konfiguriert.
//
// Die gespeicherten Alt-Felder werden NICHT geloescht - sie bleiben verschluesselt in der Zeile
// stehen und werden nur nicht mehr benutzt. Damit ist der Schritt umkehrbar (eine Zeile), falls
// sich zeigt, dass ein Buero noch daran haengt.
//
// Wichtig: admin_recipient und signature ueberleben, sie haengen nicht am Konto. Geleert werden
// nur die Zugangsdaten-Felder, damit isConfigured() unten sauber false liefert - fuer BEIDE
// Transportarten (host fuer SMTP, graph_connection_id fuer Microsoft).
function getSmtpConfig() {
  const row = getConfigStmt.get() || null;
  if (!row) return null;
  if (row.send_account_id) {
    const cfg = accountToCfg(getSendAccountStmt.get(row.send_account_id), row);
    if (cfg) return cfg;
  }
  return Object.assign({}, row, { host: '', username: '', password_encrypted: '', graph_connection_id: null });
}

function isConfigured(cfg) {
  if (!cfg) return false;
  if (cfg.transport === 'microsoft') return !!cfg.graph_connection_id;
  return !!(cfg.host && cfg.from_address && cfg.admin_recipient);
}

function buildTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port || 587,
    secure: !!cfg.secure,
    auth: cfg.username ? { user: cfg.username, pass: cryptoHelper.decrypt(cfg.password_encrypted) } : undefined
  });
}

// Zentrale Versand-Verzweigung: SMTP (nodemailer) oder Microsoft Graph.
async function deliver(cfg, { from, to, cc, bcc, subject, text, html, attachments }) {
  if (cfg && cfg.transport === 'microsoft') {
    const conn = microsoftMail.graphMailConnection(cfg.graph_connection_id);
    if (!conn) throw new Error('Keine Microsoft-Verbindung für den Mailversand ausgewählt (Admin-Panel → Mail-Einstellungen).');
    await microsoftMail.sendViaGraph(conn, { to, cc, bcc, subject, body: text, html, attachments });
    return;
  }
  const transport = buildTransport(cfg);
  await transport.sendMail({
    from: from || cfg.from_address,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    subject: subject || '',
    text: text || '',
    html: html || undefined,
    attachments: (attachments || []).map((a) => ({ filename: a.filename, content: a.content, contentType: a.mimeType || undefined }))
  });
}

// Wird von POST /api/forgot-password aufgerufen - darf die generische, enumerierungssichere
// Erfolgsantwort dort NICHT beeinflussen. Gibt daher nie eine Exception weiter, nur einen
// Erfolgs-/Fehler-Hinweis fuers Server-Log.
async function sendForgotPasswordNotification({ username, userExists, ip }) {
  const cfg = getSmtpConfig();
  if (!isConfigured(cfg)) return { sent: false, reason: 'Mailversand nicht konfiguriert.' };
  if (!cfg.admin_recipient) return { sent: false, reason: 'Kein Admin-Empfänger hinterlegt.' };
  try {
    await deliver(cfg, {
      to: cfg.admin_recipient,
      subject: 'Betreuungsbüro-Dokumentenserver: Passwort-Anfrage',
      text:
        `Ein Nutzer hat über "Passwort vergessen" eine Zurücksetzung angefragt.\n\n` +
        `Nutzername: ${username}\n` +
        `Konto existiert: ${userExists ? 'ja' : 'nein'}\n` +
        `IP-Adresse: ${ip}\n` +
        `Zeitpunkt: ${new Date().toISOString()}\n\n` +
        `Das Passwort kann im Admin-Panel unter "Nutzer" zurückgesetzt werden.`
    });
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}

async function sendTestMail() {
  const cfg = getSmtpConfig();
  if (!isConfigured(cfg)) throw new Error('Mail-Konfiguration ist unvollständig (bei SMTP: Host, Absender und Admin-Empfänger; bei Microsoft 365: eine verbundene Microsoft-Verbindung).');
  if (!cfg.admin_recipient) throw new Error('Admin-Empfänger-Adresse erforderlich (an diese Adresse geht die Testmail).');
  await deliver(cfg, {
    to: cfg.admin_recipient,
    subject: 'Betreuungsbüro-Dokumentenserver: Testmail',
    text: `Diese Testmail bestätigt, dass die Mail-Konfiguration funktioniert (Versandart: ${cfg.transport === 'microsoft' ? 'Microsoft 365 / Graph' : 'SMTP'}).\n\nGesendet: ${new Date().toISOString()}`
  });
}

// Direkter Dokumentenversand (Phase 6, Mail-Editor im Sendemenue) - mit Anlagen und frei
// editierbarem Betreff/Text. Wirft bei Fehlern bewusst durch (der aufrufende Endpunkt zeigt dem
// Nutzer eine echte Fehlermeldung).
// Multi-User (Nutzerwunsch): ein Nutzer mit manageMailSettings kann eine EIGENE Mail-Konfiguration
// hinterlegen (user_settings_overrides.area='mail'). Der Override wird als Klartext-JSON gespeichert
// (in user_settings_overrides bereits verschluesselt); overrideToCfg() formt ihn in dieselbe Zeilen-
// gestalt wie smtp_config, damit isConfigured()/deliver()/buildTransport() unveraendert damit arbeiten.
function overrideToCfg(ov, userId) {
  if (!ov || typeof ov !== 'object') return null;
  // Neues Format (Vereinheitlichung): {accountId} = "über dieses Postfach-Konto senden".
  // Sichtbarkeitsregel wie überall: privat nur für den Eigentümer (userId=null = reine
  // Status-Anzeige ohne Nutzerbezug, dort keine Sperre). Nicht auflösbar -> null, der
  // Aufrufer fällt dann auf die Büro-Vorgabe zurück.
  if (ov.accountId) {
    const acc = getSendAccountStmt.get(String(ov.accountId));
    if (!acc) return null;
    if (acc.visibility === 'private' && userId != null && acc.owner_user_id !== userId) return null;
    return accountToCfg(acc, getConfigStmt.get() || null);
  }
  return {
    id: 1,
    transport: ov.transport || 'smtp',
    host: ov.host || '',
    port: ov.port || 587,
    secure: ov.secure ? 1 : 0,
    username: ov.username || '',
    password_encrypted: cryptoHelper.encrypt(String(ov.password || '')),
    from_address: ov.fromAddress || ov.from_address || '',
    admin_recipient: ov.adminRecipient || ov.admin_recipient || '',
    graph_connection_id: ov.graphConnectionId || ov.graph_connection_id || null
  };
}
function isOverrideConfigured(ov) { return isConfigured(overrideToCfg(ov)); }

// Effektive SMTP-Config des HANDELNDEN Nutzers: eigener Mail-Override (nur mit manageMailSettings)
// sonst die Admin-SMTP-Vorgabe. Wird von den Sende-Routen genutzt, damit ein Nutzer mit eigener
// Mail-Konfiguration ueber SEINEN Account versendet. Lazy require, um Ladereihenfolge unkritisch zu halten.
const getUserForMailStmt = db.prepare('SELECT * FROM users WHERE id = ?');
function resolveUserSmtpCfg(userId, mode) {
  if (!userId) return getSmtpConfig();
  try {
    const userSettings = require('../settings/user-settings');
    const user = getUserForMailStmt.get(userId);
    const ov = user ? userSettings.effectiveOverride(user, mode, 'mail') : null;
    if (!ov) return getSmtpConfig();
    // Konto-Verweis, der ins Leere zeigt (geloescht/nicht mehr sichtbar) -> Buero-Vorgabe statt
    // harter Fehler; das alte Feld-Format behaelt sein bisheriges Verhalten (unvollstaendig =
    // klare Fehlermeldung beim Senden).
    const cfg = overrideToCfg(ov, userId);
    return cfg || getSmtpConfig();
  } catch (_e) { return getSmtpConfig(); }
}

// cfgOverride (optional): fertige Zeilen-Config eines Nutzer-Overrides; sonst die Admin-SMTP-Vorgabe.
async function sendDocumentMail({ to, cc, bcc, subject, body, html, attachments }, cfgOverride) {
  const cfg = cfgOverride || getSmtpConfig();
  if (!isConfigured(cfg)) throw new Error('Mail-Konfiguration ist unvollständig (bei SMTP: Host, Absender und Admin-Empfänger; bei Microsoft 365: eine verbundene Microsoft-Verbindung).');
  if (!to) throw new Error('Empfänger-E-Mail-Adresse erforderlich.');
  await deliver(cfg, { to, cc, bcc, subject: subject || '', text: body || '', html: html || undefined, attachments: attachments || [] });
}

module.exports = { getSmtpConfig, isConfigured, isOverrideConfigured, overrideToCfg, resolveUserSmtpCfg, sendForgotPasswordNotification, sendTestMail, sendDocumentMail };
