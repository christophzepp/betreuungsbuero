'use strict';

// AP-02: the actual backup and restore CLIs, synthetic data, disposable targets.
// This is a baseline rehearsal, not a production recovery or capacity guarantee.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const { PDFDocument, StandardFonts } = require('@cantoo/pdf-lib');
const fixture = require('./fixtures/server-first/pilot-case.json');

const serverRoot = path.resolve(__dirname, '..');
const appFile = path.resolve(serverRoot, '../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fileHash = (file) => sha(fs.readFileSync(file));
function tree(root) {
  const result = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else {
        assert.ok(entry.isFile(), 'The rehearsal only accepts regular files.');
        result[path.relative(root, file)] = fileHash(file);
      }
    }
  }
  if (fs.existsSync(root)) visit(root);
  return result;
}

test('Server-first: echte Gesamtsicherung wird mit Fällen, Rechten und Dateien wiederhergestellt', async (t) => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'server-first-restore-')));
  const source = path.join(temp, 'source');
  const data = path.join(source, 'data');
  const dbFile = path.join(source, 'database/office.sqlite3');
  const secretFile = path.join(temp, 'secrets/document-recovery-key');
  const target = path.join(temp, 'target');
  const targetServer = path.join(target, 'server');
  const targetData = path.join(target, 'data');
  const targetDb = path.join(target, 'database/office.sqlite3');
  const targetOutputs = path.join(target, 'outputs');
  let db, restored;
  t.after(() => {
    if (db?.open) db.close();
    if (restored?.open) restored.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  // Set every application path before importing production modules.
  Object.assign(process.env, {
    RUNTIME_ROOT: source, DOCUMENTS_DATA_ROOT: data, DB_PATH: dbFile,
    RUNTIME_SECRETS_ROOT: path.dirname(secretFile), DOCUMENT_RECOVERY_KEY_FILE: secretFile,
    EXTENSION_ARTIFACTS_DIR: path.join(source, 'extension-artifacts'),
    ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
  });
  delete process.env.DOCUMENT_RECOVERY_KEY;
  db = require('../src/database/index');
  const cryptoHelper = require('../src/security/crypto');
  const recoveryKeys = require('../src/modules/recovery/key-store').shared();
  recoveryKeys.setKey(crypto.randomBytes(32).toString('hex'));
  const recoveryKey = recoveryKeys.getKey();
  const password = 'Synthetic-Restore-Only-2026!';
  for (const id of [1, 2]) {
    db.prepare(`INSERT INTO users
      (id,username,password_hash,display_name,allow_online,is_admin,allow_case_management)
      VALUES (?,?,?,?,1,?,1)`).run(id, `sf-restore-${id}`, bcrypt.hashSync(password, 4),
        `Synthetisch ${id}`, id === 1 ? 1 : 0);
  }
  db.prepare('INSERT INTO cases (id,label,stammdaten_json,owner_user_id) VALUES (?,?,?,?)')
    .run(fixture.caseId, 'Synthetischer Referenzfall', JSON.stringify(fixture.stammdaten), 1);
  db.prepare('INSERT INTO case_access (case_id,user_id,level) VALUES (?,?,?)').run(fixture.caseId, 2, 'read');
  db.prepare('INSERT INTO case_reports (case_id,report_id,data_json,updated_by) VALUES (?,?,?,?)')
    .run(fixture.caseId, 'free_document', JSON.stringify(fixture.report), 1);
  db.prepare('INSERT INTO office_json (key,data_json,updated_by) VALUES (?,?,?)')
    .run('sf-restore-reference', JSON.stringify({ zero: 0, disabled: false, empty: '', unset: null }), 1);
  db.prepare('INSERT INTO office_ai_config (provider,api_key_encrypted) VALUES (?,?)')
    .run('synthetic', cryptoHelper.encrypt('synthetic-provider-secret'));
  let beforeBrowser;
  if (process.env.SF_BROWSER_MODULE) {
    await t.test('Browser vor Sicherung: echte Anmeldung, Neuladen und Fach-PDF', async () => {
      const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']
        .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
      Object.assign(env, { RUNTIME_ROOT: source, DB_PATH: dbFile, DOCUMENTS_DATA_ROOT: data,
        OUTPUTS_DIR: path.dirname(appFile), RUNTIME_SECRETS_DIR: path.dirname(secretFile),
        DOCUMENT_RECOVERY_KEY_FILE: secretFile, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
        EXTENSION_ARTIFACTS_DIR: process.env.EXTENSION_ARTIFACTS_DIR,
        SESSION_SECRET: crypto.randomBytes(32).toString('hex'), COOKIE_SECURE: '0',
        CALENDAR_SYNC_INTERVAL_SECONDS: '0' });
      const app = require('./helpers/server-first-app-harness.cjs')(serverRoot, env);
      try {
        await app.start();
        beforeBrowser = await require('./helpers/server-first-browser.cjs')(app.base, password, fixture, 'before');
      } finally { await app.stop(); }
    });
    assert.ok(beforeBrowser, 'Browser proof before backup is mandatory in browser mode.');
  }
  const documents = require('../src/modules/documents/routes').intern;
  const moduleFiles = require('../src/modules/documents/module-files').createModuleFiles({ db, documents });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('SF-REF-001 - Synthetische Wiederherstellungsprobe', { font, size: 12 });
  const pdfBytes = Buffer.from(await pdf.save());
  const attachment = moduleFiles.store({ module: 'case-document', ownerId: 'sf-output-1', slot: 'pdf',
    caseId: fixture.caseId, filename: 'Referenz.pdf', mimeType: 'application/pdf',
    bytes: pdfBytes, createdBy: 1, date: '2026-09-21' });
  const materializations = require('../src/modules/documents/materializations')
    .createDocumentMaterializations({ db, documents, recoveryKeyStore: recoveryKeys });
  const prepared = materializations.prepareTotalBackup();
  const generationErrors = [...Object.values(prepared.cases).flat(), ...prepared.office].filter(row => row.error);
  assert.deepEqual(generationErrors, [], 'All derived files must exist before the backup.');
  const rows = db.prepare('SELECT * FROM doc_files ORDER BY id').all();
  const fileInventory = rows.map(row => ({ id: row.id, relative: path.relative(data, documents.findBlobPath(row)), sha256: row.sha256 }));
  const access = db.prepare('SELECT * FROM case_access ORDER BY case_id,user_id').all();
  const links = db.prepare('SELECT * FROM doc_links ORDER BY module,owner_id,slot').all();
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  const oldEncrypted = db.prepare('SELECT api_key_encrypted FROM office_ai_config').get().api_key_encrypted;
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  const originalSource = tree(source);
  const originalSecrets = tree(path.dirname(secretFile));
  function assertSourceUnchanged() {
    const actual = tree(source);
    // SQLite's read-only .backup may create an empty WAL and shared-memory index.
    // All original bytes still have to match; nonempty WAL would fail this check.
    const wal = dbFile + '-wal';
    if (fs.existsSync(wal)) assert.equal(fs.statSync(wal).size, 0);
    delete actual[path.relative(source, wal)];
    delete actual[path.relative(source, dbFile + '-shm')];
    assert.deepEqual(actual, originalSource);
  }
  const cleanEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const cliEnv = { ...cleanEnv, RUNTIME_ROOT: source, DOCUMENTS_DATA_ROOT: data,
    DOCUMENT_RECOVERY_KEY_FILE: secretFile, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    EXTENSION_ARTIFACTS_DIR: process.env.EXTENSION_ARTIFACTS_DIR };
  function cli(script, args, env = cliEnv) {
    const start = performance.now();
    const result = spawnSync('bash', [path.join(serverRoot, 'tools', script), ...args],
      { env, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(result.error);
    t.diagnostic(`${script}: exit=${result.status}, seconds=${((performance.now() - start) / 1000).toFixed(2)}`);
    return result;
  }
  function succeeds(result) { assert.equal(result.status, 0, result.stderr + result.stdout); }
  const backupArgs = ['--db', dbFile, '--data-dir', data, '--server-dir', serverRoot,
    '--app-file', appFile, '--destination', path.join(temp, 'snapshots'), '--label', 'sf-reference'];
  let snapshot;
  await t.test('Gesamtsicherung mit authentifizierten Sicherheits- und Zugangsabbildern', () => {
    const result = cli('gesamt-backup.sh', backupArgs);
    if (result.status !== 0) {
      const diagnostic = /^DIAGNOSE_SNAPSHOT=(.+)$/m.exec(result.stdout)?.[1];
      if (diagnostic && diagnostic.startsWith(path.join(temp, 'snapshots') + path.sep)) {
        result.stderr += fs.readFileSync(path.join(diagnostic, 'PRUEFBERICHT.txt'), 'utf8');
      }
    }
    succeeds(result);
    snapshot = /^SNAPSHOT=(.+)$/m.exec(result.stdout)?.[1];
    assert.ok(snapshot);
    assert.equal(fs.readFileSync(path.join(snapshot, 'STATUS.txt'), 'utf8').trim(), 'VOLLSTAENDIG');
    assert.equal(fileHash(path.join(snapshot, 'betrieb/anwendung', path.basename(appFile))), fileHash(appFile));
    const inventory = tree(snapshot);
    assert.ok(Object.keys(inventory).some(name => name.startsWith('betrieb/server-ressourcen/templates/')));
    assert.ok(!Object.keys(inventory).some(name => /(^|\/)(\.env|document-recovery-key)(\.|\/|$)/.test(name) && !name.endsWith('.env.example')));
    assertSourceUnchanged();
    assert.deepEqual(tree(path.dirname(secretFile)), originalSecrets);
  });
  assert.ok(snapshot, 'A successful backup is required for the remaining rehearsal.');
  const originalSnapshot = tree(snapshot);
  fs.mkdirSync(path.join(targetServer, 'assets'), { recursive: true });
  fs.mkdirSync(path.dirname(targetDb), { recursive: true });
  fs.copyFileSync(path.join(serverRoot, 'package.json'), path.join(targetServer, 'package.json'));
  fs.mkdirSync(targetData, { recursive: true });
  fs.writeFileSync(path.join(targetData, 'before.txt'), 'synthetic target sentinel');
  const restoreArgs = ['--snapshot', snapshot, '--server-dir', targetServer, '--data-dir', targetData,
    '--db', targetDb, '--restore-runtime-artifacts', '--outputs-dir', targetOutputs];

  await t.test('Dry-run und beschädigter Snapshot verändern das Wiederherstellungsziel nicht', () => {
    const before = tree(target);
    succeeds(cli('gesamt-restore.sh', restoreArgs));
    assert.deepEqual(tree(target), before);
    const damaged = path.join(temp, 'damaged-snapshot');
    fs.cpSync(snapshot, damaged, { recursive: true });
    fs.appendFileSync(path.join(damaged, 'datenbank/betreuungsbuero.sqlite3'), 'corruption-probe');
    const args = [...restoreArgs, '--apply', '--confirm-app-stopped'];
    args[1] = damaged;
    const result = cli('gesamt-restore.sh', args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Prüfsumme|Dateigröße|Manifest/i);
    assert.deepEqual(tree(target), before);
  });

  await t.test('Aktivierter Restore bewahrt Fall, Berichte, Teilrechte, Bürodaten und PDF-Bytes', async () => {
    succeeds(cli('gesamt-restore.sh', [...restoreArgs, '--apply', '--confirm-app-stopped']));
    restored = new Database(targetDb, { readonly: true, fileMustExist: true });
    assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(restored.pragma('foreign_key_check'), []);
    assert.deepEqual(JSON.parse(restored.prepare('SELECT stammdaten_json FROM cases WHERE id=?').get(fixture.caseId).stammdaten_json), fixture.stammdaten);
    assert.deepEqual(JSON.parse(restored.prepare('SELECT data_json FROM case_reports WHERE case_id=?').get(fixture.caseId).data_json), fixture.report);
    assert.deepEqual(restored.prepare('SELECT * FROM users ORDER BY id').all(), users);
    assert.ok(bcrypt.compareSync(password, users[0].password_hash));
    assert.deepEqual(restored.prepare('SELECT * FROM case_access ORDER BY case_id,user_id').all(), access);
    assert.deepEqual(restored.prepare('SELECT * FROM doc_links ORDER BY module,owner_id,slot').all(), links);
    assert.deepEqual(JSON.parse(restored.prepare('SELECT data_json FROM office_json WHERE key=?').get('sf-restore-reference').data_json),
      { zero: 0, disabled: false, empty: '', unset: null });
    for (const file of fileInventory) assert.equal(fileHash(path.join(targetData, file.relative)), file.sha256, file.id);
    assert.deepEqual(restored.prepare('SELECT id,sha256 FROM doc_files ORDER BY id').all(), rows.map(({ id, sha256 }) => ({ id, sha256 })));
    const restoredPdf = fs.readFileSync(path.join(targetData, fileInventory.find(row => row.id === attachment.id).relative));
    assert.equal(sha(restoredPdf), sha(pdfBytes));
    assert.equal((await PDFDocument.load(restoredPdf)).getPageCount(), 1);
    assert.equal(fileHash(path.join(targetOutputs, path.basename(appFile))), fileHash(appFile));
    assert.deepEqual(tree(path.join(targetServer, 'assets/templates')), tree(path.join(serverRoot, 'assets/templates')));
    assert.ok(fs.existsSync(path.join(targetData, '.recovery-quarantine')));
    assert.equal(cryptoHelper.decryptStrict(restored.prepare('SELECT api_key_encrypted FROM office_ai_config').get().api_key_encrypted), 'synthetic-provider-secret');
    restored.close();
  });

  await t.test('Fehlender oder falscher Recovery-Schlüssel scheitert; neuer Instanzschlüssel kann Zugänge entschlüsseln', () => {
    const secureJson = require('../src/security/secure-json');
    const backupData = require('../src/modules/backup/portable-data');
    const credentialsRow = rows.find(row => row.artifact_kind === 'credentials-encrypted');
    const credentialsFile = fileInventory.find(row => row.id === credentialsRow.id);
    const envelope = JSON.parse(fs.readFileSync(path.join(targetData, credentialsFile.relative), 'utf8'));
    const before = tree(target);
    for (const key of ['', crypto.randomBytes(32).toString('hex')]) {
      assert.throws(() => secureJson.decryptJson(envelope, key, 'credentials/3'));
      assert.deepEqual(tree(target), before);
    }
    const decoded = secureJson.decryptJson(envelope, recoveryKey, 'credentials/3');
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    assert.throws(() => cryptoHelper.decryptStrict(oldEncrypted));
    const rehydrated = backupData.rehydratePortableSecrets(decoded.payload, cryptoHelper);
    const encrypted = rehydrated.officeAiConfig[0].api_key_encrypted;
    assert.notEqual(encrypted, oldEncrypted);
    assert.equal(cryptoHelper.decryptStrict(encrypted), 'synthetic-provider-secret');
    assert.deepEqual(tree(target), before, 'Key conversion alone must not modify the restored database.');
  });
  const envelopes = Object.fromEntries(['security', 'credentials'].map(scope => {
    const row = rows.find(file => file.artifact_kind === `${scope}-encrypted`);
    const file = fileInventory.find(file => file.id === row.id);
    return [scope, JSON.parse(fs.readFileSync(path.join(targetData, file.relative), 'utf8'))];
  }));
  await require('./helpers/server-first-recovery-startup.cjs')(t, {
    serverRoot, target, targetServer, targetData, targetDb, targetOutputs,
    sourceSecretFile: secretFile, recoveryKey, password, fixture,
    attachmentId: attachment.id, pdfSha256: sha(pdfBytes), envelopes, beforeBrowser,
  });
  assertSourceUnchanged();
  assert.deepEqual(tree(path.dirname(secretFile)), originalSecrets);
  assert.deepEqual(tree(snapshot), originalSnapshot);
  t.diagnostic(`Compared ${fileInventory.length} document files; application and template trees matched.`);
});
