'use strict';

/*
 * Vertragstest für die beiden gezielten Sammelrouten.
 *
 * Der Test benutzt eine vollständig neue SQLite-Fixture und einen temporären
 * Dokumentenbaum. Er startet nur eine kurzlebige Express-Testinstanz auf
 * listen(0), meldet sich über die echte Auth-Route an und durchläuft damit
 * express-session einschließlich dessen on-headers-Hook. Weder die
 * Produktivdatenbank noch ein fester/produktiver Port werden geöffnet.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Fall- und Büro-Sammelrouten sind wortlautgleich, fall- und rechtegeprüft', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'load-bundles-'));
  const serverRoot = path.join(__dirname, '..');
  assert.equal(fs.existsSync(path.join(serverRoot, 'routes', 'batch.js')), false,
    'die rekursive Universal-Batchroute muss entfernt bleiben');
  assert.doesNotMatch(
    fs.readFileSync(path.join(serverRoot, 'index.js'), 'utf8'),
    /routes\/batch|\/api\/batch/,
    'der Server darf keine tote Universal-Batchroute montieren'
  );
  process.env.DB_PATH = path.join(temp, 'fixture.sqlite3');
  process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
  process.env.SESSION_SECRET = 'load-bundles-test-session-secret-with-enough-entropy';
  process.env.ENCRYPTION_KEY = '11'.repeat(32);
  fs.mkdirSync(process.env.DOCUMENTS_DATA_ROOT, { recursive: true });

  const express = require('express');
  const bcrypt = require('bcrypt');
  const db = require('../src/database/index');
  const { serializePermissions } = require('../src/middleware/authorization');
  const { createSessionMiddleware, requireOnlineMode } = require('../src/middleware/authentication');
  const authRoutes = require('../src/modules/auth/routes');
  const caseRoutes = require('../src/modules/cases/routes');
  const financeRoutes = require('../src/modules/finance/routes');
  const invoiceRoutes = require('../src/modules/finance/invoice-routes');
  const mileageRoutes = require('../src/modules/finance/mileage-routes');
  const officeProfileRoutes = require('../src/modules/office/profile-routes');

  let server;
  t.after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const passwordHash = await bcrypt.hash('test-passwort', 4);
  const insertUser = db.prepare(`
    INSERT INTO users
      (id, username, password_hash, display_name, allow_local, allow_online,
       is_admin, permissions_json)
    VALUES
      (@id, @username, @passwordHash, @displayName, 1, 1,
       @isAdmin, @permissionsJson)
  `);

  function permissions(overrides) {
    return serializePermissions({
      local: {},
      online: {
        viewAllCases: false,
        approveMileage: false,
        ...overrides
      }
    }, null);
  }

  insertUser.run({
    id: 1,
    username: 'admin',
    passwordHash,
    displayName: 'Admin',
    isAdmin: 1,
    permissionsJson: permissions({})
  });
  insertUser.run({
    id: 2,
    username: 'fachkraft',
    passwordHash,
    displayName: 'Fachkraft',
    isAdmin: 0,
    permissionsJson: permissions({
      viewCases: true,
      viewDocuments: true,
      viewFinance: false
    })
  });
  insertUser.run({
    id: 3,
    username: 'dokumente',
    passwordHash,
    displayName: 'Dokumente',
    isAdmin: 0,
    permissionsJson: permissions({
      viewCases: false,
      viewDocuments: true,
      viewFinance: true
    })
  });
  insertUser.run({
    id: 4,
    username: 'ohne-inhalt',
    passwordHash,
    displayName: 'Ohne Inhalt',
    isAdmin: 0,
    permissionsJson: permissions({
      viewCases: false,
      viewDocuments: false,
      viewFinance: false
    })
  });
  insertUser.run({
    id: 5,
    username: 'fremd',
    passwordHash,
    displayName: 'Fremd',
    isAdmin: 0,
    permissionsJson: permissions({
      viewCases: true,
      viewDocuments: true,
      viewFinance: true
    })
  });

  const insertCase = db.prepare(`
    INSERT INTO cases
      (id, label, file_number, stammdaten_json, owner_user_id, created_by,
       stammdaten_updated_by)
    VALUES
      (@id, @label, @fileNumber, @stammdatenJson, @ownerUserId, @ownerUserId,
       @ownerUserId)
  `);
  insertCase.run({
    id: 'case-main',
    label: 'Muster, Martha',
    fileNumber: '17 XVII 42/26',
    stammdatenJson: JSON.stringify({
      person: { firstName: 'Martha', lastName: 'Muster', birthDate: '1970-01-02' },
      care: { courtName: 'AG Musterstadt' }
    }),
    ownerUserId: 2
  });
  insertCase.run({
    id: 'case-docs',
    label: 'Dokument, Dora',
    fileNumber: '17 XVII 43/26',
    stammdatenJson: JSON.stringify({
      person: { firstName: 'Dora', lastName: 'Dokument', birthDate: '1980-02-03' }
    }),
    ownerUserId: 3
  });
  insertCase.run({
    id: 'case-none',
    label: 'Ohne, Olaf',
    fileNumber: '17 XVII 44/26',
    stammdatenJson: JSON.stringify({
      person: { firstName: 'Olaf', lastName: 'Ohne', birthDate: '1990-03-04' }
    }),
    ownerUserId: 4
  });
  insertCase.run({
    id: 'case-foreign',
    label: 'Fremd, Frieda',
    fileNumber: '17 XVII 45/26',
    stammdatenJson: JSON.stringify({
      person: { firstName: 'Frieda', lastName: 'Fremd', birthDate: '1960-04-05' }
    }),
    ownerUserId: 5
  });

  const insertReport = db.prepare(`
    INSERT INTO case_reports (case_id, report_id, data_json, updated_by)
    VALUES (?, ?, ?, ?)
  `);
  insertReport.run('case-main', 'bericht-2026', JSON.stringify({
    fields: { summary: 'Hauptfall' },
    meta: { year: 2026 }
  }), 2);
  insertReport.run('case-docs', 'bericht-docs', JSON.stringify({
    fields: { summary: 'Nur Dokumentrecht' },
    meta: { year: 2026 }
  }), 3);

  db.prepare(`
    INSERT INTO case_doku_entries (id, case_id, data_json, updated_by)
    VALUES (?, ?, ?, ?)
  `).run('doku-main', 'case-main', JSON.stringify({
    date: '28.07.2026',
    text: 'Hausbesuch',
    photos: []
  }), 2);
  db.prepare(`
    INSERT INTO case_contacts
      (id, case_id, data_json, created_at, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'kontakt-main',
    'case-main',
    JSON.stringify({ firstName: 'Karl', lastName: 'Kontakt' }),
    '2026-07-27 10:00:00',
    '2026-07-28 08:00:00',
    2
  );

  db.prepare(`
    INSERT INTO finance_entries
      (id, kind, posten, partner, frequenz, summe_gesamt, summe_monatlich,
       datum, updated_by, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'finance-1', 'ausgabe', 'Büromiete', 'Vermietung GmbH', 'monatlich',
    950, null, null, 1, 1
  );
  db.prepare(`
    INSERT INTO outgoing_invoices
      (id, re_datum, re_nummer, empfaenger, verwendungszweck, case_label,
       rechnungszeitraum, summe, eingang_datum, eingangsbetrag, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'invoice-1', '2026-07-20', '001-2026', 'Gericht', 'Vergütung',
    'Muster, Martha', '2026-01 bis 2026-06', 1234.5, null, null, 1
  );

  db.prepare(`
    INSERT INTO private_vehicles
      (id, owner_user_id, kennzeichen, hersteller_modell, status, note,
       halter_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('vehicle-own', 2, 'MS-AB 123', 'Kleinwagen', 'aktiv', 'eigen', 'Fachkraft');
  db.prepare(`
    INSERT INTO private_vehicles
      (id, owner_user_id, kennzeichen, hersteller_modell, status, note,
       halter_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('vehicle-foreign', 5, 'MS-CD 456', 'Kombi', 'aktiv', 'fremd', 'Fremd');
  db.prepare(`
    INSERT INTO mileage_trips
      (id, vehicle_id, fahrer_user_id, datum, fahranlass, case_label,
       start_adresse, ziel_adresse, kilometer, erstattungsbetrag_snapshot,
       status, fahrer_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'trip-own', 'vehicle-own', 2, '2026-07-28', 'Hausbesuch',
    'Muster, Martha', 'Büro', 'Wohnung', 12.5, 3.75, 'entwurf', ''
  );
  db.prepare(`
    INSERT INTO mileage_trips
      (id, vehicle_id, fahrer_user_id, datum, fahranlass, case_label,
       start_adresse, ziel_adresse, kilometer, erstattungsbetrag_snapshot,
       status, fahrer_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'trip-foreign', 'vehicle-foreign', 5, '2026-07-27', 'Gericht',
    'Fremd, Frieda', 'Büro', 'Gericht', 8, 2.4, 'eingereicht', ''
  );

  db.prepare(`
    INSERT INTO office_profile
      (id, company_name, salutation, first_name, last_name, academic_degree,
       street, postal_code, city, country, phone, mobile, email, fax,
       website, tax_number, vat_id)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'Betreuungsbüro Test', 'Frau', 'Ada', 'Admin', '',
    'Testweg 1', '12345', 'Musterstadt', 'Deutschland',
    '0123', '', 'test@example.invalid', '', '', '123/456', ''
  );
  db.prepare(`
    INSERT INTO office_bank_accounts
      (id, bank_name, iban, bic, account_holder, account_type, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'office-bank-1', 'Testbank', 'DE00123456781234567890',
    'TESTDE00XXX', 'Betreuungsbüro Test', 'Geschäftskonto', 1
  );
  /* Etappe 4 (30.08.2026): office_employees ist abgebaut - Mitarbeitende ohne Konto sind
     Register-Personen (die employees-Route ist eine Sicht darauf). */
  db.prepare(`
    INSERT INTO persons
      (id, art, user_id, first_name, last_name, funktion, email, phone, kennung, extra_json, aktiv)
    VALUES (?, 'intern', NULL, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    'employee-1', 'Eva', 'Mitarbeit', 'Sachbearbeitung',
    'eva@example.invalid', '01234', 'MA 1',
    JSON.stringify({ username: 'eva' })
  );

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(createSessionMiddleware());
  app.use('/api', authRoutes);
  app.use('/api', requireOnlineMode);
  app.use('/api/cases', caseRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/mileage', mileageRoutes);
  app.use('/api/office-profile', officeProfileRoutes);

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
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_error) {
      body = text;
    }
    return { response, body, text };
  }

  async function login(username) {
    const result = await request('/api/login', '', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'test-passwort', mode: 'online' })
    });
    assert.equal(result.response.status, 200, `Login für ${username}`);
    const setCookie = result.response.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('betreuungsbuero.sid='),
      'express-session muss über on-headers ein Sitzungscookie schreiben');
    const cookie = setCookie.split(';', 1)[0];
    assert.ok(db.prepare('SELECT 1 FROM sessions').get(),
      'die echte SQLite-Sitzung muss persistiert sein');
    return cookie;
  }

  function assertSameJson(actual, expected, message) {
    assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
  }

  const adminCookie = await login('admin');
  const workerCookie = await login('fachkraft');
  const docsCookie = await login('dokumente');
  const noContentCookie = await login('ohne-inhalt');

  const caseBundle = await request('/api/cases/case-main/load', adminCookie);
  assert.equal(caseBundle.response.status, 200);
  const caseMappings = [
    ['stammdaten', '/api/cases/case-main/stammdaten'],
    ['reports', '/api/cases/case-main/reports'],
    ['dokuEntries', '/api/cases/case-main/doku-entries'],
    ['contacts', '/api/cases/case-main/contacts']
  ];
  for (const [part, route] of caseMappings) {
    const single = await request(route, adminCookie);
    assert.equal(single.response.status, 200, route);
    assertSameJson(
      caseBundle.body[part],
      single.body,
      `Fall-Bündelteil ${part} muss wortlautgleich zur Einzelroute sein`
    );
  }

  const workerCaseBundle = await request('/api/cases/case-main/load', workerCookie);
  assert.equal(workerCaseBundle.response.status, 200);
  for (const [part, route] of caseMappings) {
    const single = await request(route, workerCookie);
    assert.equal(single.response.status, 200, route);
    assertSameJson(workerCaseBundle.body[part], single.body, `${part} für Fachkraft`);
  }

  const foreignCase = await request('/api/cases/case-foreign/load', workerCookie);
  assert.equal(foreignCase.response.status, 403,
    'das Bündel darf die zentrale Fall-Zuständigkeitsprüfung nicht umgehen');

  const docsBundle = await request('/api/cases/case-docs/load', docsCookie);
  assert.equal(docsBundle.response.status, 200);
  assert.equal(docsBundle.body.stammdaten, null);
  assert.equal(docsBundle.body.dokuEntries, null);
  assert.equal(docsBundle.body.contacts, null);
  const docsSingle = await request('/api/cases/case-docs/reports', docsCookie);
  assert.equal(docsSingle.response.status, 200);
  assertSameJson(docsBundle.body.reports, docsSingle.body, 'Dokumentrecht bleibt unabhängig');
  assert.equal(
    (await request('/api/cases/case-docs/stammdaten', docsCookie)).response.status,
    403
  );
  assert.equal(
    (await request('/api/cases/case-none/load', noContentCookie)).response.status,
    403,
    'ohne Fall- und Dokumentrecht darf auch ein eigener Fall nicht geladen werden'
  );

  const officeBundle = await request('/api/office-profile/load', adminCookie);
  assert.equal(officeBundle.response.status, 200);
  const officeMappings = [
    ['finance', '/api/finance/entries'],
    ['invoices', '/api/invoices'],
    ['vehicles', '/api/mileage/vehicles'],
    ['trips', '/api/mileage/trips'],
    ['profile', '/api/office-profile'],
    ['bankAccounts', '/api/office-profile/bank-accounts'],
    ['employees', '/api/office-profile/employees']
  ];
  for (const [part, route] of officeMappings) {
    const single = await request(route, adminCookie);
    assert.equal(single.response.status, 200, route);
    assertSameJson(
      officeBundle.body[part],
      single.body,
      `Büro-Bündelteil ${part} muss wortlautgleich zur Einzelroute sein`
    );
  }

  const workerOffice = await request('/api/office-profile/load', workerCookie);
  assert.equal(workerOffice.response.status, 200);
  assert.equal(workerOffice.body.finance, null,
    'fehlendes Finanzrecht nullt ausschließlich den Finanzteil');
  assert.equal(
    (await request('/api/finance/entries', workerCookie)).response.status,
    403
  );
  for (const [part, route] of officeMappings.filter(([part]) => part !== 'finance')) {
    const single = await request(route, workerCookie);
    assert.equal(single.response.status, 200, route);
    assertSameJson(workerOffice.body[part], single.body, `${part} bleibt trotz Finanzsperre lesbar`);
  }
  assert.deepEqual(
    workerOffice.body.vehicles.vehicles.map((row) => row.id),
    ['vehicle-own'],
    'Fahrzeug-Zeilensicht muss der Einzelroute entsprechen'
  );
  assert.deepEqual(
    workerOffice.body.trips.trips.map((row) => row.id),
    ['trip-own'],
    'Fahrten-Zeilensicht muss der Einzelroute entsprechen'
  );

  const docsOffice = await request('/api/office-profile/load', docsCookie);
  assert.equal(docsOffice.response.status, 200);
  assert.equal(docsOffice.body.invoices, null,
    'fehlendes Fallrecht nullt ausschließlich den Rechnungsteil');
  assert.equal(
    (await request('/api/invoices', docsCookie)).response.status,
    403
  );
  const docsFinance = await request('/api/finance/entries', docsCookie);
  assert.equal(docsFinance.response.status, 200);
  assertSameJson(docsOffice.body.finance, docsFinance.body,
    'Finanzrecht bleibt vom Rechnungs-/Fallrecht unabhängig');
});
