'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const names = require('../src/modules/documents/names');

test('normalisiert Unicode auf NFC und vergleicht deutsche Namen ohne Gross-/Kleinschreibung', () => {
  const nfd = 'Beho\u0308rde.pdf';
  const result = names.normalisiereDateiname(nfd);
  assert.equal(result.name, 'Behörde.pdf');
  assert.ok(result.reasons.some((r) => r.code === 'unicode_nfc'));
  assert.equal(names.dateinamenGleich('BEHÖRDE.PDF', nfd), true);
  assert.equal(names.dateinamenGleich('Behorde.pdf', 'Behörde.pdf'), false);
  assert.equal(names.deutschVergleichen('Ärzte', 'Zeugnisse') < 0, true);
});

test('ersetzt Windows-Zeichen und Steuerzeichen mit sichtbaren Gruenden', () => {
  const result = names.normalisiereDateiname('A/B\\C:D*E?F"G<H>I|J\u0007.pdf');
  assert.equal(result.name, 'A_B_C_D_E_F_G_H_I_J_.pdf');
  assert.ok(result.reasons.some((r) => r.code === 'ungueltige_zeichen'));
  assert.ok(result.reasons.some((r) => r.code === 'steuerzeichen'));
  assert.equal(/[\/\\:*?"<>|\p{Cc}]/u.test(result.name), false);
});

test('entfernt nachgestellte Punkte und Leerzeichen', () => {
  const result = names.normalisiereDateiname('Bericht.pdf.   ');
  assert.equal(result.name, 'Bericht.pdf');
  assert.ok(result.reasons.some((r) => r.code === 'nachgestellte_punkte_leerzeichen'));
});

test('entschaerft reservierte Windows-Geraetenamen auch mit Endung', () => {
  for (const value of ['CON', 'con.txt', 'LPT9.pdf', 'COM1', 'NUL.dat', 'CONOUT$']) {
    const result = names.normalisiereDateiname(value);
    assert.equal(result.name.startsWith('_'), true, value);
    assert.ok(result.reasons.some((r) => r.code === 'reservierter_geraetename'), value);
  }
  assert.equal(names.normalisiereDateiname('COM10.txt').name, 'COM10.txt');
});

test('kappt auf 255 UTF-8-Bytes ohne Zeichen zu teilen und erhaelt die Endung', () => {
  const original = 'ä'.repeat(300) + '.pdf';
  const result = names.normalisiereDateiname(original);
  assert.equal(result.bytes <= 255, true);
  assert.equal(result.name.endsWith('.pdf'), true);
  assert.equal(result.name.normalize('NFC'), result.name);
  assert.equal(Buffer.from(result.name, 'utf8').toString('utf8'), result.name);
  assert.ok(result.reasons.some((r) => r.code === 'utf8_bytegrenze'));
});

test('liefert fuer jede Anpassung Original, Ergebnis und Bytewerte', () => {
  const result = names.normalisiereDateiname('NUL. ');
  assert.equal(result.original, 'NUL. ');
  assert.equal(result.name, '_NUL');
  assert.equal(result.changed, true);
  assert.equal(result.bytes, Buffer.byteLength(result.name));
  assert.deepEqual(result.reasons.map((r) => r.code), [
    'nachgestellte_punkte_leerzeichen',
    'reservierter_geraetename'
  ]);
});
