'use strict';
// Exercise the shipped UI. Every request is intercepted; no real case is touched.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.MOBILE_QA_BROWSER || 'chromium';
const output = process.env.MOBILE_QA_OUTPUT || '/tmp/case-deletion-ui';
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await playwright[engine].launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url() === 'http://case-delete.invalid/') return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html')) });
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    });
    await page.addInitScript(() => { window.__onlineInitialCaseNativeFetch = async (...args) => window.__qaCases ? window.fetch(...args) : new Response('{}'); });
    await page.goto('http://case-delete.invalid/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.evaluate(() => {
      window.__appMode = 'online'; window.__currentUser = { id: 1, isAdmin: true, displayName: 'Prüfung' };
      window.__activeServerCaseId = null;
      window.__qaRequests = [];
      window.__qaCases = [{ id: 'one', label: '<img src=x> Fall Eins', archived: true }, { id: 'two', label: 'Fall Zwei', archived: true }, { id: 'three', label: 'Fall Drei', archived: true }];
      window.fetch = async (url, options = {}) => {
        let result = {}, status = 200;
        const route = new URL(String(url), location.href).pathname;
        if (route === '/api/cases') result = { cases: window.__qaCases };
        else if (route === '/api/todos') result = { todos: window.__qaTodos || [] };
        else if (route === '/api/betreuungsuebersicht') result = { items: [] };
        else if (route.startsWith('/api/cases/') && options.method === 'DELETE') {
          const id = decodeURIComponent(route.split('/').pop());
          window.__qaRequests.push({ id, body: JSON.parse(options.body) });
          if (id === window.__qaFail) { status = 409; result = { error: 'Test: Dateiablage nicht erreichbar.' }; }
          else { window.__qaCases = window.__qaCases.filter(item => item.id !== id); result = { ok: true, warnings: [] }; }
        }
        return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } });
      };
    });
    const dialog = page.locator('#caseDeletionDialog');
    await page.evaluate(() => { window.__qaPending = window.__onlineCaseSync.remove('one', '<img src=x> Fall Eins'); });
    await dialog.waitFor();
    assert.equal(await dialog.locator('input:checked').count(), 0);
    assert.equal(await dialog.getByRole('checkbox').count(), 4);
    assert.equal(await dialog.locator('img').count(), 0);
    assert.match(await dialog.innerText(), /<img src=x> Fall Eins/);
    assert.equal(await dialog.getByRole('button', { name: 'Abbrechen' }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape'); await page.evaluate(() => window.__qaPending);
    assert.equal(await page.evaluate(() => __qaRequests.length), 0);
    console.log('PASS Abbrechen/Escape, sichere Standardauswahl und Fallname');
    await page.evaluate(() => { window.__qaPending = window.__onlineCaseSync.remove('one', '<img src=x> Fall Eins'); });
    await dialog.getByLabel('Aufgaben', { exact: true }).check();
    await dialog.getByLabel('Fristen', { exact: true }).check();
    await page.screenshot({ path: path.join(output, engine + '-desktop.png') });
    await dialog.getByRole('button', { name: 'Endgültig löschen' }).click(); await page.evaluate(() => window.__qaPending);
    assert.deepEqual(await page.evaluate(() => __qaRequests[0]), { id: 'one', body: { deleteRelated: { calendar: false, tasks: true, deadlines: true, followups: false } } });
    console.log('PASS Einzellöschung übermittelt exakt die Auswahl');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(async () => {
      await window.__onlineCaseSync.list();
      window.__caseArchivToggleSelect('two'); window.__caseArchivToggleSelect('three');
      window.__qaFail = 'three'; window.__qaRequests = [];
      window.__caseArchivBulkDelete();
    });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /Fall Zwei[\s\S]*Fall Drei/);
    await dialog.getByLabel('Kalendertermine', { exact: true }).check();
    await dialog.getByLabel('Wiedervorlagen', { exact: true }).check();
    await page.screenshot({ path: path.join(output, engine + '-mobile.png') });
    const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await dialog.getByRole('button', { name: 'Endgültig löschen' }).click();
    await page.waitForFunction(() => window.__qaRequests.length === 2);
    assert.deepEqual(await page.evaluate(() => __qaRequests.map(item => item.body.deleteRelated)), Array(2).fill({ calendar: true, tasks: false, deadlines: false, followups: true }));
    await page.waitForFunction(() => window.__qaCases.length === 1 && window.__qaCases[0].id === 'three');
    console.log('PASS Sammellöschung und Darstellung bei 390 Pixeln');
    await page.evaluate(() => { window.__currentUser.isAdmin = false; window.__qaRequests = []; return window.__onlineCaseSync.remove('three', 'Fall Drei'); });
    assert.equal(await dialog.count(), 0); assert.equal(await page.evaluate(() => __qaRequests.length), 0);
    console.log('PASS Kein Löschen ohne Adminrecht; keine JavaScript-Fehler');
    await page.evaluate(() => {
      window.__currentUser.isAdmin = true;
      document.getElementById('loginGateOverlay')?.classList.add('hidden');
      window.__qaTodos = [{ id: 'kept-deadline', title: 'Erhaltene Frist', dueAt: '2026-12-16', itemType: 'deadline', sourceType: 'retained-deadline', sourceModule: 'case-deletion',
        sourceRef: JSON.stringify({ deadline: { category: 'anfangsbericht', institution: 'Amtsgericht', formName: 'Anfangsbericht', baseDate: '2026-09-16' } }), description: 'Ehemaliger Fall: Fall Eins', priority: 'high', done: false, caseId: '', caseLabel: '' }];
      const previous = window.__todoShowEditForm;
      window.__todoShowEditForm = function (id) { window.__qaEdited = id; return previous(id); };
    });
    if (await page.locator('#modeIntroNext').isVisible()) await page.locator('#modeIntroNext').click();
    await page.evaluate(() => window.openFristenModal());
    for (const group of await page.locator('#fristenWorkspace [data-group][aria-expanded="false"]').all()) await group.click();
    await page.screenshot({ path: path.join(output, engine + '-retained.png') });
    const retained = page.locator('#fristenWorkspace [data-open="own::kept-deadline"]:visible').first();
    await retained.click();
    assert.match(await page.locator('#fristenWorkspace .fd-panel').innerText(), /Amtsgericht/);
    assert.match(await page.locator('#fristenWorkspace .fd-panel').innerText(), /Ehemaliger Fall: Fall Eins/);
    await page.locator('#fristenWorkspace [data-action="edit-retained"]').click();
    await page.waitForFunction(() => window.__qaEdited === 'kept-deadline');
    assert.deepEqual(errors, []);
    console.log('PASS Erhaltene Frist ohne Fall bleibt mit Details und Bearbeitung erreichbar');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
