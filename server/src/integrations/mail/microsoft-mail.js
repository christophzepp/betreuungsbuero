// Microsoft-365-Mailversand über Microsoft Graph (/me/sendMail) - Nutzerwunsch: den bereits für
// Kalender/Aufgaben registrierten Microsoft-OAuth-Login (Entra-App) auch für den Mailversand nutzen.
// Sendet als das angemeldete Postfach der gewählten Kalenderverbindung (provider='microsoft').
// Token-Refresh + Persistenz laufen über dasselbe calendar_connections-Muster wie in
// microsoft-calendar.js. Benötigt in der Entra-App den delegierten Scope Mail.Send (siehe SCOPES
// dort). Basic-Auth-SMTP ist bei Outlook/M365 abgeschaltet - dieser Weg umgeht das per OAuth.

const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const msCal = require('../calendar/microsoft-calendar');

const GRAPH_API = 'https://graph.microsoft.com/v1.0';
const getConnStmt = db.prepare('SELECT * FROM calendar_connections WHERE id = ?');
const updateTokenStmt = db.prepare("UPDATE calendar_connections SET access_token_encrypted = @at, token_expires_at = @exp WHERE id = @id");

// Liefert die (Microsoft-)Verbindung zu einer id, oder null.
function graphMailConnection(id) {
  if (!id) return null;
  const row = getConnStmt.get(id);
  return row && row.provider === 'microsoft' ? row : null;
}

function recipients(v) {
  return String(v || '')
    .split(/[,;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

function toBase64(content) {
  if (content == null) return '';
  if (Buffer.isBuffer(content)) return content.toString('base64');
  return Buffer.from(String(content)).toString('base64');
}

function buildGraphMessage({ to, cc, bcc, subject, body, html, attachments, replyTo, importance }) {
  const message = {
    subject: subject || '',
    body: { contentType: html ? 'HTML' : 'Text', content: (html || body || '') },
    toRecipients: recipients(to),
    ccRecipients: recipients(cc),
    bccRecipients: recipients(bcc),
    ...(replyTo ? { replyTo: recipients(replyTo) } : {}),
    ...(importance && importance !== 'normal' ? { importance } : {}),
    attachments: (attachments || []).map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename || 'anhang',
      contentType: a.mimeType || a.contentType || 'application/octet-stream',
      contentBytes: toBase64(a.content)
    }))
  };
  return { message, saveToSentItems: true };
}

// Sendet eine Mail über Graph /me/sendMail. Lazy-Refresh-on-401 (wie authedFetch in
// microsoft-calendar.js): abgelaufener/fehlender Access-Token wird per refreshAccessToken erneuert,
// der neue Token in calendar_connections zurückgeschrieben, dann genau einmal wiederholt.
async function sendViaGraph(conn, mailOpts) {
  if (!conn) throw new Error('Keine Microsoft-Verbindung ausgewählt.');
  if (!conn.refresh_token_encrypted) throw new Error('Die Microsoft-Verbindung ist noch nicht autorisiert (bitte im Admin-Panel → Kalender & Aufgaben verbinden).');
  const payload = buildGraphMessage(mailOpts || {});
  const post = (token) => fetch(`${GRAPH_API}/me/sendMail`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let token = cryptoHelper.decrypt(conn.access_token_encrypted || '');
  let res = token ? await post(token) : { status: 401, ok: false };
  if (res.status === 401) {
    const refreshed = await msCal.refreshAccessToken(conn);
    token = refreshed.access_token;
    try {
      updateTokenStmt.run({
        id: conn.id,
        at: cryptoHelper.encrypt(token),
        exp: new Date(Date.now() + ((refreshed.expires_in || 3600) * 1000)).toISOString()
      });
    } catch (_e) { /* Persistenz-Fehler ist unkritisch fürs Senden */ }
    res = await post(token);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (_e) { /* ignore */ }
    throw new Error(`Microsoft Graph sendMail fehlgeschlagen (${res.status}): ${String(detail).slice(0, 300)}`);
  }
  // sendMail liefert 202 Accepted ohne Body.
  return true;
}

module.exports = { sendViaGraph, graphMailConnection, buildGraphMessage };
