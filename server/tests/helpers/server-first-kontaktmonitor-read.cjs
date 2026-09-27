'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
const html = fs.readFileSync(path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
function region(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start); return html.slice(a, b);
}
const provider = region('  async function fetchServerCases(', '  /* ECHTER BUG (Nutzerreport:');
const monitor = region('<script id="kontaktmonitor-script-v1">', '</script>').replace('<script id="kontaktmonitor-script-v1">', '');
const clone = value => JSON.parse(JSON.stringify(value));
const sample = () => [{ caseId: fixture.caseId, label: 'Synthetischer Zielfall', caseData: {}, documentationEntries: [
  { id: 'sf-read-contact', occurredAt: '2026-09-22', source: 'kontaktmonitor', detail: 'Hausbesuch', note: 'Synthetische Zielnotiz' }
] }];

module.exports = async function kontaktmonitorRead(t, { prepare, request, raw }) {
  function client({ cases, intercept = () => null } = {}) {
    const notices = [], calls = [], downloads = [], sheets = [];
    const node = () => ({ innerHTML: '', className: '', textContent: '', title: '', classList: { remove() {} } });
    const nodes = { modalTitle: node(), modalBody: node(), kmBody: node(), modal: node(), indicator: node() };
    const context = { __appMode: 'online', __activeServerCaseId: fixture.caseId, __onlineCaseCache: new Map(),
      state: { caseData: { documentationEntries: [] } }, console: { error() {} },
      setTimeout() {}, setInterval() {}, addEventListener() {}, __wieOnline: () => true,
      toast: text => notices.push(text), TextEncoder, Blob,
      URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
      phase4ZipStore: files => { sheets.push(files.map(f => ({ name: f.name, text: new TextDecoder().decode(f.data) }))); return new Uint8Array([1]); },
      document: { getElementById: id => nodes[id] || null,
        querySelectorAll: selector => selector === '[data-kontakt-status]' ? [nodes.indicator] : [],
        createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }), body: { appendChild() {} } },
      fetch: async (url, options = {}) => {
        calls.push({ url, method: options.method || 'GET' });
        return await intercept(url, options) || request(url, options);
      } };
    context.window = context; context.priorityFetch = context.fetch;
    vm.createContext(context);
    new vm.Script(`let serverCases=[],serverCasesFetchedAt=0,serverCasesFetchInFlight=null,cachePreloadInProgress=false;\n${provider}\n${monitor}`)
      .runInContext(context);
    if (cases) context.__dashAllCases = cases;
    return { context, nodes, notices, calls, downloads, sheets };
  }

  await t.test('Kontaktmonitor-Lesen: fehlender angefragter oder aktiver Fall liefert niemals Daten eines anderen Falls', async () => {
    prepare(); const c = client({ cases: async () => sample() });
    assert.equal(await c.context.__kmDocData('sf-fehlt'), null);
    c.context.__activeServerCaseId = '';
    assert.equal(await c.context.__kmDocData(), null);
  });

  await t.test('Kontaktmonitor-Dokumentdaten: Auswahl und Zusammenfassung stammen aus einem einzigen Fallabruf', async () => {
    prepare(); let reads = 0;
    const c = client({ cases: async () => ++reads === 1 ? sample() : [] });
    c.context.__activeServerCaseId = '';
    const result = await c.context.__kmDocData(fixture.caseId);
    assert.equal(reads, 1); assert.equal(result.caseId, fixture.caseId); assert.equal(result.anzahlImZeitraum, 1);
    assert.equal(result.kontakteImZeitraum[0].notiz, 'Synthetische Zielnotiz');
  });

  await t.test('Kontaktmonitor-Snapshot: bekannte Ladefehler werden nicht als leere oder erfolgreiche Auswertung geliefert', async () => {
    for (const source of ['cases', 'office']) {
      prepare(); const before = raw();
      const c = client({ cases: async () => { if (source === 'cases') throw new Error('Synthetischer Fall-Ladefehler'); return sample(); },
        intercept: url => source === 'office' && url === '/api/office-json/kontaktmonitor' ? new Response('', { status: 500 }) : null });
      await assert.rejects(c.context.__kmSnapshot());
      await assert.rejects(c.context.__kmDocData(fixture.caseId));
      assert.equal(raw(), before); assert.ok(c.calls.every(call => call.method === 'GET'));
    }
  });

  await t.test('Kontaktmonitor-Lesen: falsche Listenformen, fehlende Fallkennungen und doppelte Fälle werden abgewiesen', async () => {
    for (const value of [null, {}, [null], [{ caseData: {} }], [...sample(), ...sample()],
      [{ ...sample()[0], documentationEntries: {} }]]) {
      prepare(); const c = client({ cases: async () => value });
      await assert.rejects(c.context.__kmSnapshot(), /Fall|Betreuungsverlauf/);
    }
  });

  await t.test('Kontaktmonitor-Export: fehlender Zielfall oder Ladefehler erstellt keine fremde oder leere Datei', async () => {
    for (const scenario of ['missing', 'no-selection', 'cases', 'office']) {
      prepare(); const c = client({ cases: async () => { if (scenario === 'cases') throw new Error('Synthetischer Fall-Ladefehler'); return sample(); },
        intercept: url => scenario === 'office' && url === '/api/office-json/kontaktmonitor' ? new Response('', { status: 500 }) : null });
      if (scenario === 'missing') c.context.__activeServerCaseId = 'sf-fehlt';
      if (scenario === 'no-selection') c.context.__activeServerCaseId = '';
      await c.context.__kmExport('caseXlsx');
      if (['cases', 'office'].includes(scenario)) await c.context.__kmExport('allXlsx');
      assert.equal(c.downloads.length, 0); assert.equal(c.sheets.length, 0);
      assert.ok(!c.notices.includes('Export erstellt.')); assert.ok(c.notices.length > 0);
    }
  });

  await t.test('Kontaktmonitor-Export: bestätigter Zielfall behält seine Dokumentation und gespeicherten Turnus', async () => {
    prepare(); const c = client({ cases: async () => sample() });
    await c.context.__kmExport('caseXlsx');
    assert.equal(c.downloads.length, 1); assert.match(c.downloads[0], /Synthetischer Zielfall/);
    const sheet = c.sheets[0].find(file => file.name === 'xl/worksheets/sheet1.xml').text;
    assert.match(sheet, /Synthetische Zielnotiz/); assert.match(sheet, /Turnus: 30 Tage/);
    assert.ok(c.notices.includes('Export erstellt.'));
  });

  await t.test('Kontaktmonitor-Anzeige: Ladefehler ist sichtbar und nach erfolgreicher Wiederholung verschwindet er', async () => {
    prepare(); let fail = true;
    const c = client({ cases: async () => { if (fail) throw new Error('Synthetischer Fall-Ladefehler'); return sample(); } });
    await c.context.openKontaktMonitor();
    assert.match(c.nodes.kmBody.innerHTML, /nicht geladen/); assert.doesNotMatch(c.nodes.kmBody.innerHTML, /Keine Fälle vorhanden/);
    await c.context.__kmRefreshCache();
    assert.equal(c.nodes.indicator.textContent, '?'); assert.match(c.nodes.indicator.title, /nicht geladen/);
    fail = false; await c.context.openKontaktMonitor(); await c.context.__kmRefreshCache();
    assert.match(c.nodes.kmBody.innerHTML, /Synthetischer Zielfall/); assert.notEqual(c.nodes.indicator.textContent, '?');
  });

  await t.test('Kontaktmonitor-Fallcache: Fehler der echten Fallliste wird trotz vorhandenem Cache weitergereicht', async () => {
    prepare(); let fail = false;
    const c = client({ intercept: url => fail && url === '/api/cases' ? new Response('', { status: 500 }) : null });
    await c.context.__kmSnapshot(); assert.ok(c.context.__onlineCaseCache.size);
    const before = clone([...c.context.__onlineCaseCache]); fail = true;
    await assert.rejects(c.context.__kmSnapshot(), /Fälle.*nicht geladen/);
    assert.deepEqual(clone([...c.context.__onlineCaseCache]), before);
    fail = false; assert.ok((await c.context.__kmSnapshot()).list.length);
  });

  await t.test('Kontaktmonitor-Mobilansicht: Ladefehler entfernt alte Zeilen und markiert den Status als unbekannt', async () => {
    prepare(); let fail = false; const frames = [], errors = [];
    const c = client({ cases: async () => { if (fail) throw new Error('Synthetischer Fall-Ladefehler'); return sample(); } });
    c.context.__mobileCompletion = { active: () => true, node: (tag, css, text) => ({ text }),
      collection: options => ({ state: { view: { root: { isConnected: true },
        content: { prepend(message) { errors.push(message.text); } } } },
      render() { frames.push(clone(options.records())); } }) };
    await c.context.openKontaktMonitor(); assert.equal(frames.at(-1).length, 1);
    fail = true; await c.context.openKontaktMonitor();
    assert.equal(frames.at(-1).length, 0); assert.match(errors.at(-1), /nicht geladen/);
    assert.equal(c.nodes.indicator.textContent, '?');
    fail = false; await c.context.openKontaktMonitor();
    assert.equal(frames.at(-1).length, 1); assert.notEqual(c.nodes.indicator.textContent, '?');
  });

  await t.test('Kontaktmonitor-Fallcache: ein nicht mehr gelisteter aktiver Fall wird nicht aus dem Arbeitsspeicher ergänzt', async () => {
    prepare(); const c = client(); c.context.__activeServerCaseId = 'sf-nicht-sichtbar';
    c.context.state.caseData.documentationEntries = sample()[0].documentationEntries;
    const snapshot = await c.context.__kmSnapshot();
    assert.ok(snapshot.list.length); assert.ok(snapshot.list.every(row => row.caseId !== 'sf-nicht-sichtbar'));
    assert.equal(await c.context.__kmDocData('sf-nicht-sichtbar'), null);
  });

  await t.test('Kontaktmonitor-Fallcache: abgewiesener oder unvollständiger Fallabruf liefert keine Teilauswertung', async () => {
    for (const response of [() => new Response('', { status: 403 }),
      () => Response.json({ stammdaten: { data: {} }, reports: { reports: [] }, dokuEntries: null, contacts: { contacts: [] } })]) {
      prepare(); const c = client({ intercept: url => url === `/api/cases/${fixture.caseId}/load` ? response() : null });
      await assert.rejects(c.context.__kmSnapshot(), /Fälle.*vollständig/);
      assert.equal(c.context.__onlineCaseCache.has(fixture.caseId), false);
    }
  });

  await t.test('Kontaktmonitor-Fallcache: laufendes Vorladen wird nicht als vollständiger Fallbestand ausgegeben', async () => {
    prepare(); let entered, release;
    const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const c = client({ intercept: async url => { if (url === '/api/cases') { entered(); await gate; } } });
    const preload = c.context.__onlinePreloadCases();
    try { await reached; await assert.rejects(c.context.__kmSnapshot(), /noch geladen/); }
    finally { release(); await preload; }
    assert.ok((await c.context.__kmSnapshot()).list.length);
  });
};
