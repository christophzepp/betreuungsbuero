// WebDAV-Freigabe des Dokumentenspeichers (Plan D7, Nutzerauftrag 2026-07-25): der physische,
// lesbare Ordnerbaum wird über seinen SQLite-Index als Netzlaufwerk bereitgestellt - Finder
// ("Mit Server verbinden", Cmd+K) und Windows sprechen direkt mit diesem Endpunkt.
//
// Anmeldung: HTTP Basic mit Benutzername + APP-PASSWORT (doc_webdav_tokens, nur bcrypt-Hash
// gespeichert; verwaltet im Dokumente-Modul unter Einstellungen). NIE das Anmelde-Passwort.
// Rechte: dieselbe Rechte-Matrix wie die App (permissions.hasPermission, Modus 'online') -
// Lesen braucht viewDocuments, Schreiben editDocuments; Admins wie ueberall ausgenommen.
//
// Baum-Sicht: /webdav/Fallakten/<A-Z>/<Fallname>/... und /webdav/Büroorganisation/...
// Verhalten:  GET/PUT/MKCOL/DELETE/MOVE/COPY auf dem virtuellen Baum; DELETE verschiebt in den
// PAPIERKORB des Moduls (30 Tage wiederherstellbar - dieselbe Sicherheit wie im Explorer).
// Finder-Eigenheiten: LOCK/UNLOCK werden als Schein-Sperren beantwortet (Klasse 2, sonst
// verweigert Finder das Schreiben); AppleDouble-Dateien (._*, .DS_Store) werden angenommen,
// aber BEWUSST verworfen, damit sie den Dokumentenspeicher nicht zumuellen.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const bcrypt = require('bcrypt');
const db = require('../../database/index');
const permissions = require('../../middleware/authorization');
const events = require('../../modules/office/events');
const dokumente = require('../../modules/documents/routes');
const strom = require('../../shared/streamed-file');
const documentNames = require('../../modules/documents/names');
const applicationWriteBarrier = require('../../middleware/application-write-barrier');
const intern = dokumente.intern || {};

/* 2026-07-27: EINE Obergrenze fuer den ganzen Dokumentenspeicher. Bis hierher fuehrte webdav.js
   eine eigene 100-MB-Konstante, die getrennt gepflegt werden musste - jetzt kommt sie aus
   routes/documents.js (intern.MAX_FILE). Der Fallback greift nur, falls der Vertrag fehlt. */
const MAX_PUT = Number(intern.MAX_FILE) || (1024 * 1024 * 1024);

/* ------------------------------- Statements ------------------------------- */
const userByNameStmt = db.prepare('SELECT * FROM users WHERE username = ?');
const tokensByUserStmt = db.prepare('SELECT * FROM doc_webdav_tokens WHERE user_id = ?');
const tokenTouchStmt = db.prepare("UPDATE doc_webdav_tokens SET last_used_at = datetime('now') WHERE id = ?");
const casesStmt = db.prepare('SELECT id, label FROM cases WHERE archived = 0 ORDER BY label COLLATE NOCASE');
const archivCasesStmt = db.prepare('SELECT id, label FROM cases WHERE archived = 1 ORDER BY label COLLATE NOCASE');
const foldersStmt = db.prepare('SELECT * FROM doc_folders WHERE area = ? AND case_id = ? ORDER BY name COLLATE NOCASE');
const filesInFolderStmt = db.prepare("SELECT * FROM doc_files WHERE area = ? AND case_id = ? AND folder_id = ? AND deleted_at = '' ORDER BY name COLLATE NOCASE");
const fileByNameStmt = db.prepare("SELECT * FROM doc_files WHERE area = ? AND case_id = ? AND folder_id = ? AND deleted_at = '' AND name = ? COLLATE NOCASE");
const fileInsStmt = db.prepare(`INSERT INTO doc_files (id, area, case_id, folder_id, name, mime_type, size, pages, sha256, ocr_status, created_by)
  VALUES (@id, @area, @caseId, @folderId, @name, @mimeType, @size, @pages, @sha256, @ocrStatus, @createdBy)`);
const fileUeberschreibStmt = db.prepare(`UPDATE doc_files SET size=@size, sha256=@sha256, mime_type=@mimeType, pages=0, ocr_status=@ocrStatus, updated_at=datetime('now') WHERE id=@id`);
const fileMoveStmt = db.prepare("UPDATE doc_files SET folder_id=@folderId, name=@name, updated_at=datetime('now') WHERE id=@id");
const fileTrashStmt = db.prepare(`UPDATE doc_files SET deleted_at=datetime('now'), deleted_from=folder_id, folder_id='', deleted_by=@userId, updated_at=datetime('now') WHERE id=@id`);
const folderInsStmt = db.prepare(`INSERT INTO doc_folders (id, area, case_id, parent_id, name, created_by)
  VALUES (@id, @area, @caseId, @parentId, @name, @createdBy)`);
const folderMoveStmt = db.prepare('UPDATE doc_folders SET parent_id=@parentId, name=@name WHERE id=@id');
const folderDelStmt = db.prepare('DELETE FROM doc_folders WHERE id = ?');
const textDelStmt = db.prepare('DELETE FROM doc_text WHERE file_id = ?');
const textKopieStmt = db.prepare('INSERT INTO doc_text (file_id, page, text) SELECT ?, page, text FROM doc_text WHERE file_id = ?');

/* ------------------------------- Anmeldung -------------------------------- */
// bcrypt ist absichtlich langsam - der Finder feuert aber DUTZENDE Requests pro Sekunde.
// Deshalb ein kurzlebiger In-Memory-Cache (10 min) ueber den sha256 des Passworts.
const authCache = new Map();
const tokenLastTouch = new Map();
try {
  process.on('dok-webdav-token-widerruf', () => {
    authCache.clear();
    tokenLastTouch.clear();
  });
} catch (_e) { /* nie kritisch */ }

/*
 * Auch ein lesender WebDAV-Aufruf aktualisiert die Nutzungsstatistik. Der
 * Dokumentdownload selbst bleibt während einer Gesamtsicherung erlaubt; nur
 * der kleine SQLite-Schreibzugriff meldet sich an der Barriere an. Wird er
 * übersprungen, bleibt der Eintrag in tokenLastTouch absichtlich unverändert:
 * der nächste (auch gecachte) Zugriff holt ihn nach der Sicherung nach.
 */
function tokenNutzungBeruehren(tokenId) {
  const now = Date.now();
  if ((tokenLastTouch.get(tokenId) || 0) >= now - 10 * 60 * 1000) return;
  applicationWriteBarrier.withWrite('WebDAV-Zugang verwendet', () => {
    tokenTouchStmt.run(tokenId);
    tokenLastTouch.set(tokenId, now);
  }).catch(() => { /* Statistikfeld, Anmeldung bleibt funktionsfähig */ });
}

function rechteVon(user) {
  return {
    view: permissions.hasPermission(user, 'online', 'viewDocuments'),
    alleFaelle: permissions.hasPermission(user, 'online', 'docsAllCases'),
    edit: permissions.hasPermission(user, 'online', 'editDocuments')
  };
}

function pruefeAuth(req) {
  const h = String(req.headers.authorization || '');
  if (!/^Basic /i.test(h)) return null;
  let name = '', pass = '';
  try {
    const dec = Buffer.from(h.slice(6).trim(), 'base64').toString('utf8');
    const i = dec.indexOf(':');
    if (i < 0) return null;
    name = dec.slice(0, i); pass = dec.slice(i + 1);
  } catch (_e) { return null; }
  if (!name || !pass) return null;
  const key = name + ':' + crypto.createHash('sha256').update(pass).digest('hex');
  const cached = authCache.get(key);
  if (cached && cached.bis > Date.now()) {
    tokenNutzungBeruehren(cached.tokenId);
    return cached;
  }
  const user = userByNameStmt.get(name);
  if (!user) return null;
  for (const tk of tokensByUserStmt.all(user.id)) {
    let ok = false;
    try { ok = bcrypt.compareSync(pass, tk.pass_hash); } catch (_e) { ok = false; }
    if (ok) {
      tokenNutzungBeruehren(tk.id);
      const eintrag = {
        userId: user.id,
        user,
        rechte: rechteVon(user),
        tokenId: tk.id,
        bis: Date.now() + 10 * 60 * 1000
      };
      authCache.set(key, eintrag);
      return eintrag;
    }
  }
  return null;
}

/* ------------------------------ Baum-Aufloesung --------------------------- */
const WURZEL_FAELLE = 'Fallakten';
const WURZEL_ARCHIV = 'Fallakten-Archiv';   /* D13: abgeschlossene Faelle, schreibgeschuetzt */
const WURZEL_BUERO = 'Büroorganisation';

function fallVerzeichnis(archiviert) {
  const liste = [];
  for (const c of (archiviert ? archivCasesStmt : casesStmt).all()) {
    try {
      const info = intern.documentStorage && intern.documentStorage.caseRootInfo(c.id, false);
      if (info) {
        liste.push({ name: info.folderName, caseId: c.id, letter: info.letter });
        continue;
      }
    } catch (_error) { /* Label-Fallback */ }
    const name = (intern.cleanName ? intern.cleanName(c.label) : String(c.label || '').trim()) || ('Fall ' + String(c.id).slice(0, 8));
    let letter = String(name).normalize('NFD').replace(/\p{M}/gu, '').charAt(0).toUpperCase();
    if (!/^[A-Z]$/.test(letter)) letter = 'Z';
    liste.push({ name, caseId: c.id, letter });
  }
  const belegt = new Map();
  for (const item of liste) {
    const scope = (archiviert ? '' : item.letter + '|') + documentNames.vergleichsschluessel(item.name);
    const count = belegt.get(scope) || 0;
    belegt.set(scope, count + 1);
    if (count) {
      item.name += ' ' + String(item.caseId).slice(0, 8);
    }
  }
  return liste;
}

function segmenteVon(req) {
  const roh = decodeURIComponent(String(req.url || '/').split('?')[0]);
  return roh.split('/').filter(Boolean);
}

// Loest einen Pfad in {typ, area, caseId, folderId, folder, file, name, elternOk} auf.
function aufloesen(seg) {
  if (!seg.length) return { typ: 'root' };
  let area = null, caseId = '', rest = seg;
  const imArchiv = seg[0] === WURZEL_ARCHIV;
  if (seg[0] === WURZEL_FAELLE || imArchiv) {
    if (seg.length === 1) return { typ: 'faelle', archiv: imArchiv };
    if (!imArchiv && seg.length === 2 && /^[A-Z]$/.test(seg[1])) return { typ: 'buchstabe', letter: seg[1] };
    const fallIndex = imArchiv ? 1 : 2;
    if (!imArchiv && !/^[A-Z]$/.test(seg[1])) return { typ: 'fehlt' };
    const fall = fallVerzeichnis(imArchiv).find(f => (!imArchiv ? f.letter === seg[1] : true)
      && documentNames.dateinamenGleich(f.name, seg[fallIndex]));
    if (!fall) return { typ: 'fehlt' };
    area = 'case'; caseId = fall.caseId; rest = seg.slice(fallIndex + 1);
  } else if (seg[0] === WURZEL_BUERO || seg[0] === 'Bueroorganisation') {
    area = 'office'; rest = seg.slice(1);
  } else return { typ: 'fehlt' };

  const alle = foldersStmt.all(area, caseId);
  let folderId = '', folder = null;
  for (let i = 0; i < rest.length; i++) {
    const teil = rest[i];
    const kind = alle.find(f => f.parent_id === folderId && documentNames.dateinamenGleich(f.name, teil));
    if (kind) { folderId = kind.id; folder = kind; continue; }
    if (i === rest.length - 1) {
      const datei = filesInFolderStmt.all(area, caseId, folderId)
        .find((file) => documentNames.dateinamenGleich(file.name, teil));
      if (datei) return { typ: 'datei', area, caseId, folderId, file: datei };
      return { typ: 'fehlt', area, caseId, folderId, name: teil, elternOk: true };
    }
    return { typ: 'fehlt' };
  }
  return { typ: 'ordner', area, caseId, folderId, folder };
}

/* ------------------------------ XML-Bausteine ------------------------------ */
function xmlEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function hrefVon(basis, segmente, istDir) {
  const p = '/webdav/' + segmente.map(encodeURIComponent).join('/');
  return p + (istDir && segmente.length ? '/' : (istDir ? '' : ''));
}
function httpDatum(sql) {
  const d = new Date(String(sql || '').replace(' ', 'T') + (String(sql || '').includes('T') ? '' : 'Z'));
  return isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}
function eintragXml(segmente, anzeige, istDir, groesse, geaendert, mime) {
  return '<d:response><d:href>' + xmlEsc(hrefVon('', segmente, istDir) || '/webdav/') + '</d:href>'
    + '<d:propstat><d:prop>'
    + '<d:displayname>' + xmlEsc(anzeige) + '</d:displayname>'
    + '<d:resourcetype>' + (istDir ? '<d:collection/>' : '') + '</d:resourcetype>'
    + (istDir ? '' : '<d:getcontentlength>' + (Number(groesse) || 0) + '</d:getcontentlength>')
    + (istDir ? '' : '<d:getcontenttype>' + xmlEsc(mime || 'application/octet-stream') + '</d:getcontenttype>')
    + '<d:getlastmodified>' + xmlEsc(httpDatum(geaendert)) + '</d:getlastmodified>'
    + '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';
}
function multistatus(res, inhalt) {
  res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8', DAV: '1, 2' });
  res.end('<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">' + inhalt + '</d:multistatus>');
}
function fehler(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text || '');
}
function istMuell(name) {
  return /^\._/.test(name) || name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini' || name === '.Trashes';
}
function koerperLesen(req, max) {
  return new Promise((resolve, reject) => {
    const teile = []; let gesamt = 0;
    req.on('data', c => {
      gesamt += c.length;
      if (gesamt > max) { reject(Object.assign(new Error('zu groß'), { code: 413 })); req.destroy(); return; }
      teile.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(teile)));
    req.on('error', reject);
  });
}
function nachfahren(area, caseId, rootId) {
  const alle = foldersStmt.all(area, caseId);
  const ids = [rootId], stapel = [rootId];
  while (stapel.length) {
    const p = stapel.pop();
    for (const f of alle) if (f.parent_id === p) { ids.push(f.id); stapel.push(f.id); }
  }
  return ids;
}

/* --------------------------------- Handler --------------------------------- */
module.exports = async function webdavHandler(req, res) {
  try {
    const methode = String(req.method || '').toUpperCase();
    if (methode === 'OPTIONS') {
      res.writeHead(200, {
        DAV: '1, 2', 'MS-Author-Via': 'DAV',
        Allow: 'OPTIONS, GET, HEAD, PUT, PROPFIND, PROPPATCH, MKCOL, DELETE, MOVE, COPY, LOCK, UNLOCK'
      });
      return res.end();
    }
    const auth = pruefeAuth(req);
    if (!auth || !auth.rechte.view) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Betreuungsbüro Dokumente"' });
      return res.end();
    }
    const schreibend = ['PUT', 'MKCOL', 'DELETE', 'MOVE', 'COPY', 'PROPPATCH', 'LOCK', 'UNLOCK'].includes(methode);
    if (schreibend && !auth.rechte.edit) return fehler(res, 403, 'Kein Schreibrecht für Dokumente.');
    const seg = segmenteVon(req);
    const tiefe = String(req.headers.depth || '1');
    // D11: ohne docsAllCases-Recht ist im Netzlaufwerk nur die Bueroorganisation zugaenglich.
    if (auth.rechte.alleFaelle === false && (seg[0] === WURZEL_FAELLE || seg[0] === WURZEL_ARCHIV)) return fehler(res, 403, 'Nur Büroorganisation verfügbar (Recht „alle Fallakten" fehlt).');
    // D13: das Archiv ist schreibgeschuetzt - Aenderungen nur nach Reaktivierung des Falls.
    if (schreibend && seg[0] === WURZEL_ARCHIV) return fehler(res, 403, 'Das Archiv ist schreibgeschützt - den Fall bei Bedarf reaktivieren.');
    // D13: Netzlaufwerk-Aktionen ins Aktivitaetenprotokoll (gleiche Liste wie im Modul).
    if (intern.aktivitaet && ['PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY'].includes(methode)) {
      const segLog = seg.slice();
      res.on('finish', () => {
        try {
          if (res.statusCode >= 400) return;
          const name = segLog[segLog.length - 1] || '';
          if (!name || istMuell(name)) return;
          let area = '', caseId = '';
          if (segLog[0] === WURZEL_BUERO) area = 'office';
          else if (segLog[0] === WURZEL_FAELLE || segLog[0] === WURZEL_ARCHIV) {
            area = 'case';
            const archiviert = segLog[0] === WURZEL_ARCHIV;
            const fallIndex = archiviert ? 1 : 2;
            const f = fallVerzeichnis(archiviert).find(x =>
              (archiviert || x.letter === segLog[1])
              && documentNames.dateinamenGleich(x.name, segLog[fallIndex] || '')
            );
            caseId = f ? f.caseId : '';
          }
          const AKT = { PUT: res.statusCode === 204 ? 'Datei überschrieben (Netzlaufwerk, Version gesichert)' : 'Datei hochgeladen (Netzlaufwerk)',
            DELETE: 'Gelöscht (Netzlaufwerk)', MKCOL: 'Ordner angelegt (Netzlaufwerk)', MOVE: 'Umbenannt/verschoben (Netzlaufwerk)', COPY: 'Kopiert (Netzlaufwerk)' };
          intern.aktivitaet(auth.userId, (auth.user && auth.user.username) || '', AKT[methode], name, segLog.join('/').slice(0, 250), area, caseId);
        } catch (_e) { /* Protokoll stoert nie den Betrieb */ }
      });
    }


    if (methode === 'PROPFIND') {
      const ziel = aufloesen(seg);
      if (ziel.typ === 'fehlt') return fehler(res, 404);
      let inhalt = '';
      if (ziel.typ === 'root') {
        inhalt += eintragXml([], 'Dokumente', true, 0, '', '');
        if (tiefe !== '0') {
          inhalt += eintragXml([WURZEL_FAELLE], WURZEL_FAELLE, true, 0, '', '');
          inhalt += eintragXml([WURZEL_BUERO], WURZEL_BUERO, true, 0, '', '');
          if (fallVerzeichnis(true).length) inhalt += eintragXml([WURZEL_ARCHIV], WURZEL_ARCHIV, true, 0, '', '');
        }
      } else if (ziel.typ === 'faelle') {
        const wz = ziel.archiv ? WURZEL_ARCHIV : WURZEL_FAELLE;
        inhalt += eintragXml([wz], wz, true, 0, '', '');
        if (tiefe !== '0') {
          if (ziel.archiv) {
            for (const f of fallVerzeichnis(true)) inhalt += eintragXml([wz, f.name], f.name, true, 0, '', '');
          } else {
            const letters = [...new Set(fallVerzeichnis(false).map((f) => f.letter))].sort();
            for (const letter of letters) inhalt += eintragXml([wz, letter], letter, true, 0, '', '');
          }
        }
      } else if (ziel.typ === 'buchstabe') {
        inhalt += eintragXml([WURZEL_FAELLE, ziel.letter], ziel.letter, true, 0, '', '');
        if (tiefe !== '0') {
          for (const f of fallVerzeichnis(false).filter((item) => item.letter === ziel.letter)) {
            inhalt += eintragXml([WURZEL_FAELLE, ziel.letter, f.name], f.name, true, 0, '', '');
          }
        }
      } else if (ziel.typ === 'ordner') {
        const name = ziel.folder ? ziel.folder.name : (seg[seg.length - 1] || 'Dokumente');
        inhalt += eintragXml(seg, name, true, 0, ziel.folder ? ziel.folder.created_at : '', '');
        if (tiefe !== '0') {
          for (const f of foldersStmt.all(ziel.area, ziel.caseId).filter(x => x.parent_id === ziel.folderId)) {
            inhalt += eintragXml(seg.concat([f.name]), f.name, true, 0, f.created_at, '');
          }
          for (const d of filesInFolderStmt.all(ziel.area, ziel.caseId, ziel.folderId)) {
            inhalt += eintragXml(seg.concat([d.name]), d.name, false, d.size, d.updated_at, d.mime_type);
          }
        }
      } else if (ziel.typ === 'datei') {
        inhalt += eintragXml(seg, ziel.file.name, false, ziel.file.size, ziel.file.updated_at, ziel.file.mime_type);
      }
      return multistatus(res, inhalt);
    }

    if (methode === 'GET' || methode === 'HEAD') {
      const ziel = aufloesen(seg);
      if (ziel.typ !== 'datei') return fehler(res, ziel.typ === 'fehlt' ? 404 : 405);
      const p = intern.findBlobPath ? intern.findBlobPath(ziel.file) : null;
      if (!p) return fehler(res, 404, 'Dateiinhalt nicht am Speicherort.');
      const st = fs.statSync(p);
      res.writeHead(200, {
        'Content-Type': ziel.file.mime_type || 'application/octet-stream',
        'Content-Length': st.size,
        'Last-Modified': httpDatum(ziel.file.updated_at)
      });
      if (methode === 'HEAD') return res.end();
      return fs.createReadStream(p).pipe(res);
    }

    if (methode === 'PUT') {
      /* 2026-07-27 umgestellt: bis hierher sammelte koerperLesen ALLE Stuecke in einem Array und
         verkettete sie am Ende - die Datei lag damit zweimal vollstaendig im Arbeitsspeicher
         (gemessen 2,1x der Dateigroesse). Jetzt fliesst der Koerper direkt in eine Zwischendatei
         im ZIELVERZEICHNIS, die Pruefsumme laeuft mit; erst nach vollstaendigem Empfang wird
         umbenannt und die Datenbank angefasst. Ohne diese Umstellung waere die neue Obergrenze
         von 1024 MB hier eine Speicherfalle statt einer Erlaubnis. */
      const ziel = aufloesen(seg);
      const name = seg[seg.length - 1] || '';
      /* AppleDouble/.DS_Store: annehmen und verwerfen. Deckel bewusst 10 MB statt MAX_PUT -
         Muell darf nicht 1 GB Arbeitsspeicher kosten, nur um weggeworfen zu werden. */
      if (istMuell(name)) { await koerperLesen(req, 10 * 1024 * 1024).catch(() => null); res.writeHead(201); return res.end(); }
      const sauber = (intern.cleanName ? intern.cleanName(name) : name) || '';
      if (!sauber) return fehler(res, 400, 'Ungültiger Dateiname.');
      const brauchtText = /\.(pdf|jpe?g|png|gif|tiff?|heic)$/i.test(sauber);
      const neu = (ziel.typ === 'fehlt' && ziel.elternOk);
      if (ziel.typ !== 'datei' && !neu) return fehler(res, 409, 'Zielordner existiert nicht.');
      const currentPath = !neu && intern.findBlobPath ? intern.findBlobPath(ziel.file) : null;
      const target = intern.dateiZiel
        ? intern.dateiZiel(
          neu ? ziel.area : ziel.file.area,
          neu ? ziel.caseId : ziel.file.case_id,
          neu ? ziel.folderId : ziel.file.folder_id,
          sauber,
          currentPath,
          neu ? '' : ziel.file.id
        )
        : null;
      const dir = target && target.directory;
      if (!dir) return fehler(res, 500, 'Speicherort nicht verfügbar.');
      strom.zeitgrenzeLoesen(req, res);
      const angekuendigt = Number(req.headers['content-length'] || 0);
      if (angekuendigt > MAX_PUT) {
        return fehler(res, 413, `Die Datei ist ${strom.groessenText(angekuendigt)} groß, erlaubt sind höchstens ${strom.groessenText(MAX_PUT)}.`);
      }
      fs.mkdirSync(dir, { recursive: true });
      const platz = strom.platzReicht(dir, angekuendigt || 0);
      if (!platz.ok) return fehler(res, 507, `Zu wenig Platz am Speicherort: noch ${strom.groessenText(platz.frei)} frei.`);
      const temp = strom.tempPfad(dir);
      const erg = await strom.stromSchreiben(req, temp, MAX_PUT);
      if (!erg.ok) {
        if (erg.grund === 'zu-gross') return fehler(res, 413, `Die Datei ist mindestens ${strom.groessenText(erg.bytes)} groß, erlaubt sind höchstens ${strom.groessenText(MAX_PUT)}.`);
        if (erg.grund === 'io') return fehler(res, 500, 'Schreiben auf die Platte fehlgeschlagen.');
        /* Temp-Datei ist bereits geschlossen und entfernt; ein abgebrochener
           Socket emittiert danach weder finish noch res.end. */
        applicationWriteBarrier.completeRequest(req);
        return;   /* Abbruch durch den Client - nichts angelegt, niemand liest eine Antwort. */
      }
      if (ziel.typ === 'datei') {
        // Ueberschreiben: gleicher Datensatz, neuer Inhalt - Text-Index wird verworfen (veraltet).
        // Der gemeinsame Ersetzungsweg hält Primärdatei, Version, DB und Sidecar zusammen.
        try {
          if (!intern.dateiTempErsetzen) throw new Error('Sicherer Ersetzungsweg fehlt.');
          intern.dateiTempErsetzen(ziel.file, temp, {
            target,
            mimeType: ziel.file.mime_type || 'application/octet-stream',
            size: erg.bytes,
            sha256: erg.sha256,
            userId: auth.userId,
            username: (auth.user && auth.user.username) || 'WebDAV'
          });
        }
        catch (error) {
          return fehler(res, 500,
            'Neue Fassung wurde nicht übernommen; die bisherige Primärdatei bleibt erreichbar: '
            + ((error && error.message) || 'unbekannter Fehler'));
        }
        events.emit('documents', { method: 'PUT', path: '/webdav' });
        res.writeHead(204); return res.end();
      }
      const id = crypto.randomUUID();
      try {
        if (!intern.dateiTempPublizieren) throw new Error('Physische Pfadschicht fehlt.');
        intern.dateiTempPublizieren(temp, target);
      }
      catch (_e) { strom.stillLoeschen(temp); return fehler(res, 500, 'Datei konnte nicht abgelegt werden.'); }
      try {
        intern.dateiEintragen({
          id, area: ziel.area, caseId: ziel.caseId, folderId: ziel.folderId,
          wunschName: sauber, finalName: target.name, storageRelpath: target.storageRelpath,
          filePath: target.filePath, mimeType: 'application/octet-stream', size: erg.bytes,
          sha256: erg.sha256, createdBy: auth.userId
        });
      } catch (_e) {
        strom.stillLoeschen(target.filePath);   /* keine Waise ohne Datenbankzeile hinterlassen */
        return fehler(res, 500, 'Eintrag in die Datenbank fehlgeschlagen - die Datei wurde wieder entfernt.');
      }
      events.emit('documents', { method: 'PUT', path: '/webdav' });
      res.writeHead(201); return res.end();
    }

    if (methode === 'MKCOL') {
      const seg2 = seg.slice();
      const name = seg2.pop() || '';
      const eltern = aufloesen(seg2);
      if (eltern.typ !== 'ordner') return fehler(res, 409, 'Übergeordneter Ordner fehlt.');
      const sauber = (intern.cleanName ? intern.cleanName(name) : name) || '';
      if (!sauber || istMuell(sauber)) return fehler(res, 400, 'Ungültiger Ordnername.');
      const schon = foldersStmt.all(eltern.area, eltern.caseId)
        .some(f => f.parent_id === eltern.folderId && documentNames.dateinamenGleich(f.name, sauber));
      const dateiSchon = filesInFolderStmt.all(eltern.area, eltern.caseId, eltern.folderId)
        .some((file) => documentNames.dateinamenGleich(file.name, sauber));
      if (schon || dateiSchon) return fehler(res, 405, 'Existiert bereits.');
      const folderId = crypto.randomUUID();
      folderInsStmt.run({ id: folderId, area: eltern.area, caseId: eltern.caseId, parentId: eltern.folderId, name: sauber, createdBy: auth.userId });
      try {
        if (intern.ordnerPhysisch) intern.ordnerPhysisch(folderId);
      } catch (error) {
        folderDelStmt.run(folderId);
        return fehler(res, 500, 'Ordner konnte auf der Platte nicht angelegt werden: ' + (error.message || error));
      }
      events.emit('documents', { method: 'MKCOL', path: '/webdav' });
      res.writeHead(201); return res.end();
    }

    if (methode === 'DELETE') {
      const ziel = aufloesen(seg);
      if (ziel.typ === 'datei') {
        try {
          if (!intern.dateiPapierkorb) throw new Error('Physische Pfadschicht fehlt.');
          intern.dateiPapierkorb(ziel.file, auth.userId);
        } catch (error) { return fehler(res, 409, 'Datei konnte nicht sicher in den Papierkorb verschoben werden: ' + (error.message || error)); }
        events.emit('documents', { method: 'DELETE', path: '/webdav' });
        res.writeHead(204); return res.end();
      }
      if (ziel.typ === 'ordner' && ziel.folder) {
        const ids = nachfahren(ziel.area, ziel.caseId, ziel.folder.id);
        if (!ziel.folder.parent_id && /^(?:0\d|1[0-2]) - /.test(ziel.folder.name)) {
          return fehler(res, 409, 'Ein verbindliches Register 00–12 kann nicht gelöscht werden.');
        }
        for (const fid of ids) {
          for (const d of filesInFolderStmt.all(ziel.area, ziel.caseId, fid)) {
            try { intern.dateiPapierkorb(d, auth.userId); }
            catch (error) { return fehler(res, 409, `Ordner nicht gelöscht; „${d.name}“ konnte nicht sicher verschoben werden.`); }
          }
        }
        for (const fid of ids.reverse()) folderDelStmt.run(fid);
        events.emit('documents', { method: 'DELETE', path: '/webdav' });
        res.writeHead(204); return res.end();
      }
      return fehler(res, ziel.typ === 'fehlt' ? 404 : 403);
    }

    if (methode === 'MOVE' || methode === 'COPY') {
      const quelle = aufloesen(seg);
      if (quelle.typ !== 'datei' && !(methode === 'MOVE' && quelle.typ === 'ordner' && quelle.folder)) {
        return fehler(res, quelle.typ === 'fehlt' ? 404 : (methode === 'COPY' ? 501 : 403), methode === 'COPY' ? 'Ordner-Kopie nicht unterstützt.' : '');
      }
      let zielSeg;
      try {
        const dest = String(req.headers.destination || '');
        const u = new URL(dest, 'http://x');
        zielSeg = decodeURIComponent(u.pathname).replace(/^\/webdav\/?/, '').split('/').filter(Boolean);
      } catch (_e) { return fehler(res, 400, 'Destination fehlt.'); }
      const zielName = (intern.cleanName ? intern.cleanName(zielSeg[zielSeg.length - 1] || '') : zielSeg[zielSeg.length - 1]) || '';
      const zielEltern = aufloesen(zielSeg.slice(0, -1));
      if (zielEltern.typ !== 'ordner') return fehler(res, 409, 'Zielordner fehlt.');
      if (zielEltern.area !== (quelle.area) || zielEltern.caseId !== (quelle.caseId)) {
        return fehler(res, 403, 'Verschieben zwischen Fallakten/Bereichen bitte im Dokumente-Modul.');
      }
      if (quelle.typ === 'datei') {
        const bestehend = filesInFolderStmt.all(zielEltern.area, zielEltern.caseId, zielEltern.folderId)
          .find((file) => documentNames.dateinamenGleich(file.name, zielName));
        if (bestehend && bestehend.id !== quelle.file.id) {
          return fehler(res, 412, 'Ziel existiert bereits; WebDAV überschreibt Kollisionen nicht still.');
        }
        if (methode === 'MOVE') {
          try { intern.dateiVerschieben(quelle.file, zielEltern.folderId, zielName); }
          catch (error) { return fehler(res, 409, 'Datei konnte nicht verschoben werden: ' + (error.message || error)); }
        } else {
          try { intern.dateiKopie(quelle.file, zielEltern.folderId, zielName, auth.userId); }
          catch (error) { return fehler(res, 409, 'Datei konnte nicht kopiert werden: ' + (error.message || error)); }
        }
      } else {
        // Ordner verschieben/umbenennen (gleiche Fallakte); Zyklus-Schutz wie im Modul.
        if (nachfahren(quelle.area, quelle.caseId, quelle.folder.id).includes(zielEltern.folderId)) {
          return fehler(res, 403, 'Ein Ordner kann nicht in sich selbst verschoben werden.');
        }
        if (!quelle.folder.parent_id && /^(?:0\d|1[0-2]) - /.test(quelle.folder.name)) {
          return fehler(res, 409, 'Ein verbindliches Register 00–12 kann nicht verschoben oder umbenannt werden.');
        }
        try {
          if (!intern.ordnerVerschieben) throw new Error('Physische Pfadschicht fehlt.');
          intern.ordnerVerschieben(quelle.folder.id, zielEltern.folderId, zielName || quelle.folder.name);
        } catch (error) { return fehler(res, 409, 'Ordner konnte nicht verschoben werden: ' + (error.message || error)); }
      }
      events.emit('documents', { method: methode, path: '/webdav' });
      res.writeHead(bestandCode(methode, req)); return res.end();
    }

    if (methode === 'PROPPATCH') {
      // Zeitstempel-Setzversuche des Finders freundlich bestaetigen (wir fuehren eigene Zeiten).
      await koerperLesen(req, 1024 * 1024).catch(() => null);
      return multistatus(res, '<d:response><d:href>' + xmlEsc('/webdav/' + seg.map(encodeURIComponent).join('/')) + '</d:href><d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>');
    }

    if (methode === 'LOCK') {
      await koerperLesen(req, 1024 * 1024).catch(() => null);
      const token = 'opaquelocktoken:' + crypto.randomUUID();
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Lock-Token': '<' + token + '>' });
      return res.end('<?xml version="1.0" encoding="utf-8"?><d:prop xmlns:d="DAV:"><d:lockdiscovery><d:activelock>'
        + '<d:locktype><d:write/></d:locktype><d:lockscope><d:exclusive/></d:lockscope>'
        + '<d:depth>0</d:depth><d:timeout>Second-600</d:timeout>'
        + '<d:locktoken><d:href>' + token + '</d:href></d:locktoken>'
        + '</d:activelock></d:lockdiscovery></d:prop>');
    }
    if (methode === 'UNLOCK') { res.writeHead(204); return res.end(); }

    return fehler(res, 405);
  } catch (e) {
    try { fehler(res, 500, 'WebDAV-Fehler: ' + String(e && e.message || e)); } catch (_e) { /* Antwort schon weg */ }
  }
};

function bestandCode(methode, req) {
  // MOVE/COPY: 201 wenn neu entstanden, 204 bei Ueberschreiben - vereinfachte, Finder-taugliche Wahl.
  return String(req.headers.overwrite || 'T').toUpperCase() === 'F' ? 201 : 201;
}
