'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
const html = fs.readFileSync(path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
const match = html.match(/<script id="kontaktmonitor-script-v1">([\s\S]*?)<\/script>/);
assert.ok(match);
const script = new vm.Script(match[1], { filename: 'kontaktmonitor-script-v1.js' });

module.exports = async function kontaktmonitorUi(t, { prepare, request, raw, stored, setActor }) {
  const route = '/api/office-json/kontaktmonitor';
  const dokuRoute = `/api/cases/${fixture.caseId}/doku-entries`;
  const documentation = async () => (await (await request(dokuRoute)).json()).entries;
  const pendingRequests = [];
  async function check(name, run) {
    await t.test(name, async () => {
      try { await run(); }
      finally { await Promise.allSettled(pendingRequests.splice(0)); }
    });
  }
  function client(intercept = () => null, mode = 'online') {
    const calls = [], notices = [];
    let saves = 0;
    // Full module; only DOM, background timers and notifications are adapters.
    const context = { __appMode: mode, __activeServerCaseId: fixture.caseId,
      state: { caseData: { documentationEntries: [] } }, saveState: () => saves++,
      saveBueroLocal() {},
      setTimeout() {}, setInterval() {}, addEventListener() {},
      document: { getElementById: () => null, querySelectorAll: () => [] }, toast: text => notices.push(text),
      fetch: (url, options = {}) => {
        calls.push({ url, method: options.method || 'GET' });
        const pending = (async () => await intercept(url, options) || request(url, options))();
        pendingRequests.push(pending); pending.catch(() => {});
        return pending;
      } };
    context.window = context; vm.createContext(context); script.runInContext(context);
    return { calls, notices, context, saves: () => saves,
      log: () => context.__kmLogContact(fixture.caseId, 'Synthetischer Kontaktfall', '2026-09-22', 'Hausbesuch', 'Synthetische Notiz'),
      setTurnus: () => context.__kmSetTurnus(fixture.caseId, '45') };
  }

  await check('Kontaktmonitor-Oberfläche: fehlgeschlagenes Laden erzeugt keinen leeren Ersatzbestand beim Speichern', async () => {
    const responses = [
      () => new Response('{"error":"Synthetischer Fehler"}', { status: 500 }),
      () => new Response('<html>Anmeldung</html>', { status: 200 }),
      () => Response.json({ data: { entries: {} } }),
      () => Response.json({ data: null }),
      () => { throw new Error('Synthetischer Verbindungsabbruch'); }
    ];
    for (const response of responses) {
      prepare(); const before = raw();
      const c = client((url, options) => url === route && !options.method ? response() : null);
      await assert.rejects(c.setTurnus(), /Kontaktmonitor/);
      assert.equal(c.calls.filter(call => call.method !== 'GET').length, 0);
      assert.equal(raw(), before); assert.ok(c.notices.some(text => /nicht geladen/.test(text)));
    }
  });

  await check('Kontaktmonitor-Oberfläche: HTML oder unbestätigtes JSON beim Schreiben wird nicht als Erfolg gewertet', async () => {
    for (const response of [() => new Response('<html>Anmeldung</html>'), () => Response.json({}), () => Response.json({ ok: false })]) {
      prepare(); const before = raw();
      const c = client((url, options) => url === route && options.method === 'PUT' ? response() : null);
      await assert.rejects(c.setTurnus(), /Kontaktmonitor/);
      assert.equal(raw(), before); assert.ok(c.notices.some(text => /nicht gespeichert/.test(text)));
    }
  });

  await check('Kontaktmonitor-Oberfläche: echte Änderung über den vollständigen Modulblock bleibt nach Neuladen erhalten', async () => {
    prepare(); const before = stored(); const c = client(); await c.setTurnus();
    const after = stored(); assert.equal(after.entries[0].turnusDays, 45);
    assert.deepEqual(after.entries.slice(1), before.entries.slice(1));
    assert.deepEqual(after.entries[0].unknown, before.entries[0].unknown);
    assert.deepEqual(after.legacySettings, before.legacySettings);
    const response = await request(route); assert.equal(response.status, 200);
    assert.equal((await response.json()).data.entries[0].turnusDays, 45);
    assert.equal(c.notices.length, 0);
  });

  await check('Kontakterfassung: abgewiesene oder unlesbare Dokumentationsantwort meldet den Teilstand ohne lokalen Scheineintrag', async () => {
    for (const response of [() => new Response('', { status: 500 }), () => new Response('<html>Anmeldung</html>'),
      () => Response.json({}), () => Response.json({ id: '' }), () => Response.json({ id: 1 }),
      () => { throw new Error('Synthetischer Verbindungsabbruch'); }]) {
      prepare(); const before = await documentation();
      const c = client(url => url === dokuRoute ? response() : null);
      await assert.rejects(c.log(), /Kontaktmonitor gespeichert.*Betreuungsverlauf.*nicht bestätigt/);
      assert.equal(stored().entries[0].lastContact, '2026-09-22');
      assert.deepEqual(await documentation(), before);
      assert.equal(c.context.state.caseData.documentationEntries.length, 0); assert.equal(c.saves(), 0);
      assert.ok(c.notices.some(text => /vor einer erneuten Erfassung prüfen/.test(text)));
      assert.ok(!c.notices.some(text => /im Betreuungsverlauf gespeichert/.test(text)));
    }
  });

  await check('Kontakterfassung: Erfolg und lokaler Eintrag warten auf die tatsächliche Dokumentationsantwort', async () => {
    prepare(); let entered, release, finished = false;
    const reached = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const c = client(async url => { if (url === dokuRoute) { entered(); await gate; } });
    const pending = c.log().finally(() => { finished = true; });
    try {
      await reached; await new Promise(resolve => setImmediate(resolve));
      assert.equal(finished, false); assert.equal(c.context.state.caseData.documentationEntries.length, 0);
      assert.equal(c.notices.length, 0);
    } finally { release(); await pending; }
    const saved = (await documentation()).at(-1), local = c.context.state.caseData.documentationEntries;
    assert.equal(local.length, 1); assert.equal(local[0].id, saved.id);
    assert.equal(local[0].__pendingEcho, undefined); assert.equal(saved.data.source, 'kontaktmonitor');
    assert.match(saved.data.freeDetail, /Synthetische Notiz/); assert.equal(c.saves(), 1);
    assert.ok(c.notices.some(text => /im Betreuungsverlauf gespeichert/.test(text)));
  });

  await check('Kontakterfassung: Rechteentzug zwischen Kontaktmonitor und Dokumentation bleibt als Teilerfolg sichtbar', async () => {
    prepare(); const before = await documentation();
    const c = client(url => { if (url === dokuRoute) setActor('reader'); });
    await assert.rejects(c.log(), /Betreuungsverlauf.*nicht bestätigt/);
    assert.equal(stored().entries[0].lastContact, '2026-09-22');
    assert.deepEqual(await documentation(), before); assert.equal(c.context.state.caseData.documentationEntries.length, 0);
  });

  await check('Kontakterfassung: verlorene Antwort nach echtem Commit führt zu keiner automatischen Wiederholung', async () => {
    prepare(); const before = await documentation();
    const c = client(async (url, options) => {
      if (url !== dokuRoute) return;
      const response = await request(url, options); assert.equal(response.status, 201); await response.json();
      throw new Error('Synthetisch verlorene Antwort nach Commit');
    });
    await assert.rejects(c.log(), /Betreuungsverlauf.*nicht bestätigt/);
    assert.equal((await documentation()).length, before.length + 1);
    assert.equal(c.calls.filter(call => call.url === dokuRoute).length, 1);
    assert.equal(c.context.state.caseData.documentationEntries.length, 0);
  });

  await check('Kontakterfassung: ein vor der HTTP-Antwort eingetroffener Servereintrag wird weder verdoppelt noch überschrieben', async () => {
    prepare();
    const c = client(async (url, options) => {
      if (url !== dokuRoute) return;
      const response = await request(url, options), { id } = await response.clone().json();
      // Adapter for an already delivered WebSocket create/update, not a socket test.
      c.context.state.caseData.documentationEntries.push({ ...JSON.parse(options.body).data, id, note: 'Neuere Serveränderung' });
      return response;
    });
    await c.log(); const list = c.context.state.caseData.documentationEntries;
    assert.equal(list.length, 1); assert.equal(list[0].note, 'Neuere Serveränderung');
    assert.equal(list[0].id, (await documentation()).at(-1).id);
  });

  await check('Kontakterfassung: Fallwechsel während der Antwort fügt keinen Eintrag in den neu geöffneten Fall ein', async () => {
    prepare();
    const c = client(async (url, options) => {
      if (url !== dokuRoute) return;
      const response = await request(url, options);
      c.context.__activeServerCaseId = 'sf-kontakt-fremd';
      c.context.state = { caseData: { documentationEntries: [] } };
      return response;
    });
    await c.log(); assert.equal(c.context.state.caseData.documentationEntries.length, 0);
    assert.equal(c.saves(), 0);
  });

  await check('Kontakterfassung: paralleles Absenden desselben Falls erzeugt nur einen Schreibablauf', async () => {
    prepare(); const before = await documentation(); let entered, release, first = true;
    const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const c = client(async () => { if (first) { first = false; entered(); await gate; } });
    const pending = c.log();
    try { await reached; await assert.rejects(c.log(), /bereits gespeichert/); }
    finally { release(); await pending; }
    assert.equal(c.calls.filter(call => call.method === 'PUT').length, 1);
    assert.equal(c.calls.filter(call => call.method === 'POST').length, 1);
    assert.equal((await documentation()).length, before.length + 1);
  });

  await check('Kontakterfassung: Kontaktmonitorfehler stoppt die Spiegelung und gibt den Ablauf für eine Korrektur frei', async () => {
    for (const method of ['GET', 'PUT']) {
      prepare(); const before = raw(); let fail = true;
      const c = client((url, options) => url === route && (options.method || 'GET') === method && fail
        ? new Response('', { status: 500 }) : null);
      await assert.rejects(c.log(), /Kontaktmonitor/); assert.equal(raw(), before);
      assert.equal(c.calls.filter(call => call.url === dokuRoute).length, 0);
      fail = false; await c.log(); assert.equal(c.calls.filter(call => call.url === dokuRoute).length, 1);
    }
  });

  await check('Kontakterfassung: lokaler aktiver Fall behält den bisherigen Speicherweg ohne HTTP', async () => {
    prepare(); const c = client(() => { throw new Error('Kein HTTP im lokalen Modus'); }, 'local');
    await c.log(); assert.equal(c.calls.length, 0);
    assert.equal(c.context.bueroLocal.kontaktmonitor[0].lastContact, '2026-09-22');
    assert.equal(c.context.state.caseData.documentationEntries.length, 1); assert.equal(c.saves(), 1);
  });
};
