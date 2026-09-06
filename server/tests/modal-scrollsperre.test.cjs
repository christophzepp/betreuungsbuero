'use strict';

/* Hintergrund darf bei offenem Modal nicht mitrollen (Nutzerhinweis 06.09.2026, gesehen im
     Einstellungsmenue). Die Seite rollt nicht am Fenster: die Arbeitsflaeche rollt in `main.main`,
     die Startseite in `main.start-shell` (dort mit !important gesetzt). Deshalb reicht die uebliche
     Sperre an `body` nicht - beide Behaelter werden bei offenem Modal stillgelegt, und das Modal
     selbst ist ein Scrollende, damit das Rollen nicht nach draussen verkettet wird (Safari rollt
     weiter, wo Chromium schon stoppt). Gemessen im Browser: Rollstand der Startseite bleibt stehen,
     der Inhalt des Modals rollt weiter, nach dem Schliessen rollt die Seite wieder. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

test('Die Seite hinter einem offenen Modal ist stillgelegt', () => {
  assert.ok(html.includes('html:has(#modal:not(.hidden)) body{overflow:hidden;overscroll-behavior:none}'),
    'Die Sperre an body fehlt');
  assert.ok(html.includes('html:has(#modal:not(.hidden)) :is(main.main,main.start-shell){overflow:hidden!important}'),
    'Arbeitsflaeche und Startseite werden nicht stillgelegt');
  assert.ok(html.includes('html:has(#modal:not(.hidden)) #startPage.start-layout>.start-shell{overflow:hidden!important}'),
    'Die Startseite setzt ihren Ueberlauf selbst mit !important - dagegen braucht es die spezifischere Regel');
});

test('Das Modal verkettet sein Rollen nicht nach draussen', () => {
  assert.ok(html.includes('#modal{overflow:hidden;overscroll-behavior:contain}'),
    'Das Modal ist kein Scrollende');
  assert.ok(html.includes('#modal>.modal-box,#modal>.modal-box>#modalBody,#modal .modal-scroll,#modal .set-nav,#modal .set-inhalt{overscroll-behavior:contain}'),
    'Die Rollflaechen des Modals behalten ihr Rollen nicht bei sich');
});

test('Im Modal selbst bleibt das Rollen erhalten', () => {
  assert.ok(html.includes('#modal>.modal-box>#modalBody{flex:1 1 auto;min-height:0;overflow:auto}'),
    'Der Modalkoerper muss weiter rollen');
  assert.ok(html.includes('#modal .modal-scroll{flex:1 1 auto;min-height:0;overflow:auto}'),
    'Der Drei-Zonen-Rollbereich muss weiter rollen');
  assert.ok(html.includes('.set-inhalt{overflow:auto;'), 'Die Einstellungsseite muss weiter rollen');
  assert.ok(html.includes('.set-nav{overflow:auto;'), 'Die Navigation der Einstellungen muss weiter rollen');
  /* Die Sperre haengt allein am Zustand des Modals: ohne offenes Modal keine Regel. */
  assert.equal((html.match(/html:has\(#modal:not\(\.hidden\)\)/g) || []).length, 3,
    'Genau drei Sperr-Regeln, alle an den Modalzustand gebunden');
});

test('Der Anmeldevorhang behaelt seine eigene, gleich gebaute Sperre', () => {
  assert.ok(html.includes('html:has(#loginGateOverlay:not([hidden]):not(.hidden)) body{overflow:hidden;overscroll-behavior:none}'),
    'Das Vorbild der Sperre wurde entfernt');
});
