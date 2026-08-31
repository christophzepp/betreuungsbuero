// Nutzer-zu-Nutzer-Chat (Nutzerwunsch 2026-08-12): büro-interner Chat zwischen den Konten dieses
// Büros - Direktnachrichten und Gruppen, optional mit Fall-/Dokument-Verweisen, kleinen Anlagen
// (BLOB in der DB, wie intake_files) und KI-Beiträgen. Kein eigenes Berechtigungs-Flag: der Chat
// ist büro-intern für alle Konten, requireAuth genügt (Sichtbarkeit regelt die Teilnehmerschaft).
// Echtzeit nach dem setRealtime-Muster aus cases/routes.js: die REST-Route persistiert, danach
// stellt die WebSocket-Schicht an alle Teilnehmer zu - AUSSER an das auslösende Fenster
// (X-Window-Id), damit der Absender seine Nachricht nicht doppelt sieht (Echo-Regel v175).

const express = require('express');
const crypto = require('crypto');
const db = require('../../database/index');
const { requireAuth } = require('../../middleware/authentication');

const router = express.Router();
router.use(requireAuth);

let realtime = null;
function setRealtime(rt) { realtime = rt; }

// Limits laut API-Vertrag (Nutzerwunsch 2026-08-12).
const BODY_MAX_BYTES = 16 * 1024;
const REFS_MAX = 20;
const ATTACHMENTS_MAX = 5;
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const NAME_MIME_MAX_CHARS = 300;
const STATUS_VALUES = new Set(['online', 'away', 'busy', 'offline']);

// displayName-Konvention wie überall: display_name, sonst username.
/* Demo-Modus (30.08.2026): Vorfuehrkonten (is_demo=1) und echte Konten sehen einander im
   Chat NIRGENDS - Nutzerliste und Teilnehmerpruefung filtern nach der Klasse der Sitzung.
   Dadurch koennen an einer Unterhaltung nie beide Welten beteiligt sein (fail-closed),
   und die Aufraeumung beim Ausschalten darf jede Demo-Unterhaltung komplett loeschen. */
const listUsersStmt = db.prepare(`
  SELECT u.id, COALESCE(NULLIF(u.display_name, ''), u.username) AS displayName,
         u.initials, u.calendar_color, s.status AS manualStatus
    FROM users u
    LEFT JOIN chat_user_status s ON s.user_id = u.id
   WHERE u.active = 1 AND u.is_demo = ?
   ORDER BY displayName COLLATE NOCASE
`);
const activeUserStmt = db.prepare('SELECT id FROM users WHERE id = ? AND active = 1 AND is_demo = ?');

const getConversationStmt = db.prepare('SELECT * FROM chat_conversations WHERE id = ?');
const getDirectStmt = db.prepare('SELECT * FROM chat_conversations WHERE direct_key = ?');
const myConversationsStmt = db.prepare(`
  SELECT c.*
    FROM chat_conversations c
    JOIN chat_participants p ON p.conversation_id = c.id
   WHERE p.user_id = ?
   ORDER BY c.updated_at DESC, c.created_at DESC
`);
const insertConversationStmt = db.prepare(`
  INSERT INTO chat_conversations (id, type, title, direct_key, created_by)
  VALUES (@id, @type, @title, @directKey, @createdBy)
`);
const touchConversationStmt = db.prepare("UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?");

const participantsStmt = db.prepare(`
  SELECT p.user_id AS id, COALESCE(NULLIF(u.display_name, ''), u.username) AS displayName,
         p.last_read_at AS lastReadAt
    FROM chat_participants p
    JOIN users u ON u.id = p.user_id
   WHERE p.conversation_id = ?
   ORDER BY p.user_id
`);
// Mitgliedschaftsprüfung: Nicht-Teilnehmer bekommen dieselbe 404 wie bei einer unbekannten
// Unterhaltung - nach außen ist nicht unterscheidbar, OB es die Unterhaltung gibt (Vertrag).
const membershipStmt = db.prepare('SELECT last_read_at FROM chat_participants WHERE conversation_id = ? AND user_id = ?');
const insertParticipantStmt = db.prepare('INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)');
const setReadStmt = db.prepare("UPDATE chat_participants SET last_read_at = datetime('now') WHERE conversation_id = ? AND user_id = ?");

// Nachrichten immer mit aufgelösten Namen lesen (LEFT JOIN: KI-Beiträge haben keinen Absender).
const MESSAGE_SELECT = `
  SELECT m.*, COALESCE(NULLIF(su.display_name, ''), su.username) AS senderName,
         COALESCE(NULLIF(au.display_name, ''), au.username) AS aiRequestedByName
    FROM chat_messages m
    LEFT JOIN users su ON su.id = m.sender_user_id
    LEFT JOIN users au ON au.id = m.ai_requested_by
`;
const getMessageStmt = db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`);
const lastMessageStmt = db.prepare(`${MESSAGE_SELECT} WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 1`);
const pageLatestStmt = db.prepare(`${MESSAGE_SELECT} WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?`);
const pageBeforeStmt = db.prepare(`
  ${MESSAGE_SELECT}
   WHERE m.conversation_id = ? AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))
   ORDER BY m.created_at DESC, m.id DESC LIMIT ?
`);
const insertMessageStmt = db.prepare(`
  INSERT INTO chat_messages (id, conversation_id, kind, sender_user_id, ai_requested_by, body, refs_json)
  VALUES (@id, @conversationId, @kind, @senderUserId, @aiRequestedBy, @body, @refsJson)
`);
// Ungelesen laut Vertrag: neuer als der eigene Lesestand und nicht von mir selbst. KI-Beiträge
// (sender NULL) zählen bewusst auch beim Anforderer als ungelesen - die Antwort kam ja NACH
// seiner letzten Lesung.
const unreadStmt = db.prepare(`
  SELECT COUNT(*) AS n FROM chat_messages
   WHERE conversation_id = ? AND created_at > ? AND (sender_user_id IS NULL OR sender_user_id != ?)
`);

const listAttachmentsStmt = db.prepare('SELECT id, name, mime, size FROM chat_attachments WHERE message_id = ? ORDER BY rowid');
const insertAttachmentStmt = db.prepare('INSERT INTO chat_attachments (id, message_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?, ?)');
const getAttachmentStmt = db.prepare(`
  SELECT a.*, m.conversation_id
    FROM chat_attachments a
    JOIN chat_messages m ON m.id = a.message_id
   WHERE a.id = ?
`);

const upsertStatusStmt = db.prepare(`
  INSERT INTO chat_user_status (user_id, status, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
`);

// Unterhaltung anlegen + Teilnehmer eintragen in EINEM Schritt - eine halb angelegte Gruppe
// (Unterhaltung ohne Teilnehmer) wäre für alle unsichtbar und unlöschbar.
const createConversationTx = db.transaction((conversation, userIds) => {
  insertConversationStmt.run(conversation);
  for (const userId of userIds) insertParticipantStmt.run(conversation.id, userId);
});
// Nachricht + Anlagen + updated_at der Unterhaltung atomar: die Unterhaltungs-Sortierung
// (updatedAt absteigend) muss jede neue Nachricht sofort widerspiegeln.
const insertMessageTx = db.transaction((message, attachments) => {
  insertMessageStmt.run(message);
  for (const file of attachments) {
    insertAttachmentStmt.run(file.id, message.id, file.name, file.mime, file.data.length, file.data);
  }
  touchConversationStmt.run(message.conversationId);
});

// Initialen aus dem Anzeigenamen ableiten, wenn das Stammdaten-Feld leer ist
// ("Anna Admin" -> "AA", "ben" -> "B") - der Client zeichnet daraus die Avatar-Kreise.
function derivedInitials(displayName) {
  return String(displayName || '').trim().split(/\s+/).filter(Boolean)
    .slice(0, 2).map((word) => word[0].toUpperCase()).join('');
}

function messagePayload(row) {
  let refs = [];
  try { refs = JSON.parse(row.refs_json || '[]'); } catch (_e) { /* defekte Zeile: keine Verweise */ }
  const istKi = row.kind === 'ki';
  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: istKi ? 'ki' : 'user',
    senderUserId: row.sender_user_id != null ? row.sender_user_id : null,
    senderName: istKi ? 'KI-Assistent' : (row.senderName || 'Unbekannt'),
    aiRequestedBy: row.ai_requested_by != null ? row.ai_requested_by : null,
    aiRequestedByName: row.aiRequestedByName || null,
    body: row.body,
    refs: Array.isArray(refs) ? refs : [],
    attachments: listAttachmentsStmt.all(row.id),
    createdAt: row.created_at
  };
}

function conversationPayload(row, sessionUserId) {
  const teilnahme = membershipStmt.get(row.id, sessionUserId);
  const letzte = lastMessageStmt.get(row.id);
  let lastMessage = null;
  if (letzte) {
    const voll = messagePayload(letzte);
    lastMessage = {
      id: voll.id, kind: voll.kind, senderUserId: voll.senderUserId,
      senderName: voll.senderName, body: voll.body, createdAt: voll.createdAt
    };
  }
  return {
    id: row.id,
    type: row.type === 'group' ? 'group' : 'direct',
    // Direkt-Unterhaltungen tragen keinen Titel - der Client zeigt den Namen des Gegenübers.
    title: row.type === 'group' ? row.title : '',
    participants: participantsStmt.all(row.id),
    lastMessage,
    unread: unreadStmt.get(row.id, teilnahme ? teilnahme.last_read_at : '', sessionUserId).n,
    updatedAt: row.updated_at
  };
}

function participantUserIds(conversationId) {
  return participantsStmt.all(conversationId).map((p) => p.id);
}

// Alle aktiven Konten mit Präsenzstatus. Der manuell gewählte Status (chat_user_status) gewinnt -
// auch 'offline' (unsichtbar trotz Verbindung); nur ohne manuelle Wahl (oder bei 'online')
// entscheidet die tatsächliche WebSocket-Verbindung. Defensiv: ohne Echtzeitdienst (Testaufbau,
// Recovery) gilt niemand als verbunden.
router.get('/users', (req, res) => {
  const online = (realtime && typeof realtime.onlineUserIds === 'function') ? realtime.onlineUserIds() : new Set();
  const users = listUsersStmt.all(req.session.isDemo ? 1 : 0).map((row) => ({
    id: row.id,
    displayName: row.displayName,
    initials: String(row.initials || '').trim() || derivedInitials(row.displayName),
    color: row.calendar_color || null,
    status: (row.manualStatus && row.manualStatus !== 'online')
      ? row.manualStatus
      : (online.has(row.id) ? 'online' : 'offline')
  }));
  res.json({ users });
});

// Alle Unterhaltungen, in denen der Sitzungsnutzer Teilnehmer ist (Sortierung: updatedAt
// absteigend, schon im SQL).
router.get('/conversations', (req, res) => {
  const conversations = myConversationsStmt.all(req.session.userId)
    .map((row) => conversationPayload(row, req.session.userId));
  res.json({ conversations });
});

// Neue Unterhaltung. 2 Teilnehmer gesamt ohne Titel = Direktnachricht - über direct_key
// dedupliziert (die bestehende Unterhaltung derselben zwei Nutzer kommt mit 200 zurück,
// statt eine zweite anzulegen). Alles andere ist eine Gruppe.
router.post('/conversations', (req, res) => {
  const raw = req.body && req.body.participantIds;
  if (!Array.isArray(raw) || !raw.length) {
    return res.status(400).json({ error: 'participantIds erforderlich (nichtleere Liste von Nutzer-IDs).' });
  }
  const ids = new Set();
  for (const value of raw) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'participantIds enthält eine ungültige Nutzerkennung.' });
    }
    ids.add(id);
  }
  ids.add(req.session.userId); // Der Sitzungsnutzer ist immer selbst Teilnehmer.
  for (const id of ids) {
    if (!activeUserStmt.get(id, req.session.isDemo ? 1 : 0)) return res.status(404).json({ error: 'Unbekannter oder inaktiver Nutzer.' });
  }
  const title = typeof (req.body && req.body.title) === 'string' ? req.body.title.trim() : '';
  const teilnehmer = [...ids].sort((a, b) => a - b);
  const istDirekt = teilnehmer.length === 2 && !title;
  if (istDirekt) {
    const existing = getDirectStmt.get(`${teilnehmer[0]}:${teilnehmer[1]}`);
    if (existing) return res.status(200).json({ conversation: conversationPayload(existing, req.session.userId) });
  }
  const conversation = {
    id: crypto.randomUUID(),
    type: istDirekt ? 'direct' : 'group',
    title: istDirekt ? '' : title,
    directKey: istDirekt ? `${teilnehmer[0]}:${teilnehmer[1]}` : null,
    createdBy: req.session.userId
  };
  createConversationTx(conversation, teilnehmer);
  res.status(201).json({ conversation: conversationPayload(getConversationStmt.get(conversation.id), req.session.userId) });
});

// Nachrichtenseite, aufsteigend nach created_at. Ohne before: die neuesten <limit> Nachrichten;
// mit before=<messageId>: die <limit> Nachrichten davor (Rückwärtsblättern beim Hochscrollen).
router.get('/conversations/:id/messages', (req, res) => {
  const conversationId = req.params.id;
  if (!membershipStmt.get(conversationId, req.session.userId)) {
    return res.status(404).json({ error: 'Unterhaltung nicht gefunden.' });
  }
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  let rows;
  if (req.query.before) {
    const anker = getMessageStmt.get(String(req.query.before));
    if (!anker || anker.conversation_id !== conversationId) {
      return res.status(400).json({ error: 'before verweist auf keine Nachricht dieser Unterhaltung.' });
    }
    rows = pageBeforeStmt.all(conversationId, anker.created_at, anker.created_at, anker.id, limit);
  } else {
    rows = pageLatestStmt.all(conversationId, limit);
  }
  rows.reverse(); // absteigend geblättert, aufsteigend ausgeliefert (Vertrag)
  res.json({ messages: rows.map(messagePayload) });
});

// Nachricht senden. kind='ki' trägt eine KI-Antwort in die Unterhaltung ein: kein Absender,
// aber ai_requested_by hält fest, WER die KI gefragt hat (Transparenz gegenüber den anderen).
router.post('/conversations/:id/messages', (req, res) => {
  const conversationId = req.params.id;
  if (!membershipStmt.get(conversationId, req.session.userId)) {
    return res.status(404).json({ error: 'Unterhaltung nicht gefunden.' });
  }
  const body = typeof (req.body && req.body.body) === 'string' ? req.body.body : '';
  const kind = (req.body && req.body.kind) === 'ki' ? 'ki' : 'user';
  const rawRefs = (req.body && req.body.refs) !== undefined ? req.body.refs : [];
  const rawAttachments = (req.body && req.body.attachments) !== undefined ? req.body.attachments : [];
  if (!Array.isArray(rawRefs) || rawRefs.length > REFS_MAX) {
    return res.status(400).json({ error: `Höchstens ${REFS_MAX} Verweise je Nachricht.` });
  }
  if (!Array.isArray(rawAttachments)) {
    return res.status(400).json({ error: 'attachments muss eine Liste sein.' });
  }
  if (rawAttachments.length > ATTACHMENTS_MAX) {
    return res.status(413).json({ error: `Höchstens ${ATTACHMENTS_MAX} Anlagen je Nachricht.` });
  }
  /* Vorführbetrieb (30.08.2026): Die Demo-Konten haben öffentlich bekannte Passwörter. Anlagen
     würden als BLOB dauerhaft in der BETRIEBSDATENBANK liegen - ein offener Datei-Ablageplatz
     für jeden, der die Vorführung kennt. Der Chat selbst bleibt bewusst echt, nur Anlagen nicht. */
  if (req.session.isDemo && rawAttachments.length) {
    return res.status(403).json({ error: 'Im Vorführbetrieb lassen sich keine Dateien anhängen - der Text-Chat funktioniert wie gewohnt.' });
  }
  if (!body.trim() && !rawAttachments.length) {
    return res.status(400).json({ error: 'body oder attachments erforderlich.' });
  }
  if (kind === 'ki' && !body.trim()) {
    return res.status(400).json({ error: 'Ein KI-Beitrag braucht einen nichtleeren body.' });
  }
  if (Buffer.byteLength(body, 'utf8') > BODY_MAX_BYTES) {
    return res.status(413).json({ error: 'Der Nachrichtentext ist zu groß (höchstens 16 KB).' });
  }
  const refs = [];
  for (const ref of rawRefs) {
    const type = ref && (ref.type === 'case' || ref.type === 'document') ? ref.type : '';
    if (!type) return res.status(400).json({ error: "Jeder Verweis braucht type 'case' oder 'document'." });
    refs.push({ type, id: String(ref.id || ''), label: String(ref.label || '') });
  }
  const attachments = [];
  for (const anlage of rawAttachments) {
    if (!anlage || typeof anlage !== 'object' || typeof anlage.dataBase64 !== 'string' || !anlage.dataBase64) {
      return res.status(400).json({ error: 'Jede Anlage braucht name, mime und dataBase64.' });
    }
    const name = String(anlage.name || '').trim();
    const mime = String(anlage.mime || 'application/octet-stream');
    if (!name) return res.status(400).json({ error: 'Jede Anlage braucht einen Namen.' });
    if (name.length > NAME_MIME_MAX_CHARS || mime.length > NAME_MIME_MAX_CHARS) {
      return res.status(400).json({ error: `Anlagenname und MIME-Typ sind auf je ${NAME_MIME_MAX_CHARS} Zeichen begrenzt.` });
    }
    // Größenprüfung VOR dem Insert - eine zu große Anlage darf gar nicht erst in der DB landen.
    const data = Buffer.from(anlage.dataBase64, 'base64');
    if (data.length > ATTACHMENT_MAX_BYTES) {
      return res.status(413).json({ error: `Anlage "${name}" ist zu groß (höchstens 5 MB je Anlage).` });
    }
    attachments.push({ id: crypto.randomUUID(), name, mime, data });
  }
  const message = {
    id: crypto.randomUUID(),
    conversationId,
    kind,
    senderUserId: kind === 'ki' ? null : req.session.userId,
    aiRequestedBy: kind === 'ki' ? req.session.userId : null,
    body,
    refsJson: JSON.stringify(refs)
  };
  insertMessageTx(message, attachments);
  const payload = messagePayload(getMessageStmt.get(message.id));
  // Zustellung an ALLE Teilnehmer inklusive Absender (seine anderen Fenster/Geräte!) -
  // nur das auslösende Fenster wird ausgenommen, siehe Echo-Regel in realtime/websocket.js.
  if (realtime) {
    realtime.sendToUsers(
      participantUserIds(conversationId),
      { type: 'chat-message', conversationId, message: payload },
      req.get('X-Window-Id') || null
    );
  }
  res.status(201).json({ message: payload });
});

// Lesestand setzen. Die anderen Teilnehmer bekommen das per chat-read gemeldet
// (Gelesen-Häkchen); der Setzende selbst weiß es schon.
router.post('/conversations/:id/read', (req, res) => {
  const conversationId = req.params.id;
  if (!membershipStmt.get(conversationId, req.session.userId)) {
    return res.status(404).json({ error: 'Unterhaltung nicht gefunden.' });
  }
  setReadStmt.run(conversationId, req.session.userId);
  const lastReadAt = membershipStmt.get(conversationId, req.session.userId).last_read_at;
  if (realtime) {
    const andere = participantUserIds(conversationId).filter((id) => id !== req.session.userId);
    if (andere.length) {
      realtime.sendToUsers(andere, {
        type: 'chat-read', conversationId, userId: req.session.userId, lastReadAt
      });
    }
  }
  res.json({ ok: true, lastReadAt });
});

// Manuellen Präsenzstatus setzen ('offline' = unsichtbar). Danach sehen ALLE verbundenen
// Clients den frischen Stand - Präsenz ist büroweit, nicht unterhaltungsgebunden.
router.post('/status', (req, res) => {
  const status = String((req.body && req.body.status) || '');
  if (!STATUS_VALUES.has(status)) {
    return res.status(400).json({ error: "status muss 'online', 'away', 'busy' oder 'offline' sein." });
  }
  upsertStatusStmt.run(req.session.userId, status);
  if (realtime && typeof realtime.broadcastChatPresence === 'function') realtime.broadcastChatPresence();
  res.json({ ok: true });
});

// Anlagen-Download direkt aus der DB. Dieselbe 404 für "gibt es nicht" und "kein Teilnehmer" -
// wie bei den Nachrichten soll die Existenz fremder Unterhaltungen nicht erratbar sein.
router.get('/attachments/:id', (req, res) => {
  const row = getAttachmentStmt.get(req.params.id);
  if (!row || !membershipStmt.get(row.conversation_id, req.session.userId)) {
    return res.status(404).json({ error: 'Anlage nicht gefunden.' });
  }
  res.setHeader('Content-Type', row.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`);
  res.send(Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data || ''));
});

module.exports = router;
module.exports.setRealtime = setRealtime;
