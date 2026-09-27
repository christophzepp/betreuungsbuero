'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
const html = fs.readFileSync(path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function region(start, end) { const a = html.indexOf(start), b = html.indexOf(end, a + start.length); assert.ok(a >= 0 && b > a, start); return html.slice(a, b); }
const fn = start => region(start, '\n  }\n') + '\n  }\n';
const script = id => region(`<script id="${id}">`, '</script>').replace(`<script id="${id}">`, '');
const stateKey = /const STORAGE_KEY='([^']+)'/.exec(html)[1], registryKey = /REGISTRY_STORAGE_KEY_V161='([^']+)'/.exec(html)[1];
const other = 'sf-doku-ziel';
const caseState = id => ({ ui: { localCaseId: id, caseLoaded: true }, caseData: { person: { firstName: 'Synthetisch', lastName: id }, documentationEntries: [] }, reports: { initial: { fields: {}, meta: {} } } });

module.exports = async function dokuEditor(t, { prepare, request, db, setActor }) {
  const pending = [];
  const check = (name, run) => t.test(name, async () => { try { await run(); } finally { await Promise.allSettled(pending.splice(0)); } });
  async function client(mode = 'online', intercept = () => null) {
    prepare(); db.prepare('INSERT INTO cases (id,label,owner_user_id,stammdaten_json) VALUES (?,?,1,?) ON CONFLICT(id) DO UPDATE SET owner_user_id=1')
      .run(other, 'Synthetischer Dokumentationsfall', '{}');
    const storage = new Map([[stateKey, JSON.stringify(caseState(fixture.caseId))], [registryKey, JSON.stringify([fixture.caseId, other].map(id => ({ id, state: caseState(id) })))]]);
    const notices = [], calls = [], ui = [], elements = new Map(); let failKey;
    const element = id => { if (!elements.has(id)) elements.set(id, { value: '', checked: false, classList: { add() {}, remove() {}, contains: () => false } }); return elements.get(id); };
    for (const id of ['modal', 'modalTitle', 'modalBody', 'dokuFormCaseSelect', 'dokuFreeDetail', 'dokuNote', 'dokuDate', 'dokuReportRelevantV255', 'dokuTopicV255', 'dokuTargetV255']) element(id);
    const c = { state: caseState(fixture.caseId), __appMode: mode, __activeServerCaseId: mode === 'online' ? fixture.caseId : '',
      console: { warn() {}, error() {} }, SOURCE_LABELS: {}, SOURCE_TITLES: {}, fdState: { form: null }, dokuFilterStateV162: {},
      document: { readyState: 'loading', addEventListener() {}, getElementById: id => elements.get(id) || null, querySelector: () => null, querySelectorAll: () => [] },
      setTimeout() {}, clearTimeout() {}, addEventListener() {}, requestAnimationFrame() {}, updateNavStatus() {}, ensureState() {},
      norm: value => String(value ?? '').trim().toLowerCase(), clone, isEmpty: value => value == null || value === '',
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (key === failKey) throw new Error('Synthetischer Speicherfehler'); storage.set(key, value); } },
      toast: message => notices.push(message), alert: message => notices.push(message), newState: () => ({ ui: {} }),
      fdFormBereinigen: () => c.fdState.form, fdFormRoot: () => element('formRoot'), fdRecRelease() {}, fdModulansichtOffen: () => false,
      fdFormFrageAktualisieren() {}, fdWrapperNeuAusrichten() {}, fdAnlSig: () => '', fdIstMobil: () => false,
      fdFormHTML: () => '', dokuWireSuggestFieldsV161() {}, dokuAttachAutoGrowV162() {}, fdFormVerdrahten() {},
      fdFormInline: () => false, fdKontaktAktuell: () => null, dokuPhotosV166: entry => entry?.photos || [], dokuAttachmentModeV168: () => mode === 'online' ? 'server' : 'lokal',
      openDocumentationView: () => ui.push('closed'), __kmDocData: async () => null,
      fetch: (url, options = {}) => {
        calls.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
        const p = (async () => await intercept(url, options, c) || request(url, options))(); pending.push(p); p.catch(() => {}); return p;
      } };
    c.window = c; c.__appState = () => c.state; vm.createContext(c);
    new vm.Script(region('const STORAGE_KEY=', '\n') + '\n' + region('function stateForBrowserStorage()', 'function loadState()') + region('function setReportValue(', '\nfunction ')
      + '\n(function(){' + region('  const REGISTRY_STORAGE_KEY_V161=', '  /* Nach jedem erfolgreichen Stammdaten-/Adressverzeichnis-Import') + '})();').runInContext(c);
    c.__onlineCaseCache = new Map([[fixture.caseId, { data: { stammdaten: {}, documentationEntries: [] } }], [other, { data: { stammdaten: {}, documentationEntries: [] } }]]);
    new vm.Script(fn('  function dokuTargetV161(') + region('  let dokuEditingIndexV161=', '  function dokuPhotosV166(') + fn('  function dokuServerCaseIdV166(') + fn('  function fdFormWerteLesen(')
      + fn('  function dokuPhotosV166(') + fn('  function dokuAttachmentKindV167(') + region('  function fdAnlSig()', '\n') + '\n'
      + region('  function dokuPhotosForSaveV166(', '  window.__casePickerCurrentHint=')
      + fn('  function dokuAllowedAttachmentV167(') + fn('  function dokuMimeFallbackV167(') + fn('  function dokuReadAsDataURLV166(')
      + region('  window.__dokuQuickCreateEntry=', '  /* ===== Sidebar')
      + region('  window.saveDokuEntry=async function(', '  /* Ein Schreibweg fuer Dokumentation, Anlage und Transkript')
      + region('  window.openDokuEntryForm=function(caseId,index){', '  /* ---------- Tippstand, Zustandsbalken, Geisterzeile')).runInContext(c);
    for (const id of ['contact-social-documentation-script-v255', 'initial-data-domains-script-v255']) new vm.Script(script(id)).runInContext(c);
    c.__housingV255.ensureModels(c.state.caseData);
    const docs = async (id = fixture.caseId) => (await (await request(`/api/cases/${id}/doku-entries`)).json()).entries;
    const seed = async () => {
      const data = { freeDetail: 'Alter Vorgang', reportRelevant: false, reportSummary: '', unknown: { keep: null } };
      const response = await request(`/api/cases/${fixture.caseId}/doku-entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
      const entry = { ...data, id: (await response.json()).id }; c.state.caseData.documentationEntries.push(entry); return entry;
    };
    const open = (id = fixture.caseId, index = -1) => {
      c.openDokuEntryForm(id, index); element('dokuFormCaseSelect').value = id; element('dokuFreeDetail').value = 'Geprüfter Vorgang';
      element('dokuDate').value = '2026-09-22'; element('dokuReportRelevantV255').checked = true;
      element('dokuTopicV255').value = 'contact'; element('dokuTargetV255').value = 'initial.contact_notes';
    };
    return { c, notices, calls, ui, storage, docs, seed, open, element, save: () => c.saveDokuEntry(), fail: key => { failKey = key; }, drain: () => Promise.allSettled(pending.splice(0)) };
  }

  await check('Dokumentationseditor: Eintrag und Berichtsfreigabe werden in genau einem bestätigten Schreibvorgang gespeichert', async () => {
    for (const editing of [false, true]) {
      const x = await client(); if (editing) await x.seed(); const before = await x.docs(); x.open(fixture.caseId, editing ? 0 : -1); await x.save();
      assert.equal(x.calls.length, 1); assert.equal(x.calls[0].body.data.reportRelevant, true);
      assert.equal(x.calls[0].body.data.reportSummary, 'Geprüfter Vorgang');
      const docs = await x.docs(); assert.equal(docs.length, before.length + (editing ? 0 : 1));
      const saved = docs.find(entry => entry.id === x.c.state.caseData.documentationEntries[0].id);
      assert.equal(saved.data.reportSummary, 'Geprüfter Vorgang'); assert.deepEqual(saved.data.reportTargets, ['initial.contact_notes']);
      if (editing) assert.deepEqual(saved.data.unknown, { keep: null });
    }
  });
  await check('Dokumentationseditor: abgewiesenes Speichern ändert keinen alten Eintrag über den Berichts-Wrapper', async () => {
    const x = await client('online', (_url, _options, c) => { if (!c.failedOnce) { c.failedOnce = true; return new Response('', { status: 403 }); } });
    await x.seed(); const before = await x.docs(), local = clone(x.c.state.caseData.documentationEntries); x.open(); await x.save();
    assert.equal(x.calls.length, 1); assert.deepEqual(await x.docs(), before); assert.deepEqual(clone(x.c.state.caseData.documentationEntries), local);
    assert.equal(x.ui.length, 0); assert.ok(x.c.fdState.form);
  });
  await check('Dokumentationseditor: HTML und ungültige POST-/PUT-Bestätigungen erzeugen keinen Erfolg', async () => {
    for (const editing of [false, true]) for (const reply of [() => new Response('<html>Anmeldung</html>'), () => Response.json({}), () => Response.json(editing ? { ok: false } : { id: 4 })]) {
      const x = await client('online', () => reply()); if (editing) await x.seed(); x.open(fixture.caseId, editing ? 0 : -1);
      const before = await x.docs(), local = clone(x.c.state.caseData.documentationEntries); await x.save();
      assert.deepEqual(await x.docs(), before); assert.deepEqual(clone(x.c.state.caseData.documentationEntries), local);
      assert.equal(x.calls.length, 1); assert.equal(x.ui.length, 0); assert.ok(x.c.fdState.form); assert.ok(!x.notices.includes('Eintrag gespeichert.'));
    }
  });
  await check('Dokumentationseditor: fehlgeschlagene Eingabeprüfung schreibt weder Eintrag noch Berichtsmetadaten', async () => {
    const x = await client(); await x.seed(); const before = await x.docs(); x.open();
    x.element('dokuFreeDetail').value = ''; x.element('dokuReportRelevantV255').checked = false; await x.save();
    assert.equal(x.calls.length, 0); assert.deepEqual(await x.docs(), before); assert.equal(x.ui.length, 0);
  });
  await check('Dokumentationseditor lokal: Speicherfehler erhält gespeicherten und geladenen Bestand einschließlich Berichtsfreigabe', async () => {
    for (const [id, key] of [[fixture.caseId, stateKey], [other, registryKey]]) {
      const x = await client('local'); x.open(id); const cd = id === fixture.caseId ? x.c.state.caseData : x.c.caseRegistry[1].state.caseData;
      const before = clone(cd.documentationEntries), stored = [...x.storage]; x.fail(key); await x.save();
      assert.deepEqual(clone(cd.documentationEntries), before); assert.deepEqual([...x.storage], stored); assert.equal(x.ui.length, 0);
      x.fail(null); await x.save(); const loaded = JSON.parse(x.storage.get(key));
      const entries = id === fixture.caseId ? loaded.caseData.documentationEntries : loaded.find(entry => entry.id === id).state.caseData.documentationEntries;
      assert.equal(entries.length, 1); assert.equal(entries[0].reportSummary, 'Geprüfter Vorgang'); assert.equal(x.calls.length, 0);
    }
  });
  await check('Dokumentationseditor: Fallwechsel oder ersetzter Zustand nach Formularöffnung schreibt keinen fremden Fall', async () => {
    for (const mode of ['online', 'local']) {
      const x = await client(mode); x.open(); x.c.state = caseState(other); x.c.__activeServerCaseId = mode === 'online' ? other : '';
      const before = clone(x.c.state), stored = [...x.storage]; await x.save();
      assert.equal(x.calls.length, 0); assert.deepEqual(clone(x.c.state), before); assert.deepEqual([...x.storage], stored); assert.equal(x.ui.length, 0);
    }
  });
  await check('Dokumentationseditor: verschobene Zeile bleibt über ihre Kennung zugeordnet; geänderte oder entfernte Zeile wird abgewiesen', async () => {
    for (const change of ['moved', 'changed', 'removed']) {
      const x = await client(); const entry = await x.seed(); x.open(fixture.caseId, 0);
      const neighbor = { id: 'synthetischer-nachbar', freeDetail: 'Nachbar bleibt' }; x.c.state.caseData.documentationEntries.unshift(neighbor);
      if (change === 'changed') entry.freeDetail = 'Neuere Bearbeitung';
      if (change === 'removed') x.c.state.caseData.documentationEntries.pop();
      await x.save(); assert.equal(neighbor.freeDetail, 'Nachbar bleibt');
      if (change === 'moved') { assert.equal(x.calls.length, 1); assert.ok(x.calls[0].url.endsWith(entry.id)); }
      else assert.equal(x.calls.length, 0);
    }
  });
  await check('Dokumentationseditor: bewusste Auswahl eines anderen Falls übernimmt auch dort die Berichtsfreigabe', async () => {
    const x = await client(); x.open(); x.element('dokuFormCaseSelect').value = other; const before = await x.docs(other); await x.save();
    assert.equal(x.calls.length, 1); assert.ok(x.calls[0].url.includes(other));
    const docs = await x.docs(other); assert.equal(docs.length, before.length + 1); assert.equal(docs.at(-1).data.reportSummary, 'Geprüfter Vorgang');
    assert.equal(x.c.state.caseData.documentationEntries.length, 0);
  });
  await check('Dokumentationseditor: neueres Formular bleibt nach einer verspäteten Speicherantwort offen', async () => {
    let entered, release; const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const x = await client('online', async () => { entered(); await gate; }); x.open(); const saving = x.save();
    let newer; try { await reached;
      x.c.__onlineCaseCache.get(other).data.documentationEntries.push({ id: 'anderer-eintrag', photos: [{ id: 'anderes-foto', mimeType: 'image/png' }] });
      x.open(other, 0); newer = x.c.fdState.form;
    } finally { release(); await saving; }
    assert.equal(x.c.fdState.form, newer); assert.equal(x.ui.length, 0); assert.equal(x.calls.length, 1);
  });
  await check('Dokumentationseditor: vor der Antwort eingetroffener Eintrag wird weder verdoppelt noch überschrieben', async () => {
    const x = await client('online', async (url, options, c) => { const response = await request(url, options);
      const data = await response.clone().json(); c.state.caseData.documentationEntries.push({ ...JSON.parse(options.body).data, id: data.id, freeDetail: 'Neuere Serveränderung' }); return response; });
    x.open(); await x.save(); assert.equal(x.c.state.caseData.documentationEntries.length, 1);
    assert.equal(x.c.state.caseData.documentationEntries[0].freeDetail, 'Neuere Serveränderung'); assert.equal(x.calls.length, 1);
  });
  await check('Dokumentationseditor: verlorene Antwort nach echtem Commit wird nicht wiederholt oder als Erfolg angezeigt', async () => {
    const x = await client('online', async (url, options) => { const response = await request(url, options); assert.equal(response.status, 201); await response.json(); throw new Error('Verlorene Antwort'); });
    const before = await x.docs(); x.open(); await x.save(); assert.equal((await x.docs()).length, before.length + 1);
    assert.equal(x.calls.length, 1); assert.equal(x.ui.length, 0); assert.equal(x.c.state.caseData.documentationEntries.length, 0);
  });
  await check('Dokumentationseditor: tatsächlicher Rechteentzug verhindert Eintrag und nachlaufende Metadatenänderung', async () => {
    const x = await client(); await x.seed(); const before = await x.docs(); x.open(fixture.caseId, 0); setActor('reader'); await x.save();
    assert.deepEqual(await x.docs(), before); assert.equal(x.calls.length, 1); assert.equal(x.ui.length, 0);
  });
  await check('Dokumentationseditor: paralleles Absenden erzeugt nur einen Eintrag', async () => {
    let entered, release; const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const x = await client('online', async () => { entered(); await gate; }); x.open(); const before = await x.docs(), first = x.save(); let second;
    try { await reached; second = x.save(); } finally { release(); await first; await second; }
    assert.equal(x.calls.length, 1); assert.equal((await x.docs()).length, before.length + 1);
  });
  await check('Dokumentationseditor: beschädigte, doppelte oder fehlende Schreibziele bleiben unverändert', async () => {
    for (const problem of ['list', 'entry', 'duplicate', 'missing']) {
      const x = await client('local');
      if (problem === 'list') x.c.state.caseData.documentationEntries = {};
      if (problem === 'entry') x.c.state.caseData.documentationEntries = [null];
      if (problem === 'duplicate') x.c.caseRegistry.push(clone(x.c.caseRegistry[1]));
      const before = clone(x.c.state), stored = [...x.storage]; x.open(problem === 'duplicate' ? other : problem === 'missing' ? 'fehlt' : fixture.caseId); await x.save();
      assert.deepEqual(clone(x.c.state), before); assert.deepEqual([...x.storage], stored); assert.equal(x.calls.length, 0); assert.equal(x.ui.length, 0);
    }
  });
  await check('Dokumentationseditor: fehlende optionale Liste wird erst mit dem bestätigten ersten Eintrag angelegt', async () => {
    const x = await client(); delete x.c.state.caseData.documentationEntries; x.open(); await x.save();
    assert.equal(x.c.state.caseData.documentationEntries.length, 1); assert.equal(x.calls.length, 1);
    assert.ok((await x.docs()).some(entry => entry.id === x.c.state.caseData.documentationEntries[0].id));
  });
  await check('Dokumentationseditor: vorhandener Eintrag und Cache behalten neuere Änderungen während des Speicherns', async () => {
    const x = await client('online', async (url, options, c) => { const response = await request(url, options);
      c.state.caseData.documentationEntries[0].freeDetail = 'Neuere lokale Änderung';
      c.__onlineCaseCache.get(fixture.caseId).data.documentationEntries[0].freeDetail = 'Neueres Cacheecho'; return response; });
    const entry = await x.seed(); x.c.__onlineCaseCache.get(fixture.caseId).data.documentationEntries.push(clone(entry)); x.open(fixture.caseId, 0); await x.save();
    assert.equal(x.c.state.caseData.documentationEntries[0].freeDetail, 'Neuere lokale Änderung');
    assert.equal(x.c.__onlineCaseCache.get(fixture.caseId).data.documentationEntries[0].freeDetail, 'Neueres Cacheecho');
    assert.equal(x.calls.length, 1);
  });
  await check('Dokumentationseditor: weitere Eingaben während der Speicherung bleiben offen und aktualisieren danach dieselbe Serverkennung', async () => {
    let entered, release, delayed = true; const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const x = await client('online', async () => { if (delayed) { entered(); await gate; } }); x.open(); const form = x.c.fdState.form;
    const before = await x.docs(), saving = x.save();
    try { await reached; x.element('dokuFreeDetail').value = 'Neuere Eingabe während des Speicherns'; } finally { release(); await saving; }
    assert.equal(x.c.fdState.form, form); assert.equal(x.ui.length, 0); delayed = false; await x.save();
    assert.equal(x.calls.length, 2); assert.deepEqual(x.calls.map(call => call.method), ['POST', 'PUT']);
    const docs = await x.docs(); assert.equal(docs.length, before.length + 1); assert.equal(docs.at(-1).data.reportSummary, 'Neuere Eingabe während des Speicherns');
  });
  await check('Dokumentationseditor: Weitertippen überträgt bereits bestätigte Anlagen beim nächsten Speichern nicht erneut', async () => {
    const x = await client(); x.open(); let uploads = 0;
    vm.runInContext("dokuPendingPhotosV166=[{id:'local-photo',filename:'test.png',kind:'image',_pending:true,dataUrl:'data:image/png;base64,AA=='}]", x.c);
    // Only the upload boundary is an adapter; photo preparation/reconciliation and both entry writes are real source.
    x.c.dokuUploadPhotoV166 = async (_caseId, entryId) => { uploads++; x.element('dokuFreeDetail').value = 'Während des Uploads ergänzt';
      return { photo: { id: 'confirmed-photo' }, entry: { id: entryId, data: { photos: [{ id: 'confirmed-photo', filename: 'test.png', kind: 'image' }] } } }; };
    await x.save(); assert.ok(x.c.fdState.form); await x.save(); assert.equal(uploads, 1);
    assert.deepEqual(x.calls.map(call => call.method), ['POST', 'PUT']);
    assert.equal(x.calls[1].body.data.photos[0].id, 'confirmed-photo');
  });
  await require('./server-first-doku-attachments.cjs')(t, { client, request, db, setActor });
  await require('./server-first-doku-quick.cjs')(t, { client, request, db, setActor });
  await require('./server-first-doku-delete.cjs')(t, { client, request, db, setActor, region });
  await require('./server-first-doku-callers.cjs')(t, { client, request, db, region });
  await require('./server-first-doku-navigation.cjs')(t, { client, request, db, region });
  await require('./server-first-inbox-read.cjs')(t, { client, request, db, setActor, region });
  await require('./server-first-doku-retry.cjs')(t, { client, request });
  await require('./server-first-auto-target.cjs')(t, { client, request, db, setActor, region });
};
