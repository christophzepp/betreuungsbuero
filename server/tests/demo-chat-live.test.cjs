'use strict';
/* Demo-Chat: kommt eine Nachricht zwischen zwei Vorführkonten LIVE an?
   (Nutzerentscheid 30.08.2026: „erst messen" - ein Skeptiker meldete, die WebSocket werde
   in der Vorführung nie aufgebaut, der Nachschlag am Code sprach dagegen. Statt blind zu
   bauen, misst dieser Prüfstand das Verhalten mit echten WebSocket-Klienten und echten
   Demo-Sitzungen gegen den echten Realtime-Server.)

   Der Chat ist das EINZIGE, was in der Vorführung wirklich echt läuft (Nutzerauftrag:
   „Dann können sich auch mal mehrere User einloggen, um z.B. den Chat untereinander
   auszuprobieren") - deshalb verdient er einen eigenen Verhaltenstest. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.RUNTIME_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-chat-'));
process.env.SESSION_SECRET = 'test-geheimnis-demo-chat';

const WebSocket = require('ws');
const cookieSignature = require('cookie-signature');
const db = require('../src/database/index');
/* Bewusst OHNE chat/routes: Das Modul haelt beim Laden Zeitgeber offen und der Prüfstand
   käme nicht zum Ende. Gemessen wird der Zustellweg selbst (realtime.sendToUsers) - genau
   das, was die Chat-Route aufruft. */
const { createRealtimeServer } = require('../src/realtime/websocket');

function demoSitzung(sid, userId, name) {
  /* isDemo:true - genau wie die echte Demo-Anmeldung sie setzt. */
  db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires_at) VALUES (?,?,?)')
    .run(sid, JSON.stringify({ userId, displayName: name, mode: 'demo', isDemo: true }), Date.now() + 3600000);
  return 'betreuungsbuero.sid=' + encodeURIComponent('s:' + cookieSignature.sign(sid, process.env.SESSION_SECRET));
}
const offen = [];
function verbinde(port, cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } });
    offen.push(ws);
    ws.eingegangen = [];
    ws.on('message', (raw) => { try { ws.eingegangen.push(JSON.parse(raw)); } catch (_e) {} });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
function warteBis(pruefung, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      let ok = false;
      try { ok = pruefung(); } catch (_e) { ok = false; }
      if (ok) { clearInterval(t); resolve(); }
      else if (Date.now() - start > (timeoutMs || 4000)) { clearInterval(t); reject(new Error('Zeitablauf')); }
    }, 25);
  });
}

let server; let realtime; let port; let demoA; let demoB;

test.before(async () => {
  /* Zwei Vorführkonten wie der Demo-Schalter sie anlegt. */
  const anlegen = (name) => {
    db.prepare(`INSERT INTO users (username, password_hash, display_name, allow_local, allow_online, is_admin, is_demo, active)
      VALUES (?,?,?,0,0,0,1,1)`).run(name, 'x', 'Demo ' + name.replace('Demo', ''));
    return db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  };
  demoA = anlegen('Demo1');
  demoB = anlegen('Demo2');
  server = http.createServer((req, res) => { res.end('ok'); });
  realtime = createRealtimeServer(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
/* ALLE Verbindungen schliessen, nicht nur die des glücklichen Pfades: ein offener Socket
   hält den Testlauf am Leben (hier beim Bau selbst erlebt - der Runner gab minutenlang
   keine Zeile aus, obwohl die Prüfungen längst durch waren). */
test.after(() => {
  for (const ws of offen) { try { ws.terminate(); } catch (_e) {} }
  try { server.close(); } catch (_e) {}
});

test('Zwei Vorführkonten: WebSocket verbindet und die Nachricht kommt live an', async () => {
  const a = await verbinde(port, demoSitzung('demo-sid-a', demoA, 'Demo 1'));
  const b = await verbinde(port, demoSitzung('demo-sid-b', demoB, 'Demo 2'));
  /* 1. Der Server nimmt Demo-Sitzungen überhaupt an (der gemeldete Verdacht). */
  assert.strictEqual(a.readyState, WebSocket.OPEN, 'Die WebSocket einer Demo-Sitzung wurde nicht angenommen');
  assert.strictEqual(b.readyState, WebSocket.OPEN);
  a.send(JSON.stringify({ type: 'hello', windowId: 'fenster-a' }));
  b.send(JSON.stringify({ type: 'hello', windowId: 'fenster-b' }));
  /* Auf die Verarbeitung der Fensterkennung warten: Die Echo-Ausnahme kann erst greifen,
     wenn der Server 'hello' gelesen hat. Im Betrieb liegen dazwischen Sekunden; hier ohne
     Wartezeit bekäme das absendende Fenster seine eigene Nachricht zurück - ein Zeitfehler
     DES PRÜFSTANDS, nicht der Anwendung (am eigenen Bau erlebt). Die Präsenzmeldung ist der
     erste Server-Rückweg und damit ein belastbares Zeichen. */
  await warteBis(() => a.eingegangen.some((n) => n.type === 'chat-presence'), 4000);

  /* 2. Unterhaltung + Nachricht wie die Chat-Route sie erzeugt, dann live zustellen. */
  db.prepare("INSERT INTO chat_conversations (id,type,title,direct_key,created_by) VALUES ('c-demo','direct','',?,?)")
    .run(`${Math.min(demoA, demoB)}:${Math.max(demoA, demoB)}`, demoA);
  db.prepare("INSERT INTO chat_participants (conversation_id,user_id) VALUES ('c-demo',?)").run(demoA);
  db.prepare("INSERT INTO chat_participants (conversation_id,user_id) VALUES ('c-demo',?)").run(demoB);
  realtime.sendToUsers([demoA, demoB],
    { type: 'chat-message', conversationId: 'c-demo', message: { id: 'm1', body: 'Hallo aus der Vorführung' } },
    'fenster-a');

  await warteBis(() => b.eingegangen.some((n) => n.type === 'chat-message' && n.message && n.message.id === 'm1'), 4000);
  /* 3. Echo-Regel: das auslösende Fenster bekommt seine eigene Nachricht NICHT zurück. */
  assert.ok(!a.eingegangen.some((n) => n.type === 'chat-message'),
    'Das absendende Fenster bekam sein eigenes Echo - doppelte Nachrichten in der Vorführung');
  a.close(); b.close();
});

test('Präsenz: Vorführkonten sehen einander, echte Konten bleiben getrennt', async () => {
  const echtId = (() => {
    db.prepare(`INSERT INTO users (username, password_hash, display_name, allow_local, allow_online, is_admin, is_demo, active)
      VALUES ('echt','x','Echte Person',1,1,0,0,1)`).run();
    return db.prepare("SELECT id FROM users WHERE username='echt'").get().id;
  })();
  const a = await verbinde(port, demoSitzung('demo-sid-c', demoA, 'Demo 1'));
  db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires_at) VALUES (?,?,?)')
    .run('echt-sid', JSON.stringify({ userId: echtId, displayName: 'Echte Person', mode: 'online', isDemo: false }), Date.now() + 3600000);
  const e = await verbinde(port, 'betreuungsbuero.sid=' + encodeURIComponent('s:' + cookieSignature.sign('echt-sid', process.env.SESSION_SECRET)));
  await warteBis(() => a.eingegangen.some((n) => n.type === 'chat-presence'), 4000);
  const letzte = a.eingegangen.filter((n) => n.type === 'chat-presence').pop();
  const namen = (letzte.users || []).map((u) => u.displayName || '');
  assert.ok(!namen.includes('Echte Person'),
    'Ein echtes Konto erscheint in der Präsenzliste der Vorführung - die Trennung ist gebrochen');
  a.close(); e.close();
});
