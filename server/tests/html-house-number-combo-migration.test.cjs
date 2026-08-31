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

/*
 * Die Anwendung steckt in einer sehr großen Einzel-HTML-Datei. Diese Helfer
 * schneiden gezielt deklarierte Script-Blöcke bzw. echte JS-Initialisierer aus.
 * Ein bloß irgendwo vorkommender Schlüsselname oder eine spätere Runtime-
 * Zuweisung kann die Katalogtests deshalb nicht bestehen.
 */
function scriptById(id) {
  const needles = [`id="${id}"`, `id='${id}'`];
  const idAt = needles.map(needle => html.indexOf(needle)).find(index => index >= 0);
  assert.notEqual(idAt, undefined, `Script #${id} fehlt.`);
  const openAt = html.lastIndexOf('<script', idAt);
  const bodyAt = html.indexOf('>', idAt);
  const closeAt = html.indexOf('</script>', bodyAt);
  assert(openAt >= 0 && bodyAt >= 0 && closeAt >= 0, `Script #${id} ist unvollständig.`);
  return html.slice(bodyAt + 1, closeAt);
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

function skipTrivia(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
      index = skipComment(source, index);
      continue;
    }
    break;
  }
  return index;
}

function directPropertyExpression(objectSource, wantedKey) {
  let curly = 0;
  for (let index = 0; index < objectSource.length; index += 1) {
    const char = objectSource[index];
    if (char === '"' || char === "'" || char === '`') {
      index = skipQuoted(objectSource, index) - 1;
      continue;
    }
    if (char === '/' && (objectSource[index + 1] === '/' || objectSource[index + 1] === '*')) {
      index = skipComment(objectSource, index) - 1;
      continue;
    }
    if (char === '{') {
      curly += 1;
      continue;
    }
    if (char === '}') {
      curly -= 1;
      continue;
    }
    if (curly !== 1 || !/[A-Za-z_$]/.test(char)) continue;

    const keyStart = index;
    while (/[A-Za-z0-9_$]/.test(objectSource[index + 1] || '')) index += 1;
    const key = objectSource.slice(keyStart, index + 1);
    let valueAt = skipTrivia(objectSource, index + 1);
    if (key !== wantedKey || objectSource[valueAt] !== ':') continue;
    valueAt = skipTrivia(objectSource, valueAt + 1);

    let nestedCurly = 0;
    let square = 0;
    let paren = 0;
    for (let end = valueAt; end < objectSource.length; end += 1) {
      const valueChar = objectSource[end];
      if (valueChar === '"' || valueChar === "'" || valueChar === '`') {
        end = skipQuoted(objectSource, end) - 1;
        continue;
      }
      if (valueChar === '/' && (objectSource[end + 1] === '/' || objectSource[end + 1] === '*')) {
        end = skipComment(objectSource, end) - 1;
        continue;
      }
      if (valueChar === '{') nestedCurly += 1;
      else if (valueChar === '}' && nestedCurly > 0) nestedCurly -= 1;
      else if (valueChar === '[') square += 1;
      else if (valueChar === ']') square -= 1;
      else if (valueChar === '(') paren += 1;
      else if (valueChar === ')') paren -= 1;
      else if ((valueChar === ',' || valueChar === '}') && nestedCurly === 0 && square === 0 && paren === 0) {
        return objectSource.slice(valueAt, end).trim();
      }
    }
  }
  return null;
}

function declarationExpression(source, name) {
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/[$]/g, '\\$&')}\\s*=`).exec(source);
  if (!declaration) return null;
  const valueAt = skipTrivia(source, declaration.index + declaration[0].length);
  if (source[valueAt] === '[') return balanced(source, valueAt, '[', ']');
  if (source[valueAt] === '{') return balanced(source, valueAt, '{', '}');
  const semicolonAt = source.indexOf(';', valueAt);
  return source.slice(valueAt, semicolonAt < 0 ? source.length : semicolonAt).trim();
}

function evaluateStatic(expression, source, seen = new Set()) {
  assert(expression, 'Erwarteter statischer Ausdruck fehlt.');
  try {
    return vm.runInNewContext(`(${expression})`, Object.create(null), { timeout: 1000 });
  } catch (error) {
    if (!/^[A-Za-z_$][\w$]*$/.test(expression) || seen.has(expression)) throw error;
    seen.add(expression);
    const declaration = declarationExpression(source, expression);
    assert(declaration, `Statische Quelle ${expression} ist nicht auflösbar.`);
    return evaluateStatic(declaration, source, seen);
  }
}

function inputTag(id) {
  const needles = [`id="${id}"`, `id='${id}'`];
  const idAt = needles.map(needle => html.indexOf(needle)).find(index => index >= 0);
  assert.notEqual(idAt, undefined, `Eingabe #${id} fehlt.`);
  const openAt = html.lastIndexOf('<input', idAt);
  const closeAt = html.indexOf('>', idAt);
  assert(openAt >= 0 && closeAt >= 0 && openAt < idAt, `Input #${id} ist nicht auswertbar.`);
  return html.slice(openAt, closeAt + 1);
}

function assertLiteralCombo(id, key) {
  const tag = inputTag(id);
  assert.match(
    tag,
    new RegExp(`\\bdata-combo=["']${key}["']`, 'i'),
    `#${id} muss direkt den zentralen Schlüssel ${key} verwenden.`
  );
}

function tupleFor(source, field) {
  const pattern = new RegExp(`\\[\\s*(["'])${field}\\1\\s*,`, 'g');
  const match = pattern.exec(source);
  assert(match, `Felddefinition ${field} fehlt.`);
  const tupleSource = balanced(source, match.index, '[', ']');
  return vm.runInNewContext(`(${tupleSource})`, Object.create(null), { timeout: 1000 });
}

function tupleStartingWith(source, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\[\\s*(["'])${escaped}\\1\\s*,`, 'g');
  const match = pattern.exec(source);
  assert(match, `Zuordnung für ${value} fehlt.`);
  const tupleSource = balanced(source, match.index, '[', ']');
  return vm.runInNewContext(`(${tupleSource})`, Object.create(null), { timeout: 1000 });
}

function namedFunction(source, name) {
  const marker = `function ${name}(`;
  const at = source.indexOf(marker);
  assert(at >= 0, `Funktion ${name} fehlt.`);
  const bodyAt = source.indexOf('{', at);
  return source.slice(at, bodyAt) + balanced(source, bodyAt, '{', '}');
}

function assertCentralHouseTuple(tuple, context) {
  assert(
    tuple[4] === 'hausnummer' || tuple[4] === 'sd_hausnummer',
    `${context} muss als Combo-Semantik hausnummer bzw. direkt sd_hausnummer verwenden.`
  );
}

const stammdatenScript = scriptById('stammdaten-suggest-v160');
const registryScript = scriptById('suggestion-registry-v1');

test('sd_hausnummer ist eine echte statische Stammdaten-Liste mit garantiert 1 bis 500', () => {
  const staticCatalog = initializer(stammdatenScript, 'const STAMMDATEN_SUGGEST_STATIC_V160=');
  const houseExpression = directPropertyExpression(staticCatalog, 'hausnummer');
  assert(
    houseExpression,
    'hausnummer muss direkt in STAMMDATEN_SUGGEST_STATIC_V160 deklariert sein; eine spätere __finComboData-Injektion genügt nicht.'
  );

  const values = evaluateStatic(houseExpression, stammdatenScript);
  assert(Array.isArray(values), 'Die statische Hausnummernquelle muss ein Array liefern.');
  assert.deepEqual(
    Array.from(values, String),
    Array.from({ length: 500 }, (_unused, index) => String(index + 1)),
    'Die Softwarevorgabe für Hausnummern muss lückenlos exakt die Werte 1 bis 500 enthalten.'
  );

  const sdLabels = initializer(registryScript, 'const SD_LABELS=');
  const labelExpression = directPropertyExpression(sdLabels, 'hausnummer');
  assert(
    labelExpression,
    'SD_LABELS muss hausnummer direkt deklarieren; eine generische Schlüsselanzeige ist keine klare Katalogbeschriftung.'
  );
  const label = String(evaluateStatic(labelExpression, registryScript));
  assert.match(label, /Hausnummer/i, 'Die Katalogbeschriftung muss „Hausnummer“ nennen.');

  assert.match(
    stammdatenScript,
    /window\.__stammdatenSuggestions\s*=\s*\{\s*\.\.\.STAMMDATEN_SUGGEST_STATIC_V160/,
    'Der deklarierte statische Katalog muss in die veröffentlichte Stammdatenquelle eingehen.'
  );
});

test('alle festen Hausnummer-Eingaben verwenden sd_hausnummer', () => {
  ['abHouse', 'snHouse', 'pcHouse', 'coRecHouse'].forEach(id => assertLiteralCombo(id, 'sd_hausnummer'));

  const officeTag = inputTag('baE_house');
  if (!/\bdata-combo=["']sd_hausnummer["']/i.test(officeTag)) {
    assert.match(
      officeTag,
      /\$\{\s*combo\(\s*["']house["']\s*\)\s*\}/,
      '#baE_house muss entweder direkt sd_hausnummer oder die zentrale BA_COMBO-Route „house“ verwenden.'
    );
    const baScript = scriptById('bueroaddress-script-v1');
    const baCombo = initializer(baScript, 'const BA_COMBO=');
    const officeHouseKey = evaluateStatic(directPropertyExpression(baCombo, 'house'), baScript);
    assert.equal(officeHouseKey, 'sd_hausnummer', 'BA_COMBO.house muss auf sd_hausnummer zeigen.');
  }

  for (const id of ['hvRegHouse', 'hvHouse']) {
    const fieldAt = html.indexOf(`fieldV255('${id}'`);
    assert(fieldAt >= 0, `Wohnen-Feld ${id} fehlt.`);
    const call = html.slice(fieldAt, fieldAt + 240);
    assert.match(call, /combo\s*:\s*["']sd_hausnummer["']/, `${id} muss sd_hausnummer verwenden.`);
  }

  const stammdatenMapSource = initializer(stammdatenScript, 'const STAMMDATEN_SUGGEST_MAP_V160=', '[', ']');
  const houseNumberMapping = tupleStartingWith(stammdatenMapSource, '[data-casepath="person.houseNumber"]');
  assert.deepEqual(
    Array.from(houseNumberMapping || []),
    ['[data-casepath="person.houseNumber"]', 'hausnummer'],
    'Das Stammdatenfeld person.houseNumber muss auf die Semantik hausnummer zeigen.'
  );

  for (const fieldId of ['ha_house_no', 'wba_house_no', 'mv_house_no']) {
    const at = html.indexOf(`id:'${fieldId}'`);
    assert(at >= 0, `Dokumentfeld ${fieldId} fehlt.`);
    const definition = html.slice(at, html.indexOf('}', at) + 1);
    assert.match(definition, /combo\s*:\s*['"]sd_hausnummer['"]/, `${fieldId} muss sd_hausnummer verwenden.`);
  }

  assert.match(
    html,
    /function officialTableControl\([^]*?col\.combo\?` data-combo=/,
    'Auch amtliche strukturierte Tabellen müssen zentrale Comboboxschlüssel rendern.'
  );
  for (const tableKey of ['haPreviousBenefit', 'haEmployerClaim']) {
    const at = html.indexOf(`OFFICIAL_STRUCTURED_TABLES.${tableKey}=`);
    assert(at >= 0, `Amtliche Tabelle ${tableKey} fehlt.`);
    const tableDefinition = html.slice(at, at + 1400);
    assert.match(
      tableDefinition,
      /key\s*:\s*['"]houseNo['"][^}]*combo\s*:\s*['"]sd_hausnummer['"]/,
      `${tableKey}.houseNo muss sd_hausnummer verwenden.`
    );
  }
});

test('Fallbeginn löst Hausnummern und person.houseLetter über zentrale Stammdaten-Schlüssel auf', () => {
  const intakeScript = scriptById('caseintake-script-v1');
  const ciRows = initializer(intakeScript, 'const CI_ROWS=');
  assertCentralHouseTuple(tupleFor(ciRows, 'house'), 'Fallbeginn contacts[].house');

  const personAddressAt = intakeScript.indexOf('Anschrift &amp; Erreichbarkeit');
  assert(personAddressAt >= 0, 'Fallbeginn-Block „Anschrift & Erreichbarkeit“ fehlt.');
  const personAddressSource = intakeScript.slice(personAddressAt, personAddressAt + 2200);
  assertCentralHouseTuple(tupleFor(personAddressSource, 'houseNumber'), 'Fallbeginn person.houseNumber');

  const houseLetterTuple = tupleFor(personAddressSource, 'houseLetter');
  assert.equal(
    houseLetterTuple[4],
    'hausbuchstabe',
    'Fallbeginn person.houseLetter muss die vorhandene zentrale Stammdaten-Semantik hausbuchstabe verwenden.'
  );

  const staticCatalog = initializer(stammdatenScript, 'const STAMMDATEN_SUGGEST_STATIC_V160=');
  assert(
    directPropertyExpression(staticCatalog, 'hausbuchstabe'),
    'hausbuchstabe muss als vorhandener zentraler Stammdaten-Schlüssel deklariert sein.'
  );
  const sdLabels = initializer(registryScript, 'const SD_LABELS=');
  assert.match(
    String(evaluateStatic(directPropertyExpression(sdLabels, 'hausbuchstabe'), registryScript)),
    /(?:Hausbuchstabe|Hausnummer-Zusatz|Zusatz)/i,
    'Der zentrale Zusatz-Schlüssel braucht eine eindeutige Katalogbeschriftung.'
  );

  const stammdatenMapSource = initializer(stammdatenScript, 'const STAMMDATEN_SUGGEST_MAP_V160=', '[', ']');
  assert.deepEqual(
    Array.from(tupleStartingWith(stammdatenMapSource, '[data-casepath="person.houseLetter"]')),
    ['[data-casepath="person.houseLetter"]', 'hausbuchstabe'],
    'Auch das reguläre Stammdatenfeld person.houseLetter muss dieselbe zentrale Zusatz-Semantik verwenden.'
  );

  const comboFunctionAt = intakeScript.indexOf('function ciComboKey(sem)');
  assert(comboFunctionAt >= 0, 'ciComboKey fehlt.');
  const comboFunctionBodyAt = intakeScript.indexOf('{', comboFunctionAt);
  const comboFunction = `function ciComboKey(sem)${balanced(intakeScript, comboFunctionBodyAt, '{', '}')}`;
  const comboContext = {
    window: {
      __finComboData: {
        sd_hausnummer: [['Hausnummern', ['1', '500']]],
        sd_hausbuchstabe: [['Zusatz', ['a', 'b']]]
      }
    }
  };
  vm.runInNewContext(`${comboFunction};this.result=[ciComboKey('hausnummer'),ciComboKey('hausbuchstabe')];`, comboContext);
  assert.deepEqual(
    Array.from(comboContext.result),
    ['sd_hausnummer', 'sd_hausbuchstabe'],
    'Die Fallbeginn-Auflösung muss Hausnummer und Zusatz in die tatsächlich verwendeten zentralen Schlüssel übersetzen.'
  );
});

test('auch der Posteingang rendert Anschriftsvorschläge über die zentrale Server-Combobox', () => {
  const inboxScript = scriptById('inbox-script-v1');
  const sectionDefs = initializer(inboxScript, 'const INBOX_SECTION_FIELDDEFS=');
  const socialSource = directPropertyExpression(sectionDefs, 'socialNetwork');
  const socialHouse = tupleFor(socialSource, 'house');
  assert.deepEqual(
    Array.from(socialHouse),
    ['house', 'Hausnr.', 'combo', 'sd_hausnummer'],
    'Die Stammdaten-Zeile „Soziales Netzwerk“ im Posteingang darf nicht auf eine lokale Datalist zurückfallen.'
  );

  const context = {};
  vm.runInNewContext(
    `${namedFunction(inboxScript, 'inboxSectionFieldComboKey')}\n` +
    `${namedFunction(inboxScript, 'inboxScalarFieldComboKey')}\n` +
    `this.result=[` +
      `inboxSectionFieldComboKey('socialNetwork','house'),` +
      `inboxSectionFieldComboKey('socialNetwork','postal'),` +
      `inboxScalarFieldComboKey('person.house'),` +
      `inboxScalarFieldComboKey('person.houseLetter')` +
    `];`,
    context,
    { timeout: 1000 }
  );
  assert.deepEqual(
    Array.from(context.result),
    ['sd_hausnummer', 'sd_plz', 'sd_hausnummer', 'sd_hausbuchstabe'],
    'Listen- und skalare Anschriftsfelder im Posteingang müssen dieselben zentralen Schlüssel auflösen.'
  );

  const rendererAt = inboxScript.indexOf('function inboxSugRowHTML(');
  const renderer = namedFunction(inboxScript, 'inboxSugRowHTML');
  assert(rendererAt >= 0);
  assert.match(
    renderer,
    /data-combo=\\?"\$\{escAttr\(comboKey\)\}\\?"/,
    'Der Posteingangsrenderer muss den aufgelösten Schlüssel als data-combo ausgeben.'
  );
  assert.match(
    inboxScript,
    /house\s*:\s*['"]sd_hausnummer['"]/,
    'Auch die direkte Kontaktanlage im Posteingang muss Hausnummern per sd_hausnummer rendern.'
  );
});
