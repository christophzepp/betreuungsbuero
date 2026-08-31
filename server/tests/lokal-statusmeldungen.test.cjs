'use strict';
/* Falschmeldungen im lokalen Zugangsdaten-Status (Nutzerauftrag 30.08.2026, Punkt 1 der
   Modus-Bestandsaufnahme). Zwei Behauptungen waren fest verdrahtet statt gerechnet:

   1. Karten: `effectiveConfigured:(own&&can)||adm||true` - der angehaengte `||true` machte den
      Ausdruck IMMER wahr. Die Karte meldete "konfiguriert", auch wenn Google oder HERE ohne
      Schluessel gewaehlt war.
   2. Mail:   `adminConfigured:true, effectiveConfigured:true` - fest verdrahtet, obwohl eine
      LOKALE Sitzung die Mail-Routen gar nicht erreichen kann (/api/my-settings sitzt hinter
      requireOnlineMode, server/index.js) und der Browser den Zustand somit nicht kennen kann.

   Der Test FUEHRT msLocalStatus() aus, statt Zeichenketten zu pinnen - bei einem Rechenfehler
   ist nur das ein Nachweis. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

/* Nur die beiden Funktionen herausschneiden, die geprueft werden. */
function quelltext(anfang, ende) {
  const a = HTML.indexOf(anfang);
  assert.ok(a > 0, `Nicht gefunden: ${anfang}`);
  const b = HTML.indexOf(ende, a);
  assert.ok(b > a, `Ende nicht gefunden: ${ende}`);
  return HTML.slice(a, b);
}

/* msLocalStatus in einer Sandkiste laufen lassen. `welt` liefert die Aussenwelt:
   Browser-KI-Konfiguration, Versandwerte, Kartenwerte, Admin-Vorgaben, Rechte, Anmeldung. */
function status(welt) {
  const src = quelltext('function msLocalStatus(){', '\nfunction localReset(');
  const ctx = {
    window: {
      __localDefaults: welt.adminVorgaben || {},
      __currentUser: welt.angemeldet === false ? null : (welt.nutzer || { isAdmin: true }),
      bueroLocal: { mapSettings: welt.karten || {} },
    },
    AI_PROVIDERS: ['openai', 'anthropic'],
    ensureAIConfig: () => welt.ki || {},
    getExportGlobal: () => welt.versand || {},
  };
  ctx.may = (recht) => {
    const u = ctx.window.__currentUser || {};
    return !!(u.isAdmin || u[recht]);
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.__ergebnis=msLocalStatus();', ctx);
  return ctx.__ergebnis;
}

test('Karten: OpenStreetMap gilt als nutzbar - es braucht keinen Schlüssel', () => {
  const a = status({ karten: {} }).areas.maps;
  assert.strictEqual(a.effectiveConfigured, true,
    'OSM ist ohne Schlüssel nutzbar und muss als konfiguriert gelten');
  const b = status({ karten: { activeProvider: 'osm' } }).areas.maps;
  assert.strictEqual(b.effectiveConfigured, true, 'Ausdrücklich gewähltes OSM ebenso');
});

test('Karten: Google/HERE OHNE Schlüssel melden nicht mehr fälschlich „konfiguriert"', () => {
  /* Genau der gemeldete Fehler: vorher lieferte der `||true` hier true. */
  const g = status({ karten: { activeProvider: 'google' } }).areas.maps;
  assert.strictEqual(g.effectiveConfigured, false,
    'Google ohne Schlüssel darf nicht als konfiguriert gelten');
  const h = status({ karten: { activeProvider: 'here' } }).areas.maps;
  assert.strictEqual(h.effectiveConfigured, false,
    'HERE ohne Schlüssel darf nicht als konfiguriert gelten');
});

test('Karten: mit Schlüssel - eigener wie Admin-Vorgabe - gilt der Anbieter als konfiguriert', () => {
  const eigen = status({ karten: { activeProvider: 'google', googleMapsApiKey: 'AIza-test' } }).areas.maps;
  assert.strictEqual(eigen.effectiveConfigured, true, 'Eigener Google-Schlüssel zählt');
  const vorgabe = status({
    karten: { activeProvider: 'here' },
    adminVorgaben: { maps: { hereApiKey: 'here-test' } },
  }).areas.maps;
  assert.strictEqual(vorgabe.effectiveConfigured, true, 'Admin-Vorgabe für HERE zählt');
  /* Der Schlüssel des FALSCHEN Anbieters darf nicht zählen. */
  const quer = status({ karten: { activeProvider: 'here', googleMapsApiKey: 'AIza-test' } }).areas.maps;
  assert.strictEqual(quer.effectiveConfigured, false,
    'Ein Google-Schlüssel macht HERE nicht nutzbar');
});

test('Mail: lokal „unbekannt" statt behauptetem „konfiguriert"', () => {
  const mitServer = status({ nutzer: { isAdmin: true } }).areas.mail;
  assert.strictEqual(mitServer.effectiveConfigured, null,
    'Lokal ist der Mailzustand nicht abfragbar - null (unbekannt), nicht true');
  assert.strictEqual(mitServer.adminConfigured, null, 'Auch die Admin-Vorgabe ist unbekannt');
  assert.strictEqual(mitServer.serverManaged, true, 'Serververwaltung bleibt die Wahrheit');
  assert.strictEqual(mitServer.ohneServer, false, 'Mit angemeldetem Konto läuft ein Server');
});

test('Mail: ohne Server (Datei-Betrieb) ist Versand sicher nicht möglich', () => {
  const ohne = status({ angemeldet: false }).areas.mail;
  assert.strictEqual(ohne.ohneServer, true, 'Ohne Konto liegt der Datei-Betrieb vor');
  assert.strictEqual(ohne.effectiveConfigured, false,
    'Ohne Server ist der Zustand nicht unbekannt, sondern sicher „nicht möglich"');
});

test('Die übrigen Bereiche rechnen unverändert weiter', () => {
  /* Schutz gegen Kollateralschaden: KI und Versand dürfen von der Änderung unberührt sein. */
  const leer = status({});
  assert.strictEqual(leer.areas.ai.effectiveConfigured, false, 'Ohne Schlüssel keine KI');
  assert.strictEqual(leer.areas.send.effectiveConfigured, false, 'Ohne Zugangsdaten kein Versand');
  const voll = status({
    ki: { openai: { apiKey: 'sk-test' } },
    versand: { eboUsername: 'nutzer' },
  });
  assert.strictEqual(voll.areas.ai.effectiveConfigured, true, 'Eigener KI-Schlüssel zählt');
  assert.strictEqual(voll.areas.send.effectiveConfigured, true, 'Eigene Versanddaten zählen');
});

test('Anzeige: der dritte Zustand wird als „nicht prüfbar" ausgewiesen', () => {
  /* cardHTML hängt an zu vielen Nachbarn für die Sandkiste - hier reichen die Textanker. */
  assert.match(HTML, /const cfgTxt=st\.effectiveConfigured===null\?'von hier nicht prüfbar':\(st\.effectiveConfigured\?'konfiguriert':'nicht gesetzt'\);/,
    'Der unbekannte Zustand wird nicht als solcher angezeigt');
  assert.match(HTML, /Im Lokal-Modus lässt sich sein Zustand von hier aus nicht abfragen/,
    'Der ehrliche Mailtext für den Lokal-Modus fehlt');
  assert.match(HTML, /Diese Datei arbeitet ohne Server – von hier aus kann nichts versendet werden\./,
    'Der Mailtext für den Datei-Betrieb fehlt');
  assert.doesNotMatch(HTML, /Der Mail-Versand \(SMTP\) wird serverseitig verwaltet \(modusunabhängig\)/,
    'Die alte Behauptung „modusunabhängig" steht noch im Code');
  assert.doesNotMatch(HTML, /effectiveConfigured:\(own&&can\)\|\|adm\|\|true/,
    'Der immer-wahre Kartenausdruck ist zurück');

  /* Die beiden anderen Leser von effectiveConfigured sind online-only und beziehen ihre Daten
     vom Server (der nie null liefert) - sie dürfen nicht versehentlich lokal laufen. */
  assert.match(HTML, /if\(window\.__appMode!=='online'\)return `<div class="phase6-section"><h3>Aktuell verwendete Zugangsdaten<\/h3>/,
    'Die Zugangsdaten-Tabelle der Systemdiagnose ist nicht mehr online-gegatet');
});
