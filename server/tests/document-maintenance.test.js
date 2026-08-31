'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createDocumentMaintenance, _test } = require('../src/modules/documents/maintenance');
const writeBarrier = require('../src/middleware/application-write-barrier');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE doc_maintenance_plans (
      id TEXT PRIMARY KEY,label TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,
      schedule_type TEXT NOT NULL DEFAULT 'daily',weekdays TEXT NOT NULL DEFAULT '',
      time_hhmm TEXT NOT NULL DEFAULT '02:30',verification TEXT NOT NULL DEFAULT 'quick',
      apply_mode TEXT NOT NULL DEFAULT 'confirm',auto_delete INTEGER NOT NULL DEFAULT 0,
      last_started_at TEXT NOT NULL DEFAULT '',last_finished_at TEXT NOT NULL DEFAULT '',
      last_status TEXT NOT NULL DEFAULT '',last_result_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE doc_files (
      id TEXT PRIMARY KEY,folder_id TEXT NOT NULL DEFAULT '',deleted_at TEXT NOT NULL DEFAULT '',
      deleted_from TEXT NOT NULL DEFAULT '',managed INTEGER NOT NULL DEFAULT 0,
      storage_status TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare(`INSERT INTO doc_maintenance_plans
    (id,label,schedule_type,weekdays,time_hhmm,verification,apply_mode)
    VALUES ('p','Plan','daily','','02:30','quick','confirm')`).run();
  const calls = [];
  const documents = {
    async runDocumentIntegrity(mode, verification) {
      calls.push({ mode, verification });
      return {
        ok: true,
        summary: { checked: 1 },
        finder: { scan: { findings: [{ kind: 'missing_file', detail: { fileId: 'gone' } }] } }
      };
    }
  };
  return { db, calls, service: createDocumentMaintenance({ db, documents }) };
}

test('Zeitplan ist konfigurierbar und Nachhollauf verwendet den gewählten Modus', async () => {
  const f = fixture();
  f.service.update('p', {
    enabled: true, scheduleType: 'weekly', weekdays: [0, 3], timeHhmm: '03:30',
    verification: 'full', applyMode: 'automatic', autoDelete: false
  });
  const plan = f.service.list().plans[0];
  assert.deepEqual(plan.weekdays, [0, 3]);
  assert.equal(plan.applyMode, 'automatic');
  await f.service.tick(new Date('2026-07-29T04:00:00'));
  assert.deepEqual(f.calls, [{ mode: 'apply', verification: 'full' }]);
  assert.equal(f.service.list().plans[0].lastStatus, 'ok');
  f.db.close();
});

test('Finder-Löschungen brauchen eine getrennte Freigabe und verschonen verwaltete Abbilder', async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO doc_files (id,managed) VALUES ('gone',0),('managed',1)").run();
  f.service.update('p', { applyMode: 'automatic', autoDelete: true });
  const result = await f.service.run('p');
  assert.deepEqual(result.acceptedFinderDeletes, ['gone']);
  assert.notEqual(f.db.prepare("SELECT deleted_at FROM doc_files WHERE id='gone'").get().deleted_at, '');
  assert.equal(f.db.prepare("SELECT deleted_at FROM doc_files WHERE id='managed'").get().deleted_at, '');
  f.db.close();
});

test('Zeit- und Intervallvalidierung sowie letzter wöchentlicher Termin', () => {
  const f = fixture();
  assert.throws(() => f.service.update('p', { timeHhmm: '25:61' }));
  assert.throws(() => f.service.update('p', { scheduleType: 'monthly' }));
  const due = _test.lastScheduled(
    { schedule_type: 'weekly', weekdays: '0', time_hhmm: '03:30' },
    new Date('2026-07-28T10:00:00')
  );
  assert.equal(due.getDay(), 0);
  assert.equal(due.getHours(), 3);
  f.db.close();
});

test('Automatischer Plattenabgleich wartet hinter der Sicherungsschranke und bleibt nachholbar', async () => {
  writeBarrier._test.resetForTests();
  const f = fixture();
  const lock = await writeBarrier.begin('Test-Gesamtsicherung');
  try {
    const result = await f.service.tick(new Date('2026-07-29T04:00:00'));
    assert.deepEqual(result, { skipped: true, reason: 'backup_write_barrier' });
    assert.deepEqual(f.calls, []);
    assert.equal(f.service.list().plans[0].lastFinishedAt, '');
  } finally {
    lock.release();
    writeBarrier._test.resetForTests();
    f.db.close();
  }
});
