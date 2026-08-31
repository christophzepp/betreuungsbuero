const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/\/\* care-notice-recipient-reference-v249-start \*\/([\s\S]*?)\/\* care-notice-recipient-reference-v249-end \*\//);

assert.ok(match, 'care-notice recipient-reference patch must exist');

function setup({ options, field, contacts = [], care = {} }) {
  const report = {
    fields: {
      letter_reference: field || { value: '', source: 'empty' }
    }
  };
  const context = {
    console,
    Date,
    currentReport: 'letter_care_notice',
    state: {
      caseData: { care, contacts },
      reports: { letter_care_notice: report }
    },
    __options: options,
    __saved: 0,
    getExportOptions() { return { ...context.__options }; },
    renderReport() { return 'rendered'; },
    saveState() { context.__saved += 1; }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(match[1], context);
  return { context, report };
}

test('uses the selected export contact customer or reference number', () => {
  const contact = { key: 'contact-1', customerNumber: 'KD-4711' };
  const { context, report } = setup({
    options: {
      recipientType: 'export',
      _resolvedRecipientType: 'contact',
      recipientContactKey: 'contact-1',
      _effectiveContact: contact
    },
    contacts: [contact]
  });

  assert.equal(context.getExportOptions('letter_care_notice').recipientReference, 'KD-4711');
  assert.equal(report.fields.letter_reference.value, 'KD-4711');
  assert.equal(report.fields.letter_reference.source, 'master');
});

test('uses the recipient file number stored in the address master data', () => {
  const contact = { key: 'contact-file', fileNumber: 'AZ-2026-4711' };
  const { context, report } = setup({
    options: {
      recipientType: 'export',
      _resolvedRecipientType: 'contact',
      recipientContactKey: 'contact-file',
      _effectiveContact: contact
    },
    contacts: [contact]
  });

  assert.equal(context.getExportOptions('letter_care_notice').recipientReference, 'AZ-2026-4711');
  assert.equal(report.fields.letter_reference.value, 'AZ-2026-4711');
});

test('uses the recipient process number when no file number exists', () => {
  const contact = { key: 'contact-process', processNumber: 'VORGANG-882' };
  const { context, report } = setup({
    options: {
      recipientType: 'contact',
      _resolvedRecipientType: 'contact',
      recipientContactKey: 'contact-process',
      _effectiveContact: contact
    },
    contacts: [contact]
  });

  assert.equal(context.getExportOptions('letter_care_notice').recipientReference, 'VORGANG-882');
  assert.equal(report.fields.letter_reference.value, 'VORGANG-882');
});

test('uses the predefined court file number', () => {
  const { context } = setup({
    options: { recipientType: 'court', _resolvedRecipientType: 'court' },
    care: { fileNumber: 'XVII 121/16' }
  });

  assert.equal(context.getExportOptions('letter_care_notice').recipientReference, 'XVII 121/16');
});

test('uses a manually predefined recipient reference', () => {
  const { context } = setup({
    options: {
      recipientType: 'manual',
      _resolvedRecipientType: 'manual',
      manualRecipient: { reference: 'Vertrag 882' }
    }
  });

  assert.equal(context.getExportOptions('letter_care_notice').recipientReference, 'Vertrag 882');
});

test('keeps an explicit manual field value as an override', () => {
  const { context, report } = setup({
    options: {
      recipientType: 'export',
      _resolvedRecipientType: 'contact',
      _effectiveContact: { customerNumber: 'KD-4711' }
    },
    field: { value: 'Eigene Referenz', source: 'manual' }
  });

  assert.equal(context.getExportOptions('letter_care_notice').recipientReference, 'Eigene Referenz');
  assert.equal(report.fields.letter_reference.value, 'Eigene Referenz');
});

test('also accepts a contract number stored with the recipient', () => {
  const { context, report } = setup({
    options: {
      recipientType: 'export',
      _resolvedRecipientType: 'contact',
      _effectiveContact: { contractNumber: 'VERTRAG-2026-18' }
    }
  });

  assert.equal(context.getExportOptions('letter_care_notice').recipientReference, 'VERTRAG-2026-18');
  assert.equal(report.fields.letter_reference.value, 'VERTRAG-2026-18');
});

test('leaves export-mode reference empty until a concrete recipient is selected', () => {
  const { context, report } = setup({
    options: { recipientType: 'export', _resolvedRecipientType: 'blank' },
    field: { value: 'Alter automatisch übernommener Wert', source: 'master' }
  });

  assert.equal(context.getExportOptions('letter_care_notice').recipientReference, '');
  assert.equal(report.fields.letter_reference.value, '');
  assert.equal(report.fields.letter_reference.source, 'empty');
});
