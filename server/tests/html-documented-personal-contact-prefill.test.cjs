'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

function contactRule(entries) {
  const start = html.indexOf('function v159HasDocumentedPersonalContact(');
  const end = html.indexOf('window.__v159HasDocumentedPersonalContact=', start);
  assert.ok(start >= 0 && end > start, 'zentrale Kontaktnachweis-Regel fehlt');
  const source = html.slice(start, end);
  const context = {
    state: {caseData: {documentationEntries: entries}},
    result: null
  };
  vm.runInNewContext(
    `const v159Norm=value=>String(value||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,' ').trim();\n${source}\nresult=v159HasDocumentedPersonalContact();`,
    context
  );
  return context.result;
}

test('alle Felder „Die Person ist mir bekannt“ nutzen dieselbe Ableitungsregel', () => {
  const fields = html.match(/\{id:'[^']+',label:'Die Person ist mir bekannt',type:'select'[^\n]*/g) || [];
  assert.equal(fields.length, 3);
  fields.forEach(field => assert.match(field, /deriveKey:'documentedPersonalContact'/));
  assert.match(html, /if\(key==='documentedPersonalContact'\)return v159HasDocumentedPersonalContact\(\)\?'ja':''/);
  assert.match(html, /allSchemaFields\(reportId\)\.filter\(item=>item\?\.deriveKey==='documentedPersonalContact'\)/);
});

test('Hausbesuch und persönliches Gespräch mit der betreuten Person belegen „bekannt“', () => {
  assert.equal(contactRule([{actorGroup: 'Betreute Person', type: 'Persönlicher Kontakt (§ 1863 BGB)', contactType: 'Hausbesuch'}]), true);
  assert.equal(contactRule([{actorGroup: 'Betreute Person', type: 'Persönlicher Kontakt (§ 1863 BGB)', contactType: 'Persönliches Gespräch'}]), true);
  assert.equal(contactRule([{actor: 'Betreute Person', type: 'Kommunikation & Kontakt', detail: 'Hausbesuch durchgeführt', contactType: 'persönlich (Hausbesuch)'}]), true);
  assert.equal(contactRule([{actor: 'Betroffene Person', type: 'Kommunikation & Kontakt', detail: 'Gespräch geführt', contactType: 'persönlich (Einrichtung / Klinik)'}]), true);
  assert.equal(contactRule([{actor: 'Klient', type: 'Kommunikation & Kontakt', contactType: 'persönlich (Betreuungsbüro)'}]), true);
});

test('Telefonate und Kontakte mit Dritten belegen „bekannt“ nicht', () => {
  assert.equal(contactRule([{actorGroup: 'Betreute Person', type: 'Persönlicher Kontakt (§ 1863 BGB)', contactType: 'Telefonischer Kontakt'}]), false);
  assert.equal(contactRule([{actor: 'Betreute Person', type: 'Kommunikation & Kontakt', detail: 'Kontaktversuch', contactType: 'nicht angetroffen'}]), false);
  assert.equal(contactRule([{actorGroup: 'Angehörige', type: 'Gespräch', contactType: 'Angehörigen-/Betreuungsgespräch'}]), false);
  assert.equal(contactRule([{actorGroup: 'Betreuungsgericht', type: 'Kontakt', contactType: 'Persönliches Gespräch'}]), false);
});

test('ohne Kontaktnachweis wird kein automatisches „nein“ gesetzt', () => {
  assert.equal(contactRule([]), false);
  assert.match(html, /const desired=v159HasDocumentedPersonalContact\(\)\?'ja':''/);
  assert.doesNotMatch(html, /v159HasDocumentedPersonalContact\(\)\?'ja':'nein'/);
});

test('ein positiver Nachweis aktualisiert auch einen älteren Nein-Wert', () => {
  assert.match(html, /if\(!desired&&\(entry\?\.cleared\|\|\(entry\?\.source&&entry\.source!=='master'\)\)\)continue/);
  assert.match(html, /setReportValue\(reportId,field\.id,desired,'master',true,false\)/);
});
