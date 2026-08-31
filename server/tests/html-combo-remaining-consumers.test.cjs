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

function sourceRegion(source, startMarker, endMarker, from = 0) {
  const start = source.indexOf(startMarker, from);
  assert(start >= 0, `Quellbereich ${startMarker} fehlt.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, `Ende ${endMarker} nach ${startMarker} fehlt.`);
  return source.slice(start, end);
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

function initializer(source, marker, open = '{', close = '}') {
  const markerAt = source.indexOf(marker);
  assert(markerAt >= 0, `Deklaration ${marker} fehlt.`);
  const openAt = source.indexOf(open, markerAt + marker.length);
  assert(openAt >= 0, `Initialisierer von ${marker} fehlt.`);
  return balanced(source, openAt, open, close);
}

function namedSimpleFunction(source, name) {
  const marker = `function ${name}(`;
  const at = source.indexOf(marker);
  assert(at >= 0, `Funktion ${name} fehlt.`);
  const bodyAt = source.indexOf('{', at);
  return source.slice(at, bodyAt) + balanced(source, bodyAt, '{', '}');
}

function inputTagById(region, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const tag = new RegExp(`<input\\b(?=[^>]*\\bid=["']${escapedId}["'])[^>]*>`, 'i').exec(region);
  assert(tag, `Eingabefeld #${id} fehlt.`);
  return tag[0];
}

function assertTagCombo(tag, key, label) {
  assert.match(
    tag,
    new RegExp(`\\bdata-combo=["']${key}["']`),
    `${label} muss die zentrale Vorschlagsliste ${key} verwenden.`
  );
}

function fieldObject(id) {
  const escapedId = id.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const hit = new RegExp(`\\{\\s*id\\s*:\\s*["']${escapedId}["']`).exec(html);
  assert(hit, `Dokumentfeld ${id} fehlt.`);
  return balanced(html, hit.index, '{', '}');
}

function assertFieldCombo(id, key) {
  assert.match(
    fieldObject(id),
    new RegExp(`\\bcombo\\s*:\\s*["']${key}["']`),
    `Dokumentfeld ${id} muss die zentrale Vorschlagsliste ${key} verwenden.`
  );
}

function column(table, key) {
  const result = table.columns.find(item => item.key === key);
  assert(result, `Tabellenspalte ${key} fehlt.`);
  return result;
}

const inbox = scriptById('inbox-script-v1');
const handkasse = scriptById('handkasse-script-v1');

test('Büroprofil und Büroprofil-Posteingang verwenden die vier zentralen Stammdatenlisten', () => {
  const form = sourceRegion(html, 'function officeProfileFormHTML(', 'async function renderOfficeProfileInto(');
  for (const [id, key] of [
    ['opSalutation', 'sd_anrede'],
    ['opPostalCode', 'sd_plz'],
    ['opCity', 'sd_ort'],
    ['opCountry', 'sd_land']
  ]) {
    assertTagCombo(inputTagById(form, id), key, `Büroprofil ${id}`);
  }

  const actionRenderer = sourceRegion(
    inbox,
    "else if(s.kind==='action')",
    "else if(s.kind==='taskareas')"
  );
  for (const [field, key] of [
    ['salutation', 'sd_anrede'],
    ['postalCode', 'sd_plz'],
    ['city', 'sd_ort'],
    ['country', 'sd_land']
  ]) {
    assert.match(
      actionRenderer,
      new RegExp(`${field}\\s*:\\s*["']${key}["']`),
      `Die Büroprofil-Aktion im Posteingang muss ${field} auf ${key} abbilden.`
    );
  }
});

test('Berichtstabellen verwenden fachlich passende zentrale Kategorien', () => {
  const assets = sourceRegion(html, 'function renderAssetTable(', 'function renderIncomeTable(');
  assert.match(assets, /data-col=["']category["'][^>]*data-combo|data-combo[^>]*data-col=["']category["']/);
  assert.match(assets, /data-combo=["']sd_institution["'][^>]*data-col=["']institution["']|data-col=["']institution["'][^>]*data-combo=["']sd_institution["']/);
  assert.match(assets, /vaAssetCats/, 'Vermögenszeilen müssen vaAssetCats verwenden.');
  assert.match(assets, /vaDebtCats/, 'Schuldzeilen müssen vaDebtCats verwenden.');
  assert.match(assets, /r\.type[\s\S]*?Schuld|Schuld[\s\S]*?r\.type/, 'Die Kategorienliste muss vom Zeilentyp Vermögen/Schuld abhängen.');

  const income = sourceRegion(html, 'function renderIncomeTable(', 'function renderAssetComparison(');
  assert.match(income, /data-col=["']type["'][^>]*data-combo|data-combo[^>]*data-col=["']type["']/);
  assert.match(income, /data-combo=["']sd_institution["'][^>]*data-col=["']provider["']|data-col=["']provider["'][^>]*data-combo=["']sd_institution["']/);
  assert.match(income, /luIncomeCats/, 'Einkunftsarten müssen luIncomeCats verwenden.');

  const comparison = sourceRegion(html, 'function renderAssetComparison(', 'function renderTransactions(');
  assert.match(comparison, /data-col=["']category["'][^>]*data-combo|data-combo[^>]*data-col=["']category["']/);
  assert.match(comparison, /vaAssetCats/, 'Kategorien im Vermögensvergleich müssen vaAssetCats verwenden.');
});

test('Rechnungslegung bindet Kontoart und manuelle Vermögenskategorie an zentrale Listen', () => {
  const step = sourceRegion(html, 'function accStep1HTML(', 'function accStep2HTML(');
  const accountTypeAt = step.indexOf("accInput('Kontoart'");
  assert(accountTypeAt >= 0, 'Das Rechnungslegungsfeld Kontoart fehlt.');
  assert.match(
    step.slice(accountTypeAt, accountTypeAt + 360),
    /sd_kontoart/,
    'Kontoart in der Rechnungslegung muss sd_kontoart verwenden.'
  );

  const assets = sourceRegion(step, '<h3>Vermögenswerte</h3>', '<h3>Verbindlichkeiten</h3>');
  assert.match(assets, /r\.category/, 'Die manuelle Vermögenskategorie fehlt.');
  assert.match(assets, /data-combo/, 'Die manuelle Vermögenskategorie muss als zentrale Combobox gerendert werden.');
  assert.match(assets, /vaAssetCats/, 'Die manuelle Vermögenskategorie muss vaAssetCats verwenden.');
});

test('Handkasse wechselt in Hauptdialog und Posteingang zwischen Einnahme- und Ausgabenkategorien', () => {
  const rows = sourceRegion(handkasse, 'function renderRows(', 'function bodyHTML(');
  assert.match(rows, /data-combo/, 'Die Kategorie im Handkassen-Hauptdialog muss als zentrale Combobox gerendert werden.');
  assert.match(rows, /luIncomeCats/, 'Handkassen-Einnahmen müssen luIncomeCats verwenden.');
  assert.match(rows, /luExpenseCats/, 'Handkassen-Ausgaben müssen luExpenseCats verwenden.');
  assert.match(rows, /e\.type/, 'Die Handkassen-Kategorienliste muss vom Buchungstyp abhängen.');

  const comboSource = namedSimpleFunction(inbox, 'inboxSectionFieldComboKey');
  const context = {};
  vm.createContext(context);
  new vm.Script(`${comboSource}\nthis.resolveCombo=inboxSectionFieldComboKey;`)
    .runInContext(context, { timeout: 1000 });
  const fields = type => [{ path: 'type', newValue: type }];
  assert.equal(context.resolveCombo('handkasse', 'category', fields('einnahme')), 'luIncomeCats');
  assert.equal(context.resolveCombo('handkasse', 'category', fields('ausgabe')), 'luExpenseCats');

  const update = sourceRegion(
    inbox,
    'window.__inboxSugStammField=async function',
    '// Listeneinträge einer Sektion'
  );
  assert.match(update, /handkasse/, 'Der Posteingang muss nach einem Handkassen-Typwechsel neu rendern.');
  assert.match(update, /path\s*===\s*["']type["']/, 'Der Neuaufbau muss an den Typwechsel gekoppelt sein.');
  assert.match(update, /inboxRerenderKeepScroll\(\)/, 'Der Typwechsel muss die sichtbare Kategorie-Combobox aktualisieren.');
});

test('Amtliche Tabellen verwenden Geschlechts- und Einkunftskataloge', () => {
  const tables = vm.runInNewContext(
    `(${initializer(html, 'const OFFICIAL_STRUCTURED_TABLES=')})`,
    Object.create(null),
    { timeout: 1000 }
  );
  assert.equal(column(tables.kgCurrentChildren, 'gender').combo, 'sd_geschlecht');
  assert.equal(column(tables.kgOtherChildren, 'gender').combo, 'sd_geschlecht');
  assert.equal(column(tables.socialIncome, 'incomeType').combo, 'luIncomeCats');
  assert.equal(column(tables.socialIncome, 'provider').combo, 'sd_institution');
});

test('Pflegegrad sowie HA-Personen- und Adressfelder verwenden die Stammdatenkataloge', () => {
  for (const [id, key] of [
    ['care_level', 'sd_pflegegrad'],
    ['ha_birth_place', 'sd_ort'],
    ['ha_birth_country', 'sd_land'],
    ['ha_nationality', 'sd_nationalitaet'],
    ['ha_postal', 'sd_plz'],
    ['ha_city', 'sd_ort']
  ]) assertFieldCombo(id, key);
});

test('WBA-Postleitzahl verwendet den zentralen PLZ-Katalog', () => {
  assertFieldCombo('wba_postal', 'sd_plz');
});

test('Kindergeld-Antrag und Anlage Kind verwenden Titel-, Orts- und Staatsangehörigkeitskataloge', () => {
  for (const [id, key] of [
    ['kg_title', 'sd_titel'],
    ['kg_birth_place', 'sd_ort'],
    ['kg_nationality', 'sd_nationalitaet'],
    ['kg_partner_nationality', 'sd_nationalitaet'],
    ['kgan_child_title', 'sd_titel'],
    ['kgan_child_birth_place', 'sd_ort'],
    ['kgan_child_nationality', 'sd_nationalitaet'],
    ['kgan_other_person_nationality', 'sd_nationalitaet']
  ]) assertFieldCombo(id, key);
});

test('DRV-Antrag verwendet Titel-, Orts-, Länder-, Staatsangehörigkeits- und PLZ-Kataloge', () => {
  for (const [id, key] of [
    ['drv_title', 'sd_titel'],
    ['drv_birth_place', 'sd_ort'],
    ['drv_birth_country', 'sd_land'],
    ['drv_nationality', 'sd_nationalitaet'],
    ['drv_postal', 'sd_plz'],
    ['drv_country', 'sd_land']
  ]) assertFieldCombo(id, key);
});

test('Mitteilungsverordnung verwendet den PLZ- und Ortskatalog', () => {
  for (const [id, key] of [
    ['mv_postal', 'sd_plz'],
    ['mv_city', 'sd_ort'],
    ['mv_place', 'sd_ort']
  ]) assertFieldCombo(id, key);
});
