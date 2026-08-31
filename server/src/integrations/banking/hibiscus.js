// Hibiscus Payment Server - XML-RPC-Client (Banking-Modul 2026-07-26).
//
// Warum Hibiscus statt einer FinTS-Bibliothek: Hibiscus ist ein eigenstaendig registriertes
// FinTS-Produkt und spricht selbst mit den Banken - unsere Software ist nur Anwender seiner
// Schnittstelle und braucht damit KEINE eigene FinTS-Produktregistrierung (siehe
// PLAN-Bankanbindung.md). Der Payment Server ist ausdruecklich fuer die Anbindung von
// Fremdsystemen gebaut (Shop/ERP/Fachanwendung).
//
// Protokoll: XML-RPC (POST auf /xmlrpc/), HTTP-Basic mit Nutzer "admin" + Master-Passwort.
// Hibiscus liefert Werte fast durchgehend als Strings (Betraege mit Komma, Daten dd.mm.yyyy).
// Dieser Client kapselt Encoding/Decoding und normalisiert die Antworten in schlichte
// JS-Objekte; die Fachlogik (Routen) arbeitet nur noch mit normalisierten Werten.
//
// TLS: Hibiscus erzeugt sich beim ersten Start ein SELBSTSIGNIERTES Zertifikat. Bei einer
// HTTPS-XML-RPC-Verbindung kann deshalb allowSelfSigned=true noetig sein. Webfrontend und
// XML-RPC-Dienst koennen auf unterschiedlichen, vom Container veroeffentlichten Ports liegen.
'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

/* ---------------- XML-RPC Encoding ---------------- */

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Hibiscus erwartet Parameter fast immer als String oder als Map<String,String>.
// Zahlen werden deshalb bewusst als String kodiert (Betragsformat regelt der Aufrufer).
function encodeValue(v) {
  if (v === null || v === undefined) return '<value><string></string></value>';
  if (Array.isArray(v)) {
    return '<value><array><data>' + v.map(encodeValue).join('') + '</data></array></value>';
  }
  if (typeof v === 'object') {
    const members = Object.keys(v).map(k =>
      '<member><name>' + xmlEscape(k) + '</name>' + encodeValue(v[k]) + '</member>').join('');
    return '<value><struct>' + members + '</struct></value>';
  }
  if (typeof v === 'boolean') return '<value><boolean>' + (v ? '1' : '0') + '</boolean></value>';
  return '<value><string>' + xmlEscape(v) + '</string></value>';
}

function buildCall(method, params) {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<methodCall><methodName>' + xmlEscape(method) + '</methodName><params>'
    + (params || []).map(p => '<param>' + encodeValue(p) + '</param>').join('')
    + '</params></methodCall>';
}

/* ---------------- XML-RPC Parsing ----------------
   Bewusst ein kleiner, robuster Eigenbau statt einer XML-Bibliothek: Die Antworten von
   Hibiscus sind flach (Strings, Structs, Arrays) und das Schema ist stabil. Der Parser
   arbeitet mit einem Cursor ueber den Tag-Strom. */

function tokenize(xml) {
  const tokens = [];
  const re = /<([^>]+)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) tokens.push({ tag: m[1].trim() });
    else if (m[2] && m[2].trim() !== '') tokens.push({ text: m[2] });
    else if (m[2]) tokens.push({ text: m[2] }); // Whitespace-Text (in <string> relevant)
  }
  return tokens;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_a, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}

// Parst genau EIN <value>…</value> ab Position i; liefert {value, next}.
function parseValue(tokens, i) {
  if (!tokens[i] || tokens[i].tag !== 'value') throw new Error('XML-RPC: <value> erwartet');
  i++;
  // Nackter Text direkt in <value> (erlaubte Kurzform fuer Strings)
  if (tokens[i] && tokens[i].text !== undefined && tokens[i + 1] && tokens[i + 1].tag === '/value') {
    return { value: decodeEntities(tokens[i].text), next: i + 2 };
  }
  const t = tokens[i] && tokens[i].tag;
  if (t === '/value') return { value: '', next: i + 1 };
  if (t === 'string' || t === 'i4' || t === 'int' || t === 'double'
    || t === 'boolean' || t === 'dateTime.iso8601' || t === 'base64') {
    let text = '';
    let j = i + 1;
    if (tokens[j] && tokens[j].text !== undefined) { text = tokens[j].text; j++; }
    if (!tokens[j] || tokens[j].tag !== '/' + t) {
      // Selbstschliessend (<string/>) oder leer
      if (tokens[i].tag.endsWith('/')) j = i + 1;
      else throw new Error('XML-RPC: schliessendes </' + t + '> fehlt');
    } else j++;
    if (tokens[j] && tokens[j].tag === '/value') j++;
    let v = decodeEntities(text);
    if (t === 'i4' || t === 'int') v = parseInt(v, 10);
    else if (t === 'double') v = parseFloat(v);
    else if (t === 'boolean') v = v === '1' || v === 'true';
    return { value: v, next: j };
  }
  if (t === 'struct') {
    const obj = {};
    let j = i + 1;
    while (tokens[j] && tokens[j].tag === 'member') {
      j++; // member
      if (!tokens[j] || tokens[j].tag !== 'name') throw new Error('XML-RPC: <name> erwartet');
      let name = '';
      j++;
      if (tokens[j] && tokens[j].text !== undefined) { name = decodeEntities(tokens[j].text); j++; }
      if (tokens[j] && tokens[j].tag === '/name') j++;
      const r = parseValue(tokens, j);
      obj[name] = r.value; j = r.next;
      if (tokens[j] && tokens[j].tag === '/member') j++;
    }
    if (tokens[j] && tokens[j].tag === '/struct') j++;
    if (tokens[j] && tokens[j].tag === '/value') j++;
    return { value: obj, next: j };
  }
  if (t === 'array') {
    const arr = [];
    let j = i + 1;
    if (tokens[j] && tokens[j].tag === 'data') j++;
    while (tokens[j] && tokens[j].tag === 'value') {
      const r = parseValue(tokens, j);
      arr.push(r.value); j = r.next;
    }
    if (tokens[j] && tokens[j].tag === '/data') j++;
    if (tokens[j] && tokens[j].tag === '/array') j++;
    if (tokens[j] && tokens[j].tag === '/value') j++;
    return { value: arr, next: j };
  }
  throw new Error('XML-RPC: unbekannter Werttyp <' + t + '>');
}

function parseResponse(xml) {
  const tokens = tokenize(xml);
  const iFault = tokens.findIndex(t => t.tag === 'fault');
  if (iFault >= 0) {
    const iv = tokens.findIndex((t, k) => k > iFault && t.tag === 'value');
    let detail = 'XML-RPC-Fault';
    try {
      const f = parseValue(tokens, iv).value;
      detail = (f && (f.faultString || f.faultCode)) ? String(f.faultString || f.faultCode) : detail;
    } catch (_e) { /* Rohtext reicht */ }
    const err = new Error(detail);
    err.xmlrpcFault = true;
    throw err;
  }
  const iv = tokens.findIndex(t => t.tag === 'value');
  if (iv < 0) return null;
  return parseValue(tokens, iv).value;
}

/* ---------------- Transport ---------------- */

function rpcCall(cfg, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(cfg.url); } catch (_e) { return reject(new Error('Hibiscus-URL ist ungültig.')); }
    // Endpunkt vereinheitlichen: Basis-URL darf mit oder ohne /xmlrpc/ konfiguriert sein.
    let path = u.pathname || '/';
    if (!/\/xmlrpc\/?$/.test(path)) path = path.replace(/\/$/, '') + '/xmlrpc/';
    if (!path.endsWith('/')) path += '/';
    const body = buildCall(method, params);
    const isHttps = u.protocol !== 'http:';
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': 'Basic ' + Buffer.from('admin:' + (cfg.password || '')).toString('base64')
      },
      timeout: timeoutMs || 30000
    };
    if (isHttps && cfg.allowSelfSigned !== false) opts.rejectUnauthorized = false;
    const req = (isHttps ? https : http).request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 401 || res.statusCode === 403) {
          return reject(new Error('Hibiscus lehnt die Anmeldung ab (Master-Passwort prüfen).'));
        }
        if (res.statusCode >= 400) {
          return reject(new Error('Hibiscus antwortet mit HTTP ' + res.statusCode + '.'));
        }
        try { resolve(parseResponse(text)); }
        catch (e) { reject(new Error('Hibiscus-Antwort nicht lesbar: ' + e.message)); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Zeitüberschreitung zum Hibiscus-Server.')); });
    req.on('error', (e) => {
      const target = u.hostname + ':' + opts.port;
      let msg;
      if (e && e.code === 'ECONNREFUSED') {
        msg = 'Hibiscus-Verbindung zu ' + target + ' abgelehnt (Adresse, Port und Container-Freigabe prüfen).';
      } else if (e && e.code === 'ENOTFOUND') {
        msg = 'Hibiscus-Server „' + u.hostname + '“ wurde nicht gefunden.';
      } else if (e && (e.code === 'ETIMEDOUT' || /Zeitüberschreitung/.test(String(e.message || '')))) {
        msg = 'Zeitüberschreitung bei der Verbindung zu ' + target + '.';
      } else {
        msg = 'Verbindung zu Hibiscus (' + target + ') fehlgeschlagen: ' + (e.message || e);
      }
      reject(new Error(msg));
    });
    req.write(body);
    req.end();
  });
}

/* ---------------- Normalisierung ----------------
   Hibiscus liefert deutsche Formate; wir speichern ISO + Zahl. */

function parseGermanAmount(v) {
  if (typeof v === 'number') return v;
  let s = String(v == null ? '' : v).trim()
    .replace(/\s+/g, '')
    .replace(/[^\d.,+-]/g, '');
  if (!s) return 0;

  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    // Das zuletzt vorkommende Zeichen ist das Dezimaltrennzeichen:
    // 1.234,56 und 1,234.56 werden damit beide korrekt gelesen.
    const decimal = comma > dot ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    s = s.split(grouping).join('');
    const decimalAt = s.lastIndexOf(decimal);
    s = s.slice(0, decimalAt).split(decimal).join('')
      + '.' + s.slice(decimalAt + 1);
  } else if (comma >= 0) {
    const parts = s.split(',');
    s = parts.length > 1
      ? parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]
      : s;
  } else if (dot >= 0 && s.indexOf('.') !== dot) {
    const parts = s.split('.');
    const decimals = parts.pop();
    s = decimals.length <= 2
      ? parts.join('') + '.' + decimals
      : parts.join('') + decimals;
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function toIsoDate(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return '';
}

function toGermanDate(iso) {
  const m = String(iso == null ? '' : iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + '.' + m[2] + '.' + m[1]) : '';
}

// Betrag fuer Hibiscus: Komma-Dezimal, zwei Stellen, ohne Tausenderpunkte.
function toGermanAmount(cents) {
  const n = Math.round(Number(cents) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + Math.floor(abs / 100) + ',' + String(abs % 100).padStart(2, '0');
}

function normKonto(k) {
  k = k || {};
  return {
    hibiscusId: String(k.id != null ? k.id : ''),
    iban: String(k.iban || k.kontonummer || '').replace(/\s+/g, '').toUpperCase(),
    bic: String(k.bic || ''),
    name: String(k.bezeichnung || k.name || ''),
    inhaber: String(k.name || ''),
    saldo: parseGermanAmount(k.saldo),
    saldoDatum: toIsoDate(k.saldo_datum),
    waehrung: String(k.waehrung || 'EUR')
  };
}

function normUmsatz(u) {
  u = u || {};
  return {
    hibiscusId: String(u.id != null ? u.id : ''),
    kontoId: String(u.konto_id != null ? u.konto_id : ''),
    datum: toIsoDate(u.datum),
    valuta: toIsoDate(u.valuta),
    betrag: parseGermanAmount(u.betrag),
    gegenName: String(u.empfaenger_name || ''),
    gegenIban: String(u.empfaenger_konto || '').replace(/\s+/g, '').toUpperCase(),
    zweck: [u.zweck, u.zweck2, Array.isArray(u.zweck3) ? u.zweck3.join(' ') : u.zweck3]
      .filter(Boolean).map(String).join(' ').replace(/\s+/g, ' ').trim(),
    saldo: (u.saldo === undefined || u.saldo === null || u.saldo === '') ? null : parseGermanAmount(u.saldo),
    art: String(u.art || ''),
    primanota: String(u.primanota || ''),
    kundenref: String(u.customer_ref || '')
  };
}

/* ---------------- Oeffentliche API ---------------- */

// Liste aller Konten, die Hibiscus verwaltet.
async function konten(cfg) {
  const raw = await rpcCall(cfg, 'hibiscus.xmlrpc.konto.find', []);
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return list.map(normKonto);
}

// Umsaetze eines Kontos ab Datum (ISO). Hibiscus filtert ueber die Options-Map.
async function umsaetze(cfg, kontoHibiscusId, vonIso) {
  const opts = { 'konto_id': String(kontoHibiscusId) };
  if (vonIso) opts['datum:min'] = toGermanDate(vonIso);
  const raw = await rpcCall(cfg, 'hibiscus.xmlrpc.umsatz.list', [opts]);
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return list.map(normUmsatz);
}

// Einzelueberweisung anlegen. Hibiscus fuehrt sie gemaess eigener Konfiguration aus
// (Payment Server: zeitgesteuert; TAN gemaess dort hinterlegtem Verfahren).
// Rueckgabe: Hibiscus-Auftrags-ID (String) - oder Fehlertext als Exception.
async function ueberweisung(cfg, o) {
  const params = {
    konto_id: String(o.kontoHibiscusId),
    empfaenger_name: String(o.empfaengerName || '').slice(0, 70),
    empfaenger_konto: String(o.empfaengerIban || '').replace(/\s+/g, '').toUpperCase(),
    betrag: toGermanAmount(o.betragCents),
    zweck: String(o.zweck || '').slice(0, 140),
    termin: toGermanDate(o.terminIso || '')
  };
  if (o.empfaengerBic) params.empfaenger_bic = String(o.empfaengerBic);
  if (o.endToEndId) params.endtoendid = String(o.endToEndId).slice(0, 35);
  const res = await rpcCall(cfg, 'hibiscus.xmlrpc.sepaueberweisung.create', [params]);
  // Hibiscus liefert bei Erfolg die neue ID (String/Zahl), bei Problemen teils einen Fehlertext.
  const s = res == null ? '' : String(res);
  if (s && /fehler|error|ung(ue|ü)ltig/i.test(s) && !/^\d+$/.test(s)) throw new Error(s);
  return s;
}

// Sammelueberweisung: EIN Auftrag, mehrere Buchungen, EINE TAN (Kern des Intervall-Konzepts).
async function sammelueberweisung(cfg, o) {
  const params = {
    konto_id: String(o.kontoHibiscusId),
    bezeichnung: String(o.bezeichnung || 'Sammelüberweisung').slice(0, 70),
    termin: toGermanDate(o.terminIso || ''),
    buchungen: (o.buchungen || []).map(b => ({
      empfaenger_name: String(b.empfaengerName || '').slice(0, 70),
      empfaenger_konto: String(b.empfaengerIban || '').replace(/\s+/g, '').toUpperCase(),
      betrag: toGermanAmount(b.betragCents),
      zweck: String(b.zweck || '').slice(0, 140)
    }))
  };
  const res = await rpcCall(cfg, 'hibiscus.xmlrpc.sepasammelueberweisung.create', [params]);
  const s = res == null ? '' : String(res);
  if (s && /fehler|error|ung(ue|ü)ltig/i.test(s) && !/^\d+$/.test(s)) throw new Error(s);
  return s;
}

// Verbindungstest: bewusst der harmloseste Aufruf (Kontenliste).
async function test(cfg) {
  const list = await konten(cfg);
  return { ok: true, konten: list.length };
}

module.exports = {
  konten, umsaetze, ueberweisung, sammelueberweisung, test,
  // fuer Tests/Wiederverwendung exportiert:
  _internal: { buildCall, parseResponse, parseGermanAmount, toIsoDate, toGermanDate, toGermanAmount, normKonto, normUmsatz }
};
