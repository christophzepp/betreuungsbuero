'use strict';

const assert = require('assert');
const { _test } = require('../src/modules/backup/document-backup');

assert.deepStrictEqual(_test.dokuDatum('2026-06-15'), { year: '2026', month: '06', day: '15' });
assert.deepStrictEqual(_test.dokuDatum('15.06.2026'), { year: '2026', month: '06', day: '15' });
assert.deepStrictEqual(_test.dokuDatum('15/06/2026'), { year: '2026', month: '06', day: '15' });
assert.strictEqual(_test.dokuDatum(''), null);

const row = { created_at: '2026-07-24 11:52:00' };
const german = _test.dokuTeile({ date: '15.06.2026', type: 'Hausbesuch' }, row);
const iso = _test.dokuTeile({ datum: '2026-06-15', type: 'Hausbesuch' }, row);

assert.deepStrictEqual(german.slice(0, 4), [
  '11 - Betreuungsführung', 'Falldokumentation', '2026', '06'
]);
assert.deepStrictEqual(iso.slice(0, 4), german.slice(0, 4));
assert.match(german[4], /^260615 \d{4} Hausbesuch$/);
assert.ok(!german.includes('ohne Datum'));

console.log('doku-date: ok');
