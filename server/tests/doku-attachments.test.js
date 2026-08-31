'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const doku = require('../src/modules/documents/case-note-attachments');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doku-anlagen-test-'));
const caseId = 'case-1';
const firstEntry = 'entry-1';
const secondEntry = 'entry-2';
const photoId = 'photo-1';
const legacy = path.join(root, caseId, firstEntry, photoId);

fs.mkdirSync(path.dirname(legacy), { recursive: true });
fs.writeFileSync(legacy, Buffer.from('gemeinsamer-inhalt'));

assert.strictEqual(doku.resolve(root, caseId, photoId, secondEntry), legacy,
  'Ein zweiter Eintrag muss eine unter dem ersten Eintrag liegende Datei finden.');

const adopted = doku.adopt(root, caseId, photoId, firstEntry);
assert.strictEqual(adopted, doku.canonicalPath(root, caseId, photoId));
assert.strictEqual(fs.readFileSync(adopted, 'utf8'), 'gemeinsamer-inhalt');
assert.strictEqual(doku.resolve(root, caseId, photoId, secondEntry), adopted);

const rows = [
  { id: firstEntry, data_json: JSON.stringify({ photos: [{ id: photoId }] }) },
  { id: secondEntry, data_json: JSON.stringify({ photos: [{ id: photoId }] }) }
];
assert.strictEqual(doku.removeUnreferenced(root, caseId, photoId, rows, firstEntry), false,
  'Loeschen eines Verweises darf die gemeinsam genutzte Datei nicht entfernen.');
assert.ok(fs.existsSync(adopted));

assert.strictEqual(doku.removeUnreferenced(root, caseId, photoId, rows, null), false,
  'Solange irgendein Verweis existiert, bleibt die Datei erhalten.');
assert.strictEqual(doku.removeUnreferenced(root, caseId, photoId, [], null), true);
assert.ok(!fs.existsSync(adopted));

const newPath = doku.writeNew(root, caseId, 'photo-2', Buffer.from('neu'));
assert.strictEqual(fs.readFileSync(newPath, 'utf8'), 'neu');
assert.throws(() => doku.canonicalPath(root, '../ausbruch', 'photo-3'), /ungültig/);

fs.rmSync(root, { recursive: true, force: true });
console.log('doku-attachments: ok');
