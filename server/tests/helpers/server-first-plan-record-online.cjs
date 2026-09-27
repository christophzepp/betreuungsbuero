'use strict';
const assert = require('node:assert/strict');
const fixture = require('../fixtures/server-first/pilot-case.json');
module.exports = async function onlineRecords(t, { setup, seed, route, field, payload, request, setActor, keys }) {
  await t.test('Planung online: bestätigte Änderungen sind erneut lesbar und erhalten die gespeicherte Anlage', async () => {
    for (const kind of ['calendar', 'todo']) {
      const x = await setup(), item = await x.create(kind), bytes = Buffer.from('%PDF-1.4\nPlanungsbestand\n%%EOF'), r = await request(route(kind) + '/' + item.id + '/attachments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'Bestand.pdf', mimeType: 'application/pdf', dataBase64: bytes.toString('base64') }) }); assert.equal(r.status, 201); const att = (await r.json()).attachment;
      assert.equal((await x.update(kind, item.id, { title: 'Bestätigt' })).title, 'Bestätigt'); const y = await setup(); assert.equal((await y.read(kind)).find(row => row.id === item.id).title, 'Bestätigt'); const download = await request(route(kind) + '/' + item.id + '/attachments/' + att.id); assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes); await y.remove(kind, item.id); assert.equal((await y.read(kind)).some(row => row.id === item.id), false);
    }
  });
  await t.test('Planung online: unvollständige Schreibantworten und Löschquittungen bestätigen keinen Erfolg', async () => {
    for (const kind of ['calendar', 'todo']) for (const method of ['create', 'update', 'remove']) for (const reply of [() => new Response('<html>Anmeldung</html>'), () => Response.json({}), () => Response.json({ [field(kind)]: { id: 4 }, ok: 'true' })]) { const x = await setup('online', () => reply()); await assert.rejects(x[method](kind, ...(method === 'create' ? [payload()] : ['id', { title: 'Neu' }]))); assert.equal(x.documented.length, 0); assert.equal(x.saved.length, 0); }
  });
  await t.test('Planung online: fremde Kennung und abweichender gespeicherter Wert sind keine passende Bestätigung', async () => {
    for (const kind of ['calendar', 'todo']) for (const change of [{ id: 'fremdes-ziel' }, { title: 'Alter Stand' }, { description: 'Falscher Inhalt' }]) { const item = { ...payload(), id: 'target', done: false, description: 'Geändert' }, x = await setup('online', () => Response.json({ [field(kind)]: { ...item, ...change } })); await assert.rejects(x.update(kind, 'target', { title: item.title, description: item.description })); }
  });
  await t.test('Planung online: verlorene Antwort nach Commit sperrt Wiederholung für Anlegen, Ändern und Löschen', async () => {
    for (const kind of ['calendar', 'todo']) for (const action of ['create', 'update', 'remove']) {
      const x = await setup('online', async (url, opts) => { if (!opts.method) return null; const r = await request(url, opts); assert.ok(r.ok); throw Error('Antwort nach Speicherung verloren'); }), existing = await seed(kind), before = (await x.read(kind)).length, args = action === 'create' ? [payload()] : [existing.id, { title: 'Tatsächlich gespeichert' }];
      await assert.rejects(x[action](kind, ...args)); await assert.rejects(x[action](kind, ...args), /nicht bestätigt|neu laden/i); assert.equal(x.calls.filter(c => c.method !== 'GET').length, 1); const rows = await x.read(kind); assert.equal(rows.length, before + (action === 'create' ? 1 : action === 'remove' ? -1 : 0)); if (action === 'update') assert.equal(rows.find(r => r.id === existing.id).title, 'Tatsächlich gespeichert'); assert.equal(x.documented.length, 0);
    }
  });
  await t.test('Planung online: parallele identische Aufträge teilen einen Schreibauftrag; konkurrierende Änderung wartet', async () => {
    for (const kind of ['calendar', 'todo']) { let release, entered; const gate = new Promise(r => { release = r; }), start = new Promise(r => { entered = r; }); const x = await setup('online', async (_url, opts) => { if (!opts.method) return null; entered(); await gate; return null; }), item = await seed(kind); const first = x.update(kind, item.id, { title: 'Parallel' }); await start; const second = x.update(kind, item.id, { title: 'Parallel' }); const different = x.update(kind, item.id, { title: 'Konkurrierend' }); release(); await assert.rejects(different, /laufend|abwarten/i); const both = await Promise.all([first, second]); assert.equal(both[0].id, both[1].id); assert.equal(x.calls.length, 1); }
  });
  await t.test('Planung online: tatsächliche Fallrechte blockieren Änderungen ohne lokalen Ersatz', async () => {
    for (const kind of ['calendar', 'todo']) for (const actor of ['reader', 'noEdit']) { const x = await setup(), item = await x.create(kind, { ...payload(), caseId: fixture.caseId }), before = x.storage.get(keys[kind]); setActor(actor); await assert.rejects(x.update(kind, item.id, { title: 'Verboten' })); await assert.rejects(x.create(kind, { ...payload(), caseId: fixture.caseId })); assert.equal(x.storage.get(keys[kind]), before); assert.equal((await x.read(kind)).find(r => r.id === item.id).title, item.title); }
  });
  await t.test('Planung online: Moduswechsel während Speicherung erzeugt keine lokale Folge oder Wiederholung', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('online', async (url, opts, c) => { const r = await request(url, opts); if (opts.method) c.__appMode = 'local'; return r; }), before = x.storage.get(keys[kind]), p = { ...payload(), caseId: fixture.caseId }; await assert.rejects(x.create(kind, p)); assert.equal(x.storage.get(keys[kind]), before); assert.equal(x.documented.length, 0); x.c.__appMode = 'online'; await assert.rejects(x.create(kind, p)); assert.equal(x.calls.length, 1); }
  });
  await t.test('Planung online: ungültige Eingaben scheitern vor dem Schreiben und sperren keinen korrigierten Auftrag', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup(); await assert.rejects(x.update(kind, '', { title: 'Ungültig' })); await assert.rejects(x.create(kind, { ...payload(), id: 'fremd' })); assert.equal(x.calls.length, 0); assert.ok((await x.create(kind)).id); }
  });
};
