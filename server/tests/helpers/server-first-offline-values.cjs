'use strict';

const assert = require('node:assert/strict');
const fixture = require('../fixtures/server-first/pilot-case.json');

module.exports = async function offlineValues(t, { db, reset, client, stored }) {
  const save = data => db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?')
    .run(JSON.stringify(data), fixture.caseId);

  await t.test('Historische Änderungs-IDs bleiben für Setzen, Löschen und Hinzufügen unverändert', async () => {
    const examples = [
      [{ healthInfo: { notes: 'vorher' } }, { healthInfo: { notes: 'nachher' } }, '51fedb460d08399fe6ee21b2c45986c3'],
      [{ unknownLegacyField: { nullValue: null } }, {}, '3e7156a0c3ea18240ce2abd21641be0a'],
      [{ healthInfo: { notes: null } }, { healthInfo: { notes: '' } }, 'b627c2c21a8b1778ad08f9e099302796'],
      [{}, { healthInfo: { notes: false } }, '09e02398e9cbf2b5e6c97470377ec225']
    ];
    for (const [before, offline, expected] of examples) {
      reset(); const c = await client(); await c.load(before, offline);
      assert.equal(c.rows.length, 1); assert.equal(c.rows[0].changeId, expected);
    }
  });

  await t.test('Ein vorhandener Nullwert kann gelöscht und die Rückgabe ohne erneuten Schreibzugriff wiederholt werden', async () => {
    reset();
    const offline = structuredClone(fixture.stammdaten); delete offline.unknownLegacyField.nullValue;
    const c = await client(), packet = await c.load(fixture.stammdaten, offline);
    assert.equal(c.rows.length, 1); assert.equal(c.rows[0].kind, 'del'); assert.equal(c.rows[0].wahl, true);
    await c.apply(); assert.equal(c.errors.length, 0); assert.deepEqual(stored(), offline);
    assert.equal(Object.hasOwn(stored().unknownLegacyField, 'nullValue'), false);
    const again = await client(); await again.importText(packet); await again.apply();
    assert.equal(again.rows[0].ledgerState, 'applied');
    assert.equal(again.calls.filter(call => call.method === 'PATCH').length, 0);
  });

  await t.test('Eine Büro-Löschung eines Nullwerts zählt vor und nach der Vorschau als Konflikt', async () => {
    for (const beforePreview of [true, false]) {
      reset();
      const office = structuredClone(fixture.stammdaten); delete office.unknownLegacyField.nullValue;
      const offline = structuredClone(fixture.stammdaten); offline.unknownLegacyField.nullValue = 'Unterwegs ergänzt';
      if (beforePreview) save(office);
      const c = await client(); await c.load(fixture.stammdaten, offline);
      if (!beforePreview) { assert.equal(c.rows[0].wahl, true); save(office); }
      await c.apply();
      assert.equal(c.rows[0].status, 'konflikt'); assert.equal(c.rows[0].wahl, false);
      assert.equal(c.calls.filter(call => call.method === 'PATCH').length, 0); assert.deepEqual(stored(), office);
    }
  });

  await t.test('Bestehende Werte wechseln verlustfrei zwischen Text, leerem Text, Null, Nullbetrag und falsch', async () => {
    for (const [from, to] of [[null, ''], ['', null], ['Text', null], [null, 0], [0, false], [false, '']]) {
      reset();
      const before = structuredClone(fixture.stammdaten); before.unknownLegacyField.nullValue = from; save(before);
      const offline = structuredClone(before); offline.unknownLegacyField.nullValue = to;
      const c = await client(); await c.load(before, offline); assert.equal(c.rows[0].wahl, true);
      await c.apply(); assert.equal(c.errors.length, 0); assert.deepEqual(stored(), offline);
    }
  });

  await t.test('Bisherige Regel für neu hinzukommende leere Felder bleibt ausdrücklich unverändert', async () => {
    reset();
    const offline = structuredClone(fixture.stammdaten);
    offline.unknownLegacyField.newNull = null; offline.unknownLegacyField.newEmpty = '';
    const c = await client(); await c.load(fixture.stammdaten, offline); assert.equal(c.rows.length, 0);
    await c.apply(); assert.equal(c.calls.filter(call => call.method === 'PATCH').length, 0);
    assert.deepEqual(stored(), fixture.stammdaten);
  });
};
