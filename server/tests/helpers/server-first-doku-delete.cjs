'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
const clone = value => JSON.parse(JSON.stringify(value));
module.exports = async function deletion(t, { client, request, db, setActor, region }) {
  async function setup(mode = 'online', intercept) {
    const x = await client(mode, intercept), c = x.c;
    c.currentCaseId = fixture.caseId; c.confirm = () => true; c.warnPermissionDeniedOnce = () => {};
    c.renderDokuList = () => x.ui.push('list'); c.fdFallId = () => fixture.caseId; c.fdFormAbfangen = () => false;
    c.fdRender = () => x.ui.push('selected'); c.dokuFilteredEntriesV166 = () => ({ list: c.state.caseData.documentationEntries.map((e, i) => ({ ...e, __idx: i })) });
    vm.runInContext(region('  const originalRemoveDokuEntryForRealtime=', '  // Kontakte (Phase 2.2)') + region('  window.fdLoeschen=', '  window.fdSchliessen='), c);
    x.remove = async (id = fixture.caseId, index = 0) => { const result = await c.removeDokuEntry(id, index); await x.drain(); return result; };
    return x;
  }
  const raw = () => db.prepare('SELECT id,data_json FROM case_doku_entries WHERE case_id=? ORDER BY id').all(fixture.caseId);
  await t.test('Dokumentation löschen: Abbrechen der Rückfrage sendet auch über die Echtzeiterweiterung keine Löschung', async () => {
    const x = await setup(); await x.seed(); const before = raw(), local = clone(x.c.state.caseData.documentationEntries); x.c.confirm = () => false;
    await x.remove(); assert.equal(x.calls.length, 0); assert.deepEqual(raw(), before); assert.deepEqual(clone(x.c.state.caseData.documentationEntries), local);
  });
  await t.test('Dokumentation löschen: bestätigte Serverlöschung entfernt genau den gewünschten Eintrag', async () => {
    const x = await setup(), first = await x.seed(), second = await x.seed(); await x.remove();
    assert.equal(x.calls.length, 1); assert.equal(x.calls[0].method, 'DELETE');
    assert.ok(!raw().some(row => row.id === first.id)); assert.ok(raw().some(row => row.id === second.id));
    assert.deepEqual(x.c.state.caseData.documentationEntries.map(e => e.id), [second.id]);
  });
  await t.test('Dokumentation löschen: HTTP-Fehler und falsche Bestätigungen erhalten den geladenen Bestand', async () => {
    for (const response of [() => Response.json({}, { status: 403 }), () => new Response('<html>Login</html>'), () => Response.json({ ok: false })]) {
      const x = await setup('online', response); await x.seed(); const before = raw(), local = clone(x.c.state.caseData.documentationEntries);
      await x.remove(); assert.deepEqual(raw(), before); assert.deepEqual(clone(x.c.state.caseData.documentationEntries), local); assert.equal(x.ui.length, 0);
    }
  });
  await t.test('Dokumentation löschen lokal: aktiver und geschlossener Fall bleiben bei Speicherfehler unverändert', async () => {
    for (const closed of [false, true]) {
      const x = await setup('local'), id = closed ? 'sf-doku-ziel' : fixture.caseId;
      const cd = closed ? x.c.caseRegistry[1].state.caseData : x.c.state.caseData; cd.documentationEntries = [{ freeDetail: 'Erhalten' }, { freeDetail: 'Nachbar' }];
      const slot = [...x.storage].find(([, value]) => Array.isArray(JSON.parse(value)) === closed)[0], before = clone(cd), stored = [...x.storage];
      x.fail(slot); await x.remove(id); assert.deepEqual(clone(cd), before); assert.deepEqual([...x.storage], stored);
      x.fail(null); await x.remove(id); const loaded = JSON.parse(x.storage.get(slot));
      assert.deepEqual((closed ? loaded[1].state : loaded).caseData.documentationEntries, [{ freeDetail: 'Nachbar' }]);
    }
  });
  await t.test('Dokumentation löschen: Fallwechsel während der Rückfrage bricht vor der Serveranfrage ab', async () => {
    const x = await setup(); await x.seed(); const before = raw(); x.c.confirm = () => { x.c.__activeServerCaseId = 'sf-doku-ziel'; return true; };
    await x.remove(); assert.equal(x.calls.length, 0); assert.deepEqual(raw(), before);
  });
  await t.test('Dokumentation löschen: verlorene Antwort nach echtem Commit wird nicht lokal als bestätigt behandelt', async () => {
    const x = await setup('online', async (url, options) => { const response = await request(url, options); assert.equal(response.status, 200); throw new Error('Antwort verloren'); });
    const entry = await x.seed(); await x.remove(); assert.ok(!raw().some(row => row.id === entry.id));
    assert.equal(x.c.state.caseData.documentationEntries[0].id, entry.id); assert.equal(x.ui.length, 0); assert.equal(x.calls.length, 1);
  });
  await t.test('Dokumentation löschen: frühes Lösch-Echo entfernt keinen nachgerückten Nachbarn', async () => {
    const x = await setup('online', async (url, options, c) => { const response = await request(url, options);
      c.state.caseData.documentationEntries = c.state.caseData.documentationEntries.filter(e => !url.endsWith(e.id)); return response; });
    await x.seed(); const second = await x.seed(); await x.remove(); assert.deepEqual(x.c.state.caseData.documentationEntries.map(e => e.id), [second.id]);
  });
  await t.test('Dokumentation löschen: fehlende Kennung, ungültiger Index und fehlendes Ziel senden keine Anfrage', async () => {
    for (const issue of ['id', 'index', 'target']) {
      const x = await setup(); const entry = await x.seed(); if (issue === 'id') delete entry.id;
      const before = raw(); await x.remove(issue === 'target' ? 'unbekannt' : fixture.caseId, issue === 'index' ? -1 : 0);
      assert.equal(x.calls.length, 0); assert.deepEqual(raw(), before);
    }
  });
  await t.test('Dokumentation löschen: tatsächlicher Rechteentzug lässt Server und lokale Liste unverändert', async () => {
    const x = await setup(); await x.seed(); const before = raw(), local = clone(x.c.state.caseData.documentationEntries); setActor('reader');
    await x.remove(); assert.deepEqual(raw(), before); assert.deepEqual(clone(x.c.state.caseData.documentationEntries), local);
  });
  await t.test('Dokumentation löschen: paralleler Klick löscht nicht zusätzlich den nächsten Eintrag', async () => {
    let release, enter; const gate = new Promise(r => { release = r; }), reached = new Promise(r => { enter = r; });
    const x = await setup('online', async () => { enter(); await gate; }); await x.seed(); const neighbor = await x.seed();
    const first = x.c.removeDokuEntry(fixture.caseId, 0); let second;
    try { await reached; second = x.c.removeDokuEntry(fixture.caseId, 0); } finally { release(); await first; await second; await x.drain(); }
    assert.equal(x.calls.length, 1); assert.ok(raw().some(row => row.id === neighbor.id));
  });
  await t.test('Dokumentation löschen: Lesebereich wartet auf Bestätigung und überschreibt keine neuere Auswahl', async () => {
    let x;
    x = await setup('online', async (url, options, c) => { c.fdState.sel = 77; return request(url, options); });
    await x.seed(); await x.seed(); x.c.fdState.sel = 0; await x.c.fdLoeschen(0); await x.drain();
    assert.equal(x.c.fdState.sel, 77); assert.ok(!x.ui.includes('selected'));
  });
  await t.test('Dokumentation löschen: geschlossener Serverfall wird ohne Änderung des aktiven oder lokalen Falls gelöscht', async () => {
    const x = await setup(), id = 'sf-doku-ziel'; await x.seed(); const before = raw(), registry = clone(x.c.caseRegistry);
    const response = await request(`/api/cases/${id}/doku-entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { freeDetail: 'Geschlossener Fall' } }) });
    const entry = { id: (await response.json()).id, freeDetail: 'Geschlossener Fall' }; x.c.__onlineCaseCache.get(id).data.documentationEntries.push(entry);
    await x.remove(id); assert.deepEqual(raw(), before); assert.deepEqual(clone(x.c.caseRegistry), registry);
    assert.ok(!(await x.docs(id)).some(e => e.id === entry.id)); assert.equal(x.calls.length, 1);
  });
  await t.test('Dokumentation löschen: geteilte Anlage bleibt nach Entfernung des ganzen Ursprungseintrags erhalten', async () => {
    const x = await setup(), first = await x.seed(), second = await x.seed(), bytes = Buffer.from('%PDF-1.4\nGeteilter synthetischer Inhalt\n%%EOF');
    const response = await request(`/api/cases/${fixture.caseId}/doku-entries/${first.id}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'Geteilt.pdf', mimeType: 'application/pdf', dataBase64: bytes.toString('base64') }) });
    const photo = (await response.json()).photo; first.photos = [photo]; second.photos = [photo];
    await request(`/api/cases/${fixture.caseId}/doku-entries/${second.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: second }) });
    await x.remove(); const downloaded = await request(`/api/cases/${fixture.caseId}/doku-entries/${second.id}/photos/${photo.id}`);
    assert.equal(downloaded.status, 200); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    assert.equal(db.prepare("SELECT count(*) AS n FROM doc_links WHERE module='doku-photo' AND owner_id=?").get(first.id).n, 0);
  });
  await t.test('Dokumentation löschen: neuere lokale Änderung bleibt nach Serverlöschung zur Klärung sichtbar', async () => {
    const x = await setup('online', async (url, options, c) => { const response = await request(url, options); c.state.caseData.documentationEntries[0].freeDetail = 'Noch nicht gespeicherte neue Eingabe'; return response; });
    const entry = await x.seed(); await x.remove(); assert.ok(!raw().some(row => row.id === entry.id));
    assert.equal(x.c.state.caseData.documentationEntries[0].freeDetail, 'Noch nicht gespeicherte neue Eingabe'); assert.ok(x.notices.some(message => message.includes('abgleichen')));
  });
  await t.test('Dokumentation löschen: nach Bestätigung wird der verbleibende Nachbar anhand seiner Identität gewählt', async () => {
    const x = await setup(); await x.seed(); const neighbor = await x.seed(); x.c.fdState.sel = 0;
    await x.c.fdLoeschen(0); assert.equal(x.c.fdState.sel, 0); assert.equal(x.c.state.caseData.documentationEntries[0].id, neighbor.id); assert.ok(x.ui.includes('selected'));
  });
};
