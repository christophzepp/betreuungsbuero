'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const preflight = require('../src/modules/backup/preflight');

function successfulSpawn(calls) {
  return (command, args, options) => {
    calls.push({ command, args, env: options.env, detached: options.detached });
    const child = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => child.emit('close', 0, null));
    return child;
  };
}

async function main() {
  for (const required of [
    path.join('src', 'modules', 'backup', 'portable-data.js'),
    path.join('src', 'security', 'secure-json.js'),
    path.join('src', 'security', 'crypto.js'),
    path.join('tools', 'notfall-rettung.sh'),
    path.join('docs', 'NOTFALL-KURZANLEITUNG.txt'),
    path.join('docs', 'NOTFALL-WIEDERHERSTELLUNG.txt')
  ]) {
    assert.ok(preflight._test.REQUIRED_SERVER_FILES.includes(required));
  }
  assert.equal(
    preflight._test.EXECUTABLE_SERVER_FILES.has(path.join('tools', 'gesamt-backup.sh')),
    true
  );

  const generationId = 'generation-2026';
  const sourceRevision = 'ab'.repeat(32);
  const readyRecovery = preflight._test.recoveryReadiness({
    configured: true,
    strong: true,
    requiresRotation: false,
    keyId: 'drk_test',
    fingerprint: 'cd'.repeat(12),
    snapshotsVerified: true,
    snapshots: {
      'security-encrypted': { verified: true, generationId, sourceRevision },
      'credentials-encrypted': { verified: true, generationId, sourceRevision }
    }
  });
  assert.equal(readyRecovery.ready, true);
  assert.equal(readyRecovery.pair.verified, true);
  assert.equal(readyRecovery.key.fingerprint, 'cd'.repeat(12));

  const staleRecovery = preflight._test.recoveryReadiness({
    configured: true,
    strong: true,
    requiresRotation: false,
    snapshotsVerified: true,
    snapshots: {
      'security-encrypted': { verified: true, generationId, sourceRevision },
      'credentials-encrypted': {
        verified: true,
        generationId: 'andere-generation',
        sourceRevision
      }
    }
  });
  assert.equal(staleRecovery.ready, false);
  assert.match(staleRecovery.errors.join(' '), /keine gemeinsame aktuelle Generation/);

  const calls = [];
  const command = await preflight._test.commandStatus('sqlite3', ['--version'], {
    spawnFn: successfulSpawn(calls),
    timeoutMs: 100
  });
  assert.equal(command.valid, true);
  assert.deepEqual(calls[0].args, ['--version']);
  assert.equal(calls[0].detached, process.platform !== 'win32');

  const hanging = await preflight._test.commandStatus('restic', ['version'], {
    spawnFn: () => {
      const child = new EventEmitter();
      child.kill = () => {};
      return child;
    },
    timeoutMs: 5
  });
  assert.equal(hanging.valid, false);
  assert.match(hanging.error, /Zeitgrenze/);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-preflight-'));
  try {
    const toolDir = path.join(temp, 'bin');
    fs.mkdirSync(toolDir);
    const fakeTool = path.join(toolDir, 'backup-tool');
    fs.writeFileSync(fakeTool, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    assert.equal(preflight._test.executableStatus('backup-tool', {
      baseEnvironment: { PATH: toolDir }
    }).valid, true);
    assert.equal(preflight._test.executableStatus('missing-tool', {
      baseEnvironment: { PATH: toolDir }
    }).valid, false);

    const credentialFile = path.join(temp, 'restic.env');
    const passwordFile = path.join(temp, 'restic-password');
    fs.writeFileSync(passwordFile, 'nur-fuer-den-test\n', { mode: 0o600 });
    fs.writeFileSync(
      credentialFile,
      'AWS_ACCESS_KEY_ID=test-id\nAWS_SECRET_ACCESS_KEY=very-secret-test-value\n',
      { mode: 0o600 }
    );
    const remoteCalls = [];
    const baseEnvironment = {
      PATH: process.env.PATH || '/usr/bin:/bin',
      HOME: temp,
      SESSION_SECRET: 'darf-nicht-zum-kindprozess',
      ENCRYPTION_KEY: 'darf-nicht-zum-kindprozess',
      DOCUMENT_RECOVERY_KEY: 'darf-nicht-zum-kindprozess',
      SETUP_TOKEN: 'darf-nicht-zum-kindprozess'
    };
    const remote = await preflight._test.remoteReadiness({
      enabled: true,
      repository: 's3:https://backup.example.invalid/bucket',
      passwordFile
    }, {
      spawnFn: successfulSpawn(remoteCalls),
      timeoutMs: 100,
      baseEnvironment,
      resticCredentialEnvFile: credentialFile
    });
    assert.equal(remote.ready, true);
    assert.equal(remoteCalls.length, 2);
    assert.deepEqual(remoteCalls[1].args.slice(-2), ['cat', 'config']);
    assert.equal(remoteCalls[1].env.AWS_ACCESS_KEY_ID, 'test-id');
    for (const key of [
      'SESSION_SECRET',
      'ENCRYPTION_KEY',
      'DOCUMENT_RECOVERY_KEY',
      'SETUP_TOKEN'
    ]) {
      assert.equal(Object.prototype.hasOwnProperty.call(remoteCalls[0].env, key), false);
      assert.equal(Object.prototype.hasOwnProperty.call(remoteCalls[1].env, key), false);
    }
    assert.doesNotMatch(JSON.stringify(remote), /very-secret-test-value/);

    if (process.platform !== 'win32') {
      fs.chmodSync(passwordFile, 0o400);
      const tooRestrictive = preflight._test.protectedSecretStatus(
        passwordFile,
        'Die restic-Passwortdatei'
      );
      assert.equal(tooRestrictive.valid, false);
      assert.match(tooRestrictive.error, /exakt mit Modus 0600/);
      fs.chmodSync(passwordFile, 0o600);
    }

    const regular = path.join(temp, 'regular');
    fs.writeFileSync(regular, 'ok');
    const symlink = path.join(temp, 'link');
    fs.symlinkSync(regular, symlink);
    assert.equal(preflight._test.safeFileStatus(regular, 'file', 'Datei').valid, true);
    assert.equal(preflight._test.safeFileStatus(symlink, 'file', 'Datei').valid, false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main()
  .then(() => console.log('backup-preflight: lokale, Recovery- und Remote-Bereitschaft ok'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
