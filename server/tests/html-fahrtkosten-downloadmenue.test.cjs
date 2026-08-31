'use strict';

/* Download-Menüs im Fahrtkostennachweis (Nutzerwunsch 31.08.2026).

   Vorher stand je Jahr eine flache Knopfreihe: drei Ausfuhrknöpfe pro Fahrzeug (Excel/ODS/PDF)
   und zwei pro Fahrer:in. Bei drei Fahrzeugen und zwei Personen sind das dreizehn Knöpfe
   nebeneinander, die die eigentliche Fahrtentabelle aus dem Bild schoben.

   Jetzt führen genau zwei Knöpfe je Jahr ("nach Fahrzeug", "nach Fahrer:in") je ein Aufklappfeld
   mit einer Zeile pro Fahrzeug bzw. Person. Die Ausfuhrwege selbst sind unverändert - geprüft
   wird, dass sie mit denselben Argumenten gerufen werden.

   Gemessen wird die Auslieferungsdatei: die Bausteine werden herausgeschnitten und ausgeführt. */

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

const FAHRTEN = [
  { id: 't1', datum: '05.02.2026', vehicleId: 'v2', fahrerUserId: 'u2', kilometer: 40, erstattungsbetrag: 12 },
  { id: 't2', datum: '09.03.2026', vehicleId: 'v3', fahrerUserId: 'u1', kilometer: 12, erstattungsbetrag: 3.6 },
  { id: 't3', datum: '11.04.2026', vehicleId: 'v1', fahrerUserId: 'u2', kilometer: 60, erstattungsbetrag: 18 }
];
const KENNZEICHEN = { v1: 'BIN-RB 2026', v2: 'BIN-RB 47', v3: 'GOH-CZ-5556' };
const FAHRER = { u1: 'Zepp, Christoph', u2: 'Adam, Berta' };

function jahresblock(fahrten = FAHRTEN) {
  const quelle = schnipsel('function mileageYearBlocksHTML(){', '\nwindow.__mileageVehicleEdit=');
  const roh = (v) => String(v == null ? '' : v);
  const umgebung = {
    mileageTrips: fahrten,
    filteredMileageTrips: () => fahrten,
    mileageSelectedTripIds: new Set(),
    tripYear: (d) => String(d).slice(-4),
    vehicleLabel: (id) => KENNZEICHEN[id] || id,
    mileageDriverLabel: (id) => FAHRER[id] || '',
    tripRowHTML: () => '<tr></tr>',
    fmtKm: (n) => `${n} km`,
    fmtEuro3: (n) => `${n} €`,
    esc: roh,
    escAttr: (v) => roh(v).replace(/"/g, '&quot;'),
    /* Der Ausschnitt enthält auch die Menüsteuerung; sie verdrahtet sich beim Laden. */
    window: {},
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    result: null
  };
  vm.runInNewContext(`${quelle}\nresult = mileageYearBlocksHTML();`, umgebung);
  return umgebung.result;
}

test('Je Jahr genau zwei Sammelknöpfe statt einer Knopfreihe', () => {
  const aus = jahresblock();
  const trigger = aus.match(/class="btn light mileage-dl-trigger"/g) || [];
  assert.equal(trigger.length, 2, 'es müssen genau zwei Auslöser sein');
  assert.match(aus, /Download nach Fahrzeug 2026 \(3\)/);
  assert.match(aus, /Download nach Fahrer:in 2026 \(2\)/);
  /* Die alte Beschriftung mit angehängtem Format darf nicht zurückkommen. */
  assert.equal(/>[^<]*\(Excel\)<\/button>/.test(aus), false, 'die flache Knopfreihe ist zurück');
  assert.equal(aus.includes('(Excel, pro Fahrer:in)'), false);
});

test('Das Aufklappfeld führt eine Zeile je Fahrzeug mit drei Formaten', () => {
  const aus = jahresblock();
  const felder = aus.match(/<div class="mileage-dl-panel"[\s\S]*?<\/div><\/span>/g) || [];
  assert.equal(felder.length >= 2, true, 'zwei Felder erwartet');
  const kfz = felder[0];
  const zeilen = kfz.match(/class="mileage-dl-row"/g) || [];
  assert.equal(zeilen.length, 3, 'je Fahrzeug eine Zeile');
  for (const kennzeichen of Object.values(KENNZEICHEN)) {
    assert.ok(kfz.includes(kennzeichen), `Fahrzeug fehlt: ${kennzeichen}`);
  }
  assert.equal((kfz.match(/>Excel</g) || []).length, 3);
  assert.equal((kfz.match(/>ODS</g) || []).length, 3);
  assert.equal((kfz.match(/>PDF</g) || []).length, 3);
});

test('Die Ausfuhrwege werden unverändert mit Fahrzeug und Jahr gerufen', () => {
  const aus = jahresblock();
  assert.match(aus, /window\.__mileageExport\('v1','2026'\)/);
  assert.match(aus, /window\.__mileageExportOds\('v2','2026'\)/);
  assert.match(aus, /window\.__mileageExportPdf\('v3','2026'\)/);
  assert.match(aus, /window\.__mileageExportDriver\('u1','2026'\)/);
  assert.match(aus, /window\.__mileageExportDriverOds\('u2','2026'\)/);
  /* Jede Auswahl schließt zuerst das Feld - sonst bleibt es über der Tabelle stehen. */
  const auswahlen = aus.match(/window\.__mileageDlWaehlen\(this\);/g) || [];
  assert.equal(auswahlen.length, 13, 'jede Formatzeile muss das Feld schließen');
});

test('Fahrzeuge und Personen stehen alphabetisch, nicht in Fahrtenreihenfolge', () => {
  const aus = jahresblock();
  const namen = [...aus.matchAll(/class="mileage-dl-name"[^>]*>([^<]+)</g)].map((m) => m[1]);
  /* numerisch bewusst: "BIN-RB 47" gehört vor "BIN-RB 2026". */
  assert.deepEqual(namen.slice(0, 3), ['BIN-RB 47', 'BIN-RB 2026', 'GOH-CZ-5556']);
  assert.deepEqual(namen.slice(3), ['Adam, Berta', 'Zepp, Christoph']);
});

test('Ohne Fahrer:in bleibt das Feld erklärt leer', () => {
  const aus = jahresblock([{ id: 't9', datum: '01.05.2026', vehicleId: 'v1', kilometer: 5, erstattungsbetrag: 1.5 }]);
  assert.match(aus, /Download nach Fahrer:in 2026</, 'ohne Personen keine Zahl in der Beschriftung');
  assert.match(aus, /mileage-dl-empty">Keine Fahrer:in hinterlegt\./);
});

test('Die Bedienung: aufklappen, wechseln, schließen', () => {
  const quelle = schnipsel('window.__mileageDlToggle=function(kennung){', 'window.__mileageVehicleEdit=');
  /* Kleine DOM-Attrappe: zwei Felder mit ihren Auslösern. */
  const bauen = () => {
    const felder = {};
    const mk = (id) => ({
      id, versteckt: true, style: {},
      hasAttribute: () => felder[id].versteckt,
      removeAttribute() { felder[id].versteckt = false; },
      setAttribute() { felder[id].versteckt = true; },
      getBoundingClientRect: () => ({ left: 40 })
    });
    const knoepfe = {};
    const mkKnopf = (id) => ({ id, aria: 'false', setAttribute(_n, v) { knoepfe[id].aria = v; }, getAttribute: () => knoepfe[id].aria });
    for (const id of ['a', 'b']) { felder[id] = mk(id); knoepfe[id + '_btn'] = mkKnopf(id + '_btn'); }
    const dokument = {
      getElementById: (id) => felder[id] || knoepfe[id] || null,
      querySelectorAll: (sel) => (sel.includes('not([hidden])') ? Object.values(felder).filter((f) => !f.versteckt) : Object.values(felder)),
      querySelector: (sel) => dokument.querySelectorAll(sel)[0] || null,
      addEventListener() {}
    };
    return { felder, knoepfe, dokument };
  };
  const { felder, knoepfe, dokument } = bauen();
  const umgebung = { window: {}, document: dokument };
  vm.runInNewContext(quelle, umgebung);

  umgebung.window.__mileageDlToggle('a');
  assert.equal(felder.a.versteckt, false, 'Feld öffnet nicht');
  assert.equal(knoepfe.a_btn.aria, 'true', 'aria-expanded wird nicht gesetzt');

  umgebung.window.__mileageDlToggle('b');
  assert.equal(felder.a.versteckt, true, 'das erste Feld bleibt offen');
  assert.equal(knoepfe.a_btn.aria, 'false');
  assert.equal(felder.b.versteckt, false);

  umgebung.window.__mileageDlToggle('b');
  assert.equal(felder.b.versteckt, true, 'ein zweiter Klick schließt nicht');

  umgebung.window.__mileageDlToggle('a');
  umgebung.window.__mileageDlWaehlen();
  assert.equal(felder.a.versteckt, true, 'die Auswahl schließt das Feld nicht');
});

test('Escape schließt nur das Feld, nicht das ganze Fenster', () => {
  const quelle = schnipsel('if(!window.__mileageDlVerdrahtet){', 'window.__mileageVehicleEdit=');
  assert.match(quelle, /ev\.key!=='Escape'/);
  assert.match(quelle, /ev\.stopPropagation\(\)/, 'ohne stopPropagation schließt Escape das Modal mit');
  assert.match(quelle, /if\(!document\.querySelector\('\.mileage-dl-panel:not\(\[hidden\]\)'\)\)return;/,
    'ohne offenes Feld darf Escape nicht abgefangen werden');
});
