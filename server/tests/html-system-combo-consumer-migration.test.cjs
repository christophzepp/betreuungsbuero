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

function evaluateFunctions(source, names, globals = {}) {
  const context = { ...globals };
  vm.createContext(context);
  const exports = names.map(name => `this.${name}=${name};`).join('\n');
  new vm.Script(`${names.map(name => namedFunction(source, name)).join('\n')}\n${exports}`)
    .runInContext(context, { timeout: 1000 });
  return context;
}

function sourceRegion(source, startMarker, endMarker, from = 0) {
  const start = source.indexOf(startMarker, from);
  assert(start >= 0, `Quellbereich ${startMarker} fehlt.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, `Ende ${endMarker} nach ${startMarker} fehlt.`);
  return source.slice(start, end);
}

function staticObject(region, name) {
  const marker = `const ${name}=`;
  const markerAt = region.indexOf(marker);
  assert(markerAt >= 0, `Objekt ${name} fehlt.`);
  const openAt = region.indexOf('{', markerAt + marker.length);
  const expression = balanced(region, openAt, '{', '}');
  return vm.runInNewContext(`(${expression})`, Object.create(null), { timeout: 1000 });
}

function rowCombo(rows, section, key) {
  const tuple = rows[section].find(row => row[0] === key);
  assert(tuple, `${section}.${key} fehlt in CI_ROWS.`);
  return tuple[4] || '';
}

const stammdaten = scriptById('stammdaten-suggest-v160');
const inbox = scriptById('inbox-script-v1');
const intake = scriptById('caseintake-script-v1');
const inboxFns = evaluateFunctions(inbox, [
  'inboxSectionFieldComboKey',
  'inboxScalarFieldComboKey'
]);

test('Geburtsort verwendet in Stammdaten, Sozialem Netzwerk und Posteingang dieselbe Ortsliste', () => {
  assert.match(
    stammdaten,
    /\['\[data-casepath="person\.birthPlace"\]'\s*,\s*'ort'\]/,
    'Der Geburtsort der betreuten Person muss auf sd_ort zeigen.'
  );
  assert.match(
    stammdaten,
    /\['#snBirthPlace'\s*,\s*'ort'\]/,
    'Der Geburtsort im Sozialen Netzwerk muss auf sd_ort zeigen.'
  );
  assert.equal(inboxFns.inboxScalarFieldComboKey('person.birthPlace'), 'sd_ort');
});

test('Blutgruppe und Wertmarke sind first-class zentrale Stammdaten-Kataloge', () => {
  assert.match(
    stammdaten,
    /\bblutgruppe\s*:\s*SUGGESTION_DEFAULTS_V1\.ci\.blutgruppe/,
    'sd_blutgruppe muss aus dem zentralen Stammdatenkatalog veröffentlicht werden.'
  );
  assert.match(
    stammdaten,
    /\['\[data-casepath="health\.valueStamp"\]'\s*,\s*'wertmarke'\]/,
    'Das Stammdatenfeld Wertmarke muss sd_wertmarke verwenden.'
  );
  assert.match(
    html,
    /sc\('bloodType'\s*,\s*'z\. B\. A Rh\+'\s*,\s*'sd_blutgruppe'\)/,
    'Das Gesundheitsmenü muss für Blutgruppe sd_blutgruppe anfordern.'
  );
  assert.equal(inboxFns.inboxScalarFieldComboKey('healthInfo.bloodType'), 'sd_blutgruppe');
  assert.equal(inboxFns.inboxScalarFieldComboKey('health.valueStamp'), 'sd_wertmarke');
});

test('Ausweisstatus wird in Stammdaten und Posteingang von der Ausweisart abgeleitet', () => {
  const mainFns = evaluateFunctions(stammdaten, ['identifiersStatusKeyV160'], {
    norm(value) { return String(value || '').trim().toLowerCase(); }
  });
  const fakeInput = type => ({
    closest() {
      return { querySelector() { return { value: type }; } };
    }
  });
  assert.equal(mainFns.identifiersStatusKeyV160(fakeInput('Aufenthaltstitel')), 'aufenthaltsstatus');
  assert.equal(mainFns.identifiersStatusKeyV160(fakeInput('Duldung')), 'aufenthaltsstatus');
  assert.equal(mainFns.identifiersStatusKeyV160(fakeInput('Beitragsservice')), 'beitragsstatus');
  assert.equal(mainFns.identifiersStatusKeyV160(fakeInput('Personalausweis')), 'idstatus');
  assert.match(
    stammdaten,
    /\['\[data-array-path-v156="identifiers"\]\[data-array-prop-v156="status"\]'\s*,\s*identifiersStatusKeyV160\]/,
    'Die Statusspalte der Stammdaten-Ausweistabelle muss den dynamischen Auflöser verwenden.'
  );

  const status = type => inboxFns.inboxSectionFieldComboKey(
    'identifiers',
    'status',
    [{ path: 'type', newValue: type }]
  );
  assert.equal(status('Aufenthaltsgestattung'), 'sd_aufenthaltsstatus');
  assert.equal(status('Sozialverwaltungsstelle'), 'sd_beitragsstatus');
  assert.equal(status('Reisepass'), 'sd_idstatus');
  const update = sourceRegion(
    inbox,
    'window.__inboxSugStammField=async function',
    '// Listeneinträge einer Sektion'
  );
  assert.match(update, /identifiers/, 'Der Typwechsel-Guard muss Ausweise berücksichtigen.');
  assert.match(update, /path\s*===\s*["']type["']/, 'Der Neuaufbau muss an den Typwechsel gekoppelt sein.');
  assert.match(
    update,
    /inboxRerenderKeepScroll\(\)/,
    'Ein Wechsel der Ausweisart muss den Posteingang neu rendern, damit die Statusliste wechselt.'
  );
});

test('Posteingang rendert Doku, Kontakt, Aufgabenkreis, Schulden, Genehmigung, GDP und Vorsorge mit zentralen Schlüsseln', () => {
  const rowStart = inbox.indexOf('function inboxSugRowHTML');
  assert(rowStart >= 0, 'Posteingangsrenderer inboxSugRowHTML fehlt.');
  const doku = sourceRegion(inbox, "else if(s.kind==='doku'){", "else if(s.kind==='stammdaten'){", rowStart);
  const schuld = sourceRegion(inbox, "else if(s.kind==='schuld'){", "else if(s.kind==='frist'){", rowStart);
  const genehmigung = sourceRegion(inbox, "else if(s.kind==='genehmigung'){", "else if(s.kind==='gdp'){", rowStart);
  const gdp = sourceRegion(inbox, "else if(s.kind==='gdp'){", "else if(s.kind==='vorsorge'){", rowStart);
  const vorsorge = sourceRegion(inbox, "else if(s.kind==='vorsorge'){", "else if(s.kind==='action'){", rowStart);
  const taskareas = sourceRegion(inbox, "else if(s.kind==='taskareas'){", "else if(s.kind==='kontakt'){", rowStart);
  const kontakt = sourceRegion(inbox, "else if(s.kind==='kontakt'){", "else if(s.kind==='contact'){", rowStart);

  for (const [field, key] of [
    ['actorGroup', 'doku_actorGroup'],
    ['actor', 'doku_actor'],
    ['type', 'doku_type'],
    ['detail', 'doku_detail'],
    ['contactType', 'doku_contactType']
  ]) {
    assert.match(doku, new RegExp(`dokuInput\\('${field}'\\s*,\\s*'${key}'`));
  }
  assert.match(kontakt, /data-combo="km_art"/);
  assert.match(kontakt, /data-combo="km_notiz"/);
  assert.match(taskareas, /data-combo="sd_aufgabenkreis"/);
  assert.match(schuld, /data-combo="vaDebtCats"/);
  assert.match(genehmigung, /key==='art'\?' data-combo="apCats" autocomplete="off"/);
  assert.match(gdp, /const gf=\(key,ph,cls,combo\)=>/);
  for (const [field, key] of [['area', 'gdp_area'], ['status', 'gdp_status'], ['priority', 'gdp_priority']]) {
    assert.match(gdp, new RegExp(`gf\\('${field}'[^\\n]+?'${key}'\\)`));
  }
  assert.match(vorsorge, /data-combo="sd_vorsorgestatus"/);
});

test('Posteingang verwendet für Fall- und Büro-Adressbuch getrennte Kataloge', () => {
  const rowStart = inbox.indexOf('function inboxSugRowHTML');
  const contact = sourceRegion(inbox, "else if(s.kind==='contact'){", '\n  else{', rowStart);
  const fallKeys = staticObject(contact, 'fallKeys');
  const bueroKeys = staticObject(contact, 'bueroKeys');

  assert.deepEqual(
    Object.fromEntries(Object.entries(fallKeys)),
    {
      role: 'ab_role',
      salutation: 'ab_salutation',
      title: 'ab_title',
      institution: 'sd_institution',
      house: 'sd_hausnummer',
      postal: 'ab_plz',
      city: 'ab_ort'
    }
  );
  assert.equal(
    inboxFns.inboxSectionFieldComboKey('socialNetwork', 'institution', []),
    'sd_institution',
    'Eine Institution im Sozialen Netzwerk ist fallbezogen und muss sd_institution verwenden.'
  );
  assert.equal(
    inboxFns.inboxScalarFieldComboKey('person.institution'),
    'sd_institution',
    'Eine allgemeine Institution in den Fall-Stammdaten muss sd_institution verwenden.'
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(bueroKeys)),
    {
      role: 'ba_role',
      salutation: 'ba_salutation',
      title: 'ba_title',
      institution: 'ba_institution',
      house: 'sd_hausnummer',
      postal: 'ba_postal',
      city: 'ba_city'
    }
  );
});

test('Fallbeginn verwendet die Fachkataloge für Doku, Kontakt, Genehmigung und Frequenz', () => {
  const rows = vm.runInNewContext(
    `(${initializer(intake, 'const CI_ROWS=')})`,
    Object.create(null),
    { timeout: 1000 }
  );
  const expected = [
    ['dokuEntries', 'actorGroup', 'doku_actorGroup'],
    ['dokuEntries', 'actor', 'doku_actor'],
    ['dokuEntries', 'type', 'doku_type'],
    ['dokuEntries', 'detail', 'doku_detail'],
    ['personalContacts', 'art', 'km_art'],
    ['personalContacts', 'note', 'km_notiz'],
    ['approvals', 'art', 'apCats'],
    ['expenses', 'frequency', 'luFreq']
  ];
  for (const [section, key, combo] of expected) {
    assert.equal(rowCombo(rows, section, key), combo, `${section}.${key} muss ${combo} verwenden.`);
  }
});

test('Büroprofil wählt für Anrede, PLZ, Ort und Land den passenden zentralen Katalog', () => {
  assert.match(
    inbox,
    /\{salutation:'sd_anrede'\s*,\s*postalCode:'sd_plz'\s*,\s*city:'sd_ort'\s*,\s*country:'sd_land'\}\)\[fm\.field\]/,
    'Der Wert-Editor der Büroprofil-Aktion muss feldabhängig sd_anrede, sd_plz, sd_ort oder sd_land wählen.'
  );
  assert.match(
    inbox,
    /s\.actionKey==='buero\.profile'\s*&&\s*key==='field'\)await inboxRerenderKeepScroll\(\)/,
    'Ein Wechsel des Büroprofil-Feldes muss den Wert-Editor mit dem neuen Katalog neu rendern.'
  );
});
