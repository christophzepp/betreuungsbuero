'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = fs.readFileSync(path.join(__dirname, '../tools/gesamt-backup.sh'), 'utf8');
const helper = /stat_kennzahl\(\) \{[\s\S]*?\n\}/.exec(source)?.[0];
assert.ok(helper, 'The actual production stat helper must exist.');

test('Backup-Dateisystemkennung: echtes stat bleibt bei Änderung des freien Speichers stabil', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-stat-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const run = () => spawnSync('bash', ['-c', helper + '\nstat_kennzahl "%d" "%d" "$1"', 'stat-test', temp], { encoding: 'utf8' });
  const before = run();
  assert.equal(before.status, 0, before.stderr);
  assert.equal(before.stdout.trim(), String(fs.statSync(temp).dev));
  fs.writeFileSync(path.join(temp, 'allocated.bin'), Buffer.alloc(1024 * 1024, 1));
  assert.equal(run().stdout, before.stdout);
});

test('Fehlerhafte/mehrzeilige stat-Ausgaben gelangen nicht in Kennung oder Passwortdateimodus', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-stat-fault-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const script = path.join(temp, 'stat');
  for (const [fake, format, expected, status] of [
    ['if [ "$1" = -f ]; then printf "partial filesystem data\\n"; exit 1; fi; printf "73\\n"', '%d', '73\n', 0],
    ['if [ "$1" = -f ]; then printf "partial filesystem data\\n"; exit 1; fi; printf "600\\n"', '%Lp', '600\n', 0],
    ['printf "73\\n74\\n"', '%d', '', 1],
    ['printf "partial\\n"; exit 1', '%d', '', 1],
  ]) {
    fs.writeFileSync(script, '#!/bin/sh\n' + fake + '\n', { mode: 0o755 });
    const result = spawnSync('bash', ['-c', helper + '\nstat_kennzahl "$1" "$2" "$3"', 'stat-test', format, format === '%Lp' ? '%a' : '%d', temp],
      { encoding: 'utf8', env: { ...process.env, PATH: temp + path.delimiter + process.env.PATH } });
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.stdout, expected);
  }
});
