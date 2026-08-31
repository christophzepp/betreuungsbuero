// Geplanter Versand ("Später senden", Mail Tier 1-3, Nutzerwunsch 2026-07-18): Entwürfe mit
// kind='scheduled' + send_at (ISO) werden fällig serverseitig verschickt - unabhängig davon, ob
// der Browser des Nutzers offen ist. Ein Timer prüft im Takt; MAILBOX_WATCH=0 schaltet den
// Auto-Timer ab (Tests rufen tick() direkt). Fehlversuche werden gezählt und nach mehreren
// Anläufen in den Postausgang (kind='outbox') überführt, damit der Nutzer sie sieht.

const db = require('../../database/index');
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
const caseExistsStmt = db.prepare('SELECT id FROM cases WHERE id = ?');

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

function writeDoku(caseId, ownerUserId, data) {
  try {
    if (!caseId || !caseExistsStmt.get(caseId)) return;
    const u = userNameStmt.get(ownerUserId) || {};
    const actor = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username || '';
    const dp = dokuDateParts(new Date());
    const mailText = stripHtmlToText(data.html || data.text || '').slice(0, 4000);
    const entry = {
      year: dp.year, date: dp.date, actorGroup: '', actor, type: 'Schriftverkehr',
      detail: 'E-Mail versendet (geplant)', freeDetail: '', contactType: 'E-Mail',
      note: 'An: ' + (data.to || '') + (data.cc ? ' · Cc: ' + data.cc : '') + ' – Betreff: ' + (data.subject || '(ohne Betreff)') + (mailText ? ' – Inhalt: ' + mailText : '')
    };
    insertDokuStmt.run({ id: require('crypto').randomUUID(), caseId, dataJson: JSON.stringify(entry), userId: ownerUserId });
  } catch (_e) { /* Doku ist Beiwerk - der Versand selbst zählt */ }
}

// ---- Wiedervorlage (Snooze): faellige Mails per Message-ID zurueck in den Posteingang ------
const dueSnoozesStmt = db.prepare("SELECT * FROM mail_snoozes WHERE wake_at != '' AND wake_at <= ? ORDER BY wake_at LIMIT 25");
const deleteSnoozeStmt = db.prepare('DELETE FROM mail_snoozes WHERE id = ?');
const bumpSnoozeStmt = db.prepare('UPDATE mail_snoozes SET attempts = attempts + 1 WHERE id = ?');

async function wakeSnoozes(now) {
  const due = dueSnoozesStmt.all(now);
  for (const row of due) {
    const acc = getAccountStmt.get(row.account_id);
    if (!acc) { deleteSnoozeStmt.run(row.id); continue; }
    const engine = acc.kind === 'microsoft' ? graphEngine : imapEngine;
    const inbox = acc.kind === 'microsoft' ? 'inbox' : 'INBOX';
    try {
      const uid = await engine.findByMessageId(acc, row.folder, row.message_id);
      if (uid != null) {
        await engine.moveMessage(acc, row.folder, uid, inbox);
        try {
          const backUid = await engine.findByMessageId(acc, inbox, row.message_id);
          if (backUid != null) await engine.setFlags(acc, inbox, backUid, { seen: false });
        } catch (_e) { /* ungelesen-Markierung ist Beiwerk */ }
      }
      deleteSnoozeStmt.run(row.id);
    } catch (_e) {
      if ((row.attempts || 0) + 1 >= MAX_ATTEMPTS) deleteSnoozeStmt.run(row.id);
      else bumpSnoozeStmt.run(row.id);
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

async function tick(nowIso) {
  const now = nowIso || new Date().toISOString();
  try { await wakeSnoozes(now); } catch (_e) { /* Snooze-Fehler blockieren den Versand nicht */ }
  try { await cleanupRetention(); } catch (_e) { /* dito */ }
  const due = dueStmt.all(now);
  for (const row of due) {
    let data = {}; try { data = JSON.parse(row.data_json || '{}'); } catch (_e) { data = {}; }
    const acc = getAccountStmt.get(row.account_id);
    const owner = row.owner_user_id;
    // Konto muss existieren und vom Absender nutzbar sein (eigenes privates oder büroweites).
    const usable = acc && (acc.visibility !== 'private' || acc.owner_user_id === owner);
    if (!usable) {
      updateDraftStmt.run('outbox', '', JSON.stringify(Object.assign(data, { __error: 'Versandkonto nicht mehr verfügbar.' })), row.id);
      continue;
    }
    try {
      await mailSend.sendViaAccount(acc, {
        to: data.to || '', cc: data.cc || '', bcc: data.bcc || '', subject: data.subject || '',
        html: data.html || '', text: data.text || '', attachments: attachmentsToBuffers(data.attachments),
        replyTo: data.replyTo || '', priority: data.priority || 'normal'
      });
      if (data.dokuCase) writeDoku(String(data.dokuCase), owner, data);
      deleteDraftStmt.run(row.id);
    } catch (error) {
      const attempts = (Number(data.__attempts) || 0) + 1;
      data.__attempts = attempts; data.__error = error.message || 'Versand fehlgeschlagen.';
      if (attempts >= MAX_ATTEMPTS) updateDraftStmt.run('outbox', '', JSON.stringify(data), row.id);
      else updateDraftStmt.run('scheduled', row.send_at, JSON.stringify(data), row.id);
    }
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
