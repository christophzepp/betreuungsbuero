#!/usr/bin/env node
'use strict';
/* Legt eine eingebettete Original-PDF als Datei ab, damit sie vermessen werden kann.
   Aufruf: vorlage-ausbauen.js <dokument-id> [ziel.pdf] */
const fs = require('node:fs');
const path = require('node:path');
const APP = path.join(__dirname, '..', '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const id = process.argv[2];
const ziel = process.argv[3] || `/tmp/${id}.pdf`;
const html = fs.readFileSync(APP, 'utf8');
const treffer = html.match(new RegExp(`<script id="tpl_v159_${id}"[^>]*>([A-Za-z0-9+/=\\s]+?)</script>`));
if (!treffer) throw new Error(`Kein eingebetteter Vorlagenblock fuer ${id}.`);
const bytes = Buffer.from(treffer[1].replace(/\s/g, ''), 'base64');
if (bytes.slice(0, 5).toString('latin1') !== '%PDF-') throw new Error('Nutzlast ist keine PDF-Datei.');
fs.writeFileSync(ziel, bytes);
console.log(`${id}: ${Math.round(bytes.length / 1024)} KB -> ${ziel}`);
