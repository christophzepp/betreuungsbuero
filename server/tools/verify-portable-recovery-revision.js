#!/usr/bin/env node
'use strict';

/*
 * Prüft, ob eine eigenständige SQLite-Sicherungskopie dieselbe portable
 * Recovery-Quellrevision besitzt wie die zugehörigen Recovery-Artefakte.
 *
 * Aufruf:
 *   ENCRYPTION_KEY=... node verify-portable-recovery-revision.js DB_KOPIE REVISION
 *
 * Sicherheitsvertrag:
 * - ENCRYPTION_KEY wird ausschließlich aus der Prozessumgebung gelesen.
 * - Weder Schlüssel, Dateipfad, Datenbankinhalt noch interne Fehlermeldungen
 *   werden ausgegeben.
 * - stdout enthält ausschließlich den stabilen Erfolgsdatensatz.
 * - stderr enthält ausschließlich einen stabilen, maschinenlesbaren Fehlercode.
 */

const fs = require('fs');
const path = require('path');
const { SERVER_ROOT } = require('../src/config/paths');
const crypto = require('crypto');

const EXIT = Object.freeze({
  OK: 0,
  USAGE: 64,
  DATA: 65,
  NO_INPUT: 66,
  UNAVAILABLE: 69,
  SOFTWARE: 70,
  IO: 74,
  CONFIG: 78
});

class PublicError extends Error {
  constructor(code, exitCode) {
    super(code);
    this.name = 'PublicError';
    this.publicCode = code;
    this.exitCode = exitCode;
  }
}

function fail(code, exitCode) {
  throw new PublicError(code, exitCode);
}

function loadDependencies() {
  const serverRoot = SERVER_ROOT;
  let sqlitePath;
  try {
    sqlitePath = require.resolve('better-sqlite3', { paths: [serverRoot] });
  } catch (_error) {
    fail('SERVER_SQLITE_DEPENDENCY_UNAVAILABLE', EXIT.UNAVAILABLE);
  }
  const serverModules = path.join(serverRoot, 'node_modules') + path.sep;
  if (!path.resolve(sqlitePath).startsWith(serverModules)) {
    fail('SERVER_SQLITE_DEPENDENCY_UNAVAILABLE', EXIT.UNAVAILABLE);
  }

  let Database;
  let backupData;
  let cryptoHelper;
  try {
    Database = require(sqlitePath);
    backupData = require(path.join(serverRoot, 'src', 'modules', 'backup', 'portable-data'));
    cryptoHelper = require(path.join(serverRoot, 'src', 'security', 'crypto'));
  } catch (_error) {
    fail('SERVER_BACKUP_DEPENDENCY_UNAVAILABLE', EXIT.UNAVAILABLE);
  }
  if (typeof Database !== 'function'
      || !backupData
      || typeof backupData.portableRecoverySourceRevision !== 'function'
      || !cryptoHelper
      || typeof cryptoHelper.decryptStrict !== 'function') {
    fail('SERVER_BACKUP_INTERFACE_INVALID', EXIT.UNAVAILABLE);
  }
  return { Database, backupData, cryptoHelper };
}

function validateArguments(args) {
  if (!Array.isArray(args) || args.length !== 2) {
    fail('INVALID_ARGUMENTS', EXIT.USAGE);
  }
  const databasePath = String(args[0] || '');
  const expectedRevision = String(args[1] || '').toLowerCase();
  if (!databasePath || !/^[0-9a-f]{64}$/.test(expectedRevision)) {
    fail('INVALID_ARGUMENTS', EXIT.USAGE);
  }
  return { databasePath: path.resolve(databasePath), expectedRevision };
}

function validateEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/i.test(key)) {
    fail('ENCRYPTION_KEY_INVALID', EXIT.CONFIG);
  }
}

function assertNoSidecars(databasePath) {
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(databasePath + suffix)) {
      fail('DATABASE_SIDECAR_PRESENT', EXIT.DATA);
    }
  }
}

function openVerifiedFile(databasePath) {
  let descriptor;
  try {
    const info = fs.lstatSync(databasePath);
    if (info.isSymbolicLink() || !info.isFile()) {
      fail('DATABASE_PATH_UNSAFE', EXIT.NO_INPUT);
    }
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    descriptor = fs.openSync(databasePath, flags);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.size <= 0n) {
      fail('DATABASE_PATH_UNSAFE', EXIT.NO_INPUT);
    }
    assertNoSidecars(databasePath);
    return {
      descriptor,
      identity: {
        dev: opened.dev,
        ino: opened.ino,
        size: opened.size,
        mtimeNs: opened.mtimeNs,
        ctimeNs: opened.ctimeNs
      }
    };
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_closeError) {}
    }
    if (error instanceof PublicError) throw error;
    if (error && error.code === 'ENOENT') fail('DATABASE_NOT_FOUND', EXIT.NO_INPUT);
    fail('DATABASE_OPEN_FAILED', EXIT.IO);
  }
}

function assertUnchanged(databasePath, identity) {
  try {
    const pathInfo = fs.lstatSync(databasePath);
    const current = fs.statSync(databasePath, { bigint: true });
    if (pathInfo.isSymbolicLink()
        || !current.isFile()
        || current.dev !== identity.dev
        || current.ino !== identity.ino
        || current.size !== identity.size
        || current.mtimeNs !== identity.mtimeNs
        || current.ctimeNs !== identity.ctimeNs) {
      fail('DATABASE_CHANGED_DURING_CHECK', EXIT.DATA);
    }
    assertNoSidecars(databasePath);
  } catch (error) {
    if (error instanceof PublicError) throw error;
    fail('DATABASE_CHANGED_DURING_CHECK', EXIT.DATA);
  }
}

function classifyRecoveryError(error) {
  const code = String(error && error.code || '');
  if (code === 'BACKUP_RECOVERY_SCHEMA_CONTRACT_MISSING'
      || code === 'BACKUP_REQUIRED_TABLE_MISSING'
      || code === 'BACKUP_REQUIRED_COLUMNS_MISMATCH'
      || code === 'BACKUP_TABLE_SCHEMA_READ_FAILED') {
    fail('RECOVERY_SCHEMA_INVALID', EXIT.DATA);
  }
  if (code === 'BACKUP_TABLE_READ_FAILED' || code === 'BACKUP_CASE_OWNERS_READ_FAILED') {
    fail('RECOVERY_DATA_READ_FAILED', EXIT.DATA);
  }
  const message = String(error && error.message || '');
  if (message.includes('ENCRYPTION_KEY') || message.includes('entschlüsselt werden')) {
    fail('RECOVERY_SECRET_DECRYPT_FAILED', EXIT.DATA);
  }
  fail('RECOVERY_REVISION_CALCULATION_FAILED', EXIT.DATA);
}

function verify(databasePath, expectedRevision, dependencies) {
  const { Database, backupData, cryptoHelper } = dependencies;
  const openedFile = openVerifiedFile(databasePath);
  let db;
  try {
    try {
      db = new Database(databasePath, { readonly: true, fileMustExist: true });
      db.pragma('query_only = ON');
    } catch (_error) {
      fail('DATABASE_OPEN_FAILED', EXIT.IO);
    }

    let integrity;
    try {
      integrity = db.pragma('quick_check');
    } catch (_error) {
      fail('DATABASE_INTEGRITY_CHECK_FAILED', EXIT.DATA);
    }
    if (!Array.isArray(integrity)
        || integrity.length !== 1
        || String(integrity[0] && integrity[0].quick_check || '').toLowerCase() !== 'ok') {
      fail('DATABASE_INTEGRITY_CHECK_FAILED', EXIT.DATA);
    }

    let actualRevision;
    try {
      actualRevision = backupData.portableRecoverySourceRevision(db, cryptoHelper);
    } catch (error) {
      classifyRecoveryError(error);
    }
    if (!/^[0-9a-f]{64}$/.test(String(actualRevision || ''))) {
      fail('RECOVERY_REVISION_RESULT_INVALID', EXIT.SOFTWARE);
    }

    assertUnchanged(databasePath, openedFile.identity);
    const actual = Buffer.from(actualRevision, 'hex');
    const expected = Buffer.from(expectedRevision, 'hex');
    if (!crypto.timingSafeEqual(actual, expected)) {
      fail('RECOVERY_REVISION_MISMATCH', EXIT.DATA);
    }
    return actualRevision;
  } finally {
    if (db) {
      try { db.close(); } catch (_error) {}
    }
    try { fs.closeSync(openedFile.descriptor); } catch (_error) {}
  }
}

function run(args) {
  const parsed = validateArguments(args);
  validateEncryptionKey();
  const dependencies = loadDependencies();
  return verify(parsed.databasePath, parsed.expectedRevision, dependencies);
}

function cli() {
  try {
    const revision = run(process.argv.slice(2));
    process.stdout.write(`OK|PORTABLE_RECOVERY_SOURCE_REVISION|${revision}\n`);
    return EXIT.OK;
  } catch (error) {
    const code = error instanceof PublicError ? error.publicCode : 'INTERNAL_ERROR';
    const exitCode = error instanceof PublicError ? error.exitCode : EXIT.SOFTWARE;
    process.stderr.write(`ERROR|${code}\n`);
    return exitCode;
  }
}

if (require.main === module) process.exitCode = cli();

module.exports = {
  EXIT,
  PublicError,
  loadDependencies,
  run,
  verify
};
