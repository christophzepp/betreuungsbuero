#!/usr/bin/env node
'use strict';
/* Messblatt fuer die Koordinatenkarten: listet je Seite die Ausfuelllinien (Unterstrich-Ketten),
   die Ankreuzkaestchen ([ ]) und die Beschriftungen mit ihrer Position im PDF-Koordinatensystem
   (Ursprung unten links, y = Grundlinie). Genau diese Werte gehen in OFFICIAL_COORDINATE_MAPS.

   Aufruf: pdf-messblatt.js <pdf> [seite] */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function entpacke(text) {
  if (text.length >= 2 && text.length % 2 === 0) {
    let nullen = 0;
    for (let i = 0; i < text.length; i += 2) if (text.charCodeAt(i) === 0) nullen++;
    if (nullen === text.length / 2) {
      let s = '';
      for (let i = 1; i < text.length; i += 2) s += text[i];
      return s;
    }
  }
  return text;
}
const WORTPROBE = /\b(der|die|das|und|des|dem|den|nicht|habe|ich|bei|am|im|von|zu|Name|Vorname|Anschrift|Datum|Betreuung|Betreute|Betreuer|Gericht|Ort|Seite)\b/g;
function versatzRaten(texte) {
  const probe = texte.map(entpacke).join('').slice(0, 6000);
  let bester = 0, bestePunkte = -1;
  for (let v = -60; v <= 60; v++) {
    const um = [...probe].map((c) => String.fromCharCode(c.charCodeAt(0) + v)).join('');
    /* Ganze Woerter entscheiden, Buchstabenketten sind nur der Stichentscheid: ein falscher
       Versatz kann mehr Kleinbuchstaben erzeugen als der richtige (Ziffern und Satzzeichen
       rutschen dann in den Bereich a-z), trifft aber kein einziges deutsches Wort. */
    const punkte = 1e6 * (um.match(WORTPROBE) || []).length + (um.match(/[a-zäöüß]{2,}/g) || []).join('').length;
    if (punkte > bestePunkte) { bestePunkte = punkte; bester = v; }
  }
  return bester;
}

const datei = process.argv[2];
const nurSeite = process.argv[3] ? Number(process.argv[3]) : null;
const tmp = path.join('/tmp', 'linien-' + process.pid + '.json');
const lauf = spawnSync(process.execPath, [path.join(__dirname, 'pdf-textlage.js'), datei, tmp], { encoding: 'utf8' });
if (lauf.status !== 0) throw new Error(lauf.stderr || 'Textauszug fehlgeschlagen');
const daten = JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);
const versatz = versatzRaten(daten.flatMap((s) => s.stuecke.map((t) => t.text)));
/* Ein Versatz gilt als gesichert, wenn er ganze deutsche Woerter erzeugt. Sonst bleibt der Text
   unleserlich und es werden nur noch geometrische Merkmale gemeldet. */
const versatzSicher = versatz !== -60;

console.log(`### ${path.basename(datei)}   Versatz ${versatz >= 0 ? '+' : ''}${versatz}   (y = Grundlinie im PDF, Ursprung unten links)`);
for (const seite of daten) {
  if (nurSeite && seite.seite !== nurSeite) continue;
  console.log(`\n--- Seite ${seite.seite} (Index ${seite.seite - 1})  ${seite.breite}x${seite.hoehe}`);
  /* Zeichen zu Zeilen buendeln und je Zeile in Laeufe zerlegen. */
  const zeilen = new Map();
  for (const s of seite.stuecke) {
    const y = Math.round(s.y * 10) / 10;
    if (!zeilen.has(y)) zeilen.set(y, []);
    zeilen.get(y).push({ ...s, text: [...entpacke(s.text)].map((c) => String.fromCharCode(c.charCodeAt(0) + versatz)).join('') });
  }
  for (const y of [...zeilen.keys()].sort((a, b) => b - a)) {
    const teile = zeilen.get(y).sort((a, b) => a.x - b.x);
    const laeufe = [];
    let akt = null;
    for (const t of teile) {
      const breite = (t.size || 10) * 0.6 * Math.max(1, t.text.length);
      if (akt && t.x - akt.ende < (t.size || 10) * 0.55) { akt.text += t.text; akt.ende = t.x + breite; }
      else { if (akt) laeufe.push(akt); akt = { x: t.x, ende: t.x + breite, size: t.size, text: t.text }; }
    }
    if (akt) laeufe.push(akt);

    /* Kaestchen und Ausfuelllinien aus den einzelnen Textstuecken lesen, nicht aus den zu Woertern
       zusammengefassten Laeufen: die Vordrucke setzen die Klammern als eigene Stuecke, deshalb ist
       die Position exakt. Aus zusammengefassten Laeufen geschaetzte Werte lagen bis zu 50 Punkte
       daneben. Das schliessende ']' steht immer allein; die Kaestchenbreite ist konstant. */
    const KASTEN = 9;
    const befunde = [];
    teile.forEach((t, i) => {
      /* Zeichenbreite je Stueck aus dem Abstand zum naechsten Stueck ableiten - deutlich genauer
         als eine Schaetzung ueber den ganzen zusammengefassten Lauf. */
      const naechstes = teile[i + 1];
      const spanne = naechstes && naechstes.x > t.x ? naechstes.x - t.x : null;
      const breite = spanne && t.text.length ? spanne / t.text.length : (t.size || 10) * 0.5;
      if (t.text === ']') { befunde.push({ x: t.x - KASTEN, art: 'KREUZ' }); return }
      for (const m of t.text.matchAll(/\[\s*\]/g)) {
        befunde.push({ x: t.x + m.index * breite, art: 'KREUZ' });
      }
      /* Klammer am Stueckende: das schliessende ']' folgt als eigenes Stueck, das oben behandelt wird. */
      /* Laesst sich die Kodierung nicht aufloesen, sind Ausfuelllinien immer noch daran zu
         erkennen, dass ein und dasselbe Zeichen vielfach wiederholt wird. */
      /* Die Wiederholeinheit kann ein oder zwei Zeichen umfassen (Zwei-Byte-Kodierung). */
      const linienMuster = versatzSicher ? /_{3,}|\.{6,}/g : /(..)\1{2,}|(.)\2{3,}/g;
      for (const m of t.text.matchAll(linienMuster)) {
        const von = t.x + m.index * breite;
        const bis = (m.index + m[0].length === t.text.length && naechstes && naechstes.x > von)
          ? naechstes.x : von + m[0].length * breite;
        befunde.push({ x: von, bis, art: 'LINIE' });
      }
    });
    for (const l of laeufe) {
      const klar = l.text.replace(/[_.]{3,}/g, ' … ').replace(/\s+/g, ' ').trim();
      if (klar && !/^[…\s]*$/.test(klar)) befunde.unshift({ x: l.x, art: 'TEXT', text: klar.slice(0, 62) });
    }
    const zeile = befunde.map((b) => b.art === 'TEXT'
      ? `"${b.text}" x=${Math.round(b.x * 10) / 10}`
      : b.art === 'KREUZ'
        ? `KREUZ x=${Math.round(b.x * 10) / 10}`
        : `LINIE x=${Math.round(b.x * 10) / 10}..${Math.round(b.bis * 10) / 10} breite=${Math.round((b.bis - b.x) * 10) / 10}`);
    if (zeile.length) console.log(`y=${String(y).padEnd(7)} ${zeile.join('   |   ')}`.slice(0, 245));
  }
}
