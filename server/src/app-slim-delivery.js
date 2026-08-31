'use strict';
/* Schlanke Auslieferung der App-Datei (PDF-Umbauplan Phase 2, 13.08.2026).

   Problem: ~56 MB der 70-MB-App-HTML sind eingebettete Base64-PDF-Vorlagen (70 einzeilige
   <script type="application/pdf-base64"|"application/pdf;base64">-Bloecke), die der Browser
   bei JEDEM Seitenaufruf parst, aber nur im Exportmoment braucht.

   Loesung: Beim Ausliefern ueber den Server werden die Vorlagenzeilen geleert und mit dem
   Marker data-server-template="1" versehen (~15 MB statt 70 MB); die Vorlagen selbst kommen
   einzeln ueber GET /api/pdf-vorlagen/:elementId erst im Exportmoment. Die Datei auf der
   Platte bleibt byteidentisch - sie ist weiterhin die Wahrheit fuer den file://-Lokalmodus
   (dort ist kein Nachladen moeglich), fuer die Blockzahl-Pruefstaende und fuer Backups.
   Der Aussendienst-Export holt fehlende Vorlagen VOR dem DOM-Klonen nach (Client-Seite).

   Cache im RAM, Invalidierung ueber mtime+Groesse (die parallel laufenden Werkzeug-/
   Codex-Sitzungen schreiben die Datei mehrmals taeglich). */
const fs = require('fs');

/* Jede Vorlage belegt GENAU eine Zeile (verifiziert 13.08.2026: 70 Zeilen, 55,2 MB) -
   deshalb reicht ein zeilenweiser Filter statt eines HTML-Parsers. */
const VORLAGEN_ZEILE = /^(\s*<script\b[^>]*type="application\/pdf[;-]base64"[^>]*)>([^<]*)<\/script>\s*$/;
const ID_ATTRIBUT = /id="([^"]+)"/;

function createSlimDelivery(appFilePath) {
  let cache = null; // {mtimeMs, size, html:Buffer, vorlagen:Map<elementId, base64String>}

  function build() {
    const stat = fs.statSync(appFilePath);
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache;
    const zeilen = fs.readFileSync(appFilePath, 'utf8').split('\n');
    const vorlagen = new Map();
    for (let i = 0; i < zeilen.length; i++) {
      if (zeilen[i].length < 500 || !zeilen[i].includes('base64"')) continue; // billiger Vorfilter
      const m = VORLAGEN_ZEILE.exec(zeilen[i]);
      if (!m) continue;
      const id = (ID_ATTRIBUT.exec(m[1]) || [])[1];
      if (!id) continue;
      vorlagen.set(id, m[2].trim());
      zeilen[i] = m[1] + ' data-server-template="1"></script>';
    }
    cache = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      html: Buffer.from(zeilen.join('\n'), 'utf8'),
      vorlagen
    };
    return cache;
  }

  return {
    /* Liefert die schlanke App-Datei; express uebernimmt ETag/304 ueber res.send. */
    appHandler(req, res, next) {
      try {
        const c = build();
        res.setHeader('Cache-Control', 'no-cache');
        res.type('html');
        res.send(c.html);
      } catch (err) { next(err); }
    },
    /* Einzelne Vorlage: als PDF-Bytes (Standard) oder als Base64-Text (?format=base64,
       fuer die Aussendienst-Injektion, die den Text 1:1 in den Block schreibt). */
    vorlagenHandler(req, res) {
      let c;
      try { c = build(); } catch (_err) { return res.status(500).json({ error: 'Die Vorlagen konnten nicht gelesen werden.' }); }
      const b64 = c.vorlagen.get(String(req.params.elementId || ''));
      if (!b64) return res.status(404).json({ error: 'Unbekannte Vorlage.' });
      res.setHeader('Cache-Control', 'private, max-age=86400');
      if (req.query.format === 'base64') { res.type('text/plain'); return res.send(b64); }
      res.type('application/pdf');
      res.send(Buffer.from(b64, 'base64'));
    }
  };
}

module.exports = { createSlimDelivery };
