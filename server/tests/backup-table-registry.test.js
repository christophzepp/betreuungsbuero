'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backupData = require('../src/modules/backup/portable-data');
const { createIntakeOcrStore } = require('../src/modules/cases/intake-ocr');

test('gemeinsame Registrierung klassifiziert jede Anwendungstabelle oder schließt sie begründet aus', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-registry-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  process.env.DB_PATH = path.join(temp, 'registry.sqlite3');
  const db = require('../src/database/index');
  t.after(() => db.close());

  const registered = new Set(backupData.TABLE_REGISTRY.map((entry) => entry.table));
  const excluded = new Set(Object.keys(backupData.BACKUP_EXCLUDED_TABLES));
  const applicationTables = db.prepare(`
    SELECT name FROM sqlite_master
     WHERE type='table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name
  `).all().map((row) => row.name);
  const unclassified = applicationTables.filter((table) => !registered.has(table) && !excluded.has(table));
  assert.deepEqual(unclassified, []);
  assert.equal(new Set(backupData.TABLE_REGISTRY.map((entry) => entry.key)).size, backupData.TABLE_REGISTRY.length);
  assert.equal(new Set(backupData.TABLE_REGISTRY.map((entry) => entry.table)).size, backupData.TABLE_REGISTRY.length);
  const caseClassifications = new Map(backupData.TABLE_REGISTRY.map((entry) => [entry.table, entry]));
  const unclassifiedCaseTables = applicationTables.filter((table) => {
    const hasCaseId = db.prepare(`PRAGMA table_info("${table}")`).all().some((column) => column.name === 'case_id');
    const spec = caseClassifications.get(table);
    return hasCaseId && !(spec.groups.includes('case') || spec.caseExcludedReason);
  });
  assert.deepEqual(unclassifiedCaseTables, []);

  for (const scope of ['security', 'credentials']) {
    const contract = backupData.recoverySchemaContract(scope);
    for (const [table, expectedColumns] of Object.entries(contract.tables)) {
      const actualColumns = db.prepare(`PRAGMA table_info("${table}")`).all()
        .map((column) => column.name);
      assert.deepEqual(
        actualColumns,
        expectedColumns,
        `${scope}-Recovery-Vertrag für ${table} muss dem aktuellen App-Schema entsprechen`
      );
    }
  }
});

test('Büro-/Modulabbild enthält OCR verlustfrei, aber keine Intake- oder Signaturbytes', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-registry-content-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  process.env.DB_PATH = path.join(temp, 'content.sqlite3');
  delete require.cache[require.resolve('../src/database/index')];
  const db = require('../src/database/index');
  t.after(() => db.close());

  const state = {
    entries: [{ id: 'draft-1', state: { ocrRef: { draftId: 'draft-1', available: true } } }]
  };
  db.prepare("INSERT INTO office_json(key,data_json) VALUES ('case_intakes',?)").run(JSON.stringify(state));
  db.prepare(`
    INSERT INTO intake_files(id,draft_id,file_name,mime_type,size,data)
    VALUES ('intake-1','draft-1','scan.pdf','application/pdf',7,?)
  `).run(Buffer.from('PDFBYTE'));
  db.prepare(`
    INSERT INTO signatures(id,name,data_url,visibility)
    VALUES ('signature-1','Test','data:image/png;base64,UE5H','private')
  `).run();
  const intakeOcr = createIntakeOcrStore(db);
  intakeOcr.save('draft-1', [{ name: 'scan.pdf', text: 'Vollständiger OCR-Text' }]);

  const office = backupData.officeData(db, { intakeOcr });
  const hydrated = JSON.parse(office.tables.office_json.find((row) => row.key === 'case_intakes').data_json);
  assert.equal(hydrated.entries[0].state.ocr[0].text, 'Vollständiger OCR-Text');
  assert.equal(
    JSON.parse(office.tables.case_intake_ocr[0].payload_json)[0].text,
    'Vollständiger OCR-Text'
  );

  const modules = backupData.moduleData(db, { intakeOcr });
  assert.ok(!Object.hasOwn(modules.intakeFiles[0], 'data'));
  assert.ok(!Object.hasOwn(modules.signatures[0], 'data_url'));
  assert.ok(!JSON.stringify(modules).includes('PDFBYTE'));
  assert.ok(!JSON.stringify(modules).includes('data:image/png'));
});

test('Büroabbild normalisiert volatile Laufzustände, vollständige Modulregistrierung behält sie', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-volatile-state-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  process.env.DB_PATH = path.join(temp, 'volatile.sqlite3');
  delete require.cache[require.resolve('../src/database/index')];
  const db = require('../src/database/index');
  t.after(() => db.close());

  db.prepare(`
    UPDATE doc_backup_scheduler_state
       SET heartbeat_at='2026-07-28T08:01:00.000Z',last_tick_at='2026-07-28T08:01:00.000Z'
     WHERE id=1
  `).run();
  const office = backupData.officeData(db);
  const modules = backupData.moduleData(db);

  assert.deepEqual(office.tables.doc_backup_scheduler_state, []);
  assert.equal(modules.docBackupSchedulerState[0].heartbeat_at, '2026-07-28T08:01:00.000Z');
  assert.ok(
    backupData.TABLE_REGISTRY.some((entry) =>
      entry.table === 'doc_backup_scheduler_state'
      && entry.groups.includes('office')
      && entry.groups.includes('module')
    ),
    'die Tabelle bleibt zentral klassifiziert und in der vollständigen Sicherung verfügbar'
  );
});

test('Fallsicherung nimmt sichere direkte und indirekte Fallbezüge aus der Registrierung mit', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-case-registry-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  process.env.DB_PATH = path.join(temp, 'case.sqlite3');
  delete require.cache[require.resolve('../src/database/index')];
  const db = require('../src/database/index');
  t.after(() => db.close());

  db.prepare("INSERT INTO cases(id,label) VALUES ('case-1','Müller, Ada')").run();
  db.prepare(`
    INSERT INTO calendar_events(id,title,start_at,end_at,case_id)
    VALUES ('event-1','Termin','2026-01-01','2026-01-01','case-1')
  `).run();
  db.prepare(`
    INSERT INTO calendar_event_attachments(id,event_id,filename,size)
    VALUES ('event-file-1','event-1','Termin.pdf',10)
  `).run();
  db.prepare(`
    INSERT INTO doc_files(id,area,case_id,name,deleted_at,managed)
    VALUES ('doc-1','case','case-1','Akte.pdf','',0)
  `).run();
  db.prepare(`
    INSERT INTO doc_files(id,area,case_id,name,deleted_at,managed,artifact_kind)
    VALUES ('managed-case-backup','case','case-1','Sicherung.json','',1,'case-backup-json')
  `).run();
  db.prepare(`
    INSERT INTO doc_materializations(scope_type,scope_id,artifact_kind,file_id,source_revision,status)
    VALUES ('case','case-1','case-backup-json','managed-case-backup','alte-quellrevision','ok')
  `).run();
  db.prepare(`
    INSERT INTO doc_links(module,owner_id,slot,file_id)
    VALUES ('calendar','event-1','anlage','doc-1')
  `).run();
  db.prepare(`
    INSERT INTO doc_versions(id,file_id,name)
    VALUES ('version-1','doc-1','Akte alt.pdf')
  `).run();
  db.prepare(`
    INSERT INTO bank_connections(id,scope,case_id,bank_name,username,pin_encrypted)
    VALUES ('case-bank','case','case-1','Testbank','kennung','interner-ciphertext')
  `).run();
  db.prepare(`
    INSERT INTO bank_accounts_discovered(id,connection_id,iban,manual_case_id)
    VALUES ('manual-account','hibiscus-gateway','DE001234','case-1')
  `).run();

  const result = backupData.caseData(db, 'case-1');
  assert.equal(result.case.id, 'case-1');
  assert.equal(result.tables.calendar_events[0].id, 'event-1');
  assert.equal(result.tables.calendar_event_attachments[0].id, 'event-file-1');
  assert.equal(result.tables.doc_links[0].file_id, 'doc-1');
  assert.equal(result.tables.doc_versions[0].id, 'version-1');
  assert.equal(result.files[0].name, 'Akte.pdf');
  assert.ok(!result.tables.doc_files.some((row) => row.id === 'managed-case-backup'));
  assert.deepEqual(result.tables.doc_materializations, []);
  assert.ok(!Object.hasOwn(result.tables.bank_connections[0], 'pin_encrypted'));
  assert.ok(result.tables.bank_accounts_discovered.some((row) => row.id === 'manual-account'));
});
