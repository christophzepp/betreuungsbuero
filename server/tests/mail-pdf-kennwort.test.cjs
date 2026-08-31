'use strict';
/* PDF-Kennwortschutz beim Mail-Versand (Phase 5.7, 13.08.2026):
   schuetzePdfAnlagen verschluesselt PDF-Anhaenge mit dem Standard-Security-Handler
   (AES-128/R4). Getestet: echte Verschluesselung (Encrypt-Dict, kein Klartext-Leck),
   Kennwort-Roundtrip, Ablehnung falscher/fehlender Kennwoerter, Nicht-PDF-Schutzfehler,
   Unveraendertheit ohne Kennwort. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('@cantoo/pdf-lib');
const { schuetzePdfAnlagen, kennwortMailInhalt } = require('../src/modules/mail/pdf-kennwort');

async function musterPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  page.drawText('Vertraulich: IBAN DE89 5705 1001 0000 1234 56', { x: 50, y: 800, size: 12 });
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

test('PDF-Anlage wird mit requestweitem Kennwort echt verschlüsselt', async () => {
  const anlagen = [{ filename: 'Vermoegensverzeichnis.pdf', mimeType: 'application/pdf', content: await musterPdf() }];
  await schuetzePdfAnlagen(anlagen, 'geheim-123');
  const roh = anlagen[0].content;
  assert.ok(roh.includes('/Encrypt'), 'Encrypt-Dictionary fehlt');
  assert.ok(roh.includes('/AESV2'), 'AES-Filter fehlt');
  assert.ok(!roh.includes('DE89 5705'), 'Klartext-Leck: Inhalt unverschlüsselt');
  assert.ok(!('pdfKennwort' in anlagen[0]), 'Kennwort darf nicht an der Anlage verbleiben');

  const mitKennwort = await PDFDocument.load(anlagen[0].content, { password: 'geheim-123' });
  assert.equal(mitKennwort.getPageCount(), 1);
  await assert.rejects(() => PDFDocument.load(anlagen[0].content, { password: 'falsch' }), /password|encrypted/i);
  await assert.rejects(() => PDFDocument.load(anlagen[0].content), /password|encrypted/i);
});

test('Anlagen-eigenes pdfKennwort wird ebenfalls angewendet', async () => {
  const anlagen = [{ filename: 'a.pdf', mimeType: 'application/pdf', content: await musterPdf(), pdfKennwort: 'einzeln-7' }];
  await schuetzePdfAnlagen(anlagen);
  assert.ok(anlagen[0].content.includes('/Encrypt'));
  await PDFDocument.load(anlagen[0].content, { password: 'einzeln-7' });
});

test('Nicht-PDF-Anhang bricht den geschützten Versand ab (kein stilles Leck)', async () => {
  const anlagen = [
    { filename: 'a.pdf', mimeType: 'application/pdf', content: await musterPdf() },
    { filename: 'notiz.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: Buffer.from('kein pdf') }
  ];
  await assert.rejects(() => schuetzePdfAnlagen(anlagen, 'geheim'), /nur für PDF-Anhänge/);
});

test('ohne Kennwort bleiben Anlagen byteidentisch', async () => {
  const original = await musterPdf();
  const anlagen = [{ filename: 'a.pdf', mimeType: 'application/pdf', content: Buffer.from(original) }];
  await schuetzePdfAnlagen(anlagen);
  await schuetzePdfAnlagen(anlagen, '');
  assert.ok(anlagen[0].content.equals(original), 'Anlage wurde ohne Kennwort verändert');
});

test('kaputte PDF mit Kennwortwunsch bricht ab statt unverschlüsselt zu senden', async () => {
  const anlagen = [{ filename: 'defekt.pdf', mimeType: 'application/pdf', content: Buffer.from('das ist kein pdf') }];
  await assert.rejects(() => schuetzePdfAnlagen(anlagen, 'geheim'), /fehlgeschlagen/);
});

test('die Kennwort-Mail nennt Bezug und Kennwort, aber förmlich und vollständig', () => {
  const inhalt = kennwortMailInhalt('Betreuung Mustermann – Vermögensverzeichnis', 'K7mR-p4Wn-Q9tZ-e6Hs');
  assert.match(inhalt.subject, /^Kennwort zur E-Mail „Betreuung Mustermann – Vermögensverzeichnis“$/);
  assert.ok(inhalt.body.includes('K7mR-p4Wn-Q9tZ-e6Hs'), 'Kennwort fehlt im Text');
  assert.ok(inhalt.body.includes('Betreuung Mustermann – Vermögensverzeichnis'), 'Bezug fehlt im Text');
  assert.ok(inhalt.body.includes('vertraulich'), 'Vertraulichkeitshinweis fehlt');
  const leer = kennwortMailInhalt('', 'abc');
  assert.match(leer.subject, /Dokumentversand/);
});
