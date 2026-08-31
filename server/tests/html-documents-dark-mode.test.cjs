'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = [
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html')
];

function darkBlock(html) {
  const match = html.match(/<style id="documents-dark-mode-v1">[\s\S]*?<\/style>/);
  assert(match, 'Dem Datei-Explorer fehlt sein Dark-Mode-Stylesheet.');
  return match[0];
}
function readerToolbarBlock(html) {
  const match = html.match(/<style id="documents-reader-toolbar-v1">[\s\S]*?<\/style>/);
  assert(match, 'Der Leseansicht fehlt die zusammenhängende Werkzeuggruppe.');
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
const block = darkBlock(htmls[0]);
const toolbar = readerToolbarBlock(htmls[0]);
assert(block.includes('.dok-app,\nhtml[data-theme="dark"] .dok-lese{background:#152630'), 'Explorer und Leseansicht erhalten keine gemeinsame dunkle Arbeitsfläche.');
assert(block.includes('.dok-baum,\nhtml[data-theme="dark"] .dok-ldocs,'), 'Ordnerbaum oder Dokumentliste bleibt im Dunkelmodus hell.');
assert(block.includes('table.dok-tisch{background:#182832'), 'Dateitabelle bleibt im Dunkelmodus hell.');
assert(block.includes('.dok-dlg{background:#182832'), 'Explorer-Dialoge und Einstellungen bleiben im Dunkelmodus hell.');
assert(block.includes('.dok-cfg-scroll .dok-karte label{color:#c3d5de'), 'Beschriftungen der Explorer-Einstellungen sind im Dunkelmodus nicht lesbar.');
assert(block.includes('.dok-dlg:has(.dok-cfg-scroll)>.dok-dlg-fuss{background:#182832'), 'Die feste Fußleiste der Einstellungen bleibt hell.');
assert(block.includes('.dok-doksep{background:#203845'), 'Die Werkzeugleiste der Leseansicht bleibt hell.');
assert(block.includes('.dok-lauf2{background:#101a21'), 'Die Lesefläche um das Originaldokument bleibt hell.');
assert(block.includes('.dok-typ[style*="background:#f0f5fa"]{background:#1f3a4a'), 'Die Ordnersymbole behalten im Dunkelmodus ihre helle Kachel.');
assert(block.includes('.dok-swrap') === false, 'Die Dokumentseite darf nicht erzwungen dunkel eingefärbt werden.');
assert(toolbar.includes('.dok-werkzeuggruppe{display:inline-flex'), 'Die Werkzeuge der Leseansicht werden nicht als gemeinsame Gruppe gehalten.');
assert(htmls[0].includes("+'<span class=\"dok-werkzeuggruppe\" aria-label=\"Anmerkungswerkzeuge\">'"), 'Die Schaltfläche „Formen“ ist nicht mit den übrigen Anmerkungswerkzeugen gruppiert.');

for (const [index, html] of htmls.entries()) {
  assert(
    html.includes('<option value="management"\'+(D.bereich===\'management\'?\' selected\':\'\')+\'>Verwaltung &amp; Sicherungen</option>'),
    `${files[index]}: Der Verwaltungsbereich wird im Datei-Explorer nicht ohne technischen Unterstrich beschriftet.`
  );
  assert(
    !html.includes('>_Verwaltung &amp; Sicherungen</option>'),
    `${files[index]}: Der technische Unterstrich ist im Bereichswähler noch sichtbar.`
  );
  const scripts = scriptsOf(html);
  assert.equal(scripts.length, 309, `${files[index]}: Scriptblockzahl hat sich verändert.`);
  let js = 0;
  scripts.forEach((script, scriptIndex) => {
    if (/\btype\s*=\s*(['"]?)(?!text\/javascript|application\/javascript|module)\w/i.test(script.attrs)) return;
    js += 1;
    new vm.Script(script.body, { filename: `documents-dark-${index}-${scriptIndex + 1}.js` });
  });
  assert.equal(js, 229, `${files[index]}: JavaScript-Blockzahl hat sich verändert.`);
}

console.log('Datei-Explorer-Dunkelmodus: Explorer, Einstellungen und Leseansicht geprüft.');
