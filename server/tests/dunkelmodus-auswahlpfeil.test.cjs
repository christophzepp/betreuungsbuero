'use strict';

/* Auswahlpfeil im Dunkelmodus (Nutzerhinweis 06.09.2026: „zu viele Pfeile nach unten“).
     Die globale Regel `html[data-theme="dark"] select{background:#111c25!important}` ist die
     KURZSCHREIBWEISE. Sie setzt Bild, Wiederholung, Lage und Groesse zurueck - background-repeat
     steht danach wieder auf `repeat`. Die beiden Stellen, die ihren Pfeil selbst mitbringen und die
     native Bedienflaeche abschalten (Formular der Falldokumentation und Fallwechsler), verloren ihn
     dadurch im Dunkelmodus; in Safari kachelte der Pfeil quer ueber das Feld. Nachgestellt in
     WebKit: vorher background-image `none` und repeat `repeat`, nachher Bild da und `no-repeat`. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

test('Die Ursache steht noch im Quelltext - deshalb bleibt die Gegenregel noetig', () => {
  assert.ok(html.includes('html[data-theme="dark"] select,'), 'Die globale Dunkelmodus-Regel fehlt');
  assert.ok(html.includes('background:#111c25!important;color:var(--ink)!important;border-color:var(--line)!important;'),
    'Die Kurzschreibweise der globalen Regel hat sich geaendert - die Gegenregel bitte pruefen');
});

test('Beide Auswahlfelder mit eigenem Pfeil bekommen ihn im Dunkelmodus zurueck', () => {
  const block = html.slice(html.indexOf('html[data-theme="dark"] .fd-shell .fd-head .fd-case,'),
    html.indexOf('html[data-theme="dark"] .fd-form .fd-fld input::placeholder,'));
  assert.ok(block.includes('html[data-theme="dark"] .fd-form .fd-fld select{'), 'Das Formular fehlt in der Gegenregel');
  assert.ok(block.includes('background-image:url("data:image/svg+xml,'), 'Das Pfeilbild fehlt');
  assert.ok(block.includes('background-repeat:no-repeat!important;'), 'Ohne no-repeat kachelt der Pfeil');
  assert.ok(block.includes('background-position:right 10px center!important;'), 'Die Lage des Pfeils fehlt');
  assert.ok(block.includes('background-size:14px 14px!important;'), 'Die Groesse des Pfeils fehlt');
  /* Der Fallwechsler sitzt einen Punkt weiter rechts als die Formularfelder. */
  assert.ok(html.includes('html[data-theme="dark"] .fd-shell .fd-head .fd-case{background-position:right 9px center!important}'),
    'Die abweichende Lage des Fallwechslers fehlt');
});

test('Im Hellmodus bleibt alles wie bisher', () => {
  assert.ok(html.includes(".fd-form .fd-fld select{-webkit-appearance:none;appearance:none;padding-right:34px;background-image:url(\"data:image/svg+xml,"),
    'Die Grundregel des Formularfelds wurde angetastet');
  assert.ok(html.includes('background-repeat:no-repeat;background-position:right 10px center;background-size:14px 14px;cursor:pointer}'),
    'Die Grundangaben des Formularfelds wurden angetastet');
  assert.ok(html.includes('background-repeat:no-repeat;background-position:right 9px center;background-size:14px 14px;cursor:pointer;text-overflow:ellipsis}'),
    'Die Grundangaben des Fallwechslers wurden angetastet');
});
