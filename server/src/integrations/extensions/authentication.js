// Browser-Extension "Formular-Assistent" (Plan Abschnitt BR, Phase E1): Bearer-Token-Auth fuer
// die /api/ext/*-Fassade. Bewusst GETRENNT vom Session-Cookie-Weg (auth.js) - die Extension darf
// nicht von einem eingeloggten Tab abhaengen, und die bestehenden Routen bleiben unveraendert
// same-origin/cookie-basiert. Ein Token erbt die ONLINE-Zweig-Rechtematrix seines Nutzers
// (parseUserPermissions, permissions.js) - kein zweites Rechtesystem, keine eigenen Scopes.

const crypto = require('crypto');
const db = require('../../database/index');
const { parseUserPermissions } = require('../../middleware/authorization');
const applicationWriteBarrier = require('../../middleware/application-write-barrier');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

// Klartext-Token: 32 Zufallsbytes, base64url (~43 Zeichen, shell-/URL-sicher). Wird NUR in der
// Anlage-Response ausgeliefert, danach existiert serverseitig ausschliesslich der Hash.
function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

const findTokenStmt = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ? AND revoked = 0');
const findUserStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const touchTokenStmt = db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?");

// last_used_at nur gedrosselt schreiben (max. 1x/Minute je Token) - die Anzeige im Token-Manager
// braucht keine Sekundengenauigkeit, und jede Extension-Interaktion loest mehrere Requests aus.
const lastTouch = new Map(); // tokenId -> epoch ms

/*
 * GET-Aufrufe der Erweiterung bleiben während einer Gesamtsicherung lesbar.
 * Nur dieses Statistik-UPDATE wird als eigener, kurzer Schreibvorgang gezählt.
 * Ist die Barriere aktiv, läuft die Funktion nicht und lastTouch wird nicht
 * gesetzt: der nächste authentifizierte Zugriff holt die Aktualisierung nach.
 */
function tokenNutzungBeruehren(tokenId, now) {
  if ((lastTouch.get(tokenId) || 0) >= now - 60 * 1000) return;
  applicationWriteBarrier.withWrite('Erweiterungs-Token verwendet', () => {
    touchTokenStmt.run(tokenId);
    lastTouch.set(tokenId, now);
  }).catch(() => { /* Anzeige-Feld, Authentifizierung bleibt funktionsfähig */ });
}

// Einfache In-Memory-Drosselung fehlgeschlagener Bearer-Versuche je IP (gleiches pragmatisches
// Muster wie die forgot-password-Drosselung in routes/auth.js): 20 Fehlversuche/10 Minuten.
const failedAttempts = new Map(); // ip -> {count, resetAt}
function tooManyFailures(ip) {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= 20;
}
function recordFailure(ip) {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    failedAttempts.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
  } else {
    entry.count += 1;
  }
  // Map begrenzen (Schutz gegen Adress-Spam)
  if (failedAttempts.size > 5000) failedAttempts.clear();
}

function requireExtToken(req, res, next) {
  const ip = req.ip || '';
  if (tooManyFailures(ip)) {
    return res.status(429).json({ error: 'Zu viele fehlgeschlagene Versuche. Bitte spaeter erneut versuchen.' });
  }
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    recordFailure(ip);
    return res.status(401).json({ error: 'API-Token fehlt (Authorization: Bearer ...).' });
  }
  const row = findTokenStmt.get(hashToken(match[1].trim()));
  if (!row) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Ungueltiges oder widerrufenes API-Token.' });
  }
  const user = findUserStmt.get(row.user_id);
  // Deaktivierte Konten sperren wie beim Login (routes/auth.js: "Dieses Konto ist deaktiviert").
  if (!user || (user.active != null && !user.active)) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Zugehoeriges Nutzerkonto ist deaktiviert oder geloescht.' });
  }
  const now = Date.now();
  tokenNutzungBeruehren(row.id, now);
  const perms = parseUserPermissions(user).online; // Extension arbeitet gegen die Server-DB = Online-Modus
  req.extUser = {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    isAdmin: !!user.is_admin,
    perms,
    tokenId: row.id
  };
  next();
}

// Rechte-Guard im Stil der requirePermission-Factory (auth.js:110), aber auf req.extUser statt
// Session-Flags - Admins schlagen wie ueberall alles.
function requireExtPermission(key, message) {
  return function (req, res, next) {
    const u = req.extUser;
    if (!u) return res.status(401).json({ error: 'Nicht angemeldet.' });
    if (u.isAdmin || u.perms[key]) return next();
    res.status(403).json({ error: message || 'Keine Berechtigung.' });
  };
}

module.exports = { requireExtToken, requireExtPermission, hashToken, generateToken };
