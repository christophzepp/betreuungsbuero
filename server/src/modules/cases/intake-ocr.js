'use strict';

const crypto = require('crypto');

function clone(value) {
  return JSON.parse(JSON.stringify(value == null ? {} : value));
}

function draftIdOf(entry) {
  return String((entry && (entry.id || entry.draftId)) || '').trim();
}

function metadata(payload, updatedAt) {
  const list = Array.isArray(payload) ? payload : [];
  const textLength = list.reduce((sum, item) => sum + String((item && item.text) || '').length, 0);
  const json = JSON.stringify(list);
  return {
    available: list.length > 0,
    itemCount: list.length,
    textLength,
    sha256: crypto.createHash('sha256').update(json).digest('hex'),
    updatedAt: updatedAt || new Date().toISOString()
  };
}

function createIntakeOcrStore(db) {
  const get = db.prepare('SELECT * FROM case_intake_ocr WHERE draft_id=?');
  const put = db.prepare(`
    INSERT INTO case_intake_ocr
      (draft_id,payload_json,text_length,item_count,sha256,updated_at)
    VALUES
      (@draftId,@payloadJson,@textLength,@itemCount,@sha256,datetime('now'))
    ON CONFLICT(draft_id) DO UPDATE SET
      payload_json=excluded.payload_json,
      text_length=excluded.text_length,
      item_count=excluded.item_count,
      sha256=excluded.sha256,
      updated_at=datetime('now')
  `);
  const del = db.prepare('DELETE FROM case_intake_ocr WHERE draft_id=?');

  function save(draftId, payload) {
    const id = String(draftId || '').trim();
    if (!id) throw new Error('OCR-Zwischenstand ohne Fallbeginn-Kennung.');
    const list = Array.isArray(payload) ? clone(payload) : [];
    const meta = metadata(list);
    put.run({
      draftId: id,
      payloadJson: JSON.stringify(list),
      textLength: meta.textLength,
      itemCount: meta.itemCount,
      sha256: meta.sha256
    });
    const row = get.get(id);
    return {
      available: !!row.item_count,
      itemCount: row.item_count,
      textLength: row.text_length,
      sha256: row.sha256,
      updatedAt: row.updated_at
    };
  }

  function load(draftId) {
    const row = get.get(String(draftId || ''));
    if (!row) return null;
    let payload = [];
    try { payload = JSON.parse(row.payload_json || '[]'); } catch (_error) { payload = []; }
    const actual = metadata(payload, row.updated_at);
    if (actual.sha256 !== row.sha256 || actual.textLength !== row.text_length || actual.itemCount !== row.item_count) {
      throw new Error('OCR-Speicher ist beschädigt (Anzahl oder SHA-256 weicht ab).');
    }
    return { payload, meta: actual };
  }

  function stripStore(data) {
    const copy = clone(data);
    const entries = Array.isArray(copy.entries) ? copy.entries : [];
    for (const entry of entries) {
      const id = draftIdOf(entry);
      const state = entry && entry.state;
      if (!id || !state || typeof state !== 'object') continue;
      if (Array.isArray(state.ocr)) {
        const meta = save(id, state.ocr);
        delete state.ocr;
        state.ocrRef = { draftId: id, ...meta };
      } else {
        const row = get.get(id);
        if (row) {
          state.ocrRef = {
            draftId: id,
            available: !!row.item_count,
            itemCount: row.item_count,
            textLength: row.text_length,
            sha256: row.sha256,
            updatedAt: row.updated_at
          };
        }
      }
    }
    return copy;
  }

  function addMetadata(data) {
    const copy = clone(data);
    const entries = Array.isArray(copy.entries) ? copy.entries : [];
    for (const entry of entries) {
      const id = draftIdOf(entry);
      const state = entry && entry.state;
      if (!id || !state || typeof state !== 'object') continue;
      delete state.ocr;
      const row = get.get(id);
      state.ocrRef = row ? {
        draftId: id,
        available: !!row.item_count,
        itemCount: row.item_count,
        textLength: row.text_length,
        sha256: row.sha256,
        updatedAt: row.updated_at
      } : { draftId: id, available: false, itemCount: 0, textLength: 0, sha256: '', updatedAt: '' };
    }
    return copy;
  }

  function hydrate(data) {
    const copy = clone(data);
    const entries = Array.isArray(copy.entries) ? copy.entries : [];
    for (const entry of entries) {
      const id = draftIdOf(entry);
      const state = entry && entry.state;
      if (!id || !state || typeof state !== 'object') continue;
      const stored = load(id);
      if (stored) state.ocr = stored.payload;
    }
    return copy;
  }

  return { addMetadata, delete: (id) => del.run(String(id || '')), hydrate, load, save, stripStore };
}

module.exports = { createIntakeOcrStore, metadata };
