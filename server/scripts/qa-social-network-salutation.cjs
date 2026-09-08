'use strict';

// Real shipped UI, synthetic contacts and intercepted APIs; no production writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, 'qa-mobile-completion.cjs'), 'utf8');
const setup = new Function('require', '__dirname', source.split('(async()=>{const{browser,page}=await setup()')[0] + ';return setup;')(require, __dirname);
const output = process.env.MOBILE_QA_OUTPUT || '/tmp/social-network-salutation';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const { browser, page } = await setup();
  const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (name, value) => {
    assert.ok(value, name);
    checks.push(name);
    console.log('PASS ' + name);
  };
  try {
    await page.evaluate(() => {
      state.caseData.socialNetwork = [{ firstName: 'Ben', lastName: 'Beispiel', role: 'Sohn', salutation: 'Sehr geehrter Herr' }];
      window.__suggestionRegistry.adopt({ version: 1, fields: {} });
    });
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(mobile => document.documentElement.classList.contains('mobile-online-active') === mobile, width < 1000);
      await page.evaluate(() => openSocialNetworkEditor(0));
      const input = page.locator('#snSalutation');
      await input.waitFor();
      // Repeated enhancement used to overwrite this field with sd_anrede.
      await page.evaluate(() => enhanceStammdatenSuggestions(document.getElementById('modalBody')));
      check(width + ': Kontaktfeld behält die Briefanrede-Liste', await input.getAttribute('data-combo') === 'ab_salutation');
      check(width + ': Vorhandene Briefanrede bleibt erhalten', await input.inputValue() === 'Sehr geehrter Herr');
      await input.click();
      const options = page.locator('.fincombo-panel:visible .fincombo-opt');
      const values = await options.allTextContents();
      check(width + ': Richtige Vorschläge schon ohne vorherigen Adressbuchaufruf', ['Sehr geehrter Herr', 'Sehr geehrte Frau', 'Sehr geehrte Damen und Herren'].every(v => values.includes(v)));
      check(width + ': Keine persönlichen Anreden in der Vorschlagsliste', !['Herr', 'Frau', 'Divers', 'Firma', 'Eheleute'].some(v => values.includes(v)));
      await page.screenshot({ path: path.join(output, 'anrede-' + width + '.png') });
      await options.filter({ hasText: /^Sehr geehrte Frau$/ }).click();
      check(width + ': Vorschlagsauswahl schreibt den gewählten Wert', await input.inputValue() === 'Sehr geehrte Frau');
      await input.fill('Guten Tag Ben');
      await page.locator('.social-network-editor-actions').getByRole('button', { name: 'Speichern', exact: true }).click();
      check(width + ': Freie Briefanrede wird unverändert gespeichert', await page.evaluate(() => state.caseData.socialNetwork[0].salutation) === 'Guten Tag Ben');
      await page.evaluate(() => {
        openSocialNetworkEditor(0);
        window.__snFillFromContact({ salutation: 'Sehr geehrter Herr', firstName: 'Ben', lastName: 'Beispiel' });
      });
      check(width + ': Übernahme aus dem Adressbuch erhält die Briefanrede', await input.inputValue() === 'Sehr geehrter Herr');
      await page.locator('.social-network-editor-actions').getByRole('button', { name: 'Speichern', exact: true }).click();
    }
    await page.evaluate(() => {
      const field = (key, value) => ({ key, label: 'Anrede', sortMode: 'custom', groups: [{ id: 'office', label: 'Bürovorgabe', order: 0, items: [{ value, source: 'office', order: 0, hidden: false }] }] });
      window.__suggestionRegistry.adopt({ version: 1, fields: {
        ab_salutation: field('ab_salutation', 'Guten Tag aus dem Büro'),
        sd_anrede: field('sd_anrede', 'Persönliche Anrede – Bürovorgabe')
      } });
      openSocialNetworkEditor(0);
      enhanceStammdatenSuggestions(document.getElementById('modalBody'));
    });
    await page.locator('#snSalutation').click();
    check('Gepflegte Adressbuch-Vorschläge werden auch im sozialen Netzwerk verwendet', JSON.stringify(await page.locator('.fincombo-panel:visible .fincombo-opt').allTextContents()) === JSON.stringify(['Guten Tag aus dem Büro']));
    check('Personenanrede bleibt fachlich getrennt', await page.evaluate(() => __finComboData.sd_anrede.flatMap(g => g[1]).includes('Persönliche Anrede – Bürovorgabe')));
    // These pure mappings are private to the inbox module; execute their shipped definitions.
    const html = fs.readFileSync(path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
    const start = html.indexOf('function inboxSectionFieldComboKey(');
    const end = html.indexOf('// Sortierte Optionen', start);
    assert.ok(start >= 0 && end > start);
    const keys = new Function(html.slice(start, end) + ';return {section:inboxSectionFieldComboKey,scalar:inboxScalarFieldComboKey};')();
    check('Posteingang verwendet für soziale Kontakte dieselbe Briefanrede-Liste', keys.section('socialNetwork', 'salutation') === 'ab_salutation');
    check('Posteingang verwendet für die betreute Person weiterhin die Personenanrede', keys.scalar('person.salutation') === 'sd_anrede');
    check('Keine JavaScript-Laufzeitfehler', errors.length === 0);
  } finally {
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
