'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function releaseFiles(tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Erwartet wird ein Versions-Tag wie v0.7.11.');
  return [`Betreuungsbuero_Dokumentenassistent_${tag.replaceAll('.', '_')}.html`, 'compose.yaml', 'betreuungsbuero.env.example'];
}
function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function prepareRelease(root, tag, destination) {
  const names = releaseFiles(tag);
  const htmlPath = path.join(root, 'outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html');
  const html = fs.readFileSync(htmlPath);
  if (!html.includes(Buffer.from(`const APP_VERSION='${tag.slice(1)}';`))) {
    throw new Error('Programmversion und Versions-Tag stimmen nicht überein.');
  }
  const notes = fs.readFileSync(path.join(root, 'docs/releases', `${tag}.md`), 'utf8');
  for (const name of [...names, 'SHA256SUMS.txt']) {
    if (!notes.includes(name)) throw new Error(`Download fehlt in den Release Notes: ${name}`);
  }
  // Fail on missing inputs before creating a partial release directory.
  const inputs = [html, fs.readFileSync(path.join(root, 'compose.yaml')), fs.readFileSync(path.join(root, '.env.example'))];
  fs.mkdirSync(destination, { recursive: true });
  names.forEach((name, index) => fs.writeFileSync(path.join(destination, name), inputs[index]));
  const sums = names.map(name => `${digest(path.join(destination, name))}  ${name}\n`).join('');
  fs.writeFileSync(path.join(destination, 'SHA256SUMS.txt'), sums);
  return [...names, 'SHA256SUMS.txt'];
}
function verifyRelease(tag, directory, release) {
  const names = [...releaseFiles(tag), 'SHA256SUMS.txt'];
  if (release.tag_name !== tag || release.assets?.length !== names.length) throw new Error('Release-Tag oder Anzahl der Downloads stimmt nicht.');
  for (const name of names) {
    const asset = release.assets.find(item => item.name === name);
    const file = path.join(directory, name);
    if (!asset || asset.state !== 'uploaded' || asset.size !== fs.statSync(file).size || asset.digest !== `sha256:${digest(file)}`) {
      throw new Error(`Download unvollständig oder Prüfsumme falsch: ${name}`);
    }
  }
}

if (require.main === module) {
  const [action, tag, directory, manifest] = process.argv.slice(2);
  if (action === 'prepare') {
    for (const name of prepareRelease(path.resolve(__dirname, '../..'), tag, directory)) console.log(name);
  } else if (action === 'verify') {
    verifyRelease(tag, directory, JSON.parse(fs.readFileSync(manifest, 'utf8')));
    console.log('Alle vier Release-Dateien sind vollständig hochgeladen; Größen und SHA-256-Prüfsummen stimmen.');
  } else throw new Error('Verwendung: release-assets.cjs prepare|verify TAG VERZEICHNIS [RELEASE_JSON]');
}
module.exports = { prepareRelease, verifyRelease };
