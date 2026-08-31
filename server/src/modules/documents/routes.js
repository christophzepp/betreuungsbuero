// Zentraler Dokumentenspeicher mit lesbarem Klarname-Ordnerbaum. SQLite bleibt Index für Rechte,
// Verknüpfungen, Versionen und Suche; die Primärdatei liegt unter Dokumentenspeicher/Fallakten,
// Fallakten-Archiv oder Büroorganisation. Die früheren UUID-Bloborte bleiben ausschließlich als
// Lese-/Migrationsquellen erhalten.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const express = require('express');
const {
  SERVER_ROOT,
  PROJECT_ROOT,
  DATA_ROOT: DEFAULT_DATA_ROOT,
  DATABASE_PATH,
  OUTPUTS_ROOT
} = require('../../config/paths');
const db = require('../../database/index');
const officeEvents = require('../office/events');
const dokuAttachments = require('./case-note-attachments');
const documentNames = require('./names');
const documentTaxonomy = require('./taxonomy');
const handoverPackage = require('../cases/handover-package');
const backupData = require('../backup/portable-data');
const operationCoordinator = require('./operation-coordinator');
const {
  createDocumentStorage, joinRoot, overlappingRoot
} = require('./storage');
const { createDocumentReconciler } = require('./reconcile');
const { createDocumentFinderSync } = require('./finder-sync');
const {
  pruefeZiel: pruefeGesamtBackupZiel,
  TARGET_MARKER: BACKUP_TARGET_MARKER,
  TARGET_MARKER_HEADER: BACKUP_TARGET_MARKER_HEADER,
  inspectOffsiteBacklog
} = require('../backup/runner');
const backupScheduler = require('../backup/document-backup');
const {
  requireAuth, requireViewDocuments, requireEditDocuments, verifyPassword
} = require('../../middleware/authentication');
const { sichtbareFaelle } = require('../cases/case-visibility');
const { parseUserPermissions } = require('../../middleware/authorization');

const router = express.Router();
router.use(requireAuth);
const liveDocumentUserStmt = db.prepare('SELECT * FROM users WHERE id = ?');
function refreshLiveDocumentSession(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const session = req.session || {};
  const liveUser = session.userId ? liveDocumentUserStmt.get(session.userId) : null;
  const allowed = !!(
    session.mode === 'online'
    && liveUser
    && liveUser.active !== 0
    && liveUser.allow_online !== 0
  );
  if (!allowed) {
    session.isAdmin = false;
    session.canViewDocuments = false;
    session.canEditDocuments = false;
    session.canManageOfficeProfile = false;
    session.canDocsAllCases = false;
    session.canViewAllCases = false;
    return res.status(403).json({
      error: 'Der Online-Zugriff auf den Dokumentenspeicher ist nicht mehr freigegeben.'
    });
  }
  const branch = parseUserPermissions(liveUser).online;
  const effective = (key) => !!(liveUser.is_admin || branch[key]);
  session.isAdmin = !!liveUser.is_admin;
  session.canViewDocuments = effective('viewDocuments');
  session.canEditDocuments = effective('editDocuments');
  session.canManageOfficeProfile = effective('manageOfficeProfile');
  session.canDocsAllCases = effective('docsAllCases');
  session.canViewAllCases = effective('viewAllCases');
  session.allowCaseManagement = effective('caseManagement');
  req.liveDocumentUser = liveUser;
  next();
}
router.use(refreshLiveDocumentSession);
function requireLiveBackupAdmin(req, res, next) {
  const protectedAdminPath = req.path.startsWith('/backup-')
    || req.path.startsWith('/materializations/')
    || req.path === '/maintenance-plans'
    || req.path.startsWith('/maintenance-plans/');
  if (!protectedAdminPath) return next();
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const session = req.session || {};
  const liveUser = req.liveDocumentUser;
  const allowed = !!(
    session.mode === 'online'
    && liveUser
    && liveUser.active !== 0
    && liveUser.is_admin !== 0
    && liveUser.allow_online !== 0
  );
  // Eine alte Sitzung ist keine Autoritätsquelle. Der aktuelle DB-Stand wird
  // bei jedem Sicherungsaufruf in beide Richtungen in die Sitzung gespiegelt.
  session.isAdmin = allowed;
  if (!allowed) {
    return res.status(403).json({
      error: 'Sicherungsfunktionen dürfen ausschließlich aktive Online-Administratoren verwenden.'
    });
  }
  next();
}
router.use(requireLiveBackupAdmin);
// Echtzeit: erfolgreiche Schreiboperationen an alle Fenster melden (Muster office-events).
router.use(officeEvents.middleware('documents'));
// Aktivitaetenprotokoll (D10): erfolgreiche Schreiboperationen des Moduls festhalten -
// bewusst als Middleware statt an jeder Route (vollstaendig, ein Wartungsort).
let actStmt = null;
function actLog(userId, username, aktion, ziel, detail, area, caseId) {
  try {
    if (!actStmt) actStmt = db.prepare('INSERT INTO doc_activity (user_id, username, aktion, ziel, detail, area, case_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    actStmt.run(userId || null, String(username || ''), String(aktion || '').slice(0, 60), String(ziel || '').slice(0, 200), String(detail || '').slice(0, 300), String(area || ''), String(caseId || ''));
  } catch (_e) { /* Protokoll darf nie den Betrieb stoeren */ }
}
/* D11: Rechte je Fallakte - ohne docsAllCases sieht/bearbeitet man nur Faelle, bei denen
   man in den Stammdaten als rechtlicher Betreuer steht (Namensabgleich, 60s-Cache).
   Bueroorganisation bleibt fuer alle mit Dokumente-Recht sichtbar. */
let eigeneCache = { bis: 0, map: new Map() };
function betreuerVon(sd) {
  try {
    const b = (JSON.parse(sd || '{}') || {}).rechtlicherBetreuer;
    if (typeof b === 'string') return b;
    if (b && typeof b === 'object') return String(b.name || b.label || '');
  } catch (_e) { /* wie leer */ }
  return '';
}
/* 2026-07-26 ersetzt: Bis hierher wurde der Anzeigename per TEILSTRING gegen das Freitextfeld
   "rechtlicherBetreuer" verglichen - das traf zu viel ("Anna Berg" erbte die Faelle von "Anna
   Bergmann") und zugleich zu wenig (kein Treffer bei abweichender Schreibweise), und ein
   60-Sekunden-Cache liess entzogene Rechte nachwirken. Jetzt entscheidet die echte Zuordnung
   (cases.owner_user_id + case_access), zentral in fall-sicht.js.
   docsAllCases bleibt als zusaetzlicher Modulschalter erhalten: wer das Recht hat, sieht im
   Dokumentenmodul weiterhin alle Fallakten. */
function erlaubteFaelle(session) {
  if (!session || session.isAdmin || session.canDocsAllCases !== false) return null;   /* null = alle */
  return sichtbareFaelle(session);
}
function fallErlaubt(session, caseId) {
  const e = erlaubteFaelle(session);
  return !e || e.has(String(caseId || ''));
}
function dateiSichtbar(session, row) {
  if (!row) return false;
  if ((row.area === 'management' || row.visibility === 'admin') && !(session && session.isAdmin)) return false;
  return row.area !== 'case' || fallErlaubt(session, row.case_id);
}
router.use((req, res, next) => {
  const e = erlaubteFaelle(req.session);
  const caseId = String(req.query.caseId || (req.body && req.body.caseId) || '');
  const requestedArea = String(req.query.area || (req.body && req.body.area) || '');
  if (requestedArea === 'management' && !req.session.isAdmin) {
    return res.status(403).json({ error: 'Die geschützte Verwaltung ist nur für Administratoren sichtbar.' });
  }
  if (caseId && e && !e.has(caseId)) return res.status(403).json({ error: 'Keine Berechtigung für diese Fallakte (Recht „alle Fallakten" fehlt - nur eigene Fälle).' });
  const m = /^\/files\/([^/]+)/.exec(req.path);
  if (m && m[1] !== 'zip') {
    const row = fileGetStmt.get(String(m[1]));
    if (row && (row.area === 'management' || row.visibility === 'admin') && !req.session.isAdmin) {
      return res.status(403).json({ error: 'Diese Datei ist nur für Administratoren sichtbar.' });
    }
    if (row && row.area === 'case' && e && !e.has(String(row.case_id || ''))) return res.status(403).json({ error: 'Keine Berechtigung für diese Fallakte (nur eigene Fälle).' });
  }
  next();
});
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const p = req.path;
    const b = req.body || {};
    const area = String(req.query.area || b.area || '');
    const caseId = String(req.query.caseId || b.caseId || '');
    const wer = [req.session && req.session.userId, (req.session && (req.session.displayName || req.session.username)) || ''];
    let m;
    const nameVon = (id) => { try { const r = fileGetStmt.get(String(id)); return r ? r.name : ''; } catch (_e) { return ''; } };
    if (p === '/files' && req.method === 'POST') return actLog(wer[0], wer[1], 'Datei hochgeladen', b.fileName, '', area, caseId);
    if ((m = /^\/files\/([^/]+)\/purge$/.exec(p)) && req.method === 'DELETE') return actLog(wer[0], wer[1], 'Datei endgültig gelöscht', nameVon(m[1]) || m[1].slice(0, 8), '', area, caseId);
    if ((m = /^\/files\/([^/]+)\/restore$/.exec(p))) return actLog(wer[0], wer[1], 'Datei wiederhergestellt', nameVon(m[1]), '', area, caseId);
    if ((m = /^\/files\/([^/]+)\/copy$/.exec(p))) return actLog(wer[0], wer[1], 'Datei kopiert', nameVon(m[1]), '', area, caseId);
    if ((m = /^\/files\/([^/]+)\/tags$/.exec(p))) return actLog(wer[0], wer[1], 'Markierung geändert', nameVon(m[1]), '', area, caseId);
    if ((m = /^\/files\/([^/]+)\/note$/.exec(p))) return actLog(wer[0], wer[1], 'Notiz geändert', nameVon(m[1]), '', area, caseId);
    if ((m = /^\/files\/([^/]+)\/wiedervorlage$/.exec(p))) return actLog(wer[0], wer[1], 'Wiedervorlage geändert', nameVon(m[1]), '', area, caseId);
    if ((m = /^\/files\/([^/]+)\/zum-posteingang$/.exec(p))) return actLog(wer[0], wer[1], 'In den Posteingang kopiert', nameVon(m[1]), '', area, caseId);
    if ((m = /^\/files\/([^/]+)\/ersetzen$/.exec(p))) return actLog(wer[0], wer[1], 'Datei ersetzt (neue Version)', nameVon(m[1]), '', area, caseId);
    if ((m = /^\/files\/([^/]+)\/versionen\/[^/]+\/restore$/.exec(p))) return actLog(wer[0], wer[1], 'Version wiederhergestellt', nameVon(m[1]), '', area, caseId);
    if ((m = /^\/files\/([^/]+)$/.exec(p)) && req.method === 'DELETE') return actLog(wer[0], wer[1], 'Datei in den Papierkorb', nameVon(m[1]), '', area, caseId);
    if ((m = /^\/files\/([^/]+)$/.exec(p)) && req.method === 'PATCH') return actLog(wer[0], wer[1], 'Datei umbenannt/verschoben', b.name || nameVon(m[1]), '', area, caseId);
    if (p === '/folders' && req.method === 'POST') return actLog(wer[0], wer[1], 'Ordner angelegt', b.name, '', area, caseId);
    if (p === '/folders/bulk') return actLog(wer[0], wer[1], 'Ordnerstruktur angelegt', (Array.isArray(b.paths) ? b.paths.length : 0) + ' Pfade', '', area, caseId);
    if ((m = /^\/folders\/([^/]+)$/.exec(p)) && req.method === 'DELETE') return actLog(wer[0], wer[1], 'Ordner gelöscht', '', '', area, caseId);
    if ((m = /^\/mounts\/([^/]+)\/upload$/.exec(p))) return actLog(wer[0], wer[1], 'Auf Verbindung hochgeladen', b.fileName, '', '', '');
  });
  next();
});

const driveMounts = require('../../integrations/storage/drive-mounts');   /* OneDrive/Google Drive (eigener OAuth, D9) */
const DOCUMENT_DATA_ROOT = DEFAULT_DATA_ROOT;
const LEGACY_FILES_DIR = path.join(DOCUMENT_DATA_ROOT, 'files');
const DEFAULT_DIR = path.join(DOCUMENT_DATA_ROOT, 'Dokumentenspeicher');
const STORAGE_ROOT_MARKER = '.ablage-speicherkennung.json';
fs.mkdirSync(DEFAULT_DIR, { recursive: true });

// FTS5-Faehigkeit einmalig feststellen (Schema legt bei fehlendem FTS5 eine LIKE-Tabelle an).
let HAS_FTS = true;
try { db.prepare("SELECT 1 FROM doc_text WHERE doc_text MATCH '\"__nie__\"'").all(); }
catch (_e) { HAS_FTS = false; }

/* Obergrenze je Datei - EINE Zahl fuer den gesamten Dokumentenspeicher (Nutzerentscheid
   2026-07-27: 1024 MB). Sie gilt ab jetzt an ALLEN Schreibwegen, auch an dateiAblegen, das bis
   dahin gar nichts geprueft hat (darueber kam die 143-MB-Videodatei in den Bestand) und an
   webdav.js sowie den Zubringern in doc-backup.js, die frueher eigene 100-MB-Konstanten fuehrten.
   ACHTUNG zum ALTEN Weg (POST /files mit dataBase64): der wird vom JSON-Koerperdeckel
   express.json({limit:'350mb'}) in index.js begrenzt und schafft rechnerisch nur ~262 MB. Dieser
   Deckel bleibt bewusst stehen - ihn anzuheben hiesse, die gemessene Speicherspitze (250 MB Datei
   -> +1364 MB RSS) noch weiter zu vergroessern. Alles Grosse laeuft ueber den Strom-Upload
   (server/documents-stream.js). MAX_JSON_FILE nennt die Grenze des alten Wegs beim Namen, damit
   die Fehlermeldung dort ehrlich ist. */
const MAX_FILE = 1024 * 1024 * 1024;        // 1024 MB je Datei (Strom-Upload)
const MAX_JSON_FILE = 250 * 1024 * 1024;    // was der Base64-in-JSON-Weg real noch durchlaesst
function groessenText(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024 * 1024) return (v / (1024 * 1024 * 1024)).toFixed(2).replace('.', ',') + ' GB';
  if (v >= 1024 * 1024) return (v / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
  if (v >= 1024) return (v / 1024).toFixed(1).replace('.', ',') + ' KB';
  return v + ' Bytes';
}
/* Einheitliche, auskunftsfreudige Meldung: WIE GROSS ist die Datei und WIE GROSS darf sie sein. */
function zuGrossText(ist, max, zusatz) {
  return `Die Datei ist ${groessenText(ist)} groß, erlaubt sind höchstens ${groessenText(max)}.` + (zusatz ? ' ' + zusatz : '');
}
const STROM_HINWEIS = 'Über den Strom-Upload (Explorer „Hochladen") sind bis 1024 MB möglich.';
function trashTage() {                      // Papierkorb- UND Versions-Aufbewahrung (D11: konfigurierbar)
  const n = Number(readCfg().trashDays);
  return (n >= 1 && n <= 3650) ? Math.floor(n) : 30;
}
const AREAS = new Set(['case', 'office', 'management']);

/* ----------------------------- Konfiguration ----------------------------- */
// documents_config liegt im office_json-Store (direkter Tabellenzugriff; die generische
// /api/office-json-Route samt Whitelist bleibt unberuehrt).
const cfgGet = db.prepare("SELECT data_json FROM office_json WHERE key = 'documents_config'");
const cfgPut = db.prepare(`INSERT INTO office_json (key, data_json, updated_by) VALUES ('documents_config', @dataJson, @userId)
  ON CONFLICT(key) DO UPDATE SET data_json = @dataJson, updated_at = datetime('now'), updated_by = @userId`);

/* Modulordner-Import (D17): welche Modul-Quellen fortlaufend als echte Kopien in den
   Dokumentenspeicher uebernommen werden. Finanz-Quellen sind ab Werk AUS, weil die Kopien
   im Buero-Bereich nur noch unter den Dokumente-Rechten stehen (nicht mehr unter dem
   Finanz-Sichtrecht) - Zuschalten ist eine bewusste Entscheidung im Einstellungsmenue. */
function normModulSync(roh) {
  const m = (roh && typeof roh === 'object') ? roh : {};
  const q = (m.quellen && typeof m.quellen === 'object') ? m.quellen : {};
  const vorgabe = { dokuanlagen: true, passfoto: true, posteingang: true, intakes: true, belege: false, auszuege: false };
  const quellen = {};
  for (const k of Object.keys(vorgabe)) quellen[k] = (q[k] === undefined) ? vorgabe[k] : !!q[k];
  return { an: (m.an === undefined) ? true : !!m.an, quellen, status: String(m.status || '').slice(0, 300) };
}
function readCfg() {
  try {
    const row = cfgGet.get();
    const cfg = row ? JSON.parse(row.data_json || '{}') : {};
    const neuesLayout = cfg.storageLayout === 'real-folders-v1' || cfg.storageRoot !== undefined;
    return {
      storageRoot: String(cfg.storageRoot || ''),
      // Vor dem Umbau bezeichnete baseDir einen UUID-Blobort. Ohne Layoutmarker darf er
      // daher niemals still zur neuen Baumwurzel werden.
      legacyBaseDir: String(cfg.legacyBaseDir || (!neuesLayout ? cfg.baseDir : '') || ''),
      caseDirs: (cfg.caseDirs && typeof cfg.caseDirs === 'object') ? cfg.caseDirs : {},
      autoOcr: !!cfg.autoOcr, tags: Array.isArray(cfg.tags) ? cfg.tags : [],
      trashDays: Number(cfg.trashDays) || 30,
      scanEingang: (cfg.scanEingang && typeof cfg.scanEingang === 'object') ? cfg.scanEingang : { an: false, ordner: '', ziel: { art: 'inbox' }, status: '' }
    };
  } catch (_e) {
    return {
      storageRoot: '', legacyBaseDir: '', caseDirs: {}, autoOcr: false, tags: [],
      trashDays: 30, scanEingang: { an: false, ordner: '', ziel: { art: 'inbox' }, status: '' }
    };
  }
}

const documentStorage = createDocumentStorage({ db, dataRoot: DOCUMENT_DATA_ROOT, readConfig: readCfg });

function storageRootSicherPruefen(roh, bisherigeWurzel) {
  const abs = path.resolve(String(roh || ''));
  const root = path.parse(abs).root;
  const home = path.resolve(os.homedir());
  if (abs === root || abs === home || backupPfadUnter(home, abs)) {
    throw new Error('Als Dokumentenspeicher ist nur ein eigener Unterordner zulässig, niemals ein Laufwerks-, Benutzer- oder übergeordneter Ordner.');
  }
  const istStandard = abs === path.resolve(DEFAULT_DIR);
  if (!istStandard) {
    const intern = [
      SERVER_ROOT,
      PROJECT_ROOT,
      OUTPUTS_ROOT,
      DOCUMENT_DATA_ROOT
    ];
    if (intern.some((verboten) => backupPfadeUeberlappen(abs, verboten))) {
      throw new Error('Der Dokumentenspeicher muss außerhalb von Anwendung, Ausgabedateien und internen Serverdaten liegen.');
    }
  }
  const marker = path.join(abs, STORAGE_ROOT_MARKER);
  const bekannt = abs === path.resolve(String(bisherigeWurzel || DEFAULT_DIR));
  if (fs.existsSync(marker)) {
    const stat = fs.lstatSync(marker);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Die Kennung des Dokumentenspeichers ist keine reguläre Datei.');
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(marker, 'utf8')); }
    catch (_e) { throw new Error('Die Kennung des Dokumentenspeichers ist beschädigt.'); }
    if (!parsed || parsed.format !== 'Betreuungsbuero-Dokumentenspeicher/1'
        || !/^[0-9a-f-]{36}$/i.test(String(parsed.id || ''))) {
      throw new Error('Die Kennung des Dokumentenspeichers ist ungültig.');
    }
    return abs;
  }
  const inhalt = fs.readdirSync(abs).filter((name) => name !== '.DS_Store');
  if (inhalt.length && !bekannt && !istStandard) {
    throw new Error('Ein neuer Dokumentenspeicher muss leer sein oder bereits die gültige Betreuungsbüro-Kennung enthalten.');
  }
  const payload = {
    format: 'Betreuungsbuero-Dokumentenspeicher/1',
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(marker, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return abs;
}

function documentReconciler() {
  const cfg = readCfg();
  const legacyRoots = [
    LEGACY_FILES_DIR,
    ...(cfg.legacyBaseDir ? [cfg.legacyBaseDir] : []),
    ...Object.values(cfg.caseDirs || {})
  ];
  return createDocumentReconciler({
    db,
    storageRoot: documentStorage.root(),
    legacyRoots,
    resolver: {
      resolve(row) {
        if (row.storage_relpath) return { storageRelpath: row.storage_relpath };
        const legacy = documentStorage.findBlobPath(row);
        return legacy ? { filePath: legacy } : null;
      },
      sidecarPath(filePath, fileId) {
        return documentStorage.sidecarPath(filePath, fileId);
      }
    }
  });
}

function documentFinderSync() {
  return createDocumentFinderSync({
    db,
    documentStorage,
    writeSidecars: true
  });
}

function finderScanForResponse(scan) {
  return {
    root: scan.root,
    scannedAt: scan.scannedAt,
    summary: scan.summary,
    findings: scan.findings
  };
}

function appendFinderJournal(indexed, finderScan, finderApply) {
  const applyErrors = finderApply
    ? finderApply.errors.map((error) => ({
      kind: 'apply_error',
      severity: 'error',
      storageRelpath: error.path || '',
      detail: error
    }))
    : [];
  const findings = [...finderScan.findings, ...applyErrors];
  const finderSummary = {
    ...finderScan.summary,
    apply: finderApply || null,
    errorCount: findings.filter((item) => item.severity === 'error').length
  };
  const summary = { ...indexed.summary, finder: finderSummary };
  const maxSeq = db.prepare(
    'SELECT COALESCE(MAX(seq),0) AS seq FROM doc_integrity_findings WHERE run_id=?'
  );
  const insert = db.prepare(`
    INSERT INTO doc_integrity_findings
      (run_id,seq,kind,file_id,storage_relpath,detail_json)
    VALUES (?,?,?,?,?,?)
  `);
  const update = db.prepare('UPDATE doc_integrity_runs SET summary_json=? WHERE id=?');
  const write = () => {
    let seq = Number(maxSeq.get(indexed.runId).seq) || 0;
    for (const item of findings) {
      insert.run(
        indexed.runId,
        ++seq,
        `finder_${item.kind}`,
        String((item.detail && item.detail.fileId) || ''),
        String(item.storageRelpath || ''),
        JSON.stringify({ severity: item.severity || 'warning', ...(item.detail || {}) })
      );
    }
    update.run(JSON.stringify(summary), indexed.runId);
  };
  db.transaction(write)();
  return {
    ...indexed,
    ok: finderSummary.errorCount === 0 && (!finderApply || finderApply.ok),
    summary,
    finder: {
      scan: finderScanForResponse(finderScan),
      apply: finderApply || null
    }
  };
}

async function runQuickIntegrity(mode) {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO doc_integrity_runs (id,mode,started_at,status,summary_json)
    VALUES (?,?,?,'running','{}')
  `).run(runId, mode === 'apply' ? 'quick-apply' : 'quick-read', startedAt);
  try {
    const finder = documentFinderSync();
    const finderScan = finder.scan();
    const finderApply = mode === 'apply' ? finder.apply(finderScan) : null;
    const findings = finderScan.findings || [];
    const insert = db.prepare(`
      INSERT INTO doc_integrity_findings
        (run_id,seq,kind,file_id,storage_relpath,detail_json)
      VALUES (?,?,?,?,?,?)
    `);
    db.transaction(() => {
      findings.forEach((item, index) => insert.run(
        runId,
        index + 1,
        `finder_${item.kind}`,
        String((item.detail && item.detail.fileId) || ''),
        String(item.storageRelpath || ''),
        JSON.stringify({ severity: item.severity || 'warning', ...(item.detail || {}) })
      ));
    })();
    const summary = {
      verification: 'quick',
      finder: { ...finderScan.summary, apply: finderApply || null },
      errorCount: findings.filter((item) => item.severity === 'error').length
    };
    db.prepare(`
      UPDATE doc_integrity_runs
         SET finished_at=?,status='done',summary_json=?
       WHERE id=?
    `).run(new Date().toISOString(), JSON.stringify(summary), runId);
    return {
      ok: summary.errorCount === 0 && (!finderApply || finderApply.ok),
      runId,
      mode,
      verification: 'quick',
      summary,
      finder: { scan: finderScanForResponse(finderScan), apply: finderApply }
    };
  } catch (error) {
    db.prepare(`
      UPDATE doc_integrity_runs
         SET finished_at=?,status='error',summary_json=?
       WHERE id=?
    `).run(new Date().toISOString(), JSON.stringify({ error: error.message || String(error) }), runId);
    throw error;
  }
}

async function runDocumentIntegrity(mode, verification) {
  if (verification === 'quick') return runQuickIntegrity(mode);
  const finder = documentFinderSync();
  const finderScan = finder.scan();
  const finderApply = mode === 'apply' ? finder.apply(finderScan) : null;
  const indexed = mode === 'apply'
    ? await documentReconciler().apply()
    : await documentReconciler().scan();
  return appendFinderJournal(indexed, finderScan, finderApply);
}

// Zielverzeichnis fuer neue Klarname-Dateien. folderId ist optional fuer alte interne
// Aufrufer; neue Schreibwege uebergeben es immer.
function blobDirFor(area, caseId, folderId) {
  const relative = documentStorage.folderRelpath(area, String(caseId || ''), String(folderId || ''), true);
  return joinRoot(documentStorage.root(), relative);
}

// Neue Klarname-Pfade, UUID-Blobs ohne Endung sowie der Zwischenstand mit Endung werden
// gemeinsam gefunden. Symbolische Links gelten nie als Dateiinhalt.
function findBlobPath(file) { return documentStorage.findBlobPath(file); }

/* ------------------------------- Statements ------------------------------- */
const folderAllStmt = db.prepare('SELECT * FROM doc_folders WHERE area = ? AND case_id = ? ORDER BY sort_order, name COLLATE NOCASE');
const folderGetStmt = db.prepare('SELECT * FROM doc_folders WHERE id = ?');
const folderInsStmt = db.prepare(`INSERT INTO doc_folders (id, area, case_id, parent_id, name, created_by)
  VALUES (@id, @area, @caseId, @parentId, @name, @createdBy)`);
const folderRenStmt = db.prepare("UPDATE doc_folders SET name = @name WHERE id = @id");
const folderMoveStmt = db.prepare("UPDATE doc_folders SET parent_id = @parentId WHERE id = @id");
const folderDelStmt = db.prepare('DELETE FROM doc_folders WHERE id = ?');
const folderPathStmt = db.prepare("UPDATE doc_folders SET name_key=@nameKey, storage_relpath=@storageRelpath, updated_at=datetime('now') WHERE id=@id");

const fileListStmt = db.prepare("SELECT * FROM doc_files WHERE area = ? AND case_id = ? AND folder_id = ? AND deleted_at = '' ORDER BY name COLLATE NOCASE");
const fileScopeStmt = db.prepare("SELECT * FROM doc_files WHERE area = ? AND case_id = ? AND deleted_at = ''");
const trashListStmt = db.prepare("SELECT * FROM doc_files WHERE area = ? AND case_id = ? AND deleted_at != '' ORDER BY deleted_at DESC");
const fileGetStmt = db.prepare('SELECT * FROM doc_files WHERE id = ?');
const fileInsStmt = db.prepare(`INSERT INTO doc_files (id, area, case_id, folder_id, name, mime_type, size, pages, sha256, ocr_status, created_by)
  VALUES (@id, @area, @caseId, @folderId, @name, @mimeType, @size, @pages, @sha256, @ocrStatus, @createdBy)`);
const fileUpdStmt = db.prepare(`UPDATE doc_files SET name=@name, folder_id=@folderId, pages=@pages, ocr_status=@ocrStatus, updated_at=datetime('now') WHERE id=@id`);
const fileTrashStmt = db.prepare(`UPDATE doc_files SET deleted_at=datetime('now'), deleted_from=folder_id, folder_id='', deleted_by=@userId, updated_at=datetime('now') WHERE id=@id`);
const fileRestoreStmt = db.prepare(`UPDATE doc_files SET deleted_at='', folder_id=@folderId, deleted_from='', deleted_by=NULL, updated_at=datetime('now') WHERE id=@id`);
const filePurgeStmt = db.prepare('DELETE FROM doc_files WHERE id = ?');
const fileLinksPurgeStmt = db.prepare('DELETE FROM doc_links WHERE file_id = ?');
const trashOldStmt = db.prepare("SELECT * FROM doc_files WHERE deleted_at != '' AND deleted_at < datetime('now', ?)");
const nameTakenStmt = db.prepare("SELECT 1 FROM doc_files WHERE area=? AND case_id=? AND folder_id=? AND deleted_at='' AND name_key=? AND id!=?");
const fileStorageStmt = db.prepare(`
  UPDATE doc_files SET
    name=@name, name_key=@nameKey, folder_id=@folderId, storage_relpath=@storageRelpath,
    storage_dev=@storageDev, storage_ino=@storageIno, storage_status='ok',
    last_seen_at=datetime('now'), updated_at=datetime('now')
  WHERE id=@id
`);

const textDelStmt = db.prepare('DELETE FROM doc_text WHERE file_id = ?');
const textInsStmt = db.prepare('INSERT INTO doc_text (file_id, page, text) VALUES (?, ?, ?)');
const textForFileStmt = db.prepare('SELECT page, text FROM doc_text WHERE file_id = ? ORDER BY page');

const annListStmt = db.prepare('SELECT * FROM doc_annotations WHERE file_id = ? ORDER BY page, created_at');
const annGetStmt = db.prepare('SELECT * FROM doc_annotations WHERE id = ?');
const annInsStmt = db.prepare(`INSERT INTO doc_annotations (id, file_id, page, art, text, geo_json, author, created_by)
  VALUES (@id, @fileId, @page, @art, @text, @geoJson, @author, @createdBy)`);
const annUpdStmt = db.prepare(`UPDATE doc_annotations SET page=@page, art=@art, text=@text, geo_json=@geoJson, updated_at=datetime('now') WHERE id=@id`);
const annDelStmt = db.prepare('DELETE FROM doc_annotations WHERE id = ?');
const annDelForFileStmt = db.prepare('DELETE FROM doc_annotations WHERE file_id = ?');
const annCountStmt = db.prepare('SELECT file_id, COUNT(*) AS n FROM doc_annotations GROUP BY file_id');

const caseExistsStmt = db.prepare('SELECT 1 FROM cases WHERE id = ?');
const caseLabelStmt = db.prepare('SELECT label FROM cases WHERE id = ?');
const handoverCaseStmt = db.prepare('SELECT * FROM cases WHERE id = ?');
const handoverReportsStmt = db.prepare('SELECT * FROM case_reports WHERE case_id = ? ORDER BY report_id');
const handoverDokuStmt = db.prepare('SELECT * FROM case_doku_entries WHERE case_id = ? ORDER BY created_at, id');
const handoverContactsStmt = db.prepare('SELECT * FROM case_contacts WHERE case_id = ? ORDER BY created_at, id');
const documentFollowupStmt = db.prepare(`
  SELECT * FROM todos
   WHERE item_type = 'followup' AND source_type = 'document' AND source_id = ?
   ORDER BY done, created_at LIMIT 1
`);
const documentFollowupAllStmt = db.prepare(`
  SELECT id FROM todos
   WHERE item_type = 'followup' AND source_type = 'document' AND source_id = ?
`);
const documentFollowupInsertStmt = db.prepare(`
  INSERT INTO todos
    (id, title, description, due_at, start_at, done, priority, recurrence_rule, case_label,
     item_type, case_id, source_type, source_id, source_module, source_ref, source, updated_by)
  VALUES
    (@id, @title, @description, @dueAt, '', 0, 'normal', '', @caseLabel,
     'followup', @caseId, 'document', @sourceId, 'documents', @sourceRef, 'local', @userId)
`);
const documentFollowupUpdateStmt = db.prepare(`
  UPDATE todos
     SET title=@title, description=@description, due_at=@dueAt, done=0, priority='normal',
         case_label=@caseLabel, item_type='followup', case_id=@caseId,
         source_type='document', source_id=@sourceId, source_module='documents', source_ref=@sourceRef,
         updated_at=datetime('now'), updated_by=@userId
   WHERE id=@id
`);
const documentFollowupRenameStmt = db.prepare(`
  UPDATE todos SET title = ?, updated_at = datetime('now')
   WHERE item_type = 'followup' AND source_type = 'document' AND source_id = ?
`);
const documentFollowupDeleteStmt = db.prepare(`
  DELETE FROM todos
   WHERE item_type = 'followup' AND source_type = 'document' AND source_id = ?
`);
const documentFollowupAttachmentsDeleteStmt = db.prepare('DELETE FROM todo_attachments WHERE todo_id = ?');

/* -------------------------------- Helfer --------------------------------- */
function cleanName(v) {
  const original = String(v == null ? '' : v).trim();
  if (!original) return null;
  return documentNames.normalisiereDateiname(original).name || null;
}

function scopeFromReq(req, res) {
  const area = String(req.query.area || req.body?.area || 'case');
  const caseId = String(req.query.caseId || req.body?.caseId || '');
  if (!AREAS.has(area)) { res.status(400).json({ error: 'Unbekannter Bereich.' }); return null; }
  if (area === 'case') {
    if (!caseId) { res.status(400).json({ error: 'caseId erforderlich.' }); return null; }
    if (!caseExistsStmt.get(caseId)) { res.status(404).json({ error: 'Fall nicht gefunden.' }); return null; }
    if (!fallErlaubt(req.session, caseId)) { res.status(403).json({ error: 'Keine Berechtigung für diese Fallakte (nur eigene Fälle).' }); return null; }
    return { area, caseId };
  }
  if (area === 'management' && !req.session.isAdmin) {
    res.status(403).json({ error: 'Die geschützte Verwaltung ist nur für Administratoren sichtbar.' });
    return null;
  }
  return { area, caseId: '' };
}

function fremderFall(req, res, row) {
  if (row && (row.area === 'management' || row.visibility === 'admin') && !req.session.isAdmin) {
    res.status(403).json({ error: 'Diese Datei ist nur für Administratoren sichtbar.' });
    return true;
  }
  if (!row || row.area !== 'case' || fallErlaubt(req.session, row.case_id)) return false;
  res.status(403).json({ error: 'Keine Berechtigung für diese Fallakte (nur eigene Fälle).' });
  return true;
}

function exakterRegistername(name) {
  const value = String(name || '').normalize('NFC');
  const hit = documentTaxonomy.REGISTER.find((register) => register.name === value);
  return hit ? hit.name : '';
}

// Eindeutigen Namen im Zielordner erzeugen: "Name (2).pdf" wie im Betriebssystem-Explorer.
function uniqueName(area, caseId, folderId, wunsch, selfId) {
  let name = cleanName(wunsch) || 'Unbenannt';
  if (!nameTakenStmt.get(area, caseId, folderId, documentNames.vergleichsschluessel(name), selfId || '')) return name;
  const m = name.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
  const stamm = (m && m[1]) || name, ext = (m && m[2]) || '';
  for (let i = 2; i < 1000; i++) {
    name = cleanName(`${stamm} (${i})${ext}`) || `Unbenannt (${i})`;
    if (!nameTakenStmt.get(area, caseId, folderId, documentNames.vergleichsschluessel(name), selfId || '')) return name;
  }
  return cleanName(`${stamm} (${crypto.randomUUID().slice(0, 8)})${ext}`) || ('Unbenannt-' + crypto.randomUUID().slice(0, 8));
}

function publicFolder(r) {
  return { id: r.id, area: r.area, caseId: r.case_id, parentId: r.parent_id, name: r.name, sortOrder: r.sort_order, createdAt: r.created_at };
}
function publicFile(r, annCounts) {
  return {
    id: r.id, area: r.area, caseId: r.case_id, folderId: r.folder_id, name: r.name,
    mimeType: r.mime_type, size: r.size, pages: r.pages, sha256: r.sha256,
    ocrStatus: r.ocr_status, tags: String(r.tags || ''), note: String(r.note || ''), resubmitAt: String(r.resubmit_at || ''), resubmitNote: String(r.resubmit_note || ''), deletedAt: r.deleted_at, deletedFrom: r.deleted_from,
    createdAt: r.created_at, updatedAt: r.updated_at,
    visibility: String(r.visibility || 'standard'), artifactKind: String(r.artifact_kind || ''),
    managed: !!r.managed,
    annotations: annCounts ? (annCounts[r.id] || 0) : undefined
  };
}
function annCountsMap() {
  const map = {};
  for (const row of annCountStmt.all()) map[row.file_id] = row.n;
  return map;
}

function syncFolderPath(row) {
  if (!row) throw new Error('Ordner nicht gefunden.');
  const relative = documentStorage.folderRelpath(row.area, row.case_id, row.id, true);
  folderPathStmt.run({
    id: row.id,
    nameKey: documentNames.vergleichsschluessel(row.name),
    storageRelpath: relative
  });
  return relative;
}

function moveFolderPhysical(row, parentId, wantedName) {
  if (!row) throw new Error('Ordner nicht gefunden.');
  const nextName = cleanName(wantedName || row.name);
  if (!nextName) throw new Error('Ungültiger Ordnername.');
  const nextParent = String(parentId || '');
  const siblings = folderAllStmt.all(row.area, row.case_id);
  if (siblings.some((folder) => folder.id !== row.id && folder.parent_id === nextParent
    && documentNames.dateinamenGleich(folder.name, nextName))) {
    throw new Error('Ein gleichnamiger Ordner existiert am Ziel.');
  }
  const oldRelative = documentStorage.folderRelpath(row.area, row.case_id, row.id, false);
  folderRenStmt.run({ id: row.id, name: nextName });
  folderMoveStmt.run({ id: row.id, parentId: nextParent });
  let newRelative;
  let oldPath;
  let newPath;
  try {
    newRelative = documentStorage.folderRelpath(row.area, row.case_id, row.id, false);
    oldPath = joinRoot(documentStorage.root(), oldRelative);
    newPath = joinRoot(documentStorage.root(), newRelative);
    if (path.resolve(oldPath) !== path.resolve(newPath) && fs.existsSync(oldPath)) {
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      if (fs.existsSync(newPath)) throw new Error('Zielordner existiert auf der Platte.');
      fs.renameSync(oldPath, newPath);
    } else {
      fs.mkdirSync(newPath, { recursive: true });
    }
    const folders = folderAllStmt.all(row.area, row.case_id);
    const files = db.prepare('SELECT * FROM doc_files WHERE area=? AND case_id=?').all(row.area, row.case_id);
    const setFolderPath = db.prepare("UPDATE doc_folders SET name_key=?, storage_relpath=?, updated_at=datetime('now') WHERE id=?");
    const setFilePath = db.prepare("UPDATE doc_files SET storage_relpath=?, updated_at=datetime('now') WHERE id=?");
    db.transaction(() => {
      for (const folder of folders) {
        const rel = String(folder.storage_relpath || '');
        if (folder.id === row.id) setFolderPath.run(documentNames.vergleichsschluessel(nextName), newRelative, folder.id);
        else if (rel === oldRelative || rel.startsWith(oldRelative + '/')) {
          setFolderPath.run(documentNames.vergleichsschluessel(folder.name), newRelative + rel.slice(oldRelative.length), folder.id);
        }
      }
      for (const file of files) {
        const rel = String(file.storage_relpath || '');
        if (rel === oldRelative || rel.startsWith(oldRelative + '/')) {
          setFilePath.run(newRelative + rel.slice(oldRelative.length), file.id);
        }
      }
    })();
    for (const file of files) {
      const fresh = fileGetStmt.get(file.id);
      const filePath = fresh && findBlobPath(fresh);
      if (filePath && fresh.storage_relpath) {
        try { documentStorage.writeSidecar(fresh, filePath); } catch (_error) { /* Integritaetslauf */ }
      }
    }
    return { name: nextName, storageRelpath: newRelative };
  } catch (error) {
    if (oldPath && newPath && fs.existsSync(newPath) && !fs.existsSync(oldPath)) {
      try { fs.renameSync(newPath, oldPath); } catch (_rollbackError) { /* Integritaetslauf */ }
    }
    folderRenStmt.run({ id: row.id, name: row.name });
    folderMoveStmt.run({ id: row.id, parentId: row.parent_id });
    throw error;
  }
}

function removeDocumentFollowups(fileId) {
  const linkedRows = documentFollowupAllStmt.all(fileId);
  for (const todo of linkedRows) documentFollowupAttachmentsDeleteStmt.run(todo.id);
  documentFollowupDeleteStmt.run(fileId);
  db.prepare("UPDATE doc_files SET resubmit_at='', resubmit_note='' WHERE id=?").run(fileId);
  for (const todo of linkedRows) {
    try { fs.rmSync(path.join(DOCUMENT_DATA_ROOT, 'todo-attachments', todo.id), { recursive: true, force: true }); } catch (_e) { /* best effort */ }
  }
  if (linkedRows.length) officeEvents.emit('todos', { method: 'DELETE', sourceType: 'document', sourceId: fileId });
}

// Alle Nachfahren-Ordner-Ids (fuer rekursive Suche/Loeschung); enthaelt die Wurzel selbst.
function descendantFolderIds(area, caseId, rootId) {
  const alle = folderAllStmt.all(area, caseId);
  const kinder = {};
  for (const f of alle) (kinder[f.parent_id] = kinder[f.parent_id] || []).push(f);
  const ids = [rootId];
  const stapel = [rootId];
  while (stapel.length) {
    const p = stapel.pop();
    for (const k of (kinder[p] || [])) { ids.push(k.id); stapel.push(k.id); }
  }
  return ids;
}

function unlinkBlobQuiet(file) {
  try { documentStorage.removeFileAndSidecar(file); } catch (_e) { /* Purge darf nie an einem fehlenden Blob scheitern */ }
}

function moveFileToTrash(file, userId) {
  const moved = documentStorage.moveToManagement(file, 'Papierkorb', file.id, file.name);
  db.transaction(() => {
    fileTrashStmt.run({ id: file.id, userId });
    fileStorageStmt.run({
      id: file.id, name: moved.name, nameKey: documentNames.vergleichsschluessel(moved.name), folderId: '',
      storageRelpath: moved.storageRelpath, storageDev: moved.storageDev, storageIno: moved.storageIno
    });
    db.prepare("UPDATE doc_files SET storage_status='trash' WHERE id=?").run(file.id);
  })();
  return moved;
}

// Papierkorb-Auslauf: opportunistisch beim Baum-Laden (kein eigener Timer noetig) - Eintraege
// aelter als 30 Tage endgueltig entfernen (Blob + Text-Index + Anmerkungen).
function purgeExpiredTrash() {
  for (const f of trashOldStmt.all(`-${trashTage()} days`)) {
    removeDocumentFollowups(f.id);
    unlinkBlobQuiet(f);
    textDelStmt.run(f.id);
    annDelForFileStmt.run(f.id);
    fileLinksPurgeStmt.run(f.id);
    filePurgeStmt.run(f.id);
  }
}

/* ------------------------------ Baum & Liste ------------------------------ */
router.get('/tree', requireViewDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  purgeExpiredTrash();
  const folders = folderAllStmt.all(scope.area, scope.caseId).map(publicFolder);
  const zaehler = {};
  for (const f of fileScopeStmt.all(scope.area, scope.caseId)) zaehler[f.folder_id] = (zaehler[f.folder_id] || 0) + 1;
  const trash = trashListStmt.all(scope.area, scope.caseId).length;
  res.json({ folders, fileCounts: zaehler, trashCount: trash });
});

router.get('/list', requireViewDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  const folderId = String(req.query.folderId || '');
  const rows = fileListStmt.all(scope.area, scope.caseId, folderId);
  res.json({ files: rows.map(r => publicFile(r, annCountsMap())) });
});

router.get('/trash', requireViewDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  res.json({ files: trashListStmt.all(scope.area, scope.caseId).map(r => publicFile(r)) });
});

/* --------------------------------- Ordner --------------------------------- */
router.post('/folders', requireEditDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  const nameInfo = documentNames.normalisiereDateiname(String(req.body?.name || '').trim(), { fallback: 'Unbenannt' });
  const name = String(req.body?.name || '').trim() ? nameInfo.name : null;
  if (!name) return res.status(400).json({ error: 'Ordnername fehlt oder ist ungültig.' });
  const parentId = String(req.body?.parentId || '');
  if (parentId) {
    const parent = folderGetStmt.get(parentId);
    if (!parent || parent.area !== scope.area || parent.case_id !== scope.caseId) {
      return res.status(404).json({ error: 'Elternordner nicht gefunden.' });
    }
  } else if (scope.area === 'case' && !exakterRegistername(name)) {
    return res.status(409).json({
      error: 'Auf der obersten Ebene einer Fallakte sind ausschließlich die verbindlichen Register 00–12 zulässig.'
    });
  }
  const geschwister = folderAllStmt.all(scope.area, scope.caseId).filter(f => f.parent_id === parentId);
  if (geschwister.some(f => documentNames.dateinamenGleich(f.name, name))) {
    return res.status(409).json({ error: 'Ein Ordner mit diesem Namen existiert hier bereits.' });
  }
  const id = crypto.randomUUID();
  folderInsStmt.run({ id, area: scope.area, caseId: scope.caseId, parentId, name, createdBy: req.session.userId });
  try { syncFolderPath(folderGetStmt.get(id)); }
  catch (error) {
    folderDelStmt.run(id);
    return res.status(500).json({ error: 'Ordner konnte auf der Platte nicht angelegt werden: ' + (error.message || error) });
  }
  res.status(201).json({ id, name, adjustments: nameInfo.reasons });
});

// Ordnergenerator-Anbindung: ganze Struktur in einem Rutsch anlegen; vorhandene Namen werden
// wiederverwendet (idempotent). paths: ['01 Gericht', '01 Gericht/Beschlüsse', ...].
router.post('/folders/bulk', requireEditDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
  if (!paths.length) return res.status(400).json({ error: 'paths (Liste von Ordnerpfaden) erforderlich.' });
  const vorbereitet = paths.slice(0, 500)
    .map((roh) => String(roh || '').split('/').map(cleanName).filter(Boolean).slice(0, 10));
  if (vorbereitet.some((teile) => !teile.length)) {
    return res.status(400).json({ error: 'Ein Ordnerpfad ist leer oder ungültig.' });
  }
  if (scope.area === 'case' && vorbereitet.some((teile) => !exakterRegistername(teile[0]))) {
    return res.status(409).json({
      error: 'Jeder Fallaktenpfad muss mit einem der verbindlichen Register 00–12 beginnen.'
    });
  }
  let angelegt = 0;
  const anlegen = db.transaction(() => {
    for (const teile of vorbereitet) {
      let parentId = '';
      for (const teil of teile) {
        const vorhanden = folderAllStmt.all(scope.area, scope.caseId)
          .find(f => f.parent_id === parentId && documentNames.dateinamenGleich(f.name, teil));
        if (vorhanden) { parentId = vorhanden.id; continue; }
        const id = crypto.randomUUID();
        folderInsStmt.run({ id, area: scope.area, caseId: scope.caseId, parentId, name: teil, createdBy: req.session.userId });
        parentId = id; angelegt++;
      }
    }
  });
  anlegen();
  for (const folder of folderAllStmt.all(scope.area, scope.caseId)) {
    try { syncFolderPath(folder); }
    catch (error) { return res.status(500).json({ error: 'Ordnerbaum wurde in der Datenbank angelegt, aber nicht vollständig auf die Platte geschrieben: ' + (error.message || error) }); }
  }
  res.json({ created: angelegt });
});

// Die verbindliche Fallstruktur erzeugt bei der Fallanlage und auf explizite Wiederholung
// ausschliesslich die 13 Register. Fach-Unterordner bleiben bis zur ersten Datei lazy.
router.post('/folders/standard', requireEditDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  if (scope.area !== 'case') return res.status(400).json({ error: 'Die Registerstruktur gehört zu einer Fallakte.' });
  try {
    const result = documentStorage.ensureCaseLayout(scope.caseId, req.session.userId);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: 'Registerstruktur konnte nicht angelegt werden: ' + (error.message || error) });
  }
});

router.patch('/folders/:id', requireEditDocuments, (req, res) => {
  const ordner = folderGetStmt.get(String(req.params.id));
  if (!ordner) return res.status(404).json({ error: 'Ordner nicht gefunden.' });
  if (fremderFall(req, res, ordner)) return;
  if (ordner.area === 'case' && !ordner.parent_id) {
    const requestedName = req.body?.name === undefined ? ordner.name : String(req.body.name || '').trim().normalize('NFC');
    const requestedParent = req.body?.parentId === undefined ? '' : String(req.body.parentId || '');
    if (requestedName !== ordner.name || requestedParent !== '') {
      return res.status(409).json({ error: 'Ein verbindliches Register 00–12 kann nicht umbenannt oder verschoben werden.' });
    }
  }
  let nextName = ordner.name;
  let nextParent = ordner.parent_id;
  let nameInfo = { reasons: [] };
  if (req.body?.name !== undefined) {
    const raw = String(req.body.name || '').trim();
    if (!raw) return res.status(400).json({ error: 'Ungültiger Name.' });
    nameInfo = documentNames.normalisiereDateiname(raw);
    nextName = nameInfo.name;
  }
  if (req.body?.parentId !== undefined) {
    const parentId = String(req.body.parentId || '');
    if (parentId) {
      const ziel = folderGetStmt.get(parentId);
      if (!ziel || ziel.area !== ordner.area || ziel.case_id !== ordner.case_id) {
        return res.status(400).json({ error: 'Zielordner ungültig.' });
      }
      // Zyklus-Schutz: ein Ordner darf nicht in sich selbst oder einen Nachfahren wandern.
      if (descendantFolderIds(ordner.area, ordner.case_id, ordner.id).includes(parentId)) {
        return res.status(400).json({ error: 'Ein Ordner kann nicht in sich selbst verschoben werden.' });
      }
    }
    nextParent = parentId;
  }
  const siblingCollision = folderAllStmt.all(ordner.area, ordner.case_id)
    .some((folder) => folder.id !== ordner.id && folder.parent_id === nextParent
      && documentNames.dateinamenGleich(folder.name, nextName));
  if (siblingCollision) return res.status(409).json({ error: 'Ein Ordner mit diesem Namen existiert am Ziel bereits.' });

  let oldRelative = '';
  try { oldRelative = documentStorage.folderRelpath(ordner.area, ordner.case_id, ordner.id, false); }
  catch (_error) { oldRelative = String(ordner.storage_relpath || ''); }
  const rollback = () => {
    folderRenStmt.run({ id: ordner.id, name: ordner.name });
    folderMoveStmt.run({ id: ordner.id, parentId: ordner.parent_id });
  };
  folderRenStmt.run({ id: ordner.id, name: nextName });
  folderMoveStmt.run({ id: ordner.id, parentId: nextParent });
  let newRelative;
  let movedFrom = null;
  let movedTo = null;
  try {
    newRelative = documentStorage.folderRelpath(ordner.area, ordner.case_id, ordner.id, false);
    const oldPath = oldRelative ? joinRoot(documentStorage.root(), oldRelative) : null;
    const newPath = joinRoot(documentStorage.root(), newRelative);
    if (oldPath && path.resolve(oldPath) !== path.resolve(newPath) && fs.existsSync(oldPath)) {
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      if (fs.existsSync(newPath)) throw new Error('Am Ziel existiert bereits ein gleichnamiger Ordner auf der Platte.');
      fs.renameSync(oldPath, newPath);
      movedFrom = oldPath;
      movedTo = newPath;
    } else {
      fs.mkdirSync(newPath, { recursive: true });
    }
    const oldPrefix = oldRelative;
    const folders = folderAllStmt.all(ordner.area, ordner.case_id);
    const files = db.prepare('SELECT * FROM doc_files WHERE area=? AND case_id=?').all(ordner.area, ordner.case_id);
    const setFolderPath = db.prepare("UPDATE doc_folders SET name_key=?, storage_relpath=?, updated_at=datetime('now') WHERE id=?");
    const setFilePath = db.prepare("UPDATE doc_files SET storage_relpath=?, updated_at=datetime('now') WHERE id=?");
    const updatePaths = db.transaction(() => {
      for (const folder of folders) {
        const rel = String(folder.storage_relpath || '');
        if (folder.id === ordner.id) {
          setFolderPath.run(documentNames.vergleichsschluessel(nextName), newRelative, folder.id);
        } else if (oldPrefix && (rel === oldPrefix || rel.startsWith(oldPrefix + '/'))) {
          setFolderPath.run(documentNames.vergleichsschluessel(folder.name), newRelative + rel.slice(oldPrefix.length), folder.id);
        }
      }
      for (const file of files) {
        const rel = String(file.storage_relpath || '');
        if (oldPrefix && (rel === oldPrefix || rel.startsWith(oldPrefix + '/'))) {
          setFilePath.run(newRelative + rel.slice(oldPrefix.length), file.id);
        }
      }
    });
    updatePaths();
    for (const file of files) {
      const fresh = fileGetStmt.get(file.id);
      const filePath = fresh && findBlobPath(fresh);
      if (filePath && fresh.storage_relpath) {
        try { documentStorage.writeSidecar(fresh, filePath); } catch (_error) { /* Integritaetslauf meldet */ }
      }
    }
  } catch (error) {
    if (movedFrom && movedTo && fs.existsSync(movedTo) && !fs.existsSync(movedFrom)) {
      try { fs.renameSync(movedTo, movedFrom); } catch (_rollbackError) { /* Integritaetslauf meldet den Konflikt */ }
    }
    rollback();
    return res.status(409).json({ error: 'Ordner konnte auf der Platte nicht geändert werden: ' + (error.message || error) });
  }
  res.json({ ok: true, name: nextName, storageRelpath: newRelative, adjustments: nameInfo.reasons });
});

// Loeschen: nur leere Ordner - ausser force=1, dann wandern enthaltene Dateien (rekursiv) in den
// Papierkorb (wiederherstellbar) und die Ordnerzweige verschwinden.
router.delete('/folders/:id', requireEditDocuments, (req, res) => {
  const ordner = folderGetStmt.get(String(req.params.id));
  if (!ordner) return res.status(404).json({ error: 'Ordner nicht gefunden.' });
  if (fremderFall(req, res, ordner)) return;
  const ids = descendantFolderIds(ordner.area, ordner.case_id, ordner.id);
  const dateien = fileScopeStmt.all(ordner.area, ordner.case_id).filter(f => ids.includes(f.folder_id));
  const unterordner = ids.length - 1;
  if ((dateien.length || unterordner) && String(req.query.force || '') !== '1') {
    return res.status(409).json({ error: `Ordner ist nicht leer (${dateien.length} Datei(en), ${unterordner} Unterordner). Mit force=1 wandern die Dateien in den Papierkorb.` });
  }
  if (ordner.area === 'case' && !ordner.parent_id) {
    return res.status(409).json({ error: 'Ein verbindliches Register 00–12 kann nicht gelöscht werden.' });
  }
  for (const f of dateien) {
    removeDocumentFollowups(f.id);
    try { moveFileToTrash(f, req.session.userId); }
    catch (error) {
      return res.status(409).json({ error: `Ordner wurde nicht gelöscht: „${f.name}“ konnte nicht sicher in den Papierkorb verschoben werden (${error.message || error}).` });
    }
  }
  const loeschen = db.transaction(() => {
    for (const id of ids) folderDelStmt.run(id);
  });
  loeschen();
  if (ordner.storage_relpath) {
    try { fs.rmdirSync(joinRoot(documentStorage.root(), ordner.storage_relpath)); }
    catch (_error) { /* Finder-Reste/Sidecars bleiben fuer den Abgleich sichtbar */ }
  }
  res.json({ ok: true, trashed: dateien.length });
});

/* --------------------------------- Dateien -------------------------------- */
router.post('/files', requireEditDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  const folderId = String(req.body?.folderId || '');
  if (folderId && !folderGetStmt.get(folderId)) return res.status(404).json({ error: 'Zielordner nicht gefunden.' });
  const wunsch = cleanName(req.body?.fileName);
  if (!wunsch) return res.status(400).json({ error: 'Dateiname fehlt oder ist ungültig.' });
  const b64 = String(req.body?.dataBase64 || '');
  if (!b64) return res.status(400).json({ error: 'dataBase64 erforderlich.' });
  let bytes;
  try { bytes = Buffer.from(b64, 'base64'); } catch (_e) { return res.status(400).json({ error: 'dataBase64 ist nicht lesbar.' }); }
  if (!bytes.length) return res.status(400).json({ error: 'Leere Datei.' });
  if (bytes.length > MAX_JSON_FILE) return res.status(413).json({ error: zuGrossText(bytes.length, MAX_JSON_FILE, STROM_HINWEIS) });
  if (bytes.length > MAX_FILE) return res.status(413).json({ error: zuGrossText(bytes.length, MAX_FILE) });

  const id = crypto.randomUUID();
  const name = uniqueName(scope.area, scope.caseId, folderId, wunsch, id);
  const mimeType = String(req.body?.mimeType || 'application/octet-stream').slice(0, 120);
  // OCR-/Extraktions-Status: PDF und Bilder brauchen Textextraktion im Client (pdf.js/Tesseract),
  // alles andere gilt als nicht-indexierbar bzw. wird direkt als Text geliefert.
  const brauchtText = /pdf|image\//i.test(mimeType) || /\.(pdf|jpe?g|png|gif|tiff?|heic)$/i.test(name);
  let placed;
  try {
    placed = documentStorage.placeBuffer({
      id, area: scope.area, case_id: scope.caseId, folder_id: folderId,
      name, mime_type: mimeType
    }, bytes);
    db.transaction(() => {
      fileInsStmt.run({
        id, area: scope.area, caseId: scope.caseId, folderId, name: placed.name, mimeType,
        size: bytes.length, pages: Number(req.body?.pages) || 0,
        sha256: placed.sha256,
        ocrStatus: brauchtText ? 'pending' : 'none', createdBy: req.session.userId
      });
      fileStorageStmt.run({
        id, name: placed.name, nameKey: documentNames.vergleichsschluessel(placed.name), folderId,
        storageRelpath: placed.storageRelpath, storageDev: placed.storageDev, storageIno: placed.storageIno
      });
      documentStorage.writeSidecar(fileGetStmt.get(id), placed.filePath);
    })();
  } catch (error) {
    if (placed) {
      try { documentStorage.removeFileAndSidecar({ id, area: scope.area, case_id: scope.caseId, storage_relpath: placed.storageRelpath }); } catch (_ignore) { /* best effort */ }
    }
    return res.status(500).json({ error: 'Datei konnte nicht sicher abgelegt werden: ' + (error.message || error) });
  }
  res.status(201).json({ id, name: placed.name, ocrStatus: brauchtText ? 'pending' : 'none', adjustments: placed.adjustments });
});

router.get('/files/:id', requireViewDocuments, (req, res) => {
  const file = fileGetStmt.get(String(req.params.id));
  if (!file) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  const p = findBlobPath(file);
  if (!p) return res.status(410).json({ error: 'Dateiinhalt liegt nicht (mehr) am konfigurierten Speicherort.' });
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('X-Filename', encodeURIComponent(file.name || 'datei'));
  if (String(req.query.download || '') === '1') {
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name || 'datei')}`);
  }
  /* Teil-Abrufe (D19): Safari verlangt fuer <video>/<audio> echte Range-Antworten (206). */
  res.setHeader('Accept-Ranges', 'bytes');
  let gesamt = 0;
  try { gesamt = fs.statSync(p).size; } catch (_e) { gesamt = Number(file.size) || 0; }
  const rng = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (rng && gesamt > 0 && (rng[1] !== '' || rng[2] !== '')) {
    const start = rng[1] === '' ? Math.max(0, gesamt - Number(rng[2])) : Number(rng[1]);
    let ende = (rng[1] !== '' && rng[2] !== '') ? Number(rng[2]) : gesamt - 1;
    if (!(start >= 0) || start >= gesamt || ende < start) {
      res.setHeader('Content-Range', 'bytes */' + gesamt);
      return res.status(416).end();
    }
    if (ende >= gesamt) ende = gesamt - 1;
    res.status(206);
    res.setHeader('Content-Range', 'bytes ' + start + '-' + ende + '/' + gesamt);
    res.setHeader('Content-Length', String(ende - start + 1));
    return fs.createReadStream(p, { start, end: ende }).pipe(res);
  }
  fs.createReadStream(p).pipe(res);
});

router.get('/files/:id/meta', requireViewDocuments, (req, res) => {
  const file = fileGetStmt.get(String(req.params.id));
  if (!file) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  const anns = annListStmt.all(file.id).length;
  res.json({ file: { ...publicFile(file), annotations: anns } });
});

router.patch('/files/:id', requireEditDocuments, (req, res) => {
  const file = fileGetStmt.get(String(req.params.id));
  if (!file) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  let { name, folder_id: folderId, pages, ocr_status: ocrStatus } = file;
  if (req.body?.folderId !== undefined) {
    const ziel = String(req.body.folderId || '');
    if (ziel && !folderGetStmt.get(ziel)) return res.status(404).json({ error: 'Zielordner nicht gefunden.' });
    folderId = ziel;
  }
  if (req.body?.name !== undefined) {
    const neu = cleanName(req.body.name);
    if (!neu) return res.status(400).json({ error: 'Ungültiger Name.' });
    name = neu;
  }
  name = uniqueName(file.area, file.case_id, folderId, name, file.id);
  if (req.body?.pages !== undefined) pages = Math.max(0, Number(req.body.pages) || 0);
  if (req.body?.ocrStatus !== undefined) {
    const s = String(req.body.ocrStatus);
    if (!['none', 'pending', 'done', 'failed'].includes(s)) return res.status(400).json({ error: 'Ungültiger OCR-Status.' });
    ocrStatus = s;
  }
  let relocated = null;
  if (name !== file.name || folderId !== file.folder_id) {
    try { relocated = documentStorage.relocate(file, file.area, file.case_id, folderId, name); }
    catch (error) { return res.status(409).json({ error: 'Datei konnte auf der Platte nicht verschoben/umbenannt werden: ' + (error.message || error) }); }
    name = relocated.name;
  }
  fileUpdStmt.run({ id: file.id, name, folderId, pages, ocrStatus });
  if (relocated) {
    fileStorageStmt.run({
      id: file.id, name, nameKey: documentNames.vergleichsschluessel(name), folderId,
      storageRelpath: relocated.storageRelpath, storageDev: relocated.storageDev, storageIno: relocated.storageIno
    });
  } else if (file.name_key !== documentNames.vergleichsschluessel(name)) {
    db.prepare('UPDATE doc_files SET name_key=? WHERE id=?').run(documentNames.vergleichsschluessel(name), file.id);
  }
  if (name !== file.name) {
    const renamed = documentFollowupRenameStmt.run(`Wiedervorlage: ${name}`, file.id);
    if (renamed.changes) officeEvents.emit('todos', { method: 'PUT', sourceType: 'document', sourceId: file.id });
  }
  res.json({ ok: true, name, adjustments: relocated ? relocated.adjustments : [] });
});

router.post('/files/:id/copy', requireEditDocuments, (req, res) => {
  const file = fileGetStmt.get(String(req.params.id));
  if (!file) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  const folderId = String(req.body?.folderId ?? file.folder_id);
  if (folderId && !folderGetStmt.get(folderId)) return res.status(404).json({ error: 'Zielordner nicht gefunden.' });
  const quelle = findBlobPath(file);
  if (!quelle) return res.status(410).json({ error: 'Dateiinhalt liegt nicht (mehr) am konfigurierten Speicherort.' });
  const id = crypto.randomUUID();
  const name = uniqueName(file.area, file.case_id, folderId, file.name, id);
  let target;
  try {
    target = documentStorage.targetFor(file.area, file.case_id, folderId, name);
    documentStorage.cloneCopy(quelle, target.filePath);
    const stat = fs.statSync(target.filePath);
    const kopieren = db.transaction(() => {
      fileInsStmt.run({
        id, area: file.area, caseId: file.case_id, folderId, name: target.name, mimeType: file.mime_type,
        size: file.size, pages: file.pages, sha256: file.sha256, tags: String(file.tags || ''), note: String(file.note || ''), resubmitAt: String(file.resubmit_at || ''), resubmitNote: String(file.resubmit_note || ''), ocrStatus: file.ocr_status,
        createdBy: req.session.userId
      });
      fileStorageStmt.run({
        id, name: target.name, nameKey: documentNames.vergleichsschluessel(target.name), folderId,
        storageRelpath: target.storageRelpath, storageDev: String(stat.dev), storageIno: String(stat.ino)
      });
      // Text-Index und Anmerkungen wandern mit (die Kopie eines annotierten Dokuments behaelt beides).
      for (const t of textForFileStmt.all(file.id)) textInsStmt.run(id, t.page, t.text);
      for (const a of annListStmt.all(file.id)) {
        annInsStmt.run({ id: crypto.randomUUID(), fileId: id, page: a.page, art: a.art, text: a.text, geoJson: a.geo_json, author: a.author, createdBy: a.created_by });
      }
    });
    kopieren();
    documentStorage.writeSidecar(fileGetStmt.get(id), target.filePath);
  } catch (error) {
    if (target) {
      try { fs.unlinkSync(target.filePath); } catch (_ignore) { /* best effort */ }
      try { fs.unlinkSync(documentStorage.sidecarPath(target.filePath, id)); } catch (_ignore) { /* best effort */ }
    }
    return res.status(500).json({ error: 'Kopie konnte nicht sicher angelegt werden: ' + (error.message || error) });
  }
  res.status(201).json({ id, name: target.name, adjustments: target.adjustments });
});

router.delete('/files/:id', requireEditDocuments, (req, res) => {
  const file = fileGetStmt.get(String(req.params.id));
  if (!file) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  if (file.deleted_at) return res.json({ ok: true });
  removeDocumentFollowups(file.id);
  let moved;
  try { moved = moveFileToTrash(file, req.session.userId); }
  catch (error) { return res.status(409).json({ error: 'Datei konnte nicht sicher in den Papierkorb verschoben werden: ' + (error.message || error) }); }
  res.json({ ok: true, storageRelpath: moved.storageRelpath });
});

router.post('/files/:id/restore', requireEditDocuments, (req, res) => {
  const file = fileGetStmt.get(String(req.params.id));
  if (!file || !file.deleted_at) return res.status(404).json({ error: 'Datei liegt nicht im Papierkorb.' });
  let ziel = String(req.body?.folderId ?? file.deleted_from ?? '');
  if (ziel && !folderGetStmt.get(ziel)) ziel = '';   // Ursprungsordner wurde inzwischen geloescht -> Wurzel
  const name = uniqueName(file.area, file.case_id, ziel, file.name, file.id);
  let moved;
  try { moved = documentStorage.relocate(file, file.area, file.case_id, ziel, name); }
  catch (error) { return res.status(409).json({ error: 'Datei konnte nicht aus dem Papierkorb wiederhergestellt werden: ' + (error.message || error) }); }
  db.transaction(() => {
    fileRestoreStmt.run({ id: file.id, folderId: ziel });
    fileUpdStmt.run({ id: file.id, name: moved.name, folderId: ziel, pages: file.pages, ocrStatus: file.ocr_status });
    fileStorageStmt.run({
      id: file.id, name: moved.name, nameKey: documentNames.vergleichsschluessel(moved.name), folderId: ziel,
      storageRelpath: moved.storageRelpath, storageDev: moved.storageDev, storageIno: moved.storageIno
    });
  })();
  res.json({ ok: true, folderId: ziel, name: moved.name, adjustments: moved.adjustments });
});

router.delete('/files/:id/purge', requireEditDocuments, (req, res) => {
  const file = fileGetStmt.get(String(req.params.id));
  if (!file) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  if (!file.deleted_at) return res.status(400).json({ error: 'Nur Papierkorb-Einträge können endgültig gelöscht werden.' });
  unlinkBlobQuiet(file);
  db.transaction(() => {
    removeDocumentFollowups(file.id);
    textDelStmt.run(file.id);
    annDelForFileStmt.run(file.id);
    fileLinksPurgeStmt.run(file.id);
    filePurgeStmt.run(file.id);
  })();
  res.json({ ok: true });
});

/* ------------------------- Text-Index & Suche ----------------------------- */
// Der CLIENT extrahiert den Text (PDF-Textebene via pdf.js, Scans via Tesseract - beides liegt
// schon unter /ocr-assets) und liefert ihn seitenweise an; der Server indexiert nur.
router.post('/files/:id/text', requireEditDocuments, (req, res) => {
  const file = fileGetStmt.get(String(req.params.id));
  if (!file) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  const pages = Array.isArray(req.body?.pages) ? req.body.pages : [];
  const status = String(req.body?.ocrStatus || 'done');
  if (!['done', 'failed', 'none'].includes(status)) return res.status(400).json({ error: 'Ungültiger OCR-Status.' });
  const schreiben = db.transaction(() => {
    textDelStmt.run(file.id);
    let maxPage = 0;
    for (const p of pages.slice(0, 5000)) {
      const nr = Math.max(1, Number(p?.page) || 0);
      const text = String(p?.text || '').slice(0, 500000);
      if (!text.trim()) continue;
      textInsStmt.run(file.id, nr, text);
      if (nr > maxPage) maxPage = nr;
    }
    const pagesNeu = Number(req.body?.pages_total) || Number(req.body?.pagesTotal) || Math.max(file.pages, maxPage);
    fileUpdStmt.run({ id: file.id, name: file.name, folderId: file.folder_id, pages: pagesNeu, ocrStatus: status });
  });
  schreiben();
  res.json({ ok: true });
});

router.get('/search', requireViewDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Suchbegriff fehlt.' });
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));

  // Erlaubte Dateien des Suchraums (nie Papierkorb); optional auf einen Ordnerzweig begrenzt.
  let erlaubt = fileScopeStmt.all(scope.area, scope.caseId);
  const folderId = String(req.query.folderId || '');
  if (folderId) {
    const zweig = new Set(descendantFolderIds(scope.area, scope.caseId, folderId));
    erlaubt = erlaubt.filter(f => zweig.has(f.folder_id));
  }
  const erlaubtMap = new Map(erlaubt.map(f => [f.id, f]));

  // voll=1 (KI-Suche, D5): zusaetzlich den GANZEN Seitentext je Treffer mitliefern (gekappt),
  // damit die KI-Antwort auf echten Absaetzen statt 14-Token-Schnipseln beruht.
  const voll = String(req.query.voll || '') === '1';
  const TEXT_CAP = 6000;
  let treffer = [];
  if (HAS_FTS) {
    // Jedes Wort als Phrase in Anfuehrungszeichen -> UND-Suche ohne FTS-Syntax-Ueberraschungen.
    const match = q.split(/\s+/).filter(Boolean).slice(0, 12)
      .map(t => '"' + t.replace(/"/g, '') + '"').join(' ');
    let rows = [];
    try {
      rows = db.prepare(`SELECT file_id, page, text, snippet(doc_text, 2, '[[', ']]', ' … ', 14) AS snip, bm25(doc_text) AS rang
        FROM doc_text WHERE doc_text MATCH ? ORDER BY rang LIMIT 400`).all(match);
    } catch (_e) { rows = []; }
    for (const r of rows) {
      const f = erlaubtMap.get(r.file_id);
      if (!f) continue;
      const h = { file: publicFile(f), page: r.page, snippet: r.snip, score: r.rang };
      if (voll) h.text = String(r.text || '').slice(0, TEXT_CAP);
      treffer.push(h);
      if (treffer.length >= limit) break;
    }
  } else {
    const like = `%${q.replace(/[%_]/g, ' ')}%`;
    const rows = db.prepare('SELECT file_id, page, text FROM doc_text WHERE text LIKE ? LIMIT 400').all(like);
    for (const r of rows) {
      const f = erlaubtMap.get(r.file_id);
      if (!f) continue;
      const idx = r.text.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, idx - 60);
      const h = { file: publicFile(f), page: r.page, snippet: ' … ' + r.text.slice(start, start + 160) + ' … ', score: 0 };
      if (voll) h.text = String(r.text || '').slice(0, TEXT_CAP);
      treffer.push(h);
      if (treffer.length >= limit) break;
    }
  }

  // Dateinamens-Treffer zusaetzlich (auch ohne Text-Index auffindbar).
  const nameTreffer = erlaubt.filter(f => f.name.toLowerCase().includes(q.toLowerCase()) || String(f.note || '').toLowerCase().includes(q.toLowerCase()))
    .slice(0, limit).map(f => publicFile(f));
  // Uebersprungene Scans ehrlich melden (Nutzerwunsch aus dem Mockup: nichts still auslassen).
  const uebersprungen = erlaubt.filter(f => f.ocr_status === 'pending' || f.ocr_status === 'failed')
    .map(f => ({ id: f.id, name: f.name, ocrStatus: f.ocr_status }));
  res.json({ hits: treffer, nameHits: nameTreffer, skipped: uebersprungen, fts: HAS_FTS });
});

/* ------------------------------ Anmerkungen ------------------------------- */
router.get('/annotations', requireViewDocuments, (req, res) => {
  const fileId = String(req.query.fileId || '');
  if (!fileId) return res.status(400).json({ error: 'fileId erforderlich.' });
  const file = fileGetStmt.get(fileId);
  if (!file) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  if (fremderFall(req, res, file)) return;
  res.json({ annotations: annListStmt.all(fileId).map(a => ({
    id: a.id, fileId: a.file_id, page: a.page, art: a.art, text: a.text,
    geo: (() => { try { return JSON.parse(a.geo_json || '{}'); } catch (_e) { return {}; } })(),
    author: a.author, createdAt: a.created_at, updatedAt: a.updated_at
  })) });
});

router.post('/annotations', requireEditDocuments, (req, res) => {
  const fileId = String(req.body?.fileId || '');
  const file = fileId ? fileGetStmt.get(fileId) : null;
  if (!file) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  if (fremderFall(req, res, file)) return;
  const art = String(req.body?.art || 'Kommentar');
  if (!['Kommentar', 'Markierung', 'Zeichnung', 'Signatur'].includes(art)) return res.status(400).json({ error: 'Unbekannte Anmerkungsart.' });
  const id = crypto.randomUUID();
  annInsStmt.run({
    id, fileId, page: Math.max(1, Number(req.body?.page) || 1), art,
    text: String(req.body?.text || '').slice(0, 4000),
    geoJson: JSON.stringify(req.body?.geo && typeof req.body.geo === 'object' ? req.body.geo : {}),
    author: String(req.body?.author || '').slice(0, 120), createdBy: req.session.userId
  });
  res.status(201).json({ id });
});

router.patch('/annotations/:id', requireEditDocuments, (req, res) => {
  const a = annGetStmt.get(String(req.params.id));
  if (!a) return res.status(404).json({ error: 'Anmerkung nicht gefunden.' });
  const file = fileGetStmt.get(a.file_id);
  if (!file) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  if (fremderFall(req, res, file)) return;
  annUpdStmt.run({
    id: a.id,
    page: req.body?.page !== undefined ? Math.max(1, Number(req.body.page) || 1) : a.page,
    art: a.art,
    text: req.body?.text !== undefined ? String(req.body.text).slice(0, 4000) : a.text,
    geoJson: req.body?.geo !== undefined ? JSON.stringify(req.body.geo || {}) : a.geo_json
  });
  res.json({ ok: true });
});

router.delete('/annotations/:id', requireEditDocuments, (req, res) => {
  const a = annGetStmt.get(String(req.params.id));
  if (!a) return res.status(404).json({ error: 'Anmerkung nicht gefunden.' });
  const file = fileGetStmt.get(a.file_id);
  if (!file) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  if (fremderFall(req, res, file)) return;
  annDelStmt.run(a.id);
  res.json({ ok: true });
});

/* ------------------------- Persoenliche Einstellungen --------------------- */
// Klapp-Zustand des Baums, Ansicht (Liste/Kacheln), Sortierung - JE NUTZER auf dem Server
// (Nutzerwunsch; localStorage dient dem Client nur als Zwischenspeicher/Rueckfall).
const prefsGetStmt = db.prepare('SELECT data_json FROM doc_user_prefs WHERE user_id = ?');
const prefsPutStmt = db.prepare(`INSERT INTO doc_user_prefs (user_id, data_json) VALUES (@userId, @dataJson)
  ON CONFLICT(user_id) DO UPDATE SET data_json = @dataJson, updated_at = datetime('now')`);

router.get('/prefs', (req, res) => {
  const row = prefsGetStmt.get(req.session.userId);
  let data = {};
  try { data = row ? JSON.parse(row.data_json || '{}') : {}; } catch (_e) { data = {}; }
  res.json({ prefs: data });
});

router.put('/prefs', (req, res) => {
  const data = (req.body && typeof req.body.prefs === 'object' && req.body.prefs) ? req.body.prefs : {};
  const dataJson = JSON.stringify(data);
  if (dataJson.length > 200 * 1024) return res.status(413).json({ error: 'Einstellungen zu groß.' });
  prefsPutStmt.run({ userId: req.session.userId, dataJson });
  res.json({ ok: true });
});

/* ----------------------------- Speicherort-Konfig ------------------------- */
router.get('/config', requireViewDocuments, (req, res) => {
  const cfg = readCfg();
  const eigene = erlaubteFaelle(req.session);
  res.json({
    defaultDir: DEFAULT_DIR,
    storageRoot: cfg.storageRoot,
    // Alias für noch zwischengespeicherte ältere Clients; er bezeichnet in der Antwort
    // bereits die neue Baumwurzel, niemals den alten Blobort.
    baseDir: cfg.storageRoot,
    legacyLocations: [cfg.legacyBaseDir, ...Object.values(cfg.caseDirs || {})].filter(Boolean),
    caseDirs: {},
    autoOcr: cfg.autoOcr,
    tags: cfg.tags,
    trashDays: cfg.trashDays,
    scanEingang: cfg.scanEingang,
    eigeneFaelle: eigene ? [...eigene] : null,
    managementAvailable: !!req.session.isAdmin
  });
});

// Schreiben wie ui_prefs: bueroweite Vorgabe -> Buerostammdaten-Recht oder Admin.
router.put('/config', requireEditDocuments, (req, res) => {
  if (!(req.session.isAdmin || req.session.canManageOfficeProfile)) {
    return res.status(403).json({ error: 'Keine Berechtigung, den Dokumenten-Speicherort zu ändern.' });
  }
  const altCfg = readCfg();
  const storageRoot = (req.body && req.body.storageRoot !== undefined)
    ? String(req.body.storageRoot || '').trim()
    : ((req.body && req.body.baseDir !== undefined)
      ? String(req.body.baseDir || '').trim()
      : altCfg.storageRoot);
  // Veraltete je-Fall-Ziele werden nur noch gelesen/migriert. Alle neuen Dateien gehören
  // unter genau eine zentrale Wurzel; deshalb kann die Oberfläche sie nicht fortschreiben.
  const caseDirs = altCfg.caseDirs;
  if (storageRoot && !path.isAbsolute(storageRoot)) {
    return res.status(400).json({ error: 'Die Dokumentenspeicher-Wurzel muss ein absoluter Pfad sein.' });
  }
  const effectiveStorageRoot = storageRoot || DEFAULT_DIR;
  try { fs.mkdirSync(effectiveStorageRoot, { recursive: true }); } catch (_e) {
    return res.status(400).json({ error: `Verzeichnis nicht anlegbar/erreichbar: ${effectiveStorageRoot}` });
  }
  const overlap = overlappingRoot(effectiveStorageRoot, [
    LEGACY_FILES_DIR, altCfg.legacyBaseDir, ...Object.values(caseDirs || {})
  ]);
  if (overlap) {
    return res.status(400).json({
      error: 'Die neue Dokumentenspeicher-Wurzel darf keinen bisherigen Blob-/Fallordner enthalten und nicht darin liegen.'
    });
  }
  let verifiedStorageRoot;
  try {
    verifiedStorageRoot = storageRootSicherPruefen(effectiveStorageRoot, altCfg.storageRoot || DEFAULT_DIR);
  } catch (error) {
    return res.status(400).json({ error: error.message || String(error) });
  }
  const autoOcr = (req.body && req.body.autoOcr !== undefined) ? !!req.body.autoOcr : altCfg.autoOcr;
  let tagDefs = altCfg.tags;
  if (req.body && Array.isArray(req.body.tags)) {
    tagDefs = req.body.tags.slice(0, 12).map((x) => ({
      id: String((x && x.id) || '').slice(0, 12) || ('t' + crypto.randomBytes(3).toString('hex')),
      name: String((x && x.name) || '').slice(0, 40),
      farbe: /^#[0-9a-fA-F]{6}$/.test(String((x && x.farbe) || '')) ? String(x.farbe) : '#8aa2b8'
    })).filter((x) => x.name);
  }
  let trashDays = altCfg.trashDays;
  if (req.body && req.body.trashDays !== undefined) {
    const n = Number(req.body.trashDays);
    if (!(n >= 1 && n <= 3650)) return res.status(400).json({ error: 'Aufbewahrung bitte zwischen 1 und 3650 Tagen.' });
    trashDays = Math.floor(n);
  }
  let scanEingang = altCfg.scanEingang;
  if (req.body && req.body.scanEingang !== undefined) {
    const s = (req.body.scanEingang && typeof req.body.scanEingang === 'object') ? req.body.scanEingang : {};
    const ziel = (s.ziel && typeof s.ziel === 'object') ? s.ziel : {};
    if (s.an && !String(s.ordner || '').trim()) return res.status(400).json({ error: 'Scan-Eingang: bitte einen Ordnerpfad angeben.' });
    if (ziel.art === 'case' && !caseExistsStmt.get(String(ziel.caseId || ''))) return res.status(400).json({ error: 'Scan-Eingang: die gewählte Fallakte gibt es nicht.' });
    scanEingang = { an: !!s.an, ordner: String(s.ordner || '').trim(),
      ziel: ziel.art === 'case' ? { art: 'case', caseId: String(ziel.caseId || ''), folderId: String(ziel.folderId || '') } : { art: 'inbox' },
      status: (altCfg.scanEingang && altCfg.scanEingang.status) || '' };
  }
  cfgPut.run({
    dataJson: JSON.stringify({
      storageLayout: 'real-folders-v1',
      storageRoot: storageRoot ? verifiedStorageRoot : '',
      legacyBaseDir: altCfg.legacyBaseDir,
      caseDirs,
      autoOcr,
      tags: tagDefs,
      trashDays,
      scanEingang
    }),
    userId: req.session.userId
  });
  res.json({ ok: true });
});

/* ============================ Spiegelordner (D3) ============================
   Bestandsdaten der Software erscheinen READ-ONLY im Explorer: je Fall die
   Falldoku-Anlagen und das Passfoto, bueroweit der Posteingang (Jahr->Tag),
   Finanz-Belege, Kontoauszuege und die Dateien offener Fallbeginn-Laeufe.
   Bearbeitung bleibt im Herkunftsmodul; hier wird nur gelistet/gestreamt.
   Rechte: Dokumente-Leserecht ALS BASIS plus das Recht der jeweiligen Quelle
   (Fall-Sichtrecht bzw. Finanz-Sichtrecht - Gehaltsdaten-Schutz!).
   DOCUMENTS_DATA_ROOT dient NUR dem Testharnisch (Fixture-Verzeichnis). */
const DATA_ROOT = DOCUMENT_DATA_ROOT;

const dokuEntriesStmt = db.prepare('SELECT id, data_json, created_at FROM case_doku_entries WHERE case_id = ?');
const inboxAllStmt = db.prepare('SELECT id, file_name, mime_type, size, inbox_date, received_date, created_at FROM inbox_documents');
const inboxOneStmt = db.prepare('SELECT * FROM inbox_documents WHERE id = ?');
const receiptsAllStmt = db.prepare('SELECT id, filename, mime_type, size, invoice_date, uploaded_at FROM finance_receipts ORDER BY uploaded_at DESC');
const receiptOneStmt = db.prepare('SELECT * FROM finance_receipts WHERE id = ?');
const statementsAllStmt = db.prepare('SELECT id, filename, mime_type, size, uploaded_at FROM finance_statements ORDER BY uploaded_at DESC');
const statementOneStmt = db.prepare('SELECT * FROM finance_statements WHERE id = ?');
const intakeDraftsStmt = db.prepare('SELECT draft_id, COUNT(*) AS n FROM intake_files GROUP BY draft_id ORDER BY draft_id');
const intakeListStmt = db.prepare('SELECT id, file_name, mime_type, size, created_at FROM intake_files WHERE draft_id = ? ORDER BY created_at, file_name');
const intakeOneStmt = db.prepare('SELECT * FROM intake_files WHERE draft_id = ? AND id = ?');
const caseRowStmt = db.prepare('SELECT id, label, stammdaten_json FROM cases WHERE id = ?');
const intakeMetaStmt = db.prepare("SELECT data_json FROM office_json WHERE key = 'case_intakes'");

const SPIEGEL_CASE = [
  { key: 'fallchronik', name: 'Fallchronik' },
  { key: 'dokuanlagen', name: 'Falldokumentation (Anlagen)' },
  { key: 'passfoto', name: 'Passfoto' }
];
const SPIEGEL_OFFICE = [
  { key: 'posteingang', name: 'Posteingang' },
  { key: 'belege', name: 'Finanz-Belege' },
  { key: 'auszuege', name: 'Kontoauszüge' },
  { key: 'intakes', name: 'Fallintakes (offen)' }
];

function darfQuelle(req, key) {
  const s = req.session || {};
  if (s.isAdmin) return true;
  if (key === 'belege' || key === 'auszuege') return !!s.canViewFinance;
  return !!s.canViewCases;
}

function dokuDatumIso(value) {
  const raw = String(value || '').trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{2})[./](\d{2})[./](\d{4})/.exec(raw);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return '';
}

function dokuFotos(caseId) {
  const alle = [];
  for (const row of dokuEntriesStmt.all(caseId)) {
    let data = {};
    try { data = JSON.parse(row.data_json || '{}'); } catch (_e) { data = {}; }
    const datum = dokuDatumIso(data.date || data.datum || row.created_at);
    for (const p of (Array.isArray(data.photos) ? data.photos : [])) {
      if (!p || !p.id) continue;
      alle.push({
        key: row.id + '/' + p.id, name: String(p.filename || 'Anlage'),
        mime: String(p.mimeType || ''), size: Number(p.size) || 0,
        date: datum || dokuDatumIso(p.uploadedAt)
      });
    }
  }
  return alle;
}

function passfotoDatei(caseId) {
  const row = caseRowStmt.get(caseId);
  if (!row) return null;
  let sd = {};
  try { sd = JSON.parse(row.stammdaten_json || '{}'); } catch (_e) { sd = {}; }
  const foto = sd && sd.person && sd.person.photo;
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(String(foto || ''));
  if (!m) return null;
  const endung = /png/i.test(m[1]) ? 'png' : (/webp/i.test(m[1]) ? 'webp' : 'jpg');
  const pad = m[2].endsWith('==') ? 2 : (m[2].endsWith('=') ? 1 : 0);
  return { key: 'passfoto', name: 'Passfoto.' + endung, mime: m[1], size: Math.floor(m[2].length * 3 / 4) - pad, date: '', _b64: m[2] };
}

// Draft-Beschriftung aus dem Intake-Zwischenstand (best effort - Struktur ist Client-Sache);
// Rueckfall ist die Kurz-Kennung, damit der Ordner nie namenlos bleibt.
function intakeName(draftId) {
  try {
    const row = intakeMetaStmt.get();
    if (!row) return null;
    const stapel = [JSON.parse(row.data_json || '{}')];
    while (stapel.length) {
      const x = stapel.pop();
      if (Array.isArray(x)) { for (const v of x) stapel.push(v); continue; }
      if (x && typeof x === 'object') {
        if (x.id === draftId || x.draftId === draftId) {
          const n = String(x.label || x.name || x.title || x.person || '').trim();
          if (n) return n;
        }
        for (const v of Object.values(x)) stapel.push(v);
      }
    }
  } catch (_e) { /* Beschriftung ist Komfort, nie Pflicht */ }
  return null;
}

function inboxTag(r) { return String(r.inbox_date || r.received_date || r.created_at || '').slice(0, 10); }

router.use('/mirror', (_req, res) => {
  res.status(410).json({
    error: 'Die frühere Modulordner-/Spiegelansicht ist abgeschafft. Dateien der Fachmodule liegen direkt im zentralen Dokumentenspeicher.'
  });
});

router.get('/mirror/sources', requireViewDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  const defs = scope.area === 'case' ? SPIEGEL_CASE : SPIEGEL_OFFICE;
  const quellen = [];
  for (const d of defs) {
    if (!darfQuelle(req, d.key)) continue;
    let count = 0;
    try {
      if (d.key === 'fallchronik' || d.key === 'dokuanlagen') count = dokuFotos(scope.caseId).length;
      else if (d.key === 'passfoto') count = passfotoDatei(scope.caseId) ? 1 : 0;
      else if (d.key === 'posteingang') count = inboxAllStmt.all().length;
      else if (d.key === 'belege') count = receiptsAllStmt.all().length;
      else if (d.key === 'auszuege') count = statementsAllStmt.all().length;
      else if (d.key === 'intakes') count = intakeDraftsStmt.all().reduce((a, r) => a + r.n, 0);
    } catch (_e) { count = 0; }
    quellen.push({ key: d.key, name: d.name, count });
  }
  res.json({ sources: quellen, modulSync: true });
});

router.get('/mirror/list', requireViewDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  const src = String(req.query.src || ''), sub = String(req.query.sub || '');
  const defs = scope.area === 'case' ? SPIEGEL_CASE : SPIEGEL_OFFICE;
  if (!defs.some(d => d.key === src)) return res.status(404).json({ error: 'Unbekannte Spiegel-Quelle.' });
  if (!darfQuelle(req, src)) return res.status(403).json({ error: 'Keine Berechtigung für diese Quelle.' });
  let folders = [], files = [];
  if (src === 'fallchronik') {
    const alle = dokuFotos(scope.caseId);
    const monate = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const gueltig = (date) => /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''));
    const countBy = (items, valueOf) => {
      const out = new Map();
      for (const item of items) {
        const value = valueOf(item);
        out.set(value, (out.get(value) || 0) + 1);
      }
      return out;
    };
    if (!sub) {
      const years = countBy(alle, item => gueltig(item.date) ? item.date.slice(0, 4) : 'ohne-datum');
      folders = [...years.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, count]) => ({
        sub: year, name: year === 'ohne-datum' ? 'Ohne Datum' : year, count
      }));
    } else if (/^\d{4}$/.test(sub)) {
      const matching = alle.filter(item => gueltig(item.date) && item.date.slice(0, 4) === sub);
      const byMonth = countBy(matching, item => item.date.slice(5, 7));
      folders = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, count]) => ({
        sub: `${sub}/${month}`, name: `${month} - ${monate[Number(month) - 1] || month}`, count
      }));
    } else if (/^\d{4}\/\d{2}$/.test(sub)) {
      const [year, month] = sub.split('/');
      const matching = alle.filter(item => gueltig(item.date) && item.date.slice(0, 7) === `${year}-${month}`);
      const byDay = countBy(matching, item => item.date.slice(8, 10));
      folders = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, count]) => ({
        sub: `${sub}/${day}`, name: `${day}.${month}.${year}`, count
      }));
    } else if (/^\d{4}\/\d{2}\/\d{2}$/.test(sub)) {
      const date = sub.replace(/\//g, '-');
      files = alle.filter(item => item.date === date);
    } else if (sub === 'ohne-datum') {
      files = alle.filter(item => !gueltig(item.date));
    }
  } else if (src === 'dokuanlagen') files = dokuFotos(scope.caseId);
  else if (src === 'passfoto') {
    const p = passfotoDatei(scope.caseId);
    files = p ? [{ key: p.key, name: p.name, mime: p.mime, size: p.size, date: p.date }] : [];
  } else if (src === 'posteingang') {
    const alle = inboxAllStmt.all();
    if (!sub) {
      const jahre = {};
      for (const r of alle) { const j = inboxTag(r).slice(0, 4) || 'ohne Datum'; jahre[j] = (jahre[j] || 0) + 1; }
      folders = Object.keys(jahre).sort().reverse().map(j => ({ sub: j, name: j, count: jahre[j] }));
    } else if (/^\d{4}$/.test(sub)) {
      const tage = {};
      for (const r of alle) { const t = inboxTag(r); if (t.slice(0, 4) === sub) tage[t] = (tage[t] || 0) + 1; }
      folders = Object.keys(tage).sort().reverse().map(t => ({ sub: t, name: t.split('-').reverse().join('.'), count: tage[t] }));
    } else {
      files = alle.filter(r => inboxTag(r) === sub)
        .map(r => ({ key: r.id, name: r.file_name || 'Dokument', mime: r.mime_type, size: r.size, date: sub }));
    }
  } else if (src === 'belege') {
    files = receiptsAllStmt.all().map(r => ({ key: r.id, name: r.filename || 'Beleg', mime: r.mime_type, size: r.size, date: String(r.invoice_date || r.uploaded_at || '').slice(0, 10) }));
  } else if (src === 'auszuege') {
    files = statementsAllStmt.all().map(r => ({ key: r.id, name: r.filename || 'Kontoauszug', mime: r.mime_type, size: r.size, date: String(r.uploaded_at || '').slice(0, 10) }));
  } else if (src === 'intakes') {
    if (!sub) {
      folders = intakeDraftsStmt.all().map(r => ({ sub: r.draft_id, name: intakeName(r.draft_id) || ('Fallbeginn ' + String(r.draft_id).slice(0, 8)), count: r.n }));
    } else {
      files = intakeListStmt.all(sub).map(r => ({ key: r.id, name: r.file_name || 'Datei', mime: r.mime_type, size: r.size, date: String(r.created_at || '').slice(0, 10) }));
    }
  }
  res.json({ folders, files, locked: true });
});

router.get('/mirror/file', requireViewDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  const src = String(req.query.src || ''), key = String(req.query.key || '');
  const defs = scope.area === 'case' ? SPIEGEL_CASE : SPIEGEL_OFFICE;
  if (!defs.some(d => d.key === src)) return res.status(404).json({ error: 'Unbekannte Spiegel-Quelle.' });
  if (!darfQuelle(req, src)) return res.status(403).json({ error: 'Keine Berechtigung für diese Quelle.' });
  function sende(name, mime, quelle) {
    res.setHeader('Content-Type', mime || 'application/octet-stream');
    res.setHeader('X-Filename', encodeURIComponent(name || 'datei'));
    if (String(req.query.download || '') === '1') {
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name || 'datei')}`);
    }
    if (Buffer.isBuffer(quelle)) return res.send(quelle);
    if (!fs.existsSync(quelle)) return res.status(404).json({ error: 'Datei nicht (mehr) auf dem Server vorhanden.' });
    const stat = fs.statSync(quelle);
    res.setHeader('Accept-Ranges', 'bytes');
    const range = String(req.headers.range || '');
    if (range && String(req.query.download || '') !== '1') {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
        if (!match[1] && match[2]) {
          const suffix = parseInt(match[2], 10);
          start = Math.max(0, stat.size - suffix);
          end = stat.size - 1;
        }
        if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < stat.size) {
          end = Math.min(end, stat.size - 1);
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Content-Length', end - start + 1);
          return fs.createReadStream(quelle, { start, end }).pipe(res);
        }
      }
      res.status(416);
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.end();
    }
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(quelle).pipe(res);
  }
  if (src === 'fallchronik' || src === 'dokuanlagen') {
    const m = /^([^/]+)\/([^/]+)$/.exec(key);
    if (!m) return res.status(400).json({ error: 'Ungültiger Schlüssel.' });
    const foto = dokuFotos(scope.caseId).find(f => f.key === key);
    if (!foto) return res.status(404).json({ error: 'Anlage nicht gefunden.' });
    const central = db.prepare(`
      SELECT f.* FROM doc_links l JOIN doc_files f ON f.id=l.file_id
       WHERE l.module='doku-photo' AND l.slot=?
         AND f.area='case' AND f.case_id=?
       ORDER BY CASE WHEN l.owner_id=? THEN 0 ELSE 1 END LIMIT 1
    `).get(m[2], scope.caseId, m[1]);
    const dokuPath = (central && findBlobPath(central))
      || dokuAttachments.resolve(path.join(DATA_ROOT, 'case-doku-photos'), scope.caseId, m[2], m[1]);
    if (!dokuPath) return res.status(404).json({ error: 'Datei nicht (mehr) auf dem Server vorhanden.' });
    return sende(foto.name, foto.mime, dokuPath);
  }
  if (src === 'passfoto') {
    const p = passfotoDatei(scope.caseId);
    if (!p) return res.status(404).json({ error: 'Kein Passfoto hinterlegt.' });
    return sende(p.name, p.mime, Buffer.from(p._b64, 'base64'));
  }
  if (src === 'posteingang') {
    const r = inboxOneStmt.get(key);
    if (!r) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    const linked = db.prepare("SELECT f.* FROM doc_links l JOIN doc_files f ON f.id=l.file_id WHERE l.module='inbox' AND l.owner_id=? AND l.slot=''").get(r.id);
    return sende(r.file_name, r.mime_type, (linked && findBlobPath(linked)) || path.join(DATA_ROOT, 'inbox-documents', r.id));
  }
  if (src === 'belege') {
    const r = receiptOneStmt.get(key);
    if (!r) return res.status(404).json({ error: 'Beleg nicht gefunden.' });
    const linked = db.prepare("SELECT f.* FROM doc_links l JOIN doc_files f ON f.id=l.file_id WHERE l.module='finance-receipt' AND l.owner_id=? AND l.slot=''").get(r.id);
    return sende(r.filename, r.mime_type, (linked && findBlobPath(linked)) || path.join(DATA_ROOT, 'finance-receipts', r.id));
  }
  if (src === 'auszuege') {
    const r = statementOneStmt.get(key);
    if (!r) return res.status(404).json({ error: 'Kontoauszug nicht gefunden.' });
    const linked = db.prepare("SELECT f.* FROM doc_links l JOIN doc_files f ON f.id=l.file_id WHERE l.module='finance-statement' AND l.owner_id=? AND l.slot=''").get(r.id);
    return sende(r.filename, r.mime_type, (linked && findBlobPath(linked)) || path.join(DATA_ROOT, 'finance-statements', r.id));
  }
  if (src === 'intakes') {
    const r = intakeOneStmt.get(String(req.query.sub || ''), key);
    if (!r) return res.status(404).json({ error: 'Datei nicht gefunden.' });
    return sende(r.file_name, r.mime_type, r.data);
  }
  res.status(404).json({ error: 'Unbekannte Spiegel-Quelle.' });
});

/* Posteingang -> Dokumentenspeicher (D27): Der eine zentrale Dateiinhalt wird einsortiert; der
   Posteingang behaelt seinen Fachverweis. Nur nicht migrierter Altbestand wird beim ersten
   Einsortieren in den zentralen Speicher uebernommen. */
router.post('/files/von-posteingang', requireEditDocuments, (req, res) => {
  const inboxId = String(req.body?.inboxId || '');
  const r = inboxOneStmt.get(inboxId);
  if (!r) return res.status(404).json({ error: 'Posteingangs-Dokument nicht gefunden.' });
  const area = req.body?.area === 'case' ? 'case' : 'office';
  const caseId = area === 'case' ? String(req.body?.caseId || '') : '';
  if (area === 'case' && !caseExistsStmt.get(caseId)) return res.status(404).json({ error: 'Fallakte nicht gefunden.' });
  const linked = db.prepare("SELECT f.* FROM doc_links l JOIN doc_files f ON f.id=l.file_id WHERE l.module='inbox' AND l.owner_id=? AND l.slot=''").get(r.id);
  /* D48: Zielordner wahlweise als Pfad (wird angelegt) statt als fertige folderId. */
  const teile = Array.isArray(req.body?.pfad) ? req.body.pfad.map(x => String(x || '')).filter(Boolean) : [];
  const folderId = teile.length ? ordnerSicherstellen(area, caseId, teile) : String(req.body?.folderId || '');
  /* D48: Der Posteingang baut den Anzeigenamen im Browser - ohne Uebergabe hiesse die Kopie
     weiterhin wie die Rohdatei. Endung notfalls aus dem Original retten. */
  const original = String(r.file_name || 'Dokument');
  const endung = (original.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0];
  let name = String(req.body?.name || '').trim() ? cleanName(String(req.body.name).trim()) : '';
  if (name && endung && !name.toLowerCase().endsWith(endung.toLowerCase())) name += endung;
  if (!name) name = original;
  let erg;
  try {
    if (linked) {
      const moved = dateiUmhaengen(linked, area, caseId, folderId, name);
      erg = { id: linked.id, name: moved.name };
    } else {
      let bytes;
      try { bytes = fs.readFileSync(path.join(DATA_ROOT, 'inbox-documents', r.id)); }
      catch (_e) { return res.status(410).json({ error: 'Die Datei liegt nicht (mehr) auf dem Server.' }); }
      erg = dateiAblegen(area, caseId, folderId, name, String(r.mime_type || 'application/octet-stream'), bytes, req.session.userId);
      db.transaction(() => {
        db.prepare("INSERT INTO doc_links (module, owner_id, slot, file_id, detail_json) VALUES ('inbox', ?, '', ?, '{}')")
          .run(r.id, erg.id);
        db.prepare("INSERT OR IGNORE INTO doc_module_import (quelle, quell_id, file_id) VALUES ('posteingang', ?, ?)")
          .run(r.id, erg.id);
      })();
    }
  }
  catch (e) { if (e && e.code === 'ZU_GROSS') return res.status(413).json({ error: e.message }); return res.status(409).json({ error: 'Dokument konnte nicht sicher einsortiert werden: ' + (e.message || e) }); }
  res.status(201).json({ ok: true, id: erg.id, name: erg.name, folderId });
});

/* Modulordner-Import sofort anstossen (D17). process.emit ruft den Laeufer in
   doc-backup.js synchron - die Antwort kommt nach dem Lauf, der Client liest dann
   Status + Listen frisch. Kein require-Zyklus (Muster 'dok-backup-lauf'). */
router.post('/modul-sync/lauf', requireEditDocuments, (req, res) => {
  res.status(410).json({ error: 'Der frühere Modulordner-Nachzug ist abgeschafft. Fachmodule verwenden den zentralen Dokumentendienst.' });
});

/* ============================ Externe Verbindungen (D6) ============================
   Externe Ablagen erscheinen als eigene Wurzeln im Explorer-Baum. V1 bewusst:
   - webdav (Nextcloud/eigener Server): PROPFIND/GET/PUT ueber globales fetch +
     fast-xml-parser (beides bereits im Haus - siehe caldav.js), Basic-Auth mit
     App-Passwort, VERSCHLUESSELT gespeichert (crypto.js, Muster Mail-Konten).
   - localdir (z. B. lokal synchronisierter iCloud-Ordner): Server liest ein
     Verzeichnis der eigenen Platte; Pfade werden gegen Ausbrueche gehaertet.
   Lesen + Hochladen; Umbenennen/Loeschen auf der Gegenseite bewusst NICHT (V1).
   OneDrive/Google Drive: die BESTEHENDEN Anbindungen wurden ohne Datei-Berechtigung
   erteilt (Scope-Falle: nachtraegliche Scopes brechen bestehende Verbindungen) -
   dafuer braucht es eine einmalige Neu-Verbindung mit Datei-Freigabe; ehrlich im
   Client benannt statt hier vorgetaeuscht. */
const cryptoHelper = require('../../security/crypto');
const bcrypt = require('bcrypt');   /* App-Passwoerter der WebDAV-Freigabe (D7) */
const { XMLParser } = require('fast-xml-parser');
const davParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });

const mountListStmt = db.prepare('SELECT * FROM doc_mounts WHERE enabled = 1 ORDER BY label COLLATE NOCASE');
const mountGetStmt = db.prepare('SELECT * FROM doc_mounts WHERE id = ? AND enabled = 1');
const mountInsStmt = db.prepare(`INSERT INTO doc_mounts (id, label, kind, config_json, created_by)
  VALUES (@id, @label, @kind, @configJson, @createdBy)`);
const mountDelStmt = db.prepare('DELETE FROM doc_mounts WHERE id = ?');

const MOUNT_ARTEN = new Set(['webdav', 'localdir', 'onedrive', 'gdrive']);
function darfMountVerwaltung(req) { const s = req.session || {}; return !!(s.isAdmin || s.canManageOfficeProfile); }
function mountCfg(row) { try { return JSON.parse(row.config_json || '{}'); } catch (_e) { return {}; } }
// Nach aussen NIE Geheimnisse: nur Label/Art/Adresse/Benutzer bzw. Pfad.
function mountIstDrive(row) { return row.kind === 'onedrive' || row.kind === 'gdrive'; }
const mountCfgUpdStmt = db.prepare('UPDATE doc_mounts SET config_json = ? WHERE id = ?');
function mountTokPersist(row, signal) {
  return async (tok) => {
    if (signal && signal.aborted) return;
    try {
      const c = mountCfg(row);
      c.accessEnc = cryptoHelper.encrypt(String(tok.access_token || ''));
      c.accessBis = Date.now() + ((Number(tok.expires_in) || 3600) * 1000) - 60000;
      if (tok.refresh_token) c.refreshEnc = cryptoHelper.encrypt(String(tok.refresh_token));
      mountCfgUpdStmt.run(JSON.stringify(c), row.id);
      row.config_json = JSON.stringify(c);
    } catch (_e) { /* naechster Zugriff erneuert erneut */ }
  };
}
function mountPublic(row) {
  const c = mountCfg(row);
  return { id: row.id, label: row.label, kind: row.kind, url: c.url || '', path: c.path || '', username: c.username || '' };
}
// Pfad-Segmente hart saeubern: nie '..', nichts Verstecktes, keine Backslashes/Leersegmente.
function mountSegmente(p) {
  return String(p || '').split('/').map(s => s.trim())
    .filter(s => s && s !== '.' && s !== '..' && !s.startsWith('.') && !s.includes('\\'));
}
function datumKurz(v) {
  const d = new Date(v || '');
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/* ------------------------------ WebDAV-Helfer ------------------------------ */
function davBase(cfg) {
  let u = String(cfg.url || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('Die WebDAV-Adresse muss mit http(s):// beginnen.');
  if (!u.endsWith('/')) u += '/';
  return u;
}
function davAuth(cfg) {
  return 'Basic ' + Buffer.from(String(cfg.username || '') + ':' + cryptoHelper.decrypt(cfg.passEnc || '')).toString('base64');
}
function davPfadNorm(u, base) {
  try { return decodeURIComponent(new URL(u, base).pathname).replace(/\/+$/, ''); } catch (_e) { return String(u).replace(/\/+$/, ''); }
}
function mountRequestSignal(externalSignal, timeoutMs) {
  const timeout = AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 60000));
  if (!externalSignal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([externalSignal, timeout]);
  return externalSignal;
}
async function davList(cfg, segmente, options) {
  const url = davBase(cfg) + (segmente.length ? segmente.map(encodeURIComponent).join('/') + '/' : '');
  const body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/></d:prop></d:propfind>';
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: { Authorization: davAuth(cfg), Depth: '1', 'Content-Type': 'application/xml' },
    body, signal: mountRequestSignal(options && options.signal, 20000)
  });
  if (res.status === 401 || res.status === 403) throw new Error('Anmeldung abgelehnt - Benutzer/App-Passwort prüfen.');
  if (res.status === 404) throw new Error('Ordner auf dem WebDAV-Server nicht gefunden.');
  if (res.status !== 207 && !res.ok) throw new Error('WebDAV-Antwort ' + res.status);
  const xml = davParser.parse(await res.text());
  let resp = xml && xml.multistatus && xml.multistatus.response;
  if (!resp) return { folders: [], files: [] };
  if (!Array.isArray(resp)) resp = [resp];
  const selbst = davPfadNorm(url, url);
  const folders = [], files = [];
  for (const r of resp) {
    const href = String(r.href || '');
    if (davPfadNorm(href, url) === selbst) continue;   // der Ordner selbst
    let ps = r.propstat; if (Array.isArray(ps)) ps = ps[0];
    const p = (ps && ps.prop) || {};
    const name = decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() || '');
    if (!name || name.startsWith('.')) continue;
    /* hasOwnProperty statt in (Audit 2026-07-26, B1): der in-Operator liest auch die
       Prototypenkette - ein einziger Eintrag auf Object.prototype haette hier jede Datei zum
       Ordner gemacht. Fuer normale Daten identisches Ergebnis. */
    const istOrdner = !!(p.resourcetype && typeof p.resourcetype === 'object'
      && Object.prototype.hasOwnProperty.call(p.resourcetype, 'collection'));
    if (istOrdner) folders.push({ name });
    else files.push({ name, size: Number(p.getcontentlength) || 0, mime: String(p.getcontenttype || ''), date: datumKurz(p.getlastmodified) });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  files.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { folders, files };
}

/* ------------------------------ Lokalordner-Helfer ------------------------------ */
function localBase(cfg) {
  const p = String(cfg.path || '').trim();
  if (!p) throw new Error('Ordnerpfad fehlt.');
  return path.resolve(p);
}
/* Backup-Zielschreiber (D8): additiv auf eine Verbindung schreiben - genutzt vom
   Sicherungs-Laeufer (server/doc-backup.js) ueber module.exports.intern. */
async function mountOrdner(mountId, segmente, options) {
  const row = mountGetStmt.get(String(mountId));
  if (!row) throw new Error('Verbindung nicht gefunden oder deaktiviert.');
  const cfg = mountCfg(row);
  const signal = options && options.signal;
  if (signal && signal.aborted) throw (signal.reason || new Error('Mount-Lauf abgebrochen.'));
  if (row.kind === 'localdir') { fs.mkdirSync(localZiel(cfg, segmente), { recursive: true }); return; }
  if (mountIstDrive(row)) { await driveMounts.ordner(row.kind, cfg, segmente, mountTokPersist(row, signal)); return; }
  const base = davBase(cfg);
  for (let i = 1; i <= segmente.length; i++) {
    const url = base + segmente.slice(0, i).map(encodeURIComponent).join('/');
    const res = await fetch(url, {
      method: 'MKCOL',
      headers: { Authorization: davAuth(cfg) },
      signal: mountRequestSignal(signal, 60000)
    });
    // 201 angelegt, 405 existiert bereits, 301 Server verlangt Slash-Form - alles in Ordnung
    if (![201, 405, 301].includes(res.status)) throw new Error('Ordner nicht anlegbar (HTTP ' + res.status + '): ' + segmente.slice(0, i).join('/'));
  }
}
async function mountSchreib(mountId, segmente, name, bytes, options) {
  const row = mountGetStmt.get(String(mountId));
  if (!row) throw new Error('Verbindung nicht gefunden oder deaktiviert.');
  const cfg = mountCfg(row);
  const signal = options && options.signal;
  if (signal && signal.aborted) throw (signal.reason || new Error('Mount-Lauf abgebrochen.'));
  if (row.kind === 'localdir') {
    const ziel = localZiel(cfg, segmente.concat(String(name)));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, bytes);
    return;
  }
  if (mountIstDrive(row)) {
    await driveMounts.schreibe(row.kind, cfg, segmente, String(name), bytes, mountTokPersist(row, signal));
    return;
  }
  const url = davBase(cfg) + segmente.concat(String(name)).map(encodeURIComponent).join('/');
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: davAuth(cfg), 'Content-Type': 'application/octet-stream' },
    body: bytes,
    signal: mountRequestSignal(signal, 120000)
  });
  if (![200, 201, 204].includes(res.status)) throw new Error('Upload fehlgeschlagen (HTTP ' + res.status + '): ' + name);
}
function mountInfo(mountId) {
  const row = mountGetStmt.get(String(mountId));
  return row ? { label: row.label, kind: row.kind } : null;
}
function localZiel(cfg, segmente) {
  const base = localBase(cfg);
  const ziel = path.resolve(base, ...segmente);
  if (ziel !== base && !ziel.startsWith(base + path.sep)) throw new Error('Unzulässiger Pfad.');
  return ziel;
}
function localList(cfg, segmente) {
  const ziel = localZiel(cfg, segmente);
  if (!fs.existsSync(ziel) || !fs.statSync(ziel).isDirectory()) throw new Error('Ordner nicht gefunden.');
  const folders = [], files = [];
  for (const e of fs.readdirSync(ziel, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) folders.push({ name: e.name });
    else if (e.isFile()) {
      let st = null; try { st = fs.statSync(path.join(ziel, e.name)); } catch (_e) { continue; }
      files.push({ name: e.name, size: st.size, mime: '', date: datumKurz(st.mtime) });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  files.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { folders, files };
}

async function mountVerbindungstest(kind, cfg) {
  if (kind === 'webdav') { const r = await davList(cfg, []); return { ok: true, folders: r.folders.length, files: r.files.length }; }
  const r = localList(cfg, []);
  return { ok: true, folders: r.folders.length, files: r.files.length };
}

/* Interne Mount-Leser fuer den Import-Eingang (D29, server/doc-backup.js): gleicher
   Dispatch wie die /mounts/:id-Routen, aber Buffer statt HTTP-Response. */
async function mountListe(mountId, segmente, options) {
  const row = mountGetStmt.get(String(mountId));
  if (!row) throw new Error('Verbindung nicht gefunden oder deaktiviert.');
  const cfg = mountCfg(row);
  const signal = options && options.signal;
  if (signal && signal.aborted) throw (signal.reason || new Error('Mount-Lauf abgebrochen.'));
  return row.kind === 'webdav' ? davList(cfg, segmente, options)
    : mountIstDrive(row) ? driveMounts.liste(row.kind, cfg, segmente, mountTokPersist(row, signal))
    : localList(cfg, segmente);
}
async function mountLese(mountId, segmente, options) {
  const row = mountGetStmt.get(String(mountId));
  if (!row) throw new Error('Verbindung nicht gefunden oder deaktiviert.');
  const cfg = mountCfg(row);
  const signal = options && options.signal;
  if (signal && signal.aborted) throw (signal.reason || new Error('Mount-Lauf abgebrochen.'));
  if (row.kind === 'webdav') {
    const url = davBase(cfg) + segmente.map(encodeURIComponent).join('/');
    const r2 = await fetch(url, {
      headers: { Authorization: davAuth(cfg) },
      signal: mountRequestSignal(signal, 120000)
    });
    if (!r2.ok) throw new Error('WebDAV-Antwort ' + r2.status);
    return { bytes: Buffer.from(await r2.arrayBuffer()), mime: r2.headers.get('content-type') || 'application/octet-stream' };
  }
  if (mountIstDrive(row)) return driveMounts.lade(row.kind, cfg, segmente, mountTokPersist(row, signal));
  const ziel = localZiel(cfg, segmente);
  if (!fs.existsSync(ziel) || !fs.statSync(ziel).isFile()) throw new Error('Datei nicht gefunden.');
  return { bytes: fs.readFileSync(ziel), mime: '' };
}

/* ------------------------------ Mount-Routen ------------------------------ */
router.get('/mounts', requireViewDocuments, (req, res) => {
  res.json({ mounts: mountListStmt.all().map(mountPublic), verwalten: darfMountVerwaltung(req) });
});

router.post('/mounts', requireEditDocuments, async (req, res) => {
  if (!darfMountVerwaltung(req)) return res.status(403).json({ error: 'Verbindungen verwaltet nur Admin/Bürostammdaten-Recht.' });
  const kind = String(req.body?.kind || '');
  if (!MOUNT_ARTEN.has(kind)) return res.status(400).json({ error: 'Unbekannte Verbindungsart.' });
  if (kind === 'onedrive' || kind === 'gdrive') return res.status(400).json({ error: 'OneDrive/Google Drive werden über „Verbinden" (Anmeldefenster) eingerichtet.' });
  const label = cleanName(req.body?.label);
  if (!label) return res.status(400).json({ error: 'Bezeichnung fehlt.' });
  const roh = (req.body && req.body.config) || {};
  let cfg;
  if (kind === 'webdav') {
    cfg = { url: String(roh.url || '').trim(), username: String(roh.username || '').trim(), passEnc: '' };
    const pass = String(roh.password || '');
    try { cfg.passEnc = pass ? cryptoHelper.encrypt(pass) : ''; }
    catch (e) { return res.status(500).json({ error: 'Verschlüsselung nicht verfügbar: ' + e.message }); }
  } else {
    cfg = { path: String(roh.path || '').trim() };
  }
  try { await mountVerbindungstest(kind, cfg); }
  catch (e) { return res.status(400).json({ error: 'Verbindungstest fehlgeschlagen: ' + (e && e.message || e) }); }
  const id = crypto.randomUUID();
  mountInsStmt.run({ id, label, kind, configJson: JSON.stringify(cfg), createdBy: req.session.userId });
  res.status(201).json({ id });
});

router.post('/mounts/:id/test', requireViewDocuments, async (req, res) => {
  const row = mountGetStmt.get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  try { res.json(await mountVerbindungstest(row.kind, mountCfg(row))); }
  catch (e) { res.status(400).json({ error: String(e && e.message || e) }); }
});

router.delete('/mounts/:id', requireEditDocuments, (req, res) => {
  if (!darfMountVerwaltung(req)) return res.status(403).json({ error: 'Verbindungen verwaltet nur Admin/Bürostammdaten-Recht.' });
  mountDelStmt.run(String(req.params.id));
  res.json({ ok: true });
});

router.get('/mounts/:id/list', requireViewDocuments, async (req, res) => {
  const row = mountGetStmt.get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  const seg = mountSegmente(req.query.pfad);
  try {
    const r = row.kind === 'webdav' ? await davList(mountCfg(row), seg)
      : mountIstDrive(row) ? await driveMounts.liste(row.kind, mountCfg(row), seg, mountTokPersist(row))
      : localList(mountCfg(row), seg);
    res.json(r);
  } catch (e) { res.status(400).json({ error: String(e && e.message || e) }); }
});

router.get('/mounts/:id/file', requireViewDocuments, async (req, res) => {
  const row = mountGetStmt.get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  const seg = mountSegmente(req.query.pfad);
  if (!seg.length) return res.status(400).json({ error: 'Dateipfad fehlt.' });
  const name = seg[seg.length - 1];
  try {
    if (row.kind === 'webdav') {
      const cfg = mountCfg(row);
      const url = davBase(cfg) + seg.map(encodeURIComponent).join('/');
      const r2 = await fetch(url, { headers: { Authorization: davAuth(cfg) }, signal: AbortSignal.timeout(60000) });
      if (r2.status === 404) return res.status(404).json({ error: 'Datei nicht gefunden.' });
      if (!r2.ok) return res.status(400).json({ error: 'WebDAV-Antwort ' + r2.status });
      res.setHeader('Content-Type', r2.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('X-Filename', encodeURIComponent(name));
      if (String(req.query.download || '') === '1') res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      const { Readable } = require('stream');
      return Readable.fromWeb(r2.body).pipe(res);
    }
    if (mountIstDrive(row)) {
      const r3 = await driveMounts.lade(row.kind, mountCfg(row), seg, mountTokPersist(row));
      res.setHeader('Content-Type', r3.mime || 'application/octet-stream');
      res.setHeader('X-Filename', encodeURIComponent(name));
      if (String(req.query.download || '') === '1') res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      return res.send(r3.bytes);
    }
    const ziel = localZiel(mountCfg(row), seg);
    if (!fs.existsSync(ziel) || !fs.statSync(ziel).isFile()) return res.status(404).json({ error: 'Datei nicht gefunden.' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Filename', encodeURIComponent(name));
    if (String(req.query.download || '') === '1') res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    fs.createReadStream(ziel).pipe(res);
  } catch (e) { res.status(400).json({ error: String(e && e.message || e) }); }
});

router.post('/mounts/:id/upload', requireEditDocuments, async (req, res) => {
  const row = mountGetStmt.get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  const seg = mountSegmente(req.body?.pfad);
  const name = cleanName(req.body?.fileName);
  if (!name) return res.status(400).json({ error: 'Dateiname fehlt oder ist ungültig.' });
  let bytes;
  try { bytes = Buffer.from(String(req.body?.dataBase64 || ''), 'base64'); } catch (_e) { return res.status(400).json({ error: 'dataBase64 ist nicht lesbar.' }); }
  if (!bytes.length) return res.status(400).json({ error: 'Leere Datei.' });
  /* Upload zur EXTERNEN Verbindung: laeuft weiterhin ueber den JSON-Koerper (der Inhalt muss
     ohnehin komplett im Speicher liegen, um ihn an den Anbieter weiterzureichen) - daher gilt
     hier die Grenze des alten Wegs, nicht die 1024 MB des Strom-Upload. */
  if (bytes.length > MAX_JSON_FILE) return res.status(413).json({ error: zuGrossText(bytes.length, MAX_JSON_FILE, 'Für die externe Verbindung ist das die Obergrenze.') });
  if (bytes.length > MAX_FILE) return res.status(413).json({ error: zuGrossText(bytes.length, MAX_FILE) });
  try {
    if (row.kind === 'webdav') {
      const cfg = mountCfg(row);
      const url = davBase(cfg) + seg.concat([name]).map(encodeURIComponent).join('/');
      const r2 = await fetch(url, { method: 'PUT', headers: { Authorization: davAuth(cfg) }, body: bytes, signal: AbortSignal.timeout(120000) });
      if (!r2.ok && r2.status !== 201 && r2.status !== 204) return res.status(400).json({ error: 'WebDAV-Antwort ' + r2.status });
      return res.status(201).json({ ok: true, name });
    }
    if (mountIstDrive(row)) {
      await driveMounts.schreibe(row.kind, mountCfg(row), seg, name, bytes, mountTokPersist(row));
      return res.status(201).json({ ok: true, name });
    }
    const zielDir = localZiel(mountCfg(row), seg);
    if (!fs.existsSync(zielDir) || !fs.statSync(zielDir).isDirectory()) return res.status(404).json({ error: 'Zielordner nicht gefunden.' });
    fs.writeFileSync(path.join(zielDir, name), bytes);
    res.status(201).json({ ok: true, name });
  } catch (e) { res.status(400).json({ error: String(e && e.message || e) }); }
});

/* ---------- D11: Versionsverlauf (alte Fassung beim Ueberschreiben behalten) ---------- */
const verInsStmt = db.prepare(`
  INSERT INTO doc_versions
    (id, file_id, name, mime_type, size, sha256, ersetzt_von, storage_relpath)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const verListStmt = db.prepare(
  'SELECT * FROM doc_versions WHERE file_id = ? ORDER BY created_at DESC, rowid DESC'
);
const verGetStmt = db.prepare('SELECT * FROM doc_versions WHERE id = ? AND file_id = ?');
function versionBlobPfad(ver, fileRow) {
  if (ver && ver.storage_relpath) {
    try {
      const p = joinRoot(documentStorage.root(), ver.storage_relpath);
      const stat = fs.lstatSync(p);
      if (stat.isFile() && !stat.isSymbolicLink()) return p;
    } catch (_error) { /* Legacy-Fallback */ }
  }
  return findBlobPath({ id: ver.id, area: fileRow.area, case_id: fileRow.case_id });
}
function versionSichern(fileRow, userId, username) {
  const blob = findBlobPath(fileRow);
  if (!blob) throw new Error('Die bisherige Primärdatei ist nicht auffindbar; sie wurde nicht ersetzt.');
  const vid = crypto.randomUUID();
  // Die Versionskennung ist zugleich die Sidecar-Kennung. Mehrere Versionen
  // derselben Datei überschreiben dadurch nicht mehr denselben Beipackzettel.
  const copied = documentStorage.copyToManagement(
    Object.assign({}, fileRow, { id: vid }), 'Versionen', fileRow.id,
    `${vid.slice(0, 8)} ${fileRow.name || 'Version'}`
  );
  verInsStmt.run(
    vid, fileRow.id, fileRow.name, fileRow.mime_type || '',
    copied.size, copied.sha256, String(username || ''), copied.storageRelpath
  );
  return vid;
}

function versionenDeckeln(fileRow, protectedVersionId) {
  /* Erst NACH einem erfolgreichen Ersetzen deckeln. Ein fehlgeschlagener
     Restore/Commit darf niemals nebenbei eine vorhandene Version entfernen. */
  const alle = verListStmt.all(fileRow.id);
  const protectedRow = alle.find((version) => version.id === protectedVersionId);
  const behalten = (protectedRow
    ? [protectedRow, ...alle.filter((version) => version.id !== protectedVersionId)]
    : alle).slice(0, 20);
  const behaltenIds = new Set(behalten.map((version) => version.id));
  for (const alt of alle.filter((version) => !behaltenIds.has(version.id))) {
    const p = versionBlobPfad(alt, fileRow);
    if (p) {
      try { fs.unlinkSync(p); } catch (_e) { /* weg ist weg */ }
      try { fs.unlinkSync(documentStorage.sidecarPath(p, alt.id)); } catch (_e) { /* optional */ }
      // Übergangsbestand vor der Korrektur verwendete fälschlich file_id.
      try { fs.unlinkSync(documentStorage.sidecarPath(p, alt.file_id)); } catch (_e) { /* optional */ }
    }
    try { db.prepare('DELETE FROM doc_versions WHERE id = ?').run(alt.id); }
    catch (_error) { /* Die neue, sichere Version bleibt davon unberührt. */ }
  }
}

function regulaereDatei(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (_error) { return false; }
}

function fehlversuchName(row, label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp} ${label || 'fehlgeschlagen'} ${row.name || 'Datei'}`;
}

/*
 * Auch eine abgelehnte neue Fassung wird nicht still gelöscht. Sie wandert in
 * den technischen Bereich und bleibt dort für Integritätslauf/Support sichtbar.
 * Scheitert selbst dieser Weg, bleibt sie als versteckte .part-Datei am Ort.
 */
function fehlversuchBewahren(filePath, row, label, meta) {
  if (!regulaereDatei(filePath)) return null;
  const failedId = 'failed-' + crypto.randomUUID();
  const info = Object.assign({}, row, meta || {}, { id: failedId });
  try {
    return documentStorage.stashPathToManagement(
      filePath, info, 'Fehlgeschlagene Ersetzungen', row.id,
      fehlversuchName(row, label)
    );
  } catch (error) {
    const fallback = path.join(
      path.dirname(filePath),
      `.ablage-fehlgeschlagen-${crypto.randomUUID()}.part`
    );
    try {
      fs.renameSync(filePath, fallback);
      return { filePath: fallback, storageRelpath: '', sidecarError: String(error && error.message || error) };
    } catch (_fallbackError) {
      return { filePath, storageRelpath: '', sidecarError: String(error && error.message || error) };
    }
  }
}

function altePrimaerdateiWiederherstellen(row, primaryPath, rollbackPath, versionRow) {
  const expectedHash = String((versionRow && versionRow.sha256) || row.sha256 || '');
  if (regulaereDatei(primaryPath) && expectedHash
    && documentStorage.sha256File(primaryPath) !== expectedHash) {
    fehlversuchBewahren(primaryPath, row, 'neue Fassung nach Rücknahme');
  }

  if (!regulaereDatei(primaryPath)) {
    if (rollbackPath && regulaereDatei(rollbackPath)) {
      try { fs.renameSync(rollbackPath, primaryPath); }
      catch (_renameError) { /* verifizierte Versionskopie ist der zweite Rückweg */ }
    }
  }

  if (!regulaereDatei(primaryPath)) {
    const versionPath = versionRow && versionBlobPfad(versionRow, row);
    if (!versionPath) throw new Error('Rückweg fehlgeschlagen: die gesicherte Version ist nicht auffindbar.');
    const temp = path.join(path.dirname(primaryPath), `.ablage-rueckweg-${crypto.randomUUID()}.part`);
    fs.copyFileSync(versionPath, temp, fs.constants.COPYFILE_EXCL);
    if (expectedHash && documentStorage.sha256File(temp) !== expectedHash) {
      throw new Error('Rückweg fehlgeschlagen: die Prüfsumme der gesicherten Version weicht ab.');
    }
    fs.renameSync(temp, primaryPath);
  }

  const actualHash = documentStorage.sha256File(primaryPath);
  if (expectedHash && actualHash !== expectedHash) {
    throw new Error('Rückweg fehlgeschlagen: die bisherige Primärdatei konnte nicht verifiziert werden.');
  }
  try {
    documentStorage.writeSidecar(
      Object.assign({}, row, {
        size: fs.statSync(primaryPath).size,
        sha256: expectedHash || actualHash
      }),
      primaryPath
    );
  } catch (_sidecarError) {
    // Ein absichtlich blockierter/defekter Sidecar darf den nachgewiesenen
    // Dateiinhalt samt unveränderter doc_files-Zeile nicht erneut gefährden.
  }
  return primaryPath;
}

function ersetzungsziel(row, primaryPath) {
  const name = uniqueName(row.area, row.case_id, String(row.folder_id || ''), row.name, row.id);
  return documentStorage.targetFor(
    row.area, row.case_id, String(row.folder_id || ''), name, primaryPath
  );
}

/*
 * Gemeinsamer Commit-Punkt für JSON, Strom, WebDAV, Zwei-Wege-Abgleich und
 * Versions-Restore. Vorher bleibt die alte Primärdatei unangetastet. Nach einem
 * Fehler wird die DB-Transaktion zurückgerollt und der alte, per Version
 * verifizierte Inhalt physisch zurückgesetzt.
 */
function dateiMitTempErsetzen(row, tempPath, options) {
  const opt = options || {};
  const current = fileGetStmt.get(String(row && row.id || ''));
  if (!current || current.deleted_at) throw new Error('Datei nicht gefunden.');
  const primaryPath = findBlobPath(current);
  if (!primaryPath) throw new Error('Die bisherige Primärdatei ist nicht auffindbar.');
  const target = opt.target || ersetzungsziel(current, primaryPath);
  if (!target || !target.filePath || !target.storageRelpath) {
    throw new Error('Das Ziel der neuen Fassung ist ungültig.');
  }
  if (!regulaereDatei(tempPath)) throw new Error('Die vorbereitete neue Fassung ist nicht auffindbar.');
  if (path.dirname(path.resolve(tempPath)) !== path.dirname(path.resolve(target.filePath))) {
    throw new Error('Neue Fassung und Ziel müssen im selben Ordner vorbereitet werden.');
  }

  const preparedStat = fs.statSync(tempPath);
  const newSha = String(opt.sha256 || '') || documentStorage.sha256File(tempPath);
  const newMime = String(opt.mimeType || current.mime_type || 'application/octet-stream').slice(0, 120);
  const newOcr = opt.ocrStatus || (brauchtTextVon(target.name || current.name, newMime) ? 'pending' : 'none');
  const samePath = path.resolve(primaryPath) === path.resolve(target.filePath);
  let rollbackPath = '';
  let published = false;
  let versionId = '';

  try {
    versionId = versionSichern(current, opt.userId, opt.username);
    if (samePath) {
      const candidateRollback = path.join(
        path.dirname(primaryPath),
        `.ablage-rueckweg-${crypto.randomUUID()}.part`
      );
      fs.renameSync(primaryPath, candidateRollback);
      rollbackPath = candidateRollback;
    }
    documentStorage.publishTemp(tempPath, target.filePath);
    published = true;
    const targetStat = fs.statSync(target.filePath);

    db.transaction(() => {
      db.prepare(`
        UPDATE doc_files
           SET size=?, sha256=?, mime_type=?, pages=0, ocr_status=?,
               updated_at=datetime('now')
         WHERE id=?
      `).run(targetStat.size, newSha, newMime, newOcr, current.id);
      fileStorageStmt.run({
        id: current.id,
        name: target.name || current.name,
        nameKey: documentNames.vergleichsschluessel(target.name || current.name),
        folderId: current.folder_id,
        storageRelpath: target.storageRelpath,
        storageDev: String(targetStat.dev),
        storageIno: String(targetStat.ino)
      });
      textDelStmt.run(current.id);
      documentStorage.writeSidecar(fileGetStmt.get(current.id), target.filePath);
    })();

    const versionRow = verGetStmt.get(versionId, current.id);
    const oldDuplicate = samePath ? rollbackPath : primaryPath;
    if (regulaereDatei(oldDuplicate)) {
      try {
        const oldHash = documentStorage.sha256File(oldDuplicate);
        if (versionRow && oldHash === versionRow.sha256) {
          fs.unlinkSync(oldDuplicate);
          if (!samePath) {
            try { fs.unlinkSync(documentStorage.sidecarPath(oldDuplicate, current.id)); }
            catch (_sidecarError) { /* technische Altspur */ }
          }
        } else {
          fehlversuchBewahren(oldDuplicate, current, 'abweichende alte Primärdatei');
        }
      } catch (_cleanupError) {
        fehlversuchBewahren(oldDuplicate, current, 'nicht bereinigte alte Primärdatei');
      }
    }
    try { versionenDeckeln(current, versionId); }
    catch (_versionLimitError) { /* Aufbewahrung darf den erfolgreichen Commit nicht zurücknehmen. */ }
    return {
      ok: true,
      versionId,
      versionen: verListStmt.all(current.id).length,
      size: targetStat.size,
      sha256: newSha,
      ocrStatus: newOcr,
      filePath: target.filePath,
      storageRelpath: target.storageRelpath
    };
  } catch (error) {
    const versionRow = versionId ? verGetStmt.get(versionId, current.id) : null;
    if (regulaereDatei(tempPath)) {
      fehlversuchBewahren(tempPath, current, 'nicht publizierte neue Fassung', {
        size: preparedStat.size,
        sha256: newSha,
        mime_type: newMime
      });
    }
    if (published && regulaereDatei(target.filePath)) {
      fehlversuchBewahren(target.filePath, current, 'zurückgenommene neue Fassung', {
        size: preparedStat.size,
        sha256: newSha,
        mime_type: newMime
      });
      if (!samePath) {
        try { fs.unlinkSync(documentStorage.sidecarPath(target.filePath, current.id)); }
        catch (_sidecarError) { /* optional */ }
      }
    }
    try {
      if (rollbackPath || (published && samePath)) {
        altePrimaerdateiWiederherstellen(current, primaryPath, rollbackPath, versionRow);
      } else if (!regulaereDatei(primaryPath)) {
        throw new Error('Rückweg fehlgeschlagen: die zuvor unberührte Primärdatei ist nicht auffindbar.');
      }
    } catch (recoveryError) {
      const combined = new Error(
        `${error && error.message || error}; zusätzlich scheiterte der Rückweg: `
        + `${recoveryError && recoveryError.message || recoveryError}`
      );
      combined.cause = error;
      throw combined;
    }
    throw error;
  }
}

function dateiMitBufferErsetzen(row, bytes, options) {
  const current = fileGetStmt.get(String(row && row.id || ''));
  if (!current) throw new Error('Datei nicht gefunden.');
  const primaryPath = findBlobPath(current);
  if (!primaryPath) throw new Error('Die bisherige Primärdatei ist nicht auffindbar.');
  const target = ersetzungsziel(current, primaryPath);
  fs.mkdirSync(target.directory, { recursive: true });
  const temp = path.join(target.directory, `.ablage-ersetzen-${crypto.randomUUID()}.part`);
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx' });
    return dateiMitTempErsetzen(current, temp, Object.assign({}, options, {
      target,
      size: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    }));
  } catch (error) {
    if (regulaereDatei(temp)) {
      fehlversuchBewahren(temp, current, 'beim Vorbereiten gescheiterte neue Fassung');
    }
    throw error;
  }
}

function dateiMitPfadErsetzen(row, sourcePath, options) {
  const current = fileGetStmt.get(String(row && row.id || ''));
  if (!current) throw new Error('Datei nicht gefunden.');
  if (!regulaereDatei(sourcePath)) throw new Error('Quellfassung ist nicht auffindbar.');
  const primaryPath = findBlobPath(current);
  if (!primaryPath) throw new Error('Die bisherige Primärdatei ist nicht auffindbar.');
  const target = ersetzungsziel(current, primaryPath);
  fs.mkdirSync(target.directory, { recursive: true });
  const temp = path.join(target.directory, `.ablage-restore-${crypto.randomUUID()}.part`);
  try {
    fs.copyFileSync(sourcePath, temp, fs.constants.COPYFILE_EXCL);
    return dateiMitTempErsetzen(current, temp, Object.assign({}, options, {
      target,
      size: fs.statSync(temp).size,
      sha256: documentStorage.sha256File(temp)
    }));
  } catch (error) {
    if (regulaereDatei(temp)) {
      fehlversuchBewahren(temp, current, 'beim Restore vorbereitete Fassung');
    }
    throw error;
  }
}

function versionenPurge() {
  const alte = db.prepare("SELECT v.*, f.area, f.case_id FROM doc_versions v LEFT JOIN doc_files f ON f.id = v.file_id WHERE v.created_at < datetime('now', ?)").all('-' + trashTage() + ' days');
  for (const v of alte) {
    const p = versionBlobPfad(v, { area: v.area || 'office', case_id: v.case_id });
    if (p) {
      try { fs.unlinkSync(p); } catch (_e) { /* schon weg */ }
      try { fs.unlinkSync(documentStorage.sidecarPath(p, v.id)); } catch (_e) { /* optional */ }
      try { fs.unlinkSync(documentStorage.sidecarPath(p, v.file_id)); } catch (_e) { /* Alt-Sidecar */ }
    }
    db.prepare('DELETE FROM doc_versions WHERE id = ?').run(v.id);
  }
}
router.get('/files/:id/versionen', requireViewDocuments, (req, res) => {
  const row = fileGetStmt.get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  versionenPurge();
  res.json({ versionen: verListStmt.all(row.id).map((v) => ({ id: v.id, name: v.name, size: v.size, createdAt: v.created_at, von: v.ersetzt_von })) });
});
router.get('/files/:id/versionen/:vid/download', requireViewDocuments, (req, res) => {
  const row = fileGetStmt.get(String(req.params.id));
  const ver = row && verGetStmt.get(String(req.params.vid), row.id);
  if (!ver) return res.status(404).json({ error: 'Version nicht gefunden.' });
  const p = versionBlobPfad(ver, row);
  if (!p) return res.status(404).json({ error: 'Versionsinhalt nicht auffindbar.' });
  res.setHeader('Content-Type', ver.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(ver.name || 'Version')}`);
  fs.createReadStream(p).pipe(res);
});
router.post('/files/:id/versionen/:vid/restore', requireEditDocuments, (req, res) => {
  const row = fileGetStmt.get(String(req.params.id));
  const ver = row && verGetStmt.get(String(req.params.vid), row.id);
  if (!ver) return res.status(404).json({ error: 'Version nicht gefunden.' });
  const vp = versionBlobPfad(ver, row);
  if (!vp) return res.status(404).json({ error: 'Versionsinhalt nicht auffindbar.' });
  try {
    const result = dateiMitPfadErsetzen(row, vp, {
      userId: req.session.userId,
      username: req.session.displayName || req.session.username || '',
      mimeType: ver.mime_type || row.mime_type,
      ocrStatus: row.ocr_status === 'none' ? 'none' : 'pending'
    });
    res.json({ ok: true, versionen: result.versionen, sha256: result.sha256 });
  } catch (error) {
    res.status(500).json({
      error: 'Die Version konnte nicht wiederhergestellt werden; die bisherige Primärdatei bleibt erreichbar: '
        + (error && error.message || error)
    });
  }
});
router.post('/files/:id/ersetzen', requireEditDocuments, (req, res) => {
  const row = fileGetStmt.get(String(req.params.id));
  if (!row || row.deleted_at) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  let bytes;
  try { bytes = Buffer.from(String(req.body?.dataBase64 || ''), 'base64'); } catch (_e) { return res.status(400).json({ error: 'dataBase64 ist nicht lesbar.' }); }
  if (!bytes.length) return res.status(400).json({ error: 'Leere Datei.' });
  if (bytes.length > MAX_JSON_FILE) return res.status(413).json({ error: zuGrossText(bytes.length, MAX_JSON_FILE, STROM_HINWEIS) });
  if (bytes.length > MAX_FILE) return res.status(413).json({ error: zuGrossText(bytes.length, MAX_FILE) });
  try {
    const result = dateiMitBufferErsetzen(row, bytes, {
      userId: req.session.userId,
      username: req.session.displayName || req.session.username || '',
      mimeType: String(req.body?.mimeType || row.mime_type || 'application/octet-stream')
    });
    res.json({ ok: true, versionen: result.versionen, sha256: result.sha256 });
  } catch (error) {
    res.status(500).json({
      error: 'Die Datei wurde nicht ersetzt; die bisherige Primärdatei bleibt erreichbar: '
        + (error && error.message || error)
    });
  }
});
router.patch('/files/:id/note', requireEditDocuments, (req, res) => {
  const row = fileGetStmt.get(String(req.params.id));
  if (!row || row.deleted_at) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  const note = String(req.body?.note || '').slice(0, 2000);
  db.prepare('UPDATE doc_files SET note = ? WHERE id = ?').run(note, row.id);
  res.json({ ok: true, note });
});

/* ---------- D10: Sammel-ZIP, Ordner-ZIP, Tags, OCR-Warteliste, Duplikate, Speicher, Protokoll ---------- */
function zipAntwort(res, eintraege, dateiname) {
  const os = require('os');
  const tmp = path.join(os.tmpdir(), 'dok-zip-' + crypto.randomUUID() + '.zip');
  const { zipSchreiben } = require('../backup/document-backup');   /* lazy - kein Zyklus (Muster D8) */
  const erg = zipSchreiben(tmp, eintraege);
  if (erg.fehlend) {
    try { fs.unlinkSync(tmp); } catch (_e) { /* tmp */ }
    return res.status(409).json({
      error: `Das Paket wurde nicht erstellt: ${erg.fehlend} Datei(en) wurden während des Lesens nicht gefunden.`,
      missingCount: erg.fehlend,
      expectedCount: eintraege.length
    });
  }
  res.download(tmp, dateiname, () => { try { fs.unlinkSync(tmp); } catch (_e) { /* tmp */ } });
  return erg;
}
function zipStamp() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ---------- Vollständiges Fall-Übergabepaket nach § 1872 BGB ----------
   Bewusst serverseitig: Das Paket wird erst erzeugt, nachdem JEDE in doc_files
   verzeichnete Datei tatsächlich geöffnet und gehasht werden konnte. Fehlt auch
   nur eine, gibt es 409 samt sichtbarer Liste und ausdrücklich kein Teil-ZIP. */
function handoverJson(raw) {
  try { return JSON.parse(String(raw == null ? '' : raw)); }
  catch (_e) {
    // Beschädigtes Alt-JSON niemals still zu {} machen: Der Rohwert bleibt im
    // Übergabepaket erhalten und ist damit später noch rekonstruierbar.
    return { _ungueltigesJson: true, rohwert: String(raw == null ? '' : raw) };
  }
}

function handoverFolderParts(rows) {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const cache = new Map([['', []]]);
  function parts(folderId, visiting) {
    const id = String(folderId || '');
    if (cache.has(id)) return cache.get(id);
    const trail = visiting || new Set();
    if (trail.has(id)) {
      const error = new Error('Zyklische Ordnerzuordnung in der Fallakte.');
      error.code = 'HANDOVER_FOLDER_CYCLE';
      throw error;
    }
    const row = byId.get(id);
    if (!row) {
      const unknown = [`_Unzugeordnet (${id.slice(0, 8) || 'ohne Kennung'})`];
      cache.set(id, unknown);
      return unknown;
    }
    const nextTrail = new Set(trail);
    nextTrail.add(id);
    const result = parts(row.parent_id, nextTrail).concat(String(row.name || 'Unbenannt'));
    cache.set(id, result);
    return result;
  }
  return parts;
}

function handoverCaseData(caseRow, generatedAt, documents) {
  return {
    format: 'Betreuungsbuero-Falldaten',
    schemaVersion: 1,
    exportedAt: generatedAt.toISOString(),
    case: {
      id: String(caseRow.id),
      label: String(caseRow.label || ''),
      fileNumber: String(caseRow.file_number || ''),
      createdAt: String(caseRow.created_at || ''),
      archived: !!caseRow.archived,
      archivedAt: String(caseRow.archived_at || ''),
      stammdatenUpdatedAt: String(caseRow.stammdaten_updated_at || '')
    },
    stammdaten: (() => {
      const sd = handoverJson(caseRow.stammdaten_json);
      /* Audit 30.08.2026: der Empfaenger einer Falluebergabe hat unser Personenregister
         nicht - ohne Begleitnamen waere die Personen-ID in rechtlicherBetreuer/vertretung
         fuer ihn unaufloesbar (wer den Fall fuehrte, ginge bei der Uebergabe verloren).
         Die ID bleibt erhalten (Rueckspielung in DIESELBE Installation), der Name kommt
         additiv dazu. */
      try {
        const personen = require('../office/persons-routes');
        for (const feld of ['rechtlicherBetreuer', 'vertretung']) {
          if (!sd || !sd[feld]) continue;
          const name = personen.personAnzeigeName(sd[feld]);
          if (name && name !== sd[feld]) sd[`${feld}Name`] = name;
        }
      } catch (_e) { /* Uebergabe bleibt roh, wenn die Aufloesung scheitert */ }
      return sd;
    })(),
    reports: handoverReportsStmt.all(caseRow.id).map((row) => ({
      reportId: String(row.report_id || ''),
      data: handoverJson(row.data_json),
      updatedAt: String(row.updated_at || '')
    })),
    dokuEntries: handoverDokuStmt.all(caseRow.id).map((row) => ({
      id: String(row.id || ''),
      data: handoverJson(row.data_json),
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || '')
    })),
    contacts: handoverContactsStmt.all(caseRow.id).map((row) => ({
      id: String(row.id || ''),
      data: handoverJson(row.data_json),
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || '')
    })),
    documents: documents.map((document) => ({
      fileId: document.fileId,
      path: document.path,
      name: document.name,
      mimeType: document.mimeType,
      size: document.size,
      sha256: document.sha256
    }))
  };
}

function handoverCompactStamp(date) {
  const year = String(date.getFullYear()).slice(-2);
  return year + String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0');
}

function handoverDownloadName(label, date) {
  return documentNames.normalisiereDateiname(
    `Falluebergabe_${String(label || 'Fall')}_${handoverCompactStamp(date)}.zip`,
    { maxBytes: 180, fallback: 'Falluebergabe.zip' }
  ).name;
}

function handoverContentDisposition(filename) {
  const fallback = String(filename)
    .replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (character) =>
    '%' + character.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function handoverFinderGuard(caseId) {
  /*
   * Ausschließlich lesen: apply() wird hier absichtlich nie aufgerufen. Ein
   * Übergabepaket darf weder Finder-Löschungen noch andere Indexänderungen
   * nebenbei bestätigen. Neue Dateien des angefragten Falls blockieren das
   * Paket sichtbar, bis der reguläre Finder-Abgleich sie eingelesen hat.
   */
  const scan = documentFinderSync().scan();
  const wantedCaseId = String(caseId || '');
  let expectedRoot = '';
  try {
    expectedRoot = String(documentStorage.caseRootInfo(wantedCaseId, false).storageRelpath || '');
  } catch (_error) { /* Fall wurde bereits separat geprüft. */ }
  const observedRoots = (scan.caseRoots || [])
    .filter((item) => String(item.caseId || '') === wantedCaseId)
    .map((item) => String(item.storageRelpath || ''))
    .filter(Boolean);
  const roots = [...new Set([expectedRoot, ...observedRoots].filter(Boolean))];
  const pathKey = (value) => String(value || '').replace(/\\/g, '/')
    .normalize('NFC').toLocaleLowerCase('de-DE').replace(/\/+$/, '');
  const withinRoot = (value) => {
    const actual = pathKey(value);
    return roots.some((root) => {
      const prefix = pathKey(root);
      return actual === prefix || actual.startsWith(prefix + '/');
    });
  };
  const belongsToCase = (finding) =>
    String((finding.detail && finding.detail.caseId) || '') === wantedCaseId
    || withinRoot(finding.storageRelpath);

  const byPath = new Map();
  for (const finding of scan.findings || []) {
    if (!belongsToCase(finding)
      || !['new_file', 'file_outside_register'].includes(String(finding.kind || ''))) continue;
    const storageRelpath = String(finding.storageRelpath || '');
    if (!storageRelpath || byPath.has(pathKey(storageRelpath))) continue;
    byPath.set(pathKey(storageRelpath), {
      path: storageRelpath,
      name: String((finding.detail && finding.detail.name) || path.posix.basename(storageRelpath)),
      size: Number((finding.detail && finding.detail.size) || 0),
      reason: finding.kind === 'file_outside_register' ? 'outside_register' : 'not_indexed'
    });
  }

  const incompleteKinds = new Set([
    'scan_error',
    'case_root_collision',
    'case_root_conflict',
    'case_sidecar_invalid',
    'unknown_case_root',
    'file_identity_collision',
    'file_identity_reused',
    'filesystem_collision',
    'symlink_ignored',
    'symlink_or_special_ignored',
    'special_file_ignored'
  ]);
  const incomplete = (scan.findings || [])
    .filter((finding) => belongsToCase(finding) && incompleteKinds.has(String(finding.kind || '')))
    .map((finding) => ({
      kind: String(finding.kind || ''),
      path: String(finding.storageRelpath || '')
    }));

  // Existiert der erwartete Fallordner, muss der Finder-Lauf ihn eindeutig
  // erkannt haben; sonst könnte er gerade dort neue Dateien übersehen.
  if (expectedRoot) {
    const expectedPath = joinRoot(documentStorage.root(), expectedRoot);
    let expectedExists = false;
    try {
      const stat = fs.lstatSync(expectedPath);
      expectedExists = stat.isDirectory() && !stat.isSymbolicLink();
    } catch (_error) { /* reine Legacy-Akte ohne Klarname-Fallordner */ }
    if (expectedExists && observedRoots.length !== 1) {
      incomplete.push({ kind: 'case_scope_not_unique', path: expectedRoot });
    }
  }

  return {
    scannedAt: scan.scannedAt,
    unindexed: [...byPath.values()],
    incomplete
  };
}

router.get('/falluebergabe-zip', requireViewDocuments, async (req, res, next) => {
  try {
    await operationCoordinator.runExclusive(
      'Fallübergabepaket ' + String(req.query.caseId || ''),
      async () => {
  const caseId = String(req.query.caseId || '');
  if (!caseId) {
    return res.status(400).json({ code: 'CASE_ID_REQUIRED', error: 'caseId erforderlich.' });
  }
  const caseRow = handoverCaseStmt.get(caseId);
  if (!caseRow) {
    return res.status(404).json({ code: 'CASE_NOT_FOUND', error: 'Fall nicht gefunden.' });
  }
  if (!fallErlaubt(req.session, caseId)) {
    return res.status(403).json({ code: 'CASE_FORBIDDEN', error: 'Keine Berechtigung für diese Fallakte.' });
  }
  // Vor einer rechtlichen Herausgabe wird die lesbare Sicherung im Register 01
  // ohne Entprellzeit auf den aktuellen Stand gebracht.
  try {
    const materializations = require('./materializations').current();
    if (materializations) {
      const materializationResult = materializations.runCase(caseId);
      const materializationErrors = (materializationResult || []).filter((entry) => entry && entry.error);
      if (materializationErrors.length) {
        throw new Error(materializationErrors[0].error);
      }
    }
  } catch (error) {
    return res.status(409).json({
      code: 'HANDOVER_MATERIALIZATION_FAILED',
      error: 'Das Übergabepaket wurde nicht erstellt: Die Falldatensicherung konnte nicht aktualisiert werden.',
      detail: String(error && error.message || error)
    });
  }

  let finderGuard;
  try {
    finderGuard = handoverFinderGuard(caseId);
  } catch (error) {
    return res.status(409).json({
      code: 'HANDOVER_FINDER_SCAN_FAILED',
      error: 'Das Übergabepaket wurde nicht erstellt: Der Finder-Abgleich für die Fallakte konnte nicht vollständig gelesen werden.',
      caseId,
      detail: String(error && error.message || error)
    });
  }
  if (finderGuard.unindexed.length) {
    return res.status(409).json({
      code: 'HANDOVER_UNINDEXED_FILES',
      error: `Das Übergabepaket wurde nicht erstellt: ${finderGuard.unindexed.length} Finder-Datei(en) der Fallakte sind noch nicht im Index.`,
      caseId,
      scannedAt: finderGuard.scannedAt,
      unindexedCount: finderGuard.unindexed.length,
      unindexed: finderGuard.unindexed
    });
  }
  if (finderGuard.incomplete.length) {
    return res.status(409).json({
      code: 'HANDOVER_FINDER_SCAN_INCOMPLETE',
      error: 'Das Übergabepaket wurde nicht erstellt: Der Finder-Abgleich konnte die Fallakte nicht eindeutig und vollständig prüfen.',
      caseId,
      scannedAt: finderGuard.scannedAt,
      findings: finderGuard.incomplete
    });
  }

  const folderRows = folderAllStmt.all('case', caseId);
  const folderParts = handoverFolderParts(folderRows);
  const fileRows = db.prepare(
    "SELECT * FROM doc_files WHERE area='case' AND case_id=? AND deleted_at='' ORDER BY name COLLATE NOCASE"
  ).all(caseId);
  const documents = [];
  const missing = [];
  const usedPaths = new Map();

  try {
    for (const row of fileRows) {
      const logicalPath = handoverPackage.safeZipPath(
        ['Fallakte', ...folderParts(row.folder_id), String(row.name || 'Unbenannt')].join('/')
      );
      const pathKey = logicalPath.normalize('NFC').toLocaleLowerCase('de-DE');
      if (usedPaths.has(pathKey)) {
        const error = new Error(`Mehrdeutiger Dateipfad im Übergabepaket: ${logicalPath}`);
        error.code = 'HANDOVER_PATH_COLLISION';
        error.paths = [usedPaths.get(pathKey), logicalPath];
        throw error;
      }
      usedPaths.set(pathKey, logicalPath);

      const sourcePath = findBlobPath(row);
      let stat = null;
      let sha256 = '';
      if (sourcePath) {
        try {
          const before = fs.statSync(sourcePath);
          if (before.isFile()) sha256 = handoverPackage.sha256File(sourcePath);
          stat = fs.statSync(sourcePath);
          if (before.dev !== stat.dev || before.ino !== stat.ino ||
              before.size !== stat.size || before.mtimeMs !== stat.mtimeMs) {
            const changed = new Error('Datei während der Prüfsummenbildung verändert.');
            changed.code = 'HANDOVER_SOURCE_CHANGED';
            changed.path = logicalPath;
            throw changed;
          }
        } catch (error) {
          if (error && error.code === 'HANDOVER_SOURCE_CHANGED') throw error;
          stat = null;
          sha256 = '';
        }
      }
      if (!sourcePath || !stat || !stat.isFile() || !sha256) {
        missing.push({
          fileId: String(row.id),
          name: String(row.name || ''),
          path: logicalPath,
          reason: 'file_missing'
        });
        continue;
      }
      documents.push({
        fileId: String(row.id),
        path: logicalPath,
        name: String(row.name || ''),
        mimeType: String(row.mime_type || 'application/octet-stream'),
        size: stat.size,
        sha256,
        sourcePath
      });
    }
  } catch (error) {
    if (error.code === 'HANDOVER_PATH_COLLISION') {
      return res.status(409).json({
        code: error.code,
        error: error.message,
        caseId,
        paths: error.paths
      });
    }
    if (error.code === 'HANDOVER_SOURCE_CHANGED') {
      return res.status(409).json({
        code: error.code,
        error: 'Eine Datei wurde während der Prüfsummenbildung verändert. Bitte erneut versuchen.',
        caseId,
        path: String(error.path || '')
      });
    }
    return res.status(500).json({
      code: 'HANDOVER_GENERATION_FAILED',
      error: 'Das Übergabepaket konnte nicht vorbereitet werden.'
    });
  }

  if (missing.length) {
    return res.status(409).json({
      code: 'HANDOVER_FILES_MISSING',
      error: `Das Übergabepaket wurde nicht erstellt: ${missing.length} von ${fileRows.length} Dokument(en) fehlen.`,
      caseId,
      expectedCount: fileRows.length,
      includedCount: documents.length,
      missingCount: missing.length,
      missing
    });
  }

  let tempZip = '';
  let tempDir = '';
  const cleanupTemp = () => {
    if (tempZip) {
      try { fs.unlinkSync(tempZip); } catch (_e) { /* bereits entfernt */ }
    }
    if (tempDir) {
      try { fs.rmdirSync(tempDir); } catch (_e) { /* nur leere eigene Temp-Verzeichnisse */ }
    }
  };
  try {
    const generatedAt = new Date();
    const artifacts = handoverPackage.buildHandoverArtifacts({
      caseLabel: caseRow.label,
      generatedAt,
      documents,
      caseData: handoverCaseData(caseRow, generatedAt, documents),
      fullCaseBackup: backupData.caseData(db, caseId)
    });
    const entries = [
      ...documents.map((document) => ({
        pfad: document.path,
        quelle: document.sourcePath,
        sha256: document.sha256
      })),
      ...artifacts.files.map((file) => ({ pfad: file.path, bytes: file.bytes, mtime: generatedAt }))
    ];
    const os = require('os');
    const tempBase = (fs.existsSync('/private/tmp') && fs.statSync('/private/tmp').isDirectory())
      ? '/private/tmp'
      : os.tmpdir();
    // mkdtemp legt 0700 an: Das sensible Paket liegt während der Erzeugung
    // nicht als für andere lokale Benutzer lesbare 0644-Datei in /tmp.
    tempDir = fs.mkdtempSync(path.join(tempBase, 'falluebergabe-'));
    tempZip = path.join(tempDir, 'Falluebergabe.zip');
    const { zipSchreiben } = require('../backup/document-backup');
    const result = zipSchreiben(tempZip, entries);
    if (result.fehlend) {
      cleanupTemp();
      const byPath = new Map(documents.map((document) => [document.path, document]));
      const concurrentlyMissing = result.fehlendePfade.map((missingPath) => {
        const document = byPath.get(missingPath) || {};
        return {
          fileId: document.fileId || '',
          name: document.name || path.posix.basename(missingPath),
          path: missingPath,
          reason: 'file_missing'
        };
      });
      return res.status(409).json({
        code: 'HANDOVER_FILES_MISSING',
        error: `Das Übergabepaket wurde nicht erstellt: ${result.fehlend} Dokument(e) verschwanden während des Lesens.`,
        caseId,
        expectedCount: fileRows.length,
        includedCount: fileRows.length - result.fehlend,
        missingCount: result.fehlend,
        missing: concurrentlyMissing
      });
    }

    const filename = handoverDownloadName(caseRow.label, generatedAt);
    const zipSize = fs.statSync(tempZip).size;
    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', handoverContentDisposition(filename));
    res.setHeader('Content-Length', String(zipSize));
    res.setHeader('Cache-Control', 'no-store');
    /* Weitergabe nach aussen (Nutzerwunsch 25.08.2026): Der Abruf ist ein GET und wird von der
       Sammel-Middleware bewusst nicht erfasst - dieses Paket ist aber die groesste Offenlegung,
       die die Software kennt. Protokolliert werden NUR Umfang und Fallbezug, nie Inhalte. */
    try {
      require('../../middleware/audit').logAction(req, 'case.handover_zip', 'case', caseId,
        { dokumente: documents.length },
        { caseId, kategorie: 'offenlegung', zweck: 'betreuungsfuehrung', kanal: 'export' });
    } catch (_error) { /* Protokollieren darf die Uebergabe nie verhindern */ }
    res.setHeader('X-Handover-Documents', String(documents.length));
    res.setHeader('X-Handover-Missing', '0');
    return res.sendFile(tempZip, (error) => {
      cleanupTemp();
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    cleanupTemp();
    if (error && error.code === 'ZIP_SOURCE_CHANGED') {
      return res.status(409).json({
        code: 'HANDOVER_SOURCE_CHANGED',
        error: 'Eine Datei wurde während der Paketerstellung verändert. Bitte erneut versuchen.',
        caseId,
        path: String(error.path || '')
      });
    }
    if (error && error.code === 'ZIP_SOURCE_MISSING') {
      return res.status(409).json({
        code: 'HANDOVER_FILES_MISSING',
        error: 'Das Übergabepaket wurde nicht erstellt: Eine Datei verschwand während der Paketerstellung.',
        caseId,
        expectedCount: fileRows.length,
        includedCount: Math.max(0, fileRows.length - 1),
        missingCount: 1,
        missing: [{
          fileId: '',
          name: path.posix.basename(String(error.path || '')),
          path: String(error.path || ''),
          reason: 'file_missing'
        }]
      });
    }
    return res.status(500).json({
      code: 'HANDOVER_GENERATION_FAILED',
      error: 'Das Übergabepaket konnte nicht erstellt werden.'
    });
  }
      },
      { priority: 50 }
    );
  } catch (error) {
    if (!res.headersSent) return next(error);
  }
});

router.post('/files/zip', requireViewDocuments, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
  const eintraege = [];
  const fehlend = [];
  const namen = new Set();
  for (const id of ids) {
    const r = fileGetStmt.get(String(id));
    if (!r || r.deleted_at) continue;
    if (!dateiSichtbar(req.session, r)) continue;
    const blob = findBlobPath(r);
    if (!blob) {
      fehlend.push({ id: r.id, name: r.name, caseId: r.case_id || '', folderId: r.folder_id || '' });
      continue;
    }
    let n = r.name; let z = 2;
    while (namen.has(n.toLowerCase())) { n = r.name.replace(/(\.[^.]*)?$/, ' (' + (z++) + ')$1'); }
    namen.add(n.toLowerCase());
    eintraege.push({ pfad: n, quelle: blob });
  }
  if (fehlend.length) return res.status(409).json({
    error: `Das Paket wurde nicht erstellt: ${fehlend.length} ausgewählte Datei(en) fehlen am Speicherort.`,
    missingCount: fehlend.length,
    expectedCount: eintraege.length + fehlend.length,
    missing: fehlend
  });
  if (!eintraege.length) return res.status(400).json({ error: 'Keine gültigen Dateien wurden ausgewählt.' });
  zipAntwort(res, eintraege, 'Dokumente-Auswahl_' + zipStamp() + '.zip');
});
router.get('/ordner-zip', requireViewDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  const wurzelId = String(req.query.folderId || '');
  const alle = folderAllStmt.all(scope.area, scope.caseId);
  const kette = new Map();
  function pfadVon(fid) {
    if (!fid) return [];
    if (kette.has(fid)) return kette.get(fid);
    const o = alle.find((x) => String(x.id) === String(fid));
    const seg = o ? pfadVon(String(o.parent_id || '')).concat(String(o.name || '')) : [];
    kette.set(fid, seg);
    return seg;
  }
  const basis = wurzelId ? pfadVon(wurzelId) : [];
  const drin = (fid) => { const seg = pfadVon(String(fid || '')); return !wurzelId || (seg.length >= basis.length && basis.every((s, i) => seg[i] === s)); };
  const dateien = db.prepare("SELECT * FROM doc_files WHERE area = ? AND case_id = ? AND deleted_at = ''").all(scope.area, scope.caseId);
  const eintraege = [];
  const fehlend = [];
  for (const r of dateien) {
    if (!drin(r.folder_id)) continue;
    const blob = findBlobPath(r);
    const rel = pfadVon(String(r.folder_id || '')).slice(basis.length).concat(r.name).join('/');
    if (!blob) {
      fehlend.push({ id: r.id, name: r.name, path: rel, folderId: r.folder_id || '' });
      continue;
    }
    eintraege.push({ pfad: rel, quelle: blob });
  }
  if (fehlend.length) return res.status(409).json({
    error: `Die Fallakte ist unvollständig: ${fehlend.length} von ${eintraege.length + fehlend.length} Datei(en) fehlen. Es wurde kein ZIP erstellt.`,
    missingCount: fehlend.length,
    expectedCount: eintraege.length + fehlend.length,
    missing: fehlend
  });
  if (!eintraege.length) return res.status(400).json({ error: 'In diesem Ordner sind keine Dokumente verzeichnet.' });
  const wname = wurzelId ? cleanName((alle.find((x) => String(x.id) === wurzelId) || {}).name || 'Ordner') : (scope.area === 'office' ? 'Büroorganisation' : 'Fallakte');
  zipAntwort(res, eintraege, 'Dokumente_' + wname + '_' + zipStamp() + '.zip');
});
/* Dateiliste eines Teilbaums (D10, E-Akte): gleiche Eingrenzung wie /ordner-zip, aber als
   Liste - der Client laedt die Dateien einzeln und baut die PDF-Sammelmappe selbst. */
router.get('/ordner-dateien', requireViewDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  const wurzelId = String(req.query.folderId || '');
  const alle = folderAllStmt.all(scope.area, scope.caseId);
  const kette = new Map();
  function pfadVon(fid) {
    if (!fid) return [];
    if (kette.has(fid)) return kette.get(fid);
    const o = alle.find((x) => String(x.id) === String(fid));
    const seg = o ? pfadVon(String(o.parent_id || '')).concat(String(o.name || '')) : [];
    kette.set(fid, seg);
    return seg;
  }
  const basis = wurzelId ? pfadVon(wurzelId) : [];
  const drin = (fid) => { const seg = pfadVon(String(fid || '')); return !wurzelId || (seg.length >= basis.length && basis.every((s, i) => seg[i] === s)); };
  const rows = db.prepare("SELECT id, name, mime_type, size, sha256, folder_id, updated_at FROM doc_files WHERE area = ? AND case_id = ? AND deleted_at = ''").all(scope.area, scope.caseId)
    .filter((r) => drin(r.folder_id))
    .map((r) => ({ id: r.id, name: r.name, mimeType: r.mime_type, size: r.size, sha256: r.sha256 || '', updatedAt: r.updated_at,
      pfad: pfadVon(String(r.folder_id || '')).slice(basis.length).join('/'), available: !!findBlobPath(r) }));
  rows.sort((a, b) => (a.pfad + '/' + a.name).localeCompare(b.pfad + '/' + b.name, 'de'));
  res.json({ files: rows, expectedCount: rows.length, missingCount: rows.filter((row) => !row.available).length });
});
router.patch('/files/:id/tags', requireEditDocuments, (req, res) => {
  const row = fileGetStmt.get(String(req.params.id));
  if (!row || row.deleted_at) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  const tags = Array.isArray(req.body?.tags) ? req.body.tags.map((x) => String(x).slice(0, 12)).filter(Boolean).slice(0, 12) : [];
  db.prepare('UPDATE doc_files SET tags = ? WHERE id = ?').run(tags.join(','), row.id);
  res.json({ ok: true, tags: tags.join(',') });
});
router.get('/ocr-ausstehend', requireViewDocuments, (req, res) => {
  const rows = db.prepare("SELECT id, name, area, case_id, mime_type FROM doc_files WHERE deleted_at = '' AND ocr_status IN ('pending','failed') ORDER BY created_at LIMIT 60").all()
    .filter((r) => dateiSichtbar(req.session, r)).slice(0, 24);
  res.json({ files: rows.map((r) => ({ id: r.id, name: r.name, area: r.area, caseId: r.case_id || '', mimeType: r.mime_type })) });
});
router.post('/duplikate-scan', requireEditDocuments, (req, res) => {
  const offenRows = db.prepare("SELECT * FROM doc_files WHERE sha256 = '' AND deleted_at = '' LIMIT 800").all()
    .filter((row) => dateiSichtbar(req.session, row)).slice(0, 400);
  let gehasht = 0;
  for (const r of offenRows) {
    const blob = findBlobPath(r);
    if (!blob) continue;
    try {
      // Uploads duerfen bis 1 GiB gross sein. Deshalb niemals den gesamten Inhalt nur fuer
      // die Pruefsumme in den Prozessspeicher laden; der gemeinsame Helfer liest in 1-MiB-Bloecken.
      const h = documentStorage.sha256File(blob);
      db.prepare('UPDATE doc_files SET sha256 = ? WHERE id = ?').run(h, r.id);
      gehasht++;
    } catch (_e) { /* Datei gerade nicht lesbar - naechster Scan */ }
  }
  const offen = db.prepare("SELECT * FROM doc_files WHERE sha256 = '' AND deleted_at = ''").all()
    .filter((row) => dateiSichtbar(req.session, row)).length;
  res.json({ gehasht, offen });
});
router.get('/duplikate', requireViewDocuments, (req, res) => {
  const gruppenRows = db.prepare("SELECT sha256, COUNT(*) AS n FROM doc_files WHERE sha256 != '' AND deleted_at = '' GROUP BY sha256 HAVING n > 1 ORDER BY n DESC LIMIT 100").all();
  const labels = new Map(db.prepare('SELECT id, label FROM cases').all().map((c) => [String(c.id), c.label]));
  const gruppen = gruppenRows.map((g) => ({
    sha256: g.sha256,
    files: db.prepare("SELECT id, name, area, case_id, folder_id, size FROM doc_files WHERE sha256 = ? AND deleted_at = ''").all(g.sha256)
      .filter((r) => dateiSichtbar(req.session, r))
      .map((r) => ({ id: r.id, name: r.name, area: r.area, caseId: r.case_id || '', folderId: r.folder_id || '', size: r.size,
        ort: r.area === 'office' ? 'Büroorganisation' : ('Fallakte ' + (labels.get(String(r.case_id)) || '')) }))
  }));
  res.json({ gruppen });
});
router.post('/duplikate/deduplizieren', requireEditDocuments, (req, res) => {
  const groups = db.prepare(`
    SELECT sha256 FROM doc_files
     WHERE sha256 != '' AND deleted_at = ''
     GROUP BY sha256 HAVING COUNT(*) > 1
  `).all();
  const report = [];
  let bytesFreigegeben = 0;
  for (const group of groups) {
    const rows = db.prepare(`
      SELECT * FROM doc_files
       WHERE sha256=? AND deleted_at=''
       ORDER BY CASE WHEN storage_status='ok' THEN 0 ELSE 1 END, created_at, id
    `).all(group.sha256).filter((row) => dateiSichtbar(req.session, row));
    const candidates = rows.map((row) => ({ row, filePath: findBlobPath(row) })).filter((item) => item.filePath);
    if (candidates.length < 2) continue;
    const canonical = candidates[0];
    let canonicalHash;
    try { canonicalHash = documentStorage.sha256File(canonical.filePath); }
    catch (_error) { continue; }
    if (canonicalHash !== group.sha256) continue;
    for (const duplicate of candidates.slice(1)) {
      if (path.resolve(duplicate.filePath) === path.resolve(canonical.filePath)) continue;
      try {
        const canonicalStat = fs.statSync(canonical.filePath);
        const duplicateStat = fs.statSync(duplicate.filePath);
        if (canonicalStat.dev === duplicateStat.dev && canonicalStat.ino === duplicateStat.ino) {
          report.push({ fileId: duplicate.row.id, canonicalFileId: canonical.row.id, status: 'bereits dedupliziert' });
          continue;
        }
      } catch (_error) { continue; }
      let duplicateHash;
      try { duplicateHash = documentStorage.sha256File(duplicate.filePath); }
      catch (_error) { continue; }
      if (duplicateHash !== group.sha256) {
        report.push({ fileId: duplicate.row.id, status: 'übersprungen', reason: 'Prüfsumme weicht ab' });
        continue;
      }
      const temp = path.join(path.dirname(duplicate.filePath), `.ablage-dedupe-${crypto.randomUUID()}.part`);
      try {
        // Ein Hardlink wäre zwar platzsparend, koppelte aber zwei fachlich selbständige
        // Dokumente: eine Finder-Änderung an einem Namen würde dann auch den anderen Inhalt
        // verändern. Deshalb ausschließlich Copy-on-write-Klone; auf einem Dateisystem ohne
        // sichere Klon-Unterstützung wird sichtbar übersprungen.
        try {
          fs.copyFileSync(canonical.filePath, temp, fs.constants.COPYFILE_FICLONE_FORCE);
        } catch (cloneError) {
          try { fs.unlinkSync(temp); } catch (_ignore) { /* kein/kein vollständiger Klon */ }
          report.push({
            fileId: duplicate.row.id,
            canonicalFileId: canonical.row.id,
            status: 'übersprungen',
            reason: 'Das Dateisystem unterstützt keine sichere Copy-on-write-Deduplizierung: '
              + (cloneError.message || cloneError)
          });
          continue;
        }
        if (documentStorage.sha256File(temp) !== group.sha256) throw new Error('Prüfsumme der Deduplizierung stimmt nicht.');
        fs.renameSync(temp, duplicate.filePath);
        const stat = fs.statSync(duplicate.filePath);
        db.prepare(`
          UPDATE doc_files
             SET storage_dev=?, storage_ino=?, storage_status='ok',
                 last_seen_at=datetime('now'), updated_at=datetime('now')
           WHERE id=?
        `).run(String(stat.dev), String(stat.ino), duplicate.row.id);
        documentStorage.writeSidecar(fileGetStmt.get(duplicate.row.id), duplicate.filePath);
        bytesFreigegeben += Number(duplicate.row.size) || 0;
        report.push({
          fileId: duplicate.row.id,
          canonicalFileId: canonical.row.id,
          path: duplicate.row.storage_relpath,
          method: 'copy-on-write',
          bytes: Number(duplicate.row.size) || 0,
          status: 'dedupliziert'
        });
      } catch (error) {
        try { fs.unlinkSync(temp); } catch (_ignore) { /* nicht vorhanden */ }
        report.push({ fileId: duplicate.row.id, status: 'Fehler', reason: String(error.message || error) });
      }
    }
  }
  res.json({
    ok: !report.some((item) => item.status === 'Fehler'),
    deduplicated: report.filter((item) => item.status === 'dedupliziert').length,
    bytesFreigegeben,
    report
  });
});

router.post('/integrity/scan', requireEditDocuments, async (req, res) => {
  try {
    const result = await operationCoordinator.runExclusive(
      'Manueller Plattenabgleich (nur lesen)',
      () => runDocumentIntegrity('read', req.body && req.body.verification === 'quick' ? 'quick' : 'full'),
      { priority: 20 }
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Leseabgleich fehlgeschlagen: ' + (error.message || error) });
  }
});
router.post('/integrity/apply', requireEditDocuments, async (req, res) => {
  try {
    const result = await operationCoordinator.runExclusive(
      'Finder-Änderungen einlesen',
      () => runDocumentIntegrity('apply', req.body && req.body.verification === 'quick' ? 'quick' : 'full'),
      { priority: 25 }
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Finder-Abgleich fehlgeschlagen: ' + (error.message || error) });
  }
});

router.get('/materializations/status', requireViewDocuments, (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Nur für Administratoren.' });
  const service = require('./materializations').current();
  res.json(service ? service.status() : { recoveryKeyConfigured: false, items: [], notStarted: true });
});

router.get('/maintenance-plans', requireViewDocuments, (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Nur für Administratoren.' });
  const service = require('./maintenance').current();
  res.json({
    ...(service ? service.list() : { plans: [], running: false, notStarted: true }),
    operations: operationCoordinator.status()
  });
});
router.put('/maintenance-plans/:id', requireEditDocuments, (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Nur für Administratoren.' });
  const service = require('./maintenance').current();
  if (!service) return res.status(503).json({ error: 'Der Wartungsplaner ist noch nicht gestartet.' });
  try { res.json(service.update(req.params.id, req.body || {})); }
  catch (error) { res.status(400).json({ error: error.message || String(error) }); }
});
router.post('/maintenance-plans/:id/run', requireEditDocuments, async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Nur für Administratoren.' });
  const service = require('./maintenance').current();
  if (!service) return res.status(503).json({ error: 'Der Wartungsplaner ist noch nicht gestartet.' });
  try { res.json(await service.run(req.params.id)); }
  catch (error) { res.status(500).json({ error: error.message || String(error) }); }
});
router.post('/materializations/run', requireEditDocuments, async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Nur für Administratoren.' });
  const service = require('./materializations').current();
  if (!service) return res.status(503).json({ error: 'Die Materialisierung ist noch nicht gestartet.' });
  try {
    const caseId = String(req.body && req.body.caseId || '');
    const result = await operationCoordinator.runExclusive(
      caseId ? `Sicherungsabbilder Fall ${caseId}` : 'Alle Sicherungsabbilder',
      () => caseId ? { caseId, result: service.runCase(caseId) } : service.runAll(),
      { priority: 40 }
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Sicherungsabbilder konnten nicht aktualisiert werden: ' + (error.message || error) });
  }
});
router.get('/integrity/runs/:id', requireViewDocuments, (req, res) => {
  const run = db.prepare('SELECT * FROM doc_integrity_runs WHERE id=?').get(String(req.params.id));
  if (!run) return res.status(404).json({ error: 'Abgleichlauf nicht gefunden.' });
  const findings = db.prepare('SELECT * FROM doc_integrity_findings WHERE run_id=? ORDER BY seq').all(run.id)
    .map((row) => {
      let detail = {};
      try { detail = JSON.parse(row.detail_json || '{}'); } catch (_error) { detail = {}; }
      return { seq: row.seq, kind: row.kind, fileId: row.file_id, storageRelpath: row.storage_relpath, detail };
    });
  let summary = {};
  try { summary = JSON.parse(run.summary_json || '{}'); } catch (_error) { summary = {}; }
  res.json({ run: { ...run, summary }, findings });
});
router.get('/speicher', requireViewDocuments, (req, res) => {
  const labels = new Map(db.prepare('SELECT id, label, archived FROM cases').all().map((c) => [String(c.id), c]));
  const rows = db.prepare("SELECT area, case_id, COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM doc_files WHERE deleted_at = '' GROUP BY area, case_id").all();
  const korb = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM doc_files WHERE deleted_at != ''").get();
  let platte = null;
  try {
    const wo = readCfg().storageRoot || DEFAULT_DIR;
    const st = fs.statfsSync(wo);
    platte = { frei: st.bavail * st.bsize, gesamt: st.blocks * st.bsize, pfad: wo };
  } catch (_e) { /* Plattform ohne statfs */ }
  res.json({
    platte,
    bereiche: rows.filter((r) => dateiSichtbar(req.session, r)).map((r) => ({ area: r.area, caseId: r.case_id || '',
      label: r.area === 'management' ? 'Geschützte Verwaltung' : (r.area === 'office' ? 'Büroorganisation' : ((labels.get(String(r.case_id)) || {}).label || r.case_id)),
      archiviert: r.area === 'case' ? !!((labels.get(String(r.case_id)) || {}).archived) : false,
      anzahl: r.n, bytes: r.bytes })),
    papierkorb: { anzahl: korb.n, bytes: korb.bytes }
  });
});
router.get('/aktivitaet', requireViewDocuments, (req, res) => {
  try { db.prepare("DELETE FROM doc_activity WHERE ts < datetime('now','-180 days')").run(); } catch (_e) { /* Aufbewahrung */ }
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const rows = db.prepare('SELECT ts, username, aktion, ziel, detail, area, case_id FROM doc_activity ORDER BY id DESC LIMIT ?').all(limit)
    .filter((r) => dateiSichtbar(req.session, r));
  const labels = new Map(db.prepare('SELECT id, label FROM cases').all().map((c) => [String(c.id), c.label]));
  res.json({ eintraege: rows.map((r) => ({ ts: r.ts, username: r.username, aktion: r.aktion, ziel: r.ziel, detail: r.detail,
    ort: r.area === 'management' ? 'Geschützte Verwaltung' : (r.area === 'office' ? 'Büroorganisation' : (r.case_id ? (labels.get(String(r.case_id)) || r.case_id) : '')) })) });
});

/* Ordner-Inhaltsangabe (D14): Anzahl+Bytes der DIREKTEN Dateien je Ordner des Bereichs. */
router.get('/ordner-statistik', requireViewDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  const rows = db.prepare("SELECT folder_id, COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM doc_files WHERE area = ? AND case_id = ? AND deleted_at = '' GROUP BY folder_id").all(scope.area, scope.caseId);
  const stat = {};
  for (const r of rows) stat[String(r.folder_id || '')] = { n: r.n, bytes: r.bytes };
  res.json({ stat });
});

/* ---------- D13: Wiedervorlage + Datei-in-den-Posteingang ---------- */
router.patch('/files/:id/wiedervorlage', requireEditDocuments, (req, res) => {
  const row = fileGetStmt.get(String(req.params.id));
  if (!row || row.deleted_at) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  const datum = String(req.body?.datum || '').trim();
  if (datum && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return res.status(400).json({ error: 'Datum bitte als JJJJ-MM-TT.' });
  const notiz = String(req.body?.notiz || '').slice(0, 500);
  const linked = documentFollowupStmt.get(row.id);
  const caseId = row.area === 'case' ? String(row.case_id || '') : '';
  const caseRow = caseId ? caseLabelStmt.get(caseId) : null;
  const values = {
    id: linked ? linked.id : crypto.randomUUID(),
    title: `Wiedervorlage: ${String(row.name || 'Dokument')}`,
    description: notiz,
    dueAt: datum,
    caseId,
    caseLabel: caseRow ? String(caseRow.label || '') : '',
    sourceId: String(row.id),
    sourceRef: `document:${row.id}`,
    userId: req.session.userId
  };
  const linkedRows = datum ? [] : documentFollowupAllStmt.all(row.id);
  const save = db.transaction(() => {
    db.prepare("UPDATE doc_files SET resubmit_at = ?, resubmit_note = ?, updated_at = datetime('now') WHERE id = ?")
      .run(datum, datum ? notiz : '', row.id);
    if (datum) {
      if (linked) documentFollowupUpdateStmt.run(values);
      else documentFollowupInsertStmt.run(values);
    } else {
      for (const todo of linkedRows) documentFollowupAttachmentsDeleteStmt.run(todo.id);
      documentFollowupDeleteStmt.run(row.id);
    }
  });
  save();
  if (!datum) {
    for (const todo of linkedRows) {
      try { fs.rmSync(path.join(DOCUMENT_DATA_ROOT, 'todo-attachments', todo.id), { recursive: true, force: true }); } catch (_e) { /* best effort */ }
    }
  }
  officeEvents.emit('todos', { method: datum ? 'PUT' : 'DELETE', sourceType: 'document', sourceId: row.id });
  res.json({ ok: true, resubmitAt: datum, followupId: datum ? values.id : '' });
});
router.get('/wiedervorlagen', requireViewDocuments, (req, res) => {
  const heute = new Date();
  const heuteS = heute.getFullYear() + '-' + String(heute.getMonth() + 1).padStart(2, '0') + '-' + String(heute.getDate()).padStart(2, '0');
  const labels = new Map(db.prepare('SELECT id, label FROM cases').all().map((c) => [String(c.id), c.label]));
  const rows = db.prepare("SELECT id, name, area, case_id, folder_id, resubmit_at, resubmit_note FROM doc_files WHERE resubmit_at != '' AND deleted_at = '' ORDER BY resubmit_at LIMIT 200").all()
    .filter((r) => dateiSichtbar(req.session, r));
  res.json({ eintraege: rows.map((r) => ({ id: r.id, name: r.name, area: r.area, caseId: r.case_id || '', folderId: r.folder_id || '',
    datum: r.resubmit_at, notiz: r.resubmit_note, faellig: r.resubmit_at <= heuteS,
    ort: r.area === 'office' ? 'Büroorganisation' : (labels.get(String(r.case_id)) || '') })) });
});
/* Datei mit einem weiteren Fachverweis in den Posteingang geben. Der Dateiinhalt bleibt genau
   einmal vorhanden; bereits erkannter Text steht der Posteingang-KI sofort zur Verfuegung. */
router.post('/files/:id/zum-posteingang', requireEditDocuments, (req, res) => {
  const row = fileGetStmt.get(String(req.params.id));
  if (!row || row.deleted_at) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  const blob = findBlobPath(row);
  if (!blob) return res.status(410).json({ error: 'Dateiinhalt nicht auffindbar.' });
  const ocrText = textForFileStmt.all(row.id).map((s) => String(s.text || '')).join('\n\n').slice(0, 400000);
  let caseLabel = '';
  if (row.area === 'case' && row.case_id) {
    const c = db.prepare('SELECT label FROM cases WHERE id = ?').get(row.case_id);
    caseLabel = (c && c.label) || '';
  }
  const inboxId = crypto.randomUUID();
  const caseId = row.area === 'case' ? String(row.case_id || '') : '';
  const heute = new Date();
  const datum = heute.getFullYear() + '-' + String(heute.getMonth() + 1).padStart(2, '0') + '-' + String(heute.getDate()).padStart(2, '0');
  db.transaction(() => {
    db.prepare('INSERT INTO inbox_documents (id, file_name, mime_type, size, inbox_date, ocr_text, case_id, case_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(inboxId, row.name, row.mime_type || 'application/octet-stream', row.size, datum, ocrText, caseId, caseLabel);
    db.prepare("INSERT INTO doc_links (module, owner_id, slot, file_id, detail_json) VALUES ('inbox', ?, '', ?, ?)")
      .run(inboxId, row.id, JSON.stringify({ fromDocumentId: row.id }));
    db.prepare("INSERT OR IGNORE INTO doc_module_import (quelle, quell_id, file_id) VALUES ('posteingang', ?, ?)")
      .run(inboxId, row.id);
  })();
  try { require('../office/events').emit('inbox', { method: 'DOK', path: '/inbox' }); } catch (_e) { /* Anzeige */ }
  res.status(201).json({ ok: true, inboxId, mitText: !!ocrText });
});

/* ------------- OneDrive/Google Drive: eigener OAuth-Flow (D9) -------------
   Scope-Falle beachtet: EIGENE Autorisierung mit Datei-Scopes, bestehende Kalender-/Mail-
   Verbindungen bleiben unangetastet. Der "Verbindungstest" ist der Token-Tausch selbst. */
const driveStates = new Map(); // state -> { kind, label, clientId, secretEnc, userId, bis }
function driveRedirectUri(kind) {
  const basis = (process.env.PUBLIC_BASE_URL || ('http://localhost:' + (process.env.PORT || 8935))).replace(/\/$/, '');
  return basis + '/api/documents/oauth/' + kind + '/callback';
}
router.post('/oauth/:kind/vorbereiten', requireEditDocuments, (req, res) => {
  if (!darfMountVerwaltung(req)) return res.status(403).json({ error: 'Verbindungen verwaltet nur Admin/Bürostammdaten-Recht.' });
  const kind = String(req.params.kind || '');
  if (!driveMounts.ARTEN.has(kind)) return res.status(400).json({ error: 'Unbekannter Anbieter.' });
  const label = cleanName(req.body?.label) || (kind === 'onedrive' ? 'OneDrive' : 'Google Drive');
  const clientId = String(req.body?.clientId || '').trim();
  const clientSecret = String(req.body?.clientSecret || '').trim();
  if (!clientId || !clientSecret) return res.status(400).json({ error: 'Client-ID und Client-Secret der eigenen App-Registrierung erforderlich.' });
  for (const [k, v] of driveStates) { if (v.bis < Date.now()) driveStates.delete(k); }
  const state = crypto.randomBytes(24).toString('base64url');
  driveStates.set(state, { kind, label, clientId, secretEnc: cryptoHelper.encrypt(clientSecret), userId: req.session.userId, bis: Date.now() + 10 * 60 * 1000 });
  res.json({ url: driveMounts.authUrl(kind, clientId, driveRedirectUri(kind), state), redirectUri: driveRedirectUri(kind) });
});
function driveAntwortSeite(res, status, titel, text) {
  res.status(status).set('Content-Type', 'text/html; charset=utf-8').send(
    '<!doctype html><meta charset="utf-8"><title>' + titel + '</title>'
    + '<body style="font:15px -apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:96vh;margin:0;color:#2c3a47">'
    + '<div style="max-width:460px;text-align:center"><h2 style="margin:0 0 8px">' + titel + '</h2><p>' + text + '</p>'
    + '<p style="color:#5a6b7a;font-size:13px">Dieses Fenster kann geschlossen werden.</p></div>'
    + '<scr' + 'ipt>try{setTimeout(function(){window.close();},2500);}catch(e){}</scr' + 'ipt>');
}
router.get('/oauth/:kind/callback', async (req, res) => {
  const st = driveStates.get(String(req.query.state || ''));
  if (!st || st.bis < Date.now() || st.kind !== String(req.params.kind || '')) {
    return driveAntwortSeite(res, 400, 'Anmeldung abgelaufen', 'Der Anmeldelink ist abgelaufen oder ungültig - bitte im Dokumente-Modul erneut auf „Verbinden" klicken.');
  }
  driveStates.delete(String(req.query.state));
  if (req.query.error) return driveAntwortSeite(res, 400, 'Anmeldung abgebrochen', 'Der Anbieter meldet: ' + String(req.query.error_description || req.query.error));
  try {
    const tok = await driveMounts.tauscheCode(st.kind, st.clientId, st.secretEnc, String(req.query.code || ''), driveRedirectUri(st.kind));
    if (!tok.refresh_token) return driveAntwortSeite(res, 400, 'Kein Dauerzugriff', 'Der Anbieter hat kein Dauerzugriffs-Token (refresh_token) geliefert - bitte die App-Registrierung prüfen und erneut verbinden.');
    const cfg = {
      clientId: st.clientId, clientSecretEnc: st.secretEnc,
      refreshEnc: cryptoHelper.encrypt(String(tok.refresh_token)),
      accessEnc: cryptoHelper.encrypt(String(tok.access_token || '')),
      accessBis: Date.now() + ((Number(tok.expires_in) || 3600) * 1000) - 60000
    };
    mountInsStmt.run({ id: crypto.randomUUID(), label: st.label, kind: st.kind, configJson: JSON.stringify(cfg), createdBy: st.userId });
    try { require('../office/events').emit('documents', { method: 'OAUTH', path: '/mounts' }); } catch (_e) { /* nur Anzeige */ }
    driveAntwortSeite(res, 200, 'Verbindung hergestellt', (st.kind === 'onedrive' ? 'OneDrive' : 'Google Drive') + ' ist jetzt als „' + st.label + '" im Dokumente-Modul verfügbar.');
  } catch (e) {
    driveAntwortSeite(res, 400, 'Anmeldung fehlgeschlagen', String((e && e.message) || e));
  }
});

/* ---------------------- WebDAV-Zugang: App-Passwoerter (D7) ---------------------- */
// Jeder Nutzer verwaltet seine EIGENEN App-Passwoerter fuers Netzlaufwerk; gespeichert wird
// nur der bcrypt-Hash, das Passwort erscheint EINMALIG in der Antwort des Anlegens.
/* Seitentexte einer Datei (D8, KI-Analyse im Explorer): liefert den indexierten Volltext
   je Seite - leer, solange weder Textebene noch OCR vorliegen. */
router.get('/files/:id/text', requireViewDocuments, (req, res) => {
  const row = fileGetStmt.get(String(req.params.id));
  if (!row || row.deleted_at) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  res.json({ name: row.name, ocrStatus: row.ocr_status, pages: textForFileStmt.all(row.id) });
});

/* ---------- Automatische Sicherung (D8): Zeitplaene ---------- */
const bkListStmt = db.prepare('SELECT * FROM doc_backup_jobs ORDER BY created_at');
const bkGetStmt = db.prepare('SELECT * FROM doc_backup_jobs WHERE id = ?');
const bkInsStmt = db.prepare('INSERT INTO doc_backup_jobs (id, label, interval, weekdays, time_hhmm, source_json, target_json, options_json, enabled, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const bkUpdStmt = db.prepare('UPDATE doc_backup_jobs SET label = ?, interval = ?, weekdays = ?, time_hhmm = ?, source_json = ?, target_json = ?, options_json = ?, enabled = ? WHERE id = ?');
const bkMarkConfigChangedStmt = db.prepare(`
  UPDATE doc_backup_jobs
     SET config_changed_at=datetime('now'),run_started_at='',last_scheduled_at='',
         mount_cursor_at='',next_retry_at='',retry_count=0,
         retry_context_json='{}',last_warning_at='',last_warning_key=''
   WHERE id=?
`);
const bkResetScheduleStmt = db.prepare(`
  UPDATE doc_backup_jobs
     SET last_scheduled_at=''
   WHERE id=?
`);
const bkDelStmt = db.prepare('DELETE FROM doc_backup_jobs WHERE id = ?');
const bkReserveAbandonedLineageStmt = db.prepare(`
  UPDATE doc_backup_jobs
     SET enabled=0,run_started_at=@reservation
   WHERE id=@id AND enabled=@priorEnabled
     AND COALESCE(run_started_at,'')=''
     AND source_json=@sourceJson AND target_json=@targetJson
     AND options_json=@optionsJson
`);
const bkReleaseAbandonedLineageStmt = db.prepare(`
  UPDATE doc_backup_jobs
     SET enabled=@enabled,run_started_at=''
   WHERE id=@id AND run_started_at=@reservation
`);
const bkRetainAbandonedLineageStmt = db.prepare(`
  UPDATE doc_backup_jobs
     SET enabled=0,run_started_at='',next_retry_at='',retry_count=0,
         retry_context_json='{}',
         last_result='SICHERUNGSLINIE ADMINISTRATIV VERLASSEN – lokale Generationen bleiben erhalten'
   WHERE id=@id AND run_started_at=@reservation
`);
const bkAdminForPasswordStmt = db.prepare(`
  SELECT id,password_hash
    FROM users
   WHERE id=? AND active<>0 AND is_admin<>0 AND allow_online<>0
`);
const bkStrictAuditStmt = db.prepare(`
  INSERT INTO audit_log
    (actor_user_id,actor_username,action,target_type,target_id,details_json)
  VALUES
    (@actorUserId,@actorUsername,@action,@targetType,@targetId,@detailsJson)
`);
let bkDownloadActive = false;
const BK_INTERVALLE = new Set(['taeglich', 'woechentlich', 'monatlich', 'stuendlich', 'laufend']);
const BK_UHRZEIT = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;
function backupPfadUnter(kind, eltern) {
  const rel = path.relative(path.resolve(eltern), path.resolve(kind));
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
}
function backupPfadeUeberlappen(a, b) {
  return backupPfadUnter(a, b) || backupPfadUnter(b, a);
}
function backupExportZielPruefen(roh) {
  const ziel = String(roh || '').trim();
  if (!ziel) throw new Error('Bitte einen Zielordner (Pfad auf dem Server-Rechner) angeben.');
  if (!path.isAbsolute(ziel)) throw new Error('Der ZIP-Zielordner muss ein absoluter Serverpfad sein.');
  const abs = path.resolve(ziel);
  const verboteneWurzeln = [
    DOCUMENT_DATA_ROOT,
    documentStorage.root(),
    SERVER_ROOT,
    PROJECT_ROOT,
    OUTPUTS_ROOT
  ].filter(Boolean);
  if (verboteneWurzeln.some((root) => backupPfadeUeberlappen(abs, root))) {
    throw new Error('Der ZIP-Zielordner muss außerhalb von Anwendung, Dokumentenspeicher und Serverdaten liegen.');
  }
  return abs;
}
function gesamtZielVonZeile(row) {
  try {
    const ziel = JSON.parse((row && row.target_json) || '{}');
    return ziel && ziel.art === 'gesamt' ? path.resolve(String(ziel.ordner || '')) : '';
  } catch (_e) {
    return '';
  }
}
function anderesAktivesGesamtZiel(ziel, eigeneId) {
  const abs = path.resolve(String(ziel || ''));
  return bkListStmt.all().find((row) => row.enabled && String(row.id) !== String(eigeneId || '')
    && gesamtZielVonZeile(row) === abs);
}
function andererGesamtZeitplanDerselbenLinie(ziel, backupTargetId, eigeneId) {
  const abs = path.resolve(String(ziel || ''));
  const targetId = String(backupTargetId || '').toLowerCase();
  return bkListStmt.all().find((row) => {
    if (String(row.id) === String(eigeneId || '')) return false;
    if (gesamtZielVonZeile(row) === abs) return true;
    if (!targetId) return false;
    const parsed = backupJobJson(row);
    return parsed.ziel && parsed.ziel.art === 'gesamt'
      && String(parsed.options && parsed.options.backupTargetId || '').toLowerCase() === targetId;
  });
}

function backupJobHatDauerhafteHistorie(row) {
  if (!row) return false;
  if (String(row.last_success_at || '')) return true;
  const target = gesamtZielVonZeile(row);
  if (!target) return false;
  let names;
  try { names = fs.readdirSync(target); }
  catch (_error) {
    // Nach einem begonnenen Lauf ist ein derzeit verschwundenes Ziel gerade
    // kein Beweis dafür, dass dort nie eine Generation veröffentlicht wurde.
    return !!String(row.last_run_at || '');
  }
  const id = String(row.id);
  for (const name of names) {
    const snapshot = name.match(
      /^(Gesamtsicherung_[0-9]{8}_[0-9]{6}(?:_[A-Za-z0-9_.-]+)?)$/
    );
    if (snapshot) {
      const marker = path.join(target, name, 'verwaltung', 'JOB-ID.txt');
      let descriptor;
      try {
        descriptor = fs.openSync(marker, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const stat = fs.fstatSync(descriptor);
        if (stat.isFile() && stat.size > 0 && stat.size < 4096
            && fs.readFileSync(descriptor, 'utf8').trim() === id) return true;
      } catch (_error) { /* andere/ungültige Generation */ }
      finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
      continue;
    }
    const sidecar = name.match(
      /^(Gesamtsicherung_[0-9]{8}_[0-9]{6}(?:_[A-Za-z0-9_.-]+)?)\.(offsite-pending|offsite-abandoned)$/
    );
    if (!sidecar) continue;
    const parsed = backupPendingSidecarLesen(path.join(target, name), sidecar[1]);
    if (parsed && String(parsed.values.JOB_ID) === id) return true;
  }
  return false;
}
function backupJobJson(r) {
  let quelle = {}, ziel = {}, options = null, optionsError = '', configurationError = '';
  let retryContext = {};
  try {
    quelle = JSON.parse(r.source_json || '{}');
    if (!quelle || typeof quelle !== 'object' || Array.isArray(quelle)) {
      throw new Error('Erwartet wird ein JSON-Objekt.');
    }
  } catch (error) {
    configurationError = 'Ungültige Quellkonfiguration: ' + String(error.message || error);
    quelle = {};
  }
  try {
    ziel = JSON.parse(r.target_json || '{}');
    if (!ziel || typeof ziel !== 'object' || Array.isArray(ziel)) {
      throw new Error('Erwartet wird ein JSON-Objekt.');
    }
    if (!['zip', 'gesamt', 'mount'].includes(String(ziel.art || ''))) {
      throw new Error('Unbekannte Zielart.');
    }
  } catch (error) {
    configurationError += (configurationError ? ' ' : '')
      + 'Ungültige Zielkonfiguration: ' + String(error.message || error);
    ziel = {};
  }
  try {
    const parsedOptions = JSON.parse(r.options_json || '{}');
    if (!parsedOptions || typeof parsedOptions !== 'object' || Array.isArray(parsedOptions)) {
      throw new Error('Erwartet wird ein JSON-Objekt.');
    }
    options = backupScheduler.normalisiereOptionen(parsedOptions);
  }
  catch (error) { optionsError = 'Ungültige Sicherungsoptionen: ' + String(error.message || error); }
  try {
    const parsed = JSON.parse(r.retry_context_json || '{}');
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object'
        && parsed.kind === 'offsite-pending') {
      retryContext = {
        kind: 'offsite-pending',
        snapshot: String(parsed.snapshot || ''),
        targetId: String(parsed.targetId || '')
      };
    }
  } catch (_error) { /* Health meldet den Laufzustand; Rohdaten werden nicht ausgegeben. */ }
  return { id: r.id, label: r.label, interval: r.interval, weekdays: r.weekdays, timeHhmm: r.time_hhmm,
    quelle, ziel, options, optionsError, configurationError,
    enabled: !!r.enabled, lastRunAt: r.last_run_at, lastResult: r.last_result,
    runStartedAt: r.run_started_at || '', nextRetryAt: r.next_retry_at || '',
    retryCount: Number(r.retry_count) || 0, retryContext, lastSuccessAt: r.last_success_at || '',
    lastFailureAt: r.last_failure_at || '', lastWarningAt: r.last_warning_at || '',
    lastMailAt: r.last_mail_at || '', lastMailError: r.last_mail_error || '',
    configChangedAt: r.config_changed_at || '' };
}
function backupJobPruefen(b) {
  const interval = String(b.interval || 'taeglich');
  if (!BK_INTERVALLE.has(interval)) throw new Error('Unbekannter Rhythmus.');
  let zeit = String(b.timeHhmm || '').trim();
  if (interval === 'stuendlich' || interval === 'laufend') { if (!BK_UHRZEIT.test(zeit)) zeit = '00:00'; }
  else if (!BK_UHRZEIT.test(zeit)) throw new Error('Uhrzeit bitte gültig als HH:MM angeben.');
  const weekdays = String(b.weekdays || '').split(',').map((s) => Number(s.trim())).filter(Boolean);
  if (interval === 'woechentlich' && (!weekdays.length || weekdays.some((t) => t < 1 || t > 7))) throw new Error('Bitte mindestens einen Wochentag wählen.');
  if (interval === 'monatlich' && (weekdays.length !== 1 || weekdays[0] < 1 || weekdays[0] > 28)) throw new Error('Bitte einen Monatstag zwischen 1 und 28 wählen.');
  const quelle = b.quelle || {};
  if (!['alles', 'office', 'case'].includes(String(quelle.bereich || ''))) throw new Error('Bitte einen Quell-Bereich wählen.');
  if (quelle.bereich === 'case' && !String(quelle.caseId || '').trim()) throw new Error('Bitte eine Fallakte wählen.');
  const ziel = b.ziel || {};
  let gesamtOrdner = '';
  if (ziel.art === 'zip') {
    ziel.ordner = backupExportZielPruefen(ziel.ordner);
  } else if (ziel.art === 'gesamt') {
    if (quelle.bereich !== 'alles') throw new Error('Die Gesamtsicherung sichert immer die gesamte Anwendung; bitte „Gesamter Dokumentenspeicher“ wählen.');
    if (interval === 'laufend' || interval === 'stuendlich') {
      throw new Error('Eine Gesamtsicherung ist täglich, wöchentlich oder monatlich möglich.');
    }
    try {
      gesamtOrdner = pruefeGesamtBackupZiel(
        String(ziel.ordner || ''),
        DOCUMENT_DATA_ROOT,
        SERVER_ROOT,
        documentStorage.root()
      );
    } catch (e) {
      throw new Error(e.message || e);
    }
  } else if (ziel.art === 'mount') {
    if (!mountGetStmt.get(String(ziel.mountId || ''))) throw new Error('Die gewählte Verbindung gibt es nicht (mehr).');
    /* Schleifenschutz (D29): das Sync-/Sicherungsziel darf keine Import-Quelle sein. */
    const impKoll = importZielKollidiert(String(ziel.mountId || ''), ziel.unterordner);
    if (impKoll) throw new Error('Schleifenschutz: Der Zielordner ist Quellordner des Import-Eingangs „' + impKoll + '“ auf derselben Verbindung - das würde eine Kopier-Schleife erzeugen.');
    const prKoll = pairPfadeKollidieren(String(ziel.mountId || ''), mountSegmente(ziel.unterordner).join('/'), '');
    if (prKoll) throw new Error('Schleifenschutz: Der Zielordner überlappt die Zwei-Wege-Paarung „' + prKoll + '“ auf derselben Verbindung.');
  } else throw new Error('Bitte ein Ziel wählen (ZIP-Ordner oder Verbindung).');
  if (interval === 'laufend' && ziel.art !== 'mount') throw new Error('Laufende Synchronisation braucht eine Verbindung als Ziel - eine ZIP-Datei alle paar Sekunden wäre ein Vollpaket.');
  const options = backupScheduler.normalisiereOptionen(b.options || {});
  if (options.offsite.enabled && ziel.art !== 'gesamt') {
    throw new Error('Die verschlüsselte Offsite-Zweitsicherung kann nur an eine Gesamtsicherung gekoppelt werden.');
  }
  if (options.retention.enabled && ziel.art !== 'gesamt') {
    throw new Error('Der Generationenplan kann nur für eine Gesamtsicherung verwendet werden.');
  }
  if (options.offsite.enabled) {
    const passwordFile = path.resolve(options.offsite.passwordFile);
    const verboteneWurzeln = [
      DOCUMENT_DATA_ROOT,
      documentStorage.root(),
      gesamtOrdner
    ].filter(Boolean);
    if (verboteneWurzeln.some((root) => backupPfadUnter(passwordFile, root))) {
      throw new Error('Die restic-Passwortdatei muss außerhalb von Dokumentenspeicher, Anwendungsdaten und primärem Sicherungsziel liegen.');
    }
  }
  return {
    label: String(b.label || '').trim() || 'Sicherung',
    interval, weekdays: weekdays.join(','), zeit,
    quelle: { bereich: quelle.bereich, caseId: String(quelle.caseId || '') },
    ziel: ziel.art === 'zip' ? { art: 'zip', ordner: String(ziel.ordner).trim() }
      : ziel.art === 'gesamt' ? { art: 'gesamt', ordner: gesamtOrdner }
        : { art: 'mount', mountId: String(ziel.mountId), unterordner: String(ziel.unterordner || '').trim() },
    options
  };
}

function backupZielFuerAdmin(value) {
  const ziel = pruefeGesamtBackupZiel(
    String(value || ''),
    DOCUMENT_DATA_ROOT,
    SERVER_ROOT,
    documentStorage.root()
  );
  let stat;
  try { stat = fs.lstatSync(ziel); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Der Sicherungszielordner existiert noch nicht.');
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Der Sicherungszielpfad muss ein vorhandener regulärer Ordner sein.');
  }
  fs.accessSync(ziel, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  return ziel;
}

function backupDownloadWorker(data, timeoutMs) {
  const { Worker } = require('worker_threads');
  return new Promise((resolve, reject) => {
    const worker = new Worker(require.resolve('../backup/download-worker'), {
      workerData: data,
      env: {
        NODE_ENV: String(process.env.NODE_ENV || 'production'),
        TZ: String(process.env.TZ || 'Europe/Berlin')
      }
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      const error = new Error('Die ZIP-Erstellung hat ihre Laufzeitgrenze überschritten.');
      error.code = 'BACKUP_DOWNLOAD_TIMEOUT';
      worker.terminate().finally(() => finish(error));
    }, Math.max(60000, Number(timeoutMs) || 2 * 60 * 60 * 1000));
    if (timer.unref) timer.unref();
    worker.once('message', (message) => {
      if (!message || message.ok !== true) {
        const error = new Error(String(message && message.error || 'Die ZIP-Erstellung ist fehlgeschlagen.'));
        error.code = String(message && message.code || 'BACKUP_DOWNLOAD_FAILED');
        finish(error);
        return;
      }
      finish(null, message);
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) {
        const error = new Error(`Der ZIP-Arbeitsprozess endete mit Code ${code}.`);
        error.code = 'BACKUP_DOWNLOAD_WORKER_EXIT';
        finish(error);
      }
    });
  });
}

function backupZielmarkeLesen(ziel) {
  const marker = path.join(ziel, BACKUP_TARGET_MARKER);
  let stat;
  try { stat = fs.lstatSync(marker); }
  catch (error) {
    if (error.code === 'ENOENT') {
      return { present: false, valid: false, marker, targetId: '', error: 'Zielmarke fehlt.' };
    }
    return { present: true, valid: false, marker, targetId: '', error: error.message || String(error) };
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < BACKUP_TARGET_MARKER_HEADER.length || stat.size > 4096) {
    return {
      present: true,
      valid: false,
      marker,
      targetId: '',
      error: 'Die Zielmarke ist keine gültige reguläre Datei.'
    };
  }
  let text = '';
  try {
    const descriptor = fs.openSync(marker, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try { text = fs.readFileSync(descriptor, 'utf8'); }
    finally { fs.closeSync(descriptor); }
  } catch (error) {
    return { present: true, valid: false, marker, targetId: '', error: error.message || String(error) };
  }
  const lines = text.replace(/\r/g, '').trimEnd().split('\n');
  const targetIds = lines.filter((line) => line.startsWith('TARGET_ID='))
    .map((line) => line.slice('TARGET_ID='.length));
  const valid = lines[0] === BACKUP_TARGET_MARKER_HEADER
    && targetIds.length === 1
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetIds[0]);
  return {
    present: true,
    valid,
    marker,
    targetId: valid ? targetIds[0].toLowerCase() : '',
    error: valid ? '' : 'Die Zielmarke hat nicht das erwartete Format.'
  };
}

function backupSecretDateiStatus(value, label) {
  const file = String(value || '').trim();
  if (!file) return { configured: false, valid: false, file: '', error: `${label} fehlt.` };
  if (!path.isAbsolute(file)) {
    return { configured: true, valid: false, file, error: `${label} muss ein absoluter Serverpfad sein.` };
  }
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${label} ist keine reguläre Datei.`);
    }
    if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600) {
      throw new Error(`${label} muss exakt mit Dateimodus 0600 geschützt sein.`);
    }
    fs.accessSync(file, fs.constants.R_OK);
    return { configured: true, valid: true, file, error: '' };
  } catch (error) {
    return { configured: true, valid: false, file, error: error.message || String(error) };
  }
}

function backupKapazitaetStatus(ziel, options) {
  if (typeof fs.statfsSync !== 'function') return null;
  try {
    const stat = fs.statfsSync(ziel);
    const blockSize = Number(stat.bsize) || 0;
    const totalBytes = Number(stat.blocks) * blockSize;
    const freeBytes = Number(stat.bavail) * blockSize;
    const freePercent = totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 0;
    const minimumBytes = Number(options.retention.minFreeGb || 0) * 1024 * 1024 * 1024;
    const minimumPercent = Number(options.capacity.warningPercent || 0);
    return {
      totalBytes,
      freeBytes,
      freePercent,
      minimumBytes,
      minimumPercent,
      sufficient: freeBytes >= minimumBytes && freePercent >= minimumPercent
    };
  } catch (error) {
    return { sufficient: false, error: error.message || String(error) };
  }
}

function backupBenachrichtigungStatus(options) {
  if (!options.alert.email) {
    return {
      enabled: false,
      configured: false,
      valid: false,
      recipient: '',
      error: 'E-Mail-Warnungen sind für diesen Zeitplan deaktiviert.'
    };
  }
  try {
    const mail = require('../mail/service');
    const config = mail.getSmtpConfig();
    const recipient = String(config && config.admin_recipient || '').trim();
    const configured = !!(mail.isConfigured(config) && recipient);
    return {
      enabled: true,
      configured,
      valid: configured,
      recipient,
      error: configured
        ? ''
        : 'Systemmail und Administrator-Empfänger sind noch nicht vollständig konfiguriert.'
    };
  } catch (error) {
    return {
      enabled: true,
      configured: false,
      valid: false,
      recipient: '',
      error: error.message || String(error)
    };
  }
}

async function backupVorpruefung(zielWert, rawOptions, jobId) {
  const options = backupScheduler.normalisiereOptionen(rawOptions || {});
  const ziel = backupZielFuerAdmin(zielWert);
  const marker = backupZielmarkeLesen(ziel);
  const targetMatches = !options.backupTargetId
    || (marker.valid && marker.targetId === options.backupTargetId);
  const offsitePassword = options.offsite.enabled
    ? backupSecretDateiStatus(options.offsite.passwordFile, 'Die restic-Passwortdatei')
    : { configured: false, valid: true, file: '', error: '' };
  const heartbeatSecret = options.heartbeat.enabled
    ? backupSecretDateiStatus(options.heartbeat.secretFile, 'Die Dead-Man-Secret-Datei')
    : { configured: false, valid: true, file: '', error: '' };
  const protection = {
    localTargetEncryptedAttested: !!options.localTargetEncryptedAttested,
    retentionConfigured: !!options.retention.enabled,
    offsiteConfigured: !!options.offsite.enabled,
    immutableAttested: !options.offsite.enabled || !!options.offsite.immutableAttested,
    lifecycleAttested: !options.offsite.enabled || !!options.offsite.lifecycleAttested,
    heartbeatConfigured: !!options.heartbeat.enabled,
    alertEmailEnabled: !!options.alert.email
  };
  const notification = backupBenachrichtigungStatus(options);
  const warnings = [];
  if (!marker.valid) warnings.push(marker.error);
  if (!targetMatches) warnings.push('Die TARGET_ID der Zielmarke stimmt nicht mit dem gespeicherten Zeitplan überein.');
  if (!offsitePassword.valid) warnings.push(offsitePassword.error);
  if (!heartbeatSecret.valid) warnings.push(heartbeatSecret.error);
  if (!protection.localTargetEncryptedAttested) {
    warnings.push('Die Verschlüsselung und Zugriffssicherung des lokalen Backupdatenträgers ist nicht bestätigt.');
  }
  if (!protection.retentionConfigured) warnings.push('Der Generationenplan ist nicht aktiviert.');
  if (!protection.offsiteConfigured) warnings.push('Die verschlüsselte Remote-Zweitkopie ist nicht aktiviert.');
  if (!protection.immutableAttested) warnings.push('Object Lock beziehungsweise append-only ist nicht bestätigt.');
  if (!protection.lifecycleAttested) warnings.push('Die kompatible Remote-Aufbewahrungsregel ist nicht bestätigt.');
  if (!notification.valid) warnings.push(notification.error);
  const capacity = backupKapazitaetStatus(ziel, options);
  if (capacity && !capacity.sufficient) warnings.push(capacity.error || 'Die konfigurierte Kapazitätsreserve ist unterschritten.');
  let recoveryStatus;
  try {
    recoveryStatus = require('../admin/routes').intern.recoveryStatus();
  } catch (error) {
    recoveryStatus = {
      configured: false,
      strong: false,
      requiresRotation: false,
      snapshotsVerified: false,
      snapshots: {},
      error: error.message || String(error)
    };
  }
  const engine = await require('../backup/preflight').inspect({
    serverDir: SERVER_ROOT,
    dataDir: DOCUMENT_DATA_ROOT,
    dbPath: (db && db.name) || DATABASE_PATH,
    outputsDir: process.env.OUTPUTS_DIR || OUTPUTS_ROOT,
    appName: process.env.APP_FILE || 'Betreuungsbuero_Dokumentenassistent_v0_7.html',
    offsite: options.offsite,
    resticCredentialEnvFile: process.env.TOTAL_BACKUP_RESTIC_ENV_FILE || '',
    recoveryStatus
  });
  let offsiteMaintenance = {
    id: 'offsiteMaintenance',
    label: 'Getrennte Offsite-Aufbewahrungswartung',
    required: false,
    ok: true,
    status: 'not_required',
    code: 'not_required',
    message: 'Ohne aktiven Offsite-Generationenplan ist kein externer Lösch-/Prüflauf erforderlich.'
  };
  if (options.offsite.enabled && options.retention.enabled) {
    try {
      const maintenanceStatus = require('../backup/offsite-maintenance-status');
      offsiteMaintenance = maintenanceStatus.preflightComponent({
        statusDir: maintenanceStatus.configuredStatusDir(process.env),
        maxAgeHours: maintenanceStatus.configuredMaxAgeHours(process.env),
        repository: options.offsite.repository,
        tag: options.offsite.tag,
        jobId: String(jobId || 'manual-preflight'),
        policy: {
          daily: options.retention.daily,
          monthly: options.retention.monthly,
          yearly: options.retention.yearly
        }
      });
    } catch (error) {
      offsiteMaintenance = {
        id: 'offsiteMaintenance',
        label: 'Getrennte Offsite-Aufbewahrungswartung',
        required: true,
        ok: false,
        status: 'invalid_configuration',
        code: 'offsite_maintenance_invalid_configuration',
        message: error.message || String(error)
      };
    }
    if (!offsiteMaintenance.ok) warnings.push(offsiteMaintenance.message);
  }
  for (const error of [
    ...(engine.local.errors || []),
    ...(engine.recovery.errors || []),
    ...(engine.remote.errors || [])
  ]) {
    if (error && !warnings.includes(error)) warnings.push(error);
  }
  const localReady = !!(
    marker.valid && targetMatches && heartbeatSecret.valid
    && (!capacity || capacity.sufficient) && engine.localReady
  );
  const recoveryReady = !!engine.recoveryReady;
  const remoteReady = !!(
    offsitePassword.valid && engine.remoteReady
    && (!offsiteMaintenance.required || offsiteMaintenance.ok)
  );
  const protectionAttested = !!(
    protection.localTargetEncryptedAttested
    && protection.retentionConfigured
    && protection.offsiteConfigured
    && protection.immutableAttested
    && protection.lifecycleAttested
  );
  return {
    ok: true,
    target: {
      path: ziel,
      markerPresent: marker.present,
      markerValid: marker.valid,
      targetId: marker.targetId,
      expectedTargetId: options.backupTargetId || '',
      targetMatches,
      error: marker.error
    },
    files: { offsitePassword, heartbeatSecret },
    protection,
    readiness: {
      localReady,
      recoveryReady,
      remoteReady,
      protectionAttested
    },
    local: engine.local,
    recovery: engine.recovery,
    remote: { ...engine.remote, maintenance: offsiteMaintenance },
    notification,
    capacity,
    technicalReady: localReady && recoveryReady && remoteReady,
    protectionComplete: protectionAttested && notification.valid,
    warnings
  };
}

function backupOffsiteBacklogPruefen(jobId, ziel, options) {
  if (!ziel || ziel.art !== 'gesamt') return null;
  const normalized = backupScheduler.normalisiereOptionen(options || {});
  if (!normalized.backupTargetId) {
    return {
      available: true,
      unbound: true,
      total: 0,
      currentProfile: 0,
      foreignProfile: 0,
      otherJob: 0,
      foreignTarget: 0,
      invalid: 0,
      pendingForJob: 0,
      blocksProfileChange: false,
      warning: false
    };
  }
  try {
    return {
      available: true,
      unbound: false,
      ...inspectOffsiteBacklog({
        destination: ziel.ordner,
        jobId: String(jobId || ''),
        expectedTargetId: normalized.backupTargetId,
        offsite: normalized.offsite
      })
    };
  } catch (error) {
    return {
      available: false,
      unbound: false,
      error: error.message || String(error),
      blocksProfileChange: true,
      warning: true
    };
  }
}

function backupOffsiteProfilSignatur(options) {
  const normalized = backupScheduler.normalisiereOptionen(options || {});
  return JSON.stringify({
    enabled: normalized.offsite.enabled,
    repository: normalized.offsite.repository,
    passwordFile: normalized.offsite.passwordFile,
    tag: normalized.offsite.tag
  });
}

function backupPendingSidecarLesen(file, expectedName) {
  const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    const named = fs.lstatSync(file);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink()
        || opened.dev !== named.dev || opened.ino !== named.ino
        || opened.size < 2 || opened.size > 65536) return null;
    const text = fs.readFileSync(descriptor, 'utf8');
    const after = fs.fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || after.ctimeMs !== opened.ctimeMs) return null;
    const values = Object.create(null);
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      const pos = line.indexOf('=');
      if (pos <= 0) return null;
      const key = line.slice(0, pos);
      if (Object.prototype.hasOwnProperty.call(values, key)) return null;
      values[key] = line.slice(pos + 1);
    }
    if (values.FORMAT !== 'Betreuungsbuero-Offsite-Pending/1'
        || values.SNAPSHOT !== expectedName
        || !values.JOB_ID) return null;
    return { values, text, dev: opened.dev, ino: opened.ino };
  } catch (_error) {
    return null;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function backupAbandonmentSidecars(jobId, job) {
  const result = {
    available: false,
    target: '',
    pending: [],
    abandoned: [],
    unclassifiedPending: 0,
    error: ''
  };
  if (!job || job.configurationError || !job.ziel || job.ziel.art !== 'gesamt') {
    result.error = (job && job.configurationError) || 'Das frühere Gesamtsicherungsziel ist nicht eindeutig konfiguriert.';
    return result;
  }
  let target;
  try { target = backupZielFuerAdmin(job.ziel.ordner); }
  catch (error) {
    result.error = error.message || String(error);
    return result;
  }
  result.available = true;
  result.target = target;
  for (const name of fs.readdirSync(target)) {
    const match = name.match(
      /^(Gesamtsicherung_[0-9]{8}_[0-9]{6}(?:_[A-Za-z0-9_.-]+)?)\.(offsite-pending|offsite-abandoned)$/
    );
    if (!match) continue;
    const parsed = backupPendingSidecarLesen(path.join(target, name), match[1]);
    if (!parsed) {
      if (match[2] === 'offsite-pending') result.unclassifiedPending += 1;
      continue;
    }
    if (String(parsed.values.JOB_ID) !== String(jobId)) continue;
    const entry = {
      name,
      snapshotName: match[1],
      source: path.join(target, name),
      destination: path.join(target, `${match[1]}.offsite-abandoned`)
    };
    if (match[2] === 'offsite-pending') result.pending.push(entry);
    else result.abandoned.push(entry);
  }
  return result;
}

function backupVerzeichnisDauerhaft(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

function backupPendingAlsVerlassenMarkieren(scan) {
  if (!scan || !scan.available || !scan.pending.length) return [];
  const moved = [];
  try {
    for (const entry of scan.pending) {
      if (fs.existsSync(entry.destination)) {
        throw new Error(`Die Verlassen-Markierung für ${entry.snapshotName} existiert bereits doppelt.`);
      }
      fs.renameSync(entry.source, entry.destination);
      moved.push(entry);
    }
    backupVerzeichnisDauerhaft(scan.target);
    return moved;
  } catch (error) {
    for (const entry of moved.slice().reverse()) {
      try {
        if (!fs.existsSync(entry.source) && fs.existsSync(entry.destination)) {
          fs.renameSync(entry.destination, entry.source);
        }
      } catch (_rollbackError) { /* sichtbar und beim Wiederholen prüfbar */ }
    }
    try { backupVerzeichnisDauerhaft(scan.target); } catch (_syncError) { /* Hauptfehler bleibt */ }
    throw error;
  }
}

function backupVerlassenMarkierungZurueck(moved, target) {
  let firstError = null;
  for (const entry of (moved || []).slice().reverse()) {
    try {
      if (!fs.existsSync(entry.source) && fs.existsSync(entry.destination)) {
        fs.renameSync(entry.destination, entry.source);
      }
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }
  try { if (target) backupVerzeichnisDauerhaft(target); }
  catch (error) { if (!firstError) firstError = error; }
  if (firstError) throw firstError;
}

function backupBacklogAenderungPruefen(row, alt, neu) {
  const targetChanged = String(alt.ziel && alt.ziel.ordner || '')
    !== String(neu.ziel && neu.ziel.ordner || '');
  const profileChanged = backupOffsiteProfilSignatur(alt.options)
    !== backupOffsiteProfilSignatur(neu.options);
  if (!targetChanged && !profileChanged) return null;
  const oldBacklog = backupOffsiteBacklogPruefen(row.id, alt.ziel, alt.options);
  if (!oldBacklog || (!oldBacklog.blocksProfileChange && !Number(oldBacklog.foreignTarget || 0))) {
    return null;
  }
  // Ein Profilwechsel zurück zu genau dem Profil aller wartenden Generationen
  // ist der einzige sichere automatische Auflösungsweg. Zielwechsel, Abschalten
  // oder eine weitere Abweichung würden die lokale Generation verwaisen lassen.
  if (!targetChanged && oldBacklog.available && !Number(oldBacklog.invalid || 0)
      && !Number(oldBacklog.foreignTarget || 0)) {
    const proposed = backupOffsiteBacklogPruefen(row.id, neu.ziel, neu.options);
    if (proposed && proposed.available
        && Number(proposed.pendingForJob || 0) === Number(oldBacklog.pendingForJob || 0)
        && Number(proposed.foreignProfile || 0) === 0
        && Number(proposed.invalid || 0) === 0) {
      return null;
    }
  }
  return oldBacklog;
}

router.get('/backup-health', requireViewDocuments, (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Den Zustand der Gesamtsicherung dürfen ausschließlich Administratoren einsehen.' });
  }
  try { res.json(backupScheduler.health()); }
  catch (error) { res.status(500).json({ error: 'Sicherungszustand konnte nicht gelesen werden: ' + (error.message || error) }); }
});
router.get('/backup-jobs', requireViewDocuments, (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Sicherungs-Zeitpläne dürfen ausschließlich Administratoren einsehen.' });
  }
  const jobs = bkListStmt.all().map(backupJobJson);
  let healthById = new Map();
  try { healthById = new Map(backupScheduler.health().jobs.map((entry) => [String(entry.id), entry])); }
  catch (_e) { /* Zeitpläne bleiben auch bei Diagnosefehler editierbar */ }
  res.json({
    verwalten: true,
    jobs: jobs.map((job) => ({ ...job, health: healthById.get(String(job.id)) || null }))
  });
});
router.post('/backup-preflight', requireViewDocuments, async (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Die Sicherungsvorprüfung dürfen ausschließlich Administratoren ausführen.' });
  }
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const body = req.body || {};
  try {
    let ziel = body.ziel;
    let options = body.options;
    let preflightJobId = '';
    if (body.jobId) {
      const row = bkGetStmt.get(String(body.jobId));
      if (!row) return res.status(404).json({ error: 'Zeitplan nicht gefunden.' });
      const job = backupJobJson(row);
      if (job.configurationError || job.optionsError) {
        throw new Error(job.configurationError || job.optionsError);
      }
      if (job.ziel.art !== 'gesamt') throw new Error('Die Vorprüfung gilt nur für Gesamtsicherungen.');
      ziel = job.ziel.ordner;
      options = job.options;
      preflightJobId = row.id;
    } else if (!ziel || String(ziel.art || '') !== 'gesamt') {
      throw new Error('Die Vorprüfung braucht ein Gesamtsicherungsziel.');
    } else {
      ziel = ziel.ordner;
    }
    return res.json(await backupVorpruefung(ziel, options, preflightJobId));
  } catch (error) {
    return res.status(400).json({ error: error.message || String(error) });
  }
});
router.post('/backup-target/initialize', requireEditDocuments, (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Sicherungsziele dürfen ausschließlich Administratoren initialisieren.' });
  }
  if (!req.body || req.body.confirm !== true) {
    return res.status(400).json({ error: 'Die ausdrückliche Bestätigung zur Initialisierung der Zielmarke fehlt.' });
  }
  let ziel;
  try { ziel = backupZielFuerAdmin(req.body.ordner); }
  catch (error) { return res.status(400).json({ error: error.message || String(error) }); }
  const existing = backupZielmarkeLesen(ziel);
  if (existing.valid) {
    return res.json({ ok: true, created: false, target: existing });
  }
  if (existing.present) {
    return res.status(409).json({
      error: 'Am Ziel liegt bereits eine ungültige oder beschädigte Zielmarke. Sie wird nicht überschrieben.',
      target: existing
    });
  }
  const targetId = crypto.randomUUID();
  const marker = path.join(ziel, BACKUP_TARGET_MARKER);
  const payload = `${BACKUP_TARGET_MARKER_HEADER}\nTARGET_ID=${targetId}\nCREATED_AT=${new Date().toISOString()}\n`;
  let descriptor = null;
  try {
    descriptor = fs.openSync(marker, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeFileSync(descriptor, payload, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    try {
      const directory = fs.openSync(ziel, fs.constants.O_RDONLY);
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } catch (_error) { /* nicht jedes Dateisystem erlaubt Verzeichnis-fsync */ }
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_closeError) { /* best effort */ }
    }
    if (error.code !== 'EEXIST') {
      try { fs.unlinkSync(marker); } catch (_unlinkError) { /* unvollständige Marke bleibt fail-closed */ }
      return res.status(500).json({ error: 'Die Zielmarke konnte nicht sicher angelegt werden: ' + (error.message || error) });
    }
  }
  const target = backupZielmarkeLesen(ziel);
  if (!target.valid) {
    return res.status(409).json({ error: 'Die Zielmarke ist nach der Initialisierung nicht gültig.', target });
  }
  return res.status(201).json({ ok: true, created: true, target });
});
router.post('/backup-jobs', requireEditDocuments, (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Sicherungs-Zeitpläne dürfen ausschließlich Administratoren verwalten.' });
  let b;
  try { b = backupJobPruefen(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (b.ziel.art === 'gesamt') {
    const marker = backupZielmarkeLesen(b.ziel.ordner);
    const lineageTargetId = String(
      b.options.backupTargetId || (marker.valid ? marker.targetId : '')
    );
    if (andererGesamtZeitplanDerselbenLinie(b.ziel.ordner, lineageTargetId, '')) {
      return res.status(409).json({
        error: 'Für dieses Sicherungsziel besteht bereits ein Gesamtsicherungs-Zeitplan. '
          + 'Bitte diesen Zeitplan bearbeiten oder wieder aktivieren; seine dauerhafte Kennung schützt lokale und entfernte Generationen.'
      });
    }
  }
  const id = crypto.randomUUID();
  bkInsStmt.run(id, b.label, b.interval, b.weekdays, b.zeit, JSON.stringify(b.quelle), JSON.stringify(b.ziel), JSON.stringify(b.options), 1, req.session.userId);
  res.status(201).json(backupJobJson(bkGetStmt.get(id)));
});
router.patch('/backup-jobs/:id', requireEditDocuments, (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Sicherungs-Zeitpläne dürfen ausschließlich Administratoren verwalten.' });
  const row = bkGetStmt.get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Zeitplan nicht gefunden.' });
  if (String(row.run_started_at || '')) {
    return res.status(409).json({
      error: 'Ein laufender oder administrativ reservierter Sicherungslauf muss zuerst abgeschlossen werden.',
      code: 'BACKUP_JOB_RUNNING'
    });
  }
  const alt = backupJobJson(row);
  const body = req.body || {};
  if (Object.keys(body).length === 1 && Object.prototype.hasOwnProperty.call(body, 'enabled')) {
    if (body.enabled && (alt.configurationError || alt.optionsError)) {
      const error = alt.configurationError || alt.optionsError;
      return res.status(400).json({ error: error + ' Bitte korrigieren Sie zuerst die Konfiguration des Zeitplans.' });
    }
    if (body.enabled) {
      const ziel = gesamtZielVonZeile(row);
      if (ziel) {
        const marker = backupZielmarkeLesen(ziel);
        const lineageTargetId = String(
          alt.options && alt.options.backupTargetId
          || (marker.valid ? marker.targetId : '')
        );
        if (andererGesamtZeitplanDerselbenLinie(ziel, lineageTargetId, row.id)) {
          return res.status(409).json({
            error: 'Diese Sicherungslinie gehört bereits zu einem anderen Gesamtsicherungs-Zeitplan. '
              + 'Bitte diesen bearbeiten oder wieder aktivieren.',
            code: 'BACKUP_LINEAGE_ALREADY_EXISTS'
          });
        }
      }
      if (ziel && anderesAktivesGesamtZiel(ziel, row.id)) {
        return res.status(409).json({ error: 'Für dieses Ziel existiert bereits eine aktive Gesamtsicherung. Pro Ziel ist genau ein verantwortlicher Zeitplan zulässig.' });
      }
    }
    bkUpdStmt.run(row.label, row.interval, row.weekdays, row.time_hhmm, row.source_json, row.target_json, row.options_json || '{}', body.enabled ? 1 : 0, row.id);
    return res.json(backupJobJson(bkGetStmt.get(row.id)));
  }
  if (body.options === undefined && alt.optionsError) {
    return res.status(400).json({ error: alt.optionsError + ' Bitte übermitteln Sie einen vollständigen gültigen Optionssatz.' });
  }
  let b;
  try {
    b = backupJobPruefen({ label: body.label !== undefined ? body.label : alt.label,
      interval: body.interval || alt.interval, weekdays: body.weekdays !== undefined ? body.weekdays : alt.weekdays,
      timeHhmm: body.timeHhmm || alt.timeHhmm, quelle: body.quelle || alt.quelle, ziel: body.ziel || alt.ziel,
      options: body.options !== undefined ? body.options : alt.options });
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const wirdAktiv = Object.prototype.hasOwnProperty.call(body, 'enabled') ? !!body.enabled : !!row.enabled;
  if (b.ziel.art === 'gesamt') {
    const marker = backupZielmarkeLesen(b.ziel.ordner);
    const lineageTargetId = String(
      b.options.backupTargetId || (marker.valid ? marker.targetId : '')
    );
    if (andererGesamtZeitplanDerselbenLinie(
      b.ziel.ordner,
      lineageTargetId,
      row.id
    )) {
      return res.status(409).json({
        error: 'Dieses Sicherungsziel beziehungsweise seine TARGET_ID gehört bereits zu einem anderen Gesamtsicherungs-Zeitplan. '
          + 'Bitte dessen dauerhafte Sicherungslinie bearbeiten oder wieder aktivieren.',
        code: 'BACKUP_LINEAGE_ALREADY_EXISTS'
      });
    }
  }
  if (wirdAktiv && b.ziel.art === 'gesamt' && anderesAktivesGesamtZiel(b.ziel.ordner, row.id)) {
    return res.status(409).json({ error: 'Für dieses Ziel existiert bereits eine aktive Gesamtsicherung. Pro Ziel ist genau ein verantwortlicher Zeitplan zulässig.' });
  }
  const targetChanged = alt.ziel && alt.ziel.art === 'gesamt'
    && b.ziel.art === 'gesamt'
    && path.resolve(String(alt.ziel.ordner || '')) !== path.resolve(String(b.ziel.ordner || ''));
  if (targetChanged && backupJobHatDauerhafteHistorie(row)) {
    const previousTargetId = String(alt.options && alt.options.backupTargetId || '').toLowerCase();
    const nextMarker = backupZielmarkeLesen(b.ziel.ordner);
    if (!previousTargetId || !nextMarker.valid || nextMarker.targetId !== previousTargetId) {
      return res.status(409).json({
        error: 'Ein Gesamtsicherungs-Zeitplan mit veröffentlichter Historie darf nicht auf eine neue Zielkennung wechseln. '
          + 'Für einen reinen Pfad-/Datenträgerumzug muss der vollständige Zielbestand einschließlich unveränderter TARGET_ID übernommen werden.',
        code: 'BACKUP_LINEAGE_TARGET_CHANGE_BLOCKED'
      });
    }
    b.options.backupTargetId = previousTargetId;
  }
  const backlogBlock = backupBacklogAenderungPruefen(row, alt, b);
  if (backlogBlock) {
    return res.status(409).json({
      error: 'Ziel oder Offsite-Profil können nicht geändert werden, solange lokale Generationen auf ihre Remote-Zweitkopie warten. '
        + 'Stellen Sie das zu diesen Generationen gehörende frühere Profil wieder her oder lassen Sie den Bestand kontrolliert administrativ klären.',
      code: 'BACKUP_OFFSITE_BACKLOG_BLOCKS_CHANGE',
      abandonmentAvailable: true,
      requiredConfirmation: `BACKLOG VERLASSEN ${row.id}`,
      offsiteBacklog: backlogBlock
    });
  }
  const sourceJson = JSON.stringify(b.quelle);
  const targetJson = JSON.stringify(b.ziel);
  const optionsJson = JSON.stringify(b.options);
  const schutzOptionen = (options) => JSON.stringify({
    consistencyRetries: options.consistencyRetries,
    capacity: options.capacity,
    retention: options.retention,
    offsite: options.offsite
  });
  const historyChanged = sourceJson !== JSON.stringify(alt.quelle)
    || targetJson !== JSON.stringify(alt.ziel)
    || schutzOptionen(b.options) !== schutzOptionen(alt.options);
  const scheduleChanged = b.interval !== row.interval || b.weekdays !== row.weekdays || b.zeit !== row.time_hhmm;
  bkUpdStmt.run(b.label, b.interval, b.weekdays, b.zeit, sourceJson, targetJson, optionsJson, Object.prototype.hasOwnProperty.call(body, 'enabled') ? (body.enabled ? 1 : 0) : row.enabled, row.id);
  // Ein Erfolg auf dem alten Ziel darf nach einer Ziel-/Schutzänderung nicht
  // als Beweis für die neue Konfiguration erscheinen. Der echte historische
  // Erfolgszeitpunkt bleibt erhalten; Health verlangt nun einen neueren Lauf.
  if (historyChanged) bkMarkConfigChangedStmt.run(row.id);
  else if (scheduleChanged) bkResetScheduleStmt.run(row.id);
  res.json(backupJobJson(bkGetStmt.get(row.id)));
});
router.delete('/backup-jobs/:id', requireEditDocuments, (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Sicherungs-Zeitpläne dürfen ausschließlich Administratoren verwalten.' });
  const row = bkGetStmt.get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Zeitplan nicht gefunden.' });
  if (String(row.run_started_at || '')) {
    return res.status(409).json({
      error: 'Ein laufender oder administrativ reservierter Sicherungslauf muss zuerst abgeschlossen werden.',
      code: 'BACKUP_JOB_RUNNING'
    });
  }
  const job = backupJobJson(row);
  if (job.configurationError || job.optionsError) {
    return res.status(409).json({
      error: 'Ein ungültiger Zeitplan wird nicht gelöscht, bevor sein möglicher Offsite-Rückstand kontrolliert geprüft wurde.',
      code: 'BACKUP_CONFIGURATION_REPAIR_REQUIRED'
    });
  }
  const backlog = backupOffsiteBacklogPruefen(row.id, job.ziel, job.options);
  if (backlog && (backlog.blocksProfileChange || Number(backlog.foreignTarget || 0))) {
    return res.status(409).json({
      error: 'Der Zeitplan kann nicht gelöscht werden, solange lokale Generationen auf ihre Remote-Zweitkopie warten oder die Warteschlange nicht eindeutig lesbar ist.',
      code: 'BACKUP_OFFSITE_BACKLOG_BLOCKS_DELETE',
      abandonmentAvailable: true,
      requiredConfirmation: `BACKLOG VERLASSEN ${row.id}`,
      offsiteBacklog: backlog
    });
  }
  if (job.ziel && job.ziel.art === 'gesamt' && backupJobHatDauerhafteHistorie(row)) {
    return res.status(409).json({
      error: 'Dieser Gesamtsicherungs-Zeitplan besitzt bereits eine lokale oder entfernte Generationenlinie. '
        + 'Er wird deshalb nicht gelöscht: Bitte pausieren und später bearbeiten oder wieder aktivieren. '
        + 'So bleiben lokale Retention und der externe Job-Tag dauerhaft adressierbar.',
      code: 'BACKUP_LINEAGE_MUST_BE_RETAINED'
    });
  }
  bkDelStmt.run(row.id);
  res.json({ ok: true });
});
router.post('/backup-jobs/:id/abandon-backlog', requireEditDocuments, async (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({
      error: 'Einen nicht mehr erreichbaren Sicherungsrückstand dürfen ausschließlich Administratoren verlassen.'
    });
  }
  const id = String(req.params.id || '');
  let row = bkGetStmt.get(id);
  if (!row) return res.status(404).json({ error: 'Zeitplan nicht gefunden.' });
  if (String(row.run_started_at || '')) {
    return res.status(409).json({
      error: 'Der Zeitplan hat noch einen laufenden oder nicht abschließend geklärten Sicherungslauf.',
      code: 'BACKUP_JOB_RUNNING'
    });
  }
  const requiredConfirmation = `BACKLOG VERLASSEN ${id}`;
  const body = req.body || {};
  if (String(body.confirmation || '') !== requiredConfirmation
      || body.snapshotsRemainAcknowledged !== true) {
    return res.status(400).json({
      error: 'Die exakte Bestätigungsphrase und die Bestätigung zum Verbleib der lokalen Generationen fehlen.',
      requiredConfirmation
    });
  }
  const reason = String(body.reason || '').trim();
  if (reason.length < 10 || reason.length > 500) {
    return res.status(400).json({
      error: 'Bitte dokumentieren Sie den Grund mit 10 bis 500 Zeichen.'
    });
  }
  const admin = bkAdminForPasswordStmt.get(req.session.userId);
  let passwordMatches = false;
  try {
    passwordMatches = !!(
      admin && admin.password_hash
      && await verifyPassword(String(body.adminPassword || ''), admin.password_hash)
    );
  } catch (_error) { passwordMatches = false; }
  if (!passwordMatches) {
    return res.status(403).json({ error: 'Das aktuelle Admin-Kennwort ist nicht korrekt.' });
  }

  row = bkGetStmt.get(id);
  if (!row) return res.status(404).json({ error: 'Zeitplan wurde zwischenzeitlich entfernt.' });
  if (String(row.run_started_at || '')) {
    return res.status(409).json({
      error: 'Zwischenzeitlich wurde ein Sicherungslauf begonnen; die Aktion wurde nicht ausgeführt.',
      code: 'BACKUP_JOB_RUNNING'
    });
  }
  const reservation = 'abandon:' + crypto.randomUUID();
  const priorEnabled = row.enabled ? 1 : 0;
  const reserved = bkReserveAbandonedLineageStmt.run({
    id,
    reservation,
    priorEnabled,
    sourceJson: String(row.source_json || '{}'),
    targetJson: String(row.target_json || '{}'),
    optionsJson: String(row.options_json || '{}')
  });
  if (reserved.changes !== 1) {
    return res.status(409).json({
      error: 'Der Zeitplan wurde zwischen Prüfung und Stilllegung verändert oder gestartet.',
      code: 'BACKUP_JOB_RUNNING'
    });
  }

  let reservationActive = true;
  const releaseReservation = (enabled) => {
    const release = bkReleaseAbandonedLineageStmt.run({ id, reservation, enabled });
    if (release.changes !== 1) {
      throw new Error('Die administrative Laufreservierung konnte nicht eindeutig aufgehoben werden.');
    }
    reservationActive = false;
  };
  let moved = [];
  let abandonmentTarget = '';
  let alreadyReclassified = 0;
  try {
    const job = backupJobJson(row);
    const abandonmentScan = backupAbandonmentSidecars(id, job);
    abandonmentTarget = abandonmentScan.target;
    alreadyReclassified = abandonmentScan.abandoned.length;
    let backlog = null;
    if (!job.configurationError && !job.optionsError) {
      backlog = backupOffsiteBacklogPruefen(row.id, job.ziel, job.options);
      const blocks = backlog && (
        backlog.blocksProfileChange
        || Number(backlog.foreignTarget || 0)
        || backlog.available === false
      );
      if (!blocks && abandonmentScan.abandoned.length === 0) {
        releaseReservation(priorEnabled);
        return res.status(409).json({
          error: 'Für diesen Zeitplan besteht keine unauflösbare Blockade. Verwenden Sie die normale Löschfunktion.',
          code: 'BACKUP_BACKLOG_ABANDONMENT_NOT_REQUIRED',
          offsiteBacklog: backlog
        });
      }
    } else {
      backlog = {
        available: false,
        blocksProfileChange: true,
        warning: true,
        error: job.configurationError || job.optionsError
      };
    }
    if (abandonmentScan.available && abandonmentScan.unclassifiedPending > 0) {
      releaseReservation(priorEnabled);
      return res.status(409).json({
        error: 'Am Sicherungsziel liegen nicht eindeutig einem Zeitplan zuordenbare Pending-Markierungen. '
          + 'Die Aktion bleibt fail-closed; diese Markierungen müssen zuerst einzeln diagnostiziert werden.',
        code: 'BACKUP_BACKLOG_UNCLASSIFIED_PENDING',
        unclassifiedPending: abandonmentScan.unclassifiedPending
      });
    }

    const auditBacklog = backlog ? {
      available: backlog.available !== false,
      unbound: !!backlog.unbound,
      total: Number(backlog.total || 0),
      currentProfile: Number(backlog.currentProfile || 0),
      foreignProfile: Number(backlog.foreignProfile || 0),
      otherJob: Number(backlog.otherJob || 0),
      foreignTarget: Number(backlog.foreignTarget || 0),
      invalid: Number(backlog.invalid || 0),
      pendingForJob: Number(backlog.pendingForJob || 0),
      blocksProfileChange: !!backlog.blocksProfileChange,
      error: String(backlog.error || '').slice(0, 500)
    } : null;
    const details = {
      reason,
      snapshotsPreserved: true,
      filesDeleted: 0,
      priorEnabled: !!row.enabled,
      targetId: String(job.options && job.options.backupTargetId || ''),
      targetFingerprint: crypto.createHash('sha256')
        .update(String(job.ziel && job.ziel.ordner || row.target_json || ''))
        .digest('hex'),
      profileFingerprint: crypto.createHash('sha256')
        .update(backupOffsiteProfilSignatur(job.options || {}))
        .digest('hex'),
      pendingSidecarsReclassified: abandonmentScan.pending.length,
      alreadyReclassified: abandonmentScan.abandoned.length,
      futureRetentionEligible: abandonmentScan.pending.length + abandonmentScan.abandoned.length > 0,
      backlog: auditBacklog
    };
    moved = backupPendingAlsVerlassenMarkieren(abandonmentScan);
    db.transaction(() => {
      const current = bkGetStmt.get(id);
      if (!current || String(current.run_started_at || '') !== reservation) {
        throw new Error('Der Zeitplan wurde während der Bestätigung verändert oder gestartet.');
      }
      bkStrictAuditStmt.run({
        actorUserId: req.session.userId,
        actorUsername: String(req.session.displayName || req.session.username || ''),
        action: 'backup-job.abandon-backlog',
        targetType: 'doc-backup-job',
        targetId: id,
        detailsJson: JSON.stringify(details)
      });
      const retained = bkRetainAbandonedLineageStmt.run({ id, reservation });
      if (retained.changes !== 1) {
        throw new Error('Die dauerhafte Sicherungslinie konnte nicht eindeutig stillgelegt werden.');
      }
    })();
    reservationActive = false;
  } catch (error) {
    let rollbackError = null;
    try { backupVerlassenMarkierungZurueck(moved, abandonmentTarget); }
    catch (rollback) { rollbackError = rollback; }
    let releaseError = null;
    if (reservationActive) {
      try {
        releaseReservation(
          // Bei unklarer Dateisystem-Rücknahme bleibt der Job sicherheitshalber
          // pausiert, bis der sichtbare Befund administrativ geklärt wurde.
          rollbackError ? 0 : priorEnabled
        );
      } catch (releaseFailure) { releaseError = releaseFailure; }
    }
    return res.status(409).json({
      error: 'Die auditierte Auflösung wurde nicht ausgeführt: ' + (error.message || error)
        + (rollbackError
          ? ' Die Sidecar-Rücknahme ist fehlgeschlagen und muss vor einem neuen Versuch geprüft werden: '
            + (rollbackError.message || rollbackError)
          : '')
        + (releaseError
          ? ' Die Sicherungslinie bleibt vorsorglich reserviert: ' + (releaseError.message || releaseError)
          : ''),
      code: 'BACKUP_BACKLOG_ABANDONMENT_FAILED'
    });
  }
  return res.json({
    ok: true,
    removed: false,
    retainedAsLineage: true,
    enabled: false,
    snapshotsPreserved: true,
    filesDeleted: 0,
    pendingSidecarsReclassified: moved.length,
    futureRetentionEligible: moved.length + alreadyReclassified > 0,
    auditAction: 'backup-job.abandon-backlog'
  });
});
router.get('/backup-jobs/:id/download-latest', requireViewDocuments, async (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({
      error: 'Eine vollständige Gesamtsicherung dürfen ausschließlich Administratoren herunterladen.'
    });
  }
  if (bkDownloadActive) {
    return res.status(409).json({
      error: 'Eine Gesamtsicherung wird bereits als Downloadpaket vorbereitet.',
      code: 'BACKUP_DOWNLOAD_ACTIVE'
    });
  }
  const row = bkGetStmt.get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Zeitplan nicht gefunden.' });
  const job = backupJobJson(row);
  if (job.configurationError || job.optionsError
      || !job.ziel || job.ziel.art !== 'gesamt') {
    return res.status(409).json({
      error: job.configurationError || job.optionsError
        || 'Nur eine Gesamtsicherung kann vollständig heruntergeladen werden.',
      code: 'BACKUP_DOWNLOAD_CONFIGURATION_INVALID'
    });
  }
  const targetId = String(job.options && job.options.backupTargetId || '').toLowerCase();
  if (!targetId) {
    return res.status(409).json({
      error: 'Die Sicherungslinie besitzt noch keine gebundene TARGET_ID. Bitte zuerst Vorprüfung und Sicherungslauf ausführen.',
      code: 'BACKUP_DOWNLOAD_TARGET_UNBOUND'
    });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-backup-download-'));
  fs.chmodSync(tempDir, 0o700);
  const zipPath = path.join(tempDir, 'Gesamtsicherung.zip');
  const cleanup = () => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_error) { /* temp */ }
  };
  bkDownloadActive = true;
  let result;
  try {
    result = await backupDownloadWorker({
      targetDir: String(job.ziel.ordner || ''),
      jobId: String(row.id),
      targetId,
      zipPath
    });
  } catch (error) {
    cleanup();
    const conflict = /nicht gefunden|nicht als VOLLSTAENDIG|Manifest|Snapshot|TARGET_ID|Sicherungslinie|vertauscht|fehlt/i
      .test(String(error && error.message || error));
    return res.status(conflict ? 409 : 500).json({
      error: 'Die Gesamtsicherung wurde nicht zum Download freigegeben: ' + String(error && error.message || error),
      code: String(error && error.code || 'BACKUP_DOWNLOAD_FAILED')
    });
  } finally {
    bkDownloadActive = false;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.download(
    zipPath,
    `${result.snapshotName}.zip`,
    (error) => {
      cleanup();
      if (error && !res.headersSent) {
        res.status(500).json({ error: 'Der vorbereitete ZIP-Download konnte nicht übertragen werden.' });
      }
    }
  );
});
router.post('/backup-jobs/:id/run', requireEditDocuments, (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Sicherungs-Zeitpläne dürfen ausschließlich Administratoren verwalten.' });
  const row = bkGetStmt.get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Zeitplan nicht gefunden.' });
  if (!row.enabled) {
    return res.status(409).json({ error: 'Der Sicherungs-Zeitplan ist pausiert.' });
  }
  if (String(row.run_started_at || '')) {
    return res.status(409).json({ error: 'Dieser Sicherungs-Zeitplan ist bereits aktiv oder administrativ reserviert.' });
  }
  // Die Reservierung erfolgt synchron: Zwei schnelle Klicks dürfen nicht
  // beide 200 liefern und anschließend um dieselbe Schreibschranke konkurrieren.
  // Der eigentliche Lauf bleibt asynchron, damit die HTTP-Antwort nicht hinter
  // der während der lokalen Aufnahme aktiven Schreibschranke festhängt.
  const accepted = backupScheduler.starteJetzt(String(req.params.id));
  if (!accepted.started) return res.status(409).json({ error: accepted.reason || 'Ein Sicherungslauf ist bereits aktiv.' });
  accepted.completion.catch(() => { /* Ergebnis, Retry und Warnstatus stehen dauerhaft in der DB. */ });
  return res.status(202).json({ gestartet: true });
});

/* ---------- Import-Eingang (D29): Anbieter -> Serverspeicher ---------- */
const impListStmt = db.prepare('SELECT * FROM doc_import_jobs ORDER BY created_at');
const impGetStmt = db.prepare('SELECT * FROM doc_import_jobs WHERE id = ?');
const impInsStmt = db.prepare('INSERT INTO doc_import_jobs (id, label, mount_id, source_path, target_json, enabled, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
const impUpdStmt = db.prepare('UPDATE doc_import_jobs SET label = ?, mount_id = ?, source_path = ?, target_json = ?, enabled = ? WHERE id = ?');
const impDelStmt = db.prepare('DELETE FROM doc_import_jobs WHERE id = ?');
const impStateDelStmt = db.prepare('DELETE FROM doc_import_state WHERE job_id = ?');
function importJobJson(r) {
  let ziel = {};
  try { ziel = JSON.parse(r.target_json || '{}'); } catch (_e) { /* leer */ }
  return { id: r.id, label: r.label, mountId: r.mount_id, quellPfad: r.source_path, ziel,
    enabled: !!r.enabled, lastRunAt: r.last_run_at, lastResult: r.last_result };
}
/* Liegt Pfad a in Pfad b (oder umgekehrt)? Leerer Pfad = Wurzel = umfasst alles. */
function impPfadIn(a, b) { return !b || a === b || a.startsWith(b + '/'); }
function importQuelleKollidiert(mountId, quellPfad) {
  for (const r of bkListStmt.all()) {
    if (!r.enabled) continue;
    let ziel = {};
    try { ziel = JSON.parse(r.target_json || '{}'); } catch (_e) { continue; }
    if (ziel.art !== 'mount' || String(ziel.mountId) !== String(mountId)) continue;
    const zp = mountSegmente(ziel.unterordner).join('/');
    if (impPfadIn(quellPfad, zp) || impPfadIn(zp, quellPfad)) return r.label || 'Sicherung';
  }
  return '';
}
function importZielKollidiert(mountId, unterordner) {
  const zp = mountSegmente(unterordner).join('/');
  for (const r of impListStmt.all()) {
    if (!r.enabled || String(r.mount_id) !== String(mountId)) continue;
    const qp = mountSegmente(r.source_path).join('/');
    if (impPfadIn(qp, zp) || impPfadIn(zp, qp)) return r.label || 'Import-Eingang';
  }
  return '';
}
function importJobPruefen(b) {
  if (!mountGetStmt.get(String(b.mountId || ''))) throw new Error('Die gewählte Verbindung gibt es nicht (mehr).');
  const quellPfad = mountSegmente(b.quellPfad).join('/');
  const ziel = b.ziel || {};
  const area = ziel.area === 'office' ? 'office' : ziel.area === 'case' ? 'case' : '';
  if (!area) throw new Error('Bitte einen Ziel-Bereich wählen (Büroorganisation oder Fallakte).');
  if (area === 'case' && !String(ziel.caseId || '').trim()) throw new Error('Bitte eine Fallakte wählen.');
  const kollision = importQuelleKollidiert(String(b.mountId), quellPfad);
  if (kollision) throw new Error('Schleifenschutz: Der Quellordner ist Ziel des Sicherungs-/Synchronisationsauftrags „' + kollision + '“ auf derselben Verbindung - das würde eine Kopier-Schleife erzeugen. Bitte einen anderen Quellordner wählen.');
  const prKoll2 = pairPfadeKollidieren(String(b.mountId), quellPfad, '');
  if (prKoll2) throw new Error('Schleifenschutz: Der Quellordner überlappt die Zwei-Wege-Paarung „' + prKoll2 + '“ auf derselben Verbindung - die Paarung überträgt dort bereits in beide Richtungen.');
  return { label: String(b.label || '').trim() || 'Import-Eingang', mountId: String(b.mountId), quellPfad,
    ziel: { area, caseId: area === 'case' ? String(ziel.caseId || '') : '', folderId: String(ziel.folderId || '') } };
}
router.get('/import-jobs', requireViewDocuments, (req, res) => {
  res.json({ verwalten: darfMountVerwaltung(req), jobs: impListStmt.all().map(importJobJson) });
});
router.post('/import-jobs', requireEditDocuments, (req, res) => {
  if (!darfMountVerwaltung(req)) return res.status(403).json({ error: 'Import-Eingänge dürfen nur Admins oder Nutzer mit Bürostammdaten-Recht verwalten.' });
  let b;
  try { b = importJobPruefen(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  const id = crypto.randomUUID();
  impInsStmt.run(id, b.label, b.mountId, b.quellPfad, JSON.stringify(b.ziel), 1, req.session.userId);
  res.status(201).json(importJobJson(impGetStmt.get(id)));
});
router.patch('/import-jobs/:id', requireEditDocuments, (req, res) => {
  if (!darfMountVerwaltung(req)) return res.status(403).json({ error: 'Import-Eingänge dürfen nur Admins oder Nutzer mit Bürostammdaten-Recht verwalten.' });
  const row = impGetStmt.get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Import-Eingang nicht gefunden.' });
  const body = req.body || {};
  if (Object.keys(body).length === 1 && Object.prototype.hasOwnProperty.call(body, 'enabled')) {
    impUpdStmt.run(row.label, row.mount_id, row.source_path, row.target_json, body.enabled ? 1 : 0, row.id);
    return res.json(importJobJson(impGetStmt.get(row.id)));
  }
  const alt = importJobJson(row);
  let b;
  try {
    b = importJobPruefen({ label: body.label !== undefined ? body.label : alt.label,
      mountId: body.mountId || alt.mountId, quellPfad: body.quellPfad !== undefined ? body.quellPfad : alt.quellPfad,
      ziel: body.ziel || alt.ziel });
  } catch (e) { return res.status(400).json({ error: e.message }); }
  impUpdStmt.run(b.label, b.mountId, b.quellPfad, JSON.stringify(b.ziel), Object.prototype.hasOwnProperty.call(body, 'enabled') ? (body.enabled ? 1 : 0) : row.enabled, row.id);
  res.json(importJobJson(impGetStmt.get(row.id)));
});
router.delete('/import-jobs/:id', requireEditDocuments, (req, res) => {
  if (!darfMountVerwaltung(req)) return res.status(403).json({ error: 'Import-Eingänge dürfen nur Admins oder Nutzer mit Bürostammdaten-Recht verwalten.' });
  impDelStmt.run(String(req.params.id));
  impStateDelStmt.run(String(req.params.id));
  res.json({ ok: true });
});
router.post('/import-jobs/:id/run', requireEditDocuments, (req, res) => {
  if (!darfMountVerwaltung(req)) return res.status(403).json({ error: 'Import-Eingänge dürfen nur Admins oder Nutzer mit Bürostammdaten-Recht verwalten.' });
  if (!impGetStmt.get(String(req.params.id))) return res.status(404).json({ error: 'Import-Eingang nicht gefunden.' });
  // Kein require-Zyklus: der Laeufer (server/doc-backup.js) lauscht auf dieses Ereignis.
  process.emit('dok-import-lauf', String(req.params.id));
  res.json({ gestartet: true });
});

/* ---------- Zwei-Wege-Fallordner-Paarung (D30) ---------- */
const prListStmt = db.prepare('SELECT * FROM doc_pair_jobs ORDER BY created_at');
const prGetStmt = db.prepare('SELECT * FROM doc_pair_jobs WHERE id = ?');
const prInsStmt = db.prepare('INSERT INTO doc_pair_jobs (id, label, mount_id, source_path, target_json, enabled, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
const prUpdStmt = db.prepare('UPDATE doc_pair_jobs SET label = ?, mount_id = ?, source_path = ?, target_json = ?, enabled = ? WHERE id = ?');
const prDelStmt = db.prepare('DELETE FROM doc_pair_jobs WHERE id = ?');
const prStateDelStmt = db.prepare('DELETE FROM doc_pair_state WHERE pair_id = ?');
const prCasesStmt = db.prepare('SELECT id, label FROM cases');
function pairJobJson(r) {
  let ziel = {};
  try { ziel = JSON.parse(r.target_json || '{}'); } catch (_e) { /* leer */ }
  return { id: r.id, label: r.label, mountId: r.mount_id, quellPfad: r.source_path, ziel,
    enabled: !!r.enabled, lastRunAt: r.last_run_at, lastResult: r.last_result };
}
function pairPfadeKollidieren(mountId, pfad, ausserId) {
  for (const r of prListStmt.all()) {
    if (!r.enabled || r.id === ausserId || String(r.mount_id) !== String(mountId)) continue;
    const qp = mountSegmente(r.source_path).join('/');
    if (impPfadIn(qp, pfad) || impPfadIn(pfad, qp)) return r.label || 'Paarung';
  }
  return '';
}
/* Liegt Ordner id im Ast unter wurzelId? '' = Bereichs-Hauptordner (umfasst alles). */
function folderIstUnter(id, wurzelId) {
  if (!wurzelId) return true;
  let cur = String(id || '');
  let schutz = 0;
  while (cur && schutz++ < 60) {
    if (cur === String(wurzelId)) return true;
    const f = folderGetStmt.get(cur);
    cur = f ? String(f.parent_id || '') : '';
  }
  return false;
}
function pairJobPruefen(b, ausserId) {
  if (!mountGetStmt.get(String(b.mountId || ''))) throw new Error('Die gewählte Verbindung gibt es nicht (mehr).');
  const quellPfad = mountSegmente(b.quellPfad).join('/');
  const ziel = b.ziel || {};
  const area = ziel.area === 'office' ? 'office' : ziel.area === 'case' ? 'case' : '';
  if (!area) throw new Error('Bitte einen Ziel-Bereich wählen (Büroorganisation oder Fallakte).');
  if (area === 'case' && !String(ziel.caseId || '').trim()) throw new Error('Bitte eine Fallakte wählen.');
  const folderId = String(ziel.folderId || '');
  const k1 = importQuelleKollidiert(String(b.mountId), quellPfad);
  if (k1) throw new Error('Schleifenschutz: Der Anbieter-Ordner ist Ziel der Sicherung/Synchronisation „' + k1 + '“ - bitte einen anderen Ordner wählen.');
  const k2 = importZielKollidiert(String(b.mountId), quellPfad);
  if (k2) throw new Error('Schleifenschutz: Der Anbieter-Ordner ist Quellordner des Import-Eingangs „' + k2 + '“ - bitte dort entfernen oder einen anderen Ordner wählen.');
  const k3 = pairPfadeKollidieren(String(b.mountId), quellPfad, String(ausserId || ''));
  if (k3) throw new Error('Schleifenschutz: Der Anbieter-Ordner überlappt die bestehende Paarung „' + k3 + '“.');
  for (const r of prListStmt.all()) {
    if (!r.enabled || r.id === String(ausserId || '')) continue;
    let z = {};
    try { z = JSON.parse(r.target_json || '{}'); } catch (_e) { continue; }
    const zArea = z.area === 'office' ? 'office' : 'case';
    if (zArea !== area || String(z.caseId || '') !== (area === 'case' ? String(ziel.caseId || '') : '')) continue;
    const zf = String(z.folderId || '');
    if (folderIstUnter(folderId, zf) || folderIstUnter(zf, folderId)) throw new Error('Der Speicher-Zielordner überlappt bereits die Paarung „' + (r.label || 'Paarung') + '“.');
  }
  return { label: String(b.label || '').trim() || 'Fallordner-Paarung', mountId: String(b.mountId), quellPfad,
    ziel: { area, caseId: area === 'case' ? String(ziel.caseId || '') : '', folderId } };
}
router.get('/pair-jobs', requireViewDocuments, (req, res) => {
  res.json({ verwalten: darfMountVerwaltung(req), jobs: prListStmt.all().map(pairJobJson) });
});
router.post('/pair-jobs', requireEditDocuments, (req, res) => {
  if (!darfMountVerwaltung(req)) return res.status(403).json({ error: 'Paarungen dürfen nur Admins oder Nutzer mit Bürostammdaten-Recht verwalten.' });
  let b;
  try { b = pairJobPruefen(req.body || {}, ''); } catch (e) { return res.status(400).json({ error: e.message }); }
  const id = crypto.randomUUID();
  prInsStmt.run(id, b.label, b.mountId, b.quellPfad, JSON.stringify(b.ziel), 1, req.session.userId);
  res.status(201).json(pairJobJson(prGetStmt.get(id)));
});
router.patch('/pair-jobs/:id', requireEditDocuments, (req, res) => {
  if (!darfMountVerwaltung(req)) return res.status(403).json({ error: 'Paarungen dürfen nur Admins oder Nutzer mit Bürostammdaten-Recht verwalten.' });
  const row = prGetStmt.get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Paarung nicht gefunden.' });
  const body = req.body || {};
  if (Object.keys(body).length === 1 && Object.prototype.hasOwnProperty.call(body, 'enabled')) {
    prUpdStmt.run(row.label, row.mount_id, row.source_path, row.target_json, body.enabled ? 1 : 0, row.id);
    return res.json(pairJobJson(prGetStmt.get(row.id)));
  }
  const alt = pairJobJson(row);
  let b;
  try {
    b = pairJobPruefen({ label: body.label !== undefined ? body.label : alt.label,
      mountId: body.mountId || alt.mountId, quellPfad: body.quellPfad !== undefined ? body.quellPfad : alt.quellPfad,
      ziel: body.ziel || alt.ziel }, row.id);
  } catch (e) { return res.status(400).json({ error: e.message }); }
  prUpdStmt.run(b.label, b.mountId, b.quellPfad, JSON.stringify(b.ziel), Object.prototype.hasOwnProperty.call(body, 'enabled') ? (body.enabled ? 1 : 0) : row.enabled, row.id);
  res.json(pairJobJson(prGetStmt.get(row.id)));
});
router.delete('/pair-jobs/:id', requireEditDocuments, (req, res) => {
  if (!darfMountVerwaltung(req)) return res.status(403).json({ error: 'Paarungen dürfen nur Admins oder Nutzer mit Bürostammdaten-Recht verwalten.' });
  prDelStmt.run(String(req.params.id));
  prStateDelStmt.run(String(req.params.id));
  res.json({ ok: true });
});
router.post('/pair-jobs/:id/run', requireEditDocuments, (req, res) => {
  if (!darfMountVerwaltung(req)) return res.status(403).json({ error: 'Paarungen dürfen nur Admins oder Nutzer mit Bürostammdaten-Recht verwalten.' });
  if (!prGetStmt.get(String(req.params.id))) return res.status(404).json({ error: 'Paarung nicht gefunden.' });
  process.emit('dok-pair-lauf', String(req.params.id));
  res.json({ gestartet: true });
});
/* Fallordner-Erkennung: Unterordner eines Anbieter-Basisordners gegen die Fall-Labels
   matchen (normalisiert; nur ein eindeutiger Treffer wird vorgeschlagen). */
router.post('/pair-jobs/erkennen', requireEditDocuments, async (req, res) => {
  if (!darfMountVerwaltung(req)) return res.status(403).json({ error: 'Paarungen dürfen nur Admins oder Nutzer mit Bürostammdaten-Recht verwalten.' });
  const mountId = String(req.body?.mountId || '');
  const basisSeg = mountSegmente(req.body?.basisPfad);
  try {
    const liste = await mountListe(mountId, basisSeg);
    const faelle = prCasesStmt.all().map(c => ({ id: String(c.id), label: String(c.label || '') }));
    const norm = s => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
    const vorhandene = new Set(prListStmt.all().filter(r => String(r.mount_id) === mountId).map(r => mountSegmente(r.source_path).join('/')));
    const ordner = (liste.folders || []).map(o => {
      const pfad = basisSeg.concat(o.name).join('/');
      const n = norm(o.name);
      let treffer = faelle.filter(c => norm(c.label) && norm(c.label) === n);
      if (!treffer.length && n) treffer = faelle.filter(c => { const cl = norm(c.label); return cl && (cl.includes(n) || n.includes(cl)); });
      const c = treffer.length === 1 ? treffer[0] : null;
      return { name: o.name, pfad, caseId: c ? c.id : '', caseLabel: c ? c.label : '', eindeutig: treffer.length === 1, vorhanden: vorhandene.has(pfad) };
    });
    res.json({ ordner, faelle });
  } catch (e) { res.status(400).json({ error: String(e && e.message || e) }); }
});

const wdListStmt = db.prepare('SELECT id, label, created_at, last_used_at FROM doc_webdav_tokens WHERE user_id = ? ORDER BY created_at DESC');
const wdInsStmt = db.prepare('INSERT INTO doc_webdav_tokens (id, user_id, label, pass_hash) VALUES (?, ?, ?, ?)');
const wdDelStmt = db.prepare('DELETE FROM doc_webdav_tokens WHERE id = ? AND user_id = ?');
const wdUserStmt = db.prepare('SELECT username FROM users WHERE id = ?');
function appPasswortNeu() {
  // Ohne verwechselbare Zeichen (0/O, 1/l/I), Form Xxxx-Xxxx-Xxxx - gut abtippbar am ⌘K-Dialog.
  const alph = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const teil = (n) => Array.from(crypto.randomBytes(n)).map(b => alph[b % alph.length]).join('');
  return teil(4) + '-' + teil(4) + '-' + teil(4);
}
router.get('/webdav-zugang', requireViewDocuments, (req, res) => {
  res.json({
    pfad: '/webdav/',
    username: (wdUserStmt.get(req.session.userId) || {}).username || '',
    tokens: wdListStmt.all(req.session.userId).map(t2 => ({ id: t2.id, label: t2.label, createdAt: t2.created_at, lastUsedAt: t2.last_used_at }))
  });
});
router.post('/webdav-zugang', requireViewDocuments, async (req, res) => {
  const label = String(req.body?.label || '').slice(0, 80);
  const pass = appPasswortNeu();
  const hash = await bcrypt.hash(pass, 10);
  const id = crypto.randomUUID();
  wdInsStmt.run(id, req.session.userId, label, hash);
  res.status(201).json({ id, passwort: pass });
});
router.delete('/webdav-zugang/:id', requireViewDocuments, (req, res) => {
  wdDelStmt.run(String(req.params.id), req.session.userId);
  try { process.emit('dok-webdav-token-widerruf'); } catch (_e) { /* Cache-Leerung, nie kritisch */ }
  res.json({ ok: true });
});

/* ======================= Export-Ablage: der Beleg kommt vom Server =======================
   Nutzerentscheid 2026-07-27, woertlich: "Zuerst landen Exporte im Speicher, dort wo alles
   andere auch liegt. Dann verweist der Historieneintrag darauf, statt eine zweite Kopie zu
   tragen. ... Das loesen wir mit einer Pruefsumme am Historieneintrag - die kostet 64 Zeichen
   statt 456 KB und beweist dasselbe."

   WARUM HIER UND NICHT IM BROWSER. Drei clientseitige Anlaeufe haben am 27.07.2026 ein
   falsches "Datei gespeichert" erzeugt und wurden zurueckgebaut (siehe der ausfuehrliche
   Kommentar bei downloadPdfBytes in der App-HTML). Die Wurzel war jedes Mal dieselbe: der
   Browser hat GERATEN, ob eine Datei entstanden ist, und das Raten lief ueber eine
   fensterlokale Buchfuehrung, waehrend der Gegenstand der Behauptung (die Export- und
   Versandhistorie) ein geteilter, von anderen Fenstern umschreibbarer Datensatz ist.
   Hier ist es umgekehrt: der Client SCHICKT die Bytes, der Server SCHREIBT sie, bildet die
   Pruefsumme SELBST ueber das, was er geschrieben hat, und antwortet mit dem Beleg. "Wurde
   gespeichert" ist damit keine Vermutung mehr, sondern die Antwort 201 dieser Route. Es gibt
   kein Zeitfenster, keine Anmeldung, kein Rendezvous - ein Aufruf, eine Antwort.

   ZIELORDNER. Die Register 01-12 des Ordnerstruktur-Entwurfs gibt es heute noch nicht, und
   die Entscheidung darueber (E1) steht beim Nutzer aus. Deshalb legt diese Route in einen
   eigenen, unmissverstaendlich neuen Ast <Fallakte>/Dokumentenausgang/<Jahr>/ - nicht in ein
   nummeriertes Register (das wuerde eine offene Entscheidung vorwegnehmen) und nicht unter
   "Modulordner" (dieser Ast soll laut Entwurf ersatzlos verschwinden, und sein Nachzug in
   doc-backup.js besitzt die dortigen Pfade).
   DAS SPAETERE UMHAENGEN KOSTET KEINE DATENWANDERUNG, und zwar aus drei Gruenden, die alle
   hier gesichert werden:
     1. Der Historieneintrag verweist ueber die DATEI-KENNUNG, nie ueber einen Pfad. Ein
        Ordnerwechsel ist ein UPDATE doc_files.folder_id und laesst den Verweis unberuehrt.
     2. Der Blob liegt unter blobDirFor(area, caseId) - der Ablageort auf der Platte haengt
        ueberhaupt nicht am logischen Ordner. Ein Ordnerwechsel bewegt null Bytes.
     3. Jede so abgelegte Datei bekommt eine Herkunftszeile in doc_module_import
        (quelle='exportablage', quell_id='<historyId>|<fileId>'). Eine spaetere Umstellung
        findet damit GENAU diese Dateien wieder, ohne raten zu muessen - und dieselbe Zeile
        ist der serverseitige Gegenbeweis fuer die Zuordnung Datei<->Historieneintrag.
   doc_module_import wird von den Nachzug-Laeufen in doc-backup.js nur fuer die Quellen
   'dokuanlagen' / 'posteingang' / 'belege' / 'auszuege' gelesen (Zeilen 55/56) - eine neue
   Quelle ist dort vollstaendig wirkungslos. */
const EXPORT_ORDNER = 'Dokumentenausgang';
const EXPORT_QUELLE = 'exportablage';
let exImpIns = null, exImpVonDatei = null, exImpZuEintrag = null;
function exStmts() {
  if (exImpIns) return;
  exImpIns = db.prepare('INSERT OR IGNORE INTO doc_module_import (quelle, quell_id, file_id) VALUES (?, ?, ?)');
  exImpVonDatei = db.prepare('SELECT quell_id, imported_at FROM doc_module_import WHERE quelle = ? AND file_id = ?');
  exImpZuEintrag = db.prepare("SELECT quell_id, file_id, imported_at FROM doc_module_import WHERE quelle = ? AND quell_id LIKE ? ORDER BY imported_at DESC");
}
/* Klartext-Pfad eines Ordners - fuer die Anzeige am Historieneintrag ("wo liegt sie?"). */
function exOrdnerPfad(folderId) {
  const teile = [];
  let id = String(folderId || ''), schutz = 0;
  while (id && schutz++ < 20) {
    const o = folderGetStmt.get(id);
    if (!o) break;
    teile.unshift(o.name);
    id = String(o.parent_id || '');
  }
  return teile.join('/');
}
function exReportPeriod(caseId) {
  if (!caseId) return '';
  const row = caseRowStmt.get(String(caseId));
  if (!row) return '';
  let data = {};
  try { data = JSON.parse(row.stammdaten_json || '{}') || {}; } catch (_e) { return ''; }
  const kandidaten = [
    data && data.care && data.care.reportPeriod,
    data && data.caseData && data.caseData.care && data.caseData.care.reportPeriod,
    data && data.data && data.data.care && data.data.care.reportPeriod
  ];
  return kandidaten.find((v) => v !== undefined && v !== null && String(v).trim()) || '';
}
/* Die Datei ablegen und den Beleg ausstellen. EIN Aufruf - der Client hat in genau diesem
   Moment die Bytes UND die Kennung des Historieneintrags in der Hand (er hat ihn gerade
   angelegt), deshalb braucht es keine nachtraegliche Zuordnung.
   herkunft: 'export' = beim Export entstanden | 'schnappschuss' = aus einem Altbestands-
   Schnappschuss nachtraeglich erzeugt (Bestandsauslagerung). Der Unterschied steht spaeter
   am Eintrag und wird angezeigt - eine Rekonstruktion darf nie wie das Original aussehen. */
router.post('/export-ablage', requireEditDocuments, (req, res) => {
  const scope = scopeFromReq(req, res); if (!scope) return;
  if (scope.area !== 'case') {
    return res.status(400).json({ error: 'Berichts- und Historienexporte können nur in einer Fallakte abgelegt werden.' });
  }
  const historyId = String(req.body?.historyId || '').slice(0, 120);
  if (!historyId) return res.status(400).json({ error: 'historyId erforderlich.' });
  const wunsch = cleanName(req.body?.fileName);
  if (!wunsch) return res.status(400).json({ error: 'Dateiname fehlt oder ist ungültig.' });
  const b64 = String(req.body?.dataBase64 || '');
  if (!b64) return res.status(400).json({ error: 'dataBase64 erforderlich.' });
  let bytes;
  try { bytes = Buffer.from(b64, 'base64'); } catch (_e) { return res.status(400).json({ error: 'dataBase64 ist nicht lesbar.' }); }
  if (!bytes.length) return res.status(400).json({ error: 'Leere Datei.' });
  if (bytes.length > MAX_JSON_FILE) return res.status(413).json({ error: zuGrossText(bytes.length, MAX_JSON_FILE, STROM_HINWEIS) });
  if (bytes.length > MAX_FILE) return res.status(413).json({ error: zuGrossText(bytes.length, MAX_FILE) });
  const jahrRoh = String(req.body?.jahr || '');
  const jahr = /^\d{4}$/.test(jahrRoh) ? jahrRoh : String(new Date().getFullYear());
  const monatRoh = String(req.body?.monat || '');
  const monat = /^(0[1-9]|1[0-2])$/.test(monatRoh) ? monatRoh : String(new Date().getMonth() + 1).padStart(2, '0');
  const reportId = String(req.body?.reportId || '').slice(0, 120);
  const teile = documentTaxonomy.exportBerichtPfad(
    reportId,
    scope.area === 'case' ? exReportPeriod(scope.caseId) : '',
    Number(jahr)
  ) || documentTaxonomy.ordnerPfad('11', EXPORT_ORDNER, jahr, monat);
  const folderId = ordnerSicherstellen(scope.area, scope.caseId, teile);
  const id = crypto.randomUUID();
  const name = uniqueName(scope.area, scope.caseId, folderId, wunsch, id);
  const mimeType = String(req.body?.mimeType || 'application/pdf').slice(0, 120);
  const herkunft = String(req.body?.herkunft || 'export') === 'schnappschuss' ? 'schnappschuss' : 'export';
  let placed;
  try {
    placed = documentStorage.placeBuffer({
      id, area: scope.area, case_id: scope.caseId, folder_id: folderId,
      name, mime_type: mimeType
    }, bytes);
    const brauchtText = /pdf|image\//i.test(mimeType) || /\.(pdf|jpe?g|png|gif|tiff?|heic)$/i.test(placed.name);
    exStmts();
    const linkStmt = db.prepare(`
      INSERT INTO doc_links (module, owner_id, slot, file_id, detail_json)
      VALUES ('export', ?, '', ?, ?)
      ON CONFLICT(module, owner_id, slot) DO UPDATE SET
        file_id=excluded.file_id, detail_json=excluded.detail_json
    `);
    db.transaction(() => {
      fileInsStmt.run({
        id, area: scope.area, caseId: scope.caseId, folderId, name: placed.name, mimeType,
        size: bytes.length, pages: Number(req.body?.pages) || 0, sha256: placed.sha256,
        ocrStatus: brauchtText ? 'pending' : 'none', createdBy: req.session.userId
      });
      fileStorageStmt.run({
        id, name: placed.name, nameKey: documentNames.vergleichsschluessel(placed.name), folderId,
        storageRelpath: placed.storageRelpath, storageDev: placed.storageDev, storageIno: placed.storageIno
      });
      exImpIns.run(EXPORT_QUELLE, historyId + '|' + id, id);
      linkStmt.run(historyId, id, JSON.stringify({ herkunft }));
      documentStorage.writeSidecar(fileGetStmt.get(id), placed.filePath);
    })();
  } catch (e) {
    if (placed) {
      try {
        documentStorage.removeFileAndSidecar({
          id, area: scope.area, case_id: scope.caseId, storage_relpath: placed.storageRelpath
        });
      } catch (_ignore) { /* Ein nicht entfernbarer Rest wird vom Integritaetslauf sichtbar gemeldet. */ }
    }
    return res.status(500).json({ error: 'Die Datei konnte nicht vollständig abgelegt und zugeordnet werden: ' + (e && e.message || e) });
  }
  res.status(201).json({
    fileId: id, name: placed.name, sha256: placed.sha256, size: bytes.length, pages: Number(req.body?.pages) || 0,
    area: scope.area, caseId: scope.caseId, folderId, ordnerPfad: teile.join('/'),
    historyId, gespeichertAm: new Date().toISOString(),
    herkunft,
    adjustments: placed.adjustments
  });
});
/* Drei Zustaende, vom SERVER entschieden - nicht vom Browser vermutet.
     unveraendert - die Datei liegt da und ihr Inhalt hat exakt die Pruefsumme vom Eintrag
     veraendert   - sie liegt da, aber ihr Inhalt ist ein anderer
     fehlt        - geloescht, im Papierkorb, Blob weg, kein Zugriff, oder die Datei gehoert
                    nachweislich NICHT zu diesem Historieneintrag
   Die Pruefsumme wird bei jeder Abfrage NEU UEBER DIE PLATTE gebildet (nicht aus der
   Datenbankspalte gelesen): eine Spalte kann fortgeschrieben worden sein, ohne dass jemand
   den Inhalt gehasht hat - dann waere "unveraendert" wieder eine Vermutung. Nur oberhalb
   von 200 MB faellt die Antwort auf die Spalte zurueck und sagt das im Feld 'quelle'.
   Zusaetzlich wird die Zuordnung geprueft: doc_module_import muss diese Datei genau diesem
   Historieneintrag zuschreiben. Ein am Client erfundener Verweis kann deshalb NIE als
   "unveraendert" erscheinen. */
router.post('/export-ablage/status', requireViewDocuments, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 400) : [];
  exStmts();
  const out = items.map((it) => {
    const fileId = String(it && it.fileId || '');
    const soll = String(it && it.sha256 || '').toLowerCase();
    const hid = String(it && it.historyId || '');
    const a = { fileId, historyId: hid, stand: 'fehlt', grund: 'unbekannt', name: '', size: 0, sha256: '', ordnerPfad: '', quelle: '' };
    if (!fileId) { a.grund = 'keine_kennung'; return a; }
    const row = fileGetStmt.get(fileId);
    if (!row) { a.grund = 'geloescht'; return a; }
    if (row.area === 'case' && !fallErlaubt(req.session, row.case_id)) { a.grund = 'kein_zugriff'; return a; }
    a.name = String(row.name || '');
    a.size = Number(row.size) || 0;
    a.ordnerPfad = exOrdnerPfad(row.folder_id);
    if (String(row.deleted_at || '')) { a.grund = 'papierkorb'; return a; }
    if (hid) {
      const b = exImpVonDatei.get(EXPORT_QUELLE, fileId);
      if (!b || String(b.quell_id).split('|')[0] !== hid) { a.grund = 'nicht_zugeordnet'; return a; }
    }
    const p = findBlobPath(row);
    if (!p) { a.grund = 'blob_weg'; return a; }
    let ist = '';
    try {
      const st = fs.statSync(p);
      a.size = st.size;
      if (st.size <= 200 * 1024 * 1024) { ist = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); a.quelle = 'platte'; }
      else { ist = String(row.sha256 || '').toLowerCase(); a.quelle = 'datenbank'; }
    } catch (_e) { a.grund = 'blob_weg'; return a; }
    a.sha256 = ist;
    if (!soll) { a.stand = 'veraendert'; a.grund = 'keine_pruefsumme_am_eintrag'; return a; }
    if (ist === soll) { a.stand = 'unveraendert'; a.grund = ''; return a; }
    a.stand = 'veraendert'; a.grund = 'inhalt_abweichend';
    return a;
  });
  res.json({ items: out });
});
/* Bestandsaufnahme fuer die Auslagerung der Alt-Schnappschuesse (Nutzer loest sie aus).
   Nur LESEND. Zeigt je Fall: wie viele Historieneintraege, wie viele davon tragen noch einen
   Dokument-Schnappschuss, wie viele Bytes kostet das, und wie gross ist stammdaten_json
   insgesamt. Genau diese Zahlen stehen im Dialog VOR der Auslagerung und danach erneut. */
router.get('/export-ablage/bestand', requireViewDocuments, (req, res) => {
  const erlaubt = erlaubteFaelle(req.session);
  const rows = db.prepare('SELECT id, label, stammdaten_json FROM cases').all();
  const faelle = [];
  let gesamtBlob = 0, gesamtSchnapp = 0, gesamtEintraege = 0, gesamtMitSchnapp = 0;
  for (const r of rows) {
    if (erlaubt && !erlaubt.has(String(r.id))) continue;
    const blobBytes = Buffer.byteLength(String(r.stammdaten_json || ''), 'utf8');
    let hist = [];
    try { hist = JSON.parse(r.stammdaten_json || '{}').exportHistory; } catch (_e) { hist = []; }
    if (!Array.isArray(hist)) hist = [];
    let schnappBytes = 0, mitSchnapp = 0, mitVerweis = 0;
    const eintraege = hist.map((h) => {
      const s = (h && h.documentJsonSnapshot) ? Buffer.byteLength(JSON.stringify(h.documentJsonSnapshot), 'utf8') : 0;
      if (s) { schnappBytes += s; mitSchnapp++; }
      if (h && h.exportRef && h.exportRef.fileId) mitVerweis++;
      return {
        id: String(h && h.id || ''), titel: String(h && h.documentTitle || ''), dateiname: String(h && h.filename || ''),
        reportId: String(h && h.reportId || ''), exportMode: String(h && h.exportMode || ''),
        erstelltAm: String(h && h.createdAt || ''), schnappschussBytes: s,
        hatVerweis: !!(h && h.exportRef && h.exportRef.fileId)
      };
    });
    gesamtBlob += blobBytes; gesamtSchnapp += schnappBytes;
    gesamtEintraege += hist.length; gesamtMitSchnapp += mitSchnapp;
    faelle.push({
      caseId: String(r.id), label: String(r.label || ''), blobBytes,
      eintraege: hist.length, mitSchnappschuss: mitSchnapp, mitVerweis, schnappschussBytes: schnappBytes,
      liste: eintraege
    });
  }
  faelle.sort((a, b) => b.schnappschussBytes - a.schnappschussBytes);
  res.json({
    faelle, gesamt: {
      blobBytes: gesamtBlob, schnappschussBytes: gesamtSchnapp,
      eintraege: gesamtEintraege, mitSchnappschuss: gesamtMitSchnapp
    }
  });
});

module.exports = router;
// Interne Helfer fuer die WebDAV-Freigabe (server/webdav.js) - KEIN oeffentlicher Vertrag.
/* Scan-Eingang (D11): Ablage-Helfer fuer den Poll-Laeufer in doc-backup.js. */
function eindeutigerName(area, caseId, folderId, name) {
  return uniqueName(area, String(caseId || ''), String(folderId || ''), cleanName(name) || 'Scan', '');
}
/* 2026-07-27: Bis hierher pruefte dateiAblegen als EINZIGER Schreibweg GAR NICHTS - genau
   darueber ist die 143-MB-Videodatei in den Bestand gekommen, obwohl die Grenze bei 100 MB stand.
   Sechs Zubringer haengen an dieser Funktion (D17 Modulordner, D29 Import, D30 Paarung,
   Scan-Eingang, Posteingang->Explorer, MCP). Eine Grenze, die nur manche Wege kennen, ist keine
   Grenze - deshalb wirft die Funktion jetzt, und die Aufrufer fangen und melden es.
   Bestandsschutz: die vorhandene 143-MB-Datei liegt weit unter den neuen 1024 MB, es wird also
   nichts Bestehendes ploetzlich abgelehnt. */
function dateiAblegen(area, caseId, folderId, name, mime, bytes, createdBy) {
  const gr = (bytes && bytes.length) || 0;
  if (gr > MAX_FILE) {
    const e = new Error(zuGrossText(gr, MAX_FILE));
    e.code = 'ZU_GROSS'; e.istBytes = gr; e.maxBytes = MAX_FILE;
    throw e;
  }
  const id = crypto.randomUUID();
  const n = eindeutigerName(area, caseId, folderId, name);
  let placed;
  try {
    placed = documentStorage.placeBuffer({
      id, area, case_id: String(caseId || ''), folder_id: String(folderId || ''),
      name: n, mime_type: mime || 'application/octet-stream'
    }, bytes);
    const brauchtText = /\.(pdf|jpe?g|png|gif|tiff?|heic)$/i.test(n);
    db.transaction(() => {
      fileInsStmt.run({ id, area, caseId: String(caseId || ''), folderId: String(folderId || ''), name: placed.name, mimeType: mime || 'application/octet-stream',
        size: bytes.length, pages: 0, sha256: placed.sha256, ocrStatus: brauchtText ? 'pending' : 'none', createdBy: createdBy || null });
      fileStorageStmt.run({
        id, name: placed.name, nameKey: documentNames.vergleichsschluessel(placed.name), folderId: String(folderId || ''),
        storageRelpath: placed.storageRelpath, storageDev: placed.storageDev, storageIno: placed.storageIno
      });
      documentStorage.writeSidecar(fileGetStmt.get(id), placed.filePath);
    })();
  } catch (error) {
    if (placed) {
      try {
        documentStorage.removeFileAndSidecar({
          id, area, case_id: String(caseId || ''), storage_relpath: placed.storageRelpath
        });
      } catch (_ignore) { /* Abgleich meldet einen nicht entfernbaren Rest */ }
    }
    throw error;
  }
  try { require('../office/events').emit('documents', { method: 'SCAN', path: '/files' }); } catch (_e) { /* Anzeige */ }
  return { id, name: placed.name, adjustments: placed.adjustments };
}
/* Datei-Inhalt ersetzen ohne Request-Kontext (D30) - exakt die Mechanik der Route
   /files/:id/ersetzen: alte Fassung in den Versionsverlauf, Blob neu, Zeile aktualisieren,
   Suchtext verwerfen (OCR laeuft bei Bedarf neu). */
/* v176: Bis hierher pruefte der ERSETZEN-Weg gar nichts - dateiAblegen wirft seit dem
   27.07., dateiErsetzen ging ungeprueft durch (ueber module-files.replace und den
   Zwei-Wege-Abgleich in doc-backup.js). Eine Grenze, die nur der Anlege-Weg kennt,
   ist keine Grenze. Beide Aufrufer fangen und melden den Wurf. */
function dateiErsetzen(row, mime, bytes) {
  const gr = (bytes && bytes.length) || 0;
  if (gr > MAX_FILE) {
    const e = new Error(zuGrossText(gr, MAX_FILE));
    e.code = 'ZU_GROSS'; e.istBytes = gr; e.maxBytes = MAX_FILE;
    throw e;
  }
  return dateiMitBufferErsetzen(row, bytes, {
    username: 'Zwei-Wege-Abgleich',
    mimeType: String(mime || row.mime_type || 'application/octet-stream')
  });
}
/* Ordnerkette anlegen/finden (D17) - Muster /folders/bulk, aber ohne Request-Kontext. */
function ordnerSicherstellen(area, caseId, teile) {
  let parentId = '';
  for (const roh of (teile || []).slice(0, 10)) {
    const teil = cleanName(roh);
    if (!teil) continue;
    const vorhanden = folderAllStmt.all(area, String(caseId || ''))
      .find(f => f.parent_id === parentId && documentNames.dateinamenGleich(f.name, teil));
    if (vorhanden) { parentId = vorhanden.id; continue; }
    const id = crypto.randomUUID();
    folderInsStmt.run({ id, area, caseId: String(caseId || ''), parentId, name: teil, createdBy: null });
    syncFolderPath(folderGetStmt.get(id));
    parentId = id;
  }
  return parentId;
}
function modulStatusSetzen(text) {
  try {
    const cfg = readCfg();
    cfg.modulSync = cfg.modulSync || normModulSync(null);
    cfg.modulSync.status = String(text || '').slice(0, 300);
    cfgPut.run({ dataJson: JSON.stringify(cfg), userId: null });
  } catch (_e) { /* Statuszeile ist Komfort */ }
}
function scanStatusSetzen(text) {
  try {
    const cfg = readCfg();
    cfg.scanEingang = cfg.scanEingang || { an: false, ordner: '', ziel: { art: 'inbox' } };
    cfg.scanEingang.status = String(text || '').slice(0, 300);
    cfgPut.run({ dataJson: JSON.stringify(cfg), userId: null });
  } catch (_e) { /* Statuszeile ist Komfort */ }
}
/* ---- Vertrag fuer den Strom-Upload (server/documents-stream.js, 2026-07-27) ----
   Der Strom-Upload schreibt den Blob SELBST (er kennt die Bytes nie am Stueck) und braucht
   deshalb genau die Bausteine, die die JSON-Route drumherum benutzt: Rechte-/Fall-Pruefung,
   Ordnerpruefung, eindeutigen Namen + DB-Zeile, Metadaten-Aktualisierung beim Ersetzen. Die
   Zeile entsteht ausschliesslich hier - eine zweite Wahrheit ueber doc_files gibt es nicht. */
function scopePruefen(session, area, caseId) {
  const a = String(area || 'case');
  const c = String(caseId || '');
  if (!AREAS.has(a)) return { ok: false, code: 400, error: 'Unbekannter Bereich.' };
  if (a === 'case') {
    if (!c) return { ok: false, code: 400, error: 'caseId erforderlich.' };
    if (!caseExistsStmt.get(c)) return { ok: false, code: 404, error: 'Fall nicht gefunden.' };
    if (!fallErlaubt(session, c)) return { ok: false, code: 403, error: 'Keine Berechtigung für diese Fallakte (nur eigene Fälle).' };
    return { ok: true, area: a, caseId: c };
  }
  if (a === 'management' && !(session && session.isAdmin)) {
    return { ok: false, code: 403, error: 'Die geschützte Verwaltung ist nur für Administratoren sichtbar.' };
  }
  return { ok: true, area: a, caseId: '' };
}
function ordnerGibts(folderId) { return !!folderGetStmt.get(String(folderId || '')); }
function dateiZeile(id) { return fileGetStmt.get(String(id || '')) || null; }
function brauchtTextVon(name, mime) {
  return /pdf|image\//i.test(String(mime || '')) || /\.(pdf|jpe?g|png|gif|tiff?|heic)$/i.test(String(name || ''));
}
function dateiEintragen(o) {
  const area = String(o.area || 'case');
  const caseId = String(o.caseId || '');
  const folderId = String(o.folderId || '');
  const name = o.finalName
    ? (cleanName(o.finalName) || 'Unbenannt')
    : uniqueName(area, caseId, folderId, o.wunschName, o.id);
  const mimeType = String(o.mimeType || 'application/octet-stream').slice(0, 120);
  const ocrStatus = brauchtTextVon(name, mimeType) ? 'pending' : 'none';
  try {
    db.transaction(() => {
      fileInsStmt.run({
        id: o.id, area, caseId, folderId, name, mimeType,
        size: Number(o.size) || 0, pages: 0, sha256: String(o.sha256 || ''),
        ocrStatus, createdBy: o.createdBy || null
      });
      if (o.storageRelpath && o.filePath) {
        const stat = fs.statSync(o.filePath);
        fileStorageStmt.run({
          id: o.id, name, nameKey: documentNames.vergleichsschluessel(name), folderId,
          storageRelpath: o.storageRelpath, storageDev: String(stat.dev), storageIno: String(stat.ino)
        });
        documentStorage.writeSidecar(fileGetStmt.get(o.id), o.filePath);
      } else {
        db.prepare('UPDATE doc_files SET name_key=? WHERE id=?').run(documentNames.vergleichsschluessel(name), o.id);
      }
    })();
  } catch (error) {
    if (o.filePath) {
      const sidecar = documentStorage.sidecarPath(o.filePath, o.id);
      try { fs.unlinkSync(sidecar); } catch (_ignore) { /* nicht geschrieben */ }
    }
    throw error;
  }
  return { id: o.id, name, ocrStatus };
}
function dateiZiel(area, caseId, folderId, wunschName, selfPath, selfId) {
  const name = uniqueName(area, String(caseId || ''), String(folderId || ''), wunschName, String(selfId || ''));
  return documentStorage.targetFor(area, String(caseId || ''), String(folderId || ''), name, selfPath);
}
function dateiTempPublizieren(temp, target) {
  return documentStorage.publishTemp(temp, target.filePath);
}
function dateiPapierkorb(row, userId) {
  if (!row || row.deleted_at) return null;
  return moveFileToTrash(row, userId);
}
function dateiVerschieben(row, folderId, wantedName) {
  const name = uniqueName(row.area, row.case_id, String(folderId || ''), wantedName || row.name, row.id);
  const moved = documentStorage.relocate(row, row.area, row.case_id, String(folderId || ''), name);
  fileUpdStmt.run({ id: row.id, name: moved.name, folderId: String(folderId || ''), pages: row.pages, ocrStatus: row.ocr_status });
  fileStorageStmt.run({
    id: row.id, name: moved.name, nameKey: documentNames.vergleichsschluessel(moved.name), folderId: String(folderId || ''),
    storageRelpath: moved.storageRelpath, storageDev: moved.storageDev, storageIno: moved.storageIno
  });
  return moved;
}
function dateiUmhaengen(row, area, caseId, folderId, wantedName) {
  if (!row) throw new Error('Datei nicht gefunden.');
  const targetArea = area === 'office' ? 'office' : 'case';
  const targetCaseId = targetArea === 'case' ? String(caseId || '') : '';
  const targetFolderId = String(folderId || '');
  const name = uniqueName(targetArea, targetCaseId, targetFolderId, wantedName || row.name, row.id);
  const moved = documentStorage.relocate(row, targetArea, targetCaseId, targetFolderId, name);
  db.transaction(() => {
    db.prepare(`
      UPDATE doc_files
         SET area=?, case_id=?, folder_id=?, name=?, name_key=?, pages=?, ocr_status=?,
             updated_at=datetime('now')
       WHERE id=?
    `).run(targetArea, targetCaseId, targetFolderId, moved.name,
      documentNames.vergleichsschluessel(moved.name), row.pages, row.ocr_status, row.id);
    fileStorageStmt.run({
      id: row.id, name: moved.name, nameKey: documentNames.vergleichsschluessel(moved.name),
      folderId: targetFolderId, storageRelpath: moved.storageRelpath,
      storageDev: moved.storageDev, storageIno: moved.storageIno
    });
  })();
  documentStorage.writeSidecar(fileGetStmt.get(row.id), moved.filePath);
  return moved;
}
function dateiKopie(row, folderId, wantedName, createdBy) {
  const source = findBlobPath(row);
  if (!source) throw new Error('Dateiinhalt ist nicht auffindbar.');
  const id = crypto.randomUUID();
  const name = uniqueName(row.area, row.case_id, String(folderId || ''), wantedName || row.name, id);
  const target = documentStorage.targetFor(row.area, row.case_id, String(folderId || ''), name);
  documentStorage.cloneCopy(source, target.filePath);
  const stat = fs.statSync(target.filePath);
  try {
    fileInsStmt.run({
      id, area: row.area, caseId: row.case_id, folderId: String(folderId || ''), name: target.name,
      mimeType: row.mime_type, size: row.size, pages: row.pages, sha256: row.sha256,
      ocrStatus: row.ocr_status, createdBy: createdBy || null
    });
    fileStorageStmt.run({
      id, name: target.name, nameKey: documentNames.vergleichsschluessel(target.name), folderId: String(folderId || ''),
      storageRelpath: target.storageRelpath, storageDev: String(stat.dev), storageIno: String(stat.ino)
    });
    for (const text of textForFileStmt.all(row.id)) textInsStmt.run(id, text.page, text.text);
    documentStorage.writeSidecar(fileGetStmt.get(id), target.filePath);
  } catch (error) {
    try { fs.unlinkSync(target.filePath); } catch (_ignore) { /* best effort */ }
    throw error;
  }
  return { id, name: target.name, target };
}
module.exports.intern = { findBlobPath, blobDirFor, cleanName, mountOrdner, mountSchreib, mountInfo, mountListe, mountLese, versionSichern, dateiAblegen, dateiErsetzen, scanStatusSetzen, readCfg, ordnerSicherstellen, intakeName, modulStatusSetzen, aktivitaet: actLog,
  MAX_FILE, MAX_JSON_FILE, groessenText, zuGrossText, scopePruefen, ordnerGibts, dateiZeile, dateiEintragen, dateiZiel, dateiTempPublizieren,
  dateiTempErsetzen: dateiMitTempErsetzen, dateiPapierkorb, dateiVerschieben, dateiUmhaengen, dateiKopie, uniqueName,
  documentStorage, ordnerPhysisch: (folderId) => syncFolderPath(folderGetStmt.get(String(folderId))),
  ordnerVerschieben: (folderId, parentId, name) => moveFolderPhysical(folderGetStmt.get(String(folderId)), parentId, name),
  ensureCaseLayout: (caseId, userId) => documentStorage.ensureCaseLayout(caseId, userId),
  runDocumentIntegrity };
