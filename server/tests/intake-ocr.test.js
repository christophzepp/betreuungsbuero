'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createIntakeOcrStore, metadata } = require('../src/modules/cases/intake-ocr');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE case_intake_ocr (
    draft_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL DEFAULT '[]',
    text_length INTEGER NOT NULL DEFAULT 0,item_count INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return { db, store: createIntakeOcrStore(db) };
}

test('lagert ausschließlich OCR aus und hydriert verlustfrei', () => {
  const f = fixture();
  const ocr = [{ name: 'Beschluss.pdf', text: 'Ärztliches Gutachten' }, { name: 'Ausweis.jpg', text: 'Ada' }];
  const original = { entries: [{ id: 'draft-1', label: 'Ada', state: { step: 2, ocr, extract: { ok: true } } }] };
  const light = f.store.stripStore(original);
  assert.equal(light.entries[0].state.ocr, undefined);
  assert.equal(light.entries[0].state.extract.ok, true);
  assert.equal(light.entries[0].state.ocrRef.itemCount, 2);
  assert.equal(light.entries[0].state.ocrRef.textLength, 'Ärztliches GutachtenAda'.length);
  assert.deepEqual(f.store.hydrate(light).entries[0].state.ocr, ocr);
  assert.deepEqual(original.entries[0].state.ocr, ocr, 'Eingabeobjekt bleibt unverändert');
  f.db.close();
});

test('normale Antwort enthält nur Metadaten und Manipulation wird erkannt', () => {
  const f = fixture();
  f.store.save('draft-2', [{ text: 'vollständig' }]);
  const metaOnly = f.store.addMetadata({ entries: [{ id: 'draft-2', state: { ocr: [{ text: 'nicht ausliefern' }] } }] });
  assert.equal(metaOnly.entries[0].state.ocr, undefined);
  assert.equal(metaOnly.entries[0].state.ocrRef.available, true);
  f.db.prepare("UPDATE case_intake_ocr SET payload_json='[]' WHERE draft_id='draft-2'").run();
  assert.throws(() => f.store.load('draft-2'), /beschädigt/);
  f.db.close();
});

test('Metadaten prüfen Anzahl, Textlänge und SHA-256', () => {
  const value = metadata([{ text: 'abc' }, { text: 'ä' }], '2026-07-28T00:00:00.000Z');
  assert.equal(value.itemCount, 2);
  assert.equal(value.textLength, 4);
  assert.equal(value.sha256.length, 64);
});
