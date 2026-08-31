'use strict';

// Abgleich zwischen dem lesbaren Dokumentenbaum und seinem SQLite-Index.
//
// Die Factory bekommt alle umgebungsspezifischen Abhängigkeiten injiziert. Ein Scan
// verändert weder doc_files noch irgendeine Datei. Die unvermeidliche Ausnahme ist das
// Integritätsjournal selbst. apply() ändert ausschließlich eindeutig zuordenbare
// doc_files-Metadaten; diese Datei enthält absichtlich keine Lösch-, Verschiebe- oder
// Schreiboperation für Dokumente oder Sidecars.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const names = require('./names');

const SIDECAR_FORMAT = 'Betreuungsbüro-Datei/1';
const UUID_AT_START = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=$|[-.])/i;
const ABLAGE_SIDECAR = /^\.ablage-(.+)\.json$/i;
const ORPHAN_ACK_SIDECAR = /^\.ablage-waise-([0-9a-f]{16})-([0-9a-f]{8})\.json$/i;
const ORPHAN_ACK_PREFIX = /^\.ablage-waise-.*\.json$/i;
const LEGACY_SIDECAR = /\.meta\.json$/i;
const MANAGEMENT_ROOT = 'Büroorganisation/_Verwaltung & Sicherungen';
const MANAGEMENT_ORPHANS = MANAGEMENT_ROOT + '/_Technik/Waisen';
const MANAGEMENT_REPORTS = MANAGEMENT_ROOT + '/_Technik/Umstellungsberichte';

function sidecarPathFor(filePath, fileId) {
  return path.join(path.dirname(filePath), `.ablage-${String(fileId || '')}.json`);
}

function legacySidecarPathFor(filePath) {
  return String(filePath) + '.meta.json';
}

function posixPath(value) {
  return String(value || '').split(path.sep).join('/').replace(/\\/g, '/');
}

function cleanRelative(value) {
  const raw = posixPath(value);
  if (!raw || raw === '.') return '';
  if (path.posix.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    throw new Error('Absoluter Speicherpfad ist unzulässig.');
  }
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Speicherpfad verlässt die Dokumentenwurzel.');
  }
  return parts.join('/');
}

function isInside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

function pathKey(value) {
  return posixPath(value).normalize('NFC').toLocaleLowerCase('de-DE');
}

function belowPath(relpath, parent) {
  const actual = pathKey(relpath);
  const wanted = pathKey(parent).replace(/\/+$/, '');
  return actual === wanted || actual.startsWith(wanted + '/');
}

function inodeKey(statOrDev, ino) {
  const dev = statOrDev && typeof statOrDev === 'object' ? statOrDev.dev : statOrDev;
  const inode = statOrDev && typeof statOrDev === 'object' ? statOrDev.ino : ino;
  if (dev === undefined || dev === null || inode === undefined || inode === null) return '';
  const left = String(dev);
  const right = String(inode);
  return left && right ? `${left}:${right}` : '';
}

function asIso(value) {
  const raw = typeof value === 'function' ? value() : value;
  if (raw instanceof Date) return raw.toISOString();
  const parsed = new Date(raw == null ? Date.now() : raw);
  if (Number.isNaN(parsed.getTime())) throw new Error('Ungültiger Zeitwert für den Dokumentabgleich.');
  return parsed.toISOString();
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => (
    typeof item === 'bigint' ? String(item) : item
  )));
}

async function sha256File(filePath) {
  const before = await fs.promises.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error('Prüfsumme nur für reguläre Dateien zulässig.');
  }
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

function canonicalSidecar(row, storageRelpath, size, sha256) {
  return {
    format: SIDECAR_FORMAT,
    fileId: String(row.id || ''),
    name: String(row.name || '').normalize('NFC'),
    path: posixPath(storageRelpath),
    mimeType: String(row.mime_type || row.mimeType || ''),
    area: String(row.area || ''),
    caseId: String(row.case_id || row.caseId || ''),
    folderId: String(row.folder_id || row.folderId || ''),
    size: Number(size),
    sha256: String(sha256 || '').toLowerCase()
  };
}

function sidecarDifferences(metadata, expected) {
  const differences = [];
  const fields = ['format', 'fileId', 'name', 'path', 'mimeType', 'area', 'caseId', 'folderId', 'size', 'sha256'];
  for (const field of fields) {
    const present = Object.prototype.hasOwnProperty.call(metadata, field);
    let actual = present ? metadata[field] : undefined;
    let wanted = expected[field];
    if (field === 'size') {
      actual = present ? Number(actual) : undefined;
      wanted = Number(wanted);
    } else {
      actual = present ? String(actual == null ? '' : actual) : undefined;
      wanted = String(wanted == null ? '' : wanted);
      if (field === 'name' || field === 'path') {
        actual = actual === undefined ? undefined : posixPath(actual).normalize('NFC');
        wanted = posixPath(wanted).normalize('NFC');
      }
      if (field === 'sha256') actual = actual === undefined ? undefined : actual.toLowerCase();
    }
    if (!present || actual !== wanted) {
      differences.push({
        field,
        reason: present ? 'abweichend' : 'fehlt',
        expected: wanted,
        actual
      });
    }
  }
  return differences;
}

/*
Factory:
  createDocumentReconciler({ db, storageRoot, resolver, legacyRoots?, ... })

Resolver vorwärts:
  Funktion oder expectedPath/resolve/pathFor(row) -> Pfad oder
  { filePath | path | storageRelpath, sidecarPath? }.
  Ohne eigene Vorwärtsmethode wird row.storage_relpath unter storageRoot verwendet.

Resolver rückwärts (optional):
  fromStoragePath/fromPath/reverse(relpath, row) ->
  { name, area, caseId, folderId, resolved? }.
  Ohne Rückwärtsmethode wird der Zielordner eindeutig über
  doc_folders.storage_relpath bestimmt.

scan() und apply() sind asynchron. Beide journalisieren; nur apply() darf doc_files ändern.
*/
function createDocumentReconciler(options) {
  const opt = options || {};
  if (!opt.db || typeof opt.db.prepare !== 'function') {
    throw new Error('document-reconcile benötigt eine injizierte Datenbank.');
  }
  if (!opt.storageRoot) {
    throw new Error('document-reconcile benötigt eine injizierte storageRoot.');
  }
  if (!opt.resolver) {
    throw new Error('document-reconcile benötigt einen injizierten Resolver.');
  }

  const db = opt.db;
  const resolver = opt.resolver;
  const rootValue = typeof opt.storageRoot === 'function' ? opt.storageRoot() : opt.storageRoot;
  const storageRoot = path.resolve(String(rootValue));
  const configuredLegacyRoots = Array.isArray(opt.legacyRoots) ? opt.legacyRoots : [];
  const clock = opt.now || (() => new Date());
  const idFactory = opt.idFactory || (() => crypto.randomUUID());
  const customSidecarPath = opt.sidecarPath
    || (resolver && typeof resolver.sidecarPath === 'function' ? resolver.sidecarPath.bind(resolver) : null);
  const parseSidecar = opt.parseSidecar
    || (resolver && typeof resolver.parseSidecar === 'function' ? resolver.parseSidecar.bind(resolver) : null)
    || ((raw) => JSON.parse(raw));

  const tableColumns = new Set(
    db.prepare('PRAGMA table_info(doc_files)').all().map((column) => String(column.name))
  );
  const runInsert = db.prepare(`
    INSERT INTO doc_integrity_runs (id, mode, started_at, status, summary_json)
    VALUES (?, ?, ?, 'running', '{}')
  `);
  const runFinish = db.prepare(`
    UPDATE doc_integrity_runs
       SET finished_at=?, status=?, summary_json=?
     WHERE id=?
  `);
  const findingInsert = db.prepare(`
    INSERT INTO doc_integrity_findings
      (run_id, seq, kind, file_id, storage_relpath, detail_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  function resolveLegacyRoots(extra) {
    const roots = [...configuredLegacyRoots, ...(Array.isArray(extra) ? extra : [])]
      .filter((value) => value !== undefined && value !== null && String(value));
    return [...new Set(roots.map((value) => path.resolve(String(value))))];
  }

  function resolverCall(row) {
    const context = { storageRoot, row };
    if (typeof resolver === 'function') return resolver(row, context);
    if (typeof resolver.expectedPath === 'function') return resolver.expectedPath(row, context);
    if (typeof resolver.resolve === 'function') return resolver.resolve(row, context);
    if (typeof resolver.pathFor === 'function') return resolver.pathFor(row, context);
    if (row.storage_relpath) return { storageRelpath: row.storage_relpath };
    if (typeof resolver.findBlobPath === 'function') return resolver.findBlobPath(row);
    return null;
  }

  function resolveRow(row, legacyRoots) {
    const raw = resolverCall(row);
    if (!raw) return null;
    const data = typeof raw === 'string' ? { path: raw } : raw;
    let absolute;
    let relative = data.storageRelpath || data.storage_relpath || data.relpath || '';
    const candidate = data.filePath || data.absolutePath || data.path || '';
    if (candidate && path.isAbsolute(String(candidate))) {
      absolute = path.resolve(String(candidate));
    } else if (candidate) {
      relative = relative || candidate;
      absolute = path.resolve(storageRoot, ...cleanRelative(relative).split('/').filter(Boolean));
    } else if (relative) {
      absolute = path.resolve(storageRoot, ...cleanRelative(relative).split('/').filter(Boolean));
    } else {
      return null;
    }
    const allowed = [storageRoot, ...legacyRoots].some((allowedRoot) => isInside(allowedRoot, absolute));
    if (!allowed) throw new Error('Resolver lieferte einen Pfad außerhalb der erlaubten Wurzeln.');
    if (!relative && isInside(storageRoot, absolute)) {
      relative = cleanRelative(posixPath(path.relative(storageRoot, absolute)));
    } else if (relative) {
      relative = cleanRelative(relative);
    }
    return {
      absolute,
      storageRelpath: relative,
      sidecarPath: data.sidecarPath || data.sidecar_path || ''
    };
  }

  function expectedSidecarPath(filePath, fileId, explicit) {
    if (explicit) return path.resolve(String(explicit));
    if (customSidecarPath) return path.resolve(String(customSidecarPath(filePath, fileId)));
    return sidecarPathFor(filePath, fileId);
  }

  function updateDocFile(fileId, patch) {
    const allowedPatch = {};
    for (const [column, value] of Object.entries(patch || {})) {
      if (tableColumns.has(column) && value !== undefined) allowedPatch[column] = value;
    }
    const columns = Object.keys(allowedPatch);
    if (!columns.length) return 0;
    const sql = `UPDATE doc_files SET ${columns.map((column) => `${column}=@${column}`).join(', ')} WHERE id=@id`;
    return db.prepare(sql).run({ id: fileId, ...allowedPatch }).changes;
  }

  function readFolders() {
    try {
      return db.prepare('SELECT id, area, case_id, storage_relpath FROM doc_folders').all();
    } catch (_error) {
      return [];
    }
  }

  function activeRow(row) {
    return row.deleted_at === undefined || row.deleted_at === null || String(row.deleted_at) === '';
  }

  function makeSummary(mode, filesChecked, diskFiles, findings, extra) {
    const counts = {};
    for (const finding of findings) counts[finding.kind] = (counts[finding.kind] || 0) + 1;
    return {
      mode,
      filesChecked,
      diskFiles,
      findingCount: findings.length,
      counts,
      ...(extra || {})
    };
  }

  function persistFindings(runId, findings, useTransaction) {
    const write = () => {
      findings.forEach((finding, index) => {
        findingInsert.run(
          runId,
          index + 1,
          finding.kind,
          String(finding.fileId || ''),
          String(finding.storageRelpath || ''),
          JSON.stringify(jsonSafe(finding.detail || {}))
        );
      });
    };
    if (useTransaction !== false && typeof db.transaction === 'function') db.transaction(write)();
    else write();
  }

  async function discover(runId, mode, runOptions) {
    const findings = [];
    const reportedSymlinks = new Set();
    const hashCache = new Map();
    const sidecarCache = new Map();
    const legacyRoots = resolveLegacyRoots(runOptions && runOptions.legacyRoots);

    function finding(kind, fileId, storageRelpath, detail) {
      const item = {
        kind,
        fileId: String(fileId || ''),
        storageRelpath: String(storageRelpath || ''),
        detail: jsonSafe(detail || {})
      };
      findings.push(item);
      return item;
    }

    async function walk(root, origin) {
      const files = [];
      const sidecars = [];
      const absoluteRoot = path.resolve(root);
      let available = true;

      async function visit(current) {
        let stat;
        try {
          stat = await fs.promises.lstat(current);
        } catch (error) {
          if (error && error.code === 'ENOENT' && current === absoluteRoot) {
            available = false;
            finding('scan_root_missing', '', '', { root: absoluteRoot, origin });
            return;
          }
          finding('scan_error', '', '', { path: current, origin, code: error && error.code, message: error && error.message });
          return;
        }
        if (stat.isSymbolicLink()) {
          if (current === absoluteRoot) available = false;
          if (!reportedSymlinks.has(current)) {
            reportedSymlinks.add(current);
            finding('symlink_ignored', '', '', {
              path: current,
              relativePath: posixPath(path.relative(absoluteRoot, current)),
              origin
            });
          }
          return;
        }
        if (current === absoluteRoot && !stat.isDirectory()) {
          available = false;
          finding('scan_root_invalid', '', '', {
            root: absoluteRoot,
            origin,
            reason: 'not_a_directory'
          });
          return;
        }
        if (stat.isDirectory()) {
          let entries;
          try {
            entries = await fs.promises.readdir(current);
          } catch (error) {
            finding('scan_error', '', '', { path: current, origin, code: error && error.code, message: error && error.message });
            return;
          }
          for (const entry of entries.sort((left, right) => names.deutschVergleichen(left, right))) {
            if (entry === '.ablage-speicherkennung.json') continue;
            await visit(path.join(current, entry));
          }
          return;
        }
        if (!stat.isFile()) {
          finding('special_file_ignored', '', '', { path: current, origin });
          return;
        }
        const relpath = cleanRelative(posixPath(path.relative(absoluteRoot, current)));
        const entry = {
          absolute: current,
          relpath,
          origin,
          root: absoluteRoot,
          stat,
          inode: inodeKey(stat)
        };
        if (ABLAGE_SIDECAR.test(path.basename(current)) || LEGACY_SIDECAR.test(path.basename(current))) sidecars.push(entry);
        else files.push(entry);
      }

      await visit(absoluteRoot);
      return { root: absoluteRoot, files, sidecars, available };
    }

    async function hash(entry) {
      if (!hashCache.has(entry.absolute)) {
        hashCache.set(entry.absolute, sha256File(entry.absolute));
      }
      return hashCache.get(entry.absolute);
    }

    async function readSidecar(entry, context) {
      if (!entry) return { status: 'missing', metadata: null, entry: null };
      if (sidecarCache.has(entry.absolute)) return sidecarCache.get(entry.absolute);
      let stat;
      try {
        stat = entry.stat || await fs.promises.lstat(entry.absolute);
      } catch (error) {
        const result = { status: error && error.code === 'ENOENT' ? 'missing' : 'error', metadata: null, entry, error };
        sidecarCache.set(entry.absolute, result);
        return result;
      }
      if (stat.isSymbolicLink()) {
        if (!reportedSymlinks.has(entry.absolute)) {
          reportedSymlinks.add(entry.absolute);
          finding('symlink_ignored', context && context.fileId, context && context.storageRelpath, {
            path: entry.absolute,
            origin: 'sidecar'
          });
        }
        const result = { status: 'symlink', metadata: null, entry };
        sidecarCache.set(entry.absolute, result);
        return result;
      }
      if (!stat.isFile()) {
        const result = { status: 'invalid_type', metadata: null, entry };
        sidecarCache.set(entry.absolute, result);
        return result;
      }
      try {
        const raw = await fs.promises.readFile(entry.absolute, 'utf8');
        const metadata = await Promise.resolve(parseSidecar(raw, {
          path: entry.absolute,
          fileId: context && context.fileId,
          storageRelpath: context && context.storageRelpath
        }));
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
          throw new Error('Sidecar enthält kein JSON-Objekt.');
        }
        const result = { status: 'ok', metadata, entry };
        sidecarCache.set(entry.absolute, result);
        return result;
      } catch (error) {
        const result = { status: 'invalid', metadata: null, entry, error };
        sidecarCache.set(entry.absolute, result);
        return result;
      }
    }

    function entryAt(absolute, entriesByPath) {
      return entriesByPath.get(path.resolve(absolute)) || null;
    }

    const primary = await walk(storageRoot, 'storage');
    const legacyScans = [];
    for (const legacyRoot of legacyRoots) {
      if (path.resolve(legacyRoot) === storageRoot) continue;
      legacyScans.push(await walk(legacyRoot, 'legacy'));
    }
    const primaryEntries = primary.files;
    const allScannedEntries = primaryEntries.concat(...legacyScans.map((scan) => scan.files));
    const entriesByPath = new Map(allScannedEntries.map((entry) => [path.resolve(entry.absolute), entry]));
    const primaryByInode = new Map();
    for (const entry of primaryEntries) {
      if (!primaryByInode.has(entry.inode)) primaryByInode.set(entry.inode, []);
      primaryByInode.get(entry.inode).push(entry);
    }

    const allSidecarEntries = primary.sidecars.concat(...legacyScans.map((scan) => scan.sidecars));
    const sidecarEntriesByPath = new Map(
      allSidecarEntries.map((entry) => [path.resolve(entry.absolute), entry])
    );
    const acknowledgedOrphanFiles = new Set();
    let acknowledgedOrphanReferences = 0;
    const orphanAckSidecars = new Set();
    const technicalManagementFiles = new Set();
    const primaryByRelpath = new Map(primaryEntries.map((entry) => [entry.relpath, entry]));
    const rows = db.prepare('SELECT * FROM doc_files').all();
    const activeRows = rows.filter(activeRow);
    const indexedByStoragePath = new Map(
      activeRows
        .filter((row) => String(row.storage_relpath || ''))
        .map((row) => [pathKey(row.storage_relpath), row])
    );

    async function readJsonObject(entry) {
      try {
        const raw = await fs.promises.readFile(entry.absolute, 'utf8');
        const value = JSON.parse(raw);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
      } catch (_error) {
        return null;
      }
    }

    // Waisen aus dem Umstellungslauf sind absichtlich nicht Teil des Dokumentindex.
    // Der Beipackzettel quittiert genau eine Datei erst dann, wenn Pfad, Größe und
    // Prüfsumme zusammenpassen. Ein bloß passend benannter JSON-Sidecar darf niemals
    // eine unbekannte Datei vor dem Abgleich verstecken.
    for (const sidecarEntry of primary.sidecars) {
      const basename = path.basename(sidecarEntry.absolute);
      if (!ORPHAN_ACK_PREFIX.test(basename)) continue;
      orphanAckSidecars.add(sidecarEntry.absolute);
      const metadata = await readJsonObject(sidecarEntry);
      const filenameMatch = ORPHAN_ACK_SIDECAR.exec(basename);
      const problems = [];
      let storedPath = '';
      try {
        storedPath = metadata && metadata.storedPath ? cleanRelative(metadata.storedPath) : '';
      } catch (_error) {
        problems.push('stored_path_invalid');
      }
      const target = storedPath ? primaryByRelpath.get(storedPath) : null;
      const deduplicated = !!(metadata && metadata.deduplicated === true);
      const indexedTarget = storedPath ? indexedByStoragePath.get(pathKey(storedPath)) : null;
      if (!belowPath(sidecarEntry.relpath, MANAGEMENT_ORPHANS)) problems.push('outside_orphan_area');
      if (!metadata || metadata.format !== 'Betreuungsbüro-Waise/1') problems.push('format_invalid');
      if (!filenameMatch) problems.push('filename_invalid');
      if (!storedPath || !target) problems.push('stored_file_missing');
      if (!deduplicated && target
        && path.posix.dirname(storedPath) !== path.posix.dirname(sidecarEntry.relpath)) {
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
        const actualSha = await hash(target);
        if (actualSha !== expectedSha) problems.push('sha256_mismatch');
        if (filenameMatch && !actualSha.startsWith(filenameMatch[1].toLowerCase())) {
          problems.push('filename_hash_mismatch');
        }
      }
      if (!problems.length) {
        if (deduplicated) acknowledgedOrphanReferences++;
        else acknowledgedOrphanFiles.add(target.absolute);
      } else {
        finding('orphan_ack_invalid', '', sidecarEntry.relpath, {
          path: sidecarEntry.absolute,
          storedPath,
          deduplicated,
          problems: [...new Set(problems)]
        });
      }
    }

    // Nur ein strukturell gültiger JSON-Bericht legitimiert sich selbst und den
    // gleichnamigen Klartextbericht als technische Datei. Andere Dateien im
    // Berichtsordner bleiben sichtbar.
    for (const entry of primaryEntries) {
      if (path.posix.dirname(entry.relpath) !== MANAGEMENT_REPORTS
        || path.posix.extname(entry.relpath).toLowerCase() !== '.json') continue;
      const metadata = await readJsonObject(entry);
      if (!metadata || metadata.format !== 'Betreuungsbüro-Umstellungsbericht/1'
        || typeof metadata.runId !== 'string' || !metadata.runId
        || typeof metadata.status !== 'string' || !metadata.status
        || !Array.isArray(metadata.entries)
        || !metadata.summary || typeof metadata.summary !== 'object' || Array.isArray(metadata.summary)) {
        continue;
      }
      technicalManagementFiles.add(entry.absolute);
      const textRelpath = entry.relpath.slice(0, -5) + '.txt';
      const textEntry = primaryByRelpath.get(textRelpath);
      if (textEntry) technicalManagementFiles.add(textEntry.absolute);
    }

    const candidatePrimaryEntries = primaryEntries.filter((entry) => (
      !belowPath(entry.relpath, MANAGEMENT_ROOT)
    ));
    primaryByInode.clear();
    for (const entry of candidatePrimaryEntries) {
      if (!primaryByInode.has(entry.inode)) primaryByInode.set(entry.inode, []);
      primaryByInode.get(entry.inode).push(entry);
    }

    const parsedSidecars = [];
    for (const sidecarEntry of allSidecarEntries) {
      if (path.basename(sidecarEntry.absolute) === '.ablage-fall.json') continue;
      if (orphanAckSidecars.has(sidecarEntry.absolute)) continue;
      const parsed = await readSidecar(sidecarEntry, {});
      if (parsed.status === 'invalid') {
        finding('sidecar_invalid', '', sidecarEntry.relpath, {
          path: sidecarEntry.absolute,
          message: parsed.error && parsed.error.message
        });
      } else if (parsed.status === 'ok') {
        parsedSidecars.push(parsed);
        for (const field of ['name', 'path']) {
          const value = parsed.metadata[field];
          if (typeof value === 'string' && value !== value.normalize('NFC')) {
            finding('unicode_not_nfc', parsed.metadata.fileId, sidecarEntry.relpath, {
              source: `sidecar_${field}`,
              actual: value,
              normalized: value.normalize('NFC'),
              sidecarPath: sidecarEntry.absolute
            });
          }
        }
      }
    }
    const sidecarsById = new Map();
    for (const parsed of parsedSidecars) {
      const id = String(parsed.metadata.fileId || '');
      if (!id) {
        finding('sidecar_mismatch', '', parsed.entry.relpath, {
          path: parsed.entry.absolute,
          differences: [{ field: 'fileId', reason: 'fehlt', expected: 'doc_files.id' }]
        });
        continue;
      }
      if (!sidecarsById.has(id)) sidecarsById.set(id, []);
      sidecarsById.get(id).push(parsed);
    }
    for (const [fileId, sidecars] of sidecarsById) {
      if (sidecars.length > 1) {
        finding('sidecar_id_collision', fileId, '', {
          paths: sidecars.map((item) => item.entry.absolute)
        });
      }
    }

    const physicalKeys = new Map();
    for (const entry of primaryEntries) {
      const key = pathKey(entry.relpath);
      if (!physicalKeys.has(key)) physicalKeys.set(key, []);
      physicalKeys.get(key).push(entry);
    }
    for (const entries of physicalKeys.values()) {
      if (entries.length > 1) {
        finding('filesystem_collision', '', '', {
          paths: entries.map((entry) => entry.relpath),
          comparison: 'NFC + case-insensitive de-DE'
        });
      }
    }

    const allIds = new Set(rows.map((row) => String(row.id)));
    const allUuidIds = new Set(rows.map((row) => String(row.id).toLowerCase()));
    const resolutions = new Map();
    const ownedPath = new Map();
    for (const row of activeRows) {
      try {
        const resolution = resolveRow(row, legacyRoots);
        resolutions.set(String(row.id), resolution);
        if (resolution) {
          const key = path.resolve(resolution.absolute);
          if (!ownedPath.has(key)) ownedPath.set(key, []);
          ownedPath.get(key).push(row);
        }
      } catch (error) {
        resolutions.set(String(row.id), null);
        finding('resolver_error', row.id, row.storage_relpath, { message: error.message });
      }
    }

    for (const [absolute, owners] of ownedPath) {
      if (owners.length > 1) {
        for (const owner of owners) {
          finding('path_collision', owner.id, owner.storage_relpath, {
            path: absolute,
            fileIds: owners.map((row) => String(row.id))
          });
        }
      }
    }

    const linkedEntries = new Set();
    const unicodeReported = new Set();
    const states = [];

    async function hasSymlinkComponent(candidate, fileId, storageRelpath) {
      const roots = [storageRoot, ...legacyRoots]
        .filter((root) => isInside(root, candidate))
        .sort((left, right) => right.length - left.length);
      if (!roots.length) return false;
      const base = roots[0];
      const parts = path.relative(base, candidate).split(path.sep).filter(Boolean);
      let current = base;
      for (const part of ['', ...parts]) {
        if (part) current = path.join(current, part);
        let stat;
        try {
          stat = await fs.promises.lstat(current);
        } catch (error) {
          if (error && error.code === 'ENOENT') return false;
          throw error;
        }
        if (stat.isSymbolicLink()) {
          if (!reportedSymlinks.has(current)) {
            reportedSymlinks.add(current);
            finding('symlink_ignored', fileId, storageRelpath, {
              path: current,
              origin: 'resolved_path_component'
            });
          }
          return true;
        }
      }
      return false;
    }

    async function sidecarForTracked(row, resolution, entry) {
      const preferred = expectedSidecarPath(entry.absolute, row.id, resolution && resolution.sidecarPath);
      let candidate = entryAt(preferred, sidecarEntriesByPath);
      if (!candidate) {
        try {
          const stat = await fs.promises.lstat(preferred);
          candidate = { absolute: preferred, stat, relpath: posixPath(path.relative(storageRoot, preferred)), origin: 'sidecar' };
        } catch (_error) { /* Fallbacks folgen */ }
      }
      if (!candidate) {
        const sameDirectory = (sidecarsById.get(String(row.id)) || [])
          .filter((item) => path.dirname(item.entry.absolute) === path.dirname(entry.absolute));
        if (sameDirectory.length === 1) return sameDirectory[0];
        const fallback = legacySidecarPathFor(entry.absolute);
        try {
          const stat = await fs.promises.lstat(fallback);
          candidate = { absolute: fallback, stat, relpath: posixPath(path.relative(storageRoot, fallback)), origin: 'legacy-sidecar' };
        } catch (_error) { /* fehlt */ }
      }
      return candidate ? readSidecar(candidate, { fileId: row.id, storageRelpath: entry.relpath }) : { status: 'missing' };
    }

    async function reportTrackedSidecar(row, resolution, entry, actualSha, actualName) {
      const sidecar = await sidecarForTracked(row, resolution, entry);
      if (!sidecar || sidecar.status === 'missing') {
        finding('sidecar_missing', row.id, entry.relpath, {
          expectedPath: expectedSidecarPath(entry.absolute, row.id, resolution && resolution.sidecarPath)
        });
      } else if (sidecar.status !== 'ok') {
        finding('sidecar_invalid', row.id, entry.relpath, {
          path: sidecar.entry && sidecar.entry.absolute,
          status: sidecar.status,
          message: sidecar.error && sidecar.error.message
        });
      } else {
        const sidecarRow = actualName === undefined
          ? row
          : { ...row, name: String(actualName).normalize('NFC') };
        const expected = canonicalSidecar(sidecarRow, entry.relpath, entry.stat.size, actualSha);
        const differences = sidecarDifferences(sidecar.metadata, expected);
        if (differences.length) {
          finding('sidecar_mismatch', row.id, entry.relpath, {
            path: sidecar.entry.absolute,
            differences
          });
        }
      }
      return sidecar;
    }

    for (const row of activeRows) {
      const resolution = resolutions.get(String(row.id));
      if (String(row.name || '') !== String(row.name || '').normalize('NFC')) {
        finding('unicode_not_nfc', row.id, row.storage_relpath, {
          source: 'database_name',
          actual: row.name,
          normalized: String(row.name || '').normalize('NFC')
        });
      }
      if (String(row.storage_relpath || '') !== String(row.storage_relpath || '').normalize('NFC')) {
        finding('unicode_not_nfc', row.id, row.storage_relpath, {
          source: 'database_storage_relpath',
          actual: row.storage_relpath,
          normalized: String(row.storage_relpath || '').normalize('NFC')
        });
      }
      if (!resolution) {
        finding('resolver_unresolved', row.id, row.storage_relpath, {
          reason: 'no_expected_path'
        });
        states.push({ row, resolution: null, entry: null, sidecar: null, actualSha: '', proposal: null });
        continue;
      }

      let entry = entriesByPath.get(path.resolve(resolution.absolute)) || null;
      if (!entry) {
        try {
          const unsafePath = await hasSymlinkComponent(
            resolution.absolute,
            row.id,
            resolution.storageRelpath
          );
          const stat = unsafePath ? null : await fs.promises.lstat(resolution.absolute);
          if (!stat) {
            states.push({ row, resolution, entry: null, sidecar: null, actualSha: '', proposal: null });
            finding('missing', row.id, resolution.storageRelpath, {
              expectedPath: resolution.absolute,
              reason: 'symlink_ignored'
            });
            continue;
          }
          if (stat.isSymbolicLink()) {
            if (!reportedSymlinks.has(resolution.absolute)) {
              reportedSymlinks.add(resolution.absolute);
              finding('symlink_ignored', row.id, resolution.storageRelpath, { path: resolution.absolute, origin: 'resolved_file' });
            }
          } else if (stat.isFile()) {
            const inPrimary = isInside(storageRoot, resolution.absolute);
            const inodeMatches = inPrimary ? (primaryByInode.get(inodeKey(stat)) || []) : [];
            // Auf case-insensitiven bzw. normalisierenden Dateisystemen kann lstat("bericht")
            // erfolgreich "Bericht" öffnen. Dieser Alias ist noch kein Identitätsbeweis und
            // wird deshalb erst unten über Sidecar, gespeicherten Inode oder SHA+Größe geprüft.
            if (!inPrimary || inodeMatches.length === 0) {
              entry = {
                absolute: resolution.absolute,
                relpath: resolution.storageRelpath,
                origin: inPrimary ? 'storage' : 'legacy',
                root: inPrimary ? storageRoot : path.dirname(resolution.absolute),
                stat,
                inode: inodeKey(stat)
              };
            }
          }
        } catch (error) {
          if (!error || error.code !== 'ENOENT') {
            finding('scan_error', row.id, resolution.storageRelpath, {
              path: resolution.absolute,
              code: error && error.code,
              message: error && error.message
            });
          }
        }
      }

      if (!entry) {
        finding('missing', row.id, resolution.storageRelpath, { expectedPath: resolution.absolute });
        states.push({ row, resolution, entry: null, sidecar: null, actualSha: '', proposal: null });
        continue;
      }

      linkedEntries.add(entry.absolute);
      const actualRelpath = entry.origin === 'storage'
        ? cleanRelative(posixPath(path.relative(storageRoot, entry.absolute)))
        : resolution.storageRelpath;
      entry.relpath = actualRelpath;
      if (actualRelpath !== actualRelpath.normalize('NFC')) {
        unicodeReported.add(entry.absolute);
        finding('unicode_not_nfc', row.id, actualRelpath, {
          source: 'filesystem_path',
          actual: actualRelpath,
          normalized: actualRelpath.normalize('NFC')
        });
      }
      if (Number(row.size) !== Number(entry.stat.size)) {
        finding('size_mismatch', row.id, actualRelpath, {
          expected: Number(row.size),
          actual: Number(entry.stat.size)
        });
      }
      const actualSha = await hash(entry);
      if (!String(row.sha256 || '')) {
        finding('sha256_missing', row.id, actualRelpath, { actual: actualSha });
      } else if (String(row.sha256).toLowerCase() !== actualSha) {
        finding('sha256_mismatch', row.id, actualRelpath, {
          expected: String(row.sha256).toLowerCase(),
          actual: actualSha
        });
      }

      const sidecar = await reportTrackedSidecar(row, resolution, entry, actualSha);
      states.push({ row, resolution, entry, sidecar, actualSha, proposal: null });
    }

    for (const entry of primaryEntries) {
      if (entry.relpath !== entry.relpath.normalize('NFC') && !unicodeReported.has(entry.absolute)) {
        finding('unicode_not_nfc', '', entry.relpath, {
          source: 'filesystem_path',
          actual: entry.relpath,
          normalized: entry.relpath.normalize('NFC')
        });
      }
    }

    for (const scan of legacyScans) {
      for (const entry of scan.files) {
        const match = UUID_AT_START.exec(path.basename(entry.absolute));
        if (match && !allUuidIds.has(match[1].toLowerCase())) {
          finding('legacy_orphan', '', entry.relpath, {
            path: entry.absolute,
            legacyRoot: scan.root,
            legacyId: match[1],
            size: entry.stat.size
          });
        }
      }
    }

    for (const parsed of parsedSidecars) {
      const id = String(parsed.metadata.fileId || '');
      if (id && !allIds.has(id)) {
        finding('orphan_sidecar', id, parsed.entry.relpath, { path: parsed.entry.absolute });
      }
    }

    const primaryByPath = new Map(candidatePrimaryEntries.map((entry) => [path.resolve(entry.absolute), entry]));
    const expectedOwner = new Map();
    for (const row of activeRows) {
      const resolution = resolutions.get(String(row.id));
      if (!resolution) continue;
      const key = pathKey(path.resolve(resolution.absolute));
      if (!expectedOwner.has(key)) expectedOwner.set(key, []);
      expectedOwner.get(key).push(String(row.id));
    }

    async function candidatesFromSidecar(row) {
      const parsed = sidecarsById.get(String(row.id)) || [];
      const candidates = new Map();
      for (const item of parsed) {
        const metadata = item.metadata;
        if (metadata.path) {
          try {
            const absolute = path.resolve(storageRoot, ...cleanRelative(metadata.path).split('/'));
            const entry = primaryByPath.get(absolute);
            if (entry) candidates.set(entry.absolute, entry);
          } catch (_error) { /* Abweichung wurde separat gemeldet */ }
        }
        if (metadata.name) {
          const entry = primaryByPath.get(path.resolve(path.dirname(item.entry.absolute), String(metadata.name)));
          if (entry) candidates.set(entry.absolute, entry);
        }
        const wantedSize = Number(metadata.size);
        const wantedSha = String(metadata.sha256 || '').toLowerCase();
        if (Number.isFinite(wantedSize) && wantedSha) {
          const sameDirectory = candidatePrimaryEntries.filter((entry) => (
            path.dirname(entry.absolute) === path.dirname(item.entry.absolute)
            && Number(entry.stat.size) === wantedSize
          ));
          for (const entry of sameDirectory) {
            if (await hash(entry) === wantedSha) candidates.set(entry.absolute, entry);
          }
        }
      }
      return [...candidates.values()];
    }

    async function candidateFor(state) {
      const row = state.row;
      const expected = state.resolution && path.resolve(state.resolution.absolute);
      if (state.entry && expected === path.resolve(state.entry.absolute)) return null;

      const matchingSidecars = sidecarsById.get(String(row.id)) || [];
      if (matchingSidecars.length > 1) {
        return {
          status: 'conflict',
          method: 'sidecar_id',
          candidates: await candidatesFromSidecar(row)
        };
      }
      let candidates = await candidatesFromSidecar(row);
      if (candidates.length > 1) return { status: 'conflict', method: 'sidecar_id', candidates };
      if (candidates.length === 1) return { status: 'unique', method: 'sidecar_id', entry: candidates[0] };

      const storedInode = inodeKey(row.storage_dev, row.storage_ino);
      if (storedInode) {
        candidates = primaryByInode.get(storedInode) || [];
        if (candidates.length > 1) return { status: 'conflict', method: 'dev_ino', candidates };
        if (candidates.length === 1) return { status: 'unique', method: 'dev_ino', entry: candidates[0] };
      }

      const expectedSize = Number(row.size);
      const expectedSha = String(row.sha256 || '').toLowerCase();
      if (Number.isFinite(expectedSize) && expectedSha) {
        candidates = [];
        for (const entry of candidatePrimaryEntries) {
          if (Number(entry.stat.size) !== expectedSize) continue;
          if (await hash(entry) === expectedSha) candidates.push(entry);
        }
        if (candidates.length > 1) return { status: 'conflict', method: 'sha256_size', candidates };
        if (candidates.length === 1) return { status: 'unique', method: 'sha256_size', entry: candidates[0] };
      }
      return null;
    }

    for (const state of states) {
      if (state.entry && state.resolution
        && path.resolve(state.entry.absolute) === path.resolve(state.resolution.absolute)) continue;
      const proposal = await candidateFor(state);
      state.proposal = proposal;
      if (!proposal) continue;
      if (proposal.status === 'conflict') {
        finding('reconcile_conflict', state.row.id, state.row.storage_relpath, {
          reason: 'candidate_not_unique',
          method: proposal.method,
          candidates: proposal.candidates.map((entry) => entry.relpath)
        });
        continue;
      }
      const owners = expectedOwner.get(pathKey(path.resolve(proposal.entry.absolute))) || [];
      const otherOwners = owners.filter((id) => id !== String(state.row.id));
      if (otherOwners.length) {
        proposal.status = 'conflict';
        proposal.reason = 'candidate_owned';
        finding('reconcile_conflict', state.row.id, proposal.entry.relpath, {
          reason: 'candidate_owned',
          method: proposal.method,
          ownerFileIds: otherOwners
        });
        continue;
      }
      const candidateSha = await hash(proposal.entry);
      linkedEntries.add(proposal.entry.absolute);
      state.sidecar = await reportTrackedSidecar(
        state.row,
        state.resolution,
        proposal.entry,
        candidateSha,
        path.posix.basename(proposal.entry.relpath)
      );
      state.actualSha = candidateSha;
      finding('relocation_detected', state.row.id, proposal.entry.relpath, {
        method: proposal.method,
        previousPath: state.resolution && state.resolution.storageRelpath,
        actualPath: proposal.entry.relpath
      });
    }

    const indexedPathKeys = new Set(rows
      .map((row) => String(row.storage_relpath || ''))
      .filter(Boolean)
      .map(pathKey));
    for (const entry of primaryEntries) {
      if (linkedEntries.has(entry.absolute)
        || indexedPathKeys.has(pathKey(entry.relpath))
        || acknowledgedOrphanFiles.has(entry.absolute)
        || technicalManagementFiles.has(entry.absolute)) {
        continue;
      }
      const inManagement = belowPath(entry.relpath, MANAGEMENT_ROOT);
      finding(
        inManagement ? 'management_unindexed_file' : 'unindexed_file',
        '',
        entry.relpath,
        {
          path: entry.absolute,
          size: entry.stat.size,
          automaticImport: false,
          managementArea: inManagement
        }
      );
    }

    return {
      runId,
      mode,
      findings,
      states,
      rows,
      activeRows,
      folders: readFolders(),
      primaryEntries,
      storageAvailable: primary.available,
      filesChecked: activeRows.length,
      diskFiles: primaryEntries.length,
      acknowledgedOrphans: acknowledgedOrphanFiles.size + acknowledgedOrphanReferences,
      acknowledgedOrphanReferences,
      technicalManagementFiles: technicalManagementFiles.size
    };
  }

  async function reverseResolve(relpath, row, folders) {
    const context = { storageRoot, relpath, row };
    let raw = null;
    if (resolver && typeof resolver.fromStoragePath === 'function') {
      raw = await Promise.resolve(resolver.fromStoragePath(relpath, row, context));
    } else if (resolver && typeof resolver.fromPath === 'function') {
      raw = await Promise.resolve(resolver.fromPath(relpath, row, context));
    } else if (resolver && typeof resolver.reverse === 'function') {
      raw = await Promise.resolve(resolver.reverse(relpath, row, context));
    }
    if (raw) {
      return {
        name: String(raw.name || path.posix.basename(relpath)).normalize('NFC'),
        area: raw.area === undefined ? String(row.area || '') : String(raw.area),
        caseId: raw.caseId === undefined && raw.case_id === undefined
          ? String(row.case_id || '')
          : String(raw.caseId === undefined ? raw.case_id : raw.caseId),
        folderId: raw.folderId === undefined && raw.folder_id === undefined
          ? String(row.folder_id || '')
          : String(raw.folderId === undefined ? raw.folder_id : raw.folderId),
        resolved: raw.resolved !== false
      };
    }

    const directory = path.posix.dirname(relpath) === '.' ? '' : path.posix.dirname(relpath);
    const matches = folders.filter((folder) => pathKey(folder.storage_relpath) === pathKey(directory));
    if (matches.length === 1) {
      return {
        name: path.posix.basename(relpath).normalize('NFC'),
        area: String(matches[0].area || row.area || ''),
        caseId: String(matches[0].case_id || ''),
        folderId: String(matches[0].id || ''),
        resolved: true
      };
    }
    const oldDirectory = row.storage_relpath
      ? (path.posix.dirname(posixPath(row.storage_relpath)) === '.' ? '' : path.posix.dirname(posixPath(row.storage_relpath)))
      : '';
    if (pathKey(oldDirectory) === pathKey(directory)) {
      return {
        name: path.posix.basename(relpath).normalize('NFC'),
        area: String(row.area || ''),
        caseId: String(row.case_id || ''),
        folderId: String(row.folder_id || ''),
        resolved: true
      };
    }
    return {
      name: path.posix.basename(relpath).normalize('NFC'),
      area: String(row.area || ''),
      caseId: String(row.case_id || ''),
      folderId: String(row.folder_id || ''),
      resolved: false,
      folderMatches: matches.map((folder) => String(folder.id))
    };
  }

  function collisionFor(row, target, activeRows) {
    const wantedName = names.vergleichsschluessel(target.name);
    const targetPathKey = pathKey(target.storageRelpath);
    for (const other of activeRows) {
      if (String(other.id) === String(row.id)) continue;
      if (other.storage_relpath && pathKey(other.storage_relpath) === targetPathKey) {
        return { reason: 'storage_path_collision', fileId: String(other.id) };
      }
      if (
        String(other.area || '') === String(target.area || '')
        && String(other.case_id || '') === String(target.caseId || '')
        && String(other.folder_id || '') === String(target.folderId || '')
        && names.vergleichsschluessel(other.name) === wantedName
      ) {
        return { reason: 'name_collision', fileId: String(other.id), name: other.name };
      }
    }
    return null;
  }

  async function applyDiscovery(discovery, timestamp) {
    let updated = 0;
    let markedMissing = 0;
    let conflicts = 0;
    let unchanged = 0;
    const updates = [];
    const proposalsByPath = new Map();
    const queueUpdate = (fileId, patch) => updates.push({ fileId, patch });

    if (!discovery.storageAvailable) {
      discovery.findings.push({
        kind: 'apply_skipped',
        fileId: '',
        storageRelpath: '',
        detail: {
          reason: 'storage_root_unavailable',
          storageRoot
        }
      });
      return {
        summary: {
          updated,
          markedMissing,
          conflicts,
          unchanged,
          skipped: discovery.states.length
        },
        updates
      };
    }

    for (const state of discovery.states) {
      const proposal = state.proposal;
      if (!proposal || proposal.status !== 'unique') continue;
      const key = path.resolve(proposal.entry.absolute);
      if (!proposalsByPath.has(key)) proposalsByPath.set(key, []);
      proposalsByPath.get(key).push(state);
    }
    for (const states of proposalsByPath.values()) {
      if (states.length < 2) continue;
      for (const state of states) {
        state.proposal.status = 'conflict';
        state.proposal.reason = 'candidate_shared';
        discovery.findings.push({
          kind: 'reconcile_conflict',
          fileId: String(state.row.id),
          storageRelpath: String(state.proposal.entry.relpath || ''),
          detail: {
            reason: 'candidate_shared',
            fileIds: states.map((item) => String(item.row.id))
          }
        });
      }
    }

    const plannedNameKeys = new Map();
    const plannedPathKeys = new Map();
    for (const state of discovery.states) {
      const proposal = state.proposal;
      if (!proposal || proposal.status !== 'unique') continue;
      const targetInfo = await reverseResolve(proposal.entry.relpath, state.row, discovery.folders);
      proposal.targetInfo = targetInfo;
      if (!targetInfo.resolved) continue;
      const target = { ...targetInfo, storageRelpath: proposal.entry.relpath };
      proposal.target = target;
      const nameKey = [
        target.area,
        target.caseId,
        target.folderId,
        names.vergleichsschluessel(target.name)
      ].join('\u0000');
      const storageKey = pathKey(target.storageRelpath);
      if (!plannedNameKeys.has(nameKey)) plannedNameKeys.set(nameKey, []);
      if (!plannedPathKeys.has(storageKey)) plannedPathKeys.set(storageKey, []);
      plannedNameKeys.get(nameKey).push(state);
      plannedPathKeys.get(storageKey).push(state);
    }

    function rejectPlannedCollisions(groups, reason) {
      for (const states of groups.values()) {
        if (states.length < 2) continue;
        for (const state of states) {
          if (!state.proposal || state.proposal.status !== 'unique') continue;
          state.proposal.status = 'conflict';
          state.proposal.reason = reason;
          discovery.findings.push({
            kind: 'reconcile_conflict',
            fileId: String(state.row.id),
            storageRelpath: String(state.proposal.entry.relpath || ''),
            detail: {
              reason,
              fileIds: states.map((item) => String(item.row.id)),
              paths: states.map((item) => String(item.proposal.entry.relpath || ''))
            }
          });
        }
      }
    }
    rejectPlannedCollisions(plannedPathKeys, 'planned_storage_path_collision');
    rejectPlannedCollisions(plannedNameKeys, 'planned_name_collision');

    for (const state of discovery.states) {
      const row = state.row;
      const proposal = state.proposal;
      const protectedManaged = String(row.area || '') === 'management'
        || Number(row.managed || 0) === 1;
      if (protectedManaged) {
        const hasFinding = discovery.findings.some((item) => (
          String(item.fileId || '') === String(row.id)
          && [
            'missing', 'size_mismatch', 'sha256_mismatch', 'relocation_detected',
            'reconcile_conflict', 'unicode_not_nfc', 'sidecar_missing',
            'sidecar_invalid', 'sidecar_mismatch'
          ].includes(item.kind)
        ));
        if (hasFinding || proposal || !state.entry) {
          conflicts++;
          discovery.findings.push({
            kind: 'managed_change_requires_confirmation',
            fileId: String(row.id),
            storageRelpath: String(
              (proposal && proposal.entry && proposal.entry.relpath)
              || (state.entry && state.entry.relpath)
              || row.storage_relpath
              || ''
            ),
            detail: {
              area: String(row.area || ''),
              artifactKind: String(row.artifact_kind || ''),
              databaseUnchanged: true,
              automaticApply: false
            }
          });
        } else {
          unchanged++;
        }
        continue;
      }
      if (!state.resolution) {
        conflicts++;
        discovery.findings.push({
          kind: 'apply_skipped',
          fileId: String(row.id),
          storageRelpath: String(row.storage_relpath || ''),
          detail: { reason: 'resolver_unresolved' }
        });
        continue;
      }
      if (proposal && proposal.status === 'conflict') {
        conflicts++;
        queueUpdate(row.id, {
          storage_status: 'missing',
          updated_at: timestamp
        });
        markedMissing++;
        continue;
      }

      if (proposal && proposal.status === 'unique') {
        const entry = proposal.entry;
        const targetInfo = proposal.targetInfo
          || await reverseResolve(entry.relpath, row, discovery.folders);
        if (!targetInfo.resolved) {
          conflicts++;
          discovery.findings.push({
            kind: 'reconcile_conflict',
            fileId: String(row.id),
            storageRelpath: entry.relpath,
            detail: {
              reason: 'folder_unresolved',
              method: proposal.method,
              folderMatches: targetInfo.folderMatches || []
            }
          });
          queueUpdate(row.id, { storage_status: 'missing', updated_at: timestamp });
          markedMissing++;
          continue;
        }
        const target = proposal.target || { ...targetInfo, storageRelpath: entry.relpath };
        const collision = collisionFor(row, target, discovery.activeRows);
        if (collision) {
          conflicts++;
          discovery.findings.push({
            kind: 'reconcile_conflict',
            fileId: String(row.id),
            storageRelpath: entry.relpath,
            detail: { ...collision, method: proposal.method }
          });
          queueUpdate(row.id, { storage_status: 'missing', updated_at: timestamp });
          markedMissing++;
          continue;
        }
        let freshStat;
        try {
          freshStat = await fs.promises.lstat(entry.absolute);
        } catch (error) {
          freshStat = null;
          discovery.findings.push({
            kind: 'reconcile_conflict',
            fileId: String(row.id),
            storageRelpath: entry.relpath,
            detail: {
              reason: 'candidate_changed_during_scan',
              code: error && error.code
            }
          });
        }
        if (!freshStat || !freshStat.isFile() || freshStat.isSymbolicLink()
          || inodeKey(freshStat) !== entry.inode || Number(freshStat.size) !== Number(entry.stat.size)) {
          if (freshStat) {
            discovery.findings.push({
              kind: 'reconcile_conflict',
              fileId: String(row.id),
              storageRelpath: entry.relpath,
              detail: { reason: 'candidate_changed_during_scan' }
            });
          }
          conflicts++;
          queueUpdate(row.id, { storage_status: 'missing', updated_at: timestamp });
          markedMissing++;
          continue;
        }
        const freshSha = await sha256File(entry.absolute);
        const changedContent = (
          Number(row.size) !== Number(freshStat.size)
          || (String(row.sha256 || '') && String(row.sha256).toLowerCase() !== freshSha)
        );
        if (proposal.method === 'sha256_size' && changedContent) {
          conflicts++;
          discovery.findings.push({
            kind: 'reconcile_conflict',
            fileId: String(row.id),
            storageRelpath: entry.relpath,
            detail: {
              reason: 'sha256_size_identity_changed',
              expectedSize: Number(row.size),
              actualSize: Number(freshStat.size),
              expectedSha256: String(row.sha256 || '').toLowerCase(),
              actualSha256: freshSha
            }
          });
          queueUpdate(row.id, { storage_status: 'missing', updated_at: timestamp });
          markedMissing++;
          continue;
        }
        queueUpdate(row.id, {
          name: target.name,
          name_key: names.vergleichsschluessel(target.name),
          area: target.area,
          case_id: target.caseId,
          folder_id: target.folderId,
          storage_relpath: entry.relpath,
          storage_dev: String(freshStat.dev),
          storage_ino: String(freshStat.ino),
          storage_status: changedContent ? 'mismatch' : 'ok',
          last_seen_at: timestamp,
          updated_at: timestamp
        });
        discovery.findings.push({
          kind: 'relocation_applied',
          fileId: String(row.id),
          storageRelpath: entry.relpath,
          detail: {
            method: proposal.method,
            previousPath: state.resolution && state.resolution.storageRelpath,
            name: target.name,
            area: target.area,
            caseId: target.caseId,
            folderId: target.folderId
          }
        });
        updated++;
        continue;
      }

      if (!state.entry) {
        queueUpdate(row.id, {
          storage_status: 'missing',
          updated_at: timestamp
        });
        discovery.findings.push({
          kind: 'missing_marked',
          fileId: String(row.id),
          storageRelpath: String(row.storage_relpath || ''),
          detail: { deletedAtUnchanged: true }
        });
        markedMissing++;
        continue;
      }

      const hasMismatch = discovery.findings.some((item) => (
        String(item.fileId) === String(row.id)
        && (item.kind === 'size_mismatch' || item.kind === 'sha256_mismatch')
      ));
      queueUpdate(row.id, {
        storage_relpath: state.entry.origin === 'storage' ? state.entry.relpath : row.storage_relpath,
        storage_dev: String(state.entry.stat.dev),
        storage_ino: String(state.entry.stat.ino),
        storage_status: hasMismatch ? 'mismatch' : 'ok',
        last_seen_at: timestamp,
        updated_at: timestamp
      });
      unchanged++;
    }

    return {
      summary: { updated, markedMissing, conflicts, unchanged },
      updates
    };
  }

  async function execute(mode, runOptions) {
    const runId = String(idFactory());
    const startedAt = asIso(clock);
    runInsert.run(runId, mode, startedAt);
    try {
      const discovery = await discover(runId, mode, runOptions || {});
      let applyPlan = { summary: {}, updates: [] };
      if (mode === 'apply') applyPlan = await applyDiscovery(discovery, asIso(clock));
      const finishedAt = asIso(clock);
      const summary = makeSummary(
        mode,
        discovery.filesChecked,
        discovery.diskFiles,
        discovery.findings,
        {
          acknowledgedOrphans: discovery.acknowledgedOrphans,
          acknowledgedOrphanReferences: discovery.acknowledgedOrphanReferences,
          technicalManagementFiles: discovery.technicalManagementFiles,
          ...applyPlan.summary
        }
      );
      const completeRun = () => {
        for (const update of applyPlan.updates) updateDocFile(update.fileId, update.patch);
        persistFindings(runId, discovery.findings, false);
        runFinish.run(finishedAt, 'complete', JSON.stringify(summary), runId);
      };
      if (typeof db.transaction === 'function') db.transaction(completeRun)();
      else completeRun();
      return {
        runId,
        mode,
        startedAt,
        finishedAt,
        status: 'complete',
        summary,
        findings: discovery.findings.map(jsonSafe)
      };
    } catch (error) {
      const finishedAt = asIso(clock);
      const summary = { mode, error: String(error && error.message || error) };
      try {
        findingInsert.run(
          runId,
          1,
          'run_error',
          '',
          '',
          JSON.stringify({ message: summary.error })
        );
        runFinish.run(finishedAt, 'failed', JSON.stringify(summary), runId);
      } catch (_journalError) {
        // Der ursprüngliche Fehler ist für den Aufrufer maßgeblich.
      }
      throw error;
    }
  }

  return {
    scan: (runOptions) => execute('read', runOptions),
    apply: (runOptions) => execute('apply', runOptions),
    storageRoot,
    sidecarPath: expectedSidecarPath
  };
}

module.exports = createDocumentReconciler;
module.exports.createDocumentReconciler = createDocumentReconciler;
module.exports.createReconciler = createDocumentReconciler;
module.exports.SIDECAR_FORMAT = SIDECAR_FORMAT;
module.exports.sidecarPathFor = sidecarPathFor;
module.exports.legacySidecarPathFor = legacySidecarPathFor;
module.exports.canonicalSidecar = canonicalSidecar;
module.exports.sha256File = sha256File;
