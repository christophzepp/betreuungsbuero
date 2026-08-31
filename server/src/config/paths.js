'use strict';

const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');

function configuredPath(value, fallback) {
  const candidate = String(value || '').trim();
  if (!candidate) return path.resolve(fallback);
  return path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(SERVER_ROOT, candidate);
}

const RUNTIME_ROOT = configuredPath(
  process.env.RUNTIME_ROOT,
  path.join(PROJECT_ROOT, 'runtime')
);

const DATA_ROOT = configuredPath(
  process.env.DOCUMENTS_DATA_ROOT || process.env.DATA_DIR,
  path.join(RUNTIME_ROOT, 'data')
);

const DATABASE_PATH = configuredPath(
  process.env.DB_PATH,
  path.join(RUNTIME_ROOT, 'database', 'betreuungsbuero.sqlite3')
);

const OUTPUTS_ROOT = configuredPath(
  process.env.OUTPUTS_DIR,
  path.join(PROJECT_ROOT, 'outputs')
);

const ASSETS_ROOT = path.join(SERVER_ROOT, 'assets');
const TEMPLATES_ROOT = path.join(ASSETS_ROOT, 'templates');
const OCR_ASSETS_ROOT = path.join(ASSETS_ROOT, 'ocr');
const EXTENSION_ARTIFACTS_ROOT = configuredPath(
  process.env.EXTENSION_ARTIFACTS_DIR,
  path.join(RUNTIME_ROOT, 'extension-artifacts')
);

const RUNTIME_SECRETS_ROOT = configuredPath(
  process.env.RUNTIME_SECRETS_DIR,
  path.join(RUNTIME_ROOT, 'secrets')
);

/* Super-Productivity-Plugin „Betreuungsbüro Sync" (liegt als Quellordner neben dem Server und
   wird über /api/sp-plugin als ZIP ausgeliefert - so passt das Plugin immer zur laufenden
   Serverfassung, statt als Kopie im Downloads-Ordner zu veralten). */
const SP_PLUGIN_ROOT = configuredPath(
  process.env.SP_PLUGIN_DIR,
  path.join(PROJECT_ROOT, 'Super-Productivity-Plugin')
);

module.exports = Object.freeze({
  SERVER_ROOT,
  PROJECT_ROOT,
  RUNTIME_ROOT,
  DATA_ROOT,
  DATABASE_PATH,
  OUTPUTS_ROOT,
  ASSETS_ROOT,
  TEMPLATES_ROOT,
  OCR_ASSETS_ROOT,
  EXTENSION_ARTIFACTS_ROOT,
  RUNTIME_SECRETS_ROOT,
  SP_PLUGIN_ROOT,
  configuredPath
});
