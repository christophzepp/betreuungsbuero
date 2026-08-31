// POST /api/login, POST /api/logout, GET /api/me

const express = require('express');
const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const { verifyPassword, hashPassword, requireAuth } = require('../../middleware/authentication');
const { logAction } = require('../../middleware/audit');
const mail = require('../mail/service');
const { parseUserPermissions } = require('../../middleware/authorization');
const { demoErlaubt } = require('../demo/routes');
const userSettings = require('../settings/user-settings');
const themePrefs = require('../settings/theme-preferences');
const recoveryMode = require('../recovery/mode').ensure(db);

const router = express.Router();

// Einfache In-Memory-Drosselung gegen Audit-Log-Spam ueber /forgot-password - kein vollstaendiger
// Abuse-Schutz noetig fuer diese Nutzergroesse, nur ein Riegel gegen versehentliches/absichtliches
// Wiederholen. Zaehler pro IP, faellt nach einer Stunde automatisch zurueck.
const forgotPasswordAttempts = new Map();
const FORGOT_PASSWORD_LIMIT = 5;
const FORGOT_PASSWORD_WINDOW_MS = 60 * 60 * 1000;
function forgotPasswordRateLimited(ip) {
  const now = Date.now();
  const entry = forgotPasswordAttempts.get(ip);
  if (!entry || now - entry.windowStart > FORGOT_PASSWORD_WINDOW_MS) {
    forgotPasswordAttempts.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > FORGOT_PASSWORD_LIMIT;
}

const getUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const updatePasswordStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const listAiConfig = db.prepare('SELECT provider, api_key_encrypted, model, endpoint FROM office_ai_config');
const listSendCredentials = db.prepare('SELECT service, username, password_encrypted, login_url, inbox_url, compose_url FROM office_send_credentials');

// Effektive Rechte fuer EINEN Modus: Admin = alles erlaubt, sonst der Modus-Zweig der Matrix.
function effectivePermissions(user, mode) {
  const branch = parseUserPermissions(user)[mode === 'local' ? 'local' : 'online'];
  if (!user.is_admin) return branch;
  const all = {};
  for (const key of Object.keys(branch)) all[key] = true;
  return all;
}

// publicUser liefert seit dem Rechte-Umbau (Plan Abschnitt AV) die MODUSABHAENGIGEN effektiven
// Rechte des uebergebenen Modus als die bisherigen camelCase-Flags aus - alle bestehenden
// Client-Pruefstellen (window.__currentUser.canViewCases etc.) bleiben dadurch unveraendert gueltig
// und werden automatisch modusdifferenziert. Zusaetzlich die volle Matrix (permissions) fuer die
// neue Rechteverwaltungs-UI sowie die neuen Profilfelder. `notes` bewusst NICHT hier (nur fuer
// Admins ueber routes/admin.js sichtbar).
function publicUser(user, mode) {
  const p = effectivePermissions(user, mode);
  const theme = themePrefs.getThemeSettings(user.id);
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    firstName: user.first_name || '',
    lastName: user.last_name || '',
    salutation: user.salutation || '',
    email: user.email || '',
    phone: user.phone || '',
    mobile: user.mobile || '',
    jobTitle: user.job_title || '',
    initials: user.initials || '',
    calendarColor: user.calendar_color || '',
    themePreference: theme.preference,
    themeScheduleEnabled: theme.scheduleEnabled,
    active: user.active !== 0,
    isAdmin: !!user.is_admin,
    isDemo: !!user.is_demo,
    allowLocal: !!user.allow_local,
    allowOnline: !!user.allow_online,
    allowModeSwitch: !!user.allow_mode_switch,
    allowCaseManagement: !!p.caseManagement,
    canViewCases: !!p.viewCases,
    canEditCases: !!p.editCases,
    canViewDocuments: !!p.viewDocuments,
    canEditDocuments: !!p.editDocuments,
    canViewFinance: !!p.viewFinance,
    canEditFinance: !!p.editFinance,
    canViewControlling: !!p.viewControlling,
    canManageMailSettings: !!p.manageMailSettings,
    canManageOfficeProfile: !!p.manageOfficeProfile,
    canManageMapSettings: !!p.manageMapSettings,
    canManageCredentials: !!p.manageCredentials,
    canManageCalendarConnections: !!p.manageCalendarConnections,
    canApproveMileage: !!p.approveMileage,
    canViewAuditLog: !!p.viewAuditLog,
    canUseAi: !!p.useAi,
    canDocsAllCases: !!p.docsAllCases,
    canSendMail: !!p.sendMail,
    canUseFieldService: !!p.useFieldService,
    canUseExtension: !!p.useExtension,
    canViewAllQualifications: !!p.viewAllQualifications,
    canViewAllCases: !!p.viewAllCases,
    canFinancePersonNames: !!p.financePersonNames,
    permissions: user.is_admin ? { local: effectivePermissions(user, 'local'), online: effectivePermissions(user, 'online') } : parseUserPermissions(user)
  };
}

// Session-Flags aus dem Modus-Zweig setzen - dadurch werden ALLE bestehenden requirePermission-
// Middlewares (auth.js) automatisch modusdifferenziert, ohne selbst vom Modus wissen zu muessen.
function applySessionPermissions(session, user, mode) {
  const p = effectivePermissions(user, mode);
  session.userId = user.id;
  session.isAdmin = !!user.is_admin;
  session.isDemo = !!user.is_demo;
  session.displayName = user.display_name || user.username;
  session.mode = mode;
  session.allowCaseManagement = !!p.caseManagement;
  session.canViewCases = !!p.viewCases;
  session.canEditCases = !!p.editCases;
  session.canViewDocuments = !!p.viewDocuments;
  session.canEditDocuments = !!p.editDocuments;
  session.canViewFinance = !!p.viewFinance;
  session.canEditFinance = !!p.editFinance;
  // Controlling ist ein eigenes Recht, kein Anhaengsel der Finanzen - siehe authorization.js.
  session.canViewControlling = !!p.viewControlling;
  session.canManageMailSettings = !!p.manageMailSettings;
  session.canManageOfficeProfile = !!p.manageOfficeProfile;
  session.canManageMapSettings = !!p.manageMapSettings;
  session.canManageCredentials = !!p.manageCredentials;
  session.canManageCalendarConnections = !!p.manageCalendarConnections;
  session.canApproveMileage = !!p.approveMileage;
  session.canViewAuditLog = !!p.viewAuditLog;
  session.canUseAi = !!p.useAi;
  session.canDocsAllCases = !!p.docsAllCases;
  session.canSendMail = !!p.sendMail;
  session.canUseFieldService = !!p.useFieldService;
  session.canUseExtension = !!p.useExtension;
  session.canViewAllQualifications = !!p.viewAllQualifications;
  session.canViewAllCases = !!p.viewAllCases;
  session.canFinancePersonNames = !!p.financePersonNames;
  // Banking (Hibiscus, 2026-07-26): drei Gefahrenstufen, siehe permissions.js.
  session.canViewBankData = !!p.viewBankData;
  session.canManageBankConnections = !!p.manageBankConnections;
  session.canInitiatePayments = !!p.initiatePayments;
}

// Buerobezogene Zugangsdaten werden NUR bei erfolgreichem Online-Login entschluesselt und
// mitgegeben - landen im Browser ausschliesslich im Arbeitsspeicher der Sitzung (siehe Plan,
// Abschnitt "Frontend-Aenderungen"), nicht in localStorage.
// Bueroweite Admin-Vorgabe fuer KI-Zugangsdaten (aus office_ai_config).
function officeAiConfig() {
  const ai = {};
  for (const row of listAiConfig.all()) {
    ai[row.provider] = { apiKey: cryptoHelper.decrypt(row.api_key_encrypted), model: row.model, endpoint: row.endpoint };
  }
  return ai;
}
// Bueroweite Admin-Vorgabe fuer Versand-Zugangsdaten (aus office_send_credentials).
function officeSendCredentials() {
  const send = {};
  for (const row of listSendCredentials.all()) {
    send[row.service] = {
      username: row.username, password: cryptoHelper.decrypt(row.password_encrypted),
      loginUrl: row.login_url, inboxUrl: row.inbox_url, composeUrl: row.compose_url
    };
  }
  return send;
}

// Liefert die fuer DIESEN Nutzer EFFEKTIVEN buerobezogenen Zugangsdaten: pro Bereich der eigene
// Override (nur mit Recht + gesetzt), sonst die Admin-Vorgabe. `credentialSources` sagt je Bereich,
// woraus die Werte gerade stammen ('user'|'admin') - fuers System-Status-Menue. Nur bei Online-Login
// entschluesselt/mitgegeben; landet im Browser ausschliesslich im Sitzungs-Arbeitsspeicher.
/* Buero-Vorgabe und persoenliche Werte je Anbieter zusammenfuehren - das Buero gewinnt.
   Ein Anbieter-Eintrag zaehlt nur als "vom Buero gesetzt", wenn er wirklich einen Schluessel
   traegt (ein leerer Datensatz entsteht schon beim blossen Modell-Speichern). */
function aiJeAnbieter(buero, eigen) {
  const raus = {};
  const anbieter = new Set([...Object.keys(buero || {}), ...Object.keys((eigen && typeof eigen === 'object') ? eigen : {})]);
  for (const name of anbieter) {
    const b = (buero || {})[name];
    const e = (eigen || {})[name];
    const bHatSchluessel = !!(b && typeof b === 'object' && String(b.apiKey || '').trim());
    if (bHatSchluessel) raus[name] = b;
    else if (e && typeof e === 'object') raus[name] = e;
    else if (b) raus[name] = b;
  }
  return raus;
}

function decryptedOfficeConfig(user, mode) {
  // Rechte-Audit 2026-07-17: ohne useAi-/sendMail-Recht werden die jeweiligen Buero-Zugangsdaten
  // gar nicht erst entschluesselt und ausgeliefert - der Client kann dann keine KI-Aufrufe bzw.
  // keinen Versand mit Buerokonten machen (Server-Routen sind zusaetzlich gegatet, s. mail.js/ext.js).
  const perms = user ? effectivePermissions(user, mode) : null;
  const aiAllowed = !user || !!user.is_admin || !!(perms && perms.useAi);
  const sendAllowed = !user || !!user.is_admin || !!(perms && perms.sendMail);
  const aiOverride = (user && aiAllowed) ? userSettings.effectiveOverride(user, mode, 'ai') : null;
  /* KI-Zugangsdaten JE ANBIETER aufloesen (Nutzerentscheidung 30.08.2026): Hat das Buero fuer
     einen Anbieter einen Schluessel hinterlegt, gilt der - fuer alle, ohne Ausnahme. Nur wo das
     Buero nichts hat, zaehlt der persoenliche Wert.
     Vorher war es ein Entweder-Oder JE NUTZER: ein einziger eigener Claude-Schluessel setzte die
     komplette Buero-Vorgabe ausser Kraft, auch den buerweiten ChatGPT-Schluessel. Genau daraus
     entstand die Doppelmaske im Menue ("oben Keys, unten auch Keys"). */
  const ai = aiAllowed ? aiJeAnbieter(officeAiConfig(), aiOverride) : {};
  const sendOverride = (user && sendAllowed) ? userSettings.effectiveOverride(user, mode, 'send') : null;
  const send = sendAllowed ? ((sendOverride && typeof sendOverride === 'object') ? sendOverride : officeSendCredentials()) : {};
  // smtpConfigured: der Client zeigt den "Direkt per Mail senden"-Button nur bei moeglichem Versand.
  // Effektiv = eigener Mail-Override (falls konfiguriert) sonst die Admin-SMTP-Vorgabe.
  const mailOverride = user ? userSettings.effectiveOverride(user, mode, 'mail') : null;
  const smtpConfigured = sendAllowed && (mailOverride ? mail.isOverrideConfigured(mailOverride) : mail.isConfigured(mail.getSmtpConfig()));
  /* WELCHE Anbieter kommen vom Büro? Nach dem Zusammenführen sieht der Client nur noch den
     wirksamen Schlüssel und könnte die Herkunft nicht mehr erkennen - er braucht sie aber, um
     das Eingabefeld auszublenden bzw. zu zeigen (Prüfstand-Fund 30.08.2026: sonst behauptet
     die Oberfläche auch bei rein persönlichen Schlüsseln „vom Büro hinterlegt"). Nur die
     Anbieter-NAMEN, keine Geheimnisse. */
  const aiBueroAnbieter = aiAllowed
    ? Object.entries(officeAiConfig() || {})
      .filter(([, v]) => v && typeof v === 'object' && String(v.apiKey || '').trim())
      .map(([k]) => k)
    : [];
  const credentialSources = {
    ai: user ? userSettings.overrideSource(user, mode, 'ai') : 'admin',
    send: user ? userSettings.overrideSource(user, mode, 'send') : 'admin',
    mail: user ? userSettings.overrideSource(user, mode, 'mail') : 'admin',
    maps: user ? userSettings.overrideSource(user, mode, 'maps') : 'admin'
  };
  return { aiConfig: ai, aiBueroAnbieter, sendCredentials: send, smtpConfigured, credentialSources };
}

function safeDecryptedOfficeConfig(user, mode) {
  try {
    return {
      ...decryptedOfficeConfig(user, mode),
      secretConfigurationAvailable: true
    };
  } catch (error) {
    // Ein falscher/erneuerter ENCRYPTION_KEY darf weder den Node-Prozess noch eine
    // bereits erfolgreich geprüfte Passwortanmeldung abbrechen. Geheimnisse werden
    // in diesem Fall vollständig zurückgehalten; Einzelwerte werden nie protokolliert.
    console.warn('[auth] Büro-Geheimnisse konnten nicht entschlüsselt werden:', error.message || String(error));
    return {
      aiConfig: {},
      sendCredentials: {},
      smtpConfigured: false,
      credentialSources: {},
      secretConfigurationAvailable: false,
      secretConfigurationError: 'Die geschützten Diensteinstellungen sind derzeit nicht verfügbar.'
    };
  }
}

// Plan Abschnitt AV: Admin-VORGABEN fuer den Lokal-Modus (local_mode_defaults, siehe db.js) - beim
// Lokal-Login entschluesselt mitgeliefert, damit die Client-Praezedenzlogik (eigener Wert nur mit
// manageCredentials-Recht > Admin-Vorgabe > freie Eingabe ohne Vorgabe) synchron entscheiden kann.
// Bewusste, per Rueckfrage bestaetigte Konsequenz: die Vorgaben (inkl. API-Keys) landen dadurch im
// Browser des lokalen Nutzers - im Online-Modus bleiben Keys weiterhin ausschliesslich serverseitig.
const listLocalDefaultsStmt = db.prepare('SELECT area, value_encrypted FROM local_mode_defaults');
function decryptedLocalDefaults() {
  const out = {};
  for (const row of listLocalDefaultsStmt.all()) {
    if (!row.value_encrypted) continue;
    try { out[row.area] = JSON.parse(cryptoHelper.decrypt(row.value_encrypted)); } catch (_e) { /* defekte Zeile ueberspringen */ }
  }
  return out;
}

router.post('/login', async (req, res) => {
  const { username, password, mode } = req.body || {};
  if (!username || !password || !['local', 'online', 'demo'].includes(mode)) {
    return res.status(400).json({ error: 'Nutzername, Passwort und Modus (lokal/online/demo) erforderlich.' });
  }
  const user = getUserByUsername.get(String(username).trim());
  if (!user) {
    try{ logAction(req, 'auth.login_failed', 'user', (user && user.id) || '', { username: String(username||'').slice(0,80) },
      { kategorie:'zugriff', zweck:'verwaltung' }); }catch(_e){}
    return res.status(401).json({ error: 'Nutzername oder Passwort falsch.' });
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    try{ logAction(req, 'auth.login_failed', 'user', (user && user.id) || '', { username: String(username||'').slice(0,80) },
      { kategorie:'zugriff', zweck:'verwaltung' }); }catch(_e){}
    return res.status(401).json({ error: 'Nutzername oder Passwort falsch.' });
  }
  // Deaktivierte Konten (Plan Abschnitt AV: "Deaktivieren statt Loeschen"): Login gesperrt,
  // bewusst mit eigener, klarer Meldung statt der generischen (kein Enumeration-Risiko - der
  // Angreifer muesste dafuer bereits das korrekte Passwort kennen).
  if (user.active === 0) {
    return res.status(403).json({ error: 'Dieses Konto ist deaktiviert.' });
  }
  /* Demo-Modus (30.08.2026): Vorfuehrkonten (is_demo) melden sich AUSSCHLIESSLICH ueber den
     Demo-Zugang an, echte Konten niemals darueber - und nur solange der Admin-Schalter an ist.
     So bleibt die Vorfuehrwelt in beide Richtungen dicht. */
  if (mode === 'demo') {
    if (!demoErlaubt()) return res.status(403).json({ error: 'Der Demo-Modus ist ausgeschaltet.' });
    if (!user.is_demo) return res.status(403).json({ error: 'Dieses Konto ist kein Vorführkonto.' });
  } else if (user.is_demo) {
    return res.status(403).json({ error: 'Vorführkonten melden sich über den Demo-Zugang an.' });
  }
  if (mode === 'local' && !user.allow_local) {
    return res.status(403).json({ error: 'Dieses Konto ist nicht fuer den Lokal-Modus freigeschaltet.' });
  }
  if (mode === 'online' && !user.allow_online && !(recoveryMode.isActive() && user.is_admin)) {
    return res.status(403).json({ error: 'Dieses Konto ist nicht fuer den Online-Modus freigeschaltet.' });
  }
  if (recoveryMode.isActive() && (!user.is_admin || mode !== 'online')) {
    return res.status(503).json({
      error: 'Im Wiederherstellungsmodus ist ausschließlich die Online-Anmeldung eines Administrators zulässig.',
      code: 'RECOVERY_ADMIN_LOGIN_REQUIRED'
    });
  }

  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'Sitzung konnte nicht erstellt werden.' });
    applySessionPermissions(req.session, user, mode);
    /* Anmeldungen gehoeren ins Verarbeitungs-Log (Nutzerwunsch 25.08.2026) - bis dahin war der
       erfolgreiche Login der einzige nicht protokollierte sicherheitsrelevante Vorgang. */
    try{ logAction(req, 'auth.login', 'user', user.id, { username: user.username, mode },
      { kategorie:'zugriff', zweck:'verwaltung' }); }catch(_e){}
    req.session.save((saveError) => {
      if (saveError) return res.status(500).json({ error: 'Sitzung konnte nicht gespeichert werden.' });
      const payload = {
        user: publicUser(user, mode),
        mode,
        recovery: recoveryMode.status()
      };
      if (mode === 'online' && !recoveryMode.isActive()) {
        Object.assign(payload, safeDecryptedOfficeConfig(user, mode));
      }
      // Lokal-Modus: Admin-Vorgaben mitliefern (Plan Abschnitt AV) - leeres Objekt, wenn keine gesetzt.
      if (mode === 'local') payload.localDefaults = decryptedLocalDefaults();
      res.json(payload);
    });
  });
});

// Nutzerwunsch: Admins (immer) und einzelne per allow_mode_switch freigeschaltete Nutzer sollen
// per Button im Nutzer-Menü zwischen Lokal- und Online-Modus wechseln koennen, OHNE sich neu
// anzumelden (kein erneutes Passwort noetig, da die Sitzung bereits als dieser Nutzer authentifiziert
// ist). Antwortform bewusst identisch zu POST /login gehalten (user/mode/aiConfig/sendCredentials),
// damit das Frontend nach dem Wechsel exakt denselben Reload-Pfad wie nach einem frischen Login
// nutzen kann, statt eine zweite Antwortform gesondert behandeln zu muessen.
router.post('/switch-mode', requireAuth, (req, res) => {
  /* Demo-Modus (30.08.2026): Vorfuehrkonten bleiben in ihrer Welt. */
  if (req.session.isDemo) return res.status(403).json({ error: 'Im Demo-Modus gibt es keinen Moduswechsel.' });
  if (recoveryMode.isActive()) {
    return res.status(503).json({
      error: 'Der Moduswechsel ist während der Wiederherstellung gesperrt.',
      code: 'RECOVERY_MODE_ACTIVE'
    });
  }
  const { mode } = req.body || {};
  if (!['local', 'online'].includes(mode)) {
    return res.status(400).json({ error: 'Modus (lokal/online) erforderlich.' });
  }
  const user = getUserById.get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (user.active === 0) return res.status(403).json({ error: 'Dieses Konto ist deaktiviert.' });
  if (!user.is_admin && !user.allow_mode_switch) {
    return res.status(403).json({ error: 'Dieses Konto darf den Modus nicht wechseln.' });
  }
  if (mode === 'local' && !user.allow_local) {
    return res.status(403).json({ error: 'Dieses Konto ist nicht fuer den Lokal-Modus freigeschaltet.' });
  }
  if (mode === 'online' && !user.allow_online) {
    return res.status(403).json({ error: 'Dieses Konto ist nicht fuer den Online-Modus freigeschaltet.' });
  }
  // Session-Flags fuer den NEUEN Modus neu berechnen (Plan Abschnitt AV: Rechte sind jetzt
  // modusdifferenziert - ein blosses mode-Umschreiben liesse die Flags des alten Modus aktiv).
  applySessionPermissions(req.session, user, mode);
  try{ logAction(req, 'auth.mode_switched', 'user', user.id, { username: user.username, mode },
    { kategorie:'zugriff', zweck:'verwaltung' }); }catch(_e){}
  req.session.save((saveError) => {
    if (saveError) return res.status(500).json({ error: 'Sitzung konnte nicht gespeichert werden.' });
    const payload = { user: publicUser(user, mode), mode };
    if (mode === 'online') Object.assign(payload, safeDecryptedOfficeConfig(user, mode));
    if (mode === 'local') payload.localDefaults = decryptedLocalDefaults();
    res.json(payload);
  });
});

// "Passwort vergessen": Audit-Log-Eintrag (als Warnung markiert, siehe renderAuditTab) PLUS,
// falls im Admin-Panel eine SMTP-Konfiguration hinterlegt ist (Phase 5, server/mail.js), eine
// tatsaechliche Benachrichtigungsmail an den Admin. Ein Mail-Fehlschlag (falsche SMTP-Zugangsdaten,
// Server nicht erreichbar, ...) darf die Antwort NICHT veraendern - Antwort ist IMMER identisch
// generisch-erfolgreich, unabhaengig davon ob der Nutzername existiert (keine Nutzername-
// Enumeration) oder ob der Mailversand geklappt hat.
router.post('/forgot-password', async (req, res) => {
  const { username } = req.body || {};
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (forgotPasswordRateLimited(ip)) {
    return res.status(429).json({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  }
  const trimmed = String(username || '').trim();
  if (trimmed) {
    const user = getUserByUsername.get(trimmed);
    logAction(
      { session: { userId: null, displayName: '' } },
      'password.forgot_request',
      'user',
      user ? user.id : trimmed,
      { username: trimmed, userExists: !!user, ip }
    );
    try {
      const result = await mail.sendForgotPasswordNotification({ username: trimmed, userExists: !!user, ip });
      if (!result.sent) console.warn('[forgot-password] Mailversand uebersprungen/fehlgeschlagen:', result.reason);
    } catch (error) {
      console.warn('[forgot-password] Mailversand fehlgeschlagen:', error.message);
    }
  }
  res.json({ ok: true, message: 'Falls dieser Nutzername existiert, wurde der Admin benachrichtigt.' });
});

router.post('/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });
  try{ if(req.session.userId) logAction(req, 'auth.logout', 'user', req.session.userId, {},
    { kategorie:'zugriff', zweck:'verwaltung' }); }catch(_e){}
  req.session.destroy(() => {
    res.clearCookie('betreuungsbuero.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }
  const user = getUserById.get(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }
  if (recoveryMode.isActive() && !user.is_admin) {
    return res.status(503).json({
      error: 'Im Wiederherstellungsmodus ist ausschließlich ein Administratorkonto zulässig.',
      code: 'RECOVERY_ADMIN_LOGIN_REQUIRED'
    });
  }
  const payload = {
    user: publicUser(user, req.session.mode),
    mode: req.session.mode,
    recovery: recoveryMode.status()
  };
  // Lokal-Vorgaben auch bei der Sitzungs-Wiederherstellung nach einem Seiten-Reload mitliefern -
  // das Login-Gate ruft onLoggedIn() mit GENAU dieser Antwort auf (statt der /login-Antwort), die
  // Praezedenzlogik (local-defaults-apply-script-v1) braucht die Vorgaben also auch hier.
  if (req.session.mode === 'local') payload.localDefaults = decryptedLocalDefaults();
  // Online-Modus: Office-Konfig (KI-/Versand-Zugangsdaten + smtpConfigured) auch bei der
  // Sitzungs-Wiederherstellung nach einem Reload mitliefern - sonst setzt der Client
  // (onLoggedIn) smtpConfigured/aiConfig/sendCredentials nach jedem Reload auf leer zurueck
  // (der "Direkt per Mail senden"-Button verschwand dadurch, KI-Keys gingen verloren). Genau
  // dasselbe Payload wie bei /login und /switch-mode.
  if (req.session.mode === 'online' && !recoveryMode.isActive()) {
    Object.assign(payload, safeDecryptedOfficeConfig(user, req.session.mode));
  }
  res.json(payload);
});

// Selbstbedienungs-Passwortwechsel (Phase 2.2): jeder eingeloggte Nutzer darf sein EIGENES
// Passwort aendern, unabhaengig vom Modus - im Unterschied zum Admin-Panel (server/routes/admin.js),
// das Passwoerter beliebiger Nutzer setzen kann, aber ohne das aktuelle Passwort zu kennen.
router.put('/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich.' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Neues Passwort muss mindestens 8 Zeichen lang sein.' });
  }
  const user = getUserById.get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Aktuelles Passwort ist falsch.' });
  updatePasswordStmt.run(await hashPassword(newPassword), user.id);
  /* Der Auth-Router liegt VOR der Sammel-Middleware und wird von ihr strukturell nie gesehen. */
  try{ logAction(req, 'auth.password_changed', 'user', user.id, { username: user.username },
    { kategorie:'aenderung', zweck:'verwaltung' }); }catch(_e){}
  res.json({ ok: true });
});

router._test = { decryptedOfficeConfig, safeDecryptedOfficeConfig };
module.exports = router;
