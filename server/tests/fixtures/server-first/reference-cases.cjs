'use strict';

// Deterministic, exclusively invented records. Expected values are asserted separately.
const small = require('./pilot-case.json');
module.exports = function referenceCases() {
  const large = structuredClone(small.stammdaten);
  large.exportHistory = Array.from({ length: 500 }, (_, i) => ({
    id: `synthetic-export-${i}`, date: '2026-01-01', note: `Synthetischer Verlauf ${i}`,
    amount: (i / 100).toFixed(2), retained: { zero: 0, disabled: false, empty: '', unknown: null },
  }));
  large.healthInfo.diagnoses = Array.from({ length: 100 }, (_, i) => ({
    id: `synthetic-diagnosis-${i}`, text: `Künstlicher Eintrag ${i}`, since: '2026-01-01',
  }));
  const historical = structuredClone(small.stammdaten);
  historical.archives = [{ id: 'synthetic-2019', version: 0, fields: { unknown: null, amount: '0.00' } }];
  historical.unknownLegacyField = { nullValue: null, emptyValue: '', zeroValue: 0,
    falseValue: false, list: [], obsolete: { 'früherer-Schlüssel': ['ÄÖÜ ß', 0, false, null] } };
  historical.livelihood.income[0].monthly = '0.00';
  return [
    { id: 'SF-REF-001', kind: 'small', data: structuredClone(small.stammdaten) },
    { id: 'SF-REF-002', kind: 'large', data: large },
    { id: 'SF-REF-003', kind: 'historical', data: historical },
  ];
};
