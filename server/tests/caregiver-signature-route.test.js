'use strict';

/* Isolierter Vertragstest für die dynamische Dokumentoption
   „Unterschrift des Betreuers“. Produktivdaten werden nicht geöffnet. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

test('liefert die zuletzt aktualisierte Unterschrift des im Fall hinterlegten Betreuers', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'caregiver-signature-route-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  process.env.DB_PATH = path.join(temp, 'fixture.sqlite3');

  const db = require('../src/database/index');
  const insertUser = db.prepare(`
    INSERT INTO users
      (id, username, password_hash, display_name, first_name, last_name, allow_local, is_admin)
    VALUES (?, ?, 'x', ?, ?, ?, 1, 0)
  `);
  insertUser.run(1, 'fall-owner', 'Fall Owner', 'Olaf', 'Owner');
  insertUser.run(2, 'betreuerin', 'Bertha Betreuerin', 'Bertha', 'Betreuerin');
  insertUser.run(3, 'leser', 'Nur Leser', 'Lars', 'Leser');

  db.prepare(`
    INSERT INTO cases (id, label, stammdaten_json, owner_user_id)
    VALUES (?, ?, ?, ?)
  `).run(
    'case-1',
    'Testfall',
    JSON.stringify({ rechtlicherBetreuer: 'Bertha Betreuerin' }),
    1
  );
  db.prepare(`
    INSERT INTO case_access (case_id, user_id, level)
    VALUES ('case-1', 3, 'read')
  `).run();

  const insertSignature = db.prepare(`
    INSERT INTO signatures
      (id, owner_user_id, name, data_url, visibility, created_at, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSignature.run(
    'older', 2, 'Alt', 'data:image/png;base64,b2xk', 'public',
    '2026-01-01 10:00:00', '2026-01-01 10:00:00', 2
  );
  insertSignature.run(
    'newer-private', 2, 'Aktuell', 'data:image/png;base64,bmV3', 'private',
    '2026-02-01 10:00:00', '2026-03-01 10:00:00', 2
  );
  insertSignature.run(
    'owner-signature', 1, 'Falscher Fall-Owner', 'data:image/png;base64,b3duZXI=', 'public',
    '2026-04-01 10:00:00', '2026-04-01 10:00:00', 1
  );

  const app = express();
  app.use((req, _res, next) => {
    const userId = Number(req.get('x-test-user'));
    req.session = userId ? { userId, isAdmin: false } : {};
    next();
  });
  app.use('/api/signatures', require('../src/modules/documents/signature-routes'));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const ownerResponse = await fetch(`${base}/api/signatures/case/case-1`, {
    headers: { 'x-test-user': '1' }
  });
  assert.equal(ownerResponse.status, 200);
  const ownerBody = await ownerResponse.json();
  assert.deepEqual(ownerBody.caregiver, {
    userId: 2,
    firstName: 'Bertha',
    lastName: 'Betreuerin',
    name: 'Bertha Betreuerin'
  });
  assert.equal(ownerBody.signature.id, 'newer-private');
  assert.equal(ownerBody.signature.ownerUserId, 2);
  assert.equal(ownerBody.signature.dataUrl, 'data:image/png;base64,bmV3');

  const readerResponse = await fetch(`${base}/api/signatures/case/case-1`, {
    headers: { 'x-test-user': '3' }
  });
  assert.equal(readerResponse.status, 403);
});
