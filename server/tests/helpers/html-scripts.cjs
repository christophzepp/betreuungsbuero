'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');

// Gemeinsamer Auslieferungsstand: 311 Blöcke / 229 JavaScript bis 06.09.2026.
// e7cf3f7 ergänzt Dokumenteneditor und Dokumentauswahl; 6a0e9df ergänzt die
// beiden Fallassistenten. Kalender- und Aufgabenumbau fügen keine Blöcke hinzu.
const additions = [
  'mobile-document-editor-v1',
  'mobile-document-library-v1',
  'desktop-case-wizard-v1',
  'mobile-case-wizard-v1'
];

function assertScriptInventory(source, label = 'HTML') {
  const blocks = [...String(source).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(blocks.length, 311 + additions.length, `${label}: Script-/Datenblockzahl verändert`);
  const ids = new Set();
  let javascript = 0;
  for (const [index, block] of blocks.entries()) {
    const id = block[1].match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
    if (id) {
      assert.ok(!ids.has(id), `${label}: doppelte Script-ID ${id}`);
      ids.add(id);
    }
    const type = block[1].match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const mime = type ? (type[1] ?? type[2] ?? type[3]).trim().toLowerCase() : '';
    if (mime && !['text/javascript', 'application/javascript', 'module'].includes(mime)) continue;
    javascript++;
    new vm.Script(block[2], { filename: `${label}:${id || `script-${index + 1}`}` });
  }
  assert.equal(javascript, 229 + additions.length, `${label}: JavaScript-Blockzahl verändert`);
  for (const id of additions) assert.ok(ids.has(id), `${label}: veröffentlichter Baustein ${id} fehlt`);
}

module.exports = { assertScriptInventory };
