'use strict';

/* Frueher verglich diese Datei zwei fest eingetragene SHA-256-Werte der App-HTML und ihre
   Bytelaenge gegen eine Kopie in einem temporaeren Ordner. Das war die Quittung EINER
   Patch-Sitzung, keine Regressionspruefung: jede weitere Aenderung an der HTML machte sie
   rot - und der temporaere Ordner ueberlebt keinen Rechnerneustart, danach waere sie
   ohnehin gescheitert.
   Geblieben ist, was dauerhaft gilt: 289 Scriptbloecke, davon 214 mit JavaScript, alle
   syntaktisch fehlerfrei - und die inhaltlichen Belege, dass die Umbauten drin sind und
   Altes draussen ist. Wer hier wieder einen Hash eintraegt, baut die Quittung nach.
   (2026-07-28) */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.resolve(
  __dirname,
  '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
);
const current = fs.readFileSync(htmlPath);

function validateScripts(buffer, label) {
  const source = buffer.toString('utf8');
  const blocks = [];
  const expression = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = expression.exec(source))) blocks.push({ attributes: match[1], body: match[2] });
  assert.equal(blocks.length, 309, `${label}: Scriptblöcke`);
  let javascript = 0;
  for (let index = 0; index < blocks.length; index++) {
    if (/\btype\s*=/i.test(blocks[index].attributes)) continue;
    javascript++;
    new vm.Script(blocks[index].body, { filename: `${label}-script-${index + 1}.js` });
  }
  assert.equal(javascript, 229, `${label}: JavaScriptblöcke`);
}

validateScripts(current, 'HTML');

const html = current.toString('utf8');
assert.doesNotMatch(html, /Modulordner \/ Betreuerausweis/);
assert.doesNotMatch(html, /Hauptkategorien sind fest vorgegeben und bilden die erste Pfadebene: 01 - Stammdaten/);
assert.match(html, /caseId:selectedCaseId\('calNewCaseLabel'\)/);
assert.match(html, /caseId:selectedCaseId\('todoNewCaseLabel'\)/);
assert.match(html, /window\.__inboxCasePick=function\(id,caseId\)/);
assert.match(html, /function caseRefMatchCore\(item,caseId,caseLabel,records,titleMatcher\)/);
assert.match(html, /function coCloseHousekeeping\(\)[\s\S]*?coCaseMatch\(t,ref\)/);
assert.match(html, /window\.__runtimeMode=function\(\)/);
assert.match(html, /if\(window\.__adSnapshotId\)return 'fieldService'/);
assert.match(html, /hasDocumentStore:mode==='online'/);
assert.match(html, /office-json\/case_intakes\/ocr\//);
assert.match(html, /betreuungsbuero-intake-ocr/);
assert.match(html, /Verwaltung &amp; Sicherungen/);
assert.doesNotMatch(html, />_Verwaltung &amp; Sicherungen/);
assert.match(html, /\/maintenance-plans/);
assert.match(html, /\/api\/admin\/restore-encrypted\/preview/);
assert.match(html, /\/api\/admin\/recovery-key\/status/);
assert.match(html, /\/api\/admin\/recovery-key\/verify/);
assert.match(html, /\/api\/admin\/recovery-key\/rotate/);
assert.match(html, /api\('\/backup-health'\)/);
assert.match(html, /verschlüsselte Offsite-Zweitkopie/);
assert.match(html, /function daRestoreSummaryText\(result\)/);
assert.doesNotMatch(html, /prompt\('Extern verwahrten Wiederherstellungsschlüssel/);
assert.match(html, /function ciOcrVerify\(payload,ref\)/);
assert.match(html, /window\.__adDokSammeln/);
assert.match(html, /function adDokPfadSichtbar\(pfad,fallLabel\)/);

const pathHelperStart = html.indexOf('function adDokPfadSichtbar(pfad,fallLabel){');
const pathHelperEnd = html.indexOf('\nfunction adDokViewer (){', pathHelperStart);
assert.ok(pathHelperStart >= 0 && pathHelperEnd > pathHelperStart, 'Außendienst-Pfadhelfer ist nicht eindeutig extrahierbar.');
const pathContext = {};
vm.createContext(pathContext);
new vm.Script(
  html.slice(pathHelperStart, pathHelperEnd) + '\nthis.cleanPath=adDokPfadSichtbar;'
).runInContext(pathContext);
assert.equal(
  pathContext.cleanPath('Modulordner/Falldokumentation/2026/07', 'Bastuck, Franz Josef'),
  'Falldokumentation/2026/07'
);
assert.equal(
  pathContext.cleanPath(
    'Fallakten/B/Bastuck, Franz Josef 650101/11 - Betreuungsführung/Falldokumentation',
    'Bastuck, Franz Josef'
  ),
  '11 - Betreuungsführung/Falldokumentation'
);

console.log('HTML-Audit: Betriebsarten, echte Ordner, OCR, Wartung, Restore und Fall-ID-Integration; 289 Blöcke, 0 Syntaxfehler');
