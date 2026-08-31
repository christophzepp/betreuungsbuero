'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(
  path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

function scriptById(id) {
  const open = new RegExp(`<script[^>]*\\bid=["']${id}["'][^>]*>`, 'i').exec(html);
  assert(open, `Script #${id} fehlt.`);
  const bodyAt = open.index + open[0].length;
  const closeAt = html.indexOf('</script>', bodyAt);
  assert(closeAt >= 0, `Script #${id} ist unvollständig.`);
  return html.slice(bodyAt, closeAt);
}

function skipQuoted(source, start) {
  const quote = source[start];
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') index += 1;
    else if (source[index] === quote) return index + 1;
  }
  throw new Error(`Nicht abgeschlossener ${quote}-String.`);
}

function skipComment(source, start) {
  if (source[start + 1] === '/') {
    const end = source.indexOf('\n', start + 2);
    return end < 0 ? source.length : end + 1;
  }
  if (source[start + 1] === '*') {
    const end = source.indexOf('*/', start + 2);
    if (end < 0) throw new Error('Nicht abgeschlossener Blockkommentar.');
    return end + 2;
  }
  return start;
}

function balanced(source, start, open, close) {
  assert.equal(source[start], open, `Erwartete ${open} an Position ${start}.`);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      index = skipQuoted(source, index) - 1;
      continue;
    }
    if (char === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
      index = skipComment(source, index) - 1;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Nicht abgeschlossener ${open}${close}-Block.`);
}

function initializer(source, marker) {
  const markerAt = source.indexOf(marker);
  assert(markerAt >= 0, `Deklaration ${marker} fehlt.`);
  const openAt = source.indexOf('{', markerAt + marker.length);
  assert(openAt >= 0, `Initialisierer von ${marker} fehlt.`);
  return balanced(source, openAt, '{', '}');
}

function sourceRegion(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert(start >= 0, `Quellbereich ${startMarker} fehlt.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, `Ende ${endMarker} nach ${startMarker} fehlt.`);
  return source.slice(start, end);
}

function namedFunction(source, name) {
  const marker = `function ${name}(`;
  const at = source.indexOf(marker);
  assert(at >= 0, `Funktion ${name} fehlt.`);
  const bodyAt = source.indexOf('{', at);
  return source.slice(at, bodyAt) + balanced(source, bodyAt, '{', '}');
}

function fieldObjects(id) {
  const escapedId = id.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const matcher = new RegExp(`\\{\\s*id\\s*:\\s*["']${escapedId}["']`, 'g');
  const objects = [];
  for (let hit = matcher.exec(html); hit; hit = matcher.exec(html)) {
    objects.push(balanced(html, hit.index, '{', '}'));
  }
  assert(objects.length > 0, `Dokumentfeld ${id} fehlt.`);
  return objects;
}

function assertEveryFieldDefinitionUses(id, key) {
  const pattern = new RegExp(`\\bcombo\\s*:\\s*["']${key}["']`);
  fieldObjects(id).forEach((definition, index) => {
    assert.match(
      definition,
      pattern,
      `Dokumentfeld ${id}, Definition ${index + 1}, muss ${key} verwenden.`
    );
  });
}

test('alle gemeldeten Institutionsfelder verwenden sd_institution', () => {
  for (const id of [
    'sm_bank',
    'ha_health_insurer',
    'kg_bank',
    'kga_bank',
    'drv_bank_name',
    'drv_health_insurer'
  ]) assertEveryFieldDefinitionUses(id, 'sd_institution');
});

test('alle gemeldeten reinen Ortsfelder verwenden in jeder Schema-Definition sd_ort', () => {
  for (const id of [
    'wba_city',
    'poa_grantor_birthplace',
    'cap_place',
    'ccp_place',
    'drv_application_place'
  ]) assertEveryFieldDefinitionUses(id, 'sd_ort');
});

test('Art der stationären Einrichtung verwendet den fachlichen Unterkunftsarten-Katalog', () => {
  assertEveryFieldDefinitionUses('ha_institution_type', 'sd_unterkunftsart');
});

test('frühere Leistungsträger im Hauptantrag verwenden sd_institution', () => {
  const table = vm.runInNewContext(
    `(${initializer(html, 'OFFICIAL_STRUCTURED_TABLES.haPreviousBenefit=')})`,
    Object.create(null),
    { timeout: 1000 }
  );
  const provider = table.columns.find(column => column.key === 'provider');
  assert(provider, 'Spalte haPreviousBenefit.provider fehlt.');
  assert.equal(provider.combo, 'sd_institution');
});

test('Vermögensmodul rendert das Institut als zentrale Institutions-Combobox', () => {
  const vermoegen = scriptById('vermoegen-script-v1');
  const rows = sourceRegion(vermoegen, 'function rowsHTML(k){', 'function tableHTML(k,label){');
  assert.match(
    rows,
    /<input\b(?=[^>]*data-combo=["']sd_institution["'])(?=[^>]*__vaField\([^>]*["']institution["'])[^>]*>/,
    'Das editierbare Institutsfeld im Vermögensmodul muss sd_institution verwenden.'
  );
});

test('Gesundheitsmenü rendert Kliniken mit sd_institution', () => {
  const health = scriptById('healthinfo-script-v1');
  const arrays = vm.runInNewContext(
    `(${initializer(health, 'const ARR=')})`,
    Object.create(null),
    { timeout: 1000 }
  );
  const clinic = arrays.hospital.cols.find(column => column[0] === 'clinic');
  assert(clinic, 'Spalte health.hospital.clinic fehlt.');
  assert.equal(clinic[3].combo, 'sd_institution');

  const renderer = sourceRegion(health, 'function arrTable(key){', 'function dirRow(');
  assert.match(renderer, /o\.combo\?` data-combo=/, 'arrTable muss den Combo-Key der Spalte ausgeben.');
});

test('Fallbeginn löst health.hospital.clinic zu sd_institution auf und rendert data-combo', () => {
  const intake = scriptById('caseintake-script-v1');
  const rows = vm.runInNewContext(
    `(${initializer(intake, 'const CI_ROWS=')})`,
    Object.create(null),
    { timeout: 1000 }
  );
  const clinic = rows['health.hospital'].find(row => row[0] === 'clinic');
  assert(clinic, 'Fallbeginn-Feld health.hospital.clinic fehlt.');
  assert.equal(clinic[4], 'institution');

  const context = { window: { __finComboData: { sd_institution: [['', ['Klinik A']]] } } };
  vm.createContext(context);
  new vm.Script(`${namedFunction(intake, 'ciComboKey')}\nthis.resolveCombo=ciComboKey;`)
    .runInContext(context, { timeout: 1000 });
  assert.equal(context.resolveCombo(clinic[4]), 'sd_institution');

  const renderer = sourceRegion(intake, 'function ciFldIn(', 'function ciRowHtml(');
  assert.match(renderer, /combo=ciComboKey\(d\[4\]\|\|["']{2}\)/);
  assert.match(renderer, /combo\?` data-combo=/);
});
