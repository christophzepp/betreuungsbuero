'use strict';

// Stabile Ablage fuer Anlagen der Falldokumentation.
//
// Historisch lag eine Datei unter <Fall>/<Eintrag>/<Foto-ID>. Dieselbe Foto-ID darf aber von
// mehreren Eintraegen referenziert werden. Deshalb darf weder der Lese- noch der Loeschpfad von
// einer einzelnen Eintrags-ID abhaengen. Neue Dateien liegen unter <Fall>/_dateien/<Foto-ID>;
// bestehende Pfade werden weiterhin gefunden und koennen verlustfrei dorthin adoptiert werden.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function safeId(value, label) {
  const id = String(value || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) || id === '.' || id === '..') {
    const error = new Error(`${label || 'Kennung'} ist ungültig.`);
    error.code = 'UNGUELTIGE_KENNUNG';
    throw error;
  }
  return id;
}

function canonicalDir(root, caseId) {
  return path.join(String(root), safeId(caseId, 'Fallkennung'), '_dateien');
}

function canonicalPath(root, caseId, photoId) {
  return path.join(canonicalDir(root, caseId), safeId(photoId, 'Dateikennung'));
}

function regularFile(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (_error) {
    return false;
  }
}

function legacyCandidates(root, caseId, photoId, preferredEntryId) {
  const base = path.join(String(root), safeId(caseId, 'Fallkennung'));
  const pid = safeId(photoId, 'Dateikennung');
  const candidates = [];
  if (preferredEntryId) {
    candidates.push(path.join(base, safeId(preferredEntryId, 'Eintragskennung'), pid));
  }
  let names = [];
  try { names = fs.readdirSync(base); } catch (_error) { names = []; }
  for (const name of names.sort()) {
    if (name === '_dateien' || (preferredEntryId && name === String(preferredEntryId))) continue;
    try { safeId(name, 'Eintragskennung'); } catch (_error) { continue; }
    candidates.push(path.join(base, name, pid));
  }
  return candidates;
}

function resolve(root, caseId, photoId, preferredEntryId) {
  const canonical = canonicalPath(root, caseId, photoId);
  if (regularFile(canonical)) return canonical;
  for (const candidate of legacyCandidates(root, caseId, photoId, preferredEntryId)) {
    if (regularFile(candidate)) return candidate;
  }
  return null;
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read = 0;
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read) hash.update(buffer.subarray(0, read));
    } while (read);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function adopt(root, caseId, photoId, preferredEntryId) {
  const target = canonicalPath(root, caseId, photoId);
  if (regularFile(target)) return target;
  const source = resolve(root, caseId, photoId, preferredEntryId);
  if (!source) return null;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (!error || error.code !== 'EXDEV') throw error;
    const temp = target + '.adopt-' + crypto.randomUUID() + '.part';
    fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
    if (sha256(source) !== sha256(temp)) {
      try { fs.unlinkSync(temp); } catch (_error) { /* best effort */ }
      throw new Error('Prüfsumme der übernommenen Doku-Anlage stimmt nicht.');
    }
    fs.renameSync(temp, target);
    fs.unlinkSync(source);
  }
  return target;
}

function writeNew(root, caseId, photoId, bytes) {
  const target = canonicalPath(root, caseId, photoId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = target + '.upload-' + crypto.randomUUID() + '.part';
  fs.writeFileSync(temp, bytes, { flag: 'wx' });
  try {
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (_error) { /* best effort */ }
    throw error;
  }
  return target;
}

function photoIdsFromRow(row) {
  let data = {};
  try { data = JSON.parse((row && row.data_json) || '{}'); } catch (_error) { data = {}; }
  return (Array.isArray(data.photos) ? data.photos : [])
    .map((photo) => String((photo && photo.id) || ''))
    .filter(Boolean);
}

function referenceCount(rows, photoId, excludingEntryId) {
  const wanted = String(photoId || '');
  let count = 0;
  for (const row of rows || []) {
    if (excludingEntryId && String(row.id || '') === String(excludingEntryId)) continue;
    if (photoIdsFromRow(row).includes(wanted)) count++;
  }
  return count;
}

function removeUnreferenced(root, caseId, photoId, rows, excludingEntryId) {
  if (referenceCount(rows, photoId, excludingEntryId) > 0) return false;
  const candidates = [
    canonicalPath(root, caseId, photoId),
    ...legacyCandidates(root, caseId, photoId, excludingEntryId)
  ];
  let removed = false;
  for (const candidate of new Set(candidates)) {
    if (!regularFile(candidate)) continue;
    fs.unlinkSync(candidate);
    removed = true;
  }
  return removed;
}

function removeDirIfEmpty(dir) {
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch (_error) { /* nicht leer oder nicht vorhanden */ }
}

module.exports = {
  safeId,
  canonicalDir,
  canonicalPath,
  resolve,
  adopt,
  writeNew,
  photoIdsFromRow,
  referenceCount,
  removeUnreferenced,
  removeDirIfEmpty
};
