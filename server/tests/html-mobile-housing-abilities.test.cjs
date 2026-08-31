'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const htmlPath = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

test('Wohnen und Fähigkeiten sind als getrennte mobile Bereiche registriert', () => {
  assert.match(html, /\{ id: 'housing', label: 'Wohnen',[^\n]+mobileProfile: 'workspace', mobileRoot: '\.housing-shell-v255' \}/);
  assert.match(html, /\{ id: 'abilities', label: 'Fähigkeiten & Alltag',[^\n]+run: openMobileAbilities, mobileProfile: 'standalone', mobileRoot: '#functionalProfileHubOverlayV255' \}/);
  assert.match(html, /health:[\s\S]*?'housing',[\s\S]*?'abilities',[\s\S]*?'needs'/,
    'Die mobile Reihenfolge muss Gesundheit → Wohnen → Fähigkeiten → Bedarfe abbilden.');
});

test('Fähigkeiten wechselt sauber zwischen eigenständigem Overlay und gemeinsamen Modulen', () => {
  assert.match(html, /function openMobileAbilities\(\)[\s\S]*?window\.closeModal\(\)[\s\S]*?window\.openFunctionalProfileHubV255\(\)/);
  assert.match(html, /function invokeAction\(id\)[\s\S]*?closeMobileStandaloneViews\(id\);/,
    'Beim Wechsel zu einem anderen mobilen Menü muss das Fähigkeiten-Overlay geschlossen werden.');
  assert.match(html, /functionalProfileHubOverlayV255[\s\S]*?mutation\.removedNodes[\s\S]*?queueMobileAdaptation\(\)/,
    'Öffnen und Schließen des eigenständigen Overlays muss die mobile Zustandsanpassung auslösen.');
});

test('Fähigkeiten nutzt mobil den ganzen Schirm - ohne Fußnavigation darunter', () => {
  assert.match(html, /html\.mobile-online-active #functionalProfileHubOverlayV255 \{[\s\S]*?z-index: 2147481500 !important;[\s\S]*?padding: 0 !important;/);
  /* Nutzerfund 30.08. abends: „unten ist viel leerer Raum" - die 76px-Reserve für die
     Navigationsleiste ist weg, weil die Leiste im offenen Modul gar nicht mehr erscheint. */
  assert.match(html, /#functionalProfileHubOverlayV255 > \.v255-dialog \{[\s\S]*?height: 100dvh !important;[\s\S]*?padding-bottom: env\(safe-area-inset-bottom, 0px\) !important;/,
    'Der Dialog darf keinen leeren Streifen für die Leiste mehr reservieren.');
  assert.match(html, /html\.mobile-online-active\.fph-voll-v262 \.mobile-online-shell \{\s*\n\s*display: none !important;/,
    'Im offenen Modul darf die Menüleiste nicht auftauchen.');
  assert.match(html, /html\.mobile-online-active\.fph-voll-v262,\s*\n\s*html\.mobile-online-active\.fph-voll-v262 body \{\s*\n\s*overflow: hidden !important;/,
    'Die Seite hinter dem Modul muss feststehen - sonst blendet ihr Scrollen die Leiste ein und aus.');
  assert.match(html, /fpHubVollScrollY=\(typeof window!=='undefined'&&window\.scrollY\)\|\|w\.scrollTop\|\|0;\s*\n\s*w\.classList\.add\('fph-voll-v262'\);/,
    'Die Rollposition muss VOR dem Feststellen gemerkt werden - sonst springt die Seite beim Schließen auf 0.');
  /* Der Prüfstand fährt dieses Modul in einer DOM-Attrappe ohne documentElement - ein harter
     Zugriff riss dort das ganze Modul ab (Fund der Suite, 30.08.). */
  assert.match(html, /function fpHubWurzel\(\)\{try\{const w=document\.documentElement;return \(w&&w\.classList\)\?w:null\}catch\(_e\)\{return null\}\}/,
    'Der Wurzelzugriff muss defensiv bleiben.');
  assert.match(html, /function fpHubVollbildAus\(\)\{[\s\S]{0,320}?classList\.remove\('fph-voll-v262'\);[\s\S]{0,200}?window\.scrollTo\(0,y\)/,
    'Beim Schließen müssen Leiste, Beweglichkeit und Rollposition zurückkommen.');
  assert.match(html, /window\.closeFunctionalProfileHubV255=function\(\)\{[\s\S]{0,320}?fpHubVollbildAus\(\);/,
    '„Schließen" muss das Vollbild verlassen.');
  assert.match(html, /#functionalProfileHubOverlayV255 #fpHubKartenV255,[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;/);
  assert.match(html, /\.mobile-online-shell \{[\s\S]*?z-index: 2147482000;/,
    'Die mobile Navigation muss über dem Fähigkeiten-Overlay bleiben.');
});

test('Fähigkeiten-Editor füllt mobil die Fläche statt unten leer zu laufen', () => {
  /* Die beiden Freitextfelder klebten auf ihren 84px (Inline-Stil FP_TA), darunter blieb tote
     Fläche. Jetzt teilen sie sich den Rest; alles andere behält seine Höhe. */
  assert.match(html, /#functionalProfileHubOverlayV255\.fph-lesen-v262 \[data-fp-hub-card\]:has\(\.fp-hub-editor-grid-v255\) \{\s*\n\s*min-height: 100% !important;/,
    'Die Editorkarte muss den Lesebereich ausfüllen.');
  assert.match(html, /#functionalProfileHubOverlayV255\.fph-lesen-v262 \.fp-hub-editor-grid-v255 \{\s*\n\s*display: flex !important;[\s\S]{0,160}?flex: 1 1 auto !important;/,
    'Das Editorraster muss den freien Platz weitergeben können.');
  assert.match(html, /#functionalProfileHubOverlayV255\.fph-lesen-v262 \.fp-hub-editor-grid-v255 > \*:has\(textarea\) \{[\s\S]{0,220}?flex: 1 1 auto !important;[\s\S]{0,80}?min-height: 92px !important;/,
    'Nur die Textfelder dürfen wachsen.');
  assert.match(html, /#functionalProfileHubOverlayV255\.fph-lesen-v262 \.fp-hub-editor-grid-v255 > \*:has\(textarea\) textarea \{[\s\S]{0,220}?height: auto !important;/,
    'Der 84px-Inlinestil der Textfelder muss überschrieben werden.');
  assert.match(html, /#functionalProfileHubOverlayV255\.fph-lesen-v262 \.fp-hub-editor-grid-v255 > \* \{\s*\n\s*flex: 0 0 auto;/,
    'Datums-, Quellen- und Auswahlfelder dürfen nicht mitwachsen.');
});

test('Wohnen-Untereditoren sind mobil eine ganzseitige Maske ohne Scrollen (Nutzerwunsch 30.08.2026)', () => {
  /* Vorher schwebte ein kompaktes Kästchen mit Höhe „auto" über der Zeitleiste; zu hohe
     Masken wurden am Rand des Overlays abgeschnitten. Jetzt füllt der Editor die Fläche
     oberhalb der Mobilnavigation: Kopf und Fußzeile fest, das Schreibfeld dehnt sich. */
  assert.match(html, /html\.mobile-online-active \.housing-entry-overlay-v257\{position:fixed!important;inset:0 0 calc\(72px \+ env\(safe-area-inset-bottom,0px\)\) 0!important;align-items:stretch!important;[\s\S]*?padding:0!important\}/,
    'Der Untereditor muss die ganze Fläche über der Mobilnavigation einnehmen.');
  assert.match(html, /html\.mobile-online-active \.housing-entry-dialog-v257\{width:100%!important;[\s\S]*?height:100%!important;[\s\S]*?display:flex!important;flex-direction:column!important;overflow:hidden!important;border-radius:0!important/,
    'Die Maske muss ganzseitig sein (volle Höhe, eigene Kopf-/Fußzeile).');
  assert.match(html, /html\.mobile-online-active \.housing-entry-dialog-body-v257\{flex:1 1 auto!important;min-height:0!important;overflow:hidden!important;[\s\S]*?display:flex!important;flex-direction:column!important\}/,
    'Der Formularrumpf darf nicht scrollen - er teilt den vorhandenen Platz auf.');
  /* Genau EIN dehnbares Feld: das Erläuterungsfeld. Sonst entstünde wieder Überlauf. */
  assert.match(html, /\.housing-entry-dialog-body-v257 \.v255-field:has\(textarea\)\{flex:1 1 auto!important;min-height:76px!important\}/,
    'Das Erläuterungsfeld muss den Rest der Maske füllen.');
  assert.match(html, /\.housing-entry-dialog-body-v257 \.v255-field\{flex:0 0 auto!important/,
    'Datums- und Statusfelder dürfen nicht gestaucht werden.');
  /* Auf kurzen Geräten gibt die Liste der neun Unterstützungsformen nach - nie das
     Schreibfeld, und nichts wird abgeschnitten. */
  assert.match(html, /\.v255-field:has\(\.housing-entry-supports-v257\)\{flex:0 1 auto!important;min-height:0!important\}/,
    'Die Unterstützungsformen müssen als einziger Block nachgeben können.');
  assert.match(html, /html\.mobile-online-active \.housing-entry-supports-v257\{flex:1 1 auto!important;[\s\S]*?overflow:auto!important\}/,
    'Die Auswahlliste braucht ihren eigenen Notfall-Roller.');
  assert.match(html, /html\.mobile-online-active \.housing-entry-dialog-foot-v257\{flex:0 0 auto!important;display:grid!important;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/,
    'Abbrechen und Speichern stehen fest am unteren Rand.');
  /* „Schließen" brach im schmalen Kopf mitten im Wort um. */
  assert.match(html, /\.housing-entry-dialog-head-v257 \.btn\{flex:0 0 auto!important;white-space:nowrap!important/,
    'Der Schließen-Knopf im Kopf darf nicht umbrechen.');
  assert.doesNotMatch(html, /@media\(max-width:600px\)[^}]*\.housing-entry-dialog-v257\{[^}]*height:100%/,
    'Die frühere mobile Vollhöhenregel darf nicht zurückkehren.');
});

test('Zeitleiste: Bearbeiten und Löschen stehen mobil dauerhaft an der Karte', () => {
  /* Am Schreibtisch erscheinen die beiden Knöpfe beim Zeigen; @media(hover:none) deckte
     nur echte Touchgeräte ab. Auf dem Telefon (und beim Prüfen mit Telefon-Kennung am
     Schreibtisch) waren die einzigen Aktionen der Zeitleiste damit unsichtbar. */
  const mobil = html.slice(html.indexOf('@media(max-width:760px){\n    .housing-tools-v260'));
  assert.ok(mobil.startsWith('@media(max-width:760px){'), 'Der Mobilblock des Wohnen-Moduls fehlt.');
  const block = mobil.slice(0, mobil.indexOf('\n  }'));
  assert.match(block, /\.housing-ev-actions-v260\{display:flex;/,
    'Bearbeiten/Löschen müssen mobil ohne Zeigen sichtbar sein.');
  assert.match(block, /\.housing-ev-actions-v260 \.btn\{flex:1;justify-content:center;min-height:40px/,
    'Die beiden Knöpfe teilen sich die Breite und bleiben gut treffbar.');
  /* Die Grundregel bleibt display:none - am Schreibtisch erscheinen sie weiter beim Zeigen. */
  assert.match(html, /\.housing-ev-actions-v260\{grid-column:1\/-1;display:none;/,
    'Am Schreibtisch bleibt die Karte aufgeräumt (Knöpfe beim Zeigen).');
});

test('Fähigkeiten und Alltag verwendet mobil nur den gemeinsamen Modul-Scroller', () => {
  assert.match(html, /#functionalProfileHubOverlayV255 #fpHubScrollV255 \{[\s\S]*?overflow-y: auto !important;/,
    'Der gesamte Modulinhalt bleibt der einzige vertikale Scroller.');
  assert.match(html, /#functionalProfileHubOverlayV255 \.fp-hub-needs-list-v255 \{[\s\S]*?max-height: none !important;[\s\S]*?overflow: visible !important;/,
    'Die Bedarfs-Auswahl darf keinen verschachtelten Scrollbereich erzeugen.');
  assert.match(html, /class="fp-hub-editor-grid-v255"/);
  assert.match(html, /class="fp-hub-needs-list-v255"/);
  assert.match(html, /class="fp-hub-edit-actions-v255"/);
  assert.match(html, /#functionalProfileHubOverlayV255 \.fp-hub-editor-grid-v255 \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;/,
    'Geöffnete Fähigkeitskarten müssen mobil einspaltig sein.');
});

test('Fähigkeiten mobil: Übersicht rollt als Ganzes, Lesen und Bearbeiten sind ganzseitig (Nutzerwunsch 30.08.2026)', () => {
  /* Befund: Kopf, Werkzeugzeile, fünf Kacheln und die Filterchips klebten oben fest; für die
     elf Bereiche blieb ein Restspalt (Liste gedeckelt auf 38vh), der Lesebereich darunter war
     kaum noch zu sehen. Jetzt gilt auf dem Telefon: EINE Ebene je Bildschirm. */
  assert.match(html, /html\.mobile-online-active #functionalProfileHubOverlayV255:not\(\.fph-lesen-v262\) > \.v255-dialog \{[\s\S]{0,200}?overflow-y: auto !important;/,
    'In der Übersicht muss der Dialog selbst der Scroller sein.');
  assert.match(html, /html\.mobile-online-active #functionalProfileHubOverlayV255 \.v255-dialog-head \{\s*\n\s*position: sticky;/,
    'Nur der Titel bleibt beim Rollen stehen.');
  assert.match(html, /html\.mobile-online-active #functionalProfileHubOverlayV255:not\(\.fph-lesen-v262\) \.fph-list-v260 \{[\s\S]{0,160}?max-height: none !important;[\s\S]{0,80}?overflow: visible !important;/,
    'Der 38vh-Deckel der Liste darf mobil nicht zurückkehren.');
  assert.match(html, /html\.mobile-online-active #functionalProfileHubOverlayV255:not\(\.fph-lesen-v262\) #fpHubScrollV255 \{\s*\n\s*display: none !important;/,
    'In der Übersicht gehört der Bildschirm der Liste.');
  /* Ebene 2/3: gewählter Bereich lesen bzw. bearbeiten - ganzseitig. */
  assert.match(html, /html\.mobile-online-active #functionalProfileHubOverlayV255\.fph-lesen-v262 :is\(\.fph-tools-v260, #fpHubKachelnV255, \.fph-subbar-v260, \.fph-list-v260\) \{\s*\n\s*display: none !important;/,
    'Beim Lesen/Bearbeiten treten Werkzeuge, Kacheln, Filter und Liste beiseite.');
  assert.match(html, /html\.mobile-online-active #functionalProfileHubOverlayV255\.fph-lesen-v262 #fpHubScrollV255 \{[\s\S]{0,260}?flex: 1 1 auto !important;[\s\S]{0,200}?overflow-y: auto !important;/,
    'Der Lesebereich füllt dann die ganze Fläche.');
  assert.match(html, /#functionalProfileHubOverlayV255 \.fph-back-v262\{display:none;/,
    'Der Zurück-Pfeil darf am Schreibtisch nicht auftauchen.');
  assert.match(html, /html\.mobile-online-active #functionalProfileHubOverlayV255\.fph-lesen-v262 \.fph-back-v262 \{\s*\n\s*display: inline-flex !important;/);
});

test('Fähigkeiten mobil: jeder Weg in einen Bereich öffnet die Vollansicht', () => {
  assert.match(html, /function fpHubEbeneV262\(lesen\)\{[\s\S]{0,220}?ov\.classList\.toggle\('fph-lesen-v262',!!lesen\);/,
    'Der Ebenen-Schalter fehlt.');
  /* Der bereits gewählte Bereich MUSS sich öffnen lassen - sonst wäre ausgerechnet er auf dem
     Telefon nicht erreichbar (die alte Fassung stieg bei bereich===fpHubSelV260 sofort aus). */
  assert.match(html, /window\.__fpHubWaehleV260=function\(bereich\)\{[\s\S]{0,700}?fpHubEbeneV262\(true\);\s*\n\s*if\(bereich===fpHubSelV260\)return;/,
    'Ein Tipp auf den bereits gewählten Bereich muss die Vollansicht öffnen.');
  assert.match(html, /window\.__fpHubEditV255=function\(bereich\)\{\s*\n\s*bereich=bereich\|\|keys\[0\];\s*\n\s*fpHubEbeneV262\(true\);/,
    '„Bearbeiten" muss ebenfalls ganzseitig öffnen.');
  assert.match(html, /window\.__fpHubZurueckV262=function\(\)\{fpHubEbeneV262\(false\)\};/,
    'Der Rückweg zur Übersicht fehlt.');
  assert.match(html, /<button type="button" class="fph-back-v262" title="Zurück zur Übersicht"[^>]*onclick="window\.__fpHubZurueckV262\(\)">/,
    'Der Bereichskopf trägt den Zurück-Pfeil.');
  /* Offene Bearbeitung hat weiterhin Vorrang - erst speichern oder abbrechen. */
  const waehle = html.slice(html.indexOf('window.__fpHubWaehleV260=function(bereich){'));
  assert.ok(waehle.indexOf('fpHubEditSet.size') < waehle.indexOf('fpHubEbeneV262(true)'),
    'Die Warnung bei offener Bearbeitung muss vor dem Ebenenwechsel stehen.');
});
