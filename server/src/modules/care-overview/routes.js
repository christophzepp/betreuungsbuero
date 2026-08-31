// Betreuungsübersicht (Plan Abschnitt AL, Phase 2) - die vom Betreuungsgericht/der Betreuungsbehörde
// alle sechs Monate angeforderte Liste aller aktuellen Betreuungen samt Änderungen. Baut sich
// automatisch aus den bereits geladenen Fällen zusammen (Gericht/Aktenzeichen/Name/... kommen direkt
// aus cases.stammdaten_json, siehe extractOverviewRow) - nur die transienten, meldezeitraum-
// bezogenen Felder (Änderungsart/Übergabe an) werden separat in betreuung_overview_entries gepflegt,
// siehe dortiger DB-Kommentar. "Archiv"-Sicht (archivierte Fälle) nutzt denselben Endpunkt mit
// ?scope=archived, damit beide Listen exakt dieselbe Aufbereitungslogik teilen.

const express = require('express');
const { sichtbareFaelle } = require('../cases/case-visibility');
const { isDemoCaseId } = require('../demo/data-identities');
const db = require('../../database/index');
const { requireAuth, requireViewCases, requireEditCases } = require('../../middleware/authentication');

const router = express.Router();
router.use(requireAuth);

const listCasesStmt = db.prepare('SELECT id, label, file_number, stammdaten_json, archived FROM cases ORDER BY label COLLATE NOCASE');
const getEntryStmt = db.prepare('SELECT * FROM betreuung_overview_entries WHERE case_id = ? AND period_start = ?');
const listHistoryStmt = db.prepare(`
  SELECT e.case_id, e.period_start, e.aenderungsart, e.uebergabe_an, e.updated_at, c.label
  FROM betreuung_overview_entries e
  JOIN cases c ON c.id = e.case_id
  WHERE TRIM(e.aenderungsart) <> '' OR TRIM(e.uebergabe_an) <> ''
  ORDER BY e.updated_at DESC, e.period_start DESC
`);
const upsertEntryStmt = db.prepare(`
  INSERT INTO betreuung_overview_entries (case_id, period_start, aenderungsart, uebergabe_an, updated_by)
  VALUES (@caseId, @periodStart, @aenderungsart, @uebergabeAn, @userId)
  ON CONFLICT(case_id, period_start) DO UPDATE SET
    aenderungsart = excluded.aenderungsart,
    uebergabe_an = excluded.uebergabe_an,
    updated_at = datetime('now'),
    updated_by = excluded.updated_by
`);

// Liest genau die Stammdaten-Felder, die die Betreuungsübersicht braucht - bewusst tolerant
// gegenüber fehlenden Feldern (aeltere Faelle kennen homePlacement/takeoverDate/nextAccountingDue
// noch nicht, siehe EMPTY_STAMMDATEN-Kommentar in routes/cases.js).
function extractOverviewRow(row, entry) {
  let stammdaten = {};
  try { stammdaten = JSON.parse(row.stammdaten_json || '{}'); } catch (_e) { /* defekte/leere Zeile ignorieren */ }
  const care = stammdaten.care || {};
  const person = stammdaten.person || {};
  return {
    caseId: row.id,
    court: care.courtName || '',
    fileNumber: care.fileNumber || row.file_number || '',
    lastName: person.lastName || '',
    firstName: person.firstName || '',
    authority: care.authorityName || '',
    preliminaryOrderDate: care.preliminaryOrderDate || '',
    /* Nebenbefund 24.08., behoben 25.08.: Die Fristenlogik (buildDeadlines -> __caseDeadlines)
       erwartet das gerichtliche Ueberpruefungsdatum je Zeile. Die LOKALE Fassung (buLocalItemsFor)
       lieferte es immer, diese Server-Zeile nicht - online fiel die Ueberpruefungsfrist deshalb
       still auf die 7-Jahres-Regel zurueck. */
    reviewDate: care.reviewDate || '',
    homePlacement: care.homePlacement || '',
    startDate: care.startDate || '',
    takeoverDate: care.takeoverDate || '',
    nextAccountingDue: care.nextAccountingDue || '',
    aenderungsart: entry ? entry.aenderungsart : '',
    uebergabeAn: entry ? entry.uebergabe_an : '',
    entryUpdatedAt: entry ? entry.updated_at : null
  };
}

router.get('/', requireViewCases, (req, res) => {
  const periodStart = String(req.query.periodStart || '').trim();
  if (!periodStart) return res.status(400).json({ error: 'periodStart erforderlich (YYYY-MM-DD).' });
  const scope = req.query.scope === 'archived' ? 1 : 0;
  /* Fallbezogene Sichtbarkeit (2026-07-26): die Uebersicht listet Gericht, Aktenzeichen und
     Klarnamen aller Betreuten. */
  const erlaubt = sichtbareFaelle(req.session);
  const rows = listCasesStmt.all()
    .filter((c) => !isDemoCaseId(c.id))
    .filter((c) => !!c.archived === !!scope)
    .filter((c) => erlaubt === null || erlaubt.has(String(c.id)));
  const items = rows.map((row) => extractOverviewRow(row, getEntryStmt.get(row.id, periodStart)));
  res.json({ periodStart, scope: scope ? 'archived' : 'active', items });
});

router.get('/history', requireViewCases, (req, res) => {
  const erlaubt = sichtbareFaelle(req.session);
  const entries = listHistoryStmt.all()
    .filter((entry) => !isDemoCaseId(entry.case_id))
    .filter((entry) => erlaubt === null || erlaubt.has(String(entry.case_id)))
    .map((entry) => ({
      caseId: entry.case_id,
      caseLabel: entry.label || entry.case_id,
      periodStart: entry.period_start,
      aenderungsart: entry.aenderungsart || '',
      uebergabeAn: entry.uebergabe_an || '',
      updatedAt: entry.updated_at
    }));
  res.json({ entries });
});

router.put('/entries/:caseId', requireEditCases, (req, res) => {
  const { caseId } = req.params;
  const { periodStart, aenderungsart, uebergabeAn } = req.body || {};
  if (!periodStart) return res.status(400).json({ error: 'periodStart erforderlich (YYYY-MM-DD).' });
  const caseRow = db.prepare('SELECT id FROM cases WHERE id = ?').get(caseId);
  if (!caseRow) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  upsertEntryStmt.run({
    caseId, periodStart,
    aenderungsart: aenderungsart != null ? String(aenderungsart) : '',
    uebergabeAn: uebergabeAn != null ? String(uebergabeAn) : '',
    userId: req.session.userId
  });
  res.json({ entry: getEntryStmt.get(caseId, periodStart) });
});

module.exports = router;
