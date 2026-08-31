/* Kernlogik des Super-Productivity-Plugins (PLAN-AUFGABEN-SYNC, Etappe 6).
 * sync-core.js ist bewusst SP-frei - hier läuft reconcile() gegen klare Ausgangslagen.
 * Die Leitplanken: das Büro führt; Fristen (readOnly) gehen nie zurück; SP-Neues wandert
 * nur auf Knopfdruck ins Büro.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const core = require(path.join(__dirname, '..', '..', 'Super-Productivity-Plugin', 'sync-core.js'));

const remoteTask = (over) => Object.assign({
  id: 'r1', title: 'Bericht', description: '', dueAt: '2026-08-20',
  done: false, priority: 'high', readOnly: false, updatedAt: '2026-08-01T10:00:00Z'
}, over);
const spTask = (over) => Object.assign({
  id: 's1', title: 'Bericht', notes: '', isDone: false, dueDay: '2026-08-20', updatedAt: 0
}, over);

test('neue Büro-Aufgabe wird in SP angelegt', () => {
  const ops = core.reconcile({ remoteTodos: [remoteTask()], spTasks: [], mapping: {} });
  assert.deepEqual(ops.map((o) => o.type), ['sp-create']);
});

test('bereits erledigte Büro-Aufgabe ohne SP-Seite wird NICHT mehr angelegt', () => {
  const ops = core.reconcile({ remoteTodos: [remoteTask({ done: true })], spTasks: [], mapping: {} });
  assert.equal(ops.length, 0);
});

test('Büro sagt erledigt -> SP hakt ab; SP sagt erledigt -> Rückmeldung ans Büro', () => {
  const opsA = core.reconcile({ remoteTodos: [remoteTask({ done: true })], spTasks: [spTask()], mapping: { r1: 's1' } });
  assert.deepEqual(opsA.map((o) => o.type), ['sp-complete']);
  const opsB = core.reconcile({ remoteTodos: [remoteTask()], spTasks: [spTask({ isDone: true })], mapping: { r1: 's1' } });
  assert.deepEqual(opsB.map((o) => o.type), ['remote-complete']);
});

test('Frist in SP abgehakt: KEINE Rückmeldung, SP-Seite wird zurückgesetzt (Nur-Export)', () => {
  const ops = core.reconcile({
    remoteTodos: [remoteTask({ readOnly: true })],
    spTasks: [spTask({ isDone: true })],
    mapping: { r1: 's1' }
  });
  assert.deepEqual(ops.map((o) => o.type), ['sp-update'], 'Die Frist muss in SP wieder offen erscheinen.');
});

test('Textabweichung: das Büro führt - außer die SP-Seite ist nachweislich neuer', () => {
  const alt = core.reconcile({
    remoteTodos: [remoteTask()],
    spTasks: [spTask({ title: 'Bericht (alt getippt)', updatedAt: Date.parse('2026-08-01T09:00:00Z') })],
    mapping: { r1: 's1' }
  });
  assert.deepEqual(alt.map((o) => o.type), ['sp-update'], 'Ältere SP-Fassung weicht dem Bürostand.');

  const neuer = core.reconcile({
    remoteTodos: [remoteTask()],
    spTasks: [spTask({ title: 'Bericht (frisch getippt)', updatedAt: Date.parse('2026-08-01T11:00:00Z') })],
    mapping: { r1: 's1' }
  });
  assert.deepEqual(neuer.map((o) => o.type), ['remote-update']);
  assert.equal(neuer[0].patch.title, 'Bericht (frisch getippt)');
});

test('Frist mit Textabweichung wird immer auf den Bürostand gestellt', () => {
  const ops = core.reconcile({
    remoteTodos: [remoteTask({ readOnly: true })],
    spTasks: [spTask({ title: 'Umbenannt in SP', updatedAt: Date.now() })],
    mapping: { r1: 's1' }
  });
  assert.deepEqual(ops.map((o) => o.type), ['sp-update']);
});

test('verschwundene Remote-Seite räumt nur das Mapping, löscht nichts', () => {
  const ops = core.reconcile({ remoteTodos: [], spTasks: [spTask()], mapping: { r1: 's1' } });
  assert.deepEqual(ops, [{ type: 'mapping-drop', remoteId: 'r1' }]);
});

test('newSpTasks: nur ungemappte, offene SP-Aufgaben - für den bewussten Übertragen-Knopf', () => {
  const list = core.newSpTasks({
    spTasks: [spTask(), spTask({ id: 's2', title: 'Privat in SP' }), spTask({ id: 's3', isDone: true })],
    mapping: { r1: 's1' }
  });
  assert.deepEqual(list.map((t) => t.id), ['s2']);
});
