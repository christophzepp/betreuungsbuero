'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createDocumentMaterializations } = require('../src/modules/documents/materializations');
const secureJson = require('../src/security/secure-json');
const backupData = require('../src/modules/backup/portable-data');

function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'document-materializations-'));
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`
    CREATE TABLE cases (
      id TEXT PRIMARY KEY,label TEXT,stammdaten_json TEXT,
      stammdaten_updated_at TEXT DEFAULT (datetime('now')),owner_user_id TEXT
    );
    CREATE TABLE case_reports (report_id TEXT,case_id TEXT);
    CREATE TABLE case_doku_entries (id TEXT,case_id TEXT,created_at TEXT);
    CREATE TABLE case_contacts (id TEXT,case_id TEXT,data_json TEXT,created_at TEXT);
    CREATE TABLE doc_files (
      id TEXT PRIMARY KEY,area TEXT,case_id TEXT,folder_id TEXT,name TEXT,mime_type TEXT,
      size INTEGER,sha256 TEXT,created_at TEXT DEFAULT '',updated_at TEXT DEFAULT '',
      storage_relpath TEXT,artifact_kind TEXT DEFAULT '',visibility TEXT DEFAULT 'standard',
      managed INTEGER DEFAULT 0,deleted_at TEXT DEFAULT '',storage_dev TEXT DEFAULT '',
      storage_ino TEXT DEFAULT '',storage_status TEXT DEFAULT '',last_seen_at TEXT DEFAULT '',
      ocr_status TEXT DEFAULT 'none'
    );
    CREATE TABLE doc_materializations (
      scope_type TEXT NOT NULL,scope_id TEXT NOT NULL DEFAULT '',artifact_kind TEXT NOT NULL,
      file_id TEXT DEFAULT NULL,source_revision TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT NOT NULL DEFAULT '',generated_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(scope_type,scope_id,artifact_kind),
      FOREIGN KEY(file_id) REFERENCES doc_files(id)
    );
    CREATE TABLE doc_text (file_id TEXT);
    CREATE TABLE doc_annotations (file_id TEXT);
    CREATE TABLE doc_links (file_id TEXT);
    CREATE TABLE doc_versions (file_id TEXT);
    CREATE TABLE doc_backup_scheduler_state (
      id INTEGER PRIMARY KEY,heartbeat_at TEXT DEFAULT '',last_tick_at TEXT DEFAULT ''
    );
    INSERT INTO doc_backup_scheduler_state(id,heartbeat_at,last_tick_at)
    VALUES (1,'2026-07-28T08:00:00.000Z','2026-07-28T08:00:00.000Z');
    CREATE TABLE doc_import_jobs (
      id TEXT PRIMARY KEY,label TEXT,mount_id TEXT,source_path TEXT,target_json TEXT,
      enabled INTEGER,last_run_at TEXT,last_result TEXT,created_at TEXT
    );
    INSERT INTO doc_import_jobs
      (id,label,mount_id,source_path,target_json,enabled,last_run_at,last_result,created_at)
    VALUES
      ('import-1','Import','mount-1','Eingang','{}',1,'2026-07-28T08:00:00.000Z','0 neu','2026-07-01');
    CREATE TABLE doc_import_state (
      job_id TEXT,pfad TEXT,merkmal TEXT,sha256 TEXT,file_id TEXT,imported_at TEXT
    );
    INSERT INTO doc_import_state
      (job_id,pfad,merkmal,sha256,file_id,imported_at)
    VALUES
      ('import-1','Scan.pdf','10|2026-07-28','abc','doc-1','2026-07-28T08:00:00.000Z');
    CREATE TABLE case_intake_ocr (
      draft_id TEXT PRIMARY KEY,payload_json TEXT DEFAULT '[]',text_length INTEGER DEFAULT 0,
      item_count INTEGER DEFAULT 0,sha256 TEXT DEFAULT '',updated_at TEXT DEFAULT ''
    );
  `);
  const recoveryContracts = [
    backupData.recoverySchemaContract('security'),
    backupData.recoverySchemaContract('credentials')
  ];
  for (const [table, columns] of Object.entries(
    Object.assign({}, ...recoveryContracts.map((entry) => entry.tables))
  )) {
    if (db.prepare(`PRAGMA table_info("${table}")`).all().length) continue;
    db.exec(`CREATE TABLE "${table}" (${columns.map((column) => `"${column}" TEXT`).join(',')})`);
  }
  const base = {
    person: { firstName: 'Ada', lastName: 'Müller', birthDate: '1980-01-02' },
    address: { street: 'Testweg 1' }
  };
  db.prepare('INSERT INTO cases(id,label,stammdaten_json) VALUES (?,?,?)')
    .run('case-1', 'Müller, Ada', JSON.stringify(base));
  db.prepare('INSERT INTO case_contacts VALUES (?,?,?,?)').run(
    'contact-1', 'case-1', JSON.stringify({ name: 'Amtsgericht Köln' }), '2026-07-28'
  );
  const files = new Map();
  let sidecarFailures = 0;
  const storage = {
    findBlobPath(row) {
      const file = files.get(String(row && row.id || ''));
      return file && fs.existsSync(file) ? file : null;
    },
    removeFileAndSidecar(row) {
      const file = files.get(String(row.id)); if (file) fs.unlinkSync(file); files.delete(String(row.id));
    },
    sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); },
    writeSidecar() {
      if (sidecarFailures > 0) {
        sidecarFailures--;
        throw new Error('simulierter Sidecar-Fehler');
      }
    }
  };
  let n = 0;
  const documents = {
    documentStorage: storage,
    ordnerSicherstellen(area, caseId, folders) { return `${area}:${caseId}:${folders.join('/')}`; },
    dateiAblegen(area, caseId, folderId, name, mime, bytes) {
      const id = `file-${++n}`;
      const file = path.join(temp, id);
      fs.writeFileSync(file, bytes);
      const stat = fs.statSync(file);
      const rel = area === 'management'
        ? `Büroorganisation/_Verwaltung & Sicherungen/${name}`
        : `Fallakten/M/Müller, Ada/01 - Stammdaten/${name}`;
      db.prepare(`INSERT INTO doc_files
        (id,area,case_id,folder_id,name,mime_type,size,sha256,storage_relpath,storage_dev,storage_ino,storage_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'ok')`).run(
        id, area, caseId, folderId, name, mime, bytes.length,
        crypto.createHash('sha256').update(bytes).digest('hex'), rel, String(stat.dev), String(stat.ino)
      );
      files.set(id, file);
      return { id, name, adjustments: [] };
    },
    dateiZeile(id) { return db.prepare('SELECT * FROM doc_files WHERE id=?').get(String(id)); }
  };
  const recoveryKeyStore = {
    current() {
      const key = String(process.env.DOCUMENT_RECOVERY_KEY || '');
      return {
        configured: key.length >= 16,
        key: key.length >= 16 ? key : '',
        strong: /^[0-9a-f]{64}$/i.test(key),
        requiresRotation: key.length >= 16 && !/^[0-9a-f]{64}$/i.test(key),
        keyId: key.length >= 16 ? 'test-key-id' : '',
        fingerprint: key.length >= 16 ? secureJson.fingerprint(key) : '',
        source: key.length >= 16 ? 'test-environment' : 'none'
      };
    },
    publicStatus() {
      const state = this.current();
      return {
        configured: state.configured,
        strong: state.strong,
        requiresRotation: state.requiresRotation,
        fingerprint: state.fingerprint,
        source: state.source,
        error: ''
      };
    }
  };
  const service = createDocumentMaterializations({ db, documents, recoveryKeyStore });
  return {
    base, db, documents, files, service, temp,
    failNextSidecar() { sidecarFailures++; },
    close() { db.close(); fs.rmSync(temp, { recursive: true, force: true }); }
  };
}

test('pflegt Fallabbilder und entfernt ein nicht mehr vorhandenes Passfoto', (t) => {
  const f = fixture(); t.after(f.close);
  let result = f.service.runCase('case-1');
  assert.equal(result.filter((x) => x.changed).length, 3);
  assert.equal(f.db.prepare("SELECT count(*) n FROM doc_files WHERE area='case'").get().n, 3);
  assert.deepEqual(
    f.db.prepare("SELECT artifact_kind FROM doc_materializations WHERE scope_type='case' ORDER BY artifact_kind").all().map((x) => x.artifact_kind),
    ['case-addresses-xlsx', 'case-backup-json', 'case-master-xlsx']
  );
  const firstCaseFiles = f.db.prepare("SELECT count(*) n FROM doc_files WHERE area='case'").get().n;
  result = f.service.runCase('case-1');
  assert.equal(result.filter((x) => x.changed).length, 0, 'eigene Abbilder dürfen keinen zweiten Schreiblauf auslösen');
  assert.equal(f.db.prepare("SELECT count(*) n FROM doc_files WHERE area='case'").get().n, firstCaseFiles);
  const caseBackup = f.db.prepare("SELECT * FROM doc_files WHERE artifact_kind='case-backup-json'").get();
  const casePayload = JSON.parse(fs.readFileSync(f.documents.documentStorage.findBlobPath(caseBackup), 'utf8'));
  assert.deepEqual(casePayload.tables.doc_materializations, []);
  assert.deepEqual(casePayload.tables.doc_files, []);

  const withPhoto = JSON.parse(JSON.stringify(f.base));
  withPhoto.person.photo = 'data:image/png;base64,' + Buffer.from('PNG').toString('base64');
  f.db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify(withPhoto), 'case-1');
  f.service.runCase('case-1');
  assert.equal(f.db.prepare("SELECT count(*) n FROM doc_files WHERE area='case'").get().n, 4);
  assert.ok(f.db.prepare("SELECT file_id FROM doc_materializations WHERE artifact_kind='case-passphoto'").get().file_id);

  f.db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify(f.base), 'case-1');
  result = f.service.runCase('case-1');
  assert.ok(result.some((x) => x.artifactKind === 'case-passphoto' && x.removed));
  assert.equal(f.db.prepare("SELECT count(*) n FROM doc_files WHERE area='case'").get().n, 3);
  assert.equal(f.db.prepare("SELECT count(*) n FROM doc_materializations WHERE artifact_kind='case-passphoto'").get().n, 0);
});

test('verwaltet Büroabbilder admin-only, verlangt den externen Schlüssel und erneuert sie nachts', (t) => {
  const f = fixture(); t.after(f.close);
  const previous = process.env.DOCUMENT_RECOVERY_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.DOCUMENT_RECOVERY_KEY;
    else process.env.DOCUMENT_RECOVERY_KEY = previous;
  });
  delete process.env.DOCUMENT_RECOVERY_KEY;
  let result = f.service.runOffice();
  assert.equal(result.filter((x) => x.error).length, 2);
  assert.equal(f.db.prepare("SELECT count(*) n FROM doc_files WHERE area='management'").get().n, 3);

  process.env.DOCUMENT_RECOVERY_KEY = '11'.repeat(32);
  result = f.service.runOffice();
  assert.equal(result.filter((x) => x.error).length, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM doc_files WHERE area='management'").get().n, 5);
  assert.equal(f.db.prepare("SELECT count(*) n FROM doc_files WHERE area='management' AND visibility='admin' AND managed=1").get().n, 5);
  result = f.service.runOffice();
  assert.equal(result.filter((x) => x.changed).length, 0, 'eigene Büroabbilder dürfen keinen zweiten Schreiblauf auslösen');
  f.db.prepare(`
    UPDATE doc_backup_scheduler_state
       SET heartbeat_at='2026-07-28T08:01:00.000Z',last_tick_at='2026-07-28T08:01:00.000Z'
     WHERE id=1
  `).run();
  f.db.prepare(`
    UPDATE doc_import_jobs
       SET last_run_at='2026-07-28T08:01:00.000Z',last_result='0 neu, 1 unverändert'
     WHERE id='import-1'
  `).run();
  f.db.prepare(`
    UPDATE doc_import_state SET imported_at='2026-07-28T08:01:00.000Z'
     WHERE job_id='import-1' AND pfad='Scan.pdf'
  `).run();
  result = f.service.runOffice();
  assert.equal(
    result.filter((x) => x.changed).length,
    0,
    'Scheduler-Heartbeat und reine Laufzeitstempel dürfen Büroabbilder nicht neu schreiben'
  );
  const security = f.db.prepare("SELECT * FROM doc_files WHERE artifact_kind='security-encrypted'").get();
  const firstSha = security.sha256;
  assert.match(security.name, /^\d{6} \d{4} Sicherheit\.json\.enc$/);
  const securityEnvelope = JSON.parse(
    fs.readFileSync(f.documents.documentStorage.findBlobPath(security), 'utf8')
  );
  assert.equal(securityEnvelope.schema, 'security/3');
  const credentials = f.db.prepare("SELECT * FROM doc_files WHERE artifact_kind='credentials-encrypted'").get();
  const credentialsEnvelope = JSON.parse(
    fs.readFileSync(f.documents.documentStorage.findBlobPath(credentials), 'utf8')
  );
  assert.equal(credentialsEnvelope.schema, 'credentials/3');
  assert.ok(securityEnvelope.generationId);
  assert.equal(credentialsEnvelope.generationId, securityEnvelope.generationId);
  assert.equal(credentialsEnvelope.sourceRevision, securityEnvelope.sourceRevision);
  assert.equal(credentialsEnvelope.keyId, securityEnvelope.keyId);
  assert.equal(
    f.db.prepare("SELECT source_revision FROM doc_materializations WHERE artifact_kind='security-encrypted'").get().source_revision,
    securityEnvelope.sourceRevision
  );
  assert.equal(
    f.db.prepare("SELECT source_revision FROM doc_materializations WHERE artifact_kind='credentials-encrypted'").get().source_revision,
    credentialsEnvelope.sourceRevision
  );
  const securityDecoded = secureJson.decryptJson(
    securityEnvelope, process.env.DOCUMENT_RECOVERY_KEY, 'security/3'
  );
  const credentialsDecoded = secureJson.decryptJson(
    credentialsEnvelope, process.env.DOCUMENT_RECOVERY_KEY, 'credentials/3'
  );
  assert.equal(securityDecoded.payload.recoveryGeneration.artifactScope, 'security');
  assert.equal(credentialsDecoded.payload.recoveryGeneration.artifactScope, 'credentials');
  f.service.runOffice({ forceSecurity: true });
  assert.notEqual(
    f.db.prepare("SELECT sha256 FROM doc_files WHERE artifact_kind='security-encrypted'").get().sha256,
    firstSha,
    'nächtliche Erneuerung erzeugt einen frischen verschlüsselten Umschlag'
  );

  const officeJson = f.db.prepare("SELECT * FROM doc_files WHERE artifact_kind='office-backup-json'").get();
  const payload = JSON.parse(fs.readFileSync(f.documents.documentStorage.findBlobPath(officeJson), 'utf8'));
  assert.deepEqual(payload.tables.doc_files, [], 'Verwaltungsabbilder betten sich nicht rekursiv ein');
  assert.deepEqual(payload.tables.doc_materializations, [], 'technischer Erzeugungsstatus ist keine fachliche Sicherungsquelle');
  assert.deepEqual(payload.tables.doc_backup_scheduler_state, []);
  assert.ok(!Object.hasOwn(payload.tables.doc_import_jobs[0], 'last_run_at'));
  assert.ok(!Object.hasOwn(payload.tables.doc_import_jobs[0], 'last_result'));
  assert.ok(!Object.hasOwn(payload.tables.doc_import_state[0], 'imported_at'));
  assert.equal(f.service.status().recoveryKeyConfigured, true);
});

test('behält bei einem Publikationsfehler die letzte gültige Fassung', (t) => {
  const f = fixture(); t.after(f.close);
  f.service.runCase('case-1');
  const before = f.db.prepare("SELECT * FROM doc_files WHERE artifact_kind='case-master-xlsx'").get();
  const beforeBytes = fs.readFileSync(f.documents.documentStorage.findBlobPath(before));

  const changed = JSON.parse(JSON.stringify(f.base));
  changed.address.street = 'Neuer Weg 99';
  f.db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify(changed), 'case-1');
  f.failNextSidecar();
  const result = f.service.runCase('case-1');

  assert.ok(result.some((entry) => entry.artifactKind === 'case-master-xlsx' && entry.error));
  const after = f.db.prepare("SELECT * FROM doc_files WHERE id=?").get(before.id);
  assert.equal(after.sha256, before.sha256);
  assert.deepEqual(
    fs.readFileSync(f.documents.documentStorage.findBlobPath(after)),
    beforeBytes,
    'Fehler darf die zuvor gültige Datei nicht überschreiben'
  );
});

test('meldet ein unlesbares internes Secret sichtbar und pflegt die unkritischen Büroabbilder weiter', (t) => {
  const f = fixture(); t.after(f.close);
  const previousRecovery = process.env.DOCUMENT_RECOVERY_KEY;
  const previousEncryption = process.env.ENCRYPTION_KEY;
  t.after(() => {
    if (previousRecovery === undefined) delete process.env.DOCUMENT_RECOVERY_KEY;
    else process.env.DOCUMENT_RECOVERY_KEY = previousRecovery;
    if (previousEncryption === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousEncryption;
  });
  process.env.DOCUMENT_RECOVERY_KEY = '22'.repeat(32);
  process.env.ENCRYPTION_KEY = '77'.repeat(32);
  f.db.prepare(`
    INSERT INTO office_ai_config(provider,api_key_encrypted,model,endpoint,updated_at)
    VALUES ('openai','kaputt','','','')
  `).run();

  const result = f.service.runOffice();
  assert.equal(result.filter((entry) => entry.error).length, 2);
  assert.equal(f.db.prepare("SELECT count(*) n FROM doc_files WHERE area='management'").get().n, 3);
  assert.equal(
    f.db.prepare("SELECT status FROM doc_materializations WHERE artifact_kind='security-encrypted'").get().status,
    'error'
  );
  assert.match(
    f.db.prepare("SELECT last_error FROM doc_materializations WHERE artifact_kind='credentials-encrypted'").get().last_error,
    /kann mit dem aktuellen ENCRYPTION_KEY nicht entschlüsselt/
  );
});

test('entprellt markierte Änderungen und veröffentlicht erst nach Fälligkeit', (t) => {
  const f = fixture(); t.after(f.close);
  f.service.runCase('case-1');
  const before = f.db.prepare(
    "SELECT sha256 FROM doc_files WHERE artifact_kind='case-backup-json'"
  ).get().sha256;
  const changed = JSON.parse(JSON.stringify(f.base));
  changed.address.street = 'Entprellter Weg 7';
  f.db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?')
    .run(JSON.stringify(changed), 'case-1');

  assert.equal(f.service.markCaseDirty('case-1', 10_000), true);
  const queued = f.service.pending().cases.find((entry) => entry.caseId === 'case-1');
  assert.ok(queued && queued.dueAt > Date.now());
  let result = f.service.drain({ now: queued.dueAt - 1 });
  assert.deepEqual(result.cases, {});
  assert.equal(
    f.db.prepare("SELECT sha256 FROM doc_files WHERE artifact_kind='case-backup-json'").get().sha256,
    before
  );

  result = f.service.drain({ now: queued.dueAt });
  assert.ok(result.cases['case-1'].some((entry) => entry.changed));
  assert.notEqual(
    f.db.prepare("SELECT sha256 FROM doc_files WHERE artifact_kind='case-backup-json'").get().sha256,
    before
  );
  assert.equal(f.service.pending().cases.some((entry) => entry.caseId === 'case-1'), false);
});

test('Vollbackup erkennt gleich lange Änderungen derselben SQLite-Sekunde und überspringt danach unveränderte Generatoren', (t) => {
  const f = fixture(); t.after(f.close);
  const previous = process.env.DOCUMENT_RECOVERY_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.DOCUMENT_RECOVERY_KEY;
    else process.env.DOCUMENT_RECOVERY_KEY = previous;
  });
  process.env.DOCUMENT_RECOVERY_KEY = '33'.repeat(32);

  f.service.runCase('case-1');
  const fixedSecond = '2026-07-28 12:34:56';
  f.db.prepare('UPDATE cases SET stammdaten_updated_at=? WHERE id=?')
    .run(fixedSecond, 'case-1');
  f.service.runCase('case-1');
  const beforeJson = f.db.prepare(
    "SELECT sha256 FROM doc_files WHERE artifact_kind='case-backup-json'"
  ).get().sha256;
  const beforeXlsx = f.db.prepare(
    "SELECT sha256 FROM doc_files WHERE artifact_kind='case-master-xlsx'"
  ).get().sha256;

  const changed = JSON.parse(JSON.stringify(f.base));
  changed.address.street = 'Testweg 2'; // exakt so lang wie "Testweg 1"
  f.db.prepare(`
    UPDATE cases
       SET stammdaten_json=?,stammdaten_updated_at=?
     WHERE id=?
  `).run(JSON.stringify(changed), fixedSecond, 'case-1');

  const refreshed = f.service.prepareTotalBackup();
  assert.ok(
    refreshed.cases['case-1'].some((entry) => entry.changed),
    'starker Inhaltshash muss die Änderung trotz gleicher Länge/Sekunde sehen'
  );
  assert.notEqual(
    f.db.prepare("SELECT sha256 FROM doc_files WHERE artifact_kind='case-backup-json'").get().sha256,
    beforeJson
  );
  assert.notEqual(
    f.db.prepare("SELECT sha256 FROM doc_files WHERE artifact_kind='case-master-xlsx'").get().sha256,
    beforeXlsx
  );
  const backupFile = f.db.prepare(
    "SELECT * FROM doc_files WHERE artifact_kind='case-backup-json'"
  ).get();
  const payload = JSON.parse(
    fs.readFileSync(f.documents.documentStorage.findBlobPath(backupFile), 'utf8')
  );
  assert.equal(JSON.parse(payload.case.stammdaten_json).address.street, 'Testweg 2');
  assert.match(
    f.db.prepare(`
      SELECT source_revision FROM doc_materializations
       WHERE scope_type='case' AND scope_id='case-1' AND artifact_kind='case-backup-json'
    `).get().source_revision,
    /^s2:[0-9a-f]{64}:/
  );

  const unchanged = f.service.prepareTotalBackup();
  assert.ok(
    unchanged.cases['case-1'].every((entry) => entry.skipped && !entry.changed),
    'ein Folgevollbackup darf JSON/XLSX eines unveränderten Falls nicht neu erzeugen'
  );

  const managed = f.db.prepare(
    "SELECT * FROM doc_files WHERE artifact_kind='case-backup-json'"
  ).get();
  const managedPath = f.documents.documentStorage.findBlobPath(managed);
  const validBytes = fs.readFileSync(managedPath);
  fs.writeFileSync(managedPath, Buffer.alloc(validBytes.length, 0x58));
  assert.notEqual(
    crypto.createHash('sha256').update(fs.readFileSync(managedPath)).digest('hex'),
    managed.sha256,
    'Testfixture hat die verwaltete Datei nicht wirklich beschädigt'
  );

  const healed = f.service.prepareTotalBackup();
  assert.ok(
    healed.cases['case-1'].some((entry) =>
      entry.artifactKind === 'case-backup-json' && entry.changed
    ),
    'Vollbackup muss physisch beschädigte verwaltete Abbilder atomar regenerieren'
  );
  const healedFile = f.db.prepare('SELECT * FROM doc_files WHERE id=?').get(managed.id);
  const healedBytes = fs.readFileSync(f.documents.documentStorage.findBlobPath(healedFile));
  assert.equal(
    crypto.createHash('sha256').update(healedBytes).digest('hex'),
    healedFile.sha256
  );
  assert.doesNotThrow(() => JSON.parse(healedBytes.toString('utf8')));
});

test('erzeugt mit schwachem Legacy-Recovery-Key keine neuen Sicherheitsumschläge', (t) => {
  const f = fixture(); t.after(f.close);
  const previous = process.env.DOCUMENT_RECOVERY_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.DOCUMENT_RECOVERY_KEY;
    else process.env.DOCUMENT_RECOVERY_KEY = previous;
  });
  process.env.DOCUMENT_RECOVERY_KEY = 'legacy-schluessel-mit-nur-passwortstaerke';

  let result = f.service.runOffice();
  let errors = result.filter((entry) =>
    ['security-encrypted', 'credentials-encrypted'].includes(entry.artifactKind)
  );
  assert.equal(errors.length, 2);
  assert.ok(errors.every((entry) => /Legacy-Schlüssel.*rotiert/i.test(entry.error)));
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM doc_files WHERE artifact_kind IN ('security-encrypted','credentials-encrypted')").get().n,
    0
  );
  assert.equal(f.service.status().recoveryKeyRequiresRotation, true);
  assert.equal(Object.hasOwn(f.service.status(), 'recoveryKeyFingerprint'), false);

  result = f.service.runOffice({ forceSecurity: true });
  errors = result.filter((entry) =>
    ['security-encrypted', 'credentials-encrypted'].includes(entry.artifactKind)
  );
  assert.equal(errors.length, 2, 'auch der erzwungene Vor-Backup-Lauf bleibt fail-closed');
  assert.ok(errors.every((entry) => /Legacy-Schlüssel.*rotiert/i.test(entry.error)));
});

test('zieht Security-Änderungen entprellt nach und belegt die aktuelle DB-Quellrevision', (t) => {
  const f = fixture(); t.after(f.close);
  const previous = process.env.DOCUMENT_RECOVERY_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.DOCUMENT_RECOVERY_KEY;
    else process.env.DOCUMENT_RECOVERY_KEY = previous;
  });
  process.env.DOCUMENT_RECOVERY_KEY = '44'.repeat(32);

  f.service.runOffice();
  f.service.scanIfChanged();
  const before = f.db.prepare(`
    SELECT source_revision FROM doc_materializations
     WHERE artifact_kind='security-encrypted'
  `).get().source_revision;

  f.db.prepare(`
    INSERT INTO mcp_settings(id,enabled,public_url,updated_at)
    VALUES ('1','1','https://mcp.example.invalid','2026-07-28T12:00:00.000Z')
  `).run();
  const scanned = f.service.scanIfChanged();
  assert.equal(scanned.changed, true);
  const due = f.service.pending().officeDueAt;
  assert.ok(due > Date.now());
  const drained = f.service.drain({ now: due });
  assert.ok(drained.office.some((entry) => entry.artifactKind === 'security-encrypted' && entry.changed));

  const after = f.db.prepare(`
    SELECT source_revision FROM doc_materializations
     WHERE artifact_kind='security-encrypted'
  `).get().source_revision;
  assert.notEqual(after, before);
  assert.equal(after, backupData.portableRecoverySourceRevision(f.db, require('../src/security/crypto')));
});
