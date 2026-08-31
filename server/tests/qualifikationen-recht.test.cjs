'use strict';

/*
 * Vertragstest fuer das Recht viewAllQualifications (Befund 31.08.2026).
 *
 * Der Rechtekatalog beschreibt es als "Qualifikationsmanager: alle Eintraege sehen (sonst nur den
 * eigenen)". Durchgesetzt wurde es aber nur in der Oberflaeche (canSeeAll() im Block
 * qualimanager-script-v1) und im MCP-Werkzeug. Der Web-Weg lief ueber die VORGABE des bueroweiten
 * JSON-Speichers - Lesen mit dem Fall-Sichtrecht. Damit lieferte
 * GET /api/office-json/qualifikationen jeder angemeldeten Person mit Fall-Sichtrecht die
 * Qualifikationen, Fortbildungen, Stundenumfaenge und Nachweise ALLER Mitarbeitenden; die
 * Beschraenkung auf den eigenen Eintrag existierte nur im Browser.
 *
 * Geprueft wird deshalb beides:
 *   1. Lesen ohne das Recht liefert ausschliesslich den eigenen Eintrag (Personen-ID UND
 *      Namensschluessel des Altbestands).
 *   2. Schreiben ohne das Recht loescht die fremden Eintraege NICHT - der Client speichert immer
 *      den ganzen Blob, und er kennt nur noch den eigenen Teil davon.
 *
 * Aufbau wie controlling-route.test.js: eigene SQLite-Fixture, kurzlebige Express-Instanz auf
 * listen(0), Anmeldung ueber die echte Auth-Route.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Qualifikationen: eigener Eintrag ja, fremde nur mit Recht', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'quali-recht-'));
  process.env.DB_PATH = path.join(temp, 'fixture.sqlite3');
  process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
  process.env.SESSION_SECRET = 'quali-test-session-secret-with-enough-entropy';
  process.env.ENCRYPTION_KEY = '22'.repeat(32);
  fs.mkdirSync(process.env.DOCUMENTS_DATA_ROOT, { recursive: true });

  const express = require('express');
  const bcrypt = require('bcrypt');
  const db = require('../src/database/index');
  const { serializePermissions, PERMISSION_DEFS } = require('../src/middleware/authorization');
  const { createSessionMiddleware, requireOnlineMode } = require('../src/middleware/authentication');
  const authRoutes = require('../src/modules/auth/routes');
  const officeJsonRoutes = require('../src/modules/office/json-routes');

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  assert.equal(PERMISSION_DEFS.viewAllQualifications.default, false,
    'viewAllQualifications muss ein ausdruecklich zu vergebendes Recht bleiben');

  const passwordHash = await bcrypt.hash('test-passwort', 4);
  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, first_name, last_name,
                       allow_local, allow_online, is_admin, permissions_json)
    VALUES (@id, @username, @passwordHash, @displayName, @firstName, @lastName, 1, 1, @isAdmin, @permissionsJson)
  `);
  const rechte = (overrides) => serializePermissions({
    local: {},
    online: { viewCases: true, editCases: true, viewAllQualifications: false, ...overrides }
  }, null);

  insertUser.run({ id: 1, username: 'leitung', passwordHash, displayName: 'Leitung', firstName: 'Lea', lastName: 'Leitung', isAdmin: 0, permissionsJson: rechte({ viewAllQualifications: true }) });
  insertUser.run({ id: 2, username: 'betreuerin', passwordHash, displayName: 'Betreuerin', firstName: 'Bea', lastName: 'Betreuung', isAdmin: 0, permissionsJson: rechte({}) });
  insertUser.run({ id: 3, username: 'alt', passwordHash, displayName: 'Alt', firstName: 'Alt', lastName: 'Bestand', isAdmin: 0, permissionsJson: rechte({}) });

  /* Bea haengt am Personenregister (Schluessel = Personen-ID), Alt stammt aus der Zeit davor
     (Schluessel = Namensschluessel). Beide Formen muessen als "eigener Eintrag" gelten. */
  db.prepare(`INSERT INTO persons (id, art, user_id, first_name, last_name, aktiv)
              VALUES (@id, 'intern', @userId, @firstName, @lastName, 1)`)
    .run({ id: 'pers-bea', userId: 2, firstName: 'Bea', lastName: 'Betreuung' });

  const bestand = {
    entries: {
      'pers-bea': { qualification: 'Sozialarbeit B.A.', stundenumfang: '30', fortbildungen: [{ titel: 'Betreuungsrecht 2026' }] },
      'alt bestand': { qualification: 'Verwaltungsfachangestellte', stundenumfang: '20' },
      'pers-lea': { qualification: 'Volljuristin', stundenumfang: '40', notizen: 'Leitung' },
      'pers-fremd': { qualification: 'Pflegefachkraft', stundenumfang: '25', qualiFiles: ['nachweis.pdf'] }
    }
  };
  db.prepare("INSERT INTO office_json (key, data_json) VALUES ('qualifikationen', ?)")
    .run(JSON.stringify(bestand));

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(createSessionMiddleware());
  app.use('/api', authRoutes);
  app.use('/api', requireOnlineMode);
  app.use('/api/office-json', officeJsonRoutes);

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
    return { response, body };
  }

  async function login(username) {
    const result = await request('/api/login', '', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'test-passwort', mode: 'online' })
    });
    assert.equal(result.response.status, 200, `Login fuer ${username}`);
    return result.response.headers.get('set-cookie').split(';', 1)[0];
  }

  const gespeichert = () => JSON.parse(
    db.prepare("SELECT data_json FROM office_json WHERE key = 'qualifikationen'").get().data_json
  );

  await t.test('mit dem Recht: alle Einträge', async () => {
    const cookie = await login('leitung');
    const { response, body } = await request('/api/office-json/qualifikationen', cookie);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body.data.entries).sort(),
      ['alt bestand', 'pers-bea', 'pers-fremd', 'pers-lea']);
  });

  await t.test('ohne das Recht: nur der eigene Eintrag (Personen-ID)', async () => {
    const cookie = await login('betreuerin');
    const { response, body } = await request('/api/office-json/qualifikationen', cookie);
    assert.equal(response.status, 200, 'der eigene Eintrag bleibt lesbar - kein 403');
    assert.deepEqual(Object.keys(body.data.entries), ['pers-bea']);
    assert.equal(body.data.entries['pers-bea'].stundenumfang, '30');
    /* Die Kernaussage: keine fremden Personaldaten mehr in der Antwort. */
    const roh = JSON.stringify(body);
    assert.equal(roh.includes('Pflegefachkraft'), false, 'fremde Qualifikation ist mitgereist');
    assert.equal(roh.includes('Volljuristin'), false, 'fremde Qualifikation ist mitgereist');
    assert.equal(roh.includes('nachweis.pdf'), false, 'fremder Nachweis ist mitgereist');
  });

  await t.test('ohne das Recht: auch der alte Namensschlüssel zählt als eigener Eintrag', async () => {
    const cookie = await login('alt');
    const { body } = await request('/api/office-json/qualifikationen', cookie);
    assert.deepEqual(Object.keys(body.data.entries), ['alt bestand']);
  });

  await t.test('Speichern ohne das Recht löscht fremde Einträge nicht', async () => {
    const cookie = await login('betreuerin');
    /* Genau das, was der Browser schickt: den Stand, den er kennt - also nur den eigenen. */
    const { response } = await request('/api/office-json/qualifikationen', cookie, {
      method: 'PUT',
      body: JSON.stringify({ data: { entries: { 'pers-bea': { qualification: 'Sozialarbeit M.A.', stundenumfang: '35' } } } })
    });
    assert.equal(response.status, 200);
    const jetzt = gespeichert();
    assert.deepEqual(Object.keys(jetzt.entries).sort(),
      ['alt bestand', 'pers-bea', 'pers-fremd', 'pers-lea'], 'fremde Einträge wurden gelöscht');
    assert.equal(jetzt.entries['pers-bea'].qualification, 'Sozialarbeit M.A.', 'eigene Änderung kam nicht an');
    assert.equal(jetzt.entries['pers-fremd'].qualification, 'Pflegefachkraft', 'fremder Eintrag wurde verändert');
  });

  await t.test('Fremde Einträge lassen sich ohne das Recht auch nicht unterschieben', async () => {
    const cookie = await login('betreuerin');
    await request('/api/office-json/qualifikationen', cookie, {
      method: 'PUT',
      body: JSON.stringify({ data: { entries: {
        'pers-bea': { qualification: 'Sozialarbeit M.A.' },
        'pers-fremd': { qualification: 'GEFÄLSCHT', stundenumfang: '0' }
      } } })
    });
    assert.equal(gespeichert().entries['pers-fremd'].qualification, 'Pflegefachkraft',
      'ein fremder Eintrag ließ sich überschreiben');
  });

  await t.test('mit dem Recht bleibt das Speichern unverändert möglich', async () => {
    const cookie = await login('leitung');
    const { response } = await request('/api/office-json/qualifikationen', cookie, {
      method: 'PUT',
      body: JSON.stringify({ data: { entries: {
        'pers-bea': { qualification: 'Sozialarbeit M.A.' },
        'pers-fremd': { qualification: 'Pflegefachkraft, Weiterbildung Demenz' }
      } } })
    });
    assert.equal(response.status, 200);
    const jetzt = gespeichert();
    assert.deepEqual(Object.keys(jetzt.entries).sort(), ['pers-bea', 'pers-fremd'],
      'die Leitung schreibt den Blob weiterhin als Ganzes');
    assert.equal(jetzt.entries['pers-fremd'].qualification, 'Pflegefachkraft, Weiterbildung Demenz');
  });
});
