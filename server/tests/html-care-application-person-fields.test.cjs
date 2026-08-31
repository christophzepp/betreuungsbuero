'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

test('Betreuungsantrag Betreuter zeigt nur die kuratierte Eingabeebene', () => {
  assert.match(
    html,
    /\['care_application_person','care_application_zepp','care_change_zepp','citizen_benefit_initial','citizen_benefit_continuation','pension_application'\]\.includes\(id\)/
  );
  assert.match(
    html,
    /def\.id==='free_document'\|\|def\.id==='care_application_person'\|\|def\.id==='care_application_zepp'\|\|def\.id==='care_change_person'\|\|def\.id==='care_change_zepp'\|\|def\.id==='letter_care_notice'\|\|def\.title==='Freidokument'/
  );
});

test('sichtbare Felder befüllen die vier technischen PDF-Ziele', () => {
  assert.match(html, /field\.id==='pdf_0001'[^\n]+cap_person_name[^\n]+cap_address/);
  assert.match(html, /field\.id==='pdf_0002'[^\n]+cap_place[^\n]+v159GermanDate[^\n]+cap_date/);
  assert.match(html, /field\.id==='pdf_0004'[^\n]+cap_statement/);
  assert.match(
    html,
    /reportId==='care_application_person'&&fieldId==='pdf_0003'\?'cap_signature_note':fieldId/
  );
});

test('Geburtsdatum stammt aktuell aus den Falldaten', () => {
  assert.match(
    html,
    /id:'cap_birth_date',label:'Geburtsdatum',type:'text',sourcePath:'person\.birthDate'/
  );
  assert.match(
    html,
    /reportId==='care_application_person'[\s\S]{0,500}sourcePathValue\('person\.birthDate'\)[\s\S]{0,500}entry\?\.source==='master'/
  );
});

test('Anschrift der erklärenden Person verwendet die vollständige Stammdatenanschrift', () => {
  assert.match(
    html,
    /id:'cap_address',label:'Anschrift der erklärenden Person',type:'text',required:true,sourcePath:'person\.address'/
  );
  assert.match(
    html,
    /sourcePathValue\('person\.address'\)[\s\S]{0,500}fields\?\.cap_address[\s\S]{0,500}addressEntry\?\.source==='master'/
  );
});

test('Erklärung verwendet dynamisch Fallbetreuer und Bürostammdaten', () => {
  assert.match(
    html,
    /id:'cap_statement',label:'Erklärung',type:'textarea',required:true,full:true,min:80,deriveKey:'careApplicationStatement'/
  );
  assert.match(html, /function v159CareApplicationCaregiver\(\)/);
  assert.match(html, /d\.rechtlicherBetreuer\|\|care\.rechtlicherBetreuer\|\|care\.legalGuardian/);
  assert.match(html, /profile\.companyName\|\|profile\.company\|\|profile\.name/);
  assert.match(html, /profile\.formattedAddress\|\|\[street,postalCity,profile\.country\]/);
  assert.match(html, /window\.addEventListener\('officeProfileReady',v159RefreshCareApplicationStatement\)/);
  assert.match(html, /window\.addEventListener\('caseCaregiverReady',v159RefreshCareApplicationStatement\)/);
});

test('leeres Unterschriftsfeld der erklärenden Person bleibt Bestandteil des PDF-Exports', () => {
  assert.match(
    html,
    /externalSig\('cap_signature_note','Unterschrift der erklärenden Person','Erklärende Person',true\)/
  );
  assert.match(html, /const drawExternalSignatureField=f=>/);
  assert.match(html, /if\(f\.type==='signatureExternal'\)\{drawExternalSignatureField\(f\);continue\}/);
  assert.match(html, /page\.drawLine\(\{start:\{x:55,y\},end:\{x:315,y\}/);
});

test('Ort und Datum besitzen im Betreuungsantrag dieselbe Feldhöhe', () => {
  assert.match(
    html,
    /\.field\[data-wrap="cap_place"\] input,\.field\[data-wrap="cap_date"\] input\{height:34px;box-sizing:border-box\}/
  );
});

test('Ort wird aus dem Wohnort der betroffenen Person übernommen', () => {
  assert.match(
    html,
    /id:'cap_place',label:'Ort',type:'text',sourcePath:'person\.city'/
  );
  assert.doesNotMatch(
    html,
    /care_application_person:\{[^}]*cap_place:'St\. Goarshausen'/
  );
  assert.match(
    html,
    /sourcePathValue\('person\.city'\)[\s\S]{0,500}String\(placeEntry\?\.value\|\|''\)\.trim\(\)==='St\. Goarshausen'/
  );
});

test('Briefkopfversion des Formulars ist deaktiviert und Druckansicht ist Standard', () => {
  assert.match(html, /const withoutLetterhead=id==='care_application_person'/);
  assert.match(html, /letterhead:withoutLetterhead\?false:saved\.letterhead!==false/);
  assert.match(
    html,
    /defaultMode:withoutLetterhead\?\(\['print','combined'\]\.includes\(savedDefaultMode\)\?savedDefaultMode:'print'\)/
  );
  assert.match(html, /__careApplicationPersonPrintOnlyV221/);
  assert.match(html, /exp\.letterhead=false/);
  assert.match(html, /exp\.defaultMode='print'/);
  assert.match(html, /__careApplicationPersonPrintDefaultV223/);
  assert.match(html, /const personPrintGetExportOptions=function\(id\)/);
  assert.match(html, /options\.defaultMode='print'/);
  assert.match(html, /options\.original=false/);
  assert.match(html, /formStyle:id==='care_application_person'\?'print'/);
});

test('Dokumenteninformation weist den Umfang als 1 Seite(n) aus', () => {
  assert.match(
    html,
    /title:'Betreuungsantrag Betreuter',[\s\S]{0,180}pages:'1 Seite\(n\)'/
  );
});

test('alle Dokumente besitzen eine eigene Anschreiben-Signaturauswahl und nutzen sie im PDF', () => {
  assert.match(html, /function letterSignaturePickerHTML\(pick,id='phase3LetterSignaturePick'\)/);
  assert.match(html, /letterSignaturePickerHTML\(letterSignatureOptions\.letterSignatureId,'docLetterSignaturePick'\)/);
  assert.match(html, /const letterSignatureOptions=phase3Config\(id\)/);
  assert.match(html, /<h3>Unterschrift im Anschreiben<\/h3>/);
  assert.doesNotMatch(html, /id==='care_application_person'\?phase3Config\(id\):null/);
  assert.doesNotMatch(html, /id==='care_application_person'\?`<div class="doc-options-card"><h3>Unterschrift im Anschreiben/);
  assert.match(html, /option\('document','— Wie Unterschrift im Dokument —'\)/);
  assert.match(html, /id==='care_application_person'\?'caregiver':\(saved\.letterSignature===false\?'none':'document'\)/);
  assert.match(html, /if\(letterSignaturePick\)\{/);
  assert.doesNotMatch(html, /<input id="phase3LetterSignature" type="checkbox"/);
  assert.match(html, /phase3EmbedSignature\(pdf,await phase3LetterSignatureDataUrl\(cfg\)\)/);
  assert.match(html, /packageOptions\.letterSignatureId='caregiver'/);
});
