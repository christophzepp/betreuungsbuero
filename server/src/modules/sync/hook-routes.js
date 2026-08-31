// Webhook-Sofort-Sync (PLAN-AUFGABEN-SYNC, Etappe 3): Vikunja meldet task.created/updated/...,
// wir stossen daraufhin einen normalen Aufgaben-Abgleich an. Der Webhook traegt KEINE Nutzdaten
// in die Datenbank - er ist nur ein Wecker. Damit ist ein gefaelschter Aufruf schlimmstenfalls
// ein zusaetzlicher Abgleich, nie eine Datenaenderung.
//
// Absicherung: Vikunja signiert den Rohkoerper mit HMAC-SHA256 (Header X-Vikunja-Signature),
// wenn beim Webhook ein Secret hinterlegt ist. Wo ein Client das nicht kann, gilt ersatzweise
// ?s=<Secret> in der Ziel-URL. Ohne hinterlegtes Secret ist der Endpunkt zu (404-gleich).
//
// Entprellung: viele Ereignisse in kurzer Folge (Massenaenderung) sammeln sich zu EINEM Lauf;
// waehrend ein Lauf arbeitet, wird hoechstens ein weiterer vorgemerkt.

const crypto = require('crypto');
const express = require('express');
const db = require('../../database/index');
const runner = require('./runner');

const router = express.Router();
router.use(express.text({ type: '*/*', limit: '512kb' }));

const getConnStmt = db.prepare('SELECT * FROM calendar_connections WHERE id = ?');

let timer = null;
let running = false;
let queued = false;
function triggerDebouncedSync() {
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    if (running) { queued = true; return; }
    running = true;
    try {
      do {
        queued = false;
        const result = await runner.syncTodos(null);
        if (result.errors?.length) console.warn('[sync-hook]', result.errors.join(' | '));
      } while (queued);
    } catch (error) {
      console.warn('[sync-hook] Abgleich fehlgeschlagen:', error.message);
    } finally {
      running = false;
    }
  }, 1500);
  timer.unref?.();
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

router.post('/vikunja/:connectionId', (req, res) => {
  const conn = getConnStmt.get(String(req.params.connectionId || ''));
  // Absichtlich dieselbe Antwort fuer "gibt es nicht" und "kein Secret hinterlegt" -
  // der Endpunkt verraet nicht, welche Verbindungs-IDs existieren.
  if (!conn || !conn.enabled || !conn.webhook_secret) return res.status(404).json({ error: 'Unbekannt.' });
  const signature = String(req.get('x-vikunja-signature') || '');
  let authorized = false;
  if (signature) {
    const expected = crypto.createHmac('sha256', conn.webhook_secret)
      .update(typeof req.body === 'string' ? req.body : '', 'utf8').digest('hex');
    authorized = timingSafeEqual(signature.toLowerCase(), expected.toLowerCase());
  } else {
    authorized = timingSafeEqual(String(req.query.s || ''), conn.webhook_secret);
  }
  if (!authorized) return res.status(403).json({ error: 'Signatur/Secret falsch.' });
  triggerDebouncedSync();
  res.json({ ok: true });
});

module.exports = router;
module.exports._internal = { triggerDebouncedSync };
