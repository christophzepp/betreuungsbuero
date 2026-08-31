'use strict';

/*
 * Datenschutz- und Idempotenzvertrag für Fallbeginn-OCR und den
 * Außendienst-Rückweg. Ausschließlich temporäre SQLite-/Dokumentenpfade.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

test('Fallbeginn-OCR bleibt fallbezogen und Außendienstanlagen sind idempotent', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'field-ocr-attachments-'));
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

  t.after(() => {
    try { db.close(); } catch (_error) { /* bereits geschlossen */ }
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const userInsert = db.prepare(`
    INSERT INTO users
      (id,username,password_hash,display_name,allow_online,is_admin)
    VALUES (?,?,?,?,1,?)
  `);
  userInsert.run(1, 'owner-a', 'x', 'Owner A', 0);
  userInsert.run(2, 'owner-b', 'x', 'Owner B', 0);
  userInsert.run(9, 'admin', 'x', 'Admin', 1);
  const caseInsert = db.prepare(`
    INSERT INTO cases
      (id,label,stammdaten_json,owner_user_id,archived)
    VALUES (?,?,?,?,0)
  `);
  caseInsert.run(
    'case-a',
    'Alpha, Ada',
    JSON.stringify({ person: { lastName: 'Alpha', firstName: 'Ada', birthDate: '1980-01-01' } }),
    1
  );
  caseInsert.run(
    'case-b',
    'Beta, Bea',
    JSON.stringify({ person: { lastName: 'Beta', firstName: 'Bea', birthDate: '1981-02-02' } }),
    2
  );
  db.prepare(`
    INSERT INTO office_json (key,data_json,updated_by)
    VALUES ('documents_config',?,9)
  `).run(JSON.stringify({ storageLayout: 'real-folders-v1', storageRoot }));

  const intakes = {
    entries: [
      { id: 'own-case', state: { targetCaseId: 'case-a', step: 1 } },
      { id: 'foreign-case', state: { targetCaseId: 'case-b', step: 2 } },
      { id: 'legacy-unassigned', state: { step: 3 } },
      { id: 'personal-unassigned', ownerUserId: 1, state: { step: 4 } }
    ]
  };
  db.prepare(`
    INSERT INTO office_json (key,data_json,updated_by)
    VALUES ('case_intakes',?,9)
  `).run(JSON.stringify(intakes));
  const ocrStore = require('../src/modules/cases/intake-ocr').createIntakeOcrStore(db);
  for (const id of intakes.entries.map((entry) => entry.id)) {
    ocrStore.save(id, [{ name: `${id}.pdf`, text: `OCR ${id}` }]);
  }
  db.prepare(`
    INSERT INTO case_doku_entries (id,case_id,data_json,updated_by)
    VALUES ('entry-a','case-a',?,1)
  `).run(JSON.stringify({ date: '2026-07-28', title: 'Hausbesuch', photos: [] }));

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, _res, next) => {
    const userId = Number(req.get('x-test-user') || 1);
    const isAdmin = req.get('x-test-admin') === '1';
    req.session = {
      userId,
      username: isAdmin ? 'admin' : (userId === 1 ? 'owner-a' : 'owner-b'),
      displayName: isAdmin ? 'Admin' : (userId === 1 ? 'Owner A' : 'Owner B'),
      isAdmin,
      canViewCases: true,
      canEditCases: true,
      canViewDocuments: true,
      canEditDocuments: true,
      canUseFieldService: true,
      canViewAllCases: false
    };
    next();
  });
  app.use('/api/office-json', require('../src/modules/office/json-routes'));
  app.use('/api/cases', require('../src/modules/cases/routes'));

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, options, userId = 1, admin = false) {
    const input = { ...(options || {}) };
    input.headers = {
      ...(input.headers || {}),
      'x-test-user': String(admin ? 9 : userId),
      'x-test-admin': admin ? '1' : '0'
    };
    const response = await fetch(base + route, input);
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch (_error) { body = text; }
    return { response, body };
  }
  const json = (method, body) => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  let result = await request('/api/office-json/case_intakes');
  assert.equal(result.response.status, 200);
  assert.deepEqual(
    result.body.data.entries.map((entry) => entry.id).sort(),
    ['own-case', 'personal-unassigned']
  );
  assert.equal(result.body.data.migrationRequired, undefined);

  result = await request('/api/office-json/case_intakes', null, 9, true);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.entries.length, 4);
  assert.deepEqual(result.body.data.migrationRequired, {
    kind: 'case_intakes_unassigned',
    count: 1
  });

  assert.equal(
    (await request('/api/office-json/case_intakes/ocr/own-case')).response.status,
    200
  );
  assert.equal(
    (await request('/api/office-json/case_intakes/ocr/foreign-case')).response.status,
    403
  );
  assert.equal(
    (await request('/api/office-json/case_intakes/ocr/legacy-unassigned')).response.status,
    403
  );
  assert.equal(
    (await request('/api/office-json/case_intakes/ocr/legacy-unassigned', null, 9, true)).response.status,
    200
  );

  result = await request('/api/office-json/case_intakes', json('PUT', {
    data: {
      entries: [
        { id: 'own-case', state: { targetCaseId: 'case-a', step: 10 } },
        { id: 'personal-unassigned', ownerUserId: 1, state: { step: 40 } },
        { id: 'new-personal', state: { step: 5 } }
      ]
    }
  }));
  assert.equal(result.response.status, 200);
  const persisted = JSON.parse(
    db.prepare("SELECT data_json FROM office_json WHERE key='case_intakes'").get().data_json
  );
  assert.equal(persisted.entries.length, 5);
  assert.equal(persisted.entries.find((entry) => entry.id === 'foreign-case').state.step, 2);
  assert.equal(persisted.entries.find((entry) => entry.id === 'legacy-unassigned').state.step, 3);
  assert.equal(persisted.entries.find((entry) => entry.id === 'new-personal').ownerUserId, 1);

  result = await request('/api/office-json/case_intakes', json('PUT', {
    data: {
      entries: [
        { id: 'legacy-unassigned', state: { step: 99 } }
      ]
    }
  }));
  assert.equal(result.response.status, 403);

  const bytes = Buffer.from('eindeutiger Außendienstinhalt');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const upload = {
    filename: 'Beleg.png',
    mimeType: 'image/png',
    dataBase64: bytes.toString('base64'),
    kind: 'image',
    snapshotId: 'AD-260728-001',
    changeId: 'change-entry-a-photos',
    attachmentId: 'attachment-4711',
    sha256
  };
  const uploadRoute = '/api/cases/case-a/doku-entries/entry-a/photos';
  result = await request(uploadRoute, json('POST', upload));
  assert.equal(result.response.status, 201);
  const firstPhotoId = result.body.photo.id;
  result = await request(uploadRoute, json('POST', upload));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.duplicate, true);
  assert.equal(result.body.photo.id, firstPhotoId);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM doc_files WHERE case_id='case-a'").get().n,
    1
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM doc_links WHERE module='doku-photo' AND owner_id='entry-a'").get().n,
    1
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM doc_module_import WHERE quelle='aussendienst-anlage'").get().n,
    1
  );
  const doku = JSON.parse(
    db.prepare("SELECT data_json FROM case_doku_entries WHERE id='entry-a'").get().data_json
  );
  assert.equal(doku.photos.length, 1);

  const otherBytes = Buffer.from('anderer Inhalt');
  result = await request(uploadRoute, json('POST', {
    ...upload,
    dataBase64: otherBytes.toString('base64'),
    sha256: crypto.createHash('sha256').update(otherBytes).digest('hex')
  }));
  assert.equal(result.response.status, 409);
  result = await request(uploadRoute, json('POST', {
    ...upload,
    changeId: ''
  }));
  assert.equal(result.response.status, 400);
});
