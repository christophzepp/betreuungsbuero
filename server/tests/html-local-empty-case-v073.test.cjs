'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

function section(start, end) {
  const a = html.indexOf(start);
  assert.ok(a >= 0, `Startanker fehlt: ${start}`);
  const b = html.indexOf(end, a);
  assert.ok(b > a, `Endanker fehlt: ${end}`);
  return html.slice(a, b);
}

test('0.7.5 bietet einen echten leeren lokalen Fall mit stabiler ID an', () => {
  assert.match(html, /const APP_VERSION='0\.7\.5'/);
  assert.match(html, /id="startCreateEmptyCaseBtn"/);
  assert.match(html, /localCaseId:uuid\(\)/);
  assert.match(html, /globalThis\.crypto\?\.randomUUID/);
  const registry = section('<script id="case-registry-v161">', '</script>');
  assert.match(registry, /if\(s\?\.ui\?\.localCaseId\)return String\(s\.ui\.localCaseId\)/);
  assert.match(registry, /state\.ui\.localCaseId=/);
});

test('eine neue lokale Installation startet ohne eingebettetes Bürologo', () => {
  assert.match(html, /<div class="brand brand-source-hidden" id="workspaceBrandSource"><\/div>/);
  assert.doesNotMatch(html, /<div class="brand brand-source-hidden" id="workspaceBrandSource"><img/);
  const branding = section('async function applyOfficeBranding(profile){', "window.addEventListener('officeProfileReady'");
  assert.match(branding, /if\(profile\.logoUrl\)\{/);
  assert.match(branding, /sourceHost\.replaceChildren\(logo\)/);
  assert.match(branding, /sourceHost\.replaceChildren\(\)/);
  assert.match(branding, /hero\.replaceChildren\(\)/);
});

test('Branding erzeugt ein Profil-Logo dynamisch und kehrt ohne Logo zum neutralen Zustand zurück', async () => {
  const source = section('async function applyOfficeBranding(profile){', "window.addEventListener('officeProfileReady'");
  const makeHost = () => ({
    children: [],
    replaceChildren(...children) { this.children = children; }
  });
  const sourceHost = makeHost();
  const hero = makeHost();
  const heroTitle = {textContent: ''};
  const document = {
    getElementById: id => id === 'workspaceBrandSource' ? sourceHost : id === 'heroLogo' ? hero : null,
    querySelector: selector => selector === '.hero-copy h1' ? heroTitle : null,
    createElement: () => ({
      src: '', alt: '',
      cloneNode() { return {src: this.src, alt: this.alt, cloneNode: this.cloneNode}; }
    })
  };
  const context = {
    window: {__officeProfile: {fetchBankAccounts: async () => []}},
    document,
    OFFICE: {},
    console
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nwindow.__testApplyOfficeBranding=applyOfficeBranding;`, context);
  await context.window.__testApplyOfficeBranding({companyName: 'Testbüro', logoUrl: 'data:image/png;base64,AAAA'});
  assert.equal(sourceHost.children.length, 1);
  assert.equal(hero.children.length, 1);
  assert.equal(sourceHost.children[0].src, 'data:image/png;base64,AAAA');
  assert.equal(heroTitle.textContent, 'Testbüro - Betreuungssoftware');
  await context.window.__testApplyOfficeBranding({companyName: '', logoUrl: ''});
  assert.equal(sourceHost.children.length, 0);
  assert.equal(hero.children.length, 0);
  assert.equal(heroTitle.textContent, 'Betreuungsbüro - Betreuungssoftware');
});

test('Bürostammdaten sind lokal editierbar und das optionale Logo wird verlustfrei restauriert', () => {
  const shortcut = section('<script id="office-profile-shortcut-script-v1">', '</script>');
  assert.match(shortcut, /window\.isBueroLocalMode&&window\.isBueroLocalMode\(\)/);
  const settings = section('const EIN_EINBETT={', 'const EIN_STATUS={');
  assert.match(settings, /!\(local\|\|u\.isAdmin\|\|u\.canManageOfficeProfile\)/);
  const restore = section('async importBueroJsonText(text){', '// Moduldaten zurueckspielen');
  assert.match(restore, /data\.officeProfile&&typeof data\.officeProfile==='object'/);
  assert.match(restore, /L\.officeProfile=\{\.\.\.\(L\.officeProfile\|\|\{\}\),\.\.\.data\.officeProfile\}/);
  assert.match(restore, /__officeProfile\?\.refreshCache/);
});

test('lokales Büroprofil speichert Felder und entfernt ein gelöschtes Logo sofort', async () => {
  const script = section('<script id="office-profile-script-v1">', '</script>')
    .replace(/^<script[^>]*>/, '');
  let saves = 0;
  const events = [];
  const context = {
    window: {
      isBueroLocalMode: () => true,
      bueroLocal: {officeProfile: {}, officeBankAccounts: [], officeEmployees: []},
      saveBueroLocal: () => { saves++; },
      addEventListener: (name, fn) => events.push({name, fn}),
      dispatchEvent: () => {}
    },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    fetch: async () => { throw new Error('Im Lokalmodus darf kein Serverzugriff erfolgen'); },
    FileReader: class FileReader {},
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    Uint8Array,
    console
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  const saved = await context.window.__officeProfile.saveProfile({companyName: 'Testbüro', city: 'Bonn'});
  assert.equal(saved.ok, true);
  assert.equal(context.window.bueroLocal.officeProfile.companyName, 'Testbüro');
  assert.equal(context.window.bueroLocal.officeProfile.city, 'Bonn');
  context.window.bueroLocal.officeProfile.logoDataUrl = 'data:image/png;base64,AAAA';
  const removed = await context.window.__officeProfile.deleteLogo();
  assert.equal(removed.ok, true);
  assert.equal(context.window.bueroLocal.officeProfile.logoDataUrl, '');
  assert.ok(saves >= 2);
  assert.ok(events.some(event => event.name === 'appLoginReady'));
});

test('lokale Büroorganisation verwendet die eingebettete Vorlage ohne Serverzugriff', async () => {
  const source = section('async function boLoadTemplateBytes(){', 'async function boBuildWorkbook');
  let fetchCalls = 0;
  const context = {
    window: {
      isBueroLocalMode: () => true,
      __curatedTemplateBytes: kind => {
        assert.equal(kind, 'bueroorganisation');
        return new Uint8Array([11, 22, 33, 44]);
      }
    },
    fetch: async () => {
      fetchCalls++;
      throw new Error('file:// darf keinen Server-Endpunkt anfragen');
    }
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nwindow.__testBoLoadTemplateBytes=boLoadTemplateBytes;`, context);
  const result = await context.window.__testBoLoadTemplateBytes();
  assert.deepEqual([...new Uint8Array(result)], [11, 22, 33, 44]);
  assert.equal(fetchCalls, 0);
  assert.match(html, /const buf=await boLoadTemplateBytes\(\)/);
  assert.doesNotMatch(source, /__curatedTemplateBytesAsync/,
    'Der Vorlagenzugriff darf nicht rekursiv erneut eine Büroorganisationsmappe bauen');
});

test('integrierte Arbeitsmappen werden angelegt und nach einem Neustart wiederhergestellt', () => {
  assert.match(html, /window\.__ensureLocalWorkbookArchives073=async function/);
  assert.match(html, /__curatedTemplateBytesAsync\?\.\(kind\)/);
  assert.match(html, /templateBook\('stammdaten',MASTER_NAME\)/);
  assert.match(html, /templateBook\('adressverzeichnis',ADDRESS_NAME\)/);
  assert.match(html, /masterOrigin:'embedded',addressOrigin:'embedded'/);
  assert.match(html, /restoreEmbeddedArchives/);
});

test('lokale Einzel- und Gesamtsicherung erzwingen den vollständigen Pflichtbestand', () => {
  const single = section('  async function collectSingleCaseBackupEntries(){', '  window.__collectSingleCaseBackupEntries=collectSingleCaseBackupEntries;');
  assert.match(single, /__ensureLocalWorkbookArchives073\(\{forBackup:true\}\)/);
  assert.match(single, /Fall-JSON, Stammdaten\.xlsx und Adressverzeichnis\.xlsx müssen enthalten sein/);

  const all = section('  window.downloadAllCasesZip=async function(){', '\n\n  \/* ===== Sammel-Indikator:');
  assert.match(all, /localRequiredCounts=\{json:0,master:0,address:0\}/);
  assert.match(all, /Betreuungsorganisation\.json/);
  assert.match(all, /Betreuungsorganisation\.xlsx/);
  assert.match(all, /Lokaler Arbeitsdatenexport abgebrochen: Pflichtbestand fehlt/);
});

test('Ordner- und ZIP-Import bevorzugen die verlustfreie Büroorganisations-JSON', () => {
  const folder = section('async function handleFolderFiles(files){', 'async function importBackupZip(file){');
  assert.match(folder, /const bueroJsonFile=/);
  assert.match(folder, /__dataAdmin\?\.importBueroJsonText/);
  assert.match(folder, /f!==bueroJsonFile/);

  const zip = section('async function importBackupZip(file){', 'async function importMultiCaseBackupZip');
  assert.match(zip, /rootBoJsonName/);
  assert.match(zip, /__dataAdmin\?\.importBueroJsonText/);
  assert.match(zip, /bueroImportedRoot\?\[\]:rootXlsxNames/);
});
