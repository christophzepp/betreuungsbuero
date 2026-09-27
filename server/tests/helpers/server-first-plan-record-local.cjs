'use strict';
const assert = require('node:assert/strict');
module.exports = async function localRecords(t, { setup, keys, payload, clone }) {
  await t.test('Planung lokal: Anlegen, Ändern und Löschen erhalten Nachbarn und unbekannte Felder beim Neuladen', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('local'), before = JSON.parse(x.storage.get(keys[kind])), item = await x.create(kind); assert.ok(item.id); await x.update(kind, item.id, { description: 'Geändert' }); assert.equal((await x.read(kind)).find(r => r.id === item.id).description, 'Geändert'); const changed = await x.update(kind, 'local-parent', { title: 'Bestätigt' }); assert.deepEqual(clone(changed.unknown), before[0].unknown); assert.deepEqual(clone(changed.attachments), before[0].attachments); await x.remove(kind, item.id); assert.equal((await x.read(kind)).length, 1); assert.equal((await x.read(kind))[0].title, 'Bestätigt'); }
  });
  await t.test('Planung lokal: kein Schreibvorgang ersetzt beschädigten Bestand', async () => {
    for (const kind of ['calendar', 'todo']) for (const raw of ['{', '{}', '[null]', '[{"id":"local-parent"},{"id":"local-parent"}]']) for (const action of ['create', 'update', 'remove']) { const x = await setup('local'); x.storage.set(keys[kind], raw); await assert.rejects(x[action](kind, ...(action === 'create' ? [] : ['local-parent', { title: 'Neu' }]))); assert.equal(x.storage.get(keys[kind]), raw); assert.equal(x.saved.length, 0); }
  });
  await t.test('Planung lokal: fehlende Ziele werden weder geändert noch als gelöscht bestätigt', async () => {
    for (const kind of ['calendar', 'todo']) for (const action of ['update', 'remove']) { const x = await setup('local'), before = x.storage.get(keys[kind]); await assert.rejects(x[action](kind, 'missing', { title: 'Neu' })); assert.equal(x.storage.get(keys[kind]), before); assert.equal(x.saved.length, 0); }
  });
  await t.test('Planung lokal: Nutzdaten dürfen die Vorgangskennung nicht ersetzen', async () => {
    for (const kind of ['calendar', 'todo']) for (const action of ['create', 'update']) { const x = await setup('local'), before = x.storage.get(keys[kind]); await assert.rejects(x[action](kind, ...(action === 'create' ? [{ ...payload(), id: 'local-parent' }] : ['local-parent', { id: 'anderes-ziel' }]))); assert.equal(x.storage.get(keys[kind]), before); }
  });
  await t.test('Planung lokal: Schreibfehler bestätigen und dokumentieren keine der drei Operationen', async () => {
    for (const kind of ['calendar', 'todo']) for (const action of ['create', 'update', 'remove']) { const x = await setup('local'), before = x.storage.get(keys[kind]); x.fail(keys[kind]); await assert.rejects(x[action](kind, ...(action === 'create' ? [{ ...payload(), caseId: 'synthetisch' }] : ['local-parent', { title: 'Neu', caseId: 'synthetisch' }]))); assert.equal(x.storage.get(keys[kind]), before); assert.equal(x.saved.length, 0); assert.equal(x.documented.length, 0); }
  });
  await t.test('Planung lokal: wirkungsloser Speichertreiber wird beim Zurücklesen erkannt', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('local'), before = x.storage.get(keys[kind]); x.c.localStorage.setItem = () => {}; await assert.rejects(x.create(kind)); assert.equal(x.storage.get(keys[kind]), before); assert.equal(x.saved.length, 0); }
  });
  await t.test('Planung lokal: kollidierende neu erzeugte Kennung überschreibt keinen Bestand', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('local'), before = x.storage.get(keys[kind]); x.c.uid = () => 'local-parent'; await assert.rejects(x.create(kind)); assert.equal(x.storage.get(keys[kind]), before); }
  });
  await t.test('Planung lokal: behobener Speicherfehler erlaubt denselben Auftrag erneut', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('local'); x.fail(keys[kind]); await assert.rejects(x.update(kind, 'local-parent', { title: 'Korrigiert' })); x.fail(null); assert.equal((await x.update(kind, 'local-parent', { title: 'Korrigiert' })).title, 'Korrigiert'); assert.equal((await x.read(kind))[0].title, 'Korrigiert'); assert.equal(x.calls.length, 0); }
  });
};
