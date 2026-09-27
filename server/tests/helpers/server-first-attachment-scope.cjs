'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fixture = require('../fixtures/server-first/pilot-case.json');

module.exports = async function attachmentScope(t, { db, reset, request, setActor }) {
  const a = fixture.caseId, b = 'sf-attachment-b';
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGQAAAABJRU5ErkJggg==', 'base64');
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const keyParts = ['SF-SHARED-SNAPSHOT', 'same-change', 'same-attachment'];
  const payload = { filename: 'Synthetisch.png', mimeType: 'image/png', dataBase64: bytes.toString('base64'),
    sha256: hash(bytes), snapshotId: keyParts[0], changeId: keyParts[1], attachmentId: keyParts[2] };
  const route = (caseId, entryId) => `/api/cases/${caseId}/doku-entries/${entryId}/photos`;
  async function upload(caseId, entryId, body = payload) {
    const response = await request(route(caseId, entryId), { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  function addNote(id, caseId) {
    db.prepare('INSERT INTO case_doku_entries (id,case_id,data_json,updated_by) VALUES (?,?,?,1)')
      .run(id, caseId, JSON.stringify({ title: 'Synthetische Anlage', photos: [] }));
  }
  const linked = entryId => db.prepare(`SELECT f.* FROM doc_links l JOIN doc_files f ON f.id=l.file_id
    WHERE l.module='doku-photo' AND l.owner_id=?`).all(entryId);
  const count = () => db.prepare('SELECT count(*) AS n FROM doc_files').get().n;
  let legacyPhotoId, legacyFileId;

  await t.test('Identische Anlagenkennungen zweier Fälle erzeugen getrennte Dateien und behalten die Fallrechte', async () => {
    reset();
    db.prepare('INSERT INTO cases (id,label,owner_user_id,stammdaten_json) VALUES (?,?,2,?)')
      .run(b, 'Synthetischer fremder Anlagenfall', JSON.stringify(fixture.stammdaten));
    addNote('scope-a', a); addNote('scope-b', b);
    const start = count(), first = await upload(a, 'scope-a'); assert.equal(first.status, 201);
    const denied = await upload(b, 'scope-b'); assert.equal(denied.status, 403); assert.equal(count(), start + 1);
    setActor('delegate');
    const second = await upload(b, 'scope-b'); assert.equal(second.status, 201, JSON.stringify(second.data));
    assert.notEqual(first.data.photo.id, second.data.photo.id);
    assert.equal(linked('scope-a')[0].case_id, a); assert.equal(linked('scope-b')[0].case_id, b);
    assert.notEqual(linked('scope-a')[0].id, linked('scope-b')[0].id);
    const replay = await upload(b, 'scope-b'); assert.equal(replay.status, 200); assert.equal(replay.data.duplicate, true);
    assert.equal(count(), start + 2);
    const download = await request(route(b, 'scope-b') + '/' + second.data.photo.id);
    assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    setActor('owner'); assert.equal((await request(route(b, 'scope-b') + '/' + second.data.photo.id)).status, 403);
  });

  await t.test('Historische Anlagenkennung bleibt im passenden Fall einschließlich Foto-ID idempotent', async () => {
    setActor('owner');
    const existing = linked('scope-a')[0]; assert.ok(existing);
    legacyFileId = existing.id;
    const oldKey = JSON.stringify(keyParts), digest = hash(Buffer.from(oldKey)).slice(0, 32);
    legacyPhotoId = 'ad-' + digest.match(/.{8}/g).join('-');
    db.prepare("UPDATE doc_links SET slot=? WHERE module='doku-photo' AND owner_id='scope-a'").run(legacyPhotoId);
    const data = JSON.parse(db.prepare("SELECT data_json FROM case_doku_entries WHERE id='scope-a'").get().data_json);
    data.photos[0].id = legacyPhotoId;
    db.prepare("UPDATE case_doku_entries SET data_json=? WHERE id='scope-a'").run(JSON.stringify(data));
    db.prepare("DELETE FROM doc_module_import WHERE quelle='aussendienst-anlage' AND file_id=?").run(legacyFileId);
    db.prepare("INSERT INTO doc_module_import (quelle,quell_id,file_id) VALUES ('aussendienst-anlage',?,?)")
      .run(oldKey, legacyFileId);
    const start = count(), replay = await upload(a, 'scope-a');
    assert.equal(replay.status, 200); assert.equal(replay.data.duplicate, true);
    assert.equal(replay.data.photo.id, legacyPhotoId); assert.equal(count(), start);
    const other = Buffer.from('Anderer synthetischer Inhalt');
    assert.equal((await upload(a, 'scope-a', { ...payload, dataBase64: other.toString('base64'), sha256: hash(other) })).status, 409);
    const download = await request(route(a, 'scope-a') + '/' + legacyPhotoId);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  });

  await t.test('Ein historischer Eintrag eines anderen Falls wird nicht als eigene Anlage wiederverwendet', async () => {
    setActor('owner');
    const c = 'sf-attachment-c';
    db.prepare('INSERT INTO cases (id,label,owner_user_id,stammdaten_json) VALUES (?,?,1,?)')
      .run(c, 'Dritter synthetischer Anlagenfall', JSON.stringify(fixture.stammdaten));
    addNote('scope-c', c);
    const start = count(), result = await upload(c, 'scope-c');
    assert.equal(result.status, 201); assert.equal(linked('scope-c')[0].case_id, c);
    assert.notEqual(linked('scope-c')[0].id, legacyFileId); assert.equal(count(), start + 1);
    assert.equal((await upload(c, 'scope-c')).status, 200);
    assert.equal(linked('scope-a')[0].id, legacyFileId);
  });

  await t.test('Nicht mehr zuordenbare historische Anlage wird ohne neue Datei oder Metadatenänderung abgewiesen', async () => {
    setActor('owner');
    db.prepare("UPDATE doc_files SET deleted_at='2026-09-21T10:00:00Z' WHERE id=?").run(legacyFileId);
    const start = count(), before = db.prepare("SELECT data_json FROM case_doku_entries WHERE id='scope-a'").get().data_json;
    const result = await upload(a, 'scope-a');
    assert.equal(result.status, 409); assert.equal(count(), start);
    assert.equal(db.prepare("SELECT data_json FROM case_doku_entries WHERE id='scope-a'").get().data_json, before);
  });
};
