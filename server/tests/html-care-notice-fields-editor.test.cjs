const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const htmlPath = path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function extractPatch(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Startmarke fehlt: ${startMarker}`);
  assert.notEqual(end, -1, `Endmarke fehlt: ${endMarker}`);
  return html.slice(start, end + endMarker.length);
}

test('Betreuungsanzeige trennt Empfängerauswahl vom optionalen Bezug', () => {
  const patch = extractPatch(
    '/* care-notice-fields-and-editors-v248-start */',
    '/* care-notice-fields-and-editors-v248-end */'
  );

  assert.match(patch, /const ID='letter_care_notice'/);
  assert.match(patch, /const RECIPIENT_FIELDS=new Set\(\[/);
  assert.match(patch, /title:'Bezug \(optional\)'/);
  assert.match(patch, /label:'Ihr Zeichen \/ Vertrags- oder Kundennummer \(optional\)'/);
  assert.match(patch, /required:false/);
  assert.match(patch, /delete fields\[fieldId\]/);
  assert.match(patch, /recipientType:'export'/);
});

test('beide Freitextfelder der Betreuungsanzeige verwenden denselben Rich-Text-Editor', () => {
  const patch = extractPatch(
    '/* care-notice-fields-and-editors-v248-start */',
    '/* care-notice-fields-and-editors-v248-end */'
  );

  assert.match(patch, /field\.id==='letter_additions'/);
  assert.match(patch, /type:'richtext'/);
  assert.match(patch, /Optionale Ergänzungen \/ konkrete Angaben/);
  assert.match(patch, /background:#fff!important/);
  assert.match(patch, /min-height:96px!important/);
  assert.match(patch, /resize:vertical!important/);
  assert.match(patch, /growCareNoticeEditorV248/);
  assert.match(patch, /editor\.scrollHeight/);
  assert.match(patch, /addEventListener\('input'/);
  assert.match(patch, /window\.richFocus=contextualRichFocusV248/);
});

test('Betreuungsanzeige zeigt keinen Berichtszeitraum und exportiert einen vollständigen Empfänger', () => {
  const periodSkips = html.match(/def\.id==='letter_care_notice'/g) || [];
  assert.ok(periodSkips.length >= 3, 'Der Berichtszeitraum muss in Arbeits-, Papier- und Druckansicht entfallen.');

  assert.match(
    html,
    /if\(reportId==='letter_care_notice'\)[\s\S]*window\.phase3RecipientLines\?\.\(getExportOptions\(reportId\)\)/
  );
  assert.match(html, /v159PlainRich\(v159LetterValue\(data,'letter_additions'\)\|\|'\'\)/);
});
