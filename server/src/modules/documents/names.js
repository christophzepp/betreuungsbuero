'use strict';

/*
 * Gemeinsame, seiteneffektfreie Namensregeln fuer den Dokumentenspeicher.
 *
 * Die Funktionen veraendern weder Platte noch Datenbank. normalisiereDateiname()
 * liefert neben dem verwendbaren Namen jeden Anpassungsgrund mit, damit kein
 * automatischer Eingriff still bleibt.
 */

const MAX_NAME_BYTES = 255;
const DE_COLLATOR = new Intl.Collator('de-DE', {
  usage: 'sort',
  sensitivity: 'accent', // Gross-/Kleinschreibung ignorieren, Umlaute aber unterscheiden.
  numeric: true
});

const WINDOWS_ZEICHEN = /[\/\\:*?"<>|]/g;
const STEUERZEICHEN = /\p{Cc}/gu;
const RESERVED_DEVICE_RE = /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/iu;

function utf8Bytes(value) {
  return Buffer.byteLength(String(value == null ? '' : value), 'utf8');
}

function nfc(value) {
  return String(value == null ? '' : value).normalize('NFC');
}

/*
 * Dieser Schluessel bildet ausschliesslich Gross-/Kleinschreibung ab. Er macht
 * also weder "ä" zu "a" noch "ß" zu "ss" und entspricht damit eher einer
 * Dateisystem-Kollision als einer unscharfen Volltextsuche.
 */
function vergleichsschluessel(value) {
  return nfc(value).toLocaleLowerCase('de-DE');
}

function dateinamenGleich(a, b) {
  return vergleichsschluessel(a) === vergleichsschluessel(b);
}

function deutschVergleichen(a, b) {
  return DE_COLLATOR.compare(nfc(a), nfc(b));
}

function istReservierterGeraetename(value) {
  const name = nfc(value).replace(/[ .]+$/u, '');
  const basis = name.split('.')[0].replace(/[ .]+$/u, '');
  return RESERVED_DEVICE_RE.test(basis);
}

function teileEndung(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return { stamm: name, endung: '' };
  const endung = name.slice(i);
  /*
   * Ein beliebig langer Punkt-Suffix ist kein sinnvoll erhaltbarer Dateityp.
   * Die Grenze umfasst auch den Punkt und liegt weit ueber allen hier
   * verwendeten Office-/Archivformaten.
   */
  if (utf8Bytes(endung) > 32 || /\s/u.test(endung)) return { stamm: name, endung: '' };
  return { stamm: name.slice(0, i), endung };
}

function kuerzeUtf8(value, maxBytes) {
  let out = '';
  let bytes = 0;
  for (const zeichen of String(value || '')) {
    const n = utf8Bytes(zeichen);
    if (bytes + n > maxBytes) break;
    out += zeichen;
    bytes += n;
  }
  return out;
}

function kuerzeMitEndung(name, maxBytes) {
  if (utf8Bytes(name) <= maxBytes) return name;
  const { stamm, endung } = teileEndung(name);
  const endungBytes = utf8Bytes(endung);
  if (!endung || endungBytes >= maxBytes) return kuerzeUtf8(name, maxBytes);
  return kuerzeUtf8(stamm, maxBytes - endungBytes) + endung;
}

function grund(code, text, details) {
  return Object.assign({ code, text }, details || {});
}

/*
 * Rueckgabe:
 *   {
 *     original, name, changed,
 *     reasons: [{code,text,...}],
 *     originalBytes, bytes, maxBytes
 *   }
 */
function normalisiereDateiname(value, optionen) {
  const opt = optionen || {};
  const maxBytes = Number.isInteger(opt.maxBytes) ? opt.maxBytes : MAX_NAME_BYTES;
  if (maxBytes < 1) throw new RangeError('maxBytes muss mindestens 1 sein.');

  const original = String(value == null ? '' : value);
  const reasons = [];
  let name = original.normalize('NFC');
  if (name !== original) {
    reasons.push(grund('unicode_nfc', 'Unicode-Schreibweise wurde auf NFC vereinheitlicht.'));
  }

  let anzahl = 0;
  name = name.replace(STEUERZEICHEN, () => { anzahl++; return '_'; });
  if (anzahl) {
    reasons.push(grund('steuerzeichen', `${anzahl} Steuerzeichen wurden durch „_“ ersetzt.`, { anzahl }));
  }

  anzahl = 0;
  name = name.replace(WINDOWS_ZEICHEN, () => { anzahl++; return '_'; });
  if (anzahl) {
    reasons.push(grund('ungueltige_zeichen',
      `${anzahl} unter Windows unzulässige Zeichen wurden durch „_“ ersetzt.`, { anzahl }));
  }

  const ohneNachlauf = name.replace(/[ .]+$/u, '');
  if (ohneNachlauf !== name) {
    reasons.push(grund('nachgestellte_punkte_leerzeichen',
      'Nachgestellte Punkte oder Leerzeichen wurden entfernt.'));
    name = ohneNachlauf;
  }

  if (!name || name === '.' || name === '..') {
    name = String(opt.fallback || 'Unbenannt').normalize('NFC');
    reasons.push(grund('leerer_name', `Der leere Name wurde durch „${name}“ ersetzt.`));
  }

  if (istReservierterGeraetename(name)) {
    const vorher = name;
    name = '_' + name;
    reasons.push(grund('reservierter_geraetename',
      `„${vorher}“ ist ein reservierter Gerätename; der Name wurde mit „_“ präfixiert.`,
      { vorher }));
  }

  const vorKuerzung = name;
  name = kuerzeMitEndung(name, maxBytes);
  if (name !== vorKuerzung) {
    reasons.push(grund('utf8_bytegrenze',
      `Der Name wurde auf höchstens ${maxBytes} UTF-8-Bytes gekürzt; die Dateiendung blieb erhalten.`,
      { vorherBytes: utf8Bytes(vorKuerzung), nachherBytes: utf8Bytes(name), maxBytes }));
  }

  const nachKuerzungOhneNachlauf = name.replace(/[ .]+$/u, '');
  if (nachKuerzungOhneNachlauf !== name) {
    name = nachKuerzungOhneNachlauf;
    if (!reasons.some((r) => r.code === 'nachgestellte_punkte_leerzeichen')) {
      reasons.push(grund('nachgestellte_punkte_leerzeichen',
        'Nachgestellte Punkte oder Leerzeichen wurden entfernt.'));
    }
  }
  if (istReservierterGeraetename(name) && !reasons.some((r) => r.code === 'reservierter_geraetename')) {
    const vorher = name;
    name = kuerzeMitEndung('_' + name, maxBytes);
    reasons.push(grund('reservierter_geraetename',
      `„${vorher}“ ist ein reservierter Gerätename; der Name wurde mit „_“ präfixiert.`,
      { vorher }));
  }

  /*
   * Die Kuerzung kann bei exotisch kleinen Testgrenzen den ganzen Stamm
   * entfernen. Ein normaler 255-Byte-Dateiname erreicht diesen Zweig nicht.
   */
  if (!name) {
    name = kuerzeUtf8(String(opt.fallback || 'Unbenannt').normalize('NFC'), maxBytes);
    if (!reasons.some((r) => r.code === 'leerer_name')) {
      reasons.push(grund('leerer_name', `Der leere Name wurde durch „${name}“ ersetzt.`));
    }
  }

  return {
    original,
    name,
    changed: name !== original,
    reasons,
    originalBytes: utf8Bytes(original),
    bytes: utf8Bytes(name),
    maxBytes
  };
}

module.exports = {
  MAX_NAME_BYTES,
  utf8Bytes,
  nfc,
  vergleichsschluessel,
  dateinamenGleich,
  deutschVergleichen,
  istReservierterGeraetename,
  kuerzeUtf8,
  kuerzeMitEndung,
  normalisiereDateiname
};
