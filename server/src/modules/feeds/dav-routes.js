// Aufgaben-Feed als schreibarmer CalDAV-Endpunkt (PLAN-AUFGABEN-SYNC, Etappe 4).
//
// Zweck: Clients mit eingebauter CalDAV-Anbindung (allen voran Super Productivity) abonnieren die
// Buero-Aufgaben unter EINER Token-URL - ohne Nutzerkonto, ohne Sitzung. Der Feed ist bewusst ein
// Teilmenge-CalDAV: OPTIONS/PROPFIND/REPORT/GET vollstaendig genug fuer Sync-Clients, PUT nimmt
// AUSSCHLIESSLICH die Erledigt-Rueckmeldung an ("Aufgabe in SP abgehakt" -> lokal erledigt).
// Alles andere (Titel-/Datums-/Beschreibungsaenderungen, Loeschungen, Fristen) wird abgelehnt
// und im Sync-Journal festgehalten - die App bleibt die fuehrende Quelle.
//
// Auth: /dav-feed/<token>/... - der Token steckt im Pfad (CalDAV-Clients koennen Header-Tokens
// meist nicht). Gespeichert ist nur der SHA-256-Hash (feed_tokens, widerruflich im Admin-Panel).
// Zusaetzlich wird Basic akzeptiert, wenn das Passwort der Token ist (manche Clients ERZWINGEN
// Zugangsdaten-Felder); der Pfad-Token bleibt aber die Wahrheit.

const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const db = require('../../database/index');
const caldav = require('../../integrations/calendar/caldav');
const journal = require('../sync/journal');

const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

const findTokenStmt = db.prepare('SELECT * FROM feed_tokens WHERE token_hash = ? AND revoked = 0');
const touchTokenStmt = db.prepare("UPDATE feed_tokens SET last_used_at = datetime('now') WHERE id = ?");
// Oeffentliche (bueroweite) Aufgaben: offen ODER kuerzlich erledigt (damit der Client den
// Erledigt-Status noch abgleichen kann, bevor der Eintrag aus dem Feed faellt).
const feedTodosStmt = db.prepare(`
  SELECT * FROM todos
   WHERE visibility != 'private'
     AND (done = 0 OR updated_at >= datetime('now', '-14 day'))
   ORDER BY (due_at = ''), due_at
`);
const feedTodoStmt = db.prepare("SELECT * FROM todos WHERE id = ? AND visibility != 'private'");
const markDoneStmt = db.prepare(`
  UPDATE todos SET done = @done, updated_at = datetime('now') WHERE id = @id
`);

const lastTouch = new Map(); // tokenId -> epoch ms (last_used_at hoechstens 1x/Minute schreiben)

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function resolveToken(req, pathToken) {
  let raw = String(pathToken || '');
  if (!raw) {
    const auth = String(req.headers.authorization || '');
    if (auth.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
        raw = decoded.slice(decoded.indexOf(':') + 1);
      } catch (_e) { /* unten 401 */ }
    }
  }
  if (!raw) return null;
  const row = findTokenStmt.get(hashToken(raw));
  if (!row) return null;
  const before = lastTouch.get(row.id) || 0;
  if (Date.now() - before > 60000) { lastTouch.set(row.id, Date.now()); try { touchTokenStmt.run(row.id); } catch (_e) { /* Anzeige-Detail */ } }
  return row;
}

function xmlEscape(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function todoEtag(row) {
  return '"' + crypto.createHash('sha1')
    .update([row.id, row.updated_at, row.done, row.title, row.due_at, row.description].join('|'), 'utf8')
    .digest('hex') + '"';
}

function collectionCtag(rows) {
  return crypto.createHash('sha1')
    .update(rows.map((r) => r.id + r.updated_at + r.done).join('|'), 'utf8')
    .digest('hex');
}

function todoIcs(row) {
  return caldav.buildVtodo({
    uid: row.id,
    title: row.title,
    description: row.description,
    dueAt: row.due_at,
    done: !!row.done,
    priority: row.priority
  });
}

function collectionHref(token) { return `/dav-feed/${token}/`; }
function itemHref(token, id) { return `/dav-feed/${token}/${id}.ics`; }

function multistatus(inner) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${inner}</d:multistatus>`;
}

function collectionResponse(token, rows) {
  return `<d:response><d:href>${collectionHref(token)}</d:href><d:propstat><d:prop>`
    + '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>'
    + '<d:displayname>Betreuungsbüro Aufgaben</d:displayname>'
    + '<c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>'
    + `<cs:getctag>${collectionCtag(rows)}</cs:getctag>`
    + '<d:current-user-principal><d:href>' + collectionHref(token) + '</d:href></d:current-user-principal>'
    + '<c:calendar-home-set><d:href>' + collectionHref(token) + '</d:href></c:calendar-home-set>'
    + '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';
}

function itemResponse(token, row, withData) {
  return `<d:response><d:href>${itemHref(token, row.id)}</d:href><d:propstat><d:prop>`
    + `<d:getetag>${xmlEscape(todoEtag(row))}</d:getetag>`
    + '<d:getcontenttype>text/calendar; charset=utf-8; component=VTODO</d:getcontenttype>'
    + (withData ? `<c:calendar-data>${xmlEscape(todoIcs(row))}</c:calendar-data>` : '')
    + '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= 1024 * 1024) chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

function send(res, status, body, type) {
  res.statusCode = status;
  res.setHeader('DAV', '1, calendar-access');
  if (type) res.setHeader('Content-Type', type);
  res.end(body || '');
}

// Express-Middleware (per app.use gemountet, damit auch PROPFIND/REPORT ankommen).
// Pfade: /<token>/ (Sammlung) und /<token>/<todoId>.ics (Einzeleintrag).
async function handler(req, res) {
  const parts = String(req.path || '/').split('/').filter(Boolean);
  const pathToken = parts[0] || '';
  const tokenRow = resolveToken(req, pathToken);
  if (!tokenRow) {
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Basic realm="Aufgaben-Feed"');
    return res.end('Token fehlt oder ist widerrufen.');
  }
  const itemPart = parts.length > 1 ? decodeURIComponent(parts[parts.length - 1]) : '';
  const todoId = itemPart.endsWith('.ics') ? itemPart.slice(0, -4) : '';
  const method = String(req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.setHeader('Allow', 'OPTIONS, GET, PUT, PROPFIND, REPORT');
    return send(res, 200, '');
  }

  if (method === 'PROPFIND') {
    await readBody(req); // Eigenschaftenliste egal - wir liefern immer den vollen Satz.
    const rows = feedTodosStmt.all();
    const depth = String(req.headers.depth == null ? '1' : req.headers.depth);
    let inner = collectionResponse(pathToken, rows);
    if (!todoId && depth !== '0') inner += rows.map((r) => itemResponse(pathToken, r, false)).join('');
    if (todoId) {
      const row = feedTodoStmt.get(todoId);
      if (!row) return send(res, 404, 'Nicht gefunden.');
      inner = itemResponse(pathToken, row, false);
    }
    return send(res, 207, multistatus(inner), 'application/xml; charset=utf-8');
  }

  if (method === 'REPORT') {
    const body = await readBody(req);
    const rows = feedTodosStmt.all();
    let parsed = null;
    try { parsed = xmlParser.parse(body); } catch (_e) { /* wie calendar-query behandeln */ }
    if (parsed && parsed['calendar-multiget']) {
      const hrefs = [].concat(parsed['calendar-multiget'].href || []).map(String);
      const wanted = new Set(hrefs.map((h) => {
        const file = h.split('/').filter(Boolean).pop() || '';
        return file.endsWith('.ics') ? decodeURIComponent(file.slice(0, -4)) : '';
      }).filter(Boolean));
      const hits = rows.filter((r) => wanted.has(r.id));
      return send(res, 207, multistatus(hits.map((r) => itemResponse(pathToken, r, true)).join('')), 'application/xml; charset=utf-8');
    }
    // calendar-query (und alles Unbekannte): kompletter VTODO-Bestand.
    return send(res, 207, multistatus(rows.map((r) => itemResponse(pathToken, r, true)).join('')), 'application/xml; charset=utf-8');
  }

  if (method === 'GET' || method === 'HEAD') {
    if (!todoId) {
      const rows = feedTodosStmt.all();
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Betreuungsbuero Dokumentenassistent//DE'];
      // Ein GET auf die Sammlung liefert den Feed als eine ICS-Datei (praktisch fuer schlichte Abo-Clients).
      for (const row of rows) {
        const ics = todoIcs(row).split('\r\n');
        lines.push(...ics.slice(ics.indexOf('BEGIN:VTODO'), ics.indexOf('END:VTODO') + 1));
      }
      lines.push('END:VCALENDAR');
      return send(res, 200, method === 'HEAD' ? '' : lines.join('\r\n'), 'text/calendar; charset=utf-8');
    }
    const row = feedTodoStmt.get(todoId);
    if (!row) return send(res, 404, 'Nicht gefunden.');
    res.setHeader('ETag', todoEtag(row));
    return send(res, 200, method === 'HEAD' ? '' : todoIcs(row), 'text/calendar; charset=utf-8');
  }

  if (method === 'PUT') {
    const body = await readBody(req);
    if (!todoId) return send(res, 403, 'Neue Aufgaben bitte in der Anwendung anlegen.');
    const row = feedTodoStmt.get(todoId);
    if (!row) return send(res, 404, 'Nicht gefunden.');
    const comp = caldav.parseIcsComponents(body).find((c) => c.type === 'VTODO');
    if (!comp) return send(res, 400, 'Kein VTODO im Körper.');
    const incoming = caldav.componentToTodo(comp);
    const wantsDone = !!incoming.done;
    if (row.item_type === 'deadline' || row.item_type === 'followup') {
      journal.write({
        direction: 'pull', action: 'verworfen', localType: row.item_type, localId: row.id,
        detail: 'Änderung über den Aufgaben-Feed abgelehnt: Fristen/Wiedervorlagen sind Nur-Export.'
      });
      return send(res, 403, 'Fristen sind über den Feed nicht änderbar.');
    }
    if (wantsDone === !!row.done) {
      // Kein Statuswechsel: Titel-/Datumsaenderungen nimmt der Feed grundsaetzlich nicht an.
      journal.write({
        direction: 'pull', action: 'verworfen', localType: row.item_type || 'task', localId: row.id,
        detail: 'Inhaltliche Änderung über den Aufgaben-Feed abgelehnt (Feed nimmt nur die Erledigt-Rückmeldung an).'
      });
      return send(res, 403, 'Der Feed nimmt nur die Erledigt-Rückmeldung an.');
    }
    markDoneStmt.run({ id: row.id, done: wantsDone ? 1 : 0 });
    journal.write({
      direction: 'pull', action: wantsDone ? 'erledigt' : 'wieder-geöffnet', localType: row.item_type || 'task', localId: row.id,
      detail: `Erledigt-Rückmeldung über den Aufgaben-Feed („${String(row.title || '').slice(0, 80)}").`
    });
    res.setHeader('ETag', todoEtag(feedTodoStmt.get(row.id)));
    return send(res, 204, '');
  }

  if (method === 'DELETE') {
    journal.write({
      direction: 'pull', action: 'verworfen', localType: 'task', localId: todoId,
      detail: 'Löschversuch über den Aufgaben-Feed abgelehnt (Feed ist schreibarm).'
    });
    return send(res, 403, 'Löschen ist über den Feed nicht möglich.');
  }

  return send(res, 405, 'Methode wird vom Aufgaben-Feed nicht unterstützt.');
}

module.exports = handler;
module.exports._internal = { todoEtag, collectionCtag, hashToken };
