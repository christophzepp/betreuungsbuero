const assert = require('assert');
const { assertScriptInventory } = require('./helpers/html-scripts.cjs');
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

assertScriptInventory(html, htmlPath);

assert(html.includes('.case-ref-chip'), 'Fall-Badge-CSS fehlt.');
assert(html.includes('function itemCaseLabel(item)'), 'Falllabel-Helfer fehlt.');
assert(html.includes('function itemTitleWithCase(item,title,showCase)'), 'Titel-mit-Fall-Helfer fehlt.');
assert(html.includes('caseMiniLineHTML(e)'), 'Kalender-Mini-Ansicht zeigt Fallkontext nicht an.');
assert(html.includes('caseMiniLineHTML(t)'), 'Aufgaben-Mini-Ansicht zeigt Fallkontext nicht an.');
assert(html.includes('caseContextChipHTML(e)'), 'Kalender-Agenda zeigt Fall-Badge nicht an.');
assert(html.includes("esc(itemCaseLabel(t)||'Ohne Fall')"), 'Aufgabenliste zeigt Fallzeile nicht an.');
assert(html.includes('itemTitleWithCase(e,e.title,showCase)'), 'Monatsraster nutzt keinen Fallkontext im Chip.');
assert(html.includes('itemTitleWithCase(e,e.title,shouldShowCaseContext(calFullFilter))'), 'Zeitraster nutzt keinen Fallkontext im Tooltip/Titel.');

console.log('Kalender/Aufgaben: Fallkontext in Alle-Fälle-Ansichten eingebaut; Scriptbestand und Syntax geprüft');
