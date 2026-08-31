'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

test('Freidokument trennt Versandbetreff und sichtbaren Dokumentbetreff', () => {
  assert.match(html, /id:'free_subject',label:'Standardbetreff für E-Mail und Versand'/);
  assert.match(html, /id:'free_reference',label:'Betreff des Schreibens'/);
  assert.match(
    html,
    /function documentSubjectValue\(\)\{return referenceValue\(\)\|\|String\(REPORTS\.find\(report=>report\.id===ID\)\?\.title\|\|'Dokument'\)\.trim\(\)\}/
  );
  assert.doesNotMatch(html, /const subject=subjectValue\(\)/);
  assert.doesNotMatch(html, /const reference=referenceValue\(\)/);
  assert.match(html, /state\.ui\.exportOptions\.free_document\.subject=String\(value\|\|''\)\.trim\(\)\|\|defaultExportSubject\('free_document'\)/);
  assert.match(html, /state\.reports\[id\]\.fields\.free_subject=\{\.\.\.oldSubject,value:eo\.subject/);
  assert.equal(
    (html.match(/const documentSubject=documentSubjectValue\(\);/g) || []).length,
    2,
    'Briefkopf- und Druckversion müssen dieselbe einzelne Dokumentbetreffzeile verwenden.'
  );
});
