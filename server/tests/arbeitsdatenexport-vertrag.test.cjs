'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const backupData = require('../src/modules/backup/portable-data');

function fakeDb(tables) {
  return {
    prepare(sql) {
      const match = /FROM\s+"?([a-z0-9_]+)"?/i.exec(sql);
      const table = match && match[1];
      return {
        all() {
          if (!Object.hasOwn(tables, table)) {
            const error = new Error(`no such table: ${table}`);
            throw error;
          }
          return tables[table].map((row) => ({ ...row }));
        }
      };
    }
  };
}

test('Arbeitsdaten-Zusatzabbild enthält Zuständigkeiten, Verlauf und nur Dokumentmetadaten', () => {
  const payload = backupData.workExportData(fakeDb({
    users: [{
      id: 7, username: 'cz', display_name: 'Christoph Zepp', first_name: 'Christoph',
      last_name: 'Zepp', active: 1, is_admin: 1, allow_local: 1, allow_online: 1,
      allow_mode_switch: 1, permissions_json: '{"online":{"viewCases":true}}',
      password_hash: 'DARF-NICHT-REISEN', notes: 'interne Personalnotiz', is_demo: 0
    }, {
      id: 8, username: 'DemoAdmin1', display_name: 'Demo-Admin 1', active: 1,
      is_admin: 1, is_demo: 1, password_hash: 'DEMO-DARF-NICHT-REISEN'
    }],
    cases: [
      { id: 'fall-1', label: 'Musterfall', file_number: 'AZ 1', archived: 0, owner_user_id: 7 },
      { id: 'de300001-0000-4000-8000-000000000001', label: 'Auerbach, Margarete', file_number: 'DEMO', archived: 0, owner_user_id: 7 }
    ],
    case_access: [
      { case_id: 'fall-1', user_id: 7, level: 'write', created_at: '2026-08-30', created_by: 7 },
      { case_id: 'fall-1', user_id: 8, level: 'read', created_at: '2026-08-30', created_by: 8 }
    ],
    audit_log: [
      { id: 1, actor_user_id: 7, actor_username: 'cz', action: 'case.read', target_type: 'case', target_id: 'fall-1', case_id: 'fall-1', kategorie: 'Auskunft', zweck: 'Betreuung', details_json: '{"grund":"Prüfung"}' },
      { id: 2, actor_user_id: 8, actor_username: 'DemoAdmin1', action: 'demo.read', target_type: 'case', target_id: 'demo', details_json: '{}' },
      { id: 3, actor_user_id: null, actor_username: '', action: 'auth.login_failed', target_type: 'auth', target_id: '', details_json: '{"username":"Demo"}' },
      { id: 4, actor_user_id: 7, actor_username: 'cz', action: 'case.read', target_type: 'case', target_id: 'de300001-0000-4000-8000-000000000001', case_id: 'de300001-0000-4000-8000-000000000001', details_json: '{}' }
    ],
    doc_folders: [{ id: 'ordner-1', area: 'case', case_id: 'fall-1', parent_id: '', name: 'Bescheide', sort_order: 1 }],
    doc_files: [
      { id: 'datei-1', area: 'case', case_id: 'fall-1', folder_id: 'ordner-1', name: 'Bescheid.pdf', mime_type: 'application/pdf', size: 123, pages: 2, sha256: 'abc', ocr_status: 'done' },
      { id: 'datei-2', area: 'management', case_id: '', folder_id: '', name: 'intern.pdf', size: 5 }
    ]
  }));

  assert.equal(payload.users[0].username, 'cz');
  assert.equal(payload.users[0].permissions.online.viewCases, true);
  assert.equal(payload.caseAssignments[0].ownerUsername, 'cz');
  assert.equal(payload.caseAssignments[0].access[0].level, 'write');
  assert.equal(payload.caseAssignments[0].access.length, 1, 'Demo-Fallfreigabe darf nicht reisen');
  assert.equal(payload.processingHistory[0].details.grund, 'Prüfung');
  assert.equal(payload.processingHistory.length, 1, 'Demo-Verlauf darf nicht reisen');
  assert.deepEqual(payload.documentIndex.map((entry) => entry.name), ['Bescheid.pdf']);
  assert.equal(payload.documentIndex[0].folderPath, 'Bescheide');

  const serialized = JSON.stringify(payload);
  for (const forbidden of ['DARF-NICHT-REISEN', 'password_hash', 'api_key_encrypted']) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} darf nicht im Arbeitsdatenabbild stehen`);
  }
  assert.ok(!Object.hasOwn(payload, 'sessions'));
  assert.equal(payload.exclusions.documentBytes, true);
  assert.equal(payload.exclusions.recoveryFiles, true);
  assert.equal(payload.exclusions.demoModeData, true);
  assert.deepEqual(payload.users.map((user) => user.username), ['cz']);
  assert.deepEqual(payload.caseAssignments.map((entry) => entry.caseId), ['fall-1']);
});

test('Büro-/Moduldaten lassen reine Demo-Chats, Status und Anlagen vollständig draußen', () => {
  const db = fakeDb({
    users: [
      { id: 7, username: 'cz', is_demo: 0 },
      { id: 8, username: 'Demo1', is_demo: 1 }
    ],
    chat_conversations: [
      { id: 'echt', created_by: 7 },
      { id: 'demo', created_by: 8 }
    ],
    chat_participants: [
      { conversation_id: 'echt', user_id: 7 },
      { conversation_id: 'demo', user_id: 8 }
    ],
    chat_messages: [
      { id: 'm-echt', conversation_id: 'echt', sender_user_id: 7, body: 'ARBEIT' },
      { id: 'm-demo', conversation_id: 'demo', sender_user_id: 8, body: 'VORFUEHRUNG' }
    ],
    chat_attachments: [
      { id: 'a-echt', message_id: 'm-echt', name: 'arbeit.txt', data: Buffer.from('x') },
      { id: 'a-demo', message_id: 'm-demo', name: 'demo.txt', data: Buffer.from('y') }
    ],
    chat_user_status: [
      { user_id: 7, status: 'online' },
      { user_id: 8, status: 'online' }
    ],
    office_json: [
      { key: 'demo_modus', data_json: '{"an":true}' },
      { key: 'datenschutz', data_json: '{"arbeitsstand":true}' }
    ]
  });

  for (const payload of [backupData.officeData(db), backupData.moduleData(db)]) {
    const tables = payload.tables || payload;
    const pick = (officeName, moduleName) => tables[officeName] || tables[moduleName] || [];
    assert.deepEqual(pick('chat_conversations', 'chatConversations').map((row) => row.id), ['echt']);
    assert.deepEqual(pick('chat_participants', 'chatParticipants').map((row) => row.conversation_id), ['echt']);
    assert.deepEqual(pick('chat_messages', 'chatMessages').map((row) => row.id), ['m-echt']);
    assert.deepEqual(pick('chat_attachments', 'chatAttachments').map((row) => row.id), ['a-echt']);
    assert.deepEqual(pick('chat_user_status', 'chatUserStatus').map((row) => row.user_id), [7]);
    assert.deepEqual(pick('office_json', 'officeJson').map((row) => row.key), ['datenschutz']);
    assert.ok(!JSON.stringify(payload).includes('VORFUEHRUNG'));
  }
});

test('Serverabbilder entfernen alte Demo-Fälle samt Personen, Kalender, Fahrten und JSON-Verweisen', () => {
  const demoCaseId = 'de300001-0000-4000-8000-000000000001';
  const db = fakeDb({
    users: [{ id: 7, username: 'admin', is_demo: 0 }, { id: 8, username: 'Demo1', is_demo: 1 }],
    persons: [{ id: 'p-real', user_id: 7 }, { id: 'p-demo', user_id: 8 }],
    cases: [{ id: 'fall-1', label: 'Echtfall' }, { id: demoCaseId, label: 'Auerbach, Margarete' }],
    mileage_trips: [
      { id: 'fahrt-real', case_label: 'Echtfall', fahrer_user_id: 7 },
      { id: 'fahrt-demo', case_label: 'Auerbach, Margarete', fahrer_user_id: 7 }
    ],
    outgoing_invoices: [
      { id: 're-real', case_label: 'Echtfall' },
      { id: 're-demo', case_label: 'Auerbach, Margarete' }
    ],
    calendar_events: [{ id: 'ev-real', case_id: 'fall-1' }, { id: 'ev-demo', case_id: demoCaseId }],
    todos: [{ id: 'td-real', case_id: 'fall-1' }, { id: 'td-demo', case_id: demoCaseId }],
    calendar_event_attachments: [{ id: 'ea-real', event_id: 'ev-real' }, { id: 'ea-demo', event_id: 'ev-demo' }],
    todo_attachments: [{ id: 'ta-real', todo_id: 'td-real' }, { id: 'ta-demo', todo_id: 'td-demo' }],
    doc_files: [{ id: 'df-real', case_id: 'fall-1' }, { id: 'df-demo', case_id: demoCaseId }],
    doc_links: [{ id: 'dl-real', file_id: 'df-real' }, { id: 'dl-demo', file_id: 'df-demo' }],
    office_json: [{ key: 'kontaktmonitor', data_json: JSON.stringify({ entries: [
      { caseId: 'fall-1', personId: 'p-real' },
      { caseId: demoCaseId, personId: 'p-demo' }
    ] }) }]
  });

  const office = backupData.officeData(db).tables;
  const module = backupData.moduleData(db);
  const calendar = backupData.calendarTodoData(db);
  assert.deepEqual(office.persons.map((row) => row.id), ['p-real']);
  assert.deepEqual(module.persons.map((row) => row.id), ['p-real']);
  assert.deepEqual(module.cases.map((row) => row.id), ['fall-1']);
  assert.deepEqual(office.mileage_trips.map((row) => row.id), ['fahrt-real']);
  assert.deepEqual(module.outgoingInvoices.map((row) => row.id), ['re-real']);
  assert.deepEqual(calendar.calendarEvents.map((row) => row.id), ['ev-real']);
  assert.deepEqual(calendar.calendarEventAttachments.map((row) => row.id), ['ea-real']);
  assert.deepEqual(calendar.todoAttachments.map((row) => row.id), ['ta-real']);
  assert.deepEqual(module.docLinks.map((row) => row.id), ['dl-real']);
  assert.deepEqual(JSON.parse(office.office_json[0].data_json).entries, [{ caseId: 'fall-1', personId: 'p-real' }]);
  assert.ok(!JSON.stringify({ office, module, calendar }).includes(demoCaseId));
});

test('Auslieferung pinnt Umfang, Tabellenvertrag und Excel-Zeilenreparatur', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
    'utf8'
  );
  assert.match(html, /\/api\/admin\/work-export-data/);
  assert.match(html, /Benutzer Rollen Zuständigkeiten\.json/);
  assert.match(html, /Verarbeitungsverlauf\.json/);
  assert.match(html, /Dokumentenindex\.csv/);
  assert.match(html, /Tabellenvertraege\.json/);
  assert.match(html, /name:'Büroorganisation\/EXPORT-INFO\.json'/);
  assert.match(html, /name:'Büroorganisation\/Pruefsummen\.sha256'/);
  assert.match(html, /name:'Büroorganisation\/WAS-FEHLT\.txt'/);
  assert.match(html, /name:'11 - Fähigkeiten & Alltag',rows:faehigkeitenAlltagToOdsRows/);
  assert.match(html, /name:'12 - Wohnen',rows:wohnenToOdsRows/);
  assert.match(html, /async function odsToSheets\(bytes,options\)/,
    'Mehrblatt-ODS kann für den Reimport nicht vollständig gelesen werden');
  assert.match(html, /async function workbookBytesToPortableSheets\(bytes,options\)/,
    'Die fertig befüllte Excel-Arbeitsmappe ist nicht die Quelle der portablen Zellmatrix');
  assert.match(html, /async function workbookBytesToOds\(bytes,options\)/,
    'Der gemeinsame XLSX-zu-ODS-Konverter fehlt');
  assert.match(html, /function rowsToOdsLayoutAware\(sheets\)/,
    'Der gemeinsame ODS-Generator spiegelt das sichtbare XLSX-Layout nicht');
  assert.match(html, /portableReadSheetLayout\(book,sh\)/,
    'Spaltenbreiten, Zeilenhöhen, Zellstile und verbundene Bereiche werden nicht aus XLSX gelesen');
  assert.match(html, /async function stammdatenToOdsBytes\(caseData,xlsxBytes\)[\s\S]*?return workbookBytesToOds\(xlsxBytes,\{fileName:'Stammdaten\.xlsx',excludeSheets:\['Daten'\]\}\)/,
    'Stammdaten-ODS wird nicht aus der fertig befüllten XLSX gespiegelt');
  assert.match(html, /async function adressverzeichnisToOdsBytes\(contacts,xlsxBytes\)[\s\S]*?return workbookBytesToOds\(xlsxBytes,\{fileName:'Adressverzeichnis\.xlsx',excludeSheets:\['Daten'\]\}\)/,
    'Adressverzeichnis-ODS wird nicht aus der fertig befüllten XLSX gespiegelt');
  assert.equal((html.match(/await stammdatenToOdsBytes\(state\.caseData\|\|\{\},masterBytesForOds\)/g) || []).length, 3,
    'Nicht alle drei Sicherungswege reichen die erzeugte Stammdaten-XLSX an ODS weiter');
  assert.equal((html.match(/await adressverzeichnisToOdsBytes\(state\.caseData\?\.contacts\|\|\[\],addressBytesForOds\)/g) || []).length, 3,
    'Nicht alle drei Sicherungswege reichen die erzeugte Adressverzeichnis-XLSX an ODS weiter');
  assert.match(html, /const ods=await workbookBytesToOds\(bytes,\{[\s\S]*?fileName:'Betreuungsorganisation\.xlsx',[\s\S]*?sheetsOverride:sheets[\s\S]*?\}\);/,
    'Die Betreuungsorganisation-ODS wird nicht aus derselben fertig befüllten XLSX erzeugt');
  assert.match(html, /function rowsToXlsxMulti\(sheets\)/,
    'Der gemeinsame Mehrblatt-XLSX-Generator für das büroweite Fahrtenbuch fehlt');
  assert.match(html, /window\.__mileageBuildCuratedBook=mileageBuildCuratedBook;/,
    'Der kuratierte XLSX-Fahrtenbuchgenerator ist nicht als gemeinsamer Vertragsweg verfügbar');
  assert.match(html, /window\.__mileageBuildCuratedOds=mileageBuildCuratedOds;/,
    'Der kuratierte ODS-Fahrtenbuchgenerator ist nicht als gemeinsamer Vertragsweg verfügbar');
  assert.match(html, /const sheets=\[\{name:'Fahrtenbuch',rows\},\{name:'Fahrzeuge',rows:vRows\}\];[\s\S]*?xlsx=rowsToXlsxMulti\(sheets\);[\s\S]*?ods=await workbookBytesToOds\(xlsx,/,
    'XLSX und ODS der büroweiten Fahrtenbuchsicherung stammen nicht aus demselben Blattvertrag');
  assert.match(html, /mb\.xlsx&&mb\.xlsx\.length[\s\S]*?Fahrtenbuch \(alle Fahrten\)\.xlsx/,
    'Die büroweite Sicherung enthält kein XLSX-Gegenstück zum ODS-Fahrtenbuch');
  assert.match(html, /if\(c\.format==='ods'&&\(c\.sheets\|\|\[\]\)\.some\(s=>norm\(s\.name\)\.includes\('betreuungsverlauf'\)\)\)/,
    'Der Mehrblatt-ODS-Reimport fällt noch auf das alte flache Stammdatenformat zurück');
  assert.match(html, /const sortedRows=rows\.slice\(\)\.sort/);
  assert.match(html, /sortedRows\.forEach\(row=>sheetData\.appendChild\(row\)\)/);
  assert.match(html, /order:\{prefix:\['Bürostammdaten','Organisation','Qualifikationen','Büro-Adressbuch'/);
  assert.match(html, /documentStoreBytes:true,serverDatabaseImage:true,sessions:true/);
  assert.match(html, /if\(backupMode==='demo'\|\|window\.__demoModus\)/);
  assert.match(html, /usersResp\.users\.filter\(u=>!boIstDemoNutzer\(u\)\)/);
  assert.match(html, /if\(window\.__demoModus\)throw new Error\('Demo-Daten werden nicht exportiert\.'\)/);
  assert.match(html, /const data=boArbeitsdatenOhneDemo\(dataOverride\|\|await boCollectData\(\)\)/);
  assert.match(html, /if\(arbeitsdatenIstDemoFallV171\(fall\.id\)\)continue/);
  assert.match(html, /const eBase=39\+off1;/,
    'Die Mitarbeitenden beginnen nicht in der kuratierten Datenzeile 39');
  assert.match(html, /const empCap=\(41\+off1\)-eBase-1;/,
    'Vor dem Mail-Signatur-Block ist keine feste Leerzeile reserviert');
  assert.match(html, /if\(banks\.length>2\)\{off1=banks\.length-2;boInsertRows\(doc,35,off1,33\)\}/,
    'Die Banktabelle wächst nicht aus den beiden kuratierten Datenzeilen heraus');
  assert.match(html, /const iw=w\.block\(5\);[\s\S]*?const rn=5\+i;/,
    'Ausgangsrechnungen beginnen nicht unter der neuen Kopfzeile 4');
  assert.match(html, /const bw=w\.block\(6\);[\s\S]*?const rn=6\+i;/,
    'Eingangsrechnungen/Buchhaltung beginnen nicht unter der neuen Kopfzeile 5');
  assert.match(html, /if\(vs\.length>2\)\{vIns=vs\.length-2;boInsertRows\(doc,6,vIns,4\)\}/,
    'Die Fahrzeugtabelle verschiebt den Kilometersatzblock nicht aus der kuratierten Zeile 6');
  assert.match(html, /const rBase=8\+vIns;/,
    'Kilometersätze beginnen nicht in der kuratierten Datenzeile 8');
  assert.match(html, /boConvCol\(rows,'A','date',5\);boConvCol\(rows,'H','date',5\);/,
    'ODS/CSV bereiten Ausgangsrechnungen nicht ab der kuratierten Datenzeile 5 nach');
  assert.match(html, /boCellSet\(rows,5\+i,'J'/,
    'ODS/CSV schreiben die Rechnungsdifferenz nicht in dieselbe Zeile wie XLSX');
  assert.match(html, /name==='Buchhaltung'\|\|name==='Eingangsrechnungen'\)boConvCol\(rows,'A','date',6\)/,
    'ODS/CSV bereiten Buchhaltung und Eingangsrechnungen nicht ab der kuratierten Datenzeile 6 nach');
  assert.match(html, /ew\(rn,'J',boGermanDate\([\s\S]*?\),'text'\);/,
    'Mitarbeitenden-Eintrittsdaten würden im Allgemeinformat als Excel-Serial erscheinen');
  assert.match(html, /boGermanDate\(fr\.baseDate\|\|''\),[\s\S]*?boGermanDate\(fr\.dueDate\|\|''\),/,
    'Fristdaten würden im Allgemeinformat als Excel-Serial erscheinen');
  assert.match(html, /if\(blank&&seeds\[col\]!==undefined\)blank\.setAttribute\('s',seeds\[col\]\)/,
    'Leere Tabellenfelder übernehmen den Rahmen-Prototyp nicht');
  assert.match(html, /if\(cell&&seeds\[col\]!==undefined\)cell\.setAttribute\('s',seeds\[col\]\)/,
    'Reservezeilen werden beim Befüllen nicht auf den Rahmen-Prototyp umgestellt');
});

test('Browservertrag entfernt Demo-Konten, Personen, Fälle und Fahrten vor XLSX/ODS/CSV/JSON', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
    'utf8'
  );
  const start = html.indexOf('const BO_DEMO_FAELLE=Object.freeze([');
  const endMarker = 'window.__boArbeitsdatenOhneDemo=boArbeitsdatenOhneDemo;';
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'Demo-Bereinigungsvertrag fehlt in der Auslieferung');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(`${html.slice(start, end + endMarker.length)}\nthis.clean=boArbeitsdatenOhneDemo;`, ctx);

  const demoId = 'de300001-0000-4000-8000-000000000001';
  const result = ctx.clean({
    users: [{ username: 'admin' }, { username: 'Demo1', isDemo: true }, { username: 'DemoAdmin20' }],
    officeEmployees: [
      { id: 'real', firstName: 'Christoph', extra: { username: 'admin' } },
      { id: 'demo-person', firstName: '', extra: { username: 'Demo1' } }
    ],
    persons: [{ id: 'real', username: 'admin' }, { id: 'demo-person', username: 'DemoAdmin1' }],
    trips: [{ id: 'real-trip', caseLabel: 'Echtfall' }, { id: 'demo-trip', caseLabel: 'Auerbach, Margarete' }],
    events: [{ id: 'real-event', caseId: 'fall-1' }, { id: 'demo-event', caseId: demoId }],
    bueroAddress: [
      { id: 'contact-demo', __cases: 'Auerbach, Margarete; Auerbach, Margarete (DEMO-AZ)' },
      { id: 'contact-real', __cases: 'Echtfall; Auerbach, Margarete' }
    ],
    fristenCaseLabel: 'Auerbach, Margarete',
    workExport: {
      caseAssignments: [{ caseId: 'fall-1' }, { caseId: demoId }],
      processingHistory: [{ id: 1, details: { username: 'Demo' } }, { id: 2, actorUsername: 'admin' }]
    },
    moduleData: {
      cases: [{ id: 'fall-1', label: 'Echtfall' }, { id: demoId, label: 'Auerbach, Margarete' }],
      officeJson: [{ key: 'kontaktmonitor', data_json: JSON.stringify({ entries: [
        { caseId: demoId, note: 'Vorführung' }, { caseId: 'fall-1', note: 'Arbeit' }
      ] }) }]
    }
  });

  assert.deepEqual(Array.from(result.users, (row) => row.username), ['admin']);
  assert.deepEqual(Array.from(result.officeEmployees, (row) => row.id), ['real']);
  assert.deepEqual(Array.from(result.persons, (row) => row.id), ['real']);
  assert.deepEqual(Array.from(result.trips, (row) => row.id), ['real-trip']);
  assert.deepEqual(Array.from(result.events, (row) => row.id), ['real-event']);
  assert.deepEqual(Array.from(result.bueroAddress, (row) => row.id), ['contact-real']);
  assert.equal(result.bueroAddress[0].__cases, 'Echtfall');
  assert.equal(Object.hasOwn(result, 'fristenCaseLabel'), false);
  assert.deepEqual(Array.from(result.workExport.caseAssignments, (row) => row.caseId), ['fall-1']);
  assert.deepEqual(Array.from(result.workExport.processingHistory, (row) => row.id), [2]);
  const nested = JSON.parse(result.moduleData.officeJson[0].data_json);
  assert.deepEqual(Array.from(nested.entries, (row) => row.caseId), ['fall-1']);
  assert.deepEqual(Array.from(result.moduleData.cases, (row) => row.id), ['fall-1']);
  assert.ok(!JSON.stringify(result).includes(demoId));
  assert.ok(!JSON.stringify(result).includes('Demo1'));
});
