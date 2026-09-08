'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
const chat = html.slice(html.indexOf('   NUTZERCHAT (Nutzerwunsch 2026-08-12)'), html.indexOf('<script id="export-name-templates-v1">'));
function fn(name) {
  const start = chat.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = chat.indexOf('\n  function ', start + 1);
  return chat.slice(start, end);
}
function harness() {
  const ctx = { events: [], visible: false, mobile: true, reads: [], notifications: [], rendered: 0,
    convs: [{ id: 'a', unread: 2 }, { id: 'b', unread: 1 }], built: true, ME: { id: 1 }, panelOpen: true, activeConvId: 'a', msgs: [], seenIds: new Set() };
  ctx.document = { hidden: false, documentElement: { classList: { contains: () => ctx.mobile } } };
  ctx.$ = () => ({ classList: { contains: () => ctx.visible } });
  ctx.window = { dispatchEvent: event => ctx.events.push(event.detail) };
  ctx.CustomEvent = class { constructor(name, options) { this.type = name; this.detail = options.detail; } };
  ctx.markRead = id => { ctx.reads.push(id); ctx.convs.find(c => c.id === id).unread = 0; };
  ctx.showToast = id => ctx.notifications.push(id);
  ctx.renderLog = () => {};
  ctx.renderConvList = () => ctx.rendered++;
  vm.createContext(ctx);
  // These are the shipping functions, not a parallel badge implementation.
  vm.runInContext(['unreadTotal', 'getState', 'publishState', 'conversationVisible', 'appendIncoming'].map(fn).join('\n'), ctx);
  return ctx;
}
test('Chats zählt ungelesene Nachrichten über alle Gespräche und liefert nur Metadaten', () => {
  const c = harness();
  c.publishState();
  assert.deepEqual(JSON.parse(JSON.stringify(c.events[0])), { available: true, unread: 3, unreadConversations: 2, open: true });
});
test('Auf der mobilen Gesprächsliste bleibt eine neue Nachricht im zuletzt geöffneten Gespräch ungelesen', () => {
  const c = harness();
  c.appendIncoming('a', { id: 'm1', body: 'Beispiel', createdAt: '2026-09-07T08:00:00Z' }, false);
  assert.equal(c.unreadTotal(), 4);
  assert.deepEqual(c.reads, []);
  assert.deepEqual(c.notifications, ['a']);
});
test('Nur eine sichtbare Unterhaltung im aktiven Tab wird gelesen; Wiederholungen zählen nicht doppelt', () => {
  const c = harness(); c.visible = true;
  const message = { id: 'm1', body: 'Beispiel' };
  c.appendIncoming('a', message, false); c.appendIncoming('a', message, false);
  assert.deepEqual(c.reads, ['a']);
  assert.equal(c.unreadTotal(), 1);
  assert.equal(c.msgs.length, 1);
  c.document.hidden = true;
  c.appendIncoming('a', { id: 'm2' }, false);
  assert.equal(c.unreadTotal(), 2);
});
test('Nachladen neuer Gespräche verdoppelt ihren Server-Zähler nicht', () => {
  const c = harness();
  c.appendIncoming('b', { id: 'm1' }, false, true);
  assert.equal(c.unreadTotal(), 3);
});
test('Desktop behält Zweispalten-Verhalten, ohne Auswahl entsteht keine Gelesen-Anfrage', () => {
  const c = harness(); c.mobile = false;
  assert.equal(c.conversationVisible('a'), true);
  c.activeConvId = null;
  assert.equal(c.conversationVisible(null), false);
});
