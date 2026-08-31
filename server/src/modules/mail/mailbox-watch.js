// Mail-Push fuer den E-Mail-Baustein (Nutzerwunsch 2026-07-18: "Push-Benachrichtigung bei neuer
// Mail"): der Server haelt je IMAP-Konto EINE dedizierte Beobachter-Verbindung auf dem Posteingang
// offen (ImapFlow geht automatisch in IDLE und meldet exists/expunge/flags), Microsoft-Konten
// werden alle 60 s ueber Graph abgefragt (Webhooks braeuchten eine oeffentliche URL). Aenderungen
// gehen als Server-Sent-Events an alle angemeldeten Browser (/api/mailbox/events): 'mail' bei
// neuen Nachrichten (Toast/System-Benachrichtigung im Client), 'update' bei reinen Zaehler-
// Aenderungen (Badge-Abgleich), 'snapshot' beim Verbinden. Sichtbarkeit wie ueberall: private
// Konten nur fuer den Eigentuemer. MAILBOX_WATCH=0 schaltet die Beobachter ab (Tests).

const db = require('../../database/index');
const { ImapFlow } = require('imapflow');
const cryptoHelper = require('../../security/crypto');
const graphEngine = require('../../integrations/mail/microsoft-graph');
const imapEngine = require('../../integrations/mail/imap');
const applicationWriteBarrier = require('../../middleware/application-write-barrier');

const DISABLED = process.env.MAILBOX_WATCH === '0';
const listAccountsStmt = db.prepare('SELECT * FROM mail_accounts');
const listRulesStmt = db.prepare('SELECT * FROM mail_rules WHERE enabled = 1 ORDER BY sort_order, created_at');

const state = new Map();   // accountId -> { acc, credKey, unseen, total, init, gen, failures, client, timer, retry, deb, nextTryAt }
const subs = new Set();    // { res, userId }
let hbTimer = null;

// 'new' = mehr Nachrichten ODER mehr Ungelesene (loest die Benachrichtigung aus),
// 'update' = sonstige Zaehler-Aenderung (Badge-Abgleich), null = nichts zu melden.
function _diff(prev, next) {
  if (!next) return null;
  if (!prev) return 'update';
  if (next.total > prev.total || next.unseen > prev.unseen) return 'new';
  if (next.total !== prev.total || next.unseen !== prev.unseen) return 'update';
  return null;
}

function canSee(acc, userId) { return acc.visibility !== 'private' || acc.owner_user_id === userId; }

function writeEvent(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_e) { /* Verbindung weg - close raeumt auf */ }
}

function broadcast(entry, event, extra) {
  const payload = Object.assign({ accountId: entry.acc.id, unseen: entry.unseen || 0, total: entry.total || 0 }, extra || {});
  for (const sub of subs) if (canSee(entry.acc, sub.userId)) writeEvent(sub.res, event, payload);
}

function setCounts(entry, unseen, total) {
  const prev = entry.init ? { unseen: entry.unseen, total: entry.total } : null;
  entry.unseen = Number(unseen) || 0;
  entry.total = Number(total) || 0;
  if (!entry.init) { entry.init = true; broadcast(entry, 'update'); return null; }
  const kind = _diff(prev, { unseen: entry.unseen, total: entry.total });
  if (kind === 'new') broadcast(entry, 'mail', { newCount: Math.max(1, entry.total - prev.total) });
  else if (kind === 'update') broadcast(entry, 'update');
  return kind;
}

// ---- Eingangs-Regeln (Tier 3) ---------------------------------------------------------------
// Eine Regel gilt für ein Konto, wenn account_id passt ('' = alle) UND sie sichtbar ist (büroweit
// immer; privat nur für Konten des Regel-Eigentümers). Angewendet wird beim ECHTEN Neueingang
// (kind==='new'), nicht beim Erst-Snapshot - so wird der Bestand nicht rückwirkend umsortiert.
function rulesFor(acc) {
  let rows = [];
  try { rows = listRulesStmt.all(); } catch (_e) { return []; }
  return rows.filter((r) => (!r.account_id || r.account_id === acc.id)
    && (r.visibility !== 'private' || r.owner_user_id === acc.owner_user_id));
}
function ruleMatches(rule, msg) {
  const val = String(rule.match_value || '').toLowerCase().trim();
  if (!val) return false;
  let hay = '';
  if (rule.match_field === 'subject') hay = String(msg.subject || '');
  else if (rule.match_field === 'to') hay = (msg.to || []).map((a) => a.address + ' ' + (a.name || '')).join(' ');
  else hay = ((msg.from && (msg.from.address + ' ' + (msg.from.name || ''))) || '');
  hay = hay.toLowerCase();
  if (rule.match_op === 'equals') {
    const addr = rule.match_field === 'subject' ? String(msg.subject || '').toLowerCase().trim() : String((msg.from && msg.from.address) || '').toLowerCase().trim();
    return addr === val;
  }
  if (rule.match_op === 'domain') {
    const addr = String((msg.from && msg.from.address) || '').toLowerCase();
    const dom = val.replace(/^@/, '');
    return addr.endsWith('@' + dom) || addr.endsWith('.' + dom);
  }
  return hay.includes(val);
}
async function applyRules(entry) {
  const acc = entry.acc;
  const rules = rulesFor(acc);
  if (!rules.length) return;
  const engine = acc.kind === 'microsoft' ? graphEngine : imapEngine;
  const inbox = acc.kind === 'microsoft' ? 'inbox' : 'INBOX';
  entry.ruleSeen = entry.ruleSeen || new Set();
  let messages = [];
  try { messages = (await engine.listMessages(acc, inbox, { offset: 0, limit: 25 })).messages || []; } catch (_e) { return; }
  for (const msg of messages) {
    if (msg.seen) continue;                                  // nur ungelesene = neu eingegangen
    const key = String(msg.uid);
    if (entry.ruleSeen.has(key)) continue;                   // schon verarbeitet (gegen Doppel-Flag)
    const rule = rules.find((r) => ruleMatches(r, msg));
    if (!rule) { entry.ruleSeen.add(key); continue; }
    try {
      if (rule.action === 'move' && rule.action_target) await engine.moveMessage(acc, inbox, msg.uid, rule.action_target);
      else if (rule.action === 'markRead') await engine.setFlags(acc, inbox, msg.uid, { seen: true });
      else if (rule.action === 'flag') await engine.setFlags(acc, inbox, msg.uid, { flagged: true });
    } catch (_e) { /* Aktion fehlgeschlagen - beim nächsten Neueingang erneut versucht */ }
    entry.ruleSeen.add(key);
  }
  if (entry.ruleSeen.size > 500) entry.ruleSeen = new Set([...entry.ruleSeen].slice(-250));
}

// ---- IMAP-Beobachter (dedizierte Verbindung, auto-IDLE) -------------------------------------

function scheduleRestart(entry) {
  entry.failures = (entry.failures || 0) + 1;
  const delay = Math.min(30000 * Math.pow(2, entry.failures - 1), 900000);
  const t = setTimeout(() => { if (state.get(entry.acc.id) === entry) startImap(entry); }, delay);
  t.unref?.();
  entry.retry = t;
}

async function startImap(entry) {
  const gen = ++entry.gen;
  const acc = entry.acc;
  if (!acc.imap_host || !acc.imap_user) return;
  let client;
  try {
    client = new ImapFlow({
      host: acc.imap_host, port: Number(acc.imap_port) || 993, secure: acc.imap_secure !== 0,
      auth: { user: acc.imap_user, pass: cryptoHelper.decrypt(acc.imap_pass_encrypted || '') },
      logger: false, connectionTimeout: 20000
    });
    entry.client = client;
    client.on('error', () => { /* 'close' folgt und plant den Neustart */ });
    client.on('close', () => { if (entry.gen === gen && state.get(acc.id) === entry) scheduleRestart(entry); });
    await client.connect();
    await client.mailboxOpen('INBOX');
    entry.failures = 0;
    const recompute = async () => {
      if (entry.gen !== gen || !client.usable) return;
      try {
        const unseenSeqs = await client.search({ seen: false });
        const kind = setCounts(entry, Array.isArray(unseenSeqs) ? unseenSeqs.length : 0, client.mailbox ? (client.mailbox.exists || 0) : 0);
        if (kind === 'new') applyRules(entry).catch(() => { /* Regeln sind Beiwerk */ });
      } catch (_e) { /* Verbindungsproblem - der close-Handler uebernimmt */ }
    };
    // Ereignis-Stuerme (Mail-Eingang in Schueben) auf EINE Neuberechnung buendeln.
    const debounced = () => { if (entry.deb) clearTimeout(entry.deb); entry.deb = setTimeout(recompute, 1200); entry.deb.unref?.(); };
    client.on('exists', debounced);
    client.on('expunge', debounced);
    client.on('flags', debounced);
    await recompute();
  } catch (_e) {
    try { client && client.close(); } catch (_e2) { /* egal */ }
    if (entry.gen === gen && state.get(acc.id) === entry) scheduleRestart(entry);
  }
}

// ---- Graph-Beobachter (60-s-Poll mit Backoff) -----------------------------------------------

function startGraph(entry) {
  const poll = async () => {
    if (state.get(entry.acc.id) !== entry) return;
    if (entry.nextTryAt && Date.now() < entry.nextTryAt) return;
    if (entry.polling) return;
    entry.polling = true;
    try {
      const guarded = await applicationWriteBarrier.withWrite(
        'Automatische Microsoft-Postfachprüfung',
        async () => {
          const st = await graphEngine.inboxStatus(entry.acc);
          const kind = setCounts(entry, st.unseen || 0, st.messages || 0);
          /*
           * Graph-Regeln können beim Lazy-Tokenrefresh die verschlüsselte
           * Verbindung in SQLite aktualisieren. Deshalb gehören auch sie in
           * denselben Write-Kontext und dürfen nicht fire-and-forget hinter
           * dessen Ende weiterlaufen.
           */
          if (kind === 'new') await applyRules(entry);
          return st;
        }
      );
      if (guarded.skipped) return;
      entry.failures = 0; entry.nextTryAt = 0;
    } catch (_e) {
      entry.failures = (entry.failures || 0) + 1;
      entry.nextTryAt = Date.now() + Math.min(120000 * entry.failures, 900000);
    } finally {
      entry.polling = false;
    }
  };
  const t0 = setTimeout(poll, 3000); t0.unref?.();
  entry.timer = setInterval(poll, 60000); entry.timer.unref?.();
}

// ---- Lebenszyklus ---------------------------------------------------------------------------

function stopEntry(entry) {
  entry.gen = (entry.gen || 0) + 1;
  if (entry.timer) clearInterval(entry.timer);
  if (entry.retry) clearTimeout(entry.retry);
  if (entry.deb) clearTimeout(entry.deb);
  const c = entry.client;
  entry.client = null;
  if (c) c.logout().catch(() => { try { c.close(); } catch (_e) { /* egal */ } });
}

// Nach jedem Konten-CRUD aufgerufen: entfernte Konten stoppen, neue/gaenderte neu verbinden.
function refreshAccounts() {
  let rows = [];
  try { rows = listAccountsStmt.all(); } catch (_e) { rows = []; }
  const keep = new Set(rows.map((r) => r.id));
  for (const [id, entry] of state) { if (!keep.has(id)) { stopEntry(entry); state.delete(id); } }
  for (const acc of rows) {
    const credKey = [acc.kind, acc.imap_host, acc.imap_port, acc.imap_secure, acc.imap_user, acc.imap_pass_encrypted, acc.graph_connection_id].join('|');
    const prev = state.get(acc.id);
    if (prev && prev.credKey === credKey) { prev.acc = acc; continue; }
    if (prev) stopEntry(prev);
    const entry = { acc, credKey, unseen: 0, total: 0, init: false, gen: 0, failures: 0 };
    state.set(acc.id, entry);
    if (!DISABLED) { if (acc.kind === 'microsoft') startGraph(entry); else startImap(entry); }
  }
}

// ---- SSE-Anschluss --------------------------------------------------------------------------

function subscribe(req, res) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  const sub = { res, userId: req.session.userId };
  const accounts = {};
  for (const entry of state.values()) if (canSee(entry.acc, sub.userId)) accounts[entry.acc.id] = { unseen: entry.unseen || 0, total: entry.total || 0 };
  writeEvent(res, 'snapshot', { accounts });
  subs.add(sub);
  if (!hbTimer) { hbTimer = setInterval(() => { for (const s of subs) { try { s.res.write(':hb\n\n'); } catch (_e) { /* close raeumt auf */ } } }, 30000); hbTimer.unref?.(); }
  req.on('close', () => subs.delete(sub));
}

try { refreshAccounts(); } catch (_e) { /* Tabelle fehlt nur bei ganz alten DB-Staenden */ }

module.exports = { subscribe, refreshAccounts, _diff, rulesFor, ruleMatches, applyRules };
