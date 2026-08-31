'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const schema = require('../src/modules/documents/schema');
const { createDocumentStorage, sha256Buffer } = require('../src/modules/documents/storage');
const { createDocumentMigration } = require('../src/modules/documents/migration');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'document-migration-'));
const dataRoot = path.join(temp, 'data');
const reportRoot = path.join(temp, 'reports');
fs.mkdirSync(dataRoot, { recursive: true });
const db = new Database(path.join(temp, 'fixture.sqlite3'));

db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE cases (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    stammdaten_json TEXT NOT NULL DEFAULT '{}',
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE case_doku_entries (
    id TEXT PRIMARY KEY, case_id TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE inbox_documents (
    id TEXT PRIMARY KEY, file_name TEXT, mime_type TEXT, case_id TEXT, case_label TEXT,
    inbox_date TEXT, received_date TEXT, created_at TEXT, created_by INTEGER
  );
  CREATE TABLE finance_receipts (
    id TEXT PRIMARY KEY, filename TEXT, mime_type TEXT, invoice_date TEXT,
    uploaded_at TEXT, uploaded_by INTEGER
  );
  CREATE TABLE finance_statements (
    id TEXT PRIMARY KEY, filename TEXT, mime_type TEXT, uploaded_at TEXT, uploaded_by INTEGER
  );
  CREATE TABLE todos (
    id TEXT PRIMARY KEY, case_id TEXT, case_label TEXT, due_at TEXT, start_at TEXT, created_at TEXT,
    updated_at TEXT DEFAULT '', item_type TEXT DEFAULT '', source_type TEXT DEFAULT '',
    source_id TEXT DEFAULT '', source_module TEXT DEFAULT '', source_ref TEXT DEFAULT '',
    done INTEGER DEFAULT 0, title TEXT DEFAULT '', description TEXT DEFAULT '',
    priority TEXT DEFAULT '', recurrence_rule TEXT DEFAULT '', source TEXT DEFAULT '',
    updated_by INTEGER
  );
  CREATE TABLE todo_attachments (
    id TEXT PRIMARY KEY, todo_id TEXT, filename TEXT, mime_type TEXT, created_at TEXT, created_by INTEGER
  );
  CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY, case_id TEXT, case_label TEXT, start_at TEXT, created_at TEXT
  );
  CREATE TABLE calendar_event_attachments (
    id TEXT PRIMARY KEY, event_id TEXT, filename TEXT, mime_type TEXT, created_at TEXT, created_by INTEGER
  );
  CREATE TABLE office_profile (
    id INTEGER PRIMARY KEY, logo_filename TEXT, logo_mime_type TEXT, updated_at TEXT
  );
`);
schema.ensure(db);

db.prepare('INSERT INTO cases (id,label,stammdaten_json,archived) VALUES (?,?,?,0)').run(
  'case-1',
  'Müller, Erika',
  JSON.stringify({ person: { lastName: 'Müller', firstName: 'Erika', birthDate: '1965-02-03' } })
);
db.prepare('INSERT INTO cases (id,label,stammdaten_json,archived) VALUES (?,?,?,0)').run(
  'case-empty',
  'Einstein, Emil',
  JSON.stringify({ person: { lastName: 'Einstein', firstName: 'Emil', birthDate: '1940-01-02' } })
);

const oldFolder = 'folder-old';
db.prepare(`
  INSERT INTO doc_folders
    (id,area,case_id,parent_id,name,name_key,storage_relpath)
  VALUES (?,?,?,?,?,?,?)
`).run(oldFolder, 'case', 'case-1', '', '03 - Leistungsträger',
  '03 - leistungsträger', '');

const bytesOne = Buffer.from('gleiches-dokument\n');
const bytesTwo = Buffer.from('zweites-dokument\n');
db.prepare(`
  INSERT INTO doc_files
    (id,area,case_id,folder_id,name,mime_type,size,sha256,name_key)
  VALUES (?,?,?,?,?,?,?,?,?)
`).run('doc-1', 'case', 'case-1', oldFolder, 'A:B?.pdf', 'application/pdf',
  bytesOne.length, sha256Buffer(bytesOne), 'a:b?.pdf');
db.prepare(`
  INSERT INTO doc_files
    (id,area,case_id,folder_id,name,mime_type,size,sha256,name_key)
  VALUES (?,?,?,?,?,?,?,?,?)
`).run('doc-2', 'case', 'case-1', oldFolder, 'a:b?.PDF', 'application/pdf',
  bytesTwo.length, sha256Buffer(bytesTwo), 'a:b?.pdf');

function write(relative, bytes) {
  const target = path.join(dataRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return target;
}

write('files/doc-1', bytesOne);
write('files/doc-2-abcd.pdf', bytesTwo); // Legacy-Form mit Endung.
// Diese Waise ist bytegleich mit doc-1. Der Herkunftsbefund muss erhalten
// bleiben, die redundante Kopie aber nicht erneut 1:1 in _Verwaltung landen.
write('files/orphan-known', bytesOne);
write('files/orphan-other.bin', Buffer.from('zweite-waise\n'));

const sharedPhoto = Buffer.from('geteiltes-foto\n');
write('case-doku-photos/case-1/entry-a/photo-shared', sharedPhoto);
const dokuData = (date) => JSON.stringify({
  datum: date,
  type: 'Hausbesuch',
  photos: [{ id: 'photo-shared', filename: 'Besuchsfoto.jpg', mimeType: 'image/jpeg' }]
});
db.prepare('INSERT INTO case_doku_entries VALUES (?,?,?,?,?)').run(
  'entry-a', 'case-1', dokuData('15.06.2026'), '2026-07-24 13:52:00', ''
);
db.prepare('INSERT INTO case_doku_entries VALUES (?,?,?,?,?)').run(
  'entry-b', 'case-1', dokuData('15.06.2026'), '2026-07-24 13:53:00', ''
);

db.prepare(`
  INSERT INTO inbox_documents
    (id,file_name,mime_type,case_id,case_label,inbox_date,received_date,created_at,created_by)
  VALUES (?,?,?,?,?,?,?,?,?)
`).run(
  'inbox-1', 'Eingang.pdf', 'application/pdf', '', 'Müller, Erika',
  '2026-06-17', '2026-06-16', '2026-06-17', 1
);
write('inbox-documents/inbox-1', bytesOne); // Gleiche Datenblöcke, eigenständige logische Datei.
// Reale Altbestände können eine Importzuordnung behalten, obwohl die frühere
// Explorer-Datei bereits gelöscht oder ihre Zeile nicht mehr vorhanden ist.
// Die vorhandene Modulquelle muss dann sichtbar neu gebunden werden.
db.prepare(
  'INSERT INTO doc_module_import (quelle,quell_id,file_id) VALUES (?,?,?)'
).run('posteingang', 'inbox-1', 'missing-old-document');

db.prepare('INSERT INTO finance_receipts VALUES (?,?,?,?,?,?)').run(
  'receipt-1', 'Rechnung.pdf', 'application/pdf', '2026-06-19', '2026-06-20', 1
);
write('finance-receipts/receipt-1', Buffer.from('rechnung\n'));
db.prepare('INSERT INTO finance_statements VALUES (?,?,?,?,?)').run(
  'statement-1', 'Kontoauszug.pdf', 'application/pdf', '2026-06-30', 1
);
write('finance-statements/statement-1', Buffer.from('kontoauszug\n'));

db.prepare('INSERT INTO todos (id,case_id,case_label,due_at,start_at,created_at) VALUES (?,?,?,?,?,?)').run(
  'todo-1', 'case-1', 'Müller, Erika', '2026-06-22', '', '2026-06-20'
);
db.prepare('INSERT INTO todo_attachments VALUES (?,?,?,?,?,?)').run(
  'todo-att-1', 'todo-1', 'Aufgabe.txt', 'text/plain', '2026-06-20', 1
);
write('todo-attachments/todo-1/todo-att-1', Buffer.from('aufgabe\n'));

db.prepare(`
  INSERT INTO calendar_events (id,case_id,case_label,start_at,created_at)
  VALUES (?,?,?,?,?)
`).run(
  'event-1', '', 'Müller, Erika', '2026-06-21 10:00:00', '2026-06-18'
);
db.prepare('INSERT INTO calendar_event_attachments VALUES (?,?,?,?,?,?)').run(
  'cal-att-1', 'event-1', 'Termin.txt', 'text/plain', '2026-06-18', 1
);
write('calendar-event-attachments/event-1/cal-att-1', Buffer.from('termin\n'));

db.prepare('INSERT INTO office_profile VALUES (?,?,?,?)').run(
  1, 'logo-fixture.png', 'image/png', '2026-06-01'
);
write('office-logo/logo-fixture.png', Buffer.from('logo\n'));

const storage = createDocumentStorage({ db, dataRoot, readConfig: () => ({}) });
const migration = createDocumentMigration({
  db,
  dataRoot,
  storage,
  now: () => new Date('2026-07-28T12:00:00.000Z')
});

const guardedSource = write('guard/source.bin', Buffer.from('nicht-loeschen\n'));
const guardedTarget = path.join(temp, 'guard-target.bin');
assert.throws(
  () => migration._test.moveVerified(guardedSource, guardedTarget, '0'.repeat(64)),
  /Prüfsumme/
);
assert.ok(fs.existsSync(guardedSource), 'Quelle darf bei falscher Prüfsumme nicht verschwinden');
assert.equal(fs.existsSync(guardedTarget), false);
fs.unlinkSync(guardedSource);

function contentSnapshot() {
  const ignored = new Set(['fixture.sqlite3', 'fixture.sqlite3-wal', 'fixture.sqlite3-shm']);
  const rows = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const candidate = path.join(dir, entry.name);
      const relative = path.relative(dataRoot, candidate).split(path.sep).join('/');
      if (relative.startsWith('Dokumentenspeicher/Büroorganisation/_Verwaltung & Sicherungen/_Technik/Umstellungsberichte/')) continue;
      if (entry.isDirectory()) walk(candidate);
      else if (entry.isFile() && !ignored.has(entry.name)) {
        rows.push([relative, fs.readFileSync(candidate).toString('hex')]);
      }
    }
  }
  walk(dataRoot);
  return rows;
}

const beforeDry = contentSnapshot();
const dry = migration.run({ dryRun: true, reportDir: reportRoot });
assert.equal(dry.status, 'completed');
assert.equal(dry.summary.documents, 2);
assert.equal(dry.summary.modules, 7);
assert.equal(dry.summary.orphans, 2);
assert.equal(dry.summary.foldersPlanned, 1);
assert.ok(dry.entries.some((entry) => entry.kind === 'folder' && entry.status === 'geplant'));
assert.deepEqual(contentSnapshot(), beforeDry, 'Dry-run darf keine Nutzdatei bewegen');
assert.equal(db.prepare('SELECT count(*) AS n FROM doc_links').get().n, 0);
assert.equal(db.prepare("SELECT count(*) AS n FROM doc_files WHERE storage_status='physical'").get().n, 0);
assert.ok(fs.existsSync(dry.reportPath), 'Dry-run-Bericht fehlt');

const first = migration.run({ dryRun: false, maxItems: 9, runId: 'resume-fixture' });
assert.equal(first.status, 'interrupted');
assert.equal(first.summary.processed, 9);
assert.equal(db.prepare("SELECT count(*) AS n FROM doc_migration_items WHERE status='done'").get().n, 9);

// Simulierter Abbruch exakt nach dem Herkunftsnachweis, aber vor dem Entfernen
// der redundanten Quelle: Ein identischer Fortsetzungslauf muss diesen Sidecar
// plattformübergreifend wiederverwenden und seinen Erstzeitpunkt bewahren.
const canonicalAfterFirst = db.prepare(
  `SELECT id,storage_relpath,size,sha256
     FROM doc_files
    WHERE sha256=? AND size=? AND deleted_at='' AND storage_status='physical'
    ORDER BY created_at,id
    LIMIT 1`
).get(sha256Buffer(bytesOne), bytesOne.length);
const orphanKnownSourceKey = 'orphan:files:orphan-known';
const orphanKnownProvenancePath = path.join(
  dataRoot,
  'Dokumentenspeicher',
  'Büroorganisation',
  '_Verwaltung & Sicherungen',
  '_Technik',
  'Waisen',
  'files',
  `.ablage-waise-${canonicalAfterFirst.sha256.slice(0, 16)}-${crypto.createHash('sha256')
    .update(orphanKnownSourceKey).digest('hex').slice(0, 8)}.json`
);
const orphanKnownProvenance = {
  format: 'Betreuungsbüro-Waise/1',
  originalPath: 'orphan-known',
  sourceRoot: 'files',
  storedPath: canonicalAfterFirst.storage_relpath,
  canonicalFileId: canonicalAfterFirst.id,
  deduplicated: true,
  size: canonicalAfterFirst.size,
  sha256: canonicalAfterFirst.sha256,
  migratedAt: '2026-07-27T08:15:00.000Z'
};
fs.mkdirSync(path.dirname(orphanKnownProvenancePath), { recursive: true });
fs.writeFileSync(orphanKnownProvenancePath, JSON.stringify(orphanKnownProvenance, null, 2) + '\n');

const resumed = migration.run({ dryRun: false, runId: 'resume-fixture' });
assert.equal(resumed.status, 'completed');
assert.equal(resumed.summary.errors, 0);
assert.equal(resumed.summary.caseLayoutsEnsured, 2);
assert.equal(resumed.summary.foldersRetired, 1);
assert.equal(db.prepare('SELECT count(*) AS n FROM doc_folders WHERE id=?').get(oldFolder).n, 0,
  'unreferenzierter Altordner muss nach Vorabbericht aus dem Explorer verschwinden');
assert.ok(resumed.entries.some((entry) => entry.kind === 'folder'
  && entry.status === 'erledigt'
  && entry.detail.folderRow.id === oldFolder));
assert.equal(db.prepare("SELECT count(*) AS n FROM doc_files WHERE storage_status='physical'").get().n, 9);
assert.equal(db.prepare('SELECT count(*) AS n FROM doc_links').get().n, 8);
assert.equal(db.prepare("SELECT count(*) AS n FROM doc_links WHERE module='doku-photo'").get().n, 2);
assert.equal(db.prepare("SELECT count(DISTINCT file_id) AS n FROM doc_links WHERE module='doku-photo'").get().n, 1);
assert.ok(db.prepare(
  "SELECT 1 FROM doc_links WHERE module='office-logo' AND owner_id='default' AND slot=''"
).get(), 'Büro-Logo muss nach der Umstellung über denselben Laufzeit-Schlüssel auflösbar sein');

const inboxLink = db.prepare("SELECT file_id FROM doc_links WHERE module='inbox' AND owner_id='inbox-1'").get();
assert.notEqual(inboxLink.file_id, 'doc-1',
  'bloße Inhaltsgleichheit darf Posteingang und Fallregister nicht auf dieselbe logische Datei falten');
const inboxFile = db.prepare('SELECT area,case_id,storage_relpath FROM doc_files WHERE id=?').get(inboxLink.file_id);
assert.equal(inboxFile.area, 'case');
assert.equal(inboxFile.case_id, 'case-1');
assert.ok(inboxFile.storage_relpath.includes('/00 - Eingang/'));
assert.equal(
  db.prepare("SELECT file_id FROM doc_module_import WHERE quelle='posteingang' AND quell_id='inbox-1'").get().file_id,
  inboxLink.file_id,
  'tote Importzuordnung muss auf die erhaltene Moduldatei neu gebunden werden'
);
assert.ok(first.entries.concat(resumed.entries).some((entry) =>
  entry.sourceKey === 'module:inbox:inbox-1'
  && (entry.adjustments || []).some((adjustment) =>
    adjustment.code === 'veralteter_fachverweis_neu_gebunden')),
  'sichtbarer Berichtseintrag für die Neuanbindung eines toten Fachverweises fehlt');
for (const moduleName of ['todo-attachment', 'calendar-attachment']) {
  const linked = db.prepare(`
    SELECT f.storage_relpath
      FROM doc_links l JOIN doc_files f ON f.id=l.file_id
     WHERE l.module=?
  `).get(moduleName);
  assert.ok(linked.storage_relpath.includes('/11 - Betreuungsführung/Schriftverkehr/2026/06/'),
    `${moduleName} muss in einen benannten Register-11-Unterordner der Zielstruktur`);
  assert.equal(linked.storage_relpath.includes('/Termine & Aufgaben/'), false);
}
assert.equal(fs.existsSync(path.join(dataRoot, 'inbox-documents', 'inbox-1')), false);
assert.equal(fs.existsSync(path.join(dataRoot, 'case-doku-photos', 'case-1', 'entry-a', 'photo-shared')), false);

const roots = fs.readdirSync(path.join(dataRoot, 'Dokumentenspeicher', 'Fallakten', 'M'));
assert.deepEqual(roots, ['Müller, Erika']);
const emptyCaseRoot = path.join(
  dataRoot, 'Dokumentenspeicher', 'Fallakten', 'E', 'Einstein, Emil'
);
assert.deepEqual(
  fs.readdirSync(emptyCaseRoot)
    .filter((name) => /^\d{2} - /.test(name))
    .sort(),
  require('../src/modules/documents/taxonomy').REGISTER.map((entry) => entry.name),
  'auch leere Bestandsfälle brauchen nach der Umstellung genau die Register 00–12'
);
const registers = fs.readdirSync(path.join(
  dataRoot, 'Dokumentenspeicher', 'Fallakten', 'M', 'Müller, Erika'
)).filter((name) => /^\d{2} - /.test(name)).sort();
assert.equal(registers.length, 13);
assert.equal(registers[10], '10 - Berichte & Rechnungslegung');

const migratedDocs = db.prepare("SELECT name,storage_relpath FROM doc_files WHERE id IN ('doc-1','doc-2') ORDER BY id").all();
assert.equal(migratedDocs[0].name, 'A_B_.pdf');
assert.equal(migratedDocs[1].name, 'a_b_ (2).PDF');
assert.ok(migratedDocs.every((row) => row.storage_relpath.includes('/05 - Finanzen/')),
  'Leistungsträger muss verbindlich in Register 05 landen');
assert.ok(first.entries.concat(resumed.entries).some((entry) =>
  (entry.adjustments || []).some((adjustment) => adjustment.code === 'kollision')),
  'sichtbare Kollision fehlt im Bericht');

const orphanDir = path.join(
  dataRoot, 'Dokumentenspeicher', 'Büroorganisation',
  '_Verwaltung & Sicherungen', '_Technik', 'Waisen', 'files'
);
assert.equal(fs.existsSync(path.join(orphanDir, 'orphan-known')), false,
  'bytegleiche Waise darf nicht als zweite Nutzdatenkopie liegen bleiben');
assert.ok(fs.existsSync(path.join(orphanDir, 'orphan-other.bin')));
const orphanSidecars = fs.readdirSync(orphanDir)
  .filter((name) => name.startsWith('.ablage-waise-') && name.endsWith('.json'));
assert.equal(orphanSidecars.length, 2);
const orphanMetadata = orphanSidecars.map((name) =>
  JSON.parse(fs.readFileSync(path.join(orphanDir, name), 'utf8')));
const deduplicatedOrphan = orphanMetadata.find((item) => item.originalPath === 'orphan-known');
assert.ok(deduplicatedOrphan && deduplicatedOrphan.deduplicated);
assert.equal(
  deduplicatedOrphan.migratedAt,
  orphanKnownProvenance.migratedAt,
  'identischer deduplizierter Waisen-Sidecar muss unverändert wiederverwendet werden'
);
const orphanCanonical = db.prepare(
  'SELECT id,size,sha256,storage_relpath FROM doc_files WHERE id=? AND deleted_at=?'
).get(deduplicatedOrphan.canonicalFileId, '');
assert.ok(orphanCanonical, 'Waisenverweis muss auf eine aktive Indexzeile zeigen');
assert.equal(orphanCanonical.size, bytesOne.length);
assert.equal(orphanCanonical.sha256, sha256Buffer(bytesOne));
assert.equal(orphanCanonical.storage_relpath, deduplicatedOrphan.storedPath);
assert.ok(resumed.entries.some((entry) => entry.kind === 'orphan'
  && entry.sourcePath.endsWith('/orphan-known')
  && entry.method === 'waise-pruefsummenverweis-ohne-zweitkopie'));
assert.ok(fs.existsSync(resumed.reportPath), 'Umstellungsbericht fehlt');

// Ein gleichnamiger, aber inhaltlich abweichender Herkunftsnachweis darf nie
// still überschrieben werden. Die Quelle bleibt erhalten; nach Korrektur ist
// exakt derselbe protokollierte Lauf fortsetzbar.
const conflictSource = write('files/orphan-conflict', bytesOne);
const conflictSourceKey = 'orphan:files:orphan-conflict';
const conflictProvenancePath = path.join(
  orphanDir,
  `.ablage-waise-${canonicalAfterFirst.sha256.slice(0, 16)}-${crypto.createHash('sha256')
    .update(conflictSourceKey).digest('hex').slice(0, 8)}.json`
);
const conflictProvenance = {
  ...orphanKnownProvenance,
  originalPath: 'orphan-conflict',
  migratedAt: '2026-07-27T09:30:00.000Z'
};
const contradictoryProvenance = {
  ...conflictProvenance,
  canonicalFileId: 'abweichende-datei'
};
fs.writeFileSync(conflictProvenancePath, JSON.stringify(contradictoryProvenance, null, 2) + '\n');
const conflict = migration.run({
  dryRun: false,
  runId: 'orphan-sidecar-conflict',
  failFast: true
});
assert.equal(conflict.summary.errors, 1);
assert.ok(conflict.entries.some((entry) =>
  entry.sourceKey === conflictSourceKey
  && entry.status === 'fehler'
  && /widerspricht dem Fortsetzungslauf/.test(entry.error)));
assert.ok(fs.existsSync(conflictSource), 'bei Sidecar-Widerspruch muss die Waisenquelle erhalten bleiben');
assert.deepEqual(
  JSON.parse(fs.readFileSync(conflictProvenancePath, 'utf8')),
  contradictoryProvenance,
  'abweichender Herkunfts-Sidecar darf nicht überschrieben werden'
);

fs.writeFileSync(conflictProvenancePath, JSON.stringify(conflictProvenance, null, 2) + '\n');
const continuedConflict = migration.run({
  dryRun: false,
  runId: 'orphan-sidecar-conflict'
});
assert.equal(continuedConflict.status, 'completed');
assert.equal(continuedConflict.summary.errors, 0);
assert.equal(fs.existsSync(conflictSource), false, 'korrigierter Fortsetzungslauf muss die Dublette entfernen');
assert.deepEqual(
  JSON.parse(fs.readFileSync(conflictProvenancePath, 'utf8')),
  conflictProvenance,
  'gültiger Herkunfts-Sidecar muss samt Erstzeitpunkt erhalten bleiben'
);

const stableBefore = {
  content: contentSnapshot(),
  files: db.prepare('SELECT id,area,case_id,folder_id,name,sha256,storage_relpath FROM doc_files ORDER BY id').all(),
  links: db.prepare('SELECT module,owner_id,slot,file_id FROM doc_links ORDER BY module,owner_id,slot').all()
};
const repeated = migration.run({ dryRun: false });
assert.equal(repeated.status, 'completed');
assert.equal(repeated.summary.errors, 0);
const stableAfter = {
  content: contentSnapshot(),
  files: db.prepare('SELECT id,area,case_id,folder_id,name,sha256,storage_relpath FROM doc_files ORDER BY id').all(),
  links: db.prepare('SELECT module,owner_id,slot,file_id FROM doc_links ORDER BY module,owner_id,slot').all()
};
assert.deepEqual(stableAfter, stableBefore, 'Wiederholung muss inhaltlich und im Index identisch sein');

const signalled = migration.run({
  dryRun: true,
  signal: { aborted: true },
  reportDir: reportRoot
});
assert.equal(signalled.status, 'interrupted');
assert.equal(signalled.summary.processed, 0);

for (const row of db.prepare("SELECT * FROM doc_files WHERE storage_status='physical'").all()) {
  const found = storage.findBlobPath(row);
  assert.ok(found && fs.existsSync(found), `physische Datei fehlt: ${row.id}`);
  assert.equal(sha256Buffer(fs.readFileSync(found)), row.sha256);
  assert.ok(fs.existsSync(storage.sidecarPath(found, row.id)), `Beipackzettel fehlt: ${row.id}`);
}

// Regression Namensgleichheit: Altbestand ohne ID bleibt bei einem mehrfach
// vorkommenden Label büroweit/unzugeordnet. Eine vorhandene gültige ID hat
// dagegen Vorrang, selbst wenn das alte Anzeigelabel widerspricht.
db.prepare('INSERT INTO cases (id,label,stammdaten_json,archived) VALUES (?,?,?,0)').run(
  'case-duplicate-a',
  'Doppelt, Dana',
  JSON.stringify({ person: { lastName: 'Doppelt', firstName: 'Dana', birthDate: '1970-01-01' } })
);
db.prepare('INSERT INTO cases (id,label,stammdaten_json,archived) VALUES (?,?,?,0)').run(
  'case-duplicate-b',
  'Doppelt, Dana',
  JSON.stringify({ person: { lastName: 'Doppelt', firstName: 'Dana', birthDate: '1980-02-02' } })
);
assert.equal(migration._test.caseIdFor('', 'Müller, Erika'), 'case-1');
assert.equal(migration._test.caseIdFor('', 'Doppelt, Dana'), '');
assert.equal(
  migration._test.caseIdFor('case-duplicate-b', 'Müller, Erika'),
  'case-duplicate-b'
);
assert.equal(migration._test.caseIdFor('unbekannt', 'Müller, Erika'), '');

db.prepare(`
  INSERT INTO inbox_documents
    (id,file_name,mime_type,case_id,case_label,inbox_date,received_date,created_at,created_by)
  VALUES (?,?,?,?,?,?,?,?,?)
`).run(
  'inbox-ambiguous', 'Mehrdeutig.pdf', 'application/pdf', '', 'Doppelt, Dana',
  '2026-07-01', '2026-07-01', '2026-07-01', 1
);
write('inbox-documents/inbox-ambiguous', Buffer.from('mehrdeutiger posteingang\n'));
db.prepare(`
  INSERT INTO todos (id,case_id,case_label,due_at,start_at,created_at)
  VALUES (?,?,?,?,?,?)
`).run('todo-ambiguous', '', 'Doppelt, Dana', '2026-07-02', '', '2026-07-01');
db.prepare('INSERT INTO todo_attachments VALUES (?,?,?,?,?,?)').run(
  'todo-att-ambiguous', 'todo-ambiguous', 'Mehrdeutig.txt', 'text/plain', '2026-07-01', 1
);
write('todo-attachments/todo-ambiguous/todo-att-ambiguous', Buffer.from('mehrdeutige aufgabe\n'));
db.prepare(`
  INSERT INTO calendar_events (id,case_id,case_label,start_at,created_at)
  VALUES (?,?,?,?,?)
`).run(
  'event-explicit', 'case-duplicate-b', 'Müller, Erika',
  '2026-07-03 10:00:00', '2026-07-01'
);
db.prepare('INSERT INTO calendar_event_attachments VALUES (?,?,?,?,?,?)').run(
  'cal-att-explicit', 'event-explicit', 'Explizit.txt', 'text/plain', '2026-07-01', 1
);
write('calendar-event-attachments/event-explicit/cal-att-explicit', Buffer.from('explizite id\n'));
db.prepare(`
  INSERT INTO calendar_events (id,case_id,case_label,start_at,created_at)
  VALUES (?,?,?,?,?)
`).run(
  'event-invalid', 'missing-case', 'Müller, Erika',
  '2026-07-03 11:00:00', '2026-07-01'
);
db.prepare('INSERT INTO calendar_event_attachments VALUES (?,?,?,?,?,?)').run(
  'cal-att-invalid', 'event-invalid', 'Ungültig.txt', 'text/plain', '2026-07-01', 1
);
write('calendar-event-attachments/event-invalid/cal-att-invalid', Buffer.from('ungueltige id\n'));

const assignmentInventory = migration.discover();
const ambiguousInbox = assignmentInventory.find(
  (entry) => entry.sourceKey === 'module:inbox:inbox-ambiguous'
);
const ambiguousTodo = assignmentInventory.find(
  (entry) => entry.sourceKey === 'module:todo:todo-ambiguous:todo-att-ambiguous'
);
const explicitCalendar = assignmentInventory.find(
  (entry) => entry.sourceKey === 'module:calendar:event-explicit:cal-att-explicit'
);
const invalidCalendar = assignmentInventory.find(
  (entry) => entry.sourceKey === 'module:calendar:event-invalid:cal-att-invalid'
);
assert.equal(ambiguousInbox.area, 'office');
assert.equal(ambiguousInbox.caseId, '');
assert.match(ambiguousInbox.storageRelpath, /^Büroorganisation\/Posteingang\//);
assert.ok(ambiguousInbox.adjustments.some(
  (adjustment) => adjustment.code === 'mehrdeutiger_fallbezug_unzugeordnet'
));
assert.equal(ambiguousTodo.area, 'office');
assert.equal(ambiguousTodo.caseId, '');
assert.match(ambiguousTodo.storageRelpath, /^Büroorganisation\/Termine & Aufgaben\//);
assert.ok(ambiguousTodo.adjustments.some(
  (adjustment) => adjustment.code === 'mehrdeutiger_fallbezug_unzugeordnet'
));
assert.equal(explicitCalendar.area, 'case');
assert.equal(explicitCalendar.caseId, 'case-duplicate-b');
assert.match(explicitCalendar.storageRelpath, /^Fallakten\/D\/Doppelt, Dana 800202\//);
assert.equal(invalidCalendar.area, 'office');
assert.equal(invalidCalendar.caseId, '');
assert.ok(invalidCalendar.adjustments.some(
  (adjustment) => adjustment.code === 'ungueltige_fall_id_unzugeordnet'
));

db.close();
fs.rmSync(temp, { recursive: true, force: true });
console.log('document-migration: dry-run, Abbruch/Fortsetzung, Module, Waisen und Wiederholung ok');
