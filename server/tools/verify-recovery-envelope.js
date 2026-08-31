#!/usr/bin/env node
'use strict';

// Struktur- und – wenn der Schlüssel ausschließlich über die Umgebung
// bereitsteht – Authentizitätsprüfung für portable Recovery-Umschläge.
// Es werden weder Schlüssel noch entschlüsselte Nutzdaten ausgegeben.

const fs = require('fs');
const path = require('path');
const secureJson = require('../src/security/secure-json');
const backupData = require('../src/modules/backup/portable-data');

function fail(message) {
  process.stderr.write(String(message || 'Unbekannter Prüfungsfehler') + '\n');
  process.exit(2);
}

function strictBase64(value, bytes, field, allowEmpty) {
  if (typeof value !== 'string' || (!allowEmpty && !value)) {
    throw new Error(`${field} fehlt.`);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${field} ist nicht kanonisches Base64.`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (bytes !== null && decoded.length !== bytes) {
    throw new Error(`${field} hat ${decoded.length} statt ${bytes} Bytes.`);
  }
  if (!allowEmpty && decoded.length === 0) throw new Error(`${field} ist leer.`);
  if (decoded.toString('base64') !== value) throw new Error(`${field} ist nicht kanonisches Base64.`);
  return decoded;
}

function validateRestorePayloadShape(payload, expectedSchema) {
  backupData.validatePortableRecoveryPayload(
    payload,
    expectedSchema === 'security/3' ? 'security' : 'credentials'
  );
}

try {
  const file = process.argv[2];
  const expectedSchema = process.argv[3];
  if (!file || !expectedSchema) fail('Aufruf: verify-recovery-envelope.js DATEI SCHEMA');

  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!envelope || Array.isArray(envelope) || typeof envelope !== 'object') {
    throw new Error('Der Verschlüsselungsumschlag ist kein JSON-Objekt.');
  }
  const envelopeVersion = Number(envelope.version);
  if (envelope.format !== secureJson.FORMAT || ![1, 2].includes(envelopeVersion)
      || envelope.schema !== expectedSchema || envelope.algorithm !== 'AES-256-GCM') {
    throw new Error(`Format, Version, Algorithmus oder Schema ${expectedSchema} ist ungültig.`);
  }
  const kdf = envelope.kdf;
  if (!kdf || Array.isArray(kdf) || typeof kdf !== 'object'
      || kdf.name !== 'scrypt' || Number(kdf.N) !== 16384
      || Number(kdf.r) !== 8 || Number(kdf.p) !== 1) {
    throw new Error('Die scrypt-Parameter kdf(name,N,r,p) sind unvollständig oder unerwartet.');
  }
  if (!/^[0-9a-f]{24}$/i.test(String(envelope.keyFingerprint || ''))) {
    throw new Error('Der Recovery-Key-Fingerabdruck ist ungültig.');
  }
  if (envelopeVersion === 2) {
    const fingerprintKdf = envelope.keyFingerprintKdf;
    const expected = secureJson.FINGERPRINT_KDF;
    if (!fingerprintKdf || Array.isArray(fingerprintKdf) || typeof fingerprintKdf !== 'object'
        || fingerprintKdf.name !== expected.name
        || Number(fingerprintKdf.version) !== expected.version
        || Number(fingerprintKdf.N) !== expected.N
        || Number(fingerprintKdf.r) !== expected.r
        || Number(fingerprintKdf.p) !== expected.p
        || fingerprintKdf.salt !== expected.salt) {
      throw new Error('Die scrypt-Parameter des Recovery-Key-Fingerabdrucks sind unvollständig oder unerwartet.');
    }
  }
  if (!/^(?:drk_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|legacy_[0-9a-f]{32})$/i
    .test(String(envelope.keyId || ''))) {
    throw new Error('Die Recovery-Key-ID ist ungültig.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(envelope.generationId || ''))) {
    throw new Error('Die Recovery-Generationskennung ist ungültig.');
  }
  if (!/^[0-9a-f]{64}$/i.test(String(envelope.sourceRevision || ''))) {
    throw new Error('Die Quellrevision der Recovery-Generation ist ungültig.');
  }
  if (!/^[0-9a-f]{64}$/i.test(String(envelope.checksum || ''))) {
    throw new Error('Die Klartext-Prüfsumme ist ungültig.');
  }
  strictBase64(envelope.salt, 16, 'salt', false);
  strictBase64(envelope.iv, 12, 'iv', false);
  strictBase64(envelope.tag, 16, 'tag', false);
  strictBase64(envelope.ciphertext, null, 'ciphertext', false);

  const recoveryKey = String(process.env.BACKUP_RECOVERY_KEY || '');
  let cryptoState = 'unverified';
  if (recoveryKey) {
    const decoded = secureJson.decryptJson(envelope, recoveryKey, expectedSchema);
    const expectedType = expectedSchema === 'security/3'
      ? 'betreuungsbuero-sicherheit'
      : expectedSchema === 'credentials/3'
        ? 'betreuungsbuero-zugangsdaten'
        : '';
    if (!decoded || decoded.format !== secureJson.FORMAT || decoded.schema !== expectedSchema
        || !decoded.payload || Array.isArray(decoded.payload)
        || typeof decoded.payload !== 'object'
        || decoded.payload.type !== expectedType
        || Number(decoded.payload.version) !== 3) {
      throw new Error('Inneres Format, Schema, Payload-Typ oder Payload-Version ist ungültig.');
    }
    const generation = decoded.payload.recoveryGeneration;
    const expectedScope = expectedSchema === 'security/3' ? 'security' : 'credentials';
    if (!generation || Array.isArray(generation) || typeof generation !== 'object'
        || generation.generationId !== envelope.generationId
        || generation.sourceRevision !== envelope.sourceRevision
        || generation.artifactScope !== expectedScope) {
      throw new Error('Die authentifizierte Recovery-Generation oder ihr Artefaktbereich ist ungültig.');
    }
    validateRestorePayloadShape(decoded.payload, expectedSchema);
    cryptoState = 'verified';
  }
  process.stdout.write(
    `OK|${String(envelope.keyId).toLowerCase()}|${String(envelope.generationId).toLowerCase()}|`
    + `${String(envelope.sourceRevision).toLowerCase()}|`
    + `${String(envelope.keyFingerprint).toLowerCase()}|${cryptoState}\n`
  );
} catch (error) {
  fail(error && error.message ? error.message : error);
}
