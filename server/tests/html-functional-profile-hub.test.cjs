'use strict';
/* „Fähigkeiten & Alltag“ als eigenständiges Modul (Nutzerwunsch 14.08.2026):
   eigener Sidebar-Eintrag ÜBER „Bedarfe & Wille“, Übersichts-Hub im Wünsche-Stil
   (Kennzahlen + Bereichskarten), bestehendes Formular bleibt der Editor, der
   alte Kopf-Button im Wünsche-Modul ist herausgelöst. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

test('der Hub existiert und das Formular bleibt als Editor erhalten', () => {
  assert.match(html, /window\.openFunctionalProfileHubV255=function\(\)/);
  assert.match(html, /window\.closeFunctionalProfileHubV255=function\(\)/);
  assert.match(html, /window\.__fpHubEditV255=function\(bereich\)/);
  assert.match(html, /functionalProfileHubOverlayV255/);
  assert.match(html, /window\.openFunctionalProfileV255=function\(\)/);
});

test('der Sidebar-Eintrag hängt über Bedarfe & Wille und ist per GROUPS verankert', () => {
  assert.match(html, /data-functional-profile-menu/);
  assert.match(html, /Fähigkeiten &amp; Alltag<\/span>/);
  const gruppen = html.indexOf("hasAttribute?.('data-functional-profile-menu'), optional:true");
  const gdp = html.indexOf("hasAttribute?.('data-goal-planning-menu'), optional:true");
  assert.ok(gruppen > 0 && gdp > 0 && gruppen < gdp, 'GROUPS-Reihenfolge: Fähigkeiten muss VOR Bedarfe & Wille stehen');
  assert.match(html, /\[data-functional-profile-menu\]\{display:none!important\}/);
  assert.match(html, /button\.insertAdjacentElement\('beforebegin',fpButton\)/);
});

test('der alte Kopf-Button im Wünsche-Modul ist herausgelöst', () => {
  assert.ok(!/gdp-btn ghost" type="button" onclick="window\.openFunctionalProfileV255\(\)"/.test(html),
    'der Fähigkeiten-Button darf nicht mehr im Wünsche-Kopf hängen');
});

test('Bearbeiten geschieht in EINER Ebene direkt in der Karte (Inline-Editor)', () => {
  // Nutzer-Livetest 14.08.2026, Runde 2: kein Sprung mehr ins Gesamtformular —
  // das hing in der versteckbaren .gdp-shell und öffnete sich nur einmal.
  assert.match(html, /let fpHubEditSet=new Set\(\)/);
  assert.match(html, /window\.__fpHubSaveV255=function\(bereich\)/);
  assert.match(html, /window\.__fpHubAbbruchV255=function\(bereich\)/);
  assert.match(html, /data-fp-hub-card/);
  assert.ok(!html.includes('fpHubRueckkehrV255'), 'der alte Rückkehr-Wrapper muss ausgebaut sein');
  assert.ok(!/window\.__fpHubEditV255=function\(bereich\)\{\s*window\.closeFunctionalProfileHubV255\(\);\s*window\.openFunctionalProfileV255\(\)/.test(html),
    'Bearbeiten darf nicht mehr das Gesamtformular öffnen');
  // GUI: Scrollkörper mit Innenabstand bleibt erhalten
  assert.match(html, /flex:1 1 auto;min-height:0;overflow:auto;padding:14px 18px 18px/);
});

test('die Brücken zum Planungsmodul stehen (Badge, Bedarf ableiten, Herkunfts-Chip)', () => {
  assert.match(html, /window\.__fpHubZeigeBedarfeV255=function/);
  assert.match(html, /window\.__fpHubBedarfAbleitenV255=function/);
  assert.match(html, /window\.__fpHubSprungV255=function/);
  assert.match(html, /window\.__fpHerkunftV255=function/);
  assert.match(html, /__goalDecisionPlanningBridge\?\.applyChange\?\./);
  assert.match(html, /aus: \$\{e\(herkunft\.label\)\}/); // Chip in der Planungsliste
  assert.match(html, /openGoalDecisionPlanning\(ids\[0\]\)/); // Badge öffnet vorgewählt
});

test('Wiedervorlagen je Bereich sind erfasst und in „Prüfungen & Wiedervorlagen" eingespeist', () => {
  // Nutzerwunsch 14.08.2026 nachmittags: jedes Element bekommt ein Wiedervorlage-Datum,
  // Erinnerung läuft über den Prüfungen-Kasten des Planungsmoduls.
  assert.match(html, /fpHubReview_\$\{key\}/);
  assert.match(html, /reviewDate:fpHubWert\(`fpHubReview_\$\{bereich\}`\)/);
  assert.match(html, /reviewDate:fpHubWert\('fpHubDailyReview'\)/);
  assert.match(html, /reviewDate:fpHubWert\('fpHubWishReview'\)/);
  assert.match(html, /window\.__fpPrueftermineV255=function/);
  assert.match(html, /fpHubFaellig\(x\.reviewDate\)/); // Kennzahl „Prüfungen fällig"
  assert.match(html, /const fpPruef=typeof window\.__fpPrueftermineV255==='function'/);
  assert.match(html, /\$\{due\.length\+fpPruef\.length\}/);
  assert.match(html, /Fähigkeiten &amp; Alltag<\/div><\/div>`\)\.join\(''\)\+due\.map/);
  // Einheitliche Feldhöhen: Eingaben 36px, Textfelder 84px, alles inline verankert
  assert.match(html, /const FP_IN=FP_BASIS\+';height:36px'/);
  assert.match(html, /const FP_TA=FP_BASIS\+';height:84px/);
  // Dark-Mode (15.08., Runde 2): das Menü ist im Dunkelthema DUNKEL. Alle Hub-Farben
  // laufen über --fph-Variablen; der Style-Block liefert helle UND dunkle Werte.
  assert.match(html, /<style id="functional-profile-dark-style-v255">/);
  assert.match(html, /html\[data-theme="dark"\] #functionalProfileHubOverlayV255\{/);
  assert.match(html, /--fph-feld-bg:#101c25/); // dunkle Feldfarbe entspricht dem App-Dunkelthema
  assert.match(html, /const FP_BASIS='[^']*background:var\(--fph-feld-bg\) !important[^']*color-scheme:var\(--fph-schema\)'/);
  assert.match(html, /accent-color:var\(--fph-akzent\) !important;flex:none;color-scheme:var\(--fph-schema\)/);
  assert.match(html, /font-size:12px;padding:5px 10px;background:var\(--fph-btnl-bg\) !important/);
  assert.match(html, /font-size:12\.5px;padding:6px 12px;background:var\(--fph-btn-bg\) !important/);
  assert.match(html, /style="background:var\(--fph-btn2-bg\) !important;color:#fff !important;border:0 !important" onclick="window\.closeFunctionalProfileHubV255\(\)"/);
  // und im Hub-Markup darf keine der alten festen Hell-Farben mehr stehen:
  const hubBlock = html.match(/<script id="functional-planning-profile-script-v255">[\s\S]*?<\/script>/)[0];
  assert.ok(!hubBlock.includes("background:#fff;border:1px solid #d8e2ea"), 'Karten müssen die Flächen-Variable nutzen');
});

test('die Fallübersicht kennt Fähigkeiten-Vorgänge und Profil-Wiedervorlagen', () => {
  // Nutzerwunsch 14.08.2026 abends: die neuen Daten erscheinen als Vorgänge (Chip
  // „Fähigkeiten") und die Wiedervorlage-Termine als echte follow-Einträge im
  // Wiedervorlagen-Kasten der Fallübersicht.
  assert.match(html, /function abilityItems\(data,ctx\)/);
  assert.match(html, /contextualize\(abilityItems\(data,ctx\),ctx\)/);
  assert.match(html, /\['ability','Fähigkeiten','badge'\]/);
  assert.match(html, /ability:'Fähigkeiten & Alltag'/);
  assert.match(html, /it\.source\|\|kindLabel\(it\.kind\)/);
  // GUI-Feinheit 14.08.: „Filter zurücksetzen" unter den Chips mit Abstand nach oben
  assert.match(html, /cov-mobile-filter-reset" type="button" style="margin-top:16px"/);

  // Laufzeit-Smoke: der Sammler liefert je Bereich einen Vorgang und je
  // Wiedervorlage-Datum einen follow-Eintrag.
  const quelle = html.match(/function abilityItems\(data,ctx\)\{[\s\S]*?\n  \}\n/)[0];
  const vm = require('node:vm');
  const ctx = {
    window: { __housingV255: { domainLabels: { communication: 'Kommunikation und Verständigung' } } },
    text: v => String(v == null ? '' : v).trim(),
    arr: v => Array.isArray(v) ? v : [],
    a: v => String(v == null ? '' : v),
    deDate: v => String(v || ''),
    makeItem: (kind, date, title, opts) => ({ kind, date, title, ...(opts || {}) })
  };
  vm.createContext(ctx);
  vm.runInContext(quelle + ';this.__ergebnis=abilityItems({goalDecisionPlanning:{functionalProfile:{assessments:[{domain:"communication",resources:"telefoniert selbständig",impairments:"",source:"Hausbesuch",assessedAt:"2026-07-02",reviewDate:"2026-09-01",active:true,includeInReports:true}],dailyLife:{},wishExpression:{}}}},{id:"case-1"});', ctx);
  const items = ctx.__ergebnis;
  assert.equal(items.length, 2, 'ein Vorgang + ein follow-Eintrag erwartet');
  assert.ok(items.some(i => i.kind === 'ability' && i.title.includes('Kommunikation') && i.body.includes('telefoniert')), 'Fähigkeiten-Vorgang fehlt');
  const follow = items.find(i => i.kind === 'follow');
  assert.ok(follow && follow.date === '2026-09-01' && follow.source === 'Fähigkeiten & Alltag' && follow.action.includes("__fpHubSprungV255"), 'Wiedervorlage-Eintrag fehlt oder unvollständig');
});

test('einheitliche Glocke, Schnellaktionen Fähigkeiten/Wohnen, Wohnen speist die Übersicht', () => {
  // Nutzerentscheid 15.08.2026: die Glocke öffnet für ALLE Eintragsarten dasselbe
  // Wiedervorlage-Menü (kein Sonderweg für Fähigkeiten mehr), und die Schnellaktionen
  // erhalten „Fähigkeiten" und „Wohnen". Außerdem: Wohnen-Daten in der Fallübersicht.
  assert.ok(!html.includes('__fpHubWiedervorlageV255'), 'der Sonderweg-Helfer muss ausgebaut sein');
  assert.ok(!/it\.kind==='ability'\s*\n?\s*\?`<button/.test(html), 'die Glocke darf keinen ability-Sonderzweig mehr haben');
  assert.match(html, /quickRun\('abilityOpen'\)"[^>]*>\$\{icon\('badge'\)\} Fähigkeiten<\/button>/);
  assert.match(html, /quickRun\('housingOpen'\)"[^>]*>\$\{icon\('landmark'\)\} Wohnen<\/button>/);
  assert.match(html, /if\(action==='abilityOpen'\)return quickFaehigkeiten\(\);/);
  assert.match(html, /if\(action==='housingOpen'\)return quickWohnen\(\);/);
  assert.match(html, /async function quickFaehigkeiten\(\)/);
  assert.match(html, /async function quickWohnen\(\)/);
  assert.match(html, /function wohnenItems\(data,ctx\)/);
  assert.match(html, /contextualize\(wohnenItems\(data,ctx\),ctx\)/);
  assert.match(html, /\['wohnen','Wohnen','landmark'\]/);
  assert.match(html, /wohnen:'Wohnsituation'/);

  // Laufzeit-Smoke des Wohnen-Sammlers
  const quelle = html.match(/function wohnenItems\(data,ctx\)\{[\s\S]*?\n  \}\n/)[0];
  const vm = require('node:vm');
  const ctx = {
    window: {},
    text: v => String(v == null ? '' : v).trim(),
    arr: v => Array.isArray(v) ? v : [],
    a: v => String(v == null ? '' : v),
    deDate: v => String(v || ''),
    makeItem: (kind, date, title, opts) => ({ kind, date, title, ...(opts || {}) })
  };
  vm.createContext(ctx);
  vm.runInContext(quelle + ';this.__ergebnis=wohnenItems({accommodation:{housingSecurityEntries:[{id:"h1",entryDate:"2026-06-01",status:"at_risk",details:"Kündigung droht"}],supportEntries:[{id:"s1",entryDate:"2026-07-01",status:"active",forms:["Ambulanter Dienst"],details:""}]}},{id:"case-1"});', ctx);
  const items = ctx.__ergebnis;
  assert.equal(items.length, 2, 'zwei Wohnen-Vorgänge erwartet');
  assert.ok(items.some(i => i.kind === 'wohnen' && i.title.includes('Wohnsicherheit') && i.body.includes('gefährdet') && i.body.includes('Kündigung droht')), 'Wohnsicherheits-Vorgang fehlt');
  assert.ok(items.some(i => i.title.includes('Unterstützungsformen') && i.body.includes('Ambulanter Dienst')), 'Unterstützungs-Vorgang fehlt');
});

test('der Hub rendert Kennzahlen und Bereichskarten aus echten Profildaten (Laufzeit)', () => {
  const script = id => {
    const match = html.match(new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i'));
    assert.ok(match, `Script ${id} fehlt`);
    return match[1];
  };
  const state = { caseData: {
    person: {}, care: {}, accommodation: {}, socialNetwork: [], documentationEntries: [], benefits: [],
    livelihood: { income: [] }, budget: {},
    goalDecisionPlanning: { version: 3, records: [{ id: 'n1', type: 'need', title: 'Testbedarf', status: 'offen' }], reportSelections: [] }
  }, reports: { initial: { fields: {}, meta: {} } } };
  let captured = '';
  const documentMock = { readyState: 'loading', documentElement: {}, addEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; }, getElementById() { return null; },
    body: { insertAdjacentHTML: (_pos, markup) => { captured = markup; } } };
  const context = { console, state, document: documentMock, CustomEvent: class {}, MutationObserver: class { observe() {} },
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {}, SOURCE_LABELS: {}, SOURCE_TITLES: {}, currentReport: '',
    norm: v => String(v == null ? '' : v).trim().toLowerCase(), clone: v => JSON.parse(JSON.stringify(v)),
    isEmpty: v => v == null || v === '' || (Array.isArray(v) && !v.length),
    ensureState() {}, saveState() {}, renderReport() {}, closeModal() {}, toast() {},
    caseIdentityOf() { return 'case-1'; }, extractMaster() {}, setReportValue() {} };
  context.window = context; context.window.__activeServerCaseId = 'case-1'; context.window.__appState = () => state;
  context.window.addEventListener = () => {}; context.window.__kmDocData = async () => ({});
  vm.createContext(context);
  new vm.Script(script('contact-social-documentation-script-v255'), { filename: 'contact.js' }).runInContext(context);
  new vm.Script(script('initial-data-domains-script-v255'), { filename: 'housing.js' }).runInContext(context);
  new vm.Script(script('functional-planning-profile-script-v255'), { filename: 'planning.js' }).runInContext(context);
  assert.equal(typeof context.openFunctionalProfileHubV255, 'function');
  context.openFunctionalProfileHubV255();
  assert.ok(captured.includes('functionalProfileHubOverlayV255'), 'Hub-Overlay fehlt');
  assert.ok(captured.includes('Bereiche erfasst'), 'Kennzahlen-Kachel fehlt');
  assert.ok(captured.includes('Noch nicht erfasst.'), 'Leerzustand der Bereichskarten fehlt');
  assert.ok(captured.includes('Gestaltung der Alltagssituation'), 'Alltagskarte fehlt');
  assert.ok(captured.includes('Wunschäußerung'), 'Wunschäußerungs-Karte fehlt');

  // EINE Ebene: Bearbeiten klappt die Karte in den Inline-Editor um (der Mock kennt
  // kein querySelector-Ziel, also rendert der Hub komplett neu — inklusive Formular).
  context.__fpHubEditV255('communication');
  assert.ok(captured.includes('fpHubRes_communication'), 'Inline-Editorfeld Ressourcen fehlt');
  assert.ok(captured.includes('fpHubImp_communication'), 'Inline-Editorfeld Einschränkungen fehlt');
  assert.ok(captured.includes("window.__fpHubSaveV255('communication')"), 'Speichern-Knopf der Karte fehlt');
  context.__fpHubAbbruchV255('communication');
  assert.ok(!captured.includes('fpHubRes_communication'), 'Abbrechen muss zur Ansicht zurückkehren');

  // Brücke „Bedarf ableiten": legt über die Planungs-Schnittstelle einen Bedarf an
  // und verknüpft ihn mit dem Bereich.
  let bedarfsAuftrag = null;
  context.window.__goalDecisionPlanningBridge = {
    options: () => ({ areas: ['Gesundheit'] }),
    applyChange: (_data, change) => { bedarfsAuftrag = change; return { ok: true, record: { id: 'need-neu', title: change.title } }; }
  };
  context.__fpHubBedarfAbleitenV255('mobility');
  assert.ok(bedarfsAuftrag && bedarfsAuftrag.entryType === 'need', 'applyChange muss einen Bedarf anlegen');
  const angelegt = state.caseData.goalDecisionPlanning.functionalProfile.assessments.find(x => x.domain === 'mobility');
  assert.ok(angelegt && angelegt.linkedNeedIds.includes('need-neu'), 'der neue Bedarf muss mit dem Bereich verknüpft sein');
  assert.equal(context.window.__fpHerkunftV255('need-neu').domain, 'mobility', 'Herkunfts-Auskunft für den Planungs-Chip fehlt');

  // Wiedervorlagen: Profil-Prüftermine werden für das Planungsmodul geliefert.
  state.caseData.goalDecisionPlanning.functionalProfile.assessments.push({
    id: 'aR', domain: 'communication', resources: 'x', impairments: '', linkedNeedIds: [],
    source: '', assessedAt: '', reviewDate: '2026-09-01', active: true, includeInReports: true
  });
  const pruef = context.window.__fpPrueftermineV255();
  assert.ok(pruef.some(p => p.bereich === 'communication' && p.date === '2026-09-01'),
    'Profil-Wiedervorlagen müssen als Prüftermine geliefert werden');

  // Seitenleisten-Indikatoren: Zähler + Tooltips für Fähigkeiten und Wohnen
  // (der eben ergänzte communication-Bereich zählt als 1 von 9).
  const badges = [];
  context.document.querySelectorAll = selector => {
    if (selector === '[data-ability-count]' || selector === '[data-housing-count]') {
      const el = { selector };
      badges.push(el);
      return [el];
    }
    return [];
  };
  state.caseData.accommodation = { housingSecurityEntries: [{ id: 'h1' }], accessibilityEntries: [], currentProblemEntries: [{ id: 'p1' }, { id: 'p2' }], supportEntries: [] };
  context.window.__fpNavIndikatorenV255();
  const abilityBadge = badges.find(b => b.selector === '[data-ability-count]');
  const housingBadge = badges.find(b => b.selector === '[data-housing-count]');
  assert.equal(abilityBadge.textContent, '1', 'Fähigkeiten-Zähler muss erfasste Bereiche zeigen');
  assert.match(abilityBadge.title, /1 von 9 Bereichen erfasst/);
  assert.equal(housingBadge.textContent, '3', 'Wohnen-Zähler muss die vier Listen summieren');
  assert.match(housingBadge.title, /3 Wohn-Einträge: Wohnsicherheit 1, Barrierefreiheit 0, Aktuelle Probleme 2, Unterstützungsformen 0/);
  context.document.querySelectorAll = () => [];
  assert.match(html, /data-ability-count/);
  assert.match(html, /data-housing-count/);
});
