'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const project = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(
  project,
  'outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
), 'utf8');

function script(html, id) {
  const start = html.indexOf(`<script id="${id}">`);
  const end = html.indexOf('</script>', start);
  assert.ok(start >= 0 && end > start, `${id} fehlt.`);
  const block = html.slice(start, end).replace(/^<script[^>]*>/, '');
  new vm.Script(block, { filename: `${id}.js` });
  return block;
}

const ids = [
  'data-admin-script-v1',
  'case-backup-all-v161',
  'online-case-sync-script-v1',
  'dokumente-modul-v1',
  'dok-settings-shortcut-v1'
];
const blocks = {};
for (const id of ids) {
  blocks[id] = script(app, id);
}

const dataAdmin = blocks['data-admin-script-v1'];
assert.doesNotMatch(dataAdmin, /\/api\/admin\/backup-secrets/);
assert.doesNotMatch(dataAdmin, /\/api\/admin\/restore-secrets/);
assert.doesNotMatch(dataAdmin, /\bexportSecurity\s*\(/);
assert.match(dataAdmin, /Sicherheit\.json\.enc auswählen/);
assert.match(dataAdmin, /restoreSecurityFile\(file\)/);
assert.match(dataAdmin, /daRestoreEncrypted\(file,'security\/3'\)/);
assert.match(dataAdmin, /function daTokenDispositionDialog\(\)/);
assert.match(dataAdmin, /value="discard" required/);
assert.match(dataAdmin, /value="restore" required/);
assert.equal((dataAdmin.match(/tokenDisposition:tokenDisposition\|\|undefined/g) || []).length, 2);
assert.match(dataAdmin, /confirmTokens:tokenDisposition==='restore'/);
assert.match(dataAdmin, /Tokens bewusst wiederherstellen und reaktivieren/);
assert.match(dataAdmin, /\['security-encrypted','Sicherheit\.json\.enc'\]/);
assert.match(dataAdmin, /\['credentials-encrypted','Zugangsdaten\.json\.enc'\]/);
assert.match(dataAdmin, /spec\[1\]\+': geprüft'/);
assert.match(dataAdmin, /item\.error\?' · '\+item\.error/);

const allCases = blocks['case-backup-all-v161'];
assert.doesNotMatch(allCases, /\/api\/admin\/backup-secrets/);

const onlineSync = blocks['online-case-sync-script-v1'];
assert.doesNotMatch(onlineSync, /\/api\/admin\/restore-secrets/);
assert.match(onlineSync, /sicherheit\.\*\\\.json\\\.enc/);
assert.match(onlineSync, /window\.__dataAdmin\.restoreSecurityFile\(secFile\)/);
assert.match(onlineSync, /Ein altes Klartext-Sicherheit\.json wird weder/);

const documents = blocks['dokumente-modul-v1'];
assert.match(documents, /__dok\.bkBearbeiten=function\(id,nichtScrollen\)/);
assert.match(documents, /method:id\?'PATCH':'POST'/);
assert.match(documents, /die Laufhistorie bleibt erhalten/);
assert.match(documents, /id="dokBkDiagnostic"/);
assert.match(documents, /diagnostic:bkNummer\('dokBkDiagnostic',6\)/);
assert.match(documents, /id="dokBkWarningPercent"/);
assert.match(documents, /capacity:\{warningPercent:bkNummer\('dokBkWarningPercent',15\)\}/);
assert.match(documents, /id="dokBkOffsiteReadSlices"/);
assert.match(documents, /readSlices:bkNummer\('dokBkOffsiteReadSlices',7\)/);
assert.match(documents, /backupTargetId:targetId/);
assert.match(documents, /bkSetWert\('dokBkOffsiteReadSlices'/);
assert.match(documents, /bkSetWert\('dokBkWarningPercent'/);

assert.match(documents, /scheduler\.lastTickAt/);
assert.match(documents, /scheduler\.lastTickError/);
assert.match(documents, /scheduler\.lastMailAt/);
assert.match(documents, /scheduler\.lastMailError/);
assert.match(documents, /Warnung'\+\(warn\.length===1\?'':'en'\)\+' vollständig anzeigen/);
assert.doesNotMatch(documents, /warn\.slice\(0,6\)/);

assert.match(documents, /lokales Ziel verschlüsselt bestätigt/);
assert.match(documents, /Remoteziel unveränderbar bestätigt/);
assert.match(documents, /Remote-Aufbewahrung bestätigt/);
assert.match(documents, /Dead-Man-Heartbeat aktiv/);
assert.match(documents, /Warnmail vorgesehen/);
assert.match(documents, /bkOffsiteBacklogHTML\(hj\.offsiteBacklog\)/);
for (const field of [
  'available',
  'total',
  'currentProfile',
  'foreignProfile',
  'otherJob',
  'foreignTarget',
  'invalid',
  'pendingForJob',
  'blocksProfileChange',
  'error'
]) {
  assert.match(documents, new RegExp(`backlog\\.${field}`), `Offsite-Rückstand ${field} fehlt.`);
}

assert.equal((documents.match(/api\('\/backup-preflight'/g) || []).length, 1);
assert.equal((documents.match(/api\('\/backup-target\/initialize'/g) || []).length, 1);
assert.match(documents, /body:\{ordner:ordner,confirm:true\}/);
assert.match(documents, /Eine vorhandene ungültige oder beschädigte Marke wird nicht überschrieben/);
assert.match(documents, /notification\.configured&&notification\.valid/);
assert.match(documents, /notification\.recipient/);
assert.match(documents, /Warnmail im Zeitplan ausgeschaltet/);
assert.match(documents, /readiness\.localReady/);
assert.match(documents, /readiness\.recoveryReady/);
assert.match(documents, /readiness\.remoteReady/);
assert.match(documents, /readiness\.protectionAttested/);
assert.match(documents, /Recovery-Doppelabbild aktuell/);
assert.match(documents, /Remote-Repository lesbar/);
assert.match(documents, /remote\.maintenance&&remote\.maintenance\.required/);
assert.match(documents, /Getrennte Offsite-Wartung aktuell/);
assert.match(documents, /__dok\.bkBacklogVerlassen=async function\(id\)/);
assert.match(documents, /function bkBacklogDialog\(id\)/);
assert.match(documents, /id="dokBkBacklogPassword" type="password" autocomplete="current-password"/);
assert.doesNotMatch(documents, /prompt\('Aktuelles Admin-Kennwort/);
assert.match(documents, /BACKLOG VERLASSEN/);
assert.match(documents, /snapshotsRemainAcknowledged:true/);
assert.equal(
  (documents.match(/api\('\/backup-jobs\/'\+encodeURIComponent\(id\)\+'\/abandon-backlog'/g) || []).length,
  1
);
assert.match(documents, /gehört zu anderem Zeitplan; keine Blockade/);
assert.doesNotMatch(
  documents,
  /blocksProfileChange\|\|Number\(backlog\.foreignProfile\|\|0\)\|\|Number\(backlog\.otherJob/
);
assert.match(documents, /Sicherungszeitpläne dürfen ausschließlich Administratoren verwalten/);
assert.doesNotMatch(documents, /Nutzer mit Bürostammdaten-Recht/);

const shortcut = blocks['dok-settings-shortcut-v1'];
assert.match(shortcut, /var darfJobs=!!\(u&&u\.isAdmin\)/);
assert.doesNotMatch(shortcut, /u\.isAdmin\|\|u\.canManageOfficeProfile/);

// Gesamtexport in der Datenadministration (Nutzerwunsch 15.08.2026): das Gegenstück zum
// Gesamtimport sitzt in derselben Sicherung-Zeile und nutzt die bewährte Gesamtsicherung.
assert.match(app, /Gesamtexport \(ZIP\)<\/button>/);
assert.match(app, /da-row-label">Sicherung<\/span>\$\{gesamtButton\}\$\{gesamtExportButton\}/);

// Online liefert der Gesamtexport einen DIREKTEN Download des jüngsten veröffentlichten
// Server-Snapshots (Gesamt-Linien zuerst, Vorprüfung per Range-Anfrage) statt nur eines Hinweises.
const backupAll = blocks['case-backup-all-v161'];
assert.match(backupAll, /fetch\('\/api\/documents\/backup-jobs',\{credentials:'same-origin'\}\)/);
assert.match(backupAll, /ziel\?\.art==='gesamt'/);
assert.match(backupAll, /download-latest/);
assert.match(backupAll, /Range':'bytes=0-1'/);
assert.match(backupAll, /jüngste serverseitige Gesamtsicherung wird heruntergeladen/);
assert.doesNotMatch(backupAll, /wird serverseitig unter Datei-Explorer/);

console.log('HTML-Backup-UI: verschlüsselter Restore, Tokenwahl, Edit/PATCH, Health, Schutzstatus, Vorprüfung, Admin-Gate und Gesamtexport geprüft');
