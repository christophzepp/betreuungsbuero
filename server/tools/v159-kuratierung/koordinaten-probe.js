#!/usr/bin/env node
'use strict';
/* Sichtprobe der Koordinatenkarten: schreibt Musterwerte an alle zugeordneten Positionen der
   Originalvorlage und legt das Ergebnis als PDF ab. Bildet drawCoordinateText/-Check der App nach.
   Aufruf: koordinaten-probe.js <dokument-id> <ziel.pdf> */
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');

const WERKZEUG = __dirname;
const KARTEN = JSON.parse(fs.readFileSync(path.join(WERKZEUG, 'koordinaten-karten.json'), 'utf8'));
const PLAN = JSON.parse(fs.readFileSync(path.join(WERKZEUG, 'vorlagen-tausch.json'), 'utf8'));

const id = process.argv[2];
const ziel = process.argv[3];
const karte = KARTEN[id];
if (!karte) throw new Error(`Keine Karte fuer ${id}.`);
const quelle = PLAN.neu.find((n) => n.id === id)
  || (PLAN.ersetzen[id] ? { id, datei: PLAN.ersetzen[id].datei, schema: null } : null)
  || (PLAN.probevorlagen && PLAN.probevorlagen[id] ? { id, datei: PLAN.probevorlagen[id], schema: null } : null);
if (!quelle) throw new Error(`${id} steht nicht in vorlagen-tausch.json.`);

/* Musterwerte je Feldtyp aus dem Schema ableiten, damit jede Position sichtbar wird. Getauschte
   Dokumente bringen ihr Schema aus der App mit; dort genuegt die Ableitung aus dem Feldnamen. */
const felder = new Map();
if (quelle.schema) for (const abschnitt of quelle.schema.sections) for (const f of abschnitt.fields) felder.set(f.id, f);
const STAMMPROBE = {
  betreuerName: 'Betreuungsbüro Zepp', betreuerAnschrift: 'Rheinstraße 12, 55116 Mainz',
  betreuerTelefon: '06131 1234567 / Fax 06131 1234568',
  betreuerStrasse: 'Rheinstraße 12', betreuerPlzOrt: '55116 Mainz',
  gerichtName: 'Amtsgericht Bad Dürkheim', gerichtOrt: 'Bad Dürkheim', gerichtStrasse: 'Postfach 1564', gerichtPlzOrt: '67089 Bad Dürkheim',
  aktenzeichen: 'XVII 412/24', personName: 'Mustermann, Erika Charlotte',
  personGeburtsdatum: '14.03.1941', personAnschrift: 'Rheinstraße 128a, 67098 Bad Dürkheim',
  ortDatum: 'Mainz, 24.08.2026', datum: '24.08.2026', uebernahmeDatum: '01.02.2024'
};
function muster(feldId) {
  if (feldId.startsWith('stamm.')) return STAMMPROBE[feldId.slice(6)] || 'STAMMWERT';
  const f = felder.get(feldId);
  if ((f && f.type === 'date') || /_date$|datum/i.test(feldId)) return '01.03.2026';
  if (/name/.test(feldId)) return 'Mustermann, Erika Charlotte';
  if (/address/.test(feldId)) return 'Rheinstraße 128a, 67098 Bad Dürkheim';
  if (/reference/.test(feldId)) return 'XVII 412/24';
  if (/months|years/.test(feldId)) return '18';
  if (/doctor/.test(feldId)) return 'Dr. med. Sabine Hoffmann-Wirtz';
  if (/extra/.test(feldId)) return 'die Vertretung gegenüber Vermietern';
  if (/recipient/.test(feldId)) return 'Amtsgericht Bad Dürkheim, Postfach 1564, 67089 Bad Dürkheim';
  if (/reason|changes|heirs/.test(feldId)) return 'Beispieltext für die vorgesehene Zeile des Vordrucks, der die Breite ausreizt.';
  return 'Mustertext';
}

(async () => {
  const pdf = await PDFDocument.load(fs.readFileSync(path.join(WERKZEUG, PLAN.quellordner, quelle.datei)),
    { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const seiten = pdf.getPages();

  for (const [feldId, spec] of Object.entries(karte.text || {})) {
    const seite = seiten[spec.page];
    let groesse = spec.size || 9;
    const text = muster(feldId);
    while (groesse > 5.5 && font.widthOfTextAtSize(text, groesse) > (spec.width || 150)) groesse -= 0.25;
    seite.drawText(text, { x: spec.x, y: spec.y, size: groesse, font, color: rgb(0, 0, 0.75) });
    seite.drawRectangle({ x: spec.x, y: spec.y - 2, width: spec.width || 150, height: groesse + 4,
      borderColor: rgb(1, 0, 0), borderWidth: 0.4 });
  }
  for (const [feldId, auswahl] of Object.entries(karte.checks || {})) {
    for (const [wert, spec] of Object.entries(auswahl)) {
      if (!spec) continue;
      const seite = seiten[spec.page];
      seite.drawText('X', { x: spec.x + 1.5, y: spec.y + 1.2, size: 8.5, font, color: rgb(0, 0, 0.75) });
      seite.drawRectangle({ x: spec.x, y: spec.y, width: 12, height: 12, borderColor: rgb(1, 0, 0), borderWidth: 0.4 });
      seite.drawText(String(wert).slice(0, 28), { x: spec.x + 14, y: spec.y + 3, size: 4, font, color: rgb(1, 0, 0) });
    }
  }
  /* Tabellen: je Zeile Musterwerte an die zugeordnete Position schreiben. */
  for (const [feldId, tabelle] of Object.entries(karte.tables || {})) {
    const ziele = tabelle.zeilen
      ? Object.entries(tabelle.zeilen).map(([bez, pos]) => [bez, pos.y])
      : (tabelle.rowY || []).map((y, i) => [`Zeile ${i + 1}`, y]);
    for (const [bez, y] of ziele) {
      const seite = seiten[tabelle.page];
      const zeilenSpec = tabelle.zeilen ? tabelle.zeilen[bez] : null;
      const abweichung = (zeilenSpec && zeilenSpec.spalten) || {};
      for (const [spalte, grund] of Object.entries(tabelle.columns || {})) {
        if (abweichung[spalte] === false) continue;
        const spec = { ...grund, ...(abweichung[spalte] || {}) };
        const text = /amount|betrag/i.test(spalte) ? '1.234,56'
          : /provider|institution/i.test(spalte) ? 'Sparkasse Musterstadt'
            : bez === '*' ? 'freie Zeile' : bez;
        let groesse = spec.size || 9;
        while (groesse > 5.5 && font.widthOfTextAtSize(text, groesse) > (spec.width || 150)) groesse -= 0.25;
        seite.drawText(text, { x: spec.x, y, size: groesse, font, color: rgb(0, 0.45, 0) });
        seite.drawRectangle({ x: spec.x, y: y - 2, width: spec.width || 150, height: groesse + 4,
          borderColor: rgb(0, 0.6, 0), borderWidth: 0.35 });
      }
    }
    console.log(`   Tabelle ${feldId}: ${ziele.length} Zeilen`);
  }

  fs.writeFileSync(ziel, await pdf.save({ useObjectStreams: false }));
  const anzahl = Object.keys(karte.text || {}).length
    + Object.values(karte.checks || {}).reduce((n, o) => n + Object.keys(o).length, 0);
  console.log(`${id}: ${anzahl} Positionen geschrieben -> ${ziel}`);
})();
