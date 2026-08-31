'use strict';

/* Nebenbefund vom 24.08.2026, behoben am 25.08.: Die Server-Betreuungsuebersicht lieferte kein
   reviewDate - online fiel die gerichtliche Ueberpruefungsfrist still auf die 7-Jahres-Regel
   zurueck, waehrend die lokale Fassung (buLocalItemsFor) das Feld immer trug.
   Der Prueffall haelt beide Fassungen auf demselben Feldsatz fuer die Fristenlogik. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bu-reviewdate-'));
process.env.DB_PATH = path.join(TEMP, 'fixture.sqlite3');
process.env.DOCUMENTS_DATA_ROOT = path.join(TEMP, 'data');
for (const key of Object.keys(require.cache)) {
  if (key.includes(path.join('server', 'src'))) delete require.cache[key];
}

test('Server-Zeile traegt reviewDate - ausgefuehrt gegen die echte Route', async (t) => {
  const db = require('../src/database/index');
  const router = require('../src/modules/care-overview/routes');
  t.after(() => {
    db.close();
    for (const key of Object.keys(require.cache)) {
      if (key.includes(path.join('server', 'src'))) delete require.cache[key];
    }
    fs.rmSync(TEMP, { recursive: true, force: true });
  });

  db.prepare(`INSERT INTO users (id, username, password_hash, is_admin) VALUES (1,'pruefer','x',1)`).run();
  db.prepare('INSERT INTO cases (id, label, stammdaten_json) VALUES (?,?,?)').run(
    'fall-1', 'Muster, Martha', JSON.stringify({
      person: { lastName: 'Muster', firstName: 'Martha' },
      care: { courtName: 'AG Musterstadt', startDate: '01.02.2024', reviewDate: '15.03.2027' }
    }));

  const layer = router.stack.find((l) => l.route && l.route.path === '/' && l.route.methods.get);
  assert.ok(layer, 'Route fehlt');
  const daten = await new Promise((res) => {
    layer.route.stack[layer.route.stack.length - 1].handle(
      /* periodStart ist Pflicht - ohne ihn antwortet die Route mit 400. */
      { query: { periodStart: '2026-07-01' }, session: { userId: 1, isAdmin: true, canViewCases: true } },
      { json: res, status: () => ({ json: res }) }, () => {});
  });
  const zeile = (daten.items || daten.rows || daten.entries || []).find((r) => r.caseId === 'fall-1');
  assert.ok(zeile, 'Fallzeile fehlt in der Antwort');
  assert.equal(zeile.reviewDate, '15.03.2027', 'reviewDate fehlt weiterhin in der Server-Zeile');

  /* Feldparitaet mit der lokalen Fassung: jedes Fristen-Eingangsfeld, das buLocalItemsFor
     liefert, muss auch die Server-Zeile liefern - sonst rechnet online eine andere Frist
     als lokal, ohne dass es jemand sieht. */
  for (const feld of ['startDate', 'nextAccountingDue', 'preliminaryOrderDate', 'reviewDate']) {
    assert.ok(feld in zeile, `Fristenfeld ${feld} fehlt in der Server-Zeile`);
  }
});
