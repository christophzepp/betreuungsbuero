'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
const clone = x => JSON.parse(JSON.stringify(x));
module.exports = async function autoTarget(t, { client, request, db, setActor, region }) {
  async function setup(mode = 'online', intercept) {
    const x = await client(mode, intercept || (() => null)), c = x.c;
    c.caseLabelOf = () => 'Synthetische Person (01.01.1970)'; c.fullName = c.caseLabelOf;
    c.caseRegistry[0].label = c.caseLabelOf(); c.caseRegistry[1].label = 'Anderer Fall';
    c.__onlineCaseCache.get(fixture.caseId).label = c.caseLabelOf(); c.__onlineCaseCache.get('sf-doku-ziel').label = 'Anderer Fall';
    vm.runInContext(region('  function autoDokuNormV168(', '  /* ===== Schreiben: state.caseData.documentationEntries'), c);
    x.auto = (payload = {}, sourceId = 'synthetische-quelle', action = 'created', sourceModule = 'task') => c.createAutoDokuEntry({sourceModule, sourceId, action, payload: { caseId: fixture.caseId, title: 'Synthetische Aufgabe', ...payload }});
    x.target = (id, label) => c.autoDokuTargetV168(id, label); return x;
  }
  await t.test('Auto-Dokumentation Ziel: ausdrückliche Serverkennung hat Vorrang vor einem abweichenden Namen', async () => {
    const x = await setup(), before = (await x.docs()).length;
    const saved = await x.auto({ caseId: 'sf-doku-ziel', caseLabel: x.c.caseLabelOf() }); assert.ok(saved);
    assert.equal((await x.docs()).length, before); assert.ok((await x.docs('sf-doku-ziel')).some(e => e.id === saved.id));
  });
  await t.test('Auto-Dokumentation Ziel: Namenssuche berücksichtigt Geburtszusätze und verweigert echte Mehrdeutigkeit', async () => {
    const x = await setup(); x.c.__onlineCaseCache.get('sf-doku-ziel').label = 'Synthetische Person (02.02.1980)';
    assert.equal(x.target('', 'Synthetische Person (02.02.1980)').serverCaseId, 'sf-doku-ziel');
    x.c.__onlineCaseCache.get('sf-doku-ziel').label = x.c.caseLabelOf(); assert.throws(() => x.target('', x.c.caseLabelOf()));
  });
  await t.test('Auto-Dokumentation Ziel: Serverbetrieb fällt nicht auf ein gleichnamiges lokales Register zurück', async () => {
    const x = await setup(); x.c.__onlineCaseCache.delete('sf-doku-ziel'); assert.equal(x.target('sf-doku-ziel', 'Anderer Fall'), null);
    const stored = [...x.storage]; const result = await x.auto({ caseId: 'sf-doku-ziel' }); assert.ok(result); assert.deepEqual([...x.storage], stored);
    assert.ok((await x.docs('sf-doku-ziel')).some(e => e.id === result.id));
  });
  await t.test('Auto-Dokumentation Ziel: beschädigte Listen werden beim Auflösen weder geleert noch geschrieben', async () => {
    for (const mode of ['online', 'local']) for (const value of [{ damaged: true }, [null]]) {
      const x = await setup(mode); x.c.state.caseData.documentationEntries = value; const before = clone(x.c.state);
      assert.equal(await x.auto(), null); assert.deepEqual(clone(x.c.state), before); assert.equal(x.calls.length, 0);
    }
  });
  await t.test('Auto-Dokumentation Ziel: doppelte lokale Kennungen sind keine eindeutige Fallauswahl', async () => {
    const x = await setup('local'); x.c.caseRegistry.push(clone(x.c.caseRegistry[1])); const stored = [...x.storage];
    assert.equal(await x.auto({ caseId: 'sf-doku-ziel' }), null); assert.deepEqual([...x.storage], stored);
  });
  await t.test('Auto-Dokumentation Ziel: fehlender lokaler Fallzustand wird nicht als leerer Fall angelegt', async () => {
    const x = await setup('local'); delete x.c.caseRegistry[1].state; const before = clone(x.c.caseRegistry);
    assert.equal(await x.auto({ caseId: 'sf-doku-ziel' }), null); assert.deepEqual(clone(x.c.caseRegistry), before);
  });
  await t.test('Auto-Dokumentation Ziel: aktiver und geschlossener lokaler Fall speichern getrennt', async () => {
    const x = await setup('local'); const a = await x.auto(), b = await x.auto({ caseId: 'sf-doku-ziel' }); assert.ok(a && b);
    for (const [, value] of x.storage) { const saved = JSON.parse(value); if (Array.isArray(saved)) assert.equal(saved[1].state.caseData.documentationEntries.length, 1); else assert.equal(saved.caseData.documentationEntries.length, 1); }
  });
  await t.test('Auto-Dokumentation Ziel: unbekannte Kennung wird nicht durch einen passenden Namen ersetzt', async () => {
    const x = await setup(), before = (await x.docs()).length; assert.equal(await x.auto({ caseId: 'nicht-vorhanden', caseLabel: x.c.caseLabelOf() }), null); assert.equal((await x.docs()).length, before);
  });
  await require('./server-first-auto-store.cjs')(t, { setup, request, db, setActor, region });
  await require('./server-first-auto-identity.cjs')(t, { setup, request, db, setActor, region });
  await require('./server-first-auto-mail.cjs')(t, { setup, request, db, setActor, region });
};
