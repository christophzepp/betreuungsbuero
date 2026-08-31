'use strict';
/* Demo-Modus (Nutzerauftrag 30.08.2026): ein vom Admin schaltbarer Vorführbetrieb.

   Bausteine:
   - Schalter in office_json['demo_modus'] ({an:true/false}) - der Admin schaltet ihn im
     Einstellungsmenü (Bereich „Demo-Modus"), die Login-Seite liest ihn sitzungsfrei über
     GET /api/setup/state (demoErlaubt).
   - Zwanzig feste Vorführkonten Demo1..Demo20 (Passwörter Demopasswort1..Demopasswort20),
     als ECHTE Nutzerzeilen mit is_demo=1: nur so funktioniert der Nutzerchat (der Chat
     hängt komplett an der users-Tabelle). Einschalten legt sie an bzw. aktiviert sie,
     Ausschalten deaktiviert sie und räumt ihre Chats ab.
   - Sichtbarkeitstrennung: Demo-Konten und echte Konten sehen einander NIRGENDS
     (Chat-Nutzerliste, Präsenz - gefiltert über is_demo in chat/routes.js und
     realtime/websocket.js).
   - GET /paket liefert einer Demo-Sitzung die fünf Vorführfälle samt Passfotos,
     Musterbüro-Stammdaten und Bürobeständen - der Browser hält alles nur im
     Arbeitsspeicher (Wegwerf-Ablage wie in der Außendienst-Datei).

   Der Router wird in index.js VOR app.use('/api', requireOnlineMode) montiert, weil
   /paket gerade NICHT-Online-Sitzungen (mode='demo') bedienen muss. Jede Route prüft
   deshalb selbst streng. */

const express = require('express');
const path = require('node:path');
const db = require('../../database/index');
const SERVER_ROOT_DEMO = path.resolve(__dirname, '..', '..', '..');
const { requireAuth, hashPassword } = require('../../middleware/authentication');

const router = express.Router();

const DEMO_ANZAHL = 20;
const SCHALTER_KEY = 'demo_modus';

const getSchalterStmt = db.prepare('SELECT data_json FROM office_json WHERE key = ?');
const putSchalterStmt = db.prepare(`INSERT INTO office_json (key, data_json, updated_by) VALUES (@key, @dataJson, @userId)
  ON CONFLICT(key) DO UPDATE SET data_json = @dataJson, updated_by = @userId, updated_at = datetime('now')`);
const getDemoUserStmt = db.prepare('SELECT id FROM users WHERE username = ?');
const insertDemoUserStmt = db.prepare(`INSERT INTO users (username, password_hash, display_name, allow_local, allow_online, is_admin, is_demo, active)
  VALUES (@username, @passwordHash, @displayName, 0, 0, @isAdmin, 1, 1)`);
const activateDemoUsersStmt = db.prepare('UPDATE users SET active = 1 WHERE is_demo = 1');
const deactivateDemoUsersStmt = db.prepare('UPDATE users SET active = 0 WHERE is_demo = 1');

function demoErlaubt() {
  try {
    const row = getSchalterStmt.get(SCHALTER_KEY);
    if (!row || !row.data_json) return false;
    return JSON.parse(row.data_json).an === true;
  } catch (_e) { return false; }
}

function demoPasswort(nr) { return 'Demopasswort' + nr; }
function demoAdminPasswort(nr) { return 'DemoAdminPasswort' + nr; }

/* Konten anlegen/aktivieren. Die Passwörter sind bewusst öffentlich und trivial.
   ZWEI Reihen (Nutzerentscheid 30.08.2026): Demo1..20 als normale Mitarbeitende und
   DemoAdmin1..20 mit Admin-Recht - damit die Vorführung BEIDE Sichten zeigen kann
   (Verwaltungsseiten wie Personen, Rollen und Bürovorgaben erscheinen nur für Admins,
   und ohne die zweite Reihe fehlten sie der Demo gegenüber dem Online-Modus).
   Das Admin-Recht wirkt ausschliesslich in der Oberfläche: Der Server lässt für
   Demo-Sitzungen ohnehin nur /chat, /demo und die Blanko-Vorlagen durch (requireOnlineMode),
   und der Demo-Schalter selbst verlangt zusätzlich eine ONLINE-Admin-Sitzung. Beide Reihen
   tragen is_demo=1 und bleiben damit im eigenen Chat-Kreis, getrennt von echten Konten. */
async function kontenBereitstellen() {
  for (let nr = 1; nr <= DEMO_ANZAHL; nr++) {
    for (const rolle of [
      { username: 'Demo' + nr, anzeige: 'Demo ' + nr, passwort: demoPasswort(nr), isAdmin: 0 },
      { username: 'DemoAdmin' + nr, anzeige: 'Demo-Admin ' + nr, passwort: demoAdminPasswort(nr), isAdmin: 1 }
    ]) {
      if (getDemoUserStmt.get(rolle.username)) continue;
      insertDemoUserStmt.run({
        username: rolle.username,
        passwordHash: await hashPassword(rolle.passwort),
        displayName: rolle.anzeige,
        isAdmin: rolle.isAdmin
      });
    }
  }
  activateDemoUsersStmt.run();
}

/* Chats der Demo-Konten restlos entfernen. Durch die Sichtbarkeitstrennung können an einer
   Demo-Unterhaltung nie echte Konten beteiligt sein - jede Unterhaltung MIT Demo-Teilnehmer
   ist eine reine Demo-Unterhaltung und darf weg. */
function demoChatsAufraeumen() {
  const ids = db.prepare(`SELECT DISTINCT p.conversation_id AS id
      FROM chat_participants p JOIN users u ON u.id = p.user_id
     WHERE u.is_demo = 1`).all().map((r) => r.id);
  const inList = ids.map(() => '?').join(',');
  if (ids.length) {
    /* REIHENFOLGE ist Pflicht (adversariale Prüfrunde 30.08.2026): foreign_keys steht auf ON,
       und chat_attachments hängt über message_id an chat_messages - NICHT über conversation_id.
       Die frühere Fassung löschte erst die Nachrichten (Fremdschlüssel-Verletzung, Abbruch des
       ganzen Vorgangs) und danach vergeblich über eine Spalte, die es dort gar nicht gibt.
       Folge: Sobald eine Vorführung EINEN Anhang enthielt, ließ sich der Demo-Modus nicht mehr
       ausschalten und die Anlagen blieben dauerhaft in der Betriebsdatenbank liegen.
       Deshalb: Anlagen zuerst, dann Nachrichten, dann Teilnehmer, dann Unterhaltungen. */
    db.prepare(`DELETE FROM chat_attachments WHERE message_id IN (
        SELECT id FROM chat_messages WHERE conversation_id IN (${inList}))`).run(...ids);
    db.prepare(`DELETE FROM chat_messages WHERE conversation_id IN (${inList})`).run(...ids);
    db.prepare(`DELETE FROM chat_participants WHERE conversation_id IN (${inList})`).run(...ids);
    db.prepare(`DELETE FROM chat_conversations WHERE id IN (${inList})`).run(...ids);
  }
  try { db.prepare('DELETE FROM chat_user_status WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)').run(); } catch (_e) {}
}

function requireOnlineAdmin(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (req.session.mode !== 'online') return res.status(403).json({ error: 'Der Demo-Schalter wird in der Online-Sitzung bedient.' });
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Nur Administratorinnen und Administratoren.' });
  next();
}

router.get('/schalter', requireOnlineAdmin, (req, res) => {
  res.json({ an: demoErlaubt(), konten: DEMO_ANZAHL });
});

router.put('/schalter', requireOnlineAdmin, async (req, res) => {
  const an = !!(req.body && req.body.an === true);
  try {
    if (an) {
      await kontenBereitstellen();
    } else {
      deactivateDemoUsersStmt.run();
      demoChatsAufraeumen();
    }
    putSchalterStmt.run({ key: SCHALTER_KEY, dataJson: JSON.stringify({ an }), userId: req.session.userId });
    /* Vorbauen, damit die erste Vorführ-Anmeldung nicht auf den Paketbau warten muss.
       Bewusst ohne await - der Schalter antwortet sofort, der Bau läuft nebenher. */
    if (an) paketBauen().catch(() => {});
    res.json({ an, konten: DEMO_ANZAHL });
  } catch (error) {
    res.status(500).json({ error: 'Der Demo-Schalter konnte nicht umgelegt werden: ' + (error.message || error) });
  }
});

/* Das Vorführpaket - nur für Demo-Sitzungen, und nur solange der Schalter an ist
   (ein Admin kann die Vorführung damit jederzeit „live" beenden).

   Der Bau läuft in einem KINDPROZESS (adversariale Prüfrunde 30.08.2026): Er legt eine
   Wegwerf-Datenbank an, seedet fünf Fälle und exportiert sie - mit execFileSync im
   Request-Handler stand dafür der gesamte Node-Eventloop still, also auch jede Anfrage
   JEDES echten Nutzers (gemessen rund 2-3 Sekunden, auf schwächeren Servern deutlich mehr).
   Zusätzlich teilen sich gleichzeitige Anfragen EINEN Lauf (paketLauf), und das Einschalten
   des Schalters stößt den Bau vor, damit die erste Anmeldung nicht warten muss. */
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const PAKET_SKRIPT = path.join(SERVER_ROOT_DEMO, 'tools', 'demo-faelle', 'paket.js');
let paketCache = null;
let paketLauf = null;
let paketStand = 0;
/* Der Cache hielt das Paket für die GESAMTE Serverlaufzeit - nach einer Änderung an den
   Vorführdaten sah man ohne Serverneustart weiter den alten Bestand (Nutzerfund 30.08.:
   „Weiter kein roter Punkt", obwohl der Paketbau ihn längst lieferte). Jetzt hängt der
   Cache an der jüngsten Änderungszeit der Quelldateien: Wird dort etwas angefasst, baut
   der nächste Abruf neu. Im Betrieb ändert sich dort nichts - der Cache greift also
   unverändert, nur eben nicht mehr über eine veraltete Fassung hinweg. */
function quellenStand() {
  let neuste = 0;
  try {
    const dir = path.dirname(PAKET_SKRIPT);
    const pruefe = (ordner) => {
      for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
        const voll = path.join(ordner, eintrag.name);
        if (eintrag.isDirectory()) { pruefe(voll); continue; }
        if (!/\.(?:js|json|jpe?g|png)$/i.test(eintrag.name)) continue;
        const st = fs.statSync(voll);
        if (st.mtimeMs > neuste) neuste = st.mtimeMs;
      }
    };
    pruefe(dir);
  } catch (_e) { /* nicht lesbar -> wie bisher cachen */ }
  return neuste;
}
function paketBauen() {
  const stand = quellenStand();
  if (paketCache && stand === paketStand) return Promise.resolve(paketCache);
  if (paketCache && stand !== paketStand) { paketCache = null; }
  paketStand = stand;
  if (paketLauf) return paketLauf;
  paketLauf = new Promise((fertig, fehler) => {
    execFile(process.execPath, [PAKET_SKRIPT, '--json'],
      { cwd: SERVER_ROOT_DEMO, maxBuffer: 64 * 1024 * 1024, timeout: 180000 },
      (err, stdout, stderr) => {
        paketLauf = null;
        if (err) return fehler(new Error(String(stderr || err.message || err).slice(0, 400)));
        try { paketCache = JSON.parse(stdout); fertig(paketCache); }
        catch (parseFehler) { fehler(new Error('Das Vorführpaket war nicht lesbar: ' + parseFehler.message)); }
      });
  });
  return paketLauf;
}
router.get('/paket', requireAuth, async (req, res) => {
  if (req.session.mode !== 'demo') return res.status(403).json({ error: 'Das Vorführpaket gibt es nur in einer Demo-Sitzung.' });
  if (!demoErlaubt()) return res.status(403).json({ error: 'Der Demo-Modus ist ausgeschaltet.' });
  try {
    res.json(await paketBauen());
  } catch (error) {
    res.status(500).json({ error: 'Das Vorführpaket konnte nicht gebaut werden: ' + (error.message || error) });
  }
});

/* Selbstheilung beim Serverstart (Nutzerfund 30.08.2026: "Der Login als DemoAdmin klappt
   nicht"). Die Konten entstanden bisher NUR im Moment des Einschaltens. Wer den Schalter
   schon vorher an hatte, bekam neu hinzugekommene Reihen - etwa DemoAdmin1..20 - nie, und
   der Login scheiterte mit "Nutzername oder Passwort falsch". kontenBereitstellen() ist
   idempotent (es überspringt vorhandene Namen), der Lauf kostet also nichts, wenn alles da
   ist. Nur bei eingeschaltetem Demo-Modus, und Fehler dürfen den Serverstart nie aufhalten. */
setImmediate(() => {
  try {
    if (!demoErlaubt()) return;
    const fehlt = !getDemoUserStmt.get('DemoAdmin' + DEMO_ANZAHL) || !getDemoUserStmt.get('Demo' + DEMO_ANZAHL);
    if (!fehlt) return;
    kontenBereitstellen()
      .then(() => console.log('[Demo-Modus] Vorführkonten ergänzt (Demo1..' + DEMO_ANZAHL + ', DemoAdmin1..' + DEMO_ANZAHL + ').'))
      .catch((e) => console.log('[Demo-Modus] Vorführkonten konnten nicht ergänzt werden:', e.message || e));
  } catch (_e) { /* Start darf daran nie scheitern */ }
});

module.exports = router;
module.exports.demoErlaubt = demoErlaubt;
