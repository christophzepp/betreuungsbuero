'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const serverDir = path.resolve(__dirname, '..');

function source(relative) {
  return fs.readFileSync(path.join(serverDir, relative), 'utf8');
}

test('zeitgesteuerte Fachschreiber melden sich an der Vollsicherungsbarriere an', () => {
  const expectations = [
    ['src/modules/sync/runner.js', /withWrite\(\s*'Automatischer Kalender-, Aufgaben- und Kontaktabgleich'/],
    ['src/modules/mail/outbox.js', /withWrite\('Geplanter Mailversand'/],
    ['src/modules/finance/bank-routes.js', /withWrite\('Automatischer Bankabgleich'/],
    ['src/modules/mail/mailbox-watch.js', /withWrite\(\s*'Automatische Microsoft-Postfachprüfung'/],
    ['src/integrations/mcp/oauth-routes.js', /withWrite\('Bereinigung abgelaufener MCP-Zugänge'/],
    ['src/modules/backup/document-backup.js', /withWrite\(\s*name,[\s\S]{0,120}runExclusive\(name/],
    ['src/modules/backup/document-backup.js', /withWrite\(\s*'Sicherungs-Health-Watchdog'/],
    ['src/modules/documents/stream.js', /withWrite\(\s*'Bereinigung liegengebliebener Upload-Zwischendateien'/]
  ];
  for (const [relative, expression] of expectations) {
    assert.match(source(relative), expression, `${relative} umgeht die anwendungsweite Schreibbarriere`);
  }
});

test('alle clientseitigen Stream-Abbruchpfade beenden den Request erst nach der Temp-Bereinigung', () => {
  const streamSource = source('src/modules/documents/stream.js');
  assert.equal(
    (streamSource.match(/applicationWriteBarrier\.completeRequest\(req\);/g) || []).length,
    2,
    'Neuanlage und Ersetzung müssen ihren abgebrochenen Request freigeben'
  );
  assert.match(
    streamSource,
    /if \(!erg\.ok\)[\s\S]*?grund === 'io'[\s\S]*?completeRequest\(req\);[\s\S]*?Abbruch durch den Client/
  );
  assert.match(
    streamSource,
    /if \(!erg\.ok\)[\s\S]*?grund === 'io'[\s\S]*?completeRequest\(req\);[\s\S]*?Abbruch: die bestehende Fassung/
  );
  const webdavSource = source('src/integrations/storage/webdav.js');
  assert.equal(
    (webdavSource.match(/applicationWriteBarrier\.completeRequest\(req\);/g) || []).length,
    1,
    'WebDAV-PUT muss seinen abgebrochenen Request freigeben'
  );
  assert.match(
    webdavSource,
    /const erg = await strom\.stromSchreiben[\s\S]*?if \(!erg\.ok\)[\s\S]*?completeRequest\(req\);[\s\S]*?Abbruch durch den Client/
  );
});

test('Nutzungstimestamps werden nur innerhalb der Schreibbarriere als erledigt markiert', () => {
  const extension = source('src/integrations/extensions/authentication.js');
  assert.match(
    extension,
    /withWrite\('Erweiterungs-Token verwendet',[\s\S]*?touchTokenStmt\.run\(tokenId\);[\s\S]*?lastTouch\.set\(tokenId, now\)/
  );
  const webdav = source('src/integrations/storage/webdav.js');
  assert.match(
    webdav,
    /withWrite\('WebDAV-Zugang verwendet',[\s\S]*?tokenTouchStmt\.run\(tokenId\);[\s\S]*?tokenLastTouch\.set\(tokenId, now\)/
  );
  assert.match(
    webdav,
    /if \(cached && cached\.bis > Date\.now\(\)\) \{[\s\S]*?tokenNutzungBeruehren\(cached\.tokenId\)/
  );
});

test('übersprungene Abgleiche behandeln die Sicherungsphase nicht als Fachfehler', () => {
  assert.match(source('src/modules/sync/runner.js'), /if \(guarded\.skipped\) return;/);
  assert.match(source('src/modules/mail/mailbox-watch.js'), /if \(guarded\.skipped\) return;/);
  assert.doesNotMatch(
    source('src/modules/finance/bank-routes.js'),
    /backup_write_barrier[\s\S]{0,200}last_sync_status/,
    'eine bewusst ausgelassene Runde darf keinen Bankfehler speichern'
  );
});

test('schreibende Fallübergabe ist als GET ausdrücklich in Barriere und Koordinator erfasst', () => {
  assert.match(
    source('src/middleware/application-write-barrier.js'),
    /documents\\\/falluebergabe-zip/
  );
  assert.match(
    source('src/modules/documents/routes.js'),
    /router\.get\('\/falluebergabe-zip'[\s\S]{0,240}operationCoordinator\.runExclusive/
  );
});
