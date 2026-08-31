#!/usr/bin/env node
/* Konvertiert eine vorhandene OFFICIAL_COORDINATE_MAPS-Karte (PDF-Punkte, Ursprung unten
   links, y=Text-BASELINE) automatisch in eine Werkzeug-Rechteckkarte (Bildpixel@1240,
   linke obere Ecke) - PDF-Umbauplan Phase 3, Kindergeld-Altlasten.
   - text-Specs  -> Textfelder (maxLines>1 -> multiline; charStep vorerst als normales
     Textfeld, Comb-Feintuning gehoert in die Sichtpruefung)
   - checks      -> RadioGroups mit den Optionstexten an den 12x12-Kaestchen
   Aufruf: node koordinaten-konvertieren.js child_benefit_diversion tpl_kg11e */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { PDFDocument } = require('pdf-lib');

const HTML = '/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html';
const reportId = process.argv[2];
const elementId = process.argv[3];
/* Optionale Anhebung in pt: Formulare mit Beschriftung UNTER der Schreiblinie (Familienkasse
   KG1/AnK) brauchen die Werte etwas hoeher, sonst ueberdecken sie die Labels. */
const ANHEBUNG_PT = Number(process.argv[4] || 0);
if (!reportId || !elementId) { console.error('Aufruf: node koordinaten-konvertieren.js <reportId> <elementId>'); process.exit(1); }

const html = fs.readFileSync(HTML, 'utf8');

/* Das Objekt-Literal der Karte aus OFFICIAL_COORDINATE_MAPS herausschneiden und isoliert
   auswerten (beginnt mit "  <reportId>:{" innerhalb des Registrierungs-Literals). */
const start = html.indexOf('const OFFICIAL_COORDINATE_MAPS={');
if (start < 0) { console.error('OFFICIAL_COORDINATE_MAPS nicht gefunden'); process.exit(1); }
const ende = html.indexOf('};', start);
const literal = html.slice(start + 'const OFFICIAL_COORDINATE_MAPS='.length, ende + 1);
const karten = vm.runInNewContext('(' + literal + ')', {});
const quelle = karten[reportId];
if (!quelle) { console.error('Keine Koordinatenkarte für', reportId); process.exit(1); }

(async () => {
  const m = new RegExp('<script[^>]*id="' + elementId + '"[^>]*>([^<]*)</script>').exec(html);
  const pdf = await PDFDocument.load(Buffer.from(m[1].trim(), 'base64'), { ignoreEncryption: true });
  const BILD_BREITE = 1240;

  const felder = {};
  const px = (pt) => pt * BILD_BREITE / 595.28; /* je Seite unten mit echter Breite überschrieben */

  function nachPx(seite, xPt, yObenPt, breitePt, hoehePt) {
    const b = pdf.getPage(seite).getWidth();
    const h = pdf.getPage(seite).getHeight();
    const s = BILD_BREITE / b;
    return {
      x: Math.round(xPt * s),
      y: Math.round((h - yObenPt) * s),
      width: Math.round(breitePt * s),
      height: Math.round(hoehePt * s)
    };
  }

  for (const [feldId, spec] of Object.entries(quelle.text || {})) {
    const size = spec.size || 9;
    const zeilen = spec.maxLines || 1;
    const hoehePt = zeilen > 1 ? zeilen * (spec.lineHeight || size + 1) + 4 : size + 7;
    /* spec.y = Baseline der (ersten) Zeile -> Boxoberkante = Baseline + Versalhoehe + Luft */
    const obenPt = spec.y + size + 2 + ANHEBUNG_PT;
    const r = nachPx(spec.page, spec.x, obenPt, spec.width || 150, hoehePt);
    felder[feldId] = Object.assign({ page: spec.page, typ: 'text', groesse: size }, r);
    if (zeilen > 1) felder[feldId].multiline = true;
    if (spec.transform) felder[feldId].transform = spec.transform;
  }
  for (const [feldId, optionen] of Object.entries(quelle.checks || {})) {
    const erste = Object.values(optionen)[0];
    const eintrag = { page: erste.page, typ: 'radio', x: 0, y: 0, width: 24, height: 24, optionen: {} };
    for (const [wert, pos] of Object.entries(optionen)) {
      /* drawCoordinateCheck: x/y = linke UNTERE Ecke eines ~12x12-Kaestchens */
      const r = nachPx(pos.page, pos.x, pos.y + 12, 12, 12);
      eintrag.optionen[wert] = { x: r.x, y: r.y, width: r.width, height: r.height, page: pos.page };
    }
    felder[feldId] = eintrag;
  }
  for (const [feldId, tab] of Object.entries(quelle.tables || {})) {
    /* Tabellen: je Zeile (rowY = Text-Baseline) x Spalte eine Zelle; die Praegeung erzeugt
       daraus Textfelder feldId__rN__spalte, die Laufzeit verteilt das officialTable-Array. */
    const groesse = 8;
    const spalten = {};
    for (const [key, sp] of Object.entries(tab.columns || {})) {
      const r = nachPx(tab.page, sp.x, groesse, sp.width || 100, 1);
      spalten[key] = { x: r.x, width: r.width, groesse: sp.size || groesse };
      if (sp.transform) spalten[key].transform = sp.transform;
    }
    const zeilen = (tab.rowY || []).map(yBase => nachPx(tab.page, 0, yBase + groesse + 2 + ANHEBUNG_PT, 1, groesse + 7));
    felder[feldId] = {
      page: tab.page, typ: 'tabelle',
      x: 0, y: zeilen.length ? zeilen[0].y : 0, width: 10, height: 10,
      zeilenY: zeilen.map(z => z.y), zeilenHoehe: zeilen.length ? zeilen[0].height : 30,
      spalten
    };
  }

  const karte = {
    elementId, reportId,
    einheit: 'px', bildBreite: BILD_BREITE,
    seitenBreitePt: pdf.getPage(0).getWidth(), seitenHoehePt: pdf.getPage(0).getHeight(),
    hinweis: 'Automatisch konvertiert aus OFFICIAL_COORDINATE_MAPS.' + reportId + ' (koordinaten-konvertieren.js); Sichtpruefung über Probe-Render erforderlich.',
    felder
  };
  const ziel = path.join(__dirname, 'karten', reportId + '.json');
  fs.writeFileSync(ziel, JSON.stringify(karte, null, 2));
  console.log('Karte geschrieben:', ziel, '(' + Object.keys(felder).length + ' Felder: ' +
    Object.values(felder).filter(f => f.typ === 'text').length + ' Text, ' +
    Object.values(felder).filter(f => f.typ === 'radio').length + ' Optionsgruppen)');
})().catch(e => { console.error(e); process.exit(1); });
