// Vikunja-REST-Adapter (Plan PLAN-AUFGABEN-SYNC, Etappe 3): der "native" Weg neben der
// CalDAV-Schiene (provider 'vikunja'). Auth: Bearer mit einem API-Token (Vikunja: Einstellungen
// -> API-Tokens). Basis-URL in calendar_url, Projekte als Aufgabenlisten (connection_calendars
// kind='task', remote_id = Projekt-ID).
//
// Eigenheiten der API, die hier zentral versteckt werden:
// - Anlegen ist PUT (/api/v1/projects/<id>/tasks bzw. /api/v1/projects), Aendern ist POST
//   (/api/v1/tasks/<id>) - genau andersherum als ueblich.
// - Ein nicht gesetztes Faelligkeitsdatum kommt als '0001-01-01T00:00:00Z' zurueck.
// - Listen sind seitenweise (x-pagination-total-pages); hier wird bis zum Ende geblaettert,
//   mit hartem Deckel als Endlosschleifen-Schutz.
// - Prioritaeten sind 0-5 (0 unbestimmt, 1 niedrig, 3 hoch, 5 "JETZT") gegen unsere drei Stufen.

const cryptoHelper = require('../../security/crypto');

function baseUrl(conn) {
  return String(conn.calendar_url || '').replace(/\/+$/, '');
}

function headers(conn) {
  return {
    Authorization: 'Bearer ' + cryptoHelper.decrypt(conn.password_encrypted),
    'Content-Type': 'application/json'
  };
}

async function api(conn, method, path, body) {
  const res = await fetch(baseUrl(conn) + path, {
    method,
    headers: headers(conn),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_e) { /* unten behandelt */ }
  if (!res.ok) {
    const err = new Error(`Vikunja antwortete mit Status ${res.status}${json?.message ? `: ${json.message}` : '.'}`);
    err.status = res.status;
    throw err;
  }
  return { json, totalPages: Number(res.headers.get('x-pagination-total-pages')) || 1 };
}

async function pagedList(conn, pathWithoutPage) {
  const sep = pathWithoutPage.includes('?') ? '&' : '?';
  const out = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= 40; page += 1) {
    const { json, totalPages: tp } = await api(conn, 'GET', `${pathWithoutPage}${sep}page=${page}`);
    totalPages = tp;
    if (Array.isArray(json)) out.push(...json);
  }
  return out;
}

async function testConnection(conn) {
  try {
    const { json } = await api(conn, 'GET', '/api/v1/user');
    return { ok: true, displayName: String(json?.name || json?.username || '') };
  } catch (error) {
    return { ok: false, error: error.message || 'Verbindung fehlgeschlagen.' };
  }
}

async function listTaskLists(conn) {
  const projects = await pagedList(conn, '/api/v1/projects');
  return projects
    .filter((p) => !p.is_archived)
    .map((p) => ({ remoteId: String(p.id), name: String(p.title || `Projekt ${p.id}`), color: p.hex_color ? `#${String(p.hex_color).replace(/^#/, '')}` : '' }));
}

const UNSET_DATE = /^0001-01-01/;

function isoFromVikunja(value) {
  const v = String(value || '');
  if (!v || UNSET_DATE.test(v)) return '';
  return v.slice(0, 10);
}

function priorityFromVikunja(p) {
  const n = Number(p) || 0;
  if (n >= 3) return 'high';
  if (n === 1) return 'low';
  return 'normal';
}
function priorityToVikunja(p) {
  if (p === 'high') return 3;
  if (p === 'low') return 1;
  return 0;
}

function toUnified(task) {
  return {
    uid: String(task.id),
    href: '',
    etag: String(task.updated || ''),
    title: String(task.title || ''),
    description: String(task.description || ''),
    dueAt: isoFromVikunja(task.due_date),
    done: !!task.done,
    priority: priorityFromVikunja(task.priority)
  };
}

async function fetchTodos(conn) {
  const projectId = String(conn.task_list_id || '').trim();
  if (!projectId) return [];
  const tasks = await pagedList(conn, `/api/v1/projects/${encodeURIComponent(projectId)}/tasks`);
  return tasks.map(toUnified);
}

function taskBody(todo) {
  return {
    title: String(todo.title || 'Aufgabe'),
    description: String(todo.description || ''),
    // Vikunja erwartet RFC-3339 oder null; ein Datum ohne Zeit wird auf den Tagesanfang gelegt.
    due_date: todo.dueAt ? `${String(todo.dueAt).slice(0, 10)}T00:00:00Z` : null,
    done: !!todo.done,
    priority: priorityToVikunja(todo.priority)
  };
}

async function pushTodo(conn, todo) {
  if (todo.uid) {
    await api(conn, 'POST', `/api/v1/tasks/${encodeURIComponent(todo.uid)}`, taskBody(todo));
    return { uid: String(todo.uid), href: '' };
  }
  const projectRef = String(todo.calendarRef || conn.task_list_id || '').trim();
  if (!projectRef) throw new Error('Für diese Vikunja-Verbindung ist kein Projekt ausgewählt.');
  const { json } = await api(conn, 'PUT', `/api/v1/projects/${encodeURIComponent(projectRef)}/tasks`, taskBody(todo));
  return { uid: String(json?.id || ''), href: '' };
}

async function deleteRemoteTodo(conn, uid) {
  if (!uid) return;
  await api(conn, 'DELETE', `/api/v1/tasks/${encodeURIComponent(uid)}`);
}

// Projekt je Fall (Nutzerentscheidung 02.08.2026).
async function createProject(conn, name) {
  const { json } = await api(conn, 'PUT', '/api/v1/projects', { title: String(name || 'Fall') });
  return { remoteId: String(json?.id || ''), name: String(json?.title || name) };
}

// Anhang an eine Aufgabe (Etappe 5). Vikunja erwartet Multipart mit dem Feldnamen "files".
async function uploadAttachment(conn, uid, { filename, mimeType, bytes }) {
  const form = new FormData();
  form.append('files', new Blob([bytes], { type: mimeType || 'application/octet-stream' }), String(filename || 'anlage.bin'));
  const res = await fetch(`${baseUrl(conn)}/api/v1/tasks/${encodeURIComponent(uid)}/attachments`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + cryptoHelper.decrypt(conn.password_encrypted) },
    body: form
  });
  if (!res.ok) throw new Error(`Anhang konnte nicht zu Vikunja übertragen werden (Status ${res.status}).`);
  return true;
}

module.exports = {
  testConnection, listTaskLists, fetchTodos, pushTodo, deleteRemoteTodo,
  createProject, uploadAttachment,
  _internal: { isoFromVikunja, priorityFromVikunja, priorityToVikunja, toUnified }
};
