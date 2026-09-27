'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
module.exports = async function callers(t, { client, request, db, region }) {
  const raw = () => db.prepare('SELECT id,data_json FROM case_doku_entries WHERE case_id=? ORDER BY id').all(fixture.caseId);
  async function setup(kind, intercept, mode = 'online') {
    const x = await client(mode, intercept), c = x.c; x.kind = kind;
    c.testContext = { id: fixture.caseId, label: 'Synthetischer Fall' }; c.testSurface = {}; c.Q = { context: c.testContext };
    c.TR = { provider: 'Synthetisch', file: null }; c.COVQ_STATE = { key: kind, variant: '' };
    const get = c.document.getElementById; c.document.getElementById = id => id === 'covActionOverlay' ? c.testSurface : get(id);
    c.text = value => String(value ?? '').trim(); c.arr = value => Array.isArray(value) ? value : []; c.todayIso = () => '2026-09-25'; c.deDate = value => value;
    c.quickCaseCtx = () => c.testContext; c.quickValue = id => c.document.getElementById(id)?.value || '';
    c.ensureSelectedActive = async () => c.testContext; c.currentData = () => c.state.caseData;
    c.closeQuick = () => { c.testSurface = null; x.ui.push('closed'); }; c.toastSafe = c.toast; c.render = () => x.ui.push('render');
    c.refreshExternal = async () => {}; c.covqStatus = message => x.notices.push(message);
    let common = ''; try { common = region('  async function saveOverviewDocumentation(', '  async function saveTranscriptDocumentation()'); } catch (_) { /* Before-fix regression. */ }
    vm.runInContext(common + region('  async function saveTranscriptDocumentation()', '  async function quickFaehigkeiten()')
      + region('  async function saveQuickNote(value)', '  function wait(ms)')
      + 'const COVQ={' + region('    documentation:{doneLabel:', '    /* ---------- A9 Fahrt') + '};\n'
      + region('  function covqSpec(key)', '  function covqBodyHTML(')
      + region('  async function covqSave(key)', '  async function covqExtra('), c);
    for (const id of ['covq_date', 'covq_detail', 'covq_freeDetail', 'covqSave', 'covTranscriptText', 'covTranscriptTitle', 'covTranscriptAttachOriginal', 'covQuickNote']) x.element(id);
    x.element('covq_freeDetail').value = x.element('covTranscriptText').value = x.element('covQuickNote').value = 'Ursprünglicher Text';
    x.element('covTranscriptTitle').value = 'Synthetisches Transkript';
    x.value = value => { x.element(kind === 'transcript' ? 'covTranscriptText' : kind === 'note' ? 'covQuickNote' : 'covq_freeDetail').value = value; };
    x.run = () => kind === 'transcript' ? c.saveTranscriptDocumentation() : kind === 'note' ? c.saveQuickNote() : c.covqSave(kind);
    return x;
  }
  await t.test('Dokumentationsaufrufer: Schnelldialog, Transkript und Schnellnotiz bestätigen genau einen gespeicherten Eintrag', async () => {
    for (const kind of ['documentation', 'transcript', 'note']) {
      const x = await setup(kind), before = raw().length; await x.run();
      assert.equal(raw().length, before + 1); assert.equal(x.calls.length, 1); assert.equal(x.ui.filter(s => s === 'closed').length, 1);
      const id = x.c.state.caseData.documentationEntries[0].id; assert.equal(JSON.parse(raw().find(r => r.id === id).data_json).freeDetail, 'Ursprünglicher Text');
    }
  });
  await t.test('Dokumentationsaufrufer: eine verspätete Antwort schließt kein neueres Dialogfenster', async () => {
    for (const kind of ['documentation', 'transcript', 'note']) {
      let newer;
      const x = await setup(kind, async (url, options, c) => { const response = await request(url, options); newer = c.testSurface = {}; return response; });
      await x.run(); assert.equal(x.c.testSurface, newer); assert.ok(!x.ui.includes('closed'));
    }
  });
  await t.test('Dokumentationsaufrufer: weitere Texteingaben bleiben offen und werden nicht als neuer Eintrag erneut gesendet', async () => {
    for (const kind of ['documentation', 'transcript', 'note']) {
      let x; x = await setup(kind, async (url, options) => { const response = await request(url, options); x.value('Später weitergeschrieben'); return response; });
      const surface = x.c.testSurface, before = raw().length; await x.run(); assert.equal(x.c.testSurface, surface); assert.ok(!x.ui.includes('closed'));
      await x.run(); assert.equal(x.calls.length, 1); assert.equal(raw().length, before + 1);
    }
  });
  await t.test('Dokumentationsaufrufer: unbestätigter Commit bleibt bis zum Bestandsabgleich gegen Wiederholung gesperrt', async () => {
    for (const kind of ['documentation', 'transcript', 'note']) {
      const x = await setup(kind, async (url, options) => { const response = await request(url, options); assert.equal(response.status, 201); throw new Error('Antwort verloren'); });
      const before = raw().length; await x.run(); await x.run(); assert.equal(x.calls.length, 1); assert.equal(raw().length, before + 1); assert.ok(!x.ui.includes('closed'));
    }
  });
  await t.test('Dokumentationsaufrufer: paralleles Absenden führt zu einem Schreibauftrag und einer Erfolgsmeldung', async () => {
    for (const kind of ['documentation', 'transcript', 'note']) {
      let release, enter; const gate = new Promise(r => { release = r; }), reached = new Promise(r => { enter = r; });
      const x = await setup(kind, async () => { enter(); await gate; }), first = x.run(); let second;
      try { await reached; second = x.run(); } finally { release(); await first; await second; }
      assert.equal(x.calls.length, 1); assert.equal(x.ui.filter(s => s === 'closed').length, 1);
    }
  });
  await t.test('Dokumentationsaufrufer: geänderte Fallauswahl nach Commit bleibt im geöffneten Formular erhalten', async () => {
    const x = await setup('documentation', async (url, options, c) => { const response = await request(url, options); c.testContext = { id: 'sf-doku-ziel', label: 'Anderer Fall' }; return response; });
    const before = (await x.docs('sf-doku-ziel')).length; await x.run(); assert.ok(x.c.testSurface); assert.ok(!x.ui.includes('closed')); assert.equal((await x.docs('sf-doku-ziel')).length, before);
  });
  await t.test('Dokumentationsaufrufer: ungültige Eingaben lösen keine Speicherung aus', async () => {
    for (const kind of ['documentation', 'transcript', 'note']) { const x = await setup(kind); x.value(''); await x.run(); assert.equal(x.calls.length, 0); assert.ok(x.c.testSurface); }
  });
  await t.test('Dokumentationsaufrufer: lokale Speicherfehler bleiben wiederholbar und erhalten den gespeicherten Bestand', async () => {
    const x = await setup('note', null, 'local'), slot = [...x.storage].find(([, v]) => !Array.isArray(JSON.parse(v)))[0], before = [...x.storage];
    x.fail(slot); await x.run(); assert.deepEqual([...x.storage], before); assert.equal(x.c.state.caseData.documentationEntries.length, 0);
    x.fail(null); await x.run(); assert.equal(JSON.parse(x.storage.get(slot)).caseData.documentationEntries.length, 1);
  });
  await t.test('Dokumentationsaufrufer: Nachladefehler nach bestätigtem Schreiben erlaubt keine doppelte Speicherung', async () => {
    const x = await setup('documentation'); x.c.refreshExternal = async () => { throw new Error('Anzeige nicht nachgeladen'); };
    const before = raw().length; await x.run(); await x.run(); assert.equal(raw().length, before + 1); assert.equal(x.calls.length, 1);
  });
  const bytes = Buffer.from('%PDF-1.4\nSynthetischer Dialogtest\n%%EOF');
  const file = () => new File([bytes], 'Dialogtest.pdf', { type: 'application/pdf' });
  function fileAdapter(x) {
    x.c.FileReader = class { readAsDataURL(f) { f.arrayBuffer().then(b => { this.result = `data:${f.type};base64,${Buffer.from(b).toString('base64')}`; this.onload(); }); } };
    x.c.dokuBuildPhotoFilenameV166 = f => f.name;
  }
  await t.test('Anlagendialog: tatsächliche Datei wird bestätigt gespeichert und bytegleich heruntergeladen', async () => {
    const x = await setup('attachment'); fileAdapter(x); x.element('covq_files').files = [file()]; await x.run();
    assert.ok(x.ui.includes('closed')); const entry = x.c.state.caseData.documentationEntries[0];
    const response = await request(`/api/cases/${fixture.caseId}/doku-entries/${entry.id}/photos/${entry.photos[0].id}`);
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  });
  await t.test('Anlagendialog: ausgetauschte Datei gleichen Namens bleibt nach alter Antwort sichtbar', async () => {
    let x, newer;
    x = await setup('attachment', async (url, options) => { const response = await request(url, options); if (url.endsWith('/photos')) x.element('covq_files').files = [newer = file()]; return response; });
    fileAdapter(x); x.element('covq_files').files = [file()]; await x.run(); assert.ok(!x.ui.includes('closed'));
    assert.equal(x.element('covq_files').files[0], newer); await x.run(); assert.equal(x.calls.length, 2);
  });
  await t.test('Transkriptdialog: fehlgeschlagene Originalanlage erzeugt beim nächsten Klick keinen zweiten Eintrag', async () => {
    const x = await setup('transcript', url => url.endsWith('/photos') ? Response.json({ error: 'Uploadfehler' }, { status: 500 }) : null);
    fileAdapter(x); x.c.TR.file = file(); x.element('covTranscriptAttachOriginal').checked = true; const before = raw().length;
    await x.run(); await x.run(); assert.equal(raw().length, before + 1); assert.equal(x.calls.length, 2); assert.ok(!x.ui.includes('closed'));
  });
  await t.test('Dokumentationsdialog: verschwundene Auswahl fällt nicht auf den früheren Fall zurück', async () => {
    const x = await setup('documentation'); x.c.caseContexts = () => []; x.element('covActionCase').value = 'nicht-mehr-vorhanden';
    vm.runInContext(region('  function quickCaseCtx()', '  function quickCaseChanged()'), x.c);
    await x.run(); assert.equal(x.calls.length, 0); assert.ok(x.c.testSurface);
  });
};
