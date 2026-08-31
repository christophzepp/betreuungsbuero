'use strict';
/* Erster echter Test des Fall-Echtzeitpfads (Befund 30.08.2026: eine Vorfuehrung mit
   5 Personen im selben Freidokument verlor nach kurzer Zeit den Live-Sync; die gesamte
   src/realtime/websocket.js war bis dahin ungetestet).

   Geprueft wird das VERHALTEN mit echten WebSocket-Klienten gegen einen echten Server:
   1. Raum-Broadcast erreicht alle Betrachter eines Falls.
   2. Ein hart gestorbener Socket (TCP-RST, kein close-Frame) kappt die Zustellung an die
      NACH ihm beigetretenen Raum-Mitglieder nicht (broadcast ist jetzt abgeschirmt).
   3. App-Ping wird mit pong beantwortet (Totmann-Uhr des Browsers).
   4. Der Heartbeat-Sweep raeumt einen Client ab, der keine Pongs liefert (stille
      Verbindungsleichen hinter Tunnel/Proxy) - via REALTIME_HB_MS beschleunigt. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.RUNTIME_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ws-test-'));
process.env.SESSION_SECRET = 'test-geheimnis-fuer-den-pruefstand';
process.env.REALTIME_HB_MS = '250';

const WebSocket = require('ws');
const cookieSignature = require('cookie-signature');
const db = require('../src/database/index');
const { createRealtimeServer } = require('../src/realtime/websocket');

function sessionCookie(sid, userId, name) {
  db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires_at) VALUES (?,?,?)')
    .run(sid, JSON.stringify({ userId, displayName: name }), Date.now() + 3600000);
  const signiert = 's:' + cookieSignature.sign(sid, process.env.SESSION_SECRET);
  return 'betreuungsbuero.sid=' + encodeURIComponent(signiert);
}

function verbinde(port, cookie, optionen) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, Object.assign({ headers: { cookie } }, optionen || {}));
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
      else if (Date.now() - start > (timeoutMs || 3000)) { clearInterval(t); reject(new Error('Zeitablauf: ' + pruefung.toString().slice(0, 120))); }
    }, 25);
  });
}

let server; let realtime; let port;

test.before(async () => {
  server = http.createServer((req, res) => { res.end('ok'); });
  realtime = createRealtimeServer(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(() => { try { server.close(); } catch (_e) {} });

test('Raum-Broadcast erreicht alle Betrachter, App-Ping wird beantwortet', async () => {
  const a = await verbinde(port, sessionCookie('sid-a', 1, 'A'));
  const b = await verbinde(port, sessionCookie('sid-b', 2, 'B'));
  a.send(JSON.stringify({ type: 'join', caseId: 'fall-1', windowId: 'wa' }));
  b.send(JSON.stringify({ type: 'join', caseId: 'fall-1', windowId: 'wb' }));
  await warteBis(() => b.eingegangen.some((m) => m.type === 'presence' && m.users.length === 2));

  realtime.broadcastToCase('fall-1', { type: 'patch', scope: 'report', reportId: 'free_document', patches: [] }, 'wa');
  await warteBis(() => b.eingegangen.some((m) => m.type === 'patch' && m.reportId === 'free_document'));
  assert.ok(!a.eingegangen.some((m) => m.type === 'patch'), 'Das ausloesende Fenster bekam sein eigenes Echo');

  a.send(JSON.stringify({ type: 'ping' }));
  await warteBis(() => a.eingegangen.some((m) => m.type === 'pong'));
  a.close(); b.close();
});

test('Ein hart gestorbener Socket kappt die Zustellung an spaeter Beigetretene nicht', async () => {
  const a = await verbinde(port, sessionCookie('sid-a2', 1, 'A'));
  const b = await verbinde(port, sessionCookie('sid-b2', 2, 'B'));
  const c = await verbinde(port, sessionCookie('sid-c2', 3, 'C'));
  for (const [ws, w] of [[a, 'w1'], [b, 'w2'], [c, 'w3']]) {
    ws.send(JSON.stringify({ type: 'join', caseId: 'fall-2', windowId: w }));
  }
  await warteBis(() => c.eingegangen.some((m) => m.type === 'presence' && m.users.length === 3));

  /* B stirbt HART (TCP-RST, kein close-Frame) - wie ein eingeschlafenes Notebook oder ein
     abgeraeumter Tunnel. C ist NACH B beigetreten und muss trotzdem weiter beliefert werden. */
  b._socket.destroy();
  realtime.broadcastToCase('fall-2', { type: 'patch', scope: 'report', reportId: 'free_document', patches: [{ path: 'fields.free_text', value: { value: 'neu' } }] }, 'w1');
  await warteBis(() => c.eingegangen.some((m) => m.type === 'patch' && m.reportId === 'free_document'));
  a.close(); c.close();
});

test('Heartbeat raeumt stumme Verbindungen ab (kein Pong -> terminate)', async () => {
  /* autoPong:false simuliert die Verbindungsleiche: der Client beantwortet Protokoll-Pings
     nicht mehr. Nach zwei Heartbeat-Takten (hier 250 ms) muss der Server terminieren -
     ohne diesen Sweep sendete er ewig weiter in einen toten Socket. */
  const d = await verbinde(port, sessionCookie('sid-d', 4, 'D'), { autoPong: false });
  let zu = false;
  d.on('close', () => { zu = true; });
  await warteBis(() => zu, 3000);
  assert.ok(zu, 'Der stumme Client wurde nie abgeraeumt');
});

test('Ohne gueltige Sitzung kein Upgrade', async () => {
  await assert.rejects(
    verbinde(port, 'betreuungsbuero.sid=' + encodeURIComponent('s:falsch.signiert')),
    /Unexpected server response: 401|socket hang up/,
    'Ein unsigniertes Cookie bekam eine Echtzeit-Verbindung'
  );
});

test('Client-Gegenstuecke: Totmann-Uhr, Reconnect-Kette, sofortiges Feld-Nachziehen, Berichts-Nachladen', () => {
  /* String-Pins auf die HTML - die Logik selbst laeuft nur im Browser, aber ihre
     Bausteine duerfen bei kuenftigen Umbauten nicht wortlos verschwinden. */
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
  assert.ok(html.includes('let repWsGap=false,repReloadBusy=false,wsLetzterEmpfang=0;'),
    'Die Verbindungs-Gesundheits-Zustaende fehlen');
  assert.ok(html.includes("Date.now()-wsLetzterEmpfang>70000"),
    'Die Totmann-Uhr fehlt - stille Verbindungsleichen wuerden nie ersetzt');
  assert.ok(html.includes("if(msg&&msg.type==='pong')return;"),
    'Die pong-Antwort des Servers wird nicht gefiltert');
  assert.ok(html.includes('clearTimeout(wsReconnectTimer);wsReconnectTimer=setTimeout(connect,10000);return;'),
    'Die Reconnect-Kette endet wieder endgueltig, wenn der Wecker ohne Online-Modus feuert');
  assert.ok(html.includes("try{repWsGap=true}catch(_e){}"),
    'Ein Verbindungsabriss merkt sich die Berichts-Luecke nicht');
  assert.ok(html.includes('function feldDomNachziehen(reportId,patches){'),
    'Fremde Feldwerte werden nicht mehr sofort sichtbar gemacht');
  assert.ok(html.includes('try{feldDomNachziehen(remoteRid,msg.patches)}catch(_e){}'),
    'Der Patch-Zweig zieht die Felder nicht mehr nach');
  assert.ok(html.includes('if(ae&&(el===ae||el.contains(ae)))continue;'),
    'Das gerade bearbeitete Feld wird nicht mehr vor Fremd-Updates geschuetzt (Cursor-Verlust)');
  assert.ok(html.includes('async function repReloadNachLuecke(){'),
    'Das Berichts-Nachladen nach einem Abriss fehlt');
  assert.ok(html.includes('try{if(currentCaseId&&repWsGap)repReloadNachLuecke()}catch(_e){}'),
    'Der Wiederaufbau stoesst das Berichts-Nachladen nicht an');
  assert.ok(html.includes('if(repWsGap&&!repReloadBusy){'),
    'flushReportSync fuehrt nach einem Abriss nicht zuerst zusammen');
  /* Sicherheitsanker der Zusammenfuehrung: ohne Abgleich-Basis wird NICHTS uebernommen. */
  assert.ok(html.includes('const basis=lastSyncedReportFields[rid];\n        if(!basis)continue;'),
    'Die Zusammenfuehrung laeuft auch ohne Abgleich-Basis - Gefahr, fremde Arbeit zu ueberschreiben');
});
