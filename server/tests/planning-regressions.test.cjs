'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
const script = html.split('<script id="calendar-todo-script-v1">')[1].split('</script>')[0];
function source(name) {
  const match = new RegExp('(?:async )?function ' + name + '\\(').exec(script);
  assert.ok(match, 'Funktion fehlt: ' + name);
  for (let end = script.indexOf('}', match.index); end >= 0; end = script.indexOf('}', end + 1)) {
    const candidate = script.slice(match.index, end + 1);
    try { new vm.Script('(' + candidate + ')'); return candidate; } catch (_) {}
  }
  throw new Error('Funktionsende fehlt: ' + name);
}
function fixture(todos = [], calendar = []) {
  const values = new Map([['todos', JSON.stringify(todos)], ['calendar', JSON.stringify(calendar)]]);
  const log = [];
  const context = {
    TODO_STORAGE_KEY: 'todos', CAL_STORAGE_KEY: 'calendar', RECUR_FREQ_LABELS: { daily: 'Täglich', weekly: 'Wöchentlich', monthly: 'Monatlich', yearly: 'Jährlich' },
    window: { __appMode: 'local', createAutoDokuEntry: async entry => log.push(entry) },
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => { if (context.fail) throw new Error('QuotaExceeded'); values.set(key, value); } },
    promptTodosCache: [], uid: () => 'new-id',
  };
  vm.createContext(context);
  vm.runInContext(['loadLocal', 'saveLocal', 'isOnline', 'calCreate', 'calUpdate', 'calRemove', 'autoDokuCalendarV168', 'todoItemType', 'normalizeTodoRecord', 'todoItems', 'todoUpdate', 'autoDokuTodoV168', 'parseRecurrenceRule', 'addByFreq', 'dateToLocalIso', 'nextTodoOccurrence', 'todoSetDone'].map(source).join('\n'), context);
  return { c: context, values, log, todo: () => JSON.parse(values.get('todos'))[0] };
}
test('Kalender: fehlgeschlagene lokale Neuanlage und Löschung melden Fehler', async () => {
  const { c, values, log } = fixture([], [{ id: 'keep', title: 'Bestand' }]);
  c.fail = true;
  await assert.rejects(c.calCreate({ title: 'Neu', caseId: 'case-a' }), /lokalen Speicher/);
  await assert.rejects(c.calRemove('keep'), /lokalen Speicher/);
  assert.equal(JSON.parse(values.get('calendar')).length, 1);
  assert.equal(log.length, 0, 'Nicht gespeicherte Termine dürfen nicht dokumentiert werden.');
});
test('Kalender: zwischenzeitlich gelöschten Eintrag nicht erfolgreich aktualisieren', async () => {
  const { c } = fixture();
  await assert.rejects(c.calUpdate('missing', { title: 'Neu' }), /nicht mehr vorhanden/);
});
test('COUNT: drei Vorkommen enden nach dem dritten Abschluss, auch nach erneutem Öffnen', async () => {
  let current = { id: 'r', caseId: 'case-a', dueAt: '2026-09-11T09:00:00', done: false, recurrenceRule: JSON.stringify({ freq: 'weekly', interval: 1, count: 3 }) };
  for (const [day, remaining, done] of [['2026-09-18', 2, false], ['2026-09-25', 1, false], ['2026-09-25', 1, true]]) {
    const f = fixture([current]);
    await f.c.todoSetDone('r', true);
    current = f.todo();
    assert.equal(current.dueAt.slice(0, 10), day);
    assert.equal(JSON.parse(current.recurrenceRule).count, remaining);
    assert.equal(current.done, done);
    assert.ok(f.log.some(entry => entry.action === 'completed'));
  }
  const f = fixture([current]);
  await f.c.todoSetDone('r', false);
  assert.equal(f.todo().done, false);
  assert.equal(JSON.parse(f.todo().recurrenceRule).count, 1);
});
test('Serienabschluss dokumentiert bei fehlgeschlagenem Speichern keinen Erfolg', async () => {
  const current = { id: 'r', caseId: 'case-a', dueAt: '2026-09-11T09:00:00', done: false, recurrenceRule: JSON.stringify({ freq: 'weekly', count: 3 }) };
  const { c, log, todo } = fixture([current]); c.fail = true;
  await assert.rejects(c.todoSetDone('r', true), /lokalen Speicher/);
  assert.deepEqual(todo(), current);
  assert.equal(log.length, 0);
});
test('Enddatum und ungültige Fälligkeit erzeugen keine weitere Serieninstanz', () => {
  const { c } = fixture();
  assert.equal(c.nextTodoOccurrence({ dueAt: '2026-09-11T09:00:00', recurrenceRule: JSON.stringify({ freq: 'weekly', until: '2026-09-17' }) }), null);
  assert.equal(c.nextTodoOccurrence({ dueAt: 'kaputt', recurrenceRule: JSON.stringify({ freq: 'weekly' }) }), null);
});
test('Wiedervorlage: Rückgängig erkennt Änderungen an Serie und Quellenzuordnung', () => {
  const body = html.split('<script id="followup-workspace-v1">')[1].split('</script>')[0];
  const c = {}; vm.createContext(c);
  vm.runInContext(body.slice(body.indexOf('function hasChanged('), body.indexOf('async function fresh(')), c);
  for (const key of ['recurrenceRule', 'sourceType', 'sourceRef', 'sourceModule', 'itemType']) {
    assert.equal(c.hasChanged({ [key]: 'vorher' }, { [key]: 'nachher' }), true, key);
  }
});
