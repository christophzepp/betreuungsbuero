'use strict';

/*
 * Einseitiger Finder -> SQLite-Abgleich für den lesbaren Dokumentenspeicher.
 *
 * scan() ist vollständig read-only. apply() verändert ausschließlich den SQLite-Index
 * und kann optional neue Sidecars mit O_EXCL anlegen. Eigene, eindeutig über fileId/folderId
 * identifizierte Sidecars werden bei Finder-Moves atomar aktualisiert. Nutzdateien und Ordner
 * werden weder umbenannt noch überschrieben noch gelöscht.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const names = require('./names');
const taxonomy = require('./taxonomy');

const ROOTS = Object.freeze({
  cases: 'Fallakten',
  archive: 'Fallakten-Archiv',
  office: 'Büroorganisation'
});
const MANAGEMENT_ROOT = 'Büroorganisation/_Verwaltung & Sicherungen';
const MANAGEMENT_ORPHANS = MANAGEMENT_ROOT + '/_Technik/Waisen';
const MANAGEMENT_REPORTS = MANAGEMENT_ROOT + '/_Technik/Umstellungsberichte';
const ORPHAN_ACK_SIDECAR = /^\.ablage-waise-([0-9a-f]{16})-([0-9a-f]{8})\.json$/i;
const ORPHAN_ACK_PREFIX = /^\.ablage-waise-.*\.json$/i;

function posix(value) {
  return String(value || '').split(path.sep).join('/');
}

function key(value) {
  return posix(value).normalize('NFC').toLocaleLowerCase('de-DE');
}

function belowPath(relpath, parent) {
  const actual = key(relpath);
  const wanted = key(parent).replace(/\/+$/, '');
  return actual === wanted || actual.startsWith(wanted + '/');
}

function safeRelative(value) {
  const raw = posix(value);
  if (!raw || raw === '.' || path.posix.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) return '';
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) return '';
  return parts.join('/');
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function regularStat(candidate) {
  try {
    const stat = fs.lstatSync(candidate);
    return stat.isFile() && !stat.isSymbolicLink() ? stat : null;
  } catch (_error) {
    return null;
  }
}

function directoryStat(candidate) {
  try {
    const stat = fs.lstatSync(candidate);
    return stat.isDirectory() && !stat.isSymbolicLink() ? stat : null;
  } catch (_error) {
    return null;
  }
}

function sha256File(candidate) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(candidate, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    do {
      count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count) hash.update(buffer.subarray(0, count));
    } while (count);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function mimeFor(filename) {
  const extension = path.extname(String(filename || '')).toLocaleLowerCase('de-DE');
  return ({
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.xml': 'application/xml',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.heic': 'image/heic',
    '.zip': 'application/zip',
    '.eml': 'message/rfc822'
  })[extension] || 'application/octet-stream';
}

function jsonFile(candidate, maxBytes) {
  const stat = regularStat(candidate);
  const limit = maxBytes === undefined ? 1024 * 1024 : Number(maxBytes);
  if (!stat || (Number.isFinite(limit) && stat.size > limit)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_error) {
    return null;
  }
}

function inodeKey(stat) {
  return stat ? `${String(stat.dev)}:${String(stat.ino)}` : '';
}

function uniqueObservedName(raw, reserved) {
  const normalized = names.normalisiereDateiname(raw, { fallback: 'Unbenannt' });
  const adjustments = [...normalized.reasons];
  let candidate = normalized.name;
  if (reserved.has(names.vergleichsschluessel(candidate))) {
    const match = /^(.+?)(\.[^.]{1,32})?$/.exec(candidate);
    const stem = (match && match[1]) || candidate;
    const extension = (match && match[2]) || '';
    let index = 2;
    do {
      candidate = names.normalisiereDateiname(`${stem} (${index++})${extension}`).name;
    } while (reserved.has(names.vergleichsschluessel(candidate)));
    adjustments.push({
      code: 'kollision',
      text: `Der Finder-Name kollidiert ohne Groß-/Kleinschreibung bzw. nach NFC; im Index wird „${candidate}“ angezeigt. Die Datei auf der Platte blieb unverändert.`
    });
  }
  reserved.add(names.vergleichsschluessel(candidate));
  return { name: candidate, adjustments };
}

function createDocumentFinderSync(options) {
  const opt = options || {};
  if (!opt.db || typeof opt.db.prepare !== 'function') {
    throw new Error('document-finder-sync benötigt eine injizierte Datenbank.');
  }
  const db = opt.db;
  const storage = opt.documentStorage || null;
  const rootValue = opt.root || opt.storageRoot || (storage && storage.root);
  const root = path.resolve(String(typeof rootValue === 'function' ? rootValue() : rootValue || ''));
  if (!rootValue) throw new Error('document-finder-sync benötigt documentStorage oder eine Speicherwurzel.');
  const now = typeof opt.now === 'function' ? opt.now : (() => new Date());
  const idFactory = typeof opt.idFactory === 'function' ? opt.idFactory : (() => crypto.randomUUID());
  const hashFile = opt.sha256File || (storage && storage.sha256File) || sha256File;
  const writeSidecars = !!opt.writeSidecars;

  function tableColumns(table) {
    return new Set(db.prepare(`PRAGMA table_info("${String(table).replace(/"/g, '""')}")`).all().map((row) => row.name));
  }
  const folderColumns = tableColumns('doc_folders');
  const fileColumns = tableColumns('doc_files');
  const caseRootColumns = tableColumns('doc_case_roots');
  if (!folderColumns.has('id') || !fileColumns.has('id')) {
    throw new Error('Dokumenttabellen fehlen.');
  }

  function allOrEmpty(sql) {
    try { return db.prepare(sql).all(); } catch (_error) { return []; }
  }

  function finding(list, kind, storageRelpath, detail, severity) {
    const value = {
      kind,
      severity: severity || 'warning',
      storageRelpath: posix(storageRelpath || ''),
      detail: detail || {}
    };
    list.push(value);
    return value;
  }

  function caseMappings(findings) {
    const cases = new Set(allOrEmpty('SELECT id FROM cases').map((row) => String(row.id)));
    const roots = allOrEmpty('SELECT * FROM doc_case_roots');
    const byPath = new Map();
    for (const row of roots) {
      if (row.storage_relpath) byPath.set(key(row.storage_relpath), String(row.case_id));
    }
    if (storage && typeof storage.caseRootInfo === 'function') {
      for (const caseId of cases) {
        if ([...byPath.values()].includes(caseId)) continue;
        try {
          const info = storage.caseRootInfo(caseId, false);
          if (info && info.storageRelpath) byPath.set(key(info.storageRelpath), caseId);
        } catch (error) {
          finding(findings, 'case_mapping_error', '', { caseId, message: error.message });
        }
      }
    }
    return { cases, roots, byPath };
  }

  function resolveCaseRoot(absolute, relative, mappings, findings) {
    const sidecarPath = path.join(absolute, '.ablage-fall.json');
    const sidecar = jsonFile(sidecarPath);
    if (fs.existsSync(sidecarPath) && !sidecar) {
      finding(findings, 'case_sidecar_invalid', relative, { sidecarPath });
    }
    if (sidecar && sidecar.caseId) {
      const caseId = String(sidecar.caseId);
      if (mappings.cases.has(caseId)) return { caseId, source: 'sidecar' };
      finding(findings, 'unknown_case_root', relative, {
        reason: 'sidecar_case_unknown',
        caseId
      });
      return null;
    }
    const exact = mappings.byPath.get(key(relative));
    if (exact) return { caseId: exact, source: 'doc_case_roots' };
    const basenameKey = names.vergleichsschluessel(path.basename(relative));
    const candidates = mappings.roots.filter((row) =>
      names.vergleichsschluessel(row.folder_name || path.basename(row.storage_relpath || '')) === basenameKey
    );
    if (candidates.length === 1) return { caseId: String(candidates[0].case_id), source: 'current_mapping' };
    finding(findings, 'unknown_case_root', relative, {
      reason: candidates.length > 1 ? 'ambiguous_name' : 'no_identity',
      candidates: candidates.map((row) => row.case_id)
    });
    return null;
  }

  function parseDirectorySidecars(absolute, relative, findings) {
    const result = { folderId: '', filesByPath: new Map(), filesByName: new Map() };
    let entries = [];
    try { entries = fs.readdirSync(absolute); } catch (_error) { return result; }
    for (const entry of entries) {
      if (!/^\.ablage-(?:folder-|ordner-|[^/]+\.json$)/.test(entry) || entry === '.ablage-fall.json') continue;
      const candidate = path.join(absolute, entry);
      const stat = regularStat(candidate);
      if (!stat) {
        if (fs.existsSync(candidate)) finding(findings, 'symlink_or_special_ignored', posix(path.relative(root, candidate)), { path: candidate });
        continue;
      }
      const metadata = jsonFile(candidate);
      if (!metadata) {
        finding(findings, 'sidecar_invalid', posix(path.relative(root, candidate)), { path: candidate });
        continue;
      }
      if (/^\.ablage-(?:folder|ordner)-/.test(entry) && metadata.folderId) {
        result.folderId = String(metadata.folderId);
      }
      if (metadata.fileId) {
        if (metadata.path) result.filesByPath.set(key(metadata.path), String(metadata.fileId));
        if (metadata.name) result.filesByName.set(names.vergleichsschluessel(metadata.name), String(metadata.fileId));
      }
    }
    return result;
  }

  function auditManagement(findings) {
    const managementRoot = path.join(root, ...MANAGEMENT_ROOT.split('/'));
    const result = {
      acknowledgedOrphans: 0,
      technicalFiles: 0,
      unknownFiles: 0
    };
    if (!directoryStat(managementRoot)) {
      finding(findings, 'expected_root_missing', MANAGEMENT_ROOT, {});
      return result;
    }

    const entries = [];
    function visit(current) {
      let children;
      try { children = fs.readdirSync(current, { withFileTypes: true }); }
      catch (error) {
        finding(findings, 'scan_error', posix(path.relative(root, current)), { message: error.message }, 'error');
        return;
      }
      for (const child of children.sort((left, right) => names.deutschVergleichen(left.name, right.name))) {
        if (child.name === '.DS_Store') continue;
        const absolute = path.join(current, child.name);
        const relative = posix(path.relative(root, absolute));
        let stat;
        try { stat = fs.lstatSync(absolute); }
        catch (error) {
          finding(findings, 'scan_error', relative, { message: error.message }, 'error');
          continue;
        }
        if (stat.isSymbolicLink()) {
          finding(findings, 'symlink_ignored', relative, { path: absolute });
        } else if (stat.isDirectory()) {
          visit(absolute);
        } else if (stat.isFile()) {
          entries.push({ absolute, storageRelpath: relative, stat });
        } else {
          finding(findings, 'special_file_ignored', relative, { path: absolute });
        }
      }
    }
    visit(managementRoot);

    const byRelpath = new Map(entries.map((entry) => [entry.storageRelpath, entry]));
    const acknowledgedFiles = new Set();
    let acknowledgedReferences = 0;
    const handledSidecars = new Set();
    const technicalFiles = new Set();
    const indexedRows = allOrEmpty('SELECT * FROM doc_files');
    const indexedPaths = new Set(indexedRows
      .filter((row) => !String(row.deleted_at || ''))
      .map((row) => String(row.storage_relpath || ''))
      .filter(Boolean)
      .map(key));
    const indexedById = new Map(indexedRows.map((row) => [String(row.id), row]));
    const indexedByPath = new Map(indexedRows
      .filter((row) => !String(row.deleted_at || '') && String(row.storage_relpath || ''))
      .map((row) => [key(row.storage_relpath), row]));

    for (const row of indexedRows) {
      if (String(row.area || '') !== 'management'
        || String(row.deleted_at || '')
        || !String(row.storage_relpath || '')) continue;
      const entry = byRelpath.get(String(row.storage_relpath));
      if (!entry) {
        finding(findings, 'management_indexed_file_missing', row.storage_relpath, {
          fileId: String(row.id || ''),
          name: String(row.name || ''),
          automaticApply: false,
          message: 'Ein verwaltetes Sicherungsabbild fehlt. Der Index wird nicht automatisch verändert.'
        });
        continue;
      }
      const sizeChanged = Number(row.size) !== Number(entry.stat.size);
      const inodeChanged = row.storage_dev && row.storage_ino
        && `${row.storage_dev}:${row.storage_ino}` !== `${entry.stat.dev}:${entry.stat.ino}`;
      if (sizeChanged || inodeChanged) {
        finding(findings, 'management_indexed_file_changed', row.storage_relpath, {
          fileId: String(row.id || ''),
          name: String(row.name || ''),
          sizeChanged,
          inodeChanged,
          automaticApply: false,
          message: 'Ein verwaltetes Sicherungsabbild wurde verändert. Die Änderung bleibt bestätigungspflichtig.'
        });
      }
    }

    for (const sidecar of entries) {
      const basename = path.basename(sidecar.absolute);
      if (!ORPHAN_ACK_PREFIX.test(basename)) continue;
      handledSidecars.add(sidecar.absolute);
      const metadata = jsonFile(sidecar.absolute);
      const filenameMatch = ORPHAN_ACK_SIDECAR.exec(basename);
      const storedPath = safeRelative(metadata && metadata.storedPath);
      const deduplicated = !!(metadata && metadata.deduplicated === true);
      const target = storedPath
        ? (deduplicated
          ? (() => {
              const absolute = path.join(root, ...storedPath.split('/'));
              const stat = inside(root, absolute) ? regularStat(absolute) : null;
              return stat ? { absolute, storageRelpath: storedPath, stat } : null;
            })()
          : byRelpath.get(storedPath))
        : null;
      const indexedTarget = storedPath ? indexedByPath.get(key(storedPath)) : null;
      const problems = [];
      if (!belowPath(sidecar.storageRelpath, MANAGEMENT_ORPHANS)) problems.push('outside_orphan_area');
      if (!metadata || metadata.format !== 'Betreuungsbüro-Waise/1') problems.push('format_invalid');
      if (!filenameMatch) problems.push('filename_invalid');
      if (!storedPath || !target) problems.push('stored_file_missing');
      if (!deduplicated && target
        && path.posix.dirname(storedPath) !== path.posix.dirname(sidecar.storageRelpath)) {
        problems.push('stored_file_not_sibling');
      }
      if (deduplicated && (!indexedTarget
        || String(metadata && metadata.canonicalFileId || '') !== String(indexedTarget.id))) {
        problems.push('canonical_index_mismatch');
      }
      if (!metadata || typeof metadata.sourceRoot !== 'string' || !metadata.sourceRoot
        || typeof metadata.originalPath !== 'string' || !metadata.originalPath) {
        problems.push('provenance_missing');
      }
      if (target && Number(metadata && metadata.size) !== Number(target.stat.size)) {
        problems.push('size_mismatch');
      }
      const expectedSha = String(metadata && metadata.sha256 || '').toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(expectedSha)) problems.push('sha256_invalid');
      if (target && /^[0-9a-f]{64}$/.test(expectedSha)) {
        const actualSha = hashFile(target.absolute);
        if (String(actualSha).toLowerCase() !== expectedSha) problems.push('sha256_mismatch');
        if (filenameMatch && !String(actualSha).toLowerCase().startsWith(filenameMatch[1].toLowerCase())) {
          problems.push('filename_hash_mismatch');
        }
      }
      if (!problems.length) {
        if (deduplicated) acknowledgedReferences++;
        else acknowledgedFiles.add(target.absolute);
      } else {
        finding(findings, 'orphan_ack_invalid', sidecar.storageRelpath, {
          path: sidecar.absolute,
          storedPath,
          deduplicated,
          problems: [...new Set(problems)],
          automaticImport: false
        });
      }
    }

    for (const entry of entries) {
      if (path.posix.dirname(entry.storageRelpath) !== MANAGEMENT_REPORTS
        || path.posix.extname(entry.storageRelpath).toLowerCase() !== '.json') continue;
      const metadata = jsonFile(entry.absolute, 64 * 1024 * 1024);
      if (!metadata || metadata.format !== 'Betreuungsbüro-Umstellungsbericht/1'
        || typeof metadata.runId !== 'string' || !metadata.runId
        || typeof metadata.status !== 'string' || !metadata.status
        || !Array.isArray(metadata.entries)
        || !metadata.summary || typeof metadata.summary !== 'object' || Array.isArray(metadata.summary)) {
        continue;
      }
      technicalFiles.add(entry.absolute);
      const textEntry = byRelpath.get(entry.storageRelpath.slice(0, -5) + '.txt');
      if (textEntry) technicalFiles.add(textEntry.absolute);
    }

    for (const entry of entries) {
      if (acknowledgedFiles.has(entry.absolute)
        || handledSidecars.has(entry.absolute)
        || technicalFiles.has(entry.absolute)
        || indexedPaths.has(key(entry.storageRelpath))) {
        continue;
      }
      if (/^\.ablage-(?!waise-).+\.json$/i.test(path.basename(entry.absolute))) {
        const metadata = jsonFile(entry.absolute);
        const indexed = metadata && metadata.fileId
          ? indexedById.get(String(metadata.fileId))
          : null;
        if (indexed && metadata.path
          && key(safeRelative(metadata.path)) === key(indexed.storage_relpath)
          && path.posix.dirname(safeRelative(metadata.path)) === path.posix.dirname(entry.storageRelpath)) {
          continue;
        }
      }
      result.unknownFiles++;
      finding(findings, 'unknown_management_file', entry.storageRelpath, {
        path: entry.absolute,
        size: entry.stat.size,
        automaticImport: false,
        message: 'Unbekannte Dateien in der geschützten Verwaltung werden gemeldet, aber nie automatisch importiert.'
      });
    }
    result.acknowledgedOrphans = acknowledgedFiles.size + acknowledgedReferences;
    result.acknowledgedOrphanReferences = acknowledgedReferences;
    result.technicalFiles = technicalFiles.size;
    return result;
  }

  function scan() {
    const findings = [];
    const directories = [];
    const files = [];
    const scopes = [];
    const caseRoots = [];
    const mappings = caseMappings(findings);
    const rootStat = directoryStat(root);
    if (!rootStat) {
      finding(findings, 'storage_root_missing', '', { root }, 'error');
      return {
        root,
        scannedAt: now().toISOString(),
        findings,
        directories,
        files,
        summary: { directories: 0, files: 0, findings: findings.length, counts: { storage_root_missing: 1 } }
      };
    }

    const knownTop = new Set(Object.values(ROOTS));
    const topEntries = fs.readdirSync(root, { withFileTypes: true });
    const topKeys = new Map();
    for (const entry of topEntries) {
      const candidate = path.join(root, entry.name);
      const stat = fs.lstatSync(candidate);
      const topKey = names.vergleichsschluessel(entry.name);
      if (!topKeys.has(topKey)) topKeys.set(topKey, []);
      topKeys.get(topKey).push(entry.name);
      if (stat.isSymbolicLink()) {
        finding(findings, 'symlink_ignored', entry.name, { path: candidate });
      } else if (!knownTop.has(entry.name)) {
        finding(findings, 'unknown_top_level', entry.name, { path: candidate });
      }
    }
    for (const namesAtTop of topKeys.values()) {
      if (namesAtTop.length > 1) finding(findings, 'top_level_collision', '', { names: namesAtTop });
    }
    const management = auditManagement(findings);

    const officeRoot = path.join(root, ROOTS.office);
    if (directoryStat(officeRoot)) {
      scopes.push({ area: 'office', caseId: '', baseAbs: officeRoot, baseRel: ROOTS.office });
    } else {
      finding(findings, 'expected_root_missing', ROOTS.office, {});
    }

    const seenCaseRoots = new Map();
    const activeRoot = path.join(root, ROOTS.cases);
    if (directoryStat(activeRoot)) {
      for (const letterEntry of fs.readdirSync(activeRoot, { withFileTypes: true })) {
        const letterAbs = path.join(activeRoot, letterEntry.name);
        const stat = fs.lstatSync(letterAbs);
        if (stat.isSymbolicLink()) {
          finding(findings, 'symlink_ignored', posix(path.relative(root, letterAbs)), { path: letterAbs });
          continue;
        }
        if (!letterEntry.isDirectory() || !/^[A-Z]$/.test(letterEntry.name)) {
          finding(findings, 'invalid_letter_level', posix(path.relative(root, letterAbs)), {
            name: letterEntry.name,
            reason: 'Die physische Buchstabenebene muss genau A–Z sein.'
          });
          continue;
        }
        for (const caseEntry of fs.readdirSync(letterAbs, { withFileTypes: true })) {
          const caseAbs = path.join(letterAbs, caseEntry.name);
          const relative = posix(path.relative(root, caseAbs));
          const caseStat = fs.lstatSync(caseAbs);
          if (caseStat.isSymbolicLink()) {
            finding(findings, 'symlink_ignored', relative, { path: caseAbs });
            continue;
          }
          if (!caseEntry.isDirectory()) {
            finding(findings, 'case_root_conflict', relative, { reason: 'not_a_directory' });
            continue;
          }
          const identity = resolveCaseRoot(caseAbs, relative, mappings, findings);
          if (!identity) continue;
          if (!seenCaseRoots.has(identity.caseId)) seenCaseRoots.set(identity.caseId, []);
          seenCaseRoots.get(identity.caseId).push(relative);
          scopes.push({ area: 'case', caseId: identity.caseId, baseAbs: caseAbs, baseRel: relative });
          caseRoots.push({
            caseId: identity.caseId,
            area: 'Fallakten',
            letter: letterEntry.name,
            folderName: caseEntry.name,
            storageRelpath: relative
          });
          const expected = mappings.roots.find((row) => String(row.case_id) === identity.caseId);
          if (expected && key(expected.storage_relpath) !== key(relative)) {
            finding(findings, 'case_root_moved', relative, {
              caseId: identity.caseId,
              expected: expected.storage_relpath,
              actual: relative
            });
          }
        }
      }
    } else {
      finding(findings, 'expected_root_missing', ROOTS.cases, {});
    }

    const archiveRoot = path.join(root, ROOTS.archive);
    if (directoryStat(archiveRoot)) {
      for (const caseEntry of fs.readdirSync(archiveRoot, { withFileTypes: true })) {
        const caseAbs = path.join(archiveRoot, caseEntry.name);
        const relative = posix(path.relative(root, caseAbs));
        const stat = fs.lstatSync(caseAbs);
        if (stat.isSymbolicLink()) {
          finding(findings, 'symlink_ignored', relative, { path: caseAbs });
          continue;
        }
        if (!caseEntry.isDirectory()) {
          finding(findings, 'case_root_conflict', relative, { reason: 'not_a_directory' });
          continue;
        }
        const identity = resolveCaseRoot(caseAbs, relative, mappings, findings);
        if (!identity) continue;
        if (!seenCaseRoots.has(identity.caseId)) seenCaseRoots.set(identity.caseId, []);
        seenCaseRoots.get(identity.caseId).push(relative);
        scopes.push({ area: 'case', caseId: identity.caseId, baseAbs: caseAbs, baseRel: relative });
        caseRoots.push({
          caseId: identity.caseId,
          area: 'Fallakten-Archiv',
          letter: '',
          folderName: caseEntry.name,
          storageRelpath: relative
        });
      }
    } else {
      finding(findings, 'expected_root_missing', ROOTS.archive, {});
    }
    for (const [caseId, paths] of seenCaseRoots) {
      if (paths.length > 1) {
        finding(findings, 'case_root_collision', '', { caseId, paths }, 'error');
        for (const item of caseRoots) if (item.caseId === caseId) item.ambiguous = true;
      }
    }

    function walk(scope, current, parentRelpath) {
      let entries;
      try { entries = fs.readdirSync(current, { withFileTypes: true }); }
      catch (error) {
        finding(findings, 'scan_error', posix(path.relative(root, current)), { message: error.message }, 'error');
        return;
      }
      const sidecars = parseDirectorySidecars(current, posix(path.relative(root, current)), findings);
      const siblingKeys = new Map();
      for (const entry of entries.sort((a, b) => names.deutschVergleichen(a.name, b.name))) {
        if (entry.name === '.DS_Store' || entry.name.startsWith('.ablage-')) continue;
        const absolute = path.join(current, entry.name);
        const relative = posix(path.relative(root, absolute));
        if (belowPath(relative, MANAGEMENT_ROOT)) continue;
        let stat;
        try { stat = fs.lstatSync(absolute); }
        catch (error) {
          finding(findings, 'scan_error', relative, { message: error.message }, 'error');
          continue;
        }
        if (stat.isSymbolicLink()) {
          finding(findings, 'symlink_ignored', relative, { path: absolute });
          continue;
        }
        const siblingKey = names.vergleichsschluessel(entry.name);
        if (!siblingKeys.has(siblingKey)) siblingKeys.set(siblingKey, []);
        siblingKeys.get(siblingKey).push(relative);
        if (stat.isDirectory()) {
          if (scope.area === 'case' && current === scope.baseAbs) {
            const register = taxonomy.REGISTER.find((item) =>
              String(entry.name).normalize('NFC') === item.name);
            if (!register) {
              finding(findings, 'invalid_case_register', relative, {
                caseId: scope.caseId,
                name: entry.name,
                allowed: taxonomy.fallanlageOrdner(),
                reason: 'Direkt unter einer Fallakte sind ausschließlich die exakten Register 00–12 zulässig; der Ordner und sein Inhalt wurden nicht eingelesen.'
              }, 'error');
              continue;
            }
          }
          const ownSidecars = parseDirectorySidecars(absolute, relative, findings);
          directories.push({
            absolute,
            storageRelpath: relative,
            parentRelpath: parentRelpath || scope.baseRel,
            physicalName: entry.name,
            area: scope.area,
            caseId: scope.caseId,
            scopeBase: scope.baseRel,
            dev: String(stat.dev),
            ino: String(stat.ino),
            sidecarFolderId: ownSidecars.folderId || ''
          });
          walk(scope, absolute, relative);
        } else if (stat.isFile()) {
          if (scope.area === 'case' && current === scope.baseAbs) {
            finding(findings, 'file_outside_register', relative, {
              caseId: scope.caseId,
              message: 'Dateien einer Fallakte müssen unter einem Register liegen.'
            });
            continue;
          }
          files.push({
            absolute,
            storageRelpath: relative,
            parentRelpath: parentRelpath || scope.baseRel,
            physicalName: entry.name,
            area: scope.area,
            caseId: scope.caseId,
            scopeBase: scope.baseRel,
            dev: String(stat.dev),
            ino: String(stat.ino),
            size: stat.size,
            sidecarFileId: sidecars.filesByPath.get(key(relative))
              || sidecars.filesByName.get(names.vergleichsschluessel(entry.name))
              || ''
          });
        } else {
          finding(findings, 'special_file_ignored', relative, { path: absolute });
        }
      }
      for (const paths of siblingKeys.values()) {
        if (paths.length > 1) finding(findings, 'filesystem_collision', parentRelpath || scope.baseRel, {
          paths,
          comparison: 'NFC + case-insensitive'
        }, 'error');
      }
    }
    for (const scope of scopes) walk(scope, scope.baseAbs, '');

    const dbFolders = allOrEmpty('SELECT * FROM doc_folders');
    // Die verschlüsselte/verwaltete Administration wird separat nur lesend
    // auditiert. Sie darf weder als normale Bürodatei erscheinen noch von
    // Finder-Automatik umgehängt werden.
    const dbFiles = allOrEmpty("SELECT * FROM doc_files WHERE deleted_at='' OR deleted_at IS NULL")
      .filter((row) => String(row.area || '') !== 'management');
    const folderById = new Map(dbFolders.map((row) => [String(row.id), row]));
    const folderByPath = new Map();
    const folderByInode = new Map();
    const caseRootByCase = new Map(mappings.roots.map((row) => [String(row.case_id), String(row.storage_relpath || '')]));
    const folderByLogicalPath = new Map();
    for (const row of dbFolders) {
      if (!row.storage_relpath) continue;
      const pathKey = key(row.storage_relpath);
      if (!folderByPath.has(pathKey)) folderByPath.set(pathKey, []);
      folderByPath.get(pathKey).push(row);
      const base = row.area === 'case' ? caseRootByCase.get(String(row.case_id)) : ROOTS.office;
      if (base && (key(row.storage_relpath) === key(base) || key(row.storage_relpath).startsWith(key(base) + '/'))) {
        const suffix = posix(row.storage_relpath).slice(posix(base).length).replace(/^\/+/, '');
        const logicalKey = `${row.area}|${row.case_id || ''}|${key(suffix)}`;
        if (!folderByLogicalPath.has(logicalKey)) folderByLogicalPath.set(logicalKey, []);
        folderByLogicalPath.get(logicalKey).push(row);
      }
      if (row.storage_dev && row.storage_ino) {
        const ikey = `${row.storage_dev}:${row.storage_ino}`;
        if (!folderByInode.has(ikey)) folderByInode.set(ikey, []);
        folderByInode.get(ikey).push(row);
      }
    }
    const fileById = new Map(dbFiles.map((row) => [String(row.id), row]));
    const fileByPath = new Map();
    const fileByInode = new Map();
    for (const row of dbFiles) {
      if (row.storage_relpath) {
        const pathKey = key(row.storage_relpath);
        if (!fileByPath.has(pathKey)) fileByPath.set(pathKey, []);
        fileByPath.get(pathKey).push(row);
      }
      if (row.storage_dev && row.storage_ino) {
        const ikey = `${row.storage_dev}:${row.storage_ino}`;
        if (!fileByInode.has(ikey)) fileByInode.set(ikey, []);
        fileByInode.get(ikey).push(row);
      }
    }
    const usedFiles = new Set();
    for (const file of files) {
      const bySidecar = file.sidecarFileId ? fileById.get(file.sidecarFileId) : null;
      const byInode = fileByInode.get(`${file.dev}:${file.ino}`) || [];
      const byPath = fileByPath.get(key(file.storageRelpath)) || [];
      const rawCandidates = [bySidecar, ...byInode, ...byPath]
        .filter(Boolean)
        .filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index);
      const candidates = rawCandidates.filter((row) => !usedFiles.has(String(row.id)));
      if (candidates.length === 1) {
        file.dbRow = candidates[0];
        usedFiles.add(String(candidates[0].id));
      } else if (candidates.length > 1) {
        file.blocked = true;
        finding(findings, 'file_identity_collision', file.storageRelpath, {
          candidates: candidates.map((row) => row.id)
        }, 'error');
      } else if (rawCandidates.length) {
        file.blocked = true;
        finding(findings, 'file_identity_reused', file.storageRelpath, {
          candidates: rawCandidates.map((row) => row.id),
          reason: 'Dieselbe Sidecar-/Inode-/Pfadidentität wurde bereits einer anderen physischen Datei zugeordnet.'
        }, 'error');
      }
    }

    const usedFolders = new Set();
    for (const directory of directories) {
      const sidecarRow = directory.sidecarFolderId ? folderById.get(directory.sidecarFolderId) : null;
      const byInode = folderByInode.get(`${directory.dev}:${directory.ino}`) || [];
      const exact = folderByPath.get(key(directory.storageRelpath)) || [];
      const logicalSuffix = posix(directory.storageRelpath).slice(posix(directory.scopeBase).length).replace(/^\/+/, '');
      const logical = folderByLogicalPath.get(`${directory.area}|${directory.caseId || ''}|${key(logicalSuffix)}`) || [];
      const rawCandidates = [sidecarRow, ...byInode, ...exact, ...logical]
        .filter(Boolean)
        .filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index);
      const candidates = rawCandidates.filter((row) => !usedFolders.has(String(row.id)));
      if (candidates.length === 1) {
        directory.dbRow = candidates[0];
        directory.matchedByFolderInode = byInode.some((row) => String(row.id) === String(candidates[0].id));
        usedFolders.add(String(candidates[0].id));
      } else if (candidates.length > 1) {
        directory.blocked = true;
        finding(findings, 'folder_identity_collision', directory.storageRelpath, {
          candidates: candidates.map((row) => row.id)
        }, 'error');
      } else if (rawCandidates.length) {
        directory.blocked = true;
        finding(findings, 'folder_identity_reused', directory.storageRelpath, {
          candidates: rawCandidates.map((row) => row.id)
        }, 'error');
      }
    }

    // Für Bestandsdaten ohne gespeicherte Ordner-Inode lässt sich ein Finder-Move/Rename
    // ersatzweise über die unveränderte Inode einer direkt enthaltenen Datei ableiten.
    const folderInference = new Map();
    for (const file of files) {
      if (!file.dbRow || !file.dbRow.folder_id) continue;
      const id = String(file.dbRow.folder_id);
      if (!folderInference.has(id)) folderInference.set(id, new Set());
      folderInference.get(id).add(file.parentRelpath);
    }
    const physicalDirByPath = new Map(directories.map((row) => [key(row.storageRelpath), row]));
    for (const [folderId, paths] of folderInference) {
      if (usedFolders.has(folderId) || paths.size !== 1) continue;
      const directory = physicalDirByPath.get(key([...paths][0]));
      const row = folderById.get(folderId);
      if (directory && row && !directory.dbRow) {
        directory.dbRow = row;
        directory.inferredByInode = true;
        usedFolders.add(folderId);
      }
    }
    // Liegt die unveränderte Datei tiefer in einem verschobenen Teilbaum, trägt ihre
    // eindeutige Ordnerzuordnung auch die Elternkette: DB-Eltern und physische Eltern werden
    // paarweise nach oben verfolgt. Fallroot und Buchstabenebene bleiben außerhalb der Tabelle.
    let inferredAncestor = true;
    while (inferredAncestor) {
      inferredAncestor = false;
      for (const directory of directories) {
        if (!directory.dbRow || !directory.dbRow.parent_id) continue;
        const parentDirectory = physicalDirByPath.get(key(directory.parentRelpath));
        const parentRow = folderById.get(String(directory.dbRow.parent_id));
        if (!parentDirectory || !parentRow || parentDirectory.dbRow || usedFolders.has(String(parentRow.id))) continue;
        parentDirectory.dbRow = parentRow;
        parentDirectory.inferredByInode = true;
        usedFolders.add(String(parentRow.id));
        inferredAncestor = true;
      }
    }

    const nodesByParent = new Map();
    for (const node of directories.concat(files)) {
      if (!nodesByParent.has(key(node.parentRelpath))) nodesByParent.set(key(node.parentRelpath), []);
      nodesByParent.get(key(node.parentRelpath)).push(node);
    }
    for (const nodes of nodesByParent.values()) {
      const reserved = new Set();
      nodes.sort((a, b) => {
        const mapped = Number(!!b.dbRow) - Number(!!a.dbRow);
        return mapped || names.deutschVergleichen(a.physicalName, b.physicalName);
      });
      for (const node of nodes) {
        const selected = uniqueObservedName(node.physicalName, reserved);
        node.indexName = selected.name;
        node.adjustments = selected.adjustments;
        if (selected.adjustments.length) {
          finding(findings, 'name_adjustment', node.storageRelpath, {
            physicalName: node.physicalName,
            indexName: node.indexName,
            adjustments: node.adjustments,
            physicalFileUnchanged: true
          }, 'info');
        }
      }
    }

    for (const directory of directories) {
      if (!directory.dbRow) {
        finding(findings, 'new_folder', directory.storageRelpath, {
          area: directory.area,
          caseId: directory.caseId,
          name: directory.indexName
        }, 'info');
      } else {
        const row = directory.dbRow;
        const changed = String(row.storage_relpath || '') !== directory.storageRelpath
          || String(row.name || '').normalize('NFC') !== directory.indexName
          || String(row.area || '') !== directory.area
          || String(row.case_id || '') !== directory.caseId
          || (row.storage_dev && row.storage_ino
            && `${row.storage_dev}:${row.storage_ino}` !== `${directory.dev}:${directory.ino}`)
          || (folderColumns.has('storage_status') && !['ok', 'physical'].includes(String(row.storage_status || '')));
        if (changed) {
          directory.needsUpdate = true;
          finding(findings, 'folder_changed', directory.storageRelpath, {
            folderId: row.id,
            expectedPath: row.storage_relpath,
            actualPath: directory.storageRelpath,
            matchedByFolderInode: !!directory.matchedByFolderInode,
            inferredByFileInode: !!directory.inferredByInode
          }, 'info');
        }
      }
    }
    for (const row of dbFolders) {
      if (!usedFolders.has(String(row.id)) && row.storage_relpath) {
        finding(findings, 'missing_folder', row.storage_relpath, { folderId: row.id });
      }
    }

    for (const file of files) {
      if (!file.dbRow) {
        finding(findings, 'new_file', file.storageRelpath, {
          name: file.indexName,
          size: file.size,
          area: file.area,
          caseId: file.caseId
        }, 'info');
      } else {
        const row = file.dbRow;
        const moved = String(row.storage_relpath || '') !== file.storageRelpath;
        const renamed = String(row.name || '').normalize('NFC') !== file.indexName;
        const inodeChanged = row.storage_dev && row.storage_ino
          && `${row.storage_dev}:${row.storage_ino}` !== `${file.dev}:${file.ino}`;
        if (moved || renamed || inodeChanged || Number(row.size) !== Number(file.size)) {
          const managed = Number(row.managed || 0) === 1;
          file.needsUpdate = !managed;
          file.protectedManaged = managed;
          finding(findings, managed ? 'managed_file_changed' : (inodeChanged && !moved ? 'file_replaced' : 'file_changed'), file.storageRelpath, {
            fileId: row.id,
            previousPath: row.storage_relpath,
            actualPath: file.storageRelpath,
            moved,
            renamed,
            inodeChanged,
            automaticApply: !managed
          }, 'info');
        }
      }
    }
    for (const row of dbFiles) {
      if (!usedFiles.has(String(row.id))) {
        const managed = Number(row.managed || 0) === 1;
        finding(findings, managed ? 'managed_file_missing' : 'missing_file', row.storage_relpath, {
          fileId: row.id,
          name: row.name,
          databaseUnchanged: true,
          automaticApply: !managed
        });
      }
    }

    const counts = {};
    for (const item of findings) counts[item.kind] = (counts[item.kind] || 0) + 1;
    return {
      root,
      scannedAt: now().toISOString(),
      findings,
      directories,
      files,
      caseRoots,
      summary: {
        scopes: scopes.length,
        directories: directories.length,
        files: files.length,
        findings: findings.length,
        counts,
        management
      }
    };
  }

  function dynamicUpdate(table, columns, id, patch) {
    const values = {};
    for (const [column, value] of Object.entries(patch)) {
      if (columns.has(column) && value !== undefined) values[column] = value;
    }
    const namesToSet = Object.keys(values);
    if (!namesToSet.length) return 0;
    return db.prepare(
      `UPDATE ${table} SET ${namesToSet.map((column) => `${column}=@${column}`).join(',')} WHERE id=@id`
    ).run({ id, ...values }).changes;
  }

  function safeSidecar(target, value, result) {
    if (!writeSidecars) return;
    if (!inside(root, target)) {
      result.errors.push({ kind: 'sidecar_outside_root', path: target });
      return;
    }
    const serialized = JSON.stringify(value, null, 2) + '\n';
    try {
      fs.writeFileSync(target, serialized, { encoding: 'utf8', flag: 'wx' });
      result.sidecarsCreated++;
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        let stat;
        let current;
        try {
          stat = fs.lstatSync(target);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
            throw new Error('Vorhandener Sidecar ist keine kleine reguläre Datei.');
          }
          const raw = fs.readFileSync(target, 'utf8');
          current = JSON.parse(raw);
          const identityField = value.fileId ? 'fileId' : (value.folderId ? 'folderId' : 'caseId');
          if (!value[identityField] || String(current[identityField] || '') !== String(value[identityField])) {
            throw new Error(`Vorhandener Sidecar gehört nicht zu ${identityField} ${value[identityField] || ''}.`);
          }
          if (raw === serialized) {
            result.sidecarsSkipped++;
            return;
          }
          const temporary = `${target}.tmp-${crypto.randomUUID()}`;
          try {
            fs.writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
            fs.renameSync(temporary, target);
            result.sidecarsUpdated++;
          } catch (updateError) {
            try { fs.unlinkSync(temporary); } catch (_ignore) { /* nicht angelegt */ }
            throw updateError;
          }
        } catch (updateError) {
          result.errors.push({ kind: 'sidecar_update_error', path: target, message: updateError.message });
        }
      } else {
        result.errors.push({ kind: 'sidecar_write_error', path: target, message: error.message });
      }
    }
  }

  function apply(scanResult) {
    const report = scanResult || scan();
    if (path.resolve(report.root) !== root) throw new Error('Scanbericht gehört zu einer anderen Speicherwurzel.');
    const result = {
      scannedAt: report.scannedAt,
      appliedAt: now().toISOString(),
      foldersInserted: 0,
      foldersUpdated: 0,
      filesInserted: 0,
      filesUpdated: 0,
      foldersMarkedMissing: 0,
      caseRootsInserted: 0,
      caseRootsUpdated: 0,
      sidecarsCreated: 0,
      sidecarsUpdated: 0,
      sidecarsSkipped: 0,
      errors: []
    };
    const directoryByPath = new Map(report.directories.map((node) => [key(node.storageRelpath), node]));
    const folderIds = new Map();

    const caseRootRead = db.prepare('SELECT * FROM doc_case_roots WHERE case_id=?');
    const hasRootSource = caseRootColumns.has('root_source');
    const caseRootInsert = db.prepare(`
      INSERT INTO doc_case_roots
        (case_id,area,letter,folder_name,folder_key,birth_key,storage_relpath${hasRootSource ? ',root_source' : ''},updated_at)
      VALUES (@caseId,@area,@letter,@folderName,@folderKey,'',@storageRelpath${hasRootSource ? ',@rootSource' : ''},@updatedAt)
    `);
    const caseRootUpdate = db.prepare(`
      UPDATE doc_case_roots SET
        area=@area, letter=@letter, folder_name=@folderName, folder_key=@folderKey,
        storage_relpath=@storageRelpath${hasRootSource ? ', root_source=@rootSource' : ''}, updated_at=@updatedAt
      WHERE case_id=@caseId
    `);
    for (const caseRoot of report.caseRoots || []) {
      if (caseRoot.ambiguous) continue;
      const normalized = names.normalisiereDateiname(caseRoot.folderName, { fallback: `Fall ${caseRoot.caseId}` });
      const values = {
        caseId: caseRoot.caseId,
        area: caseRoot.area,
        letter: caseRoot.letter,
        folderName: normalized.name,
        folderKey: names.vergleichsschluessel(normalized.name),
        storageRelpath: caseRoot.storageRelpath,
        rootSource: 'finder',
        updatedAt: result.appliedAt
      };
      const existing = caseRootRead.get(caseRoot.caseId);
      const rootChanged = !existing
        || existing.area !== values.area
        || existing.letter !== values.letter
        || existing.folder_name !== values.folderName
        || existing.storage_relpath !== values.storageRelpath;
      if (!existing) {
        caseRootInsert.run(values);
        result.caseRootsInserted++;
      } else if (rootChanged) {
        caseRootUpdate.run(values);
        result.caseRootsUpdated++;
      }
      const caseRootPath = path.join(root, ...caseRoot.storageRelpath.split('/'));
      safeSidecar(path.join(caseRootPath, '.ablage-fall.json'), {
        format: 'Betreuungsbüro-Fallordner/1',
        caseId: caseRoot.caseId,
        folder: caseRoot.storageRelpath,
        rootSource: rootChanged
          ? 'finder'
          : String((existing && existing.root_source) || 'generated'),
        updatedAt: result.appliedAt
      }, result);
    }

    const orderedDirectories = [...report.directories].sort((a, b) =>
      a.storageRelpath.split('/').length - b.storageRelpath.split('/').length
      || names.deutschVergleichen(a.storageRelpath, b.storageRelpath)
    );
    const insertFolder = db.prepare(`
      INSERT INTO doc_folders
        (id,area,case_id,parent_id,name,name_key,storage_relpath,updated_at)
      VALUES (@id,@area,@caseId,@parentId,@name,@nameKey,@storageRelpath,@updatedAt)
    `);

    for (const node of orderedDirectories) {
      if (node.blocked) {
        result.errors.push({ kind: 'folder_identity_ambiguous', path: node.storageRelpath });
        continue;
      }
      const currentStat = directoryStat(node.absolute);
      if (!currentStat || String(currentStat.dev) !== node.dev || String(currentStat.ino) !== node.ino) {
        result.errors.push({ kind: 'directory_changed_after_scan', path: node.storageRelpath });
        continue;
      }
      const parentNode = directoryByPath.get(key(node.parentRelpath));
      if (parentNode && parentNode.blocked) {
        result.errors.push({ kind: 'parent_identity_ambiguous', path: node.storageRelpath });
        continue;
      }
      const parentId = parentNode
        ? (folderIds.get(key(parentNode.storageRelpath)) || (parentNode.dbRow && String(parentNode.dbRow.id)) || '')
        : '';
      if (parentNode && !parentId) {
        result.errors.push({ kind: 'parent_not_applied', path: node.storageRelpath });
        continue;
      }
      let folderId;
      if (node.dbRow) {
        folderId = String(node.dbRow.id);
        if (node.needsUpdate || String(node.dbRow.parent_id || '') !== String(parentId || '')) {
          const changed = dynamicUpdate('doc_folders', folderColumns, folderId, {
            area: node.area,
            case_id: node.caseId,
            parent_id: parentId,
            name: node.indexName,
            name_key: names.vergleichsschluessel(node.indexName),
            storage_relpath: node.storageRelpath,
            storage_dev: node.dev,
            storage_ino: node.ino,
            storage_status: 'ok',
            last_seen_at: result.appliedAt,
            updated_at: result.appliedAt
          });
          result.foldersUpdated += changed;
        }
      } else {
        folderId = String(idFactory());
        insertFolder.run({
          id: folderId,
          area: node.area,
          caseId: node.caseId,
          parentId,
          name: node.indexName,
          nameKey: names.vergleichsschluessel(node.indexName),
          storageRelpath: node.storageRelpath,
          updatedAt: result.appliedAt
        });
        result.foldersInserted++;
      }
      if (!node.dbRow) {
        dynamicUpdate('doc_folders', folderColumns, folderId, {
          storage_relpath: node.storageRelpath,
          storage_dev: node.dev,
          storage_ino: node.ino,
          storage_status: 'ok',
          last_seen_at: result.appliedAt,
          updated_at: result.appliedAt
        });
      }
      folderIds.set(key(node.storageRelpath), folderId);
      safeSidecar(path.join(node.absolute, `.ablage-folder-${folderId}.json`), {
        format: 'Betreuungsbüro-Ordner/1',
        folderId,
        area: node.area,
        caseId: node.caseId,
        name: node.indexName,
        path: node.storageRelpath,
        updatedAt: result.appliedAt
      }, result);
    }

    for (const item of report.findings || []) {
      if (item.kind !== 'missing_folder' || !item.detail || !item.detail.folderId) continue;
      const row = db.prepare('SELECT * FROM doc_folders WHERE id=?').get(String(item.detail.folderId));
      if (!row || row.storage_status === 'missing') continue;
      result.foldersMarkedMissing += dynamicUpdate(
        'doc_folders',
        folderColumns,
        String(row.id),
        { storage_status: 'missing', updated_at: result.appliedAt }
      );
    }

    const insertFile = db.prepare(`
      INSERT INTO doc_files
        (id,area,case_id,folder_id,name,name_key,mime_type,size,sha256,
         storage_relpath,storage_dev,storage_ino,storage_status,last_seen_at,
         created_at,updated_at)
      VALUES
        (@id,@area,@caseId,@folderId,@name,@nameKey,@mimeType,@size,@sha256,
         @storageRelpath,@storageDev,@storageIno,'ok',@seenAt,@createdAt,@updatedAt)
    `);
    for (const node of report.files) {
      if (node.blocked) {
        result.errors.push({ kind: 'file_identity_ambiguous', path: node.storageRelpath });
        continue;
      }
      if (node.protectedManaged || (node.dbRow && Number(node.dbRow.managed || 0) === 1)) {
        result.managedFilesSkipped = (result.managedFilesSkipped || 0) + 1;
        continue;
      }
      const stat = regularStat(node.absolute);
      if (!stat || String(stat.dev) !== node.dev || String(stat.ino) !== node.ino || stat.size !== node.size) {
        result.errors.push({ kind: 'file_changed_after_scan', path: node.storageRelpath });
        continue;
      }
      const parentId = folderIds.get(key(node.parentRelpath))
        || ((directoryByPath.get(key(node.parentRelpath)) || {}).dbRow || {}).id
        || '';
      const physicalParent = directoryByPath.get(key(node.parentRelpath));
      if (physicalParent && physicalParent.blocked) {
        result.errors.push({ kind: 'file_parent_identity_ambiguous', path: node.storageRelpath });
        continue;
      }
      if (node.area === 'case' && !parentId) {
        result.errors.push({ kind: 'file_parent_not_applied', path: node.storageRelpath });
        continue;
      }
      let hash;
      try { hash = hashFile(node.absolute); }
      catch (error) {
        result.errors.push({ kind: 'hash_error', path: node.storageRelpath, message: error.message });
        continue;
      }
      let fileId;
      if (node.dbRow) {
        fileId = String(node.dbRow.id);
        const shouldUpdate = node.needsUpdate
          || String(node.dbRow.folder_id || '') !== String(parentId || '')
          || String(node.dbRow.sha256 || '').toLowerCase() !== String(hash).toLowerCase()
          || !['ok', 'physical'].includes(String(node.dbRow.storage_status || ''));
        if (shouldUpdate) {
          const changed = dynamicUpdate('doc_files', fileColumns, fileId, {
            area: node.area,
            case_id: node.caseId,
            folder_id: String(parentId || ''),
            name: node.indexName,
            name_key: names.vergleichsschluessel(node.indexName),
            mime_type: node.dbRow.mime_type || mimeFor(node.physicalName),
            size: node.size,
            sha256: hash,
            storage_relpath: node.storageRelpath,
            storage_dev: node.dev,
            storage_ino: node.ino,
            storage_status: 'ok',
            last_seen_at: result.appliedAt,
            updated_at: result.appliedAt
          });
          result.filesUpdated += changed;
        }
      } else {
        const reusableSidecarId = node.sidecarFileId
          && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(node.sidecarFileId)
          && !db.prepare('SELECT 1 FROM doc_files WHERE id=?').get(node.sidecarFileId)
          ? node.sidecarFileId
          : '';
        fileId = reusableSidecarId || String(idFactory());
        insertFile.run({
          id: fileId,
          area: node.area,
          caseId: node.caseId,
          folderId: String(parentId || ''),
          name: node.indexName,
          nameKey: names.vergleichsschluessel(node.indexName),
          mimeType: mimeFor(node.physicalName),
          size: node.size,
          sha256: hash,
          storageRelpath: node.storageRelpath,
          storageDev: node.dev,
          storageIno: node.ino,
          seenAt: result.appliedAt,
          createdAt: new Date(stat.birthtimeMs || stat.ctimeMs).toISOString(),
          updatedAt: result.appliedAt
        });
        result.filesInserted++;
      }
      safeSidecar(path.join(path.dirname(node.absolute), `.ablage-${fileId}.json`), {
        format: 'Betreuungsbüro-Datei/1',
        fileId,
        name: node.indexName,
        path: node.storageRelpath,
        mimeType: node.dbRow && node.dbRow.mime_type ? node.dbRow.mime_type : mimeFor(node.physicalName),
        area: node.area,
        caseId: node.caseId,
        folderId: String(parentId || ''),
        size: node.size,
        sha256: hash,
        updatedAt: result.appliedAt
      }, result);
    }
    result.ok = result.errors.length === 0;
    return result;
  }

  return {
    root,
    scan,
    apply,
    _test: {
      key,
      inodeKey,
      mimeFor,
      uniqueObservedName,
      sha256File
    }
  };
}

module.exports = {
  ROOTS,
  createDocumentFinderSync,
  mimeFor,
  uniqueObservedName
};
