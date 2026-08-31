// E-Mail-Baustein (Nutzerwunsch 2026-07-18): vollwertiges Postfach im Client - mehrere Konten
// (IMAP/SMTP klassisch ODER Microsoft 365 ueber Graph), Ordner, Nachrichten, Aktionen, Versand,
// lokale Entwuerfe/Postausgang. Sichtbarkeit wie bei den Kalenderverbindungen: private Konten sieht
// nur der Eigentuemer, oeffentliche (bueroweite) jeder angemeldete Nutzer; bearbeiten darf der
// Eigentuemer oder ein Admin. Versand verlangt zusaetzlich das sendMail-Recht der Rechte-Matrix.

const express = require('express');
const crypto = require('crypto');
const db = require('../../database/index');
const { requireAuth, requireSendMail, requireViewCases } = require('../../middleware/authentication');
const { darfSehen } = require('../cases/case-visibility');
const cryptoHelper = require('../../security/crypto');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const imapEngine = require('../../integrations/mail/imap');
const graphEngine = require('../../integrations/mail/microsoft-graph');
const microsoftMail = require('../../integrations/mail/microsoft-mail');
const watch = require('./mailbox-watch');
const mailSend = require('./send');
const { schuetzePdfAnlagen } = require('./pdf-kennwort');
const outbox = require('./outbox');
outbox.start();

const router = express.Router();
router.use(requireAuth);
// Echtzeit (2026-07-19): erfolgreiche Schreiboperationen an alle Fenster/Nutzer melden.
router.use(require('../office/events').middleware('mail', /^\/(templates|rules)(\/|$)|^\/accounts(\/[^/]+)?$/));

// ---- Konten-Grundlagen ----------------------------------------------------------------------

const listAccountsStmt = db.prepare('SELECT * FROM mail_accounts ORDER BY sort_order, created_at');
const getAccountStmt = db.prepare('SELECT * FROM mail_accounts WHERE id = ?');
const insertAccountStmt = db.prepare(`INSERT INTO mail_accounts
  (id, label, kind, email, from_name, imap_host, imap_port, imap_secure, imap_user, imap_pass_encrypted,
   smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_encrypted, graph_connection_id,
   owner_user_id, visibility, sort_order, folder_prefs_json, signature, signature_source, reply_to, trash_retention_days, junk_retention_days, sync_window_days, cache_retention_days)
  VALUES (@id, @label, @kind, @email, @from_name, @imap_host, @imap_port, @imap_secure, @imap_user, @imap_pass_encrypted,
   @smtp_host, @smtp_port, @smtp_secure, @smtp_user, @smtp_pass_encrypted, @graph_connection_id,
   @owner_user_id, @visibility, @sort_order, @folder_prefs_json, @signature, @signature_source, @reply_to, @trash_retention_days, @junk_retention_days, @sync_window_days, @cache_retention_days)`);
const deleteAccountStmt = db.prepare('DELETE FROM mail_accounts WHERE id = ?');
const maxSortStmt = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM mail_accounts');
const setSortStmt = db.prepare('UPDATE mail_accounts SET sort_order = ? WHERE id = ?');
const isAdminStmt = db.prepare('SELECT is_admin FROM users WHERE id = ?');
const graphConnLabelStmt = db.prepare('SELECT display_name, account_label, username FROM calendar_connections WHERE id = ?');

function isAdmin(req) { return !!isAdminStmt.get(req.session.userId)?.is_admin; }
function canSee(acc, req) { return acc.visibility !== 'private' || acc.owner_user_id === req.session.userId; }
function canEdit(acc, req) { return acc.owner_user_id === req.session.userId || isAdmin(req); }

/* ══════ Ausfallschutz Systemversand (Nutzerentscheidung 28.08.2026) ══════
   Das Systemversand-Konto (smtp_config.send_account_id) traegt fuenf Dinge, die das Programm im
   Namen des Bueros tut: Passwort-vergessen-Mails, Dokumentversand, Fall-Mails, Sicherungs-
   warnungen, Testmails. Bisher liess sich genau dieses Konto ohne jede Warnung auf 'privat'
   stellen oder loeschen. Danach funktionieren Passwort-Mails NICHT MEHR - und seit dem Wegfall
   der Ausweichstrecke am 28.08.2026 (siehe service.js getSmtpConfig) auch nicht mehr still
   ueber Alt-Zugangsdaten: ohne zugewiesenes Konto ist der Systemversand schlicht unkonfiguriert.
   Diese Schranke hier ist damit wichtiger geworden, nicht unwichtiger.
   Wer es trotzdem will, bestaetigt ausdruecklich (systemversandStilllegen) - dann wird der
   Verweis sauber geloest, statt ins Leere zu zeigen. */
const istSystemversandStmt = db.prepare('SELECT send_account_id FROM smtp_config WHERE id = 1');
function istSystemversandKonto(id) {
  try { return String(istSystemversandStmt.get()?.send_account_id || '') === String(id); }
  catch (_e) { return false; }
}
function systemversandLoesen() {
  /* LEERSTRING, nicht NULL: die Spalte ist NOT NULL, ein NULL-Versuch scheitert still und der
     Verweis bliebe stehen (am Pruefstand aufgefallen). getSmtpConfig() behandelt '' ohnehin
     als „kein Konto referenziert" und faellt sauber auf die Alt-Zugangsdaten zurueck. */
  try { db.prepare("UPDATE smtp_config SET send_account_id = '', updated_at = datetime('now') WHERE id = 1").run(); }
  catch (_e) { /* Beiwerk - darf das Speichern/Loeschen nie verhindern */ }
}

function visibleAccount(req, id) {
  const acc = getAccountStmt.get(id);
  if (!acc || !canSee(acc, req)) return null;
  return acc;
}

function engineFor(acc) { return acc.kind === 'microsoft' ? graphEngine : imapEngine; }

function publicAccount(acc) {
  let folderPrefs = null;
  try { folderPrefs = acc.folder_prefs_json ? JSON.parse(acc.folder_prefs_json) : null; } catch (_e) { folderPrefs = null; }
  let graphLabel = '';
  if (acc.kind === 'microsoft' && acc.graph_connection_id) {
    const c = graphConnLabelStmt.get(acc.graph_connection_id);
    if (c) graphLabel = c.display_name || c.account_label || c.username || '';
  }
  return {
    id: acc.id, label: acc.label, kind: acc.kind, email: acc.email, fromName: acc.from_name,
    imapHost: acc.imap_host, imapPort: acc.imap_port, imapSecure: !!acc.imap_secure, imapUser: acc.imap_user,
    smtpHost: acc.smtp_host, smtpPort: acc.smtp_port, smtpSecure: !!acc.smtp_secure, smtpUser: acc.smtp_user,
    hasImapPass: !!acc.imap_pass_encrypted, hasSmtpPass: !!acc.smtp_pass_encrypted,
    graphConnectionId: acc.graph_connection_id || '', graphLabel,
    ownerUserId: acc.owner_user_id == null ? null : acc.owner_user_id,
    visibility: acc.visibility === 'public' ? 'public' : 'private',
    signatureSource: acc.signature_source === 'personal' ? 'personal' : 'office',
    sortOrder: acc.sort_order || 0,
    folderPrefs,
    color: acc.color || '',
    signature: acc.signature || '', replyTo: acc.reply_to || '',
    trashRetentionDays: acc.trash_retention_days || 0, junkRetentionDays: acc.junk_retention_days || 0,
    syncWindowDays: acc.sync_window_days || 0, cacheRetentionDays: acc.cache_retention_days == null ? 31 : acc.cache_retention_days
  };
}

function accountFromBody(body, existing) {
  const b = body || {};
  const keep = existing || {};
  const kind = (b.kind === 'microsoft') ? 'microsoft' : 'imap';
  return {
    label: String(b.label ?? keep.label ?? '').trim(),
    kind,
    email: String(b.email ?? keep.email ?? '').trim(),
    from_name: String(b.fromName ?? keep.from_name ?? '').trim(),
    imap_host: String(b.imapHost ?? keep.imap_host ?? '').trim(),
    imap_port: Number(b.imapPort ?? keep.imap_port ?? 993) || 993,
    imap_secure: (b.imapSecure ?? (keep.imap_secure !== 0)) ? 1 : 0,
    imap_user: String(b.imapUser ?? keep.imap_user ?? '').trim(),
    imap_pass_encrypted: b.imapPass ? cryptoHelper.encrypt(String(b.imapPass)) : (keep.imap_pass_encrypted || ''),
    smtp_host: String(b.smtpHost ?? keep.smtp_host ?? '').trim(),
    smtp_port: Number(b.smtpPort ?? keep.smtp_port ?? 587) || 587,
    smtp_secure: (b.smtpSecure ?? !!keep.smtp_secure) ? 1 : 0,
    smtp_user: String(b.smtpUser ?? keep.smtp_user ?? '').trim(),
    smtp_pass_encrypted: b.smtpPass ? cryptoHelper.encrypt(String(b.smtpPass)) : (keep.smtp_pass_encrypted || ''),
    graph_connection_id: String(b.graphConnectionId ?? keep.graph_connection_id ?? '').trim(),
    visibility: (b.visibility ?? keep.visibility) === 'public' ? 'public' : 'private',
    /* Nur zwei Stufen (Nutzerentscheidung 28.08.2026): 'office' oder 'personal'. Alles andere
       faellt auf 'office' zurueck - so sendet im Zweifel niemand ohne Signatur. */
    signature_source: (b.signatureSource ?? keep.signature_source) === 'personal' ? 'personal' : 'office',
    signature: b.signature != null ? String(b.signature) : (keep.signature || ''),
    reply_to: b.replyTo != null ? String(b.replyTo).trim() : (keep.reply_to || ''),
    trash_retention_days: b.trashRetentionDays != null ? Math.min(365, Math.max(0, Number(b.trashRetentionDays) || 0)) : (keep.trash_retention_days || 0),
    junk_retention_days: b.junkRetentionDays != null ? Math.min(365, Math.max(0, Number(b.junkRetentionDays) || 0)) : (keep.junk_retention_days || 0),
    sync_window_days: b.syncWindowDays != null ? Math.min(3650, Math.max(0, Number(b.syncWindowDays) || 0)) : (keep.sync_window_days || 0),
    cache_retention_days: b.cacheRetentionDays != null ? Math.min(3650, Math.max(0, Number(b.cacheRetentionDays) || 0)) : (keep.cache_retention_days == null ? 31 : keep.cache_retention_days)
  };
}

// ---- Konten-CRUD ----------------------------------------------------------------------------

router.get('/accounts', (req, res) => {
  const accounts = listAccountsStmt.all().filter((a) => canSee(a, req)).map(publicAccount);
  res.json({ accounts });
});

router.post('/accounts', (req, res) => {
  const data = accountFromBody(req.body);
  if (!data.label) return res.status(400).json({ error: 'Bitte eine Bezeichnung angeben.' });
  if (data.kind === 'imap' && (!data.imap_host || !data.imap_user)) return res.status(400).json({ error: 'IMAP-Server und Benutzername sind erforderlich.' });
  if (data.kind === 'microsoft' && !data.graph_connection_id) return res.status(400).json({ error: 'Bitte eine Microsoft-Verbindung auswählen.' });
  const id = crypto.randomUUID();
  insertAccountStmt.run({ id, ...data, owner_user_id: req.session.userId, sort_order: (maxSortStmt.get().m || 0) + 1, folder_prefs_json: '' });
  watch.refreshAccounts();
  res.status(201).json({ id, account: publicAccount(getAccountStmt.get(id)) });
});

router.put('/accounts/:id', (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  if (!canEdit(acc, req)) return res.status(403).json({ error: 'Nur der Eigentümer (oder ein Admin) darf dieses Konto ändern.' });
  const data = accountFromBody(req.body, acc);
  /* Auf 'privat' stellen wuerde dieses Konto fuer den Systemversand unbrauchbar machen
     (dort stehen nur bueroweite zur Wahl) - und der Ausfall waere stumm. */
  if (istSystemversandKonto(acc.id) && data.visibility === 'private') {
    if (!req.body?.systemversandStilllegen) {
      return res.status(409).json({
        error: 'Dieses Konto ist der Systemversand des Büros (Passwort-Mails, Dokumentversand). Als „privat" steht es dafür nicht mehr zur Verfügung. Bitte zuerst ein anderes Konto als Systemversand bestimmen – oder das Stilllegen ausdrücklich bestätigen.',
        code: 'systemversand-in-benutzung'
      });
    }
    systemversandLoesen();
  }
  db.prepare(`UPDATE mail_accounts SET label=@label, kind=@kind, email=@email, from_name=@from_name,
    imap_host=@imap_host, imap_port=@imap_port, imap_secure=@imap_secure, imap_user=@imap_user, imap_pass_encrypted=@imap_pass_encrypted,
    smtp_host=@smtp_host, smtp_port=@smtp_port, smtp_secure=@smtp_secure, smtp_user=@smtp_user, smtp_pass_encrypted=@smtp_pass_encrypted,
    graph_connection_id=@graph_connection_id, visibility=@visibility, signature=@signature, signature_source=@signature_source, reply_to=@reply_to,
    trash_retention_days=@trash_retention_days, junk_retention_days=@junk_retention_days,
    sync_window_days=@sync_window_days, cache_retention_days=@cache_retention_days, updated_at=datetime('now') WHERE id=@id`).run({ id: acc.id, ...data });
  watch.refreshAccounts();
  res.json({ account: publicAccount(getAccountStmt.get(acc.id)) });
});

router.delete('/accounts/:id', (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  if (!canEdit(acc, req)) return res.status(403).json({ error: 'Nur der Eigentümer (oder ein Admin) darf dieses Konto löschen.' });
  if (istSystemversandKonto(acc.id)) {
    if (!req.body?.systemversandStilllegen && req.query.systemversandStilllegen !== '1') {
      return res.status(409).json({
        error: 'Dieses Konto ist der Systemversand des Büros (Passwort-Mails, Dokumentversand). Bitte zuerst ein anderes Konto als Systemversand bestimmen – oder das Stilllegen ausdrücklich bestätigen.',
        code: 'systemversand-in-benutzung'
      });
    }
    systemversandLoesen();
  }
  deleteAccountStmt.run(acc.id);
  db.prepare('DELETE FROM mail_drafts WHERE account_id = ?').run(acc.id);
  db.prepare('DELETE FROM mail_cache WHERE account_id = ?').run(acc.id);
  watch.refreshAccounts();
  res.json({ ok: true });
});

// Eigene Kontofarbe (Farbpunkt in der Seitenleiste) – dauerhaft speichern (Nutzerwunsch). Bewusst
// eine schlanke eigene Route (nicht der ganze Konto-PUT), damit die Farbe ohne Passwort-Neuvergabe
// gesetzt werden kann. Rechte wie beim Konto-Editor: Eigentümer oder Admin.
router.put('/accounts/:id/color', (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  if (!canEdit(acc, req)) return res.status(403).json({ error: 'Nur der Eigentümer (oder ein Admin) darf dieses Konto ändern.' });
  const color = String(req.body?.color || '').slice(0, 32);
  db.prepare("UPDATE mail_accounts SET color = ?, updated_at = datetime('now') WHERE id = ?").run(color, acc.id);
  res.json({ ok: true, color });
});

// Konto-Reihenfolge in der Seitenleiste (Drag&Drop im Client).
router.post('/accounts/order', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  ids.forEach((id, index) => { try { setSortStmt.run(index + 1, String(id)); } catch (_e) { /* unbekannte id ueberspringen */ } });
  res.json({ ok: true });
});

// Verbindungstest aus dem Konten-Dialog - funktioniert VOR dem Speichern (Konfiguration im Body);
// bei bestehendem Konto (id) werden leere Passwortfelder aus dem Bestand ergaenzt.
router.post('/accounts/test', async (req, res) => {
  try {
    const existing = req.body?.id ? getAccountStmt.get(String(req.body.id)) : null;
    const data = accountFromBody(req.body, existing || undefined);
    const probe = { id: 'test-' + crypto.randomUUID(), ...data };
    const result = await engineFor(probe).testConnection(probe);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Verbindungstest fehlgeschlagen.' });
  }
});

// ---- Ordner ---------------------------------------------------------------------------------

router.get('/accounts/:id/folders', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  try {
    const folders = await engineFor(acc).listFolders(acc);
    res.json({ folders });
  } catch (error) { res.status(400).json({ error: error.message || 'Ordner konnten nicht geladen werden.' }); }
});

router.post('/accounts/:id/folders', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Bitte einen Ordnernamen angeben.' });
  try {
    const parent = String(req.body?.parent || '');
    const result = acc.kind === 'microsoft'
      ? await graphEngine.createFolder(acc, name, parent || undefined)
      // IMAP: das echte Trennzeichen des Elternordners nutzen (nicht pauschal '/') – sonst würde der
      // Unterordner auf Servern mit '.'-Hierarchie flach danebenliegen. createFolder ermittelt es.
      : await imapEngine.createFolder(acc, name, parent || undefined);
    res.status(201).json(result);
  } catch (error) { res.status(400).json({ error: error.message || 'Ordner konnte nicht angelegt werden.' }); }
});

// Ordner verschieben/umhängen (DnD im Client): unter einen anderen Ordner (parent) oder auf die
// oberste Ebene (parent leer). Umsetzung per RENAME auf den neuen Pfad; Unterordner ziehen mit.
router.post('/accounts/:id/folder-move', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  try {
    res.json(await engineFor(acc).moveFolder(acc, String(req.body?.path || ''), String(req.body?.parent || '')));
  } catch (error) { res.status(400).json({ error: error.message || 'Ordner konnte nicht verschoben werden.' }); }
});

router.post('/accounts/:id/folder-rename', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  try {
    res.json(await engineFor(acc).renameFolder(acc, String(req.body?.path || ''), String(req.body?.newName || '')));
  } catch (error) { res.status(400).json({ error: error.message || 'Ordner konnte nicht umbenannt werden.' }); }
});

router.post('/accounts/:id/folder-delete', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  try {
    res.json(await engineFor(acc).deleteFolder(acc, String(req.body?.path || '')));
  } catch (error) { res.status(400).json({ error: error.message || 'Ordner konnte nicht gelöscht werden.' }); }
});

// Push-Kanal (SSE): 'snapshot' beim Verbinden, danach 'mail'/'update' aus dem Mail-Watcher.
router.get('/events', (req, res) => watch.subscribe(req, res));

// Ordner-Darstellung (Sortiermodus alphabetisch/manuell + manuelle Reihenfolge) je Konto.
router.put('/accounts/:id/folder-prefs', (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  const prefs = { sortMode: req.body?.sortMode === 'alpha' ? 'alpha' : 'manual', order: Array.isArray(req.body?.order) ? req.body.order.map(String).slice(0, 500) : [] };
  db.prepare("UPDATE mail_accounts SET folder_prefs_json = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(prefs), acc.id);
  res.json({ ok: true, folderPrefs: prefs });
});

// ---- Envelope-Cache (lokale Speicherdauer) --------------------------------------------------
const cacheUpsertStmt = db.prepare("INSERT INTO mail_cache (account_id, folder, uid, env_json, msg_date, cached_at) VALUES (@a,@f,@u,@j,@d,datetime('now')) ON CONFLICT(account_id,folder,uid) DO UPDATE SET env_json=excluded.env_json, msg_date=excluded.msg_date, cached_at=datetime('now')");
const cacheListStmt = db.prepare('SELECT env_json FROM mail_cache WHERE account_id = ? AND folder = ? ORDER BY msg_date DESC LIMIT ?');
const cacheTrimStmt = db.prepare('DELETE FROM mail_cache WHERE account_id = ? AND folder = ? AND uid NOT IN (SELECT uid FROM mail_cache WHERE account_id = ? AND folder = ? ORDER BY msg_date DESC LIMIT 1000)');
const cacheDeleteMessageStmt = db.prepare('DELETE FROM mail_cache WHERE account_id = ? AND folder = ? AND uid = ?');
const cacheClearFolderStmt = db.prepare('DELETE FROM mail_cache WHERE account_id = ? AND folder = ?');
const cacheByAccountStmt = db.prepare('SELECT folder, uid, env_json FROM mail_cache WHERE account_id = ? ORDER BY msg_date DESC');
function cacheUpsert(accountId, folder, messages) {
  const tx = db.transaction((rows) => {
    for (const m of rows) cacheUpsertStmt.run({ a: accountId, f: folder, u: String(m.uid), j: JSON.stringify(m), d: m.date || '' });
  });
  tx(messages.slice(0, 200));
  try { cacheTrimStmt.run(accountId, folder, accountId, folder); } catch (_e) { /* Trim ist Beiwerk */ }
}
function cacheList(accountId, folder, limit) {
  return cacheListStmt.all(accountId, folder, limit).map((r) => { try { return Object.assign(JSON.parse(r.env_json), { __cached: true }); } catch (_e) { return null; } }).filter(Boolean);
}
function cacheRemove(accountId, folder, uid) {
  if (!uid) return;
  try { cacheDeleteMessageStmt.run(accountId, folder, String(uid)); } catch (_e) { /* Cache ist Beiwerk */ }
}
function cacheClear(accountId, folder) {
  if (!folder) return;
  try { cacheClearFolderStmt.run(accountId, folder); } catch (_e) { /* Cache ist Beiwerk */ }
}

// ---- Nachrichten ----------------------------------------------------------------------------

/* Fallübersicht: tatsächlich im Postfach vorhandene Nachrichten auflösen, die über
   mailx_case_links der Falldokumentation zugeordnet wurden. Neue Verknüpfungen enthalten
   Ordner/UID direkt; ältere Einträge werden über ihre stabile Message-ID wiedergefunden. */
router.get('/case-messages', requireViewCases, async (req, res) => {
  const caseId = String(req.query.caseId || '').trim();
  if (!caseId) return res.status(400).json({ error: 'caseId erforderlich.' });
  if (!darfSehen(req.session, caseId)) return res.status(403).json({ error: 'Dieser Fall ist Ihrem Konto nicht zugeordnet.' });

  let links = {};
  try {
    const row = db.prepare("SELECT data_json FROM office_json WHERE key = 'mailx_case_links'").get();
    links = row ? JSON.parse(row.data_json || '{}') : {};
  } catch (_e) { links = {}; }

  const selected = Object.entries(links).filter(([, link]) => String(link && link.caseId || '') === caseId);
  const messages = [];
  let unresolved = 0;

  for (const [key, linkValue] of selected.slice(0, 200)) {
    const splitAt = key.indexOf('|');
    const accountId = splitAt >= 0 ? key.slice(0, splitAt) : '';
    const stableId = splitAt >= 0 ? key.slice(splitAt + 1) : '';
    const link = linkValue && typeof linkValue === 'object' ? linkValue : {};
    const acc = visibleAccount(req, accountId);
    if (!acc) continue;

    let folder = String(link.folder || '');
    let uid = String(link.uid || '');
    const messageId = String(link.messageId || (stableId.startsWith('<') ? stableId : ''));

    if (!uid) {
      for (const cached of cacheByAccountStmt.all(acc.id)) {
        let env = null;
        try { env = JSON.parse(cached.env_json || '{}'); } catch (_e) { env = null; }
        if (!env) continue;
        if ((messageId && String(env.messageId || '') === messageId) || (!messageId && String(env.uid || '') === stableId)) {
          uid = String(cached.uid || env.uid || '');
          folder = String(cached.folder || folder);
          break;
        }
      }
    }

    try {
      const engine = engineFor(acc);
      if (!uid && messageId) {
        if (acc.kind === 'microsoft') {
          uid = String(await engine.findByMessageId(acc, '', messageId) || '');
          folder = folder || 'inbox';
        } else {
          const folders = await engine.listFolders(acc);
          for (const candidate of (folders || []).filter((f) => f && f.path && !f.noSelect).slice(0, 60)) {
            uid = String(await engine.findByMessageId(acc, candidate.path, messageId) || '');
            if (uid) { folder = candidate.path; break; }
          }
        }
      }
      if (!uid) { unresolved++; continue; }
      const message = await engine.getMessage(acc, folder || 'INBOX', uid);
      messages.push({
        ...message,
        accountId: acc.id,
        accountLabel: acc.label || acc.email || acc.id,
        folder: folder || 'INBOX',
        uid,
        caseId,
        caseLabel: String(link.caseLabel || caseId)
      });
    } catch (_e) { unresolved++; }
  }

  messages.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  res.json({ messages, unresolved });
});

router.get('/accounts/:id/messages', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  const folder = String(req.query.folder || 'INBOX');
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const q = String(req.query.q || '').trim();
  try {
    const result = await engineFor(acc).listMessages(acc, folder, { offset, limit, search: q, sinceDays: q ? 0 : (acc.sync_window_days || 0) });
    // Envelope-Cache mitschreiben (nur ohne Suche) - fuer schnelles Wiederanzeigen + Offline-Rueckfall.
    if (!q && result && Array.isArray(result.messages)) { try { cacheUpsert(acc.id, folder, result.messages); } catch (_e) { /* Cache ist Beiwerk */ } }
    res.json(result);
  } catch (error) {
    // Live-Abruf fehlgeschlagen -> falls Cache vorhanden, diesen liefern (Offline-Rueckfall).
    const cached = q ? [] : cacheList(acc.id, folder, limit + offset);
    if (cached.length) return res.json({ total: cached.length, messages: cached.slice(offset, offset + limit), cached: true });
    res.status(400).json({ error: error.message || 'Nachrichten konnten nicht geladen werden.' });
  }
});

// Reiner Cache-Abruf (Offline/Sofortanzeige).
router.get('/accounts/:id/cache', (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  const folder = String(req.query.folder || 'INBOX');
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  res.json({ messages: cacheList(acc.id, folder, limit), cached: true });
});

router.get('/accounts/:id/message', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  try {
    const message = await engineFor(acc).getMessage(acc, String(req.query.folder || 'INBOX'), String(req.query.uid || ''));
    res.json({ message });
  } catch (error) { res.status(400).json({ error: error.message || 'Nachricht konnte nicht geladen werden.' }); }
});

router.get('/accounts/:id/attachment', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  try {
    const att = await engineFor(acc).getAttachment(acc, String(req.query.folder || 'INBOX'), String(req.query.uid || ''), Math.max(0, parseInt(req.query.idx, 10) || 0));
    res.set('Content-Type', att.contentType);
    const disposition = req.query.inline === '1' ? 'inline' : 'attachment';
    res.set('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(att.filename)}`);
    res.send(att.content);
  } catch (error) { res.status(400).json({ error: error.message || 'Anhang konnte nicht geladen werden.' }); }
});

router.post('/accounts/:id/flags', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  try {
    res.json(await engineFor(acc).setFlags(acc, String(req.body?.folder || 'INBOX'), String(req.body?.uid || ''), { seen: req.body?.seen, flagged: req.body?.flagged }));
  } catch (error) { res.status(400).json({ error: error.message || 'Markierung fehlgeschlagen.' }); }
});

router.post('/accounts/:id/move', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  try {
    const folder = String(req.body?.folder || 'INBOX');
    const uid = String(req.body?.uid || '');
    const target = String(req.body?.target || '');
    const result = await engineFor(acc).moveMessage(acc, folder, uid, target);
    cacheRemove(acc.id, folder, uid);
    cacheClear(acc.id, target);
    res.json(result);
  } catch (error) { res.status(400).json({ error: error.message || 'Verschieben fehlgeschlagen.' }); }
});

// Roh-Mail als .eml (Dokumentationspflicht/Fallakte).
router.get('/accounts/:id/raw', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  try {
    const raw = await engineFor(acc).getRaw(acc, String(req.query.folder || 'INBOX'), String(req.query.uid || ''));
    const name = String(req.query.name || 'nachricht').replace(/[^\wäöüÄÖÜß .-]+/g, '_').slice(0, 120) || 'nachricht';
    res.set('Content-Type', 'message/rfc822');
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name + '.eml')}`);
    res.send(raw);
  } catch (error) { res.status(400).json({ error: error.message || 'E-Mail-Datei konnte nicht geladen werden.' }); }
});

// Farbige Labels (Slot 1-6): IMAP-Keyword MXLabel<n> bzw. Graph-Kategorie mit Namen.
router.post('/accounts/:id/label', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  const slot = Math.min(6, Math.max(1, Number(req.body?.slot) || 1));
  try {
    res.json(await engineFor(acc).setLabel(acc, String(req.body?.folder || 'INBOX'), String(req.body?.uid || ''), slot, !!req.body?.on, String(req.body?.name || '')));
  } catch (error) { res.status(400).json({ error: error.message || 'Label konnte nicht gesetzt werden.' }); }
});

// Wiedervorlage (Snooze): Mail in den "Wiedervorlage"-Ordner verschieben; der Scheduler holt sie
// zum Zeitpunkt per Message-ID zurueck in den Posteingang (auch bei geschlossenem Browser).
router.post('/accounts/:id/snooze', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  const wakeAt = String(req.body?.wakeAt || '').trim();
  const messageId = String(req.body?.messageId || '').trim();
  if (!wakeAt || isNaN(Date.parse(wakeAt))) return res.status(400).json({ error: 'Bitte einen gültigen Zeitpunkt angeben.' });
  if (!messageId) return res.status(400).json({ error: 'Die Nachricht hat keine Message-ID – Wiedervorlage nicht möglich.' });
  try {
    const engine = engineFor(acc);
    let snoozeFolder;
    if (acc.kind === 'microsoft') {
      const folders = await engine.listFolders(acc);
      const existing = folders.find((f) => f.name === 'Wiedervorlage');
      snoozeFolder = existing ? existing.path : (await graphEngine.createFolder(acc, 'Wiedervorlage')).path;
    } else {
      const folders = await engine.listFolders(acc);
      if (!folders.some((f) => f.path === 'Wiedervorlage')) await imapEngine.createFolder(acc, 'Wiedervorlage');
      snoozeFolder = 'Wiedervorlage';
    }
    const folder = String(req.body?.folder || 'INBOX');
    const uid = String(req.body?.uid || '');
    await engine.moveMessage(acc, folder, uid, snoozeFolder);
    cacheRemove(acc.id, folder, uid);
    cacheClear(acc.id, snoozeFolder);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO mail_snoozes (id, account_id, folder, message_id, subject, wake_at, owner_user_id) VALUES (?,?,?,?,?,?,?)")
      .run(id, acc.id, snoozeFolder, messageId, String(req.body?.subject || '').slice(0, 255), new Date(wakeAt).toISOString(), req.session.userId);
    res.json({ ok: true, id, wakeAt: new Date(wakeAt).toISOString() });
  } catch (error) { res.status(400).json({ error: error.message || 'Wiedervorlage fehlgeschlagen.' }); }
});

router.get('/snoozes', (req, res) => {
  const rows = db.prepare('SELECT * FROM mail_snoozes WHERE owner_user_id = ? ORDER BY wake_at').all(req.session.userId);
  res.json({ snoozes: rows.map((r) => ({ id: r.id, accountId: r.account_id, subject: r.subject, wakeAt: r.wake_at })) });
});

router.delete('/snoozes/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM mail_snoozes WHERE id = ?').get(req.params.id);
  if (!r || r.owner_user_id !== req.session.userId) return res.status(404).json({ error: 'Wiedervorlage nicht gefunden.' });
  db.prepare('DELETE FROM mail_snoozes WHERE id = ?').run(r.id);
  res.json({ ok: true });
});

// Abwesenheitsnotiz - nur Microsoft (Graph mailboxSettings); IMAP-Anbieter erlauben keine
// Fernsteuerung, der Client zeigt dort einen Hinweis.
router.get('/accounts/:id/autoreply', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  if (acc.kind !== 'microsoft') return res.status(400).json({ error: 'Abwesenheitsnotizen sind nur bei Microsoft-365-Konten fernsteuerbar.' });
  try { res.json({ autoreply: await graphEngine.getAutoReply(acc) }); }
  catch (error) { res.status(400).json({ error: error.message || 'Abwesenheitsnotiz konnte nicht geladen werden.' }); }
});

router.put('/accounts/:id/autoreply', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  if (!canEdit(acc, req)) return res.status(403).json({ error: 'Nur der Eigentümer (oder ein Admin) darf die Abwesenheitsnotiz ändern.' });
  if (acc.kind !== 'microsoft') return res.status(400).json({ error: 'Abwesenheitsnotizen sind nur bei Microsoft-365-Konten fernsteuerbar.' });
  try { res.json(await graphEngine.setAutoReply(acc, req.body?.autoreply || {})); }
  catch (error) { res.status(400).json({ error: error.message || 'Abwesenheitsnotiz konnte nicht gespeichert werden.' }); }
});

router.post('/accounts/:id/message-delete', async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  try {
    const folder = String(req.body?.folder || 'INBOX');
    const uid = String(req.body?.uid || '');
    const result = await engineFor(acc).deleteMessage(acc, folder, uid);
    cacheRemove(acc.id, folder, uid);
    if (result?.target) cacheClear(acc.id, result.target);
    res.json(result);
  } catch (error) { res.status(400).json({ error: error.message || 'Löschen fehlgeschlagen.' }); }
});

// ---- Versand --------------------------------------------------------------------------------

function parseSendBody(body) {
  const b = body || {};
  const attachments = [];
  for (const extra of b.attachments || []) {
    if (!extra || !extra.filename || !extra.dataBase64) continue;
    try { attachments.push({ filename: extra.filename, mimeType: extra.mimeType || 'application/octet-stream', content: Buffer.from(extra.dataBase64, 'base64') }); }
    catch (_e) { /* kaputte Anlage ueberspringen */ }
  }
  return {
    to: String(b.to || '').trim(), cc: String(b.cc || '').trim(), bcc: String(b.bcc || '').trim(),
    subject: String(b.subject || ''), html: String(b.html || ''), text: String(b.text || ''), attachments,
    pdfKennwort: String(b.pdfKennwort || '').trim(),
    priority: b.priority === 'high' ? 'high' : (b.priority === 'low' ? 'low' : 'normal')
  };
}

function splitAddresses(v) { return String(v || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean); }

router.post('/accounts/:id/send', requireSendMail, async (req, res) => {
  const acc = visibleAccount(req, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  const m = parseSendBody(req.body);
  if (!m.to) return res.status(400).json({ error: 'Empfänger-E-Mail-Adresse erforderlich.' });
  try {
    // Kennwortschutz VOR beiden Zweigen: der geplante Versand legt die Anlagen in der
    // Datenbank ab — dort dürfen nur bereits verschluesselte Bytes liegen, nie ein Kennwort.
    await schuetzePdfAnlagen(m.attachments, m.pdfKennwort);
  } catch (fehler) {
    return res.status(400).json({ error: fehler.message || 'PDF-Kennwortschutz fehlgeschlagen.' });
  }
  // "Später senden": gültiges Zukunfts-Datum -> als geplanter Entwurf ablegen, der Server-Scheduler
  // (mail-outbox.js) verschickt ihn fällig. Anlagen bleiben im data_json (base64) erhalten.
  const sendAt = String(req.body?.sendAt || '').trim();
  if (sendAt && !isNaN(Date.parse(sendAt)) && Date.parse(sendAt) > Date.now() + 20000) {
    const id = crypto.randomUUID();
    const data = { to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, html: m.html, text: m.text, attachments: m.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, dataBase64: a.content.toString('base64') })), dokuCase: String(req.body?.dokuCase || ''), replyTo: String(req.body?.replyTo || ''), priority: m.priority };
    db.prepare("INSERT INTO mail_drafts (id, account_id, kind, data_json, owner_user_id, send_at, updated_at) VALUES (?,?,'scheduled',?,?,?,datetime('now'))").run(id, acc.id, JSON.stringify(data), req.session.userId, new Date(sendAt).toISOString());
    return res.json({ ok: true, scheduled: true, id, sendAt: new Date(sendAt).toISOString() });
  }
  try {
    const result = await mailSend.sendViaAccount(acc, { to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, html: m.html, text: m.text, attachments: m.attachments, replyTo: String(req.body?.replyTo || ''), priority: m.priority });
    res.json(Object.assign({ ok: true }, result));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Mail konnte nicht gesendet werden.' });
  }
});

// ---- Entwuerfe / Postausgang (lokal in der Datenbank, einheitlich fuer alle Kontoarten) ------

const listDraftsStmt = db.prepare('SELECT * FROM mail_drafts WHERE owner_user_id = ? ORDER BY updated_at DESC');
const getDraftStmt = db.prepare('SELECT * FROM mail_drafts WHERE id = ?');

router.get('/drafts', (req, res) => {
  const drafts = listDraftsStmt.all(req.session.userId)
    .filter((d) => !req.query.accountId || d.account_id === String(req.query.accountId))
    .map((d) => { let data = {}; try { data = JSON.parse(d.data_json || '{}'); } catch (_e) { /* leer lassen */ } return { id: d.id, accountId: d.account_id, kind: d.kind, updatedAt: d.updated_at, sendAt: d.send_at || '', data }; });
  res.json({ drafts });
});

router.post('/drafts', (req, res) => {
  const kind = req.body?.kind === 'outbox' ? 'outbox' : 'draft';
  const accountId = String(req.body?.accountId || '');
  const dataJson = JSON.stringify(req.body?.data || {});
  const existing = req.body?.id ? getDraftStmt.get(String(req.body.id)) : null;
  if (existing && existing.owner_user_id === req.session.userId) {
    db.prepare("UPDATE mail_drafts SET account_id = ?, kind = ?, data_json = ?, updated_at = datetime('now') WHERE id = ?").run(accountId, kind, dataJson, existing.id);
    return res.json({ id: existing.id });
  }
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO mail_drafts (id, account_id, kind, data_json, owner_user_id, updated_at) VALUES (?,?,?,?,?,datetime('now'))").run(id, accountId, kind, dataJson, req.session.userId);
  res.status(201).json({ id });
});

router.delete('/drafts/:id', (req, res) => {
  const d = getDraftStmt.get(req.params.id);
  if (!d || d.owner_user_id !== req.session.userId) return res.status(404).json({ error: 'Entwurf nicht gefunden.' });
  db.prepare('DELETE FROM mail_drafts WHERE id = ?').run(d.id);
  res.json({ ok: true });
});

// ---- Persönliche Mail-Einstellungen (Tier 1-3) --------------------------------------------

const getPrefsStmt = db.prepare('SELECT prefs_json FROM mail_prefs WHERE user_id = ?');
const upsertPrefsStmt = db.prepare("INSERT INTO mail_prefs (user_id, prefs_json, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = datetime('now')");
const PREF_DEFAULTS = { sendDelay: 0, defaultAccountId: '', quoteStyle: 'top', signaturePosition: 'above', attachmentWarning: true, externalWarning: false, defaultBcc: '', archiveToDoku: false, personalSignature: '', notifyMail: true, notifyEvents: true, notifyTasks: true, notifyFristen: true, digestMode: 'firstStart', digestTime: '09:00' };
/* fristenVorlauf steht BEWUSST nicht in den Defaults: nur ein gespeicherter Wert ist eine
   eigene Wahl. Fehlt er, gilt die Buerovorgabe bzw. 7 - siehe __fristenVorlaufTage(). */

router.get('/prefs', (req, res) => {
  let val = {}; try { val = JSON.parse(getPrefsStmt.get(req.session.userId)?.prefs_json || '{}'); } catch (_e) { val = {}; }
  res.json({ prefs: Object.assign({}, PREF_DEFAULTS, val) });
});

/* Pruefer je Schluessel. Ein PUT aendert NUR die mitgeschickten Schluessel (Teil-Merge) -
   vorher ersetzte jeder PUT den ganzen Datensatz, und der Sanitizer fuellte Fehlendes mit
   Defaults. Das hatte zwei belegte Folgen (Review 27.08.2026): das alte Mail-Panel kennt
   'fristenVorlauf' nicht und setzte ihn bei jedem Speichern auf 7 zurueck, und ein magerer
   PUT (etwa ein einzelner Benachrichtigungs-Schalter nach einem fehlgeschlagenen GET)
   loeschte stillschweigend Signatur, Bcc und Sendeverzoegerung. */
const PREF_PRUEFER = {
  sendDelay: (v) => ([0, 5, 10, 15, 30, 60].includes(Number(v)) ? Number(v) : 0),
  defaultAccountId: (v) => String(v || ''),
  quoteStyle: (v) => (v === 'bottom' ? 'bottom' : 'top'),
  signaturePosition: (v) => (v === 'below' ? 'below' : 'above'),
  attachmentWarning: (v) => v !== false,
  externalWarning: (v) => !!v,
  defaultBcc: (v) => String(v || '').trim(),
  archiveToDoku: (v) => !!v,
  personalSignature: (v) => String(v || ''),
  notifyMail: (v) => v !== false,
  notifyEvents: (v) => v !== false,
  notifyTasks: (v) => v !== false,
  notifyFristen: (v) => v !== false,
  digestMode: (v) => (v === 'fixed' ? 'fixed' : 'firstStart'),
  digestTime: (v) => (/^\d{2}:\d{2}$/.test(String(v || '')) ? String(v) : '09:00'),
  /* Wie viele Tage im Voraus eine Frist als dringend gilt und in die Tagesmeldung kommt.
     War bis 27.08.2026 an zwei Stellen hart auf 7 verdrahtet. 1-60 Tage; null/'' LOESCHT den
     Wert wieder, damit "der Buerovorgabe folgen" ein erreichbarer Zustand bleibt. */
  fristenVorlauf: (v) => ((Number(v) >= 1 && Number(v) <= 60) ? Math.round(Number(v)) : undefined)
};

router.put('/prefs', (req, res) => {
  const p = req.body?.prefs || {};
  let bestand = {};
  try { bestand = JSON.parse(getPrefsStmt.get(req.session.userId)?.prefs_json || '{}'); } catch (_e) { bestand = {}; }
  const clean = Object.assign({}, bestand);
  for (const [key, pruefe] of Object.entries(PREF_PRUEFER)) {
    if (!Object.prototype.hasOwnProperty.call(p, key)) continue;
    const wert = pruefe(p[key]);
    if (wert === undefined) delete clean[key];
    else clean[key] = wert;
  }
  upsertPrefsStmt.run(req.session.userId, JSON.stringify(clean));
  res.json({ ok: true, prefs: Object.assign({}, PREF_DEFAULTS, clean) });
});

// ---- E-Mail-Vorlagen (privat/büroweit, wie Konten) ----------------------------------------

const listTemplatesStmt = db.prepare('SELECT * FROM mail_templates ORDER BY sort_order, name COLLATE NOCASE');
const getTemplateStmt = db.prepare('SELECT * FROM mail_templates WHERE id = ?');
function tplVisible(t, req) { return t.visibility !== 'private' || t.owner_user_id === req.session.userId; }
function tplEditable(t, req) { return t.owner_user_id === req.session.userId || isAdmin(req); }
function publicTemplate(t) { return { id: t.id, name: t.name, subject: t.subject, body: t.body, visibility: t.visibility === 'public' ? 'public' : 'private', ownerUserId: t.owner_user_id == null ? null : t.owner_user_id }; }

router.get('/templates', (req, res) => {
  res.json({ templates: listTemplatesStmt.all().filter((t) => tplVisible(t, req)).map(publicTemplate) });
});

router.post('/templates', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Bitte einen Namen für die Vorlage angeben.' });
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO mail_templates (id, name, subject, body, owner_user_id, visibility, sort_order) VALUES (?,?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM mail_templates))")
    .run(id, name, String(b.subject || ''), String(b.body || ''), req.session.userId, b.visibility === 'public' ? 'public' : 'private');
  res.status(201).json({ id, template: publicTemplate(getTemplateStmt.get(id)) });
});

router.put('/templates/:id', (req, res) => {
  const t = getTemplateStmt.get(req.params.id);
  if (!t || !tplVisible(t, req)) return res.status(404).json({ error: 'Vorlage nicht gefunden.' });
  if (!tplEditable(t, req)) return res.status(403).json({ error: 'Nur der Eigentümer (oder ein Admin) darf diese Vorlage ändern.' });
  const b = req.body || {};
  db.prepare("UPDATE mail_templates SET name = ?, subject = ?, body = ?, visibility = ?, updated_at = datetime('now') WHERE id = ?")
    .run(String(b.name ?? t.name).trim() || t.name, String(b.subject ?? t.subject), String(b.body ?? t.body), b.visibility === 'public' ? 'public' : (b.visibility === 'private' ? 'private' : t.visibility), t.id);
  res.json({ template: publicTemplate(getTemplateStmt.get(t.id)) });
});

router.delete('/templates/:id', (req, res) => {
  const t = getTemplateStmt.get(req.params.id);
  if (!t || !tplVisible(t, req)) return res.status(404).json({ error: 'Vorlage nicht gefunden.' });
  if (!tplEditable(t, req)) return res.status(403).json({ error: 'Nur der Eigentümer (oder ein Admin) darf diese Vorlage löschen.' });
  db.prepare('DELETE FROM mail_templates WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// ---- Eingangs-Regeln (Tier 3) -------------------------------------------------------------

const listRulesStmt = db.prepare('SELECT * FROM mail_rules ORDER BY sort_order, created_at');
const getRuleStmt = db.prepare('SELECT * FROM mail_rules WHERE id = ?');
function ruleVisible(r, req) { return r.visibility !== 'private' || r.owner_user_id === req.session.userId; }
function ruleEditable(r, req) { return r.owner_user_id === req.session.userId || isAdmin(req); }
function publicRule(r) {
  return {
    id: r.id, visibility: r.visibility === 'public' ? 'public' : 'private', accountId: r.account_id || '',
    enabled: !!r.enabled, matchField: r.match_field, matchOp: r.match_op, matchValue: r.match_value,
    action: r.action, actionTarget: r.action_target, ownerUserId: r.owner_user_id == null ? null : r.owner_user_id
  };
}
function ruleFromBody(b, keep) {
  const k = keep || {};
  return {
    account_id: String(b.accountId ?? k.account_id ?? '').trim(),
    enabled: (b.enabled != null ? b.enabled : (k.enabled !== 0)) ? 1 : 0,
    match_field: ['from', 'to', 'subject'].includes(b.matchField) ? b.matchField : (k.match_field || 'from'),
    match_op: ['contains', 'equals', 'domain'].includes(b.matchOp) ? b.matchOp : (k.match_op || 'contains'),
    match_value: String(b.matchValue ?? k.match_value ?? '').trim(),
    action: ['move', 'markRead', 'flag'].includes(b.action) ? b.action : (k.action || 'move'),
    action_target: String(b.actionTarget ?? k.action_target ?? '').trim(),
    visibility: (b.visibility ?? k.visibility) === 'public' ? 'public' : 'private'
  };
}

router.get('/rules', (req, res) => {
  res.json({ rules: listRulesStmt.all().filter((r) => ruleVisible(r, req)).map(publicRule) });
});

router.post('/rules', (req, res) => {
  const d = ruleFromBody(req.body || {});
  if (!d.match_value) return res.status(400).json({ error: 'Bitte einen Suchwert für die Regel angeben.' });
  if (d.action === 'move' && !d.action_target) return res.status(400).json({ error: 'Für „Verschieben" bitte einen Zielordner angeben.' });
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO mail_rules (id, owner_user_id, visibility, account_id, enabled, match_field, match_op, match_value, action, action_target, sort_order)
    VALUES (@id,@owner,@visibility,@account_id,@enabled,@match_field,@match_op,@match_value,@action,@action_target,(SELECT COALESCE(MAX(sort_order),0)+1 FROM mail_rules))`)
    .run({ id, owner: req.session.userId, ...d });
  res.status(201).json({ id, rule: publicRule(getRuleStmt.get(id)) });
});

router.put('/rules/:id', (req, res) => {
  const r = getRuleStmt.get(req.params.id);
  if (!r || !ruleVisible(r, req)) return res.status(404).json({ error: 'Regel nicht gefunden.' });
  if (!ruleEditable(r, req)) return res.status(403).json({ error: 'Nur der Eigentümer (oder ein Admin) darf diese Regel ändern.' });
  const d = ruleFromBody(req.body || {}, r);
  db.prepare(`UPDATE mail_rules SET account_id=@account_id, enabled=@enabled, match_field=@match_field, match_op=@match_op,
    match_value=@match_value, action=@action, action_target=@action_target, visibility=@visibility WHERE id=@id`).run({ id: r.id, ...d });
  res.json({ rule: publicRule(getRuleStmt.get(r.id)) });
});

router.delete('/rules/:id', (req, res) => {
  const r = getRuleStmt.get(req.params.id);
  if (!r || !ruleVisible(r, req)) return res.status(404).json({ error: 'Regel nicht gefunden.' });
  if (!ruleEditable(r, req)) return res.status(403).json({ error: 'Nur der Eigentümer (oder ein Admin) darf diese Regel löschen.' });
  db.prepare('DELETE FROM mail_rules WHERE id = ?').run(r.id);
  res.json({ ok: true });
});

module.exports = router;
