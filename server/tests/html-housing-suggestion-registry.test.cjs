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
  const idAt = html.search(new RegExp(`<script[^>]*\\bid=["']${id}["'][^>]*>`, 'i'));
  assert(idAt >= 0, `Script #${id} fehlt.`);
  const bodyAt = html.indexOf('>', idAt);
  const closeAt = html.indexOf('</script>', bodyAt);
  assert(bodyAt >= 0 && closeAt >= 0, `Script #${id} ist unvollständig.`);
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

function declarationExpression(source, name) {
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/[$]/g, '\\$&')}\\s*=`).exec(source);
  assert(declaration, `Deklaration ${name} fehlt.`);
  let valueAt = declaration.index + declaration[0].length;
  while (/\s/.test(source[valueAt] || '')) valueAt += 1;
  if (source[valueAt] === '[') return balanced(source, valueAt, '[', ']');
  if (source[valueAt] === '{') return balanced(source, valueAt, '{', '}');
  const semicolonAt = source.indexOf(';', valueAt);
  assert(semicolonAt >= 0, `Deklaration ${name} ist nicht abgeschlossen.`);
  return source.slice(valueAt, semicolonAt).trim();
}

function housingComboKeys() {
  const start = html.indexOf('function housingBodyV255()');
  const end = html.indexOf('window.openHousingModal=', start);
  assert(start >= 0 && end > start, 'Wohnen-Renderer housingBodyV255 fehlt.');
  return [...new Set(
    [...html.slice(start, end).matchAll(/\bcombo\s*:\s*["']([^"']+)["']/g)].map(match => match[1])
  )].sort();
}

function flattened(groups) {
  return (groups || []).flatMap(group => Array.isArray(group) && Array.isArray(group[1]) ? group[1] : []);
}

const defaultHousingCatalog = [
  'Ambulant betreute Wohnform',
  'Betreutes Einzelwohnen',
  'Betreutes Wohnen',
  'Besondere Wohnform / Eingliederungshilfe',
  'Frauenhaus / Schutzunterkunft',
  'Forensische Einrichtung / Maßregelvollzug',
  'Justizvollzugsanstalt',
  'Krankenhaus / Klinik',
  'Kurzzeitpflegeeinrichtung',
  'Notunterkunft / Obdachlosenunterkunft',
  'Pflegeheim / stationäre Pflegeeinrichtung',
  'Psychiatrische Einrichtung',
  'Rehabilitations- / Therapieeinrichtung',
  'Seniorenheim',
  'Wohnheim',
  'Wohngruppe / Wohngemeinschaft'
];

function officeField(key, label, values) {
  return {
    key,
    label,
    category: 'Stammdaten',
    sortMode: 'custom',
    groups: [{
      id: 'server-override',
      label: 'Server-Override',
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

function createRuntime(serverPayload, { caseData = {}, officeContacts = [], cachedCases = [], localCases = [] } = {}) {
  const addressbookScript = scriptById('addressbook-editor-reference-data');
  const addressbookNames = [
    'ADDRESSBOOK_STATUS_DEFAULT',
    'ADDRESSBOOK_ANREDE_DEFAULT',
    'ADDRESSBOOK_TITEL',
    'ADDRESSBOOK_HAUSBUCHSTABE',
    'ADDRESSBOOK_CATEGORIES'
  ];
  const referenceDeclarations = addressbookNames
    .map(name => `const ${name}=${declarationExpression(addressbookScript, name)};`)
    .join('\n');

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
    state: { caseData },
    caseRegistry: localCases.map((data, index) => ({ id: `local-${index}`, state: { caseData: data } })),
    // Produktive Cacheform: {data:{stammdaten,contacts,...}}, nicht {state:{caseData}}.
    __onlineCaseCache: new Map(cachedCases.map((data, index) => [String(index), {
      data: data && data.stammdaten ? data : { stammdaten: data, contacts: data?.contacts || [] }
    }])),
    async fetch(url, options = {}) {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() { return { data: serverPayload }; }
      };
    }
  };
  context.window = context;
  vm.createContext(context);

  new vm.Script(
    `${referenceDeclarations}\nwindow.__addressbookRefLists={` +
      `status:ADDRESSBOOK_STATUS_DEFAULT,briefanrede:ADDRESSBOOK_ANREDE_DEFAULT,` +
      `titel:ADDRESSBOOK_TITEL,hausbuchstabe:ADDRESSBOOK_HAUSBUCHSTABE};`,
    { filename: 'addressbook-reference-subset.js' }
  ).runInContext(context);
  new vm.Script(scriptById('stammdaten-suggest-v160'), {
    filename: 'stammdaten-suggest-v160.js'
  }).runInContext(context);
  new vm.Script(scriptById('bueroaddress-script-v1'), {
    filename: 'bueroaddress-script-v1.js'
  }).runInContext(context);
  context.__baWideRows = () => officeContacts;
  new vm.Script(scriptById('suggestion-registry-v1'), {
    filename: 'suggestion-registry-v1.js'
  }).runInContext(context);

  return { context, fetchCalls };
}

test('Wohnen fordert den first-class Katalog sd_wohneinrichtung mit der Feldbeschriftung Einrichtung an', () => {
  const houseNumbers = Array.from({ length: 500 }, (_unused, index) => String(index + 1));
  const { context } = createRuntime({ version: 1, fields: {} });
  const registry = context.__suggestionRegistry;
  assert(registry && typeof registry.apply === 'function', 'Die echte zentrale Vorschlagslisten-Registry muss starten.');

  registry.apply();

  const requestedKeys = housingComboKeys();
  assert(requestedKeys.length > 0, 'Das Wohnen-Menü muss zentrale Combobox-Schlüssel anfordern.');
  for (const requiredKey of ['sd_hausnummer', 'sd_hausbuchstabe', 'sd_wohneinrichtung']) {
    assert(requestedKeys.includes(requiredKey), `Das Wohnen-Menü muss ${requiredKey} anfordern.`);
  }
  assert(!requestedKeys.includes('sd_institution'), 'Das Wohnfeld darf nicht mehr den fachlich zu breiten Katalog sd_institution verwenden.');
  for (const key of requestedKeys) {
    assert(
      Object.prototype.hasOwnProperty.call(context.__finComboData, key),
      `Der vom Wohnen-Menü angeforderte Schlüssel ${key} ist nach dem echten Registry-Aufbau unbekannt.`
    );
    assert(Array.isArray(context.__finComboData[key]), `${key} muss im veröffentlichten Katalog ein Gruppenarray sein.`);
  }

  assert.deepEqual(
    Array.from(flattened(context.__finComboData.sd_hausnummer)),
    houseNumbers,
    'Die zentrale Softwarevorgabe sd_hausnummer muss lückenlos exakt 1 bis 500 enthalten.'
  );
  assert.deepEqual(
    Array.from(flattened(context.__finComboData.sd_hausbuchstabe)),
    'abcdefghijklmnopqrstuvwxyz'.split(''),
    'sd_hausbuchstabe muss aus der gemeinsamen zentralen Referenzliste aufgebaut werden.'
  );
  assert.match(
    html,
    /fieldV255\(\s*['"]hvInstitution['"]\s*,\s*['"]Einrichtung['"]\s*,\s*r\.institution\s*,\s*\{\s*wide\s*:\s*true\s*,\s*combo\s*:\s*['"]sd_wohneinrichtung['"]\s*\}\s*\)/,
    'hvInstitution muss exakt als „Einrichtung“ beschriftet und mit sd_wohneinrichtung verdrahtet sein.'
  );
  assert(
    Object.prototype.hasOwnProperty.call(context.__stammdatenSuggestions, 'wohneinrichtung'),
    'wohneinrichtung muss als eigener Stammdaten-Schlüssel deklariert sein.'
  );
  assert.match(
    scriptById('suggestion-registry-v1'),
    /wohneinrichtung\s*:\s*['"](?:Wohnen\s*[–-]\s*)?Einrichtung(?:\s*\(Wohnen\))?['"]/i,
    'Der Registry-Katalog braucht eine sprechende first-class Beschriftung für sd_wohneinrichtung.'
  );
});

test('sd_wohneinrichtung übernimmt nur Wohnquellen und schließt fachfremde oder inaktive Institutionen aus', () => {
  const positive = [
    'Wohnstift Sonnenhof',
    'Haus Regenbogen',
    'Pflegezentrum Fallkontakt',
    'Wohncampus Einrichtungsträger',
    'Wohnanlage Geplant',
    'Wohnheim Sozialnetzwerk',
    'Seniorenresidenz Bürokontakt',
    'Wohnhaus Büro ohne Kategorie',
    'Wohnpark Online',
    'Wohnkontakt Online',
    'Wohnpark Lokal',
    'Wohnkontakt Lokal'
  ];
  const negative = [
    'Altes Personen-Institutionsfeld',
    'Klinikum Facharztzentrum',
    'Ambulante Reha Fachzentrum',
    'Ehemaliges Wohnheim Fallkontakt',
    'Ehemaliges Wohnheim Sozialnetzwerk',
    'Bankinstitut Nord',
    'Versicherung AG',
    'Sozialamt Leistung',
    'Justizkasse Vermögen',
    'Amtsgericht Frist',
    'Vermieter Bürokontakt',
    'Ehemalige Einrichtung Bürokontakt'
  ];
  const caseData = {
    person: { institution: 'Altes Personen-Institutionsfeld' },
    accommodation: {
      institution: 'Wohnstift Sonnenhof',
      currentResidence: { institution: 'Haus Regenbogen' }
    },
    contacts: [
      { status: 'Aktiv', _category: 'unterkunft', role: 'Einrichtung / Heim', institution: 'Pflegezentrum Fallkontakt' },
      { status: 'Aktiv', _category: 'unterkunft', role: 'Einrichtungsträger', institution: 'Wohncampus Einrichtungsträger' },
      { status: 'Beabsichtigt', _category: 'unterkunft', role: 'Einrichtungsträger', institution: 'Wohnanlage Geplant' },
      { status: 'Aktiv', _category: 'gesundheit', role: 'Allgemeinmedizin', institution: 'Klinikum Facharztzentrum' },
      { status: 'Aktiv', _category: 'gesundheit', role: 'ambulante Reha', institution: 'Ambulante Reha Fachzentrum' },
      { status: 'Beendet', _category: 'unterkunft', role: 'Einrichtung / Heim', institution: 'Ehemaliges Wohnheim Fallkontakt' }
    ],
    socialNetwork: [
      { status: 'Aktiv', role: 'Einrichtung / Heim', institution: 'Wohnheim Sozialnetzwerk' },
      { status: 'Beendet', role: 'Einrichtung / Heim', institution: 'Ehemaliges Wohnheim Sozialnetzwerk' }
    ],
    banks: [{ institution: 'Bankinstitut Nord' }],
    insurances: [{ institution: 'Versicherung AG' }],
    benefits: [{ provider: 'Sozialamt Leistung' }],
    assets: { begin: [{ institution: 'Justizkasse Vermögen' }], end: [], debtsBegin: [], debtsEnd: [] },
    fristen: [{ institution: 'Amtsgericht Frist' }]
  };
  const officeContacts = [
    { __buero: true, status: 'Aktiv', _category: 'unterkunft', role: 'Wohnheim / Einrichtung', institution: 'Seniorenresidenz Bürokontakt' },
    { __buero: true, status: 'Aktiv', role: 'Einrichtungsträger', institution: 'Wohnhaus Büro ohne Kategorie' },
    { __buero: true, status: 'Aktiv', _category: 'unterkunft', role: 'Vermieter', institution: 'Vermieter Bürokontakt' },
    { __buero: true, status: 'Beendet', _category: 'unterkunft', role: 'Einrichtungsträger', institution: 'Ehemalige Einrichtung Bürokontakt' }
  ];
  const cachedCases = [{
    stammdaten: { accommodation: { currentResidence: { institution: 'Wohnpark Online' } } },
    contacts: [{ status: 'Geplant', _category: 'unterkunft', role: 'Einrichtungsträger', institution: 'Wohnkontakt Online' }]
  }];
  const localCases = [{
    accommodation: { institution: 'Wohnpark Lokal' },
    contacts: [{ status: 'Vorhanden', _category: 'unterkunft', role: 'Einrichtungsträger', institution: 'Wohnkontakt Lokal' }]
  }];
  const { context } = createRuntime({ version: 1, fields: {} }, { caseData, officeContacts, cachedCases, localCases });
  context.__suggestionRegistry.apply();
  const values = Array.from(flattened(context.__finComboData.sd_wohneinrichtung));

  for (const value of positive) assert(values.includes(value), `${value} muss als aktive, wohnbezogene Quelle vorgeschlagen werden.`);
  for (const value of negative) assert(!values.includes(value), `${value} darf nicht als Wohneinrichtung vorgeschlagen werden.`);
  assert.equal(new Set(values.map(value => value.toLocaleLowerCase('de'))).size, values.length, 'Wohnvorschläge müssen ohne Dubletten veröffentlicht werden.');
  assert.deepEqual(values, [...values].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' })), 'Wohnvorschläge müssen alphabetisch sortiert sein.');
});

test('ohne gespeicherte Einrichtungsnamen bleibt ein wohnfachlicher Basiskatalog sichtbar', () => {
  const { context } = createRuntime({ version: 1, fields: {} }, {
    caseData: {
      accommodation: {
        type: 'Heim/Einrichtung',
        institution: '',
        currentResidence: { type: 'Pflegeheim', institution: '' }
      },
      contacts: [
        { status: 'Aktiv', _category: 'gesundheit', role: 'Krankenhaus', institution: 'Klinikum ohne Wohnbezug' },
        { status: 'Aktiv', _category: 'finanzen', role: 'Bankinstitut', institution: 'Bank ohne Wohnbezug' }
      ],
      socialNetwork: [],
      banks: [{ institution: 'Kreditinstitut Beispiel' }],
      fristen: [{ institution: 'Amtsgericht Beispiel' }]
    },
    officeContacts: [
      { __buero: true, status: 'Aktiv', _category: 'unterkunft', role: 'Vermieter', institution: 'Hausverwaltung Beispiel' }
    ]
  });
  context.__suggestionRegistry.apply();

  const values = Array.from(flattened(context.__finComboData.sd_wohneinrichtung));
  assert.deepEqual(
    values,
    [...defaultHousingCatalog].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' })),
    'Auch ohne konkrete Bestandsnamen muss das Feld einen nutzbaren, rein wohnfachlichen Basiskatalog anbieten.'
  );
  for (const foreignInstitution of ['Klinikum ohne Wohnbezug', 'Bank ohne Wohnbezug', 'Kreditinstitut Beispiel', 'Amtsgericht Beispiel', 'Hausverwaltung Beispiel']) {
    assert(!values.includes(foreignInstitution), `${foreignInstitution} darf nicht aus einer fachfremden Quelle in den Wohnkatalog gelangen.`);
  }
  assert.deepEqual(
    Array.from(context.__stammdatenSuggestions.wohneinrichtung),
    defaultHousingCatalog,
    'Die garantierte Softwarevorgabe muss unmittelbar und ohne vorherige Datenimporte verfügbar sein.'
  );
});

test('der serverseitige Override von sd_wohneinrichtung ersetzt die dynamische Softwareliste', async () => {
  const serverValues = ['Pflegecampus Server', 'Wohnanlage Server'];
  const serverPayload = {
    version: 1,
    fields: {
      sd_wohneinrichtung: officeField('sd_wohneinrichtung', 'Wohneinrichtung', serverValues)
    }
  };
  const caseData = {
    accommodation: {
      institution: 'Wohnstift Software',
      currentResidence: { institution: 'Wohnheim Software' }
    }
  };
  const { context, fetchCalls } = createRuntime(serverPayload, { caseData });
  const registry = context.__suggestionRegistry;
  registry.apply();
  const softwareValues = Array.from(flattened(context.__finComboData.sd_wohneinrichtung));
  for (const value of [...defaultHousingCatalog, 'Wohnheim Software', 'Wohnstift Software']) {
    assert(softwareValues.includes(value), `Vor dem Serverladen muss ${value} in der wohnfachlichen Softwareliste wirksam sein.`);
  }

  await registry.load(true);

  assert.equal(fetchCalls.length, 1, 'Der simulierte serverseitige Bürokatalog muss genau einmal geladen werden.');
  assert.equal(fetchCalls[0].url, '/api/office-json/suggestion_registry');
  assert.equal(fetchCalls[0].options.credentials, 'same-origin');
  assert.deepEqual(
    Array.from(flattened(context.__finComboData.sd_wohneinrichtung)),
    serverValues,
    'Der serverseitige office_json.suggestion_registry-Override muss die wirksame Wohneinrichtungsliste vollständig bestimmen.'
  );
  assert.equal(
    context.__finComboData.sd_wohneinrichtung[0][0],
    'Server-Override',
    'Auch die serverseitige Gruppierung muss übernommen werden; ein bloßes Zurückfallen auf die Softwarevorgabe genügt nicht.'
  );
  assert(!flattened(context.__finComboData.sd_wohneinrichtung).includes('Wohnstift Software'), 'Ein gepflegter Bürostand muss die dynamische Softwareliste überstimmen.');
});
