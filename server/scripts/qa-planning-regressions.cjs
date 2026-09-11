'use strict';
// Uses the existing synthetic followup fixture. No real cases or network writes.
const assert = require('node:assert/strict');
module.exports = async ({ page, root, act, panel, check, shot, errors }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    const row = __qaTodos.find(t => t.id === 'f1');
    row.dueAt = __qaDay(0) + 'T09:00:00';
    row.recurrenceRule = JSON.stringify({ freq: 'weekly', interval: 1, count: 2 });
    window.__qaDoku = [];
    window.createAutoDokuEntry = async entry => { __qaDoku.push(entry); };
  });
  const get = () => page.evaluate(() => __qaTodos.find(t => t.id === 'f1'));
  const original = await get();
  await page.evaluate(() => __followupWorkspace.open('todo:f1'));
  await act('complete').click();
  await act('undo').waitFor();
  await check('Wiedervorlage: Serie zählt weiter und protokolliert den Abschluss', async () => {
    const row = await get();
    assert.equal(row.done, false);
    assert.equal(JSON.parse(row.recurrenceRule).count, 1);
    assert.equal(row.dueAt.slice(0, 10), await page.evaluate(() => __qaDay(7)));
    assert.ok(await page.evaluate(() => __qaDoku.some(x => x.action === 'completed')));
  });
  await act('undo').click();
  await check('Rückgängig stellt Termin und Serienanzahl persistent wieder her', async () => {
    const row = await get();
    assert.equal(row.dueAt, original.dueAt);
    assert.equal(row.recurrenceRule, original.recurrenceRule);
  });
  await act('complete').click();await act('undo').waitFor();
  await page.evaluate(() => __qaTodos.find(t => t.id === 'f1').recurrenceRule = JSON.stringify({ freq: 'daily', count: 8 }));
  await act('undo').click();
  await check('Rückgängig überschreibt keine zwischenzeitlich geänderte Serie', async () => {
    await root.locator('#wv-notice').filter({ hasText: 'inzwischen geändert' }).waitFor();
    assert.equal(JSON.parse((await get()).recurrenceRule).count, 8);
  });
  await page.evaluate(() => {
    const row = __qaTodos.find(t => t.id === 'f1');
    row.recurrenceRule = JSON.stringify({ freq: 'weekly', count: 2 });row.dueAt = __qaDay(0) + 'T09:00:00';
    return __todoMiniToggle('f1', true);
  });
  await check('Abhaken in der Seitenleiste erhält die nächste Serienfälligkeit', async () => {
    assert.equal((await get()).done, false);assert.equal(JSON.parse((await get()).recurrenceRule).count, 1);
  });
  await page.evaluate(async () => { await openCalendarFullView();await __calendarShowEditForm('todo:f1'); });
  await page.getByRole('button', { name: 'Erledigen', exact: true }).click();
  await page.getByRole('button', { name: 'Wieder öffnen', exact: true }).waitFor();
  await check('Kalender beendet das letzte Vorkommen derselben Wiedervorlage', async () => assert.equal((await get()).done, true));
  await page.evaluate(() => __followupWorkspace.open('todo:f1'));
  await check('Wiedervorlagenansicht zeigt den im Kalender gespeicherten Abschluss', async () => {
    await panel.getByRole('button', { name: 'Wieder öffnen', exact: true }).waitFor();
  });
  await shot('serienabschluss-desktop');
  await act('close').first().click();await act('new').click();
  await panel.getByLabel('Fall', { exact: true }).selectOption('a');
  await panel.locator('.wv-source-option').filter({ hasText: 'Ausgabenübersicht.pdf' }).click();
  await panel.getByLabel('Titel', { exact: true }).fill('Entwurf bleibt bei vollem Speicher');
  await page.evaluate(() => {
    window.__appMode = 'local';localStorage.setItem(window.TODO_STORAGE_KEY, '[]');
    window.__qaStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === window.TODO_STORAGE_KEY || key === window.CAL_STORAGE_KEY) throw new DOMException('Voll', 'QuotaExceededError');
      return window.__qaStorageWrite.call(this, key, value);
    };
  });
  await act('save').click();
  await check('Lokaler Schreibfehler erhält den Wiedervorlagenentwurf', async () => {
    await root.locator('#wv-form-error').filter({ hasText: 'lokalen Speicher' }).waitFor();
    assert.equal(await panel.getByLabel('Titel', { exact: true }).inputValue(), 'Entwurf bleibt bei vollem Speicher');
  });
  await page.evaluate(() => Storage.prototype.setItem = window.__qaStorageWrite);
  await act('save').click();await act('edit').waitFor();
  await check('Erneutes Speichern erzeugt genau eine Wiedervorlage', async () => assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(window.TODO_STORAGE_KEY)).length), 1));
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('wiedervorlage-mobil');
  await check('Keine Laufzeitfehler während der bereichsübergreifenden Abläufe', async () => assert.deepEqual(errors, []));
};
