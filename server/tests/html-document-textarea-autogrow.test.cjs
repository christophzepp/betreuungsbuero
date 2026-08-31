'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

test('Dokument-Freitextfelder wachsen beim Öffnen und bei Eingaben mit', () => {
  assert.match(html, /function autoGrowReportTextarea\(textarea\)/);
  assert.match(html, /textarea\.style\.height='auto'/);
  assert.match(html, /Math\.max\(minimum,textarea\.scrollHeight\+2\)/);
  assert.match(html, /#printArea textarea\[data-field\],#printArea textarea\[data-promptnote\]/);
  assert.match(html, /textarea\.addEventListener\('input',\(\)=>autoGrowReportTextarea\(textarea\)\)/);
  assert.match(html, /bindReportTextareaAutogrow\(\);/);
});

test('Freitextfelder werden nicht durch innere Scrollbereiche begrenzt', () => {
  assert.match(html, /textarea\.report-textarea-autogrow[^}]+max-height:none!important[^}]+overflow-y:hidden!important/);
  assert.match(html, /\.free-document-editor \.prompt-note textarea\[data-promptnote\][\s\S]{0,320}max-height:none!important[\s\S]{0,180}overflow-y:hidden!important/);
});

test('Freitextfelder passen ihre Höhe nach einem Breitenwechsel erneut an', () => {
  assert.match(html, /window\.addEventListener\('resize'/);
  assert.match(html, /requestAnimationFrame\(\(\)=>bindReportTextareaAutogrow\(\)\)/);
});
