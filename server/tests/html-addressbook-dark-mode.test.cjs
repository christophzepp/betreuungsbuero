'use strict';

const assert = require('assert');
const { assertScriptInventory } = require('./helpers/html-scripts.cjs');
const fs = require('fs');
const path = require('path');

const files = [
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html')
];

function darkBlock(html) {
  const match = html.match(/<style id="addressbook-dark-mode-v1">[\s\S]*?<\/style>/);
  assert(match, 'Dem Adressbuch fehlt sein Dark-Mode-Stylesheet.');
  return match[0];
}

const htmls = files.map((file) => fs.readFileSync(file, 'utf8'));
const block = darkBlock(htmls[0]);
assert(block.includes('.addressbook-source-note{background:#1c2d38'), 'Die Hinweisleiste im Adressbuch bleibt im Dunkelmodus hell.');
assert(block.includes('.addressbook-toolbar-v154{background:#1b2c37'), 'Der Filterbereich im Adressbuch bleibt im Dunkelmodus hell.');
assert(block.includes('.ab-letterbar{background:#192a35'), 'Die Alphabetleiste bleibt im Dunkelmodus hell.');
assert(block.includes('.addressbook-card{background:#182832'), 'Die Trefferkarten bleiben im Dunkelmodus hell.');
assert(block.includes('.addressbook-card[open] .addressbook-card-summary{background:#203540'), 'Die geöffnete Trefferkarte hebt sich im Dunkelmodus nicht ab.');
assert(block.includes('.addressbook-actions button{background:#1f3441'), 'Die Aktionsschaltflächen der Trefferkarte sind im Dunkelmodus nicht abgestimmt.');
assert(block.includes('.addressbook-editor-note{background:#1b2d38'), 'Der Hinweis im Kontakt-Editor bleibt im Dunkelmodus hell.');
assert(block.includes('.addressbook-editor-grid input'), 'Die Felder des Kontakt-Editors erhalten keine eigene Dunkelmodus-Regel.');

for (const [index, html] of htmls.entries()) {
  assertScriptInventory(html, files[index]);
}

console.log('Adressbuch-Dunkelmodus: Filter, Alphabetleiste, Treffer, Detailansicht und Editor geprüft.');
