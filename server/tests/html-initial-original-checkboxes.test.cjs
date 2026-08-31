'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);
const block = html.match(/<script id="flat-original-overlay-v253">([\s\S]*?)<\/script>/)?.[1] || '';

test('Anfangsbericht zeichnet Checkboxen als mittige Vektorkreuze', () => {
  assert.ok(block);
  assert.match(block, /function drawCheck\(page,x,y\)/);
  assert.match(block, /const half=2\.15,thickness=\.75/);
  assert.match(block, /page\.drawLine\(\{start:\{x:x-half,y:y-half\},end:\{x:x\+half,y:y\+half\}/);
  assert.match(block, /page\.drawLine\(\{start:\{x:x-half,y:y\+half\},end:\{x:x\+half,y:y-half\}/);
  assert.doesNotMatch(block, /page\.drawText\(['"]X['"]/);
});

test('alle Checkboxgruppen verwenden die vermessenen Innenmittelpunkte', () => {
  assert.match(block, /const residenceY=\[371\.5,357\.25,343,328\.75,314\.5,300\.25\]/);
  assert.match(block, /drawCheck\(p1,112\.5,residenceY\[index\]\)/);
  assert.match(block, /drawCheck\(p2,138,502\)/);
  assert.match(block, /drawCheck\(p2,324\.75,502\)/);
  assert.match(block, /drawCheck\(p3,79\.5,787\)/);
  assert.match(block, /drawCheck\(p3,79\.5,772\.75\)/);
  assert.match(block, /wishChecks=\{ja:320\.25,nein:349\.5,bedingt:390\.75\}/);
  assert.match(block, /drawCheck\(p4,x,787\)/);
  assert.match(block, /drawCheck\(p4,79\.5,316\.75\)/);
  assert.match(block, /drawCheck\(p4,108\.75,316\.75\)/);
});

test('das zuständige Betreuungsgericht wird aus den Fallstammdaten auf Seite 1 gesetzt', () => {
  assert.match(block, /p1\.node\.delete\(PDFLib\.PDFName\.of\('Annots'\)\)/);
  assert.match(block, /const courtPostbox=String\(care\.courtPostbox\|\|''\)\.trim\(\)/);
  assert.match(block, /\^postfach\\b\/i\.test\(courtPostbox\)\?courtPostbox:`Postfach \$\{courtPostbox\}`/);
  assert.match(block, /const courtAddressLine=care\.courtStreet\|\|courtPostboxLine/);
  assert.match(block, /const courtPostalCity=\[care\.courtPostal,care\.courtCity\]\.filter\(Boolean\)\.join\(' '\)/);
  assert.match(block, /p1\.drawRectangle\(\{x:69,y:602,width:227,height:64,color:PDFLib\.rgb\(1,1,1\)\}\)/);
  assert.match(block, /'master\.courtName',care\.courtName\|\|'',rows\(\[70\.5,651,224\.25\]\),\{size:11/);
  assert.match(block, /'master\.courtAddressLine',courtAddressLine,rows\(\[70\.5,636\.75,224\.25\]\),\{size:11/);
  assert.match(block, /'master\.courtPostalCity',courtPostalCity,rows\(\[70\.5,609,224\.25\]\),\{size:11/);
});
