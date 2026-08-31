#!/usr/bin/env node
'use strict';
/* Vorlagenrunde 23.08.2026: tauscht vier eingebettete Original-PDFs gegen die vom Nutzer
   bereitgestellten Vordrucke des Amtsgerichts Bad Duerkheim aus und nimmt zwei Dokumente neu
   in den Katalog auf (Erweiterung des Aufgabenkreises, Todesmitteilung an das Gericht).

   Der Lauf ist wiederholbar: bereits getauschte Nutzlasten und bereits vorhandene Katalogeintraege
   werden erkannt und uebersprungen. Alle Schreibvorgaenge stehen unter Vorbedingungen; bricht eine
   Pruefung, wird nichts geschrieben.

   Aufruf: node vorlagen-tausch.js [pfad/zur/app.html] */

const fs = require('node:fs');
const path = require('node:path');

const WERKZEUG = __dirname;
const PLAN = JSON.parse(fs.readFileSync(path.join(WERKZEUG, 'vorlagen-tausch.json'), 'utf8'));
const APP = process.argv[2] || path.join(WERKZEUG, '..', '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const QUELLEN = path.join(WERKZEUG, PLAN.quellordner);

/* ---------- Hilfen ---------- */
function pdfAlsBase64(datei) {
  const bytes = fs.readFileSync(path.join(QUELLEN, datei));
  if (bytes.slice(0, 5).toString('latin1') !== '%PDF-') throw new Error(`${datei} ist keine PDF-Datei.`);
  const b64 = bytes.toString('base64');
  if (/<\/?script/i.test(b64)) throw new Error(`${datei} erzeugt eine Zeichenfolge, die den Block beenden wuerde.`);
  return b64;
}
function zaehleScripts(html) {
  return (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).length;
}

/* ---------- App laden ---------- */
let html = fs.readFileSync(APP, 'utf8');
const groesseVorher = html.length;
const scriptsVorher = zaehleScripts(html);
const meldungen = [];
let neueBloecke = 0;

/* ---------- V159-Zeile lesen ---------- */
const v159Start = html.indexOf('const V159={');
if (v159Start < 0) throw new Error('Der V159-Katalog wurde nicht gefunden.');
const v159Ende = html.indexOf(';\n', v159Start);
if (v159Ende < 0) throw new Error('Das Ende der V159-Zeile wurde nicht gefunden.');
const v159Roh = html.slice(v159Start + 'const V159='.length, v159Ende);
const V159 = JSON.parse(v159Roh);
if (!Array.isArray(V159.catalog)) throw new Error('V159.catalog fehlt.');
const katalogVorher = V159.catalog.length;
if (![80, 82, 83].includes(katalogVorher)) {
  throw new Error(`Der Katalog hat ${katalogVorher} Eintraege; erwartet werden 80, 82 oder 83.`);
}

/* ---------- 1) Vier Nutzlasten austauschen ---------- */
for (const [id, plan] of Object.entries(PLAN.ersetzen)) {
  const eintrag = V159.catalog.find((x) => x.id === id);
  const vorlage = V159.pdfTemplates[id];
  if (!eintrag || !vorlage) throw new Error(`Dokument ${id} fehlt im Katalog oder in den Vorlagen.`);

  const b64 = pdfAlsBase64(plan.datei);
  const marke = new RegExp(`(<script id="${vorlage.elementId}"[^>]*>)([A-Za-z0-9+/=\\s]*?)(</script>)`);
  const treffer = html.match(marke);
  if (!treffer) throw new Error(`Der Vorlagenblock ${vorlage.elementId} wurde nicht gefunden.`);
  if (treffer[2].trim() === b64) {
    meldungen.push(`  unveraendert  ${id} (Nutzlast steht bereits)`);
  } else {
    const alteGroesse = Math.round(treffer[2].trim().length * 3 / 4 / 1024);
    html = html.replace(marke, `$1${b64}$3`);
    meldungen.push(`  getauscht     ${id}: ${alteGroesse} KB -> ${Math.round(b64.length * 3 / 4 / 1024)} KB  (${plan.datei})`);
  }
  Object.assign(eintrag, plan.katalog);
  Object.assign(vorlage, plan.vorlage);
}

/* ---------- 2) Zwei Dokumente neu aufnehmen ---------- */
for (const neu of PLAN.neu) {
  const b64 = pdfAlsBase64(neu.datei);
  const blockId = neu.vorlage.elementId;

  if (!html.includes(`id="${blockId}"`)) {
    /* Den neuen Datenblock hinter den letzten vorhandenen Vorlagenblock haengen, damit alle
       eingebetteten PDFs beieinander stehen. */
    const letzte = [...html.matchAll(/<script id="tpl_[a-z0-9_]+"[^>]*>[\s\S]*?<\/script>/gi)].pop();
    if (!letzte) throw new Error('Es wurde kein vorhandener Vorlagenblock gefunden.');
    const einfuegen = letzte.index + letzte[0].length;
    const block = `\n<script id="${blockId}" type="application/pdf-base64">${b64}</script>`;
    html = html.slice(0, einfuegen) + block + html.slice(einfuegen);
    neueBloecke++;
    meldungen.push(`  neu           ${neu.id}: Datenblock ${blockId} (${Math.round(b64.length * 3 / 4 / 1024)} KB)`);
  } else {
    const marke = new RegExp(`(<script id="${blockId}"[^>]*>)([A-Za-z0-9+/=\\s]*?)(</script>)`);
    html = html.replace(marke, `$1${b64}$3`);
    meldungen.push(`  unveraendert  ${neu.id} (Datenblock steht bereits)`);
  }

  /* Katalogeintrag an die gewuenschte Stelle setzen. */
  const vorhanden = V159.catalog.findIndex((x) => x.id === neu.id);
  if (vorhanden >= 0) {
    Object.assign(V159.catalog[vorhanden], neu.katalog);
  } else {
    const nach = V159.catalog.findIndex((x) => x.id === neu.nachId);
    if (nach < 0) throw new Error(`Der Bezugspunkt ${neu.nachId} fehlt im Katalog.`);
    V159.catalog.splice(nach + 1, 0, neu.katalog);
    meldungen.push(`                Katalogeintrag hinter ${neu.nachId} eingefuegt`);
  }
  V159.pdfTemplates[neu.id] = Object.assign(V159.pdfTemplates[neu.id] || {}, neu.vorlage);
  V159.flatSchemas[neu.id] = neu.schema;
}

/* ---------- 2b) Titel schaerfen ---------- */
for (const [id, plan] of Object.entries(PLAN.umbenennen || {})) {
  const eintrag = V159.catalog.find((x) => x.id === id);
  if (!eintrag) throw new Error(`Umbenennung: ${id} steht nicht im Katalog.`);
  if (eintrag.title === plan.title) { meldungen.push(`  unveraendert  ${id} (Titel steht bereits)`); continue }
  meldungen.push(`  umbenannt     ${id}: "${eintrag.title}" -> "${plan.title}"`);
  eintrag.title = plan.title;
}

/* ---------- 3) V159-Zeile zurueckschreiben ---------- */
const v159NeuRoh = JSON.stringify(V159);
if (/<\/?script/i.test(v159NeuRoh)) throw new Error('Die neue V159-Zeile enthaelt eine Zeichenfolge, die den Block beenden wuerde.');
JSON.parse(v159NeuRoh);
/* Die Nutzlast-Tausche oben haben die Datei verschoben; die Zeilengrenzen muessen deshalb im
   aktuellen Stand neu bestimmt werden statt aus den Offsets vom Einlesen. */
const jetztStart = html.indexOf('const V159={');
const jetztEnde = html.indexOf(';\n', jetztStart);
if (jetztStart < 0 || jetztEnde < 0) throw new Error('Die V159-Zeile wurde beim Zurueckschreiben nicht wiedergefunden.');
html = html.slice(0, jetztStart + 'const V159='.length) + v159NeuRoh + html.slice(jetztEnde);
meldungen.push(`  Katalog       ${katalogVorher} -> ${V159.catalog.length} Eintraege`);

/* ---------- 4) Seitenleisten-Kuerzel ergaenzen ---------- */
for (const neu of PLAN.neu) {
  if (html.includes(`${neu.id}:'${neu.kuerzel}'`)) continue;
  const anker = 'const V159_DOCUMENT_ABBREVIATIONS={\n';
  if (!html.includes(anker)) throw new Error('Die Kuerzelliste wurde nicht gefunden.');
  html = html.replace(anker, `${anker}  ${neu.id}:'${neu.kuerzel}',\n`);
  meldungen.push(`  Kuerzel       ${neu.id} -> ${neu.kuerzel}`);
}

/* ---------- 5) Schlusspruefungen ---------- */
const scriptsNachher = zaehleScripts(html);
if (scriptsNachher !== scriptsVorher + neueBloecke) {
  throw new Error(`Blockzahl ${scriptsVorher} -> ${scriptsNachher}, erwartet ${scriptsVorher + neueBloecke}.`);
}
for (const neu of PLAN.neu) {
  if (!V159.catalog.some((x) => x.id === neu.id)) throw new Error(`${neu.id} fehlt im Katalog.`);
  if (!html.includes(`id="${neu.vorlage.elementId}"`)) throw new Error(`${neu.id}: Datenblock fehlt.`);
}

fs.writeFileSync(APP, html);
console.log(meldungen.join('\n'));
console.log(`  Bloecke       ${scriptsVorher} -> ${scriptsNachher}`);
console.log(`  Dateigroesse  ${(groesseVorher / 1048576).toFixed(2)} MB -> ${(html.length / 1048576).toFixed(2)} MB`);
