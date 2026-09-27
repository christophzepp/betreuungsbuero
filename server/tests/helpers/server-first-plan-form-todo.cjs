'use strict';
const assert = require('node:assert/strict');
module.exports = async function todoForms(t, { ui, file, form, payload, request }) {
  const types = ['desktop-todo', 'work-todo'];
  async function task(type, mode = 'online', intercept) { const x = await ui(type, mode, intercept); if (type === 'desktop-todo') { const item = await x.create('todo'); x.setId(item.id); } x.calls.length = 0; return x; }
  const messages = x => x.notices.concat(x.nodes.get('todoMobileFormError')?.textContent || '');
  await t.test('Aufgabenformular: gespeicherter Inhalt und Anlage sind lokal und online erneut lesbar', async () => {
    for (const type of types) for (const mode of ['online', 'local']) { const x = await task(type, mode), prior = await x.read('todo'), id = x.id(); x.select([file()]); await x.run({ ...payload(), title: 'Formular bestätigt' }); const rows = await x.read('todo'), saved = id ? rows.find(r => r.id === id) : rows.find(r => !prior.some(old => old.id === r.id)); assert.equal(saved.title, 'Formular bestätigt'); assert.equal((await x.attachments(saved.id)).length, 1); assert.equal(x.opened, 1); assert.equal(x.controller.busy, false); }
  });
  await t.test('Aufgabenformular: fehlgeschlagene Anlage und gescheiterte Anzeige erhalten Auswahl und Fachquittung', async () => {
    for (const type of types) { const x = await task(type), good = file(), bad = file('Offen.pdf'); bad.arrayBuffer = async () => { throw Error('Dateilesefehler'); }; x.refresh = async () => { throw Error('Anzeige fehlt'); }; x.select([good, bad]); await x.run(); assert.ok(x.id()); assert.deepEqual(Array.from(x.pending()), [bad]); assert.equal((await x.attachments(x.id())).length, 1); assert.ok(messages(x).some(n => /gespeichert.*Anlage.*nicht bestätigt/.test(n))); assert.equal(x.opened, 0); }
  });
  await t.test('Aufgabenformular: spätere Antwort verändert keinen neueren Aufgabenentwurf', async () => {
    for (const type of types) { let armed = false, x; x = await task(type, 'online', async (url, opts) => { if (!armed || !opts.method) return null; const r = await request(url, opts); x.controller.form = form(); x.controller.busy = true; x.setId('neuer-entwurf'); x.c.todoWork.id = 'neuer-entwurf'; x.select([file('Neu.pdf')]); return r; }); armed = true; x.select([file()]); await x.run(); assert.equal(x.id(), 'neuer-entwurf'); assert.equal(x.c.todoWork.id, 'neuer-entwurf'); assert.equal(x.pending()[0].name, 'Neu.pdf'); assert.equal(x.controller.busy, true); assert.equal(x.opened, 0); }
  });
  await t.test('Aufgabenformular: unbestätigte Neuanlage bleibt auch nach Änderung der Eingaben gesperrt', async () => {
    const x = await task('work-todo', 'online', async (url, opts) => { if (opts.method !== 'POST') return null; await request(url, opts); throw Error('Commit-Antwort verloren'); }); await x.run(); await x.run({ ...payload(), title: 'Veränderter Entwurf' }); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); assert.equal(x.controller.form, x.root); assert.equal(x.opened, 0);
  });
  await t.test('Aufgabenformular: während des Speicherns geänderte Eingaben bleiben als Entwurf offen', async () => {
    for (const type of types) { let armed = false, x; x = await task(type, 'online', async (url, opts) => { if (!armed || !opts.method) return null; const r = await request(url, opts); x.root.fields[0].value = 'Neuere Eingabe'; return r; }); armed = true; await x.run(); assert.equal(x.controller.form, x.root); assert.equal(x.root.fields[0].value, 'Neuere Eingabe'); assert.ok(x.id()); assert.equal(x.opened, 0); assert.ok(messages(x).some(n => /Neuere Eingaben/.test(n))); }
  });
  await t.test('Aufgabenformular: Anzeigefehler nach dem Abschluss wird mit bestätigter Speicherung gemeldet', async () => {
    for (const type of types) { const x = await task(type); x.open = async () => { throw Error('Anzeige fehlt'); }; await x.run(); assert.ok(messages(x).some(n => /gespeichert.*Anzeige/.test(n))); assert.equal(x.calls.filter(c => c.method === (type === 'desktop-todo' ? 'PUT' : 'POST')).length, 1); }
  });
  await t.test('Aufgabenformular: laufender direkter Anlagenauftrag verhindert einen parallelen Formularabschluss', async () => {
    const x = await task('work-todo'); x.c.todoMobile.attachmentBusy = true; await x.run(); assert.equal(x.calls.length, 0); assert.equal(x.controller.form, x.root);
  });
  await t.test('Aufgabenformular: fehlgeschlagene Quellverknüpfung erzeugt keine zweite Aufgabe und keinen falschen Abschluss', async () => {
    const x = await task('work-todo'); let calls = 0; x.c.__goalDecisionPlanningLinkedActionSaved = () => { calls++; throw Error('Quelle nicht gespeichert'); }; await x.run(payload(), { sourceId: 'synthetisch' }); const id = x.id(); await x.run(payload(), { sourceId: 'synthetisch' }); assert.equal(x.id(), id); assert.equal(calls, 1); assert.equal(x.opened, 0); assert.ok(messages(x).some(n => /gespeichert.*Verknüpfung/.test(n)));
  });
};
