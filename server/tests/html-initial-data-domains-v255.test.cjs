'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { PERMISSION_DEFS } = require('../src/middleware/authorization');

const html = fs.readFileSync(path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

function script(id) {
  const match = html.match(new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i'));
  assert(match, `Script ${id} fehlt.`);
  return match[1];
}

const state = {
  caseData: {
    person: { firstName: 'Franz', lastName: 'Beispiel', street: 'Musterstraße', house: '12', postal: '12345', city: 'Musterstadt' },
    care: { fileNumber: '10 XVII 1/26', startDate: '2026-01-01' },
    accommodation: {}, socialNetwork: [], documentationEntries: [], benefits: [], livelihood: { income: [] }, budget: {},
    goalDecisionPlanning: { version: 2, records: [], reportSelections: [] }
  },
  reports: { initial: { fields: {}, meta: { periodTo: '2026-12-31' } } }
};

const documentMock = {
  readyState: 'loading', documentElement: {},
  addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, getElementById() { return null; }
};
const context = {
  console, state, document: documentMock, CustomEvent: class CustomEvent {},
  MutationObserver: class MutationObserver { observe() {} },
  requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
  SOURCE_LABELS: {}, SOURCE_TITLES: {}, currentReport: '',
  norm(value) { return String(value == null ? '' : value).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); },
  clone(value) { return JSON.parse(JSON.stringify(value)); },
  isEmpty(value) { return value == null || value === '' || (Array.isArray(value) && !value.length); },
  ensureState() {}, saveState() {}, renderReport() {}, closeModal() {}, toast() {},
  caseIdentityOf() { return 'case-1'; },
  extractMaster() {},
  setReportValue(reportId, fieldId, value, source, reviewed, _one, cleared) {
    state.reports[reportId].fields[fieldId] = { value, source, reviewed, cleared: Boolean(cleared && value === '') };
  }
};
context.window = context;
context.window.__activeServerCaseId = 'case-1';
context.window.__appState = () => state;
context.window.addEventListener = () => {};
context.window.__kmDocData = async () => ({ ersterKontaktDatum: '2026-02-03', anzahlImZeitraum: 4, turnusTage: 60 });
vm.createContext(context);

new vm.Script(script('contact-social-documentation-script-v255'), { filename: 'contact-v255.js' }).runInContext(context);
new vm.Script(script('initial-data-domains-script-v255'), { filename: 'housing-v255.js' }).runInContext(context);
new vm.Script(script('functional-planning-profile-script-v255'), { filename: 'planning-v255.js' }).runInContext(context);

assert.equal(typeof context.openHousingModal, 'function');
assert.equal(typeof context.openContactProfileV255, 'function');
assert.equal(typeof context.openFunctionalProfileV255, 'function');
assert.equal(context.SOURCE_LABELS.housing, 'W');
assert.equal(context.SOURCE_LABELS.planningProfile, 'FP');
assert.equal(PERMISSION_DEFS.menuCaseFileHousing.default, true, 'Das Wohnmenü muss für Bestandsnutzer standardmäßig sichtbar bleiben.');

const cd = state.caseData;
context.__housingV255.ensureModels(cd);
Object.assign(cd.accommodation, { monthlyCost: '500', basicRent: '500', serviceCosts: '100', gasCosts: '50', heatingCosts: '50', heating: 'Gas', heatingType: 'Gas', totalHousingCost: 650 });
let housingPrior = JSON.parse(JSON.stringify(cd.accommodation));
cd.accommodation.monthlyCost = '525';
context.__housingV255.syncAccommodationCompatibility(cd, housingPrior, 'monthlyCost');
assert.equal(cd.accommodation.basicRent, '525', 'Ein bislang identischer Kompatibilitätswert muss bei einer Stammdatenänderung mitgeführt werden.');
assert.equal(cd.accommodation.totalHousingCost, 675, 'Ein bislang automatisch berechneter Gesamtwert muss konsistent aktualisiert werden.');
cd.accommodation.basicRent = '410';
housingPrior = JSON.parse(JSON.stringify(cd.accommodation));
cd.accommodation.monthlyCost = '600';
context.__housingV255.syncAccommodationCompatibility(cd, housingPrior, 'monthlyCost');
assert.equal(cd.accommodation.basicRent, '410', 'Eine bewusst abweichende Grundmiete darf nicht von Miete/Unterbringung überschrieben werden.');
cd.accommodation.heatingType = 'Ölheizung';
housingPrior = JSON.parse(JSON.stringify(cd.accommodation));
cd.accommodation.heating = 'Fernwärme';
context.__housingV255.syncAccommodationCompatibility(cd, housingPrior, 'heating');
assert.equal(cd.accommodation.heatingType, 'Ölheizung', 'Eine bewusst abweichende Heizungsart darf nicht überschrieben werden.');
Object.assign(cd.accommodation.currentResidence, { institution: 'Wohnheim Sonnengarten', street: 'Parkweg', houseNumber: '4', postalCode: '12345', city: 'Musterstadt', type: 'Heim/Einrichtung' });
cd.accommodation.housingSecurity = { status: 'secured', details: 'unbefristeter Vertrag' };
cd.accommodation.accessibility = { status: 'partial', details: 'Aufzug vorhanden' };
cd.accommodation.currentProblems = { status: 'present', details: 'Bad noch nicht angepasst' };
cd.accommodation.supportForms = ['facility', 'nursing'];
cd.accommodation.housingSecurityEntries = [{ id: 'security-test', entryDate: '2026-01-01', endDate: '', status: 'secured', details: 'unbefristeter Vertrag', createdAt: '', updatedAt: '' }];
cd.accommodation.accessibilityEntries = [{ id: 'accessibility-test', entryDate: '2026-01-01', endDate: '', status: 'partial', details: 'Aufzug vorhanden', createdAt: '', updatedAt: '' }];
cd.accommodation.currentProblemEntries = [{ id: 'problem-test', entryDate: '2026-01-01', endDate: '', status: 'present', details: 'Bad noch nicht angepasst', createdAt: '', updatedAt: '' }];
cd.accommodation.supportEntries = [{ id: 'support-test', entryDate: '2026-01-01', endDate: '', status: 'active', forms: ['facility', 'nursing'], details: '', createdAt: '', updatedAt: '' }];
context.__housingV255.sync({ save: false });
assert.equal(state.reports.initial.fields.registered_address.value, 'Musterstraße 12, 12345 Musterstadt');
assert.equal(state.reports.initial.fields.current_residence.value, 'Wohnheim Sonnengarten, Parkweg 4, 12345 Musterstadt');
assert.equal(state.reports.initial.fields.residence_type.value, 'Heim/Einrichtung');
assert.match(state.reports.initial.fields.housing_notes.value, /Wohnsicherheit: gesichert/);
assert.match(state.reports.initial.fields.housing_notes.value, /Pflegedienst/);

state.reports.initial.fields.housing_notes = { value: 'Manuell geprüfter Wohnhinweis', source: 'manual', reviewed: true };
cd.accommodation.currentProblemEntries[0].details = 'anderer Quellwert';
context.__housingV255.sync({ save: false });
assert.equal(state.reports.initial.fields.housing_notes.value, 'Manuell geprüfter Wohnhinweis', 'Manuelle Berichtswerte dürfen nicht überschrieben werden.');

cd.socialNetwork = [{
  status: 'Aktiv', contactClass: 'family', role: 'Schwester', firstName: 'Anna', lastName: 'Beispiel',
  street: 'Nebenweg', house: '3', postal: '12345', city: 'Musterstadt', contactFrequency: 'wöchentlich',
  sameHousehold: 'no', relationshipQuality: 'gut', supportTypes: ['emotional'], conflictStatus: 'none',
  reportRelevant: true, reportNotes: 'Die Schwester ist eine verlässliche Bezugsperson.'
}];
cd.documentationEntries = [{ date: '2026-04-01', reportRelevant: true, topicCodes: ['social_situation'], reportTargets: [], reportSummary: 'Das soziale Umfeld hat sich stabilisiert.' }];
context.__syncInitialSocialFieldsV255({ save: false });
assert.match(state.reports.initial.fields.family_situation.value, /Kontakt wöchentlich/);
assert.match(state.reports.initial.fields.family_situation.value, /kein gemeinsamer Haushalt/);
assert.match(state.reports.initial.fields.social_notes.value, /soziale Umfeld hat sich stabilisiert/);

const fp = cd.goalDecisionPlanning.functionalProfile;
fp.assessments = [{ domain: 'communication', resources: 'Kann Anliegen klar benennen.', impairments: 'Benötigt bei komplexen Schreiben Unterstützung.', active: true, includeInReports: true }];
fp.dailyLife = { summary: 'Der Tagesablauf ist regelmäßig strukturiert.', household: 'Mit Unterstützung.', includeInReports: true };
fp.wishExpression = { status: 'bedingt', reason: 'Komplexe Fragen überfordern.', support: 'Einfache Sprache.', includeInReports: true };
cd.goalDecisionPlanning.records = [{ id: 'goal-1', type: 'goal', reportNote: 'Die Wohnperspektive ist vorrangig.' }];
cd.goalDecisionPlanning.reportSelections = ['goal-1'];
cd.budget = { type: 'Wochengeld', amount: 50, method: 'Barauszahlung' };
context.__syncInitialPlanningProfileV255({ save: false });
assert.match(state.reports.initial.fields.resources.value, /Kann Anliegen klar benennen/);
assert.match(state.reports.initial.fields.impairments.value, /komplexen Schreiben/);
assert.match(state.reports.initial.fields.daily_life.value, /regelmäßig strukturiert/);
assert.equal(state.reports.initial.fields.can_express_wishes.value, 'bedingt');
assert.equal(state.reports.initial.fields.goal_notes.value, 'Die Wohnperspektive ist vorrangig.');
assert.match(state.reports.initial.fields.self_managed_assets.value, /Wochengeld/);

cd.contactProfile = {
  understanding: 'with_support', trust: 'good', cooperation: 'cooperative', participation: 'active', conflicts: 'none',
  canInitiateContact: 'bedingt', initiationLimitationReason: 'Telefonate gelingen nicht zuverlässig', initiationSupport: 'Einrichtung unterstützt',
  reportRemarks: 'Absprachen erfolgen bevorzugt persönlich.'
};
(async()=>{
await context.__syncInitialContactFieldsV255({ save: false, render: false });
assert.match(state.reports.initial.fields.relationship.value, /Verständigung: mit Unterstützung möglich/);
assert.equal(state.reports.initial.fields.can_initiate_contact.value, 'bedingt');
assert.match(state.reports.initial.fields.contact_limit_reason.value, /Telefonate gelingen nicht zuverlässig/);
assert.equal(state.reports.initial.fields.first_contact.value, '2026-02-03');
assert.equal(state.reports.initial.fields.contact_count.value, 4);
assert.equal(state.reports.initial.fields.future_contacts.value, 'alle zwei Monate');
assert.doesNotMatch(state.reports.initial.fields.contact_notes.value, /soziale Umfeld/, 'Sozialnotizen dürfen bei automatischer Themenzuordnung nicht in Kontaktbemerkungen landen.');

cd.benefits = [{ benefit: 'Pflegegeld', status: 'bewilligt' }];
context.__syncInitialBenefitFieldsV255({ save: false });
assert.equal(state.reports.initial.fields.care_allowance.value, 'bewilligt');

assert.match(html, /base\.__kind==='functionalProfile'/, 'Profil-Rückimport fehlt.');
assert.match(html, /values\[35\]=gdpJson\(fpPayload\)/, 'Profil-ODS-Sicherung fehlt.');
assert.match(html, /profileRow\[35\]=stammdatenExportJson\(\{__kind:'functionalProfile'/, 'Profil fehlt in der kanonischen Stammdaten-Sicherung.');
assert.match(html, /eventKind:'contact'/, 'Strukturierte Kontaktklassifikation fehlt.');
assert.match(html, /id="dokuReportRelevantV255"/, 'Explizite Berichtsfreigabe in der Dokumentation fehlt.');
assert.match(html, /const ENTRY_TYPES=\['wish','goal','need','measure','decision','review'\]/, 'Maßnahmen müssen als eigener Planungstyp erfasst werden können.');
assert.match(html, /measures:initialPlanningComposeV254\(current\.filter\(record=>type\(record,'measure'\)\)\)/, 'Bedarfe dürfen nicht länger als Maßnahmen in den Anfangsbericht geschrieben werden.');
assert.match(html, /class="housing-shell-v255"/, 'Das Wohnen-Modul muss den gleichen Vollbild-Shell-Aufbau wie Bedarfe & Wille verwenden.');
assert.match(html, /housing-header-v255[\s\S]*housing-main-v255[\s\S]*housing-footer-v255/, 'Kopf, Scrollbereich und feste Aktionen des Wohnen-Moduls fehlen.');
assert.doesNotMatch(html, /Die Meldeadresse und der tatsächliche Aufenthaltsort werden getrennt geführt\./, 'Der entfernte Erklärtext darf nicht mehr erscheinen.');
['hvRegHouse','hvRegLetter','hvRegPostal','hvRegCity','hvRegCountry','hvHouse','hvLetter','hvPostal','hvCity','hvCountry'].forEach(id=>{
  assert.match(html, new RegExp(`fieldV255\\('${id}'[\\s\\S]{0,160}combo:`), `Combobox-Anbindung für ${id} fehlt.`);
});
['hvAccommodationType','hvMonthlyCost','hvServiceCosts','hvElectricityCosts','hvGasCosts','hvHeating','hvHotWater'].forEach(id=>{
  assert.match(html, new RegExp(`fieldV255\\('${id}'`), `Wohnkostenfeld ${id} fehlt im Wohnen-Modul.`);
});
assert.match(html, /__housingPickRegisteredV255/, 'Adressbuchübernahme für die Meldeadresse fehlt.');
assert.match(html, /__housingPickCurrentV255/, 'Adressbuchübernahme für den momentanen Aufenthalt fehlt.');
assert.match(html, /#modal:has\(\.housing-shell-v255\) \.modal-box\{width:min\(1760px,calc\(100vw - 32px\)\);height:min\(1010px,calc\(100vh - 32px\)\)/, 'Das Wohnen-Modal hat nicht die GDP-Vollbildgeometrie.');
const groupBlock = html.slice(html.indexOf('const GROUPS=['), html.indexOf('];', html.indexOf('const GROUPS=[')) + 2);
assert(groupBlock.indexOf('data-health-menu') < groupBlock.indexOf('data-housing-menu') && groupBlock.indexOf('data-housing-menu') < groupBlock.indexOf('data-goal-planning-menu'), 'Wohnen muss zwischen Gesundheit und Bedarfe & Wille stehen.');
assert.match(html, /\[data-group-body="fallakte"\] > \[data-goal-planning-menu\]\[data-goal-planning-ready\]/, 'Bedarfe & Wille darf bei einem verspäteten oder ausgeblendeten Wohnen-Modul nicht verborgen werden.');
assert.match(html, /\.housing-shell-v255 \.v255-field textarea\{height:82px;min-height:72px;max-height:220px\}/, 'Wohn-Textfelder dürfen nicht die generische Modalhöhe von 420 px erben.');

console.log('Anfangsbericht-Datenquellen v255: Wohnen, Soziales, Fähigkeiten/Alltag, Kontaktprofil, Kontakte und Pflegegeld geprüft.');
})().catch(error=>{console.error(error);process.exitCode=1});
