'use strict';
const assert = require('node:assert/strict');
const fixture = require('../fixtures/server-first/pilot-case.json');
const clone = value => JSON.parse(JSON.stringify(value));
const other = 'sf-doku-ziel', bytes = Buffer.from('%PDF-1.4\nSynthetischer Testinhalt\n%%EOF');
const file = () => new File([bytes], 'Synthetisch.pdf', { type: 'application/pdf' });
module.exports = async function quick(t, { client, request, db, setActor }) {
  const raw = () => db.prepare('SELECT id,data_json FROM case_doku_entries WHERE case_id=? ORDER BY id').all(fixture.caseId);
  async function setup(mode = 'online', intercept) {
    const x = await client(mode, intercept);
    x.c.FileReader = class { readAsDataURL(f) { f.arrayBuffer().then(buffer => { this.result = `data:${f.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onload(); }, error => { this.error = error; this.onerror(); }); } };
    x.c.dokuBuildPhotoFilenameV166 = f => f.name; // Filename/EXIF rendering is outside this storage test.
    x.create = (opts = {}) => x.c.__dokuQuickCreateEntry({ caseId: fixture.caseId, fields: { freeDetail: 'Synthetische Schnellnotiz' }, ...opts });
    return x;
  }
  await t.test('Schnellerfassung: aktiver und geschlossener Serverfall speichern genau einen bestätigten Eintrag', async () => {
    for (const id of [fixture.caseId, other]) {
      const x = await setup(), before = (await x.docs(id)).length, result = await x.create({ caseId: id });
      const rows = await x.docs(id); assert.equal(rows.length, before + 1); assert.equal(rows.find(r => r.id === result.id).data.freeDetail, 'Synthetische Schnellnotiz');
      assert.equal(x.calls.length, 1); if (id === other) assert.equal(x.c.state.caseData.documentationEntries.length, 0);
    }
  });
  await t.test('Schnellerfassung: echte PDF-Anlage übernimmt kanonische Servermetadaten und ist bytegleich abrufbar', async () => {
    const x = await setup(), result = await x.create({ files: [file(), file()] });
    const stored = (await x.docs()).find(row => row.id === result.id).data;
    assert.deepEqual(clone(result.photos), stored.photos); assert.equal(stored.photos.length, 2);
    for (const photo of stored.photos) {
      const response = await request(`/api/cases/${fixture.caseId}/doku-entries/${result.id}/photos/${photo.id}`);
      assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
  });
  await t.test('Schnellerfassung: HTML oder fehlende Serverkennung ändern keinen lokalen Bestand', async () => {
    for (const reply of [() => new Response('<html>Login</html>'), () => Response.json({}), () => Response.json({ id: 5 })]) {
      const x = await setup('online', reply), before = raw(); await assert.rejects(x.create());
      assert.deepEqual(raw(), before); assert.equal(x.c.state.caseData.documentationEntries.length, 0);
    }
  });
  await t.test('Schnellerfassung lokal: Speicherfehler nimmt aktive und geschlossene Änderungen zurück', async () => {
    for (const id of [fixture.caseId, other]) {
      const x = await setup('local');
      // Select the actual storage slot by its serialized shape, independent of the key spelling.
      const slot = [...x.storage].find(([, value]) => Array.isArray(JSON.parse(value)) === (id === other))[0];
      x.fail(slot); const before = clone(x.c.state), registry = clone(x.c.caseRegistry), stored = [...x.storage];
      await assert.rejects(x.create({ caseId: id })); assert.deepEqual(clone(x.c.state), before); assert.deepEqual(clone(x.c.caseRegistry), registry); assert.deepEqual([...x.storage], stored);
      x.fail(null); await x.create({ caseId: id }); const loaded = JSON.parse(x.storage.get(slot));
      assert.equal((id === other ? loaded.find(r => r.id === id).state : loaded).caseData.documentationEntries.length, 1);
    }
  });
  await t.test('Schnellerfassung: unbekannte oder beschädigte Ziele lösen keinen Schreibvorgang aus', async () => {
    for (const issue of ['missing', 'list', 'duplicate']) {
      const x = await setup('local'); if (issue === 'list') x.c.state.caseData.documentationEntries = {};
      if (issue === 'duplicate') x.c.caseRegistry.push(clone(x.c.caseRegistry[1])); const stored = [...x.storage];
      await assert.rejects(x.create({ caseId: issue === 'missing' ? 'nicht-vorhanden' : issue === 'duplicate' ? other : fixture.caseId }));
      assert.equal(x.calls.length, 0); assert.deepEqual([...x.storage], stored);
    }
  });
  await t.test('Schnellerfassung: Fall- oder Moduswechsel während Dateivorbereitung wird vor dem Schreiben erkannt', async () => {
    for (const modeChange of [false, true]) {
      const x = await setup(); let changed = false; const f = file(), original = f.arrayBuffer.bind(f);
      f.arrayBuffer = async () => { if (!changed) { changed = true; if (modeChange) x.c.__appMode = 'local'; else x.c.__activeServerCaseId = other; } return original(); };
      await assert.rejects(x.create({ files: [f] })); assert.equal(x.calls.length, 0); assert.equal(x.c.state.caseData.documentationEntries.length, 0);
    }
  });
  await t.test('Schnellerfassung: frühes Serverecho erzeugt kein lokales Duplikat', async () => {
    const x = await setup('online', async (url, options, c) => { const response = await request(url, options), payload = await response.clone().json();
      c.state.caseData.documentationEntries.push({ ...JSON.parse(options.body).data, id: payload.id, freeDetail: 'Neuerer Serverstand' }); return response; });
    await x.create(); assert.equal(x.c.state.caseData.documentationEntries.length, 1); assert.equal(x.c.state.caseData.documentationEntries[0].freeDetail, 'Neuerer Serverstand');
  });
  await t.test('Schnellerfassung: verlorene Commit-Antwort liefert einen erkennbaren unbestätigten Ausgang', async () => {
    const x = await setup('online', async (url, options) => { const response = await request(url, options); assert.equal(response.status, 201); throw new Error('Antwort verloren'); });
    const before = (await x.docs()).length; await assert.rejects(x.create(), error => error.dokuUnconfirmed === true);
    assert.equal((await x.docs()).length, before + 1); assert.equal(x.c.state.caseData.documentationEntries.length, 0); assert.equal(x.calls.length, 1);
  });
  await t.test('Schnellerfassung: zweiter Anlagenfehler meldet den gespeicherten Eintrag ohne lokalen Scheinerfolg', async () => {
    let uploads = 0;
    const x = await setup('online', url => url.endsWith('/photos') && ++uploads === 2 ? Response.json({ error: 'Uploadfehler' }, { status: 500 }) : null);
    await assert.rejects(x.create({ files: [file(), file()] }), error => error.dokuUnconfirmed === true && typeof error.dokuEntryId === 'string');
    assert.equal((await x.docs()).at(-1).data.photos.length, 1); assert.equal(x.c.state.caseData.documentationEntries.length, 0);
  });
  await t.test('Schnellerfassung: paralleles Absenden wird vor einem zweiten Schreibvorgang gestoppt', async () => {
    let release, enter; const gate = new Promise(r => { release = r; }), reached = new Promise(r => { enter = r; });
    const x = await setup('online', async () => { enter(); await gate; }), first = x.create(); let second;
    try { await reached; second = x.create(); second.catch(() => {}); } finally { release(); await first; }
    await assert.rejects(second);
    assert.equal(x.calls.length, 1);
  });
  await t.test('Schnellerfassung: tatsächlicher Rechteentzug speichert weder Eintrag noch Anlage', async () => {
    const x = await setup(); const before = raw(); setActor('reader'); await assert.rejects(x.create({ files: [file()] }));
    assert.deepEqual(raw(), before); assert.equal(x.calls.length, 1); assert.equal(x.c.state.caseData.documentationEntries.length, 0);
  });
};
