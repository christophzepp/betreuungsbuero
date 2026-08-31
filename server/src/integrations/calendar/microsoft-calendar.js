// Microsoft Graph (Outlook-Kalender + Microsoft To Do) OAuth-Adapter (Plan Abschnitt AE) - gleiche
// Rolle wie google-calendar.js, nur fuer Microsoft/Outlook. Nutzt die Microsoft-Identity-Platform
// v2.0 ("common"-Tenant-Endpunkt, deckt sowohl persoenliche Microsoft-Konten als auch Firmen-/
// Schul-Konten ab) und Microsoft Graph statt CalDAV, da Microsoft 365/Outlook.com kein offenes
// CalDAV mit App-Passwort anbietet - der Admin muss vorher selbst eine App-Registrierung im Azure-
// Portal anlegen (Client-ID/Secret).

const cryptoHelper = require('../../security/crypto');
const recurrence = require('../../modules/calendar/recurrence');

const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_API = 'https://graph.microsoft.com/v1.0';
// Mail.Send + Mail.ReadWrite ergänzt (Nutzerwunsch: Microsoft-Login auch für den Mailversand über
// Graph /me/sendMail nutzen). Bestehende Verbindungen müssen nach dieser Erweiterung EINMAL neu
// autorisiert werden (der refresh_token muss mit dem neuen Scope neu ausgestellt werden).
// Contacts.ReadWrite ergänzt (Nutzerwunsch: Online-Kontakte-Sync). Bestehende Verbindungen müssen
// nach dieser Erweiterung EINMAL neu autorisiert werden (refresh_token mit dem neuen Scope).
// MailboxSettings.ReadWrite: Abwesenheitsnotiz (Mail-Baustein R2). Gilt NUR fuer neue
// Autorisierungen - der Refresh bleibt bewusst scope-los (siehe Kommentar unten), Bestandsverbindungen
// muessen fuer die Abwesenheitsnotiz einmal neu "Verbinden".
const SCOPES = ['offline_access', 'Calendars.ReadWrite', 'Tasks.ReadWrite', 'Mail.Send', 'Mail.ReadWrite', 'Contacts.ReadWrite', 'MailboxSettings.ReadWrite'];

function getAuthUrl(conn, redirectUri, state) {
  const params = new URLSearchParams({
    client_id: conn.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: SCOPES.join(' '),
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
      grant_type: 'authorization_code',
      scope: SCOPES.join(' ')
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Microsoft-Autorisierung fehlgeschlagen.');
  return data; // { access_token, refresh_token, expires_in, ... }
}

/* WICHTIG: Beim Erneuern werden BEWUSST KEINE scopes mitgeschickt (wie im Google-Adapter, ~61).
   Microsoft gibt dann Tokens mit exakt den Rechten zurueck, die beim Verbinden erteilt wurden.
   Schickt man dagegen die AKTUELLE SCOPES-Liste mit und enthaelt sie ein Recht, das die bestehende
   Zustimmung nicht deckt, lehnt Azure die Erneuerung KOMPLETT ab (AADSTS70000) - dann faellt nicht
   nur das neue Feature aus, sondern auch Kalender und Aufgaben.
   Genau das ist passiert (gemeldeter Bug): Die Verbindung wurde am 13.07. autorisiert, spaeter kam
   'Contacts.ReadWrite' fuer den Kontakte-Sync in die SCOPES-Liste, und mit dem Server-Neustart am
   17.07. verlangte jede Erneuerung dieses Recht - das Token vom 13.07. hatte es nie. Ohne scope-
   Parameter laeuft Kalender/Aufgaben sofort wieder; fuer die Kontakte-Rechte muss der Nutzer die
   Verbindung einmal neu autorisieren ("Verbinden") - das meldet der Kontakte-Aufruf dann sauber,
   statt alles lahmzulegen. */
async function refreshAccessToken(conn) {
  const refreshToken = cryptoHelper.decrypt(conn.refresh_token_encrypted);
  if (!refreshToken) throw new Error('Keine Microsoft-Refresh-Token vorhanden - Verbindung muss neu autorisiert werden.');
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
  if (!res.ok) {
    const txt = String(data.error_description || data.error || '');
    // AADSTS70000/invalid_grant = Zustimmung deckt die angefragten Rechte nicht (oder wurde entzogen):
    // dem Nutzer den EINEN Schritt nennen, der hilft, statt den Azure-Rohtext stehen zu lassen.
    if (/AADSTS70000|invalid_grant|unauthorized|expired/i.test(txt)) {
      throw new Error('Die Microsoft-Zustimmung deckt die benötigten Rechte nicht mehr ab. Bitte die Verbindung einmal neu autorisieren ("Verbinden"). Ursprüngliche Meldung: ' + txt.slice(0, 200));
    }
    throw new Error(txt || 'Microsoft-Token konnte nicht erneuert werden.');
  }
  return data;
}

async function authedFetch(conn, url, options, onTokenRefreshed) {
  let accessToken = cryptoHelper.decrypt(conn.access_token_encrypted);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rawFetch = (token) => fetch(url, {
    ...options,
    headers: { ...(options?.headers || {}), Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' }
  });
  // Transiente Netzfehler ("fetch failed": Verbindungsabbruch/DNS/TLS) begrenzt wiederholen,
  // statt den ganzen Sync-Durchgang scheitern zu lassen.
  const doFetch = async (token) => {
    for (let net = 0; ; net++) {
      try { return await rawFetch(token); }
      catch (e) { if (net >= 2) throw e; await sleep((net + 1) * 2000); }
    }
  };
  let res = await doFetch(accessToken);
  if (res.status === 401) {
    const refreshed = await refreshAccessToken(conn);
    accessToken = refreshed.access_token;
    if (onTokenRefreshed) await onTokenRefreshed(refreshed);
    res = await doFetch(accessToken);
  }
  // Microsoft-Graph-Drosselung (429) bzw. kurzfristige Ueberlast (503 / "MailboxConcurrency limit"):
  // Retry-After beachten und begrenzt (max. 3x) mit Backoff erneut versuchen, statt sofort als Fehler
  // durchzureichen. Ohne dieses Handling schaukelt sich die Drosselung ueber die 60-s-Ticks auf.
  for (let attempt = 0; (res.status === 429 || res.status === 503) && attempt < 3; attempt++) {
    const ra = Number(res.headers.get('retry-after'));
    const waitSec = Number.isFinite(ra) && ra > 0 ? ra : Math.min(30, (attempt + 1) * 5);
    await sleep(Math.min(60000, waitSec * 1000));
    res = await doFetch(accessToken);
  }
  return res;
}

async function listCalendars(conn, onTokenRefreshed) {
  const res = await authedFetch(conn, `${GRAPH_API}/me/calendars`, {}, onTokenRefreshed);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Kalenderliste konnte nicht geladen werden.');
  // hexColor (z. B. "#..."; leer bei color:"auto") fuer den Farbpunkt in der Ansicht.
  return (data.value || []).map((c) => ({ id: c.id, name: c.name || c.id, color: c.hexColor || '' }));
}

async function listTaskLists(conn, onTokenRefreshed) {
  const res = await authedFetch(conn, `${GRAPH_API}/me/todo/lists`, {}, onTokenRefreshed);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Aufgabenlisten konnten nicht geladen werden.');
  return (data.value || []).map((l) => ({ id: l.id, name: l.displayName || l.id }));
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function graphDateToIso(dt, isAllDay) {
  if (!dt) return '';
  if (isAllDay) {
    const m = String(dt.dateTime || '').match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? `${m[1]}T00:00:00` : '';
  }
  // Prefer: outlook.timezone="UTC" macht dateTime UTC, aber ohne "Z"-Suffix.
  const raw = String(dt.dateTime || '');
  return /Z$/.test(raw) ? raw : `${raw}Z`;
}

async function fetchEvents(conn, onTokenRefreshed) {
  // Bewusst /events (Serien-Master) statt /calendarView (expandiert Serien in Einzeltermine): so
  // kommt ein hier angelegter Serientermin als EIN Master mit recurrence-Objekt (gleiche ID) zurueck.
  // Graph liefert ueber /events nur seriesMaster + singleInstance (keine 'occurrence'/'exception'),
  // daher entfaellt das Zeitfenster von calendarView - stattdessen die neuesten 250 (nach $orderby).
  const params = new URLSearchParams({ $top: '250', $orderby: 'lastModifiedDateTime desc' });
  const res = await authedFetch(conn, `${GRAPH_API}/me/calendars/${encodeURIComponent(conn.calendar_id)}/events?${params}`, {}, onTokenRefreshed);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Outlook-Termine konnten nicht geladen werden.');
  return (data.value || []).filter((e) => e.type !== 'occurrence' && e.type !== 'exception').map((e) => ({
    uid: e.id,
    title: e.subject || '',
    description: stripHtml(e.body?.content),
    location: e.location?.displayName || '',
    startAt: graphDateToIso(e.start, e.isAllDay),
    endAt: graphDateToIso(e.end, e.isAllDay),
    allDay: !!e.isAllDay,
    recurrenceRule: recurrence.graphRecurrenceToModelJson(e.recurrence)
  }));
}

async function pushEvent(conn, event, onTokenRefreshed) {
  const body = {
    subject: event.title,
    body: { contentType: 'text', content: event.description || '' },
    location: { displayName: event.location || '' },
    isAllDay: !!event.allDay,
    start: { dateTime: event.startAt, timeZone: 'UTC' },
    end: { dateTime: event.endAt || event.startAt, timeZone: 'UTC' }
  };
  // Externe Erinnerung (Nutzerwunsch): App-reminderAt -> Outlook-eigene Erinnerung X Min vor Start;
  // null (keine Erinnerung) schaltet die Outlook-Erinnerung bewusst aus.
  if (event.reminderMinutes != null) { body.isReminderOn = true; body.reminderMinutesBeforeStart = event.reminderMinutes; }
  else { body.isReminderOn = false; }
  // Serientermin: Graph-recurrence-Objekt aus dem App-Modell (Muster + Bereich), abgeleitet aus dem
  // Startdatum (Wochentag/Monatstag). null = kein Serientermin.
  const rec = recurrence.modelToGraphRecurrence(event.recurrenceRule, event.startAt);
  if (rec) body.recurrence = rec;
  const isUpdate = !!event.uid;
  const url = isUpdate ? `${GRAPH_API}/me/events/${encodeURIComponent(event.uid)}` : `${GRAPH_API}/me/calendars/${encodeURIComponent(conn.calendar_id)}/events`;
  const res = await authedFetch(conn, url, { method: isUpdate ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, onTokenRefreshed);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Termin konnte nicht auf Outlook gespeichert werden.');
  return { uid: data.id };
}

async function deleteRemoteEvent(conn, uid, onTokenRefreshed) {
  if (!uid) return;
  await authedFetch(conn, `${GRAPH_API}/me/events/${encodeURIComponent(uid)}`, { method: 'DELETE' }, onTokenRefreshed);
}

async function fetchTodos(conn, onTokenRefreshed) {
  const res = await authedFetch(conn, `${GRAPH_API}/me/todo/lists/${encodeURIComponent(conn.task_list_id)}/tasks`, {}, onTokenRefreshed);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Outlook-Aufgaben konnten nicht geladen werden.');
  return (data.value || []).map((t) => ({
    uid: t.id,
    title: t.title || '',
    description: stripHtml(t.body?.content),
    dueAt: t.dueDateTime ? graphDateToIso(t.dueDateTime, false) : '',
    done: t.status === 'completed',
    priority: t.importance === 'high' ? 'high' : t.importance === 'low' ? 'low' : 'normal'
  }));
}

async function pushTodo(conn, todo, onTokenRefreshed) {
  const body = {
    title: todo.title,
    body: { contentType: 'text', content: todo.description || '' },
    status: todo.done ? 'completed' : 'notStarted',
    importance: todo.priority === 'high' ? 'high' : todo.priority === 'low' ? 'low' : 'normal'
  };
  if (todo.dueAt) body.dueDateTime = { dateTime: todo.dueAt, timeZone: 'UTC' };
  const isUpdate = !!todo.uid;
  const url = isUpdate ? `${GRAPH_API}/me/todo/lists/${encodeURIComponent(conn.task_list_id)}/tasks/${encodeURIComponent(todo.uid)}` : `${GRAPH_API}/me/todo/lists/${encodeURIComponent(conn.task_list_id)}/tasks`;
  const res = await authedFetch(conn, url, { method: isUpdate ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, onTokenRefreshed);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Aufgabe konnte nicht auf Outlook gespeichert werden.');
  return { uid: data.id };
}

async function deleteRemoteTodo(conn, uid, onTokenRefreshed) {
  if (!uid) return;
  await authedFetch(conn, `${GRAPH_API}/me/todo/lists/${encodeURIComponent(conn.task_list_id)}/tasks/${encodeURIComponent(uid)}`, { method: 'DELETE' }, onTokenRefreshed);
}

// ===== Microsoft-Kontakte (Graph /me/contacts, Nutzerwunsch: Online-Kontakte-Sync) =====
// Graph kennt Kontaktordner (/me/contactFolders) + den Standardordner (/me/contacts). Der
// Standardordner wird immer als "Kontakte" angeboten (remoteId=''), zusätzliche Ordner per ID.
async function listAddressbooks(conn, onTokenRefreshed) {
  const books = [{ remoteId: '', name: 'Kontakte (Standard)', color: '' }];
  try {
    const res = await authedFetch(conn, `${GRAPH_API}/me/contactFolders?$select=id,displayName`, {}, onTokenRefreshed);
    const data = await res.json();
    if (res.ok) for (const f of (data.value || [])) books.push({ remoteId: f.id, name: f.displayName || 'Ordner', color: '' });
  } catch (_e) { /* Standardordner reicht */ }
  return books;
}

function graphContactToContact(x) {
  const em = (Array.isArray(x.emailAddresses) && x.emailAddresses[0]) || {};
  const adr = x.businessAddress && (x.businessAddress.street || x.businessAddress.city) ? x.businessAddress : (x.homeAddress || {});
  return {
    uid: String(x.id || ''),
    firstName: x.givenName || '', lastName: x.surname || '', title: x.title || '',
    institution: x.companyName || '', role: x.jobTitle || '',
    email: em.address || '', mobile: x.mobilePhone || '',
    phone: (Array.isArray(x.businessPhones) && x.businessPhones[0]) || (Array.isArray(x.homePhones) && x.homePhones[0]) || '',
    fax: (Array.isArray(x.businessPhones) && x.businessPhones[1]) || '',
    street: adr.street || '', city: adr.city || '', postal: adr.postalCode || '', country: adr.countryOrRegion || '',
    note: x.personalNotes || '', status: 'aktiv'
  };
}

/* Graph antwortet mit 403 „Access is denied", wenn das Access-Token die Kontakte-Rechte nicht traegt -
   der Normalfall bei Verbindungen, die VOR der Aufnahme von Contacts.ReadWrite in SCOPES autorisiert
   wurden (der Refresh liefert seit dem AADSTS70000-Fix bewusst nur die damals erteilten Rechte).
   Der rohe Graph-Text („Check credentials and try again", Nutzerfund) fuehrt in die Irre - die
   Zugangsdaten stimmen ja. Deshalb hier die Meldung mit dem EINEN Loesungsschritt. */
function contactsAccessDeniedError() {
  return new Error('Die Microsoft-Zustimmung umfasst die Kontakte-Rechte noch nicht. Bitte die Outlook-Verbindung unter Kalender, Aufgaben & Kontakte über „Neu verbinden" erneut autorisieren – Kalender und Aufgaben laufen davon unberührt weiter.');
}
async function fetchContacts(conn, addressbookRef, onTokenRefreshed) {
  const base = addressbookRef ? `${GRAPH_API}/me/contactFolders/${encodeURIComponent(addressbookRef)}/contacts` : `${GRAPH_API}/me/contacts`;
  const out = [];
  let url = `${base}?$top=100`;
  while (url) {
    const res = await authedFetch(conn, url, {}, onTokenRefreshed);
    const data = await res.json();
    if (res.status === 403) throw contactsAccessDeniedError();
    if (!res.ok) throw new Error(data.error?.message || 'Microsoft-Kontakte konnten nicht geladen werden.');
    for (const x of (data.value || [])) { const c = graphContactToContact(x); if (c.uid) out.push(c); }
    url = data['@odata.nextLink'] || '';
  }
  return out;
}

// Rückrichtung für den Export (Nutzerwunsch „Kontakte exportieren (in Online-Konto)"): PURE Funktion
// (ohne Netz testbar), Spiegel von graphContactToContact – phone/fax landen wie beim Import-Lesen in
// businessPhones[0]/[1], die Anschrift in businessAddress (der Import bevorzugt genau diese).
function contactToGraphPayload(c) {
  c = c || {};
  const payload = {
    givenName: c.firstName || '', surname: c.lastName || '', title: c.title || '',
    companyName: c.institution || '', jobTitle: c.role || '',
    mobilePhone: c.mobile || '',
    businessPhones: [c.phone, c.fax].filter((x) => String(x || '').trim()),
    personalNotes: c.note || ''
  };
  if (String(c.email || '').trim()) payload.emailAddresses = [{ address: c.email, name: [c.firstName, c.lastName].filter(Boolean).join(' ') }];
  // Straße + getrennte Hausnummer/-buchstabe (Fall-Kontakte) zusammensetzen - Graph kennt nur EIN Straßenfeld.
  const street = [c.street, [c.house, c.houseLetter].filter(Boolean).join('')].filter((v) => String(v || '').trim()).join(' ');
  const adr = { street, city: c.city || '', postalCode: c.postal || '', countryOrRegion: c.country || '' };
  if (Object.values(adr).some((v) => String(v).trim())) payload.businessAddress = adr;
  return payload;
}
// Kontakt in Outlook anlegen. addressbookRef '' = Standardordner (/me/contacts), sonst der Ordner.
// Rückgabe {uid} = Graph-Kontakt-id – der Aufrufer verknüpft sie mit dem Büro-Kontakt, damit der
// nächste IMPORT den Kontakt wiedererkennt statt ihn erneut in die Import-Ablage zu legen.
async function pushContact(conn, addressbookRef, contact, onTokenRefreshed) {
  const base = addressbookRef ? `${GRAPH_API}/me/contactFolders/${encodeURIComponent(addressbookRef)}/contacts` : `${GRAPH_API}/me/contacts`;
  const res = await authedFetch(conn, base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contactToGraphPayload(contact)) }, onTokenRefreshed);
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw contactsAccessDeniedError();
  if (!res.ok) throw new Error(data.error?.message || 'Kontakt konnte nicht zu Outlook exportiert werden.');
  return { uid: String(data.id || ''), href: '' };
}

module.exports = {
  getAuthUrl, exchangeCode, refreshAccessToken,
  listCalendars, listTaskLists,
  fetchEvents, pushEvent, deleteRemoteEvent,
  fetchTodos, pushTodo, deleteRemoteTodo,
  listAddressbooks, fetchContacts, pushContact,
  contactToGraphPayload, graphContactToContact
};
