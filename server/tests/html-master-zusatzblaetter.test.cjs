'use strict';
/* Stammdaten-Excel-Rundlauf für „Fähigkeiten & Alltag" und die Wohn-Verlaufslisten
   (Nutzerwunsch 15.08.2026): eigener Block master-zusatzblaetter-v255 schreibt beim
   Excel-Aktualisieren/Sammel-ZIP zwei Zusatzblätter und liest sie beim Einlesen
   zurück. Die JSON-Datensicherung (exportProject = clone(state)) trägt beide
   Familien ohnehin vollständig — auch das ist hier verankert. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

function leseZipTeil(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'ZIP-Endeverzeichnis fehlt');
  let pos = buf.readUInt32LE(eocd + 16);
  const anzahl = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < anzahl; i++) {
    assert.equal(buf.readUInt32LE(pos), 0x02014b50, 'zentraler Verzeichniseintrag fehlt');
    const methode = buf.readUInt16LE(pos + 10);
    const csize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const kommLen = buf.readUInt16LE(pos + 32);
    const lokalOffset = buf.readUInt32LE(pos + 42);
    const eintragName = buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8');
    if (eintragName === name) {
      const lokalNameLen = buf.readUInt16LE(lokalOffset + 26);
      const lokalExtraLen = buf.readUInt16LE(lokalOffset + 28);
      const daten = buf.slice(lokalOffset + 30 + lokalNameLen + lokalExtraLen,
        lokalOffset + 30 + lokalNameLen + lokalExtraLen + csize);
      return methode === 8 ? zlib.inflateRawSync(daten) : daten;
    }
    pos += 46 + nameLen + extraLen + kommLen;
  }
  assert.fail(`ZIP-Eintrag fehlt in der Vorlage: ${name}`);
}

test('die JSON-Datensicherung bleibt eine vollständige Zustandskopie', () => {
  assert.match(html, /function exportProject\(\)\{const copy=clone\(state\)/);
});

test('der Zusatzblatt-Block ist verdrahtet (Zip-Schreiber, Sammel-ZIP-Fallback, Einlesen)', () => {
  assert.match(html, /<script id="master-zusatzblaetter-v255">/);
  assert.match(html, /const zipKernV255=window\.phase4ZipStore/);
  assert.match(html, /entries\.some\(e=>e&&e\.name==='xl\/workbook\.xml'\)/);
  assert.match(html, / Stammdaten\\\.xlsx\$/);
  assert.match(html, /const importKernV255=window\.importMaster/);
  assert.match(html, /norm\(x\.name\)\.includes\('fahigkeiten'\)/);
  assert.match(html, /norm\(x\.name\)\.includes\('wohnen'\)/);
});

function ladeApi() {
  const match = html.match(/<script id="master-zusatzblaetter-v255">([\s\S]*?)<\/script>/);
  assert.ok(match, 'Block fehlt');
  // Identisch zur App-norm (entscheidend: Umlaut-Entschärfung für die unscharfe Blattsuche)
  const norm = v => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const state = { caseData: {
    accommodation: {},
    goalDecisionPlanning: { records: [
      { id: 'n1', type: 'need', title: 'Unterstützung bei Behördenpost' }
    ], functionalProfile: { assessments: [], dailyLife: {}, wishExpression: {} } }
  } };
  const ctx = { console, state, norm,
    XLSX: {
      header(rows, labels) {
        const req = labels.map(norm);
        for (let r = 0; r < rows.length; r++) {
          const nv = (rows[r] || []).map(norm);
          if (req.every(x => nv.includes(x))) return { r, row: rows[r], norm: nv };
        }
        return null;
      },
      findCell(rows, term) {
        const n = norm(term);
        for (let r = 0; r < rows.length; r++)
          for (let c = 0; c < (rows[r] || []).length; c++)
            if (norm(rows[r][c]).includes(n)) return { r, c, row: rows[r] };
        return null;
      }
    },
    saveState() {}, toast() {}, TextEncoder, TextDecoder };
  ctx.window = ctx;
  ctx.window.__housingV255 = { domainLabels: {
    communication: 'Kommunikation und Verständigung', mobility: 'Mobilität'
  } };
  vm.createContext(ctx);
  vm.runInContext(match[1], ctx);
  return { ctx, state, api: ctx.window.__masterZusatzV255Api };
}

test('Fähigkeiten und Wohnen überstehen den Excel-Rundlauf (Bauen → Einlesen)', () => {
  const { ctx, state, api } = ladeApi();
  state.caseData.goalDecisionPlanning.functionalProfile = {
    assessments: [{ id: 'a1', domain: 'communication', resources: 'Telefoniert selbständig.',
      impairments: 'Behördenpost überfordert.', source: 'Hausbesuch', assessedAt: '2026-07-02',
      reviewDate: '2026-09-01', active: true, includeInReports: true, linkedNeedIds: ['n1'] }],
    dailyLife: { summary: 'Strukturierter Alltag.', assessedAt: '2026-07-02', includeInReports: true },
    wishExpression: { status: 'bedingt', reason: 'Unterstützung nötig',
      communicationMethods: ['spoken', 'simple_language'], includeInReports: true }
  };
  state.caseData.accommodation = {
    housingSecurityEntries: [{ id: 'h1', entryDate: '2026-06-01', endDate: '', status: 'at_risk', details: 'Kündigung droht' }],
    supportEntries: [{ id: 's1', entryDate: '2026-07-01', status: 'active', details: '', forms: ['Ambulanter Dienst'] }]
  };
  const fRows = api.faehigkeitenRowsV255();
  const wRows = api.wohnenRowsV255();
  assert.ok(fRows.some(r => r && r[0] === 'Kommunikation und Verständigung' && r[8] === 'Unterstützung bei Behördenpost'),
    'Bedarfs-Verknüpfung muss als Titel exportiert werden');
  assert.ok(wRows.some(r => r && r[2] === 'gefährdet' && r[3] === 'Kündigung droht'), 'Wohnstatus muss im Klartext stehen');

  // Zustand leeren und aus den Zeilen wieder aufbauen:
  state.caseData.goalDecisionPlanning.functionalProfile = { assessments: [], dailyLife: {}, wishExpression: {} };
  state.caseData.accommodation = {};
  api.parseFaehigkeitenRowsV255(fRows);
  api.parseWohnenRowsV255(wRows);
  const fp = state.caseData.goalDecisionPlanning.functionalProfile;
  const wieder = fp.assessments.find(a => a.domain === 'communication');
  assert.ok(wieder, 'Bereich muss wieder ankommen');
  assert.equal(wieder.resources, 'Telefoniert selbständig.');
  assert.equal(wieder.assessedAt, '2026-07-02');
  assert.equal(wieder.reviewDate, '2026-09-01');
  assert.equal(JSON.stringify(wieder.linkedNeedIds), JSON.stringify(['n1']), 'Bedarfs-Titel muss zurück auf die Datensatz-Id aufgelöst werden');
  assert.equal(fp.dailyLife.summary, 'Strukturierter Alltag.');
  assert.equal(fp.wishExpression.status, 'bedingt');
  assert.equal(JSON.stringify(fp.wishExpression.communicationMethods), JSON.stringify(['spoken', 'simple_language']));
  const wohnen = state.caseData.accommodation;
  assert.equal(wohnen.housingSecurityEntries.length, 1);
  assert.equal(wohnen.housingSecurityEntries[0].status, 'at_risk', 'Klartext muss zurück auf den Statuscode abgebildet werden');
  assert.equal(JSON.stringify(wohnen.supportEntries[0].forms), JSON.stringify(['Ambulanter Dienst']));
});

test('die Blatt-Injektion ergänzt Arbeitsmappe, Beziehungen und Inhaltstypen (und ersetzt beim zweiten Lauf)', () => {
  const { api } = ladeApi();
  const enc = new TextEncoder(), dec = new TextDecoder();
  const entries = [
    { name: 'xl/workbook.xml', data: enc.encode('<workbook xmlns:r="x"><sheets><sheet name="01 - Stammdaten" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: '[Content_Types].xml', data: enc.encode('<Types></Types>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode('<worksheet/>') }
  ];
  api.injiziereZusatzblaetterV255(entries);
  const wb = dec.decode(entries.find(e => e.name === 'xl/workbook.xml').data);
  assert.match(wb, /name="11 - Fähigkeiten &amp; Alltag"/);
  assert.match(wb, /name="12 - Wohnen"/);
  assert.ok(entries.some(e => e.name === 'xl/worksheets/zusatzFaehigkeitenV255.xml'), 'Fähigkeiten-Blatt fehlt');
  assert.ok(entries.some(e => e.name === 'xl/worksheets/zusatzWohnenV255.xml'), 'Wohnen-Blatt fehlt');
  const rel = dec.decode(entries.find(e => e.name === 'xl/_rels/workbook.xml.rels').data);
  assert.match(rel, /Target="worksheets\/zusatzFaehigkeitenV255\.xml"/);
  const ct = dec.decode(entries.find(e => e.name === '[Content_Types].xml').data);
  assert.match(ct, /zusatzWohnenV255\.xml/);
  // Zweiter Lauf: keine Dopplung, Blätter werden ersetzt
  const anzahl = entries.length;
  api.injiziereZusatzblaetterV255(entries);
  assert.equal(entries.length, anzahl, 'zweiter Lauf darf keine neuen Einträge anlegen');
});

test('die formatierte Nutzer-Vorlage wird zellgenau befüllt und im Blanko-Fall unangetastet gelassen', () => {
  // Nutzer-Vorlage 15.08. (260815 1312): Blätter „11 - Fähigkeiten & Alltag" und
  // „12 - Wohnen" sind Teil der Basis. Datenmodus füllt Blatt 11 in der Vorlagen-
  // Formatierung (Stil-Attribute bleiben), Blatt 12 wird im Vorlagen-Layout neu
  // geschrieben. Blatt 12 erweitert die kuratierten Kopf-/Rahmenstile um seine Datenzeilen.
  // Blanko-Modus fasst beide Blätter nicht an.
  const { state, api } = ladeApi();
  state.caseData.goalDecisionPlanning.functionalProfile = {
    assessments: [{ id: 'a1', domain: 'communication', resources: 'Telefoniert selbständig.',
      impairments: '', source: '', assessedAt: '2026-07-02', reviewDate: '', active: true,
      includeInReports: true, linkedNeedIds: [] }],
    dailyLife: { summary: 'Strukturierter Alltag.' }, wishExpression: { status: 'bedingt' }
  };
  state.caseData.accommodation = { housingSecurityEntries: [{ id: 'h1', entryDate: '2026-06-01', status: 'at_risk', details: 'Kündigung droht' }] };
  const enc = new TextEncoder(), dec = new TextDecoder();
  const zelle = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  const zelleS = (ref, text, style) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${text}</t></is></c>`;
  const blatt11 = '<worksheet><sheetData>'
    + `<row r="1">${zelle('A1', 'Fähigkeiten &amp; Alltag – Istzustand')}</row>`
    + `<row r="2">${zelle('A2', 'Stand:')}<c r="B2" s="7"/></row>`
    + `<row r="4">${['Bereich', 'Fähigkeiten und Ressourcen', 'Beeinträchtigungen und Schwierigkeiten', 'Quelle / Grundlage', 'Stand', 'Wiedervorlage am', 'Einschätzung aktuell', 'Für Berichte', 'Verknüpfte Bedarfe'].map((l, i) => zelle(String.fromCharCode(65 + i) + '4', l)).join('')}</row>`
    + `<row r="5">${zelle('A5', 'Kommunikation und Verständigung')}<c r="B5" s="11"/></row>`
    + `<row r="15">${zelle('A15', 'Gestaltung der Alltagssituation')}</row>`
    + `<row r="16">${zelle('A16', 'Zusammenfassung des aktuellen Alltags')}</row>`
    + `<row r="28">${zelle('A28', 'Wunschäußerung')}</row>`
    + `<row r="29">${zelle('A29', 'Einschätzung')}</row>`
    + '</sheetData></worksheet>';
  const wohnenKopf = rn => ['Von', 'Bis', 'Status', 'Details', 'Unterstützungsformen']
    .map((label, index) => zelleS(String.fromCharCode(65 + index) + rn, label, 29)).join('');
  const blatt12 = '<worksheet><dimension ref="A1:E14"/><sheetData>'
    + `<row r="1">${zelleS('A1', 'Wohnsituation', 9)}</row>`
    + `<row r="2">${zelleS('A2', 'Stand:', 10)}</row>`
    + `<row r="4">${zelleS('A4', 'Wohnsicherheit', 9)}</row><row r="5">${wohnenKopf(5)}</row>`
    + `<row r="7">${zelleS('A7', 'Barrierefreiheit', 9)}</row><row r="8">${wohnenKopf(8)}</row>`
    + `<row r="10">${zelleS('A10', 'Aktuelle Probleme', 9)}</row><row r="11">${wohnenKopf(11)}</row>`
    + `<row r="13">${zelleS('A13', 'Unterstützungsformen', 9)}</row><row r="14">${wohnenKopf(14)}</row>`
    + '</sheetData></worksheet>';
  const baueEntries = () => [
    { name: 'xl/workbook.xml', data: enc.encode('<workbook xmlns:r="x"><sheets><sheet name="11 - Fähigkeiten &amp; Alltag" sheetId="11" r:id="rId11"/><sheet name="12 - Wohnen" sheetId="12" r:id="rId12"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<Relationships><Relationship Id="rId11" Type="t" Target="worksheets/sheet11.xml"/><Relationship Id="rId12" Type="t" Target="worksheets/sheet12.xml"/></Relationships>') },
    { name: '[Content_Types].xml', data: enc.encode('<Types></Types>') },
    { name: 'xl/worksheets/sheet11.xml', data: enc.encode(blatt11) },
    { name: 'xl/worksheets/sheet12.xml', data: enc.encode(blatt12) }
  ];
  // Datenmodus: Blatt 11 zellgenau befüllt, Stil an B2 erhalten; Blatt 12 neu geschrieben
  const datenEntries = baueEntries();
  api.injiziereZusatzblaetterV255(datenEntries, false);
  const s11 = dec.decode(datenEntries.find(e => e.name === 'xl/worksheets/sheet11.xml').data);
  const s12 = dec.decode(datenEntries.find(e => e.name === 'xl/worksheets/sheet12.xml').data);
  assert.ok(s11.includes('Telefoniert selbständig.'), 'Blatt 11 muss die Falldaten tragen');
  assert.match(s11, /<c r="B5" s="11" t="inlineStr">/);
  assert.match(s11, /<c r="B2" s="7" t="inlineStr">/); // Stil der Stand:-Zelle bleibt erhalten
  assert.ok(s11.includes('Strukturierter Alltag.') && s11.includes('bedingt'), 'Abschnittswerte müssen ankommen');
  assert.ok(s12.includes('gefährdet') && s12.includes('Kündigung droht'), 'Blatt 12 muss die Wohn-Einträge tragen');
  assert.match(s12, /<c r="A6" s="11" t="inlineStr">/, 'neue Wohn-Datenzeilen müssen den kuratierten Tabellenkörper-Rahmen übernehmen');
  assert.match(s12, /<c r="A8" s="9" t="inlineStr"><is><t>Barrierefreiheit<\/t>/, 'nachfolgende Wohn-Abschnitte müssen bei zusätzlichen Zeilen korrekt nach unten rücken');
  assert.equal(datenEntries.length, baueEntries().length, 'keine neuen Teile im Befüll-Modus');
  // Blanko-Modus: beide Blätter byte-identisch unangetastet
  const blankoEntries = baueEntries();
  api.injiziereZusatzblaetterV255(blankoEntries, true);
  assert.equal(dec.decode(blankoEntries.find(e => e.name === 'xl/worksheets/sheet11.xml').data), blatt11, 'Blanko darf Blatt 11 nicht anfassen');
  assert.equal(dec.decode(blankoEntries.find(e => e.name === 'xl/worksheets/sheet12.xml').data), blatt12, 'Blanko darf Blatt 12 nicht anfassen');
});

test('alte Arbeitsmappen werden beim Sichern strukturell auf die neueste Basis angeglichen', () => {
  // Nutzerwunsch 15.08. nachmittags: fehlt einer alten Mappe ein Blatt der neuesten
  // Basis (z. B. „10 - Bedarfe & Wille"), wird es beim Sichern aus der Basis übernommen —
  // eigenständig gemacht (SharedStrings → Klartext, Stilverweise entfernt).
  const { ctx, api } = ladeApi();
  const enc = new TextEncoder(), dec = new TextDecoder();
  ctx.window.__basisRohV255 = [
    { name: 'xl/workbook.xml', data: enc.encode('<workbook xmlns:r="x"><sheets><sheet name="01 - Stammdaten" sheetId="1" r:id="rId1"/><sheet name="10 - Bedarfe &amp; Wille" sheetId="10" r:id="rId10"/><sheet name="11 - Fähigkeiten &amp; Alltag" sheetId="11" r:id="rId11"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId10" Type="t" Target="worksheets/sheet10.xml"/><Relationship Id="rId11" Type="t" Target="worksheets/sheet11.xml"/></Relationships>') },
    { name: 'xl/sharedStrings.xml', data: enc.encode('<sst><si><t>Bedarfe-Kopfzeile</t></si></sst>') },
    { name: 'xl/worksheets/sheet10.xml', data: enc.encode('<worksheet><sheetData><row r="1"><c r="A1" s="4" t="s"><v>0</v></c></row></sheetData></worksheet>') },
    { name: 'xl/worksheets/sheet11.xml', data: enc.encode('<worksheet/>') }
  ];
  const alteMappe = [
    { name: 'xl/workbook.xml', data: enc.encode('<workbook xmlns:r="x"><sheets><sheet name="01 - Stammdaten" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: '[Content_Types].xml', data: enc.encode('<Types></Types>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode('<worksheet/>') }
  ];
  api.ergaenzeFehlendeBlaetterV255(alteMappe);
  const wb = dec.decode(alteMappe.find(e => e.name === 'xl/workbook.xml').data);
  assert.match(wb, /name="10 - Bedarfe &amp; Wille"/, 'fehlendes Basis-Blatt muss übernommen werden');
  assert.ok(!/name="11 - Fähigkeiten &amp; Alltag"/.test(wb), 'Fähigkeiten/Wohnen bleiben Sache der Befüll-Injektion');
  const teil = alteMappe.find(e => e.name === 'xl/worksheets/basisUebernahmeV255_1.xml');
  assert.ok(teil, 'übernommenes Blatt-Part fehlt');
  const xml = dec.decode(teil.data);
  assert.ok(xml.includes('Bedarfe-Kopfzeile') && xml.includes('t="inlineStr"'), 'SharedStrings müssen zu Klartext aufgelöst sein');
  assert.ok(!xml.includes(' s="'), 'fremde Stilverweise müssen entfernt sein');
  // Idempotenz: zweiter Lauf ändert nichts mehr
  const anzahl = alteMappe.length;
  api.ergaenzeFehlendeBlaetterV255(alteMappe);
  assert.equal(alteMappe.length, anzahl, 'zweiter Lauf darf nichts erneut übernehmen');
  // Verdrahtung im Datenmodus-Pfad
  assert.match(html, /if\(!blanko\)entries=ergaenzeFehlendeBlaetterV255\(entries\);/);
  assert.match(html, /injiziereZusatzblaetterV255\(ergaenzeFehlendeBlaetterV255\(roh\),false\)/);
});

test('die Blanko-Vorlage erhält die Blattstruktur OHNE Falldaten', () => {
  const { state, api } = ladeApi();
  // Offener Fall mit Daten — die dürfen NICHT in die leere Vorlage gelangen:
  state.caseData.goalDecisionPlanning.functionalProfile = {
    assessments: [{ id: 'a1', domain: 'communication', resources: 'GEHEIME FALLDATEN',
      impairments: '', active: true, includeInReports: true, linkedNeedIds: [] }],
    dailyLife: {}, wishExpression: {}
  };
  state.caseData.accommodation = { housingSecurityEntries: [{ id: 'h1', entryDate: '2026-06-01', status: 'at_risk', details: 'GEHEIM' }] };
  const enc = new TextEncoder(), dec = new TextDecoder();
  const entries = [
    { name: 'xl/workbook.xml', data: enc.encode('<workbook xmlns:r="x"><sheets><sheet name="01 - Stammdaten" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: '[Content_Types].xml', data: enc.encode('<Types></Types>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode('<worksheet/>') }
  ];
  api.injiziereZusatzblaetterV255(entries, true); // leer = Blanko-Modus
  const fBlatt = dec.decode(entries.find(e => e.name === 'xl/worksheets/zusatzFaehigkeitenV255.xml').data);
  const wBlatt = dec.decode(entries.find(e => e.name === 'xl/worksheets/zusatzWohnenV255.xml').data);
  assert.ok(fBlatt.includes('Kommunikation und Verständigung'), 'Bereichszeilen müssen als Struktur vorhanden sein');
  assert.ok(!fBlatt.includes('GEHEIME FALLDATEN'), 'Falldaten dürfen nicht in die Blanko-Vorlage');
  assert.ok(wBlatt.includes('Wohnsicherheit'), 'Wohn-Abschnitte müssen als Struktur vorhanden sein');
  assert.ok(!wBlatt.includes('GEHEIM'), 'Wohn-Falldaten dürfen nicht in die Blanko-Vorlage');
  // und die Verdrahtung: bereinigte Vorlagen-Einträge werden markiert
  assert.match(html, /const sanKernV255=window\.boSanitizeXlsxEntries/);
  assert.match(html, /__blankoV255/);
  // Gürtel+Hosenträger (Nutzerfund 15.08.: Download kam als rohe Basis ohne Blätter):
  // der Vorlagen-Download prüft das Ergebnis und injiziert fehlende Blätter nach.
  assert.match(html, /const vorlagenKernV255=window\.__curatedTemplateBytesAsync/);
  assert.match(html, /if\(!hat\('fahigkeiten'\)\|\|!hat\('wohnen'\)\)/);
  assert.match(html, /injiziereZusatzblaetterV255\(entries,true\)/);
});

test('Stammdaten-Kuration erhält stabile sheetId-Werte und entfernt eine veraltete calcChain vollständig', () => {
  const { api } = ladeApi();
  const enc = new TextEncoder(), dec = new TextDecoder();
  const entries = [
    { name: '[Content_Types].xml', data: enc.encode('<Types><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/><Override PartName="/xl/workbook.xml" ContentType="x"/></Types>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<Relationships><Relationship Id="rIdCalc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: enc.encode('<workbook><sheets><sheet name="01 - Stammdaten" sheetId="8" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/calcChain.xml', data: enc.encode('<calcChain><c r="B10" i="8"/></calcChain>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode('<worksheet/>') }
  ];

  const result = api.bereinigeCalcChainV170(entries);
  assert.equal(result, entries, 'die Eintragsliste soll in-place bereinigt werden, damit auch bestehende Aufrufer profitieren');
  assert.ok(!entries.some(entry => entry.name === 'xl/calcChain.xml'), 'calcChain-Part darf nicht weitergepackt werden');
  assert.ok(!dec.decode(entries.find(entry => entry.name === '[Content_Types].xml').data).includes('calcChain'), 'Content-Type-Verweis muss entfernt werden');
  assert.ok(!dec.decode(entries.find(entry => entry.name === 'xl/_rels/workbook.xml.rels').data).includes('calcChain'), 'Workbook-Relationship muss entfernt werden');
  assert.match(dec.decode(entries.find(entry => entry.name === 'xl/workbook.xml').data), /sheetId="8"/, 'sheetId der Vorlage bleibt stabil');

  assert.match(html, /ordered\.forEach\(sheet=>sheetsParent\.appendChild\(sheet\)\)/,
    'die Blattreihenfolge muss durch Verschieben, nicht durch Neuvergabe der sheetId entstehen');
  assert.doesNotMatch(html, /sheet\.setAttribute\('sheetId',String\(index\+1\)\)/,
    'die fehlerauslösende sheetId-Neunummerierung darf nicht zurückkehren');
  assert.match(html, /const finalEntries=typeof window\.__ordneUndKuriereArbeitsmappeV170===['"]function['"]\?window\.__ordneUndKuriereArbeitsmappeV170\(entries\):entries/,
    'auch der direkte buildCompatibleZip-Weg muss die Kuration immer durchlaufen');
});

test('die echte Stammdaten-Vorlage behält ihre calcChain-kompatiblen Blatt-IDs und wird paketweit bereinigt', () => {
  const { api } = ladeApi();
  const eingebettet = html.match(/stammdaten:\{name:'Stammdaten',b64:'([^']+)'\}/);
  assert.ok(eingebettet, 'eingebettete Stammdaten-Vorlage fehlt');
  const vorlage = Buffer.from(eingebettet[1], 'base64');
  const wb = leseZipTeil(vorlage, 'xl/workbook.xml').toString('utf8');
  const chain = leseZipTeil(vorlage, 'xl/calcChain.xml').toString('utf8');
  const ids = [...wb.matchAll(/sheetId="(\d+)"/g)].map(match => Number(match[1]));
  const chainIds = [...chain.matchAll(/\bi="(\d+)"/g)].map(match => Number(match[1]));
  assert.ok(ids.some((id, index) => id !== index + 1), 'die echte Vorlage muss nicht-fortlaufende stabile Blatt-IDs besitzen');
  assert.ok(chainIds.length > 0 && chainIds.every(id => ids.includes(id)), 'die Ausgangsvorlage muss eine konsistente Berechnungskette besitzen');

  const entries = [
    { name: '[Content_Types].xml', data: new Uint8Array(leseZipTeil(vorlage, '[Content_Types].xml')) },
    { name: 'xl/_rels/workbook.xml.rels', data: new Uint8Array(leseZipTeil(vorlage, 'xl/_rels/workbook.xml.rels')) },
    { name: 'xl/workbook.xml', data: new Uint8Array(leseZipTeil(vorlage, 'xl/workbook.xml')) },
    { name: 'xl/calcChain.xml', data: new Uint8Array(leseZipTeil(vorlage, 'xl/calcChain.xml')) }
  ];
  api.bereinigeCalcChainV170(entries);
  assert.ok(!entries.some(entry => entry.name === 'xl/calcChain.xml'));
  assert.ok(!new TextDecoder().decode(entries.find(entry => entry.name === '[Content_Types].xml').data).includes('calcChain'));
  assert.ok(!new TextDecoder().decode(entries.find(entry => entry.name === 'xl/_rels/workbook.xml.rels').data).includes('calcChain'));
  assert.deepEqual([...new TextDecoder().decode(entries.find(entry => entry.name === 'xl/workbook.xml').data).matchAll(/sheetId="(\d+)"/g)].map(match => Number(match[1])), ids,
    'die Bereinigung darf die stabilen Blatt-IDs der echten Vorlage nicht verändern');
});

test('Server- und eingebettete Stammdaten-Vorlage sind die kuratierte Nutzerdatei vom 31.08.2026', () => {
  const expected = 'cc0483a2b395f318db34b48ff3be00b3fa5a6a3d76e6aee055fefa6db2ddf5ed';
  const serverTemplate = fs.readFileSync(path.join(__dirname, '..', 'assets', 'templates', 'Stammdaten_blank.xlsx'));
  const embedded = html.match(/stammdaten:\{name:'Stammdaten',b64:'([^']+)'\}/);
  assert.ok(embedded, 'eingebettete Stammdaten-Vorlage fehlt');
  const embeddedTemplate = Buffer.from(embedded[1], 'base64');
  const sha = value => crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(sha(serverTemplate), expected, 'Server-Blankovorlage weicht von der kuratierten Nutzerdatei ab');
  assert.equal(sha(embeddedTemplate), expected, 'eingebettete Generatorvorlage weicht von der kuratierten Nutzerdatei ab');
  assert.deepEqual(embeddedTemplate, serverTemplate, 'beide Vorlagenquellen müssen byte-identisch sein');
});

test('Bedarfe & Wille wird trotz XML-Entity im Blattnamen in die kuratierte Zeile 5 gefüllt', () => {
  assert.ok(html.includes(".replace(/&amp;/g,'&')"),
    'die kuratierte Blattsuche muss &amp; vor dem Namensvergleich dekodieren');
  assert.match(html, /__fillCuratedSheet\(entries,\{matchKey:'bedarfe wille',headerLastRow:4,firstDataRow:5,rows,fixedCells:\[\{ref:'A2',v:stand\}\]\}\)/,
    'Bedarfe & Wille muss die kuratierte Kopfzeile 4 erhalten und Daten ab Zeile 5 schreiben');
});

test('Betreuungsverlauf erweitert den kuratierten Zeilenstil', () => {
  assert.match(html, /stammdatenCloneRowStyle\(doc,last\+1,rn\);phase4SetCell\(doc,rn,'A',r\[0\],true\)/,
    'zusätzliche Verlaufszeilen müssen den kuratierten Zeilenstil übernehmen');
});
