'use strict';

/*
 * Nur lesende technische Vorprüfung für eine Online-Gesamtsicherung.
 *
 * Der eigentliche Sicherungslauf prüft alle Voraussetzungen nochmals
 * fail-closed. Diese Vorprüfung dient ausschließlich dazu, dem Administrator
 * schon vor dem Aktivieren eines Zeitplans wahrheitsgemäß zu zeigen, welche
 * Bausteine fehlen. Geheimnisinhalte und Ausgaben externer Werkzeuge werden
 * dabei nie an den Browser zurückgegeben.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const totalBackupRunner = require('./runner');
const { runtimeEnvironment, resticEnvironment } = require('../../config/restic-environment');
const {
  SERVER_ROOT,
  DATA_ROOT,
  DATABASE_PATH,
  OUTPUTS_ROOT
} = require('../../config/paths');

const REQUIRED_SERVER_FILES = Object.freeze([
  'index.js',
  path.join('src', 'database', 'index.js'),
  path.join('src', 'modules', 'backup', 'portable-data.js'),
  path.join('src', 'security', 'secure-json.js'),
  path.join('src', 'security', 'crypto.js'),
  'package.json',
  'package-lock.json',
  'Dockerfile',
  'docker-compose.yml',
  '.dockerignore',
  '.env.example',
  path.join('tools', 'gesamt-backup.sh'),
  path.join('tools', 'notfall-rettung.sh'),
  path.join('tools', 'gesamt-restore.sh'),
  path.join('tools', 'verify-recovery-envelope.js'),
  path.join('tools', 'verify-portable-recovery-revision.js'),
  path.join('docs', 'NOTFALL-KURZANLEITUNG.txt'),
  path.join('docs', 'NOTFALL-WIEDERHERSTELLUNG.txt')
]);

const REQUIRED_LOCAL_COMMANDS = Object.freeze([
  'bash', 'dirname', 'cat', 'mkdir', 'rmdir', 'chmod',
  'tar', 'find', 'wc', 'od', 'tr', 'date', 'mktemp', 'mv', 'cp', 'cmp',
  'awk', 'sed', 'cut', 'head', 'df', 'du', 'grep', 'sort', 'rm', 'sync',
  'uname', 'stat', 'ps', 'node', 'env', 'gzip'
]);

const EXECUTABLE_SERVER_FILES = new Set([
  path.join('tools', 'gesamt-backup.sh'),
  path.join('tools', 'gesamt-restore.sh'),
  path.join('tools', 'notfall-rettung.sh')
]);

function safeFileStatus(file, kind, label, accessMode) {
  const resolved = path.resolve(String(file || ''));
  try {
    const stat = fs.lstatSync(resolved);
    const valid = !stat.isSymbolicLink()
      && (kind === 'directory' ? stat.isDirectory() : stat.isFile());
    if (valid) {
      fs.accessSync(
        resolved,
        accessMode === undefined
          ? (kind === 'directory'
            ? fs.constants.R_OK | fs.constants.X_OK
            : fs.constants.R_OK)
          : accessMode
      );
    }
    return {
      path: resolved,
      valid,
      error: valid ? '' : `${label} ist keine reguläre ${kind === 'directory' ? 'Ordnerstruktur' : 'Datei'}.`
    };
  } catch (error) {
    return {
      path: resolved,
      valid: false,
      error: `${label} fehlt oder ist nicht sicher lesbar.`
    };
  }
}

function protectedSecretStatus(file, label) {
  const resolved = path.resolve(String(file || ''));
  const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
  let descriptor;
  try {
    if (!path.isAbsolute(String(file || ''))) {
      throw new Error(`${label} braucht einen absoluten Pfad.`);
    }
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
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
    return { configured: true, valid: true, path: resolved, error: '' };
  } catch (error) {
    return {
      configured: !!String(file || '').trim(),
      valid: false,
      path: resolved,
      error: error && error.message
        ? error.message
        : `${label} fehlt oder kann nicht sicher geöffnet werden.`
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function commandStatus(command, args, options) {
  const opt = options || {};
  const spawnFn = opt.spawnFn || spawn;
  const timeoutMs = Number.isSafeInteger(opt.timeoutMs) ? opt.timeoutMs : 10000;
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    try {
      child = spawnFn(command, args, {
        stdio: Object.prototype.hasOwnProperty.call(opt, 'input')
          ? ['pipe', 'ignore', 'ignore']
          : ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
        shell: false,
        // Restic kann für sftp/rclone Enkelprozesse starten. Eine eigene
        // Prozessgruppe stellt sicher, dass die kurze Vorprüfung bei ihrer
        // Deadline nicht nur den wartenden Elternprozess beendet.
        detached: process.platform !== 'win32',
        env: opt.env || runtimeEnvironment(opt.baseEnvironment || process.env)
      });
    } catch (_error) {
      finish({ available: false, valid: false, error: `${command} konnte nicht gestartet werden.` });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(opt, 'input') && child.stdin) {
      child.stdin.on('error', () => { /* close/error liefert das Ergebnis */ });
      child.stdin.end(String(opt.input));
    }
    timer = setTimeout(() => {
      if (process.platform !== 'win32'
          && Number.isInteger(child && child.pid) && child.pid > 0) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (_error) {
          try { child.kill('SIGKILL'); } catch (_childError) { /* Ergebnis unten */ }
        }
      } else {
        try { child.kill('SIGKILL'); } catch (_error) { /* Ergebnis unten */ }
      }
      finish({
        available: true,
        valid: false,
        error: `${command} hat die Zeitgrenze der Vorprüfung überschritten.`
      });
    }, timeoutMs);
    child.once('error', (error) => {
      finish({
        available: error && error.code !== 'ENOENT',
        valid: false,
        error: error && error.code === 'ENOENT'
          ? `${command} ist nicht installiert oder nicht im PATH.`
          : `${command} konnte nicht ausgeführt werden.`
      });
    });
    child.once('close', (code, signal) => {
      finish({
        available: true,
        valid: code === 0,
        error: code === 0
          ? ''
          : `${command} beendete die Vorprüfung mit ${signal ? `Signal ${signal}` : `Code ${String(code)}`}.`
      });
    });
  });
}

function executableStatus(command, options) {
  const opt = options || {};
  const environment = runtimeEnvironment(opt.baseEnvironment || process.env);
  const searchPath = String(environment.PATH || '');
  const extensions = process.platform === 'win32'
    ? String(environment.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.resolve(directory, command + extension);
      try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        fs.accessSync(
          candidate,
          process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK
        );
        return { available: true, valid: true, command, path: candidate, error: '' };
      } catch (_error) { /* nächster PATH-Eintrag */ }
    }
  }
  return {
    available: false,
    valid: false,
    command,
    path: '',
    error: `Das für die Gesamtsicherung benötigte Werkzeug ${command} fehlt im PATH.`
  };
}

async function localToolReadiness(options) {
  const opt = options || {};
  const commands = REQUIRED_LOCAL_COMMANDS.map((command) => executableStatus(command, opt));
  const shaCandidates = [
    executableStatus('shasum', opt),
    executableStatus('sha256sum', opt)
  ];
  const sha256 = shaCandidates.find((entry) => entry.valid) || {
    available: false,
    valid: false,
    command: 'shasum|sha256sum',
    path: '',
    error: 'Weder shasum noch sha256sum ist für die Gesamtsicherung verfügbar.'
  };
  const base64Executable = executableStatus('base64', opt);
  let base64 = base64Executable;
  if (base64Executable.valid) {
    const gnu = await commandStatus('base64', ['-d'], { ...opt, input: 'Zg==' });
    if (gnu.valid) {
      base64 = { ...base64Executable, decodeFlag: '-d' };
    } else {
      const bsd = await commandStatus('base64', ['-D'], { ...opt, input: 'Zg==' });
      base64 = bsd.valid
        ? { ...base64Executable, decodeFlag: '-D' }
        : {
          ...base64Executable,
          valid: false,
          error: 'base64 ist vorhanden, unterstützt aber weder -d noch -D zum Dekodieren.'
        };
    }
  }
  const errors = [
    ...commands.filter((entry) => !entry.valid).map((entry) => entry.error),
    ...(sha256.valid ? [] : [sha256.error]),
    ...(base64.valid ? [] : [base64.error])
  ];
  return {
    ready: errors.length === 0,
    commands,
    sha256,
    base64,
    errors
  };
}

function recoveryReadiness(status) {
  const value = status && typeof status === 'object' ? status : {};
  const security = value.snapshots && value.snapshots['security-encrypted'];
  const credentials = value.snapshots && value.snapshots['credentials-encrypted'];
  const matchingPair = !!(
    security && credentials && security.verified && credentials.verified
    && security.generationId && security.generationId === credentials.generationId
    && security.sourceRevision && security.sourceRevision === credentials.sourceRevision
  );
  const ready = !!(
    value.configured && value.strong && !value.requiresRotation
    && value.snapshotsVerified && matchingPair
  );
  const errors = [];
  if (!value.configured) errors.push('Der Wiederherstellungsschlüssel ist nicht eingerichtet.');
  else if (!value.strong || value.requiresRotation) {
    errors.push('Der Wiederherstellungsschlüssel ist ein schwacher Legacy-Schlüssel und muss rotiert werden.');
  }
  if (!security || !security.verified) {
    errors.push((security && security.error) || 'Sicherheit.json.enc ist nicht aktuell und verifiziert.');
  }
  if (!credentials || !credentials.verified) {
    errors.push((credentials && credentials.error) || 'Zugangsdaten.json.enc ist nicht aktuell und verifiziert.');
  }
  if (security && credentials && security.verified && credentials.verified && !matchingPair) {
    errors.push('Sicherheits- und Zugangsdatenabbild bilden keine gemeinsame aktuelle Generation.');
  }
  return {
    ready,
    key: {
      configured: !!value.configured,
      strong: !!value.strong,
      requiresRotation: !!value.requiresRotation,
      keyId: String(value.keyId || ''),
      fingerprint: String(value.fingerprint || '')
    },
    pair: {
      verified: matchingPair,
      generationId: matchingPair ? String(security.generationId) : '',
      sourceRevision: matchingPair ? String(security.sourceRevision) : ''
    },
    snapshots: {
      security: security || null,
      credentials: credentials || null
    },
    errors
  };
}

function runtimeInventory(options) {
  const opt = options || {};
  const serverDir = path.resolve(String(opt.serverDir || SERVER_ROOT));
  const dataDir = path.resolve(String(opt.dataDir || DATA_ROOT));
  const dbPath = path.resolve(String(opt.dbPath || DATABASE_PATH));
  const outputsDir = path.resolve(String(opt.outputsDir || OUTPUTS_ROOT));
  const appName = String(opt.appName || 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
  const files = REQUIRED_SERVER_FILES.map((relative) => ({
    name: relative,
    ...safeFileStatus(
      path.join(serverDir, relative),
      'file',
      `Pflichtquelle ${relative}${EXECUTABLE_SERVER_FILES.has(relative) ? ' (lesbar und ausführbar)' : ''}`,
      EXECUTABLE_SERVER_FILES.has(relative)
        ? fs.constants.R_OK | fs.constants.X_OK
        : fs.constants.R_OK
    )
  }));
  const directories = [
    { name: 'data', ...safeFileStatus(dataDir, 'directory', 'Anwendungs-Datenverzeichnis') },
    {
      name: 'assets/templates',
      ...safeFileStatus(path.join(serverDir, 'assets', 'templates'), 'directory', 'Vorlagenordner')
    }
  ];
  const database = safeFileStatus(dbPath, 'file', 'SQLite-Datenbank');
  const appFile = safeFileStatus(path.join(outputsDir, appName), 'file', 'Ausgelieferte App-Datei');
  const errors = [
    ...files.filter((entry) => !entry.valid).map((entry) => entry.error),
    ...directories.filter((entry) => !entry.valid).map((entry) => entry.error),
    ...(database.valid ? [] : [database.error]),
    ...(appFile.valid ? [] : [appFile.error])
  ];
  return {
    ready: errors.length === 0,
    serverDir,
    dataDir,
    dbPath,
    files,
    directories,
    database,
    appFile,
    errors
  };
}

async function remoteReadiness(offsite, options) {
  const value = offsite && typeof offsite === 'object' ? offsite : {};
  if (!value.enabled) {
    return {
      enabled: false,
      ready: false,
      tool: { available: false, valid: false, error: 'Die Offsite-Zweitkopie ist nicht aktiviert.' },
      repository: { configured: false, reachable: false, error: 'Die Offsite-Zweitkopie ist nicht aktiviert.' },
      credentialFile: { configured: false, valid: true, error: '' },
      errors: ['Die verschlüsselte Offsite-Zweitkopie ist nicht aktiviert.']
    };
  }
  const opt = options || {};
  const baseEnvironment = opt.baseEnvironment || process.env;
  const passwordFile = protectedSecretStatus(
    value.passwordFile,
    'Die restic-Passwortdatei'
  );
  const tool = await commandStatus('restic', ['version'], {
    ...opt,
    env: resticEnvironment({}, baseEnvironment)
  });
  let credentialFile = { configured: false, valid: true, error: '' };
  let credentialEnv = {};
  const credentialPath = String(
    opt.resticCredentialEnvFile || process.env.TOTAL_BACKUP_RESTIC_ENV_FILE || ''
  ).trim();
  if (credentialPath) {
    try {
      const parsed = totalBackupRunner._test.resticCredentialEnvironment(credentialPath);
      credentialFile = { configured: true, valid: true, path: parsed.file, error: '' };
      credentialEnv = parsed.env;
    } catch (error) {
      credentialFile = {
        configured: true,
        valid: false,
        path: path.resolve(credentialPath),
        error: error.message || String(error)
      };
    }
  }
  let repository = {
    configured: !!String(value.repository || '').trim(),
    reachable: false,
    error: ''
  };
  if (!passwordFile.valid) {
    repository.error = 'Das Repository wurde wegen einer unsicheren restic-Passwortdatei nicht geprüft.';
  } else if (!tool.valid) repository.error = 'Das Repository wurde nicht geprüft, weil restic nicht verfügbar ist.';
  else if (!credentialFile.valid) repository.error = 'Das Repository wurde wegen ungültiger Provider-Credentials nicht geprüft.';
  else {
    const env = resticEnvironment(credentialEnv, baseEnvironment);
    const probe = await commandStatus('restic', [
      '-r', String(value.repository || ''),
      '--password-file', String(value.passwordFile || ''),
      'cat', 'config'
    ], { ...opt, env });
    repository = {
      configured: true,
      reachable: probe.valid,
      error: probe.error
    };
  }
  const errors = [];
  if (!passwordFile.valid) errors.push(passwordFile.error);
  if (!tool.valid) errors.push(tool.error);
  if (!credentialFile.valid) errors.push(credentialFile.error);
  if (!repository.reachable) errors.push(repository.error || 'Das Remote-Repository ist nicht lesbar.');
  return {
    enabled: true,
    ready: passwordFile.valid && tool.valid && credentialFile.valid && repository.reachable,
    tool,
    repository,
    passwordFile,
    credentialFile,
    errors: errors.filter(Boolean)
  };
}

async function inspect(options) {
  const opt = options || {};
  const runtime = runtimeInventory(opt);
  const sqlite = await commandStatus('sqlite3', ['--version'], opt);
  const tools = await localToolReadiness(opt);
  const recovery = recoveryReadiness(opt.recoveryStatus);
  const remote = await remoteReadiness(opt.offsite, opt);
  const localErrors = [
    ...runtime.errors,
    ...(sqlite.valid ? [] : [sqlite.error]),
    ...tools.errors
  ];
  const local = {
    ready: runtime.ready && sqlite.valid && tools.ready,
    runtime,
    sqlite,
    tools,
    errors: localErrors
  };
  return {
    local,
    recovery,
    remote,
    localReady: local.ready,
    recoveryReady: recovery.ready,
    remoteReady: remote.ready,
    technicalReady: local.ready && recovery.ready && remote.ready
  };
}

module.exports = {
  inspect,
  _test: {
    REQUIRED_SERVER_FILES,
    REQUIRED_LOCAL_COMMANDS,
    EXECUTABLE_SERVER_FILES,
    safeFileStatus,
    protectedSecretStatus,
    commandStatus,
    executableStatus,
    localToolReadiness,
    recoveryReadiness,
    runtimeInventory,
    remoteReadiness
  }
};
