'use strict';

// Kleiner, abhängigkeitenfreier OpenXML-Writer für die automatisch gepflegten
// Sicherungsabbilder. Er schreibt bewusst nur Werte (keine Makros/Formeln) und
// erzeugt damit robuste, in Excel/LibreOffice lesbare Arbeitsmappen.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBytes = centrals.reduce((sum, value) => sum + value.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function xml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index) {
  let n = index + 1;
  let out = '';
  while (n) {
    n--;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function safeSheetName(value, used) {
  const raw = String(value || 'Tabelle').replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || 'Tabelle';
  let name = raw;
  let index = 2;
  while (used.has(name.toLocaleLowerCase('de-DE'))) {
    const suffix = ` (${index++})`;
    name = raw.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLocaleLowerCase('de-DE'));
  return name;
}

function cellXml(value, ref) {
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  let text = value == null ? '' : String(value);
  if (text.length > 32767) text = text.slice(0, 32767);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function sheetXml(rows) {
  const body = (Array.isArray(rows) ? rows : []).map((row, rowIndex) => {
    const cells = (Array.isArray(row) ? row : [row]).map((value, columnIndex) =>
      cellXml(value, columnName(columnIndex) + (rowIndex + 1))
    ).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${body}</sheetData></worksheet>`;
}

function workbook(sheets) {
  const used = new Set();
  const list = (Array.isArray(sheets) && sheets.length ? sheets : [{ name: 'Daten', rows: [] }])
    .map((sheet, index) => ({ name: safeSheetName(sheet.name, used), rows: sheet.rows || [], index: index + 1 }));
  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ...list.map((sheet) => `<Override PartName="/xl/worksheets/sheet${sheet.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`),
    '</Types>'
  ].join('');
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';
  const workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + list.map((sheet) => `<sheet name="${xml(sheet.name)}" sheetId="${sheet.index}" r:id="rId${sheet.index}"/>`).join('')
    + '</sheets></workbook>';
  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + list.map((sheet) => `<Relationship Id="rId${sheet.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheet.index}.xml"/>`).join('')
    + '</Relationships>';
  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    ...list.map((sheet) => ({ name: `xl/worksheets/sheet${sheet.index}.xml`, data: sheetXml(sheet.rows) }))
  ]);
}

function flatten(value, prefix, rows) {
  const out = rows || [];
  const path = prefix || '';
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, out));
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) flatten(value[key], path ? `${path}.${key}` : key, out);
  } else {
    out.push([path, value == null ? '' : value]);
  }
  return out;
}

/* zipStore ist seit 30.08.2026 auch regulaer exportiert: die SP-Plugin-Auslieferung packt damit
   ihre vier Textdateien (store-only, deterministisch) - kein zweiter ZIP-Schreiber im Haus. */
module.exports = { workbook, flatten, zipStore, _test: { crc32, sheetXml, zipStore } };
