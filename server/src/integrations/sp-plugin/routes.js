// Auslieferung des Super-Productivity-Plugins „Betreuungsbüro Sync" (Nutzerwunsch 30.08.2026:
// „Baue es und verdrahte es"). Das Plugin liegt als Quellordner neben dem Server; hier wird es
// on demand zu einem ZIP gepackt und angeboten.
//
// Warum aus dem Ordner statt als abgelegte Datei: Das Plugin spricht mit der /api/ext-Fassade
// DIESES Servers. Wird es bei jedem Abruf frisch aus dem mitgelieferten Quellordner gepackt,
// passt es zwangsläufig zur laufenden Serverfassung - eine hochgeladene Kopie (wie bei den
// Browser-Erweiterungspaketen) könnte dagegen still veralten.
//
// Sicherheit: nur eingeloggte Nutzer; die Dateiliste ist eine feste Whitelist (kein Verzeichnis
// durchsuchen, kein Path-Traversal); es werden ausschließlich Textdateien des Plugins
// ausgeliefert - keine Tokens, keine Falldaten.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { SP_PLUGIN_ROOT } = require('../../config/paths');
const { requireAuth } = require('../../middleware/authentication');
const { zipStore } = require('../../shared/simple-xlsx');

const router = express.Router();
router.use(requireAuth);

/* Feste Reihenfolge: manifest zuerst (Super Productivity liest es zuerst), README zuletzt. */
const PLUGIN_FILES = ['manifest.json', 'plugin.js', 'sync-core.js', 'README.md'];
const PLUGIN_ID = 'betreuungsbuero-sync';

function pluginFile(name) {
  if (!PLUGIN_FILES.includes(name)) return null;
  const file = path.join(SP_PLUGIN_ROOT, name);
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? { name, file, size: stat.size, mtime: stat.mtime.toISOString() } : null;
  } catch (_e) {
    return null;
  }
}

function pluginState() {
  const files = PLUGIN_FILES.map(pluginFile).filter(Boolean);
  const complete = files.length === PLUGIN_FILES.length;
  let version = '';
  let description = '';
  if (complete) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(SP_PLUGIN_ROOT, 'manifest.json'), 'utf8'));
      version = String(manifest.version || '');
      description = String(manifest.description || '');
    } catch (_e) { /* unvollständiges Manifest: Version bleibt leer, der Download geht trotzdem */ }
  }
  return {
    available: complete,
    id: PLUGIN_ID,
    version,
    description,
    files: files.map((f) => ({ name: f.name, size: f.size })),
    size: files.reduce((sum, f) => sum + f.size, 0),
    updatedAt: files.reduce((newest, f) => (f.mtime > newest ? f.mtime : newest), '')
  };
}

function zipName(version) {
  return `${PLUGIN_ID}-${version || 'aktuell'}.zip`;
}

// Verfügbarkeit + Version - der Knopf in den Einstellungen liest daraus, was er anbietet.
router.get('/', (req, res) => {
  res.json(pluginState());
});

router.get('/download', (req, res) => {
  const state = pluginState();
  if (!state.available) {
    return res.status(404).json({ error: 'Das Plugin ist auf diesem Server nicht hinterlegt.' });
  }
  let zip;
  try {
    zip = zipStore(PLUGIN_FILES.map((name) => ({
      name,
      data: fs.readFileSync(path.join(SP_PLUGIN_ROOT, name))
    })));
  } catch (error) {
    return res.status(500).json({ error: `Plugin-Paket konnte nicht erzeugt werden: ${error.message}` });
  }
  const filename = zipName(state.version);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Filename', encodeURIComponent(filename));
  res.setHeader('X-Plugin-Version', state.version);
  res.setHeader('Content-Length', String(zip.length));
  res.end(zip);
});

module.exports = router;
module.exports.PLUGIN_FILES = PLUGIN_FILES;
