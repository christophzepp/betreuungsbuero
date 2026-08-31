'use strict';

/* Umbau des Seitenpanels nach dem Entwurf vom 31.08.2026.

   Vorher: drei Reiter (Assistent | KI | Training), eine Kachelreihe von 200 px Hoehe, neun
   gleich laute Abschnitte untereinander, gestapelte Banner und eine flache Pruefliste, in der
   die unsichere Zuordnung genauso aussah wie die sichere.

   Jetzt: fester Kontextkopf (Fall + Seite), Schrittleiste, EINE Meldestelle, nach Zugehoerigkeit
   gruppierte Pruefliste, feste Fussleiste mit einem Knopf, der den naechsten Schritt traegt.
   Seltenes liegt im Werkzeugschub, Training und Fallwahl sind eigene Flaechen.

   Diese Zusagen halten den Umbau fest - besonders die strukturelle: JEDE Kennung, die panel.js
   holt, muss es im HTML geben. Genau daran waere der Umbau sonst still zerbrochen. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const wurzel = path.join(__dirname, '..');
const quelle = (p) => fs.readFileSync(path.join(wurzel, p), 'utf8');

const PANEL_JS = quelle('src/panel/panel.js');
const PANEL_HTML = quelle('src/panel/panel.html');
const PANEL_CSS = quelle('src/panel/panel.css');
const OPTIONS_HTML = quelle('src/options/options.html');
const OPTIONS_JS = quelle('src/options/options.js');

function schnipsel(text, von, bis) {
  const a = text.indexOf(von);
  assert.ok(a >= 0, `Anker fehlt: ${von}`);
  assert.equal(text.indexOf(von, a + 1), -1, `Anker nicht eindeutig: ${von}`);
  const b = text.indexOf(bis, a);
  assert.ok(b > a, `Endanker fehlt hinter "${von}": ${bis}`);
  return text.slice(a, b);
}

test('Jede vom Panel geholte Kennung existiert im HTML', () => {
  const geholt = new Set();
  for (const m of PANEL_JS.matchAll(/\$\('([^']+)'\)/g)) geholt.add(m[1]);
  for (const m of PANEL_JS.matchAll(/getElementById\('([^']+)'\)/g)) geholt.add(m[1]);
  const vorhanden = new Set([...PANEL_HTML.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  /* Diese drei baut renderPortals selbst in #portalList - sie stehen bewusst nicht im HTML. */
  const zurLaufzeit = new Set(['formsFilter', 'formsAllOpen', 'formsAllClose']);
  const fehlend = [...geholt].filter(id => !vorhanden.has(id) && !zurLaufzeit.has(id));
  assert.deepEqual(fehlend, [], 'Kennungen ohne Element im Panel-HTML');
});

test('Es gibt genau eine Meldestelle, und darin gewinnt das erste Banner', () => {
  const stelle = schnipsel(PANEL_HTML, '<div class="p-meldung" id="pMeldung">', '</main>');
  for (const id of ['versionBanner', 'grantBanner', 'pageChangeBanner', 'requiredWarn']) {
    assert.ok(stelle.includes(`id="${id}"`), `Banner liegt nicht in der Meldestelle: ${id}`);
  }
  /* Ohne diese Regel stapeln sich zwei gleichzeitig sichtbare Banner wieder uebereinander und
     schieben den Inhalt nach unten - genau der Zustand, den der Umbau beseitigt. */
  assert.match(PANEL_CSS, /\.p-meldung > \.banner:not\(\.hidden\) ~ \.banner:not\(\.hidden\)\{ display:none !important; \}/);
  /* Die Rangfolge steckt in der DOM-Reihenfolge: veraltete Fassung vor fehlendem Zugriff. */
  assert.ok(stelle.indexOf('versionBanner') < stelle.indexOf('grantBanner'));
  assert.ok(stelle.indexOf('grantBanner') < stelle.indexOf('pageChangeBanner'));
});

test('Die Prüfliste gruppiert nach Unsicherheit und Zugehörigkeit', () => {
  const code = schnipsel(PANEL_JS, 'function reviewGruppen() {', 'function renderReview() {');
  const umgebung = {
    P: {
      proposals: [
        { fieldLabel: 'Familienname', group: 'betreute_person', confidence: 1 },
        { fieldLabel: 'Kontoinhaber', group: 'betreute_person', confidence: 0.45 },
        { fieldLabel: 'Vertreter', group: 'betreuer_buero', confidence: 1 },
        { fieldLabel: 'Telefon', group: 'betreuer_buero', confidence: 0.5 },
        { fieldLabel: 'Sonstiges', group: 'unbekannt', confidence: 0.9 }
      ]
    },
    ergebnis: null
  };
  vm.runInNewContext(`${code}\nergebnis = reviewGruppen();`, umgebung);
  /* Array.from: der vm bringt Arrays aus einer eigenen Realm mit - deepEqual vergleicht auch
     den Prototyp und schluege sonst trotz gleichen Inhalts fehl. */
  const namen = Array.from(umgebung.ergebnis, g => g.schluessel);
  assert.deepEqual(namen, ['unsicher', 'person', 'buero', 'rest'], 'Unsicheres muss zuerst stehen');
  assert.equal(umgebung.ergebnis[0].eintraege.length, 2, 'beide unsicheren Zeilen gehören nach oben');
  /* Unsicheres wird aus SEINER Sachgruppe herausgezogen - sonst bliebe es zwischen sicheren
     Zeilen stehen und faellt nicht auf. */
  assert.equal(umgebung.ergebnis[1].eintraege.length, 1);
  assert.equal(umgebung.ergebnis[2].eintraege.length, 1);

  const chip = schnipsel(PANEL_JS, 'function herkunftChip(p) {', 'function renderReview() {');
  const u2 = { ergebnis: null };
  vm.runInNewContext(`${chip}\nergebnis = herkunftChip;`, u2);
  /* Spread: dasselbe Realm-Thema wie oben - die vm-Objekte tragen einen fremden Prototyp. */
  const chipVon = (p) => ({ ...u2.ergebnis(p) });
  assert.deepEqual(chipVon({ confidence: 0.4, source: 'profil', group: 'betreute_person' }), { klasse: 'warn', text: 'unsicher' });
  assert.deepEqual(chipVon({ confidence: 1, source: 'profil', group: 'betreute_person' }), { klasse: 'blau', text: 'Profil' });
  assert.deepEqual(chipVon({ confidence: 1, source: 'profil', group: 'betreuer_buero' }), { klasse: 'ocker', text: 'Profil' });
  assert.deepEqual(chipVon({ confidence: 1, source: 'ki', group: 'betreute_person' }), { klasse: 'lila', text: 'KI' });
});

test('Der Hauptknopf trägt immer den nächsten Schritt', () => {
  const code = schnipsel(PANEL_JS, 'function aktualisiereHauptknopf() {', 'async function hauptknopfGeklickt() {');
  const knopf = { dataset: {}, disabled: false };
  const felder = { fillLabel: { textContent: '' }, fillZahl: { classList: { toggle() {} } }, btnAuswahl: { classList: { toggle() {} } } };
  const lauf = (zustand) => {
    const umgebung = {
      P: Object.assign({ dict: [], descriptors: [], proposals: [], protocol: null, readOnly: false }, zustand),
      $: (id) => (id === 'btnFill' ? knopf : felder[id]),
      sameProtocolPage: () => true
    };
    vm.runInNewContext(`${code}\naktualisiereHauptknopf();`, umgebung);
    return { modus: knopf.dataset.modus, text: felder.fillLabel.textContent };
  };
  assert.deepEqual(lauf({}), { modus: 'fall', text: 'Fall wählen' });
  assert.deepEqual(lauf({ dict: [1] }), { modus: 'scan', text: 'Formular scannen' });
  assert.deepEqual(lauf({ dict: [1], descriptors: [1], proposals: [{ checked: true }] }), { modus: 'fuellen', text: 'Werte ausfüllen' });
  /* Nach dem Ausfuellen fuehrt der Knopf weiter statt "Ausfuellen (0)" anzubieten. */
  assert.deepEqual(lauf({ dict: [1], descriptors: [1], proposals: [{ checked: false }], protocol: {} }),
    { modus: 'weiter', text: 'Nächste Seite scannen' });
});

test('Die Schrittleiste zeigt genau einen aktuellen Schritt', () => {
  const code = schnipsel(PANEL_JS, 'function aktualisiereSchritte() {', 'function aktualisiereHauptknopf() {');
  const lauf = (zustand) => {
    const schritte = [0, 1, 2, 3].map(() => {
      const el = { klassen: new Set(), kreis: { textContent: '' } };
      el.classList = { toggle: (name, an) => { if (an) el.klassen.add(name); else el.klassen.delete(name); } };
      el.querySelector = () => el.kreis;
      return el;
    });
    const umgebung = {
      P: Object.assign({ dict: [], descriptors: [], protocol: null }, zustand),
      sameProtocolPage: () => true,
      document: { querySelectorAll: () => schritte }
    };
    vm.runInNewContext(`${code}\naktualisiereSchritte();`, umgebung);
    return schritte.map(e => [...e.klassen].sort().join(','));
  };
  assert.deepEqual(lauf({}), ['jetzt', '', '', '']);
  assert.deepEqual(lauf({ dict: [1] }), ['fertig', 'jetzt', '', '']);
  assert.deepEqual(lauf({ dict: [1], descriptors: [1] }), ['fertig', 'fertig', 'jetzt', '']);
  assert.deepEqual(lauf({ dict: [1], descriptors: [1], protocol: {} }), ['fertig', 'fertig', 'fertig', 'fertig']);
});

test('Der gewählte Fall überlebt den Browserneustart nicht', () => {
  /* Entscheidung 31.08.2026: das Panel steht offen neben fremden Webseiten - nach einem Neustart
     darf dort kein Klarname stehen. storage.session wird beim Schliessen des Browsers geleert. */
  assert.match(PANEL_JS, /async function sitzungSchreiben\(objekt\) \{[\s\S]*BX\.storage\.session\.set\(objekt\)/);
  assert.equal(/storage\.local\.set\(\{ selectedCaseId/.test(PANEL_JS), false,
    'selectedCaseId darf nicht dauerhaft gespeichert werden');
  assert.equal(/storage\.local\.get\(\['localCases', 'selectedCaseId'\]\)/.test(PANEL_JS), false);
  assert.match(PANEL_JS, /Object\.assign\(stored, await sitzungLesen\('selectedCaseId'\)\)/);
});

test('Klarnamen stehen erst in der Fallwahl, nicht im Startzustand', () => {
  const intro = schnipsel(PANEL_HTML, '<section id="secIntro" class="hidden">', '</section>');
  assert.match(intro, /Namen betreuter Personen erscheinen erst/);
  assert.match(intro, /class="verdeckt" id="introVerdeckt"/);
  assert.equal(intro.includes('caseSelect'), false, 'im Startzustand darf keine Namensliste stehen');
  /* Die Zahl zeigt, DASS Faelle da sind - die Riegel zeigen die Form, nicht den Inhalt. */
  const leer = schnipsel(PANEL_JS, 'function updateEmptyState() {', '\nasync function ensureContent(');
  assert.match(leer, /introCaseCount/);
  assert.match(leer, /\[\.\.\.sel\.options\]\.filter\(o => o\.value\)\.length/);
});

test('Training ist an einem Band zu erkennen, das über allen Flächen steht', () => {
  assert.match(PANEL_JS, /function trainingBandZeigen\(an\) \{/);
  assert.match(PANEL_JS, /trainingBandZeigen\(true\);/);
  assert.match(PANEL_JS, /trainingBandZeigen\(false\);/);
  /* Ohne die Bandhoehe schoeben sich Schub und Trainingsflaeche darueber - die Aufzeichnung
     waere dann unsichtbar, obwohl sie laeuft. */
  assert.match(PANEL_JS, /setProperty\('--band'/);
  assert.match(PANEL_CSS, /\.schub\{ position:fixed; inset:var\(--band,0\) 0 0 0;/);
  assert.match(PANEL_CSS, /\.flaeche\{ position:fixed; inset:var\(--band,0\) 0 0 0;/);
});

test('Beide Farbsätze sind vollständig und decken sich', () => {
  const namen = (block) => new Set([...block.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  const hell = namen(schnipsel(PANEL_CSS, ':root{', '}'));
  const dunkel = namen(schnipsel(PANEL_CSS, ':root[data-theme="dark"]{', '}'));
  assert.deepEqual([...hell].sort(), [...dunkel].sort(), 'Ein Merkmal fehlt in einem der beiden Sätze');
  /* Die drei Zustaende: Systemvorgabe, ausdruecklich hell, ausdruecklich dunkel. */
  assert.match(PANEL_CSS, /@media \(prefers-color-scheme: dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{/);
  assert.match(OPTIONS_JS, /function themaAnwenden\(wert\)/);
  assert.match(OPTIONS_HTML, /id="themeSelect"/);
});

test('Das alte Reitersystem ist restlos verschwunden', () => {
  for (const rest of ['panelTabs', 'data-ptab', 'actiongrid', 'ptabs']) {
    assert.equal(PANEL_HTML.includes(rest), false, `Rest im Panel-HTML: ${rest}`);
  }
  for (const rest of ['data-ptab', 'dataset.tab', "$('kgText')", "$('kgAgent')"]) {
    assert.equal(PANEL_JS.includes(rest), false, `Rest in panel.js: ${rest}`);
  }
  assert.equal(OPTIONS_HTML.includes('data-opttab'), false, 'Die Optionsseite hat noch Reiter');
  assert.equal(OPTIONS_JS.includes("$('optTabs')"), false);
  /* Die Sprungleiste ersetzt sie - und kann anders als die Reiter nie ALLE Bereiche ausblenden. */
  assert.match(OPTIONS_JS, /const nav = \$\('optNav'\);/);
  assert.match(OPTIONS_HTML, /class="opt-nav" id="optNav"/);
});

test('Die Fußleiste bleibt stehen und verspricht nichts Automatisches', () => {
  const fuss = schnipsel(PANEL_HTML, '<footer class="p-fuss">', '</footer>');
  assert.match(fuss, /id="btnFill"/);
  assert.match(fuss, /id="btnAuswahl"/);
  assert.match(fuss, /id="btnSchub"/);
  assert.match(fuss, /Abgesendet wird nie automatisch\./);
  /* Der Koerper scrollt, Kopf und Fuss nicht - sonst waere der Ausfuellknopf wieder wegscrollbar. */
  assert.match(PANEL_CSS, /\.panelseite\{ display:flex; flex-direction:column; height:100vh; overflow:hidden; \}/);
  assert.match(PANEL_CSS, /\.panelseite > \.p-koerper\{ flex:1 1 auto; overflow-y:auto;/);
  assert.match(PANEL_CSS, /\.p-fuss\{ flex:0 0 auto;/);
});

test('Die Fassung steht überall gleich', () => {
  /* Vier Stellen tragen dieselbe Zahl: beide Manifeste, package.json und der Notnagel in
     panel.js. Nach dem Sprung 0.4.9 -> 0.5.0 (Umbau des Panels) fiel auf, dass es dafuer
     keine Wache gab - eine vergessene Stelle meldet dem Server sonst eine falsche Fassung. */
  const chrome = JSON.parse(quelle('manifest.chrome.json')).version;
  const firefox = JSON.parse(quelle('manifest.firefox.json')).version;
  const paket = JSON.parse(quelle('package.json')).version;
  assert.equal(chrome, paket, 'manifest.chrome.json weicht von package.json ab');
  assert.equal(firefox, paket, 'manifest.firefox.json weicht von package.json ab');
  const notnagel = /getManifest\(\)\.version\) \|\| '([^']+)'/.exec(PANEL_JS);
  assert.ok(notnagel, 'Der Notnagel in panel.js ist verschwunden');
  assert.equal(notnagel[1], paket, 'Der Notnagel in panel.js trägt eine andere Fassung');
});
