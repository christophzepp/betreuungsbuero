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

const css = styleBlock('document-info-dark-mode-v2');

test('Dokumenten-Dark-Mode ist auf Informationsdialog und Vorlagenübersicht begrenzt', () => {
  assert.match(css, /html\[data-theme="dark"\] #modal:has\(#modalBody \.export-options-card\)/);
  assert.match(css, /#modal:has\(#modalBody > \.doc-info-note \+ \.button-row\):has\(#modalBody > \.doc-info-actions\)/);
  assert.doesNotMatch(css, /html\[data-theme="dark"\]\s+(?:body|\.main)(?:\s|,|\{)/,
    'Die Korrektur darf keine allgemeine App-Oberfläche überschreiben.');
});

test('Alle Teilflächen aus dem Dokumenten-Informationsdialog werden dunkel gestaltet', () => {
  for (const marker of [
    '.doc-info-badge',
    '.doc-info-grid dt',
    '.doc-info-note',
    '.export-options-card,.doc-options-card',
    '.export-mode-check',
    '.recipient-settings-panel,.phase5-smart-hint',
    '.recipient-preview,.phase5-recipient-preview',
    '.recipient-export-note',
    '#phase5RecipientSummary',
    '.doc-info-actions'
  ]) assert.ok(css.includes(marker), `Dark-Mode-Regel fehlt: ${marker}`);
});

test('Späte Weißregeln für Formfelder und Safari-Selects werden überschrieben', () => {
  assert.match(css, /\.export-config-grid select,[\s\S]*?\.doc-options-card select,[\s\S]*?\.recipient-settings-panel select/);
  assert.match(css, /background:#0f1b24!important/);
  assert.match(css, /color:var\(--doc-info-text\)!important/);
  assert.match(css, /border-color:#4b6272!important/);
  assert.match(css, /color-scheme:dark/);
  assert.match(css, /:is\(select,input,textarea\):disabled\{[\s\S]*?opacity:1!important/);
});

test('Auswahl-, Deaktiviert- und Warnzustände bleiben visuell unterscheidbar', () => {
  assert.match(css, /\.export-mode-check:has\(input:checked\)\{[\s\S]*?background:#20394a!important/);
  assert.match(css, /\.export-mode-check:has\(input:disabled\)\{[\s\S]*?opacity:\.68!important/);
  assert.match(css, /\.phase5-recipient-warning\{[\s\S]*?background:#3a301e!important/);
  assert.match(css, /td span\[style\*="color:#b23"\]\{[\s\S]*?color:#ffaaa0!important/);
});

test('Vorlagenübersicht erhält dunkle Tabelle und lesbare Statusfarben', () => {
  assert.match(css, /table\{[\s\S]*?background:var\(--doc-info-panel\)!important/);
  assert.match(css, /thead\{[\s\S]*?background:#203746!important/);
  assert.match(css, /tbody tr:nth-child\(even\)\{[\s\S]*?background:#192a34!important/);
  assert.match(css, /td a\{[\s\S]*?color:#8fd2f7!important/);
});

