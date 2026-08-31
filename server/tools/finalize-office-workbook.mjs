import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const input = process.env.WORKBOOK_INPUT;
const output = process.env.WORKBOOK_OUTPUT;
const previewDir = process.env.WORKBOOK_PREVIEW_DIR;
if (!input || !output || !previewDir) throw new Error('Arbeitsdatei, Ausgabe und Vorschauordner sind erforderlich.');

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
const organisation = workbook.worksheets.getItem('Organisation');
organisation.getRange('B9').values = [[
  'Passfoto · automatisch gepflegte Stammdaten-, Adress- und Sicherungsdateien'
]];
organisation.getRange('A9:B9').format.rowHeight = 28;
organisation.getRange('B9').format.wrapText = true;
organisation.getRange('B10').values = [[
  'Beschluss · Bestallung · Betreuerausweis · Ausweise · Krankenkassenkarten · Urkunden · Vorsorgevollmacht · Patientenverfügung'
]];

const values = await workbook.inspect({
  kind: 'table',
  sheetId: 'Organisation',
  range: 'A6:B20',
  include: 'values,formulas',
  tableMaxRows: 20,
  tableMaxCols: 2,
  maxChars: 8000
});
console.log(values.ndjson);

const forbidden = await workbook.inspect({
  kind: 'match',
  searchTerm: 'Ausweise & Urkunden',
  options: { useRegex: false, maxResults: 50 },
  maxChars: 3000
});
console.log('ALTBEGRIFF\n' + forbidden.ndjson);

const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 300 },
  summary: 'final formula error scan',
  maxChars: 5000
});
console.log('FORMELFEHLER\n' + errors.ndjson);

await fs.mkdir(previewDir, { recursive: true });
for (const sheet of workbook.worksheets.items) {
  const rendered = await workbook.render({
    sheetName: sheet.name,
    autoCrop: 'all',
    scale: 0.65,
    format: 'png'
  });
  const filename = `${String(sheet.name).replace(/[^A-Za-z0-9_-]/g, '_')}.png`;
  await fs.writeFile(path.join(previewDir, filename), new Uint8Array(await rendered.arrayBuffer()));
  console.log('RENDER ' + sheet.name);
}

const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(output);
console.log('EXPORTED ' + output);
