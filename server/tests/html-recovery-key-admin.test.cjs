'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(
  __dirname,
  '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
), 'utf8');

const blockStart = html.indexOf('<script id="data-admin-script-v1">');
const blockEnd = html.indexOf('</script>', blockStart);
assert.ok(blockStart >= 0 && blockEnd > blockStart, 'Datenadministrationsblock fehlt.');
const block = html.slice(blockStart, blockEnd);
new vm.Script(block.replace(/^<script[^>]*>/, ''), { filename: 'data-admin-script-v1.js' });

assert.match(block, /function daCanRestoreSecurity\(\)/);
assert.match(block, /caps&&caps\.canRestoreSecurity&&window\.__currentUser&&window\.__currentUser\.isAdmin/);
assert.match(block, /const isSecAdmin=canRestoreSecurity/);
assert.match(block, /if\(canRestoreSecurity\)setTimeout\(daRecoveryKeyRefresh,50\)/);

assert.equal((block.match(/\/api\/admin\/recovery-key\/status/g) || []).length, 1);
assert.equal((block.match(/\/api\/admin\/recovery-key\/verify/g) || []).length, 1);
assert.equal((block.match(/\/api\/admin\/recovery-key\/rotate/g) || []).length, 1);
assert.doesNotMatch(block, /recovery-key\/reveal/);
assert.doesNotMatch(block, /prompt\('Extern verwahrten Wiederherstellungsschlüssel/);

assert.match(block, /data-da-recovery-key autocomplete="off"/);
assert.match(block, /data-da-recovery-repeat autocomplete="off"/);
assert.match(block, /data-da-recovery-admin-password autocomplete="current-password"/);
assert.match(block, /type="password" data-da-recovery-key/);
assert.match(block, /type="password" data-da-recovery-repeat/);
assert.match(block, /type="password" data-da-recovery-admin-password/);
assert.match(block, /externalCopyAcknowledged:true/);
assert.match(block, /recoveryKey=''/);
assert.match(block, /result\.recoveryKey=''/);
assert.match(block, /finally\{recoveryKey='';adminPassword='';daRecoveryClear\(fields\)\}/);
assert.match(block, /result\.recoveryKey/);
assert.match(block, /Wiederherstellungsschlüssel\.txt/);
assert.match(block, /Alte externe Sicherungen benötigen weiterhin ihren bisherigen Schlüssel/);
assert.match(block, /item\.verified===true&&item\.status==='ok'/);
assert.match(block, /state\.strong===true&&state\.requiresRotation!==true/);
assert.match(block, /state\.snapshotsVerified===true/);
assert.match(block, /Schlüssel-ID/);
assert.match(block, /Rotation erforderlich/);
assert.match(block, /kryptografisch geprüft/);
assert.doesNotMatch(block, /state\.keyFingerprint/);
assert.doesNotMatch(block, /keyFingerprint/);
assert.match(block, /result\.status&&result\.status\.keyId/);
assert.match(block, /envelope\.keyId\|\|'Legacy-Format'/);

assert.match(block, /const encrypted=daCanRestoreSecurity\(\)/);
assert.match(block, /Verschlüsselte Server-Sicherungen sind im Lokal- und Außendienstmodus nicht verfügbar/);
assert.match(block, /const credImportLabel=canRestoreSecurity\?'JSON \/ verschlüsselte \.enc auswählen':'JSON-Datei auswählen'/);
assert.match(block, /requiresOriginalEncryptionKey/);
assert.match(block, /Portables Sicherungsformat/);

console.log('HTML-Recovery-Key-Verwaltung: Online-Admin-Gate, maskierte Eingaben, Einmal-Download, Rotation und Offline-Abgrenzung geprüft');
