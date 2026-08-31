'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createDocumentStorage } = require('../src/modules/documents/storage');
const { createModuleFiles } = require('../src/modules/documents/module-files');
const names = require('../src/modules/documents/names');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'module-files-test-'));
const dataRoot = path.join(temp, 'data');
const db = new Database(':memory:');
db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE cases (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, stammdaten_json TEXT NOT NULL DEFAULT '{}',
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE doc_folders (
    id TEXT PRIMARY KEY, area TEXT NOT NULL, case_id TEXT NOT NULL DEFAULT '',
    parent_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, name_key TEXT NOT NULL DEFAULT '',
    storage_relpath TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT '',
    created_by INTEGER
  );
  CREATE TABLE doc_files (
    id TEXT PRIMARY KEY, area TEXT NOT NULL, case_id TEXT NOT NULL DEFAULT '',
    folder_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, name_key TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
    pages INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL DEFAULT '',
    ocr_status TEXT NOT NULL DEFAULT 'none', deleted_at TEXT NOT NULL DEFAULT '',
    deleted_from TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), created_by INTEGER,
    storage_relpath TEXT NOT NULL DEFAULT '', storage_dev TEXT NOT NULL DEFAULT '',
    storage_ino TEXT NOT NULL DEFAULT '', storage_status TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE doc_case_roots (
    case_id TEXT PRIMARY KEY, area TEXT NOT NULL, letter TEXT NOT NULL,
    folder_name TEXT NOT NULL, folder_key TEXT NOT NULL, birth_key TEXT NOT NULL,
    storage_relpath TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE doc_links (
    module TEXT NOT NULL, owner_id TEXT NOT NULL, slot TEXT NOT NULL DEFAULT '',
    file_id TEXT NOT NULL REFERENCES doc_files(id), detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY(module, owner_id, slot)
  );
  CREATE TABLE doc_module_import (
    quelle TEXT NOT NULL, quell_id TEXT NOT NULL, file_id TEXT NOT NULL DEFAULT '',
    imported_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(quelle, quell_id)
  );
`);
db.prepare('INSERT INTO cases VALUES (?,?,?,0)').run(
  'case-1',
  'Müller, Erika',
  JSON.stringify({ person: { lastName: 'Müller', firstName: 'Erika', birthDate: '03.02.1965' } })
);
db.prepare('INSERT INTO cases VALUES (?,?,?,0)').run(
  'case-duplicate-a',
  'Doppelt, Dana',
  JSON.stringify({ person: { lastName: 'Doppelt', firstName: 'Dana', birthDate: '01.01.1970' } })
);
db.prepare('INSERT INTO cases VALUES (?,?,?,0)').run(
  'case-duplicate-b',
  'Doppelt, Dana',
  JSON.stringify({ person: { lastName: 'Doppelt', firstName: 'Dana', birthDate: '02.02.1980' } })
);

const storage = createDocumentStorage({ db, dataRoot, readConfig: () => ({}) });
storage.ensureCaseLayout('case-1', 1);

function row(id) {
  return db.prepare('SELECT * FROM doc_files WHERE id=?').get(String(id)) || null;
}

function ensureFolder(area, caseId, segments) {
  let parentId = '';
  for (const raw of segments) {
    const name = names.normalisiereDateiname(raw).name;
    let folder = db.prepare(`
      SELECT * FROM doc_folders
       WHERE area=? AND case_id=? AND parent_id=? AND name_key=?
    `).get(area, caseId, parentId, names.vergleichsschluessel(name));
    if (!folder) {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO doc_folders
          (id,area,case_id,parent_id,name,name_key)
        VALUES (?,?,?,?,?,?)
      `).run(id, area, caseId, parentId, name, names.vergleichsschluessel(name));
      storage.folderRelpath(area, caseId, id, true);
      folder = db.prepare('SELECT * FROM doc_folders WHERE id=?').get(id);
      db.prepare('UPDATE doc_folders SET storage_relpath=? WHERE id=?')
        .run(storage.folderRelpath(area, caseId, id, false), id);
    }
    parentId = folder.id;
  }
  return parentId;
}

function applyPlaced(id, folderId, placed) {
  db.prepare(`
    UPDATE doc_files
       SET folder_id=?, name=?, name_key=?, size=?, sha256=?, storage_relpath=?,
           storage_dev=?, storage_ino=?, storage_status='physical'
     WHERE id=?
  `).run(
    folderId,
    placed.name,
    names.vergleichsschluessel(placed.name),
    placed.size,
    placed.sha256,
    placed.storageRelpath,
    placed.storageDev,
    placed.storageIno,
    id
  );
}

const documents = {
  ordnerSicherstellen: ensureFolder,
  dateiZeile: row,
  findBlobPath: (file) => storage.findBlobPath(file),
  dateiAblegen(area, caseId, folderId, filename, mimeType, bytes, createdBy) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO doc_files
        (id,area,case_id,folder_id,name,name_key,mime_type,size,created_by)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      id, area, caseId, folderId, filename, names.vergleichsschluessel(filename),
      mimeType, Buffer.byteLength(bytes), createdBy == null ? null : createdBy
    );
    const placed = storage.placeBuffer(row(id), bytes);
    applyPlaced(id, folderId, placed);
    storage.writeSidecar(row(id), placed.filePath);
    return { id, name: placed.name, adjustments: placed.adjustments };
  },
  dateiUmhaengen(file, area, caseId, folderId, filename) {
    const placed = storage.relocate(file, area, caseId, folderId, filename);
    db.prepare('UPDATE doc_files SET area=?,case_id=? WHERE id=?').run(area, caseId, file.id);
    applyPlaced(file.id, folderId, placed);
    storage.writeSidecar(row(file.id), placed.filePath);
    return placed;
  },
  dateiVerschieben(file, folderId, filename) {
    return this.dateiUmhaengen(file, file.area, file.case_id, folderId, filename);
  },
  dateiErsetzen() {
    throw new Error('In diesem Vertragstest nicht benötigt.');
  },
  dateiPapierkorb() {
    throw new Error('In diesem Vertragstest nicht benötigt.');
  }
};

const modules = createModuleFiles({ db, documents });
assert.strictEqual(modules.datedName('Bericht.pdf', '24.07.2026'), '260724 Bericht.pdf');
assert.deepStrictEqual(
  modules.target({ module: 'finance-receipt', date: '2026-07-24' }).folders,
  ['Finanzen', 'Belege', '2026', '07']
);
assert.deepStrictEqual(
  modules.target({ module: 'case-document', caseId: 'case-1', date: '2026-07-24' }).folders,
  ['11 - Betreuungsführung', 'Dokumentenausgang', '2026', '07']
);
assert.equal(modules.caseIdFor('', 'Müller, Erika'), 'case-1',
  'ein eindeutiges Alt-Label bleibt kompatibel');
assert.equal(modules.caseIdFor('', 'Doppelt, Dana'), '',
  'ein mehrdeutiges Alt-Label darf nie den ersten Fall wählen');
assert.equal(modules.caseIdFor('case-duplicate-b', 'Müller, Erika'), 'case-duplicate-b',
  'eine gültige ausdrückliche ID ist auch bei widersprechendem Label autoritativ');
assert.throws(
  () => modules.caseIdFor('nicht-vorhanden', 'Müller, Erika'),
  /Fall-ID existiert nicht/,
  'eine ungültige ausdrückliche ID muss sichtbar scheitern'
);
assert.deepStrictEqual(
  modules.target({ module: 'inbox', caseLabel: 'Doppelt, Dana', date: '2026-07-24' }),
  {
    area: 'office', caseId: '', folders: ['Posteingang', '2026', '07'], date: '2026-07-24'
  }
);
assert.deepStrictEqual(
  modules.target({ module: 'todo-attachment', caseLabel: 'Doppelt, Dana', date: '2026-07-24' }),
  {
    area: 'office', caseId: '', folders: ['Termine & Aufgaben', '2026', '07'], date: '2026-07-24'
  }
);

const first = modules.store({
  module: 'case-document',
  ownerId: 'letter-1',
  caseId: 'case-1',
  filename: 'Schreiben.pdf',
  mimeType: 'application/pdf',
  date: '24.07.2026',
  bytes: Buffer.from('einmal zentral\n'),
  createdBy: 1
});
assert.strictEqual(first.name, '260724 Schreiben.pdf');
assert.match(first.row.storage_relpath, /11 - Betreuungsführung\/Dokumentenausgang\/2026\/07\/260724 Schreiben\.pdf$/);
assert.strictEqual(fs.readFileSync(first.filePath, 'utf8'), 'einmal zentral\n');

const reused = modules.store({
  module: 'case-document',
  ownerId: 'letter-1',
  caseId: 'case-1',
  filename: 'anderer-name.pdf',
  date: '2026-07-24',
  bytes: Buffer.from('darf nicht dupliziert werden')
});
assert.strictEqual(reused.reused, true);
assert.strictEqual(reused.id, first.id);
assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM doc_files').get().n, 1);

modules.linkExisting('case-document', 'letter-2', '', first.id, { shared: true });
assert.ok(modules.resolve('case-document', 'letter-2', '', false));
assert.strictEqual(modules.unlink('case-document', 'letter-1', ''), 1);
assert.ok(fs.existsSync(first.filePath), 'Das Entfernen eines Fachverweises darf die zentrale Datei nicht löschen.');
assert.ok(modules.resolve('case-document', 'letter-2', '', false));

const inbox = modules.store({
  module: 'inbox',
  ownerId: 'inbox-1',
  filename: 'Eingang.pdf',
  date: '2026-06-15',
  bytes: Buffer.from('posteingang\n')
});
assert.match(inbox.row.storage_relpath, /^Büroorganisation\/Posteingang\/2026\/06\//);
const beforeInode = fs.statSync(inbox.filePath).ino;
const moved = modules.moveTo({
  module: 'inbox',
  ownerId: 'inbox-1',
  slot: '',
  caseId: 'case-1',
  filename: 'Eingang.pdf',
  date: '2026-06-15',
  redate: true
});
assert.match(moved.row.storage_relpath, /\/00 - Eingang\/260615 Eingang\.pdf$/);
assert.strictEqual(fs.statSync(documents.findBlobPath(moved.row)).ino, beforeInode,
  'Die Modulzuordnung muss dieselbe physische Datei umhängen, nicht kopieren.');

storage.ensureCaseLayout('case-duplicate-a', 1);
storage.ensureCaseLayout('case-duplicate-b', 1);
const sharedPhotoId = 'historisch-geteilte-kennung';
const photoA = modules.store({
  module: 'doku-photo',
  ownerId: 'entry-a',
  slot: sharedPhotoId,
  area: 'case',
  caseId: 'case-duplicate-a',
  folders: ['11 - Betreuungsführung', 'Falldokumentation', '2026', '07', '260724 0900 Besuch'],
  filename: 'Foto A.jpg',
  keepName: true,
  mimeType: 'image/jpeg',
  bytes: Buffer.from('nur fall a')
});
const photoB = modules.store({
  module: 'doku-photo',
  ownerId: 'entry-b',
  slot: sharedPhotoId,
  area: 'case',
  caseId: 'case-duplicate-b',
  folders: ['11 - Betreuungsführung', 'Falldokumentation', '2026', '07', '260724 1000 Besuch'],
  filename: 'Foto B.jpg',
  keepName: true,
  mimeType: 'image/jpeg',
  bytes: Buffer.from('nur fall b')
});
assert.equal(
  modules.resolve('doku-photo', 'anderer-eintrag-a', sharedPhotoId, true, 'case-duplicate-a').row.id,
  photoA.id,
  'eine geteilte Fotokennung muss innerhalb desselben Falls aufgelöst werden'
);
assert.equal(
  modules.resolve('doku-photo', 'anderer-eintrag-b', sharedPhotoId, true, 'case-duplicate-b').row.id,
  photoB.id,
  'dieselbe historische Kennung in einem zweiten Fall darf nicht die zuerst gefundene Datei liefern'
);
assert.equal(
  modules.resolve('doku-photo', 'anderer-eintrag', sharedPhotoId, true, 'nicht-vorhandener-fall'),
  null
);
assert.equal(
  modules.resolve('doku-photo', 'anderer-eintrag', sharedPhotoId, true),
  null,
  'ein globaler Shared-Slot-Fallback ohne Fall-ID ist nicht zulässig'
);

db.close();
fs.rmSync(temp, { recursive: true, force: true });
console.log('module-files: zentrale Verweise und Zielpfade ok');
