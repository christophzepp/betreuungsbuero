'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const handover = require('../src/modules/cases/handover-package');
const { zipSchreiben } = require('../src/modules/backup/document-backup');

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'handover-package.json'),
  'utf8'
));

function documentsFromFixture() {
  return fixture.documents.map((document) => {
    const bytes = Buffer.from(document.content, 'utf8');
    return {
      fileId: document.fileId,
      path: document.path,
      name: path.posix.basename(document.path),
      size: bytes.length,
      sha256: handover.sha256Buffer(bytes)
    };
  });
}

test('baut alle fünf Begleitdateien mit vollständigem Prüfsummenmanifest', () => {
  const documents = documentsFromFixture();
  const artifacts = handover.buildHandoverArtifacts({
    caseLabel: fixture.caseLabel,
    generatedAt: fixture.generatedAt,
    documents,
    caseData: {
      format: 'Betreuungsbuero-Falldaten',
      schemaVersion: 1,
      case: { id: 'case-1', label: fixture.caseLabel },
      stammdaten: { person: { lastName: 'Müller', firstName: 'Jörg' } }
    }
  });

  assert.deepEqual(artifacts.files.map((file) => file.path), [
    'Falldaten.json',
    'Sicherung.json',
    'Inhaltsverzeichnis.pdf',
    'Uebergabeprotokoll.pdf',
    'Pruefsummen-SHA256.txt'
  ]);
  assert.ok(artifacts.files[2].bytes.subarray(0, 8).equals(Buffer.from('%PDF-1.4')));
  assert.ok(artifacts.files[3].bytes.subarray(0, 8).equals(Buffer.from('%PDF-1.4')));

  const manifest = artifacts.files[4].bytes.toString('utf8');
  for (const document of documents) {
    assert.match(manifest, new RegExp(`${document.sha256}\\t${document.size}\\t`));
    assert.ok(manifest.includes(document.path));
  }
  for (const generated of artifacts.files.slice(0, 4)) {
    assert.ok(manifest.includes(
      `${handover.sha256Buffer(generated.bytes)}\t${generated.bytes.length}\t${generated.path}`
    ));
  }
  assert.ok(!manifest.includes('Pruefsummen-SHA256.txt'),
    'Das Manifest darf sich wegen der zirkulären Prüfsumme nicht selbst aufführen.');

  const caseData = JSON.parse(artifacts.files[0].bytes.toString('utf8'));
  assert.equal(caseData.stammdaten.person.lastName, 'Müller');
});

test('PDFs werden bei langen Aktenlisten mehrseitig und behalten volle Hashes', () => {
  const seed = documentsFromFixture()[0];
  const documents = Array.from({ length: 95 }, (_, index) => ({
    ...seed,
    fileId: `doc-${index}`,
    path: `Fallakte/03 - Behörden & Gerichte/Amtsgericht München/2026/07/` +
      `${String(index + 1).padStart(3, '0')} ${'Sehr langer Aktenpfad '.repeat(4)}.pdf`,
    sha256: handover.sha256Buffer(Buffer.from(`Dokument ${index}`, 'utf8'))
  }));
  const contents = handover.createContentsPdf({
    caseLabel: fixture.caseLabel,
    generatedAt: fixture.generatedAt,
    documents
  });
  const protocol = handover.createProtocolPdf({
    caseLabel: fixture.caseLabel,
    generatedAt: fixture.generatedAt,
    documents,
    missing: Array.from({ length: 55 }, (_, index) => ({
      fileId: `missing-${index}`,
      path: `Fallakte/05 - Finanzen/Belege/2026/07/Fehlende Rechnung ${index + 1}.pdf`,
      reason: 'file_missing'
    }))
  });

  const contentsAscii = contents.toString('latin1');
  const protocolAscii = protocol.toString('latin1');
  const contentsCount = /\/Type \/Pages \/Count (\d+)/.exec(contentsAscii);
  const protocolCount = /\/Type \/Pages \/Count (\d+)/.exec(protocolAscii);
  assert.ok(Number(contentsCount && contentsCount[1]) >= 4);
  assert.ok(Number(protocolCount && protocolCount[1]) >= 2);
  assert.ok(contentsAscii.includes(documents[0].sha256.slice(0, 32)));
  assert.ok(contentsAscii.includes(documents[0].sha256.slice(32)));
  assert.ok(protocolAscii.includes('ACHTUNG'));
});

test('unsichere ZIP-Pfade und ungültige Prüfsummen werden abgewiesen', () => {
  assert.equal(
    handover.safeZipPath('Fallakte/02 - Kerndokumente/Müller.pdf'),
    'Fallakte/02 - Kerndokumente/Müller.pdf'
  );
  for (const unsafe of [
    '../Ausbruch.pdf',
    '/absolut.pdf',
    'Fallakte//leer.pdf',
    'C:/Windows/datei.pdf',
    'C:relative-datei.pdf',
    'Fallakte/./datei.pdf',
    'Fallakte/Zeile\nUmbruch.pdf',
    'Fallakte/Tab\tIm Namen.pdf'
  ]) {
    assert.throws(() => handover.safeZipPath(unsafe), /ZIP-Pfad/);
  }
  assert.throws(() => handover.createChecksumManifest({
    caseLabel: fixture.caseLabel,
    generatedAt: fixture.generatedAt,
    entries: [{ path: 'Falldaten.json', size: 1, sha256: '' }]
  }), /Prüfsumme fehlt/);
});

test('WinAnsi-Ausgabe erhält die deutschen Pflichtzeichen einschließlich §', () => {
  const bytes = handover._test.winAnsiBytes('Müller, Jörg · Übergabe § 1872 – „vollständig“');
  assert.ok(bytes.includes(0xFC)); // ü
  assert.ok(bytes.includes(0xF6)); // ö
  assert.ok(bytes.includes(0xDC)); // Ü
  assert.ok(bytes.includes(0xA7)); // §
  assert.ok(bytes.includes(0x96)); // Halbgeviertstrich
  assert.ok(bytes.includes(0x84)); // öffnendes deutsches Anführungszeichen
});

test('ZIP-Writer verwirft eine zwischen Hashlauf und ZIP-Lesen veränderte Quelle', () => {
  const temp = fs.mkdtempSync('/private/tmp/handover-zip-race-test-');
  const source = path.join(temp, 'Quelle.txt');
  const target = path.join(temp, 'Paket.zip');
  try {
    fs.writeFileSync(source, 'Stand beim Hashlauf');
    const expected = handover.sha256File(source);
    fs.writeFileSync(source, 'Danach verändert');
    assert.throws(
      () => zipSchreiben(target, [{
        pfad: 'Fallakte/Quelle.txt',
        quelle: source,
        sha256: expected
      }]),
      (error) => error && error.code === 'ZIP_SOURCE_CHANGED' &&
        error.path === 'Fallakte/Quelle.txt'
    );
    assert.equal(fs.existsSync(target), false, 'Eine halbe oder inkonsistente ZIP darf nicht liegen bleiben.');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('ZIP-Writer erzeugt strombasiert ein standardlesbares ZIP64-Paket', () => {
  const temp = fs.mkdtempSync('/private/tmp/handover-zip64-test-');
  const source = path.join(temp, 'Quelle.bin');
  const target = path.join(temp, 'Paket.zip');
  try {
    const block = Buffer.alloc(1024 * 1024, 0x5A);
    const descriptor = fs.openSync(source, 'wx');
    try {
      for (let index = 0; index < 8; index++) fs.writeSync(descriptor, block);
    } finally {
      fs.closeSync(descriptor);
    }
    const expected = handover.sha256File(source);
    const result = zipSchreiben(target, [{
      pfad: 'Fallakte/11 - Betreuungsführung/Prüfdatei.bin',
      quelle: source,
      sha256: expected
    }], { forceZip64: true });
    assert.equal(result.dateien, 1);
    assert.equal(result.fehlend, 0);
    const archive = fs.readFileSync(target);
    assert.notEqual(archive.indexOf(Buffer.from([0x50, 0x4B, 0x06, 0x06])), -1,
      'ZIP64-Endsatz fehlt');
    assert.notEqual(archive.indexOf(Buffer.from([0x50, 0x4B, 0x06, 0x07])), -1,
      'ZIP64-Locator fehlt');
    const checked = childProcess.spawnSync('/usr/bin/unzip', ['-t', target], {
      encoding: 'utf8'
    });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
