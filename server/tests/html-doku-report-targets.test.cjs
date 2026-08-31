'use strict';
/* Berichtsrelevanz der Dokumentationseinträge (Nutzerwunsch 14.08.2026):
   Einträge sind nicht mehr nur für den Anfangsbericht gedacht — Zielfelder für
   Jahres- und Schlussbericht plus Sync-Brücke mit derselben Schutzmechanik.
   Außerdem: kompakte Profil-Chips im Kontaktmonitor. Verankert gegen Regression
   und gegen Überrollen durch parallele Editor-Schreibzyklen. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

test('Berichtsrelevanz ist berichtsübergreifend beschriftet und erklärt', () => {
  assert.match(html, /> In Berichten verwenden<\/label>/);
  assert.ok(!html.includes('> Für den Anfangsbericht verwenden</label>'), 'altes Anfangsbericht-Label noch vorhanden');
  assert.match(html, /automatisch in Berichte übernommen\./);
  assert.ok(!html.includes('automatisch in den Anfangsbericht übernommen; manuelle Berichtstexte bleiben geschützt'), 'alter Profiltext noch vorhanden');
});

test('Berichtsfreigabe verwendet den vorhandenen Vorgangstext ohne zweites Textfeld', () => {
  assert.match(html, /<label>Vorgangstext<\/label><textarea id="dokuFreeDetail"/);
  assert.ok(!html.includes('Geprüfte Berichtszusammenfassung'));
  assert.ok(!html.includes('id="dokuReportSummaryV255"'));
  assert.match(html, /reportText=t\(document\.getElementById\('dokuFreeDetail'\)\?\.value\)/);
  assert.match(html, /entry\.reportSummary=reportRelevant\?reportText:''/,
    'Die intern kompatible Berichtsfassung muss automatisch aus dem Vorgangstext entstehen.');
  assert.match(html, /KI- und Regelnotizen bleiben intern\./);
});

test('Zielfelder decken Jahres- und Schlussbericht ab, Automatik speist die Kontaktgestaltung', () => {
  assert.match(html, /\['annual\.contact_description','Jahresbericht: Gestaltung der Kontakte'\]/);
  assert.match(html, /\['annual\.other_report','Jahresbericht: Sonstige Entwicklungen'\]/);
  assert.match(html, /\['closing\.changes_since_last','Schlussbericht: Änderungen der Verhältnisse'\]/);
  assert.match(html, /target==='initial\.contact_notes'\|\|target==='annual\.contact_description'/);
});

test('die Sync-Brücke schreibt markierte Einträge geschützt in die Zielberichte', () => {
  assert.match(html, /function setManagedForReportV255\(reportId,id,value,source/);
  assert.match(html, /function syncReportDokuV255\(\)/);
  assert.match(html, /\['annual_assets','contact_description','annual\.contact_description'\]/);
  assert.match(html, /\['closing','changes_since_last','closing\.changes_since_last'\]/);
  assert.match(html, /changed=\(window\.__syncReportDokuV255\?\.\(\)\|\|false\)\|\|changed;/);
  assert.match(html, /\['initial','annual_assets','annual_noassets','closing'\]\.includes\(currentReport\)/);
});

test('der Kontaktmonitor zeigt erfasste Profil-Einschätzungen kompakt an', () => {
  assert.match(html, /function kmProfilChipsHTML\(cp\)/);
  assert.match(html, /\['understanding','Verständigung'\],\['trust','Vertrauen'\]/);
  assert.match(html, /profilHtml:kmProfilChipsHTML\(c\.caseData&&c\.caseData\.contactProfile\)/);
  assert.match(html, /\+\(r\.profilHtml\|\|''\)\+'<\/td>'/);
});
