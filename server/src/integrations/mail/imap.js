// IMAP-Postfachzugriff fuer den E-Mail-Baustein (Nutzerwunsch 2026-07-18): duenne Schicht ueber
// ImapFlow (Verbindungen/Ordner/Nachrichten) + mailparser (MIME -> HTML/Text/Anhaenge).
// Deckt klassische Anbieter ab (GMX, Web.de, T-Online, 1&1, Gmail per App-Passwort ...);
// Microsoft-365-Postfaecher laufen NICHT hierueber, sondern ueber mailbox-graph.js (Basic-Auth-IMAP
// ist bei Outlook/M365 abgeschaltet). Beide Module liefern dieselben Datenformen an routes/mailbox.js.

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const cryptoHelper = require('../../security/crypto');

// ---- Verbindungs-Cache je Konto -------------------------------------------------------------
// Jeder Klick im Client (Ordnerliste, Nachrichtenliste, Einzelmail) wuerde sonst einen kompletten
// TLS+LOGIN-Handshake kosten. Die Verbindung bleibt 60 s nach dem letzten Zugriff offen; ImapFlow
// serialisiert Kommandos intern, Ordnerwechsel laufen ueber getMailboxLock (kein Parallel-Chaos).
const pool = new Map(); // accountId -> { client, timer }

function dropClient(accountId) {
  const entry = pool.get(accountId);
  if (!entry) return;
  pool.delete(accountId);
  if (entry.timer) clearTimeout(entry.timer);
  try { entry.client.close(); } catch (_e) { /* Verbindung ist ohnehin hin */ }
}

function touchIdleTimer(accountId) {
  const entry = pool.get(accountId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    const e = pool.get(accountId);
    if (!e) return;
    pool.delete(accountId);
    e.client.logout().catch(() => { try { e.client.close(); } catch (_e2) { /* egal */ } });
  }, 60000);
  entry.timer.unref?.();
}

function buildClient(account) {
  return new ImapFlow({
    host: account.imap_host,
    port: Number(account.imap_port) || 993,
    secure: account.imap_secure !== 0,
    auth: { user: account.imap_user, pass: cryptoHelper.decrypt(account.imap_pass_encrypted || '') },
    logger: false,
    socketTimeout: 120000,
    connectionTimeout: 20000
  });
}

async function getClient(account) {
  const cached = pool.get(account.id);
  if (cached && cached.client.usable) { touchIdleTimer(account.id); return cached.client; }
  if (cached) dropClient(account.id);
  const client = buildClient(account);
  client.on('error', () => dropClient(account.id));
  client.on('close', () => dropClient(account.id));
  await client.connect();
  pool.set(account.id, { client, timer: null });
  touchIdleTimer(account.id);
  return client;
}

// Ein Kommando unter Mailbox-Lock ausfuehren; bei gerissener Verbindung genau EIN Neuversuch.
async function withMailbox(account, path, fn, readOnly = true) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = await getClient(account);
    let lock = null;
    try {
      lock = await client.getMailboxLock(path, { readOnly });
      const result = await fn(client);
      touchIdleTimer(account.id);
      return result;
    } catch (error) {
      if (!client.usable && attempt === 0) { dropClient(account.id); continue; }
      throw error;
    } finally {
      try { lock?.release(); } catch (_e) { /* Lock war schon frei */ }
    }
  }
  throw new Error('IMAP-Verbindung nicht nutzbar.');
}

// ---- Ordner ---------------------------------------------------------------------------------

function normalizeFolderLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/\\/g, '/')
    .replace(/[\s_-]+/g, '');
}

function looksLikeTrashFolder(value) {
  const n = normalizeFolderLabel(value);
  return n.includes('papierkorb') || n.includes('trash') || n.includes('geloscht') || n.includes('geloescht') || n.includes('deleted');
}

function isCurrentTrashFolder(folders, path) {
  const wanted = normalizeFolderLabel(path);
  return folders.some((f) => f.specialUse === '\\Trash' && (
    normalizeFolderLabel(f.path) === wanted ||
    normalizeFolderLabel(f.name) === wanted ||
    (looksLikeTrashFolder(path) && (looksLikeTrashFolder(f.path) || looksLikeTrashFolder(f.name)))
  ));
}

function specialUseOf(box) {
  const su = box.specialUse || '';
  if (su) return su;
  const n = normalizeFolderLabel(`${box.name || ''} ${box.path || ''}`);
  if (normalizeFolderLabel(box.path) === 'inbox') return '\\Inbox';
  if (/gesendet|sent/.test(n)) return '\\Sent';
  if (/entwurfe|entwuerfe|draft/.test(n)) return '\\Drafts';
  if (looksLikeTrashFolder(n)) return '\\Trash';
  if (/spam|junk|unerw/.test(n)) return '\\Junk';
  if (/^archiv|^archive/.test(n)) return '\\Archive';
  return '';
}

async function listFolders(account) {
  const client = await getClient(account);
  const boxes = await client.list();
  const folders = [];
  for (const box of boxes) {
    if (box.flags && box.flags.has && box.flags.has('\\Noselect')) continue;
    const folder = {
      path: box.path,
      name: box.name || box.path,
      delimiter: box.delimiter || '/',
      parent: box.parentPath || '',
      specialUse: specialUseOf(box),
      unseen: 0,
      total: 0
    };
    try {
      const st = await client.status(box.path, { unseen: true, messages: true });
      folder.unseen = st.unseen || 0;
      folder.total = st.messages || 0;
    } catch (_e) { /* STATUS scheitert bei manchen Servern auf Sonderordnern - Zaehler bleiben 0 */ }
    folders.push(folder);
  }
  touchIdleTimer(account.id);
  return folders;
}

async function createFolder(account, name, parent) {
  const client = await getClient(account);
  let path = String(name || '').trim();
  const par = String(parent || '').trim();
  if (par) {
    // Trennzeichen des Elternordners nutzen (Server-abhaengig '/' oder '.'), sonst laege der
    // Unterordner flach daneben. Fallback '/' falls die Ordnerliste nichts hergibt.
    let delim = '/';
    try { const boxes = await client.list(); const pb = boxes.find((b) => b.path === par); if (pb && pb.delimiter) delim = pb.delimiter; } catch (_e) { /* Fallback bleibt */ }
    path = par + delim + path;
  }
  const res = await client.mailboxCreate(path);
  touchIdleTimer(account.id);
  return { path: res?.path || path };
}

// Ordner umhaengen (DnD): Blattname beibehalten, neuen Elternpfad davorsetzen (parent leer = oberste
// Ebene). Umsetzung per IMAP-RENAME; Unterordner ziehen auf gaengigen Servern mit um.
async function moveFolder(account, path, parent) {
  const src = String(path || '').trim();
  if (!src) throw new Error('Kein Ordner angegeben.');
  if (/^inbox$/i.test(src)) throw new Error('Der Posteingang kann nicht verschoben werden.');
  const client = await getClient(account);
  const boxes = await client.list();
  const box = boxes.find((b) => b.path === src);
  if (!box) throw new Error('Ordner nicht gefunden.');
  const delim = box.delimiter || '/';
  const par = String(parent || '').trim();
  if (par && (par + delim).indexOf(src + delim) === 0) throw new Error('Ein Ordner kann nicht in seinen eigenen Unterordner verschoben werden.');
  const idx = src.lastIndexOf(delim);
  const leaf = idx >= 0 ? src.slice(idx + delim.length) : src;
  const newPath = par ? (par + delim + leaf) : leaf;
  if (newPath === src) return { path: src };
  await client.mailboxRename(src, newPath);
  touchIdleTimer(account.id);
  return { path: newPath };
}

// Umbenennen: nur das letzte Pfadsegment wird ersetzt, der Eltern-Prefix bleibt (IMAP-RENAME
// nimmt die Unterordner auf gaengigen Servern mit). Der Posteingang ist tabu (RFC-Sonderfall).
async function renameFolder(account, path, newName) {
  if (/^inbox$/i.test(String(path))) throw new Error('Der Posteingang kann nicht umbenannt werden.');
  const clean = String(newName || '').trim();
  if (!clean) throw new Error('Bitte einen neuen Ordnernamen angeben.');
  const client = await getClient(account);
  const boxes = await client.list();
  const box = boxes.find((b) => b.path === path);
  if (!box) throw new Error('Ordner nicht gefunden.');
  const delim = box.delimiter || '/';
  const parent = box.parentPath || '';
  const newPath = parent ? parent + delim + clean : clean;
  await client.mailboxRename(path, newPath);
  touchIdleTimer(account.id);
  return { path: newPath };
}

// Loeschen entfernt Ordner UND Inhalt endgueltig (IMAP kennt keinen Papierkorb fuer Ordner) -
// die Rueckfrage dazu stellt der Client.
async function deleteFolder(account, path) {
  if (/^inbox$/i.test(String(path))) throw new Error('Der Posteingang kann nicht gelöscht werden.');
  const client = await getClient(account);
  await client.mailboxDelete(path);
  touchIdleTimer(account.id);
  return { ok: true };
}

// ---- Nachrichtenlisten ----------------------------------------------------------------------

function hasAttachmentParts(node) {
  if (!node) return false;
  const disp = String(node.disposition || '').toLowerCase();
  if (disp === 'attachment') return true;
  const filename = node.dispositionParameters?.filename || node.parameters?.name;
  if (filename && !/^(text|multipart)\//i.test(String(node.type || ''))) return true;
  return Array.isArray(node.childNodes) ? node.childNodes.some(hasAttachmentParts) : false;
}

function addr(one) { return one ? { name: one.name || '', address: one.address || '' } : null; }
function addrList(list) { return Array.isArray(list) ? list.map(addr).filter(Boolean) : []; }

// Prioritaet aus den Kopfzeilen (X-Priority 1/2 bzw. Importance high -> hoch; 4/5 bzw. low -> niedrig).
function priorityFromHeaders(buf) {
  const h = String(buf || '').toLowerCase();
  if (/x-priority:\s*[12]/.test(h) || /importance:\s*high/.test(h) || /priority:\s*urgent/.test(h)) return 'high';
  if (/x-priority:\s*[45]/.test(h) || /importance:\s*low/.test(h) || /priority:\s*non-urgent/.test(h)) return 'low';
  return 'normal';
}

function envelopeItem(msg) {
  const env = msg.envelope || {};
  const flags = msg.flags || new Set();
  return {
    uid: msg.uid,
    labels: [...flags].filter((f) => /^MXLabel[1-6]$/.test(f)).map((f) => Number(f.slice(7))),
    subject: env.subject || '',
    from: addrList(env.from)[0] || null,
    to: addrList(env.to),
    date: env.date ? new Date(env.date).toISOString() : '',
    seen: flags.has('\\Seen'),
    flagged: flags.has('\\Flagged'),
    answered: flags.has('\\Answered'),
    size: msg.size || 0,
    hasAttachments: hasAttachmentParts(msg.bodyStructure),
    messageId: env.messageId || '',
    priority: priorityFromHeaders(msg.headers)
  };
}

async function listMessages(account, path, { offset = 0, limit = 50, search = '', sinceDays = 0 } = {}) {
  return withMailbox(account, path, async (client) => {
    const fetchOpts = { envelope: true, flags: true, bodyStructure: true, size: true, uid: true, headers: ['x-priority', 'importance', 'priority'] };
    const messages = [];
    if (search) {
      const q = String(search);
      // OR-Kaskade Betreff/Absender/Empfaenger/Text - deckt die uebliche "Suche oben rechts" ab.
      const uids = await client.search({ or: [{ subject: q }, { from: q }, { to: q }, { body: q }] }, { uid: true });
      const sorted = (uids || []).map(Number).sort((a, b) => b - a);
      const page = sorted.slice(offset, offset + limit);
      if (page.length) {
        for await (const msg of client.fetch(page.join(','), fetchOpts, { uid: true })) messages.push(envelopeItem(msg));
      }
      messages.sort((a, b) => b.uid - a.uid);
      return { total: sorted.length, messages };
    }
    // Nachlade-Fenster: nur Nachrichten der letzten N Tage (per UID-Suche SINCE); 0 = alle.
    if (sinceDays > 0) {
      const since = new Date(Date.now() - sinceDays * 86400000);
      const uids = (await client.search({ since }, { uid: true }) || []).map(Number).sort((a, b) => b - a);
      const page = uids.slice(offset, offset + limit);
      if (page.length) {
        for await (const msg of client.fetch(page.join(','), fetchOpts, { uid: true })) messages.push(envelopeItem(msg));
      }
      messages.sort((a, b) => b.uid - a.uid);
      return { total: uids.length, messages };
    }
    const total = client.mailbox.exists || 0;
    const to = total - offset;
    if (total === 0 || to < 1) return { total, messages: [] };
    const from = Math.max(1, to - limit + 1);
    for await (const msg of client.fetch(`${from}:${to}`, fetchOpts)) messages.push(envelopeItem(msg));
    messages.sort((a, b) => b.uid - a.uid);
    return { total, messages };
  });
}

// ---- Einzelnachricht ------------------------------------------------------------------------

async function downloadRaw(account, path, uid) {
  return withMailbox(account, path, async (client) => {
    const dl = await client.download(String(uid), undefined, { uid: true });
    if (!dl || !dl.content) throw new Error('Nachricht nicht gefunden.');
    const chunks = [];
    for await (const chunk of dl.content) chunks.push(chunk);
    return Buffer.concat(chunks);
  });
}

// Inline-Bilder (cid:...) direkt als data:-URI in das HTML einbetten - der Client braucht dann
// keinen zweiten Abruf und der sandbox-iframe keine Netzfreigabe. Deckel 6 MB gegen Speicherfresser.
function inlineCidImages(html, attachments) {
  let out = String(html || '');
  let budget = 6 * 1024 * 1024;
  for (const att of attachments) {
    if (!att.cid || !att.content || !/^image\//i.test(att.contentType || '')) continue;
    if (att.content.length > budget) continue;
    const cid = String(att.cid).replace(/[<>]/g, '');
    if (!out.includes(`cid:${cid}`)) continue;
    budget -= att.content.length;
    const dataUrl = `data:${att.contentType};base64,${att.content.toString('base64')}`;
    out = out.split(`cid:${cid}`).join(dataUrl);
  }
  return out;
}

async function getMessage(account, path, uid) {
  const raw = await downloadRaw(account, path, uid);
  const parsed = await simpleParser(raw);
  const atts = parsed.attachments || [];
  const html = parsed.html ? inlineCidImages(parsed.html, atts) : '';
  return {
    uid,
    subject: parsed.subject || '',
    from: addrList(parsed.from?.value)[0] || null,
    to: addrList(parsed.to?.value),
    cc: addrList(parsed.cc?.value),
    bcc: addrList(parsed.bcc?.value),
    replyTo: addrList(parsed.replyTo?.value),
    date: parsed.date ? parsed.date.toISOString() : '',
    messageId: parsed.messageId || '',
    inReplyTo: parsed.inReplyTo || '',
    references: Array.isArray(parsed.references) ? parsed.references : (parsed.references ? [parsed.references] : []),
    priority: (parsed.headers && (String(parsed.headers.get('x-priority') || '').match(/^[12]/) || /high/i.test(String(parsed.headers.get('importance') || '')))) ? 'high'
      : ((parsed.headers && (String(parsed.headers.get('x-priority') || '').match(/^[45]/) || /low/i.test(String(parsed.headers.get('importance') || '')))) ? 'low' : 'normal'),
    html,
    text: parsed.text || '',
    attachments: atts.map((a, index) => ({
      index,
      filename: a.filename || `anhang-${index + 1}`,
      contentType: a.contentType || 'application/octet-stream',
      size: a.size || (a.content ? a.content.length : 0),
      inline: String(a.contentDisposition || '').toLowerCase() === 'inline' && !!a.cid
    }))
  };
}

async function getAttachment(account, path, uid, index) {
  const raw = await downloadRaw(account, path, uid);
  const parsed = await simpleParser(raw);
  const att = (parsed.attachments || [])[index];
  if (!att) throw new Error('Anhang nicht gefunden.');
  return { filename: att.filename || `anhang-${index + 1}`, contentType: att.contentType || 'application/octet-stream', content: att.content };
}

// Farbige Labels (Tier R2): als IMAP-Keywords MXLabel1..6 am Server gespeichert.
async function setLabel(account, path, uid, slot, on) {
  const kw = 'MXLabel' + Math.min(6, Math.max(1, Number(slot) || 1));
  return withMailbox(account, path, async (client) => {
    if (on) await client.messageFlagsAdd(String(uid), [kw], { uid: true });
    else await client.messageFlagsRemove(String(uid), [kw], { uid: true });
    return { ok: true };
  }, false);
}

// Nachricht ueber die Message-ID wiederfinden (UIDs aendern sich beim Verschieben - die
// Wiedervorlage merkt sich deshalb die Header-ID).
async function findByMessageId(account, path, messageId) {
  if (!messageId) return null;
  return withMailbox(account, path, async (client) => {
    const uids = await client.search({ header: { 'message-id': messageId } }, { uid: true });
    return (uids && uids.length) ? uids[0] : null;
  });
}

// Automatisches Leeren: alles aelter als N Tage endgueltig loeschen (Papierkorb/Spam).
async function purgeOlder(account, path, days) {
  const cutoff = new Date(Date.now() - days * 86400000);
  return withMailbox(account, path, async (client) => {
    const uids = await client.search({ before: cutoff }, { uid: true });
    if (uids && uids.length) await client.messageDelete(uids.join(','), { uid: true });
    return { deleted: (uids || []).length };
  }, false);
}

// ---- Aktionen -------------------------------------------------------------------------------

async function setFlags(account, path, uid, { seen, flagged }) {
  return withMailbox(account, path, async (client) => {
    if (seen === true) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    if (seen === false) await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
    if (flagged === true) await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true });
    if (flagged === false) await client.messageFlagsRemove(String(uid), ['\\Flagged'], { uid: true });
    return { ok: true };
  }, false);
}

async function moveMessage(account, path, uid, target) {
  return withMailbox(account, path, async (client) => {
    await client.messageMove(String(uid), target, { uid: true });
    return { ok: true, target };
  }, false);
}

async function deleteMessage(account, path, uid) {
  const folders = await listFolders(account);
  const trash = folders.find((f) => f.specialUse === '\\Trash');
  if (trash && !isCurrentTrashFolder(folders, path)) return moveMessage(account, path, uid, trash.path);
  return withMailbox(account, path, async (client) => {
    await client.messageDelete(String(uid), { uid: true });
    return { ok: true, expunged: true };
  }, false);
}

// Gesendete Mail in den Gesendet-Ordner legen (SMTP kennt anders als Graph kein automatisches
// "Sent Items"). Fehlt der Ordner, wird er angelegt - besser als die Kopie zu verlieren.
async function appendSent(account, rawBuffer) {
  const folders = await listFolders(account);
  let sent = folders.find((f) => f.specialUse === '\\Sent');
  if (!sent) {
    try { await createFolder(account, 'Gesendet'); sent = { path: 'Gesendet' }; } catch (_e) { return { ok: false }; }
  }
  const client = await getClient(account);
  await client.append(sent.path, rawBuffer, ['\\Seen'], new Date());
  touchIdleTimer(account.id);
  return { ok: true, path: sent.path };
}

// Verbindungstest fuer den Konten-Dialog: frische Verbindung, INBOX-Status, sauber abmelden.
async function testConnection(account) {
  const client = buildClient(account);
  try {
    await client.connect();
    const st = await client.status('INBOX', { messages: true, unseen: true });
    return { ok: true, messages: st.messages || 0, unseen: st.unseen || 0 };
  } finally {
    client.logout().catch(() => { try { client.close(); } catch (_e) { /* egal */ } });
  }
}

module.exports = { listFolders, createFolder, renameFolder, moveFolder, deleteFolder, listMessages, getMessage, getAttachment, setFlags, moveMessage, deleteMessage, appendSent, testConnection, getRaw: downloadRaw, setLabel, findByMessageId, purgeOlder };
