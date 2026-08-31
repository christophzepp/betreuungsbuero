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

function field(value, source = 'manual') {
  return { value, source, reviewed: true };
}

function periodMeta() {
  return { periodFrom: '01.03.2026', periodTo: '28.02.2027' };
}

function report(fields = {}) {
  return { fields: plain(fields), meta: periodMeta() };
}

function reports(overrides = {}) {
  const result = {
    initial: report(),
    annual_assets: report(),
    annual_noassets: report(),
    accounting: report(),
    closing: report()
  };
  for (const [id, value] of Object.entries(overrides)) result[id] = report(value);
  return result;
}

function statusEntry(id, entryDate, endDate, status, details) {
  return { id, entryDate, endDate, status, details, createdAt: '', updatedAt: '' };
}

function supportEntry(id, entryDate, endDate, status, forms, details) {
  return { id, entryDate, endDate, status, forms, details, createdAt: '', updatedAt: '' };
}

function accommodation(overrides = {}) {
  return {
    currentResidence: {
      sameAsRegistered: false,
      type: 'geschlossene Pflegeeinrichtung',
      institution: 'Haus Sonnengarten',
      street: 'Parkweg',
      houseNumber: '7',
      houseLetter: 'a',
      postalCode: '54321',
      city: 'Beispielstadt',
      postbox: '',
      foreignCity: '',
      country: 'Deutschland'
    },
    housingSecurityEntries: [],
    accessibilityEntries: [],
    currentProblemEntries: [],
    supportEntries: [],
    ...plain(overrides)
  };
}

function createRuntime({ accommodationData = accommodation(), reportData = reports() } = {}) {
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
      accommodation: plain(accommodationData),
      socialNetwork: [],
      documentationEntries: [],
      benefits: [],
      livelihood: { income: [] },
      budget: {},
      goalDecisionPlanning: { version: 3, records: [], reportSelections: [] }
    },
    reports: plain(reportData)
  };
  let saveCount = 0;
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
    toast() {},
    caseIdentityOf() { return 'housing-report-period-test'; },
    setReportValue(reportId, fieldId, value, source, reviewed, _rerender, cleared) {
      const previous = state.reports[reportId].fields[fieldId] || {};
      state.reports[reportId].fields[fieldId] = {
        ...previous,
        value: plain(value),
        source,
        reviewed,
        cleared: Boolean(cleared && (value === '' || (Array.isArray(value) && value.length === 0)))
      };
    }
  };
  context.window = context;
  context.window.__activeServerCaseId = 'housing-report-period-test';
  context.window.__appState = () => state;
  context.window.addEventListener = () => {};
  vm.createContext(context);
  new vm.Script(scriptById('initial-data-domains-script-v255'), {
    filename: 'initial-data-domains-script-v255.js'
  }).runInContext(context);
  return { context, state, getSaveCount: () => saveCount };
}

function occurrenceCount(value, needle) {
  return String(value).split(needle).length - 1;
}

test('Zeitraum-Zusammenfassung übernimmt alle vier Wohnlisten und beide Grenzen einschließlich', () => {
  const accommodationData = accommodation({
    housingSecurityEntries: [
      statusEntry('sec-before', '2025-01-01', '2026-02-28', 'secured', 'Vor Zeitraum'),
      statusEntry('sec-left', '2025-01-01', '2026-03-01', 'at_risk', 'Endet exakt an linker Grenze'),
      statusEntry('sec-long', '2025-01-01', '2028-01-01', 'secured', 'L\u00e4uft durch den ganzen Zeitraum'),
      statusEntry('sec-right', '2027-02-28', '', 'temporary', 'Beginnt exakt an rechter Grenze'),
      statusEntry('sec-after', '2027-03-01', '', 'at_risk', 'Nach Zeitraum'),
      statusEntry('sec-undated', '', '', 'secured', 'Ohne Datum')
    ],
    accessibilityEntries: [
      statusEntry('access-mid', '2026-04-05', '', 'partial', 'Aufzug mit einer Stufe')
    ],
    currentProblemEntries: [
      statusEntry('problem-mid', '2026-05-10', '2026-08-30', 'present', 'Heizung ausgefallen')
    ],
    supportEntries: [
      supportEntry('support-family', '2026-03-01', '', 'active', ['family'], 'W\u00f6chentliche Hilfe'),
      supportEntry('support-nursing', '2026-07-01', '2027-02-28', 'active', ['nursing'], 'Morgens und abends'),
      supportEntry('support-planned', '2026-10-01', '', 'planned', ['facility'], 'Einzug geplant')
    ]
  });
  const { context, state } = createRuntime({ accommodationData });
  const api = context.__housingReportSyncV259;
  const summary = api.summaryForPeriod(
    'annual_noassets',
    state.caseData,
    state.reports.annual_noassets
  );

  for (const expected of [
    'Endet exakt an linker Grenze',
    'L\u00e4uft durch den ganzen Zeitraum',
    'Beginnt exakt an rechter Grenze',
    'Aufzug mit einer Stufe',
    'Heizung ausgefallen',
    'W\u00f6chentliche Hilfe',
    'Morgens und abends',
    'Einzug geplant'
  ]) assert.match(summary, new RegExp(expected));
  for (const excluded of ['Vor Zeitraum', 'Nach Zeitraum', 'Ohne Datum']) {
    assert.doesNotMatch(summary, new RegExp(excluded));
  }
  assert.equal(occurrenceCount(summary, 'Wohnsicherheit ('), 3,
    'Alle drei im Zeitraum liegenden Eintr\u00e4ge derselben Kategorie m\u00fcssen erscheinen.');
  assert.match(summary, /bis 01\.03\.2026/);
  assert.match(summary, /ab 28\.02\.2027/);
  assert.match(summary, /Barrierefreiheit/);
  assert.match(summary, /Aktuelle Probleme/);
  assert.match(summary, /Unterst\u00fctzungsformen/);
});

test('Jahresberichte erhalten Wohnstatus, Pflegedienste und alle Zeitraumdaten; manuelle Werte bleiben geschützt', () => {
  const accommodationData = accommodation({
    housingSecurityEntries: [
      statusEntry('sec-a', '2026-03-01', '2026-06-30', 'temporary', 'Erste Zwischenunterkunft'),
      statusEntry('sec-b', '2026-07-01', '', 'secured', 'Dauerhafte Wohnung')
    ],
    accessibilityEntries: [statusEntry('acc-a', '2026-04-01', '', 'accessible', 'Barrierefrei')],
    currentProblemEntries: [statusEntry('prob-a', '2026-08-01', '', 'none', 'Keine offenen Probleme')],
    supportEntries: [
      supportEntry('sup-family', '2026-03-01', '', 'active', ['family'], 'Familienhilfe'),
      supportEntry('sup-nursing', '2026-05-01', '', 'active', ['nursing'], 'Pflegedienst'),
      supportEntry('sup-assist', '2026-06-01', '', 'active', ['assistance'], 'Assistenz'),
      supportEntry('sup-planned', '2026-07-01', '', 'planned', ['facility'], 'Noch nicht begonnen')
    ]
  });
  const reportData = reports({
    annual_assets: {
      residence: field('Manuell gesetzter Aufenthalt'),
      home_placement: field('nein'),
      closed_unit: field('nein'),
      care_providers: field(['Betreuer/in']),
      other_report: field('Manueller Jahresberichtstext')
    },
    annual_noassets: {
      care_providers: field(['Betreuer/in']),
      other_report: field('Manueller Grundtext ohne Verm\u00f6gen')
    }
  });
  const { context, state } = createRuntime({ accommodationData, reportData });

  const manualResult = context.__syncHousingReportsV259('annual_assets', { save: false });
  assert.equal(manualResult.supported, true);
  assert.equal(state.reports.annual_assets.fields.residence.value, 'Manuell gesetzter Aufenthalt');
  assert.equal(state.reports.annual_assets.fields.home_placement.value, 'nein');
  assert.equal(state.reports.annual_assets.fields.closed_unit.value, 'nein');

  const automaticResult = context.__syncHousingReportsV259('annual_noassets', { save: false });
  assert.equal(automaticResult.supported, true);
  assert.match(state.reports.annual_noassets.fields.residence.value,
    /Haus Sonnengarten, Parkweg 7a, 54321 Beispielstadt, Deutschland/);
  assert.equal(state.reports.annual_noassets.fields.home_placement.value, 'ja');
  assert.equal(state.reports.annual_noassets.fields.closed_unit.value, 'ja');
  assert.deepEqual(plain(state.reports.annual_noassets.fields.care_providers.value), [
    'Betreuer/in', 'Angeh\u00f6rige', 'ambulante Pflegedienste', 'sonstige'
  ]);
  assert.doesNotMatch(state.reports.annual_noassets.fields.care_providers.value.join('|'), /Personal des Heims/,
    'Nur geplante Unterst\u00fctzung darf noch nicht als tätiger Leistungserbringer erscheinen.');

  const other = state.reports.annual_noassets.fields.other_report.value;
  assert.match(other, /^Manueller Grundtext ohne Verm\u00f6gen\n\nWohnsituation im Berichtszeitraum:/);
  for (const expected of [
    'Erste Zwischenunterkunft', 'Dauerhafte Wohnung', 'Barrierefrei',
    'Keine offenen Probleme', 'Familienhilfe', 'Pflegedienst', 'Assistenz', 'Noch nicht begonnen'
  ]) assert.match(other, new RegExp(expected));

  state.caseData.accommodation.currentResidence = {
    ...state.caseData.accommodation.currentResidence,
    type: 'eigene Wohnung', institution: '', street: 'Neue Straße', houseNumber: '99'
  };
  context.__syncHousingReportsV259('annual_noassets', { save: false });
  assert.match(state.reports.annual_noassets.fields.residence.value, /Haus Sonnengarten/,
    'Der an den Periodenendstand gebundene Jahresstatus darf nach einem späteren Umzug nicht driften.');
  assert.equal(state.reports.annual_noassets.fields.home_placement.value, 'ja');
  assert.equal(state.reports.annual_noassets.fields.closed_unit.value, 'ja');
});

test('Unvollständige Zeiträume bleiben unbefüllt und Pflegedienste bilden den Periodenendstand ab', () => {
  const accommodationData = accommodation({
    supportEntries: [
      supportEntry('ended', '2026-03-01', '2026-08-31', 'ended', ['nursing'], 'Im Zeitraum beendet'),
      supportEntry('active-end', '2026-09-01', '', 'active', ['family'], 'Am Periodenende aktiv'),
      supportEntry('future', '2027-03-01', '', 'active', ['facility'], 'Erst später aktiv')
    ]
  });
  const reportData = reports({ annual_noassets: { care_providers: field('Betreuer/in', 'master') } });
  const { context, state } = createRuntime({ accommodationData, reportData });

  context.__syncHousingReportsV259('annual_noassets', { save: false });
  assert.deepEqual(plain(state.reports.annual_noassets.fields.care_providers.value), [
    'Betreuer/in', 'Angehörige'
  ]);
  assert.doesNotMatch(state.reports.annual_noassets.fields.care_providers.value.join('|'), /Pflegedienste|Personal des Heims/);
  assert.match(state.reports.annual_noassets.fields.other_report.value, /Im Zeitraum beendet/,
    'Beendete Hilfe bleibt als Verlaufstatsache im narrativen Abschnitt erhalten.');

  state.reports.annual_noassets.meta.periodTo = '';
  assert.equal(context.__housingReportSyncV259.period('annual_noassets').valid, false);
  assert.equal(context.__housingReportSyncV259.summaryForPeriod('annual_noassets'), '');
});

test('Verwaltete Wohnblöcke in Jahresbericht und Rechnungslegung sind idempotent und schützen manuelle Nachbearbeitung', () => {
  const accommodationData = accommodation({
    housingSecurityEntries: [
      statusEntry('sec-a', '2026-04-01', '', 'secured', 'Ausgangslage')
    ]
  });
  const reportData = reports({
    annual_assets: { other_report: field('Manueller Jahres-Grundtext') },
    accounting: { personal_circumstances: field('Manueller Grundtext zur Rechnungslegung') }
  });
  const { context, state } = createRuntime({ accommodationData, reportData });

  for (const [reportId, fieldId, base] of [
    ['annual_assets', 'other_report', 'Manueller Jahres-Grundtext'],
    ['accounting', 'personal_circumstances', 'Manueller Grundtext zur Rechnungslegung']
  ]) {
    const first = context.__housingReportSyncV259.sync(reportId, { save: false });
    assert.equal(first.changed, true);
    assert.ok(first.fields.includes(fieldId));
    const firstValue = state.reports[reportId].fields[fieldId].value;
    assert.match(firstValue, new RegExp(`^${base}\\n\\nWohnsituation im Berichtszeitraum:`));
    assert.equal(occurrenceCount(firstValue, 'Wohnsituation im Berichtszeitraum:'), 1);

    const second = context.__housingReportSyncV259.sync(reportId, { save: false });
    assert.equal(second.changed, false, 'Unveränderte erneute Synchronisation muss idempotent sein.');
    assert.equal(state.reports[reportId].fields[fieldId].value, firstValue);

    state.caseData.accommodation.housingSecurityEntries[0].details = 'Aktualisierte Ausgangslage';
    context.__housingReportSyncV259.sync(reportId, { save: false });
    const updatedValue = state.reports[reportId].fields[fieldId].value;
    assert.match(updatedValue, /Aktualisierte Ausgangslage/);
    assert.doesNotMatch(updatedValue, /gesichert – Ausgangslage(?:\n|$)/,
      'Der alte verwaltete Wohnblock muss ersetzt und darf nicht angehängt werden.');
    assert.equal(occurrenceCount(updatedValue, 'Wohnsituation im Berichtszeitraum:'), 1);
    assert.equal(occurrenceCount(updatedValue, base), 1);

    const manuallyEdited = `${updatedValue}\nManuelle Nachbearbeitung bleibt bestehen.`;
    state.reports[reportId].fields[fieldId].value = manuallyEdited;
    state.caseData.accommodation.housingSecurityEntries[0].details = `Sp\u00e4tere Quelldaten für ${reportId}`;
    const protectedResult = context.__housingReportSyncV259.sync(reportId, { save: false });
    assert.equal(protectedResult.changed, false);
    assert.equal(state.reports[reportId].fields[fieldId].value, manuallyEdited,
      'Eine manuell nachbearbeitete Gesamtfassung darf nicht automatisch überschrieben werden.');
  }
});

test('Schlussbericht nennt nur echte Beginn- und Endereignisse innerhalb des Zeitraums, einschließlich Grenzen', () => {
  const accommodationData = accommodation({
    housingSecurityEntries: [
      statusEntry('sec-long', '2025-01-01', '2028-01-01', 'secured', 'Nur laufender Bestand'),
      statusEntry('sec-start', '2026-03-01', '', 'temporary', 'Beginn an linker Grenze')
    ],
    accessibilityEntries: [
      statusEntry('acc-end', '2025-01-01', '2027-02-28', 'partial', 'Ende an rechter Grenze')
    ],
    currentProblemEntries: [
      statusEntry('problem-both', '2026-05-10', '2026-08-30', 'present', 'Beginn und Ende im Zeitraum'),
      statusEntry('problem-after', '2027-03-01', '', 'present', 'Außerhalb')
    ],
    supportEntries: [
      supportEntry('support-start', '2026-09-01', '', 'active', ['nursing'], 'Neue Unterstützung')
    ]
  });
  const reportData = reports({
    closing: { changes_since_last: field('Manueller Schlussbericht-Grundtext') }
  });
  const { context, state } = createRuntime({ accommodationData, reportData });
  const api = context.__housingReportSyncV259;
  const changes = api.changesForPeriod('closing', state.caseData, state.reports.closing);

  assert.match(changes, /Beginn 01\.03\.2026[^\n]*Beginn an linker Grenze/);
  assert.match(changes, /Ende 28\.02\.2027[^\n]*Ende an rechter Grenze/);
  assert.match(changes, /Beginn 10\.05\.2026, Ende 30\.08\.2026[^\n]*Beginn und Ende im Zeitraum/);
  assert.match(changes, /Beginn 01\.09\.2026[^\n]*Neue Unterst\u00fctzung/);
  assert.doesNotMatch(changes, /Nur laufender Bestand/,
    'Ein bloß weiterlaufender Zustand ohne Beginn oder Ende im Zeitraum ist keine Änderung.');
  assert.doesNotMatch(changes, /Außerhalb/);

  const first = context.__syncHousingReportsV259('closing', { save: false });
  assert.equal(first.supported, true);
  const composed = state.reports.closing.fields.changes_since_last.value;
  assert.match(composed,
    /^Manueller Schlussbericht-Grundtext\n\nVeränderungen der Wohnsituation im Berichtszeitraum:/);
  assert.equal(occurrenceCount(composed, 'Veränderungen der Wohnsituation im Berichtszeitraum:'), 1);
  context.__syncHousingReportsV259('closing', { save: false });
  assert.equal(occurrenceCount(
    state.reports.closing.fields.changes_since_last.value,
    'Veränderungen der Wohnsituation im Berichtszeitraum:'
  ), 1);
});

test('Öffentlicher Vertrag synchronisiert einzeln oder alle unterstützten Dokumente', () => {
  const accommodationData = accommodation({
    housingSecurityEntries: [statusEntry('sec-a', '2026-03-01', '', 'secured', 'Aktuell gesichert')]
  });
  const { context } = createRuntime({ accommodationData });
  const api = context.__housingReportSyncV259;

  assert.equal(typeof context.__syncHousingReportsV259, 'function');
  for (const id of ['initial', 'annual_assets', 'annual_noassets', 'accounting', 'closing']) {
    assert.equal(api.isSupported(id), true, `${id} muss als unterstützt registriert sein.`);
  }
  assert.equal(api.isSupported('free_document'), false);
  const single = context.__syncHousingReportsV259('accounting', { save: false });
  assert.equal(single.supported, true);
  assert.ok(single.fields.includes('personal_circumstances'));

  const all = context.__syncHousingReportsV259(undefined, { save: false });
  assert.deepEqual(Object.keys(plain(all)).sort(), [
    'accounting', 'annual_assets', 'annual_noassets', 'closing', 'initial'
  ]);
});

test('Synchronisation läuft vor amtlicher PDF-, Export- und Kombinationsausgabe', () => {
  assert.match(html,
    /async function createOfficialPdf\(reportId\)\{\s*if\(!window\.__reportSwapDepth\?\.\[reportId\]\)window\.__housingReportSyncV259\?\.sync\(reportId,\{save:false\}\)/,
    'Amtliche PDF-Erzeugung muss unmittelbar vorher das konkrete Dokument synchronisieren.');
  assert.match(html,
    /async function runSelectedExport\(\)\{\s*if\(!window\.__reportSwapDepth\?\.\[currentReport\]\)window\.__housingReportSyncV259\?\.sync\(currentReport,\{save:false\}\)/,
    'Der allgemeine Export muss unmittelbar vorher das aktuelle Dokument synchronisieren.');
  assert.match(html,
    /createCombinedPhase3Pdf\(\)[\s\S]{0,500}for\(const c of active\)if\(c\.type==='current'&&!window\.__reportSwapDepth\?\.\[c\.reportId\]\)window\.__housingReportSyncV259\?\.sync\(c\.reportId,\{save:false\}\)/,
    'Auch kombinierte Ausgaben müssen jeden aktuellen Dokumentbestandteil vorher synchronisieren.');
  assert.match(html,
    /function archiveCurrent\(\)\{if\(!window\.__reportSwapDepth\?\.\[currentReport\]\)window\.__housingReportSyncV259\?\.sync\(currentReport,\{save:false\}\)/,
    'Archive müssen den zeitbezogenen Wohnverlauf vor dem Einfrieren synchronisieren.');
  assert.match(html,
    /closing:\{changes_since_last:'other_report'\}[\s\S]{0,500}currentReport==='closing'&&src==='other_report'&&managed\?managed\.base:sourceEntry\.value/,
    'Der Schlussbericht darf den verwalteten Wohnblock des Vorberichts nicht ein zweites Mal erben.');
  assert.match(html,
    /function applyArchiveAsTemplate\(source,showToast=false\)[\s\S]{0,6500}entry\?\.source==='previous'\)entry\.source='housingReport'[\s\S]{0,250}__housingReportSyncV259\?\.sync\(currentReport,\{save:false\}\)/,
    'Auch die Archivansicht muss übernommene Wohnstatuswerte für den neuen Zeitraum neu ableiten.');
  assert.match(html,
    /async function accBuildSummaryPdf\(\)\{const a=accReport\(\);[\s\S]{0,900}const accountingMeta=state\.reports\.accounting\.meta,documentFrom=accDate\(accountingMeta\.periodFrom\),documentTo=accDate\(accountingMeta\.periodTo\)[\s\S]{0,500}__housingReportSyncV259\?\.sync\('accounting',\{save:false\}\)/,
    'Rechnungslegungs-PDF und Wohnverlauf müssen den rechtlich maßgeblichen Dokumentzeitraum verwenden.');
  assert.match(html,
    /async function accBuildAccountPdf\(account\)\{\s*const a=accReport\(\),accountingMeta=state\?\.reports\?\.accounting\?\.meta\|\|\{\},documentFrom=accDate\(accountingMeta\.periodFrom\),documentTo=accDate\(accountingMeta\.periodTo\)[\s\S]{0,5000}const startLabel=`Anfangsbestand am \$\{accDateDE\(documentFrom\)\}`;\s*const endLabel=`Endbestand am \$\{accDateDE\(documentTo\)\}`/,
    'Auch die Buchungslisten des Rechnungslegungspakets müssen den Dokumentzeitraum statt des Bankabrufzeitraums verwenden.');
  assert.match(html,
    /target==='care_providers'&&managed\)val=managed\.base\|\|\[\];else if\(target==='care_providers'&&!managed\)val=\[\]/,
    'Vorberichte dürfen frühere automatisch ermittelte Pflegedienste nicht in den neuen Periodenendstand übernehmen.');
});
