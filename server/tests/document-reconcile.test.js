'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const {
  createDocumentReconciler,
  sidecarPathFor,
  canonicalSidecar
} = require('../src/modules/documents/reconcile');

function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'document-reconcile-'));
  const storageRoot = path.join(base, 'Dokumentenspeicher');
  const legacyRoot = path.join(base, 'legacy-files');
  fs.mkdirSync(storageRoot, { recursive: true });
  fs.mkdirSync(legacyRoot, { recursive: true });
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE doc_files (
      id TEXT PRIMARY KEY,
      area TEXT NOT NULL DEFAULT 'case',
      case_id TEXT NOT NULL DEFAULT '',
      folder_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      name_key TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      deleted_at TEXT NOT NULL DEFAULT '',
      storage_relpath TEXT NOT NULL DEFAULT '',
      storage_dev TEXT NOT NULL DEFAULT '',
      storage_ino TEXT NOT NULL DEFAULT '',
      storage_status TEXT NOT NULL DEFAULT 'legacy',
      last_seen_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      managed INTEGER NOT NULL DEFAULT 0,
      artifact_kind TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE doc_folders (
      id TEXT PRIMARY KEY,
      area TEXT NOT NULL DEFAULT 'case',
      case_id TEXT NOT NULL DEFAULT '',
      storage_relpath TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE doc_integrity_runs (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'read',
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      summary_json TEXT NOT NULL DEFAULT '{}',
      report_path TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE doc_integrity_findings (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      file_id TEXT NOT NULL DEFAULT '',
      storage_relpath TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (run_id, seq)
    );
  `);
  const insertFile = db.prepare(`
    INSERT INTO doc_files
      (id, area, case_id, folder_id, name, name_key, mime_type, size, sha256,
       storage_relpath, storage_dev, storage_ino, storage_status)
    VALUES
      (@id, @area, @caseId, @folderId, @name, @nameKey, @mimeType, @size, @sha256,
       @storageRelpath, @storageDev, @storageIno, @storageStatus)
  `);
  const resolver = {
    resolve(row) {
      return { storageRelpath: row.storage_relpath };
    },
    sidecarPath(filePath, fileId) {
      return sidecarPathFor(filePath, fileId);
    }
  };
  let idIndex = 0;
  const reconciler = createDocumentReconciler({
    db,
    storageRoot,
    resolver,
    legacyRoots: [legacyRoot],
    now: () => new Date('2026-07-28T10:00:00.000Z'),
    idFactory: () => `run-${++idIndex}`
  });

  function addFolder(id, relpath, area = 'case', caseId = 'case-1') {
    db.prepare('INSERT INTO doc_folders (id, area, case_id, storage_relpath) VALUES (?, ?, ?, ?)')
      .run(id, area, caseId, relpath);
  }

  function write(relpath, bytes) {
    const target = path.join(storageRoot, ...relpath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    return { target, stat: fs.statSync(target), bytes: Buffer.from(bytes) };
  }

  function addRow(values) {
    const row = {
      id: values.id,
      area: values.area || 'case',
      caseId: values.caseId || 'case-1',
      folderId: values.folderId || 'folder-a',
      name: values.name,
      nameKey: String(values.name || '').normalize('NFC').toLocaleLowerCase('de-DE'),
      mimeType: values.mimeType || 'application/octet-stream',
      size: Number(values.size),
      sha256: values.sha256,
      storageRelpath: values.storageRelpath,
      storageDev: values.storageDev || '',
      storageIno: values.storageIno || '',
      storageStatus: values.storageStatus || 'ok'
    };
    insertFile.run(row);
    if (values.managed || values.artifactKind) {
      db.prepare('UPDATE doc_files SET managed=?,artifact_kind=? WHERE id=?')
        .run(values.managed ? 1 : 0, values.artifactKind || '', row.id);
    }
    return db.prepare('SELECT * FROM doc_files WHERE id=?').get(row.id);
  }

  function writeSidecar(row, filePath, overrides) {
    const stat = fs.statSync(filePath);
    const relpath = filePath.slice(storageRoot.length + 1).split(path.sep).join('/');
    const data = {
      ...canonicalSidecar(row, relpath, stat.size, sha(fs.readFileSync(filePath))),
      ...(overrides || {})
    };
    fs.writeFileSync(sidecarPathFor(filePath, row.id), JSON.stringify(data));
    return data;
  }

  function close() {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  }

  return {
    base,
    storageRoot,
    legacyRoot,
    db,
    reconciler,
    addFolder,
    write,
    addRow,
    writeSidecar,
    close
  };
}

test('read-only Scan meldet Größe, SHA, Sidecar, NFD, Legacy-Waise und Symlink und journalisiert', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.addFolder('folder-a', 'A');

  const broken = f.write('A/Fehler.txt', 'abc');
  f.addRow({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Fehler.txt',
    size: 99,
    sha256: '0'.repeat(64),
    storageRelpath: 'A/Fehler.txt',
    storageDev: String(broken.stat.dev),
    storageIno: String(broken.stat.ino)
  });

  const mismatch = f.write('A/Metadaten.txt', 'inhalt');
  const mismatchRow = f.addRow({
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Metadaten.txt',
    size: mismatch.stat.size,
    sha256: sha(mismatch.bytes),
    storageRelpath: 'A/Metadaten.txt',
    storageDev: String(mismatch.stat.dev),
    storageIno: String(mismatch.stat.ino),
    mimeType: 'text/plain'
  });
  f.writeSidecar(mismatchRow, mismatch.target, { sha256: 'f'.repeat(64) });

  const nfdRelpath = 'A/Beho\u0308rde.txt';
  const nfd = f.write(nfdRelpath, 'nfc-test');
  const nfdRow = f.addRow({
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Behörde.txt',
    size: nfd.stat.size,
    sha256: sha(nfd.bytes),
    storageRelpath: nfdRelpath,
    storageDev: String(nfd.stat.dev),
    storageIno: String(nfd.stat.ino),
    mimeType: 'text/plain'
  });
  f.writeSidecar(nfdRow, nfd.target);

  const orphanId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  fs.writeFileSync(path.join(f.legacyRoot, orphanId), 'verwaist');
  try {
    fs.symlinkSync(broken.target, path.join(f.storageRoot, 'A', 'nur-ein-link.txt'));
  } catch (error) {
    if (!error || error.code !== 'EPERM') throw error;
  }

  const before = f.db.prepare('SELECT * FROM doc_files ORDER BY id').all();
  const diskBefore = fs.readdirSync(path.join(f.storageRoot, 'A')).sort();
  const result = await f.reconciler.scan();
  const after = f.db.prepare('SELECT * FROM doc_files ORDER BY id').all();
  const diskAfter = fs.readdirSync(path.join(f.storageRoot, 'A')).sort();
  const kinds = new Set(result.findings.map((finding) => finding.kind));

  assert.ok(kinds.has('size_mismatch'));
  assert.ok(kinds.has('sha256_mismatch'));
  assert.ok(kinds.has('sidecar_missing'));
  assert.ok(kinds.has('sidecar_mismatch'));
  assert.ok(kinds.has('unicode_not_nfc'));
  assert.ok(kinds.has('legacy_orphan'));
  if (diskBefore.includes('nur-ein-link.txt')) assert.ok(kinds.has('symlink_ignored'));
  assert.deepEqual(after, before, 'Scan darf doc_files nicht verändern');
  assert.deepEqual(diskAfter, diskBefore, 'Scan darf auf der Platte nichts verändern');

  const run = f.db.prepare('SELECT * FROM doc_integrity_runs WHERE id=?').get(result.runId);
  const journal = f.db.prepare('SELECT * FROM doc_integrity_findings WHERE run_id=? ORDER BY seq').all(result.runId);
  assert.equal(run.mode, 'read');
  assert.equal(run.status, 'complete');
  assert.equal(journal.length, result.findings.length);
  assert.equal(JSON.parse(run.summary_json).findingCount, result.findings.length);
});

test('Apply zieht eine eindeutige Finder-Umbenennung per .ablage-Sidecar nach und normalisiert NFD im DB-Namen', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.addFolder('folder-a', 'A');
  const id = '44444444-4444-4444-8444-444444444444';
  const actualRelpath = 'A/Beho\u0308rde neu.pdf';
  const actual = f.write(actualRelpath, 'umbenannt');
  const row = f.addRow({
    id,
    name: 'Alt.pdf',
    size: actual.stat.size,
    sha256: sha(actual.bytes),
    storageRelpath: 'A/Alt.pdf',
    storageDev: '',
    storageIno: '',
    mimeType: 'application/pdf'
  });
  f.writeSidecar(row, actual.target, {
    name: 'Beho\u0308rde neu.pdf',
    path: actualRelpath
  });

  const result = await f.reconciler.apply();
  const changed = f.db.prepare('SELECT * FROM doc_files WHERE id=?').get(id);

  assert.equal(changed.name, 'Behörde neu.pdf');
  assert.equal(changed.name.normalize('NFC'), changed.name);
  assert.equal(changed.storage_relpath, actualRelpath, 'physischer NFD-Pfad bleibt exakt auffindbar');
  assert.equal(changed.storage_status, 'ok');
  assert.equal(changed.deleted_at, '');
  assert.equal(fs.readFileSync(actual.target, 'utf8'), 'umbenannt');
  assert.ok(result.findings.some((finding) => finding.kind === 'relocation_detected'
    && finding.detail.method === 'sidecar_id'));
  assert.ok(result.findings.some((finding) => finding.kind === 'relocation_applied'));
  assert.ok(result.findings.some((finding) => finding.kind === 'unicode_not_nfc'));
});

test('Apply zieht einen eindeutigen Finder-Move über dev+ino in den neuen Ordner nach', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.addFolder('folder-a', 'A');
  f.addFolder('folder-b', 'B');
  const id = '55555555-5555-4555-8555-555555555555';
  const original = f.write('A/Dokument.txt', 'bewegung');
  f.addRow({
    id,
    name: 'Dokument.txt',
    size: original.stat.size,
    sha256: sha(original.bytes),
    storageRelpath: 'A/Dokument.txt',
    storageDev: String(original.stat.dev),
    storageIno: String(original.stat.ino)
  });
  fs.mkdirSync(path.join(f.storageRoot, 'B'), { recursive: true });
  const moved = path.join(f.storageRoot, 'B', 'Dokument.txt');
  fs.renameSync(original.target, moved);

  const result = await f.reconciler.apply();
  const changed = f.db.prepare('SELECT * FROM doc_files WHERE id=?').get(id);

  assert.equal(changed.folder_id, 'folder-b');
  assert.equal(changed.storage_relpath, 'B/Dokument.txt');
  assert.equal(changed.storage_status, 'ok');
  assert.ok(result.findings.some((finding) => finding.kind === 'relocation_detected'
    && finding.detail.method === 'dev_ino'));
  assert.equal(fs.readFileSync(moved, 'utf8'), 'bewegung');
});

test('Apply erkennt physisches Löschen ausschließlich als missing und lässt die DB-Zeile aktiv', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.addFolder('folder-a', 'A');
  const id = '66666666-6666-4666-8666-666666666666';
  f.addRow({
    id,
    name: 'Gelöscht.txt',
    size: 17,
    sha256: sha(Buffer.from('nicht mehr da')),
    storageRelpath: 'A/Gelöscht.txt'
  });

  const result = await f.reconciler.apply();
  const changed = f.db.prepare('SELECT * FROM doc_files WHERE id=?').get(id);

  assert.equal(changed.storage_status, 'missing');
  assert.equal(changed.deleted_at, '');
  assert.equal(changed.name, 'Gelöscht.txt');
  assert.equal(changed.storage_relpath, 'A/Gelöscht.txt');
  assert.equal(result.summary.markedMissing, 1);
  assert.ok(result.findings.some((finding) => finding.kind === 'missing_marked'));
});

test('Apply setzt bei nicht verfügbarer Speicherwurzel nicht alle Dateien fälschlich auf missing', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.addFolder('folder-a', 'A');
  const id = '67676767-6767-4767-8767-676767676767';
  f.addRow({
    id,
    name: 'Auf Netzlaufwerk.txt',
    size: 4,
    sha256: sha(Buffer.from('test')),
    storageRelpath: 'A/Auf Netzlaufwerk.txt',
    storageStatus: 'ok'
  });
  fs.rmSync(f.storageRoot, { recursive: true, force: true });

  const result = await f.reconciler.apply();
  const unchanged = f.db.prepare('SELECT * FROM doc_files WHERE id=?').get(id);

  assert.equal(unchanged.storage_status, 'ok');
  assert.equal(unchanged.updated_at, '');
  assert.equal(result.summary.skipped, 1);
  assert.ok(result.findings.some((finding) => (
    finding.kind === 'apply_skipped'
    && finding.detail.reason === 'storage_root_unavailable'
  )));
});

test('Apply nutzt SHA+Größe nur bei genau einem Kandidaten', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.addFolder('folder-a', 'A');
  f.addFolder('folder-b', 'B');
  const id = '77777777-7777-4777-8777-777777777777';
  const actual = f.write('B/Gefunden.bin', 'eindeutiger-inhalt');
  f.addRow({
    id,
    name: 'Alt.bin',
    size: actual.stat.size,
    sha256: sha(actual.bytes),
    storageRelpath: 'A/Alt.bin'
  });

  const result = await f.reconciler.apply();
  const changed = f.db.prepare('SELECT * FROM doc_files WHERE id=?').get(id);

  assert.equal(changed.storage_relpath, 'B/Gefunden.bin');
  assert.equal(changed.folder_id, 'folder-b');
  assert.ok(result.findings.some((finding) => finding.kind === 'relocation_detected'
    && finding.detail.method === 'sha256_size'));
});

test('Apply meldet eine case-insensitive Zielkollision sichtbar und überschreibt keine DB-Zuordnung', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.addFolder('folder-a', 'A');
  const movingId = '88888888-8888-4888-8888-888888888888';
  const existingId = '99999999-9999-4999-8999-999999999999';
  const candidate = f.write('A/Bericht.pdf', 'kandidat');
  const moving = f.addRow({
    id: movingId,
    name: 'Alt.pdf',
    size: candidate.stat.size,
    sha256: sha(candidate.bytes),
    storageRelpath: 'A/Alt.pdf'
  });
  f.writeSidecar(moving, candidate.target, {
    name: 'Bericht.pdf',
    path: 'A/Bericht.pdf'
  });

  f.addRow({
    id: existingId,
    name: 'bericht.pdf',
    size: Buffer.byteLength('anderer-inhalt'),
    sha256: sha(Buffer.from('anderer-inhalt')),
    storageRelpath: 'A/bericht.pdf'
  });

  const result = await f.reconciler.apply();
  const unchanged = f.db.prepare('SELECT * FROM doc_files WHERE id=?').get(movingId);

  assert.equal(unchanged.name, 'Alt.pdf');
  assert.equal(unchanged.storage_relpath, 'A/Alt.pdf');
  assert.equal(unchanged.storage_status, 'missing');
  assert.equal(fs.readFileSync(candidate.target, 'utf8'), 'kandidat');
  assert.ok(result.findings.some((finding) => (
    finding.kind === 'reconcile_conflict'
    && finding.fileId === movingId
    && ['name_collision', 'candidate_shared', 'candidate_owned'].includes(finding.detail.reason)
  )));
});

test('mehrdeutige SHA+Größe-Kandidaten bleiben Konflikt und werden nicht automatisch zugeordnet', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.addFolder('folder-a', 'A');
  f.addFolder('folder-b', 'B');
  const id = 'abababab-abab-4bab-8bab-abababababab';
  const first = f.write('B/Eins.bin', 'doppelt');
  f.write('B/Zwei.bin', 'doppelt');
  f.addRow({
    id,
    name: 'Alt.bin',
    size: first.stat.size,
    sha256: sha(first.bytes),
    storageRelpath: 'A/Alt.bin'
  });

  const result = await f.reconciler.apply();
  const unchanged = f.db.prepare('SELECT * FROM doc_files WHERE id=?').get(id);

  assert.equal(unchanged.storage_relpath, 'A/Alt.bin');
  assert.equal(unchanged.storage_status, 'missing');
  assert.ok(result.findings.some((finding) => (
    finding.kind === 'reconcile_conflict'
    && finding.detail.method === 'sha256_size'
    && finding.detail.candidates.length === 2
  )));
});

test('geschützte Verwaltung trennt quittierte Waisen und Umstellungsberichte von unbekannten Dateien', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.addFolder('folder-a', 'Fallakten/M/Muster/00 - Eingang');

  const orphan = f.write('Büroorganisation/_Verwaltung & Sicherungen/_Technik/Waisen/files/orphan-known.bin', 'bekannte-waise');
  const orphanSha = sha(orphan.bytes);
  const orphanRelpath = 'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Waisen/files/orphan-known.bin';
  const orphanAck = path.join(
    path.dirname(orphan.target),
    `.ablage-waise-${orphanSha.slice(0, 16)}-1234abcd.json`
  );
  fs.writeFileSync(orphanAck, JSON.stringify({
    format: 'Betreuungsbüro-Waise/1',
    originalPath: 'orphan-known',
    sourceRoot: 'files',
    storedPath: orphanRelpath,
    size: orphan.stat.size,
    sha256: orphanSha,
    migratedAt: '2026-07-28T10:00:00.000Z'
  }));

  // Eine inhaltsgleiche Waise darf als geprüfter Verweis auf eine bereits
  // indexierte Datei quittiert werden. Die Quittung bleibt im Waisenordner,
  // die Nutzdaten liegen aber nur einmal im Dokumentenspeicher.
  const canonicalId = 'abababab-abab-4bab-8bab-abababababab';
  const canonicalRelpath = 'Fallakten/M/Muster/00 - Eingang/Kanonisch.bin';
  const canonical = f.write(canonicalRelpath, 'kanonischer-inhalt');
  const canonicalSha = sha(canonical.bytes);
  f.addRow({
    id: canonicalId,
    name: 'Kanonisch.bin',
    size: canonical.stat.size,
    sha256: canonicalSha,
    storageRelpath: canonicalRelpath,
    storageDev: String(canonical.stat.dev),
    storageIno: String(canonical.stat.ino)
  });
  fs.writeFileSync(
    path.join(
      path.dirname(orphan.target),
      `.ablage-waise-${canonicalSha.slice(0, 16)}-deadd001.json`
    ),
    JSON.stringify({
      format: 'Betreuungsbüro-Waise/1',
      originalPath: 'duplicate-orphan.bin',
      sourceRoot: 'case-doku-photos',
      storedPath: canonicalRelpath,
      canonicalFileId: canonicalId,
      deduplicated: true,
      size: canonical.stat.size,
      sha256: canonicalSha,
      migratedAt: '2026-07-28T10:00:00.000Z'
    })
  );

  // Derselbe Inhalt darf nicht als Finder-Kandidat für eine fehlende Indexdatei
  // missverstanden werden.
  f.addRow({
    id: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    name: 'Vermisst.bin',
    size: orphan.stat.size,
    sha256: orphanSha,
    storageRelpath: 'Fallakten/M/Muster/00 - Eingang/Vermisst.bin'
  });

  const reportBase = 'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Umstellungsberichte/Umstellung-2026-07-28-run';
  f.write(reportBase + '.json', JSON.stringify({
    format: 'Betreuungsbüro-Umstellungsbericht/1',
    runId: 'run-1',
    dryRun: false,
    status: 'complete',
    summary: { moved: 1 },
    entries: []
  }));
  f.write(reportBase + '.txt', 'UMSTELLUNGSBERICHT DOKUMENTENSPEICHER\n');

  const unacknowledged = f.write('Büroorganisation/_Verwaltung & Sicherungen/_Technik/Waisen/files/unquittiert.bin', 'sichtbar');
  const invalidTarget = f.write('Büroorganisation/_Verwaltung & Sicherungen/_Technik/Waisen/files/falsch-quittiert.bin', 'falsch');
  const invalidSha = sha(invalidTarget.bytes);
  fs.writeFileSync(
    path.join(
      path.dirname(invalidTarget.target),
      `.ablage-waise-${invalidSha.slice(0, 16)}-feedbeef.json`
    ),
    JSON.stringify({
      format: 'Betreuungsbüro-Waise/1',
      originalPath: 'falsch-quittiert.bin',
      sourceRoot: 'files',
      storedPath: 'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Waisen/files/falsch-quittiert.bin',
      size: invalidTarget.stat.size,
      sha256: '0'.repeat(64)
    })
  );
  const foreignReport = f.write(
    'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Umstellungsberichte/Fremde-Datei.txt',
    'kein zugehöriger gültiger JSON-Bericht'
  );
  const outside = f.write('Fallakten/Z/Unbekannt/00 - Eingang/Fundstück.txt', 'außerhalb');

  const result = await f.reconciler.scan();
  const byPath = new Map(result.findings.map((finding) => [finding.storageRelpath, finding]));

  assert.equal(result.summary.acknowledgedOrphans, 2);
  assert.equal(result.summary.acknowledgedOrphanReferences, 1);
  assert.equal(result.summary.technicalManagementFiles, 2);
  assert.equal(byPath.has(orphanRelpath), false, 'quittierte Waise darf nicht erneut gemeldet werden');
  assert.equal(
    result.findings.some((finding) => (
      finding.kind === 'orphan_ack_invalid'
      && finding.storageRelpath.includes('deadd001')
    )),
    false,
    'geprüfter Waisenverweis auf eine indexierte Datei muss gültig bleiben'
  );
  assert.equal(byPath.has(reportBase + '.json'), false, 'gültiger JSON-Bericht ist Technik');
  assert.equal(byPath.has(reportBase + '.txt'), false, 'zugehöriger Textbericht ist Technik');
  assert.equal(
    result.findings.some((finding) => finding.kind === 'orphan_sidecar'
      && finding.storageRelpath.includes('.ablage-waise-')),
    false,
    'Waisenquittung ist kein normaler Datei-Sidecar'
  );
  assert.equal(
    result.findings.some((finding) => finding.kind === 'relocation_detected'
      && finding.fileId === 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'),
    false,
    'quittierte Waise darf keine fehlende Indexdatei kapern'
  );
  assert.equal(byPath.get(
    'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Waisen/files/unquittiert.bin'
  ).kind, 'management_unindexed_file');
  assert.equal(byPath.get(
    'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Waisen/files/falsch-quittiert.bin'
  ).kind, 'management_unindexed_file');
  assert.equal(byPath.get(
    'Büroorganisation/_Verwaltung & Sicherungen/_Technik/Umstellungsberichte/Fremde-Datei.txt'
  ).kind, 'management_unindexed_file');
  assert.equal(byPath.get(
    'Fallakten/Z/Unbekannt/00 - Eingang/Fundstück.txt'
  ).kind, 'unindexed_file');
  assert.ok(result.findings.some((finding) => finding.kind === 'orphan_ack_invalid'
    && finding.detail.problems.includes('sha256_mismatch')));

  for (const entry of [unacknowledged, foreignReport, outside]) {
    assert.equal(fs.existsSync(entry.target), true, 'Leseabgleich darf unbekannte Datei nicht verändern');
  }
});

test('automatischer Vollabgleich verändert verwaltete Abbilder nicht', async (t) => {
  const f = fixture();
  t.after(f.close);
  const relpath = 'Büroorganisation/_Verwaltung & Sicherungen/Sicherheit.json.enc';
  const original = f.write(relpath, 'alt');
  const row = f.addRow({
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    area: 'management',
    caseId: '',
    folderId: '',
    name: 'Sicherheit.json.enc',
    size: original.stat.size,
    sha256: sha(original.bytes),
    storageRelpath: relpath,
    storageDev: String(original.stat.dev),
    storageIno: String(original.stat.ino),
    managed: true,
    artifactKind: 'security-encrypted'
  });
  f.writeSidecar(row, original.target);
  fs.writeFileSync(original.target, 'neuer fremder Inhalt');

  const before = f.db.prepare('SELECT * FROM doc_files WHERE id=?').get(row.id);
  const result = await f.reconciler.apply();
  const after = f.db.prepare('SELECT * FROM doc_files WHERE id=?').get(row.id);

  assert.deepEqual(after, before, 'Automatik darf Metadaten eines verwalteten Abbilds nicht verändern');
  assert.ok(result.findings.some((finding) => (
    finding.kind === 'managed_change_requires_confirmation'
    && finding.fileId === row.id
    && finding.detail.automaticApply === false
  )));
});
