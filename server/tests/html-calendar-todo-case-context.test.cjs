const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const scripts = [];
const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
while ((match = scriptRe.exec(html))) scripts.push({ attrs: match[1] || '', body: match[2] || '' });

assert.equal(scripts.length, 309, 'Scriptblockzahl hat sich verändert.');
let jsCount = 0;
scripts.forEach((script, index) => {
  if (/\btype\s*=\s*(['"]?)(?!text\/javascript|application\/javascript|module)\w/i.test(script.attrs)) return;
  jsCount += 1;
  new vm.Script(script.body, { filename: `html-calendar-todo-case-context-${index + 1}.js` });
});
assert.equal(jsCount, 229, 'JavaScript-Blockzahl hat sich verändert.');

assert(html.includes('.case-ref-chip'), 'Fall-Badge-CSS fehlt.');
assert(html.includes('function itemCaseLabel(item)'), 'Falllabel-Helfer fehlt.');
assert(html.includes('function itemTitleWithCase(item,title,showCase)'), 'Titel-mit-Fall-Helfer fehlt.');
assert(html.includes('caseMiniLineHTML(e)'), 'Kalender-Mini-Ansicht zeigt Fallkontext nicht an.');
assert(html.includes('caseMiniLineHTML(t)'), 'Aufgaben-Mini-Ansicht zeigt Fallkontext nicht an.');
assert(html.includes('caseContextChipHTML(e)'), 'Kalender-Agenda zeigt Fall-Badge nicht an.');
assert(html.includes('caseContextLineHTML(t)'), 'Aufgabenliste zeigt Fallzeile nicht an.');
assert(html.includes('itemTitleWithCase(e,e.title,showCase)'), 'Monatsraster nutzt keinen Fallkontext im Chip.');
assert(html.includes('itemTitleWithCase(e,e.title,shouldShowCaseContext(calFullFilter))'), 'Zeitraster nutzt keinen Fallkontext im Tooltip/Titel.');

console.log('Kalender/Aufgaben: Fallkontext in Alle-Fälle-Ansichten eingebaut; 309 Blöcke, 229 JS, 0 Syntaxfehler');
