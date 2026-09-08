'use strict';

// Exercises real mobile workflows with synthetic data and blocked production APIs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = process.env.MOBILE_QA_OUTPUT || '/tmp/mobile-bugcheck-qa';
fs.mkdirSync(output, {recursive:true});
const fixture = fs.readFileSync(path.join(__dirname, 'qa-mobile-completion.cjs'), 'utf8');
const setup = new Function('require', '__dirname', fixture.split('(async()=>{const{browser,page}=await setup()')[0] + ';return setup;')(require, __dirname);
const results = [];

async function run(name, fn) {
  if (process.env.MOBILE_QA_CASE && !process.env.MOBILE_QA_CASE.split(',').some(part => name.includes(part))) return;
  const {browser, page} = await setup();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(4000);
  const button = name => page.getByRole('button', {name, exact:true});
  const nav = async id => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.locator('[data-mobile-more]').click();
    await page.locator('#mobileOnlineSheet [data-mobile-action="' + id + '"]').click();
  };
  const shot = async suffix => {
    await page.waitForTimeout(260);
    await page.screenshot({path:path.join(output, name + '-' + suffix + '.png')});
  };
  try {
    await fn({page, button, nav, shot});
    assert.deepEqual(errors, [], 'Keine JavaScript-Laufzeitfehler');
    results.push({name, pass:true});
    console.log('PASS ' + name);
  } catch (error) {
    await shot('fehler');
    results.push({name, pass:false, error:error.message, errors});
    console.log('FAIL ' + name + ': ' + error.message);
  } finally {
    await browser.close();
  }
}

async function seedInbox(page) {
  await page.evaluate(() => {
    const date = new Date().toLocaleDateString('en-CA');
    window.__qaInbox = [
      {id:'bug-new', fileName:'Neuer Bescheid.txt', mimeType:'text/plain', inboxDate:date, receivedDate:date, status:'neu', suggestions:[]},
      {id:'bug-done', fileName:'Erledigter Bescheid.txt', mimeType:'text/plain', inboxDate:date, receivedDate:date, status:'verarbeitet', suggestions:[]}
    ];
  });
}

(async () => {
  for (const id of ['supervision', 'contact-monitor']) for (const dirty of [false, true]) {
    await run(id + '-menuewechsel-' + (dirty ? 'entwurf' : 'unveraendert'), async ({page, button, nav, shot}) => {
      await nav(id);
      await button('Details: Mara Hoffmann').click();
      await button('Bearbeiten').click();
      if (dirty) {
        if (id === 'supervision') await page.getByLabel('Übergabe an', {exact:true}).fill('Nicht gespeicherte Vertretung');
        else {
          const input = page.getByLabel('Turnus', {exact:true});
          const other = await input.evaluate(e => [...e.options].find(o => o.value !== e.value).value);
          await input.selectOption(other);
        }
      }
      await nav('health');
      if (dirty) {
        await button('Weiter bearbeiten').click();
        assert.equal(await page.locator('[data-mobile-module="' + id + '"] .mc-form').isVisible(), true);
        await nav('health');
        await button('Änderungen verwerfen').click();
      }
      await page.locator('[data-mobile-module="health"]').waitFor();
      await nav(id);
      await page.locator('[data-mobile-module="' + id + '"]').waitFor();
      await button('Details: Mara Hoffmann').click();
      await button('Bearbeiten').click();
      if (id === 'supervision') assert.notEqual(await page.getByLabel('Übergabe an', {exact:true}).inputValue(), 'Nicht gespeicherte Vertretung');
      assert.equal(await button('Speichern').isVisible(), true);
      await shot('wieder-geoeffnet');
    });
  }

  await run('posteingang-filter-abbrechen', async ({page, button, nav, shot}) => {
    await seedInbox(page);
    await nav('inbox');
    await page.waitForFunction(() => document.querySelectorAll('.mc-row').length === 2);
    assert.equal(await page.locator('.mc-row').count(), 2);
    await button('Posteingang filtern').click();
    await page.getByLabel('Bearbeitungsstand', {exact:true}).selectOption('verarbeitet');
    await page.locator('#mobileOnlineSheet [data-mobile-sheet-close]').click();
    assert.equal(await page.locator('.mc-row').count(), 2, 'Schließen ohne Anwenden behält die ursprüngliche Auswahl');
    await button('Posteingang filtern').click();
    assert.equal(await page.getByLabel('Bearbeitungsstand', {exact:true}).inputValue(), '');
    await shot('unveraendert');
  });

  await run('posteingang-filter-anwenden', async ({page, button, nav, shot}) => {
    await seedInbox(page);
    await nav('inbox');
    await page.waitForFunction(() => document.querySelectorAll('.mc-row').length === 2);
    await button('Posteingang filtern').click();
    await page.getByLabel('Bearbeitungsstand', {exact:true}).selectOption('verarbeitet');
    await button('Anwenden').click();
    assert.equal(await page.locator('.mc-row').count(), 1);
    assert.equal(await button('Erledigt').getAttribute('aria-pressed'), 'true', 'Bereichsreiter zeigt den angewendeten Status');
    await button('Alle').click();
    assert.equal(await page.locator('.mc-row').count(), 2);
    await shot('alle');
  });

  await run('faehigkeiten-suche-inhalt', async ({page, button, nav, shot}) => {
    await page.evaluate(() => {
      const p = window.__goalDecisionPlanningBridge.getProfile();
      p.dailyLife = {...p.dailyLife, summary:'Kochen mit Rezeptkarten'};
      window.__goalDecisionPlanningBridge.saveProfile(p);
    });
    await nav('abilities');
    assert.equal(await page.locator('.mc-row').filter({hasText:'Kochen mit Rezeptkarten'}).count(), 1);
    await button('Fähigkeiten & Alltag durchsuchen').click();
    await page.getByRole('searchbox', {name:'Suche', exact:true}).fill('Rezeptkarten');
    assert.equal(await page.locator('.mc-row').count(), 1, 'Suche findet den sichtbaren Inhalt eines Bereichs');
    await shot('treffer');
  });

  await run('archiv-jahresfilter', async ({page, button, shot}) => {
    await page.evaluate(() => {
      state.archives = [2025, 2026].map(year => ({id:'bug-archive-' + year, reportId:'free_document', title:'Archivfassung ' + year,
        archivedAt:year + '-09-01T12:00:00Z', data:{fields:{free_text:{value:'Synthetischer Archivinhalt'}}}}));
      openArchiveView('free_document');
    });
    await page.waitForFunction(() => document.querySelectorAll('.mc-row').length === 2);
    await button('Archivierte Formulare filtern').click();
    await page.getByLabel('Jahr', {exact:true}).selectOption('2025');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.mc-row').count(), 2, 'Escape verwirft den noch nicht angewendeten Jahresfilter');
    await button('Archivierte Formulare filtern').click();
    assert.equal(await page.getByLabel('Jahr', {exact:true}).inputValue(), '');
    await page.getByLabel('Jahr', {exact:true}).selectOption('2025');
    await button('Anwenden').click();
    assert.equal(await page.locator('.mc-row').count(), 1);
    assert.ok((await page.locator('.mc-row').innerText()).includes('2025'));
    await button('Archivierte Formulare filtern').click();
    await page.locator('#archiveReportSelect').waitFor({state:'visible'});
    await page.locator('#modalCaseSwitcherSel').waitFor({state:'visible'});
    await page.getByLabel('Jahr', {exact:true}).selectOption('');
    await button('Anwenden').click();
    assert.equal(await page.locator('.mc-row').count(), 2, 'Erneutes Öffnen erhält Dokument- und Fallauswahl und lässt den Filter zurücknehmen');
    await shot('zurueckgesetzt');
  });

  await run('auswahlfelder-touchgroesse', async ({page, button, nav, shot}) => {
    await nav('health');
    await button('Gesundheit filtern').click();
    const field = page.getByLabel('Bereich', {exact:true});
    await field.waitFor();
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({width, height:844});
      await page.waitForTimeout(100);
      const geometry = await field.evaluate(e => ({height:e.getBoundingClientRect().height, font:parseFloat(getComputedStyle(e).fontSize)}));
      assert.ok(geometry.height >= 44 && geometry.font >= 16, 'Auswahlfeld bei ' + width + ' Pixeln: ' + JSON.stringify(geometry));
    }
    const medication = await field.evaluate(e => [...e.options].find(o => o.textContent === 'Medikation').value);
    await field.selectOption(medication);
    await button('Anwenden').click();
    assert.equal(await page.locator('.mc-row').count(), 1, 'Native Auswahl wendet den gewählten Bereich an');
    await page.setViewportSize({width:390, height:844});
    await button('Gesundheit filtern').click();
    await shot('hell');
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await shot('dunkel');
    await page.evaluate(() => { __mobileUI.closeSheet(); document.documentElement.dataset.theme = 'light'; });
    await nav('supervision');
    await button('Details: Mara Hoffmann').click();
    await button('Bearbeiten').click();
    assert.ok(await page.getByLabel('Änderungsart', {exact:true}).evaluate(e => e.getBoundingClientRect().height >= 44), 'Auch Formularauswahl ist touchgerecht');
    await shot('formular');
  });

  await run('filterblaetter-wiederholen', async ({page, button, nav, shot}) => {
    for (let i = 0; i < 4; i++) {
      await nav('health');
      await button('Gesundheit filtern').click();
      await page.getByLabel('Bereich', {exact:true}).waitFor({state:'visible'});
      assert.equal(await page.locator('#mobileOnlineSheet').evaluate(e => e.inert), false);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#mobileOnlineSheet').evaluate(e => e.inert), true, 'Geschlossene Blätter haben keine erreichbaren Fokusziele');
      await page.evaluate(() => openArchiveView('free_document'));
      await button('Weitere Aktionen: Archivierte Formulare').click();
      await page.locator('#mobileOnlineSheet [data-mobile-sheet-close]').click();
      await button('Archivierte Formulare filtern').click();
      await page.locator('#archiveReportSelect').waitFor({state:'visible'});
      await page.locator('#modalCaseSwitcherSel').waitFor({state:'visible'});
      assert.equal(await page.locator('#mobileOnlineSheet .mobile-sheet-panel').evaluate(e => getComputedStyle(e).visibility), 'visible');
      await button('Anwenden').click();
    }
    await button('Archivierte Formulare filtern').click();
    await shot('bedienbar');
  });

  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({checks:results.length, failures:results.filter(r => !r.pass).length}));
  if (results.some(r => !r.pass)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
