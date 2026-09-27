'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
const start = html.indexOf('<script id="calendar-todo-script-v1">'), source = html.slice(start, html.indexOf('</script>', start));
const region = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return source.slice(i, j); };
const keys = { calendar: 'betreuungsbuero.calendarEvents.v1', todo: 'betreuungsbuero.todos.v1' };
const route = kind => kind === 'calendar' ? '/api/calendar/events' : '/api/todos';
const field = kind => kind === 'calendar' ? 'event' : 'todo';
const payload = () => ({ title: 'Synthetischer Planungsvorgang', startAt: '2026-09-25T10:00:00', connectionId: 'local' });
const clone = x => JSON.parse(JSON.stringify(x));
module.exports = async function records(t, { reset, request, setActor, db }) {
  async function setup(mode = 'online', intercept = () => null) {
    reset(); const storage = new Map(Object.values(keys).map(k => [k, JSON.stringify([{ ...payload(), id: 'local-parent', unknown: { keep: null }, attachments: [{ id: 'attachment', filename: 'Erhalten.pdf' }] }])]));
    const calls = [], notices = [], saved = [], documented = []; let failure;
    const c = { __appMode: mode, console, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => { if (failure === k) throw Error('Speicherfehler'); storage.set(k, v); } },
      toast: text => notices.push(text), __calendarTodoLocalSaved: () => saved.push(true), createAutoDokuEntry: async data => { documented.push(data); return { id: 'doc' }; },
      fetch: async (url, opts = {}) => { calls.push({ url, method: opts.method || 'GET', body: opts.body }); return await intercept(url, opts, c) || request(url, opts); } };
    c.window = c; vm.createContext(c);
    vm.runInContext(region('const CAL_STORAGE_KEY=', '/* ===== ICS (RFC') + 'let promptEventsCache=[],promptTodosCache=[];\n' + region('/* ===== Datenzugriff', '/* ===== Anlagen an Termine') + region('function todoItemType(', '/* ===== Anlagen an Aufgaben'), c);
    return { c, storage, calls, notices, saved, documented, fail: k => { failure = k; },
      read: (kind, strict = true) => c[kind === 'calendar' ? 'calEventsRaw' : 'todoItems']({ strict }),
      create: (kind, p = payload()) => c[kind === 'calendar' ? 'calCreate' : 'todoCreate'](p),
      update: (kind, id, p) => c[kind === 'calendar' ? 'calUpdate' : 'todoUpdate'](id, p),
      remove: (kind, id) => c[kind === 'calendar' ? 'calRemove' : 'todoRemove'](id) };
  }
  async function seed(kind) { const r = await request(route(kind), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) }); assert.equal(r.status, 201); return (await r.json())[field(kind)]; }
  await t.test('Planungsbestand: echte Listen sind nach erneutem Laden lesbar', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup(), item = await seed(kind), y = await setup(); assert.equal((await x.read(kind)).find(row => row.id === item.id).title, item.title); assert.equal((await y.read(kind)).find(row => row.id === item.id).title, item.title); }
  });
  await t.test('Planungsbestand: fehlende oder ungültige Serverlisten sind kein bestätigter Leerbestand', async () => {
    for (const kind of ['calendar', 'todo']) for (const value of [undefined, {}, [null], [{ id: '' }], [{ id: 3 }], [{ id: 'x' }, { id: 'x' }]]) { const x = await setup('online', () => Response.json({ [kind === 'calendar' ? 'events' : 'todos']: value })); await assert.rejects(x.read(kind)); }
  });
  await t.test('Planungsbestand: HTTP- und JSON-Fehler lassen den letzten geprüften Cache bestehen', async () => {
    for (const kind of ['calendar', 'todo']) { let broken = false; const x = await setup('online', () => broken ? Response.json({}) : null); await seed(kind); await x.read(kind); const name = kind === 'calendar' ? 'promptEventsCache' : 'promptTodosCache', before = vm.runInContext('JSON.stringify(' + name + ')', x.c); broken = true; await assert.rejects(x.read(kind)); assert.equal(vm.runInContext('JSON.stringify(' + name + ')', x.c), before); }
  });
  await t.test('Planungsbestand lokal: beschädigte und doppelte Datensätze bleiben unverändert', async () => {
    for (const kind of ['calendar', 'todo']) for (const raw of ['{', '{}', '[null]', '[{"id":"x"},{"id":"x"}]']) { const x = await setup('local'); x.storage.set(keys[kind], raw); await assert.rejects(x.read(kind)); assert.equal(x.storage.get(keys[kind]), raw); }
  });
  await t.test('Planungsbestand lokal: fehlender Schlüssel ist leer, ein vorhandener leerer Text ist beschädigt', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('local'); x.storage.delete(keys[kind]); assert.equal((await x.read(kind)).length, 0); x.storage.set(keys[kind], ''); await assert.rejects(x.read(kind)); }
  });
  await t.test('Planungsbestand: verspätete Antwort aus anderem Modus wird verworfen', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('online', async (url, opts, c) => { const r = await request(url, opts); c.__appMode = 'local'; return r; }); await seed(kind); await assert.rejects(x.read(kind)); }
  });
  await t.test('Planungsbestand: Zielplanungsabgleich behandelt Lesefehler nicht als fehlende Verknüpfung', async () => {
    const x = await setup('online', () => Response.json({}, { status: 503 })); for (const prefix of ['Calendar', 'Todo']) for (const suffix of ['Get', 'List']) await assert.rejects(x.c['__gdp' + prefix + suffix]('x'));
  });
  await t.test('Planungsbestand: korrigierter Folgeabruf liefert vollständige Daten und unbekannte Felder', async () => {
    for (const kind of ['calendar', 'todo']) { let broken = true; const x = await setup('online', () => Response.json({ [kind === 'calendar' ? 'events' : 'todos']: broken ? null : [{ id: 'x', unknown: { keep: null } }] })); await assert.rejects(x.read(kind)); broken = false; assert.deepEqual(clone((await x.read(kind))[0].unknown), { keep: null }); }
  });
  await require('./server-first-plan-record-local.cjs')(t, { setup, keys, payload, clone });
  await require('./server-first-plan-record-online.cjs')(t, { setup, seed, route, field, payload, request, setActor, keys });
  await require('./server-first-plan-record-followup.cjs')(t, { setup, payload, region, keys });
  await require('./server-first-plan-form-calendar.cjs')(t, { setup, region, payload, keys, request });
};
