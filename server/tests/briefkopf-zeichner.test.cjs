'use strict';

/* Pruefstand fuer den Briefkopf-Editor, Paket P3 (06.09.2026): Zeichner und Schriften.
     - „Standard = heute“: der Block unified-document-print-layout-v230 wird aus der Auslieferung
       geschnitten und mit einer Fake-page ausgefuehrt, die drawText/drawRectangle/drawLine samt
       Koordinaten protokolliert. Mit der Standardkarte muessen EXAKT die heutigen Literale
       entstehen (Name 11,5 pt fett CI y=800, Funktionszeile 8,5 pt grau y=788, Kontakt 7,3 pt ab
       802 im Abstand 10,5, Band x=78 y=743 439x22 mit Buero 11,5 pt weiss y=750, Folgeseite Band
       y=806 h=13 Text 7,5 pt y=809,5, Infoblock 578/565, Absenderzeile 7,6 pt y=724 Linie 721,
       Fusszeile 7,2 pt 58/45/32/19, Berichtsdruck Band y=749 h=24 Text 12,5 pt y=756,5 Titel 722),
       Rueckgabe 724/782/722.
     - Kompatibilitaet: Bueroname = Person (kein eigener Name) -> Funktionszeile fett 9,5 pt y=798.
     - Geaenderte Karte: Linie statt Band, Falz-/Lochmarken, Kursiv ueber den Oblique-Schnitt,
       Unterstreichung als drawLine, Seitenzahl der Folgeseite.
     - Schriften: zwei neue Bloecke tpl_font_dejavu_oblique/_bold_oblique; unifiedDocumentFonts
       liefert italic/boldItalic (nur bei Bedarf, Helvetica-Oblique als Rueckfall).
     - Verdrahtung: Absenderzeile und Fusszeile laufen ueberall ueber die neuen Funktionen,
       HTML-Koepfe (buildLetterheadHTML, renderReportHeader) nutzen dieselbe Karte. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

function block(id) {
  const lines = html.split('\n');
  const a = lines.findIndex(l => l.includes(`<script id="${id}">`));
  assert.ok(a > 0, id + ' fehlt');
  const b = lines.findIndex((l, i) => i > a && l.trim() === '</' + 'script>');
  return lines.slice(a + 1, b).join('\n');
}

/* ── Fake-pdf-lib: Farben als Zahlen, Schriften mit deterministischer Breite, Seiten protokollieren ── */
function fakeFont(name) {
  return { name, widthOfTextAtSize: (t, size) => Math.round(String(t).length * size * 0.5 * 100) / 100 };
}
function fakePage(log) {
  const norm = o => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === 'object' && v.widthOfTextAtSize) ? v.name : v));
  return {
    drawText: (t, o) => log.push({ op: 'text', text: String(t), ...norm(o) }),
    drawRectangle: o => log.push({ op: 'rect', ...norm(o) }),
    drawLine: o => log.push({ op: 'line', ...norm(o) }),
    drawImage: (img, o) => log.push({ op: 'image', ...norm(o) })
  };
}
const RGB = (r, g, b) => ({ type: 'RGB', red: r, green: g, blue: b });
const BLAU = RGB(31 / 255, 78 / 255, 120 / 255), GRAU = RGB(89 / 255, 99 / 255, 107 / 255), WEISS = RGB(1, 1, 1), TINTE = RGB(.05, .07, .09);
const FONTS = () => ({ regular: fakeFont('R'), bold: fakeFont('B'), italic: fakeFont('I'), boldItalic: fakeFont('BI'), unicode: true, italicUnicode: true });
const OFFICE = { name: 'Betreuungsbüro Zepp', degree: 'B.A.', address: 'Marktplatz 8, 56346 St. Goarshausen', phone: '0151/29818142', email: 'betreuungen.zepp@outlook.de', bank: 'Sparkasse Rhein-Lahn', iban: 'DE12 3456 7890 1234 5678 90', bic: 'MALADE51EMS', tax: '12/345/67890', city: 'St. Goarshausen' };

function sandbox(office, caregiver) {
  const sb = { console, setTimeout, clearTimeout, Promise, JSON, Math };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.document = { addEventListener() {}, getElementById() { return null; } };
  sb.CustomEvent = function (t, i) { this.type = t; this.detail = i && i.detail; };
  sb.addEventListener = () => {}; sb.dispatchEvent = () => {};
  sb.PDFLib = {
    rgb: RGB,
    StandardFonts: { Helvetica: 'Helvetica', HelveticaBold: 'Helvetica-Bold', HelveticaOblique: 'Helvetica-Oblique', HelveticaBoldOblique: 'Helvetica-BoldOblique' },
    PDFDocument: { create: async () => { const pages = []; const pdf = { pages, addPage() { const log = []; const p = fakePage(log); p.__log = log; pages.push(p); return p; }, getPages() { return pages; }, embedFont: async n => fakeFont(typeof n === 'string' ? n : 'CUSTOM'), registerFontkit() {}, save: async () => new Uint8Array([37, 80, 68, 70]) }; sb.__pdf = pdf; return pdf; } }
  };
  sb.OFFICE = Object.assign({}, office);
  sb.officeNameWithDegree = () => sb.OFFICE.name + (sb.OFFICE.degree ? ` (${sb.OFFICE.degree})` : '');
  sb.state = { caseData: { person: { firstName: 'Max', lastName: 'Mustermann', birthDate: '1954-03-12' }, care: { fileNumber: 'XVII 123/24', courtName: 'Amtsgericht Musterstadt' } }, reports: {} };
  sb.fullName = () => 'Max Mustermann';
  sb.isEmpty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  sb.normalizePdfDate = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(v || ''); };
  sb.fmtDEDate = v => sb.normalizePdfDate(v);
  sb.todayDE = () => '06.09.2026';
  sb.phase3Value = (data, id) => data?.fields?.[id]?.value ?? '';
  sb.pdfSafeText = v => String(v ?? '');
  sb.__pdfSafeTextOriginal = v => String(v ?? '').replace(/[^\x20-\x7E\xA0-\xFF€\n]/g, '?');
  sb.getDocumentOptions = () => ({ signatureId: 'none', ownSignature: false, foreignSignatures: 0 });
  sb.phase3EmbedSignature = async () => null;
  sb.docSignatureDataUrl = () => '';
  sb.isWideField = () => false;
  sb.externalSignatureEnabled = () => false;
  sb.__sigStore = caregiver ? { caregiverCached: () => ({ caregiver: { name: caregiver } }) } : undefined;
  sb.__docPlaceDate = () => ({ place: 'Musterstadt', dateDE: '06.09.2026', text: 'Musterstadt, 06.09.2026' });
  sb.OFFICIAL_PDF_TEMPLATES = {}; sb.OFFICIAL_STRUCTURED_TABLES = {};
  sb.REPORTS = [{ id: 'annual_report', title: 'Jahresbericht' }];
  sb.SCHEMAS = { annual_report: { sections: [{ title: 'Allgemeines', fields: [{ id: 'f1', label: 'Wohnsituation', type: 'textarea' }] }] } };
  sb.phase3ComponentBytes = async () => { throw new Error('nicht im Pruefstand'); };
  sb.embeddedPdfBytes = async () => null;
  vm.createContext(sb);
  vm.runInContext(block('unified-document-print-layout-v230'), sb, { filename: 'v230.js' });
  return sb;
}
const T = (text, x, y, size, font, color) => ({ op: 'text', text, x, y, size, font, color });

/* ═══════════════════ 1. Standard = heute (Fake-page, exakte Literale) ═══════════════════ */

test('Erstseiten-Kopf der Standardkarte zeichnet exakt die heutigen Literale und gibt 724 zurueck', () => {
  const S = sandbox(OFFICE, 'Christoph Zepp');
  assert.equal(S.__briefkopfEffektiv().gepflegt, false);
  const log = [];
  const y = S.__unifiedLetterHead(fakePage(log), FONTS());
  assert.equal(y, 724);
  const w = (t, s) => fakeFont('x').widthOfTextAtSize(t, s);
  assert.deepEqual(log, [
    T('Christoph Zepp', 78, 800, 11.5, 'B', BLAU),
    T('Rechtliche Betreuungen', 78, 788, 8.5, 'R', GRAU),
    T(OFFICE.address, 517 - w(OFFICE.address, 7.3), 802, 7.3, 'R', GRAU),
    T('Tel. ' + OFFICE.phone, 517 - w('Tel. ' + OFFICE.phone, 7.3), 791.5, 7.3, 'R', GRAU),
    T(OFFICE.email, 517 - w(OFFICE.email, 7.3), 781, 7.3, 'R', GRAU),
    { op: 'rect', x: 78, y: 743, width: 439, height: 22, color: BLAU },
    T(OFFICE.name, 517 - 11 - w(OFFICE.name, 11.5), 750, 11.5, 'B', WEISS)
  ]);
});

test('Kompatibilitaet: Bueroname = Person -> Funktionszeile fett 9,5 pt bei y=798 (wie heute)', () => {
  const S = sandbox({ name: 'Max Mustermensch', degree: '', address: 'Musterstraße 1, 12345 Musterstadt', phone: '01234/5', email: 'm@x.de', bank: 'b', iban: 'i', bic: 'c', tax: 't' }, '');
  const log = [];
  assert.equal(S.__unifiedLetterHead(fakePage(log), FONTS()), 724);
  assert.deepEqual(log[0], T('Rechtliche Betreuungen', 78, 798, 9.5, 'B', BLAU));
  assert.equal(log.filter(e => e.text === 'Max Mustermensch').length, 1, 'der Name steht nur im Band');
  /* Gepflegte Karte: keine Kompatibilitaetsregel, WYSIWYG */
  const karte = S.__briefkopfStandardKarte();
  const log2 = [];
  S.__unifiedLetterHead(fakePage(log2), FONTS(), { karte });
  assert.deepEqual(log2[0], T('Max Mustermensch', 78, 800, 11.5, 'B', BLAU));
});

test('Firmenname in den Buerostammdaten: Standardkarte druckt wie heute (OFFICE.name), gepflegte Karte und Vorschau nutzen den Firmennamen', () => {
  /* Behebung 06.09. (Pruefer-Blocker, Vertrag 8): online ist OFFICE.name immer die Ansprechpartner:in
     (applyOfficeBranding); der Firmenname stand nie im Band. Ohne gepflegte Karte muss das so bleiben -
     inklusive Kompatibilitaetsregel (Person = Band -> Funktionszeile fett 9,5 pt bei 798). */
  const solo = { name: 'Christoph Zepp', degree: '', address: 'Marktplatz 8, 56346 St. Goarshausen', phone: '', email: 'x@y.de', bank: '', iban: '', bic: '', tax: '' };
  const S = sandbox(solo, 'Christoph Zepp');
  S.officeProfile = { companyName: 'Betreuungsbüro Zepp', contactName: 'Christoph Zepp', formattedAddress: solo.address, email: 'x@y.de' };
  assert.equal(S.__briefkopfWert('BÜRO'), 'Christoph Zepp', 'Standard: OFFICE.name');
  const w = (t, s) => fakeFont('x').widthOfTextAtSize(t, s);
  let log = [];
  assert.equal(S.__unifiedLetterHead(fakePage(log), FONTS()), 724);
  assert.deepEqual(log, [
    T('Rechtliche Betreuungen', 78, 798, 9.5, 'B', BLAU),
    T(solo.address, 517 - w(solo.address, 7.3), 802, 7.3, 'R', GRAU),
    T('x@y.de', 517 - w('x@y.de', 7.3), 791.5, 7.3, 'R', GRAU),
    { op: 'rect', x: 78, y: 743, width: 439, height: 22, color: BLAU },
    T('Christoph Zepp', 517 - 11 - w('Christoph Zepp', 11.5), 750, 11.5, 'B', WEISS)
  ]);
  log = [];
  S.__unifiedLetterHead(fakePage(log), FONTS(), { folgeseite: true });
  assert.equal(log[1].text, 'Christoph Zepp', 'Folgeseite wie heute');
  log = [];
  S.__unifiedLetterSenderLine(fakePage(log), FONTS(), 724, {});
  assert.equal(log[0].text, 'Christoph Zepp, ' + solo.address, 'Absenderzeile wie heute');
  /* gepflegte Karte (WYSIWYG, Mockup: BUERO = Firmenname) */
  const karte = S.__briefkopfStandardKarte();
  log = [];
  S.__unifiedLetterHead(fakePage(log), FONTS(), { karte });
  assert.deepEqual(log[0], T('Christoph Zepp', 78, 800, 11.5, 'B', BLAU), 'keine Kompatibilitaetsregel');
  assert.equal(log[log.length - 1].text, 'Betreuungsbüro Zepp', 'Band = Firmenname');
  assert.equal(S.__briefkopfWert('BÜRO', { karte }), 'Betreuungsbüro Zepp', 'uebergebene Karte ohne Flag = gepflegt');
  /* der Editor traegt den Stand „Standard gilt“ als gepflegt:false - dann wie heute */
  karte.gepflegt = false;
  assert.equal(S.__briefkopfWert('BÜRO', { karte }), 'Christoph Zepp');
  log = [];
  S.__unifiedLetterHead(fakePage(log), FONTS(), { karte });
  assert.deepEqual(log[0], T('Rechtliche Betreuungen', 78, 798, 9.5, 'B', BLAU));
  S.__briefkopfVorschauSetzen(karte, {});
  assert.equal(S.__briefkopfEffektiv().gepflegt, false, 'Vorschau uebernimmt das Flag');
  assert.equal(S.__briefkopfWert('BÜRO'), 'Christoph Zepp');
  delete karte.gepflegt;
  S.__briefkopfVorschauSetzen(karte, {});
  assert.equal(S.__briefkopfEffektiv().gepflegt, true, 'ohne Flag = gepflegt');
  assert.equal(S.__briefkopfWert('BÜRO'), 'Betreuungsbüro Zepp');
  S.__briefkopfVorschauSetzen(null);
  assert.equal(S.__briefkopfWert('BÜRO'), 'Christoph Zepp');
});

test('Folgeseiten-Kopf: Band 806..819, Bueroname 7,5 pt fett weiss y=809,5, Rueckgabe 782; Seitenzahl nur mit SEITE/SEITEN', () => {
  const S = sandbox(OFFICE, 'Christoph Zepp');
  const log = [];
  assert.equal(S.__unifiedLetterHead(fakePage(log), FONTS(), { folgeseite: true }), 782);
  const w = fakeFont('x').widthOfTextAtSize(OFFICE.name, 7.5);
  assert.deepEqual(log, [
    { op: 'rect', x: 78, y: 806, width: 439, height: 13, color: BLAU },
    T(OFFICE.name, 517 - 8 - w, 809.5, 7.5, 'B', WEISS)
  ]);
  const log2 = [];
  const y2 = S.__unifiedLetterHead(fakePage(log2), FONTS(), { folgeseite: true, seite: 2, seiten: 3 });
  assert.deepEqual(log2[2], T('Seite 2 von 3', 78, 796, 7.5, 'R', GRAU));
  assert.equal(y2, 770, 'Inhalt beginnt unter der Seitenzahl');
});

test('Infoblock: Ihr Zeichen 9,3 pt bei 578, Ort/Datum 10 pt fett bei 565, Rueckgabe 552; Sonderfaelle wie heute', () => {
  const S = sandbox(OFFICE, 'Christoph Zepp');
  const w = (t, s) => fakeFont('x').widthOfTextAtSize(t, s);
  let log = [];
  assert.equal(S.__unifiedLetterInfoBlock(fakePage(log), FONTS(), { fremdesZeichen: '7 XVII 214/19', ortDatum: 'Musterstadt, 06.09.2026' }), 552);
  assert.deepEqual(log, [
    T('Ihr Zeichen: 7 XVII 214/19', 517 - w('Ihr Zeichen: 7 XVII 214/19', 9.3), 578, 9.3, 'R', TINTE),
    T('Musterstadt, 06.09.2026', 517 - w('Musterstadt, 06.09.2026', 10), 565, 10, 'B', TINTE)
  ]);
  log = [];
  assert.equal(S.__unifiedLetterInfoBlock(fakePage(log), FONTS(), { ortDatum: '06.09.2026' }), 552, 'cover(): nur Datum');
  assert.deepEqual(log, [T('06.09.2026', 517 - w('06.09.2026', 10), 565, 10, 'B', TINTE)]);
  log = [];
  assert.equal(S.__unifiedLetterInfoBlock(fakePage(log), FONTS(), { fremdesZeichen: '', ortDatum: '' }), 565, 'ohne Angaben keine Zeile');
  assert.deepEqual(log, []);
  /* Behebung 06.09.: nur „Ihr Zeichen“ ohne Ort/Datum lag frueher bei 578 (Rueckgabe 565) - Standardkarte wie heute,
     gepflegte Karte von unten verankert (565) */
  log = [];
  assert.equal(S.__unifiedLetterInfoBlock(fakePage(log), FONTS(), { fremdesZeichen: 'A 1', ortDatum: '' }), 565);
  assert.deepEqual(log, [T('Ihr Zeichen: A 1', 517 - w('Ihr Zeichen: A 1', 9.3), 578, 9.3, 'R', TINTE)]);
  log = [];
  assert.equal(S.__unifiedLetterInfoBlock(fakePage(log), FONTS(), { fremdesZeichen: 'A 1', ortDatum: '', karte: S.__briefkopfStandardKarte() }), 552);
  assert.equal(log[0].y, 565);
});

test('Absenderzeile: 7,6 pt bei x=80 auf der Kopf-Grundlinie, Linie 3 pt darunter bis max. 517, Tinte des Aufrufers', () => {
  const S = sandbox(OFFICE, 'Christoph Zepp');
  const log = [];
  const ink = RGB(.08, .11, .14);
  S.__unifiedLetterSenderLine(fakePage(log), FONTS(), 724, { tinte: ink });
  const text = OFFICE.name + ', ' + OFFICE.address;
  const w = fakeFont('x').widthOfTextAtSize(text, 7.6);
  assert.deepEqual(log, [
    T(text, 80, 724, 7.6, 'R', ink),
    { op: 'line', start: { x: 80, y: 721 }, end: { x: Math.min(517, 80 + w + 3), y: 721 }, thickness: .45, color: ink }
  ]);
  const karte = S.__briefkopfStandardKarte(); karte.absender.linie = false;
  const log2 = [];
  S.__unifiedLetterSenderLine(fakePage(log2), FONTS(), 724, { karte });
  assert.equal(log2.length, 1, 'ohne Linie nur der Text');
});

test('Fusszeile: vier Zeilen 7,2 pt CI bei 58/45/32/19 mit den heutigen Texten; leere Abschnitte fallen weg', () => {
  const S = sandbox(OFFICE, 'Christoph Zepp');
  const log = [];
  S.__unifiedLetterFooter(fakePage(log), FONTS(), {});
  assert.deepEqual(log, [
    T('Betreuungsbüro Zepp (B.A.)', 78, 58, 7.2, 'R', BLAU),
    T(`${OFFICE.address} | ${OFFICE.phone} | ${OFFICE.email}`, 78, 45, 7.2, 'R', BLAU),
    T(`${OFFICE.bank} | IBAN: ${OFFICE.iban} | BIC: ${OFFICE.bic}`, 78, 32, 7.2, 'R', BLAU),
    T(`USt.-Nr.: ${OFFICE.tax}`, 78, 19, 7.2, 'R', BLAU)
  ]);
  const S2 = sandbox(Object.assign({}, OFFICE, { phone: '', bank: '', iban: '', bic: '', tax: '' }), 'Christoph Zepp');
  const log2 = [];
  S2.__unifiedLetterFooter(fakePage(log2), FONTS(), {});
  assert.deepEqual(log2.map(e => e.text), ['Betreuungsbüro Zepp (B.A.)', `${OFFICE.address} | ${OFFICE.email}`]);
});

test('Berichtsdruck: Kopf aus der Karte im Raster 48..547,28 - Band y=749 h=24, Text 12,5 pt y=756,5, Titel bei 722', async () => {
  const S = sandbox(OFFICE, 'Christoph Zepp');
  await S.createUnifiedDocumentPrintPdf('annual_report', { fields: { f1: { value: 'Text' } } }, 'Jahresbericht');
  const log = S.__pdf.pages[0].__log;
  const muted = RGB(86 / 255, 101 / 255, 113 / 255), white = RGB(1, 1, 1);
  const w = (t, s) => fakeFont('x').widthOfTextAtSize(t, s);
  assert.deepEqual(log.slice(0, 8), [
    T('Christoph Zepp', 48, 800, 11.5, 'Helvetica-Bold', BLAU),
    T('Rechtliche Betreuungen', 48, 788, 8.5, 'Helvetica', muted),
    T(OFFICE.address, 547.28 - w(OFFICE.address, 7.3), 802, 7.3, 'Helvetica', muted),
    T('Tel. ' + OFFICE.phone, 547.28 - w('Tel. ' + OFFICE.phone, 7.3), 791.5, 7.3, 'Helvetica', muted),
    T(OFFICE.email, 547.28 - w(OFFICE.email, 7.3), 781, 7.3, 'Helvetica', muted),
    { op: 'rect', x: 48, y: 749, width: 499.28, height: 24, color: BLAU },
    T(OFFICE.name, 547.28 - 12 - w(OFFICE.name, 12.5), 756.5, 12.5, 'Helvetica-Bold', white),
    T('Jahresbericht', 48, 722, 17, 'Helvetica-Bold', BLAU)
  ]);
});

/* ═══════════════════ 2. Geaenderte Karte: neue Bausteine ═══════════════════ */

test('geaenderte Karte: Linie, Falz-/Lochmarken, Kursiv (Oblique), Unterstreichung, Bandtext links, Kopf rechts zentriert', () => {
  const S = sandbox(OFFICE, 'Christoph Zepp');
  const karte = S.__briefkopfAusgangspunkte.linie();
  karte.kopfLinks.zeilen[1].t = '*Rechtliche* __Betreuungen__';
  karte.kopfRechts.align = 'center';
  karte.falz = { an: true, loch: true };
  karte.band.text = 'BÜRO';
  karte.band.align = 'left';
  const log = [];
  const y = S.__unifiedLetterHead(fakePage(log), FONTS(), { karte });
  assert.equal(y, 724, 'die Zone der Linie ist so hoch wie das Band');
  const falz = log.filter(e => e.op === 'line' && e.thickness === .6);
  assert.equal(falz.length, 3, 'zwei Falzmarken und eine Lochmarke');
  assert.deepEqual(falz.map(e => [e.start.x, e.end.x, Math.round(e.start.y * 100) / 100]), [[0, 14, 544.26], [0, 14, 246.62], [0, 10, 420.95]]);
  const kursiv = log.find(e => e.op === 'text' && e.font === 'I');
  assert.deepEqual([kursiv.text, kursiv.x, kursiv.y, kursiv.size], ['Rechtliche', 78, 788, 8.5]);
  const unter = log.find(e => e.op === 'line' && e.thickness === .5);
  assert.ok(unter && unter.start.y === 786.5 && unter.start.x > 78, 'Unterstreichung 1,5 pt unter der Grundlinie hinter dem kursiven Run');
  const linie = log.find(e => e.op === 'line' && e.thickness === 1.2);
  assert.deepEqual([linie.start.x, linie.end.x, linie.start.y], [78, 517, 754]);
  const bandText = log.find(e => e.text === OFFICE.name && e.size === 12 - .5);
  assert.deepEqual([bandText.x, bandText.y, bandText.font], [78, 769, 'B'], 'Bandtext links ueber der Linie');
  const zentriert = log.find(e => e.text === OFFICE.address);
  assert.equal(zentriert.x, (517 - 184 / 2) - fakeFont('x').widthOfTextAtSize(OFFICE.address, 7.3) / 2, 'Kopf rechts zentriert um die Zonenmitte');
  assert.equal(S.__briefkopfBrauchtKursiv(karte), true);
  assert.equal(S.__briefkopfBrauchtKursiv(S.__briefkopfStandardKarte()), false);
});

test('Editor-Vorschau: __briefkopfVorschauSetzen lenkt die Zeichner auf die ungespeicherte Karte', () => {
  const S = sandbox(OFFICE, 'Christoph Zepp');
  const karte = S.__briefkopfAusgangspunkte.schlicht();
  S.__briefkopfVorschauSetzen(karte, {});
  const log = [];
  S.__unifiedLetterHead(fakePage(log), FONTS());
  assert.equal(log.some(e => e.op === 'rect'), false, 'Schlicht hat kein Band');
  assert.equal(log.find(e => e.op === 'text').text, OFFICE.name, 'Schlicht: erste Zeile BUERO (davor die Falzmarken)');
  assert.equal(log.filter(e => e.op === 'line' && e.thickness === .6).length, 3, 'Schlicht: Falz- und Lochmarken');
  S.__briefkopfVorschauSetzen(null);
  const log2 = [];
  S.__unifiedLetterHead(fakePage(log2), FONTS());
  assert.equal(log2.some(e => e.op === 'rect'), true, 'danach gilt wieder die Standardkarte');
});

/* ═══════════════════ 3. HTML-Koepfe aus derselben Karte ═══════════════════ */

test('HTML-Koepfe: Druckansicht und Bildschirmkopf entstehen aus der Karte (CI-Farbe, Runs als b/i/u)', () => {
  const S = sandbox(OFFICE, 'Christoph Zepp');
  const kopf = S.__briefkopfKopfHTML({});
  assert.match(kopf, /class="export-bk-links"><div class="export-bk-zl" style="--bkf:#1f4e78;font-size:11\.5pt"><b>Christoph Zepp<\/b><\/div>/);
  assert.match(kopf, /class="export-bk-band" style="--bkb:#1f4e78;--bkf:#ffffff;height:22pt;font-size:11\.5pt;justify-content:flex-end">Betreuungsbüro Zepp<\/div>/);
  assert.equal(S.__briefkopfSenderLineHTML({}), 'Betreuungsbüro Zepp, Marktplatz 8, 56346 St. Goarshausen');
  assert.match(S.__briefkopfInfoHTML({}), /<b>Musterstadt, 06\.09\.2026<\/b>/);
  assert.match(S.__briefkopfFussHTML({}), /USt\.-Nr\.: 12\/345\/67890/);
  const box = S.__briefkopfReportBoxHTML({ fileNumber: 'XVII 123/24' }, { birthDate: '12.03.1954' });
  assert.match(box, /<div class="office-box"><div class="box bk-kopf-box">/);
  assert.match(box, /<div class="bk-kopf-band" style="--bkb:#1f4e78;--bkf:#ffffff;text-align:right">Betreuungsbüro Zepp<\/div>/);
  assert.match(box, /<strong>Az\.:<\/strong> XVII 123\/24<br><strong>Betreuung:<\/strong> Max Mustermann<br><strong>geb\.:<\/strong> 12\.03\.1954/);
  /* Sonderzeichen werden maskiert */
  const k = S.__briefkopfStandardKarte(); k.kopfLinks.zeilen[0].t = '<b>&';
  S.__briefkopfVorschauSetzen(k, {});
  assert.match(S.__briefkopfKopfHTML({}), /&lt;b&gt;&amp;/);
});

/* ═══════════════════ 4. Schriften und Verdrahtung in der Auslieferung ═══════════════════ */

test('Schriftbloecke: DejaVu Sans Oblique und Bold-Oblique liegen als pdf-base64-Bloecke hinter dem Bold-Block', () => {
  const lines = html.split('\n');
  const i = lines.findIndex(l => l.startsWith('<script id="tpl_font_dejavu_bold" type="application/pdf-base64">'));
  assert.ok(i > 0);
  assert.ok(lines[i + 1].startsWith('<script id="tpl_font_dejavu_oblique" type="application/pdf-base64">') && lines[i + 1].length > 800000, 'Oblique-Block fehlt oder ist leer');
  assert.ok(lines[i + 2].startsWith('<script id="tpl_font_dejavu_bold_oblique" type="application/pdf-base64">') && lines[i + 2].length > 800000, 'Bold-Oblique-Block fehlt oder ist leer');
  /* Block-Inhalt ist eine TrueType-Datei (Base64 von 00 01 00 00 = "AAEAAA") */
  assert.ok(lines[i + 1].includes('>AAEAAA') && lines[i + 2].includes('>AAEAAA'), 'kein TrueType-Kopf');
  assert.match(html, /async function unifiedDocumentFonts\(pdf,optionen\)/);
  assert.match(html, /bkFontBlock\('tpl_font_dejavu_oblique'\),bkFontBlock\('tpl_font_dejavu_bold_oblique'\)/);
  assert.match(html, /PDFLib\.StandardFonts\.HelveticaOblique/);
  assert.match(html, /PDFLib\.StandardFonts\.HelveticaBoldOblique/);
  assert.match(html, /Eigene Schrift nicht verfügbar – Helvetica-Fallback/, 'Rueckfall-Warnhinweis bleibt');
});

test('unifiedDocumentFonts (ausgefuehrt): Kursivschnitte nur bei Bedarf, Rueckfall Helvetica-Oblique', async () => {
  const S = sandbox(OFFICE, 'Christoph Zepp');
  const pdf = await S.PDFLib.PDFDocument.create();
  const std = await S.__unifiedDocumentFonts(pdf);
  assert.equal(std.italic, undefined, 'Standardkarte braucht keinen Kursivschnitt');
  const k = S.__briefkopfStandardKarte(); k.kopfLinks.zeilen[1].t = '*kursiv*';
  S.__briefkopfVorschauSetzen(k, {});
  const kursiv = await S.__unifiedDocumentFonts(pdf);
  assert.equal(kursiv.italic.name, 'Helvetica-Oblique', 'ohne fontkit: Helvetica-Oblique');
  assert.equal(kursiv.boldItalic.name, 'Helvetica-BoldOblique');
  assert.equal(kursiv.italicUnicode, false);
  const erzwungen = await S.__unifiedDocumentFonts(pdf, { kursiv: true });
  assert.ok(erzwungen.italic, 'optionen.kursiv erzwingt die Schnitte');
});

test('Verdrahtung: Absenderzeile und Fusszeile laufen ueberall ueber die neuen Funktionen, keine Literal-Kopien mehr', () => {
  assert.match(html, /function unifiedLetterSenderLine\(page,fonts,y,optionen\)/);
  assert.match(html, /function unifiedLetterFooter\(page,fonts,optionen\)/);
  assert.match(html, /window\.__unifiedLetterSenderLine=unifiedLetterSenderLine/);
  assert.match(html, /window\.__unifiedLetterFooter=unifiedLetterFooter/);
  const sender = html.match(/window\.__unifiedLetterSenderLine\(/g) || [];
  assert.ok(sender.length >= 5, 'Anschreiben, Freidokument, v159, Betreuungsantrag, Betreuerwechsel (gefunden: ' + sender.length + ')');
  assert.match(html, /W\.__unifiedLetterSenderLine\(page,fonts,y,\{karte,kontext:kontextPdf\}\)/, 'Musterbrief des Editors');
  const fuss = html.match(/window\.__unifiedLetterFooter\(/g) || [];
  assert.ok(fuss.length >= 3, 'phase3DrawLetterFooter, createRichPdf, v159 (gefunden: ' + fuss.length + ')');
  assert.match(html, /W\.__unifiedLetterFooter\(page,fonts,\{karte,kontext:kontextPdf\}\)/, 'Musterbrief des Editors');
  assert.match(html, /function phase3DrawLetterFooter\(page,reg,blue,muted,fonts\)/);
  assert.equal((html.match(/const footer3=`\$\{OFFICE\.bank\} \| IBAN: \$\{OFFICE\.iban\} \| BIC: \$\{OFFICE\.bic\}`/g) || []).length, 0, 'alte Fusszeilen-Literale');
  assert.equal((html.match(/\{x:80,y:721\},end:\{x:senderLineEnd,y:721\}/g) || []).length, 0, 'alte Absenderzeilen-Literale');
  assert.match(html, /phase3DrawLetterFooter\(page,reg,blue,muted,__fonts\)/);
  assert.equal((html.match(/phase3DrawLetterFooter\(page,regular,blue,muted,__fonts\)/g) || []).length, 2, 'beide Betreuerbriefe reichen den Schriftsatz');
  assert.match(html, /y=unifiedLetterHead\(page,fonts,\{bericht:true,reportId,palette:\{ci:blue,grau:muted,weiss:white,schwarz:ink\}\}\)/);
  /* HTML-Koepfe */
  assert.match(html, /function bkSenderLineHTML\(\)/);
  assert.match(html, /function bkReportBoxHTML\(c,p\)/);
  assert.equal((html.match(/<div class="sender-line">\$\{bkSenderLineHTML\(\)\}<\/div>/g) || []).length, 4, 'Basiskopf und drei Empfaenger-Wrapper');
  assert.equal((html.match(/\$\{bkReportBoxHTML\((c|care),p\)\}/g) || []).length, 4);
  assert.match(html, /window\.__briefkopfKopfHTML\(bkK\)/);
  assert.match(html, /\.export-letterhead-header\{\n  color:var\(--bk-ci,#1f4e78\);/, 'Tuerkis ist durch die CI-Farbe ersetzt');
  assert.equal((html.match(/#2aa1b8/g) || []).length, 0, 'kein Tuerkis mehr');
  /* Standardkarte: Fusszeile 1 ohne Fett (heute Regular) */
  assert.match(html, /fuss:\{an:true,konto:0,zeilen:\[\{t:'INHABER \(TITEL\)',size:7\.2,color:'ci',an:true\}/);
});
