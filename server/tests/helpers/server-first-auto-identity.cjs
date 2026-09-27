'use strict';
const assert = require('node:assert/strict');
const fixture = require('../fixtures/server-first/pilot-case.json');
module.exports = async function identity(t, { setup, request, db }) {
  const add = async data => (await (await request(`/api/cases/${fixture.caseId}/doku-entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) })).json()).id;
  const stored = id => JSON.parse(db.prepare('SELECT data_json FROM case_doku_entries WHERE id=?').get(id).data_json);
  const legacy = (id, extra = {}) => ({ freeDetail: 'Historischer Eintrag', unknown: { keep: true }, _autoDoku: { key: `task:${id.toLowerCase()}:created`, sourceModule: 'task', sourceId: id, action: 'created', createdAt: '2020-01-01T00:00:00.000Z', ...extra } });
  await t.test('Auto-Dokumentation Quelle: Groß-/Kleinschreibung der Quellkennung unterscheidet tatsächliche Vorgänge', async () => {
    for (const mode of ['online', 'local']) { const x = await setup(mode); const a = await x.auto({}, 'sf-Case-ID'), b = await x.auto({}, 'sf-case-id'); assert.ok(a && b); if (mode === 'online') assert.notEqual(a.id, b.id); assert.notEqual(a._autoDoku.sourceId, b._autoDoku.sourceId); assert.equal(x.c.state.caseData.documentationEntries.length, 2); }
  });
  await t.test('Auto-Dokumentation Quelle: Doppelpunkte in Modul oder Kennung führen nicht zur gleichen Eintragszuordnung', async () => {
    const x = await setup(), a = await x.auto({}, 'item', 'created', 'task:sf-colon'), b = await x.auto({}, 'sf-colon:item', 'created', 'task'); assert.ok(a && b); assert.notEqual(a.id, b.id);
    const c = await x.auto({}, 'sf-repeat', 'z:sf-repeat:q', 'task'), d = await x.auto({}, 'sf-repeat', 'q', 'task:sf-repeat:z'); assert.ok(c && d); assert.notEqual(c.id, d.id);
    x.c.state.caseData.documentationEntries = x.c.state.caseData.documentationEntries.filter(e => e.id !== d.id);
    const updated = await x.auto({ title: 'Aktualisierte Zuordnung' }, 'sf-repeat', 'q', 'task:sf-repeat:z'); assert.equal(updated.id, d.id);
    assert.ok(x.c.state.caseData.documentationEntries.some(e => e.id === c.id)); assert.ok(x.c.state.caseData.documentationEntries.some(e => e.id === d.id));
  });
  await t.test('Auto-Dokumentation Quelle: eindeutiger historischer Verweis wird mit gleicher Zeilenkennung weitergeführt', async () => {
    const x = await setup(), old = legacy('sf-Legacy-Exact', { unknownSourceMeta: { keep: null } }), id = await add(old); const saved = await x.auto({ title: 'Neuer Stand' }, 'sf-Legacy-Exact');
    assert.equal(saved.id, id); assert.deepEqual(stored(id).unknown, old.unknown); assert.equal(stored(id)._autoDoku.createdAt, old._autoDoku.createdAt); assert.equal(stored(id)._autoDoku.key, old._autoDoku.key);
    assert.deepEqual(stored(id)._autoDoku.unknownSourceMeta, old._autoDoku.unknownSourceMeta);
  });
  await t.test('Auto-Dokumentation Quelle: eindeutig andere historische Quellkennung wird nicht überschrieben', async () => {
    const x = await setup(), old = legacy('sf-legacy-case'), id = await add(old); const saved = await x.auto({}, 'sf-Legacy-Case'); assert.ok(saved); assert.notEqual(saved.id, id); assert.deepEqual(stored(id), old);
  });
  await t.test('Auto-Dokumentation Quelle: unvollständiger historischer Kollisionsverweis verlangt Abgleich', async () => {
    const x = await setup(), old = legacy('sf-legacy-missing'); delete old._autoDoku.sourceId; const id = await add(old);
    assert.equal(await x.auto({}, 'sf-legacy-missing'), null); assert.deepEqual(stored(id), old); assert.equal(x.calls.filter(c => c.method !== 'GET').length, 0);
  });
  await t.test('Auto-Dokumentation Quelle: widersprüchlicher Schlüssel mit passender Quellmetadaten-Zuordnung wird abgewiesen', async () => {
    const x = await setup(), old = legacy('sf-legacy-conflict', { key: 'anderer-schluessel' }), id = await add(old);
    assert.equal(await x.auto({}, 'sf-legacy-conflict'), null); assert.deepEqual(stored(id), old); assert.equal(x.calls.filter(c => c.method !== 'GET').length, 0);
  });
  await t.test('Auto-Dokumentation Quelle: Modul- und Aktionsschreibweise bleiben kompatibel', async () => {
    const x = await setup(), first = await x.auto({}, 'sf-stable-source', 'created', 'task'), second = await x.auto({ title: 'Aktualisiert' }, 'sf-stable-source', 'CREATED', 'TASK'); assert.equal(first.id, second.id);
  });
  await t.test('Auto-Dokumentation Quelle: widersprüchliche Quellmetadaten werden nicht als weiterer Eintrag behandelt', async () => {
    const x = await setup(), first = await x.auto({}, 'sf-meta-conflict'), bad = { ...stored(first.id), _autoDoku: { ...stored(first.id)._autoDoku, sourceId: 'andere-quelle' } };
    await request(`/api/cases/${fixture.caseId}/doku-entries/${first.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: bad }) }); x.calls.length = 0;
    assert.equal(await x.auto({}, 'sf-meta-conflict'), null); assert.deepEqual(stored(first.id), bad); assert.equal(x.calls.filter(c => c.method !== 'GET').length, 0);
  });
};
