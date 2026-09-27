'use strict';
const assert = require('node:assert/strict'), vm = require('node:vm');
module.exports = async function refreshTests(t, { ui, file, form, node, region }) {
  const types = ['mobile-calendar', 'desktop-calendar', 'desktop-todo', 'work-todo'];
  async function view(type) {
    const x = await ui(type), c = x.c, saved = await x.create(x.kind); x.setId(saved.id);
    x.selector = type === 'mobile-calendar' ? '[data-cal-mobile-attachments]' : type === 'work-todo' ? '#todoMobileAttachments' : '[data-cal-desktop-attachments]';
    x.section = x.root.querySelector(x.selector); x.section.innerHTML = 'BEHALTEN'; x.section.append = el => { x.section.innerHTML += el.innerHTML; }; x.nodes.set('todoMobileAttachments', x.section);
    c.todoMobileNode = () => node(); c.todoWorkActive = () => true; c.todoWorkAttachmentsPolish = () => {};
    c.pendingAttachmentsHTML = () => 'PENDING[' + x.pending().map(f => f.name).join(',') + ']';
    x.render = async (_kind, id) => JSON.stringify(await x.attachments(id)); c.attachmentsSectionHTML = (...args) => x.render(...args);
    vm.runInContext(region('async function calMobileRefreshAttachments(', 'async function calMobileAttachment(') + region('async function calDesktopRefreshAttachments(', 'async function calDesktopAttachment(') + region('async function todoMobileRefreshAttachments(', "window.addEventListener('mobileBeforeNavigate'"), c);
    x.reload = () => (type === 'mobile-calendar' ? c.calMobileRefreshAttachments : type === 'work-todo' ? c.todoMobileRefreshAttachments : c.calDesktopRefreshAttachments)(saved.id); x.savedId = saved.id; return x;
  }
  await t.test('Anlagenanzeige: tatsächliche Dateien erscheinen am zugehörigen Formular', async () => {
    for (const type of types) { const x = await view(type); const att = await x.c[x.kind === 'todo' ? 'todoAddAttachment' : 'calAddAttachment'](x.savedId, file()); await x.reload(); assert.ok(x.section.innerHTML.includes(att.id)); }
  });
  await t.test('Anlagenanzeige: Antwort für eine frühere Vorgangskennung wird verworfen', async () => {
    for (const type of types) { const x = await view(type); x.render = async () => { x.setId('anderer-vorgang'); return 'VERALTET'; }; await x.reload(); assert.equal(x.section.innerHTML, 'BEHALTEN'); }
  });
  await t.test('Anlagenanzeige: Antwort aus dem vorherigen Betriebsmodus wird verworfen', async () => {
    for (const type of types) { const x = await view(type); x.render = async () => { x.c.__appMode = 'local'; return 'VERALTET'; }; await x.reload(); assert.equal(x.section.innerHTML, 'BEHALTEN'); }
  });
  await t.test('Anlagenanzeige: wiederverwendeter Formularcontainer mit neuen Eingabefeldern erhält keine alte Antwort', async () => {
    for (const type of types) { const x = await view(type); x.render = async () => { x.root.fields = [node('Neu')]; return 'VERALTET'; }; await x.reload(); assert.equal(x.section.innerHTML, 'BEHALTEN'); }
  });
  await t.test('Anlagenanzeige: anderes aktives Formular lässt den alten Bereich unverändert', async () => {
    for (const type of types) { const x = await view(type); x.render = async () => { x.controller.form = form(); return 'VERALTET'; }; await x.reload(); assert.equal(x.section.innerHTML, 'BEHALTEN'); }
  });
  await t.test('Anlagenanzeige: später gestartetes Nachladen hat Vorrang vor langsamer alter Antwort', async () => {
    for (const type of types) { const x = await view(type), resolve = []; x.render = () => new Promise(r => resolve.push(r)); const older = x.reload(), newer = x.reload(); assert.equal(resolve.length, 2); resolve[1]('NEUE ANLAGEN'); await newer; resolve[0]('ALTE ANLAGEN'); await older; assert.ok(x.section.innerHTML.includes('NEUE ANLAGEN')); assert.ok(!x.section.innerHTML.includes('ALTE ANLAGEN')); }
  });
  await t.test('Anlagenanzeige: neu gebundene Dateiauswahl wird nicht durch einen alten Abruf neu aufgebaut', async () => {
    for (const type of types) { const x = await view(type); x.render = async () => { x.select([file('Neue Auswahl.pdf')]); return 'VERALTET'; }; await x.reload(); assert.equal(x.section.innerHTML, 'BEHALTEN'); assert.equal(x.pending()[0].name, 'Neue Auswahl.pdf'); }
  });
  await t.test('Anlagenanzeige: ersetzter Anlagenbereich wird auch bei weiterhin verbundenem altem Element nicht überschrieben', async () => {
    for (const type of types) { const x = await view(type); x.render = async () => { const next = node(); next.innerHTML = 'NEUER BEREICH'; x.root.nodes.set(x.selector, next); x.nodes.set('todoMobileAttachments', next); return 'VERALTET'; }; await x.reload(); assert.equal(x.section.innerHTML, 'BEHALTEN'); assert.equal(x.root.querySelector(x.selector).innerHTML, 'NEUER BEREICH'); }
  });
};
