'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(
  __dirname,
  '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
), 'utf8');

const documentStart = html.indexOf('<script id="dokumente-modul-v1">');
const documentEnd = html.indexOf('</script>', documentStart);
assert.ok(documentStart >= 0 && documentEnd > documentStart, 'Datei-Explorer-Script fehlt.');
const documents = html.slice(documentStart, documentEnd).replace(/^<script[^>]*>/, '');
new vm.Script(documents, { filename: 'dokumente-modul-v1.js' });

assert.match(documents, /api\('\/backup-health'\)/);
assert.match(documents, /Keine automatische Vollsicherung aktiv/);
assert.match(documents, /id="dokBkRetention" type="checkbox" checked/);
assert.match(documents, /daily:bkNummer\('dokBkDaily',14\)/);
assert.match(documents, /monthly:bkNummer\('dokBkMonthly',12\)/);
assert.match(documents, /yearly:bkNummer\('dokBkYearly',10\)/);
assert.match(documents, /consistencyRetries:bkNummer\('dokBkConsistency',2\)/);
assert.match(documents, /retry:\{maxRetries:bkNummer\('dokBkRetries',2\),backoffMinutes:backoff\}/);
assert.match(documents, /catchUp:!!\(el\('dokBkCatchUp'\)/);
assert.match(documents, /alert:\{email:!!\(el\('dokBkAlertEmail'\)/);
assert.match(documents, /offsite:\{enabled:offsite,mode:'restic'/);
assert.match(documents, /Remote-Repository, z\. B\. s3:… oder sftp:…/);
assert.match(documents, /Object Lock oder Append-only/);
assert.match(documents, /localTargetEncryptedAttested:/);
assert.match(documents, /maxPending:bkNummer\('dokBkOffsiteMaxPending',14\)/);
assert.match(documents, /immutableAttested:/);
assert.match(documents, /lifecycleAttested:/);
assert.match(documents, /heartbeat:\{enabled:/);
assert.doesNotMatch(documents, /id="dokBkOffsitePassword"/);

const shortcutStart = html.indexOf('<script id="dok-settings-shortcut-v1">');
const shortcutEnd = html.indexOf('</script>', shortcutStart);
assert.ok(shortcutStart >= 0 && shortcutEnd > shortcutStart, 'Explorer-Einstellungs-Script fehlt.');
const shortcut = html.slice(shortcutStart, shortcutEnd).replace(/^<script[^>]*>/, '');
new vm.Script(shortcut, { filename: 'dok-settings-shortcut-v1.js' });
assert.match(shortcut, /hol\('\/backup-health'\)/);
assert.match(shortcut, /d\.area!=='backup-health'/);
assert.match(shortcut, /sessionStorage\.getItem\('dokBackupWarnungZuletzt'\)/);

const dataStart = html.indexOf('<script id="data-admin-script-v1">');
const dataEnd = html.indexOf('</script>', dataStart);
assert.ok(dataStart >= 0 && dataEnd > dataStart, 'Datenadministrations-Script fehlt.');
const dataAdmin = html.slice(dataStart, dataEnd).replace(/^<script[^>]*>/, '');
new vm.Script(dataAdmin, { filename: 'data-admin-script-v1.js' });
assert.match(dataAdmin, /function daRestoreSummaryText\(result\)/);
assert.match(dataAdmin, /gesamte Transaktion zurückgerollt/);
assert.match(dataAdmin, /von '\+expected\+' erwarteten Datensätzen übernommen/);
assert.match(dataAdmin, /bewusst übersprungen/);
assert.match(dataAdmin, /abgelehnt/);
assert.match(dataAdmin, /preview\.restoreReport&&preview\.restoreReport\.tables/);

console.log('HTML-Backup-Härtung: Health, Warnungen, Generationen, Retries und Remote-Restic-Konfiguration geprüft');
