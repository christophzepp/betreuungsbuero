'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const backupDownload = require('../src/modules/backup/download');
const { zipSchreiben } = require('../src/modules/backup/document-backup');

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function makeSnapshot(root, options) {
  const opts = options || {};
  const name = opts.name || 'Gesamtsicherung_20260728_023000_test';
  const snapshot = path.join(root, name);
  fs.mkdirSync(path.join(snapshot, 'verwaltung'), { recursive: true });
  const files = {
    'STATUS.txt': Buffer.from('VOLLSTAENDIG\n'),
    'verwaltung/JOB-ID.txt': Buffer.from((opts.jobId || 'job-a') + '\n'),
    'verwaltung/TARGET-ID.txt': Buffer.from(
      (opts.targetId || '11111111-1111-4111-8111-111111111111') + '\n'
    ),
    'daten/database.sqlite': Buffer.from('sqlite-test'),
    'dokumente/Akte/260728 Bescheid.pdf': Buffer.from('%PDF-test')
  };
  for (const [relative, bytes] of Object.entries(files)) {
    const file = path.join(snapshot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  const manifest = Object.entries(files).map(([relative, bytes]) => (
    `${hash(bytes)}\t${bytes.length}\t${Buffer.from(relative, 'utf8').toString('base64')}`
  )).join('\n') + '\n';
  fs.writeFileSync(path.join(snapshot, 'MANIFEST.tsv'), manifest);
  fs.writeFileSync(path.join(snapshot, 'MANIFEST.tsv.sha256'), hash(Buffer.from(manifest)) + '\n');
  return { name, snapshot };
}

test('neuester eigener vollständiger Snapshot wird manifestgebunden als ZIP-Quelle gewählt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-download-test-'));
  try {
    makeSnapshot(root, { name: 'Gesamtsicherung_20260727_023000_alt', jobId: 'anderer-job' });
    const current = makeSnapshot(root);
    const selected = backupDownload.latestSnapshot({
      targetDir: root,
      jobId: 'job-a',
      targetId: '11111111-1111-4111-8111-111111111111'
    });
    assert.equal(selected.snapshotName, current.name);
    assert.equal(selected.entries.length, 7);
    assert.ok(selected.entries.every((entry) => entry.pfad.startsWith(current.name + '/')));

    const zip = path.join(root, 'download.zip');
    const result = zipSchreiben(zip, selected.entries);
    assert.equal(result.fehlend, 0);
    assert.equal(result.dateien, 7);
    assert.ok(fs.statSync(zip).size > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('zusätzliche Datei, falsche TARGET_ID und Traversal im Manifest werden abgewiesen', () => {
  const targetId = '11111111-1111-4111-8111-111111111111';
  const rootExtra = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-download-extra-'));
  const rootTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-download-target-'));
  const rootTraversal = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-download-traversal-'));
  try {
    const extra = makeSnapshot(rootExtra);
    fs.writeFileSync(path.join(extra.snapshot, 'nachtrag.txt'), 'nicht manifestiert');
    assert.throws(() => backupDownload.latestSnapshot({
      targetDir: rootExtra, jobId: 'job-a', targetId
    }), /nicht manifestierte/);

    makeSnapshot(rootTarget);
    assert.throws(() => backupDownload.latestSnapshot({
      targetDir: rootTarget,
      jobId: 'job-a',
      targetId: '22222222-2222-4222-8222-222222222222'
    }), /TARGET_ID/);

    const traversal = makeSnapshot(rootTraversal);
    const manifestPath = path.join(traversal.snapshot, 'MANIFEST.tsv');
    const badLine = `${'ab'.repeat(32)}\t1\t${Buffer.from('../ausbruch').toString('base64')}\n`;
    fs.writeFileSync(manifestPath, badLine);
    fs.writeFileSync(
      path.join(traversal.snapshot, 'MANIFEST.tsv.sha256'),
      hash(Buffer.from(badLine)) + '\n'
    );
    assert.throws(() => backupDownload.latestSnapshot({
      targetDir: rootTraversal, jobId: 'job-a', targetId
    }), /unsicheren|normalisierten/);
  } finally {
    fs.rmSync(rootExtra, { recursive: true, force: true });
    fs.rmSync(rootTarget, { recursive: true, force: true });
    fs.rmSync(rootTraversal, { recursive: true, force: true });
  }
});

test('eine nachträglich inhaltlich beschädigte Manifestdatei wird abgewiesen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-download-corrupt-'));
  try {
    const current = makeSnapshot(root);
    fs.writeFileSync(
      path.join(current.snapshot, 'daten', 'database.sqlite'),
      Buffer.from('sqlite-evil')
    );
    assert.throws(() => backupDownload.validateSnapshot({
      targetDir: root,
      snapshotName: current.name,
      jobId: 'job-a',
      targetId: '11111111-1111-4111-8111-111111111111'
    }), /Prüfsumme/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
