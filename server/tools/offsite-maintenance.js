#!/usr/bin/env node
'use strict';

/*
 * Getrennte Restic-Aufbewahrungswartung.
 *
 * Dieses Programm gehoert NICHT in den normalen App-/Backup-Container. Es
 * benoetigt ein kurzlebiges Backend-Konto mit List-/Delete-Rechten. Die App
 * erhaelt davon weder Pfad noch Inhalt; sie liest ausschliesslich den atomaren
 * Statusbeleg aus einem read-only Mount.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const {
  RECEIPT_FORMAT,
  expectedIdentity,
  receiptFileName
} = require('../src/modules/backup/offsite-maintenance-status');
const { _test: backupInternals } = require('../src/modules/backup/runner');
const { runtimeEnvironment, resticEnvironment } = require('../src/config/restic-environment');

const DEFAULT_RESTIC_TIMEOUT_SECONDS = 6 * 60 * 60;
const MAX_RESTIC_TIMEOUT_SECONDS = 24 * 60 * 60;
const LOCK_FORMAT = 'Betreuungsbuero-Offsite-Wartungslock/1';
const LOCK_GRACE_MS = 15 * 60 * 1000;

function usage() {
  process.stdout.write(
    'Aufruf:\n'
    + '  offsite-maintenance.sh --repository REMOTE --password-file DATEI\\\n\n'
    + '    [--credential-env-file DATEI] --status-dir ORDNER --job-id ID\\\n\n'
    + '    [--tag TEXT] --keep-daily N --keep-monthly N --keep-yearly N\\\n\n'
    + '    [--timeout-seconds N]\n\n'
    + 'Falls eine Credential-Datei nötig ist, darf sie nur freigegebene\n'
    + 'Provider-Variablen enthalten, muss Modus 0600 besitzen und wird niemals\n'
    + 'in den Statusbeleg geschrieben. SFTP und nicht authentifiziertes REST\n'
    + 'können die Option auslassen.\n'
  );
}

function parse(argv) {
  const result = Object.create(null);
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--help' || key === '-h') {
      result.help = true;
      continue;
    }
    const map = {
      '--repository': 'repository',
      '--password-file': 'passwordFile',
      '--credential-env-file': 'credentialEnvFile',
      '--status-dir': 'statusDir',
      '--job-id': 'jobId',
      '--tag': 'tag',
      '--keep-daily': 'daily',
      '--keep-monthly': 'monthly',
      '--keep-yearly': 'yearly',
      '--restic-bin': 'resticBin',
      '--timeout-seconds': 'timeoutSeconds'
    };
    const name = map[key];
    if (!name) throw new Error(`Unbekanntes Argument: ${key}`);
    if (i + 1 >= argv.length) throw new Error(`${key} braucht einen Wert.`);
    if (Object.prototype.hasOwnProperty.call(result, name)) {
      throw new Error(`${key} wurde mehrfach angegeben.`);
    }
    result[name] = argv[++i];
  }
  return result;
}

function resticTimeoutMs(value) {
  const raw = value === undefined || value === null || value === ''
    ? DEFAULT_RESTIC_TIMEOUT_SECONDS
    : Number(value);
  if (!Number.isSafeInteger(raw) || raw < 1 || raw > MAX_RESTIC_TIMEOUT_SECONDS) {
    throw new Error(
      `Die Restic-Zeitgrenze muss zwischen 1 und ${MAX_RESTIC_TIMEOUT_SECONDS} Sekunden liegen.`
    );
  }
  return raw * 1000;
}

function protectedRegularFile(file, label) {
  const resolved = path.resolve(String(file || ''));
  if (!path.isAbsolute(String(file || ''))) {
    throw new Error(`${label} braucht einen absoluten Pfad.`);
  }
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
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function statusDirectory(value) {
  const raw = String(value || '');
  if (!path.isAbsolute(raw)) {
    throw new Error('Das Statusverzeichnis braucht einen absoluten Pfad.');
  }
  const resolved = path.resolve(raw);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Das Statusverzeichnis ist kein reguläres Verzeichnis.');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700) {
    throw new Error('Das Statusverzeichnis muss exakt mit Modus 0700 geschützt sein.');
  }
  fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  return resolved;
}

function fsyncDirectory(directory) {
  let fd;
  try {
    fd = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function atomicReceipt(file, value) {
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  let fd;
  try {
    fd = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600
    );
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
    fsyncDirectory(directory);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (_ignore) { /* best effort */ }
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function exitCode(result) {
  if (result && Number.isSafeInteger(result.status) && result.status >= 0) return result.status;
  return 127;
}

function runRestic(binary, args, env, timeoutMs) {
  const supervisor = path.join(__dirname, 'restic-process-supervisor.js');
  const result = spawnSync(process.execPath, [
    supervisor,
    String(timeoutMs),
    String(binary),
    ...args
  ], {
    env,
    // fd 3 ist ein kleiner, strukturierter Ergebniskanal. Restic selbst
    // schreibt weiterhin direkt auf stdout/stderr und kann den Kanal nicht
    // erben. Der Supervisor startet Restic unter POSIX in einer eigenen
    // Prozessgruppe und beendet bei Zeitüberschreitung auch Kinder und Enkel.
    stdio: ['ignore', 'inherit', 'inherit', 'pipe'],
    shell: false,
    windowsHide: true,
    timeout: timeoutMs + 10000,
    killSignal: 'SIGKILL'
  });
  const supervisorTimedOut = !!(
    result && result.error
    && (result.error.code === 'ETIMEDOUT' || result.error.errno === 'ETIMEDOUT')
  );
  if (supervisorTimedOut) {
    return {
      code: 124,
      signal: String(result && result.signal || ''),
      error: 'Der Restic-Prozessgruppen-Supervisor hat seine Sicherheitsfrist überschritten.',
      timedOut: true
    };
  }
  if (result && result.error) {
    return {
      code: 127,
      signal: String(result.signal || ''),
      error: String(result.error.message || result.error),
      timedOut: false
    };
  }
  if (exitCode(result) !== 0) {
    return {
      code: 127,
      signal: String(result && result.signal || ''),
      error: 'Der Restic-Prozessgruppen-Supervisor wurde unerwartet beendet.',
      timedOut: false
    };
  }

  const raw = result && result.output && result.output[3]
    ? String(result.output[3]).trim()
    : '';
  let supervised;
  try {
    supervised = JSON.parse(raw);
  } catch (_error) {
    return {
      code: 127,
      signal: '',
      error: 'Der Restic-Prozessgruppen-Supervisor lieferte kein gültiges Ergebnis.',
      timedOut: false
    };
  }
  if (!supervised || typeof supervised !== 'object'
      || !Number.isSafeInteger(supervised.code) || supervised.code < 0
      || typeof supervised.signal !== 'string'
      || typeof supervised.error !== 'string'
      || typeof supervised.timedOut !== 'boolean'
      || (supervised.timedOut && supervised.code !== 124)) {
    return {
      code: 127,
      signal: '',
      error: 'Der Restic-Prozessgruppen-Supervisor lieferte ein unzulässiges Ergebnis.',
      timedOut: false
    };
  }
  return {
    code: supervised.code,
    signal: supervised.signal,
    error: supervised.error,
    timedOut: supervised.timedOut
  };
}

function readLock(lockFile) {
  const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
  let fd;
  try {
    fd = fs.openSync(lockFile, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(fd);
    const named = fs.lstatSync(lockFile);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink()
        || opened.dev !== named.dev || opened.ino !== named.ino) {
      throw new Error('Der Wartungs-Lock ist keine unvertauschte reguläre Datei.');
    }
    if (process.platform !== 'win32' && (opened.mode & 0o777) !== 0o600) {
      throw new Error('Der Wartungs-Lock muss exakt mit Modus 0600 geschützt sein.');
    }
    if (opened.size < 2 || opened.size > 4096) {
      throw new Error('Der Wartungs-Lock hat eine unzulässige Größe.');
    }
    const text = fs.readFileSync(fd, 'utf8');
    const after = fs.fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || after.ctimeMs !== opened.ctimeMs) {
      throw new Error('Der Wartungs-Lock wurde während der Prüfung verändert.');
    }
    let value;
    try { value = JSON.parse(text); }
    catch (_error) { throw new Error('Der Wartungs-Lock ist kein gültiges JSON.'); }
    const pid = Number(value && value.pid);
    const startedMs = Date.parse(String(value && value.startedAt || ''));
    if (!value || value.format !== LOCK_FORMAT
        || !Number.isSafeInteger(pid) || pid < 1
        || !Number.isFinite(startedMs)
        || !/^[0-9a-f]{32}$/i.test(String(value.token || ''))) {
      throw new Error('Der Wartungs-Lock enthält keine gültige Eigentümerkennung.');
    }
    return {
      dev: opened.dev,
      ino: opened.ino,
      pid,
      startedMs,
      token: String(value.token)
    };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') return false;
    return true;
  }
}

function staleLockReason(lock, nowMs, maximumOwnerAgeMs) {
  const ageMs = nowMs - lock.startedMs;
  if (!Number.isFinite(ageMs) || ageMs < -5 * 60 * 1000) return '';
  if (!processExists(lock.pid)) return 'owner_missing';
  if (ageMs > maximumOwnerAgeMs) return 'maximum_age_exceeded';
  return '';
}

function quarantineStaleLock(lockFile, lock) {
  const quarantine = `${lockFile}.stale.${process.pid}.${crypto.randomBytes(8).toString('hex')}`;
  fs.renameSync(lockFile, quarantine);
  try {
    const moved = fs.lstatSync(quarantine);
    if (!moved.isFile() || moved.isSymbolicLink()
        || moved.dev !== lock.dev || moved.ino !== lock.ino) {
      throw new Error('Der Wartungs-Lock wurde beim Übernehmen ausgetauscht.');
    }
    fs.unlinkSync(quarantine);
    fsyncDirectory(path.dirname(lockFile));
  } catch (error) {
    try {
      if (!fs.existsSync(lockFile) && fs.existsSync(quarantine)) {
        fs.renameSync(quarantine, lockFile);
      }
    } catch (_rollbackError) { /* fail-closed: Artefakt bleibt sichtbar */ }
    throw error;
  }
}

function publishLock(lockFile, startedAt, token, hooks) {
  const directory = path.dirname(lockFile);
  const candidate = path.join(
    directory,
    `.${path.basename(lockFile)}.${process.pid}.`
      + `${crypto.randomBytes(8).toString('hex')}.candidate`
  );
  let fd;
  let candidateStat;
  let linked = false;
  try {
    fd = fs.openSync(
      candidate,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600
    );
    if (process.platform !== 'win32') fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, JSON.stringify({
      format: LOCK_FORMAT,
      pid: process.pid,
      startedAt,
      token
    }) + '\n');
    fs.fsyncSync(fd);
    candidateStat = fs.fstatSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    if (hooks && typeof hooks.afterCandidateFsync === 'function') {
      hooks.afterCandidateFsync(candidate);
    }

    // hard-link(2) veröffentlicht den bereits vollständig geschriebenen und
    // fsync-ten Kandidaten atomar, überschreibt aber niemals einen fremden
    // Lock. Ein Absturz kann deshalb nur "kein Lock" oder einen vollständig
    // lesbaren Lock hinterlassen, nie teilweise geschriebenes JSON.
    fs.linkSync(candidate, lockFile);
    linked = true;
    fsyncDirectory(directory);

    const published = fs.lstatSync(lockFile);
    if (!published.isFile() || published.isSymbolicLink()
        || published.dev !== candidateStat.dev || published.ino !== candidateStat.ino) {
      throw new Error('Der Wartungs-Lock wurde beim atomaren Veröffentlichen ausgetauscht.');
    }

    if (hooks && typeof hooks.afterLinkFsync === 'function') {
      hooks.afterLinkFsync(candidate);
    }

    fs.unlinkSync(candidate);
    fsyncDirectory(directory);
    return { dev: published.dev, ino: published.ino, token };
  } catch (error) {
    // Nur der eindeutig eigene Kandidat darf aufgeräumt werden. Sobald der
    // finale Name verlinkt wurde, bleibt er bei jedem Folgefehler fail-closed
    // sichtbar; insbesondere wird niemals ein möglicherweise fremder Lock
    // entfernt.
    try { fs.unlinkSync(candidate); } catch (_ignore) { /* best effort */ }
    if (!linked) {
      try { fsyncDirectory(directory); } catch (_ignore) { /* best effort */ }
    }
    throw error;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_ignore) { /* best effort */ }
    }
  }
}

function acquireLock(lockFile, startedAt, maximumOwnerAgeMs, hooks) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = crypto.randomBytes(16).toString('hex');
    try {
      return publishLock(lockFile, startedAt, token, hooks);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      const existing = readLock(lockFile);
      const reason = staleLockReason(existing, Date.now(), maximumOwnerAgeMs);
      if (!reason) {
        const active = new Error('Eine Offsite-Wartung läuft bereits; der Lock bleibt unverändert.');
        active.code = 'EEXIST';
        throw active;
      }
      try {
        quarantineStaleLock(lockFile, existing);
      } catch (takeoverError) {
        if (takeoverError && takeoverError.code === 'ENOENT') continue;
        throw takeoverError;
      }
    }
  }
  throw new Error('Der verwaiste Wartungs-Lock konnte nicht eindeutig übernommen werden.');
}

function releaseLock(lockFile, ownership) {
  if (!lockFile || !ownership) return;
  const current = fs.lstatSync(lockFile);
  if (!current.isFile() || current.isSymbolicLink()
      || current.dev !== ownership.dev || current.ino !== ownership.ino) {
    throw new Error('Der Wartungs-Lock gehört inzwischen einem anderen Lauf.');
  }
  fs.unlinkSync(lockFile);
  fsyncDirectory(path.dirname(lockFile));
}

function main(argv) {
  let input;
  try { input = parse(argv); }
  catch (error) {
    process.stderr.write(`offsite-maintenance: ${error.message || error}\n`);
    return 64;
  }
  if (input.help) {
    usage();
    return 0;
  }

  let identity;
  let outputFile = '';
  let startedAt = new Date().toISOString();
  let lockFile = '';
  let lockOwnership = null;
  let forgetResult = { code: 125, signal: '', error: 'nicht gestartet' };
  let checkResult = { code: 125, signal: '', error: 'nicht gestartet' };
  let step = 'configuration';
  try {
    identity = expectedIdentity({
      repository: input.repository,
      jobId: input.jobId,
      tag: input.tag,
      policy: {
        daily: input.daily,
        monthly: input.monthly,
        yearly: input.yearly
      }
    });
    const statusDir = statusDirectory(input.statusDir);
    outputFile = path.join(statusDir, receiptFileName(identity.jobId));
    lockFile = `${outputFile}.lock`;
    const timeoutMs = resticTimeoutMs(input.timeoutSeconds);
    // Ein Lauf umfasst maximal zwei Restic-Aufrufe. Nach zweimaliger
    // Zeitgrenze plus Sicherheitsabstand kann auch eine wiederverwendete PID
    // nicht mehr zu diesem Lock gehören.
    lockOwnership = acquireLock(lockFile, startedAt, (2 * timeoutMs) + LOCK_GRACE_MS);

    const passwordFile = protectedRegularFile(
      input.passwordFile,
      'Die Restic-Passwortdatei der Wartung'
    );
    let credentialData = { env: {} };
    if (String(input.credentialEnvFile || '').trim()) {
      const credentialFile = protectedRegularFile(
        input.credentialEnvFile,
        'Die Restic-Backend-Credential-Datei der Wartung'
      );
      credentialData = backupInternals.resticCredentialEnvironment(credentialFile);
    }
    const resticBin = String(input.resticBin || 'restic');
    if (/[\/\\]/.test(resticBin) && !path.isAbsolute(resticBin)) {
      throw new Error('Ein expliziter restic-Pfad muss absolut sein.');
    }
    // Ein versehentlich gesetztes App-Geheimnis darf nicht in restic gelangen.
    // Backend-Rechte kommen aus der expliziten, geschützten
    // Wartungs-Credential-Datei; nur freigegebene Laufzeit-/Providerwerte
    // werden an den Kindprozess weitergereicht.
    // Runtime-Pfade, CA/Proxy und SSH-Agent kommen nur aus der allgemeinen
    // Positivliste. Provider-Rechte kommen dagegen ausschließlich aus der
    // expliziten Maintenance-Datei, niemals aus der App-/Aufruferumgebung.
    const env = resticEnvironment(
      credentialData.env,
      runtimeEnvironment(process.env)
    );

    const common = ['-r', identity.repository, '--password-file', passwordFile];
    const forget = [
      ...common,
      'forget',
      '--tag', identity.jobTag,
      '--group-by', 'tags'
    ];
    if (identity.policy.daily) forget.push('--keep-daily', String(identity.policy.daily));
    if (identity.policy.monthly) forget.push('--keep-monthly', String(identity.policy.monthly));
    if (identity.policy.yearly) forget.push('--keep-yearly', String(identity.policy.yearly));
    forget.push('--prune');

    step = 'forget_prune';
    forgetResult = runRestic(resticBin, forget, env, timeoutMs);
    step = 'check';
    checkResult = runRestic(resticBin, [...common, 'check'], env, timeoutMs);
    step = 'receipt';

    const ok = forgetResult.code === 0 && checkResult.code === 0;
    atomicReceipt(outputFile, {
      format: RECEIPT_FORMAT,
      runId: crypto.randomBytes(16).toString('hex'),
      result: ok ? 'ok' : 'error',
      jobId: identity.jobId,
      jobTag: identity.jobTag,
      repositoryFingerprint: identity.repositoryFingerprint,
      profileFingerprint: identity.profileFingerprint,
      policyFingerprint: identity.policyFingerprint,
      policy: identity.policy,
      startedAt,
      completedAt: new Date().toISOString(),
      forgetPruneExitCode: forgetResult.code,
      checkExitCode: checkResult.code,
      failedStep: ok
        ? ''
        : (forgetResult.timedOut
          ? 'forget_prune_timeout'
          : (checkResult.timedOut ? 'check_timeout' : (forgetResult.code ? 'forget_prune' : 'check')))
    });
    process.stdout.write(
      `OFFSITE_MAINTENANCE=${ok ? 'OK' : 'FEHLER'} `
      + `JOB_TAG=${identity.jobTag} POLICY_SHA=${identity.policyFingerprint}\n`
    );
    return ok ? 0 : 2;
  } catch (error) {
    if (identity && outputFile && lockOwnership) {
      try {
        atomicReceipt(outputFile, {
          format: RECEIPT_FORMAT,
          runId: crypto.randomBytes(16).toString('hex'),
          result: 'error',
          jobId: identity.jobId,
          jobTag: identity.jobTag,
          repositoryFingerprint: identity.repositoryFingerprint,
          profileFingerprint: identity.profileFingerprint,
          policyFingerprint: identity.policyFingerprint,
          policy: identity.policy,
          startedAt,
          completedAt: new Date().toISOString(),
          forgetPruneExitCode: forgetResult.code,
          checkExitCode: checkResult.code,
          failedStep: step
        });
      } catch (_receiptError) {
        // Der primaere Fehler bleibt sichtbar; ein fehlender/staler Beleg wird
        // unabhaengig durch die App-Ueberwachung gemeldet.
      }
    }
    process.stderr.write(`offsite-maintenance: ${String(error.message || error)}\n`);
    return 70;
  } finally {
    if (lockFile && lockOwnership) {
      try {
        releaseLock(lockFile, lockOwnership);
      } catch (_ignore) {
        // Ein fremder/ausgetauschter Lock wird niemals entfernt. Ein eigener
        // Rest bleibt beim nächsten Lauf anhand PID und Alter wiederaufnehmbar.
      }
    }
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  main,
  _test: {
    parse,
    protectedRegularFile,
    statusDirectory,
    atomicReceipt,
    runRestic,
    exitCode,
    resticTimeoutMs,
    readLock,
    staleLockReason,
    publishLock,
    acquireLock,
    releaseLock
  }
};
