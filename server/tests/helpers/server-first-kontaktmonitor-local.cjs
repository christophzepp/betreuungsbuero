'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
function between(start, end) {
  const from = html.indexOf(start), to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return html.slice(from, to);
}
const registry = between("  const REGISTRY_STORAGE_KEY_V161=", '  /* Nach jedem erfolgreichen Stammdaten-/Adressverzeichnis-Import');
const office = between("const BUERO_LOCAL_KEY=", 'function newLocalId()');
const stateSave = between('function stateForBrowserStorage(){', 'function loadState(){');
const caseProvider = between('  window.__dashAllCases=async function(', '  /* ECHTER BUG (Nutzerreport:');
const monitor = between('<script id="kontaktmonitor-script-v1">', '</script>').replace('<script id="kontaktmonitor-script-v1">', '');
const stateKey = /const STORAGE_KEY='([^']+)'/.exec(html)[1];
const registryKey = /REGISTRY_STORAGE_KEY_V161='([^']+)'/.exec(registry)[1];
const officeKey = /BUERO_LOCAL_KEY='([^']+)'/.exec(office)[1];
const clone = value => JSON.parse(JSON.stringify(value));
const caseState = id => ({ ui: { caseLoaded: true, localCaseId: id },
  caseData: { person: { firstName: 'Synthetisch', lastName: id }, unknown: { keep: null },
    documentationEntries: [{ id: `alt-${id}`, note: 'Bestehender Eintrag', unknown: false }] } });

function environment() {
  const storage = new Map([[stateKey, JSON.stringify(caseState('local-a'))],
    [registryKey, JSON.stringify(['local-a', 'local-b'].map(id => ({ id, label: id, state: caseState(id), unknown: 0 })))],
    [officeKey, JSON.stringify({ kontaktmonitor: [{ caseId: 'local-a', turnusDays: 30, unknown: false },
      { caseId: 'local-b', turnusDays: 60, unknown: { keep: null } }], officeProfile: { companyName: 'Synthetisches Büro' } })]]);
  const writes = []; let failKey;
  function reload() {
    const notices = [];
    const context = { __appMode: 'local', state: JSON.parse(storage.get(stateKey)), crypto,
      console: { warn() {} }, toast: text => notices.push(text), alert: text => notices.push(text),
      updateNavStatus() {}, setTimeout() {}, setInterval() {}, addEventListener() {},
      document: { getElementById: () => null, querySelectorAll: () => [] },
      fetch: () => { throw new Error('Unerwarteter HTTP-Aufruf im lokalen Prüfstand'); },
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => {
        writes.push(key); if (key === failKey) throw new Error('Synthetische Speicherquote erreicht');
        storage.set(key, value);
      } } };
    context.window = context; vm.createContext(context);
    // Actual unchanged source regions: storage/load/switch functions plus the complete monitor.
    new vm.Script(`const STORAGE_KEY=${JSON.stringify(stateKey)};\n${stateSave}\n(function(){${registry}})();\n(function(){${office}})();\n${caseProvider}\n${monitor}`)
      .runInContext(context);
    return { context, notices, log: (id = 'local-b') => context.__kmLogContact(id, 'Synthetischer Fall', '2026-09-22', 'Hausbesuch', 'Notiz bleibt erhalten') };
  }
  return { storage, writes, reload, fail: key => { failKey = key; } };
}

module.exports = async function kontaktmonitorLocal(t) {
  await t.test('Lokale Fallübersicht: Kontakterfassung verwendet die tatsächliche Kennung des geöffneten Falls', async () => {
    const env = environment(), c = env.reload();
    for (const id of ['local-a', 'local-b']) {
      if (id === 'local-b') c.context.switchToCase(id);
      const cases = await c.context.__dashAllCases();
      assert.equal(cases.length, 1); assert.equal(cases[0].caseId, id);
      await c.log(cases[0].caseId);
      assert.equal(env.reload().context.state.caseData.documentationEntries.length, 2);
    }
  });

  await t.test('Lokale Kontakterfassung: geschlossener Fall erhält Verlauf und Notiz über Neuladen und echten Fallwechsel', async () => {
    const env = environment(), c = env.reload(), before = clone(c.context.state);
    await c.log(); assert.deepEqual(clone(c.context.state), before);
    const reopened = env.reload(); assert.equal(reopened.context.switchToCase('local-b'), true);
    const data = reopened.context.state.caseData, list = data.documentationEntries;
    assert.equal(list.length, 2); assert.deepEqual(clone(list[0]), caseState('local-b').caseData.documentationEntries[0]);
    assert.match(list[1].freeDetail, /Notiz bleibt erhalten/); assert.equal(list[1].source, 'kontaktmonitor');
    assert.equal(list[1].occurredAt, '2026-09-22'); assert.ok(list[1].id);
    assert.deepEqual(clone(data.unknown), { keep: null });
    assert.deepEqual(clone(reopened.context.bueroLocal.kontaktmonitor[1].unknown), { keep: null });
    assert.equal(reopened.context.bueroLocal.officeProfile.companyName, 'Synthetisches Büro');
    const summary = reopened.context.__kmContactsSummary(list);
    assert.equal(summary.anzahlImZeitraum, 1); assert.match(summary.kontakteImZeitraum[0].notiz, /Notiz bleibt erhalten/);
    assert.ok(c.notices.some(text => /im Betreuungsverlauf gespeichert/.test(text)));
  });

  await t.test('Lokale Kontakterfassung: fehlender oder mehrdeutiger Zielfall schreibt keine Bürodaten', async () => {
    for (const duplicate of [false, true]) {
      const env = environment(), c = env.reload(), before = [...env.storage];
      if (duplicate) c.context.caseRegistry.push(clone(c.context.caseRegistry[1]));
      await assert.rejects(c.log(duplicate ? 'local-b' : 'local-fehlt'), /Fall.*nicht eindeutig/);
      assert.deepEqual([...env.storage], before); assert.equal(env.writes.length, 0);
      assert.ok(!c.notices.some(text => /beim nächsten Öffnen/.test(text)));
    }
  });

  await t.test('Lokale Kontakterfassung: beschädigter Dokumentationsbestand wird nicht ersetzt', async () => {
    for (const id of ['local-a', 'local-b']) for (const bad of [null, {}, 'beschädigt']) {
      const env = environment(), c = env.reload(), before = [...env.storage];
      const target = id === 'local-a' ? c.context.state : c.context.caseRegistry[1].state;
      target.caseData.documentationEntries = bad;
      await assert.rejects(c.log(id), /Betreuungsverlauf.*ungültig/);
      assert.deepEqual(clone(target.caseData.documentationEntries), bad);
      assert.deepEqual([...env.storage], before); assert.equal(env.writes.length, 0);
    }
  });

  await t.test('Lokale Kontakterfassung: voller Bürospeicher stoppt die Dokumentation und erhält den Arbeitsspeicher', async () => {
    const env = environment(), c = env.reload(), before = [...env.storage], inMemory = clone(c.context.bueroLocal);
    env.fail(officeKey); await assert.rejects(c.log(), /Kontaktmonitor konnte nicht gespeichert/);
    assert.deepEqual([...env.storage], before); assert.deepEqual(clone(c.context.bueroLocal), inMemory);
    assert.deepEqual(env.writes, [officeKey]);
    env.fail(null); await c.log();
    assert.equal(env.reload().context.caseRegistry[1].state.caseData.documentationEntries.length, 2);
  });

  await t.test('Lokale Kontakterfassung: Fehler beim aktiven oder geschlossenen Fall meldet Teilstand und entfernt den Scheineintrag', async () => {
    for (const [id, key] of [['local-a', stateKey], ['local-b', registryKey]]) {
      const env = environment(), c = env.reload(), before = env.storage.get(key);
      const target = id === 'local-a' ? c.context.state : c.context.caseRegistry[1].state;
      const original = clone(target.caseData.documentationEntries);
      env.fail(key); await assert.rejects(c.log(id), /Kontaktmonitor gespeichert.*Betreuungsverlauf.*nicht bestätigt/);
      assert.equal(env.storage.get(key), before); assert.deepEqual(clone(target.caseData.documentationEntries), original);
      assert.equal(JSON.parse(env.storage.get(officeKey)).kontaktmonitor.find(e => e.caseId === id).lastContact, '2026-09-22');
      assert.ok(!c.notices.some(text => /im Betreuungsverlauf gespeichert/.test(text)));
      env.fail(null); await c.log(id);
      const reopened = env.reload();
      if (id === 'local-b') reopened.context.switchToCase(id);
      assert.equal(reopened.context.state.caseData.documentationEntries.length, 2);
    }
  });

  await t.test('Lokaler Kontaktmonitor: Turnusänderung bei Speicherfehler verändert weder gespeicherte noch geladene Werte', async () => {
    const env = environment(), c = env.reload(), before = [...env.storage], inMemory = clone(c.context.bueroLocal);
    env.fail(officeKey);
    await assert.rejects(c.context.__kmSetTurnus('local-b', '45'), /Kontaktmonitor konnte nicht gespeichert/);
    assert.deepEqual([...env.storage], before); assert.deepEqual(clone(c.context.bueroLocal), inMemory);
    env.fail(null); await c.context.__kmSetTurnus('local-b', '45');
    assert.equal(env.reload().context.bueroLocal.kontaktmonitor[1].turnusDays, 45);
  });

  await t.test('Lokale Kontakterfassung: fehlender Fall-Speicherhelfer führt vor dem ersten Schreibzugriff zum Fehler', async () => {
    for (const [id, helper] of [['local-a', 'saveState'], ['local-b', 'saveCaseRegistry']]) {
      const env = environment(), c = env.reload(); c.context[helper] = undefined;
      await assert.rejects(c.log(id), /Speicherfunktion.*nicht verfügbar/);
      assert.equal(env.writes.length, 0);
    }
  });
};
