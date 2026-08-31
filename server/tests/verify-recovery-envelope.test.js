'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const secureJson = require('../src/security/secure-json');
const backupData = require('../src/modules/backup/portable-data');

const SCRIPT = path.resolve(__dirname, '..', 'tools', 'verify-recovery-envelope.js');

function completePayload(group, generation) {
  const payload = {
    type: group === 'security'
      ? 'betreuungsbuero-sicherheit'
      : 'betreuungsbuero-zugangsdaten',
    version: 3,
    portableSecrets: true,
    omittedTables: [],
    recoverySchema: backupData.recoverySchemaContract(group),
    recoveryGeneration: generation
  };
  for (const definition of backupData.restoreDefinitions(
    group,
    group === 'security' ? { tokenDisposition: 'restore' } : undefined
  )) {
    payload[definition.key] = [];
  }
  if (group === 'security') payload.caseOwners = [];
  return payload;
}

test('Recovery-Prüfer bindet Schlüssel, gemeinsame Generation, Quellrevision und Artefaktbereich', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-envelope-verify-'));
  try {
    const key = `drk1_${'A'.repeat(43)}`;
    const keyId = 'drk_1bfa435d-7a97-4f90-ac0e-413139ea61ba';
    const generationId = '0d419164-4ea4-4eac-bbb8-f43f18299298';
    const sourceRevision = 'ab'.repeat(32);
    const payload = completePayload('security', {
        generationId,
        sourceRevision,
        artifactScope: 'security'
    });
    const envelope = secureJson.encryptJson(payload, key, 'security/3', {
      keyId,
      generationId,
      sourceRevision
    });
    const file = path.join(root, 'Sicherheit.json.enc');
    fs.writeFileSync(file, JSON.stringify(envelope));

    const verified = spawnSync(process.execPath, [SCRIPT, file, 'security/3'], {
      encoding: 'utf8',
      env: { ...process.env, BACKUP_RECOVERY_KEY: key }
    });
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(
      verified.stdout.trim(),
      `OK|${keyId}|${generationId}|${sourceRevision}|${secureJson.fingerprint(key)}|verified`
    );

    const structural = spawnSync(process.execPath, [SCRIPT, file, 'security/3'], {
      encoding: 'utf8',
      env: { ...process.env, BACKUP_RECOVERY_KEY: '' }
    });
    assert.equal(structural.status, 0, structural.stderr);
    assert.match(structural.stdout, /\|unverified\s*$/);

    fs.writeFileSync(file, JSON.stringify({
      ...envelope,
      generationId: '11111111-1111-4111-8111-111111111111'
    }));
    const changed = spawnSync(process.execPath, [SCRIPT, file, 'security/3'], {
      encoding: 'utf8',
      env: { ...process.env, BACKUP_RECOVERY_KEY: key }
    });
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /Metadaten|Generation/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Recovery-Prüfer weist authentische Umschläge ohne vollständigen Restorevertrag ab', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-envelope-shape-'));
  try {
    const key = `drk1_${'B'.repeat(43)}`;
    const keyId = 'drk_77aa8242-4a48-4f9f-8a58-9e6326cf6295';
    const generationId = 'ce2696d6-a8a9-4af3-a85b-d192cfeb0e88';
    const sourceRevision = 'cd'.repeat(32);
    const generation = {
      generationId,
      sourceRevision,
      artifactScope: 'security'
    };
    const payload = completePayload('security', generation);
    delete payload.users;
    const envelope = secureJson.encryptJson(payload, key, 'security/3', {
      keyId,
      generationId,
      sourceRevision
    });
    const file = path.join(root, 'Sicherheit.json.enc');
    fs.writeFileSync(file, JSON.stringify(envelope));

    const result = spawnSync(process.execPath, [SCRIPT, file, 'security/3'], {
      encoding: 'utf8',
      env: { ...process.env, BACKUP_RECOVERY_KEY: key }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Pflichttabelle users/);

    const malformed = completePayload('security', generation);
    malformed.users = {};
    fs.writeFileSync(file, JSON.stringify(secureJson.encryptJson(malformed, key, 'security/3', {
      keyId,
      generationId,
      sourceRevision
    })));
    const malformedResult = spawnSync(process.execPath, [SCRIPT, file, 'security/3'], {
      encoding: 'utf8',
      env: { ...process.env, BACKUP_RECOVERY_KEY: key }
    });
    assert.notEqual(malformedResult.status, 0);
    assert.match(malformedResult.stderr, /Pflichttabelle users.*keine Liste/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
