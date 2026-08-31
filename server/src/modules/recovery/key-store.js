'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_ROOT, RUNTIME_SECRETS_ROOT } = require('../../config/paths');
const secureJson = require('../../security/secure-json');

const DEFAULT_DIRECTORY = RUNTIME_SECRETS_ROOT;
const DEFAULT_FILE = path.join(DEFAULT_DIRECTORY, 'document-recovery-key');
const METADATA_FORMAT = 'Betreuungsbuero-Recovery-Key/1';
const PENDING_FORMAT = 'Betreuungsbuero-Recovery-Key-Pending/1';
const MINIMUM_EXISTING_LENGTH = 16;
const MINIMUM_NEW_LENGTH = 43;
const MAXIMUM_LENGTH = 4096;

function configuredFilePath(env) {
  const raw = String((env || process.env).DOCUMENT_RECOVERY_KEY_FILE || '').trim();
  return path.resolve(raw || DEFAULT_FILE);
}

function validateKey(value, minimumLength) {
  const key = String(value == null ? '' : value);
  const minimum = Number(minimumLength) || MINIMUM_EXISTING_LENGTH;
  if (key.length < minimum) {
    throw new Error(`Der Wiederherstellungsschlüssel muss mindestens ${minimum} Zeichen lang sein.`);
  }
  if (key.length > MAXIMUM_LENGTH) {
    throw new Error(`Der Wiederherstellungsschlüssel darf höchstens ${MAXIMUM_LENGTH} Zeichen lang sein.`);
  }
  if (key !== key.trim() || /[\0\r\n]/.test(key)) {
    throw new Error('Der Wiederherstellungsschlüssel darf keine führenden/nachgestellten Leerzeichen oder Zeilenumbrüche enthalten.');
  }
  return key;
}

function isStrongKey(value) {
  const key = String(value == null ? '' : value);
  const isHex256 = /^[0-9a-f]{64}$/i.test(key);
  const isBase64Url256 = /^drk1_[A-Za-z0-9_-]{43}$/.test(key)
    && Buffer.from(key.slice(5), 'base64url').length >= 32;
  return isHex256 || isBase64Url256;
}

function validateNewKey(value) {
  const key = validateKey(value, MINIMUM_NEW_LENGTH);
  const strong = isStrongKey(key);
  if (!strong) {
    throw new Error(
      'Neue Wiederherstellungsschlüssel müssen kryptografisch erzeugt sein '
      + '(32 Byte als 64-stelliges Hex oder im Format drk1_<Base64URL>).'
    );
  }
  return key;
}

function slowKeyIdentity(key, salt) {
  return crypto.scryptSync(
    validateKey(key, MINIMUM_EXISTING_LENGTH),
    salt || Buffer.from('Betreuungsbuero-Recovery-Key-ID/v1', 'utf8'),
    24,
    { N: 16384, r: 8, p: 1 }
  ).toString('hex');
}

function legacyKeyId(key) {
  return `legacy_${slowKeyIdentity(key).slice(0, 32)}`;
}

function metadataPath(file) {
  return `${file}.meta.json`;
}

function pendingPath(file) {
  return `${file}.pending.json`;
}

function assertOutsideData(file, env) {
  const dataRoot = path.resolve(String((env || process.env).DOCUMENTS_DATA_ROOT || DATA_ROOT));
  const relative = path.relative(dataRoot, file);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Die Secret-Datei darf nicht innerhalb der zu sichernden Datenwurzel liegen.');
  }
}

function assertSafeDirectory(directory, create) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (!create || error.code !== 'ENOENT') throw error;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    stat = fs.lstatSync(directory);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Das Laufzeit-Secret-Verzeichnis ist kein reguläres Verzeichnis.');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    fs.chmodSync(directory, 0o700);
  }
}

function validateMetadata(value, key) {
  if (!value || value.format !== METADATA_FORMAT
      || !/^drk_[0-9a-f-]{36}$/i.test(String(value.keyId || ''))
      || !Number.isInteger(Number(value.generation)) || Number(value.generation) < 1) {
    throw new Error('Die Metadaten des Wiederherstellungsschlüssels haben ein unbekanntes Format.');
  }
  const salt = Buffer.from(String(value.verifierSalt || ''), 'base64');
  const expected = Buffer.from(String(value.verifier || ''), 'hex');
  if (salt.length !== 16 || expected.length !== 24) {
    throw new Error('Die Schlüsselprüfung in den Metadaten ist unvollständig.');
  }
  const actual = Buffer.from(slowKeyIdentity(key, salt), 'hex');
  if (!crypto.timingSafeEqual(actual, expected)) {
    throw new Error('Schlüsseldatei und Schlüsselmetadaten gehören nicht zur selben Generation.');
  }
  return {
    keyId: String(value.keyId),
    generation: Number(value.generation),
    createdAt: String(value.createdAt || ''),
    legacy: false
  };
}

function readPrivateRegularFile(file, label) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} ist keine reguläre Datei.`);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} ist für andere Nutzer lesbar.`);
  }
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  let value;
  try {
    value = fs.readFileSync(descriptor, { encoding: 'utf8' });
  } finally {
    fs.closeSync(descriptor);
  }
  return { value, stat };
}

function readMetadata(file, key) {
  const metaFile = metadataPath(file);
  const raw = readPrivateRegularFile(
    metaFile,
    'Die Metadaten des Wiederherstellungsschlüssels'
  );
  if (!raw) {
    return { keyId: legacyKeyId(key), generation: 0, createdAt: '', legacy: true };
  }
  let value;
  try { value = JSON.parse(raw.value); }
  catch (_error) { throw new Error('Die Metadaten des Wiederherstellungsschlüssels sind beschädigt.'); }
  return validateMetadata(value, key);
}

function readManagedKey(file) {
  const raw = readPrivateRegularFile(
    file,
    'Die verwaltete Wiederherstellungsschlüssel-Datei'
  );
  if (!raw) return null;
  const validated = validateKey(raw.value, MINIMUM_EXISTING_LENGTH);
  return {
    key: validated,
    updatedAt: raw.stat.mtime.toISOString()
  };
}

function readManaged(file) {
  const managed = readManagedKey(file);
  return managed ? { ...managed, ...readMetadata(file, managed.key) } : null;
}

function fsyncDirectory(directory) {
  try {
    const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } catch (_error) {
    // Manche Dateisysteme erlauben kein fsync() auf Verzeichnissen.
  }
}

function safePendingTempName(value, prefix) {
  const name = String(value || '');
  return name.startsWith(prefix) && /^[A-Za-z0-9._-]+$/.test(name) ? name : '';
}

function removeIfPresent(file) {
  try { fs.unlinkSync(file); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function writePrivateJsonAtomically(file, value) {
  const directory = path.dirname(file);
  const temp = path.join(directory, `.${path.basename(file)}-${crypto.randomUUID()}.part`);
  let descriptor;
  try {
    descriptor = fs.openSync(
      temp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600
    );
    fs.writeFileSync(descriptor, JSON.stringify(value) + '\n', { encoding: 'utf8' });
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temp, file);
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
    fsyncDirectory(directory);
  } catch (error) {
    if (descriptor != null) {
      try { fs.closeSync(descriptor); } catch (_closeError) { /* bereits geschlossen */ }
    }
    try { fs.unlinkSync(temp); } catch (_unlinkError) { /* nicht veröffentlicht */ }
    throw error;
  }
}

/*
 * Schlüssel und Metadaten sind zwei Dateien und können daher nicht mit einem
 * einzigen rename veröffentlicht werden. Das vorab fsync()-te Pending-Journal
 * macht die Folge dennoch crash-reparierbar:
 * - liegt bereits der neue Schlüssel, werden seine authentisierten Metadaten
 *   idempotent fertiggestellt;
 * - liegt noch der alte, in sich gültige Schlüsselstand, wird der nicht
 *   veröffentlichte Versuch verworfen.
 */
function recoverPending(file) {
  const journalFile = pendingPath(file);
  const raw = readPrivateRegularFile(
    journalFile,
    'Das Pending-Journal des Wiederherstellungsschlüssels'
  );
  if (!raw) return { recovered: false, pending: false };
  let journal;
  try { journal = JSON.parse(raw.value); }
  catch (_error) { throw new Error('Das Pending-Journal des Wiederherstellungsschlüssels ist beschädigt.'); }
  if (!journal || journal.format !== PENDING_FORMAT || !journal.metadata
      || typeof journal.metadata !== 'object' || Array.isArray(journal.metadata)) {
    throw new Error('Das Pending-Journal des Wiederherstellungsschlüssels hat ein unbekanntes Format.');
  }
  const keyTempName = safePendingTempName(journal.keyTemp, '.document-recovery-key-');
  const metaTempName = safePendingTempName(journal.metadataTemp, '.document-recovery-key-meta-');
  if (!keyTempName || !metaTempName) {
    throw new Error('Das Pending-Journal enthält ungültige temporäre Dateinamen.');
  }
  const directory = path.dirname(file);
  const managed = readManagedKey(file);
  let intendedActive = false;
  if (managed) {
    try {
      validateMetadata(journal.metadata, managed.key);
      intendedActive = true;
    } catch (error) {
      if (!/gehören nicht zur selben Generation/.test(String(error && error.message || error))) {
        throw error;
      }
    }
  }
  if (intendedActive) {
    writePrivateJsonAtomically(metadataPath(file), journal.metadata);
  } else if (managed) {
    // Nur ein weiterhin konsistenter Vorgängerstand darf einen noch nicht
    // veröffentlichten Versuch verwerfen. Ein dritter/mischter Zustand bleibt
    // fail-closed zur manuellen Diagnose erhalten.
    readMetadata(file, managed.key);
  }
  removeIfPresent(path.join(directory, keyTempName));
  removeIfPresent(path.join(directory, metaTempName));
  removeIfPresent(journalFile);
  fsyncDirectory(directory);
  return { recovered: intendedActive, pending: true };
}

function environmentKey(env) {
  const raw = String((env || process.env).DOCUMENT_RECOVERY_KEY || '');
  if (!raw) return null;
  return validateKey(raw, MINIMUM_EXISTING_LENGTH);
}

function createRecoveryKeyStore(options) {
  const opt = options || {};
  const env = opt.env || process.env;
  const file = path.resolve(opt.filePath || configuredFilePath(env));
  assertOutsideData(file, env);

  function current() {
    try {
      recoverPending(file);
      const managed = readManaged(file);
      if (managed) {
        return {
          configured: true,
          source: 'admin-panel',
          writable: true,
          keyId: managed.keyId,
          generation: managed.generation,
          createdAt: managed.createdAt,
          legacyMetadata: managed.legacy,
          strong: isStrongKey(managed.key),
          requiresRotation: !isStrongKey(managed.key),
          fingerprint: secureJson.fingerprint(managed.key),
          updatedAt: managed.updatedAt,
          key: managed.key
        };
      }
      const fallback = environmentKey(env);
      if (fallback) {
        return {
          configured: true,
          source: 'environment',
          writable: true,
          keyId: legacyKeyId(fallback),
          generation: 0,
          createdAt: '',
          legacyMetadata: true,
          strong: isStrongKey(fallback),
          requiresRotation: !isStrongKey(fallback),
          fingerprint: secureJson.fingerprint(fallback),
          updatedAt: '',
          key: fallback
        };
      }
      return {
        configured: false,
        source: 'none',
        writable: true,
        keyId: '',
        generation: 0,
        createdAt: '',
        legacyMetadata: false,
        strong: false,
        requiresRotation: false,
        fingerprint: '',
        updatedAt: '',
        key: ''
      };
    } catch (error) {
      return {
        configured: false,
        source: 'error',
        writable: false,
        keyId: '',
        generation: 0,
        createdAt: '',
        legacyMetadata: false,
        strong: false,
        requiresRotation: false,
        fingerprint: '',
        updatedAt: '',
        key: '',
        error: error.message || String(error)
      };
    }
  }

  function getKey() {
    const state = current();
    if (state.error) throw new Error(state.error);
    if (!state.configured) throw new Error('Es ist kein Wiederherstellungsschlüssel eingerichtet.');
    return state.key;
  }

  function getStrongKey() {
    const state = current();
    if (state.error) throw new Error(state.error);
    if (!state.configured) throw new Error('Es ist kein Wiederherstellungsschlüssel eingerichtet.');
    if (!state.strong) {
      throw new Error('Der vorhandene Wiederherstellungsschlüssel ist ein Legacy-Schlüssel und muss vor neuen Sicherungsabbildern rotiert werden.');
    }
    return state.key;
  }

  function getFingerprint() {
    const state = current();
    if (state.error) throw new Error(state.error);
    if (!state.configured) return '';
    return state.fingerprint;
  }

  function publicStatus() {
    const state = current();
    return {
      configured: state.configured,
      source: state.source,
      writable: state.writable,
      keyId: state.keyId,
      // Einweg-Fingerabdruck zur externen Zuordnung; der Schlüssel selbst
      // verlässt diesen Store über den Status niemals.
      fingerprint: state.fingerprint || '',
      generation: state.generation,
      createdAt: state.createdAt,
      legacyMetadata: !!state.legacyMetadata,
      strong: !!state.strong,
      requiresRotation: !!state.requiresRotation,
      updatedAt: state.updatedAt,
      error: state.error || ''
    };
  }

  function setKey(value) {
    const key = validateNewKey(value);
    const directory = path.dirname(file);
    assertOutsideData(file, env);
    assertSafeDirectory(directory, true);
    const previous = current();
    if (previous.error) throw new Error(previous.error);
    const sameKey = previous.configured && (() => {
      const a = crypto.createHash('sha256').update(previous.key).digest();
      const b = crypto.createHash('sha256').update(key).digest();
      return crypto.timingSafeEqual(a, b);
    })();
    const keyId = sameKey && previous.keyId && !String(previous.keyId).startsWith('legacy_')
      ? previous.keyId
      : `drk_${crypto.randomUUID()}`;
    const generation = sameKey && Number(previous.generation) > 0
      ? Number(previous.generation)
      : Math.max(0, Number(previous.generation) || 0) + 1;
    const createdAt = sameKey && previous.createdAt ? previous.createdAt : new Date().toISOString();
    const verifierSalt = crypto.randomBytes(16);
    const metadata = {
      format: METADATA_FORMAT,
      keyId,
      generation,
      createdAt,
      updatedAt: new Date().toISOString(),
      verifierSalt: verifierSalt.toString('base64'),
      verifier: slowKeyIdentity(key, verifierSalt)
    };
    const temp = path.join(directory, `.document-recovery-key-${crypto.randomUUID()}.part`);
    const metaTemp = path.join(directory, `.document-recovery-key-meta-${crypto.randomUUID()}.part`);
    let descriptor;
    let journalPublished = false;
    try {
      descriptor = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      fs.writeFileSync(descriptor, key, { encoding: 'utf8' });
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      const metaDescriptor = fs.openSync(
        metaTemp,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
        0o600
      );
      try {
        fs.writeFileSync(metaDescriptor, JSON.stringify(metadata) + '\n', { encoding: 'utf8' });
        fs.fsyncSync(metaDescriptor);
      } finally {
        fs.closeSync(metaDescriptor);
      }
      writePrivateJsonAtomically(pendingPath(file), {
        format: PENDING_FORMAT,
        metadata,
        keyTemp: path.basename(temp),
        metadataTemp: path.basename(metaTemp)
      });
      journalPublished = true;
      fs.renameSync(temp, file);
      if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
      fsyncDirectory(directory);
      if (typeof opt.afterKeyPublished === 'function') {
        opt.afterKeyPublished({ file, metadataPath: metadataPath(file), pendingPath: pendingPath(file) });
      }
      fs.renameSync(metaTemp, metadataPath(file));
      if (process.platform !== 'win32') fs.chmodSync(metadataPath(file), 0o600);
      fsyncDirectory(directory);
      removeIfPresent(pendingPath(file));
      fsyncDirectory(directory);
    } catch (error) {
      if (descriptor != null) {
        try { fs.closeSync(descriptor); } catch (_closeError) { /* bereits geschlossen */ }
      }
      // Sobald das fsync()-te Journal sichtbar ist, bleiben Journal und etwaige
      // .part-Dateien absichtlich liegen. current() beendet oder verwirft den
      // Versuch beim nächsten Zugriff idempotent.
      if (!journalPublished) {
        try { fs.unlinkSync(temp); } catch (_unlinkError) { /* nicht veröffentlicht */ }
        try { fs.unlinkSync(metaTemp); } catch (_unlinkError) { /* nicht veröffentlicht */ }
      }
      throw error;
    }
    const next = current();
    if (!next.configured || next.keyId !== keyId || next.generation !== generation
        || next.fingerprint !== secureJson.fingerprint(key)) {
      throw new Error('Der gespeicherte Wiederherstellungsschlüssel konnte nicht verifiziert werden.');
    }
    return {
      previousFingerprint: previous.fingerprint || '',
      previousKeyId: previous.keyId || '',
      rotated: !!previous.configured && previous.fingerprint !== next.fingerprint,
      keyId: next.keyId,
      generation: next.generation,
      status: publicStatus()
    };
  }

  function generate() {
    return `drk1_${crypto.randomBytes(32).toString('base64url')}`;
  }

  function verify(candidate) {
    const currentKey = getKey();
    const supplied = validateKey(candidate, MINIMUM_EXISTING_LENGTH);
    const a = crypto.createHash('sha256').update('Betreuungsbuero-Key-Pruefung:').update(currentKey).digest();
    const b = crypto.createHash('sha256').update('Betreuungsbuero-Key-Pruefung:').update(supplied).digest();
    return crypto.timingSafeEqual(a, b);
  }

  return {
    current,
    getKey,
    getStrongKey,
    getFingerprint,
    publicStatus,
    setKey,
    generate,
    verify,
    filePath: file
  };
}

let singleton;
function shared() {
  if (!singleton) singleton = createRecoveryKeyStore();
  return singleton;
}

module.exports = {
  createRecoveryKeyStore,
  shared,
  _test: {
    DEFAULT_FILE,
    MINIMUM_EXISTING_LENGTH,
    MINIMUM_NEW_LENGTH,
    METADATA_FORMAT,
    PENDING_FORMAT,
    legacyKeyId,
    metadataPath,
    pendingPath,
    recoverPending,
    isStrongKey,
    validateKey,
    validateNewKey
  }
};
