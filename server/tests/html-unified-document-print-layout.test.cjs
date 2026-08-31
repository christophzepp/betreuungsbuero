'use strict';
/* Verankert das v230-Drucklayout NACH dem Typografie-Upgrade (Phase 5.3,
   Abnahme 13.08.2026: Variante A mit CI-Kopfband) und die eingebettete
   Unicode-Schrift (Phase 5.2, DejaVu Sans mit Helvetica-Fallback). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

test('intern erzeugte Druckformulare verwenden den gemeinsamen A4-Renderer', () => {
  assert.match(html, /unified-document-print-layout-v230/);
  assert.match(html, /async function createUnifiedDocumentPrintPdf\(reportId,data,label\)/);
  assert.match(html, /window\.createUnifiedDocumentPrintPdf=createUnifiedDocumentPrintPdf/);
  assert.match(html, /return createUnifiedDocumentPrintPdf\(reportId,data,component\.label\)/);
});

test('Originalvorlagen und Freidokument bleiben eigenständige Dokumenttypen', () => {
  assert.match(html, /reportId!==FREE_DOCUMENT_ID&&!OFFICIAL_PDF_TEMPLATES\[reportId\]\?\.ready/);
  assert.match(html, /if\(isGeneratedForm&&component\.formStyle!=='letterhead'\)/);
  assert.match(html, /return previousComponentBytes\(component,cfg\)/);
});

test('die eingebettete Schrift ist als Vorlagen-Block samt fontkit verfügbar', () => {
  assert.match(html, /<script id="tpl_font_dejavu_regular" type="application\/pdf-base64">/);
  assert.match(html, /<script id="tpl_font_dejavu_bold" type="application\/pdf-base64">/);
  assert.match(html, /@pdf-lib\/fontkit 1\.1\.1 UMD/);
  assert.match(html, /async function unifiedDocumentFonts\(pdf\)/);
  assert.match(html, /embeddedPdfBytes\('tpl_font_dejavu_regular'\)/);
  assert.match(html, /pdf\.registerFontkit\(window\.fontkit\)/);
  assert.match(html, /PDFLib\.StandardFonts\.Helvetica/); // Fallback bleibt
  assert.match(html, /window\.__unifiedAppearanceFont=unifiedAppearanceFont/);
});

test('AcroForm-Befüllung erzeugt Appearance-Streams mit der eigenen Schrift', () => {
  const stellen = html.match(/if\(apFont\)form\.updateFieldAppearances\(apFont\);else form\.updateFieldAppearances\(\)/g) || [];
  assert.equal(stellen.length, 2, 'beide Befüllpipelines (etabliert + v159) müssen den Appearance-Font nutzen');
});

test('der CI-Kopf trägt Band, Fallbezugskasten und schlanke Folgeseiten-Kopfzeile', () => {
  assert.match(html, /function drawFirstHeader\(\)/);
  assert.match(html, /drawRight\(bandText,bold,12\.5,PAGE_WIDTH-RIGHT-12/);
  assert.match(html, /\['Betreute Person',fullName\(\)\]/);
  assert.match(html, /\['Erstellt am',todayDE\(\)\]/);
  assert.match(html, /function drawContinuationHeader\(sectionTitle='',continued=false\)/);
  assert.match(html, /function unifiedCaregiverName\(\)/);
});

test('die Layoutsprache besitzt nummerierte Abschnitte und dynamische Feldkarten', () => {
  assert.match(html, /const COLUMN_GAP=12,COLUMN_WIDTH=\(CONTENT_WIDTH-COLUMN_GAP\)\/2/);
  assert.match(html, /function drawSectionBar\(title,continued=false,nr=0\)/);
  assert.match(html, /const height=Math\.max\(48,12\+labelLines\.length\*10\+4\+Math\.max\(1,valueLines\.length\)\*LINE_H\+10\)/);
  assert.match(html, /if\(istTabellenWert\(item\.value\)\)\{drawTable\(item\.field,item\.value\);continue\}/);
  assert.match(html, /if\(isWideField\(item\.field,item\.value\)\)\{drawWide\(item\.field,item\.value\);continue\}/);
  assert.match(html, /drawPair\(item,next\);index\+=1/);
  assert.match(html, /cardAccent=PDFLib\.rgb\(185\/255,205\/255,221\/255\)/);
});

test('Tabellenfelder rendern mit Kopfwiederholung, Übertrag und Summenschutz', () => {
  assert.match(html, /const UNIFIED_TABLE_COLUMNS=\{/);
  assert.match(html, /assetTable:\[\{key:'type',label:'Art'\}/);
  assert.match(html, /function drawTable\(field,rows\)/);
  assert.match(html, /function drawUebertrag\(seite\)/);
  assert.match(html, /'Übertrag von Seite '\+seite/);
  assert.match(html, /summenZeile\('Summe '\+art,artSumme\(art\),regular\)/);
  assert.match(html, /summenZeile\('Reinvermögen'/);
  assert.match(html, /function unifiedGeld\(raw\)/);
});

test('lange Freitextwerte werden ohne Zeilen-Stummel fortgesetzt', () => {
  assert.match(html, /while\(remaining\.length\)/);
  assert.match(html, /const capacity=Math\.floor\(\(y-CONTENT_BOTTOM-base\)\/LINE_H\)/);
  assert.match(html, /if\(capacity<MIN_SEG\|\|remaining\.length<2\*MIN_SEG\)/);
  assert.match(html, /drawContinuationHeader\(currentSection,true\)/);
  assert.match(html, /const text=continued\?`\$\{title\} – Fortsetzung`:title/);
});

test('ALLE Briefe zeichnen ihren Kopf über die eine zentrale Funktion (Wächter)', () => {
  assert.match(html, /window\.__unifiedLetterHead=unifiedLetterHead/);
  assert.match(html, /window\.__unifiedLetterInfoBlock=unifiedLetterInfoBlock/);
  const kopfAufrufe = html.match(/window\.__unifiedLetterHead\(/g) || [];
  assert.ok(kopfAufrufe.length >= 8, 'alle sechs Brief-Zeichner (inkl. Folgeseiten) müssen die zentrale Kopf-Funktion rufen (gefunden: ' + kopfAufrufe.length + ')');
  const infoAufrufe = html.match(/window\.__unifiedLetterInfoBlock\(/g) || [];
  assert.ok(infoAufrufe.length >= 5, '„Ihr Zeichen“/Ort-Datum laufen über den zentralen Infoblock (gefunden: ' + infoAufrufe.length + ')');
  // Kein Renderer darf mehr einen eigenen zentrierten Titel-Kopf zeichnen:
  assert.equal((html.match(/x:\(595\.28-officeTitleWidth\)\/2/g) || []).length, 0, 'zentrierter caregiver-Kopf noch vorhanden');
  assert.equal((html.match(/x:\(pageSize\[0\]-titleWidth\)\/2/g) || []).length, 0, 'zentrierter Freidokument-Kopf noch vorhanden');
  assert.equal((html.match(/const title=\(OFFICE\.name\+' \(Rechtliche Betreuung\)'\),titleSize=18/g) || []).length, 0, 'alter 18pt-Titelkopf noch vorhanden');
  const briefFonts = html.match(/__fonts=await window\.__unifiedDocumentFonts\(pdf\)/g) || [];
  assert.ok(briefFonts.length >= 5, 'Briefe müssen die zentrale Schrift nutzen (gefunden: ' + briefFonts.length + ')');
  assert.match(html, /window\.__pdfSafeTextOriginal=pdfSafeText/);
  assert.match(html, /window\.__unifiedText=unifiedText/);
  assert.match(html, /fremdesZeichen:reference/);
});

test('PDF-Kennwortschutz ist in beiden Mail-Editoren verdrahtet', () => {
  assert.match(html, /id="mailEditorPdfSchutz"/);
  assert.match(html, /id="imailPdfSchutz"/);
  assert.match(html, /attachmentIds,extraAttachments,pdfKennwort,pdfKennwortMail/);
  assert.match(html, /extraAttachments:extraAttachments,pdfKennwort:pdfKennwort,pdfKennwortMail:pdfKennwortMail/);
  assert.match(html, /Kennwort getrennt übermitteln|Kennwort getrennt &uuml;bermitteln/);
});

test('Kennwort-Generator und Kennwort-Mail-Option sind in beiden Editoren verdrahtet', () => {
  assert.match(html, /window\.__sicheresPdfKennwort=function\(\)/);
  assert.match(html, /crypto\.getRandomValues\(werte\)/);
  assert.match(html, /id="mailEditorPdfKennwortMail"/);
  assert.match(html, /id="imailPdfKennwortMail"/);
  // Default AN: undefined gilt als aktiviert
  const anzahlDefaultAn = (html.match(/pdfKennwortMail!==false/g) || []).length;
  assert.ok(anzahlDefaultAn >= 6, 'Default-an-Logik fehlt (gefunden: ' + anzahlDefaultAn + ')');
  assert.match(html, /kennwortMailFehler/);
});

test('die beiden gelöschten Hinweistexte sind aus dem Versand-/Sendenmenü entfernt', () => {
  assert.ok(!html.includes('Die Anwendung macht einen Vorschlag. Vor der Bestätigung kannst du alle Felder'), 'Vorschlags-Hinweis noch vorhanden');
  assert.ok(!html.includes('und der Vorgang für die Arbeitsmappe „02 - Betreuungsverlauf“ vorgemerkt'), 'Arbeitsmappen-Teilsatz noch vorhanden');
  assert.match(html, /dauerhaft dezent grün markiert\./);
});

test('fachliche Unterschriftsfelder und eigene Signaturen folgen derselben Abschlussgeometrie', () => {
  assert.match(html, /function drawSignatureRow\(\{placeDate='',signature=null,label='Unterschrift'\}\)/);
  assert.match(html, /const placeField=externalFields\.length\?fields\.find/);
  assert.match(html, /label:`\$\{external\.signer\|\|'Unterzeichnende Person'\} – Unterschrift`/);
  assert.match(html, /const options=getDocumentOptions\(reportId\)/);
  assert.match(html, /const image=options\.ownSignature\?await signatureImage\(pdf,reportId,options\):null/);
  assert.match(html, /`Seite \$\{index\+1\} von \$\{pages\.length\}`/);
  assert.match(html, /fussTeile/);
});
