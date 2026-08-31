'use strict';
/* Vergütungsfelder in der Fall-Stammdaten-Excel (25.08.2026): drei Klartext-Spalten
   („Vergütungsstufe“/„Vermögensstatus“/„Wohnform (Vergütung)“) am Ende der Gerichtszeilen-
   Kopfzeile von „01 - Stammdaten“. Hin- und Rückübersetzung leben an EINER Stelle
   (__careVerguetungCodeZuText/__careVerguetungTextZuCode) und schöpfen ausschließlich aus
   __careVerguetungsAuswahl; der v255-Spalten-Nachrüster ergänzt fehlende Kopfzellen für
   Blanko-Vorlage und eingelesene Alt-Mappen über denselben Engpass. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

/* Lädt die ECHTEN Auswahl-Listen und Übersetzungshelfer aus der App in den Kontext —
   keine Kopie im Test, sonst prüfte der Test eine zweite Wahrheit statt der einen. */
function ladeUebersetzung(ctx) {
  const auswahl = html.match(/window\.__careVerguetungsAuswahl=\{[\s\S]*?\};/);
  assert.ok(auswahl, 'Auswahllisten (__careVerguetungsAuswahl) nicht auffindbar');
  const helfer = html.match(/window\.__careVerguetungSpalten=\[[\s\S]*?window\.__careVerguetungTextZuCode=function[\s\S]*?\n\};/);
  assert.ok(helfer, 'Übersetzungshelfer (__careVerguetungSpalten/…CodeZuText/…TextZuCode) nicht auffindbar');
  vm.runInContext(auswahl[0] + '\n' + helfer[0], ctx);
}

function neuerKontext() {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  return ctx;
}

test('Übersetzung: Codes und Klartexte in beide Richtungen, Unbekanntes wird verworfen', () => {
  const ctx = neuerKontext();
  ladeUebersetzung(ctx);
  const zuText = ctx.window.__careVerguetungCodeZuText;
  const zuCode = ctx.window.__careVerguetungTextZuCode;

  /* Export: in der Excel steht der Klartext, wie die Maske ihn zeigt. */
  assert.equal(zuText('care.assetStatus', 'M'), 'mittellos');
  assert.equal(zuText('care.assetStatus', 'NM'), 'nicht mittellos');
  assert.equal(zuText('care.housingCategory', 'S'), 'stationär');
  assert.equal(zuText('care.housingCategory', 'A'), 'andere Wohnform');
  assert.equal(zuText('care.remStage', '1'), '1');
  assert.equal(zuText('care.remStage', ''), '', 'Leer bleibt leer');
  assert.equal(zuText('care.remStage', '--'), '', 'der Maskenplatzhalter darf nicht in die Excel');

  /* Import: tolerant gegen Klartext UND Code, groß/klein- und diakritikfest. */
  assert.equal(zuCode('care.assetStatus', 'Mittellos'), 'M');
  assert.equal(zuCode('care.assetStatus', 'nm'), 'NM');
  assert.equal(zuCode('care.housingCategory', 'STATIONÄR'), 'S');
  assert.equal(zuCode('care.housingCategory', 'andere Wohnform'), 'A');
  assert.equal(zuCode('care.remStage', '2'), '2');
  assert.equal(zuCode('care.remStage', ''), '', 'Leer bleibt leer');
  assert.equal(zuCode('care.remStage', 'Stufe 3'), null, 'Unbekanntes wird verworfen, nie geraten');

  /* Rundlauf über die Auswahl selbst: jede Nicht-Leer-Option übersetzt hin und zurück auf sich.
     Damit hängt der Test an der einen Wahrheit — ändert sich die Auswahl, prüft er automatisch
     die neuen Werte mit. */
  for (const [pfad, liste] of Object.entries(ctx.window.__careVerguetungsAuswahl)) {
    for (const [code] of liste) {
      if (!code) continue;
      assert.equal(zuCode(pfad, zuText(pfad, code)), code, `${pfad}: ${code} übersteht den Rundlauf nicht`);
    }
  }
});

test('Export und Import hängen an der gemeinsamen Übersetzung; Übersicht/Kombi bewusst nicht', () => {
  /* Export (stammdatenApplyEdits, Gerichtszeile): Klartext über die gemeinsame Hinübersetzung. */
  assert.match(html,
    /stammdatenWriteField\(doc,rn,careH,window\.__careVerguetungCodeZuText\(vgPath,d\.care\[vgPath\.split\('\.'\)\[1\]\]\),vgLabel\)/,
    'der Excel-Export schreibt nicht über die gemeinsame Hinübersetzung');
  /* Import (extractMaster-Override v156): exakter Spaltenvergleich + Verwerfen von Unbekanntem. */
  assert.match(html, /const vgIdx=careH\.norm\.indexOf\(norm\(vgLabel\)\);/,
    'der Import prüft die Spalte nicht exakt (idxV156-Teilstring-Rückfall wäre fehlerträchtig)');
  assert.match(html, /if\(vgCode!==null\)d\.care\[vgPath\.split\('\.'\)\[1\]\]=vgCode;/,
    'der Import übernimmt Unbekanntes statt es zu verwerfen');
  /* v255: der Nachrüster hängt am gemeinsamen Engpass aller Mappen-Wege. */
  assert.match(html, /entries=ergaenzeVerguetungsSpaltenV255\(entries\);/,
    'der Spalten-Nachrüster ist nicht in injiziereZusatzblaetterV255 eingehängt');

  /* Bewusste Entscheidung: Betreuungsübersicht-Export und Büroverwaltung-Kombi-Export führen
     ihre eigenen, festen fachlichen Spaltensätze (gerichtlicher Zweck) — die drei
     Vergütungsfelder gehören dort NICHT hinein. Wer das ändern will, tut es absichtlich. */
  const bu = /const cols=\[item\.court,item\.fileNumber[\s\S]*?\];/.exec(html);
  assert.ok(bu, 'Spaltensatz des Betreuungsübersicht-Exports nicht auffindbar');
  assert.ok(!/remStage|assetStatus|housingCategory|Vergütungsstufe/.test(bu[0]),
    'die Betreuungsübersicht führt bewusst ihren festen Spaltensatz ohne Vergütungsfelder');
});

/* Lädt den v255-Block wie das Vorbild html-master-zusatzblaetter.test.cjs — zusätzlich mit den
   echten Übersetzungs-Definitionen im Kontext, denn der Nachrüster liest __careVerguetungSpalten. */
function ladeV255() {
  const match = html.match(/<script id="master-zusatzblaetter-v255">([\s\S]*?)<\/script>/);
  assert.ok(match, 'Block master-zusatzblaetter-v255 fehlt');
  const norm = v => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const state = { caseData: {
    accommodation: {},
    goalDecisionPlanning: { records: [], functionalProfile: { assessments: [], dailyLife: {}, wishExpression: {} } }
  } };
  const ctx = { console, state, norm, XLSX: {}, saveState() {}, toast() {}, TextEncoder, TextDecoder };
  ctx.window = ctx;
  ctx.window.__housingV255 = { domainLabels: {} };
  vm.createContext(ctx);
  ladeUebersetzung(ctx);
  vm.runInContext(match[1], ctx);
  return { ctx, api: ctx.window.__masterZusatzV255Api };
}

test('der v255-Nachrüster ergänzt die drei Kopfzellen samt Stil und ist idempotent', () => {
  const { api } = ladeV255();
  const enc = new TextEncoder(), dec = new TextDecoder();
  const zelle = (ref, text, stil) => `<c r="${ref}"${stil ? ` s="${stil}"` : ''} t="inlineStr"><is><t>${text}</t></is></c>`;
  /* Nachbau des Betreuungsdaten-Abschnitts: Kopfzeile 7 mit Behörde/Ort/Aktenzeichen, dahinter
     eine gestylte LEERE Zelle (E7) wie in formatierten Vorlagen üblich; Zeile 5 selbstschließend
     leer (darf die Kopfzeilen-Suche nicht aus dem Tritt bringen). */
  const blatt = '<worksheet><sheetData>'
    + '<row r="5"/>'
    + `<row r="6">${zelle('A6', '4. Betreuungsdaten')}</row>`
    + `<row r="7">${zelle('A7', 'Behörde', '2')}${zelle('B7', 'Ort', '2')}${zelle('C7', 'Aktenzeichen', '3')}${zelle('D7', 'Betreuung seit…', '2')}<c r="E7" s="2"/></row>`
    + `<row r="8">${zelle('A8', 'Betreuungsgericht')}${zelle('B8', 'Musterstadt')}</row>`
    + `<row r="9">${zelle('A9', 'Betreuungsbehörde')}</row>`
    + '</sheetData></worksheet>';
  const baue = () => [
    { name: 'xl/workbook.xml', data: enc.encode('<workbook xmlns:r="x"><sheets><sheet name="01 - Stammdaten" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: '[Content_Types].xml', data: enc.encode('<Types></Types>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(blatt) }
  ];

  const entries = baue();
  api.ergaenzeVerguetungsSpaltenV255(entries);
  const xml = dec.decode(entries.find(e => e.name === 'xl/worksheets/sheet1.xml').data);
  /* Ans Ende der Kopfzeile, hinter die letzte BESCHRIFTETE Spalte (D): E/F/G. Die vorhandene
     leere Zelle E7 behält ihren eigenen Stil, neue Zellen erben den der Aktenzeichen-Zelle. */
  assert.match(xml, /<c r="E7" s="2" t="inlineStr"><is><t xml:space="preserve">Vergütungsstufe<\/t>/,
    'Vergütungsstufe muss die gestylte Leerzelle E7 übernehmen (Stil bleibt)');
  assert.match(xml, /<c r="F7" s="3" t="inlineStr"><is><t xml:space="preserve">Vermögensstatus<\/t>/,
    'Vermögensstatus muss als neue Zelle den Aktenzeichen-Stil erben');
  assert.match(xml, /<c r="G7" s="3" t="inlineStr"><is><t xml:space="preserve">Wohnform \(Vergütung\)<\/t>/,
    'Wohnform (Vergütung) muss als neue Zelle den Aktenzeichen-Stil erben');
  /* Nur Kopfzellen — die Datenzeilen (Gericht/Behörde) bleiben leer. */
  assert.ok(!/r="E8"|r="F8"|r="G8"|r="E9"/.test(xml), 'Datenzellen müssen leer bleiben (Leer bleibt leer)');

  /* Idempotenz: zweiter Lauf ändert kein Byte. */
  api.ergaenzeVerguetungsSpaltenV255(entries);
  assert.equal(dec.decode(entries.find(e => e.name === 'xl/worksheets/sheet1.xml').data), xml,
    'zweiter Lauf darf nichts erneut anbauen');

  /* Engpass: auch der Blanko-Weg (injiziereZusatzblaetterV255 mit leer=true) rüstet die
     Kopfzellen nach — die Blanko-Vorlage zeigt die Spalten also ohne Neubau der Basis. */
  const blanko = baue();
  api.injiziereZusatzblaetterV255(blanko, true);
  const blankoXml = dec.decode(blanko.find(e => e.name === 'xl/worksheets/sheet1.xml').data);
  assert.ok(blankoXml.includes('Vergütungsstufe') && blankoXml.includes('Wohnform (Vergütung)'),
    'die Blanko-Vorlage muss die Vergütungs-Kopfzellen erhalten');

  /* Mappen OHNE Stammdaten-Blatt (Betreuungsübersicht/Kombi/Finanzen) bleiben unberührt. */
  const fremd = [
    { name: 'xl/workbook.xml', data: enc.encode('<workbook xmlns:r="x"><sheets><sheet name="Betreuungen" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(blatt) }
  ];
  api.ergaenzeVerguetungsSpaltenV255(fremd);
  assert.equal(dec.decode(fremd.find(e => e.name === 'xl/worksheets/sheet1.xml').data), blatt,
    'fremde Arbeitsmappen ohne Stammdaten-Blatt dürfen nicht angefasst werden');
});
