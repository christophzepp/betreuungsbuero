#!/usr/bin/env node
'use strict';
/* Textlage einer PDF-Seite auslesen: liefert je Textstueck Seite, x, y, Groesse und Inhalt.
   Grundlage fuer die Koordinatenkarten der flachen Original-PDFs (keine Formularfelder).
   Nutzt @cantoo/pdf-lib nur zum Entpacken der Inhaltsstroeme; die Textmatrix wird selbst
   verfolgt (Textmatrix, Zeilenvorschub, Schriftwahl, Textausgabe), weil pdf-lib keine
   Textextraktion kann. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { PDFDocument, PDFName, PDFRawStream, PDFArray, decodePDFRawStream } = require('@cantoo/pdf-lib');

function streamBytes(stream) {
  try { return decodePDFRawStream(stream).decode(); } catch (_e) {}
  const raw = stream.getContents();
  try { return zlib.inflateSync(Buffer.from(raw)); } catch (_e) {}
  return Buffer.from(raw);
}

/* Literale und Hex-Strings eines Inhaltsstroms in Token zerlegen. */
function tokenize(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '(') {
      let depth = 1, j = i + 1, s = '';
      while (j < text.length && depth > 0) {
        const ch = text[j];
        if (ch === '\\') {
          const n = text[j + 1];
          const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
          if (map[n] !== undefined) { s += map[n]; j += 2; continue; }
          if (/[0-7]/.test(n)) {
            const m = /^[0-7]{1,3}/.exec(text.slice(j + 1));
            s += String.fromCharCode(parseInt(m[0], 8)); j += 1 + m[0].length; continue;
          }
          j += 2; continue;
        }
        if (ch === '(') depth++;
        if (ch === ')') { depth--; if (!depth) { j++; break; } }
        s += ch; j++;
      }
      out.push({ t: 'str', v: s }); i = j; continue;
    }
    if (c === '<' && text[i + 1] !== '<') {
      const end = text.indexOf('>', i);
      const hex = text.slice(i + 1, end).replace(/\s+/g, '');
      let s = '';
      for (let k = 0; k + 1 < hex.length; k += 2) s += String.fromCharCode(parseInt(hex.substr(k, 2), 16));
      out.push({ t: 'str', v: s }); i = end + 1; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '[' || c === ']') { out.push({ t: 'op', v: c }); i++; continue; }
    const m = /^[^\s()<>\[\]{}\/%]+|^\/[^\s()<>\[\]{}\/%]*/.exec(text.slice(i));
    if (!m) { i++; continue; }
    const tok = m[0];
    if (/^[-+.\d]+$/.test(tok)) out.push({ t: 'num', v: parseFloat(tok) });
    else out.push({ t: 'op', v: tok });
    i += tok.length;
  }
  return out;
}

function extractPage(bytes, seite, hoehe) {
  const text = Buffer.from(bytes).toString('latin1');
  const toks = tokenize(text);
  const stuecke = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0], leading = 0, size = 0, font = '';
  let ctm = [1, 0, 0, 1, 0, 0];
  const zustandsStapel = [];
  const mul = (a, b) => [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]
  ];
  /* Die Textmatrix gilt im aktuellen Benutzerkoordinatensystem: erst mit der laufenden
     Transformationsmatrix verrechnen, sonst landen Seiten mit einem `cm`-Versatz im Minus. */
  const zeige = (s) => {
    if (!s) return;
    const m = mul(tm, ctm);
    stuecke.push({ seite, x: Math.round(m[4] * 10) / 10, y: Math.round(m[5] * 10) / 10,
      yTop: Math.round((hoehe - m[5]) * 10) / 10, size: Math.round(size * Math.abs(m[3] || 1) * 10) / 10, font, text: s });
  };
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.t !== 'op') continue;
    const zahl = (n) => { const z = []; for (let k = i - n; k < i; k++) z.push(toks[k] && toks[k].t === 'num' ? toks[k].v : 0); return z; };
    switch (tk.v) {
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
      case 'Tf': { const s = toks[i - 1]; if (s && s.t === 'num') size = s.v; const f = toks[i - 2]; if (f && f.t === 'op') font = f.v; break; }
      case 'TL': { const s = toks[i - 1]; if (s && s.t === 'num') leading = s.v; break; }
      case 'Tm': { const a = zahl(6); tm = a.slice(); tlm = a.slice(); break; }
      case 'Td': { const [dx, dy] = zahl(2); tlm = mul([1, 0, 0, 1, dx, dy], tlm); tm = tlm.slice(); break; }
      case 'TD': { const [dx, dy] = zahl(2); leading = -dy; tlm = mul([1, 0, 0, 1, dx, dy], tlm); tm = tlm.slice(); break; }
      case 'T*': { tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); break; }
      case 'Tj': case "'": case '"': {
        if (tk.v !== 'Tj') { tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); }
        const s = toks[i - 1]; if (s && s.t === 'str') zeige(s.v); break;
      }
      case 'TJ': {
        let k = i - 1, teile = [];
        while (k >= 0 && !(toks[k].t === 'op' && toks[k].v === '[')) { if (toks[k].t === 'str') teile.unshift(toks[k].v); k--; }
        zeige(teile.join('')); break;
      }
      /* q/Q sichern den Grafikzustand, nicht die Textmatrix. */
      case 'q': zustandsStapel.push(ctm.slice()); break;
      case 'Q': if (zustandsStapel.length) ctm = zustandsStapel.pop(); break;
      case 'cm': { const a = zahl(6); ctm = mul(a, ctm); break; }
    }
  }
  return stuecke;
}

(async () => {
  const datei = process.argv[2];
  const bytes = fs.readFileSync(datei);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
  const alles = [];
  pdf.getPages().forEach((page, idx) => {
    const { width, height } = page.getSize();
    const contents = page.node.get(PDFName.of('Contents'));
    let teile = [];
    if (contents instanceof PDFArray) {
      for (let k = 0; k < contents.size(); k++) {
        const s = pdf.context.lookup(contents.get(k));
        if (s instanceof PDFRawStream) teile.push(streamBytes(s));
      }
    } else {
      const s = pdf.context.lookup(contents);
      if (s instanceof PDFRawStream) teile.push(streamBytes(s));
    }
    const roh = Buffer.concat(teile.map(Buffer.from));
    const st = extractPage(roh, idx + 1, height);
    alles.push({ seite: idx + 1, breite: Math.round(width), hoehe: Math.round(height), stuecke: st });
  });
  const ausgabe = process.argv[3];
  const json = JSON.stringify(alles, null, 1);
  if (ausgabe) fs.writeFileSync(ausgabe, json);
  alles.forEach(p => console.log(`Seite ${p.seite}: ${p.breite}x${p.hoehe}, ${p.stuecke.length} Textstücke`));
  if (!ausgabe) console.log(json.slice(0, 3000));
})();
