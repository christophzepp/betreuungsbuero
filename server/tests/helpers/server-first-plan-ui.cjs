'use strict';
const assert = require('node:assert/strict'), vm = require('node:vm');
const kinds = ['mobile-calendar', 'desktop-calendar', 'desktop-todo', 'work-todo'];
module.exports = async function uiTests(t, { setup, seed, upload, route, request, region, file }) {
  async function ui(type, intercept) {
    const x = await setup('online', intercept), c = x.c, kind = type.endsWith('todo') ? 'todo' : 'calendar', id = await seed(kind);
    c.calMobile = { busy: false, form: {} }; c.calDesktop = { busy: false, form: {}, todoId: kind === 'todo' ? id : null }; c.todoMobile = { busy: false, attachmentBusy: false, form: {} };
    c.calFormPendingFiles = []; c.todoFormPendingFiles = []; c.calFormEditId = id; c.todoFormEditId = id;
    c.calMobileBusy = on => { c.calMobile.busy = on; }; c.calDesktopBusy = on => { c.calDesktop.busy = on; };
    for (const fn of ['calMobileFormError', 'calDesktopError', 'todoWorkFormError']) c[fn] = text => x.notices.push(text);
    x.refresh = async () => { throw Error('Synthetischer Anzeigefehler'); };
    for (const fn of ['calMobileRefreshAttachments', 'calDesktopRefreshAttachments', 'todoMobileRefreshAttachments']) c[fn] = (...args) => x.refresh(...args);
    x.confirm = true; c.confirm = () => x.confirm;
    vm.runInContext(region('async function calMobileAttachment(', 'async function calMobileSave(') + region('async function calDesktopAttachment(', 'async function calDesktopSave(') + region('async function todoWorkAttachment(', 'function todoWorkFormError('), c);
    const fn = type === 'mobile-calendar' ? c.calMobileAttachment : type === 'work-todo' ? c.todoWorkAttachment : c.calDesktopAttachment;
    x.controller = type === 'mobile-calendar' ? c.calMobile : type === 'work-todo' ? c.todoMobile : c.calDesktop;
    x.pending = () => c[kind === 'todo' ? 'todoFormPendingFiles' : 'calFormPendingFiles'];
    x.run = (action, value) => fn(action, id, action === 'add' ? { files: [value] } : value);
    x.kind = kind; x.id = id; return x;
  }
  await t.test('Planungsanlagen Dialog: bestätigter Upload mit Anzeigefehler wird nicht erneut vorgemerkt', async () => {
    for (const type of kinds) { const x = await ui(type); await assert.doesNotReject(x.run('add', file())); assert.equal(x.pending().length, 0); assert.ok(x.notices.some(n => /gespeichert/i.test(n))); assert.equal(x.controller.busy, false); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); }
  });
  await t.test('Planungsanlagen Dialog: sicher gescheiterter Dateizugriff bleibt einmal vorgemerkt, auch bei Anzeigefehler', async () => {
    for (const type of kinds) { const x = await ui(type), f = file(), read = f.arrayBuffer; f.arrayBuffer = async () => { throw Error('Synthetischer Dateilesefehler'); }; await assert.doesNotReject(x.run('add', f)); await assert.doesNotReject(x.run('add', f)); assert.equal(x.pending().length, 1); assert.equal(x.pending()[0], f); assert.ok(x.notices.some(n => n.includes('Dateilesefehler'))); assert.equal(x.calls.length, 0); f.arrayBuffer = read; await assert.doesNotReject(x.run('add', f)); assert.equal(x.pending().length, 0); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); }
  });
  await t.test('Planungsanlagen Dialog: unbestätigter Upload wird nicht für blindes Wiederholen vorgemerkt', async () => {
    for (const type of kinds) { const x = await ui(type, async (url, opts) => { if (opts.method !== 'POST') return null; const r = await request(url, opts); assert.equal(r.status, 201); throw Error('Antwort verloren'); }), f = file(); await assert.doesNotReject(x.run('add', f)); await assert.doesNotReject(x.run('add', f)); assert.equal(x.pending().length, 0); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); assert.ok(x.notices.some(n => /abgleichen/i.test(n))); }
  });
  await t.test('Planungsanlagen Dialog: ein neueres Formular und dessen Sperre bleiben nach spätem Abschluss unverändert', async () => {
    for (const type of kinds) { let x; x = await ui(type, async (url, opts) => { if (opts.method !== 'POST') return null; const r = await request(url, opts); x.controller.form = { newer: true }; x.controller.busy = true; x.controller.attachmentBusy = true; x.c[x.kind === 'todo' ? 'todoFormPendingFiles' : 'calFormPendingFiles'] = ['neuere-auswahl']; return r; }); await assert.doesNotReject(x.run('add', file())); assert.deepEqual(x.pending(), ['neuere-auswahl']); assert.equal(x.controller.busy, true); assert.equal(x.controller.attachmentBusy, true); }
  });
  await t.test('Planungsanlagen Dialog: abgebrochene Löschung startet keinen Schreibauftrag', async () => {
    for (const type of kinds) { const x = await ui(type); x.confirm = false; await x.run('remove', 'nicht-loeschen'); assert.equal(x.calls.length, 0); assert.equal(x.controller.busy, false); }
  });
  await t.test('Planungsanlagen Dialog: bestätigtes Entfernen und gescheiterte Anzeige werden getrennt gemeldet', async () => {
    for (const type of kinds) { const x = await ui(type), att = await upload(x.kind, x.id); await assert.doesNotReject(x.run('remove', att.id)); const data = await (await request(route(x.kind) + '/' + x.id + '/attachments')).json(); assert.equal(data.attachments.length, 0); assert.ok(x.notices.some(n => /entfernt/i.test(n))); assert.equal(x.controller.busy, false); }
  });
};
