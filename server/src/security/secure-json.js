'use strict';

const crypto = require('crypto');

const FORMAT = 'Betreuungsbüro-Sicherungsabbild/1';
const KDF = Object.freeze({ name: 'scrypt', N: 16384, r: 8, p: 1 });
const FINGERPRINT_KDF = Object.freeze({
  name: 'scrypt',
  version: 1,
  N: 16384,
  r: 8,
  p: 1,
  salt: 'Betreuungsbuero-Recovery-Key-ID-v1'
});

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ':' + stableJson(value[key])
    ).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function validatedRecoveryKey(recoveryKey) {
  const key = String(recoveryKey || '');
  if (key.length < 16) throw new Error('Der Wiederherstellungsschlüssel muss mindestens 16 Zeichen lang sein.');
  return key;
}

function legacyFingerprint(recoveryKey) {
  const key = validatedRecoveryKey(recoveryKey);
  return sha256(Buffer.from('Betreuungsbuero-Wiederherstellung:' + key, 'utf8')).slice(0, 24);
}

function fingerprint(recoveryKey) {
  const key = validatedRecoveryKey(recoveryKey);
  return crypto.scryptSync(
    key,
    Buffer.from(FINGERPRINT_KDF.salt, 'utf8'),
    12,
    { N: FINGERPRINT_KDF.N, r: FINGERPRINT_KDF.r, p: FINGERPRINT_KDF.p }
  ).toString('hex');
}

function sameFingerprint(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizedMetadata(options) {
  const source = options && typeof options === 'object' ? options : {};
  const out = {};
  for (const key of ['keyId', 'generationId', 'sourceRevision']) {
    const value = String(source[key] || '').trim();
    if (value) out[key] = value;
  }
  return out;
}

function derive(recoveryKey, salt) {
  const key = validatedRecoveryKey(recoveryKey);
  return crypto.scryptSync(key, salt, 32, { N: KDF.N, r: KDF.r, p: KDF.p });
}

function encryptJson(payload, recoveryKey, schema, options) {
  const metadata = normalizedMetadata(options);
  const plainObject = {
    format: FORMAT,
    schema: String(schema || 'generic/1'),
    createdAt: new Date().toISOString(),
    ...(Object.keys(metadata).length ? { metadata } : {}),
    payload
  };
  const plaintext = Buffer.from(stableJson(plainObject), 'utf8');
  const checksum = sha256(plaintext);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derive(recoveryKey, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: FORMAT,
    version: 2,
    schema: plainObject.schema,
    algorithm: 'AES-256-GCM',
    kdf: KDF,
    ...(metadata.keyId ? { keyId: metadata.keyId } : {}),
    ...(metadata.generationId ? { generationId: metadata.generationId } : {}),
    ...(metadata.sourceRevision ? { sourceRevision: metadata.sourceRevision } : {}),
    // Der Fingerabdruck dient nur dem lokalen Rettungswerkzeug. Seit Version 2 ist
    // auch dieser Prüfer absichtlich scrypt-gebremst; die alte schnelle SHA-Ableitung
    // wird ausschließlich beim Lesen historischer Version-1-Umschläge akzeptiert.
    keyFingerprintKdf: FINGERPRINT_KDF,
    keyFingerprint: fingerprint(recoveryKey),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    checksum,
    ciphertext: ciphertext.toString('base64')
  };
}

function decryptJson(envelope, recoveryKey, expectedSchema) {
  const value = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
  const version = Number(value && value.version);
  if (!value || value.format !== FORMAT || ![1, 2].includes(version)) {
    throw new Error('Unbekanntes Format der verschlüsselten Sicherung.');
  }
  if (expectedSchema && value.schema !== expectedSchema) {
    throw new Error(`Falsches Sicherungsschema: erwartet ${expectedSchema}.`);
  }
  if (version === 2) {
    const fp = value.keyFingerprintKdf;
    if (!fp || fp.name !== FINGERPRINT_KDF.name || Number(fp.version) !== FINGERPRINT_KDF.version
        || Number(fp.N) !== FINGERPRINT_KDF.N || Number(fp.r) !== FINGERPRINT_KDF.r
        || Number(fp.p) !== FINGERPRINT_KDF.p || fp.salt !== FINGERPRINT_KDF.salt) {
      throw new Error('Die Fingerabdruck-KDF der verschlüsselten Sicherung ist ungültig.');
    }
  }
  const expectedFingerprint = version === 1
    ? legacyFingerprint(recoveryKey)
    : fingerprint(recoveryKey);
  if (!sameFingerprint(value.keyFingerprint, expectedFingerprint)) {
    throw new Error('Der Wiederherstellungsschlüssel passt nicht zu dieser Sicherung.');
  }
  const salt = Buffer.from(String(value.salt || ''), 'base64');
  const iv = Buffer.from(String(value.iv || ''), 'base64');
  const tag = Buffer.from(String(value.tag || ''), 'base64');
  const ciphertext = Buffer.from(String(value.ciphertext || ''), 'base64');
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || !ciphertext.length) {
    throw new Error('Die verschlüsselte Sicherung ist unvollständig.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', derive(recoveryKey, salt), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (sha256(plaintext) !== String(value.checksum || '').toLowerCase()) {
    throw new Error('Die Prüfsumme der entschlüsselten Sicherung stimmt nicht.');
  }
  const decoded = JSON.parse(plaintext.toString('utf8'));
  if (!decoded || decoded.format !== FORMAT || decoded.schema !== value.schema) {
    throw new Error('Das innere Sicherungsschema ist ungültig.');
  }
  const innerMetadata = normalizedMetadata(decoded.metadata);
  for (const key of ['keyId', 'generationId', 'sourceRevision']) {
    const outer = String(value[key] || '');
    const inner = String(innerMetadata[key] || '');
    if (outer !== inner) {
      throw new Error(`Die Metadaten der verschlüsselten Sicherung sind inkonsistent (${key}).`);
    }
  }
  const payloadGeneration = decoded.payload && decoded.payload.recoveryGeneration;
  if (payloadGeneration && typeof payloadGeneration === 'object') {
    if (String(payloadGeneration.generationId || '') !== String(value.generationId || '')
        || String(payloadGeneration.sourceRevision || '') !== String(value.sourceRevision || '')) {
      throw new Error('Die Wiederherstellungsgeneration der Nutzlast stimmt nicht mit der Hülle überein.');
    }
  }
  return decoded;
}

module.exports = {
  FORMAT,
  FINGERPRINT_KDF,
  decryptJson,
  encryptJson,
  fingerprint,
  sha256,
  stableJson,
  _test: { legacyFingerprint, normalizedMetadata }
};
