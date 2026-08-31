'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(
  path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

assert.match(html, /Version 1\.60 - Wohnungsbegehung\/Inventarisierung und neutralisierte MV-Mitteilung/);
assert.match(html, /moduleStyle\.id='housing-inspection-and-court-notice-v160'/);
assert.match(html, /const HOUSING_ID='housing_inspection_inventory'/);
assert.match(html, /const NOTICE_ID='court_payment_notice'/);
assert.match(html, /id:HOUSING_ID,title:'Wohnungsbegehung & Inventarisierung'/);
assert.match(html, /title:'Wohnungsbegehung & Inventarisierung',icon:'WB',group:'cat_06'/);
assert.match(html, /id:NOTICE_ID,title:'Mitteilung nach Mitteilungsverordnung'/);
assert.match(html, /title:'Mitteilung nach Mitteilungsverordnung',icon:'MV',group:'cat_03'/);
assert.doesNotMatch(html, /id:'court_letters',title:'Schreiben an das Betreuungsgericht'/);

const dynamicTables = [
  'hi_ancillary', 'hi_participants', 'hi_access_log', 'hi_keys', 'hi_meters',
  'hi_hazards', 'hi_rooms', 'hi_documents', 'hi_medication', 'hi_valuables',
  'hi_cash', 'hi_payment_media', 'hi_chain', 'hi_signatures'
];
for (const id of dynamicTables) {
  assert.match(html, new RegExp(`table\\('${id}'`), `${id}: dynamische Tabelle fehlt`);
}
assert.match(html, /onclick="addTableRow\('\$\{escAttr\(field\.id\)\}',\{\}\)"/);
assert.match(html, /onclick="removeTableRow\('\$\{escAttr\(field\.id\)\}',\$\{index\}\)"/);
assert.match(html, /options\.print=true;options\.letterhead=false;options\.original=false;options\.combined=false/);

assert.match(html, /async function createCourtNoticePdf\(\)/);
assert.match(html, /if\(reportId===NOTICE_ID\)return createCourtNoticePdf\(\)/);
assert.match(html, /Quelldaten eingebettet/);
assert.doesNotMatch(
  html.slice(html.indexOf('Version 1.60 - Wohnungsbegehung/Inventarisierung')),
  /85327269146|betreuungen\.zepp@outlook\.de|Christoph Zepp/
);

console.log('Neue Dokumentvorlagen: dynamische Wohnungs-Tabellen und neutralisierter A4-Gerichtsexport vorhanden');
