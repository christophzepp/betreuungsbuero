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

const css = styleBlock('einstellungen-dark-mode-v2');

test('Dark-Mode-Korrektur ist auf das einheitliche Einstellungsmenü begrenzt', () => {
  assert.match(css, /html\[data-theme="dark"\] #modal:has\(\.set-app\)/);
  assert.match(css, /--set-dm-panel:#1b2a35/);
  assert.match(css, /--set-dm-text:#ecf3f8/);
  assert.doesNotMatch(css, /html\[data-theme="dark"\]\s+(?:body|\.main)(?:\s|,|\{)/,
    'Die Korrektur darf den übrigen Dark Mode nicht global überschreiben.');
});

test('Navigation, Eingabefelder und harte Inline-Hellwerte werden abgedeckt', () => {
  for (const marker of [
    '.set-nav-btn.aktiv',
    'input:not([type="checkbox"]):not([type="radio"]):not([type="color"])',
    '[style*="background:#fff"]',
    '[style*="background:#f"]',
    '[style*="background:#e"]',
    '[style*="color:#4"]',
    '[style*="color:#7"]'
  ]) assert.ok(css.includes(marker), `Dark-Mode-Grundregel fehlt: ${marker}`);
});

test('Alle in den Screenshots auffälligen Fachansichten besitzen eigene Regeln', () => {
  const marker = {
    'Personen/Unterschriften': ['.sig-admin-item', '.sig-admin-item img', '.sig-admin-badge'],
    'Vorlagen & Formulare': ['.cf-chips button', '.cf-tag.mit', '.cf-kuerzel', '.cf-spalte', '.cf-vorschau', '.cf-leerfeld', '.cf-leerhinweis'],
    'Vorschlagslisten': ['.sreg-left', '.sreg-panel', '.sreg-group-head', '.sreg-item'],
    'Mail-Signatureditor': ['.mx-sigwrap', '.mx-sigbar', '.mx-sigedit'],
    'Versand-Hinweis': ['[style*="color:#8a4d20"]'],
    'KI-Direktverbindung': ['.ai-config-actions', '.ai-security-warning'],
    'Datenschutz': ['.ds-erklaerung', '.ds-vorschlag', '.ds-feld>label', '.ds-warnbanner'],
    'Lokaler Modus': ['.review-card', '[style*="background:#f"]', '[style*="color:#4"]']
  };
  for (const [bereich, selectors] of Object.entries(marker)) {
    for (const selector of selectors) assert.ok(css.includes(selector), `${bereich}: Regel fehlt für ${selector}`);
  }
});

test('Semantische Flächen bleiben im Dunkelmodus unterscheidbar', () => {
  assert.match(css, /\.ai-security-warning[\s\S]*?background:#3b321d!important/);
  assert.match(css, /\.ds-frist\.ok[\s\S]*?background:#183d31!important/);
  assert.match(css, /\.ds-frist\.spaet[\s\S]*?background:#452626!important/);
  assert.match(css, /\.sig-admin-item img[\s\S]*?background:#f8fbfd!important/,
    'Unterschriftenvorschauen müssen für dunkle Tinte papierhell bleiben.');
});

test('Der zuvor weiße KI-Aktionsbalken erhält eine dunkle Fläche', () => {
  assert.match(css, /\.ai-config-actions\{[\s\S]*?background:var\(--set-dm-bg\)!important/);
});

test('Der Formular-Baukasten besitzt drei dunkle Arbeitsbereiche und einen lesbaren Abschnittskopf', () => {
  assert.match(css, /\.cf-spalte\{[\s\S]*?background:var\(--set-dm-panel\)!important/);
  assert.match(css, /\.cf-vorschau\{[\s\S]*?background:#0e1820!important/);
  assert.match(css, /\.cf-vorschau \.paper\{[\s\S]*?background:#192833!important/);
  assert.match(css, /#modalBody \.set-inhalt \.cf-abschnitt>header input\{[\s\S]*?background:transparent!important[\s\S]*?color:#fff!important/);
  assert.match(css, /:is\(\.cf-leerfeld,\.cf-leerhinweis\)\{[\s\S]*?background:#13232d!important/);
});
