'use strict';
/* Darstellungsfixes der Modal-Formulare (14.08.2026, Nutzer-Livetest):
   (1) Die generische 38px-Input-Regel des Adressbuch-/Sozialnetzwerk-Grids darf
       Checkboxen nicht mehr zu beschriftungsverdeckenden Riesen-Quadraten machen.
   (2) Die alte .modal-box-Textarea-Regel (420px, Monospace — für JSON-/Rohtext-
       Editoren) darf kompakte Formular-Textareas (Grid, v255-Felder, rows-Attribut)
       nicht mehr aufblähen. Die Legacy-Regel selbst bleibt bestehen.
   Dieser Test schützt die beiden Ausnahme-Regeln auch gegen versehentliches
   Überrollen durch parallele Editor-Schreibzyklen. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

test('Checkboxen im Editor-Grid bleiben klein und beschriftbar', () => {
  assert.match(html, /\.addressbook-editor-grid input\[type="checkbox"\]\{width:16px;height:16px/);
});

test('kompakte Formular-Textareas sind von der 420px-Legacy-Regel ausgenommen', () => {
  assert.match(html, /\.modal-box \.addressbook-editor-grid textarea,\.modal-box \.v255-field textarea,\.modal-box textarea\[rows\]\{height:auto/);
  // Die Legacy-Regel für JSON-/Rohtext-Editoren bleibt unangetastet:
  assert.match(html, /\.modal-box textarea\{width:100%;height:420px/);
});
