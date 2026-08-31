// Gemeinsame Dispatch-Schicht fuer mehrere gleichzeitig aktive Kalenderverbindungen (Plan Abschnitt
// AE) - wird sowohl von routes/calendar.js als auch routes/todos.js genutzt, damit die Provider-
// Verzweigung (CalDAV vs. OAuth) nicht doppelt gepflegt werden muss. CalDAV-Anbieter (nextcloud/
// icloud) identifizieren entfernte Objekte ueber eine volle URL (external_href), OAuth-Anbieter
// (google/microsoft) ueber eine reine ID (external_uid, kein href-Konzept) - diese Asymmetrie wird
// hier einmal zentral versteckt.

const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const caldav = require('../../integrations/calendar/caldav');
const googleCal = require('../../integrations/calendar/google-calendar');
const microsoftCal = require('../../integrations/calendar/microsoft-calendar');
const openproject = require('../../integrations/tasks/openproject');
const vikunjaApi = require('../../integrations/tasks/vikunja');

const oauthAdapters = { google: googleCal, microsoft: microsoftCal };
// Reine Aufgaben-Anbieter (PLAN-AUFGABEN-SYNC, Etappen 2/3): kennen keine Termine und keine
// hrefs, adressieren ausschliesslich ueber IDs. Referenz einer "Aufgabenliste" = Projekt-ID.
const taskApiAdapters = { openproject, 'vikunja-api': vikunjaApi };
// 'vikunja' (Etappe 1) ist absichtlich ein CalDAV-Provider: Vikunja spricht Standard-CalDAV mit
// VTODO, der vorhandene Client passt unveraendert. 'vikunja-api' ist der reichere REST-Weg.
function isCaldavProvider(p) { return p === 'nextcloud' || p === 'icloud' || p === 'vikunja'; }
function isOauthProvider(p) { return p === 'google' || p === 'microsoft'; }
function isTaskApiProvider(p) { return Object.prototype.hasOwnProperty.call(taskApiAdapters, p); }
function taskApiAdapter(p) { return taskApiAdapters[p] || null; }

function listEnabledConnections() {
  return db.prepare('SELECT * FROM calendar_connections WHERE enabled = 1').all();
}

// Aktivierte (angehakte) Kalender/Aufgabenlisten einer Verbindung. kind: 'event' | 'task'.
// Fallback (leere Tabelle / Alt-Datenbestand): die bisherige Einzel-URL/-ID der Verbindung als
// eine synthetische Auswahlzeile, damit der Sync auch ohne Discovery weiterlaeuft.
function listSelectedCalendars(connectionId, kind) {
  const rows = db.prepare(
    'SELECT * FROM connection_calendars WHERE connection_id = ? AND kind = ? AND selected = 1 ORDER BY position, name'
  ).all(connectionId, kind);
  if (rows.length) return rows;
  const conn = db.prepare('SELECT * FROM calendar_connections WHERE id = ?').get(connectionId);
  if (!conn) return [];
  const ref = kind === 'task'
    ? (isCaldavProvider(conn.provider) ? conn.todo_url : conn.task_list_id)
    : (isCaldavProvider(conn.provider) ? conn.calendar_url : conn.calendar_id);
  return ref ? [{ id: '', connection_id: connectionId, kind, remote_id: ref, name: '', color: '', selected: 1 }] : [];
}

// ===== Projekt je Fall (PLAN-AUFGABEN-SYNC, Nutzerentscheidung 02.08.2026) =====
// Aufgaben eines Falls laufen in das zugeordnete Projekt der Verbindung; beim Spiegeln in die
// Gegenrichtung bekommt eine Aufgabe aus einem zugeordneten Projekt den Fall angeheftet.
const caseProjectStmt = db.prepare('SELECT remote_project_id FROM connection_case_projects WHERE connection_id = ? AND case_id = ?');
const projectCaseStmt = db.prepare('SELECT case_id FROM connection_case_projects WHERE connection_id = ? AND remote_project_id = ?');
const caseLabelStmt = db.prepare('SELECT label FROM cases WHERE id = ?');

function caseProjectRef(conn, caseId) {
  if (!conn || !caseId || !isTaskApiProvider(conn.provider)) return '';
  const row = caseProjectStmt.get(conn.id, String(caseId));
  return row ? String(row.remote_project_id) : '';
}

function caseForProjectRef(conn, remoteProjectId) {
  if (!conn || !remoteProjectId || !isTaskApiProvider(conn.provider)) return null;
  const row = projectCaseStmt.get(conn.id, String(remoteProjectId));
  if (!row) return null;
  const label = caseLabelStmt.get(row.case_id);
  return { caseId: String(row.case_id), caseLabel: String(label?.label || '') };
}

// Ziel-Kalender fuer NEU lokal angelegte Termine/Aufgaben einer Verbindung = erste aktivierte Liste
// (Fallback: bisheriges Einzelfeld). Legacy-tauglich, bricht bestehendes Push-Verhalten nicht.
function primaryRef(conn, kind) {
  const sel = listSelectedCalendars(conn.id, kind)[0];
  if (sel) return sel.remote_id;
  return kind === 'task'
    ? (isCaldavProvider(conn.provider) ? conn.todo_url : conn.task_list_id)
    : (isCaldavProvider(conn.provider) ? conn.calendar_url : conn.calendar_id);
}

function tokenRefreshPersister(connectionId) {
  return async (refreshed) => {
    db.prepare(`
      UPDATE calendar_connections SET access_token_encrypted=?, token_expires_at=?, updated_at=datetime('now') WHERE id=?
    `).run(cryptoHelper.encrypt(refreshed.access_token || ''), new Date(Date.now() + (Number(refreshed.expires_in) || 3600) * 1000).toISOString(), connectionId);
  };
}

// Liefert eine einheitliche Liste {uid,href,etag,title,description,location,startAt,endAt,allDay}
// unabhaengig vom tatsaechlichen Anbieter.
async function fetchEvents(conn, calendarRef) {
  const ref = calendarRef || (isCaldavProvider(conn.provider) ? conn.calendar_url : conn.calendar_id);
  if (!ref) return [];
  if (isCaldavProvider(conn.provider)) {
    return caldav.fetchEvents({ ...conn, calendar_url: ref }, {});
  }
  if (isOauthProvider(conn.provider)) {
    if (!conn.refresh_token_encrypted) return [];
    return oauthAdapters[conn.provider].fetchEvents({ ...conn, calendar_id: ref }, tokenRefreshPersister(conn.id), {});
  }
  return [];
}
async function fetchTodos(conn, todoRef) {
  const ref = todoRef || (isCaldavProvider(conn.provider) ? conn.todo_url : conn.task_list_id);
  if (!ref) return [];
  if (isCaldavProvider(conn.provider)) {
    return caldav.fetchTodos({ ...conn, todo_url: ref });
  }
  if (isTaskApiProvider(conn.provider)) {
    return taskApiAdapter(conn.provider).fetchTodos({ ...conn, task_list_id: ref });
  }
  if (isOauthProvider(conn.provider)) {
    if (!conn.refresh_token_encrypted) return [];
    return oauthAdapters[conn.provider].fetchTodos({ ...conn, task_list_id: ref }, tokenRefreshPersister(conn.id));
  }
  return [];
}

// Externe Erinnerung (Nutzerwunsch): App-reminderAt (absoluter Zeitpunkt) -> "Minuten vor Start"
// fuer Graph/Google/CalDAV. startAt und reminderAt sind beide naive-lokale ISO-Strings, daher ist
// die Differenz zeitzonensicher. null = keine Erinnerung (schaltet die Erinnerung extern AUS).
function reminderMinutesBefore(startAt, reminderAt) {
  if (!reminderAt || !startAt) return null;
  const s = Date.parse(startAt), r = Date.parse(reminderAt);
  if (isNaN(s) || isNaN(r)) return null;
  const mins = Math.round((s - r) / 60000);
  return mins >= 0 ? mins : 0; // Erinnerung zur/nach Startzeit -> 0 Min vorher
}

// event: {uid?,href?,title,description,location,startAt,endAt,allDay,reminderAt} - gibt {uid,href}
// zurueck (href bleibt bei OAuth-Anbietern leer, da dort keine URL-Adressierung existiert).
async function pushEvent(conn, event) {
  const ref = event.calendarRef || primaryRef(conn, 'event');
  const ev = { ...event, reminderMinutes: reminderMinutesBefore(event.startAt, event.reminderAt) };
  if (isCaldavProvider(conn.provider)) {
    const result = await caldav.pushEvent({ ...conn, calendar_url: ref || conn.calendar_url }, ev);
    return { uid: result.uid, href: result.href, calendarRef: ref || '' };
  }
  if (isOauthProvider(conn.provider)) {
    const result = await oauthAdapters[conn.provider].pushEvent({ ...conn, calendar_id: ref || conn.calendar_id }, ev, tokenRefreshPersister(conn.id));
    return { uid: result.uid, href: '', calendarRef: ref || '' };
  }
  throw new Error('Unbekannter Kalenderanbieter.');
}
async function pushTodo(conn, todo) {
  // Fall-Zuordnung schlaegt die allgemeine Vorgabe: hat der Fall der Aufgabe ein Projekt in
  // dieser Verbindung, laeuft die Aufgabe dorthin (Projekt je Fall).
  const mapped = caseProjectRef(conn, todo.caseId);
  const ref = mapped || todo.calendarRef || primaryRef(conn, 'task');
  if (isCaldavProvider(conn.provider)) {
    const result = await caldav.pushTodo({ ...conn, todo_url: ref || conn.todo_url }, todo);
    return { uid: result.uid, href: result.href, calendarRef: ref || '' };
  }
  if (isTaskApiProvider(conn.provider)) {
    const result = await taskApiAdapter(conn.provider).pushTodo({ ...conn }, { ...todo, calendarRef: ref });
    return { uid: result.uid, href: '', calendarRef: ref || '' };
  }
  if (isOauthProvider(conn.provider)) {
    const result = await oauthAdapters[conn.provider].pushTodo({ ...conn, task_list_id: ref || conn.task_list_id }, todo, tokenRefreshPersister(conn.id));
    return { uid: result.uid, href: '', calendarRef: ref || '' };
  }
  throw new Error('Unbekannter Kalenderanbieter.');
}

async function deleteRemoteEvent(conn, row) {
  if (isCaldavProvider(conn.provider)) return caldav.deleteRemote(conn, row.external_href);
  if (isOauthProvider(conn.provider)) return oauthAdapters[conn.provider].deleteRemoteEvent(conn, row.external_uid, tokenRefreshPersister(conn.id));
}
async function deleteRemoteTodo(conn, row) {
  if (isCaldavProvider(conn.provider)) return caldav.deleteRemote(conn, row.external_href);
  if (isTaskApiProvider(conn.provider)) return taskApiAdapter(conn.provider).deleteRemoteTodo(conn, row.external_uid);
  if (isOauthProvider(conn.provider)) return oauthAdapters[conn.provider].deleteRemoteTodo(conn, row.external_uid, tokenRefreshPersister(conn.id));
}

module.exports = {
  isCaldavProvider, isOauthProvider, isTaskApiProvider, taskApiAdapter,
  listEnabledConnections, reminderMinutesBefore,
  listSelectedCalendars, primaryRef, caseProjectRef, caseForProjectRef,
  fetchEvents, fetchTodos, pushEvent, pushTodo, deleteRemoteEvent, deleteRemoteTodo
};
