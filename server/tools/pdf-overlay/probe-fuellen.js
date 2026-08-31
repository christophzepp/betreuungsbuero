#!/usr/bin/env node
/* Abnahme-Helfer: fuellt die gepraegte Overlay-Vorlage mit Musterdaten (wie es die
   auto-acro-Pipeline zur Laufzeit taete) und schreibt vorlagen/<elementId>.probe.pdf.
   Aufruf: node probe-fuellen.js rent_certificate */
'use strict';
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const reportId = process.argv[2];
const karte = JSON.parse(fs.readFileSync(path.join(__dirname, 'karten', reportId + '.json'), 'utf8'));
const quelle = path.join(__dirname, 'vorlagen', karte.elementId + '.acroform.pdf');

/* Neutralisierte Musterdaten (Echtdaten-Regel der Codebasis beachten).
   Liegt karten/<reportId>.muster.json vor, hat sie Vorrang (Serienfertigung). */
const musterPfad = path.join(__dirname, 'karten', reportId + '.muster.json');
const MUSTER_DATEI = fs.existsSync(musterPfad) ? JSON.parse(fs.readFileSync(musterPfad, 'utf8')) : null;
const MUSTER_STANDARD = {
  rent_certificate_name: 'Bastuck, Franz Josef',
  rent_certificate_property: '56068 Koblenz, Musterstraße 12',
  rent_certificate_basic: '420,00',
  rent_certificate_service: '95,50',
  rent_certificate_heating: '78,00',
  rent_certificate_start: '01.10.2026',
  rent_certificate_size: '54',
  rent_certificate_rooms: '2',
  rent_certificate_landlord: 'Wohnbau Beispiel GmbH, Rheinallee 3, 56068 Koblenz, Tel. 0261 000000'
};
const MUSTER = MUSTER_DATEI || MUSTER_STANDARD;

(async () => {
  const pdf = await PDFDocument.load(fs.readFileSync(quelle), { ignoreEncryption: true });
  const form = pdf.getForm();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [feldId, wert] of Object.entries(MUSTER)) {
    try { form.getTextField(feldId).setText(wert); continue; } catch (_e) {}
    try { form.getRadioGroup(feldId).select(wert); continue; } catch (_e) {}
    try { const cb = form.getCheckBox(feldId); if (wert) cb.check(); continue; } catch (_e) {}
    console.error('Feld fehlt oder Wert passt nicht:', feldId, JSON.stringify(wert));
  }
  form.updateFieldAppearances(helv);
  const bytes = await pdf.save({ useObjectStreams: false });
  const ziel = path.join(__dirname, 'vorlagen', karte.elementId + '.probe.pdf');
  fs.writeFileSync(ziel, bytes);
  console.log('Probe geschrieben:', ziel);
})().catch(e => { console.error(e); process.exit(1); });
