'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = [
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html')
];

function blockOf(html) {
  const match = html.match(/<style id="case-file-finance-dark-mode-v1">[\s\S]*?<\/style>/);
  assert(match, 'Der Dark-Mode-Nachzug für Fallakten und Finanzen fehlt.');
  return match[0];
}
function scriptsOf(html) {
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) scripts.push({ attrs: match[1] || '', body: match[2] || '' });
  return scripts;
}

const htmls = files.map((file) => fs.readFileSync(file, 'utf8'));
const block = blockOf(htmls[0]);

[
  '.cov-shell',
  '.archive-toolbar',
  '.phase4-history-toolbar',
  '.bk2 :is(.bk2-card,.bk2-panel',
  '.va-view .hk-table',
  '.sr-warnbox.info',
  '.hi-ai-upload,.ap-ai-upload',
  '.gdp-shell',
  '.og-tree,.og-ai-suggestions',
  '#modal:has(.km-table,.data-admin-view,.bu-table)',
  ':is(#ciOverlay,#coOverlay) .ci-body',
  '#modal:has(.finance-detail-view,.mileage-view,.qm-wrap)',
  '.finance-upload-zone',
  '.mileage-view .finance-form',
  ':is(.qm-item,.qm-file,.qm-chip,.qm-preset)',
  '#modal:has(.invoice-view,.inbox-view,.of-view)',
  ':is(.invoice-table,.invoice-table tbody,.invoice-table tr,.invoice-table td)',
  '.inbox-doc-card',
  '.of-card',
  '#modal:has(.export-options-card,.ai-profile-grid,.phase6-grid)',
  '#modal:has(.export-options-card) .export-options-card',
  '#modal:has(.ai-profile-grid) .ai-profile-card',
  '#modal:has(.aipl)',
  '#modal:has(.phase6-grid) .phase6-section'
].forEach((needle) => assert(block.includes(needle), `Dark-Mode-Regel für ${needle} fehlt.`));
assert(block.includes('--cfdm-panel-2:#13212b'), 'Der gemeinsame dunkle Flächenfarbton fehlt.');
assert(block.includes('Dokumentseiten/PDFs bleiben absichtlich weiß'), 'Die Ausnahme für originale Dokumentseiten ist nicht dokumentiert.');
assert(block.includes(':is(.cov-card,.cov-filterbox'), 'Fallübersichtskarten bleiben im Dunkelmodus nicht lesbar.');
assert(block.includes('.cov-chip.active,\nhtml[data-theme="dark"] .cov-chip[aria-pressed="true"]{background:#397fa8'), 'Aktive Filterchips der Fallübersicht bleiben im Dunkelmodus nicht sichtbar.');
assert(block.includes('.cov-chip.warn:not(.active):not([aria-pressed="true"]){background:#3b321d'), 'Inaktive Warnfilter werden im Dunkelmodus nicht vom aktiven Zustand abgegrenzt.');
assert(block.includes('.cov-chip:focus-visible{outline:3px solid #9bd8fa'), 'Der Tastaturfokus der Filterchips ist im Dunkelmodus nicht sichtbar.');
assert(block.includes(':is(.archive-empty,.archive-item'), 'Archiv- und Versandkarten bleiben im Dunkelmodus nicht lesbar.');
assert(block.includes('table.bk2-tab tbody'), 'Banking-Umsätze behalten im Dunkelmodus eine helle Tabelle.');
assert(block.includes('.gdp-record:hover,.gdp-record.selected'), 'Ausgewählte Wünsche/Ziele sind im Dunkelmodus nicht hervorgehoben.');
assert(block.includes(':is(.gdp-detail,.gdp-detail-inline){background:var(--cfdm-panel-2)'), 'Die aufgeklappte Detailansicht der Wünsche/Ziele bleibt im Dunkelmodus hell.');
assert(block.includes('.gdp-focus-choice{background:var(--cfdm-panel)'), 'Die Favoriten-Auswahl im Ziele-Editor bleibt im Dunkelmodus hell.');
assert(block.includes('.gdp-history:before{border-color:var(--cfdm-panel-2)'), 'Der Änderungsverlauf der Detailansicht hat im Dunkelmodus keinen abgestimmten Kontrast.');
assert(block.includes('.og-row.og-drag-over'), 'Der Ablageort im Ordnergenerator bleibt im Dunkelmodus nicht sichtbar.');
assert(block.includes('#modal:has(.og-footer)>.modal-box{width:min(930px,96vw)'), 'Der Ordnergenerator nutzt keinen moderat vergrößerten, responsiven Dialograhmen.');
assert(block.includes('#modal:has(.og-footer) .og-tree{max-height:min(480px,calc(94vh - 330px))'), 'Die Ordnerliste nutzt den zusätzlichen Dialograum nicht aus.');
assert(block.includes('/* Fallorganisation: Kontaktmonitor, Fälle, Betreuung und geführte Fallprozesse. */'), 'Die Dark-Mode-Regeln für die Fallorganisation fehlen.');
assert(block.includes('#modal:has(.km-table) :is(.km-intro,.km-logform,.km-verlauf,.km-scroll)'), 'Kontaktmonitor: helle Info-, Eingabe- oder Verlaufsflächen bleiben bestehen.');
assert(block.includes('#modal:has(.data-admin-view) :is(.data-admin-view,.da-section,.da-table-wrap,.calmini-agenda-empty)'), 'Fälle und Fallarchiv behalten im Dunkelmodus helle Verwaltungsflächen.');
assert(block.includes('#modal:has(.bu-table) :is(.review-grid,.review-field,.bu-table-wrap)'), 'Die Betreuungsübersicht behält im Dunkelmodus helle Tabellenflächen.');
assert(block.includes(':is(#ciOverlay,#coOverlay) .ci-body{background:var(--cfdm-bg)'), 'Fallbeginn und Fallabschluss behalten im Dunkelmodus eine helle Arbeitsfläche.');
assert(block.includes(':is(#ciOverlay,#coOverlay) :is(.ci-card,.ci-mod,.ci-row,.ci-doc-exp,.ci-bank-row,.ci-sum-box,.ci-sum-row,.ci-pick,.ci-pickrow,.co-open-pt)'), 'Karten des Fallbeginns oder Fallabschlusses behalten im Dunkelmodus helle Flächen.');
assert(block.includes(':is(#ciOverlay,#coOverlay) :is(.ci-drop,.ci-filelist,.ci-doc){background:var(--cfdm-panel)'), 'Upload- und Dateiflächen werden im Dunkelmodus nicht abgedunkelt.');
assert(block.includes('#coOverlay [style*="background:#fdf8e7"]'), 'Die Aufbewahrungsinformation des Fallabschlusses wird im Dunkelmodus nicht abgedunkelt.');
assert(block.includes('#coOverlay [style*="background:#f2f9f4"]'), 'Die Übergabeinformation des Fallabschlusses wird im Dunkelmodus nicht abgedunkelt.');
assert(block.includes(':is(.finance-detail-table,.finance-detail-table tbody,.finance-detail-table tr,.finance-detail-table td)'), 'Finanz-Detailtabellen behalten im Dunkelmodus helle Zeilen.');
assert(block.includes(':is(.mileage-table,.mileage-table tbody,.mileage-table tr,.mileage-table td)'), 'Fahrtkostentabellen behalten im Dunkelmodus helle Zeilen.');
assert(block.includes('.qm-savebar{\n  background:linear-gradient(rgba(23,36,46,0),var(--cfdm-bg) 34%)'), 'Die feste Speicherleiste des Qualifikationsmanagers bleibt hell.');
assert(block.includes(':is(.inbox-summary,.inbox-retention,.inbox-frist,.inbox-ziel,.inbox-sug-row .sug-stamm,.inbox-ai-drop)'), 'Unterbereiche der Posteingangskarten bleiben im Dunkelmodus hell.');
assert(block.includes('.of-intro{\n  background:#23394a'), 'Die Einleitung der Online-Formulare bleibt im Dunkelmodus hell.');
assert(block.includes('.export-options-card label[style*="background:#f7fafc"]'), 'Die Export-Speicherortoption bleibt im Dunkelmodus hell.');
assert(block.includes('#modalBody>div[style*="background:#fff6e8"]'), 'Der Hinweis der Versandkonten wird im Dunkelmodus nicht abgestimmt.');
assert(block.includes(':is(.ai-capability-note,.ai-security-warning)'), 'Die Hinweisleisten der KI-Direktverbindung bleiben im Dunkelmodus hell.');
assert(block.includes('#modalBody .ai-config-grid .ai-optbox{\n  background:var(--cfdm-panel)'), 'Die Optionskarten der KI-Direktverbindung bleiben im Dunkelmodus hell.');
assert(block.includes('.ai-config-grid>div>label{\n  color:var(--cfdm-muted)'), 'Die Feldbezeichnungen der KI-Direktverbindung sind im Dunkelmodus nicht lesbar.');
assert(block.includes('#modalBody>.button-row{\n  background:var(--cfdm-bg)'), 'Die feste Aktionsleiste der KI-Direktverbindung bleibt im Dunkelmodus hell.');
assert(block.includes('.phase6-grid,.aipl) #modalTitle{\n  color:var(--cfdm-blue)'), 'Die Dialogtitel der neuen Dark-Mode-Bereiche verlieren ihre Akzentfarbe.');
assert(block.includes(':is(.aipl-grp,.aipl-item,.aiplq-block)'), 'Kategorien oder Einträge der Promptbibliothek bleiben im Dunkelmodus hell.');
assert(block.includes(':is(.aipl-ta,.aiplq-add input)'), 'Prompt-Editoren der Promptbibliothek werden im Dunkelmodus nicht angepasst.');
assert(block.includes(':is(.phase6-table,.phase6-table tbody,.phase6-table tr,.phase6-table td)'), 'Die Tabellen der Systemdiagnose bleiben im Dunkelmodus hell.');
assert(block.includes('.phase6-toolbar button.danger'), 'Die gefährliche Diagnoseaktion ist im Dunkelmodus nicht eindeutig erkennbar.');

for (const [index, html] of htmls.entries()) {
  const scripts = scriptsOf(html);
  assert.equal(scripts.length, 309, `${files[index]}: Scriptblockzahl hat sich verändert.`);
  let js = 0;
  scripts.forEach((script, scriptIndex) => {
    if (/\btype\s*=\s*(['"]?)(?!text\/javascript|application\/javascript|module)\w/i.test(script.attrs)) return;
    js += 1;
    new vm.Script(script.body, { filename: `case-file-finance-dark-${index}-${scriptIndex + 1}.js` });
  });
  assert.equal(js, 229, `${files[index]}: JavaScript-Blockzahl hat sich verändert.`);
}

console.log('Dark-Mode: Fallakten-, Finanz- und Übersichtsmenüs geprüft.');
