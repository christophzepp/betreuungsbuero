'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const secure = require('../src/security/secure-json');

test('verschlüsselt und entschlüsselt schema- und prüfsummengebunden', () => {
  const key = 'extern-verwahrter-testschluessel-2026';
  const payload = { version: 2, umlaut: 'Müller', nested: { b: 2, a: 1 } };
  const envelope = secure.encryptJson(payload, key, 'security/2');
  assert.equal(envelope.algorithm, 'AES-256-GCM');
  assert.equal(envelope.version, 2);
  assert.deepEqual(envelope.keyFingerprintKdf, secure.FINGERPRINT_KDF);
  assert.equal(envelope.keyFingerprint, secure.fingerprint(key));
  const decoded = secure.decryptJson(envelope, key, 'security/2');
  assert.deepEqual(decoded.payload, payload);
  assert.equal(decoded.schema, 'security/2');
});

test('liest historische Version-1-Umschläge, erzeugt sie aber nicht mehr', () => {
  const key = 'extern-verwahrter-testschluessel-2026';
  const current = secure.encryptJson({ legacy: true }, key, 'security/2');
  const legacy = {
    ...current,
    version: 1,
    keyFingerprint: secure._test.legacyFingerprint(key)
  };
  delete legacy.keyFingerprintKdf;
  assert.deepEqual(secure.decryptJson(legacy, key, 'security/2').payload, { legacy: true });
  assert.throws(
    () => secure.decryptJson({ ...legacy, keyFingerprint: secure.fingerprint(key) }, key, 'security/2'),
    /passt nicht/
  );
});

test('weist falschen Schlüssel, Schema und manipulierten Ciphertext ab', () => {
  const key = 'extern-verwahrter-testschluessel-2026';
  const envelope = secure.encryptJson({ ok: true }, key, 'credentials/2');
  assert.throws(() => secure.decryptJson(envelope, 'anderer-testschluessel-2026', 'credentials/2'));
  assert.throws(() => secure.decryptJson(envelope, key, 'security/2'));
  const changed = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA' };
  assert.throws(() => secure.decryptJson(changed, key, 'credentials/2'));
});

test('stableJson ist unabhängig von der Objektschlüssel-Reihenfolge', () => {
  assert.equal(secure.stableJson({ b: 2, a: { d: 4, c: 3 } }), secure.stableJson({ a: { c: 3, d: 4 }, b: 2 }));
});

test('bindet Key-ID, Generation und Quellrevision innen und außen kryptografisch', () => {
  const key = 'extern-verwahrter-testschluessel-2026';
  const generationId = '0d419164-4ea4-4eac-bbb8-f43f18299298';
  const sourceRevision = 'ab'.repeat(32);
  const payload = {
    type: 'betreuungsbuero-sicherheit',
    recoveryGeneration: {
      generationId,
      sourceRevision,
      artifactScope: 'security'
    }
  };
  const envelope = secure.encryptJson(payload, key, 'security/3', {
    keyId: 'drk_1bfa435d-7a97-4f90-ac0e-413139ea61ba',
    generationId,
    sourceRevision
  });
  assert.equal(envelope.generationId, generationId);
  assert.equal(secure.decryptJson(envelope, key, 'security/3').payload.type, payload.type);
  assert.throws(
    () => secure.decryptJson({ ...envelope, generationId: 'andere-generation' }, key, 'security/3'),
    /Metadaten/
  );
});
