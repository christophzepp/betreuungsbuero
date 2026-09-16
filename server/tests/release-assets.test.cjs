'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { prepareRelease, verifyRelease } = require('../scripts/release-assets.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'outputs'));
  fs.mkdirSync(path.join(root, 'docs/releases'), { recursive: true });
  const source = Buffer.concat([Buffer.from("const APP_VERSION='0.7.11';\r\n"), Buffer.from([0, 255, 10])]);
  fs.writeFileSync(path.join(root, 'outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), source);
  fs.writeFileSync(path.join(root, 'compose.yaml'), 'services: {}\n');
  fs.writeFileSync(path.join(root, '.env.example'), 'SESSION_SECRET=\n');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=must-not-be-published\n');
  fs.writeFileSync(path.join(root, 'docs/releases/v0.7.11.md'), '# Version\nBetreuungsbuero_Dokumentenassistent_v0_7_11.html\ncompose.yaml\nbetreuungsbuero.env.example\nSHA256SUMS.txt\n');
  return { root, source, destination: path.join(root, 'assets') };
}
function manifest(directory) {
  return { tag_name: 'v0.7.11', assets: fs.readdirSync(directory).map(name => {
    const bytes = fs.readFileSync(path.join(directory, name));
    return { name, state: 'uploaded', size: bytes.length, digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') };
  }) };
}

test('Release enthält genau vier Dateien, bytegetreue HTML und verifizierbare Prüfsummen', t => {
  const { root, source, destination } = fixture(t);
  const names = prepareRelease(root, 'v0.7.11', destination);
  assert.equal(names.length, 4);
  assert.deepEqual(fs.readFileSync(path.join(destination, names[0])), source);
  assert.equal(fs.readFileSync(path.join(destination, 'betreuungsbuero.env.example'), 'utf8'), 'SESSION_SECRET=\n');
  for (const line of fs.readFileSync(path.join(destination, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')) {
    const [hash, name] = line.split('  ');
    assert.equal(hash, crypto.createHash('sha256').update(fs.readFileSync(path.join(destination, name))).digest('hex'));
  }
  verifyRelease('v0.7.11', destination, manifest(destination));
});

test('Ungültiger Tag, abweichende Programmversion oder fehlende Notes verhindern das Paket', t => {
  const { root, destination } = fixture(t);
  for (const tag of ['../../secret', 'v0.7.12']) assert.throws(() => prepareRelease(root, tag, destination));
  fs.unlinkSync(path.join(root, 'docs/releases/v0.7.11.md'));
  assert.throws(() => prepareRelease(root, 'v0.7.11', destination));
  assert.equal(fs.existsSync(destination), false);
});

test('Release wird bei fehlendem oder beschädigtem Download nicht freigegeben', t => {
  const { root, destination } = fixture(t);
  prepareRelease(root, 'v0.7.11', destination);
  const valid = manifest(destination);
  for (const mutate of [
    value => value.assets.pop(),
    value => { value.assets[0].digest = 'sha256:wrong'; },
    value => { value.assets[0].size++; },
    value => { value.assets[0].state = 'starter'; },
    value => { value.tag_name = 'v0.7.10'; }
  ]) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(() => verifyRelease('v0.7.11', destination, invalid));
  }
});
