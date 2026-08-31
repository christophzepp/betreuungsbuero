// Online-Kontakte-Synchronisation (Nutzerwunsch) - Dispatch-Schicht analog zu calendar-sync.js,
// aber für Adressbücher. CardDAV (Nextcloud/iCloud) über VCARD, Google über People API, Microsoft
// über Graph /me/contacts. Synchronisierte Kontakte landen in der Import-Ablage
// (office_contact_imports); von dort übernimmt der Nutzer sie bewusst in ein Adressbuch. So wird
// verhindert, dass eine fallspezifische Kontaktliste versehentlich vollläuft.
//
// Dedup-Regel (Nutzerwunsch): Ein Kontakt wird nur EINMAL synchronisiert, solange er im System ist.
// „Im System" = ein office_contacts- oder case_contacts-Datensatz trägt seine external_uid für diese
// Verbindung. Verschwindet er (gelöscht), wird er beim nächsten Sync wieder in die Ablage gelegt.

const crypto = require('crypto');
const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const caldav = require('../../integrations/calendar/caldav');
const googleCal = require('../../integrations/calendar/google-calendar');
const microsoftCal = require('../../integrations/calendar/microsoft-calendar');

const oauthAdapters = { google: googleCal, microsoft: microsoftCal };
function isCaldavProvider(p) { return p === 'nextcloud' || p === 'icloud'; }
function isOauthProvider(p) { return p === 'google' || p === 'microsoft'; }

// Verbindungen, die überhaupt Kontakte abgleichen sollen. wantAuto=true: nur die mit 'auto' (für den Timer).
function listContactConnections(wantAuto) {
  const rows = db.prepare("SELECT * FROM calendar_connections WHERE enabled = 1 AND contacts_sync_mode IS NOT NULL AND contacts_sync_mode != 'off'").all();
  return wantAuto ? rows.filter((c) => c.contacts_sync_mode === 'auto') : rows;
}

// Ausgewählte Adressbücher einer Verbindung (connection_calendars kind='contact', selected=1).
// Fallback (nichts entdeckt/ausgewählt): ein synthetisches Standard-Adressbuch (remote_id leer bzw.
// CalDAV-Collection-URL), damit der Sync auch ohne vorherige Discovery läuft.
function listSelectedAddressbooks(connectionId) {
  const rows = db.prepare("SELECT * FROM connection_calendars WHERE connection_id = ? AND kind = 'contact' AND selected = 1 ORDER BY position, name").all(connectionId);
  if (rows.length) return rows;
  const conn = db.prepare('SELECT * FROM calendar_connections WHERE id = ?').get(connectionId);
  if (!conn) return [];
  if (isCaldavProvider(conn.provider)) {
    const ref = conn.contacts_url || conn.calendar_url || conn.todo_url;
    return ref ? [{ id: '', connection_id: connectionId, kind: 'contact', remote_id: ref, name: 'Adressbuch', selected: 1 }] : [];
  }
  // OAuth: Standard-Adressbuch (Google: 'connections', Microsoft: '')
  return [{ id: '', connection_id: connectionId, kind: 'contact', remote_id: conn.provider === 'google' ? 'connections' : '', name: 'Kontakte', selected: 1 }];
}

function tokenRefreshPersister(connectionId) {
  return async (refreshed) => {
    db.prepare("UPDATE calendar_connections SET access_token_encrypted=?, token_expires_at=?, updated_at=datetime('now') WHERE id=?")
      .run(cryptoHelper.encrypt(refreshed.access_token || ''), new Date(Date.now() + (Number(refreshed.expires_in) || 3600) * 1000).toISOString(), connectionId);
  };
}

// Adressbücher einer Verbindung ermitteln (für die Auswahl-UI). Rückgabe: [{remoteId,name,color}].
async function discoverAddressbooks(conn) {
  if (isCaldavProvider(conn.provider)) return caldav.discoverAddressbooks(conn);
  if (isOauthProvider(conn.provider)) return oauthAdapters[conn.provider].listAddressbooks(conn, tokenRefreshPersister(conn.id));
  throw new Error('Kontaktsynchronisation wird für diesen Anbieter nicht unterstützt.');
}

// Kontakte eines Adressbuchs laden. Rückgabe: [{...contactFields, uid, href?, etag?}].
async function fetchContacts(conn, addressbookRef) {
  if (isCaldavProvider(conn.provider)) return caldav.fetchVcards(conn, addressbookRef);
  if (isOauthProvider(conn.provider)) return oauthAdapters[conn.provider].fetchContacts(conn, addressbookRef, tokenRefreshPersister(conn.id));
  return [];
}

// Einen (lokalen) Kontakt zum Online-Anbieter exportieren: CardDAV (VCARD-PUT), Microsoft
// (Graph-Create) und Google (People-Create). Rückgabe {uid, href} für die Rückverknüpfung.
async function pushContact(conn, addressbookRef, contact) {
  if (isCaldavProvider(conn.provider)) return caldav.pushVcard(conn, addressbookRef, contact);
  if (isOauthProvider(conn.provider) && typeof oauthAdapters[conn.provider]?.pushContact === 'function')
    return oauthAdapters[conn.provider].pushContact(conn, addressbookRef, contact, tokenRefreshPersister(conn.id));
  throw new Error('Der Kontakt-Export wird für diesen Anbieter nicht unterstützt.');
}

// ===== Feld-Zerlegung (Nutzerwunsch): Online-Konten liefern "Musterstraße 12a" in EINEM Feld und
// volle Telefonnummern - das Adressverzeichnis führt getrennte Felder (street/house/houseLetter,
// phoneArea/phoneNumber usw.). Zerlegung heuristisch beim ÜBERNEHMEN aus der Ablage; die
// zusammengesetzten Werte (phone/mobile/fax) bleiben parallel erhalten (Anzeige/Export nutzen sie).
function splitStreet(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // "Insel Silberau 1", "Hauptstr. 12a", "Am Markt 3-5" - Hausnummer(nbereich) am Ende, optional Buchstabe.
  const m = s.match(/^(.+?)[,\s]+(\d+(?:\s*[-/]\s*\d+)*)\s*([A-Za-z]?)$/);
  if (!m || !m[1]) return null;
  return { street: m[1].replace(/,+$/, '').trim(), house: m[2].replace(/\s+/g, ''), houseLetter: m[3] || '' };
}
function splitPhoneDe(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  s = s.replace(/^(\+49|0049)[\s\-/]*/, '0');
  // "(06131) 61720" bzw. "0(6131)61720" -> "06131 61720": Klammer-Vorwahl normalisieren, Trenner ERHALTEN.
  s = s.replace(/^0?\((0?[\d\s]+)\)[\s\-/]*/, (_m, g) => ((g.trim().startsWith('0') ? g : '0' + g).replace(/\s+/g, '')) + ' ');
  // Mit Trenner: "06131/61720", "06131 617 20", "06131-61720" - erster 0-Block ist die Vorwahl.
  let m = s.match(/^(0\d{1,5})[\s\-/]+([\d\s\-/]+)$/);
  if (m) return { area: m[1], number: m[2].replace(/[^\d]/g, '') };
  // Mobil ohne Trenner: 015xx (5-stellig) VOR 016x/017x (4-stellig) prüfen.
  m = s.match(/^(015\d{2})(\d{4,})$/) || s.match(/^(01[67]\d)(\d{4,})$/);
  if (m) return { area: m[1], number: m[2] };
  return null; // nicht zerlegbar (z. B. Festnetz ohne Trenner, ausländische Nummer) -> unangetastet lassen
}
// Kontakt-Datensatz aus der Import-Ablage in die getrennten Adressverzeichnis-Felder überführen.
// Greift NUR, wo die getrennten Felder noch leer sind - bereits strukturierte Daten bleiben unberührt.
function splitContactFields(data) {
  const c = { ...(data || {}) };
  if (!String(c.house || '').trim()) {
    const st = splitStreet(c.street);
    if (st) { c.street = st.street; c.house = st.house; if (st.houseLetter && !c.houseLetter) c.houseLetter = st.houseLetter; }
  }
  const tel = (full, areaKey, numKey, composedKey) => {
    if (String(c[areaKey] || '').trim() || String(c[numKey] || '').trim()) return;
    const p = splitPhoneDe(full);
    if (!p) return;
    c[areaKey] = p.area; c[numKey] = p.number;
    // Zusammengesetzt im Fall-/Büro-Format ("Vorwahl/Nummer") neu aufbauen - wie saveAddressbookContact.
    c[composedKey] = [p.area, p.number].filter(Boolean).join('/');
  };
  tel(c.phone, 'phoneArea', 'phoneNumber', 'phone');
  tel(c.mobile, 'mobileArea', 'mobileNumber', 'mobile');
  tel(c.fax, 'faxArea', 'faxNumber', 'fax');
  return c;
}

const impFind = db.prepare('SELECT id, status FROM office_contact_imports WHERE connection_id = ? AND addressbook_ref = ? AND external_uid = ?');
const impInsert = db.prepare(`INSERT INTO office_contact_imports (id, connection_id, addressbook_ref, external_uid, external_href, external_etag, data_json, status)
  VALUES (@id, @connectionId, @addressbookRef, @externalUid, @externalHref, @externalEtag, @dataJson, 'new')`);
const impUpdate = db.prepare("UPDATE office_contact_imports SET external_href=@externalHref, external_etag=@externalEtag, data_json=@dataJson, status='new', updated_at=datetime('now') WHERE id=@id");
const impMarkMoved = db.prepare("UPDATE office_contact_imports SET status='moved', updated_at=datetime('now') WHERE id=?");
const impDeleteStaleStmt = db.prepare("DELETE FROM office_contact_imports WHERE connection_id = ? AND addressbook_ref = ? AND status = 'new' AND external_uid NOT IN (SELECT value FROM json_each(?))");

// external_uids, die bereits als Büro- ODER Fallkontakt im System sind (für diese Verbindung).
function inSystemUids(connectionId) {
  const set = new Set();
  for (const r of db.prepare("SELECT external_uid FROM office_contacts WHERE connection_id = ? AND external_uid != ''").all(connectionId)) set.add(r.external_uid);
  for (const r of db.prepare("SELECT external_uid FROM case_contacts WHERE connection_id = ? AND external_uid != ''").all(connectionId)) set.add(r.external_uid);
  return set;
}

const syncOneBook = db.transaction((conn, book, remoteContacts) => {
  const inSys = inSystemUids(conn.id);
  const seen = [];
  let added = 0;
  for (const rc of remoteContacts) {
    const uid = String(rc.uid || '').trim();
    if (!uid) continue;
    seen.push(uid);
    const existing = impFind.get(conn.id, book.remote_id, uid);
    if (inSys.has(uid)) { // schon übernommen -> nicht (erneut) in die Ablage; evtl. Altzeile als übernommen markieren
      if (existing && existing.status === 'new') impMarkMoved.run(existing.id);
      continue;
    }
    const dataJson = JSON.stringify(rc);
    const payload = { connectionId: conn.id, addressbookRef: book.remote_id, externalUid: uid, externalHref: rc.href || '', externalEtag: rc.etag || '', dataJson };
    if (!existing) { impInsert.run({ id: crypto.randomUUID(), ...payload }); added++; }
    else if (existing.status === 'dismissed') { /* Nutzer hat verworfen -> respektieren */ }
    else { impUpdate.run({ id: existing.id, ...payload }); } // 'new' oder 'moved' (Ziel weg) -> aktualisieren/zurückholen
  }
  // Ablage-Einträge ('new') entfernen, deren Kontakt remote nicht mehr existiert.
  try { impDeleteStaleStmt.run(conn.id, book.remote_id, JSON.stringify(seen)); } catch (_e) { /* json_each optional */ }
  return added;
});

// Eine einzelne Verbindung abgleichen (auch auf Knopfdruck bei contacts_sync_mode='off').
// onlyRef (Nutzerwunsch „Kontakte importieren" mit Quell-Auswahl): NUR diese eine Liste abgleichen –
// auch wenn sie nicht angehakt ist, der ausdrückliche Knopfdruck erzwingt es. ACHTUNG: '' ist ein
// GÜLTIGES Ref (Microsofts Standardordner) – deshalb der undefined/null-Vergleich, kein Truthiness.
async function syncConnectionContacts(conn, onlyRef) {
  let books = listSelectedAddressbooks(conn.id);
  if (onlyRef !== undefined && onlyRef !== null) {
    const row = db.prepare("SELECT * FROM connection_calendars WHERE connection_id = ? AND kind = 'contact' AND remote_id = ?").get(conn.id, String(onlyRef));
    books = [row || { id: '', connection_id: conn.id, kind: 'contact', remote_id: String(onlyRef), name: '', selected: 1 }];
  }
  const errors = [];
  let added = 0;
  for (const book of books) {
    try {
      const remote = await fetchContacts(conn, book.remote_id);
      added += syncOneBook(conn, book, remote);
    } catch (error) {
      errors.push(`${conn.display_name || conn.provider}${book.name ? ' / ' + book.name : ''}: ${error.message}`);
    }
  }
  return { ran: true, errors, added };
}

async function syncContacts(userId, wantAuto) {
  const connections = listContactConnections(wantAuto);
  const errors = [];
  let added = 0;
  if (!connections.length) return { ran: false, errors, added };
  for (const conn of connections) {
    const r = await syncConnectionContacts(conn);
    added += r.added;
    errors.push(...r.errors);
  }
  return { ran: true, errors, added };
}

module.exports = {
  isCaldavProvider, isOauthProvider,
  listContactConnections, listSelectedAddressbooks,
  discoverAddressbooks, fetchContacts, pushContact,
  syncContacts, syncConnectionContacts, tokenRefreshPersister,
  splitContactFields
};
