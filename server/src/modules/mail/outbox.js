// Geplanter Versand ("Später senden", Mail Tier 1-3, Nutzerwunsch 2026-07-18): Entwürfe mit
// kind='scheduled' + send_at (ISO) werden fällig serverseitig verschickt - unabhängig davon, ob
// der Browser des Nutzers offen ist. Ein Timer prüft im Takt; MAILBOX_WATCH=0 schaltet den
// Auto-Timer ab (Tests rufen tick() direkt). Fehlversuche werden gezählt und nach mehreren
// Anläufen in den Postausgang (kind='outbox') überführt, damit der Nutzer sie sieht.

const db = require('../../database/index');
const contactDoku = require('./contact-documentation');
const addressbook = require('../contacts/addressbook');
const mailSend = require('./send');
const imapEngine = require('../../integrations/mail/imap');
const graphEngine = require('../../integrations/mail/microsoft-graph');
const applicationWriteBarrier = require('../../middleware/application-write-barrier');

const DISABLED = process.env.MAILBOX_WATCH === '0';
const MAX_ATTEMPTS = 5;

const dueStmt = db.prepare("SELECT * FROM mail_drafts WHERE kind = 'scheduled' AND send_at != '' AND send_at <= ? ORDER BY send_at LIMIT 25");
const getAccountStmt = db.prepare('SELECT * FROM mail_accounts WHERE id = ?');
const deleteDraftStmt = db.prepare('DELETE FROM mail_drafts WHERE id = ?');
const updateDraftStmt = db.prepare("UPDATE mail_drafts SET kind = ?, send_at = ?, data_json = ?, updated_at = datetime('now') WHERE id = ?");
const userNameStmt = db.prepare('SELECT first_name, last_name, username FROM users WHERE id = ?');
const insertDokuStmt = db.prepare('INSERT INTO case_doku_entries (id, case_id, data_json, updated_by) VALUES (@id, @caseId, @dataJson, @userId)');

function attachmentsToBuffers(list) {
  const out = [];
  for (const a of list || []) {
    if (!a || !a.filename || !a.dataBase64) continue;
    try { out.push({ filename: a.filename, mimeType: a.mimeType || 'application/octet-stream', content: Buffer.from(a.dataBase64, 'base64') }); }
    catch (_e) { /* kaputte Anlage überspringen */ }
  }
  return out;
}

function dokuDateParts(date = new Date()) {
  const d = Number.isNaN(date.getTime()) ? new Date() : date;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return { date: `${dd}.${mm}.${yyyy}`, year: yyyy };
}

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function writeDoku(row, data, session) {
  if (!data.dokuCase) return null;
  contactDoku.authorize(session, data.dokuCase);
  const u = userNameStmt.get(row.owner_user_id) || {};
  const actor = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username || '';
  const dp = dokuDateParts(new Date(data.__sentReceipt.at));
  const mailText = stripHtmlToText(data.html || data.text || '').slice(0, 4000);
  const entry = {
    year: dp.year, date: dp.date, actorGroup: '', actor, type: 'Kommunikation & Kontakt',
    detail: 'E-Mail gesendet (geplant)', freeDetail: '', contactType: 'Schriftlich (E-Mail)',
    note: 'An: ' + (data.to || '') + (data.cc ? ' · Cc: ' + data.cc : '') + ' – Betreff: ' + (data.subject || '(ohne Betreff)') + (mailText ? ' – Inhalt: ' + mailText : ''),
    contactLink: data.contactLink || null, mailAccountId: row.account_id,
    mailMessageId: data.__sentReceipt.messageId || '', mailDispatchId: data.dispatchId,
    source: { module: 'mail', id: row.id, action: 'sent' }
  };
  const id = 'scheduled-mail-' + row.id;
  if (!db.prepare('SELECT id FROM case_doku_entries WHERE id=?').get(id)) insertDokuStmt.run({ id, caseId: data.dokuCase, dataJson: JSON.stringify(entry), userId: row.owner_user_id });
  return { id, entry };
}

// ---- Wiedervorlage (Snooze): faellige Mails per Message-ID zurueck in den Posteingang ------
const dueSnoozesStmt = db.prepare("SELECT * FROM mail_snoozes WHERE wake_at != '' AND wake_at <= ? ORDER BY wake_at LIMIT 25");
const deleteSnoozeStmt = db.prepare('DELETE FROM mail_snoozes WHERE id = ?');

// Shared lock prevents scheduler and manual return from moving the same message twice.
const wakingSnoozes = new Set();
async function wakeSnooze(id) {
  if (wakingSnoozes.has(id)) throw new Error('Diese E-Mail wird bereits zurückgeholt.');
  wakingSnoozes.add(id);
  try {
    const row = db.prepare('SELECT * FROM mail_snoozes WHERE id = ?').get(id);
    if (!row) throw new Error('Wiedervorlage nicht mehr vorhanden.');
    const acc = getAccountStmt.get(row.account_id);
    if (!acc) throw new Error('Das E-Mail-Konto ist nicht mehr verfügbar.');
    const engine = acc.kind === 'microsoft' ? graphEngine : imapEngine;
    const inbox = acc.kind === 'microsoft' ? 'inbox' : 'INBOX';
    const uid = await engine.findByMessageId(acc, row.folder, row.message_id);
    if (uid != null) await engine.moveMessage(acc, row.folder, uid, inbox);
    const backUid = await engine.findByMessageId(acc, inbox, row.message_id);
    if (backUid == null && uid == null) throw new Error('Die E-Mail wurde nicht gefunden. Die Wiedervorlage bleibt erhalten.');
    if (backUid != null) {
      try { await engine.setFlags(acc, inbox, backUid, { seen: false }); } catch (_) { /* optional */ }
    }
    deleteSnoozeStmt.run(row.id);
    db.prepare('DELETE FROM mail_cache WHERE account_id = ? AND folder IN (?, ?)').run(acc.id, row.folder, inbox);
    return { accountId: acc.id, folder: inbox, uid: backUid == null ? null : String(backUid) };
  } finally { wakingSnoozes.delete(id); }
}
async function wakeSnoozes(now) {
  const due = dueSnoozesStmt.all(now);
  for (const row of due) {
    try { await wakeSnooze(row.id); }
    catch (_) {
      // Never discard the only reminder on a provider outage. Retry after five minutes.
      db.prepare('UPDATE mail_snoozes SET attempts = attempts + 1, wake_at = ? WHERE id = ?')
        .run(new Date(Date.parse(now) + 300000).toISOString(), row.id);
    }
  }
  return due.length;
}

// ---- Automatisches Leeren (Papierkorb/Spam aelter als N Tage) - hoechstens 1x pro Stunde ----
let lastCleanupAt = 0;
const retentionAccountsStmt = db.prepare('SELECT * FROM mail_accounts WHERE trash_retention_days > 0 OR junk_retention_days > 0');
const cacheRetAccountsStmt = db.prepare('SELECT id, cache_retention_days FROM mail_accounts WHERE cache_retention_days > 0');
const cachePurgeStmt = db.prepare("DELETE FROM mail_cache WHERE account_id = ? AND cached_at < ?");
async function cleanupRetention() {
  if (Date.now() - lastCleanupAt < 3600000) return 0;
  lastCleanupAt = Date.now();
  let total = 0;
  // Envelope-Cache nach der je Konto gewaehlten Speicherdauer leeren (0 = Immer behalten).
  try {
    for (const a of cacheRetAccountsStmt.all()) {
      const cutoff = new Date(Date.now() - a.cache_retention_days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
      cachePurgeStmt.run(a.id, cutoff);
    }
  } catch (_e) { /* Cache-Aufraeumen ist unkritisch */ }
  let rows = [];
  try { rows = retentionAccountsStmt.all(); } catch (_e) { rows = []; }
  for (const acc of rows) {
    const engine = acc.kind === 'microsoft' ? graphEngine : imapEngine;
    try {
      if (acc.kind === 'microsoft') {
        if (acc.trash_retention_days > 0) total += (await engine.purgeOlder(acc, 'deleteditems', acc.trash_retention_days)).deleted || 0;
        if (acc.junk_retention_days > 0) total += (await engine.purgeOlder(acc, 'junkemail', acc.junk_retention_days)).deleted || 0;
      } else {
        const folders = await engine.listFolders(acc);
        const trash = folders.find((f) => f.specialUse === '\\Trash');
        const junk = folders.find((f) => f.specialUse === '\\Junk');
        if (trash && acc.trash_retention_days > 0) total += (await engine.purgeOlder(acc, trash.path, acc.trash_retention_days)).deleted || 0;
        if (junk && acc.junk_retention_days > 0) total += (await engine.purgeOlder(acc, junk.path, acc.junk_retention_days)).deleted || 0;
      }
    } catch (_e) { /* Konto gerade nicht erreichbar - naechste Runde */ }
  }
  return total;
}

// Timer and manual ticks may overlap while the provider is responding.
const sendingDrafts = new Set();
async function tick(nowIso) {
  const now = nowIso || new Date().toISOString();
  try { await wakeSnoozes(now); } catch (_e) { /* independent queue */ }
  try { await cleanupRetention(); } catch (_e) { /* independent queue */ }
  const due = dueStmt.all(now);
  for (const candidate of due) {
    if (sendingDrafts.has(candidate.id)) continue;
    sendingDrafts.add(candidate.id);
    try {
      // It may have been edited/deleted while another message was sending.
      const row = db.prepare("SELECT * FROM mail_drafts WHERE id=? AND kind='scheduled' AND send_at<=?").get(candidate.id, now);
      if (!row) continue;
      let data = {}; try { data = JSON.parse(row.data_json || '{}'); } catch (_) { /* invalid draft */ }
      try {
        const session = contactDoku.currentSession(row.owner_user_id);
        if (!session.isAdmin && !session.canSendMail) throw Error('Die Berechtigung zum Mailversand fehlt.');
        if (data.dokuCase) contactDoku.authorize(session, data.dokuCase);
        if (!data.__sentReceipt) {
          const acc = getAccountStmt.get(row.account_id);
          if (!acc || acc.visibility === 'private' && Number(acc.owner_user_id) !== Number(row.owner_user_id)) throw Error('Versandkonto nicht mehr verfügbar.');
          if (data.dokuCase && !Object.hasOwn(data, 'contactLink')) data.contactLink = contactDoku.resolve(session, data.dokuCase, data.to);
          data.dispatchId = require('./identity').dispatchId(data.dispatchId) || require('crypto').randomUUID();
          // Persist the same identity across retries; no case information goes into mail headers.
          updateDraftStmt.run('scheduled', row.send_at, JSON.stringify(data), row.id);
          const result = await mailSend.sendViaAccount(acc, {
            to: data.to || '', cc: data.cc || '', bcc: data.bcc || '', subject: data.subject || '',
            html: data.html || '', text: data.text || '', attachments: attachmentsToBuffers(data.attachments),
            replyTo: data.replyTo || '', priority: data.priority || 'normal', dispatchId: data.dispatchId
          });
          data.__sentReceipt = { at: new Date().toISOString(), messageId: result?.messageId || '' };
          updateDraftStmt.run('scheduled', row.send_at, JSON.stringify(data), row.id);
        }
        let doku;
        db.transaction(() => { doku = writeDoku(row, data, session); deleteDraftStmt.run(row.id); })();
        if (doku) addressbook.notifyDoku(data.dokuCase, doku.id, doku.entry, session);
      } catch (error) {
        data.__attempts = (Number(data.__attempts) || 0) + 1;
        data.__error = (data.__sentReceipt ? 'Bereits gesendet. Falldokumentation wird erneut versucht: ' : '') + (error.message || 'Versand fehlgeschlagen.');
        // A documentation failure must never turn into another send, even after five retries.
        updateDraftStmt.run(data.__sentReceipt || data.__attempts < MAX_ATTEMPTS ? 'scheduled' : 'outbox',
          data.__sentReceipt || data.__attempts < MAX_ATTEMPTS ? new Date(Date.parse(now) + 300000).toISOString() : '', JSON.stringify(data), row.id);
      }
    } finally { sendingDrafts.delete(candidate.id); }
  }
  return due.length;
}

let timer = null;
function start() {
  if (DISABLED || timer) return;
  timer = setInterval(() => {
    applicationWriteBarrier.withWrite('Geplanter Mailversand', () => tick())
      .catch(() => { /* nächster Takt versucht es erneut */ });
  }, 30000);
  timer.unref?.();
}

module.exports = { tick, start, wakeSnoozes, cleanupRetention };

module.exports.wakeSnooze = wakeSnooze;
module.exports.snoozeBusy = id => wakingSnoozes.has(id);

module.exports.sendingDraft = id => sendingDrafts.has(id);
