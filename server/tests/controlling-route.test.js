'use strict';

/*
 * Vertragstest fuer /api/controlling (25.08.2026).
 *
 * Geprueft wird das, was am Controlling-Reiter schiefgehen kann, ohne dass es jemand merkt:
 *   - das neue Recht viewControlling ist AUS, solange es niemand vergibt (Admin ausgenommen),
 *   - die Fallsichtbarkeit gilt auch hier, und die Antwort sagt ehrlich, dass sie gegriffen hat,
 *   - der Server liefert die vier Verguetungsdimensionen, aber KEINE Euro und kein stammdaten_json.
 *
 * Aufbau wie load-bundles.test.js: eigene SQLite-Fixture, kurzlebige Express-Instanz auf
 * listen(0), Anmeldung ueber die echte Auth-Route. Keine Produktivdatenbank, kein fester Port.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Controlling: Recht, Fallsichtbarkeit und Nutzlast', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'controlling-route-'));
  process.env.DB_PATH = path.join(temp, 'fixture.sqlite3');
  process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
  process.env.SESSION_SECRET = 'controlling-test-session-secret-with-enough-entropy';
  process.env.ENCRYPTION_KEY = '11'.repeat(32);
  fs.mkdirSync(process.env.DOCUMENTS_DATA_ROOT, { recursive: true });

  const express = require('express');
  const bcrypt = require('bcrypt');
  const db = require('../src/database/index');
  const { serializePermissions, PERMISSION_DEFS } = require('../src/middleware/authorization');
  const { createSessionMiddleware, requireOnlineMode } = require('../src/middleware/authentication');
  const authRoutes = require('../src/modules/auth/routes');
  const controllingRoutes = require('../src/modules/controlling/routes');

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  assert.equal(PERMISSION_DEFS.viewControlling.default, false,
    'viewControlling muss ein ausdruecklich zu vergebendes Recht bleiben');
  assert.equal(PERMISSION_DEFS.viewControlling.legacy, null,
    'viewControlling ist neu und hat keine Altspalte');

  const passwordHash = await bcrypt.hash('test-passwort', 4);
  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, allow_local, allow_online, is_admin, permissions_json)
    VALUES (@id, @username, @passwordHash, @displayName, 1, 1, @isAdmin, @permissionsJson)
  `);
  const rechte = (overrides) => serializePermissions({
    local: {},
    online: { viewAllCases: false, viewControlling: false, ...overrides }
  }, null);

  insertUser.run({ id: 1, username: 'admin', passwordHash, displayName: 'Admin', isAdmin: 1, permissionsJson: rechte({}) });
  insertUser.run({ id: 2, username: 'controller', passwordHash, displayName: 'Controller', isAdmin: 0, permissionsJson: rechte({ viewControlling: true }) });
  insertUser.run({ id: 3, username: 'ohne-recht', passwordHash, displayName: 'Ohne Recht', isAdmin: 0, permissionsJson: rechte({ viewFinance: true, viewCases: true, viewAllCases: true }) });

  const insertCase = db.prepare(`
    INSERT INTO cases (id, label, file_number, stammdaten_json, owner_user_id, created_by, stammdaten_updated_by, archived)
    VALUES (@id, @label, @fileNumber, @stammdatenJson, @ownerUserId, @ownerUserId, @ownerUserId, @archived)
  `);
  insertCase.run({
    id: 'case-eigen', label: 'Muster, Martha', fileNumber: '17 XVII 42/26', ownerUserId: 2, archived: 0,
    stammdatenJson: JSON.stringify({
      person: { firstName: 'Martha', lastName: 'Muster', birthDate: '1970-01-02' },
      rechtlicherBetreuer: 'Anna Beispiel',
      care: { startDate: '01.02.2026', endDate: '', endReason: '', remStage: '2', assetStatus: 'M', housingCategory: 'A' },
      healthInfo: { diagnose: 'streng vertraulich' }
    })
  });
  insertCase.run({
    id: 'case-fremd', label: 'Fremd, Frieda', fileNumber: '17 XVII 45/26', ownerUserId: 3, archived: 0,
    stammdatenJson: JSON.stringify({
      person: { firstName: 'Frieda', lastName: 'Fremd' },
      rechtlicherBetreuer: { name: 'Bernd Bestand' },
      care: { startDate: '05.03.2025', remStage: 7, assetStatus: 'nm', housingCategory: 'S' }
    })
  });
  insertCase.run({
    id: 'case-archiv', label: 'Alt, Anton', fileNumber: '17 XVII 09/24', ownerUserId: 2, archived: 1,
    stammdatenJson: JSON.stringify({
      person: { firstName: 'Anton', lastName: 'Alt' },
      care: { startDate: '01.01.2024', endDate: '31.12.2025', endReason: 'Tod der betreuten Person' }
    })
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(createSessionMiddleware());
  app.use('/api', authRoutes);
  app.use('/api', requireOnlineMode);
  app.use('/api/controlling', controllingRoutes);

  server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(route, cookie, options = {}) {
    const response = await fetch(base + route, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_error) { body = text; }
    return { response, body, text };
  }

  async function login(username) {
    const result = await request('/api/login', '', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'test-passwort', mode: 'online' })
    });
    assert.equal(result.response.status, 200, `Login fuer ${username}`);
    return { cookie: result.response.headers.get('set-cookie').split(';', 1)[0], body: result.body };
  }

  await t.test('ohne Anmeldung: 401', async () => {
    const { response } = await request('/api/controlling', '');
    assert.equal(response.status, 401);
  });

  await t.test('Finanz- und Fallrecht ersetzen das Controlling-Recht nicht', async () => {
    const { cookie, body } = await login('ohne-recht');
    assert.equal(body.user.canViewControlling, false,
      'die Sitzung muss das Flag ausdruecklich als false melden');
    const { response, body: fehler } = await request('/api/controlling', cookie);
    assert.equal(response.status, 403);
    assert.match(String(fehler.error), /Controlling/);
  });

  await t.test('Admin sieht alles, ohne dass ihm das Recht zugeteilt wurde', async () => {
    const { cookie, body } = await login('admin');
    assert.equal(body.user.canViewControlling, true, 'Admins umgehen jedes Recht');
    const { response, body: daten } = await request('/api/controlling', cookie);
    assert.equal(response.status, 200);
    assert.equal(daten.vollstaendig, true);
    assert.equal(daten.gesamt, 2, 'Standardbereich sind die aktiven Faelle');
    assert.equal(daten.faelle.length, 2);
    assert.match(String(daten.stand), /^\d{4}-\d{2}-\d{2}$/);
  });

  await t.test('Nutzlast: vier Dimensionen, keine Euro, kein stammdaten_json', async () => {
    const { cookie } = await login('admin');
    const { body: daten } = await request('/api/controlling', cookie);
    const eigen = daten.faelle.find((f) => f.caseId === 'case-eigen');
    assert.deepEqual(eigen, {
      caseId: 'case-eigen',
      label: 'Muster, Martha',
      fileNumber: '17 XVII 42/26',
      archived: false,
      betreuer: 'Anna Beispiel',
      startDate: '01.02.2026',
      endDate: '',
      endReason: '',
      remStage: '2',
      assetStatus: 'M',
      housingCategory: 'A',
      /* Nachtrag 25.08.2026: `quelle` benennt die Herkunft der drei Verguetungsangaben.
         'fall' = in den Stammdaten gepflegt, 'antrag' = aus dem letzten Verguetungsantrag
         zurueckgelesen, weil die Stammdatenfelder noch leer sind. */
      quelle: 'fall'
    });
    assert.doesNotMatch(JSON.stringify(daten), /vertraulich|betrag|euro|"eur"/i,
      'die Route darf weder Stammdaten noch Geldbetraege ausliefern');

    const fremd = daten.faelle.find((f) => f.caseId === 'case-fremd');
    assert.equal(fremd.betreuer, 'Bernd Bestand', 'Altbestand mit Objekt statt Personen-Key aufloesen');
    assert.equal(fremd.remStage, '', 'ein unbekannter Stufenwert darf nicht in REM_RATES danebengreifen');
    assert.equal(fremd.assetStatus, 'NM', 'Kleinschreibung aus Altdaten wird auf den Antragswert normalisiert');
    assert.equal(fremd.housingCategory, 'S');
    assert.equal(fremd.quelle, 'fall', 'gepflegte Stammdaten muessen als solche gelten');
  });

  await t.test('Fallsichtbarkeit greift und wird gemeldet', async () => {
    const { cookie } = await login('controller');
    const { response, body: daten } = await request('/api/controlling', cookie);
    assert.equal(response.status, 200);
    assert.deepEqual(daten.faelle.map((f) => f.caseId), ['case-eigen']);
    assert.equal(daten.gesamt, 2, 'gesamt zaehlt VOR der Sichtbarkeitsfilterung');
    assert.equal(daten.vollstaendig, false,
      'eine gefilterte Liste muss sich als unvollstaendig zu erkennen geben');
  });

  await t.test('scope: archived und all', async () => {
    const { cookie } = await login('admin');
    const archiv = await request('/api/controlling?scope=archived', cookie);
    assert.deepEqual(archiv.body.faelle.map((f) => f.caseId), ['case-archiv']);
    assert.equal(archiv.body.faelle[0].archived, true);
    assert.equal(archiv.body.faelle[0].endReason, 'Tod der betreuten Person');

    const alle = await request('/api/controlling?scope=all', cookie);
    assert.equal(alle.body.gesamt, 3);

    const unsinn = await request('/api/controlling?scope=quatsch', cookie);
    assert.equal(unsinn.body.gesamt, 2, 'ein unbekannter Bereich faellt auf active zurueck');
  });
});
