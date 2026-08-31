'use strict';

/* DTSTAMP der Kalender-/Aufgabenausfuhr (Fund 31.08.2026).

   Bis dahin stand in der Auslieferung:

     `DTSTAMP:${isoToIcsDateTime(new Date().toISOString())}Z`

   isoToIcsDateTime liest die LOKALEN Bestandteile eines Zeitpunkts (getHours & Co.). Das
   angehaengte "Z" behauptet aber UTC. In deutscher Sommerzeit ging der Zeitstempel damit zwei
   Stunden vor. RFC 5545 verlangt DTSTAMP in UTC, und Kalenderprogramme entscheiden anhand dieses
   Feldes, welche Fassung eines Termins die neuere ist - ein vorgestellter Zeitstempel laesst eine
   alte Ausfuhr eine echte Aenderung ueberstimmen.

   Gemessen wird die Auslieferungsdatei selbst: der Helfer wird herausgeschnitten und ausgefuehrt.
   Die Zusagen sind zeitzonenunabhaengig - sie gelten auf jedem Rechner gleich. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

function schnipsel(von, bis) {
  const a = html.indexOf(von);
  assert.ok(a >= 0, `Anker fehlt in der Auslieferungsdatei: ${von}`);
  assert.equal(html.indexOf(von, a + 1), -1, `Anker ist nicht eindeutig: ${von}`);
  const b = html.indexOf(bis, a);
  assert.ok(b > a, `Endanker fehlt hinter "${von}": ${bis}`);
  return html.slice(a, b);
}

test('icsUtcStamp liefert echte UTC-Bestandteile, nicht die Ortszeit', () => {
  const quelle = schnipsel('function icsUtcStamp(date){', 'function isoToIcsDateOnly(');
  const umgebung = { result: null };
  vm.runInNewContext(`${quelle}\nresult = icsUtcStamp;`, umgebung);

  /* 12:00 UTC ist in deutscher Sommerzeit 14:00 Ortszeit. Der Zeitstempel muss 12 melden -
     unabhaengig davon, in welcher Zeitzone dieser Pruefstand laeuft. */
  assert.equal(umgebung.result(new Date('2026-08-31T12:00:00Z')), '20260831T120000Z');
  /* Winterzeit (UTC+1) und ein Tageswechsel ueber Mitternacht hinweg. */
  assert.equal(umgebung.result(new Date('2026-01-15T23:30:15Z')), '20260115T233015Z');
  assert.equal(umgebung.result(new Date('2026-01-15T00:05:00Z')), '20260115T000500Z');

  /* Ohne Argument der aktuelle Zeitpunkt - Form und UTC-Kennung muessen stimmen. */
  const jetzt = umgebung.result();
  assert.match(jetzt, /^\d{8}T\d{6}Z$/);
  assert.equal(jetzt.slice(0, 8), new Date().toISOString().slice(0, 10).replace(/-/g, ''));
});

test('Die Ausfuhr stempelt Termine und Aufgaben mit icsUtcStamp', () => {
  const treffer = html.match(/DTSTAMP:\$\{icsUtcStamp\(\)\}/g) || [];
  assert.equal(treffer.length, 2, 'DTSTAMP muss in VEVENT UND VTODO ueber icsUtcStamp laufen.');
});

test('Die alte Mischung aus Ortszeit und angehaengtem Z ist verschwunden', () => {
  assert.equal(
    html.includes('isoToIcsDateTime(new Date().toISOString())}Z'),
    false,
    'Ortszeit-Bestandteile duerfen nicht mehr mit einem "Z" als UTC ausgegeben werden.'
  );
  /* Auch keine andere Stelle darf das Muster "isoToIcsDateTime(...)Z" tragen: isoToIcsDateTime
     liefert bewusst eine schwebende Ortszeit (fuer DTSTART/DTEND korrekt), nie eine UTC-Angabe. */
  assert.equal((html.match(/isoToIcsDateTime\([^)]*\)\}Z/g) || []).length, 0);
});
