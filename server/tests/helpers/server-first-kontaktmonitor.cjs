'use strict';

const assert = require('node:assert/strict');
const fixture = require('../fixtures/server-first/pilot-case.json');
const { createFieldClient } = require('./server-first-field-client.cjs');

module.exports = async function kontaktmonitor(t, { db, reset, request, setActor, ledger }) {
  const route = '/api/office-json/kontaktmonitor', foreign = 'sf-kontakt-fremd', readonly = 'sf-kontakt-lesend';
  const entries = [
    { caseId: fixture.caseId, caseLabel: 'Synthetischer eigener Fall', turnusDays: 30, lastContact: '2026-09-01', active: true, unknown: { keep: null } },
    { caseId: foreign, caseLabel: 'Synthetischer fremder Fall', turnusDays: 60, active: false },
    { caseId: readonly, caseLabel: 'Synthetische Lesefreigabe', turnusDays: 90, active: true }
  ];
  const initial = { entries, legacySettings: { keep: true } };
  const raw = () => db.prepare("SELECT data_json FROM office_json WHERE key='kontaktmonitor'").get()?.data_json;
  const stored = () => JSON.parse(raw());
  const saveRaw = value => db.prepare(`INSERT INTO office_json (key,data_json,updated_by) VALUES ('kontaktmonitor',?,1)
    ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json`).run(value);
  function prepare() {
    reset();
    for (const id of [foreign, readonly]) {
      db.prepare(`INSERT INTO cases (id,label,owner_user_id,stammdaten_json) VALUES (?,?,2,'{}')
        ON CONFLICT(id) DO UPDATE SET owner_user_id=2`).run(id, 'Synthetischer Kontaktmonitorfall');
    }
    db.prepare('INSERT OR REPLACE INTO case_access (case_id,user_id,level) VALUES (?,1,?)').run(readonly, 'read');
    saveRaw(JSON.stringify(initial));
  }
  async function load() {
    const response = await request(route); assert.equal(response.status, 200);
    return (await response.json()).data;
  }
  const put = data => request(route, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data }) });
  const client = () => createFieldClient({ caseEntries: [], request,
    officeReader: async () => ({ kontaktmonitor: (await load()).entries }) });

  await t.test('Kontaktmonitor: Speichern einer gefilterten Liste erhält fremde Fälle und unbekannte Bürometadaten', async () => {
    prepare(); const visible = await load();
    assert.deepEqual(visible.entries.map(e => e.caseId), [fixture.caseId, readonly]);
    visible.entries[0].turnusDays = 45;
    assert.equal((await put({ entries: visible.entries })).status, 200);
    const expected = structuredClone(initial); expected.entries[0].turnusDays = 45;
    assert.deepEqual(stored(), expected);
    assert.equal((await load()).entries[0].turnusDays, 45);
  });

  await t.test('Kontaktmonitor: eigene Löschung bewahrt unsichtbare und nur lesbare Einträge', async () => {
    prepare(); assert.equal((await put({ entries: [] })).status, 200);
    assert.deepEqual(stored(), { ...initial, entries: entries.slice(1) });
  });

  await t.test('Kontaktmonitor: fremde, nur lesbare und nachträglich entzogene Fallrechte verhindern Änderungen', async () => {
    for (const id of [foreign, readonly, fixture.caseId]) {
      prepare(); const before = raw();
      if (id === fixture.caseId) setActor('reader');
      const proposed = structuredClone(entries.find(e => e.caseId === id)); proposed.turnusDays = 7;
      assert.equal((await put({ entries: [proposed] })).status, 403, id); assert.equal(raw(), before);
    }
    prepare(); const before = raw();
    assert.equal((await put({ entries: [{ caseId: 'sf-kontakt-fehlt', turnusDays: 7 }] })).status, 403);
    assert.equal(raw(), before);
  });

  await t.test('Kontaktmonitor: ungültige oder mehrdeutige Eingabe überschreibt keinen Bestand', async () => {
    for (const data of [null, [], {}, { entries: null }, { entries: [null] },
      { entries: [{ turnusDays: 7 }] }, { entries: [entries[0], entries[0]] }]) {
      prepare(); const before = raw();
      assert.equal((await put(data)).status, 400, JSON.stringify(data)); assert.equal(raw(), before);
    }
    for (const broken of ['{', 'null', '[]', '{"entries":{}}']) {
      prepare(); saveRaw(broken);
      assert.equal((await put({ entries: [entries[0]] })).status, 409); assert.equal(raw(), broken);
    }
  });

  await t.test('Kontaktmonitor: bestehende Eintragskennung lässt sich nicht von fremdem auf eigenen Fall umhängen', async () => {
    prepare(); const data = structuredClone(initial); data.entries[1].id = 'sf-fremde-kontakt-id'; saveRaw(JSON.stringify(data));
    const before = raw();
    assert.equal((await put({ entries: [{ ...data.entries[1], caseId: fixture.caseId }] })).status, 403);
    assert.equal(raw(), before);
  });

  await t.test('Außendienst-Kontaktmonitor: Rückgabe und Wiederholung erhalten fremde Einträge und gespeicherte Fachwerte', async () => {
    prepare(); const before = { kontaktmonitor: (await load()).entries }, offline = structuredClone(before);
    offline.kontaktmonitor[0].lastContact = '2026-09-22';
    const c = client(), packet = await c.loadCases([{ caseId: '__buero', before, offline }]);
    await c.apply(); assert.equal(c.errors.length, 0); assert.equal(c.successes.length, 1);
    const saved = stored();
    assert.equal(saved.entries.find(e => e.caseId === fixture.caseId).lastContact, '2026-09-22');
    assert.deepEqual(saved.entries.find(e => e.caseId === foreign), entries[1]);
    assert.deepEqual(saved.entries.find(e => e.caseId === readonly), entries[2]);
    assert.deepEqual(saved.legacySettings, initial.legacySettings);
    const again = client(); await again.importText(packet); await again.apply();
    assert.equal(again.calls.filter(call => call.url === route && call.method === 'PUT').length, 0);
    assert.deepEqual(stored(), saved);
  });

  await t.test('Außendienst-Kontaktmonitor: Entzug nach Vorschau speichert weder Fachwerte noch angewendetes Protokoll', async () => {
    prepare(); const before = { kontaktmonitor: (await load()).entries }, offline = structuredClone(before);
    offline.kontaktmonitor[0].lastContact = '2026-09-22';
    const c = client(); await c.loadCases([{ caseId: '__buero', before, offline }]);
    const original = raw(); setActor('reader'); await c.apply();
    assert.equal(c.successes.length, 0); assert.match(c.message, /Schreiben fehlgeschlagen/);
    assert.equal(raw(), original); assert.equal(Object.keys(ledger().applied || {}).length, 0);
  });

  const { callTool } = require('../../src/integrations/mcp/tools');
  await require('./server-first-kontaktmonitor-ui.cjs')(t, { prepare, request, raw, stored, setActor });
  await require('./server-first-kontaktmonitor-local.cjs')(t);
  await require('./server-first-kontaktmonitor-read.cjs')(t, { prepare, request, raw });
  await require('./server-first-kontaktmonitor-consumers.cjs')(t, { prepare, request, raw });
  await require('./server-first-kontaktmonitor-reports.cjs')(t);
  await require('./server-first-report-sync.cjs')(t);
  await require('./server-first-contact-profile.cjs')(t, { prepare, request, setActor, db });
  await require('./server-first-doku-editor.cjs')(t, { prepare, request, setActor, db });
  const session = { userId: 1, canUseAi: true, canViewCases: true, canEditCases: true };
  const call = (name, args, actor = session) => callTool(actor, null, ['bb.read', 'bb.propose'], name, args || {});
  const propose = () => call('bb_vorschlagen', { kind: 'kontaktmonitor_kontakt', fall: fixture.caseId,
    zeilen: [{ lastContact: '2026-09-22', lastArt: 'Synthetischer Hausbesuch' }] });

  await t.test('MCP-Kontaktmonitor: Leserecht und sichtbare Fälle gelten auch für den KI-Kanal', async () => {
    prepare(); const result = await call('bb_kontaktmonitor');
    assert.deepEqual(result.stand.entries.map(entry => entry.caseId), [fixture.caseId, readonly]);
    await assert.rejects(call('bb_kontaktmonitor', {}, { ...session, canViewCases: false }), /Berechtigung/);
    await assert.rejects(call('bb_kontaktmonitor', {}, { ...session, canUseAi: false }), /KI-Fernzugriff/);
    assert.deepEqual(stored(), initial);
  });

  await t.test('MCP-Kontaktmonitor: beschädigter Bestand wird beim bestätigten Vorschlag nicht durch einen leeren ersetzt', async () => {
    for (const broken of ['{', 'null', '{"entries":{}}']) {
      prepare(); saveRaw(broken); const proposal = await propose();
      await assert.rejects(call('bb_vorschlag_uebernehmen', { vorschlagId: proposal.vorschlagId }), /Kontaktmonitor/);
      assert.equal(raw(), broken);
      assert.notEqual(db.prepare('SELECT status FROM mcp_proposals WHERE id=?').get(proposal.vorschlagId).status, 'uebernommen');
    }
  });

  await t.test('MCP-Kontaktmonitor: berechtigter Vorschlag erhält übrige Daten; Wiederholung und Rechteentzug werden abgewiesen', async () => {
    prepare(); const proposal = await propose();
    await call('bb_vorschlag_uebernehmen', { vorschlagId: proposal.vorschlagId });
    const saved = stored(); assert.equal(saved.entries[0].lastContact, '2026-09-22');
    assert.deepEqual(saved.entries.slice(1), initial.entries.slice(1));
    assert.deepEqual(saved.entries[0].unknown, initial.entries[0].unknown);
    assert.deepEqual(saved.legacySettings, initial.legacySettings);
    await assert.rejects(call('bb_vorschlag_uebernehmen', { vorschlagId: proposal.vorschlagId }));
    assert.deepEqual(stored(), saved);
    prepare(); const pending = await propose();
    db.prepare('UPDATE cases SET owner_user_id=2 WHERE id=?').run(fixture.caseId);
    await assert.rejects(call('bb_vorschlag_uebernehmen', { vorschlagId: pending.vorschlagId }), /Bearbeitungsrecht/);
    assert.deepEqual(stored(), initial);
  });
};
