'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
const fixture = require('../fixtures/server-first/pilot-case.json');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function region(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start); return html.slice(a, b);
}
const script = id => region(`<script id="${id}">`, '</script>').replace(`<script id="${id}">`, '');
const sourceFunction = start => region(start, '\n  }\n') + '\n  }\n';
const stateKey = /const STORAGE_KEY='([^']+)'/.exec(html)[1];
const registryKey = /REGISTRY_STORAGE_KEY_V161='([^']+)'/.exec(html)[1];
const other = 'sf-kontakt-lesend';
const caseState = id => ({ ui: { localCaseId: id, caseLoaded: true }, caseData: {
  person: { firstName: 'Synthetisches', lastName: id }, contactProfile: { reportRemarks: `Alt ${id}`, unknown: { keep: null } },
  documentationEntries: [{ id: 'alt', note: 'Bestehender Eintrag', unknown: false }] },
  reports: { initial: { fields: {}, meta: {} } } });

module.exports = async function contactProfile(t, { prepare, request, setActor, db }) {
  const pendingRequests = [];
  async function check(name, run) {
    await t.test(name, async () => { try { await run(); } finally { await Promise.allSettled(pendingRequests.splice(0)); } });
  }
  async function client(mode = 'local', intercept = () => null) {
    prepare(); const storage = new Map([[stateKey, JSON.stringify(caseState(fixture.caseId))],
      [registryKey, JSON.stringify([fixture.caseId, other].map(id => ({ id, state: caseState(id) })))]]);
    const notices = [], calls = [], saved = [], elements = new Map(); let failKey;
    const element = id => { if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', hidden: false, classList: { remove() {}, contains: () => false } }); return elements.get(id); };
    for (const id of ['modalTitle', 'modalBody', 'modal', 'cpCanInitiate', 'cpReportRemarks']) element(id);
    function reload() {
      const c = { state: JSON.parse(storage.get(stateKey)), __appMode: mode, __activeServerCaseId: mode === 'online' ? fixture.caseId : '',
        console: { warn() {} }, SOURCE_LABELS: {}, SOURCE_TITLES: {}, Blob,
        document: { readyState: 'loading', addEventListener() {}, getElementById: id => elements.get(id) || null,
          querySelector: () => null, querySelectorAll: () => [], documentElement: { classList: { contains: () => false } } },
        setTimeout(fn, ms) { if (ms === 160) fn(); }, clearTimeout() {}, addEventListener() {}, requestAnimationFrame() {}, updateNavStatus() {}, ensureState() {},
        norm: value => String(value ?? '').trim().toLowerCase(), clone, isEmpty: value => value == null || value === '',
        toast: message => notices.push(message), alert: message => notices.push(message),
        localStorage: { getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key),
          setItem: (key, value) => { if (failKey === key) throw new Error('Synthetischer Speicherfehler'); storage.set(key, value); saved.push(key); } },
        fetch: (url, options = {}) => {
          calls.push({ url, method: options.method || 'GET' });
          const p = (async () => await intercept(url, options, c) || request(url, options))(); pendingRequests.push(p); p.catch(() => {}); return p;
        }, __kmDocData: async id => ({ caseId: id, anzahlImZeitraum: 2, turnusTage: 60 }) };
      c.window = c; c.__appState = () => c.state; vm.createContext(c);
      const core = region('const STORAGE_KEY=', '\n') + '\n' + region('function stateForBrowserStorage()', 'function loadState()')
        + region('function setReportValue(', '\nfunction ');
      new vm.Script(core + '\n(function(){' + region('  const REGISTRY_STORAGE_KEY_V161=', '  /* Nach jedem erfolgreichen Stammdaten-/Adressverzeichnis-Import') + '})();').runInContext(c);
      for (const id of ['contact-social-documentation-script-v255', 'initial-data-domains-script-v255']) new vm.Script(script(id)).runInContext(c);
      c.__housingV255.ensureModels(c.state.caseData);
      if (mode === 'online') {
        c.newState = () => ({ ui: {} }); c.currentCaseId = fixture.caseId;
        c.stammdatenEpoch = 0; c.stammdatenFlight = null; c.stammdatenSaveStatus = { state: 'idle' };
        c.stammdatenTimer = null; c.stammdatenPendingSince = 0; c.stammdatenRetryTimer = null; c.stammdatenRetryDelay = 2000;
        c.caseSaveStatus = () => {}; c.retryStammdaten = () => {}; c.rememberSent = () => {};
        new vm.Script(region('  const STAMMDATEN_EXCLUDE=', '\n') + '\n'
          + sourceFunction('  function diffTopLevel(') + sourceFunction('  function combinedStammdatenView(')
          + sourceFunction('  function applyPatchesToObject(')
          + region('  async function flushStammdatenSync(', '  function diffReportFields(')).runInContext(c);
        c.lastSyncedCaseData = clone(c.combinedStammdatenView());
        c.__onlineRealtime = { flushFristen: id => c.flushStammdatenSync({ strict: true, caseId: id }) };
        c.__onlineCaseCache = new Map([[fixture.caseId, { data: { stammdaten: clone(c.state.caseData), documentationEntries: [] } }],
          [other, { data: { stammdaten: caseState(other).caseData, documentationEntries: [] } }]]);
        c.__onlineCaseSync = { open: async id => {
          const data = (await (await request(`/api/cases/${id}/stammdaten`)).json()).data;
          const entries = (await (await request(`/api/cases/${id}/doku-entries`)).json()).entries;
          c.state = caseState(id); c.state.caseData = { ...data, documentationEntries: entries.map(entry => ({ ...entry.data, id: entry.id })) };
          c.currentCaseId = c.__activeServerCaseId = id; c.stammdatenEpoch++;
          c.lastSyncedCaseData = clone(c.combinedStammdatenView());
        } };
        c.__onlineRealtime.flush = async () => c.flushStammdatenSync({ strict: true, caseId: c.__activeServerCaseId });
        new vm.Script(region('function frSave(', '\n') + '\n' + region('async function frWithCase(', '// Öffentlicher Name des generischen Cross-Case-Schreibhelfers')).runInContext(c);
        c.__withCaseWrite = c.frWithCase;
      }
      return c;
    }
    const c = reload();
    if (mode === 'online') {
      const response = await request(`/api/cases/${fixture.caseId}/stammdaten`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patches: [{ path: 'contactProfile', value: c.state.caseData.contactProfile }] }) });
      assert.equal(response.status, 200);
    }
    const open = async (id = fixture.caseId) => { await c.openContactProfileV255(id, id); element('cpCanInitiate').value = 'ja'; element('cpReportRemarks').value = 'Geprüfte synthetische Bemerkung'; };
    const save = () => c.saveContactProfileV255({ onSaved: () => notices.push('zurück') });
    const docs = async () => (await (await request(`/api/cases/${fixture.caseId}/doku-entries`)).json()).entries;
    const profile = async () => (await (await request(`/api/cases/${fixture.caseId}/stammdaten`)).json()).data.contactProfile;
    return { c, open, save, storage, saved, calls, notices, reload, docs, profile, element, fail: key => { failKey = key; } };
  }

  await check('Kontaktprofil: Fallwechsel oder Zustandsaustausch nach Öffnen schreibt keine Formulardaten in den neuen Fall', async () => {
    for (const mode of ['local', 'online']) for (const sameId of [false, true]) {
      const x = await client(mode); await x.open(); const old = clone(x.c.state);
      x.c.state = caseState(sameId ? fixture.caseId : other); x.c.__activeServerCaseId = mode === 'online' ? x.c.state.ui.localCaseId : '';
      const next = clone(x.c.state), before = [...x.storage];
      await assert.rejects(x.save(), /Fall.*(gewechselt|geändert|geladen)|erneut öffnen/);
      assert.deepEqual(clone(x.c.state), next); assert.deepEqual([...x.storage], before); assert.equal(x.calls.length, 0);
      assert.equal(old.caseData.contactProfile.reportRemarks, `Alt ${fixture.caseId}`);
    }
  });
  await check('Kontaktprofil: während der Bearbeitung geändertes Profil wird nicht überschrieben', async () => {
    const x = await client(); await x.open(); x.c.state.caseData.contactProfile.reportRemarks = 'Neuere Änderung';
    await assert.rejects(x.save(), /Profil.*geändert|erneut öffnen/);
    assert.equal(x.c.state.caseData.contactProfile.reportRemarks, 'Neuere Änderung'); assert.equal(x.saved.length, 0);
  });
  await check('Kontaktprofil lokal: aktiver und geschlossener Fall erhalten Profil und Dokumentation nach Neuladen', async () => {
    for (const id of [fixture.caseId, other]) {
      const x = await client(); await x.open(id); await x.save();
      const c = x.reload(); if (id === other) assert.equal(c.switchToCase(id), true);
      assert.equal(c.state.caseData.contactProfile.reportRemarks, 'Geprüfte synthetische Bemerkung');
      assert.deepEqual(clone(c.state.caseData.contactProfile.unknown), { keep: null });
      assert.equal(c.state.caseData.documentationEntries.length, 2); assert.equal(c.state.caseData.documentationEntries[0].note, 'Bestehender Eintrag');
      assert.equal(c.state.caseData.documentationEntries[1].reportSummary, 'Geprüfte synthetische Bemerkung');
      assert.ok(x.notices.some(value => /Profil gespeichert|profil gespeichert/.test(value))); assert.equal(x.calls.length, 0);
    }
  });
  await check('Kontaktprofil lokal: Speicherfehler nimmt ungespeicherte Profil- und Dokumentationsänderungen zurück', async () => {
    for (const [id, key] of [[fixture.caseId, stateKey], [other, registryKey]]) {
      const x = await client(); await x.open(id); const cd = id === fixture.caseId ? x.c.state.caseData : x.c.caseRegistry[1].state.caseData;
      const before = clone(cd), stored = [...x.storage]; x.fail(key);
      await assert.rejects(x.save(), /Speicher/); assert.deepEqual([...x.storage], stored); assert.deepEqual(clone(cd), before);
      assert.ok(!x.notices.includes('zurück')); x.fail(null); await x.save();
    }
  });
  await check('Kontaktprofil: beschädigte Daten sowie fehlende oder doppelte lokale Ziele sind nicht bearbeitbar', async () => {
    for (const problem of ['profile', 'doku', 'duplicate', 'missing']) {
      const x = await client();
      if (problem === 'profile') x.c.state.caseData.contactProfile = [];
      if (problem === 'doku') x.c.state.caseData.documentationEntries = {};
      if (problem === 'duplicate') x.c.caseRegistry.push(clone(x.c.caseRegistry[1]));
      await x.open(problem === 'missing' ? 'fehlt' : problem === 'duplicate' ? other : fixture.caseId);
      await assert.rejects(x.save()); assert.equal(x.saved.length, 0); assert.equal(x.calls.length, 0);
      assert.match(x.element('modalBody').innerHTML, /nicht|ungültig|eindeutig/);
    }
  });
  await check('Kontaktprofil online: fremder Cachefall zeigt sein tatsächliches Stammdatenprofil', async () => {
    const x = await client('online'); await x.open(other);
    assert.match(x.element('modalBody').innerHTML, /Alt sf-kontakt-lesend/);
  });
  await check('Kontaktprofil online: bestätigte Falldaten und Dokumentation bleiben nach erneutem HTTP-Lesen erhalten', async () => {
    const x = await client('online'), before = await x.docs(); await x.open(); await x.save();
    assert.equal((await x.profile()).reportRemarks, 'Geprüfte synthetische Bemerkung');
    assert.deepEqual((await x.profile()).unknown, { keep: null });
    const docs = await x.docs(); assert.equal(docs.length, before.length + 1);
    assert.equal(docs.at(-1).data.reportSummary, 'Geprüfte synthetische Bemerkung');
    assert.equal(x.c.state.caseData.documentationEntries.at(-1).id, docs.at(-1).id);
    assert.equal(x.calls.filter(call => call.method === 'PATCH').length, 1); assert.ok(x.notices.includes('zurück'));
  });
  await check('Kontaktprofil online: fehlende Bestätigung der Falldaten verhindert Dokumentationsschreiben und Erfolg', async () => {
    for (const response of [() => new Response('', { status: 403 }), () => new Response('<html>Anmeldung</html>'), () => Response.json({ ok: false }), () => { throw new Error('Verbindung unterbrochen'); }]) {
      const x = await client('online', (url, options) => options.method === 'PATCH' ? response() : null), before = await x.docs(); await x.open();
      await assert.rejects(x.save(), /bestätigt|Speicher/); assert.deepEqual(await x.docs(), before);
      assert.equal(x.calls.filter(call => call.method === 'POST').length, 0); assert.ok(!x.notices.includes('zurück'));
    }
  });
  await check('Kontaktprofil online: unbestätigte Dokumentation meldet den gespeicherten Profilteil ohne Scheineintrag', async () => {
    for (const response of [() => new Response('', { status: 500 }), () => new Response('<html>Anmeldung</html>'), () => Response.json({}), () => Response.json({ id: 7 })]) {
      const x = await client('online', (url, options) => options.method === 'POST' ? response() : null), before = await x.docs(); await x.open();
      const original = clone(x.c.state.caseData.documentationEntries);
      await assert.rejects(x.save(), /Profil gespeichert.*(Dokumentation|Betreuungsverlauf).*nicht bestätigt/);
      assert.equal((await x.profile()).reportRemarks, 'Geprüfte synthetische Bemerkung'); assert.deepEqual(await x.docs(), before);
      assert.deepEqual(clone(x.c.state.caseData.documentationEntries), original); assert.ok(!x.notices.includes('zurück'));
    }
  });
  await check('Kontaktprofil online: verlorene Dokumentationsantwort wird nicht automatisch wiederholt', async () => {
    const x = await client('online', async (url, options) => { if (options.method !== 'POST') return;
      const response = await request(url, options); assert.equal(response.status, 201); await response.json(); throw new Error('Antwort nach Commit verloren'); });
    const before = await x.docs(); await x.open(); await assert.rejects(x.save(), /nicht bestätigt/);
    assert.equal((await x.docs()).length, before.length + 1); assert.equal(x.calls.filter(call => call.method === 'POST').length, 1);
    assert.ok(!x.notices.includes('zurück'));
  });
  await check('Kontaktprofil online: verzögerte Antwort blockiert paralleles Absenden und schließt kein neueres Formular', async () => {
    let entered, release; const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const x = await client('online', async (url, options) => { if (options.method === 'POST') { entered(); await gate; } });
    await x.open(); const pending = x.save(); let duplicate;
    try { await reached; assert.ok(!x.notices.includes('zurück')); duplicate = x.save().then(() => null, error => error); await x.open(other); }
    finally { release(); await pending; }
    assert.match(String(await duplicate), /bereits|läuft/);
    assert.equal(x.calls.filter(call => call.method === 'POST').length, 1); assert.ok(!x.notices.includes('zurück'));
  });
  await check('Kontaktprofil online: Fallwechsel während der Dokumentationsantwort verändert den neuen Fall nicht', async () => {
    const x = await client('online', async (url, options, c) => { if (options.method !== 'POST') return;
      const response = await request(url, options); c.state = caseState(other); c.__activeServerCaseId = other; return response; });
    await x.open(); await x.save(); assert.deepEqual(clone(x.c.state), caseState(other));
    assert.equal((await x.profile()).reportRemarks, 'Geprüfte synthetische Bemerkung');
  });
  await check('Kontaktprofil lokal: ein vorhandener allgemeiner Fallwechsler wird für den geschlossenen Fall nicht verwendet', async () => {
    const x = await client(); x.c.__withCaseWrite = async (_id, mutate) => mutate(); const before = clone(x.c.state);
    await x.open(other); await x.save(); assert.deepEqual(clone(x.c.state), before);
    const c = x.reload(); c.switchToCase(other); assert.equal(c.state.caseData.contactProfile.reportRemarks, 'Geprüfte synthetische Bemerkung');
  });
  await check('Kontaktprofil: verspätetes Öffnen ersetzt weder Formular noch Speicherziel eines neueren Aufrufs', async () => {
    const x = await client('online'); x.c.__onlineCaseCache.delete(other); let release;
    x.c.__dashAllCases = () => new Promise(resolve => { release = resolve; });
    const old = x.open(other); await x.open(); const before = x.element('modalBody').innerHTML;
    release([{ caseId: other, caseData: caseState(other).caseData }]); await old;
    assert.equal(x.element('modalBody').innerHTML, before); await x.save();
    assert.equal((await x.profile()).reportRemarks, 'Geprüfte synthetische Bemerkung');
  });
  await check('Kontaktprofil: fehlender verbindlicher Speicherhelfer stoppt vor der ersten Änderung', async () => {
    for (const [mode, id, helper] of [['local', fixture.caseId, 'saveState'], ['local', other, 'saveCaseRegistry'], ['online', fixture.caseId, '__onlineRealtime']]) {
      const x = await client(mode); await x.open(id); const before = clone(x.c.state); x.c[helper] = undefined;
      await assert.rejects(x.save(), /Speicher/); assert.deepEqual(clone(x.c.state), before);
      assert.equal(x.calls.length, 0); assert.equal(x.saved.length, 0);
    }
  });
  async function existingMirror(x) {
    const data = { sourceProfileId: 'contact-profile-v255', reportSummary: 'Vorher', unknown: 'erhalten' };
    const response = await request(`/api/cases/${fixture.caseId}/doku-entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
    const { id } = await response.json(); const entry = { ...data, id }; x.c.state.caseData.documentationEntries.push(entry); return entry;
  }
  await check('Kontaktprofil online: vorhandener Spiegel wird bestätigt aktualisiert; falsche PUT-Bestätigung erzeugt keinen Erfolg', async () => {
    for (const invalid of [false, true]) {
      const x = await client('online', (url, options) => invalid && options.method === 'PUT' ? Response.json({ ok: false }) : null);
      const entry = await existingMirror(x), before = await x.docs(); await x.open();
      if (invalid) { await assert.rejects(x.save(), /nicht bestätigt/); assert.deepEqual(await x.docs(), before); }
      else { await x.save(); const docs = await x.docs(); assert.equal(docs.length, before.length);
        const saved = docs.find(item => item.id === entry.id); assert.equal(saved.data.reportSummary, 'Geprüfte synthetische Bemerkung'); assert.equal(saved.data.unknown, 'erhalten'); }
      assert.equal(x.calls.filter(call => call.method === 'POST').length, 0); assert.equal(x.calls.filter(call => call.method === 'PUT').length, 1);
    }
  });
  await check('Kontaktprofil online: neueres Serverecho vor der Bestätigung bleibt ohne doppelten Spiegel erhalten', async () => {
    for (const update of [false, true]) {
      const x = await client('online', async (url, options, c) => { if (!['PUT', 'POST'].includes(options.method)) return;
        const response = await request(url, options), result = await response.clone().json();
        const entry = update ? c.state.caseData.documentationEntries.at(-1) : { ...JSON.parse(options.body).data, id: result.id };
        entry.reportSummary = 'Neuere Serveränderung'; if (!update) c.state.caseData.documentationEntries.push(entry); return response; });
      if (update) await existingMirror(x); await x.open(); await x.save();
      const list = x.c.state.caseData.documentationEntries.filter(entry => entry.sourceProfileId === 'contact-profile-v255');
      assert.equal(list.length, 1); assert.equal(list[0].reportSummary, 'Neuere Serveränderung');
    }
  });
  await check('Kontaktprofil online: fehlgeschlagener Fallwechsel darf den aktiven Fall nicht als Schreibziel verwenden', async () => {
    const x = await client('online'); x.c.__onlineCaseSync.open = async () => {}; await x.open(other); const before = clone(x.c.state);
    await assert.rejects(x.save(), /Fall.*geändert|erneut öffnen/); assert.deepEqual(clone(x.c.state), before); assert.equal(x.calls.length, 0);
  });
  await check('Kontaktprofil online: tatsächlicher Fallwechselhelfer speichert im berechtigten Zielfall und kehrt zurück', async () => {
    const x = await client('online'), id = 'sf-kontaktprofil-ziel', data = caseState(id).caseData;
    db.prepare('INSERT INTO cases (id,label,owner_user_id,stammdaten_json) VALUES (?,?,1,?)')
      .run(id, 'Synthetischer Profilzielfall', JSON.stringify({ contactProfile: data.contactProfile }));
    x.c.__onlineCaseCache.set(id, { data: { stammdaten: data } }); await x.open(id); await x.save();
    assert.equal(x.c.__activeServerCaseId, fixture.caseId); assert.equal((await x.profile()).reportRemarks, `Alt ${fixture.caseId}`);
    const saved = (await (await request(`/api/cases/${id}/stammdaten`)).json()).data;
    assert.equal(saved.contactProfile.reportRemarks, 'Geprüfte synthetische Bemerkung');
    assert.equal((await (await request(`/api/cases/${id}/doku-entries`)).json()).entries.length, 1);
  });
  await check('Kontaktprofil online: Rechteentzug zwischen Profil und Dokumentation bleibt als Teilstand sichtbar', async () => {
    const x = await client('online', (url, options) => { if (options.method === 'POST') setActor('reader'); });
    const before = await x.docs(); await x.open(); await assert.rejects(x.save(), /Profil gespeichert.*nicht bestätigt/);
    assert.equal((await x.profile()).reportRemarks, 'Geprüfte synthetische Bemerkung'); assert.deepEqual(await x.docs(), before);
    assert.ok(!x.notices.includes('zurück'));
  });
};
