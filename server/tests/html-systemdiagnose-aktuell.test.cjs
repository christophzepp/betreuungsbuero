'use strict';

/* Systemdiagnose auf dem Stand der heutigen Software (31.08.2026).

   Die Diagnose stammte aus der Zeit, als die Anwendung eine Ein-Personen-Software mit Excel- und
   PDF-Ausgabe war. Sie zeigte Programmfassung, Browser, Adressverzeichnis und den JSON/Excel-
   Sicherungsstand - und behauptete im Online-Betrieb "JSON aktuell", obwohl dort der Server die
   Daten führt. Von Betriebsarten, Serververbindung, Echtzeit-Abgleich, Postfächern,
   Kalenderverbindungen, Banking, Personenregister und Dokumentenspeicher wusste sie nichts.

   Dieser Prüfstand hält den neuen Umfang fest. Er misst die Auslieferungsdatei selbst und führt
   die Bausteine im vm aus - kein Nachbau. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

function schnipsel(von, bis) {
  const a = html.indexOf(von);
  assert.ok(a >= 0, `Anker fehlt: ${von}`);
  assert.equal(html.indexOf(von, a + 1), -1, `Anker nicht eindeutig: ${von}`);
  const b = html.indexOf(bis, a);
  assert.ok(b > a, `Endanker fehlt hinter "${von}": ${bis}`);
  return html.slice(a, b);
}

test('Die Diagnose kennt alle vier Betriebsarten', () => {
  const quelle = schnipsel('function betriebsart(){', 'function echtzeitZustand(){');
  for (const [zustand, erwartet] of [
    [{ __appMode: 'online' }, 'Online-Betrieb (Server)'],
    [{ __appMode: 'local' }, 'Lokaler Betrieb (nur dieser Browser)'],
    [{ __demoModus: true }, 'Vorführung (Demo-Modus)'],
    [{ __adSnapshotId: 'ad-1' }, 'Außendienstdatei']
  ]) {
    const umgebung = { window: zustand, result: null };
    umgebung.window.__runtimeCapabilities = undefined;
    vm.runInNewContext(`${quelle}\nresult = betriebsart();`, umgebung);
    assert.equal(umgebung.result.text, erwartet);
  }
});

test('Der Wiederherstellungsmodus wird als solcher gemeldet', () => {
  const quelle = schnipsel('function betriebsart(){', 'function echtzeitZustand(){');
  const umgebung = {
    window: { __appMode: 'online', __runtimeCapabilities: () => ({ mode: 'online', recoveryMode: true }) },
    result: null
  };
  vm.runInNewContext(`${quelle}\nresult = betriebsart();`, umgebung);
  assert.equal(umgebung.result.recovery, true);
});

test('Die Funktionsprüfung nennt Zweck und Bedeutung je Betriebsart', () => {
  const quelle = schnipsel('function supportRows(){', '/* --- Bausteine der Diagnose');
  const bauen = (fensterZustand) => {
    const umgebung = { window: Object.assign({ URL: {}, Blob: {}, crypto: { subtle: {} }, indexedDB: {}, localStorage: null }, fensterZustand), navigator: {}, PDFLib: {}, XLSX: {}, WebSocket: function () {}, Notification: function () {}, localStorage: { setItem() {}, removeItem() {} }, result: null };
    umgebung.navigator.clipboard = {};
    vm.runInNewContext(`${quelle}\nresult = supportRows();`, umgebung);
    return umgebung.result;
  };
  const online = bauen({ __appMode: 'online' });
  const lokal = bauen({ __appMode: 'local' });

  /* Jede Zeile traegt vier Angaben: Name, Verfuegbarkeit, WOFUER sie gebraucht wird, und ob sie
     in dieser Betriebsart ueberhaupt zaehlt. Die dritte und vierte Angabe sind neu - vorher stand
     "Ordnerauswahl: nicht verfuegbar" als Warnung in jedem Safari-Fenster, obwohl im Online-
     Betrieb niemand sie braucht. */
  for (const zeile of online) {
    assert.equal(zeile.length, 4, `Zeile ohne Zweck/Relevanz: ${zeile[0]}`);
    assert.ok(String(zeile[2]).length > 5, `Zweck fehlt bei ${zeile[0]}`);
  }
  const ordner = (rows) => rows.find((r) => r[0] === 'Ordnerauswahl');
  assert.equal(ordner(online)[3], false, 'Ordnerauswahl zählt online nicht.');
  assert.equal(ordner(lokal)[3], true, 'Ordnerauswahl zählt im Lokalbetrieb sehr wohl.');
  const namen = online.map((r) => r[0]);
  for (const neu of ['Web Crypto', 'WebSocket', 'Benachrichtigungen']) {
    assert.ok(namen.includes(neu), `Neue Prüfung fehlt: ${neu}`);
  }
});

test('Die Ausgabe deckt die heutigen Bereiche ab', () => {
  const koerper = schnipsel('  async function diagnosticBody(){', '  window.showSystemDiagnostics=');
  for (const abschnitt of [
    'Betrieb und Verbindung', 'Datenbestand', 'Anbindungen', 'Sicherung',
    'Browser- und Funktionsprüfung', 'Vorlagen und Formulare', 'Datenmigrationen', 'Fehlerprotokoll'
  ]) {
    assert.ok(koerper.includes(abschnitt) || html.includes(`'${abschnitt}'`) || html.includes(`>${abschnitt}<`),
      `Abschnitt fehlt in der Diagnose: ${abschnitt}`);
  }
  /* Die Ablage-Karte darf im Online-Betrieb nicht mehr "JSON aktuell" behaupten. */
  assert.ok(koerper.includes('Server führt die Daten'), 'Online fehlt die Aussage, wer die Daten führt.');
  assert.ok(koerper.includes("b.schluessel==='online'"), 'Die Ablage-Karte unterscheidet die Betriebsart nicht.');
});

test('Der Supportbericht nennt Betriebsart, Anmeldung und Echtzeit-Zustand', () => {
  const quelle = schnipsel('function reportText(){', 'window.phase6CopySupportReport');
  for (const zeile of ['Betriebsart: ', 'Angemeldet: ', 'Echtzeit-Abgleich: ']) {
    assert.ok(quelle.includes(zeile), `Supportbericht ohne "${zeile.trim()}"`);
  }
});

test('Der Echtzeit-Abgleich lässt sich von außen abfragen', () => {
  assert.ok(html.includes('window.__onlineRealtime={joinCase,leaveCase,flush:flushNow,'),
    'Der Realtime-Baustein exportiert seinen Zustand nicht.');
  assert.ok(html.includes('zustand:function(){'), 'Zustandsfenster fehlt.');
});

test('Die Serverroute liefert die Zahlen, die die Diagnose zeigt', () => {
  const routen = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'settings', 'status-routes.js'), 'utf8'
  );
  for (const feld of ['out.termine', 'out.aufgaben', 'out.dokumente', 'out.rechnungen', 'out.belege',
    'out.mailkonten', 'out.kalenderverbindungen', 'out.bankverbindungen', 'out.sicherung']) {
    assert.ok(routen.includes(feld), `Statusroute liefert ${feld} nicht.`);
  }
  /* Jedes neue Feld haengt an einem Recht - sonst verriete der Indikator Bestandsgroessen an
     Personen, die den Bereich gar nicht sehen duerfen. */
  for (const wache of ['s.canViewCases', 's.canViewDocuments', 's.canViewFinance',
    's.canManageMailSettings', 's.canManageCalendarConnections', 's.canViewBankData']) {
    assert.ok(routen.includes(wache), `Rechteprüfung fehlt: ${wache}`);
  }
});
