'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.resolve(
  __dirname,
  '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
);
const html = fs.readFileSync(htmlPath, 'utf8');

function between(source, start, end, name) {
  const first = source.indexOf(start);
  assert.notEqual(first, -1, `${name}: Startmarke fehlt`);
  assert.equal(source.indexOf(start, first + start.length), -1, `${name}: Startmarke nicht eindeutig`);
  const last = source.indexOf(end, first + start.length);
  assert.notEqual(last, -1, `${name}: Endmarke fehlt`);
  return source.slice(first, last);
}

function scripts(source) {
  const blocks = [];
  const expression = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = expression.exec(source))) blocks.push({ attributes: match[1], body: match[2] });
  assert.equal(blocks.length, 309, 'Scriptblockzahl');
  let javascript = 0;
  const failures = [];
  blocks.forEach((block, index) => {
    if (/\btype\s*=/i.test(block.attributes)) return;
    javascript++;
    try {
      new vm.Script(block.body, { filename: `html-case-id-script-${index + 1}.js` });
    } catch (error) {
      failures.push({ index: index + 1, message: error.message });
    }
  });
  assert.equal(javascript, 229, 'JavaScriptblockzahl');
  assert.deepEqual(failures, [], `JavaScript-Syntaxfehler: ${JSON.stringify(failures)}`);
}

function testPureMatchingContract() {
  const body = between(
    html,
    'function caseRefMatchCore(item,caseId,caseLabel,records,titleMatcher){',
    '\nwindow.__caseRefMatchCore=',
    'Fall-ID-Vertragsfunktion'
  );
  const context = {};
  vm.createContext(context);
  new vm.Script(`${body}\nthis.match=caseRefMatchCore;`).runInContext(context);
  const match = context.match;
  const records = [
    { id: 'case-a', label: 'Muster, Max' },
    { id: 'case-b', label: 'Muster, Max' },
    { id: 'case-u', label: 'Einzig, Erika' }
  ];
  const titleMatcher = (title, label) => String(title || '').includes(label);

  // Explizite IDs sind auch bei identischen Labels eindeutig und autoritativ.
  assert.equal(match({ caseId: 'case-a', caseLabel: 'Muster, Max' }, 'case-a', 'Muster, Max', records, titleMatcher), true);
  assert.equal(match({ caseId: 'case-b', caseLabel: 'Muster, Max' }, 'case-a', 'Muster, Max', records, titleMatcher), false);
  assert.equal(match({ caseId: 'falsch', caseLabel: 'Einzig, Erika' }, 'case-u', 'Einzig, Erika', records, titleMatcher), false);

  // Ein Label-/Titel-Fallback darf bei Doppelbelegung niemals einen der beiden Fälle wählen.
  assert.equal(match({ caseLabel: 'Muster, Max' }, 'case-a', 'Muster, Max', records, titleMatcher), false);
  assert.equal(match({ title: 'Muster, Max – Rückruf' }, 'case-a', 'Muster, Max', records, titleMatcher), false);
  assert.equal(match({ caseId: 'case-a' }, '', 'Muster, Max', records, titleMatcher), false);

  // Eindeutiger Legacy-Bestand bleibt kompatibel.
  assert.equal(match({ caseLabel: 'Einzig, Erika' }, 'case-u', 'Einzig, Erika', records, titleMatcher), true);
  assert.equal(match({ title: 'Einzig, Erika – Hausbesuch' }, 'case-u', 'Einzig, Erika', records, titleMatcher), true);
  assert.equal(match({ caseId: 'case-u' }, '', 'Einzig, Erika', records, titleMatcher), true);
}

scripts(html);
testPureMatchingContract();

const calendarBlock = between(html, 'function caseRefRecords(extra){', '\n\n/* ===== KI-Kontext', 'Kalender-Fallfilter');
assert.match(calendarBlock, /window\.__caseRefMatches=/);
assert.match(calendarBlock, /if\(itemId\)return itemId===targetId/);
assert.match(html, /knownCaseRecordsCache\.map\(c=>`<option value="\$\{escAttr\(c\.id\)\}"/);
assert.match(html, /const activeRef=await activeCaseRef\(\)/);
assert.match(html, /caseId:t\.caseId\|\|'',caseLabel:t\.caseLabel/);

const deadlineBlock = between(html, 'function frTodoPayload(fr){', '\nasync function frPushCal', 'Fristen-Todo');
assert.match(deadlineBlock, /caseId:window\.__activeServerCaseId\|\|''/);
assert.match(html, /function frCaseDisplay\(e\)/);

const inboxBlock = between(html, '<script id="inbox-script-v1">', '</script>', 'Posteingang');
assert.match(inboxBlock, /function inboxCaseMatches\(item,ref\)/);
assert.match(inboxBlock, /c\.id===inboxCaseFilter/);
assert.match(inboxBlock, /function inboxDocIsOpenCase[\s\S]*?inboxCaseMatches\(doc,\{caseId:id,caseLabel:label\}\)/);
assert.match(inboxBlock, /function inboxLocalTarget[\s\S]*?hits\.length>1/);
assert.match(inboxBlock, /return all\.filter\(x=>inboxCaseMatches\(x,ref\)\)/);
assert.match(inboxBlock, /caseId:doc\.caseId\|\|'',caseLabel:doc\.caseLabel/);
assert.match(inboxBlock, /bereich:\(caseId\|\|fall\)\?'case':'office',caseId,fallLabel/);
assert.doesNotMatch(inboxBlock, /\.find\(x=>x\.label===doc\.caseLabel\)/);

const intakeBlock = between(html, '<script id="caseintake-script-v1">', '</script>', 'Fallbeginn');
assert.match(intakeBlock, /function ciCaseMatches\(item,caseId,caseLabel\)/);
assert.match(intakeBlock, /ciCaseMatches\(x,S\.targetCaseId,label\)/);
assert.match(intakeBlock, /function ciKnownCaseId\(\)/);
assert.match(intakeBlock, /caseId:ciKnownCaseId\(\),caseLabel/);
assert.match(intakeBlock, /ciCaseDisplay\(c,id\)/);
assert.match(intakeBlock, /S\._deferCaseActions\)\{ciQueueCaseAction\('event',a\)/);
assert.match(intakeBlock, /S\._deferCaseActions\)\{ciQueueCaseAction\('todo',t\)/);
assert.match(intakeBlock, /await ciFlushDeferredCaseActions\(id\)/);
assert.match(intakeBlock, /await ciRefreshCaseRecords\(\)/);
assert.match(intakeBlock, /if\(ciOnline\(\)&&!ciCaseRecordsComplete\)return false/);
assert.doesNotMatch(intakeBlock, /String\(x\.caseLabel\|\|''\)===label/);

const outtakeBlock = between(html, '<script id="caseouttake-script-v1">', '</script>', 'Fallabschluss');
assert.match(outtakeBlock, /function coActiveCaseRef\(\)/);
assert.match(outtakeBlock, /if\(!ref\.caseId\)throw new Error/);
assert.match(outtakeBlock, /coCaseMatch\(t,ref\)/);
assert.match(outtakeBlock, /coCaseMatch\(ev,ref\)/);
assert.match(outtakeBlock, /coCaseMatch\(d,ref\)/);
assert.match(outtakeBlock, /await coRefreshCaseRecords\(\)/);
assert.match(outtakeBlock, /if\(coOnlineMode\(\)&&!coCaseRecordsComplete\)return false/);
assert.doesNotMatch(outtakeBlock, /String\(t\.caseLabel\|\|''\)===label/);
assert.doesNotMatch(outtakeBlock, /String\(ev\.caseLabel\|\|''\)===label/);

const mailBlock = between(html, '<script id="mailx-client-v1">', '</script>', 'Mail');
assert.match(mailBlock, /function mxCaseDisplay\(c\)/);
assert.match(mailBlock, /if\(hits\.length===1\)return hits\[0\]/);
assert.match(mailBlock, /async taskCreate[\s\S]*?caseId:caseId,caseLabel:caseLabel/);
assert.match(mailBlock, /async calCreate[\s\S]*?caseId:caseId,caseLabel:caseLabel/);
assert.match(mailBlock, /async icsImport[\s\S]*?caseId:caseId,caseLabel:caseLabel/);
assert.match(mailBlock, /priority:get\('priority'\)\|\|'normal',caseId:caseId\|\|''/);
assert.match(mailBlock, /allDay:allDay,caseId:caseId\|\|''/);
assert.match(mailBlock, /priority:g\('priority'\)\|\|'normal',caseId:caseId\|\|''/);
assert.match(mailBlock, /window\.__caseRefMatches\(e,caseId,label,MX\.cases\|\|\[\]\)/);
assert.match(mailBlock, /esc\(mxCaseDisplay\(k\)\)/);

console.log('HTML Case-ID-Integration: 289 Blöcke, 0 Syntaxfehler, Doppel-Label-Verträge erfüllt');
