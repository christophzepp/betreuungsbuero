'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);
const block = html.match(/\/\* Der „Betreuerwechsel Betreuer" folgt([\s\S]*?)\/\* care-change-caregiver-curated-fields-v240-end \*\//)?.[0] || '';

test('Betreuerwechsel Betreuer ist zwischen Personenwechsel und Betreuungsanzeige einsortiert', () => {
  assert.ok(block);
  assert.match(block, /const personChangeIndex=REPORTS\.findIndex\(item=>item\.id==='care_change_person'\)/);
  assert.match(block, /const noticeIndex=REPORTS\.findIndex\(item=>item\.id==='letter_care_notice'\)/);
  assert.match(block, /const insertionIndex=personChangeIndex>=0\?personChangeIndex\+1:\(noticeIndex>=0\?noticeIndex:REPORTS\.length\)/);
  assert.match(block, /REPORTS\.splice\(insertionIndex,0,caregiverChange\)/);
});

test('Dokumenteninformationen und Exportregeln entsprechen dem Personenantrag', () => {
  assert.match(block, /title:'Betreuerwechsel Betreuer'/);
  assert.match(block, /icon:'BW-BT'/);
  assert.match(block, /template:'--'/);
  assert.match(block, /templateDate:'--'/);
  assert.match(block, /pages:'1 Seite\(n\)'/);
  assert.match(block, /author:'Betreuungsbüro'/);
  assert.match(block, /authority:'Betreuungsgericht'/);
  assert.match(block, /Object\.assign\(exp,\{print:true,letterhead:true,original:false,combined:true,defaultMode:'print',recipientType:'court'\}\)/);
  assert.match(block, /if\(!state\.ui\.__careChangeCaregiverLetterheadV243\)\{[\s\S]{0,120}exp\.letterhead=true/);
  assert.doesNotMatch(block, /Object\.assign\(options,\{[\s\S]{0,80}letterhead:false/);
  assert.match(block, /Object\.assign\(doc,\{signatureId:'caregiver',ownSignature:true,foreignSignatures:0,combinedLetterStyle:'letterhead',combinedFormStyle:'print'\}\)/);
  assert.match(block, /if\(!state\.ui\.__careChangeCaregiverSignatureV244\)\{[\s\S]{0,180}signatureId:'caregiver',ownSignature:true,foreignSignatures:0/);
  assert.match(block, /letterSignatureId:'caregiver'/);
});

test('nur eine kuratierte, dynamische Feldebene bleibt sichtbar', () => {
  assert.match(block, /SCHEMAS\[ID\]=\{sections:\[\{/);
  assert.doesNotMatch(block, /Originalformularfelder/);
  assert.doesNotMatch(block, /id:'ccz_place_date'/);
  assert.doesNotMatch(block, /id:'ccz_intermediate_signature'/);
  assert.match(block, /for\(const fieldId of \[\.\.\.TECHNICAL_IDS,\.\.\.obsolete\]\)/);
  assert.match(html, /\['care_application_person','care_application_zepp','care_change_zepp','citizen_benefit_initial','citizen_benefit_continuation','pension_application'\]\.includes\(id\)/);
});

test('Übernahmefelder besitzen dieselbe Höhe wie die übrigen Eingabefelder', () => {
  assert.match(
    html,
    /\.field\[data-wrap="ccz_known"\] select,\.field\[data-wrap="ccz_consent"\] select\{height:34px;min-height:34px;box-sizing:border-box\}/
  );
});

test('Felder sind fachlich geordnet und verwenden vollständige Stammdaten', () => {
  assert.match(
    block,
    /id:'ccz_court'[\s\S]{0,250}id:'ccz_file_number'[\s\S]{0,300}id:'ccz_court_address'[\s\S]{0,300}id:'ccz_person_name'[\s\S]{0,250}id:'ccz_birth_date'[\s\S]{0,300}id:'ccz_person_address'[\s\S]{0,350}id:'ccz_known'[\s\S]{0,350}id:'ccz_consent'[\s\S]{0,400}id:'ccz_previous_caregiver'[\s\S]{0,350}id:'ccz_change_reason'[\s\S]{0,300}id:'ccz_additional'/
  );
  assert.match(block, /id:'ccz_court_address'[^\n]+sourcePath:'care\.courtPostalAddress'/);
  assert.match(block, /id:'ccz_person_address'[^\n]+sourcePath:'person\.address'/);
  assert.match(block, /id:'ccz_known'[^\n]+deriveKey:'documentedPersonalContact'/);
  assert.match(block, /id:'ccz_change_reason'[^\n]+type:'textarea'/);
  assert.match(block, /id:'ccz_additional'[^\n]+type:'textarea'/);
});

test('Berichtszeitraum ist ausgeschaltet und die Betreuer-Unterschrift ist Standard', () => {
  assert.match(html, /def\.id==='care_change_person'\|\|def\.id==='care_change_zepp'\|\|def\.id==='letter_care_notice'\|\|def\.title==='Freidokument'/);
  assert.match(block, /document\.querySelector\('#printArea \.report-title \+ \.report-subtitle'\)\?\.remove\(\)/);
  assert.match(block, /signatureId:'caregiver',ownSignature:true,foreignSignatures:0/);
});

test('Briefkopfversion formuliert den Dokumenteninhalt statt des Standardanschreibens', () => {
  assert.match(block, /async function createCaregiverChangeLetterPdf\(data\)/);
  assert.match(block, /window\.createCaregiverChangeLetterPdf=createCaregiverChangeLetterPdf/);
  assert.match(block, /Betreuerwechsel und Übernahmebereitschaft/);
  assert.match(block, /hiermit erkläre ich mich bereit, im Rahmen des vorgesehenen Betreuerwechsels/);
  assert.match(block, /Die Betreuung wurde bislang von/);
  assert.match(block, /Anlass beziehungsweise Begründung des Betreuerwechsels/);
  assert.match(block, /Ergänzende Hinweise:/);
  assert.match(block, /if\(currentReport===ID&&coverLetterDepth===0\)return createCaregiverChangeLetterPdf\(state\.reports\?\.\[ID\]\)/);
});

test('Paket-Anschreiben und fachlicher Dokumentbrief bleiben getrennt', () => {
  assert.match(block, /if\(component\?\.type==='letter'\)\{/);
  assert.match(block, /coverLetterDepth\+=1/);
  assert.match(block, /finally\{coverLetterDepth-=1;\}/);
  assert.match(block, /component\?\.reportId===ID&&component\?\.formStyle==='letterhead'/);
  assert.match(block, /return createCaregiverChangeLetterPdf\(data\)/);
});
