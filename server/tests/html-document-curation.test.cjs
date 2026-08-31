'use strict';

/* Prüfstand für die Dokumenten-Kuratierung vom 12.08.2026 (Katalog-Patches in der V159-Zeile
   plus Laufzeitblock Version 2.41). Sichert die Kernzusagen: keine Teilwert-Fehlmappings mehr,
   fachliche Metadaten statt Platzhalter, reparierte Brieftexte, kuratierte Kernschemata und
   die stillgelegte pdf-Ebene der Vorsorgevollmacht. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

const v159Line = html.split('\n').find((line) => line.startsWith('const V159={'));
assert.ok(v159Line, 'V159-Katalogzeile fehlt');
const v159 = JSON.parse(v159Line.slice('const V159='.length, -1));

test('V159-Zeile bleibt parsebar und frei von Script-Tag-Sequenzen', () => {
  assert.equal(v159.catalog.length, 83, 'Kataloggröße hat sich verändert');
  assert.ok(!v159Line.includes('<script') && !v159Line.includes('</script'), 'Script-Tag in der JSON-Zeile');
});

test('Teilwert-Fehlmappings der pdf-Ebenen sind korrigiert', () => {
  const alleFelder = Object.entries(v159.pdfFields || {})
    .filter(([docId]) => !['care_application_person', 'care_application_zepp', 'care_change_person', 'care_change_zepp'].includes(docId))
    .flatMap(([, fields]) => fields);
  for (const f of alleFelder) {
    const lbl = String(f.label || '') + ' ' + String(f.name || '');
    if (/stra(ß|ss)e\s*\+?\s*haus/i.test(lbl)) assert.notEqual(f.sourcePath, 'person.houseNumber', `${f.id}: Straße+Hausnummer zeigt nur auf die Hausnummer`);
    if (/plz\s*\+?\s*(stadt|ort)/i.test(lbl)) assert.notEqual(f.sourcePath, 'person.postalCode', `${f.id}: PLZ+Stadt zeigt nur auf die PLZ`);
    if (/vorname\s*,?\s*\+?\s*(name|nachname)/i.test(lbl) && !/betreuer/i.test(lbl)) assert.notEqual(f.sourcePath, 'person.firstName', `${f.id}: Vorname Name zeigt nur auf den Vornamen`);
    if (/betreuer/i.test(lbl)) assert.ok(!['person.firstName', 'person.address'].includes(f.sourcePath || ''), `${f.id}: Betreuer-Feld zeigt auf Daten der betreuten Person`);
  }
});

test('Berichtszeitraum-Felder der Selbstverwaltung/Entlastung sind ableitbar, Bankfelder gemappt', () => {
  for (const docId of ['self_management', 'discharge']) {
    const fields = v159.pdfFields[docId];
    const von = fields.find((f) => /berichtszeitraum.*(start|beginn|anfang)/i.test(f.label || ''));
    const bis = fields.find((f) => /berichtszeitraum.*(ende|schluss)/i.test(f.label || ''));
    assert.equal(von && von.deriveKey, 'periodFrom', `${docId}: Zeitraum-Beginn nicht ableitbar`);
    assert.equal(bis && bis.deriveKey, 'periodTo', `${docId}: Zeitraum-Ende nicht ableitbar`);
    for (const f of fields) {
      if (/^IBAN$/i.test(f.label || '')) assert.equal(f.sourcePath, 'banks.0.iban', `${docId}/${f.id}: IBAN ungemappt`);
      if (/^BIC$/i.test(f.label || '')) assert.equal(f.sourcePath, 'banks.0.bic', `${docId}/${f.id}: BIC ungemappt`);
    }
  }
});

test('Katalog-Metadaten sind fachlich gesetzt statt Platzhalter', () => {
  const nachId = new Map(v159.catalog.map((c) => [c.id, c]));
  assert.equal(nachId.get('sgb2_annex_kdu').authority, 'Jobcenter');
  assert.equal(nachId.get('pension_application').authority, 'Deutsche Rentenversicherung');
  assert.equal(nachId.get('initial').authority, 'Betreuungsgericht');
  assert.equal(nachId.get('accounting').title, 'Rechnungslegung');
  // Kuratierung 23.08.2026: selbst erstellte Dokumente tragen unter Vorlage und Stand '--'.
  // Die frueher mitlaufende Programmversion als "Stand" ist damit entfallen.
  assert.equal(nachId.get('letter_death_notice').template, '--');
  assert.equal(nachId.get('letter_death_notice').templateDate, '--');
  assert.ok(!/\.templateDate=`V\$\{VERSION\}`/.test(html), 'Programmversion darf nicht mehr als Stand gestempelt werden');
  // Vorlagenrunde 23.08.2026: die Rechnungslegung hat wieder eine echte Blankovorlage. Zuvor war
  // eine ausgefuellte 19-seitige Fremdabrechnung eingebettet, weshalb sie auf '--' gesetzt war.
  assert.equal(nachId.get('accounting').template, 'Rechnungslegung.pdf');
  assert.equal(nachId.get('accounting').pages, '2 Seite(n)');
  assert.match(nachId.get('child_benefit_application').template, /Kindergeldantrag/, 'Tippfehler Kondergeldantrag nicht korrigiert');
  assert.match(nachId.get('broadcast_exemption_application').template, /Befreiungsantrag/, 'Tippfehler Befreiuungsantrag nicht korrigiert');
});

test('Brief-Defaulttexte sind repariert', () => {
  const briefe = v159.letterTemplates;
  assert.ok(!/durch\s+mit\s+beendet/.test(briefe.letter_care_end.body), 'letter_care_end: Satzbau weiterhin defekt');
  assert.ok(!/gegebenfalls/.test(briefe.letter_benefit_notice.body), 'letter_benefit_notice: gegebenfalls');
  assert.ok(!/XX\.XX\.XXXX/.test(briefe.letter_death_notice.body), 'letter_death_notice: Datums-Platzhalter');
});

test('flatSchemas: Gesundheitsfragebogen ohne Haushalts-Ableitungen, Mietangebot ohne Ist-Miete', () => {
  const alg1 = JSON.stringify(v159.flatSchemas.alg1_health_questionnaire);
  assert.ok(!alg1.includes('householdSummary') && !alg1.includes('benefitSummary') && !alg1.includes('assetSummary'), 'alg1_health_questionnaire trägt noch Haushalts-/Einkommens-Ableitungen');
  const offer = JSON.stringify(v159.flatSchemas.rent_offer_certificate);
  assert.ok(!offer.includes('accommodation.basicRent'), 'Mietangebot wird mit der aktuellen Miete vorbefüllt');
});

test('Kernschemata: Genehmigung mit Pflichtfeldern und Rechtsgrundlage, Aufenthaltsort-Fix, Vergütungspflicht', () => {
  assert.match(html, /\{id:'ca_rechtsgrundlage',label:'Rechtsgrundlage',type:'select'/);
  assert.match(html, /\{id:'ca_art',label:'Art der gerichtlichen Genehmigung',type:'text',full:true,required:true/);
  assert.match(html, /\{id:'current_residence',label:'Derzeitiger Aufenthaltsort',type:'text',required:true,sourcePath:'person\.institution'\}/);
  assert.match(html, /\{id:'rem_sections',label:'Abrechnungsabschnitte',type:'remunerationTable',full:true,required:true\}/);
  assert.match(html, /\{id:'ad_person_name',label:'Name der verfügenden Person',type:'text',required:true,sourcePath:'person\.fullName'\}/);
  assert.match(html, /\{id:'jc_total',label:'Gesamte Mietkosten',type:'number',required:true,sourcePath:'accommodation\.totalHousingCost'\}/);
});

test('Laufzeitblock 2.41: Master-Refresh, Zeitraum-Ableitung und stillgelegte Vorsorgevollmacht-pdf-Ebene', () => {
  assert.match(html, /Version 2\.41 - Dokumenten-Kuratierung in der Breite/);
  assert.match(html, /function refreshMasterValuesV241\(reportId\)/);
  assert.match(html, /field\.deriveKey==='periodFrom'/);
  assert.match(html, /const POA_ID='power_of_attorney'/);
  assert.match(html, /__poaPdfLayerRemovedV241/);
  assert.match(html, /OFFICIAL_PDF_TEMPLATES\[POA_ID\]\.ready=false/);
});

console.log('Dokumenten-Kuratierung 12.08.2026: Katalog-Patches und Laufzeitblock 2.41 verifiziert');
