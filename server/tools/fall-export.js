#!/usr/bin/env node
'use strict';
/* Faelle aus der Datenbank als EINLESBARE Projektsicherung ausgeben (24.08.2026).
   Erzeugt je Fall genau die JSON-Datei, die die App auch selbst schreibt
   (`exportProject()`) und ueber „Dateien einlesen -> Datensicherung" bzw. den
   Datei-Waehler wieder einliest (`importProject()`; verlangt caseData + reports).

   Aufruf (Server darf laufen - es wird NUR gelesen):
       node server/tools/fall-export.js                  - die fuenf Demofaelle
       node server/tools/fall-export.js --alle           - alle Faelle der Datenbank
       node server/tools/fall-export.js --fall <id>      - ein einzelner Fall
       node server/tools/fall-export.js --ziel <ordner>  - Zielordner (Standard: exports/faelle)

   ZUSAMMENBAU: exakt wie der Client aus der Server-Antwort seinen Zustand baut
   (applyServerCaseToState bzw. die Fallwechsler-Zerlegung in der App):
       const {exportHistory, archives, ...caseDataOnly} = stammdaten;
       state = { caseData:{...caseDataOnly, documentationEntries, contacts, derived:{}},
                 reports, archives, files:{}, ui:{caseLoaded:true, exportHistory} }

   GRENZE: Die Sicherung traegt die FALLDATEN (Stammdaten, Dokumente/Berichte, Archive,
   Falldokumentation, Kontakte, Verlauf) - so wie die Datensicherung der App auch. Die im
   Dokumentenspeicher abgelegten PDF-DATEIEN gehoeren nicht hinein; sie bleiben in der
   Datenbank bzw. werden vom Demo-Seeder neu erzeugt. */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SERVER_ROOT = path.resolve(__dirname, '..');
const { DATABASE_PATH } = require('../src/config/paths');

/* Die festen Kennungen der fuenf Demofaelle (identisch zu DEMO_IDS in tools/demo-faelle/seed.js). */
const DEMO_IDS = [
  'de300001-0000-4000-8000-000000000001',
  'de300002-0000-4000-8000-000000000002',
  'de300003-0000-4000-8000-000000000003',
  'de300004-0000-4000-8000-000000000004',
  'de300005-0000-4000-8000-000000000005',
];

function parseJson(text, fallback) {
  try {
    const value = JSON.parse(String(text || ''));
    return value && typeof value === 'object' ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

/* Dateinamen wie die App: Umlaute ausgeschrieben, nur Wortzeichen, keine Doppel-Unterstriche. */
function safeName(text) {
  return String(text || '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Fall';
}

function vollerName(caseData, label) {
  const person = (caseData && caseData.person) || {};
  const ausPerson = String(person.fullName || '').trim()
    || [person.firstName, person.lastName].filter(Boolean).join(' ').trim();
  if (ausPerson) return ausPerson;
  /* Fallback auf das Fall-Etikett („Nachname, Vorname" -> „Vorname Nachname"). */
  const teile = String(label || '').split(',').map((t) => t.trim()).filter(Boolean);
  return teile.length === 2 ? `${teile[1]} ${teile[0]}` : (label || 'Fall');
}

function fallLesen(db, row) {
  const stammdaten = parseJson(row.stammdaten_json, {});
  /* exportHistory und archives gehoeren NICHT in caseData (gleiche Zerlegung wie in der App). */
  const { exportHistory, archives, ...caseDataOnly } = stammdaten;

  const reports = {};
  for (const r of db.prepare('SELECT report_id, data_json FROM case_reports WHERE case_id = ? ORDER BY report_id').all(row.id)) {
    reports[r.report_id] = parseJson(r.data_json, {});
  }
  const documentationEntries = db
    .prepare('SELECT data_json FROM case_doku_entries WHERE case_id = ? ORDER BY created_at, id')
    .all(row.id)
    .map((e) => parseJson(e.data_json, null))
    .filter(Boolean);
  const contacts = db
    .prepare('SELECT data_json FROM case_contacts WHERE case_id = ? ORDER BY created_at, id')
    .all(row.id)
    .map((c) => parseJson(c.data_json, null))
    .filter(Boolean);

  const state = {
    caseData: Object.assign({}, caseDataOnly, { documentationEntries, contacts, derived: {} }),
    reports,
    archives: Array.isArray(archives) ? archives : [],
    files: {},
    ui: { caseLoaded: true, exportHistory: Array.isArray(exportHistory) ? exportHistory : [] },
    exportedAt: new Date().toISOString(),
  };
  return { state, name: vollerName(state.caseData, row.label), label: row.label };
}

function main(argv) {
  const args = argv.slice(2);
  const wert = (flagge) => {
    const i = args.indexOf(flagge);
    return i >= 0 ? args[i + 1] : '';
  };
  const zielOrdner = path.resolve(wert('--ziel') || path.join(SERVER_ROOT, '..', 'exports', 'faelle'));
  const einzeln = wert('--fall');
  const alle = args.includes('--alle');

  const db = new Database(DATABASE_PATH, { readonly: true });
  try {
    let rows;
    if (einzeln) {
      rows = db.prepare('SELECT id, label, stammdaten_json FROM cases WHERE id = ?').all(einzeln);
      if (!rows.length) throw new Error(`Kein Fall mit der Kennung ${einzeln}.`);
    } else if (alle) {
      rows = db.prepare('SELECT id, label, stammdaten_json FROM cases ORDER BY label').all();
    } else {
      const platz = DEMO_IDS.map(() => '?').join(',');
      rows = db.prepare(`SELECT id, label, stammdaten_json FROM cases WHERE id IN (${platz}) ORDER BY id`).all(...DEMO_IDS);
      const fehlend = DEMO_IDS.filter((id) => !rows.some((r) => r.id === id));
      if (fehlend.length) {
        console.warn(`Hinweis: ${fehlend.length} Demofall/-faelle fehlen in der Datenbank `
          + '(mit "node server/tools/demo-faelle/seed.js" neu einspielen).');
      }
    }
    if (!rows.length) throw new Error('Keine Faelle zum Ausgeben gefunden.');

    fs.mkdirSync(zielOrdner, { recursive: true });
    const heute = new Date().toISOString().slice(0, 10);
    const ergebnis = [];
    for (const row of rows) {
      const { state, name, label } = fallLesen(db, row);
      const datei = path.join(zielOrdner, `${safeName(name)}_Betreuungsakte_${heute}.json`);
      fs.writeFileSync(datei, JSON.stringify(state, null, 1), 'utf8');
      const kb = Math.round(fs.statSync(datei).size / 1024);
      ergebnis.push({ label, datei, kb, dokumente: Object.keys(state.reports).length,
        archive: state.archives.length, doku: state.caseData.documentationEntries.length,
        kontakte: state.caseData.contacts.length });
    }

    console.log(`Zielordner: ${zielOrdner}\n`);
    for (const e of ergebnis) {
      console.log(`${e.label}`);
      console.log(`   ${path.basename(e.datei)}  (${e.kb} kB)`);
      console.log(`   ${e.dokumente} Dokumente · ${e.archive} Archivstände · ${e.doku} Doku-Einträge · ${e.kontakte} Kontakte`);
    }
    console.log(`\n${ergebnis.length} Datei(en) geschrieben.`);
    console.log('Einlesen in der App: Lokaler Modus -> „Dateien einlesen" -> Datensicherung (je Datei ein Fall).');
  } finally {
    db.close();
  }
}

/* Schutz vor versehentlichem Ausfuehren beim require (der Demo-Seeder hat ihn NICHT). */
if (require.main === module) {
  try {
    main(process.argv);
  } catch (error) {
    console.error('Fall-Export fehlgeschlagen:', error && error.message ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = { fallLesen, safeName, DEMO_IDS };
