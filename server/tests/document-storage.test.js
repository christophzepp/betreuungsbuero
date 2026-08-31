'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  createDocumentStorage, safeRelative, overlappingRoot
} = require('../src/modules/documents/storage');
const taxonomy = require('../src/modules/documents/taxonomy');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'document-storage-test-'));
const dataRoot = path.join(temp, 'data');
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE cases (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, stammdaten_json TEXT NOT NULL DEFAULT '{}',
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE doc_folders (
    id TEXT PRIMARY KEY, area TEXT NOT NULL, case_id TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL, name_key TEXT NOT NULL DEFAULT '', storage_relpath TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '', created_by INTEGER
  );
  CREATE TABLE doc_case_roots (
    case_id TEXT PRIMARY KEY, area TEXT NOT NULL, letter TEXT NOT NULL, folder_name TEXT NOT NULL,
    folder_key TEXT NOT NULL, birth_key TEXT NOT NULL, storage_relpath TEXT NOT NULL,
    root_source TEXT NOT NULL DEFAULT 'generated',
    updated_at TEXT NOT NULL DEFAULT ''
  );
`);
const insertCase = db.prepare('INSERT INTO cases (id, label, stammdaten_json, archived) VALUES (?, ?, ?, ?)');
insertCase.run('case-a', 'Müller, Ada', JSON.stringify({
  person: { lastName: 'Müller', firstName: 'Ada', birthDate: '03.04.1980' }
}), 0);
insertCase.run('case-b', 'Müller, Ada', JSON.stringify({
  person: { lastName: 'Müller', firstName: 'Ada', birthDate: '04.05.1981' }
}), 0);
insertCase.run('case-c', 'Alt, Anton', JSON.stringify({
  person: { lastName: 'Alt', firstName: 'Anton', birthDate: '01.01.1950' }
}), 1);

const storage = createDocumentStorage({ db, dataRoot, readConfig: () => ({}) });
const configuredRoot = path.join(temp, 'lesbarer-speicher');
const configuredLegacy = path.join(temp, 'alter-blobort');
const configuredStorage = createDocumentStorage({
  db,
  dataRoot,
  readConfig: () => ({
    storageRoot: configuredRoot,
    legacyBaseDir: configuredLegacy,
    caseDirs: { 'case-a': path.join(temp, 'alter-fallort') }
  })
});
assert.strictEqual(configuredStorage.root(), configuredRoot);
assert.deepStrictEqual(configuredStorage.legacyRoots({ area: 'case', case_id: 'case-a' }), [
  path.join(temp, 'alter-fallort'),
  configuredLegacy,
  path.join(dataRoot, 'files')
]);
assert.ok(!configuredStorage.legacyRoots({ area: 'office', case_id: '' }).includes(configuredRoot),
  'Neue Baumwurzel darf nicht als alter UUID-Blobort behandelt werden.');
assert.deepStrictEqual(
  overlappingRoot(path.join(temp, 'data', 'Dokumentenspeicher'), [path.join(temp, 'data')]),
  {
    storageRoot: path.join(temp, 'data', 'Dokumentenspeicher'),
    candidate: path.join(temp, 'data')
  },
  'Auch die effektive Standardwurzel muss gegen übergeordnete Altorte geprüft werden.'
);
assert.strictEqual(
  overlappingRoot(configuredRoot, [configuredLegacy, path.join(temp, 'alter-fallort')]),
  null,
  'Getrennte Klarname- und Alt-Wurzeln dürfen verwendet werden.'
);
const layout = storage.ensureCaseLayout('case-a', 7);
assert.strictEqual(layout.registers.length, 13);
assert.deepStrictEqual(layout.registers, taxonomy.fallanlageOrdner());
assert.match(layout.caseRoot.storageRelpath, /^Fallakten\/M\/Müller, Ada 800403$/);
assert.ok(fs.existsSync(path.join(storage.root(), layout.caseRoot.storageRelpath, '12 - Abschluss & Herausgabe')));
assert.ok(!fs.existsSync(path.join(storage.root(), layout.caseRoot.storageRelpath, '01 - Stammdaten', 'Ausweise & Urkunden')),
  'Unterordner muessen bis zur ersten Datei lazy bleiben.');

const archive = storage.caseRootInfo('case-c', true);
assert.strictEqual(archive.storageRelpath, 'Fallakten-Archiv/Alt, Anton');
const finderArchiveRelpath = 'Fallakten-Archiv/Eigene Archivakte';
fs.renameSync(
  path.join(storage.root(), archive.storageRelpath),
  path.join(storage.root(), finderArchiveRelpath)
);
db.prepare(`
  UPDATE doc_case_roots
     SET folder_name='Eigene Archivakte', folder_key='eigene archivakte',
         storage_relpath=?, root_source='finder'
   WHERE case_id='case-c'
`).run(finderArchiveRelpath);
assert.strictEqual(storage.caseRootInfo('case-c', false).storageRelpath, finderArchiveRelpath);
storage.ensureCaseLayout('case-c', 7);
storage.syncAllCaseRoots();
assert.strictEqual(storage.caseRootInfo('case-c', false).storageRelpath, finderArchiveRelpath,
  'Finder-Fallwurzel muss auch nach Layout-/Synchronisationsläufen maßgeblich bleiben.');
assert.strictEqual(fs.existsSync(path.join(storage.root(), archive.storageRelpath)), false);

const folder = db.prepare("SELECT * FROM doc_folders WHERE case_id='case-a' AND name='00 - Eingang'").get();
const placed = storage.placeBuffer({
  id: 'file-1', area: 'case', case_id: 'case-a', folder_id: folder.id,
  name: 'A:B?.pdf', mime_type: 'application/pdf'
}, Buffer.from('eins'));
assert.strictEqual(placed.name, 'A_B_.pdf');
assert.strictEqual(fs.readFileSync(placed.filePath, 'utf8'), 'eins');
assert.ok(fs.existsSync(storage.sidecarPath(placed.filePath, 'file-1')));
const placedSidecar = JSON.parse(fs.readFileSync(storage.sidecarPath(placed.filePath, 'file-1'), 'utf8'));
assert.strictEqual(placedSidecar.case, 'Müller, Ada');
assert.strictEqual(placedSidecar.sha256.length, 64);

const versionCopy = storage.copyToManagement({
  id: 'version-copy-ok',
  area: 'case',
  case_id: 'case-a',
  folder_id: folder.id,
  name: placed.name,
  mime_type: 'application/pdf',
  storage_relpath: placed.storageRelpath
}, 'Versionen', 'file-1', 'Version eins.pdf');
assert.equal(fs.readFileSync(versionCopy.filePath, 'utf8'), 'eins');
assert.equal(fs.readFileSync(placed.filePath, 'utf8'), 'eins',
  'Versionssicherung darf die Primärdatei nicht mehr wegbewegen.');

const blockedVersionDir = path.join(
  storage.root(), 'Büroorganisation', '_Verwaltung & Sicherungen', '_Technik',
  'Versionen', 'Fall-case-a', 'file-1-blocked'
);
fs.mkdirSync(path.join(blockedVersionDir, '.ablage-version-copy-blocked.json'), { recursive: true });
assert.throws(() => storage.copyToManagement({
  id: 'version-copy-blocked',
  area: 'case',
  case_id: 'case-a',
  folder_id: folder.id,
  name: placed.name,
  mime_type: 'application/pdf',
  storage_relpath: placed.storageRelpath
}, 'Versionen', 'file-1-blocked', 'Version blockiert.pdf'));
assert.equal(fs.readFileSync(placed.filePath, 'utf8'), 'eins',
  'Auch ein Sidecarfehler der Versionskopie muss die Primärdatei erhalten.');

const failedFilePath = path.join(path.dirname(placed.filePath), 'Sidecar Fehler.pdf');
const blockedSidecar = storage.sidecarPath(failedFilePath, 'file-sidecar-fail');
fs.mkdirSync(blockedSidecar);
assert.throws(() => storage.placeBuffer({
  id: 'file-sidecar-fail', area: 'case', case_id: 'case-a', folder_id: folder.id,
  name: 'Sidecar Fehler.pdf', mime_type: 'application/pdf'
}, Buffer.from('darf nicht liegen bleiben')));
assert.ok(!fs.existsSync(failedFilePath),
  'Ein fehlgeschlagener Beipackzettel darf keine physische Waise hinterlassen.');
assert.ok(fs.statSync(blockedSidecar).isDirectory(),
  'Ein fremder kollidierender Ordner darf beim Aufräumen nicht entfernt werden.');

const nfd = 'Bericht A\u0308.pdf';
const placedNfc = storage.placeBuffer({
  id: 'file-2', area: 'case', case_id: 'case-a', folder_id: folder.id,
  name: nfd, mime_type: 'application/pdf'
}, Buffer.from('zwei'));
assert.strictEqual(placedNfc.name, 'Bericht Ä.pdf');

const collision = storage.placeBuffer({
  id: 'file-3', area: 'case', case_id: 'case-a', folder_id: folder.id,
  name: 'bericht ä.pdf', mime_type: 'application/pdf'
}, Buffer.from('drei'));
assert.strictEqual(collision.name, 'bericht ä (2).pdf');
assert.ok(collision.adjustments.some((item) => item.code === 'kollision'));

const long = storage.placeBuffer({
  id: 'file-4', area: 'case', case_id: 'case-a', folder_id: folder.id,
  name: 'ä'.repeat(300) + '.pdf', mime_type: 'application/pdf'
}, Buffer.from('lang'));
assert.ok(Buffer.byteLength(long.name, 'utf8') <= 255);
assert.ok(long.name.endsWith('.pdf'));

const legacyDir = path.join(dataRoot, 'files');
fs.mkdirSync(legacyDir, { recursive: true });
fs.writeFileSync(path.join(legacyDir, 'legacy-id-a1b2.pdf'), 'alt');
assert.strictEqual(storage.findBlobPath({ id: 'legacy-id', area: 'office', case_id: '' }),
  path.join(legacyDir, 'legacy-id-a1b2.pdf'));

assert.throws(() => safeRelative('../ausbruch'), /verlässt/);
const outside = path.join(temp, 'outside');
fs.mkdirSync(outside);
const linked = path.join(storage.root(), 'Büroorganisation', 'Link');
try {
  fs.symlinkSync(outside, linked);
  db.prepare(`
    INSERT INTO doc_folders
      (id, area, case_id, parent_id, name, name_key, storage_relpath)
    VALUES ('link-folder', 'office', '', '', 'Link', 'link', '')
  `).run();
  assert.throws(() => storage.folderRelpath('office', '', 'link-folder', true), /Symbolische|Ordner/);
} catch (error) {
  if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
}

db.close();
fs.rmSync(temp, { recursive: true, force: true });
console.log('document-storage: ok');
