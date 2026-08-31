'use strict';
/* Erzeugt die PDF-Dateien der Demonstrationsfaelle - dieselben Dokumente, die in der
   Export- und Versandhistorie stehen und im Dokumentenspeicher unter Register 10 bzw. 11
   abgelegt werden.

   Bewusst schlicht gehalten: Briefkopf, Anschriftenfeld, Betreff, Fliesstext, Unterschrift.
   Es geht nicht darum, das CI-Drucklayout der App nachzubauen (das entsteht im Browser),
   sondern darum, dass hinter jedem Historieneintrag eine echte, lesbare Datei liegt. */

const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');

const A4 = [595.28, 841.89];
const RAND_LINKS = 70;
const RAND_RECHTS = 60;
const BREITE = A4[0] - RAND_LINKS - RAND_RECHTS;
const BLAU = rgb(0.09, 0.22, 0.37);
const GRAU = rgb(0.42, 0.45, 0.5);
const SCHWARZ = rgb(0.1, 0.1, 0.12);

const BUERO = {
  name: 'Testbüroname',
  zusatz: 'Betreuungsbüro Christoph Zepp · Rechtliche Betreuungen',
  strasse: 'Marktplatz 8',
  ort: '56346 St. Goarshausen',
  telefon: '06771 / 959410',
  mail: 'kanzlei@testbueroname.de'
};

/* Zeilenumbruch nach Breite - pdf-lib bricht nicht selbst um. */
function umbrechen(text, font, groesse, breite) {
  const zeilen = [];
  for (const absatz of String(text == null ? '' : text).split('\n')) {
    if (!absatz.trim()) { zeilen.push(''); continue; }
    let aktuell = '';
    for (const wort of absatz.split(/\s+/)) {
      const versuch = aktuell ? aktuell + ' ' + wort : wort;
      if (font.widthOfTextAtSize(versuch, groesse) <= breite) { aktuell = versuch; continue; }
      if (aktuell) zeilen.push(aktuell);
      aktuell = wort;
    }
    zeilen.push(aktuell);
  }
  return zeilen;
}

/* WinAnsi kann kein „–" in jeder Variante und keine typografischen Anführungszeichen;
   die Standardschriften von pdf-lib werfen darüber sonst hart. */
function winansi(text) {
  return String(text == null ? '' : text)
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’‚‹›]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[•·]/g, '-')
    .replace(/€/g, 'EUR');
}

class Blatt {
  constructor(doc, fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.seiten = [];
    this.neueSeite();
  }

  neueSeite() {
    this.seite = this.doc.addPage(A4);
    this.seiten.push(this.seite);
    this.y = A4[1] - 60;
    return this.seite;
  }

  platzPruefen(hoehe) {
    if (this.y - hoehe < 70) this.neueSeite();
  }

  text(inhalt, opt = {}) {
    const groesse = opt.groesse || 10.5;
    const font = opt.fett ? this.fonts.fett : this.fonts.normal;
    const farbe = opt.farbe || SCHWARZ;
    const zeilenhoehe = opt.zeilenhoehe || groesse * 1.42;
    const breite = opt.breite || BREITE;
    for (const zeile of umbrechen(winansi(inhalt), font, groesse, breite)) {
      this.platzPruefen(zeilenhoehe);
      if (zeile) this.seite.drawText(zeile, { x: opt.x || RAND_LINKS, y: this.y, size: groesse, font, color: farbe });
      this.y -= zeilenhoehe;
    }
  }

  abstand(h) { this.platzPruefen(h); this.y -= h; }

  linie(farbe) {
    this.platzPruefen(10);
    this.seite.drawLine({
      start: { x: RAND_LINKS, y: this.y }, end: { x: A4[0] - RAND_RECHTS, y: this.y },
      thickness: 0.8, color: farbe || rgb(0.8, 0.84, 0.88)
    });
    this.y -= 12;
  }

  briefkopf() {
    const s = this.seite;
    s.drawText(winansi(BUERO.name), { x: RAND_LINKS, y: A4[1] - 62, size: 17, font: this.fonts.fett, color: BLAU });
    s.drawText(winansi(BUERO.zusatz), { x: RAND_LINKS, y: A4[1] - 78, size: 8.5, font: this.fonts.normal, color: GRAU });
    const rechts = [BUERO.strasse, BUERO.ort, 'Telefon ' + BUERO.telefon, BUERO.mail];
    rechts.forEach((zeile, i) => {
      const t = winansi(zeile);
      const b = this.fonts.normal.widthOfTextAtSize(t, 8.5);
      s.drawText(t, { x: A4[0] - RAND_RECHTS - b, y: A4[1] - 62 - i * 11, size: 8.5, font: this.fonts.normal, color: GRAU });
    });
    s.drawLine({
      start: { x: RAND_LINKS, y: A4[1] - 92 }, end: { x: A4[0] - RAND_RECHTS, y: A4[1] - 92 },
      thickness: 1.6, color: BLAU
    });
    this.y = A4[1] - 120;
  }

  fusszeilen(kennung) {
    this.seiten.forEach((seite, i) => {
      const links = winansi(kennung);
      const rechts = winansi(`Seite ${i + 1} von ${this.seiten.length}`);
      seite.drawLine({
        start: { x: RAND_LINKS, y: 52 }, end: { x: A4[0] - RAND_RECHTS, y: 52 },
        thickness: 0.6, color: rgb(0.82, 0.85, 0.89)
      });
      seite.drawText(links, { x: RAND_LINKS, y: 40, size: 7.5, font: this.fonts.normal, color: GRAU });
      const b = this.fonts.normal.widthOfTextAtSize(rechts, 7.5);
      seite.drawText(rechts, { x: A4[0] - RAND_RECHTS - b, y: 40, size: 7.5, font: this.fonts.normal, color: GRAU });
    });
  }
}

async function neuesBlatt(titel, betreff) {
  const doc = await PDFDocument.create();
  doc.setTitle(winansi(titel));
  doc.setSubject(winansi(betreff || titel));
  doc.setAuthor(BUERO.name);
  doc.setProducer('Betreuungsbüro-Dokumentenassistent (Demonstrationsdaten)');
  doc.setCreator('Betreuungsbüro-Dokumentenassistent (Demonstrationsdaten)');
  const fonts = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    fett: await doc.embedFont(StandardFonts.HelveticaBold)
  };
  return { doc, blatt: new Blatt(doc, fonts) };
}

/* Anschreiben im Briefkopfdesign. */
async function briefPdf(spec) {
  const { doc, blatt } = await neuesBlatt(spec.dokumentTitel, spec.betreff);
  blatt.briefkopf();

  blatt.text(`${BUERO.name} · ${BUERO.strasse} · ${BUERO.ort}`, { groesse: 7, farbe: GRAU });
  blatt.abstand(6);
  for (const zeile of spec.empfaengerZeilen) blatt.text(zeile, { groesse: 10.5 });

  blatt.abstand(24);
  const datum = winansi(spec.datumText);
  const b = blatt.fonts.normal.widthOfTextAtSize(datum, 10);
  blatt.seite.drawText(datum, { x: A4[0] - RAND_RECHTS - b, y: blatt.y, size: 10, font: blatt.fonts.normal, color: SCHWARZ });
  blatt.y -= 26;

  if (spec.bezug) { blatt.text(spec.bezug, { groesse: 9, farbe: GRAU }); blatt.abstand(4); }
  blatt.text(spec.betreff, { fett: true, groesse: 11.5 });
  blatt.abstand(12);
  blatt.text(spec.anrede || 'Sehr geehrte Damen und Herren,');
  blatt.abstand(8);
  blatt.text(spec.text);

  if (spec.anlagen && spec.anlagen.length) {
    blatt.abstand(14);
    blatt.text('Anlagen', { fett: true, groesse: 10 });
    for (const a of spec.anlagen) blatt.text('- ' + a, { groesse: 10 });
  }

  blatt.abstand(26);
  blatt.text('Mit freundlichen Grüßen');
  blatt.abstand(30);
  blatt.text('Christoph Zepp', { fett: true });
  blatt.text('Rechtlicher Betreuer', { groesse: 9, farbe: GRAU });

  blatt.fusszeilen(spec.kennung);
  return { bytes: Buffer.from(await doc.save()), seiten: blatt.seiten.length };
}

/* Bericht/Formular: Titelkopf mit Verfahrensdaten, danach Abschnitte aus Feldpaaren. */
async function berichtPdf(spec) {
  const { doc, blatt } = await neuesBlatt(spec.dokumentTitel, spec.dokumentTitel);
  blatt.briefkopf();

  blatt.text(spec.dokumentTitel, { fett: true, groesse: 15, farbe: BLAU });
  blatt.abstand(6);
  for (const zeile of spec.kopfZeilen || []) blatt.text(zeile, { groesse: 9.5, farbe: GRAU });
  blatt.abstand(6);
  blatt.linie(BLAU);

  for (const abschnitt of spec.abschnitte || []) {
    blatt.platzPruefen(60);
    blatt.abstand(8);
    blatt.text(abschnitt.titel, { fett: true, groesse: 11.5, farbe: BLAU });
    blatt.abstand(3);
    for (const [bezeichnung, wert] of abschnitt.felder || []) {
      blatt.platzPruefen(30);
      blatt.text(bezeichnung, { groesse: 8.5, farbe: GRAU });
      blatt.text(String(wert == null || wert === '' ? '—' : wert), { groesse: 10.5 });
      blatt.abstand(5);
    }
  }

  if (spec.unterschrift !== false) {
    blatt.abstand(24);
    blatt.text(spec.unterschriftOrtDatum || '', { groesse: 10 });
    blatt.abstand(26);
    blatt.text('Christoph Zepp', { fett: true });
    blatt.text('Rechtlicher Betreuer', { groesse: 9, farbe: GRAU });
  }

  blatt.fusszeilen(spec.kennung);
  return { bytes: Buffer.from(await doc.save()), seiten: blatt.seiten.length };
}

module.exports = { briefPdf, berichtPdf, BUERO };
