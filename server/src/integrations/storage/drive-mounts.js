// OneDrive (Microsoft Graph) + Google Drive als Dokumente-Verbindungen (Nutzerauftrag 25.07.,
// Anschluss an D6). WICHTIG - OAuth-Scope-Falle (siehe Kalender/Mail, AADSTS70000): bestehende
// Kalender-/Mail-Verbindungen werden NICHT angefasst. Hier entsteht eine EIGENE Autorisierung
// mit Datei-Scopes (Files.ReadWrite bzw. drive); beim Token-Refresh werden bewusst KEINE scopes
// mitgesendet. Microsoft rotiert Refresh-Tokens - ein mitgeliefertes neues refresh_token muss
// der Aufrufer persistieren (onTok-Callback, Muster google-calendar.js authedFetch).
//
// Die Endpunkt-Basen sind fuer den Testharnisch per Umgebungsvariable umlenkbar
// (Muster DOCUMENTS_DATA_ROOT) - im Normalbetrieb bleiben es die offiziellen APIs.

'use strict';

const cryptoHelper = require('../../security/crypto');

const MS_AUTH = process.env.DOK_MS_AUTH || 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN = process.env.DOK_MS_TOKEN || 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH = process.env.DOK_GRAPH_BASE || 'https://graph.microsoft.com/v1.0';
const GD_AUTH = process.env.DOK_GD_AUTH || 'https://accounts.google.com/o/oauth2/v2/auth';
const GD_TOKEN = process.env.DOK_GD_TOKEN || 'https://oauth2.googleapis.com/token';
const GD_API = process.env.DOK_GD_API || 'https://www.googleapis.com/drive/v3';
const GD_UPLOAD = process.env.DOK_GD_UPLOAD || 'https://www.googleapis.com/upload/drive/v3';

const MS_SCOPES = ['offline_access', 'Files.ReadWrite'];
const GD_SCOPES = ['https://www.googleapis.com/auth/drive'];

const ARTEN = new Set(['onedrive', 'gdrive']);

function tokenUrl(kind) { return kind === 'onedrive' ? MS_TOKEN : GD_TOKEN; }

function authUrl(kind, clientId, redirectUri, state) {
  if (kind === 'onedrive') {
    const p = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: redirectUri,
      response_mode: 'query', scope: MS_SCOPES.join(' '), state
    });
    return MS_AUTH + '?' + p.toString();
  }
  const p = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri,
    scope: GD_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state
  });
  return GD_AUTH + '?' + p.toString();
}

async function tauscheCode(kind, clientId, clientSecretEnc, code, redirectUri) {
  const res = await fetch(tokenUrl(kind), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: cryptoHelper.decrypt(clientSecretEnc),
      code, redirect_uri: redirectUri, grant_type: 'authorization_code'
    }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Autorisierung fehlgeschlagen.');
  return data;
}

// Refresh OHNE scope-Parameter (Scope-Falle) - der Token behaelt seine Scopes von der Autorisierung.
async function erneuere(kind, cfg) {
  const refresh = cryptoHelper.decrypt(cfg.refreshEnc || '');
  if (!refresh) throw new Error('Kein Dauerzugriff gespeichert - Verbindung bitte neu autorisieren.');
  const res = await fetch(tokenUrl(kind), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cryptoHelper.decrypt(cfg.clientSecretEnc || ''),
      refresh_token: refresh, grant_type: 'refresh_token'
    }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Zugriff konnte nicht erneuert werden - Verbindung ggf. neu autorisieren.');
  return data;
}

// Authentifizierter Request mit einmaligem Refresh (abgelaufen ODER 401), Muster google-calendar.js.
async function authedFetch(kind, cfg, url, options, onTok) {
  let token = '';
  try { token = cryptoHelper.decrypt(cfg.accessEnc || ''); } catch (_e) { token = ''; }
  const abgelaufen = !token || (Number(cfg.accessBis) || 0) < Date.now();
  const doFetch = (t) => fetch(url, Object.assign({}, options, {
    headers: Object.assign({}, (options && options.headers) || {}, { Authorization: 'Bearer ' + t }),
    signal: AbortSignal.timeout((options && options.timeoutMs) || 60000)
  }));
  if (abgelaufen) {
    const neu = await erneuere(kind, cfg);
    token = neu.access_token;
    cfg.accessEnc = cryptoHelper.encrypt(String(token || ''));
    cfg.accessBis = Date.now() + ((Number(neu.expires_in) || 3600) * 1000) - 60000;
    if (onTok) await onTok(neu);
  }
  let res = await doFetch(token);
  if (res.status === 401) {
    const neu = await erneuere(kind, cfg);
    token = neu.access_token;
    cfg.accessEnc = cryptoHelper.encrypt(String(token || ''));
    cfg.accessBis = Date.now() + ((Number(neu.expires_in) || 3600) * 1000) - 60000;
    if (onTok) await onTok(neu);
    res = await doFetch(token);
  }
  return res;
}

function kurzDatum(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + '.' + m[2] + '.' + m[1]) : '';
}

/* ------------------------------- OneDrive (Graph) ------------------------------- */

function odItem(seg) {
  return GRAPH + '/me/drive/root' + (seg.length ? (':/' + seg.map(encodeURIComponent).join('/')) : '');
}
function odChildrenUrl(seg) {
  return seg.length ? (odItem(seg) + ':/children') : (GRAPH + '/me/drive/root/children');
}

/* Graph liefert hoechstens $top Eintraege pro Seite und verweist mit @odata.nextLink auf den
   Rest - ohne dieses Blaettern fehlten in grossen Ordnern stillschweigend Eintraege (D38).
   SEITEN_MAX ist ein Notaus gegen fehlerhafte Endlos-Verweise. */
const SEITEN_MAX = 25;
async function odListe(cfg, seg, onTok) {
  let url = odChildrenUrl(seg) + '?$top=200';
  const eintraege = [];
  for (let seite = 0; seite < SEITEN_MAX && url; seite++) {
    const res = await authedFetch('onedrive', cfg, url, {}, onTok);
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error('Ordner auf OneDrive nicht gefunden: ' + (seg.join('/') || '(Hauptordner)'));
    if (!res.ok) throw new Error((data.error && data.error.message) || ('OneDrive-Antwort ' + res.status));
    for (const e of (data.value || [])) eintraege.push(e);
    url = data['@odata.nextLink'] || '';
  }
  const folders = [], files = [];
  for (const e of eintraege) {
    const name = String(e.name || '');
    if (!name || name.startsWith('.')) continue;
    if (e.folder) folders.push({ name });
    else files.push({ name, size: Number(e.size) || 0, mime: (e.file && e.file.mimeType) || '', date: kurzDatum(e.lastModifiedDateTime) });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  files.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { folders, files };
}

async function odLade(cfg, seg, onTok) {
  const res = await authedFetch('onedrive', cfg, odItem(seg) + ':/content', { timeoutMs: 120000 }, onTok);
  if (res.status === 404) throw new Error('Datei auf OneDrive nicht gefunden.');
  if (!res.ok) throw new Error('OneDrive-Antwort ' + res.status);
  return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'application/octet-stream' };
}

const OD_KLEIN = 3.5 * 1024 * 1024;
const OD_CHUNK = 3276800; // 10 x 320 KiB - Graph verlangt Vielfache von 327680

async function odSchreibe(cfg, seg, name, bytes, onTok) {
  const ziel = seg.concat(String(name));
  if (bytes.length <= OD_KLEIN) {
    const res = await authedFetch('onedrive', cfg, odItem(ziel) + ':/content', { method: 'PUT', body: bytes, timeoutMs: 120000 }, onTok);
    if (![200, 201].includes(res.status)) throw new Error('OneDrive-Upload fehlgeschlagen (HTTP ' + res.status + ').');
    return;
  }
  const anlegen = await authedFetch('onedrive', cfg, odItem(ziel) + ':/createUploadSession', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } })
  }, onTok);
  const sess = await anlegen.json().catch(() => ({}));
  if (!anlegen.ok || !sess.uploadUrl) throw new Error('OneDrive-Upload-Sitzung fehlgeschlagen (HTTP ' + anlegen.status + ').');
  for (let ab = 0; ab < bytes.length; ab += OD_CHUNK) {
    const teil = bytes.subarray(ab, Math.min(ab + OD_CHUNK, bytes.length));
    const res = await fetch(sess.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': String(teil.length), 'Content-Range': 'bytes ' + ab + '-' + (ab + teil.length - 1) + '/' + bytes.length },
      body: teil, signal: AbortSignal.timeout(120000)
    });
    if (![200, 201, 202].includes(res.status)) throw new Error('OneDrive-Upload-Teil fehlgeschlagen (HTTP ' + res.status + ').');
  }
}

async function odOrdner(cfg, seg, onTok) {
  for (let i = 1; i <= seg.length; i++) {
    const eltern = seg.slice(0, i - 1);
    const res = await authedFetch('onedrive', cfg, odChildrenUrl(eltern), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: seg[i - 1], folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
    }, onTok);
    if (![200, 201, 409].includes(res.status)) throw new Error('OneDrive-Ordner nicht anlegbar (HTTP ' + res.status + '): ' + seg.slice(0, i).join('/'));
  }
}

/* ------------------------------- Google Drive ------------------------------- */

function gdQ(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

async function gdSuche(cfg, q, onTok) {
  /* Auch Google liefert seitenweise (nextPageToken) - siehe D38. */
  const basis = GD_API + '/files?q=' + encodeURIComponent(q) + '&fields=' + encodeURIComponent('nextPageToken,files(id,name,mimeType,size,modifiedTime)') + '&pageSize=200';
  const alle = [];
  let token = '';
  for (let seite = 0; seite < SEITEN_MAX; seite++) {
    const res = await authedFetch('gdrive', cfg, basis + (token ? ('&pageToken=' + encodeURIComponent(token)) : ''), {}, onTok);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || ('Google-Drive-Antwort ' + res.status));
    for (const f of (data.files || [])) alle.push(f);
    token = String(data.nextPageToken || '');
    if (!token) break;
  }
  return alle;
}

// Namenskette -> Ordner-ID ('root' als Basis); optional fehlende Ebenen anlegen.
async function gdOrdnerId(cfg, seg, anlegen, onTok) {
  let pid = 'root';
  for (const teil of seg) {
    const treffer = await gdSuche(cfg, "'" + gdQ(pid) + "' in parents and name='" + gdQ(teil) + "' and trashed=false and mimeType='application/vnd.google-apps.folder'", onTok);
    if (treffer.length) { pid = treffer[0].id; continue; }
    if (!anlegen) throw new Error('Ordner auf Google Drive nicht gefunden: ' + teil);
    const res = await authedFetch('gdrive', cfg, GD_API + '/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: teil, mimeType: 'application/vnd.google-apps.folder', parents: [pid] })
    }, onTok);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) throw new Error('Google-Drive-Ordner nicht anlegbar (HTTP ' + res.status + '): ' + teil);
    pid = data.id;
  }
  return pid;
}

async function gdListe(cfg, seg, onTok) {
  const pid = await gdOrdnerId(cfg, seg, false, onTok);
  const eintraege = await gdSuche(cfg, "'" + gdQ(pid) + "' in parents and trashed=false", onTok);
  const folders = [], files = [];
  for (const e of eintraege) {
    const name = String(e.name || '');
    if (!name || name.startsWith('.')) continue;
    if (e.mimeType === 'application/vnd.google-apps.folder') folders.push({ name });
    else files.push({ name, size: Number(e.size) || 0, mime: e.mimeType || '', date: kurzDatum(e.modifiedTime) });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  files.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { folders, files };
}

async function gdDateiId(cfg, seg, onTok) {
  const eltern = seg.slice(0, -1);
  const name = seg[seg.length - 1];
  const pid = await gdOrdnerId(cfg, eltern, false, onTok);
  const treffer = await gdSuche(cfg, "'" + gdQ(pid) + "' in parents and name='" + gdQ(name) + "' and trashed=false and mimeType!='application/vnd.google-apps.folder'", onTok);
  return { id: treffer.length ? treffer[0].id : '', pid, mime: treffer.length ? (treffer[0].mimeType || '') : '' };
}

async function gdLade(cfg, seg, onTok) {
  const d = await gdDateiId(cfg, seg, onTok);
  if (!d.id) throw new Error('Datei auf Google Drive nicht gefunden.');
  const res = await authedFetch('gdrive', cfg, GD_API + '/files/' + encodeURIComponent(d.id) + '?alt=media', { timeoutMs: 120000 }, onTok);
  if (!res.ok) throw new Error('Google-Drive-Antwort ' + res.status);
  return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || d.mime || 'application/octet-stream' };
}

const GD_KLEIN = 4.5 * 1024 * 1024;

async function gdSchreibe(cfg, seg, name, bytes, onTok) {
  const vorhanden = await gdDateiId(cfg, seg.concat(String(name)), onTok).catch(() => ({ id: '', pid: '' }));
  if (vorhanden.id) {
    // Ueberschreiben: kleiner Inhalt direkt (media), grosser per resumable-PATCH.
    if (bytes.length <= GD_KLEIN) {
      const res = await authedFetch('gdrive', cfg, GD_UPLOAD + '/files/' + encodeURIComponent(vorhanden.id) + '?uploadType=media', {
        method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes, timeoutMs: 120000
      }, onTok);
      if (!res.ok) throw new Error('Google-Drive-Upload fehlgeschlagen (HTTP ' + res.status + ').');
      return;
    }
    const init = await authedFetch('gdrive', cfg, GD_UPLOAD + '/files/' + encodeURIComponent(vorhanden.id) + '?uploadType=resumable', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/octet-stream' }, body: '{}'
    }, onTok);
    const ort = init.headers.get('location');
    if (!init.ok || !ort) throw new Error('Google-Drive-Upload-Sitzung fehlgeschlagen (HTTP ' + init.status + ').');
    const res = await fetch(ort, { method: 'PUT', body: bytes, signal: AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error('Google-Drive-Upload fehlgeschlagen (HTTP ' + res.status + ').');
    return;
  }
  const pid = await gdOrdnerId(cfg, seg, true, onTok);
  if (bytes.length <= GD_KLEIN) {
    const grenze = 'dokgrenze' + Date.now().toString(36);
    const kopf = Buffer.from('--' + grenze + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'
      + JSON.stringify({ name: String(name), parents: [pid] })
      + '\r\n--' + grenze + '\r\nContent-Type: application/octet-stream\r\n\r\n', 'utf8');
    const fuss = Buffer.from('\r\n--' + grenze + '--', 'utf8');
    const res = await authedFetch('gdrive', cfg, GD_UPLOAD + '/files?uploadType=multipart', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + grenze },
      body: Buffer.concat([kopf, bytes, fuss]), timeoutMs: 120000
    }, onTok);
    if (!res.ok) throw new Error('Google-Drive-Upload fehlgeschlagen (HTTP ' + res.status + ').');
    return;
  }
  const init = await authedFetch('gdrive', cfg, GD_UPLOAD + '/files?uploadType=resumable', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/octet-stream' },
    body: JSON.stringify({ name: String(name), parents: [pid] })
  }, onTok);
  const ort = init.headers.get('location');
  if (!init.ok || !ort) throw new Error('Google-Drive-Upload-Sitzung fehlgeschlagen (HTTP ' + init.status + ').');
  const res = await fetch(ort, { method: 'PUT', body: bytes, signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error('Google-Drive-Upload fehlgeschlagen (HTTP ' + res.status + ').');
}

async function gdOrdner(cfg, seg, onTok) { await gdOrdnerId(cfg, seg, true, onTok); }

/* ------------------------------- Einheitliche Schnittstelle ------------------------------- */

module.exports = {
  ARTEN, authUrl, tauscheCode,
  liste: (kind, cfg, seg, onTok) => kind === 'onedrive' ? odListe(cfg, seg, onTok) : gdListe(cfg, seg, onTok),
  lade: (kind, cfg, seg, onTok) => kind === 'onedrive' ? odLade(cfg, seg, onTok) : gdLade(cfg, seg, onTok),
  schreibe: (kind, cfg, seg, name, bytes, onTok) => kind === 'onedrive' ? odSchreibe(cfg, seg, name, bytes, onTok) : gdSchreibe(cfg, seg, name, bytes, onTok),
  ordner: (kind, cfg, seg, onTok) => kind === 'onedrive' ? odOrdner(cfg, seg, onTok) : gdOrdner(cfg, seg, onTok)
};
