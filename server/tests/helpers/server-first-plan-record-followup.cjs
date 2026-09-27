'use strict';
const assert = require('node:assert/strict'), vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
module.exports = async function followup(t, { setup, payload, region, keys }) {
  const assigned = () => ({ ...payload(), caseId: fixture.caseId });
  await t.test('Planungsabschluss: bestätigte Dokumentation verwendet die gespeicherte Kennung ohne Fehlermeldung', async () => {
    for (const mode of ['online', 'local']) for (const kind of ['calendar', 'todo']) { const x = await setup(mode), item = await x.create(kind, assigned()); assert.equal(x.documented.length, 1); assert.equal(x.documented[0].sourceId, item.id); assert.equal(x.notices.length, 0); }
  });
  await t.test('Planungsabschluss: Dokumentationsfehler macht die gespeicherte Neuanlage oder Änderung nicht rückwirkend erfolglos', async () => {
    for (const mode of ['online', 'local']) for (const kind of ['calendar', 'todo']) { const x = await setup(mode); x.c.createAutoDokuEntry = async () => { throw Error('Dokumentation unterbrochen'); }; const item = await x.create(kind, assigned()); assert.ok(item.id); const updated = await x.update(kind, item.id, { title: 'Tatsächlich geändert' }); assert.equal(updated.title, 'Tatsächlich geändert'); assert.equal((await x.read(kind)).find(r => r.id === item.id).title, updated.title); assert.equal(x.notices.length, 2); assert.ok(x.notices.every(n => /gespeichert.*Dokumentation.*nicht bestätigt/.test(n))); }
  });
  await t.test('Planungsabschluss: fehlende Dokumentationsbestätigung wird ausdrücklich als Teilabschluss gemeldet', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup(); x.c.createAutoDokuEntry = async () => null; const item = await x.create(kind, assigned()); assert.ok(item.id); assert.equal(x.notices.length, 1); assert.match(x.notices[0], /gespeichert.*Dokumentation.*nicht bestätigt/); }
  });
  await t.test('Planungsabschluss: parallele Neuanlagen teilen auch die noch laufende automatische Dokumentation', async () => {
    for (const kind of ['calendar', 'todo']) { let release, entered; const gate = new Promise(r => { release = r; }), start = new Promise(r => { entered = r; }); const x = await setup(); let calls = 0; x.c.createAutoDokuEntry = async () => { calls++; entered(); await gate; return { id: 'doc' }; }; const first = x.create(kind, assigned()); await start; const second = x.create(kind, assigned()); release(); const results = await Promise.all([first, second]); assert.equal(results[0].id, results[1].id); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); assert.equal(calls, 1); }
  });
  await t.test('Planungsabschluss: Serienfortschritt bleibt bei fehlgeschlagener Abschlussdokumentation bestätigt', async () => {
    for (const mode of ['online', 'local']) { const x = await setup(mode); vm.runInContext(region('const RECUR_FREQ_LABELS=', 'function recurrenceLabel(') + region('function addByFreq(', 'function expandCalendarEvents(') + region('function nextTodoOccurrence(', 'function recurrencePickerHTML(') + region('function dateToLocalIso(', 'function calendarMonthGridHTML('), x.c); const item = await x.create('todo', { ...assigned(), dueAt: '2026-09-25T10:00:00', recurrenceRule: JSON.stringify({ freq: 'weekly', count: 3 }) }); x.c.createAutoDokuEntry = async data => { if (data.action === 'completed') throw Error('Abschlussdokumentation fehlgeschlagen'); return { id: 'doc' }; }; const next = await x.c.todoSetDone(item.id, true); assert.equal(next.dueAt.slice(0, 10), '2026-10-02'); assert.equal(JSON.parse(next.recurrenceRule).count, 2); assert.equal(next.done, false); assert.equal((await x.read('todo')).find(r => r.id === item.id).dueAt, next.dueAt); assert.equal(x.notices.length, 1); }
  });
  await t.test('Planungsabschluss: vor der Speicherung gescheiterte Vorgänge starten keine Folgedokumentation', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('local'); x.fail(keys[kind]); await assert.rejects(x.create(kind, assigned())); assert.equal(x.documented.length, 0); assert.equal(x.notices.length, 0); }
  });
  await t.test('Planungsabschluss: Moduswechsel während der Folgedokumentation entwertet keine erhaltene Speicherquittung', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup(), before = x.storage.get(keys[kind]); x.c.createAutoDokuEntry = async () => { x.c.__appMode = 'local'; throw Error('Moduswechsel'); }; assert.ok((await x.create(kind, assigned())).id); assert.equal(x.storage.get(keys[kind]), before); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); }
  });
  await t.test('Planungsabschluss: Fehler bei der Anzeige des Teilabschlusses löst keinen zweiten Speicherauftrag aus', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup(); x.c.createAutoDokuEntry = async () => null; x.c.toast = () => { throw Error('Anzeige fehlt'); }; assert.ok((await x.create(kind, assigned())).id); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); }
  });
};
