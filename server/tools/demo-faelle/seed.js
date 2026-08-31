#!/usr/bin/env node
'use strict';
/* Spielt fuenf vollstaendig ausgefuellte, frei erfundene Betreuungsfaelle in die Datenbank ein.
   Zweck: Test der Software und Vorfuehrung/Werbung - alle Namen, Anschriften, Aktenzeichen,
   Bankverbindungen und Befunde sind fiktiv.

   Aufruf (Server muss NICHT laufen):
       node server/tools/demo-faelle/seed.js            - anlegen bzw. aktualisieren
       node server/tools/demo-faelle/seed.js --entfernen - dieselben fuenf Faelle wieder loeschen

   Die Fall-IDs sind fest verdrahtet (DEMO_IDS). Ein zweiter Lauf ueberschreibt deshalb die
   vorhandenen Demo-Faelle, statt Dubletten zu erzeugen; Bestandsfaelle bleiben unberuehrt.

   Ablauf in drei Schritten, weil die Dokumente den Fall und seinen Aktenordner brauchen:
     1. Fall anlegen und Aktenordner (Register 00-12) erzeugen
     2. PDF je Ausgang bauen, im Dokumentenspeicher ablegen und den Beleg einsammeln
     3. Stammdaten samt Export-/Versandhistorie, Archiv und Betreuungsverlauf schreiben */

const path = require('path');
const crypto = require('crypto');
const lib = require('./lib');
const SERVER_ROOT = path.resolve(__dirname, '..', '..');
require('dotenv').config({ path: path.join(SERVER_ROOT, '.env') });

const db = require('../../src/database/index');
const { DATA_ROOT } = require('../../src/config/paths');
const { createDocumentStorage } = require('../../src/modules/documents/storage');
const documentTaxonomy = require('../../src/modules/documents/taxonomy');
const documentIntern = require('../../src/modules/documents/routes').intern;
const { briefPdf, berichtPdf } = require('./dokumente');
const { DEMO_CASES } = require('../../src/modules/demo/data-identities');

const faelle = [
  require('./fall-1-auerbach'),
  require('./fall-2-kilic'),
  require('./fall-3-rothenberg'),
  require('./fall-4-nowak'),
  require('./fall-5-weidmann')
];

/* Feste Kennungen: derselbe Lauf erzeugt immer dieselben Faelle. */
const DEMO_IDS = DEMO_CASES.map((entry) => entry.id);

const EXPORT_QUELLE = 'exportablage';
const EXPORT_ORDNER = 'Dokumentenausgang';

const documentStorage = createDocumentStorage({
  db,
  dataRoot: DATA_ROOT,
  readConfig: () => {
    try {
      const row = db.prepare("SELECT data_json FROM office_json WHERE key='documents_config'").get();
      const cfg = row ? JSON.parse(row.data_json || '{}') : {};
      const neuesLayout = cfg.storageLayout === 'real-folders-v1' || cfg.storageRoot !== undefined;
      return {
        storageRoot: String(cfg.storageRoot || ''),
        legacyBaseDir: String(cfg.legacyBaseDir || (!neuesLayout ? cfg.baseDir : '') || ''),
        caseDirs: cfg.caseDirs && typeof cfg.caseDirs === 'object' ? cfg.caseDirs : {}
      };
    } catch (_error) { return {}; }
  }
});

/* Anlegender Nutzer: der erste Admin, ersatzweise der erste vorhandene Nutzer. */
function seedUser() {
  const row = db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get()
    || db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
  if (!row) throw new Error('Kein Nutzer vorhanden - bitte zuerst npm run create-admin ausfuehren.');
  return row.id;
}

/* Deterministische, aber eindeutig aussehende Kennung aus Fall-ID und Schluessel. */
function festeId(caseId, bereich, nr) {
  const h = crypto.createHash('sha1').update(`${caseId}|${bereich}|${nr}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function isoStempel(datum, zeit) {
  return `${datum} ${zeit || '09:00:00'}`;
}

function deDatum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
}

/* Zeitstempel eines Ausgangs als ISO-Zeitpunkt (Datum + HHMM aus der Falldefinition). */
function ausgangsZeitpunkt(ex) {
  /* Der Dateiname traegt die ORTSZEIT (JJMMTT HHMM). Die Historie speichert einen
     ISO-Zeitpunkt und zeigt ihn mit toLocaleString wieder in Ortszeit an - deshalb wird
     hier aus der gewuenschten Ortszeit der passende UTC-Zeitpunkt gebildet. Sonst waeren
     Dateiname und angezeigte Uhrzeit um den Zeitzonenversatz verschoben. */
  const [j, m, t] = ex.datum.split('-').map(Number);
  return new Date(j, m - 1, t, Number(ex.zeit.slice(0, 2)), Number(ex.zeit.slice(2, 4))).toISOString();
}

/* Dateiname wie die App ihn bildet: JJMMTT HHMM Nachname Vorname <Titel><Modus-Zusatz> s.pdf */
function dateiname(ex, person) {
  const stempel = `${ex.datum.slice(2, 4)}${ex.datum.slice(5, 7)}${ex.datum.slice(8, 10)} ${ex.zeit}`;
  const name = [person.lastName, person.firstName].filter(Boolean).join(' ');
  const zusatz = ex.exportMode === 'letterhead' ? ' – Anschreiben'
    : ex.exportMode === 'combined' ? ' – Anschreiben und Formular' : '';
  const basis = `${stempel} ${name} ${ex.dokumentTitel}${zusatz} s`
    .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return ex.exportMode === 'print' ? `${basis}.pdf` : `${basis}.pdf`;
}

/* Zielordner: Register 10 fuer Berichte/Rechnungslegung/Verguetung, sonst Register 11. */
function zielOrdner(ex, reportPeriod) {
  return documentTaxonomy.exportBerichtPfad(ex.reportId, reportPeriod, Number(ex.datum.slice(0, 4)))
    || documentTaxonomy.ordnerPfad('11', EXPORT_ORDNER, ex.datum.slice(0, 4), ex.datum.slice(5, 7));
}

/* ---------------------------------------------------------------- Loeschen */

/* Dokumente, die ein frueherer Lauf abgelegt hat (Beleg-Kennung beginnt mit 'ex-'). */
function entferneDemoDokumente(caseId) {
  let zeilen = [];
  try {
    zeilen = db.prepare(`
      SELECT f.id, f.area, f.case_id, f.storage_relpath
        FROM doc_links l JOIN doc_files f ON f.id = l.file_id
       WHERE l.module = 'export' AND l.owner_id LIKE 'ex-%' AND f.case_id = ?
    `).all(caseId);
  } catch (_e) { return; }
  for (const z of zeilen) {
    try { documentStorage.removeFileAndSidecar(z); } catch (_e) { /* Rest meldet der Integritaetslauf */ }
    try { db.prepare('DELETE FROM doc_links WHERE file_id = ?').run(z.id); } catch (_e) {}
    try { db.prepare('DELETE FROM doc_module_import WHERE file_id = ?').run(z.id); } catch (_e) {}
    try { db.prepare('DELETE FROM doc_files WHERE id = ?').run(z.id); } catch (_e) {}
  }
}

function entferneFall(caseId) {
  entferneDemoDokumente(caseId);
  const tabellen = [
    ['case_reports', 'case_id'], ['case_doku_entries', 'case_id'], ['case_contacts', 'case_id'],
    ['case_documents', 'case_id'], ['betreuung_overview_entries', 'case_id'], ['case_access', 'case_id'],
    ['calendar_events', 'case_id'], ['todos', 'case_id'], ['doc_case_roots', 'case_id']
  ];
  for (const [tabelle, spalte] of tabellen) {
    try { db.prepare(`DELETE FROM ${tabelle} WHERE ${spalte} = ?`).run(caseId); } catch (_e) { /* Tabelle fehlt */ }
  }
  const fall = db.prepare('SELECT label FROM cases WHERE id = ?').get(caseId);
  if (fall) {
    try { db.prepare('DELETE FROM mileage_trips WHERE case_label = ?').run(fall.label); } catch (_e) {}
    try { db.prepare('DELETE FROM outgoing_invoices WHERE case_label = ?').run(fall.label); } catch (_e) {}
  }
  db.prepare('DELETE FROM cases WHERE id = ?').run(caseId);
}

/* ------------------------------------------------------- Dokumente ablegen */

/* Baut das PDF eines Ausgangs, legt es im Dokumentenspeicher ab und gibt den Beleg zurueck -
   dieselbe Form, die die App als exportRef am Historieneintrag fuehrt. */
async function legeAusgangAb(caseId, fall, ex, userId) {
  const name = dateiname(ex, fall.stammdaten.person);
  const kennung = `${fall.label} · Az. ${fall.fileNumber} · Demonstrationsdaten`;
  const gebaut = ex.art === 'bericht'
    ? await berichtPdf({
      dokumentTitel: ex.dokumentTitel,
      kopfZeilen: ex.inhalt.kopf || [],
      abschnitte: ex.inhalt.abschnitte || [],
      unterschrift: ex.inhalt.unterschrift,
      unterschriftOrtDatum: ex.inhalt.ortDatum || '',
      kennung
    })
    : await briefPdf({
      dokumentTitel: ex.dokumentTitel,
      betreff: ex.betreff,
      empfaengerZeilen: ex.empfaengerZeilen.length ? ex.empfaengerZeilen : [ex.empfaenger],
      datumText: `St. Goarshausen, ${deDatum(ex.datum)}`,
      bezug: ex.inhalt.bezug || '',
      anrede: ex.inhalt.anrede,
      text: ex.inhalt.text || '',
      anlagen: ex.inhalt.anlagen || [],
      kennung
    });

  const teile = zielOrdner(ex, fall.stammdaten.care.reportPeriod);
  const folderId = documentIntern.ordnerSicherstellen('case', caseId, teile);
  const abgelegt = documentIntern.dateiAblegen('case', caseId, folderId, name, 'application/pdf', gebaut.bytes, userId);
  const zeile = db.prepare('SELECT sha256, size FROM doc_files WHERE id = ?').get(abgelegt.id) || {};

  db.prepare('UPDATE doc_files SET pages = ? WHERE id = ?').run(gebaut.seiten, abgelegt.id);
  db.prepare(`
    INSERT INTO doc_links (module, owner_id, slot, file_id, detail_json)
    VALUES ('export', ?, '', ?, ?)
    ON CONFLICT(module, owner_id, slot) DO UPDATE SET file_id=excluded.file_id, detail_json=excluded.detail_json
  `).run(ex.id, abgelegt.id, JSON.stringify({ herkunft: 'export' }));
  db.prepare('INSERT OR IGNORE INTO doc_module_import (quelle, quell_id, file_id) VALUES (?, ?, ?)')
    .run(EXPORT_QUELLE, ex.id + '|' + abgelegt.id, abgelegt.id);

  return {
    fileId: abgelegt.id,
    sha256: zeile.sha256 || '',
    size: zeile.size || gebaut.bytes.length,
    pages: gebaut.seiten,
    dateiname: abgelegt.name,
    ordnerPfad: teile.join('/'),
    area: 'case',
    caseId,
    gespeichertAm: ausgangsZeitpunkt(ex),
    herkunft: 'export',
    reportId: ex.reportId,
    exportMode: ex.exportMode,
    belegVom: 'server'
  };
}

/* Historieneintrag der Export- und Versandhistorie, exakt in der Form von phase4CreateHistory. */
function historienEintrag(ex, ref) {
  const zeitpunkt = ausgangsZeitpunkt(ex);
  const ereignisse = [{ at: zeitpunkt, type: 'created', label: 'Export erstellt' }];
  if (ex.preparedChannel && ex.status !== 'created') {
    ereignisse.unshift({ at: zeitpunkt, type: 'prepared', label: `${kanalLabel(ex.preparedChannel)} geöffnet/vorbereitet` });
  }
  if (ex.status === 'sent') {
    ereignisse.unshift({ at: zeitpunkt, type: 'sent', label: `Versand per ${kanalLabel(ex.channel)} bestätigt` });
  } else if (ex.status === 'printed') {
    ereignisse.unshift({ at: zeitpunkt, type: 'printed', label: 'Druck bestätigt' });
  }
  return {
    id: ex.id,
    createdAt: zeitpunkt,
    updatedAt: zeitpunkt,
    reportId: ex.reportId,
    documentTitle: ex.dokumentTitel,
    exportMode: ex.exportMode,
    filename: ref.dateiname,
    recipient: ex.empfaenger,
    recipientEmail: ex.recipientEmail,
    recipientFax: ex.recipientFax,
    subject: ex.betreff,
    body: ex.body,
    pages: ref.pages,
    parts: ex.exportMode === 'letterhead' ? [{ label: 'Anschreiben', pages: ref.pages }]
      : ex.exportMode === 'combined' ? [{ label: 'Anschreiben und Formular', pages: ref.pages }]
        : [{ label: 'Dokument', pages: ref.pages }],
    status: ex.status,
    preparedChannel: ex.preparedChannel,
    channel: ['sent', 'printed'].includes(ex.status) ? ex.channel : '',
    sentAt: ['sent', 'printed'].includes(ex.status) ? zeitpunkt : '',
    note: ex.note,
    confirmedChannels: ex.status === 'sent' && ex.channel ? [ex.channel] : [],
    events: ereignisse,
    exportRef: ref,
    exportRefHistorie: []
  };
}

function kanalLabel(c) {
  return ({ mail: 'Mail', ebo: 'eBO', fax: 'Fax', post: 'Post', print: 'Druck' })[c] || c || '';
}

function kontaktartFuerKanal(c) {
  return ({
    mail: 'Schriftlich (E-Mail)', ebo: 'Online', fax: 'Schriftlich (Brief, Fax)',
    post: 'Schriftlich (Brief, Fax)', print: 'Schriftlich (Brief, Fax)'
  })[c] || 'Online';
}

/* Betreuungsverlauf-Zeile zu einem versendeten oder gedruckten Dokument (phase4SyncCaseHistory). */
function verlaufsEintrag(ex, ref) {
  if (!['sent', 'printed'].includes(ex.status)) return null;
  return {
    year: ex.datum.slice(0, 4),
    date: deDatum(ex.datum),
    actorGroup: ex.dokuGruppe,
    actor: ex.dokuAkteur,
    type: ex.dokuArt,
    detail: ex.dokuDetail,
    note: [ex.dokumentTitel, ref.dateiname, `an ${ex.empfaenger}`, `Betreff: ${ex.betreff}`].filter(Boolean).join(' · '),
    contact: kontaktartFuerKanal(ex.channel),
    sourceExportId: ex.id
  };
}

/* -------------------------------------------------------------- Schreiben */

function schreibeFall(caseId, fall, userId, zusatz) {
  const stammdaten = JSON.parse(JSON.stringify(fall.stammdaten));
  stammdaten.exportHistory = zusatz.exportHistory;
  stammdaten.archives = fall.archive;
  stammdaten.history = zusatz.history;
  /* Faehigkeiten & Alltag liegt als eigener Datenblock am Fallmodul und gehoert
     im Datenmodell unter goalDecisionPlanning.functionalProfile. */
  if (fall.faehigkeiten) stammdaten.goalDecisionPlanning.functionalProfile = fall.faehigkeiten;

  /* Fristen mit Kalender- und Aufgabeneintraegen verknuepfen - genau so, wie es das
     Fristenmodul beim Speichern tut (routing 'both' erzeugt beides). Erledigte Fristen
     bekommen bewusst keine Verknuepfung, weil frReconcile sie dort wieder abraeumt. */
  const kalender = [];
  const aufgaben = [];
  (stammdaten.fristen || []).forEach((fr, i) => {
    if (fr.status === 'erledigt' || !fr.dueDate) { fr.calEventId = ''; fr.todoId = ''; return; }
    const evId = festeId(caseId, 'frist-cal', i);
    const tdId = festeId(caseId, 'frist-todo', i);
    const beschreibung = [
      fr.institution && `Institution/Gegenüber: ${fr.institution}`,
      `Kategorie: ${fr.category}`,
      fr.note
    ].filter(Boolean).join('\n');
    kalender.push({
      id: evId, title: `Frist: ${fr.title}`, description: beschreibung, location: '',
      startAt: `${fr.dueDate}T09:00`, endAt: `${fr.dueDate}T09:30`, allDay: 0, color: 'red'
    });
    const wv = Number(fr.remindDays) > 0;
    const faellig = wv
      ? new Date(Date.parse(`${fr.dueDate}T00:00:00Z`) - Number(fr.remindDays) * 86400000).toISOString().slice(0, 10)
      : fr.dueDate;
    aufgaben.push({
      id: tdId,
      title: `${wv ? 'Wiedervorlage: ' : 'Frist: '}${fr.title}`,
      description: beschreibung + (wv ? `\n(Wiedervorlage ${fr.remindDays} Tage vor Fristablauf am ${deDatum(fr.dueDate)})` : ''),
      dueAt: faellig, priority: fr.priority === 'high' ? 'high' : 'normal',
      itemType: wv ? 'followup' : 'deadline',
      sourceType: 'frist', sourceId: fr.id, sourceModule: 'deadline'
    });
    fr.calEventId = evId;
    fr.todoId = tdId;
  });

  db.prepare(`
    INSERT INTO cases (id, label, file_number, created_at, created_by, stammdaten_json,
                       stammdaten_updated_at, stammdaten_updated_by, archived, archived_at, owner_user_id)
    VALUES (@id, @label, @fileNumber, @createdAt, @userId, @stammdaten, datetime('now'), @userId, 0, '', NULL)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label, file_number = excluded.file_number,
      stammdaten_json = excluded.stammdaten_json,
      stammdaten_updated_at = datetime('now'), stammdaten_updated_by = excluded.stammdaten_updated_by
  `).run({
    id: caseId, label: fall.label, fileNumber: fall.fileNumber,
    createdAt: fall.createdAt, userId, stammdaten: JSON.stringify(stammdaten)
  });

  /* Falldokumentation */
  db.prepare('DELETE FROM case_doku_entries WHERE case_id = ?').run(caseId);
  const dokuStmt = db.prepare(`
    INSERT INTO case_doku_entries (id, case_id, data_json, created_at, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  fall.doku.forEach((eintrag, i) => {
    const iso = eintrag.date ? `${eintrag.date.slice(6)}-${eintrag.date.slice(3, 5)}-${eintrag.date.slice(0, 2)}` : fall.createdAt.slice(0, 10);
    const id = festeId(caseId, 'doku', i);
    dokuStmt.run(id, caseId, JSON.stringify({ id, ...eintrag }), isoStempel(iso, '10:00:00'), isoStempel(iso, '10:00:00'), userId);
  });

  /* Adressbuch des Falls */
  db.prepare('DELETE FROM case_contacts WHERE case_id = ?').run(caseId);
  const kontaktStmt = db.prepare(`
    INSERT INTO case_contacts (id, case_id, data_json, created_at, updated_at, updated_by, external_uid, connection_id)
    VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, '', '')
  `);
  /* Befund 25.08.2026: Hier wurden die Kontaktzeilen ROH gespeichert - also mit den deutschen
     Schluesseln der Falldateien (strasse/telefon/mail). Das Adressbuch der Anwendung liest aber
     street/phoneArea/phoneNumber/email; Anschrift, Telefon und Mail blieben deshalb in JEDEM
     Demofall leer, obwohl die Daten vorlagen. lib.kontakte() macht genau diese Umwandlung und
     war bis dahin toter Code - sie ergaenzt zusaetzlich die Anschrift der betreuten Person
     (clientStreet & Co.) und die Blockposition _row fuer den Excel-Rundlauf. */
  lib.kontakte(fall.stammdaten.person, fall.kontakte).forEach((k, i) => {
    kontaktStmt.run(festeId(caseId, 'kontakt', i), caseId, JSON.stringify(k), userId);
  });

  /* Berichte und Formulare */
  db.prepare('DELETE FROM case_reports WHERE case_id = ?').run(caseId);
  const berichtStmt = db.prepare(`
    INSERT INTO case_reports (case_id, report_id, data_json, updated_at, updated_by)
    VALUES (?, ?, ?, datetime('now'), ?)
  `);
  for (const [reportId, daten] of Object.entries(fall.berichte || {})) {
    berichtStmt.run(caseId, reportId, JSON.stringify(daten), userId);
  }

  /* Kalender: Fristtermine und freie Termine */
  db.prepare('DELETE FROM calendar_events WHERE case_id = ?').run(caseId);
  const evStmt = db.prepare(`
    INSERT INTO calendar_events (id, title, description, location, start_at, end_at, all_day, source,
                                 external_uid, external_href, external_etag, created_at, updated_at,
                                 updated_by, recurrence_rule, case_label, online_url, color,
                                 owner_user_id, visibility, calendar_ref, reminder_at, case_id)
    VALUES (@id, @title, @description, @location, @startAt, @endAt, @allDay, 'local',
            '', '', '', datetime('now'), datetime('now'), @userId, '', @caseLabel, '', @color,
            NULL, 'public', '', '', @caseId)
  `);
  for (const ev of kalender) {
    evStmt.run({ ...ev, caseLabel: fall.label, caseId, userId });
  }
  (fall.termine || []).forEach((t, i) => {
    evStmt.run({
      id: festeId(caseId, 'termin', i), title: t.titel, description: t.beschreibung || '',
      location: t.ort || '', startAt: t.start, endAt: t.ende, allDay: t.ganztags ? 1 : 0,
      color: t.farbe || '', caseLabel: fall.label, caseId, userId
    });
  });

  /* Aufgaben: Fristaufgaben und freie Aufgaben */
  db.prepare('DELETE FROM todos WHERE case_id = ?').run(caseId);
  const todoStmt = db.prepare(`
    INSERT INTO todos (id, title, description, due_at, done, priority, source, external_uid,
                       external_href, external_etag, created_at, updated_at, updated_by,
                       recurrence_rule, start_at, case_label, owner_user_id, visibility,
                       calendar_ref, item_type, case_id, source_type, source_id, source_module, source_ref)
    VALUES (@id, @title, @description, @dueAt, @done, @priority, 'local', '',
            '', '', datetime('now'), datetime('now'), @userId,
            '', '', @caseLabel, NULL, 'public',
            '', @itemType, @caseId, @sourceType, @sourceId, @sourceModule, '')
  `);
  for (const t of aufgaben) {
    todoStmt.run({ ...t, done: 0, caseLabel: fall.label, caseId, userId });
  }
  (fall.aufgaben || []).forEach((a, i) => {
    todoStmt.run({
      id: festeId(caseId, 'aufgabe', i), title: a.titel, description: a.beschreibung || '',
      dueAt: a.faellig || '', done: a.erledigt ? 1 : 0,
      priority: a.prio === 'hoch' ? 'high' : a.prio === 'niedrig' ? 'low' : 'normal',
      itemType: 'task', caseLabel: fall.label, caseId, userId,
      sourceType: '', sourceId: '', sourceModule: ''
    });
  });

  /* Betreuungsuebersicht (halbjaehrliche Meldung an Gericht/Behoerde) */
  if (fall.uebersicht) {
    db.prepare(`
      INSERT INTO betreuung_overview_entries (case_id, period_start, aenderungsart, uebergabe_an, updated_by)
      VALUES (@caseId, @periodStart, @aenderungsart, @uebergabeAn, @userId)
      ON CONFLICT(case_id, period_start) DO UPDATE SET
        aenderungsart = excluded.aenderungsart, uebergabe_an = excluded.uebergabe_an,
        updated_at = datetime('now'), updated_by = excluded.updated_by
    `).run({ caseId, userId, ...fall.uebersicht });
  }

  /* Bueroorganisation: Fahrtkostennachweis und Ausgangsrechnungen mit Fallbezug */
  db.prepare('DELETE FROM mileage_trips WHERE case_label = ?').run(fall.label);
  const fahrzeug = db.prepare("SELECT id FROM private_vehicles WHERE status='aktiv' ORDER BY created_at LIMIT 1").get();
  const satz = db.prepare('SELECT id, betrag_pro_km FROM mileage_rates ORDER BY gueltig_ab DESC LIMIT 1').get();
  if (fahrzeug && (fall.fahrten || []).length) {
    const fahrerName = (db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) || {}).display_name || '';
    const fahrtStmt = db.prepare(`
      INSERT INTO mileage_trips (id, vehicle_id, fahrer_user_id, datum, fahranlass, case_label,
                                 start_adresse, ziel_adresse, kilometer, erstattungsbetrag_snapshot,
                                 rate_id_snapshot, status, fahrer_name)
      VALUES (@id, @vehicleId, @userId, @datum, @anlass, @caseLabel, @start, @ziel, @km, @betrag, @rateId, 'entwurf', @fahrerName)
    `);
    fall.fahrten.forEach((f, i) => {
      const proKm = satz ? Number(satz.betrag_pro_km) : 0.3;
      fahrtStmt.run({
        id: festeId(caseId, 'fahrt', i), vehicleId: fahrzeug.id, userId,
        datum: f.datum, anlass: f.anlass, caseLabel: fall.label,
        start: f.start, ziel: f.ziel, km: f.km,
        betrag: Math.round(f.km * proKm * 100) / 100,
        rateId: satz ? satz.id : null, fahrerName
      });
    });
  }

  db.prepare('DELETE FROM outgoing_invoices WHERE case_label = ?').run(fall.label);
  const reStmt = db.prepare(`
    INSERT INTO outgoing_invoices (id, re_datum, re_nummer, empfaenger, verwendungszweck, case_label,
                                   rechnungszeitraum, summe, eingang_datum, eingangsbetrag, updated_by)
    VALUES (@id, @datum, @nummer, @empfaenger, @zweck, @caseLabel, @zeitraum, @summe, @eingang, @eingangsbetrag, @userId)
  `);
  (fall.rechnungen || []).forEach((r, i) => {
    reStmt.run({
      id: festeId(caseId, 'rechnung', i), datum: r.datum, nummer: r.nummer,
      empfaenger: r.empfaenger, zweck: r.zweck, caseLabel: fall.label,
      zeitraum: r.zeitraum, summe: r.summe,
      eingang: r.eingang || null, eingangsbetrag: r.eingangsbetrag == null ? null : r.eingangsbetrag,
      userId
    });
  });

  return { kalender: kalender.length + (fall.termine || []).length, aufgaben: aufgaben.length + (fall.aufgaben || []).length };
}

/* Kontaktmonitor liegt als JSON in office_json und wird hier je Fall fortgeschrieben. */
function schreibeKontaktmonitor(eintraege) {
  const row = db.prepare("SELECT data_json FROM office_json WHERE key='kontaktmonitor'").get();
  let daten = { entries: [] };
  try { daten = row ? JSON.parse(row.data_json || '{}') : { entries: [] }; } catch (_e) { daten = { entries: [] }; }
  if (!Array.isArray(daten.entries)) daten.entries = [];
  for (const neu of eintraege) {
    const idx = daten.entries.findIndex((e) => e && String(e.caseId) === String(neu.caseId));
    if (idx >= 0) daten.entries[idx] = { ...daten.entries[idx], ...neu };
    else daten.entries.push(neu);
  }
  db.prepare(`
    INSERT INTO office_json (key, data_json, updated_at) VALUES ('kontaktmonitor', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json, updated_at = datetime('now')
  `).run(JSON.stringify(daten));
}

/* ------------------------------------------------------------------ Ablauf */

async function main() {
  const entfernen = process.argv.includes('--entfernen');
  const userId = seedUser();

  if (entfernen) {
    for (const id of DEMO_IDS) entferneFall(id);
    console.log(`${DEMO_IDS.length} Demonstrationsfaelle entfernt.`);
    return;
  }

  /* Schritt 1: Fallzeilen und Aktenordner - die Dokumentenablage braucht beides. */
  db.transaction(() => {
    DEMO_IDS.forEach((caseId, i) => {
      db.prepare(`
        INSERT INTO cases (id, label, file_number, created_at, created_by, stammdaten_json,
                           stammdaten_updated_at, stammdaten_updated_by, archived, archived_at, owner_user_id)
        VALUES (@id, @label, @fileNumber, @createdAt, @userId, '{}', datetime('now'), @userId, 0, '', NULL)
        ON CONFLICT(id) DO UPDATE SET label = excluded.label, file_number = excluded.file_number
      `).run({ id: caseId, label: faelle[i].label, fileNumber: faelle[i].fileNumber, createdAt: faelle[i].createdAt, userId });
    });
  })();
  try {
    documentStorage.syncAllCaseRoots();
    for (const id of DEMO_IDS) documentStorage.ensureCaseLayout(id, userId);
  } catch (error) {
    console.warn('Hinweis: Aktenordner konnten nicht vollstaendig erzeugt werden: ' + (error.message || error));
  }

  /* Schritt 2: Dokumente bauen und ablegen. */
  const zusatzProFall = new Map();
  for (let i = 0; i < DEMO_IDS.length; i++) {
    const caseId = DEMO_IDS[i];
    const fall = faelle[i];
    entferneDemoDokumente(caseId);
    const exportHistory = [];
    const history = [];
    for (const ex of fall.exporte || []) {
      const ref = await legeAusgangAb(caseId, fall, ex, userId);
      exportHistory.push(historienEintrag(ex, ref));
      const verlauf = verlaufsEintrag(ex, ref);
      if (verlauf) history.push(verlauf);
    }
    /* Neueste zuerst - so fuehrt die App die Liste (unshift beim Anlegen). */
    exportHistory.reverse();
    zusatzProFall.set(caseId, { exportHistory, history });
  }

  /* Schritt 3: Stammdaten samt Historie, Archiv und allen Modulen schreiben. */
  const monitor = [];
  db.transaction(() => {
    DEMO_IDS.forEach((caseId, i) => {
      const fall = faelle[i];
      const zahlen = schreibeFall(caseId, fall, userId, zusatzProFall.get(caseId));
      monitor.push({
        id: festeId(caseId, 'monitor', 0), caseId, caseLabel: fall.label, active: true,
        turnusDays: fall.kontaktmonitor.turnusDays, baseline: fall.kontaktmonitor.baseline,
        lastContact: fall.kontaktmonitor.lastContact, lastArt: fall.kontaktmonitor.lastArt,
        updatedAt: new Date(Date.parse(`${fall.kontaktmonitor.lastContact}T12:00:00Z`)).toISOString()
      });
      console.log(
        `  ${fall.label.padEnd(22)} Az. ${fall.fileNumber.padEnd(17)} ` +
        `${String(fall.doku.length).padStart(3)} Doku · ${String(fall.kontakte.length).padStart(2)} Kontakte · ` +
        `${String(Object.keys(fall.berichte || {}).length).padStart(2)} Berichte · ` +
        `${String(zahlen.kalender).padStart(2)} Termine · ${String(zahlen.aufgaben).padStart(2)} Aufgaben · ` +
        `${String((fall.exporte || []).length).padStart(2)} Ausgänge · ${String((fall.archive || []).length).padStart(2)} Archivstände`
      );
    });
    schreibeKontaktmonitor(monitor);
  })();

  console.log(`\n${DEMO_IDS.length} Demonstrationsfaelle angelegt bzw. aktualisiert.`);
}

main().catch((error) => {
  console.error('Fehlgeschlagen: ' + (error && error.stack || error));
  process.exitCode = 1;
});
