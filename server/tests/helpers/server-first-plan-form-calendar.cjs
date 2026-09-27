'use strict';
const assert = require('node:assert/strict'), vm = require('node:vm');
const bytes = Buffer.from('%PDF-1.4\nSynthetische Formularanlage\n%%EOF');
const file = (name = 'Formular.pdf') => ({ name, size: bytes.length, type: 'application/pdf', arrayBuffer: async () => Uint8Array.from(bytes).buffer });
function node(value = '') { return { value, disabled: false, dataset: {}, isConnected: true, textContent: '', hidden: true, getClientRects: () => [1], checkValidity: () => true, reportValidity: () => true, focus() {}, setAttribute() {}, scrollIntoView() {} }; }
function form() { const root = node(), input = node('Synthetisch'); root.fields = [input]; root.nodes = new Map(); root.querySelectorAll = () => root.fields; root.querySelector = selector => selector === 'input,select,textarea' ? root.fields[0] : root.nodes.get(selector) || (root.nodes.set(selector, node()), root.nodes.get(selector)); return root; }
module.exports = async function calendarForms(t, { setup, region, payload, keys, request }) {
  async function ui(type, mode = 'online', intercept) {
    const x = await setup(mode, intercept), c = x.c, root = form();
    c.Uint8Array = Uint8Array; c.bytesToBase64 = v => Buffer.from(v).toString('base64');
    vm.runInContext(region('const attMapCache=', '// "kind"') + region('function attachmentApiUrl(', 'function attachmentDownloadHref(') + region('async function todoAttachments(', '/* ===== Fallliste'), c);
    c.calMobile = { busy: false, form: root, guard: { release() {} } }; c.calDesktop = { busy: false, form: root, todoId: null }; c.todoMobile = { busy: false, attachmentBusy: false, form: root, items: [] }; c.todoWork = { id: null, panel: 'edit', trail: [] };
    c.calFormEditId = c.todoFormEditId = null; c.calFormPendingFiles = []; c.todoFormPendingFiles = [];
    x.nodes = new Map(); c.document = { getElementById: id => x.nodes.get(id) || (x.nodes.set(id, node()), x.nodes.get(id)) };
    for (const id of ['todoFullNewForm', 'calFullNewForm']) x.nodes.set(id, root);
    c.todoWorkRoot = () => c.todoMobile.form || root;
    c.calMobileBusy = on => { c.calMobile.busy = on; }; c.calDesktopBusy = on => { c.calDesktop.busy = on; };
    for (const name of ['calMobileFormError', 'calDesktopError', 'todoWorkFormError']) c[name] = message => x.notices.push(message);
    for (const name of ['calMobileLockStorage', 'todoWorkLockStorage', 'calMobileDates', 'scheduleMiniRender']) c[name] = () => {};
    c.todoMobileSnapshot = () => 'snapshot';
    x.refresh = async () => {}; for (const name of ['calMobileRefreshAttachments', 'calDesktopRefreshAttachments', 'todoMobileRefreshAttachments']) c[name] = (...args) => x.refresh(...args);
    x.opened = 0; x.open = async () => { x.opened++; }; for (const name of ['openCalendarFullView', 'openTodoFullView', 'todoMobileOpen', 'calDesktopTodoDetail']) c[name] = (...args) => x.open(...args);
    vm.runInContext(region('async function calMobileSave(', '/* ===== Ende mobiler Kalender') + region('async function calDesktopSave(', 'window.__calDesktopMove=') + region('async function calDesktopTodoSave(', 'function calDesktopMiniHTML(') + region('async function todoMobileSave(', '/* ===== Vollständige Aufgabenliste'), c);
    x.type = type; x.kind = type.includes('todo') ? 'todo' : 'calendar'; x.controller = type === 'mobile-calendar' ? c.calMobile : type === 'work-todo' ? c.todoMobile : c.calDesktop; x.root = root;
    x.id = () => c[x.kind === 'todo' ? 'todoFormEditId' : 'calFormEditId']; x.setId = id => { c[x.kind === 'todo' ? 'todoFormEditId' : 'calFormEditId'] = id; if (type === 'desktop-todo') c.calDesktop.todoId = id; };
    x.pending = () => c[x.kind === 'todo' ? 'todoFormPendingFiles' : 'calFormPendingFiles']; x.select = files => { c[x.kind === 'todo' ? 'todoFormPendingFiles' : 'calFormPendingFiles'] = files; };
    x.run = (p = payload(), linked = null) => (type === 'mobile-calendar' ? c.calMobileSave : type === 'desktop-calendar' ? c.calDesktopSave : type === 'desktop-todo' ? c.calDesktopTodoSave : c.todoMobileSave)(p, linked, type.includes('todo') ? 'Aufgabe' : '2026-09-25');
    x.attachments = id => c[x.kind === 'todo' ? 'todoAttachments' : 'calAttachments'](id); return x;
  }
  const types = ['mobile-calendar', 'desktop-calendar'];
  await t.test('Kalenderformular: Anlegen mit Anlage und erneutem Lesen gelingt lokal und online', async () => {
    for (const type of types) for (const mode of ['online', 'local']) { const x = await ui(type, mode); x.select([file()]); const prior = await x.read('calendar'), before = prior.length; await x.run(); const rows = await x.read('calendar'); assert.equal(rows.length, before + 1); const saved = rows.find(r => !prior.some(old => old.id === r.id)); assert.ok(saved); assert.equal((await x.attachments(saved.id)).length, 1); assert.equal(x.pending().length, 0); assert.equal(x.controller.busy, false); assert.equal(x.opened, 1); }
  });
  await t.test('Kalenderformular: erfolgreiche Anlagen werden sofort entfernt, nur fehlgeschlagene bleiben für den Folgeversuch', async () => {
    for (const type of types) { const x = await ui(type), good = file(), bad = file('Nachreichen.pdf'), read = bad.arrayBuffer; bad.arrayBuffer = async () => { throw Error('Dateilesefehler'); }; x.select([good, bad]); await x.run(); const id = x.id(); assert.ok(id); assert.deepEqual(Array.from(x.pending()), [bad]); assert.equal((await x.attachments(id)).length, 1); bad.arrayBuffer = read; await x.run(); assert.equal((await x.attachments(id)).length, 2); assert.equal(x.calls.filter(c => c.method === 'POST' && c.url === '/api/calendar/events').length, 1); }
  });
  await t.test('Kalenderformular: verlorene Neuanlegeantwort sperrt auch einen Versuch mit verändertem Formularinhalt', async () => {
    for (const type of types) { const x = await ui(type, 'online', async (url, opts) => { if (opts.method !== 'POST') return null; const r = await request(url, opts); assert.ok(r.ok); throw Error('Antwort verloren'); }); await x.run(); await x.run({ ...payload(), title: 'Geänderter Entwurf' }); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); assert.equal(x.controller.form, x.root); assert.equal(x.opened, 0); }
  });
  await t.test('Kalenderformular: neueres Formular, Auswahl und Sperre bleiben bei später Antwort erhalten', async () => {
    for (const type of types) { let x; x = await ui(type, 'online', async (url, opts) => { if (opts.method !== 'POST') return null; const r = await request(url, opts); x.controller.form = form(); x.controller.busy = true; x.setId('neueres-ziel'); x.select([file('Neu.pdf')]); return r; }); x.select([file()]); await x.run(); assert.equal(x.id(), 'neueres-ziel'); assert.equal(x.pending()[0].name, 'Neu.pdf'); assert.equal(x.controller.busy, true); assert.equal(x.opened, 0); assert.equal(x.calls.filter(c => c.url.endsWith('/attachments')).length, 0); }
  });
  await t.test('Kalenderformular: Moduswechsel während Dateilesen setzt Anlagenfolge nicht im anderen Speicher fort', async () => {
    for (const type of types) { const x = await ui(type), f = file(); f.arrayBuffer = async () => { x.c.__appMode = 'local'; return Uint8Array.from(bytes).buffer; }; const before = x.storage.get(keys.calendar); x.select([f, file('Zweite.pdf')]); await x.run(); assert.equal(x.storage.get(keys.calendar), before); assert.equal(x.pending().length, 2); assert.equal(x.opened, 0); }
  });
  await t.test('Kalenderformular: Fehler beim Öffnen der Folgeansicht meldet den bereits gespeicherten Termin', async () => {
    for (const type of types) { const x = await ui(type); x.open = async () => { throw Error('Anzeige defekt'); }; await x.run(); assert.ok(x.notices.some(n => /gespeichert.*Anzeige/.test(n))); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); }
  });
  await t.test('Kalenderformular: zweiter Speicherklick startet keinen weiteren Formularabschluss', async () => {
    for (const type of types) { let release, entered; const gate = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; }); const x = await ui(type, 'online', async (_url, opts) => { if (opts.method === 'POST') { entered(); await gate; } return null; }); const first = x.run(); await started; const second = x.run(); release(); await Promise.all([first, second]); assert.equal(x.opened, 1); }
  });
  await t.test('Kalenderformular: fehlgeschlagene Quellverknüpfung bleibt als Teilabschluss ohne zweite Neuanlage sichtbar', async () => {
    for (const type of types) { const x = await ui(type); let linked = 0; x.c.__goalDecisionPlanningLinkedActionSaved = () => { linked++; throw Error('Verknüpfung fehlgeschlagen'); }; await x.run(payload(), { sourceId: 'synthetisch' }); const id = x.id(); assert.ok(id); await x.run(payload(), { sourceId: 'synthetisch' }); assert.equal(linked, 1); assert.equal(x.id(), id); assert.equal(x.opened, 0); assert.ok(x.notices.some(n => /gespeichert.*Verknüpfung/.test(n))); }
  });
  await require('./server-first-plan-form-todo.cjs')(t, { ui, file, form, payload, request });
  await require('./server-first-plan-form-legacy.cjs')(t, { ui, file, form, region, payload, request });
  await require('./server-first-plan-form-refresh.cjs')(t, { ui, file, form, node, region });
};
