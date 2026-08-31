const assert = require('assert');
const fs = require('fs');
const path = require('path');

const files = [
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html')
];
const html = files.map(file => fs.readFileSync(file, 'utf8'));

const source = html[0];
const styles = html.map((document, index) => {
  const match = document.match(/<style id="mobile-phone-curation-v2">([\s\S]*?)<\/style>/);
  assert(match, `${files[index]}: Kuratiertes Smartphone-Stylesheet fehlt.`);
  return match[1];
});
const scripts = html.map((document, index) => {
  const match = document.match(/<script id="mobile-online-shell-v1-js">([\s\S]*?)<\/script>/);
  assert(match, `${files[index]}: Smartphone-Shell-Script fehlt.`);
  return match[1];
});
const css = styles[0];

const mobileOnlyContextNotes = [
  'Bild oder PDF; wird wie das Passfoto',
  'Wird verkleinert gespeichert, wandert in alle Fall-Sicherungen',
  'Vermögens- und Schuldenpositionen der betreuten Person',
  'Schulden aus dem Modul „Schuldenregulierung“ erscheinen hier automatisch',
  'Gesundheits- und Medikamentenübersicht',
  'Barbetrag / Taschengeld von',
  'Monatlicher Lebensunterhalt der betreuten Person',
  'Vollständige Schuldenregulierung der betreuten Person'
];
const mobileContextNoteClass = 'mobile-desktop-context-note-v173';

mobileOnlyContextNotes.forEach((fragment) => {
  const textAt = source.indexOf(fragment);
  assert.notStrictEqual(textAt, -1, `Hinweis fehlt weiterhin im Desktop-DOM: ${fragment}`);
  assert.strictEqual(source.lastIndexOf(fragment), textAt, `Hinweis ist nicht eindeutig: ${fragment}`);
  const tagAt = source.lastIndexOf('<', textAt);
  const tagEnd = source.indexOf('>', tagAt);
  const openingTag = source.slice(tagAt, tagEnd + 1);
  assert(
    new RegExp(`class="[^"]*\\b${mobileContextNoteClass}\\b[^"]*"`).test(openingTag),
    `Der mobile Hinweis besitzt nicht seine exklusive Markierung: ${fragment}`
  );
  assert(!/\bhidden(?:\s|=|>)/.test(openingTag), `Der Desktop-Hinweis wurde per hidden entfernt: ${fragment}`);
  assert(!/style="[^"]*display\s*:\s*none/i.test(openingTag), `Der Desktop-Hinweis wurde inline ausgeblendet: ${fragment}`);
});

assert.strictEqual(
  (source.match(new RegExp(`<(?:p|span)\\b[^>]*class="[^"]*\\b${mobileContextNoteClass}\\b[^"]*"`, 'g')) || []).length,
  mobileOnlyContextNotes.length,
  'Die mobile Ausblend-Markierung darf ausschließlich an den acht gewünschten Hinweisen stehen.'
);
assert(
  new RegExp(`html\\.mobile-online-active \\.${mobileContextNoteClass}\\s*\\{\\s*display:\\s*none\\s*!important;\\s*\\}`).test(css),
  'Die acht Kontexttexte müssen ausschließlich im aktiven Smartphone-Profil verschwinden.'
);
[
  'Büro-eigener Kontakt (keinem Fall zugeordnet). Wird im Büro-Adressbuch geführt und in der Büroorganisations-Excel gesichert.',
  'Bitte links eine Person auswählen, um Qualifikation, Einstufung, Fortbildungen, Sonderaufgaben und Nachweise zu erfassen.'
].forEach((fragment) => {
  assert.strictEqual(source.split(fragment).length - 1, 1, `Der zusätzliche mobile Hinweis ist nicht eindeutig im Desktop-DOM erhalten: ${fragment}`);
});
assert(
  source.includes("mobileHideNote:true") &&
  source.includes("opts.mobileHideNote?' mobile-office-contact-note-v174':''") &&
  source.includes('class="qm-empty qm-mobile-selection-hint-v174"') &&
  css.includes('html.mobile-online-active :is(.mobile-office-contact-note-v174,.qm-mobile-selection-hint-v174) {') &&
  css.includes('display: none !important;'),
  'Büro-Kontakthinweis und leere Qualifikationsauswahl dürfen ausschließlich mobil ausgeblendet werden.'
);

[
  'html.mobile-online-active #modal > .modal-box',
  'html.mobile-online-active table.mobile-card-table',
  'html.mobile-online-active .cc2-rail',
  'html.mobile-online-active .cc2-inputrow',
  'html.mobile-online-active .ai-workbench-main',
  'html.mobile-online-active .mx-app',
  'html.mobile-online-active .cal-view-switch',
  'html.mobile-online-active .ci-steps',
  'html.mobile-online-active .admin-shell',
  'html.mobile-online-active .dok-such',
  'html.mobile-online-active .dok-lese',
  'html.mobile-online-active #caseReviewHeading .case-review-heading-desktop',
  'html.mobile-online-active #caseReviewHeading .case-review-heading-mobile',
  'html.mobile-online-active #caseReviewIntro',
  'html.mobile-online-active #caseReview .master-import-summary-v156',
  'html.mobile-online-active #caseReview .master-table-v156.mobile-card-table',
  'html.mobile-online-active .person-contact-editor-shell',
  'html.mobile-online-active .person-contact-editor-actions',
  'html.mobile-online-active .social-network-editor-shell',
  'html.mobile-online-active .social-network-editor-actions',
  'html.mobile-online-active #modalBody .mobile-contact-pair.mobile-contact-pair-phone',
  'html.mobile-online-active #reviewWarnings',
  'html.mobile-online-active #startPrivacyHint',
  'html.mobile-online-active #startPage[data-mobile-start-view="start"] .start-shell > :not(#startTodayOverview):not(#mobileStartCasePicker):not(#mobileStartQuickActions)',
  'html.mobile-online-active #startPage[data-mobile-start-view="master-data"] #startTodayOverview',
  'html.mobile-online-active #startPage[data-mobile-start-view="start"] #startTodayOverview',
  'html.mobile-online-active #startPage[data-mobile-start-view="start"] #mobileStartCasePicker',
  'html.mobile-online-active #mobileStartCasePicker > select:focus',
  'html.mobile-online-active #startPage[data-mobile-start-view="start"] #mobileStartQuickActions',
  'html.mobile-online-active #mobileStartQuickActions .mobile-start-quick-grid > .cov-quick-grid',
  '.doku-filter-grid-v162',
  '.fr-grid',
  /* 28.08.2026: Das aeussere Raster .da-grid der Datenadministration ist entfallen (Variante B -
     jede Karte volle Breite, innen Import links / Export rechts). Der Mobil-Vertrag gilt jetzt
     dem INNEREN Raster: auf dem Telefon muss auch das einspaltig werden. */
  '.da-karte-zwei',
  '.addressbook-toolbar-v154',
  '.of-toolbar',
  'overflow-x: clip !important'
].forEach(contract => assert(css.includes(contract), `Mobile-Vertrag fehlt: ${contract}`));

assert(
  source.includes('addressbook-action-row-case') &&
    css.includes('grid-template-columns: repeat(5, minmax(0, 1fr)) !important;') &&
    css.includes('font-size: 10.5px !important;') &&
    css.includes("content: 'Duplikate';"),
  'Die fünf Aktionen des mobilen Fall-Adressbuchs müssen kompakt in einer Zeile stehen.'
);
assert(
  source.includes('addressbook-action-row-wide') &&
    css.includes('.addressbook-action-row-wide {') &&
    css.includes('flex-wrap: nowrap !important;') &&
    css.includes("content: '+ Büro';") &&
    css.includes("content: 'Online ↑';") &&
    css.includes('.addressbook-select-row-wide {'),
  'Auch das büroweite Adressbuch benötigt kompakte einzeilige mobile Aktionen.'
);
assert(
  source.includes('addressbook-mobile-filter-toggle') &&
    source.includes('window.__abToggleMobileFilters=function(button)') &&
    source.includes("classList.toggle('addressbook-mobile-filters-collapsed'") &&
    css.includes('#modal.addressbook-mobile-filters-collapsed') &&
    css.includes('.addressbook-toolbar-v154 {\n    display: none !important;'),
  'Die Adressbuchfilter müssen mobil standardmäßig einklappbar sein.'
);
assert(
  source.includes('addressbook-select-row-case') &&
    css.includes('grid-template-columns: repeat(4, minmax(0, 1fr)) !important;') &&
    css.includes("content: 'Beendet';"),
  'Die vier mobilen Auswahl- und Statusaktionen müssen in einer Zeile stehen.'
);
assert(
  css.includes('#modalBody.mobile-top-view-body-v171 .addressbook-source-note') &&
    css.includes('grid-template-columns: repeat(27, minmax(0, 1fr)) !important;') &&
    css.includes('.ab-letterbar > :is(button.ab-letter,span.ab-letter)') &&
    css.includes('font-size: 9.5px !important;'),
  'Mobil muss der Adressbuch-Hinweis verschwinden und die Alphabetleiste einzeilig bleiben.'
);

assert(
  source.includes('<span class="case-review-heading-mobile">Stammdaten</span>'),
  'Die mobile Stammdaten-Überschrift muss auf „Stammdaten“ verkürzt sein.'
);
assert(
  source.includes('class="btn light todo-import-ics-btn"') &&
  css.includes('.todo-full-toolbar > .todo-import-ics-btn') &&
  css.includes('justify-content: center !important;') &&
  css.includes('text-align: center !important;'),
  '„ICS importieren“ muss in der mobilen Aufgabenleiste dauerhaft zentriert sein.'
);
assert(
  css.includes('#modal.todo-mobile-form-open[data-mobile-view-profile="workspace"] #modalBody.mobile-top-view-body-v171') &&
    css.includes('#modal.todo-mobile-form-open[data-mobile-view-profile="workspace"] .todo-full-list') &&
  css.includes('#modal.todo-mobile-form-open[data-mobile-view-profile="workspace"] #todoFullNewForm') &&
  css.includes('#modal.todo-mobile-form-open[data-mobile-view-profile="workspace"] .todo-editor') &&
  css.includes('height: 100% !important;') &&
  css.includes('overflow-y: auto !important;') &&
  css.includes('margin-top: auto !important;'),
  '„Aufgabe bearbeiten“ muss mobil den vollständigen Arbeitsbereich füllen und nur das Formular scrollen.'
);
assert(
  source.includes('class="attach-upload-btn pending-file-explorer-btn"') &&
    css.includes('#todoFullNewForm .pending-file-explorer-btn') &&
    css.includes('display: none !important;'),
  '„Aus Datei-Explorer“ muss im mobilen Aufgabenformular ausgeblendet bleiben.'
);
assert(
  source.includes('class="fr-toolbar fr-toolbar-main"') &&
    source.includes('class="fr-filter-search"') &&
    css.includes('.fr-toolbar-main > .fr-filter-search') &&
    css.includes('grid-column: 1 / -1 !important;') &&
    css.includes('.fr-toolbar-main :is(select,input[type="search"])') &&
    css.includes('height: 42px !important;'),
  'Fall, Zeitraum und die vollbreite Suche benötigen eine stabile mobile Fristen-Filterzone.'
);
assert(
  source.includes('class="fr-row-actions"') &&
    source.includes('fr-action-done') &&
    source.includes('fr-action-edit') &&
    css.includes('.fr-row-actions .fr-action-edit {\n    display: inline-flex !important;\n    align-items: center !important;\n    justify-content: center !important;') &&
    css.includes('min-width: 88px !important;') &&
    css.includes('text-align: center !important;') &&
    css.includes('white-space: nowrap !important;') &&
    css.includes('.fr-row-actions .fr-action-done { order: 2; }') &&
    css.includes('justify-content: flex-end !important;'),
  '„Bearbeiten“ muss mobil einzeilig vor „Erledigt“ stehen und die Aktionsgruppe rechts ausgerichtet sein.'
);
assert(
  css.includes('.fr-derived .fr-meta > button') &&
    css.includes('margin-left: auto !important;'),
  '„Übernehmen“ muss bei abgeleiteten Fristen mobil rechtsbündig stehen.'
);
assert(
  scripts[0].includes("const deadlineScroller = workspaceView.querySelector('.fr-view #frList');") &&
    scripts[0].includes("return { mode: 'gate', scroller: deadlineScroller || workspaceView.querySelector('#modalBody.mobile-top-view-body-v171') };") &&
    scripts[0].includes('} else if (delta > 10 && current > 72) {') &&
    scripts[0].includes('if (current < 28 || delta < -8) {'),
  'Die mobile Navigation muss dem eigenen Fristen-Scroller folgen: abwärts ausblenden, aufwärts einblenden.'
);
assert(
  source.includes("modal.classList.toggle('fr-mobile-editor-open',editorOpen)") &&
    css.includes('#frList') &&
    css.includes('overscroll-behavior: contain !important;') &&
    css.includes('#modal.fr-mobile-editor-open[data-mobile-view-profile="workspace"]') &&
    css.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;') &&
    css.includes('overflow: hidden !important;'),
  'Fristenliste und kompakte Vollseiten-Bearbeitung benötigen getrennte mobile Scrollzustände.'
);
assert(
  source.includes('class="button-row mileage-primary-actions"') &&
    source.includes('class="btn light mileage-filter-reset"') &&
    source.includes('class="mileage-actions mileage-bulk-actions"') &&
    css.includes('.mileage-filters {\n    display: grid !important;\n    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;') &&
    css.includes('.mileage-bulk-actions > .danger') &&
    css.includes('grid-column: 1 / -1 !important;'),
  'Fahrtenbuch-Filter, Hauptaktion und Sammelaktionen benötigen eine kompakte mobile Hierarchie.'
);
assert(
  source.includes('class="mileage-actions mileage-trip-actions"') &&
    source.includes('class="mileage-route-lines"') &&
    source.includes('data-mileage-empty=') &&
    css.includes('.mileage-trip-actions {') &&
    css.includes('grid-template-columns: repeat(4, minmax(0, 1fr)) !important;') &&
    css.includes('grid-auto-rows: 38px !important;') &&
    css.includes('.mileage-route-lines > div {') &&
    css.includes('text-align: left !important;') &&
    css.includes('td[data-mileage-empty="true"]'),
  'Mobile Fahrtenkarten müssen Leerfelder ausblenden, Von/Nach linksbündig halten und alle vier gleich hohen Zeilenaktionen nebeneinander zeigen.'
);
assert(
  source.includes('class="mileage-year-head"') &&
    source.includes('mileage-export-driver') &&
    source.includes('mileage-summary-km') &&
    source.includes('mileage-summary-amount') &&
    css.includes('.mileage-export-actions {') &&
    css.includes("content: 'Kilometer' !important;") &&
    css.includes("content: 'Erstattung' !important;"),
  'Jahres-Exporte und Summen müssen im mobilen Fahrtenbuch korrekt gruppiert und beschriftet sein.'
);
assert(
  source.includes("mileageModal.classList.toggle('mileage-mobile-form-open',mileageFormOpen&&document.documentElement.classList.contains('mobile-online-active'))") &&
    css.includes('#modal.mileage-mobile-form-open[data-mobile-view-profile="workspace"]') &&
    css.includes('.mileage-view > :is(.finance-form,.mileage-primary-actions,.mileage-filters,.mileage-bulk-actions,.modal-scroll)') &&
    css.includes('.mileage-form > .review-grid:nth-of-type(1) {\n    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;') &&
    css.includes('.mileage-tools-row {\n    display: grid !important;\n    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;') &&
    css.includes('.mileage-form-footer {\n    display: grid !important;') &&
    css.includes('align-items: flex-start !important;') &&
    css.includes('flex: 0 0 auto !important;') &&
    css.includes('height: auto !important;') &&
    css.includes('margin: 0 !important;') &&
    css.includes('overflow: hidden !important;'),
  'Neue und bearbeitete Fahrten müssen mobil als vollständig sichtbare, nicht scrollende Vollbildmaske ohne künstlichen Leerraum vor den Abschlussaktionen erscheinen.'
);
assert(
  source.includes('class="button-row invoice-primary-actions"') &&
    css.includes('.invoice-primary-actions {\n    display: grid !important;\n    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;') &&
    css.includes('.invoice-primary-actions > :first-child {\n    grid-column: 1 / -1 !important;') &&
    css.includes('.invoice-primary-actions > .btn {\n    width: 100% !important;'),
  'Die mobile Ausgangsrechnungsleiste muss Neue Rechnung vollbreit und beide Exporte gemeinsam in der zweiten Zeile zeigen.'
);
assert(
  source.includes('class="cal-view-switch bu-scope-switch"') &&
    css.includes('.bu-scope-switch {\n    display: grid !important;\n    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;') &&
    css.includes('.cal-view-switch.bu-scope-switch {\n    display: grid !important;\n    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;\n    gap: 0 !important;') &&
    css.includes('.bu-scope-switch > button {\n    width: 100% !important;') &&
    css.includes('max-width: none !important;\n    flex: none !important;'),
  'Aktuelle Fälle und Archiv müssen in der mobilen Betreuungsübersicht die gesamte Zeile fugenlos und exakt hälftig teilen.'
);
assert(
  source.includes("class=\"km-row km-status-'+att(r.status.k)+'\"") &&
    source.includes('class="km-due-content"') &&
    source.includes('class="km-due-date"') &&
    css.includes('.km-switch > select {\n    box-sizing: border-box !important;\n    height: 46px !important;') &&
    css.includes('.km-table.mobile-card-table .km-row {\n    padding: 8px 10px !important;') &&
    css.includes('.km-row.km-status-over {\n    border-left-color: #c83b32 !important;') &&
    css.includes('.km-due-content {\n    display: flex !important;') &&
    css.includes('.km-due-content > .fr-badge {\n    display: inline-flex !important;') &&
    css.includes('.km-row > .km-actions {\n    min-height: 42px !important;'),
  'Der mobile Kontaktmonitor benötigt eine einheitlich hohe Fallauswahl und klar gegliederte Statuskarten.'
);
assert(
  source.includes('class="ap-intro"') &&
    css.includes('.ap-intro {\n    display: none !important;') &&
    css.includes('.ap-foot > .btn,\n  html.mobile-online-active #modalBody.mobile-top-view-body-v171 .ap-foot > span > .btn {') &&
    css.includes('height: 68px !important;\n    min-height: 68px !important;'),
  'Der Erklärungstext muss mobil verschwinden und alle drei Genehmigungsaktionen müssen exakt gleich hoch sein.'
);
assert(
  source.includes("invoiceModal.classList.toggle('invoice-mobile-form-open',invoiceFormOpen&&document.documentElement.classList.contains('mobile-online-active'))") &&
    source.includes('class="finance-form invoice-form"') &&
    source.includes('class="button-row invoice-form-footer"') &&
    source.includes('class="button-row invoice-primary-actions"') &&
    css.includes('#modal.invoice-mobile-form-open[data-mobile-view-profile="workspace"]') &&
    /* Die Vergütungs-Pipeline (25.08.2026) gehoert in dieselbe Ausblendliste - sonst schiebt sie
       im Formular-Vollbild die Fusszeile mit Speichern/Abbrechen aus dem Bild. */
    css.includes('.invoice-view > :is(.invoice-primary-actions,.invoice-pipeline,.finance-filter-row,.invoice-table-wrap)') &&
    css.includes('.invoice-form > .review-grid.mobile-stack-grid {\n    display: grid !important;\n    grid-template-columns: minmax(0, 1fr) !important;') &&
    css.includes('.invoice-form .review-field {\n    display: grid !important;\n    grid-template-columns: minmax(118px, 34%) minmax(0, 1fr) !important;') &&
    css.includes('height: 36px !important;\n    min-height: 36px !important;') &&
    css.includes('.invoice-form-footer {\n    display: grid !important;\n    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;') &&
    css.includes('#invoiceFormArea {\n    display: flex !important;') &&
    css.includes('overflow: hidden !important;'),
  'Neue und bearbeitete Ausgangsrechnungen müssen mobil als vollständig sichtbare, nicht scrollende Vollbildmaske erscheinen.'
);
assert(
  source.includes('id="mobileStartCasePicker"') &&
  source.includes('data-mobile-start-case-select') &&
  source.includes('startCaseOptionsHTML: startCaseOptionsHtml') &&
  source.includes('selectStartCase,') &&
  scripts[0].includes('renderMobileStartCasePicker()') &&
  scripts[0].includes("api.selectStartCase(requested)"),
  'Die mobile Startseite benötigt einen echten Fallwechsler, der den geöffneten Fall aktualisiert.'
);
assert(
  source.includes('id="mobileStartQuickActions"') &&
  source.includes('data-mobile-start-quick-grid') &&
  source.includes('quickActionsHTML: rightHtml') &&
  scripts[0].includes("mobileStartView = 'start'") &&
  scripts[0].includes("startPage.dataset.mobileStartView = mobileStartView") &&
  scripts[0].includes("api.quickActionsHTML()"),
  'Die neue mobile Startseite muss die bestehende Übersicht mit dem zentralen Schnellaktionskatalog verbinden.'
);
assert(
  source.includes("document.querySelector('#startPage[data-mobile-start-view=\"start\"] #mobileStartQuickActions')") &&
  source.includes("overlay.classList.add('cov-start-action-overlay')"),
  'Schnellaktionen der mobilen Startseite müssen ihre Aktionsdialoge direkt aus der Startansicht öffnen können.'
);
assert(
  source.includes('class="master-table-v156 mobile-card-table'),
  'Bearbeitbare Stammdaten-Tabellen müssen für die mobile Kartenansicht markiert sein.'
);
assert(
  source.includes('data-mobile-label="${escAttr(label)}"'),
  'Stammdatenfelder benötigen ihre Feldbezeichnung für die mobile Kartenansicht.'
);
assert(
  source.includes("?'Kontaktdaten bearbeiten':'Kontaktdaten der betroffenen Person bearbeiten'"),
  'Der Kontakteditor benötigt auf Smartphones eine kurze Überschrift.'
);
assert(
  source.includes("mobile?(index>=0?'Kontakt bearbeiten':'Kontakt hinzufügen')"),
  'Der Editor des Sozialen Netzwerks benötigt auf Smartphones eine kurze Überschrift.'
);
assert(
  source.includes("hasMultipleActions=path==='banks'") &&
  css.includes('td.master-row-actions-v156.has-single-action-v156'),
  'Eine einzelne Löschaktion muss mobil als kompakter Icon-Button statt als breite Aktionszeile erscheinen.'
);
assert(
  source.includes('class="master-provision-type-v156"') &&
  source.includes('data-combo="provision_types_v156"') &&
  source.includes('changeProvisionTypeV156') &&
  !source.includes('id="provisionAddSelectV156"'),
  'Die Vorsorge-Dokumentart muss direkt im Feld „Art“ auswählbar sein; ein separates Hinzufügen-Dropdown ist nicht vorgesehen.'
);
assert(
  source.includes("provision_types_v156:['Stammdaten','Vorsorge- und Sterbeangelegenheiten – Dokumentart']") &&
  source.includes("['Stammdaten – Vorsorge']=['provision_types_v156']"),
  'Die Dokumentart der Vorsorge muss im zentralen Vorschlagslisten-Katalog benannt und dauerhaft angemeldet sein.'
);
assert(
  source.includes('data-pc-panel="address"') &&
  source.includes('data-pc-panel="contact"') &&
  !source.includes('data-pc-tab="address"'),
  'Der mobile Kontakteditor muss Anschrift und Kontakt gemeinsam kompakt anzeigen, ohne leere Tab-Ansicht.'
);
[
  ['pcHouseLetter','id="pcHouseLetter" data-combo="sd_hausbuchstabe"'],
  ['pcPostal',"pcField('pcPostal','PLZ',p.postal||p.postalCode,false,'text','sd_plz')"],
  ['pcCity',"pcField('pcCity','Ort',p.city,false,'text','sd_ort')"],
  ['pcCountry',"pcField('pcCountry','Land',p.country,false,'text','sd_land')"],
  ['pcForeignCity',"pcField('pcForeignCity','Ort (Ausland)',p.foreignCity,true,'text','sd_ort')"],
  ['pcInstitution',"pcField('pcInstitution','Institution',p.institution,true,'text','sd_institution')"],
  ['pcLandlineArea','id="pcLandlineArea" data-combo="sd_vorwahl_festnetz"'],
  ['pcMobileArea','id="pcMobileArea" data-combo="sd_vorwahl_mobil"'],
  ['pcFaxArea','id="pcFaxArea" data-combo="sd_vorwahl_festnetz"']
].forEach(([id,contract])=>assert(
  source.includes(contract),
  `Kontaktfeld ${id} muss an seine zentrale Vorschlagsliste angeschlossen sein.`
));
assert(
  css.includes('html.mobile-online-active .person-contact-editor-scroll') &&
  css.includes('overflow: visible !important;'),
  'Der mittlere Bereich des Personen-Kontakteditors darf mobil kein eigener Scrollcontainer sein.'
);
assert(
  css.includes('html.mobile-online-active:has(#modal:not(.hidden) .person-contact-editor-shell) :is(.main,.start-shell)') &&
  css.includes('overscroll-behavior: none !important;'),
  'Das geöffnete mobile Kontaktmenü muss Scroll-Chaining auf den verdeckten Arbeitsbereich sperren.'
);
assert(
  css.includes('html.mobile-online-active:has(#modal:not(.hidden) .social-network-editor-shell) .mobile-online-shell.is-hidden') &&
  scripts[0].includes("document.querySelector('#modal:not(.hidden) :is(.social-network-editor-shell, .cc2)')") &&
  scripts[0].includes("shell.classList.remove('is-hidden');"),
  'Beim Scrollen im Sozialen Netzwerk muss die untere mobile Hauptnavigation sichtbar bleiben.'
);
assert(
  source.includes('class="cc2-icon cc2-close"') &&
  css.includes('html.mobile-online-active #modal:has(.cc2) > .modal-box > .modal-actions') &&
  css.includes('html.mobile-online-active .cc2-close') &&
  css.includes('html.mobile-online-active #modal:has(.cc2) #modalBody') &&
  css.includes('html.mobile-online-active .cc2-log') &&
  css.includes('overscroll-behavior: contain;'),
  'Der mobile KI-Fallchat muss ohne Schließbereich auskommen und ausschließlich den Gesprächsverlauf scrollen.'
);
assert(
  css.includes('html.mobile-online-active .cc2-subrow .ai-security-warning') &&
  css.includes('display: none !important;'),
  'Der Datenschutz-Erklärtext unter der KI-Eingabe muss auf Smartphones ausgeblendet sein.'
);
assert(
  css.includes('html.mobile-online-active:has(#modal:not(.hidden) .cc2) .mobile-online-shell.is-hidden') &&
  scripts[0].includes(':is(.social-network-editor-shell, .cc2)') &&
  scripts[0].includes("shell.classList.remove('is-hidden');"),
  'Beim Scrollen im KI-Fallchat muss die untere mobile Hauptnavigation sichtbar bleiben.'
);
assert(
  css.includes('html.mobile-online-active .cc2-main > .ai-prompt-wrap .ai-prompt-chips') &&
  css.includes('flex-wrap: nowrap !important;') &&
  css.includes('overflow-x: hidden !important;') &&
  css.includes('min-height: 28px !important;') &&
  css.includes('.pc:nth-child(5):not(.add)') &&
  css.includes('max-width: 56px !important;') &&
  css.includes('flex: 0 0 28px !important;'),
  'Die Schnellprompts des mobilen KI-Fallchats muessen kompakt in eine Zeile passen und das Plus stets sichtbar lassen.'
);
assert(
  source.includes('function mobileTabsHtml(followupCount)') &&
  source.includes("tab('list','Liste')") &&
  source.includes("tab('followups','Wiedervorlagen',followupCount)") &&
  source.includes("tab('quick','Schnellaktionen')") &&
  source.includes('data-mobile-tab="${a(S.mobileTab)}"') &&
  source.includes("setMobileTab(tab){"),
  'Die mobile Fallübersicht muss Liste, Wiedervorlagen und Schnellaktionen als drei Tabs anbieten.'
);
assert(
  source.includes("S.filtersOpen=false;") &&
  source.includes("S.mobileTab=['list','followups','quick'].includes(initialMobileTab)?initialMobileTab:'list';") &&
  source.includes("return openCaseOverview(true,'followups');"),
  'Die mobile Fallübersicht muss mit eingeklappten Filtern starten und direkte Wiedervorlagen-Aufrufe im passenden Tab öffnen.'
);
assert(
  css.includes('html.mobile-online-active .cov-shell[data-mobile-tab="list"] .cov-main') &&
  css.includes('html.mobile-online-active .cov-shell[data-mobile-tab="followups"] .cov-left') &&
  css.includes('html.mobile-online-active .cov-shell[data-mobile-tab="quick"] .cov-right') &&
  css.includes('html.mobile-online-active .cov-footer') &&
  css.includes('.cov-shell[data-mobile-tab="quick"]) .mobile-online-shell.is-hidden') &&
  css.includes('Der Abstand der\n     Betreuungsübersicht bleibt konstant.') &&
  scripts[0].includes("const overview = document.querySelector('#modal:not(.hidden) .cov-shell');") &&
  scripts[0].includes("if (tab === 'quick')") &&
  scripts[0].includes("tab === 'followups' ? '.cov-follow-list' : '.cov-main'") &&
  source.includes("mobileShell.classList.remove('is-hidden');"),
  'Liste und Wiedervorlagen der mobilen Fallübersicht müssen die Navigation richtungsabhängig ausblenden; in Schnellaktionen bleibt sie sichtbar.'
);
assert(
  css.includes('html.mobile-online-active .cov-shell[data-mobile-tab="list"] .cov-main') &&
  css.includes('overflow-y: auto !important;') &&
  css.includes('html.mobile-online-active .cov-shell[data-mobile-tab="list"] .cov-list') &&
  css.includes('overflow: visible !important;') &&
  source.includes("const listSelector=document.documentElement.classList.contains('mobile-online-active')?'.cov-main':'.cov-list';"),
  'In der mobilen Listenansicht müssen Suche, Filter, Klappwerkzeuge und Einträge in einem gemeinsamen Inhaltsbereich scrollen.'
);
assert(
  css.includes('Fallwechsler erhalten appweit dieselbe gut erreichbare Smartphone-Touchhöhe.') &&
  (source.match(/mobile-case-picker-v171/g) || []).length >= 10 &&
  css.includes('.mobile-case-picker-v171') &&
  css.includes('.start-today-scope button') &&
  css.includes('.ab-case-switcher select') &&
  css.includes('#covMobileCasePicker') &&
  css.includes('#gdpCase') &&
  css.includes('height: 48px !important;') &&
  css.includes('min-height: 48px !important;') &&
  css.includes('max-height: 48px !important;') &&
  css.includes('grid-template-columns: minmax(0, 1fr) 48px;') &&
  css.includes('html.mobile-online-active .cov-mobile-refresh') &&
  css.includes('height: 48px !important;'),
  'Alle mobilen Fallwechsler und das globale Aktualisieren-Symbol der Fallübersicht müssen verbindlich dieselbe 48-px-Touchhöhe besitzen.'
);
assert(
  source.includes('class="cov-mobile-case-row"') &&
  source.includes('class="cov-btn cov-mobile-refresh"') &&
  source.includes('class="cov-btn cov-mobile-list-pdf"') &&
  !source.includes('<div class="cov-mobile-quick-tools">') &&
  css.includes('html.mobile-online-active .cov-mobile-case-row') &&
  css.includes('html.mobile-online-active .cov-follow-card') &&
  css.includes('max-height: none !important;') &&
  css.includes('html.mobile-online-active :is(.cov-follow-done,.cov-follow-snooze)') &&
  css.includes('html.mobile-online-active .cov-follow-meta') &&
  css.includes('html.mobile-online-active .cov-follow-context') &&
  css.includes('min-height: 50px !important;') &&
  css.includes('padding: 6px 94px 6px 8px !important;') &&
  css.includes('right: 51px !important;') &&
  css.includes('html.mobile-online-active .cov-follow-source') &&
  css.includes('display: none !important;') &&
  source.includes('class="cov-follow-date"') &&
  source.includes('class="cov-follow-case"') &&
  source.includes('class="cov-follow-context"') &&
  css.includes('html.mobile-online-active .cov-list-primary-tools'),
  'Wiedervorlagen müssen mobil die verfügbare Höhe nutzen, kompakte Metazeilen sowie nebeneinanderliegende Verlängern-/Erledigt-Aktionen besitzen; PDF gehört in die Liste und Aktualisieren als globale Icon-Aktion zur Fallauswahl.'
);
assert(
  source.includes('class="cov-icon-btn cov-followup-complete"') &&
  source.includes('class="cov-icon-btn cov-followup-delete"') &&
  source.includes('class="cov-prio cov-follow-inline-status') &&
  css.includes('html.mobile-online-active .cov-entry-follow .cov-actions') &&
  css.includes('html.mobile-online-active .cov-entry-follow .cov-case-pill') &&
  css.includes('width: max-content;') &&
  css.includes('html.mobile-online-active .cov-entry-follow .cov-facts') &&
  css.includes('grid-template-columns: repeat(3, minmax(0, 1fr)) !important;') &&
  css.includes('grid-template-columns: repeat(3, 36px) !important;') &&
  css.includes('"toggle kind title actions"') &&
  css.includes('". meta meta meta" !important;') &&
  css.includes('html.mobile-online-active .cov-entry-follow .cov-actions .cov-followup-delete') &&
  css.includes('background: #b43b35 !important;') &&
  css.includes('order: 2;') &&
  css.includes('grid-column: auto !important;') &&
  css.includes('html.mobile-online-active .cov-entry-follow .cov-actions .cov-followup-complete') &&
  css.includes('order: 3;') &&
  css.includes('background: #eaf6ed !important;'),
  'In mobilen Vorgangskarten müssen Verlängern, rotes Löschen und grünes Erledigt in einer Zeile stehen; Titel und Metadaten benötigen getrennte Zeilen, die Fall-Elipse bleibt inhaltsbreit und die Kerndaten stehen nebeneinander.'
);
assert(
  source.includes("overlay.dataset.followupId=String(todo.id);") &&
  source.includes('.cov-action-panel{width:min(610px,calc(100% - 30px));max-height:min(720px,calc(100% - 36px));') &&
  css.includes('html.mobile-online-active #covActionOverlay[data-followup-id] {') &&
  css.includes('html.mobile-online-active #covActionOverlay[data-followup-id] > .cov-action-panel {') &&
  css.includes('height: 100% !important;') &&
  css.includes('max-height: none !important;') &&
  css.includes('border-radius: 0 !important;') &&
  css.includes('html.mobile-online-active #covActionOverlay[data-followup-id] .cov-action-body {') &&
  css.includes('flex: 1 1 0 !important;') &&
  css.includes('overflow-y: auto !important;'),
  '„Wiedervorlage bearbeiten“ muss nur mobil die volle Arbeitsfläche nutzen; die zentrierte Desktop-Karte bleibt erhalten.'
);
assert(
  source.includes('class="doku-mobile-list-shell-v170"') &&
  source.includes('id="dokuListBody" class="doku-mobile-scroll-v170"') &&
  css.includes('html.mobile-online-active #modal:has(.doku-mobile-list-shell-v170) > .modal-box') &&
  css.includes('html.mobile-online-active .doku-mobile-scroll-v170') &&
  css.includes('flex: 1 1 0 !important;') &&
  css.includes('html.mobile-online-active .doku-mobile-scroll-v170 .doku-list-v161') &&
  css.includes('max-height: none !important;') &&
  scripts[0].includes("const documentation = document.querySelector('#modal:not(.hidden) .doku-mobile-list-shell-v170');") &&
  scripts[0].includes("documentation.querySelector('.doku-mobile-scroll-v170')"),
  'Die mobile Falldokumentation muss einen einzigen Vollhöhen-Scroller für Suche, Filter, Klappwerkzeuge und Liste verwenden.'
);
assert(
  css.includes('html.mobile-online-active #modal:has(.doku-mobile-list-shell-v170) > .modal-box > .modal-actions') &&
  css.includes('calc(76px + env(safe-area-inset-bottom, 0px)) !important;') &&
  scripts[0].includes("if (probe.mode === 'gate' && (!probe.scroller || target !== probe.scroller)) return;"),
  'Die mobile Falldokumentation darf keinen Schließen-Fuß zeigen und muss die Navigation richtungsabhängig ein-/ausblenden.'
);
assert(
  source.includes('class="master-row-remove-v156 doku-entry-delete-v170"') &&
  css.includes('html.mobile-online-active .doku-entry-year-v162::before') &&
  css.includes("content: '▸';") &&
  css.includes('html.mobile-online-active .doku-entry-actor-v162') &&
  css.includes('height: 32px !important;') &&
  css.includes('html.mobile-online-active .doku-entry-actions-v161 .doku-entry-delete-v170') &&
  css.includes('background: #fff1f0 !important;'),
  'Dokumentationskarten müssen mobil Datum und Pfeil in einer Ellipse, den Titel in neuer Zeile sowie vier kompakte Aktionen mit rotem Löschen zeigen.'
);
assert(
  source.includes('class="doku-entry-form-shell-v170"') &&
  source.includes('addressbook-editor-grid doku-entry-form-grid-v170') &&
  source.includes('button-row doku-entry-form-actions-v170') &&
  css.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;') &&
  css.includes('html.mobile-online-active .doku-entry-form-grid-v170 textarea.doku-note-autogrow-v162') &&
  css.includes('html.mobile-online-active .doku-entry-form-actions-v170') &&
  scripts[0].includes('.doku-entry-form-shell-v170'),
  'Der mobile Dokumentationseintrag muss als kompaktes Zweispaltenformular mit fester Aktionszeile erscheinen.'
);
assert(
  source.includes('id="snHouseLetter" data-combo="ab_houseLetter" autocomplete="off"'),
  'Der Hausnummern-Zusatz im Sozialen Netzwerk muss die zentrale Fall-Adressbuch-Vorschlagsliste verwenden.'
);
assert(
  source.includes('html.mobile-online-active .mobile-online-toast.is-visible') &&
  source.includes('html.mobile-online-active .toast-stack') &&
  source.includes('z-index: 2147483646 !important;') &&
  source.includes('bottom: calc(82px + env(safe-area-inset-bottom, 0px)) !important;') &&
  source.includes('visibility: hidden;') &&
  scripts[0].includes("toast.classList.remove('is-visible'), 3200"),
  'Mobile Warnmeldungen müssen oberhalb der Navigation liegen und nach wenigen Sekunden wieder vollständig ausgeblendet werden.'
);
assert(
  css.includes('html.mobile-online-active .mobile-upload-grid') &&
  css.includes('grid-template-columns: repeat(5, minmax(0, 1fr)) !important;') &&
  css.includes('min-height: 58px !important;') &&
  scripts[0].includes('<span>Galerie</span>') &&
  scripts[0].includes('<span>Mikro</span>') &&
  scripts[0].includes('<span>Explorer</span>') &&
  !scripts[0].includes('Quelle wählen. Kamera, Galerie und Mikrofon bleiben auf dem Gerät'),
  'Der mobile Datei-Quellenwaehler muss kompakt in einer Fuenferreihe ohne Erklaertext erscheinen.'
);

[
  "{ id: 'start', label: 'Start', short: 'Start', icon: 'home', run: () => openMobileStartPage('start'), mobileProfile: 'page' }",
  "{ id: 'master-data', label: 'Stammdaten', short: 'Stammdaten', icon: 'masterdata', run: () => openMobileStartPage('master-data'), mobileProfile: 'page' }",
  "{ id: 'online-forms', label: 'Online-Formulare'",
  "{ id: 'finance', label: 'Finanzen'",
  "{ id: 'invoices', label: 'Ausgangsrechnungen'",
  "{ id: 'qualifications', label: 'Qualifikationsmanager'"
].forEach(contract => html.forEach((document, index) => assert(document.includes(contract), `${files[index]}: Mobiler Menüeintrag fehlt: ${contract}`)));

[
  ['calendar', '.cal-toolbar-main'],
  ['tasks', '.todo-full-list'],
  ['deadlines', '.fr-view'],
  ['contacts', '.addressbook-list,.addressbook-editor-grid'],
  ['cash', '.hk-view'],
  ['assets', '.va-view'],
  ['livelihood', '.lu-view'],
  ['debts', '.sr-view'],
  ['banking', '.bk2'],
  ['health', '.hi-view'],
  ['housing', '.housing-shell-v255'],
  ['needs', '.gdp-shell'],
  ['approvals', '.ap-view'],
  ['contact-monitor', '.km-scroll'],
  ['supervision', '.bu-table-wrap'],
  ['inbox', '.inbox-view'],
  ['online-forms', '.of-view'],
  ['finance', '.finance-view'],
  ['invoices', '.invoice-view'],
  ['mileage', '.mileage-view'],
  ['qualifications', '.qm-wrap']
].forEach(([id, root]) => assert(
  scripts[0].includes(`id: '${id}'`) &&
  scripts[0].includes(`mobileProfile: 'workspace', mobileRoot: '${root}'`),
  `${id} benötigt ein explizites, ausschließlich mobiles Arbeitsansicht-Profil.`
));

assert(
  scripts[0].includes('function adaptMobileTopLevelView(root)') &&
  scripts[0].includes("modal.dataset.mobileViewProfile = action.mobileProfile || 'bespoke';") &&
  scripts[0].includes("root.classList.toggle('mobile-top-view-body-v171', action.mobileProfile === 'workspace');") &&
  scripts[0].includes('adaptMobileTopLevelView(modalBody);'),
  'Jeder geöffnete mobile Arbeitsbereich muss automatisch sein deklariertes Ansichtsprofil erhalten.'
);
assert(
  css.includes('html.mobile-online-active #modal[data-mobile-view-profile="workspace"] > .modal-box') &&
  css.includes('height: 100dvh !important;') &&
  css.includes('html.mobile-online-active #modal[data-mobile-view-profile="workspace"] #modalBody.mobile-top-view-body-v171') &&
  css.includes('overflow-y: auto !important;') &&
  css.includes('html.mobile-online-active #modal[data-mobile-view-profile="workspace"] > .modal-box > .modal-actions') &&
  css.includes('display: none !important;'),
  'Übrige Smartphone-Ansichten benötigen Vollhöhe, genau einen Inhalts-Scroller und keinen globalen Schließen-Fuß.'
);
assert(
  css.includes('#modalBody.mobile-top-view-body-v171 :is(\n    .modal-scroll,') &&
  css.includes('.caltime-scroll') &&
  css.includes('overflow: visible !important;') &&
  scripts[0].includes('const workspaceView = document.querySelector(\'#modal[data-mobile-view-profile="workspace"]:not(.hidden)\');') &&
  scripts[0].includes("workspaceView.querySelector('#modalBody.mobile-top-view-body-v171')"),
  'Verschachtelte Modul-Scroller müssen mobil in den einzigen Dialog-Scroller überführt werden.'
);
assert(
  scripts[0].includes("grid.closest('.calgrid-wrap,.caltime-wrap')") &&
  scripts[0].includes('calendar|kalender|calgrid|caltime|month-grid|week-grid|day-grid') &&
  scripts[0].includes("grid.classList.remove('mobile-stack-grid');"),
  'Monats-, Wochen- und Tagesraster des Kalenders dürfen mobil niemals als gewöhnliche Formular-Grids gestapelt werden.'
);
assert(
  !css.includes('html.mobile-online-active #modalBody [style*="grid-template-columns"] {') &&
  !css.includes('html.mobile-online-active #modalBody :is(.wide,[style*="grid-column"]) {') &&
  source.includes('html.mobile-online-active .mobile-stack-grid:not(.calgrid-weekday-row):not(.calgrid-week-row):not(.caltime-header-row):not(.caltime-allday-row):not(.caltime-body) {') &&
  css.includes('html.mobile-online-active #modalBody .mobile-stack-grid:not(.calgrid-weekday-row):not(.calgrid-week-row):not(.caltime-header-row):not(.caltime-allday-row):not(.caltime-body) > :is(.wide,[style*="grid-column"]) {'),
  'Die mobile Normalisierung darf weder alle Inline-Grids stapeln noch die Kalender-Spaltenpositionen global löschen.'
);
assert(
  css.includes('#modalBody.mobile-top-view-body-v171 .qm-wrap') &&
  css.includes('display: block !important;') &&
  css.includes(':is(.qm-persons,.qm-detail,.bk2-scroll)') &&
  css.includes('.qm-grid3,') &&
  css.includes('.bk2-stats,') &&
  css.includes('.inbox-fields,') &&
  css.includes('.hi-dir-row') &&
  css.includes('grid-template-columns: minmax(0, 1fr) !important;'),
  'Qualifikationen, Banking, Posteingang und weitere Desktop-Spalten müssen im Smartphone-Profil linear und ohne Innenscrollen erscheinen.'
);
assert(
  css.includes('#modalBody.mobile-top-view-body-v171 .finance-receipts-actions') &&
  css.includes('#modalBody.mobile-top-view-body-v171 .inbox-doc-actions') &&
  css.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;') &&
  css.includes('.inbox-doc-actions .inbox-del-btn') &&
  css.includes('grid-column: auto !important;'),
  'Mehrere mobile Aktionen in Finanz- und Posteingangskarten müssen als kompakte Zweiergruppe statt als breite Desktop-Leiste erscheinen.'
);
assert(
  css.includes('padding: max(10px, env(safe-area-inset-top, 0px)) 9px calc(78px + env(safe-area-inset-bottom, 0px)) !important;') &&
  css.includes('Gemeinsames Smartphone-Profil für alle fachlichen Arbeitsansichten') &&
  css.includes('#modalBody.mobile-top-view-body-v171 table.mobile-card-table td:last-child:has(> :is(button,.btn):only-child)') &&
  css.includes('height: 34px !important;'),
  'Lange mobile Arbeitslisten müssen eine konstante Navigations-Sicherheitszone und kompakte Kartenaktionen behalten.'
);

assert(scripts[0].includes("chat.classList.add('cc2-rail-collapsed');"), 'KI-Chat muss auf Smartphones mit eingeklappter Sitzungsleiste starten.');
assert(scripts[0].includes('adaptSpecialLayouts(modalBody);'), 'Speziallayouts müssen nach jedem Dialogaufbau adaptiert werden.');
assert(css.includes('@media (max-width: 1024px) {'), 'Smartphone-Kuration muss zusätzlich an einen plausiblen Telefon-Viewport gebunden sein.');

console.log('Smartphone-Layout: Navigation, Dialoge, Tabellen, KI-Chat, Mail, Kalender, Dateien und Verwaltung ohne horizontales Seiten-Scrollen kuratiert.');
