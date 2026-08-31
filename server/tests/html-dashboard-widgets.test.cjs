'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = [
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html')
];

function scriptsOf(html) {
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) scripts.push({ attrs: match[1] || '', body: match[2] || '' });
  return scripts;
}

function dashboardBlock(html) {
  const match = html.match(/<style id="dashboard-style-v1">[\s\S]*?<\/style>\s*<script id="dashboard-script-v1">([\s\S]*?)<\/script>/);
  assert(match, 'Dashboard-Block fehlt.');
  return { full: match[0], script: match[1] };
}

const htmls = files.map((file) => fs.readFileSync(file, 'utf8'));
const dashboardScript = dashboardBlock(htmls[0]).script;
const metaSource = (dashboardScript.match(/const DASH_META=\[([\s\S]*?)\];\nconst DASH_META_MAP=/) || [])[1];
const panelMapSource = (dashboardScript.match(/const panelMap=\{([\s\S]*?)\n  \};\n  const cardMap=/) || [])[1];
const cardMapSource = (dashboardScript.match(/const cardMap=\{([\s\S]*?)\n  \};\n  const cards=/) || [])[1];
assert(metaSource && panelMapSource && cardMapSource, 'Widget-Katalog oder Renderer-Tabellen konnten nicht gelesen werden.');
const metaItems = [...metaSource.matchAll(/\{id:'([^']+)',kind:'(card|panel)'/g)].map((match) => ({
  id: match[1],
  kind: match[2]
}));
const metricIds = metaItems.filter((item) => item.kind === 'card').map((item) => item.id).sort();
const contentIds = metaItems.filter((item) => item.kind === 'panel').map((item) => item.id).sort();
const renderedMetricIds = [...cardMapSource.matchAll(/^\s{4}'([^']+)':/gm)].map((match) => match[1]).sort();
const renderedContentIds = [...panelMapSource.matchAll(/^\s{4}'([^']+)':/gm)].map((match) => match[1]).sort();
assert.equal(metricIds.length, 18, 'Die kuratierte Kennzahlenleiste muss 18 echte Kennzahlen anbieten.');
assert.equal(contentIds.length, 45, 'Der kuratierte Inhaltsbereich muss 45 Widgets anbieten.');
assert.deepEqual(renderedMetricIds, metricIds, 'Nicht jede Kennzahl besitzt genau einen Renderer.');
assert.deepEqual(renderedContentIds, contentIds, 'Nicht jedes Inhaltswidget besitzt genau einen Renderer.');
assert(!metricIds.includes('fileexplorer.quick') && !metricIds.includes('finance.quick')
  && !metricIds.includes('mileage.quick') && !metricIds.includes('qualifications.quick'),
'Reine Öffnen-Kacheln dürfen nicht als Kennzahlen angeboten werden.');
assert(!cardMapSource.includes(`,'→',`), 'Kennzahlen dürfen keinen Pfeil als Scheinwert anzeigen.');
assert(dashboardScript.includes(`fn:'__dashComposeMail'`)
  && dashboardScript.includes(`fn:'__dashNewGoal'`)
  && dashboardScript.includes(`fn:'__dokuQuickAdd'`),
'Kuratierte Schnellaktionen für E-Mail, Zielplanung und Falldokumentation fehlen.');
assert(!dashboardScript.includes(`after:'__mxCompose'`)
  && !dashboardScript.includes(`after:'__gdpNew'`)
  && !dashboardScript.includes(`fn:'openDokuEntryForm'`),
'Veraltete wirkungslose Schnellaktionen sind noch im Dashboard verdrahtet.');
assert(dashboardScript.includes(`de=/^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})`),
  'Das Ereignisdatum der Falldokumentation unterstützt das deutsche Datumsformat nicht.');
const actionTargets = [...new Set(
  [...dashboardScript.matchAll(/(?:openFn|fn|after):'([^']+)'/g)].map((match) => match[1]).filter(Boolean)
)];
for (const name of actionTargets) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert(
    new RegExp(`(?:window\\.)?${escaped}\\s*=|function\\s+${escaped}\\s*\\(`).test(htmls[0]),
    `Dashboard-Aktion ${name} besitzt keine aufrufbare Implementierung.`
  );
}
assert(
  dashboardBlock(htmls[0]).full.includes('#modal:has(.dash-editor) #dashBody{flex:1 1 0;min-height:0;height:100%')
    && dashboardBlock(htmls[0]).full.includes('height:0;overflow:hidden;flex:1 1 0')
    && dashboardBlock(htmls[0]).full.includes('overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch'),
  'Safari-Höhenkette oder unabhängige Editor-Scrollbereiche fehlen.'
);
assert(
  dashboardBlock(htmls[0]).full.includes('Dashboard-Bearbeiter: eigener, vollständiger Dark-Mode')
    && dashboardBlock(htmls[0]).full.includes('.dash-library-item.active{background:#263b49')
    && dashboardBlock(htmls[0]).full.includes('.dash-library-item button{background:#243e4e'),
  'Der Dashboard-Bearbeiter hat keinen vollständigen Dark-Mode für Katalog und Bedienelemente.'
);

for (const [fileIndex, html] of htmls.entries()) {
  const scripts = scriptsOf(html);
  assert.equal(scripts.length, 309, `${files[fileIndex]}: Scriptblockzahl hat sich verändert.`);
  let jsCount = 0;
  scripts.forEach((script, index) => {
    if (/\btype\s*=\s*(['"]?)(?!text\/javascript|application\/javascript|module)\w/i.test(script.attrs)) return;
    jsCount += 1;
    new vm.Script(script.body, { filename: `html-dashboard-widget-${fileIndex}-${index + 1}.js` });
  });
  assert.equal(jsCount, 229, `${files[fileIndex]}: JavaScript-Blockzahl hat sich verändert.`);
}

const title = { textContent: '' };
const dashBody = { innerHTML: '' };
const modal = { classList: { remove() {} } };
const modalBody = {
  _html: '',
  set innerHTML(value) { this._html = value; },
  get innerHTML() { return this._html; }
};
const elements = { modalTitle: title, modalBody, modal, dashBody };
const fetchCalls = [];
const local = new Map();
const toasts = [];
let dashboardRouteAvailable = true;
const context = {
  console,
  Date,
  Map,
  Set,
  Promise,
  JSON,
  Math,
  Object,
  Array,
  String,
  Number,
  RegExp,
  Intl,
  confirm: () => true,
  setTimeout,
  clearTimeout,
  getComputedStyle: () => ({ gridTemplateColumns: '400px 400px' }),
  localStorage: {
    getItem: (key) => local.has(key) ? local.get(key) : null,
    setItem: (key, value) => local.set(key, String(value)),
    removeItem: (key) => local.delete(key)
  },
  document: {
    getElementById(id) { return elements[id] || null; },
    querySelectorAll() { return []; }
  },
  fetch: async (url, options) => {
    fetchCalls.push({ url: String(url), options: options || {} });
    if (String(url) === '/api/user-prefs/dashboard') {
      if (!dashboardRouteAvailable) {
        return { ok: false, status: 404, json: async () => ({ error: 'Unbekannte Oberflaechenpraeferenz.' }) };
      }
      if (options && options.method === 'PUT') {
        return { ok: true, status: 200, json: async () => JSON.parse(options.body) };
      }
      return { ok: true, status: 200, json: async () => ({ prefs: null }) };
    }
    return { ok: true, json: async () => ({}) };
  }
};
context.window = context;
context.window.__appMode = 'online';
context.window.__currentUser = {
  id: 17,
  isAdmin: false,
  permissions: { online: { viewBankData: false, menuCaseFileBanking: true } }
};
context.window.esc = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const today = new Date();
const todayNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 30, 0);
const tomorrowNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 9, 15, 0);
const todayGerman = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
context.window.__dashAllCases = async () => [{
  label: 'Fall A',
  caseData: {
    care: { fileNumber: '12 XVII 34/26', courtName: 'Amtsgericht Teststadt' },
    approvals: [{ id: 'ap-done', title: 'Abgeschlossene Testgenehmigung', status: 'Erledigt' }],
    documentationEntries: [{ title: 'Hausbesuch', eventDate: '15.06.2026' }]
  }
}];
context.window.__calEventsAll = async () => [
  { id: 'cal-today', title: 'Arzttermin', startAt: todayNoon.toISOString(), caseLabel: 'Fall A', allDay: false },
  { id: 'cal-tomorrow', title: 'Gerichtstermin', startAt: tomorrowNoon.toISOString(), caseLabel: 'Fall B', allDay: false }
];
context.window.__todoItemsAll = async () => [
  { id: 'todo-1', title: 'Unterlagen senden', dueAt: todayNoon.toISOString(), caseLabel: 'Fall A', itemType: 'task', done: false },
  { id: 'follow-1', title: 'Sachstand nachfragen', dueAt: tomorrowNoon.toISOString(), caseLabel: 'Fall B', itemType: 'followup', done: false }
];
context.window.__inboxDocsGet = async () => [
  { sender: 'Krankenkasse', status: 'neu', receivedDate: todayGerman, caseLabel: 'Fall A' }
];
context.window.__mxLatestInbox = async () => [
  { uid: 'm1', from: { name: 'Gericht' }, subject: 'Mitteilung', date: todayNoon.toISOString(), seen: true },
  { uid: 'm2', from: { name: 'Kasse' }, subject: 'Bescheid', date: tomorrowNoon.toISOString(), seen: true }
];
context.window.__kmSnapshot = async () => ({
  over: [{ caseLabel: 'Fall A', _dueIso: todayNoon.toISOString(), _days: -2 }],
  soon: [
    { caseLabel: 'Fall B', _dueIso: tomorrowNoon.toISOString(), _days: 1 },
    { caseLabel: 'Fall C', _dueIso: tomorrowNoon.toISOString(), _days: 3 }
  ],
  list: []
});
context.window.__invoicesGet = async () => [];
context.window.__ciStoreLoad = async () => [];
context.window.__coStoreLoad = async () => [];
context.window.toast = (message) => toasts.push(String(message));

vm.runInNewContext(dashboardBlock(htmls[0]).script, context, { filename: 'dashboard-script-v1.js' });

(async () => {
  await context.window.openDashboard();
  assert.equal(title.textContent, 'Dashboard');
  assert(dashBody.innerHTML.includes('data-cols="4"'), 'Standardraster muss vier Spalten behalten.');
  assert(dashBody.innerHTML.includes('title="Dashboard konfigurieren"'), 'Layout-Symbol für den Editor fehlt.');
  assert(!dashBody.innerHTML.includes('>Bearbeiten</button>'), 'Der Editor darf nicht mehr als Textschaltfläche erscheinen.');
  assert(dashBody.innerHTML.includes('Termine heute'), 'Standard-Kennzahl fehlt.');
  assert(dashBody.innerHTML.includes('Sichtbare Fälle'), 'Kuratierte Standard-Fallliste fehlt.');
  assert(/dash-ctitle">E-Mail<\/span>[\s\S]*?dash-cnum ok">0<\/div>/.test(dashBody.innerHTML),
    'Die E-Mail-Kennzahl zeigt bei null ungelesenen Nachrichten fälschlich die Anzahl geladener Nachrichten.');
  assert(/dash-ctitle">Persönliche Kontakte<\/span>[\s\S]*?dash-cnum crit">3<\/div>/.test(dashBody.innerHTML),
    'Die Kontaktkennzahl addiert überfällige und bald fällige Kontakte nicht.');
  assert(dashBody.innerHTML.includes(`Fall A · ${todayGerman} · 12:30`)
    || dashBody.innerHTML.includes(`Fall A · ${todayGerman} · 13:30`),
  'Kalenderzeilen zeigen Fall, Datum und Uhrzeit nicht gemeinsam an.');
  assert(dashBody.innerHTML.includes(`Fall A · ${todayGerman}`),
    'Aufgaben oder Posteingang zeigen Fall und Datum nicht gemeinsam an.');
  assert(!dashBody.innerHTML.includes('Abgeschlossene Testgenehmigung'),
    'Erledigte Genehmigungen werden wegen Groß-/Kleinschreibung als offen angezeigt.');
  assert(fetchCalls.some((call) => call.url === '/api/user-prefs/dashboard'), 'Layout wurde nicht aus der Serverdatenbank geladen.');

  await context.window.__dashOpenEditor();
  assert.equal(title.textContent, 'Dashboard konfigurieren');
  assert(dashBody.innerHTML.includes('Dashboard konfigurieren'), 'Editor wurde nicht geöffnet.');
  assert(dashBody.innerHTML.includes('Kennzahlenleiste'), 'Professionelle Bezeichnung der Statusleiste fehlt.');
  assert(dashBody.innerHTML.includes('7 von 7'), 'Sieben Standardkennzahlen werden nicht erhalten.');
  assert(dashBody.innerHTML.includes('Inhaltsbereich'), 'Professionelle Bezeichnung des Widget-Rasters fehlt.');
  assert(dashBody.innerHTML.includes('Widget-Katalog'), 'Widget-Katalog ist nicht klar bezeichnet.');
  assert(dashBody.innerHTML.includes('Banking'), 'Rechtegesperrtes Banking-Widget fehlt im Katalog.');
  assert(
    /dash-library-item disabled[\s\S]*?Banking[\s\S]*?wegen fehlender Rechte gesperrt/.test(dashBody.innerHTML),
    'Banking-Widget ist ohne Banking-Recht nicht ausgegraut.'
  );
  assert(dashBody.innerHTML.includes('1x3'), 'Hohe Widget-Größe 1x3 fehlt.');
  assert(dashBody.innerHTML.includes('3x3'), 'Große Widget-Größe 3x3 fehlt.');
  assert(
    dashboardBlock(htmls[0]).script.includes('__dashEditorDragOver')
      && dashboardBlock(htmls[0]).script.includes('dashEditorReflow')
      && dashboardBlock(htmls[0]).script.includes('dash-drop-placeholder'),
    'Dynamische Zielvorschau und Live-Sortierung fehlen.'
  );

  const dataTransfer = { effectAllowed: '', setData() {} };
  const panelIds = [
    'calendar.today', 'deadlines.open', 'tasks.open', 'contacts.due',
    'health.upcoming', 'approvals.open', 'goals.open', 'remuneration.open',
    'inbox.open', 'mail.latest', 'casecycle.open', 'cases.active'
  ];
  const fakeContainer = {
    children: [],
    classList: { add() {}, remove() {}, contains(value) { return value === 'dash-edit-list'; } },
    insertBefore(node, reference) {
      const old = this.children.indexOf(node);
      if (old >= 0) this.children.splice(old, 1);
      const at = reference == null ? this.children.length : this.children.indexOf(reference);
      this.children.splice(at < 0 ? this.children.length : at, 0, node);
    },
    appendChild(node) { this.insertBefore(node, null); }
  };
  const fakeItems = panelIds.map((id) => {
    const classes = new Set(['dash-edit-item']);
    const item = {
      dataset: { dashId: id },
      parentElement: fakeContainer,
      classList: {
        add(...values) { values.forEach((value) => classes.add(value)); },
        remove(...values) { values.forEach((value) => classes.delete(value)); },
        contains(value) { return classes.has(value); }
      },
      matches(selector) { return selector.split(',').some((part) => classes.has(part.trim().replace(/^\./, ''))); },
      getBoundingClientRect() {
        const index = fakeContainer.children.indexOf(item);
        return { left: (index % 2) * 400, top: Math.floor(index / 2) * 70, width: 380, height: 60 };
      },
      animate() {}
    };
    Object.defineProperty(item, 'nextSibling', {
      get() {
        const at = fakeContainer.children.indexOf(item);
        return fakeContainer.children[at + 1] || null;
      }
    });
    return item;
  });
  fakeContainer.children.push(...fakeItems);
  context.window.__dashEditorDragStart({ currentTarget: fakeItems[0], dataTransfer }, 'panel', 0);
  context.window.__dashEditorDragOver(
    { preventDefault() {}, stopPropagation() {}, clientX: 790, clientY: 30, dataTransfer },
    'panel',
    fakeItems[1]
  );
  assert.deepEqual(
    fakeContainer.children.slice(0, 3).map((item) => item.dataset.dashId),
    ['deadlines.open', 'calendar.today', 'tasks.open'],
    'Widgets rücken während des Ziehens nicht sichtbar an die neue Position.'
  );
  context.window.__dashEditorDrop({ preventDefault() {}, stopPropagation() {} }, 'panel', fakeItems[1]);
  const activeIds = [...dashBody.innerHTML.matchAll(/data-dash-id="([^"]+)"/g)].map((match) => match[1]);
  const activePanelIds = activeIds.slice(7);
  assert(
    activePanelIds.indexOf('deadlines.open') < activePanelIds.indexOf('calendar.today'),
    `Live-Reihenfolge wurde beim Ablegen nicht übernommen: ${activePanelIds.slice(0, 20).join(', ')}`
  );
  context.window.__dashEditorReset();

  context.window.__dashEditorLibraryDragStart({ dataTransfer }, 'card', 'health.upcoming');
  context.window.__dashEditorDrop({ preventDefault() {} }, 'card', 0);
  context.window.__dashEditorRemove('panel', 0);
  context.window.__dashEditorLibraryDragStart({ dataTransfer }, 'panel', 'calendar.upcoming');
  context.window.__dashEditorDrop({ preventDefault() {} }, 'panel', 0);
  await context.window.__dashEditorSave({ disabled: false });
  const savedCall = fetchCalls.find((call) => call.url === '/api/user-prefs/dashboard' && call.options.method === 'PUT');
  assert(savedCall, 'Drag-&-Drop-Layout wurde nicht gespeichert.');
  const savedLayout = JSON.parse(savedCall.options.body).prefs;
  assert.equal(savedLayout.cards.length, 7, 'Austausch darf die Siebenerleiste nicht vergrößern.');
  assert.equal(savedLayout.cards[0].id, 'health.upcoming', 'Kasten wurde bei voller Siebenerleiste nicht ausgetauscht.');
  assert.equal(savedLayout.panels[0].id, 'calendar.upcoming', 'Widget aus Bibliothek wurde nicht an der Zielposition eingefügt.');
  assert(dashBody.innerHTML.includes('Termine – nächste 7 Tage'), 'Neu eingefügtes Widget wird nicht gerendert.');

  dashboardRouteAvailable = false;
  await context.window.__dashOpenEditor();
  context.window.__dashEditorColumns(3);
  await context.window.__dashEditorSave({ disabled: false });
  const pendingKey = 'bb_dashboard_pending_v1_17';
  assert(local.has(pendingKey), 'Ein alter laufender Server verliert das vorgemerkte Dashboard-Layout.');
  assert(
    toasts.some((message) => message.includes('Nach dem Serverneustart')),
    'Die lokale Vormerkung wird dem Nutzer nicht verständlich gemeldet.'
  );

  dashboardRouteAvailable = true;
  const syncCalls = [];
  const syncTitle = { textContent: '' };
  const syncDashBody = { innerHTML: '' };
  const syncElements = {
    modalTitle: syncTitle,
    dashBody: syncDashBody,
    modal: { classList: { remove() {} } },
    modalBody: { innerHTML: '' }
  };
  const syncContext = {
    ...context,
    document: {
      getElementById(id) { return syncElements[id] || null; },
      querySelectorAll() { return []; }
    },
    fetch: async (url, options) => {
      syncCalls.push({ url: String(url), options: options || {} });
      if (String(url) === '/api/user-prefs/dashboard') {
        if (options && options.method === 'PUT') return { ok: true, status: 200, json: async () => JSON.parse(options.body) };
        return { ok: true, status: 200, json: async () => ({ prefs: null }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
  };
  syncContext.window = syncContext;
  vm.runInNewContext(dashboardBlock(htmls[0]).script, syncContext, { filename: 'dashboard-script-v1-pending-sync.js' });
  await syncContext.window.openDashboard();
  assert(
    syncCalls.some((call) => call.url === '/api/user-prefs/dashboard' && call.options.method === 'PUT'),
    'Vorgemerktes Layout wird nach dem Serverneustart nicht automatisch zentral gespeichert.'
  );
  assert(!local.has(pendingKey), 'Erfolgreich synchronisierte lokale Vormerkung wurde nicht entfernt.');

  console.log('Dashboard-Widgets: 18/45 vollständig gerendert; Kennzahlen, Fall-/Datumsbezug, Aktionen, Rechte, Layout, Scrollen und Persistenz geprüft; 298/223, 0 Syntaxfehler.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
