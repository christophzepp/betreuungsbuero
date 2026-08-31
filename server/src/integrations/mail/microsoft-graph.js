// Microsoft-365-Postfachzugriff fuer den E-Mail-Baustein (Nutzerwunsch 2026-07-18) ueber Microsoft
// Graph - gleiches Datenformat wie mailbox-imap.js, damit routes/mailbox.js beide austauschbar
// nutzt. Läuft ueber eine autorisierte Microsoft-Kalenderverbindung (calendar_connections), wie der
// Graph-Mailversand in microsoft-mail.js. Benoetigt den delegierten Scope Mail.ReadWrite (steht in
// microsoft-calendar.js SCOPES; VOR der Scope-Aufnahme autorisierte Verbindungen muessen einmal neu
// "Verbinden" - der Refresh selbst bleibt scope-los und damit ungefaehrlich, siehe OAuth-Scope-Falle).

const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const msCal = require('../calendar/microsoft-calendar');

const GRAPH_API = 'https://graph.microsoft.com/v1.0';
const getConnStmt = db.prepare('SELECT * FROM calendar_connections WHERE id = ?');
const updateTokenStmt = db.prepare('UPDATE calendar_connections SET access_token_encrypted = @at, token_expires_at = @exp WHERE id = @id');

function graphConn(account) {
  const row = getConnStmt.get(account.graph_connection_id || '');
  if (!row || row.provider !== 'microsoft') throw new Error('Die hinterlegte Microsoft-Verbindung wurde nicht gefunden (Zugänge → Kalender & Aufgaben).');
  if (!row.refresh_token_encrypted) throw new Error('Die Microsoft-Verbindung ist noch nicht autorisiert (bitte einmal "Verbinden" ausführen).');
  return row;
}

// Authentifizierter Graph-Abruf mit Lazy-Refresh-on-401 + Token-Persistenz (Muster microsoft-mail.js).
async function gfetch(conn, url, options = {}) {
  const doFetch = (token) => fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token } });
  let token = cryptoHelper.decrypt(conn.access_token_encrypted || '');
  let res = token ? await doFetch(token) : { status: 401, ok: false };
  if (res.status === 401) {
    const refreshed = await msCal.refreshAccessToken(conn);
    token = refreshed.access_token;
    try {
      updateTokenStmt.run({ id: conn.id, at: cryptoHelper.encrypt(token), exp: new Date(Date.now() + ((refreshed.expires_in || 3600) * 1000)).toISOString() });
    } catch (_e) { /* Persistenz-Fehler ist fuer den laufenden Abruf unkritisch */ }
    res = await doFetch(token);
  }
  return res;
}

async function gjson(conn, url, options) {
  const res = await gfetch(conn, url, options);
  if (res.status === 204 || res.status === 202) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Microsoft Graph antwortete mit Status ${res.status}.`);
  return data;
}

// ---- Ordner ---------------------------------------------------------------------------------

const WELL_KNOWN = [
  ['inbox', '\\Inbox'], ['sentitems', '\\Sent'], ['drafts', '\\Drafts'],
  ['deleteditems', '\\Trash'], ['junkemail', '\\Junk'], ['archive', '\\Archive']
];

function normalizeFolderLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '');
}

function looksLikeDeletedItems(value) {
  const n = normalizeFolderLabel(value);
  return n === 'deleteditems' || n.includes('papierkorb') || n.includes('trash') || n.includes('geloscht') || n.includes('deleted');
}

async function isDeletedItemsFolder(conn, folderId) {
  if (looksLikeDeletedItems(folderId)) return true;
  try {
    const d = await gjson(conn, `${GRAPH_API}/me/mailFolders/deleteditems?$select=id,displayName`);
    return String(d.id || '') === String(folderId || '') || looksLikeDeletedItems(d.displayName);
  } catch (_e) {
    return false;
  }
}

async function wellKnownMap(conn) {
  const map = new Map();
  await Promise.all(WELL_KNOWN.map(async ([name, special]) => {
    try {
      const d = await gjson(conn, `${GRAPH_API}/me/mailFolders/${name}?$select=id`);
      if (d.id) map.set(d.id, special);
    } catch (_e) { /* Ordner existiert nicht (z. B. archive) - dann eben ohne Sonderrolle */ }
  }));
  return map;
}

function folderItem(f, specialMap, parentPath) {
  const name = f.displayName || f.id;
  return {
    path: f.id,
    name,
    delimiter: '/',
    parent: parentPath || '',
    specialUse: specialMap.get(f.id) || '',
    unseen: f.unreadItemCount || 0,
    total: f.totalItemCount || 0,
    childCount: f.childFolderCount || 0
  };
}

async function listFolders(account) {
  const conn = graphConn(account);
  const select = '$select=id,displayName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount';
  const [specialMap, top] = await Promise.all([
    wellKnownMap(conn),
    gjson(conn, `${GRAPH_API}/me/mailFolders?$top=100&${select}`)
  ]);
  // Voller Ordnerbaum per Breitensuche (Nutzerwunsch: tiefer als eine Ebene). Anzeige-Name traegt
  // die Pfadkette ("Eltern/Kind/Enkel"). Deckel: Tiefe 5, 300 Ordner - gegen pathologische Baeume.
  const folders = [];
  const queue = (top.value || []).map((f) => ({ f, parentId: '', prefix: '', depth: 0 }));
  while (queue.length && folders.length < 300) {
    const { f, parentId, prefix, depth } = queue.shift();
    const item = folderItem(f, specialMap, parentId);
    item.name = prefix + item.name;
    folders.push(item);
    if ((f.childFolderCount || 0) > 0 && depth < 5) {
      try {
        const kids = await gjson(conn, `${GRAPH_API}/me/mailFolders/${encodeURIComponent(f.id)}/childFolders?$top=100&${select}`);
        for (const k of kids.value || []) queue.push({ f: k, parentId: f.id, prefix: item.name + '/', depth: depth + 1 });
      } catch (_e) { /* Unterordner nicht lesbar - Hauptordner bleibt nutzbar */ }
    }
  }
  return folders;
}

async function renameFolder(account, folderId, newName) {
  const clean = String(newName || '').trim();
  if (!clean) throw new Error('Bitte einen neuen Ordnernamen angeben.');
  const conn = graphConn(account);
  const d = await gjson(conn, `${GRAPH_API}/me/mailFolders/${encodeURIComponent(folderId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: clean })
  });
  return { path: d.id || folderId };
}

// Graph verschiebt geloeschte Ordner samt Inhalt nach "Geloeschte Elemente" (wiederherstellbar).
async function deleteFolder(account, folderId) {
  const conn = graphConn(account);
  await gjson(conn, `${GRAPH_API}/me/mailFolders/${encodeURIComponent(folderId)}`, { method: 'DELETE' });
  return { ok: true };
}

async function createFolder(account, name, parentId) {
  const conn = graphConn(account);
  const url = parentId ? `${GRAPH_API}/me/mailFolders/${encodeURIComponent(parentId)}/childFolders` : `${GRAPH_API}/me/mailFolders`;
  const d = await gjson(conn, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name }) });
  return { path: d.id || name };
}

// Ordner umhaengen (DnD): Graph nutzt Ordner-IDs; verschieben via /move mit destinationId. Leerer
// Parent = oberste Ebene ('msgfolderroot' ist der wohlbekannte Wurzel-Alias von Graph).
async function moveFolder(account, folderId, parentId) {
  const conn = graphConn(account);
  const dest = String(parentId || '').trim() || 'msgfolderroot';
  const d = await gjson(conn, `${GRAPH_API}/me/mailFolders/${encodeURIComponent(folderId)}/move`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destinationId: dest })
  });
  return { path: (d && d.id) || folderId };
}

// ---- Nachrichten ----------------------------------------------------------------------------

function recipientsOf(list) {
  return (Array.isArray(list) ? list : []).map((r) => ({ name: r.emailAddress?.name || '', address: r.emailAddress?.address || '' }));
}

function messageItem(m) {
  return {
    uid: m.id,
    subject: m.subject || '',
    from: m.from ? { name: m.from.emailAddress?.name || '', address: m.from.emailAddress?.address || '' } : null,
    to: recipientsOf(m.toRecipients),
    date: m.receivedDateTime || m.sentDateTime || '',
    seen: m.isRead !== false,
    flagged: m.flag?.flagStatus === 'flagged',
    answered: false,
    size: 0,
    hasAttachments: !!m.hasAttachments,
    messageId: m.internetMessageId || '',
    preview: m.bodyPreview || '',
    categories: Array.isArray(m.categories) ? m.categories : [],
    priority: m.importance === 'high' ? 'high' : (m.importance === 'low' ? 'low' : 'normal')
  };
}

async function listMessages(account, folderId, { offset = 0, limit = 50, search = '', sinceDays = 0 } = {}) {
  const conn = graphConn(account);
  const select = '$select=id,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,flag,hasAttachments,bodyPreview,categories,importance,internetMessageId';
  let url;
  if (search) {
    // $search erlaubt weder $orderby noch $skip - Graph liefert relevanzsortiert die erste Seite.
    url = `${GRAPH_API}/me/mailFolders/${encodeURIComponent(folderId)}/messages?$search=${encodeURIComponent('"' + String(search).replace(/"/g, '') + '"')}&$top=${limit}&${select}`;
  } else {
    const flt = sinceDays > 0 ? `&$filter=${encodeURIComponent('receivedDateTime ge ' + new Date(Date.now() - sinceDays * 86400000).toISOString())}` : '';
    url = `${GRAPH_API}/me/mailFolders/${encodeURIComponent(folderId)}/messages?$orderby=receivedDateTime desc&$top=${limit}&$skip=${offset}&$count=true${flt}&${select}`;
  }
  const d = await gjson(conn, url, search ? { headers: { ConsistencyLevel: 'eventual' } } : undefined);
  const messages = (d.value || []).map(messageItem);
  const total = search ? messages.length + offset : (typeof d['@odata.count'] === 'number' ? d['@odata.count'] : offset + messages.length + (d['@odata.nextLink'] ? limit : 0));
  return { total, messages };
}

async function getMessage(account, folderId, uid) {
  const conn = graphConn(account);
  const d = await gjson(conn, `${GRAPH_API}/me/messages/${encodeURIComponent(uid)}?$select=id,subject,from,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,sentDateTime,body,internetMessageId,hasAttachments,importance`);
  let attachments = [];
  let html = d.body?.contentType === 'html' ? (d.body.content || '') : '';
  const text = d.body?.contentType === 'html' ? '' : (d.body?.content || '');
  if (d.hasAttachments || /cid:/i.test(html)) {
    const list = await gjson(conn, `${GRAPH_API}/me/messages/${encodeURIComponent(uid)}/attachments?$top=50`);
    const items = (list.value || []).filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment');
    attachments = items.map((a, index) => ({
      index,
      graphId: a.id,
      filename: a.name || `anhang-${index + 1}`,
      contentType: a.contentType || 'application/octet-stream',
      size: a.size || 0,
      inline: !!a.isInline
    }));
    // Inline-Bilder (cid:) als data:-URI einbetten - contentBytes liegen in der Antwort schon bei.
    let budget = 6 * 1024 * 1024;
    items.forEach((a) => {
      if (!a.isInline || !a.contentId || !a.contentBytes || !/^image\//i.test(a.contentType || '')) return;
      if (a.contentBytes.length > budget) return;
      const cid = String(a.contentId).replace(/[<>]/g, '');
      if (!html.includes(`cid:${cid}`)) return;
      budget -= a.contentBytes.length;
      html = html.split(`cid:${cid}`).join(`data:${a.contentType};base64,${a.contentBytes}`);
    });
  }
  return {
    uid,
    subject: d.subject || '',
    from: d.from ? { name: d.from.emailAddress?.name || '', address: d.from.emailAddress?.address || '' } : null,
    to: recipientsOf(d.toRecipients),
    cc: recipientsOf(d.ccRecipients),
    bcc: recipientsOf(d.bccRecipients),
    replyTo: recipientsOf(d.replyTo),
    date: d.receivedDateTime || d.sentDateTime || '',
    messageId: d.internetMessageId || '',
    inReplyTo: '',
    references: [],
    priority: d.importance === 'high' ? 'high' : (d.importance === 'low' ? 'low' : 'normal'),
    html,
    text,
    attachments: attachments.filter((a) => !a.inline)
  };
}

async function getAttachment(account, folderId, uid, index) {
  const conn = graphConn(account);
  const list = await gjson(conn, `${GRAPH_API}/me/messages/${encodeURIComponent(uid)}/attachments?$top=50`);
  const items = (list.value || []).filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment');
  const att = items[index];
  if (!att) throw new Error('Anhang nicht gefunden.');
  return {
    filename: att.name || `anhang-${index + 1}`,
    contentType: att.contentType || 'application/octet-stream',
    content: Buffer.from(att.contentBytes || '', 'base64')
  };
}

// ---- Aktionen -------------------------------------------------------------------------------

async function setFlags(account, folderId, uid, { seen, flagged }) {
  const conn = graphConn(account);
  const patch = {};
  if (seen === true || seen === false) patch.isRead = !!seen;
  if (flagged === true || flagged === false) patch.flag = { flagStatus: flagged ? 'flagged' : 'notFlagged' };
  if (!Object.keys(patch).length) return { ok: true };
  await gjson(conn, `${GRAPH_API}/me/messages/${encodeURIComponent(uid)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  return { ok: true };
}

async function moveMessage(account, folderId, uid, target) {
  const conn = graphConn(account);
  await gjson(conn, `${GRAPH_API}/me/messages/${encodeURIComponent(uid)}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destinationId: target }) });
  return { ok: true };
}

async function deleteMessage(account, folderId, uid) {
  const conn = graphConn(account);
  if (await isDeletedItemsFolder(conn, folderId)) {
    await gjson(conn, `${GRAPH_API}/me/messages/${encodeURIComponent(uid)}`, { method: 'DELETE' });
    return { ok: true, deleted: true, expunged: true };
  }
  // Graph akzeptiert Well-Known-Namen als destinationId - "deleteditems" = Papierkorb.
  await gjson(conn, `${GRAPH_API}/me/messages/${encodeURIComponent(uid)}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destinationId: 'deleteditems' }) });
  return { ok: true, moved: true, target: 'deleteditems' };
}

async function testConnection(account) {
  const conn = graphConn(account);
  const d = await gjson(conn, `${GRAPH_API}/me/mailFolders/inbox?$select=totalItemCount,unreadItemCount`);
  return { ok: true, messages: d.totalItemCount || 0, unseen: d.unreadItemCount || 0 };
}

// Roh-MIME der Nachricht (.eml-Export) ueber /$value.
async function getRaw(account, folderId, uid) {
  const conn = graphConn(account);
  const res = await gfetch(conn, `${GRAPH_API}/me/messages/${encodeURIComponent(uid)}/$value`);
  if (!res.ok) throw new Error('Nachricht konnte nicht als E-Mail-Datei geladen werden (' + res.status + ').');
  return Buffer.from(await res.text(), 'utf8');
}

// Farbige Labels: Graph-Kategorien (Name aus der bueroweiten Label-Definition des Clients).
async function setLabel(account, folderId, uid, slot, on, name) {
  const conn = graphConn(account);
  const label = String(name || ('Label ' + slot)).slice(0, 60);
  const cur = await gjson(conn, `${GRAPH_API}/me/messages/${encodeURIComponent(uid)}?$select=categories`);
  let cats = Array.isArray(cur.categories) ? cur.categories.slice() : [];
  cats = cats.filter((c) => c !== label);
  if (on) cats.push(label);
  await gjson(conn, `${GRAPH_API}/me/messages/${encodeURIComponent(uid)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categories: cats }) });
  return { ok: true };
}

async function findByMessageId(account, folderId, internetMessageId) {
  if (!internetMessageId) return null;
  const conn = graphConn(account);
  const flt = encodeURIComponent(`internetMessageId eq '${String(internetMessageId).replace(/'/g, "''")}'`);
  const collection = folderId
    ? `${GRAPH_API}/me/mailFolders/${encodeURIComponent(folderId)}/messages`
    : `${GRAPH_API}/me/messages`;
  const d = await gjson(conn, `${collection}?$filter=${flt}&$select=id,parentFolderId&$top=1`);
  return (d.value && d.value[0]) ? d.value[0].id : null;
}

async function purgeOlder(account, folderId, days) {
  const conn = graphConn(account);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const flt = encodeURIComponent(`receivedDateTime lt ${cutoff}`);
  const d = await gjson(conn, `${GRAPH_API}/me/mailFolders/${encodeURIComponent(folderId)}/messages?$filter=${flt}&$select=id&$top=50`);
  let n = 0;
  for (const m of d.value || []) {
    try { await gjson(conn, `${GRAPH_API}/me/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' }); n++; } catch (_e) { /* naechster Lauf */ }
  }
  return { deleted: n };
}

// Abwesenheitsnotiz (nur Microsoft; braucht Scope MailboxSettings.ReadWrite - Verbindungen von
// VOR der Scope-Aufnahme muessen einmal neu "Verbinden").
async function getAutoReply(account) {
  const conn = graphConn(account);
  const d = await gjson(conn, `${GRAPH_API}/me/mailboxSettings/automaticRepliesSetting`);
  return {
    status: d.status || 'disabled',
    internalReplyMessage: d.internalReplyMessage || '',
    externalReplyMessage: d.externalReplyMessage || '',
    scheduledStartDateTime: d.scheduledStartDateTime?.dateTime || '',
    scheduledEndDateTime: d.scheduledEndDateTime?.dateTime || ''
  };
}

async function setAutoReply(account, cfg) {
  const conn = graphConn(account);
  const setting = {
    status: ['disabled', 'alwaysEnabled', 'scheduled'].includes(cfg.status) ? cfg.status : 'disabled',
    externalAudience: 'all',
    internalReplyMessage: String(cfg.internalReplyMessage || ''),
    externalReplyMessage: String(cfg.externalReplyMessage || cfg.internalReplyMessage || '')
  };
  if (setting.status === 'scheduled') {
    setting.scheduledStartDateTime = { dateTime: String(cfg.scheduledStartDateTime || new Date().toISOString()).slice(0, 19), timeZone: 'W. Europe Standard Time' };
    setting.scheduledEndDateTime = { dateTime: String(cfg.scheduledEndDateTime || new Date(Date.now() + 7 * 86400000).toISOString()).slice(0, 19), timeZone: 'W. Europe Standard Time' };
  }
  await gjson(conn, `${GRAPH_API}/me/mailboxSettings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ automaticRepliesSetting: setting }) });
  return { ok: true };
}

// inboxStatus = Alias fuer den Posteingangs-Zaehlerabruf (nutzt der Mail-Watcher fuers Polling).
module.exports = { listFolders, createFolder, renameFolder, moveFolder, deleteFolder, listMessages, getMessage, getAttachment, setFlags, moveMessage, deleteMessage, testConnection, inboxStatus: testConnection, getRaw, setLabel, findByMessageId, purgeOlder, getAutoReply, setAutoReply };
