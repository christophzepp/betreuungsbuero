'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
const clone = x => JSON.parse(JSON.stringify(x));
module.exports = async function inboxCreate(t, { setup, request, db, setActor, region }) {
  const rows = () => db.prepare('SELECT id,data_json FROM case_doku_entries WHERE case_id=? ORDER BY id').all(fixture.caseId);
  async function fresh(kind = 'doku', mode = 'online', intercept) {
    const x = await setup(mode, intercept), c = x.c; x.s.kind = kind; x.s.mode = 'neu'; x.s.freeDetail = x.s.note = 'Synthetischer Posteingangstext';
    c.__kmRefreshCache = () => x.ui.push('km');
    vm.runInContext(region('async function inboxApplyKontakt(', '/* ===== Brücke zur KI-Fallbesprechung'), c);
    x.apply = () => c.inboxApplyByKind(x.doc, x.s); x.one = () => c.__inboxApplyOne(x.doc.id, 0); return x;
  }
  await t.test('Posteingang anlegen: Dokumentation und Kontakt werden mit bestätigter Serverkennung erneut gelesen', async () => {
    for (const kind of ['doku', 'kontakt']) {
      const x = await fresh(kind), before = rows().length; await x.one(); assert.equal(rows().length, before + 1); assert.equal(x.s.applied, true);
      const entry = x.c.state.caseData.documentationEntries[0]; assert.equal(typeof entry.id, 'string'); const saved = JSON.parse(rows().find(r => r.id === entry.id).data_json);
      assert.ok(saved.freeDetail.includes('Synthetischer Posteingangstext')); if (kind === 'kontakt') assert.equal(saved.source, 'kontaktmonitor');
      await x.one(); assert.equal(rows().length, before + 1);
    }
  });
  await t.test('Posteingang anlegen: ungültige Serverkennung oder HTML gilt nicht als übernommener Vorschlag', async () => {
    for (const kind of ['doku', 'kontakt']) for (const response of [() => Response.json({}), () => Response.json({ id: 3 }), () => new Response('<html>Anmelden</html>')]) {
      const x = await fresh(kind, 'online', (_url, opts) => opts.method === 'POST' ? response() : null), before = rows(); await x.one();
      assert.ok(!x.s.applied); assert.deepEqual(rows(), before); assert.equal(x.c.state.caseData.documentationEntries.length, 0); assert.ok(x.notices.some(n => n.includes('Nicht übernommen')));
    }
  });
  await t.test('Posteingang anlegen lokal: aktive und geschlossene Fälle werden getrennt gespeichert', async () => {
    for (const kind of ['doku', 'kontakt']) for (const closed of [false, true]) {
      const x = await fresh(kind, 'local'); if (closed) x.doc.caseId = 'sf-doku-ziel'; await x.apply();
      const slot = [...x.storage].find(([, v]) => Array.isArray(JSON.parse(v)) === closed)[0], saved = JSON.parse(x.storage.get(slot));
      assert.equal((closed ? saved[1].state : saved).caseData.documentationEntries.length, 1); if (closed) assert.equal(x.c.state.caseData.documentationEntries.length, 0);
    }
  });
  await t.test('Posteingang anlegen lokal: Speicherfehler lässt Vorschlag offen und nimmt Änderungen zurück', async () => {
    for (const kind of ['doku', 'kontakt']) for (const closed of [false, true]) {
      const x = await fresh(kind, 'local'); if (closed) x.doc.caseId = 'sf-doku-ziel'; const slot = [...x.storage].find(([, v]) => Array.isArray(JSON.parse(v)) === closed)[0];
      const before = clone(x.c.state), registry = clone(x.c.caseRegistry), stored = [...x.storage]; x.fail(slot); await x.one();
      assert.ok(!x.s.applied); assert.deepEqual(clone(x.c.state), before); assert.deepEqual(clone(x.c.caseRegistry), registry); assert.deepEqual([...x.storage], stored);
      x.fail(null); await x.one(); assert.equal(x.s.applied, true);
    }
  });
  await t.test('Posteingang anlegen: verlorene Commit-Antwort führt beim nächsten Klick zu keinem Doppeleintrag', async () => {
    for (const kind of ['doku', 'kontakt']) {
      const x = await fresh(kind, 'online', async (url, opts) => { if (opts.method !== 'POST') return null; const r = await request(url, opts); assert.equal(r.status, 201); throw Error('Antwort verloren'); });
      const before = rows().length; await x.one(); await x.one(); assert.equal(rows().length, before + 1); assert.ok(!x.s.applied); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1);
    }
  });
  await t.test('Posteingang anlegen: parallele Einzelübernahme schreibt nur einmal', async () => {
    let enter, release; const reached = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
    const x = await fresh('doku', 'online', async (_url, opts) => { if (opts.method === 'POST') { enter(); await gate; } }), before = rows().length, first = x.one(); let second;
    try { await reached; second = x.one(); } finally { release(); await first; await second; }
    assert.equal(rows().length, before + 1); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1);
  });
  await t.test('Posteingang anlegen: beschädigte oder doppelte lokale Ziele werden nicht überschrieben', async () => {
    for (const damaged of [true, false]) {
      const x = await fresh('doku', 'local'); if (damaged) x.c.state.caseData.documentationEntries = { damaged: true }; else x.c.caseRegistry.push(clone(x.c.caseRegistry[0]));
      const before = clone(x.c.state), stored = [...x.storage]; await assert.rejects(x.apply()); assert.deepEqual(clone(x.c.state), before); assert.deepEqual([...x.storage], stored);
    }
  });
  await t.test('Posteingang anlegen: Änderung der Fallzuordnung während der Namensauflösung sendet keinen Schreibauftrag', async () => {
    const x = await fresh('doku', 'online', async (url, opts) => { if (url !== '/api/cases') return null; const r = await request(url, opts); x.doc.caseId = 'sf-doku-ziel'; return r; });
    x.doc.caseId = ''; x.doc.caseLabel = 'Synthetischer Dokumentationsfall'; await assert.rejects(x.apply()); assert.equal(x.calls.filter(c => c.method === 'POST').length, 0);
  });
  await t.test('Posteingang anlegen: frühes Serverecho bleibt erhalten und wird nicht verdoppelt', async () => {
    const x = await fresh('doku', 'online', async (url, opts, c) => { if (opts.method !== 'POST') return null; const r = await request(url, opts), body = await r.clone().json(); c.state.caseData.documentationEntries.push({ id: body.id, freeDetail: 'Neuerer Stand' }); return r; });
    await x.apply(); assert.equal(x.c.state.caseData.documentationEntries.length, 1); assert.equal(x.c.state.caseData.documentationEntries[0].freeDetail, 'Neuerer Stand');
  });
  await t.test('Posteingang anlegen: tatsächlicher Rechteentzug erzeugt keinen Eintrag und keinen Übernahmestatus', async () => {
    const x = await fresh('kontakt'), before = rows(); setActor('reader'); await x.one(); assert.deepEqual(rows(), before); assert.ok(!x.s.applied);
  });
};
