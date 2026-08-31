// OAuth 2.1 fuer den MCP-Fernzugriff (2026-07-26, PLAN-MCP-Server.md).
//
// Der Server ist Resource Server UND Authorization Server in einem Prozess (bewusst getrennt
// gehalten). Pflichten der MCP-Spezifikation (Rev. 2025-11): Protected Resource Metadata
// (RFC 9728), PKCE nur S256 ("plain" ist verboten), Resource Indicators (RFC 8707 - Tokens sind
// an DIESEN Server gebunden), Dynamic Client Registration (RFC 7591). Die Anmeldung laeuft gegen
// die bestehende Nutzerverwaltung (bcrypt) - das Token traegt die Identitaet des angemeldeten
// Nutzers und damit dessen Rechte und Fallsicht (Nutzerentscheidung: kein technischer Extranutzer).
'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../../database/index');
const applicationWriteBarrier = require('../../middleware/application-write-barrier');

const router = express.Router();
router.use(express.urlencoded({ extended: false }));

const SCOPES = ['bb.read', 'bb.propose', 'bb.pay'];
const SCOPE_LABELS = {
  'bb.read': 'Falldaten LESEN (Stammdaten, Termine, Fristen, Dokumentation, Finanzen …)',
  'bb.propose': 'Änderungen VORSCHLAGEN (werden erst nach Ihrer Bestätigung gespeichert)',
  'bb.pay': 'Überweisungen VORBEREITEN und nach doppelter Bestätigung einreichen'
};
const ACCESS_TTL_S = 3600;             // 1 Stunde
const REFRESH_TTL_S = 30 * 86400;      // 30 Tage, mit Rotation
const CODE_TTL_S = 600;                // 10 Minuten, einmalig

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newSecret = () => b64url(crypto.randomBytes(32));
const nowPlus = (s) => new Date(Date.now() + s * 1000).toISOString();

// Kanonische Basis-URL: bevorzugt die im Admin hinterlegte oeffentliche Tunnel-URL, sonst der
// Request-Host. Die resource-Bindung (RFC 8707) vergleicht gegen genau diesen Wert.
function baseUrl(req) {
  const row = db.prepare('SELECT public_url FROM mcp_settings WHERE id=1').get();
  const cfg = row && String(row.public_url || '').trim().replace(/\/+$/, '');
  if (cfg) return cfg;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
  return proto + '://' + req.headers.host;
}
function canonicalResource(req) { return baseUrl(req) + '/mcp'; }

/* ---------------- Discovery (RFC 9728 + AS-Metadaten) ---------------- */
router.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({
    resource: canonicalResource(req),
    authorization_servers: [baseUrl(req)],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header']
  });
});
// Beide gaengigen Pfade (mit und ohne /mcp-Suffix) bedienen - Clients probieren verschieden.
router.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
  res.redirect(302, '/.well-known/oauth-protected-resource');
});
router.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = baseUrl(req);
  res.json({
    issuer: base,
    authorization_endpoint: base + '/oauth/authorize',
    token_endpoint: base + '/oauth/token',
    registration_endpoint: base + '/oauth/register',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: SCOPES
  });
});

/* ---------------- Dynamic Client Registration (RFC 7591) ---------------- */
router.post('/oauth/register', express.json(), (req, res) => {
  const b = req.body || {};
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
  if (!uris.length) return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris fehlt.' });
  for (const u of uris) {
    const okLoopback = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u);
    const okHttps = /^https:\/\//.test(u);
    const okCustom = /^[a-z][a-z0-9+.-]*:\/\//i.test(u) && !/^https?:/.test(u); // App-Schemata (z. B. cursor://)
    if (!okLoopback && !okHttps && !okCustom) {
      return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Nur https-, Loopback- oder App-Schema-URIs.' });
    }
  }
  const id = crypto.randomUUID();
  const method = b.token_endpoint_auth_method === 'client_secret_post' ? 'client_secret_post' : 'none';
  const secret = method === 'client_secret_post' ? newSecret() : '';
  db.prepare('INSERT INTO mcp_clients (id, name, redirect_uris_json, secret_hash) VALUES (?,?,?,?)')
    .run(id, String(b.client_name || 'Unbenannter Client').slice(0, 120), JSON.stringify(uris), secret ? sha256(secret) : '');
  const out = {
    client_id: id,
    client_name: String(b.client_name || 'Unbenannter Client').slice(0, 120),
    redirect_uris: uris,
    token_endpoint_auth_method: method,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code']
  };
  if (secret) out.client_secret = secret;
  res.status(201).json(out);
});

/* ---------------- Schutz gegen Durchprobieren (Pflicht vor dem Tunnel) ----------------
   In-Memory reicht: ein Neustart setzt zurueck, der Angreifer bleibt trotzdem gebremst. */
const loginFails = new Map();   // key ip|user -> {n, until}
function lockKey(req) { return (req.ip || req.socket.remoteAddress || '?') + '|' + String((req.body || {}).username || '').toLowerCase(); }
function isLocked(req) {
  const e = loginFails.get(lockKey(req));
  return e && e.until > Date.now() ? Math.ceil((e.until - Date.now()) / 1000) : 0;
}
function noteFail(req) {
  const k = lockKey(req);
  const e = loginFails.get(k) || { n: 0, until: 0 };
  e.n++;
  if (e.n >= 5) { e.until = Date.now() + 15 * 60000; e.n = 0; }   // 5 Fehlversuche -> 15 Minuten Sperre
  loginFails.set(k, e);
}
function noteOk(req) { loginFails.delete(lockKey(req)); }

const rateBuckets = new Map();  // client_id -> {n, resetAt}; 120 Aufrufe je Minute
function rateLimited(clientId) {
  const now = Date.now();
  let b = rateBuckets.get(clientId);
  if (!b || b.resetAt <= now) { b = { n: 0, resetAt: now + 60000 }; rateBuckets.set(clientId, b); }
  b.n++;
  return b.n > 120;
}

// Abgelaufene Codes/Tokens taeglich wegräumen (Hash-Reste haben keinen Wert, aber Ordnung zaehlt).
const cleanupTimer = setInterval(() => {
  applicationWriteBarrier.withWrite('Bereinigung abgelaufener MCP-Zugänge', () => {
    db.prepare("DELETE FROM mcp_auth_codes WHERE expires_at < datetime('now','-1 day')").run();
    db.prepare("DELETE FROM mcp_tokens WHERE expires_at < datetime('now','-7 day')").run();
  }).catch(() => { /* nie den Timer sterben lassen */ });
}, 6 * 3600 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

/* ---------------- Autorisierung (Login + Zustimmung) ---------------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function validateAuthRequest(req) {
  const q = Object.assign({}, req.query, req.body || {});
  const client = db.prepare('SELECT * FROM mcp_clients WHERE id=? AND revoked=0').get(String(q.client_id || ''));
  if (!client) return { err: 'Unbekannter oder widerrufener Client.' };
  const uris = JSON.parse(client.redirect_uris_json || '[]');
  if (!uris.includes(String(q.redirect_uri || ''))) return { err: 'redirect_uri ist für diesen Client nicht registriert.' };
  if (String(q.response_type || '') !== 'code') return { err: 'Nur response_type=code wird unterstützt.' };
  // PKCE: S256 ist Pflicht, "plain" ausdruecklich verboten (Spezifikationsrevision 11/2025).
  if (String(q.code_challenge_method || '') !== 'S256' || !q.code_challenge) return { err: 'PKCE mit S256 ist Pflicht.' };
  const scope = String(q.scope || 'bb.read').split(/[\s+]+/).filter(s => SCOPES.includes(s));
  if (!scope.length) return { err: 'Kein gültiger Scope angefragt.' };
  const resource = String(q.resource || '');
  if (resource && resource !== canonicalResource(req)) return { err: 'resource verweist nicht auf diesen Server (RFC 8707).' };
  return { client, uris, scope, q };
}

router.get('/oauth/authorize', (req, res) => {
  const v = validateAuthRequest(req);
  if (v.err) return res.status(400).send('<p style="font-family:sans-serif">' + esc(v.err) + '</p>');
  const enabled = db.prepare('SELECT enabled FROM mcp_settings WHERE id=1').get();
  if (!enabled || enabled.enabled !== 1) return res.status(503).send('<p style="font-family:sans-serif">Der KI-Fernzugriff ist derzeit abgeschaltet (Admin-Panel → KI-Fernzugriff).</p>');
  const q = v.q;
  res.send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zugriff erlauben – Betreuungsbüro</title>
<style>body{font-family:Arial,Helvetica,sans-serif;background:#f2f6f9;color:#16283a;display:flex;justify-content:center;padding:40px 16px}
.card{background:#fff;border:1px solid #c9d6de;border-radius:12px;max-width:460px;width:100%;padding:26px 28px}
h1{font-size:17px;color:#1f4e78;margin:0 0 4px}.sub{font-size:12.5px;color:#5b7183;margin:0 0 18px}
.scopes{border:1px solid #dbe6ee;background:#f7fafc;border-radius:9px;padding:12px 14px;margin:0 0 18px;font-size:12.5px;line-height:1.55}
label{display:block;font-size:12px;font-weight:700;color:#456;margin:10px 0 4px}
input{width:100%;box-sizing:border-box;border:1px solid #c9d6de;border-radius:8px;padding:9px 11px;font:inherit}
button{margin-top:18px;width:100%;border:0;border-radius:9px;background:#1f6fb2;color:#fff;font:inherit;font-weight:700;padding:11px;cursor:pointer}
.warn{font-size:11.5px;color:#8a6414;background:#fdf3e2;border:1px solid #efd9a8;border-radius:8px;padding:8px 11px;margin-top:14px;line-height:1.5}
.err{color:#8a2f2f;font-size:12.5px;margin-top:10px}</style></head><body><div class="card">
<h1>„${esc(v.client.name)}" möchte auf das Betreuungsbüro zugreifen</h1>
<p class="sub">Der Zugriff läuft mit den Rechten und der Fallsicht des Kontos, mit dem Sie sich hier anmelden.</p>
<div class="scopes"><strong>Angefragte Berechtigungen:</strong><br>${v.scope.map(s => '• ' + esc(SCOPE_LABELS[s] || s)).join('<br>')}</div>
<form method="POST" action="/oauth/authorize">
${['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'resource'].map(k => `<input type="hidden" name="${k}" value="${esc(q[k] || '')}">`).join('')}
<input type="hidden" name="scope" value="${esc(v.scope.join(' '))}">
<label>Benutzername</label><input name="username" autocomplete="username" required>
<label>Passwort</label><input name="password" type="password" autocomplete="current-password" required>
<button type="submit">Anmelden und Zugriff erlauben</button>
${req.query.fehler ? '<div class="err">Anmeldung fehlgeschlagen – bitte erneut versuchen.</div>' : ''}
<div class="warn">Änderungen werden grundsätzlich erst nach Bestätigung im Chat gespeichert; Zahlungen verlangen eine doppelte Bestätigung. Der Zugang kann im Admin-Panel jederzeit widerrufen werden.</div>
</form></div></body></html>`);
});

router.post('/oauth/authorize', async (req, res) => {
  const wait = isLocked(req);
  if (wait) return res.status(429).send('<p style="font-family:sans-serif">Zu viele Fehlversuche – bitte in ' + Math.ceil(wait / 60) + ' Minuten erneut versuchen.</p>');
  const v = validateAuthRequest(req);
  if (v.err) return res.status(400).send('<p style="font-family:sans-serif">' + esc(v.err) + '</p>');
  const enabled = db.prepare('SELECT enabled FROM mcp_settings WHERE id=1').get();
  if (!enabled || enabled.enabled !== 1) return res.status(503).send('Abgeschaltet.');
  const user = db.prepare('SELECT * FROM users WHERE username=? AND active!=0 AND allow_online!=0').get(String(req.body.username || '').trim());
  let ok = false;
  try { ok = user ? await bcrypt.compare(String(req.body.password || ''), user.password_hash) : false; } catch (_e) { ok = false; }
  if (!ok) {
    noteFail(req);
    const back = '/oauth/authorize?' + new URLSearchParams(Object.assign({}, req.body, { password: undefined, fehler: '1' })).toString();
    return res.redirect(302, back);
  }
  noteOk(req);
  const code = newSecret();
  db.prepare(`INSERT INTO mcp_auth_codes (code_hash, client_id, user_id, scope, code_challenge, resource, redirect_uri, expires_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(sha256(code), v.client.id, user.id, v.scope.join(' '), String(req.body.code_challenge),
      String(req.body.resource || canonicalResource(req)), String(req.body.redirect_uri), nowPlus(CODE_TTL_S));
  const sep = String(req.body.redirect_uri).includes('?') ? '&' : '?';
  res.redirect(302, String(req.body.redirect_uri) + sep + new URLSearchParams({ code, state: String(req.body.state || '') }).toString());
});

/* ---------------- Token ---------------- */
function issueTokens(clientId, userId, scope, resource) {
  const access = newSecret(), refresh = newSecret();
  const ins = db.prepare(`INSERT INTO mcp_tokens (id, kind, token_hash, client_id, user_id, scope, resource, expires_at, rotated_from)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  ins.run(crypto.randomUUID(), 'access', sha256(access), clientId, userId, scope, resource, nowPlus(ACCESS_TTL_S), '');
  ins.run(crypto.randomUUID(), 'refresh', sha256(refresh), clientId, userId, scope, resource, nowPlus(REFRESH_TTL_S), '');
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

router.post('/oauth/token', (req, res) => {
  const b = req.body || {};
  const client = db.prepare('SELECT * FROM mcp_clients WHERE id=? AND revoked=0').get(String(b.client_id || ''));
  if (!client) return res.status(400).json({ error: 'invalid_client' });
  if (client.secret_hash && sha256(String(b.client_secret || '')) !== client.secret_hash) {
    return res.status(401).json({ error: 'invalid_client' });
  }
  if (b.grant_type === 'authorization_code') {
    const row = db.prepare('SELECT * FROM mcp_auth_codes WHERE code_hash=?').get(sha256(String(b.code || '')));
    if (!row || row.client_id !== client.id || row.used === 1 || row.expires_at < new Date().toISOString()) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    if (String(b.redirect_uri || '') !== row.redirect_uri) return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri weicht ab.' });
    // PKCE-Verifikation: S256(code_verifier) muss der hinterlegten Challenge entsprechen.
    const challenge = b64url(crypto.createHash('sha256').update(String(b.code_verifier || '')).digest());
    if (challenge !== row.code_challenge) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE-Prüfung fehlgeschlagen.' });
    // Resource-Bindung: das Token gilt nur fuer den angefragten (kanonischen) Endpunkt.
    if (b.resource && String(b.resource) !== row.resource) return res.status(400).json({ error: 'invalid_target' });
    db.prepare('UPDATE mcp_auth_codes SET used=1 WHERE code_hash=?').run(sha256(String(b.code)));
    db.prepare("UPDATE mcp_clients SET last_used_at=datetime('now') WHERE id=?").run(client.id);
    return res.json(issueTokens(client.id, row.user_id, row.scope, row.resource));
  }
  if (b.grant_type === 'refresh_token') {
    const row = db.prepare("SELECT * FROM mcp_tokens WHERE token_hash=? AND kind='refresh'").get(sha256(String(b.refresh_token || '')));
    if (!row || row.revoked === 1 || row.client_id !== client.id || row.expires_at < new Date().toISOString()) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    // Rotation: der alte Refresh-Token wird entwertet; Wiederverwendung faellt damit auf.
    db.prepare('UPDATE mcp_tokens SET revoked=1 WHERE id=?').run(row.id);
    return res.json(issueTokens(client.id, row.user_id, row.scope, row.resource));
  }
  return res.status(400).json({ error: 'unsupported_grant_type' });
});

/* ---------------- Zugriff pruefen (fuer /mcp und Admin) ---------------- */
function verifyBearer(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return { status: 401, error: 'Kein Bearer-Token.' };
  const row = db.prepare("SELECT * FROM mcp_tokens WHERE token_hash=? AND kind='access'").get(sha256(m[1]));
  if (!row || row.revoked === 1) return { status: 401, error: 'Token unbekannt oder widerrufen.' };
  if (row.expires_at < new Date().toISOString()) return { status: 401, error: 'Token abgelaufen.' };
  if (row.resource && row.resource !== canonicalResource(req)) return { status: 401, error: 'Token gilt nicht für diesen Endpunkt (Audience).' };
  const client = db.prepare('SELECT * FROM mcp_clients WHERE id=?').get(row.client_id);
  if (!client || client.revoked === 1) return { status: 401, error: 'Client widerrufen.' };
  if (rateLimited(client.id)) return { status: 429, error: 'Zu viele Anfragen – bitte kurz warten (120/min je Client).' };
  db.prepare("UPDATE mcp_tokens SET last_used_at=datetime('now') WHERE id=?").run(row.id);
  return { token: row, client, scopes: row.scope.split(' ').filter(Boolean) };
}

/* ---------------- Admin-Verwaltung (Session-geschuetzt, nur Admins) ----------------
   Der Router liegt auf App-Ebene HINTER der Session-Middleware (index.js), req.session ist da. */
function requireAdminSession(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(403).json({ error: 'Nur für Administratoren.' });
  next();
}
router.get('/api/mcp-admin/overview', requireAdminSession, (req, res) => {
  const st = db.prepare('SELECT * FROM mcp_settings WHERE id=1').get();
  res.json({
    enabled: st.enabled === 1,
    publicUrl: st.public_url || '',
    effectiveResource: canonicalResource(req),
    clients: db.prepare('SELECT id, name, created_at, last_used_at, revoked, allowed_scopes FROM mcp_clients ORDER BY created_at DESC').all()
      .map(c => ({ id: c.id, name: c.name, erstellt: c.created_at, zuletzt: c.last_used_at, widerrufen: c.revoked === 1, scopes: c.allowed_scopes || '',
        tokens: db.prepare("SELECT COUNT(*) n FROM mcp_tokens WHERE client_id=? AND revoked=0 AND expires_at>datetime('now')").get(c.id).n })),
    offeneVorschlaege: db.prepare("SELECT COUNT(*) n FROM mcp_proposals WHERE status='offen'").get().n,
    log: db.prepare(`SELECT l.at, l.tool, l.ok, l.case_id, l.detail, COALESCE(c.name, l.client_id) AS client
      FROM mcp_log l LEFT JOIN mcp_clients c ON c.id = l.client_id ORDER BY l.id DESC LIMIT 120`).all()
  });
});
router.put('/api/mcp-admin/settings', requireAdminSession, express.json(), (req, res) => {
  const b = req.body || {};
  db.prepare("UPDATE mcp_settings SET enabled=?, public_url=?, updated_at=datetime('now') WHERE id=1")
    .run(b.enabled === false ? 0 : 1, String(b.publicUrl || '').trim().replace(/\/+$/, ''));
  res.json({ ok: true });
});
// Nachtraegliche Scope-Einschraenkung je Client. Leere Auswahl ist NICHT erlaubt (mehrdeutig) -
// wer einen Client stilllegen will, widerruft ihn. Volle Auswahl wird als '' (uneingeschraenkt)
// gespeichert. Wirkt zur LAUFZEIT (Schnitt in routes/mcp.js), also auch fuer bestehende Tokens.
router.patch('/api/mcp-admin/clients/:id/scopes', requireAdminSession, express.json(), (req, res) => {
  const ALLE = ['bb.read', 'bb.propose', 'bb.pay'];
  const roh = Array.isArray(req.body && req.body.scopes) ? req.body.scopes.map(String) : null;
  if (!roh || !roh.length) return res.status(400).json({ error: 'scopes: nicht-leere Liste erwartet.' });
  if (roh.some(s => !ALLE.includes(s))) return res.status(400).json({ error: 'Unbekannter Scope.' });
  const wert = ALLE.every(s => roh.includes(s)) ? '' : ALLE.filter(s => roh.includes(s)).join(' ');
  const r = db.prepare('UPDATE mcp_clients SET allowed_scopes=? WHERE id=?').run(wert, String(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Client nicht gefunden.' });
  res.json({ ok: true, allowed_scopes: wert });
});
router.post('/api/mcp-admin/clients/:id/revoke', requireAdminSession, (req, res) => {
  db.prepare('UPDATE mcp_clients SET revoked=1 WHERE id=?').run(String(req.params.id));
  db.prepare('UPDATE mcp_tokens SET revoked=1 WHERE client_id=?').run(String(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
module.exports.verifyBearer = verifyBearer;
module.exports.canonicalResource = canonicalResource;
module.exports.SCOPES = SCOPES;
