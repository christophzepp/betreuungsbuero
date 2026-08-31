'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const taxonomy = require('../src/modules/documents/taxonomy');

const ROOTS = [
  '00 - Eingang',
  '01 - Stammdaten',
  '02 - Kerndokumente',
  '03 - Behörden & Gerichte',
  '04 - Gesundheit & Pflege',
  '05 - Finanzen',
  '06 - Versicherungen',
  '07 - Arbeit & Alltagsstruktur',
  '08 - Unterkunft & Aufenthalt',
  '09 - Persönliches',
  '10 - Berichte & Rechnungslegung',
  '11 - Betreuungsführung',
  '12 - Abschluss & Herausgabe'
];

test('Fallanlage erzeugt exakt die Register 00 bis 12 und keine Unterordner', () => {
  assert.deepEqual(taxonomy.fallanlageOrdner(), ROOTS);
  assert.equal(taxonomy.REGISTER.length, 13);
  assert.equal(taxonomy.fallanlageOrdner().some((p) => p.includes('/')), false);
  assert.ok(taxonomy.LAZY_UNTERORDNER['11'].includes(
    'Falldokumentation/<Jahr>/<Monat>/<JJMMTT HHMM Eintrag>'));
});

test('liest ISO- und deutsche Daten und weist ungueltige Kalendertage ab', () => {
  assert.equal(taxonomy.datumIso('2026-07-24T13:52:00+02:00'), '2026-07-24');
  assert.equal(taxonomy.datumIso('24.07.2026'), '2026-07-24');
  assert.equal(taxonomy.datumIso('24/07/2026, 13:52'), '2026-07-24');
  assert.equal(taxonomy.datumIso('31.02.2026'), '');
  assert.equal(taxonomy.datumIso('29.02.2024'), '2024-02-29');
  assert.deepEqual(taxonomy.jahrMonatOrdner('15.06.2026'), ['2026', '06']);
});

test('Dokumentationseintrag verwendet Ereignisdatum, Uhrzeit und flachen Eintragsordner', () => {
  const entry = {
    date: '15.06.2026',
    type: 'Hausbesuch',
    createdAt: '2026-07-24T13:52:00'
  };
  assert.equal(taxonomy.dokuEintragsname(entry), '260615 1352 Hausbesuch');
  assert.deepEqual(taxonomy.dokuPfad(entry), [
    '11 - Betreuungsführung',
    'Falldokumentation',
    '2026',
    '06',
    '260615 1352 Hausbesuch'
  ]);
});

test('Dokumentationseintrag übernimmt ohne eigenes Zeitfeld die Anlagenzeit', () => {
  const path = taxonomy.dokuPfad({
    date: '24.07.2026',
    type: 'Hausbesuch',
    photos: [{ filename: '260724 1352 Person Hausbesuch.jpg', uploadedAt: '2026-07-24T11:52:44.249Z' }]
  }, '2026-07-24 07:58:41');
  assert.deepEqual(path, [
    '11 - Betreuungsführung',
    'Falldokumentation',
    '2026',
    '07',
    '260724 1352 Hausbesuch'
  ]);
});

test('Dokumentationseintrag verlangt ein bestes verfuegbares Datum und meldet Namensanpassungen', () => {
  assert.throws(() => taxonomy.dokuEintragsname({ type: 'Hausbesuch' }), /kein gültiges Datum/i);
  const info = taxonomy.dokuEintragsnameInfo({
    datum: '2026-07-24',
    uhrzeit: '09:05',
    type: 'Arzt/Klinik'
  });
  assert.equal(info.name, '260724 0905 Arzt_Klinik');
  assert.ok(info.reasons.some((r) => r.code === 'ungueltige_zeichen'));
});

test('Berichtszeitraum nutzt Kalenderjahr oder den abweichenden Monatszeitraum', () => {
  assert.equal(taxonomy.berichtszeitraumOrdner('', 2026), '2026');
  assert.equal(taxonomy.berichtszeitraumOrdner('01.01. - 31.12.', 2026), '2026');
  assert.equal(taxonomy.berichtszeitraumOrdner('01.03. - 28.02.', 2026), '2026-03 bis 2027-02');
  assert.equal(taxonomy.berichtszeitraumOrdner('2026-03-01 bis 2027-02-28', 2026),
    '2026-03 bis 2027-02');
  assert.deepEqual(taxonomy.berichtPfad('Rechnungslegung', '01.03. - 28.02.', 2026), [
    '10 - Berichte & Rechnungslegung',
    'Rechnungslegung (§ 1865 BGB)',
    '2026-03 bis 2027-02'
  ]);
  assert.deepEqual(taxonomy.exportBerichtPfad('asset_inventory', '', 2026), [
    '10 - Berichte & Rechnungslegung',
    'Vermögensverzeichnis (§ 1835 BGB)'
  ]);
  assert.deepEqual(taxonomy.exportBerichtPfad('annual_assets', '01.03. - 28.02.', 2026), [
    '10 - Berichte & Rechnungslegung',
    'Berichte (§ 1863 BGB)',
    '2026-03 bis 2027-02'
  ]);
  assert.deepEqual(taxonomy.exportBerichtPfad('self_management', '', 2026), [
    '10 - Berichte & Rechnungslegung',
    'Rechnungslegung (§ 1865 BGB)',
    '2026'
  ]);
  assert.deepEqual(taxonomy.exportBerichtPfad('remuneration_pdf', '', 2026), [
    '10 - Berichte & Rechnungslegung',
    'Vergütung',
    '2026'
  ]);
  assert.equal(taxonomy.exportBerichtPfad('free_document', '', 2026), null);
});

test('ciFolderGuess legt Leistungstraeger nach 05 und Unbekanntes nach 00', () => {
  for (const value of [
    'Rentenbescheid Deutsche Rentenversicherung',
    'Bewilligung Grundsicherung',
    'Wohngeldbescheid',
    'Schreiben der Krankenkasse',
    'Bescheid der Kasse',
    'Jobcenter Leistungsbescheid'
  ]) {
    assert.equal(taxonomy.ciFolderGuess(value), '05 - Finanzen', value);
    assert.equal(taxonomy.ciFolderGuessCode(value), '05', value);
  }
  assert.equal(taxonomy.ciFolderGuess('Vorsorgevollmacht'), '02 - Kerndokumente');
  assert.equal(taxonomy.ciFolderGuess('Patientenverfügung'), '02 - Kerndokumente');
  assert.equal(taxonomy.ciFolderGuess('vollkommen unbekannter Inhalt'), '00 - Eingang');
});
