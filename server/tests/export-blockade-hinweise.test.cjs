'use strict';
/* Exportmenü: Unterschriftauswahl-Wackler + sichtbare Blockade-Hinweise (Nutzerauftrag 30.08.2026).

   Zwei Befunde:
   1. „Manchmal funktioniert die Unterschriftauswahl nicht" - das Feld wurde aus dem
      Zwischenspeicher des Unterschriften-Stores gebaut und danach NIE aktualisiert. War der
      Speicher beim ersten Öffnen noch leer (die Unterschriften laden asynchron), blieb ein
      totes disabled-Feld stehen, obwohl das Büro Unterschriften hat. Jetzt füllt jedes
      inject() nach, und bei leerem Stand wird das Laden einmal je Feld angestoßen.
      DABEI GEBAUT UND GLEICH GEERNTET: inject() hängt über einen MutationObserver an jeder
      Modal-Änderung - ein bedingungsloses innerHTML wäre selbst eine Änderung und fütterte
      den Beobachter endlos (am Prüfstand als eingefrorener Tab reproduziert). Deshalb wird
      nur bei ECHTER Änderung geschrieben, und der Vergleichsstand liegt als JS-Eigenschaft
      am Element, nicht als data-Attribut (Attribute wären wieder DOM-Mutationen).
   2. Blockiert eine fehlende Auswahl den Export (Unterschrift, Empfänger), bekommt das Feld
      eine rote Umrandung und wird in Sicht gescrollt (window.__exportFehltZeigen). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

test('Unterschriftauswahl: das Feld füllt sich nach, statt tot zu bleiben', () => {
  assert.match(HTML, /function fuelleAuswahl\(select\)\{/,
    'Der Nachfüller der Export-Unterschriftauswahl fehlt');
  assert.match(HTML, /if\(!data\.count&&!select\.__sigNachladen&&window\.__sigStore\?\.load\)\{/,
    'Bei leerem Store wird das Laden nicht mehr angestoßen - das Feld bliebe wieder tot');
  assert.match(HTML, /window\.__sigStore\.load\(true\)\.then\(function\(\)\{\s*\n\s*const el=document\.getElementById\('deferredExportSignature'\);\s*\n\s*if\(el\)fuelleAuswahl\(el\);/,
    'Nach dem Laden wird das Feld nicht nachgefüllt');
  /* Der alte alles-beim-Bau-Zweig (disabled fest einrendern) darf nicht zurückkommen. */
  assert.doesNotMatch(HTML, /<select id="deferredExportSignature" \$\{data\.count\?'':'disabled'\}/,
    'Das Feld wird wieder einmalig mit dem Speicherstand gebaut - der Wackler wäre zurück');
});

test('Unterschriftauswahl: der Nachfüller schreibt nur bei echter Änderung (Beobachter-Schleife)', () => {
  assert.match(HTML, /if\(select\.__sigStand!==data\.html\)\{\s*\n\s*select\.__sigStand=data\.html;\s*\n\s*select\.innerHTML=data\.html;/,
    'Der Mutations-Schutz fehlt - der Modal-Beobachter ruft inject bei jeder Änderung und fräre den Tab ein');
  assert.match(HTML, /if\(small&&small\.textContent!==hinweis\)small\.textContent=hinweis;/,
    'Auch der Hinweistext muss nur bei Änderung geschrieben werden (gleiche Schleife)');
  /* Die Schleifen-Quelle bleibt dokumentiert erhalten: der Beobachter selbst ist gewollt. */
  assert.match(HTML, /new MutationObserver\(inject\)\.observe\(modal,\{subtree:true,childList:true,attributes:true,attributeFilter:\['class'\]\}\)/,
    'Der Modal-Beobachter des Unterschrift-Felds ist weg - bitte prüfen, wer das Feld dann nachzieht');
});

test('Blockade-Hinweis: Helfer + rote Markierung (hell und dunkel)', () => {
  assert.match(HTML, /window\.__exportFehltZeigen=function\(el\)\{/,
    'Der Markier-Helfer fehlt');
  assert.match(HTML, /el\.scrollIntoView\(\{block:'center',behavior:'smooth'\}\)/,
    'Das blockierende Feld wird nicht mehr in Sicht gescrollt');
  assert.match(HTML, /el\.classList\.add\('export-fehlt'\)/,
    'Die rote Markierung wird nicht gesetzt');
  assert.match(HTML, /\.export-fehlt\{border-color:#c0392b!important;outline:2px solid #c0392b/,
    'Die Markierungs-CSS (hell) fehlt');
  assert.match(HTML, /html\[data-theme="dark"\] \.export-fehlt\{border-color:#ff8a7a!important/,
    'Die Markierungs-CSS (dunkel) fehlt');
  /* Selbstaufräumend: beim Ändern des Felds oder nach ein paar Sekunden. */
  assert.match(HTML, /el\.addEventListener\('change',weg\);el\.addEventListener\('input',weg\);/,
    'Die Markierung räumt sich beim Ändern nicht mehr weg');
});

test('Blockade-Hinweis: alle fünf Prüfstellen rufen den Helfer', () => {
  const rufe = (HTML.match(/__exportFehltZeigen\(/g) || []).length;
  /* 6 Aufrufe (die Definition `=function(el)` matcht dieses Muster bewusst nicht):
     v219-selectedOrWarn, startFreeExport (dokumentweiter Klick-Fänger, lief VOR allen
     Knopf-Wächtern - am Prüfstand über den Toast-Stack gefunden), 2× Empfängerart
     „export" ohne Auswahl, Anlagen-Zweig, Mehrfach-Empfänger. */
  assert.ok(rufe >= 6, `Nur ${rufe} Aufrufe des Markier-Helfers (6 erwartet)`);
  assert.match(HTML, /if\(window\.__exportFehltZeigen\)window\.__exportFehltZeigen\(deferredPicker\);else deferredPicker\.focus\(\);/,
    'Der Freidokument-Weg (startFreeExport) markiert nicht mehr');
  assert.match(HTML, /if\(window\.__exportFehltZeigen\)window\.__exportFehltZeigen\(document\.querySelector\('\.bulk-export-panel'\)\);/,
    'Die Mehrfach-Empfängerliste wird bei leerer Auswahl nicht mehr markiert');
  const empfaenger = (HTML.match(/const sel=document\.getElementById\('phase5ExportRecipientSelect'\);if\(window\.__exportFehltZeigen\)window\.__exportFehltZeigen\(sel\);else sel\?\.focus\(\);/g) || []).length;
  assert.strictEqual(empfaenger, 3, `Die Empfänger-Prüfstellen markieren nur ${empfaenger}× statt 3×`);
});
