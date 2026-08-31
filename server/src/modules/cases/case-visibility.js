'use strict';
/* Fallbezogene Sichtbarkeit (2026-07-26).
 *
 * Vorgeschichte: Bis hierher gab es keine Fall-Zuordnung im Datenmodell. Jeder angemeldete Nutzer
 * konnte ueber /api/cases, /api/inbox, /api/betreuungsuebersicht usw. saemtliche Fallakten lesen.
 * Die einzige Pruefung sass im Dokumentenmodul und verglich den Anzeigenamen per TEILSTRING gegen
 * das Freitextfeld "rechtlicherBetreuer" - das traf zu viel ("Anna Berg" erbte die Faelle von
 * "Anna Bergmann") und zugleich zu wenig (kein Treffer, sobald der Anzeigename abwich).
 *
 * Ab jetzt entscheiden drei harte Kriterien, kein Namensraten:
 *   1. cases.owner_user_id  - der zustaendige Betreuer bzw. die Betreuerin
 *   2. case_access          - ausdrueckliche Freigabe je Nutzer, 'read' oder 'write'
 *   3. owner_user_id IS NULL - noch niemandem zugeordnet; bewusste Entscheidung des Betreibers:
 *      solche Faelle bleiben fuer alle sichtbar, damit frisch angelegte Faelle nicht verschwinden.
 *
 * Admins und Nutzer mit dem Recht viewAllCases sehen alles.
 *
 * Bewusst OHNE Cache: Die Vorgaengerfassung hielt die Zuordnung 60 Sekunden fest, wodurch eine
 * gerade entzogene Berechtigung noch eine Minute weitergalt. Die Abfragen sind indiziert und
 * laufen gegen eine Handvoll Zeilen - Korrektheit schlaegt hier Mikrooptimierung.
 */
const db = require('../../database/index');

const eigeneStmt = db.prepare('SELECT id FROM cases WHERE owner_user_id IS NULL OR owner_user_id = ?');
const freigabenStmt = db.prepare('SELECT case_id, level FROM case_access WHERE user_id = ?');
const einzelStmt = db.prepare('SELECT owner_user_id FROM cases WHERE id = ?');
const einzelFreigabeStmt = db.prepare('SELECT level FROM case_access WHERE case_id = ? AND user_id = ?');
const fallMitLabelStmt = db.prepare('SELECT id, label FROM cases WHERE id = ?');
const faelleNachLabelStmt = db.prepare('SELECT id, label FROM cases WHERE label = ? ORDER BY id');

/* Alle Fall-IDs, die diese Sitzung sehen darf. null = keine Einschraenkung (Admin/viewAllCases).
   Ein leeres Set bedeutet: darf nichts sehen (z.B. abgemeldet). */
function sichtbareFaelle(session) {
  if (!session || !session.userId) return new Set();
  if (session.isAdmin || session.canViewAllCases) return null;
  const ids = new Set();
  for (const r of eigeneStmt.all(session.userId)) ids.add(String(r.id));
  for (const r of freigabenStmt.all(session.userId)) ids.add(String(r.case_id));
  return ids;
}

function darfSehen(session, caseId) {
  if (!session || !session.userId) return false;
  if (session.isAdmin || session.canViewAllCases) return true;
  const id = String(caseId || '');
  if (!id) return true;                       /* kein Fallbezug = Bueroorganisation */
  const fall = einzelStmt.get(id);
  if (!fall) return false;
  if (fall.owner_user_id == null) return true;               /* niemandem zugeordnet */
  if (Number(fall.owner_user_id) === Number(session.userId)) return true;
  return !!einzelFreigabeStmt.get(id, session.userId);
}

/* Schreiben verlangt zusaetzlich zur Sichtbarkeit eine Schreibberechtigung: Eigentuemer,
   ausdrueckliche 'write'-Freigabe oder ein Fall ohne Eigentuemer. Eine reine Lese-Freigabe
   ('read') erlaubt ausdruecklich KEIN Bearbeiten. Das globale Recht editCases pruefen die
   Routen wie bisher selbst - beides muss zutreffen. */
function darfBearbeiten(session, caseId) {
  if (!session || !session.userId) return false;
  // „Alle Fallakten sehen“ ist ausdrücklich nur ein Leserecht. Ohne diese
  // Trennung würde die Kombination viewAllCases + editCases fremde Akten
  // trotz fehlender Eigentümer-/Write-Freigabe beschreibbar machen.
  if (session.isAdmin) return true;
  const id = String(caseId || '');
  if (!id) return true;
  const fall = einzelStmt.get(id);
  if (!fall) return false;
  if (fall.owner_user_id == null) return true;
  if (Number(fall.owner_user_id) === Number(session.userId)) return true;
  const f = einzelFreigabeStmt.get(id, session.userId);
  return !!f && String(f.level) === 'write';
}

/* Express-Wachen. Der Fall steckt je nach Route in params, query oder body - deshalb alle drei
   Quellen pruefen, sonst laeuft eine Route still am Schutz vorbei. */
function fallIdAusRequest(req, feld) {
  return String((req.params && req.params[feld]) || (req.query && req.query[feld]) || (req.body && req.body[feld]) || '');
}

function requireFallSicht(feld = 'id') {
  return (req, res, next) => {
    const id = fallIdAusRequest(req, feld);
    if (!id || darfSehen(req.session, id)) return next();
    return res.status(403).json({ error: 'Dieser Fall ist Ihrem Konto nicht zugeordnet.' });
  };
}

function requireFallBearbeiten(feld = 'id') {
  return (req, res, next) => {
    const id = fallIdAusRequest(req, feld);
    if (!id || darfBearbeiten(req.session, id)) return next();
    return res.status(403).json({ error: 'Sie haben für diesen Fall kein Bearbeitungsrecht.' });
  };
}

/* Filtert eine Liste von Datensaetzen auf die sichtbaren Faelle. Saetze OHNE Fallbezug
   (leeres Feld) gelten als Bueroorganisation und bleiben erhalten. */
function nurSichtbare(session, rows, feld = 'case_id') {
  const erlaubt = sichtbareFaelle(session);
  if (erlaubt === null) return rows;
  return rows.filter((r) => {
    const id = String((r && r[feld]) || '');
    return !id || erlaubt.has(id);
  });
}

/* Sichere Auflösung für noch nicht nachgezogenen Altbestand:
   - eine vorhandene ausdrückliche ID ist autoritativ;
   - eine ungültige ausdrückliche ID wird nicht über ein Label auf einen anderen Fall umgebogen;
   - ein Label darf nur bei exakt einem Datenbanktreffer zur ID werden.
   Ein mehrdeutiges Label bleibt damit bewusst büroweit/unzugeordnet. */
function fallZuordnung(caseId, caseLabel) {
  const explicit = String(caseId || '').trim();
  const label = String(caseLabel || '').trim();
  if (explicit) {
    const row = fallMitLabelStmt.get(explicit);
    if (row) {
      return {
        caseId: String(row.id),
        caseLabel: String(row.label || ''),
        source: 'id',
        invalidId: false,
        ambiguous: false
      };
    }
    return {
      caseId: '',
      caseLabel: label,
      source: 'invalid_id',
      invalidId: true,
      ambiguous: false
    };
  }
  const rows = label ? faelleNachLabelStmt.all(label) : [];
  if (rows.length === 1) {
    return {
      caseId: String(rows[0].id),
      caseLabel: String(rows[0].label || ''),
      source: 'unique_label',
      invalidId: false,
      ambiguous: false
    };
  }
  return {
    caseId: '',
    caseLabel: label,
    source: rows.length > 1 ? 'ambiguous_label' : 'unassigned',
    invalidId: false,
    ambiguous: rows.length > 1
  };
}

function eindeutigeFallId(caseId, caseLabel) {
  return fallZuordnung(caseId, caseLabel).caseId;
}

function darfZuordnungSehen(session, assignment) {
  if (!session || !session.userId) return false;
  if (session.isAdmin || session.canViewAllCases) return true;
  const value = assignment || {};
  // Ein bekanntes, aber nicht eindeutig auflösbares Label ist kein
  // büroweiter Datensatz. Eingeschränkte Nutzer dürfen dessen Inhalt erst
  // nach einer ausdrücklichen ID-Zuordnung sehen.
  if (value.ambiguous || value.invalidId) return false;
  return !value.caseId || darfSehen(session, value.caseId);
}

function darfZuordnungBearbeiten(session, assignment) {
  if (!session || !session.userId) return false;
  if (session.isAdmin) return true;
  const value = assignment || {};
  if (value.ambiguous || value.invalidId) return false;
  return !value.caseId || darfBearbeiten(session, value.caseId);
}

/* Labels sichtbarer, eindeutig bezeichnete Faelle. Mehrdeutige Labels werden
   absichtlich nicht als Berechtigungsersatz verwendet. */
const labelStmt = db.prepare('SELECT id, label FROM cases');
function sichtbareLabels(session) {
  const erlaubt = sichtbareFaelle(session);
  if (erlaubt === null) return null;
  const out = new Set();
  const gruppen = new Map();
  for (const r of labelStmt.all()) {
    const label = String(r.label || '').trim();
    if (!label) continue;
    if (!gruppen.has(label)) gruppen.set(label, []);
    gruppen.get(label).push(String(r.id));
  }
  for (const [label, ids] of gruppen) {
    if (ids.length === 1 && erlaubt.has(ids[0])) out.add(label.toLowerCase());
  }
  out.delete('');
  return out;
}
/* Alle Labels, zu denen es ueberhaupt einen Fall gibt - um "gehoert zu gar keinem Fall" von
   "gehoert zu einem fremden Fall" zu unterscheiden. */
function alleLabels() {
  const out = new Set();
  for (const r of labelStmt.all()) { const l = String(r.label || '').trim().toLowerCase(); if (l) out.add(l); }
  return out;
}
function nurSichtbareNachLabel(session, rows, feld = 'case_label') {
  const erlaubt = sichtbareFaelle(session);
  if (erlaubt === null) return rows;
  return rows.filter((r) => {
    const assignment = fallZuordnung(r && r.case_id, r && r[feld]);
    if (assignment.ambiguous || assignment.invalidId) return false;
    // Nur ein wirklich unbekanntes/leeres Label ist Büroorganisation.
    return !assignment.caseId || erlaubt.has(assignment.caseId);
  });
}

module.exports = {
  sichtbareLabels, alleLabels, nurSichtbareNachLabel,
  fallZuordnung, eindeutigeFallId,
  darfZuordnungSehen, darfZuordnungBearbeiten,
  sichtbareFaelle, darfSehen, darfBearbeiten,
  requireFallSicht, requireFallBearbeiten, nurSichtbare
};
