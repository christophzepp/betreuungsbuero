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
const block = html.match(/\/\* care-notice-document-defaults-v247-start \*\/([\s\S]*?)\/\* care-notice-document-defaults-v247-end \*\//)?.[1] || '';

function executeBlock(initialState) {
  const context = {
    REPORTS: [{ id: 'letter_care_notice', title: 'Betreuungsanzeige' }],
    state: initialState,
    currentReport: '',
    saved: 0,
    shown: [],
    window: {},
    document: {
      getElementById() { return null; },
      querySelector() { return null; }
    },
    buildNav() {},
    wireNav() {},
    renderReport() {}
  };
  context.ensureExportOptions = () => {
    context.state.ui = context.state.ui || {};
    context.state.ui.exportOptions = context.state.ui.exportOptions || {};
  };
  context.ensureDocumentOptions = () => {
    context.state.ui = context.state.ui || {};
    context.state.ui.documentOptions = context.state.ui.documentOptions || {};
  };
  context.saveState = () => { context.saved += 1; };
  context.getExportOptions = id => ({ ...(context.state.ui.exportOptions[id] || {}) });
  context.showDocumentInfo = id => { context.shown.push(id); };
  context.saveDocumentInfoOptions = () => {};
  context.window.getExportOptions = context.getExportOptions;
  context.window.showDocumentInfo = context.showDocumentInfo;
  context.window.saveDocumentInfoOptions = context.saveDocumentInfoOptions;
  vm.createContext(context);
  vm.runInContext(block, context);
  return context;
}

test('Betreuungsanzeige besitzt die festgelegten Dokumentinformationen', () => {
  assert.ok(block);
  assert.match(block, /const ID='letter_care_notice'/);
  assert.match(block, /template:'--'/);
  assert.match(block, /templateDate:'--'/);
  assert.match(block, /pages:'dynamisch'/);
  assert.match(block, /author:'Betreuungsbüro'/);
  assert.match(block, /authority:'Empfänger laut Anschreiben'/);
});

test('Exportarten und Empfänger werden auch für Bestandsdaten migriert', () => {
  assert.match(block, /careNoticeDocumentDefaultsVersion\|\|0\)>=247/);
  assert.match(block, /careNoticeDocumentDefaultsVersion=247/);
  assert.match(block, /print:true,[\s\S]{0,80}letterhead:true,[\s\S]{0,80}original:false,[\s\S]{0,80}combined:true/);
  assert.match(block, /defaultMode:'letterhead'/);
  assert.match(block, /recipientType:'export'/);
  assert.match(block, /recipientContactKey:''/);
  assert.match(block, /options\.original=false/);
  assert.match(block, /options\.originalTemplateReady=false/);
  assert.match(block, /originalInput\.disabled=true/);
  assert.match(block, /originalOption\.disabled=true/);
  assert.match(block, /Für dieses Dokument nicht verfügbar\./);
});

test('nachgeladenes altes Fallobjekt wird erst beim Öffnen vollständig korrigiert', () => {
  const context = executeBlock({ ui: {} });
  const loadedState = {
    ui: {
      careNoticeDocumentDefaultsVersion: 246,
      exportOptions: {
        letter_care_notice: {
          print: true,
          letterhead: true,
          original: false,
          combined: true,
          defaultMode: 'letterhead',
          recipientType: 'court'
        }
      },
      documentOptions: {
        letter_care_notice: {
          signatureId: 'blank',
          ownSignature: false,
          foreignSignatures: 0,
          combinedLetterStyle: 'letterhead',
          combinedFormStyle: 'print'
        }
      },
      phase3: {
        letter_care_notice: { letterStyle: 'letterhead', formStyle: 'print' }
      }
    }
  };
  context.state = loadedState;

  context.window.showDocumentInfo('letter_care_notice');

  const exp = loadedState.ui.exportOptions.letter_care_notice;
  const doc = loadedState.ui.documentOptions.letter_care_notice;
  const combined = loadedState.ui.phase3.letter_care_notice;
  assert.equal(loadedState.ui.careNoticeDocumentDefaultsVersion, 247);
  assert.equal(exp.recipientType, 'export');
  assert.equal(exp.defaultMode, 'letterhead');
  assert.equal(doc.combinedLetterStyle, 'letterhead');
  assert.equal(doc.combinedFormStyle, 'letterhead');
  assert.equal(combined.letterStyle, 'letterhead');
  assert.equal(combined.formStyle, 'letterhead');
  assert.equal(doc.signatureId, 'caregiver');
  assert.equal(doc.ownSignature, true);
});

test('Anschreiben und Dokument verwenden im kombinierten Export den Briefkopf', () => {
  assert.match(block, /combinedLetterStyle:'letterhead'/);
  assert.match(block, /combinedFormStyle:'letterhead'/);
  assert.match(block, /Object\.assign\(combined,\{letterStyle:'letterhead',formStyle:'letterhead'\}\)/);
  assert.match(block, /combined\.letterStyle=doc\.combinedLetterStyle/);
  assert.match(block, /combined\.formStyle=doc\.combinedFormStyle/);
});

test('Unterschrift des Betreuers ist Dokumentstandard', () => {
  assert.match(block, /signatureId:'caregiver'/);
  assert.match(block, /ownSignature:true/);
  assert.match(block, /foreignSignatures:0/);
});
