'use strict';

/* Nutzerwunsch 26.08.2026: Eine JSON-Datensicherung muss ALLEIN zum Einlesen eines Falls reichen.

   Vorbefund: Alle vier Online-Importwege verlangten zwingend Stammdaten- UND Adressverzeichnis-
   Excel; die JSON zaehlte nur als Zugabe. Wer eine Fallsicherung hatte (genau das Format, das
   der Fall-Export und die Gesamtsicherung ausgeben), musste sie erst durch den Lokalmodus
   schleusen. Ein Ordner mit mehreren JSON-Dateien wurde mit "keine Fall-Unterordner gefunden"
   abgewiesen - obwohl der Fall-Export sie genau so ablegt.

   Geprueft wird die gemeinsame Regel AUSGEFUEHRT, nicht nur gegrept. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

function schnitt(von, bis, wieso) {
  const a = html.indexOf(von);
  const b = html.indexOf(bis, a + von.length);
  assert.ok(a > 0 && b > a, `${wieso}: nicht auffindbar`);
  return html.slice(a, b);
}

test('Die Quellenregel: JSON allein genuegt, Excel-Paar genuegt, halbe Sachen nicht', () => {
  const code = schnitt('function fallQuelleReicht(erg){', 'const FALL_QUELLE_FEHLT=', 'Regel');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${code}\nthis.f=fallQuelleReicht;`, ctx, { filename: 'regel.js' });
  const reicht = ctx.f;

  /* Der neue Fall - und der Kern des Nutzerwunsches. */
  assert.equal(reicht({ jsonImported: true, hasMaster: false, hasAddress: false }), true,
    'JSON allein wird weiterhin abgewiesen');
  /* Der bisherige Weg bleibt unveraendert gueltig. */
  assert.equal(reicht({ jsonImported: false, hasMaster: true, hasAddress: true }), true,
    'das Excel-Paar wurde kaputtgemacht');
  /* Halbe Excel-Quellen bleiben abgewiesen - sonst entstuende ein halber Fall. */
  assert.equal(reicht({ hasMaster: true, hasAddress: false }), false, 'Adressverzeichnis fehlt und wird durchgelassen');
  assert.equal(reicht({ hasMaster: false, hasAddress: true }), false, 'Stammdaten fehlen und werden durchgelassen');
  assert.equal(reicht({}), false, 'leere Quelle wird durchgelassen');
  assert.equal(reicht(null), false, 'null wird durchgelassen');
});

test('Alle vier Importwege benutzen dieselbe Regel', () => {
  /* Frueher stand an jeder Stelle ein eigenes !hasMaster||!hasAddress - genau so entstehen
     Wege, die auseinanderlaufen. */
  const treffer = (html.match(/fallQuelleReicht\(/g) || []).length;
  assert.ok(treffer >= 5, `Regel nur ${treffer}x verwendet - ein Importweg wurde vergessen`);
  assert.ok(!/if\(!hasMaster\|\|!hasAddress\)/.test(html),
    'es gibt noch ein altes Tor, das das Excel-Paar erzwingt');
  /* Die Fehlermeldung nennt beide gueltigen Quellen. */
  assert.match(html, /FALL_QUELLE_FEHLT='[^']*JSON-Datensicherung[^']*Stammdaten[^']*'/,
    'die Fehlermeldung erklaert die zulaessigen Quellen nicht');
});

test('Mehrfallimport: ein Ordner voller JSON-Dateien wird erkannt (ausgefuehrt)', async () => {
  const code = schnitt('async function migrateJsonDateien(reader,namen){',
    '\n  async function migrateMultiCaseFromFolder(){', 'JSON-Mehrfachleser');

  const angelegt = [];
  const meldungen = [];
  const ctx = {
    File: class { constructor(teile, name, opt) { this.teile = teile; this.name = name; this.type = (opt || {}).type; } },
    console,
    freshMigrationState: () => {},
    toast: (t) => meldungen.push(t),
    /* Die JSON traegt den Fall - der Zustand entsteht daraus. */
    importProject: async (datei) => {
      if (/kaputt/.test(datei.name)) return false;
      ctx.state = { caseData: { person: { lastName: 'Auerbach', firstName: 'Margarete' }, care: { fileNumber: '7 XVII 214/19' } } };
      return true;
    },
    migrationDefaultsFromState: () => ({
      lastName: ctx.state?.caseData?.person?.lastName || '',
      firstName: ctx.state?.caseData?.person?.firstName || '',
    }),
    migrateCurrentStateAsServerCase: async (label) => { angelegt.push(label); return 'fall-' + angelegt.length; },
    state: {},
  };
  vm.createContext(ctx);
  vm.runInContext(`${code}\nthis.f=migrateJsonDateien;`, ctx, { filename: 'jsonmehrfach.js' });

  const reader = {
    read: async (n) => new Uint8Array([1, 2, 3]),
    fileFor: () => ({ lastModified: 1700000000000 }),
  };
  const erg = await ctx.f(reader, ['ordner/Auerbach.json', 'ordner/kaputt.json', 'ordner/Zweiter.json']);

  assert.equal(erg.fertig, 2, 'nicht alle lesbaren JSON-Dateien wurden eingelesen');
  assert.equal(erg.gesamt, 3);
  /* Die Bezeichnung kommt aus den Stammdaten, nicht aus dem Dateinamen. */
  assert.deepEqual(Array.from(angelegt), ['Auerbach, Margarete', 'Auerbach, Margarete'],
    'die Fallbezeichnung wird nicht aus den eingelesenen Stammdaten gebildet');
  /* Eine Datei, die keine Fallsicherung ist, wird benannt und uebersprungen - nicht still. */
  assert.equal(erg.hinweise.length, 1);
  assert.match(erg.hinweise[0], /kaputt\.json.*keine Fall-Datensicherung/);
  assert.match(meldungen.join(' '), /2 von 3 Fällen/);
});

test('Der Datei-Weg bietet die JSON als eigenstaendigen Weg an', () => {
  assert.match(html, /Eine JSON-Datensicherung einlesen\?[\s\S]{0,200}nur die JSON-Datei/,
    'die Rückfrage bietet den JSON-Weg nicht an');
  /* Ohne Excel-Rueckfall darf eine unlesbare JSON keinen leeren Fall erzeugen. */
  assert.ok(html.includes("if(gelesen===false&&!masterFile){toast('Die gewählte Datei ist keine lesbare Fall-Datensicherung.');return}"),
    'eine unlesbare JSON wuerde einen leeren Fall anlegen');
  /* Der flache Ordner darf nicht mehr pauschal abgewiesen werden. */
  assert.ok(!html.includes("toast('Im gewählten Ordner wurden keine Fall-Unterordner gefunden.')"),
    'die alte Sackgassen-Meldung lebt noch');
});

test('Blockzahl bleibt bei 309', () => {
  assert.equal((html.match(/\n<script/g) || []).length, 309);
});
