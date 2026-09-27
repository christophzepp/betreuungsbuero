'use strict';
const assert = require('node:assert/strict');
const fixture = require('../fixtures/server-first/pilot-case.json');
const clone = x => JSON.parse(JSON.stringify(x));
module.exports = async function autoStore(t, { setup, request, db, setActor }) {
  let serial = 0;
  async function fresh(mode = 'online', intercept) { const x = await setup(mode, intercept); x.sid = 'sf-auto-store-' + (++serial); x.run = (p = {}, action = 'created') => x.auto(p, x.sid, action); return x; }
  const stored = id => JSON.parse(db.prepare('SELECT data_json FROM case_doku_entries WHERE id=?').get(id).data_json);
  await t.test('Auto-Dokumentation speichern: Anlegen, Aktualisieren und Statuswechsel haben passende bestätigte Kennungen', async () => {
    const x = await fresh(), before = (await x.docs()).length, first = await x.run(), second = await x.run({ title: 'Aktualisiert' }), completed = await x.run({}, 'completed');
    assert.ok(first?.id && completed?.id); assert.equal(first.id, second.id); assert.notEqual(first.id, completed.id); assert.equal((await x.docs()).length, before + 2); assert.ok(stored(second.id).freeDetail.includes('Aktualisiert'));
  });
  await t.test('Auto-Dokumentation speichern: kalter Cache verwendet den bestehenden Servereintrag mit Zusatzfeldern und Anlage', async () => {
    const x = await fresh(), entry = await x.run(), bytes = Buffer.from('%PDF-1.4\nAutomatische Dokumentation\n%%EOF');
    await request(`/api/cases/${fixture.caseId}/doku-entries/${entry.id}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'Automatisch.pdf', mimeType: 'application/pdf', dataBase64: bytes.toString('base64') }) });
    const data = { ...stored(entry.id), unknown: { keep: null }, reportSummary: 'Freigegebener Text' };
    await request(`/api/cases/${fixture.caseId}/doku-entries/${entry.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
    const y = await fresh(); y.sid = x.sid; const before = (await y.docs()).length, result = await y.run({ title: 'Geändert' });
    assert.equal(result.id, entry.id); assert.equal((await y.docs()).length, before); assert.deepEqual(stored(entry.id).unknown, { keep: null }); assert.equal(stored(entry.id).reportSummary, data.reportSummary);
    const download = await request(`/api/cases/${fixture.caseId}/doku-entries/${entry.id}/photos/${data.photos[0].id}`); assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  });
  await t.test('Auto-Dokumentation speichern: fehlerhafter Serverabruf löst keinen Schreibauftrag aus', async () => {
    for (const reply of [() => Response.json({}, { status: 503 }), () => Response.json({}), () => Response.json({ entries: [{ id: 'x', data: null }] }), () => Response.json({ entries: [{ id: 'x', data: {} }, { id: 'x', data: {} }] })]) {
      const x = await fresh('online', (_url, opts) => !opts.method ? reply() : null); assert.equal(await x.run(), null); assert.equal(x.calls.filter(c => c.method !== 'GET').length, 0); assert.ok(x.notices.length);
    }
  });
  await t.test('Auto-Dokumentation speichern: ungültige POST- und PUT-Bestätigungen erzeugen keinen lokalen Erfolg', async () => {
    for (const update of [false, true]) for (const reply of [() => new Response('<html>Login</html>'), () => Response.json({})]) {
      let broken = false; const x = await fresh('online', (_url, opts) => broken && opts.method ? reply() : null); if (update) await x.run(); const before = clone(x.c.state); broken = true;
      assert.equal(await x.run(), null); assert.deepEqual(clone(x.c.state), before);
    }
  });
  await t.test('Auto-Dokumentation speichern lokal: aktiver und geschlossener Fall werden bei Schreibfehler vollständig zurückgenommen', async () => {
    for (const closed of [false, true]) {
      const x = await fresh('local'), caseId = closed ? 'sf-doku-ziel' : fixture.caseId, slot = [...x.storage].find(([, v]) => Array.isArray(JSON.parse(v)) === closed)[0];
      const before = clone(x.c.state), registry = clone(x.c.caseRegistry), saved = [...x.storage]; x.fail(slot); assert.equal(await x.run({ caseId }), null);
      assert.deepEqual(clone(x.c.state), before); assert.deepEqual(clone(x.c.caseRegistry), registry); assert.deepEqual([...x.storage], saved);
      x.fail(null); assert.ok(await x.run({ caseId })); const loaded = JSON.parse(x.storage.get(slot)); assert.equal((closed ? loaded[1].state : loaded).caseData.documentationEntries.length, 1);
    }
  });
  await t.test('Auto-Dokumentation speichern: verlorene Commit-Antwort sperrt dieselbe Quelle gegen erneutes Schreiben', async () => {
    const x = await fresh('online', async (url, opts) => { if (!opts.method) return null; const r = await request(url, opts); assert.equal(r.status, 201); throw Error('Antwort verloren'); });
    const before = (await x.docs()).length; assert.equal(await x.run(), null); assert.equal(await x.run(), null);
    assert.equal((await x.docs()).length, before + 1); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); assert.equal(x.c.state.caseData.documentationEntries.length, 0);
  });
  await t.test('Auto-Dokumentation speichern: parallele Aufträge für einen nicht zwischengespeicherten Fall erzeugen eine Serverzeile', async () => {
    const x = await fresh(); x.c.__onlineCaseCache.delete('sf-doku-ziel'); const before = (await x.docs('sf-doku-ziel')).length;
    const results = await Promise.all([x.run({ caseId: 'sf-doku-ziel' }), x.run({ caseId: 'sf-doku-ziel', title: 'Zweiter Stand' })]);
    assert.ok(results.every(Boolean)); assert.equal(results[0].id, results[1].id); assert.equal((await x.docs('sf-doku-ziel')).length, before + 1);
  });
  await t.test('Auto-Dokumentation speichern: Fall- oder Moduswechsel während des Abrufs verhindert das Schreiben', async () => {
    for (const mode of [false, true]) { const x = await fresh('online', async (url, opts, c) => { if (opts.method) return null; const r = await request(url, opts); if (mode) c.__appMode = 'local'; else c.__activeServerCaseId = 'sf-doku-ziel'; return r; }); assert.equal(await x.run(), null); assert.equal(x.calls.filter(c => c.method !== 'GET').length, 0); }
  });
  await t.test('Auto-Dokumentation speichern: frühes Echo bleibt erhalten und wird nicht mit der älteren Antwort überschrieben', async () => {
    const x = await fresh('online', async (url, opts, c) => { if (!opts.method) return null; const r = await request(url, opts), reply = await r.clone().json(); c.state.caseData.documentationEntries.push({ ...JSON.parse(opts.body).data, id: reply.id, freeDetail: 'Neuerer Stand' }); return r; });
    assert.ok(await x.run()); assert.equal(x.c.state.caseData.documentationEntries.length, 1); assert.equal(x.c.state.caseData.documentationEntries[0].freeDetail, 'Neuerer Stand');
  });
  await t.test('Auto-Dokumentation speichern: tatsächlicher Rechteentzug lässt Server und Ansicht unverändert', async () => {
    const x = await fresh(), before = (await x.docs()).length; setActor('reader'); assert.equal(await x.run(), null); assert.equal((await x.docs()).length, before); assert.equal(x.c.state.caseData.documentationEntries.length, 0); assert.ok(x.notices.length);
  });
  await t.test('Auto-Dokumentation speichern: doppelte Quellverweise im Serverbestand werden nicht willkürlich aktualisiert', async () => {
    const x = await fresh(), first = await x.run(), data = stored(first.id);
    await request(`/api/cases/${fixture.caseId}/doku-entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
    x.calls.length = 0; assert.equal(await x.run({ title: 'Nicht übernehmen' }), null); assert.equal(x.calls.filter(c => c.method !== 'GET').length, 0);
  });
  await t.test('Auto-Dokumentation speichern lokal: fehlende Speicherfunktion erzeugt keinen scheinbar gespeicherten Eintrag', async () => {
    const x = await fresh('local'), before = clone(x.c.state); x.c.saveState = undefined; assert.equal(await x.run(), null); assert.deepEqual(clone(x.c.state), before);
  });
};
