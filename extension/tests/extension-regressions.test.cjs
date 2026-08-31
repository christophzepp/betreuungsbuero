const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extensionDir = path.join(__dirname, '..');
const source = (relative) => fs.readFileSync(path.join(extensionDir, relative), 'utf8');

test('Dictionary und Matcher verarbeiten schemaoffene Werte ohne Binärdaten', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(source('src/common/synonyms.js'), context);
  vm.runInContext("function bxaNorm(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim(); }", context);
  vm.runInContext(source('src/common/dictionary.js'), context);
  vm.runInContext(source('src/common/matcher.js'), context);
  const dict = context.bxaBuildDictionary({ case: { fileNumber: '42/26' }, caseData: {
    person: { firstName: 'Maria', custom: 'Neu', photo: 'data:image/png;base64,AAAA' }
  }, contacts: [], reports: {}, documentationEntries: [], officeProfile: {}, officeBankAccounts: [], officeEmployees: [] });
  const byKey = new Map(dict.map(entry => [entry.key, entry.value]));
  assert.equal(byKey.get('case:fileNumber'), '42/26');
  assert.equal(byKey.get('case:person.custom'), 'Neu');
  assert.ok(!dict.some(entry => String(entry.value).startsWith('data:')));
  const matcher = vm.runInContext('BxaMatcher', context);
  const matches = matcher.match([{ ref: 'r1', kind: 'field', label: 'Vorname', placeholder: '', title: '', name: '', id: '', autocomplete: '', sectionContext: '' }], dict);
  assert.equal(matches[0].key, 'case:person.firstName');
});

test('PDF-Generator erzeugt ein vollständiges PDF-Dokument', () => {
  const context = { TextEncoder, Uint8Array, Date };
  vm.createContext(context);
  vm.runInContext(source('src/common/pdf.js'), context);
  const pdf = vm.runInContext('BxaPdf', context);
  const bytes = pdf.buildProtocolPdf({
    title: 'Test', meta: [['Fall', 'Muster']], fields: [['Vorname', 'Maria']], actions: [], footer: 'Ende'
  });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-'));
  assert.match(text, /%%EOF\s*$/);
  assert.ok(bytes.length > 500);
});

test('Fallwechsel setzt sämtliche fallgebundenen Zustände zurück', () => {
  const panel = source('src/panel/panel.js');
  assert.match(panel, /function resetCaseBoundState\(\)/);
  for (const assignment of [
    'P.baseDict = []', 'P.descriptors = []', 'P.proposals = []', 'P.protocol = null',
    'P.uploadDocs = []', 'P.attachments = []', 'P.resolvedActions = []', 'P.scannedUrls = new Set()'
  ]) assert.ok(panel.includes(assignment), assignment);
  assert.match(panel, /loadSeq !== caseLoadSeq/);
  assert.match(panel, /P\.localCases\.find\(entry => String\(entry\.id\) === localToken\)/);
  assert.match(source('src/options/options.js'), /entry\.id = list\[existing\]\.id \|\| entry\.id/);
});

test('Absende-Sperre besteht im Panel und zusätzlich im Content-Router', () => {
  const panel = source('src/panel/panel.js');
  const main = source('src/content/main.js');
  const scanner = source('src/content/scanner.js');
  assert.match(panel, /result\?\.requiresConfirmation/);
  assert.match(panel, /clickResult\?\.requiresConfirmation/);
  assert.match(main, /msg\.confirmed !== true/);
  assert.match(main, /requiresConfirmation: true/);
  assert.match(scanner, /el\.tagName === 'INPUT' \|\| el\.tagName === 'BUTTON'/);
});

test('Nur-Lese-Modus blockiert alle direkten Änderungen an Webseiten', () => {
  const panel = source('src/panel/panel.js');
  for (const functionName of ['tryFillActive', 'doUploadSet', 'runProfileAction', 'aiApply']) {
    const start = panel.indexOf(`async function ${functionName}`);
    assert.ok(start >= 0, functionName);
    const next = panel.indexOf('\nasync function ', start + 1);
    const body = panel.slice(start, next < 0 ? panel.length : next);
    assert.match(body, /P\.readOnly/, functionName);
  }
});

test('Build schließt macOS-Metadaten aus', () => {
  assert.match(source('build.js'), /entry\.name === '\.DS_Store'/);
});

test('Kontextmenü wird nach asynchronem removeAll serialisiert erzeugt', async () => {
  const events = [];
  const listener = () => ({ addListener() {} });
  const context = {
    BX: {
      sidePanel: null, sidebarAction: null,
      action: { onClicked: listener(), setBadgeText: async () => {}, setTitle: async () => {} },
      tabs: { onUpdated: listener(), onActivated: listener() },
      storage: { local: { get: async () => ({}) } },
      runtime: { onInstalled: listener(), onStartup: listener() },
      contextMenus: {
        onClicked: listener(),
        async removeAll() { events.push('remove:start'); await new Promise(resolve => setTimeout(resolve, 5)); events.push('remove:end'); },
        create() { events.push('create'); }
      }
    },
    Promise, setTimeout
  };
  vm.createContext(context);
  vm.runInContext(source('src/background.js'), context);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual(events, ['remove:start', 'remove:end', 'create']);
});
