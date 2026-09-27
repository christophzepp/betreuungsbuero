'use strict';

// Executes complete, unchanged legacy import blocks. DOM, confirmation and the
// preloaded case cache are adapters; parsing, comparison, writes and ledger are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const html = fs.readFileSync(path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
const scripts = ['aussendienst-0-v1', 'aussendienst-4-v1', 'aussendienst-5-v1', 'aussendienst-7-v1'].map(id => {
  const matches = [...html.matchAll(new RegExp('<script\\b[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</script>', 'g'))];
  assert.equal(matches.length, 1, `Unique legacy import block: ${id}`);
  return new vm.Script(matches[0][1], { filename: id + '.js' });
});

function createFieldClient({ caseId, caseData, caseEntries, officeReader, request }) {
  const entries = caseEntries || [{ caseId, label: 'Synthetischer Außendienstfall', state: { caseData } }];
  const nodes = Object.fromEntries(['modalBody', 'modalTitle', 'adImportMeldung', 'adApplyMsg']
    .map(id => [id, { innerHTML: '', textContent: '' }]));
  const errors = [], successes = [], calls = [];
  const context = {
    crypto: webcrypto, atob, Uint8Array, encodeURIComponent,
    __appMode: 'online',
    __adCaseEntries: async () => entries,
    __adBueroJetzt: officeReader,
    document: { getElementById: id => nodes[id] || null, querySelectorAll: () => [], querySelector: () => null },
    confirm: () => true,
    console: { error: error => errors.push(String(error.message || error)) },
    __workToast: { start() {}, update() {}, error() {}, success: (...args) => successes.push(args) },
    fetch: async (url, options = {}) => {
      const call = { url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) };
      calls.push(call);
      const response = await request(url, options);
      call.status = response.status;
      return response;
    }
  };
  context.window = context;
  vm.createContext(context);
  scripts.forEach(script => script.runInContext(context));
  async function importText(text) {
    await context.__adImport({ files: [{ name: 'synthetische-rueckgabe.json', text: async () => text }] });
    assert.ok(context.__adAbgleichStand(), nodes.adImportMeldung.innerHTML);
    assert.doesNotMatch(nodes.adImportMeldung.innerHTML, /Einlesen fehlgeschlagen/);
  }
  async function loadCases(cases, snapshotId = 'SF-AD-001') {
    const changes = cases.flatMap(item => context.__ad.diff(item.before, item.offline).map(change => ({
      ...change, caseId: item.caseId, label: 'Synthetischer Außendienstfall', id: context.__ad.changeId(snapshotId, change)
    })));
    const text = JSON.stringify({ typ: 'aussendienst-rueckgabe', v: 1, enc: 'plain',
      kopf: { snapshotId }, data: JSON.stringify({ aenderungen: changes, mail: null }) });
    await importText(text);
    return text;
  }
  return {
    calls, errors, successes, nodes,
    get rows() { return context.__adAbgleichStand().zeilen; },
    get message() { return nodes.adApplyMsg.innerHTML; },
    async load(before, offline, snapshotId = 'SF-AD-001') {
      return loadCases([{ caseId: entries[0].caseId, before, offline }], snapshotId);
    },
    importText, loadCases,
    apply: () => context.__adApplySelected()
  };
}

module.exports = { createFieldClient };
