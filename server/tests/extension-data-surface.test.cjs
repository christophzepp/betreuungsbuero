const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const extensionDir = path.join(root, 'extension');

function loadDictionary() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    "function bxaNorm(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim(); }",
    context
  );
  vm.runInContext(fs.readFileSync(path.join(extensionDir, 'src/common/dictionary.js'), 'utf8'), context);
  return context;
}

test('Formular-Assistent stellt alle fachlichen Datenquellen als Dictionary-Werte bereit', () => {
  const { bxaBuildDictionary, bxaBuildActiveContactDictionary } = loadDictionary();
  const dictionary = bxaBuildDictionary({
    case: { id: 'fall-1', label: 'Muster, Maria', fileNumber: 'XVII 42/26' },
    caseData: {
      person: {
        firstName: 'Maria', lastName: 'Muster', photo: 'data:image/jpeg;base64,SEHRGROSS',
        neuesFachfeld: 'schemaoffen erreichbar'
      },
      care: { court: 'Amtsgericht Köln' },
      history: [{ note: 'Telefonat mit dem Gericht' }],
      derived: { monthlyTotal: 1234.56 },
      promptHints: { wohnsituation: 'barrierefrei' },
      rechtlicherBetreuer: 'Ada Lovelace'
    },
    contacts: [{
      vorname: 'Karl', nachname: 'Kontakt', strasse: 'Hauptstraße', hausnummer: '7a',
      plz: '50667', ort: 'Köln', mail: 'karl@example.test', telefon: '0221/123',
      individuellesMerkmal: 'Akteneinsicht'
    }],
    reports: {
      annual: { fields: { income: { value: '1.234,56 EUR', source: 'manual', reviewed: true } } }
    },
    documentationEntries: [{ date: '2026-08-25', note: 'Hausbesuch durchgeführt' }],
    officeProfile: { companyName: 'Betreuungsbüro Beispiel', city: 'Bonn' },
    officeBankAccounts: [{ id: 'bank-1', bankName: 'Musterbank', accountType: 'Anderkonto', iban: 'DE001234' }],
    officeEmployees: [{
      id: 'employee-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test',
      maKennung: 'AL', extra: { beaSafeId: 'safe-42' }
    }]
  });
  const byKey = new Map(dictionary.map((entry) => [entry.key, entry.value]));

  assert.equal(byKey.get('case:fileNumber'), 'XVII 42/26');
  assert.equal(byKey.get('case:person.neuesFachfeld'), 'schemaoffen erreichbar');
  assert.equal(byKey.get('case:history.0.note'), 'Telefonat mit dem Gericht');
  assert.equal(byKey.get('case:derived.monthlyTotal'), '1234.56');
  assert.equal(byKey.get('case:promptHints.wohnsituation'), 'barrierefrei');
  assert.equal(byKey.get('report:annual.income'), '1.234,56 EUR');
  assert.equal(byKey.get('doku:0.note'), 'Hausbesuch durchgeführt');
  assert.equal(byKey.get('contact:0.firstName'), 'Karl');
  assert.equal(byKey.get('contact:0.streetFull'), 'Hauptstraße 7a');
  assert.equal(byKey.get('contact:0.email'), 'karl@example.test');
  assert.equal(byKey.get('contact:0.individuellesMerkmal'), 'Akteneinsicht');
  assert.equal(byKey.get('office:bank.0.accountType'), 'Anderkonto');
  assert.equal(byKey.get('office:employee.0.extra.beaSafeId'), 'safe-42');
  assert.equal(byKey.get('betreuer:email'), 'ada@example.test');
  assert.equal(byKey.get('betreuer:fullName'), 'Ada Lovelace');
  assert.ok(!dictionary.some((entry) => String(entry.value).startsWith('data:')));

  const activeContact = new Map(bxaBuildActiveContactDictionary({ vorname: 'Karl', nachname: 'Kontakt' })
    .map((entry) => [entry.key, entry.value]));
  assert.equal(activeContact.get('kontakt.firstName'), 'Karl');
  assert.equal(activeContact.get('kontakt.fullName'), 'Karl Kontakt');
});

test('reale Datensicherung liefert Fall-, Berichts-, Doku- und deutsche Kontaktfelder', () => {
  const { bxaBuildDictionary } = loadDictionary();
  const exportPath = path.join(root, 'exports/faelle/Margarete_Auerbach_Betreuungsakte_2026-08-24.json');
  if (!fs.existsSync(exportPath)) return;
  const backup = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  const dictionary = bxaBuildDictionary({
    case: { label: 'Auerbach, Margarete', fileNumber: backup.caseData?.care?.fileNumber || '' },
    caseData: backup.caseData,
    contacts: backup.caseData.contacts,
    reports: backup.reports,
    documentationEntries: backup.caseData.documentationEntries,
    officeProfile: {}, officeBankAccounts: [], officeEmployees: []
  });
  const byKey = new Map(dictionary.map((entry) => [entry.key, entry.value]));

  assert.ok(dictionary.length > 2000, 'unerwartet wenige nutzbare Werte aus der realen Datensicherung');
  assert.equal(byKey.get('contact:0.street'), 'Ludwigstraße');
  assert.equal(byKey.get('contact:0.postalCode'), '55469');
  assert.equal(byKey.get('contact:0.email'), 'sozialamt@rhein-hunsrueck.de');
  assert.ok([...byKey.keys()].some((key) => key.startsWith('report:')));
  assert.ok([...byKey.keys()].some((key) => key.startsWith('doku:')));
});

test('Extension-Dokumentrouten verwenden zentrale Fallakte mit Berechtigung und Altbestands-Fallback', () => {
  const source = fs.readFileSync(path.join(root, 'server/src/integrations/extensions/routes.js'), 'utf8');
  assert.match(source, /FROM doc_files/);
  assert.match(source, /area = 'case' AND case_id = \? AND deleted_at = ''/);
  assert.match(source, /requireExtDocumentView/);
  assert.match(source, /documentIntern\.findBlobPath/);
  assert.match(source, /FROM case_documents/);
  assert.match(source, /source: 'central'/);
  assert.match(source, /source: 'legacy'/);
});

test('Die Versionsnummer der Erweiterung ist in allen Paketquellen synchron', () => {
  // Bis zum Umbau auf 0.5.0 (31.08.2026) stand hier die Zahl selbst - jeder Versionssprung
  // machte den Pruefstand rot, ohne dass etwas kaputt war. Gepinnt wird jetzt die EINIGKEIT:
  // package.json ist die Wahrheit, die beiden Manifeste und die Sperrdatei muessen folgen.
  const paket = JSON.parse(fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf8')).version;
  assert.match(paket, /^\d+\.\d+\.\d+$/, 'package.json traegt keine Fassung im Format x.y.z');
  for (const file of ['manifest.chrome.json', 'manifest.firefox.json', 'package-lock.json']) {
    const json = JSON.parse(fs.readFileSync(path.join(extensionDir, file), 'utf8'));
    assert.equal(json.version, paket, file);
    if (file === 'package-lock.json') assert.equal(json.packages[''].version, paket);
  }
  // Der Notnagel im Panel greift, wenn getManifest() fehlt - er darf nicht zurueckbleiben.
  const panel = fs.readFileSync(path.join(extensionDir, 'src/panel/panel.js'), 'utf8');
  const notnagel = /getManifest\(\)\.version\) \|\| '([^']+)'/.exec(panel);
  assert.ok(notnagel, 'Notnagel in panel.js fehlt');
  assert.equal(notnagel[1], paket, 'panel.js meldet ohne Manifest eine andere Fassung');
});
