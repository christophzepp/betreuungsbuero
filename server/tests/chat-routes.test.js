'use strict';

/*
 * Vertragstest für den Nutzer-zu-Nutzer-Chat (Nutzerwunsch 2026-08-12): eigene SQLite-Datei
 * und listen(0), Produktivdaten werden nicht geöffnet. Die Echtzeit-Schicht wird durch eine
 * aufzeichnende Attrappe ersetzt (setRealtime-Muster) - geprüft wird hier der REST-Vertrag
 * samt der Frage, WEN die Routen mit WELCHER Nachricht benachrichtigen wollen.
 */

const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-routes-'));
process.env.DB_PATH = path.join(temp, 'chat.sqlite3');

delete require.cache[require.resolve('../src/database/index')];
const db = require('../src/database/index');
const chatRoutes = require('../src/modules/chat/routes');

// Konten: Anna (gepflegte Initialen + Farbe), ben (nur username), Dora (dritte aktive Nutzerin),
// Chris ist deaktiviert und darf nirgends auftauchen.
db.prepare(`
  INSERT INTO users (id, username, password_hash, display_name, initials, calendar_color, active)
  VALUES (1, 'anna', 'x', 'Anna Admin', 'AA', '#e11d48', 1)
`).run();
db.prepare("INSERT INTO users (id, username, password_hash, display_name, active) VALUES (2, 'ben', 'x', '', 1)").run();
db.prepare("INSERT INTO users (id, username, password_hash, display_name, active) VALUES (3, 'chris', 'x', 'Chris Alt', 0)").run();
db.prepare("INSERT INTO users (id, username, password_hash, display_name, active) VALUES (4, 'dora', 'x', 'Dora Dritt', 1)").run();

// Aufzeichnende Echtzeit-Attrappe: dieselben drei Methoden, die realtime/websocket.js liefert.
const realtimeCalls = { sendToUsers: [], presenceBroadcasts: 0 };
const fakeOnline = new Set();
chatRoutes.setRealtime({
  sendToUsers(userIds, message, exceptWindowId) {
    realtimeCalls.sendToUsers.push({ userIds: [...userIds].sort((a, b) => a - b), message, exceptWindowId });
  },
  broadcastChatPresence() { realtimeCalls.presenceBroadcasts += 1; },
  onlineUserIds() { return fakeOnline; }
});

const app = express();
// 16 MB reichen für die 5-MB-Anlage plus Base64-Aufblähung; der 413-Fall kommt aus der Route.
app.use(express.json({ limit: 16 * 1024 * 1024 }));
// Sitzung pro Anfrage über den Testkopf X-Test-User; ohne Kopf bleibt req.session leer -> 401.
app.use((req, _res, next) => {
  const userId = Number(req.get('X-Test-User') || 0);
  if (userId) req.session = { userId, mode: 'online' };
  next();
});
app.use('/api/chat', chatRoutes);

let base = '';
const server = http.createServer(app);

async function api(userId, method, url, body, extraHeaders) {
  const headers = { ...(extraHeaders || {}) };
  if (userId) headers['X-Test-User'] = String(userId);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${base}${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); fs.rmSync(temp, { recursive: true, force: true }); });

test('ohne Sitzung antworten alle Chat-Routen mit 401', async () => {
  for (const [method, url] of [
    ['GET', '/api/chat/users'],
    ['GET', '/api/chat/conversations'],
    ['POST', '/api/chat/status']
  ]) {
    const res = await fetch(`${base}${url}`, { method });
    assert.equal(res.status, 401, `${method} ${url} muss unangemeldet 401 liefern`);
  }
});

test('Nutzerliste: nur aktive Konten, displayName-Fallback, Initialen und Verbindungsstatus', async () => {
  fakeOnline.clear();
  fakeOnline.add(1);
  const res = await api(1, 'GET', '/api/chat/users');
  assert.equal(res.status, 200);
  const { users } = await res.json();
  assert.deepEqual(users.map((u) => u.id).sort((a, b) => a - b), [1, 2, 4], 'der deaktivierte Chris darf nicht auftauchen');
  const anna = users.find((u) => u.id === 1);
  const ben = users.find((u) => u.id === 2);
  assert.equal(anna.displayName, 'Anna Admin');
  assert.equal(anna.initials, 'AA');
  assert.equal(anna.color, '#e11d48');
  assert.equal(anna.status, 'online', 'Anna hat laut Attrappe eine offene Verbindung');
  assert.equal(ben.displayName, 'ben', 'ohne display_name greift der username');
  assert.equal(ben.initials, 'B', 'Initialen werden aus dem Namen abgeleitet');
  assert.equal(ben.color, null);
  assert.equal(ben.status, 'offline');
});

let directId = '';
test('Direkt-Unterhaltung anlegen und beim zweiten Anlauf deduplizieren', async () => {
  const erste = await api(1, 'POST', '/api/chat/conversations', { participantIds: [2] });
  assert.equal(erste.status, 201);
  const { conversation } = await erste.json();
  directId = conversation.id;
  assert.equal(conversation.type, 'direct');
  assert.equal(conversation.title, '', 'direct trägt keinen Titel');
  assert.deepEqual(conversation.participants.map((p) => p.id), [1, 2]);
  assert.equal(conversation.lastMessage, null);
  assert.equal(conversation.unread, 0);

  // Dedupe auch aus Bens Sicht: dieselben zwei Nutzer ergeben dieselbe Unterhaltung (200, nicht 201).
  const zweite = await api(2, 'POST', '/api/chat/conversations', { participantIds: [1] });
  assert.equal(zweite.status, 200);
  assert.equal((await zweite.json()).conversation.id, directId);

  const leer = await api(1, 'POST', '/api/chat/conversations', { participantIds: [] });
  assert.equal(leer.status, 400);
  const unbekannt = await api(1, 'POST', '/api/chat/conversations', { participantIds: [999] });
  assert.equal(unbekannt.status, 404);
  const inaktiv = await api(1, 'POST', '/api/chat/conversations', { participantIds: [3] });
  assert.equal(inaktiv.status, 404, 'der deaktivierte Chris ist kein gültiger Teilnehmer');
});

let groupId = '';
test('Gruppen-Unterhaltung mit Titel', async () => {
  const res = await api(1, 'POST', '/api/chat/conversations', { participantIds: [2, 4], title: 'Team Büro' });
  assert.equal(res.status, 201);
  const { conversation } = await res.json();
  groupId = conversation.id;
  assert.equal(conversation.type, 'group');
  assert.equal(conversation.title, 'Team Büro');
  assert.deepEqual(conversation.participants.map((p) => p.id), [1, 2, 4]);
});

test('Nachricht senden: 201, sichtbar in GET, updated_at steigt, unread beim Empfänger, WS-Push', async () => {
  // updated_at künstlich in die Vergangenheit setzen - datetime('now') hat Sekundenauflösung,
  // sonst wäre "steigt" im selben Testlauf nicht belastbar messbar.
  db.prepare("UPDATE chat_conversations SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(directId);
  realtimeCalls.sendToUsers.length = 0;

  const res = await api(1, 'POST', `/api/chat/conversations/${directId}/messages`, {
    body: 'Hallo Ben!',
    refs: [{ type: 'case', id: 'case-1', label: 'Muster, Max' }]
  }, { 'X-Window-Id': 'fenster-anna-1' });
  assert.equal(res.status, 201);
  const { message } = await res.json();
  assert.equal(message.kind, 'user');
  assert.equal(message.senderUserId, 1);
  assert.equal(message.senderName, 'Anna Admin');
  assert.equal(message.body, 'Hallo Ben!');
  assert.deepEqual(message.refs, [{ type: 'case', id: 'case-1', label: 'Muster, Max' }]);

  const liste = await api(2, 'GET', `/api/chat/conversations/${directId}/messages`);
  assert.equal(liste.status, 200);
  const { messages } = await liste.json();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, message.id);

  const uebersicht = await api(2, 'GET', '/api/chat/conversations');
  const conv = (await uebersicht.json()).conversations.find((c) => c.id === directId);
  assert.ok(conv.updatedAt > '2020-01-01 00:00:00', 'updated_at der Unterhaltung muss mit der Nachricht steigen');
  assert.equal(conv.unread, 1, 'Ben hat eine ungelesene Nachricht');
  assert.equal(conv.lastMessage.body, 'Hallo Ben!');

  const eigene = await api(1, 'GET', '/api/chat/conversations');
  assert.equal((await eigene.json()).conversations.find((c) => c.id === directId).unread, 0,
    'die eigene Nachricht zählt beim Absender nicht als ungelesen');

  assert.equal(realtimeCalls.sendToUsers.length, 1);
  const push = realtimeCalls.sendToUsers[0];
  assert.deepEqual(push.userIds, [1, 2], 'Zustellung an ALLE Teilnehmer, auch den Absender (andere Fenster)');
  assert.equal(push.message.type, 'chat-message');
  assert.equal(push.message.conversationId, directId);
  assert.equal(push.message.message.id, message.id);
  assert.equal(push.exceptWindowId, 'fenster-anna-1', 'die Fensterkennung des Auslösers wird durchgereicht');
});

test('Nicht-Teilnehmer bekommt bei GET messages dieselbe 404 wie bei einer unbekannten Unterhaltung', async () => {
  const fremd = await api(4, 'GET', `/api/chat/conversations/${directId}/messages`);
  assert.equal(fremd.status, 404);
  const unbekannt = await api(4, 'GET', '/api/chat/conversations/gibt-es-nicht/messages');
  assert.equal(unbekannt.status, 404);
  assert.deepEqual(await fremd.json(), await unbekannt.json(), 'nach außen kein Unterschied (Vertrag)');
});

test('read-POST setzt unread auf 0 und meldet chat-read nur an die anderen Teilnehmer', async () => {
  realtimeCalls.sendToUsers.length = 0;
  const res = await api(2, 'POST', `/api/chat/conversations/${directId}/read`, {});
  assert.equal(res.status, 200);
  const { ok, lastReadAt } = await res.json();
  assert.equal(ok, true);
  assert.ok(lastReadAt, 'lastReadAt muss zurückkommen');

  const uebersicht = await api(2, 'GET', '/api/chat/conversations');
  assert.equal((await uebersicht.json()).conversations.find((c) => c.id === directId).unread, 0);

  assert.equal(realtimeCalls.sendToUsers.length, 1);
  const push = realtimeCalls.sendToUsers[0];
  assert.deepEqual(push.userIds, [1], 'nur die anderen Teilnehmer, nicht der Setzende');
  assert.equal(push.message.type, 'chat-read');
  assert.equal(push.message.conversationId, directId);
  assert.equal(push.message.userId, 2);
  assert.equal(push.message.lastReadAt, lastReadAt);
});

test('Anlagen-Roundtrip: Bytes identisch zurück, Nicht-Teilnehmer 404', async () => {
  const bytes = Buffer.from('PDF-Bytes äöü \x00\x01\x02', 'binary');
  const res = await api(1, 'POST', `/api/chat/conversations/${directId}/messages`, {
    body: '',
    attachments: [{ name: 'Bescheid ä.pdf', mime: 'application/pdf', dataBase64: bytes.toString('base64') }]
  });
  assert.equal(res.status, 201);
  const { message } = await res.json();
  assert.equal(message.attachments.length, 1);
  const anlage = message.attachments[0];
  assert.equal(anlage.name, 'Bescheid ä.pdf');
  assert.equal(anlage.mime, 'application/pdf');
  assert.equal(anlage.size, bytes.length);

  const download = await api(2, 'GET', `/api/chat/attachments/${anlage.id}`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.ok(download.headers.get('content-disposition').includes("filename*=UTF-8''"));
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes, 'die Bytes müssen unverändert zurückkommen');

  const fremd = await api(4, 'GET', `/api/chat/attachments/${anlage.id}`);
  assert.equal(fremd.status, 404, 'Nicht-Teilnehmer dürfen die Anlage nicht laden');
});

test("kind='ki': KI-Assistent als Absender, Anforderer bleibt nachvollziehbar", async () => {
  const res = await api(1, 'POST', `/api/chat/conversations/${groupId}/messages`, {
    body: 'Zusammenfassung des Falls ...',
    kind: 'ki'
  });
  assert.equal(res.status, 201);
  const { message } = await res.json();
  assert.equal(message.kind, 'ki');
  assert.equal(message.senderUserId, null);
  assert.equal(message.senderName, 'KI-Assistent');
  assert.equal(message.aiRequestedBy, 1);
  assert.equal(message.aiRequestedByName, 'Anna Admin');

  const ohneBody = await api(1, 'POST', `/api/chat/conversations/${groupId}/messages`, { body: '', kind: 'ki' });
  assert.equal(ohneBody.status, 400, "kind='ki' nur zusammen mit nichtleerem body");
});

test('Status-POST ändert den Status in der Nutzerliste und stößt den Präsenz-Broadcast an', async () => {
  const vorher = realtimeCalls.presenceBroadcasts;
  const res = await api(2, 'POST', '/api/chat/status', { status: 'busy' });
  assert.equal(res.status, 200);
  assert.equal(realtimeCalls.presenceBroadcasts, vorher + 1);

  const users = (await (await api(1, 'GET', '/api/chat/users')).json()).users;
  assert.equal(users.find((u) => u.id === 2).status, 'busy');

  // Manuelles 'offline' (unsichtbar) gewinnt auch gegen eine offene Verbindung.
  fakeOnline.add(2);
  await api(2, 'POST', '/api/chat/status', { status: 'offline' });
  const unsichtbar = (await (await api(1, 'GET', '/api/chat/users')).json()).users;
  assert.equal(unsichtbar.find((u) => u.id === 2).status, 'offline');

  // Manuelles 'online' ist keine Zusage: es zählt wieder die tatsächliche Verbindung.
  await api(2, 'POST', '/api/chat/status', { status: 'online' });
  fakeOnline.delete(2);
  const wieder = (await (await api(1, 'GET', '/api/chat/users')).json()).users;
  assert.equal(wieder.find((u) => u.id === 2).status, 'offline');

  const ungueltig = await api(2, 'POST', '/api/chat/status', { status: 'verschollen' });
  assert.equal(ungueltig.status, 400);
});

test('Validierung: leere Nachricht 400, zu großer body 413, zu große Anlage 413', async () => {
  const leer = await api(1, 'POST', `/api/chat/conversations/${directId}/messages`, {});
  assert.equal(leer.status, 400);

  const riesigerText = await api(1, 'POST', `/api/chat/conversations/${directId}/messages`, {
    body: 'x'.repeat(16 * 1024 + 1)
  });
  assert.equal(riesigerText.status, 413);

  const zuGross = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
  const anlage = await api(1, 'POST', `/api/chat/conversations/${directId}/messages`, {
    body: '',
    attachments: [{ name: 'riesig.bin', mime: 'application/octet-stream', dataBase64: zuGross.toString('base64') }]
  });
  assert.equal(anlage.status, 413);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_attachments WHERE name = ?').get('riesig.bin').n, 0,
    'die abgewiesene Anlage darf nicht in der DB landen');

  const zuViele = await api(1, 'POST', `/api/chat/conversations/${directId}/messages`, {
    body: 'sechs Anlagen',
    attachments: Array.from({ length: 6 }, (_v, i) => ({ name: `a${i}.txt`, mime: 'text/plain', dataBase64: 'QQ==' }))
  });
  assert.equal(zuViele.status, 413);
});
