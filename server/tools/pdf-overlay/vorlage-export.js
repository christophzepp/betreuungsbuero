#!/usr/bin/env node
/* Schritt 1 der Overlay-Werkzeugkette (PDF-Umbauplan Phase 3, 13.08.2026):
   extrahiert eine eingebettete Originalvorlage aus der App-HTML als PDF-Datei
   nach vorlagen/<elementId>.pdf (Arbeitsgrundlage fuer die Rechteck-Karte).
   Aufruf: node vorlage-export.js tpl_v159_rent_certificate */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = '/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html';
const elementId = process.argv[2];
if (!elementId) { console.error('Aufruf: node vorlage-export.js <elementId>'); process.exit(1); }

const html = fs.readFileSync(HTML, 'utf8');
const m = new RegExp('<script[^>]*id="' + elementId + '"[^>]*>([^<]*)</script>').exec(html);
if (!m || !m[1].trim()) { console.error('Vorlage nicht gefunden oder leer:', elementId); process.exit(1); }
const ziel = path.join(__dirname, 'vorlagen', elementId + '.pdf');
fs.writeFileSync(ziel, Buffer.from(m[1].trim(), 'base64'));
console.log('Geschrieben:', ziel, '(' + Math.round(fs.statSync(ziel).size / 1024) + ' KB)');
