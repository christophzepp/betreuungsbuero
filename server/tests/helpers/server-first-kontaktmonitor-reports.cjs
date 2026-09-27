'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
function region(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a); assert.ok(a >= 0 && b > a, start); return html.slice(a, b);
}
const script = id => region(`<script id="${id}">`, '</script>').replace(`<script id="${id}">`, '');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const state = () => ({ caseData: { care: { startDate: '2026-01-01' }, contactProfile: {}, documentationEntries: [] },
  reports: { initial: { fields: { future_contacts: { value: 'Bisheriger Turnus', source: 'monitor' } }, meta: { periodTo: '2026-09-01' } } } });
const stats = (caseId = 'sf-bericht-a', days = 60) => ({ caseId, ersterKontaktDatum: '2026-02-03', anzahlImZeitraum: 4, turnusTage: days });

module.exports = async function kontaktmonitorReports(t) {
  function client(version) {
    const writes = [], saved = [], renders = [];
    const c = { state: state(), __activeServerCaseId: 'sf-bericht-a', currentReport: 'initial',
      console, SOURCE_LABELS: {}, SOURCE_TITLES: {},
      document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null },
      addEventListener() {}, setTimeout() {}, requestAnimationFrame() {}, ensureState() {},
      norm: value => String(value ?? '').trim().toLowerCase(), clone,
      isEmpty: value => value == null || value === '' || Array.isArray(value) && !value.length,
      saveState: () => saved.push(clone(c.state)), renderReport: () => renders.push('render'),
      requestInitialRenderV254: () => renders.push('render'),
      setReportValue: (reportId, fieldId, value, source, reviewed, one, cleared) => {
        writes.push({ caseId: c.__activeServerCaseId, reportId, fieldId, value });
        c.state.reports[reportId].fields[fieldId] = { value, source, reviewed, cleared: Boolean(cleared && value === '') };
      } };
    c.window = c; c.__appState = () => c.state; c.caseIdentityOf = () => c.__activeServerCaseId;
    c.__kmDocData = async () => stats();
    vm.createContext(c);
    if (version === 255) {
      new vm.Script(script('contact-social-documentation-script-v255')).runInContext(c);
      new vm.Script(script('initial-data-domains-script-v255')).runInContext(c);
      c.__housingV255.ensureModels(c.state.caseData);
    } else {
      const source = `const ID='initial';\n${region('  function initialRealV254(', '  function initialContactLineV254(')}\n`
        + region('  function initialTurnusTextV254(', "  if(typeof window.__kmSetTurnus==='function')");
      new vm.Script(source).runInContext(c);
    }
    const run = () => c[version === 255 ? '__syncInitialContactFieldsV255' : '__syncInitialContactFieldV254']();
    return { c, writes, saved, renders, run };
  }
  function delayed(c) {
    let release; c.__kmDocData = () => new Promise(resolve => { release = resolve; });
    return data => release(data);
  }

  await t.test('Kontaktbericht: verspätete Antwort nach Fallwechsel schreibt weder in den alten noch in den neuen Fall', async () => {
    for (const version of [254, 255]) {
      const x = client(version), old = x.c.state, finish = delayed(x.c), pending = x.run();
      const before = clone(old); x.c.state = state(); x.c.__activeServerCaseId = 'sf-bericht-b'; const next = clone(x.c.state);
      finish(stats()); assert.equal(await pending, false);
      assert.deepEqual(clone(old), before); assert.deepEqual(clone(x.c.state), next);
      assert.equal(x.writes.length, 0); assert.equal(x.saved.length, 0); assert.equal(x.renders.length, 0);
    }
  });

  await t.test('Kontaktbericht: ersetzter Fallzustand oder Bericht unter derselben Kennung erhält keine alte Antwort', async () => {
    for (const version of [254, 255]) for (const target of ['state', 'caseData', 'report', 'id']) {
      const x = client(version), finish = delayed(x.c), pending = x.run();
      if (target === 'state') x.c.state = state();
      if (target === 'caseData') x.c.state.caseData = state().caseData;
      if (target === 'report') x.c.state.reports.initial = state().reports.initial;
      if (target === 'id') x.c.__activeServerCaseId = 'sf-bericht-b';
      const before = clone(x.c.state); finish(stats()); assert.equal(await pending, false, `${version}/${target}`);
      assert.deepEqual(clone(x.c.state), before); assert.equal(x.saved.length, 0); assert.equal(x.writes.length, 0);
    }
  });

  await t.test('Kontaktbericht: geänderter Berichtszeitraum verwirft alte Kontaktzahlen; neue Abfrage übernimmt den aktuellen Zeitraum', async () => {
    const x = client(255), finish = delayed(x.c), pending = x.run();
    x.c.state.reports.initial.meta.periodTo = '2026-12-31'; const before = clone(x.c.state);
    finish(stats()); assert.equal(await pending, false); assert.deepEqual(clone(x.c.state), before); assert.equal(x.saved.length, 0);
    let period; x.c.__kmDocData = async (id, value) => { period = clone(value); return { ...stats(id), anzahlImZeitraum: 9 }; };
    assert.equal(await x.run(), true); assert.equal(period.to, '2026-12-31');
    assert.equal(x.c.state.reports.initial.fields.contact_count.value, 9); assert.equal(x.saved.length, 1);
  });

  await t.test('Kontaktbericht: Antwort eines fremden Falls wird nicht übernommen', async () => {
    for (const version of [254, 255]) {
      const x = client(version), before = clone(x.c.state); x.c.__kmDocData = async () => stats('sf-fremd');
      assert.equal(await x.run(), false); assert.deepEqual(clone(x.c.state), before); assert.equal(x.saved.length, 0);
    }
  });

  await t.test('Kontaktbericht: jüngere Abfrage gewinnt gegen verspätete ältere Antwort', async () => {
    for (const version of [254, 255]) {
      const x = client(version), finish = delayed(x.c), pending = x.run();
      x.c.__kmDocData = async () => stats('sf-bericht-a', 30); assert.equal(await x.run(), true);
      const before = clone(x.c.state); finish(stats()); assert.equal(await pending, false);
      assert.deepEqual(clone(x.c.state), before); assert.equal(x.saved.length, 1);
    }
  });

  await t.test('Kontaktbericht: bestätigte Werte werden übernommen, manuelle und ausdrücklich geleerte Werte bleiben erhalten', async () => {
    for (const version of [254, 255]) {
      const x = client(version); assert.equal(await x.run(), true); assert.equal(x.saved.length, 1);
      assert.match(x.c.state.reports.initial.fields.future_contacts.value, /zwei Monate/);
      for (const entry of [{ value: 'Manuell geprüft', source: 'manual' }, { value: '', source: 'monitor', cleared: true }]) {
        x.c.state.reports.initial.fields.future_contacts = clone(entry); x.c.__kmDocData = async () => stats('sf-bericht-a', 30);
        await x.run(); assert.deepEqual(x.c.state.reports.initial.fields.future_contacts, entry);
      }
    }
  });

  await t.test('Kontaktbericht: Ladefehler überschreibt vorhandene Kontaktzahlen und Turnus nicht', async () => {
    for (const version of [254, 255]) {
      const x = client(version); await x.run(); const fields = clone(x.c.state.reports.initial.fields);
      x.c.__kmDocData = async () => { throw new Error('Synthetischer Ladefehler'); }; await x.run();
      for (const id of ['first_contact', 'contact_count', 'future_contacts']) assert.deepEqual(x.c.state.reports.initial.fields[id], fields[id]);
    }
  });
};
