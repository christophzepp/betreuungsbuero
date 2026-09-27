'use strict';
const assert = require('node:assert/strict'), vm = require('node:vm');
module.exports = async function legacyForms(t, { ui, file, form, region, payload, request }) {
  async function legacy(kind, mode = 'online', intercept) {
    const x = await ui(kind === 'calendar' ? 'desktop-calendar' : 'work-todo', mode, intercept), c = x.c;
    for (const name of ['calMobileActive', 'calDesktopActive', 'todoMobileActive', 'todoWorkActive']) c[name] = () => false;
    c.composeLocalIso = (day, time) => day + 'T' + time + ':00'; c.selectedCaseId = () => ''; c.recurrenceRuleFromForm = () => ''; c.calFullSelectedDay = '';
    const values = kind === 'calendar' ? { calNewTitle: 'Synthetisches Altformular', calNewStartDate: '2026-09-25', calNewEndDate: '2026-09-25', calNewStartTime: '10:00', calNewEndTime: '11:00', calNewConnection: 'local' } : { todoNewTitle: 'Synthetisches Altformular', todoNewConnection: 'local', todoNewPriority: 'normal' };
    x.root.fields = Object.entries(values).map(([id, value]) => { const el = c.document.getElementById(id); el.id = id; el.value = value; return el; }); c.document.getElementById('calNewAllDay').checked = false;
    c.pendingAttachmentsHTML = () => 'Ausgewählte Anlagen';
    c.attachmentsSectionHTML = async (_kind, id) => JSON.stringify(await x.attachments(id));
    vm.runInContext(region('window.__calendarSaveForm=', 'window.__calendarDeleteEvent=') + region('window.__todoSaveForm=', 'window.__todoDoSync='), c);
    x.run = () => c[kind === 'calendar' ? '__calendarSaveForm' : '__todoSaveForm'](); x.title = c.document.getElementById(kind === 'calendar' ? 'calNewTitle' : 'todoNewTitle'); return x;
  }
  await t.test('Altformular: Neuanlage mit Anlage bleibt lokal und online erneut lesbar', async () => {
    for (const kind of ['calendar', 'todo']) for (const mode of ['online', 'local']) { const x = await legacy(kind, mode), before = await x.read(kind); x.select([file()]); await x.run(); const saved = (await x.read(kind)).find(r => !before.some(old => old.id === r.id)); assert.ok(saved); assert.equal((await x.attachments(saved.id)).length, 1); assert.equal(x.opened, 1); }
  });
  await t.test('Altformular: fehlgeschlagene Anlagen bleiben mit gespeicherter Kennung für einen sicheren Folgeversuch erhalten', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await legacy(kind), f = file(), read = f.arrayBuffer; f.arrayBuffer = async () => { throw Error('Dateifehler'); }; x.select([f]); await x.run(); const id = x.id(); assert.ok(id); assert.deepEqual(Array.from(x.pending()), [f]); assert.equal(x.opened, 0); f.arrayBuffer = read; await x.run(); assert.equal((await x.attachments(id)).length, 1); assert.equal(x.calls.filter(c => c.method === 'POST' && !c.url.endsWith('/attachments')).length, 1); }
  });
  await t.test('Altformular: ausgewählte Anlagen werden auch beim Ändern eines vorhandenen Vorgangs gespeichert', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await legacy(kind), item = await x.create(kind); x.setId(item.id); x.select([file()]); await x.run(); assert.equal((await x.attachments(item.id)).length, 1); assert.equal(x.pending().length, 0); }
  });
  await t.test('Altformular: eine verlorene Neuanlegeantwort sperrt auch geänderte Eingaben', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await legacy(kind, 'online', async (url, opts) => { if (opts.method !== 'POST') return null; await request(url, opts); throw Error('Antwort verloren'); }); await x.run(); x.title.value = 'Geänderte Eingabe'; await x.run(); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); assert.equal(x.opened, 0); }
  });
  await t.test('Altformular: neuer Formularcontainer bleibt nach spätem Speicherabschluss unverändert', async () => {
    for (const kind of ['calendar', 'todo']) { let x; x = await legacy(kind, 'online', async (url, opts) => { if (opts.method !== 'POST') return null; const r = await request(url, opts); x.nodes.set(kind === 'calendar' ? 'calFullNewForm' : 'todoFullNewForm', form()); x.setId('neuere-kennung'); x.select([file('Neu.pdf')]); return r; }); x.select([file()]); await x.run(); assert.equal(x.id(), 'neuere-kennung'); assert.equal(x.pending()[0].name, 'Neu.pdf'); assert.equal(x.opened, 0); }
  });
  await t.test('Altformular: gescheiterte Folgeansicht wird als Anzeigeproblem nach bestätigter Speicherung gemeldet', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await legacy(kind); x.open = async () => { throw Error('Anzeige fehlt'); }; await x.run(); assert.ok(x.notices.some(n => /gespeichert.*Anzeige/.test(n))); }
  });
  await t.test('Altformular: ein Doppelklick führt nur einen Abschluss aus', async () => {
    for (const kind of ['calendar', 'todo']) { let release, entered; const gate = new Promise(r => { release = r; }), start = new Promise(r => { entered = r; }); const x = await legacy(kind, 'online', async (_url, opts) => { if (opts.method === 'POST') { entered(); await gate; } return null; }); const first = x.run(); await start; const second = x.run(); release(); await Promise.all([first, second]); assert.equal(x.opened, 1); }
  });
  await t.test('Altformular: Fehler der Quellverknüpfung behält Kennung und Entwurf statt erneuter Neuanlage', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await legacy(kind); x.root.dataset.gdpLinkedToken = 'synthetisch'; x.c.__goalDecisionPlanningGetLinkedAction = () => ({ sourceId: 'synthetisch' }); let calls = 0; x.c.__goalDecisionPlanningLinkedActionSaved = () => { calls++; throw Error('Quellverknüpfung fehlt'); }; await x.run(); const id = x.id(); assert.ok(id); await x.run(); assert.equal(x.id(), id); assert.equal(calls, 1); assert.equal(x.opened, 0); }
  });
};
