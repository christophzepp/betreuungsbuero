'use strict';

/*
 * Verbindliche Taxonomie des Dokumentenspeichers.
 *
 * fallanlageOrdner() gibt bewusst NUR die Register 00-12 zurueck. Alle
 * Unterordner in LAZY_UNTERORDNER sind Vorlagen und entstehen erst, wenn ein
 * Aufrufer fuer die erste Datei den entsprechenden Pfad anfordert.
 */

const { normalisiereDateiname } = require('./names');

const REGISTER = Object.freeze([
  Object.freeze({ code: '00', name: '00 - Eingang' }),
  Object.freeze({ code: '01', name: '01 - Stammdaten' }),
  Object.freeze({ code: '02', name: '02 - Kerndokumente' }),
  Object.freeze({ code: '03', name: '03 - Behörden & Gerichte' }),
  Object.freeze({ code: '04', name: '04 - Gesundheit & Pflege' }),
  Object.freeze({ code: '05', name: '05 - Finanzen' }),
  Object.freeze({ code: '06', name: '06 - Versicherungen' }),
  Object.freeze({ code: '07', name: '07 - Arbeit & Alltagsstruktur' }),
  Object.freeze({ code: '08', name: '08 - Unterkunft & Aufenthalt' }),
  Object.freeze({ code: '09', name: '09 - Persönliches' }),
  Object.freeze({ code: '10', name: '10 - Berichte & Rechnungslegung' }),
  Object.freeze({ code: '11', name: '11 - Betreuungsführung' }),
  Object.freeze({ code: '12', name: '12 - Abschluss & Herausgabe' })
]);

const REGISTER_BY_CODE = Object.freeze(Object.fromEntries(REGISTER.map((r) => [r.code, r])));

const LAZY_UNTERORDNER = Object.freeze({
  '03': Object.freeze(['<Stelle>/<Jahr>/<Monat>']),
  '04': Object.freeze(['<Arzt/Klinik>', 'Befunde & Gutachten', 'Medikation', 'Pflege & Pflegegrad']),
  '05': Object.freeze([
    'Konto <Bank> <letzte 4>/<Jahr>/<Monat>',
    'Belege/<Jahr>/<Monat>',
    'Handkasse/<Jahr>/<Monat>',
    'Leistungsträger/<Träger>/<Jahr>',
    'Schulden/<Gläubiger> <Az>',
    'Zahlungen/<Jahr>/<Monat>',
    'Vermögensnachweise'
  ]),
  '06': Object.freeze(['<Versicherer>']),
  '07': Object.freeze(['<Einrichtung>']),
  '08': Object.freeze(['<Vermieter>', 'Nebenkosten & Energie/<Jahr>']),
  '10': Object.freeze([
    'Vermögensverzeichnis (§ 1835 BGB)',
    'Berichte (§ 1863 BGB)/<Zeitraum>',
    'Rechnungslegung (§ 1865 BGB)/<Zeitraum>',
    'Vergütung/<Zeitraum>'
  ]),
  '11': Object.freeze([
    'Falldokumentation/<Jahr>/<Monat>/<JJMMTT HHMM Eintrag>',
    'Schriftverkehr/<Jahr>/<Monat>',
    'Dokumentenausgang/<Jahr>/<Monat>'
  ])
});

function pad2(value) {
  return String(value).padStart(2, '0');
}

function registerCode(value) {
  const raw = String(value == null ? '' : value).trim();
  if (/^\d{1,2}$/.test(raw)) return pad2(Number(raw));
  const m = /^(\d{2})\b/.exec(raw);
  return m ? m[1] : '';
}

function registerName(value) {
  const row = REGISTER_BY_CODE[registerCode(value)];
  return row ? row.name : '';
}

function fallanlageOrdner() {
  return REGISTER.map((r) => r.name);
}

function ordnerPfad(register, ...segmente) {
  const root = registerName(register);
  if (!root) throw new Error('Unbekanntes Register: ' + String(register));
  return [root].concat(segmente.flat().map((s) => String(s || '').trim()).filter(Boolean));
}

function gueltigesDatum(year, month, day) {
  if (!(year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/*
 * Akzeptiert ISO (auch mit Uhrzeit) sowie TT.MM.JJJJ und TT/MM/JJJJ.
 * Ungueltige Kalendertage werden nicht still normalisiert.
 */
function parseDatum(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      iso: `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`,
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes()
    };
  }

  const raw = String(value == null ? '' : value).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(raw);
  let year, month, day, hour = null, minute = null;
  if (m) {
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
    if (m[4] !== undefined) { hour = Number(m[4]); minute = Number(m[5]); }
  } else {
    m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[, T]+(\d{1,2}):(\d{2}))?/.exec(raw);
    if (!m) return null;
    day = Number(m[1]); month = Number(m[2]); year = Number(m[3]);
    if (m[4] !== undefined) { hour = Number(m[4]); minute = Number(m[5]); }
  }
  if (!gueltigesDatum(year, month, day)) return null;
  if (hour !== null && (!(hour >= 0 && hour <= 23) || !(minute >= 0 && minute <= 59))) return null;
  return {
    iso: `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`,
    year, month, day, hour, minute
  };
}

function datumIso(value) {
  const d = parseDatum(value);
  return d ? d.iso : '';
}

function jahrMonatOrdner(value) {
  const d = parseDatum(value);
  return d ? [String(d.year).padStart(4, '0'), pad2(d.month)] : null;
}

function zeitAus(value) {
  const d = parseDatum(value);
  if (d) return d.hour !== null ? { hour: d.hour, minute: d.minute } : null;
  const raw = String(value == null ? '' : value);
  let m = /(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?:\D|$)/.exec(raw);
  if (!m) m = /(?:^|\D)([01]\d|2[0-3])([0-5]\d)(?:\D|$)/.exec(raw);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

function ersterWert(obj, felder) {
  for (const feld of felder) {
    if (obj && obj[feld] !== undefined && obj[feld] !== null && String(obj[feld]).trim()) return obj[feld];
  }
  return null;
}

function dokuEintragsnameInfo(entry, fallbackDatum) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const ersteAnlage = Array.isArray(e.photos)
    ? e.photos.find((photo) => photo && typeof photo === 'object')
    : null;
  const datumsKandidaten = [
    ersterWert(e, ['eventDate', 'ereignisdatum', 'date', 'datum']),
    ersterWert(ersteAnlage, ['photoTakenAt', 'uploadedAt', 'createdAt']),
    ersterWert(e, ['createdAt', 'created_at', 'uploadedAt', 'uploaded_at']),
    fallbackDatum
  ];
  let datum = null;
  for (const kandidat of datumsKandidaten) {
    datum = parseDatum(kandidat);
    if (datum) break;
  }
  if (!datum) throw new Error('Für den Dokumentationseintrag ist kein gültiges Datum verfügbar.');

  const zeitKandidaten = [
    ersterWert(e, ['time', 'uhrzeit', 'eventTime']),
    ersterWert(ersteAnlage, ['filename', 'photoTakenAt', 'uploadedAt', 'createdAt']),
    datumsKandidaten[0],
    ersterWert(e, ['createdAt', 'created_at', 'uploadedAt', 'uploaded_at']),
    fallbackDatum
  ];
  let zeit = null;
  for (const kandidat of zeitKandidaten) {
    zeit = zeitAus(kandidat);
    if (zeit) break;
  }
  if (!zeit) zeit = { hour: 0, minute: 0 };

  const titel = ersterWert(e, ['type', 'art', 'title', 'titel', 'detail']) || 'Dokumentationseintrag';
  const prefix = `${String(datum.year).slice(-2)}${pad2(datum.month)}${pad2(datum.day)} `
    + `${pad2(zeit.hour)}${pad2(zeit.minute)} `;
  return Object.assign(normalisiereDateiname(prefix + String(titel)), {
    datumIso: datum.iso,
    jahr: String(datum.year),
    monat: pad2(datum.month),
    uhrzeit: `${pad2(zeit.hour)}:${pad2(zeit.minute)}`
  });
}

function dokuEintragsname(entry, fallbackDatum) {
  return dokuEintragsnameInfo(entry, fallbackDatum).name;
}

function dokuPfad(entry, fallbackDatum) {
  const info = dokuEintragsnameInfo(entry, fallbackDatum);
  return ordnerPfad('11', 'Falldokumentation', info.jahr, info.monat, info.name);
}

function referenzJahr(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getFullYear();
  const m = /(\d{4})/.exec(String(value == null ? '' : value));
  const year = m ? Number(m[1]) : new Date().getFullYear();
  return year >= 1 && year <= 9999 ? year : new Date().getFullYear();
}

function datumTeil(year, month, day) {
  if (!gueltigesDatum(year, month, day)) return null;
  return { year, month, day, iso: `${year}-${pad2(month)}-${pad2(day)}` };
}

function standardZeitraum(year, gueltig) {
  const von = datumTeil(year, 1, 1);
  const bis = datumTeil(year, 12, 31);
  return { von, bis, gueltig: gueltig !== false, abweichend: false, ordner: String(year) };
}

function parseBerichtszeitraum(reportPeriod, jahr) {
  const refYear = referenzJahr(jahr);
  let werte = [];

  if (reportPeriod && typeof reportPeriod === 'object') {
    const von = reportPeriod.from || reportPeriod.von || reportPeriod.periodFrom;
    const bis = reportPeriod.to || reportPeriod.bis || reportPeriod.periodTo;
    werte = [parseDatum(von), parseDatum(bis)].filter(Boolean);
  } else {
    const raw = String(reportPeriod == null ? '' : reportPeriod).trim();
    if (/^\d{4}$/.test(raw)) return standardZeitraum(Number(raw), true);
    const volle = raw.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4}/g) || [];
    werte = volle.map(parseDatum).filter(Boolean);
    if (werte.length < 2) {
      const m = /(\d{1,2})[./](\d{1,2})\.?\s*(?:-|–|—|bis)\s*(\d{1,2})[./](\d{1,2})\.?/i.exec(raw);
      if (m) {
        const sm = Number(m[2]), sd = Number(m[1]), em = Number(m[4]), ed = Number(m[3]);
        const endYear = (em < sm || (em === sm && ed < sd)) ? refYear + 1 : refYear;
        werte = [datumTeil(refYear, sm, sd), datumTeil(endYear, em, ed)].filter(Boolean);
      }
    }
  }

  if (werte.length < 2) return standardZeitraum(refYear, false);
  const von = werte[0], bis = werte[1];
  if (von.year === bis.year && von.month === 1 && von.day === 1 && bis.month === 12 && bis.day === 31) {
    return standardZeitraum(von.year, true);
  }
  return {
    von,
    bis,
    gueltig: true,
    abweichend: true,
    ordner: `${von.year}-${pad2(von.month)} bis ${bis.year}-${pad2(bis.month)}`
  };
}

function berichtszeitraumOrdner(reportPeriod, jahr) {
  return parseBerichtszeitraum(reportPeriod, jahr).ordner;
}

function berichtPfad(art, reportPeriod, jahr) {
  const key = String(art || '').toLocaleLowerCase('de-DE').normalize('NFD').replace(/\p{M}/gu, '');
  if (/vermogensverzeichnis|asset_inventory/.test(key)) {
    return ordnerPfad('10', 'Vermögensverzeichnis (§ 1835 BGB)');
  }
  let basis;
  if (/rechnungslegung|accounting|self_management/.test(key)) basis = 'Rechnungslegung (§ 1865 BGB)';
  else if (/vergutung|remuneration/.test(key)) basis = 'Vergütung';
  else basis = 'Berichte (§ 1863 BGB)';
  return ordnerPfad('10', basis, berichtszeitraumOrdner(reportPeriod, jahr));
}

/*
 * Nur die amtlichen Berichts-/Rechnungslegungs-Ausgaben werden automatisch in
 * Register 10 eingeordnet. Alle anderen Exporte (Schreiben, Anträge, Verfügungen)
 * bleiben Dokumentenausgang; ein unbekanntes reportId darf nie still zum Bericht
 * erklärt werden.
 */
const REGISTER10_EXPORT_ART = Object.freeze({
  asset_inventory: 'asset_inventory',
  initial: 'bericht',
  annual_assets: 'bericht',
  annual_noassets: 'bericht',
  closing: 'bericht',
  court_approval: 'bericht',
  accounting: 'accounting',
  self_management: 'self_management',
  remuneration: 'remuneration',
  remuneration_pdf: 'remuneration'
});

function exportBerichtPfad(reportId, reportPeriod, jahr) {
  const art = REGISTER10_EXPORT_ART[String(reportId || '').trim().toLocaleLowerCase('de-DE')];
  return art ? berichtPfad(art, reportPeriod, jahr) : null;
}

function suchtext(value) {
  return String(value == null ? '' : value).normalize('NFC').toLocaleLowerCase('de-DE')
    .replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ');
}

const CI_REGELN = Object.freeze([
  Object.freeze({ code: '12', re: /\b(abschluss|herausgabe|uebergabe|nachfolgebetreuung|betreuungsende|erben?)\b/ }),
  Object.freeze({ code: '10', re: /\b(vermoegensverzeichnis|jahresbericht|schlussbericht|rechnungslegung|verguetung|abrechnungszeitraum)\b/ }),
  Object.freeze({ code: '11', re: /\b(falldokumentation|dokumentationseintrag|hausbesuch|schriftverkehr|dokumentenausgang|telefonvermerk|kontaktvermerk)\b/ }),
  /*
   * Leistungstraeger bewusst VOR Gesundheit, Versicherungen und Behoerden:
   * Rente, Grundsicherung, Wohngeld und Kassen gehoeren verbindlich nach 05.
   */
  Object.freeze({ code: '05', re: /(leistungstraeg|sozialleist|rent|grundsicher|wohngeld|kass|jobcenter|sozialamt|arbeitsagentur|beihilfe)/ }),
  Object.freeze({ code: '02', re: /\b(betreuungsbeschluss|beschluss|bestallung|betreuerausweis|vorsorgevollmacht|patientenverfuegung)\b/ }),
  Object.freeze({ code: '01', re: /\b(stammdaten|personalausweis|reisepass|geburtsurkunde|heiratsurkunde|sterbeurkunde|urkunde)\b/ }),
  Object.freeze({ code: '04', re: /\b(gesundheit|arzt|aerzt|klinik|pflege|pflegegrad|medikation|medikament|rezept|therapie|befund|gutachten|impfung)\b/ }),
  Object.freeze({ code: '05', re: /\b(bank|konto|iban|depot|sparkasse|volksbank|raiffeisen|schulden|glaeubiger|inkasso|mahnung|saldo|handkasse|beleg|zahlung|vermoegen)\b/ }),
  Object.freeze({ code: '06', re: /\b(versicherung|versicherer|police|haftpflicht|hausrat|rechtsschutz)\b/ }),
  Object.freeze({ code: '07', re: /\b(arbeit|arbeitgeber|werkstatt|wfbm|lohn|gehalt|tagesfoerderung|beschaeftigung)\b/ }),
  Object.freeze({ code: '08', re: /\b(miete|wohnung|wohnheim|unterkunft|aufenthalt|nebenkosten|vermieter|strom|energie|heizung)\b/ }),
  Object.freeze({ code: '03', re: /\b(gericht|justiz|urteil|behoerde|kreisverwaltung|finanzamt|landesamt|bundesamt|aktenzeichen)\b/ }),
  Object.freeze({ code: '09', re: /\b(persoenlich|familie|freizeit|biografie|bedarf|wille|wunsch|angehoerige)\b/ })
]);

function ciFolderGuessCode(haystack) {
  const text = suchtext(haystack);
  for (const regel of CI_REGELN) if (regel.re.test(text)) return regel.code;
  return '00';
}

/*
 * Ohne Pfadliste kommt der verbindliche Registername zurueck. Eine spaetere
 * Integration kann ihre sichtbaren Root-Pfade uebergeben; Unterordner werden
 * dabei bewusst nicht geraten oder angelegt.
 */
function ciFolderGuess(haystack, paths) {
  const code = ciFolderGuessCode(haystack);
  if (Array.isArray(paths)) {
    const hit = paths.find((p) => !String(p).includes('/') && registerCode(p) === code);
    if (hit) return hit;
  }
  return REGISTER_BY_CODE[code].name;
}

module.exports = {
  REGISTER,
  REGISTER_BY_CODE,
  LAZY_UNTERORDNER,
  registerCode,
  registerName,
  fallanlageOrdner,
  ordnerPfad,
  parseDatum,
  datumIso,
  jahrMonatOrdner,
  dokuEintragsname,
  dokuEintragsnameInfo,
  dokuPfad,
  parseBerichtszeitraum,
  berichtszeitraumOrdner,
  berichtPfad,
  REGISTER10_EXPORT_ART,
  exportBerichtPfad,
  ciFolderGuessCode,
  ciFolderGuess
};
