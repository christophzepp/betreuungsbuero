'use strict';

/*
 * Abhängigkeitenfreier Generator für das Fall-Übergabepaket nach § 1872 BGB.
 *
 * Die Anwendung hat bewusst kein PDF-Paket als Server-Abhängigkeit. Die beiden
 * schlichten, druckbaren PDFs werden deshalb mit den eingebauten PDF-Type-1-
 * Schriften erzeugt. Der Writer beschränkt sich auf Text, Linien und Flächen;
 * dadurch bleibt er klein, deterministisch und mit üblichen PDF-Lesern kompatibel.
 */

const crypto = require('crypto');
const fs = require('fs');

const PAGE_WIDTH = 595.28;   // A4 in PDF-Punkten
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;

const COLORS = {
  ink: [0.12, 0.16, 0.20],
  muted: [0.38, 0.43, 0.47],
  navy: [0.08, 0.22, 0.31],
  teal: [0.08, 0.48, 0.52],
  pale: [0.93, 0.96, 0.97],
  line: [0.76, 0.81, 0.83],
  danger: [0.70, 0.10, 0.12],
  dangerPale: [1.00, 0.92, 0.92],
  white: [1, 1, 1]
};

const CP1252 = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
  [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
  [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
  [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F]
]);

function fixed(number) {
  const value = Number(number);
  if (!Number.isFinite(value)) throw new TypeError('PDF-Koordinate ist keine Zahl.');
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function rgb(color) {
  return color.map(fixed).join(' ');
}

function winAnsiBytes(value) {
  const bytes = [];
  for (const character of String(value == null ? '' : value).normalize('NFC')) {
    const code = character.codePointAt(0);
    if (code <= 0xFF && !(code >= 0x80 && code <= 0x9F)) bytes.push(code);
    else if (CP1252.has(code)) bytes.push(CP1252.get(code));
    else if (code === 0x00A0) bytes.push(0x20);
    else bytes.push(0x3F); // nicht darstellbares Zeichen sichtbar als "?"
  }
  return bytes;
}

function pdfLiteral(value) {
  let out = '';
  for (const byte of winAnsiBytes(value)) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5C) {
      out += '\\' + String.fromCharCode(byte);
    } else if (byte >= 0x20 && byte <= 0x7E) {
      out += String.fromCharCode(byte);
    } else {
      out += '\\' + byte.toString(8).padStart(3, '0');
    }
  }
  return out;
}

function approximateWidth(value, size, font) {
  if (font === 'mono') return Array.from(String(value || '')).length * size * 0.60;
  let units = 0;
  for (const character of Array.from(String(value || ''))) {
    if (/[ilI1.,:;'|!]/.test(character)) units += 0.27;
    else if (/[mwMW@%&#]/.test(character)) units += 0.82;
    else if (/\s/.test(character)) units += 0.28;
    else if (/[A-ZÄÖÜ]/.test(character)) units += 0.62;
    else units += 0.52;
  }
  return units * size;
}

function splitLongWord(word, maxWidth, size, font) {
  const parts = [];
  let current = '';
  for (const character of Array.from(word)) {
    if (current && approximateWidth(current + character, size, font) > maxWidth) {
      parts.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current || !parts.length) parts.push(current);
  return parts;
}

function wrapText(value, maxWidth, size, font) {
  const paragraphs = String(value == null ? '' : value).replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const chunks = approximateWidth(word, size, font) > maxWidth
        ? splitLongWord(word, maxWidth, size, font)
        : [word];
      for (const chunk of chunks) {
        const candidate = line ? line + ' ' + chunk : chunk;
        if (line && approximateWidth(candidate, size, font) > maxWidth) {
          lines.push(line);
          line = chunk;
        } else {
          line = candidate;
        }
        if (approximateWidth(line, size, font) > maxWidth) {
          const forced = splitLongWord(line, maxWidth, size, font);
          lines.push(...forced.slice(0, -1));
          line = forced[forced.length - 1];
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

class PdfPage {
  constructor() {
    this.commands = [];
  }

  fillRect(x, top, width, height, color) {
    this.commands.push(
      `q ${rgb(color)} rg ${fixed(x)} ${fixed(PAGE_HEIGHT - top - height)} ${fixed(width)} ${fixed(height)} re f Q`
    );
  }

  strokeRect(x, top, width, height, color, lineWidth) {
    this.commands.push(
      `q ${rgb(color)} RG ${fixed(lineWidth || 0.5)} w ${fixed(x)} ${fixed(PAGE_HEIGHT - top - height)} ${fixed(width)} ${fixed(height)} re S Q`
    );
  }

  line(x1, top1, x2, top2, color, lineWidth) {
    this.commands.push(
      `q ${rgb(color)} RG ${fixed(lineWidth || 0.5)} w ${fixed(x1)} ${fixed(PAGE_HEIGHT - top1)} m ${fixed(x2)} ${fixed(PAGE_HEIGHT - top2)} l S Q`
    );
  }

  text(x, baselineTop, value, options) {
    const opts = options || {};
    const font = opts.font === 'bold' ? 'F2' : (opts.font === 'mono' ? 'F3' : 'F1');
    const size = Number(opts.size) || 9;
    const color = opts.color || COLORS.ink;
    this.commands.push(
      `q ${rgb(color)} rg BT /${font} ${fixed(size)} Tf 1 0 0 1 ${fixed(x)} ${fixed(PAGE_HEIGHT - baselineTop)} Tm (${pdfLiteral(value)}) Tj ET Q`
    );
  }

  buffer() {
    return Buffer.from(this.commands.join('\n') + '\n', 'ascii');
  }
}

function pdfDate(value) {
  const date = normalDate(value);
  const p = (n) => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
}

function buildPdf(pages, title, generatedAt) {
  if (!Array.isArray(pages) || !pages.length) throw new Error('Ein PDF braucht mindestens eine Seite.');
  const objects = [null];
  const add = (value) => {
    objects.push(value);
    return objects.length - 1;
  };

  const catalogId = add(null);
  const pagesId = add(null);
  const regularFontId = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'ascii'));
  const boldFontId = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>', 'ascii'));
  const monoFontId = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>', 'ascii'));
  const pageIds = [];

  for (const page of pages) {
    const stream = page.buffer();
    const contentId = add(Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'ascii'),
      stream,
      Buffer.from('endstream', 'ascii')
    ]));
    pageIds.push(add(Buffer.from(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fixed(PAGE_WIDTH)} ${fixed(PAGE_HEIGHT)}] ` +
      `/Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R /F3 ${monoFontId} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`,
      'ascii'
    )));
  }

  objects[catalogId] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'ascii');
  objects[pagesId] = Buffer.from(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
    'ascii'
  );
  const infoId = add(Buffer.from(
    `<< /Title (${pdfLiteral(title)}) /Producer (Betreuungsbuero Uebergabepaket) /CreationDate (${pdfDate(generatedAt)}) >>`,
    'ascii'
  ));

  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [0];
  let offset = chunks[0].length;
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = offset;
    const object = Buffer.concat([
      Buffer.from(`${id} 0 obj\n`, 'ascii'),
      objects[id],
      Buffer.from('\nendobj\n', 'ascii')
    ]);
    chunks.push(object);
    offset += object.length;
  }

  const xrefOffset = offset;
  const xref = [
    'xref',
    `0 ${objects.length}`,
    '0000000000 65535 f '
  ];
  for (let id = 1; id < objects.length; id++) {
    xref.push(String(offsets[id]).padStart(10, '0') + ' 00000 n ');
  }
  xref.push(
    'trailer',
    `<< /Size ${objects.length} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    ''
  );
  chunks.push(Buffer.from(xref.join('\n'), 'ascii'));
  return Buffer.concat(chunks);
}

function normalDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function isoDate(value) {
  return normalDate(value).toISOString();
}

function displayDate(value) {
  const date = normalDate(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()}, ${p(date.getHours())}:${p(date.getMinutes())} Uhr`;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0).replace('.', ',')} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2).replace('.', ',')} GB`;
}

function sha256Buffer(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes == null ? '' : bytes);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    let read;
    do {
      read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read) hash.update(buffer.subarray(0, read));
    } while (read);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function safeZipPath(value) {
  const raw = String(value == null ? '' : value).normalize('NFC').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.startsWith('//')) {
    throw new Error('ZIP-Pfad muss relativ sein.');
  }
  const parts = raw.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /\p{Cc}/u.test(part))) {
    throw new Error('ZIP-Pfad enthält ein leeres oder unsicheres Segment.');
  }
  return parts.join('/');
}

function normalDocuments(documents) {
  return (Array.isArray(documents) ? documents : []).map((document) => {
    const path = safeZipPath(document.path || document.zipPath || document.name || 'Unbenannt');
    const sha256 = String(document.sha256 || '').toLowerCase();
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`Ungültige SHA-256-Prüfsumme für ${path}.`);
    }
    return {
      fileId: String(document.fileId || document.id || ''),
      path,
      name: String(document.name || path.split('/').pop()),
      size: Math.max(0, Number(document.size) || 0),
      sha256,
      reason: String(document.reason || '')
    };
  }).sort((a, b) => a.path.localeCompare(b.path, 'de', { sensitivity: 'base', numeric: true }));
}

function addPageFooter(pages, title) {
  pages.forEach((page, index) => {
    page.line(MARGIN, 805, PAGE_WIDTH - MARGIN, 805, COLORS.line, 0.5);
    page.text(MARGIN, 822, title, { size: 7.5, color: COLORS.muted });
    page.text(PAGE_WIDTH - 104, 822, `Seite ${index + 1} von ${pages.length}`, {
      size: 7.5, color: COLORS.muted
    });
  });
}

function drawContentsHeader(page, caseLabel, generatedAt, continuation) {
  page.fillRect(0, 0, PAGE_WIDTH, continuation ? 23 : 12, COLORS.navy);
  if (continuation) {
    page.text(MARGIN, 48, 'Inhaltsverzeichnis der Fallakte (Fortsetzung)', {
      font: 'bold', size: 13, color: COLORS.navy
    });
    page.text(MARGIN, 65, String(caseLabel || 'Ohne Fallbezeichnung'), {
      size: 8.5, color: COLORS.muted
    });
    return 82;
  }
  page.text(MARGIN, 50, 'Inhaltsverzeichnis der Fallakte', {
    font: 'bold', size: 20, color: COLORS.navy
  });
  page.fillRect(MARGIN, 63, 52, 3, COLORS.teal);
  page.text(MARGIN, 88, `Fall: ${caseLabel || 'Ohne Fallbezeichnung'}`, {
    font: 'bold', size: 10.5, color: COLORS.ink
  });
  page.text(MARGIN, 105, `Paket erstellt am ${displayDate(generatedAt)}`, {
    size: 8.5, color: COLORS.muted
  });
  return 126;
}

function drawTableHeader(page, top) {
  const width = PAGE_WIDTH - 2 * MARGIN;
  page.fillRect(MARGIN, top, width, 23, COLORS.navy);
  page.text(MARGIN + 5, top + 15, 'Nr.', { font: 'bold', size: 7.5, color: COLORS.white });
  page.text(MARGIN + 29, top + 15, 'Pfad im Übergabepaket', { font: 'bold', size: 7.5, color: COLORS.white });
  page.text(MARGIN + 307, top + 15, 'Größe', { font: 'bold', size: 7.5, color: COLORS.white });
  page.text(MARGIN + 365, top + 15, 'Prüfung', { font: 'bold', size: 7.5, color: COLORS.white });
  return top + 23;
}

function createContentsPdf(options) {
  const opts = options || {};
  const documents = normalDocuments(opts.documents);
  const missing = normalDocuments(opts.missing);
  const generatedAt = normalDate(opts.generatedAt);
  const caseLabel = String(opts.caseLabel || '');
  const rows = [
    ...documents.map((document) => ({ ...document, missing: false })),
    ...missing.map((document) => ({ ...document, missing: true }))
  ];
  const pages = [];
  let page = new PdfPage();
  pages.push(page);
  let y = drawContentsHeader(page, caseLabel, generatedAt, false);

  const summary = missing.length
    ? `${documents.length} Dokument(e) enthalten, ${missing.length} Dokument(e) fehlen.`
    : `${documents.length} Dokument(e), vollständig gelesen und mit SHA-256 geprüft.`;
  page.fillRect(MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 26, missing.length ? COLORS.dangerPale : COLORS.pale);
  page.text(MARGIN + 8, y + 17, summary, {
    font: 'bold', size: 8.5, color: missing.length ? COLORS.danger : COLORS.navy
  });
  y += 36;
  y = drawTableHeader(page, y);

  if (!rows.length) {
    page.fillRect(MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 42, COLORS.pale);
    page.text(MARGIN + 8, y + 25, 'In dieser Fallakte sind keine Dokumente verzeichnet.', {
      size: 9, color: COLORS.muted
    });
  }

  rows.forEach((row, index) => {
    const pathLines = wrapText(row.path, 268, 8.2, 'regular');
    const hashLines = row.missing
      ? ['FEHLT', row.reason || 'Datei nicht auffindbar']
      : ['SHA-256', row.sha256.slice(0, 32), row.sha256.slice(32)];
    const rowHeight = Math.max(34, 12 + pathLines.length * 10, 10 + hashLines.length * 8);
    if (y + rowHeight > 790) {
      page = new PdfPage();
      pages.push(page);
      y = drawContentsHeader(page, caseLabel, generatedAt, true);
      y = drawTableHeader(page, y);
    }
    if (row.missing) page.fillRect(MARGIN, y, PAGE_WIDTH - 2 * MARGIN, rowHeight, COLORS.dangerPale);
    else if (index % 2) page.fillRect(MARGIN, y, PAGE_WIDTH - 2 * MARGIN, rowHeight, COLORS.pale);
    page.strokeRect(MARGIN, y, PAGE_WIDTH - 2 * MARGIN, rowHeight, COLORS.line, 0.35);
    page.text(MARGIN + 6, y + 17, String(index + 1), { size: 8, color: COLORS.muted });
    pathLines.forEach((line, lineIndex) => {
      page.text(MARGIN + 29, y + 16 + lineIndex * 10, line, {
        size: 8.2, color: row.missing ? COLORS.danger : COLORS.ink
      });
    });
    page.text(MARGIN + 307, y + 17, row.missing ? '-' : formatBytes(row.size), {
      size: 7.7, color: row.missing ? COLORS.danger : COLORS.ink
    });
    if (row.missing) {
      page.text(MARGIN + 365, y + 14, hashLines[0], { font: 'bold', size: 8, color: COLORS.danger });
      wrapText(hashLines[1], 126, 6.7, 'regular').forEach((line, lineIndex) => {
        page.text(MARGIN + 365, y + 25 + lineIndex * 8, line, { size: 6.7, color: COLORS.danger });
      });
    } else {
      page.text(MARGIN + 365, y + 11, hashLines[0], { font: 'bold', size: 6.5, color: COLORS.muted });
      page.text(MARGIN + 365, y + 21, hashLines[1], { font: 'mono', size: 6.1, color: COLORS.ink });
      page.text(MARGIN + 365, y + 29, hashLines[2], { font: 'mono', size: 6.1, color: COLORS.ink });
    }
    y += rowHeight;
  });

  addPageFooter(pages, 'Inhaltsverzeichnis · Übergabepaket nach § 1872 BGB');
  return buildPdf(pages, 'Inhaltsverzeichnis der Fallakte', generatedAt);
}

function protocolPage(pages, caseLabel, continuation) {
  const page = new PdfPage();
  pages.push(page);
  page.fillRect(0, 0, PAGE_WIDTH, continuation ? 23 : 12, COLORS.navy);
  page.text(MARGIN, continuation ? 49 : 51,
    continuation ? 'Übergabeprotokoll (Fortsetzung)' : 'Übergabeprotokoll',
    { font: 'bold', size: continuation ? 15 : 22, color: COLORS.navy });
  if (!continuation) {
    page.text(MARGIN, 73, 'Herausgabe der Unterlagen nach § 1872 BGB', {
      font: 'bold', size: 10.5, color: COLORS.teal
    });
  }
  page.text(MARGIN, continuation ? 68 : 98, `Fall: ${caseLabel || 'Ohne Fallbezeichnung'}`, {
    font: 'bold', size: 9.5, color: COLORS.ink
  });
  return { page, y: continuation ? 88 : 118 };
}

function createProtocolPdf(options) {
  const opts = options || {};
  const documents = normalDocuments(opts.documents);
  const missing = normalDocuments(opts.missing);
  const generatedAt = normalDate(opts.generatedAt);
  const caseLabel = String(opts.caseLabel || '');
  const pages = [];
  let state = protocolPage(pages, caseLabel, false);
  let page = state.page;
  let y = state.y;

  const nextPage = () => {
    state = protocolPage(pages, caseLabel, true);
    page = state.page;
    y = state.y;
  };
  const ensure = (height) => {
    if (y + height > 786) nextPage();
  };
  const heading = (value) => {
    ensure(34);
    y += 7;
    page.text(MARGIN, y + 12, value, { font: 'bold', size: 11, color: COLORS.navy });
    page.fillRect(MARGIN, y + 19, 35, 2, COLORS.teal);
    y += 30;
  };
  const paragraph = (value, options) => {
    const optsLine = options || {};
    const size = optsLine.size || 9;
    const lines = wrapText(value, PAGE_WIDTH - 2 * MARGIN - (optsLine.indent || 0), size, optsLine.font || 'regular');
    for (const line of lines) {
      ensure(size + 6);
      page.text(MARGIN + (optsLine.indent || 0), y + size, line, {
        size, font: optsLine.font, color: optsLine.color || COLORS.ink
      });
      y += size + 4;
    }
    y += optsLine.after == null ? 5 : optsLine.after;
  };
  const bullet = (value) => {
    const lines = wrapText(value, PAGE_WIDTH - 2 * MARGIN - 18, 8.7, 'regular');
    lines.forEach((line, index) => {
      ensure(13);
      page.text(MARGIN + (index ? 18 : 6), y + 9, index ? line : `•  ${line}`, {
        size: 8.7, color: COLORS.ink
      });
      y += 12;
    });
    y += 2;
  };

  page.fillRect(MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 50, missing.length ? COLORS.dangerPale : COLORS.pale);
  page.text(MARGIN + 10, y + 18, missing.length ? 'ACHTUNG: Paket unvollständig' : 'Paket vollständig geprüft', {
    font: 'bold', size: 10, color: missing.length ? COLORS.danger : COLORS.navy
  });
  page.text(MARGIN + 10, y + 36,
    `${documents.length} Dokument(e) enthalten · ${missing.length} fehlend · erstellt ${displayDate(generatedAt)}`,
    { size: 8.2, color: missing.length ? COLORS.danger : COLORS.muted });
  y += 64;

  heading('Gegenstand der Übergabe');
  paragraph(
    'Mit diesem Paket werden die zur Fallakte gehörenden elektronischen Unterlagen in einer ' +
    'softwareunabhängig lesbaren Ordnerstruktur herausgegeben. Die Dateiinhalte wurden beim ' +
    'Erstellen des Pakets gelesen und mit SHA-256-Prüfsummen erfasst.'
  );

  heading('Bestandteile des Pakets');
  bullet('Fallakte/ – sämtliche Dokumente in ihrer logischen Register- und Ordnerstruktur');
  bullet('Falldaten.json – Stammdaten, Berichte, Falldokumentation und Kontakte');
  bullet('Sicherung.json – vollständige, maschinenlesbare Falldatensicherung');
  bullet('Inhaltsverzeichnis.pdf – Pfade, Dateigrößen und SHA-256-Prüfsummen');
  bullet('Pruefsummen-SHA256.txt – maschinenlesbares Prüfsummenmanifest');
  bullet('Uebergabeprotokoll.pdf – dieses Protokoll');

  heading('Vollständigkeits- und Integritätsprüfung');
  if (missing.length) {
    paragraph(
      `${missing.length} verzeichnete Dokument(e) waren am Speicherort nicht auffindbar. ` +
      'Ein solches Paket darf nicht als vollständige Herausgabe verwendet werden.',
      { color: COLORS.danger, font: 'bold' }
    );
    missing.forEach((item, index) => {
      paragraph(`${index + 1}. ${item.path} – ${item.reason || 'Datei nicht auffindbar'}`, {
        indent: 8, size: 8.2, color: COLORS.danger, after: 2
      });
    });
  } else {
    paragraph(
      'Alle in der Datenbank verzeichneten Dokumente dieser Fallakte waren auffindbar. ' +
      'Die Prüfsummen im Inhaltsverzeichnis und im Manifest wurden aus den tatsächlich ' +
      'gelesenen Dateien berechnet.'
    );
  }

  heading('Übergabe');
  const fields = [
    ['Empfangende Person / Stelle', ''],
    ['Übergabedatum', ''],
    ['Anlass / Aktenzeichen', ''],
    ['Bemerkungen', '']
  ];
  for (const [label] of fields) {
    ensure(39);
    page.text(MARGIN, y + 9, label, { size: 7.5, color: COLORS.muted });
    page.line(MARGIN, y + 29, PAGE_WIDTH - MARGIN, y + 29, COLORS.line, 0.7);
    y += 38;
  }

  ensure(78);
  y += 8;
  page.line(MARGIN, y + 36, MARGIN + 205, y + 36, COLORS.ink, 0.7);
  page.line(PAGE_WIDTH - MARGIN - 205, y + 36, PAGE_WIDTH - MARGIN, y + 36, COLORS.ink, 0.7);
  page.text(MARGIN, y + 50, 'Übergebende Person · Datum · Unterschrift', { size: 7.2, color: COLORS.muted });
  page.text(PAGE_WIDTH - MARGIN - 205, y + 50, 'Empfangende Person · Datum · Unterschrift', {
    size: 7.2, color: COLORS.muted
  });

  addPageFooter(pages, 'Übergabeprotokoll · § 1872 BGB');
  return buildPdf(pages, 'Übergabeprotokoll nach § 1872 BGB', generatedAt);
}

function createChecksumManifest(options) {
  const opts = options || {};
  const entries = normalDocuments(opts.entries);
  const missing = normalDocuments(opts.missing);
  const lines = [
    '# Prüfsummenmanifest des Fall-Übergabepakets',
    `# Fall: ${String(opts.caseLabel || '')}`,
    `# Erstellt: ${isoDate(opts.generatedAt)}`,
    '# Algorithmus: SHA-256',
    '#',
    '# SHA-256\tBytes\tPfad'
  ];
  for (const entry of entries) {
    if (!entry.sha256) throw new Error(`Prüfsumme fehlt für ${entry.path}.`);
    lines.push(`${entry.sha256}\t${entry.size}\t${entry.path}`);
  }
  for (const entry of missing) lines.push(`FEHLT\t-\t${entry.path}`);
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

function buildHandoverArtifacts(options) {
  const opts = options || {};
  const generatedAt = normalDate(opts.generatedAt);
  const documents = normalDocuments(opts.documents);
  const missing = normalDocuments(opts.missing);
  const caseLabel = String(opts.caseLabel || '');
  const caseData = opts.caseData && typeof opts.caseData === 'object' ? opts.caseData : {};
  const fullCaseBackup = opts.fullCaseBackup && typeof opts.fullCaseBackup === 'object'
    ? opts.fullCaseBackup
    : caseData;
  const caseDataBytes = Buffer.from(JSON.stringify(caseData, null, 2) + '\n', 'utf8');
  const fullCaseBackupBytes = Buffer.from(JSON.stringify(fullCaseBackup, null, 2) + '\n', 'utf8');
  const contentsPdf = createContentsPdf({ caseLabel, generatedAt, documents, missing });
  const protocolPdf = createProtocolPdf({ caseLabel, generatedAt, documents, missing });
  const generated = [
    { path: 'Falldaten.json', bytes: caseDataBytes },
    { path: 'Sicherung.json', bytes: fullCaseBackupBytes },
    { path: 'Inhaltsverzeichnis.pdf', bytes: contentsPdf },
    { path: 'Uebergabeprotokoll.pdf', bytes: protocolPdf }
  ];
  const manifestEntries = [
    ...documents,
    ...generated.map((entry) => ({
      path: entry.path,
      size: entry.bytes.length,
      sha256: sha256Buffer(entry.bytes)
    }))
  ];
  const checksumManifest = createChecksumManifest({
    caseLabel,
    generatedAt,
    entries: manifestEntries,
    missing
  });
  return {
    generatedAt: generatedAt.toISOString(),
    documents,
    missing,
    files: [
      ...generated,
      { path: 'Pruefsummen-SHA256.txt', bytes: checksumManifest }
    ],
    manifestEntries
  };
}

module.exports = {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  buildHandoverArtifacts,
  createChecksumManifest,
  createContentsPdf,
  createProtocolPdf,
  displayDate,
  formatBytes,
  safeZipPath,
  sha256Buffer,
  sha256File,
  _test: {
    approximateWidth,
    buildPdf,
    pdfLiteral,
    winAnsiBytes,
    wrapText
  }
};
