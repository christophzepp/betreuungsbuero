'use strict';

const fs = require('fs');
const path = require('path');

function assertNoIncompleteRuntimeRestore(rawStateDir) {
  const configured = String(rawStateDir || '').trim();
  if (!configured) return;
  if (!path.isAbsolute(configured)) {
    throw new Error('RUNTIME_ARTIFACT_RESTORE_STATE_DIR muss absolut sein.');
  }
  const stateDir = path.resolve(configured);
  if (!fs.existsSync(stateDir)) return;
  const info = fs.lstatSync(stateDir);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('Runtime-Restore-State ist kein regulärer Ordner.');
  }
  const active = path.join(stateDir, 'ACTIVE.json');
  if (!fs.existsSync(active)) return;
  const activeInfo = fs.lstatSync(active);
  if (activeInfo.isSymbolicLink() || !activeInfo.isFile()) {
    throw new Error('Unsicherer Runtime-Restore-Marker; App-Start gesperrt.');
  }
  throw new Error(
    'Ein Runtime-Artefakt-Restore ist unvollständig. '
    + 'Vor dem App-Start mit --resume oder --rollback abschließen.'
  );
}

module.exports = { assertNoIncompleteRuntimeRestore };
