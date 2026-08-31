'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const coordinator = require('../src/modules/documents/operation-coordinator');

test('führt konkurrierende Arbeiten seriell aus und priorisiert die Warteschlange', async () => {
  const order = [];
  let release;
  const first = coordinator.runExclusive('erste', async () => {
    order.push('erste-start');
    await new Promise((resolve) => { release = resolve; });
    order.push('erste-ende');
  });
  await new Promise((resolve) => setImmediate(resolve));
  const low = coordinator.runExclusive('niedrig', async () => { order.push('niedrig'); }, { priority: 1 });
  const high = coordinator.runExclusive('hoch', async () => { order.push('hoch'); }, { priority: 100 });
  release();
  await Promise.all([first, low, high]);
  assert.deepEqual(order, ['erste-start', 'erste-ende', 'hoch', 'niedrig']);
});

test('verschachtelte Arbeit ist reentrant und skipIfBusy startet keine Konkurrenz', async () => {
  let release;
  const events = [];
  const outer = coordinator.runExclusive('außen', async () => {
    events.push('außen');
    await coordinator.runExclusive('innen', async (operation) => {
      assert.equal(operation.nested, true);
      events.push('innen');
    });
    await new Promise((resolve) => { release = resolve; });
  });
  await new Promise((resolve) => setImmediate(resolve));
  const skipped = await coordinator.runExclusive('überspringen', async () => {
    throw new Error('darf nicht laufen');
  }, { skipIfBusy: true });
  assert.equal(skipped.skipped, true);
  release();
  await outer;
  assert.deepEqual(events, ['außen', 'innen']);
});
