'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(
  path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

function styleById(id) {
  const start = html.search(new RegExp(`<style[^>]*\\bid=["']${id}["'][^>]*>`, 'i'));
  assert(start >= 0, `Style #${id} fehlt.`);
  const bodyAt = html.indexOf('>', start);
  const end = html.indexOf('</style>', bodyAt);
  assert(bodyAt >= 0 && end > bodyAt, `Style #${id} ist unvollständig.`);
  return html.slice(bodyAt + 1, end);
}

function housingRenderer() {
  const start = html.indexOf('function housingCardHeadV255(');
  const end = html.indexOf('window.openHousingModal=', start);
  assert(start >= 0 && end > start, 'Wohnen-Renderer housingBodyV255 fehlt.');
  return html.slice(start, end);
}

test('Meldeadresse und momentaner Aufenthalt bilden auf Desktop zwei gleich breite Spalten', () => {
  const css = styleById('initial-data-domains-style-v255');
  assert.match(
    css,
    /\.housing-address-grid-v255\s*\{[^}]*grid-column\s*:\s*1\s*\/\s*-1[^}]*display\s*:\s*grid[^}]*grid-template-columns\s*:\s*repeat\(2\s*,\s*minmax\(0\s*,\s*1fr\)\)/s,
    'Das Adressraster muss die volle Inhaltsbreite belegen und exakt zwei gleich breite Desktopspalten verwenden.'
  );

  const renderer = housingRenderer();
  const gridAt = renderer.indexOf('<div class="housing-address-grid-v255">');
  const registeredAt = renderer.indexOf("housingCardHeadV255('Meldeadresse'", gridAt);
  const currentAt = renderer.indexOf("housingCardHeadV255('Adresse des momentanen Aufenthalts'", registeredAt);
  // v260 (22.08.2026): Adressen und Wohnkosten liegen in getrennten Reitern, folgen also
  // nicht mehr unmittelbar aufeinander. Das Raster markiert sein Ende deshalb selbst.
  const gridEnd = renderer.indexOf('<!--housing-address-grid-ende-v260-->', currentAt);

  assert(gridAt >= 0 && registeredAt > gridAt && currentAt > registeredAt && gridEnd > currentAt,
    'Beide Adresskarten müssen gemeinsam und in der richtigen Reihenfolge im Adressraster liegen.');
  assert.equal(
    (renderer.slice(gridAt, gridEnd).match(/housing-address-card-v255/g) || []).length,
    2,
    'Das 50/50-Raster muss genau die beiden Adresskarten enthalten.'
  );
});

test('das Adressraster stapelt responsiv und behält Adressbuch- sowie Kopieraktionen', () => {
  const css = styleById('initial-data-domains-style-v255');
  assert.match(
    css,
    /@media\s*\(max-width\s*:\s*1000px\)\s*\{[^}]*\.housing-address-grid-v255\s*\{[^}]*grid-template-columns\s*:\s*1fr/s,
    'Auf schmalen Ansichten muss das Adressraster auf eine Spalte wechseln.'
  );

  const renderer = housingRenderer();
  for (const action of [
    'window.__housingPickRegisteredV255()',
    'window.__housingPickCurrentV255()',
    'window.__housingToggleSameV255()',
    'window.__housingCopyRegisteredV255()'
  ]) {
    assert(renderer.includes(action), `Adressaktion ${action} darf durch die Layoutänderung nicht verloren gehen.`);
  }
  assert.match(renderer, /housing-header-v255[\s\S]*housing-main-v255[\s\S]*housing-footer-v255/,
    'Dialogkopf, scrollbarer Hauptbereich und Dialogfuß müssen erhalten bleiben.');
});

test('beide Übernahmeaktionen des momentanen Aufenthalts stehen in derselben Kopfzeile', () => {
  const css = styleById('initial-data-domains-style-v255');
  assert.match(
    css,
    /\.v255-card-actions-v255\s*\{[^}]*display\s*:\s*flex[^}]*gap\s*:\s*8px/s,
    'Die beiden Übernahmebuttons brauchen eine gemeinsame horizontale Aktionsgruppe.'
  );
  assert.match(
    css,
    /\.housing-current-address-card-v255 \.v255-card-actions-v255\s*\{[^}]*display\s*:\s*grid[^}]*grid-template-columns\s*:\s*repeat\(2\s*,\s*minmax\(0\s*,\s*1fr\)\)[^}]*width\s*:\s*100%/s,
    'Im momentanen Aufenthalt müssen beide Buttons auf Desktop verbindlich eine gemeinsame zweispaltige Zeile belegen.'
  );

  const renderer = housingRenderer();
  assert.match(
    renderer,
    /housingCardHeadV255\('Adresse des momentanen Aufenthalts','window\.__housingPickCurrentV255\(\)',true\)/,
    'Die Karte des momentanen Aufenthalts muss Adressbuch- und Meldeadressen-Übernahme gemeinsam im Kartenkopf anfordern.'
  );
  const headAt = html.indexOf('function housingCardHeadV255(');
  const bodyAt = html.indexOf('function housingBodyV255()', headAt);
  const headRenderer = html.slice(headAt, bodyAt);
  for (const token of ['v255-card-actions-v255', 'Aus Adressbuch übernehmen', 'Meldeadresse übernehmen']) {
    assert(headRenderer.includes(token), `Der gemeinsame Kartenkopf muss ${token} enthalten.`);
  }

  const currentAt = renderer.indexOf("housingCardHeadV255('Adresse des momentanen Aufenthalts'");
  assert(renderer.slice(0, currentAt).includes('housing-current-address-card-v255'),
    'Die rechte Adresskarte muss die nicht umbrechende Desktop-Aktionszeile aktivieren.');
  const fieldsAt = renderer.indexOf('<div class="v255-grid" id="hvCurrentFields">', currentAt);
  const checkboxRow = renderer.slice(currentAt, fieldsAt);
  assert.match(checkboxRow, /v255-checks housing-same-v255[\s\S]*Identisch mit Meldeadresse/,
    'Die dauerhafte Identisch-Checkbox bleibt als getrennte Synchronisationsoption erhalten.');
  assert.doesNotMatch(checkboxRow, /<button[^>]*>Meldeadresse übernehmen<\/button>/,
    'Die Kopieraktion darf nicht zusätzlich in der Checkbox-Zeile dupliziert werden.');
});

test('die Adressbuchaktion der Meldeadresse steht als eigene Zeile unter dem Titel', () => {
  const css = styleById('initial-data-domains-style-v255');
  assert.match(
    css,
    /\.housing-registered-address-card-v255 \.v255-card-actions-v255\s*\{[^}]*display\s*:\s*grid[^}]*grid-template-columns\s*:\s*minmax\(0\s*,\s*1fr\)[^}]*width\s*:\s*100%/s,
    'Die linke Adressbuchaktion muss unter dem Titel eine eigene volle Zeile belegen.'
  );

  const renderer = housingRenderer();
  assert.match(
    renderer,
    /housing-registered-address-card-v255[^\n]*housingCardHeadV255\('Meldeadresse','window\.__housingPickRegisteredV255\(\)'\)/,
    'Nur die Meldeadressenkarte darf die einzeilige volle Adressbuchaktion aktivieren.'
  );
});
