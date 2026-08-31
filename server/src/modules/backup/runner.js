'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { spawn } = require('child_process');
const { resticEnvironment } = require('../../config/restic-environment');
const backupDownload = require('./download');
const {
  SERVER_ROOT,
  DATA_ROOT,
  DATABASE_PATH,
  OUTPUTS_ROOT
} = require('../../config/paths');

const TARGET_MARKER = '.betreuungsbuero-backup-ziel';
const TARGET_MARKER_HEADER = 'Betreuungsbuero-Backupziel/1';
const OUTPUT_LIMIT = 64 * 1024;
const REMOTE_RESTIC = /^(?:s3|sftp|rest|rclone|azure|gs|b2|swift):/i;
const FINAL_SNAPSHOT_NAME = /^Gesamtsicherung_[0-9]{8}_[0-9]{6}(?:_[A-Za-z0-9_.-]+)?$/;
const BACKUP_CHILD_KEYS = Object.freeze([
  // Für die fachliche Recovery-Revisionsprüfung beziehungsweise den
  // rückwärtskompatiblen Recovery-Key-Fallback tatsächlich erforderlich.
  'ENCRYPTION_KEY', 'DOCUMENT_RECOVERY_KEY', 'DOCUMENT_RECOVERY_KEY_FILE',
  // Nichtgeheime Laufzeit-/Buildwerte, die das Betriebsinventar dokumentiert.
  'BETREUUNGSBUERO_BUILD_ID', 'GIT_COMMIT',
  'NODE_ENV', 'PORT', 'COOKIE_SECURE', 'CALENDAR_SYNC_INTERVAL_SECONDS',
  'MAILBOX_WATCH', 'REQUEST_TIMEOUT_MS', 'ENABLE_DOCUMENT_MIGRATION',
  'EXT_AI_PROVIDER', 'EXT_UPDATE_VERSION', 'APP_FILE', 'OUTPUTS_DIR',
  'RUNTIME_ROOT', 'DB_PATH', 'DATA_DIR', 'DOCUMENTS_DATA_ROOT',
  'EXTENSION_ARTIFACTS_DIR', 'TOTAL_BACKUP_DESTINATION',
  'TOTAL_BACKUP_RESTIC_ENV_FILE',
  'TOTAL_BACKUP_OFFSITE_MAINTENANCE_STATUS_DIR',
  'TOTAL_BACKUP_OFFSITE_MAINTENANCE_MAX_AGE_HOURS',
  'APP_IMAGE_REFERENCE', 'APP_IMAGE',
  'PUBLIC_BASE_URL', 'DOK_GRAPH_BASE', 'EXT_UPDATE_XPI_URL',
  'DOK_MS_AUTH', 'DOK_MS_TOKEN', 'DOK_GD_AUTH', 'DOK_GD_TOKEN',
  'DOK_GD_API', 'DOK_GD_UPLOAD'
]);
const RESTIC_CREDENTIAL_KEYS = new Set([
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AWS_DEFAULT_REGION', 'AWS_REGION', 'AWS_PROFILE',
  'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CONFIG_FILE',
  'RESTIC_REST_USERNAME', 'RESTIC_REST_PASSWORD',
  'B2_ACCOUNT_ID', 'B2_ACCOUNT_KEY',
  'AZURE_ACCOUNT_NAME', 'AZURE_ACCOUNT_KEY',
  'GOOGLE_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS',
  'RCLONE_CONFIG',
  'OS_AUTH_URL', 'OS_USERNAME', 'OS_USER_ID', 'OS_PASSWORD',
  'OS_REGION_NAME', 'OS_TENANT_ID', 'OS_TENANT_NAME',
  'OS_PROJECT_ID', 'OS_PROJECT_NAME',
  'OS_APPLICATION_CREDENTIAL_ID', 'OS_APPLICATION_CREDENTIAL_SECRET',
  'OS_USER_DOMAIN_NAME', 'OS_PROJECT_DOMAIN_NAME',
  'OS_TRUST_ID', 'OS_STORAGE_URL', 'OS_AUTH_TOKEN'
]);

function realResolve(roh) {
  let vorhanden = path.resolve(String(roh || ''));
  const rest = [];
  while (!fs.existsSync(vorhanden)) {
    const eltern = path.dirname(vorhanden);
    if (eltern === vorhanden) break;
    rest.unshift(path.basename(vorhanden));
    vorhanden = eltern;
  }
  let echt = vorhanden;
  try { echt = fs.realpathSync.native ? fs.realpathSync.native(vorhanden) : fs.realpathSync(vorhanden); }
  catch (_error) { /* path.resolve bleibt der sichere Fallback */ }
  return path.join(echt, ...rest);
}

function istUnterhalb(kind, eltern) {
  const rel = path.relative(path.resolve(eltern), path.resolve(kind));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function pruefeZiel(ziel, dataDir, serverDir, storageRoot) {
  const roh = String(ziel || '').trim();
  if (!roh) throw new Error('Zielordner für die Gesamtsicherung fehlt.');
  if (/[\0\r\n\t]/.test(roh)) throw new Error('Der Zielordner enthält unzulässige Steuerzeichen.');
  if (!path.isAbsolute(roh)) throw new Error('Die Gesamtsicherung braucht einen absoluten Zielpfad.');
  const abs = realResolve(roh);
  const echteDaten = dataDir ? realResolve(dataDir) : '';
  const echterServer = serverDir ? realResolve(serverDir) : '';
  const echterSpeicher = storageRoot ? realResolve(storageRoot) : '';
  if (abs === path.parse(abs).root) throw new Error('Das Wurzelverzeichnis ist kein zulässiges Sicherungsziel.');
  if (echteDaten && istUnterhalb(abs, echteDaten)) {
    throw new Error('Das Sicherungsziel darf nicht im Anwendungs-Datenverzeichnis liegen.');
  }
  if (echteDaten && istUnterhalb(echteDaten, abs)) {
    throw new Error('Das Sicherungsziel darf kein übergeordneter Ordner des Anwendungs-Datenverzeichnisses sein.');
  }
  if (echterServer && istUnterhalb(abs, echterServer)) {
    throw new Error('Das Sicherungsziel darf nicht im Server-/Projektverzeichnis liegen.');
  }
  if (echterServer && istUnterhalb(echterServer, abs)) {
    throw new Error('Das Sicherungsziel darf kein übergeordneter Ordner des Server-/Projektverzeichnisses sein.');
  }
  if (echterSpeicher && (istUnterhalb(abs, echterSpeicher) || istUnterhalb(echterSpeicher, abs))) {
    throw new Error('Sicherungsziel und zentraler Dokumentenspeicher dürfen sich nicht überlappen.');
  }
  return abs;
}

function targetMarker(destination) {
  const marker = path.join(destination, TARGET_MARKER);
  const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
  let fd;
  let text;
  try {
    fd = fs.openSync(marker, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(fd);
    const named = fs.lstatSync(marker);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink()
        || opened.dev !== named.dev || opened.ino !== named.ino
        || opened.size > 65536) {
      throw new Error('Die Zielmarke ist keine unvertauschte reguläre Datei.');
    }
    text = fs.readFileSync(fd, 'utf8');
    const after = fs.fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || after.ctimeMs !== opened.ctimeMs) {
      throw new Error('Die Zielmarke wurde während der Prüfung verändert.');
    }
  } catch (error) {
    if (error && typeof error.message === 'string' && error.message.startsWith('Die Zielmarke')) {
      throw error;
    }
    throw new Error(`Zielmarke fehlt oder ist nicht sicher lesbar: ${marker}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  if (!String(text || '').trim()) {
    throw new Error(
      'Die Zielmarke ist leer. Das Sicherungsziel muss zuerst ausdrücklich im Adminbereich initialisiert werden.'
    );
  }
  const lines = text.split(/\r?\n/);
  if (lines[0] !== TARGET_MARKER_HEADER) {
    throw new Error('Die Zielmarke hat ein unbekanntes Format.');
  }
  const ids = lines
    .filter((line) => line.startsWith('TARGET_ID='))
    .map((line) => line.slice('TARGET_ID='.length));
  if (ids.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ids[0])) {
    throw new Error('Die Zielmarke enthält keine eindeutige gültige TARGET_ID.');
  }
  const targetStat = fs.statSync(destination);
  return { marker, targetId: ids[0].toLowerCase(), deviceId: String(targetStat.dev) };
}

function begrenze(text, teil) {
  text = String(text || '');
  if (text.length >= OUTPUT_LIMIT) return text;
  const frei = OUTPUT_LIMIT - text.length;
  return text + String(teil || '').slice(0, frei);
}

function ausgabeText(stdout, stderr) {
  const text = (String(stdout || '') + '\n' + String(stderr || ''))
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' · ');
  return text || 'kein Ausgabetext';
}

function ganzeZahl(value, fallback, min, max, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new Error(`${label} muss zwischen ${min} und ${max} liegen.`);
  }
  return result;
}

function retentionArgs(value) {
  const retention = value && typeof value === 'object' ? value : {};
  if (retention.enabled === false) return [];
  const explicit = retention.enabled === true
    || ['daily', 'monthly', 'yearly', 'diagnostic'].some((key) => retention[key] !== undefined);
  if (!explicit) return [];
  const daily = ganzeZahl(retention.daily, 14, 0, 10000, 'Tägliche Generationen');
  const monthly = ganzeZahl(retention.monthly, 12, 0, 1200, 'Monatliche Generationen');
  const yearly = ganzeZahl(retention.yearly, 10, 0, 200, 'Jährliche Generationen');
  const diagnostic = ganzeZahl(retention.diagnostic, 6, 0, 100, 'Diagnose-Snapshots');
  if (!daily && !monthly && !yearly) {
    throw new Error('Ein aktivierter Generationenplan muss mindestens eine tägliche, monatliche oder jährliche Generation behalten.');
  }
  return [
    '--retention-daily', String(daily),
    '--retention-monthly', String(monthly),
    '--retention-yearly', String(yearly),
    '--retention-diagnostic', String(diagnostic)
  ];
}

function capacityArgs(opts) {
  const capacity = opts.capacity && typeof opts.capacity === 'object' ? opts.capacity : {};
  let warningBytes = capacity.warningBytes;
  if (warningBytes === undefined && opts.retention && opts.retention.enabled !== false
      && opts.retention.minFreeGb !== undefined) {
    const gb = Number(opts.retention.minFreeGb);
    if (!Number.isFinite(gb) || gb < 0 || gb > 1000000) {
      throw new Error('Kapazitätsreserve muss zwischen 0 und 1.000.000 GB liegen.');
    }
    warningBytes = Math.round(gb * 1024 * 1024 * 1024);
  }
  const bytes = ganzeZahl(warningBytes, 0, 0, Number.MAX_SAFE_INTEGER, 'Kapazitätswarngrenze');
  const percent = ganzeZahl(capacity.warningPercent, 0, 0, 99, 'Prozentuale Kapazitätswarngrenze');
  const args = [];
  if (bytes) args.push('--capacity-warning-bytes', String(bytes));
  if (percent) args.push('--capacity-warning-percent', String(percent));
  return args;
}

function protectedSecretFile(file, label) {
  const resolved = path.resolve(String(file || ''));
  const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
  let fd;
  try {
    fd = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(fd);
    const named = fs.lstatSync(resolved);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink()
        || opened.dev !== named.dev || opened.ino !== named.ino) {
      throw new Error(`${label} ist keine unvertauschte reguläre Datei.`);
    }
    if (process.platform !== 'win32' && (opened.mode & 0o777) !== 0o600) {
      throw new Error(`${label} muss exakt mit Modus 0600 geschützt sein.`);
    }
    if (opened.size < 1 || opened.size > 65536) {
      throw new Error(`${label} muss zwischen 1 und 65.536 Bytes enthalten.`);
    }
    return resolved;
  } catch (error) {
    if (error && typeof error.message === 'string' && error.message.startsWith(label)) throw error;
    throw new Error(`${label} fehlt oder kann nicht sicher geöffnet werden.`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function resticCredentialEnvironment(file) {
  const label = 'Die restic-Backend-Credential-Datei';
  const resolved = protectedSecretFile(file, label);
  const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
  let fd;
  let text;
  try {
    fd = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow);
    const before = fs.fstatSync(fd);
    text = fs.readFileSync(fd, 'utf8');
    const after = fs.fstatSync(fd);
    const named = fs.lstatSync(resolved);
    if (!before.isFile() || !after.isFile() || !named.isFile() || named.isSymbolicLink()
        || before.dev !== after.dev || before.ino !== after.ino
        || before.dev !== named.dev || before.ino !== named.ino
        || before.size !== after.size || before.mtimeMs !== after.mtimeMs
        || before.ctimeMs !== after.ctimeMs) {
      throw new Error(`${label} wurde während des sicheren Lesens verändert.`);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  const result = {};
  for (const [index, rawLine] of String(text).split(/\r?\n/).entries()) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const match = rawLine.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) {
      throw new Error(`${label} enthält in Zeile ${index + 1} kein gültiges SCHLUESSEL=WERT-Paar.`);
    }
    const key = match[1];
    const value = match[2];
    if (!RESTIC_CREDENTIAL_KEYS.has(key)) {
      throw new Error(`${label} enthält den nicht freigegebenen Schlüssel ${key}.`);
    }
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`${label} enthält den Schlüssel ${key} mehrfach.`);
    }
    if (value.length > 8192 || /[\0\r\n\t]/.test(value)) {
      throw new Error(`${label} enthält für ${key} einen unzulässigen Wert.`);
    }
    result[key] = value;
  }
  if (!Object.keys(result).length) {
    throw new Error(`${label} enthält keine freigegebenen Provider-Zugangsdaten.`);
  }
  return { file: resolved, env: result };
}

function resticProcessEnvironment(providerEnvironment, sourceEnvironment) {
  return resticEnvironment(providerEnvironment, sourceEnvironment);
}

function backupProcessEnvironment(providerEnvironment, sourceEnvironment) {
  const source = sourceEnvironment && typeof sourceEnvironment === 'object'
    ? sourceEnvironment
    : process.env;
  const result = resticEnvironment(providerEnvironment, source);
  for (const key of BACKUP_CHILD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = String(source[key] == null ? '' : source[key]);
    if (!value || value.length > 8192 || /[\0\r\n]/.test(value)) continue;
    result[key] = value;
  }
  // SESSION_SECRET und SETUP_TOKEN fehlen absichtlich. Die beiden für lokale
  // Prüfungen nötigen Schlüssel werden im Shellskript nicht an Restic
  // weitergereicht, sondern dort erneut durch eine engere Positivliste entfernt.
  return result;
}

function offsiteJobTag(job) {
  return 'bb-job-' + crypto.createHash('sha256')
    .update(`job=${job}\n`).digest('hex').slice(0, 24);
}

function offsiteProfileIdentity(value, job) {
  const offsite = value && typeof value === 'object' ? value : {};
  if (!offsite.enabled) return null;
  const repository = String(offsite.repository || '').trim();
  const tag = String(offsite.tag || 'betreuungsbuero').trim();
  const jobTag = offsiteJobTag(job);
  const profileSha = crypto.createHash('sha256')
    .update(`repository=${repository}\ntag=${tag}\njob_tag=${jobTag}\n`)
    .digest('hex');
  return { repository, tag, jobTag, profileSha };
}

function pendingValues(file) {
  let fd;
  try {
    const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
    fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(fd);
    const named = fs.lstatSync(file);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink()
        || opened.dev !== named.dev || opened.ino !== named.ino
        || opened.size < 1 || opened.size > 65536) return null;
    const text = fs.readFileSync(fd, 'utf8');
    const after = fs.fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || after.ctimeMs !== opened.ctimeMs) return null;
    const result = Object.create(null);
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      const pos = line.indexOf('=');
      if (pos <= 0) return null;
      const key = line.slice(0, pos);
      if (Object.prototype.hasOwnProperty.call(result, key)) return null;
      result[key] = line.slice(pos + 1);
    }
    return result;
  } catch (_error) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function stableRegularBuffer(file, maxBytes) {
  let fd;
  try {
    const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
    fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(fd);
    const named = fs.lstatSync(file);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink()
        || opened.dev !== named.dev || opened.ino !== named.ino
        || opened.size < 1 || opened.size > maxBytes) return null;
    const value = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || after.ctimeMs !== opened.ctimeMs) return null;
    return value;
  } catch (_error) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function oneReceiptValue(lines, prefix) {
  const values = lines
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
  return values.length === 1 ? values[0] : null;
}

/*
 * Crash-Reconciliation für genau das Fenster zwischen dauerhaft geschriebenem
 * positivem Offsite-Status und dem anschließenden DB-Erfolg. Der Dateiname
 * allein reicht dafür nicht: Job, Profil, Ziel, Snapshot und Manifest müssen
 * sowohl im Statusbeleg als auch im unvertauschten lokalen Snapshot
 * übereinstimmen. Ein alter Statusbeleg ohne Format 2 wird bewusst nicht als
 * Erfolg hochgestuft.
 */
function positiveOffsiteReceipt(destination, snapshotName, job, identity, targetId) {
  if (!identity || !FINAL_SNAPSHOT_NAME.test(String(snapshotName || ''))
      || path.basename(String(snapshotName || '')) !== String(snapshotName || '')) return null;
  const snapshot = path.join(destination, snapshotName);
  try {
    const named = fs.lstatSync(snapshot);
    if (!named.isDirectory() || named.isSymbolicLink()
        || realResolve(snapshot) !== snapshot
        || path.dirname(snapshot) !== destination) return null;
  } catch (_error) {
    return null;
  }

  const receiptBuffer = stableRegularBuffer(`${snapshot}.offsite-status`, 65536);
  const statusBuffer = stableRegularBuffer(path.join(snapshot, 'STATUS.txt'), 4096);
  const jobBuffer = stableRegularBuffer(path.join(snapshot, 'verwaltung', 'JOB-ID.txt'), 4096);
  const targetBuffer = stableRegularBuffer(path.join(snapshot, 'verwaltung', 'TARGET-ID.txt'), 4096);
  const manifestBuffer = stableRegularBuffer(path.join(snapshot, 'MANIFEST.tsv'), 64 * 1024 * 1024);
  const manifestShaBuffer = stableRegularBuffer(path.join(snapshot, 'MANIFEST.tsv.sha256'), 4096);
  if (!receiptBuffer || !statusBuffer || !jobBuffer || !targetBuffer
      || !manifestBuffer || !manifestShaBuffer) return null;

  const lines = receiptBuffer.toString('utf8').split(/\r?\n/);
  const manifestSha = crypto.createHash('sha256').update(manifestBuffer).digest('hex');
  const recordedManifestSha = manifestShaBuffer.toString('utf8').trim().toLowerCase();
  const resticSnapshotId = oneReceiptValue(lines, 'Restic-Snapshot-ID: ');
  if (lines[0] !== 'OK'
      || oneReceiptValue(lines, 'Format: ') !== 'Betreuungsbuero-Offsite-Status/2'
      || oneReceiptValue(lines, 'Snapshot: ') !== snapshotName
      || String(oneReceiptValue(lines, 'Target-ID: ') || '').toLowerCase() !== targetId
      || String(oneReceiptValue(lines, 'Manifest-SHA-256: ') || '').toLowerCase() !== manifestSha
      || oneReceiptValue(lines, 'Job-ID: ') !== job
      || String(oneReceiptValue(lines, 'Profil-SHA-256: ') || '').toLowerCase() !== identity.profileSha
      || oneReceiptValue(lines, 'Restic-Job-Tag: ') !== identity.jobTag
      || !/^[0-9a-f]{8,64}$/i.test(String(resticSnapshotId || ''))
      || statusBuffer.toString('utf8').trim() !== 'VOLLSTAENDIG'
      || jobBuffer.toString('utf8').trim() !== job
      || targetBuffer.toString('utf8').trim().toLowerCase() !== targetId
      || !/^[0-9a-f]{64}$/.test(recordedManifestSha)
      || recordedManifestSha !== manifestSha) return null;
  try {
    backupDownload.validateSnapshot({
      targetDir: destination,
      snapshotName,
      jobId: job,
      targetId
    });
  } catch (_error) {
    return null;
  }
  return {
    snapshot,
    snapshotName,
    resticSnapshotId,
    manifestSha
  };
}

function pendingOffsiteSnapshots(destination, job, profileSha, targetId) {
  let names;
  try { names = fs.readdirSync(destination); }
  catch (_error) { return []; }
  return names
    .filter((name) => /^Gesamtsicherung_[0-9]{8}_[0-9]{6}(?:_[A-Za-z0-9_.-]+)?\.offsite-pending$/.test(name))
    .sort()
    .flatMap((name) => {
      const sidecar = path.join(destination, name);
      const values = pendingValues(sidecar);
      const snapshotName = name.slice(0, -'.offsite-pending'.length);
      if (!values
          || values.FORMAT !== 'Betreuungsbuero-Offsite-Pending/1'
          || values.SNAPSHOT !== snapshotName
          || values.JOB_ID !== job
          || values.PROFILE_SHA !== profileSha
          || values.TARGET_ID !== targetId
          || !/^[0-9a-f]{64}$/i.test(String(values.MANIFEST_SHA || ''))) return [];
      const snapshot = path.join(destination, snapshotName);
      try {
        const stat = fs.lstatSync(snapshot);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return [];
      } catch (_error) {
        return [];
      }
      return [{ snapshot, sidecar }];
    });
}

function offsiteBacklogSummary(destination, job, profileSha, targetId) {
  const summary = {
    total: 0,
    currentProfile: 0,
    foreignProfile: 0,
    otherJob: 0,
    foreignTarget: 0,
    invalid: 0
  };
  let names;
  try { names = fs.readdirSync(destination); }
  catch (_error) { return summary; }
  for (const name of names) {
    if (!/^Gesamtsicherung_[0-9]{8}_[0-9]{6}(?:_[A-Za-z0-9_.-]+)?\.offsite-pending$/.test(name)) {
      continue;
    }
    summary.total += 1;
    const values = pendingValues(path.join(destination, name));
    const snapshotName = name.slice(0, -'.offsite-pending'.length);
    if (!values
        || values.FORMAT !== 'Betreuungsbuero-Offsite-Pending/1'
        || values.SNAPSHOT !== snapshotName
        || !/^[0-9a-f]{64}$/i.test(String(values.MANIFEST_SHA || ''))
        || !/^[0-9a-f]{64}$/i.test(String(values.PROFILE_SHA || ''))
        || !values.JOB_ID || !values.TARGET_ID) {
      summary.invalid += 1;
    } else if (values.TARGET_ID !== targetId) {
      summary.foreignTarget += 1;
    } else if (values.JOB_ID !== job) {
      summary.otherJob += 1;
    } else if (values.PROFILE_SHA !== profileSha) {
      summary.foreignProfile += 1;
    } else {
      summary.currentProfile += 1;
    }
  }
  return summary;
}

function inspectOffsiteBacklog(options) {
  const opts = options || {};
  const destination = path.resolve(String(opts.destination || ''));
  const stableJobId = jobId(opts.jobId);
  const marker = targetMarker(destination);
  const expectedTargetId = String(opts.expectedTargetId || '').trim().toLowerCase();
  if (expectedTargetId && expectedTargetId !== marker.targetId) {
    throw new Error(
      'Falscher Sicherungsdatenträger: Die TARGET_ID stimmt nicht mit dem Zeitplan überein.'
    );
  }
  const identity = offsiteProfileIdentity(opts.offsite, stableJobId);
  const profileSha = identity ? identity.profileSha : '';
  const counts = offsiteBacklogSummary(
    destination, stableJobId, profileSha, marker.targetId
  );
  return {
    destination,
    jobId: stableJobId,
    targetId: marker.targetId,
    profileSha: profileSha || null,
    ...counts,
    pendingForJob: counts.currentProfile + counts.foreignProfile,
    blocksProfileChange: counts.currentProfile + counts.foreignProfile > 0 || counts.invalid > 0,
    warning: counts.foreignProfile > 0 || counts.invalid > 0
  };
}

function offsiteArgs(value) {
  const offsite = value && typeof value === 'object' ? value : {};
  if (!offsite.enabled) return [];
  if (String(offsite.mode || '') !== 'restic') {
    throw new Error('Als verschlüsselte Offsite-Zweitkopie wird nur restic unterstützt.');
  }
  const repository = String(offsite.repository || '').trim();
  const passwordFile = String(offsite.passwordFile || '').trim();
  if (!REMOTE_RESTIC.test(repository)) {
    throw new Error('Offsite braucht ein echtes Remote-restic-Repository; lokale oder normale NAS-Dateipfade sind nicht zulässig.');
  }
  if (/[\0\r\n\t]/.test(repository)) throw new Error('Das Offsite-Repository enthält unzulässige Steuerzeichen.');
  if (/\/\/[^/@:]+:[^/@]+@/.test(repository)) {
    throw new Error('Offsite-Zugangsdaten dürfen nicht im Repository-URL stehen.');
  }
  if (!path.isAbsolute(passwordFile)) {
    throw new Error('Die restic-Passwortdatei braucht einen absoluten Pfad.');
  }
  const protectedPasswordFile = protectedSecretFile(passwordFile, 'Die restic-Passwortdatei');
  const tag = String(offsite.tag || 'betreuungsbuero').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(tag)) {
    throw new Error('Der restic-Tag enthält unzulässige Zeichen.');
  }
  const retentionMode = String(offsite.retentionMode || 'external').trim();
  if (retentionMode !== 'external') {
    throw new Error(
      'Remote-Retention darf nur durch die getrennte Offsite-Wartung mit kurzlebigen Löschrechten ausgeführt werden.'
    );
  }
  return [
    '--offsite-mode', 'restic',
    '--offsite-repository', repository,
    '--offsite-password-file', protectedPasswordFile,
    '--offsite-tag', tag,
    '--offsite-required', offsite.required === false ? 'no' : 'yes',
    '--offsite-retention-mode', 'external',
    '--offsite-max-pending', String(ganzeZahl(offsite.maxPending, 14, 1, 365, 'Maximale Offsite-Warteschlange')),
    '--offsite-check-days', String(ganzeZahl(offsite.checkDays, 7, 1, 365, 'Offsite-Prüfintervall')),
    '--offsite-read-slices', String(ganzeZahl(offsite.readSlices, 7, 1, 64, 'Rotierende Offsite-Datenprüfungen'))
  ];
}

function jobId(value) {
  const id = String(value || 'manual').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id)) {
    throw new Error('Die Sicherungsjob-Kennung enthält unzulässige Zeichen.');
  }
  return id;
}

function heartbeatConfig(value) {
  const heartbeat = value && typeof value === 'object' ? value : {};
  if (!heartbeat.enabled) return null;
  const heartbeatUrl = String(heartbeat.url || heartbeat.heartbeatUrl || '').trim();
  let parsed;
  try { parsed = new URL(heartbeatUrl); }
  catch (_error) { throw new Error('Die Dead-Man-Heartbeat-URL ist ungültig.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Die Dead-Man-Heartbeat-URL muss HTTPS ohne Zugangsdaten, Query oder Fragment verwenden.');
  }
  const secretFile = path.resolve(String(heartbeat.secretFile || ''));
  if (!path.isAbsolute(String(heartbeat.secretFile || ''))) {
    throw new Error('Die Dead-Man-Secret-Datei braucht einen absoluten Pfad.');
  }
  let stat;
  try { stat = fs.lstatSync(secretFile); }
  catch (_error) { throw new Error('Die Dead-Man-Secret-Datei fehlt.'); }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Die Dead-Man-Secret-Datei ist keine reguläre Datei.');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600) {
    throw new Error('Die Dead-Man-Secret-Datei muss exakt mit Modus 0600 geschützt sein.');
  }
  const timeoutMs = ganzeZahl(heartbeat.timeoutMs, 10000, 1000, 60000, 'Dead-Man-Zeitlimit');
  return { url: parsed, secretFile, timeoutMs };
}

function heartbeatSecret(config) {
  const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
  let fd;
  try {
    fd = fs.openSync(config.secretFile, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)) {
      throw new Error('Die Dead-Man-Secret-Datei ist nicht regulär oder nicht exakt mit Modus 0600 geschützt.');
    }
    const secret = fs.readFileSync(fd);
    if (secret.length < 16 || secret.length > 4096) {
      throw new Error('Die Dead-Man-Secret-Datei muss zwischen 16 und 4096 Bytes enthalten.');
    }
    return secret;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function sendSuccessHeartbeat(config, payload, requestFn) {
  if (!config) return Promise.resolve();
  let secret;
  try { secret = heartbeatSecret(config); }
  catch (error) { return Promise.reject(error); }
  const body = Buffer.from(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const call = requestFn || https.request;
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadlineTimer = null;
    let req;
    const settle = (error) => {
      if (settled) return;
      settled = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (error) reject(error);
      else resolve();
    };
    req = call(config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'x-betreuungsbuero-signature': `sha256=${signature}`
      }
    }, (res) => {
      res.resume();
      res.once('aborted', () => settle(new Error('Dead-Man-Heartbeat-Antwort wurde vorzeitig abgebrochen.')));
      res.once('error', settle);
      res.once('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) settle();
        else settle(new Error(`Dead-Man-Heartbeat antwortete mit HTTP ${res.statusCode}.`));
      });
    });
    // setTimeout am Socket misst nur Inaktivität. Die unabhängige Deadline
    // beendet auch eine Antwort, die mit einzelnen Bytes endlos weitertröpfelt.
    deadlineTimer = setTimeout(() => {
      const error = new Error('Dead-Man-Heartbeat hat die absolute Zeitgrenze überschritten.');
      try { req.destroy(error); } catch (_destroyError) { /* settle unten */ }
      settle(error);
    }, config.timeoutMs);
    req.setTimeout(config.timeoutMs, () => {
      const error = new Error('Dead-Man-Heartbeat hat das Inaktivitätszeitlimit überschritten.');
      try { req.destroy(error); } catch (_destroyError) { /* settle unten */ }
      settle(error);
    });
    req.once('error', (error) => {
      settle(error);
    });
    req.end(body);
  });
}

function recoveryFingerprint(opts) {
  const explicit = String(opts.recoveryKeyFingerprint || '').trim();
  if (explicit) return explicit;
  const keyStore = require('../recovery/key-store').shared();
  const status = keyStore.publicStatus();
  if (!status || !status.configured) return '';
  if (!status.strong || status.requiresRotation) {
    throw new Error('Der Wiederherstellungsschlüssel ist ein schwacher Legacy-Schlüssel und muss vor der Gesamtsicherung rotiert werden.');
  }
  return String(keyStore.getFingerprint() || '');
}

function appFileFor(opts, serverDir) {
  if (opts.appFile !== undefined) {
    const file = path.resolve(String(opts.appFile || ''));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error('Die ausgelieferte App-Datei fehlt: ' + file);
    }
    return file;
  }
  const outputsDir = path.resolve(String(opts.outputsDir || OUTPUTS_ROOT));
  const appName = String(opts.appName || process.env.APP_FILE || 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
  const candidate = path.join(outputsDir, appName);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error('Die erwartete ausgelieferte App-Datei fehlt: ' + candidate);
  }
  return candidate;
}

function runTotalBackup(options) {
  const opts = options || {};
  const resumeOffsiteOnly = opts.resumeOffsiteOnly === true;
  const resumeSnapshot = resumeOffsiteOnly ? String(opts.resumeSnapshot || '') : '';
  const serverDir = path.resolve(String(opts.serverDir || SERVER_ROOT));
  const dataDir = path.resolve(String(opts.dataDir || DATA_ROOT));
  const dbPath = path.resolve(String(opts.dbPath || DATABASE_PATH));
  const scriptPath = path.resolve(String(opts.scriptPath || path.join(serverDir, 'tools', 'gesamt-backup.sh')));
  const destination = pruefeZiel(opts.destination, dataDir, serverDir, opts.storageRoot);

  if (!fs.existsSync(scriptPath) || !fs.statSync(scriptPath).isFile()) {
    return Promise.reject(new Error('Sicherungsskript fehlt: ' + scriptPath));
  }
  if (!resumeOffsiteOnly) {
    if (!fs.existsSync(dbPath) || !fs.statSync(dbPath).isFile()) {
      return Promise.reject(new Error('SQLite-Datenbank fehlt: ' + dbPath));
    }
    if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
      return Promise.reject(new Error('Anwendungs-Datenverzeichnis fehlt: ' + dataDir));
    }
  }
  let markerInfo;
  try { markerInfo = targetMarker(destination); }
  catch (error) { return Promise.reject(error); }
  const expectedTargetId = String(opts.expectedTargetId || '').trim().toLowerCase();
  if (expectedTargetId && expectedTargetId !== markerInfo.targetId) {
    return Promise.reject(new Error('Falscher Sicherungsdatenträger: Die TARGET_ID stimmt nicht mit dem Zeitplan überein.'));
  }
  const stableJobId = jobId(opts.jobId);
  if (resumeOffsiteOnly
      && (!FINAL_SNAPSHOT_NAME.test(resumeSnapshot) || path.basename(resumeSnapshot) !== resumeSnapshot)) {
    return Promise.reject(new Error(
      'Ein reiner Offsite-Wiederholungsversuch braucht den exakt persistierten lokalen Snapshot-Namen.'
    ));
  }
  let heartbeat;
  try { heartbeat = heartbeatConfig(opts.heartbeat); }
  catch (error) { return Promise.reject(error); }
  let offsiteArgv;
  try { offsiteArgv = offsiteArgs(opts.offsite); }
  catch (error) { return Promise.reject(error); }
  const offsitePasswordFile = offsiteArgv.length
    ? realResolve(String(opts.offsite && opts.offsite.passwordFile || ''))
    : '';
  const credentialFileInput = offsiteArgv.length
    ? String(opts.resticCredentialEnvFile
      || process.env.TOTAL_BACKUP_RESTIC_ENV_FILE || '').trim()
    : '';
  let resticCredentialEnv = {};
  if (offsitePasswordFile) {
    const roots = [dataDir, serverDir, destination, opts.storageRoot]
      .filter(Boolean).map(realResolve);
    if (roots.some((root) => istUnterhalb(offsitePasswordFile, root))) {
      return Promise.reject(new Error(
        'Die restic-Passwortdatei muss außerhalb von Anwendung, Dokumentenspeicher und Sicherungsziel liegen.'
      ));
    }
  }
  if (credentialFileInput) {
    if (!path.isAbsolute(credentialFileInput)) {
      return Promise.reject(new Error(
        'Die restic-Backend-Credential-Datei muss als absoluter Pfad angegeben werden.'
      ));
    }
    const credentialFile = realResolve(credentialFileInput);
    const roots = [dataDir, serverDir, destination, opts.storageRoot]
      .filter(Boolean).map(realResolve);
    if (roots.some((root) => istUnterhalb(credentialFile, root))) {
      return Promise.reject(new Error(
        'Die restic-Backend-Credential-Datei muss außerhalb von Anwendung, Dokumentenspeicher und Sicherungsziel liegen.'
      ));
    }
    try {
      resticCredentialEnv = resticCredentialEnvironment(credentialFile).env;
    } catch (error) {
      return Promise.reject(error);
    }
  }
  if (heartbeat) {
    const secret = realResolve(heartbeat.secretFile);
    const roots = [dataDir, serverDir, destination, opts.storageRoot].filter(Boolean).map(realResolve);
    if (roots.some((root) => istUnterhalb(secret, root))) {
      return Promise.reject(new Error('Die Dead-Man-Secret-Datei muss außerhalb von Anwendung, Dokumentenspeicher und Sicherungsziel liegen.'));
    }
  }
  const offsiteIdentity = offsiteArgv.length
    ? offsiteProfileIdentity(opts.offsite, stableJobId)
    : null;
  const pendingOffsite = offsiteIdentity
    ? pendingOffsiteSnapshots(
      destination, stableJobId, offsiteIdentity.profileSha, markerInfo.targetId
    )
    : [];
  // Ein normaler manueller oder planmäßiger Lauf muss immer eine fällige neue
  // lokale Generation erzeugen. Nur der Scheduler darf nach einem bereits
  // persistierten local-complete/offsite-pending-Ergebnis ausdrücklich einen
  // reinen Remote-Retry anfordern.
  if (resumeOffsiteOnly && !offsiteIdentity) {
    return Promise.reject(new Error(
      'Ein reiner Offsite-Wiederholungsversuch braucht ein aktives Offsite-Profil.'
    ));
  }
  const matchingPending = resumeOffsiteOnly
    ? pendingOffsite.find((entry) => path.basename(entry.snapshot) === resumeSnapshot)
    : null;
  const reconciledReceipt = resumeOffsiteOnly && !matchingPending
    ? positiveOffsiteReceipt(
      destination, resumeSnapshot, stableJobId, offsiteIdentity, markerInfo.targetId
    )
    : null;
  if (resumeOffsiteOnly && !matchingPending && !reconciledReceipt) {
    const error = new Error(
      'Für den exakt angeforderten Offsite-Wiederholungsversuch gibt es weder eine passende wartende Generation noch einen gültigen positiven Abschlussbeleg.'
    );
    error.offsiteBacklog = offsiteBacklogSummary(
      destination, stableJobId, offsiteIdentity.profileSha, markerInfo.targetId
    );
    return Promise.reject(error);
  }
  if (reconciledReceipt) {
    return (async () => {
      let heartbeatWarning = '';
      try {
        await sendSuccessHeartbeat(heartbeat, {
          event: 'backup_complete',
          jobId: stableJobId,
          targetId: markerInfo.targetId,
          snapshot: resumeSnapshot,
          protection: 'local-and-offsite',
          warnings: [],
          completedAt: new Date().toISOString(),
          reconciledAfterCrash: true
        }, opts.heartbeatRequestFn);
      } catch (error) {
        heartbeatWarning = 'WARNUNG=DEAD_MAN_HEARTBEAT_FEHLER ' + String(error.message || error);
      }
      const text = [
        `RECONCILED_OFFSITE=OK SNAPSHOT=${reconciledReceipt.snapshot}`,
        `RESTIC_SNAPSHOT_ID=${reconciledReceipt.resticSnapshotId}`,
        heartbeatWarning
      ].filter(Boolean).join(' · ');
      return {
        code: 0,
        text,
        destination,
        targetId: markerInfo.targetId,
        targetDeviceId: markerInfo.deviceId,
        snapshot: reconciledReceipt.snapshot,
        diagnosticSnapshots: [],
        warnings: heartbeatWarning ? [heartbeatWarning] : [],
        degraded: !!heartbeatWarning,
        heartbeatOk: !heartbeatWarning,
        localComplete: true,
        offsitePending: false,
        resumedOffsite: true,
        reconciledAfterCrash: true,
        offsiteBacklog: offsiteBacklogSummary(
          destination, stableJobId, offsiteIdentity.profileSha, markerInfo.targetId
        )
      };
    })();
  }

  const args = [
    '--db', dbPath,
    '--data-dir', dataDir,
    '--server-dir', serverDir,
    '--destination', destination,
    '--require-marker',
    '--expected-target-id', markerInfo.targetId,
    '--job-id', stableJobId
  ];
  const label = String(opts.label || '').trim();
  if (label) args.push('--label', label.slice(0, 80));
  const retriesValue = opts.consistencyRetries !== undefined
    ? opts.consistencyRetries
    : (typeof opts.retry === 'number' ? opts.retry : opts.retry && opts.retry.consistencyRetries);
  const consistencyRetries = ganzeZahl(retriesValue, 2, 0, 5, 'Zusätzliche Konsistenzversuche');
  args.push('--consistency-retries', String(consistencyRetries));
  args.push(...retentionArgs(opts.retention));
  args.push(...capacityArgs(opts));
  args.push(...offsiteArgv);
  if (resumeOffsiteOnly) {
    args.push('--resume-offsite-only');
    args.push('--resume-snapshot', resumeSnapshot);
  }
  // Die lokale Generation wurde bereits vollständig geprüft. Ein reiner
  // Remote-Retry darf deshalb nicht vom aktuellen Recovery-Key oder dessen
  // Laufzeitdatei abhängen und liest diese Live-Konfiguration nicht erneut.
  const fingerprint = resumeOffsiteOnly ? '' : recoveryFingerprint(opts);
  if (fingerprint) {
    if (!/^[0-9a-f]{24}$/i.test(fingerprint)) {
      return Promise.reject(new Error('Der Recovery-Key-Fingerabdruck ist ungültig.'));
    }
    args.push('--expected-recovery-fingerprint', fingerprint);
  }
  const appFile = resumeOffsiteOnly ? '' : appFileFor(opts, serverDir);
  if (appFile) args.push('--app-file', appFile);
  if (opts.allowMissingRecoveryImages === true) args.push('--allow-missing-recovery-images');
  const timeoutMs = ganzeZahl(opts.timeoutMs, 0, 0, 24 * 60 * 60 * 1000, 'Zeitlimit');

  const spawnFn = opts.spawnFn || spawn;
  return new Promise((resolve, reject) => {
    let kind;
    let beendet = false;
    let timeoutTimer = null;
    let killTimer = null;
    let timedOut = false;
    let stdoutLines = '';
    let localSnapshot = '';
    let resumedLocalSnapshot = false;
    let localReadyError = null;
    let snapshotAnnouncements = 0;
    const diagnosticSnapshots = [];
    try {
      if (offsitePasswordFile) {
        protectedSecretFile(offsitePasswordFile, 'Die restic-Passwortdatei');
      }
      const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        // Eigene Prozessgruppe, damit ein Zeitlimit auch ein gerade laufendes
        // tar/restic/sqlite3 beendet und nicht nur die wartende Shell.
        detached: process.platform !== 'win32',
        env: backupProcessEnvironment(
          resticCredentialEnv,
          opts.baseEnvironment || process.env
        )
      };
      kind = spawnFn(scriptPath, args, spawnOptions);
    } catch (e) {
      reject(new Error('Gesamtsicherung konnte nicht gestartet werden: ' + (e.message || e)));
      return;
    }
    let stdout = '';
    let stderr = '';
    const terminate = (signal) => {
      if (process.platform !== 'win32' && Number.isInteger(kind.pid) && kind.pid > 0) {
        try { process.kill(-kind.pid, signal); return; } catch (_error) { /* Fallback unten */ }
      }
      try { if (typeof kind.kill === 'function') kind.kill(signal); } catch (_error) { /* close entscheidet */ }
    };
    const localReady = (line) => {
      if (line.startsWith('DIAGNOSE_SNAPSHOT=')) {
        const diagnostic = line.slice('DIAGNOSE_SNAPSHOT='.length).trim();
        if (diagnostic) diagnosticSnapshots.push(diagnostic);
        return;
      }
      const resumed = line.startsWith('RESUME_SNAPSHOT=');
      const fresh = line.startsWith('SNAPSHOT=');
      if ((!fresh && !resumed) || localReadyError) return;
      snapshotAnnouncements += 1;
      if (snapshotAnnouncements !== 1) {
        localReadyError = new Error('Das Kindprogramm meldete mehr als einen finalen lokalen Snapshot.');
        terminate('SIGTERM');
        return;
      }
      const announced = line.slice((resumed ? 'RESUME_SNAPSHOT=' : 'SNAPSHOT=').length).trim();
      // Ziel und gemeldeter Snapshot werden kanonisch verglichen. Das ist
      // insbesondere auf macOS nötig (/var -> /private/var) und verhindert
      // zugleich, dass ein Symlinkpfad die Elternprüfung umgeht.
      const resolved = realResolve(announced);
      if (path.dirname(resolved) !== destination
          || (resumed && path.basename(resolved) !== resumeSnapshot)
          || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()
          || !fs.existsSync(path.join(resolved, 'STATUS.txt'))
          || fs.readFileSync(path.join(resolved, 'STATUS.txt'), 'utf8').trim() !== 'VOLLSTAENDIG'
          || !fs.existsSync(path.join(resolved, 'MANIFEST.tsv'))) {
        localReadyError = new Error('Das Kindprogramm meldete einen ungültigen oder unvollständigen lokalen Snapshot.');
        terminate('SIGTERM');
        return;
      }
      localSnapshot = resolved;
      resumedLocalSnapshot = resumed;
      try {
        if (typeof opts.onLocalSnapshotReady === 'function') {
          opts.onLocalSnapshotReady({
            snapshot: resolved,
            destination,
            targetId: markerInfo.targetId,
            jobId: stableJobId,
            resumedOffsite: resumed
          });
        }
      } catch (error) {
        localReadyError = error;
        terminate('SIGTERM');
      }
    };
    const stdoutChunk = (b) => {
      const chunk = String(b || '');
      stdout = begrenze(stdout, chunk);
      stdoutLines += chunk;
      let pos;
      while ((pos = stdoutLines.indexOf('\n')) >= 0) {
        const line = stdoutLines.slice(0, pos).replace(/\r$/, '');
        stdoutLines = stdoutLines.slice(pos + 1);
        localReady(line);
      }
      if (stdoutLines.length > 4096) {
        stdoutLines = stdoutLines.slice(-4096);
      }
    };
    if (kind.stdout) kind.stdout.on('data', stdoutChunk);
    if (kind.stderr) kind.stderr.on('data', (b) => { stderr = begrenze(stderr, b); });
    kind.once('error', (e) => {
      if (beendet) return;
      beendet = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      reject(new Error('Gesamtsicherung konnte nicht gestartet werden: ' + (e.message || e)));
    });
    if (timeoutMs) {
      timeoutTimer = setTimeout(() => {
        if (beendet) return;
        timedOut = true;
        terminate('SIGTERM');
        killTimer = setTimeout(() => {
          if (beendet) return;
          terminate('SIGKILL');
        }, Math.min(10000, Math.max(1000, Math.round(timeoutMs / 10))));
        if (killTimer.unref) killTimer.unref();
      }, timeoutMs);
    }
    kind.once('close', async (code, signal) => {
      if (beendet) return;
      beendet = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      const detail = ausgabeText(stdout, stderr);
      const offsiteBacklog = offsiteIdentity
        ? offsiteBacklogSummary(
          destination, stableJobId, offsiteIdentity.profileSha, markerInfo.targetId
        )
        : offsiteBacklogSummary(destination, stableJobId, '', markerInfo.targetId);
      if (stdoutLines) localReady(stdoutLines.replace(/\r$/, ''));
      if (localReadyError) {
        const error = new Error('Lokaler Snapshot konnte nicht sicher bestätigt werden: ' + (localReadyError.message || localReadyError));
        error.offsiteBacklog = offsiteBacklog;
        return reject(error);
      }
      if (timedOut) {
        const error = new Error(`Gesamtsicherung hat das Zeitlimit von ${timeoutMs} ms überschritten: ${detail}`);
        error.offsiteBacklog = offsiteBacklog;
        return reject(error);
      }
      if (code === 0) {
        const snapshotMatch = /(?:^| · )SNAPSHOT=([^·]+?)(?= · |$)/.exec(detail);
        const warnings = detail.split(' · ').filter((part) => /^WARNUNG=/.test(part));
        const snapshot = localSnapshot || (snapshotMatch ? snapshotMatch[1].trim() : '');
        if (!snapshot) {
          return reject(new Error('Gesamtsicherung meldete Erfolg ohne eindeutigen Snapshot-Pfad: ' + detail));
        }
        const offsiteWarnings = warnings.filter((part) => /^WARNUNG=OFFSITE/.test(part));
        const degraded = offsiteWarnings.length > 0;
        const offsitePending = fs.existsSync(`${snapshot}.offsite-pending`);
        let heartbeatWarning = '';
        try {
          await sendSuccessHeartbeat(heartbeat, {
            event: degraded ? 'backup_degraded' : 'backup_complete',
            jobId: stableJobId,
            targetId: markerInfo.targetId,
            snapshot: path.basename(snapshot),
            protection: opts.offsite && opts.offsite.enabled
              ? (degraded ? 'local-only-degraded' : 'local-and-offsite')
              : 'local-only',
            warnings: offsiteWarnings.slice(0, 10),
            completedAt: new Date().toISOString()
          }, opts.heartbeatRequestFn);
        } catch (error) {
          // Der Snapshot und gegebenenfalls die erforderliche Offsite-Kopie sind
          // bereits vollständig. Ein Monitorfehler ist ein eigener Warnkanal
          // und darf keine zweite Vollaufnahme mit weiterem Speicherverbrauch
          // auslösen. Ein echter Dead-Man-Dienst alarmiert gerade dadurch, dass
          // sein signierter Erfolg ausbleibt.
          heartbeatWarning = 'WARNUNG=DEAD_MAN_HEARTBEAT_FEHLER ' + String(error.message || error);
          warnings.push(heartbeatWarning);
        }
        return resolve({
          code: 0,
          text: heartbeatWarning ? `${detail} · ${heartbeatWarning}` : detail,
          destination,
          targetId: markerInfo.targetId,
          targetDeviceId: markerInfo.deviceId,
          snapshot,
          diagnosticSnapshots,
          warnings,
          degraded: degraded || !!heartbeatWarning,
          heartbeatOk: !heartbeatWarning,
          localComplete: true,
          offsitePending,
          resumedOffsite: resumedLocalSnapshot,
          offsiteBacklog
        });
      }
      if (code === 2) {
        const error = new Error('UNVOLLSTÄNDIGE Gesamtsicherung (Prüfbericht lesen): ' + detail);
        error.offsiteBacklog = offsiteBacklog;
        return reject(error);
      }
      const ende = signal ? ('Signal ' + signal) : ('Rückgabecode ' + String(code));
      const error = new Error('Gesamtsicherung fehlgeschlagen (' + ende + '): ' + detail);
      error.offsiteBacklog = offsiteBacklog;
      const offsitePending = !!localSnapshot && fs.existsSync(`${localSnapshot}.offsite-pending`);
      if (localSnapshot && offsitePending) {
        error.localComplete = true;
        error.offsitePending = true;
        error.snapshot = localSnapshot;
        error.resumeOnly = resumedLocalSnapshot;
        error.code = Number(code);
      }
      reject(error);
    });
  });
}

module.exports = {
  TARGET_MARKER,
  TARGET_MARKER_HEADER,
  pruefeZiel,
  targetMarker,
  inspectOffsiteBacklog,
  runTotalBackup,
  _test: {
    realResolve,
    istUnterhalb,
    ausgabeText,
    retentionArgs,
    capacityArgs,
    offsiteArgs,
    offsiteJobTag,
    offsiteProfileIdentity,
    pendingOffsiteSnapshots,
    offsiteBacklogSummary,
    positiveOffsiteReceipt,
    resticCredentialEnvironment,
    resticProcessEnvironment,
    backupProcessEnvironment,
    jobId,
    heartbeatConfig,
    sendSuccessHeartbeat,
    recoveryFingerprint,
    appFileFor
  }
};
