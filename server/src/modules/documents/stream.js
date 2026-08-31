// Strom-Upload fuer den Dokumentenspeicher (Nutzerauftrag 2026-07-27).
//
// WARUM: Der bisherige Weg schickt die Datei base64-kodiert in einem JSON-Koerper. Gemessen kostet
// das im Server das 5- bis 6-Fache der Dateigroesse an Arbeitsspeicher (100 MB Datei -> +536 MB,
// 250 MB -> +1364 MB), weil der Body-Parser die Rohstuecke sammelt, verkettet, in eine
// JS-Zeichenkette wandelt und JSON.parse sie ein weiteres Mal anlegt - erst danach entsteht der
// Buffer. Zusaetzlich hat der Weg eine unverrueckbare Decke bei ~400 MB (FileReader liefert
// oberhalb davon STILL einen leeren String, meldet aber Erfolg).
//
// HIER: Der Koerper ist die ROHE Datei. Sie wird Stueck fuer Stueck auf die Platte geschrieben,
// die Pruefsumme laeuft mit. Der Speicherbedarf haengt nicht mehr an der Dateigroesse.
//
// MUSTER: exakt wie server/webdav.js - dort nimmt PUT ebenfalls rohe Koerper entgegen, und genau
// deshalb ist /webdav in index.js BEWUSST vor express.json montiert. Dieser Router wird an
// derselben Stelle montiert und beantwortet seinen Pfadzweig VOLLSTAENDIG (Catch-all am Ende),
// damit kein Aufruf doppelt durch die Sitzungs-Middleware laeuft.
//
// SICHERHEIT GEGEN HALBE DATEIEN: geschrieben wird in eine Zwischendatei ".strom-<uuid>.part" im
// ZIEL-Verzeichnis (gleiches Dateisystem -> Umbenennen ist unteilbar). Erst wenn der Strom
// vollstaendig angekommen ist, wird umbenannt und DANACH die Datenbankzeile angelegt. Bricht die
// Uebertragung ab, verschwindet die Zwischendatei und es entsteht KEINE Zeile - also weder ein
// halber Blob noch eine Karteileiche. Genau die Waisen, die die Erhebung im Bestand gefunden hat,
// koennen auf diesem Weg nicht entstehen.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { requireAuth, requireEditDocuments } = require('../../middleware/authentication');
const officeEvents = require('../office/events');
const dokumente = require('./routes');
const strom = require('../../shared/streamed-file');
const applicationWriteBarrier = require('../../middleware/application-write-barrier');

const intern = dokumente.intern || {};
const router = express.Router();

const mb = strom.groessenText;
function maxBytes() { return Number(intern.MAX_FILE) || (1024 * 1024 * 1024); }

/* Die Fehlermeldung nennt IMMER beides: wie gross die Datei ist und wie gross sie sein darf.
   (Nutzervorgabe 2026-07-27 - "Datei zu gross" allein ist keine Auskunft.) */
function zuGross(res, ist, warum) {
  return res.status(413).json({
    error: `Die Datei ist ${mb(ist)} groß, erlaubt sind höchstens ${mb(maxBytes())}.`,
    istBytes: ist, maxBytes: maxBytes(), grund: warum || 'limit'
  });
}

/* Antwort schreiben und den Rest der Anfrage verwerfen, ohne den Client mit ECONNRESET zu
   beschenken (die Falle, in die die Vorab-Messung selbst gelaufen ist: req.destroy() waehrend
   der Client noch sendet, laesst ihn den 413 gar nicht mehr sehen). Erst FINISH, dann zu. */
function abweisen(req, res, sender) {
  try { res.setHeader('Connection', 'close'); } catch (_e) { /* Header ggf. schon raus */ }
  try { req.unpipe && req.unpipe(); } catch (_e) { /* egal */ }
  res.on('finish', () => { setTimeout(() => { try { req.destroy(); } catch (_e) { /* zu ist zu */ } }, 50); });
  sender();
}

router.use(requireAuth);

/* ---------------------------------------------------------------------------
   POST /api/documents/strom/files
     ?area=case|office & caseId=… & folderId=…
     Kopfzeile  X-Datei-Name:  URI-kodierter Dateiname
     Content-Type:             MIME-Typ der Datei (NICHT application/json)
     Koerper:                  die rohen Bytes
   --------------------------------------------------------------------------- */
router.post('/files', requireEditDocuments, async (req, res) => {
  strom.zeitgrenzeLoesen(req, res);
  const area = String(req.query.area || 'case');
  const caseId = String(req.query.caseId || '');
  const pruef = intern.scopePruefen
    ? intern.scopePruefen(req.session, area, caseId)
    : { ok: false, code: 500, error: 'Strom-Upload nicht verfügbar (interner Vertrag fehlt).' };
  if (!pruef.ok) return abweisen(req, res, () => res.status(pruef.code).json({ error: pruef.error }));

  const folderId = String(req.query.folderId || '');
  if (folderId && !(intern.ordnerGibts && intern.ordnerGibts(folderId))) {
    return abweisen(req, res, () => res.status(404).json({ error: 'Zielordner nicht gefunden.' }));
  }
  let roherName = '';
  try { roherName = decodeURIComponent(String(req.headers['x-datei-name'] || '')); }
  catch (_e) { roherName = String(req.headers['x-datei-name'] || ''); }
  const wunsch = intern.cleanName ? intern.cleanName(roherName) : roherName;
  if (!wunsch) return abweisen(req, res, () => res.status(400).json({ error: 'Dateiname fehlt oder ist ungültig (Kopfzeile X-Datei-Name).' }));

  const max = maxBytes();
  const angekuendigt = Number(req.headers['content-length'] || 0);
  /* Vorab ablehnen, sobald die angekuendigte Groesse zu gross ist - genau wie raw-body es tut.
     Damit laeuft kein Byte umsonst ueber die Leitung. */
  if (angekuendigt > max) return abweisen(req, res, () => zuGross(res, angekuendigt, 'content-length'));

  const target = intern.dateiZiel
    ? intern.dateiZiel(area, pruef.caseId, folderId, wunsch)
    : { directory: intern.blobDirFor(area, pruef.caseId, folderId), filePath: null, name: wunsch, storageRelpath: '' };
  const dir = target.directory;
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (e) {
    return abweisen(req, res, () => res.status(500).json({ error: 'Speicherort nicht beschreibbar: ' + ((e && e.message) || 'unbekannt') }));
  }
  const platz = strom.platzReicht(dir, angekuendigt || 0);
  if (!platz.ok) {
    return abweisen(req, res, () => res.status(507).json({
      error: `Zu wenig Platz am Speicherort: noch ${mb(platz.frei)} frei, benötigt werden ${mb(angekuendigt)} (zuzüglich ${mb(strom.PLATZ_RESERVE)} Sicherheitsreserve).`
    }));
  }

  const temp = strom.tempPfad(dir);
  const erg = await strom.stromSchreiben(req, temp, max);
  if (!erg.ok) {
    if (erg.grund === 'zu-gross') return abweisen(req, res, () => zuGross(res, erg.bytes, 'strom'));
    if (erg.grund === 'io') return res.status(500).json({ error: 'Schreiben auf die Platte fehlgeschlagen - es wurde nichts gespeichert.' });
    /* stromSchreiben meldet den Abbruch erst NACH dem Schließen und Löschen der
       Zwischendatei. Der Socket erzeugt anschließend kein finish/res.end mehr;
       deshalb darf genau hier der Schreibvertrag ausdrücklich enden. */
    applicationWriteBarrier.completeRequest(req);
    return;   /* Abbruch durch den Client: es gibt niemanden mehr, der eine Antwort liest. */
  }
  if (!erg.bytes) { strom.stillLoeschen(temp); return res.status(400).json({ error: 'Leere Datei.' }); }

  const id = crypto.randomUUID();
  try {
    if (!target.filePath || !intern.dateiTempPublizieren) throw new Error('Physische Pfadschicht ist nicht verfügbar.');
    intern.dateiTempPublizieren(temp, target);
  }
  catch (e) {
    strom.stillLoeschen(temp);
    return res.status(500).json({ error: 'Datei konnte nicht an ihren Platz gelegt werden: ' + ((e && e.message) || 'unbekannt') });
  }

  const mimeType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().slice(0, 120) || 'application/octet-stream';
  let eintrag;
  try {
    eintrag = intern.dateiEintragen({
      id, area: pruef.area, caseId: pruef.caseId, folderId, wunschName: wunsch, mimeType,
      finalName: target.name, storageRelpath: target.storageRelpath, filePath: target.filePath,
      size: erg.bytes, sha256: erg.sha256, createdBy: req.session.userId
    });
  } catch (_e) {
    /* Datenbankzeile gescheitert -> Blob wieder entfernen, sonst entsteht eine Waise. */
    strom.stillLoeschen(target.filePath);
    return res.status(500).json({ error: 'Eintrag in die Datenbank fehlgeschlagen - die Datei wurde wieder entfernt.' });
  }

  try { officeEvents.emit('documents', { method: 'POST', path: '/strom/files' }); } catch (_e) { /* Anzeige */ }
  try {
    if (intern.aktivitaet) {
      intern.aktivitaet(req.session.userId, req.session.displayName || req.session.username || '',
        'Datei hochgeladen (Strom)', eintrag.name, mb(erg.bytes), pruef.area, pruef.caseId);
    }
  } catch (_e) { /* Protokoll stoert nie den Betrieb */ }

  res.status(201).json({ id, name: eintrag.name, ocrStatus: eintrag.ocrStatus, size: erg.bytes, sha256: erg.sha256 });
});

/* ---------------------------------------------------------------------------
   POST /api/documents/strom/files/:id/ersetzen   - neue Fassung einer Datei
   Alte Fassung wandert wie bisher in den Versionsverlauf; erst wenn der Strom
   vollstaendig da ist, wird umbenannt und die Zeile aktualisiert.
   --------------------------------------------------------------------------- */
router.post('/files/:id/ersetzen', requireEditDocuments, async (req, res) => {
  strom.zeitgrenzeLoesen(req, res);
  const row = intern.dateiZeile ? intern.dateiZeile(String(req.params.id)) : null;
  if (!row || row.deleted_at) return abweisen(req, res, () => res.status(404).json({ error: 'Datei nicht gefunden.' }));
  const pruef = intern.scopePruefen(req.session, row.area, row.case_id || '');
  if (!pruef.ok) return abweisen(req, res, () => res.status(pruef.code).json({ error: pruef.error }));

  const max = maxBytes();
  const angekuendigt = Number(req.headers['content-length'] || 0);
  if (angekuendigt > max) return abweisen(req, res, () => zuGross(res, angekuendigt, 'content-length'));

  const currentPath = intern.findBlobPath ? intern.findBlobPath(row) : null;
  if (!currentPath) return abweisen(req, res, () => res.status(410).json({ error: 'Bestehender Dateiinhalt ist nicht auffindbar.' }));
  const target = intern.dateiZiel
    ? intern.dateiZiel(row.area, row.case_id, row.folder_id, row.name, currentPath, row.id)
    : { directory: intern.blobDirFor(row.area, row.case_id, row.folder_id), filePath: currentPath, name: row.name, storageRelpath: row.storage_relpath || '' };
  const dir = target.directory;
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (_e) { return abweisen(req, res, () => res.status(500).json({ error: 'Speicherort nicht beschreibbar.' })); }
  const platz = strom.platzReicht(dir, angekuendigt || 0);
  if (!platz.ok) {
    return abweisen(req, res, () => res.status(507).json({
      error: `Zu wenig Platz am Speicherort: noch ${mb(platz.frei)} frei, benötigt werden ${mb(angekuendigt)}.`
    }));
  }

  const temp = strom.tempPfad(dir);
  const erg = await strom.stromSchreiben(req, temp, max);
  if (!erg.ok) {
    if (erg.grund === 'zu-gross') return abweisen(req, res, () => zuGross(res, erg.bytes, 'strom'));
    if (erg.grund === 'io') return res.status(500).json({ error: 'Schreiben auf die Platte fehlgeschlagen - die bestehende Fassung ist unberührt.' });
    /* Wie beim Neuanlegen: erst nach bestätigter Temp-Bereinigung freigeben. */
    applicationWriteBarrier.completeRequest(req);
    return;   /* Abbruch: die bestehende Fassung wurde nicht angefasst. */
  }
  if (!erg.bytes) { strom.stillLoeschen(temp); return res.status(400).json({ error: 'Leere Datei - die bestehende Fassung bleibt.' }); }

  // Der gemeinsame Commit-Punkt kopiert die alte Fassung zuerst als Version,
  // tauscht dann physisch und bestätigt DB + Sidecar in einer Transaktion.
  try {
    if (!intern.dateiTempErsetzen) throw new Error('Sicherer Ersetzungsweg ist nicht verfügbar.');
    const mimeType = String(req.headers['content-type'] || row.mime_type || 'application/octet-stream').split(';')[0].trim().slice(0, 120);
    const info = intern.dateiTempErsetzen(row, temp, {
      target,
      mimeType,
      size: erg.bytes,
      sha256: erg.sha256,
      userId: req.session.userId,
      username: req.session.displayName || req.session.username || ''
    });
    try { officeEvents.emit('documents', { method: 'POST', path: '/strom/ersetzen' }); } catch (_e) { /* Anzeige */ }
    try {
      if (intern.aktivitaet) {
        intern.aktivitaet(req.session.userId, req.session.displayName || req.session.username || '',
          'Neue Fassung (Strom)', row.name, mb(erg.bytes), row.area, row.case_id || '');
      }
    } catch (_e) { /* Protokoll */ }
    return res.json({ ok: true, versionen: info.versionen, size: info.size, sha256: info.sha256 });
  }
  catch (error) {
    return res.status(500).json({
      error: 'Neue Fassung wurde nicht übernommen; die bisherige Primärdatei bleibt erreichbar: '
        + ((error && error.message) || 'unbekannter Fehler')
    });
  }
});

/* Auskunft fuer den Client: aktuelle Obergrenze - damit die Vorabpruefung im Browser nie von der
   Server-Einstellung abweicht (heute war sie an zwei von fuenf Aufrufern fest einkodiert). */
router.get('/grenze', (req, res) => {
  res.json({ maxBytes: maxBytes(), maxText: mb(maxBytes()) });
});

/* Catch-all: dieser Pfadzweig wird VOLLSTAENDIG hier beantwortet. Ohne ihn fiele ein Tippfehler
   in der URL durch bis zur globalen Sitzungs-Middleware und liefe dort ein zweites Mal
   durch express-session. */
router.use((req, res) => {
  res.status(404).json({ error: 'Unbekannter Strom-Endpunkt.' });
});

/* Liegengebliebene Zwischendateien aufraeumen - NUR der eigene Prefix '.strom-*.part',
   NUR aelter als 24 h. Eine laufende Uebertragung wird dadurch nie getroffen.
   v176: frueher lief das ausschliesslich beim Serverstart. Seit die Zeitgrenze je Anfrage
   geloest ist (index.js: requestTimeout 60 min statt der 300-s-Vorgabe von Node - noetig fuer
   1024-MB-Uploads), kann eine haengende Uebertragung ihre Zwischendatei deutlich laenger
   halten. Auf einem Server, der wochenlang durchlaeuft, raeumte danach niemand mehr nach.
   Deshalb zusaetzlich alle 6 Stunden. Die 60 Minuten bleiben unveraendert; der Schutz gegen
   langsam tropfende Verbindungen haengt an headersTimeout (60 s), nicht an dieser Stelle. */
async function altlastenLauf() {
  try {
    return await applicationWriteBarrier.withWrite(
      'Bereinigung liegengebliebener Upload-Zwischendateien',
      () => {
        const cfg = intern.readCfg ? intern.readCfg() : {};
        const dirs = [intern.blobDirFor('office', ''), cfg.storageRoot, cfg.legacyBaseDir]
          .concat(Object.values(cfg.caseDirs || {}));
        const weg = strom.altlastenRaeumen(dirs);
        if (weg) console.log(`[Strom-Upload] ${weg} liegengebliebene Zwischendatei(en) aufgeräumt.`);
        return weg;
      }
    );
  } catch (_e) {
    /* Aufraeumen darf den Start nie verhindern */
    return { started: false, skipped: false, error: true };
  }
}
const altlastenTimer = setTimeout(() => { void altlastenLauf(); }, 5000);
altlastenTimer.unref?.();
const altlastenIntervall = setInterval(() => { void altlastenLauf(); }, 6 * 60 * 60 * 1000);
altlastenIntervall.unref?.();

module.exports = router;
