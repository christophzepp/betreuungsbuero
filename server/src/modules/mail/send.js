// Gemeinsamer Versand über ein Postfach-Konto (Mail Tier 1-3, Nutzerwunsch 2026-07-18): EIN Weg,
// den sowohl die Sende-Route (routes/mailbox.js) als auch der geplante Versand (mail-outbox.js)
// nutzen. SMTP baut die RFC-822-Bytes EINMAL (identischer Versand + Gesendet-Kopie); Microsoft
// läuft über Graph /me/sendMail. Antwort-an (reply_to des Kontos oder pro Mail) wird berücksichtigt.

const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const cryptoHelper = require('../../security/crypto');
const imapEngine = require('../../integrations/mail/imap');
const microsoftMail = require('../../integrations/mail/microsoft-mail');

function splitAddresses(v) {
  return String(v || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
}

// m: { to, cc, bcc, subject, html, text, replyTo, attachments:[{filename,mimeType,content:Buffer}] }
async function sendViaAccount(acc, m) {
  const replyTo = String(m.replyTo || acc.reply_to || '').trim() || undefined;
  const priority = m.priority === 'high' ? 'high' : (m.priority === 'low' ? 'low' : 'normal');
  if (acc.kind === 'microsoft') {
    const conn = microsoftMail.graphMailConnection(acc.graph_connection_id);
    if (!conn) throw new Error('Die hinterlegte Microsoft-Verbindung wurde nicht gefunden.');
    await microsoftMail.sendViaGraph(conn, {
      to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, body: m.text, html: m.html, attachments: m.attachments, replyTo,
      importance: priority
    });
    return { sentVia: 'graph' };
  }
  if (!acc.smtp_host) throw new Error('Für dieses Konto ist kein SMTP-Server hinterlegt.');
  const fromAddr = acc.email || acc.smtp_user || acc.imap_user;
  const mailOptions = {
    from: acc.from_name ? { name: acc.from_name, address: fromAddr } : fromAddr,
    to: m.to, cc: m.cc || undefined, bcc: m.bcc || undefined,
    replyTo,
    priority,
    subject: m.subject || '', html: m.html || undefined, text: m.text || undefined,
    attachments: (m.attachments || []).map((a) => ({ filename: a.filename, content: a.content, contentType: a.mimeType }))
  };
  const raw = await new MailComposer(mailOptions).compile().build();
  const transport = nodemailer.createTransport({
    host: acc.smtp_host, port: Number(acc.smtp_port) || 587, secure: !!acc.smtp_secure,
    auth: acc.smtp_user ? { user: acc.smtp_user, pass: cryptoHelper.decrypt(acc.smtp_pass_encrypted || '') } : undefined
  });
  await transport.sendMail({ raw, envelope: { from: fromAddr, to: [...splitAddresses(m.to), ...splitAddresses(m.cc), ...splitAddresses(m.bcc)] } });
  let sentCopy = false;
  try { sentCopy = (await imapEngine.appendSent(acc, raw)).ok === true; } catch (_e) { /* Kopie ist nice-to-have */ }
  return { sentVia: 'smtp', sentCopy };
}

module.exports = { sendViaAccount, splitAddresses };
