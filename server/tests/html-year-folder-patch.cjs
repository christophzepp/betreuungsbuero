'use strict';

/*
 * Eng begrenzte Sicherheitsprüfung für die letzte Jahresordner-Korrektur in
 * der 69-MB-App-Datei. Die App-Datei selbst wird ausschließlich per Patch
 * geändert; dieses Skript prüft vorher und nachher Volltext, mtime,
 * Trefferzahlen, Blockzahl und JavaScript-Syntax.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.resolve(
  __dirname,
  '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
);
const backupPath = path.resolve(String(process.env.HTML_PATCH_BACKUP || ''));
const mode = process.argv.includes('--post') ? 'post' : 'pre';
const oldText = "    if(withYear)ogAddChild(f,'Jahr '+ogYear(),'template');";
const newText = "    if(withYear)ogAddChild(f,ogYear(),'template');";
const expectedScripts = 286;
const expectedJavaScript = 211;

assert.ok(process.env.HTML_PATCH_BACKUP, 'HTML_PATCH_BACKUP fehlt.');
assert.ok(fs.existsSync(backupPath), 'Sicherungskopie fehlt.');

function hash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function count(source, needle) {
  let found = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    found++;
    offset += needle.length;
  }
  return found;
}

function validateScripts(source, label) {
  const blocks = [];
  const expression = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = expression.exec(source))) {
    blocks.push({ attributes: match[1], body: match[2] });
  }
  assert.equal(blocks.length, expectedScripts, `${label}: Scriptblöcke`);
  let javascript = 0;
  const failures = [];
  blocks.forEach((block, index) => {
    if (/\btype\s*=/i.test(block.attributes)) return;
    javascript++;
    try {
      new vm.Script(block.body, { filename: `${label}-script-${index + 1}.js` });
    } catch (error) {
      failures.push({ block: index + 1, message: error.message });
    }
  });
  assert.equal(javascript, expectedJavaScript, `${label}: JavaScriptblöcke`);
  assert.deepEqual(failures, [], `${label}: Syntaxfehler`);
}

const backupBuffer = fs.readFileSync(backupPath);
const currentBuffer = fs.readFileSync(htmlPath);
const backup = backupBuffer.toString('utf8');
const current = currentBuffer.toString('utf8');
const candidate = backup.replace(oldText, newText);

assert.equal(count(backup, oldText), 1, 'Sicherung: alter Text 1/1');
assert.equal(count(backup, newText), 0, 'Sicherung: neuer Text 0/0');
assert.equal(count(candidate, oldText), 0, 'Kandidat: alter Text 0/0');
assert.equal(count(candidate, newText), 1, 'Kandidat: neuer Text 1/1');
validateScripts(backup, 'Sicherung');
validateScripts(candidate, 'Kandidat');

if (mode === 'pre') {
  assert.equal(
    Buffer.compare(currentBuffer, backupBuffer),
    0,
    'App-Datei und Sicherung unterscheiden sich vor dem Schreiben.'
  );
  assert.equal(
    fs.statSync(htmlPath).mtimeMs,
    fs.statSync(backupPath).mtimeMs,
    'mtime wurde beim Erstellen der Sicherung nicht erhalten.'
  );
} else {
  assert.equal(count(current, oldText), 0, 'Ergebnis: alter Text 0/0');
  assert.equal(count(current, newText), 1, 'Ergebnis: neuer Text 1/1');
  assert.equal(
    Buffer.compare(currentBuffer, Buffer.from(candidate)),
    0,
    'Ergebnis weicht außer der geprüften 1/1-Ersetzung vom Kandidaten ab.'
  );
  validateScripts(current, 'Ergebnis');
}

console.log(JSON.stringify({
  mode,
  backupSha256: hash(backupBuffer),
  currentSha256: hash(currentBuffer),
  candidateSha256: hash(Buffer.from(candidate)),
  bytes: currentBuffer.length,
  scriptBlocks: expectedScripts,
  javaScriptBlocks: expectedJavaScript,
  replacements: 1
}, null, 2));
