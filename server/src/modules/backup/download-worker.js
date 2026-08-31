'use strict';

const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');
const backupDownload = require('./download');
const { zipSchreiben } = require('./document-backup');

function fail(error) {
  parentPort.postMessage({
    ok: false,
    code: String(error && error.code || ''),
    error: String(error && error.message || error || 'Unbekannter Fehler')
  });
}

try {
  const selected = backupDownload.latestSnapshot(workerData);
  const result = zipSchreiben(String(workerData.zipPath), selected.entries);
  if (result.fehlend) {
    const error = new Error(
      `${result.fehlend} Snapshotdatei(en) verschwanden vor der ZIP-Erstellung.`
    );
    error.code = 'BACKUP_DOWNLOAD_SOURCE_MISSING';
    throw error;
  }
  fs.chmodSync(String(workerData.zipPath), 0o600);
  parentPort.postMessage({
    ok: true,
    snapshotName: selected.snapshotName,
    files: result.dateien,
    bytes: result.bytes
  });
} catch (error) {
  try { fs.unlinkSync(String(workerData && workerData.zipPath || '')); } catch (_ignore) { /* temp */ }
  fail(error);
}
