'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// routes/bank lädt den gemeinsamen DB-Singleton bereits beim Import. Der reine
// Rechentest darf deshalb niemals auf den Projekt-/Livepfad zurückfallen.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiscus-test-'));
process.env.DB_PATH = path.join(temp, 'fixture.sqlite3');

const { parseGermanAmount, normKonto, normUmsatz } = require('../src/integrations/banking/hibiscus')._internal;
const { nextDueFrom } = require('../src/modules/finance/bank-routes')._test;

test.after(() => {
  try { require('../src/database/index').close(); } catch (_error) { /* Testprozess endet ohnehin */ }
  fs.rmSync(temp, { recursive: true, force: true });
});

test('liest XML-RPC-Betraege mit Dezimalpunkt', () => {
  assert.equal(parseGermanAmount('302.50'), 302.5);
  assert.equal(parseGermanAmount('-50.67'), -50.67);
  assert.equal(parseGermanAmount('14.83'), 14.83);
});

test('liest deutsche und international gruppierte Betraege', () => {
  assert.equal(parseGermanAmount('1.234,56 EUR'), 1234.56);
  assert.equal(parseGermanAmount('1,234.56 EUR'), 1234.56);
  assert.equal(parseGermanAmount('302,50'), 302.5);
});

test('normalisiert Salden und Umsatzbetraege ohne Faktor 100', () => {
  assert.equal(normKonto({ saldo: '302.50' }).saldo, 302.5);
  assert.equal(normUmsatz({ betrag: '-11.99', saldo: '-65.50' }).betrag, -11.99);
  assert.equal(normUmsatz({ betrag: '-11.99', saldo: '-65.50' }).saldo, -65.5);
});

test('berechnet Folgefaelligkeiten fuer Intervall-Zahlungen', () => {
  assert.equal(nextDueFrom('2026-07-26', 'taeglich', 26), '2026-07-27');
  assert.equal(nextDueFrom('2026-07-26', 'woechentlich', 26), '2026-08-02');
  assert.equal(nextDueFrom('2026-07-26', 'vierzehntaegig', 26), '2026-08-09');
  assert.equal(nextDueFrom('2026-07-26', 'monatlich', 15), '2026-08-15');
});
