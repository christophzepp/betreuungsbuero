#!/usr/bin/env node
// Trivialer, bundler-freier "Build" (Plan Abschnitt BR, Phase E2/E7): kopiert src/ nach
// dist/chrome und dist/firefox und legt das jeweils passende Manifest als manifest.json dazu.
// Alle Quelldateien sind KLASSISCHE Scripts (kein import/export) - Chrome laedt den Background
// per importScripts (background-chrome.js), Firefox als background.scripts-Array; Panel/Options
// laden ihre Abhaengigkeiten ueber <script>-Tags. Dadurch braucht es keinerlei Build-Kette,
// passend zur Projektkultur (Single-File-App ohne Bundler).
//
// Aufruf:  node build.js          -> dist/chrome/ + dist/firefox/
//          node build.js --zip    -> zusaetzlich dist/chrome.zip + dist/firefox.zip und
//                                    versionierte Installationsarchive unter ZIP/ (Phase E7)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

// 1x1-Pixel-PNG als Platzhalter-Icon (Base64), solange kein gestaltetes Icon existiert - Chrome
// und Firefox verlangen vorhandene Icon-Dateien nur, wenn sie im Manifest referenziert sind.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function ensureIcons(dir) {
  const iconsDir = path.join(dir, 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });
  for (const size of [16, 48, 128]) {
    const p = path.join(iconsDir, `icon${size}.png`);
    if (!fs.existsSync(p)) fs.writeFileSync(p, PLACEHOLDER_PNG);
  }
}

function build(target) {
  const out = path.join(DIST, target);
  fs.rmSync(out, { recursive: true, force: true });
  copyDir(SRC, out);
  const manifestPath = path.join(out, 'manifest.json');
  fs.copyFileSync(path.join(ROOT, `manifest.${target}.json`), manifestPath);
  if (target === 'firefox') {
    // Firefox braucht background-chrome.js nicht (laedt die Scripts direkt als Array).
    fs.rmSync(path.join(out, 'background-chrome.js'), { force: true });
    // Auto-Update (Feature v0.2.0 #9): EXT_UPDATE_URL beim Build gesetzt -> gecko.update_url wird
    // eingetragen (zeigt i. d. R. auf <Server>/api/ext/updates.json). Ohne die Variable bleibt das
    // Manifest ohne update_url = manuelle Aktualisierung. Der Server liefert die passende updates.json,
    // sobald zusaetzlich EXT_UPDATE_VERSION + EXT_UPDATE_XPI_URL in der .env gesetzt sind.
    const updateUrl = process.env.EXT_UPDATE_URL;
    if (updateUrl) {
      const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      mf.browser_specific_settings = mf.browser_specific_settings || {};
      mf.browser_specific_settings.gecko = mf.browser_specific_settings.gecko || {};
      mf.browser_specific_settings.gecko.update_url = updateUrl;
      fs.writeFileSync(manifestPath, JSON.stringify(mf, null, 2) + '\n');
      console.log(`  update_url gesetzt: ${updateUrl}`);
    }
  }
  ensureIcons(out);
  console.log(`dist/${target} gebaut.`);
}

build('chrome');
build('firefox');

if (process.argv.includes('--zip')) {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const archiveDir = path.join(ROOT, 'ZIP');
  fs.mkdirSync(archiveDir, { recursive: true });
  for (const target of ['chrome', 'firefox']) {
    const zipPath = path.join(DIST, `${target}.zip`);
    fs.rmSync(zipPath, { force: true });
    execSync(`cd ${JSON.stringify(path.join(DIST, target))} && zip -qr ${JSON.stringify(zipPath)} .`);
    fs.copyFileSync(zipPath, path.join(archiveDir, `formular-assistent-${target}-${version}.zip`));
    console.log(`dist/${target}.zip erzeugt.`);
  }
}
