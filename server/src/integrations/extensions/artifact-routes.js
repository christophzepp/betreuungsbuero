// Ablage & Auslieferung der installierbaren Browser-Erweiterungs-Pakete (Nutzerwunsch): Admins
// hinterlegen pro Browser die passende Datei (Firefox: signierte .xpi -> 1-Klick-Install; Chrome/Edge:
// .zip des entpackten Ordners -> "Entpackt laden"). Jeder eingeloggte Nutzer kann die für seinen Browser
// hinterlegte Datei über den "Installieren"-Button im Menü „Erweiterungs-Zugänge" laden.
//
// Sicherheit: Upload/Löschen nur für Admins; Browser-Schlüssel strikt aus Whitelist (kein Path-Traversal);
// Dateiname auf Basename + sichere Zeichen reduziert; Größenlimit; Firefox-.xpi wird mit
// application/x-xpinstall INLINE ausgeliefert (löst den Firefox-Install-Dialog aus), alles andere als
// Attachment-Download. Metadaten in extension-artifacts/manifest.json, Dateien daneben.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { EXTENSION_ARTIFACTS_ROOT } = require('../../config/paths');
const { requireAuth, requireAdmin } = require('../../middleware/authentication');

const router = express.Router();
router.use(requireAuth);

const DIR = EXTENSION_ARTIFACTS_ROOT;
const MANIFEST = path.join(DIR, 'manifest.json');
const ALLOWED = ['firefox', 'chrome', 'edge'];
const MAX_BYTES = 60 * 1024 * 1024; // 60 MB
const DEFAULT_CT = { firefox: 'application/x-xpinstall', chrome: 'application/zip', edge: 'application/zip' };

function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch (_e) { /* egal */ } }
function readManifest() { try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (_e) { return {}; } }
function writeManifest(m) { ensureDir(); fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); }
function safeBrowser(b) { const k = String(b || '').toLowerCase(); return ALLOWED.includes(k) ? k : null; }

// Verfügbarkeit (jeder eingeloggte Nutzer) - der Install-Button liest daraus, was hinterlegt ist.
router.get('/', (req, res) => {
  const m = readManifest();
  const artifacts = {};
  for (const b of ALLOWED) {
    if (m[b]) artifacts[b] = { filename: m[b].filename, size: m[b].size, version: m[b].version || '', uploadedAt: m[b].uploadedAt || '' };
  }
  res.json({ artifacts });
});

// Download / Install (jeder eingeloggte Nutzer). Firefox: inline (Install-Dialog); sonst Attachment.
router.get('/:browser/download', (req, res) => {
  const browser = safeBrowser(req.params.browser);
  if (!browser) return res.status(400).json({ error: 'Unbekannter Browser.' });
  const entry = readManifest()[browser];
  if (!entry) return res.status(404).json({ error: 'Für diesen Browser wurde keine Erweiterung hinterlegt.' });
  const fp = path.join(DIR, entry.storedName);
  if (!fp.startsWith(DIR) || !fs.existsSync(fp)) return res.status(404).json({ error: 'Datei nicht gefunden.' });
  res.setHeader('Content-Type', entry.contentType || DEFAULT_CT[browser] || 'application/octet-stream');
  if (browser !== 'firefox') {
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(entry.filename) + '"');
  }
  fs.createReadStream(fp).pipe(res);
});

// Hinterlegen (nur Admin). Body: { filename, dataBase64, version? }
router.post('/:browser', requireAdmin, (req, res) => {
  const browser = safeBrowser(req.params.browser);
  if (!browser) return res.status(400).json({ error: 'Unbekannter Browser.' });
  const { filename, dataBase64, version } = req.body || {};
  if (!filename || !dataBase64) return res.status(400).json({ error: 'Datei oder Dateiname fehlt.' });
  let buf;
  try { buf = Buffer.from(String(dataBase64).replace(/^data:[^,]*,/, ''), 'base64'); }
  catch (_e) { return res.status(400).json({ error: 'Datei konnte nicht gelesen werden.' }); }
  if (!buf.length) return res.status(400).json({ error: 'Datei ist leer.' });
  if (buf.length > MAX_BYTES) return res.status(400).json({ error: 'Datei zu groß (max. 60 MB).' });
  ensureDir();
  const m = readManifest();
  if (m[browser] && m[browser].storedName) { try { fs.unlinkSync(path.join(DIR, m[browser].storedName)); } catch (_e) { /* egal */ } }
  const cleanName = (path.basename(String(filename)).replace(/[^A-Za-z0-9._-]/g, '_') || 'erweiterung').slice(0, 120);
  const storedName = browser + '__' + cleanName;
  fs.writeFileSync(path.join(DIR, storedName), buf);
  m[browser] = {
    filename: cleanName, storedName, size: buf.length, version: String(version || '').slice(0, 40),
    contentType: DEFAULT_CT[browser] || 'application/octet-stream',
    uploadedAt: new Date().toISOString(), uploadedBy: req.session.userId
  };
  writeManifest(m);
  res.json({ ok: true, browser, filename: cleanName, size: buf.length });
});

// Entfernen (nur Admin).
router.delete('/:browser', requireAdmin, (req, res) => {
  const browser = safeBrowser(req.params.browser);
  if (!browser) return res.status(400).json({ error: 'Unbekannter Browser.' });
  const m = readManifest();
  if (m[browser]) {
    try { fs.unlinkSync(path.join(DIR, m[browser].storedName)); } catch (_e) { /* egal */ }
    delete m[browser];
    writeManifest(m);
  }
  res.json({ ok: true });
});

module.exports = router;
