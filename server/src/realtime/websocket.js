// Echtzeit-Sync fuer den Online-Modus (Phase 2.1.1): eine WebSocket-Verbindung pro Browser-Tab,
// "Raeume" entsprechen Fall-IDs. Auth ueber das bestehende Session-Cookie (kein eigenes
// Auth-System) - die Verbindung wird beim Upgrade gegen die vorhandene `sessions`-Tabelle
// geprueft, exakt wie ein normaler HTTP-Request es ueber express-session tun wuerde.
//
// Bewusst natives Browser-WebSocket + das schlanke `ws`-Paket statt Socket.IO, damit kein
// zusaetzliches Client-Bundle in die Single-File-HTML-App eingebettet werden muss (siehe Plan
// "Phase 2.1.1", Abschnitt "WebSocket-Design").

const cookie = require('cookie');
const cookieSignature = require('cookie-signature');
const { WebSocketServer } = require('ws');
const db = require('../database/index');

const COOKIE_NAME = 'betreuungsbuero.sid';
const getSessionStmt = db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?');
// Nutzer-zu-Nutzer-Chat (Nutzerwunsch 2026-08-12): die Präsenzliste zeigt ALLE aktiven Konten des
// Büros, nicht nur die verbundenen - wer offline ist, soll sichtbar offline sein. Der manuell in
// chat_user_status gewählte Status (abwesend/beschäftigt/unsichtbar) überstimmt die Verbindung;
// nur wer nichts gewählt hat (oder ausdrücklich 'online'), wird nach offenen Sockets beurteilt.
/* Demo-Modus (30.08.2026): is_demo trennt die Praesenzwelten - Vorfuehrkonten sehen nur
   Vorfuehrkonten, echte Konten nur echte (siehe modules/chat/routes.js). */
const chatUsersStmt = db.prepare(`
  SELECT u.id, COALESCE(NULLIF(u.display_name, ''), u.username) AS displayName, u.is_demo AS isDemo, s.status AS manualStatus
    FROM users u
    LEFT JOIN chat_user_status s ON s.user_id = u.id
   WHERE u.active = 1 AND u.is_demo = ?
   ORDER BY displayName COLLATE NOCASE
`);

function sessionFromRequest(req) {
  const secret = process.env.SESSION_SECRET;
  const header = req.headers.cookie;
  if (!secret || !header) return null;
  const cookies = cookie.parse(header);
  const raw = cookies[COOKIE_NAME];
  if (!raw || !raw.startsWith('s:')) return null;
  const sid = cookieSignature.unsign(raw.slice(2), secret);
  if (!sid) return null;
  const row = getSessionStmt.get(sid);
  if (!row || row.expires_at < Date.now()) return null;
  try {
    const data = JSON.parse(row.data);
    if (!data.userId) return null;
    return data;
  } catch (_e) {
    return null;
  }
}

function createRealtimeServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  // Büroweite Echtzeit-Ereignisse (Nutzerwunsch 2026-07-19): Kalender/Aufgaben/Büro-Adressbuch/
  // Finanzen & Co. haben keinen Fall-Raum - ihre Änderungen gehen an ALLE verbundenen Fenster.
  require('../modules/office/events').setNotifier((area, payload) => {
    const msg = JSON.stringify({ type: 'office-event', area, payload: payload || {} });
    for (const client of wss.clients) {
      if (client.readyState === 1) { try { client.send(msg); } catch (_e) {} }
    }
  });
  // caseId -> Set<ws>
  const rooms = new Map();
  // caseId -> ws: Inhaber der Bearbeitungssperre (Nutzerwunsch: Sperre gegen Doppelbearbeitung
  // desselben Falls). Der erste Beitritt haelt die Sperre; sie wandert bei leave/close automatisch
  // an das naechste Raum-Mitglied und laesst sich per 'claim-edit' erzwingen (Uebernahme).
  const editors = new Map();

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/ws')) return; // andere Upgrades (falls je welche) ignorieren
    const session = sessionFromRequest(req);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = session.userId;
      ws.isDemo = !!session.isDemo;
      ws.displayName = session.displayName || 'Unbekannt';
      ws.caseId = null;
      wss.emit('connection', ws, req);
    });
  });

  function roomOf(caseId) {
    if (!rooms.has(caseId)) rooms.set(caseId, new Set());
    return rooms.get(caseId);
  }

  function presenceList(caseId) {
    const seen = new Map();
    for (const client of roomOf(caseId)) seen.set(client.userId, client.displayName);
    return [...seen.entries()].map(([id, displayName]) => ({ id, displayName }));
  }

  function broadcastPresence(caseId) {
    broadcast(caseId, { type: 'presence', caseId, users: presenceList(caseId) }, null);
  }
  function editorHolder(caseId) {
    const e = editors.get(caseId);
    return (e && e.readyState === e.OPEN) ? { id: e.userId, displayName: e.displayName, windowId: e.windowId || null } : null;
  }
  function broadcastEditLock(caseId) {
    broadcast(caseId, { type: 'editlock', caseId, holder: editorHolder(caseId) }, null);
  }
  // Sperre an das erste (aelteste) Raum-Mitglied vergeben, falls sie frei oder verwaist ist.
  function grantEditIfFree(caseId) {
    const cur = editors.get(caseId);
    const room = rooms.get(caseId);
    if (cur && cur.readyState === cur.OPEN && room && room.has(cur)) return;
    const next = room && room.size ? room.values().next().value : null;
    if (next) editors.set(caseId, next); else editors.delete(caseId);
  }

  function broadcast(caseId, message, exceptWs) {
    const text = JSON.stringify(message);
    for (const client of roomOf(caseId)) {
      if (client === exceptWs) continue;
      /* try/catch wie in allen anderen Sendeschleifen dieser Datei: wirft send() auf einem
         sterbenden Socket, braechen sonst ALLE nach ihm beigetretenen Raum-Mitglieder aus
         dieser Zustellung - genau das Bild "bei mehreren Nutzern setzt der Sync aus"
         (Befund 30.08.2026, Vorfuehrung mit 5 Personen im selben Freidokument). */
      if (client.readyState === client.OPEN) { try { client.send(text); } catch (_e) { /* Verbindung stirbt gerade */ } }
    }
  }

  // ===== Nutzer-zu-Nutzer-Chat (Nutzerwunsch 2026-08-12) =====
  // Chat-Nachrichten haben keinen Fall-Raum: Empfänger ist der NUTZER (alle seine Fenster/Geräte),
  // egal welchen Fall er gerade betrachtet. Deshalb eigene, userId-basierte Zustellung neben den
  // bestehenden Fall-Räumen.
  function onlineUserIds() {
    const online = new Set();
    for (const client of wss.clients) {
      if (client.readyState === 1 && client.userId != null) online.add(client.userId);
    }
    return online;
  }

  function chatPresenceList(fuerDemo) {
    const online = onlineUserIds();
    return chatUsersStmt.all(fuerDemo ? 1 : 0).map((row) => ({
      id: row.id,
      displayName: row.displayName,
      // Manuell gewählter Status gewinnt (auch 'offline' = unsichtbar trotz Verbindung);
      // manuelles 'online' ist keine Zusage, sondern "nach Verbindung beurteilen".
      status: (row.manualStatus && row.manualStatus !== 'online')
        ? row.manualStatus
        : (online.has(row.id) ? 'online' : 'offline')
    }));
  }

  // Vollständige Liste an ALLE verbundenen Clients - bei connect, close und Status-Änderung.
  // Bewusst keine Deltas: die Liste ist klein (Bürokonten), und ein vollständiger Stand kann
  // nie mit einem verpassten Zwischenschritt inkonsistent werden.
  function broadcastChatPresence() {
    /* Zwei getrennte Staende - jede Verbindung bekommt nur ihre Welt. */
    const echt = JSON.stringify({ type: 'chat-presence', users: chatPresenceList(false) });
    const demo = JSON.stringify({ type: 'chat-presence', users: chatPresenceList(true) });
    for (const client of wss.clients) {
      if (client.readyState === 1) { try { client.send(client.isDemo ? demo : echt); } catch (_e) { /* Verbindung ist gerade gestorben */ } }
    }
  }

  // An alle Sockets der genannten Nutzer senden - AUSSER an die Verbindung mit der Fensterkennung
  // des Auslösers (X-Window-Id des REST-Requests), nach demselben Echo-Muster wie broadcastToCase:
  // weitere Tabs/Geräte desselben Absenders bleiben synchron, nur das auslösende Fenster wird
  // nicht doppelt bedient (der Client dedupliziert zusätzlich nach message.id).
  function sendToUsers(userIds, message, exceptWindowId) {
    const empfaenger = new Set((Array.isArray(userIds) ? userIds : []).map(Number));
    const text = JSON.stringify(message);
    for (const client of wss.clients) {
      if (!empfaenger.has(Number(client.userId))) continue;
      if (exceptWindowId && client.windowId && client.windowId === exceptWindowId) continue;
      if (client.readyState === 1) { try { client.send(text); } catch (_e) { /* Verbindung ist gerade gestorben */ } }
    }
  }

  function leaveCurrentRoom(ws) {
    if (!ws.caseId) return;
    const leftCaseId = ws.caseId;
    const room = rooms.get(leftCaseId);
    if (room) {
      room.delete(ws);
      if (room.size === 0) rooms.delete(leftCaseId);
    }
    ws.caseId = null;
    let lockChanged = false;
    if (editors.get(leftCaseId) === ws) { editors.delete(leftCaseId); grantEditIfFree(leftCaseId); lockChanged = true; }
    broadcastPresence(leftCaseId);
    if (lockChanged) broadcastEditLock(leftCaseId);
  }

  /* Herzschlag (Befund 30.08.2026): Der Fall-WebSocket war der EINZIGE Kanal ohne Keepalive -
     das Postfach-SSE hat laengst einen 30-s-Takt (mailbox-watch.js). Hinter dem Cloudflare
     Tunnel (deploy/stack) wird eine leerlaufende Verbindung nach ~100 s stumm abgeraeumt:
     beide Seiten behalten readyState OPEN, close feuert nie, der Client verbindet nie neu.
     Der Ping-Verkehr haelt den Tunnel offen; bleibt das Browser-Pong zweimal aus, raeumt
     terminate() den toten Socket ab (close feuert, Raum/Praesenz werden sauber). Intervall
     fuer Tests ueber REALTIME_HB_MS drehbar. */
  const hbMs = Math.max(250, Number(process.env.REALTIME_HB_MS || 30000));
  const hbTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) { try { client.terminate(); } catch (_e) {} continue; }
      client.isAlive = false;
      try { client.ping(); } catch (_e) {}
    }
  }, hbMs);
  if (hbTimer.unref) hbTimer.unref();
  wss.on('close', () => clearInterval(hbTimer));

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // Chat-Präsenz (Nutzerwunsch 2026-08-12): jede neue Verbindung kann einen Nutzer von
    // offline auf online heben - alle Clients bekommen den frischen Stand.
    broadcastChatPresence();
    ws.on('message', (raw) => {
      ws.isAlive = true;
      let msg;
      try { msg = JSON.parse(raw); } catch (_e) { return; }
      if (msg.type === 'ping') {
        /* App-Ping des Clients (Totmann-Uhr im Browser): sofort beantworten. Das Browser-
           WebSocket kann Protokoll-Pings nicht selbst ausloesen - dieser Weg gibt dem
           Client ein verlaessliches Lebenszeichen des Servers. */
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch (_e) {}
        return;
      }
      if (msg.type === 'hello' && msg.windowId) {
        // Fensterkennung direkt nach dem Verbindungsaufbau (Nutzerwunsch 2026-08-12): bisher wurde
        // windowId erst beim Fall-join gesetzt - der Chat braucht sie aber schon vorher, damit die
        // Echo-Ausnahme (sendToUsers/exceptWindowId) auch ohne geöffneten Fall greift.
        ws.windowId = String(msg.windowId);
      } else if (msg.type === 'join' && msg.caseId) {
        leaveCurrentRoom(ws);
        ws.caseId = msg.caseId;
        // Ein join ohne eigene windowId darf die per hello gesetzte Kennung nicht löschen.
        ws.windowId = msg.windowId || ws.windowId || null;
        roomOf(msg.caseId).add(ws);
        grantEditIfFree(msg.caseId);
        broadcastPresence(msg.caseId);
        broadcastEditLock(msg.caseId);
      } else if (msg.type === 'leave') {
        leaveCurrentRoom(ws);
      } else if (msg.type === 'claim-edit' && ws.caseId) {
        // Uebernahme erzwingen (Nutzer klickt "Bearbeitung uebernehmen").
        editors.set(ws.caseId, ws);
        broadcastEditLock(ws.caseId);
      } else if (msg.type === 'release-edit' && ws.caseId) {
        if (editors.get(ws.caseId) === ws) { editors.delete(ws.caseId); grantEditIfFree(ws.caseId); broadcastEditLock(ws.caseId); }
      }
    });
    // Bei close zusätzlich die Chat-Präsenz aktualisieren (der letzte Socket eines Nutzers
    // nimmt ihn offline). error löst kein eigenes Präsenz-Update aus - close folgt ohnehin.
    ws.on('close', () => { leaveCurrentRoom(ws); broadcastChatPresence(); });
    ws.on('error', () => leaveCurrentRoom(ws));
  });

  return {
    // Von den REST-Routen (routes/cases.js) aufgerufen, nachdem eine Aenderung persistiert wurde.
    // Geht an alle Betrachter des Falls - MIT AUSNAHME des Fensters, das die Aenderung ausgeloest
    // hat (v175). Weitere Tabs derselben Person bekommen sie weiterhin, damit sie synchron bleiben;
    // ausgeschlossen wird ausschliesslich die eine Verbindung mit derselben Fensterkennung.
    // Warum: Bei Feldaenderungen war das Echo folgenlos (idempotent), beim ANLEGEN nicht - der
    // Ausloeser legte den Eintrag ein zweites Mal an ("doppelt, nach Neuladen weg"). Der Client
    // hat das bisher mit einer eigenen Echo-Erkennung abgefangen; jeder NEUE Echtzeit-Weg musste
    // daran denken. Ab hier ist es an der Quelle geloest.
    // exceptWindowId fehlt (aeltere Fassung, MCP, fremdes Werkzeug) -> Verhalten wie vorher.
    broadcastToCase(caseId, message, exceptWindowId) {
      let ausser = null;
      if (exceptWindowId) {
        for (const client of roomOf(caseId)) {
          if (client.windowId && client.windowId === exceptWindowId) { ausser = client; break; }
        }
      }
      broadcast(caseId, message, ausser);
    },
    // Nutzer-zu-Nutzer-Chat (Nutzerwunsch 2026-08-12): von modules/chat/routes.js nach
    // persistierten Schreiboperationen aufgerufen - siehe die Funktionskommentare oben.
    sendToUsers,
    broadcastChatPresence,
    onlineUserIds
  };
}

module.exports = { createRealtimeServer };
