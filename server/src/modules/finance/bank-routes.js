// Banking-Routen (Hibiscus-Anbindung, 2026-07-26 - PLAN-Bankanbindung.md).
//
// Grundsaetze:
// - Der Server kennt Konten, Umsaetze und Auftraege; die Zuordnung zu Personen laeuft ueber die
//   IBANs in den Fall-Stammdaten (caseData.banks). Fallrechte (fall-sicht.js) gelten auch hier:
//   wer einen Fall nicht sieht, sieht auch dessen Konten/Umsaetze/Auftraege nicht.
// - Drei Rechte-Stufen: viewBankData (sehen), manageBankConnections (Gateway/Konten verwalten),
//   initiatePayments (Zahlungen anlegen/freigeben/einreichen).
// - Zahlungs-Lebenszyklus: entwurf -> freigegeben -> eingereicht -> ausgefuehrt. Die eigentliche
//   Ausfuehrung (inkl. TAN) uebernimmt der Hibiscus Payment Server; wir reichen ein und gleichen
//   beim naechsten Umsatzabruf ueber end_to_end_id bzw. Betrag+IBAN+Zeitfenster ab.
// - Intervall-Zahlungen erzeugen beim Lauf ENTWUERFE - niemals eine stille Einreichung.
'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('../../database/index');
const appCrypto = require('../../security/crypto');
const hibiscus = require('../../integrations/banking/hibiscus');
const applicationWriteBarrier = require('../../middleware/application-write-barrier');
const { sichtbareFaelle, darfSehen, darfBearbeiten } = require('../cases/case-visibility');

const router = express.Router();
router.use(require('../office/events').middleware('bank'));

const GATEWAY_ID = 'hibiscus-gateway';

/* ---------------- Rechte ---------------- */
function gate(flag, message) {
  return (req, res, next) => {
    if (!req.session || !(req.session.isAdmin || req.session[flag])) {
      return res.status(403).json({ error: message });
    }
    next();
  };
}
const requireView = gate('canViewBankData', 'Keine Berechtigung, Bankdaten anzusehen.');
const requireManage = gate('canManageBankConnections', 'Keine Berechtigung, die Banking-Verbindung zu verwalten.');
const requirePay = gate('canInitiatePayments', 'Keine Berechtigung, Überweisungen zu erstellen oder freizugeben.');

/* SICHERHEIT (Audit 2026-07-26, Befund B2): requirePay haengt als Express-Middleware NUR an den
   HTTP-Routen. Die _api-Funktionen darunter (createOrder, approveOrder, cancelOrder, submitOrder,
   submitBatch, createRecurring) pruefen das Recht bisher nicht - und genau die ruft der
   KI-Fernzugriff (mcp-tools.js) direkt auf. Ein Konto mit initiatePayments=false (Default AUS,
   das gefaehrlichste Recht der ganzen Matrix) konnte darueber Auftraege anlegen UND freigeben.
   Die Pruefung gehoert deshalb in die Funktionen selbst: das deckt MCP und jeden kuenftigen
   Aufrufer auf einmal. Fuer die HTTP-Routen aendert sich nichts - dort hat requirePay schon
   vorher abgewiesen, die zweite Pruefung kann gar nicht mehr greifen (identische Bedingung,
   identische Meldung), sie bricht also keinen bestehenden Aufrufer.
   NICHT betroffen: runRecurring() (taeglicher Lauf) schreibt seine ENTWUERFE mit eigenem INSERT
   und laeuft auch ohne Sitzung - der Lauf bleibt unveraendert. */
const ZAHLRECHT_FEHLT = { status: 403, json: { error: 'Keine Berechtigung, Überweisungen zu erstellen oder freizugeben.' } };
function darfZahlen(session) {
  return !!(session && (session.isAdmin || session.canInitiatePayments));
}

/* ---------------- Konfiguration ---------------- */
function readConfig() {
  let row = db.prepare('SELECT * FROM bank_gateway_config WHERE id=1').get();
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO bank_gateway_config (id) VALUES (1)').run();
    row = db.prepare('SELECT * FROM bank_gateway_config WHERE id=1').get();
  }
  return row;
}
function hibiscusCfg(overrides) {
  const row = readConfig();
  const custom = overrides || {};
  let password = '';
  if (row.password_encrypted) {
    try { password = appCrypto.decrypt(row.password_encrypted); }
    catch (_e) { password = ''; }
  }
  if (typeof custom.password === 'string' && custom.password !== '') password = custom.password;
  return {
    url: typeof custom.url === 'string' && custom.url.trim()
      ? custom.url.trim()
      : (row.url || 'https://localhost:8080'),
    password,
    allowSelfSigned: typeof custom.allowSelfSigned === 'boolean'
      ? custom.allowSelfSigned
      : row.allow_self_signed !== 0
  };
}

router.get('/config', requireView, (req, res) => {
  const row = readConfig();
  const konten = db.prepare(`SELECT COUNT(*) AS n FROM bank_accounts_discovered WHERE connection_id=?`).get(GATEWAY_ID).n;
  res.json({
    url: row.url,
    hasPassword: !!row.password_encrypted,
    allowSelfSigned: row.allow_self_signed !== 0,
    syncEnabled: row.sync_enabled === 1,
    syncIntervalMin: row.sync_interval_min,
    lastSyncAt: row.last_sync_at || null,
    lastSyncStatus: row.last_sync_status || '',
    accountCount: konten
  });
});

router.put('/config', requireManage, (req, res) => {
  const b = req.body || {};
  const row = readConfig();
  const url = typeof b.url === 'string' && b.url.trim() ? b.url.trim() : row.url;
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Die URL muss mit http(s):// beginnen.' });
  // Leeres Passwort = bestehendes behalten (Muster office_send_credentials).
  let pwEnc = row.password_encrypted;
  if (typeof b.password === 'string' && b.password !== '') pwEnc = appCrypto.encrypt(b.password);
  const interval = Math.max(15, Math.min(1440, parseInt(b.syncIntervalMin, 10) || row.sync_interval_min || 240));
  db.prepare(`UPDATE bank_gateway_config SET url=?, password_encrypted=?, allow_self_signed=?,
    sync_enabled=?, sync_interval_min=?, updated_at=datetime('now'), updated_by=? WHERE id=1`)
    .run(url, pwEnc, b.allowSelfSigned === false ? 0 : 1, b.syncEnabled === true ? 1 : 0, interval, req.session.userId);
  res.json({ ok: true });
});

router.post('/test', requireManage, async (req, res) => {
  const b = req.body || {};
  const testUrl = typeof b.url === 'string' ? b.url.trim() : '';
  if (typeof b.url === 'string' && !testUrl) {
    return res.status(400).json({ error: 'Bitte eine Hibiscus-Server-URL eingeben.' });
  }
  if (testUrl && !/^https?:\/\//i.test(testUrl)) {
    return res.status(400).json({ error: 'Die URL muss mit http(s):// beginnen.' });
  }
  const cfg = hibiscusCfg({
    url: testUrl || undefined,
    password: typeof b.password === 'string' ? b.password : undefined,
    allowSelfSigned: typeof b.allowSelfSigned === 'boolean' ? b.allowSelfSigned : undefined
  });
  try {
    const r = await hibiscus.test(cfg);
    res.json({ ok: true, konten: r.konten, url: cfg.url });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ---------------- Konten ---------------- */
async function refreshAccounts() {
  const list = await hibiscus.konten(hibiscusCfg());
  const up = db.prepare(`INSERT INTO bank_accounts_discovered
      (id, connection_id, iban, bic, account_name, enabled, hibiscus_id, saldo, saldo_date, currency, holder)
    VALUES (@id, @conn, @iban, @bic, @name, 1, @hx, @saldo, @saldoDate, @cur, @holder)
    ON CONFLICT(id) DO UPDATE SET iban=@iban, bic=@bic, account_name=@name, hibiscus_id=@hx,
      saldo=@saldo, saldo_date=@saldoDate, currency=@cur, holder=@holder`);
  const tx = db.transaction((rows) => {
    for (const k of rows) {
      // Stabile ID je Hibiscus-Konto, damit enabled-Haekchen Refreshes ueberleben.
      up.run({
        id: 'hx-' + (k.hibiscusId || k.iban), conn: GATEWAY_ID, iban: k.iban, bic: k.bic,
        name: k.name || k.iban, hx: k.hibiscusId, saldo: k.saldo, saldoDate: k.saldoDatum,
        cur: k.waehrung, holder: k.inhaber
      });
    }
  });
  tx(list);
  return list.length;
}

router.post('/accounts/refresh', requireManage, async (req, res) => {
  try {
    const n = await refreshAccounts();
    res.json({ ok: true, konten: n });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

function ibanCaseEntries() {
  // IBAN -> Fall, aus den Stammdaten aller Faelle (caseData.banks). Bewusst ohne Cache: die
  // Fallzahl ist klein, und ein stiller 60-Sekunden-Cache hat in dieser App schon einmal
  // "warum fehlt der Fall?"-Fehlersuchen gekostet.
  const out = new Map();
  const rows = db.prepare('SELECT id, label, stammdaten_json FROM cases').all();
  for (const r of rows) {
    let banks = [];
    try { banks = (JSON.parse(r.stammdaten_json || '{}').banks) || []; } catch (_e) { /* defekter Blob */ }
    for (const b of (Array.isArray(banks) ? banks : [])) {
      const iban = String((b && b.iban) || '').replace(/\s+/g, '').toUpperCase();
      if (iban && !out.has(iban)) out.set(iban, { caseId: r.id, label: r.label || '' });
    }
  }
  return out;
}

function normAccountIban(iban) {
  return String(iban || '').replace(/\s+/g, '').toUpperCase();
}

function effectiveAccountCaseEntries() {
  // Eine manuelle Wahl ist konto- und nicht fallstammdatenbezogen. Sie hat Vorrang vor dem
  // automatischen IBAN-Treffer und kann mit manual_case_id=NULL auch bewusst "Buero" bedeuten.
  const automatic = ibanCaseEntries();
  // Automatische Treffer auch dann erhalten, wenn Umsaetze per Kontoauszugsdatei eingespielt
  // wurden und noch kein bank_accounts_discovered-Datensatz fuer die IBAN existiert.
  const out = new Map(Array.from(automatic, ([iban, hit]) => [
    iban, { caseId: hit.caseId, label: hit.label, source: 'automatic' }
  ]));
  const rows = db.prepare(`SELECT a.iban, a.case_assignment_mode, a.manual_case_id,
      c.label AS manual_case_label
    FROM bank_accounts_discovered a
    LEFT JOIN cases c ON c.id=a.manual_case_id
    WHERE a.connection_id=?`).all(GATEWAY_ID);
  for (const row of rows) {
    const iban = normAccountIban(row.iban);
    if (!iban) continue;
    if (row.case_assignment_mode === 'manual') {
      out.set(iban, {
        caseId: row.manual_case_id || null,
        label: row.manual_case_label || '',
        source: 'manual'
      });
      continue;
    }
    const hit = automatic.get(iban);
    if (hit) out.set(iban, { caseId: hit.caseId, label: hit.label, source: 'automatic' });
  }
  return out;
}

function visibleIbanFilter(session) {
  // null = alles sichtbar; sonst: Praedikat(iban) unter Beachtung der Fallrechte.
  const visible = sichtbareFaelle(session);
  const map = effectiveAccountCaseEntries();
  return (iban) => {
    const hit = map.get(normAccountIban(iban));
    if (!hit || !hit.caseId) {
      // Keinem Fall zugeordnet = Buero-Konto: sichtbar, wenn Buero-Finanzen gesehen werden duerfen.
      return !!(session.isAdmin || session.canViewFinance);
    }
    if (!visible) return true;
    return visible.has(String(hit.caseId));
  };
}

router.get('/accounts', requireView, (req, res) => {
  const allowed = visibleIbanFilter(req.session);
  const automaticMap = ibanCaseEntries();
  const transactionStats = new Map(db.prepare(`SELECT t.account_iban,
      COUNT(*) AS transaction_count, MIN(t.booking_date) AS transaction_from,
      MAX(t.booking_date) AS transaction_to,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM finance_transactions f WHERE f.bank_tx_hash=t.dedupe_hash
      ) THEN 0 ELSE 1 END) AS unimported_count
    FROM bank_transactions t GROUP BY t.account_iban`).all()
    .map(r => [String(r.account_iban || '').toUpperCase(), r]));
  const rows = db.prepare(`SELECT a.*, c.label AS manual_case_label,
      u.display_name AS manual_case_updated_by_name
    FROM bank_accounts_discovered a
    LEFT JOIN cases c ON c.id=a.manual_case_id
    LEFT JOIN users u ON u.id=a.manual_case_updated_by
    WHERE a.connection_id=? ORDER BY a.account_name`).all(GATEWAY_ID)
    .filter(r => allowed(r.iban))
    .map(r => {
      const iban = normAccountIban(r.iban);
      const automaticHit = automaticMap.get(iban) || null;
      const manual = r.case_assignment_mode === 'manual';
      const hit = manual
        ? { caseId: r.manual_case_id || null, label: r.manual_case_label || '', source: 'manual' }
        : (automaticHit
          ? { caseId: automaticHit.caseId, label: automaticHit.label, source: 'automatic' }
          : { caseId: null, label: '', source: 'automatic' });
      const stats = transactionStats.get(iban) || {};
      return {
        id: r.id, iban: r.iban, bic: r.bic, name: r.account_name, holder: r.holder || '',
        enabled: r.enabled === 1, saldo: r.saldo, saldoDate: r.saldo_date || '', currency: r.currency || 'EUR',
        caseId: hit ? hit.caseId : null, caseLabel: hit ? hit.label : null,
        assignmentMode: manual ? 'manual' : 'auto',
        assignmentSource: hit.source,
        manualCaseId: manual ? (r.manual_case_id || null) : null,
        automaticCaseId: automaticHit ? automaticHit.caseId : null,
        automaticCaseLabel: automaticHit ? automaticHit.label : null,
        assignmentUpdatedAt: r.manual_case_updated_at || null,
        assignmentUpdatedByName: r.manual_case_updated_by_name || null,
        canChangeAssignment: !hit.caseId || darfBearbeiten(req.session, hit.caseId),
        transactionCount: Number(stats.transaction_count) || 0,
        unimportedCount: Number(stats.unimported_count) || 0,
        transactionFrom: stats.transaction_from || '',
        transactionTo: stats.transaction_to || ''
      };
    });
  const assignableCases = db.prepare(`SELECT id, label FROM cases
      WHERE COALESCE(archived,0)=0 ORDER BY label COLLATE NOCASE`).all()
    .filter(c => darfBearbeiten(req.session, c.id))
    .map(c => ({ id: c.id, label: c.label }));
  res.json({ accounts: rows, assignableCases });
});

router.put('/accounts/:id', requireManage, (req, res) => {
  const r = db.prepare('SELECT id FROM bank_accounts_discovered WHERE id=? AND connection_id=?').get(req.params.id, GATEWAY_ID);
  if (!r) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  db.prepare('UPDATE bank_accounts_discovered SET enabled=? WHERE id=?')
    .run(req.body && req.body.enabled === false ? 0 : 1, req.params.id);
  res.json({ ok: true });
});

router.put('/accounts/:id/case', requireManage, (req, res) => {
  const account = db.prepare(`SELECT a.*, c.label AS manual_case_label
    FROM bank_accounts_discovered a
    LEFT JOIN cases c ON c.id=a.manual_case_id
    WHERE a.id=? AND a.connection_id=?`).get(req.params.id, GATEWAY_ID);
  if (!account) return res.status(404).json({ error: 'Konto nicht gefunden.' });

  const current = effectiveAccountCaseEntries().get(normAccountIban(account.iban));
  if (current && current.caseId && !darfBearbeiten(req.session, current.caseId)) {
    return res.status(403).json({ error: 'Sie haben für die bisherige Fallzuordnung kein Bearbeitungsrecht.' });
  }

  const mode = req.body && req.body.mode === 'manual' ? 'manual' : 'auto';
  let caseId = null;
  if (mode === 'manual' && req.body && req.body.caseId) {
    caseId = String(req.body.caseId);
    const ziel = db.prepare(`SELECT id, label, COALESCE(archived,0) AS archived
      FROM cases WHERE id=?`).get(caseId);
    if (!ziel || ziel.archived) return res.status(404).json({ error: 'Der gewählte aktive Fall wurde nicht gefunden.' });
    if (!darfBearbeiten(req.session, caseId)) {
      return res.status(403).json({ error: 'Sie haben für den gewählten Fall kein Bearbeitungsrecht.' });
    }
  }

  db.prepare(`UPDATE bank_accounts_discovered
    SET case_assignment_mode=?, manual_case_id=?,
        manual_case_updated_at=datetime('now'), manual_case_updated_by=?
    WHERE id=? AND connection_id=?`)
    .run(mode, mode === 'manual' ? caseId : null, req.session.userId, req.params.id, GATEWAY_ID);

  const hit = effectiveAccountCaseEntries().get(normAccountIban(account.iban)) || null;
  require('../office/events').emit('bank', { kind: 'account-case-assignment', accountId: req.params.id });
  res.json({
    ok: true,
    accountId: req.params.id,
    assignmentMode: mode,
    caseId: hit && hit.caseId ? hit.caseId : null,
    caseLabel: hit && hit.label ? hit.label : null,
    assignmentSource: hit ? hit.source : 'automatic'
  });
});

router.get('/iban-case-map', requireView, (req, res) => {
  const visible = sichtbareFaelle(req.session);
  const out = {};
  for (const [iban, hit] of effectiveAccountCaseEntries()) {
    if (!hit.caseId) continue;
    if (visible && !visible.has(String(hit.caseId))) continue;
    out[iban] = hit;
  }
  res.json({ map: out });
});

/* ---------------- Umsatz-Sync ---------------- */
function contentHash(t) {
  return crypto.createHash('sha256')
    .update([t.accountIban, t.datum, t.betrag.toFixed(2), (t.zweck || '').toLowerCase().replace(/\s+/g, ' '),
      (t.gegenName || '').toLowerCase()].join('|'))
    .digest('hex');
}
/* V1.59.2 (Rechenkern-Audit A2): Der Inhalts-Hash ist IBAN|Datum|Betrag|Zweck|Gegenseite. Damit
   sind ECHTE Mehrfachbuchungen (drei Bargeldauszahlungen a 20,00 EUR am selben Tag am selben
   Automaten) nicht von einer versehentlich doppelt eingelesenen Datei zu unterscheiden. Gemessen:
   {neu:1, uebersprungen:2}, eine Zeile in bank_transactions, Summe -20,00 statt -60,00 - echter
   Geldbetrag, der in der Rechnungslegung fehlt.
   LOESUNG: die laufende Nummer der Buchung INNERHALB DIESER Quelle (Datei bzw. Sync-Antwort) geht
   in die Identitaet ein. Die dritte 20-EUR-Abhebung ist dann eine andere als die erste; wird
   dieselbe Datei erneut eingelesen, treffen #1/#2/#3 wieder genau aufeinander - es verdoppelt sich
   nichts. Ueberlappende Auszuege (Januar + Quartal) enthalten dieselben Buchungen in derselben
   Reihenfolge und zaehlen deshalb gleich.
   BEWUSST NICHT die Bankreferenz (:61:-Kundenreferenz bzw. AcctSvcrRef/EndToEndId): sie waere die
   sauberste Identitaet, aber (a) nicht jede Bank fuellt sie (haeufig 'NONREF') und (b) sie wuerde
   die Identitaet BEREITS GESPEICHERTER Zeilen aendern - ein erneutes Einlesen eines frueher schon
   importierten Auszugs erzeugte dann lauter Dubletten. Deshalb behaelt die ERSTE Buchung einer
   Inhaltsgruppe exakt den historischen Hash; nur die zweite und jede weitere bekommen '#n'. */
function contentHashFolge(zaehler, basis) {
  const n = (zaehler.get(basis) || 0) + 1;
  zaehler.set(basis, n);
  return n === 1 ? basis : (basis + '#' + n);
}

async function doSync(days) {
  const cfg = hibiscusCfg();
  const accounts = db.prepare('SELECT * FROM bank_accounts_discovered WHERE connection_id=? AND enabled=1').all(GATEWAY_ID);
  const von = new Date(Date.now() - (Math.max(1, Math.min(730, days || 60))) * 86400000).toISOString().slice(0, 10);
  const ins = db.prepare(`INSERT OR IGNORE INTO bank_transactions
      (id, connection_id, account_iban, booking_date, value_date, amount, currency, counterparty,
       counterparty_iban, purpose, balance_after, raw_json, dedupe_hash, hibiscus_id)
    VALUES (@id, @conn, @iban, @bd, @vd, @amount, @cur, @cp, @cpIban, @purpose, @bal, @raw, @hash, @hx)`);
  const refreshExisting = db.prepare(`UPDATE bank_transactions SET
      account_iban=@iban, booking_date=@bd, value_date=@vd, amount=@amount, currency=@cur,
      counterparty=@cp, counterparty_iban=@cpIban, purpose=@purpose, balance_after=@bal,
      raw_json=@raw, hibiscus_id=@hx, fetched_at=datetime('now')
    WHERE dedupe_hash=@hash AND connection_id=@conn`);
  let neu = 0, gesamt = 0;
  for (const acc of accounts) {
    if (!acc.hibiscus_id) continue;
    const list = await hibiscus.umsaetze(cfg, acc.hibiscus_id, von);
    gesamt += list.length;
    const tx = db.transaction((rows) => {
      /* A2 auch hier: liefert die Bank keine eigene Umsatz-ID (hibiscusId), lag derselbe
         Inhalts-Hash mehrfach vor und alle Buchungen ausser der ersten fielen weg. Zaehler je
         Konto und Sync-Lauf; mit hibiscusId bleibt es unveraendert bei 'hx:<id>'. */
      const zaehlerV1592 = new Map();
      for (const u of rows) {
        const hash = u.hibiscusId ? ('hx:' + u.hibiscusId)
          : contentHashFolge(zaehlerV1592, contentHash({ accountIban: acc.iban, datum: u.datum, betrag: u.betrag, zweck: u.zweck, gegenName: u.gegenName }));
        const params = {
          id: crypto.randomUUID(), conn: GATEWAY_ID, iban: acc.iban, bd: u.datum, vd: u.valuta || u.datum,
          amount: u.betrag, cur: 'EUR', cp: u.gegenName, cpIban: u.gegenIban, purpose: u.zweck,
          bal: u.saldo, raw: JSON.stringify(u), hash, hx: u.hibiscusId
        };
        const r = ins.run(params);
        if (r.changes > 0) neu++;
        else refreshExisting.run(params);
      }
    });
    tx(list);
  }
  // Salden mitziehen.
  try { await refreshAccounts(); } catch (_e) { /* Salden sind nachrangig */ }
  matchSubmittedOrders();
  db.prepare(`UPDATE bank_gateway_config SET last_sync_at=datetime('now'), last_sync_status=? WHERE id=1`)
    .run('OK: ' + neu + ' neue von ' + gesamt + ' Umsätzen');
  return { neu, gesamt, konten: accounts.length };
}

// Eingereichte Auftraege im Umsatz wiederfinden: zuerst ueber end_to_end_id im Zweck/raw,
// sonst Betrag+Empfaenger-IBAN in einem 14-Tage-Fenster nach Einreichung.
function matchSubmittedOrders() {
  const open = db.prepare(`SELECT * FROM bank_payment_orders WHERE status='eingereicht'`).all();
  if (!open.length) return;
  const upd = db.prepare(`UPDATE bank_payment_orders SET status='ausgefuehrt', matched_tx_id=?,
    status_detail='Im Kontoumsatz wiedergefunden.', updated_at=datetime('now') WHERE id=?`);
  for (const o of open) {
    let tx = null;
    if (o.end_to_end_id) {
      tx = db.prepare(`SELECT id FROM bank_transactions WHERE account_iban=? AND (purpose LIKE ? OR raw_json LIKE ?) LIMIT 1`)
        .get(o.konto_iban, '%' + o.end_to_end_id + '%', '%' + o.end_to_end_id + '%');
    }
    if (!tx) {
      tx = db.prepare(`SELECT id FROM bank_transactions WHERE account_iban=? AND counterparty_iban=?
          AND ABS(amount + ?) < 0.005 AND booking_date >= COALESCE(date(?), date('now','-14 days')) LIMIT 1`)
        .get(o.konto_iban, o.empfaenger_iban, o.betrag_cents / 100, (o.submitted_at || '').slice(0, 10));
    }
    if (tx) upd.run(tx.id, o.id);
  }
}

router.post('/sync', requireView, async (req, res) => {
  try {
    const r = await doSync(req.body && req.body.days);
    require('../office/events').emit('bank', { kind: 'sync' });
    res.json(Object.assign({ ok: true }, r));
  } catch (e) {
    db.prepare(`UPDATE bank_gateway_config SET last_sync_status=? WHERE id=1`).run('Fehler: ' + String(e.message || e).slice(0, 300));
    res.status(502).json({ error: String(e.message || e) });
  }
});

router.get('/transactions', requireView, (req, res) => {
  const iban = String(req.query.iban || '').replace(/\s+/g, '').toUpperCase();
  if (!iban) return res.status(400).json({ error: 'iban fehlt.' });
  if (!visibleIbanFilter(req.session)(iban)) {
    return res.status(403).json({ error: 'Dieses Konto ist Ihrem Konto nicht zugeordnet.' });
  }
  const from = String(req.query.from || '').slice(0, 10);
  const to = String(req.query.to || '').slice(0, 10);
  const q = String(req.query.q || '').trim().toLowerCase();
  const LIMIT_MAX_V1592 = 2000, SUCH_SCAN_MAX_V1592 = 20000;
  const limit = Math.max(1, Math.min(LIMIT_MAX_V1592, parseInt(req.query.limit, 10) || 800));
  const WO_V1592 = `FROM bank_transactions t WHERE t.account_iban=?
      AND (?='' OR booking_date>=?) AND (?='' OR booking_date<=?)`;
  const SEL_V1592 = `SELECT t.*, EXISTS(
      SELECT 1 FROM finance_transactions f WHERE f.bank_tx_hash=t.dedupe_hash
    ) AS imported ` + WO_V1592 + ` ORDER BY booking_date DESC, rowid DESC LIMIT ?`;
  let rows, gesamt, scanGekappt = false;
  if (q) {
    /* V1.59.2 (Rechenkern-Audit B4): Das Suchwort wurde ERST auf die bereits per LIMIT gekappten
       (neuesten) Zeilen angewandt. Gemessen mit 2401 Umsaetzen: ?q=Buchung Nr 5 lieferte 0 Treffer,
       obwohl 111 Zeilen passen - die Suche fand nur, was zufaellig in den juengsten 800 stand.
       Jetzt wirkt das Limit auf das SUCHERGEBNIS. Gefiltert wird bewusst weiter in JavaScript und
       nicht per SQL-LIKE: SQLite faltet ohne ICU nur ASCII-Gross-/Kleinschreibung, ein LIKE haette
       bei Umlauten (MUELLER/Müller) Treffer verloren. Statt dessen ein begrenzter Scan. */
    const alle = db.prepare(SEL_V1592).all(iban, from, from, to, to, SUCH_SCAN_MAX_V1592 + 1);
    scanGekappt = alle.length > SUCH_SCAN_MAX_V1592;
    const treffer = (scanGekappt ? alle.slice(0, SUCH_SCAN_MAX_V1592) : alle)
      .filter(r => (r.counterparty || '').toLowerCase().includes(q)
        || (r.purpose || '').toLowerCase().includes(q));
    gesamt = treffer.length;
    rows = treffer.slice(0, limit);
  } else {
    gesamt = db.prepare('SELECT COUNT(*) AS n ' + WO_V1592).get(iban, from, from, to, to).n;
    rows = db.prepare(SEL_V1592).all(iban, from, from, to, to, limit);
  }
  /* V1.59.2 (Rechenkern-Audit B5): Bisher kappte die Route still bei 800 bzw. 2000 - wer aus der
     gelieferten Liste eine Summe bildete, bekam eine zu kleine Zahl OHNE jeden Hinweis (gemessen:
     -30.005,00 statt -31.208,00). Die Antwort sagt jetzt, wie viele Umsaetze es insgesamt gibt und
     ob gekappt wurde. Die bisherigen Felder bleiben unveraendert - reine Erweiterung. */
  const gekappt = rows.length < gesamt || scanGekappt;
  const hinweis = gekappt
    ? ('Es wurden ' + rows.length + ' von ' + gesamt + ' Umsätzen geliefert (Limit ' + limit +
       ', Höchstwert ' + LIMIT_MAX_V1592 + '). Die Liste ist NICHT vollständig – Summen daraus sind unvollständig.' +
       (scanGekappt ? ' Die Suche konnte nur die ' + SUCH_SCAN_MAX_V1592 + ' neuesten Umsätze durchsuchen.' : ''))
    : '';
  res.json({
    transactions: rows.map(r => ({
      id: r.id, bookingDate: r.booking_date, valueDate: r.value_date, amount: r.amount,
      currency: r.currency, counterparty: r.counterparty, counterpartyIban: r.counterparty_iban,
      purpose: r.purpose, balanceAfter: r.balance_after, dedupeHash: r.dedupe_hash,
      hibiscusId: r.hibiscus_id || '', imported: r.imported === 1
    })),
    gesamt, geliefert: rows.length, limit, limitMax: LIMIT_MAX_V1592, gekappt, scanGekappt, hinweis
  });
});

/* ---------------- Zahlungsauftraege ---------------- */
function ibanValid(iban) {
  const s = String(iban || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const ch of rearranged) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rest = (rest * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rest === 1;
}

function orderCaseId(kontoIban) {
  const hit = effectiveAccountCaseEntries().get(normAccountIban(kontoIban));
  return hit ? hit.caseId : null;
}

function publicOrder(r) {
  return {
    id: r.id, caseId: r.case_id, source: r.source, sourceRef: r.source_ref,
    kontoIban: r.konto_iban, empfaengerName: r.empfaenger_name, empfaengerIban: r.empfaenger_iban,
    empfaengerBic: r.empfaenger_bic, betragCents: r.betrag_cents, zweck: r.zweck, termin: r.termin,
    endToEndId: r.end_to_end_id, status: r.status, statusDetail: r.status_detail,
    hibiscusAuftragId: r.hibiscus_auftrag_id, matchedTxId: r.matched_tx_id,
    createdByName: r.created_by_name, createdAt: r.created_at,
    approvedByName: r.approved_by_name, approvedAt: r.approved_at, submittedAt: r.submitted_at
  };
}

function orderValidation(b) {
  const iban = String(b.empfaengerIban || '').replace(/\s+/g, '').toUpperCase();
  const konto = String(b.kontoIban || '').replace(/\s+/g, '').toUpperCase();
  const cents = Math.round(Number(b.betragCents));
  if (!konto) return 'Auftraggeber-Konto fehlt.';
  if (!String(b.empfaengerName || '').trim()) return 'Empfängername fehlt.';
  if (!ibanValid(iban)) return 'Die Empfänger-IBAN ist ungültig (Prüfziffer).';
  if (!isFinite(cents) || cents <= 0) return 'Der Betrag muss größer als 0 sein.';
  if (cents > 5000000) return 'Beträge über 50.000 € sind über dieses Modul nicht vorgesehen.';
  if (!String(b.zweck || '').trim()) return 'Verwendungszweck fehlt.';
  return null;
}

router.get('/orders', requireView, (req, res) => {
  const visible = sichtbareFaelle(req.session);
  const status = String(req.query.status || '');
  const caseId = String(req.query.caseId || '');
  let rows = db.prepare(`SELECT * FROM bank_payment_orders
    WHERE (?='' OR status=?) AND (?='' OR case_id=?)
    ORDER BY created_at DESC LIMIT 500`).all(status, status, caseId, caseId);
  if (visible) rows = rows.filter(r => !r.case_id || visible.has(String(r.case_id)));
  res.json({ orders: rows.map(publicOrder) });
});

function createOrder(session, b, meta) {
  if (!darfZahlen(session)) return ZAHLRECHT_FEHLT;
  b = b || {};
  const err = orderValidation(b);
  if (err) return { status: 400, json: { error: err } };
  const kontoIban = String(b.kontoIban).replace(/\s+/g, '').toUpperCase();
  const caseId = orderCaseId(kontoIban);
  if (caseId && !darfBearbeiten(session, caseId)) {
    return { status: 403, json: { error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' } };
  }
  const id = crypto.randomUUID();
  // end_to_end_id schon im Entwurf vergeben: verbindet den Auftrag spaeter mit der Bankbuchung.
  const e2e = 'BB' + Date.now().toString(36).toUpperCase() + id.slice(0, 8).toUpperCase().replace(/-/g, '');
  db.prepare(`INSERT INTO bank_payment_orders
      (id, case_id, source, source_ref, konto_iban, empfaenger_name, empfaenger_iban, empfaenger_bic,
       betrag_cents, zweck, termin, end_to_end_id, status, created_by, created_by_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'entwurf', ?, ?)`)
    .run(id, caseId, ['manual', 'debt', 'recurring'].includes(b.source) ? b.source : 'manual',
      String(b.sourceRef || '').slice(0, 80), kontoIban,
      String(b.empfaengerName).trim().slice(0, 70),
      String(b.empfaengerIban).replace(/\s+/g, '').toUpperCase(),
      String(b.empfaengerBic || '').trim().slice(0, 11),
      Math.round(Number(b.betragCents)), String(b.zweck).trim().slice(0, 140),
      String(b.termin || '').slice(0, 10), e2e.slice(0, 35),
      session.userId, (meta && meta.byName) || session.displayName || '');
  return { status: 201, json: { order: publicOrder(db.prepare('SELECT * FROM bank_payment_orders WHERE id=?').get(id)) } };
}
router.post('/orders', requirePay, (req, res) => {
  const r = createOrder(req.session, req.body);
  res.status(r.status).json(r.json);
});

/* MCP-Fernzugriff (2026-07-26): Kernschritte als reine Funktionen, damit routes/mcp-tools.js
   dieselbe Logik nutzt statt sie nachzubauen. Die HTTP-Routen delegieren nur noch. */
function getOrderChecked(session, id) {
  const r = db.prepare('SELECT * FROM bank_payment_orders WHERE id=?').get(id);
  if (!r) return { status: 404, json: { error: 'Auftrag nicht gefunden.' } };
  if (r.case_id && !darfSehen(session, r.case_id)) {
    return { status: 403, json: { error: 'Dieser Fall ist Ihrem Konto nicht zugeordnet.' } };
  }
  return { row: r };
}
function loadOrder(req, res) {
  const g = getOrderChecked(req.session, req.params.id);
  if (g.row) return g.row;
  res.status(g.status).json(g.json);
  return null;
}

router.put('/orders/:id', requirePay, (req, res) => {
  const r = loadOrder(req, res); if (!r) return;
  if (r.status !== 'entwurf') return res.status(409).json({ error: 'Nur Entwürfe können geändert werden.' });
  const b = Object.assign({}, publicOrder(r), req.body || {});
  const err = orderValidation(b);
  if (err) return res.status(400).json({ error: err });
  db.prepare(`UPDATE bank_payment_orders SET empfaenger_name=?, empfaenger_iban=?, empfaenger_bic=?,
    betrag_cents=?, zweck=?, termin=?, updated_at=datetime('now') WHERE id=?`)
    .run(String(b.empfaengerName).trim().slice(0, 70),
      String(b.empfaengerIban).replace(/\s+/g, '').toUpperCase(),
      String(b.empfaengerBic || '').trim().slice(0, 11),
      Math.round(Number(b.betragCents)), String(b.zweck).trim().slice(0, 140),
      String(b.termin || '').slice(0, 10), r.id);
  res.json({ order: publicOrder(db.prepare('SELECT * FROM bank_payment_orders WHERE id=?').get(r.id)) });
});

function approveOrder(session, id, meta) {
  if (!darfZahlen(session)) return ZAHLRECHT_FEHLT;
  const g = getOrderChecked(session, id); if (!g.row) return g;
  if (g.row.status !== 'entwurf') return { status: 409, json: { error: 'Nur Entwürfe können freigegeben werden.' } };
  // Bewusst KEIN erzwungenes Vier-Augen-Prinzip (Solo-Buero-Realitaet) - aber Ersteller und
  // Freigeber werden getrennt protokolliert, damit es nachvollziehbar bleibt.
  db.prepare(`UPDATE bank_payment_orders SET status='freigegeben', approved_by=?, approved_by_name=?,
    approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(session.userId, (meta && meta.byName) || session.displayName || '', g.row.id);
  return { status: 200, json: { ok: true } };
}
router.post('/orders/:id/approve', requirePay, (req, res) => {
  const r = approveOrder(req.session, req.params.id);
  res.status(r.status).json(r.json);
});

function cancelOrder(session, id) {
  if (!darfZahlen(session)) return ZAHLRECHT_FEHLT;
  const g = getOrderChecked(session, id); if (!g.row) return g;
  if (!['entwurf', 'freigegeben'].includes(g.row.status)) {
    return { status: 409, json: { error: 'Bereits eingereichte Aufträge können hier nicht storniert werden - bitte in Hibiscus bzw. bei der Bank.' } };
  }
  db.prepare(`UPDATE bank_payment_orders SET status='storniert', updated_at=datetime('now') WHERE id=?`).run(g.row.id);
  return { status: 200, json: { ok: true } };
}
router.post('/orders/:id/cancel', requirePay, (req, res) => {
  const r = cancelOrder(req.session, req.params.id);
  res.status(r.status).json(r.json);
});

router.delete('/orders/:id', requirePay, (req, res) => {
  const r = loadOrder(req, res); if (!r) return;
  if (!['entwurf', 'storniert'].includes(r.status)) {
    return res.status(409).json({ error: 'Nur Entwürfe und stornierte Aufträge können gelöscht werden.' });
  }
  db.prepare('DELETE FROM bank_payment_orders WHERE id=?').run(r.id);
  res.json({ ok: true });
});

function hibiscusKontoIdForIban(iban) {
  const r = db.prepare('SELECT hibiscus_id FROM bank_accounts_discovered WHERE connection_id=? AND iban=?')
    .get(GATEWAY_ID, String(iban || '').replace(/\s+/g, '').toUpperCase());
  return r && r.hibiscus_id ? r.hibiscus_id : null;
}

async function submitOrder(session, id) {
  if (!darfZahlen(session)) return ZAHLRECHT_FEHLT;
  const g = getOrderChecked(session, id); if (!g.row) return g;
  const r = g.row;
  if (r.status !== 'freigegeben') return { status: 409, json: { error: 'Nur freigegebene Aufträge können eingereicht werden.' } };
  const kontoId = hibiscusKontoIdForIban(r.konto_iban);
  if (!kontoId) return { status: 400, json: { error: 'Das Auftraggeber-Konto ist in Hibiscus nicht bekannt (Konten aktualisieren).' } };
  try {
    const auftragId = await hibiscus.ueberweisung(hibiscusCfg(), {
      kontoHibiscusId: kontoId, empfaengerName: r.empfaenger_name, empfaengerIban: r.empfaenger_iban,
      empfaengerBic: r.empfaenger_bic, betragCents: r.betrag_cents,
      zweck: r.zweck, terminIso: r.termin, endToEndId: r.end_to_end_id
    });
    db.prepare(`UPDATE bank_payment_orders SET status='eingereicht', hibiscus_auftrag_id=?,
      status_detail='An Hibiscus übergeben - Ausführung und TAN gemäß dortiger Konfiguration.',
      submitted_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .run(String(auftragId || ''), r.id);
    require('../office/events').emit('bank', { kind: 'order-submitted' });
    return { status: 200, json: { ok: true, hibiscusAuftragId: String(auftragId || '') } };
  } catch (e) {
    // Status bleibt 'freigegeben' (wiederholbar); der Fehler wird am Auftrag sichtbar.
    db.prepare(`UPDATE bank_payment_orders SET status_detail=?, updated_at=datetime('now') WHERE id=?`)
      .run('Einreichung fehlgeschlagen: ' + String(e.message || e).slice(0, 300), r.id);
    return { status: 502, json: { error: String(e.message || e) } };
  }
}
router.post('/orders/:id/submit', requirePay, async (req, res) => {
  const r = await submitOrder(req.session, req.params.id);
  res.status(r.status).json(r.json);
});

// Sammel-Einreichung: gruppiert nach Auftraggeber-Konto; >1 Auftrag je Konto wird zur
// Sammelueberweisung (EINE TAN je Konto - der Kern des Intervall-Konzepts).
async function submitBatch(session, ids, termin) {
  if (!darfZahlen(session)) return ZAHLRECHT_FEHLT;
  /* GELDABFLUSS (Audit 2026-07-26): die Liste wurde NICHT dedupliziert. submitBatch(s,[id,id,id])
     baute daraus eine Sammelueberweisung mit drei identischen Buchungen - dreifacher Betrag,
     EINE TAN, gemessen mit gemocktem Hibiscus (3 x 850,00 EUR = 2.550,00 EUR). Erreichbar ueber
     POST /orders/submit-batch und ueber den KI-Fernzugriff. Zusammen mit dem mehrfach
     freigebbaren Zahlungsvorschlag (Befund B4) liess sich derselbe Auftrag beliebig
     vervielfachen. Zwei Sicherungen: die ids werden dedupliziert, und ein bereits eingereichter
     Auftrag faellt ohnehin durch die Statuspruefung ('freigegeben') darunter. */
  const gesehen = new Set();
  ids = (Array.isArray(ids) ? ids.map(String) : []).filter(id => { if (gesehen.has(id)) return false; gesehen.add(id); return true; });
  if (!ids.length) return { status: 400, json: { error: 'ids fehlt.' } };
  const rowsGesehen = new Set();
  const rows = ids.map(id => db.prepare('SELECT * FROM bank_payment_orders WHERE id=?').get(id))
    .filter(r => r && !rowsGesehen.has(String(r.id)) && rowsGesehen.add(String(r.id)));
  for (const r of rows) {
    if (r.status !== 'freigegeben') return { status: 409, json: { error: 'Alle Aufträge müssen freigegeben sein (betroffen: ' + r.empfaenger_name + ').' } };
    if (r.case_id && !darfBearbeiten(session, r.case_id)) {
      return { status: 403, json: { error: 'Für mindestens einen Fall fehlt das Bearbeitungsrecht.' } };
    }
  }
  const byKonto = new Map();
  for (const r of rows) {
    if (!byKonto.has(r.konto_iban)) byKonto.set(r.konto_iban, []);
    byKonto.get(r.konto_iban).push(r);
  }
  const results = [];
  for (const [iban, list] of byKonto) {
    const kontoId = hibiscusKontoIdForIban(iban);
    if (!kontoId) { results.push({ iban, error: 'Konto in Hibiscus nicht bekannt.' }); continue; }
    try {
      if (list.length === 1) {
        const r = list[0];
        const auftragId = await hibiscus.ueberweisung(hibiscusCfg(), {
          kontoHibiscusId: kontoId, empfaengerName: r.empfaenger_name, empfaengerIban: r.empfaenger_iban,
          empfaengerBic: r.empfaenger_bic, betragCents: r.betrag_cents, zweck: r.zweck,
          terminIso: r.termin, endToEndId: r.end_to_end_id
        });
        db.prepare(`UPDATE bank_payment_orders SET status='eingereicht', hibiscus_auftrag_id=?,
          status_detail='An Hibiscus übergeben (einzeln).', submitted_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
          .run(String(auftragId || ''), r.id);
        results.push({ iban, count: 1, ok: true });
      } else {
        const auftragId = await hibiscus.sammelueberweisung(hibiscusCfg(), {
          kontoHibiscusId: kontoId,
          bezeichnung: 'Sammelüberweisung ' + new Date().toISOString().slice(0, 10),
          terminIso: termin || '',
          buchungen: list.map(r => ({
            empfaengerName: r.empfaenger_name, empfaengerIban: r.empfaenger_iban,
            betragCents: r.betrag_cents, zweck: r.zweck
          }))
        });
        const upd = db.prepare(`UPDATE bank_payment_orders SET status='eingereicht', hibiscus_auftrag_id=?,
          status_detail='Teil einer Sammelüberweisung (eine TAN für alle Posten dieses Kontos).',
          submitted_at=datetime('now'), updated_at=datetime('now') WHERE id=?`);
        for (const r of list) upd.run('S:' + String(auftragId || ''), r.id);
        results.push({ iban, count: list.length, ok: true, sammel: true });
      }
    } catch (e) {
      const msg = String(e.message || e).slice(0, 300);
      const upd = db.prepare(`UPDATE bank_payment_orders SET status_detail=?, updated_at=datetime('now') WHERE id=?`);
      for (const r of list) upd.run('Einreichung fehlgeschlagen: ' + msg, r.id);
      results.push({ iban, error: msg });
    }
  }
  require('../office/events').emit('bank', { kind: 'order-submitted' });
  const failed = results.filter(r => r.error);
  return { status: failed.length && failed.length === results.length ? 502 : 200, json: { ok: failed.length === 0, results } };
}
router.post('/orders/submit-batch', requirePay, async (req, res) => {
  const r = await submitBatch(req.session, (req.body || {}).ids, (req.body || {}).termin);
  res.status(r.status).json(r.json);
});

/* ---------------- Intervall-Zahlungen ---------------- */
function nextDueFrom(baseIso, intervall, tag) {
  const d = new Date((baseIso || new Date().toISOString().slice(0, 10)) + 'T12:00:00Z');
  const addMonths = { taeglich: 0, woechentlich: 0, vierzehntaegig: 0, monatlich: 1, vierteljaehrlich: 3, halbjaehrlich: 6, jaehrlich: 12 }[intervall];
  if (intervall === 'taeglich') d.setUTCDate(d.getUTCDate() + 1);
  else if (intervall === 'woechentlich') d.setUTCDate(d.getUTCDate() + 7);
  else if (intervall === 'vierzehntaegig') d.setUTCDate(d.getUTCDate() + 14);
  else {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + addMonths);
    d.setUTCDate(Math.max(1, Math.min(28, parseInt(tag, 10) || 1)));
  }
  return d.toISOString().slice(0, 10);
}

function publicRecurring(r) {
  return {
    id: r.id, caseId: r.case_id, kontoIban: r.konto_iban, empfaengerName: r.empfaenger_name,
    empfaengerIban: r.empfaenger_iban, empfaengerBic: r.empfaenger_bic, betragCents: r.betrag_cents,
    zweck: r.zweck, intervall: r.intervall, ausfuehrungstag: r.ausfuehrungstag,
    startDate: r.start_date, endDate: r.end_date, nextDue: r.next_due, aktiv: r.aktiv === 1, notiz: r.notiz
  };
}

router.get('/recurring', requireView, (req, res) => {
  const visible = sichtbareFaelle(req.session);
  let rows = db.prepare('SELECT * FROM bank_recurring_payments ORDER BY next_due').all();
  if (visible) rows = rows.filter(r => !r.case_id || visible.has(String(r.case_id)));
  const caseId = String(req.query.caseId || '');
  if (caseId) rows = rows.filter(r => String(r.case_id || '') === caseId);
  res.json({ recurring: rows.map(publicRecurring) });
});

function createRecurring(session, b) {
  if (!darfZahlen(session)) return ZAHLRECHT_FEHLT;
  b = b || {};
  const err = orderValidation(Object.assign({}, b, { termin: '' }));
  if (err) return { status: 400, json: { error: err } };
  const intervall = ['taeglich', 'woechentlich', 'vierzehntaegig', 'monatlich', 'vierteljaehrlich', 'halbjaehrlich', 'jaehrlich'].includes(b.intervall) ? b.intervall : 'monatlich';
  const kontoIban = String(b.kontoIban).replace(/\s+/g, '').toUpperCase();
  const caseId = orderCaseId(kontoIban);
  if (caseId && !darfBearbeiten(session, caseId)) {
    return { status: 403, json: { error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' } };
  }
  const tag = Math.max(1, Math.min(28, parseInt(b.ausfuehrungstag, 10) || 1));
  const start = String(b.startDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  // Tages- und Wochenintervalle beginnen exakt am gewaehlten Startdatum. Bei Monatsintervallen gilt der
  // Ausfuehrungstag im Startmonat oder, wenn er schon vorbei ist, im naechsten Intervall.
  let first = start;
  if (!['taeglich', 'woechentlich', 'vierzehntaegig'].includes(intervall)) {
    first = start.slice(0, 8) + String(tag).padStart(2, '0');
    if (first < start) first = nextDueFrom(first, intervall, tag);
  }
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO bank_recurring_payments
      (id, case_id, konto_iban, empfaenger_name, empfaenger_iban, empfaenger_bic, betrag_cents,
       zweck, intervall, ausfuehrungstag, start_date, end_date, next_due, aktiv, notiz, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`)
    .run(id, caseId, kontoIban, String(b.empfaengerName).trim().slice(0, 70),
      String(b.empfaengerIban).replace(/\s+/g, '').toUpperCase(), String(b.empfaengerBic || '').slice(0, 11),
      Math.round(Number(b.betragCents)), String(b.zweck).trim().slice(0, 140), intervall, tag,
      start, String(b.endDate || '').slice(0, 10), first, String(b.notiz || '').slice(0, 300),
      session.userId);
  return { status: 201, json: { recurring: publicRecurring(db.prepare('SELECT * FROM bank_recurring_payments WHERE id=?').get(id)) } };
}
router.post('/recurring', requirePay, (req, res) => {
  const r = createRecurring(req.session, req.body);
  res.status(r.status).json(r.json);
});

router.put('/recurring/:id', requirePay, (req, res) => {
  const r = db.prepare('SELECT * FROM bank_recurring_payments WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Intervall-Zahlung nicht gefunden.' });
  if (r.case_id && !darfBearbeiten(req.session, r.case_id)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  const b = req.body || {};
  db.prepare(`UPDATE bank_recurring_payments SET empfaenger_name=COALESCE(?, empfaenger_name),
      empfaenger_iban=COALESCE(?, empfaenger_iban), betrag_cents=COALESCE(?, betrag_cents),
      zweck=COALESCE(?, zweck), intervall=COALESCE(?, intervall), ausfuehrungstag=COALESCE(?, ausfuehrungstag),
      end_date=COALESCE(?, end_date), next_due=COALESCE(?, next_due), aktiv=COALESCE(?, aktiv),
      notiz=COALESCE(?, notiz), updated_at=datetime('now') WHERE id=?`)
    .run(b.empfaengerName != null ? String(b.empfaengerName).slice(0, 70) : null,
      b.empfaengerIban != null ? String(b.empfaengerIban).replace(/\s+/g, '').toUpperCase() : null,
      b.betragCents != null ? Math.round(Number(b.betragCents)) : null,
      b.zweck != null ? String(b.zweck).slice(0, 140) : null,
      b.intervall != null ? String(b.intervall) : null,
      b.ausfuehrungstag != null ? Math.max(1, Math.min(28, parseInt(b.ausfuehrungstag, 10) || 1)) : null,
      b.endDate != null ? String(b.endDate).slice(0, 10) : null,
      b.nextDue != null ? String(b.nextDue).slice(0, 10) : null,
      b.aktiv != null ? (b.aktiv ? 1 : 0) : null,
      b.notiz != null ? String(b.notiz).slice(0, 300) : null,
      r.id);
  res.json({ recurring: publicRecurring(db.prepare('SELECT * FROM bank_recurring_payments WHERE id=?').get(r.id)) });
});

router.delete('/recurring/:id', requirePay, (req, res) => {
  const r = db.prepare('SELECT * FROM bank_recurring_payments WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Intervall-Zahlung nicht gefunden.' });
  if (r.case_id && !darfBearbeiten(req.session, r.case_id)) {
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  }
  db.prepare('DELETE FROM bank_recurring_payments WHERE id=?').run(r.id);
  res.json({ ok: true });
});

// Faellige Intervall-Zahlungen in ENTWUERFE ueberfuehren. userId=null bedeutet Systemlauf.
function runRecurring(userId, userName) {
  const today = new Date().toISOString().slice(0, 10);
  const due = db.prepare(`SELECT * FROM bank_recurring_payments
    WHERE aktiv=1 AND next_due<>'' AND next_due<=? AND (end_date='' OR end_date>=next_due)`).all(today);
  const insOrder = db.prepare(`INSERT INTO bank_payment_orders
      (id, case_id, source, source_ref, konto_iban, empfaenger_name, empfaenger_iban, empfaenger_bic,
       betrag_cents, zweck, termin, end_to_end_id, status, created_by, created_by_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'entwurf', ?, ?)`);
  let erzeugt = 0;
  for (const r of due) {
    // Schutz gegen Doppel-Erzeugung: existiert schon ein nicht-stornierter Auftrag dieser
    // Intervall-Zahlung mit diesem Termin, wird nur die Faelligkeit fortgeschrieben.
    const gibtSchon = db.prepare(`SELECT 1 FROM bank_payment_orders
      WHERE source='recurring' AND source_ref=? AND termin=? AND status<>'storniert'`).get(r.id, r.next_due);
    if (!gibtSchon) {
      const id = crypto.randomUUID();
      const monat = r.next_due.slice(5, 7) + '.' + r.next_due.slice(0, 4);
      const zweck = String(r.zweck || '').replace(/\{MM\.JJJJ\}/g, monat).slice(0, 140);
      const e2e = ('BR' + Date.now().toString(36).toUpperCase() + id.slice(0, 8).toUpperCase().replace(/-/g, '')).slice(0, 35);
      insOrder.run(id, r.case_id, 'recurring', r.id, r.konto_iban, r.empfaenger_name,
        r.empfaenger_iban, r.empfaenger_bic, r.betrag_cents, zweck, r.next_due, e2e, userId, userName || 'Intervall-Lauf');
      erzeugt++;
    }
    db.prepare(`UPDATE bank_recurring_payments SET next_due=?, updated_at=datetime('now') WHERE id=?`)
      .run(nextDueFrom(r.next_due, r.intervall, r.ausfuehrungstag), r.id);
  }
  return { faellig: due.length, erzeugt };
}

router.post('/recurring/run', requirePay, (req, res) => {
  const r = runRecurring(req.session.userId, req.session.displayName || '');
  require('../office/events').emit('bank', { kind: 'recurring-run' });
  res.json(Object.assign({ ok: true }, r));
});

/* ---------------- Uebernahme in die Buero-Finanzen ---------------- */
// bank_transactions -> synthetischer Kontoauszug (source='fints') + finance_transactions mit
// bank_tx_hash. Die Spalten dafuer existieren seit dem alten FinTS-Plan (db.js:1002-1004) und
// werden hiermit erstmals wirklich befuellt.
// Rueckfallweg ohne FinTS-Verbindung: Kontoauszugs-DATEI (MT940/.sta oder CAMT.053/052/.xml)
// einspielen. Gleiche Zieltabelle und Dedupe-Mechanik wie der Hibiscus-Sync - ein spaeterer
// FinTS-Abruf derselben Umsaetze erzeugt also KEINE Dubletten (contentHash-Basis).
router.post('/import-file', gate('canEditFinance', 'Keine Berechtigung, Finanzen zu bearbeiten.'), express.json({ limit: '12mb' }), (req, res) => {
  const text = String(req.body && req.body.text || '');
  if (!text.trim()) return res.status(400).json({ error: 'text (Dateiinhalt) fehlt.' });
  let parsed;
  /* V1.59.2 (Freigabe 4): {multi:true} - diese Route spielt JE KONTO ein und darf deshalb als
     einzige eine Datei mit mehreren Auszuegen annehmen. Ohne das Opt-in weist der Parser sie
     weiterhin ab (Befund A4: sonst bekommen alle Umsaetze IBAN und Waehrung des ersten Kontos). */
  try { parsed = require('../../integrations/banking/bank-file.js').parseStatementFile(text, { multi: true }); }
  catch (e) { return res.status(400).json({ error: String(e.message || e) }); }
  const vorgabeV1592 = String(req.body && req.body.iban || '').replace(/\s+/g, '').toUpperCase();
  const gruppenV1592 = (Array.isArray(parsed.accounts) && parsed.accounts.length)
    ? parsed.accounts
    : [{ iban: parsed.iban, entries: parsed.entries }];
  /* Eine von aussen vorgegebene IBAN darf nur greifen, wenn die Datei GENAU EIN Konto enthaelt -
     sonst landeten die Umsaetze mehrerer Konten unter einer IBAN (genau Befund A4). */
  if (gruppenV1592.length > 1 && vorgabeV1592) {
    return res.status(400).json({ error: 'Die Datei enthält Kontoauszüge mehrerer Konten (' +
      gruppenV1592.map(g => g.iban || 'ohne IBAN').join(', ') + '); eine vorgegebene Konto-IBAN kann dann nicht zugeordnet werden. Bitte die Datei ohne IBAN-Vorgabe einspielen oder je Konto getrennt.' });
  }
  const zieleV1592 = gruppenV1592.map(g => ({
    iban: (gruppenV1592.length === 1 && vorgabeV1592) ? vorgabeV1592 : String(g.iban || '').replace(/\s+/g, '').toUpperCase(),
    entries: Array.isArray(g.entries) ? g.entries : []
  }));
  const ohneIbanV1592 = zieleV1592.filter(z => !ibanValid(z.iban));
  if (ohneIbanV1592.length) {
    return res.status(400).json({ error: 'Konto-IBAN fehlt oder ist ungültig (in der Datei stand: ' +
      (zieleV1592.map(z => z.iban || 'keine').join(', ') || 'keine') + ').' });
  }
  const ins = db.prepare(`INSERT OR IGNORE INTO bank_transactions
    (id, connection_id, account_iban, booking_date, value_date, amount, currency, counterparty, counterparty_iban, purpose, raw_json, dedupe_hash)
    VALUES (?, 'datei-import', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let neu = 0, uebersprungen = 0;
  const kontenV1592 = [];
  const txV1592 = db.transaction(() => {
    for (const ziel of zieleV1592) {
      /* A2: Zaehler je Konto und je Datei - die zweite gleichlautende Buchung DERSELBEN Datei ist
         eine andere Buchung, dieselbe Datei erneut eingelesen trifft wieder aufeinander. */
      const zaehler = new Map();
      let n = 0, u = 0;
      for (const e of ziel.entries) {
        /* EXAKT dieselbe kanonische Hash-Form wie der Hibiscus-Sync (contentHash nimmt ein
           Transaktions-Objekt) - dadurch erkennt ein spaeterer FinTS-Abruf die Datei-Umsaetze
           als bereits vorhanden und umgekehrt. */
        const hash = contentHashFolge(zaehler, contentHash({ accountIban: ziel.iban, datum: e.booking_date, betrag: Number(e.amount) || 0, zweck: e.purpose, gegenName: e.counterparty }));
        const r = ins.run(crypto.randomUUID(), ziel.iban, e.booking_date, e.value_date, e.amount, e.currency || 'EUR',
          e.counterparty || '', e.counterparty_iban || '', e.purpose || '', JSON.stringify(e), hash);
        if (r.changes) n++; else u++;
      }
      kontenV1592.push({ iban: ziel.iban, neu: n, uebersprungen: u, gesamt: ziel.entries.length });
      neu += n; uebersprungen += u;
    }
  });
  txV1592();
  res.json({
    ok: true, format: parsed.format, iban: zieleV1592[0].iban,
    konten: kontenV1592, mehrereKonten: zieleV1592.length > 1,
    neu, uebersprungen, gesamt: zieleV1592.reduce((s, z) => s + z.entries.length, 0)
  });
});

router.post('/import-office', gate('canEditFinance', 'Keine Berechtigung, Finanzen zu bearbeiten.'), (req, res) => {
  const b = req.body || {};
  const iban = String(b.iban || '').replace(/\s+/g, '').toUpperCase();
  if (!iban) return res.status(400).json({ error: 'iban fehlt.' });
  const assignment = effectiveAccountCaseEntries().get(iban);
  if (assignment && assignment.caseId) {
    return res.status(400).json({ error: 'Dieses Konto ist einem Fall zugeordnet und kann nicht in die Büro-Finanzen übernommen werden.' });
  }
  if (!visibleIbanFilter(req.session)(iban)) {
    return res.status(403).json({ error: 'Dieses Konto ist für Ihr Benutzerkonto nicht sichtbar.' });
  }
  const from = String(b.from || '').slice(0, 10);
  const to = String(b.to || '').slice(0, 10);
  const konto = b.konto === 'privat' ? 'privat' : 'geschaeftlich';
  const rows = db.prepare(`SELECT * FROM bank_transactions WHERE account_iban=?
      AND (?='' OR booking_date>=?) AND (?='' OR booking_date<=?) ORDER BY booking_date`).all(iban, from, from, to, to);
  if (!rows.length) return res.status(404).json({ error: 'Im gewählten Zeitraum liegen keine abgerufenen Umsätze vor (zuerst „Umsätze abrufen").' });
  const stId = crypto.randomUUID();
  db.prepare(`INSERT INTO finance_statements (id, filename, mime_type, size, konto, parse_status, uploaded_by, source, connection_id)
    VALUES (?,?,?,0,?, 'done', ?, 'fints', ?)`)
    .run(stId, 'Bankabruf ' + iban.slice(0, 8) + '… ' + (from || 'Beginn') + ' – ' + (to || 'heute'),
      'application/json', konto, req.session.userId, GATEWAY_ID);
  const ins = db.prepare(`INSERT INTO finance_transactions
      (id, statement_id, konto, booking_date, counterparty, purpose, amount, currency, bank_tx_hash)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  let neu = 0, dubletten = 0;
  const tx = db.transaction((list) => {
    for (const t of list) {
      const schon = db.prepare('SELECT 1 FROM finance_transactions WHERE bank_tx_hash=?').get(t.dedupe_hash);
      if (schon) { dubletten++; continue; }
      ins.run(crypto.randomUUID(), stId, konto, t.booking_date, t.counterparty, t.purpose, t.amount, t.currency || 'EUR', t.dedupe_hash);
      neu++;
    }
  });
  tx(rows);
  if (neu === 0) {
    // Leeres Statement wieder entfernen - sonst sammeln sich Huellen an.
    db.prepare('DELETE FROM finance_statements WHERE id=?').run(stId);
    return res.json({ ok: true, neu: 0, dubletten, hinweis: 'Alle Umsätze waren bereits übernommen.' });
  }
  require('../office/events').emit('finance', { kind: 'bank-import' });
  res.status(201).json({ ok: true, statementId: stId, neu, dubletten });
});

/* ---------------- Zeitgesteuerter Abruf ---------------- */
let schedulerTimer = null;
let schedulerBusy = false;
function startScheduler() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(async () => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    try {
      await applicationWriteBarrier.withWrite('Automatischer Bankabgleich', async () => {
        try {
          const cfg = readConfig();
          if (cfg.sync_enabled !== 1 || !cfg.password_encrypted) return;
          const last = cfg.last_sync_at ? Date.parse(cfg.last_sync_at.replace(' ', 'T') + 'Z') : 0;
          if (Date.now() - last < (cfg.sync_interval_min || 240) * 60000) return;
          await doSync(30);
          // Einmal am Tag (erster Sync nach Mitternacht) auch die Intervall-Zahlungen in Entwuerfe giessen.
          const today = new Date().toISOString().slice(0, 10);
          if ((cfg.last_recurring_run || '') !== today) {
            runRecurring(null, 'Intervall-Lauf');
            db.prepare('UPDATE bank_gateway_config SET last_recurring_run=? WHERE id=1').run(today);
          }
          require('../office/events').emit('bank', { kind: 'sync' });
        } catch (error) {
          db.prepare('UPDATE bank_gateway_config SET last_sync_status=? WHERE id=1')
            .run('Fehler (automatisch): ' + String(error.message || error).slice(0, 300));
          throw error;
        }
      });
    } catch (_e) {
      /* Fehlerstatus wurde noch innerhalb der Schreibbarriere gespeichert. */
    } finally {
      schedulerBusy = false;
    }
  }, 60000);
  if (schedulerTimer.unref) schedulerTimer.unref();
}

module.exports = router;
module.exports.startScheduler = startScheduler;
module.exports._test = { ibanValid, nextDueFrom, runRecurring, doSync, contentHash };
// Fuer den MCP-Fernzugriff: dieselben Kernschritte, keine Nachbauten (PLAN-MCP-Server.md).
module.exports._api = { createOrder, approveOrder, submitOrder, getOrderChecked, publicOrder, createRecurring, publicRecurring, cancelOrder, submitBatch };
