'use strict';

/*
 * Vertrauensanker fuer die getrennte Restic-Wartung.
 *
 * Der normale Anwendungsprozess besitzt nur append-only Upload-Zugangsdaten.
 * Eine gesonderte, kurzlebige Wartungsinstanz darf forget/prune ausfuehren und
 * hinterlaesst danach in einem read-only in die App eingebundenen Verzeichnis
 * einen atomaren Statusbeleg. Der Beleg enthaelt weder Repository-URL noch
 * Zugangsdaten und ist an Repository, Job-Tag und Aufbewahrungsregel gebunden.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RECEIPT_FORMAT = 'Betreuungsbuero-Offsite-Wartung/1';
const POLICY_FORMAT = 'Betreuungsbuero-Offsite-Wartungsregel/1';
const DEFAULT_MAX_AGE_HOURS = 8 * 24;
const MAX_RECEIPT_BYTES = 64 * 1024;

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function jobId(value) {
  const result = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(result)) {
    throw new Error('Die Offsite-Wartungsjob-Kennung ist ungültig.');
  }
  return result;
}

function jobTag(value) {
  const id = jobId(value);
  return 'bb-job-' + sha256(`job=${id}\n`).slice(0, 24);
}

function safeTag(value) {
  const result = String(value || 'betreuungsbuero').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(result)) {
    throw new Error('Der Offsite-Profil-Tag ist ungültig.');
  }
  return result;
}

function remoteRepository(value) {
  const result = String(value || '').trim();
  if (!/^(?:s3|sftp|rest|rclone|azure|gs|b2|swift):/i.test(result)) {
    throw new Error('Die Offsite-Wartung braucht ein entferntes restic-Repository.');
  }
  if (/[\0\r\n\t]/.test(result) || /\/\/[^/@:]+:[^/@]+@/.test(result)) {
    throw new Error('Das Offsite-Repository enthält unzulässige Zeichen oder eingebettete Zugangsdaten.');
  }
  return result;
}

function keepCount(value, fallback, max, label) {
  const raw = value === undefined || value === null || value === '' ? fallback : value;
  const result = Number(raw);
  if (!Number.isSafeInteger(result) || result < 0 || result > max) {
    throw new Error(`${label} muss eine ganze Zahl zwischen 0 und ${max} sein.`);
  }
  return result;
}

function normalizedPolicy(value) {
  const policy = value && typeof value === 'object' ? value : {};
  const result = {
    daily: keepCount(policy.daily, 14, 10000, 'Tägliche Generationen'),
    monthly: keepCount(policy.monthly, 12, 1200, 'Monatliche Generationen'),
    yearly: keepCount(policy.yearly, 10, 200, 'Jährliche Generationen')
  };
  if (!result.daily && !result.monthly && !result.yearly) {
    throw new Error('Die Offsite-Wartungsregel muss mindestens eine Generation behalten.');
  }
  return result;
}

function expectedIdentity(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const repository = remoteRepository(opts.repository);
  const id = jobId(opts.jobId);
  const tag = safeTag(opts.tag);
  const derivedJobTag = jobTag(id);
  const policy = normalizedPolicy(opts.policy || opts.retention);
  const repositoryFingerprint = sha256(`repository=${repository}\n`);
  const profileFingerprint = sha256(
    `repository=${repository}\ntag=${tag}\njob_tag=${derivedJobTag}\n`
  );
  const policyFingerprint = sha256(
    `format=${POLICY_FORMAT}\n`
      + `profile_sha=${profileFingerprint}\n`
      + `keep_daily=${policy.daily}\n`
      + `keep_monthly=${policy.monthly}\n`
      + `keep_yearly=${policy.yearly}\n`
  );
  return {
    repository,
    jobId: id,
    tag,
    jobTag: derivedJobTag,
    policy,
    repositoryFingerprint,
    profileFingerprint,
    policyFingerprint
  };
}

function receiptFileName(value) {
  const id = jobId(value);
  return `offsite-wartung-${sha256(`job=${id}\n`).slice(0, 32)}.json`;
}

function maxAgeHours(value) {
  const raw = value === undefined || value === null || value === ''
    ? DEFAULT_MAX_AGE_HOURS
    : value;
  const result = Number(raw);
  if (!Number.isFinite(result) || result < 1 || result > 24 * 365) {
    throw new Error('Die maximale Offsite-Wartungsbeleg-Alterung muss zwischen 1 und 8760 Stunden liegen.');
  }
  return result;
}

function stableReadJson(file) {
  const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(fd);
    const named = fs.lstatSync(file);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink()
        || opened.dev !== named.dev || opened.ino !== named.ino) {
      throw new Error('Der Wartungsbeleg ist keine unvertauschte reguläre Datei.');
    }
    if (process.platform !== 'win32' && (opened.mode & 0o777) !== 0o600) {
      throw new Error('Der Wartungsbeleg muss exakt mit Modus 0600 geschützt sein.');
    }
    if (opened.size < 2 || opened.size > MAX_RECEIPT_BYTES) {
      throw new Error('Der Wartungsbeleg hat eine unzulässige Größe.');
    }
    const text = fs.readFileSync(fd, 'utf8');
    const after = fs.fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || after.ctimeMs !== opened.ctimeMs) {
      throw new Error('Der Wartungsbeleg wurde während der Prüfung verändert.');
    }
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (_error) { throw new Error('Der Wartungsbeleg ist kein gültiges JSON.'); }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('Der Wartungsbeleg ist kein JSON-Objekt.');
    }
    return parsed;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function trustedStatusDirectory(directory) {
  const resolved = path.resolve(String(directory || ''));
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Das Wartungsstatusverzeichnis ist kein reguläres Verzeichnis.');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o022) !== 0) {
    throw new Error(
      'Das Wartungsstatusverzeichnis darf für Gruppe oder andere Nutzer nicht schreibbar sein.'
    );
  }
  fs.accessSync(resolved, fs.constants.R_OK | fs.constants.X_OK);
  return resolved;
}

function warning(status, code, message, extra) {
  return {
    configured: true,
    available: status !== 'missing',
    ok: false,
    status,
    warningCode: code,
    message,
    ...(extra || {})
  };
}

function inspectReceipt(options) {
  const opts = options && typeof options === 'object' ? options : {};
  let identity;
  try {
    identity = expectedIdentity(opts);
  } catch (error) {
    return warning(
      'invalid_configuration',
      'offsite_maintenance_invalid_configuration',
      String(error.message || error)
    );
  }
  const rawDir = String(opts.statusDir || '').trim();
  if (!rawDir || !path.isAbsolute(rawDir)) {
    return {
      configured: false,
      available: false,
      ok: false,
      status: 'not_configured',
      warningCode: 'offsite_maintenance_not_configured',
      message: 'Das read-only Statusverzeichnis der getrennten Offsite-Wartung ist nicht konfiguriert.',
      expected: {
        jobId: identity.jobId,
        jobTag: identity.jobTag,
        policyFingerprint: identity.policyFingerprint
      }
    };
  }
  let statusDir;
  try {
    statusDir = trustedStatusDirectory(rawDir);
  } catch (error) {
    return warning(
      'invalid',
      'offsite_maintenance_invalid',
      'Das Wartungsstatusverzeichnis ist keine geschützte Vertrauensgrenze: '
        + String(error.message || error)
    );
  }
  const receiptPath = path.join(statusDir, receiptFileName(identity.jobId));
  let receipt;
  try {
    receipt = stableReadJson(receiptPath);
  } catch (error) {
    const missing = error && error.code === 'ENOENT';
    return warning(
      missing ? 'missing' : 'invalid',
      missing ? 'offsite_maintenance_missing' : 'offsite_maintenance_invalid',
      missing
        ? 'Für die getrennte Offsite-Aufbewahrungswartung liegt noch kein Statusbeleg vor.'
        : 'Der Statusbeleg der getrennten Offsite-Wartung ist nicht sicher lesbar: '
          + String(error.message || error),
      { receiptPath }
    );
  }

  const exact = (
    receipt.format === RECEIPT_FORMAT
    && receipt.jobId === identity.jobId
    && receipt.jobTag === identity.jobTag
    && receipt.repositoryFingerprint === identity.repositoryFingerprint
    && receipt.profileFingerprint === identity.profileFingerprint
    && receipt.policyFingerprint === identity.policyFingerprint
    && receipt.policy && !Array.isArray(receipt.policy)
    && Number(receipt.policy.daily) === identity.policy.daily
    && Number(receipt.policy.monthly) === identity.policy.monthly
    && Number(receipt.policy.yearly) === identity.policy.yearly
    && /^[0-9a-f]{32}$/i.test(String(receipt.runId || ''))
    && (receipt.result === 'ok' || receipt.result === 'error')
    && Number.isSafeInteger(receipt.forgetPruneExitCode)
    && receipt.forgetPruneExitCode >= 0
    && Number.isSafeInteger(receipt.checkExitCode)
    && receipt.checkExitCode >= 0
  );
  if (!exact) {
    return warning(
      'mismatch',
      'offsite_maintenance_mismatch',
      'Der Offsite-Wartungsbeleg passt nicht eindeutig zu Repository, Job und aktueller Aufbewahrungsregel.',
      { receiptPath }
    );
  }

  const completedMs = Date.parse(String(receipt.completedAt || ''));
  const now = opts.now instanceof Date ? opts.now : new Date();
  const ageLimitHours = (() => {
    try { return maxAgeHours(opts.maxAgeHours); }
    catch (_error) { return DEFAULT_MAX_AGE_HOURS; }
  })();
  if (!Number.isFinite(completedMs)
      || completedMs > now.getTime() + 5 * 60 * 1000) {
    return warning(
      'invalid_time',
      'offsite_maintenance_invalid',
      'Der Offsite-Wartungsbeleg enthält keinen plausiblen Abschlusszeitpunkt.',
      { receiptPath }
    );
  }
  const ageHours = Math.max(0, (now.getTime() - completedMs) / 3600000);
  const common = {
    receiptPath,
    completedAt: new Date(completedMs).toISOString(),
    ageHours,
    maxAgeHours: ageLimitHours,
    runId: receipt.runId,
    jobTag: identity.jobTag,
    repositoryFingerprint: identity.repositoryFingerprint,
    profileFingerprint: identity.profileFingerprint,
    policyFingerprint: identity.policyFingerprint
  };
  if (receipt.result !== 'ok'
      || receipt.forgetPruneExitCode !== 0
      || receipt.checkExitCode !== 0) {
    return warning(
      'failed',
      'offsite_maintenance_failed',
      'Die getrennte Offsite-Wartung meldet einen Fehler bei forget/prune oder restic check.',
      common
    );
  }
  if (ageHours > ageLimitHours) {
    return warning(
      'overdue',
      'offsite_maintenance_overdue',
      `Die letzte erfolgreiche Offsite-Wartung ist älter als ${ageLimitHours} Stunden.`,
      common
    );
  }
  return {
    configured: true,
    available: true,
    ok: true,
    status: 'ok',
    warningCode: '',
    message: 'Die getrennte Offsite-Aufbewahrungswartung ist aktuell und erfolgreich.',
    ...common
  };
}

function configuredStatusDir(env) {
  const source = env || process.env;
  return String(source.TOTAL_BACKUP_OFFSITE_MAINTENANCE_STATUS_DIR || '').trim();
}

function configuredMaxAgeHours(env) {
  const source = env || process.env;
  return maxAgeHours(
    source.TOTAL_BACKUP_OFFSITE_MAINTENANCE_MAX_AGE_HOURS || DEFAULT_MAX_AGE_HOURS
  );
}

function preflightComponent(options) {
  const result = inspectReceipt(options);
  return {
    id: 'offsiteMaintenance',
    label: 'Getrennte Offsite-Aufbewahrungswartung',
    required: true,
    ok: result.ok,
    status: result.status,
    code: result.warningCode || 'ok',
    message: result.message,
    completedAt: result.completedAt || '',
    ageHours: Number.isFinite(result.ageHours) ? result.ageHours : null,
    maxAgeHours: Number.isFinite(result.maxAgeHours) ? result.maxAgeHours : null,
    jobTag: result.jobTag || (result.expected && result.expected.jobTag) || '',
    policyFingerprint: result.policyFingerprint
      || (result.expected && result.expected.policyFingerprint)
      || ''
  };
}

module.exports = {
  RECEIPT_FORMAT,
  POLICY_FORMAT,
  DEFAULT_MAX_AGE_HOURS,
  expectedIdentity,
  receiptFileName,
  inspectReceipt,
  preflightComponent,
  configuredStatusDir,
  configuredMaxAgeHours,
  _test: {
    sha256,
    jobId,
    jobTag,
    safeTag,
    remoteRepository,
    normalizedPolicy,
    stableReadJson,
    trustedStatusDirectory,
    maxAgeHours
  }
};
