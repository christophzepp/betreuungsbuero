const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const outputDir = process.argv[2];
if (!outputDir) throw new Error('Ausgabeverzeichnis fehlt.');
fs.mkdirSync(outputDir, { recursive: true });

const blue = rgb(31 / 255, 78 / 255, 120 / 255);
const ink = rgb(0.08, 0.11, 0.14);
const muted = rgb(0.34, 0.4, 0.45);
const fieldFill = rgb(247 / 255, 249 / 255, 251 / 255);
const fieldBorder = rgb(205 / 255, 216 / 255, 225 / 255);
const values = {
  court: 'Amtsgericht Simmern/Hunsrück',
  courtAddress: 'Schulstraße 5\n55469 Simmern/Hunsrück',
  fileNumber: '10 XVII 121/16',
  personName: 'Franz Josef Bastuck',
  birthDate: '01.01.1990',
  personAddress: 'Hauptstraße 12, 69999 Bad Bocklet',
  known: 'ja',
  consent: 'ja',
  additional: 'Die Übernahme soll zum nächstmöglichen Zeitpunkt erfolgen.'
};

function wrap(text, font, size, width) {
  const lines = [];
  for (const sourceLine of String(text || '').split(/\r?\n/)) {
    const words = sourceLine.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

async function makePrint() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 792;
  page.drawText('Betreuungsantrag Betreuer', { x: 50, y, size: 19, font: bold, color: blue });
  y -= 30;
  page.drawText('Betreuung: Franz Josef Bastuck · Az. 10 XVII 121/16', { x: 50, y, size: 10, font: regular, color: muted });
  y -= 30;
  page.drawRectangle({ x: 46, y: y - 5, width: 503, height: 28, color: blue });
  page.drawText('Betreuungssache und Übernahmebereitschaft', { x: 55, y: y + 4, size: 11, font: bold, color: rgb(1, 1, 1) });
  y -= 24;
  function field(label, value, x, top, width, height) {
    page.drawRectangle({ x, y: top - height, width, height, color: fieldFill, borderColor: fieldBorder, borderWidth: .65 });
    page.drawText(label, { x: x + 11, y: top - 17, size: 9.3, font: bold, color: muted });
    let yy = top - 36;
    for (const line of wrap(value, regular, 11.2, width - 24)) { page.drawText(line, { x: x + 11, y: yy, size: 11.2, font: regular, color: ink }); yy -= 15; }
  }
  function pair(left, right) {
    const gap = 12, width = (499 - gap) / 2;
    const height = Math.max(58, 45 + Math.max(wrap(left[1], regular, 11.2, width - 24).length, wrap(right[1], regular, 11.2, width - 24).length) * 15);
    field(left[0], left[1], 48, y, width, height); field(right[0], right[1], 48 + width + gap, y, width, height);
    y -= height + 9;
  }
  function wide(label, value) {
    const height = Math.max(62, 45 + wrap(value, regular, 11.2, 475).length * 15);
    field(label, value, 48, y, 499, height); y -= height + 9;
  }
  pair(['Betreuungsgericht', values.court], ['Aktenzeichen', values.fileNumber]);
  wide('Anschrift des Betreuungsgerichts', values.courtAddress);
  pair(['Betreute Person', values.personName], ['Geburtsdatum', values.birthDate]);
  wide('Anschrift der betreuten Person', values.personAddress);
  pair(['Die Person ist mir bekannt', values.known], ['Einverständnis mit der Übernahme durch Betreuer', values.consent]);
  wide('Ergänzende Hinweise', values.additional);
  y -= 20;
  const lineY = y - 62;
  page.drawText('Musterstadt, 12.08.2026', { x: 48, y: lineY + 15, size: 9.5, font: bold, color: ink });
  page.drawLine({ start: { x: 48, y: lineY }, end: { x: 252, y: lineY }, thickness: .7, color: muted });
  page.drawText('Ort, Datum', { x: 48, y: lineY - 14, size: 8, font: regular, color: muted });
  page.drawText('SIGNATUR', { x: 338, y: lineY + 18, size: 12, font: bold, color: ink });
  page.drawLine({ start: { x: 300, y: lineY }, end: { x: 547, y: lineY }, thickness: .7, color: muted });
  page.drawText('Christoph Zepp · Unterschrift des Betreuers', { x: 300, y: lineY - 14, size: 8, font: regular, color: muted });
  fs.writeFileSync(path.join(outputDir, 'druckversion.pdf'), await pdf.save());
}

async function makePersonPrint() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 792;
  page.drawText('Betreuungsantrag Betreuter', { x: 50, y, size: 19, font: bold, color: blue });
  y -= 30;
  page.drawText('Betreuung: Franz Josef Bastuck · Az. 10 XVII 121/16', { x: 50, y, size: 10, font: regular, color: muted });
  y -= 30;
  page.drawRectangle({ x: 46, y: y - 5, width: 503, height: 28, color: blue });
  page.drawText('Erklärung zur Einrichtung einer rechtlichen Betreuung', { x: 55, y: y + 4, size: 11, font: bold, color: rgb(1, 1, 1) });
  y -= 36;
  function field(label, value, x, top, width, height) {
    page.drawRectangle({ x, y: top - height, width, height, color: fieldFill, borderColor: fieldBorder, borderWidth: .65 });
    page.drawText(label, { x: x + 11, y: top - 17, size: 9.3, font: bold, color: muted });
    let yy = top - 36;
    for (const line of wrap(value, regular, 11.2, width - 24)) { page.drawText(line, { x: x + 11, y: yy, size: 11.2, font: regular, color: ink }); yy -= 15; }
  }
  function pair(left, right) {
    const gap = 12, width = (499 - gap) / 2;
    const height = Math.max(58, 45 + Math.max(wrap(left[1], regular, 11.2, width - 24).length, wrap(right[1], regular, 11.2, width - 24).length) * 15);
    field(left[0], left[1], 48, y, width, height); field(right[0], right[1], 48 + width + gap, y, width, height);
    y -= height + 9;
  }
  function wide(label, value) {
    const height = Math.max(62, 45 + wrap(value, regular, 11.2, 475).length * 15);
    field(label, value, 48, y, 499, height); y -= height + 9;
  }
  pair(['Name der erklärenden Person', values.personName], ['Geburtsdatum', values.birthDate]);
  wide('Anschrift der erklärenden Person', values.personAddress);
  wide('Erklärung', 'Hiermit erkläre ich, dass ich dringend Unterstützung in Form einer rechtlichen Betreuung zur Bewältigung meiner Lebensherausforderungen benötige. Ich bitte um Einrichtung einer rechtlichen Betreuung und möchte, dass diese Betreuung durch Christoph Zepp, Testbüroname, Musterstraße 1, 12345 Musterstadt übernommen wird.');
  y -= 20;
  const lineY = y - 62;
  page.drawText('Bad Bocklet, 12.08.2026', { x: 48, y: lineY + 15, size: 9.5, font: bold, color: ink });
  page.drawLine({ start: { x: 48, y: lineY }, end: { x: 252, y: lineY }, thickness: .7, color: muted });
  page.drawText('Ort, Datum', { x: 48, y: lineY - 14, size: 8, font: regular, color: muted });
  page.drawLine({ start: { x: 300, y: lineY }, end: { x: 547, y: lineY }, thickness: .7, color: muted });
  page.drawText('Erklärende Person · Unterschrift', { x: 300, y: lineY - 14, size: 8, font: regular, color: muted });
  fs.writeFileSync(path.join(outputDir, 'druckversion-betreuter.pdf'), await pdf.save());
}

async function makeSignatureSheet(fileName = 'unterschriftenblatt.pdf', foreignCount = 0) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595.28, pageHeight = 841.89, left = 48, right = 48;
  const contentWidth = pageWidth - left - right;
  let page, y;
  function header(continued = false) {
    page = pdf.addPage([pageWidth, pageHeight]);
    page.drawText('Unterschriftenblatt', { x: left, y: 790, size: 19, font: bold, color: blue });
    page.drawText('Betreuung: Franz Josef Bastuck · Az. 10 XVII 121/16', { x: left, y: 761, size: 9.5, font: regular, color: muted });
    page.drawRectangle({ x: left - 2, y: 716, width: contentWidth + 4, height: 28, color: blue });
    page.drawText(continued ? 'Unterschriften zum Dokumentenpaket - Fortsetzung' : 'Unterschriften zum Dokumentenpaket', { x: left + 7, y: 724, size: 10.5, font: bold, color: rgb(1, 1, 1) });
    y = 697;
    if (!continued) {
      page.drawRectangle({ x: left, y: y - 58, width: contentWidth, height: 58, color: fieldFill, borderColor: fieldBorder, borderWidth: .65 });
      page.drawText('Enthaltene Dokumente', { x: left + 11, y: y - 16, size: 8.7, font: bold, color: muted });
      page.drawText('Anschreiben auf Briefkopf | Betreuungsantrag Betreuer', { x: left + 11, y: y - 36, size: 9.4, font: regular, color: ink });
      y -= 72;
    }
  }
  function card(title, placeDate, signatureText, signatureLabel) {
    if (y - 126 < 52) header(true);
    const height = 126, bottom = y - height, splitX = left + contentWidth / 2, lineY = bottom + 30;
    page.drawRectangle({ x: left, y: bottom, width: contentWidth, height, color: fieldFill, borderColor: fieldBorder, borderWidth: .65 });
    page.drawText(title, { x: left + 12, y: y - 20, size: 9.4, font: bold, color: blue });
    page.drawLine({ start: { x: splitX, y: bottom + 17 }, end: { x: splitX, y: y - 38 }, thickness: .55, color: fieldBorder });
    page.drawText('Ort und Datum', { x: left + 12, y: y - 43, size: 8.4, font: bold, color: muted });
    page.drawText('Unterschrift', { x: splitX + 14, y: y - 43, size: 8.4, font: bold, color: muted });
    if (placeDate) page.drawText(placeDate, { x: left + 12, y: lineY + 14, size: 9.3, font: regular, color: ink });
    if (signatureText) page.drawText(signatureText, { x: splitX + 20, y: lineY + 21, size: 12, font: bold, color: ink });
    page.drawLine({ start: { x: left + 12, y: lineY }, end: { x: splitX - 14, y: lineY }, thickness: .7, color: muted });
    page.drawLine({ start: { x: splitX + 14, y: lineY }, end: { x: left + contentWidth - 12, y: lineY }, thickness: .7, color: muted });
    page.drawText('Ort, Datum', { x: left + 12, y: lineY - 14, size: 8, font: regular, color: muted });
    page.drawText(signatureLabel, { x: splitX + 14, y: lineY - 14, size: 8, font: regular, color: muted });
    y = bottom - 13;
  }
  header(false);
  card('Eigene Unterschrift am Paketende', 'Musterstadt, 12.08.2026', 'SIGNATUR', 'Testbüroname - Unterschrift');
  for (let i = 1; i <= foreignCount; i++) card('Fremde Unterschrift ' + i, '', '', 'Name / Funktion der unterschreibenden Person');
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawText('Unterschriftenblatt | Seite ' + (index + 1) + ' von ' + pages.length, { x: 414, y: 22, size: 7.3, font: regular, color: muted });
  });
  fs.writeFileSync(path.join(outputDir, fileName), await pdf.save());
}

async function makeLetter() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const title = 'Testbüroname (Rechtliche Betreuung)';
  page.drawText(title, { x: (595.28 - bold.widthOfTextAtSize(title, 18)) / 2, y: 785, size: 18, font: bold, color: blue });
  page.drawLine({ start: { x: 78, y: 765 }, end: { x: 517, y: 765 }, thickness: 1.3, color: blue });
  const sender = 'Testbüroname, Musterstraße 1, 12345 Musterstadt';
  page.drawText(sender, { x: 80, y: 724, size: 7.6, font: regular, color: ink });
  page.drawLine({ start: { x: 80, y: 721 }, end: { x: 80 + regular.widthOfTextAtSize(sender, 7.6) + 3, y: 721 }, thickness: .45, color: ink });
  let y = 704;
  for (const line of [values.court, ...values.courtAddress.split('\n')]) { page.drawText(line, { x: 80, y, size: 10.5, font: regular, color: ink }); y -= 16; }
  page.drawText('12.08.2026', { x: 80, y: 565, size: 10.5, font: bold, color: ink });
  y = 538;
  for (const line of ['Betreuungssache Franz Josef Bastuck', 'geboren am 01.01.1990', 'wohnhaft in Hauptstraße 12, 69999 Bad Bocklet', 'Betreuungsgericht Amtsgericht Simmern/Hunsrück; Az.: 10 XVII 121/16']) { page.drawText(line, { x: 80, y, size: 10.5, font: bold, color: ink }); y -= 15; }
  y -= 18;
  page.drawText('Übernahmebereitschaft zur rechtlichen Betreuung', { x: 80, y, size: 11, font: bold, color: ink }); y -= 28;
  const paragraphs = [
    'Sehr geehrte Damen und Herren,',
    'hiermit erkläre ich mich bereit und damit einverstanden, die rechtliche Betreuung für Franz Josef Bastuck, geboren am 01.01.1990 zu übernehmen.',
    'Die betroffene Person ist mir bekannt.',
    'Ergänzende Hinweise: Die Übernahme soll zum nächstmöglichen Zeitpunkt erfolgen.',
    'Für Rückfragen stehe ich Ihnen gerne zur Verfügung.',
    'Mit freundlichen Grüßen'
  ];
  for (const paragraph of paragraphs) { for (const line of wrap(paragraph, regular, 10.5, 438)) { page.drawText(line, { x: 80, y, size: 10.5, font: regular, color: ink }); y -= 16; } y -= paragraph === paragraphs[0] ? 18 : 15; }
  page.drawText('SIGNATUR', { x: 80, y: y - 22, size: 12, font: bold, color: ink });
  page.drawText('Christoph Zepp', { x: 80, y: y - 50, size: 10.5, font: regular, color: ink });
  page.drawText('Testbüroname', { x: 78, y: 58, size: 7.2, font: regular, color: blue });
  page.drawText('Musterstraße 1, 12345 Musterstadt | 0151 0000000 | info@example.de', { x: 78, y: 45, size: 7.2, font: regular, color: blue });
  fs.writeFileSync(path.join(outputDir, 'briefkopfversion.pdf'), await pdf.save());
}

Promise.all([
  makePrint(),
  makePersonPrint(),
  makeSignatureSheet(),
  makeSignatureSheet('unterschriftenblatt-mehrfach.pdf', 6),
  makeLetter()
]).catch(error => { console.error(error); process.exitCode = 1; });
