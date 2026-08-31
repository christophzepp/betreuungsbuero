#!/usr/bin/env node
/* Komplettaudit (PDF-Umbauplan Phase 3, Abschluss): prueft fuer JEDES exportbereite
   auto-acro-/acroform-Dokument, ob saemtliche V159.pdfFields-Mappings auf tatsaechlich
   existierende, typkompatible AcroForm-Felder der eingebetteten Vorlage zeigen.
   Das ist die Fehlerklasse des ZTR-Vorfalls (Mapping auf falsche/fehlende Felder);
   die Werte-Pipeline selbst ist separat laufzeitgeprueft.
   Aufruf: node audit-mapping.js */
'use strict';
const fs = require('fs');
const readline = require('readline');
const { PDFDocument } = require('pdf-lib');

const HTML = '/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html';

(async () => {
  /* Einmaliger Zeilenscan: V159-Zeile + alle Vorlagen-Zeilen (Base64 NICHT alle im Speicher halten,
     sondern nur die Zeilennummern merken und je Bedarf erneut lesen waere teuer - wir halten sie,
     ~56 MB passen in Node). */
  let v159 = null;
  const vorlagen = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(HTML, 'utf8'), crlfDelay: Infinity });
  const TPL = /^\s*<script\b[^>]*id="([^"]+)"[^>]*type="application\/pdf[;-]base64"[^>]*>([^<]*)<\/script>\s*$/;
  const TPL2 = /^\s*<script\b[^>]*type="application\/pdf[;-]base64"[^>]*id="([^"]+)"[^>]*>([^<]*)<\/script>\s*$/;
  for await (const zeile of rl) {
    if (zeile.startsWith('const V159={')) { v159 = JSON.parse(zeile.slice('const V159='.length, -1)); continue; }
    if (zeile.length > 500 && zeile.includes('base64"')) {
      const m = TPL.exec(zeile) || TPL2.exec(zeile);
      if (m) vorlagen.set(m[1], m[2].trim());
    }
  }
  if (!v159) { console.error('V159 nicht gefunden'); process.exit(1); }

  /* Registry-Sicht nachbilden: etablierte Eintraege + V159-Merge (vereinfachte Merge-Logik:
     V159.pdfTemplates ueberschreibt; etablierte elementIds ergaenzen, wo V159 keine traegt). */
  const ETABLIERT = {
    citizen_benefit_initial: 'tpl_ha', citizen_benefit_continuation: 'tpl_wba',
    child_benefit_application: 'tpl_kg1', child_benefit_child_annex: 'tpl_kgan',
    child_benefit_diversion: 'tpl_kg11e', pension_application: 'tpl_drv_r0100'
  };
  const berichte = [];
  let gesamtFehl = 0, gesamtTyp = 0, geprueft = 0;
  for (const [id, cfg] of Object.entries(v159.pdfTemplates)) {
    const modus = cfg.mode;
    if (!cfg.ready || (modus !== 'auto-acro' && modus !== 'acroform')) continue;
    const elementId = cfg.elementId || ETABLIERT[id];
    const b64 = vorlagen.get(elementId);
    if (!b64) { berichte.push({ id, FEHLER: 'Vorlage fehlt: ' + elementId }); continue; }
    let pdf;
    try { pdf = await PDFDocument.load(Buffer.from(b64, 'base64'), { ignoreEncryption: true }); }
    catch (e) { berichte.push({ id, FEHLER: 'PDF laedt nicht: ' + e.message.slice(0, 60) }); continue; }
    const imPdf = new Map();
    for (const feld of pdf.getForm().getFields()) imPdf.set(feld.getName(), feld.constructor.name);
    const mappings = v159.pdfFields[id] || [];
    const fehlend = [], typKonflikt = [];
    for (const eintrag of mappings) {
      if (eintrag.pdfType === '/Tbl') {
        const erste = eintrag.tabelle && eintrag.tabelle.spalten && eintrag.tabelle.spalten[0];
        if (!erste || !imPdf.has(eintrag.name + '__r0__' + erste)) fehlend.push(eintrag.name + ' (Tabelle)');
        continue;
      }
      const typ = imPdf.get(eintrag.name);
      if (typ === undefined) { fehlend.push(eintrag.name); continue; }
      const erwartet = eintrag.pdfType === '/Tx' ? ['PDFTextField'] : eintrag.pdfType === '/Ch' ? ['PDFDropdown', 'PDFOptionList'] : eintrag.pdfType === '/Sig' ? ['PDFSignature'] : ['PDFCheckBox', 'PDFRadioGroup', 'PDFButton'];
      if (!erwartet.includes(typ)) typKonflikt.push(eintrag.name + ' (' + eintrag.pdfType + ' vs ' + typ + ')');
    }
    geprueft++;
    gesamtFehl += fehlend.length; gesamtTyp += typKonflikt.length;
    berichte.push({ id, mappings: mappings.length, pdfFelder: imPdf.size, fehlend: fehlend.length, typKonflikte: typKonflikt.length,
      fehlBsp: fehlend.slice(0, 4), typBsp: typKonflikt.slice(0, 3) });
  }
  berichte.sort((a, b) => ((b.fehlend || 99) + (b.typKonflikte || 0)) - ((a.fehlend || 0) + (a.typKonflikte || 0)));
  for (const b of berichte) {
    if (b.FEHLER) { console.log('!! ' + b.id + ': ' + b.FEHLER); continue; }
    const marke = (b.fehlend || b.typKonflikte) ? '!! ' : 'ok ';
    console.log(marke + b.id + ': ' + b.mappings + ' Mappings auf ' + b.pdfFelder + ' PDF-Felder' +
      (b.fehlend ? ', FEHLEND: ' + b.fehlend + ' ' + JSON.stringify(b.fehlBsp) : '') +
      (b.typKonflikte ? ', TYP: ' + b.typKonflikte + ' ' + JSON.stringify(b.typBsp) : ''));
  }
  console.log('---');
  console.log('Geprueft: ' + geprueft + ' Dokumente | fehlende Felder gesamt: ' + gesamtFehl + ' | Typkonflikte gesamt: ' + gesamtTyp);
})().catch(e => { console.error(e); process.exit(1); });
