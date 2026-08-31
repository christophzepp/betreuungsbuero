'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(
  __dirname,
  '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
), 'utf8');

test('Außendienstrückweg lädt bei reiner Textänderung kein vorhandenes Foto erneut hoch', async () => {
  const start = html.indexOf('\t  function dokuImportKind(p){');
  const end = html.indexOf('\n\t  async function applyDokuRows', start);
  assert.ok(start >= 0 && end > start, 'Anlagen-Rückweg ist nicht extrahierbar.');
  const calls = [];
  const context = vm.createContext({
    Array,
    Buffer,
    JSON,
    Promise,
    String,
    Uint8Array,
    atob,
    crypto: crypto.webcrypto,
    encodeURIComponent,
    api: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true };
    },
    klon: (value) => JSON.parse(JSON.stringify(value))
  });
  new vm.Script(
    html.slice(start, end) + '\nthis.upload=dokuUploadAttachments;',
    { filename: 'aussendienst-anlagen-delta.js' }
  ).runInContext(context);

  const dataA = 'data:image/png;base64,' + Buffer.from('bild-a').toString('base64');
  const dataB = 'data:image/png;base64,' + Buffer.from('bild-b').toString('base64');
  const previous = {
    photos: [{ id: 'foto-1', filename: 'Foto.png', mimeType: 'image/png', dataUrl: dataA }]
  };
  const unchanged = JSON.parse(JSON.stringify(previous));
  await context.upload(
    'case-a', 'entry-a', unchanged, previous,
    [{ changeId: 'change-text-only' }], 'AD-1', 'entry-key'
  );
  assert.equal(calls.length, 0, 'ein unverändertes Snapshot-Foto darf nicht erneut zentral abgelegt werden');

  const withNew = JSON.parse(JSON.stringify(previous));
  withNew.photos.push({ id: 'foto-2', filename: 'Neu.png', mimeType: 'image/png', dataUrl: dataB });
  await context.upload(
    'case-a', 'entry-a', withNew, previous,
    [{ changeId: 'change-photo-add' }], 'AD-1', 'entry-key'
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.snapshotId, 'AD-1');
  assert.equal(calls[0].body.changeId, 'change-photo-add');
  assert.equal(calls[0].body.attachmentId, 'foto-2');
  assert.match(calls[0].body.sha256, /^[0-9a-f]{64}$/);

  calls.length = 0;
  const changed = JSON.parse(JSON.stringify(previous));
  changed.photos[0].dataUrl = dataB;
  await context.upload(
    'case-a', 'entry-a', changed, previous,
    [{ changeId: 'change-photo-content' }], 'AD-1', 'entry-key'
  );
  assert.equal(calls.length, 1, 'eine Anlage mit stabiler ID und verändertem Inhalt muss als neue Version ankommen');

  calls.length = 0;
  await context.upload(
    'case-a', 'entry-new', withNew, null,
    [{ changeId: 'change-new-entry' }], 'AD-1', 'new-entry-key'
  );
  assert.equal(calls.length, 2, 'bei einem neuen Eintrag müssen alle unterstützten neuen Anlagen ankommen');
});
