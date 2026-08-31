// OpenProject-Adapter (Plan PLAN-AUFGABEN-SYNC, Etappe 2): Work Packages als Aufgaben.
//
// Auth: APIv3 verlangt Basic mit dem festen Benutzernamen "apikey" und dem persoenlichen
// API-Token als Passwort. Der Token liegt - wie bei CalDAV-Verbindungen - verschluesselt in
// calendar_connections.password_encrypted; die Basis-URL (https://openproject.example.de) in
// calendar_url. Projekte werden wie Aufgabenlisten behandelt (connection_calendars kind='task',
// remote_id = Projekt-ID als Zeichenkette).
//
// Konflikte: OpenProject fuehrt je Work Package eine lockVersion. Jede Aenderung muss die zuletzt
// gesehene lockVersion mitsenden; ist der Eintrag zwischenzeitlich geaendert, antwortet der Server
// mit 409. Das ist die sauberste Konflikterkennung aller angebundenen Systeme - der Fehler wird
// hier in eine deutsche Meldung uebersetzt und vom Aufrufer im Sync-Journal festgehalten.
//
// Status: OpenProject-Workflows sind je Instanz frei konfigurierbar ("Neu"/"In Bearbeitung"/
// "Erledigt" sind nur die Voreinstellung). Deshalb entscheidet eine je Verbindung hinterlegte
// Zuordnung (task_status_open / task_status_done, jeweils der /api/v3/statuses/<id>-Href), welcher
// Status "offen" bzw. "erledigt" bedeutet. Ohne Zuordnung wird sie aus der Statusliste abgeleitet
// (erster nicht-geschlossener bzw. erster geschlossener Status).

const cryptoHelper = require('../../security/crypto');

function baseUrl(conn) {
  return String(conn.calendar_url || '').replace(/\/+$/, '');
}

function authHeader(conn) {
  const token = cryptoHelper.decrypt(conn.password_encrypted);
  return 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64');
}

async function api(conn, method, path, body) {
  const res = await fetch(baseUrl(conn) + path, {
    method,
    headers: {
      Authorization: authHeader(conn),
      'Content-Type': 'application/json',
      Accept: 'application/hal+json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_e) { /* Fehlertexte unten */ }
  if (res.status === 409) {
    const err = new Error('Konflikt (409): Der Eintrag wurde in OpenProject zwischenzeitlich geändert. Der nächste Abgleich holt den dortigen Stand.');
    err.code = 'CONFLICT';
    throw err;
  }
  if (!res.ok) {
    const detail = json && (json.message || json._embedded?.errors?.map((e) => e.message).join(' | '));
    const err = new Error(`OpenProject antwortete mit Status ${res.status}${detail ? `: ${detail}` : '.'}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function testConnection(conn) {
  try {
    const me = await api(conn, 'GET', '/api/v3/users/me');
    return { ok: true, displayName: String(me?.name || '') };
  } catch (error) {
    return { ok: false, error: error.message || 'Verbindung fehlgeschlagen.' };
  }
}

// Projekte = Aufgabenlisten. pageSize grosszuegig - ein Betreuungsbuero hat eher Dutzende als
// Tausende Faelle; wer mehr hat, sieht die ersten 500 und pflegt die Zuordnung von Hand.
async function listTaskLists(conn) {
  const data = await api(conn, 'GET', '/api/v3/projects?pageSize=500');
  return (data?._embedded?.elements || []).map((p) => ({
    remoteId: String(p.id),
    name: String(p.name || `Projekt ${p.id}`),
    color: ''
  }));
}

// ===== Statusliste (mit kleinem Zwischenspeicher, damit ein Sync-Lauf nicht je Aufgabe fragt) ====
const statusCache = new Map(); // conn.id -> {at, list:[{id, href, name, isClosed}]}
async function listStatuses(conn) {
  const hit = statusCache.get(conn.id);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.list;
  const data = await api(conn, 'GET', '/api/v3/statuses');
  const list = (data?._embedded?.elements || []).map((s) => ({
    id: String(s.id),
    href: `/api/v3/statuses/${s.id}`,
    name: String(s.name || ''),
    isClosed: !!s.isClosed
  }));
  statusCache.set(conn.id, { at: Date.now(), list });
  return list;
}

async function statusHrefs(conn) {
  const list = await listStatuses(conn);
  const open = String(conn.task_status_open || '') || (list.find((s) => !s.isClosed)?.href || '');
  const done = String(conn.task_status_done || '') || (list.find((s) => s.isClosed)?.href || '');
  return { open, done, list };
}

function priorityFromTitle(title) {
  const t = String(title || '');
  if (/immediate|sofort|hoch|high|urgent|dringend/i.test(t)) return 'high';
  if (/niedrig|low/i.test(t)) return 'low';
  return 'normal';
}

// Einheitliches Aufgabenformat der Dispatch-Schicht: {uid, href, etag, title, description, dueAt,
// done, priority}. href bleibt leer (OpenProject adressiert ueber IDs), etag = lockVersion.
async function fetchTodos(conn) {
  const projectId = String(conn.task_list_id || '').trim();
  if (!projectId) return [];
  const { list } = await statusHrefs(conn);
  const closedByHref = new Map(list.map((s) => [s.href, s.isClosed]));
  const data = await api(conn, 'GET', `/api/v3/projects/${encodeURIComponent(projectId)}/work_packages?pageSize=500&sortBy=${encodeURIComponent('[["updatedAt","desc"]]')}`);
  return (data?._embedded?.elements || []).map((wp) => {
    const statusHref = wp?._links?.status?.href || '';
    return {
      uid: String(wp.id),
      href: '',
      etag: String(wp.lockVersion != null ? wp.lockVersion : ''),
      title: String(wp.subject || ''),
      description: String(wp.description?.raw || ''),
      dueAt: String(wp.dueDate || ''),
      done: closedByHref.has(statusHref)
        ? !!closedByHref.get(statusHref)
        : /closed|erledigt|geschlossen/i.test(String(wp?._links?.status?.title || '')),
      priority: priorityFromTitle(wp?._links?.priority?.title)
    };
  });
}

// Anlegen: POST auf das Projekt. Der Typ wird bewusst weggelassen (die Instanz nimmt ihren
// Standardtyp); verlangt eine Instanz ihn ausdruecklich (422), wird der erste verfuegbare Typ
// nachgereicht. dueDate '' -> null (OpenProject verwirft leere Strings).
async function createTodo(conn, projectRef, todo) {
  const body = {
    subject: String(todo.title || 'Aufgabe'),
    description: { format: 'markdown', raw: String(todo.description || '') },
    dueDate: todo.dueAt ? String(todo.dueAt).slice(0, 10) : null
  };
  if (todo.done) {
    const { done } = await statusHrefs(conn);
    if (done) body._links = { status: { href: done } };
  }
  const path = `/api/v3/projects/${encodeURIComponent(projectRef)}/work_packages`;
  try {
    const wp = await api(conn, 'POST', path, body);
    return { uid: String(wp.id), href: '' };
  } catch (error) {
    if (error.status !== 422 || !/type/i.test(String(error.message))) throw error;
    const types = await api(conn, 'GET', '/api/v3/types');
    const first = types?._embedded?.elements?.[0];
    if (!first) throw error;
    body._links = { ...(body._links || {}), type: { href: `/api/v3/types/${first.id}` } };
    const wp = await api(conn, 'POST', path, body);
    return { uid: String(wp.id), href: '' };
  }
}

// Aendern: frische lockVersion holen (der lokale Spiegel kann veraltet sein), dann PATCH.
// Ein 409 zwischen GET und PATCH bleibt moeglich und wird als Konflikt gemeldet - genau dafuer
// ist die lockVersion da.
async function updateTodo(conn, todo) {
  const wp = await api(conn, 'GET', `/api/v3/work_packages/${encodeURIComponent(todo.uid)}`);
  const body = {
    lockVersion: wp.lockVersion,
    subject: String(todo.title || wp.subject || 'Aufgabe'),
    description: { format: 'markdown', raw: String(todo.description || '') },
    dueDate: todo.dueAt ? String(todo.dueAt).slice(0, 10) : null
  };
  const { open, done } = await statusHrefs(conn);
  const target = todo.done ? done : open;
  const current = wp?._links?.status?.href || '';
  // Status nur anfassen, wenn sich "offen/erledigt" wirklich aendert - sonst wuerde jeder
  // Textabgleich einen instanzspezifischen Zwischenstatus ("In Bearbeitung") platt machen.
  const closedNow = await (async () => {
    const list = await listStatuses(conn);
    const s = list.find((x) => x.href === current);
    return s ? s.isClosed : false;
  })();
  if (target && !!todo.done !== closedNow) body._links = { status: { href: target } };
  await api(conn, 'PATCH', `/api/v3/work_packages/${encodeURIComponent(todo.uid)}`, body);
  return { uid: String(todo.uid), href: '' };
}

async function pushTodo(conn, todo) {
  const projectRef = String(todo.calendarRef || conn.task_list_id || '').trim();
  if (todo.uid) return updateTodo(conn, todo);
  if (!projectRef) throw new Error('Für diese OpenProject-Verbindung ist kein Projekt ausgewählt.');
  return createTodo(conn, projectRef, todo);
}

async function deleteRemoteTodo(conn, uid) {
  if (!uid) return;
  await api(conn, 'DELETE', `/api/v3/work_packages/${encodeURIComponent(uid)}`);
}

// Projekt je Fall (Nutzerentscheidung 02.08.2026). identifier: OpenProject verlangt ein
// URL-taugliches Kuerzel; Umlaute werden transliteriert, Kollisionen mit -2, -3 ... aufgeloest.
function projectIdentifier(label, attempt) {
  const base = String(label || 'fall')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'fall';
  const withLetter = /^[a-z]/.test(base) ? base : `f-${base}`;
  return attempt > 1 ? `${withLetter}-${attempt}` : withLetter;
}

async function createProject(conn, name) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const p = await api(conn, 'POST', '/api/v3/projects', {
        name: String(name || 'Fall'),
        identifier: projectIdentifier(name, attempt)
      });
      return { remoteId: String(p.id), name: String(p.name || name) };
    } catch (error) {
      const taken = error.status === 422 && /identifier|kennung/i.test(String(error.message));
      if (!taken || attempt === 5) throw error;
    }
  }
  throw new Error('Projekt konnte nicht angelegt werden.');
}

// Anhang an ein Work Package (Etappe 5): Multipart mit metadata- und file-Teil (APIv3-Vertrag).
async function uploadAttachment(conn, uid, { filename, mimeType, bytes }) {
  const form = new FormData();
  form.append('metadata', JSON.stringify({ fileName: String(filename || 'anlage.bin') }));
  form.append('file', new Blob([bytes], { type: mimeType || 'application/octet-stream' }), String(filename || 'anlage.bin'));
  const res = await fetch(`${baseUrl(conn)}/api/v3/work_packages/${encodeURIComponent(uid)}/attachments`, {
    method: 'POST',
    headers: { Authorization: authHeader(conn) },
    body: form
  });
  if (!res.ok) throw new Error(`Anhang konnte nicht zu OpenProject übertragen werden (Status ${res.status}).`);
  return true;
}

// iCal-Abo (Etappe 5, nur lesend): OpenProject bietet je Projekt eine Kalender-Abo-URL mit
// eingebettetem Token. Die Termine laufen ueber den vorhandenen ICS-Parser des CalDAV-Clients.
async function fetchIcalEvents(conn, caldav) {
  const url = String(conn.ical_url || '').trim();
  if (!url) return [];
  const res = await fetch(url, { headers: { Accept: 'text/calendar' } });
  if (!res.ok) throw new Error(`iCal-Abo antwortete mit Status ${res.status}.`);
  const text = await res.text();
  return caldav.parseIcsComponents(text)
    .filter((c) => c.type === 'VEVENT')
    .map((c) => ({ ...caldav.componentToEvent(c), href: '', etag: '' }));
}

module.exports = {
  testConnection, listTaskLists, listStatuses, statusHrefs,
  fetchTodos, pushTodo, deleteRemoteTodo,
  createProject, projectIdentifier, uploadAttachment, fetchIcalEvents,
  _internal: { priorityFromTitle }
};
