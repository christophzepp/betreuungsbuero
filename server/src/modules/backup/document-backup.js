// Automatische Sicherung des Dokumentenspeichers (Plan D8, Nutzerwunsch: "jeden Tag/Woche/Monat
// am Tag X um Y Uhr folgende Anbieter/Ordner synchronisieren oder backuppen").
//
// Drei Zielarten je Zeitplan (doc_backup_jobs):
//   - gesamt: konsistente SQLite-.backup-Kopie, kompletter runtime/data-Baum, konfigurierte
//             externe Dokumentwurzeln, Pruefsummen und Rettungsskript. Das Ziel braucht die
//             feste Zielmarke ".betreuungsbuero-backup-ziel", damit ein nicht eingehangener
//             Datentraeger sichtbar scheitert statt unbemerkt die interne Platte zu fuellen.
//   - zip:   eine ZIP-Datei mit dem gewaehlten Bereich in einen Ordner auf dem Server-Rechner
//            (externe Platte, NAS-Mount). Methode STORE (unkomprimiert) - PDFs/Scans sind
//            bereits komprimiert, so bleibt der Lauf schnell und jede Software kann entpacken.
//   - mount: additiver Abgleich auf eine Verbindung des Dokumente-Moduls (WebDAV/Nextcloud oder
//            lokaler Ordner). Es wird NUR hochgeladen/aktualisiert, nie geloescht - eine
//            Sicherung darf auf der Zielseite nichts zerstoeren. Nach dem ersten Volllauf
//            inkrementell (nur seit dem letzten Lauf geaenderte Dateien).
//
// Takt: minuetliche Pruefung. Der letzte geplante Termin wird getrennt vom letzten Versuch
// gespeichert; verpasste Termine werden nach dem Serverstart nachgeholt. Fehlgeschlagene
// Laeufe werden begrenzt und mit Backoff wiederholt. Laeufe laufen strikt nacheinander.
// "Jetzt ausfuehren" kommt aus routes/documents.js via process.emit('dok-backup-lauf', id) -
// Absicht: kein require-Zyklus zwischen Routen und Laeufer (Muster D7-Token-Widerruf).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dokuAttachments = require('../documents/case-note-attachments');
const documentTaxonomy = require('../documents/taxonomy');
const operationCoordinator = require('../documents/operation-coordinator');
const applicationWriteBarrier = require('../../middleware/application-write-barrier');
const offsiteMaintenanceStatus = require('./offsite-maintenance-status');
const {
  runTotalBackup: defaultRunTotalBackup,
  targetMarker: readBackupTargetMarker,
  inspectOffsiteBacklog
} = require('./runner');
const {
  SERVER_ROOT,
  DATA_ROOT,
  DATABASE_PATH
} = require('../../config/paths');

let db = null;
let intern = null;      // Helfer aus routes/documents.js: findBlobPath, cleanName, mountOrdner, mountSchreib
let stmt = null;
let timer = null;
let syncTimer = null;
let laeuft = false;
let syncLaeuft = false;
let impTimer = null;
let impLaeuft = false;
let prTimer = null;
let prLaeuft = false;
let healthTimer = null;
let started = false;
let healthLaeuft = false;
const auslaufendeMountOperationen = new Set();
let totalBackupRunner = defaultRunTotalBackup;
let jetztFn = () => new Date();
let mailSender = null;
let warnMailTimeoutMs = 30000;
let processHandlers = null;

function bereite() {
  if (stmt) return;
  stmt = {
    jobs: db.prepare('SELECT * FROM doc_backup_jobs'),
    job: db.prepare('SELECT * FROM doc_backup_jobs WHERE id = ?'),
    laufStart: db.prepare(`
      UPDATE doc_backup_jobs
         SET run_started_at=@startedAt, last_result='läuft …',
             last_scheduled_at=CASE WHEN @scheduledAt != '' THEN @scheduledAt ELSE last_scheduled_at END,
             next_retry_at='',retry_context_json=@retryContextJson
       WHERE id=@id AND enabled<>0 AND COALESCE(run_started_at,'')=''
    `),
    zielBinden: db.prepare(`
      UPDATE doc_backup_jobs
         SET options_json=@optionsJson
       WHERE id=@id AND options_json=@oldOptionsJson
    `),
    lokalVollstaendig: db.prepare(`
      UPDATE doc_backup_jobs
         SET retry_context_json=@retryContextJson
       WHERE id=@id AND run_started_at=@startedAt
         AND config_changed_at=@configRevision
         AND target_json=@targetJson AND options_json=@optionsJson
    `),
    laufErfolg: db.prepare(`
      UPDATE doc_backup_jobs
         SET last_run_at=@finishedAt, last_success_at=@finishedAt, last_result=@result,
             mount_cursor_at=CASE
               WHEN @mountCursorAt != '' THEN @mountCursorAt
               ELSE mount_cursor_at
             END,
             run_started_at='', next_retry_at='', retry_count=0,retry_context_json='{}'
       WHERE id=@id AND config_changed_at=@configRevision
         AND source_json=@sourceJson AND target_json=@targetJson AND options_json=@optionsJson
    `),
    laufFehler: db.prepare(`
      UPDATE doc_backup_jobs
         SET last_run_at=@finishedAt, last_failure_at=@finishedAt, last_result=@result,
             run_started_at='', next_retry_at=@nextRetryAt, retry_count=@retryCount,
             retry_context_json=@retryContextJson
       WHERE id=@id AND config_changed_at=@configRevision
         AND source_json=@sourceJson AND target_json=@targetJson AND options_json=@optionsJson
    `),
    laufVeralteteKonfiguration: db.prepare(`
      UPDATE doc_backup_jobs
         SET run_started_at='', last_result=@result
       WHERE id=@id AND run_started_at=@startedAt
    `),
    unterbrochen: db.prepare(`
      UPDATE doc_backup_jobs
         SET last_run_at=@finishedAt, last_failure_at=@finishedAt, last_result=@result,
             run_started_at='', next_retry_at=@nextRetryAt, retry_count=@retryCount
       WHERE id=@id
    `),
    jobWarnung: db.prepare(`
      UPDATE doc_backup_jobs
         SET last_warning_key=@warningKey, last_warning_at=@warningAt
       WHERE id=@id
    `),
    jobMail: db.prepare(`
      UPDATE doc_backup_jobs
         SET last_mail_at=CASE WHEN @mailAt != '' THEN @mailAt ELSE last_mail_at END,
             last_mail_error=@mailError
       WHERE id=@id
    `),
    scheduler: db.prepare('SELECT * FROM doc_backup_scheduler_state WHERE id = 1'),
    schedulerStart: db.prepare(`
      UPDATE doc_backup_scheduler_state
         SET started_at=@now, heartbeat_at=@now, last_tick_error='', last_tick_error_at=''
       WHERE id=1
    `),
    schedulerTickOk: db.prepare(`
      UPDATE doc_backup_scheduler_state
         SET heartbeat_at=@now, last_tick_at=@now, last_tick_error=''
       WHERE id=1
    `),
    schedulerHeartbeat: db.prepare(`
      UPDATE doc_backup_scheduler_state
         SET heartbeat_at=@now
       WHERE id=1
    `),
    schedulerTickFehler: db.prepare(`
      UPDATE doc_backup_scheduler_state
         SET heartbeat_at=@now, last_tick_at=@now, last_tick_error=@error,
             last_tick_error_at=@now
       WHERE id=1
    `),
    schedulerHealth: db.prepare(`
      UPDATE doc_backup_scheduler_state
         SET health_status=@status, health_key=@healthKey,
             last_health_change_at=@changedAt, last_warning_at=@warningAt
       WHERE id=1
    `),
    schedulerMail: db.prepare(`
      UPDATE doc_backup_scheduler_state
         SET last_mail_at=CASE WHEN @mailAt != '' THEN @mailAt ELSE last_mail_at END,
             last_mail_error=@mailError
       WHERE id=1
    `),
    ordner: db.prepare("SELECT id, area, case_id, parent_id, name FROM doc_folders"),
    dateien: db.prepare("SELECT * FROM doc_files WHERE deleted_at = ''"),
    faelle: db.prepare('SELECT id, label FROM cases'),
    /* Modulordner-Import (D17) - Quell-Leser + Mapping */
    faelleVoll: db.prepare('SELECT id, label, stammdaten_json FROM cases'),
    dokuEntries: db.prepare('SELECT id, data_json, created_at FROM case_doku_entries WHERE case_id = ?'),
    inbox: db.prepare('SELECT id, file_name, mime_type, size, inbox_date, received_date, created_at FROM inbox_documents'),
    belege: db.prepare('SELECT id, filename, mime_type, size, invoice_date FROM finance_receipts'),
    auszuege: db.prepare(`SELECT s.id, s.filename, s.mime_type, s.size, s.uploaded_at,
      (SELECT MIN(t2.booking_date) FROM finance_transactions t2 WHERE t2.statement_id = s.id AND t2.booking_date != '') AS buchung_von
      FROM finance_statements s`),
    intakeDateien: db.prepare('SELECT id, draft_id, file_name, mime_type, data FROM intake_files'),
    mapHat: db.prepare('SELECT 1 FROM doc_module_import WHERE quelle = ? AND quell_id = ?'),
    mapDoku: db.prepare("SELECT quell_id, file_id FROM doc_module_import WHERE quelle = 'dokuanlagen' AND file_id != ''"),
    mapBuero: db.prepare("SELECT quelle, quell_id, file_id FROM doc_module_import WHERE quelle IN ('posteingang','belege','auszuege') AND file_id != ''"),
    dokuEintrag: db.prepare('SELECT id, data_json, created_at FROM case_doku_entries WHERE id = ?'),
    fileMeta: db.prepare("SELECT id, area, case_id, folder_id FROM doc_files WHERE id = ? AND deleted_at = ''"),
    fileMove: db.prepare("UPDATE doc_files SET folder_id = ?, updated_at = datetime('now') WHERE id = ?"),
    fileImOrdner: db.prepare('SELECT 1 FROM doc_files WHERE folder_id = ? LIMIT 1'),
    folderDel: db.prepare('DELETE FROM doc_folders WHERE id = ?'),
    mapSetz: db.prepare('INSERT OR IGNORE INTO doc_module_import (quelle, quell_id, file_id) VALUES (?, ?, ?)'),
    /* Import-Eingang (D29) */
    impJobs: db.prepare('SELECT * FROM doc_import_jobs'),
    impJob: db.prepare('SELECT * FROM doc_import_jobs WHERE id = ?'),
    impErgebnis: db.prepare('UPDATE doc_import_jobs SET last_run_at = ?, last_result = ? WHERE id = ?'),
    impStateGet: db.prepare('SELECT * FROM doc_import_state WHERE job_id = ? AND pfad = ?'),
    impStateSha: db.prepare('SELECT pfad, file_id FROM doc_import_state WHERE job_id = ? AND sha256 = ? LIMIT 1'),
    impStateSetz: db.prepare("INSERT OR REPLACE INTO doc_import_state (job_id, pfad, merkmal, sha256, file_id, imported_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"),
    impFolderKinder: db.prepare('SELECT id, name FROM doc_folders WHERE area = ? AND case_id = ? AND parent_id = ?'),
    impFolderIns: db.prepare('INSERT INTO doc_folders (id, area, case_id, parent_id, name) VALUES (?, ?, ?, ?, ?)'),
    /* Zwei-Wege-Paarung (D30) */
    prJobs: db.prepare('SELECT * FROM doc_pair_jobs'),
    prJob: db.prepare('SELECT * FROM doc_pair_jobs WHERE id = ?'),
    prErgebnis: db.prepare('UPDATE doc_pair_jobs SET last_run_at = ?, last_result = ? WHERE id = ?'),
    prStateAll: db.prepare('SELECT * FROM doc_pair_state WHERE pair_id = ?'),
    prStateSetz: db.prepare("INSERT OR REPLACE INTO doc_pair_state (pair_id, pfad, remote_merkmal, sha256, file_id, synced_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"),
    prStateDel: db.prepare('DELETE FROM doc_pair_state WHERE pair_id = ? AND pfad = ?')
  };
}

/* ---------- Zeitplan-Logik (pur, testbar) ---------- */

const DEFAULT_BACKUP_OPTIONS = Object.freeze({
  retry: Object.freeze({ maxRetries: 2, backoffMinutes: Object.freeze([5, 30]) }),
  timeoutMinutes: 180,
  catchUp: true,
  overdueHours: 36,
  consistencyRetries: 2,
  capacity: Object.freeze({ warningPercent: 15 }),
  localTargetEncryptedAttested: false,
  alert: Object.freeze({ email: true, repeatHours: 24 }),
  retention: Object.freeze({
    enabled: false, daily: 14, monthly: 12, yearly: 10, diagnostic: 6, minFreeGb: 10
  }),
  offsite: Object.freeze({
    enabled: false, mode: 'restic', repository: '', passwordFile: '', tag: 'betreuungsbuero',
    required: true, maxPending: 14, checkDays: 7, readSlices: 7,
    retentionMode: 'external',
    immutableAttested: false, lifecycleAttested: false
  }),
  heartbeat: Object.freeze({ enabled: false, url: '', secretFile: '', timeoutMs: 10000 })
});

function ganzzahl(value, fallback, min, max, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(label + ' muss eine ganze Zahl zwischen ' + min + ' und ' + max + ' sein.');
  }
  return n;
}

// Ein gemeinsamer Normalisierer für Route, Scheduler und Tests. Im JSON liegt
// ausschließlich der Pfad zur restic-Passwortdatei, niemals ihr Inhalt.
function normalisiereOptionen(raw) {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error('Die Sicherungsoptionen müssen als JSON-Objekt angegeben werden.');
  }
  const o = raw && typeof raw === 'object' ? raw : {};
  const retry = o.retry && typeof o.retry === 'object' ? o.retry : {};
  const maxRetries = ganzzahl(retry.maxRetries, DEFAULT_BACKUP_OPTIONS.retry.maxRetries, 0, 5, 'Die Zahl der Wiederholungen');
  let backoff = retry.backoffMinutes;
  if (backoff === undefined) backoff = DEFAULT_BACKUP_OPTIONS.retry.backoffMinutes;
  if (!Array.isArray(backoff)) throw new Error('Die Wiederholungsabstände müssen als Liste in Minuten angegeben werden.');
  backoff = backoff.map((v) => ganzzahl(v, 5, 1, 1440, 'Ein Wiederholungsabstand')).slice(0, 6);
  if (maxRetries && !backoff.length) throw new Error('Für automatische Wiederholungen fehlt mindestens ein Abstand.');
  while (backoff.length < maxRetries) {
    backoff.push(backoff.length ? backoff[backoff.length - 1] : DEFAULT_BACKUP_OPTIONS.retry.backoffMinutes[0]);
  }

  const alert = o.alert && typeof o.alert === 'object' ? o.alert : {};
  const retention = o.retention && typeof o.retention === 'object' ? o.retention : {};
  const capacity = o.capacity && typeof o.capacity === 'object' ? o.capacity : {};
  const offsite = o.offsite && typeof o.offsite === 'object' ? o.offsite : {};
  const heartbeat = o.heartbeat && typeof o.heartbeat === 'object' ? o.heartbeat : {};
  const offsiteEnabled = !!offsite.enabled;
  const repository = String(offsite.repository || '').trim();
  const passwordFile = String(offsite.passwordFile || '').trim();
  if (offsiteEnabled && String(offsite.mode || 'restic') !== 'restic') {
    throw new Error('Als verschlüsselte Offsite-Zweitsicherung wird ausschließlich restic unterstützt.');
  }
  if (offsiteEnabled && !repository) throw new Error('Für die restic-Zweitsicherung fehlt das Repository.');
  if (offsiteEnabled && /[\0\r\n\t]/.test(repository)) {
    throw new Error('Das Offsite-Repository enthält unzulässige Steuerzeichen.');
  }
  if (offsiteEnabled && /\/\/[^/@:]+:[^/@]+@/.test(repository)) {
    throw new Error('Offsite-Zugangsdaten dürfen nicht im Repository stehen; verwenden Sie die getrennte restic-Konfiguration.');
  }
  if (offsiteEnabled && !/^(?:s3|sftp|rest|rclone|azure|gs|b2|swift):/i.test(repository)) {
    throw new Error('Die verschlüsselte Offsite-Zweitsicherung braucht ein entferntes restic-Repository (z. B. s3:, sftp:, rest: oder rclone:); ein lokaler/NAS-Pfad reicht nicht.');
  }
  if (offsiteEnabled && (!passwordFile || !path.isAbsolute(passwordFile))) {
    throw new Error('Die restic-Passwortdatei muss als absoluter Serverpfad angegeben werden.');
  }
  const tag = String(offsite.tag || 'betreuungsbuero').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(tag)) {
    throw new Error('Der restic-Tag enthält unzulässige Zeichen.');
  }
  const offsiteRetentionMode = String(offsite.retentionMode || 'external').trim();
  if (offsiteEnabled && offsiteRetentionMode !== 'external') {
    throw new Error(
      'Remote-Retention darf nur durch die getrennte Offsite-Wartung mit kurzlebigen Löschrechten ausgeführt werden.'
    );
  }
  const heartbeatEnabled = !!heartbeat.enabled;
  const heartbeatUrl = String(heartbeat.url || heartbeat.heartbeatUrl || '').trim();
  const heartbeatSecretFile = String(heartbeat.secretFile || '').trim();
  const backupTargetId = String(o.backupTargetId || '').trim().toLowerCase();
  if (backupTargetId
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(backupTargetId)) {
    throw new Error('Die gespeicherte TARGET_ID des Sicherungsdatenträgers ist ungültig.');
  }
  if (heartbeatEnabled) {
    let parsed;
    try { parsed = new URL(heartbeatUrl); }
    catch (_error) { throw new Error('Die Dead-Man-Heartbeat-URL ist ungültig.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('Die Dead-Man-Heartbeat-URL muss HTTPS ohne Zugangsdaten, Query oder Fragment verwenden.');
    }
    if (!path.isAbsolute(heartbeatSecretFile)) {
      throw new Error('Die Dead-Man-Secret-Datei muss als absoluter Serverpfad angegeben werden.');
    }
  }
  const daily = ganzzahl(retention.daily, DEFAULT_BACKUP_OPTIONS.retention.daily, 0, 3650, 'Die Zahl täglicher Generationen');
  const monthly = ganzzahl(retention.monthly, DEFAULT_BACKUP_OPTIONS.retention.monthly, 0, 120, 'Die Zahl monatlicher Generationen');
  const yearly = ganzzahl(retention.yearly, DEFAULT_BACKUP_OPTIONS.retention.yearly, 0, 100, 'Die Zahl jährlicher Generationen');
  const diagnostic = ganzzahl(
    retention.diagnostic,
    DEFAULT_BACKUP_OPTIONS.retention.diagnostic,
    0,
    100,
    'Die Zahl diagnostischer Generationen'
  );
  if (retention.enabled && !daily && !monthly && !yearly) {
    throw new Error('Ein aktivierter Generationenplan muss mindestens eine tägliche, monatliche oder jährliche Generation behalten.');
  }

  return {
    retry: { maxRetries, backoffMinutes: backoff },
    timeoutMinutes: ganzzahl(o.timeoutMinutes, DEFAULT_BACKUP_OPTIONS.timeoutMinutes, 1, 1440, 'Die Laufzeitgrenze'),
    catchUp: o.catchUp === undefined ? DEFAULT_BACKUP_OPTIONS.catchUp : !!o.catchUp,
    overdueHours: ganzzahl(o.overdueHours, DEFAULT_BACKUP_OPTIONS.overdueHours, 1, 720, 'Die Überfälligkeitsschwelle'),
    consistencyRetries: ganzzahl(o.consistencyRetries, DEFAULT_BACKUP_OPTIONS.consistencyRetries, 0, 5, 'Die Zahl der Konsistenzwiederholungen'),
    capacity: {
      warningPercent: ganzzahl(
        capacity.warningPercent,
        DEFAULT_BACKUP_OPTIONS.capacity.warningPercent,
        0,
        99,
        'Die prozentuale Kapazitätsreserve'
      )
    },
    localTargetEncryptedAttested: !!o.localTargetEncryptedAttested,
    backupTargetId,
    alert: {
      email: alert.email === undefined ? DEFAULT_BACKUP_OPTIONS.alert.email : !!alert.email,
      repeatHours: ganzzahl(alert.repeatHours, DEFAULT_BACKUP_OPTIONS.alert.repeatHours, 1, 720, 'Der Warnungsabstand')
    },
    retention: {
      enabled: !!retention.enabled,
      daily,
      monthly,
      yearly,
      diagnostic,
      minFreeGb: ganzzahl(retention.minFreeGb, DEFAULT_BACKUP_OPTIONS.retention.minFreeGb, 0, 1048576, 'Die freie Mindestkapazität')
    },
    offsite: {
      enabled: offsiteEnabled,
      mode: 'restic',
      repository,
      passwordFile,
      tag,
      required: offsite.required === undefined ? true : !!offsite.required,
      retentionMode: 'external',
      maxPending: ganzzahl(offsite.maxPending, DEFAULT_BACKUP_OPTIONS.offsite.maxPending, 1, 365, 'Die maximale Offsite-Warteschlange'),
      checkDays: ganzzahl(offsite.checkDays, DEFAULT_BACKUP_OPTIONS.offsite.checkDays, 1, 365, 'Das Offsite-Prüfintervall'),
      readSlices: ganzzahl(
        offsite.readSlices,
        DEFAULT_BACKUP_OPTIONS.offsite.readSlices,
        1,
        64,
        'Die Zahl rotierender Offsite-Datenprüfungen'
      ),
      immutableAttested: !!offsite.immutableAttested,
      lifecycleAttested: !!offsite.lifecycleAttested
    },
    heartbeat: {
      enabled: heartbeatEnabled,
      url: heartbeatUrl,
      secretFile: heartbeatSecretFile,
      timeoutMs: ganzzahl(heartbeat.timeoutMs, DEFAULT_BACKUP_OPTIONS.heartbeat.timeoutMs, 1000, 60000, 'Das Dead-Man-Zeitlimit')
    }
  };
}

function optionenVonJob(job) {
  let raw;
  try {
    raw = JSON.parse((job && job.options_json) || '{}');
  } catch (error) {
    throw new Error('Ungültige Sicherungsoptionen (JSON): ' + (error.message || error));
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Ungültige Sicherungsoptionen: Erwartet wird ein JSON-Objekt.');
  }
  try {
    return normalisiereOptionen(raw);
  } catch (error) {
    throw new Error('Ungültige Sicherungsoptionen: ' + (error.message || error));
  }
}

// SQLite-UTC ("YYYY-MM-DD HH:MM:SS") und ISO gleichermassen als UTC lesen - JS wuerde das
// SQLite-Format sonst als Ortszeit deuten und der Inkrementalvergleich verschoebe sich.
function zeitVon(s) {
  s = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}
function lokalTag(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function uhrzeit(job) {
  const hm = /^(\d{1,2}):(\d{2})$/.exec(String((job && job.time_hhmm) || '').trim());
  if (!hm) return null;
  const h = Number(hm[1]), m = Number(hm[2]);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59 ? { h, m } : null;
}
function tagesKandidat(tag, hm) {
  return new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), hm.h, hm.m, 0, 0);
}
function isoWochentag(tag) {
  return ((tag.getDay() + 6) % 7) + 1; // Mo=1 .. So=7
}
function passtKalendertag(job, tag) {
  if (job.interval === 'woechentlich') {
    const tage = String(job.weekdays || '').split(',').map((x) => Number(x.trim())).filter(Boolean);
    return !tage.length || tage.includes(isoWochentag(tag));
  }
  if (job.interval === 'monatlich') {
    const monatstag = Number(String(job.weekdays || '').split(',')[0]) || 1;
    return tag.getDate() === monatstag;
  }
  return true;
}

// Letzter planmäßiger Termin <= jetzt. Für die unterstützten Rhythmen liegt
// der letzte Treffer höchstens 31 Tage zurück; 370 Iterationen lassen selbst
// beschädigte Altwerte sicher und ohne Endlosschleife auslaufen.
function letzterPlanTermin(job, jetzt, options) {
  if (!job || !job.enabled || job.interval === 'laufend' || job.interval === 'stuendlich') return null;
  const hm = uhrzeit(job);
  if (!hm) return null;
  const opt = options || optionenVonJob(job);
  for (let i = 0; i <= 370; i++) {
    const tag = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() - i, 12, 0, 0, 0);
    if (!passtKalendertag(job, tag)) continue;
    const kandidat = tagesKandidat(tag, hm);
    if (kandidat.getTime() > jetzt.getTime()) continue;
    if (!opt.catchUp && lokalTag(kandidat) !== lokalTag(jetzt)) return null;
    const erstellt = zeitVon(job.created_at);
    if (erstellt && kandidat.getTime() < erstellt) return null;
    return kandidat;
  }
  return null;
}

// Erster planmäßiger Termin strikt nach einem Referenzzeitpunkt. Der
// Healthstatus misst die Toleranz ab diesem erwarteten Lauf, nicht pauschal ab
// dem letzten Erfolg. Dadurch werden Wochen- und Monatspläne nicht bereits
// zwischen zwei regulären Terminen als überfällig gemeldet.
function naechsterPlanTermin(job, nach) {
  if (!job || !job.enabled || job.interval === 'laufend' || job.interval === 'stuendlich') return null;
  const hm = uhrzeit(job);
  if (!hm || !(nach instanceof Date) || !Number.isFinite(nach.getTime())) return null;
  for (let i = 0; i <= 370; i++) {
    const tag = new Date(nach.getFullYear(), nach.getMonth(), nach.getDate() + i, 12, 0, 0, 0);
    if (!passtKalendertag(job, tag)) continue;
    const kandidat = tagesKandidat(tag, hm);
    if (kandidat.getTime() <= nach.getTime()) continue;
    return kandidat;
  }
  return null;
}

function faelligkeit(job, jetzt) {
  if (!job || !job.enabled) return false;
  const retryAt = zeitVon(job.next_retry_at);
  if (retryAt && retryAt <= jetzt.getTime()) {
    return { art: 'retry', scheduledAt: String(job.last_scheduled_at || ''), retryNumber: Number(job.retry_count) || 0 };
  }
  if (job.interval === 'laufend') return false;
  if (job.interval === 'stuendlich') {
    const letzterMs = zeitVon(job.last_run_at);
    if (!letzterMs || (jetzt.getTime() - letzterMs) >= 59 * 60000) {
      return { art: 'schedule', scheduledAt: jetzt.toISOString(), retryNumber: 0 };
    }
    return false;
  }
  const termin = letzterPlanTermin(job, jetzt);
  if (!termin) return false;
  const erledigt = zeitVon(job.last_scheduled_at || job.last_run_at);
  if (erledigt && erledigt >= termin.getTime()) return false;
  return { art: 'schedule', scheduledAt: termin.toISOString(), retryNumber: 0 };
}
function istFaellig(job, jetzt) {
  return !!faelligkeit(job, jetzt);
}

/* ---------- Quelle: virtuellen Baum einsammeln ---------- */

function fallNamen() {
  const map = new Map();
  const belegt = new Map();
  for (const c of stmt.faelle.all()) {
    let n = intern.cleanName(String(c.label || '').trim()) || ('Fall-' + String(c.id).slice(0, 8));
    const k = n.toLowerCase();
    const anz = belegt.get(k) || 0;
    belegt.set(k, anz + 1);
    if (anz) n = n + ' (' + (anz + 1) + ')';
    map.set(String(c.id), n);
  }
  return map;
}

// Liefert [{segmente:[...], name, row}] - segmente relativ zur Sicherungswurzel, im gleichen
// Baum wie die WebDAV-Freigabe (Fallakten/<Fallname>/... bzw. Bueroorganisation/...).
function sammel(quelle) {
  const ordner = new Map();
  for (const o of stmt.ordner.all()) ordner.set(String(o.id), o);
  const kettenCache = new Map();
  function kette(folderId) {
    if (!folderId) return [];
    const key = String(folderId);
    if (kettenCache.has(key)) return kettenCache.get(key);
    const o = ordner.get(key);
    const seg = o ? kette(o.parent_id).concat(String(o.name || '')) : [];
    kettenCache.set(key, seg);
    return seg;
  }
  const namen = fallNamen();
  function wurzel(row) {
    if (row.area === 'office') return ['Büroorganisation'];
    const n = namen.get(String(row.case_id || ''));
    return n ? ['Fallakten', n] : null;                            // Fall geloescht -> Datei auslassen
  }
  const bereich = (quelle && quelle.bereich) || 'alles';
  const caseId = String((quelle && quelle.caseId) || '');
  const liste = [];
  for (const f of stmt.dateien.all()) {
    if (bereich === 'office' && f.area !== 'office') continue;
    if (bereich === 'case' && (f.area !== 'case' || String(f.case_id || '') !== caseId)) continue;
    const w = wurzel(f);
    if (!w) continue;
    liste.push({ segmente: w.concat(kette(f.folder_id)), name: String(f.name || ''), row: f });
  }
  return liste;
}

/* ---------- ZIP-Writer (Methode STORE, UTF-8-Namen) ----------
   Bewusst ohne Fremdpaket. Der Writer arbeitet strombasiert und schreibt bei
   Bedarf ZIP64: Eine 1-GB-Datei wird nie zusätzlich vollständig in den RAM
   geladen; Fallakten über 4 GB und mehr als 65535 Einträge bleiben lesbar. */

const CRC_TAB = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32Update(state, buf) {
  let c = state;
  for (let i = 0; i < buf.length; i++) c = CRC_TAB[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return c;
}

function crc32(buf) {
  return (crc32Update(-1, buf) ^ -1) >>> 0;
}

function dosZeit(d) {
  return {
    zeit: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31),
    datum: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
  };
}

function zip64Extra(values) {
  if (!values.length) return Buffer.alloc(0);
  const extra = Buffer.alloc(4 + values.length * 8);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(values.length * 8, 2);
  values.forEach((value, index) => extra.writeBigUInt64LE(BigInt(value), 4 + index * 8));
  return extra;
}

function zipSourceError(entry, code, message) {
  const error = new Error(message || `Datei während der ZIP-Erstellung verändert: ${String(entry.pfad || '')}`);
  error.code = code;
  error.path = String(entry.pfad || '');
  return error;
}

function sourcePruefen(entry) {
  let fd = null;
  try {
    const before = fs.statSync(entry.quelle);
    if (!before.isFile()) return null;
    fd = fs.openSync(entry.quelle, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const hash = crypto.createHash('sha256');
    let crcState = -1;
    let size = 0n;
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      const chunk = buffer.subarray(0, read);
      hash.update(chunk);
      crcState = crc32Update(crcState, chunk);
      size += BigInt(read);
    }
    fs.closeSync(fd);
    fd = null;
    const after = fs.statSync(entry.quelle);
    if (before.dev !== after.dev || before.ino !== after.ino ||
        before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        size !== BigInt(after.size)) {
      throw zipSourceError(entry, 'ZIP_SOURCE_CHANGED');
    }
    const sha256 = hash.digest('hex');
    if (entry.sha256 && sha256 !== String(entry.sha256).toLowerCase()) {
      throw zipSourceError(entry, 'ZIP_SOURCE_CHANGED');
    }
    return {
      size,
      crc: (crcState ^ -1) >>> 0,
      sha256,
      mtime: after.mtime,
      dev: after.dev,
      ino: after.ino,
      mtimeMs: after.mtimeMs
    };
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_ignore) { /* eigener Deskriptor */ }
    }
    if (error && error.code === 'ZIP_SOURCE_CHANGED') throw error;
    return null;
  }
}

function sourceSchreiben(entry, expected, write) {
  let fd = null;
  try {
    const before = fs.statSync(entry.quelle);
    if (!before.isFile() || before.dev !== expected.dev || before.ino !== expected.ino ||
        before.size !== Number(expected.size) || before.mtimeMs !== expected.mtimeMs) {
      throw zipSourceError(entry, 'ZIP_SOURCE_CHANGED');
    }
    fd = fs.openSync(entry.quelle, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const hash = crypto.createHash('sha256');
    let crcState = -1;
    let size = 0n;
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      const chunk = buffer.subarray(0, read);
      hash.update(chunk);
      crcState = crc32Update(crcState, chunk);
      size += BigInt(read);
      write(chunk);
    }
    fs.closeSync(fd);
    fd = null;
    const after = fs.statSync(entry.quelle);
    const sha256 = hash.digest('hex');
    const crc = (crcState ^ -1) >>> 0;
    if (before.dev !== after.dev || before.ino !== after.ino ||
        before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        size !== expected.size || crc !== expected.crc || sha256 !== expected.sha256) {
      throw zipSourceError(entry, 'ZIP_SOURCE_CHANGED');
    }
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_ignore) { /* eigener Deskriptor */ }
    }
    if (error && error.code === 'ZIP_SOURCE_CHANGED') throw error;
    throw zipSourceError(
      entry,
      'ZIP_SOURCE_MISSING',
      `Datei verschwand während der ZIP-Erstellung: ${String(entry.pfad || '')}`
    );
  }
}

function zipSchreiben(zielPfad, eintraege, options) {
  const opts = options || {};
  const vorbereitet = [];
  let dateien = 0;
  let fehlend = 0;
  const fehlendePfade = [];

  // Die Vorprüfung berechnet CRC und SHA strombasiert, bevor die erste lokale
  // ZIP-Struktur geschrieben wird. Fehlende Quellen können so gezählt werden,
  // ohne ein Teilpaket mit kaputtem Eintrag zu erzeugen.
  for (const entry of eintraege) {
    const name = Buffer.from(String(entry.pfad || ''), 'utf8');
    if (!name.length || name.length > 0xFFFF) {
      throw new Error(`ZIP-Pfad ist leer oder länger als 65535 UTF-8-Bytes: ${String(entry.pfad || '')}`);
    }
    if (Buffer.isBuffer(entry.bytes)) {
      const sha256 = crypto.createHash('sha256').update(entry.bytes).digest('hex');
      if (entry.sha256 && sha256 !== String(entry.sha256).toLowerCase()) {
        throw zipSourceError(entry, 'ZIP_SOURCE_CHANGED');
      }
      vorbereitet.push({
        entry,
        name,
        bytes: entry.bytes,
        info: {
          size: BigInt(entry.bytes.length),
          crc: crc32(entry.bytes),
          sha256,
          mtime: entry.mtime ? new Date(entry.mtime) : new Date()
        }
      });
      continue;
    }
    const info = sourcePruefen(entry);
    if (!info) {
      fehlend++;
      fehlendePfade.push(String(entry.pfad || ''));
      continue;
    }
    vorbereitet.push({ entry, name, bytes: null, info });
  }

  const fd = fs.openSync(zielPfad, 'wx');
  const zentral = [];
  let offset = 0n;
  const MAX32 = 0xFFFFFFFFn;
  const schreib = (buf) => {
    let written = 0;
    while (written < buf.length) {
      written += fs.writeSync(fd, buf, written, buf.length - written);
    }
    offset += BigInt(buf.length);
  };

  try {
    for (const prepared of vorbereitet) {
      const { entry, name, bytes, info } = prepared;
      const localOffset = offset;
      const largeSize = info.size >= MAX32;
      const localExtra = largeSize ? zip64Extra([info.size, info.size]) : Buffer.alloc(0);
      const dz = dosZeit(entry.mtime ? new Date(entry.mtime) : info.mtime);
      const kopf = Buffer.alloc(30);
      kopf.writeUInt32LE(0x04034B50, 0);
      kopf.writeUInt16LE(largeSize ? 45 : 20, 4);
      kopf.writeUInt16LE(0x0800, 6);
      kopf.writeUInt16LE(0, 8);
      kopf.writeUInt16LE(dz.zeit, 10);
      kopf.writeUInt16LE(dz.datum, 12);
      kopf.writeUInt32LE(info.crc, 14);
      kopf.writeUInt32LE(largeSize ? 0xFFFFFFFF : Number(info.size), 18);
      kopf.writeUInt32LE(largeSize ? 0xFFFFFFFF : Number(info.size), 22);
      kopf.writeUInt16LE(name.length, 26);
      kopf.writeUInt16LE(localExtra.length, 28);
      zentral.push({
        name,
        crc: info.crc,
        groesse: info.size,
        zeit: dz.zeit,
        datum: dz.datum,
        offset: localOffset
      });
      schreib(kopf);
      schreib(name);
      if (localExtra.length) schreib(localExtra);
      if (bytes) schreib(bytes);
      else sourceSchreiben(entry, info, schreib);
      dateien++;
    }

    const cdStart = offset;
    for (const z of zentral) {
      const largeSize = z.groesse >= MAX32;
      const largeOffset = z.offset >= MAX32;
      const centralValues = [];
      if (largeSize) centralValues.push(z.groesse, z.groesse);
      if (largeOffset) centralValues.push(z.offset);
      const centralExtra = zip64Extra(centralValues);
      const k = Buffer.alloc(46);
      k.writeUInt32LE(0x02014B50, 0);
      k.writeUInt16LE(45, 4);
      k.writeUInt16LE((largeSize || largeOffset) ? 45 : 20, 6);
      k.writeUInt16LE(0x0800, 8);
      k.writeUInt16LE(0, 10);
      k.writeUInt16LE(z.zeit, 12);
      k.writeUInt16LE(z.datum, 14);
      k.writeUInt32LE(z.crc, 16);
      k.writeUInt32LE(largeSize ? 0xFFFFFFFF : Number(z.groesse), 20);
      k.writeUInt32LE(largeSize ? 0xFFFFFFFF : Number(z.groesse), 24);
      k.writeUInt16LE(z.name.length, 28);
      k.writeUInt16LE(centralExtra.length, 30);
      k.writeUInt16LE(0, 32);
      k.writeUInt16LE(0, 34);
      k.writeUInt16LE(0, 36);
      k.writeUInt32LE(0, 38);
      k.writeUInt32LE(largeOffset ? 0xFFFFFFFF : Number(z.offset), 42);
      schreib(k);
      schreib(z.name);
      if (centralExtra.length) schreib(centralExtra);
    }

    const cdSize = offset - cdStart;
    const count = BigInt(zentral.length);
    const needsZip64 = !!opts.forceZip64 || count > 0xFFFFn || cdStart >= MAX32 || cdSize >= MAX32;
    if (needsZip64) {
      const zip64Offset = offset;
      const zip64 = Buffer.alloc(56);
      zip64.writeUInt32LE(0x06064B50, 0);
      zip64.writeBigUInt64LE(44n, 4);
      zip64.writeUInt16LE(45, 12);
      zip64.writeUInt16LE(45, 14);
      zip64.writeUInt32LE(0, 16);
      zip64.writeUInt32LE(0, 20);
      zip64.writeBigUInt64LE(count, 24);
      zip64.writeBigUInt64LE(count, 32);
      zip64.writeBigUInt64LE(cdSize, 40);
      zip64.writeBigUInt64LE(cdStart, 48);
      schreib(zip64);

      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(0x07064B50, 0);
      locator.writeUInt32LE(0, 4);
      locator.writeBigUInt64LE(zip64Offset, 8);
      locator.writeUInt32LE(1, 16);
      schreib(locator);
    }

    const ende = Buffer.alloc(22);
    ende.writeUInt32LE(0x06054B50, 0);
    ende.writeUInt16LE(0, 4);
    ende.writeUInt16LE(0, 6);
    ende.writeUInt16LE(count > 0xFFFFn ? 0xFFFF : Number(count), 8);
    ende.writeUInt16LE(count > 0xFFFFn ? 0xFFFF : Number(count), 10);
    ende.writeUInt32LE(cdSize >= MAX32 ? 0xFFFFFFFF : Number(cdSize), 12);
    ende.writeUInt32LE(cdStart >= MAX32 ? 0xFFFFFFFF : Number(cdStart), 16);
    ende.writeUInt16LE(0, 20);
    schreib(ende);
  } catch (error) {
    fs.closeSync(fd);
    try { fs.unlinkSync(zielPfad); } catch (_ignore) { /* halbe ZIP nicht liegen lassen */ }
    throw error;
  }
  fs.closeSync(fd);
  return { dateien, fehlend, fehlendePfade, bytes: Number(offset) };
}

/* ---------- Laeufe ---------- */

function stempel(d) {
  return lokalTag(d) + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
}
function bereichKurz(quelle) {
  if (!quelle || quelle.bereich === 'alles' || !quelle.bereich) return 'Alles';
  if (quelle.bereich === 'office') return 'Büroorganisation';
  return 'Fallakte';
}
function mb(n) { return (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }

function abbruchFehler(signal, fallback) {
  if (signal && signal.reason instanceof Error) return signal.reason;
  const error = new Error(fallback || 'Die Mount-Operation wurde abgebrochen.');
  error.code = 'MOUNT_ABORTED';
  return error;
}

function warteAbbrechbar(promise, signal) {
  const operation = Promise.resolve(promise);
  auslaufendeMountOperationen.add(operation);
  operation.then(
    () => auslaufendeMountOperationen.delete(operation),
    () => auslaufendeMountOperationen.delete(operation)
  );
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(abbruchFehler(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abbruchFehler(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function zeitgrenze(promise, timeoutMs, message) {
  const ms = Math.max(10, Number(timeoutMs) || 30000);
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message || 'Zeitgrenze überschritten.');
        error.code = 'TIMEOUT';
        reject(error);
      }, ms);
      if (timer.unref) timer.unref();
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function laufZip(ziel, liste, quelle) {
  const ordner = path.resolve(String(ziel.ordner || '').trim());
  if (!String(ziel.ordner || '').trim()) throw new Error('Zielordner fehlt.');
  fs.mkdirSync(ordner, { recursive: true });
  const zielPfad = path.join(ordner, 'Dokumente-Sicherung_' + intern.cleanName(bereichKurz(quelle)) + '_' + stempel(new Date()) + '.zip');
  const eintraege = liste.map((e) => {
    const quelleP = intern.findBlobPath(e.row);
    return quelleP ? { pfad: e.segmente.concat(e.name).join('/'), quelle: quelleP } : null;
  }).filter(Boolean);
  const ohneBlob = liste.length - eintraege.length;
  const erg = zipSchreiben(zielPfad, eintraege);
  const weg = ohneBlob + erg.fehlend;
  if (weg) {
    try { fs.unlinkSync(zielPfad); } catch (_ignore) { /* unvollständiges Exportpaket nicht stehen lassen */ }
    throw new Error(weg + ' Quelldatei(en) fehlen; das unvollständige Dokumenten-ZIP wurde verworfen.');
  }
  const text = erg.dateien + ' Dateien, ' + mb(erg.bytes) + ' → ' + zielPfad;
  return text;
}

async function laufMount(ziel, liste, letzterLauf, laufOptionen) {
  if (!ziel.mountId) throw new Error('Verbindung fehlt.');
  if (auslaufendeMountOperationen.size) {
    throw new Error('Eine nach Zeitüberschreitung abgebrochene Mount-Operation läuft beim Anbieter noch aus; der nächste Lauf wartet, damit keine Uploads überlappen.');
  }
  const info = intern.mountInfo(ziel.mountId);
  if (!info) throw new Error('Verbindung nicht gefunden oder deaktiviert.');
  const opts = laufOptionen && typeof laufOptionen === 'object' ? laufOptionen : {};
  const timeoutMs = Math.max(10, Number(opts.timeoutMs) || 180 * 60000);
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => {
    const error = new Error('Die Gesamtzeitgrenze des Mount-Laufs wurde überschritten.');
    error.code = 'MOUNT_TIMEOUT';
    controller.abort(error);
  }, timeoutMs);
  if (deadlineTimer.unref) deadlineTimer.unref();
  const mountCall = (fn) => {
    if (controller.signal.aborted) throw abbruchFehler(controller.signal);
    return warteAbbrechbar(Promise.resolve().then(fn), controller.signal);
  };
  const praefix = String(ziel.unterordner || '').split('/').map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..');
  const grenze = zeitVon(letzterLauf);
  let uebertragen = 0, unveraendert = 0, fehlend = 0;
  const fehler = [];
  const ordnerFertig = new Set();
  async function ordnerSicher(seg) {
    for (let i = 1; i <= seg.length; i++) {
      const key = seg.slice(0, i).join('/');
      if (ordnerFertig.has(key)) continue;
      await mountCall(() => intern.mountOrdner(
        ziel.mountId,
        seg.slice(0, i),
        { signal: controller.signal }
      ));
      ordnerFertig.add(key);
    }
  }
  try {
    for (const e of liste) {
      if (controller.signal.aborted) throw abbruchFehler(controller.signal);
      if (grenze && zeitVon(e.row.updated_at) <= grenze) { unveraendert++; continue; }
      const quelleP = intern.findBlobPath(e.row);
      if (!quelleP) { fehlend++; continue; }
      const seg = praefix.concat(e.segmente);
      try {
        await ordnerSicher(seg);
        await mountCall(() => intern.mountSchreib(
          ziel.mountId,
          seg,
          e.name,
          fs.readFileSync(quelleP),
          { signal: controller.signal }
        ));
        uebertragen++;
      } catch (err) {
        if (controller.signal.aborted) throw abbruchFehler(controller.signal);
        if (fehler.length < 3) fehler.push(e.name + ': ' + (err.message || err));
      }
    }
  } finally {
    clearTimeout(deadlineTimer);
  }
  let text = uebertragen + ' übertragen auf „' + info.label + '"' + (unveraendert ? ', ' + unveraendert + ' unverändert' : '');
  if (fehlend) text += ', ' + fehlend + ' ohne auffindbare Datei';
  if (fehlend || fehler.length) {
    const details = [];
    if (fehlend) details.push(fehlend + ' Quelldatei(en) fehlen');
    if (fehler.length) details.push('Fehler: ' + fehler.join(' · '));
    throw new Error(text + ' - ' + details.join(' · '));
  }
  return text;
}

function bindeBackupZiel(job, options, targetId) {
  let rawOptions;
  try { rawOptions = JSON.parse(String((job && job.options_json) || '{}')); }
  catch (_error) { throw new Error('Die Sicherungsoptionen konnten beim Binden des Zielmediums nicht gelesen werden.'); }
  if (!rawOptions || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) {
    throw new Error('Die Sicherungsoptionen konnten beim Binden des Zielmediums nicht gelesen werden.');
  }
  rawOptions.backupTargetId = String(targetId || '').toLowerCase();
  const oldOptionsJson = String((job && job.options_json) || '{}');
  const newOptionsJson = JSON.stringify(rawOptions);
  const bound = stmt.zielBinden.run({
    id: String((job && job.id) || ''),
    oldOptionsJson,
    optionsJson: newOptionsJson
  });
  if (bound.changes !== 1) {
    throw new Error('Der Sicherungszeitplan wurde während der Zielmedium-Bindung geändert; der Lauf wurde vor der Aufnahme beendet.');
  }
  job.options_json = newOptionsJson;
  options.backupTargetId = rawOptions.backupTargetId;
  return rawOptions.backupTargetId;
}

function gesamtRunnerOptionen(ziel, job, opt) {
  const serverDir = SERVER_ROOT;
  const dataDir = DATA_ROOT;
  const dbPath = (db && db.name) || DATABASE_PATH;
  return {
    jobId: String((job && job.id) || 'manual'),
    serverDir,
    dataDir,
    dbPath,
    storageRoot: intern && intern.documentStorage && typeof intern.documentStorage.root === 'function'
      ? intern.documentStorage.root()
      : '',
    destination: ziel.ordner,
    expectedTargetId: opt.backupTargetId,
    label: String((job && job.label) || 'zeitplan'),
    timeoutMs: opt.timeoutMinutes * 60000,
    consistencyRetries: opt.consistencyRetries,
    retention: opt.retention.enabled ? {
      daily: opt.retention.daily,
      monthly: opt.retention.monthly,
      yearly: opt.retention.yearly,
      diagnostic: opt.retention.diagnostic
    } : undefined,
    capacity: {
      warningPercent: opt.capacity.warningPercent,
      warningBytes: opt.retention.minFreeGb * 1024 * 1024 * 1024
    },
    offsite: opt.offsite.enabled ? {
      enabled: true,
      mode: 'restic',
      repository: opt.offsite.repository,
      passwordFile: opt.offsite.passwordFile,
      tag: opt.offsite.tag,
      required: opt.offsite.required,
      retentionMode: opt.offsite.retentionMode,
      maxPending: opt.offsite.maxPending,
      checkDays: opt.offsite.checkDays,
      readSlices: opt.offsite.readSlices
    } : undefined,
    heartbeat: opt.heartbeat.enabled ? opt.heartbeat : undefined
  };
}

async function laufGesamt(ziel, job, options, runMode) {
  const operationName = 'Gesamtsicherung ' + String((job && job.id) || 'manual');
  const opt = options || optionenVonJob(job);
  if (!opt.backupTargetId && totalBackupRunner === defaultRunTotalBackup) {
    // Der erste bewusst gestartete Lauf bindet den Zeitplan an die stabile
    // TARGET_ID der vorhandenen Zielmarke. Ab dem Folgelauf wird ein anderer
    // Datenträger am gleichen Mountpfad fail-closed abgelehnt.
    const targetId = readBackupTargetMarker(path.resolve(String(ziel.ordner || ''))).targetId;
    bindeBackupZiel(job, opt, targetId);
    // Die CAS-Bindung ist Teil desselben Laufes, keine neue Nutzerkonfiguration.
    // Daher muss auch dessen spätere Erfolgs-/Fehler-CAS den gebundenen JSON-Text
    // erwarten. Die Bindung bleibt selbst bei einem späteren Offsite-Fehler
    // erhalten und verhindert so einen unbemerkten Datenträgerwechsel.
  }
  const runnerOptions = gesamtRunnerOptionen(ziel, job, opt);
  if (runMode && runMode.resumeOffsiteOnly) {
    // Die lokale Generation ist bereits vollständig und manifestgebunden. Der
    // reine Remote-Retry liest nur sie und braucht deshalb weder aktuelle
    // Materialisierungen noch die Anwendungs-/Dokumentenschreibsperre.
    const result = await totalBackupRunner({
      ...runnerOptions,
      resumeOffsiteOnly: true,
      resumeSnapshot: String(runMode.resumeSnapshot || '')
    });
    return result.text;
  }
  let completion = null;
  /*
   * Verbindliche Sperrreihenfolge: zuerst als Schreiberbarriere anmelden und
   * laufende Writes auslaufen lassen, erst danach den Dokumentkoordinator
   * belegen. Ein bereits gezählter HTTP-Schreiber darf selbst auf den
   * Koordinator warten; die umgekehrte Reihenfolge erzeugte sonst einen Zyklus.
   */
  const writeBarrier = await applicationWriteBarrier.begin(operationName);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    writeBarrier.release();
  };
  try {
    await operationCoordinator.runExclusive(operationName, async () => {
      // Materialisierung und lokale SQLite-/Dateibaumaufnahme liegen gemeinsam
      // in der kurzen Schreibschranke. Offsite, Retention und Dead-Man laufen
      // nach der robust geparsten SNAPSHOT-Zeile ohne 503-Fenster weiter.
      const materializations = require('../documents/materializations').current();
      if (materializations) {
        // Aktuelle Fall-/Büroabbilder werden anhand ihrer Quellrevision
        // übersprungen; bei bis zu 1000 Fällen darf die 503-Phase nicht alle
        // XLSX/JSON-Dateien grundlos neu im Speicher erzeugen. Nur das
        // zusammengehörige Recovery-Doppelabbild wird vor jedem Vollbackup
        // zwingend frisch und mit gemeinsamer Generation veröffentlicht.
        const result = typeof materializations.prepareTotalBackup === 'function'
          ? materializations.prepareTotalBackup()
          : materializations.runAll({ forceSecurity: true });
        const errors = [
          ...(result.office || []),
          ...Object.values(result.cases || {}).flat()
        ].filter((entry) => entry && entry.error);
        if (errors.length) {
          throw new Error('Sicherungsabbilder konnten nicht vollständig aktualisiert werden: ' + errors[0].error);
        }
      }
      let localResolve;
      let localReject;
      const localReady = new Promise((resolve, reject) => {
        localResolve = resolve;
        localReject = reject;
      });
      completion = totalBackupRunner({
        ...runnerOptions,
        onLocalSnapshotReady: (info) => {
          if (opt.offsite.enabled && opt.backupTargetId) {
            const retryContext = offsiteRetryKontext({
              localComplete: true,
              offsitePending: true,
              snapshot: info && info.snapshot
            }, opt, {});
            if (retryContext.kind !== 'offsite-pending') {
              throw new Error('Der fertige lokale Snapshot konnte nicht dauerhaft als Offsite-Wiederholungsgrund vermerkt werden.');
            }
            const persisted = stmt.lokalVollstaendig.run({
              id: job.id,
              startedAt: String(runMode && runMode.startedAt || ''),
              configRevision: String(job.config_changed_at || ''),
              targetJson: String(job.target_json || '{}'),
              optionsJson: String(job.options_json || '{}'),
              retryContextJson: JSON.stringify(retryContext)
            });
            if (persisted.changes !== 1) {
              throw new Error('Der Sicherungszeitplan wurde vor der Offsite-Übergabe verändert; der lokale Snapshot bleibt sichtbar als wartend markiert.');
            }
          }
          release();
          localResolve();
        }
      });
      // Der Catch-Handler ist sofort angebracht; ein früher Kindprozessfehler
      // kann deshalb weder die Schranke hängen lassen noch unhandled werden.
      completion.then(
        () => localReject(new Error('Gesamtsicherung endete ohne lokale Snapshot-Bestätigung.')),
        localReject
      );
      await localReady;
    }, { priority: 100, timeoutMs: opt.timeoutMinutes * 60000 });
  } finally {
    release();
  }
  if (!completion) throw new Error('Gesamtsicherung wurde nicht gestartet.');
  const result = await completion;
  return result.text;
}

function naechsterRetry(options, retryNumber, jetzt) {
  if (retryNumber >= options.retry.maxRetries) return null;
  const nummer = retryNumber + 1;
  const liste = options.retry.backoffMinutes;
  const minuten = liste[Math.min(nummer - 1, liste.length - 1)] || 5;
  return { nummer, at: new Date(jetzt.getTime() + minuten * 60000).toISOString(), minuten };
}

function retryKontextVonJob(job) {
  let value;
  try { value = JSON.parse(String(job && job.retry_context_json || '{}')); }
  catch (_error) { return {}; }
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  if (value.kind !== 'offsite-pending') return {};
  const snapshot = String(value.snapshot || '');
  const targetId = String(value.targetId || '').toLowerCase();
  if (!/^[A-Za-z0-9_.-]{1,255}$/.test(snapshot)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(targetId)) {
    return {};
  }
  return { kind: 'offsite-pending', snapshot, targetId };
}

function offsiteRetryKontext(error, options, fallback) {
  if (error && error.localComplete && error.offsitePending && error.snapshot) {
    const snapshot = path.basename(String(error.snapshot));
    const targetId = String(options && options.backupTargetId || '').toLowerCase();
    if (/^[A-Za-z0-9_.-]{1,255}$/.test(snapshot)
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(targetId)) {
      return { kind: 'offsite-pending', snapshot, targetId };
    }
  }
  return fallback && fallback.kind === 'offsite-pending' ? fallback : {};
}

async function laufJob(job, context) {
  bereite();
  job = stmt.job.get(String(job && job.id));
  if (!job) return { ok: false, error: 'Zeitplan nicht gefunden.' };
  const ctx = context || { art: 'manual', scheduledAt: jetztFn().toISOString(), retryNumber: 0 };
  let options;
  try {
    options = optionenVonJob(job);
  } catch (error) {
    // Fail closed: Ein beschädigter oder künftig inkompatibler Optionssatz
    // darf niemals mit stillen Standardwerten ausgeführt werden.
    return { ok: false, error: String(error.message || error), result: 'Konfigurationsfehler: ' + String(error.message || error) };
  }
  const storedRetryContext = retryKontextVonJob(job);
  const activeRetryContext = ctx.art === 'retry' ? storedRetryContext : {};
  const resumeOffsiteOnly = activeRetryContext.kind === 'offsite-pending'
    && activeRetryContext.targetId === String(options.backupTargetId || '').toLowerCase();
  const startedAt = jetztFn();
  const configRevision = String(job.config_changed_at || '');
  const startReservation = stmt.laufStart.run({
    startedAt: startedAt.toISOString(),
    scheduledAt: String(ctx.scheduledAt || ''),
    // Ein manueller oder neu planmäßiger Lauf nimmt zwar immer eine frische
    // Generation auf, darf den noch offenen älteren Remote-Nachweis aber erst
    // ersetzen, nachdem onLocalSnapshotReady den neuen Snapshot dauerhaft
    // bestätigt hat. Ein Absturz oder Fehler davor lässt so den alten
    // Wiederaufnahmezeiger unverändert.
    retryContextJson: JSON.stringify(storedRetryContext),
    id: job.id
  });
  if (startReservation.changes !== 1) {
    return {
      ok: false,
      skipped: true,
      error: 'Der Zeitplan wurde zwischen Auswahl und Laufstart pausiert oder anderweitig reserviert.'
    };
  }
  const t0 = Date.now();
  const sourceConfig = quellKonfiguration(job);
  const targetConfig = zielKonfiguration(job);
  const quelle = sourceConfig.value;
  const ziel = targetConfig.value;
  try {
    if (sourceConfig.error) throw new Error(sourceConfig.error);
    if (targetConfig.error) throw new Error(targetConfig.error);
    let text;
    if (ziel.art === 'gesamt') {
      text = await laufGesamt(ziel, job, options, {
        resumeOffsiteOnly,
        resumeSnapshot: activeRetryContext.snapshot || '',
        startedAt: startedAt.toISOString()
      });
    } else {
      const liste = sammel(quelle);
      if (ziel.art === 'zip') text = laufZip(ziel, liste, quelle);
      else if (ziel.art === 'mount') {
        text = await laufMount(
          ziel,
          liste,
          job.mount_cursor_at || '',
          { timeoutMs: options.timeoutMinutes * 60000 }
        );
      }
      else throw new Error('Unbekannte Zielart.');
    }
    const dauer = Math.max(1, Math.round((Date.now() - t0) / 1000));
    const finishedAt = jetztFn().toISOString();
    const result = 'ok: ' + text + ' (' + dauer + ' s)';
    const revisionParams = {
      id: job.id,
      configRevision,
      sourceJson: String(job.source_json || '{}'),
      targetJson: String(job.target_json || '{}'),
      optionsJson: String(job.options_json || '{}')
    };
    /*
     * Beim inkrementellen Mount ist der Wasserstand der LaufSTART (mit einer
     * Sekunde Überlappung für SQLites sekundengenaue Zeitstempel), nicht das
     * Laufende. Dateien, die nach dem Einsammeln während eines langen Uploads
     * entstehen, liegen damit sicher über dem Cursor des Folgelaufs. Die
     * Überlappung darf höchstens einen idempotenten Wiederholungsupload erzeugen.
     */
    const mountCursorAt = ziel.art === 'mount'
      ? new Date(startedAt.getTime() - 1000).toISOString()
      : '';
    const update = stmt.laufErfolg.run({ finishedAt, mountCursorAt, result, ...revisionParams });
    if (!update.changes) {
      stmt.laufVeralteteKonfiguration.run({
        id: job.id,
        startedAt: startedAt.toISOString(),
        result: 'Hinweis: Der beendete Lauf gehörte zu einer inzwischen geänderten Konfiguration und wurde nicht als deren Erfolg gewertet.'
      });
      return {
        ok: false,
        staleConfig: true,
        error: 'Die Sicherung lief mit einer inzwischen geänderten oder gelöschten Konfiguration; sie wird nicht als Erfolg der neuen Konfiguration gewertet.'
      };
    }
    try { await aktualisiereWarnungen(jetztFn()); }
    catch (_warningError) {
      // Die Sicherung ist bereits geprüft und erfolgreich. Ein Fehler im
      // nachgelagerten Warnkanal darf diesen Zustand niemals in „Fehler“
      // umdeuten; der unabhängige Health-Watchdog versucht es erneut.
    }
    return { ok: true, result };
  } catch (e) {
    const finished = jetztFn();
    const retryNumber = Number(ctx.retryNumber) || 0;
    const retry = job.interval === 'laufend' ? null : naechsterRetry(options, retryNumber, finished);
    const grund = String(e && (e.message || e) || 'Unbekannter Fehler');
    const timeout = /Zeit(?:überschreitung|grenze|limit)|timeout/i.test(grund);
    let result = (timeout ? 'Zeitüberschreitung: ' : 'Fehler: ') + grund;
    if (retry) result += ' · Wiederholung ' + retry.nummer + '/' + options.retry.maxRetries + ' in ' + retry.minuten + ' Min.';
    const persistedLocalContext = retryKontextVonJob(stmt.job.get(job.id));
    const update = stmt.laufFehler.run({
      finishedAt: finished.toISOString(),
      result,
      nextRetryAt: retry ? retry.at : '',
      retryCount: retry ? retry.nummer : retryNumber,
      retryContextJson: JSON.stringify(
        offsiteRetryKontext(
          e,
          options,
          persistedLocalContext.kind === 'offsite-pending'
            ? persistedLocalContext
            : (resumeOffsiteOnly ? activeRetryContext : {})
        )
      ),
      id: job.id,
      configRevision,
      sourceJson: String(job.source_json || '{}'),
      targetJson: String(job.target_json || '{}'),
      optionsJson: String(job.options_json || '{}')
    });
    if (!update.changes) {
      stmt.laufVeralteteKonfiguration.run({
        id: job.id,
        startedAt: startedAt.toISOString(),
        result: 'Hinweis: Der fehlgeschlagene Lauf gehörte zu einer inzwischen geänderten Konfiguration und wurde nicht auf sie übertragen.'
      });
      return {
        ok: false,
        staleConfig: true,
        error: 'Der Lauf gehörte zu einer inzwischen geänderten oder gelöschten Konfiguration; sein Ergebnis wurde nicht auf die neue Konfiguration übertragen.'
      };
    }
    try { await aktualisiereWarnungen(jetztFn()); } catch (_warningError) { /* Fehlerstatus steht bereits dauerhaft */ }
    return { ok: false, error: grund, result, nextRetryAt: retry ? retry.at : '' };
  }
}

function unterbrocheneLaeufeBereinigen(jetzt) {
  bereite();
  for (const job of stmt.jobs.all()) {
    if (!job.run_started_at) continue;
    let options = null;
    let optionsError = '';
    try { options = optionenVonJob(job); }
    catch (error) { optionsError = String(error.message || error); }
    const retryNumber = Number(job.retry_count) || 0;
    let retry = options && job.enabled && job.interval !== 'laufend'
      ? naechsterRetry(options, retryNumber, jetzt)
      : null;
    const interruptedContext = retryKontextVonJob(job);
    if (!retry && options && job.enabled && job.interval !== 'laufend'
        && interruptedContext.kind === 'offsite-pending'
        && interruptedContext.targetId === String(options.backupTargetId || '').toLowerCase()) {
      /*
       * Genau ein zusätzlicher, sofortiger Reconciliation-Versuch ist auch
       * nach ausgeschöpftem Remote-Backoff zulässig: Der abgebrochene Prozess
       * könnte den positiven Offsite-Beleg bereits dauerhaft geschrieben
       * haben. retry_count wird dabei nicht erhöht. Scheitert auch diese
       * Prüfung, plant laufFehler keinen weiteren Versuch und die allgemeine
       * Wiederholungsgrenze bleibt wirksam.
       */
      retry = {
        nummer: retryNumber,
        at: jetzt.toISOString(),
        minuten: 0,
        interruptedReconciliation: true
      };
    }
    let result = 'Fehler: Der vorherige Sicherungslauf wurde durch einen Serverabbruch unterbrochen.';
    if (optionsError) result += ' · Konfigurationsfehler: ' + optionsError;
    else if (retry && retry.interruptedReconciliation) {
      result += ' · Der bereits persistierte Offsite-Zustand wird einmalig sofort abgeglichen.';
    } else if (retry) {
      result += ' · Wiederholung ' + retry.nummer + '/' + options.retry.maxRetries + ' in ' + retry.minuten + ' Min.';
    }
    stmt.unterbrochen.run({
      finishedAt: jetzt.toISOString(),
      result,
      nextRetryAt: retry ? retry.at : '',
      retryCount: retry ? retry.nummer : retryNumber,
      id: job.id
    });
  }
}

async function geschuetzteDokumentenarbeit(name, fn, options) {
  const guarded = await applicationWriteBarrier.withWrite(
    name,
    () => operationCoordinator.runExclusive(name, fn, options)
  );
  return guarded;
}

async function laufJobGeschuetzt(job, context) {
  /*
   * Die Vollsicherung errichtet ihre exklusive Barriere selbst. Alle anderen
   * Sicherungsarten melden sich dagegen VOR dem Dokumentkoordinator als
   * Hintergrundschreiber an. So gilt überall dieselbe deadlock-freie Ordnung.
   */
  if (zielArt(job) === 'gesamt') return laufJob(job, context);
  const guarded = await geschuetzteDokumentenarbeit(
    'Dokumentensicherung ' + String((job && job.id) || ''),
    () => laufJob(job, context),
    { priority: context && context.art === 'manual' ? 20 : 5 }
  );
  if (guarded.skipped) {
    return {
      ok: false,
      skipped: true,
      error: 'Der Lauf wurde wegen der lokalen Snapshotphase auf den nächsten Takt verschoben.'
    };
  }
  return guarded.value;
}

async function tick() {
  if (laeuft || syncLaeuft) return;
  laeuft = true;
  try {
    bereite();
    const jetzt = jetztFn();
    for (const j of stmt.jobs.all()) {
      let due = false;
      try { due = faelligkeit(j, jetzt); }
      catch (_configError) {
        // Der Health-Lauf meldet den konkreten Konfigurationsfehler kritisch;
        // andere gültige Zeitpläne laufen unabhängig davon weiter.
        continue;
      }
      if (due) await laufJobGeschuetzt(j, due);
    }
    // Ein fälliger Vollbackup erhält zuerst die hoch priorisierte
    // Dokumentenoperation. Der Scanner darf die lokale Snapshotphase weder
    // überholen noch parallel neue Dateien anlegen.
    try {
      await geschuetzteDokumentenarbeit(
        'Überwachter Scan-Eingang',
        async () => scanEingangTick(),
        { priority: 10, skipIfBusy: true }
      );
    } catch (_e) { /* naechster Takt */ }
    const ts = jetztFn().toISOString();
    stmt.schedulerTickOk.run({ now: ts });
    await aktualisiereWarnungen(jetztFn());
  } finally { laeuft = false; }
}

function jsonObjektKonfiguration(raw, bezeichnung) {
  try {
    const value = JSON.parse(String(raw == null || raw === '' ? '{}' : raw));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('muss ein JSON-Objekt sein');
    }
    return { value, error: '' };
  } catch (error) {
    return {
      value: {},
      error: `Ungültige ${bezeichnung}: ${String(error && error.message || error)}`
    };
  }
}

function quellKonfiguration(job) {
  return jsonObjektKonfiguration(job && job.source_json, 'Quellkonfiguration');
}

function zielKonfiguration(job) {
  const parsed = jsonObjektKonfiguration(job && job.target_json, 'Zielkonfiguration');
  if (parsed.error) return { ...parsed, art: '' };
  const art = String(parsed.value.art || '');
  if (!['gesamt', 'zip', 'mount'].includes(art)) {
    return {
      value: parsed.value,
      art,
      error: `Ungültige Zielkonfiguration: unbekannte Zielart ${art || '(leer)'}`
    };
  }
  return { ...parsed, art };
}

function zielArt(job) {
  return zielKonfiguration(job).art;
}

function offsiteBacklogFuerJob(job) {
  const target = zielKonfiguration(job);
  if (target.error || target.art !== 'gesamt') return null;
  let options;
  try { options = optionenVonJob(job); }
  catch (error) {
    return {
      available: false,
      error: 'Die Offsite-Warteschlange kann wegen ungültiger Sicherungsoptionen nicht geprüft werden: '
        + String(error.message || error)
    };
  }
  if (!options.backupTargetId) {
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
      error: '',
      ...inspectOffsiteBacklog({
        destination: target.value.ordner,
        jobId: String(job.id || ''),
        expectedTargetId: options.backupTargetId,
        offsite: options.offsite
      })
    };
  } catch (error) {
    return {
      available: false,
      error: 'Die Offsite-Warteschlange am Sicherungsziel kann nicht verlässlich gelesen werden: '
        + String(error.message || error)
    };
  }
}

function healthFuerJob(job, jetzt) {
  const sourceConfig = quellKonfiguration(job);
  const targetConfig = zielKonfiguration(job);
  const targetType = targetConfig.art;
  let options = null;
  let optionsError = '';
  try { options = optionenVonJob(job); }
  catch (error) { optionsError = String(error.message || error); }
  const configError = sourceConfig.error || targetConfig.error || optionsError;
  if (configError) {
    const reasonCode = sourceConfig.error
      ? 'invalid_source'
      : targetConfig.error
        ? 'invalid_target'
        : 'invalid_options';
    return {
      id: job.id,
      label: job.label,
      enabled: !!job.enabled,
      targetType,
      status: job.enabled ? 'critical' : 'disabled',
      reasonCode: job.enabled ? reasonCode : 'disabled',
      reason: job.enabled
        ? 'Der Zeitplan wird wegen einer ungültigen Sicherungskonfiguration nicht ausgeführt: ' + configError
        : 'Zeitplan deaktiviert.',
      lastRunAt: job.last_run_at || '',
      lastResult: job.last_result || '',
      lastSuccessAt: job.last_success_at || '',
      lastFailureAt: job.last_failure_at || '',
      configChangedAt: job.config_changed_at || '',
      runStartedAt: job.run_started_at || '',
      nextRetryAt: job.next_retry_at || '',
      retryCount: Number(job.retry_count) || 0,
      overdue: false,
      overdueAt: '',
      configurationWarnings: [],
      options: null,
      optionsError: configError
    };
  }
  const lastSuccessMs = zeitVon(job.last_success_at);
  const lastFailureMs = zeitVon(job.last_failure_at);
  const configChangedMs = zeitVon(job.config_changed_at);
  const runStartedMs = zeitVon(job.run_started_at);
  const nextRetryMs = zeitVon(job.next_retry_at);
  const thresholdMs = options.overdueHours * 3600000;
  const configurationWarnings = [];
  if (job.enabled && targetType === 'gesamt' && !options.retention.enabled) {
    configurationWarnings.push({
      code: 'retention_not_configured',
      message: 'Für die Gesamtsicherung ist noch kein Generationenplan aktiviert.'
    });
  }
  if (job.enabled && targetType === 'gesamt' && !options.localTargetEncryptedAttested) {
    configurationWarnings.push({
      code: 'local_target_encryption_not_attested',
      message: 'Die Verschlüsselung und Zugriffssicherung des lokalen Backupdatenträgers wurde noch nicht administrativ bestätigt.'
    });
  }
  if (job.enabled && targetType === 'gesamt' && !options.offsite.enabled) {
    configurationWarnings.push({
      code: 'offsite_not_configured',
      message: 'Für die Gesamtsicherung ist noch keine verschlüsselte Remote-Zweitkopie aktiviert.'
    });
  }
  if (job.enabled && targetType === 'gesamt' && options.offsite.enabled
      && !options.offsite.immutableAttested) {
    configurationWarnings.push({
      code: 'offsite_immutability_not_attested',
      message: 'Object Lock oder ein append-only Remoteziel wurde noch nicht ausdrücklich administrativ bestätigt.'
    });
  }
  if (job.enabled && targetType === 'gesamt' && options.offsite.enabled
      && !options.offsite.lifecycleAttested) {
    configurationWarnings.push({
      code: 'offsite_lifecycle_not_attested',
      message: 'Eine mit Object Lock verträgliche Remote-Aufbewahrungsregel wurde noch nicht ausdrücklich administrativ bestätigt.'
    });
  }
  let offsiteMaintenance = null;
  if (job.enabled && targetType === 'gesamt' && options.offsite.enabled
      && options.retention.enabled) {
    try {
      offsiteMaintenance = offsiteMaintenanceStatus.inspectReceipt({
        statusDir: offsiteMaintenanceStatus.configuredStatusDir(process.env),
        maxAgeHours: offsiteMaintenanceStatus.configuredMaxAgeHours(process.env),
        repository: options.offsite.repository,
        tag: options.offsite.tag,
        jobId: String(job.id || ''),
        policy: {
          daily: options.retention.daily,
          monthly: options.retention.monthly,
          yearly: options.retention.yearly
        },
        now: jetzt
      });
    } catch (error) {
      offsiteMaintenance = {
        configured: false,
        available: false,
        ok: false,
        status: 'invalid_configuration',
        warningCode: 'offsite_maintenance_invalid_configuration',
        message: 'Die Überwachung der getrennten Offsite-Wartung ist ungültig konfiguriert: '
          + String(error.message || error)
      };
    }
    if (!offsiteMaintenance.ok) {
      configurationWarnings.push({
        code: offsiteMaintenance.warningCode || 'offsite_maintenance_invalid',
        message: offsiteMaintenance.message
      });
    }
  }
  const lastResultText = String(job.last_result || '');
  const heartbeatFailed = /WARNUNG=DEAD_MAN_HEARTBEAT_FEHLER/i.test(lastResultText);
  const offsiteDegraded = /WARNUNG=(?:OFFSITE|OFFSITE_BACKLOG)/i.test(lastResultText);
  if (job.enabled && heartbeatFailed && offsiteDegraded) {
    configurationWarnings.push({
      code: 'offsite_degraded',
      message: 'Die lokale Sicherung ist vollständig, aber die Remote-Zweitkopie benötigt ebenfalls Aufmerksamkeit.'
    });
  }
  let overdueAt = '';
  let overdue = false;
  if (job.enabled && targetType === 'gesamt') {
    // Bei einer Schutz-/Zieländerung zählt der alte Erfolg nicht als Beleg für
    // die neue Konfiguration. Ansonsten beginnt die Erwartung beim letzten
    // Erfolg; für neue Pläne beim Erstellzeitpunkt.
    const basisMs = Math.max(lastSuccessMs, configChangedMs, zeitVon(job.created_at));
    const erwarteterTermin = basisMs ? naechsterPlanTermin(job, new Date(basisMs)) : null;
    if (erwarteterTermin) {
      const grenze = erwarteterTermin.getTime() + thresholdMs;
      overdueAt = new Date(grenze).toISOString();
      overdue = jetzt.getTime() > grenze;
    }
  }

  let status = job.enabled ? 'ok' : 'disabled';
  let reasonCode = job.enabled ? 'ready' : 'disabled';
  let reason = job.enabled ? 'Zeitplan bereit.' : 'Zeitplan deaktiviert.';
  if (job.enabled && runStartedMs) {
    const age = jetzt.getTime() - runStartedMs;
    if (age > options.timeoutMinutes * 60000) {
      status = 'critical';
      reasonCode = 'stale_run';
      reason = 'Der Sicherungslauf überschreitet seine Laufzeitgrenze.';
    } else {
      status = 'running';
      reasonCode = 'running';
      reason = 'Sicherung läuft.';
    }
  } else if (job.enabled && lastFailureMs > lastSuccessMs) {
    if (nextRetryMs) {
      status = 'warning';
      reasonCode = 'retry_pending';
      reason = 'Die letzte Sicherung ist fehlgeschlagen; eine begrenzte Wiederholung ist geplant.';
    } else {
      status = 'critical';
      reasonCode = 'failed';
      reason = 'Die letzte Sicherung ist fehlgeschlagen und es ist keine weitere Wiederholung geplant.';
    }
  } else if (job.enabled && overdue) {
    status = 'critical';
    reasonCode = 'overdue';
    reason = 'Die letzte erfolgreiche Gesamtsicherung ist überfällig.';
  } else if (job.enabled && targetType === 'gesamt' && configChangedMs > lastSuccessMs) {
    status = 'warning';
    reasonCode = 'configuration_unverified';
    reason = 'Die geänderte Sicherungskonfiguration wurde noch nicht durch einen erfolgreichen Lauf bestätigt.';
  } else if (job.enabled && heartbeatFailed) {
    status = 'warning';
    reasonCode = 'heartbeat_failed';
    reason = 'Der geprüfte Sicherungslauf war erfolgreich, aber sein Dead-Man-Erfolgssignal konnte nicht zugestellt werden.';
  } else if (job.enabled && offsiteDegraded) {
    status = 'warning';
    reasonCode = 'offsite_degraded';
    reason = 'Die lokale Sicherung ist vollständig, aber die Remote-Zweitkopie benötigt Aufmerksamkeit.';
  } else if (job.enabled && /WARNUNG=RETENTION_/i.test(lastResultText)) {
    status = 'warning';
    reasonCode = 'retention_blocked';
    reason = 'Mindestens eine alte Sicherung konnte nicht sicher nach dem Generationenplan bereinigt werden.';
  } else if (job.enabled && /WARNUNG=GLEICHES_DATEISYSTEM/i.test(String(job.last_result || ''))) {
    status = 'warning';
    reasonCode = 'same_device';
    reason = 'Datenquelle und lokales Sicherungsziel liegen auf demselben Dateisystem.';
  } else if (job.enabled && /WARNUNG=KAPAZITAET/i.test(String(job.last_result || ''))) {
    // Die Sicherung selbst war vollständig; knapper Zielspeicher ist dennoch
    // ein eigener Warnzustand und darf nicht im langen Ergebnistext verborgen
    // bleiben.
    status = 'warning';
    reasonCode = 'capacity_low';
    reason = 'Das Sicherungsziel unterschreitet die konfigurierte freie Mindestkapazität.';
  } else if (job.enabled && targetType === 'gesamt' && !lastSuccessMs) {
    status = 'warning';
    reasonCode = 'never_succeeded';
    reason = 'Für diesen Zeitplan gibt es noch keine erfolgreiche Gesamtsicherung.';
  }

  return {
    id: job.id,
    label: job.label,
    enabled: !!job.enabled,
    targetType,
    status,
    reasonCode,
    reason,
    lastRunAt: job.last_run_at || '',
    lastResult: job.last_result || '',
    lastSuccessAt: job.last_success_at || '',
    lastFailureAt: job.last_failure_at || '',
    configChangedAt: job.config_changed_at || '',
    runStartedAt: job.run_started_at || '',
    nextRetryAt: job.next_retry_at || '',
    retryCount: Number(job.retry_count) || 0,
    overdue,
    overdueAt,
    configurationWarnings,
    offsiteMaintenance,
    options
  };
}

function health(jetzt) {
  if (!db) db = require('../../database/index');
  bereite();
  const now = jetzt instanceof Date ? jetzt : jetztFn();
  const jobs = stmt.jobs.all().map((job) => {
    const result = healthFuerJob(job, now);
    const backlog = offsiteBacklogFuerJob(job);
    if (!backlog) return result;
    result.offsiteBacklog = backlog;
    if (!job.enabled) return result;
    if (!backlog.available) {
      if (result.status !== 'critical') result.status = 'warning';
      if (result.reasonCode === 'ready') {
        result.reasonCode = 'offsite_backlog_unavailable';
        result.reason = backlog.error;
      }
      return result;
    }
    const stranded = Number(backlog.foreignProfile || 0)
      + Number(backlog.foreignTarget || 0)
      + Number(backlog.invalid || 0);
    if (stranded > 0) {
      result.status = 'critical';
      result.reasonCode = 'offsite_backlog_stranded';
      result.reason = `${stranded} Offsite-Warteschlangen-Eintrag/-Einträge können mit der aktuellen Ziel- oder Profilbindung nicht übertragen werden.`;
    } else if (Number(backlog.otherJob || 0) > 0 && result.status === 'ok') {
      result.status = 'warning';
      result.reasonCode = 'offsite_backlog_other_job';
      result.reason = 'Am Sicherungsziel liegt eine Offsite-Warteschlange eines anderen Zeitplans.';
    } else if (Number(backlog.currentProfile || 0) > 0 && result.status === 'ok') {
      result.status = 'warning';
      result.reasonCode = 'offsite_pending';
      result.reason = 'Mindestens eine vollständige lokale Generation wartet noch auf die verschlüsselte Remote-Zweitkopie.';
    }
    return result;
  });
  const totalJobs = jobs.filter((job) => job.enabled && job.targetType === 'gesamt');
  const scheduler = stmt.scheduler.get() || {};
  let status = 'ok';
  const warnings = [];
  if (!totalJobs.length) {
    status = 'not_configured';
    warnings.push({ code: 'not_configured', message: 'Es ist keine automatische Gesamtsicherung aktiviert.' });
  }
  const invalidConfigReasons = new Set(['invalid_source', 'invalid_target', 'invalid_options']);
  for (const job of jobs.filter((entry) => entry.enabled && invalidConfigReasons.has(entry.reasonCode))) {
    status = 'critical';
    warnings.push({ code: job.reasonCode, jobId: job.id, label: job.label, message: job.reason });
  }
  for (const job of totalJobs) {
    if (job.status === 'critical') status = 'critical';
    else if (job.status === 'warning' && status !== 'critical') status = 'warning';
    if ((job.status === 'critical' || job.status === 'warning')
        && !invalidConfigReasons.has(job.reasonCode)) {
      warnings.push({ code: job.reasonCode, jobId: job.id, label: job.label, message: job.reason });
    }
    for (const warning of job.configurationWarnings) {
      if (status !== 'critical') status = 'warning';
      warnings.push({ ...warning, jobId: job.id, label: job.label });
    }
  }
  if (scheduler.last_tick_error) {
    status = 'critical';
    warnings.push({ code: 'scheduler_error', message: 'Der Sicherungsplaner ist fehlgeschlagen: ' + scheduler.last_tick_error });
  }
  if (scheduler.last_mail_error) {
    if (status === 'ok') status = 'warning';
    warnings.push({
      code: 'notification_error',
      message: 'Die Sicherungswarnung konnte nicht per E-Mail zugestellt werden: ' + scheduler.last_mail_error
    });
  }
  const running = jobs.find((job) => job.status === 'running') || null;
  /*
   * Nur ein wirklich beendeter Scheduler-Tick ist Fortschritt. Der frühere
   * Watchdog schrieb heartbeat_at schon beim bloßen Aufwachen und konnte einen
   * festgefahrenen Warnmail-/Tickpfad dadurch dauerhaft grün halten. Während
   * eines bekannten, noch innerhalb seiner Frist laufenden Backups übernimmt
   * dessen run_started_at die Fortschrittsanzeige.
   */
  const progressMs = zeitVon(scheduler.last_tick_at) || zeitVon(scheduler.heartbeat_at);
  if (started && timer && !running && progressMs && now.getTime() - progressMs > 3 * 60000) {
    status = 'critical';
    warnings.push({ code: 'scheduler_stale', message: 'Der Sicherungsplaner hat seit mehr als drei Minuten keinen Tick vollständig beendet.' });
  }
  const lastSuccessfulTotalBackupAt = totalJobs
    .map((job) => job.lastSuccessAt)
    .filter(Boolean)
    .sort()
    .pop() || '';
  return {
    status,
    checkedAt: now.toISOString(),
    lastSuccessfulTotalBackupAt,
    overdue: totalJobs.some((job) => job.overdue),
    running: running ? {
      jobId: running.id,
      label: running.label,
      startedAt: running.runStartedAt
    } : null,
    jobs,
    warnings,
    scheduler: {
      startedAt: scheduler.started_at || '',
      heartbeatAt: scheduler.heartbeat_at || '',
      lastTickAt: scheduler.last_tick_at || '',
      lastTickError: scheduler.last_tick_error || '',
      lastTickErrorAt: scheduler.last_tick_error_at || '',
      lastMailAt: scheduler.last_mail_at || '',
      lastMailError: scheduler.last_mail_error || ''
    }
  };
}

async function standardWarnMail(statusInfo, recovered) {
  const mail = require('../mail/service');
  const cfg = mail.getSmtpConfig();
  if (!mail.isConfigured(cfg) || !String(cfg && cfg.admin_recipient || '').trim()) {
    throw new Error('Systemmail/Administrator-Empfänger ist nicht konfiguriert.');
  }
  const zeilen = statusInfo.warnings.map((warning) =>
    '- ' + (warning.label ? warning.label + ': ' : '') + warning.message
  );
  if (!zeilen.length) zeilen.push('- Alle aktivierten Gesamtsicherungen sind wieder im Soll.');
  await mail.sendDocumentMail({
    to: cfg.admin_recipient,
    subject: recovered
      ? 'Betreuungsbüro: Gesamtsicherung wieder in Ordnung'
      : 'Betreuungsbüro: Warnung zur automatischen Gesamtsicherung',
    body:
      (recovered
        ? 'Der Sicherungsstatus hat sich erholt.'
        : 'Die automatische Gesamtsicherung benötigt Aufmerksamkeit.') +
      '\n\nStatus: ' + statusInfo.status +
      '\nZeitpunkt: ' + statusInfo.checkedAt +
      '\n\n' + zeilen.join('\n') +
      '\n\nDetails finden Sie im Admin-Bereich des Datei-Explorers.'
  }, cfg);
}

async function aktualisiereWarnungen(jetzt) {
  const now = jetzt instanceof Date ? jetzt : jetztFn();
  const info = health(now);
  const totalRows = stmt.jobs.all().filter((job) => job.enabled && zielArt(job) === 'gesamt');
  for (const row of totalRows) {
    const job = info.jobs.find((entry) => entry.id === row.id);
    if (!job) continue;
    const key = job.status + ':' + job.reasonCode;
    if (key !== String(row.last_warning_key || '')) {
      stmt.jobWarnung.run({ warningKey: key, warningAt: now.toISOString(), id: row.id });
    }
  }

  const state = stmt.scheduler.get() || {};
  const healthKey = info.status + '|' + info.warnings
    .map((warning) => String(warning.jobId || '') + ':' + warning.code)
    .sort()
    .join(',');
  const changed = healthKey !== String(state.health_key || '');
  const unhealthy = info.status !== 'ok';
  const recovered = !unhealthy && state.health_key && state.health_status !== 'ok';
  const alertOptions = totalRows.map((row) => {
    try { return optionenVonJob(row).alert; }
    catch (_error) {
      // Bei einer defekten Konfiguration bleibt der Warnkanal fail-safe aktiv.
      return DEFAULT_BACKUP_OPTIONS.alert;
    }
  });
  const repeatHours = Math.min(...alertOptions.map((alert) => alert.repeatHours), 24);
  const lastWarningMs = zeitVon(state.last_warning_at);
  const repeatDue = unhealthy && (!lastWarningMs || now.getTime() - lastWarningMs >= repeatHours * 3600000);
  const shouldNotify = changed || repeatDue;
  stmt.schedulerHealth.run({
    status: info.status,
    healthKey,
    changedAt: changed ? now.toISOString() : String(state.last_health_change_at || ''),
    warningAt: shouldNotify ? now.toISOString() : String(state.last_warning_at || '')
  });
  if (!shouldNotify) return info;

  try {
    require('../office/events').emit('backup-health', {
      status: info.status,
      reason: info.warnings[0] ? info.warnings[0].code : 'recovered',
      jobId: info.warnings[0] ? String(info.warnings[0].jobId || '') : ''
    });
  } catch (_e) { /* Warnstatus bleibt auch ohne Echtzeitkanal in der DB */ }

  const emailEnabled = totalRows.length
    ? alertOptions.some((alert) => alert.email)
    : DEFAULT_BACKUP_OPTIONS.alert.email;
  if (!emailEnabled || (!unhealthy && !recovered)) return info;
  let mailError = '';
  let mailAt = '';
  try {
    await zeitgrenze(
      Promise.resolve().then(() => (mailSender || standardWarnMail)(info, recovered)),
      warnMailTimeoutMs,
      'Die Warnmail hat ihre Zeitgrenze überschritten.'
    );
    mailAt = now.toISOString();
  } catch (error) {
    // Ein Warnmail-Fehler ist ein eigener Diagnosewert und darf den echten
    // Sicherungsstatus weder ersetzen noch einen Backup-Lauf fehlschlagen lassen.
    mailError = String(error && (error.message || error) || 'Warnmail fehlgeschlagen').slice(0, 1000);
  }
  stmt.schedulerMail.run({ mailAt, mailError });
  for (const row of totalRows) stmt.jobMail.run({ mailAt, mailError, id: row.id });
  return info;
}

async function tickSicher() {
  try {
    await tick();
  } catch (error) {
    if (!db) return;
    try {
      bereite();
      const now = jetztFn().toISOString();
      stmt.schedulerTickFehler.run({
        now,
        error: String(error && (error.message || error) || 'Unbekannter Schedulerfehler').slice(0, 2000)
      });
      await aktualisiereWarnungen(jetztFn());
    } catch (_secondary) { /* nächster Takt; Primärfehler bleibt nach Möglichkeit gespeichert */ }
  }
}

async function healthWatchdog() {
  if (healthLaeuft) return { skipped: true, reason: 'health_busy' };
  healthLaeuft = true;
  try {
    const guarded = await applicationWriteBarrier.withWrite(
      'Sicherungs-Health-Watchdog',
      () => aktualisiereWarnungen(jetztFn())
    );
    if (guarded.skipped) return guarded;
    return { skipped: false, value: guarded.value };
  } catch (error) {
    /*
     * Der Primärfehler wird in einem eigenen kurzen Write festgehalten. Ist
     * gerade die Snapshotbarriere aktiv, bleibt die DB absichtlich unberührt;
     * der nächste Watchdog-Takt versucht es erneut.
     */
    await applicationWriteBarrier.withWrite('Sicherungs-Health-Fehlerstatus', () => {
      const ts = jetztFn().toISOString();
      stmt.schedulerTickFehler.run({
        now: ts,
        error: ('Health-Watchdog: ' + (error.message || error)).slice(0, 2000)
      });
    });
    return { skipped: false, error: String(error.message || error) };
  } finally {
    healthLaeuft = false;
  }
}

/* Scan-Eingang (D11): ueberwachter Ordner im Minutentakt (Poll statt fs.watch - robust auch
   auf Netz-/Cloud-Volumes). Importierte Dateien wandern in den Unterordner _importiert,
   NIE geloescht. Dateien juenger als 10 s bleiben liegen (Scanner schreibt evtl. noch). */
const SCAN_MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', txt: 'text/plain' };
function scanEingangTick() {
  const cfg = intern.readCfg ? intern.readCfg() : null;
  const se = cfg && cfg.scanEingang;
  if (!se || !se.an || !se.ordner) return;
  const ordner = path.resolve(String(se.ordner));
  if (!fs.existsSync(ordner) || !fs.statSync(ordner).isDirectory()) { intern.scanStatusSetzen && intern.scanStatusSetzen('Fehler: Ordner nicht gefunden: ' + ordner); return; }
  const fertigDir = path.join(ordner, '_importiert');
  let importiert = 0;
  for (const name of fs.readdirSync(ordner)) {
    if (name.startsWith('.') || name.startsWith('_')) continue;
    const p = path.join(ordner, name);
    let st;
    try { st = fs.statSync(p); } catch (_e) { continue; }
    if (!st.isFile() || st.size === 0) continue;
    if (Date.now() - st.mtimeMs < 10000) continue;              /* wird evtl. noch geschrieben */
    if (st.size > MAX_DATEI()) continue;                        /* dieselbe Grenze wie jeder Upload (intern.MAX_FILE) */
    const endung = (name.split('.').pop() || '').toLowerCase();
    const mime = SCAN_MIME[endung] || 'application/octet-stream';
    let bytes;
    try { bytes = fs.readFileSync(p); } catch (_e) { continue; }
    try {
      if (se.ziel && se.ziel.art === 'case') {
        const scanTag = lokalTag(new Date(st.mtimeMs));
        const scanName = /^\d{6}(?:\s|$)/.test(name)
          ? name
          : scanTag.slice(2, 4) + scanTag.slice(5, 7) + scanTag.slice(8, 10) + ' ' + name;
        intern.dateiAblegen('case', se.ziel.caseId, se.ziel.folderId || '', scanName, mime, bytes);
      } else {
        const id = require('crypto').randomUUID();
        const heute = new Date();
        const datum = heute.getFullYear() + '-' + String(heute.getMonth() + 1).padStart(2, '0') + '-' + String(heute.getDate()).padStart(2, '0');
        const klarname = datum.slice(2, 4) + datum.slice(5, 7) + datum.slice(8, 10) + ' ' + name;
        const folderId = intern.ordnerSicherstellen('office', '', ['Posteingang', datum.slice(0, 4), datum.slice(5, 7)]);
        const file = intern.dateiAblegen('office', '', folderId, klarname, mime, bytes);
        try {
          db.transaction(() => {
            db.prepare('INSERT INTO inbox_documents (id, file_name, mime_type, size, inbox_date) VALUES (?, ?, ?, ?, ?)')
              .run(id, file.name, mime, bytes.length, datum);
            db.prepare("INSERT INTO doc_links (module, owner_id, slot, file_id, detail_json) VALUES ('inbox', ?, '', ?, ?)")
              .run(id, file.id, JSON.stringify({ scanEingang: true, inboxDate: datum }));
            db.prepare("INSERT OR IGNORE INTO doc_module_import (quelle, quell_id, file_id) VALUES ('posteingang', ?, ?)")
              .run(id, file.id);
          })();
        } catch (error) {
          const row = intern.dateiZeile && intern.dateiZeile(file.id);
          if (row && intern.dateiPapierkorb) {
            try { intern.dateiPapierkorb(row, null); } catch (_ignore) { /* Abgleich meldet den Rest */ }
          }
          throw error;
        }
        try { require('../office/events').emit('inbox', { method: 'SCAN', path: '/inbox' }); } catch (_e) { /* Anzeige */ }
      }
      fs.mkdirSync(fertigDir, { recursive: true });
      let zielName = name; let z = 2;
      while (fs.existsSync(path.join(fertigDir, zielName))) zielName = name.replace(/(\.[^.]*)?$/, ' (' + (z++) + ')$1');
      fs.renameSync(p, path.join(fertigDir, zielName));
      importiert++;
    } catch (e) {
      intern.scanStatusSetzen && intern.scanStatusSetzen('Fehler bei „' + name + '": ' + (e.message || e));
      return;
    }
  }
  if (importiert) {
    const jetzt = new Date();
    intern.scanStatusSetzen && intern.scanStatusSetzen('ok: ' + importiert + ' Datei(en) importiert am ' + jetzt.toLocaleDateString('de-DE') + ' ' + jetzt.toLocaleTimeString('de-DE').slice(0, 5));
  }
}

function dokuDatum(raw) {
  const value = String(raw || '').trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return { year: match[1], month: match[2], day: match[3] };
  match = /^(\d{2})[./](\d{2})[./](\d{4})/.exec(value);
  if (match) return { year: match[3], month: match[2], day: match[1] };
  return null;
}
/* Falldoku-Zielordner je DOKU-EINTRAG: Jahr -> Monat -> Eintrag. Das fachliche
   Ereignisdatum hat Vorrang vor dem Upload-/Anlagezeitpunkt; beide im Bestand vorkommenden
   Formate (TT.MM.JJJJ und JJJJ-MM-TT) werden normalisiert. Einen "ohne Datum"-Ordner gibt
   es nicht: falls das Ereignisdatum fehlt, wird der bestmoegliche Anlagezeitpunkt verwendet. */
function dokuTeile(data, row) {
  const entry = Object.assign({}, data || {}, {
    createdAt: (data && (data.createdAt || data.created_at)) || (row && row.created_at) || ''
  });
  return documentTaxonomy.dokuPfad(entry, (row && row.created_at) || '');
}
async function syncTick() {
  if (syncLaeuft || laeuft) return;
  syncLaeuft = true;
  try {
    await geschuetzteDokumentenarbeit('Laufender Dokumentabgleich', async () => {
      bereite();
      for (const j of stmt.jobs.all()) {
        if (!j.enabled || j.interval !== 'laufend') continue;
        await laufJob(j, { art: 'continuous', scheduledAt: jetztFn().toISOString(), retryNumber: 0 });
      }
    }, { priority: 5 });
  } finally { syncLaeuft = false; }
}

function starteJetzt(id) {
  bereite();
  const j = stmt.job.get(String(id));
  if (!j) return { started: false, reason: 'Zeitplan nicht gefunden.' };
  if (!j.enabled) {
    return { started: false, reason: 'Der Sicherungs-Zeitplan ist pausiert.' };
  }
  if (String(j.run_started_at || '')) {
    return { started: false, reason: 'Dieser Sicherungs-Zeitplan ist bereits aktiv, reserviert oder wird ausgeführt.' };
  }
  if (laeuft || syncLaeuft) {
    return { started: false, reason: 'Ein anderer Sicherungslauf ist gerade aktiv.' };
  }
  if (zielArt(j) === 'mount' && auslaufendeMountOperationen.size) {
    return {
      started: false,
      reason: 'Eine abgebrochene Anbieteroperation läuft noch aus; der Mount-Lauf startet danach erneut.'
    };
  }
  laeuft = true;
  const completion = applicationWriteBarrier.runDetached(async () => {
    try {
      return await laufJobGeschuetzt(j, {
        art: 'manual',
        scheduledAt: jetztFn().toISOString(),
        retryNumber: 0
      });
    } finally {
      laeuft = false;
    }
  });
  return { started: true, completion };
}

async function laufJetzt(id) {
  const accepted = starteJetzt(id);
  if (!accepted.started) return accepted;
  const result = await accepted.completion;
  return { started: true, ...result };
}

/* ---------- Import-Eingang (D29): Anbieter -> Serverspeicher ---------- */
// Gegenrichtung der Sicherung, minuetlicher Takt. Additiv: am Anbieter wird NIE geschrieben
// oder geloescht, im Speicher wird NIE ueberschrieben (geaenderte Quelle = neue Kopie, der
// Namens-Deduper haengt " (2)" an). Aenderungsgedaechtnis doc_import_state: Groesse|Tag als
// Schnellmerkmal (die Anbieter-Listen liefern nur den Aenderungstag - eine groessengleiche
// Aenderung am selben Tag faellt erst mit der naechsten auf), sha256 als Wahrheit: gleiche
// Pruefsumme unter neuem Pfad gilt als verschoben/umbenannt und wird nicht erneut abgelegt.
// SCHLEIFENSCHUTZ zur Laufzeit (zusaetzlich zur Routen-Pruefung, die Konfig kann sich ja
// aendern): ueberschneidet sich der Quellordner mit dem Ziel eines Sicherungs-/Sync-Auftrags
// auf dieselbe Verbindung, wird der Lauf uebersprungen - sonst importiert der Import die
// eigene Sicherung zurueck (Ping-Pong-Kopien).
const IMP_LISTE_MAX = 500, IMP_DATEI_BUDGET = 25, IMP_TIEFE = 6;
/* 2026-07-27: EINE Obergrenze fuer den ganzen Dokumentenspeicher. Bis hierher fuehrte
   doc-backup.js zwei eigene 100-MB-Zahlen (Scan-Eingang + Import/Paarung), die getrennt
   gepflegt werden mussten. Jetzt kommt die Zahl aus routes/documents.js. Als Funktion, weil
   `intern` erst in start() gesetzt wird. ACHTUNG: hier wird die vom ANBIETER gemeldete
   Groesse geprueft - fehlt sie (0/undefined), greift die Pruefung nicht; die harte Sperre
   sitzt seit heute in intern.dateiAblegen, das jetzt wirft statt alles durchzulassen. */
function MAX_DATEI() { return Number(intern && intern.MAX_FILE) || (1024 * 1024 * 1024); }
function IMP_MAX_BYTES() { return MAX_DATEI(); }
/* v176: Der Statustext nannte fest "100 MB", waehrend die Grenze real bei 1024 MB steht.
   Zwei Wahrheitsorte fuer dieselbe Zahl - ab hier nur noch einer. */
function MAX_TEXT() { return Math.round(MAX_DATEI() / (1024 * 1024)) + ' MB'; }
function impPfadIn(a, b) { return !b || a === b || a.startsWith(b + '/'); }
function impSyncKollision(mountId, quellPfad) {
  for (const r of stmt.jobs.all()) {
    if (!r.enabled) continue;
    let ziel = {};
    try { ziel = JSON.parse(r.target_json || '{}'); } catch (_e) { continue; }
    if (ziel.art !== 'mount' || String(ziel.mountId) !== String(mountId)) continue;
    const zp = String(ziel.unterordner || '').split('/').map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..').join('/');
    if (impPfadIn(quellPfad, zp) || impPfadIn(zp, quellPfad)) return r.label || 'Sicherung';
  }
  return '';
}
async function impLauf(job) {
  const crypto2 = require('crypto');
  let ziel = {};
  try { ziel = JSON.parse(job.target_json || '{}'); } catch (_e) { ziel = {}; }
  const area = ziel.area === 'office' ? 'office' : 'case';
  const caseId = area === 'case' ? String(ziel.caseId || '') : '';
  const quellSeg = String(job.source_path || '').split('/').map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..');
  const kollision = impSyncKollision(job.mount_id, quellSeg.join('/')) || impPairKollision(job.mount_id, quellSeg.join('/'));
  if (kollision) {
    stmt.impErgebnis.run(job.last_run_at || '', 'ÜBERSPRUNGEN: Der Quellordner überschneidet sich mit „' + kollision + '“ - Schleifenschutz.', job.id);
    return;
  }
  let neu = 0, geaendert = 0, unveraendert = 0, zuGross = 0;
  const fehler = [];
  let gelistet = 0, budget = IMP_DATEI_BUDGET, voll = false;
  const ordnerCache = {};
  function unterOrdner(relSeg) {
    /* Quell-Unterordner unter dem Zielordner nachbilden (nicht ab Wurzel - deshalb nicht
       intern.ordnerSicherstellen, das kennt keinen Start-Ordner). */
    let parentId = String(ziel.folderId || '');
    let key = '';
    for (const roh of relSeg) {
      const teil = intern.cleanName(roh);
      if (!teil) continue;
      key += '/' + teil.toLowerCase();
      if (ordnerCache[key]) { parentId = ordnerCache[key]; continue; }
      const tr = stmt.impFolderKinder.all(area, caseId, parentId).find((f) => f.name.toLowerCase() === teil.toLowerCase());
      if (tr) { ordnerCache[key] = tr.id; parentId = tr.id; continue; }
      const id = crypto2.randomUUID();
      stmt.impFolderIns.run(id, area, caseId, parentId, teil);
      ordnerCache[key] = id; parentId = id;
    }
    return parentId;
  }
  async function gehe(seg, relSeg, tiefe) {
    if (voll || tiefe > IMP_TIEFE) return;
    let liste;
    try { liste = await intern.mountListe(job.mount_id, seg); }
    catch (e) { fehler.push((relSeg.join('/') || '(Quellordner)') + ': ' + (e.message || e)); return; }
    for (const f of (liste.files || [])) {
      if (voll) return;
      if (++gelistet > IMP_LISTE_MAX) { voll = true; return; }
      const pfadKey = relSeg.concat(f.name).join('/');
      const merkmal = String(f.size || 0) + '|' + String(f.date || '');
      const st = stmt.impStateGet.get(job.id, pfadKey);
      if (st && st.merkmal === merkmal) { unveraendert++; continue; }
      if (Number(f.size) > IMP_MAX_BYTES()) { zuGross++; continue; }
      if (budget <= 0) { voll = true; return; }
      budget--;
      try {
        const inhalt = await intern.mountLese(job.mount_id, seg.concat(f.name));
        const sha = crypto2.createHash('sha256').update(inhalt.bytes).digest('hex');
        if (st && st.sha256 === sha) { stmt.impStateSetz.run(job.id, pfadKey, merkmal, sha, st.file_id || ''); unveraendert++; continue; }
        const dublette = st ? null : stmt.impStateSha.get(job.id, sha);
        if (dublette) { stmt.impStateSetz.run(job.id, pfadKey, merkmal, sha, dublette.file_id || ''); unveraendert++; continue; }
        const folderId = relSeg.length ? unterOrdner(relSeg) : String(ziel.folderId || '');
        const abgelegt = intern.dateiAblegen(area, caseId, folderId, f.name, f.mime || inhalt.mime || 'application/octet-stream', inhalt.bytes);
        stmt.impStateSetz.run(job.id, pfadKey, merkmal, sha, abgelegt.id);
        if (st) geaendert++; else neu++;
      } catch (e) { fehler.push(pfadKey + ': ' + (e.message || e)); }
    }
    for (const o of (liste.folders || [])) {
      if (voll) return;
      if (++gelistet > IMP_LISTE_MAX) { voll = true; return; }
      await gehe(seg.concat(o.name), relSeg.concat(o.name), tiefe + 1);
    }
  }
  await gehe(quellSeg, [], 0);
  let text = neu + ' neu, ' + geaendert + ' aktualisiert, ' + unveraendert + ' unverändert';
  if (zuGross) text += ', ' + zuGross + ' über ' + MAX_TEXT() + ' übersprungen';
  if (voll) text += ' - weitere folgen im nächsten Lauf';
  if (fehler.length) text += ' | FEHLER: ' + fehler.slice(0, 3).join(' · ') + (fehler.length > 3 ? ' …' : '');
  stmt.impErgebnis.run(new Date().toISOString(), text, job.id);
}
async function importTick() {
  if (impLaeuft) return;
  impLaeuft = true;
  try {
    await geschuetzteDokumentenarbeit('Dokumentenimport', async () => {
      bereite();
      if (auslaufendeMountOperationen.size) return;
      for (const j of stmt.impJobs.all()) {
        if (!j.enabled) continue;
        await impLauf(j);
      }
    }, { priority: 10 });
  } finally { impLaeuft = false; }
}
async function importJetzt(id) {
  bereite();
  const j = stmt.impJob.get(String(id));
  if (!j) return;
  if (auslaufendeMountOperationen.size) return;
  if (impLaeuft) {
    stmt.impErgebnis.run(j.last_run_at || '', 'Ein Import-Lauf ist gerade aktiv - bitte gleich erneut anstoßen.', j.id);
    return;
  }
  impLaeuft = true;
  try {
    await geschuetzteDokumentenarbeit(
      'Dokumentenimport ' + String(j.id),
      async () => impLauf(j),
      { priority: 20 }
    );
  } finally { impLaeuft = false; }
}

/* ---------- Zwei-Wege-Fallordner-Paarung (D30) ---------- */
// Ein Anbieter-Ordner und ein Speicher-Ast werden in BEIDE Richtungen abgeglichen. Das
// Herkunfts-Gedaechtnis (doc_pair_state) traegt je Pfad den sha256 des letzten Abgleichs -
// damit ist eindeutig, WER sich geaendert hat, und nichts pendelt (kein Ping-Pong):
//   nur remote neu/geaendert  -> herholen bzw. lokale Datei ERSETZEN (alte Fassung in den
//                                Versionsverlauf, Mechanik der Ersetzen-Route)
//   nur lokal neu/geaendert   -> zum Anbieter hochschieben (PUT ueberschreibt dort)
//   beide geaendert           -> Anbieter-Fassung als Konfliktkopie '(Konflikt Anbieter …)'
//                                ablegen, die lokale Fassung gilt und geht hoch
//   geloescht (egal wo)       -> wirkt NIE auf die Gegenseite (nur Zaehler im Ergebnis);
//                                aendert sich die Gegenseite spaeter, kommt sie regulaer neu
// Umbenennen/Verschieben wird NICHT verfolgt (bewusste V1-Grenze): es entsteht ein Duplikat,
// nie ein Verlust. Der Ast 'Modulordner' (D17, abgeleitete Kopien mit Pfad-Wanderung) wird
// nicht gespiegelt. Nach Uploads werden die Anbieter-Merkmale nachgetragen (ein Listing je
// betroffenem Ordner), sonst muesste der naechste Lauf jede hochgeladene Datei einmal laden.
// Aenderungs-Schnellmerkmal remote ist Groesse|Tag (Anbieter-Listen liefern nur den Tag);
// lokal traegt doc_files.sha256 die Wahrheit (dateiAblegen und dateiErsetzen pflegen sie).
function segVon(p) { return String(p || '').split('/').map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..'); }
function impImportKollision(mountId, pfad) {
  for (const r of stmt.impJobs.all()) {
    if (!r.enabled || String(r.mount_id) !== String(mountId)) continue;
    const qp = segVon(r.source_path).join('/');
    if (impPfadIn(qp, pfad) || impPfadIn(pfad, qp)) return r.label || 'Import-Eingang';
  }
  return '';
}
function impPairKollision(mountId, pfad) {
  for (const r of stmt.prJobs.all()) {
    if (!r.enabled || String(r.mount_id) !== String(mountId)) continue;
    const qp = segVon(r.source_path).join('/');
    if (impPfadIn(qp, pfad) || impPfadIn(pfad, qp)) return r.label || 'Paarung';
  }
  return '';
}
async function pairLauf(job) {
  const crypto2 = require('crypto');
  const sha = (b) => crypto2.createHash('sha256').update(b).digest('hex');
  let ziel = {};
  try { ziel = JSON.parse(job.target_json || '{}'); } catch (_e) { ziel = {}; }
  const area = ziel.area === 'office' ? 'office' : 'case';
  const caseId = area === 'case' ? String(ziel.caseId || '') : '';
  const wurzelId = String(ziel.folderId || '');
  const quellSeg = segVon(job.source_path);
  const koll = impSyncKollision(job.mount_id, quellSeg.join('/')) || impImportKollision(job.mount_id, quellSeg.join('/'));
  if (koll) {
    stmt.prErgebnis.run(job.last_run_at || '', 'ÜBERSPRUNGEN: Überschneidung mit „' + koll + '“ - Schleifenschutz.', job.id);
    return;
  }
  /* Anbieter-Bestand einsammeln (nur Listen, noch nichts laden) */
  const remote = new Map();
  const fehler = [];
  let gelistet = 0, voll = false;
  async function sammle(seg, relSeg, tiefe) {
    if (voll || tiefe > IMP_TIEFE) return;
    let liste;
    try { liste = await intern.mountListe(job.mount_id, seg); }
    catch (e) { fehler.push((relSeg.join('/') || '(Anbieter-Ordner)') + ': ' + (e.message || e)); return; }
    for (const f of (liste.files || [])) {
      if (++gelistet > IMP_LISTE_MAX) { voll = true; return; }
      remote.set(relSeg.concat(f.name).join('/'), { name: f.name, size: Number(f.size) || 0, mime: f.mime || '', seg: seg.concat(f.name), merkmal: String(f.size || 0) + '|' + String(f.date || '') });
    }
    for (const o of (liste.folders || [])) {
      if (++gelistet > IMP_LISTE_MAX) { voll = true; return; }
      await sammle(seg.concat(o.name), relSeg.concat(o.name), tiefe + 1);
    }
  }
  await sammle(quellSeg, [], 0);
  /* Speicher-Bestand unter dem Zielordner einsammeln */
  const ordnerAll = stmt.ordner.all().filter((o) => o.area === area && String(o.case_id || '') === caseId);
  const byId = new Map(ordnerAll.map((o) => [String(o.id), o]));
  const kettenCache = new Map();
  function relKette(fid) {
    fid = String(fid || '');
    if (fid === wurzelId) return [];
    if (!fid) return wurzelId ? null : [];
    if (kettenCache.has(fid)) return kettenCache.get(fid);
    kettenCache.set(fid, null);   /* Zyklus-Schutz */
    const o = byId.get(fid);
    let erg = null;
    if (o) { const eltern = relKette(String(o.parent_id || '')); if (eltern) erg = eltern.concat(String(o.name || '')); }
    kettenCache.set(fid, erg);
    return erg;
  }
  const lokal = new Map();
  for (const f of stmt.dateien.all()) {
    if (f.area !== area || String(f.case_id || '') !== caseId) continue;
    const kette = relKette(String(f.folder_id || ''));
    if (!kette) continue;
    if (kette.length && kette[0] === 'Modulordner') continue;
    lokal.set(kette.concat(String(f.name || '')).join('/'), f);
  }
  const states = new Map(stmt.prStateAll.all(job.id).map((s) => [s.pfad, s]));
  /* Zielseitige Helfer */
  const ordnerCache = {};
  function unterOrdner(relSeg) {
    let parentId = wurzelId;
    let key = '';
    for (const roh of relSeg) {
      const teil = intern.cleanName(roh);
      if (!teil) continue;
      key += '/' + teil.toLowerCase();
      if (ordnerCache[key]) { parentId = ordnerCache[key]; continue; }
      const tr = stmt.impFolderKinder.all(area, caseId, parentId).find((f) => f.name.toLowerCase() === teil.toLowerCase());
      if (tr) { ordnerCache[key] = tr.id; parentId = tr.id; continue; }
      const id = crypto2.randomUUID();
      stmt.impFolderIns.run(id, area, caseId, parentId, teil);
      ordnerCache[key] = id; parentId = id;
    }
    return parentId;
  }
  const ordnerFertig = new Set();
  async function remoteOrdnerSicher(relSeg) {
    for (let i = 1; i <= relSeg.length; i++) {
      const key = relSeg.slice(0, i).join('/');
      if (ordnerFertig.has(key)) continue;
      await intern.mountOrdner(job.mount_id, quellSeg.concat(relSeg.slice(0, i)));
      ordnerFertig.add(key);
    }
  }
  let hergeholt = 0, hochgeladen = 0, ersetzt = 0, konflikte = 0, unveraendert = 0, entferntAnbieter = 0, entferntLokal = 0, zuGross = 0;
  let budget = IMP_DATEI_BUDGET;
  const uploads = [];
  async function herholen(pfad, r) {
    const inhalt = await intern.mountLese(job.mount_id, r.seg);
    const rsha = sha(inhalt.bytes);
    const relSeg = pfad.split('/'); relSeg.pop();
    const folderId = relSeg.length ? unterOrdner(relSeg) : wurzelId;
    const ab = intern.dateiAblegen(area, caseId, folderId, r.name, r.mime || inhalt.mime || 'application/octet-stream', inhalt.bytes);
    stmt.prStateSetz.run(job.id, pfad, r.merkmal, rsha, ab.id);
  }
  async function hochschieben(pfad, row) {
    const p = intern.findBlobPath(row);
    if (!p) { fehler.push(pfad + ': Ablage-Datei fehlt auf der Platte'); return false; }
    const bytes = fs.readFileSync(p);
    const relSeg = pfad.split('/');
    const name = relSeg.pop();
    await remoteOrdnerSicher(relSeg);
    await intern.mountSchreib(job.mount_id, quellSeg.concat(relSeg), name, bytes);
    const hsha = String(row.sha256 || '') || sha(bytes);
    stmt.prStateSetz.run(job.id, pfad, '', hsha, String(row.id));
    uploads.push({ relSeg, name, pfad, sha: hsha, fileId: String(row.id) });
    return true;
  }
  function konfliktKopie(pfad, r, inhalt) {
    const relSeg = pfad.split('/'); relSeg.pop();
    const folderId = relSeg.length ? unterOrdner(relSeg) : wurzelId;
    const heute = new Date().toISOString().slice(0, 10);
    const kname = String(r.name).replace(/(\.[^.\/]*)?$/, (m, ext) => ' (Konflikt Anbieter ' + heute + ')' + (ext || ''));
    intern.dateiAblegen(area, caseId, folderId, kname, r.mime || inhalt.mime || 'application/octet-stream', inhalt.bytes);
  }
  const pfade = new Set([...remote.keys(), ...lokal.keys(), ...states.keys()]);
  for (const pfad of pfade) {
    if (voll) break;
    const r = remote.get(pfad), row = lokal.get(pfad), s = states.get(pfad);
    try {
      if (r && r.size > IMP_MAX_BYTES()) { zuGross++; continue; }
      if (!s) {
        if (r && !row) { if (budget-- <= 0) { voll = true; break; } await herholen(pfad, r); hergeholt++; }
        else if (row && !r) { if (budget-- <= 0) { voll = true; break; } if (await hochschieben(pfad, row)) hochgeladen++; }
        else if (r && row) {
          /* Erstlauf: beide Seiten belegt, kein Gedaechtnis */
          if (budget-- <= 0) { voll = true; break; }
          const inhalt = await intern.mountLese(job.mount_id, r.seg);
          const rsha = sha(inhalt.bytes);
          if (rsha === String(row.sha256 || '')) { stmt.prStateSetz.run(job.id, pfad, r.merkmal, rsha, String(row.id)); unveraendert++; }
          else { konfliktKopie(pfad, r, inhalt); konflikte++; if (await hochschieben(pfad, row)) hochgeladen++; }
        }
        continue;
      }
      const rGeaendert = r ? (r.merkmal !== String(s.remote_merkmal || '')) : false;
      const lGeaendert = row ? (String(row.sha256 || '') !== String(s.sha256 || '')) : false;
      if (!r && !row) { stmt.prStateDel.run(job.id, pfad); continue; }
      if (!r) {
        if (lGeaendert) { if (budget-- <= 0) { voll = true; break; } if (await hochschieben(pfad, row)) hochgeladen++; }
        else entferntAnbieter++;
        continue;
      }
      if (!row) {
        if (rGeaendert) { if (budget-- <= 0) { voll = true; break; } await herholen(pfad, r); hergeholt++; }
        else entferntLokal++;
        continue;
      }
      if (!rGeaendert && !lGeaendert) { unveraendert++; continue; }
      if (budget-- <= 0) { voll = true; break; }
      if (rGeaendert && !lGeaendert) {
        const inhalt = await intern.mountLese(job.mount_id, r.seg);
        const rsha = sha(inhalt.bytes);
        if (rsha === String(s.sha256 || '')) { stmt.prStateSetz.run(job.id, pfad, r.merkmal, rsha, String(row.id)); unveraendert++; }
        else { intern.dateiErsetzen(row, r.mime || inhalt.mime, inhalt.bytes); stmt.prStateSetz.run(job.id, pfad, r.merkmal, rsha, String(row.id)); ersetzt++; }
        continue;
      }
      if (!rGeaendert && lGeaendert) { if (await hochschieben(pfad, row)) hochgeladen++; continue; }
      /* beide geaendert */
      const inhalt = await intern.mountLese(job.mount_id, r.seg);
      const rsha = sha(inhalt.bytes);
      if (rsha === String(row.sha256 || '')) { stmt.prStateSetz.run(job.id, pfad, r.merkmal, rsha, String(row.id)); unveraendert++; continue; }
      if (rsha === String(s.sha256 || '')) { if (await hochschieben(pfad, row)) hochgeladen++; continue; }
      konfliktKopie(pfad, r, inhalt);
      konflikte++;
      if (await hochschieben(pfad, row)) hochgeladen++;
    } catch (e) { fehler.push(pfad + ': ' + (e.message || e)); }
  }
  /* Anbieter-Merkmale der Uploads nachtragen (ein Listing je betroffenem Ordner) */
  const upOrdner = new Set(uploads.map((u) => u.relSeg.join('/')));
  for (const ok2 of upOrdner) {
    const seg = ok2 ? ok2.split('/') : [];
    try {
      const li = await intern.mountListe(job.mount_id, quellSeg.concat(seg));
      for (const u of uploads.filter((x) => x.relSeg.join('/') === ok2)) {
        const f = (li.files || []).find((x) => x.name === u.name);
        if (f) stmt.prStateSetz.run(job.id, u.pfad, String(f.size || 0) + '|' + String(f.date || ''), u.sha, u.fileId);
      }
    } catch (_e) { /* naechster Lauf laedt einmal und frischt auf */ }
  }
  let text = hergeholt + ' geholt, ' + hochgeladen + ' hochgeladen, ' + ersetzt + ' aktualisiert, ' + unveraendert + ' unverändert';
  if (konflikte) text += ', ' + konflikte + ' Konflikt(e) als Kopie gesichert';
  if (entferntAnbieter) text += ', ' + entferntAnbieter + ' am Anbieter entfernt (bleiben im Speicher)';
  if (entferntLokal) text += ', ' + entferntLokal + ' im Speicher entfernt (bleiben am Anbieter)';
  if (zuGross) text += ', ' + zuGross + ' über ' + MAX_TEXT() + ' übersprungen';
  if (voll) text += ' - weitere folgen im nächsten Lauf';
  if (fehler.length) text += ' | FEHLER: ' + fehler.slice(0, 3).join(' · ') + (fehler.length > 3 ? ' …' : '');
  stmt.prErgebnis.run(new Date().toISOString(), text, job.id);
}
async function pairTick() {
  if (prLaeuft) return;
  prLaeuft = true;
  try {
    await geschuetzteDokumentenarbeit('Zwei-Wege-Dokumentabgleich', async () => {
      bereite();
      if (auslaufendeMountOperationen.size) return;
      for (const j of stmt.prJobs.all()) {
        if (!j.enabled) continue;
        await pairLauf(j);
      }
    }, { priority: 10 });
  } finally { prLaeuft = false; }
}
async function pairJetzt(id) {
  bereite();
  const j = stmt.prJob.get(String(id));
  if (!j) return;
  if (auslaufendeMountOperationen.size) return;
  if (prLaeuft) {
    stmt.prErgebnis.run(j.last_run_at || '', 'Ein Abgleich läuft gerade - bitte gleich erneut anstoßen.', j.id);
    return;
  }
  prLaeuft = true;
  try {
    await geschuetzteDokumentenarbeit(
      'Zwei-Wege-Dokumentabgleich ' + String(j.id),
      async () => pairLauf(j),
      { priority: 20 }
    );
  } finally { prLaeuft = false; }
}

function start(opts) {
  opts = opts || {};
  if (started) return { started: false, reason: 'bereits gestartet' };
  if (!db) db = opts.db || require('../../database/index');
  if (!intern) intern = opts.intern || require('../documents/routes').intern;
  totalBackupRunner = opts.runTotalBackup || defaultRunTotalBackup;
  jetztFn = typeof opts.now === 'function' ? opts.now : (() => new Date());
  mailSender = typeof opts.sendHealthMail === 'function' ? opts.sendHealthMail : null;
  warnMailTimeoutMs = Number.isFinite(Number(opts.healthTimeoutMs))
    ? Math.max(10, Number(opts.healthTimeoutMs))
    : 30000;
  bereite();
  started = true;
  const now = jetztFn();
  stmt.schedulerStart.run({ now: now.toISOString() });
  unterbrocheneLaeufeBereinigen(now);
  processHandlers = {
    backup: (id) => {
      applicationWriteBarrier.runDetached(() => {
        const accepted = starteJetzt(id);
        if (accepted.started) accepted.completion.catch(() => { /* Ergebnis/Health stehen dauerhaft in der DB */ });
      });
    },
    import: (id) => {
      applicationWriteBarrier.runDetached(() =>
        importJetzt(id).catch(() => { /* last_result traegt */ }));
    },
    pair: (id) => {
      applicationWriteBarrier.runDetached(() =>
        pairJetzt(id).catch(() => { /* last_result traegt */ }));
    }
  };
  process.on('dok-backup-lauf', processHandlers.backup);
  process.on('dok-import-lauf', processHandlers.import);
  process.on('dok-pair-lauf', processHandlers.pair);
  if (!opts.ohneTakt) {
    timer = setInterval(() => { tickSicher(); }, 60000);
    if (timer.unref) timer.unref();
    syncTimer = setInterval(() => { syncTick().catch(() => { /* naechster Takt */ }); }, 15000);
    if (syncTimer.unref) syncTimer.unref();
    impTimer = setInterval(() => { importTick().catch(() => { /* naechster Takt */ }); }, 60000);
    if (impTimer.unref) impTimer.unref();
    prTimer = setInterval(() => { pairTick().catch(() => { /* naechster Takt */ }); }, 60000);
    if (prTimer.unref) prTimer.unref();
    // Unabhängiger, strikt einläufiger Watchdog. Er schreibt KEIN künstliches
    // Scheduler-Lebenszeichen; Fortschritt ist ausschließlich ein beendeter
    // Tick. Warnmail und DB-Status besitzen eine eigene harte Zeitgrenze.
    healthTimer = setInterval(() => {
      healthWatchdog().catch(() => { /* Fehlerstatus wird innerhalb des Watchdogs persistiert. */ });
    }, 60000);
    if (healthTimer.unref) healthTimer.unref();
    // Nicht erst eine Minute warten: verpasster Termin, fälliger Retry und
    // überfälliger Warnstatus werden direkt nach dem Start verarbeitet.
    setImmediate(() => { tickSicher(); });
  }
  return { started: true };
}

function stop(options) {
  for (const handle of [timer, syncTimer, impTimer, prTimer, healthTimer]) {
    if (handle) clearInterval(handle);
  }
  timer = syncTimer = impTimer = prTimer = healthTimer = null;
  if (processHandlers) {
    process.removeListener('dok-backup-lauf', processHandlers.backup);
    process.removeListener('dok-import-lauf', processHandlers.import);
    process.removeListener('dok-pair-lauf', processHandlers.pair);
  }
  processHandlers = null;
  started = false;
  laeuft = syncLaeuft = impLaeuft = prLaeuft = healthLaeuft = false;
  if (options && options.reset) {
    db = null;
    intern = null;
    stmt = null;
    totalBackupRunner = defaultRunTotalBackup;
    jetztFn = () => new Date();
    mailSender = null;
    warnMailTimeoutMs = 30000;
  }
}

module.exports = { start, stop, istFaellig, starteJetzt, laufJetzt, health, normalisiereOptionen, zipSchreiben, sammel: (q) => { bereite(); return sammel(q); },
  scanTick: () => geschuetzteDokumentenarbeit(
    'Überwachter Scan-Eingang',
    async () => { bereite(); return scanEingangTick(); },
    { priority: 20 }
  ),
  syncJetzt: () => syncTick(),
  impTick: () => importTick(), importJetzt,
  prTick: () => pairTick(), pairJetzt,
  _test: {
    dokuDatum, dokuTeile, zeitVon, letzterPlanTermin, naechsterPlanTermin, faelligkeit,
    optionenVonJob, healthFuerJob, naechsterRetry,
    tick: () => tick(), tickSicher, healthWatchdog, aktualisiereWarnungen,
    unterbrocheneLaeufeBereinigen, bindeBackupZiel,
    laufMount,
    outstandingMountOperations: () => auslaufendeMountOperationen.size
  } };
