'use strict';
/* Falsche Wegweiser in Hinweistexten (Nutzerauftrag 30.08.2026, Punkt 3 der Modus-Bestandsaufnahme).
   Fünf Texte verwiesen auf Wege, die es so nicht (mehr) gibt. Sie sind besonders tückisch, weil sie
   nicht abstürzen - sie schicken Menschen nur an Orte, die es nicht gibt.

   Die Regel dahinter: Ein Wegweiser darf nur genannt werden, wenn er im JEWEILIGEN Modus stimmt.
   Wo die Ziele je Modus auseinandergehen, entscheidet window.__rechteVergabeOrt() zur Laufzeit. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

/* __rechteVergabeOrt in der Sandkiste ausführen - der Kern der Korrektur. */
function ortIn(welt) {
  const a = HTML.indexOf('window.__rechteVergabeOrt=function(){');
  assert.ok(a > 0, '__rechteVergabeOrt fehlt');
  const b = HTML.indexOf('\n  };', a);
  const ctx = { window: { __appMode: welt.modus, __currentUser: welt.nutzer || null } };
  vm.createContext(ctx);
  vm.runInContext(HTML.slice(a, b + 5) + '\nthis.__ort=window.__rechteVergabeOrt();', ctx);
  return ctx.__ort;
}

test('Rechte-Wegweiser nennt je Modus den Ort, den es dort wirklich gibt', () => {
  assert.strictEqual(ortIn({ modus: 'online', nutzer: { isAdmin: false } }), 'Einstellungen → Personen',
    'Online gibt es kein Admin-Panel mehr - der Bereich heißt „Personen"');
  /* 30.08., Standard-Umbau: das Admin-Panel ist in allen Betriebsarten ins Menue umgeleitet
     und „Personen" dort online-only - der lokale Wegweiser zeigt ehrlich auf die Online-Sitzung
     (Skeptiker-Fund: der alte Text zeigte auf eine seit dem Umbau unerreichbare Oberflaeche). */
  assert.strictEqual(ortIn({ modus: 'local', nutzer: { isAdmin: false } }), 'Einstellungen → Personen (im Online-Modus)',
    'Der lokale Wegweiser zeigt nicht auf die Online-Pflege');
  assert.strictEqual(ortIn({ modus: 'local', nutzer: null }), '',
    'Ohne Anmeldung (Datei-Betrieb) gibt es KEINEN solchen Ort - dann darf kein Weg genannt werden');
});

test('Die drei Nur-Lese-/Sperrhinweise nennen keinen festen Ort mehr', () => {
  /* Vorher stand in allen dreien fest „Admin-Panel → Nutzer" bzw. „Admin-Panel → Nutzer & Rechte". */
  assert.doesNotMatch(HTML, /vom Admin im Admin-Panel → Nutzer vergeben/,
    'Ein Nur-Lese-Hinweis nennt wieder fest das Admin-Panel');
  assert.doesNotMatch(HTML, /Zugangsdaten\/API-Keys verändern“ \(Admin-Panel → Nutzer & Rechte\)/,
    'Der Sperrhinweis nennt wieder fest das Admin-Panel');
  assert.match(HTML, /window\.__rechteVergabeOrt=function\(\)\{/, 'Der Helfer ist nicht definiert');
  const treffer = (HTML.match(/window\.__rechteVergabeOrt\(\)/g) || []).length;
  assert.strictEqual(treffer, 3,
    `Der Helfer wird ${treffer}× aufgerufen - erwartet: die drei Hinweise (2× Nur-Lese, 1× Sperrhinweis)`);
  assert.match(HTML, /in der Büro-Installation vergeben – diese Datei läuft ohne Anmeldung/,
    'Für den Datei-Betrieb fehlt die ehrliche Fassung ohne Wegweiser');
  /* LOCK_HINT war eine Konstante und stand damit schon beim Parsen fest - da war der Modus noch
     gar nicht bekannt. Jetzt eine Funktion, die zur Laufzeit fragt. */
  assert.match(HTML, /function LOCK_HINT\(\)\{/, 'LOCK_HINT ist keine Funktion mehr');
  assert.doesNotMatch(HTML, /const LOCK_HINT=/, 'LOCK_HINT ist wieder eine Konstante');
  for (const ruf of ['toast(LOCK_HINT());return}', 'div.textContent=LOCK_HINT();']) {
    assert.ok(HTML.includes(ruf), `Aufrufstelle nicht auf die Funktion umgestellt: ${ruf}`);
  }
});

test('Lokal-Modus-Tab beschreibt den Weg zu den Vorgaben so, wie er wirklich ist', () => {
  /* 30.08., zweite Runde: die Regression selbst ist behoben - der Umschalter [Lokal-Modus]
     erscheint für Admins im ONLINE eingebetteten Menü wieder (lokalVorgabenImEinbett).
     Text und Code müssen dieselbe Geschichte erzählen. */
  assert.doesNotMatch(HTML, /\(Admin → Einstellungen → Lokal-Modus\)/,
    'Der erfundene Pfad „Admin → Einstellungen → Lokal-Modus" steht wieder da');
  assert.match(HTML, /unter „Vorgaben für den Lokal-Modus" weiter unten auf dieser Seite/,
    'Der Hinweis auf den gebündelten Vorgaben-Ort fehlt');
  assert.match(HTML, /Admins <strong>im Online-Modus<\/strong>/,
    'Der Hinweis, dass die Pflege die Online-Sitzung braucht, fehlt');
  /* Der gebündelte Ort selbst: alle vier Vorgaben-Reiter, nur für Online-Admins gerendert.
     Ohne ihn wären die KI-/Karten-/Stammdaten-Vorgaben online weiter unerreichbar - deren
     Bereiche haben eigene Renderer OHNE den [Lokal-Modus]-Umschalter. */
  assert.match(HTML, /<h3>Vorgaben für den Lokal-Modus<\/h3>/,
    'Der gebündelte Vorgaben-Ort im Bereich „Lokaler Modus" fehlt');
  for (const t of ['ai', 'send', 'maps', 'office']) {
    assert.ok(HTML.includes(`data-ld-menue-tab="${t}"`), `Der Vorgaben-Reiter „${t}" fehlt`);
  }
  assert.match(HTML, /const ldSeg=\(window\.__appMode==='online'&&window\.__currentUser&&window\.__currentUser\.isAdmin\)\?/,
    'Der gebündelte Ort ist nicht auf Online-Admins begrenzt (lokal gäbe es nur 403)');
  assert.match(HTML, /renderLocalDefaultsTab\(host,tab\);/,
    'Der gebündelte Ort nutzt nicht den bestehenden Vorgaben-Renderer');
  assert.doesNotMatch(HTML, /nur im <strong>lokal geöffneten<\/strong> Admin-Panel/,
    'Der überholte Satz von der Nur-lokal-Erreichbarkeit steht wieder da');
  /* Der Code dazu: eingebettet erscheint der Umschalter genau dann, wenn ein Admin online
     arbeitet - die local-defaults-Routen liegen selbst hinter requireOnlineMode. */
  assert.match(HTML, /function lokalVorgabenImEinbett\(\)\{/,
    'Die Freigabe-Funktion für den eingebetteten Umschalter fehlt');
  assert.match(HTML, /return window\.__appMode==='online'&&!!\(window\.__currentUser&&window\.__currentUser\.isAdmin\);/,
    'Die Freigabe prüft nicht mehr Online-Sitzung UND Admin');
  assert.match(HTML, /if\(opts&&opts\.nurOnline&&!lokalVorgabenImEinbett\(\)\)body\.innerHTML='<div id="adminSettingsModeBody">/,
    'Der Umschalter hängt eingebettet nicht mehr an der Freigabe');
  assert.match(HTML, /if\(\(!\(opts&&opts\.nurOnline\)\|\|lokalVorgabenImEinbett\(\)\)&&settingsMode==='local'\)\{await renderLocalDefaultsTab/,
    'Der Lokal-Vorgaben-Reiter hängt eingebettet nicht mehr an der Freigabe');
  /* Die Nicht-Admin-Absicht von nurOnline bleibt wortgleich - sie hängt an isAdmin, nicht
     an der Umschalter-Frage (caldav: persönliche Fassung für Nicht-Admins). */
  assert.match(HTML, /const nurPers=!!\(opts&&opts\.nurOnline\)&&!\(window\.__currentUser&&window\.__currentUser\.isAdmin\);/,
    'Die Nicht-Admin-Fassung der Kalenderverbindungen ist beim Umbau verloren gegangen');
  /* Der Zugangsdatenexport ist aus dem (überall umgeleiteten) Admin-Panel-Fuß in den Bereich
     „Lokaler Modus" umgezogen - sonst wäre er verwaist. */
  assert.match(HTML, /window\.downloadAllCredentialsHTML&&window\.downloadAllCredentialsHTML\(\)/,
    'Der Zugangsdatenexport hat keinen Platz mehr im Bereich „Lokaler Modus"');
});

test('Theme-Karte behauptet keinen falschen Speicherort mehr', () => {
  assert.doesNotMatch(HTML, /Die Vorgabe wird pro Benutzer in büro\.json gespeichert/,
    'Die Behauptung „büro.json" ist zurück - dort liegt die Vorliebe nirgends');
  assert.match(HTML, /Die Vorgabe wird pro Benutzer auf dem Server gespeichert und gilt auf allen Ihren Geräten\./,
    'Der Online-Fall wird nicht mehr richtig beschrieben');
  assert.match(HTML, /Die Vorgabe gilt nur in diesem Browser – sie wird nicht auf den Server übertragen\./,
    'Der Lokal-Fall wird nicht mehr richtig beschrieben');
});

test('Die beiden toten Verweise auf einen „Zugangsdaten-Dialog" sind weg', () => {
  assert.doesNotMatch(HTML, /Konto & Anmeldung -> „Zugangsdaten-Dialog öffnen"/,
    'Der Verweis auf einen nie existierenden Knopf steht wieder im Code');
  assert.doesNotMatch(HTML, /aus Konto & Anmeldung erreichbar/,
    'Der zweite tote Verweis auf „Konto & Anmeldung" ist zurück');
  /* Gegenprobe am echten Aufbau: der Bereich „Konto & Anmeldung" enthält nur den Passwort-Weg. */
  const a = HTML.indexOf('function einSeiteKonto()');
  assert.ok(a > 0, 'einSeiteKonto nicht gefunden');
  const seite = HTML.slice(a, a + 1500);
  assert.doesNotMatch(seite, /Zugangsdaten-Dialog/,
    'Falls der Dialog dort doch eingebaut wurde, muss der Hinweistext wieder darauf zeigen');
});
