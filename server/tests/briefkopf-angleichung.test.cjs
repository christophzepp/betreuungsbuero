'use strict';

/* Angleichung der Sonderkoepfe an die Briefkopf-Karte (Nutzerentscheidung 06.09.2026).
     Der Briefkopf-Editor bedient nur die Familie um unifiedLetterHead. Zwei Ausgaben mit eigenem
     Zeichner holen sich jetzt trotzdem einzelne Werte aus derselben Quelle:
     - Rechnungslegung (accPdfHeader): CI-Farbe und Bueroname aus der Karte, Raster und Schrift
       bleiben unveraendert (Tabellenanhang, kein Brief).
     - Mitteilung nach der Mitteilungsverordnung (createCourtNoticePdf): die eine Fusszeile entsteht
       aus den Bausteinen INHABER (TITEL) | ANSCHRIFT | E-MAIL statt aus eigenen Literalen.
     Bewusst NICHT angeglichen: die eingebettete Schrift der Tabellen-PDFs (Dateigroesse) und die
     Geometrie beider Ausgaben. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

/* Eine Funktion per Namen aus der Auslieferung schneiden (Klammern zaehlen). */
function funktion(name, einzug = '') {
  const start = html.indexOf('\n' + einzug + 'function ' + name + '(');
  assert.ok(start > 0, 'Funktion ' + name + ' fehlt');
  let i = html.indexOf('{', start);
  let tiefe = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') tiefe += 1;
    else if (c === '}') { tiefe -= 1; if (tiefe === 0) return html.slice(start, i + 1); }
  }
  throw new Error('Ende von ' + name + ' nicht gefunden');
}

function sandkasten(fenster, office) {
  const rgbLog = [];
  const box = {
    window: fenster,
    OFFICE: office,
    PDFLib: { rgb: (r, g, b) => { const v = { r, g, b }; rgbLog.push(v); return v; } },
    ergebnis: null
  };
  vm.createContext(box);
  vm.runInContext(funktion('accPdfCiFarbe') + '\n' + funktion('accPdfBueroName')
    + '\nthis.farbe = accPdfCiFarbe;\nthis.name = accPdfBueroName;', box);
  return box;
}

const HEUTE = { r: 0.12, g: 0.31, b: 0.47 };
const rund = (v) => Math.round(v * 1000) / 1000;

test('Rechnungslegung (ausgefuehrt): ohne Karte bleiben Farbe und Name exakt wie bisher', () => {
  /* Kein Kartenblock (abgeschnittene Auslieferung, alter Pruefstand): beide Rueckfaelle greifen. */
  let k = sandkasten({}, { name: 'Betreuungsbüro Mustermensch' });
  assert.deepEqual(k.farbe(), HEUTE, 'Ohne Karte muss das bisherige Blau stehen');
  assert.equal(k.name(), 'Betreuungsbüro Mustermensch');

  /* Karte vorhanden, aber ungepflegt: Standardkarte liefert dieselben Werte wie heute. */
  k = sandkasten({
    __briefkopfEffektiv: () => ({ farbe: '#1f4e78' }),
    __briefkopfFarbe: (karte, code) => (code === 'ci' ? karte.farbe : '#59636b'),
    __briefkopfWert: () => 'Betreuungsbüro Mustermensch'
  }, { name: 'Betreuungsbüro Mustermensch' });
  const f = k.farbe();
  assert.deepEqual([rund(f.r), rund(f.g), rund(f.b)], [rund(31 / 255), rund(78 / 255), rund(120 / 255)]);
  assert.equal(k.name(), 'Betreuungsbüro Mustermensch');
});

test('Rechnungslegung (ausgefuehrt): eine gepflegte Karte faerbt den Tabellenkopf und setzt den Firmennamen', () => {
  const k = sandkasten({
    __briefkopfEffektiv: () => ({ farbe: '#7A1F3D' }),
    __briefkopfFarbe: (karte, code) => (code === 'ci' ? karte.farbe : '#59636b'),
    __briefkopfWert: (tok) => (tok === 'BÜRO' ? 'Betreuungsbüro Mustermensch GmbH' : '')
  }, { name: 'Alter Name' });
  const f = k.farbe();
  assert.deepEqual([rund(f.r), rund(f.g), rund(f.b)], [rund(122 / 255), rund(31 / 255), rund(61 / 255)], 'CI-Farbe der Karte');
  assert.equal(k.name(), 'Betreuungsbüro Mustermensch GmbH', 'Der Baustein BÜRO gewinnt vor OFFICE.name');
});

test('Rechnungslegung (ausgefuehrt): kaputte Werte fallen auf die heutigen Literale zurueck', () => {
  for (const hex of ['', 'blau', '#12345', null, undefined]) {
    const k = sandkasten({
      __briefkopfEffektiv: () => ({ farbe: hex }),
      __briefkopfFarbe: (karte) => karte.farbe,
      __briefkopfWert: () => ''
    }, { name: 'Betreuungsbüro Mustermensch' });
    assert.deepEqual(k.farbe(), HEUTE, 'Ungueltige Farbe muss auf das bisherige Blau fallen: ' + String(hex));
    assert.equal(k.name(), 'Betreuungsbüro Mustermensch', 'Leerer Baustein muss auf OFFICE.name fallen');
  }
  /* Wirft der Resolver, darf die Rechnungslegung nicht scheitern. */
  const laut = sandkasten({
    __briefkopfEffektiv: () => { throw new Error('kaputt'); },
    __briefkopfWert: () => { throw new Error('kaputt'); }
  }, { name: 'Betreuungsbüro Mustermensch' });
  assert.deepEqual(laut.farbe(), HEUTE);
  assert.equal(laut.name(), 'Betreuungsbüro Mustermensch');
});

test('Rechnungslegung: Raster, Schrift und Aufbau des Tabellenkopfs bleiben unveraendert', () => {
  assert.ok(html.includes('blue=accPdfCiFarbe(),muted=PDFLib.rgb(.35,.41,.46);'
    + 'page.drawText(accPdfSafe(accPdfBueroName()),{x:38,y:height-38,size:9,font:fonts.bold,color:blue});'),
    'Der Tabellenkopf zieht Farbe und Namen nicht aus der Karte');
  assert.ok(html.includes("page.drawLine({start:{x:38,y:height-88},end:{x:width-38,y:height-88},thickness:1,color:blue});return height-108}"),
    'Raster und Rueckgabe des Tabellenkopfs muessen unveraendert bleiben');
  assert.ok(html.includes('async function accPdfFonts(pdf){return {reg:await pdf.embedFont(PDFLib.StandardFonts.Helvetica)'),
    'Die Tabellen-PDFs bleiben bei der Standardschrift (Nutzerentscheidung: keine Einbettung)');
  /* Auch die Rumpfelemente (Summenkasten, Spaltenkopf, Zwischenueberschriften) folgen der CI-Farbe,
     sonst haette ein Buero mit eigener Farbe einen farbigen Kopf ueber blauen Tabellen. */
  assert.ok(html.includes('tot=accTotals(),blue=accPdfCiFarbe(),'), 'Die Zusammenfassung faerbt ihren Rumpf nicht aus der Karte');
  assert.ok(html.includes('const blue=accPdfCiFarbe(),blueSoft='), 'Die Buchungsliste faerbt ihren Rumpf nicht aus der Karte');
  assert.equal((html.match(/PDFLib\.rgb\(\.12,\.31,\.47\)/g) || []).length >= 1, true, 'Der Rueckfallwert muss erhalten bleiben');
});

test('Mitteilung: die Fusszeile kommt aus den Briefkopf-Bausteinen, mit Rueckfall auf das bisherige Literal', () => {
  assert.ok(html.includes("const t=window.__briefkopfZeile('INHABER (TITEL) | ANSCHRIFT | E-MAIL',{});"),
    'Die Fusszeile der Mitteilung wird nicht aus den Bausteinen gebaut');
  assert.ok(html.includes('return `${officeNameWithDegree()} | ${OFFICE.address} | ${OFFICE.email}`;'),
    'Der Rueckfall auf das bisherige Literal fehlt');
  assert.ok(html.includes('drawText(fussZeile,x,29,7.2,regular,muted);'),
    'Lage und Groesse der Fusszeile muessen unveraendert bleiben');
  /* Das Formular selbst bleibt, wie es war: eigene Blaufarbe, eigenes Raster, keine Bankzeile. */
  assert.ok(html.includes('const blue=PDFLib.rgb(23/255,63/255,102/255)'), 'Die eigene Farbe der Mitteilung wurde angetastet');
  assert.ok(html.includes('const x=47,width=501;let y=806;'), 'Das Raster der Mitteilung wurde angetastet');
  const mitteilung = html.slice(html.indexOf('async function createCourtNoticePdf()'), html.indexOf('window.createCourtNoticePdf='));
  assert.ok(!/IBAN|STEUERNR|BANK/.test(mitteilung), 'Bank- und Steuerangaben gehoeren nicht auf das Behoerdenformular');
});
