'use strict';

/* UNTIL in Serienterminen (Fund 31.08.2026).

   RFC 5545 (3.3.10) verlangt, dass UNTIL dieselbe Wertart traegt wie DTSTART:

     DTSTART;VALUE=DATE:20260901      ->  UNTIL=20260930
     DTSTART:20260901T090000          ->  UNTIL=20260930T235959      (schwebende Ortszeit)
     DTSTART:20260901T070000Z         ->  UNTIL=20260930T235959Z     (UTC)

   Bis dahin schrieben BEIDE Ausgabewege - die ICS-Ausfuhr der App und der CalDAV-Push des
   Servers - ausnahmslos die UTC-Form. Bei ganztaegigen Serien ist das nach der Norm unzulaessig;
   strenge Gegenstellen (Outlook/Exchange, manche CalDAV-Server) verwerfen dann die Wiederholung
   oder den ganzen Termin. Beim Empfaenger kam der Serientermin als Einzeltermin oder gar nicht an.

   Geprueft werden die echten Bausteine des Servers und der herausgeschnittene Code der
   Auslieferungsdatei - kein Nachbau. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const recurrence = require('../src/modules/calendar/recurrence.js');
const caldav = require('../src/integrations/calendar/caldav.js');

const MODELL = JSON.stringify({ freq: 'weekly', interval: 1, until: '2026-09-30', count: 0 });

test('modelToRRule waehlt die Wertart von UNTIL nach dem Startwert', () => {
  assert.equal(recurrence.modelToRRule(MODELL, 'date'), 'FREQ=WEEKLY;UNTIL=20260930');
  assert.equal(recurrence.modelToRRule(MODELL, 'floating'), 'FREQ=WEEKLY;UNTIL=20260930T235959');
  assert.equal(recurrence.modelToRRule(MODELL, 'utc'), 'FREQ=WEEKLY;UNTIL=20260930T235959Z');
  /* Ohne Angabe bleibt es bei der bisherigen UTC-Form - Aufrufer ohne Kenntnis der Wertart
     sollen sich nicht still veraendern. */
  assert.equal(recurrence.modelToRRule(MODELL), 'FREQ=WEEKLY;UNTIL=20260930T235959Z');
});

test('Der Rueckweg liest beide Formen gleich - der Umbau ist verlustfrei', () => {
  for (const form of ['date', 'floating', 'utc']) {
    const modell = recurrence.rruleToModel(recurrence.modelToRRule(MODELL, form));
    assert.equal(modell.until, '2026-09-30', `Rueckweg verliert das Enddatum bei Form "${form}"`);
    assert.equal(modell.freq, 'weekly');
  }
});

test('CalDAV: Ganztagsserie traegt ein DATE, getaktete Serie eine schwebende Zeit', () => {
  const ganztags = caldav.buildVevent({
    uid: 'x1', title: 'Ganztagsserie', startAt: '2026-09-01T00:00:00',
    endAt: '2026-09-02T00:00:00', allDay: true, recurrenceRule: MODELL
  });
  assert.match(ganztags, /DTSTART;VALUE=DATE:20260901/);
  assert.match(ganztags, /RRULE:FREQ=WEEKLY;UNTIL=20260930\r\n/, 'Ganztagsserie braucht ein DATE in UNTIL.');

  const getaktet = caldav.buildVevent({
    uid: 'x2', title: 'Wochentermin', startAt: '2026-09-01T09:00:00',
    endAt: '2026-09-01T10:00:00', allDay: false, recurrenceRule: MODELL
  });
  assert.match(getaktet, /DTSTART:20260901T090000\r\n/, 'Startwert ist eine schwebende Ortszeit.');
  assert.match(getaktet, /RRULE:FREQ=WEEKLY;UNTIL=20260930T235959\r\n/, 'Schwebender Start braucht schwebendes UNTIL.');

  const inUtc = caldav.buildVevent({
    uid: 'x3', title: 'UTC-Termin', startAt: '2026-09-01T07:00:00Z',
    endAt: '2026-09-01T08:00:00Z', allDay: false, recurrenceRule: MODELL
  });
  assert.match(inUtc, /DTSTART:20260901T070000Z/);
  assert.match(inUtc, /RRULE:FREQ=WEEKLY;UNTIL=20260930T235959Z/, 'UTC-Start braucht UTC-UNTIL.');
});

test('Google bekommt bei Ganztagsterminen ebenfalls ein DATE', () => {
  assert.deepEqual(recurrence.modelToGoogleRecurrence(MODELL, true), ['RRULE:FREQ=WEEKLY;UNTIL=20260930']);
  assert.deepEqual(recurrence.modelToGoogleRecurrence(MODELL, false), ['RRULE:FREQ=WEEKLY;UNTIL=20260930T235959Z']);
});

test('Die Ausfuhr der Auslieferungsdatei schreibt kein UTC-UNTIL mehr', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
    'utf8'
  );
  const von = html.indexOf('function recurrenceRuleToRRule(');
  assert.ok(von > 0, 'recurrenceRuleToRRule fehlt in der Auslieferungsdatei.');
  const bis = html.indexOf('function eventToIcsLines(', von);
  assert.ok(bis > von, 'Endanker fehlt.');
  const quelle = html.slice(von, bis);

  const umgebung = {
    parseRecurrenceRule: (raw) => JSON.parse(raw),
    isoToIcsDateOnly: (iso) => String(iso || '').slice(0, 10).replace(/-/g, ''),
    result: null
  };
  vm.runInNewContext(`${quelle}\nresult = recurrenceRuleToRRule;`, umgebung);
  const modell = JSON.parse(MODELL);
  assert.equal(umgebung.result(JSON.stringify(modell), 'date'), 'FREQ=WEEKLY;UNTIL=20260930');
  assert.equal(umgebung.result(JSON.stringify(modell), 'floating'), 'FREQ=WEEKLY;UNTIL=20260930T235959');

  /* Beide Aufrufstellen der Ausfuhr geben die Wertart ausdruecklich mit. */
  assert.ok(html.includes("recurrenceRuleToRRule(e.recurrenceRule,e.allDay?'date':'floating')"));
  assert.ok(html.includes("recurrenceRuleToRRule(t.recurrenceRule,'floating')"));
});
