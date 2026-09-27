'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PDFDocument } = require('@cantoo/pdf-lib');

function retained(value, reference, field = '') {
  assert.notEqual(value, undefined, `Missing loaded value: ${field}`);
  if (reference === null || typeof reference !== 'object') return value;
  if (Array.isArray(reference)) {
    assert.equal(value.length, reference.length);
    return reference.map((item, i) => retained(value[i], item, `${field}[${i}]`));
  }
  return Object.fromEntries(Object.entries(reference).map(([key, item]) => [key, retained(value[key], item, `${field}.${key}`)]));
}

// Full application and real login. PDF generation calls the loaded application's
// renderer directly; it does not claim coverage of every export-dialog option.
module.exports = async function browserProof(base, password, fixture, phase) {
  const { chromium } = require(process.env.SF_BROWSER_MODULE);
  const dir = process.env.SF_BROWSER_EVIDENCE;
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.addLocatorHandler(page.locator('#modeIntroNext'), button => button.click());
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (new URL(response.url()).origin === base && response.status() >= 400)
      requests.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  // The baseline must never contact a real provider, CDN, or user service.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === base || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
  });
  const started = performance.now();
  try {
    await page.clock.setFixedTime(new Date('2026-09-21T12:00:00Z'));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#loginGateUsername').fill('sf-restore-2');
    await page.locator('#loginGatePassword').fill(password);
    const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/login');
    await page.locator('#loginGateForm button[type="submit"]').click();
    assert.equal((await login).status(), 200);
    await page.locator('#loginGateOverlay').waitFor({ state: 'hidden' });
    await page.waitForFunction(id => window.__activeServerCaseId === id, fixture.caseId);
    const read = () => page.evaluate(() => ({ data: { ...state.caseData,
      exportHistory: state.ui.exportHistory, archives: state.archives }, report: state.reports.free_document }));
    const expected = { data: fixture.stammdaten, report: fixture.report };
    assert.deepEqual(retained(await read(), expected), expected);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(id => window.__activeServerCaseId === id, fixture.caseId);
    await page.locator('#loginGateOverlay').waitFor({ state: 'hidden' });
    assert.deepEqual(retained(await read(), expected), expected, 'Reload must retain every stored reference value.');
    await page.getByRole('button', { name: 'Stammdaten', exact: true }).first().click();
    const bytes = Buffer.from(await page.evaluate(async () => Array.from(
      await createGenericReportPdf('free_document', state.reports.free_document, 'Synthetischer Referenzbericht'))));
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.ok(bytes.length > 1000);
    assert.deepEqual(bytes, fs.readFileSync(path.join(__dirname, '../fixtures/server-first/reference-report.pdf')),
      'The regenerated PDF must also match the visually checked golden reference.');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual(errors, [], 'No JavaScript exception is allowed in the browser proof.');
    assert.deepEqual(requests.filter(item => item.status >= 500), [], 'No server failure is allowed.');
    fs.writeFileSync(path.join(dir, `${phase}-report.pdf`), bytes);
    await page.screenshot({ path: path.join(dir, `${phase}-application.png`), fullPage: false });
    const result = { phase, engine: 'chromium', version: browser.version(), pdfHashes: { report: hash },
      pages: pdf.getPageCount(), bytes: bytes.length, elapsedSeconds: (performance.now() - started) / 1000,
      checks: ['real-ui-login', 'case-and-report-loaded', 'browser-reload', 'application-pdf-renderer'],
      pageErrors: errors, failedHttpRequests: requests };
    fs.writeFileSync(path.join(dir, `${phase}-browser.json`), JSON.stringify(result, null, 2) + '\n');
    return result;
  } catch (error) {
    fs.writeFileSync(path.join(dir, `${phase}-failure.txt`), JSON.stringify({ message: error.message,
      text: await page.locator('body').innerText().catch(() => ''), errors, requests }, null, 2));
    await page.screenshot({ path: path.join(dir, `${phase}-failure.png`) }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
};

module.exports.assertRetained = (value, expected) => assert.deepEqual(retained(value, expected), expected);

module.exports.writeAfterRestore = async function writeAfterRestore(base, password, fixture) {
  const { chromium } = require(process.env.SF_BROWSER_MODULE);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  page.setDefaultTimeout(30000);
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const value = 'Über die wiederhergestellte Browseroberfläche gespeichert';
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#loginGateUsername').fill('sf-restore-1');
    await page.locator('#loginGatePassword').fill(password);
    await page.locator('#loginGateForm button[type="submit"]').click();
    await page.locator('#loginGateOverlay').waitFor({ state: 'hidden' });
    await page.waitForFunction(id => window.__activeServerCaseId === id, fixture.caseId);
    await page.locator('#modeIntroNext').click();
    // Open the same actual desktop navigation control used by a person.
    const group = page.locator('details[data-group-fallakte]').first();
    if (await group.getAttribute('open') === null) await group.locator('summary').click();
    await page.locator('[data-health-menu]:visible').first().click();
    const notes = page.locator('textarea[onchange*="__hiSet(\'notes\'"]');
    await notes.fill(value);
    await notes.press('Tab');
    await page.waitForFunction(async ({ id, value }) => {
      const response = await fetch(`/api/cases/${id}/stammdaten`);
      return response.ok && (await response.json()).data.healthInfo.notes === value;
    }, { id: fixture.caseId, value });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#loginGateOverlay').waitFor({ state: 'hidden' });
    await page.waitForFunction(id => window.__activeServerCaseId === id, fixture.caseId);
    if (await group.getAttribute('open') === null) await group.locator('summary').click();
    await page.locator('[data-health-menu]:visible').first().click();
    assert.equal(await notes.inputValue(), value);
    await page.screenshot({ path: path.join(process.env.SF_BROWSER_EVIDENCE, 'after-ui-write.png') });
    return value;
  } catch (error) {
    fs.writeFileSync(path.join(process.env.SF_BROWSER_EVIDENCE, 'write-failure.txt'),
      error.message + '\n' + await page.locator('body').innerText());
    await page.screenshot({ path: path.join(process.env.SF_BROWSER_EVIDENCE, 'write-failure.png') }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
};
