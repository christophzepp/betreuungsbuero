// Minimaler, selbstgeschriebener PDF-Generator fuer das Ausfuellprotokoll (Plan Abschnitt BR,
// Nutzeranforderung "Export des eingegebenen Formulars als PDF"). MV3 verbietet Remote-Code -
// statt pdf-lib zu vendorn reicht fuer ein reines Text-Protokoll ein handgebautes PDF:
// Helvetica (Standard-14-Font, keine Einbettung noetig) mit WinAnsiEncoding (deckt deutsche
// Umlaute/ß/€ ab), A4, mehrseitig, einfacher Zeilenumbruch. Byte-genaue xref-Offsets werden
// ueber einen Latin1-String berechnet (alle Bytes <= 255 nach WinAnsi-Ersetzung).
// eslint-disable-next-line no-unused-vars
const BxaPdf = (() => {

  const PAGE_W = 595.28, PAGE_H = 841.89; // A4 in pt
  const MARGIN = 50, FONT = 10, LEAD = 14, TITLE = 15;

  // Unicode -> WinAnsi(cp1252)-Byte fuer die relevanten Nicht-ASCII-Zeichen; Unbekanntes -> '?'.
  const WINANSI = { 'ä': 0xE4, 'ö': 0xF6, 'ü': 0xFC, 'Ä': 0xC4, 'Ö': 0xD6, 'Ü': 0xDC, 'ß': 0xDF, '€': 0x80, '„': 0x84, '“': 0x93, '”': 0x94, '‚': 0x82, '’': 0x92, '‘': 0x91, '–': 0x96, '—': 0x97, '§': 0xA7, '°': 0xB0, '´': 0xB4, '·': 0xB7, '×': 0xD7, '…': 0x85, 'é': 0xE9, 'è': 0xE8, 'á': 0xE1, 'à': 0xE0, 'ç': 0xE7 };
  function toWinAnsi(str) {
    let out = '';
    for (const ch of String(str || '')) {
      const code = ch.codePointAt(0);
      if (code === 10 || code === 13) { out += ' '; continue; }
      if (code < 128) out += ch;
      else if (WINANSI[ch] !== undefined) out += String.fromCharCode(WINANSI[ch]);
      else out += '?';
    }
    return out.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  // Grobe Breitenschaetzung (Helvetica ~0.5 em Durchschnitt) fuer den Zeilenumbruch.
  function wrap(text, maxChars) {
    const words = String(text || '').split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const cand = line ? line + ' ' + w : w;
      if (cand.length > maxChars && line) { lines.push(line); line = w.length > maxChars ? w.slice(0, maxChars) : w; }
      else if (cand.length > maxChars) { lines.push(cand.slice(0, maxChars)); line = cand.slice(maxChars); }
      else line = cand;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  // lines: [{text, bold?, size?, indent?}] -> Seiten mit Content-Streams.
  function layout(lines) {
    const pages = [];
    let ops = [], y = PAGE_H - MARGIN;
    function flush() { if (ops.length) pages.push(ops.join('\n')); ops = []; y = PAGE_H - MARGIN; }
    for (const ln of lines) {
      const size = ln.size || FONT;
      const lead = size + 4;
      if (y - lead < MARGIN) flush();
      y -= lead;
      const font = ln.bold ? '/F2' : '/F1';
      const x = MARGIN + (ln.indent || 0);
      ops.push(`BT ${font} ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${toWinAnsi(ln.text)}) Tj ET`);
      if (ln.rule) { ops.push(`0.7 0.7 0.7 RG 0.5 w ${MARGIN} ${(y - 3).toFixed(1)} m ${(PAGE_W - MARGIN).toFixed(1)} ${(y - 3).toFixed(1)} l S`); y -= 4; }
    }
    flush();
    return pages;
  }

  // image (optional, Feature v0.2.0 #5 Screenshot-Nachweis): { data: <Latin1-JPEG-Bytes>, w, h }.
  // Wird als JPEG-XObject (Filter DCTDecode - der Standard-JPEG-Dekoder von PDF, keine erneute
  // Kompression noetig) auf einer eigenen letzten Seite eingebettet, seitenbreit skaliert.
  function buildPdf(lines, image) {
    const pages = layout(lines);
    const objects = []; // 1-basiert
    const pageObjIds = [];
    const contentObjIds = [];
    const fontRegularId = 1, fontBoldId = 2, pagesId = 3, catalogId = 4;
    objects[fontRegularId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[fontBoldId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    let nextId = 5;
    for (const content of pages) {
      const cid = nextId++;
      objects[cid] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
      contentObjIds.push(cid);
      const pid = nextId++;
      objects[pid] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${cid} 0 R >>`;
      pageObjIds.push(pid);
    }
    if (image && image.data && image.w > 0 && image.h > 0) {
      const imgId = nextId++;
      objects[imgId] = `<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n${image.data}\nendstream`;
      const maxW = PAGE_W - 2 * MARGIN, maxH = PAGE_H - 2 * MARGIN - 24;
      const scale = Math.min(maxW / image.w, maxH / image.h, 1);
      const dw = image.w * scale, dh = image.h * scale;
      const capY = PAGE_H - MARGIN, imgBottom = capY - 20 - dh;
      const stream = `BT /F2 11 Tf 1 0 0 1 ${MARGIN} ${(capY - 11).toFixed(1)} Tm (${toWinAnsi('Bildschirmfoto des ausgefüllten Formulars')}) Tj ET\n`
        + `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${MARGIN.toFixed(2)} ${imgBottom.toFixed(2)} cm /Im0 Do Q`;
      const cid = nextId++;
      objects[cid] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
      const pid = nextId++;
      objects[pid] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${cid} 0 R >>`;
      pageObjIds.push(pid);
    }
    objects[pagesId] = `<< /Type /Pages /Kids [${pageObjIds.map(i => i + ' 0 R').join(' ')}] /Count ${pageObjIds.length} >>`;
    objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;

    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    for (let i = 1; i < nextId; i++) {
      offsets[i] = pdf.length;
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefPos = pdf.length;
    pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
    for (let i = 1; i < nextId; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    pdf += `trailer\n<< /Size ${nextId} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xFF;
    return bytes;
  }

  // Oeffentliche API: Ausfuellprotokoll. {title, meta:[[k,v],...], fields:[[label,value],...],
  // actions:[text,...], footer, screenshot?:{data,w,h}}
  function buildProtocolPdf({ title, meta = [], fields = [], actions = [], footer = '', screenshot = null }) {
    const lines = [];
    lines.push({ text: title || 'Ausfüllprotokoll Online-Formular', bold: true, size: TITLE, rule: true });
    lines.push({ text: '' });
    for (const [k, v] of meta) {
      for (const [i, part] of wrap(v, 78).entries()) {
        lines.push({ text: i === 0 ? (k + ': ' + part) : part, indent: i === 0 ? 0 : 12 });
      }
    }
    lines.push({ text: '' });
    lines.push({ text: 'Ausgefüllte Felder (' + fields.length + ')', bold: true, size: 12, rule: true });
    for (const [label, value] of fields) {
      const l = wrap(label, 88);
      l.forEach((part, i) => lines.push({ text: part, bold: true, indent: 0, size: FONT }));
      wrap(value || '(leer)', 84).forEach(part => lines.push({ text: part, indent: 14 }));
    }
    if (actions.length) {
      lines.push({ text: '' });
      lines.push({ text: 'Ausgeführte Aktionen', bold: true, size: 12, rule: true });
      for (const a of actions) wrap(a, 88).forEach((part, i) => lines.push({ text: (i === 0 ? '· ' : '  ') + part }));
    }
    if (footer) { lines.push({ text: '' }); wrap(footer, 90).forEach(part => lines.push({ text: part, size: 8.5 })); }
    return buildPdf(lines, screenshot);
  }

  return { buildProtocolPdf };
})();
