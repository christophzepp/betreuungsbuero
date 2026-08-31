'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(
  path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

function scriptById(id) {
  const match = html.match(new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i'));
  assert(match, `Script #${id} fehlt.`);
  return match[1];
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function storedTimestamp(value, message) {
  if (value === '') return;
  assert.match(
    String(value || ''),
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/,
    message
  );
}

function createRuntime(accommodation = {}) {
  const state = {
    caseData: {
      person: {
        firstName: 'Franz',
        lastName: 'Beispiel',
        street: 'Musterstra\u00dfe',
        house: '12',
        postal: '12345',
        city: 'Musterstadt'
      },
      care: {},
      accommodation: plain(accommodation),
      socialNetwork: [],
      documentationEntries: [],
      benefits: [],
      livelihood: { income: [] },
      budget: {},
      goalDecisionPlanning: { version: 3, records: [], reportSelections: [] }
    },
    reports: { initial: { fields: {}, meta: {} } }
  };
  let saveCount = 0;
  const notifications = [];
  const document = {
    readyState: 'loading',
    documentElement: {},
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    getElementById() { return null; }
  };
  const context = {
    console,
    state,
    document,
    CustomEvent: class CustomEvent {},
    MutationObserver: class MutationObserver { observe() {} },
    requestAnimationFrame() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    SOURCE_LABELS: {},
    SOURCE_TITLES: {},
    currentReport: '',
    norm(value) {
      return String(value == null ? '' : value)
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    },
    clone: plain,
    isEmpty(value) {
      return value == null || value === '' || (Array.isArray(value) && !value.length);
    },
    ensureState() {},
    saveState() { saveCount += 1; },
    renderReport() {},
    closeModal() {},
    toast(message) { notifications.push(String(message)); },
    caseIdentityOf() { return 'housing-entry-test'; },
    setReportValue(reportId, fieldId, value, source, reviewed, _one, cleared) {
      state.reports[reportId].fields[fieldId] = {
        value,
        source,
        reviewed,
        cleared: Boolean(cleared && value === '')
      };
    }
  };
  context.window = context;
  context.window.__activeServerCaseId = 'housing-entry-test';
  context.window.__appState = () => state;
  context.window.addEventListener = () => {};
  vm.createContext(context);
  new vm.Script(scriptById('initial-data-domains-script-v255'), {
    filename: 'initial-data-domains-script-v255.js'
  }).runInContext(context);
  return { context, state, notifications, getSaveCount: () => saveCount };
}

function assertStatusEntry(entry, expected) {
  assert.deepEqual(
    Object.keys(entry).sort(),
    ['createdAt', 'details', 'endDate', 'entryDate', 'id', 'status', 'updatedAt'],
    'Status-Eintr\u00e4ge m\u00fcssen eigenst\u00e4ndige, persistierbare Datens\u00e4tze sein.'
  );
  assert.equal(entry.status, expected.status);
  assert.equal(entry.details, expected.details);
  assert.equal(entry.entryDate, expected.entryDate);
  assert.equal(entry.endDate, expected.endDate);
  assert.ok(String(entry.id || '').trim(), 'Jeder Eintrag ben\u00f6tigt eine stabile ID.');
  storedTimestamp(entry.createdAt, 'createdAt muss als ISO-Datum oder ISO-Zeitstempel gespeichert werden.');
  storedTimestamp(entry.updatedAt, 'updatedAt muss als ISO-Datum oder ISO-Zeitstempel gespeichert werden.');
}

function assertSupportEntry(entry, expected) {
  assert.deepEqual(
    Object.keys(entry).sort(),
    ['createdAt', 'details', 'endDate', 'entryDate', 'forms', 'id', 'status', 'updatedAt'],
    'Unterst\u00fctzungseintr\u00e4ge m\u00fcssen Formen und Details gemeinsam speichern.'
  );
  assert.deepEqual(plain(entry.forms), expected.forms);
  assert.equal(entry.status, expected.status);
  assert.equal(entry.details, expected.details);
  assert.equal(entry.entryDate, expected.entryDate);
  assert.equal(entry.endDate, expected.endDate);
  assert.ok(String(entry.id || '').trim(), 'Jeder Eintrag ben\u00f6tigt eine stabile ID.');
  storedTimestamp(entry.createdAt, 'createdAt muss als ISO-Datum oder ISO-Zeitstempel gespeichert werden.');
  storedTimestamp(entry.updatedAt, 'updatedAt muss als ISO-Datum oder ISO-Zeitstempel gespeichert werden.');
}

test('Wohnen migriert jeden bisherigen Sammeleintrag genau einmal in eine eigene Liste', () => {
  const { context, state } = createRuntime({
    housingSecurity: { status: 'secured', details: 'Unbefristeter Mietvertrag' },
    accessibility: { status: 'partial', details: 'Aufzug bis in das Wohngeschoss' },
    currentProblems: { status: 'present', details: 'Bad ist noch nicht angepasst' },
    supportForms: ['facility', 'nursing'],
    supportDetails: 'Pflege morgens und abends'
  });

  const ac = context.__housingV255.ensureModels(state.caseData).accommodation;
  assert.equal(ac.housingSecurityEntries.length, 1);
  assert.equal(ac.accessibilityEntries.length, 1);
  assert.equal(ac.currentProblemEntries.length, 1);
  assert.equal(ac.supportEntries.length, 1);
  assertStatusEntry(ac.housingSecurityEntries[0], {
    status: 'secured', details: 'Unbefristeter Mietvertrag', entryDate: '', endDate: ''
  });
  assertStatusEntry(ac.accessibilityEntries[0], {
    status: 'partial', details: 'Aufzug bis in das Wohngeschoss', entryDate: '', endDate: ''
  });
  assertStatusEntry(ac.currentProblemEntries[0], {
    status: 'present', details: 'Bad ist noch nicht angepasst', entryDate: '', endDate: ''
  });
  assertSupportEntry(ac.supportEntries[0], {
    forms: ['facility', 'nursing'], status: 'unknown', details: 'Pflege morgens und abends',
    entryDate: '', endDate: ''
  });
  for (const entry of [
    ac.housingSecurityEntries[0], ac.accessibilityEntries[0],
    ac.currentProblemEntries[0], ac.supportEntries[0]
  ]) {
    assert.equal(entry.createdAt, '');
    assert.equal(entry.updatedAt, '');
  }
  assert.equal(new Set([
    ac.housingSecurityEntries[0].id,
    ac.accessibilityEntries[0].id,
    ac.currentProblemEntries[0].id,
    ac.supportEntries[0].id
  ]).size, 4, 'Migrierte Eintr\u00e4ge d\u00fcrfen keine gemeinsame ID verwenden.');

  const migrated = plain({
    housingSecurityEntries: ac.housingSecurityEntries,
    accessibilityEntries: ac.accessibilityEntries,
    currentProblemEntries: ac.currentProblemEntries,
    supportEntries: ac.supportEntries
  });
  context.__housingV255.ensureModels(state.caseData);
  assert.deepEqual(plain({
    housingSecurityEntries: ac.housingSecurityEntries,
    accessibilityEntries: ac.accessibilityEntries,
    currentProblemEntries: ac.currentProblemEntries,
    supportEntries: ac.supportEntries
  }), migrated, 'Wiederholtes Normalisieren darf weder Duplikate noch neue IDs/Zeitstempel erzeugen.');

  ac.currentProblems = { status: 'none', details: 'Veralteter Legacy-Wert' };
  context.__housingV255.ensureModels(state.caseData);
  assert.deepEqual(plain(ac.currentProblemEntries), migrated.currentProblemEntries,
    'Eine vorhandene neue Liste darf nicht erneut aus sp\u00e4ter ver\u00e4nderten Legacy-Feldern aufgebaut werden.');
});

test('Explizit leere neue Listen werden nicht aus veralteten Legacy-Sammelfeldern wiederbef\u00fcllt', () => {
  const { context, state } = createRuntime({
    housingSecurityEntries: [],
    accessibilityEntries: [],
    currentProblemEntries: [],
    supportEntries: [],
    housingSecurity: { status: 'at_risk', details: 'Altwert' },
    accessibility: { status: 'not_accessible', details: 'Altwert' },
    currentProblems: { status: 'present', details: 'Altwert' },
    supportForms: ['family'],
    supportDetails: 'Altwert'
  });

  const ac = context.__housingV255.ensureModels(state.caseData).accommodation;
  for (const key of [
    'housingSecurityEntries', 'accessibilityEntries', 'currentProblemEntries', 'supportEntries'
  ]) {
    assert.deepEqual(plain(ac[key]), [], `${key} muss bewusst leer bleiben.`);
  }
  assert.deepEqual(plain(ac.housingSecurity), { status: '', details: '' });
  assert.deepEqual(plain(ac.accessibility), { status: '', details: '' });
  assert.deepEqual(plain(ac.currentProblems), { status: '', details: '' });
  assert.deepEqual(plain(ac.supportForms), []);
  assert.equal(ac.supportDetails, '');
});

test('CRUD verwaltet die vier Wohnlisten unabh\u00e4ngig und h\u00e4lt die Legacy-Spiegel kompatibel', () => {
  const { context, state } = createRuntime({
    housingSecurityEntries: [], accessibilityEntries: [], currentProblemEntries: [], supportEntries: []
  });
  const model = context.__housingV255;
  assert.equal(typeof model.addEntry, 'function', 'Testbare Model-API addEntry(kind, payload) fehlt.');
  assert.equal(typeof model.updateEntry, 'function', 'Testbare Model-API updateEntry(kind, id, patch) fehlt.');
  assert.equal(typeof model.removeEntry, 'function', 'Testbare Model-API removeEntry(kind, id) fehlt.');

  model.ensureModels(state.caseData);
  const ac = state.caseData.accommodation;
  model.addEntry('security', {
    entryDate: '2026-01-10', endDate: '', status: 'secured', details: 'Vertrag l\u00e4uft unbefristet'
  });
  model.addEntry('security', {
    entryDate: '2026-03-01', endDate: '2026-10-31', status: 'temporary', details: 'Zwischenunterkunft bis Oktober'
  });
  model.addEntry('accessibility', {
    entryDate: '2026-02-12', endDate: '', status: 'partial', details: 'Aufzug, aber zwei Stufen'
  });
  model.addEntry('problems', {
    entryDate: '2026-04-20', endDate: '2026-05-15', status: 'present', details: 'Heizung zeitweise ausgefallen'
  });
  model.addEntry('support', {
    entryDate: '2026-01-01', endDate: '', status: 'active',
    forms: ['family', 'nursing'], details: 'Familie und Pflegedienst'
  });
  model.addEntry('support', {
    entryDate: '2026-06-01', endDate: '2026-12-31', status: 'planned',
    forms: ['nursing', 'ambulatory'], details: 'Ambulant zweimal w\u00f6chentlich'
  });

  assert.equal(ac.housingSecurityEntries.length, 2);
  assert.equal(ac.accessibilityEntries.length, 1);
  assert.equal(ac.currentProblemEntries.length, 1);
  assert.equal(ac.supportEntries.length, 2);
  assertStatusEntry(ac.housingSecurityEntries[0], {
    status: 'secured', details: 'Vertrag l\u00e4uft unbefristet', entryDate: '2026-01-10', endDate: ''
  });
  assertStatusEntry(ac.housingSecurityEntries[1], {
    status: 'temporary', details: 'Zwischenunterkunft bis Oktober', entryDate: '2026-03-01', endDate: '2026-10-31'
  });
  assertSupportEntry(ac.supportEntries[0], {
    forms: ['family', 'nursing'], status: 'active', details: 'Familie und Pflegedienst',
    entryDate: '2026-01-01', endDate: ''
  });
  assert.ok(ac.housingSecurityEntries[0].createdAt && ac.housingSecurityEntries[0].updatedAt,
    'Neue Eintr\u00e4ge m\u00fcssen Auditdaten erhalten.');
  assert.deepEqual(plain(ac.housingSecurity), {
    status: 'temporary', details: 'Zwischenunterkunft bis Oktober'
  }, 'Der letzte Statuseintrag muss den bisherigen Kompatibilit\u00e4tswert spiegeln.');
  assert.deepEqual(plain(ac.supportForms), ['family', 'nursing', 'ambulatory'],
    'Der Support-Spiegel muss die Formen aller Eintr\u00e4ge in stabiler Reihenfolge vereinigen.');
  assert.equal(ac.supportDetails, 'Familie und Pflegedienst\nAmbulant zweimal w\u00f6chentlich',
    'Der Support-Spiegel muss alle nichtleeren Details zeilenweise erhalten.');

  const firstSecurity = plain(ac.housingSecurityEntries[0]);
  const secondSecurity = plain(ac.housingSecurityEntries[1]);
  model.updateEntry('security', firstSecurity.id, {
    status: 'at_risk', details: 'K\u00fcndigung wurde angek\u00fcndigt', endDate: '2026-08-31'
  });
  assert.equal(ac.housingSecurityEntries[0].id, firstSecurity.id);
  assert.equal(ac.housingSecurityEntries[0].createdAt, firstSecurity.createdAt,
    'Bearbeiten muss ID und Erstellzeit erhalten.');
  assert.equal(ac.housingSecurityEntries[0].status, 'at_risk');
  assert.equal(ac.housingSecurityEntries[0].entryDate, '2026-01-10',
    'Ein Teilupdate darf das Eintragsdatum nicht verwerfen.');
  assert.equal(ac.housingSecurityEntries[0].endDate, '2026-08-31');
  assert.deepEqual(plain(ac.housingSecurity), {
    status: 'temporary', details: 'Zwischenunterkunft bis Oktober'
  }, 'Beim Bearbeiten eines fr\u00fcheren Eintrags bleibt der letzte Eintrag der Legacy-Spiegel.');

  model.updateEntry('security', secondSecurity.id, {
    status: 'secured', details: 'Anschlussmietvertrag unterschrieben'
  });
  assert.deepEqual(plain(ac.housingSecurity), {
    status: 'secured', details: 'Anschlussmietvertrag unterschrieben'
  });

  model.removeEntry('security', secondSecurity.id);
  assert.equal(ac.housingSecurityEntries.length, 1);
  assert.deepEqual(plain(ac.housingSecurity), {
    status: 'at_risk', details: 'K\u00fcndigung wurde angek\u00fcndigt'
  });
  model.removeEntry('security', firstSecurity.id);
  assert.deepEqual(plain(ac.housingSecurityEntries), []);
  assert.deepEqual(plain(ac.housingSecurity), { status: '', details: '' },
    'Nach L\u00f6schung des letzten Eintrags muss der bisherige Status explizit geleert werden.');
  assert.equal(ac.accessibilityEntries.length, 1);
  assert.equal(ac.currentProblemEntries.length, 1);
  assert.equal(ac.supportEntries.length, 2,
    'CRUD in einem Bereich darf die Eintr\u00e4ge der drei anderen Bereiche nicht ver\u00e4ndern.');

  const firstSupportId = ac.supportEntries[0].id;
  const secondSupportId = ac.supportEntries[1].id;
  model.removeEntry('support', firstSupportId);
  assert.deepEqual(plain(ac.supportForms), ['nursing', 'ambulatory']);
  assert.equal(ac.supportDetails, 'Ambulant zweimal w\u00f6chentlich');
  model.removeEntry('support', secondSupportId);
  assert.deepEqual(plain(ac.supportEntries), []);
  assert.deepEqual(plain(ac.supportForms), []);
  assert.equal(ac.supportDetails, '');
});

test('JSON-Speicherrundlauf erh\u00e4lt alle individuellen Wohneintr\u00e4ge ohne erneute Migration', () => {
  const first = createRuntime({
    housingSecurityEntries: [], accessibilityEntries: [], currentProblemEntries: [], supportEntries: []
  });
  const model = first.context.__housingV255;
  model.ensureModels(first.state.caseData);
  model.addEntry('security', { entryDate: '2026-01-01', endDate: '', status: 'secured', details: 'Eintrag A' });
  model.addEntry('security', { entryDate: '2026-02-01', endDate: '', status: 'at_risk', details: 'Eintrag B' });
  model.addEntry('accessibility', { entryDate: '2026-03-01', endDate: '', status: 'accessible', details: 'Eintrag C' });
  model.addEntry('problems', { entryDate: '2026-04-01', endDate: '2026-04-30', status: 'none', details: 'Eintrag D' });
  model.addEntry('support', { entryDate: '2026-05-01', endDate: '', status: 'active', forms: ['household'], details: 'Eintrag E' });
  model.addEntry('support', { entryDate: '2026-06-01', endDate: '', status: 'planned', forms: ['social_service'], details: 'Eintrag F' });
  const savedAccommodation = plain(first.state.caseData.accommodation);

  const restored = createRuntime(JSON.parse(JSON.stringify(savedAccommodation)));
  restored.context.__housingV255.ensureModels(restored.state.caseData);
  const restoredAccommodation = plain(restored.state.caseData.accommodation);
  for (const key of [
    'housingSecurityEntries', 'accessibilityEntries', 'currentProblemEntries', 'supportEntries'
  ]) {
    assert.deepEqual(restoredAccommodation[key], savedAccommodation[key],
      `${key} muss IDs, Reihenfolge, Inhalte und Zeitstempel beim Speichern/Laden erhalten.`);
  }
});

test('Editoren aller vier Listen erfassen und validieren Eintragsdatum, Status und optionales Enddatum', () => {
  const { context, state, notifications } = createRuntime({
    housingSecurityEntries: [], accessibilityEntries: [], currentProblemEntries: [], supportEntries: []
  });
  let editorHtml = '';
  const shell = {
    insertAdjacentHTML(_position, markup) { editorHtml = markup; }
  };
  context.document.querySelector = selector => selector === '.housing-shell-v255' ? shell : null;
  context.document.getElementById = () => null;

  for (const kind of ['security', 'accessibility', 'problems', 'support']) {
    editorHtml = '';
    context.__housingOpenEntryV257(kind);
    assert.match(editorHtml, /<label for="hvEntryDateV257">Eintragsdatum<\/label><input id="hvEntryDateV257" type="date"/,
      `${kind}: Das verpflichtende Eintragsdatum fehlt im Editor.`);
    assert.match(editorHtml, /<label for="hvEntryEndDateV257">Enddatum<\/label><input id="hvEntryEndDateV257" type="date"/,
      `${kind}: Das optionale Enddatum fehlt im Editor.`);
    assert.match(editorHtml, /<label for="hvEntryStatusV257">Status<\/label><select id="hvEntryStatusV257">/,
      `${kind}: Der Status muss als eigenes Feld speicherbar sein.`);
  }
  assert.match(editorHtml, /Unterst\u00fctzungsform\(en\)[\s\S]*hvEntrySupportV257/,
    'Beim Support m\u00fcssen Status und Unterst\u00fctzungsformen getrennt erfasst werden.');

  const values = {
    hvEntryDateV257: '',
    hvEntryEndDateV257: '',
    hvEntryStatusV257: 'secured',
    hvEntryDetailsV257: 'Valider Inhalt, aber noch ohne Datum'
  };
  context.document.getElementById = id => id === 'housingEntryOverlayV257'
    ? { dataset: { kind: 'security', entryId: '' }, remove() {} }
    : Object.hasOwn(values, id) ? { value: values[id] } : null;
  context.document.querySelectorAll = () => [];
  context.__housingSaveEntryV257();
  assert.deepEqual(plain(state.caseData.accommodation.housingSecurityEntries), [],
    'Ein neuer Eintrag ohne Eintragsdatum darf nicht gespeichert werden.');
  assert.ok(notifications.some(message => /Eintragsdatum/i.test(message)),
    'Bei fehlendem Eintragsdatum braucht die Oberfl\u00e4che eine verst\u00e4ndliche Meldung.');

  values.hvEntryDateV257 = '2026-08-13';
  values.hvEntryEndDateV257 = '2026-08-12';
  context.__housingSaveEntryV257();
  assert.deepEqual(plain(state.caseData.accommodation.housingSecurityEntries), [],
    'Ein Enddatum vor dem Eintragsdatum darf nicht gespeichert werden.');
  assert.ok(notifications.some(message => /Enddatum/i.test(message)),
    'Bei umgekehrten Datumsgrenzen braucht die Oberfl\u00e4che eine verst\u00e4ndliche Meldung.');
});

test('Anfangsbericht aggregiert jeden Eintrag in Bereichs- und Einf\u00fcgereihenfolge', () => {
  const { context, state } = createRuntime({
    housingSecurityEntries: [
      { id: 'security-1', entryDate: '2026-01-01', endDate: '', status: 'secured', details: 'Vertrag unbefristet', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'security-2', entryDate: '2026-02-01', endDate: '', status: 'at_risk', details: 'K\u00fcndigung angek\u00fcndigt', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' }
    ],
    accessibilityEntries: [
      { id: 'accessibility-1', entryDate: '2026-03-01', endDate: '', status: 'partial', details: 'Aufzug, zwei Stufen am Eingang', createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' }
    ],
    currentProblemEntries: [
      { id: 'problem-1', entryDate: '2026-04-01', endDate: '', status: 'present', details: 'Bad noch nicht angepasst', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z' }
    ],
    supportEntries: [
      { id: 'support-1', entryDate: '2026-05-01', endDate: '', status: 'active', forms: ['family'], details: 'Begleitung zu Terminen', createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z' },
      { id: 'support-2', entryDate: '2026-06-01', endDate: '', status: 'planned', forms: ['nursing', 'ambulatory'], details: 'Versorgung morgens', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' }
    ]
  });

  const expected = [
    'Wohnsicherheit: gesichert \u2013 Vertrag unbefristet',
    'Wohnsicherheit: gef\u00e4hrdet \u2013 K\u00fcndigung angek\u00fcndigt',
    'Barrierefreiheit: teilweise barrierefrei \u2013 Aufzug, zwei Stufen am Eingang',
    'Aktuelle Probleme: aktuelle Probleme vorhanden \u2013 Bad noch nicht angepasst',
    'Unterst\u00fctzungsformen: Angeh\u00f6rige \u2013 Begleitung zu Terminen',
    'Unterst\u00fctzungsformen: Pflegedienst, Ambulante Unterst\u00fctzung \u2013 Versorgung morgens'
  ].join('\n');
  const notes = context.__housingV255.housingNotes(state.caseData);
  assert.equal(notes, expected,
    'Alle separaten Eintr\u00e4ge m\u00fcssen mit den bisherigen fachlichen Statusbezeichnungen in den Bericht eingehen.');

  context.__housingV255.sync({ save: false });
  assert.equal(state.reports.initial.fields.housing_notes.value, expected,
    'Die aggregierten Wohnangaben m\u00fcssen im Feld housing_notes gespeichert werden.');
});

test('Berichtsbef\u00fcllung verwendet nur zeitlich \u00fcberschneidende Eintr\u00e4ge aller vier Bereiche', () => {
  const { context, state } = createRuntime({
    housingSecurityEntries: [
      { id: 'security-before', entryDate: '2025-01-01', endDate: '2026-02-28', status: 'secured', details: 'vor dem Zeitraum', createdAt: '', updatedAt: '' },
      { id: 'security-boundary', entryDate: '2025-01-01', endDate: '2026-03-01', status: 'at_risk', details: 'Ende auf erster Berichtsgrenze', createdAt: '', updatedAt: '' },
      { id: 'security-open', entryDate: '2026-06-01', endDate: '', status: 'temporary', details: 'offenes Ende im Zeitraum', createdAt: '', updatedAt: '' },
      { id: 'security-after', entryDate: '2027-01-01', endDate: '', status: 'unclear', details: 'nach dem Zeitraum', createdAt: '', updatedAt: '' }
    ],
    accessibilityEntries: [
      { id: 'accessibility-undated', entryDate: '', endDate: '', status: 'partial', details: 'Legacy ohne erfundenes Datum', createdAt: '', updatedAt: '' },
      { id: 'accessibility-after', entryDate: '2027-02-01', endDate: '', status: 'not_accessible', details: 'sp\u00e4tere Barriere', createdAt: '', updatedAt: '' }
    ],
    currentProblemEntries: [
      { id: 'problem-boundary', entryDate: '2026-12-31', endDate: '2026-12-31', status: 'present', details: 'Beginn auf letzter Berichtsgrenze', createdAt: '', updatedAt: '' },
      { id: 'problem-before', entryDate: '2024-01-01', endDate: '2025-12-31', status: 'none', details: 'altes Problem', createdAt: '', updatedAt: '' }
    ],
    supportEntries: [
      { id: 'support-overlap', entryDate: '2026-02-15', endDate: '2026-04-15', status: 'ended', forms: ['family'], details: 'ragt in Zeitraum hinein', createdAt: '', updatedAt: '' },
      { id: 'support-after', entryDate: '2027-01-01', endDate: '', status: 'planned', forms: ['nursing'], details: 'erst sp\u00e4ter geplant', createdAt: '', updatedAt: '' }
    ]
  });
  const model = context.__housingV255;
  assert.equal(typeof model.entriesForPeriod, 'function',
    'Testbarer Periodenfilter entriesForPeriod(kind, periodFrom, periodTo, caseData) fehlt.');

  assert.deepEqual(
    plain(model.entriesForPeriod('security', '2026-03-01', '2026-12-31', state.caseData)).map(entry => entry.id),
    ['security-boundary', 'security-open'],
    'Beginn und Ende des Berichtszeitraums m\u00fcssen inklusive sein.'
  );
  assert.deepEqual(
    plain(model.entriesForPeriod('accessibility', '', '', state.caseData)).map(entry => entry.id),
    ['accessibility-undated', 'accessibility-after'],
    'Fehlende Berichtsgrenzen m\u00fcssen als offene Grenzen gelten.'
  );
  assert.deepEqual(
    plain(model.entriesForPeriod('security', 'kein Datum', 'ebenfalls ung\u00fcltig', state.caseData)).map(entry => entry.id),
    ['security-before', 'security-boundary', 'security-open', 'security-after'],
    'Ung\u00fcltige Berichtsgrenzen d\u00fcrfen keine Eintr\u00e4ge versehentlich ausschlie\u00dfen.'
  );
  assert.deepEqual(
    plain(model.entriesForPeriod('security', '31.02.2026', '31.02.2026', state.caseData)).map(entry => entry.id),
    ['security-before', 'security-boundary', 'security-open', 'security-after'],
    'Auch formal passende, aber kalendarisch unm\u00f6gliche Berichtsgrenzen m\u00fcssen offen behandelt werden.'
  );

  state.reports.initial.meta = { periodFrom: '01.03.2026', periodTo: '31.12.2026' };
  const notes = model.housingNotes(state.caseData);
  const expected = [
    'Wohnsicherheit: gef\u00e4hrdet \u2013 Ende auf erster Berichtsgrenze',
    'Wohnsicherheit: vor\u00fcbergehend \u2013 offenes Ende im Zeitraum',
    'Barrierefreiheit: teilweise barrierefrei \u2013 Legacy ohne erfundenes Datum',
    'Aktuelle Probleme: aktuelle Probleme vorhanden \u2013 Beginn auf letzter Berichtsgrenze',
    'Unterst\u00fctzungsformen: Angeh\u00f6rige \u2013 ragt in Zeitraum hinein'
  ].join('\n');
  assert.equal(notes, expected,
    'housingNotes muss deutsche Berichtsgrenzen auswerten und nur \u00fcberschneidende Datens\u00e4tze aggregieren.');
  assert.doesNotMatch(notes, /vor dem Zeitraum|nach dem Zeitraum|sp\u00e4tere Barriere|altes Problem|erst sp\u00e4ter geplant/);

  model.sync({ save: false });
  assert.equal(state.reports.initial.fields.housing_notes.value, expected,
    'Auch die tats\u00e4chliche Dokumentbef\u00fcllung muss den Periodenfilter anwenden.');
});

test('Migrierte aktuelle Probleme behalten die bisherige ausf\u00fchrliche Berichtsbezeichnung', () => {
  const { context, state } = createRuntime({
    currentProblems: { status: 'present', details: 'Schimmel im Schlafzimmer' }
  });
  context.__housingV255.ensureModels(state.caseData);
  assert.equal(
    context.__housingV255.housingNotes(state.caseData),
    'Aktuelle Probleme: aktuelle Probleme vorhanden \u2013 Schimmel im Schlafzimmer'
  );
});
