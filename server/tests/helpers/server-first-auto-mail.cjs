'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
module.exports = async function mail(t, { setup, request, setActor, region }) {
  let serial = 0;
  async function fresh(intercept) {
    const x = await setup('online', intercept), c = x.c;
    c.stripHtmlToText = value => String(value).replace(/<[^>]*>/g, '');
    c.jpost = async (url, data) => { const r = await c.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (!r.ok) throw Error('HTTP ' + r.status); return r.json(); };
    vm.runInContext(region('async function writeDokuEntry(caseId', '/* =============================== Konten-Verwaltung'), c);
    const sid = 'sf-auto-mail-' + (++serial);
    x.sendDocumentation = () => c.writeDokuEntry(fixture.caseId, { to: 'synthetisch@example.invalid', subject: 'Synthetische Nachricht', html: '<p>Prüftext</p>', mailMessageId: 'synthetische-mail-id', mailDispatchId: sid }, sid);
    return x;
  }
  await t.test('Mail-Dokumentation: bestätigter Aufruf führt dieselbe Zeile mit Mailzuordnung weiter', async () => {
    const x = await fresh(), before = (await x.docs()).length, first = await x.sendDocumentation(), second = await x.sendDocumentation();
    assert.ok(first?.id); assert.equal(first.id, second.id); const saved = (await x.docs()).find(e => e.id === first.id);
    assert.equal(saved.data.mailMessageId, 'synthetische-mail-id'); assert.ok(saved.data.freeDetail.includes('Prüftext')); assert.equal((await x.docs()).length, before + 1);
    assert.deepEqual(x.calls.filter(c => c.method !== 'GET').map(c => c.method), ['POST', 'PUT']);
  });
  await t.test('Mail-Dokumentation: verlorene Speicherantwort und Wiederholung erzeugen keinen zweiten POST', async () => {
    const x = await fresh(async (url, opts) => { if (!opts.method) return null; const r = await request(url, opts); assert.equal(r.status, 201); throw Error('Antwort verloren'); });
    const before = (await x.docs()).length; assert.equal(await x.sendDocumentation(), null); assert.equal(await x.sendDocumentation(), null);
    assert.equal((await x.docs()).length, before + 1); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); assert.equal(x.c.state.caseData.documentationEntries.length, 0);
  });
  await t.test('Mail-Dokumentation: gescheiterter Bestandsabruf fällt nicht auf blindes Anlegen zurück', async () => {
    const x = await fresh((_url, opts) => !opts.method ? Response.json({}, { status: 503 }) : null), before = (await x.docs()).length;
    assert.equal(await x.sendDocumentation(), null); assert.equal(x.calls.filter(c => c.method !== 'GET').length, 0); assert.equal((await x.docs()).length, before);
  });
  await t.test('Mail-Dokumentation: ungültige Bestätigung erzeugt weder Ersatzauftrag noch lokalen Eintrag', async () => {
    for (const response of [() => Response.json({}), () => Response.json({ id: 42 }), () => new Response('<html>Anmeldung</html>')]) {
      const x = await fresh((_url, opts) => opts.method ? response() : null), before = (await x.docs()).length;
      assert.equal(await x.sendDocumentation(), null); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); assert.equal((await x.docs()).length, before); assert.equal(x.c.state.caseData.documentationEntries.length, 0);
    }
  });
  await t.test('Mail-Dokumentation: fehlender gemeinsamer Speicherweg bleibt sichtbarer Fehler ohne Ersatzschreiber', async () => {
    const x = await fresh(), before = (await x.docs()).length; x.c.createAutoDokuEntry = undefined;
    assert.equal(await x.sendDocumentation(), null); assert.equal(x.calls.length, 0); assert.equal((await x.docs()).length, before); assert.ok(x.notices.length);
  });
  await t.test('Mail-Dokumentation: unerwarteter Fehler wird gemeldet und nicht als erneuter Versandfehler hochgereicht', async () => {
    const x = await fresh(); x.c.createAutoDokuEntry = async () => { throw Error('Synthetischer Dokumentationsfehler'); };
    assert.equal(await x.sendDocumentation(), null); assert.equal(x.calls.length, 0); assert.ok(x.notices.some(n => n.includes('Synthetischer Dokumentationsfehler')));
  });
  await t.test('Mail-Dokumentation: tatsächliche Schreibsperre löst keinen zweiten Schreibversuch aus', async () => {
    const x = await fresh(), before = (await x.docs()).length; setActor('reader');
    assert.equal(await x.sendDocumentation(), null); assert.equal(x.calls.filter(c => c.method === 'POST').length, 1); assert.equal((await x.docs()).length, before); assert.ok(x.notices.length);
  });
};
