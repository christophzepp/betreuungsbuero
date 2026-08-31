// Google Calendar + Google Tasks OAuth-Adapter (Plan Abschnitt AE) - im Unterschied zu
// server/caldav.js (Standard-CalDAV/ICS fuer Nextcloud/iCloud) spricht Google eine eigene
// JSON-REST-API und verlangt zwingend OAuth 2.0 mit einem in der Google Cloud Console registrierten
// Projekt (Client-ID/Secret) - Basic-Auth mit App-Passwort ist seit 2025 fuer CalDAV nicht mehr
// moeglich (per offizieller Google-Dokumentation geprüft). Der Admin muss daher VOR der ersten
// Nutzung selbst ein Cloud-Projekt anlegen; dieser Adapter deckt den kompletten Autorisierungs-
// Handshake (Redirect-Flow) sowie den laufenden Kalender-/Aufgaben-Abgleich danach ab.

const cryptoHelper = require('../../security/crypto');
const recurrence = require('../../modules/calendar/recurrence');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const PEOPLE_API = 'https://people.googleapis.com/v1';
// Kontakte-Scope zusätzlich (Nutzerwunsch: Online-Kontakte-Sync). ACHTUNG: bestehende Verbindungen
// müssen nach diesem Update neu autorisiert werden, damit das Token auch den Kontakte-Scope enthält.
const SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/tasks', 'https://www.googleapis.com/auth/contacts'];

function getAuthUrl(conn, redirectUri, state) {
  const params = new URLSearchParams({
    client_id: conn.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(conn, code, redirectUri) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: conn.client_id,
      client_secret: cryptoHelper.decrypt(conn.client_secret_encrypted),
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Google-Autorisierung fehlgeschlagen.');
  return data; // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken(conn) {
  const refreshToken = cryptoHelper.decrypt(conn.refresh_token_encrypted);
  if (!refreshToken) throw new Error('Keine Google-Refresh-Token vorhanden - Verbindung muss neu autorisiert werden.');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: conn.client_id,
      client_secret: cryptoHelper.decrypt(conn.client_secret_encrypted),
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Google-Token konnte nicht erneuert werden.');
  return data; // { access_token, expires_in, ... } - Google liefert i.d.R. kein neues refresh_token
}

// Fuehrt einen authentifizierten Request aus, erneuert bei Bedarf einmalig den Access-Token und
// ruft onTokenRefreshed(newTokenData) auf, damit der Aufrufer die Datenbank aktualisieren kann.
async function authedFetch(conn, url, options, onTokenRefreshed) {
  let accessToken = cryptoHelper.decrypt(conn.access_token_encrypted);
  const doFetch = (token) => fetch(url, { ...options, headers: { ...(options?.headers || {}), Authorization: `Bearer ${token}` } });
  let res = await doFetch(accessToken);
  if (res.status === 401) {
    const refreshed = await refreshAccessToken(conn);
    accessToken = refreshed.access_token;
    if (onTokenRefreshed) await onTokenRefreshed(refreshed);
    res = await doFetch(accessToken);
  }
  return res;
}

async function listCalendars(conn, onTokenRefreshed) {
  const res = await authedFetch(conn, `${CALENDAR_API}/users/me/calendarList`, {}, onTokenRefreshed);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Kalenderliste konnte nicht geladen werden.');
  // backgroundColor (Hex) fuer den Farbpunkt in der Ansicht (Nutzerwunsch mehrere Kalender je Konto).
  return (data.items || []).map((c) => ({ id: c.id, name: c.summary || c.id, color: c.backgroundColor || '' }));
}

async function listTaskLists(conn, onTokenRefreshed) {
  const res = await authedFetch(conn, `${TASKS_API}/users/@me/lists`, {}, onTokenRefreshed);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Aufgabenlisten konnten nicht geladen werden.');
  return (data.items || []).map((l) => ({ id: l.id, name: l.title || l.id }));
}

function googleDateToIso(dateObj) {
  if (!dateObj) return '';
  if (dateObj.date) return `${dateObj.date}T00:00:00`;
  return String(dateObj.dateTime || '');
}
function isoToGoogleDate(iso, allDay) {
  if (allDay) {
    const m = String(iso || '').match(/^(\d{4}-\d{2}-\d{2})/);
    return { date: m ? m[1] : iso };
  }
  return { dateTime: iso, timeZone: 'UTC' };
}

async function fetchEvents(conn, onTokenRefreshed, { sinceIso, untilIso } = {}) {
  // singleEvents:false (Standard) liefert Serientermine als EINEN Master-Eintrag mit recurrence-Array
  // (statt sie in dutzende Einzeltermine zu expandieren) - damit ein hier angelegter Serientermin nach
  // dem Push auch beim Pull wieder als EINE Serie (gleiche UID) zurueckkommt, statt als viele Kopien.
  // Geaenderte Einzelinstanzen (recurringEventId gesetzt) werden uebersprungen (das App-Modell kennt
  // keine Einzelinstanz-Ausnahmen).
  const params = new URLSearchParams({
    timeMin: sinceIso || new Date(Date.now() - 90 * 86400000).toISOString(),
    timeMax: untilIso || new Date(Date.now() + 730 * 86400000).toISOString(),
    singleEvents: 'false',
    maxResults: '2500'
  });
  const res = await authedFetch(conn, `${CALENDAR_API}/calendars/${encodeURIComponent(conn.calendar_id)}/events?${params}`, {}, onTokenRefreshed);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Google-Termine konnten nicht geladen werden.');
  return (data.items || []).filter((e) => e.status !== 'cancelled' && !e.recurringEventId).map((e) => ({
    uid: e.id,
    title: e.summary || '',
    description: e.description || '',
    location: e.location || '',
    startAt: googleDateToIso(e.start),
    endAt: googleDateToIso(e.end),
    allDay: !!(e.start && e.start.date),
    recurrenceRule: recurrence.googleRecurrenceToModelJson(e.recurrence)
  }));
}

async function pushEvent(conn, event, onTokenRefreshed) {
  const body = {
    summary: event.title,
    description: event.description || '',
    location: event.location || '',
    start: isoToGoogleDate(event.startAt, event.allDay),
    end: isoToGoogleDate(event.endAt || event.startAt, event.allDay)
  };
  // Externe Erinnerung (Nutzerwunsch): App-reminderAt -> Google-Popup X Min vor Start (Google
  // deckelt Overrides bei 40320 Min = 4 Wochen); leer -> keine Erinnerung.
  if (event.reminderMinutes != null) body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: Math.min(40320, event.reminderMinutes) }] };
  else body.reminders = { useDefault: false, overrides: [] };
  // Serientermin: RRULE als recurrence-Array mitgeben (Google erwartet genau dieses Format).
  const rec = recurrence.modelToGoogleRecurrence(event.recurrenceRule, event.allDay);
  if (rec) body.recurrence = rec;
  const isUpdate = !!event.uid;
  const url = isUpdate ? `${CALENDAR_API}/calendars/${encodeURIComponent(conn.calendar_id)}/events/${encodeURIComponent(event.uid)}` : `${CALENDAR_API}/calendars/${encodeURIComponent(conn.calendar_id)}/events`;
  const res = await authedFetch(conn, url, { method: isUpdate ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, onTokenRefreshed);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Termin konnte nicht auf Google gespeichert werden.');
  return { uid: data.id };
}

async function deleteRemoteEvent(conn, uid, onTokenRefreshed) {
  if (!uid) return;
  await authedFetch(conn, `${CALENDAR_API}/calendars/${encodeURIComponent(conn.calendar_id)}/events/${encodeURIComponent(uid)}`, { method: 'DELETE' }, onTokenRefreshed);
}

async function fetchTodos(conn, onTokenRefreshed) {
  const res = await authedFetch(conn, `${TASKS_API}/lists/${encodeURIComponent(conn.task_list_id)}/tasks?showCompleted=true&showHidden=true`, {}, onTokenRefreshed);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Google-Aufgaben konnten nicht geladen werden.');
  return (data.items || []).map((t) => ({
    uid: t.id,
    title: t.title || '',
    description: t.notes || '',
    dueAt: t.due ? t.due.replace(/Z$/, '') : '',
    done: t.status === 'completed',
    priority: 'normal'
  }));
}

async function pushTodo(conn, todo, onTokenRefreshed) {
  const body = { title: todo.title, notes: todo.description || '', status: todo.done ? 'completed' : 'needsAction' };
  if (todo.dueAt) body.due = /Z$/.test(todo.dueAt) ? todo.dueAt : `${todo.dueAt}Z`;
  const isUpdate = !!todo.uid;
  const url = isUpdate ? `${TASKS_API}/lists/${encodeURIComponent(conn.task_list_id)}/tasks/${encodeURIComponent(todo.uid)}` : `${TASKS_API}/lists/${encodeURIComponent(conn.task_list_id)}/tasks`;
  const res = await authedFetch(conn, url, { method: isUpdate ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, onTokenRefreshed);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Aufgabe konnte nicht auf Google gespeichert werden.');
  return { uid: data.id };
}

async function deleteRemoteTodo(conn, uid, onTokenRefreshed) {
  if (!uid) return;
  await authedFetch(conn, `${TASKS_API}/lists/${encodeURIComponent(conn.task_list_id)}/tasks/${encodeURIComponent(uid)}`, { method: 'DELETE' }, onTokenRefreshed);
}

// ===== Google-Kontakte (People API, Nutzerwunsch: Online-Kontakte-Sync) =====
// Google kennt (anders als CardDAV) kein "mehrere Adressbücher" - es gibt EINE Kontaktsammlung
// (people/me/connections) plus optionale Gruppen (Labels). Wir behandeln die Sammlung als ein
// Adressbuch mit remoteId='connections'.
async function listAddressbooks() {
  return [{ remoteId: 'connections', name: 'Google Kontakte', color: '' }];
}

function googlePersonToContact(p) {
  const first = (arr, pred) => (Array.isArray(arr) ? (pred ? arr.find(pred) || arr[0] : arr[0]) : null) || {};
  const nm = first(p.names), org = first(p.organizations), adr = first(p.addresses), em = first(p.emailAddresses);
  const phones = Array.isArray(p.phoneNumbers) ? p.phoneNumbers : [];
  const byType = (t) => (phones.find((x) => String(x.type || x.formattedType || '').toLowerCase().includes(t)) || {}).value || '';
  const otherPhone = (phones.find((x) => !/mobile|cell|fax/i.test(String(x.type || x.formattedType || ''))) || {}).value || '';
  return {
    uid: String(p.resourceName || '').replace(/^people\//, ''),
    firstName: nm.givenName || '', lastName: nm.familyName || '', title: nm.honorificPrefix || '',
    institution: org.name || '', role: org.title || '',
    email: em.value || '', mobile: byType('mobile') || byType('cell'), fax: byType('fax'), phone: otherPhone,
    street: adr.streetAddress || '', city: adr.city || '', postal: adr.postalCode || '', country: adr.country || '',
    note: (Array.isArray(p.biographies) && p.biographies[0] && p.biographies[0].value) || '', status: 'aktiv'
  };
}

/* Gleiche Konstellation wie beim Microsoft-Adapter (s. contactsAccessDeniedError dort): der
   contacts-Scope kam nachträglich in SCOPES, der Refresh liefert bewusst nur die einst erteilten
   Rechte → People antwortet 403 PERMISSION_DENIED, bis die Verbindung neu autorisiert wurde. */
function contactsAccessDeniedError() {
  return new Error('Die Google-Zustimmung umfasst die Kontakte-Rechte noch nicht. Bitte die Google-Verbindung unter Kalender, Aufgaben & Kontakte über „Neu verbinden" erneut autorisieren – Kalender und Aufgaben laufen davon unberührt weiter.');
}
async function fetchContacts(conn, _addressbookRef, onTokenRefreshed) {
  const out = [];
  let pageToken = '';
  const fields = 'names,emailAddresses,phoneNumbers,addresses,organizations,biographies,metadata';
  do {
    const url = `${PEOPLE_API}/people/me/connections?personFields=${fields}&pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await authedFetch(conn, url, {}, onTokenRefreshed);
    const data = await res.json();
    if (res.status === 403) throw contactsAccessDeniedError();
    if (!res.ok) throw new Error(data.error?.message || 'Google-Kontakte konnten nicht geladen werden.');
    for (const p of (data.connections || [])) { const c = googlePersonToContact(p); if (c.uid) out.push(c); }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

// Rückrichtung für den Export (Nutzerwunsch „Kontakte exportieren (in Online-Konto)"): PURE Funktion
// (ohne Netz testbar), Spiegel von googlePersonToContact – die Telefon-Typen (mobile/main/workFax)
// sind so gewählt, dass byType() sie beim Wieder-Import denselben Feldern zuordnet.
function contactToGooglePayload(c) {
  c = c || {};
  const p = {};
  if ([c.firstName, c.lastName, c.title].some((v) => String(v || '').trim())) p.names = [{ givenName: c.firstName || '', familyName: c.lastName || '', honorificPrefix: c.title || '' }];
  if ([c.institution, c.role].some((v) => String(v || '').trim())) p.organizations = [{ name: c.institution || '', title: c.role || '' }];
  if (String(c.email || '').trim()) p.emailAddresses = [{ value: c.email }];
  const phones = [];
  if (String(c.mobile || '').trim()) phones.push({ value: c.mobile, type: 'mobile' });
  if (String(c.phone || '').trim()) phones.push({ value: c.phone, type: 'main' });
  if (String(c.fax || '').trim()) phones.push({ value: c.fax, type: 'workFax' });
  if (phones.length) p.phoneNumbers = phones;
  // Straße + getrennte Hausnummer/-buchstabe (Fall-Kontakte) zusammensetzen - People kennt nur EIN Straßenfeld.
  const streetFull = [c.street, [c.house, c.houseLetter].filter(Boolean).join('')].filter((v) => String(v || '').trim()).join(' ');
  if ([streetFull, c.city, c.postal, c.country].some((v) => String(v || '').trim())) p.addresses = [{ streetAddress: streetFull, city: c.city || '', postalCode: c.postal || '', country: c.country || '' }];
  if (String(c.note || '').trim()) p.biographies = [{ value: c.note }];
  return p;
}
// Kontakt bei Google anlegen (People API people:createContact). Google kennt für Kontakte nur den
// EINEN Bestand ('connections') – addressbookRef wird wie bei fetchContacts ignoriert.
// Rückgabe {uid} für die Rückverknüpfung mit dem Büro-Kontakt (Wiedererkennung beim Import).
async function pushContact(conn, _addressbookRef, contact, onTokenRefreshed) {
  const res = await authedFetch(conn, `${PEOPLE_API}/people:createContact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contactToGooglePayload(contact)) }, onTokenRefreshed);
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw contactsAccessDeniedError();
  if (!res.ok) throw new Error(data.error?.message || 'Kontakt konnte nicht zu Google exportiert werden.');
  return { uid: String(data.resourceName || '').replace(/^people\//, ''), href: '' };
}

module.exports = {
  getAuthUrl, exchangeCode, refreshAccessToken,
  listCalendars, listTaskLists,
  fetchEvents, pushEvent, deleteRemoteEvent,
  fetchTodos, pushTodo, deleteRemoteTodo,
  listAddressbooks, fetchContacts, pushContact,
  contactToGooglePayload, googlePersonToContact
};
