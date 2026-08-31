'use strict';

/*
 * Fail-closed Auswahl einer bereits veröffentlichten Gesamtsicherung für den
 * manuellen Admin-Download. Der Browser erhält niemals einen laufenden
 * Staging-Ordner: Nur ein direkter, regulärer Snapshot mit VOLLSTAENDIG-Status,
 * passender Job-/Zielkennung und vollständig geschlossenem Manifest wird als
 * Liste unvertauschter ZIP-Quellen zurückgegeben.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SNAPSHOT_NAME = /^Gesamtsicherung_[0-9]{8}_[0-9]{6}(?:_[A-Za-z0-9_.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeJobId(value) {
  const result = String(value || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(result)) {
    throw new Error('Die Sicherungsjob-Kennung ist ungültig.');
  }
  return result;
}

function safeTargetId(value) {
  const result = String(value || '').toLowerCase();
  if (!UUID.test(result)) throw new Error('Die TARGET_ID der Sicherungslinie ist ungültig.');
  return result;
}

function stableRegularBuffer(file, maximum) {
  const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    const named = fs.lstatSync(file);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink()
        || opened.dev !== named.dev || opened.ino !== named.ino) {
      throw new Error('Eine Snapshotdatei ist keine unvertauschte reguläre Datei.');
    }
    if (opened.size < 1 || opened.size > maximum) {
      throw new Error('Eine Snapshotdatei hat eine unzulässige Größe.');
    }
    const data = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || after.ctimeMs !== opened.ctimeMs) {
      throw new Error('Eine Snapshotdatei wurde während der Prüfung verändert.');
    }
    return data;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function stableRegularHash(file, expectedSize, expectedSha) {
  const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    const named = fs.lstatSync(file);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink()
        || opened.dev !== named.dev || opened.ino !== named.ino
        || opened.size !== expectedSize) {
      throw new Error('Eine Manifestdatei ist keine unvertauschte reguläre Datei.');
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let size = 0;
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
      size += read;
    }
    const after = fs.fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || after.ctimeMs !== opened.ctimeMs || size !== expectedSize) {
      throw new Error('Eine Manifestdatei wurde während der Prüfung verändert.');
    }
    if (hash.digest('hex') !== expectedSha) {
      throw new Error('Die Prüfsumme einer Manifestdatei stimmt nicht.');
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function strictBase64Utf8(value) {
  const encoded = String(value || '');
  if (!encoded || encoded.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('Das Manifest enthält keinen eindeutigen Base64-Pfad.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.toString('base64') !== encoded) {
    throw new Error('Das Manifest enthält einen nicht kanonischen Base64-Pfad.');
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new Error('Das Manifest enthält keinen gültigen UTF-8-Pfad.');
  }
  return text;
}

function safeRelativePath(value) {
  const result = String(value || '').normalize('NFC');
  if (!result || result !== String(value || '') || result.includes('\\')
      || result.startsWith('/') || /[\0\r\n]/.test(result)
      || path.posix.normalize(result) !== result
      || result.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Das Manifest enthält einen unsicheren oder nicht normalisierten Pfad.');
  }
  return result;
}

function directRegularDirectory(parent, name) {
  if (!SNAPSHOT_NAME.test(String(name || '')) || path.basename(String(name)) !== String(name)) {
    throw new Error('Der Snapshotname ist ungültig.');
  }
  const parentResolved = fs.realpathSync(path.resolve(parent));
  const snapshot = path.join(parentResolved, name);
  const named = fs.lstatSync(snapshot);
  if (!named.isDirectory() || named.isSymbolicLink()
      || fs.realpathSync(snapshot) !== snapshot
      || path.dirname(snapshot) !== parentResolved) {
    throw new Error('Der Snapshot ist kein unvertauschtes direktes Unterverzeichnis des Sicherungsziels.');
  }
  return { parent: parentResolved, snapshot };
}

function walkRegularFiles(root) {
  const result = [];
  const visit = (directory, prefix) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      const named = fs.lstatSync(full);
      if (named.isSymbolicLink()) throw new Error(`Symbolischer Link im Snapshot: ${relative}`);
      if (named.isDirectory()) {
        if (!entry.isDirectory() || fs.realpathSync(full) !== full) {
          throw new Error(`Vertauschtes Verzeichnis im Snapshot: ${relative}`);
        }
        visit(full, relative);
      } else if (named.isFile() && entry.isFile()) {
        result.push({ relative: relative.split(path.sep).join('/'), full, stat: named });
      } else {
        throw new Error(`Unzulässiger Dateityp im Snapshot: ${relative}`);
      }
    }
  };
  visit(root, '');
  return result;
}

function manifestRows(snapshot, snapshotName, expectedJobId, expectedTargetId) {
  const status = stableRegularBuffer(path.join(snapshot, 'STATUS.txt'), 4096).toString('utf8').trim();
  const job = stableRegularBuffer(path.join(snapshot, 'verwaltung', 'JOB-ID.txt'), 4096).toString('utf8').trim();
  const target = stableRegularBuffer(path.join(snapshot, 'verwaltung', 'TARGET-ID.txt'), 4096).toString('utf8').trim().toLowerCase();
  if (status !== 'VOLLSTAENDIG') throw new Error('Der Snapshot ist nicht als VOLLSTAENDIG bestätigt.');
  if (job !== expectedJobId) throw new Error('Der Snapshot gehört zu einer anderen Sicherungslinie.');
  if (target !== expectedTargetId) throw new Error('Der Snapshot gehört zu einer anderen TARGET_ID.');

  const manifestPath = path.join(snapshot, 'MANIFEST.tsv');
  const manifestShaPath = path.join(snapshot, 'MANIFEST.tsv.sha256');
  const manifest = stableRegularBuffer(manifestPath, MAX_MANIFEST_BYTES);
  const recorded = stableRegularBuffer(manifestShaPath, 4096).toString('utf8').trim().toLowerCase();
  const actual = sha256(manifest);
  if (!SHA256.test(recorded) || recorded !== actual) {
    throw new Error('Die Prüfsumme von MANIFEST.tsv stimmt nicht.');
  }

  const seen = new Set();
  const rows = [];
  const lines = manifest.toString('utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (!lines.length) throw new Error('MANIFEST.tsv ist leer.');
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length !== 3) throw new Error('MANIFEST.tsv enthält eine ungültige Zeile.');
    const expectedSha = String(parts[0] || '').toLowerCase();
    const expectedSize = String(parts[1] || '');
    const relative = safeRelativePath(strictBase64Utf8(parts[2]));
    if (!SHA256.test(expectedSha) || !/^(?:0|[1-9][0-9]*)$/.test(expectedSize)) {
      throw new Error('MANIFEST.tsv enthält eine ungültige Prüfsumme oder Größe.');
    }
    const expectedSizeNumber = Number(expectedSize);
    if (!Number.isSafeInteger(expectedSizeNumber)) {
      throw new Error('MANIFEST.tsv enthält eine nicht sicher darstellbare Dateigröße.');
    }
    if (seen.has(relative)) throw new Error('MANIFEST.tsv enthält einen Pfad doppelt.');
    seen.add(relative);
    const source = path.join(snapshot, ...relative.split('/'));
    const named = fs.lstatSync(source);
    if (!named.isFile() || named.isSymbolicLink()
        || fs.realpathSync(source) !== source
        || named.size !== expectedSizeNumber) {
      throw new Error(`Manifestdatei fehlt, wurde vertauscht oder hat eine andere Größe: ${relative}`);
    }
    stableRegularHash(source, expectedSizeNumber, expectedSha);
    rows.push({
      quelle: source,
      pfad: `${snapshotName}/${relative}`,
      sha256: expectedSha,
      mtime: named.mtime
    });
  }

  const allFiles = walkRegularFiles(snapshot);
  const expectedFiles = new Set([...seen, 'MANIFEST.tsv', 'MANIFEST.tsv.sha256']);
  if (allFiles.length !== expectedFiles.size
      || allFiles.some((entry) => !expectedFiles.has(entry.relative))) {
    throw new Error('Der Snapshot enthält nicht manifestierte oder unerwartet fehlende Dateien.');
  }
  rows.push({
    quelle: manifestPath,
    pfad: `${snapshotName}/MANIFEST.tsv`,
    sha256: actual,
    mtime: fs.lstatSync(manifestPath).mtime
  });
  rows.push({
    quelle: manifestShaPath,
    pfad: `${snapshotName}/MANIFEST.tsv.sha256`,
    sha256: sha256(stableRegularBuffer(manifestShaPath, 4096)),
    mtime: fs.lstatSync(manifestShaPath).mtime
  });
  return rows;
}

function validateSnapshot(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const expectedJobId = safeJobId(opts.jobId);
  const expectedTargetId = safeTargetId(opts.targetId);
  const target = fs.realpathSync(path.resolve(String(opts.targetDir || '')));
  const targetStat = fs.lstatSync(target);
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error('Das Sicherungsziel ist kein reguläres Verzeichnis.');
  }
  const snapshotName = String(opts.snapshotName || '');
  const located = directRegularDirectory(target, snapshotName);
  return {
    snapshotName,
    snapshot: located.snapshot,
    entries: manifestRows(
      located.snapshot,
      snapshotName,
      expectedJobId,
      expectedTargetId
    )
  };
}

function latestSnapshot(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const expectedJobId = safeJobId(opts.jobId);
  const expectedTargetId = safeTargetId(opts.targetId);
  const target = fs.realpathSync(path.resolve(String(opts.targetDir || '')));
  const targetStat = fs.lstatSync(target);
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error('Das Sicherungsziel ist kein reguläres Verzeichnis.');
  }
  const candidates = fs.readdirSync(target)
    .filter((name) => SNAPSHOT_NAME.test(name))
    .sort()
    .reverse();
  for (const snapshotName of candidates) {
    let located;
    try { located = directRegularDirectory(target, snapshotName); }
    catch (_error) { continue; }
    let owner;
    try {
      owner = stableRegularBuffer(
        path.join(located.snapshot, 'verwaltung', 'JOB-ID.txt'),
        4096
      ).toString('utf8').trim();
    } catch (_error) {
      continue;
    }
    if (owner !== expectedJobId) continue;
    return {
      snapshotName,
      snapshot: located.snapshot,
      entries: manifestRows(
        located.snapshot,
        snapshotName,
        expectedJobId,
        expectedTargetId
      )
    };
  }
  throw new Error('Für diese Sicherungslinie wurde noch kein vollständiger lokaler Snapshot gefunden.');
}

module.exports = {
  latestSnapshot,
  validateSnapshot,
  _test: {
    stableRegularBuffer,
    stableRegularHash,
    strictBase64Utf8,
    safeRelativePath,
    manifestRows,
    walkRegularFiles
  }
};
