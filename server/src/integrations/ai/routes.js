// KI-Umleitung (Nutzerproblem 2026-07-19): In manchen Browser-Umgebungen scheitert der
// DIREKTE fetch auf die KI-Schnittstellen mit einem Netzwerkfehler (Safari: "Load failed"),
// z. B. durch Inhaltsblocker, iCloud Privat-Relay oder Firmen-Firewalls - obwohl die Leitung
// vom Rechner aus funktioniert. Der Client versucht dann als RÜCKFALL diese Route: der Server
// führt die Anfrage aus und reicht Status + Antworttext zurück (window.__aiFetch im Client).
//
// Bewusst eng gehalten (kein offener Proxy):
// - nur POST /api/ai-relay mit angemeldeter Sitzung,
// - Ziel NUR https auf die bekannten KI-Hosts (Whitelist),
// - nur die für die KI-Anbieter nötigen Header werden durchgereicht,
// - Antwort wird als Text gepuffert (kein Streaming) - passend zu den JSON-Antworten der Anbieter.
// Die API-Keys bleiben wie bisher im Browser; sie durchlaufen den Server hier nur transient.

const express = require('express');
const { requireAuth, requireUseAi } = require('../../middleware/authentication');

const router = express.Router();
router.use(requireAuth);

const ALLOWED_HOSTS = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'openai.inference.de-txl.ionos.com',
]);
const ALLOWED_HEADERS = new Set([
  'content-type', 'authorization', 'x-api-key', 'anthropic-version',
  'anthropic-dangerous-direct-browser-access',
]);
const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;

function allowedTarget(raw) {
  let target;
  try { target = new URL(String(raw || '')); }
  catch (_e) { return null; }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) return null;
  return target;
}

// Multipart-Weiterleitung fuer die Audio-Transkription. Der normale Relay-Pfad nimmt bewusst nur
// JSON-Text an; hier baut der Server den Multipart-Body aus einer streng begrenzten Base64-Datei.
router.post('/transcription', requireUseAi, async (req, res) => {
  const body = req.body || {};
  const target = allowedTarget(body.url);
  if (!target) return res.status(400).json({ error: 'Diese Ziel-Adresse ist für die KI-Transkription nicht freigegeben.' });
  if (!/\/audio\/transcriptions\/?$/.test(target.pathname)) {
    return res.status(400).json({ error: 'Für diese Weiterleitung ist nur der Transkriptions-Endpunkt zulässig.' });
  }

  const encoded = String(body.fileBase64 || '').replace(/\s+/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return res.status(400).json({ error: 'Die Mediendatei fehlt oder ist ungültig.' });
  }
  const file = Buffer.from(encoded, 'base64');
  if (!file.length || file.length > MAX_TRANSCRIPTION_BYTES) {
    return res.status(413).json({ error: 'Die Mediendatei darf höchstens 25 MB groß sein.' });
  }

  const sourceHeaders = body.headers || {};
  const authorization = Object.entries(sourceHeaders)
    .find(([key]) => String(key).toLowerCase() === 'authorization')?.[1];
  if (!authorization) return res.status(400).json({ error: 'Die Autorisierung für den KI-Anbieter fehlt.' });

  const fields = body.fields || {};
  const form = new FormData();
  form.append('file', new Blob([file], { type: String(body.mimeType || 'application/octet-stream').slice(0, 120) }),
    String(body.filename || 'aufnahme.webm').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 180));
  for (const name of ['model', 'language', 'prompt', 'response_format', 'temperature']) {
    const value = fields[name];
    if (value !== undefined && value !== null && String(value) !== '') form.append(name, String(value).slice(0, name === 'prompt' ? 1200 : 120));
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: 'POST',
      headers: { Authorization: String(authorization) },
      body: form,
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.send(text);
  } catch (error) {
    res.status(502).json({ error: 'KI-Transkription fehlgeschlagen: ' + ((error && error.message) || error) });
  }
});

router.post('/', async (req, res) => {
  const target = allowedTarget(req.body && req.body.url);
  if (!target) {
    return res.status(400).json({ error: 'Diese Ziel-Adresse ist für die KI-Umleitung nicht freigegeben.' });
  }
  const headers = {};
  const src = (req.body && req.body.headers) || {};
  for (const k of Object.keys(src)) {
    if (ALLOWED_HEADERS.has(String(k).toLowerCase())) headers[k] = String(src[k]);
  }
  const method = /^POST$/i.test(String((req.body && req.body.method) || '')) ? 'POST' : 'GET';
  const wantStream = !!(req.body && req.body.stream);
  try {
    const r = await fetch(target.toString(), {
      method,
      headers,
      body: method === 'POST' ? String((req.body && req.body.body) || '') : undefined,
    });
    // Streaming-Durchleitung (Nutzerwunsch 2026-07-20): Wenn der Client stream:true schickt
    // und die Anbieter-Antwort ein SSE-Stream ist, reichen wir die Bytes 1:1 durch, statt sie
    // zu puffern - so erscheint die KI-Antwort im Chat live Wort für Wort. Bei Fehlern (r.ok=false)
    // fällt der Code auf die gepufferte JSON-Antwort zurück (Fehlermeldung bleibt lesbar).
    if (wantStream && r.ok && r.body) {
      res.status(200);
      res.setHeader('Content-Type', r.headers.get('content-type') || 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // nginx: Puffern aus
      let reader;
      try { reader = r.body.getReader(); } catch (_e) { reader = null; }
      if (reader) {
        let closed = false;
        req.on('close', () => { closed = true; try { reader.cancel(); } catch (_e) {} });
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done || closed) break;
            if (value && value.length) { res.write(Buffer.from(value)); if (typeof res.flush === 'function') res.flush(); }
          }
        } catch (_e) { /* Verbindungsabbruch - still beenden */ }
        try { res.end(); } catch (_e) {}
        return;
      }
    }
    const text = await r.text();
    res.json({ status: r.status, contentType: r.headers.get('content-type') || '', body: text });
  } catch (e) {
    res.status(502).json({ error: 'KI-Umleitung fehlgeschlagen: ' + ((e && e.message) || e) });
  }
});

module.exports = router;
