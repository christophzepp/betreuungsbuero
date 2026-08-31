'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

test('Betreuungsantrag Betreuter ergänzt standardmäßig keine Unterschrift am Dokumentende', () => {
  /* Betreuungsantrag und Betreuerwechsel der betreuten Person enden ohne zusätzliche
     Systemunterschrift. Dokumente des Betreuers verwenden dagegen dessen Signatur. */
  assert.match(
    html,
    /const defaultSignatureId=id==='care_change_zepp'\?'caregiver':\(id==='care_application_person'\|\|id==='care_change_person'\)\?'none':id==='free_document'\?'defer'/
  );
  assert.match(
    html,
    /if\(id==='care_application_person'&&!state\.ui\.careApplicationNoDocumentEndSignatureDefaultMigrated\)/
  );
  assert.match(html, /saved\.signatureId='none'/);
  assert.match(html, /saved\.ownSignature=false/);
  assert.match(html, /saved\.foreignSignatures=0/);
  assert.match(html, /state\.ui\.careApplicationNoDocumentEndSignatureDefaultMigrated=true/);
});
