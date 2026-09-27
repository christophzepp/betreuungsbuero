'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
function region(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start); return html.slice(a, b);
}
const script = id => region(`<script id="${id}">`, '</script>').replace(`<script id="${id}">`, '');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const stats = (caseId = 'sf-gesamt-a', days = 60) => ({ caseId, ersterKontaktDatum: '2026-02-03', anzahlImZeitraum: 4, turnusTage: days });
function state(id = 'sf-gesamt-a') {
  return { ui: { localCaseId: id }, unknown: { keep: null }, caseData: {
    person: { street: 'Testweg', house: '12', postal: '12345', city: 'Musterort' },
    care: { startDate: '2026-01-01' }, contactProfile: { canInitiateContact: 'ja' },
    documentationEntries: [], benefits: [{ type: 'Pflegegeld', status: 'bewilligt' }],
    socialNetwork: [{ firstName: 'Synthetische', lastName: 'Schwester', contactClass: 'family', reportRelevant: true, reportNotes: 'Hilft beim Einkauf' }],
    goalDecisionPlanning: { functionalProfile: { dailyLife: { summary: 'Synthetischer Tagesablauf' } } }
  }, reports: { initial: { fields: { future_contacts: { value: 'Bisheriger Turnus', source: 'monitor', unknown: 'erhalten' } }, meta: { periodTo: '2026-09-01' } } } };
}

module.exports = async function reportSync(t) {
  function client() {
    const storage = new Map(), saves = [], touches = [], renders = [];
    const c = { state: state(), __appMode: 'local', currentReport: 'initial', console, SOURCE_LABELS: {}, SOURCE_TITLES: {},
      document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null },
      addEventListener() {}, setTimeout() {}, requestAnimationFrame() {}, ensureState() {}, updateNavStatus() {},
      norm: value => String(value ?? '').trim().toLowerCase(), clone,
      isEmpty: value => value == null || value === '' || Array.isArray(value) && !value.length,
      localStorage: { getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key),
        setItem: (key, value) => { storage.set(key, value); saves.push(JSON.parse(value)); } },
      renderReport: () => renders.push(clone(c.state.reports.initial.fields)),
      __reportSyncTouch: reportId => touches.push({ caseId: c.state.ui.localCaseId, reportId }) };
    c.window = c; c.__appState = () => c.state; c.caseIdentityOf = value => value.ui.localCaseId;
    c.__kmDocData = async () => stats(); vm.createContext(c);
    const core = region('const STORAGE_KEY=', '\n') + '\n'
      + region('function stateForBrowserStorage()', 'function loadState()')
      + region('function loadState()', '\n') + '\n' + region('function setReportValue(', '\nfunction ');
    new vm.Script(core).runInContext(c);
    for (const id of ['contact-social-documentation-script-v255', 'initial-data-domains-script-v255', 'functional-planning-profile-script-v255']) {
      new vm.Script(script(id)).runInContext(c);
    }
    c.__housingV255.ensureModels(c.state.caseData);
    const run = options => c.__syncInitialDataDomainsV255(options);
    const reload = () => { c.state = c.loadState(); return clone(c.state); };
    return { c, saves, touches, renders, run, reload };
  }
  function delayed(c) {
    let release; c.__kmDocData = () => new Promise(resolve => { release = resolve; });
    return data => release(data);
  }

  await t.test('Berichtsableitung: während des Kontaktabrufs bleiben Felder, Speicher und Synchronisationsmeldungen unverändert', async () => {
    const x = client(), before = clone(x.c.state.reports), finish = delayed(x.c), pending = x.run();
    const waiting = { reports: clone(x.c.state.reports), saves: x.saves.length, touches: x.touches.length, renders: x.renders.length };
    finish(stats()); await pending;
    assert.deepEqual(waiting, { reports: before, saves: 0, touches: 0, renders: 0 });
  });

  await t.test('Berichtsableitung: Fallwechsel während des Ladens verändert und speichert keinen der beiden Fälle', async () => {
    const x = client(), old = x.c.state, before = clone(old), finish = delayed(x.c), pending = x.run();
    x.c.state = state('sf-gesamt-b'); const next = clone(x.c.state);
    finish(stats()); assert.equal(await pending, false);
    assert.deepEqual(clone(old), before); assert.deepEqual(clone(x.c.state), next);
    assert.equal(x.saves.length, 0); assert.equal(x.touches.length, 0); assert.equal(x.renders.length, 0);
  });

  await t.test('Berichtsableitung: gleicher Fall mit ersetztem Zustand, Stammdaten oder Bericht verwirft den laufenden Auftrag', async () => {
    for (const part of ['state', 'caseData', 'report', 'id']) {
      const x = client(), oldReport = x.c.state.reports.initial, before = clone(oldReport), finish = delayed(x.c), pending = x.run();
      if (part === 'state') x.c.state = state();
      if (part === 'caseData') x.c.state.caseData = state().caseData;
      if (part === 'report') x.c.state.reports.initial = state().reports.initial;
      if (part === 'id') x.c.state.ui.localCaseId = 'sf-gesamt-b';
      const next = clone(x.c.state); finish(stats()); assert.equal(await pending, false, part);
      assert.deepEqual(clone(oldReport), before, part); assert.deepEqual(clone(x.c.state), next, part);
      assert.equal(x.saves.length, 0); assert.equal(x.touches.length, 0); assert.equal(x.renders.length, 0);
    }
  });

  await t.test('Berichtsableitung: geänderter Zeitraum verhindert Speichern; neuer Auftrag verwendet den neuen Zeitraum', async () => {
    for (const boundary of ['from', 'to']) {
      const x = client(), before = clone(x.c.state.reports.initial.fields), finish = delayed(x.c), pending = x.run();
      if (boundary === 'from') x.c.state.caseData.care.startDate = '2026-03-01';
      else x.c.state.reports.initial.meta.periodTo = '2026-12-31';
      finish(stats()); assert.equal(await pending, false); assert.deepEqual(clone(x.c.state.reports.initial.fields), before);
      assert.equal(x.saves.length, 0); assert.equal(x.touches.length, 0);
      let period; x.c.__kmDocData = async (id, value) => { period = clone(value); return stats(id); };
      assert.equal(await x.run(), true); assert.equal(period[boundary], boundary === 'from' ? '2026-03-01' : '2026-12-31');
      assert.equal(x.saves.length, 1);
    }
  });

  await t.test('Berichtsableitung: jüngerer Gesamtauftrag gewinnt ohne zusätzliche Speicherung oder Anzeige durch die ältere Antwort', async () => {
    const x = client(), finish = delayed(x.c), pending = x.run();
    x.c.__kmDocData = async () => stats('sf-gesamt-a', 30); assert.equal(await x.run(), true);
    const before = clone(x.c.state); finish(stats()); assert.equal(await pending, false);
    assert.deepEqual(clone(x.c.state), before); assert.equal(x.saves.length, 1); assert.equal(x.renders.length, 1);
    assert.equal(x.reload().reports.initial.fields.future_contacts.value, 'monatlich');
  });

  await t.test('Berichtsableitung: alle Fachwerte werden einmal gemeinsam gespeichert und nach Neuladen wiederhergestellt', async () => {
    const x = client(); assert.equal(await x.run(), true);
    assert.equal(x.saves.length, 1); assert.equal(x.renders.length, 1);
    assert.ok(x.touches.length > 0); assert.ok(x.touches.every(item => item.caseId === 'sf-gesamt-a' && item.reportId === 'initial'));
    const restored = x.reload(), fields = restored.reports.initial.fields;
    assert.equal(restored.ui.localCaseId, 'sf-gesamt-a'); assert.deepEqual(restored.unknown, { keep: null });
    assert.match(fields.registered_address.value, /Testweg/); assert.match(fields.relatives.value, /Synthetische Schwester/);
    assert.equal(fields.care_allowance.value, 'bewilligt'); assert.equal(fields.daily_life.value, 'Synthetischer Tagesablauf');
    assert.equal(fields.contact_count.value, 4); assert.equal(fields.future_contacts.value, 'alle zwei Monate');
    assert.equal(fields.future_contacts.unknown, 'erhalten'); assert.deepEqual(x.renders[0], fields);
  });

  await t.test('Berichtsableitung: manuell gepflegte und ausdrücklich geleerte Felder überstehen die gemeinsame Speicherung', async () => {
    const x = client(), manual = { value: 'Geprüfter Wohnort', source: 'manual' }, cleared = { value: '', source: 'manual', cleared: true };
    x.c.state.reports.initial.fields.registered_address = clone(manual);
    x.c.state.reports.initial.fields.future_contacts = clone(cleared);
    assert.equal(await x.run(), true); const fields = x.reload().reports.initial.fields;
    assert.deepEqual(fields.registered_address, manual); assert.deepEqual(fields.future_contacts, cleared);
    assert.equal(fields.contact_count.value, 4);
  });

  await t.test('Berichtsableitung: save:false und render:false lassen die Speicherung und Anzeige beim Aufrufer', async () => {
    const x = client(); assert.equal(await x.run({ save: false, render: false }), true);
    assert.equal(x.c.state.reports.initial.fields.contact_count.value, 4);
    assert.equal(x.saves.length, 0); assert.equal(x.renders.length, 0); assert.equal(x.c.loadState(), null);
  });

  await t.test('Berichtsableitung: reine Wohnänderung wird auch ohne neue Kontaktwerte gespeichert und angezeigt', async () => {
    const x = client(); await x.run(); x.saves.length = 0; x.renders.length = 0;
    x.c.state.caseData.person.street = 'Neuer Testweg'; assert.equal(await x.run(), true);
    assert.equal(x.saves.length, 1); assert.equal(x.renders.length, 1);
    assert.match(x.renders[0].registered_address.value, /Neuer Testweg/);
    assert.deepEqual(x.reload().reports.initial.fields, x.renders[0]);
  });

  await t.test('Berichtsableitung: fehlende Kontaktantwort erhält Monitorwerte und speichert verfügbare Fachwerte im geprüften Fall', async () => {
    const x = client(); await x.run(); const previous = clone(x.c.state.reports.initial.fields);
    x.c.state.caseData.person.street = 'Testweg bei Ladefehler';
    x.c.__kmDocData = async () => { throw new Error('Synthetischer Ladefehler'); };
    assert.equal(await x.run(), true); const fields = x.reload().reports.initial.fields;
    for (const id of ['first_contact', 'contact_count', 'future_contacts']) assert.deepEqual(fields[id], previous[id]);
    assert.match(fields.registered_address.value, /Testweg bei Ladefehler/);
  });
};
