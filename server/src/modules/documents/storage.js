'use strict';

// Physische Pfadschicht des Dokumentenspeichers. Die Datei auf der Platte traegt ihren
// Klarname; SQLite ist Index und Zuordnungsregister, nicht mehr der einzige Schluessel zum
// Inhalt. Alle Pfade bleiben relativ zu genau einer Dokumentenspeicher-Wurzel.

const fs = require('fs');
const path = require('path');
const { DATA_ROOT } = require('../../config/paths');
const crypto = require('crypto');
const names = require('./names');
const taxonomy = require('./taxonomy');

const TOP_LEVEL = Object.freeze([
  'Fallakten',
  'Fallakten-Archiv',
  'Büroorganisation'
]);
const MANAGEMENT_ROOT = 'Büroorganisation/_Verwaltung & Sicherungen';
const TECHNICAL_ROOT = MANAGEMENT_ROOT + '/_Technik';

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read) hash.update(buffer.subarray(0, read));
    } while (read);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function safeRelative(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || raw === '.') return '';
  if (path.posix.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) throw new Error('Absoluter Speicherpfad ist unzulässig.');
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new Error('Speicherpfad verlässt die Dokumentenwurzel.');
  return parts.join('/');
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function canonicalPath(value) {
  const resolved = path.resolve(String(value || ''));
  try { return fs.realpathSync(resolved); }
  catch (_error) { return resolved; }
}

/*
 * Quelle und Ziel einer Bestandsumstellung müssen disjunkt sein. Das gilt auch,
 * wenn die neue Wurzel nicht ausdrücklich konfiguriert ist, sondern auf den
 * Standardpfad fällt. Andernfalls könnte ein alter, übergeordneter Blobort die
 * neue Klarname-Ablage einschließen und beim Abgleich zugleich als Altbestand
 * gescannt werden.
 */
function overlappingRoot(storageRoot, candidates) {
  const root = canonicalPath(storageRoot);
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    if (raw === undefined || raw === null || !String(raw).trim()) continue;
    const candidate = canonicalPath(raw);
    if (inside(root, candidate) || inside(candidate, root)) {
      return { storageRoot: root, candidate };
    }
  }
  return null;
}

function joinRoot(root, relative) {
  const result = path.join(path.resolve(root), ...safeRelative(relative).split('/').filter(Boolean));
  if (!inside(root, result)) throw new Error('Speicherpfad verlässt die Dokumentenwurzel.');
  return result;
}

function regularFile(candidate) {
  try {
    const stat = fs.lstatSync(candidate);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (_error) {
    return false;
  }
}

function existingDirectory(candidate) {
  try {
    const stat = fs.lstatSync(candidate);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (_error) {
    return false;
  }
}

function ensureNoInnerSymlink(root, target) {
  const absoluteRoot = path.resolve(root);
  if (!inside(absoluteRoot, target)) throw new Error('Ziel liegt außerhalb der Dokumentenwurzel.');
  const relative = path.relative(absoluteRoot, path.resolve(target));
  let current = absoluteRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('Symbolische Verknüpfungen innerhalb des Dokumentenspeichers sind nicht zulässig.');
    if (!stat.isDirectory() && current !== path.resolve(target)) throw new Error('Ein Pfadbestandteil ist kein Ordner.');
  }
}

function parseCase(row) {
  let data = {};
  try { data = JSON.parse((row && row.stammdaten_json) || '{}'); } catch (_error) { data = {}; }
  const person = data.person && typeof data.person === 'object' ? data.person : {};
  const label = String((row && row.label) || '').trim();
  const labelParts = label.split(',').map((part) => part.trim());
  return {
    id: String((row && row.id) || ''),
    archived: !!(row && row.archived),
    lastName: String(person.lastName || labelParts[0] || '').trim(),
    firstName: String(person.firstName || labelParts.slice(1).join(', ') || '').trim(),
    birthDate: person.birthDate || person.geburtsdatum || '',
    reportPeriod: data.care && data.care.reportPeriod
  };
}

function birthKey(value) {
  const parsed = taxonomy.parseDatum(value);
  return parsed
    ? `${String(parsed.year).slice(-2)}${String(parsed.month).padStart(2, '0')}${String(parsed.day).padStart(2, '0')}`
    : '';
}

function initialLetter(value) {
  const basic = String(value || '').trim().replace(/ß/g, 'SS')
    .normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  return /^[A-Z]/.test(basic) ? basic[0] : 'Z';
}

function caseBaseName(caseInfo) {
  const raw = [caseInfo.lastName, caseInfo.firstName].filter(Boolean).join(', ') || `Fall ${caseInfo.id.slice(0, 8)}`;
  return names.normalisiereDateiname(raw, { fallback: `Fall ${caseInfo.id.slice(0, 8)}` });
}

function createDocumentStorage(options) {
  const opt = options || {};
  if (!opt.db) throw new Error('document-storage benötigt eine Datenbank.');
  const db = opt.db;
  const dataRoot = path.resolve(opt.dataRoot || DATA_ROOT);
  const configReader = typeof opt.readConfig === 'function' ? opt.readConfig : (() => ({}));

  function config() {
    const cfg = configReader() || {};
    return {
      // storageRoot ist die neue, lesbare Baumwurzel. baseDir bleibt als Alias für
      // isolierte Aufrufer/Tests erhalten; produktiv reicht routes/documents.js die
      // frühere baseDir-Bedeutung ausdrücklich als legacyBaseDir weiter.
      baseDir: String(cfg.storageRoot || cfg.baseDir || ''),
      legacyBaseDir: String(cfg.legacyBaseDir || ''),
      caseDirs: cfg.caseDirs && typeof cfg.caseDirs === 'object' ? cfg.caseDirs : {}
    };
  }

  function root() {
    const cfg = config();
    return path.resolve(cfg.baseDir || path.join(dataRoot, 'Dokumentenspeicher'));
  }

  function legacyRoots(file) {
    const cfg = config();
    const result = [];
    if (file && file.area === 'case' && file.case_id && cfg.caseDirs[file.case_id]) {
      result.push(path.resolve(String(cfg.caseDirs[file.case_id])));
    }
    if (cfg.legacyBaseDir) result.push(path.resolve(cfg.legacyBaseDir));
    result.push(path.join(dataRoot, 'files'));
    return [...new Set(result)];
  }

  function ensureTopLevel() {
    const storageRoot = root();
    fs.mkdirSync(storageRoot, { recursive: true });
    for (const name of TOP_LEVEL) {
      const target = joinRoot(storageRoot, name);
      ensureNoInnerSymlink(storageRoot, target);
      fs.mkdirSync(target, { recursive: true });
    }
    const management = joinRoot(storageRoot, MANAGEMENT_ROOT);
    ensureNoInnerSymlink(storageRoot, management);
    fs.mkdirSync(management, { recursive: true });
    return storageRoot;
  }

  function caseRows() {
    return db.prepare('SELECT id, label, stammdaten_json, archived FROM cases ORDER BY id').all();
  }

  const caseRootColumns = new Set(
    db.prepare('PRAGMA table_info(doc_case_roots)').all().map((column) => String(column.name))
  );
  const hasRootSource = caseRootColumns.has('root_source');
  const caseRootRead = db.prepare('SELECT * FROM doc_case_roots WHERE case_id = ?');
  const caseRootWrite = db.prepare(`
    INSERT INTO doc_case_roots
      (case_id, area, letter, folder_name, folder_key, birth_key, storage_relpath${hasRootSource ? ', root_source' : ''})
    VALUES
      (@caseId, @area, @letter, @folderName, @folderKey, @birthKey, @storageRelpath${hasRootSource ? ', @rootSource' : ''})
    ON CONFLICT(case_id) DO UPDATE SET
      area=excluded.area, letter=excluded.letter, folder_name=excluded.folder_name,
      folder_key=excluded.folder_key, birth_key=excluded.birth_key,
      storage_relpath=excluded.storage_relpath${hasRootSource ? ', root_source=excluded.root_source' : ''},
      updated_at=datetime('now')
    WHERE doc_case_roots.area<>excluded.area
       OR doc_case_roots.letter<>excluded.letter
       OR doc_case_roots.folder_name<>excluded.folder_name
       OR doc_case_roots.folder_key<>excluded.folder_key
       OR doc_case_roots.birth_key<>excluded.birth_key
       OR doc_case_roots.storage_relpath<>excluded.storage_relpath
       ${hasRootSource ? "OR doc_case_roots.root_source<>excluded.root_source" : ''}
  `);

  function computedCaseRootInfo(current) {
    const all = caseRows().map(parseCase);
    const baseResult = caseBaseName(current);
    const baseKey = names.vergleichsschluessel(baseResult.name);
    const sameName = all.filter((candidate) => names.vergleichsschluessel(caseBaseName(candidate).name) === baseKey);
    const bKey = birthKey(current.birthDate);
    let folderName = baseResult.name;
    const adjustments = [...baseResult.reasons];
    if (sameName.length > 1) {
      if (bKey) {
        folderName += ' ' + bKey;
        adjustments.push({ code: 'namensgleichheit_geburtsdatum', text: 'Wegen Namensgleichheit wurde das Geburtsdatum JJMMTT ergänzt.' });
      } else {
        folderName += ' ' + current.id.slice(0, 8);
        adjustments.push({ code: 'namensgleichheit_kennung', text: 'Wegen Namensgleichheit und fehlendem Geburtsdatum wurde die Fallkennung ergänzt.' });
      }
      const duplicateBirth = sameName.filter((candidate) => birthKey(candidate.birthDate) === bKey);
      if (bKey && duplicateBirth.length > 1) {
        folderName += ' ' + current.id.slice(0, 8);
        adjustments.push({ code: 'namensgleichheit_trotz_geburtsdatum', text: 'Name und Geburtsdatum sind mehrfach vorhanden; die Fallkennung wurde ergänzt.' });
      }
    }
    const normalized = names.normalisiereDateiname(folderName);
    adjustments.push(...normalized.reasons);
    folderName = normalized.name;
    const letter = initialLetter(current.lastName || folderName);
    if (!/[A-Za-zÄÖÜäöü]/.test(String(current.lastName || '').charAt(0))) {
      adjustments.push({ code: 'buchstaben_fallback', text: 'Der Fall wurde mangels Buchstaben am Namensanfang unter Z einsortiert.' });
    }
    const relative = current.archived
      ? path.posix.join('Fallakten-Archiv', folderName)
      : path.posix.join('Fallakten', letter, folderName);
    const result = {
      caseId: current.id,
      archived: current.archived,
      area: current.archived ? 'Fallakten-Archiv' : 'Fallakten',
      letter,
      folderName,
      folderKey: names.vergleichsschluessel(folderName),
      birthKey: bKey,
      storageRelpath: relative,
      adjustments,
      rootSource: 'generated'
    };
    return result;
  }

  /*
   * Nur Finder-Zuordnungen mit exakt einer gültigen Fallwurzel werden zur
   * Benutzerhoheit. Der Archivstatus bleibt eine Fachentscheidung in cases;
   * ein bloßes Verschieben zwischen Aktivbestand und Archiv darf ihn nicht
   * nebenbei ändern. Name und Buchstabenebene innerhalb des richtigen Bereichs
   * dürfen dagegen vom Finder stammen.
   */
  function mappedCaseRootInfo(current, stored, canonical) {
    if (!stored || String(stored.root_source || '') !== 'finder') return null;
    let relative;
    try { relative = safeRelative(stored.storage_relpath); }
    catch (_error) { return null; }
    const match = current.archived
      ? /^Fallakten-Archiv\/([^/]+)$/.exec(relative)
      : /^Fallakten\/([A-Z])\/([^/]+)$/.exec(relative);
    if (!match) return null;
    const folderName = current.archived ? match[1] : match[2];
    if (!folderName) return null;
    return {
      caseId: current.id,
      archived: current.archived,
      area: current.archived ? 'Fallakten-Archiv' : 'Fallakten',
      letter: current.archived ? '' : match[1],
      folderName,
      folderKey: names.vergleichsschluessel(folderName),
      birthKey: String(stored.birth_key || canonical.birthKey || ''),
      storageRelpath: relative,
      adjustments: [{
        code: 'finder_fallwurzel_massgeblich',
        text: 'Die per Finder-Abgleich bestätigte Fallwurzel bleibt für Speicherung und WebDAV maßgeblich.'
      }],
      rootSource: 'finder'
    };
  }

  function persistCaseRoot(result) {
    caseRootWrite.run(result);
  }

  function ensureCaseRoot(result) {
    ensureTopLevel();
    const target = joinRoot(root(), result.storageRelpath);
    ensureNoInnerSymlink(root(), target);
    fs.mkdirSync(target, { recursive: true });
    persistCaseRoot(result);
    writeCaseRootSidecar(target, result);
    return target;
  }

  function caseRootInfo(caseId, ensure) {
    const row = db.prepare('SELECT id, label, stammdaten_json, archived FROM cases WHERE id = ?').get(String(caseId || ''));
    if (!row) throw new Error('Fall nicht gefunden.');
    const current = parseCase(row);
    const canonical = computedCaseRootInfo(current);
    const stored = caseRootRead.get(current.id);
    const result = mappedCaseRootInfo(current, stored, canonical) || canonical;
    if (ensure) {
      ensureCaseRoot(result);
    }
    return result;
  }

  function syncCaseRoot(caseId) {
    const row = db.prepare('SELECT id, label, stammdaten_json, archived FROM cases WHERE id = ?').get(String(caseId || ''));
    if (!row) throw new Error('Fall nicht gefunden.');
    const current = parseCase(row);
    const previous = caseRootRead.get(current.id);
    const canonical = computedCaseRootInfo(current);
    let next = mappedCaseRootInfo(current, previous, canonical);
    if (!next && previous && String(previous.root_source || '') === 'finder') {
      // Archivierung/Reaktivierung verschiebt die Finder-Wurzel in den fachlich
      // richtigen Bereich, ohne ihren benutzergewählten Namen zu verlieren.
      const preserved = names.normalisiereDateiname(
        previous.folder_name || path.posix.basename(previous.storage_relpath || ''),
        { fallback: canonical.folderName }
      );
      const letter = current.archived ? '' : initialLetter(current.lastName || preserved.name);
      next = {
        ...canonical,
        area: current.archived ? 'Fallakten-Archiv' : 'Fallakten',
        letter,
        folderName: preserved.name,
        folderKey: names.vergleichsschluessel(preserved.name),
        storageRelpath: current.archived
          ? path.posix.join('Fallakten-Archiv', preserved.name)
          : path.posix.join('Fallakten', letter, preserved.name),
        adjustments: preserved.reasons.concat({
          code: 'finder_fallwurzel_bereich_angepasst',
          text: 'Die benutzergewählte Fallwurzel wurde unter Beibehaltung ihres Namens an den Archivstatus angepasst.'
        }),
        rootSource: 'finder'
      };
    }
    if (!next) next = canonical;
    ensureTopLevel();
    const nextPath = joinRoot(root(), next.storageRelpath);
    const oldPath = previous && previous.storage_relpath
      ? joinRoot(root(), previous.storage_relpath)
      : null;
    if (oldPath && path.resolve(oldPath) !== path.resolve(nextPath) && fs.existsSync(oldPath)) {
      ensureNoInnerSymlink(root(), oldPath);
      ensureNoInnerSymlink(root(), path.dirname(nextPath));
      fs.mkdirSync(path.dirname(nextPath), { recursive: true });
      if (fs.existsSync(nextPath)) {
        throw new Error(`Fallordner-Kollision: „${next.storageRelpath}“ ist bereits vorhanden.`);
      }
      fs.renameSync(oldPath, nextPath);
    }
    fs.mkdirSync(nextPath, { recursive: true });
    persistCaseRoot(next);
    if (previous && previous.storage_relpath && previous.storage_relpath !== next.storageRelpath) {
      const oldPrefix = safeRelative(previous.storage_relpath);
      const newPrefix = safeRelative(next.storageRelpath);
      const folderRowsToUpdate = db.prepare(
        "SELECT id, storage_relpath FROM doc_folders WHERE case_id=? AND area='case' AND (storage_relpath=? OR storage_relpath LIKE ?)"
      ).all(String(caseId), oldPrefix, oldPrefix + '/%');
      const fileRowsToUpdate = db.prepare(
        "SELECT id, storage_relpath FROM doc_files WHERE case_id=? AND area='case' AND (storage_relpath=? OR storage_relpath LIKE ?)"
      ).all(String(caseId), oldPrefix, oldPrefix + '/%');
      const replacePrefix = (value) => newPrefix + String(value || '').slice(oldPrefix.length);
      const setFolder = db.prepare("UPDATE doc_folders SET storage_relpath=?, updated_at=datetime('now') WHERE id=?");
      const setFile = db.prepare("UPDATE doc_files SET storage_relpath=?, updated_at=datetime('now') WHERE id=?");
      const transaction = db.transaction(() => {
        for (const row of folderRowsToUpdate) setFolder.run(replacePrefix(row.storage_relpath), row.id);
        for (const row of fileRowsToUpdate) setFile.run(replacePrefix(row.storage_relpath), row.id);
      });
      transaction();
    }
    writeCaseRootSidecar(nextPath, next);
    return next;
  }

  function syncAllCaseRoots() {
    const results = [];
    for (const row of caseRows()) results.push(syncCaseRoot(row.id));
    return results;
  }

  function folderRows(area, caseId) {
    return db.prepare('SELECT * FROM doc_folders WHERE area = ? AND case_id = ?').all(area, String(caseId || ''));
  }

  const folderColumnNames = new Set(
    db.prepare('PRAGMA table_info(doc_folders)').all().map((column) => String(column.name))
  );

  function recordFolderLocation(folderId, relative, target) {
    if (!folderId || !folderColumnNames.has('storage_dev') || !folderColumnNames.has('storage_ino')) return;
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Dokumentenordner ist kein regulärer Ordner.');
    const patch = {
      storage_relpath: safeRelative(relative),
      storage_dev: String(stat.dev),
      storage_ino: String(stat.ino),
      storage_status: 'ok',
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const columns = Object.keys(patch).filter((column) => folderColumnNames.has(column));
    db.prepare(
      `UPDATE doc_folders SET ${columns.map((column) => `${column}=@${column}`).join(', ')} WHERE id=@id`
    ).run({ id: String(folderId), ...patch });
  }

  function folderSegments(area, caseId, folderId) {
    if (!folderId) return [];
    const map = new Map(folderRows(area, caseId).map((row) => [String(row.id), row]));
    const segments = [];
    const visited = new Set();
    let id = String(folderId);
    while (id) {
      if (visited.has(id)) throw new Error('Ordnerzyklus in der Datenbank.');
      visited.add(id);
      const row = map.get(id);
      if (!row) throw new Error('Ordner nicht gefunden: ' + id);
      segments.unshift(names.normalisiereDateiname(row.name, { fallback: 'Unbenannt' }).name);
      id = String(row.parent_id || '');
    }
    return segments;
  }

  function scopeRoot(area, caseId, ensure) {
    if (area === 'office') {
      if (ensure) ensureTopLevel();
      return 'Büroorganisation';
    }
    if (area === 'management') {
      if (ensure) ensureTopLevel();
      return MANAGEMENT_ROOT;
    }
    if (area !== 'case') throw new Error('Unbekannter Dokumentbereich.');
    return caseRootInfo(caseId, ensure).storageRelpath;
  }

  function folderRelpath(area, caseId, folderId, ensure) {
    const parts = [scopeRoot(area, caseId, ensure), ...folderSegments(area, caseId, folderId)];
    const relative = safeRelative(parts.join('/'));
    if (ensure) {
      const target = joinRoot(root(), relative);
      ensureNoInnerSymlink(root(), target);
      fs.mkdirSync(target, { recursive: true });
      recordFolderLocation(folderId, relative, target);
    }
    return relative;
  }

  function ensureCaseLayout(caseId, createdBy) {
    const info = caseRootInfo(caseId, true);
    const existing = folderRows('case', caseId);
    const insert = db.prepare(`
      INSERT INTO doc_folders
        (id, area, case_id, parent_id, name, name_key, storage_relpath, created_by, updated_at)
      VALUES
        (@id, 'case', @caseId, '', @name, @nameKey, @storageRelpath, @createdBy, datetime('now'))
    `);
    const setPath = db.prepare("UPDATE doc_folders SET name_key=?, storage_relpath=?, updated_at=datetime('now') WHERE id=?");
    const made = [];
    const transaction = db.transaction(() => {
      for (const register of taxonomy.REGISTER) {
        let row = existing.find((candidate) => !candidate.parent_id
          && names.dateinamenGleich(candidate.name, register.name));
        const relative = path.posix.join(info.storageRelpath, register.name);
        if (!row) {
          row = { id: crypto.randomUUID(), name: register.name };
          insert.run({
            id: row.id,
            caseId: String(caseId),
            name: register.name,
            nameKey: names.vergleichsschluessel(register.name),
            storageRelpath: relative,
            createdBy: createdBy == null ? null : createdBy
          });
          made.push(register.name);
        } else {
          setPath.run(names.vergleichsschluessel(register.name), relative, row.id);
        }
      }
    });
    transaction();
    for (const register of taxonomy.REGISTER) {
      const relative = path.posix.join(info.storageRelpath, register.name);
      const target = joinRoot(root(), relative);
      ensureNoInnerSymlink(root(), target);
      fs.mkdirSync(target, { recursive: true });
      const row = db.prepare(
        "SELECT id FROM doc_folders WHERE area='case' AND case_id=? AND parent_id='' AND name_key=?"
      ).get(String(caseId), names.vergleichsschluessel(register.name));
      if (row) recordFolderLocation(row.id, relative, target);
    }
    return { caseRoot: info, created: made, registers: taxonomy.fallanlageOrdner() };
  }

  function sidecarPath(filePath, fileId) {
    return path.join(path.dirname(filePath), `.ablage-${String(fileId)}.json`);
  }

  function writeJsonAtomic(target, value) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = target + '.tmp-' + crypto.randomUUID();
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    try { fs.renameSync(temp, target); }
    catch (error) {
      try { fs.unlinkSync(temp); } catch (_ignore) { /* best effort */ }
      throw error;
    }
  }

  function writeCaseRootSidecar(directory, info) {
    const target = path.join(directory, '.ablage-fall.json');
    try {
      const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (existing
        && existing.format === 'Betreuungsbüro-Fallordner/1'
        && String(existing.caseId || '') === String(info.caseId || '')
        && String(existing.folder || '') === String(info.storageRelpath || '')
        && String(existing.rootSource || 'generated') === String(info.rootSource || 'generated')) {
        return false;
      }
    } catch (_error) {
      // Fehlender oder beschädigter Technik-Sidecar wird atomar ersetzt.
    }
    writeJsonAtomic(target, {
      format: 'Betreuungsbüro-Fallordner/1',
      caseId: String(info.caseId || ''),
      folder: String(info.storageRelpath || ''),
      rootSource: String(info.rootSource || 'generated'),
      updatedAt: new Date().toISOString()
    });
    return true;
  }

  function writeSidecar(file, filePath) {
    const stat = fs.statSync(filePath);
    const relative = safeRelative(path.relative(root(), filePath).split(path.sep).join('/'));
    const hash = String(file.sha256 || '') || sha256File(filePath);
    const caseId = String(file.case_id || file.caseId || '');
    let caseLabel = '';
    if (caseId) {
      try {
        const row = db.prepare('SELECT label FROM cases WHERE id=?').get(caseId);
        caseLabel = row ? String(row.label || '') : '';
      } catch (_error) { /* Der lesbare Pfad bleibt auch ohne Zusatzlabel erhalten. */ }
    }
    const data = {
      format: 'Betreuungsbüro-Datei/1',
      fileId: String(file.id),
      name: String(file.name),
      path: relative,
      mimeType: String(file.mime_type || file.mimeType || 'application/octet-stream'),
      area: String(file.area || ''),
      caseId,
      case: caseLabel,
      folderId: String(file.folder_id || file.folderId || ''),
      size: stat.size,
      sha256: hash,
      updatedAt: new Date().toISOString()
    };
    writeJsonAtomic(sidecarPath(filePath, file.id), data);
    return data;
  }

  function legacyNameCandidates(dir, id) {
    const result = [path.join(dir, String(id))];
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (_error) { entries = []; }
    const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}(?:-[A-Fa-f0-9]{4,})?\\.[^.\\/]+$`);
    for (const name of entries.sort()) if (pattern.test(name)) result.push(path.join(dir, name));
    return result;
  }

  function findBlobPath(file) {
    if (!file) return null;
    if (file.storage_relpath) {
      try {
        const direct = joinRoot(root(), file.storage_relpath);
        if (regularFile(direct)) return direct;
        const parent = path.dirname(direct);
        if (existingDirectory(parent)) {
          const key = names.vergleichsschluessel(path.basename(direct));
          const matches = fs.readdirSync(parent)
            .filter((entry) => !entry.startsWith('.ablage-') && names.vergleichsschluessel(entry) === key)
            .map((entry) => path.join(parent, entry)).filter(regularFile);
          if (matches.length === 1) return matches[0];
        }
      } catch (_error) { /* Legacy-Fallback */ }
    }
    for (const dir of legacyRoots(file)) {
      for (const candidate of legacyNameCandidates(dir, file.id)) {
        if (regularFile(candidate)) return candidate;
      }
    }
    return null;
  }

  function uniquePhysicalName(directory, wanted, selfPath) {
    const normalized = names.normalisiereDateiname(wanted, { fallback: 'Unbenannt' });
    const listed = existingDirectory(directory) ? fs.readdirSync(directory) : [];
    const selfAbsolute = selfPath ? path.resolve(selfPath) : '';
    const isTaken = (candidate) => listed.some((entry) => {
      const entryPath = path.resolve(directory, entry);
      return entryPath !== selfAbsolute && names.dateinamenGleich(entry, candidate);
    });
    let candidate = normalized.name;
    if (!isTaken(candidate)) return { name: candidate, adjustments: normalized.reasons };
    const split = /^(.+?)(\.[^.]{1,32})?$/.exec(candidate);
    const stem = (split && split[1]) || candidate;
    const extension = (split && split[2]) || '';
    for (let index = 2; index < 1000; index++) {
      const next = names.normalisiereDateiname(`${stem} (${index})${extension}`).name;
      if (!isTaken(next)) {
        return {
          name: next,
          adjustments: normalized.reasons.concat({
            code: 'kollision',
            text: `Der Name war bereits belegt und wurde sichtbar in „${next}“ geändert.`
          })
        };
      }
    }
    const next = names.normalisiereDateiname(`${stem} (${crypto.randomUUID().slice(0, 8)})${extension}`).name;
    return {
      name: next,
      adjustments: normalized.reasons.concat({ code: 'kollision_kennung', text: 'Nach vielen Kollisionen wurde eine Kennung ergänzt.' })
    };
  }

  function targetFor(area, caseId, folderId, wantedName, selfPath) {
    const relativeDir = folderRelpath(area, caseId, folderId, true);
    const directory = joinRoot(root(), relativeDir);
    const unique = uniquePhysicalName(directory, wantedName, selfPath);
    return {
      directory,
      name: unique.name,
      adjustments: unique.adjustments,
      filePath: path.join(directory, unique.name),
      storageRelpath: path.posix.join(relativeDir, unique.name)
    };
  }

  function atomicWrite(target, bytes) {
    ensureNoInnerSymlink(root(), path.dirname(target));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = path.join(path.dirname(target), `.ablage-upload-${crypto.randomUUID()}.part`);
    fs.writeFileSync(temp, bytes, { flag: 'wx' });
    try {
      // link+unlink publiziert ohne das ueberschreibende rename-Verhalten von POSIX.
      fs.linkSync(temp, target);
      fs.unlinkSync(temp);
    }
    catch (error) {
      try { fs.unlinkSync(temp); } catch (_ignore) { /* best effort */ }
      throw error;
    }
  }

  function publishTemp(temp, target) {
    ensureNoInnerSymlink(root(), path.dirname(target));
    if (path.dirname(path.resolve(temp)) !== path.dirname(path.resolve(target))) {
      throw new Error('Zwischendatei und Ziel müssen im selben Ordner liegen.');
    }
    fs.linkSync(temp, target);
    fs.unlinkSync(temp);
    const stat = fs.statSync(target);
    return { storageDev: String(stat.dev), storageIno: String(stat.ino), size: stat.size };
  }

  function placeBuffer(file, bytes) {
    if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
    const target = targetFor(file.area, file.case_id || file.caseId, file.folder_id || file.folderId, file.name);
    atomicWrite(target.filePath, bytes);
    try {
      const complete = Object.assign({}, file, {
        name: target.name,
        size: bytes.length,
        sha256: String(file.sha256 || '') || sha256Buffer(bytes)
      });
      writeSidecar(complete, target.filePath);
      const stat = fs.statSync(target.filePath);
      return Object.assign(target, {
        size: stat.size,
        sha256: complete.sha256,
        storageDev: String(stat.dev),
        storageIno: String(stat.ino)
      });
    } catch (error) {
      // Ohne vollständig geschriebenen Beipackzettel gilt auch der neue Inhalt
      // nicht als publiziert. So kann ein Sidecar-/Stat-Fehler keine Waise
      // zwischen atomarem Dateischritt und Rückgabe an den Aufrufer erzeugen.
      try { fs.unlinkSync(target.filePath); } catch (_ignore) { /* Abgleich meldet Fremdreste */ }
      const sidecar = sidecarPath(target.filePath, file.id);
      if (regularFile(sidecar)) {
        try { fs.unlinkSync(sidecar); } catch (_ignore) { /* Abgleich meldet Fremdreste */ }
      }
      throw error;
    }
  }

  function moveVerified(source, target) {
    if (path.resolve(source) === path.resolve(target)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.linkSync(source, target);
      fs.unlinkSync(source);
      return;
    } catch (error) {
      if (!error || !['EXDEV', 'EPERM', 'EOPNOTSUPP'].includes(error.code)) throw error;
    }
    const temp = target + '.move-' + crypto.randomUUID() + '.part';
    fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
    if (sha256File(source) !== sha256File(temp)) {
      try { fs.unlinkSync(temp); } catch (_ignore) { /* best effort */ }
      throw new Error('Prüfsumme nach dateisystemübergreifendem Verschieben stimmt nicht.');
    }
    fs.renameSync(temp, target);
    fs.unlinkSync(source);
  }

  function relocate(file, area, caseId, folderId, wantedName) {
    const source = findBlobPath(file);
    if (!source) throw new Error('Dateiinhalt ist nicht auffindbar.');
    const target = targetFor(area, caseId, folderId, wantedName, source);
    moveVerified(source, target.filePath);
    const oldSidecar = sidecarPath(source, file.id);
    if (regularFile(oldSidecar)) {
      try { fs.unlinkSync(oldSidecar); } catch (_error) { /* neuer Beipackzettel folgt */ }
    }
    const complete = Object.assign({}, file, {
      area,
      case_id: String(caseId || ''),
      folder_id: String(folderId || ''),
      name: target.name
    });
    const sidecar = writeSidecar(complete, target.filePath);
    const stat = fs.statSync(target.filePath);
    return Object.assign(target, {
      size: stat.size,
      sha256: sidecar.sha256,
      storageDev: String(stat.dev),
      storageIno: String(stat.ino)
    });
  }

  function moveToManagement(file, kind, key, wantedName) {
    const source = findBlobPath(file);
    if (!source) throw new Error('Dateiinhalt ist nicht auffindbar.');
    return stashPathToManagement(source, file, kind, key, wantedName, { removeSourceSidecar: true });
  }

  function managementTarget(file, kind, key, wantedName, selfPath) {
    const kindName = names.normalisiereDateiname(kind || 'Technik').name;
    const scopeName = file.area === 'case'
      ? `Fall-${String(file.case_id || file.caseId || '').slice(0, 36)}`
      : 'Büroorganisation';
    const keyName = names.normalisiereDateiname(key || file.id || crypto.randomUUID()).name;
    const relativeDir = path.posix.join(TECHNICAL_ROOT, kindName, scopeName, keyName);
    const directory = joinRoot(root(), relativeDir);
    fs.mkdirSync(directory, { recursive: true });
    const unique = uniquePhysicalName(directory, wantedName || file.name || 'Unbenannt', selfPath);
    const filePath = path.join(directory, unique.name);
    return {
      directory,
      name: unique.name,
      adjustments: unique.adjustments,
      filePath,
      storageRelpath: path.posix.join(relativeDir, unique.name)
    };
  }

  /*
   * Verschiebt einen bereits bekannten Pfad in den rein technischen Bereich.
   * Nach erfolgreichem Verschieben wird ein Sidecar versucht; dessen Fehler
   * macht die Sicherung nicht wieder unsicher, sondern wird im Ergebnis
   * sichtbar zurückgegeben.
   */
  function stashPathToManagement(source, file, kind, key, wantedName, options) {
    if (!regularFile(source)) throw new Error('Zu sichernder Dateiinhalt ist nicht auffindbar.');
    const target = managementTarget(file, kind, key, wantedName, source);
    const oldSidecar = sidecarPath(source, file.id);
    moveVerified(source, target.filePath);
    if (options && options.removeSourceSidecar) {
      try { fs.unlinkSync(oldSidecar); } catch (_error) { /* nicht vorhanden */ }
    }
    const complete = Object.assign({}, file, { name: target.name });
    let sidecar = null;
    let sidecarError = '';
    try { sidecar = writeSidecar(complete, target.filePath); }
    catch (error) { sidecarError = String(error && error.message || error); }
    const stat = fs.statSync(target.filePath);
    return Object.assign(target, {
      size: stat.size,
      sha256: sidecar ? sidecar.sha256 : sha256File(target.filePath),
      storageDev: String(stat.dev),
      storageIno: String(stat.ino),
      sidecarError
    });
  }

  /*
   * Versionssicherung kopiert statt die Primärdatei vorzeitig wegzunehmen.
   * Erst eine vollständig verifizierte Kopie mit Sidecar darf als Version in
   * SQLite eingetragen werden; bei jedem Fehler bleibt die Primärdatei an Ort
   * und Stelle erreichbar.
   */
  function copyToManagement(file, kind, key, wantedName) {
    const source = findBlobPath(file);
    if (!source) throw new Error('Dateiinhalt ist nicht auffindbar.');
    const target = managementTarget(file, kind, key, wantedName);
    const temp = target.filePath + '.copy-' + crypto.randomUUID() + '.part';
    try {
      try {
        fs.copyFileSync(source, temp, fs.constants.COPYFILE_FICLONE_FORCE);
      } catch (_reflinkError) {
        try { fs.unlinkSync(temp); } catch (_ignore) { /* ggf. nicht angelegt */ }
        fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
      }
      const sourceHash = sha256File(source);
      const copyHash = sha256File(temp);
      if (sourceHash !== copyHash) throw new Error('Prüfsumme der Versionskopie stimmt nicht.');
      fs.renameSync(temp, target.filePath);
      const complete = Object.assign({}, file, {
        name: target.name,
        size: fs.statSync(target.filePath).size,
        sha256: copyHash
      });
      writeSidecar(complete, target.filePath);
      const stat = fs.statSync(target.filePath);
      return Object.assign(target, {
        size: stat.size,
        sha256: copyHash,
        storageDev: String(stat.dev),
        storageIno: String(stat.ino)
      });
    } catch (error) {
      try { fs.unlinkSync(temp); } catch (_ignore) { /* verifizierte Primärdatei bleibt */ }
      // Eine bereits publizierte, aber nicht indexierte Kopie bleibt bewusst
      // unter _Verwaltung erhalten. Sie ist sicherer als stilles Löschen.
      throw error;
    }
  }

  function removeFileAndSidecar(file) {
    const target = findBlobPath(file);
    if (!target) return false;
    fs.unlinkSync(target);
    const sidecar = sidecarPath(target, file.id);
    try { fs.unlinkSync(sidecar); } catch (_error) { /* nicht vorhanden */ }
    return true;
  }

  function cloneCopy(source, target) {
    try {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE_FORCE);
      return 'reflink';
    } catch (_error) {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      return 'copy';
    }
  }

  return {
    TOP_LEVEL,
    MANAGEMENT_ROOT,
    TECHNICAL_ROOT,
    root,
    config,
    legacyRoots,
    ensureTopLevel,
    caseRootInfo,
    syncCaseRoot,
    syncAllCaseRoots,
    ensureCaseLayout,
    folderSegments,
    folderRelpath,
    sidecarPath,
    writeSidecar,
    findBlobPath,
    targetFor,
    publishTemp,
    placeBuffer,
    relocate,
    moveToManagement,
    copyToManagement,
    stashPathToManagement,
    removeFileAndSidecar,
    cloneCopy,
    sha256File
  };
}

module.exports = {
  TOP_LEVEL,
  safeRelative,
  joinRoot,
  inside,
  canonicalPath,
  overlappingRoot,
  regularFile,
  sha256Buffer,
  sha256File,
  createDocumentStorage
};
