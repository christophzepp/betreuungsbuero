'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(
  path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

function region(start, end) {
  const first = html.indexOf(start);
  assert.notEqual(first, -1, `Start fehlt: ${start}`);
  assert.equal(html.indexOf(start, first + start.length), -1, `Start nicht eindeutig: ${start}`);
  const last = html.indexOf(end, first + start.length);
  assert.notEqual(last, -1, `Ende fehlt: ${end}`);
  return html.slice(first, last);
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; }
  };
}

const caseFunction = region(
  '  async function fetchCaseState(caseId){',
  '\n\n  // "Reinladen/Rausladen/Archivieren"-Logik'
);
const officeFunction = region(
  'async function loadAllBueroData(){',
  '\n/* Der Außendienst-Snapshot'
);

test('Fall-Sammelroute liefert dieselbe Clientform und fällt bei 404 vollständig zurück', async () => {
  const expected = {
    stammdaten: { data: { person: { firstName: 'Martha' } } },
    reports: { reports: [{ reportId: 'r1', data: { text: 'Bericht' } }] },
    dokuEntries: { entries: [{ id: 'd1', data: { text: 'Hausbesuch' } }] },
    contacts: { contacts: [{ id: 'c1', data: { name: 'Kontakt' } }] }
  };

  const bundledCalls = [];
  const bundledContext = {
    window: { __currentUser: { isAdmin: true } },
    fetch: async (url) => {
      bundledCalls.push(url);
      return response(200, expected);
    },
    priorityFetch: async (url) => {
      bundledCalls.push(url);
      return response(200, expected);
    },
    encodeURIComponent
  };
  vm.createContext(bundledContext);
  vm.runInContext(`${caseFunction}\nthis.run=fetchCaseState;`, bundledContext);
  const bundled = await bundledContext.run('fall/mit leerzeichen');
  assert.deepEqual(JSON.parse(JSON.stringify(bundled)), {
    stammdaten: expected.stammdaten.data,
    reports: { r1: { text: 'Bericht' } },
    documentationEntries: [{ text: 'Hausbesuch', id: 'd1' }],
    contacts: [{ name: 'Kontakt', id: 'c1' }]
  });
  assert.deepEqual(bundledCalls, ['/api/cases/fall%2Fmit%20leerzeichen/load']);

  const fallbackCalls = [];
  const fallbackBodies = {
    '/stammdaten': expected.stammdaten,
    '/reports': expected.reports,
    '/doku-entries': expected.dokuEntries,
    '/contacts': expected.contacts
  };
  const fallbackContext = {
    window: { __currentUser: { isAdmin: true } },
    fetch: async (url) => {
      fallbackCalls.push(url);
      if (url.endsWith('/load')) return response(404, { error: 'alte Serverfassung' });
      const suffix = Object.keys(fallbackBodies).find((item) => url.endsWith(item));
      return response(200, fallbackBodies[suffix]);
    },
    priorityFetch: async (url) => {
      fallbackCalls.push(url);
      if (url.endsWith('/load')) return response(404, { error: 'alte Serverfassung' });
      const suffix = Object.keys(fallbackBodies).find((item) => url.endsWith(item));
      return response(200, fallbackBodies[suffix]);
    },
    encodeURIComponent
  };
  vm.createContext(fallbackContext);
  vm.runInContext(`${caseFunction}\nthis.run=fetchCaseState;`, fallbackContext);
  const fallback = await fallbackContext.run('fall-1');
  assert.deepEqual(JSON.parse(JSON.stringify(fallback)), JSON.parse(JSON.stringify(bundled)));
  assert.equal(fallbackCalls.length, 5);
});

test('Fall-Sammelroute umgeht 401/403 nicht mit Einzelabrufen', async () => {
  const calls = [];
  const context = {
    window: { __currentUser: { isAdmin: true } },
    fetch: async (url) => {
      calls.push(url);
      return response(403, { error: 'verboten' });
    },
    priorityFetch: async (url) => {
      calls.push(url);
      return response(403, { error: 'verboten' });
    },
    encodeURIComponent
  };
  vm.createContext(context);
  vm.runInContext(`${caseFunction}\nthis.run=fetchCaseState;`, context);
  await assert.rejects(context.run('fall-1'), /Keine Berechtigung/);
  assert.equal(calls.length, 1);
});

test('Büro-Sammelroute braucht neben der dynamischen Übersicht nur eine Anfrage und hat 404-Rückfall', async () => {
  const bundle = {
    finance: { entries: [{ id: 'f1' }] },
    invoices: { invoices: [{ id: 'i1' }] },
    vehicles: { vehicles: [{ id: 'v1' }] },
    trips: { trips: [{ id: 't1' }] },
    profile: { profile: { companyName: 'Büro' } },
    bankAccounts: { bankAccounts: [{ id: 'b1' }] },
    employees: { employees: [{ id: 'e1' }] }
  };
  function contextFor(mode) {
    const calls = [];
    const bodies = new Map([
      ['/api/finance/entries', bundle.finance],
      ['/api/invoices', bundle.invoices],
      ['/api/mileage/vehicles', bundle.vehicles],
      ['/api/mileage/trips', bundle.trips],
      ['/api/office-profile', bundle.profile],
      ['/api/office-profile/bank-accounts', bundle.bankAccounts],
      ['/api/office-profile/employees', bundle.employees]
    ]);
    const context = {
      window: {},
      encodeURIComponent,
      currentHalfYearStartLocal: () => '2026-07-01',
      fetchJsonSafe: async (url) => {
        calls.push(url);
        if (url.startsWith('/api/betreuungsuebersicht')) return { items: [{ id: 'o1' }] };
        return bodies.get(url) || null;
      },
      fetch: async (url) => {
        calls.push(url);
        return mode === 'bundle'
          ? response(200, bundle)
          : response(404, { error: 'alte Serverfassung' });
      }
    };
    vm.createContext(context);
    vm.runInContext(`${officeFunction}\nthis.run=loadAllBueroData;`, context);
    return { context, calls };
  }
  const direct = contextFor('bundle');
  const directResult = await direct.context.run();
  assert.equal(direct.calls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(directResult)), {
    financeEntries: [{ id: 'f1' }],
    invoiceEntries: [{ id: 'i1' }],
    vehicles: [{ id: 'v1' }],
    trips: [{ id: 't1' }],
    buItems: [{ id: 'o1' }],
    officeProfile: { companyName: 'Büro' },
    officeBankAccounts: [{ id: 'b1' }],
    officeEmployees: [{ id: 'e1' }]
  });

  const fallback = contextFor('fallback');
  const fallbackResult = await fallback.context.run();
  assert.deepEqual(
    JSON.parse(JSON.stringify(fallbackResult)),
    JSON.parse(JSON.stringify(directResult))
  );
  assert.equal(fallback.calls.length, 9);
});

test('Büro-Sammelroute umgeht 401/403 nicht mit den sieben Einzelabrufen', async () => {
  for (const status of [401, 403]) {
    const calls = [];
    const context = {
      window: {},
      encodeURIComponent,
      currentHalfYearStartLocal: () => '2026-07-01',
      fetchJsonSafe: async (url) => {
        calls.push(url);
        return { items: [] };
      },
      fetch: async (url) => {
        calls.push(url);
        return response(status, { error: 'nicht erlaubt' });
      }
    };
    vm.createContext(context);
    vm.runInContext(`${officeFunction}\nthis.run=loadAllBueroData;`, context);
    await assert.rejects(context.run(), /Keine Berechtigung/);
    assert.equal(
      calls.filter((url) => url === '/api/office-profile/load').length,
      1,
      `Status ${status}: genau ein Büro-Bündelabruf`
    );
    assert.equal(
      calls.filter((url) => [
        '/api/finance/entries',
        '/api/invoices',
        '/api/mileage/vehicles',
        '/api/mileage/trips',
        '/api/office-profile',
        '/api/office-profile/bank-accounts',
        '/api/office-profile/employees'
      ].includes(url)).length,
      0,
      `Status ${status}: kein Einzelrouten-Rückfall`
    );
  }
});

test('Online-Sicherung ist im Explorer vollständig erreichbar und in der Seitenleiste verborgen', () => {
  assert.match(html, /const legacySichtbar=mode!=='online'&&mode!=='fieldService'/);
  assert.match(html, /menu\.style\.display=legacySichtbar\?'':'none'/);
  assert.match(html, /Alle Sicherungsabbilder jetzt aktualisieren/);
  assert.match(html, /Fall-Sicherungsdateien anzeigen/);
  assert.match(html, /Büro- und Verwaltungssicherungen anzeigen/);
  assert.match(html, /Letzte geprüfte Gesamtsicherung \(ZIP\)/);
  assert.match(html, /\/backup-jobs\/'\+encodeURIComponent\(jobId\)\+'\/download-latest/);
  assert.match(html, /\/falluebergabe-zip\?caseId=/);
  assert.match(html, /\[Fall-Laden\].*Ziel: rund 10 statt 44/);
  assert.doesNotMatch(html, /\/api\/batch/);
});
