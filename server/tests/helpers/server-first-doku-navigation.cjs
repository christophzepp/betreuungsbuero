'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
module.exports = async function navigation(t, { client, request, region }) {
  async function setup(intercept) {
    const x = await client('online', intercept), c = x.c;
    c.fdRecLaeuft = () => false; c.fdIstIso = value => /^\d{4}-\d{2}-\d{2}$/.test(value); c.fdFuehreAus = action => x.actions.push(action);
    x.actions = []; x.element('fdFormSaveBtn'); x.element('formRoot').querySelector = () => null; x.element('dokuContactType').value = 'Persönlich';
    vm.runInContext(region('  window.fdFormSpeichern=', '  /* ---------- Einordnung wie zuletzt')
      + region('  window.fdFrageAntwort=', '  /* Nachholen der abgefangenen Aktion'), c);
    x.open(); x.question = () => { c.fdState.form.frage = true; c.fdState.form.pending = { act: 'schliessen' }; return c.fdFrageAntwort('save'); };
    return x;
  }
  await t.test('Dokumentationsnavigation: bestätigtes Speichern führt die vorgemerkte Aktion genau einmal aus', async () => {
    const x = await setup(), before = (await x.docs()).length; await x.question();
    assert.equal((await x.docs()).length, before + 1); assert.deepEqual(x.actions, [{ act: 'schliessen' }]); assert.equal(x.calls.length, 1);
  });
  await t.test('Dokumentationsnavigation: nach Fehler geschlossenes Formular ist keine Speicherbestätigung', async () => {
    const x = await setup((_url, _options, c) => { c.fdState.form = null; return Response.json({ error: 'Abgewiesen' }, { status: 403 }); });
    await x.question(); assert.equal(x.actions.length, 0); assert.equal(x.calls.length, 1);
  });
  await t.test('Dokumentationsnavigation: alte Antwort aktiviert keinen Speichern-Knopf eines neueren laufenden Formulars', async () => {
    let x, newer;
    x = await setup(async (url, options, c) => { const response = await request(url, options); x.open(); newer = c.fdState.form; newer.speichert = true; x.element('fdFormSaveBtn').disabled = true; return response; });
    const ok = await x.c.fdFormSpeichern(); assert.equal(ok, false); assert.equal(x.c.fdState.form, newer); assert.equal(x.element('fdFormSaveBtn').disabled, true);
  });
  await t.test('Dokumentationsnavigation: inzwischen geöffnetes und geschlossenes Formular verhindert alte Folgeaktion', async () => {
    const x = await setup(), original = x.c.saveDokuEntry;
    x.c.saveDokuEntry = async () => { const result = await original(); x.open(); x.c.fdState.form = null; return result; };
    await x.question(); assert.equal(x.actions.length, 0); assert.equal(x.calls.length, 1);
  });
  await t.test('Dokumentationsnavigation: Weitertippen verhindert die vorgemerkte Navigation', async () => {
    let x; x = await setup(async (url, options) => { const response = await request(url, options); x.element('dokuFreeDetail').value = 'Noch weiter bearbeiten'; return response; });
    await x.question(); assert.equal(x.actions.length, 0); assert.ok(x.c.fdState.form); assert.equal(x.element('dokuFreeDetail').value, 'Noch weiter bearbeiten');
  });
  await t.test('Dokumentationsnavigation: Zustandswechsel nach Commit führt keine alte Folgeaktion aus', async () => {
    const x = await setup(), original = x.c.saveDokuEntry;
    x.c.saveDokuEntry = async () => { const result = await original(); x.c.state = { ...x.c.state, caseData: {} }; return result; };
    await x.question(); assert.equal(x.actions.length, 0); assert.equal(x.calls.length, 1);
  });
  await t.test('Dokumentationsnavigation: doppelte Tastatur- oder Knopfauslösung schreibt nur einmal', async () => {
    let enter, release; const reached = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
    const x = await setup(async () => { enter(); await gate; }), first = x.c.fdFormSpeichern();
    try { await reached; assert.equal(await x.c.fdFormSpeichern(), false); } finally { release(); assert.equal(await first, true); }
    assert.equal(x.calls.length, 1);
  });
  await t.test('Dokumentationsnavigation: der bestehende Hinweis auf fehlendes Datum bleibt vor dem ersten Schreibversuch erhalten', async () => {
    const x = await setup(); x.element('dokuDate').value = '';
    assert.equal(await x.c.fdFormSpeichern(), false); assert.equal(x.calls.length, 0);
    assert.equal(await x.c.fdFormSpeichern(), true); assert.equal(x.calls.length, 1);
  });
};
