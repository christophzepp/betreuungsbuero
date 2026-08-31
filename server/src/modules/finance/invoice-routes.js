// Büroorganisation - Ausgangsrechnungen (Plan Abschnitt AL, Phase 4): büroweiter Rechnungsausgang
// des Betreuungsbüros. Kein Gehaltsbezug (anders als Finanzen) - läuft daher hinter der bestehenden
// Fallverwaltungs-Berechtigung (requireViewCases/requireEditCases), keine eigene neue Berechtigung
// nötig. differenz (Eingangsbetrag - Summe) wird bewusst nicht gespeichert, sondern clientseitig
// live berechnet (wie im Original-Excel per SUM-Formel je Zeile).

const express = require('express');
const crypto = require('crypto');
const db = require('../../database/index');
const { requireAuth, requireViewCases, requireEditCases, requireViewFinance } = require('../../middleware/authentication');

const router = express.Router();
router.use(requireAuth);
// Echtzeit (2026-07-19): erfolgreiche Schreiboperationen an alle Fenster/Nutzer melden.
router.use(require('../office/events').middleware('invoices'));

const listStmt = db.prepare('SELECT * FROM outgoing_invoices ORDER BY (re_datum = \'\'), re_datum DESC, created_at DESC');
const getStmt = db.prepare('SELECT * FROM outgoing_invoices WHERE id = ?');
const insertStmt = db.prepare(`
  INSERT INTO outgoing_invoices (id, re_datum, re_nummer, empfaenger, verwendungszweck, case_label, rechnungszeitraum, summe, eingang_datum, eingangsbetrag,
                                 status, faellig_am, bewilligt_am, report_id, case_id, updated_by)
  VALUES (@id, @reDatum, @reNummer, @empfaenger, @verwendungszweck, @caseLabel, @rechnungszeitraum, @summe, @eingangDatum, @eingangsbetrag,
          @status, @faelligAm, @bewilligtAm, @reportId, @caseId, @userId)
`);
const updateStmt = db.prepare(`
  UPDATE outgoing_invoices SET re_datum=@reDatum, re_nummer=@reNummer, empfaenger=@empfaenger, verwendungszweck=@verwendungszweck,
    case_label=@caseLabel, rechnungszeitraum=@rechnungszeitraum, summe=@summe, eingang_datum=@eingangDatum, eingangsbetrag=@eingangsbetrag,
    status=@status, faellig_am=@faelligAm, bewilligt_am=@bewilligtAm, report_id=@reportId, case_id=@caseId,
    updated_at=datetime('now'), updated_by=@userId
  WHERE id=@id
`);
const deleteStmt = db.prepare('DELETE FROM outgoing_invoices WHERE id = ?');
const caseExistsStmt = db.prepare('SELECT id FROM cases WHERE id = ?');

/* Fallkennung und Dokumentart (25.08.2026). Eine ANGEGEBENE Kennung muss stimmen - sonst
   entstuende ein Verweis ins Leere, der schlimmer waere als das Freitext-Label, das er ersetzt.
   Leer bleibt ausdruecklich erlaubt: 13 der vorhandenen Rechnungen haben keinen Fallbezug, und
   fallfreie Rechnungen (Bueromiete, Fortbildung) soll es weiter geben duerfen.
   reportId benennt die DOKUMENTART im Fall ('remuneration'); zusammen mit caseId zeigt sie auf
   genau eine Zeile in case_reports (UNIQUE(case_id, report_id)). Geprueft wird nur die Form -
   welche Dokumentarten es gibt, weiss allein der Client. */
function fallPruefen(caseId) {
  const wert = String(caseId || '').slice(0, 80).trim();
  if (!wert) return { ok: true, wert: '' };
  if (!caseExistsStmt.get(wert)) return { ok: false, fehler: 'Der angegebene Fall existiert nicht.' };
  return { ok: true, wert };
}
function dokumentart(reportId) {
  const wert = String(reportId || '').slice(0, 80).trim();
  return /^[A-Za-z0-9_.-]*$/.test(wert) ? wert : '';
}

/* Statusmodell (Nutzerentscheidung 25.08.2026): gestellt -> bewilligt -> bezahlt, dazu
   teilbezahlt und storniert. 'ueberfaellig' ist KEIN gespeicherter Wert, sondern wird aus
   Faelligkeit + Zahlungsstand abgeleitet - sonst muesste taeglich ein Auftrag Zeilen umschreiben. */
const STATUS = new Set(['', 'gestellt', 'bewilligt', 'teilbezahlt', 'bezahlt', 'storniert']);
function reinerStatus(wert, fallback) {
  const s = String(wert == null ? '' : wert).trim();
  return STATUS.has(s) ? s : (fallback || '');
}
/* Zahlungsziel: 30 Tage ab Rechnungsdatum (Nutzerentscheidung), je Rechnung ueberschreibbar.
   Akzeptiert ISO und TT.MM.JJJJ, liefert immer ISO - die App schreibt beide Formate. */
function alsIso(wert) {
  const t = String(wert || '').trim();
  const de = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
  if (de) return `${de[3]}-${de[2]}-${de[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
}
function standardFaelligkeit(reDatum) {
  const iso = alsIso(reDatum);
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 30);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function publicInvoice(row) {
  return {
    id: row.id,
    reDatum: row.re_datum,
    reNummer: row.re_nummer,
    empfaenger: row.empfaenger,
    verwendungszweck: row.verwendungszweck,
    caseLabel: row.case_label,
    rechnungszeitraum: row.rechnungszeitraum,
    summe: row.summe,
    eingangDatum: row.eingang_datum || '',
    eingangsbetrag: row.eingangsbetrag,
    status: row.status || '',
    faelligAm: row.faellig_am || standardFaelligkeit(row.re_datum),
    bewilligtAm: row.bewilligt_am || '',
    reportId: row.report_id || '',
    caseId: row.case_id || '',
    updatedAt: row.updated_at
  };
}

function invoicesBody() {
  return { invoices: listStmt.all().map(publicInvoice) };
}

router.get('/', requireViewCases, (req, res) => {
  res.json(invoicesBody());
});

// Nutzerwunsch: der Vergütungsantrag (Dokument "Betreuervergütung") soll sich die naechste freie
// Rechnungsnummer aus der Ausgangsrechnungen-Liste holen koennen. Format aus der echten Buero-Excel
// uebernommen: "NNN-JJJJ" (dreistellig, pro Jahr neu beginnend bei 001), siehe Plan-Kontext.
router.get('/next-number', requireViewCases, (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year || '')) ? String(req.query.year) : String(new Date().getFullYear());
  /* Zwei Nummernkreise im Umlauf (Befund 25.08.2026): das alte Muster NNN-JJJJ und die im Haus
     gefuehrte Serie RE-JJJJ-NNNN. Frueher kannte die Vergabe nur das erste - bei bestehender
     RE-Serie schlug sie kommentarlos "001-2026" vor und begann eine zweite Zaehlung.
     Jetzt wird BEIDES erkannt und im jeweils vorherrschenden Format fortgesetzt. */
  /* Offene Breite: eine vierstellige Serie darf ueber 9999 hinauswachsen, statt dieselbe
     Nummer endlos zu wiederholen. padStart haelt nur die Mindestbreite. */
  const alt = new RegExp(`^(\\d{3,})-${year}$`);
  const neu = new RegExp(`^RE-${year}-(\\d{4,})$`);
  const reIrgendwann = /^RE-\d{4}-\d{4,}$/;
  let maxAlt = 0; let maxNeu = 0; let reSerieGefuehrt = false;
  for (const row of listStmt.all()) {
    const nummer = String(row.re_nummer || '').trim();
    const a = alt.exec(nummer); if (a) maxAlt = Math.max(maxAlt, Number(a[1]));
    const n = neu.exec(nummer); if (n) maxNeu = Math.max(maxNeu, Number(n[1]));
    if (reIrgendwann.test(nummer)) reSerieGefuehrt = true;   /* auch aus Vorjahren */
  }
  /* Die im Haus gefuehrte Serie gewinnt - auch im Januar, wenn es fuer das neue Jahr noch
     keine Nummer gibt (sonst faellt die Vergabe zum Jahreswechsel auf das Altformat zurueck). */
  const istRe = maxNeu > 0 || reSerieGefuehrt;
  const next = istRe
    ? `RE-${year}-${String(maxNeu + 1).padStart(4, '0')}`
    : `${String(maxAlt + 1).padStart(3, '0')}-${year}`;
  res.json({ nextNumber: next, year, serie: istRe ? 'RE' : 'kurz' });
});

/* Zahlungsvorschlaege (Vergütungs-Pipeline): offene Rechnungen gegen die Kontoumsaetze der
   Buerofinanzen halten. BEWUSST nur ein Vorschlag, keine Automatik - gebucht wird per Klick.
   Treffer entstehen, wenn die RE-Nummer im Verwendungszweck steht ODER Betrag und Zeitfenster
   passen; die Guete wird mitgeliefert, damit die Oberflaeche sie unterscheiden kann. */
/* Die Vorschlaege lesen Buerofinanz-Buchungen - deshalb ZUSAETZLICH das Finanzrecht verlangen.
   Ohne das haetten Fallbearbeiter ohne canViewFinance Kontoumsaetze des Bueros gesehen. */
router.get('/zahlungsvorschlaege', requireViewCases, requireViewFinance, (req, res) => {
  let buchungen = [];
  try {
    buchungen = db.prepare(`SELECT id, booking_date, counterparty, purpose, amount
      FROM finance_transactions WHERE amount > 0 ORDER BY booking_date DESC LIMIT 800`).all();
  } catch (_error) { buchungen = []; }   /* Buerofinanzen noch nie benutzt: einfach keine Vorschlaege */
  /* Dieselbe Statuswahrheit wie im Client (invoiceStatusOf) - sonst schlaegt die Pipeline
     Rechnungen zur Buchung vor, die die Liste laengst als bezahlt zeigt. */
  const istOffen = (r) => {
    if ((r.status || '') === 'storniert') return false;
    const summe = Number(r.summe || 0);
    const eingang = r.eingangsbetrag == null ? null : Number(r.eingangsbetrag);
    if (eingang != null && eingang + 0.005 >= summe) return false;
    if (String(r.eingang_datum || '').trim() && (eingang == null || summe <= 0)) return false;
    if ((r.status || '') === 'bezahlt') return false;
    return true;
  };
  const offen = listStmt.all().filter(istOffen);
  const MAX = 200;                       /* Gesamtdeckel gegen aufgeblaehte Antworten */
  const PRO_RECHNUNG = 3;
  const vergeben = new Set();            /* eine Buchung wird hoechstens EINMAL vorgeschlagen */
  const vorschlaege = [];
  /* Zwei Durchgaenge: erst die eindeutigen Nummerntreffer reservieren, danach die reinen
     Betragstreffer. Ohne das wuerde dieselbe Zahlung mehreren gleich hohen Quartalsrechnungen
     angeboten - und zweimal gebucht (Befund Review 25.08.). */
  for (const runde of ['nummer', 'betrag']) {
    for (const rechnung of offen) {
      if (vorschlaege.length >= MAX) break;
      const nummer = String(rechnung.re_nummer || '').trim();
      const summe = Number(rechnung.summe || 0);
      const reIso = alsIso(rechnung.re_datum);
      let jeRechnung = vorschlaege.filter((v) => v.invoiceId === rechnung.id).length;
      for (const b of buchungen) {
        if (jeRechnung >= PRO_RECHNUNG || vorschlaege.length >= MAX) break;
        if (vergeben.has(b.id)) continue;
        const zweck = String(b.purpose || '');
        const perNummer = nummer.length >= 4 && zweck.replace(/\s+/g, '').includes(nummer.replace(/\s+/g, ''));
        const betragPasst = summe > 0 && Math.abs(Number(b.amount || 0) - summe) < 0.005;
        const imFenster = !reIso || String(b.booking_date || '') >= reIso;
        if (runde === 'nummer' ? !perNummer : (perNummer || !(betragPasst && imFenster))) continue;
        vergeben.add(b.id);
        jeRechnung += 1;
        vorschlaege.push({
          invoiceId: rechnung.id, reNummer: nummer, summe,
          buchungId: b.id, buchungsdatum: b.booking_date, betrag: b.amount,
          zahler: b.counterparty || '', zweck: zweck.slice(0, 200),
          guete: perNummer && betragPasst ? 'sicher' : (perNummer ? 'nummer' : 'betrag'),
        });
      }
    }
  }
  res.json({ vorschlaege, gekuerzt: vorschlaege.length >= MAX });
});

router.post('/', requireEditCases, (req, res) => {
  const { reDatum, reNummer, empfaenger, verwendungszweck, caseLabel, rechnungszeitraum, summe, eingangDatum, eingangsbetrag,
    status, faelligAm, bewilligtAm, reportId, caseId } = req.body || {};
  if (!reNummer || !String(reNummer).trim()) return res.status(400).json({ error: 'RE-Nummer erforderlich.' });
  const row = {
    id: crypto.randomUUID(),
    reDatum: reDatum || '',
    reNummer: String(reNummer).trim(),
    empfaenger: empfaenger || '',
    verwendungszweck: verwendungszweck || '',
    caseLabel: caseLabel || '',
    rechnungszeitraum: rechnungszeitraum || '',
    summe: Number(summe) || 0,
    eingangDatum: eingangDatum || null,
    eingangsbetrag: eingangsbetrag != null && eingangsbetrag !== '' ? Number(eingangsbetrag) : null,
    status: reinerStatus(status, 'gestellt'),
    faelligAm: alsIso(faelligAm) || standardFaelligkeit(reDatum),
    bewilligtAm: alsIso(bewilligtAm),
    reportId: dokumentart(reportId),
    caseId: '',
    userId: req.session.userId
  };
  const fall = fallPruefen(caseId);
  if (!fall.ok) return res.status(400).json({ error: fall.fehler });
  row.caseId = fall.wert;
  insertStmt.run(row);
  res.status(201).json({ invoice: publicInvoice(getStmt.get(row.id)) });
});

router.put('/:id', requireEditCases, (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
  const { reDatum, reNummer, empfaenger, verwendungszweck, caseLabel, rechnungszeitraum, summe, eingangDatum, eingangsbetrag,
    status, faelligAm, bewilligtAm, reportId, caseId } = req.body || {};
  const next = {
    id: row.id,
    reDatum: reDatum != null ? reDatum : row.re_datum,
    reNummer: reNummer != null ? String(reNummer).trim() : row.re_nummer,
    empfaenger: empfaenger != null ? empfaenger : row.empfaenger,
    verwendungszweck: verwendungszweck != null ? verwendungszweck : row.verwendungszweck,
    caseLabel: caseLabel != null ? caseLabel : row.case_label,
    rechnungszeitraum: rechnungszeitraum != null ? rechnungszeitraum : row.rechnungszeitraum,
    summe: summe != null ? Number(summe) || 0 : row.summe,
    eingangDatum: eingangDatum !== undefined ? (eingangDatum || null) : row.eingang_datum,
    eingangsbetrag: eingangsbetrag !== undefined ? (eingangsbetrag === '' || eingangsbetrag === null ? null : Number(eingangsbetrag)) : row.eingangsbetrag,
    status: status !== undefined ? reinerStatus(status, row.status || 'gestellt') : (row.status || ''),
    /* Leer heisst "Standard", nicht "loeschen" - sonst raeumt jedes Bearbeiten das Zahlungsziel ab
       und nichts koennte je ueberfaellig werden (Befund Review 25.08.). */
    faelligAm: faelligAm !== undefined
      ? (alsIso(faelligAm) || standardFaelligkeit(reDatum != null ? reDatum : row.re_datum))
      : (row.faellig_am || ''),
    bewilligtAm: bewilligtAm !== undefined ? alsIso(bewilligtAm) : (row.bewilligt_am || ''),
    reportId: reportId !== undefined ? dokumentart(reportId) : (row.report_id || ''),
    /* Nicht gesendet heisst "unveraendert" - dadurch ueberlebt die Verknuepfung einen Excel-
       Reimport und jeden Altclient, der die Felder gar nicht kennt. Eine BESTEHENDE Kennung
       wird bewusst nicht nachtraeglich geprueft: Wird ein Fall geloescht, bleibt der Verweis
       als Beleg der Honorarbuchhaltung stehen und wird beim Lesen weich aufgeloest. */
    caseId: caseId !== undefined ? '' : (row.case_id || ''),
    userId: req.session.userId
  };
  if (caseId !== undefined) {
    const fall = fallPruefen(caseId);
    if (!fall.ok) return res.status(400).json({ error: fall.fehler });
    next.caseId = fall.wert;
  } else if (caseLabel != null && String(caseLabel).trim() !== String(row.case_label || '').trim()) {
    /* Etikett GEAENDERT, aber keine Kennung mitgeschickt - genau die Nutzlast des Excel-
       Reimports (Spalte E des Blatts "Ausgangsrechnungen") und jedes Altclients, der die
       Kennung gar nicht kennt. Bliebe die alte Kennung stehen, zeigte sie fortan auf Fall A,
       waehrend Liste, PDF und Excel den Namen von Fall B drucken. Weil die Kennung ueberall
       das Etikett schlaegt, waere dieser Widerspruch in der Oberflaeche unsichtbar - und die
       Verguetungsfrist des FALSCHEN Falles gaelte als erledigt (Befund Review 25.08.).
       Deshalb wird die Kennung hier freigegeben; den Rest erledigt der schon vorhandene
       Trigger outgoing_invoices_case_id_from_unique_label_update: er erhebt ein EINDEUTIGES
       Etikett wieder zur Kennung und setzt bei Mehrdeutigkeit bewusst nichts (lieber kein
       Verweis als ein falscher). Ist das neue Etikett leer, bleibt es dabei - das Blatt sagt
       "kein Fall", und genau das steht danach auch im Datensatz.
       Ein UNVERAENDERTES Etikett loest nichts aus: die Verknuepfung ueberlebt jeden Reimport,
       so wie es der Kommentar oben verspricht. Verglichen wird ohne Randleerzeichen, weil der
       Reimport jede Zelle trimmt - reine Leerzeichen sind keine Fallaenderung. */
    next.caseId = '';
  }
  updateStmt.run(next);
  res.json({ invoice: publicInvoice(getStmt.get(row.id)) });
});

router.delete('/:id', requireEditCases, (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
  deleteStmt.run(row.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.intern = { invoicesBody };
