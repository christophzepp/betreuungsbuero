// Login/Session-Middleware. Eigener, schlanker SQLite-Session-Store (keine zusaetzliche
// Session-Store-Bibliothek als Abhaengigkeit) - Sitzungen landen in der bestehenden
// `sessions`-Tabelle (siehe db.js).

const session = require('express-session');
const bcrypt = require('bcrypt');
const db = require('../database/index');

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    this.getStmt = db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?');
    this.upsertStmt = db.prepare(`
      INSERT INTO sessions (sid, data, expires_at) VALUES (@sid, @data, @expiresAt)
      ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at
    `);
    this.destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');
    this.pruneStmt = db.prepare('DELETE FROM sessions WHERE expires_at < ?');
    this.pruneTimer = setInterval(() => {
      try { this.pruneStmt.run(Date.now()); } catch (_e) { /* ignore */ }
    }, 15 * 60 * 1000);
    this.pruneTimer.unref?.();
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at < Date.now()) {
        this.destroyStmt.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (error) { cb(error); }
  }

  set(sid, sessionData, cb) {
    try {
      const maxAge = sessionData.cookie?.maxAge ?? DEFAULT_MAX_AGE_MS;
      this.upsertStmt.run({ sid, data: JSON.stringify(sessionData), expiresAt: Date.now() + maxAge });
      cb && cb(null);
    } catch (error) { cb && cb(error); }
  }

  destroy(sid, cb) {
    try {
      this.destroyStmt.run(sid);
      cb && cb(null);
    } catch (error) { cb && cb(error); }
  }

  touch(sid, sessionData, cb) {
    try {
      const maxAge = sessionData.cookie?.maxAge ?? DEFAULT_MAX_AGE_MS;
      this.touchStmt.run(Date.now() + maxAge, sid);
      cb && cb(null);
    } catch (error) { cb && cb(error); }
  }
}

function createSessionMiddleware() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET fehlt. Siehe .env.example.');
  }
  return session({
    store: new SqliteSessionStore(),
    secret,
    resave: false,
    saveUninitialized: false,
    name: 'betreuungsbuero.sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Hinter dem Cloudflare Tunnel/Reverse-Proxy in Produktion auf '1' setzen, sobald HTTPS
      // terminiert und 'trust proxy' konfiguriert ist. Lokal/Docker ohne TLS bleibt es aus.
      secure: process.env.COOKIE_SECURE === '1',
      maxAge: DEFAULT_MAX_AGE_MS
    }
  });
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }
  next();
}

/*
 * Lokalmodus-Sitzungen authentifizieren weiterhin den Nutzer und dürfen deshalb
 * die Auth-/Moduswechsel-Routen verwenden. Sie sind aber keine Berechtigung für
 * die serverseitigen Fach- und Dokument-APIs. Der Browser-Capability-Gate ist
 * nur Darstellung; dieser Guard ist der verbindliche Serververtrag.
 *
 * Sitzungslose Bearer-Endpunkte (MCP/Extension/WebDAV) werden hier nicht
 * entschieden und behalten ihre eigene Authentifizierung.
 */
function requireOnlineMode(req, res, next) {
  if (!req.session || !req.session.userId) return next();
  /* Demo-Modus (30.08.2026): Der Nutzerchat ist das EINZIGE Serverstueck, das eine
     Demo-Sitzung erreichen darf - die 20 Vorfuehrkonten sollen miteinander chatten koennen
     (eigener, strikt getrennter Kreis; Aufraeumung beim Ausschalten). Alles andere bleibt zu. */
  if (req.session.mode === 'demo' && /^\/chat(\/|$)/.test(req.path)) return next();
  if (req.session.mode !== 'online') {
    return res.status(403).json({
      error: 'Diese Serverfunktion ist nur im Online-Modus verfügbar.',
      code: 'ONLINE_MODE_REQUIRED'
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.status(403).json({ error: 'Nur fuer Administratoren.' });
  }
  next();
}

function requireCaseManagement(req, res, next) {
  if (!req.session || !(req.session.isAdmin || req.session.allowCaseManagement)) {
    return res.status(403).json({ error: 'Keine Berechtigung zur Fallverwaltung.' });
  }
  next();
}

// Granulare Content-Rechte (Phase 4): Admins sind von allen vier Prüfungen ausgenommen (dieselbe
// Ausnahme wie bei requireCaseManagement), normale Nutzer brauchen das jeweils passende Flag aus
// users.can_view_cases/can_edit_cases/can_view_documents/can_edit_documents (siehe db.js).
function hasPermission(req, flag) {
  return !!(req && req.session && (req.session.isAdmin || req.session[flag]));
}

function requirePermission(flag, message) {
  return (req, res, next) => {
    if (!hasPermission(req, flag)) {
      return res.status(403).json({ error: message });
    }
    next();
  };
}
const requireViewCases = requirePermission('canViewCases', 'Keine Berechtigung, Fälle anzusehen.');
const requireEditCases = requirePermission('canEditCases', 'Keine Berechtigung, Fälle zu bearbeiten.');
const requireViewDocuments = requirePermission('canViewDocuments', 'Keine Berechtigung, Dokumente anzusehen.');
const requireEditDocuments = requirePermission('canEditDocuments', 'Keine Berechtigung, Dokumente zu bearbeiten.');
// Plan Abschnitt AL, Phase 3: eigene, von Faellen/Dokumenten unabhaengige Berechtigung fuer Finanzen
// (Gehaltsdaten sind ein Geschaeftsgeheimnis, siehe Kontext in db.js).
const requireViewFinance = requirePermission('canViewFinance', 'Keine Berechtigung, Finanzen anzusehen.');
const requireEditFinance = requirePermission('canEditFinance', 'Keine Berechtigung, Finanzen zu bearbeiten.');
// Controlling (2026-08-25): bewusst NICHT ueber requireViewFinance mitgeschuetzt. Der Reiter zeigt
// neben Verguetungssummen auch, welcher Betreuer welche Faelle fuehrt - eine Auswertung, die es
// sonst nirgends gebuendelt gibt. Deshalb ein eigenes Recht (siehe viewControlling in
// authorization.js) statt einer Ableitung aus Finanz- und Fallrechten.
const requireViewControlling = requirePermission('canViewControlling', 'Keine Berechtigung, das Controlling anzusehen.');
// Erlaubt einzelnen, vom Admin freigeschalteten Nutzern Zugriff auf die Mail-Einstellungen
// (SMTP-Konfiguration), ohne vollen Admin-Zugang zu benoetigen.
const requireMailSettings = requirePermission('canManageMailSettings', 'Keine Berechtigung für Mail-Einstellungen.');
// Erlaubt einzelnen, vom Admin freigeschalteten Nutzern das Bearbeiten der Bürostammdaten über den
// eigenstaendigen Seitenleisten-Editor (siehe office-profile.js) - Ansehen bleibt fuer jeden
// eingeloggten Nutzer moeglich (requireAuth reicht dafuer), nur das Schreiben ist zusaetzlich
// geschuetzt.
const requireOfficeProfileEdit = requirePermission('canManageOfficeProfile', 'Keine Berechtigung, die Bürostammdaten zu bearbeiten.');
// Karten-/Navigationseinstellungen (Nutzerwunsch Runde 12): eigenes, von den Buerostammdaten
// unabhaengiges Delegationsrecht - gleiches Muster wie requireOfficeProfileEdit.
const requireMapSettingsEdit = requirePermission('canManageMapSettings', 'Keine Berechtigung, die Karteneinstellungen zu bearbeiten.');
// Plan Abschnitt AV - neue Rechte (per Rueckfrage bestaetigt). Die Session-Flags werden beim Login/
// Moduswechsel aus dem MODUS-ZWEIG der neuen Rechte-Matrix gesetzt (siehe applySessionPermissions in
// routes/auth.js) - dadurch sind ALLE requirePermission-basierten Middlewares automatisch
// modusdifferenziert, ohne dass sie selbst etwas vom Modus wissen muessen.
const requireCalendarConnections = requirePermission('canManageCalendarConnections', 'Keine Berechtigung, Kalender-Verbindungen zu verwalten.');
const requireViewAuditLog = requirePermission('canViewAuditLog', 'Keine Berechtigung, das Audit-Log einzusehen.');
const requireManageCredentials = requirePermission('canManageCredentials', 'Keine Berechtigung, Zugangsdaten/API-Schlüssel zu verändern.');
// Rechte-Audit 2026-07-17: KI-Nutzung und Mail-/Fax-Versand als eigene, pro Nutzer entziehbare
// Rechte (Default AN, siehe permissions.js) - bisher reichte fuer beides der blosse Login.
const requireUseAi = requirePermission('canUseAi', 'Keine Berechtigung, die KI-Funktionen zu nutzen.');
const requireSendMail = requirePermission('canSendMail', 'Keine Berechtigung, E-Mails/Faxe über die Bürokonten zu versenden.');
const requireUseFieldService = requirePermission('canUseFieldService', 'Keine Berechtigung, den Außendienstmodus zu nutzen.');
const requireUseExtension = requirePermission('canUseExtension', 'Keine Berechtigung, die Browser-Erweiterung zu nutzen.');

function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = {
  createSessionMiddleware,
  requireAuth,
  requireOnlineMode,
  requireAdmin,
  hasPermission,
  requireCaseManagement,
  requireViewCases,
  requireEditCases,
  requireViewDocuments,
  requireEditDocuments,
  requireViewFinance,
  requireEditFinance,
  requireViewControlling,
  requireMailSettings,
  requireOfficeProfileEdit,
  requireMapSettingsEdit,
  requireCalendarConnections,
  requireUseAi,
  requireSendMail,
  requireUseFieldService,
  requireUseExtension,
  requireViewAuditLog,
  requireManageCredentials,
  hashPassword,
  verifyPassword,
  SqliteSessionStore
};
