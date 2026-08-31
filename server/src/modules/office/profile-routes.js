// Buerostammdaten (Nutzerwunsch Runde 11): buero-weite Firmen-/Kontaktdaten, dynamisch im
// Briefkopf und der App-Marke (Sidebar-Logo, Login-Hero) genutzt. Lesen ist fuer JEDEN
// angemeldeten Nutzer erlaubt (jeder erzeugt Dokumente mit Briefkopf, siehe Client-OFFICE-Objekt).
// Schreiben braucht seit Nutzerwunsch Runde 11 Nachtrag Admin ODER das neue, einzeln vom Admin
// freigeschaltete can_manage_office_profile-Flag (requireOfficeProfileEdit, siehe auth.js) - der
// eigenstaendige Seitenleisten-Editor ist damit fuer delegierte Nutzer direkt nutzbar, ohne vollen
// Admin-Zugang zu benoetigen (gleiches Muster wie can_manage_mail_settings).
// Logo/Bild-Bytes liegen auf der Platte (gleiches Muster wie calendar-event-attachments/case-
// documents), NICHT als Base64 in der DB - kleinere DB-Datei, direktes Streaming beim Abruf.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_ROOT } = require('../../config/paths');
const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const { requireAuth, requireOfficeProfileEdit, hasPermission } = require('../../middleware/authentication');
const { logAction } = require('../../middleware/audit');
const { createModuleFiles } = require('../documents/module-files');
const moduleFiles = createModuleFiles({ db, documents: require('../documents/routes').intern });
const financeIntern = require('../finance/routes').intern;
const invoiceIntern = require('../finance/invoice-routes').intern;
const mileageIntern = require('../finance/mileage-routes').intern;

// Nur lesender Altbestands-Fallback; neue Logos werden zentral als doc_files gespeichert.
const LOGO_DIR = path.join(DATA_ROOT, 'office-logo');

const router = express.Router();

const getProfileStmt = db.prepare('SELECT * FROM office_profile WHERE id = 1');
const upsertProfileStmt = db.prepare(`
  INSERT INTO office_profile (
    id, company_name, salutation, first_name, last_name, academic_degree, street, postal_code, city, country,
    phone, mobile, email, fax, website, tax_number, vat_id
  ) VALUES (
    1, @companyName, @salutation, @firstName, @lastName, @academicDegree, @street, @postalCode, @city, @country,
    @phone, @mobile, @email, @fax, @website, @taxNumber, @vatId
  )
  ON CONFLICT(id) DO UPDATE SET
    company_name = excluded.company_name, salutation = excluded.salutation,
    first_name = excluded.first_name, last_name = excluded.last_name, academic_degree = excluded.academic_degree, street = excluded.street,
    postal_code = excluded.postal_code, city = excluded.city, country = excluded.country,
    phone = excluded.phone, mobile = excluded.mobile, email = excluded.email, fax = excluded.fax,
    website = excluded.website, tax_number = excluded.tax_number, vat_id = excluded.vat_id,
    updated_at = datetime('now')
`);
const setLogoStmt = db.prepare(`
  INSERT INTO office_profile (id, logo_filename, logo_mime_type) VALUES (1, @filename, @mimeType)
  ON CONFLICT(id) DO UPDATE SET logo_filename = excluded.logo_filename, logo_mime_type = excluded.logo_mime_type, updated_at = datetime('now')
`);

function publicProfile(row) {
  return {
    companyName: row?.company_name || '', salutation: row?.salutation || '',
    firstName: row?.first_name || '', lastName: row?.last_name || '', academicDegree: row?.academic_degree || '',
    street: row?.street || '', postalCode: row?.postal_code || '', city: row?.city || '', country: row?.country || '',
    phone: row?.phone || '', mobile: row?.mobile || '', email: row?.email || '', fax: row?.fax || '',
    website: row?.website || '', taxNumber: row?.tax_number || '', vatId: row?.vat_id || '',
    hasLogo: !!row?.logo_filename,
    updatedAt: row?.updated_at || null
  };
}

function profileBody() {
  return { profile: publicProfile(getProfileStmt.get()) };
}

/*
 * Sieben stabile Büro-Lesezugriffe in einer Antwort. Die zeitabhängige
 * Betreuungsübersicht bleibt absichtlich ihre eigene Route. Jeder Teil wird
 * durch dieselbe Lesefunktion wie seine Einzelroute erzeugt; es gibt weder
 * interne HTTP-/Express-Rekursion noch eine zweite Abbildungslogik.
 *
 * Finanzen und Ausgangsrechnungen besitzen unterschiedliche Rechte. Fehlt
 * eines davon, bleibt der übrige Abruf nutzbar und nur dieser Teil ist null.
 */
router.get('/load', requireAuth, (req, res) => {
  res.json({
    finance: hasPermission(req, 'canViewFinance') ? financeIntern.financeEntriesBody(req.session) : null,
    invoices: hasPermission(req, 'canViewCases') ? invoiceIntern.invoicesBody() : null,
    vehicles: mileageIntern.vehiclesBody(req),
    trips: mileageIntern.tripsBody(req),
    profile: profileBody(),
    bankAccounts: bankAccountsBody(),
    employees: employeesBody(req.session)
  });
});

router.get('/', requireAuth, (req, res) => {
  res.json(profileBody());
});

router.put('/', requireOfficeProfileEdit, (req, res) => {
  const b = req.body || {};
  upsertProfileStmt.run({
    companyName: (b.companyName || '').trim(), salutation: (b.salutation || '').trim(),
    firstName: (b.firstName || '').trim(), lastName: (b.lastName || '').trim(), academicDegree: (b.academicDegree || '').trim(),
    street: (b.street || '').trim(), postalCode: (b.postalCode || '').trim(), city: (b.city || '').trim(), country: (b.country || '').trim(),
    phone: (b.phone || '').trim(), mobile: (b.mobile || '').trim(), email: (b.email || '').trim(), fax: (b.fax || '').trim(),
    website: (b.website || '').trim(), taxNumber: (b.taxNumber || '').trim(), vatId: (b.vatId || '').trim()
  });
  logAction(req, 'office-profile.update', 'office-profile', 'default', { companyName: (b.companyName || '').trim() });
  res.json({ profile: publicProfile(getProfileStmt.get()) });
});

router.get('/logo', requireAuth, (req, res) => {
  const row = getProfileStmt.get();
  if (!row?.logo_filename) return res.status(404).json({ error: 'Kein Logo hinterlegt.' });
  const central = moduleFiles.resolve('office-logo', 'default', '', false);
  const filePath = (central && central.filePath) || path.join(LOGO_DIR, row.logo_filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Logo-Datei nicht gefunden.' });
  res.setHeader('Content-Type', row.logo_mime_type || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(filePath).pipe(res);
});

router.post('/logo', requireOfficeProfileEdit, (req, res) => {
  const { filename, mimeType, dataBase64 } = req.body || {};
  if (!filename || !dataBase64) return res.status(400).json({ error: 'Dateiname und Inhalt erforderlich.' });
  if (!/^image\//.test(mimeType || '')) return res.status(400).json({ error: 'Nur Bilddateien sind als Logo erlaubt.' });
  let bytes;
  try { bytes = Buffer.from(dataBase64, 'base64'); } catch (_e) { return res.status(400).json({ error: 'Ungültige Dateidaten.' }); }
  if (bytes.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Logo darf höchstens 5 MB groß sein.' });
  const existing = getProfileStmt.get();
  let central;
  try {
    central = moduleFiles.replace({
      module: 'office-logo', ownerId: 'default', slot: '', filename,
      mimeType: mimeType || 'application/octet-stream', bytes,
      createdBy: req.session.userId, date: new Date().toISOString(), keepName: true
    });
  } catch (error) {
    return res.status(500).json({ error: 'Logo konnte nicht sicher im Dokumentenspeicher abgelegt werden: ' + (error.message || error) });
  }
  if (existing?.logo_filename) { try { fs.unlinkSync(path.join(LOGO_DIR, existing.logo_filename)); } catch (_e) { /* Legacy-Fallback */ } }
  setLogoStmt.run({ filename: central.name, mimeType: mimeType || 'application/octet-stream' });
  logAction(req, 'office-profile.logo-update', 'office-profile', 'default', { filename });
  res.json({ profile: publicProfile(getProfileStmt.get()) });
});

router.delete('/logo', requireOfficeProfileEdit, (req, res) => {
  const existing = getProfileStmt.get();
  moduleFiles.unlink('office-logo', 'default', '');
  if (existing?.logo_filename) { try { fs.unlinkSync(path.join(LOGO_DIR, existing.logo_filename)); } catch (_e) { /* ignore */ } }
  setLogoStmt.run({ filename: '', mimeType: '' });
  logAction(req, 'office-profile.logo-delete', 'office-profile', 'default', {});
  res.json({ profile: publicProfile(getProfileStmt.get()) });
});

// ===== Bankverbindungen (1:n) =====

const listBanksStmt = db.prepare('SELECT * FROM office_bank_accounts ORDER BY sort_order, created_at');
const insertBankStmt = db.prepare(`
  INSERT INTO office_bank_accounts (id, bank_name, iban, bic, account_holder, account_type, sort_order)
  VALUES (@id, @bankName, @iban, @bic, @accountHolder, @accountType, @sortOrder)
`);
const updateBankStmt = db.prepare(`
  UPDATE office_bank_accounts SET bank_name=@bankName, iban=@iban, bic=@bic, account_holder=@accountHolder,
    account_type=@accountType, sort_order=@sortOrder, updated_at=datetime('now') WHERE id=@id
`);
const deleteBankStmt = db.prepare('DELETE FROM office_bank_accounts WHERE id = ?');

function publicBank(row) {
  return { id: row.id, bankName: row.bank_name, iban: row.iban, bic: row.bic, accountHolder: row.account_holder, accountType: row.account_type || '', sortOrder: row.sort_order };
}

function bankAccountsBody() {
  return { bankAccounts: listBanksStmt.all().map(publicBank) };
}

router.get('/bank-accounts', requireAuth, (req, res) => {
  res.json(bankAccountsBody());
});
router.post('/bank-accounts', requireOfficeProfileEdit, (req, res) => {
  const b = req.body || {};
  const row = { id: crypto.randomUUID(), bankName: (b.bankName || '').trim(), iban: (b.iban || '').trim(), bic: (b.bic || '').trim(), accountHolder: (b.accountHolder || '').trim(), accountType: (b.accountType || '').trim(), sortOrder: Number(b.sortOrder) || 0 };
  insertBankStmt.run(row);
  logAction(req, 'office-profile.bank-account.create', 'office-bank-account', row.id, {});
  res.status(201).json({ bankAccount: publicBank({ ...row, bank_name: row.bankName, account_holder: row.accountHolder, account_type: row.accountType, sort_order: row.sortOrder }) });
});
router.put('/bank-accounts/:id', requireOfficeProfileEdit, (req, res) => {
  const existing = db.prepare('SELECT id FROM office_bank_accounts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Bankverbindung nicht gefunden.' });
  const b = req.body || {};
  updateBankStmt.run({ id: req.params.id, bankName: (b.bankName || '').trim(), iban: (b.iban || '').trim(), bic: (b.bic || '').trim(), accountHolder: (b.accountHolder || '').trim(), accountType: (b.accountType || '').trim(), sortOrder: Number(b.sortOrder) || 0 });
  logAction(req, 'office-profile.bank-account.update', 'office-bank-account', req.params.id, {});
  res.json({ bankAccount: publicBank(db.prepare('SELECT * FROM office_bank_accounts WHERE id = ?').get(req.params.id)) });
});
router.delete('/bank-accounts/:id', requireOfficeProfileEdit, (req, res) => {
  deleteBankStmt.run(req.params.id);
  logAction(req, 'office-profile.bank-account.delete', 'office-bank-account', req.params.id, {});
  res.json({ ok: true });
});

// ===== Mitarbeitende (1:n) =====
// Seit dem Personenregister (Etappe 1, 29.08.2026) ist diese Route eine SICHT auf `persons`:
// sie liefert die aktiven internen Personen OHNE Nutzerkonto in der alten employee-Form, damit
// alle bestehenden Leser (gatherPersons, Buero-Excel, QM, Fahrtenbuch lokal) unveraendert
// weiterlaufen. Geschrieben wird ins Register; die alte office_employees-Tabelle ist seit
// Etappe 4 (30.08.2026) geloescht. Loeschen DEAKTIVIERT die Person nur - ihre Kennung ist
// das Pseudonym der Gehaltsangaben und wird nie wiederverwendet.

const listEmployeesStmt = db.prepare(`SELECT * FROM persons
  WHERE user_id IS NULL AND art = 'intern' AND aktiv = 1
  ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`);
const getEmployeePersonStmt = db.prepare(`SELECT * FROM persons WHERE id = ? AND user_id IS NULL AND art = 'intern'`);
function employeeKennungKonflikt(kennung, eigeneId) {
  const k = String(kennung || '').trim();
  if (!k) return null;
  return db.prepare('SELECT id FROM persons WHERE kennung = ? COLLATE NOCASE AND id <> ?').get(k, eigeneId || '') || null;
}

// extra: Konto-/Rechte-Spalten aus dem Mitarbeitende-Blatt der Buero-Excel (siehe db.js-Kommentar
// zu extra_json) - beliebiges JSON-Objekt, unveraendert durchgereicht.
function parseExtra(raw) {
  try { const v = JSON.parse(raw || ''); return v && typeof v === 'object' ? v : null; } catch (_e) { return null; }
}
/* Bugjagd 30.08.2026: die Kennung ist das Gehalts-Pseudonym - Name + Kennung in EINER Antwort
   deanonymisieren jeden "Gehalt MA n"-Posten. Dieselbe Schranke wie /api/persons: Kennung nur
   fuer Admins und Traeger des Klarnamen-Rechts financePersonNames. Ohne Session (interne
   Server-Aufrufer, z. B. Sicherungen) bleibt die volle Sicht - Sicherungen sind Vollzugriff. */
function darfEmployeeKennung(session) {
  return !session || !!(session.isAdmin || session.canFinancePersonNames);
}
function publicEmployee(row, mitKennung) {
  return { id: row.id, firstName: row.first_name, lastName: row.last_name, role: row.funktion, email: row.email, phone: row.phone,
    ...(mitKennung !== false ? { maKennung: row.kennung || '' } : {}), istBetreuer: row.ist_betreuer === 1,
    sortOrder: 0, extra: parseExtra(row.extra_json) };
}

function employeesBody(session) {
  const mitKennung = darfEmployeeKennung(session);
  return { employees: listEmployeesStmt.all().map((r) => publicEmployee(r, mitKennung)) };
}

router.get('/employees', requireAuth, (req, res) => {
  res.json(employeesBody(req.session));
});
router.post('/employees', requireOfficeProfileEdit, (req, res) => {
  const b = req.body || {};
  const kennung = String(b.maKennung || '').trim();
  if (employeeKennungKonflikt(kennung, '')) {
    return res.status(409).json({ error: 'Die Kennung ist bereits vergeben. Kennungen werden nie doppelt oder erneut vergeben.' });
  }
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO persons (id, art, user_id, first_name, last_name, funktion, email, phone, kennung, extra_json, aktiv)
    VALUES (?, 'intern', NULL, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(id, (b.firstName || '').trim(), (b.lastName || '').trim(), (b.role || '').trim(),
      (b.email || '').trim(), (b.phone || '').trim(), kennung,
      b.extra && typeof b.extra === 'object' ? JSON.stringify(b.extra) : '');
  logAction(req, 'office-profile.employee.create', 'person', id, {});
  res.status(201).json({ employee: publicEmployee(db.prepare('SELECT * FROM persons WHERE id = ?').get(id), darfEmployeeKennung(req.session)) });
});
router.put('/employees/:id', requireOfficeProfileEdit, (req, res) => {
  const existing = getEmployeePersonStmt.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Mitarbeitende/r nicht gefunden.' });
  const b = req.body || {};
  const kennung = b.maKennung != null ? String(b.maKennung).trim() : existing.kennung;
  const istBetreuer = b.istBetreuer != null ? (b.istBetreuer ? 1 : 0) : (existing.ist_betreuer ? 1 : 0);
  if (employeeKennungKonflikt(kennung, existing.id)) {
    return res.status(409).json({ error: 'Die Kennung ist bereits vergeben. Kennungen werden nie doppelt oder erneut vergeben.' });
  }
  // extra nur ueberschreiben, wenn es der Request explizit mitschickt - der normale
  // Buerostammdaten-Editor kennt das Feld nicht und darf es nicht wegputzen.
  const extraJson = b.extra !== undefined ? (b.extra && typeof b.extra === 'object' ? JSON.stringify(b.extra) : '') : (existing.extra_json || '');
  db.prepare(`UPDATE persons SET first_name=?, last_name=?, funktion=?, email=?, phone=?, kennung=?,
      ist_betreuer=?, extra_json=?, updated_at=datetime('now') WHERE id=?`)
    .run(String(b.firstName != null ? b.firstName : existing.first_name).trim(),
      String(b.lastName != null ? b.lastName : existing.last_name).trim(),
      String(b.role != null ? b.role : existing.funktion).trim(),
      String(b.email != null ? b.email : existing.email).trim(),
      String(b.phone != null ? b.phone : existing.phone).trim(), kennung,
      istBetreuer, extraJson, existing.id);
  logAction(req, 'office-profile.employee.update', 'person', req.params.id, {});
  res.json({ employee: publicEmployee(db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id), darfEmployeeKennung(req.session)) });
});
router.delete('/employees/:id', requireOfficeProfileEdit, (req, res) => {
  /* Deaktivieren statt loeschen: die Kennung ist das Pseudonym der Gehaltsangaben und bleibt
     fuer immer belegt. Die Liste zeigt nur aktive - fuer den Aufrufer wirkt es wie entfernt. */
  db.prepare(`UPDATE persons SET aktiv = 0, updated_at = datetime('now') WHERE id = ? AND user_id IS NULL`).run(req.params.id);
  logAction(req, 'office-profile.employee.delete', 'person', req.params.id, {});
  res.json({ ok: true });
});

module.exports = router;
module.exports.intern = { profileBody, bankAccountsBody, employeesBody };
