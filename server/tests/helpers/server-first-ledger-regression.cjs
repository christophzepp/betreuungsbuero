'use strict';

const assert = require('node:assert/strict');
const fixture = require('../fixtures/server-first/pilot-case.json');

module.exports = async function ledgerRegression(t, { db, reset, client, stored, ledger }) {
  const a = fixture.caseId, b = 'sf-pilot-b';
  const before = fixture.stammdaten;
  const offline = structuredClone(before); offline.healthInfo.notes = 'Gleicher synthetischer Hausbesuch';
  function prepare() {
    reset();
    db.prepare(`INSERT INTO cases (id,label,owner_user_id,stammdaten_json) VALUES (?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET stammdaten_json=excluded.stammdaten_json`)
      .run(b, 'Zweiter synthetischer Fall', JSON.stringify(before));
  }
  const changes = [a, b].map(caseId => ({ caseId, before, offline }));
  const saveLedger = data => db.prepare(`INSERT INTO office_json (key,data_json,updated_by)
    VALUES ('aussendienst_ledger',?,1) ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json`)
    .run(JSON.stringify(data));

  await t.test('Gleiche alte Änderungs-ID in zwei Fällen bleibt bei Teilübernahme und erneutem Import getrennt', async () => {
    prepare();
    const first = await client([a, b]), packet = await first.loadCases(changes);
    assert.equal(first.rows[0].changeId, first.rows[1].changeId, 'Der Test muss das alte kollidierende Dateiformat abdecken.');
    first.rows.find(row => row.caseId === b).wahl = false;
    await first.apply();
    assert.deepEqual(stored(a), offline); assert.deepEqual(stored(b), before);
    assert.deepEqual(Object.values(ledger().applied).map(row => row.caseId), [a]);
    assert.deepEqual(Object.values(ledger().rejected).map(row => row.caseId), [b]);
    const again = await client([a, b]); await again.importText(packet);
    const rowB = again.rows.find(row => row.caseId === b);
    assert.equal(rowB.ledgerState, 'rejected'); assert.equal(rowB.wahl, false);
    rowB.wahl = true; await again.apply();
    assert.equal(again.errors.length, 0); assert.deepEqual(stored(b), offline);
    assert.deepEqual(Object.values(ledger().applied).map(row => row.caseId).sort(), [a, b].sort());
    const replay = await client([a, b]); await replay.importText(packet); await replay.apply();
    assert.ok(replay.rows.every(row => row.ledgerState === 'applied' && !row.wahl));
    assert.equal(replay.calls.filter(call => call.method === 'PATCH').length, 0);
  });

  await t.test('Historischer Ledger-Eintrag wird nur für seinen tatsächlichen Fall und Snapshot anerkannt', async () => {
    prepare();
    const make = await client([a, b]), packet = await make.loadCases(changes);
    const id = make.rows[0].changeId;
    const legacy = { at: '2026-09-01T10:00:00Z', snapshotId: 'SF-AD-001', caseId: a, addr: 'healthInfo.notes' };
    saveLedger({ applied: { [id]: legacy }, rejected: {}, proposed: {} });
    db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify(offline), a);
    const c = await client([a, b]); await c.importText(packet);
    assert.equal(c.rows.find(row => row.caseId === a).ledgerState, 'applied');
    assert.notEqual(c.rows.find(row => row.caseId === b).ledgerState, 'applied');
    assert.equal(c.rows.find(row => row.caseId === b).wahl, true);
    await c.apply();
    assert.deepEqual(stored(b), offline);
    assert.deepEqual(ledger().applied[id], legacy, 'Historischer Eintrag darf nicht auf einen anderen Fall umgeschrieben werden.');
    assert.ok(Object.values(ledger().applied).some(row => row.caseId === b));
  });

  await t.test('Nicht zuordenbare historische Ledger-Metadaten bestätigen keine fremde Übernahme', async () => {
    for (const mismatch of [{ snapshotId: 'anderer-snapshot' }, { addr: 'anderes.feld' }, { caseId: b }, { snapshotId: '' }]) {
      prepare();
      const make = await client(), packet = await make.load(before, offline);
      saveLedger({ applied: { [make.rows[0].changeId]: {
        snapshotId: 'SF-AD-001', caseId: a, addr: 'healthInfo.notes', ...mismatch
      } }, rejected: {}, proposed: {} });
      const c = await client(); await c.importText(packet);
      assert.notEqual(c.rows[0].ledgerState, 'applied', JSON.stringify(mismatch));
      await c.apply(); assert.deepEqual(stored(a), offline);
    }
  });
};
