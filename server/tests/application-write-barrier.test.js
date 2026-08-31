'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('events');
const { PassThrough } = require('node:stream');
const barrier = require('../src/middleware/application-write-barrier');
const strom = require('../src/shared/streamed-file');

function response() {
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.end = () => res;
  return res;
}

test('wartet auf laufende Writes und weist neue während der Sicherung ab', async () => {
  barrier._test.resetForTests();
  const first = response();
  let nextCalled = false;
  barrier.middleware({ method: 'POST' }, first, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  let entered = false;
  const run = barrier.withBarrier('Testbackup', async () => {
    entered = true;
    const blocked = response();
    barrier.middleware({ method: 'PATCH' }, blocked, () => assert.fail('darf nicht passieren'));
    assert.equal(blocked.statusCode, 503);
    assert.equal(blocked.body.code, 'backup_write_barrier');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(entered, false);
  first.emit('finish');
  await run;
  assert.equal(entered, true);
  assert.equal(barrier.status().active, false);
});

test('lesende Anfragen bleiben während einer Sicherung verfügbar', async () => {
  barrier._test.resetForTests();
  await barrier.withBarrier('Testbackup', async () => {
    const res = response();
    let called = false;
    barrier.middleware({ method: 'GET' }, res, () => { called = true; });
    assert.equal(called, true);
  });
});

test('mutierende OAuth-GET-Callbacks werden wie Writes drainiert und gesperrt', async () => {
  for (const url of [
    '/api/admin/calendar-connections/oauth/callback/google?code=abc&state=calendar-1',
    '/api/documents/oauth/gdrive/callback?code=abc&state=drive-1'
  ]) {
    barrier._test.resetForTests();
    const running = response();
    let callbackStarted = false;
    barrier.middleware({ method: 'GET', originalUrl: url }, running, () => {
      callbackStarted = true;
    });
    assert.equal(callbackStarted, true);

    let snapshotStarted = false;
    const snapshot = barrier.withBarrier('OAuth-Drain-Test', async () => {
      snapshotStarted = true;
      const blocked = response();
      barrier.middleware({ method: 'GET', originalUrl: url }, blocked, () => {
        assert.fail('Callback darf während der Snapshotphase nicht starten');
      });
      assert.equal(blocked.statusCode, 503);
      assert.equal(blocked.body.code, 'backup_write_barrier');
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(snapshotStarted, false, `${url} muss vor dem Snapshot auslaufen`);
    running.emit('finish');
    await snapshot;
    assert.equal(snapshotStarted, true);
  }
});

test('nur die bekannten Callback-Pfade klassifizieren GET/HEAD als mutierend', () => {
  const classify = barrier._test.isMutatingRequest;
  assert.equal(classify({
    method: 'GET',
    originalUrl: '/api/admin/calendar-connections/oauth/callback/microsoft?code=x'
  }), true);
  assert.equal(classify({
    method: 'HEAD',
    originalUrl: '/api/documents/oauth/onedrive/callback/'
  }), true, 'Express darf eine GET-Route auch für HEAD ausführen');
  assert.equal(classify({
    method: 'GET',
    originalUrl: '/api/admin/calendar-connections/connection-1'
  }), false);
  assert.equal(classify({
    method: 'GET',
    originalUrl: '/api/documents/mounts'
  }), false);
  assert.equal(classify({
    method: 'OPTIONS',
    originalUrl: '/api/documents/oauth/gdrive/callback'
  }), false);
});

test('Token-/Cache-schreibende Discovery- und Leseendpunkte sind explizit mutierend', () => {
  const classify = barrier._test.isMutatingRequest;
  for (const url of [
    '/api/admin/calendar-connections/calendar-1/available-calendars',
    '/api/admin/calendar-connections/calendar-1/available-addressbooks?refresh=1',
    '/api/documents/mounts/mount-1/list?path=Posteingang',
    '/api/documents/mounts/mount-1/file?path=Scan.pdf',
    '/api/documents/falluebergabe-zip?caseId=case-1',
    '/api/documents/tree?area=case&caseId=case-1',
    '/api/documents/files/file-1/versionen',
    '/api/documents/aktivitaet?limit=100',
    '/api/mailbox/accounts/mail-1/folders',
    '/api/mailbox/accounts/mail-1/messages?folder=INBOX',
    '/api/mailbox/accounts/mail-1/message?id=42',
    '/api/mailbox/accounts/mail-1/attachment?id=42&part=1',
    '/api/mailbox/accounts/mail-1/raw?id=42',
    '/api/mailbox/accounts/mail-1/autoreply',
    '/api/mailbox/case-messages?caseId=case-1'
  ]) {
    assert.equal(classify({ method: 'GET', originalUrl: url }), true, url);
  }
});

test('Mailbox-SSE und gewöhnliche Downloads bleiben ausdrücklich lesend', () => {
  const classify = barrier._test.isMutatingRequest;
  for (const url of [
    '/api/mailbox/events',
    '/api/documents/files/file-1/download',
    '/api/admin/calendar-connections'
  ]) {
    assert.equal(classify({ method: 'GET', originalUrl: url }), false, url);
  }
});

test('Client-close gibt einen laufenden Handler nicht vorzeitig frei; res.end beendet den Vertrag', async () => {
  barrier._test.resetForTests();
  const req = { method: 'POST', originalUrl: '/api/test' };
  const res = response();
  barrier.middleware(req, res, () => {});
  assert.equal(barrier.status().activeWrites, 1);

  res.emit('close');
  assert.equal(
    barrier.status().activeWrites,
    1,
    'ein abgebrochener Socket sagt nichts über das Ende der Schreibarbeit aus'
  );

  res.end();
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(barrier.status().activeWrites, 0);
});

test('bereinigter Stream-Abbruch gibt den Request ausdrücklich frei und lässt die nächste Sicherung starten', async () => {
  barrier._test.resetForTests();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-barrier-upload-abort-'));
  const tempFile = path.join(tempDir, '.strom-test.part');
  const req = new PassThrough();
  req.method = 'POST';
  req.originalUrl = '/api/documents/strom/files';
  req.complete = false;
  req.aborted = false;
  const res = response();
  let handler;

  try {
    barrier.middleware(req, res, () => {
      handler = (async () => {
        const writeResult = strom.stromSchreiben(req, tempFile, 1024);
        req.write(Buffer.from('unvollständig'));
        req.aborted = true;
        req.emit('aborted');
        const result = await writeResult;
        assert.deepEqual(
          { ok: result.ok, grund: result.grund },
          { ok: false, grund: 'abbruch' }
        );
        assert.equal(fs.existsSync(tempFile), false, 'Temp-Datei muss vor der Freigabe entfernt sein');
        assert.equal(barrier.completeRequest(req), true);
      })();
    });

    await handler;
    await new Promise((resolve) => queueMicrotask(resolve));
    assert.equal(barrier.status().activeWrites, 0);

    const snapshot = await barrier.begin('Sicherung nach Uploadabbruch', { timeoutMs: 1000 });
    assert.equal(barrier.status().active, true);
    snapshot.release();
  } finally {
    try { req.destroy(); } catch (_error) { /* Test-Aufräumen */ }
    fs.rmSync(tempDir, { recursive: true, force: true });
    barrier._test.resetForTests();
  }
});

test('verschachteltes withWrite bleibt im Request gezählt und abgekoppelte Arbeit erhält einen eigenen Kontext', async () => {
  barrier._test.resetForTests();
  const req = { method: 'POST', originalUrl: '/api/test' };
  const res = response();
  let nested;
  barrier.middleware(req, res, () => {
    nested = barrier.withWrite('verschachtelt', async () => {
      assert.equal(barrier.status().activeWrites, 1);
      return 42;
    });
  });
  assert.deepEqual(await nested, {
    started: true,
    skipped: false,
    nested: true,
    value: 42
  });

  let detachedRelease;
  const detached = barrier.runDetached(() => barrier.withWrite('abgekoppelt', async () =>
    new Promise((resolve) => { detachedRelease = resolve; })));
  assert.equal(barrier.status().activeWrites, 2);
  res.end();
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(barrier.status().activeWrites, 1);
  detachedRelease();
  await detached;
  assert.equal(barrier.status().activeWrites, 0);
});

test('begin wartet race-frei auf einen bereits gestarteten Hintergrundschreiber', async () => {
  barrier._test.resetForTests();
  let finishWrite;
  const writeMayFinish = new Promise((resolve) => { finishWrite = resolve; });
  let writerEntered = false;
  const writer = barrier.withWrite('Kalender-Autoabgleich', async () => {
    writerEntered = true;
    await writeMayFinish;
    return 'fertig';
  });
  assert.equal(writerEntered, true, 'Aufnahme und Funktionsstart geschehen vor dem ersten await');
  assert.equal(barrier.status().activeWrites, 1);

  let snapshotEntered = false;
  const snapshot = barrier.withBarrier('Snapshot', async () => {
    snapshotEntered = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshotEntered, false);
  finishWrite();
  assert.deepEqual(await writer, {
    started: true,
    skipped: false,
    value: 'fertig'
  });
  await snapshot;
  assert.equal(snapshotEntered, true);
  assert.equal(barrier.status().activeWrites, 0);
});

test('Hintergrundschreiber startet während angeforderter oder aktiver Sicherung nicht', async () => {
  barrier._test.resetForTests();
  let writerRan = false;
  await barrier.withBarrier('Snapshot', async () => {
    const result = await barrier.withWrite('Mail-Outbox', async () => {
      writerRan = true;
    });
    assert.deepEqual(result, {
      started: false,
      skipped: true,
      code: 'backup_write_barrier',
      name: 'Mail-Outbox'
    });
  });
  assert.equal(writerRan, false);
});
