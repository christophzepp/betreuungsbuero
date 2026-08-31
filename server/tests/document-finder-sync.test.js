'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createDocumentFinderSync } = require('../src/modules/documents/finder-sync');
const { createDocumentStorage } = require('../src/modules/documents/storage');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'document-finder-sync-'));
const root = path.join(temp, 'Dokumentenspeicher');
const activeCase = path.join(root, 'Fallakten', 'M', 'Müller, Erika');
const archiveCase = path.join(root, 'Fallakten-Archiv', 'Schmidt, Karl');
const office = path.join(root, 'Büroorganisation');
for (const directory of [
  activeCase,
  archiveCase,
  office
]) fs.mkdirSync(directory, { recursive: true });

const db = new Database(path.join(temp, 'fixture.sqlite3'));
db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE cases (
    id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '',
    stammdaten_json TEXT NOT NULL DEFAULT '{}', archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE doc_folders (
    id TEXT PRIMARY KEY, area TEXT NOT NULL DEFAULT 'case', case_id TEXT NOT NULL DEFAULT '',
    parent_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', name_key TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0, storage_relpath TEXT NOT NULL DEFAULT '',
    storage_dev TEXT NOT NULL DEFAULT '', storage_ino TEXT NOT NULL DEFAULT '',
    storage_status TEXT NOT NULL DEFAULT 'legacy', last_seen_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', created_by INTEGER
  );
  CREATE TABLE doc_files (
    id TEXT PRIMARY KEY, area TEXT NOT NULL DEFAULT 'case', case_id TEXT NOT NULL DEFAULT '',
    folder_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', name_key TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, pages INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '', ocr_status TEXT NOT NULL DEFAULT 'none',
    deleted_at TEXT NOT NULL DEFAULT '', deleted_from TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
    storage_relpath TEXT NOT NULL DEFAULT '', storage_dev TEXT NOT NULL DEFAULT '',
    storage_ino TEXT NOT NULL DEFAULT '', storage_status TEXT NOT NULL DEFAULT 'legacy',
    last_seen_at TEXT NOT NULL DEFAULT '', managed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE doc_case_roots (
    case_id TEXT PRIMARY KEY REFERENCES cases(id), area TEXT NOT NULL DEFAULT 'Fallakten',
    letter TEXT NOT NULL DEFAULT '', folder_name TEXT NOT NULL DEFAULT '',
    folder_key TEXT NOT NULL DEFAULT '', birth_key TEXT NOT NULL DEFAULT '',
    storage_relpath TEXT NOT NULL DEFAULT '', root_source TEXT NOT NULL DEFAULT 'generated',
    updated_at TEXT NOT NULL DEFAULT ''
  );
`);
db.prepare('INSERT INTO cases VALUES (?,?,?,0)').run(
  'case-1', 'Müller, Erika',
  JSON.stringify({ person: { lastName: 'Müller', firstName: 'Erika' } })
);
db.prepare('INSERT INTO cases VALUES (?,?,?,1)').run(
  'case-2', 'Schmidt, Karl',
  JSON.stringify({ person: { lastName: 'Schmidt', firstName: 'Karl' } })
);
db.prepare('INSERT INTO doc_case_roots VALUES (?,?,?,?,?,?,?,?,?)').run(
  'case-1', 'Fallakten', 'M', 'Müller, Erika', 'müller, erika', '',
  'Fallakten/M/Müller, Erika', 'generated', ''
);
db.prepare('INSERT INTO doc_case_roots VALUES (?,?,?,?,?,?,?,?,?)').run(
  'case-2', 'Fallakten-Archiv', '', 'Schmidt, Karl', 'schmidt, karl', '',
  'Fallakten-Archiv/Schmidt, Karl', 'generated', ''
);

fs.writeFileSync(
  path.join(activeCase, '.ablage-fall.json'),
  JSON.stringify({ format: 'Betreuungsbüro-Fallordner/1', caseId: 'case-1', folder: 'veraltet' })
);

const register = path.join(activeCase, '00 - Eingang');
const newFolder = path.join(register, 'Neue Ablage');
fs.mkdirSync(newFolder, { recursive: true });
const invalidRegister = path.join(activeCase, '13 - Freie Ablage');
fs.mkdirSync(invalidRegister, { recursive: true });
fs.writeFileSync(path.join(invalidRegister, 'Nicht importieren.txt'), 'außerhalb der Taxonomie\n');
const nfdName = 'Besta\u0308tigung.pdf';
fs.writeFileSync(path.join(newFolder, nfdName), 'NFD\n');
fs.writeFileSync(path.join(newFolder, 'A:B?.pdf'), 'Windows-Zeichen\n');
fs.writeFileSync(path.join(newFolder, 'Bericht.pdf'), 'Gross\n');
fs.writeFileSync(path.join(newFolder, 'bericht.PDF'), 'Klein\n');
const longPhysicalName = 'ü'.repeat(100) + '.txt';
fs.writeFileSync(path.join(newFolder, longPhysicalName), 'Lang\n');

const archiveRegister = path.join(archiveCase, '12 - Abschluss & Herausgabe');
fs.mkdirSync(archiveRegister, { recursive: true });
fs.writeFileSync(path.join(archiveRegister, '260101 Übergabe.txt'), 'Archiv\n');
const officeFolder = path.join(office, 'Freie Ablage');
fs.mkdirSync(officeFolder, { recursive: true });
fs.writeFileSync(path.join(officeFolder, 'Notiz.txt'), 'Büro\n');
const canonicalReference = path.join(officeFolder, 'Kanonisch.bin');
fs.writeFileSync(canonicalReference, 'kanonischer-inhalt');
const canonicalReferenceBytes = fs.readFileSync(canonicalReference);
const canonicalReferenceSha = crypto.createHash('sha256')
  .update(canonicalReferenceBytes).digest('hex');
const canonicalReferenceStat = fs.statSync(canonicalReference);
const canonicalReferenceId = 'canonical-reference-1';
db.prepare(`
  INSERT INTO doc_files
    (id, area, case_id, folder_id, name, name_key, mime_type, size, sha256,
     storage_relpath, storage_dev, storage_ino, storage_status)
  VALUES (?, 'office', '', '', ?, ?, 'application/octet-stream', ?, ?, ?, ?, ?, 'ok')
`).run(
  canonicalReferenceId,
  'Kanonisch.bin',
  'kanonisch.bin',
  canonicalReferenceBytes.length,
  canonicalReferenceSha,
  'Büroorganisation/Freie Ablage/Kanonisch.bin',
  String(canonicalReferenceStat.dev),
  String(canonicalReferenceStat.ino)
);

const managementOrphans = path.join(office, '_Verwaltung & Sicherungen', '_Technik', 'Waisen', 'files');
const managementReports = path.join(office, '_Verwaltung & Sicherungen', '_Technik', 'Umstellungsberichte');
fs.mkdirSync(managementOrphans, { recursive: true });
fs.mkdirSync(managementReports, { recursive: true });
const acknowledgedOrphan = path.join(managementOrphans, 'orphan-known.bin');
fs.writeFileSync(acknowledgedOrphan, 'bekannte-waise');
const acknowledgedBytes = fs.readFileSync(acknowledgedOrphan);
const acknowledgedSha = crypto.createHash('sha256').update(acknowledgedBytes).digest('hex');
fs.writeFileSync(
  path.join(managementOrphans, `.ablage-waise-${acknowledgedSha.slice(0, 16)}-1234abcd.json`),
  JSON.stringify({
    format: 'Betreuungsbüro-Waise/1',
    originalPath: 'orphan-known',
    sourceRoot: 'files',
    storedPath: 'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Waisen/files/orphan-known.bin',
    size: acknowledgedBytes.length,
    sha256: acknowledgedSha,
    migratedAt: '2026-07-28T12:00:00.000Z'
  })
);
fs.writeFileSync(
  path.join(
    managementOrphans,
    `.ablage-waise-${canonicalReferenceSha.slice(0, 16)}-deadd001.json`
  ),
  JSON.stringify({
    format: 'Betreuungsbüro-Waise/1',
    originalPath: 'duplicate-orphan.bin',
    sourceRoot: 'case-doku-photos',
    storedPath: 'Büroorganisation/Freie Ablage/Kanonisch.bin',
    canonicalFileId: canonicalReferenceId,
    deduplicated: true,
    size: canonicalReferenceBytes.length,
    sha256: canonicalReferenceSha,
    migratedAt: '2026-07-28T12:00:00.000Z'
  })
);
const unacknowledgedManagement = path.join(managementOrphans, 'unquittiert.bin');
fs.writeFileSync(unacknowledgedManagement, 'unquittiert');
const invalidAckTarget = path.join(managementOrphans, 'falsch-quittiert.bin');
fs.writeFileSync(invalidAckTarget, 'falsch');
const invalidAckSha = crypto.createHash('sha256').update(fs.readFileSync(invalidAckTarget)).digest('hex');
fs.writeFileSync(
  path.join(managementOrphans, `.ablage-waise-${invalidAckSha.slice(0, 16)}-feedbeef.json`),
  JSON.stringify({
    format: 'Betreuungsbüro-Waise/1',
    originalPath: 'falsch-quittiert.bin',
    sourceRoot: 'files',
    storedPath: 'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Waisen/files/falsch-quittiert.bin',
    size: fs.statSync(invalidAckTarget).size,
    sha256: '0'.repeat(64)
  })
);
const migrationReportBase = path.join(managementReports, 'Umstellung-2026-07-28-run');
fs.writeFileSync(migrationReportBase + '.json', JSON.stringify({
  format: 'Betreuungsbüro-Umstellungsbericht/1',
  runId: 'run-1',
  dryRun: false,
  status: 'complete',
  summary: { moved: 1 },
  entries: []
}));
fs.writeFileSync(migrationReportBase + '.txt', 'UMSTELLUNGSBERICHT DOKUMENTENSPEICHER\n');
const foreignManagementFile = path.join(managementReports, 'Fremde-Datei.txt');
fs.writeFileSync(foreignManagementFile, 'kein technischer Bericht');
const adminSnapshot = path.join(office, '_Verwaltung & Sicherungen', 'Sicherheit.json.enc');
fs.writeFileSync(adminSnapshot, 'verschluesselt-neu');
const adminSnapshotStat = fs.statSync(adminSnapshot);
db.prepare(`
  INSERT INTO doc_files
    (id, area, case_id, folder_id, name, name_key, mime_type, size, sha256,
     storage_relpath, storage_dev, storage_ino, storage_status, managed)
  VALUES
    ('managed-admin-file', 'management', '', '', 'Sicherheit.json.enc',
     'sicherheit.json.enc', 'application/json', 5, '',
     'Büroorganisation/_Verwaltung & Sicherungen/Sicherheit.json.enc',
     ?, ?, 'ok', 1),
    ('missing-admin-file', 'management', '', '', 'Zugangsdaten.json.enc',
     'zugangsdaten.json.enc', 'application/json', 7, '',
     'Büroorganisation/_Verwaltung & Sicherungen/Zugangsdaten.json.enc',
     '', '', 'ok', 1)
`).run(String(adminSnapshotStat.dev), String(adminSnapshotStat.ino));
const managedCaseFile = path.join(register, 'Automatische Sicherung.json');
fs.writeFileSync(managedCaseFile, '{"stand":2}\n');
const managedCaseStat = fs.statSync(managedCaseFile);
db.prepare(`
  INSERT INTO doc_files
    (id, area, case_id, folder_id, name, name_key, mime_type, size, sha256,
     storage_relpath, storage_dev, storage_ino, storage_status, managed)
  VALUES
    ('managed-case-file', 'case', 'case-1', '', 'Automatische Sicherung.json',
     'automatische sicherung.json', 'application/json', 5, '', ?,
     ?, ?, 'ok', 1)
`).run(
  'Fallakten/M/Müller, Erika/00 - Eingang/Automatische Sicherung.json',
  String(managedCaseStat.dev),
  String(managedCaseStat.ino)
);

fs.mkdirSync(path.join(root, 'Unbekannt'), { recursive: true });
fs.writeFileSync(path.join(root, 'Unbekannt', 'sichtbar.bin'), 'unbekannt außerhalb');
fs.mkdirSync(path.join(root, 'Fallakten', 'AA'), { recursive: true });
fs.mkdirSync(path.join(root, 'Fallakten', 'Z', 'Unbekannter Fall'), { recursive: true });
try {
  fs.symlinkSync(path.join(newFolder, 'Bericht.pdf'), path.join(newFolder, 'Verknüpfung.pdf'));
} catch (_error) {
  // Auf Plattformen ohne Symlink-Recht bleibt nur dieser einzelne Befund ungetestet.
}

let sequence = 0;
const sync = createDocumentFinderSync({
  db,
  root,
  now: () => new Date('2026-07-28T12:00:00.000Z'),
  idFactory: () => `finder-${String(++sequence).padStart(3, '0')}`,
  writeSidecars: true
});

const beforeCounts = {
  folders: db.prepare('SELECT count(*) AS n FROM doc_folders').get().n,
  files: db.prepare('SELECT count(*) AS n FROM doc_files').get().n
};
const scanned = sync.scan();
assert.equal(db.prepare('SELECT count(*) AS n FROM doc_folders').get().n, beforeCounts.folders,
  'scan() darf keine Ordnerzeile schreiben');
assert.equal(db.prepare('SELECT count(*) AS n FROM doc_files').get().n, beforeCounts.files,
  'scan() darf keine Dateizeile schreiben');
assert.ok(scanned.summary.counts.new_folder >= 4);
assert.ok(scanned.summary.counts.new_file >= 6, JSON.stringify(scanned.summary));
assert.ok(scanned.summary.counts.name_adjustment >= 2);
const physicalCollisionPossible = fs.readdirSync(newFolder).filter((name) =>
  name.toLocaleLowerCase('de-DE') === 'bericht.pdf'
).length === 2;
if (physicalCollisionPossible) assert.ok(scanned.summary.counts.filesystem_collision >= 1);
assert.ok(scanned.summary.counts.unknown_top_level >= 1);
assert.ok(scanned.summary.counts.invalid_letter_level >= 1);
assert.ok(scanned.summary.counts.unknown_case_root >= 1);
assert.ok(scanned.summary.counts.invalid_case_register >= 1);
assert.ok(scanned.findings.some((item) => (
  item.kind === 'invalid_case_register'
  && item.storageRelpath === 'Fallakten/M/Müller, Erika/13 - Freie Ablage'
)));
assert.equal(scanned.files.some((item) => item.storageRelpath.endsWith('/Nicht importieren.txt')), false,
  'Inhalte eines nicht kanonischen Top-Level-Registers dürfen nicht eingelesen werden');
assert.equal(scanned.summary.management.acknowledgedOrphans, 2);
assert.equal(scanned.summary.management.acknowledgedOrphanReferences, 1);
assert.equal(scanned.summary.management.technicalFiles, 2);
assert.equal(scanned.summary.management.unknownFiles, 3);
assert.ok(scanned.findings.some((item) => (
  item.kind === 'unknown_management_file'
  && item.storageRelpath === 'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Waisen/files/unquittiert.bin'
)));
assert.ok(scanned.findings.some((item) => (
  item.kind === 'unknown_management_file'
  && item.storageRelpath === 'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Waisen/files/falsch-quittiert.bin'
)));
assert.ok(scanned.findings.some((item) => (
  item.kind === 'unknown_management_file'
  && item.storageRelpath === 'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Umstellungsberichte/Fremde-Datei.txt'
)));
assert.ok(scanned.findings.some((item) => (
  item.kind === 'orphan_ack_invalid'
  && item.detail.problems.includes('sha256_mismatch')
)));
assert.equal(scanned.findings.some((item) => (
  item.storageRelpath === 'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Waisen/files/orphan-known.bin'
)), false, 'quittierte Waise darf nicht erneut als unbekannt erscheinen');
assert.equal(scanned.findings.some((item) => (
  item.kind === 'orphan_ack_invalid'
  && item.storageRelpath.includes('deadd001')
)), false, 'geprüfter Waisenverweis auf indexierte Nutzdaten muss gültig bleiben');
assert.equal(scanned.findings.some((item) => (
  item.storageRelpath.startsWith('Büroorganisation/_Verwaltung & Sicherungen/_Technik/Umstellungsberichte/Umstellung-2026-07-28-run')
)), false, 'gültiges technisches Berichtspaar darf nicht als unbekannt erscheinen');
assert.equal(scanned.files.some((item) => item.storageRelpath.startsWith('Büroorganisation/_Verwaltung & Sicherungen/')), false,
  'Die geschützte Verwaltung darf nie Teil des automatischen Imports sein');
assert.ok(scanned.findings.some((item) => (
  item.kind === 'managed_file_changed'
  && item.detail.fileId === 'managed-case-file'
  && item.detail.automaticApply === false
)), 'Verwaltete Fallabbilder müssen als bestätigungspflichtig gemeldet werden');
assert.ok(scanned.findings.some((item) => (
  item.kind === 'management_indexed_file_changed'
  && item.detail.fileId === 'managed-admin-file'
  && item.detail.automaticApply === false
)), 'Veränderte Verwaltungsabbilder müssen bestätigt werden');
assert.ok(scanned.findings.some((item) => (
  item.kind === 'management_indexed_file_missing'
  && item.detail.fileId === 'missing-admin-file'
  && item.detail.automaticApply === false
)), 'Fehlende Verwaltungsabbilder müssen sichtbar gemeldet werden');
if (fs.existsSync(path.join(newFolder, 'Verknüpfung.pdf'))) {
  assert.ok(scanned.summary.counts.symlink_ignored >= 1);
}

const applied = sync.apply(scanned);
assert.equal(applied.ok, true, JSON.stringify(applied.errors));
assert.ok(applied.foldersInserted >= 4);
assert.ok(applied.filesInserted >= 6);
assert.equal(
  db.prepare("SELECT count(*) AS n FROM doc_files WHERE storage_relpath LIKE 'Büroorganisation/_Verwaltung & Sicherungen/%'").get().n,
  2,
  'Apply darf Verwaltungsabbilder weder importieren noch aus dem Index entfernen'
);
assert.equal(
  db.prepare("SELECT size FROM doc_files WHERE id='managed-case-file'").get().size,
  5,
  'Apply darf ein verwaltetes Fallabbild nicht automatisch in den Index übernehmen'
);
assert.equal(
  JSON.parse(fs.readFileSync(path.join(activeCase, '.ablage-fall.json'), 'utf8')).folder,
  'Fallakten/M/Müller, Erika'
);
const caseFolderNames = db.prepare(
  "SELECT name FROM doc_folders WHERE area='case' AND case_id='case-1' ORDER BY storage_relpath"
).all().map((row) => row.name);
assert.ok(caseFolderNames.includes('00 - Eingang'));
assert.ok(caseFolderNames.includes('Neue Ablage'));
assert.equal(caseFolderNames.includes('M'), false, 'Buchstabenebene darf kein doc_folder sein');
assert.equal(caseFolderNames.includes('Müller, Erika'), false, 'Fallroot darf kein doc_folder sein');

const inserted = db.prepare("SELECT * FROM doc_files WHERE case_id='case-1' ORDER BY storage_relpath").all();
const nfdRow = inserted.find((row) => row.storage_relpath.endsWith(nfdName));
assert.ok(nfdRow);
assert.equal(nfdRow.name, 'Bestätigung.pdf');
assert.ok(nfdRow.storage_relpath.includes(nfdName), 'storage_relpath muss den tatsächlichen NFD-Pfad behalten');
const invalidRow = inserted.find((row) => row.storage_relpath.endsWith('A:B?.pdf'));
assert.equal(invalidRow.name, 'A_B_.pdf');
const collisionNames = inserted.filter((row) => /[Bb]ericht/.test(row.storage_relpath)).map((row) => row.name);
if (physicalCollisionPossible) {
  assert.equal(new Set(collisionNames.map((name) => name.toLocaleLowerCase('de-DE'))).size, 2);
  assert.ok(collisionNames.some((name) => /\(2\)/.test(name)));
}
const collisionReserved = new Set();
sync._test.uniqueObservedName('Bericht.pdf', collisionReserved);
const syntheticCollision = sync._test.uniqueObservedName('bericht.PDF', collisionReserved);
assert.ok(syntheticCollision.adjustments.some((reason) => reason.code === 'kollision'));
const longRow = inserted.find((row) => row.storage_relpath.endsWith(longPhysicalName));
assert.ok(Buffer.byteLength(longRow.name, 'utf8') <= 255);
assert.equal(longRow.storage_relpath.endsWith(longPhysicalName), true);

const syntheticLong = sync._test.uniqueObservedName('ü'.repeat(300) + '.pdf', new Set());
assert.ok(Buffer.byteLength(syntheticLong.name, 'utf8') <= 255);
assert.ok(syntheticLong.adjustments.some((reason) => reason.code === 'utf8_bytegrenze'));

const moveRow = nfdRow;
const movedFolder = path.join(register, 'Finder umbenannt');
for (const entry of fs.readdirSync(newFolder)) {
  if (entry.startsWith('.ablage-folder-')) fs.unlinkSync(path.join(newFolder, entry));
}
fs.renameSync(newFolder, movedFolder);
const movedFile = path.join(movedFolder, 'Umbenannt.pdf');
fs.renameSync(path.join(movedFolder, nfdName), movedFile);
const afterFinderMove = sync.scan();
const folderMoveFinding = afterFinderMove.findings.find((item) =>
  item.kind === 'folder_changed' && item.storageRelpath.endsWith('Finder umbenannt')
);
assert.ok(folderMoveFinding, 'Ordner-Rename muss erkannt werden');
assert.ok(
  folderMoveFinding.detail.matchedByFolderInode || folderMoveFinding.detail.inferredByFileInode,
  'Ordner-Rename muss über Ordner- oder Datei-Inode identifiziert werden'
);
const fileMoveFinding = afterFinderMove.findings.find((item) =>
  item.kind === 'file_changed' && item.detail.fileId === moveRow.id
);
assert.ok(fileMoveFinding && fileMoveFinding.detail.moved, 'Datei-Rename/Move per Inode fehlt');

const moveApplied = sync.apply(afterFinderMove);
assert.equal(moveApplied.ok, true, JSON.stringify(moveApplied.errors));
const movedRow = db.prepare('SELECT * FROM doc_files WHERE id=?').get(moveRow.id);
assert.ok(movedRow.storage_relpath.endsWith('/Finder umbenannt/Umbenannt.pdf'));
assert.equal(movedRow.name, 'Umbenannt.pdf');
const movedSidecar = JSON.parse(
  fs.readFileSync(path.join(movedFolder, `.ablage-${moveRow.id}.json`), 'utf8')
);
assert.equal(movedSidecar.path, movedRow.storage_relpath);
assert.equal(movedSidecar.name, 'Umbenannt.pdf');
assert.ok(moveApplied.sidecarsUpdated >= 1, 'eigener Sidecar muss nach Finder-Rename aktualisiert werden');
const movedFolderRow = db.prepare(
  "SELECT * FROM doc_folders WHERE case_id='case-1' AND name='Finder umbenannt'"
).get();
assert.ok(movedFolderRow);
assert.ok(movedFolderRow.storage_relpath.endsWith('/Finder umbenannt'));

fs.unlinkSync(movedFile);
const afterDelete = sync.scan();
const missing = afterDelete.findings.find((item) =>
  item.kind === 'missing_file' && item.detail.fileId === moveRow.id
);
assert.ok(missing, 'Finder-Löschung muss als fehlend gemeldet werden');
const deletedAtBefore = db.prepare('SELECT deleted_at FROM doc_files WHERE id=?').get(moveRow.id).deleted_at;
sync.apply(afterDelete);
assert.equal(
  db.prepare('SELECT deleted_at FROM doc_files WHERE id=?').get(moveRow.id).deleted_at,
  deletedAtBefore,
  'fehlende Datei darf nicht automatisch auf gelöscht gesetzt werden'
);

const stableScan = sync.scan();
const stableApply = sync.apply(stableScan);
assert.equal(stableApply.foldersInserted, 0);
assert.equal(stableApply.filesInserted, 0);
assert.equal(stableApply.foldersUpdated, 0);
assert.equal(stableApply.filesUpdated, 0);
assert.ok(stableApply.sidecarsSkipped > 0, 'vorhandene Sidecars müssen erhalten bleiben');

const finderCase = path.join(root, 'Fallakten', 'M', 'Eigene Akte');
fs.renameSync(activeCase, finderCase);
const rootMoveScan = sync.scan();
assert.ok(rootMoveScan.findings.some((item) => (
  item.kind === 'case_root_moved'
  && item.storageRelpath === 'Fallakten/M/Eigene Akte'
)));
const rootMoveApply = sync.apply(rootMoveScan);
assert.equal(rootMoveApply.ok, true, JSON.stringify(rootMoveApply.errors));
const finderRootRow = db.prepare("SELECT * FROM doc_case_roots WHERE case_id='case-1'").get();
assert.equal(finderRootRow.storage_relpath, 'Fallakten/M/Eigene Akte');
assert.equal(finderRootRow.root_source, 'finder');

const durableStorage = createDocumentStorage({
  db,
  dataRoot: temp,
  readConfig: () => ({ storageRoot: root })
});
assert.equal(durableStorage.caseRootInfo('case-1', false).storageRelpath, 'Fallakten/M/Eigene Akte');
durableStorage.ensureCaseLayout('case-1', 1);
durableStorage.syncAllCaseRoots();
assert.equal(durableStorage.caseRootInfo('case-1', false).storageRelpath, 'Fallakten/M/Eigene Akte');
assert.equal(fs.existsSync(path.join(root, 'Fallakten', 'M', 'Müller, Erika')), false,
  'Ein späterer Storage-Lauf darf die berechnete Alt-Wurzel nicht erneut anlegen');

for (const row of db.prepare("SELECT * FROM doc_files WHERE deleted_at=''").all()) {
  if (row.id === moveRow.id || Number(row.managed || 0) === 1) continue;
  const actual = path.join(root, ...row.storage_relpath.split('/'));
  assert.ok(fs.existsSync(actual), `Indexpfad fehlt: ${row.storage_relpath}`);
  assert.equal(String(fs.statSync(actual).dev), row.storage_dev);
  assert.equal(String(fs.statSync(actual).ino), row.storage_ino);
}

db.close();
fs.rmSync(temp, { recursive: true, force: true });
console.log('document-finder-sync: Scan, Apply, Finder-Moves, Regeln und Idempotenz ok');
