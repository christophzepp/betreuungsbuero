'use strict';

/*
 * Isolierter HTTP-Vertragstest. Er benutzt ausschließlich /private/tmp, eine
 * eigene SQLite-Datenbank und listen(0); Produktivdaten und Produktivports
 * werden weder gelesen noch verändert.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const express = require('express');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function storedZipEntries(bytes) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034B50) {
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    assert.ok(flags & 0x0800, 'Jeder ZIP-Name muss als UTF-8 markiert sein.');
    assert.equal(method, 0, 'Der Projekt-ZIP-Writer verwendet die robuste STORE-Methode.');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8');
    entries.set(name, bytes.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

async function main() {
  const temp = fs.mkdtempSync('/private/tmp/handover-endpoint-test-');
  const dbPath = path.join(temp, 'fixture.sqlite3');
  const dataRoot = path.join(temp, 'data');
  const storageRoot = path.join(temp, 'Dokumentenspeicher');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(storageRoot, { recursive: true });

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
    VALUES (1, 'handover-test', 'x', 'Handover Test', 1, 1, 1)
  `).run();
  db.prepare(`
    INSERT INTO cases
      (id, label, file_number, stammdaten_json, archived)
    VALUES (?, ?, ?, ?, 0)
  `).run(
    'case-handover',
    'Müller, Jörg 650203',
    '17 XVII 42/26',
    JSON.stringify({
      person: { lastName: 'Müller', firstName: 'Jörg', birthDate: '03.02.1965' },
      care: { reportPeriod: '01.03. - 28.02.' }
    })
  );
  db.prepare(`
    INSERT INTO case_reports (case_id, report_id, data_json, updated_by)
    VALUES ('case-handover', 'annual_report', ?, 1)
  `).run(JSON.stringify({ title: 'Jahresbericht § 1863 BGB', status: 'fertig' }));
  db.prepare(`
    INSERT INTO case_doku_entries (id, case_id, data_json, updated_by)
    VALUES ('doku-1', 'case-handover', ?, 1)
  `).run(JSON.stringify({ date: '24.07.2026', type: 'Hausbesuch' }));
  db.prepare(`
    INSERT INTO case_contacts (id, case_id, data_json, updated_by)
    VALUES ('kontakt-1', 'case-handover', ?, 1)
  `).run(JSON.stringify({ name: 'Amtsgericht München' }));
  db.prepare(`
    INSERT INTO office_json (key, data_json, updated_by)
    VALUES ('documents_config', ?, 1)
  `).run(JSON.stringify({ storageLayout: 'real-folders-v1', storageRoot }));

  const documentsRouter = require('../src/modules/documents/routes');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    req.session = {
      userId: 1,
      username: 'handover-test',
      displayName: 'Handover Test',
      isAdmin: true,
      canViewDocuments: true,
      canEditDocuments: true,
      canDocsAllCases: true,
      mode: 'online'
    };
    next();
  });
  app.use('/api/documents', documentsRouter);

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}/api/documents`;
  const jsonRequest = async (route, options) => {
    const response = await fetch(base + route, options);
    return { response, body: await response.json() };
  };

  try {
    let result = await jsonRequest('/falluebergabe-zip');
    assert.equal(result.response.status, 400);
    assert.equal(result.body.code, 'CASE_ID_REQUIRED');

    result = await jsonRequest('/falluebergabe-zip?caseId=unbekannt');
    assert.equal(result.response.status, 404);
    assert.equal(result.body.code, 'CASE_NOT_FOUND');

    result = await jsonRequest('/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        area: 'case',
        caseId: 'case-handover',
        name: '02 - Kerndokumente'
      })
    });
    assert.equal(result.response.status, 201);
    const folderId = result.body.id;
    const documentBytes = Buffer.from('Bestallungsurkunde für Jörg Müller – § 1872 BGB', 'utf8');
    result = await jsonRequest('/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        area: 'case',
        caseId: 'case-handover',
        folderId,
        fileName: '260724 Müller, Jörg Bestallungsurkunde.txt',
        mimeType: 'text/plain',
        dataBase64: documentBytes.toString('base64')
      })
    });
    assert.equal(result.response.status, 201);

    const materializationModule = require('../src/modules/documents/materializations');
    const originalMaterializationCurrent = materializationModule.current;
    materializationModule.current = () => ({
      runCase: () => [{
        artifactKind: 'case-backup-json',
        changed: false,
        error: 'simulierter Fehler beim aktuellen Sicherung.json'
      }]
    });
    try {
      result = await jsonRequest('/falluebergabe-zip?caseId=case-handover');
      assert.equal(result.response.status, 409);
      assert.equal(result.body.code, 'HANDOVER_MATERIALIZATION_FAILED');
      assert.match(result.body.detail, /simulierter Fehler/);
    } finally {
      materializationModule.current = originalMaterializationCurrent;
    }

    const indexedFile = db.prepare(
      "SELECT id,storage_relpath FROM doc_files WHERE area='case' AND case_id=? AND deleted_at=''"
    ).get('case-handover');
    const finderNewPath = path.join(
      storageRoot,
      ...path.posix.dirname(indexedFile.storage_relpath).split('/'),
      '260726 Müller, Jörg Finder-Nachtrag.txt'
    );
    fs.writeFileSync(finderNewPath, Buffer.from('noch nicht abgeglichener Finder-Nachtrag\n'));
    const rowsBeforeFinderGuard = db.prepare(
      "SELECT id,name,deleted_at FROM doc_files WHERE area='case' AND case_id=? ORDER BY id"
    ).all('case-handover');
    result = await jsonRequest('/falluebergabe-zip?caseId=case-handover');
    assert.equal(result.response.status, 409);
    assert.equal(result.body.code, 'HANDOVER_UNINDEXED_FILES');
    assert.equal(result.body.unindexedCount, 1);
    assert.deepEqual(result.body.unindexed, [{
      path: path.relative(storageRoot, finderNewPath).split(path.sep).join('/'),
      name: '260726 Müller, Jörg Finder-Nachtrag.txt',
      size: fs.statSync(finderNewPath).size,
      reason: 'not_indexed'
    }]);
    assert.deepEqual(
      db.prepare("SELECT id,name,deleted_at FROM doc_files WHERE area='case' AND case_id=? ORDER BY id")
        .all('case-handover'),
      rowsBeforeFinderGuard,
      'der Übergabe-Leselauf darf weder Dateien einlesen noch Indexzeilen löschen'
    );
    assert.ok(fs.existsSync(finderNewPath), 'der Übergabe-Leselauf darf Finder-Dateien nicht löschen');
    fs.unlinkSync(finderNewPath);

    // Der globale Finder-Scanner darf das Paket nur mit Befunden des
    // angefragten Falls blockieren.
    db.prepare(`
      INSERT INTO cases
        (id, label, file_number, stammdaten_json, archived)
      VALUES (?, ?, '', ?, 0)
    `).run(
      'case-other',
      'Anders, Anna',
      JSON.stringify({
        person: { lastName: 'Anders', firstName: 'Anna', birthDate: '01.01.1970' }
      })
    );
    result = await jsonRequest('/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        area: 'case',
        caseId: 'case-other',
        name: '02 - Kerndokumente'
      })
    });
    assert.equal(result.response.status, 201);
    const otherFolder = db.prepare('SELECT storage_relpath FROM doc_folders WHERE id=?').get(result.body.id);
    const otherFinderNewPath = path.join(
      storageRoot,
      ...otherFolder.storage_relpath.split('/'),
      '260726 Anders, Anna Finder-Nachtrag.txt'
    );
    fs.writeFileSync(otherFinderNewPath, Buffer.from('anderer Fall\n'));

    // Verzeichnet, aber ohne Inhalt: Das Paket muss sichtbar und atomar mit
    // 409 scheitern; eine Teil-ZIP-Antwort wäre rechtswidrig missverständlich.
    db.prepare(`
      INSERT INTO doc_files
        (id, area, case_id, folder_id, name, name_key, mime_type, size, sha256)
      VALUES
        ('missing-file', 'case', 'case-handover', ?, '260725 Fehlender Beschluss.pdf',
         '260725 fehlender beschluss.pdf', 'application/pdf', 1234, ?)
    `).run(folderId, '0'.repeat(64));
    result = await jsonRequest('/falluebergabe-zip?caseId=case-handover');
    assert.equal(result.response.status, 409);
    assert.equal(result.body.code, 'HANDOVER_FILES_MISSING');
    assert.equal(result.body.expectedCount, 2);
    assert.equal(result.body.includedCount, 1);
    assert.equal(result.body.missingCount, 1);
    assert.deepEqual(result.body.missing, [{
      fileId: 'missing-file',
      name: '260725 Fehlender Beschluss.pdf',
      path: 'Fallakte/02 - Kerndokumente/260725 Fehlender Beschluss.pdf',
      reason: 'file_missing'
    }]);
    assert.notEqual(result.response.headers.get('content-type'), 'application/zip');

    db.prepare("DELETE FROM doc_files WHERE id='missing-file'").run();
    const response = await fetch(base + '/falluebergabe-zip?caseId=case-handover');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.equal(response.headers.get('x-handover-documents'), '1');
    assert.equal(response.headers.get('x-handover-missing'), '0');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-disposition') || '', /Falluebergabe_/);
    assert.match(response.headers.get('content-disposition') || '', /filename\*=UTF-8''/);
    const zipBytes = Buffer.from(await response.arrayBuffer());
    assert.ok(zipBytes.length > 1000);

    const zipPath = path.join(temp, 'Falluebergabe.zip');
    fs.writeFileSync(zipPath, zipBytes);
    execFileSync('/usr/bin/unzip', ['-t', zipPath], { stdio: 'pipe' });
    const zipEntries = storedZipEntries(zipBytes);
    const entries = [...zipEntries.keys()];
    const documentPath = 'Fallakte/02 - Kerndokumente/260724 Müller, Jörg Bestallungsurkunde.txt';
    assert.deepEqual(entries.sort(), [
      documentPath,
      'Falldaten.json',
      'Inhaltsverzeichnis.pdf',
      'Pruefsummen-SHA256.txt',
      'Sicherung.json',
      'Uebergabeprotokoll.pdf'
    ].sort());

    const extract = (entry) => {
      assert.ok(zipEntries.has(entry), `ZIP-Eintrag fehlt: ${entry}`);
      return zipEntries.get(entry);
    };
    assert.deepEqual(extract(documentPath), documentBytes);
    const caseData = JSON.parse(extract('Falldaten.json').toString('utf8'));
    assert.equal(caseData.schemaVersion, 1);
    assert.equal(caseData.case.fileNumber, '17 XVII 42/26');
    assert.equal(caseData.stammdaten.person.lastName, 'Müller');
    assert.equal(caseData.reports[0].data.title, 'Jahresbericht § 1863 BGB');
    assert.equal(caseData.dokuEntries[0].data.type, 'Hausbesuch');
    assert.equal(caseData.contacts[0].data.name, 'Amtsgericht München');
    assert.equal(caseData.documents[0].path, documentPath);

    const manifest = extract('Pruefsummen-SHA256.txt').toString('utf8');
    for (const entry of [
      documentPath,
      'Falldaten.json',
      'Inhaltsverzeichnis.pdf',
      'Uebergabeprotokoll.pdf'
    ]) {
      const bytes = extract(entry);
      assert.ok(manifest.includes(`${sha256(bytes)}\t${bytes.length}\t${entry}`));
    }
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
  .then(() => console.log('handover-endpoint: complete package and visible 409 verified'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
