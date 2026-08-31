'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function scripts() {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) out.push({ attrs: match[1] || '', body: match[2] || '' });
  return out;
}

function scriptById(id) {
  const found = scripts().filter((script) => new RegExp(`\\bid=["']${id}["']`).test(script.attrs));
  assert.equal(found.length, 1, `Script ${id} muss genau einmal vorkommen`);
  return found[0].body;
}

function region(start, end) {
  const first = html.indexOf(start);
  assert.notEqual(first, -1, `Start fehlt: ${start}`);
  assert.equal(html.indexOf(start, first + start.length), -1, `Start nicht eindeutig: ${start}`);
  const last = html.indexOf(end, first + start.length);
  assert.notEqual(last, -1, `Ende fehlt: ${end}`);
  return html.slice(first, last);
}

test('HTML bleibt syntaktisch unverändert prüfbar', () => {
  const allScripts = scripts();
  assert.equal(allScripts.length, 309, 'Scriptblockzahl hat sich verändert.');
  let jsCount = 0;
  allScripts.forEach((script, index) => {
    if (/\btype\s*=\s*(['"]?)(?!text\/javascript|application\/javascript|module)\w/i.test(script.attrs)) return;
    jsCount += 1;
    new vm.Script(script.body, { filename: `html-online-case-load-priority-${index + 1}.js` });
  });
  assert.equal(jsCount, 229, 'JavaScript-Blockzahl hat sich verändert.');
});

test('Online-Erstfall bekommt beim appLoginReady Vorrang vor optionalen GET-/api-Abrufen', async () => {
  const body = scriptById('app-login-ready-replay-script-v1');
  const listeners = {};
  const fetchCalls = [];
  const context = {
    window: {
      fetch: async (input) => {
        fetchCalls.push(input);
        return { ok: true };
      },
      addEventListener(type, listener) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(listener);
      }
    },
    location: { href: 'http://localhost/' },
    CustomEvent: function CustomEvent(type, init) { return { type, detail: init && init.detail }; },
    URL,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(body, context);

  assert.equal(typeof context.window.fetch, 'function');
  assert.equal(context.window.__onlineInitialCaseFetchWrapped, true);
  assert.equal(listeners.appLoginReady.length, 1);
  listeners.appLoginReady[0]({ detail: { mode: 'online' } });
  assert.equal(context.window.__onlineInitialCaseBootActive, true);

  const delayed = context.window.fetch('/api/calendar/events');
  await Promise.resolve();
  assert.deepEqual(fetchCalls, [], 'optionale GET-/api-Aufrufe müssen bis zur Fallfreigabe warten');

  context.window.__onlineInitialCasePriorityDepth = 1;
  await context.window.fetch('/api/cases');
  context.window.__onlineInitialCasePriorityDepth = 0;
  assert.deepEqual(fetchCalls, ['/api/cases'], 'Prioritätsabrufe dürfen die Schranke umgehen');

  context.window.__onlineInitialCaseReadyResolve();
  await delayed;
  assert.deepEqual(fetchCalls, ['/api/cases', '/api/calendar/events']);
});

test('Online-Fallstart lädt den aktiven Fall vor Panel-Render und Hintergrund-Preload', () => {
  const body = scriptById('online-case-sync-script-v1');
  assert.match(body, /serverCasesFetchInFlight/);
  assert.match(body, /priorityFetch\('\/api\/cases'/);
  assert.match(body, /priorityFetch\(`\/api\/cases\/\$\{encodedCaseId\}\/load`/);
  assert.match(body, /priorityFetch\('\/api\/templates\/stammdaten'/);
  assert.match(body, /beginInitialCaseBoot\(\);/);
  assert.match(body, /finishInitialCaseBoot\(\);/);
  assert.match(
    body,
    /window\.__onlineInitialCaseBootActive=!!window\.__onlineInitialCaseBootActive;/,
    'Eine vom frühen Login-Replay bereits gestartete Fallschranke darf nicht ersetzt werden.'
  );

  const loginBlock = region(
    "  window.addEventListener('appLoginReady',async(e)=>{",
    '\n\n  const originalDeleteAllForServerSync'
  );
  const openIndex = loginBlock.indexOf('await openRememberedOrFirstOnlineCase();');
  const finishIndex = loginBlock.indexOf('finishInitialCaseBoot();');
  const panelIndex = loginBlock.indexOf('renderServerCasesPanel();');
  const preloadIndex = loginBlock.indexOf('setTimeout(function(){ try{preloadAllCasesIntoCache();}catch(_e){} },1200);');
  assert.ok(openIndex > -1, 'aktiver Fall muss explizit geöffnet werden');
  assert.ok(finishIndex > openIndex, 'Startschranke wird nach dem Fallladen freigegeben');
  assert.ok(panelIndex > finishIndex, 'Fallliste/Panel rendert erst nach dem Fallladen');
  assert.ok(preloadIndex > panelIndex, 'Hintergrund-Preload startet erst danach verzögert');
});
