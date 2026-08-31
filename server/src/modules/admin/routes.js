// Admin-Panel-Endpunkte (Phase 2.1.1, ersetzt die separate Phase 2.2): Nutzerverwaltung,
// bueroweite KI-/Versand-Zugangsdaten. Alle Routen erfordern is_admin (siehe requireAdmin in
// auth.js). Zugangsdaten werden nie automatisch im Klartext ausgeliefert - erst der explizite
// "Anzeigen"-Aufruf (.../reveal) entschluesselt (siehe Plan, Abschnitt "Admin-Panel").

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_ROOT } = require('../../config/paths');
const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const { requireAdmin, hashPassword, verifyPassword } = require('../../middleware/authentication');
const { logAction } = require('../../middleware/audit');
const { parseUserPermissions, serializePermissions, PERMISSION_KEYS } = require('../../middleware/authorization');
const caldav = require('../../integrations/calendar/caldav');
const googleCal = require('../../integrations/calendar/google-calendar');
const microsoftCal = require('../../integrations/calendar/microsoft-calendar');
const contactsSync = require('../contacts/sync');
const themePrefs = require('../settings/theme-preferences');
const { createDocumentMigration } = require('../documents/migration');
const backupData = require('../backup/portable-data');
const secureJson = require('../../security/secure-json');
const recoveryKeyStore = require('../recovery/key-store');
const recoveryMode = require('../recovery/mode').ensure(db);
const documentOperationCoordinator = require('../documents/operation-coordinator');

const router = express.Router();
// Personenregister (Etappe 1): jedes Konto haengt an einer Person - anlegen verknuepft/erzeugt,
// Profilaenderungen ziehen die Person nach, loeschen loest nur die Verknuepfung (Person bleibt).
const personen = require('../office/persons-routes');
const listUsersStmt = db.prepare('SELECT * FROM users WHERE is_demo = ? ORDER BY username COLLATE NOCASE');
const getUserStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const getUserByUsernameStmt = db.prepare('SELECT id FROM users WHERE username = ?');
const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ?');

function activeOnlineAdminCount(targetDb) {
  const row = (targetDb || db).prepare(`
    SELECT COUNT(*) AS n
      FROM users
     WHERE active<>0 AND is_admin<>0 AND allow_online<>0
       AND password_hash IS NOT NULL AND password_hash<>''
  `).get();
  return Number(row && row.n) || 0;
}

function assertActiveOnlineAdmin(targetDb) {
  if (activeOnlineAdminCount(targetDb) > 0) return;
  const error = new Error(
    'Die Änderung würde den letzten aktiven Online-Administrator entfernen.'
  );
  error.code = 'RESTORE_LAST_ACTIVE_ONLINE_ADMIN_REQUIRED';
  throw error;
}

function liveAdminRoutePermission(req, user) {
  if (!user || user.active === 0 || user.allow_online === 0) return false;
  if (user.is_admin) return true;
  const branch = parseUserPermissions(user)[req.session && req.session.mode === 'local' ? 'local' : 'online'];
  if (req.path === '/audit-log') return !!branch.viewAuditLog;
  if (req.path.startsWith('/calendar-connections')) return !!branch.manageCalendarConnections;
  // Das Sync-Journal beschreibt ausschliesslich die Kalender-/Aufgabenverbindungen - dasselbe
  // delegierbare Recht. Feed-Tokens (Etappe 4) bleiben bewusst admin-only (Token-Ausgabe).
  if (req.path === '/sync-journal') return !!branch.manageCalendarConnections;
  return false;
}

// Plan Abschnitt AV: statt des bisherigen blanket requireAdmin ein Gate mit zwei gezielten,
// delegierbaren Ausnahmen - Audit-Log (Lesezugriff per viewAuditLog-Recht) und Kalender-
// verbindungen (manageCalendarConnections-Recht). Alle uebrigen /api/admin-Routen bleiben
// admin-only. Eine alte Express-Sitzung ist dabei keine Autoritätsquelle: Deaktivierung,
// Entzug des Adminrechts und delegierte Rechte werden bei jedem Aufruf aus der Live-DB gelesen.
router.use((req, res, next) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const liveUser = getUserStmt.get(req.session.userId);
  if (liveUser && liveUser.active !== 0) {
    // Das Adminflag wird sofort in beide Richtungen gespiegelt. So kann auch innerhalb
    // desselben Requests kein nachgelagerter Handler ein veraltetes Adminrecht benutzen.
    req.session.isAdmin = !!liveUser.is_admin;
  }
  if (liveAdminRoutePermission(req, liveUser)) return next();
  return res.status(403).json({ error: 'Nur fuer Administratoren.' });
});

/* ===== Nutzer loeschen: Fremdschluessel-Landkarte AUS DEM SCHEMA (30.08.2026) =====
   Vorher stand hier eine handgepflegte Liste von acht Spalten. Die App ist seither um Chat,
   Mail, Banking, Unterschriften, Formulare und mehr gewachsen: 53 Spalten verweisen inzwischen
   auf users, 42 davon fehlten in der Liste. Folge (Nutzerbefund): Jedes Konto, das die App je
   benutzt hatte - eine Chat-Teilnahme genuegt -, liess sich nicht mehr loeschen, der Server
   antwortete nur "Interner Serverfehler". Eine Handliste veraltet zwangslaeufig; deshalb wird
   die Landkarte jetzt beim Start aus dem Schema gelesen und wendet drei Regeln an:
     - ON DELETE CASCADE / SET NULL -> nichts tun, SQLite regelt es selbst
     - Spalte erlaubt NULL          -> auf NULL setzen ("wer war's zuletzt" geht verloren,
                                       der Datensatz bleibt vollstaendig erhalten)
     - Spalte ist NOT NULL          -> nur nach AUSDRUECKLICHER Regel unten; alles andere
                                       BLOCKIERT das Loeschen mit klarer Meldung statt zu
                                       raten. Neue Tabellen sind damit automatisch abgedeckt
                                       und koennen nie stillschweigend Daten verlieren. */
const NOT_NULL_REGELN = {
  /* Rein persoenlich - ohne ihren Nutzer bedeutungslos, wandern mit: */
  'api_tokens.user_id': { modus: 'loeschen' },
  'user_ui_prefs.user_id': { modus: 'loeschen' },
  'user_settings_overrides.user_id': { modus: 'loeschen' },
  'chat_participants.user_id': { modus: 'loeschen' },
  'mail_prefs.user_id': { modus: 'loeschen' },
  'chat_user_status.user_id': { modus: 'loeschen' },
  /* Traegt fremde oder abrechnungsrelevante Inhalte - der Admin entscheidet bewusst: */
  'mileage_trips.fahrer_user_id': { modus: 'blockieren', was: 'Fahrten im Fahrtenbuch' },
  'private_vehicles.owner_user_id': { modus: 'blockieren', was: 'private Fahrzeuge' },
  'chat_conversations.created_by': { modus: 'blockieren', was: 'Chat-Gespräche (mit Nachrichten anderer)' },
};
/* persons.user_id laeuft ueber detachPersonFromUser (setzt zusaetzlich updated_at) - die
   Person bleibt bestehen, ihre Kennung wird nie wiederverwendet. */
const FK_SELBST_BEHANDELT = new Set(['persons.user_id']);

function userFremdschluesselKarte() {
  const raus = [];
  const tabellen = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const tabelle of tabellen) {
    let fks = [];
    try { fks = db.prepare(`PRAGMA foreign_key_list("${tabelle}")`).all(); } catch (_e) { continue; }
    for (const fk of fks) {
      if (fk.table !== 'users') continue;
      const schluessel = `${tabelle}.${fk.from}`;
      if (FK_SELBST_BEHANDELT.has(schluessel)) continue;
      if (/CASCADE|SET NULL/i.test(String(fk.on_delete || ''))) continue;
      const spalte = db.prepare(`PRAGMA table_info("${tabelle}")`).all().find((c) => c.name === fk.from);
      /* PRIMAERSCHLUESSEL-Spalten meldet PRAGMA teils als "notnull=0" (INTEGER PRIMARY KEY ist
         formal der rowid-Alias), auf NULL setzen laesst sich so eine Spalte trotzdem NIE -
         SQLite antwortet mit SQLITE_MISMATCH. Solche Zeilen gehoeren immer dem Nutzer und
         werden wie NOT NULL behandelt (gefunden am Pruefstand: mail_prefs.user_id). */
      if (spalte && !spalte.notnull && !spalte.pk) { raus.push({ tabelle, spalte: fk.from, schluessel, modus: 'null' }); continue; }
      const regel = NOT_NULL_REGELN[schluessel] || { modus: 'blockieren', was: tabelle };
      raus.push({ tabelle, spalte: fk.from, schluessel, modus: regel.modus, was: regel.was });
    }
  }
  return raus;
}
const USER_FK_KARTE = userFremdschluesselKarte();

/* Was haelt dieses Konto fest? Liefert lesbare Brocken fuer die Fehlermeldung. */
function userLoeschHindernisse(userId) {
  const hindernisse = [];
  for (const fk of USER_FK_KARTE) {
    if (fk.modus !== 'blockieren') continue;
    let n = 0;
    try { n = db.prepare(`SELECT COUNT(*) AS n FROM "${fk.tabelle}" WHERE "${fk.spalte}" = ?`).get(userId).n; }
    catch (_e) { continue; }
    if (n > 0) hindernisse.push(`${n} ${fk.was || fk.tabelle}`);
  }
  return hindernisse;
}

const deleteUserTx = db.transaction((userId) => {
  for (const fk of USER_FK_KARTE) {
    if (fk.modus === 'null') {
      db.prepare(`UPDATE "${fk.tabelle}" SET "${fk.spalte}" = NULL WHERE "${fk.spalte}" = ?`).run(userId);
    } else if (fk.modus === 'loeschen') {
      db.prepare(`DELETE FROM "${fk.tabelle}" WHERE "${fk.spalte}" = ?`).run(userId);
    }
  }
  personen.detachPersonFromUser(userId);
  deleteUserStmt.run(userId);
  assertActiveOnlineAdmin(db);
});

// Admin-Sicht auf einen Nutzer: volle Rechte-Matrix (permissions) + alle Profilfelder inkl. des
// nur hier (nicht in /api/me) sichtbaren notes-Felds. Die alten camelCase-Einzelflags werden aus
// der Matrix (Online-Zweig) gespiegelt, damit die bisherige Admin-UI bis zu ihrem Umbau (Plan
// Abschnitt AV, Phase 3) unveraendert weiterfunktioniert.
function publicUser(u) {
  const perms = parseUserPermissions(u);
  const theme = themePrefs.getThemeSettings(u.id);
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name || u.username,
    firstName: u.first_name || '',
    lastName: u.last_name || '',
    salutation: u.salutation || '',
    email: u.email || '',
    phone: u.phone || '',
    mobile: u.mobile || '',
    jobTitle: u.job_title || '',
    initials: u.initials || '',
    maKennung: u.ma_kennung || '',
    joinedAt: u.joined_at || '',
    leftAt: u.left_at || '',
    notes: u.notes || '',
    active: u.active !== 0,
    istBetreuer: u.ist_betreuer === 1,
    calendarColor: u.calendar_color || '',
    themePreference: theme.preference,
    themeScheduleEnabled: theme.scheduleEnabled,
    allowLocal: !!u.allow_local,
    allowOnline: !!u.allow_online,
    isAdmin: !!u.is_admin,
    // Der Arbeitsdatenexport braucht die echte DB-Markierung; aus Anzeigename/Nutzername zu
    // raten waere fehleranfaellig. Die Admin-Oberflaeche darf das Feld einfach ignorieren.
    isDemo: !!u.is_demo,
    allowModeSwitch: !!u.allow_mode_switch,
    permissions: perms,
    allowCaseManagement: !!perms.online.caseManagement,
    canViewCases: !!perms.online.viewCases,
    canEditCases: !!perms.online.editCases,
    canViewDocuments: !!perms.online.viewDocuments,
    canEditDocuments: !!perms.online.editDocuments,
    canViewFinance: !!perms.online.viewFinance,
    canEditFinance: !!perms.online.editFinance,
    canViewControlling: !!perms.online.viewControlling,
    canManageMailSettings: !!perms.online.manageMailSettings,
    canManageOfficeProfile: !!perms.online.manageOfficeProfile,
    canManageMapSettings: !!perms.online.manageMapSettings,
    createdAt: u.created_at
  };
}

// Uebersetzt die im Request enthaltenen Rechte in die zu speichernde Matrix: kommt eine explizite
// `permissions`-Matrix (neue UI), gilt sie; kommen nur die alten Einzelflags (bisherige UI), werden
// sie in BEIDE Modus-Zweige uebernommen (bisherige, modusunabhaengige Semantik). Die Alt-Spalten
// werden in beiden Faellen aus dem Online-Zweig mitgepflegt (Fallback-Quelle, siehe permissions.js).
const LEGACY_FLAG_TO_KEY = {
  allowCaseManagement: 'caseManagement', canViewCases: 'viewCases', canEditCases: 'editCases',
  canViewDocuments: 'viewDocuments', canEditDocuments: 'editDocuments',
  canViewFinance: 'viewFinance', canEditFinance: 'editFinance',
  canManageMailSettings: 'manageMailSettings', canManageOfficeProfile: 'manageOfficeProfile',
  canManageMapSettings: 'manageMapSettings', canManageCredentials: 'manageCredentials',
  canManageCalendarConnections: 'manageCalendarConnections', canApproveMileage: 'approveMileage',
  canViewAuditLog: 'viewAuditLog'
};
function resolvePermissionsFromBody(body, existingUserRow) {
  const base = parseUserPermissions(existingUserRow || null);
  if (body && body.permissions && typeof body.permissions === 'object') {
    return JSON.parse(serializePermissions({
      local: { ...base.local, ...(body.permissions.local || {}) },
      online: { ...base.online, ...(body.permissions.online || {}) }
    }, existingUserRow || null));
  }
  const next = { local: { ...base.local }, online: { ...base.online } };
  for (const [flag, key] of Object.entries(LEGACY_FLAG_TO_KEY)) {
    if (body && body[flag] != null) { next.local[key] = !!body[flag]; next.online[key] = !!body[flag]; }
  }
  return next;
}
const LEGACY_COLUMN_BY_KEY = {
  caseManagement: 'allow_case_management', viewCases: 'can_view_cases', editCases: 'can_edit_cases',
  viewDocuments: 'can_view_documents', editDocuments: 'can_edit_documents',
  viewFinance: 'can_view_finance', editFinance: 'can_edit_finance',
  manageMailSettings: 'can_manage_mail_settings', manageOfficeProfile: 'can_manage_office_profile',
  manageMapSettings: 'can_manage_map_settings'
};
function persistPermissions(userId, matrix) {
  db.prepare('UPDATE users SET permissions_json = ? WHERE id = ?').run(JSON.stringify(matrix), userId);
  // Alt-Spalten aus dem Online-Zweig mitpflegen (nur bestehende Spalten, neue Rechte haben keine).
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(LEGACY_COLUMN_BY_KEY)) {
    sets.push(`${column} = ?`);
    values.push(matrix.online[key] ? 1 : 0);
  }
  values.push(userId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

router.get('/users', (req, res) => {
  res.json({ users: listUsersStmt.all(req.session && req.session.isDemo ? 1 : 0).map(publicUser) });
});

/* Fallzuordnung je Nutzer (2026-07-26) - Datenquelle des Admin-Tabs „Fälle".
   Vier Stufen je Fall: owner (zuständig) | write (bearbeiten) | read (sehen) | none.
   „owner" steht bewusst ueber den Freigaben: ein Fall hat genau eine zustaendige Person. */
router.get('/users/:id/cases', (req, res) => {
  const uid = Number(req.params.id);
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(uid)) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
  const rows = db.prepare(`
    SELECT c.id, c.label, c.file_number, c.archived, c.owner_user_id, uo.display_name AS owner_name,
           ca.level AS level
    FROM cases c
    LEFT JOIN users uo ON uo.id = c.owner_user_id
    LEFT JOIN case_access ca ON ca.case_id = c.id AND ca.user_id = @uid
    ORDER BY c.archived, c.label COLLATE NOCASE
  `).all({ uid });
  res.json({
    faelle: rows.map((r) => ({
      id: r.id,
      label: r.label,
      fileNumber: r.file_number || '',
      archived: !!r.archived,
      ownerUserId: r.owner_user_id == null ? null : Number(r.owner_user_id),
      ownerName: r.owner_name || '',
      stufe: Number(r.owner_user_id) === uid ? 'owner'
        : (r.level === 'write' ? 'write' : (r.level === 'read' ? 'read' : 'none'))
    }))
  });
});

router.put('/users/:id/cases', (req, res) => {
  const uid = Number(req.params.id);
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(uid)) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
  const liste = Array.isArray(req.body && req.body.faelle) ? req.body.faelle : [];
  const bekannt = new Set(db.prepare('SELECT id FROM cases').all().map((c) => String(c.id)));
  let uebernommen = 0, entzogen = 0;
  const schreiben = db.transaction(() => {
    for (const f of liste.slice(0, 2000)) {
      const id = String((f && f.id) || '');
      if (!bekannt.has(id)) continue;
      const stufe = ['owner', 'write', 'read', 'none'].includes(String(f.stufe)) ? String(f.stufe) : 'none';
      const aktuell = db.prepare('SELECT owner_user_id FROM cases WHERE id = ?').get(id);
      const istEigner = Number(aktuell.owner_user_id) === uid;
      if (stufe === 'owner') {
        /* Zustaendigkeit uebernehmen: eine eventuelle frühere Person verliert sie hier - das ist
           gewollt, ein Fall hat genau eine zustaendige Person. Die Oberflaeche weist darauf hin. */
        if (!istEigner) { db.prepare('UPDATE cases SET owner_user_id = ? WHERE id = ?').run(uid, id); uebernommen++; }
        db.prepare('DELETE FROM case_access WHERE case_id = ? AND user_id = ?').run(id, uid);
      } else {
        /* War die Person zustaendig und ist es nicht mehr, faellt der Fall auf „niemand" zurueck -
           er wird NICHT still jemand anderem zugeschlagen. */
        if (istEigner) { db.prepare('UPDATE cases SET owner_user_id = NULL WHERE id = ?').run(id); entzogen++; }
        db.prepare('DELETE FROM case_access WHERE case_id = ? AND user_id = ?').run(id, uid);
        if (stufe === 'read' || stufe === 'write') {
          db.prepare('INSERT INTO case_access (case_id, user_id, level, created_by) VALUES (?, ?, ?, ?)')
            .run(id, uid, stufe, req.session.userId);
        }
      }
    }
  });
  schreiben();
  logAction(req, 'user.cases', 'user', String(uid), { gesetzt: liste.length, uebernommen, entzogen });
  res.json({ ok: true, uebernommen, entzogen });
});

// Profilfelder (Plan Abschnitt AV) - gemeinsame Anwenden-Funktion fuer POST + PUT.
const PROFILE_FIELDS = {
  displayName: 'display_name', firstName: 'first_name', lastName: 'last_name', salutation: 'salutation',
  email: 'email', phone: 'phone', mobile: 'mobile', jobTitle: 'job_title', initials: 'initials',
  maKennung: 'ma_kennung', joinedAt: 'joined_at', leftAt: 'left_at', notes: 'notes', calendarColor: 'calendar_color'
};
function applyProfileFields(userId, body) {
  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(PROFILE_FIELDS)) {
    if (body && body[field] != null) { sets.push(`${column} = ?`); values.push(String(body[field]).trim()); }
  }
  if (body && body.active != null) { sets.push('active = ?'); values.push(body.active ? 1 : 0); }
  /* "Fuehrt eigene Betreuungen" (30.08.2026) - Boolean, deshalb nicht in PROFILE_FIELDS. */
  if (body && body.istBetreuer != null) { sets.push('ist_betreuer = ?'); values.push(body.istBetreuer ? 1 : 0); }
  if (!sets.length) return;
  values.push(userId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

router.post('/users', async (req, res) => {
  const { username, password, displayName, allowLocal, allowOnline, isAdmin, allowModeSwitch } = req.body || {};
  if (!username || !String(username).trim() || !password) {
    return res.status(400).json({ error: 'Nutzername und Passwort erforderlich.' });
  }
  if (getUserByUsernameStmt.get(String(username).trim())) {
    return res.status(409).json({ error: 'Nutzername bereits vergeben.' });
  }
  /* Bugjagd 30.08.2026: die Kennung WIRD VOR dem Anlegen geprueft. Vorher verschluckte der
     ensurePersonForUser-catch den Konflikt still - das Konto trug dann eine doppelte
     ma_kennung, seine Person blieb ohne Kennung, und JEDES spaetere Speichern des Kontos
     scheiterte am 409 des Spiegels. Kommt eine personId mit ("Konto anlegen" aus dem
     Personen-Menue), zaehlt deren eigene Kennung natuerlich nicht als Konflikt. */
  const personId = String((req.body || {}).personId || '').trim() || null;
  const kennungsKonflikt = personen.kennungKonflikt((req.body || {}).maKennung, personId || '');
  if (kennungsKonflikt) {
    return res.status(409).json({
      error: `Die Kennung ist bereits vergeben (${[kennungsKonflikt.first_name, kennungsKonflikt.last_name].filter(Boolean).join(' ')}). Kennungen werden nie doppelt oder erneut vergeben.`,
      code: 'PERSON_KENNUNG_VERGEBEN',
    });
  }
  const passwordHash = await hashPassword(password);
  let userId;
  try {
    db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO users (username, password_hash, display_name, allow_local, allow_online, is_admin, allow_mode_switch)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(String(username).trim(), passwordHash, displayName || username, allowLocal ? 1 : 0, allowOnline ? 1 : 0, isAdmin ? 1 : 0, allowModeSwitch ? 1 : 0);
      userId = info.lastInsertRowid;
      applyProfileFields(userId, req.body);
      /* Person anlegen/verknuepfen IM selben Commit - wirft sie, entsteht auch kein Konto. */
      personen.ensurePersonForUser(userId, personId);
      persistPermissions(userId, resolvePermissionsFromBody(req.body, null));
    })();
  } catch (error) {
    if (error && (error.code === 'PERSON_FEHLT' || error.code === 'PERSON_HAT_KONTO')) {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    throw error;
  }
  themePrefs.setThemeSettings(userId, {
    preference: req.body.themePreference,
    scheduleEnabled: req.body.themeScheduleEnabled,
  }, req.session.userId);
  logAction(req, 'user.create', 'user', userId, { username: String(username).trim() });
  res.status(201).json({ user: publicUser(getUserStmt.get(userId)) });
});

router.put('/users/:id', async (req, res) => {
  const user = getUserStmt.get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
  const { password, allowLocal, allowOnline, isAdmin, allowModeSwitch } = req.body || {};
  const passwordHash = password ? await hashPassword(password) : user.password_hash;
  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE users SET password_hash = ?, allow_local = ?, allow_online = ?, is_admin = ?, allow_mode_switch = ?
        WHERE id = ?
      `).run(
        passwordHash,
        allowLocal != null ? (allowLocal ? 1 : 0) : user.allow_local,
        allowOnline != null ? (allowOnline ? 1 : 0) : user.allow_online,
        isAdmin != null ? (isAdmin ? 1 : 0) : user.is_admin,
        allowModeSwitch != null ? (allowModeSwitch ? 1 : 0) : user.allow_mode_switch,
        user.id
      );
      applyProfileFields(user.id, req.body);
      /* Person nachziehen - wirft bei Kennungs-Kollision und rollt damit AUCH die
         users-Aenderung zurueck (eine Wahrheit, ein Fehler). */
      personen.syncPersonFromUser(user.id);
      persistPermissions(user.id, resolvePermissionsFromBody(req.body, user));
      assertActiveOnlineAdmin(db);
    })();
  } catch (error) {
    if (error && error.code === 'RESTORE_LAST_ACTIVE_ONLINE_ADMIN_REQUIRED') {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    if (error && error.code === 'PERSON_KENNUNG_VERGEBEN') {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    throw error;
  }
  if (req.body && (req.body.themePreference != null || req.body.themeScheduleEnabled != null)) {
    themePrefs.setThemeSettings(user.id, {
      preference: req.body.themePreference,
      scheduleEnabled: req.body.themeScheduleEnabled,
    }, req.session.userId);
  }
  logAction(req, 'user.update', 'user', user.id, { username: user.username, passwordChanged: !!password });
  res.json({ user: publicUser(getUserStmt.get(user.id)) });
});

router.delete('/users/:id', (req, res) => {
  const user = getUserStmt.get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
  if (Number(req.params.id) === req.session.userId) {
    return res.status(400).json({ error: 'Der eigene Account kann nicht geloescht werden.' });
  }
  /* Ehrliche Absage STATT eines 500ers: haengen am Konto Daten, die nicht einfach mitgeloescht
     werden duerfen (Fahrten, Fahrzeuge, Chat-Gespraeche), sagt die Meldung genau das - und
     nennt den schonenden Weg. */
  const hindernisse = userLoeschHindernisse(req.params.id);
  if (hindernisse.length) {
    return res.status(409).json({
      error: `Dieses Konto kann nicht gelöscht werden – es hängen noch Daten daran: ${hindernisse.join(', ')}. `
        + 'Bitte diese zuerst übertragen oder entfernen – oder das Konto stattdessen deaktivieren, '
        + 'dann bleiben alle Daten erhalten und der Zugang ist trotzdem gesperrt.',
      code: 'USER_DELETE_BLOCKED',
    });
  }
  try {
    deleteUserTx(req.params.id);
  } catch (error) {
    if (error && error.code === 'RESTORE_LAST_ACTIVE_ONLINE_ADMIN_REQUIRED') {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    throw error;
  }
  themePrefs.removeThemeSettings(user.id, req.session.userId);
  logAction(req, 'user.delete', 'user', req.params.id, { username: user.username });
  res.json({ ok: true });
});

/* Alle 8 Client-Anbieter (30.08.2026): vorher fehlten poe/langdock/deutschlandgpt - fuer die
   konnte das Buero strukturell nie einen Schluessel hinterlegen. */
const AI_PROVIDERS = ['openai', 'anthropic', 'gemini', 'ionos', 'poe', 'langdock', 'deutschlandgpt', 'ollama'];
const getAiConfigStmt = db.prepare('SELECT * FROM office_ai_config WHERE provider = ?');
const upsertAiConfigStmt = db.prepare(`
  INSERT INTO office_ai_config (provider, api_key_encrypted, model, endpoint) VALUES (@provider, @apiKeyEncrypted, @model, @endpoint)
  ON CONFLICT(provider) DO UPDATE SET api_key_encrypted = excluded.api_key_encrypted, model = excluded.model,
    endpoint = excluded.endpoint, updated_at = datetime('now')
`);

router.get('/ai-config', (req, res) => {
  const rows = db.prepare('SELECT provider, model, endpoint, updated_at FROM office_ai_config').all();
  const byProvider = Object.fromEntries(rows.map((r) => [r.provider, { model: r.model, endpoint: r.endpoint, updatedAt: r.updated_at, hasKey: true }]));
  res.json({ providers: AI_PROVIDERS.map((p) => ({ provider: p, ...(byProvider[p] || { model: '', endpoint: '', hasKey: false }) })) });
});

router.get('/ai-config/:provider/reveal', (req, res) => {
  const row = getAiConfigStmt.get(req.params.provider);
  if (!row) return res.json({ apiKey: '' });
  res.json({ apiKey: cryptoHelper.decrypt(row.api_key_encrypted) });
});

/* Der gruene KI-Haken haengt am gespeicherten Prueferfolg (office_json ki_pruefstatus,
   Nutzerwunsch 30.08.2026). Ein NEUER Schluessel ist ungeprueft - das Flag faellt mit. */
function kiPruefstatusLoeschen(provider) {
  try {
    const row = db.prepare("SELECT data_json FROM office_json WHERE key = 'ki_pruefstatus'").get();
    if (!row) return;
    let obj = {}; try { obj = JSON.parse(row.data_json || '{}') || {}; } catch (_e) { obj = {}; }
    if (obj.anbieter && obj.anbieter[provider]) {
      delete obj.anbieter[provider];
      db.prepare("UPDATE office_json SET data_json = ? WHERE key = 'ki_pruefstatus'").run(JSON.stringify(obj));
    }
  } catch (_e) { /* Anzeige-Flag - darf das Speichern nie verhindern */ }
}

router.put('/ai-config/:provider', (req, res) => {
  const { provider } = req.params;
  if (!AI_PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Unbekannter Anbieter.' });
  const { apiKey, model, endpoint } = req.body || {};
  // Leeres apiKey-Feld bedeutet "unveraendert lassen", NICHT "Key loeschen" - das Admin-Formular
  // zeigt den bestehenden Key aus Sicherheitsgruenden nicht standardmaessig im Klartext an, ein
  // leeres Feld beim Speichern (z.B. weil nur das Modell geaendert wurde) darf ihn daher nicht
  // versehentlich ueberschreiben.
  const existing = getAiConfigStmt.get(provider);
  const apiKeyEncrypted = apiKey ? cryptoHelper.encrypt(apiKey) : (existing ? existing.api_key_encrypted : cryptoHelper.encrypt(''));
  /* model/endpoint nur ueberschreiben, wenn der Body sie NENNT - die KI-Maske schickt seit dem
     Zusammenlegen (30.08.2026) nur apiKey+endpoint; ein fehlendes model darf den Bestand nicht
     leeren. */
  upsertAiConfigStmt.run({
    provider,
    apiKeyEncrypted,
    model: model !== undefined ? (model || '') : (existing ? existing.model : ''),
    endpoint: endpoint !== undefined ? (endpoint || '') : (existing ? existing.endpoint : ''),
  });
  if (apiKey) kiPruefstatusLoeschen(provider);
  logAction(req, 'ai-config.update', 'ai-config', provider, { model: model || '', keyChanged: !!apiKey });
  res.json({ ok: true });
});

/* Buero-Schluessel ENTFERNEN (30.08.2026): der Anbieter faellt damit fuer alle auf "eigener
   Schluessel" zurueck. Vorher gab es keinen Loeschweg - leeres Feld hiess "unveraendert". */
router.delete('/ai-config/:provider', (req, res) => {
  const { provider } = req.params;
  if (!AI_PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Unbekannter Anbieter.' });
  db.prepare('DELETE FROM office_ai_config WHERE provider = ?').run(provider);
  kiPruefstatusLoeschen(provider);
  logAction(req, 'ai-config.delete', 'ai-config', provider, {});
  res.json({ ok: true });
});

const SEND_SERVICES = ['ebo', 'simplefax'];
const getSendCredentialsStmt = db.prepare('SELECT * FROM office_send_credentials WHERE service = ?');
const upsertSendCredentialsStmt = db.prepare(`
  INSERT INTO office_send_credentials (service, username, password_encrypted, login_url, inbox_url, compose_url)
  VALUES (@service, @username, @passwordEncrypted, @loginUrl, @inboxUrl, @composeUrl)
  ON CONFLICT(service) DO UPDATE SET username = excluded.username, password_encrypted = excluded.password_encrypted,
    login_url = excluded.login_url, inbox_url = excluded.inbox_url, compose_url = excluded.compose_url, updated_at = datetime('now')
`);

router.get('/send-credentials', (req, res) => {
  const rows = db.prepare('SELECT service, username, login_url, inbox_url, compose_url, updated_at FROM office_send_credentials').all();
  const byService = Object.fromEntries(rows.map((r) => [r.service, { ...r, hasPassword: true }]));
  res.json({ services: SEND_SERVICES.map((s) => ({ service: s, username: '', loginUrl: '', inboxUrl: '', composeUrl: '', hasPassword: false, ...(byService[s] || {}) })) });
});

router.get('/send-credentials/:service/reveal', (req, res) => {
  const row = getSendCredentialsStmt.get(req.params.service);
  if (!row) return res.json({ password: '' });
  res.json({ password: cryptoHelper.decrypt(row.password_encrypted) });
});

router.put('/send-credentials/:service', (req, res) => {
  const { service } = req.params;
  if (!SEND_SERVICES.includes(service)) return res.status(400).json({ error: 'Unbekannter Dienst.' });
  const { username, password, loginUrl, inboxUrl, composeUrl } = req.body || {};
  // Leeres password-Feld bedeutet "unveraendert lassen" - siehe gleiche Begruendung bei PUT
  // /ai-config/:provider oben.
  const existing = getSendCredentialsStmt.get(service);
  const passwordEncrypted = password ? cryptoHelper.encrypt(password) : (existing ? existing.password_encrypted : cryptoHelper.encrypt(''));
  upsertSendCredentialsStmt.run({
    service, username: username || '', passwordEncrypted,
    loginUrl: loginUrl || '', inboxUrl: inboxUrl || '', composeUrl: composeUrl || ''
  });
  logAction(req, 'send-credentials.update', 'send-credentials', service, { username: username || '', passwordChanged: !!password });
  res.json({ ok: true });
});

// Die SMTP-Konfigurationsrouten (/smtp-config*) leben seit der can_manage_mail_settings-Berechtigung
// NICHT mehr hier, sondern in einem eigenen Router (routes/mail-settings.js) mit eigener, permissiverer
// Middleware (requireMailSettings statt requireAdmin) - das blanket router.use(requireAdmin) oben
// wuerde sonst auch nicht-admin-aber-berechtigte Nutzer aussperren. Gleiche URL-Pfade unter /api/admin,
// damit bestehende Client-Fetch-Aufrufe unveraendert bleiben (siehe index.js Mount-Reihenfolge).

// ===== Lokal-Modus-Vorgaben (Plan Abschnitt AV) =====
// Admin-Vorgaben je Einstellungsbereich fuer den LOKAL-Modus - der Wert ist ein beliebiges,
// bereichsspezifisches JSON (dieselbe Struktur, die der jeweilige Client-Dialog spricht), als
// Ganzes verschluesselt gespeichert (kann Keys/Passwoerter enthalten). Auslieferung an lokale
// Clients beim Login, siehe decryptedLocalDefaults() in routes/auth.js. Nur Admins (das Gate oben
// laesst diese Pfade fuer Nicht-Admins nicht durch).
const LOCAL_DEFAULT_AREAS = ['ai', 'send', 'maps', 'office', 'mail'];
const getLocalDefaultStmt = db.prepare('SELECT * FROM local_mode_defaults WHERE area = ?');
const upsertLocalDefaultStmt = db.prepare(`
  INSERT INTO local_mode_defaults (area, value_encrypted, updated_at, updated_by)
  VALUES (@area, @valueEncrypted, datetime('now'), @updatedBy)
  ON CONFLICT(area) DO UPDATE SET value_encrypted = excluded.value_encrypted,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by
`);

router.get('/local-defaults', (req, res) => {
  const out = {};
  for (const area of LOCAL_DEFAULT_AREAS) {
    const row = getLocalDefaultStmt.get(area);
    if (row && row.value_encrypted) {
      try { out[area] = { value: JSON.parse(cryptoHelper.decrypt(row.value_encrypted)), updatedAt: row.updated_at }; }
      catch (_e) { out[area] = { value: null, updatedAt: row.updated_at, corrupt: true }; }
    } else {
      out[area] = { value: null, updatedAt: null };
    }
  }
  res.json({ defaults: out });
});

router.put('/local-defaults/:area', (req, res) => {
  const { area } = req.params;
  if (!LOCAL_DEFAULT_AREAS.includes(area)) return res.status(400).json({ error: 'Unbekannter Einstellungsbereich.' });
  const { value } = req.body || {};
  // value === null loescht die Vorgabe (zurueck zu "keine Vorgabe -> Nutzer pflegen selbst").
  const valueEncrypted = value == null ? '' : cryptoHelper.encrypt(JSON.stringify(value));
  upsertLocalDefaultStmt.run({ area, valueEncrypted, updatedBy: req.session.userId });
  logAction(req, 'local-defaults.update', 'local-defaults', area, { cleared: value == null });
  res.json({ ok: true });
});

// Phase 7 (Kalender + Aufgaben) / Plan Abschnitt AE: mehrere gleichzeitig aktive Kalender-
// verbindungen ueber verschiedene Anbieter hinweg (Nutzerentscheidung "Apple, Google, Microsoft"
// zusaetzlich zu Nextcloud, alle gleichzeitig moeglich statt nur eine). Nextcloud/iCloud sprechen
// Standard-CalDAV (App-Passwort, siehe caldav.js) - Google/Microsoft verlangen zwingend OAuth 2.0
// mit einem vom Admin selbst registrierten Cloud-Projekt (siehe google-calendar.js/
// microsoft-calendar.js), da beide Basic-Auth mit App-Passwort fuer den Kalenderzugriff nicht mehr
// anbieten.
const oauthProviders = { google: googleCal, microsoft: microsoftCal };
// Provider-Familien kommen jetzt aus der Dispatch-Schicht (PLAN-AUFGABEN-SYNC): 'vikunja' laeuft
// als CalDAV-Anbieter, 'openproject'/'vikunja-api' als reine Aufgaben-Anbieter mit eigener API.
const calendarSyncDispatch = require('../calendar/sync');
const isCaldavProvider = calendarSyncDispatch.isCaldavProvider;
const isOauthProvider = calendarSyncDispatch.isOauthProvider;
const isTaskApiProvider = calendarSyncDispatch.isTaskApiProvider;
const taskApiAdapter = calendarSyncDispatch.taskApiAdapter;
const syncJournal = require('../sync/journal');

function publicBaseUrl() {
  // Muss beim Registrieren der OAuth-App bei Google/Microsoft exakt als Redirect-URI hinterlegt
  // werden - da der Server hier noch keine feste, oeffentlich erreichbare Domain kennt (Nutzer hat
  // sich bewusst fuer einen Platzhalter entschieden, bis der Cloudflare-Tunnel/die Produktions-
  // domain steht), ist das ueber eine Umgebungsvariable konfigurierbar statt hartkodiert.
  return (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8935}`).replace(/\/$/, '');
}
function oauthRedirectUri(provider) {
  return `${publicBaseUrl()}/api/admin/calendar-connections/oauth/callback/${provider}`;
}

const listConnectionsStmt = db.prepare('SELECT * FROM calendar_connections ORDER BY created_at');
const getConnectionStmt = db.prepare('SELECT * FROM calendar_connections WHERE id = ?');
const insertConnectionStmt = db.prepare(`
  INSERT INTO calendar_connections (id, provider, display_name, username, password_encrypted, calendar_url, todo_url, client_id, client_secret_encrypted, owner_user_id, visibility)
  VALUES (@id, @provider, @displayName, @username, @passwordEncrypted, @calendarUrl, @todoUrl, @clientId, @clientSecretEncrypted, @ownerUserId, @visibility)
`);
const deleteConnectionStmt = db.prepare('DELETE FROM calendar_connections WHERE id = ?');

// Multi-User-Kalender (Nutzerwunsch): owner_user_id NULL = Büro-Verbindung (nur Admin verwaltet),
// gesetzt = persönliche Verbindung des Nutzers. visibility 'public' = büroweit sichtbar, 'private' =
// nur der Eigentümer. Verwalten darf: Büro-Verbindung -> nur Admin; persönliche -> nur der Eigentümer.
function canManageConnection(req, row) {
  if (!row) return false;
  if (row.owner_user_id == null) return !!req.session.isAdmin;
  return row.owner_user_id === req.session.userId;
}
// Sichtbar/auflistbar für den Nutzer: alle Büro-Verbindungen + die eigenen persönlichen.
function visibleToUser(req, row) {
  return row.owner_user_id == null || row.owner_user_id === req.session.userId;
}

function publicConnection(row) {
  return {
    id: row.id, provider: row.provider, displayName: row.display_name || row.provider,
    enabled: !!row.enabled, accountLabel: row.account_label || '',
    // CalDAV-Felder
    username: row.username || '', calendarUrl: row.calendar_url || '', todoUrl: row.todo_url || '',
    hasPassword: !!row.password_encrypted,
    // OAuth-Felder
    hasClientCredentials: !!(row.client_id && row.client_secret_encrypted),
    authorized: !!row.refresh_token_encrypted,
    calendarId: row.calendar_id || '', taskListId: row.task_list_id || '',
    // Multi-User: Zugehörigkeit + Sichtbarkeit
    scope: row.owner_user_id == null ? 'office' : 'personal',
    ownerUserId: row.owner_user_id == null ? null : row.owner_user_id,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    // Mehrere Kalender/Aufgabenlisten je Konto (Nutzerwunsch): die entdeckten + ausgewaehlten Listen.
    calendars: listConnCalendars(row.id).filter((c) => c.kind !== 'contact'),
    // Online-Kontakte-Sync (Nutzerwunsch): Modus + entdeckte/ausgewaehlte Adressbuecher der Verbindung.
    contactsSyncMode: row.contacts_sync_mode || 'off',
    addressbooks: listConnCalendars(row.id).filter((c) => c.kind === 'contact'),
    // Aufgaben-Sync-Ausbau (PLAN-AUFGABEN-SYNC): Fristen-Export, OpenProject-Status-Zuordnung,
    // iCal-Abo und Webhook-Kennung. Das Webhook-Geheimnis selbst liefert nur der Anlage-Endpunkt.
    deadlineExport: Number(row.deadline_export) === 1,
    taskStatusOpen: row.task_status_open || '',
    taskStatusDone: row.task_status_done || '',
    icalUrl: row.ical_url || '',
    hasWebhookSecret: !!row.webhook_secret,
    updatedAt: row.updated_at
  };
}

// Fallback-Farbpalette fuer Kalender ohne Anbieter-Farbe (deckungsgleich mit CAL_EVENT_COLORS im
// Client). Zuweisung rundlaeufig nach Position, damit mehrere Listen optisch unterscheidbar sind.
const CALENDAR_PALETTE = ['#2f6fb0', '#1f7a3d', '#8a1f1f', '#b5711f', '#5a3fa0', '#158a86', '#a01f6a', '#4a5a66'];
const listConnCalStmt = db.prepare('SELECT id, kind, remote_id, name, color, selected, position FROM connection_calendars WHERE connection_id = ? ORDER BY kind, position, name');
function listConnCalendars(connId) {
  return listConnCalStmt.all(connId).map((c) => ({
    id: c.id, kind: c.kind, remoteId: c.remote_id, name: c.name || '', color: c.color || '', selected: !!c.selected, position: c.position
  }));
}
// Entdeckte Kalender/Listen in connection_calendars uebernehmen (Upsert): neue anlegen, Namen/Farbe
// aktualisieren, den selected-Zustand UND eine bereits zugewiesene Farbe erhalten. Fehlt die
// Anbieterfarbe, wird eine Palettenfarbe vergeben. items: [{remoteId, name, color}].
const ccFindStmt = db.prepare('SELECT id, color FROM connection_calendars WHERE connection_id = ? AND kind = ? AND remote_id = ?');
const ccInsertStmt = db.prepare("INSERT INTO connection_calendars (id, connection_id, kind, remote_id, name, color, selected, position) VALUES (@id, @connId, @kind, @remoteId, @name, @color, 0, @position)");
const ccUpdateStmt = db.prepare("UPDATE connection_calendars SET name=@name, color=@color, updated_at=datetime('now') WHERE id=@id");
const ccCountStmt = db.prepare('SELECT COUNT(*) n FROM connection_calendars WHERE connection_id = ? AND kind = ?');
function upsertDiscovered(connId, kind, items) {
  let idx = ccCountStmt.get(connId, kind).n;
  const tx = db.transaction(() => {
    for (const it of items || []) {
      // remoteId '' ist GÜLTIG: Microsofts Standard-Kontaktordner wird bewusst mit leerem Ref
      // angeboten (Graph kennt ihn nur als /me/contacts, nicht unter /me/contactFolders; das
      // Schema sieht remote_id DEFAULT '' vor). Der frühere !it.remoteId-Filter verwarf genau
      // diesen Eintrag - bei einem Konto ohne zusätzliche Kontaktordner blieb die Adressbuch-
      // Liste dadurch IMMER leer ("Keine Adressbücher gefunden", gemeldeter Bug).
      if (!it || it.remoteId == null) continue;
      const existing = ccFindStmt.get(connId, kind, it.remoteId);
      const color = it.color || (existing && existing.color) || CALENDAR_PALETTE[idx % CALENDAR_PALETTE.length];
      if (existing) {
        ccUpdateStmt.run({ id: existing.id, name: it.name || '', color });
      } else {
        ccInsertStmt.run({ id: crypto.randomUUID(), connId, kind, remoteId: it.remoteId, name: it.name || '', color, position: idx });
        idx += 1;
      }
    }
  });
  tx();
}
// Angehakte Kalender speichern (selected=1 fuer die uebergebenen connection_calendars-IDs, sonst 0)
// und die Legacy-Einzelfelder der Verbindung auf die jeweils erste Auswahl je Art spiegeln (haelt
// Provider-Fetch/Push-Fallback + publicConnection.calendarId konsistent).
function setSelectedCalendars(conn, selectedIds) {
  const sel = new Set(selectedIds || []);
  const all = db.prepare('SELECT id FROM connection_calendars WHERE connection_id = ?').all(conn.id);
  const upd = db.prepare("UPDATE connection_calendars SET selected=?, updated_at=datetime('now') WHERE id=?");
  db.transaction(() => { for (const r of all) upd.run(sel.has(r.id) ? 1 : 0, r.id); })();
  const firstOf = (kind) => db.prepare("SELECT remote_id FROM connection_calendars WHERE connection_id=? AND kind=? AND selected=1 ORDER BY position, name LIMIT 1").get(conn.id, kind);
  const ev = firstOf('event')?.remote_id || '';
  const tk = firstOf('task')?.remote_id || '';
  if (isCaldavProvider(conn.provider)) {
    db.prepare("UPDATE calendar_connections SET calendar_url=?, todo_url=?, updated_at=datetime('now') WHERE id=?").run(ev, tk, conn.id);
  } else {
    db.prepare("UPDATE calendar_connections SET calendar_id=?, task_list_id=?, updated_at=datetime('now') WHERE id=?").run(ev, tk, conn.id);
  }
}

router.get('/calendar-connections', (req, res) => {
  const rows = listConnectionsStmt.all().filter((r) => visibleToUser(req, r));
  res.json({ connections: rows.map((r) => ({ ...publicConnection(r), canManage: canManageConnection(req, r) })) });
});

router.post('/calendar-connections', (req, res) => {
  const { provider, displayName, username, password, calendarUrl, todoUrl, clientId, clientSecret, scope, visibility } = req.body || {};
  if (!['nextcloud', 'icloud', 'google', 'microsoft', 'vikunja', 'openproject', 'vikunja-api'].includes(provider)) {
    return res.status(400).json({ error: 'Unbekannter Kalenderanbieter.' });
  }
  // Multi-User: nur Admins dürfen BÜRO-Verbindungen (scope=office, owner NULL) anlegen; alle anderen
  // legen ausschließlich PERSÖNLICHE an (owner = sie selbst). Default-Sichtbarkeit: office=public, personal=private.
  const wantsOffice = req.session.isAdmin && scope !== 'personal';
  const ownerUserId = wantsOffice ? null : req.session.userId;
  const vis = (visibility === 'private' || visibility === 'public') ? visibility : (wantsOffice ? 'public' : 'private');
  const id = crypto.randomUUID();
  if (isCaldavProvider(provider)) {
    if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich.' });
    const caldavName = provider === 'nextcloud' ? 'Nextcloud' : provider === 'vikunja' ? 'Vikunja (CalDAV)' : 'iCloud';
    insertConnectionStmt.run({
      id, provider, displayName: displayName || caldavName,
      username: username.trim(), passwordEncrypted: cryptoHelper.encrypt(password),
      calendarUrl: (calendarUrl || '').trim(), todoUrl: (todoUrl || '').trim(), clientId: '', clientSecretEncrypted: '',
      ownerUserId, visibility: vis
    });
  } else if (isTaskApiProvider(provider)) {
    // Reine Aufgaben-Anbieter (Etappen 2/3): Basis-URL + API-Token genuegen. Die Basis-URL liegt
    // im calendar_url-Feld (dieselbe Spalte, die bei CalDAV die Kalender-URL traegt).
    if (!password || !calendarUrl) return res.status(400).json({ error: 'Basis-URL und API-Token erforderlich.' });
    insertConnectionStmt.run({
      id, provider, displayName: displayName || (provider === 'openproject' ? 'OpenProject' : 'Vikunja'),
      username: '', passwordEncrypted: cryptoHelper.encrypt(password),
      calendarUrl: calendarUrl.trim().replace(/\/+$/, ''), todoUrl: '', clientId: '', clientSecretEncrypted: '',
      ownerUserId, visibility: vis
    });
  } else {
    if (!clientId || !clientSecret) return res.status(400).json({ error: 'Client-ID und Client-Secret erforderlich (aus der Google-Cloud-Console bzw. dem Azure-Portal).' });
    insertConnectionStmt.run({
      id, provider, displayName: displayName || (provider === 'google' ? 'Google Kalender' : 'Outlook-Kalender'),
      username: '', passwordEncrypted: '', calendarUrl: '', todoUrl: '',
      clientId: clientId.trim(), clientSecretEncrypted: cryptoHelper.encrypt(clientSecret),
      ownerUserId, visibility: vis
    });
  }
  logAction(req, 'calendar-connection.create', 'calendar-connection', id, { provider, scope: ownerUserId == null ? 'office' : 'personal', visibility: vis });
  const row = getConnectionStmt.get(id);
  const payload = { connection: publicConnection(row) };
  if (isOauthProvider(provider)) payload.authUrl = oauthProviders[provider].getAuthUrl(row, oauthRedirectUri(provider), id);
  res.status(201).json(payload);
});

router.put('/calendar-connections/:id', (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  const { displayName, enabled, username, password, calendarUrl, todoUrl, clientId, clientSecret, visibility, deadlineExport, icalUrl, taskStatusOpen, taskStatusDone } = req.body || {};
  const passwordEncrypted = password ? cryptoHelper.encrypt(password) : row.password_encrypted;
  const clientSecretEncrypted = clientSecret ? cryptoHelper.encrypt(clientSecret) : row.client_secret_encrypted;
  const vis = (visibility === 'private' || visibility === 'public') ? visibility : (row.visibility === 'private' ? 'private' : 'public');
  db.prepare(`
    UPDATE calendar_connections SET display_name=@displayName, enabled=@enabled, username=@username,
      password_encrypted=@passwordEncrypted, calendar_url=@calendarUrl, todo_url=@todoUrl,
      client_id=@clientId, client_secret_encrypted=@clientSecretEncrypted, visibility=@visibility,
      deadline_export=@deadlineExport, ical_url=@icalUrl, task_status_open=@taskStatusOpen, task_status_done=@taskStatusDone,
      updated_at=datetime('now')
    WHERE id=@id
  `).run({
    id: row.id, displayName: displayName != null ? displayName : row.display_name, enabled: enabled != null ? (enabled ? 1 : 0) : row.enabled,
    username: username != null ? username.trim() : row.username, passwordEncrypted,
    calendarUrl: calendarUrl != null ? calendarUrl.trim() : row.calendar_url, todoUrl: todoUrl != null ? todoUrl.trim() : row.todo_url,
    clientId: clientId != null ? clientId.trim() : row.client_id, clientSecretEncrypted, visibility: vis,
    // Fristen-Export/Status-Zuordnung/iCal-Abo (PLAN-AUFGABEN-SYNC) - fehlende Felder lassen den Bestand stehen.
    deadlineExport: deadlineExport != null ? (deadlineExport ? 1 : 0) : row.deadline_export,
    icalUrl: icalUrl != null ? String(icalUrl).trim() : row.ical_url,
    taskStatusOpen: taskStatusOpen != null ? String(taskStatusOpen).trim() : row.task_status_open,
    taskStatusDone: taskStatusDone != null ? String(taskStatusDone).trim() : row.task_status_done
  });
  // Sichtbarkeitswechsel auf die bereits synchronisierten Termine/Aufgaben dieser Verbindung nachziehen
  // (sonst blieben alte Einträge auf der alten Sichtbarkeit stehen).
  if (vis !== row.visibility) {
    db.prepare('UPDATE calendar_events SET visibility=? WHERE connection_id=?').run(vis, row.id);
    db.prepare('UPDATE todos SET visibility=? WHERE connection_id=?').run(vis, row.id);
  }
  logAction(req, 'calendar-connection.update', 'calendar-connection', row.id, { visibility: vis });
  res.json({ connection: publicConnection(getConnectionStmt.get(row.id)) });
});

router.delete('/calendar-connections/:id', (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE calendar_events SET connection_id = NULL WHERE connection_id = ?').run(row.id);
    db.prepare('UPDATE todos SET connection_id = NULL WHERE connection_id = ?').run(row.id);
    deleteConnectionStmt.run(row.id);
  });
  tx();
  logAction(req, 'calendar-connection.delete', 'calendar-connection', row.id, { provider: row.provider });
  res.json({ ok: true });
});

router.get('/calendar-connections/:id/oauth/start', (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row || !isOauthProvider(row.provider)) return res.status(400).json({ error: 'Diese Verbindung unterstützt keine OAuth-Autorisierung.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  if (!row.client_id || !row.client_secret_encrypted) return res.status(400).json({ error: 'Bitte zuerst Client-ID und Client-Secret hinterlegen.' });
  res.redirect(oauthProviders[row.provider].getAuthUrl(row, oauthRedirectUri(row.provider), row.id));
});

// Kein requireAdmin-Sonderfall noetig: der Redirect von Google/Microsoft laeuft im selben
// Browser-Tab des bereits angemeldeten Admins zurueck (Top-Level-Navigation, das Session-Cookie
// wird dabei mitgesendet), daher greift die router.use(requireAdmin) oben ganz normal.
router.get('/calendar-connections/oauth/callback/:provider', async (req, res) => {
  const provider = req.params.provider;
  const { code, state, error } = req.query || {};
  const redirectBack = (query) => res.redirect(`/?${new URLSearchParams(query)}`);
  if (error) return redirectBack({ calendarOauthError: String(error) });
  const row = state && getConnectionStmt.get(String(state));
  if (!row || !isOauthProvider(provider) || !oauthProviders[provider]) return redirectBack({ calendarOauthError: 'invalid_state' });
  if (!canManageConnection(req, row)) return redirectBack({ calendarOauthError: 'forbidden' });
  try {
    const tokens = await oauthProviders[provider].exchangeCode(row, code, oauthRedirectUri(provider));
    const expiresAt = new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000).toISOString();
    db.prepare(`
      UPDATE calendar_connections SET access_token_encrypted=@accessToken, refresh_token_encrypted=@refreshToken, token_expires_at=@expiresAt, updated_at=datetime('now')
      WHERE id=@id
    `).run({
      id: row.id, accessToken: cryptoHelper.encrypt(tokens.access_token || ''),
      refreshToken: tokens.refresh_token ? cryptoHelper.encrypt(tokens.refresh_token) : row.refresh_token_encrypted,
      expiresAt
    });
    logAction(req, 'calendar-connection.authorized', 'calendar-connection', row.id, { provider });
    redirectBack({ calendarConnected: row.id });
  } catch (err) {
    console.error('[calendar-oauth-callback]', provider, 'Token-Tausch fehlgeschlagen:', err.message);
    redirectBack({ calendarOauthError: err.message || 'Autorisierung fehlgeschlagen.' });
  }
});

function withTokenPersistence(connectionId) {
  return async (refreshed) => {
    db.prepare(`
      UPDATE calendar_connections SET access_token_encrypted=?, token_expires_at=?, updated_at=datetime('now') WHERE id=?
    `).run(cryptoHelper.encrypt(refreshed.access_token || ''), new Date(Date.now() + (Number(refreshed.expires_in) || 3600) * 1000).toISOString(), connectionId);
  };
}

router.get('/calendar-connections/:id/available-calendars', async (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  try {
    let calendars = [];
    let taskLists = [];
    if (isCaldavProvider(row.provider)) {
      const disc = await caldav.discoverCollections(row); // {calendars:[{remoteId,name,color}], taskLists:[...]}
      calendars = disc.calendars;
      taskLists = disc.taskLists;
    } else if (isTaskApiProvider(row.provider)) {
      // Reine Aufgaben-Anbieter: Projekte sind die Aufgabenlisten; Terminkalender gibt es nicht
      // (OpenProject-Termine kommen - falls gewuenscht - nur lesend ueber das iCal-Abo).
      taskLists = await taskApiAdapter(row.provider).listTaskLists(row);
    } else if (isOauthProvider(row.provider)) {
      if (!row.refresh_token_encrypted) return res.status(400).json({ error: 'Diese Verbindung ist noch nicht autorisiert. Bitte zuerst "Verbinden".' });
      const adapter = oauthProviders[row.provider];
      const onRefresh = withTokenPersistence(row.id);
      const [cals, tasks] = await Promise.all([adapter.listCalendars(row, onRefresh), adapter.listTaskLists(row, onRefresh)]);
      calendars = (cals || []).map((c) => ({ remoteId: c.id, name: c.name, color: c.color || '' }));
      taskLists = (tasks || []).map((t) => ({ remoteId: t.id, name: t.name, color: t.color || '' }));
    } else {
      return res.status(400).json({ error: 'Kalender-Auswahl für diesen Anbieter nicht verfügbar.' });
    }
    // Entdeckte Listen persistieren (selected-Zustand bleibt erhalten), dann MIT Auswahlzustand + Farbe zurueckgeben.
    upsertDiscovered(row.id, 'event', calendars);
    upsertDiscovered(row.id, 'task', taskLists);
    const stored = listConnCalendars(row.id);
    res.json({ calendars: stored.filter((c) => c.kind === 'event'), taskLists: stored.filter((c) => c.kind === 'task') });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Kalender/Aufgabenlisten konnten nicht geladen werden.' });
  }
});

// Mehrere Kalender/Aufgabenlisten gleichzeitig an-/abhaken (Nutzerwunsch). body.selectedIds =
// Array der connection_calendars-IDs, die aktiv sein sollen.
router.put('/calendar-connections/:id/calendars', (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  const selectedIds = Array.isArray(req.body?.selectedIds) ? req.body.selectedIds : [];
  setSelectedCalendars(row, selectedIds);
  // Individuelle Kalenderfarben (Nutzerwunsch) - nur gültige #RRGGBB, nur Zeilen dieser Verbindung.
  const colors = (req.body && typeof req.body.colors === 'object' && req.body.colors) ? req.body.colors : {};
  const updColor = db.prepare("UPDATE connection_calendars SET color=?, updated_at=datetime('now') WHERE id=? AND connection_id=?");
  for (const ccId of Object.keys(colors)) {
    const hex = String(colors[ccId] || '');
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) updColor.run(hex.toLowerCase(), ccId, row.id);
  }
  res.json({ connection: publicConnection(getConnectionStmt.get(row.id)) });
});

// Rueckwaertskompatibel: die alte Einzel-Auswahl (calendarId/taskListId) setzt genau diese eine
// Liste je Art als angehakt (legt sie bei Bedarf als connection_calendars-Zeile an).
router.put('/calendar-connections/:id/select', (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  const { calendarId, taskListId } = req.body || {};
  if (calendarId) upsertDiscovered(row.id, 'event', [{ remoteId: calendarId, name: '', color: '' }]);
  if (taskListId) upsertDiscovered(row.id, 'task', [{ remoteId: taskListId, name: '', color: '' }]);
  const ids = [];
  if (calendarId) { const r = ccFindStmt.get(row.id, 'event', calendarId); if (r) ids.push(r.id); }
  if (taskListId) { const r = ccFindStmt.get(row.id, 'task', taskListId); if (r) ids.push(r.id); }
  setSelectedCalendars(row, ids);
  res.json({ connection: publicConnection(getConnectionStmt.get(row.id)) });
});

router.post('/calendar-connections/:id/test', async (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  try {
    if (isTaskApiProvider(row.provider)) {
      const result = await taskApiAdapter(row.provider).testConnection(row);
      if (!result.ok) return res.status(400).json({ error: result.error || 'Verbindung fehlgeschlagen.' });
      return res.json({ ok: true, displayName: result.displayName || '' });
    }
    if (isCaldavProvider(row.provider)) {
      const { which } = req.body || {};
      const result = await caldav.testConnection(row, which === 'todo' ? 'todo' : 'calendar');
      if (!result.ok) return res.status(400).json({ error: result.error || 'Verbindung fehlgeschlagen.' });
      return res.json({ ok: true, displayName: result.displayName || '' });
    }
    if (!row.refresh_token_encrypted) return res.status(400).json({ error: 'Diese Verbindung ist noch nicht autorisiert. Bitte zuerst über "Verbinden" den Anmeldevorgang abschließen.' });
    await oauthProviders[row.provider].listCalendars(row, withTokenPersistence(row.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Verbindung fehlgeschlagen.' });
  }
});

// ===== Aufgaben-Sync-Ausbau (PLAN-AUFGABEN-SYNC, Etappen 2/3/4) =====

// OpenProject-Statusliste zur Zuordnung "offen"/"erledigt" (Workflows sind je Instanz anders).
router.get('/calendar-connections/:id/task-statuses', async (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  if (row.provider !== 'openproject') return res.status(400).json({ error: 'Statuszuordnung gibt es nur für OpenProject.' });
  try {
    const statuses = await taskApiAdapter('openproject').listStatuses(row);
    res.json({ statuses, taskStatusOpen: row.task_status_open || '', taskStatusDone: row.task_status_done || '' });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Statusliste konnte nicht geladen werden.' });
  }
});

// Projekt je Fall (Nutzerentscheidung 02.08.2026): Zuordnung ansehen ...
const listCasesStmt = db.prepare('SELECT id, label FROM cases ORDER BY label COLLATE NOCASE');
const listCaseProjectsStmt = db.prepare('SELECT * FROM connection_case_projects WHERE connection_id = ?');
const upsertCaseProjectStmt = db.prepare(`
  INSERT INTO connection_case_projects (id, connection_id, case_id, remote_project_id, remote_project_name)
  VALUES (@id, @connectionId, @caseId, @remoteProjectId, @remoteProjectName)
  ON CONFLICT(connection_id, case_id)
  DO UPDATE SET remote_project_id=excluded.remote_project_id, remote_project_name=excluded.remote_project_name
`);
const deleteCaseProjectStmt = db.prepare('DELETE FROM connection_case_projects WHERE connection_id = ? AND case_id = ?');

router.get('/calendar-connections/:id/case-projects', (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  if (!isTaskApiProvider(row.provider)) return res.status(400).json({ error: 'Fall-Projekte gibt es nur für Vikunja-/OpenProject-Verbindungen.' });
  const mapping = new Map(listCaseProjectsStmt.all(row.id).map((m) => [m.case_id, m]));
  res.json({
    cases: listCasesStmt.all().map((c) => ({
      caseId: c.id, caseLabel: c.label,
      remoteProjectId: mapping.get(c.id)?.remote_project_id || '',
      remoteProjectName: mapping.get(c.id)?.remote_project_name || ''
    })),
    projects: listConnCalendars(row.id).filter((c) => c.kind === 'task')
  });
});

// ... von Hand setzen/loesen ...
router.put('/calendar-connections/:id/case-projects', (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  const { caseId, remoteProjectId, remoteProjectName } = req.body || {};
  if (!caseId) return res.status(400).json({ error: 'Fall-ID erforderlich.' });
  if (remoteProjectId) {
    upsertCaseProjectStmt.run({
      id: crypto.randomUUID(), connectionId: row.id, caseId: String(caseId),
      remoteProjectId: String(remoteProjectId), remoteProjectName: String(remoteProjectName || '')
    });
  } else {
    deleteCaseProjectStmt.run(row.id, String(caseId));
  }
  logAction(req, 'calendar-connection.case-project', 'calendar-connection', row.id, { caseId: String(caseId), remoteProjectId: String(remoteProjectId || '') });
  res.json({ ok: true });
});

// ... oder fehlende Projekte gesammelt anlegen ("Projekt je Fall" auf Knopfdruck). Die neuen
// Projekte werden gleich als Aufgabenlisten uebernommen und angehakt, damit der Abgleich sie zieht.
router.post('/calendar-connections/:id/case-projects/auto', async (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  if (!isTaskApiProvider(row.provider)) return res.status(400).json({ error: 'Fall-Projekte gibt es nur für Vikunja-/OpenProject-Verbindungen.' });
  const adapter = taskApiAdapter(row.provider);
  const mapped = new Set(listCaseProjectsStmt.all(row.id).map((m) => m.case_id));
  const created = [];
  const errors = [];
  for (const c of listCasesStmt.all()) {
    if (mapped.has(c.id)) continue;
    try {
      const project = await adapter.createProject(row, c.label || 'Fall');
      upsertCaseProjectStmt.run({
        id: crypto.randomUUID(), connectionId: row.id, caseId: c.id,
        remoteProjectId: project.remoteId, remoteProjectName: project.name
      });
      upsertDiscovered(row.id, 'task', [{ remoteId: project.remoteId, name: project.name, color: '' }]);
      const cc = ccFindStmt.get(row.id, 'task', project.remoteId);
      if (cc) db.prepare("UPDATE connection_calendars SET selected=1, updated_at=datetime('now') WHERE id=?").run(cc.id);
      created.push({ caseLabel: c.label, projectName: project.name });
      syncJournal.write({
        connectionId: row.id, direction: 'push', action: 'projekt-angelegt', localType: 'case',
        localId: c.id, remoteId: project.remoteId, detail: `Projekt „${project.name}" für Fall „${c.label}" angelegt.`
      });
    } catch (error) {
      errors.push(`${c.label}: ${error.message}`);
    }
  }
  logAction(req, 'calendar-connection.case-projects-auto', 'calendar-connection', row.id, { created: created.length, errors: errors.length });
  res.json({ created, errors });
});

// Webhook-Geheimnis (Etappe 3): anlegen/erneuern. Der Klartext erscheint nur in dieser Antwort;
// eingerichtet wird er im Zielsystem (Vikunja: Projekt -> Webhooks, Ziel-URL + Secret).
router.post('/calendar-connections/:id/webhook-secret', (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  const secret = crypto.randomBytes(24).toString('base64url');
  db.prepare("UPDATE calendar_connections SET webhook_secret=?, updated_at=datetime('now') WHERE id=?").run(secret, row.id);
  logAction(req, 'calendar-connection.webhook-secret', 'calendar-connection', row.id, {});
  res.json({ secret, hookUrl: `${publicBaseUrl()}/api/sync-hooks/vikunja/${row.id}` });
});

// Sync-Journal (Plan C.5): die letzten Entscheidungen des Abgleichs, lesbar im Admin-Panel.
router.get('/sync-journal', (req, res) => {
  res.json({ entries: syncJournal.list(req.query.limit) });
});

// ===== Aufgaben-Feed-Tokens (Etappe 4) - admin-only (Gate oben) =====
const listFeedTokensStmt = db.prepare('SELECT id, label, created_at, last_used_at, revoked FROM feed_tokens ORDER BY created_at DESC');
router.get('/feed-tokens', (req, res) => {
  res.json({ tokens: listFeedTokensStmt.all().map((t) => ({ id: t.id, label: t.label, createdAt: t.created_at, lastUsedAt: t.last_used_at || '', revoked: !!t.revoked })) });
});
router.post('/feed-tokens', (req, res) => {
  const label = String((req.body || {}).label || '').slice(0, 120);
  const token = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO feed_tokens (id, label, token_hash, created_by) VALUES (?, ?, ?, ?)')
    .run(id, label, crypto.createHash('sha256').update(token, 'utf8').digest('hex'), req.session.userId);
  logAction(req, 'feed-token.create', 'feed-token', id, { label });
  // Klartext nur in dieser Antwort - danach existiert serverseitig ausschliesslich der Hash.
  res.status(201).json({ id, label, token, feedUrl: `${publicBaseUrl()}/dav-feed/${token}/` });
});
router.post('/feed-tokens/:id/revoke', (req, res) => {
  const result = db.prepare('UPDATE feed_tokens SET revoked=1 WHERE id=?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Token nicht gefunden.' });
  logAction(req, 'feed-token.revoke', 'feed-token', req.params.id, {});
  res.json({ ok: true });
});

// ===== Online-Kontakte-Sync je Verbindung (Nutzerwunsch) =====
// Entdeckte Adressbücher der Verbindung ermitteln + als connection_calendars kind='contact' ablegen.
router.get('/calendar-connections/:id/available-addressbooks', async (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  try {
    if (isOauthProvider(row.provider) && !row.refresh_token_encrypted) return res.status(400).json({ error: 'Diese Verbindung ist noch nicht autorisiert. Bitte zuerst "Verbinden".' });
    const books = await contactsSync.discoverAddressbooks(row); // [{remoteId,name,color}]
    upsertDiscovered(row.id, 'contact', books);
    res.json({ addressbooks: listConnCalendars(row.id).filter((c) => c.kind === 'contact') });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Adressbücher konnten nicht geladen werden.' });
  }
});

// Ausgewählte Adressbücher an-/abhaken + Sync-Modus setzen. body.selectedIds = connection_calendars-IDs
// (kind='contact'), body.contactsSyncMode = 'off'|'manual'|'auto'.
router.put('/calendar-connections/:id/addressbooks', (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  const sel = new Set(Array.isArray(req.body?.selectedIds) ? req.body.selectedIds : []);
  // Nur die Kontakt-Zeilen dieser Verbindung umschalten (Kalender/Aufgaben unangetastet lassen).
  const rows = db.prepare("SELECT id FROM connection_calendars WHERE connection_id = ? AND kind = 'contact'").all(row.id);
  const upd = db.prepare("UPDATE connection_calendars SET selected=?, updated_at=datetime('now') WHERE id=?");
  db.transaction(() => { for (const r of rows) upd.run(sel.has(r.id) ? 1 : 0, r.id); })();
  const mode = ['off', 'manual', 'auto'].includes(req.body?.contactsSyncMode) ? req.body.contactsSyncMode : row.contacts_sync_mode || 'off';
  db.prepare("UPDATE calendar_connections SET contacts_sync_mode=?, updated_at=datetime('now') WHERE id=?").run(mode, row.id);
  res.json({ connection: publicConnection(getConnectionStmt.get(row.id)) });
});

// Kontakte dieser Verbindung jetzt manuell abgleichen (in die Import-Ablage).
router.post('/calendar-connections/:id/sync-contacts', async (req, res) => {
  const row = getConnectionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Verbindung nicht gefunden.' });
  if (!canManageConnection(req, row)) return res.status(403).json({ error: 'Keine Berechtigung für diese Verbindung.' });
  try {
    // Nur DIESE Verbindung abgleichen (auch wenn contacts_sync_mode='off' – Knopfdruck erzwingt es).
    // body.addressbookRef (optional, '' ist gültig = MS-Standardordner): nur DIESE Quell-Liste –
    // der „Kontakte importieren"-Knopf mit Quell-Auswahl. Ohne Angabe: alle angehakten Listen.
    const onlyRef = (req.body && req.body.addressbookRef !== undefined && req.body.addressbookRef !== null) ? String(req.body.addressbookRef) : undefined;
    const r = await contactsSync.syncConnectionContacts(row, onlyRef);
    res.json({ ok: true, added: r.added, errors: r.errors });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Kontakte konnten nicht synchronisiert werden.' });
  }
});

router.get('/audit-log', (req, res) => {
  // ?limit= fuer den CSV-Export der Admin-UI (Standardansicht bleibt bei 200, Deckel 10000).
  // Verarbeitungs-Log (25.08.2026): dazu Filter nach Zeitraum, Nutzer, Kategorie und Fall - ohne
  // sie ist die Liste bei taeglich wachsendem Bestand nicht mehr auswertbar (Art. 30 DSGVO).
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 10000);
  const wo = [];
  const werte = [];
  const text = (v) => String(v || '').trim();
  /* created_at steht in UTC (datetime('now')), der Nutzer waehlt aber lokale Kalendertage.
     Die Grenzen deshalb als Ortszeit interpretieren und nach UTC schieben - sonst fehlen
     abends erfasste Vorgaenge im gewaehlten Tag. */
  if (text(req.query.von)) { wo.push("created_at >= datetime(?, 'utc')"); werte.push(text(req.query.von) + ' 00:00:00'); }
  if (text(req.query.bis)) { wo.push("created_at <= datetime(?, 'utc')"); werte.push(text(req.query.bis) + ' 23:59:59'); }
  if (text(req.query.nutzer)) { wo.push('actor_username = ?'); werte.push(text(req.query.nutzer)); }
  if (text(req.query.kategorie)) { wo.push('kategorie = ?'); werte.push(text(req.query.kategorie)); }
  if (text(req.query.fall)) { wo.push('case_id = ?'); werte.push(text(req.query.fall)); }
  if (text(req.query.suche)) { wo.push('(action LIKE ? OR target_id LIKE ? OR empfaenger LIKE ?)');
    const s = '%' + text(req.query.suche) + '%'; werte.push(s, s, s); }
  const bedingung = wo.length ? (' WHERE ' + wo.join(' AND ')) : '';
  const gesamt = db.prepare('SELECT COUNT(*) AS c FROM audit_log' + bedingung).get(...werte).c;
  const rows = db.prepare('SELECT * FROM audit_log' + bedingung + ' ORDER BY created_at DESC, id DESC LIMIT ?').all(...werte, limit);
  res.json({
    gesamt,
    nutzerListe: db.prepare('SELECT DISTINCT actor_username FROM audit_log WHERE actor_username != \'\' ORDER BY actor_username').all().map((r) => r.actor_username),
    entries: rows.map((r) => ({
      id: r.id,
      actorUsername: r.actor_username,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      details: JSON.parse(r.details_json || '{}'),
      caseId: r.case_id || '',
      kategorie: r.kategorie || '',
      zweck: r.zweck || '',
      empfaenger: r.empfaenger || '',
      kanal: r.kanal || '',
      createdAt: r.created_at
    }))
  });
});

// Audit-Log leeren: bewusst NUR fuer echte Admins - das Router-Gate oben laesst /audit-log auch
// fuer delegierte canViewAuditLog-Nutzer durch (Lesezugriff, methodenunabhaengig), daher hier eine
// explizite zusaetzliche Pruefung. Das Leeren selbst wird als erster neuer Eintrag protokolliert.
router.delete('/audit-log', (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Nur für Administratoren.' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
  db.prepare('DELETE FROM audit_log').run();
  logAction(req, 'audit-log.clear', 'audit-log', '1', { deletedEntries: count });
  res.json({ ok: true, deleted: count });
});

// Historische Klartext-Route: absichtlich als 410-Tombstone stehen gelassen, damit alte
// HTML-Versionen nicht still ein vermeintlich vollständiges, tatsächlich unsicheres ZIP erzeugen.
// Der einzige Online-Weg ist die serverseitig materialisierte Schema-3-Datei *.json.enc.
router.get('/backup-secrets', (_req, res) => {
  res.status(410).json({
    error: 'Der Klartext-Sicherheitsexport wurde im Online-Modus abgeschaltet. '
      + 'Verwenden Sie ausschließlich Sicherheit.json.enc aus der serverseitigen Vollsicherung.',
    code: 'LEGACY_PLAINTEXT_SECURITY_EXPORT_DISABLED'
  });
});

// Auch der Klartext-Restore bleibt nur als eindeutiger 410-Tombstone erreichbar.
const RESTORE_TABLES = backupData.restoreDefinitions('security');

function restorePayload(payload, definitions, currentSessionId, includeCaseOwners, dryRun, schema, options) {
  const expected = schema || {};
  const opt = options || {};
  return backupData.restorePayload(db, payload, definitions, {
    currentSid: currentSessionId,
    includeCaseOwners,
    dryRun: !!dryRun,
    expectedType: expected.type,
    expectedVersions: expected.versions,
    strictSkips: !!opt.strictSkips,
    allowedSkipReasons: opt.allowedSkipReasons,
    afterExecute: opt.afterExecute
  });
}

function restoreErrorResponse(res, prefix, error) {
  const known = error && typeof error.code === 'string' && error.code.startsWith('RESTORE_');
  const report = error && error.restoreReport;
  const body = {
    error: `${prefix}: ${known ? error.message : 'Die Datenbank hat die Wiederherstellung abgebrochen.'}`,
    code: known ? error.code : 'RESTORE_DATABASE_FAILED'
  };
  if (known && error.detail) body.detail = error.detail;
  if (report) {
    body.restoreReport = report;
    body.summary = report.totals;
  }
  return res.status(known ? 422 : 500).json(body);
}

function currentSid(req) {
  return req.sessionID || (req.session && req.session.id) || null;
}

router.post('/restore-secrets', (req, res) => {
  res.status(410).json({
    error: 'Der Klartext-Sicherheitsrestore wurde im Online-Modus abgeschaltet. '
      + 'Verwenden Sie ausschließlich die verschlüsselte Schema-3-Wiederherstellung.',
    code: 'LEGACY_PLAINTEXT_SECURITY_RESTORE_DISABLED'
  });
});

const CREDENTIAL_RESTORE_TABLES = backupData.restoreDefinitions('credentials');
const encryptedRestorePreviews = new Map();
function envelopeDigest(envelope) {
  return secureJson.sha256(Buffer.from(secureJson.stableJson(envelope), 'utf8'));
}
function normalizedTokenDisposition(value, required) {
  const disposition = value === 'restore' ? 'restore' : (value === 'discard' ? 'discard' : '');
  if (required && !disposition) {
    throw new Error('Für alte API-, MCP- und WebDAV-Tokens ist eine ausdrückliche Entscheidung erforderlich.');
  }
  return disposition || 'discard';
}

function clearObsoletePortableCredentialFields(targetDb) {
  // Der frühere Maps-Schlüssel in office_profile ist kein Bestandteil des
  // portablen Schema-3-Abbilds. Nach einem Serververlust wäre sein alter
  // Ciphertext unter dem neuen ENCRYPTION_KEY nicht mehr lesbar und würde die
  // Freigabe blockieren, obwohl map_settings bereits wiederhergestellt ist.
  try {
    targetDb.prepare("UPDATE office_profile SET maps_api_key_encrypted='' WHERE id=1").run();
  } catch (error) {
    // Sehr alte Datenbanken ohne Tabelle/Spalte werden durch die reguläre
    // Migration ergänzt. Alle anderen Datenbankfehler bleiben fatal.
    if (!/no such (?:table|column)/i.test(String(error && error.message || error))) throw error;
  }
}

function restoreSchema(value, options) {
  const opt = options || {};
  if (recoveryMode.isActive() && value !== 'security/3' && value !== 'credentials/3') {
    throw new Error('Im Wiederherstellungsmodus sind ausschließlich portable Schema-3-Abbilder zulässig.');
  }
  if (value === 'security/2') {
    return {
      schema: value, type: 'betreuungsbuero-sicherheit', version: 2,
      definitions: RESTORE_TABLES, caseOwners: true, portable: false,
      requiresOriginalEncryptionKey: true
    };
  }
  if (value === 'credentials/2') {
    return {
      schema: value, type: 'betreuungsbuero-zugangsdaten', version: 2,
      definitions: CREDENTIAL_RESTORE_TABLES, caseOwners: false, portable: false,
      requiresOriginalEncryptionKey: true
    };
  }
  if (value === 'security/3') {
    const tokenDisposition = normalizedTokenDisposition(
      opt.tokenDisposition,
      true
    );
    return {
      schema: value, type: 'betreuungsbuero-sicherheit', version: 3,
      scope: 'security',
      definitions: backupData.restoreDefinitions('security', { tokenDisposition }),
      caseOwners: true, portable: true,
      requiresOriginalEncryptionKey: false,
      tokenDisposition
    };
  }
  if (value === 'credentials/3') {
    return {
      schema: value, type: 'betreuungsbuero-zugangsdaten', version: 3,
      scope: 'credentials',
      definitions: CREDENTIAL_RESTORE_TABLES, caseOwners: false, portable: true,
      requiresOriginalEncryptionKey: false
    };
  }
  throw new Error('Dieses Sicherungsschema kann hier nicht wiederhergestellt werden.');
}
function restoreGeneration(payload, descriptor) {
  const value = payload && payload.recoveryGeneration;
  if (!value || typeof value !== 'object') {
    if (recoveryMode.isActive()) throw new Error('Dem Abbild fehlt die verpflichtende Wiederherstellungsgeneration.');
    return { generationId: '', sourceRevision: '', artifactScope: descriptor.scope || '' };
  }
  const generationId = String(value.generationId || '').trim();
  const sourceRevision = String(value.sourceRevision || '').trim();
  const artifactScope = String(value.artifactScope || '').trim();
  if (!generationId || !/^[0-9a-f]{64}$/i.test(sourceRevision)
      || (descriptor.scope && artifactScope !== descriptor.scope)) {
    throw new Error('Die Wiederherstellungsgeneration ist unvollständig oder gehört zum falschen Artefakt.');
  }
  return { generationId, sourceRevision, artifactScope };
}
function validatedRestorePayload(decoded, descriptor, rehydrate) {
  if (!decoded.payload || decoded.payload.type !== descriptor.type
      || Number(decoded.payload.version) !== descriptor.version) {
    throw new Error('Typ oder Version der Sicherungsdaten ist ungültig.');
  }
  if (!descriptor.portable) return decoded.payload;
  restoreGeneration(decoded.payload, descriptor);
  backupData.validatePortableRecoveryPayload(decoded.payload, descriptor.scope);
  const prepared = backupData.rehydratePortableSecrets(decoded.payload, cryptoHelper);
  return rehydrate ? prepared : decoded.payload;
}
function previewSummary(payload, definitions, includeCaseOwners) {
  const tables = {};
  for (const { key, table } of definitions) tables[table] = Array.isArray(payload[key]) ? payload[key].length : 0;
  if (includeCaseOwners) tables.case_owners = Array.isArray(payload.caseOwners) ? payload.caseOwners.length : 0;
  return {
    type: payload.type || '',
    version: Number(payload.version) || 0,
    generation: payload.recoveryGeneration || null,
    tables
  };
}

function encryptedSnapshotState(_keyStatus, options) {
  const opt = options || {};
  const targetDb = opt.db || db;
  const documents = opt.documents || require('../documents/routes').intern;
  const keyStore = opt.recoveryKeyStore || recoveryKeyStore.shared();
  let liveSourceRevision = '';
  let liveRevisionError = '';
  try {
    liveSourceRevision = opt.currentSourceRevision === undefined
      ? backupData.portableRecoverySourceRevision(targetDb, cryptoHelper)
      : String(opt.currentSourceRevision || '');
    if (!/^[0-9a-f]{64}$/i.test(liveSourceRevision)) {
      throw new Error('Die aktuelle Recovery-Quellrevision ist ungültig.');
    }
  } catch (error) {
    liveRevisionError = error.message || String(error);
  }
  const result = {};
  for (const artifactKind of ['security-encrypted', 'credentials-encrypted']) {
    const expectedSchema = artifactKind === 'security-encrypted' ? 'security/3' : 'credentials/3';
    const expectedScope = artifactKind === 'security-encrypted' ? 'security' : 'credentials';
    const row = (() => {
      try {
        return targetDb.prepare(`
          SELECT f.*,m.status AS materialization_status,m.last_error,
                 m.sha256 AS materialization_sha256,
                 m.source_revision AS materialization_source_revision
            FROM doc_materializations m
            LEFT JOIN doc_files f ON f.id=m.file_id
           WHERE m.scope_type='office' AND m.scope_id='' AND m.artifact_kind=?
        `).get(artifactKind);
      } catch (_error) { return null; }
    })();
    if (!row || !row.id) {
      result[artifactKind] = {
        present: false,
        matchesActiveKey: false,
        verified: false,
        status: row && row.materialization_status || 'missing',
        error: row && row.last_error || ''
      };
      continue;
    }
    try {
      const file = documents.documentStorage.findBlobPath(row);
      if (!file) throw new Error('Datei fehlt auf der Platte.');
      if (row.deleted_at || row.area !== 'management' || row.visibility !== 'admin'
          || Number(row.managed) !== 1 || row.artifact_kind !== artifactKind) {
        throw new Error('Die Dokumentmetadaten des Sicherheitsabbilds sind inkonsistent.');
      }
      if (row.materialization_status !== 'ok' || row.last_error) {
        throw new Error(row.last_error || 'Die Materialisierung ist nicht als erfolgreich markiert.');
      }
      const bytes = fs.readFileSync(file);
      const actualSha = secureJson.sha256(bytes);
      if (!/^[0-9a-f]{64}$/i.test(String(row.sha256 || ''))
          || !/^[0-9a-f]{64}$/i.test(String(row.materialization_sha256 || ''))
          || actualSha !== String(row.sha256).toLowerCase()
          || actualSha !== String(row.materialization_sha256).toLowerCase()) {
        throw new Error('Die Datei-Prüfsumme stimmt nicht mit Index und Materialisierungsstatus überein.');
      }
      const active = keyStore.current();
      if (!active.configured || !active.strong || active.requiresRotation || !active.key) {
        throw new Error('Der aktive Wiederherstellungsschlüssel ist nicht vollständig verfügbar.');
      }
      const envelope = JSON.parse(bytes.toString('utf8'));
      const decoded = secureJson.decryptJson(envelope, active.key, expectedSchema);
      backupData.validatePortableRecoveryPayload(decoded.payload, expectedScope);
      if (liveRevisionError) {
        throw new Error(`Die Aktualität gegenüber der Live-Datenbank ist nicht prüfbar: ${liveRevisionError}`);
      }
      const generation = restoreGeneration(decoded.payload, {
        scope: expectedScope
      });
      if (generation.generationId !== String(envelope.generationId || '')
          || generation.sourceRevision !== String(envelope.sourceRevision || '')
          || generation.sourceRevision !== String(row.materialization_source_revision || '')) {
        throw new Error('Generation oder Quellrevision des Sicherheitsabbilds ist inkonsistent.');
      }
      if (generation.sourceRevision !== liveSourceRevision) {
        throw new Error('Das Sicherheitsabbild ist gegenüber der aktuellen Datenbankrevision veraltet.');
      }
      const matchesActiveKey = envelope.keyId
        ? envelope.keyId === active.keyId
        : Number(envelope.version) === 1;
      if (!matchesActiveKey) throw new Error('Das Sicherheitsabbild gehört nicht zum aktiven Schlüssel.');
      result[artifactKind] = {
        present: true,
        matchesActiveKey: true,
        verified: true,
        status: row.materialization_status || 'ok',
        schema: envelope.schema || '',
        keyId: envelope.keyId || '',
        generationId: envelope.generationId || '',
        sourceRevision: envelope.sourceRevision || '',
        currentSourceRevision: liveSourceRevision,
        upToDate: true,
        error: row.last_error || ''
      };
    } catch (error) {
      result[artifactKind] = {
        present: true,
        matchesActiveKey: false,
        verified: false,
        upToDate: false,
        status: 'error',
        error: error.message || String(error)
      };
    }
  }
  const security = result['security-encrypted'];
  const credentials = result['credentials-encrypted'];
  if (security && credentials && security.verified && credentials.verified
      && (security.generationId !== credentials.generationId
        || security.sourceRevision !== credentials.sourceRevision)) {
    const error = 'Sicherheits- und Zugangsdatenabbild stammen nicht aus derselben Recovery-Generation.';
    for (const state of [security, credentials]) {
      state.verified = false;
      state.status = 'error';
      state.error = error;
    }
  }
  return result;
}

function recoveryStatus() {
  const status = recoveryKeyStore.shared().publicStatus();
  const snapshots = encryptedSnapshotState(status);
  return {
    configured: status.configured,
    source: status.source,
    writable: status.writable,
    keyId: status.keyId,
    fingerprint: status.fingerprint || '',
    keyGeneration: status.generation,
    keyCreatedAt: status.createdAt,
    legacyKeyMetadata: status.legacyMetadata,
    strong: status.strong,
    requiresRotation: status.requiresRotation,
    updatedAt: status.updatedAt,
    error: status.error,
    snapshots,
    snapshotsVerified: !!(
      snapshots['security-encrypted'] && snapshots['security-encrypted'].verified
      && snapshots['credentials-encrypted'] && snapshots['credentials-encrypted'].verified
    ),
    recovery: recoveryMode.status()
  };
}

function noSecretCaching(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

router.get(['/backup-encryption/status', '/recovery-key/status'], (req, res) => {
  noSecretCaching(res);
  res.json(recoveryStatus());
});

router.get('/recovery/status', (req, res) => {
  noSecretCaching(res);
  res.json({ ok: true, recovery: recoveryMode.status() });
});

async function currentAdminPasswordMatches(req) {
  const user = getUserStmt.get(req.session && req.session.userId);
  if (!user || user.active === 0 || !user.is_admin || !user.password_hash) return false;
  return verifyPassword(String(req.body && req.body.adminPassword || ''), user.password_hash);
}

const SESSION_PERMISSION_FLAGS = Object.freeze({
  allowCaseManagement: 'caseManagement',
  canViewCases: 'viewCases',
  canEditCases: 'editCases',
  canViewDocuments: 'viewDocuments',
  canEditDocuments: 'editDocuments',
  canViewFinance: 'viewFinance',
  canEditFinance: 'editFinance',
  canManageMailSettings: 'manageMailSettings',
  canManageOfficeProfile: 'manageOfficeProfile',
  canManageMapSettings: 'manageMapSettings',
  canManageCredentials: 'manageCredentials',
  canManageCalendarConnections: 'manageCalendarConnections',
  canApproveMileage: 'approveMileage',
  canViewAuditLog: 'viewAuditLog',
  canUseAi: 'useAi',
  canDocsAllCases: 'docsAllCases',
  canSendMail: 'sendMail',
  canUseFieldService: 'useFieldService',
  canUseExtension: 'useExtension',
  canViewAllQualifications: 'viewAllQualifications',
  canViewAllCases: 'viewAllCases',
  canViewBankData: 'viewBankData',
  canManageBankConnections: 'manageBankConnections',
  canInitiatePayments: 'initiatePayments',
  // Ohne diesen Eintrag behielte eine laufende Admin-Sitzung nach dem Auffrischen
  // kein Controlling-Flag - die Route antwortete dann 403 statt mit Daten.
  canViewControlling: 'viewControlling'
});

function refreshSessionFromLiveAdmin(session, user) {
  if (!session || !user || user.active === 0 || !user.is_admin) return false;
  const permissions = parseUserPermissions(user).online;
  session.userId = user.id;
  session.isAdmin = true;
  session.displayName = user.display_name || user.username;
  session.mode = 'online';
  for (const [flag, permission] of Object.entries(SESSION_PERMISSION_FLAGS)) {
    session[flag] = !!user.is_admin || !!permissions[permission];
  }
  return true;
}

function reconcileRestoredAdminSessions(targetDb, req) {
  const sid = String(currentSid(req) || '');
  const liveUser = targetDb.prepare('SELECT * FROM users WHERE id=?')
    .get(req.session && req.session.userId);
  const mayContinue = !!(sid && liveUser && liveUser.active !== 0 && liveUser.is_admin);
  if (mayContinue) targetDb.prepare('DELETE FROM sessions WHERE sid<>?').run(sid);
  else targetDb.prepare('DELETE FROM sessions').run();
  return {
    checked: true,
    revoked: !mayContinue,
    user: mayContinue ? liveUser : null
  };
}

router.post('/recovery/release', async (req, res) => {
  noSecretCaching(res);
  if (!req.body || req.body.confirm !== true) {
    return res.status(400).json({ error: 'Die ausdrückliche Freigabebestätigung fehlt.' });
  }
  if (!(await currentAdminPasswordMatches(req))) {
    return res.status(403).json({ error: 'Das aktuelle Admin-Kennwort ist nicht korrekt.' });
  }
  try {
    const recovery = recoveryMode.release();
    logAction(req, 'recovery.release', 'server-recovery', '1', {
      generationId: recovery.securityGenerationId,
      tokenDisposition: recovery.tokenDisposition,
      restartRequired: true
    });
    res.json({
      ok: true,
      restartRequired: true,
      message: 'Wiederherstellung geprüft. Der Server bleibt bis zum Neustart gesperrt.',
      recovery
    });
  } catch (error) {
    const known = error && typeof error.code === 'string';
    res.status(known ? 409 : 500).json({
      error: error.message || String(error),
      code: known ? error.code : 'RECOVERY_RELEASE_FAILED',
      ...(error.detail ? { detail: error.detail } : {})
    });
  }
});

router.post('/recovery-key/verify', async (req, res) => {
  noSecretCaching(res);
  if (!(await currentAdminPasswordMatches(req))) {
    return res.status(403).json({ error: 'Das aktuelle Admin-Kennwort ist nicht korrekt.' });
  }
  try {
    const matches = recoveryKeyStore.shared().verify(req.body && req.body.recoveryKey);
    logAction(req, 'recovery-key.verify', 'recovery-key', 'active', { matches });
    const status = recoveryKeyStore.shared().publicStatus();
    res.json({
      ok: true,
      matches,
      keyId: status.keyId,
      keyGeneration: status.generation
    });
  } catch (error) {
    res.status(400).json({ error: error.message || String(error) });
  }
});

function requireSuccessfulRecoveryPair(result) {
  const rows = Array.isArray(result) ? result : [];
  const errors = [];
  for (const artifactKind of ['security-encrypted', 'credentials-encrypted']) {
    const row = rows.find((entry) => entry && entry.artifactKind === artifactKind);
    if (!row) {
      errors.push({ artifactKind, error: 'Das verpflichtende Abbild fehlt im Erzeugungsbericht.' });
    } else if (row.error) {
      errors.push({ artifactKind, error: String(row.error) });
    } else if (!row.changed && !row.skipped) {
      errors.push({ artifactKind, error: 'Das verpflichtende Abbild wurde nicht nachweisbar veröffentlicht.' });
    }
  }
  if (!errors.length) return;
  const error = new Error('Das neue Recovery-Doppelabbild konnte nicht vollständig veröffentlicht werden.');
  error.code = 'RECOVERY_KEY_SNAPSHOT_PAIR_FAILED';
  error.snapshotErrors = errors;
  throw error;
}

function removeManagedRecoveryKey(keys) {
  for (const file of [
    keys.filePath,
    `${keys.filePath}.meta.json`,
    `${keys.filePath}.pending.json`
  ]) {
    try { fs.unlinkSync(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function compensateRecoveryKeyRotation(keys, previous, materializations) {
  if (previous && previous.source === 'admin-panel' && previous.configured && previous.key) {
    keys.setKey(previous.key);
  } else {
    // Vorherige Umgebungsvariable beziehungsweise „nicht eingerichtet“ wird
    // sichtbar, sobald die soeben erzeugte verwaltete Datei entfernt ist.
    removeManagedRecoveryKey(keys);
  }
  const restored = keys.current();
  const samePrevious = !!(
    previous
    && restored.configured === previous.configured
    && restored.fingerprint === previous.fingerprint
  );
  if (!samePrevious) {
    throw new Error('Der vorherige Recovery-Schlüssel konnte nicht wieder aktiviert werden.');
  }
  if (restored.configured && restored.strong) {
    if (!materializations) {
      throw new Error('Der vorherige Schlüssel ist aktiv, aber seine Doppelabbilder konnten nicht erneuert werden.');
    }
    requireSuccessfulRecoveryPair(materializations.runOffice({ forceSecurity: true }));
  }
  return { reverted: true, keyId: restored.keyId || '', generation: Number(restored.generation) || 0 };
}

router.post('/recovery-key/rotate', async (req, res) => {
  noSecretCaching(res);
  const body = req.body || {};
  if (body.confirm !== true || body.externalCopyAcknowledged !== true) {
    return res.status(400).json({
      error: 'Bestätigung und Kenntnisnahme der externen Schlüsselverwahrung sind erforderlich.'
    });
  }
  if (!(await currentAdminPasswordMatches(req))) {
    return res.status(403).json({ error: 'Das aktuelle Admin-Kennwort ist nicht korrekt.' });
  }
  const mode = body.mode === 'generate' ? 'generate' : (body.mode === 'import' ? 'import' : '');
  if (!mode) return res.status(400).json({ error: 'Unbekannter Einrichtungsmodus.' });
  const keys = recoveryKeyStore.shared();
  const key = mode === 'generate' ? keys.generate() : String(body.recoveryKey || '');
  try {
    // Rotation und die unmittelbar folgende Erzeugung beider Schema-3-Abbilder bilden
    // gegenüber Vollsicherung, Plattenabgleich und automatischer Materialisierung eine
    // serielle Operation. So kann keine Sicherung einen neuen Schlüssel zusammen mit
    // noch unter der vorigen Generation erzeugten Sicherheitsdateien beobachten.
    const operation = await documentOperationCoordinator.runExclusive(
      'Recovery-Schlüssel rotieren und Sicherheitsabbilder erneuern',
      () => {
        const previous = keys.current();
        const materializations = require('../documents/materializations').current();
        const changed = keys.setKey(key);
        try {
          if (!materializations) {
            const unavailable = new Error('Die automatische Abbildpflege ist noch nicht gestartet.');
            unavailable.code = 'RECOVERY_KEY_SNAPSHOT_PAIR_FAILED';
            throw unavailable;
          }
          const materializationResult = materializations.runOffice({ forceSecurity: true });
          requireSuccessfulRecoveryPair(materializationResult);
          return { changed, materializationResult };
        } catch (error) {
          let rollback = null;
          let rollbackError = '';
          try {
            rollback = compensateRecoveryKeyRotation(keys, previous, materializations);
          } catch (compensationError) {
            rollbackError = compensationError.message || String(compensationError);
          }
          error.recoveryKeyRollback = rollback || {
            reverted: false,
            error: rollbackError || 'Unbekannter Fehler der Schlüsselkompensation.'
          };
          throw error;
        }
      },
      { priority: 1000, timeoutMs: 5 * 60 * 1000 }
    );
    const { changed, materializationResult } = operation;
    const status = recoveryStatus();
    logAction(req, changed.rotated ? 'recovery-key.rotate' : 'recovery-key.set', 'recovery-key', 'active', {
      oldKeyId: changed.previousKeyId,
      newKeyId: status.keyId,
      keyGeneration: status.keyGeneration,
      source: status.source,
      snapshotsUpdated: true
    });
    res.json({
      ok: true,
      saved: true,
      rotated: changed.rotated,
      status,
      snapshotsUpdated: true,
      snapshotErrors: [],
      // Nur bei serverseitiger Neuerzeugung und nur in dieser no-store-Antwort. Der
      // Client lädt daraus unmittelbar die extern zu verwahrende Schlüsseldatei.
      recoveryKey: mode === 'generate' ? key : undefined
    });
  } catch (error) {
    const rollback = error && error.recoveryKeyRollback;
    try {
      logAction(req, 'recovery-key.rotate-failed', 'recovery-key', 'active', {
        code: error && error.code || 'RECOVERY_KEY_ROTATION_FAILED',
        rollback: rollback || null
      });
    } catch (_auditError) { /* Fehlerantwort darf nicht vom Protokoll abhängen. */ }
    res.status(error && error.code === 'RECOVERY_KEY_SNAPSHOT_PAIR_FAILED' ? 503 : 400).json({
      error: error.message || String(error),
      code: error && error.code || 'RECOVERY_KEY_ROTATION_FAILED',
      ...(Array.isArray(error && error.snapshotErrors)
        ? { snapshotErrors: error.snapshotErrors }
        : {}),
      ...(rollback ? { rollback } : {})
    });
  }
});

router.post('/restore-encrypted/preview', (req, res) => {
  const envelope = req.body && req.body.envelope;
  const recoveryKey = String(req.body && req.body.recoveryKey || '');
  try {
    const descriptor = restoreSchema(envelope && envelope.schema, {
      tokenDisposition: req.body && req.body.tokenDisposition
    });
    const decoded = secureJson.decryptJson(envelope, recoveryKey, descriptor.schema);
    validatedRestorePayload(decoded, descriptor, false);
    const generation = descriptor.portable
      ? restoreGeneration(decoded.payload, descriptor)
      : { generationId: '', sourceRevision: '', artifactScope: '' };
    // Auch die Vorschau validiert jede Zeile und führt die echten Constraints
    // innerhalb eines SAVEPOINT aus. Sämtliche Probeänderungen werden vor der
    // Antwort zurückgerollt; dauerhaft geschrieben wird hier noch nichts.
    const previewPayload = validatedRestorePayload(decoded, descriptor, descriptor.portable);
    const restoreReport = restorePayload(
      previewPayload,
      descriptor.definitions,
      currentSid(req),
      descriptor.caseOwners,
      true,
      { type: descriptor.type, versions: [descriptor.version] },
      {
        strictSkips: descriptor.portable,
        allowedSkipReasons: descriptor.tokenDisposition === 'discard' ? ['token_discarded'] : [],
        afterExecute: descriptor.portable ? ({ db: targetDb }) => {
          if (descriptor.scope === 'security') assertActiveOnlineAdmin(targetDb);
          if (descriptor.scope === 'credentials') clearObsoletePortableCredentialFields(targetDb);
        } : undefined
      }
    );
    const previewToken = crypto.randomUUID();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    encryptedRestorePreviews.set(previewToken, {
      expiresAt,
      sessionId: String(currentSid(req) || ''),
      envelopeDigest: envelopeDigest(envelope),
      schema: descriptor.schema,
      generationId: generation.generationId,
      sourceRevision: generation.sourceRevision,
      tokenDisposition: descriptor.tokenDisposition || ''
    });
    for (const [token, entry] of encryptedRestorePreviews) {
      if (entry.expiresAt < Date.now()) encryptedRestorePreviews.delete(token);
    }
    res.json({
      ok: true,
      previewToken,
      expiresAt: new Date(expiresAt).toISOString(),
      schema: descriptor.schema,
      portable: descriptor.portable,
      generation,
      tokenDisposition: descriptor.tokenDisposition || '',
      requiresOriginalEncryptionKey: descriptor.requiresOriginalEncryptionKey,
      summary: previewSummary(decoded.payload, descriptor.definitions, descriptor.caseOwners),
      restoreReport,
      restoreSummary: restoreReport.totals
    });
  } catch (error) {
    if (error && error.restoreReport) {
      return restoreErrorResponse(res, 'Vorschau nicht möglich', error);
    }
    res.status(400).json({ error: 'Vorschau nicht möglich: ' + (error.message || error) });
  }
});

router.post('/restore-encrypted', (req, res) => {
  if (req.body && req.body.confirm !== true) {
    return res.status(400).json({ error: 'Die zweite Bestätigung fehlt (confirm:true).' });
  }
  const envelope = req.body && req.body.envelope;
  const recoveryKey = String(req.body && req.body.recoveryKey || '');
  const previewToken = String(req.body && req.body.previewToken || '');
  const preview = encryptedRestorePreviews.get(previewToken);
  const restoredSession = { checked: false, revoked: false, user: null };
  try {
    const descriptor = restoreSchema(envelope && envelope.schema, {
      tokenDisposition: req.body && req.body.tokenDisposition
    });
    if (!preview || preview.expiresAt < Date.now()
      || preview.sessionId !== String(currentSid(req) || '')
      || preview.envelopeDigest !== envelopeDigest(envelope)
      || preview.schema !== descriptor.schema
      || preview.tokenDisposition !== String(descriptor.tokenDisposition || '')) {
      throw new Error('Die Wiederherstellungsvorschau fehlt, ist abgelaufen oder gehört zu einer anderen Datei.');
    }
    if (descriptor.tokenDisposition === 'restore' && req.body.confirmTokens !== true) {
      throw new Error('Das Reaktivieren alter API-, MCP- und WebDAV-Tokens wurde nicht ausdrücklich bestätigt.');
    }
    const decoded = secureJson.decryptJson(envelope, recoveryKey, descriptor.schema);
    const generation = descriptor.portable
      ? restoreGeneration(decoded.payload, descriptor)
      : { generationId: '', sourceRevision: '', artifactScope: '' };
    if (generation.generationId !== preview.generationId
        || generation.sourceRevision !== preview.sourceRevision) {
      throw new Error('Die Wiederherstellungsgeneration stimmt nicht mehr mit der Vorschau überein.');
    }
    const payload = validatedRestorePayload(decoded, descriptor, true);
    const result = restorePayload(
      payload,
      descriptor.definitions,
      currentSid(req),
      descriptor.caseOwners,
      false,
      { type: descriptor.type, versions: [descriptor.version] },
      {
        strictSkips: descriptor.portable,
        allowedSkipReasons: descriptor.tokenDisposition === 'discard' ? ['token_discarded'] : [],
        afterExecute: descriptor.portable ? ({ db: targetDb }) => {
          if (descriptor.scope === 'security') {
            assertActiveOnlineAdmin(targetDb);
            // Sitzungen werden nie portabel übernommen. Die authentifizierende Sitzung
            // darf nur überleben, wenn derselbe Nutzer NACH dem Restore laut Live-DB
            // weiterhin aktiv und Admin ist. Ein altes Session-Flag genügt nicht.
            Object.assign(restoredSession, reconcileRestoredAdminSessions(targetDb, req));
            // Ein noch nicht eingelöster OAuth-Code ist ebenso kurzlebig wie
            // eine Sitzung und darf durch die SQLite-Rücksicherung nicht wieder
            // gültig werden. Die Tabelle ist kein portables Artefakt.
            try { targetDb.prepare('DELETE FROM mcp_auth_codes').run(); }
            catch (error) {
              if (!/no such table/i.test(String(error && error.message || error))) throw error;
            }
            if (descriptor.tokenDisposition === 'discard') {
              for (const table of backupData.tokenRestoreTables()) {
                targetDb.prepare(`DELETE FROM "${table}"`).run();
              }
            }
          }
          if (descriptor.scope === 'credentials') {
            clearObsoletePortableCredentialFields(targetDb);
          }
          if (generation.generationId) {
            recoveryMode.recordArtifactRestore(
              descriptor.scope,
              generation.generationId,
              generation.sourceRevision,
              descriptor.scope === 'security' ? descriptor.tokenDisposition : undefined
            );
          }
        } : undefined
      }
    );
    encryptedRestorePreviews.delete(previewToken);
    if (restoredSession.checked && !restoredSession.revoked) {
      // Express-session schreibt die Sitzung am Antwortende erneut. Deshalb müssen
      // auch die im Prozess gehaltenen Flags unmittelbar aus dem Restore-Ergebnis
      // aktualisiert werden, nicht erst beim nächsten Login.
      refreshSessionFromLiveAdmin(req.session, restoredSession.user);
    }
    logAction(req, 'backup-encrypted.restore', descriptor.schema, '1', result);
    const responseBody = {
      ok: true,
      schema: descriptor.schema,
      generation,
      tokenDisposition: descriptor.tokenDisposition || '',
      restored: backupData.legacyRestoredCounts(result),
      restoreReport: result,
      summary: result.totals,
      sessionRevoked: restoredSession.checked && restoredSession.revoked
    };
    if (restoredSession.checked && restoredSession.revoked) {
      responseBody.message = 'Die Wiederherstellung war erfolgreich. Ihr bisheriger Admin ist im Abbild nicht mehr aktiv; alle Sitzungen wurden beendet.';
      const session = req.session;
      if (session && typeof session.destroy === 'function') {
        return session.destroy((destroyError) => {
          // Die Datenbankzeile wurde bereits in derselben Restore-Transaktion entfernt.
          // req.session=null verhindert zusätzlich ein erneutes Speichern durch Middleware.
          req.session = null;
          if (destroyError) responseBody.sessionStoreWarning = 'Die Sitzung war bereits aus der Datenbank entfernt; der Store meldete beim Abschluss einen Fehler.';
          res.json(responseBody);
        });
      }
      req.session = null;
    }
    res.json(responseBody);
  } catch (error) {
    if (error && error.restoreReport) {
      return restoreErrorResponse(res, 'Verschlüsselte Wiederherstellung fehlgeschlagen', error);
    }
    res.status(400).json({ error: 'Verschlüsselte Wiederherstellung fehlgeschlagen: ' + (error.message || error) });
  }
});

/* ===== Moduldaten-Sicherung (2026-07-26, Audit-Luecken A/C/E + Mailentwuerfe) ==================
   Reine Fachdaten ohne Schutzbedarf - sie haengen sich an das Bueroorganisation-JSON an.
   Bewusst NICHT enthalten:
     - Datei-Bytes (data/files, Fotos, Scans, Anlagen): Nutzerentscheidung, der Dokumente-Sync
       uebernimmt das spaeter. Deshalb sichert diese Route nur METADATEN des Dokumentenspeichers.
     - intake_files.data (BLOB) - nur die Metadaten, s.u.
     - doc_text/doc_text_* (FTS5-Volltextindex): jederzeit aus den Dateien neu aufbaubar.
     - mail_cache: Nachrichten-Zwischenspeicher, laedt sich vom Server nach.
   office_json wird GENERISCH gedumpt (SELECT *), nicht ueber eine Schluesselliste - genau daran
   ist die alte Sicherung gescheitert (5 von 10 Schluesseln gesichert, und 'documents_config' war
   in keiner Liste). Neue Schluessel sind damit automatisch dabei. */
const MODULE_TABLES = backupData.restoreDefinitions('module');

router.get('/backup-module-data', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    const intakeOcr = require('../cases/intake-ocr').createIntakeOcrStore(db);
    res.json(backupData.moduleData(db, { intakeOcr }));
  } catch (e) {
    res.status(500).json({ error: 'Moduldaten-Sicherung fehlgeschlagen.' });
  }
});

/* Lesbares Zusatzabbild fuer den Arbeitsdatenexport: Rollen/Zustaendigkeiten, fachlicher
   Verarbeitungsverlauf und Dokumentenindex. Keine Datei-Bytes, Sitzungen oder Geheimnisse. */
router.get('/work-export-data', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    res.json(backupData.workExportData(db));
  } catch (_error) {
    res.status(500).json({ error: 'Arbeitsdaten-Zusatzabbild konnte nicht erzeugt werden.' });
  }
});

router.post('/restore-module-data', (req, res) => {
  const payload = req.body || {};
  if (payload.confirm !== true) return res.status(400).json({ error: 'Bestaetigung fehlt (confirm:true erforderlich).' });
  let result;
  try {
    result = restorePayload(payload, MODULE_TABLES, null, false, false, {
      type: 'betreuungsbuero-moduldaten',
      versions: [3]
    });
  } catch (e) {
    return restoreErrorResponse(res, 'Moduldaten-Restore fehlgeschlagen', e);
  }
  logAction(req, 'backup-module-data.restore', 'backup-module-data', '1', result);
  res.json({
    ok: true,
    restored: backupData.legacyRestoredCounts(result),
    restoreReport: result,
    summary: result.totals
  });
});

/* ===== Protokollierter Bestandsumbau auf lesbare Klarname-Pfade ============================
   Admin-only durch das Router-Gate oben. Der Prüflauf führt nur Journalzeilen, die eigentlichen
   Datei-/Fachdatentabellen und die Quelldateien bleiben unverändert. Der Schreiblauf verlangt
   zusätzlich eine ausgeschriebene Bestätigung; jeder Eintrag ist über source_key fortsetzbar. */
function documentsConfigForMigration() {
  try {
    const row = db.prepare("SELECT data_json FROM office_json WHERE key='documents_config'").get();
    const data = row ? JSON.parse(row.data_json || '{}') : {};
    const neuesLayout = data.storageLayout === 'real-folders-v1' || data.storageRoot !== undefined;
    return {
      storageRoot: String(data.storageRoot || ''),
      legacyBaseDir: String(data.legacyBaseDir || (!neuesLayout ? data.baseDir : '') || ''),
      caseDirs: data.caseDirs && typeof data.caseDirs === 'object' ? data.caseDirs : {}
    };
  } catch (_error) {
    return { storageRoot: '', legacyBaseDir: '', caseDirs: {} };
  }
}

function migrationService() {
  return createDocumentMigration({
    db,
    dataRoot: DATA_ROOT,
    readConfig: documentsConfigForMigration
  });
}

function requireDeveloperMigration(req, res, next) {
  if (process.env.ENABLE_DOCUMENT_MIGRATION === '1') return next();
  return res.status(404).json({
    error: 'Die Bestandsumstellung ist im normalen Betrieb abgeschaltet. Das Rettungswerkzeug kann nur in einer ausdrücklich freigegebenen Entwicklerkopie verwendet werden.'
  });
}

function migrationOptions(body, dryRun) {
  const input = body && typeof body === 'object' ? body : {};
  const maxRaw = input.maxItems;
  const maxItems = maxRaw == null || maxRaw === ''
    ? undefined
    : Math.min(100000, Math.max(0, Math.floor(Number(maxRaw) || 0)));
  return {
    dryRun,
    runId: input.runId ? String(input.runId) : undefined,
    maxItems,
    failFast: !!input.failFast
  };
}

router.post('/document-migration/preview', requireDeveloperMigration, (req, res) => {
  try {
    const result = migrationService().run(migrationOptions(req.body, true));
    logAction(req, 'document-migration.preview', 'document-migration', result.runId, result.summary);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Umstellungs-Prüflauf fehlgeschlagen: ' + (error.message || error) });
  }
});

router.post('/document-migration/run', requireDeveloperMigration, (req, res) => {
  if (String(req.body && req.body.confirm || '') !== 'UMHÄNGEN') {
    return res.status(400).json({ error: 'Explizite Bestätigung fehlt (confirm: „UMHÄNGEN“).' });
  }
  try {
    const result = migrationService().run(migrationOptions(req.body, false));
    logAction(req, 'document-migration.run', 'document-migration', result.runId, result.summary);
    res.status(result.status === 'completed_with_errors' ? 409 : 200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Bestandsumstellung fehlgeschlagen: ' + (error.message || error) });
  }
});

router.get('/document-migration/runs/:id', requireDeveloperMigration, (req, res) => {
  const run = db.prepare('SELECT * FROM doc_migration_runs WHERE id=?').get(String(req.params.id || ''));
  if (!run) return res.status(404).json({ error: 'Umstellungslauf nicht gefunden.' });
  const items = db.prepare('SELECT * FROM doc_migration_items WHERE run_id=? ORDER BY updated_at,source_key')
    .all(run.id)
    .map((item) => {
      let adjustments = [];
      try { adjustments = JSON.parse(item.adjustments_json || '[]'); } catch (_error) { adjustments = []; }
      return { ...item, adjustments };
    });
  let summary = {};
  try { summary = JSON.parse(run.summary_json || '{}'); } catch (_error) { summary = {}; }
  res.json({ run: { ...run, summary }, items });
});

router._test = {
  activeOnlineAdminCount,
  assertActiveOnlineAdmin,
  encryptedSnapshotState,
  recoveryStatus,
  reconcileRestoredAdminSessions,
  refreshSessionFromLiveAdmin
};
// Interner, nur lesender Statuslieferant für die technische
// Gesamtsicherungs-Vorprüfung. Er enthält niemals den Recovery-Key selbst.
router.intern = Object.freeze({ recoveryStatus });
module.exports = router;
