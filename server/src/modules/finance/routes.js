// Büroorganisation - Finanzen (Plan Abschnitt AL, Phase 3): büroweite laufende/einmalige
// Ausgaben und Einnahmen des Büro-Betriebs selbst - KEIN Fallbezug (siehe Architekturentscheidung
// im Plan). Eigene, von can_view_cases/can_edit_cases UNABHÄNGIGE Berechtigung, da Finanzen
// Klarnamen-Gehaltsdaten (Geschäftsgeheimnis) enthält (requireViewFinance/requireEditFinance,
// siehe auth.js). Summen/Bilanz werden bewusst NICHT gespeichert, sondern clientseitig live aus
// den geladenen Zeilen berechnet (wie im Original-Excel per SUM-Formel).
//
// Runde 9: Detailliste fuer die Buchhaltung - Kontoauszuege/Umsatzuebersichten und Belege werden
// hochgeladen, clientseitig geparst bzw. per Hybrid-OCR erkannt (gleiche Technik wie bei der
// bestehenden Rechnungslegung), aber ANDERS als dort serverseitig gespeichert (siehe db.js-
// Kommentar). Datei-Bytes liegen wie bei case_documents auf der Platte, nicht in SQLite.

const path = require('path');
const fs = require('fs');
const express = require('express');
const crypto = require('crypto');
const { DATA_ROOT } = require('../../config/paths');
const db = require('../../database/index');
const { requireAuth, requireViewFinance, requireEditFinance } = require('../../middleware/authentication');
const { createModuleFiles } = require('../documents/module-files');
const moduleFiles = createModuleFiles({ db, documents: require('../documents/routes').intern });

const router = express.Router();
router.use(requireAuth);
// Echtzeit (2026-07-19): erfolgreiche Schreiboperationen an alle Fenster/Nutzer melden.
router.use(require('../office/events').middleware('finance'));

const KINDS = ['ausgabe', 'einnahme'];
const FREQUENZEN = ['monatlich', 'jaehrlich', 'halbjaehrlich', 'einmalig'];
const KONTEN = ['geschaeftlich', 'privat'];

// sort_order zuerst (Handsortierung der Buero-Excel, siehe db.js-Kommentar) - Alt-Eintraege ohne
// Sortierwert (alle 0) behalten untereinander die bisherige alphabetische Ordnung.
const listStmt = db.prepare('SELECT * FROM finance_entries ORDER BY sort_order, kind, posten COLLATE NOCASE');
const getStmt = db.prepare('SELECT * FROM finance_entries WHERE id = ?');
const insertStmt = db.prepare(`
  INSERT INTO finance_entries (id, kind, posten, partner, frequenz, summe_gesamt, summe_monatlich, datum, konto, person_id, updated_by, sort_order)
  VALUES (@id, @kind, @posten, @partner, @frequenz, @summeGesamt, @summeMonatlich, @datum, @konto, @personId, @userId, @sortOrder)
`);
const updateStmt = db.prepare(`
  UPDATE finance_entries SET kind=@kind, posten=@posten, partner=@partner, frequenz=@frequenz,
    summe_gesamt=@summeGesamt, summe_monatlich=@summeMonatlich, datum=@datum, konto=@konto,
    person_id=@personId, updated_at=datetime('now'), updated_by=@userId
  WHERE id=@id
`);
const deleteStmt = db.prepare('DELETE FROM finance_entries WHERE id = ?');

/* Personen-Feld (Etappe 3, 29.08.2026): Personalkosten-Posten verweisen per person_id auf das
   Register. Aufgeloest wird JE BETRACHTER: mit dem Recht financePersonNames (Admins immer)
   kommen personId + personName + personKennung; OHNE das Recht kommt AUSSCHLIESSLICH die
   Kennung ("MA 1") - weder Name noch ID verlassen den Server, es gibt clientseitig nichts zu
   entschluesseln. Die Kennung ist das nie wiederverwendete Pseudonym der Person. */
function darfKlarnamen(session) {
  return !!(session && (session.isAdmin || session.canFinancePersonNames));
}
function personAufloeser(session) {
  const klar = darfKlarnamen(session);
  let karte = null;
  return (personId) => {
    if (!personId) return {};
    if (!karte) {
      karte = new Map(db.prepare('SELECT id, first_name, last_name, kennung FROM persons').all()
        .map((p) => [p.id, p]));
    }
    const p = karte.get(personId);
    const kennung = (p && p.kennung) || '';
    if (!klar) return { personKennung: kennung };
    return {
      personId,
      personKennung: kennung,
      personName: p ? [p.first_name, p.last_name].filter(Boolean).join(' ').trim() : '',
    };
  };
}

function publicEntry(row, aufloesen) {
  return {
    id: row.id,
    kind: row.kind,
    posten: row.posten,
    partner: row.partner,
    frequenz: row.frequenz,
    summeGesamt: row.summe_gesamt,
    summeMonatlich: row.summe_monatlich,
    datum: row.datum || '',
    konto: row.konto || 'geschaeftlich',
    updatedAt: row.updated_at,
    ...(aufloesen ? aufloesen(row.person_id || '') : {}),
  };
}

function financeEntriesBody(session) {
  const aufloesen = personAufloeser(session);
  return { entries: listStmt.all().map((row) => publicEntry(row, aufloesen)) };
}

/* Das Personen-Feld per personId setzen/aendern/entfernen verlangt selbst das Klarnamen-Recht:
   wer eine Zuordnung herstellt, kennt sie zwangslaeufig - ohne diese Schranke koennte jede
   Person mit Finanz-Bearbeitungsrecht die Pseudonyme per Probezuordnung entschluesseln.
   Bugjagd 30.08.2026, zwei Nachschaerfungen:
   1. Das Recht wird VOR dem Gleichheits-Kurzschluss geprueft. Vorher verriet die Antwort
      (200 bei "gleich", 403 bei "anders") einem Unberechtigten per Durchprobieren, WELCHE
      Person zugeordnet ist - ein Orakel, das die Pseudonymisierung aushebelte.
   2. Neuer Weg personKennung (OHNE Recht erlaubt): der Buero-Excel-Rundlauf traegt in
      Spalte G nur die Kennung. Sie serverseitig aufzuloesen verraet keinen Klarnamen -
      Antworten enthalten ohne Recht weiterhin nur die Kennung. Ohne diesen Weg VERNICHTETE
      der Import eines Unberechtigten (Ersetzen = alles loeschen + neu anlegen) saemtliche
      Zuordnungen. Nicht aufloesbare Kennungen werfen dabei KEINEN Fehler (der Posten waere
      nach dem Delete-all verloren), sondern legen ohne Zuordnung an und melden es im
      Response-Feld personHinweis.
   Rueckgabe: {fehler} oder {personId, hinweis?} (personId leer = entfernen). */
function personIdPruefen(req, bestand) {
  const b = req.body || {};
  if (b.personId !== undefined) {
    if (!darfKlarnamen(req.session)) {
      return { fehler: { status: 403, error: 'Die Personen-Zuordnung von Personalkosten verlangt das Recht „Personalkosten: Klarnamen sehen“.' } };
    }
    const gewuenscht = b.personId === null ? '' : String(b.personId).trim();
    if ((bestand || '') === gewuenscht) return { personId: bestand || null };
    if (!gewuenscht) return { personId: null };
    const p = db.prepare('SELECT * FROM persons WHERE id = ?').get(gewuenscht);
    if (!p) return { fehler: { status: 400, error: 'Die angegebene Person existiert nicht.' } };
    if (p.art === 'extern') return { fehler: { status: 400, error: 'Personalkosten werden internen Personen zugeordnet – externe Honorare bleiben freier Text.' } };
    if (!String(p.kennung || '').trim()) {
      return { fehler: { status: 409, error: 'Diese Person hat noch keine Mitarbeiterkennung. Bitte zuerst im Bereich Personen eine Kennung (z. B. „MA 4“) vergeben – sie ist das Pseudonym für die Finanzen.' } };
    }
    return { personId: gewuenscht };
  }
  if (b.personKennung !== undefined) {
    const kennung = b.personKennung === null ? '' : String(b.personKennung).trim();
    if (!kennung) return { personId: null };
    const p = db.prepare("SELECT id FROM persons WHERE kennung = ? COLLATE NOCASE AND art = 'intern'").get(kennung);
    if (!p) {
      return {
        personId: bestand || null,
        hinweis: `Die Kennung „${kennung}“ ist keiner internen Person zugeordnet – der Posten wurde ohne Personen-Zuordnung gespeichert.`,
      };
    }
    return { personId: p.id };
  }
  return { personId: bestand || null };
}

router.get('/entries', requireViewFinance, (req, res) => {
  res.json(financeEntriesBody(req.session));
});

router.post('/entries', requireEditFinance, (req, res) => {
  const { kind, posten, partner, frequenz, summeGesamt, summeMonatlich, datum, konto, sortOrder } = req.body || {};
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'kind muss ausgabe oder einnahme sein.' });
  if (!posten || !String(posten).trim()) return res.status(400).json({ error: 'Posten erforderlich.' });
  const person = personIdPruefen(req, null);
  if (person.fehler) return res.status(person.fehler.status).json({ error: person.fehler.error });
  const row = {
    id: crypto.randomUUID(),
    kind,
    posten: String(posten).trim(),
    partner: partner || '',
    frequenz: FREQUENZEN.includes(frequenz) ? frequenz : 'monatlich',
    summeGesamt: Number(summeGesamt) || 0,
    summeMonatlich: summeMonatlich != null && summeMonatlich !== '' ? Number(summeMonatlich) : null,
    datum: datum || null,
    konto: KONTEN.includes(konto) ? konto : 'geschaeftlich',
    personId: person.personId,
    userId: req.session.userId,
    sortOrder: Number(sortOrder) || 0
  };
  insertStmt.run(row);
  res.status(201).json({
    entry: publicEntry(getStmt.get(row.id), personAufloeser(req.session)),
    ...(person.hinweis ? { personHinweis: person.hinweis } : {}),
  });
});

router.put('/entries/:id', requireEditFinance, (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  const { kind, posten, partner, frequenz, summeGesamt, summeMonatlich, datum, konto } = req.body || {};
  const next = {
    id: row.id,
    kind: KINDS.includes(kind) ? kind : row.kind,
    posten: posten != null ? String(posten).trim() : row.posten,
    partner: partner != null ? partner : row.partner,
    frequenz: FREQUENZEN.includes(frequenz) ? frequenz : row.frequenz,
    summeGesamt: summeGesamt != null ? Number(summeGesamt) || 0 : row.summe_gesamt,
    summeMonatlich: summeMonatlich !== undefined ? (summeMonatlich === '' || summeMonatlich === null ? null : Number(summeMonatlich)) : row.summe_monatlich,
    datum: datum !== undefined ? (datum || null) : row.datum,
    konto: konto !== undefined ? (KONTEN.includes(konto) ? konto : row.konto) : row.konto,
    userId: req.session.userId
  };
  const person = personIdPruefen(req, row.person_id);
  if (person.fehler) return res.status(person.fehler.status).json({ error: person.fehler.error });
  next.personId = person.personId;
  updateStmt.run(next);
  res.json({
    entry: publicEntry(getStmt.get(row.id), personAufloeser(req.session)),
    ...(person.hinweis ? { personHinweis: person.hinweis } : {}),
  });
});

router.delete('/entries/:id', requireEditFinance, (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  deleteStmt.run(row.id);
  res.json({ ok: true });
});

// ===== Detailliste: Kontoauszüge (Statements) =====

// Nur lesende Altbestands-Fallbacks. Neue Kontoauszüge und Belege sind doc_files.
const STATEMENTS_DIR = path.join(DATA_ROOT, 'finance-statements');
function statementFilePath(id) { return path.join(STATEMENTS_DIR, id); }

const listStatementsStmt = db.prepare('SELECT * FROM finance_statements ORDER BY uploaded_at DESC');
const getStatementStmt = db.prepare('SELECT * FROM finance_statements WHERE id = ?');
const insertStatementStmt = db.prepare(`
  INSERT INTO finance_statements (id, filename, mime_type, size, konto, parse_status, uploaded_by)
  VALUES (@id, @filename, @mimeType, @size, @konto, @parseStatus, @userId)
`);
const updateStatementStatusStmt = db.prepare(`
  UPDATE finance_statements SET parse_status=@parseStatus, parse_error=@parseError WHERE id=@id
`);
const updateStatementMetaStmt = db.prepare(`
  UPDATE finance_statements SET filename=@filename, konto=@konto WHERE id=@id
`);
const deleteStatementStmt = db.prepare('DELETE FROM finance_statements WHERE id = ?');
const deleteStatementTransactionsStmt = db.prepare('DELETE FROM finance_transactions WHERE statement_id = ?');
// finance_receipts.matched_transaction_id verweist per FOREIGN KEY auf finance_transactions - vor
// dem Loeschen von Buchungen muss diese Referenz erst geloest werden, sonst schlaegt DELETE mit
// SQLITE_CONSTRAINT_FOREIGNKEY fehl (per echtem Testlauf gefunden: Kontoauszug loeschen, dessen
// Buchung einem Beleg zugeordnet war, warf genau diesen Fehler).
const clearReceiptMatchByTransactionStmt = db.prepare(`
  UPDATE finance_receipts SET matched_transaction_id=NULL, status='offen' WHERE matched_transaction_id=?
`);
const clearReceiptMatchesForStatementStmt = db.prepare(`
  UPDATE finance_receipts SET matched_transaction_id=NULL, status='offen'
  WHERE matched_transaction_id IN (SELECT id FROM finance_transactions WHERE statement_id=?)
`);

function dedupeStatementTransactions(rows) {
  const seen = new Set();
  const out = [];
  for (const t of rows || []) {
    const amount = Number(t && t.amount);
    if (!Number.isFinite(amount)) continue;
    const normalized = {
      bookingDate: String((t && t.bookingDate) || '').trim(),
      counterparty: String((t && t.counterparty) || '').replace(/\s+/g, ' ').trim().slice(0, 255),
      purpose: String((t && t.purpose) || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
      amount,
      currency: String((t && t.currency) || 'EUR').trim() || 'EUR'
    };
    const key = [
      normalized.bookingDate,
      normalized.counterparty.toLowerCase(),
      normalized.purpose.toLowerCase(),
      normalized.amount.toFixed(2),
      normalized.currency.toUpperCase()
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function publicStatement(row) {
  return {
    id: row.id, filename: row.filename, mimeType: row.mime_type, size: row.size,
    konto: row.konto, parseStatus: row.parse_status, parseError: row.parse_error,
    uploadedAt: row.uploaded_at,
    // Bank-Sync (Plan Abschnitt BR, Phase B3): unterscheidet 'fints' (per FinTS abgerufen) von
    // 'upload' (manueller Auszug) - erlaubt der Finanzen-UI eine "aus Bankverbindung"-Kennzeichnung.
    source: row.source || 'upload', connectionId: row.connection_id || null
  };
}

router.get('/statements', requireViewFinance, (req, res) => {
  res.json({ statements: listStatementsStmt.all().map(publicStatement) });
});

router.post('/statements', requireEditFinance, (req, res) => {
  const { filename, mimeType, dataBase64, konto } = req.body || {};
  if (!filename || !dataBase64) return res.status(400).json({ error: 'Dateiname und Inhalt erforderlich.' });
  let bytes;
  try { bytes = Buffer.from(dataBase64, 'base64'); } catch (_e) { return res.status(400).json({ error: 'Ungültige Dateidaten.' }); }
  if (bytes.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Datei ist zu groß (maximal 25 MB).' });
  const id = crypto.randomUUID();
  let central;
  try {
    central = moduleFiles.store({
      module: 'finance-statement', ownerId: id, slot: '', filename,
      mimeType: mimeType || 'application/octet-stream', bytes,
      createdBy: req.session.userId, date: new Date().toISOString(),
      detail: { konto: KONTEN.includes(konto) ? konto : 'geschaeftlich' }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Kontoauszug konnte nicht sicher im Dokumentenspeicher abgelegt werden: ' + (error.message || error) });
  }
  insertStatementStmt.run({
    id, filename: central.name, mimeType: mimeType || 'application/octet-stream',
    size: bytes.length, konto: KONTEN.includes(konto) ? konto : 'geschaeftlich', parseStatus: 'pending',
    userId: req.session.userId
  });
  res.status(201).json({ statement: publicStatement(getStatementStmt.get(id)) });
});

// Der Client parst den Kontoauszug selbst (CSV/XLSX direkt, PDF ueber dieselbe Hybrid-OCR-Technik
// wie bei der Rechnungslegung) und liefert die erkannten Buchungszeilen hier zum Speichern -
// serverseitig wird nichts geparst, das bleibt bewusst Browser-Logik (kein PDF/OCR-Stack im
// Node-Prozess noetig).
router.post('/statements/:id/transactions', requireEditFinance, (req, res) => {
  const statement = getStatementStmt.get(req.params.id);
  if (!statement) return res.status(404).json({ error: 'Kontoauszug nicht gefunden.' });
  const { transactions } = req.body || {};
  if (!Array.isArray(transactions)) return res.status(400).json({ error: 'transactions muss ein Array sein.' });
  const rows = dedupeStatementTransactions(transactions);
  const insertTx = db.prepare(`
    INSERT INTO finance_transactions (id, statement_id, konto, booking_date, counterparty, purpose, amount, currency)
    VALUES (@id, @statementId, @konto, @bookingDate, @counterparty, @purpose, @amount, @currency)
  `);
  const run = db.transaction((rows) => {
    clearReceiptMatchesForStatementStmt.run(statement.id);
    deleteStatementTransactionsStmt.run(statement.id);
    for (const t of rows) {
      insertTx.run({
        id: crypto.randomUUID(), statementId: statement.id, konto: statement.konto,
        bookingDate: t.bookingDate, counterparty: t.counterparty, purpose: t.purpose,
        amount: t.amount, currency: t.currency
      });
    }
    updateStatementStatusStmt.run({ id: statement.id, parseStatus: 'done', parseError: '' });
  });
  try {
    run(rows);
  } catch (e) {
    updateStatementStatusStmt.run({ id: statement.id, parseStatus: 'failed', parseError: String(e.message || e).slice(0, 500) });
    return res.status(500).json({ error: 'Buchungszeilen konnten nicht gespeichert werden.' });
  }
  res.status(201).json({ ok: true, count: rows.length });
});

router.get('/statements/:id/file', requireViewFinance, (req, res) => {
  const row = getStatementStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Kontoauszug nicht gefunden.' });
  const central = moduleFiles.resolve('finance-statement', row.id, '', false);
  const filePath = (central && central.filePath) || statementFilePath(row.id);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht mehr auf dem Server vorhanden.' });
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.filename)}"`);
  fs.createReadStream(filePath).pipe(res);
});

router.delete('/statements/:id', requireEditFinance, (req, res) => {
  const row = getStatementStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Kontoauszug nicht gefunden.' });
  clearReceiptMatchesForStatementStmt.run(row.id);
  deleteStatementTransactionsStmt.run(row.id);
  deleteStatementStmt.run(row.id);
  moduleFiles.unlink('finance-statement', row.id, '');
  try { fs.unlinkSync(statementFilePath(row.id)); } catch (_e) { /* ignore */ }
  res.json({ ok: true });
});

router.put('/statements/:id', requireEditFinance, (req, res) => {
  const row = getStatementStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Kontoauszug nicht gefunden.' });
  const b = req.body || {};
  let filename = b.filename !== undefined ? (String(b.filename).slice(0, 255).trim() || row.filename) : row.filename;
  const konto = (b.konto !== undefined && KONTEN.includes(b.konto)) ? b.konto : row.konto;
  if (b.filename !== undefined) {
    try {
      const renamed = moduleFiles.rename('finance-statement', row.id, '', moduleFiles.datedName(filename, row.uploaded_at));
      if (renamed && renamed.row) filename = renamed.row.name;
    } catch (error) {
      return res.status(409).json({ error: 'Kontoauszug konnte auf der Platte nicht umbenannt werden: ' + (error.message || error) });
    }
  }
  updateStatementMetaStmt.run({ id: row.id, filename, konto });
  res.json({ statement: publicStatement(getStatementStmt.get(row.id)) });
});

// ===== Detailliste: Buchungszeilen (Transactions) =====

const listTransactionsStmt = db.prepare('SELECT * FROM finance_transactions ORDER BY booking_date DESC, created_at DESC');
const getTransactionStmt = db.prepare('SELECT * FROM finance_transactions WHERE id = ?');
const insertManualTxStmt = db.prepare(`
  INSERT INTO finance_transactions (id, statement_id, konto, booking_date, counterparty, purpose, amount, currency)
  VALUES (@id, NULL, @konto, @bookingDate, @counterparty, @purpose, @amount, @currency)
`);
const updateTransactionStmt = db.prepare(`
  UPDATE finance_transactions SET konto=@konto, booking_date=@bookingDate, counterparty=@counterparty,
    purpose=@purpose, amount=@amount, currency=@currency, is_private_suspect=@isPrivateSuspect,
    private_reason=@privateReason, matched_entry_id=@matchedEntryId, status=@status, updated_at=datetime('now')
  WHERE id=@id
`);
const deleteTransactionStmt = db.prepare('DELETE FROM finance_transactions WHERE id = ?');

function publicTransaction(row) {
  return {
    id: row.id, statementId: row.statement_id, konto: row.konto, bookingDate: row.booking_date,
    counterparty: row.counterparty, purpose: row.purpose, amount: row.amount, currency: row.currency,
    isPrivateSuspect: !!row.is_private_suspect, privateReason: row.private_reason,
    matchedEntryId: row.matched_entry_id, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

router.get('/transactions', requireViewFinance, (req, res) => {
  res.json({ transactions: listTransactionsStmt.all().map(publicTransaction) });
});

router.post('/transactions', requireEditFinance, (req, res) => {
  const { konto, bookingDate, counterparty, purpose, amount, currency } = req.body || {};
  const row = {
    id: crypto.randomUUID(), konto: KONTEN.includes(konto) ? konto : 'geschaeftlich',
    bookingDate: bookingDate || '', counterparty: String(counterparty || '').slice(0, 255),
    purpose: String(purpose || '').slice(0, 2000), amount: Number(amount) || 0, currency: currency || 'EUR'
  };
  insertManualTxStmt.run(row);
  res.status(201).json({ transaction: publicTransaction(getTransactionStmt.get(row.id)) });
});

router.put('/transactions/:id', requireEditFinance, (req, res) => {
  const row = getTransactionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Buchung nicht gefunden.' });
  const b = req.body || {};
  const next = {
    id: row.id,
    konto: b.konto !== undefined ? (KONTEN.includes(b.konto) ? b.konto : row.konto) : row.konto,
    bookingDate: b.bookingDate !== undefined ? b.bookingDate : row.booking_date,
    counterparty: b.counterparty !== undefined ? String(b.counterparty).slice(0, 255) : row.counterparty,
    purpose: b.purpose !== undefined ? String(b.purpose).slice(0, 2000) : row.purpose,
    amount: b.amount !== undefined ? Number(b.amount) || 0 : row.amount,
    currency: b.currency !== undefined ? b.currency : row.currency,
    isPrivateSuspect: b.isPrivateSuspect !== undefined ? (b.isPrivateSuspect ? 1 : 0) : row.is_private_suspect,
    privateReason: b.privateReason !== undefined ? String(b.privateReason).slice(0, 500) : row.private_reason,
    matchedEntryId: b.matchedEntryId !== undefined ? b.matchedEntryId : row.matched_entry_id,
    status: b.status !== undefined ? b.status : row.status
  };
  updateTransactionStmt.run(next);
  res.json({ transaction: publicTransaction(getTransactionStmt.get(row.id)) });
});

router.delete('/transactions/:id', requireEditFinance, (req, res) => {
  const row = getTransactionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Buchung nicht gefunden.' });
  clearReceiptMatchByTransactionStmt.run(row.id);
  deleteTransactionStmt.run(row.id);
  res.json({ ok: true });
});

// ===== Detailliste: Belege/Rechnungen (Receipts) =====

const RECEIPTS_DIR = path.join(DATA_ROOT, 'finance-receipts');
function receiptFilePath(id) { return path.join(RECEIPTS_DIR, id); }

const listReceiptsStmt = db.prepare('SELECT * FROM finance_receipts ORDER BY uploaded_at DESC');
const getReceiptStmt = db.prepare('SELECT * FROM finance_receipts WHERE id = ?');
const insertReceiptStmt = db.prepare(`
  INSERT INTO finance_receipts (id, filename, mime_type, size, ocr_status, uploaded_by)
  VALUES (@id, @filename, @mimeType, @size, 'pending', @userId)
`);
const updateReceiptStmt = db.prepare(`
  UPDATE finance_receipts SET issuer=@issuer, invoice_number=@invoiceNumber, invoice_date=@invoiceDate,
    total_amount=@totalAmount, currency=@currency, confidence=@confidence, ocr_status=@ocrStatus,
    ocr_text=@ocrText, matched_transaction_id=@matchedTransactionId, matched_entry_id=@matchedEntryId,
    status=@status
  WHERE id=@id
`);
const deleteReceiptStmt = db.prepare('DELETE FROM finance_receipts WHERE id = ?');
const setReceiptFilenameStmt = db.prepare('UPDATE finance_receipts SET filename = ? WHERE id = ?');

function publicReceipt(row) {
  return {
    id: row.id, filename: row.filename, mimeType: row.mime_type, size: row.size,
    issuer: row.issuer, invoiceNumber: row.invoice_number, invoiceDate: row.invoice_date,
    totalAmount: row.total_amount, currency: row.currency, confidence: row.confidence,
    ocrStatus: row.ocr_status, matchedTransactionId: row.matched_transaction_id,
    matchedEntryId: row.matched_entry_id, status: row.status, uploadedAt: row.uploaded_at
    // ocr_text bewusst NICHT im Listen-/Standard-Payload (kann laenger sein, wird nur bei
    // Bedarf einzeln gebraucht) - siehe eigener /:id/text-Endpunkt weiter unten.
  };
}

router.get('/receipts', requireViewFinance, (req, res) => {
  res.json({ receipts: listReceiptsStmt.all().map(publicReceipt) });
});

router.post('/receipts', requireEditFinance, (req, res) => {
  const { filename, mimeType, dataBase64 } = req.body || {};
  if (!filename || !dataBase64) return res.status(400).json({ error: 'Dateiname und Inhalt erforderlich.' });
  let bytes;
  try { bytes = Buffer.from(dataBase64, 'base64'); } catch (_e) { return res.status(400).json({ error: 'Ungültige Dateidaten.' }); }
  if (bytes.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Datei ist zu groß (maximal 25 MB).' });
  const id = crypto.randomUUID();
  let central;
  try {
    central = moduleFiles.store({
      module: 'finance-receipt', ownerId: id, slot: '', filename,
      mimeType: mimeType || 'application/octet-stream', bytes,
      createdBy: req.session.userId, date: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: 'Beleg konnte nicht sicher im Dokumentenspeicher abgelegt werden: ' + (error.message || error) });
  }
  insertReceiptStmt.run({
    id, filename: central.name, mimeType: mimeType || 'application/octet-stream',
    size: bytes.length, userId: req.session.userId
  });
  res.status(201).json({ receipt: publicReceipt(getReceiptStmt.get(id)) });
});

router.get('/receipts/:id/file', requireViewFinance, (req, res) => {
  const row = getReceiptStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Beleg nicht gefunden.' });
  const central = moduleFiles.resolve('finance-receipt', row.id, '', false);
  const filePath = (central && central.filePath) || receiptFilePath(row.id);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht mehr auf dem Server vorhanden.' });
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.filename)}"`);
  fs.createReadStream(filePath).pipe(res);
});

router.get('/receipts/:id/text', requireViewFinance, (req, res) => {
  const row = getReceiptStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Beleg nicht gefunden.' });
  res.json({ text: row.ocr_text || '' });
});
router.put('/receipts/:id', requireEditFinance, (req, res) => {
  const row = getReceiptStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Beleg nicht gefunden.' });
  const b = req.body || {};
  const next = {
    id: row.id,
    issuer: b.issuer !== undefined ? String(b.issuer).slice(0, 255) : row.issuer,
    invoiceNumber: b.invoiceNumber !== undefined ? String(b.invoiceNumber).slice(0, 100) : row.invoice_number,
    invoiceDate: b.invoiceDate !== undefined ? b.invoiceDate : row.invoice_date,
    totalAmount: b.totalAmount !== undefined ? (b.totalAmount === '' || b.totalAmount === null ? null : Number(b.totalAmount)) : row.total_amount,
    currency: b.currency !== undefined ? b.currency : row.currency,
    confidence: b.confidence !== undefined ? Number(b.confidence) || 0 : row.confidence,
    ocrStatus: b.ocrStatus !== undefined ? b.ocrStatus : row.ocr_status,
    ocrText: b.ocrText !== undefined ? String(b.ocrText).slice(0, 50000) : row.ocr_text,
    matchedTransactionId: b.matchedTransactionId !== undefined ? b.matchedTransactionId : row.matched_transaction_id,
    matchedEntryId: b.matchedEntryId !== undefined ? b.matchedEntryId : row.matched_entry_id,
    status: b.status !== undefined ? b.status : row.status
  };
  updateReceiptStmt.run(next);
  try {
    const moved = moduleFiles.moveTo({
      module: 'finance-receipt', ownerId: row.id, slot: '',
      filename: row.filename, date: next.invoiceDate || row.uploaded_at, redate: true
    });
    if (moved && moved.row && moved.row.name !== row.filename) setReceiptFilenameStmt.run(moved.row.name, row.id);
  } catch (error) {
    return res.status(409).json({ error: 'Beleg wurde aktualisiert, konnte aber nicht sicher in den Rechnungsmonat verschoben werden: ' + (error.message || error) });
  }
  res.json({ receipt: publicReceipt(getReceiptStmt.get(row.id)) });
});

router.delete('/receipts/:id', requireEditFinance, (req, res) => {
  const row = getReceiptStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Beleg nicht gefunden.' });
  deleteReceiptStmt.run(row.id);
  moduleFiles.unlink('finance-receipt', row.id, '');
  try { fs.unlinkSync(receiptFilePath(row.id)); } catch (_e) { /* ignore */ }
  res.json({ ok: true });
});

module.exports = router;
module.exports.intern = { financeEntriesBody };
