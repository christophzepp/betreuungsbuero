// Kontoauszugs-Dateien als Rueckfallweg zur FinTS-Anbindung (2026-07-26, Banking #5):
// MT940 (.sta/.txt, SWIFT-Feldformat der deutschen Banken) und CAMT.053/.052 (ISO-20022-XML).
// Bewusst OHNE XML-Bibliothek: Regex ueber die Standard-Elemente der Bankexporte - fuer die
// Praxisformate der Institute tragfaehig, exotische Sonderformen meldet der Import als Fehler
// statt still Falsches zu uebernehmen. Ergebnisform je Eintrag deckungsgleich mit
// bank_transactions (booking_date/value_date ISO, amount vorzeichenbehaftet, purpose,
// counterparty, counterparty_iban), damit routes/bank.js identisch einspielen kann.
'use strict';

function num(s) { // deutsche Betragsschreibweise der Formate: 1234,56
  const n = Number(String(s || '').replace(/\./g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}

/* ------------------------------- MT940 ------------------------------- */

// :61:JJMMTT[MMTT]C/D[Waehrungsbuchstabe]Betrag,Dezimalen N<GVC>...
const RE61 = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d+,\d*)/;

function mt940Datum(jjmmtt) {
  const j = 2000 + Number(jjmmtt.slice(0, 2));
  return j + '-' + jjmmtt.slice(2, 4) + '-' + jjmmtt.slice(4, 6);
}
// Buchungsdatum MMTT traegt kein Jahr - Jahr aus der Valuta, mit Jahreswechsel-Kante
// (Buchung Dezember / Valuta Januar => Vorjahr, und umgekehrt).
function mt940Buchung(mmtt, valutaIso) {
  if (!mmtt) return valutaIso;
  let jahr = Number(valutaIso.slice(0, 4));
  const bm = Number(mmtt.slice(0, 2)), vm = Number(valutaIso.slice(5, 7));
  if (bm === 12 && vm === 1) jahr -= 1;
  if (bm === 1 && vm === 12) jahr += 1;
  return jahr + '-' + mmtt.slice(0, 2) + '-' + mmtt.slice(2, 4);
}

// :86:-Subfelder (?00, ?20-?29 Verwendungszweck, ?32/?33 Name der Gegenseite). Die
// SEPA-Kennungen (SVWZ+, EREF+, KREF+, MREF+, CRED+, IBAN+, BIC+) strukturieren den Zwecktext.
function mt940Info(text) {
  const out = { purpose: '', counterparty: '', counterparty_iban: '' };
  if (!/\?/.test(text)) { out.purpose = text.replace(/\s+/g, ' ').trim(); return out; }
  const teile = {};
  for (const m of text.matchAll(/\?(\d{2})([^?]*)/g)) teile[m[1]] = (teile[m[1]] || '') + m[2];
  const zweck = [];
  for (let i = 20; i <= 29; i++) if (teile[String(i)]) zweck.push(teile[String(i)]);
  let zw = zweck.join('').replace(/\s+/g, ' ').trim();
  const svwz = zw.match(/SVWZ\+(.*?)(?=(EREF|KREF|MREF|CRED|DEBT|COAM|OAMT|ABWA|ABWE|IBAN|BIC)\+|$)/);
  out.purpose = (svwz ? svwz[1] : zw).trim();
  out.counterparty = ((teile['32'] || '') + (teile['33'] || '')).replace(/\s+/g, ' ').trim();
  const ib = zw.match(/IBAN\+([A-Z]{2}\d{2}[A-Z0-9]{8,30})/);
  if (ib) out.counterparty_iban = ib[1];
  else if (/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(String(teile['31'] || '').trim())) out.counterparty_iban = String(teile['31']).trim();
  return out;
}

/* V1.59.2 (Rechenkern-Audit A4): Eine .sta-Datei kann MEHRERE Kontoauszuege enthalten - je Auszug
   ein eigener :20:-Block mit eigenem :25: (Konto) und :60F: (Anfangssaldo + Waehrung). Bisher
   wurden :25: und :60F: genau EINMAL ueber die GANZE Datei gelesen, die :61:-Umsatzzeilen aber
   ueber alle Bloecke hinweg eingesammelt. Folge: alle Umsaetze bekamen IBAN und Waehrung des
   ERSTEN Kontos (gemessen: eine CHF-Gutschrift von Konto B landete als 1.500 EUR auf dem
   Betreutenkonto). Jetzt wird je Block gelesen; mehrere Auszuege DESSELBEN Kontos (der Regelfall
   bei Monatsdownloads) werden vollstaendig zusammengefuehrt, mehrere VERSCHIEDENE Konten in einer
   Datei brechen mit einer sichtbaren Meldung ab - der Aufrufer (routes/bank.js /import-file)
   schreibt alle Umsaetze unter EINE IBAN, ein stilles Vermischen waere eine falsche Zahl. */
function mt940Bloecke(t) {
  const teile = t.split(/(?=^:20:)/m).filter((s) => /:61:/.test(s));
  return teile.length ? teile : [t];
}
/* V1.59.2 (Freigabe 4): Der zweite Parameter ist ein AUSDRUECKLICHES Opt-in. Ohne ihn bleibt es
   bei der klaren Abweisung mehrerer Konten in einer Datei - jeder Aufrufer, der die Umsaetze unter
   EINE IBAN schreibt, wuerde sonst wieder still vermischen (Befund A4). Nur routes/bank.js
   /import-file, das je Konto einspielt, setzt {multi:true}. */
function parseMt940(text, opt) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  if (!/:61:/.test(t)) throw new Error('Keine :61:-Umsatzzeilen gefunden - ist das eine MT940-Datei?');
  const konten = [];              // Reihenfolge der Datei erhalten
  const nachKey = new Map();
  let letzterKey = null;
  for (const block of mt940Bloecke(t)) {
    // Kontokennung :25: (haeufig BLZ/Konto oder IBAN) - je Auszugsblock
    const kto = (block.match(/:25:([^\n]+)/) || [])[1] || '';
    const ibanKto = (kto.match(/[A-Z]{2}\d{2}[A-Z0-9]{8,30}/) || [])[0] || '';
    const waehrung = ((block.match(/:60[FM]:[CD](\d{6})([A-Z]{3})/) || [])[2]) || 'EUR';
    // Fortsetzungsblock ohne eigenes :25: gehoert zum vorherigen Konto.
    const key = (ibanKto || kto.replace(/\s+/g, '')).toUpperCase() || letzterKey || '';
    letzterKey = key;
    let eintrag = nachKey.get(key);
    if (!eintrag) { eintrag = { key: key, iban: ibanKto, currency: waehrung, entries: [] }; nachKey.set(key, eintrag); konten.push(eintrag); }
    if (!eintrag.iban && ibanKto) eintrag.iban = ibanKto;
    // Blockweise: jede :61: mit zugehoerigem :86: (bis zum naechsten :XX:-Feld)
    const re = /:61:([^\n]+(?:\n(?![:-])[^\n]*)*)\n(?::86:([^]*?))?(?=\n:\d{2}[A-Z]?:|\n-\}|$)/g;
    let m;
    while ((m = re.exec(block))) {
      const z = RE61.exec(m[1].trim());
      if (!z) continue;
      const valuta = mt940Datum(z[1]);
      const richtung = z[3]; // C Gutschrift, D Belastung, RC/RD Storno
      let betrag = num(z[5]);
      if (richtung === 'D' || richtung === 'RC') betrag = -betrag;
      const info = mt940Info(String(m[2] || '').replace(/\n/g, ''));
      eintrag.entries.push({
        booking_date: mt940Buchung(z[2] || '', valuta), value_date: valuta,
        amount: betrag, currency: waehrung,
        counterparty: info.counterparty, counterparty_iban: info.counterparty_iban,
        purpose: info.purpose
      });
    }
  }
  const mitUmsatz = konten.filter((k) => k.entries.length);
  if (!mitUmsatz.length) throw new Error('MT940 erkannt, aber keine Umsaetze lesbar.');
  const benannt = mitUmsatz.filter((k) => k.key);
  if (benannt.length > 1 && !(opt && opt.multi)) throw new Error('Die Datei enthält Kontoauszüge mehrerer Konten (' +
    benannt.map((k) => k.iban || k.key).join(', ') + '). Bitte je Konto getrennt einspielen – sonst würden alle Umsätze demselben Konto zugeschrieben.');
  const entries = mitUmsatz.reduce((a, k) => a.concat(k.entries), []);
  return {
    iban: benannt.length > 1 ? '' : ((mitUmsatz.find((k) => k.iban) || {}).iban || ''),
    multiAccount: benannt.length > 1,
    entries: entries,
    accounts: mitUmsatz.map((k) => ({ iban: k.iban, currency: k.currency, entries: k.entries }))
  };
}

/* ------------------------------- CAMT ------------------------------- */

function xmlText(block, tag) {
  const m = block.match(new RegExp('<' + tag + '>\\s*([^<]*)\\s*</' + tag + '>'));
  return m ? m[1].trim() : '';
}
function xmlBlock(block, tag) {
  const m = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([^]*?)</' + tag + '>'));
  return m ? m[1] : '';
}
/* V1.59.2 (Rechenkern-Audit A5): xmlBlock ist non-greedy und liefert nur den ERSTEN Treffer.
   Banken legen in CAMT.053 regelmaessig ein <Stmt> je Auszug/Tag an - ein Monatsdownload wurde
   dadurch auf den ersten Auszug gekuerzt, der Rest verschwand spurlos und die Antwort meldete die
   gekuerzte Zahl als "gesamt". Diese Fassung sammelt ALLE gleichnamigen Bloecke ein. */
function xmlBlocksAll(block, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([^]*?)</' + tag + '>', 'g');
  let m;
  while ((m = re.exec(block))) out.push(m[1]);
  return out;
}

function parseCamt(text, opt) {
  const t = String(text || '');
  if (!/<Document/.test(t) || !/camt\.05[23]/.test(t)) throw new Error('Keine CAMT.053/052-Datei.');
  /* V1.59.2 (A5): ALLE Auszugsbloecke, nicht nur der erste. Mehrere Bloecke DESSELBEN Kontos
     (Monatsdownload mit einem <Stmt> je Tag) werden zusammengefuehrt; mehrere VERSCHIEDENE
     Konten in einer Datei brechen sichtbar ab, weil der Aufrufer alle Umsaetze unter EINE IBAN
     schreibt (siehe parseMt940). */
  const stmts = xmlBlocksAll(t, 'Stmt').concat(xmlBlocksAll(t, 'Rpt'));
  if (!stmts.length) throw new Error('CAMT: kein Stmt/Rpt-Block gefunden.');
  /* V1.59.2 (Freigabe 4): je Auszugsblock dem zugehoerigen Konto zuordnen. Bloecke ohne eigenes
     <Acct> gehoeren zum vorherigen (Fortsetzung). Reihenfolge der Datei bleibt erhalten. */
  const gruppen = [], nachIban = new Map();
  let letzteIbanCamt = '';
  for (const s of stmts) {
    const ib = xmlText(xmlBlock(xmlBlock(s, 'Acct'), 'Id'), 'IBAN') || letzteIbanCamt;
    letzteIbanCamt = ib;
    let g = nachIban.get(ib);
    if (!g) { g = { iban: ib, currency: '', entries: [] }; nachIban.set(ib, g); gruppen.push(g); }
    g._stmts = (g._stmts || []).concat([s]);
  }
  const ibansCamt = gruppen.map((g) => g.iban).filter(Boolean);
  if (ibansCamt.length > 1 && !(opt && opt.multi)) throw new Error('Die Datei enthält Kontoauszüge mehrerer Konten (' +
    ibansCamt.join(', ') + '). Bitte je Konto getrennt einspielen – sonst würden alle Umsätze demselben Konto zugeschrieben.');
  const entries = [];
  for (const g of gruppen) for (const em of g._stmts.join('\n').matchAll(/<Ntry(?:\s[^>]*)?>([^]*?)<\/Ntry>/g)) {
    const e = em[1];
    const sts = xmlText(e, 'Sts') || xmlText(xmlBlock(e, 'Sts'), 'Cd') || 'BOOK';
    if (sts && sts !== 'BOOK') continue; // nur gebuchte Umsaetze
    const amtM = e.match(/<Amt\s+Ccy="([A-Z]{3})">([\d.]+)<\/Amt>/);
    if (!amtM) continue;
    let betrag = Number(amtM[2]);
    if (xmlText(e, 'CdtDbtInd') === 'DBIT') betrag = -betrag;
    const buchung = xmlText(xmlBlock(e, 'BookgDt'), 'Dt') || (xmlText(xmlBlock(e, 'BookgDt'), 'DtTm') || '').slice(0, 10);
    const valuta = xmlText(xmlBlock(e, 'ValDt'), 'Dt') || buchung;
    const zweck = Array.from(e.matchAll(/<Ustrd>\s*([^<]*)\s*<\/Ustrd>/g)).map(x => x[1].trim()).join(' ');
    // Gegenseite: bei Belastung der Creditor, bei Gutschrift der Debtor
    const seite = betrag < 0 ? 'Cdtr' : 'Dbtr';
    const name = xmlText(xmlBlock(e, seite), 'Nm');
    const gIban = xmlText(xmlBlock(xmlBlock(e, seite + 'Acct'), 'Id'), 'IBAN');
    const eintragCamt = {
      booking_date: buchung, value_date: valuta, amount: betrag, currency: amtM[1],
      counterparty: name, counterparty_iban: gIban, purpose: zweck
    };
    if (!g.currency) g.currency = amtM[1];
    g.entries.push(eintragCamt);
    entries.push(eintragCamt);
  }
  if (!entries.length) throw new Error('CAMT erkannt, aber keine gebuchten Umsaetze gefunden.');
  const mitUmsatzCamt = gruppen.filter((g) => g.entries.length);
  const benanntCamt = mitUmsatzCamt.filter((g) => g.iban);
  return {
    iban: benanntCamt.length > 1 ? '' : ((mitUmsatzCamt.find((g) => g.iban) || {}).iban || ''),
    multiAccount: benanntCamt.length > 1,
    entries: entries,
    accounts: mitUmsatzCamt.map((g) => ({ iban: g.iban, currency: g.currency, entries: g.entries }))
  };
}

/* --------------------------- Formatweiche --------------------------- */
function parseStatementFile(text, opt) {
  const t = String(text || '');
  if (/<Document/.test(t) && /camt\.05[23]/.test(t)) return Object.assign({ format: 'camt' }, parseCamt(t, opt));
  if (/:61:/.test(t)) return Object.assign({ format: 'mt940' }, parseMt940(t, opt));
  throw new Error('Format nicht erkannt - unterstützt werden MT940 (.sta) und CAMT.053/052 (.xml).');
}

module.exports = { parseStatementFile, _internal: { parseMt940, parseCamt, mt940Info, mt940Buchung } };
