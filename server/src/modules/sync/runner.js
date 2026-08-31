// Gemeinsamer Pull-Sync-Kern fuer Termine + Aufgaben (Nutzerwunsch: automatischer Abgleich im
// Minutentakt). Die Logik lag bisher inline in den POST /sync-Routen von routes/calendar.js und
// routes/todos.js - fuer den serverseitigen Timer (index.js) hierher extrahiert, damit Route und
// Timer denselben, einzigen Codepfad nutzen. userId darf null sein (Timer-Laeufe ohne Sitzung -
// updated_by ist nullable, gleiche Konvention wie beim Nutzer-Loeschen in routes/admin.js).

const crypto = require('crypto');
const db = require('../../database/index');
const sync = require('../calendar/sync');
const contactsSync = require('../contacts/sync');
const journal = require('./journal');
const applicationWriteBarrier = require('../../middleware/application-write-barrier');

// Netzfehler von fetch (undici) melden sich nur als "fetch failed" - die eigentliche Ursache
// (DNS, Timeout, Verbindungsabbruch, Proxy) steckt in error.cause und ging bisher im Protokoll
// verloren. Fuer die [auto-sync]-Zeilen die Ursache mit anhaengen, damit ein Blick ins Log genuegt.
function fehlerText(error) {
  const msg = String((error && error.message) || error || 'Unbekannter Fehler');
  const cause = error && error.cause;
  if (!cause) return msg;
  const detail = cause.code || cause.message;
  return detail && !msg.includes(detail) ? `${msg} (${detail})` : msg;
}

// ===== Termine =====
const evInsertStmt = db.prepare(`
  INSERT INTO calendar_events (id, title, description, location, online_url, color, start_at, end_at, all_day, recurrence_rule, case_label, source, connection_id, calendar_ref, external_uid, external_href, external_etag, owner_user_id, visibility, updated_by)
  VALUES (@id, @title, @description, @location, @onlineUrl, @color, @startAt, @endAt, @allDay, @recurrenceRule, @caseLabel, @source, @connectionId, @calendarRef, @externalUid, @externalHref, @externalEtag, @ownerUserId, @visibility, @userId)
`);
const evUpdateStmt = db.prepare(`
  UPDATE calendar_events SET title=@title, description=@description, location=@location, online_url=@onlineUrl, color=@color, start_at=@startAt, end_at=@endAt,
    all_day=@allDay, recurrence_rule=@recurrenceRule, case_label=@caseLabel, external_uid=@externalUid, external_href=@externalHref, external_etag=@externalEtag, owner_user_id=@ownerUserId, visibility=@visibility, updated_at=datetime('now'), updated_by=@userId
  WHERE id=@id
`);
const evDeleteStmt = db.prepare('DELETE FROM calendar_events WHERE id = ?');
// Abgleich jetzt je (Verbindung + Kalender): ein Sync-Lauf eines Kalenders darf die Termine eines
// ANDEREN Kalenders derselben Verbindung nicht als verwaist entfernen.
const evFindStmt = db.prepare('SELECT id FROM calendar_events WHERE connection_id = ? AND calendar_ref = ? AND external_uid = ?');
const evPrevStmt = db.prepare('SELECT case_label, online_url, color FROM calendar_events WHERE id = ?');
const evMirroredStmt = db.prepare('SELECT id, external_uid FROM calendar_events WHERE connection_id = ? AND calendar_ref = ?');
const evConnMirroredStmt = db.prepare("SELECT id, calendar_ref FROM calendar_events WHERE connection_id = ? AND external_uid != ''");

const evTx = db.transaction((conn, calendarRef, remoteEvents, userId) => {
  const seenUids = new Set();
  for (const ev of remoteEvents) {
    if (!ev.uid) continue;
    seenUids.add(ev.uid);
    const existing = evFindStmt.get(conn.id, calendarRef, ev.uid);
    const row = {
      title: ev.title, description: ev.description, location: ev.location, startAt: ev.startAt, endAt: ev.endAt || ev.startAt,
      allDay: ev.allDay ? 1 : 0, recurrenceRule: ev.recurrenceRule || '', externalUid: ev.uid, externalHref: ev.href || '', externalEtag: ev.etag || '',
      // Multi-User: Termine erben Zugehörigkeit + Sichtbarkeit ihrer Verbindung.
      ownerUserId: (conn.owner_user_id == null ? null : conn.owner_user_id), visibility: (conn.visibility === 'private' ? 'private' : 'public'), userId
    };
    if (existing) {
      // caseLabel/onlineUrl/color bleiben bei bereits gemirrorten Terminen erhalten (nicht Teil
      // der Pull-Sync-Nutzdaten des Anbieters) - nur bei einer BRANDNEUEN Zeile gibt es noch keine.
      const prev = evPrevStmt.get(existing.id);
      evUpdateStmt.run({ ...row, id: existing.id, caseLabel: prev?.case_label || '', onlineUrl: prev?.online_url || '', color: prev?.color || '' });
    } else {
      evInsertStmt.run({ ...row, id: crypto.randomUUID(), caseLabel: '', onlineUrl: '', color: '', source: conn.provider, connectionId: conn.id, calendarRef });
    }
  }
  for (const row of evMirroredStmt.all(conn.id, calendarRef)) {
    if (row.external_uid && !seenUids.has(row.external_uid)) evDeleteStmt.run(row.id);
  }
});

// Termine gespiegelter, aber NICHT (mehr) ausgewaehlter Kalender einer Verbindung entfernen (Nutzer
// hat sie abgehakt). Nur gespiegelte (external_uid != '') mit gesetztem, nicht mehr aktivem
// calendar_ref - lokale Termine (external_uid='') und noch nicht getaggte bleiben unangetastet.
const evPruneTx = db.transaction((connId, selectedRefs) => {
  const keep = new Set(selectedRefs.filter(Boolean));
  for (const row of evConnMirroredStmt.all(connId)) {
    if (row.calendar_ref && !keep.has(row.calendar_ref)) evDeleteStmt.run(row.id);
  }
});

// Zieht Termine von ALLEN aktiven Verbindungen und deren AUSGEWAEHLTEN Kalendern; gleicht je
// (Verbindung + Kalender) getrennt per external_uid ab.
async function syncEvents(userId) {
  const connections = sync.listEnabledConnections();
  const errors = [];
  if (!connections.length) return { ran: false, errors };
  for (const conn of connections) {
    const cals = sync.listSelectedCalendars(conn.id, 'event');
    // OpenProject-iCal-Abo (Etappe 5, nur lesend): laeuft als eigener Pseudo-Kalender 'ical'
    // durch denselben Spiegel-Abgleich - Prune darf ihn deshalb nicht als verwaist ansehen.
    const icalActive = conn.provider === 'openproject' && String(conn.ical_url || '').trim();
    try { evPruneTx(conn.id, cals.map((c) => c.remote_id).concat(icalActive ? ['ical'] : [])); } catch (_e) { /* Prune ist best-effort */ }
    for (const cal of cals) {
      if (!cal.remote_id) continue;
      try {
        evTx(conn, cal.remote_id, await sync.fetchEvents(conn, cal.remote_id), userId);
      } catch (error) {
        errors.push(`${conn.display_name || conn.provider}${cal.name ? ' / ' + cal.name : ''}: ${fehlerText(error)}`);
      }
    }
    if (icalActive) {
      try {
        const openproject = require('../../integrations/tasks/openproject');
        const caldav = require('../../integrations/calendar/caldav');
        evTx(conn, 'ical', await openproject.fetchIcalEvents(conn, caldav), userId);
      } catch (error) {
        errors.push(`${conn.display_name || conn.provider} / iCal-Abo: ${fehlerText(error)}`);
      }
    }
  }
  return { ran: true, errors };
}

// ===== Aufgaben =====
const tdInsertStmt = db.prepare(`
  INSERT INTO todos
    (id, title, description, due_at, start_at, done, priority, recurrence_rule, case_label,
     item_type, case_id, source_type, source_id, source_module, source_ref,
     source, connection_id, calendar_ref, external_uid, external_href, external_etag, owner_user_id, visibility, updated_by)
  VALUES
    (@id, @title, @description, @dueAt, @startAt, @done, @priority, @recurrenceRule, @caseLabel,
     @itemType, @caseId, @sourceType, @sourceId, @sourceModule, @sourceRef,
     @source, @connectionId, @calendarRef, @externalUid, @externalHref, @externalEtag, @ownerUserId, @visibility, @userId)
`);
const tdUpdateStmt = db.prepare(`
  UPDATE todos SET title=@title, description=@description, due_at=@dueAt, start_at=@startAt, done=@done, priority=@priority, recurrence_rule=@recurrenceRule,
    case_label=@caseLabel, item_type=@itemType, case_id=@caseId, source_type=@sourceType, source_id=@sourceId,
    source_module=@sourceModule, source_ref=@sourceRef, external_uid=@externalUid, external_href=@externalHref,
    external_etag=@externalEtag, owner_user_id=@ownerUserId, visibility=@visibility, updated_at=datetime('now'), updated_by=@userId
  WHERE id=@id
`);
const tdDeleteStmt = db.prepare('DELETE FROM todos WHERE id = ?');
const tdFindStmt = db.prepare('SELECT id FROM todos WHERE connection_id = ? AND calendar_ref = ? AND external_uid = ?');
const tdPrevStmt = db.prepare(`
  SELECT case_label, start_at, recurrence_rule, item_type, case_id, source_type, source_id, source_module, source_ref
    FROM todos WHERE id = ?
`);
const tdFullStmt = db.prepare('SELECT * FROM todos WHERE id = ?');
const tdMirroredStmt = db.prepare('SELECT id, external_uid, item_type FROM todos WHERE connection_id = ? AND calendar_ref = ?');
const tdConnMirroredStmt = db.prepare("SELECT id, calendar_ref, item_type FROM todos WHERE connection_id = ? AND external_uid != ''");
const tdRelinkStmt = db.prepare(`
  UPDATE todos SET external_uid=@externalUid, external_href=@externalHref, calendar_ref=@calendarRef, updated_at=datetime('now') WHERE id=@id
`);

// Fristen und Wiedervorlagen sind NUR-EXPORT (Nutzerentscheidung 02.08.2026): sie stammen aus dem
// Buero und duerfen von aussen weder veraendert noch geloescht werden. Der Waechter unten verwirft
// eingehende Aenderungen, plant eine Reparatur (den Buero-Stand zurueckschreiben) und haelt beides
// im Sync-Journal fest.
const PROTECTED_TODO_TYPES = new Set(['deadline', 'followup']);

function inferredTodoType(todo) {
  if (/^\s*wiedervorlage\s*:/i.test(String(todo?.title || '')) || /\[wiedervorlage\]/i.test(String(todo?.description || ''))) return 'followup';
  if (/^\s*frist\s*:/i.test(String(todo?.title || ''))) return 'deadline';
  return 'task';
}

// ctx: {caseHint: {caseId, caseLabel}|null, repairs: [{id, reason}]} - Reparaturen sind
// asynchron (Netz) und laufen deshalb NACH der Transaktion in repairProtectedTodos().
const tdTx = db.transaction((conn, calendarRef, remoteTodos, userId, ctx) => {
  const seenUids = new Set();
  for (const t of remoteTodos) {
    if (!t.uid) continue;
    seenUids.add(t.uid);
    const existing = tdFindStmt.get(conn.id, calendarRef, t.uid);
    const row = {
      title: t.title, description: t.description, dueAt: t.dueAt || '', done: t.done ? 1 : 0, priority: t.priority,
      externalUid: t.uid, externalHref: t.href || '', externalEtag: t.etag || '',
      // Multi-User: Aufgaben erben Zugehörigkeit + Sichtbarkeit ihrer Verbindung.
      ownerUserId: (conn.owner_user_id == null ? null : conn.owner_user_id), visibility: (conn.visibility === 'private' ? 'private' : 'public'), userId
    };
    if (existing) {
      const prev = tdPrevStmt.get(existing.id);
      // Nur-Export-Waechter: Fristen/Wiedervorlagen uebernehmen NIE den entfernten Stand.
      if (PROTECTED_TODO_TYPES.has(String(prev?.item_type || ''))) {
        const local = tdFullStmt.get(existing.id);
        const differs = local && (
          String(local.title || '') !== String(t.title || '')
          || String(local.due_at || '').slice(0, 10) !== String(t.dueAt || '').slice(0, 10)
          || !!local.done !== !!t.done
          || String(local.description || '') !== String(t.description || '')
        );
        if (differs && ctx) {
          ctx.repairs.push({ id: existing.id, reason: 'geändert' });
          journal.write({
            connectionId: conn.id, direction: 'pull', action: 'verworfen', localType: prev.item_type,
            localId: existing.id, remoteId: t.uid,
            detail: `Eingehende Änderung an „${String(local?.title || '').slice(0, 80)}" verworfen (Fristen sind Nur-Export); der Bürostand wird zurückgeschrieben.`
          });
        }
        continue;
      }
      // caseLabel/startAt/recurrenceRule sind LOKALE Zusatzfelder (der Anbieter kennt sie nicht) -
      // bei bereits gemirrorten Aufgaben erhalten. startAt/recurrenceRule wurden vor dem Auto-Sync
      // faelschlich mit '' ueberschrieben; im Minutentakt haette das lokale Eingaben sofort geloescht.
      tdUpdateStmt.run({
        ...row,
        id: existing.id,
        caseLabel: prev?.case_label || '',
        startAt: prev?.start_at || '',
        recurrenceRule: prev?.recurrence_rule || '',
        itemType: prev?.item_type || inferredTodoType(t),
        caseId: prev?.case_id || '',
        sourceType: prev?.source_type || '',
        sourceId: prev?.source_id || '',
        sourceModule: prev?.source_module || '',
        sourceRef: prev?.source_ref || ''
      });
    } else {
      tdInsertStmt.run({
        ...row,
        id: crypto.randomUUID(),
        // Projekt je Fall: Aufgaben aus einem zugeordneten Projekt kommen mit Fall an.
        caseLabel: ctx?.caseHint?.caseLabel || '',
        startAt: '',
        recurrenceRule: '',
        itemType: inferredTodoType(t),
        caseId: ctx?.caseHint?.caseId || '',
        sourceType: '',
        sourceId: '',
        sourceModule: '',
        sourceRef: '',
        source: conn.provider,
        connectionId: conn.id,
        calendarRef
      });
    }
  }
  for (const row of tdMirroredStmt.all(conn.id, calendarRef)) {
    if (!row.external_uid || seenUids.has(row.external_uid)) continue;
    // Nur-Export-Waechter: eine entfernt geloeschte Frist wird NICHT lokal geloescht,
    // sondern wiederhergestellt (neu hinausgeschrieben).
    if (PROTECTED_TODO_TYPES.has(String(row.item_type || ''))) {
      if (ctx) {
        ctx.repairs.push({ id: row.id, reason: 'entfernt' });
        journal.write({
          connectionId: conn.id, direction: 'pull', action: 'wiederhergestellt', localType: row.item_type,
          localId: row.id, remoteId: row.external_uid,
          detail: 'Entfernte Löschung einer Frist/Wiedervorlage nicht übernommen; der Eintrag wird erneut exportiert.'
        });
      }
      continue;
    }
    tdDeleteStmt.run(row.id);
  }
});

// Reparatur nach dem Waechter: den Buero-Stand einer Frist/Wiedervorlage zurueckschreiben.
// Bei 'entfernt' existiert die entfernte Aufgabe nicht mehr - dann neu anlegen und die
// Verknuepfung (uid/href) nachziehen.
async function repairProtectedTodos(conn, calendarRef, repairs, errors) {
  for (const repair of repairs) {
    const row = tdFullStmt.get(repair.id);
    if (!row) continue;
    const payload = {
      title: row.title, description: row.description, dueAt: row.due_at, done: !!row.done,
      priority: row.priority, caseId: row.case_id, calendarRef: row.calendar_ref || calendarRef
    };
    try {
      let pushed;
      try {
        pushed = await sync.pushTodo(conn, { ...payload, uid: row.external_uid, href: row.external_href });
      } catch (_inner) {
        // Ziel existiert nicht mehr (z. B. entfernt geloescht bei ID-adressierten Anbietern):
        // als neuen Eintrag hinausschreiben.
        pushed = await sync.pushTodo(conn, payload);
      }
      if (pushed && (pushed.uid !== row.external_uid || (pushed.href || '') !== (row.external_href || ''))) {
        tdRelinkStmt.run({
          id: row.id, externalUid: pushed.uid || row.external_uid,
          externalHref: pushed.href || '', calendarRef: pushed.calendarRef || row.calendar_ref || calendarRef
        });
      }
    } catch (error) {
      errors.push(`${conn.display_name || conn.provider}: Frist-Reparatur fehlgeschlagen (${fehlerText(error)})`);
      journal.write({
        connectionId: conn.id, direction: 'push', action: 'fehler', localType: row.item_type,
        localId: row.id, remoteId: row.external_uid, detail: `Reparatur fehlgeschlagen: ${error.message}`
      });
    }
  }
}

const tdUnlinkStmt = db.prepare(`
  UPDATE todos SET source='local', connection_id=NULL, calendar_ref='', external_uid='', external_href='', external_etag='', updated_at=datetime('now') WHERE id=?
`);
const tdPruneTx = db.transaction((connId, selectedRefs) => {
  const keep = new Set(selectedRefs.filter(Boolean));
  for (const row of tdConnMirroredStmt.all(connId)) {
    if (!row.calendar_ref || keep.has(row.calendar_ref)) continue;
    // Fristen/Wiedervorlagen sind Buero-Daten: wird ihre Liste abgewaehlt, verlieren sie nur die
    // Verknuepfung (und werden ggf. neu exportiert) - geloescht wird nichts.
    if (PROTECTED_TODO_TYPES.has(String(row.item_type || ''))) { tdUnlinkStmt.run(row.id); continue; }
    tdDeleteStmt.run(row.id);
  }
});

// Fristen-Export (PLAN-AUFGABEN-SYNC, Etappe 1): offene Fristen/Wiedervorlagen ohne Verknuepfung
// werden in die ERSTE Verbindung mit deadline_export=1 hinausgeschrieben (todos verknuepfen 1:1 -
// eine Frist lebt in genau einer Verbindung). Ziel je Frist: das Projekt ihres Falls, sonst die
// Standard-Aufgabenliste der Verbindung.
const unexportedDeadlinesStmt = db.prepare(`
  SELECT * FROM todos
   WHERE item_type IN ('deadline','followup') AND done = 0
     AND (connection_id IS NULL OR connection_id = '') AND recurrence_rule = ''
`);
const tdLinkExportStmt = db.prepare(`
  UPDATE todos SET source=@source, connection_id=@connectionId, calendar_ref=@calendarRef,
    external_uid=@externalUid, external_href=@externalHref, updated_at=datetime('now')
  WHERE id=@id
`);
async function exportDeadlines(errors) {
  const target = sync.listEnabledConnections().find((c) => Number(c.deadline_export) === 1);
  if (!target) return;
  for (const row of unexportedDeadlinesStmt.all()) {
    try {
      const pushed = await sync.pushTodo(target, {
        title: row.title, description: row.description, dueAt: row.due_at, done: false,
        priority: row.priority, caseId: row.case_id
      });
      if (!pushed?.uid && !pushed?.href) continue;
      tdLinkExportStmt.run({
        id: row.id, source: target.provider, connectionId: target.id,
        calendarRef: pushed.calendarRef || '', externalUid: pushed.uid || '', externalHref: pushed.href || ''
      });
      journal.write({
        connectionId: target.id, direction: 'push', action: 'exportiert', localType: row.item_type,
        localId: row.id, remoteId: pushed.uid || pushed.href || '',
        detail: `„${String(row.title || '').slice(0, 80)}" exportiert (Nur-Export).`
      });
    } catch (error) {
      errors.push(`${target.display_name || target.provider}: Fristen-Export fehlgeschlagen (${fehlerText(error)})`);
    }
  }
}

async function syncTodos(userId) {
  const connections = sync.listEnabledConnections();
  const errors = [];
  if (!connections.length) return { ran: false, errors };
  await exportDeadlines(errors);
  for (const conn of connections) {
    const lists = sync.listSelectedCalendars(conn.id, 'task');
    try { tdPruneTx(conn.id, lists.map((c) => c.remote_id)); } catch (_e) { /* Prune ist best-effort */ }
    for (const lst of lists) {
      if (!lst.remote_id) continue;
      try {
        const ctx = { caseHint: sync.caseForProjectRef(conn, lst.remote_id), repairs: [] };
        tdTx(conn, lst.remote_id, await sync.fetchTodos(conn, lst.remote_id), userId, ctx);
        if (ctx.repairs.length) await repairProtectedTodos(conn, lst.remote_id, ctx.repairs, errors);
      } catch (error) {
        errors.push(`${conn.display_name || conn.provider}${lst.name ? ' / ' + lst.name : ''}: ${fehlerText(error)}`);
      }
    }
  }
  return { ran: true, errors };
}

// Automatischer periodischer Abgleich (Nutzerwunsch: "alle Minute"). Ueberlappungsschutz: laeuft
// ein Durchgang noch (langsamer Anbieter), wird der naechste Tick uebersprungen statt zu stapeln.
// Ohne aktive Verbindungen ist ein Tick ein billiger No-Op (eine DB-Abfrage).
let autoSyncBusy = false;
let autoSyncLetzteStoerung = '';
let autoSyncStoerungsTicks = 0;
function startAutoSync() {
  const seconds = process.env.CALENDAR_SYNC_INTERVAL_SECONDS != null
    ? Number(process.env.CALENDAR_SYNC_INTERVAL_SECONDS)
    : 60;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    console.log('[auto-sync] deaktiviert (CALENDAR_SYNC_INTERVAL_SECONDS=0).');
    return null;
  }
  const intervalMs = Math.max(15, seconds) * 1000;
  const timer = setInterval(async () => {
    if (autoSyncBusy) return;
    autoSyncBusy = true;
    try {
      const guarded = await applicationWriteBarrier.withWrite(
        'Automatischer Kalender-, Aufgaben- und Kontaktabgleich',
        async () => {
          const a = await syncEvents(null);
          const b = await syncTodos(null);
          // Kontakte nur für Verbindungen mit contacts_sync_mode='auto' (Nutzerwunsch: Intervall vs. manuell).
          let c = { errors: [] };
          try { c = await contactsSync.syncContacts(null, true); } catch (e) { c = { errors: [`Kontakte: ${e.message}`] }; }
          return [...a.errors, ...b.errors, ...c.errors];
        }
      );
      // Während der kurzen lokalen Snapshotphase wird der Takt bewusst ausgelassen.
      // Der nächste Minutentakt holt ihn nach; ein bereits gestarteter Lauf wird
      // dagegen von begin() vollständig abgewartet.
      if (guarded.skipped) return;
      // Wiederholte identische Fehler (z. B. minutenlanger DNS-/Netzausfall) nicht jede Minute
      // erneut ausschreiben: erste Meldung sofort, danach nur jede 15. mit Zaehler - und die
      // ERHOLUNG ausdruecklich melden, damit im Log sichtbar ist, wann der Abgleich wieder lief.
      const signatur = guarded.value.join(' | ');
      if (signatur) {
        if (signatur === autoSyncLetzteStoerung) {
          autoSyncStoerungsTicks += 1;
          if (autoSyncStoerungsTicks % 15 === 0) {
            console.warn(`[auto-sync] weiterhin gestört (${autoSyncStoerungsTicks}. Durchgang):`, signatur);
          }
        } else {
          autoSyncLetzteStoerung = signatur;
          autoSyncStoerungsTicks = 1;
          console.warn('[auto-sync]', signatur);
        }
      } else if (autoSyncLetzteStoerung) {
        console.log(`[auto-sync] Verbindung wiederhergestellt (nach ${autoSyncStoerungsTicks} gestörten Durchgängen).`);
        autoSyncLetzteStoerung = '';
        autoSyncStoerungsTicks = 0;
      }
    } catch (error) {
      console.warn('[auto-sync] fehlgeschlagen:', error.message);
    } finally {
      autoSyncBusy = false;
    }
  }, intervalMs);
  timer.unref?.(); // haelt den Prozess beim Herunterfahren nicht offen
  console.log(`[auto-sync] Kalender/Aufgaben-Abgleich aktiv (alle ${Math.max(15, seconds)}s).`);
  return timer;
}

module.exports = { syncEvents, syncTodos, startAutoSync };
