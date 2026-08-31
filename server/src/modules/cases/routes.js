// Fall-Endpunkte fuer den Online-Modus (Phase 2.1.1): die Datenbank ist die massgebliche Quelle
// (Stammdaten/Berichte/Falldokumentation als JSON je Fall/Bericht/Eintrag), keine Excel-/JSON-
// Dateien mehr auf dem Server. Aenderungen werden nach jedem erfolgreichen Schreiben per
// WebSocket an alle anderen Betrachter desselben Falls verteilt (siehe ws.js).

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_ROOT } = require('../../config/paths');
const db = require('../../database/index');
const {
  requireAuth, requireCaseManagement,
  requireViewCases, requireEditCases, requireViewDocuments, requireEditDocuments,
  hasPermission
} = require('../../middleware/authentication');
const { logAction } = require('../../middleware/audit');
const { sichtbareFaelle, darfSehen, darfBearbeiten } = require('./case-visibility');
const pfadSicher = require('../../shared/safe-path');
const mail = require('../mail/service');
const { schuetzePdfAnlagen, kennwortMailInhalt } = require('../mail/pdf-kennwort');
const dokuAttachments = require('../documents/case-note-attachments');
const { createDocumentStorage } = require('../documents/storage');
const documentTaxonomy = require('../documents/taxonomy');
const { createModuleFiles } = require('../documents/module-files');
const documentIntern = require('../documents/routes').intern;
const moduleFiles = createModuleFiles({ db, documents: documentIntern });

const caseDocumentStorage = createDocumentStorage({
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

// Nur lesender Rückfall für den früheren Dokumenten-Zwischenspeicher des Mail-Editors.
// Neue Berichte/Anlagen werden als doc_files im zentralen Dokumentenspeicher abgelegt.
const DOCUMENTS_DIR = path.join(DATA_ROOT, 'case-documents');
function documentFilePath(caseId, docId) {
  return path.join(DOCUMENTS_DIR, caseId, docId);
}

// Nur lesender Rückfall für Altbestände. Neue Falldokumentationsanlagen werden ausschließlich
// über moduleFiles als doc_files gespeichert; dieser Altpfad darf nicht mehr angelegt werden.
const DOKU_PHOTOS_DIR = path.join(DATA_ROOT, 'case-doku-photos');
const DOKU_PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DOKU_ATTACHMENT_MIME = new Set([
  ...DOKU_PHOTO_MIME,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/ogg',
  'video/mp4', 'video/quicktime', 'video/webm'
]);
function isAllowedDokuAttachmentMime(type) {
  return DOKU_ATTACHMENT_MIME.has(type) || type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/');
}
function dokuPhotoDir(caseId, entryId) {
  return path.join(DOKU_PHOTOS_DIR, caseId, entryId);
}
function safePhotoMeta(photo) {
  const previewDataUrl = String(photo.previewDataUrl || '');
  const safePreview = /^data:image\/(jpeg|png|webp|gif);base64,/i.test(previewDataUrl) && previewDataUrl.length <= 450000
    ? previewDataUrl
    : '';
  const mimeType = String(photo.mimeType || 'application/octet-stream').toLowerCase();
  return {
    id: String(photo.id || ''),
    filename: String(photo.filename || '').slice(0, 255),
    mimeType,
    size: Number(photo.size) || 0,
    uploadedAt: photo.uploadedAt || new Date().toISOString(),
    photoTakenAt: String(photo.photoTakenAt || '').slice(0, 32),
    photoPlace: String(photo.photoPlace || '').slice(0, 160),
    kind: String(photo.kind || (mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : 'document')).slice(0, 24),
    ...(safePreview ? { previewDataUrl: safePreview } : {})
  };
}
function dokuPhotoCentral(caseId, entryId, photoId) {
  return moduleFiles.resolve('doku-photo', entryId, photoId, true, caseId);
}
function linkSharedDokuPhoto(rows, photoId, fileId, caseId) {
  for (const candidate of rows || []) {
    if (!dokuAttachments.photoIdsFromRow(candidate).includes(String(photoId))) continue;
    try {
      moduleFiles.linkExisting('doku-photo', candidate.id, photoId, fileId, { caseId: String(caseId || '') });
    } catch (_error) { /* der Integritaetslauf meldet einen unvollstaendigen Verweis */ }
  }
}
function publicDokuEntry(row) {
  const data = JSON.parse(row.data_json);
  if (Array.isArray(data.photos)) data.photos = data.photos.map(safePhotoMeta).filter((p) => p.id);
  return { id: row.id, data };
}

const router = express.Router();
let realtime = null;
function setRealtime(rt) { realtime = rt; }
// v175: req mitgeben, damit die Fensterkennung (X-Window-Id) des Ausloesers durchgereicht
// werden kann - siehe broadcastToCase in ws.js. Ohne req oder ohne Kopfzeile: wie bisher.
function broadcast(caseId, message, req) {
  const vonFenster = (req && typeof req.get === 'function') ? (req.get('X-Window-Id') || null) : null;
  realtime && realtime.broadcastToCase(caseId, message, vonFenster);
}

// contacts lebt NICHT mehr hier - eigene Tabelle case_contacts (Phase 2.2), zeilenweise
// synchronisiert wie case_doku_entries, damit gleichzeitige Bearbeitung VERSCHIEDENER Kontakte
// durch mehrere Nutzer nicht mehr kollidiert (siehe Plan "Phase 2.2", Abschnitt D).
// Plan Abschnitt AL, Phase 2: drei neue Stammdaten-Felder fuer die Betreuungsuebersicht - homePlacement
// (Heimunterbringung/betreutes Wohnen, bisher nur report-lokal in Jahresbericht-Schemata vorhanden),
// takeoverDate (Uebernahme der Betreuung, z.B. bei Betreuerwechsel - unterscheidet sich von
// officeHandoverDate "Uebergabe an Geschaeftsstelle"), nextAccountingDue (naechste Abrechnung faellig
// am). Bestehende Faelle haben diese Felder schlicht nicht gesetzt (leerer String beim Lesen, ueber
// die uebliche "|| ''"-Fallback-Konvention dieser App) - kein Migrationsschritt fuer bereits
// bestehende cases.stammdaten_json noetig.
const EMPTY_STAMMDATEN = JSON.stringify({
  person: {}, care: { taskAreas: [], taskAreaDetails: [], homePlacement: '', takeoverDate: '', nextAccountingDue: '' }, health: {}, benefits: [], identifiers: [],
  insurances: [], banks: [], budget: {}, accommodation: {}, provisions: {}, socialNetwork: [],
  assets: { begin: [], end: [], debtsBegin: [], debtsEnd: [] }, livelihood: { income: [], expenses: [] }, history: [],
  // Handkasse/Kassenbuch (Barbetrag der betreuten Person, Modul 5) + Gesundheitsübersicht (Modul 11).
  // Beide leben unter caseData und werden dadurch automatisch über den Stammdaten-Blob synchronisiert
  // (combinedStammdatenView spreadet ...caseData) - kein eigener Endpunkt/keine eigene Tabelle nötig.
  handkasse: [], healthInfo: {}, approvals: [],
  // exportHistory ("Export- und Versandhistorie") gehoert eigentlich zu state.ui, wird aber im
  // selben JSON-Blob mitgefuehrt (siehe online-realtime-sync-script-v1, combinedStammdatenView()).
  // archives (Dokument-Versionsarchiv, client state.archives) reist seit Runde 13 genauso mit.
  exportHistory: [],
  archives: []
});

const listCasesStmt = db.prepare(`
  SELECT c.id, c.label, c.file_number, c.created_at, c.created_by,
         c.stammdaten_updated_at, c.stammdaten_updated_by, u.display_name AS updated_by_name,
         c.archived, c.archived_at, c.owner_user_id, uo.display_name AS owner_name,
         json_extract(c.stammdaten_json, '$.person.lastName') AS sd_last_name,
         json_extract(c.stammdaten_json, '$.person.firstName') AS sd_first_name,
         json_extract(c.stammdaten_json, '$.person.birthDate') AS sd_birth_date,
         COALESCE(json_array_length(c.stammdaten_json, '$.exportHistory'), 0) AS export_history_count,
         (SELECT COUNT(*) FROM case_contacts cc WHERE cc.case_id = c.id) AS contacts_count,
         (SELECT COUNT(*) FROM case_reports cr WHERE cr.case_id = c.id) AS reports_count,
         (SELECT COUNT(*) FROM case_doku_entries cd WHERE cd.case_id = c.id) AS doku_count
  FROM cases c
  LEFT JOIN users u ON u.id = c.stammdaten_updated_by
  LEFT JOIN users uo ON uo.id = c.owner_user_id
  ORDER BY c.label COLLATE NOCASE
`);
const getCaseStmt = db.prepare('SELECT * FROM cases WHERE id = ?');
const insertCaseStmt = db.prepare(`
  INSERT INTO cases (id, label, file_number, created_by, stammdaten_json, stammdaten_updated_by)
  VALUES (@id, @label, @fileNumber, @userId, @stammdatenJson, @userId)
`);
const deleteCaseStmt = db.prepare('DELETE FROM cases WHERE id = ?');
const deleteCaseReportsStmt = db.prepare('DELETE FROM case_reports WHERE case_id = ?');
const deleteCaseDokuStmt = db.prepare('DELETE FROM case_doku_entries WHERE case_id = ?');
const deleteCaseOverviewStmt = db.prepare('DELETE FROM betreuung_overview_entries WHERE case_id = ?');
const updateStammdatenStmt = db.prepare(`
  UPDATE cases SET stammdaten_json = ?, stammdaten_updated_at = datetime('now'), stammdaten_updated_by = ? WHERE id = ?
`);

const listReportsStmt = db.prepare('SELECT report_id, data_json FROM case_reports WHERE case_id = ?');
const getReportStmt = db.prepare('SELECT * FROM case_reports WHERE case_id = ? AND report_id = ?');
const deleteReportStmt = db.prepare('DELETE FROM case_reports WHERE case_id = ? AND report_id = ?');
const insertReportStmt = db.prepare(`
  INSERT INTO case_reports (case_id, report_id, data_json, updated_by) VALUES (@caseId, @reportId, @dataJson, @userId)
`);
const updateReportStmt = db.prepare(`
  UPDATE case_reports SET data_json = ?, updated_at = datetime('now'), updated_by = ? WHERE case_id = ? AND report_id = ?
`);

const listDokuStmt = db.prepare('SELECT id, data_json FROM case_doku_entries WHERE case_id = ? ORDER BY created_at');
const insertDokuStmt = db.prepare(`
  INSERT INTO case_doku_entries (id, case_id, data_json, updated_by) VALUES (@id, @caseId, @dataJson, @userId)
`);
const updateDokuStmt = db.prepare(`
  UPDATE case_doku_entries SET data_json = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ? AND case_id = ?
`);
const deleteDokuStmt = db.prepare('DELETE FROM case_doku_entries WHERE id = ? AND case_id = ?');
const getDokuStmt = db.prepare('SELECT * FROM case_doku_entries WHERE id = ? AND case_id = ?');

const deleteCaseContactsStmt = db.prepare('DELETE FROM case_contacts WHERE case_id = ?');
const listContactsStmt = db.prepare('SELECT id, data_json, created_at, updated_at FROM case_contacts WHERE case_id = ? ORDER BY created_at');
const insertContactStmt = db.prepare(`
  INSERT INTO case_contacts (id, case_id, data_json, updated_by) VALUES (@id, @caseId, @dataJson, @userId)
`);
const updateContactStmt = db.prepare(`
  UPDATE case_contacts SET data_json = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ? AND case_id = ?
`);
const getContactStmt = db.prepare('SELECT * FROM case_contacts WHERE id = ? AND case_id = ?');
const deleteContactStmt = db.prepare('DELETE FROM case_contacts WHERE id = ? AND case_id = ?');

const listDocumentsStmt = db.prepare('SELECT * FROM case_documents WHERE case_id = ? ORDER BY created_at DESC');
const getDocumentStmt = db.prepare('SELECT * FROM case_documents WHERE id = ? AND case_id = ?');
const insertDocumentStmt = db.prepare(`
  INSERT INTO case_documents (id, case_id, filename, mime_type, size, report_id, created_by)
  VALUES (@id, @caseId, @filename, @mimeType, @size, @reportId, @userId)
`);
const deleteDocumentStmt = db.prepare('DELETE FROM case_documents WHERE id = ? AND case_id = ?');
const deleteCaseDocumentsStmt = db.prepare('DELETE FROM case_documents WHERE case_id = ?');
const getFieldAttachmentImportStmt = db.prepare(`
  SELECT i.file_id,f.sha256,f.name,f.mime_type,f.size
    FROM doc_module_import i
    LEFT JOIN doc_files f ON f.id=i.file_id
   WHERE i.quelle='aussendienst-anlage' AND i.quell_id=?
`);
const rememberFieldAttachmentImportStmt = db.prepare(`
  INSERT INTO doc_module_import(quelle,quell_id,file_id)
  VALUES ('aussendienst-anlage',?,?)
  ON CONFLICT(quelle,quell_id) DO UPDATE SET file_id=excluded.file_id
`);
const clearCaseBankConnectionsStmt = db.prepare("UPDATE bank_connections SET case_id = NULL WHERE case_id = ?");
const clearManualBankAccountCasesStmt = db.prepare(`UPDATE bank_accounts_discovered
  SET case_assignment_mode='auto', manual_case_id=NULL,
      manual_case_updated_at=datetime('now'), manual_case_updated_by=NULL
  WHERE manual_case_id=?`);

function caseStammdatenBody(caseId) {
  const row = getCaseStmt.get(caseId);
  return row ? { data: JSON.parse(row.stammdaten_json) } : null;
}

function caseReportsBody(caseId) {
  return {
    reports: listReportsStmt.all(caseId)
      .map((row) => ({ reportId: row.report_id, data: JSON.parse(row.data_json) }))
  };
}

function caseDokuEntriesBody(caseId) {
  return { entries: listDokuStmt.all(caseId).map(publicDokuEntry) };
}

function publicContact(row) {
  const data = JSON.parse(row.data_json);
  return {
    id: row.id,
    data: {
      ...data,
      createdAt: data.createdAt || data.created_at || row.created_at,
      updatedAt: data.updatedAt || data.updated_at || row.updated_at
    }
  };
}

function caseContactsBody(caseId) {
  return { contacts: listContactsStmt.all(caseId).map(publicContact) };
}

function publicDocument(row) {
  return {
    id: row.id, filename: row.filename, mimeType: row.mime_type, size: row.size,
    reportId: row.report_id, createdAt: row.created_at
  };
}

function publicCase(row) {
  return {
    id: row.id,
    label: row.label,
    fileNumber: row.file_number,
    createdAt: row.created_at,
    stammdatenUpdatedAt: row.stammdaten_updated_at,
    stammdatenUpdatedBy: row.stammdaten_updated_by || null,
    stammdatenUpdatedByName: row.updated_by_name || null,
    archived: !!row.archived,
    archivedAt: row.archived_at || null,
    ownerUserId: row.owner_user_id == null ? null : Number(row.owner_user_id),
    ownerName: row.owner_name || null,
    // Für Auswahllisten bei Namensgleichheit: Die Fall-ID bleibt der technische Schlüssel,
    // das Geburtsdatum macht die beiden sichtbaren Optionen unterscheidbar.
    ...(row.sd_birth_date !== undefined ? { birthDate: row.sd_birth_date || '' } : {}),
    // Datenadministration: Bestandsauskunft je Fall (Stammdaten befuellt? Adressbuch-Kontakte?
    // Sicherungsinhalte = Dokumente/Verlauf/Versandhistorie?). Nur listCasesStmt liefert diese
    // Spalten - bei Einzelfall-Antworten (getCaseStmt, SELECT *) bleiben die Felder weg.
    ...(row.contacts_count !== undefined ? {
      hasStammdaten: !!(String(row.sd_last_name || '').trim() || String(row.sd_first_name || '').trim()),
      contactsCount: row.contacts_count,
      reportsCount: row.reports_count,
      dokuCount: row.doku_count,
      exportHistoryCount: row.export_history_count
    } : {})
  };
}

// Wendet eine Liste von {path, value}-Patches auf ein flaches ODER einfach verschachteltes Objekt
// an (Pfad z.B. "person" fuer Stammdaten-Abschnitte, oder "fields.vorname.value" fuer ein
// einzelnes Berichtsfeld). Erzeugt fehlende Zwischenobjekte, ueberschreibt sonst nur den
// referenzierten Zweig - alle anderen Pfade im Objekt bleiben unberuehrt (siehe Plan,
// Entscheidung "echte gleichzeitige Bearbeitung ohne Umbau der Editor-Oberflaeche").
//
// SICHERHEIT (Audit 2026-07-26, Befund B1): Der frueher hier stehende Walk betrat jedes Segment,
// auch "__proto__". Ein einziger PATCH eines ganz normalen Fall-Bearbeiters -
//   PATCH /api/cases/<id>/stammdaten {"patches":[{"path":"__proto__.label","value":"GEKAPERT"}]}
// - schrieb damit auf Object.prototype und veraenderte das Verhalten ALLER Routen im Prozess
// (am laufenden Server nachgewiesen: der naechste POST /api/cases lieferte label "GEKAPERT").
// Zusammen mit "key in branch" in permissions.js war das eine prozessweite Rechteausweitung.
// Das Schreiben laeuft deshalb jetzt ueber pfad-sicher.js - denselben Helfer, den auch der
// KI-Fernzugriff (mcp-tools.js, KINDS.stammdaten) benutzt, damit die Absicherung nicht zweimal
// implementiert und beim naechsten Umbau an einer Stelle vergessen wird.
// Der Helfer behebt zugleich drei stille Datenverluste dieses Pfades (Listen-Loecher,
// Listenpfad-wird-Objekt, ueberschriebener skalarer Zwischenknoten) - Begruendung dort.
function applyPatches(target, patches) {
  for (const { path, value } of patches || []) {
    if (!path || typeof path !== 'string') continue;
    pfadSicher.setzen(target, path, value);
  }
  return target;
}

router.use(requireAuth);
// Echtzeit (2026-07-19): erfolgreiche Schreiboperationen an alle Fenster/Nutzer melden.
router.use(require('../office/events').middleware('cases', /^(?!.*\/(stammdaten|doku-entries|reports|contacts)(\/|$))/));
// Automatische Stammdatenabbilder werden nicht mehr pauschal alle zehn Sekunden
// erzeugt. Jeder erfolgreiche Fall-Schreibweg markiert stattdessen genau diese
// Akte; der billige Revisionsscanner bleibt das Netz für ältere Nebenmodule.
router.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const first = String(req.path || '').split('/').filter(Boolean)[0] || '';
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    try {
      const service = require('../documents/materializations').current();
      if (!service) return;
      if (first && getCaseStmt.get(decodeURIComponent(first)) && typeof service.markCaseDirty === 'function') {
        service.markCaseDirty(decodeURIComponent(first));
      }
      if (typeof service.markOfficeDirty === 'function') service.markOfficeDirty();
    } catch (_error) { /* Der Revisionsscanner zieht den Stand notfalls nach. */ }
  });
  next();
});

/* Fallbezogene Sichtbarkeit (2026-07-26): eine einzige Wache fuer ALLE Routen mit :id.
   Bewusst als router.param und nicht je Route - so kann keine Route (auch keine kuenftige)
   den Schutz versehentlich auslassen. Lesen verlangt Sichtbarkeit, Schreiben Schreibrecht. */
router.param('id', (req, res, next, id) => {
  const lesend = req.method === 'GET' || req.method === 'HEAD';
  if (lesend ? darfSehen(req.session, id) : darfBearbeiten(req.session, id)) return next();
  return res.status(403).json({
    error: lesend
      ? 'Dieser Fall ist Ihrem Konto nicht zugeordnet.'
      : 'Sie haben für diesen Fall kein Bearbeitungsrecht.'
  });
});

/* requireViewCases ergaenzt (Audit 2026-07-26): die Fallliste enthaelt die Klarnamen aller
   Betreuten und war bisher nur durch requireAuth geschuetzt - ein Nutzer mit entzogenem
   Fall-Sichtrecht bekam sie trotzdem vollstaendig. */
router.get('/', requireViewCases, (req, res) => {
  const erlaubt = sichtbareFaelle(req.session);
  const alle = listCasesStmt.all();
  const sichtbar = erlaubt === null ? alle : alle.filter((c) => erlaubt.has(String(c.id)));
  res.json({ cases: sichtbar.map(publicCase) });
});

router.post('/', requireCaseManagement, (req, res) => {
  const { label, fileNumber } = req.body || {};
  if (!label || !String(label).trim()) {
    return res.status(400).json({ error: 'Fallbezeichnung erforderlich.' });
  }
  const id = crypto.randomUUID();
  insertCaseStmt.run({
    id, label: String(label).trim(), fileNumber: String(fileNumber || '').trim(),
    userId: req.session.userId, stammdatenJson: EMPTY_STAMMDATEN
  });
  let storageInfo;
  try {
    // Auch bereits vorhandene gleichnamige Faelle erhalten jetzt die verbindliche
    // Geburtsdatum-Ergaenzung. Unterordner unterhalb der Register entstehen weiterhin lazy.
    caseDocumentStorage.syncAllCaseRoots();
    storageInfo = caseDocumentStorage.ensureCaseLayout(id, req.session.userId);
  } catch (error) {
    return res.status(500).json({
      error: 'Der Fall wurde angelegt, sein lesbarer Aktenordner konnte aber nicht vollständig erzeugt werden: ' + (error.message || error),
      case: publicCase(getCaseWithName(id))
    });
  }
  logAction(req, 'case.create', 'case', id, { label: String(label).trim() });
  res.status(201).json({ case: publicCase(getCaseWithName(id)), storage: storageInfo });
});

router.patch('/:id', requireCaseManagement, (req, res) => {
  const { id } = req.params;
  const row = getCaseStmt.get(id);
  if (!row) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  const { label, fileNumber, archived } = req.body || {};
  // Plan Abschnitt AL, Phase 1: Archivieren ist eine reine Flag-Umschaltung (kein Loeschen) - der
  // Fall bleibt inklusive aller Berichte/Falldokumentation/Kontakte vollstaendig erhalten und kann
  // jederzeit zurueckgeholt werden. Eigener Audit-Log-Eintrag statt "case.rename", damit
  // Archivierungsvorgaenge im Log klar von reinen Umbenennungen unterscheidbar sind.
  const nextArchived = archived != null ? (archived ? 1 : 0) : row.archived;
  // archived_at nutzt SQLite's datetime('now') statt eines JS-Zeitstempels, damit das Format
  // konsistent mit den uebrigen *_at-Spalten dieser Tabelle bleibt (created_at/stammdaten_updated_at
  // nutzen ebenfalls datetime('now')).
  db.prepare(`
    UPDATE cases SET label = ?, file_number = ?, archived = ?,
      archived_at = CASE WHEN ? = 1 AND archived = 0 THEN datetime('now') WHEN ? = 0 THEN '' ELSE archived_at END,
      archived_by = CASE WHEN ? = 1 AND archived = 0 THEN ? WHEN ? = 0 THEN NULL ELSE archived_by END
    WHERE id = ?
  `).run(
    label != null ? String(label).trim() : row.label,
    fileNumber != null ? String(fileNumber).trim() : row.file_number,
    nextArchived,
    nextArchived, nextArchived,
    nextArchived, req.session.userId, nextArchived,
    id
  );
  if (label != null || fileNumber != null) {
    logAction(req, 'case.rename', 'case', id, { from: row.label, to: label != null ? String(label).trim() : row.label });
  }
  if (archived != null && !!archived !== !!row.archived) {
    logAction(req, archived ? 'case.archive' : 'case.unarchive', 'case', id, { label: row.label });
  }
  let storageInfo;
  try {
    caseDocumentStorage.syncAllCaseRoots();
    storageInfo = caseDocumentStorage.ensureCaseLayout(id, req.session.userId);
  } catch (error) {
    return res.status(500).json({ error: 'Falldaten wurden gespeichert, der Aktenordner konnte aber nicht nachgezogen werden: ' + (error.message || error) });
  }
  res.json({ case: publicCase(getCaseWithName(id)), storage: storageInfo });
});

router.delete('/:id', requireCaseManagement, (req, res) => {
  const { id } = req.params;
  const row = getCaseStmt.get(id);
  if (!row) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  const material = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM doc_files WHERE case_id=@id) AS explorer,
      (SELECT COUNT(*) FROM case_documents WHERE case_id=@id) AS dokumente,
      (SELECT COUNT(*) FROM case_doku_entries WHERE case_id=@id) AS doku,
      (SELECT COUNT(*) FROM case_reports WHERE case_id=@id) AS berichte,
      (SELECT COUNT(*) FROM case_contacts WHERE case_id=@id) AS kontakte
  `).get({ id });
  const materialCount = Object.values(material || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const legacyDirs = [path.join(DOCUMENTS_DIR, id), path.join(DOKU_PHOTOS_DIR, id)];
  const legacyBytes = legacyDirs.some((dir) => {
    try { return fs.readdirSync(dir).length > 0; } catch (_error) { return false; }
  });
  if (materialCount || legacyBytes) {
    return res.status(409).json({
      error: 'Dieser Fall enthält Unterlagen und darf deshalb nicht gelöscht werden. Bitte archivieren; die Herausgabe bleibt dadurch vollständig möglich.',
      material
    });
  }
  let emptyCaseRoot = null;
  try {
    const rootInfo = caseDocumentStorage.caseRootInfo(id, false);
    emptyCaseRoot = path.join(caseDocumentStorage.root(), ...rootInfo.storageRelpath.split('/'));
  } catch (_error) { emptyCaseRoot = null; }
  const tx = db.transaction(() => {
    deleteCaseContactsStmt.run(id);
    deleteCaseDokuStmt.run(id);
    deleteCaseReportsStmt.run(id);
    deleteCaseDocumentsStmt.run(id);
    deleteCaseOverviewStmt.run(id);
    clearCaseBankConnectionsStmt.run(id);
    clearManualBankAccountCasesStmt.run(id);
    db.prepare("DELETE FROM doc_folders WHERE area='case' AND case_id=?").run(id);
    db.prepare('DELETE FROM doc_case_roots WHERE case_id=?').run(id);
    deleteCaseStmt.run(id);
  });
  tx();
  // Nur fuer den nachweislich inhaltsleeren Fall duerfen leere technische Altordner weg.
  try { fs.rmSync(path.join(DOCUMENTS_DIR, id), { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  try { fs.rmSync(path.join(DOKU_PHOTOS_DIR, id), { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  if (emptyCaseRoot) {
    try { fs.rmSync(emptyCaseRoot, { recursive: true, force: true }); } catch (_e) { /* nachweislich leer */ }
  }
  logAction(req, 'case.delete', 'case', id, { label: row.label });
  res.json({ ok: true });
});

function getCaseWithName(id) {
  return db.prepare(`
    SELECT c.*, u.display_name AS updated_by_name FROM cases c
    LEFT JOIN users u ON u.id = c.stammdaten_updated_by
    WHERE c.id = ?
  `).get(id);
}

/*
 * Ein Fall-Ladevorgang war bisher auf vier HTTP-Verbindungen verteilt. Safari
 * stellte diese hinter zahlreichen anderen Startabfragen an. Die Sammelroute
 * liest dieselben vier Quellen direkt; ihre nicht-null Teilobjekte stammen aus
 * exakt denselben Funktionen wie die Einzelrouten darunter.
 *
 * Fall- und Dokumentrecht bleiben unabhängig. Ein fehlendes Teilrecht nullt
 * nur den betroffenen Teil. Die router.param-Wache oberhalb prüft weiterhin
 * vor jeder Abfrage die konkrete Fallzuordnung.
 */
router.get('/:id/load', (req, res) => {
  const mayViewCases = hasPermission(req, 'canViewCases');
  const mayViewDocuments = hasPermission(req, 'canViewDocuments');
  if (!mayViewCases && !mayViewDocuments) {
    return res.status(403).json({ error: 'Keine Berechtigung, diesen Fall anzusehen.' });
  }
  if (!getCaseStmt.get(req.params.id)) {
    return res.status(404).json({ error: 'Fall nicht gefunden.' });
  }
  res.json({
    stammdaten: mayViewCases ? caseStammdatenBody(req.params.id) : null,
    reports: mayViewDocuments ? caseReportsBody(req.params.id) : null,
    dokuEntries: mayViewCases ? caseDokuEntriesBody(req.params.id) : null,
    contacts: mayViewCases ? caseContactsBody(req.params.id) : null
  });
});

router.get('/:id/stammdaten', requireViewCases, (req, res) => {
  const body = caseStammdatenBody(req.params.id);
  if (!body) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  res.json(body);
});

router.patch('/:id/stammdaten', requireEditCases, (req, res) => {
  const { id } = req.params;
  const row = getCaseStmt.get(id);
  if (!row) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  const { patches } = req.body || {};
  if (!Array.isArray(patches) || !patches.length) {
    return res.status(400).json({ error: 'Keine Aenderungen uebermittelt.' });
  }
  /* applyPatches weist unzulaessige Pfade jetzt ab (siehe pfad-sicher.js). Der Fehler wird als
     schlichtes 400 beantwortet - ohne ihn liefe er in den Express-Standardhandler und der
     antwortete mit einer HTML-Seite samt Serverpfaden (gleiche Klasse wie Befund B9). */
  let data;
  try { data = applyPatches(JSON.parse(row.stammdaten_json), patches); }
  catch (e) { return res.status(400).json({ error: String(e.message || e) }); }
  updateStammdatenStmt.run(JSON.stringify(data), req.session.userId, id);
  const pfadRelevant = patches.some((patch) => /^(?:person\.)?(?:firstName|lastName|birthDate|geburtsdatum)$/.test(String(patch && patch.path || '')));
  if (pfadRelevant) {
    try {
      caseDocumentStorage.syncAllCaseRoots();
      caseDocumentStorage.ensureCaseLayout(id, req.session.userId);
    } catch (error) {
      return res.status(500).json({ error: 'Stammdaten wurden gespeichert, der Aktenordner konnte aber nicht nachgezogen werden: ' + (error.message || error) });
    }
  }
  broadcast(id, { type: 'patch', scope: 'stammdaten', patches, updatedBy: req.session.displayName }, req);
  res.json({ ok: true });
});

router.get('/:id/reports', requireViewDocuments, (req, res) => {
  if (!getCaseStmt.get(req.params.id)) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  res.json(caseReportsBody(req.params.id));
});

router.patch('/:id/reports/:reportId', requireEditDocuments, (req, res) => {
  const { id, reportId } = req.params;
  if (!getCaseStmt.get(id)) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  const { patches } = req.body || {};
  if (!Array.isArray(patches) || !patches.length) {
    return res.status(400).json({ error: 'Keine Aenderungen uebermittelt.' });
  }
  const existing = getReportStmt.get(id, reportId);
  let data;
  try { data = applyPatches(existing ? JSON.parse(existing.data_json) : { fields: {}, meta: {} }, patches); }
  catch (e) { return res.status(400).json({ error: String(e.message || e) }); }
  if (existing) {
    updateReportStmt.run(JSON.stringify(data), req.session.userId, id, reportId);
  } else {
    insertReportStmt.run({ caseId: id, reportId, dataJson: JSON.stringify(data), userId: req.session.userId });
  }
  broadcast(id, { type: 'patch', scope: 'report', reportId, patches, updatedBy: req.session.displayName }, req);
  res.json({ ok: true });
});

// Einzelnen Bericht aus einem Fall entfernen (u. a. um versehentlich fallbezogen abgelegte
// buero_*-Dokumente zu bereinigen – diese werden fallunabhaengig im Browser-Speicher gefuehrt).
router.delete('/:id/reports/:reportId', requireEditDocuments, (req, res) => {
  const { id, reportId } = req.params;
  if (!getCaseStmt.get(id)) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  deleteReportStmt.run(id, reportId);
  broadcast(id, { type: 'report-delete', scope: 'report', reportId, updatedBy: req.session.displayName }, req);
  res.json({ ok: true });
});

router.get('/:id/doku-entries', requireViewCases, (req, res) => {
  if (!getCaseStmt.get(req.params.id)) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  res.json(caseDokuEntriesBody(req.params.id));
});

router.post('/:id/doku-entries', requireEditCases, (req, res) => {
  const { id } = req.params;
  if (!getCaseStmt.get(id)) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  const entryId = crypto.randomUUID();
  const data = req.body?.data || {};
  insertDokuStmt.run({ id: entryId, caseId: id, dataJson: JSON.stringify(data), userId: req.session.userId });
  broadcast(id, { type: 'doku-entry', action: 'create', entry: { id: entryId, data }, updatedBy: req.session.displayName }, req);
  res.status(201).json({ id: entryId });
});

router.put('/:id/doku-entries/:entryId', requireEditCases, (req, res) => {
  const { id, entryId } = req.params;
  if (!getDokuStmt.get(entryId, id)) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  const data = req.body?.data || {};
  updateDokuStmt.run(JSON.stringify(data), req.session.userId, entryId, id);
  broadcast(id, { type: 'doku-entry', action: 'update', entry: { id: entryId, data }, updatedBy: req.session.displayName }, req);
  res.json({ ok: true });
});

router.delete('/:id/doku-entries/:entryId', requireEditCases, (req, res) => {
  const { id, entryId } = req.params;
  const row = getDokuStmt.get(entryId, id);
  if (!row) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  const photoIds = dokuAttachments.photoIdsFromRow(row);
  const rowsBefore = listDokuStmt.all(id);
  // Geteilte Anlagen zuerst aus dem eintragsgebundenen Altspeicher an den stabilen Ort
  // uebernehmen. Danach kann der Eintrag verschwinden, ohne fremde Verweise zu brechen.
  for (const photoId of photoIds) {
    if (dokuAttachments.referenceCount(rowsBefore, photoId, entryId) > 0) {
      try { dokuAttachments.adopt(DOKU_PHOTOS_DIR, id, photoId, entryId); }
      catch (error) { return res.status(500).json({ error: 'Geteilte Anlage konnte vor dem Löschen nicht gesichert werden: ' + (error.message || error) }); }
    }
  }
  deleteDokuStmt.run(entryId, id);
  const rowsAfter = listDokuStmt.all(id);
  for (const photoId of photoIds) {
    const central = dokuPhotoCentral(id, entryId, photoId);
    if (central && central.row) linkSharedDokuPhoto(rowsAfter, photoId, central.row.id, id);
    moduleFiles.unlink('doku-photo', entryId, photoId);
    try { dokuAttachments.removeUnreferenced(DOKU_PHOTOS_DIR, id, photoId, rowsAfter); }
    catch (_e) { /* Metadaten sind geloescht; Integritaetslauf meldet eine etwaige Altdatei */ }
  }
  dokuAttachments.removeDirIfEmpty(dokuPhotoDir(id, entryId));
  broadcast(id, { type: 'doku-entry', action: 'delete', entry: { id: entryId }, updatedBy: req.session.displayName }, req);
  res.json({ ok: true });
});

router.post('/:id/doku-entries/:entryId/photos', requireEditCases, (req, res) => {
  const { id, entryId } = req.params;
  const row = getDokuStmt.get(entryId, id);
  if (!row) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  const {
    filename, mimeType, dataBase64, previewDataUrl, photoTakenAt, photoPlace, kind,
    snapshotId, changeId, attachmentId, sha256
  } = req.body || {};
  const type = String(mimeType || '').toLowerCase();
  if (!filename || !dataBase64) return res.status(400).json({ error: 'Dateiname und Inhalt erforderlich.' });
  if (!isAllowedDokuAttachmentMime(type)) return res.status(400).json({ error: 'Dieser Dateityp ist für die Falldokumentation nicht erlaubt.' });
  let bytes;
  try { bytes = Buffer.from(dataBase64, 'base64'); } catch (_e) { return res.status(400).json({ error: 'Ungültige Dateidaten.' }); }
  if (!bytes.length) return res.status(400).json({ error: 'Datei ist leer.' });
  if (bytes.length > 250 * 1024 * 1024) return res.status(413).json({ error: 'Datei ist zu groß (maximal 250 MB).' });
  const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 && String(sha256).toLowerCase() !== actualSha256) {
    return res.status(409).json({ error: 'Die Prüfsumme der Außendienstanlage stimmt nicht.' });
  }
  const importParts = [snapshotId, changeId, attachmentId].map((value) => String(value || '').trim());
  const fieldImport = importParts.some(Boolean);
  if (fieldImport && importParts.some((value) => !value)) {
    return res.status(400).json({
      error: 'Außendienstanlagen benötigen Snapshot-, Änderungs- und Anlagenkennung vollständig.'
    });
  }
  const importKey = fieldImport ? JSON.stringify(importParts) : '';
  const deterministic = fieldImport
    ? crypto.createHash('sha256').update(importKey).digest('hex').slice(0, 32)
    : '';
  const photoId = fieldImport
    ? `ad-${deterministic.slice(0, 8)}-${deterministic.slice(8, 16)}-${deterministic.slice(16, 24)}-${deterministic.slice(24)}`
    : crypto.randomUUID();
  const data = JSON.parse(row.data_json);
  data.photos = Array.isArray(data.photos) ? data.photos.map(safePhotoMeta).filter((p) => p.id) : [];
  if (fieldImport) {
    const remembered = getFieldAttachmentImportStmt.get(importKey);
    if (remembered) {
      if (!remembered.file_id || String(remembered.sha256 || '').toLowerCase() !== actualSha256) {
        return res.status(409).json({
          error: 'Diese Außendienst-Anlagenkennung wurde bereits mit einem anderen Dateiinhalt verwendet.'
        });
      }
      let photo = data.photos.find((item) => item.id === photoId);
      if (!photo) {
        photo = safePhotoMeta({
          id: photoId,
          filename: remembered.name || filename,
          mimeType: remembered.mime_type || type,
          size: remembered.size || bytes.length,
          uploadedAt: new Date().toISOString(),
          previewDataUrl, photoTakenAt, photoPlace, kind
        });
        data.photos.push(photo);
        db.transaction(() => {
          moduleFiles.linkExisting('doku-photo', entryId, photoId, remembered.file_id, {
            caseId: id, entryId, photoId, snapshotId: importParts[0],
            changeId: importParts[1], attachmentId: importParts[2], sha256: actualSha256
          });
          updateDokuStmt.run(JSON.stringify(data), req.session.userId, entryId, id);
        })();
      }
      return res.status(200).json({ photo, entry: { id: entryId, data }, duplicate: true });
    }
  }
  let central;
  try {
    central = moduleFiles.store({
      module: 'doku-photo',
      ownerId: entryId,
      slot: photoId,
      area: 'case',
      caseId: id,
      folders: documentTaxonomy.dokuPfad(data, row.created_at || new Date().toISOString()),
      filename,
      mimeType: type,
      bytes,
      createdBy: req.session.userId,
      date: photoTakenAt || data.eventDate || data.ereignisdatum || data.date || data.datum || row.created_at,
      detail: {
        caseId: id, entryId, photoId,
        ...(fieldImport ? {
          snapshotId: importParts[0], changeId: importParts[1],
          attachmentId: importParts[2], sha256: actualSha256
        } : {})
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Anlage konnte nicht sicher im Dokumentenspeicher abgelegt werden: ' + (error.message || error) });
  }
  const photo = safePhotoMeta({ id: photoId, filename: central.name, mimeType: type, size: bytes.length, uploadedAt: new Date().toISOString(), previewDataUrl, photoTakenAt, photoPlace, kind });
  data.photos.push(photo);
  try {
    db.transaction(() => {
      updateDokuStmt.run(JSON.stringify(data), req.session.userId, entryId, id);
      if (fieldImport) rememberFieldAttachmentImportStmt.run(importKey, central.id);
    })();
  } catch (error) {
    return res.status(500).json({
      error: 'Anlage wurde abgelegt, aber ihre fachliche Zuordnung konnte nicht atomar bestätigt werden: '
        + (error.message || error)
    });
  }
  broadcast(id, { type: 'doku-entry', action: 'update', entry: { id: entryId, data }, updatedBy: req.session.displayName }, req);
  res.status(201).json({ photo, entry: { id: entryId, data } });
});

router.get('/:id/doku-entries/:entryId/photos/:photoId', requireViewCases, (req, res) => {
  const { id, entryId, photoId } = req.params;
  const row = getDokuStmt.get(entryId, id);
  if (!row) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  const data = JSON.parse(row.data_json);
  const photo = (Array.isArray(data.photos) ? data.photos : []).map(safePhotoMeta).find((p) => p.id === photoId);
  if (!photo) return res.status(404).json({ error: 'Anlage nicht gefunden.' });
  const central = dokuPhotoCentral(id, entryId, photoId);
  const filePath = (central && central.filePath) || dokuAttachments.resolve(DOKU_PHOTOS_DIR, id, photoId, entryId);
  if (!filePath) return res.status(404).json({ error: 'Datei nicht mehr auf dem Server vorhanden.' });
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', photo.mimeType || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', req.query.variant === 'preview' ? 'private, max-age=3600' : 'no-cache');
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(photo.filename || 'foto')}"`);
  const range = req.headers.range;
  if (range && req.query.download !== '1') {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range));
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (!m[1] && m[2]) {
        const suffix = parseInt(m[2], 10);
        start = Math.max(0, stat.size - suffix);
        end = stat.size - 1;
      }
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < stat.size) {
        const safeEnd = Math.min(end, stat.size - 1);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${safeEnd}/${stat.size}`);
        res.setHeader('Content-Length', safeEnd - start + 1);
        return fs.createReadStream(filePath, { start, end: safeEnd }).pipe(res);
      }
    }
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    return res.sendStatus(416);
  }
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(filePath).pipe(res);
});

router.delete('/:id/doku-entries/:entryId/photos/:photoId', requireEditCases, (req, res) => {
  const { id, entryId, photoId } = req.params;
  const row = getDokuStmt.get(entryId, id);
  if (!row) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  const data = JSON.parse(row.data_json);
  const before = Array.isArray(data.photos) ? data.photos.map(safePhotoMeta).filter((p) => p.id) : [];
  if (!before.some((p) => p.id === photoId)) return res.status(404).json({ error: 'Foto nicht gefunden.' });
  const rowsBefore = listDokuStmt.all(id);
  const central = dokuPhotoCentral(id, entryId, photoId);
  if (dokuAttachments.referenceCount(rowsBefore, photoId, entryId) > 0) {
    try { dokuAttachments.adopt(DOKU_PHOTOS_DIR, id, photoId, entryId); }
    catch (error) { return res.status(500).json({ error: 'Geteilte Anlage konnte nicht gesichert werden: ' + (error.message || error) }); }
  }
  data.photos = before.filter((p) => p.id !== photoId);
  updateDokuStmt.run(JSON.stringify(data), req.session.userId, entryId, id);
  const rowsAfter = listDokuStmt.all(id);
  if (central && central.row) linkSharedDokuPhoto(rowsAfter, photoId, central.row.id, id);
  moduleFiles.unlink('doku-photo', entryId, photoId);
  try { dokuAttachments.removeUnreferenced(DOKU_PHOTOS_DIR, id, photoId, rowsAfter); }
  catch (_e) { /* Integritaetslauf meldet eine etwaige Altdatei */ }
  broadcast(id, { type: 'doku-entry', action: 'update', entry: { id: entryId, data }, updatedBy: req.session.displayName }, req);
  res.json({ ok: true, entry: { id: entryId, data } });
});

router.get('/:id/contacts', requireViewCases, (req, res) => {
  if (!getCaseStmt.get(req.params.id)) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  res.json(caseContactsBody(req.params.id));
});

router.post('/:id/contacts', requireEditCases, (req, res) => {
  const { id } = req.params;
  if (!getCaseStmt.get(id)) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  const contactId = crypto.randomUUID();
  const data = req.body?.data || {};
  insertContactStmt.run({ id: contactId, caseId: id, dataJson: JSON.stringify(data), userId: req.session.userId });
  broadcast(id, { type: 'contact', action: 'create', contact: { id: contactId, data }, updatedBy: req.session.displayName }, req);
  res.status(201).json({ id: contactId });
});

router.put('/:id/contacts/:contactId', requireEditCases, (req, res) => {
  const { id, contactId } = req.params;
  if (!getContactStmt.get(contactId, id)) return res.status(404).json({ error: 'Kontakt nicht gefunden.' });
  const data = req.body?.data || {};
  updateContactStmt.run(JSON.stringify(data), req.session.userId, contactId, id);
  broadcast(id, { type: 'contact', action: 'update', contact: { id: contactId, data }, updatedBy: req.session.displayName }, req);
  res.json({ ok: true });
});

router.delete('/:id/contacts/:contactId', requireEditCases, (req, res) => {
  const { id, contactId } = req.params;
  if (!getContactStmt.get(contactId, id)) return res.status(404).json({ error: 'Kontakt nicht gefunden.' });
  deleteContactStmt.run(contactId, id);
  broadcast(id, { type: 'contact', action: 'delete', contact: { id: contactId }, updatedBy: req.session.displayName }, req);
  res.json({ ok: true });
});

/* Zustaendigkeit und Freigaben eines Falls (2026-07-26).
   Lesen darf, wer den Fall ohnehin sieht; Aendern nur die Fallverwaltung bzw. Admin - sonst
   koennte sich ein Nutzer selbst Faelle zuschanzen. */
router.get('/:id/access', requireViewCases, (req, res) => {
  const fall = db.prepare('SELECT owner_user_id FROM cases WHERE id = ?').get(String(req.params.id));
  if (!fall) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  const freigaben = db.prepare(`SELECT ca.user_id AS userId, ca.level, u.display_name AS name, u.username
    FROM case_access ca LEFT JOIN users u ON u.id = ca.user_id WHERE ca.case_id = ? ORDER BY u.display_name`).all(String(req.params.id));
  res.json({ ownerUserId: fall.owner_user_id == null ? null : Number(fall.owner_user_id), freigaben });
});

router.put('/:id/access', requireCaseManagement, (req, res) => {
  const id = String(req.params.id);
  if (!db.prepare('SELECT id FROM cases WHERE id = ?').get(id)) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  const roh = req.body || {};
  let owner = roh.ownerUserId;
  owner = (owner === null || owner === '' || owner === undefined) ? null : Number(owner);
  if (owner != null && !db.prepare('SELECT id FROM users WHERE id = ?').get(owner)) {
    return res.status(400).json({ error: 'Unbekanntes Benutzerkonto als Zuständige/r.' });
  }
  const liste = Array.isArray(roh.freigaben) ? roh.freigaben : [];
  const sauber = [];
  for (const f of liste.slice(0, 200)) {
    const uid = Number(f && f.userId);
    if (!uid || !db.prepare('SELECT id FROM users WHERE id = ?').get(uid)) continue;
    if (owner != null && uid === owner) continue;            /* Eigentuemer braucht keine Freigabe */
    const level = String(f.level) === 'write' ? 'write' : 'read';
    if (!sauber.some((x) => x.userId === uid)) sauber.push({ userId: uid, level });
  }
  const schreiben = db.transaction(() => {
    db.prepare('UPDATE cases SET owner_user_id = ? WHERE id = ?').run(owner, id);
    db.prepare('DELETE FROM case_access WHERE case_id = ?').run(id);
    const ins = db.prepare('INSERT INTO case_access (case_id, user_id, level, created_by) VALUES (?, ?, ?, ?)');
    for (const f of sauber) ins.run(id, f.userId, f.level, req.session.userId);
  });
  schreiben();
  logAction(req, 'case.access', 'case', id, { ownerUserId: owner, freigaben: sauber.length });
  res.json({ ownerUserId: owner, freigaben: sauber });
});

router.post('/:id/migrate', requireCaseManagement, (req, res) => {
  const { id } = req.params;
  if (!getCaseStmt.get(id)) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  const { stammdaten, reports, dokuEntries, contacts } = req.body || {};
  if (!stammdaten || typeof stammdaten !== 'object') {
    return res.status(400).json({ error: 'Stammdaten fehlen.' });
  }
  const tx = db.transaction(() => {
    updateStammdatenStmt.run(JSON.stringify(stammdaten), req.session.userId, id);
    deleteCaseReportsStmt.run(id);
    for (const r of reports || []) {
      if (!r || !r.reportId) continue;
      insertReportStmt.run({ caseId: id, reportId: r.reportId, dataJson: JSON.stringify(r.data || {}), userId: req.session.userId });
    }
    deleteCaseDokuStmt.run(id);
    for (const entryData of dokuEntries || []) {
      insertDokuStmt.run({ id: crypto.randomUUID(), caseId: id, dataJson: JSON.stringify(entryData || {}), userId: req.session.userId });
    }
    deleteCaseContactsStmt.run(id);
    for (const contactData of contacts || []) {
      insertContactStmt.run({ id: crypto.randomUUID(), caseId: id, dataJson: JSON.stringify(contactData || {}), userId: req.session.userId });
    }
  });
  tx();
  let storageInfo;
  try {
    caseDocumentStorage.syncAllCaseRoots();
    storageInfo = caseDocumentStorage.ensureCaseLayout(id, req.session.userId);
  } catch (error) {
    return res.status(500).json({ error: 'Falldaten wurden importiert, der Aktenordner konnte aber nicht nachgezogen werden: ' + (error.message || error) });
  }
  logAction(req, 'case.migrate', 'case', id, { reportsCount: (reports || []).length, dokuEntriesCount: (dokuEntries || []).length, contactsCount: (contacts || []).length });
  res.json({ case: publicCase(getCaseWithName(id)), storage: storageInfo });
});

// ===== Dokumenten-Zwischenspeicher fuer den Mail-Editor (Phase 6, Plan Abschnitt Z) =====
// Nur im Online-Modus relevant - der Mail-Editor bietet hier zwischengespeicherte generierte
// Berichte/Anlagen automatisch zum Versand an, ohne dass der Nutzer sie in einer spaeteren Sitzung
// erneut hochladen muss (im Lokal-Modus gibt es diesen Endpunkt naturgemaess nicht, dort haengt
// alles vom Browser-Arbeitsspeicher der aktuellen Sitzung ab).
router.get('/:id/documents', requireViewDocuments, (req, res) => {
  if (!getCaseStmt.get(req.params.id)) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  res.json({ documents: listDocumentsStmt.all(req.params.id).map(publicDocument) });
});

router.post('/:id/documents', requireEditDocuments, (req, res) => {
  const { id } = req.params;
  if (!getCaseStmt.get(id)) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  const { filename, mimeType, dataBase64, reportId } = req.body || {};
  if (!filename || !dataBase64) return res.status(400).json({ error: 'Dateiname und Inhalt erforderlich.' });
  let bytes;
  try { bytes = Buffer.from(dataBase64, 'base64'); } catch (_e) { return res.status(400).json({ error: 'Ungültige Dateidaten.' }); }
  if (bytes.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Datei ist zu groß (maximal 25 MB).' });
  const docId = crypto.randomUUID();
  let central;
  try {
    central = moduleFiles.store({
      module: 'case-document',
      ownerId: docId,
      slot: '',
      caseId: id,
      filename,
      mimeType: mimeType || 'application/octet-stream',
      bytes,
      createdBy: req.session.userId,
      date: new Date().toISOString(),
      detail: { caseId: id, reportId: reportId || '' }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Dokument konnte nicht sicher im Dokumentenspeicher abgelegt werden: ' + (error.message || error) });
  }
  insertDocumentStmt.run({
    id: docId, caseId: id, filename: central.name, mimeType: mimeType || 'application/octet-stream',
    size: bytes.length, reportId: reportId || '', userId: req.session.userId
  });
  res.status(201).json({ document: publicDocument(getDocumentStmt.get(docId, id)) });
});

router.get('/:id/documents/:docId', requireViewDocuments, (req, res) => {
  const { id, docId } = req.params;
  const row = getDocumentStmt.get(docId, id);
  if (!row) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
  const central = moduleFiles.resolve('case-document', docId, '', false);
  const filePath = (central && central.filePath) || documentFilePath(id, docId);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht mehr auf dem Server vorhanden.' });
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.filename)}"`);
  fs.createReadStream(filePath).pipe(res);
});

router.delete('/:id/documents/:docId', requireEditDocuments, (req, res) => {
  const { id, docId } = req.params;
  if (!getDocumentStmt.get(docId, id)) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
  deleteDocumentStmt.run(docId, id);
  moduleFiles.unlink('case-document', docId, '');
  try { fs.unlinkSync(documentFilePath(id, docId)); } catch (_e) { /* ignore */ }
  res.json({ ok: true });
});

// ===== Direkter Mail-Versand aus dem Mail-Editor (Phase 6, Plan Abschnitt Z) =====
// Nutzt die buerobezogene SMTP-Konfiguration (server/mail.js, smtp_config) - dieselbe wie fuer
// die "Passwort vergessen"-Benachrichtigung. Anlagen kommen entweder aus dem Dokumenten-
// Zwischenspeicher oben (attachmentIds) oder werden frisch mitgeschickt (extraAttachments, z.B.
// Anlagen aus dem Lokal-Modus bzw. Dateien, die noch nicht zwischengespeichert wurden).
router.post('/:id/send-mail', requireEditDocuments, async (req, res) => {
  const { id } = req.params;
  if (!getCaseStmt.get(id)) return res.status(404).json({ error: 'Fall nicht gefunden.' });
  const { to, cc, bcc, subject, body, html, attachmentIds, extraAttachments, pdfKennwort, pdfKennwortMail } = req.body || {};
  if (!to) return res.status(400).json({ error: 'Empfänger-E-Mail-Adresse erforderlich.' });
  const attachments = [];
  for (const docId of attachmentIds || []) {
    const row = getDocumentStmt.get(docId, id);
    if (!row) continue;
    const central = moduleFiles.resolve('case-document', docId, '', false);
    const filePath = (central && central.filePath) || documentFilePath(id, docId);
    if (!fs.existsSync(filePath)) {
      return res.status(409).json({ error: `Die angeforderte Anlage „${row.filename}“ fehlt im Dokumentenspeicher.` });
    }
    attachments.push({ filename: row.filename, mimeType: row.mime_type, content: fs.readFileSync(filePath) });
  }
  for (const extra of extraAttachments || []) {
    if (!extra || !extra.filename || !extra.dataBase64) continue;
    try {
      attachments.push({ filename: extra.filename, mimeType: extra.mimeType, content: Buffer.from(extra.dataBase64, 'base64') });
    } catch (_e) { /* ungueltige Anlage einfach ueberspringen */ }
  }
  try {
    await schuetzePdfAnlagen(attachments, pdfKennwort);
    await mail.sendDocumentMail({ to, cc, bcc, subject, body, html, attachments }, mail.resolveUserSmtpCfg(req.session.userId, req.session.mode));
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Mail konnte nicht gesendet werden.' });
  }
  logAction(req, 'case.mail_sent', 'case', id, { to, subject, attachmentCount: attachments.length });
  let kennwortMailFehler = null;
  if (pdfKennwortMail && String(pdfKennwort || '').trim()) {
    try {
      const inhalt = kennwortMailInhalt(subject, String(pdfKennwort).trim());
      await mail.sendDocumentMail({ to, cc, bcc, subject: inhalt.subject, body: inhalt.body, html: '', attachments: [] }, mail.resolveUserSmtpCfg(req.session.userId, req.session.mode));
      logAction(req, 'case.mail_sent', 'case', id, { to, subject: inhalt.subject, attachmentCount: 0 });
    } catch (fehler) {
      kennwortMailFehler = 'Die Dokument-E-Mail wurde gesendet, aber die Kennwort-E-Mail schlug fehl: ' + (fehler.message || fehler);
    }
  }
  res.json(kennwortMailFehler ? { ok: true, kennwortMailFehler } : { ok: true });
});

module.exports = router;
module.exports.setRealtime = setRealtime;
// Fuer serverseitige Blob-Schreibungen ausserhalb dieser Routen (MCP-Fernzugriff): offene
// Betrachter des Falls sofort benachrichtigen. Message-Format siehe Client-handleMessage.
module.exports.broadcastCase = broadcast;
