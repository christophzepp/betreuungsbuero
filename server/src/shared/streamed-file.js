// Gemeinsamer Baustein: einen HTTP-Koerper als DATENSTROM in eine Zwischendatei schreiben,
// Pruefsumme und Byte-Zaehler laufen mit (Nutzerauftrag 2026-07-27).
//
// EIN Wartungsort fuer beide Aufnahmestellen: den Strom-Upload des Dokumentenmoduls
// (documents-stream.js) und den WebDAV-PUT (webdav.js). Beide schrieben vorher den ganzen
// Koerper erst in den Arbeitsspeicher - gemessen 5,4x (JSON+Base64) bzw. 2,1x (WebDAV) der
// Dateigroesse. Als Strom sind es gemessen 0,6x und, was wichtiger ist, der Bedarf waechst
// NICHT mehr mit der Dateigroesse.
//
// Der Vertrag ist bewusst eng: die Funktion legt eine Zwischendatei an, schreibt hinein und
// raeumt sie bei JEDEM Misserfolg selbst weg. Der Aufrufer bekommt entweder eine vollstaendige
// Datei oder gar nichts - halbe Blobs kann es auf diesem Weg nicht geben.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEMP_PREFIX = '.strom-';
const TEMP_SUFFIX = '.part';
const PLATZ_RESERVE = 200 * 1024 * 1024;   /* Reserve, damit die Datenbank (WAL!) nicht verhungert */

function groessenText(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024 * 1024) return (v / (1024 * 1024 * 1024)).toFixed(2).replace('.', ',') + ' GB';
  if (v >= 1024 * 1024) return (v / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
  if (v >= 1024) return (v / 1024).toFixed(1).replace('.', ',') + ' KB';
  return v + ' Bytes';
}

function tempPfad(dir) {
  return path.join(dir, TEMP_PREFIX + crypto.randomUUID() + TEMP_SUFFIX);
}

function stillLoeschen(p) {
  if (!p) return;
  try { fs.unlinkSync(p); } catch (_e) { /* war nie da oder schon weg */ }
}

/* Reicht der Plattenplatz? Kann die Plattform kein statfs, wird die Pruefung uebersprungen
   statt zu blockieren (Verhalten wie /speicher in routes/documents.js). */
function platzReicht(dir, gebraucht) {
  try {
    const st = fs.statfsSync(dir);
    const frei = st.bavail * st.bsize;
    return { ok: frei >= (Number(gebraucht) || 0) + PLATZ_RESERVE, frei };
  } catch (_e) { return { ok: true, frei: null }; }
}

/* Aufloesung:
   {ok:true,  bytes, sha256}                          - vollstaendig angekommen
   {ok:false, grund:'zu-gross'|'abbruch'|'io', bytes} - Zwischendatei ist bereits geloescht */
function stromSchreiben(req, ziel, max) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    let fertig = false;
    const out = fs.createWriteStream(ziel, { flags: 'wx' });

    const ende = (ergebnis) => {
      if (fertig) return;
      fertig = true;
      try { req.unpipe(out); } catch (_e) { /* egal */ }
      if (ergebnis.ok) { resolve(ergebnis); return; }
      let fertigGemeldet = false;
      const weg = () => { if (fertigGemeldet) return; fertigGemeldet = true; stillLoeschen(ziel); resolve(ergebnis); };
      out.on('close', weg);
      out.destroy();
      setTimeout(weg, 250);
    };

    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > max) { ende({ ok: false, grund: 'zu-gross', bytes }); return; }
      hash.update(c);
    });
    req.on('aborted', () => ende({ ok: false, grund: 'abbruch', bytes }));
    req.on('error', () => ende({ ok: false, grund: 'abbruch', bytes }));
    out.on('error', () => ende({ ok: false, grund: 'io', bytes }));
    out.on('finish', () => {
      if (fertig) return;
      /* Verbindung getrennt, bevor der Koerper vollstaendig war? Dann NICHT uebernehmen. */
      if (req.aborted || req.complete === false) { ende({ ok: false, grund: 'abbruch', bytes }); return; }
      fertig = true;
      resolve({ ok: true, bytes, sha256: hash.digest('hex') });
    });
    req.pipe(out);
  });
}

/* Zeitgrenze je Anfrage loesen: Node bricht sonst nach requestTimeout (Standard 300 s) ab -
   fuer 1 GB ueber eine gewoehnliche Leitung viel zu knapp. Die serverweite Grenze hebt
   index.js an; hier faellt zusaetzlich der Socket-Timeout. */
function zeitgrenzeLoesen(req, res) {
  try { req.setTimeout(0); } catch (_e) { /* aeltere Plattform */ }
  try { res && res.setTimeout(0); } catch (_e) { /* aeltere Plattform */ }
  try { if (req.socket) req.socket.setTimeout(0); } catch (_e) { /* egal */ }
}

/* Liegengebliebene Zwischendateien aufraeumen: NUR der eigene Prefix, NUR aelter als 24 Stunden.
   Ein laufender Upload wird dadurch nie getroffen, und es kann nichts anderes erwischt werden. */
function altlastenRaeumen(dirs) {
  const grenze = Date.now() - 24 * 60 * 60 * 1000;
  let weg = 0;
  for (const d of new Set((dirs || []).filter(Boolean).map(String))) {
    let namen = [];
    try { namen = fs.readdirSync(d); } catch (_e) { continue; }
    for (const n of namen) {
      if (!(n.startsWith(TEMP_PREFIX) && n.endsWith(TEMP_SUFFIX))) continue;
      const p = path.join(d, n);
      try { if (fs.statSync(p).mtimeMs < grenze) { fs.unlinkSync(p); weg++; } } catch (_e) { /* schon weg */ }
    }
  }
  return weg;
}

module.exports = {
  TEMP_PREFIX, TEMP_SUFFIX, PLATZ_RESERVE,
  groessenText, tempPfad, stillLoeschen, platzReicht, stromSchreiben, zeitgrenzeLoesen, altlastenRaeumen
};
