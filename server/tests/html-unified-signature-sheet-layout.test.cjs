'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

test('das Unterschriftenblatt übernimmt die gemeinsame Drucklayoutsprache', () => {
  assert.match(html, /unified-signature-sheet-layout-v231/);
  assert.match(html, /async function appendUnifiedSignatureSheet\(out,cfg\)/);
  assert.match(html, /Unterschriften zum Dokumentenpaket/);
  assert.match(html, /Enthaltene Dokumente/);
  assert.match(html, /color:FILL,borderColor:BORDER,borderWidth:\.65/);
});

test('Unterschriften stehen in gleichmäßig aufgebauten Karten', () => {
  assert.match(html, /function drawSignatureCard\(\{title,placeDate='',signature=null,signatureLabel\}\)/);
  assert.match(html, /const height=126,bottom=y-height,splitX=LEFT\+CONTENT_WIDTH\/2/);
  assert.match(html, /page\.drawText\('Ort und Datum'/);
  assert.match(html, /page\.drawText\('Unterschrift'/);
  assert.match(html, /Name \/ Funktion der unterschreibenden Person/);
});

test('mehrere Unterschriftenblätter erhalten wiederholte Köpfe und eigene Seitenzahlen', () => {
  assert.match(html, /if\(y-126>=52\)return;\s*drawHeader\(true\)/);
  assert.match(html, /Unterschriften zum Dokumentenpaket - Fortsetzung/);
  assert.match(html, /Unterschriftenblatt · Seite \$\{index\+1\} von \$\{pages\.length\}/);
  assert.match(html, /appendPhase3SignaturePage=appendUnifiedSignatureSheet/);
});
