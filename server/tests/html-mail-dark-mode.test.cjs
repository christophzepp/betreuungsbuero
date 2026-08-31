'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = [
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html')
];

function mailBlock(html) {
  const match = html.match(/<style id="mailx-style">[\s\S]*?<script id="mailx-client-v1">[\s\S]*?<\/script>/);
  assert(match, 'Mail-Modul fehlt.');
  return match[0];
}
function scriptsOf(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) out.push({ attrs: match[1] || '', body: match[2] || '' });
  return out;
}

const htmls = files.map((file) => fs.readFileSync(file, 'utf8'));
const block = mailBlock(htmls[0]);
assert(block.includes('<style id="mailx-dark-theme-v1">'), 'Dem integrierten Mail-Modul fehlt sein Dark-Mode-Stylesheet.');
assert(block.includes('html[data-theme="dark"] .mx-app{background:#15232d'), 'Postfach-Chrome bleibt im Dunkelmodus nicht dunkel.');
assert(block.includes('html[data-theme="dark"] .mx-card{background:#182832'), 'Konten-Verwaltung bleibt im Dunkelmodus nicht dunkel.');
assert(block.includes('html[data-theme="dark"] .mx-compose{background:#172630'), 'Integrierter Mail-Editor bleibt im Dunkelmodus nicht dunkel.');
assert(block.includes('const MXPO_DARK_CSS='), 'Dem externen Mail-Editor fehlt sein eigenes Dark-Mode-CSS.');
assert(block.includes('function mxMailDark()'), 'Die externe Mailansicht kann die aktuelle Themenwahl nicht erkennen.');
assert(block.includes('function mxMailFrameCSS()'), 'Der Nachrichteninhalt erhält im Dunkelmodus keine abgestimmte Grundfläche.');
assert(block.includes("MXPO_CSS+MXPO_DARK_CSS+(window.__mxAiPopCSS"), 'Das externe Verfassen-Fenster bindet den Dunkelmodus nicht ein.');
assert(block.includes("MXPO_CSS+MXRP_CSS+MXPO_DARK_CSS+(window.__mxAiPopCSS"), 'Die externe Leseansicht bindet den Dunkelmodus nicht ein.');
assert(block.includes("<body class=\"'+(mxMailDark()?'mx-pop-dark':'')+'\">"), 'Externe Fenster erhalten keine passende Theme-Klasse.');
assert(block.includes("<style>'+mxMailFrameCSS()+'</style>"), 'Nachrichten-Iframes verwenden die Themenfarbe nicht.');
assert(block.includes('.mx-pick.mx-case-picker{width:min(440px,calc(100vw - 16px))'), 'Die Fallauswahl besitzt keine ausreichend breite, eigenständige Oberfläche.');
assert(block.includes('Fallzuordnung</strong><small>Der Fallkontext füllt Platzhalter'), 'Die Fallauswahl erklärt ihren Zweck nicht klar.');
assert(block.includes('id="mxComposeCaseSearch" type="search"'), 'Die Fallauswahl lässt sich nicht durchsuchen.');
assert(block.includes('const filter=()=>{'), 'Die Fallauswahl filtert die Fallliste nicht dynamisch.');
assert(block.includes('html[data-theme="dark"] .mx-case-picker .case-switcher-item{color:#e2edf3'), 'Die Auswahlzeilen der Fallauswahl bleiben im Dunkelmodus unlesbar.');
assert(block.includes('html[data-theme="dark"] .mx-case-picker .case-switcher-item.active{background:#315d75'), 'Die aktuelle Fallauswahl ist im Dunkelmodus nicht eindeutig hervorgehoben.');
assert(block.includes("'.po-casehead{padding:10px 12px 8px"), 'Die externe Fallauswahl besitzt keine gegliederte Kopfzeile.');
assert(block.includes("id=\"poCaseSearch\" type=\"search\""), 'Die externe Fallauswahl lässt sich nicht durchsuchen.');
assert(block.includes("<div class=\"po-casegroup\">Ohne Fallbezug</div>"), 'Die externe Fallauswahl trennt Büro- und Fallbezug nicht klar.');
assert(block.includes('const poCaseFilter=()=>{'), 'Die externe Fallauswahl filtert die Fallliste nicht dynamisch.');
assert(block.includes("'.mx-pop-dark .po-casehead{background:#1b2d38"), 'Die Kopfzeile der externen Fallauswahl bleibt im Dunkelmodus hell.');
assert(block.includes('.mx-pop-dark .po-caseitem.active{background:#315d75'), 'Die aktuelle Auswahl im externen Mail-Editor ist im Dunkelmodus nicht eindeutig hervorgehoben.');

for (const [index, html] of htmls.entries()) {
  const scripts = scriptsOf(html);
  assert.equal(scripts.length, 309, `${files[index]}: Scriptblockzahl hat sich verändert.`);
  let js = 0;
  scripts.forEach((script, scriptIndex) => {
    if (/\btype\s*=\s*(['"]?)(?!text\/javascript|application\/javascript|module)\w/i.test(script.attrs)) return;
    js += 1;
    new vm.Script(script.body, { filename: `mail-dark-${index}-${scriptIndex + 1}.js` });
  });
  assert.equal(js, 229, `${files[index]}: JavaScript-Blockzahl hat sich verändert.`);
}

console.log('Mail-Dark-Mode: integriertes Postfach, Konten, Editor und externe Leseansichten geprüft.');
