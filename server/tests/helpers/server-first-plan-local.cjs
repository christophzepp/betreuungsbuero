'use strict';
const assert = require('node:assert/strict');
module.exports = async function local(t, { setup, keys, file }) {
  await t.test('Planungsanlagen lokal: Hinzufügen, Neuladen und Entfernen erhalten Nachbarn und Zusatzfelder', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('local'), first = await x.add(kind, 'local-parent'), second = await x.add(kind, 'local-parent'); assert.notEqual(first.id, second.id); assert.equal((await x.read(kind)).length, 2); await x.remove(kind, 'local-parent', first.id); const rows = JSON.parse(x.storage.get(keys[kind])); assert.equal(rows[0].attachments[0].id, second.id); assert.deepEqual(rows[0].unknown, { keep: null }); assert.equal(rows[0].attachments[0].dataBase64, first.dataBase64); }
  });
  await t.test('Planungsanlagen lokal: fehlgeschlagenes Hinzufügen bestätigt weder Speicherung noch Änderungsereignis', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('local'), before = x.storage.get(keys[kind]); x.fail(keys[kind]); await assert.rejects(x.add(kind, 'local-parent')); assert.equal(x.storage.get(keys[kind]), before); assert.equal(x.saved.length, 0); x.fail(null); assert.ok((await x.add(kind, 'local-parent')).id); }
  });
  await t.test('Planungsanlagen lokal: fehlgeschlagenes Entfernen erhält den gespeicherten Anhang', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('local'), att = await x.add(kind, 'local-parent'), before = x.storage.get(keys[kind]); x.saved.length = 0; x.fail(keys[kind]); await assert.rejects(x.remove(kind, 'local-parent', att.id)); assert.equal(x.storage.get(keys[kind]), before); assert.equal(x.saved.length, 0); }
  });
  await t.test('Planungsanlagen lokal: beschädigte oder doppelte Anlagenkennungen werden nicht überschrieben', async () => {
    for (const kind of ['calendar', 'todo']) for (const attachments of [{ bad: true }, [{ id: 'x', filename: 'A' }, { id: 'x', filename: 'B' }]]) { const x = await setup('local'), before = JSON.stringify([{ id: 'local-parent', attachments }]); x.storage.set(keys[kind], before); await assert.rejects(x.add(kind, 'local-parent')); await assert.rejects(x.remove(kind, 'local-parent', 'x')); assert.equal(x.storage.get(keys[kind]), before); }
  });
  await t.test('Planungsanlagen lokal: fehlender Vorgang oder Anhang ist keine erfolgreiche Löschung', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('local'), before = [...x.storage]; await assert.rejects(x.remove(kind, 'fehlt', 'x')); await assert.rejects(x.remove(kind, 'local-parent', 'x')); assert.deepEqual([...x.storage], before); }
  });
  await t.test('Planungsanlagen: Moduswechsel während des Dateilesens löst keinen Auftrag im neuen Ziel aus', async () => {
    for (const kind of ['calendar', 'todo']) for (const mode of ['local', 'online']) { const x = await setup(mode), before = [...x.storage], f = file(); f.arrayBuffer = async () => { x.c.__appMode = mode === 'online' ? 'local' : 'online'; return new ArrayBuffer(1); }; await assert.rejects(x.add(kind, 'local-parent', f)); assert.equal(x.calls.length, 0); assert.deepEqual([...x.storage], before); }
  });
  await t.test('Planungsanlagen lokal: während des Lesens gelöschter Vorgang wird nicht wiederhergestellt', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('local'), f = file(); f.arrayBuffer = async () => { x.storage.set(keys[kind], '[]'); return new ArrayBuffer(1); }; await assert.rejects(x.add(kind, 'local-parent', f)); assert.equal(x.storage.get(keys[kind]), '[]'); }
  });
  await t.test('Planungsanlagen lokal: parallel gelesene Dateien ergänzen den jeweils aktuellen Bestand', async () => {
    for (const kind of ['calendar', 'todo']) { const x = await setup('local'); const items = await Promise.all([x.add(kind, 'local-parent'), x.add(kind, 'local-parent')]); const loaded = await x.read(kind); assert.equal(loaded.length, 2); assert.deepEqual(new Set(loaded.map(a => a.id)), new Set(items.map(a => a.id))); }
  });
};
