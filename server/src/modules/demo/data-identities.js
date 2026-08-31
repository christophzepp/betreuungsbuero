'use strict';

/*
 * Einziger technischer Vertrag fuer Daten, die ausschliesslich der Vorfuehrung dienen.
 * Die Fall-IDs stammen aus tools/demo-faelle/seed.js und sind absichtlich dauerhaft.
 * Dadurch koennen alte, versehentlich in der Live-Datenbank verbliebene Vorfuehrdaten
 * sicher ausgeblendet werden, ohne echte Datensaetze anhand eines Namens zu erraten.
 */
const DEMO_CASES = Object.freeze([
  Object.freeze({ id: 'de300001-0000-4000-8000-000000000001', label: 'Auerbach, Margarete' }),
  Object.freeze({ id: 'de300002-0000-4000-8000-000000000002', label: 'Kilic, Emre' }),
  Object.freeze({ id: 'de300003-0000-4000-8000-000000000003', label: 'Rothenberg, Dieter' }),
  Object.freeze({ id: 'de300004-0000-4000-8000-000000000004', label: 'Nowak, Halina' }),
  Object.freeze({ id: 'de300005-0000-4000-8000-000000000005', label: 'Weidmann, Jonas' })
]);

const DEMO_CASE_IDS = new Set(DEMO_CASES.map((entry) => entry.id));
const DEMO_CASE_LABELS = new Set(DEMO_CASES.map((entry) => entry.label.toLocaleLowerCase('de')));

function isDemoUsername(value) {
  return /^Demo(?:Admin)?(?:[1-9]\d*)?$/i.test(String(value || '').trim());
}

function isDemoCaseId(value) {
  return DEMO_CASE_IDS.has(String(value || '').trim());
}

function isDemoCaseLabel(value) {
  return DEMO_CASE_LABELS.has(String(value || '').trim().toLocaleLowerCase('de'));
}

module.exports = {
  DEMO_CASES,
  DEMO_CASE_IDS,
  isDemoUsername,
  isDemoCaseId,
  isDemoCaseLabel
};
