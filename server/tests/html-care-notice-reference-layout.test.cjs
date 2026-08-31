const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const htmlPath = path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

test('Briefkopf führt das fremde Aktenzeichen rechtsbündig über Ort/Datum (zentraler Infoblock)', () => {
  /* Seit dem einheitlichen Briefkopf (14.08.2026): „Ihr Zeichen“ + Ort/Datum gestapelt rechts. */
  assert.match(html, /function unifiedLetterInfoBlock\(page,fonts,optionen\)/);
  assert.match(html, /'Ihr Zeichen: '\+fremd/);
  assert.match(html, /window\.__unifiedLetterInfoBlock\(page,__fonts,\{fremdesZeichen:reference,ortDatum:placeDate\}\)/);
  assert.match(html, /y=pdfDrawWrapped\(page,subject,/);
  assert.doesNotMatch(html, /\$\{subject\}\$\{reference\?` · Ihr Zeichen:/);
});

test('Druckansicht zeigt das fremde Aktenzeichen als dezente Referenzzeile', () => {
  /* Seit dem v230-Typografie-Upgrade (Phase 5.3, 13.08.2026) lebt die Referenzzeile
     im neuen CI-Kopf (drawFirstHeader): unter dem Fallbezugskasten, max. 2 Zeilen. */
  assert.match(html, /const careNoticeReference=reportId==='letter_care_notice'/);
  assert.match(html, /'Ihr Zeichen: '\+careNoticeReference/);
  assert.match(html, /wrap\('Ihr Zeichen: '\+careNoticeReference,regular,9,CONTENT_WIDTH\)\.slice\(0,2\)/);
  assert.match(html, /if\(careNoticeReference\)\{\s*y-=14;/);
  assert.match(
    html,
    /reportId==='letter_care_notice'&&fields\.length===1&&fields\[0\]\?\.id==='letter_reference'\)continue/
  );
});
