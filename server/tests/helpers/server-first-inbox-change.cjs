'use strict';
const assert = require('node:assert/strict');
const fixture = require('../fixtures/server-first/pilot-case.json');
const clone = x => JSON.parse(JSON.stringify(x));
module.exports = async function inboxChange(t, { setup, request, db, setActor }) {
  const raw = id => db.prepare('SELECT data_json FROM case_doku_entries WHERE id=?').get(id);
  async function chosen(mode = 'online', intercept, removing = false, closed = false) {
    const x = await setup(mode, intercept); if (closed) x.doc.caseId = 'sf-doku-ziel';
    x.s.mode = removing ? 'loeschen' : 'aenderung';
    if (mode === 'online') x.entry = await x.seed();
    else { x.cd = closed ? x.c.caseRegistry[1].state.caseData : x.c.state.caseData; x.entry = { freeDetail: 'Alter Text', unknown: { keep: null } }; x.cd.documentationEntries = [x.entry]; }
    await x.pick(mode === 'online' ? x.entry.id : '#0'); x.s.freeDetail = 'Geänderter Text'; x.calls.length = 0;
    x.change = () => removing ? x.c.inboxModDelete('doku', x.doc, x.s) : x.c.inboxModUpdate('doku', x.doc, x.s);
    return x;
  }
  await t.test('Posteingang ändern: unbekannte Felder, Berichtsfreigabe und tatsächliche Anlage bleiben gespeichert', async () => {
    const x = await chosen(), bytes = Buffer.from('%PDF-1.4\nSynthetisch\n%%EOF');
    const upload = await request(`/api/cases/${fixture.caseId}/doku-entries/${x.entry.id}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'Erhalten.pdf', mimeType: 'application/pdf', dataBase64: bytes.toString('base64') }) });
    const photo = (await upload.json()).photo, data = { ...JSON.parse(raw(x.entry.id).data_json), reportRelevant: true, reportSummary: 'Freigegebener Bericht', reportTargets: ['initial.contact_notes'] };
    await request(`/api/cases/${fixture.caseId}/doku-entries/${x.entry.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
    await x.pick(x.entry.id); x.s.freeDetail = 'Neue Postnotiz'; await x.change();
    const stored = JSON.parse(raw(x.entry.id).data_json); assert.equal(stored.freeDetail, 'Neue Postnotiz'); assert.deepEqual(stored.unknown, { keep: null }); assert.equal(stored.reportSummary, data.reportSummary); assert.deepEqual(stored.reportTargets, data.reportTargets); assert.equal(stored.photos[0].id, photo.id);
    const downloaded = await request(`/api/cases/${fixture.caseId}/doku-entries/${x.entry.id}/photos/${photo.id}`); assert.equal(downloaded.status, 200); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  });
  await t.test('Posteingang ändern/löschen: abweichende Serverfassung nach der Auswahl verhindert den Schreibauftrag', async () => {
    for (const removing of [false, true]) {
      const x = await chosen('online', null, removing), data = { freeDetail: 'Inzwischen geändert', unknown: { new: true } };
      await request(`/api/cases/${fixture.caseId}/doku-entries/${x.entry.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
      await assert.rejects(x.change()); assert.deepEqual(JSON.parse(raw(x.entry.id).data_json), data); assert.equal(x.calls.filter(c => c.method !== 'GET').length, 0);
    }
  });
  await t.test('Posteingang ändern/löschen: falsche Bestätigung erhält die lokale Ansicht', async () => {
    for (const removing of [false, true]) for (const response of [() => Response.json({ ok: false }), () => new Response('<html>Login</html>')]) {
      const x = await chosen('online', (_url, opts) => opts.method ? response() : null, removing), before = raw(x.entry.id), local = clone(x.c.state);
      await assert.rejects(x.change()); assert.deepEqual(raw(x.entry.id), before); assert.deepEqual(clone(x.c.state), local);
    }
  });
  await t.test('Posteingang ändern/löschen lokal: aktive und geschlossene Ziele werden gespeichert und erneut gelesen', async () => {
    for (const removing of [false, true]) for (const closed of [false, true]) {
      const x = await chosen('local', null, removing, closed); await x.change();
      const slot = [...x.storage].find(([, value]) => Array.isArray(JSON.parse(value)) === closed)[0], saved = JSON.parse(x.storage.get(slot));
      const entries = (closed ? saved[1].state : saved).caseData.documentationEntries;
      assert.equal(entries.length, removing ? 0 : 1); if (!removing) { assert.equal(entries[0].freeDetail, 'Geänderter Text'); assert.deepEqual(entries[0].unknown, { keep: null }); }
    }
  });
  await t.test('Posteingang ändern/löschen lokal: Speicherfehler nimmt Liste und Zeitstempel zurück und bleibt wiederholbar', async () => {
    for (const removing of [false, true]) for (const closed of [false, true]) {
      const x = await chosen('local', null, removing, closed), slot = [...x.storage].find(([, v]) => Array.isArray(JSON.parse(v)) === closed)[0], before = clone(x.c.state), registry = clone(x.c.caseRegistry), stored = [...x.storage];
      x.fail(slot); await assert.rejects(x.change()); assert.deepEqual(clone(x.c.state), before); assert.deepEqual(clone(x.c.caseRegistry), registry); assert.deepEqual([...x.storage], stored);
      x.fail(null); await x.change(); assert.equal(x.cd.documentationEntries.length, removing ? 0 : 1);
    }
  });
  await t.test('Posteingang ändern/löschen lokal: verschobene Zeile wird über die ausgewählte Identität gefunden', async () => {
    for (const removing of [false, true]) { const x = await chosen('local', null, removing); x.cd.documentationEntries.unshift({ freeDetail: 'Nachbar' }); await x.change(); assert.equal(x.cd.documentationEntries[0].freeDetail, 'Nachbar'); assert.equal(x.cd.documentationEntries.length, removing ? 1 : 2); }
  });
  await t.test('Posteingang ändern/löschen: Fallwechsel nach Auswahl sendet keinen Schreibauftrag', async () => {
    for (const removing of [false, true]) { const x = await chosen('online', null, removing), before = raw(x.entry.id); x.doc.caseId = 'sf-doku-ziel'; await assert.rejects(x.change()); assert.deepEqual(raw(x.entry.id), before); assert.equal(x.calls.length, 0); }
  });
  await t.test('Posteingang ändern/löschen: verlorene Commit-Antwort wird nicht erneut geschrieben', async () => {
    for (const removing of [false, true]) {
      const x = await chosen('online', async (url, opts) => { if (!opts.method) return null; const r = await request(url, opts); assert.equal(r.status, 200); throw Error('Antwort verloren'); }, removing);
      await assert.rejects(x.change()); await assert.rejects(x.change()); assert.equal(x.calls.filter(c => c.method !== 'GET').length, 1);
      assert.equal(raw(x.entry.id) === undefined, removing); assert.equal(x.c.state.caseData.documentationEntries.length, 1);
    }
  });
  await t.test('Posteingang ändern/löschen: tatsächlicher Rechteentzug lässt gespeicherte Werte unverändert', async () => {
    for (const removing of [false, true]) { const x = await chosen('online', null, removing), before = raw(x.entry.id); setActor('reader'); await assert.rejects(x.change()); assert.deepEqual(raw(x.entry.id), before); }
  });
  await t.test('Posteingang ändern/löschen: frühes Echo oder neuere Eingaben werden nicht mit älteren Daten überschrieben', async () => {
    for (const removing of [false, true]) {
      const x = await chosen('online', async (url, opts, c) => { if (!opts.method) return null; const response = await request(url, opts); c.state.caseData.documentationEntries[0].freeDetail = 'Neuere Eingabe'; return response; }, removing);
      await x.change(); assert.equal(x.c.state.caseData.documentationEntries[0].freeDetail, 'Neuere Eingabe');
    }
  });
  await t.test('Posteingang ändern/löschen: überlappende Ausführung derselben Auswahl schreibt nur einmal', async () => {
    let enter, release; const reached = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
    const x = await chosen('online', async (_url, opts) => { if (opts.method) { enter(); await gate; } }); const first = x.change();
    let second; try { await reached; second = x.change(); second.catch(() => {}); } finally { release(); await first; }
    await assert.rejects(second);
    assert.equal(x.calls.filter(c => c.method !== 'GET').length, 1);
  });
  await t.test('Posteingang löschen: bestätigte Löschung entfernt nur den gewählten Eintrag aus Server und Ansicht', async () => {
    const x = await chosen('online', null, true), neighbor = await x.seed(); await x.change(); assert.equal(raw(x.entry.id), undefined); assert.ok(raw(neighbor.id)); assert.deepEqual(x.c.state.caseData.documentationEntries.map(e => e.id), [neighbor.id]);
  });
};
