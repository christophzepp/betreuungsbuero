'use strict';

const assert = require('node:assert/strict');
const fixture = require('../fixtures/server-first/pilot-case.json');

module.exports = async function offlineLists(t, { db, reset, client, stored }) {
  async function verify(before, offline) {
    reset();
    db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify(before), fixture.caseId);
    const c = await client(), packet = await c.load(before, offline);
    assert.ok(c.rows.length > 0); assert.ok(c.rows.every(row => row.wahl));
    await c.apply(); assert.equal(c.errors.length, 0); assert.deepEqual(stored(), offline);
    const again = await client(); await again.importText(packet); await again.apply();
    assert.equal(again.calls.filter(call => call.method === 'PATCH').length, 0);
    assert.deepEqual(stored(), offline);
  }

  await t.test('Neue Listeneinträge behalten IDs und Werte ohne zusätzliches Feld mit leerem Namen', async () => {
    const before = structuredClone(fixture.stammdaten), offline = structuredClone(before);
    offline.healthInfo.diagnoses.push({ id: 'diagnosis-2', text: 'Weiterer synthetischer Eintrag', active: false, count: 0 });
    offline.care.taskAreas.push('Wohnungsangelegenheiten');
    await verify(before, offline);
  });

  await t.test('Löschen einer Zeichenketten-Listenposition erhält beide benachbarten Werte', async () => {
    const before = structuredClone(fixture.stammdaten);
    before.care.taskAreas = ['Vermögenssorge', 'Gesundheitssorge', 'Wohnungsangelegenheiten'];
    const offline = structuredClone(before); offline.care.taskAreas.splice(1, 1);
    await verify(before, offline);
  });

  await t.test('Löschen eines Objekteintrags oder einzelnen Listenfeldes erhält den übrigen Bestand', async () => {
    for (const wholeEntry of [true, false]) {
      const before = structuredClone(fixture.stammdaten);
      before.healthInfo.diagnoses.push({ id: 'diagnosis-2', text: 'Unveränderter Nachbar', active: false });
      const offline = structuredClone(before);
      if (wholeEntry) offline.healthInfo.diagnoses.splice(0, 1);
      else delete offline.healthInfo.diagnoses[0].since;
      await verify(before, offline);
    }
  });
};
