'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
const clone = x => JSON.parse(JSON.stringify(x));
module.exports = async function inboxRead(t, { client, request, db, setActor, region }) {
  async function setup(mode = 'online', intercept) {
    const x = await client(mode, intercept || (() => null)), c = x.c;
    c.inboxDocs = []; c.inboxCasesCache = []; c.inboxIsLocal = () => c.__appMode !== 'online';
    c.fullName = () => 'Synthetischer Fall'; c.inboxPersist = async () => {}; c.inboxRerenderKeepScroll = async () => x.ui.push('render');
    c.esc = c.escAttr = value => String(value ?? '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    c.inboxFindDoc = id => c.inboxDocs.find(d => d.id === id);
    let helpers = ''; try { helpers = region('const inboxDokuReadBases=', '// Bestehende Einträge laden.'); } catch (_) { /* Before-fix proof. */ }
    vm.runInContext(region('function inboxCaseRecords()', 'function inboxVisibleDocs()')
      + region('function inboxDocIsOpenCase(doc)', '// Aktuelle Aufgabenkreise')
      + region('function inboxLocalTarget(doc)', '// Weg B (Nutzerwunsch):')
      + region('function inboxCanCrossCase(doc)', '\n') + '\n'
      + region('function inboxDokuLocalIdx(id)', 'function inboxGoalDecisionTarget(')
      + helpers + region('async function inboxModListEntries(', '// Felder eines Vorschlags')
      + region('function inboxModFill(', '// Bestehende Einträge in den Vorschlag prefetchen')
      + region('async function inboxPrefetchMod(', '// Einen NICHT-Aktions-Vorschlag'), c);
    x.doc = { id: 'synthetischer-posteingang', caseId: fixture.caseId, caseLabel: 'Synthetischer Fall', receivedDate: '2026-09-25', suggestions: [] };
    c.inboxDocs.push(x.doc); x.s = { kind: 'doku', mode: 'aenderung', accepted: true }; x.doc.suggestions.push(x.s);
    x.list = () => c.inboxModListEntries('doku', x.doc); x.prefetch = () => c.inboxPrefetchMod(x.doc, 0);
    x.pick = async id => { await x.prefetch(); await c.__inboxSugModPick(x.doc.id, 0, id); };
    return x;
  }
  await t.test('Posteingang Dokumentation: echte Serverliste verwendet die Zeilenkennung statt einer Kennung im Datenblob', async () => {
    const x = await setup(), entry = await x.seed();
    const data = { id: 'veraltete-blob-kennung', freeDetail: 'Synthetischer Bestand', unknown: { keep: true } };
    await request(`/api/cases/${fixture.caseId}/doku-entries/${entry.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
    const row = (await x.list()).find(e => e.freeDetail === data.freeDetail); assert.equal(row.id, entry.id); assert.deepEqual(clone(row.unknown), data.unknown);
  });
  await t.test('Posteingang Dokumentation: HTTP- und Formatfehler sind keine leere Liste', async () => {
    for (const reply of [() => Response.json({}, { status: 403 }), () => new Response('<html>Login</html>'), () => Response.json({}), () => Response.json({ entries: [{ id: 'x', data: null }] }), () => Response.json({ entries: [{ id: 'x', data: {} }, { id: 'x', data: {} }] })]) {
      const x = await setup('online', url => url.endsWith('/doku-entries') ? reply() : null); await assert.rejects(x.list());
    }
  });
  await t.test('Posteingang Dokumentation: lokale Liste behält IDs und beschädigte Daten werden nicht geleert', async () => {
    const x = await setup('local'); x.c.state.caseData.documentationEntries = [{ id: 'historisch', note: 'Erhalten' }, { note: 'Ohne Kennung' }];
    assert.deepEqual((await x.list()).map(e => e.id), ['historisch', '#1']);
    for (const value of [{ damaged: true }, [null]]) { x.c.state.caseData.documentationEntries = value; const before = clone(x.c.state); await assert.rejects(x.list()); assert.deepEqual(clone(x.c.state), before); }
  });
  await t.test('Posteingang Dokumentation: geschlossener lokaler Fall wird eindeutig und ohne Zustandsänderung gelesen', async () => {
    const x = await setup('local'); x.doc.caseId = 'sf-doku-ziel'; x.c.caseRegistry[1].state.caseData.documentationEntries = [{ freeDetail: 'Anderer Fall' }];
    const before = clone(x.c.state); assert.equal((await x.list())[0].freeDetail, 'Anderer Fall'); assert.deepEqual(clone(x.c.state), before);
    x.c.caseRegistry.push(clone(x.c.caseRegistry[1])); await assert.rejects(x.list());
  });
  await t.test('Posteingang Dokumentation: Ladefehler bleibt sichtbar und lässt sich ausdrücklich erneut laden', async () => {
    let broken = true; const x = await setup('online', url => broken && url.endsWith('/doku-entries') ? Response.json({}, { status: 503 }) : null);
    await x.prefetch(); const html = x.c.inboxEditBar(x.doc, 0, x.s, ''); assert.match(html, /nicht geladen|Ladefehler/i); assert.doesNotMatch(html, /Keine bestehenden Einträge/);
    broken = false; await x.seed(); await x.c.__inboxRetryDoku(x.doc.id, 0); assert.ok(x.s._modEntries.length); assert.ok(!x.s._modError);
  });
  await t.test('Posteingang Dokumentation: verspätete Liste nach Fallwechsel befüllt keine Auswahl', async () => {
    const x = await setup('online', async (url, options, c) => { if (!url.endsWith('/doku-entries')) return null; const r = await request(url, options); x.doc.caseId = 'sf-doku-ziel'; return r; });
    await x.seed(); await x.prefetch(); assert.equal(x.s._modEntries, undefined); assert.equal(x.s._modLoading, false); assert.equal(x.ui.length, 0);
  });
  await t.test('Posteingang Dokumentation: Moduswechsel während des Ladens verwirft die alte Antwort', async () => {
    const x = await setup('online', async (url, options, c) => { if (!url.endsWith('/doku-entries')) return null; const r = await request(url, options); await c.__inboxSugModMode(x.doc.id, 0, 'neu'); return r; });
    await x.prefetch(); assert.equal(x.s.mode, 'neu'); assert.equal(x.s._modEntries, undefined);
  });
  await t.test('Posteingang Dokumentation: tatsächlicher Rechteentzug ergibt einen lesbaren Fehler', async () => {
    const x = await setup(); await x.seed(); db.prepare('DELETE FROM case_access WHERE case_id=? AND user_id=3').run(fixture.caseId); setActor('reader');
    await x.prefetch(); assert.ok(x.s._modError); assert.deepEqual(clone(x.s._modEntries), []);
  });
  await require('./server-first-inbox-change.cjs')(t, { setup, request, db, setActor, region });
  await require('./server-first-inbox-create.cjs')(t, { setup, request, db, setActor, region });
};
