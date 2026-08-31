'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

test('Betreuungsantrag Betreuer besitzt die gewünschten Dokumentinformationen', () => {
  assert.match(html, /const ID='care_application_zepp'/);
  assert.match(html, /title:'Betreuungsantrag Betreuer'/);
  assert.match(html, /template:'--'/);
  assert.match(html, /templateDate:'--'/);
  assert.match(html, /pages:'1 Seite\(n\)'/);
  assert.match(html, /author:'Betreuungsbüro'/);
  assert.match(html, /authority:'Betreuungsgericht'/);
});

test('Betreuungsantrag Betreuer steht direkt nach dem Antrag der betreuten Person', () => {
  assert.match(html, /const personIndex=REPORTS\.findIndex\(item=>item\.id==='care_application_person'\)/);
  assert.match(html, /REPORTS\.splice\(personIndex>=0\?personIndex\+1:REPORTS\.length,0,caregiverApplication\)/);
});

test('Originalvorlage ist ausgegraut und Briefkopfversion ist Standard', () => {
  assert.match(html, /\['care_application_person','care_application_zepp','care_change_person','care_change_zepp'\]\.includes\(id\)/);
  assert.doesNotMatch(html, /const originalRemoved=id==='care_application_zepp'/);
  assert.match(html, /<option value="original" \$\{eo\.defaultMode==='original'\?'selected':''\} \$\{originalUnavailable\?'disabled':''\}>Originalvorlage<\/option>/);
  assert.match(html, /document\.getElementById\('tpl_v159_care_application_zepp'\)\?\.remove\(\)/);
  assert.match(html, /exp\.letterhead=true/);
  assert.match(html, /exp\.original=false/);
  assert.match(html, /exp\.defaultMode='letterhead'/);
  assert.match(html, /const caregiverLetterheadGetExportOptions=function\(id\)/);
  assert.match(html, /options\.defaultMode='letterhead'/);
  assert.match(html, /options\.original=false/);
});

test('Unterschrift des Betreuers ist Dokumentstandard', () => {
  assert.match(html, /doc\.signatureId='caregiver'/);
  assert.match(html, /doc\.ownSignature=true/);
  assert.match(html, /__careApplicationCaregiverDefaultsV224/);
  assert.match(html, /careApplicationCaregiverSignatureDefaultV225Migrated/);
  assert.match(html, /if\(id==='care_application_zepp'&&!state\.ui\.careApplicationCaregiverSignatureDefaultV225Migrated\)/);
  assert.match(html, /saved\.signatureId='caregiver'/);
  assert.match(html, /saved\.ownSignature=true/);
});

test('Betreuungsantrag Betreuer zeigt nur die fachlich benannte Feldebene', () => {
  assert.match(
    html,
    /\['care_application_person','care_application_zepp','care_change_zepp','citizen_benefit_initial','citizen_benefit_continuation','pension_application'\]\.includes\(id\)/
  );
  assert.match(html, /care-application-caregiver-curated-fields-v226/);
  assert.match(html, /!\/\^Originalformularfelder\\b\/\.test\(section\.title\|\|''\)/);
});

test('zusätzliche obere Ort-, Datums- und Unterschriftsfelder sind entfernt', () => {
  assert.doesNotMatch(html, /id:'caz_place_date'/);
  assert.doesNotMatch(html, /addAfterV154\('care_application_zepp'[^\n]+caz_intermediate_signature/);
  assert.match(html, /__careApplicationCaregiverSingleSignatureSystemV227/);
  assert.match(html, /delete report\.fields\.caz_place_date/);
  assert.match(html, /delete report\.fields\.caz_intermediate_signature/);
});

test('nur der obere KI-Zusatzblock an der Gerichtsanschrift ist unterdrückt', () => {
  assert.match(html, /id:'caz_court_address'[^\n]+promptNotes:false/);
  assert.match(html, /function fieldSupportsPromptNotes\(f\)\{return f\.promptNotes!==false&&\(f\.type==='textarea'\|\|!!f\.ai\)\}/);
  assert.match(html, /id:'caz_additional'[^\n]+ai:true/);
  assert.match(html, /allSchemaFields\(currentReport\)\.filter\(fieldSupportsPromptNotes\)/);
});

test('sichtbare Felder befüllen die acht technischen PDF-Ziele', () => {
  assert.match(html, /reportId==='care_application_zepp'/);
  assert.match(html, /field\.id==='pdf_0001'[^\n]+caz_court_address/);
  assert.match(html, /field\.id==='pdf_0002'[^\n]+return v159Today\(\)/);
  assert.match(html, /field\.id==='pdf_0003'[^\n]+caz_court/);
  assert.match(html, /field\.id==='pdf_0004'[^\n]+caz_file_number/);
  assert.match(html, /field\.id==='pdf_0005'[^\n]+caz_birth_date/);
  assert.match(html, /field\.id==='pdf_0006'[^\n]+street/);
  assert.match(html, /field\.id==='pdf_0007'[^\n]+postalCity/);
  assert.match(html, /field\.id==='pdf_0008'[^\n]+caz_person_name/);
});

test('Geburtsdatum und Betreuungsgericht stammen korrekt aus den Falldaten', () => {
  assert.match(html, /id:'caz_court',label:'Betreuungsgericht',type:'text',required:true,sourcePath:'care\.courtName'/);
  assert.match(html, /id:'caz_birth_date',label:'Geburtsdatum',type:'text',sourcePath:'person\.birthDate'/);
});

test('Felder sind fachlich geordnet und verwenden vollständige Anschriften', () => {
  assert.match(
    html,
    /id:'caz_court'[\s\S]{0,250}id:'caz_file_number'[\s\S]{0,250}id:'caz_court_address'[\s\S]{0,250}id:'caz_person_name'[\s\S]{0,250}id:'caz_birth_date'[\s\S]{0,250}id:'caz_person_address'[\s\S]{0,250}id:'caz_known'[\s\S]{0,250}id:'caz_consent'[\s\S]{0,300}id:'caz_additional'/
  );
  assert.match(html, /id:'caz_court_address'[^\n]+sourcePath:'care\.courtPostalAddress'/);
  assert.match(html, /path==='care\.courtPostalAddress'/);
  assert.match(html, /hadRepeatedCourt[\s\S]{0,250}courtLines\.slice\(1\)\.join\('\\n'\)/);
  assert.match(html, /sourcePathValue\('person\.address'\)[\s\S]{0,300}fields\?\.caz_person_address[\s\S]{0,300}personAddressEntry\?\.source==='master'/);
});

test('Übernahmefelder sind einheitlich benannt und standardhoch', () => {
  assert.match(html, /id:'caz_consent',label:'Einverständnis mit der Übernahme durch Betreuer'/);
  assert.match(html, /\.field\[data-wrap="caz_known"\] select,\.field\[data-wrap="caz_consent"\] select(?:,[^{]+)*\{height:34px/);
});

test('unter dem Titel wird kein Berichtszeitraum ausgegeben', () => {
  const exclusion = /def\.id==='free_document'\|\|def\.id==='care_application_person'\|\|def\.id==='care_application_zepp'\|\|def\.id==='care_change_person'\|\|def\.id==='care_change_zepp'\|\|def\.id==='letter_care_notice'\|\|def\.title==='Freidokument'/g;
  assert.ok((html.match(exclusion) || []).length >= 3);
});

test('Druck- und Briefkopfversion verwenden den eigentlichen Betreuerantrag', () => {
  assert.match(html, /care-application-caregiver-pdf-export-v229/);
  assert.match(html, /async function createCaregiverApplicationPdf\(data,\{letterhead=false\}=\{\}\)/);
  assert.match(html, /async function createCaregiverApplicationLetterPdf\(data\)/);
  assert.match(html, /window\.createCaregiverApplicationLetterPdf=createCaregiverApplicationLetterPdf/);
  assert.match(html, /\['current','archive'\]\.includes\(component\?\.type\)&&component\?\.reportId===ID/);
  assert.match(html, /component\.formStyle==='letterhead'\?createCaregiverApplicationLetterPdf\(data\):createCaregiverApplicationPdf\(data\)/);
  assert.match(html, /if\(currentReport===ID&&coverLetterDepth===0\)/);
  assert.match(html, /createCaregiverApplicationLetterPdf\(state\.reports\?\.\[ID\]\)/);
  assert.match(html, /hiermit erkläre ich mich bereit und damit einverstanden, die rechtliche Betreuung/);
  assert.match(html, /Die betroffene Person ist mir bekannt\./);
  assert.match(html, /mein Einverständnis derzeit nicht vorliegt/);
  assert.match(html, /dieselbe Geschäftsbrief-Geometrie wie beim Freidokument/);
  assert.match(html, /x:80,y:724,size:senderSize/);
  /* Seit dem einheitlichen Briefkopf (14.08.2026) stehen Ort/Datum rechtsbuendig im zentralen Infoblock. */
  assert.match(html, /window\.__unifiedLetterInfoBlock\(page,__fonts,\{ortDatum:/);
  assert.match(html, /Übernahmebereitschaft zur rechtlichen Betreuung/);
});

test('das echte Paket-Anschreiben bleibt vom Formular-Briefkopf getrennt', () => {
  assert.match(html, /if\(component\?\.type==='letter'\)\{/);
  assert.match(html, /coverLetterDepth\+=1/);
  assert.match(html, /finally\{coverLetterDepth-=1\}/);
});

test('PDF-Ausgabe enthält Ort, Datum und die konfigurierte Betreuer-Unterschrift', () => {
  assert.match(html, /async function caregiverSignature\(pdf\)/);
  assert.match(html, /if\(options\.signatureId==='caregiver'\)await window\.__sigStore\?\.ensureCaregiver/);
  assert.match(html, /\[officePlace\(\),todayDE\(\)\]\.filter\(Boolean\)\.join\(', '\)/);
  assert.match(html, /page\.drawText\('Ort, Datum'/);
  assert.match(html, /const lineY=y-62/);
  assert.match(html, /Unterschrift des Betreuers/);
});
