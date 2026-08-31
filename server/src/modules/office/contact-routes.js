// Büroweite (fallübergreifende) Kontakte - geteiltes Büro-Adressbuch (Nutzerwunsch: mehr Flexibilität,
// gemeinsame Adressverzeichnis-JSON). Analog zu den Fall-Kontakten in routes/cases.js (ein JSON-Blob
// pro Kontakt), aber OHNE Fallbezug: diese Kontakte gehören dem Büro und sind für alle berechtigten
// Nutzer sichtbar. Ersetzt den bisher rein clientseitigen localStorage-Speicher der büro-eigenen
// Kontakte, damit sie geräte-/nutzerübergreifend geteilt werden.
// Kein Realtime-Broadcast: die WebSocket-Schicht ist fall-raum-scoped (ws.js) - es gibt keinen
// büroweiten Kanal; Clients laden die Büro-Liste beim Öffnen des Adressbuchs neu.

const express = require('express');
const crypto = require('crypto');
const db = require('../../database/index');
const { requireAuth, requireViewCases, requireEditCases } = require('../../middleware/authentication');
const contactsSync = require('../contacts/sync');

const router = express.Router();
router.use(requireAuth);
// Echtzeit (2026-07-19): erfolgreiche Schreiboperationen an alle Fenster/Nutzer melden.
router.use(require('./events').middleware('officeContacts'));

const listStmt = db.prepare('SELECT id, data_json FROM office_contacts ORDER BY created_at');
const getStmt = db.prepare('SELECT * FROM office_contacts WHERE id = ?');
const insertStmt = db.prepare('INSERT INTO office_contacts (id, data_json, updated_by) VALUES (@id, @dataJson, @userId)');
const updateStmt = db.prepare("UPDATE office_contacts SET data_json = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?");
const deleteStmt = db.prepare('DELETE FROM office_contacts WHERE id = ?');

// Liste aller büroweiten Kontakte (gleiches Sichtrecht wie Fall-Kontakte).
router.get('/', requireViewCases, (req, res) => {
  const contacts = listStmt.all().map((c) => ({ id: c.id, data: JSON.parse(c.data_json) }));
  res.json({ contacts });
});

// Neuen büroweiten Kontakt anlegen. data = opaker JSON-Blob (Schema client-seitig, wie Fall-Kontakte).
router.post('/', requireEditCases, (req, res) => {
  const id = crypto.randomUUID();
  const data = (req.body && req.body.data) || {};
  insertStmt.run({ id, dataJson: JSON.stringify(data), userId: req.session.userId });
  res.status(201).json({ id });
});

// Vollständig ersetzen (kein Patch/Merge - identisch zum Fall-Kontakt-Verhalten).
router.put('/:id', requireEditCases, (req, res) => {
  if (!getStmt.get(req.params.id)) return res.status(404).json({ error: 'Kontakt nicht gefunden.' });
  const data = (req.body && req.body.data) || {};
  updateStmt.run(JSON.stringify(data), req.session.userId, req.params.id);
  res.json({ ok: true });
});

// ===== Online-Kontakte-Sync: Import-Ablage (Nutzerwunsch) =====
// Synchronisierte Online-Kontakte landen in office_contact_imports und werden von hier bewusst in ein
// Adressbuch übernommen (Büro oder Fall) - so wird eine fallspezifische Liste nicht versehentlich
// vollgeknallt.
const impListStmt = db.prepare("SELECT * FROM office_contact_imports WHERE status = 'new' ORDER BY first_seen_at DESC");
const impListDismissedStmt = db.prepare("SELECT * FROM office_contact_imports WHERE status = 'dismissed' ORDER BY first_seen_at DESC");
const impGetStmt = db.prepare('SELECT * FROM office_contact_imports WHERE id = ?');
const impSetStatusStmt = db.prepare("UPDATE office_contact_imports SET status = ?, target_kind = ?, target_id = ?, updated_at = datetime('now') WHERE id = ?");
const ocInsertSrcStmt = db.prepare('INSERT INTO office_contacts (id, data_json, external_uid, connection_id, updated_by) VALUES (@id, @dataJson, @uid, @connId, @userId)');
const ccInsertSrcStmt = db.prepare('INSERT INTO case_contacts (id, case_id, data_json, external_uid, connection_id, updated_by) VALUES (@id, @caseId, @dataJson, @uid, @connId, @userId)');

// Inhalt der Import-Ablage. Standard: offene ('new'). ?status=dismissed liefert die VERWORFENEN -
// die bleiben beim Sync bewusst unangetastet (syncOneBook respektiert 'dismissed') und wären sonst
// unsichtbar/unerreichbar (Nutzerwunsch: einsehen + wiederherstellen können).
router.get('/imports', requireViewCases, (req, res) => {
  const stmt = req.query.status === 'dismissed' ? impListDismissedStmt : impListStmt;
  const imports = stmt.all().map((r) => ({
    id: r.id, connectionId: r.connection_id, addressbookRef: r.addressbook_ref, status: r.status,
    externalUid: r.external_uid, data: JSON.parse(r.data_json || '{}'), firstSeenAt: r.first_seen_at
  }));
  res.json({ imports });
});

/* Auswählbare Quellen/Ziele für die Import-Ablage (Nutzerwunsch: dort dieselben Möglichkeiten wie im
   Kalender-Dialog - Import, Export, Listenauswahl).
   BEWUSST HIER und nicht über /api/admin/calendar-connections: dessen Gate verlangt isAdmin ODER das
   Recht "Kalenderverbindungen verwalten" - die Ablage bedient aber jeder mit Fall-Bearbeitungsrecht
   (requireEditCases, wie alle Routen hier). Über die Admin-Route bekämen normale Nutzer 403.
   KEIN Netzzugriff: gelistet werden die BEREITS BEKANNTEN Listen (connection_calendars kind='contact',
   auch nicht angehakte). Kennt eine Verbindung noch keine, liefert listSelectedAddressbooks den
   Anbieter-Standard (MS '' / Google 'connections' / CalDAV-URL) - dieselbe Quelle, die der Sync nutzt,
   also ist die Auswahl nie leer. Anders als listContactConnections werden hier auch Verbindungen mit
   contacts_sync_mode='off' angeboten: der ausdrückliche Knopfdruck darf das überstimmen. */
router.get('/sources', requireViewCases, (req, res) => {
  const conns = db.prepare('SELECT * FROM calendar_connections WHERE enabled = 1').all()
    // Sichtbarkeit wie sonst: büroweite + eigene (persönliche fremder Nutzer bleiben verborgen).
    .filter((c) => c.owner_user_id == null || c.owner_user_id === req.session.userId || req.session.isAdmin)
    .filter((c) => contactsSync.isCaldavProvider(c.provider) || contactsSync.isOauthProvider(c.provider));
  const bookRows = db.prepare("SELECT * FROM connection_calendars WHERE connection_id = ? AND kind = 'contact' ORDER BY position, name");
  res.json({
    sources: conns.map((c) => {
      let books = bookRows.all(c.id);
      if (!books.length) books = contactsSync.listSelectedAddressbooks(c.id);
      return {
        connectionId: c.id,
        displayName: c.display_name || c.provider,
        provider: c.provider,
        contactsSyncMode: c.contacts_sync_mode || 'off',
        canExport: true,
        addressbooks: books.map((b) => ({ remoteId: b.remote_id, name: b.name || 'Kontakte', selected: !!b.selected }))
      };
    })
  });
});

/* Manuellen Kontakt-Abgleich anstoßen. OHNE body: alle aktivierten Verbindungen (wie bisher).
   MIT body.connectionId (+ optional body.addressbookRef): nur diese eine Quelle - auch wenn ihr
   contacts_sync_mode 'off' ist und die Liste nicht angehakt wurde (Knopfdruck erzwingt es).
   ACHTUNG: addressbookRef '' ist GÜLTIG (Microsofts Standardordner) → auf undefined/null prüfen. */
router.post('/imports/sync', requireEditCases, async (req, res) => {
  try {
    const connId = req.body && req.body.connectionId;
    if (connId) {
      const conn = db.prepare('SELECT * FROM calendar_connections WHERE id = ?').get(connId);
      if (!conn) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
      const ref = (req.body.addressbookRef !== undefined && req.body.addressbookRef !== null) ? String(req.body.addressbookRef) : undefined;
      const r = await contactsSync.syncConnectionContacts(conn, ref);
      return res.json({ ok: true, ran: r.ran, added: r.added, errors: r.errors });
    }
    const r = await contactsSync.syncContacts(req.session.userId, false);
    res.json({ ok: true, ran: r.ran, added: r.added, errors: r.errors });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Synchronisation fehlgeschlagen.' });
  }
});

// Einen Import in ein Adressbuch übernehmen. body.target = 'office' | 'case', body.caseId (bei 'case').
router.post('/imports/:id/move', requireEditCases, (req, res) => {
  const imp = impGetStmt.get(req.params.id);
  if (!imp) return res.status(404).json({ error: 'Import nicht gefunden.' });
  const target = (req.body && req.body.target) === 'case' ? 'case' : 'office';
  // Zusammengesetzte Online-Felder ("Musterstraße 12", volle Rufnummern) in die getrennten
  // Adressverzeichnis-Felder zerlegen (Nutzerwunsch) - erst HIER beim Übernehmen, damit die
  // Ablage/Dedup weiter mit den Originaldaten des Anbieters arbeitet.
  const data = contactsSync.splitContactFields(JSON.parse(imp.data_json || '{}'));
  const id = crypto.randomUUID();
  if (target === 'case') {
    const caseId = req.body && req.body.caseId;
    if (!caseId) return res.status(400).json({ error: 'Fall-ID fehlt.' });
    ccInsertSrcStmt.run({ id, caseId, dataJson: JSON.stringify(data), uid: imp.external_uid, connId: imp.connection_id, userId: req.session.userId });
  } else {
    ocInsertSrcStmt.run({ id, dataJson: JSON.stringify(data), uid: imp.external_uid, connId: imp.connection_id, userId: req.session.userId });
  }
  impSetStatusStmt.run('moved', target, id, imp.id);
  res.json({ ok: true, id, target });
});

// Einen Import verwerfen (bleibt verworfen, wird nicht erneut angeboten, solange remote unverändert).
router.post('/imports/:id/dismiss', requireEditCases, (req, res) => {
  const imp = impGetStmt.get(req.params.id);
  if (!imp) return res.status(404).json({ error: 'Import nicht gefunden.' });
  impSetStatusStmt.run('dismissed', '', '', imp.id);
  res.json({ ok: true });
});

// Einen VERWORFENEN Import wieder in die Ablage zurückholen (Nutzerwunsch: Verwerfen ist kein
// endgültiges Löschen - der Kontakt taucht sonst nie wieder auf, solange er remote existiert).
router.post('/imports/:id/restore', requireEditCases, (req, res) => {
  const imp = impGetStmt.get(req.params.id);
  if (!imp) return res.status(404).json({ error: 'Import nicht gefunden.' });
  if (imp.status !== 'dismissed') return res.status(400).json({ error: 'Nur verworfene Kontakte können wiederhergestellt werden.' });
  impSetStatusStmt.run('new', '', '', imp.id);
  res.json({ ok: true });
});

// Kontakte zu einem Online-Adressbuch exportieren (CardDAV, Microsoft/Graph, Google/People).
// body.connectionId, body.addressbookRef ('' = Standardliste, GÜLTIG - nie per Truthiness prüfen).
// QUELLE (Nutzerwunsch: nicht nur alle Büro-Kontakte, sondern einzelne Listen/Kontakte):
//   body.source = {kind:'office'} (Standard) | {kind:'case', caseId} - welches Adressbuch exportiert wird.
//   body.contactIds = IDs INNERHALB der Quelle (office_contacts- bzw. case_contacts-IDs);
//   ohne contactIds wird die ganze Quelle exportiert.
router.post('/export', requireEditCases, async (req, res) => {
  const { connectionId, addressbookRef, contactIds, source } = req.body || {};
  const conn = db.prepare('SELECT * FROM calendar_connections WHERE id = ?').get(connectionId);
  if (!conn) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  const kind = (source && source.kind) === 'case' ? 'case' : 'office';
  let rows; let linkStmt;
  if (kind === 'case') {
    const caseId = source && source.caseId;
    if (!caseId) return res.status(400).json({ error: 'Fall-ID fehlt.' });
    rows = db.prepare('SELECT * FROM case_contacts WHERE case_id = ?').all(caseId);
    linkStmt = db.prepare("UPDATE case_contacts SET connection_id=?, external_uid=?, updated_at=datetime('now') WHERE id=?");
  } else {
    rows = db.prepare('SELECT * FROM office_contacts').all();
    linkStmt = db.prepare("UPDATE office_contacts SET connection_id=?, external_uid=?, updated_at=datetime('now') WHERE id=?");
  }
  if (Array.isArray(contactIds)) {
    const want = new Set(contactIds.map(String));
    rows = rows.filter((r) => want.has(String(r.id)));
  }
  let exported = 0; let skipped = 0; const errors = [];
  for (const row of rows) {
    const data = JSON.parse(row.data_json || '{}');
    if (data.__merged) continue; // zusammengeführte Hülsen nicht exportieren
    // Bereits mit DIESEM Konto verknüpft (von dort importiert oder früher exportiert) → nicht erneut
    // anlegen, sonst entstünden drüben Dubletten bei jedem Klick.
    if (String(row.connection_id || '') === String(conn.id) && String(row.external_uid || '').trim()) { skipped++; continue; }
    try {
      const r = await contactsSync.pushContact(conn, addressbookRef || '', data);
      // Rückverknüpfung: der nächste IMPORT erkennt den Kontakt über (connection_id, external_uid)
      // als „schon im System" (inSystemUids) statt ihn erneut in die Import-Ablage zu legen.
      if (r && r.uid) linkStmt.run(String(conn.id), String(r.uid), row.id);
      exported++;
    } catch (e) { errors.push(e.message); }
  }
  res.json({ ok: true, exported, skipped, errors });
});

router.delete('/:id', requireEditCases, (req, res) => {
  if (!getStmt.get(req.params.id)) return res.status(404).json({ error: 'Kontakt nicht gefunden.' });
  deleteStmt.run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
