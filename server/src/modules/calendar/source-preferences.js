'use strict';

// Persönliche Speicherziele. Fachdatensätze und bestehende Verknüpfungen werden nie verändert.
const KEY = 'calendar-sources';
const empty = () => ({ version: 1, localCalendar: true, localTasks: true, defaultCalendar: null, defaultTasks: null });
function normalize(value) {
  const result = empty();
  for (const key of ['localCalendar', 'localTasks']) if (typeof value?.[key] === 'boolean') result[key] = value[key];
  for (const key of ['defaultCalendar', 'defaultTasks']) {
    const target = value?.[key];
    if (target && typeof target.connectionId === 'string' && typeof target.calendarRef === 'string') {
      result[key] = { connectionId: target.connectionId, calendarRef: target.calendarRef };
    }
  }
  return result;
}
function failure(message, status = 409) { return Object.assign(new Error(message), { status }); }
function create(db) {
  function get(userId) {
    const row = db.prepare('SELECT data_json FROM user_ui_prefs WHERE user_id = ? AND pref_key = ?').get(userId, KEY);
    try { return normalize(JSON.parse(row?.data_json || '{}')); } catch (_) { return empty(); }
  }
  function targets(userId, kind) {
    const connections = db.prepare("SELECT * FROM calendar_connections WHERE enabled = 1 AND (visibility <> 'private' OR owner_user_id = ?) ORDER BY display_name, id").all(userId);
    return connections.flatMap(connection => {
      if (kind === 'event' && ['openproject', 'vikunja-api', 'vikunja'].includes(connection.provider)) return [];
      const rows = db.prepare('SELECT id, remote_id, name, color FROM connection_calendars WHERE connection_id = ? AND kind = ? AND selected = 1 ORDER BY position, name').all(connection.id, kind);
      // Nur echte Altbestände ohne entdeckte Listen dürfen auf das frühere Einzelfeld zurückfallen.
      if (!rows.length && !db.prepare('SELECT 1 FROM connection_calendars WHERE connection_id = ? AND kind = ?').get(connection.id, kind)) {
        const caldav = ['nextcloud', 'icloud', 'vikunja'].includes(connection.provider);
        const ref = kind === 'event' ? (caldav ? connection.calendar_url : connection.calendar_id) : (caldav ? connection.todo_url : connection.task_list_id);
        if (ref) rows.push({ remote_id: ref, name: kind === 'event' ? 'Kalender' : 'Aufgabenliste' });
      }
      return rows.map(row => ({ connection, connectionId: connection.id, calendarRef: row.remote_id, id: row.id || '', color: row.color || '', kind, name: row.name || (kind === 'event' ? 'Kalender' : 'Aufgabenliste') }));
    });
  }
  function find(userId, kind, target) {
    return target && targets(userId, kind).find(row => row.connectionId === target.connectionId && row.calendarRef === target.calendarRef);
  }
  function save(userId, value) {
    if (!value || value.version !== 1 || typeof value.localCalendar !== 'boolean' || typeof value.localTasks !== 'boolean') throw failure('Die Einstellungen der Speicherziele sind ungültig.', 400);
    const prefs = normalize(value);
    for (const [kind, local, key] of [['event', 'localCalendar', 'defaultCalendar'], ['task', 'localTasks', 'defaultTasks']]) {
      if ((!prefs[local] || prefs[key]) && !find(userId, kind, prefs[key])) throw failure('Bitte eine aktive, freigegebene '+(kind === 'event' ? 'Kalenderverbindung' : 'Aufgabenliste')+' als Standardziel auswählen.', 400);
    }
    db.prepare("INSERT INTO user_ui_prefs (user_id, pref_key, data_json, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(user_id, pref_key) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at").run(userId, KEY, JSON.stringify(prefs));
    return prefs;
  }
  function resolve(userId, kind, connectionId, calendarRef) {
    const prefs = get(userId), local = kind === 'event' ? prefs.localCalendar : prefs.localTasks;
    if (local) return { required: false, target: null };
    if (connectionId === '' || connectionId === 'local') throw failure('Das lokale Speicherziel ist ausgeschaltet. Bitte eine Online-Verbindung auswählen oder das lokale Speicherziel wieder einschalten.');
    const wanted = connectionId ? { connectionId, calendarRef } : prefs[kind === 'event' ? 'defaultCalendar' : 'defaultTasks'];
    const target = find(userId, kind, wanted);
    if (!target) throw failure('Das Online-Speicherziel ist nicht mehr verfügbar. Bitte unter „Lokale Speicherziele“ eine aktive Liste auswählen.');
    return { required: true, target };
  }
  // Spezialdialoge und Werkzeug-Anbindungen ohne Online-Ziel dürfen nicht unsichtbar
  // lokal weiterschreiben. Bestehende Einträge und Datenmigrationen bleiben unberührt.
  function assertLocalAllowed(userId, kind) {
    const prefs = get(userId);
    if (prefs[kind === 'event' ? 'localCalendar' : 'localTasks'] === false) {
      throw failure('Dieser Vorgang legt einen lokalen Eintrag an. Das lokale Speicherziel ist ausgeschaltet. Bitte den Eintrag im Kalender-/Aufgabenformular mit einem Online-Ziel anlegen oder unter „Lokale Speicherziele“ wieder einschalten.');
    }
  }
  return { get, targets, save, resolve, assertLocalAllowed };
}
module.exports = { create, normalize, KEY };
