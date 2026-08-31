'use strict';
/* Controlling (25.08.2026) - Datenlieferant fuer den gleichnamigen Reiter.
 *
 * WAS die Route liefert: je Fall genau die vier Dimensionen, aus denen sich die VBVG-Verguetung
 * ergibt (Verguetungsstufe, mittellos/nicht mittellos, stationaer/andere Wohnform, Laufzeit ueber
 * startDate/endDate) plus die Zuordnung (Betreuer, Aktenzeichen, Archivstatus).
 *
 * WAS die Route bewusst NICHT liefert: Euro. Die VBVG-Saetze stehen als REM_RATES im Client und
 * duerfen hier nicht gedoppelt werden - zwei Kopien derselben Tabelle laufen unweigerlich
 * auseinander, und dann rechnet die Uebersicht anders als der Verguetungsantrag, aus dem die
 * Zahlen stammen. Der Server nennt die Dimensionen, der Client multipliziert.
 * Ebenfalls nicht geliefert: das vollstaendige stammdaten_json. Fuer eine Summenliste braucht
 * niemand Diagnosen, Konten oder Angehoerige - deshalb liest die Abfrage per json_extract nur die
 * benoetigten Felder aus der Datenbank heraus (Muster: listCasesStmt in modules/cases/routes.js).
 *
 * WARUM trotz Bueroweite die Fallsichtbarkeit gilt: Controlling ist eine Bueroauswertung, die
 * Liste besteht aber aus einzelnen Fallakten mit Klarnamen und Aktenzeichen. Wer einen Fall sonst
 * nirgends sehen darf, darf ihn auch hier nicht sehen - sonst waere der Reiter der bequemste Weg,
 * die Fallsperre zu umgehen. Damit die dann fehlenden Zeilen nicht als "das Buero hat eben nur so
 * viele Faelle" missverstanden werden, meldet die Antwort mit `vollstaendig`/`gesamt` ausdruecklich,
 * dass die angezeigte Summe unvollstaendig ist.
 *
 * WARUM Klarnamen zusaetzlich am Fall-Sichtrecht haengen: viewControlling ist bewusst ein
 * EIGENES, frei vergebbares Recht (Nutzerentscheidung 25.08.2026) - eine Buchhaltungskraft soll
 * die Auswertung fuehren duerfen, ohne Fallakten zu oeffnen. sichtbareFaelle() prueft aber nur
 * Zuordnung und Freigaben, NICHT das globale canViewCases; und ein Fall ohne Eigentuemer - so
 * entsteht jeder neu angelegte Fall - gilt dort fuer alle als sichtbar. Ohne Zusatz waere der
 * Reiter also der bequemste Weg, sich die Namensliste aller Betreuten zu beschaffen, obwohl
 * /api/cases demselben Konto 403 antwortet. Siehe ohneKlarnamen().
 */

const express = require('express');
const { sichtbareFaelle } = require('../cases/case-visibility');
const { isDemoCaseId } = require('../demo/data-identities');
const db = require('../../database/index');
const { requireAuth, requireViewControlling, hasPermission } = require('../../middleware/authentication');

const router = express.Router();
router.use(requireAuth);

/* Nur die benoetigten Spalten - kein stammdaten_json im Ergebnis, siehe Kopfkommentar. */
const listCasesStmt = db.prepare(`
  SELECT c.id, c.label, c.file_number, c.archived,
         json_extract(c.stammdaten_json, '$.rechtlicherBetreuer')  AS sd_betreuer,
         json_extract(c.stammdaten_json, '$.care.startDate')       AS sd_start_date,
         json_extract(c.stammdaten_json, '$.care.endDate')         AS sd_end_date,
         json_extract(c.stammdaten_json, '$.care.endReason')       AS sd_end_reason,
         json_extract(c.stammdaten_json, '$.care.remStage')        AS sd_rem_stage,
         json_extract(c.stammdaten_json, '$.care.assetStatus')     AS sd_asset_status,
         json_extract(c.stammdaten_json, '$.care.housingCategory') AS sd_housing_category
  FROM cases c
  ORDER BY c.label COLLATE NOCASE
`);

/* Fehlende Felder sind der Normalfall, nicht der Fehler: die drei Verguetungsfelder gibt es erst
   seit heute, jeder Bestandsfall liefert dafuer NULL (uebliche "|| ''"-Konvention dieser App). */
function text(wert) {
  return wert == null ? '' : String(wert);
}

/* rechtlicherBetreuer ist heute ein Personen-Key (String). Altbestand hat an dieser Stelle
   vereinzelt ein Objekt liegen - json_extract gibt dessen JSON-Text zurueck. Den ungefiltert
   durchzureichen wuerde im Reiter eine Spalte mit '{"name":...}' erzeugen, deshalb hier dieselbe
   Aufloesung wie in betreuerVon() in modules/documents/routes.js. */
function betreuerText(wert) {
  const roh = text(wert).trim();
  if (!roh.startsWith('{')) return roh;
  try {
    const objekt = JSON.parse(roh);
    return String((objekt && (objekt.name || objekt.label)) || '');
  } catch (_e) {
    return '';
  }
}

/* Die drei Verguetungsfelder werden gegen ihre erlaubten Werte geprueft statt durchgereicht.
   Grund: der Client schlaegt damit direkt in REM_RATES nach. Ein unbekannter Wert (Tippfehler in
   Altdaten, Zahl statt String aus einem Import) wuerde dort still danebengreifen; als '' ist er
   sichtbar "noch nicht gepflegt" - das ist die ehrlichere Antwort. */
function ausAuswahl(wert, erlaubt) {
  const roh = text(wert).trim().toUpperCase();
  return erlaubt.includes(roh) ? roh : '';
}

const REM_STAGES = ['1', '2'];
const ASSET_STATES = ['M', 'NM'];
const HOUSING_CATEGORIES = ['S', 'A'];

/* Rueckfall auf den Verguetungsantrag (25.08.2026).
   Die drei Stammdatenfelder gibt es erst seit heute - JEDER Bestandsfall liefert dafuer NULL.
   Ohne diesen Rueckfall waere die Auswertung am ersten Tag vollstaendig leer, obwohl die Angaben
   seit Jahren im Verguetungsantrag stehen. Gelesen wird deshalb die Dokumentzeile
   (case_id,'remuneration') - dieselbe Ableitung, die der Client in __caseVerguetungsprofil
   fuer die Einzelfallmaske vornimmt; server/tests/controlling.test.cjs prueft beide gegen
   DIESELBEN Fixtures, damit sie nicht auseinanderlaufen.
   Vorrang hat immer der Fall: sobald dort etwas gepflegt ist, gilt der Fall als Wahrheit. */
const listAntraegeStmt = db.prepare(
  "SELECT case_id, data_json FROM case_reports WHERE report_id = 'remuneration'"
);

function antragProfile() {
  const karte = new Map();
  for (const row of listAntraegeStmt.all()) {
    try {
      const felder = (JSON.parse(row.data_json || '{}') || {}).fields || {};
      const stufe = ausAuswahl(felder.rem_stage && felder.rem_stage.value, REM_STAGES);
      /* Nur GEPFLEGTE Abrechnungszeilen zaehlen (Befund Review 25.08.).
         Das Programm belegt rem_sections beim Seeden selbst vor und RAET die Wohnform dabei aus
         der Unterkunftsart ("Seniorenheim ..." -> S, alles andere -> A). Solche Eintraege tragen
         die Herkunft 'master'. Wuerden sie hier mitgelesen, meldete die Kachel "Wohnform" eine
         gepflegte Angabe und "Angabe fehlt: 0" fuer Faelle, deren Wohnform nie jemand bestaetigt
         hat - und der Reiter begruendete die Zahl obendrein mit "aus dem letzten
         Verguetungsantrag", also mit einem von Hand ausgefuellten Formular.
         Von Hand gesetzte Werte behalten ihre eigene Herkunft ('manual', beim KI-Import 'ai',
         aus einem Vorbericht 'previous') und zaehlen unveraendert weiter; Datenstaende ganz ohne
         Herkunftsfeld (Alt-Backups, Fixtures) ebenso, weil die Bedingung nur auf das
         ausdrueckliche 'master' anspricht. */
      const abschnitte = felder.rem_sections || {};
      const zeilen = (abschnitte.source !== 'master' && Array.isArray(abschnitte.value))
        ? abschnitte.value : [];
      /* Die LETZTE befuellte Abrechnungszeile gilt: Vermoegensstatus und Wohnform wechseln
         innerhalb einer Abrechnungsperiode, der aktuelle Stand steht unten in der Tabelle. */
      let letzte = null;
      for (const z of zeilen) {
        if (z && typeof z === 'object' && (text(z.status).trim() || text(z.housing).trim())) letzte = z;
      }
      const status = letzte ? ausAuswahl(letzte.status, ASSET_STATES) : '';
      const wohnform = letzte ? ausAuswahl(letzte.housing, HOUSING_CATEGORIES) : '';
      if (stufe || status || wohnform) {
        karte.set(String(row.case_id), { remStage: stufe, assetStatus: status, housingCategory: wohnform });
      }
    } catch (_fehler) {
      /* Eine kaputte Dokumentzeile darf die Auswertung nicht abreissen lassen. */
    }
  }
  return karte;
}

function zeile(row, antraege) {
  return {
    caseId: String(row.id),
    label: String(row.label || ''),
    fileNumber: String(row.file_number || ''),
    archived: !!row.archived,
    betreuer: betreuerText(row.sd_betreuer),
    /* Datumsfelder bleiben unveraendert (TT.MM.JJJJ, so wie der Client sie geschrieben hat) -
       eine Umformatierung hier waere eine zweite Wahrheit ueber das Datumsformat. */
    startDate: text(row.sd_start_date),
    endDate: text(row.sd_end_date),
    endReason: text(row.sd_end_reason),
    ...profil(row, antraege)
  };
}

/* Liefert die drei Dimensionen samt Herkunft. `quelle` ist bewusst EIN Kennzeichen fuer den
   ganzen Datensatz und nicht je Feld: wuerden einzelne Luecken aus dem Antrag nachgefuellt,
   behauptete die Anzeige "aus dem Fall" fuer Werte, die dort nie standen. */
function profil(row, antraege) {
  const fall = {
    remStage: ausAuswahl(row.sd_rem_stage, REM_STAGES),
    assetStatus: ausAuswahl(row.sd_asset_status, ASSET_STATES),
    housingCategory: ausAuswahl(row.sd_housing_category, HOUSING_CATEGORIES)
  };
  if (fall.remStage || fall.assetStatus || fall.housingCategory) return { ...fall, quelle: 'fall' };
  const ausAntrag = antraege && antraege.get(String(row.id));
  if (ausAntrag) return { ...ausAntrag, quelle: 'antrag' };
  return { ...fall, quelle: '' };
}

/* Ortszeit, nicht toISOString(): das rechnet nach UTC und wuerde den Stand ab 22 Uhr MESZ auf den
   Vortag datieren - genau die Sorte Abweichung, die in einer Auswertung niemand sucht. */
function heuteIso() {
  const jetzt = new Date();
  const zwei = (zahl) => String(zahl).padStart(2, '0');
  return `${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}`;
}

/* Auswertung ohne Klarnamen (Nutzerentscheidung 25.08.2026).
   Wurde einem Konto das Fall-Sichtrecht ausdruecklich ENTZOGEN, soll das Controlling weiter
   funktionieren - eingeschraenkt wird NUR die Identifizierbarkeit der betreuten Person. Zahlen,
   Summen, Laufzeiten und die Auslastung je Betreuer bleiben deshalb unveraendert; an die Stelle
   des Namens tritt das Aktenzeichen, und fehlt auch das, eine neutrale Bezeichnung.
   Die Nummer darin benennt nur die ZEILE dieser Auswertung - sie ist kein Aktenzeichen und darf
   nicht als eines gelesen werden; deshalb sagt die Antwort mit `anonymisiert` ausdruecklich, dass
   in der Namensspalte eine Ersatzbezeichnung steht. */
function ohneKlarnamen(faelle) {
  return faelle.map((fall, i) => ({ ...fall, label: fall.fileNumber || `Fall ${i + 1}` }));
}

function imBereich(row, scope) {
  if (scope === 'all') return true;
  return !!row.archived === (scope === 'archived');
}

router.get('/', requireViewControlling, (req, res) => {
  const gewuenscht = String(req.query.scope || '').trim();
  /* Unbekannter Bereich faellt auf 'active' zurueck statt 400 zu werfen: ein Tippfehler im
     Aufruf darf keine leere Auswertung erzeugen, die wie "keine Faelle" aussieht. */
  const scope = ['active', 'archived', 'all'].includes(gewuenscht) ? gewuenscht : 'active';

  const imScope = listCasesStmt.all()
    .filter((row) => !isDemoCaseId(row.id))
    .filter((row) => imBereich(row, scope));
  const erlaubt = sichtbareFaelle(req.session);
  const sichtbar = erlaubt === null ? imScope : imScope.filter((row) => erlaubt.has(String(row.id)));
  const antraege = antragProfile();
  const faelle = sichtbar.map((row) => zeile(row, antraege));
  /* hasPermission() statt eines rohen Blicks auf die Sitzung: Admins sind hier wie ueberall
     ausgenommen, sonst saehe ausgerechnet die Verwaltung nur Aktenzeichen. */
  const anonymisiert = !hasPermission(req, 'canViewCases');

  res.json({
    stand: heuteIso(),
    vollstaendig: sichtbar.length === imScope.length,
    gesamt: imScope.length,
    anonymisiert,
    faelle: anonymisiert ? ohneKlarnamen(faelle) : faelle
  });
});

module.exports = router;
