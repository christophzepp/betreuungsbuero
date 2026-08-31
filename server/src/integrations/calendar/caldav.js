// CalDAV-Client (Phase 7, Plan Abschnitt AB): Kalender + Aufgabenverwaltung, erste Sync-Anbindung
// bewusst auf Nextcloud beschraenkt (Nutzerentscheidung - App-Passwort statt vollem
// OAuth-Registrierungsprozess, den nur der Nutzer selbst haette anlegen koennen). Nextcloud
// spricht Standard-CalDAV (RFC 4791) - dieser Client ist daher nicht Nextcloud-spezifisch
// implementiert, nur die Admin-Panel-Anleitung geht von Nextclouds URL-Schema aus.
//
// Bewusster Scope fuer V1 (siehe Plan): keine RRULE-Expansion (wiederkehrende Termine werden nur
// als einzelnes Basis-Ereignis gespiegelt, nicht in Einzeltermine aufgeloest), keine
// Zeitzonen-Datenbank-Aufloesung fuer TZID-Parameter (naive lokale Zeit wird uebernommen). Beides
// waere ein eigenes, aehnlich umfangreiches Feature - fuer den realistischen Nutzungsfall dieser
// Software (Team-Kalender eines Betreuungsbueros) reicht die einfache Abbildung.

const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const recurrence = require('../../modules/calendar/recurrence');

const getConfigStmt = db.prepare('SELECT * FROM caldav_config WHERE id = 1');

function getCaldavConfig() {
  return getConfigStmt.get() || null;
}

function isConfigured(cfg) {
  return !!(cfg && cfg.username && cfg.password_encrypted && cfg.calendar_url);
}

function authHeader(cfg) {
  const pass = cryptoHelper.decrypt(cfg.password_encrypted);
  return 'Basic ' + Buffer.from(`${cfg.username}:${pass}`).toString('base64');
}

// ===== ICS (RFC 5545) - minimaler Parser/Serialisierer fuer genau die Felder, die diese Anwendung
// braucht (SUMMARY/DESCRIPTION/LOCATION/DTSTART/DTEND/DUE/COMPLETED/STATUS/PRIORITY/UID). =====

function unfoldIcsLines(text) {
  // Zeilen, die mit einem Leerzeichen/Tab beginnen, sind Fortsetzungen der vorherigen Zeile
  // (RFC 5545 Abschnitt 3.1 "Content Lines").
  const raw = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.trim()) {
      lines.push(line);
    }
  }
  return lines;
}

function unescapeIcsText(v) {
  return String(v || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function escapeIcsText(v) {
  return String(v || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// "20260709T090000Z" -> "2026-07-09T09:00:00Z", "20260709" (VALUE=DATE) -> "2026-07-09T00:00:00"
function icsDateToIso(value, isAllDay) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (isAllDay || /^\d{8}$/.test(v)) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return '';
    return `${m[1]}-${m[2]}-${m[3]}T00:00:00`;
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return '';
  const [, y, mo, d, h, mi, s, z] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`;
}

// Kehrt icsDateToIso um - Eingabe ist ein ISO-String (mit oder ohne "Z").
function isoToIcsDate(iso, allDay) {
  if (!iso) return '';
  const pad = (n) => String(n).padStart(2, '0');
  if (allDay) {
    // DATE-Werte (RFC 5545) haben keine Zeitzone - Y-M-D direkt aus dem String lesen statt ueber
    // ein Date-Objekt zu gehen, sonst verschiebt die lokale-zu-UTC-Umrechnung eines "Z"-losen
    // Zeitstempels das Datum je nach Server-Zeitzone um einen Tag (z.B. UTC-7 mitten in der Nacht).
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}${m[2]}${m[3]}`;
    return '';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const useUtc = /Z$/i.test(String(iso));
  const y = useUtc ? d.getUTCFullYear() : d.getFullYear();
  const mo = pad((useUtc ? d.getUTCMonth() : d.getMonth()) + 1);
  const day = pad(useUtc ? d.getUTCDate() : d.getDate());
  const h = pad(useUtc ? d.getUTCHours() : d.getHours());
  const mi = pad(useUtc ? d.getUTCMinutes() : d.getMinutes());
  const s = pad(useUtc ? d.getUTCSeconds() : d.getSeconds());
  return `${y}${mo}${day}T${h}${mi}${s}${useUtc ? 'Z' : ''}`;
}

// Parst ein komplettes ICS-Dokument (kann mehrere VEVENT/VTODO enthalten, z.B. bei
// calendar-multiget) in eine flache Liste von Komponenten.
function parseIcsComponents(text) {
  const lines = unfoldIcsLines(text);
  const components = [];
  let current = null;
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const rawName = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const [name, ...paramParts] = rawName.split(';');
    const upperName = name.toUpperCase();
    if (upperName === 'BEGIN' && (value === 'VEVENT' || value === 'VTODO')) {
      current = { type: value, props: {} };
      continue;
    }
    if (upperName === 'END' && (value === 'VEVENT' || value === 'VTODO')) {
      if (current) components.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const isAllDay = paramParts.some((p) => /^VALUE=DATE$/i.test(p));
    current.props[upperName] = { value, isAllDay };
  }
  return components;
}

function componentToEvent(comp) {
  const p = comp.props;
  const allDay = !!(p.DTSTART && p.DTSTART.isAllDay);
  return {
    uid: p.UID ? p.UID.value : '',
    title: unescapeIcsText(p.SUMMARY ? p.SUMMARY.value : ''),
    description: unescapeIcsText(p.DESCRIPTION ? p.DESCRIPTION.value : ''),
    location: unescapeIcsText(p.LOCATION ? p.LOCATION.value : ''),
    startAt: p.DTSTART ? icsDateToIso(p.DTSTART.value, allDay) : '',
    endAt: p.DTEND ? icsDateToIso(p.DTEND.value, allDay) : (p.DTSTART ? icsDateToIso(p.DTSTART.value, allDay) : ''),
    allDay,
    // Wiederholung (Serientermine) aus der RRULE lesen und ins App-Modell uebersetzen.
    recurrenceRule: p.RRULE ? recurrence.rruleToModelJson(p.RRULE.value) : ''
  };
}

function componentToTodo(comp) {
  const p = comp.props;
  const status = p.STATUS ? p.STATUS.value.toUpperCase() : '';
  return {
    uid: p.UID ? p.UID.value : '',
    title: unescapeIcsText(p.SUMMARY ? p.SUMMARY.value : ''),
    description: unescapeIcsText(p.DESCRIPTION ? p.DESCRIPTION.value : ''),
    dueAt: p.DUE ? icsDateToIso(p.DUE.value, p.DUE.isAllDay) : '',
    done: status === 'COMPLETED' || (p['PERCENT-COMPLETE'] && Number(p['PERCENT-COMPLETE'].value) >= 100),
    priority: p.PRIORITY ? icsPriorityToLabel(p.PRIORITY.value) : 'normal'
  };
}

function icsPriorityToLabel(v) {
  const n = Number(v);
  if (!n) return 'normal';
  if (n <= 4) return 'high';
  if (n >= 6) return 'low';
  return 'normal';
}
function labelToIcsPriority(label) {
  if (label === 'high') return 1;
  if (label === 'low') return 9;
  return 5;
}

function icsNow() {
  return isoToIcsDate(new Date().toISOString(), false);
}

function buildVevent({ uid, title, description, location, startAt, endAt, allDay, recurrenceRule, reminderMinutes }) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Betreuungsbuero-Dokumentenassistent//DE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsNow()}`,
    `SUMMARY:${escapeIcsText(title)}`
  ];
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  const dtstart = isoToIcsDate(startAt, allDay);
  lines.push(`DTSTART${allDay ? ';VALUE=DATE' : ''}:${dtstart}`);
  lines.push(`DTEND${allDay ? ';VALUE=DATE' : ''}:${isoToIcsDate(endAt || startAt, allDay)}`);
  // Serientermin: RRULE aus dem App-Modell erzeugen. UNTIL muss dieselbe Wertart tragen wie
  // DTSTART (siehe modelToRRule) - sonst weisen strenge Gegenstellen den Termin ab.
  const rrule = recurrence.modelToRRule(recurrenceRule, allDay ? 'date' : (/Z$/i.test(dtstart) ? 'utc' : 'floating'));
  if (rrule) lines.push(`RRULE:${rrule}`);
  // Externe Erinnerung (Nutzerwunsch): VALARM mit relativem Trigger (Minuten vor DTSTART).
  if (reminderMinutes != null) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${reminderMinutes > 0 ? '-PT' + reminderMinutes + 'M' : 'PT0M'}`, `DESCRIPTION:${escapeIcsText(title || 'Erinnerung')}`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function buildVtodo({ uid, title, description, dueAt, done, priority }) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Betreuungsbuero-Dokumentenassistent//DE',
    'BEGIN:VTODO',
    `UID:${uid}`,
    `DTSTAMP:${icsNow()}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `PRIORITY:${labelToIcsPriority(priority)}`,
    `STATUS:${done ? 'COMPLETED' : 'NEEDS-ACTION'}`
  ];
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  if (dueAt) lines.push(`DUE:${isoToIcsDate(dueAt, false)}`);
  if (done) lines.push(`PERCENT-COMPLETE:100`, `COMPLETED:${icsNow()}`);
  lines.push('END:VTODO', 'END:VCALENDAR');
  return lines.join('\r\n');
}

// ===== DAV-Transport =====

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });

async function davRequest(url, { method, headers, body }) {
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  return { status: res.status, ok: res.ok || res.status === 207, text };
}

function collectionOrigin(url) {
  try { return new URL(url).origin; } catch (_e) { return ''; }
}
function resolveHref(collectionUrl, href) {
  if (/^https?:\/\//i.test(href)) return href;
  return collectionOrigin(collectionUrl) + href;
}

async function testConnection(cfg, which) {
  const url = which === 'todo' ? cfg.todo_url : cfg.calendar_url;
  if (!url) return { ok: false, error: `${which === 'todo' ? 'Aufgaben' : 'Kalender'}-URL fehlt.` };
  try {
    const { status, ok, text } = await davRequest(url, {
      method: 'PROPFIND',
      headers: { Authorization: authHeader(cfg), Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>'
    });
    if (!ok) return { ok: false, error: `Server antwortete mit Status ${status}.` };
    let displayName = '';
    try {
      const parsed = xmlParser.parse(text);
      displayName = parsed?.multistatus?.response?.propstat?.prop?.displayname || '';
    } catch (_e) { /* Anzeigename optional - Verbindung ist trotzdem erfolgreich */ }
    return { ok: true, displayName: String(displayName || '') };
  } catch (error) {
    return { ok: false, error: error.message || 'Verbindung fehlgeschlagen.' };
  }
}

function asArray(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }

// calendar-query REPORT - fuer Termine auf einen Zeitraum eingeschraenkt (vermeidet, dass Jahre
// alter Kalenderverlauf mitgespiegelt wird), fuer Aufgaben ohne Zeitraum (VTODOs haben nicht immer
// ein DTSTART, ein Zeitfenster wuerde dort unvollstaendige Ergebnisse liefern).
async function fetchCollection(cfg, url, compName, timeRange) {
  const filterInner = timeRange
    ? `<C:comp-filter name="${compName}"><C:time-range start="${timeRange.start}" end="${timeRange.end}"/></C:comp-filter>`
    : `<C:comp-filter name="${compName}"/>`;
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR">${filterInner}</C:comp-filter></C:filter>
</C:calendar-query>`;
  const { status, ok, text } = await davRequest(url, {
    method: 'REPORT',
    headers: { Authorization: authHeader(cfg), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body
  });
  if (!ok) throw new Error(`CalDAV-Abfrage fehlgeschlagen (Status ${status}).`);
  const parsed = xmlParser.parse(text);
  const responses = asArray(parsed?.multistatus?.response);
  const items = [];
  for (const r of responses) {
    const href = r.href;
    const propstat = asArray(r.propstat).find((p) => String(p?.status || '').includes('200')) || asArray(r.propstat)[0];
    const etag = propstat?.prop?.getetag || '';
    const icsText = propstat?.prop?.['calendar-data'];
    if (!href || !icsText) continue;
    items.push({ href: resolveHref(url, href), etag: String(etag || ''), icsText: String(icsText) });
  }
  return items;
}

async function fetchEvents(cfg, { sinceIso, untilIso } = {}) {
  const start = isoToIcsDate(sinceIso || new Date(Date.now() - 90 * 86400000).toISOString(), false);
  const end = isoToIcsDate(untilIso || new Date(Date.now() + 730 * 86400000).toISOString(), false);
  const rows = await fetchCollection(cfg, cfg.calendar_url, 'VEVENT', { start, end });
  const out = [];
  for (const row of rows) {
    for (const comp of parseIcsComponents(row.icsText)) {
      if (comp.type !== 'VEVENT') continue;
      out.push({ ...componentToEvent(comp), href: row.href, etag: row.etag });
    }
  }
  return out;
}

async function fetchTodos(cfg) {
  const rows = await fetchCollection(cfg, cfg.todo_url, 'VTODO', null);
  const out = [];
  for (const row of rows) {
    for (const comp of parseIcsComponents(row.icsText)) {
      if (comp.type !== 'VTODO') continue;
      out.push({ ...componentToTodo(comp), href: row.href, etag: row.etag });
    }
  }
  return out;
}

async function pushEvent(cfg, event) {
  const uid = event.uid || crypto.randomUUID();
  const href = event.href || `${cfg.calendar_url.replace(/\/?$/, '/')}${uid}.ics`;
  const ics = buildVevent({ ...event, uid });
  const { status, ok } = await davRequest(href, {
    method: 'PUT',
    headers: { Authorization: authHeader(cfg), 'Content-Type': 'text/calendar; charset=utf-8' },
    body: ics
  });
  if (!ok) throw new Error(`Termin konnte nicht auf dem Server gespeichert werden (Status ${status}).`);
  return { uid, href };
}

async function pushTodo(cfg, todo) {
  const uid = todo.uid || crypto.randomUUID();
  const href = todo.href || `${cfg.todo_url.replace(/\/?$/, '/')}${uid}.ics`;
  const ics = buildVtodo({ ...todo, uid });
  const { status, ok } = await davRequest(href, {
    method: 'PUT',
    headers: { Authorization: authHeader(cfg), 'Content-Type': 'text/calendar; charset=utf-8' },
    body: ics
  });
  if (!ok) throw new Error(`Aufgabe konnte nicht auf dem Server gespeichert werden (Status ${status}).`);
  return { uid, href };
}

async function deleteRemote(cfg, href) {
  if (!href) return;
  await davRequest(href, { method: 'DELETE', headers: { Authorization: authHeader(cfg) } });
}

// ===== Kalender-Discovery (Nutzerwunsch: mehrere Kalender/Aufgabenlisten je Konto) =====
// Standard-CalDAV-Ermittlung (RFC 4791/6638): current-user-principal -> calendar-home-set ->
// Depth:1-Auflistung aller Sammlungen des Kontos mit Anzeigename, Farbe (Apple-Erweiterung) und
// unterstuetzten Komponenten (VEVENT = Terminkalender, VTODO = Aufgabenliste). Funktioniert fuer
// Nextcloud UND iCloud (beide sprechen Standard-CalDAV). Fallback: liegt kein Principal/Home vor,
// wird die Elternsammlung der konfigurierten calendar_url/todo_url auf Depth:1 gelesen.

function davValue(node) {
  if (node == null) return '';
  if (typeof node === 'object') return String(node['#text'] != null ? node['#text'] : '');
  return String(node);
}
function firstHref(node) {
  if (!node) return '';
  const h = node.href;
  return davValue(Array.isArray(h) ? h[0] : h);
}
function parentCollection(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/\/+$/, '').split('/');
    parts.pop();
    u.pathname = parts.join('/') + '/';
    return u.toString();
  } catch (_e) { return url; }
}
function normalizeColor(node) {
  let v = davValue(node).trim();
  if (!v) return '';
  if (v[0] !== '#') v = '#' + v;
  // Apple liefert #RRGGBBAA - auf #RRGGBB kuerzen; ungueltiges verwerfen.
  const m = v.match(/^#([0-9a-fA-F]{6})[0-9a-fA-F]{0,2}$/);
  return m ? ('#' + m[1].toLowerCase()) : '';
}

async function propfind(cfg, url, depth, propXml) {
  const { status, ok, text } = await davRequest(url, {
    method: 'PROPFIND',
    headers: { Authorization: authHeader(cfg), Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/"><D:prop>${propXml}</D:prop></D:propfind>`
  });
  if (!ok) throw new Error(`PROPFIND fehlgeschlagen (Status ${status}).`);
  return xmlParser.parse(text);
}
function propOf(response) {
  const propstat = asArray(response?.propstat).find((p) => String(p?.status || '').includes('200')) || asArray(response?.propstat)[0];
  return propstat?.prop || {};
}

// Ermittelt alle Kalender-/Aufgaben-Sammlungen eines CalDAV-Kontos.
// Rueckgabe: { calendars: [{remoteId, name, color}], taskLists: [{remoteId, name, color}] }
async function discoverCollections(cfg) {
  const startUrl = cfg.calendar_url || cfg.todo_url;
  if (!startUrl) throw new Error('Für dieses Konto ist keine CalDAV-URL hinterlegt.');
  let homeUrl = '';
  try {
    const pr = await propfind(cfg, startUrl, 0, '<D:current-user-principal/>');
    const principalHref = firstHref(propOf(asArray(pr?.multistatus?.response)[0])['current-user-principal']);
    if (principalHref) {
      const principalUrl = resolveHref(startUrl, principalHref);
      const hr = await propfind(cfg, principalUrl, 0, '<C:calendar-home-set/>');
      const homeHref = firstHref(propOf(asArray(hr?.multistatus?.response)[0])['calendar-home-set']);
      if (homeHref) homeUrl = resolveHref(startUrl, homeHref);
    }
  } catch (_e) { /* Principal/Home optional - Fallback greift */ }
  if (!homeUrl) homeUrl = parentCollection(startUrl);

  const listing = await propfind(cfg, homeUrl, 1,
    '<D:resourcetype/><D:displayname/><C:supported-calendar-component-set/><A:calendar-color/>');
  const responses = asArray(listing?.multistatus?.response);
  const calendars = [];
  const taskLists = [];
  const homePath = (() => { try { return new URL(homeUrl).pathname.replace(/\/+$/, ''); } catch (_e) { return ''; } })();
  for (const r of responses) {
    const href = davValue(r?.href);
    if (!href) continue;
    const prop = propOf(r);
    const rt = prop.resourcetype;
    const isCalendar = rt && typeof rt === 'object' && Object.prototype.hasOwnProperty.call(rt, 'calendar');
    if (!isCalendar) continue; // Home-Sammlung selbst + Nicht-Kalender (inbox/outbox/notifications) ueberspringen
    const url = resolveHref(homeUrl, href);
    // Home-Sammlung selbst nicht als Kalender auffuehren
    try { if (new URL(url).pathname.replace(/\/+$/, '') === homePath) continue; } catch (_e) { /* ignore */ }
    const name = davValue(prop.displayname);
    const color = normalizeColor(prop['calendar-color']);
    const comps = asArray(prop['supported-calendar-component-set']?.comp).map((c) => String(c?.['@_name'] || '').toUpperCase());
    const supportsEvent = comps.length === 0 || comps.includes('VEVENT');
    const supportsTodo = comps.length === 0 || comps.includes('VTODO');
    if (supportsEvent) calendars.push({ remoteId: url, name: name || 'Kalender', color });
    if (supportsTodo) taskLists.push({ remoteId: url, name: name || 'Aufgaben', color });
  }
  return { calendars, taskLists };
}

// ===== CardDAV-Kontakte (Nutzerwunsch: Online-Kontakte-Sync über dieselben Verbindungen) =====
// RFC 6352. addressbook-home-set -> Depth:1-Auflistung aller Adressbücher; addressbook-query REPORT
// liefert die VCARDs. Nutzt dieselben CalDAV-Zugangsdaten (Basic-Auth) wie Kalender/Aufgaben.
async function carddavPropfind(cfg, url, depth, propXml) {
  const { status, ok, text } = await davRequest(url, {
    method: 'PROPFIND',
    headers: { Authorization: authHeader(cfg), Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav" xmlns:A="http://apple.com/ns/ical/"><D:prop>${propXml}</D:prop></D:propfind>`
  });
  if (!ok) throw new Error(`CardDAV-PROPFIND fehlgeschlagen (Status ${status}).`);
  return xmlParser.parse(text);
}

// Ermittelt alle Adressbücher eines CardDAV-Kontos. Rückgabe: [{remoteId(url), name, color}].
async function discoverAddressbooks(cfg) {
  const startUrl = cfg.contacts_url || cfg.calendar_url || cfg.todo_url;
  if (!startUrl) throw new Error('Für dieses Konto ist keine CardDAV-/CalDAV-URL hinterlegt.');
  let homeUrl = '';
  try {
    const pr = await carddavPropfind(cfg, startUrl, 0, '<D:current-user-principal/>');
    const principalHref = firstHref(propOf(asArray(pr?.multistatus?.response)[0])['current-user-principal']);
    if (principalHref) {
      const principalUrl = resolveHref(startUrl, principalHref);
      const hr = await carddavPropfind(cfg, principalUrl, 0, '<CR:addressbook-home-set/>');
      const homeHref = firstHref(propOf(asArray(hr?.multistatus?.response)[0])['addressbook-home-set']);
      if (homeHref) homeUrl = resolveHref(startUrl, homeHref);
    }
  } catch (_e) { /* Principal/Home optional - Fallback greift */ }
  if (!homeUrl) homeUrl = parentCollection(startUrl);
  const listing = await carddavPropfind(cfg, homeUrl, 1, '<D:resourcetype/><D:displayname/><A:calendar-color/>');
  const responses = asArray(listing?.multistatus?.response);
  const books = [];
  const homePath = (() => { try { return new URL(homeUrl).pathname.replace(/\/+$/, ''); } catch (_e) { return ''; } })();
  for (const r of responses) {
    const href = davValue(r?.href);
    if (!href) continue;
    const prop = propOf(r);
    const rt = prop.resourcetype;
    const isBook = rt && typeof rt === 'object' && Object.prototype.hasOwnProperty.call(rt, 'addressbook');
    if (!isBook) continue; // Home-Sammlung + Nicht-Adressbücher überspringen
    const url = resolveHref(homeUrl, href);
    try { if (new URL(url).pathname.replace(/\/+$/, '') === homePath) continue; } catch (_e) { /* ignore */ }
    books.push({ remoteId: url, name: davValue(prop.displayname) || 'Adressbuch', color: normalizeColor(prop['calendar-color']) });
  }
  return books;
}

function vcardUnescape(v) { return String(v || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }

// Minimaler, toleranter VCARD-Parser (RFC 6350) -> Kontaktobjekt in der Feldstruktur des Adressbuchs.
function parseVcard(text) {
  const raw = String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); // Fortsetzungszeilen entfalten
  const lines = raw.split('\n');
  const c = { firstName: '', lastName: '', title: '', institution: '', role: '', email: '', phone: '', mobile: '', fax: '', street: '', house: '', postal: '', city: '', country: '', uid: '', note: '', status: 'aktiv' };
  let hasN = false, fn = '';
  for (const line of lines) {
    const idx = line.indexOf(':'); if (idx < 0) continue;
    const left = line.slice(0, idx), value = line.slice(idx + 1);
    const parts = left.split(';');
    const name = String(parts[0].split('.').pop() || '').toUpperCase(); // "item1.EMAIL" -> EMAIL
    const paramStr = parts.slice(1).join(';').toUpperCase();
    if (name === 'UID') c.uid = vcardUnescape(value).replace(/^urn:uuid:/i, '').trim();
    else if (name === 'FN') fn = vcardUnescape(value);
    else if (name === 'N') { const n = value.split(';'); c.lastName = vcardUnescape(n[0] || ''); c.firstName = vcardUnescape(n[1] || ''); c.title = vcardUnescape(n[3] || ''); hasN = true; }
    else if (name === 'ORG') c.institution = vcardUnescape(value.split(';')[0] || '');
    else if (name === 'TITLE') c.role = vcardUnescape(value);
    else if (name === 'EMAIL') { if (!c.email) c.email = vcardUnescape(value).trim(); }
    else if (name === 'TEL') { const v = vcardUnescape(value).trim(); if (/CELL|MOBILE/.test(paramStr)) { if (!c.mobile) c.mobile = v; } else if (/FAX/.test(paramStr)) { if (!c.fax) c.fax = v; } else if (!c.phone) c.phone = v; }
    else if (name === 'ADR') { const a = value.split(';'); c.street = vcardUnescape(a[2] || ''); c.city = vcardUnescape(a[3] || ''); c.postal = vcardUnescape(a[5] || ''); c.country = vcardUnescape(a[6] || ''); }
    else if (name === 'NOTE') c.note = vcardUnescape(value);
  }
  if (!hasN && fn) { const p = fn.trim().split(/\s+/); if (p.length > 1) { c.firstName = p.slice(0, -1).join(' '); c.lastName = p.slice(-1).join(' '); } else if (!c.institution) c.institution = fn; }
  if (!c.uid) c.uid = 'fn:' + (fn || [c.lastName, c.firstName, c.email].filter(Boolean).join('|')); // Fallback-Schlüssel für Dedup
  return c;
}

// Lädt alle Kontakte eines CardDAV-Adressbuchs. Rückgabe: [{...contactFields, uid, href, etag}].
async function fetchVcards(cfg, url) {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<CR:addressbook-query xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
  <D:prop><D:getetag/><CR:address-data/></D:prop>
</CR:addressbook-query>`;
  const { status, ok, text } = await davRequest(url, {
    method: 'REPORT',
    headers: { Authorization: authHeader(cfg), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body
  });
  if (!ok) throw new Error(`CardDAV-Abfrage fehlgeschlagen (Status ${status}).`);
  const parsed = xmlParser.parse(text);
  const responses = asArray(parsed?.multistatus?.response);
  const out = [];
  for (const r of responses) {
    const href = r.href;
    const propstat = asArray(r.propstat).find((p) => String(p?.status || '').includes('200')) || asArray(r.propstat)[0];
    const etag = propstat?.prop?.getetag || '';
    const vcardText = propstat?.prop?.['address-data'];
    if (!href || !vcardText) continue;
    const c = parseVcard(String(vcardText));
    if (!c) continue;
    out.push({ ...c, href: resolveHref(url, href), etag: String(etag || '') });
  }
  return out;
}

function vcardEscape(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }

// Baut eine VCARD 3.0 aus einem Kontaktobjekt (für den Export lokaler Kontakte zum Online-Anbieter).
function buildVcard(contact, uid) {
  const c = contact || {};
  const id = uid || c.uid || crypto.randomUUID();
  const fn = [c.title, c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.institution || 'Kontakt';
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `UID:${vcardEscape(id)}`, `FN:${vcardEscape(fn)}`,
    `N:${vcardEscape(c.lastName)};${vcardEscape(c.firstName)};;${vcardEscape(c.title)};`];
  if (c.institution) lines.push(`ORG:${vcardEscape(c.institution)}`);
  if (c.role) lines.push(`TITLE:${vcardEscape(c.role)}`);
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(c.email)}`);
  if (c.phone) lines.push(`TEL;TYPE=WORK,VOICE:${vcardEscape(c.phone)}`);
  if (c.mobile) lines.push(`TEL;TYPE=CELL:${vcardEscape(c.mobile)}`);
  if (c.fax) lines.push(`TEL;TYPE=FAX:${vcardEscape(c.fax)}`);
  const street = [c.street, [c.house, c.houseLetter].filter(Boolean).join('')].filter(Boolean).join(' ').trim();
  if (street || c.postal || c.city) lines.push(`ADR;TYPE=WORK:;;${vcardEscape(street)};${vcardEscape(c.city)};;${vcardEscape(c.postal)};${vcardEscape(c.country)}`);
  if (c.note) lines.push(`NOTE:${vcardEscape(c.note)}`);
  lines.push('END:VCARD');
  return { uid: id, vcard: lines.join('\r\n') };
}

// Legt einen Kontakt als .vcf im CardDAV-Adressbuch an/aktualisiert ihn (PUT).
async function pushVcard(cfg, addressbookUrl, contact) {
  const { uid, vcard } = buildVcard(contact, contact && contact.uid);
  const href = (contact && contact.href) || `${String(addressbookUrl).replace(/\/?$/, '/')}${uid}.vcf`;
  const { status, ok } = await davRequest(href, {
    method: 'PUT',
    headers: { Authorization: authHeader(cfg), 'Content-Type': 'text/vcard; charset=utf-8' },
    body: vcard
  });
  if (!ok) throw new Error(`Kontakt konnte nicht im Adressbuch gespeichert werden (Status ${status}).`);
  return { uid, href };
}

module.exports = {
  getCaldavConfig, isConfigured, testConnection,
  fetchEvents, fetchTodos, pushEvent, pushTodo, deleteRemote,
  parseIcsComponents, componentToEvent, componentToTodo, icsDateToIso, isoToIcsDate,
  buildVevent, buildVtodo, discoverCollections,
  discoverAddressbooks, fetchVcards, parseVcard, buildVcard, pushVcard
};
