'use strict';

/*
 * Abnahmeharnisch für eine echte, konsistente DB-/Datenkopie.
 *
 * Dieser Lauf verweigert produktive Pfade. Er prüft Dry-run, absichtlichen
 * Abbruch, Fortsetzung, Wiederholung, alle physischen Dateien/Sidecars,
 * Waisenquittungen, Register, Integritätsabgleich sowie Finder-Rename,
 * Finder-Move und Finder-Löschmeldung.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  MODULE_ROOTS,
  createDocumentMigration,
  walkRegular
} = require('../src/modules/documents/migration');
const { createDocumentStorage, sha256File } = require('../src/modules/documents/storage');
const { createDocumentReconciler } = require('../src/modules/documents/reconcile');
const { createDocumentFinderSync } = require('../src/modules/documents/finder-sync');
const taxonomy = require('../src/modules/documents/taxonomy');

const dbPath = path.resolve(String(process.env.DB_PATH || ''));
const dataRoot = path.resolve(String(process.env.DOCUMENTS_DATA_ROOT || ''));
const safetyRoot = path.resolve(String(process.env.ACTUAL_COPY_ROOT || ''));

assert.ok(process.env.DB_PATH && process.env.DOCUMENTS_DATA_ROOT && process.env.ACTUAL_COPY_ROOT,
  'DB_PATH, DOCUMENTS_DATA_ROOT und ACTUAL_COPY_ROOT sind erforderlich.');
assert.ok(safetyRoot.startsWith('/private/tmp/echte-ordner-echtdaten.'),
  'Der Prüflauf ist ausschließlich unter /private/tmp/echte-ordner-echtdaten.* erlaubt.');
assert.ok(dbPath.startsWith(safetyRoot + path.sep), 'DB-Kopie liegt nicht im Sicherheitsverzeichnis.');
assert.ok(dataRoot.startsWith(safetyRoot + path.sep), 'Datenkopie liegt nicht im Sicherheitsverzeichnis.');
assert.ok(fs.statSync(dbPath).isFile(), 'DB-Kopie fehlt.');
assert.ok(fs.statSync(dataRoot).isDirectory(), 'Datenkopie fehlt.');

const db = require('../src/database/index');

function stableRows(table, columns, order) {
  return db.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${order}`).all();
}

function domainSnapshot() {
  return JSON.stringify({
    files: stableRows(
      'doc_files',
      'id,area,case_id,folder_id,name,name_key,mime_type,size,sha256,deleted_at,deleted_from,storage_relpath,storage_status',
      'id'
    ),
    folders: stableRows(
      'doc_folders',
      'id,area,case_id,parent_id,name,name_key,storage_relpath,storage_status',
      'id'
    ),
    links: stableRows('doc_links', 'module,owner_id,slot,file_id,detail_json', 'module,owner_id,slot'),
    imports: stableRows('doc_module_import', 'quelle,quell_id,file_id', 'quelle,quell_id')
  });
}

function treeStats(root) {
  let files = 0;
  let logicalBytes = 0;
  let allocatedBytes = 0;
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile()) {
        const stat = fs.statSync(candidate);
        files++;
        logicalBytes += stat.size;
        allocatedBytes += Number(stat.blocks || 0) * 512;
      }
    }
  }
  visit(root);
  return { files, logicalBytes, allocatedBytes };
}

function pathKey(value) {
  return String(value || '').normalize('NFC').toLocaleLowerCase('de-DE');
}

function sidecarPath(filePath, fileId) {
  return path.join(path.dirname(filePath), `.ablage-${fileId}.json`);
}

function validatePhysicalRows(storage) {
  const rows = db.prepare(`
    SELECT * FROM doc_files
     WHERE storage_status IN ('physical','ok') AND storage_relpath<>''
     ORDER BY id
  `).all();
  const seen = new Set();
  let bytes = 0;
  for (const row of rows) {
    const key = pathKey(row.storage_relpath);
    assert.equal(seen.has(key), false, `Case-insensitive Pfadkollision: ${row.storage_relpath}`);
    seen.add(key);
    const filePath = storage.findBlobPath(row);
    assert.ok(filePath && fs.statSync(filePath).isFile(), `Physische Datei fehlt: ${row.id}`);
    const stat = fs.statSync(filePath);
    assert.equal(Number(row.size), stat.size, `Größe weicht ab: ${row.id}`);
    assert.equal(String(row.sha256), sha256File(filePath), `SHA-256 weicht ab: ${row.id}`);
    const metadata = JSON.parse(fs.readFileSync(sidecarPath(filePath, row.id), 'utf8'));
    assert.equal(String(metadata.fileId), String(row.id), `Sidecar-ID weicht ab: ${row.id}`);
    assert.equal(String(metadata.path), String(row.storage_relpath), `Sidecar-Pfad weicht ab: ${row.id}`);
    assert.equal(String(metadata.sha256), String(row.sha256), `Sidecar-SHA weicht ab: ${row.id}`);
    bytes += stat.size;
  }
  return { rows, bytes };
}

function validateRegisters(storage) {
  const roots = db.prepare('SELECT * FROM doc_case_roots ORDER BY case_id').all();
  for (const root of roots) {
    const absolute = path.join(storage.root(), ...String(root.storage_relpath).split('/'));
    assert.ok(fs.statSync(absolute).isDirectory(), `Fallwurzel fehlt: ${root.storage_relpath}`);
    const registerNames = fs.readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{2} - /.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(registerNames, taxonomy.REGISTER.map((entry) => entry.name),
      `Register 00–12 weichen ab: ${root.storage_relpath}`);
  }
  return roots.length;
}

function fatalIntegrity(findings) {
  const forbidden = new Set([
    'missing_file',
    'size_mismatch',
    'sha256_mismatch',
    'casefold_collision',
    'nfc_collision',
    'unindexed_file',
    'management_unindexed_file',
    'orphan_ack_invalid',
    'storage_root_missing'
  ]);
  return findings.filter((finding) => forbidden.has(finding.kind));
}

function finderRoundTrip(storage) {
  const sync = createDocumentFinderSync({
    db,
    documentStorage: storage,
    writeSidecars: true,
    now: () => new Date('2026-07-28T14:00:00.000Z')
  });
  const candidate = db.prepare(`
    SELECT * FROM doc_files
     WHERE deleted_at='' AND area='case'
       AND storage_status IN ('physical','ok') AND storage_relpath<>''
     ORDER BY size,id LIMIT 1
  `).get();
  assert.ok(candidate, 'Keine aktive Fallakte für Finder-Prüfung vorhanden.');
  const originalPath = storage.findBlobPath(candidate);
  const originalSidecar = sidecarPath(originalPath, candidate.id);
  const extension = path.extname(candidate.name);
  const nfdName = `Besta\u0308tigung Finder ${String(candidate.id).slice(0, 8)}${extension}`;
  const renamedPath = path.join(path.dirname(originalPath), nfdName);
  assert.equal(fs.existsSync(renamedPath), false, 'Finder-Testziel ist bereits belegt.');
  fs.renameSync(originalPath, renamedPath);

  const renameScan = sync.scan();
  const renameFinding = renameScan.findings.find((finding) =>
    finding.kind === 'file_changed'
    && finding.detail && String(finding.detail.fileId) === String(candidate.id)
  );
  assert.ok(renameFinding, 'Finder-NFD-Umbenennung wurde nicht erkannt.');
  assert.ok(renameScan.findings.some((finding) =>
    finding.kind === 'name_adjustment'
    && finding.storageRelpath.endsWith(nfdName)
  ), 'NFD-Namensanpassung wurde nicht sichtbar gemeldet.');
  const renameApplied = sync.apply(renameScan);
  assert.equal(renameApplied.ok, true, JSON.stringify(renameApplied.errors));
  let current = db.prepare('SELECT * FROM doc_files WHERE id=?').get(candidate.id);
  assert.ok(current.name.includes('Bestätigung Finder'), 'DB-Name wurde nicht auf NFC normalisiert.');
  assert.ok(current.storage_relpath.endsWith(nfdName), 'Tatsächlicher Finder-Pfad wurde nicht übernommen.');

  const movedDirectory = path.join(path.dirname(renamedPath), 'Finder Prüfung');
  fs.mkdirSync(movedDirectory);
  const movedPath = path.join(movedDirectory, nfdName);
  fs.renameSync(renamedPath, movedPath);
  // Der Nutzer verschiebt die sichtbare Nutzdatei; der versteckte Sidecar bleibt
  // absichtlich zurück. Apply muss am neuen Ort einen korrekten Sidecar schreiben.
  assert.ok(fs.existsSync(originalSidecar), 'Ausgangs-Sidecar fehlt vor dem Finder-Move.');
  const moveScan = sync.scan();
  const moveFinding = moveScan.findings.find((finding) =>
    finding.kind === 'file_changed'
    && finding.detail && String(finding.detail.fileId) === String(candidate.id)
    && finding.detail.moved
  );
  assert.ok(moveFinding, 'Finder-Verschiebung wurde nicht erkannt.');
  const moveApplied = sync.apply(moveScan);
  assert.equal(moveApplied.ok, true, JSON.stringify(moveApplied.errors));
  current = db.prepare('SELECT * FROM doc_files WHERE id=?').get(candidate.id);
  assert.ok(current.storage_relpath.includes('/Finder Prüfung/'), 'Finder-Zielordner fehlt im Index.');
  assert.ok(fs.existsSync(sidecarPath(movedPath, candidate.id)), 'Sidecar wurde am Finder-Ziel nicht erneuert.');

  const holding = path.join(safetyRoot, `finder-delete-holding-${candidate.id}`);
  fs.renameSync(movedPath, holding);
  const deleteScan = sync.scan();
  assert.ok(deleteScan.findings.some((finding) =>
    finding.kind === 'missing_file'
    && finding.detail && String(finding.detail.fileId) === String(candidate.id)
  ), 'Finder-Löschung wurde nicht als fehlend gemeldet.');
  const beforeDeletedAt = db.prepare('SELECT deleted_at FROM doc_files WHERE id=?').get(candidate.id).deleted_at;
  const deleteApplied = sync.apply(deleteScan);
  assert.equal(deleteApplied.ok, true, JSON.stringify(deleteApplied.errors));
  assert.equal(
    db.prepare('SELECT deleted_at FROM doc_files WHERE id=?').get(candidate.id).deleted_at,
    beforeDeletedAt,
    'Finder-Löschung darf nicht automatisch als fachliche Löschung verbucht werden.'
  );
  fs.renameSync(holding, movedPath);
  const restoredScan = sync.scan();
  assert.equal(restoredScan.findings.some((finding) =>
    finding.kind === 'missing_file'
    && finding.detail && String(finding.detail.fileId) === String(candidate.id)
  ), false, 'Zurückgelegte Finder-Datei bleibt fälschlich als fehlend markiert.');
  const restoredApply = sync.apply(restoredScan);
  assert.equal(restoredApply.ok, true, JSON.stringify(restoredApply.errors));
  return {
    fileId: candidate.id,
    renameDetected: true,
    moveDetected: true,
    deleteDetectedWithoutDbDeletion: true
  };
}

async function main() {
  try {
    const storage = createDocumentStorage({ db, dataRoot, readConfig: () => ({}) });
  const migration = createDocumentMigration({ db, dataRoot, storage });
  const beforeTree = treeStats(dataRoot);
  const legacyBefore = ['files', ...MODULE_ROOTS].reduce(
    (sum, name) => sum + walkRegular(path.join(dataRoot, name)).length,
    0
  );
  const beforeDomain = domainSnapshot();

  const preview = migration.run({
    dryRun: true,
    runId: 'actual-copy-preview',
    reportDir: path.join(safetyRoot, 'preview-reports')
  });
  assert.equal(preview.status, 'completed');
  assert.equal(preview.summary.errors, 0);
  assert.equal(domainSnapshot(), beforeDomain, 'Dry-run hat Fach-/Datei-/Ordnerdaten verändert.');
  assert.ok(preview.summary.discovered > 0, 'Echtdatenkopie enthält keinen Umstellungsbestand.');

  const firstLimit = Math.max(1, Math.floor(preview.summary.discovered / 2));
  const interrupted = migration.run({
    dryRun: false,
    runId: 'actual-copy-resume',
    maxItems: firstLimit
  });
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.summary.errors, 0);

  const resumed = migration.run({ dryRun: false, runId: 'actual-copy-resume' });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.summary.errors, 0, JSON.stringify(resumed.entries.filter((entry) => entry.error)));

  const repeated = migration.run({ dryRun: false, runId: 'actual-copy-repeat' });
  assert.equal(repeated.status, 'completed');
  assert.equal(repeated.summary.errors, 0);

  const physical = validatePhysicalRows(storage);
  const caseRoots = validateRegisters(storage);
  const legacyAfter = ['files', ...MODULE_ROOTS].reduce(
    (sum, name) => sum + walkRegular(path.join(dataRoot, name)).length,
    0
  );
  assert.equal(legacyAfter, 0, 'In den acht Alt-Blobwurzeln liegen noch reguläre Dateien.');

  const reconciler = createDocumentReconciler({
    db,
    storageRoot: storage.root(),
    resolver: {
      resolve(row) {
        return row.storage_relpath ? { storageRelpath: row.storage_relpath } : null;
      },
      sidecarPath
    },
    legacyRoots: ['files', ...MODULE_ROOTS].map((name) => path.join(dataRoot, name))
  });
  const integrityBeforeFinder = await reconciler.scan();
  assert.deepEqual(fatalIntegrity(integrityBeforeFinder.findings), [],
    JSON.stringify(fatalIntegrity(integrityBeforeFinder.findings), null, 2));
  assert.ok(integrityBeforeFinder.summary.acknowledgedOrphans >= 1,
    'Umgehängte Waisen werden nicht quittiert.');

  const finder = finderRoundTrip(storage);
  const integrityAfterFinder = await reconciler.scan();
  assert.deepEqual(fatalIntegrity(integrityAfterFinder.findings), [],
    JSON.stringify(fatalIntegrity(integrityAfterFinder.findings), null, 2));

  const afterTree = treeStats(dataRoot);
    console.log(JSON.stringify({
      ok: true,
      copyRoot: safetyRoot,
      preview: preview.summary,
      interrupted: interrupted.summary,
      resumed: resumed.summary,
      repeated: repeated.summary,
      legacyFiles: { before: legacyBefore, after: legacyAfter },
      physical: { rows: physical.rows.length, logicalBytes: physical.bytes },
      caseRoots,
      acknowledgedOrphans: integrityAfterFinder.summary.acknowledgedOrphans,
      acknowledgedOrphanReferences: integrityAfterFinder.summary.acknowledgedOrphanReferences,
      tree: { before: beforeTree, after: afterTree },
      finder,
      reportPath: resumed.reportPath
    }, null, 2));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
