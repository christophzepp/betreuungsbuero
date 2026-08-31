'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const xlsx = require('../src/shared/simple-xlsx');

test('erzeugt eine gültige XLSX-Datei mit Umlauten und mehreren Blättern', () => {
  const bytes = xlsx.workbook([
    { name: 'Stammdaten', rows: [['Feld', 'Wert'], ['Nachname', 'Müller']] },
    { name: 'Adressen', rows: [['Name', 'Ort'], ['Klinik', 'Köln']] }
  ]);
  assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-xlsx-'));
  const file = path.join(dir, 'test.xlsx');
  fs.writeFileSync(file, bytes);
  const listing = execFileSync('/usr/bin/unzip', ['-l', file], { encoding: 'utf8' });
  assert.match(listing, /xl\/worksheets\/sheet1\.xml/);
  assert.match(listing, /xl\/worksheets\/sheet2\.xml/);
  execFileSync('/usr/bin/unzip', ['-t', file], { stdio: 'pipe' });
  fs.rmSync(dir, { recursive: true, force: true });
});
