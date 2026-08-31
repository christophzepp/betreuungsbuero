'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const Database = require('better-sqlite3');
const backup = require('../src/modules/backup/document-backup');
const barrier = require('../src/middleware/application-write-barrier');
const coordinator = require('../src/modules/documents/operation-coordinator');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE doc_backup_jobs (
      id TEXT PRIMARY KEY,label TEXT NOT NULL DEFAULT '',interval TEXT NOT NULL DEFAULT 'taeglich',
      weekdays TEXT NOT NULL DEFAULT '',time_hhmm TEXT NOT NULL DEFAULT '02:00',
      source_json TEXT NOT NULL DEFAULT '{}',target_json TEXT NOT NULL DEFAULT '{}',
      options_json TEXT NOT NULL DEFAULT '{}',enabled INTEGER NOT NULL DEFAULT 1,
      config_changed_at TEXT NOT NULL DEFAULT '',
      last_run_at TEXT NOT NULL DEFAULT '',last_result TEXT NOT NULL DEFAULT '',
      run_started_at TEXT NOT NULL DEFAULT '',last_scheduled_at TEXT NOT NULL DEFAULT '',
      next_retry_at TEXT NOT NULL DEFAULT '',retry_count INTEGER NOT NULL DEFAULT 0,
      last_success_at TEXT NOT NULL DEFAULT '',mount_cursor_at TEXT NOT NULL DEFAULT '',
      last_failure_at TEXT NOT NULL DEFAULT '',
      last_warning_at TEXT NOT NULL DEFAULT '',last_warning_key TEXT NOT NULL DEFAULT '',
      last_mail_at TEXT NOT NULL DEFAULT '',last_mail_error TEXT NOT NULL DEFAULT '',
      retry_context_json TEXT NOT NULL DEFAULT '{}',
      created_by INTEGER,created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE doc_backup_scheduler_state (
      id INTEGER PRIMARY KEY,started_at TEXT NOT NULL DEFAULT '',heartbeat_at TEXT NOT NULL DEFAULT '',
      last_tick_at TEXT NOT NULL DEFAULT '',last_tick_error TEXT NOT NULL DEFAULT '',
      last_tick_error_at TEXT NOT NULL DEFAULT '',health_status TEXT NOT NULL DEFAULT 'not_configured',
      health_key TEXT NOT NULL DEFAULT '',last_health_change_at TEXT NOT NULL DEFAULT '',
      last_warning_at TEXT NOT NULL DEFAULT '',last_mail_at TEXT NOT NULL DEFAULT '',
      last_mail_error TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO doc_backup_scheduler_state (id) VALUES (1);
    CREATE TABLE doc_folders (
      id TEXT PRIMARY KEY,area TEXT,case_id TEXT,parent_id TEXT,name TEXT,
      created_at TEXT DEFAULT '',updated_at TEXT DEFAULT ''
    );
    CREATE TABLE doc_files (
      id TEXT PRIMARY KEY,area TEXT,case_id TEXT,folder_id TEXT,name TEXT,
      mime_type TEXT,size INTEGER DEFAULT 0,updated_at TEXT DEFAULT '',deleted_at TEXT DEFAULT ''
    );
    CREATE TABLE cases (id TEXT PRIMARY KEY,label TEXT,stammdaten_json TEXT DEFAULT '{}');
    CREATE TABLE case_doku_entries (
      id TEXT PRIMARY KEY,case_id TEXT,data_json TEXT DEFAULT '{}',created_at TEXT DEFAULT ''
    );
    CREATE TABLE inbox_documents (
      id TEXT PRIMARY KEY,file_name TEXT,mime_type TEXT,size INTEGER DEFAULT 0,
      inbox_date TEXT,received_date TEXT,created_at TEXT
    );
    CREATE TABLE finance_receipts (
      id TEXT PRIMARY KEY,filename TEXT,mime_type TEXT,size INTEGER DEFAULT 0,invoice_date TEXT
    );
    CREATE TABLE finance_statements (
      id TEXT PRIMARY KEY,filename TEXT,mime_type TEXT,size INTEGER DEFAULT 0,uploaded_at TEXT
    );
    CREATE TABLE finance_transactions (id TEXT PRIMARY KEY,statement_id TEXT,booking_date TEXT);
    CREATE TABLE intake_files (
      id TEXT PRIMARY KEY,draft_id TEXT,file_name TEXT,mime_type TEXT,data BLOB
    );
    CREATE TABLE doc_module_import (
      quelle TEXT,quell_id TEXT,file_id TEXT DEFAULT '',PRIMARY KEY(quelle,quell_id)
    );
    CREATE TABLE doc_import_jobs (
      id TEXT PRIMARY KEY,label TEXT DEFAULT '',mount_id TEXT DEFAULT '',
      source_path TEXT DEFAULT '',target_json TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,last_run_at TEXT DEFAULT '',last_result TEXT DEFAULT ''
    );
    CREATE TABLE doc_import_state (
      job_id TEXT,pfad TEXT,merkmal TEXT,sha256 TEXT,file_id TEXT,imported_at TEXT,
      PRIMARY KEY(job_id,pfad)
    );
    CREATE TABLE doc_pair_jobs (
      id TEXT PRIMARY KEY,label TEXT DEFAULT '',mount_id TEXT DEFAULT '',
      source_path TEXT DEFAULT '',target_json TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,last_run_at TEXT DEFAULT '',last_result TEXT DEFAULT ''
    );
    CREATE TABLE doc_pair_state (
      pair_id TEXT,pfad TEXT,remote_merkmal TEXT,sha256 TEXT,file_id TEXT,synced_at TEXT,
      PRIMARY KEY(pair_id,pfad)
    );
  `);
  const filePaths = new Map();
  const intern = {
    cleanName: (value) => String(value || ''),
    findBlobPath: (row) => filePaths.get(String(row && row.id || '')) || null,
    mountInfo: () => ({ label: 'Test-Mount', kind: 'localdir' }),
    mountOrdner: async () => {},
    mountSchreib: async () => {}
  };
  return { db, intern, filePaths };
}

function totalJob(db, overrides) {
  const row = {
    id: 'total',
    label: 'Nächtliche Gesamtsicherung',
    interval: 'taeglich',
    weekdays: '',
    time: '02:30',
    source: JSON.stringify({ bereich: 'alles', caseId: '' }),
    target: JSON.stringify({ art: 'gesamt', ordner: '/extern/backup' }),
    options: JSON.stringify({
      retry: { maxRetries: 2, backoffMinutes: [5, 30] },
      timeoutMinutes: 90,
      catchUp: true,
      overdueHours: 36,
      consistencyRetries: 3,
      localTargetEncryptedAttested: true,
      alert: { email: true, repeatHours: 24 },
      retention: { enabled: true, daily: 14, monthly: 12, yearly: 10, minFreeGb: 8 },
      offsite: {
        enabled: true, mode: 'restic', repository: 's3:https://example.invalid/bucket',
        passwordFile: '/run/secrets/restic-password', tag: 'buero', required: true,
        immutableAttested: true, lifecycleAttested: true
      }
    }),
    created: '2026-07-01T00:00:00.000Z',
    runStarted: ''
  };
  Object.assign(row, overrides || {});
  db.prepare(`
    INSERT INTO doc_backup_jobs
      (id,label,interval,weekdays,time_hhmm,source_json,target_json,options_json,created_at,run_started_at)
    VALUES
      (@id,@label,@interval,@weekdays,@time,@source,@target,@options,@created,@runStarted)
  `).run(row);
}

function mountJob(db, overrides) {
  const row = {
    id: 'mount',
    label: 'Mount-Sicherung',
    interval: 'laufend',
    weekdays: '',
    time: '00:00',
    source: JSON.stringify({ bereich: 'alles', caseId: '' }),
    target: JSON.stringify({ art: 'mount', mountId: 'mount-a', unterordner: 'Sicherung' }),
    options: JSON.stringify({ timeoutMinutes: 1 }),
    created: '2026-07-28T00:00:00.000Z'
  };
  Object.assign(row, overrides || {});
  db.prepare(`
    INSERT INTO doc_backup_jobs
      (id,label,interval,weekdays,time_hhmm,source_json,target_json,options_json,created_at)
    VALUES
      (@id,@label,@interval,@weekdays,@time,@source,@target,@options,@created)
  `).run(row);
}

test('Optionen validieren Remote-Offsite, Retention und getrennte Konsistenz-Retries', () => {
  assert.throws(() => backup.normalisiereOptionen({
    offsite: { enabled: true, repository: '/Volumes/NAS', passwordFile: '/secret' }
  }), /entferntes restic-Repository/);
  assert.throws(() => backup.normalisiereOptionen({
    offsite: { enabled: true, repository: 's3:bucket', passwordFile: 'relative' }
  }), /absoluter Serverpfad/);
  assert.throws(() => backup.normalisiereOptionen({
    offsite: { enabled: true, repository: 'rest:https://user:secret@example.invalid', passwordFile: '/secret' }
  }), /Zugangsdaten dürfen nicht im Repository/);
  const options = backup.normalisiereOptionen({
    retry: { maxRetries: 1, backoffMinutes: [7] },
    consistencyRetries: 4,
    retention: {
      enabled: true, daily: 9, monthly: 5, yearly: 3, diagnostic: 4, minFreeGb: 20
    },
    offsite: {
      enabled: true, repository: 'sftp:user@example:/backup',
      passwordFile: '/run/secrets/restic', required: true, readSlices: 5
    }
  });
  assert.equal(options.retry.maxRetries, 1);
  assert.equal(options.consistencyRetries, 4);
  assert.deepEqual(options.retention, {
    enabled: true, daily: 9, monthly: 5, yearly: 3, diagnostic: 4, minFreeGb: 20
  });
  assert.equal(options.offsite.repository, 'sftp:user@example:/backup');
  assert.equal(options.offsite.readSlices, 5);
});

test('Verpasster Wochenlauf wird nachgeholt, bei deaktiviertem Catch-up aber nicht', () => {
  const now = new Date(2026, 6, 28, 12, 0, 0); // Dienstag
  const job = {
    enabled: 1, interval: 'woechentlich', weekdays: '7', time_hhmm: '03:30',
    created_at: '2026-07-01T00:00:00.000Z', last_scheduled_at: '', last_run_at: '',
    options_json: JSON.stringify({ catchUp: true })
  };
  const due = backup._test.faelligkeit(job, now);
  assert.equal(due.art, 'schedule');
  assert.equal(new Date(due.scheduledAt).getDay(), 0);
  assert.equal(backup._test.faelligkeit({ ...job, options_json: JSON.stringify({ catchUp: false }) }, now), false);
});

test('Überfälligkeit folgt dem nächsten geplanten Wochen- oder Monatstermin', () => {
  const base = {
    id: 'rhythm', label: 'Rhythmische Gesamtsicherung', enabled: 1,
    target_json: '{"art":"gesamt"}',
    created_at: '2026-07-01T00:00:00.000Z',
    last_failure_at: '', run_started_at: '', next_retry_at: '', retry_count: 0,
    last_run_at: '2026-07-26T04:00:00.000Z',
    last_success_at: '2026-07-26T04:00:00.000Z',
    config_changed_at: '', last_result: 'ok: STATUS=VOLLSTAENDIG',
    options_json: JSON.stringify({
      overdueHours: 36,
      retention: { enabled: true },
      localTargetEncryptedAttested: true,
      offsite: {
        enabled: true, repository: 's3:bucket',
        passwordFile: '/run/secrets/restic',
        immutableAttested: true, lifecycleAttested: true
      }
    })
  };

  const weekly = { ...base, interval: 'woechentlich', weekdays: '7', time_hhmm: '03:30' };
  const beforeWeeklyDue = backup._test.healthFuerJob(weekly, new Date(2026, 6, 31, 12, 0, 0));
  assert.equal(beforeWeeklyDue.overdue, false, 'vor dem nächsten Sonntag darf ein Wochenplan nicht überfällig sein');
  assert.equal(beforeWeeklyDue.status, 'ok');
  const afterWeeklyGrace = backup._test.healthFuerJob(weekly, new Date(2026, 7, 3, 16, 0, 0));
  assert.equal(afterWeeklyGrace.overdue, true);
  assert.equal(afterWeeklyGrace.reasonCode, 'overdue');

  const monthly = {
    ...base,
    interval: 'monatlich', weekdays: '15', time_hhmm: '02:30',
    last_run_at: '2026-07-15T03:00:00.000Z',
    last_success_at: '2026-07-15T03:00:00.000Z'
  };
  const beforeMonthlyDue = backup._test.healthFuerJob(monthly, new Date(2026, 7, 14, 23, 0, 0));
  assert.equal(beforeMonthlyDue.overdue, false, 'vor dem nächsten Monatstermin darf ein Monatsplan nicht überfällig sein');
  const afterMonthlyGrace = backup._test.healthFuerJob(monthly, new Date(2026, 7, 16, 14, 0, 0));
  assert.equal(afterMonthlyGrace.overdue, false, 'die Toleranz beginnt erst am fälligen Monatstermin');
  const monthlyCritical = backup._test.healthFuerJob(monthly, new Date(2026, 7, 17, 15, 0, 0));
  assert.equal(monthlyCritical.overdue, true);
  assert.equal(monthlyCritical.reasonCode, 'overdue');
});

test('Ungültiges options_json wird kritisch gemeldet und niemals mit Defaults ausgeführt', async () => {
  assert.throws(
    () => backup._test.optionenVonJob({ options_json: '{"retry":' }),
    /Ungültige Sicherungsoptionen \(JSON\)/
  );
  assert.throws(
    () => backup._test.optionenVonJob({ options_json: '{"timeoutMinutes":0}' }),
    /Ungültige Sicherungsoptionen/
  );
  assert.throws(
    () => backup._test.optionenVonJob({ options_json: '[]' }),
    /JSON-Objekt/
  );

  const f = fixture();
  totalJob(f.db, { options: '{"timeoutMinutes":0}' });
  let calls = 0;
  const now = new Date(2026, 6, 28, 4, 0, 0);
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    now: () => new Date(now),
    sendHealthMail: async () => {},
    runTotalBackup: async () => {
      calls++;
      return { text: 'darf nicht laufen' };
    }
  });
  try {
    await backup._test.tick();
    assert.equal(calls, 0);
    const status = backup.health(now);
    assert.equal(status.status, 'critical');
    assert.equal(status.jobs[0].reasonCode, 'invalid_options');
    assert.match(status.jobs[0].reason, /nicht ausgeführt/);
    assert.equal(status.jobs[0].options, null);
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Fehler wird begrenzt wiederholt und erfolgreicher Lauf transportiert Härtungsoptionen', async () => {
  const f = fixture();
  totalJob(f.db);
  let now = new Date(2026, 6, 28, 4, 0, 0);
  const calls = [];
  const mails = [];
  let fail = true;
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    now: () => new Date(now),
    sendHealthMail: async (info, recovered) => { mails.push({ status: info.status, recovered }); },
    runTotalBackup: async (options) => {
      calls.push(options);
      if (fail) throw new Error('Testziel nicht erreichbar');
      options.onLocalSnapshotReady();
      return { text: 'STATUS=VOLLSTAENDIG DATEIEN=8' };
    }
  });
  try {
    await backup._test.tick();
    let row = f.db.prepare("SELECT * FROM doc_backup_jobs WHERE id='total'").get();
    assert.match(row.last_result, /Wiederholung 1\/2 in 5 Min/);
    assert.equal(row.retry_count, 1);
    assert.ok(row.next_retry_at);
    assert.equal(calls.length, 1);

    fail = false;
    now = new Date(new Date(row.next_retry_at).getTime() + 1000);
    await backup._test.tick();
    row = f.db.prepare("SELECT * FROM doc_backup_jobs WHERE id='total'").get();
    assert.match(row.last_result, /^ok:/);
    assert.ok(row.last_success_at);
    assert.equal(row.retry_count, 0);
    assert.equal(row.next_retry_at, '');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].timeoutMs, 90 * 60000);
    assert.equal(calls[1].consistencyRetries, 3);
    assert.deepEqual(calls[1].retention, {
      daily: 14, monthly: 12, yearly: 10, diagnostic: 6
    });
    assert.deepEqual(calls[1].capacity, {
      warningPercent: 15,
      warningBytes: 8 * 1024 * 1024 * 1024
    });
    assert.deepEqual(calls[1].offsite, {
      enabled: true,
      mode: 'restic',
      repository: 's3:https://example.invalid/bucket',
      passwordFile: '/run/secrets/restic-password',
      tag: 'buero',
      required: true,
      retentionMode: 'external',
      maxPending: 14,
      checkDays: 7,
      readSlices: 7
    });
    assert.ok(mails.length >= 1, 'Zustandswechsel müssen den Warnkanal erreichen.');
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('persistierter Offsite-Retry lädt nur den fertigen Snapshot und errichtet keine neue Schreibsperre', async () => {
  const f = fixture();
  const targetId = 'd23e25f1-270e-43f0-8b71-e64212b33ab5';
  const rawOptions = {
    retry: { maxRetries: 2, backoffMinutes: [5, 30] },
    timeoutMinutes: 90,
    catchUp: true,
    consistencyRetries: 2,
    backupTargetId: targetId,
    retention: { enabled: true },
    offsite: {
      enabled: true,
      repository: 's3:https://example.invalid/bucket',
      passwordFile: '/run/secrets/restic-password',
      tag: 'buero',
      required: true
    }
  };
  totalJob(f.db, {
    target: JSON.stringify({ art: 'gesamt', ordner: '/extern/backup' }),
    options: JSON.stringify(rawOptions),
    created: '2026-07-27T00:00:00.000Z'
  });
  let now = new Date('2026-07-28T03:00:00.000Z');
  const calls = [];
  let snapshotPreparations = 0;
  const materializations = require('../src/modules/documents/materializations');
  const originalCurrent = materializations.current;
  materializations.current = () => ({
    prepareTotalBackup() {
      snapshotPreparations += 1;
      return { office: [], cases: {} };
    }
  });
  const runner = async (options) => {
    calls.push(options);
    if (calls.length === 1) {
      options.onLocalSnapshotReady({
        snapshot: '/extern/backup/Gesamtsicherung_20260728_030000_retry'
      });
      assert.equal(
        JSON.parse(f.db.prepare("SELECT retry_context_json FROM doc_backup_jobs WHERE id='total'").get().retry_context_json).kind,
        'offsite-pending',
        'der Remote-Retry-Grund muss bereits vor dem ersten Remote-Byte crashfest gespeichert sein'
      );
      const error = new Error('Remoteziel vorübergehend nicht erreichbar');
      error.localComplete = true;
      error.offsitePending = true;
      error.snapshot = '/extern/backup/Gesamtsicherung_20260728_030000_retry';
      throw error;
    }
    assert.equal(options.resumeOffsiteOnly, true);
    assert.equal(options.resumeSnapshot, 'Gesamtsicherung_20260728_030000_retry');
    assert.equal(Object.hasOwn(options, 'onLocalSnapshotReady'), false);
    return { text: 'RESUME_SNAPSHOT=/extern/backup/Gesamtsicherung_20260728_030000_retry' };
  };
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    now: () => new Date(now),
    sendHealthMail: async () => {},
    runTotalBackup: runner
  });
  try {
    await backup._test.tick();
    let row = f.db.prepare("SELECT * FROM doc_backup_jobs WHERE id='total'").get();
    assert.equal(JSON.parse(row.retry_context_json).kind, 'offsite-pending');
    assert.ok(row.next_retry_at);
    assert.equal(snapshotPreparations, 1);

    // Ein Prozessneustart darf die Remote-only-Absicht nicht verlieren.
    backup.stop({ reset: true });
    now = new Date(new Date(row.next_retry_at).getTime() + 1000);
    backup.start({
      db: f.db,
      intern: f.intern,
      ohneTakt: true,
      now: () => new Date(now),
      sendHealthMail: async () => {},
      runTotalBackup: runner
    });

    let releaseHeldWrite;
    let heldWriteEntered;
    const heldEntered = new Promise((resolve) => { heldWriteEntered = resolve; });
    const heldWrite = barrier.withWrite('parallel laufender Fachschreiber', () => {
      heldWriteEntered();
      return new Promise((resolve) => { releaseHeldWrite = resolve; });
    });
    await heldEntered;
    await backup._test.tick();
    releaseHeldWrite();
    await heldWrite;

    row = f.db.prepare("SELECT * FROM doc_backup_jobs WHERE id='total'").get();
    assert.equal(calls.length, 2);
    assert.equal(snapshotPreparations, 1, 'der reine Offsite-Retry darf keine Abbilder neu materialisieren');
    assert.equal(row.retry_context_json, '{}');
    assert.equal(row.retry_count, 0);
    assert.match(row.last_result, /^ok:/);
  } finally {
    materializations.current = originalCurrent;
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('manueller oder neuer planmäßiger Lauf nimmt trotz Pending immer eine frische lokale Generation auf', async () => {
  const f = fixture();
  const targetId = '7d296d4b-fdc4-4820-a0ad-9fe8fc896335';
  totalJob(f.db, {
    options: JSON.stringify({
      backupTargetId: targetId,
      retention: { enabled: true },
      offsite: {
        enabled: true,
        repository: 's3:https://example.invalid/bucket',
        passwordFile: '/run/secrets/restic-password',
        required: true
      }
    })
  });
  f.db.prepare(`
    UPDATE doc_backup_jobs
       SET retry_context_json=?,next_retry_at='2099-01-01T00:00:00.000Z',retry_count=1
     WHERE id='total'
  `).run(JSON.stringify({
    kind: 'offsite-pending',
    snapshot: 'Gesamtsicherung_20260727_023000_alt',
    targetId
  }));
  let calls = 0;
  let prepared = 0;
  const materializations = require('../src/modules/documents/materializations');
  const originalCurrent = materializations.current;
  materializations.current = () => ({
    prepareTotalBackup() {
      prepared += 1;
      return { office: [], cases: {} };
    }
  });
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    sendHealthMail: async () => {},
    runTotalBackup: async (options) => {
      calls += 1;
      assert.notEqual(options.resumeOffsiteOnly, true);
      assert.deepEqual(
        JSON.parse(f.db.prepare("SELECT retry_context_json FROM doc_backup_jobs WHERE id='total'").get().retry_context_json),
        {
          kind: 'offsite-pending',
          snapshot: 'Gesamtsicherung_20260727_023000_alt',
          targetId
        },
        'der alte Remote-Zeiger wurde vor der Bestätigung des neuen Snapshots gelöscht'
      );
      options.onLocalSnapshotReady({
        snapshot: '/extern/backup/Gesamtsicherung_20260728_120000_neu'
      });
      return { text: 'SNAPSHOT=/extern/backup/Gesamtsicherung_20260728_120000_neu' };
    }
  });
  try {
    const accepted = backup.starteJetzt('total');
    assert.equal(accepted.started, true);
    const result = await accepted.completion;
    assert.equal(result.ok, true);
    assert.equal(calls, 1);
    assert.equal(prepared, 1);
    const row = f.db.prepare("SELECT retry_context_json,retry_count FROM doc_backup_jobs WHERE id='total'").get();
    assert.equal(row.retry_context_json, '{}');
    assert.equal(row.retry_count, 0);
  } finally {
    materializations.current = originalCurrent;
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Fehler eines frischen Laufs vor SNAPSHOT bewahrt den vorhandenen Offsite-Retry-Kontext', async () => {
  const f = fixture();
  const targetId = '716735b8-e95a-4c54-9f15-59762f402ff1';
  const oldContext = {
    kind: 'offsite-pending',
    snapshot: 'Gesamtsicherung_20260727_023000_alt',
    targetId
  };
  totalJob(f.db, {
    options: JSON.stringify({
      backupTargetId: targetId,
      retry: { maxRetries: 2, backoffMinutes: [5, 30] },
      retention: { enabled: true },
      offsite: {
        enabled: true,
        repository: 's3:https://example.invalid/bucket',
        passwordFile: '/run/secrets/restic-password',
        required: true
      }
    })
  });
  f.db.prepare(`
    UPDATE doc_backup_jobs
       SET retry_context_json=?,next_retry_at='2099-01-01T00:00:00.000Z',retry_count=1
     WHERE id='total'
  `).run(JSON.stringify(oldContext));
  const materializations = require('../src/modules/documents/materializations');
  const originalCurrent = materializations.current;
  materializations.current = () => ({
    prepareTotalBackup() {
      return { office: [], cases: {} };
    }
  });
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    sendHealthMail: async () => {},
    runTotalBackup: async () => {
      assert.deepEqual(
        JSON.parse(f.db.prepare("SELECT retry_context_json FROM doc_backup_jobs WHERE id='total'").get().retry_context_json),
        oldContext
      );
      throw new Error('Abbruch vor lokaler Snapshot-Bestätigung');
    }
  });
  try {
    const accepted = backup.starteJetzt('total');
    assert.equal(accepted.started, true);
    const result = await accepted.completion;
    assert.equal(result.ok, false);
    assert.match(result.error, /vor lokaler Snapshot-Bestätigung/);
    const row = f.db.prepare(
      "SELECT retry_context_json,next_retry_at FROM doc_backup_jobs WHERE id='total'"
    ).get();
    assert.deepEqual(JSON.parse(row.retry_context_json), oldContext);
    assert.ok(row.next_retry_at);
  } finally {
    materializations.current = originalCurrent;
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Serverstart kennzeichnet alten Lauf als unterbrochen und plant genau einen Retry', () => {
  const f = fixture();
  totalJob(f.db, { runStarted: '2026-07-28T01:00:00.000Z' });
  const now = new Date('2026-07-28T05:00:00.000Z');
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    now: () => new Date(now),
    sendHealthMail: async () => {},
    runTotalBackup: async () => ({ text: 'ok' })
  });
  try {
    const row = f.db.prepare("SELECT * FROM doc_backup_jobs WHERE id='total'").get();
    assert.equal(row.run_started_at, '');
    assert.equal(row.retry_count, 1);
    assert.match(row.last_result, /Serverabbruch unterbrochen.*Wiederholung 1\/2/);
    assert.equal(new Date(row.next_retry_at).getTime(), now.getTime() + 5 * 60000);
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Serverstart reconciliiert einen attestierbaren Offsite-Kontext einmalig auch nach ausgeschöpftem Backoff', () => {
  const f = fixture();
  const targetId = 'f97da3de-70d6-4c83-b77f-a317af304c3b';
  totalJob(f.db, {
    runStarted: '2026-07-28T01:00:00.000Z',
    options: JSON.stringify({
      backupTargetId: targetId,
      retry: { maxRetries: 2, backoffMinutes: [5, 30] },
      offsite: {
        enabled: true,
        repository: 's3:https://example.invalid/bucket',
        passwordFile: '/run/secrets/restic-password',
        required: true
      }
    })
  });
  f.db.prepare(`
    UPDATE doc_backup_jobs
       SET retry_count=2,retry_context_json=?
     WHERE id='total'
  `).run(JSON.stringify({
    kind: 'offsite-pending',
    snapshot: 'Gesamtsicherung_20260728_010000_crash',
    targetId
  }));
  const now = new Date('2026-07-28T05:00:00.000Z');
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    now: () => new Date(now),
    sendHealthMail: async () => {},
    runTotalBackup: async () => ({ text: 'wird in diesem Test nicht gestartet' })
  });
  try {
    const row = f.db.prepare("SELECT * FROM doc_backup_jobs WHERE id='total'").get();
    assert.equal(row.run_started_at, '');
    assert.equal(row.retry_count, 2, 'die begrenzte Remote-Retry-Zahl wurde heimlich erhöht');
    assert.equal(row.next_retry_at, now.toISOString());
    assert.match(row.last_result, /einmalig sofort abgeglichen/);
    assert.equal(
      JSON.parse(row.retry_context_json).snapshot,
      'Gesamtsicherung_20260728_010000_crash'
    );
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Kapazitätsmeldung und fehlende Schutzbausteine erscheinen im Healthstatus', () => {
  const now = new Date('2026-07-28T10:00:00.000Z');
  const base = {
    id: 'x', label: 'Backup', enabled: 1, target_json: '{"art":"gesamt"}',
    interval: 'taeglich', weekdays: '', time_hhmm: '02:30',
    created_at: '2026-07-01T00:00:00.000Z', last_success_at: '2026-07-28T03:00:00.000Z',
    last_failure_at: '', run_started_at: '', next_retry_at: '', retry_count: 0,
    last_run_at: '2026-07-28T03:00:00.000Z',
    last_result: 'ok: STATUS=VOLLSTAENDIG WARNUNG=KAPAZITAET FREI_BYTES=1',
    options_json: JSON.stringify({
      overdueHours: 36,
      retention: { enabled: false },
      offsite: { enabled: false }
    })
  };
  const health = backup._test.healthFuerJob(base, now);
  assert.equal(health.status, 'warning');
  assert.equal(health.reasonCode, 'capacity_low');
  assert.deepEqual(health.configurationWarnings.map((warning) => warning.code), [
    'retention_not_configured', 'local_target_encryption_not_attested', 'offsite_not_configured'
  ]);
  const unverified = backup._test.healthFuerJob({
    ...base,
    last_result: 'ok: STATUS=VOLLSTAENDIG',
    config_changed_at: '2026-07-28T09:00:00.000Z'
  }, now);
  assert.equal(unverified.reasonCode, 'configuration_unverified');
});

test('Fehlendes Dead-Man-Erfolgssignal wird als eigener Healthalarm gemeldet', () => {
  const now = new Date('2026-07-28T10:00:00.000Z');
  const base = {
    id: 'heartbeat', label: 'Nachtbackup', enabled: 1,
    source_json: '{"bereich":"alles"}', target_json: '{"art":"gesamt"}',
    interval: 'taeglich', weekdays: '', time_hhmm: '02:30',
    created_at: '2026-07-01T00:00:00.000Z',
    last_success_at: '2026-07-28T03:00:00.000Z',
    last_failure_at: '', run_started_at: '', next_retry_at: '', retry_count: 0,
    last_run_at: '2026-07-28T03:00:00.000Z',
    last_result: 'ok: STATUS=VOLLSTAENDIG · WARNUNG=DEAD_MAN_HEARTBEAT_FEHLER Monitor offline',
    options_json: JSON.stringify({
      retention: { enabled: true },
      localTargetEncryptedAttested: true,
      offsite: {
        enabled: true,
        repository: 's3:bucket',
        passwordFile: '/run/secrets/restic',
        immutableAttested: true,
        lifecycleAttested: true
      },
      heartbeat: {
        enabled: true,
        url: 'https://monitor.example.invalid/backup',
        secretFile: '/run/secrets/heartbeat'
      }
    })
  };
  const failed = backup._test.healthFuerJob(base, now);
  assert.equal(failed.status, 'warning');
  assert.equal(failed.reasonCode, 'heartbeat_failed');
  assert.equal(failed.offsiteMaintenance.status, 'not_configured');
  assert.ok(failed.configurationWarnings.some(
    (warning) => warning.code === 'offsite_maintenance_not_configured'
  ));

  const both = backup._test.healthFuerJob({
    ...base,
    last_result: base.last_result + ' · WARNUNG=OFFSITE_NICHT_ERFORDERLICH RC=75'
  }, now);
  assert.equal(both.reasonCode, 'heartbeat_failed');
  assert.ok(both.configurationWarnings.some((warning) => warning.code === 'offsite_degraded'));
});

test('Beschädigte Quell- und Zielkonfigurationen werden fail-closed gemeldet', () => {
  const now = new Date('2026-07-28T10:00:00.000Z');
  const base = {
    id: 'broken', label: 'Beschädigter Zeitplan', enabled: 1,
    source_json: '{"bereich":"alles"}',
    target_json: '{"art":"gesamt"}',
    interval: 'taeglich', weekdays: '', time_hhmm: '02:30',
    created_at: '2026-07-01T00:00:00.000Z',
    last_success_at: '', last_failure_at: '', run_started_at: '',
    next_retry_at: '', retry_count: 0, last_run_at: '', last_result: '',
    options_json: '{}'
  };

  const badSource = backup._test.healthFuerJob({
    ...base,
    source_json: '{"bereich":'
  }, now);
  assert.equal(badSource.status, 'critical');
  assert.equal(badSource.reasonCode, 'invalid_source');
  assert.match(badSource.reason, /Quellkonfiguration/);

  const badTarget = backup._test.healthFuerJob({
    ...base,
    target_json: '{"art":'
  }, now);
  assert.equal(badTarget.status, 'critical');
  assert.equal(badTarget.reasonCode, 'invalid_target');
  assert.match(badTarget.reason, /Zielkonfiguration/);

  const unknownTarget = backup._test.healthFuerJob({
    ...base,
    target_json: '{"art":"unbekannt"}'
  }, now);
  assert.equal(unknownTarget.status, 'critical');
  assert.equal(unknownTarget.reasonCode, 'invalid_target');
  assert.match(unknownTarget.reason, /unbekannte Zielart/);
});

test('Warnmailfehler bleibt Diagnosewert und verändert den Backupstatus nicht', async () => {
  const f = fixture();
  totalJob(f.db, { created: '2026-07-28T00:00:00.000Z' });
  const now = new Date(2026, 6, 28, 1, 0, 0); // vor dem ersten Termin: noch kein Lauf
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    now: () => new Date(now),
    sendHealthMail: async () => { throw new Error('SMTP offline'); },
    runTotalBackup: async () => ({ text: 'ok' })
  });
  try {
    await backup._test.aktualisiereWarnungen(now);
    const status = backup.health(now);
    const scheduler = f.db.prepare('SELECT * FROM doc_backup_scheduler_state WHERE id=1').get();
    assert.equal(status.status, 'warning');
    assert.ok(status.warnings.some((warning) => warning.code === 'notification_error'));
    assert.match(scheduler.last_mail_error, /SMTP offline/);
    assert.equal(scheduler.health_status, 'warning');
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Health-Watchdog ist single-flight und eine hängende Warnmail endet an eigener Frist', async () => {
  const f = fixture();
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    healthTimeoutMs: 25,
    sendHealthMail: async () => new Promise(() => {})
  });
  try {
    const first = backup._test.healthWatchdog();
    const second = await backup._test.healthWatchdog();
    assert.deepEqual(second, { skipped: true, reason: 'health_busy' });
    const result = await first;
    assert.equal(result.skipped, false);
    const state = f.db.prepare('SELECT * FROM doc_backup_scheduler_state WHERE id=1').get();
    assert.match(state.last_mail_error, /Zeitgrenze/);
    assert.equal(barrier.status().activeWrites, 0);
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Fehlender aktiver Gesamtjob löst mit Default-Einstellung Systemwarnung und Warnmail aus', async () => {
  const f = fixture();
  const mails = [];
  const events = [];
  const officeEvents = require('../src/modules/office/events');
  officeEvents.setNotifier((area, payload) => { events.push({ area, payload }); });
  const now = new Date('2026-07-28T10:00:00.000Z');
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    now: () => new Date(now),
    sendHealthMail: async (info, recovered) => { mails.push({ status: info.status, recovered }); },
    runTotalBackup: async () => ({ text: 'darf nicht laufen' })
  });
  try {
    const info = await backup._test.aktualisiereWarnungen(now);
    assert.equal(info.status, 'not_configured');
    assert.equal(mails.length, 1);
    assert.deepEqual(mails[0], { status: 'not_configured', recovered: false });
    assert.ok(events.some((entry) => entry.area === 'backup-health'));
    const state = f.db.prepare('SELECT * FROM doc_backup_scheduler_state WHERE id=1').get();
    assert.equal(state.health_status, 'not_configured');
    assert.ok(state.last_warning_at);
    assert.ok(state.last_mail_at);
  } finally {
    officeEvents.setNotifier(null);
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Mailfehler ist eigener Healthhinweis, ohne den erfolgreichen Backupjob umzudeuten', () => {
  const f = fixture();
  totalJob(f.db, {
    created: '2026-07-28T00:00:00.000Z'
  });
  f.db.prepare(`
    UPDATE doc_backup_jobs
       SET last_run_at='2026-07-28T03:00:00.000Z',
           last_success_at='2026-07-28T03:00:00.000Z',
           last_result='ok: STATUS=VOLLSTAENDIG'
     WHERE id='total'
  `).run();
  f.db.prepare(`
    UPDATE doc_backup_scheduler_state
       SET last_mail_error='SMTP nicht erreichbar'
     WHERE id=1
  `).run();
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    now: () => new Date('2026-07-28T10:00:00.000Z'),
    sendHealthMail: async () => {},
    runTotalBackup: async () => ({ text: 'ok' })
  });
  try {
    const status = backup.health(new Date('2026-07-28T10:00:00.000Z'));
    assert.equal(status.status, 'warning');
    assert.equal(status.jobs[0].status, 'ok');
    assert.match(status.jobs[0].lastResult, /^ok:/);
    assert.ok(status.warnings.some((warning) =>
      warning.code === 'notification_error' && /SMTP nicht erreichbar/.test(warning.message)
    ));
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Offsite-Warteschlange wird nach Neustart aus dem Ziel gelesen und profilfremder Bestand ist kritisch', (t) => {
  const f = fixture();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-backlog-health-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const targetId = '9cc5d43e-b595-4c16-ae8f-fef9f0e18a36';
  fs.writeFileSync(
    path.join(temp, '.betreuungsbuero-backup-ziel'),
    `Betreuungsbuero-Backupziel/1\nTARGET_ID=${targetId}\nCREATED_AT=2026-07-28T00:00:00.000Z\n`
  );
  const options = {
    backupTargetId: targetId,
    localTargetEncryptedAttested: true,
    retention: { enabled: true },
    offsite: {
      enabled: true,
      repository: 's3:https://example.invalid/bucket',
      passwordFile: '/run/secrets/restic-password',
      tag: 'buero',
      immutableAttested: true,
      lifecycleAttested: true
    }
  };
  totalJob(f.db, {
    target: JSON.stringify({ art: 'gesamt', ordner: temp }),
    options: JSON.stringify(options)
  });
  f.db.prepare(`
    UPDATE doc_backup_jobs
       SET last_run_at='2026-07-28T03:00:00.000Z',
           last_success_at='2026-07-28T03:00:00.000Z',
           last_result='ok: STATUS=VOLLSTAENDIG'
     WHERE id='total'
  `).run();
  const snapshotName = 'Gesamtsicherung_20260728_023000_health';
  fs.mkdirSync(path.join(temp, snapshotName));
  const profile = require('../src/modules/backup/runner')._test.offsiteProfileIdentity(
    options.offsite,
    'total'
  );
  const pending = path.join(temp, `${snapshotName}.offsite-pending`);
  const pendingText = (profileSha) => [
    'FORMAT=Betreuungsbuero-Offsite-Pending/1',
    `SNAPSHOT=${snapshotName}`,
    `MANIFEST_SHA=${'ab'.repeat(32)}`,
    `PROFILE_SHA=${profileSha}`,
    'JOB_ID=total',
    `TARGET_ID=${targetId}`,
    ''
  ].join('\n');
  fs.writeFileSync(pending, pendingText(profile.profileSha));
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    now: () => new Date('2026-07-28T10:00:00.000Z'),
    sendHealthMail: async () => {}
  });
  try {
    let status = backup.health(new Date('2026-07-28T10:00:00.000Z'));
    assert.equal(status.jobs[0].reasonCode, 'offsite_pending');
    assert.equal(status.jobs[0].offsiteBacklog.currentProfile, 1);
    fs.writeFileSync(pending, pendingText('cd'.repeat(32)));
    status = backup.health(new Date('2026-07-28T10:01:00.000Z'));
    assert.equal(status.jobs[0].status, 'critical');
    assert.equal(status.jobs[0].reasonCode, 'offsite_backlog_stranded');
    assert.equal(status.jobs[0].offsiteBacklog.foreignProfile, 1);
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Manueller Start reserviert synchron genau einen Lauf', async () => {
  const f = fixture();
  totalJob(f.db);
  let finish;
  let entered;
  const childEntered = new Promise((resolve) => { entered = resolve; });
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    sendHealthMail: async () => {},
    runTotalBackup: (options) => {
      options.onLocalSnapshotReady();
      entered();
      return new Promise((resolve) => { finish = resolve; });
    }
  });
  try {
    const first = backup.starteJetzt('total');
    const second = backup.starteJetzt('total');
    assert.equal(first.started, true);
    assert.equal(second.started, false);
    assert.match(second.reason, /bereits|aktiv/i);
    await childEntered;
    finish({ text: 'STATUS=VOLLSTAENDIG' });
    const result = await first.completion;
    assert.equal(result.ok, true);
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Pausierter oder administrativ reservierter Zeitplan kann nicht manuell starten', async () => {
  const f = fixture();
  totalJob(f.db);
  let runnerCalls = 0;
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    sendHealthMail: async () => {},
    runTotalBackup: async () => {
      runnerCalls += 1;
      return { text: 'darf nicht laufen' };
    }
  });
  try {
    f.db.prepare("UPDATE doc_backup_jobs SET enabled=0 WHERE id='total'").run();
    const paused = backup.starteJetzt('total');
    assert.equal(paused.started, false);
    assert.match(paused.reason, /pausiert/i);

    f.db.prepare(
      "UPDATE doc_backup_jobs SET enabled=1,run_started_at='abandon:test' WHERE id='total'"
    ).run();
    const reserved = backup.starteJetzt('total');
    assert.equal(reserved.started, false);
    assert.match(reserved.reason, /aktiv|reserviert/i);
    assert.equal(runnerCalls, 0);
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Konfigurationsänderung während des Laufes wird nicht als neuer Erfolg attestiert', async () => {
  const f = fixture();
  totalJob(f.db);
  let finish;
  let entered;
  const childEntered = new Promise((resolve) => { entered = resolve; });
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    sendHealthMail: async () => {},
    runTotalBackup: (options) => {
      options.onLocalSnapshotReady();
      entered();
      return new Promise((resolve) => { finish = resolve; });
    }
  });
  try {
    const accepted = backup.starteJetzt('total');
    await childEntered;
    f.db.prepare(`
      UPDATE doc_backup_jobs
         SET options_json='{"catchUp":false}',
             config_changed_at='2026-07-28T12:00:00.000Z'
       WHERE id='total'
    `).run();
    finish({ text: 'STATUS=VOLLSTAENDIG' });
    const result = await accepted.completion;
    assert.equal(result.ok, false);
    assert.equal(result.staleConfig, true);
    const row = f.db.prepare("SELECT * FROM doc_backup_jobs WHERE id='total'").get();
    assert.equal(row.last_success_at, '');
    assert.equal(row.run_started_at, '');
    assert.equal(row.options_json, '{"catchUp":false}');
    assert.match(row.last_result, /geänderten Konfiguration/);
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('TARGET_ID wird per CAS sofort gebunden und nicht erst nach Offsite-Erfolg', () => {
  const f = fixture();
  totalJob(f.db);
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    sendHealthMail: async () => {},
    runTotalBackup: async () => ({ text: 'nicht benötigt' })
  });
  try {
    const row = f.db.prepare("SELECT * FROM doc_backup_jobs WHERE id='total'").get();
    const options = backup._test.optionenVonJob(row);
    const targetId = '11111111-1111-4111-8111-111111111111';
    assert.equal(backup._test.bindeBackupZiel(row, options, targetId), targetId);
    assert.equal(JSON.parse(
      f.db.prepare("SELECT options_json FROM doc_backup_jobs WHERE id='total'").pluck().get()
    ).backupTargetId, targetId);
    assert.equal(options.backupTargetId, targetId);

    const staleRow = f.db.prepare("SELECT * FROM doc_backup_jobs WHERE id='total'").get();
    const staleOptions = backup._test.optionenVonJob(staleRow);
    f.db.prepare("UPDATE doc_backup_jobs SET options_json='{\"catchUp\":false}' WHERE id='total'").run();
    assert.throws(
      () => backup._test.bindeBackupZiel(
        staleRow,
        staleOptions,
        '22222222-2222-4222-8222-222222222222'
      ),
      /während der Zielmedium-Bindung geändert/
    );
    assert.equal(
      f.db.prepare("SELECT options_json FROM doc_backup_jobs WHERE id='total'").pluck().get(),
      '{"catchUp":false}'
    );
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Gesamtbackup materialisiert über den starken Vor-Snapshot-Vertrag', async () => {
  const f = fixture();
  totalJob(f.db);
  f.db.prepare("UPDATE doc_backup_jobs SET mount_cursor_at='2026-07-01T00:00:00.000Z' WHERE id='total'").run();
  const materializationModule = require('../src/modules/documents/materializations');
  const originalCurrent = materializationModule.current;
  const events = [];
  materializationModule.current = () => ({
    prepareTotalBackup() {
      events.push('materializations-strong');
      return { cases: {}, office: [] };
    },
    runAll() {
      assert.fail('Der Vollbackup-Pfad soll den expliziten starken Vertrag verwenden.');
    }
  });
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    sendHealthMail: async () => {},
    runTotalBackup: async (options) => {
      events.push('snapshot-local');
      options.onLocalSnapshotReady();
      return { text: 'STATUS=VOLLSTAENDIG' };
    }
  });
  try {
    const accepted = backup.starteJetzt('total');
    assert.equal(accepted.started, true);
    const result = await accepted.completion;
    assert.equal(result.ok, true);
    assert.deepEqual(events, ['materializations-strong', 'snapshot-local']);
    assert.equal(
      f.db.prepare("SELECT mount_cursor_at FROM doc_backup_jobs WHERE id='total'").pluck().get(),
      '2026-07-01T00:00:00.000Z',
      'andere Zielarten dürfen einen vorhandenen Mount-Cursor nicht verändern'
    );
  } finally {
    materializationModule.current = originalCurrent;
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Import und Zwei-Wege-Paarung können die lokale Snapshotphase nicht überlappen', async () => {
  const f = fixture();
  totalJob(f.db);
  f.db.prepare(`
    INSERT INTO doc_import_jobs
      (id,label,mount_id,source_path,target_json,enabled)
    VALUES ('imp','Import','mount-a','Eingang','{"area":"office","folderId":""}',1)
  `).run();
  const events = [];
  let releaseOperation;
  let enteredOperation;
  f.intern.mountListe = async () => {
    events.push('background-start');
    enteredOperation();
    return new Promise((resolve) => {
      releaseOperation = () => {
        events.push('background-end');
        resolve({ files: [], folders: [] });
      };
    });
  };
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    sendHealthMail: async () => {},
    runTotalBackup: async (options) => {
      events.push('backup-local');
      options.onLocalSnapshotReady();
      return { text: 'STATUS=VOLLSTAENDIG' };
    }
  });
  try {
    let entered = new Promise((resolve) => { enteredOperation = resolve; });
    const importRun = backup.impTick();
    await entered;
    const backupAfterImport = backup.starteJetzt('total');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ['background-start']);
    releaseOperation();
    await importRun;
    await backupAfterImport.completion;
    assert.deepEqual(events, ['background-start', 'background-end', 'backup-local']);

    f.db.prepare("UPDATE doc_import_jobs SET enabled=0 WHERE id='imp'").run();
    f.db.prepare(`
      INSERT INTO doc_pair_jobs
        (id,label,mount_id,source_path,target_json,enabled)
      VALUES ('pair','Paarung','mount-b','Fall','{"area":"office","folderId":""}',1)
    `).run();
    events.length = 0;
    entered = new Promise((resolve) => { enteredOperation = resolve; });
    const pairRun = backup.prTick();
    await entered;
    const backupAfterPair = backup.starteJetzt('total');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ['background-start']);
    releaseOperation();
    await pairRun;
    await backupAfterPair.completion;
    assert.deepEqual(events, ['background-start', 'background-end', 'backup-local']);
  } finally {
    backup.stop({ reset: true });
    f.db.close();
  }
});

test('Gesamtbackup belegt erst die Schreibbarriere und danach den Koordinator', async () => {
  const f = fixture();
  totalJob(f.db);
  barrier._test.resetForTests();
  const events = [];
  let releaseBlocker;
  let blockerEntered;
  const blockerReady = new Promise((resolve) => { blockerEntered = resolve; });
  const blocker = coordinator.runExclusive('bestehende Dokumentarbeit', async () => {
    events.push('blocker-start');
    blockerEntered();
    await new Promise((resolve) => { releaseBlocker = resolve; });
    events.push('blocker-end');
  });
  await blockerReady;

  const req = { method: 'POST', originalUrl: '/api/documents/test-write' };
  const res = new EventEmitter();
  res.setHeader = () => {};
  res.status = () => res;
  res.json = () => res;
  res.end = () => res;
  let requestDone;
  barrier.middleware(req, res, () => {
    requestDone = coordinator.runExclusive('gezählter Request', async () => {
      events.push('request');
    }).finally(() => res.emit('finish'));
  });

  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    sendHealthMail: async () => {},
    runTotalBackup: async (options) => {
      events.push('backup');
      options.onLocalSnapshotReady();
      return { text: 'STATUS=VOLLSTAENDIG' };
    }
  });
  try {
    const accepted = backup.starteJetzt('total');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ['blocker-start']);
    releaseBlocker();
    await Promise.all([blocker, requestDone, accepted.completion]);
    assert.deepEqual(events, ['blocker-start', 'blocker-end', 'request', 'backup']);
  } finally {
    backup.stop({ reset: true });
    f.db.close();
    barrier._test.resetForTests();
  }
});

test('Mount-Cursor bleibt am Laufstart und nimmt während des Uploads entstandene Dateien im Folgelauf mit', async () => {
  const f = fixture();
  mountJob(f.db);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mount-cursor-'));
  const firstPath = path.join(tempDir, 'eins.txt');
  const secondPath = path.join(tempDir, 'zwei.txt');
  fs.writeFileSync(firstPath, 'eins');
  fs.writeFileSync(secondPath, 'zwei');
  f.filePaths.set('file-1', firstPath);
  f.db.prepare(`
    INSERT INTO doc_files (id,area,case_id,folder_id,name,mime_type,size,updated_at,deleted_at)
    VALUES ('file-1','office','','','eins.txt','text/plain',4,'2026-07-28 10:00:00','')
  `).run();

  let now = new Date('2026-07-28T10:00:00.500Z');
  const uploads = [];
  let addedDuringRun = false;
  f.intern.mountSchreib = async (_mountId, _segments, name) => {
    uploads.push(name);
    if (!addedDuringRun) {
      addedDuringRun = true;
      f.filePaths.set('file-2', secondPath);
      f.db.prepare(`
        INSERT INTO doc_files (id,area,case_id,folder_id,name,mime_type,size,updated_at,deleted_at)
        VALUES ('file-2','office','','','zwei.txt','text/plain',4,'2026-07-28 10:00:01','')
      `).run();
    }
  };
  backup.start({
    db: f.db,
    intern: f.intern,
    ohneTakt: true,
    now: () => new Date(now),
    sendHealthMail: async () => {}
  });
  try {
    const first = await backup.laufJetzt('mount');
    assert.equal(first.ok, true);
    assert.deepEqual(uploads, ['eins.txt']);
    const cursorRow = f.db.prepare(
      "SELECT last_success_at,mount_cursor_at FROM doc_backup_jobs WHERE id='mount'"
    ).get();
    assert.equal(cursorRow.last_success_at, '2026-07-28T10:00:00.500Z');
    assert.equal(cursorRow.mount_cursor_at, '2026-07-28T09:59:59.500Z');

    uploads.length = 0;
    now = new Date('2026-07-28T10:05:00.000Z');
    const second = await backup.laufJetzt('mount');
    assert.equal(second.ok, true);
    assert.ok(uploads.includes('zwei.txt'), 'die erst während des ersten Laufs entstandene Datei fehlt');
  } finally {
    backup.stop({ reset: true });
    f.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Mount-Lauf besitzt eine Gesamtfrist und ein auslaufender Provideraufruf verhindert Überlappung', async () => {
  const f = fixture();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mount-timeout-'));
  const filePath = path.join(tempDir, 'datei.txt');
  fs.writeFileSync(filePath, 'inhalt');
  f.filePaths.set('file-1', filePath);
  let releaseProvider;
  f.intern.mountSchreib = async () => new Promise((resolve) => { releaseProvider = resolve; });
  backup.start({ db: f.db, intern: f.intern, ohneTakt: true, sendHealthMail: async () => {} });
  const liste = [{
    segmente: ['Büroorganisation'],
    name: 'datei.txt',
    row: { id: 'file-1', updated_at: '2026-07-28 10:00:00' }
  }];
  try {
    await assert.rejects(
      backup._test.laufMount(
        { mountId: 'mount-a', unterordner: '' },
        liste,
        '',
        { timeoutMs: 25 }
      ),
      /Gesamtzeitgrenze/
    );
    assert.equal(backup._test.outstandingMountOperations(), 1);
    await assert.rejects(
      backup._test.laufMount(
        { mountId: 'mount-a', unterordner: '' },
        liste,
        '',
        { timeoutMs: 25 }
      ),
      /läuft beim Anbieter noch aus/
    );
    releaseProvider();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(backup._test.outstandingMountOperations(), 0);
  } finally {
    if (releaseProvider) releaseProvider();
    backup.stop({ reset: true });
    f.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('manueller und laufender Mount-Lauf reservieren dieselbe Single-flight-Sperre', async () => {
  const f = fixture();
  mountJob(f.db);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mount-single-flight-'));
  const filePath = path.join(tempDir, 'datei.txt');
  fs.writeFileSync(filePath, 'inhalt');
  f.filePaths.set('file-1', filePath);
  f.db.prepare(`
    INSERT INTO doc_files (id,area,case_id,folder_id,name,mime_type,size,updated_at,deleted_at)
    VALUES ('file-1','office','','','datei.txt','text/plain',6,'2026-07-28 10:00:00','')
  `).run();
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  f.intern.mountSchreib = async () => {
    entered();
    await new Promise((resolve) => { release = resolve; });
  };
  backup.start({ db: f.db, intern: f.intern, ohneTakt: true, sendHealthMail: async () => {} });
  try {
    const continuous = backup.syncJetzt();
    await enteredPromise;
    const manual = backup.starteJetzt('mount');
    assert.equal(manual.started, false);
    assert.match(manual.reason, /aktiv|gerade/i);
    release();
    await continuous;
  } finally {
    if (release) release();
    backup.stop({ reset: true });
    f.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
