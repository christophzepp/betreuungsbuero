'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
const html = fs.readFileSync(path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
const start = html.indexOf('<script id="calendar-todo-script-v1">'), source = html.slice(start, html.indexOf('</script>', start));
const region = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return source.slice(i, j); };
const keys = { calendar: 'betreuungsbuero.calendarEvents.v1', todo: 'betreuungsbuero.todos.v1' };
const route = kind => kind === 'calendar' ? '/api/calendar/events' : '/api/todos';
const bytes = Buffer.from('%PDF-1.4\nSynthetische Planungsanlage\n%%EOF');
const file = () => ({ name: 'Synthetisch.pdf', type: 'application/pdf', size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer });
module.exports = async function attachments(t, { db, reset, request, setActor }) {
  async function setup(mode = 'online', intercept = () => null) {
    reset(); const storage = new Map(Object.values(keys).map(key => [key, JSON.stringify([{ id: 'local-parent', title: 'Synthetisch', unknown: { keep: null }, attachments: [] }])]));
    const calls = [], notices = [], saved = []; let failure;
    const c = { __appMode: mode, console, Uint8Array,
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (failure === key) throw Error('Synthetischer Speicherfehler'); storage.set(key, value); } },
      bytesToBase64: bytes => Buffer.from(bytes).toString('base64'), toast: text => notices.push(text), __calendarTodoLocalSaved: () => saved.push(true),
      fetch: async (url, opts = {}) => { calls.push({ url, method: opts.method || 'GET' }); return await intercept(url, opts, c) || request(url, opts); } };
    c.window = c; vm.createContext(c);
    vm.runInContext(region('const CAL_STORAGE_KEY=', '/* ===== ICS (RFC') + region('const attMapCache=', '// "kind"') + region('function attachmentApiUrl(', 'function attachmentDownloadHref(') + region('async function todoAttachments(', '/* ===== Fallliste'), c);
    return { c, storage, calls, notices, saved, fail: key => { failure = key; },
      read: (kind, id = 'local-parent') => c[kind === 'calendar' ? 'calAttachments' : 'todoAttachments'](id),
      add: (kind, id, f = file()) => c[kind === 'calendar' ? 'calAddAttachment' : 'todoAddAttachment'](id, f),
      remove: (kind, id, att) => c[kind === 'calendar' ? 'calRemoveAttachment' : 'todoRemoveAttachment'](id, att) };
  }
  async function seed(kind) {
    const r = await request(route(kind), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Synthetischer Anlagenvorgang', startAt: '2026-09-25T10:00:00', caseId: fixture.caseId, connectionId: 'local' }) });
    assert.equal(r.status, 201, await r.clone().text()); return (await r.json())[kind === 'calendar' ? 'event' : 'todo'].id;
  }
  async function upload(kind, id) { const r = await request(route(kind) + '/' + id + '/attachments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file().name, mimeType: file().type, dataBase64: bytes.toString('base64') }) }); assert.equal(r.status, 201, await r.clone().text()); return (await r.json()).attachment; }
  await t.test('Planungsanlagen lesen: tatsächliche Termin- und Aufgabenanlagen sind vollständig und erneut lesbar', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup(), id = await seed(kind), att = await upload(kind, id); assert.deepEqual(JSON.parse(JSON.stringify(await x.read(kind, id))), [att]); const y = await setup(); assert.equal((await y.read(kind, id))[0].id, att.id); }
  });
  await t.test('Planungsanlagen lesen: HTTP-, JSON- und Formfehler sind kein leerer Bestand', async () => {
    for (const kind of ['calendar', 'todo']) for (const reply of [() => Response.json({}, { status: 503 }), () => new Response('<html>Anmeldung</html>'), () => Response.json({ map: [] }), () => Response.json({ map: { x: [null] } })]) {
      const x = await setup('online', () => reply()); await assert.rejects(x.read(kind, 'x')); assert.equal(x.calls.length, 1);
    }
  });
  await t.test('Planungsanlagen lesen: fehlende Sammelroute verwendet den bestätigten Einzelabruf', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('online', url => url.endsWith('attachments-map') ? Response.json({}, { status: 404 }) : null), id = await seed(kind), att = await upload(kind, id); assert.equal((await x.read(kind, id))[0].id, att.id); assert.equal(x.calls.length, 2); }
  });
  await t.test('Planungsanlagen lesen: nach Fehler ist ein neuer Abruf möglich und spätere Änderungen bleiben sichtbar', async () => {
    for (const kind of ['calendar', 'todo']) { let broken = true; const x = await setup('online', () => broken ? Response.json({}, { status: 503 }) : null), id = await seed(kind); await assert.rejects(x.read(kind, id)); broken = false; assert.equal((await x.read(kind, id)).length, 0); await upload(kind, id); assert.equal((await x.read(kind, id)).length, 1); }
  });
  await t.test('Planungsanlagen lesen: parallele Sammelabrufe teilen nur den laufenden Auftrag', async () => {
    let release, entered; const gate = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
    const x = await setup('online', async url => { if (!url.endsWith('attachments-map')) return null; entered(); await gate; return null; }), id = await seed('calendar'); await upload('calendar', id);
    const first = x.read('calendar', id); await started; const second = x.read('calendar', id); release(); assert.equal((await first)[0].id, (await second)[0].id); assert.equal(x.calls.length, 1);
  });
  await t.test('Planungsanlagen lesen: nicht sichtbarer oder fehlender Elternvorgang erscheint nicht erfolgreich leer', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup(), id = await seed(kind); setActor('delegate'); db.prepare('DELETE FROM case_access WHERE case_id=? AND user_id=2').run(fixture.caseId); await assert.rejects(x.read(kind, id)); setActor('owner'); await assert.rejects(x.read(kind, 'fehlender-vorgang')); }
  });
  await t.test('Planungsanlagen lesen lokal: beschädigter und mehrdeutiger Bestand bleibt unverändert', async () => {
    for (const kind of ['calendar', 'todo']) for (const value of ['{', '{}', '[null]', JSON.stringify([{ id: 'local-parent', attachments: {} }]), JSON.stringify([{ id: 'local-parent' }, { id: 'local-parent' }])]) {
      const x = await setup('local'); x.storage.set(keys[kind], value); await assert.rejects(x.read(kind)); assert.equal(x.storage.get(keys[kind]), value);
    }
  });
  await t.test('Planungsanlagen lesen: Antwort nach Wechsel des Betriebsmodus wird verworfen', async () => {
    const x = await setup('online', async (url, opts, c) => { const r = await request(url, opts); c.__appMode = 'local'; return r; }), id = await seed('calendar'); await upload('calendar', id); await assert.rejects(x.read('calendar', id));
  });
  await require('./server-first-plan-local.cjs')(t, { setup, keys, file });
  await require('./server-first-plan-online.cjs')(t, { setup, seed, upload, route, request, setActor, bytes, file });
  await require('./server-first-plan-ui.cjs')(t, { setup, seed, upload, route, request, region, file });
};
