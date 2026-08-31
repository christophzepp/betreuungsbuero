'use strict';

/*
 * Isolierter HTTP-Vertragstest für die zwei sicherheitskritischen Übergänge:
 * alte baseDir-Konfiguration -> neue storageRoot-Konfiguration und
 * Berichts-/Historienexport -> Register 10/11. Er benutzt ausschließlich eine
 * temporäre SQLite-Datei, einen temporären Datenbaum und einen vom Betriebssystem
 * vergebenen Port (listen(0)).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'documents-route-real-folders-'));
  const dbPath = path.join(temp, 'fixture.sqlite3');
  const dataRoot = path.join(temp, 'data');
  const legacyRoot = path.join(temp, 'legacy-blobs');
  const legacyCaseRoot = path.join(temp, 'legacy-case');
  const storageRoot = path.join(temp, 'readable-store');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.mkdirSync(legacyCaseRoot, { recursive: true });

  process.env.DB_PATH = dbPath;
  process.env.DOCUMENTS_DATA_ROOT = dataRoot;

  const originalLog = console.log;
  let db;
  try {
    console.log = (...args) => {
      if (!String(args[0] || '').startsWith('[Fallrechte] Kein Admin-Konto gefunden')) {
        originalLog(...args);
      }
    };
    db = require('../src/database/index');
  } finally {
    console.log = originalLog;
  }
  db.prepare(`
    INSERT INTO users
      (id, username, password_hash, display_name, is_admin, allow_local, allow_online)
    VALUES (1, 'route-test', 'x', 'Route Test', 1, 1, 1)
  `).run();
  db.prepare(`
    INSERT INTO cases (id, label, stammdaten_json, archived)
    VALUES (?, ?, ?, 0)
  `).run('case-route', 'Muster, Mira', JSON.stringify({
    person: { lastName: 'Muster', firstName: 'Mira', birthDate: '03.04.1980' },
    care: { reportPeriod: '01.03. - 28.02.' }
  }));
  const documents = require('../src/modules/documents/routes');
  const documentsStream = require('../src/modules/documents/stream');

  const putRawConfig = (value) => db.prepare(`
    INSERT INTO office_json (key, data_json, updated_by)
    VALUES ('documents_config', ?, 1)
    ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json, updated_by=1
  `).run(JSON.stringify(value));

  // Historische Bedeutung: baseDir ist ein UUID-Blobort und darf nicht als
  // neue Klarname-Wurzel interpretiert werden.
  putRawConfig({ baseDir: dataRoot, caseDirs: {} });

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    req.session = {
      userId: 1,
      username: 'route-test',
      displayName: 'Route Test',
      isAdmin: true,
      canViewDocuments: true,
      canEditDocuments: true,
      canManageOfficeProfile: true,
      canDocsAllCases: true,
      mode: 'online'
    };
    next();
  });
  app.use('/api/documents/strom', documentsStream);
  app.use('/api/documents', documents);

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/api/documents`;
  const request = async (route, options) => {
    const response = await fetch(base + route, options);
    const body = await response.json();
    return { response, body };
  };

  try {
    let result = await request('/config');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.storageRoot, '');
    assert.equal(result.body.baseDir, '');
    assert.deepEqual(result.body.legacyLocations, [dataRoot]);

    // Leer bedeutet DEFAULT_DIR. Auch diese effektive Wurzel muss disjunkt
    // vom alten baseDir sein; hier liegt sie absichtlich darunter.
    result = await request('/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storageRoot: '' })
    });
    assert.equal(result.response.status, 400);
    assert.match(result.body.error, /Blob-\/Fallordner/);

    putRawConfig({
      baseDir: legacyRoot,
      caseDirs: { 'case-route': legacyCaseRoot },
      autoOcr: true
    });
    result = await request('/config');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.storageRoot, '');
    assert.deepEqual(result.body.legacyLocations.sort(), [legacyCaseRoot, legacyRoot].sort());

    result = await request('/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storageRoot })
    });
    assert.equal(result.response.status, 200);
    const storedConfig = JSON.parse(db.prepare(
      "SELECT data_json FROM office_json WHERE key='documents_config'"
    ).get().data_json);
    assert.equal(storedConfig.storageLayout, 'real-folders-v1');
    assert.equal(storedConfig.storageRoot, storageRoot);
    assert.equal(storedConfig.legacyBaseDir, legacyRoot);
    assert.deepEqual(storedConfig.caseDirs, { 'case-route': legacyCaseRoot });
    const marker = JSON.parse(fs.readFileSync(path.join(storageRoot, '.ablage-speicherkennung.json'), 'utf8'));
    assert.equal(marker.format, 'Betreuungsbuero-Dokumentenspeicher/1');
    assert.match(marker.id, /^[0-9a-f-]{36}$/i);

    const commonExport = {
      area: 'case',
      caseId: 'case-route',
      historyId: 'history-accounting',
      fileName: '260724 Muster Rechnungslegung.pdf',
      dataBase64: Buffer.from('rechnung').toString('base64'),
      mimeType: 'application/pdf',
      jahr: '2026',
      monat: '07'
    };
    result = await request('/export-ablage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...commonExport, reportId: 'accounting' })
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.ordnerPfad,
      '10 - Berichte & Rechnungslegung/Rechnungslegung (§ 1865 BGB)/2026-03 bis 2027-02');
    let row = db.prepare('SELECT * FROM doc_files WHERE id=?').get(result.body.fileId);
    assert.ok(row.storage_relpath.startsWith(
      'Fallakten/M/Muster, Mira/10 - Berichte & Rechnungslegung/Rechnungslegung (§ 1865 BGB)/2026-03 bis 2027-02/'
    ));
    const accountingPath = path.join(storageRoot, ...row.storage_relpath.split('/'));
    assert.equal(fs.readFileSync(accountingPath, 'utf8'), 'rechnung');

    // Der nachträgliche Hashlauf muss auch für 1-GiB-Uploads blockweise arbeiten. Ein
    // absichtliches readFileSync-Verbot für genau den Dateiinhalt beweist, dass die Route
    // den gemeinsamen 1-MiB-Streaminghelfer verwendet.
    db.prepare("UPDATE doc_files SET sha256='' WHERE id=?").run(row.id);
    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = function guardedReadFileSync(filePath, ...args) {
      if (path.resolve(String(filePath)) === path.resolve(accountingPath)) {
        throw new Error('Vollständiges Einlesen des Dokumentinhalts ist im Hashlauf verboten.');
      }
      return originalReadFileSync.call(fs, filePath, ...args);
    };
    try {
      result = await request('/duplikate-scan', { method: 'POST' });
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
    assert.equal(result.response.status, 200);
    assert.equal(result.body.gehasht, 1);
    assert.match(db.prepare('SELECT sha256 FROM doc_files WHERE id=?').get(row.id).sha256, /^[a-f0-9]{64}$/);

    result = await request('/export-ablage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...commonExport,
        historyId: 'history-free',
        fileName: '260724 Muster Schreiben.pdf',
        reportId: 'free_document'
      })
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.ordnerPfad,
      '11 - Betreuungsführung/Dokumentenausgang/2026/07');

    result = await request('/export-ablage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...commonExport,
        area: 'office',
        caseId: '',
        historyId: 'history-office',
        reportId: 'annual_assets'
      })
    });
    assert.equal(result.response.status, 400);
    assert.match(result.body.error, /nur in einer Fallakte/);
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS n FROM doc_module_import WHERE quelle='exportablage' AND quell_id LIKE 'history-office|%'"
    ).get().n, 0);

    // Wird eine vorhandene Fallakte zusätzlich im Posteingang verknüpft, muss
    // deren belastbare ID erhalten bleiben. Das Label allein wäre ab jetzt
    // mehrdeutig und dürfte den bekannten Bezug nicht zur Büroablage machen.
    db.prepare(`
      INSERT INTO cases (id, label, stammdaten_json, archived)
      VALUES (?, ?, ?, 0)
    `).run('case-route-gleichnamig', 'Muster, Mira', JSON.stringify({
      person: { lastName: 'Muster', firstName: 'Mira', birthDate: '05.06.1990' }
    }));
    result = await request(`/files/${row.id}/zum-posteingang`, { method: 'POST' });
    assert.equal(result.response.status, 201);
    assert.deepEqual(
      db.prepare('SELECT case_id, case_label FROM inbox_documents WHERE id=?')
        .get(result.body.inboxId),
      { case_id: 'case-route', case_label: 'Muster, Mira' }
    );

    // Erzwingt einen Fehler genau zwischen INSERT doc_files und dem
    // Storage-Metadaten-UPDATE. Die Route muss DB und Platte gemeinsam
    // zurückrollen; andernfalls entstünde wieder eine Zeile ohne Inhalt.
    db.exec(`
      CREATE TRIGGER route_test_fail_storage_update
      BEFORE UPDATE OF storage_relpath ON doc_files
      WHEN NEW.storage_relpath != ''
      BEGIN
        SELECT RAISE(ABORT, 'erzwungener Storage-Metadatenfehler');
      END
    `);
    const beforeFailedUpload = db.prepare('SELECT COUNT(*) AS n FROM doc_files').get().n;
    result = await request('/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        area: 'case',
        caseId: 'case-route',
        fileName: '260724 Muss verschwinden.pdf',
        dataBase64: Buffer.from('transaktion').toString('base64'),
        mimeType: 'application/pdf'
      })
    });
    assert.equal(result.response.status, 500);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM doc_files').get().n, beforeFailedUpload);
    const allNames = [];
    const collectNames = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) collectNames(absolute);
        else allNames.push(entry.name);
      }
    };
    collectNames(storageRoot);
    assert.ok(!allNames.includes('260724 Muss verschwinden.pdf'));

    assert.throws(() => documents.intern.dateiAblegen(
      'case', 'case-route', '', '260724 Intern muss verschwinden.pdf',
      'application/pdf', Buffer.from('intern'), 1
    ), /erzwungener Storage-Metadatenfehler/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM doc_files').get().n, beforeFailedUpload);
    const afterInternalNames = [];
    const collectInternalNames = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) collectInternalNames(absolute);
        else afterInternalNames.push(entry.name);
      }
    };
    collectInternalNames(storageRoot);
    assert.ok(!afterInternalNames.includes('260724 Intern muss verschwinden.pdf'));

    result = await request('/strom/files?area=case&caseId=case-route', {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'x-datei-name': encodeURIComponent('260724 Strom muss verschwinden.pdf')
      },
      body: Buffer.from('strom')
    });
    assert.equal(result.response.status, 500);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM doc_files').get().n, beforeFailedUpload);
    const afterStreamNames = [];
    const collectStreamNames = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) collectStreamNames(absolute);
        else afterStreamNames.push(entry.name);
      }
    };
    collectStreamNames(storageRoot);
    assert.ok(!afterStreamNames.includes('260724 Strom muss verschwinden.pdf'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + suffix); } catch (_error) { /* bereits entfernt */ }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main()
  .then(() => console.log('documents-route-real-folders: config compatibility and export routing ok'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
