'use strict';

/* Excel-Vorschau im Eintragsformular der Falldokumentation (Nutzerwunsch 06.09.2026).
     Im Lesebereich zeigt der Streifen seit dem Umbau, wie ein gespeicherter Eintrag als Zeile in
     „02 - Betreuungsverlauf“ steht. Im Formular fehlte er - vor dem Speichern war also nicht zu
     sehen, was in der Excel-Datei landet. Geprueft werden:
     - die ausgefuehrte Zeilenbildung aus den eingetippten Werten (Spalten A-H, Datum deutsch),
     - die Verdrahtung im Formular (Abschnitt, Halter, Nachziehen bei jeder Eingabe),
     - der Aufklappzustand (Standard zugeklappt, eigener Schalter neben dem des Lesebereichs),
     - die Gestaltung auch im freistehenden Formular (CSS nicht mehr nur unter .fd-shell),
     - der ausgeschriebene Tastaturhinweis in der Fusszeile,
     - die Beschriftung „Balken“ des Briefkopf-Ausgangspunkts (frueher „Klassisch – wie heute“). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

/* Eine Funktion per Namen aus der Auslieferung schneiden (Klammern zaehlen). */
function funktion(name) {
  const start = html.indexOf('\n  function ' + name + '(');
  assert.ok(start > 0, 'Funktion ' + name + ' fehlt');
  let i = html.indexOf('{', start);
  let tiefe = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') tiefe += 1;
    else if (c === '}') { tiefe -= 1; if (tiefe === 0) return html.slice(start, i + 1); }
  }
  throw new Error('Ende von ' + name + ' nicht gefunden');
}

test('Zeilenbildung (ausgefuehrt): die Vorschau nimmt die eingetippten Werte und schreibt das Datum deutsch', () => {
  const quelle = ['fdPad2', 'fdDateAusIso', 'fdIstIso', 'fdDatumDE', 'fdExcelZeile', 'fdExcelZeileAusWerten'].map(funktion).join('\n');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(quelle + '\nthis.zeile = fdExcelZeileAusWerten;\nthis.roh = fdExcelZeile;', sandbox);
  /* Der Sandkasten hat eigene Prototypen - fuer den Vergleich einmal durch JSON. */
  const zeile = (w) => JSON.parse(JSON.stringify(sandbox.zeile(w)));

  const z = zeile({
    date: '2026-09-06', actorGroup: 'Behörde', actor: 'Amtsgericht Musterstadt', type: 'Gesundheit',
    detail: 'Telefonat zur Untersuchung', freeDetail: 'Termin am 12.09. vereinbart.', contactType: 'telefonisch', note: 'Rückruf zusagen'
  });
  assert.deepEqual(z.spalten, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 'Spalten A-H wie in der Excel-Datei');
  assert.deepEqual(z.werte, ['06.09.2026', 'Behörde', 'Amtsgericht Musterstadt', 'Gesundheit',
    'Telefonat zur Untersuchung', 'Termin am 12.09. vereinbart.', 'telefonisch', 'Rückruf zusagen']);
  assert.equal(z.kopf.length, 8);
  assert.equal(z.kopf[5], 'weitere Vorgangsdetails (Freifeld)', 'Spaltenkoepfe kommen aus derselben Quelle wie im Lesebereich');

  /* Leeres Formular: acht leere Zellen, kein „undefined“. */
  const leer = zeile({});
  assert.deepEqual(leer.werte, ['', '', '', '', '', '', '', '']);
  /* Nicht-ISO-Datum bleibt unveraendert stehen (Altbestand mit Jahreszahl). */
  assert.equal(zeile({ date: '2019' }).werte[0], '2019');
});

test('Verdrahtung: der Streifen steht im Formular, klappt eigenstaendig auf und zieht bei jeder Eingabe nach', () => {
  assert.ok(html.includes('+\'<div class="wide" data-fd-excel>\'+fdExcelFormHTML(w)+\'</div>\''),
    'Der Halter der Vorschau fehlt im Formularraster');
  assert.ok(html.includes('<span>Excel-Zeile</span><span class="fd-fsec-note">\'+(neu?\'So entsteht die neue Zeile\':\'So ändert sich die Zeile\')+\'</span>'),
    'Der Abschnittskopf der Vorschau fehlt oder unterscheidet nicht zwischen Anlegen und Bearbeiten');
  assert.ok(html.includes('window.fdExcelFormToggle=function(){fdState.excelFormOffen=!fdState.excelFormOffen;fdExcelFormAktualisieren()}'),
    'Der eigene Aufklappschalter des Formulars fehlt');
  assert.ok(html.includes('if(fdState.excelFormOffen)fdExcelFormAktualisieren();'),
    'Die Vorschau wird bei einer Eingabe nicht nachgezogen');
  assert.ok(html.includes('halter.innerHTML=fdExcelFormHTML(fdFormWerteAktuell(F));'),
    'Die Vorschau muss die aktuellen Formularwerte zeichnen');
  /* Nur der Halter wird neu gezeichnet, nicht das Formular - sonst ginge der Schreibfokus verloren. */
  assert.ok(!/fdExcelFormAktualisieren\(\)\{[^}]*fdFormRender/.test(html),
    'Die Vorschau darf das Formular nicht neu aufbauen');
  /* Standard zugeklappt, in beiden Zustandsstartern (Nutzerentscheidung vom 05.09.). */
  assert.equal((html.match(/excelOffen:false,excelFormOffen:false/g) || []).length, 2,
    'excelFormOffen muss in beiden Zustandsstartern zugeklappt beginnen');
});

test('Gestaltung: der Streifen sieht auch im freistehenden Formular wie im Lesebereich aus', () => {
  assert.ok(html.includes(':is(.fd-shell,.doku-entry-form-shell-v170) .fd-excel{'),
    'Die Grundregel des Streifens greift nicht im Formular');
  assert.ok(html.includes('html[data-theme="dark"] :is(.fd-shell,.doku-entry-form-shell-v170) .fd-excel {'),
    'Der Dunkelmodus des Streifens greift nicht im Formular');
  assert.ok(!/(^|[^,(])\.fd-shell \.fd-excel/.test(html),
    'Es darf keine Regel mehr geben, die den Streifen nur im Lesebereich gestaltet');
});

test('Fusszeile: der Tastaturhinweis sagt, was die Tasten tun', () => {
  assert.ok(html.includes('<span class="kbd">Esc bricht ab · \'+(FD_IST_MAC?\'⌘\':\'Strg\')+\' + Enter speichert</span>'),
    'Der Hinweis „Esc · ⌘ + Enter“ war ohne Verb unklar (Nutzerhinweis 06.09.2026)');
});

test('Briefkopf: der erste Ausgangspunkt heisst nach seinem Deko-Element „Balken“', () => {
  assert.ok(html.includes("const AUSGANG_NAMEN=[['klassisch','Balken'],['linie','Linie'],['schlicht','Schlicht']];"),
    'Die Beschriftung der Ausgangspunkte stimmt nicht');
  assert.ok(!html.includes('Klassisch – wie heute'), 'Die alte Beschriftung steht noch in der Auslieferung');
});
