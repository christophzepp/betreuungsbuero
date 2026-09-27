'use strict';
const assert = require('node:assert/strict');
const clone = value => JSON.parse(JSON.stringify(value));
module.exports = async function retry(t, { client, request }) {
  await t.test('Dokumentationseditor Wiederholung: verlorene POST-Antwort erzeugt beim nächsten Speichern keinen zweiten Eintrag', async () => {
    const x = await client('online', async (url, opts) => { const r = await request(url, opts); assert.equal(r.status, 201); throw Error('Antwort verloren'); });
    const before = (await x.docs()).length; x.open(); await x.save(); await x.save();
    assert.equal((await x.docs()).length, before + 1); assert.equal(x.calls.length, 1); assert.ok(x.c.fdState.form.saveIssue);
  });
  await t.test('Dokumentationseditor Wiederholung: verlorene PUT-Antwort verhindert erneutes Überschreiben aus demselben Formular', async () => {
    const x = await client('online', async (url, opts) => { const r = await request(url, opts); assert.equal(r.status, 200); throw Error('Antwort verloren'); });
    const entry = await x.seed(); x.open(undefined, 0); await x.save(); x.element('dokuFreeDetail').value = 'Spätere Eingabe'; await x.save();
    assert.equal(x.calls.length, 1); assert.notEqual((await x.docs()).find(e => e.id === entry.id).data.freeDetail, 'Spätere Eingabe');
    assert.equal(x.element('dokuFreeDetail').value, 'Spätere Eingabe');
  });
  await t.test('Dokumentationseditor Wiederholung: nicht auswertbare Bestätigung bleibt im Formular gesperrt', async () => {
    for (const reply of [() => new Response('<html>Anmeldung</html>'), () => Response.json({})]) {
      const x = await client('online', reply); x.open(); await x.save(); await x.save(); assert.equal(x.calls.length, 1); assert.ok(x.c.fdState.form.saveIssue);
    }
  });
  await t.test('Dokumentationseditor lokal: Speicherfehler stellt auch den Zeitstempel vollständig wieder her', async () => {
    const x = await client('local'); x.open(); const slot = [...x.storage].find(([, value]) => !Array.isArray(JSON.parse(value)))[0];
    for (const timestamp of [undefined, '2020-01-02T03:04:05.000Z']) {
      if (timestamp === undefined) delete x.c.state.updatedAt; else x.c.state.updatedAt = timestamp;
      const before = clone(x.c.state), stored = [...x.storage]; x.fail(slot); await x.save(); assert.deepEqual(clone(x.c.state), before); assert.deepEqual([...x.storage], stored);
    }
    x.fail(null); await x.save(); assert.equal(JSON.parse(x.storage.get(slot)).caseData.documentationEntries.length, 1);
  });
  await t.test('Dokumentationseditor Wiederholung: Eingabefehler vor dem ersten Schreibauftrag bleiben korrigierbar', async () => {
    const x = await client(); x.open(); x.element('dokuFreeDetail').value = ''; await x.save(); assert.equal(x.calls.length, 0);
    x.element('dokuFreeDetail').value = 'Korrigierter Inhalt'; await x.save(); assert.equal(x.calls.length, 1); assert.equal(x.c.fdState.form, null);
  });
};
