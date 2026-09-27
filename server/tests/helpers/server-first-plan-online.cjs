'use strict';
const assert = require('node:assert/strict');
module.exports = async function online(t, { setup, seed, upload, route, request, setActor, bytes, file }) {
  const list = async (kind, id) => (await (await request(route(kind) + '/' + id + '/attachments')).json()).attachments;
  await t.test('Planungsanlagen online: bestätigte Anlage liegt bytegleich vor; Entfernen erhält die andere Verknüpfung', async () => {
    const x = await setup(), calendar = await seed('calendar'), todo = await seed('todo'), a = await x.add('calendar', calendar), b = await x.add('todo', todo);
    for (const [kind, id, att] of [['calendar', calendar, a], ['todo', todo, b]]) { assert.equal((await list(kind, id))[0].id, att.id); const r = await request(route(kind) + '/' + id + '/attachments/' + att.id); assert.equal(r.status, 200); assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes); }
    await x.remove('calendar', calendar, a.id); assert.equal((await list('calendar', calendar)).length, 0); const r = await request(route('todo') + '/' + todo + '/attachments/' + b.id); assert.equal(r.status, 200); assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes);
  });
  await t.test('Planungsanlagen online: ungültige Uploadbestätigung gilt nicht als gespeicherte Anlage', async () => {
    for (const kind of ['calendar', 'todo']) for (const response of [() => new Response('<html>Anmeldung</html>'), () => Response.json({}), () => Response.json({ attachment: { id: 7 } }), () => Response.json({ attachment: { id: 'x', filename: 'x', size: 900 } })]) { const x = await setup('online', (_url, opts) => opts.method === 'POST' ? response() : null), id = await seed(kind); await assert.rejects(x.add(kind, id)); assert.equal((await list(kind, id)).length, 0); }
  });
  await t.test('Planungsanlagen online: Löschung benötigt eine ausdrückliche Bestätigung', async () => {
    for (const kind of ['calendar', 'todo']) for (const response of [() => new Response('<html>Anmeldung</html>'), () => Response.json({}), () => Response.json({ ok: false })]) { const x = await setup('online', (_url, opts) => opts.method === 'DELETE' ? response() : null), id = await seed(kind), att = await upload(kind, id); await assert.rejects(x.remove(kind, id, att.id)); assert.equal((await list(kind, id))[0].id, att.id); }
  });
  await t.test('Planungsanlagen online: tatsächliche Leserechte erlauben weder Hinzufügen noch Entfernen', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup(), id = await seed(kind), att = await upload(kind, id); setActor('reader'); await assert.rejects(x.add(kind, id)); await assert.rejects(x.remove(kind, id, att.id)); assert.equal((await list(kind, id))[0].id, att.id); }
  });
  await t.test('Planungsanlagen online: verlorene Uploadantwort sperrt dieselbe Datei am selben Vorgang', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('online', async (url, opts) => { if (opts.method !== 'POST') return null; const r = await request(url, opts); assert.equal(r.status, 201); throw Error('Antwort nach Commit verloren'); }), id = await seed(kind), f = file(); await assert.rejects(x.add(kind, id, f), e => e.unconfirmed === true); await assert.rejects(x.add(kind, id, f), e => e.unconfirmed === true); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); assert.equal((await list(kind, id)).length, 1); }
  });
  await t.test('Planungsanlagen online: verlorene Löschantwort wird nicht erneut geschrieben', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('online', async (url, opts) => { if (opts.method !== 'DELETE') return null; const r = await request(url, opts); assert.equal(r.status, 200); throw Error('Antwort nach Löschung verloren'); }), id = await seed(kind), att = await upload(kind, id); await assert.rejects(x.remove(kind, id, att.id), e => e.unconfirmed === true); await assert.rejects(x.remove(kind, id, att.id), e => e.unconfirmed === true); assert.equal(x.calls.filter(c => c.method === 'DELETE').length, 1); assert.equal((await list(kind, id)).length, 0); }
  });
  await t.test('Planungsanlagen online: paralleles Hinzufügen derselben Datei wird zusammengeführt, verschiedene Ziele bleiben getrennt', async () => {
    const x = await setup(), id = await seed('calendar'), other = await seed('calendar'), f = file(), results = await Promise.all([x.add('calendar', id, f), x.add('calendar', id, f)]); assert.equal(results[0].id, results[1].id); assert.equal((await list('calendar', id)).length, 1); assert.notEqual((await x.add('calendar', other, f)).id, results[0].id);
  });
  await t.test('Planungsanlagen online: Fehler vor dem Schreiben erlaubt einen korrigierten Versuch', async () => {
    const x = await setup(), id = await seed('todo'), f = file(), read = f.arrayBuffer; f.arrayBuffer = async () => { throw Error('Dateilesefehler'); }; await assert.rejects(x.add('todo', id, f)); assert.equal(x.calls.length, 0); f.arrayBuffer = read; assert.ok((await x.add('todo', id, f)).id); assert.equal((await list('todo', id)).length, 1);
  });
};
