#!/usr/bin/env node
'use strict';

/*
 * Fail-closed Wiederherstellung der beiden Docker-Mounts, die der normale
 * GESAMT-RESTORE nicht atomar als ganzen Ordner tauschen kann:
 *
 *   - das Volume mit hochgeladenen Browser-Erweiterungen
 *   - der read-only in die Haupt-App eingehängte outputs/-Hostordner
 *
 * Der Helfer ist ausschließlich für eine gestoppte Anwendung bestimmt. Er
 * prüft vor dem ersten Schreibzugriff den vollständigen Snapshot (nicht nur
 * die beiden Quellordner) gegen MANIFEST.tsv. Alter Zielinhalt wird vor dem
 * Austausch bytegenau im persistenten Restore-State gesichert. Ein
 * ACTIVE.json-Marker sperrt den App-Start, bis ein unterbrochener Lauf mit
 * --resume oder --rollback abgeschlossen wurde.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PREFIX_EXTENSIONS = 'betrieb/browser-erweiterungen/';
const PREFIX_APP = 'betrieb/anwendung/';
const ACTIVE_FILE = 'ACTIVE.json';
const FORMAT = 'Betreuungsbuero-Runtime-Artefakt-Restore/1';
const TEST_FAIL_ENV = 'RUNTIME_ARTIFACT_RESTORE_TEST_FAIL_AT';

class PublicError extends Error {}

function fail(message) {
  throw new PublicError(message);
}

function usage() {
  process.stdout.write(
    'Aufruf:\n'
    + '  restore-runtime-artifacts.js --snapshot ORDNER\\\n'
    + '    --extension-dir ORDNER --outputs-dir ORDNER --state-dir ORDNER\\\n'
    + '    [--apply --confirm-app-stopped] [--resume | --rollback]\n\n'
    + 'Ohne --apply erfolgt ausschließlich ein vollständiger Dry-run.\n'
    + '--resume rollt einen unterbrochenen Lauf sicher zurück und startet ihn neu.\n'
    + '--rollback stellt nur den vor dem unterbrochenen Lauf gesicherten Stand wieder her.\n'
  );
}

function parseArguments(argv) {
  const result = {
    snapshot: '',
    extensionDir: '',
    outputsDir: '',
    stateDir: '',
    apply: false,
    confirmStopped: false,
    resume: false,
    rollback: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--apply') result.apply = true;
    else if (arg === '--confirm-app-stopped') result.confirmStopped = true;
    else if (arg === '--resume') result.resume = true;
    else if (arg === '--rollback') result.rollback = true;
    else if (['--snapshot', '--extension-dir', '--outputs-dir', '--state-dir'].includes(arg)) {
      if (i + 1 >= argv.length) fail(`${arg} braucht einen Wert.`);
      const value = argv[++i];
      if (!value || value.startsWith('--')) fail(`${arg} braucht einen Wert.`);
      if (arg === '--snapshot') result.snapshot = value;
      if (arg === '--extension-dir') result.extensionDir = value;
      if (arg === '--outputs-dir') result.outputsDir = value;
      if (arg === '--state-dir') result.stateDir = value;
    } else {
      fail(`Unbekannte Option: ${arg}`);
    }
  }
  for (const [name, value] of [
    ['--snapshot', result.snapshot],
    ['--extension-dir', result.extensionDir],
    ['--outputs-dir', result.outputsDir],
    ['--state-dir', result.stateDir]
  ]) {
    if (!value) fail(`${name} fehlt.`);
  }
  if (result.resume && result.rollback) fail('--resume und --rollback schließen einander aus.');
  if ((result.resume || result.rollback) && !result.apply) {
    fail('--resume und --rollback erfordern --apply.');
  }
  if (result.apply && !result.confirmStopped) {
    fail('--apply erfordert --confirm-app-stopped.');
  }
  return result;
}

function shaBuffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function shaFile(file) {
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  );
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) fail(`Keine reguläre Datei: ${file}`);
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let size = 0;
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
      size += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
      if (before[field] !== after[field]) {
        fail(`Datei wurde während der Prüfung verändert: ${file}`);
      }
    }
    return { sha256: hash.digest('hex'), size };
  } finally {
    fs.closeSync(descriptor);
  }
}

function lstatRegular(file, label) {
  let info;
  try {
    info = fs.lstatSync(file);
  } catch (_error) {
    fail(`${label} fehlt.`);
  }
  if (info.isSymbolicLink() || !info.isFile()) fail(`${label} ist keine reguläre Datei.`);
  return info;
}

function safeRelative(relative) {
  if (!relative || relative.startsWith('/') || /[\0\r\n\t]/.test(relative)) return false;
  const parts = relative.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..');
}

function decodeManifestPath(encoded) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    fail('MANIFEST.tsv enthält einen ungültigen Base64-Pfad.');
  }
  const value = Buffer.from(encoded, 'base64');
  if (value.toString('base64') !== encoded) {
    fail('MANIFEST.tsv enthält einen nicht kanonischen Base64-Pfad.');
  }
  const relative = value.toString('utf8');
  if (!Buffer.from(relative, 'utf8').equals(value) || !safeRelative(relative)) {
    fail('MANIFEST.tsv enthält einen unsicheren Pfad.');
  }
  return relative;
}

function enumerateTree(root) {
  const files = [];
  function visit(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!safeRelative(relative)) fail(`Unsicherer Dateiname im Baum: ${relative}`);
      const absolute = path.join(directory, entry.name);
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) fail(`Symbolischer Link ist nicht zulässig: ${relative}`);
      if (info.isDirectory()) visit(absolute, relative);
      else if (info.isFile()) files.push(relative);
      else fail(`Spezialdatei ist nicht zulässig: ${relative}`);
    }
  }
  visit(root, '');
  return files.sort();
}

function verifySnapshot(rawSnapshot) {
  if (!path.isAbsolute(rawSnapshot)) fail('--snapshot muss absolut sein.');
  const lexical = path.resolve(rawSnapshot);
  const rootInfo = fs.lstatSync(lexical);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    fail('Der Snapshot muss ein regulärer Ordner sein.');
  }
  const snapshot = fs.realpathSync(lexical);
  lstatRegular(path.join(snapshot, 'STATUS.txt'), 'STATUS.txt');
  if (fs.readFileSync(path.join(snapshot, 'STATUS.txt'), 'utf8') !== 'VOLLSTAENDIG\n') {
    fail('Der Snapshot ist nicht als VOLLSTAENDIG veröffentlicht.');
  }
  const manifestFile = path.join(snapshot, 'MANIFEST.tsv');
  const manifestHashFile = path.join(snapshot, 'MANIFEST.tsv.sha256');
  lstatRegular(manifestFile, 'MANIFEST.tsv');
  lstatRegular(manifestHashFile, 'MANIFEST.tsv.sha256');
  const expectedManifestHash = fs.readFileSync(manifestHashFile, 'utf8').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedManifestHash)
      || shaFile(manifestFile).sha256 !== expectedManifestHash) {
    fail('MANIFEST.tsv.sha256 stimmt nicht.');
  }

  const manifestText = fs.readFileSync(manifestFile, 'utf8');
  if (!manifestText.endsWith('\n')) fail('MANIFEST.tsv ist unvollständig.');
  const entries = [];
  const seen = new Set();
  for (const line of manifestText.slice(0, -1).split('\n')) {
    const fields = line.split('\t');
    if (fields.length !== 3 || !/^[0-9a-fA-F]{64}$/.test(fields[0])
        || !/^(0|[1-9][0-9]*)$/.test(fields[1])) {
      fail('MANIFEST.tsv enthält eine ungültige Zeile.');
    }
    const relative = decodeManifestPath(fields[2]);
    if (seen.has(relative)) fail('MANIFEST.tsv enthält einen Pfad mehrfach.');
    seen.add(relative);
    const absolute = path.join(snapshot, ...relative.split('/'));
    lstatRegular(absolute, `Manifestdatei ${relative}`);
    const actual = shaFile(absolute);
    if (actual.size !== Number(fields[1])
        || actual.sha256 !== fields[0].toLowerCase()) {
      fail(`Manifestprüfung fehlgeschlagen: ${relative}`);
    }
    entries.push({
      relative,
      absolute,
      size: actual.size,
      sha256: actual.sha256
    });
  }

  const actualFiles = enumerateTree(snapshot);
  const expectedFiles = [...seen, 'MANIFEST.tsv', 'MANIFEST.tsv.sha256'].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    fail('Der Snapshot enthält nicht manifestierte oder fehlende Dateien.');
  }

  const extensionEntries = entries
    .filter((entry) => entry.relative.startsWith(PREFIX_EXTENSIONS))
    .map((entry) => ({ ...entry, targetRelative: entry.relative.slice(PREFIX_EXTENSIONS.length) }));
  const appEntries = entries
    .filter((entry) => entry.relative.startsWith(PREFIX_APP))
    .map((entry) => ({ ...entry, targetRelative: entry.relative.slice(PREFIX_APP.length) }));
  if (extensionEntries.some((entry) => !safeRelative(entry.targetRelative))) {
    fail('Browser-Erweiterungsartefakt besitzt einen unsicheren Zielpfad.');
  }
  if (appEntries.length !== 1 || appEntries[0].targetRelative.includes('/')
      || !/^Betreuungsbuero_Dokumentenassistent_v[^/]+\.html$/.test(
        appEntries[0].targetRelative
      )) {
    fail('Der Snapshot enthält nicht genau eine eindeutige ausgelieferte HTML-App.');
  }
  return {
    snapshot,
    manifestSha256: expectedManifestHash,
    extensionEntries,
    appEntries
  };
}

function canonicalDirectory(raw, label) {
  if (!path.isAbsolute(raw) || path.resolve(raw) === path.parse(path.resolve(raw)).root) {
    fail(`${label} muss ein absoluter, enger Ordnerpfad sein.`);
  }
  const lexical = path.resolve(raw);
  let info;
  try {
    info = fs.lstatSync(lexical);
  } catch (_error) {
    fail(`${label} muss bereits vorhanden sein.`);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    fail(`${label} muss ein regulärer Ordner sein.`);
  }
  return fs.realpathSync(lexical);
}

function overlaps(first, second) {
  return first === second
    || first.startsWith(second + path.sep)
    || second.startsWith(first + path.sep);
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function atomicJson(file, value, exclusive) {
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  const descriptor = fs.openSync(
    temporary,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW || 0),
    0o600
  );
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (exclusive) {
    try {
      fs.linkSync(temporary, file);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      if (error && error.code === 'EEXIST') {
        fail('Ein früherer Runtime-Artefakt-Restore ist noch aktiv.');
      }
      throw error;
    }
    fs.rmSync(temporary);
  } else {
    fs.renameSync(temporary, file);
  }
  fsyncDirectory(directory);
}

function copyVerified(source, destination, expected) {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const sourceDescriptor = fs.openSync(
    source,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  );
  const destinationDescriptor = fs.openSync(
    destination,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW || 0),
    0o600
  );
  let sourceBefore;
  try {
    sourceBefore = fs.fstatSync(sourceDescriptor, { bigint: true });
    if (!sourceBefore.isFile()) fail(`Kopierquelle ist keine reguläre Datei: ${source}`);
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let size = 0;
    for (;;) {
      const count = fs.readSync(sourceDescriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      let written = 0;
      while (written < count) {
        written += fs.writeSync(
          destinationDescriptor,
          buffer,
          written,
          count - written,
          null
        );
      }
      hash.update(buffer.subarray(0, count));
      size += count;
    }
    fs.fsyncSync(destinationDescriptor);
    const sourceAfter = fs.fstatSync(sourceDescriptor, { bigint: true });
    for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
      if (sourceBefore[field] !== sourceAfter[field]) {
        fail(`Kopierquelle wurde während des Lesens verändert: ${source}`);
      }
    }
    const actual = { size, sha256: hash.digest('hex') };
    if (expected && (actual.size !== expected.size || actual.sha256 !== expected.sha256)) {
      fail(`Kopierte Datei stimmt nicht: ${source}`);
    }
    fsyncDirectory(path.dirname(destination));
    return actual;
  } catch (error) {
    try { fs.closeSync(destinationDescriptor); } catch (_closeError) {}
    try { fs.closeSync(sourceDescriptor); } catch (_closeError) {}
    fs.rmSync(destination, { force: true });
    throw error;
  } finally {
    try { fs.closeSync(destinationDescriptor); } catch (_error) {}
    try { fs.closeSync(sourceDescriptor); } catch (_error) {}
  }
}

function copyEntries(entries, targetRoot) {
  for (const entry of entries) {
    copyVerified(
      entry.absolute,
      path.join(targetRoot, ...entry.targetRelative.split('/')),
      entry
    );
  }
}

function treeManifest(root, ignoredNames) {
  const ignored = new Set(ignoredNames || []);
  const rows = [];
  function visit(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!prefix && ignored.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!safeRelative(relative)) fail(`Unsicherer Zielpfad: ${relative}`);
      const absolute = path.join(directory, entry.name);
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) fail(`Symbolischer Link im Ziel: ${relative}`);
      if (info.isDirectory()) visit(absolute, relative);
      else if (info.isFile()) {
        const actual = shaFile(absolute);
        rows.push({ relative, ...actual });
      } else fail(`Spezialdatei im Ziel: ${relative}`);
    }
  }
  visit(root, '');
  return rows.sort((a, b) => a.relative.localeCompare(b.relative, 'en'));
}

function copyTreeFromManifest(sourceRoot, destinationRoot, manifest) {
  fs.mkdirSync(destinationRoot, { recursive: false, mode: 0o700 });
  for (const row of manifest) {
    copyVerified(
      path.join(sourceRoot, ...row.relative.split('/')),
      path.join(destinationRoot, ...row.relative.split('/')),
      row
    );
  }
  const copied = normalizedTree(treeManifest(destinationRoot));
  if (JSON.stringify(copied) !== JSON.stringify(normalizedTree(manifest))) {
    fail('Rollback-Kopie stimmt nicht mit dem alten Zielstand überein.');
  }
}

function readJsonRegular(file, label) {
  lstatRegular(file, label);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_error) {
    fail(`${label} ist ungültig.`);
  }
}

function writeMarker(activePath, marker) {
  atomicJson(activePath, marker, false);
}

function cleanDirectoryExcept(root, keepNames) {
  const keep = new Set(keepNames || []);
  for (const name of fs.readdirSync(root)) {
    if (keep.has(name)) continue;
    const target = path.join(root, name);
    const info = fs.lstatSync(target);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
      fail(`Unsicheres Zielobjekt kann nicht kontrolliert ersetzt werden: ${name}`);
    }
    fs.rmSync(target, { recursive: info.isDirectory(), force: false });
  }
  fsyncDirectory(root);
}

function publishStage(stage, target) {
  for (const name of fs.readdirSync(stage)) {
    fs.renameSync(path.join(stage, name), path.join(target, name));
  }
  fs.rmdirSync(stage);
  fsyncDirectory(target);
}

function expectedTree(entries) {
  return entries
    .map((entry) => ({
      relative: entry.targetRelative,
      size: entry.size,
      sha256: entry.sha256
    }))
    .sort((a, b) => a.relative.localeCompare(b.relative, 'en'));
}

function normalizedTree(rows) {
  return rows
    .map((row) => ({
      relative: row.relative,
      sha256: row.sha256,
      size: row.size
    }))
    .sort((a, b) => a.relative.localeCompare(b.relative, 'en'));
}

function assertTree(root, expected, ignoredNames) {
  const actual = normalizedTree(treeManifest(root, ignoredNames));
  if (JSON.stringify(actual) !== JSON.stringify(normalizedTree(expected))) {
    fail(`Zielprüfung fehlgeschlagen: ${root}`);
  }
}

function validateMarker(marker, context) {
  if (!marker || marker.format !== FORMAT || !/^[0-9a-f]{24}$/.test(marker.id || '')) {
    fail('ACTIVE.json besitzt ein unbekanntes Format.');
  }
  for (const key of ['snapshot', 'extensionDir', 'outputsDir', 'stateDir']) {
    if (marker[key] !== context[key]) {
      fail(`ACTIVE.json passt nicht zum aktuellen Ziel (${key}).`);
    }
  }
  if (marker.manifestSha256 !== context.manifestSha256) {
    fail('ACTIVE.json gehört zu einer anderen Snapshotfassung.');
  }
  const transactionDir = path.join(context.stateDir, `runtime-artifacts-${marker.id}`);
  const stageName = `.bb-runtime-stage-${marker.id}`;
  if (marker.transactionDir !== transactionDir
      || marker.extensionStageName !== stageName
      || marker.outputsStageName !== stageName) {
    fail('ACTIVE.json enthält unzulässige interne Restore-Pfade.');
  }
  const transactionInfo = fs.lstatSync(transactionDir);
  if (transactionInfo.isSymbolicLink() || !transactionInfo.isDirectory()
      || path.dirname(fs.realpathSync(transactionDir)) !== context.stateDir) {
    fail('Der Runtime-Restore-Transaktionsordner ist unsicher.');
  }
  return { transactionDir, stageName };
}

function restoreOldTarget(target, stageName, backupRoot, manifest) {
  const recoveryName = `.bb-runtime-rollback-stage-${crypto.randomBytes(8).toString('hex')}`;
  const recoveryStage = path.join(target, recoveryName);
  copyTreeFromManifest(backupRoot, recoveryStage, manifest);
  cleanDirectoryExcept(target, [recoveryName]);
  publishStage(recoveryStage, target);
  assertTree(target, manifest);
  if (stageName && fs.existsSync(path.join(target, stageName))) {
    fail('Interne Restore-Stufe blieb nach dem Rollback zurück.');
  }
}

function rollbackActive(context, activePath) {
  const marker = readJsonRegular(activePath, 'ACTIVE.json');
  const binding = validateMarker(marker, context);
  const transactionDir = binding.transactionDir;
  if (marker.phase === 'PREPARING') {
    for (const [target, stageName] of [
      [context.extensionDir, binding.stageName],
      [context.outputsDir, binding.stageName]
    ]) {
      const stage = path.join(target, stageName);
      if (fs.existsSync(stage)) {
        const info = fs.lstatSync(stage);
        if (info.isSymbolicLink() || !info.isDirectory()) {
          fail('Die unterbrochene Restore-Stufe ist kein regulärer Ordner.');
        }
        fs.rmSync(stage, { recursive: true });
        fsyncDirectory(target);
      }
    }
    atomicJson(path.join(transactionDir, 'ROLLED_BACK.json'), {
      format: FORMAT,
      id: marker.id,
      rolledBackAt: new Date().toISOString(),
      previousPhase: marker.phase
    }, false);
    fs.rmSync(activePath);
    fsyncDirectory(context.stateDir);
    process.stdout.write(`ROLLBACK=OK TRANSAKTION=${marker.id}\n`);
    return;
  }
  if (!['READY', 'ACTIVATING', 'COMMITTED'].includes(marker.phase)) {
    fail('ACTIVE.json enthält eine unbekannte Restore-Phase.');
  }
  const extensionManifest = readJsonRegular(
    path.join(transactionDir, 'old-extensions.json'),
    'old-extensions.json'
  );
  const outputsManifest = readJsonRegular(
    path.join(transactionDir, 'old-outputs.json'),
    'old-outputs.json'
  );
  if (!Array.isArray(extensionManifest) || !Array.isArray(outputsManifest)) {
    fail('Rollback-Manifeste sind ungültig.');
  }
  restoreOldTarget(
    context.extensionDir,
    binding.stageName,
    path.join(transactionDir, 'old-extensions'),
    extensionManifest
  );
  restoreOldTarget(
    context.outputsDir,
    binding.stageName,
    path.join(transactionDir, 'old-outputs'),
    outputsManifest
  );
  atomicJson(path.join(transactionDir, 'ROLLED_BACK.json'), {
    format: FORMAT,
    id: marker.id,
    rolledBackAt: new Date().toISOString()
  }, false);
  fs.rmSync(activePath);
  fsyncDirectory(context.stateDir);
  process.stdout.write(`ROLLBACK=OK TRANSAKTION=${marker.id}\n`);
}

function maybeInjectFailure(point) {
  if (process.env.NODE_ENV === 'test' && process.env[TEST_FAIL_ENV] === point) {
    fail(`INJIZIERTER_TESTABBRUCH:${point}`);
  }
}

function applyRestore(context, activePath) {
  const id = crypto.randomBytes(12).toString('hex');
  const transactionDir = path.join(context.stateDir, `runtime-artifacts-${id}`);
  fs.mkdirSync(transactionDir, { mode: 0o700 });
  fsyncDirectory(context.stateDir);
  const extensionStageName = `.bb-runtime-stage-${id}`;
  const outputsStageName = `.bb-runtime-stage-${id}`;
  const extensionStage = path.join(context.extensionDir, extensionStageName);
  const outputsStage = path.join(context.outputsDir, outputsStageName);
  const marker = {
    format: FORMAT,
    id,
    phase: 'PREPARING',
    startedAt: new Date().toISOString(),
    snapshot: context.snapshot,
    manifestSha256: context.manifestSha256,
    extensionDir: context.extensionDir,
    outputsDir: context.outputsDir,
    stateDir: context.stateDir,
    transactionDir,
    extensionStageName,
    outputsStageName
  };
  atomicJson(activePath, marker, true);

  fs.mkdirSync(extensionStage, { mode: 0o700 });
  fs.mkdirSync(outputsStage, { mode: 0o700 });
  copyEntries(context.extensionEntries, extensionStage);
  copyEntries(context.appEntries, outputsStage);
  const extensionExpected = expectedTree(context.extensionEntries);
  const outputsExpected = expectedTree(context.appEntries);
  assertTree(extensionStage, extensionExpected);
  assertTree(outputsStage, outputsExpected);

  const oldExtensions = treeManifest(context.extensionDir, [extensionStageName]);
  const oldOutputs = treeManifest(context.outputsDir, [outputsStageName]);
  copyTreeFromManifest(
    context.extensionDir,
    path.join(transactionDir, 'old-extensions'),
    oldExtensions
  );
  copyTreeFromManifest(
    context.outputsDir,
    path.join(transactionDir, 'old-outputs'),
    oldOutputs
  );
  atomicJson(path.join(transactionDir, 'old-extensions.json'), oldExtensions, false);
  atomicJson(path.join(transactionDir, 'old-outputs.json'), oldOutputs, false);
  marker.phase = 'READY';
  writeMarker(activePath, marker);

  marker.phase = 'ACTIVATING';
  writeMarker(activePath, marker);
  cleanDirectoryExcept(context.extensionDir, [extensionStageName]);
  maybeInjectFailure('after_extensions_clear');
  publishStage(extensionStage, context.extensionDir);
  cleanDirectoryExcept(context.outputsDir, [outputsStageName]);
  maybeInjectFailure('after_outputs_clear');
  publishStage(outputsStage, context.outputsDir);
  assertTree(context.extensionDir, extensionExpected);
  assertTree(context.outputsDir, outputsExpected);

  marker.phase = 'COMMITTED';
  marker.committedAt = new Date().toISOString();
  writeMarker(activePath, marker);
  atomicJson(path.join(transactionDir, 'COMPLETED.json'), {
    format: FORMAT,
    id,
    committedAt: marker.committedAt,
    snapshot: context.snapshot,
    manifestSha256: context.manifestSha256
  }, false);
  fs.rmSync(activePath);
  fsyncDirectory(context.stateDir);
  process.stdout.write(
    `RESTORE=OK TRANSAKTION=${id} ERWEITERUNGEN=${extensionExpected.length} APP=1\n`
  );
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const verified = verifySnapshot(options.snapshot);
  const extensionDir = canonicalDirectory(options.extensionDir, '--extension-dir');
  const outputsDir = canonicalDirectory(options.outputsDir, '--outputs-dir');
  const stateDir = canonicalDirectory(options.stateDir, '--state-dir');
  for (const [firstName, first, secondName, second] of [
    ['Snapshot', verified.snapshot, 'Browser-Erweiterungsziel', extensionDir],
    ['Snapshot', verified.snapshot, 'App-Ausgabeziel', outputsDir],
    ['Snapshot', verified.snapshot, 'Restore-State', stateDir],
    ['Browser-Erweiterungsziel', extensionDir, 'App-Ausgabeziel', outputsDir],
    ['Browser-Erweiterungsziel', extensionDir, 'Restore-State', stateDir],
    ['App-Ausgabeziel', outputsDir, 'Restore-State', stateDir]
  ]) {
    if (overlaps(first, second)) fail(`${firstName} und ${secondName} dürfen sich nicht überlappen.`);
  }
  const context = {
    ...verified,
    extensionDir,
    outputsDir,
    stateDir
  };
  const activePath = path.join(stateDir, ACTIVE_FILE);
  if (!options.apply) {
    if (fs.existsSync(activePath)) {
      fail('Ein unterbrochener Runtime-Artefakt-Restore verlangt --resume oder --rollback.');
    }
    // Auch der Dry-run prüft vorhandene Ziele vollständig auf unsichere Objekte.
    treeManifest(extensionDir);
    treeManifest(outputsDir);
    process.stdout.write(
      `DRY_RUN=1 MANIFEST=OK ERWEITERUNGEN=${verified.extensionEntries.length} APP=1\n`
    );
    return;
  }

  if (fs.existsSync(activePath)) {
    if (!options.resume && !options.rollback) {
      fail('Ein unterbrochener Runtime-Artefakt-Restore verlangt --resume oder --rollback.');
    }
    rollbackActive(context, activePath);
    if (options.rollback) return;
  } else if (options.resume || options.rollback) {
    fail('Es gibt keinen unterbrochenen Runtime-Artefakt-Restore.');
  }
  applyRestore(context, activePath);
}

try {
  main();
} catch (error) {
  const message = error instanceof PublicError ? error.message : 'Interner Restore-Fehler.';
  process.stderr.write(`restore-runtime-artifacts: ${message}\n`);
  process.exitCode = 2;
}
