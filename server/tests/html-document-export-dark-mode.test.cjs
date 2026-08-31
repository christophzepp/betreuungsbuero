'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

function styleBlock(id) {
  const match = html.match(new RegExp(`<style id="${id}">([\\s\\S]*?)<\\/style>`));
  assert.ok(match, `Stylesheet ${id} fehlt.`);
  return match[1];
}

const css = styleBlock('document-export-dark-mode-v4');

test('Export-Dark-Mode ist auf die beiden Dokumentexport-Renderer begrenzt', () => {
  assert.match(css, /#modalBody\[data-v15721-export="1"\]/);
  assert.match(css, /#modalBody\[data-accounting-unified="1"\]/);
  assert.doesNotMatch(css, /html\[data-theme="dark"\]\s+(?:body|\.main|#printArea)(?:\s|,|\{)/,
    'Die Exportkorrektur darf weder App-Flächen noch Dokumentpapier global überschreiben.');
});

test('Unterschriftenauswahl und Anlagen-Dateifelder erhalten dunkle Oberflächen', () => {
  for (const marker of [
    '.deferred-signature-export',
    '.v15720-source-row .file-display',
    '.accu-file-display,.accstd-file-display',
    '.export-attachment-order-item',
    '.accu-attachment'
  ]) assert.ok(css.includes(marker), `Dark-Mode-Regel fehlt: ${marker}`);
  assert.match(css, /background:var\(--export-dark-control\)!important/);
  assert.match(css, /-webkit-text-fill-color:var\(--export-dark-text\)!important/);
});

test('Adressbuch, Filter und Kontaktaktionen werden vollständig abgedunkelt', () => {
  for (const marker of [
    '.bulk-result-count-chip',
    '.bulk-filter-details summary',
    '.bulk-export-actions button',
    '.bulk-recipient-item',
    '.accu-hit-count',
    '.accu-filterbar',
    '.accu-contact-actions button',
    '.accu-contact'
  ]) assert.ok(css.includes(marker), `Adressbuch-Regel fehlt: ${marker}`);
  assert.match(css, /\.bulk-recipient-item:hover,[\s\S]*?\.accu-contact:hover\{[\s\S]*?background:var\(--export-dark-hover\)!important/);
});

test('Auswahl-, Warn- und Fokuszustände bleiben deutlich erkennbar', () => {
  assert.match(css, /\.document-attachment-export-option\.selected/);
  assert.match(css, /\.accu-output label\.active/);
  assert.match(css, /background:var\(--export-dark-selected\)!important/);
  assert.match(css, /\.document-attachment-export-option strong,[\s\S]*?color:var\(--export-dark-text\)!important/);
  assert.match(css, /:is\(button,select,input\):disabled,[\s\S]*?opacity:\.58!important/);
  assert.match(css, /\.bulk-export-note,[\s\S]*?\.accu-bulk-note\{[\s\S]*?background:#3b311d!important/);
  assert.match(css, /:focus-visible\{[\s\S]*?outline:2px solid #79bff0!important/);
});

test('Inline formatierte Betreff-Werkzeuge werden von späten Weißregeln abgefangen', () => {
  assert.match(css, /\.phase3-grid button\[style\]/);
  assert.match(css, /\.accu-package-grid button\[style\]/);
  assert.match(css, /color:#cfe2ee!important/);
});
