'use strict';

/*
 * Fehler-Injektion für alle Ersetzungsphasen. Ausschließlich temporäre DB,
 * temporärer Dokumentenspeicher und listen(0); kein Produktivprozess/-bestand.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'documents-replacement-rollback-'));
  const dbPath = path.join(temp, 'fixture.sqlite3');
  const dataRoot = path.join(temp, 'data');
  const storageRoot = path.join(temp, 'Dokumentenspeicher');
  fs.mkdirSync(dataRoot, { recursive: true });
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
    VALUES (1, 'replacement-test', 'x', 'Replacement Test', 1, 1, 1)
  `).run();
  db.prepare(`
    INSERT INTO cases (id, label, stammdaten_json, archived)
    VALUES (?, ?, ?, 0)
  `).run('case-replacement', 'Sicher, Sara', JSON.stringify({
    person: { lastName: 'Sicher', firstName: 'Sara', birthDate: '02.03.1970' }
  }));
  db.prepare(`
    INSERT INTO office_json (key, data_json, updated_by)
    VALUES ('documents_config', ?, 1)
  `).run(JSON.stringify({
    storageLayout: 'real-folders-v1',
    storageRoot,
    legacyBaseDir: '',
    caseDirs: {}
  }));

  const documents = require('../src/modules/documents/routes');
  const documentsStream = require('../src/modules/documents/stream');
  const app = express();
  app.use((req, _res, next) => {
    req.session = {
      userId: 1,
      username: 'replacement-test',
      displayName: 'Replacement Test',
      isAdmin: true,
      canViewDocuments: true,
      canEditDocuments: true,
      canDocsAllCases: true,
      mode: 'online'
    };
    next();
  });
  app.use('/api/documents/strom', documentsStream);
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/documents', documents);

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/api/documents`;
  const request = async (route, options) => {
    const response = await fetch(base + route, options);
    const contentType = String(response.headers.get('content-type') || '');
    const body = contentType.includes('json') ? await response.json() : await response.text();
    return { response, body };
  };
  const json = (value) => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value)
  });
  const fileRow = (id) => db.prepare('SELECT * FROM doc_files WHERE id=?').get(id);
  const state = (id) => {
    const row = fileRow(id);
    const filePath = documents.intern.findBlobPath(row);
    return {
      row,
      filePath,
      bytes: fs.readFileSync(filePath),
      actualSha: documents.intern.documentStorage.sha256File(filePath)
    };
  };
  const assertUnchanged = (id, before, label) => {
    const after = state(id);
    assert.equal(after.row.storage_relpath, before.row.storage_relpath, `${label}: Speicherpfad`);
    assert.equal(after.row.sha256, before.row.sha256, `${label}: DB-Prüfsumme`);
    assert.equal(after.row.size, before.row.size, `${label}: DB-Größe`);
    assert.equal(after.row.name, before.row.name, `${label}: Name`);
    assert.equal(after.filePath, before.filePath, `${label}: Primärpfad`);
    assert.deepEqual(after.bytes, before.bytes, `${label}: Primärinhalt`);
    assert.equal(after.actualSha, before.actualSha, `${label}: Ist-Prüfsumme`);
  };

  try {
    let result = await request('/files', {
      method: 'POST',
      ...json({
        area: 'case',
        caseId: 'case-replacement',
        fileName: '260724 Sicher Bericht.pdf',
        dataBase64: Buffer.from('fassung-eins').toString('base64'),
        mimeType: 'application/pdf'
      })
    });
    assert.equal(result.response.status, 201);
    const fileId = result.body.id;

    // Erfolgsweg: alte Primärdatei bleibt als echte Version erhalten.
    result = await request(`/files/${fileId}/ersetzen`, {
      method: 'POST',
      ...json({
        dataBase64: Buffer.from('fassung-zwei').toString('base64'),
        mimeType: 'application/pdf'
      })
    });
    assert.equal(result.response.status, 200);
    let current = state(fileId);
    assert.equal(current.bytes.toString(), 'fassung-zwei');
    assert.equal(current.row.sha256, sha(Buffer.from('fassung-zwei')));
    let versions = db.prepare(
      'SELECT * FROM doc_versions WHERE file_id=? ORDER BY created_at, rowid'
    ).all(fileId);
    assert.equal(versions.length, 1);
    let versionPath = path.join(storageRoot, ...versions[0].storage_relpath.split('/'));
    assert.equal(fs.readFileSync(versionPath, 'utf8'), 'fassung-eins');
    assert.ok(fs.existsSync(documents.intern.documentStorage.sidecarPath(versionPath, versions[0].id)));

    // Erfolgsweg Restore: aktuelle Fassung wird vorher ebenfalls versioniert.
    result = await request(`/files/${fileId}/versionen/${versions[0].id}/restore`, {
      method: 'POST',
      ...json({})
    });
    assert.equal(result.response.status, 200);
    current = state(fileId);
    assert.equal(current.bytes.toString(), 'fassung-eins');
    assert.equal(current.row.sha256, sha(Buffer.from('fassung-eins')));
    versions = db.prepare(
      'SELECT * FROM doc_versions WHERE file_id=? ORDER BY created_at, rowid'
    ).all(fileId);
    assert.equal(versions.length, 2);
    const versionWithTwo = versions.find((version) => {
      const candidate = path.join(storageRoot, ...version.storage_relpath.split('/'));
      return fs.readFileSync(candidate, 'utf8') === 'fassung-zwei';
    });
    assert.ok(versionWithTwo);

    // 1. Fehler beim Versionseintrag: Kopie/Fehlversuch dürfen entstehen,
    //    Primärdatei und doc_files bleiben unverändert.
    let before = state(fileId);
    let versionCount = versions.length;
    db.exec(`
      CREATE TRIGGER replacement_fail_version_insert
      BEFORE INSERT ON doc_versions
      BEGIN
        SELECT RAISE(ABORT, 'erzwungener Versions-DB-Fehler');
      END
    `);
    result = await request(`/files/${fileId}/ersetzen`, {
      method: 'POST',
      ...json({
        dataBase64: Buffer.from('darf-nicht-versionieren').toString('base64'),
        mimeType: 'application/pdf'
      })
    });
    assert.equal(result.response.status, 500);
    assert.match(result.body.error, /bisherige Primärdatei bleibt erreichbar/);
    assertUnchanged(fileId, before, 'Versions-INSERT-Fehler');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM doc_versions WHERE file_id=?').get(fileId).n,
      versionCount);
    db.exec('DROP TRIGGER replacement_fail_version_insert');

    // 2. Auch mit bereits abweichender DB-Prüfsumme darf ein Fehler VOR dem
    //    Tausch die physisch unberührte Primärdatei nicht fälschlich wegräumen.
    const actualBeforeStale = state(fileId);
    db.prepare("UPDATE doc_files SET sha256='stale-index-hash' WHERE id=?").run(fileId);
    before = state(fileId);
    db.exec(`
      CREATE TRIGGER replacement_fail_stale_version_insert
      BEFORE INSERT ON doc_versions
      BEGIN
        SELECT RAISE(ABORT, 'erzwungener Versionsfehler bei stale hash');
      END
    `);
    result = await request(`/files/${fileId}/ersetzen`, {
      method: 'POST',
      ...json({
        dataBase64: Buffer.from('darf-stale-nicht-bewegen').toString('base64'),
        mimeType: 'application/pdf'
      })
    });
    assert.equal(result.response.status, 500);
    assertUnchanged(fileId, before, 'Versionsfehler bei abweichendem Index-Hash');
    db.exec('DROP TRIGGER replacement_fail_stale_version_insert');
    db.prepare('UPDATE doc_files SET sha256=? WHERE id=?').run(actualBeforeStale.actualSha, fileId);
    documents.intern.documentStorage.writeSidecar(fileRow(fileId), actualBeforeStale.filePath);

    // 3. Fehler im Metadaten-UPDATE nach physischem Tausch.
    before = state(fileId);
    versionCount = db.prepare(
      'SELECT COUNT(*) AS n FROM doc_versions WHERE file_id=?'
    ).get(fileId).n;
    db.exec(`
      CREATE TRIGGER replacement_fail_storage_update
      BEFORE UPDATE OF storage_relpath ON doc_files
      WHEN NEW.storage_relpath != ''
      BEGIN
        SELECT RAISE(ABORT, 'erzwungener Ersetzungs-DB-Fehler');
      END
    `);
    result = await request(`/files/${fileId}/ersetzen`, {
      method: 'POST',
      ...json({
        dataBase64: Buffer.from('darf-nicht-committen').toString('base64'),
        mimeType: 'application/pdf'
      })
    });
    assert.equal(result.response.status, 500);
    assertUnchanged(fileId, before, 'Storage-UPDATE-Fehler');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM doc_versions WHERE file_id=?').get(fileId).n,
      versionCount + 1, 'Die vorsorgliche Version bleibt als sicherer Zwischenstand erhalten.');
    db.exec('DROP TRIGGER replacement_fail_storage_update');

    // 4. Sidecarfehler nach allen DB-Updates: Transaktion muss rollen,
    //    obwohl der Dateiinhalt bereits kurz ausgetauscht war.
    before = state(fileId);
    const sidecar = documents.intern.documentStorage.sidecarPath(before.filePath, fileId);
    fs.unlinkSync(sidecar);
    fs.mkdirSync(sidecar);
    result = await request(`/files/${fileId}/ersetzen`, {
      method: 'POST',
      ...json({
        dataBase64: Buffer.from('darf-kein-sidecar-commit-sein').toString('base64'),
        mimeType: 'application/pdf'
      })
    });
    assert.equal(result.response.status, 500);
    assertUnchanged(fileId, before, 'Sidecarfehler');
    assert.ok(fs.statSync(sidecar).isDirectory());
    fs.rmdirSync(sidecar);
    documents.intern.documentStorage.writeSidecar(fileRow(fileId), before.filePath);

    // 5. Sidecar wurde bereits atomar durch die neue Fassung ersetzt und
    //    meldet erst danach einen Fehler: auch dann muss der alte Sidecar zurück.
    before = state(fileId);
    const originalWriteSidecar = documents.intern.documentStorage.writeSidecar;
    const failingSha = sha(Buffer.from('sidecar-wurde-schon-geschrieben'));
    documents.intern.documentStorage.writeSidecar = (file, filePath) => {
      const written = originalWriteSidecar(file, filePath);
      if (file.id === fileId && file.sha256 === failingSha) {
        throw new Error('erzwungener Fehler nach Sidecar-Publikation');
      }
      return written;
    };
    try {
      result = await request(`/files/${fileId}/ersetzen`, {
        method: 'POST',
        ...json({
          dataBase64: Buffer.from('sidecar-wurde-schon-geschrieben').toString('base64'),
          mimeType: 'application/pdf'
        })
      });
    } finally {
      documents.intern.documentStorage.writeSidecar = originalWriteSidecar;
    }
    assert.equal(result.response.status, 500);
    assertUnchanged(fileId, before, 'Fehler nach Sidecar-Publikation');
    const restoredSidecar = JSON.parse(fs.readFileSync(
      documents.intern.documentStorage.sidecarPath(before.filePath, fileId), 'utf8'
    ));
    assert.equal(restoredSidecar.sha256, before.row.sha256);

    // 6. Physischer Publikationsfehler nach dem Weglegen der Primärdatei.
    before = state(fileId);
    const originalPublish = documents.intern.documentStorage.publishTemp;
    documents.intern.documentStorage.publishTemp = () => {
      throw new Error('erzwungener Publikationsfehler');
    };
    try {
      result = await request(`/files/${fileId}/ersetzen`, {
        method: 'POST',
        ...json({
          dataBase64: Buffer.from('darf-nicht-publiziert-werden').toString('base64'),
          mimeType: 'application/pdf'
        })
      });
    } finally {
      documents.intern.documentStorage.publishTemp = originalPublish;
    }
    assert.equal(result.response.status, 500);
    assertUnchanged(fileId, before, 'Publikationsfehler');

    // 7. Restore benutzt denselben Rollback: Fehler nach physischem Tausch
    //    darf die aktuelle Primärfassung nicht verändern.
    before = state(fileId);
    db.exec(`
      CREATE TRIGGER replacement_fail_restore_update
      BEFORE UPDATE OF storage_relpath ON doc_files
      WHEN NEW.storage_relpath != ''
      BEGIN
        SELECT RAISE(ABORT, 'erzwungener Restore-DB-Fehler');
      END
    `);
    result = await request(`/files/${fileId}/versionen/${versionWithTwo.id}/restore`, {
      method: 'POST',
      ...json({})
    });
    assert.equal(result.response.status, 500);
    assert.match(result.body.error, /bisherige Primärdatei bleibt erreichbar/);
    assertUnchanged(fileId, before, 'Restore-DB-Fehler');
    db.exec('DROP TRIGGER replacement_fail_restore_update');

    // 8. Strom-Upload hängt am selben Commit-Punkt.
    before = state(fileId);
    db.exec(`
      CREATE TRIGGER replacement_fail_stream_update
      BEFORE UPDATE OF storage_relpath ON doc_files
      WHEN NEW.storage_relpath != ''
      BEGIN
        SELECT RAISE(ABORT, 'erzwungener Strom-DB-Fehler');
      END
    `);
    result = await request(`/strom/files/${fileId}/ersetzen`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: Buffer.from('darf-nicht-aus-dem-strom-committen')
    });
    assert.equal(result.response.status, 500);
    assert.match(result.body.error, /bisherige Primärdatei bleibt erreichbar/);
    assertUnchanged(fileId, before, 'Strom-DB-Fehler');
    db.exec('DROP TRIGGER replacement_fail_stream_update');

    // 9. Der interne Weg für Modul-/Zwei-Wege-Abgleich ist kein Sonderweg.
    before = state(fileId);
    db.exec(`
      CREATE TRIGGER replacement_fail_internal_update
      BEFORE UPDATE OF storage_relpath ON doc_files
      WHEN NEW.storage_relpath != ''
      BEGIN
        SELECT RAISE(ABORT, 'erzwungener interner DB-Fehler');
      END
    `);
    assert.throws(() => documents.intern.dateiErsetzen(
      fileRow(fileId),
      'application/pdf',
      Buffer.from('darf-nicht-intern-committen')
    ), /erzwungener interner DB-Fehler/);
    assertUnchanged(fileId, before, 'Interner Ersetzungsfehler');
    db.exec('DROP TRIGGER replacement_fail_internal_update');

    // Jeder noch aktive doc_files-Verweis muss am Testende lesbar und
    // prüfsummengleich sein.
    const final = state(fileId);
    assert.equal(final.row.sha256, final.actualSha);
    assert.equal(final.bytes.toString(), 'fassung-eins');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main()
  .then(() => console.log('documents-replacement-rollback: DB, Datei, Sidecar, Restore und Strom ok'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
