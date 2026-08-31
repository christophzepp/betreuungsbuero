'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createRecoveryKeyStore } = require('../src/modules/recovery/key-store');

function fixture(environmentKey) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-key-store-'));
  const file = path.join(temp, '.runtime-secrets', 'document-recovery-key');
  const env = {
    DOCUMENTS_DATA_ROOT: path.join(temp, 'data'),
    DOCUMENT_RECOVERY_KEY: environmentKey || ''
  };
  fs.mkdirSync(env.DOCUMENTS_DATA_ROOT);
  return {
    temp,
    file,
    env,
    store: createRecoveryKeyStore({ env, filePath: file }),
    close() { fs.rmSync(temp, { recursive: true, force: true }); }
  };
}

test('nutzt die Umgebung als Fallback und gibt niemals Schlüssel oder Pfad im Status aus', (t) => {
  const f = fixture('umgebungs-fallback-mit-ausreichender-laenge');
  t.after(f.close);
  const status = f.store.publicStatus();
  assert.equal(status.configured, true);
  assert.equal(status.source, 'environment');
  assert.equal(status.strong, false);
  assert.equal(status.requiresRotation, true);
  assert.throws(() => f.store.getStrongKey(), /Legacy-Schlüssel/);
  assert.equal(f.store.getKey(), f.env.DOCUMENT_RECOVERY_KEY);
  assert.equal(f.store.getFingerprint().length, 24);
  assert.equal(status.fingerprint, f.store.getFingerprint());
  assert.match(status.fingerprint, /^[0-9a-f]{24}$/);
  const serialized = JSON.stringify(status);
  assert.ok(!serialized.includes(f.env.DOCUMENT_RECOVERY_KEY));
  assert.ok(!serialized.includes(f.file));
});

test('akzeptiert einen starken Umgebungs-Fallback ohne erzwungene Rotation', (t) => {
  const key = `drk1_${crypto.randomBytes(32).toString('base64url')}`;
  const f = fixture(key);
  t.after(f.close);
  const status = f.store.publicStatus();
  assert.equal(status.configured, true);
  assert.equal(status.source, 'environment');
  assert.equal(status.strong, true);
  assert.equal(status.requiresRotation, false);
  assert.match(status.keyId, /^legacy_[0-9a-f]{32}$/);
  assert.equal(f.store.getStrongKey(), key);
});

test('verwalteter Schlüssel hat Vorrang, bleibt nach Neustart erhalten und ist 0600 geschützt', (t) => {
  const f = fixture('alter-umgebungs-fallback-mit-ausreichender-laenge');
  t.after(f.close);
  const key = `drk1_${crypto.randomBytes(32).toString('base64url')}`;
  const changed = f.store.setKey(key);
  assert.equal(changed.rotated, true);
  assert.equal(f.store.getKey(), key);
  assert.equal(f.store.publicStatus().source, 'admin-panel');
  assert.equal(f.store.publicStatus().strong, true);
  assert.equal(f.store.publicStatus().requiresRotation, false);
  assert.equal(f.store.getStrongKey(), key);
  assert.match(f.store.publicStatus().keyId, /^drk_/);
  assert.equal(f.store.publicStatus().generation, 1);

  const nextProcess = createRecoveryKeyStore({ env: f.env, filePath: f.file });
  assert.equal(nextProcess.getKey(), key);
  assert.equal(nextProcess.verify(key), true);
  assert.equal(nextProcess.verify('falscher-schluessel-mit-genuegend-laenge'), false);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.dirname(f.file)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  }
});

test('weist menschenlesbare Importphrasen ab und vergibt bei Rotation eine neue Key-ID', (t) => {
  const f = fixture();
  t.after(f.close);
  assert.throws(
    () => f.store.setKey('dies-ist-nur-eine-lange-aber-nicht-zufaellige-passphrase-2026'),
    /kryptografisch erzeugt/
  );
  const first = `drk1_${crypto.randomBytes(32).toString('base64url')}`;
  const second = `drk1_${crypto.randomBytes(32).toString('base64url')}`;
  f.store.setKey(first);
  const before = f.store.publicStatus();
  f.store.setKey(second);
  const after = f.store.publicStatus();
  assert.notEqual(after.keyId, before.keyId);
  assert.equal(after.generation, before.generation + 1);
  assert.ok(!JSON.stringify(after).includes(second));
});

test('stellt Schlüsselmetadaten nach Prozessabbruch zwischen beiden renames idempotent fertig', (t) => {
  const f = fixture();
  t.after(f.close);
  const first = `drk1_${crypto.randomBytes(32).toString('base64url')}`;
  const second = `drk1_${crypto.randomBytes(32).toString('base64url')}`;
  f.store.setKey(first);
  const before = f.store.publicStatus();

  const interrupted = createRecoveryKeyStore({
    env: f.env,
    filePath: f.file,
    afterKeyPublished() {
      throw new Error('simulierter Prozessabbruch nach Schlüssel-rename');
    }
  });
  assert.throws(() => interrupted.setKey(second), /simulierter Prozessabbruch/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), second, 'der neue Schlüssel war bereits veröffentlicht');
  assert.equal(fs.existsSync(`${f.file}.pending.json`), true, 'das fsync-Journal bleibt zur Reparatur liegen');

  const restarted = createRecoveryKeyStore({ env: f.env, filePath: f.file });
  assert.equal(restarted.getKey(), second);
  const after = restarted.publicStatus();
  assert.equal(after.source, 'admin-panel');
  assert.equal(after.generation, before.generation + 1);
  assert.notEqual(after.keyId, before.keyId);
  assert.equal(fs.existsSync(`${f.file}.pending.json`), false);
  assert.equal(
    fs.readdirSync(path.dirname(f.file)).some((name) => name.endsWith('.part')),
    false,
    'temporäre Schlüsseldateien werden nach der Fertigstellung entfernt'
  );
});

test('beschädigte, zu offene oder verlinkte Managed-Dateien fallen nicht still auf die Umgebung zurück', (t) => {
  const f = fixture('gueltiger-umgebungs-fallback-mit-ausreichender-laenge');
  t.after(f.close);
  fs.mkdirSync(path.dirname(f.file), { mode: 0o700 });
  fs.writeFileSync(f.file, 'kurz', { mode: 0o600 });
  let status = f.store.publicStatus();
  assert.equal(status.configured, false);
  assert.equal(status.source, 'error');

  fs.unlinkSync(f.file);
  fs.writeFileSync(f.file, 'gueltiger-aber-zu-offener-schluessel-123456', { mode: 0o644 });
  if (process.platform !== 'win32') {
    status = f.store.publicStatus();
    assert.equal(status.source, 'error');
    assert.match(status.error, /andere Nutzer lesbar/);
  }

  fs.unlinkSync(f.file);
  const target = path.join(f.temp, 'ziel-key');
  fs.writeFileSync(target, 'gueltiger-symlink-schluessel-mit-laenge', { mode: 0o600 });
  fs.symlinkSync(target, f.file);
  status = f.store.publicStatus();
  assert.equal(status.source, 'error');
  assert.match(status.error, /keine reguläre Datei/);
});

test('Secret-Datei innerhalb der Sicherungsdatenwurzel wird abgewiesen', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-key-store-root-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const env = { DOCUMENTS_DATA_ROOT: path.join(temp, 'data') };
  fs.mkdirSync(env.DOCUMENTS_DATA_ROOT);
  assert.throws(
    () => createRecoveryKeyStore({ env, filePath: path.join(env.DOCUMENTS_DATA_ROOT, 'key') }),
    /nicht innerhalb/
  );
});
