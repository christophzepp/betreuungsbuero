'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

test('Betreuerwechsel Betreuter steht zwischen Betreuungsantrag Betreuer und Betreuungsanzeige', () => {
  assert.match(html, /care-change-person-curated-fields-v232/);
  assert.match(html, /Object\.assign\(definition,\{[\s\S]{0,120}title:'Betreuerwechsel Betreuter'/);
  assert.match(html, /const caregiverApplication=REPORTS\.find\(item=>item\.id==='care_application_zepp'\)/);
  assert.match(html, /definition\.group=caregiverApplication\?\.group\|\|definition\.group\|\|'cat_01'/);
  assert.match(html, /const caregiverApplicationIndex=REPORTS\.findIndex\(item=>item\.id==='care_application_zepp'\)/);
  assert.match(html, /REPORTS\.splice\(caregiverApplicationIndex>=0\?caregiverApplicationIndex\+1:REPORTS\.length,0,careChangePerson\)/);
});

test('das Dokument zeigt nur eine fachlich benannte Feldebene', () => {
  assert.match(html, /SCHEMAS\[ID\]=\{sections:\[\{/);
  assert.match(html, /const PDF_IDS=\['pdf_0001','pdf_0002','pdf_0003','pdf_0004'\]/);
  assert.match(html, /for\(const fieldId of PDF_IDS\)if\(fieldId in report\.fields\)\{delete report\.fields\[fieldId\]/);
  assert.match(html, /state\.ui\.__careChangePersonCuratedFieldsV232=true/);
});

test('Felder folgen der vereinheitlichten Struktur und den Stammdaten', () => {
  assert.match(html, /id:'ccp_person_name',label:'Name der erklärenden Person',type:'text',required:true,sourcePath:'person\.fullName'/);
  assert.match(html, /id:'ccp_birth_date',label:'Geburtsdatum',type:'text',sourcePath:'person\.birthDate'/);
  assert.match(html, /id:'ccp_address',label:'Anschrift der erklärenden Person',type:'text',required:true,sourcePath:'person\.address',full:true/);
  assert.match(html, /id:'ccp_statement',label:'Erklärung',type:'textarea',required:true,full:true,min:80,deriveKey:'careChangeConsentStatement'/);
  assert.match(html, /id:'ccp_place',label:'Ort',type:'text',sourcePath:'person\.city'/);
  assert.match(html, /id:'ccp_date',label:'Datum',type:'date',deriveKey:'todayIso'/);
  assert.match(html, /id:'ccp_signature_note',label:'Unterschrift der erklärenden Person',type:'signatureExternal',full:true,defaultValue:true,signer:'Erklärende Person'/);
});

test('dynamischer Text verwendet den aktuell hinterlegten Fallbetreuer', () => {
  assert.match(html, /function consentStatement\(\)/);
  assert.match(html, /v159CareApplicationCaregiver\(\)/);
  assert.match(html, /caregiver\?\.description/);
  assert.match(html, /deriveKey==='careChangeConsentStatement'/);
  assert.match(html, /window\.addEventListener\('officeProfileReady'/);
  assert.match(html, /window\.addEventListener\('caseCaregiverReady'/);
});

test('sichtbare Felder befuellen die amtliche PDF-Vorlage', () => {
  assert.match(html, /field\.id==='pdf_0001'[^\n]+ccp_person_name[^\n]+ccp_address/);
  assert.match(html, /field\.id==='pdf_0002'[^\n]+ccp_place[^\n]+v159GermanDate[^\n]+ccp_date/);
  assert.match(html, /field\.id==='pdf_0004'[^\n]+ccp_statement/);
});

test('unter dem Dokumenttitel wird kein Berichtszeitraum gerendert', () => {
  const directHeaderExclusions = html.match(/def\.id==='care_application_zepp'\|\|def\.id==='care_change_person'/g) || [];
  assert.equal(directHeaderExclusions.length, 3, 'alle drei zentralen Kopfvarianten müssen den Betreuerwechsel direkt ausschließen');
  assert.match(html, /definition\?\.id===ID\?html\.replace\(\/<div class="report-subtitle">\[\\s\\S\]\*\?<\\\/div>\/,''\):html/);
  assert.match(html, /document\.querySelector\('#printArea \.report-title \+ \.report-subtitle'\)\?\.remove\(\)/);
});

test('Dokumente des Betreuers tragen die neuen Bezeichnungen und Kürzel', () => {
  assert.match(html, /caregiver-document-labels-v233/);
  assert.match(html, /care_application_zepp:\{icon:'BA-BT',title:'Betreuungsantrag Betreuer'\}/);
  assert.match(html, /care_change_zepp:\{icon:'BW-BT',title:'Betreuerwechsel Betreuer'\}/);
});

test('Dokumenteninformationen des Betreuerwechsels sind fachlich gesetzt', () => {
  assert.match(html, /__careChangePersonDocumentDefaultsV234/);
  assert.match(
    html,
    /const ID='care_change_person';[\s\S]{0,700}template:'--',[\s\S]{0,120}templateDate:'--',[\s\S]{0,120}author:'Betreuungsbüro',[\s\S]{0,120}authority:'Betreuungsgericht'/
  );
});

test('nur Druckansicht und Anschreiben plus Formular sind verfügbar', () => {
  assert.match(html, /\['care_application_person','care_application_zepp','care_change_person','care_change_zepp'\]\.includes\(id\)/);
  assert.match(html, /const withoutLetterhead=id==='care_application_person'\|\|id==='care_change_person'/);
  assert.match(html, /const originalUnavailable=\['care_application_person','care_application_zepp','care_change_person','care_change_zepp'\]\.includes\(id\)/);
  assert.match(html, /const letterheadUnavailable=id==='care_application_person'\|\|id==='care_change_person'/);
  assert.match(html, /exp\.print=true;[\s\S]{0,120}exp\.letterhead=false;[\s\S]{0,120}exp\.original=false;[\s\S]{0,120}exp\.combined=true;[\s\S]{0,120}exp\.defaultMode='print'/);
  assert.match(html, /options\.print=true;[\s\S]{0,120}options\.letterhead=false;[\s\S]{0,120}options\.original=false;[\s\S]{0,120}options\.combined=true;[\s\S]{0,120}options\.defaultMode='print'/);
});

test('zusätzliche Unterschriftsbereiche sind standardmäßig ausgeschaltet', () => {
  assert.match(html, /\(id==='care_application_person'\|\|id==='care_change_person'\)\?'none'/);
  assert.match(html, /doc\.signatureId='none';/);
  assert.match(html, /doc\.ownSignature=false;/);
  assert.match(html, /doc\.foreignSignatures=0;/);
  assert.match(html, /state\.ui\.__careChangePersonDocumentDefaultsV234=true/);
  assert.match(html, /state\.ui\.__careChangePersonNoDocumentSignatureV235=true/);
});
