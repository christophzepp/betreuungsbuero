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

function initializer(source, marker, open = '{', close = '}') {
  const markerAt = source.indexOf(marker);
  assert(markerAt >= 0, `Deklaration ${marker} fehlt.`);
  const openAt = source.indexOf(open, markerAt + marker.length);
  assert(openAt >= 0, `Initialisierer von ${marker} fehlt.`);
  return balanced(source, openAt, open, close);
}

function namedFunction(source, name) {
  const marker = `function ${name}(`;
  const at = source.indexOf(marker);
  assert(at >= 0, `Funktion ${name} fehlt.`);
  const bodyAt = source.indexOf('{', at);
  return source.slice(at, bodyAt) + balanced(source, bodyAt, '{', '}');
}

function evaluateFunctions(source, names) {
  const context = {};
  vm.createContext(context);
  const exports = names.map(name => `this.${name}=${name};`).join('\n');
  new vm.Script(`${names.map(name => namedFunction(source, name)).join('\n')}\n${exports}`)
    .runInContext(context, { timeout: 1000 });
  return context;
}

function inputTag(id) {
  const idAt = [
    html.indexOf(`id="${id}"`),
    html.indexOf(`id='${id}'`)
  ].find(index => index >= 0);
  assert.notEqual(idAt, undefined, `Eingabe #${id} fehlt.`);
  const openAt = html.lastIndexOf('<input', idAt);
  const closeAt = html.indexOf('>', idAt);
  assert(openAt >= 0 && closeAt > idAt, `Eingabe #${id} ist nicht auswertbar.`);
  return html.slice(openAt, closeAt + 1);
}

function assertLiteralCombo(id, key) {
  assert.match(
    inputTag(id),
    new RegExp(`\\bdata-combo=["']${key}["']`, 'i'),
    `#${id} muss direkt den zentralen Katalog ${key} verwenden.`
  );
}

function flattened(groups) {
  return (groups || []).flatMap(group => Array.isArray(group) && Array.isArray(group[1]) ? group[1] : []);
}

function officeField(key, values) {
  return {
    key,
    label: 'Institution / Einrichtung',
    category: 'Stammdaten',
    sortMode: 'custom',
    groups: [{
      id: 'server-institutions',
      label: 'Server-Institutionen',
      order: 0,
      items: values.map((value, index) => ({
        value,
        source: 'office',
        favorite: false,
        hidden: false,
        order: index * 10
      }))
    }]
  };
}

function createRegistryRuntime(serverInstitutions) {
  const fetchCalls = [];
  const stored = new Map();
  const document = {
    body: { appendChild() {} },
    addEventListener() {},
    createElement() {
      return {
        style: {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        addEventListener() {},
        setAttribute() {},
        appendChild() {},
        querySelectorAll() { return []; }
      };
    },
    getElementById() { return null; },
    querySelectorAll() { return []; }
  };
  const context = {
    console,
    document,
    localStorage: {
      getItem(key) { return stored.has(key) ? stored.get(key) : null; },
      setItem(key, value) { stored.set(key, String(value)); }
    },
    setTimeout() { return 1; },
    clearTimeout() {},
    addEventListener() {},
    Event: class Event {},
    __appMode: 'online',
    __finComboData: {},
    async fetch(url, options = {}) {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              version: 1,
              fields: { sd_institution: officeField('sd_institution', serverInstitutions) }
            }
          };
        }
      };
    }
  };
  context.window = context;
  vm.createContext(context);
  new vm.Script(scriptById('stammdaten-suggest-v160'), {
    filename: 'stammdaten-suggest-v160.js'
  }).runInContext(context);
  new vm.Script(scriptById('suggestion-registry-v1'), {
    filename: 'suggestion-registry-v1.js'
  }).runInContext(context);
  return { context, fetchCalls };
}

const stammdaten = scriptById('stammdaten-suggest-v160');
const inbox = scriptById('inbox-script-v1');
const intake = scriptById('caseintake-script-v1');
const mail = scriptById('mailx-client-v1');

test('sd_institution ist ein first-class Stammdatenkatalog und akzeptiert den Server-Override', async () => {
  const serverInstitutions = ['Pflegezentrum Sonnengarten', 'Klinikum am Park'];
  const { context, fetchCalls } = createRegistryRuntime(serverInstitutions);

  assert(
    Object.prototype.hasOwnProperty.call(context.__stammdatenSuggestions, 'institution'),
    'Die Softwarevorgabe muss institution deklarieren; ein nur zufällig vorhandenes ba_institution genügt nicht.'
  );
  assert(context.__suggestionRegistry, 'Die zentrale Vorschlagslisten-Registry muss starten.');
  context.__suggestionRegistry.apply();
  assert(
    Object.prototype.hasOwnProperty.call(context.__finComboData, 'sd_institution'),
    'sd_institution muss auch ohne Serverinhalt als bekannter zentraler Schlüssel veröffentlicht werden.'
  );

  await context.__suggestionRegistry.load(true);

  assert.equal(fetchCalls.length, 1, 'Der serverseitige Bürokatalog muss genau einmal geladen werden.');
  assert.equal(fetchCalls[0].url, '/api/office-json/suggestion_registry');
  assert.deepEqual(
    Array.from(flattened(context.__finComboData.sd_institution)),
    serverInstitutions,
    'Der Server-Override von sd_institution muss die wirksame Vorschlagsliste bestimmen.'
  );
  assert.equal(context.__finComboData.sd_institution[0][0], 'Server-Institutionen');
  assert.match(
    scriptById('suggestion-registry-v1'),
    /institution\s*:\s*['"][^'"]*(?:Institution|Einrichtung)[^'"]*['"]/,
    'Der Pflegekatalog braucht eine sprechende first-class Beschriftung für sd_institution.'
  );
});

test('allgemeine fallbezogene Institutionseingaben verwenden weiterhin sd_institution', () => {
  for (const id of [
    'docManualInstitution',
    'abInstitution'
  ]) assertLiteralCombo(id, 'sd_institution');

  assert.match(
    html,
    /pcField\('pcInstitution'\s*,\s*'Institution'[^\n]+?'sd_institution'\)/,
    'Der Kontaktdateneditor der betreuten Person muss sd_institution verwenden.'
  );

  assert.match(
    stammdaten,
    /\['\[data-casepath="person\.institution"\]'\s*,\s*'institution'\]/,
    'Das Stammdatenfeld person.institution muss dynamisch auf sd_institution zeigen.'
  );
  /* Nutzerwunsch 14.08.2026: Das Institutionsfeld im Sozialen Netzwerk ist ein freies,
     halbbreites Textfeld NEBEN dem Nachnamen — bewusst OHNE sd_institution-Vorschlagsliste. */
  assert.match(
    html,
    /socialField\('snInstitution'\s*,\s*'Institution'\s*,\s*f\.institution\)/,
    'Das Soziale Netzwerk führt Institution als freies halbbreites Feld ohne Vorschlagsliste.'
  );
  assert.doesNotMatch(
    html,
    /socialField\('snInstitution'[^\n]+?'sd_institution'\)/,
    'Die sd_institution-Verdrahtung im Sozialen Netzwerk wurde auf Nutzerwunsch entfernt.'
  );
});

test('Posteingang verwendet sd_institution für Fallfelder, aber ba_institution für echte Bürokontakte', () => {
  const fns = evaluateFunctions(inbox, [
    'inboxSectionFieldComboKey',
    'inboxScalarFieldComboKey'
  ]);
  assert.equal(fns.inboxScalarFieldComboKey('person.institution'), 'sd_institution');
  assert.equal(fns.inboxSectionFieldComboKey('socialNetwork', 'institution', []), 'sd_institution');

  const rowAt = inbox.indexOf('function inboxSugRowHTML');
  assert(rowAt >= 0, 'Posteingangsrenderer inboxSugRowHTML fehlt.');
  const rowSource = inbox.slice(rowAt, inbox.indexOf('\nfunction ', rowAt + 30));
  assert.match(rowSource, /fallKeys\s*=\s*\{[^}]*institution\s*:\s*'sd_institution'/s);
  assert.match(rowSource, /bueroKeys\s*=\s*\{[^}]*institution\s*:\s*'ba_institution'/s);
});

test('Fallbeginn reicht sd_institution an Person, Unterkunft und Fallkontakte weiter', () => {
  const rows = vm.runInNewContext(
    `(${initializer(intake, 'const CI_ROWS=')})`,
    Object.create(null),
    { timeout: 1000 }
  );
  const contactInstitution = rows.contacts.find(row => row[0] === 'institution');
  assert(contactInstitution, 'CI_ROWS.contacts.institution fehlt.');
  assert.equal(contactInstitution[4], 'institution');

  assert.match(
    intake,
    /\['institution'\s*,\s*'Einrichtung \(z\. B\. Pflegeheim\)'[^\]]*'institution'\]/,
    'Fallbeginn person.institution muss den semantischen Schlüssel institution tragen.'
  );
  assert.match(
    intake,
    /\['institution'\s*,\s*'Institutionsname \(Name der Einrichtung\)'[^\]]*'institution'\]/,
    'Fallbeginn accommodation.institution muss den semantischen Schlüssel institution tragen.'
  );
});

test('Leistungsträger, Versicherungen und Banken verwenden den allgemeinen Institutionskatalog', () => {
  for (const [section, field] of [
    ['benefits', 'provider'],
    ['insurances', 'institution'],
    ['banks', 'institution']
  ]) {
    assert.match(
      stammdaten,
      new RegExp(`\\['\\[data-array-path-v156="${section}"\\]\\[data-array-prop-v156="${field}"\\]'\\s*,\\s*'institution'\\]`),
      `${section}.${field} muss in den Stammdaten auf sd_institution zeigen.`
    );
  }

  const fns = evaluateFunctions(inbox, ['inboxSectionFieldComboKey']);
  assert.equal(fns.inboxSectionFieldComboKey('benefits', 'provider', []), 'sd_institution');
  assert.equal(fns.inboxSectionFieldComboKey('livelihood.income', 'provider', []), 'sd_institution');
  assert.equal(fns.inboxSectionFieldComboKey('insurances', 'institution', []), 'sd_institution');
  assert.equal(fns.inboxSectionFieldComboKey('banks', 'institution', []), 'sd_institution');

  const rows = vm.runInNewContext(
    `(${initializer(intake, 'const CI_ROWS=')})`,
    Object.create(null),
    { timeout: 1000 }
  );
  for (const [section, field] of [
    ['benefits', 'provider'],
    ['insurances', 'institution'],
    ['banks', 'institution']
  ]) {
    const row = rows[section].find(item => item[0] === field);
    assert(row, `CI_ROWS.${section}.${field} fehlt.`);
    assert.equal(row[4], 'institution', `CI_ROWS.${section}.${field} muss sd_institution anfordern.`);
  }
});

test('Fristenverwaltung und E-Mail-Frist verwenden sd_institution für das Gegenüber', () => {
  assertLiteralCombo('frF_institution', 'sd_institution');
  assert.match(
    mail,
    /\['institution'\s*,\s*'Institution \/ Gegenüber'\s*,\s*from\s*,\s*'combo'\s*,\s*'sd_institution'\]/,
    'Das Feld Institution/Gegenüber in „Frist aus E-Mail“ muss sd_institution verwenden.'
  );
  assert.match(
    mail,
    /if\(type==='combo'\)[\s\S]{0,300}?data-combo="'\+eat\(extra\|\|''\)\+'"/,
    'Der E-Mail-Modulformular-Renderer muss Combo-Felder als zentrale data-combo-Eingaben ausgeben.'
  );
});
