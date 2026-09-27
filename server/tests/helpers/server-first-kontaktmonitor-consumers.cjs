'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
const html = fs.readFileSync(path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
function script(id) {
  const marker = `<script id="${id}">`, start = html.indexOf(marker), end = html.indexOf('</script>', start);
  assert.ok(start >= 0 && end > start, id); return html.slice(start + marker.length, end);
}
const scripts = ['kontaktmonitor-script-v1', 'dashboard-script-v1', 'case-overview-script-v1'].map(script);
const empty = () => ({ list: [], over: [], soon: [] });

module.exports = async function kontaktmonitorConsumers(t, { prepare, request, raw }) {
  function client({ intercept = () => null, layout = null, mobile = false } = {}) {
    const notices = [], calls = [], downloads = [], pdfTexts = [], local = new Map();
    let pdfBuilds = 0;
    const node = () => ({ innerHTML: '', textContent: '', querySelector: () => null, setAttribute() {},
      classList: { remove() {}, contains: value => mobile && value === 'mobile-online-active' } });
    const nodes = { modalTitle: node(), modalBody: node(), modal: node(), dashBody: node(), overviewCount: node() };
    const context = { __appMode: 'online', __activeServerCaseId: fixture.caseId, __currentUser: { id: 1 },
      state: { caseData: { person: { firstName: 'Synthetisch', lastName: 'Beispiel' },
        documentationEntries: [{ id: 'sf-consumer-doku', date: '2026-09-22', type: 'Unabhängige Dokumentation', freeDetail: 'Synthetischer Bestand' }] } },
      __onlineCaseCache: new Map(), console: { error() {}, log() {} }, TextEncoder, Blob,
      setTimeout() {}, clearTimeout() {}, setInterval() {}, requestAnimationFrame() {}, addEventListener() {},
      toast: text => notices.push(text), __wieOnline: () => true, __casePickerCurrentHint: () => '',
      localStorage: { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value) },
      URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
      document: { readyState: 'loading', documentElement: node(), addEventListener() {},
        getElementById: id => nodes[id] || null,
        querySelectorAll: selector => selector === '[data-case-overview-count]' ? [nodes.overviewCount] : [],
        querySelector: selector => selector === '#modalBody .cov-shell' && nodes.modalBody.innerHTML.includes('cov-shell') ? {} : null,
        createElement: () => ({ style: {}, click() { downloads.push(this.download); }, remove() {} }),
        body: { appendChild() {}, removeChild() {} } },
      fetch: async (url, options = {}) => {
        calls.push({ url, method: options.method || 'GET' });
        const response = await intercept(url, options); if (response) return response;
        if (url === '/api/office-json/kontaktmonitor') return request(url, options);
        if (url === '/api/user-prefs/dashboard') return Response.json({ prefs: layout });
        return Response.json({}); // Other module data are deliberately absent in this consumer fixture.
      } };
    context.window = context;
    context.__appState = () => context.state;
    context.__dashAllCases = async () => [{ caseId: fixture.caseId, label: 'Synthetischer Zielfall',
      caseData: context.state.caseData, documentationEntries: context.state.caseData.documentationEntries }];
    const font = { widthOfTextAtSize: text => text.length * 4 };
    context.PDFLib = { StandardFonts: {}, rgb() {}, PDFDocument: { async create() {
      pdfBuilds++; return { embedFont: async () => font,
        addPage: () => ({ drawText: text => pdfTexts.push(text), drawLine() {}, drawRectangle() {} }),
        save: async () => new Uint8Array([1]) };
    } } };
    vm.createContext(context);
    for (const source of scripts) new vm.Script(source).runInContext(context);
    return { context, nodes, notices, calls, downloads, pdfTexts, builds: () => pdfBuilds };
  }

  await t.test('Kontaktmonitor im Dashboard: HTTP-Ladefehler ergibt unbekannten Status statt Entwarnung', async () => {
    prepare(); const before = raw();
    const c = client({ intercept: url => url === '/api/office-json/kontaktmonitor' ? new Response('', { status: 500 }) : null });
    await c.context.openDashboard();
    assert.match(c.nodes.dashBody.innerHTML, /Kontaktdaten konnten nicht geladen werden/);
    assert.doesNotMatch(c.nodes.dashBody.innerHTML, /alle im Turnus|Keine fälligen oder bald fälligen Kontakte/);
    assert.match(c.nodes.dashBody.innerHTML, /dash-cnum warn">\?/);
    assert.match(c.nodes.dashBody.innerHTML, /Offene Aufgaben/);
    assert.equal(raw(), before); assert.ok(c.calls.every(call => call.method === 'GET'));
  });

  await t.test('Kontaktmonitor im Dashboard: fehlender oder ungültiger Anbieter wird nicht zu null fälligen Kontakten', async () => {
    for (const value of [undefined, null, {}, { list: [], over: {}, soon: [] }]) {
      prepare(); const c = client(); c.context.__kmSnapshot = value === undefined ? undefined : async () => value;
      await c.context.openDashboard();
      assert.match(c.nodes.dashBody.innerHTML, /Kontaktdaten konnten nicht geladen werden/);
      assert.doesNotMatch(c.nodes.dashBody.innerHTML, /alle im Turnus/);
    }
  });

  await t.test('Kontaktmonitor im Dashboard: Fehler entfernt alte Werte; bestätigte Wiederholung unterscheidet Null und Bedarf', async () => {
    prepare(); const c = client();
    c.context.__kmSnapshot = async () => ({ ...empty(), over: [{ caseLabel: 'Synthetischer Kontaktbedarf', _days: -1 }] });
    await c.context.openDashboard(); assert.match(c.nodes.dashBody.innerHTML, /dash-cnum crit">1/);
    c.context.__kmSnapshot = async () => { throw new Error('Synthetischer Ladefehler'); };
    await c.context.__dashReload(); assert.doesNotMatch(c.nodes.dashBody.innerHTML, /Synthetischer Kontaktbedarf/);
    assert.match(c.nodes.dashBody.innerHTML, /Kontaktdaten konnten nicht geladen werden/);
    c.context.__kmSnapshot = async () => empty(); await c.context.__dashReload();
    assert.match(c.nodes.dashBody.innerHTML, /alle im Turnus/); assert.doesNotMatch(c.nodes.dashBody.innerHTML, /Kontaktdaten konnten nicht geladen werden/);
  });

  await t.test('Kontaktmonitor im Dashboard: abgewähltes Widget löst keinen Kontaktabruf aus', async () => {
    prepare(); const c = client({ layout: { version: 1, columns: 1, cards: [{ id: 'tasks.open' }], panels: [] } });
    let reads = 0; c.context.__kmSnapshot = async () => { reads++; throw new Error('Nicht angefordert'); };
    await c.context.openDashboard(); assert.equal(reads, 0);
    assert.doesNotMatch(c.nodes.dashBody.innerHTML, /Kontaktdaten konnten nicht geladen werden/);
  });

  await t.test('Kontaktmonitor in der Fallübersicht: Fehler entfernt alte Kontaktzeilen, erhält übrige Daten und sperrt den PDF-Export', async () => {
    for (const mobile of [false, true]) {
      prepare(); let fail = false;
      const c = client({ mobile, intercept: url => fail && url === '/api/office-json/kontaktmonitor' ? new Response('', { status: 500 }) : null });
      await c.context.__caseOverview.refresh(); c.context.__caseOverview.expandAll();
      assert.match(c.nodes.modalBody.innerHTML, /Kontaktmonitor -/);
      fail = true; await c.context.__caseOverview.refresh();
      assert.match(c.nodes.modalBody.innerHTML, /Kontaktdaten konnten nicht geladen werden/);
      assert.doesNotMatch(c.nodes.modalBody.innerHTML, /Kontaktmonitor -/);
      assert.match(c.nodes.modalBody.innerHTML, /Unabhängige Dokumentation/);
      assert.equal(c.nodes.overviewCount.textContent, '?'); assert.match(c.nodes.overviewCount.title, /nicht geladen/);
      await c.context.__caseOverview.exportOverview(); assert.equal(c.builds(), 0); assert.equal(c.downloads.length, 0);
      fail = false; await c.context.__caseOverview.refresh();
      assert.doesNotMatch(c.nodes.modalBody.innerHTML, /Kontaktdaten konnten nicht geladen werden/);
      assert.notEqual(c.nodes.overviewCount.textContent, '?');
      await c.context.__caseOverview.exportOverview(); assert.equal(c.builds(), 1); assert.equal(c.downloads.length, 1);
      assert.ok(c.pdfTexts.some(text => text.includes('Kontaktmonitor')));
    }
  });

  await t.test('Kontaktmonitor in der Fallübersicht: fehlende oder ungültige Antwort verhindert einen scheinbar vollständigen Export', async () => {
    for (const value of [undefined, null, {}, { list: {} }]) {
      prepare(); const c = client(); c.context.__kmSnapshot = value === undefined ? undefined : async () => value;
      await c.context.__caseOverview.refresh(); await c.context.__caseOverview.exportOverview();
      assert.equal(c.builds(), 0); assert.match(c.notices.at(-1), /Kontaktdaten konnten nicht geladen werden/);
    }
  });

  await t.test('Fallübersicht: laufendes Nachladen verhindert den Export eines Zwischenstands', async () => {
    prepare(); const c = client(); let entered, release;
    const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    c.context.__kmSnapshot = async () => { entered(); await gate; return empty(); };
    const refresh = c.context.__caseOverview.refresh();
    try { await reached; await c.context.__caseOverview.exportOverview(); assert.equal(c.builds(), 0); assert.match(c.notices.at(-1), /geladen/); }
    finally { release(); await refresh; }
    await c.context.__caseOverview.exportOverview(); assert.equal(c.downloads.length, 1);
  });

  await t.test('Fallübersicht: ausdrücklich ausgeblendete Kontakte blockieren den Export der übrigen Daten nicht', async () => {
    prepare(); const c = client(); c.context.__kmSnapshot = async () => { throw new Error('Synthetischer Ladefehler'); };
    await c.context.__caseOverview.refresh(); c.context.__caseOverview.toggleType('contacts');
    await c.context.__caseOverview.exportOverview();
    assert.equal(c.downloads.length, 1); assert.ok(c.pdfTexts.some(text => text.includes('Unabhängige Dokumentation')));
    assert.ok(!c.pdfTexts.some(text => text.includes('Kontaktmonitor -')));
  });
};
