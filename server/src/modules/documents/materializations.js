'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const backupData = require('../backup/portable-data');
const cryptoHelper = require('../../security/crypto');
const simpleXlsx = require('../../shared/simple-xlsx');
const secureJson = require('../../security/secure-json');
const recoveryKeyStore = require('../recovery/key-store');
const operationCoordinator = require('./operation-coordinator');
const applicationWriteBarrier = require('../../middleware/application-write-barrier');
const { createIntakeOcrStore } = require('../cases/intake-ocr');

const JSON_MIME = 'application/json';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let singleton = null;
let timer = null;
let officeTimer = null;
let nightlyTimer = null;

const CASE_DELAY_MS = 10000;
const OFFICE_DELAY_MS = 30000;
// s2 kennzeichnet die inhaltsstarke Revision. Alte q1-Abbilder verwendeten nur
// COUNT/MAX(timestamp)/SUM(length) und konnten daher eine gleich lange Änderung
// innerhalb derselben SQLite-Sekunde fälschlich als unverändert ansehen.
const STRONG_REVISION_PREFIX = 's2:';
const CASE_BASE_ARTIFACTS = Object.freeze([
  'case-master-xlsx', 'case-addresses-xlsx', 'case-backup-json'
]);
const OFFICE_BASE_ARTIFACTS = Object.freeze([
  'office-workbook', 'office-backup-json', 'calendar-todos-json'
]);
const OFFICE_SECURITY_ARTIFACTS = Object.freeze([
  'security-encrypted', 'credentials-encrypted'
]);

function stamp(date) {
  const d = date || new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getFullYear() % 100)}${z(d.getMonth() + 1)}${z(d.getDate())} ${z(d.getHours())}${z(d.getMinutes())}`;
}

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch (_error) { return fallback; }
}

function tableSheet(name, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const columns = [...new Set(list.flatMap((row) => Object.keys(row || {})))].sort();
  return {
    name,
    rows: [
      columns,
      ...list.map((row) => columns.map((column) => {
        const value = row && row[column];
        return value && typeof value === 'object' ? JSON.stringify(value) : value;
      }))
    ]
  };
}

function createDocumentMaterializations(options) {
  const opt = options || {};
  const db = opt.db;
  const documents = opt.documents;
  if (!db || !documents) throw new Error('Materialisierungen benötigen Datenbank und Dokumentendienst.');
  const recoveryKeys = opt.recoveryKeyStore || recoveryKeyStore.shared();
  const intakeOcr = createIntakeOcrStore(db);
  const storage = documents.documentStorage;
  const caseQueue = new Map();
  let officeDueAt = 0;
  let lastTotalChanges = Number(db.prepare('SELECT total_changes() AS n').get().n) || 0;
  let knownCaseRevisions = new Map();
  let knownOfficeRevision = '';
  let knownRecoveryRevision = '';
  const getMaterial = db.prepare(`
    SELECT m.*, f.name, f.storage_relpath, f.mime_type, f.deleted_at
      FROM doc_materializations m
      LEFT JOIN doc_files f ON f.id=m.file_id
     WHERE m.scope_type=? AND m.scope_id=? AND m.artifact_kind=?
  `);
  const putMaterial = db.prepare(`
    INSERT INTO doc_materializations
      (scope_type,scope_id,artifact_kind,file_id,source_revision,sha256,status,last_error,generated_at)
    VALUES
      (@scopeType,@scopeId,@artifactKind,@fileId,@sourceRevision,@sha256,@status,@lastError,@generatedAt)
    ON CONFLICT(scope_type,scope_id,artifact_kind) DO UPDATE SET
      file_id=excluded.file_id,source_revision=excluded.source_revision,sha256=excluded.sha256,
      status=excluded.status,last_error=excluded.last_error,generated_at=excluded.generated_at
  `);
  const markError = db.prepare(`
    INSERT INTO doc_materializations
      (scope_type,scope_id,artifact_kind,status,last_error)
    VALUES (?,?,?,'error',?)
    ON CONFLICT(scope_type,scope_id,artifact_kind) DO UPDATE SET
      status='error',last_error=excluded.last_error
  `);
  const setFileMeta = db.prepare(`
    UPDATE doc_files SET visibility=?,artifact_kind=?,managed=1,ocr_status='none' WHERE id=?
  `);
  const updateFileBytes = db.prepare(`
    UPDATE doc_files SET size=?,sha256=?,mime_type=?,storage_dev=?,storage_ino=?,
      storage_status='ok',last_seen_at=datetime('now'),updated_at=datetime('now') WHERE id=?
  `);
  const restoreFileBytes = db.prepare(`
    UPDATE doc_files SET size=@size,sha256=@sha256,mime_type=@mimeType,
      storage_dev=@storageDev,storage_ino=@storageIno,storage_status=@storageStatus,
      last_seen_at=@lastSeenAt,updated_at=@updatedAt WHERE id=@id
  `);

  function quotedIdentifier(value) {
    const name = String(value || '');
    if (!/^[a-z][a-z0-9_]*$/i.test(name)) throw new Error('Ungültiger SQL-Bezeichner.');
    return `"${name}"`;
  }

  const tableColumns = new Map();
  function columnsOf(table) {
    const key = String(table || '');
    if (tableColumns.has(key)) return tableColumns.get(key);
    let columns = [];
    try {
      columns = db.prepare(`PRAGMA table_info(${quotedIdentifier(key)})`).all().map((row) => String(row.name));
    } catch (_error) {
      columns = [];
    }
    // Fehlende optionale Tabellen nicht negativ cachen: Ein laufendes Upgrade
    // kann sie später anlegen; der nächste starke Scan muss das erkennen.
    if (columns.length) tableColumns.set(key, columns);
    return columns;
  }

  function strongHash(value) {
    return secureJson.sha256(Buffer.from(secureJson.stableJson(value), 'utf8'));
  }

  /*
   * Ein Vollbackup muss beweisen können, dass jedes Fallabbild auf exakt dem
   * fachlichen SQLite-Inhalt beruht. Zeitstempel/Längen reichen dafür nicht:
   * SQLite-datetime hat Sekundenauflösung und zwei JSON-Werte können gleich lang
   * sein. Wir lesen daher jede registrierte fallbezogene Zeile genau einmal,
   * normalisieren/sortieren sie deterministisch und hashen ihren ganzen Inhalt.
   *
   * Das bleibt bei vielen Fällen günstig: pro registrierter Tabelle läuft eine
   * Sammelabfrage, nicht pro Fall und Tabelle eine Abfrage. Erst wenn der Hash
   * eines Falls vom publizierten s2-Präfix abweicht, ruft runCase() caseData()
   * und die XLSX-Generatoren auf.
   */
  function collectCaseStrongRevisions() {
    const specs = backupData.registryFor('case');
    const cases = db.prepare('SELECT * FROM cases ORDER BY id').all();
    const rowsByCase = new Map(cases.map((row) => [
      String(row.id),
      new Map(specs.map((spec) => [spec.table, []]))
    ]));
    const missing = new Set();

    function normalizedRow(row, spec) {
      const omitted = new Set(spec.caseOmitColumns || []);
      return Object.fromEntries(Object.entries(row).filter(([column]) =>
        !column.startsWith('__material_') && !omitted.has(column)
      ));
    }

    function add(caseId, spec, row) {
      const id = String(caseId || '');
      const target = rowsByCase.get(id);
      if (!target) return;
      target.get(spec.table).push(secureJson.stableJson(normalizedRow(row, spec)));
    }

    for (const spec of specs) {
      const table = spec.table;
      if (spec.casePrimary) {
        for (const row of cases) add(row.id, spec, row);
        continue;
      }
      if (!columnsOf(table).length) {
        missing.add(table);
        continue;
      }
      if (spec.generatedState) continue;
      let sql = '';
      if (spec.caseColumn) {
        const extraWhere = table === 'doc_files' ? ' AND COALESCE(child.managed,0)=0' : '';
        sql = `SELECT child.*,child.${quotedIdentifier(spec.caseColumn)} AS __material_case_id
                 FROM ${quotedIdentifier(table)} child
                WHERE child.${quotedIdentifier(spec.caseColumn)}<>''${extraWhere}`;
      } else if (spec.caseScope) {
        sql = `SELECT child.*,child.scope_id AS __material_case_id
                 FROM ${quotedIdentifier(table)} child
                WHERE child.scope_type='case' AND child.scope_id<>''`;
      } else if (spec.caseVia === 'bank_connections') {
        sql = `SELECT child.*,parent.case_id AS __material_case_id
                 FROM ${quotedIdentifier(table)} child
                 JOIN bank_connections parent ON parent.id=child.connection_id
                WHERE parent.case_id<>''`;
      } else if (spec.caseVia === 'bank_accounts') {
        sql = `SELECT child.*,parent.case_id AS __material_parent_case_id,
                       child.manual_case_id AS __material_manual_case_id
                 FROM ${quotedIdentifier(table)} child
                 JOIN bank_connections parent ON parent.id=child.connection_id
                WHERE parent.case_id<>'' OR child.manual_case_id<>''`;
      } else if (spec.caseVia === 'calendar_events') {
        sql = `SELECT child.*,parent.case_id AS __material_case_id
                 FROM ${quotedIdentifier(table)} child
                 JOIN calendar_events parent ON parent.id=child.event_id
                WHERE parent.case_id<>''`;
      } else if (spec.caseVia === 'todos') {
        sql = `SELECT child.*,parent.case_id AS __material_case_id
                 FROM ${quotedIdentifier(table)} child
                 JOIN todos parent ON parent.id=child.todo_id
                WHERE parent.case_id<>''`;
      } else if (spec.caseVia === 'doc_files') {
        sql = `SELECT child.*,parent.case_id AS __material_case_id
                 FROM ${quotedIdentifier(table)} child
                 JOIN doc_files parent ON parent.id=child.file_id
                WHERE parent.case_id<>''`;
      }
      if (!sql) throw new Error(`Für ${table} fehlt ein starker Fall-Revisionspfad.`);
      let rows;
      try {
        rows = db.prepare(sql).all();
      } catch (error) {
        if (/no such table/i.test(String(error && error.message || error))) {
          missing.add(table);
          continue;
        }
        const wrapped = new Error(`Fallrevision für ${table} konnte nicht gelesen werden.`);
        wrapped.code = 'MATERIALIZATION_REVISION_READ_FAILED';
        wrapped.table = table;
        wrapped.cause = error;
        throw wrapped;
      }
      for (const row of rows) {
        if (spec.caseVia === 'bank_accounts') {
          const ids = new Set([
            String(row.__material_parent_case_id || ''),
            String(row.__material_manual_case_id || '')
          ]);
          for (const id of ids) if (id) add(id, spec, row);
        } else {
          add(row.__material_case_id, spec, row);
        }
      }
    }

    const revisions = new Map();
    for (const [caseId, byTable] of rowsByCase) {
      const content = specs.map((spec) => ({
        table: spec.table,
        omitted: missing.has(spec.table),
        rows: byTable.get(spec.table).sort()
      }));
      revisions.set(caseId, strongHash(content));
    }
    return revisions;
  }

  function collectOfficeStrongSource() {
    const office = backupData.officeData(db, { intakeOcr });
    const calendar = backupData.calendarTodoData(db);
    return {
      office,
      calendar,
      revision: strongHash({
        office: revision(office),
        calendar: revision(calendar)
      })
    };
  }

  function revisionPrefix(value) {
    return `${STRONG_REVISION_PREFIX}${value}:`;
  }

  function materializationBytesCurrent(row, file) {
    if (!row || !file || !row.sha256 || !file.sha256) return false;
    const expected = String(row.sha256).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)
        || String(file.sha256).toLowerCase() !== expected) return false;
    const blob = storage.findBlobPath(file);
    if (!blob) return false;
    let fd;
    try {
      fd = fs.openSync(blob, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const before = fs.fstatSync(fd);
      const named = fs.lstatSync(blob);
      if (!before.isFile() || !named.isFile() || named.isSymbolicLink()
          || before.dev !== named.dev || before.ino !== named.ino
          || (Number.isFinite(Number(file.size)) && before.size !== Number(file.size))) {
        return false;
      }
      const hash = crypto.createHash('sha256');
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let position = 0;
      for (;;) {
        const read = fs.readSync(fd, buffer, 0, buffer.length, position);
        if (!read) break;
        hash.update(buffer.subarray(0, read));
        position += read;
      }
      const after = fs.fstatSync(fd);
      if (before.dev !== after.dev || before.ino !== after.ino
          || before.size !== after.size || before.mtimeMs !== after.mtimeMs
          || before.ctimeMs !== after.ctimeMs) return false;
      return hash.digest('hex') === expected;
    } catch (_error) {
      return false;
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (_error) { /* eigener Lesedeskriptor */ }
      }
    }
  }

  function materializationCurrent(scopeType, scopeId, artifactKinds, sourceRevision, deep) {
    const prefix = revisionPrefix(sourceRevision);
    for (const kind of artifactKinds) {
      const row = getMaterial.get(scopeType, scopeId, kind);
      if (!row || row.status !== 'ok' || !String(row.source_revision || '').startsWith(prefix)) return false;
      if (!row.file_id) return false;
      const file = documents.dateiZeile(row.file_id);
      if (!file || (deep
        ? !materializationBytesCurrent(row, file)
        : !storage.findBlobPath(file))) return false;
    }
    return true;
  }

  function recoveryMaterializationsCurrent(sourceRevision, deep) {
    if (!/^[0-9a-f]{64}$/i.test(String(sourceRevision || ''))) return false;
    for (const kind of OFFICE_SECURITY_ARTIFACTS) {
      const row = getMaterial.get('office', '', kind);
      if (!row || row.status !== 'ok' || row.source_revision !== sourceRevision || !row.file_id) {
        return false;
      }
      const file = documents.dateiZeile(row.file_id);
      if (!file || (deep
        ? !materializationBytesCurrent(row, file)
        : !storage.findBlobPath(file))) return false;
    }
    return true;
  }

  function markCaseDirty(caseId, delayMs) {
    const id = String(caseId || '');
    if (!id) return false;
    const due = Date.now() + Math.max(0, Number(delayMs === undefined ? CASE_DELAY_MS : delayMs) || 0);
    const previous = caseQueue.get(id);
    // Entprellen: jede neue Änderung verschiebt die Erzeugung nach hinten. Ein
    // bereits sofort fälliger expliziter Lauf darf hingegen nicht verzögert werden.
    caseQueue.set(id, previous && previous <= Date.now() ? previous : due);
    knownCaseRevisions.delete(id);
    return true;
  }

  function markOfficeDirty(delayMs) {
    const due = Date.now() + Math.max(0, Number(delayMs === undefined ? OFFICE_DELAY_MS : delayMs) || 0);
    officeDueAt = officeDueAt && officeDueAt <= Date.now() ? officeDueAt : due;
    knownOfficeRevision = '';
    knownRecoveryRevision = '';
    return true;
  }

  function revision(value) {
    const copy = JSON.parse(JSON.stringify(value));
    if (copy && typeof copy === 'object') copy.exportedAt = '';
    return secureJson.sha256(Buffer.from(secureJson.stableJson(copy), 'utf8'));
  }

  function removeOld(row) {
    if (!row || !row.file_id) return;
    const file = documents.dateiZeile(row.file_id);
    if (!file) return;
    storage.removeFileAndSidecar(file);
    db.transaction(() => {
      for (const table of ['doc_text', 'doc_annotations', 'doc_links', 'doc_versions']) {
        const column = table === 'doc_versions' || table === 'doc_annotations' || table === 'doc_text' ? 'file_id' : 'file_id';
        try { db.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(file.id); } catch (_error) { /* optionale Tabelle */ }
      }
      db.prepare('DELETE FROM doc_files WHERE id=?').run(file.id);
    })();
  }

  function replaceSameFile(file, bytes, mime, sha) {
    const target = storage.findBlobPath(file);
    if (!target) throw new Error('Das bisherige Sicherungsabbild fehlt auf der Platte.');
    const temp = path.join(path.dirname(target), `.ablage-materialisierung-${crypto.randomUUID()}.part`);
    const previous = path.join(path.dirname(target), `.ablage-materialisierung-${crypto.randomUUID()}.previous`);
    let published = false;
    fs.writeFileSync(temp, bytes, { flag: 'wx' });
    try {
      if (storage.sha256File(temp) !== sha) throw new Error('Prüfsumme der temporären Sicherungsdatei stimmt nicht.');
      try {
        fs.linkSync(target, previous);
      } catch (_linkError) {
        fs.copyFileSync(target, previous, fs.constants.COPYFILE_EXCL);
      }
      fs.renameSync(temp, target);
      published = true;
      const stat = fs.statSync(target);
      updateFileBytes.run(bytes.length, sha, mime, String(stat.dev), String(stat.ino), file.id);
      storage.writeSidecar(documents.dateiZeile(file.id), target);
      fs.unlinkSync(previous);
      return file.id;
    } catch (error) {
      try { fs.unlinkSync(temp); } catch (_ignore) { /* bereits umbenannt oder nicht vorhanden */ }
      let rollbackError = null;
      if (published && fs.existsSync(previous)) {
        try {
          fs.renameSync(previous, target);
          const restoredStat = fs.statSync(target);
          restoreFileBytes.run({
            id: file.id,
            size: Number(file.size) || restoredStat.size,
            sha256: String(file.sha256 || ''),
            mimeType: String(file.mime_type || 'application/octet-stream'),
            storageDev: String(restoredStat.dev),
            storageIno: String(restoredStat.ino),
            storageStatus: String(file.storage_status || 'ok'),
            lastSeenAt: String(file.last_seen_at || ''),
            updatedAt: String(file.updated_at || '')
          });
          storage.writeSidecar(documents.dateiZeile(file.id), target);
        } catch (rollback) {
          rollbackError = rollback;
        }
      } else {
        try { fs.unlinkSync(previous); } catch (_ignore) { /* noch nicht angelegt */ }
      }
      if (rollbackError) {
        throw new Error(
          `${error.message || error}; auch die Rückkehr zur letzten gültigen Fassung schlug fehl: `
          + (rollbackError.message || rollbackError)
        );
      }
      throw error;
    }
  }

  function publish(spec) {
    const old = getMaterial.get(spec.scopeType, spec.scopeId, spec.artifactKind);
    if (!spec.force && old && old.source_revision === spec.sourceRevision && old.status === 'ok') {
      const file = old.file_id && documents.dateiZeile(old.file_id);
      if (file && storage.findBlobPath(file)) return { changed: false, fileId: file.id };
    }
    const sha = secureJson.sha256(spec.bytes);
    let fileId = '';
    const oldFile = old && old.file_id ? documents.dateiZeile(old.file_id) : null;
    if (oldFile && oldFile.name === spec.name && storage.findBlobPath(oldFile)) {
      fileId = replaceSameFile(oldFile, spec.bytes, spec.mime, sha);
    } else {
      const folderId = spec.area === 'case'
        ? documents.ordnerSicherstellen('case', spec.scopeId, ['01 - Stammdaten'])
        : '';
      const placed = documents.dateiAblegen(
        spec.area,
        spec.area === 'case' ? spec.scopeId : '',
        folderId,
        spec.name,
        spec.mime,
        spec.bytes,
        null
      );
      fileId = placed.id;
      setFileMeta.run(spec.visibility, spec.artifactKind, fileId);
    }
    const now = new Date().toISOString();
    putMaterial.run({
      scopeType: spec.scopeType,
      scopeId: spec.scopeId,
      artifactKind: spec.artifactKind,
      fileId,
      sourceRevision: spec.sourceRevision,
      sha256: sha,
      status: 'ok',
      lastError: '',
      generatedAt: now
    });
    if (oldFile && oldFile.id !== fileId) {
      try { removeOld({ file_id: oldFile.id }); }
      catch (error) {
        // Das aktuelle Abbild ist bereits sicher publiziert. Der nicht entfernte
        // Vorgänger bleibt physisch als Integritätsbefund, verschwindet aber aus der
        // normalen Ansicht, damit nie zwei vermeintlich aktuelle Abbilder angeboten werden.
        db.prepare("UPDATE doc_files SET deleted_at=datetime('now'),storage_status='stale-managed' WHERE id=?").run(oldFile.id);
      }
    }
    return { changed: true, fileId };
  }

  function fail(scopeType, scopeId, artifactKind, error) {
    markError.run(scopeType, scopeId, artifactKind, String(error && error.message || error).slice(0, 1000));
  }

  function caseArtifacts(row) {
    const full = backupData.caseData(db, row.id);
    const data = parseJson(row.stammdaten_json, {});
    /* Audit 30.08.2026: rechtlicherBetreuer/vertretung tragen Personen-IDs - im
       menschenlesbaren Notfall-Abbild stuende sonst eine rohe UUID. Der Name kommt als
       Begleitfeld dazu (die ID bleibt, sie ist der Datenwert). */
    try {
      const personen = require('../office/persons-routes');
      for (const feld of ['rechtlicherBetreuer', 'vertretung']) {
        if (!data[feld]) continue;
        const name = personen.personAnzeigeName(data[feld]);
        if (name && name !== data[feld]) data[`${feld}Name`] = name;
      }
    } catch (_e) { /* Abbild bleibt roh, wenn die Aufloesung scheitert */ }
    const label = String(row.label || `Fall ${String(row.id).slice(0, 8)}`).trim();
    const prefix = `${stamp()} ${label}`;
    const contacts = full.contacts.map((entry) => ({
      id: entry.id,
      ...parseJson(entry.data_json, {})
    }));
    const definitions = [
      {
        artifactKind: 'case-master-xlsx',
        name: `${prefix} Stammdaten.xlsx`,
        mime: XLSX_MIME,
        source: data,
        bytes: simpleXlsx.workbook([{ name: 'Stammdaten', rows: [['Feld', 'Wert'], ...simpleXlsx.flatten(data)] }])
      },
      {
        artifactKind: 'case-addresses-xlsx',
        name: `${prefix} Adressverzeichnis.xlsx`,
        mime: XLSX_MIME,
        source: contacts,
        bytes: simpleXlsx.workbook([tableSheet('Adressverzeichnis', contacts)])
      },
      {
        artifactKind: 'case-backup-json',
        name: `${prefix} Sicherung.json`,
        mime: JSON_MIME,
        source: full,
        bytes: jsonBytes(full)
      }
    ];
    const photo = data && data.person && data.person.photo;
    const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(String(photo || ''));
    if (match) {
      const extension = /png/i.test(match[1]) ? 'png' : (/webp/i.test(match[1]) ? 'webp' : 'jpg');
      const bytes = Buffer.from(match[2], 'base64');
      definitions.push({
        artifactKind: 'case-passphoto',
        name: `${prefix} Passfoto.${extension}`,
        mime: match[1],
        source: { sha256: secureJson.sha256(bytes), mime: match[1] },
        bytes
      });
    }
    return definitions;
  }

  function runCase(caseId, options) {
    const runOptions = options || {};
    const row = db.prepare('SELECT id,label,stammdaten_json FROM cases WHERE id=?').get(String(caseId || ''));
    if (!row) throw new Error('Fall nicht gefunden.');
    const revisionBefore = runOptions.sourceRevision
      || runOptions.quickRevision // Übergang für interne Aufrufer älterer Builds
      || collectCaseStrongRevisions().get(String(row.id))
      || strongHash({ id: row.id });
    const hasPhoto = !!(/^data:([^;,]+);base64,([\s\S]+)$/.exec(
      String((parseJson(row.stammdaten_json, {}).person || {}).photo || '')
    ));
    const expectedKinds = hasPhoto ? [...CASE_BASE_ARTIFACTS, 'case-passphoto'] : CASE_BASE_ARTIFACTS;
    const currentBytes = materializationCurrent(
      'case',
      row.id,
      expectedKinds,
      revisionBefore,
      !!runOptions.deepIntegrity
    );
    if (!runOptions.force && currentBytes) {
      const obsoletePhoto = !hasPhoto && getMaterial.get('case', row.id, 'case-passphoto');
      if (!obsoletePhoto) {
        caseQueue.delete(String(row.id));
        return expectedKinds.map((artifactKind) => ({
          changed: false, skipped: true, artifactKind
        }));
      }
    }
    const results = [];
    const definitions = caseArtifacts(row);
    for (const item of definitions) {
      try {
        results.push({ ...publish({
          scopeType: 'case',
          scopeId: row.id,
          area: 'case',
          visibility: 'standard',
          ...item,
          sourceRevision: `${revisionPrefix(revisionBefore)}${revision(item.source)}`,
          force: !!runOptions.force || (!!runOptions.deepIntegrity && !currentBytes)
        }), artifactKind: item.artifactKind });
      } catch (error) {
        fail('case', row.id, item.artifactKind, error);
        results.push({ changed: false, error: error.message || String(error), artifactKind: item.artifactKind });
      }
    }
    if (!definitions.some((item) => item.artifactKind === 'case-passphoto')) {
      const obsolete = getMaterial.get('case', row.id, 'case-passphoto');
      if (obsolete) {
        try {
          db.prepare("DELETE FROM doc_materializations WHERE scope_type='case' AND scope_id=? AND artifact_kind='case-passphoto'").run(row.id);
          removeOld(obsolete);
          results.push({ changed: true, removed: true, artifactKind: 'case-passphoto' });
        } catch (error) {
          if (obsolete.file_id) {
            try {
              db.prepare("UPDATE doc_files SET deleted_at=datetime('now'),storage_status='stale-managed' WHERE id=?")
                .run(obsolete.file_id);
            } catch (_ignore) { /* Integritätslauf meldet einen Rest */ }
          }
          fail('case', row.id, 'case-passphoto', error);
          results.push({ changed: false, error: error.message || String(error), artifactKind: 'case-passphoto' });
        }
      }
    }
    caseQueue.delete(String(row.id));
    knownCaseRevisions.set(String(row.id), revisionBefore);
    return results;
  }

  function officeWorkbook(data) {
    const preferred = [
      'office_profile', 'office_bank_accounts', 'persons', 'office_contacts',
      'finance_entries', 'outgoing_invoices', 'private_vehicles', 'mileage_trips',
      'betreuung_overview_entries'
    ];
    return simpleXlsx.workbook(preferred.map((table) => tableSheet(table, data.tables[table] || [])));
  }

  function runOffice(options) {
    const runOptions = options || {};
    const officeSource = collectOfficeStrongSource();
    const revisionBefore = officeSource.revision;
    const recoveryState = recoveryKeys.current();
    // Legacy-Schlüssel bleiben für vorhandene Umschläge lesbar, dürfen aber
    // keine neuen Sicherheitsabbilder mehr erzeugen. Neue Generationen
    // verlangen mindestens 32 Byte Entropie (vom Key-Store als strong geprüft).
    const recoveryKey = recoveryState.configured && recoveryState.strong
      ? recoveryState.key
      : '';
    let recoveryBundle = null;
    let recoveryBundleError = null;
    if (recoveryKey.length >= 16) {
      try {
        recoveryBundle = backupData.createPortableRecoveryBundle(db, cryptoHelper);
      } catch (error) {
        recoveryBundleError = error;
      }
    }
    const expectedKinds = recoveryKey.length >= 16
      ? [...OFFICE_BASE_ARTIFACTS, ...OFFICE_SECURITY_ARTIFACTS]
      : OFFICE_BASE_ARTIFACTS;
    const officeBaseCurrent = materializationCurrent(
      'office',
      '',
      OFFICE_BASE_ARTIFACTS,
      revisionBefore,
      !!runOptions.deepIntegrity
    );
    const recoveryCurrent = recoveryBundle
      ? recoveryMaterializationsCurrent(
        recoveryBundle.sourceRevision,
        !!runOptions.deepIntegrity
      )
      : false;
    if (recoveryKey.length >= 16 && !runOptions.force && !runOptions.forceSecurity
        && officeBaseCurrent
        && recoveryBundle
        && recoveryCurrent) {
      officeDueAt = 0;
      knownRecoveryRevision = recoveryBundle.sourceRevision;
      return expectedKinds.map((artifactKind) => ({
        changed: false, skipped: true, artifactKind
      }));
    }
    const office = officeSource.office;
    const calendar = officeSource.calendar;
    const definitions = [
      {
        artifactKind: 'office-workbook',
        name: `${stamp()} Betreuungsorganisation.xlsx`,
        mime: XLSX_MIME,
        source: office,
        bytes: officeWorkbook(office)
      },
      {
        artifactKind: 'office-backup-json',
        name: `${stamp()} Betreuungsorganisation.json`,
        mime: JSON_MIME,
        source: office,
        bytes: jsonBytes(office)
      },
      {
        artifactKind: 'calendar-todos-json',
        name: `${stamp()} Kalender Aufgaben.json`,
        mime: JSON_MIME,
        source: calendar,
        bytes: jsonBytes(calendar)
      }
    ];
    const results = [];
    if (recoveryKey.length >= 16) {
      // Schema 3 löst die intern mit ENCRYPTION_KEY geschützten Felder ausschließlich
      // im Arbeitsspeicher und legt sie innerhalb der äußeren Recovery-Key-Hülle ab.
      // Dadurch lassen sie sich nach einem vollständigen Serververlust mit einem
      // neuen ENCRYPTION_KEY wieder einlesen.
      try {
        // Beide Teilabbilder stammen zwingend aus derselben, disjunkten
        // Recovery-Generation. Damit kann kein zwischen den Generatoraufrufen
        // liegender Schreibvorgang zwei scheinbar zusammengehörige Stände erzeugen.
        if (recoveryBundleError) throw recoveryBundleError;
        const bundle = recoveryBundle;
        if (!bundle) throw new Error('Das portable Recovery-Paar konnte nicht erzeugt werden.');
        const envelope = {
          keyId: recoveryState.keyId,
          generationId: bundle.generationId,
          sourceRevision: bundle.sourceRevision
        };
        definitions.push({
          artifactKind: 'security-encrypted',
          name: `${stamp()} Sicherheit.json.enc`,
          mime: JSON_MIME,
          source: bundle.security,
          sourceRevision: bundle.sourceRevision,
          bytes: jsonBytes(secureJson.encryptJson(bundle.security, recoveryKey, 'security/3', envelope)),
          force: !!runOptions.forceSecurity
        });
        definitions.push({
          artifactKind: 'credentials-encrypted',
          name: `${stamp()} Zugangsdaten.json.enc`,
          mime: JSON_MIME,
          source: bundle.credentials,
          sourceRevision: bundle.sourceRevision,
          bytes: jsonBytes(secureJson.encryptJson(bundle.credentials, recoveryKey, 'credentials/3', envelope)),
          force: !!runOptions.forceSecurity
        });
      } catch (error) {
        fail('office', '', 'security-encrypted', error);
        fail('office', '', 'credentials-encrypted', error);
        results.push(
          {
            changed: false,
            error: error.message || String(error),
            artifactKind: 'security-encrypted'
          },
          {
            changed: false,
            error: error.message || String(error),
            artifactKind: 'credentials-encrypted'
          }
        );
      }
    } else {
      const message = recoveryState.error
        ? `Wiederherstellungsschlüssel nicht lesbar: ${recoveryState.error}`
        : (recoveryState.configured && recoveryState.requiresRotation
          ? 'Der vorhandene Wiederherstellungsschlüssel ist ein Legacy-Schlüssel und muss vor neuen Sicherheitsabbildern im Admin-Panel rotiert werden.'
          : 'Es ist noch kein Wiederherstellungsschlüssel eingerichtet.');
      fail('office', '', 'security-encrypted', new Error(message));
      fail('office', '', 'credentials-encrypted', new Error(message));
      results.push(
        { changed: false, error: message, artifactKind: 'security-encrypted' },
        { changed: false, error: message, artifactKind: 'credentials-encrypted' }
      );
    }
    for (const item of definitions) {
      try {
        results.push({ ...publish({
          scopeType: 'office',
          scopeId: '',
          area: 'management',
          visibility: 'admin',
          ...item,
          sourceRevision: item.sourceRevision || `${revisionPrefix(revisionBefore)}${revision(item.source)}`,
          force: !!item.force
            || !!runOptions.force
            || (!!runOptions.deepIntegrity && (
              OFFICE_SECURITY_ARTIFACTS.includes(item.artifactKind)
                ? !recoveryCurrent
                : !officeBaseCurrent
            ))
        }), artifactKind: item.artifactKind });
      } catch (error) {
        fail('office', '', item.artifactKind, error);
        results.push({ changed: false, error: error.message || String(error), artifactKind: item.artifactKind });
      }
    }
    officeDueAt = 0;
    knownOfficeRevision = revisionBefore;
    knownRecoveryRevision = recoveryBundle && !recoveryBundleError
      ? recoveryBundle.sourceRevision
      : '';
    return results;
  }

  function runAll(options) {
    const runOptions = options || {};
    const result = { cases: {}, office: [] };
    const revisions = collectCaseStrongRevisions();
    for (const row of db.prepare('SELECT id FROM cases ORDER BY id').all()) {
      result.cases[row.id] = runCase(row.id, {
        ...runOptions,
        sourceRevision: revisions.get(String(row.id))
      });
    }
    result.office = runOffice(runOptions);
    return result;
  }

  // Expliziter Vertrag für die Gesamtsicherung: alle Fallrevisionen werden stark
  // geprüft, unveränderte Generatoren übersprungen und das portable
  // Security/Credentials-Paar wird in derselben Schranke frisch veröffentlicht.
  function prepareTotalBackup(options) {
    return runAll({ ...(options || {}), forceSecurity: true, deepIntegrity: true });
  }

  function scan(options) {
    const scanOptions = options || {};
    const currentCases = collectCaseStrongRevisions();
    const currentOffice = collectOfficeStrongSource().revision;
    const recoveryState = recoveryKeys.current();
    let currentRecovery = '';
    let recoveryReadFailed = false;
    if (recoveryState.configured && recoveryState.strong) {
      try {
        currentRecovery = backupData.portableRecoverySourceRevision(db, cryptoHelper);
      } catch (_error) {
        recoveryReadFailed = true;
      }
    }
    for (const [caseId, sourceRevision] of currentCases) {
      const baseCurrent = materializationCurrent('case', caseId, CASE_BASE_ARTIFACTS, sourceRevision);
      if (!baseCurrent
          || (!scanOptions.startup && knownCaseRevisions.get(caseId) !== sourceRevision)) {
        markCaseDirty(caseId, scanOptions.startup ? 0 : CASE_DELAY_MS);
      }
    }
    for (const caseId of knownCaseRevisions.keys()) {
      if (!currentCases.has(caseId)) caseQueue.delete(caseId);
    }
    const officeCurrent = materializationCurrent('office', '', OFFICE_BASE_ARTIFACTS, currentOffice);
    const recoveryCurrent = !(recoveryState.configured && recoveryState.strong)
      || (!recoveryReadFailed && recoveryMaterializationsCurrent(currentRecovery));
    if (!officeCurrent || !recoveryCurrent
        || (!scanOptions.startup && (
          knownOfficeRevision !== currentOffice
          || (currentRecovery && knownRecoveryRevision !== currentRecovery)
        ))) {
      markOfficeDirty(scanOptions.startup ? 0 : OFFICE_DELAY_MS);
    }
    knownCaseRevisions = currentCases;
    knownOfficeRevision = currentOffice;
    knownRecoveryRevision = currentRecovery;
    lastTotalChanges = Number(db.prepare('SELECT total_changes() AS n').get().n) || 0;
    return { cases: currentCases.size, pendingCases: caseQueue.size, officePending: !!officeDueAt };
  }

  function scanIfChanged() {
    const total = Number(db.prepare('SELECT total_changes() AS n').get().n) || 0;
    if (total === lastTotalChanges) return { changed: false };
    const result = scan();
    return { changed: true, ...result };
  }

  function drain(options) {
    const runOptions = options || {};
    const now = Number(runOptions.now) || Date.now();
    const limit = Math.max(1, Number(runOptions.limit) || 10);
    const result = { cases: {}, office: null };
    let count = 0;
    for (const [caseId, due] of [...caseQueue.entries()].sort((a, b) => a[1] - b[1])) {
      if (due > now || count >= limit) continue;
      try {
        result.cases[caseId] = runCase(caseId, {
          sourceRevision: knownCaseRevisions.get(String(caseId))
        });
      } catch (error) {
        caseQueue.delete(caseId);
        if (!/Fall nicht gefunden/i.test(String(error && error.message || error))) {
          markCaseDirty(caseId, CASE_DELAY_MS);
          result.cases[caseId] = [{ changed: false, error: error.message || String(error) }];
        }
      }
      count++;
    }
    if (officeDueAt && officeDueAt <= now) {
      try { result.office = runOffice(); }
      catch (error) {
        markOfficeDirty(OFFICE_DELAY_MS);
        result.office = [{ changed: false, error: error.message || String(error) }];
      }
    }
    return result;
  }

  function pending() {
    return {
      cases: [...caseQueue.entries()].map(([caseId, dueAt]) => ({ caseId, dueAt })),
      officeDueAt
    };
  }

  function status() {
    const keyStatus = recoveryKeys.publicStatus();
    return {
      recoveryKeyConfigured: keyStatus.configured,
      recoveryKeyStrong: !!keyStatus.strong,
      recoveryKeyRequiresRotation: !!keyStatus.requiresRotation,
      recoveryKeyId: keyStatus.keyId || '',
      recoveryKeyGeneration: Number(keyStatus.generation) || 0,
      recoveryKeySource: keyStatus.source,
      recoveryKeyError: keyStatus.error,
      items: db.prepare('SELECT * FROM doc_materializations ORDER BY scope_type,scope_id,artifact_kind').all()
    };
  }

  return {
    drain, markCaseDirty, markOfficeDirty, pending, prepareTotalBackup, runAll, runCase, runOffice,
    scan, scanIfChanged, status
  };
}

function start(options) {
  if (singleton) return singleton;
  singleton = createDocumentMaterializations(options);
  // Reihenfolge ist Teil des Konsistenzvertrags: Der Hintergrundschreiber
  // registriert sich zuerst an der anwendungsweiten Schreibschranke und wartet
  // erst danach auf den Operationskoordinator. Umgekehrt könnte er den
  // Koordinator halten, während eine Vollsicherung auf seinen Schreibzähler
  // wartet (zyklisches Warten).
  const automatic = (name, fn) => applicationWriteBarrier.withWrite(
    name,
    () => operationCoordinator.runExclusive(
      name,
      fn,
      { skipIfBusy: true, priority: -100 }
    )
  ).catch(() => null);
  setImmediate(() => {
    automatic('Automatische Sicherungsabbilder beim Serverstart', () => {
      singleton.scan({ startup: true });
      return singleton.drain();
    });
  });
  if (!(options && options.ohneTakt)) {
    timer = setInterval(() => {
      automatic('Automatische Sicherungsabbilder', () => singleton.drain());
    }, 1000);
    officeTimer = setInterval(() => {
      try { singleton.scanIfChanged(); } catch (_error) { /* nächster Lauf */ }
    }, 5000);
    const scheduleNightly = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(2, 30, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      nightlyTimer = setTimeout(() => {
        automatic(
          'Nächtliche Verwaltungs- und Sicherheitsabbilder',
          () => singleton.runOffice({ forceSecurity: true })
        );
        scheduleNightly();
      }, next.getTime() - now.getTime());
      if (nightlyTimer.unref) nightlyTimer.unref();
    };
    scheduleNightly();
    if (timer.unref) timer.unref();
    if (officeTimer.unref) officeTimer.unref();
  }
  return singleton;
}

function current() {
  return singleton;
}

module.exports = { createDocumentMaterializations, current, start, _test: { stamp, tableSheet } };
