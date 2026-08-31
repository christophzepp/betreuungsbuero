'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(
  __dirname,
  '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
), 'utf8');

function section(start, end, label) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${label} ist nicht eindeutig extrahierbar.`);
  return html.slice(from, to);
}

const runtime = section(
  'window.__runtimeMode=function(){',
  '\n\n  function onLoggedIn ',
  'Betriebsartenschicht'
);
assert.match(runtime, /if\(window\.__adSnapshotId\)return 'fieldService'/);
assert.match(runtime, /hasServer:mode==='online'/);
assert.match(runtime, /hasDocumentStore:mode==='online'/);
assert.match(runtime, /hasMaintenance:mode==='online'/);
assert.match(runtime, /hasFieldSnapshot:mode==='fieldService'/);
assert.match(runtime, /canRestoreSecurity:mode==='online'/);
assert.match(runtime, /recoveryMode:recovery/);
assert.match(runtime, /hasDocumentStore:mode==='online'&&!recovery/);
assert.match(html, /appRecoveryReady/);
assert.match(html, /\/api\/admin\/recovery\/status/);
assert.match(html, /\/api\/admin\/restore-encrypted\/preview/);
assert.match(html, /\/api\/admin\/recovery\/release/);
assert.match(html, /tokenDisposition:tokenDisposition/);
assert.match(html, /confirmTokens:true/);
assert.match(html, /window\.__officeCredentials=\(mode==='online'&&!recoveryActive\)/);

assert.match(
  html,
  /if\(cap\.mode==='fieldService'&&window\.__adDokumente\)\{adDokViewer\(\);return;\}/
);
/* 30.08. Demo-Vollausbau: NUR dieser Öffnungs-Riegel kennt die Vorführung (RAM-Attrappe
   __dokDemoFetch). hasDocumentStore selbst bleibt für die Demo false - daran hängen die
   echten Schreibwege (Export-Ablage, Strom-Upload), siehe Pins oben/unten. */
assert.match(html, /if\(!cap\.hasDocumentStore&&!window\.__demoModus\)/);
assert.match(html, /hasDocumentStore:mode==='online'/, 'Die Capability selbst darf die Demo NICHT einschließen');
assert.match(html, /const isSecAdmin=canRestoreSecurity/);
assert.match(html, /caps&&caps\.canRestoreSecurity&&window\.__currentUser&&window\.__currentUser\.isAdmin/);
assert.match(html, /const encrypted=daCanRestoreSecurity\(\)/);
assert.match(html, /encrypted\?'\.json,\.enc,application\/json':'\.json,application\/json'/);

const ocr = section(
  'function ciOcrDb(){',
  '\nwindow.__ciStoreLoad=ciStoreLoad;',
  'OCR-Auslagerung'
);
assert.match(ocr, /indexedDB\.open\('betreuungsbuero-intake-ocr',1\)/);
assert.match(ocr, /fetch\('\/api\/office-json\/case_intakes\/ocr\/'/);
assert.match(ocr, /ciOcrVerify\(j\.ocr,j\.meta\|\|ref\)/);
assert.match(html, /case_intakes\?hydrateOcr=1/);
assert.match(html, /window\.__ciHydrateAll/);

const fieldCollector = section(
  'window.__adDokSammeln = async function (zeitraum, faelle, melden) {',
  '\n  window.__adDokumenteOffline',
  'Außendienst-Dokumentensammler'
);
assert.match(fieldCollector, /\/api\/documents\/ordner-dateien\?area=case&caseId=/);
assert.match(fieldCollector, /\/api\/documents\/files\//);
assert.match(fieldCollector, /if\(!x\.sha256\)throw new Error\('Prüfsumme fehlt im Inhaltsverzeichnis\.'/);
assert.match(fieldCollector, /if\(String\(x\.sha256\)\.toLowerCase\(\)!==actualSha\)throw new Error\('Prüfsumme stimmt nicht\.'/);
assert.match(fieldCollector, /name: x\.name, pfad: x\.pfad \|\| '', mime: x\.mimeType/);
assert.match(html, /function adFallId\(entry,index\)/);
assert.match(html, /SICHT\.gewaehlt\[adFallId\(x,i\)\]/);
assert.match(html, /dok\.bericht\.fehler\.join\(' · '\)/);

const fieldViewer = section(
  'function adDokViewer (){',
  '\nfunction adDatei',
  'Außendienst-Nur-Lesen-Ansicht'
);
assert.match(fieldViewer, />Öffnen</);
assert.match(fieldViewer, />Speichern</);
assert.doesNotMatch(fieldViewer, />Umbenennen</);
assert.doesNotMatch(fieldViewer, />Verschieben</);
assert.doesNotMatch(fieldViewer, />Löschen</);
assert.match(html, /Diese Bereiche sind LEER oder konnten nicht geladen werden/);
assert.match(html, /Trotzdem herunterladen/);
assert.match(html, /excludedFromAussendienst=true/);
assert.match(html, /dokuUploadPhotoV166\(serverCaseId,entryId,p\)/);
assert.match(html, /snapshotId:String\(snapshotId\|\|''\)/);
assert.match(html, /changeId:changeId/);
assert.match(html, /attachmentId:attachmentId/);
assert.match(html, /sha256:sha256/);
assert.match(html, /previousById\[stableId\]===sha256/);
assert.match(html, /previousHashes\[sha256\]/);

const streamUpload = section(
  '<script id="upload-strom-v1">',
  '</script>',
  'Strom-Upload'
);
assert.match(streamUpload, /function stromHasServer\(\)/);
assert.match(streamUpload, /caps\?!!caps\.hasDocumentStore/);
assert.match(streamUpload, /if\(!stromHasServer\(\)\)throw new Error\('Der zentrale Datei-Upload ist nur im Online-Modus verfügbar\.'/);
assert.match(streamUpload, /if\(stromHasServer\(\)\)try\{pruefen\(\)/);

const legacyExport = section(
  '  window.downloadAllCasesZip=async function(){',
  '\n\n  /* ===== Sammel-Indikator:',
  'Lokaler Arbeitsdatenexport'
);
assert.match(legacyExport, /if\(backupMode==='online'\)/);
assert.match(legacyExport, /if\(backupMode==='fieldService'\)/);
assert.match(legacyExport, /Lokaler Arbeitsdatenexport\.zip/);
assert.doesNotMatch(legacyExport, /\/api\/admin\//);
assert.doesNotMatch(legacyExport, /Sicherheit\.json[^.]/);
assert.match(html, /window\.__applyLegacyBackupMode=applyLegacyBackupMode/);

assert.match(html, /id="dokBkLocalEncrypted"/);
assert.match(html, /localTargetEncryptedAttested:/);
assert.match(html, /id="dokBkOffsiteMaxPending"/);
assert.match(html, /maxPending:bkNummer\('dokBkOffsiteMaxPending',14\)/);
assert.match(html, /immutableAttested:/);
assert.match(html, /lifecycleAttested:/);
assert.match(html, /id="dokBkHeartbeatSecretFile"/);
assert.match(html, /heartbeat:\{enabled:/);

console.log('HTML-Betriebsarten: Online, Lokal und Außendienst einschließlich OCR, Nur-Lesen-Dokumenten und Rückweg geprüft');
