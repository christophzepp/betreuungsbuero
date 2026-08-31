'use strict';

/*
 * Protokollierter Bestands-Umhängelauf für den lesbaren Dokumentenspeicher.
 *
 * Sicherheitsregeln:
 * - Quellen werden niemals überschrieben oder breit gelöscht.
 * - Eine Quelle verschwindet erst nach Prüfsummenvergleich.
 * - Jeder logische Ursprung besitzt einen stabilen source_key im SQLite-Journal.
 * - Ein Lauf darf nach jedem einzelnen Eintrag abbrechen und ist wiederholbar.
 * - Dry-runs ändern weder Fach-/Dokumenttabellen noch Quelldateien.
 */

const fs = require('fs');
const path = require('path');
const { DATA_ROOT } = require('../../config/paths');
const crypto = require('crypto');
const names = require('./names');
const taxonomy = require('./taxonomy');
const dokuAttachments = require('./case-note-attachments');
const {
  createDocumentStorage,
  inside,
  joinRoot,
  regularFile,
  sha256File
} = require('./storage');

const MODULE_ROOTS = Object.freeze([
  'case-doku-photos',
  'inbox-documents',
  'finance-receipts',
  'finance-statements',
  'todo-attachments',
  'calendar-event-attachments',
  'office-logo'
]);

function jsonParse(value, fallback) {
  try { return JSON.parse(String(value == null ? '' : value)); }
  catch (_error) { return fallback; }
}

function tableExists(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(String(table));
}

function columns(db, table) {
  if (!tableExists(db, table)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info("${String(table).replace(/"/g, '""')}")`).all().map((row) => row.name));
}

function selectAll(db, table, wanted) {
  const available = columns(db, table);
  if (!available.size) return [];
  const selected = wanted.filter((name) => available.has(name));
  if (!selected.length) return [];
  return db.prepare(`SELECT ${selected.map((name) => `"${name}"`).join(',')} FROM "${table}"`).all();
}

function safeDate(value) {
  const parsed = taxonomy.parseDatum(value);
  return parsed ? parsed.iso : new Date().toISOString().slice(0, 10);
}

function yearMonth(value) {
  const iso = safeDate(value);
  return [iso.slice(0, 4), iso.slice(5, 7)];
}

function datedName(filename, value) {
  const raw = String(filename || '').trim() || 'Unbenannt';
  if (/^\d{6}(?:\s|$)/.test(raw)) return raw;
  const iso = safeDate(value);
  return `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)} ${raw}`;
}

function fileStat(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return stat;
  } catch (_error) {
    return null;
  }
}

function walkRegular(root) {
  const result = [];
  function walk(current) {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch (_error) { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(candidate);
      else if (entry.isFile()) result.push(candidate);
    }
  }
  if (fs.existsSync(root)) walk(root);
  return result;
}

function atomicJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = target + '.tmp-' + crypto.randomUUID();
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  try { fs.renameSync(temp, target); }
  catch (error) {
    try { fs.unlinkSync(temp); } catch (_ignore) { /* best effort */ }
    throw error;
  }
}

/*
 * Der Zeitstempel beschreibt den ersten erfolgreichen Herkunftsnachweis und
 * darf bei einer Fortsetzung abweichen. Alle übrigen Felder bilden dagegen
 * die stabile Identität des Waisen-Beipackzettels. Insbesondere muss ein
 * deduplizierter Verweis weiterhin auf genau dieselbe aktive Datei zeigen.
 */
function orphanProvenanceIdentity(value) {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    format: String(item.format || ''),
    originalPath: String(item.originalPath || ''),
    sourceRoot: String(item.sourceRoot || ''),
    storedPath: String(item.storedPath || ''),
    canonicalFileId: String(item.canonicalFileId || ''),
    deduplicated: item.deduplicated === true,
    size: Number(item.size),
    sha256: String(item.sha256 || '')
  };
}

function writeOrReuseOrphanProvenance(target, provenance) {
  if (!fs.existsSync(target)) {
    atomicJson(target, provenance);
    return { reused: false, value: provenance };
  }
  const stat = fileStat(target);
  const existing = stat && stat.size <= 1024 * 1024
    ? jsonParse(fs.readFileSync(target, 'utf8'), null)
    : null;
  const existingIdentity = orphanProvenanceIdentity(existing);
  const expectedIdentity = orphanProvenanceIdentity(provenance);
  const same = existing
    && typeof existing.migratedAt === 'string'
    && existing.migratedAt.trim()
    && Object.keys(expectedIdentity).every((field) =>
      existingIdentity[field] === expectedIdentity[field]);
  if (!same) {
    throw new Error(`Vorhandener Waisen-Beipackzettel widerspricht dem Fortsetzungslauf: ${target}`);
  }
  // Kein erneutes Schreiben: Das vermeidet POSIX-Überschreiben ebenso wie
  // EEXIST/EPERM auf anderen Plattformen und bewahrt den Erstnachweis.
  return { reused: true, value: existing };
}

function moveVerified(source, target, expectedSha) {
  const sourceStat = fileStat(source);
  if (!sourceStat) throw new Error(`Quelldatei fehlt oder ist kein reguläres Dokument: ${source}`);
  if (fs.existsSync(target)) throw new Error(`Ziel ist bereits belegt: ${target}`);
  const sourceSha = sha256File(source);
  if (expectedSha && sourceSha !== expectedSha) {
    throw new Error(`Prüfsumme der Quelle weicht vom Index ab: ${source}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    // Gleicher Datenträger: Ziel wird ohne Überschreiben atomar publiziert.
    fs.linkSync(source, target);
    if (sha256File(target) !== sourceSha) throw new Error('Prüfsumme des verknüpften Ziels stimmt nicht.');
    fs.unlinkSync(source);
    return { sha256: sourceSha, size: sourceStat.size, method: 'link-move' };
  } catch (error) {
    if (fs.existsSync(target)) {
      try { fs.unlinkSync(target); } catch (_ignore) { /* best effort */ }
    }
    if (!error || !['EXDEV', 'EPERM', 'EOPNOTSUPP'].includes(error.code)) throw error;
  }
  const temp = target + '.migration-' + crypto.randomUUID() + '.part';
  fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
  if (sha256File(temp) !== sourceSha) {
    try { fs.unlinkSync(temp); } catch (_ignore) { /* best effort */ }
    throw new Error('Prüfsumme nach dateisystemübergreifendem Kopieren stimmt nicht.');
  }
  fs.renameSync(temp, target);
  // Erst das vollständig publizierte Ziel verifizieren, dann die Quelle entfernen.
  if (sha256File(target) !== sourceSha) throw new Error('Prüfsumme des publizierten Ziels stimmt nicht.');
  fs.unlinkSync(source);
  return { sha256: sourceSha, size: sourceStat.size, method: 'copy-verify-move' };
}

function removeVerifiedDuplicate(source, canonical, expectedSha) {
  if (path.resolve(source) === path.resolve(canonical)) return false;
  if (!fileStat(source) || !fileStat(canonical)) throw new Error('Deduplizierung benötigt zwei reguläre Dateien.');
  const sourceSha = sha256File(source);
  const canonicalSha = sha256File(canonical);
  if (sourceSha !== canonicalSha || (expectedSha && sourceSha !== expectedSha)) {
    throw new Error('Deduplizierung abgebrochen: Prüfsummen sind nicht gleich.');
  }
  fs.unlinkSync(source);
  return true;
}

function createDocumentMigration(options) {
  const opt = options || {};
  if (!opt.db) throw new Error('document-migration benötigt eine Datenbank.');
  const db = opt.db;
  const dataRoot = path.resolve(opt.dataRoot || DATA_ROOT);
  const storage = opt.storage || createDocumentStorage({
    db,
    dataRoot,
    readConfig: typeof opt.readConfig === 'function' ? opt.readConfig : (() => ({}))
  });
  const now = typeof opt.now === 'function' ? opt.now : (() => new Date());
  const destinationRoot = path.resolve(storage.root());
  for (const legacyName of ['files', ...MODULE_ROOTS]) {
    const legacyRoot = path.resolve(dataRoot, legacyName);
    if (inside(legacyRoot, destinationRoot) || inside(destinationRoot, legacyRoot)) {
      throw new Error(`Unsichere Überlappung von Quelle und Dokumentenspeicher: ${legacyRoot}`);
    }
  }

  for (const required of ['doc_migration_runs', 'doc_migration_items', 'doc_files', 'doc_folders', 'doc_links', 'doc_module_import']) {
    if (!tableExists(db, required)) throw new Error(`Erforderliche Tabelle fehlt: ${required}`);
  }

  const runInsert = db.prepare(`
    INSERT INTO doc_migration_runs (id, status, dry_run, summary_json)
    VALUES (?, 'running', ?, '{}')
    ON CONFLICT(id) DO UPDATE SET
      finished_at='', status='running', dry_run=excluded.dry_run,
      summary_json='{}', report_path=''
  `);
  const runFinish = db.prepare(`
    UPDATE doc_migration_runs
       SET finished_at=datetime('now'), status=?, summary_json=?, report_path=?
     WHERE id=?
  `);
  const itemGet = db.prepare('SELECT * FROM doc_migration_items WHERE source_key=?');
  const itemPending = db.prepare(`
    INSERT INTO doc_migration_items
      (source_key, run_id, kind, source_path, target_path, file_id, sha256, status,
       adjustments_json, error_text, updated_at)
    VALUES
      (@sourceKey, @runId, @kind, @sourcePath, @targetPath, @fileId, @sha256, 'pending',
       @adjustmentsJson, '', datetime('now'))
    ON CONFLICT(source_key) DO UPDATE SET
      run_id=excluded.run_id, kind=excluded.kind, source_path=excluded.source_path,
      target_path=CASE WHEN doc_migration_items.target_path='' THEN excluded.target_path ELSE doc_migration_items.target_path END,
      file_id=CASE WHEN doc_migration_items.file_id='' THEN excluded.file_id ELSE doc_migration_items.file_id END,
      sha256=CASE WHEN doc_migration_items.sha256='' THEN excluded.sha256 ELSE doc_migration_items.sha256 END,
      status='pending', adjustments_json=excluded.adjustments_json, error_text='', updated_at=datetime('now')
  `);
  const itemDone = db.prepare(`
    UPDATE doc_migration_items
       SET status=?, file_id=?, sha256=?, target_path=?, adjustments_json=?,
           error_text='', updated_at=datetime('now')
     WHERE source_key=?
  `);
  const itemError = db.prepare(`
    UPDATE doc_migration_items
       SET status='error', error_text=?, updated_at=datetime('now')
     WHERE source_key=?
  `);
  const fileById = db.prepare('SELECT * FROM doc_files WHERE id=?');
  const filesBySha = db.prepare("SELECT * FROM doc_files WHERE sha256=? AND size=? AND deleted_at='' ORDER BY created_at,id");
  const fileUpdate = db.prepare(`
    UPDATE doc_files SET
      area=@area, case_id=@caseId, folder_id=@folderId, name=@name, name_key=@nameKey,
      size=@size, sha256=@sha256, storage_relpath=@storageRelpath,
      storage_dev=@storageDev, storage_ino=@storageIno,
      deleted_from=CASE WHEN @deletedFrom IS NULL THEN deleted_from ELSE @deletedFrom END,
      storage_status='physical', last_seen_at=datetime('now'), updated_at=datetime('now')
    WHERE id=@id
  `);
  const fileInsert = db.prepare(`
    INSERT INTO doc_files
      (id, area, case_id, folder_id, name, name_key, mime_type, size, sha256,
       storage_relpath, storage_dev, storage_ino, storage_status, last_seen_at,
       created_at, updated_at, created_by)
    VALUES
      (@id, @area, @caseId, @folderId, @name, @nameKey, @mimeType, @size, @sha256,
       @storageRelpath, @storageDev, @storageIno, 'physical', datetime('now'),
       COALESCE(NULLIF(@createdAt,''),datetime('now')), datetime('now'), @createdBy)
  `);
  const linkInsert = db.prepare(`
    INSERT OR IGNORE INTO doc_links (module, owner_id, slot, file_id, detail_json)
    VALUES (@module,@ownerId,@slot,@fileId,@detailJson)
  `);
  const linkRead = db.prepare(`
    SELECT file_id FROM doc_links WHERE module=? AND owner_id=? AND slot=?
  `);
  const linkRebindStale = db.prepare(`
    UPDATE doc_links
       SET file_id=@fileId, detail_json=@detailJson
     WHERE module=@module AND owner_id=@ownerId AND slot=@slot
       AND file_id=@previousFileId
  `);
  const importInsert = db.prepare(`
    INSERT OR IGNORE INTO doc_module_import (quelle,quell_id,file_id) VALUES (?,?,?)
  `);
  const importAdoptEmpty = db.prepare(`
    UPDATE doc_module_import SET file_id=?
     WHERE quelle=? AND quell_id=? AND file_id=''
  `);
  const importRead = db.prepare(`
    SELECT file_id FROM doc_module_import WHERE quelle=? AND quell_id=?
  `);
  const importRebindStale = db.prepare(`
    UPDATE doc_module_import
       SET file_id=@fileId, imported_at=datetime('now')
     WHERE quelle=@quelle AND quell_id=@quellId AND file_id=@previousFileId
  `);
  const folderFind = db.prepare(`
    SELECT * FROM doc_folders
     WHERE area=? AND case_id=? AND parent_id=? AND name_key=?
     ORDER BY id LIMIT 1
  `);
  const folderInsert = db.prepare(`
    INSERT INTO doc_folders
      (id,area,case_id,parent_id,name,name_key,storage_relpath,updated_at)
    VALUES (?,?,?,?,?,?,?,datetime('now'))
  `);
  const caseByIdStmt = db.prepare('SELECT id FROM cases WHERE id=?');
  const casesByLabelStmt = db.prepare('SELECT id FROM cases WHERE label=? ORDER BY id');

  function caseAssignment(caseId, label) {
    const explicit = String(caseId || '').trim();
    const normalizedLabel = String(label || '').trim();
    if (explicit) {
      return caseByIdStmt.get(explicit)
        ? { caseId: explicit, label: normalizedLabel, invalidId: false, ambiguous: false }
        : { caseId: '', label: normalizedLabel, invalidId: true, ambiguous: false, explicitId: explicit };
    }
    const rows = normalizedLabel ? casesByLabelStmt.all(normalizedLabel) : [];
    return {
      caseId: rows.length === 1 ? String(rows[0].id) : '',
      label: normalizedLabel,
      invalidId: false,
      ambiguous: rows.length > 1
    };
  }

  function caseIdFor(caseId, label) {
    return caseAssignment(caseId, label).caseId;
  }

  function caseAssignmentAdjustments(assignment) {
    if (assignment.invalidId) {
      return [{
        code: 'ungueltige_fall_id_unzugeordnet',
        text: `Die gespeicherte Fall-ID „${assignment.explicitId}“ existiert nicht; der Fachbestand bleibt sichtbar in der Büroablage unzugeordnet.`
      }];
    }
    if (assignment.ambiguous) {
      return [{
        code: 'mehrdeutiger_fallbezug_unzugeordnet',
        text: `Die Fallbezeichnung „${assignment.label}“ gehört zu mehreren Fällen; der Fachbestand bleibt sichtbar in der Büroablage unzugeordnet.`
      }];
    }
    return [];
  }

  function normalizedSegments(segments) {
    return (segments || []).map((part) => names.normalisiereDateiname(part, { fallback: 'Unbenannt' }).name);
  }

  function collisionSuffixRemoved(value) {
    return String(value || '').replace(/\s+\(\d+\)(?=(?:\.[^.]+)?$)/, '');
  }

  function mappedDocumentSegments(file, dokuByFilename) {
    let existing = [];
    try { existing = storage.folderSegments(file.area, file.case_id, file.folder_id); }
    catch (_error) { existing = []; }
    existing = existing.filter(Boolean);
    while (existing.length && /^(?:fallakte|modulordner)$/i.test(existing[0])) existing.shift();

    if (file.area !== 'case') {
      const [year, month] = yearMonth(file.created_at);
      const first = String(existing[0] || '');
      const pathYear = existing.find((segment) => /^\d{4}$/.test(segment)) || year;
      const pathMonth = existing.find((segment) => /^(?:0[1-9]|1[0-2])$/.test(segment)) || month;
      if (/^kontoausz/i.test(first)) return ['Finanzen', 'Kontoauszüge', pathYear, pathMonth];
      if (/^(?:finanz[- ]?)?belege?$/i.test(first)) return ['Finanzen', 'Belege', pathYear, pathMonth];
      if (/^posteingang$/i.test(first)) {
        return ['Posteingang', pathYear, pathMonth];
      }
      if (/^fallintakes?$/i.test(first)) {
        return ['Posteingang', 'Fallbeginn', ...normalizedSegments(existing.slice(1)), year, month];
      }
      return existing.length ? ['Eingang', ...normalizedSegments(existing)] : ['Eingang'];
    }

    if (/^falldokumentation$/i.test(String(existing[0] || ''))) {
      const key = names.vergleichsschluessel(collisionSuffixRemoved(file.name));
      const matches = dokuByFilename && dokuByFilename.get(key);
      if (matches && matches.length) {
        try { return taxonomy.dokuPfad(matches[0].data, matches[0].row.created_at); }
        catch (_error) { /* Dateiname-Fallback folgt */ }
      }
      const match = /^(\d{2})(\d{2})(\d{2})\s+([0-2]\d)([0-5]\d)\b/.exec(String(file.name || ''));
      const fallback = match
        ? `20${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`
        : (file.created_at || now().toISOString());
      try {
        return taxonomy.dokuPfad(
          { date: fallback, type: 'Dokumentationseintrag' },
          file.created_at || fallback
        );
      } catch (_error) {
        return ['11 - Betreuungsführung', 'Falldokumentation', ...yearMonth(file.created_at), 'Dokumentationseintrag'];
      }
    }
    if (/^passfoto$/i.test(String(existing[0] || ''))) return ['01 - Stammdaten'];
    if (/^betreuerausweis$/i.test(String(existing[0] || ''))) return ['02 - Kerndokumente'];
    if (/^kontoausz/i.test(String(existing[0] || ''))) {
      return ['05 - Finanzen', 'Konto unbekannt', ...yearMonth(file.created_at)];
    }
    const code = existing.length ? taxonomy.registerCode(existing[0]) : '';
    const semanticCode = taxonomy.ciFolderGuessCode([...existing, file.name, file.mime_type].join(' '));
    // Die konkurrierende Alttaxonomie führte Leistungsträger teilweise ausdrücklich unter 03.
    // Diese bekannte Fehlklassifikation hat Vorrang vor der alten Nummer (Entscheidung E3).
    if (existing.length && /leistungstr|rente|grundsicherung|wohngeld|krankenkasse/i.test(existing[0])) {
      return [taxonomy.REGISTER_BY_CODE['05'].name, ...normalizedSegments(existing.slice(1))];
    }
    if (code && taxonomy.REGISTER_BY_CODE[code]) {
      return [taxonomy.REGISTER_BY_CODE[code].name, ...normalizedSegments(existing.slice(1))];
    }
    const root = taxonomy.REGISTER_BY_CODE[semanticCode].name;
    const semanticChildren = /^test$/i.test(String(existing[0] || '')) ? [] : existing;
    return [root, ...normalizedSegments(semanticChildren)];
  }

  function relativeDirectory(area, caseId, segments) {
    const scope = area === 'case'
      ? storage.caseRootInfo(caseId, false).storageRelpath
      : 'Büroorganisation';
    return [scope, ...normalizedSegments(segments)].join('/');
  }

  function chooseName(relativeDir, wanted, sourcePath, reserved) {
    const normalized = names.normalisiereDateiname(wanted, { fallback: 'Unbenannt' });
    const adjustments = [...normalized.reasons];
    const directory = joinRoot(storage.root(), relativeDir);
    let listed = [];
    try { listed = fs.readdirSync(directory); } catch (_error) { listed = []; }
    const sourceAbs = sourcePath ? path.resolve(sourcePath) : '';
    const taken = (candidate) => {
      const key = names.vergleichsschluessel(candidate);
      if (reserved.has(`${relativeDir}\0${key}`)) return true;
      return listed.some((entry) => {
        const entryPath = path.resolve(directory, entry);
        return entryPath !== sourceAbs && names.vergleichsschluessel(entry) === key;
      });
    };
    let candidate = normalized.name;
    if (taken(candidate)) {
      const match = /^(.+?)(\.[^.]{1,32})?$/.exec(candidate);
      const stem = (match && match[1]) || candidate;
      const extension = (match && match[2]) || '';
      let index = 2;
      do {
        candidate = names.normalisiereDateiname(`${stem} (${index++})${extension}`).name;
      } while (taken(candidate) && index < 10000);
      adjustments.push({
        code: 'kollision',
        text: `Der Name war bereits belegt und wurde sichtbar in „${candidate}“ geändert.`
      });
    }
    reserved.add(`${relativeDir}\0${names.vergleichsschluessel(candidate)}`);
    return { name: candidate, adjustments };
  }

  function targetDescriptor(area, caseId, segments, wantedName, sourcePath, reserved) {
    const relativeDir = relativeDirectory(area, caseId, segments);
    const selected = chooseName(relativeDir, wantedName, sourcePath, reserved);
    return {
      relativeDir,
      name: selected.name,
      storageRelpath: `${relativeDir}/${selected.name}`,
      targetPath: joinRoot(storage.root(), `${relativeDir}/${selected.name}`),
      adjustments: selected.adjustments
    };
  }

  function moduleDescriptor(input, reserved) {
    const area = input.area === 'case' ? 'case' : 'office';
    const caseId = area === 'case' ? String(input.caseId || '') : '';
    const target = targetDescriptor(
      area,
      caseId,
      input.segments || ['Eingang'],
      datedName(input.filename, input.date),
      input.sourcePath,
      reserved
    );
    return Object.assign({
      kind: 'module',
      links: [],
      imports: [],
      mimeType: 'application/octet-stream',
      createdBy: null,
      createdAt: '',
      detail: {}
    }, input, target, {
      area,
      caseId,
      adjustments: (input.adjustments || []).concat(target.adjustments)
    });
  }

  function discover() {
    const reserved = new Set();
    const claimed = new Set();
    const items = [];
    const claim = (candidate, expectedRoot) => {
      if (candidate && expectedRoot && !inside(path.resolve(expectedRoot), path.resolve(candidate))) return '';
      if (candidate && fileStat(candidate)) claimed.add(path.resolve(candidate));
      return candidate;
    };

    const dokuRows = selectAll(db, 'case_doku_entries', ['id', 'case_id', 'data_json', 'created_at']);
    const dokuByFilename = new Map();
    for (const row of dokuRows) {
      const data = jsonParse(row.data_json, {});
      for (const photo of (Array.isArray(data.photos) ? data.photos : [])) {
        if (!photo || !photo.filename) continue;
        const key = names.vergleichsschluessel(collisionSuffixRemoved(photo.filename));
        if (!dokuByFilename.has(key)) dokuByFilename.set(key, []);
        dokuByFilename.get(key).push({ row, data, photo });
      }
    }

    const docRows = db.prepare('SELECT * FROM doc_files ORDER BY created_at,id').all();
    for (const file of docRows) {
      const foundPath = storage.findBlobPath(file);
      const sourcePath = claim(foundPath)
        || path.join(dataRoot, 'files', String(file.id));
      // Bereits vollständig physische Zeilen sind kein neuer Bestandsgegenstand. Dies macht
      // insbesondere die im selben Lauf aus Fachmodulen neu angelegten doc_files beim
      // Wiederholen sofort zu einem No-op.
      if (['physical', 'ok'].includes(file.storage_status) && file.storage_relpath && foundPath) {
        let indexedTarget = '';
        try { indexedTarget = joinRoot(storage.root(), file.storage_relpath); } catch (_error) { indexedTarget = ''; }
        if (indexedTarget && path.resolve(indexedTarget) === path.resolve(foundPath)) continue;
      }
      let relativeDir;
      let target;
      if (file.deleted_at) {
        relativeDir = `Büroorganisation/_Verwaltung & Sicherungen/_Technik/Papierkorb/${file.area === 'case' ? `Fall-${String(file.case_id).slice(0, 36)}` : 'Büroorganisation'}/${file.id}`;
        target = chooseName(relativeDir, file.name, sourcePath, reserved);
      } else {
        const segments = mappedDocumentSegments(file, dokuByFilename);
        relativeDir = relativeDirectory(file.area, file.case_id, segments);
        target = chooseName(relativeDir, file.name, sourcePath, reserved);
      }
      items.push({
        sourceKey: `doc:${file.id}`,
        kind: 'document',
        sourcePath,
        fileId: file.id,
        area: file.area,
        caseId: file.case_id,
        segments: file.deleted_at ? [] : mappedDocumentSegments(file, dokuByFilename),
        restoreSegments: file.deleted_at ? mappedDocumentSegments(file, dokuByFilename) : [],
        deleted: !!file.deleted_at,
        relativeDir,
        name: target.name,
        storageRelpath: `${relativeDir}/${target.name}`,
        targetPath: joinRoot(storage.root(), `${relativeDir}/${target.name}`),
        expectedSha: String(file.sha256 || ''),
        mimeType: file.mime_type,
        adjustments: target.adjustments,
        detail: { previousName: file.name, previousStorageRelpath: file.storage_relpath || '' }
      });
    }

    const photos = new Map();
    for (const row of dokuRows) {
      const data = jsonParse(row.data_json, {});
      for (const photo of (Array.isArray(data.photos) ? data.photos : [])) {
        if (!photo || !photo.id) continue;
        const key = `${row.case_id}/${photo.id}`;
        if (!photos.has(key)) photos.set(key, {
          caseId: String(row.case_id),
          photoId: String(photo.id),
          filename: String(photo.filename || 'Anlage'),
          mimeType: String(photo.mimeType || 'application/octet-stream'),
          date: data.eventDate || data.ereignisdatum || data.date || data.datum || row.created_at,
          entry: row,
          data,
          references: []
        });
        photos.get(key).references.push(row);
      }
    }
    for (const photo of photos.values()) {
      const dokuRoot = path.join(dataRoot, 'case-doku-photos');
      let sourcePath = '';
      let sourceAdjustment = [];
      try {
        sourcePath = claim(dokuAttachments.resolve(
          dokuRoot,
          photo.caseId,
          photo.photoId,
          photo.entry.id
        ), dokuRoot) || dokuAttachments.canonicalPath(dokuRoot, photo.caseId, photo.photoId);
      } catch (error) {
        sourceAdjustment = [{
          code: 'ungueltige_quellkennung',
          text: `Doku-Anlage konnte wegen einer ungültigen Kennung nicht aufgelöst werden: ${error.message}`
        }];
      }
      let segments;
      let dateAdjustment = [];
      try { segments = taxonomy.dokuPfad(photo.data, photo.entry.created_at); }
      catch (_error) {
        const fallback = now().toISOString();
        segments = taxonomy.dokuPfad({
          date: fallback,
          type: photo.data.type || photo.data.art || 'Dokumentationseintrag'
        }, fallback);
        dateAdjustment = [{
          code: 'datums_fallback',
          text: 'Kein gültiges Ereignis-/Anlagedatum; für die Einordnung wurde das protokollierte Umstellungsdatum verwendet.'
        }];
      }
      items.push(moduleDescriptor({
        sourceKey: `module:doku:${photo.caseId}:${photo.photoId}`,
        sourcePath,
        area: 'case',
        caseId: photo.caseId,
        segments,
        filename: photo.filename,
        date: photo.date,
        mimeType: photo.mimeType,
        links: photo.references.map((row) => ({
          module: 'doku-photo',
          ownerId: String(row.id),
          slot: photo.photoId,
          detail: { caseId: photo.caseId }
        })),
        imports: [
          { quelle: 'dokuanlagen', quellId: `${photo.caseId}/${photo.photoId}` },
          ...photo.references.map((row) => ({
            quelle: 'dokuanlagen',
            quellId: `${photo.caseId}/${row.id}/${photo.photoId}`
          }))
        ],
        detail: { sharedReferences: photo.references.map((row) => String(row.id)) },
        adjustments: sourceAdjustment.concat(dateAdjustment)
      }, reserved));
    }

    for (const row of selectAll(db, 'inbox_documents', [
      'id', 'file_name', 'mime_type', 'case_id', 'case_label',
      'inbox_date', 'received_date', 'created_at', 'created_by'
    ])) {
      const assignment = caseAssignment(row.case_id, row.case_label);
      const caseId = assignment.caseId;
      const date = row.received_date || row.inbox_date || row.created_at;
      const ym = yearMonth(date);
      items.push(moduleDescriptor({
        sourceKey: `module:inbox:${row.id}`,
        sourcePath: claim(path.join(dataRoot, 'inbox-documents', String(row.id)), path.join(dataRoot, 'inbox-documents')),
        area: caseId ? 'case' : 'office',
        caseId,
        segments: caseId ? ['00 - Eingang'] : ['Posteingang', ...ym],
        filename: row.file_name,
        date,
        mimeType: row.mime_type,
        createdBy: row.created_by,
        createdAt: row.created_at,
        adjustments: caseAssignmentAdjustments(assignment),
        links: [{ module: 'inbox', ownerId: String(row.id), slot: '', detail: {} }],
        imports: [{ quelle: 'posteingang', quellId: String(row.id) }]
      }, reserved));
    }

    for (const row of selectAll(db, 'finance_receipts', [
      'id', 'filename', 'mime_type', 'invoice_date', 'uploaded_at', 'uploaded_by'
    ])) {
      const date = row.invoice_date || row.uploaded_at;
      items.push(moduleDescriptor({
        sourceKey: `module:finance-receipt:${row.id}`,
        sourcePath: claim(path.join(dataRoot, 'finance-receipts', String(row.id)), path.join(dataRoot, 'finance-receipts')),
        segments: ['Finanzen', 'Belege', ...yearMonth(date)],
        filename: row.filename,
        date,
        mimeType: row.mime_type,
        createdBy: row.uploaded_by,
        createdAt: row.uploaded_at,
        links: [{ module: 'finance-receipt', ownerId: String(row.id), slot: '', detail: {} }],
        imports: [{ quelle: 'belege', quellId: String(row.id) }]
      }, reserved));
    }

    for (const row of selectAll(db, 'finance_statements', [
      'id', 'filename', 'mime_type', 'uploaded_at', 'uploaded_by'
    ])) {
      const date = row.uploaded_at;
      items.push(moduleDescriptor({
        sourceKey: `module:finance-statement:${row.id}`,
        sourcePath: claim(path.join(dataRoot, 'finance-statements', String(row.id)), path.join(dataRoot, 'finance-statements')),
        segments: ['Finanzen', 'Kontoauszüge', ...yearMonth(date)],
        filename: row.filename,
        date,
        mimeType: row.mime_type,
        createdBy: row.uploaded_by,
        createdAt: row.uploaded_at,
        links: [{ module: 'finance-statement', ownerId: String(row.id), slot: '', detail: {} }],
        imports: [{ quelle: 'auszuege', quellId: String(row.id) }]
      }, reserved));
    }

    const todoRows = selectAll(db, 'todos', ['id', 'case_id', 'case_label', 'due_at', 'start_at', 'created_at']);
    const todoById = new Map(todoRows.map((row) => [String(row.id), row]));
    for (const row of selectAll(db, 'todo_attachments', [
      'id', 'todo_id', 'filename', 'mime_type', 'created_at', 'created_by'
    ])) {
      const owner = todoById.get(String(row.todo_id)) || {};
      const assignment = caseAssignment(owner.case_id, owner.case_label);
      const caseId = assignment.caseId;
      const date = owner.due_at || owner.start_at || row.created_at;
      items.push(moduleDescriptor({
        sourceKey: `module:todo:${row.todo_id}:${row.id}`,
        sourcePath: claim(path.join(dataRoot, 'todo-attachments', String(row.todo_id), String(row.id)), path.join(dataRoot, 'todo-attachments')),
        area: caseId ? 'case' : 'office',
        caseId,
        segments: caseId
          ? ['11 - Betreuungsführung', 'Schriftverkehr', ...yearMonth(date)]
          : ['Termine & Aufgaben', ...yearMonth(date)],
        filename: row.filename,
        date,
        mimeType: row.mime_type,
        createdBy: row.created_by,
        createdAt: row.created_at,
        adjustments: caseAssignmentAdjustments(assignment),
        links: [{ module: 'todo-attachment', ownerId: String(row.todo_id), slot: String(row.id), detail: {} }],
        imports: [{ quelle: 'todo-anlagen', quellId: `${row.todo_id}/${row.id}` }]
      }, reserved));
    }

    const eventRows = selectAll(db, 'calendar_events', [
      'id', 'case_id', 'case_label', 'start_at', 'created_at'
    ]);
    const eventById = new Map(eventRows.map((row) => [String(row.id), row]));
    for (const row of selectAll(db, 'calendar_event_attachments', [
      'id', 'event_id', 'filename', 'mime_type', 'created_at', 'created_by'
    ])) {
      const owner = eventById.get(String(row.event_id)) || {};
      const assignment = caseAssignment(owner.case_id, owner.case_label);
      const caseId = assignment.caseId;
      const date = owner.start_at || row.created_at;
      items.push(moduleDescriptor({
        sourceKey: `module:calendar:${row.event_id}:${row.id}`,
        sourcePath: claim(path.join(dataRoot, 'calendar-event-attachments', String(row.event_id), String(row.id)), path.join(dataRoot, 'calendar-event-attachments')),
        area: caseId ? 'case' : 'office',
        caseId,
        segments: caseId
          ? ['11 - Betreuungsführung', 'Schriftverkehr', ...yearMonth(date)]
          : ['Termine & Aufgaben', ...yearMonth(date)],
        filename: row.filename,
        date,
        mimeType: row.mime_type,
        createdBy: row.created_by,
        createdAt: row.created_at,
        adjustments: caseAssignmentAdjustments(assignment),
        links: [{ module: 'calendar-attachment', ownerId: String(row.event_id), slot: String(row.id), detail: {} }],
        imports: [{ quelle: 'kalender-anlagen', quellId: `${row.event_id}/${row.id}` }]
      }, reserved));
    }

    const profile = selectAll(db, 'office_profile', [
      'id', 'logo_filename', 'logo_mime_type', 'updated_at'
    ])[0];
    if (profile && profile.logo_filename) {
      const logoPath = path.resolve(dataRoot, 'office-logo', String(profile.logo_filename));
      const logoRoot = path.resolve(dataRoot, 'office-logo');
      if (inside(logoRoot, logoPath)) {
        items.push(moduleDescriptor({
          sourceKey: 'module:office-logo:1',
          sourcePath: claim(logoPath, logoRoot),
          segments: ['Stammdaten'],
          filename: profile.logo_filename,
          date: profile.updated_at,
          mimeType: profile.logo_mime_type,
          createdAt: profile.updated_at,
          // Muss exakt dem Laufzeitvertrag in routes/office-profile.js entsprechen.
          links: [{ module: 'office-logo', ownerId: 'default', slot: '', detail: {} }],
          imports: [{ quelle: 'buero-logo', quellId: 'default' }]
        }, reserved));
      }
    }

    const orphanRoots = [['files', path.join(dataRoot, 'files')]]
      .concat(MODULE_ROOTS.map((name) => [name, path.join(dataRoot, name)]));
    for (const [label, rootPath] of orphanRoots) {
      for (const candidate of walkRegular(rootPath)) {
        if (claimed.has(path.resolve(candidate))) continue;
        const relativeSource = path.relative(rootPath, candidate).split(path.sep).join('/');
        const safeParts = normalizedSegments(relativeSource.split('/'));
        const relativeDir = ['Büroorganisation', '_Verwaltung & Sicherungen', '_Technik', 'Waisen', names.normalisiereDateiname(label).name, ...safeParts.slice(0, -1)].join('/');
        const selected = chooseName(relativeDir, safeParts[safeParts.length - 1] || 'Unbenannt', candidate, reserved);
        items.push({
          sourceKey: `orphan:${label}:${relativeSource}`,
          kind: 'orphan',
          sourcePath: candidate,
          fileId: '',
          relativeDir,
          name: selected.name,
          storageRelpath: `${relativeDir}/${selected.name}`,
          targetPath: joinRoot(storage.root(), `${relativeDir}/${selected.name}`),
          adjustments: selected.adjustments.concat({
            code: 'waise',
            text: `Keine Datenbankzuordnung; Herkunft „${label}/${relativeSource}“ bleibt im Bericht erhalten.`
          }),
          detail: { sourceRoot: label, originalRelativePath: relativeSource }
        });
      }
    }
    return items;
  }

  function ensureFolder(area, caseId, segments) {
    if (area === 'case') storage.ensureCaseLayout(caseId, null);
    else storage.ensureTopLevel();
    let parentId = '';
    for (const rawName of normalizedSegments(segments)) {
      const key = names.vergleichsschluessel(rawName);
      let row = folderFind.get(area, String(caseId || ''), parentId, key);
      if (!row) {
        const id = crypto.randomUUID();
        const parentSegments = parentId ? storage.folderSegments(area, caseId, parentId) : [];
        const scope = area === 'case'
          ? storage.caseRootInfo(caseId, true).storageRelpath
          : 'Büroorganisation';
        const relpath = [scope, ...parentSegments, rawName].join('/');
        folderInsert.run(id, area, String(caseId || ''), parentId, rawName, key, relpath);
        row = { id, name: rawName };
      }
      parentId = String(row.id);
      storage.folderRelpath(area, caseId, parentId, true);
    }
    return parentId;
  }

  /*
   * Nach dem Umhängen dürfen die leeren Zeilen der konkurrierenden Alt-
   * Taxonomien nicht weiter im Explorer erscheinen. Entfernt werden nur
   * vollständig unreferenzierte Ordner; die 13 Register und jede Ahnenkette
   * eines weiterhin referenzierten Ordners bleiben erhalten. Die kompletten
   * Zeilen landen VOR der Transaktion im Umstellungsbericht.
   */
  function folderRetirementPlan(ignoreFileIds) {
    const ignored = new Set((ignoreFileIds || []).map(String));
    const folders = db.prepare(`
      SELECT * FROM doc_folders
      ORDER BY area,case_id,parent_id,sort_order,name,id
    `).all();
    const byId = new Map(folders.map((row) => [String(row.id), row]));
    const keep = new Set();
    const keepWithParents = (id) => {
      let current = String(id || '');
      const visited = new Set();
      while (current && byId.has(current) && !visited.has(current)) {
        visited.add(current);
        keep.add(current);
        current = String(byId.get(current).parent_id || '');
      }
    };

    for (const row of db.prepare('SELECT id,folder_id,deleted_from FROM doc_files').all()) {
      if (!ignored.has(String(row.id))) keepWithParents(row.folder_id);
      if (!ignored.has(String(row.id))) keepWithParents(row.deleted_from);
    }
    for (const row of folders) {
      if (row.area === 'case' && !row.parent_id
        && taxonomy.REGISTER.some((register) => names.dateinamenGleich(register.name, row.name))) {
        keep.add(String(row.id));
      }
    }

    function logicalPath(row) {
      const parts = [];
      let current = row;
      const visited = new Set();
      while (current && !visited.has(String(current.id))) {
        visited.add(String(current.id));
        parts.unshift(String(current.name || 'Unbenannt'));
        current = byId.get(String(current.parent_id || ''));
      }
      return parts.join('/');
    }
    function depth(row) {
      let n = 0;
      let current = row;
      const visited = new Set();
      while (current && !visited.has(String(current.id))) {
        visited.add(String(current.id));
        n++;
        current = byId.get(String(current.parent_id || ''));
      }
      return n;
    }

    return folders
      .filter((row) => !keep.has(String(row.id)))
      .map((row) => ({
        row,
        depth: depth(row),
        logicalPath: logicalPath(row),
        sourceKey: `folder:${row.id}`,
        sourcePath: `${row.area}/${row.case_id || 'office'}/${logicalPath(row)}`
      }))
      .sort((left, right) => right.depth - left.depth
        || left.sourcePath.localeCompare(right.sourcePath, 'de'));
  }

  function folderReportEntries(plan, status) {
    return plan.map((item) => ({
      sourceKey: item.sourceKey,
      kind: 'folder',
      sourcePath: item.sourcePath,
      targetPath: 'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Umstellungsberichte (Ordnerzeile im JSON-Bericht)',
      fileId: '',
      status,
      adjustments: [{
        code: 'altordner_ausgemustert',
        text: `Der leere, unreferenzierte Altordner „${item.logicalPath}“ wird aus dem Explorer ausgemustert; seine vollständige Datenbankzeile bleibt im Bericht.`
      }],
      detail: { folderRow: item.row }
    }));
  }

  function targetFromJournal(item, journal) {
    const rel = String(journal.target_path || item.storageRelpath || '');
    if (!rel) throw new Error('Journal enthält keinen Zielpfad.');
    const targetPath = joinRoot(storage.root(), rel);
    return { storageRelpath: rel, targetPath, name: path.basename(targetPath) };
  }

  function locateSourceOrTarget(item, target) {
    if (fileStat(item.sourcePath)) return { path: item.sourcePath, alreadyMoved: false };
    if (fileStat(target.targetPath)) return { path: target.targetPath, alreadyMoved: true };
    throw new Error(`Weder Quelle noch protokolliertes Ziel ist vorhanden: ${item.sourcePath}`);
  }

  function statLocator(filePath) {
    const stat = fs.statSync(filePath);
    return { storageDev: String(stat.dev), storageIno: String(stat.ino), size: stat.size };
  }

  function processDocument(item, journal) {
    const row = fileById.get(item.fileId);
    if (!row) throw new Error(`Dokumentzeile fehlt: ${item.fileId}`);
    const target = targetFromJournal(item, journal);
    const located = locateSourceOrTarget(item, target);
    let moved = { method: 'bereits-am-ziel' };
    if (!located.alreadyMoved || path.resolve(located.path) !== path.resolve(target.targetPath)) {
      const sourceSha = sha256File(located.path);
      const duplicate = existingCentralByHash(sourceSha, fs.statSync(located.path).size, row.id);
      if (duplicate && path.resolve(duplicate.filePath) !== path.resolve(located.path)) {
        if (item.expectedSha && sourceSha !== item.expectedSha) {
          throw new Error('Prüfsumme der Quelle weicht vom Dokumentindex ab.');
        }
        fs.mkdirSync(path.dirname(target.targetPath), { recursive: true });
        const copyMethod = storage.cloneCopy(duplicate.filePath, target.targetPath);
        if (sha256File(target.targetPath) !== sourceSha) {
          try { fs.unlinkSync(target.targetPath); } catch (_ignore) { /* best effort */ }
          throw new Error('Prüfsumme der deduplizierten Zielkopie stimmt nicht.');
        }
        // Kein Hardlink: getrennte Dateisemantik bleibt erhalten; auf APFS teilen Reflinks
        // trotzdem die unveränderten Datenblöcke.
        fs.unlinkSync(located.path);
        moved = { method: copyMethod === 'reflink' ? 'apfs-reflink-dedupliziert' : 'pruefsummen-kopie' };
      } else {
        moved = moveVerified(located.path, target.targetPath, item.expectedSha);
      }
    }
    const actualSha = sha256File(target.targetPath);
    if (item.expectedSha && actualSha !== item.expectedSha) throw new Error('Prüfsumme am Ziel weicht vom Dokumentindex ab.');
    const locator = statLocator(target.targetPath);
    const folderId = item.deleted ? row.folder_id : ensureFolder(item.area, item.caseId, item.segments);
    const deletedFrom = item.deleted
      ? ensureFolder(item.area, item.caseId, item.restoreSegments || [])
      : null;
    fileUpdate.run({
      id: row.id,
      area: item.area,
      caseId: item.caseId,
      folderId,
      name: target.name,
      nameKey: names.vergleichsschluessel(target.name),
      size: locator.size,
      sha256: actualSha,
      storageRelpath: target.storageRelpath,
      storageDev: locator.storageDev,
      storageIno: locator.storageIno,
      deletedFrom
    });
    storage.writeSidecar(fileById.get(row.id), target.targetPath);
    return { fileId: row.id, sha256: actualSha, target, method: moved.method };
  }

  function existingCentralByHash(hash, size, excludeId) {
    if (!hash) return null;
    for (const candidate of filesBySha.all(hash, size)) {
      if (excludeId && String(candidate.id) === String(excludeId)) continue;
      if (!['physical', 'ok'].includes(candidate.storage_status) || !candidate.storage_relpath) continue;
      const candidatePath = storage.findBlobPath(candidate);
      if (candidatePath && fileStat(candidatePath) && sha256File(candidatePath) === hash) {
        return { row: candidate, filePath: candidatePath };
      }
    }
    return null;
  }

  function attachLinks(item, fileId, staleIds) {
    const stale = staleIds || new Set();
    for (const link of item.links || []) {
      linkInsert.run({
        module: link.module,
        ownerId: link.ownerId,
        slot: link.slot || '',
        fileId,
        detailJson: JSON.stringify(link.detail || {})
      });
      let stored = linkRead.get(link.module, link.ownerId, link.slot || '');
      if (stored && String(stored.file_id) !== String(fileId)
        && stale.has(String(stored.file_id))) {
        linkRebindStale.run({
          module: link.module,
          ownerId: link.ownerId,
          slot: link.slot || '',
          previousFileId: String(stored.file_id),
          fileId,
          detailJson: JSON.stringify(link.detail || {})
        });
        stored = linkRead.get(link.module, link.ownerId, link.slot || '');
      }
      if (!stored || String(stored.file_id) !== String(fileId)) {
        throw new Error(`Vorhandener Modulverweis ${link.module}/${link.ownerId}/${link.slot || ''} zeigt auf eine andere Datei.`);
      }
    }
    for (const entry of item.imports || []) {
      // Der alte Doku-Nachzug hat bei geteilten Fotokennungen teils bereits eine
      // Zuordnungszeile mit leerer file_id hinterlassen. Diese Zeile bezeichnet
      // dieselbe fachliche Anlage und darf atomar auf den nun eindeutigen
      // Zentralverweis vervollständigt werden.
      importAdoptEmpty.run(fileId, entry.quelle, entry.quellId);
      importInsert.run(entry.quelle, entry.quellId, fileId);
      let stored = importRead.get(entry.quelle, entry.quellId);
      if (stored && String(stored.file_id) !== String(fileId)
        && stale.has(String(stored.file_id))) {
        importRebindStale.run({
          quelle: entry.quelle,
          quellId: entry.quellId,
          previousFileId: String(stored.file_id),
          fileId
        });
        stored = importRead.get(entry.quelle, entry.quellId);
      }
      if (!stored || String(stored.file_id) !== String(fileId)) {
        throw new Error(`Vorhandene Importzuordnung ${entry.quelle}/${entry.quellId} zeigt auf eine andere Datei.`);
      }
    }
  }

  function mappedModuleFile(item) {
    const ids = new Set();
    for (const entry of item.imports || []) {
      const stored = importRead.get(entry.quelle, entry.quellId);
      if (stored && String(stored.file_id || '')) ids.add(String(stored.file_id));
    }
    for (const link of item.links || []) {
      const stored = linkRead.get(link.module, link.ownerId, link.slot || '');
      if (stored && String(stored.file_id || '')) ids.add(String(stored.file_id));
    }
    const active = [];
    const staleIds = new Set();
    for (const id of ids) {
      const row = fileById.get(id);
      if (!row || row.deleted_at) staleIds.add(id);
      else active.push(row);
    }
    if (active.length > 1) {
      throw new Error(
        `Das Fachobjekt ${item.sourceKey} besitzt widersprüchliche aktive Zentralverweise: ${active.map((row) => row.id).join(', ')}`
      );
    }
    if (!active.length) return { mapped: null, staleIds };
    const row = active[0];
    const filePath = storage.findBlobPath(row);
    return {
      mapped: { row, filePath: filePath && fileStat(filePath) ? filePath : '' },
      staleIds
    };
  }

  function processModule(item, journal) {
    const target = targetFromJournal(item, journal);
    const located = locateSourceOrTarget(item, target);
    const sourceSha = sha256File(located.path);
    const sourceSize = fs.statSync(located.path).size;
    let fileId = String(journal.file_id || '');
    let row = fileId ? fileById.get(fileId) : null;
    let targetPath = target.targetPath;
    let method = 'bereits-am-ziel';
    const mapping = mappedModuleFile(item);
    const mappingAdjustments = [];
    if (mapping.staleIds.size) {
      mappingAdjustments.push({
        code: 'veralteter_fachverweis_neu_gebunden',
        text: `Gelöschte oder nicht mehr vorhandene Altzuordnung(en) ${[...mapping.staleIds].join(', ')} wurden sichtbar auf die erhaltene Moduldatei neu gebunden.`
      });
    }

    if (!row) {
      /*
       * Nur ein bereits vorhandener FACHverweis darf auf dieselbe doc_files-Zeile
       * zeigen. Ein bloßer SHA-Treffer reicht nicht: sonst könnte beispielsweise
       * ein Posteingangsdokument auf eine Datei einer fremden Fallakte zeigen und
       * läge weder im fachlich richtigen Ordner noch im richtigen Rechteraum.
       * Allgemeine Inhaltsduplikate bleiben getrennte logische Dateien und werden
       * später ausschließlich per Copy-on-write dedupliziert.
       */
      const mapped = mapping.mapped;
      if (mapped) {
        if (mapped.filePath) {
          const mappedSha = sha256File(mapped.filePath);
          if (mappedSha !== sourceSha || fs.statSync(mapped.filePath).size !== sourceSize) {
            throw new Error(`Der bestehende Fachverweis ${item.sourceKey} hat einen abweichenden Inhalt.`);
          }
        } else {
          if ((mapped.row.sha256 && String(mapped.row.sha256) !== sourceSha)
            || (Number(mapped.row.size) && Number(mapped.row.size) !== sourceSize)) {
            throw new Error(`Der bestehende Fachverweis ${item.sourceKey} ist physisch fehlend und seine Index-Prüfsumme passt nicht zur Modulquelle.`);
          }
          mappingAdjustments.push({
            code: 'fehlenden_fachinhalt_repariert',
            text: 'Der aktive Fachverweis hatte keinen lesbaren Dateiinhalt; die nach Prüfsumme passende Modulquelle wurde als Primärdatei übernommen.'
          });
        }
        row = mapped.row;
        fileId = row.id;
        targetPath = mapped.filePath || target.targetPath;
      } else {
        fileId = fileId || crypto.randomUUID();
      }
    } else if (mapping.mapped && String(mapping.mapped.row.id) !== String(row.id)) {
      throw new Error(
        `Das Umstellungsjournal für ${item.sourceKey} und der aktive Fachverweis zeigen auf verschiedene Dateien.`
      );
    }

    if (row) {
      const existingPath = storage.findBlobPath(row);
      if (existingPath && fileStat(existingPath) && sha256File(existingPath) === sourceSha) {
        attachLinks(item, row.id, mapping.staleIds);
        if (path.resolve(located.path) !== path.resolve(existingPath)) {
          removeVerifiedDuplicate(located.path, existingPath, sourceSha);
          method = 'dedupliziert-fortgesetzt';
        }
        return {
          fileId: row.id,
          sha256: sourceSha,
          target: { storageRelpath: row.storage_relpath, targetPath: existingPath, name: row.name },
          method,
          adjustments: mappingAdjustments
        };
      }
    }

    if (!located.alreadyMoved || path.resolve(located.path) !== path.resolve(target.targetPath)) {
      const moved = moveVerified(located.path, target.targetPath, sourceSha);
      method = moved.method;
    }
    const actualSha = sha256File(target.targetPath);
    if (actualSha !== sourceSha) throw new Error('Prüfsumme der übernommenen Moduldatei stimmt nicht.');
    const folderId = ensureFolder(item.area, item.caseId, item.segments);
    const locator = statLocator(target.targetPath);
    if (!row) {
      fileInsert.run({
        id: fileId,
        area: item.area,
        caseId: item.caseId,
        folderId,
        name: target.name,
        nameKey: names.vergleichsschluessel(target.name),
        mimeType: item.mimeType || 'application/octet-stream',
        size: locator.size,
        sha256: actualSha,
        storageRelpath: target.storageRelpath,
        storageDev: locator.storageDev,
        storageIno: locator.storageIno,
        createdAt: item.createdAt || '',
        createdBy: item.createdBy == null ? null : item.createdBy
      });
    } else {
      fileUpdate.run({
        id: fileId,
        area: item.area,
        caseId: item.caseId,
        folderId,
        name: target.name,
        nameKey: names.vergleichsschluessel(target.name),
        size: locator.size,
        sha256: actualSha,
        storageRelpath: target.storageRelpath,
        storageDev: locator.storageDev,
        storageIno: locator.storageIno,
        deletedFrom: null
      });
    }
    storage.writeSidecar(fileById.get(fileId), target.targetPath);
    attachLinks(item, fileId, mapping.staleIds);
    return { fileId, sha256: actualSha, target, method, adjustments: mappingAdjustments };
  }

  function processOrphan(item, journal) {
    const target = targetFromJournal(item, journal);
    const located = locateSourceOrTarget(item, target);
    const sourceHash = sha256File(located.path);
    const sourceStat = fs.statSync(located.path);
    const provenanceKey = crypto.createHash('sha256').update(item.sourceKey).digest('hex').slice(0, 8);
    const provenancePath = path.join(
      path.dirname(target.targetPath),
      `.ablage-waise-${sourceHash.slice(0, 16)}-${provenanceKey}.json`
    );
    const duplicate = existingCentralByHash(sourceHash, sourceStat.size);

    /*
     * Eine Waise bleibt als Herkunftsbefund erhalten, braucht aber keine zweite
     * 143-MB-Kopie, wenn exakt dieselben Bytes bereits als aktives, indiziertes
     * Dokument vorliegen. Der kleine, prüfbare Verweis wird VOR dem Entfernen
     * der redundanten Quelle geschrieben. Er enthält Zielpfad, Datei-ID,
     * Größe und Vollhash; Finder-/Integritätsabgleich validieren alle Felder.
     */
    if (duplicate && path.resolve(duplicate.filePath) !== path.resolve(located.path)) {
      const provenance = {
        format: 'Betreuungsbüro-Waise/1',
        originalPath: item.detail.originalRelativePath,
        sourceRoot: item.detail.sourceRoot,
        storedPath: duplicate.row.storage_relpath,
        canonicalFileId: duplicate.row.id,
        deduplicated: true,
        size: sourceStat.size,
        sha256: sourceHash,
        migratedAt: now().toISOString()
      };
      writeOrReuseOrphanProvenance(provenancePath, provenance);
      removeVerifiedDuplicate(located.path, duplicate.filePath, sourceHash);
      return {
        fileId: '',
        sha256: sourceHash,
        target: {
          storageRelpath: duplicate.row.storage_relpath,
          targetPath: duplicate.filePath,
          name: duplicate.row.name
        },
        method: 'waise-pruefsummenverweis-ohne-zweitkopie',
        provenancePath: path.relative(storage.root(), provenancePath).split(path.sep).join('/')
      };
    }

    let method = 'bereits-am-ziel';
    if (!located.alreadyMoved || path.resolve(located.path) !== path.resolve(target.targetPath)) {
      method = moveVerified(located.path, target.targetPath, '').method;
    }
    const hash = sha256File(target.targetPath);
    const stat = fs.statSync(target.targetPath);
    const provenance = {
      format: 'Betreuungsbüro-Waise/1',
      originalPath: item.detail.originalRelativePath,
      sourceRoot: item.detail.sourceRoot,
      storedPath: target.storageRelpath,
      deduplicated: false,
      size: stat.size,
      sha256: hash,
      migratedAt: now().toISOString()
    };
    writeOrReuseOrphanProvenance(provenancePath, provenance);
    return { fileId: '', sha256: hash, target, method };
  }

  function writeReport(runId, dryRun, status, entries, summary, reportDir) {
    let directory = reportDir ? path.resolve(reportDir) : '';
    if (!directory && !dryRun) {
      directory = joinRoot(storage.root(), 'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Umstellungsberichte');
    }
    if (!directory) return '';
    fs.mkdirSync(directory, { recursive: true });
    const base = `Umstellung-${now().toISOString().replace(/[:.]/g, '-')}-${runId.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`;
    const jsonPath = path.join(directory, base + '.json');
    const textPath = path.join(directory, base + '.txt');
    atomicJson(jsonPath, {
      format: 'Betreuungsbüro-Umstellungsbericht/1',
      runId,
      dryRun,
      status,
      createdAt: now().toISOString(),
      summary,
      entries
    });
    const lines = [
      'UMSTELLUNGSBERICHT DOKUMENTENSPEICHER',
      `Lauf: ${runId}`,
      `Modus: ${dryRun ? 'Nur prüfen (Dry-run)' : 'Umhängen'}`,
      `Status: ${status}`,
      `Zusammenfassung: ${JSON.stringify(summary)}`,
      ''
    ];
    for (const entry of entries) {
      lines.push(`[${entry.status}] ${entry.kind} ${entry.sourceKey}`);
      lines.push(`  Quelle: ${entry.sourcePath || '(keine)'}`);
      lines.push(`  Ziel:   ${entry.targetPath || '(keines)'}`);
      if (entry.fileId) lines.push(`  Datei:  ${entry.fileId}`);
      if (entry.method) lines.push(`  Weg:    ${entry.method}`);
      for (const adjustment of entry.adjustments || []) {
        lines.push(`  Anpassung (${adjustment.code || 'allgemein'}): ${adjustment.text || String(adjustment)}`);
      }
      if (entry.error) lines.push(`  FEHLER: ${entry.error}`);
      lines.push('');
    }
    fs.writeFileSync(textPath, lines.join('\n') + '\n', { flag: 'wx' });
    return jsonPath;
  }

  function run(runOptions) {
    const ro = runOptions || {};
    const dryRun = ro.dryRun !== false;
    const runId = String(ro.runId || crypto.randomUUID());
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(runId)) {
      throw new Error('runId darf nur Buchstaben, Ziffern, „_“ und „-“ enthalten (maximal 80 Zeichen).');
    }
    const maxItems = ro.maxItems == null ? Infinity : Math.max(0, Number(ro.maxItems) || 0);
    const signal = ro.signal || null;
    runInsert.run(runId, dryRun ? 1 : 0);
    const inventory = discover();
    const reportEntries = [];
    let processed = 0;
    let planned = 0;
    let skipped = 0;
    let errors = 0;
    let interrupted = false;

    for (const item of inventory) {
      const stableKey = dryRun ? `dry:${runId}:${item.sourceKey}` : item.sourceKey;
      const previous = itemGet.get(stableKey);
      if (!dryRun && previous && previous.status === 'done') {
        skipped++;
        reportEntries.push({
          sourceKey: item.sourceKey,
          kind: item.kind,
          sourcePath: item.sourcePath,
          targetPath: previous.target_path,
          fileId: previous.file_id,
          status: 'bereits-erledigt',
          adjustments: jsonParse(previous.adjustments_json, [])
        });
        continue;
      }
      if ((signal && signal.aborted) || processed >= maxItems) {
        interrupted = true;
        break;
      }
      const fileId = previous && previous.file_id
        ? previous.file_id
        : (item.fileId || (item.kind === 'module' ? crypto.randomUUID() : ''));
      itemPending.run({
        sourceKey: stableKey,
        runId,
        kind: item.kind,
        sourcePath: item.sourcePath || '',
        targetPath: item.storageRelpath || '',
        fileId,
        sha256: item.expectedSha || '',
        adjustmentsJson: JSON.stringify(item.adjustments || [])
      });
      const journal = itemGet.get(stableKey);
      const entry = {
        sourceKey: item.sourceKey,
        kind: item.kind,
        sourcePath: item.sourcePath || '',
        targetPath: journal.target_path,
        fileId: journal.file_id,
        status: dryRun ? 'geplant' : 'pending',
        adjustments: item.adjustments || []
      };
      if (dryRun) {
        itemDone.run('planned', fileId, item.expectedSha || '', item.storageRelpath || '', JSON.stringify(item.adjustments || []), stableKey);
        planned++;
        processed++;
        reportEntries.push(entry);
        continue;
      }
      try {
        let result;
        if (item.kind === 'document') result = processDocument(item, journal);
        else if (item.kind === 'module') result = processModule(item, journal);
        else result = processOrphan(item, journal);
        const allAdjustments = (item.adjustments || [])
          .concat(result.adjustments || [])
          .concat({
          code: 'verschoben',
          text: `„${item.sourcePath}“ wurde nach „${result.target.storageRelpath}“ umgehängt (${result.method}).`
        });
        itemDone.run(
          'done',
          result.fileId,
          result.sha256,
          result.target.storageRelpath,
          JSON.stringify(allAdjustments),
          stableKey
        );
        entry.status = 'erledigt';
        entry.targetPath = result.target.storageRelpath;
        entry.fileId = result.fileId;
        entry.method = result.method;
        entry.adjustments = allAdjustments;
      } catch (error) {
        errors++;
        entry.status = 'fehler';
        entry.error = error && error.message ? error.message : String(error);
        itemError.run(entry.error, stableKey);
        if (ro.failFast) {
          reportEntries.push(entry);
          processed++;
          interrupted = true;
          break;
        }
      }
      processed++;
      reportEntries.push(entry);
    }

    const migratingFileIds = inventory
      .filter((item) => item.kind === 'document')
      .map((item) => String(item.fileId));
    const caseRows = db.prepare('SELECT id FROM cases ORDER BY id').all();
    let caseLayoutsPlanned = caseRows.length;
    let caseLayoutsEnsured = 0;
    if (!interrupted) {
      if (dryRun) {
        for (const caseRow of caseRows) {
          reportEntries.push({
            sourceKey: `case-layout:${caseRow.id}`,
            kind: 'case-layout',
            sourcePath: `cases/${caseRow.id}`,
            targetPath: 'Fallakten bzw. Fallakten-Archiv mit Registern 00–12',
            fileId: '',
            status: 'geplant',
            adjustments: []
          });
        }
      } else if (!errors) {
        for (const caseRow of caseRows) {
          try {
            const info = storage.ensureCaseLayout(String(caseRow.id), null);
            caseLayoutsEnsured++;
            reportEntries.push({
              sourceKey: `case-layout:${caseRow.id}`,
              kind: 'case-layout',
              sourcePath: `cases/${caseRow.id}`,
              targetPath: info.storageRelpath,
              fileId: '',
              status: 'erledigt',
              adjustments: info.adjustments || []
            });
          } catch (error) {
            errors++;
            reportEntries.push({
              sourceKey: `case-layout:${caseRow.id}`,
              kind: 'case-layout',
              sourcePath: `cases/${caseRow.id}`,
              targetPath: '',
              fileId: '',
              status: 'fehler',
              adjustments: [],
              error: error && error.message ? error.message : String(error)
            });
          }
        }
      }
    }
    let folderPlan = [];
    let foldersRetired = 0;
    let foldersPlanned = 0;
    if (!interrupted) {
      folderPlan = folderRetirementPlan(dryRun ? migratingFileIds : []);
      foldersPlanned = folderPlan.length;
      if (dryRun) {
        reportEntries.push(...folderReportEntries(folderPlan, 'geplant'));
      } else if (!errors && folderPlan.length) {
        const stagedEntries = folderReportEntries(folderPlan, 'vorab-gesichert');
        try {
          /*
           * Erst der gültige JSON+TXT-Bericht, dann eine einzige SQLite-
           * Transaktion. Ein Abbruch davor verändert nichts; ein Abbruch danach
           * lässt jede entfernte Zeile im Bericht rekonstruierbar.
           */
          writeReport(runId, false, 'folder-retirement-staged',
            reportEntries.concat(stagedEntries), {
              discovered: inventory.length,
              processed,
              errors,
              foldersPlanned
            }, ro.reportDir);
          const deleteFolder = db.prepare('DELETE FROM doc_folders WHERE id=?');
          db.transaction(() => {
            for (const item of folderPlan) deleteFolder.run(String(item.row.id));
          })();
          foldersRetired = folderPlan.length;
          reportEntries.push(...folderReportEntries(folderPlan, 'erledigt'));
        } catch (error) {
          errors++;
          const message = error && error.message ? error.message : String(error);
          reportEntries.push(...folderReportEntries(folderPlan, 'fehler').map((entry) => ({
            ...entry,
            error: message
          })));
        }
      }
    }

    const status = interrupted ? 'interrupted' : (errors ? 'completed_with_errors' : 'completed');
    const summary = {
      discovered: inventory.length,
      processed,
      planned,
      skipped,
      errors,
      interrupted,
      documents: inventory.filter((item) => item.kind === 'document').length,
      modules: inventory.filter((item) => item.kind === 'module').length,
      orphans: inventory.filter((item) => item.kind === 'orphan').length,
      caseLayoutsPlanned,
      caseLayoutsEnsured,
      foldersPlanned,
      foldersRetired
    };
    const reportPath = writeReport(runId, dryRun, status, reportEntries, summary, ro.reportDir);
    runFinish.run(status, JSON.stringify(summary), reportPath, runId);
    return { runId, dryRun, status, summary, reportPath, entries: reportEntries };
  }

  return {
    discover,
    run,
    storage,
    _test: {
      mappedDocumentSegments,
      collisionSuffixRemoved,
      caseAssignment,
      caseAssignmentAdjustments,
      caseIdFor,
      ensureFolder,
      moveVerified,
      removeVerifiedDuplicate,
      writeOrReuseOrphanProvenance,
      walkRegular
    }
  };
}

module.exports = {
  MODULE_ROOTS,
  createDocumentMigration,
  datedName,
  moveVerified,
  removeVerifiedDuplicate,
  walkRegular
};
