/* Aufgaben-Feed (PLAN-AUFGABEN-SYNC, Etappe 4): der schreibarme CalDAV-Endpunkt.
 *
 * Rund-lauf-Prüfung mit den eigenen Werkzeugen: der ICS, den der Feed ausliefert, wird mit dem
 * hauseigenen CalDAV-Parser wieder eingelesen (dieselbe Bibliothek, mit der die App fremde
 * Server liest - wenn die beiden sich nicht verstehen, versteht uns auch kein Fremd-Client).
 * Dazu die Schreibgrenzen: Erledigt-Rückmeldung ja, Inhaltsänderung nein, Fristen nie.
 */
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-'));
process.env.DB_PATH = path.join(temp, 'test.sqlite3');
process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
process.env.ENCRYPTION_KEY = '44'.repeat(32);

const db = require('../src/database/index');
const caldav = require('../src/integrations/calendar/caldav');
const handler = require('../src/modules/feeds/dav-routes');

const TOKEN = 'test-feed-token-0123456789abcdef0123456789abcd';

function seed() {
  db.prepare('DELETE FROM feed_tokens').run();
  db.prepare('DELETE FROM todos').run();
  db.prepare('INSERT INTO feed_tokens (id, label, token_hash) VALUES (?, ?, ?)')
    .run('ft-1', 'Prüfstand', crypto.createHash('sha256').update(TOKEN, 'utf8').digest('hex'));
  const ins = db.prepare(`
    INSERT INTO todos (id, title, description, due_at, done, priority, item_type, visibility, source)
    VALUES (@id, @title, @description, @dueAt, @done, @priority, @itemType, @visibility, 'local')
  `);
  ins.run({ id: 'aufgabe-1', title: 'Bericht schreiben', description: 'Jahresbericht §1863', dueAt: '2026-08-20', done: 0, priority: 'high', itemType: 'task', visibility: 'public' });
  ins.run({ id: 'frist-1', title: 'Frist: Widerspruch', description: '', dueAt: '2026-08-15', done: 0, priority: 'normal', itemType: 'deadline', visibility: 'public' });
  ins.run({ id: 'privat-1', title: 'Privat', description: '', dueAt: '', done: 0, priority: 'normal', itemType: 'task', visibility: 'private' });
}

// Der Handler ist eine Express-Middleware; hier bekommt er die zwei Express-Felder, die er
// nutzt (path relativ zum Mount, query), von Hand - mehr Express braucht er nicht.
function serve() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    req.path = u.pathname;
    req.query = Object.fromEntries(u.searchParams);
    handler(req, res);
  });
}

function request(port, method, pathName, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathName, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('Aufgaben-Feed (CalDAV)', async (t) => {
  seed();
  const server = serve();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => server.close());

  await t.test('ohne gültigen Token: 401', async () => {
    const r = await request(port, 'PROPFIND', '/falscher-token/');
    assert.equal(r.status, 401);
  });

  await t.test('PROPFIND Depth:1 listet Sammlung + Einträge, aber nie Private', async () => {
    const r = await request(port, 'PROPFIND', `/${TOKEN}/`, '<?xml version="1.0"?><propfind/>', { Depth: '1' });
    assert.equal(r.status, 207);
    assert.match(r.body, /VTODO/);
    assert.match(r.body, /aufgabe-1\.ics/);
    assert.match(r.body, /frist-1\.ics/);
    assert.ok(!r.body.includes('privat-1'), 'Private Aufgaben dürfen den Feed nie erreichen.');
    assert.match(r.body, /getctag/);
  });

  await t.test('REPORT liefert Kalenderdaten, die unser eigener Parser versteht', async () => {
    const r = await request(port, 'REPORT', `/${TOKEN}/`, '<?xml version="1.0"?><calendar-query/>');
    assert.equal(r.status, 207);
    // Rundlauf: calendar-data herausziehen und mit dem hauseigenen Parser lesen.
    const data = [...r.body.matchAll(/<c:calendar-data>([\s\S]*?)<\/c:calendar-data>/g)]
      .map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
    assert.equal(data.length, 2);
    const todos = data.flatMap((ics) => caldav.parseIcsComponents(ics).filter((c) => c.type === 'VTODO').map(caldav.componentToTodo));
    const bericht = todos.find((x) => x.title === 'Bericht schreiben');
    assert.ok(bericht, 'Der eigene Parser muss den eigenen Feed lesen können.');
    assert.ok(!bericht.done, 'Offen muss offen bleiben (der Parser liefert dafür einen falsy-Wert).');
    assert.equal(String(bericht.dueAt || '').slice(0, 10), '2026-08-20');
  });

  await t.test('GET auf die Sammlung ist ein ICS-Gesamtabo', async () => {
    const r = await request(port, 'GET', `/${TOKEN}/`);
    assert.equal(r.status, 200);
    assert.match(r.body, /^BEGIN:VCALENDAR/);
    assert.equal((r.body.match(/BEGIN:VTODO/g) || []).length, 2);
  });

  await t.test('PUT mit COMPLETED hakt die Aufgabe lokal ab (einziger Schreibweg)', async () => {
    const ics = caldav.buildVtodo({ uid: 'aufgabe-1', title: 'Bericht schreiben', description: 'Jahresbericht §1863', dueAt: '2026-08-20', done: true, priority: 'high' });
    const r = await request(port, 'PUT', `/${TOKEN}/aufgabe-1.ics`, ics, { 'Content-Type': 'text/calendar' });
    assert.equal(r.status, 204);
    assert.equal(db.prepare('SELECT done FROM todos WHERE id = ?').get('aufgabe-1').done, 1);
  });

  await t.test('PUT mit Inhaltsänderung ohne Statuswechsel: 403 + Journal', async () => {
    const ics = caldav.buildVtodo({ uid: 'aufgabe-1', title: 'UMBENANNT', description: '', dueAt: '', done: true, priority: 'normal' });
    const r = await request(port, 'PUT', `/${TOKEN}/aufgabe-1.ics`, ics, { 'Content-Type': 'text/calendar' });
    assert.equal(r.status, 403);
    assert.equal(db.prepare('SELECT title FROM todos WHERE id = ?').get('aufgabe-1').title, 'Bericht schreiben');
  });

  await t.test('PUT auf eine Frist: immer 403 (Nur-Export)', async () => {
    const ics = caldav.buildVtodo({ uid: 'frist-1', title: 'Frist: Widerspruch', description: '', dueAt: '2026-08-15', done: true, priority: 'normal' });
    const r = await request(port, 'PUT', `/${TOKEN}/frist-1.ics`, ics, { 'Content-Type': 'text/calendar' });
    assert.equal(r.status, 403);
    assert.equal(db.prepare('SELECT done FROM todos WHERE id = ?').get('frist-1').done, 0, 'Die Frist bleibt unangetastet.');
    const actions = db.prepare('SELECT action FROM sync_journal').all().map((x) => x.action);
    assert.ok(actions.includes('verworfen'));
  });

  await t.test('DELETE wird abgelehnt', async () => {
    const r = await request(port, 'DELETE', `/${TOKEN}/aufgabe-1.ics`);
    assert.equal(r.status, 403);
    assert.ok(db.prepare('SELECT id FROM todos WHERE id = ?').get('aufgabe-1'));
  });

  await t.test('Basic-Auth mit Token als Passwort funktioniert als Ersatzweg', async () => {
    const auth = 'Basic ' + Buffer.from('egal:' + TOKEN).toString('base64');
    const r = await request(port, 'GET', '/', null, { Authorization: auth });
    assert.equal(r.status, 200);
    assert.match(r.body, /BEGIN:VCALENDAR/);
  });
});
