'use strict';

/* Pruefstand fuer die Restluecken-Behebung des Voll-Audits vom 25.08.2026 abends
   (Lokalmodus, alle in der Auslieferungsdatei):

     1. loadBueroLocal-Whitelist (SECHSTE Auspraegung der dokumentierten Falle):
        fileNameTemplates, subjectTemplates, downloadTarget, aiPromptPresets und
        aiPromptOverrides ueberleben das Neuladen.
     2. Lokal-Export: die fuenf ui_prefs-Felder und mode_intro_seen wandern mit,
        der Sammler traegt lokale Unterschriften-Bilder, bdocDocs und die
        vollstaendige Betreuungsuebersicht-Historie, die Kalender-JSON die
        Aufgaben-Handsortierung.
     3. Import: alles kommt zurueck, OHNE gepflegte Arbeit zu ueberschreiben
        (Kennungs-Dedupe bzw. Nur-bei-Leerstand, Muster der 25.08.-Merges).

   Wie in html-buero-json-sicherung.test.cjs wird der Code AUS DER AUSLIEFERUNGS-
   DATEI geschnitten und in vm-Kontexten AUSGEFUEHRT - gemessen wird die
   Auslieferung, kein Nachbau. Nur localStorage/daToast sind triviale Stubs. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

/* Startanker muss eindeutig sein - sonst prueft der Test womoeglich eine falsche
   Stelle und luegt gruen (gleiche Strenge wie in den Schwester-Pruefstaenden). */
function schnipsel(von, bis) {
  const a = html.indexOf(von);
  assert.ok(a >= 0, `Anker fehlt in der Auslieferungsdatei: ${von}`);
  assert.equal(html.indexOf(von, a + 1), -1, `Anker ist nicht eindeutig: ${von}`);
  const b = html.indexOf(bis, a);
  assert.ok(b > a, `Endanker fehlt hinter "${von}": ${bis}`);
  return html.slice(a, b);
}

/* Wegwerf-localStorage: gleiches Verhalten wie im Browser, aber pruefbar. */
function speicherStub(anfang) {
  const ablage = Object.assign({}, anfang || {});
  return {
    getItem: (k) => (k in ablage ? ablage[k] : null),
    setItem: (k, v) => { ablage[k] = String(v); },
    _roh: ablage
  };
}

/* ═══════════ 1. Whitelist: die fuenf ui_prefs-Bestaende ueberleben das Neuladen ═══════════ */

test('loadBueroLocal: Vorlagen, Speicherort und KI-Prompts ueberleben das Neuladen (ausgefuehrt)', () => {
  const kern = schnipsel('function loadBueroLocal(){', 'function saveBueroLocal(){');
  const gespeichert = JSON.stringify({
    fileNameTemplates: { rechnung: '<datum> Rechnung' },
    subjectTemplates: { anschreiben: 'Betreff <fall>' },
    downloadTarget: 'intern',
    aiPromptPresets: { mail: ['Fasse zusammen'] },
    aiPromptOverrides: { 'case-chat': 'Du bist knapp.' },
    voelligFremd: 'bleibt draussen'
  });
  const ctx = {
    console,
    BUERO_LOCAL_KEY: 'betreuungsbuero.bueroLocal.v1',
    localStorage: speicherStub({ 'betreuungsbuero.bueroLocal.v1': gespeichert }),
    emptyOfficeProfile: () => ({}),
    emptyMapSettings: () => ({ activeProvider: 'osm', googleMapsApiKey: '', hereApiKey: '' })
  };
  vm.createContext(ctx);
  vm.runInContext(`${kern}\nthis.L=loadBueroLocal();`, ctx, { filename: 'load-buero-local-restluecken.js' });
  const L = ctx.L;
  assert.equal(L.fileNameTemplates.rechnung, '<datum> Rechnung', 'Dateinamen-Vorlagen werden weiterhin beim Neuladen verworfen');
  assert.equal(L.subjectTemplates.anschreiben, 'Betreff <fall>', 'Betreff-Vorlagen (Betreff-Editor) gehen weiterhin beim Neuladen verloren');
  assert.equal(L.downloadTarget, 'intern', 'die eigene Speicherort-Wahl geht weiterhin beim Neuladen verloren');
  assert.deepEqual(Array.from(L.aiPromptPresets.mail), ['Fasse zusammen'], 'eigene KI-Schnellprompts gehen weiterhin verloren');
  assert.equal(L.aiPromptOverrides['case-chat'], 'Du bist knapp.', 'KI-Prompt-Anpassungen gehen weiterhin verloren');
  assert.equal(L.voelligFremd, undefined, 'die Whitelist laesst ploetzlich Fremdfelder durch');

  /* Unsinnige Speicherort-Werte werden zu '' (= Buero-Vorgabe) - kein Durchreichen von Muell. */
  ctx.localStorage = speicherStub({ 'betreuungsbuero.bueroLocal.v1': JSON.stringify({ downloadTarget: 'quatsch' }) });
  vm.runInContext('this.L2=loadBueroLocal();', ctx, { filename: 'load-buero-local-restluecken-2.js' });
  assert.equal(ctx.L2.downloadTarget, '', 'unbekannte Speicherort-Werte muessen zur Buero-Vorgabe werden');
});

/* ═══════════ 2. Lokal-Export: ui_prefs-Anbau + mode_intro_seen (volle Funktion) ═══════════ */

/* Fuehrt die KOMPLETTE Anreicherungsfunktion im Lokalmodus aus - derselbe Weg, den
   Gesamtsicherungs-ZIP und Einzel-Export teilen (Muster: sicherung-vollstaendigkeit). */
async function angereichertLokal(L, ls) {
  const kern = schnipsel('async function daBueroDatenAngereichert(){', '\nwindow.__bueroorgCollectDataAngereichert=daBueroDatenAngereichert;')
    + '\nwindow.__bueroorgCollectDataAngereichert=daBueroDatenAngereichert;';
  const ctx = { console, localStorage: ls || speicherStub() };
  ctx.window = { __bueroorgCollectData: async () => ({}), bueroLocal: L };
  vm.createContext(ctx);
  vm.runInContext(kern, ctx, { filename: 'da-angereichert-restluecken.js' });
  return await ctx.window.__bueroorgCollectDataAngereichert();
}

test('Lokal-Export: die fuenf ui_prefs-Felder und mode_intro_seen wandern mit (ausgefuehrt)', async () => {
  const data = await angereichertLokal({
    fileNameTemplates: { rechnung: '<datum> Rechnung' },
    subjectTemplates: { anschreiben: 'Betreff <fall>' },
    downloadTarget: 'ask',
    aiPromptPresets: { mail: ['Fasse zusammen'] },
    aiPromptOverrides: { 'case-chat': 'Du bist knapp.' },
    modeIntroSeen: { version: 1, users: { 'local-browser': { localSeen: true } } },
    fileNameStyle: 'spaces'
  });
  const up = data.officeJson.ui_prefs;
  assert.equal(up.fileNameStyle, 'spaces', 'der gepinnte fileNameStyle-Kern muss weiter funktionieren');
  assert.equal(up.fileNameTemplates.rechnung, '<datum> Rechnung', 'Dateinamen-Vorlagen fehlen im Lokal-Export');
  assert.equal(up.subjectTemplates.anschreiben, 'Betreff <fall>', 'Betreff-Vorlagen fehlen im Lokal-Export');
  assert.equal(up.downloadTarget, 'ask', 'die Speicherort-Wahl fehlt im Lokal-Export');
  assert.deepEqual(Array.from(up.aiPromptPresets.mail), ['Fasse zusammen'], 'KI-Schnellprompts fehlen im Lokal-Export');
  assert.equal(up.aiPromptOverrides['case-chat'], 'Du bist knapp.', 'KI-Prompt-Anpassungen fehlen im Lokal-Export');
  assert.ok(data.officeJson.mode_intro_seen.users['local-browser'].localSeen,
    'modeIntroSeen fehlt im Lokal-Export - der Whitelist-Kommentar waere weiter gelogen');

  /* Ohne eigene Wahl: leere Maps + '' - der Import darf daraus nichts machen.
     (Object.keys statt deepEqual: die Objekte stammen aus dem vm-Realm.) */
  const leer = await angereichertLokal({});
  assert.equal(Object.keys(leer.officeJson.ui_prefs.fileNameTemplates).length, 0);
  assert.equal(leer.officeJson.ui_prefs.downloadTarget, '');
  assert.equal(leer.officeJson.mode_intro_seen, null);
});

/* ═══════════ 3. Import-Merge: ui_prefs + modeIntroSeen (Lueckenschluss-Block) ═══════════ */

function importLokalKontext() {
  const kern = schnipsel('          /* Lückenschluss 25.08.2026 (Gegenstück', '          const dsSic=data.officeJson.datenschutz;');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(`this.einspielen=function(L,data,localStorage,window){\n${kern}\n};`, ctx, { filename: 'import-merge-restluecken.js' });
  return ctx;
}

test('Import: Vorlagen-/Prompt-Maps mergen je Kennung, downloadTarget/modeIntroSeen nur bei Leerstand', () => {
  const ctx = importLokalKontext();
  const L = {
    subjectTemplates: { anschreiben: 'EIGENE Vorlage' },
    downloadTarget: 'ask',
    modeIntroSeen: { version: 1, users: { 'id-1': { localSeen: true } } }
  };
  ctx.einspielen(L, { officeJson: {
    ui_prefs: {
      subjectTemplates: { anschreiben: 'AUS SICHERUNG', mahnung: 'NEU' },
      fileNameTemplates: { rechnung: '<datum> Rechnung' },
      aiPromptPresets: { mail: ['Fasse zusammen'] },
      aiPromptOverrides: { 'case-chat': 'Knapp.' },
      downloadTarget: 'downloads'
    },
    mode_intro_seen: { version: 1, users: { 'id-9': { localSeen: true } } }
  } }, speicherStub(), {});
  assert.equal(L.subjectTemplates.anschreiben, 'EIGENE Vorlage', 'die gepflegte Betreff-Vorlage wurde ueberschrieben');
  assert.equal(L.subjectTemplates.mahnung, 'NEU', 'die fehlende Betreff-Vorlage wurde nicht ergaenzt');
  assert.equal(L.fileNameTemplates.rechnung, '<datum> Rechnung', 'Dateinamen-Vorlagen kommen nicht zurueck');
  assert.deepEqual(Array.from(L.aiPromptPresets.mail), ['Fasse zusammen'], 'KI-Schnellprompts kommen nicht zurueck');
  assert.equal(L.aiPromptOverrides['case-chat'], 'Knapp.', 'KI-Prompt-Anpassungen kommen nicht zurueck');
  assert.equal(L.downloadTarget, 'ask', 'die eigene Speicherort-Wahl wurde von der Sicherung ueberschrieben');
  assert.equal(L.modeIntroSeen.users['id-1'].localSeen, true, 'der gepflegte Intro-Stand wurde ueberschrieben');
  assert.equal(L.modeIntroSeen.users['id-9'], undefined, 'trotz gepflegtem Stand wurde die Sicherung eingemischt');

  /* Leerstand: Einzelwerte kommen aus der Sicherung. */
  const leer = { modeIntroSeen: { version: 1, users: {} } };
  ctx.einspielen(leer, { officeJson: {
    ui_prefs: { downloadTarget: 'intern' },
    mode_intro_seen: { version: 1, users: { 'id-9': { localSeen: true } } }
  } }, speicherStub(), {});
  assert.equal(leer.downloadTarget, 'intern', 'bei Leerstand muss die Speicherort-Wahl zurueckkommen');
  assert.ok(leer.modeIntroSeen.users['id-9'].localSeen, 'bei Leerstand muss der Intro-Stand zurueckkommen');

  /* Muell-Werte aus fremden Dateien duerfen nichts setzen. */
  const muell = {};
  ctx.einspielen(muell, { officeJson: { ui_prefs: { downloadTarget: 'quatsch' } } }, speicherStub(), {});
  assert.equal(muell.downloadTarget, undefined, 'ein unbekannter Speicherort-Wert darf nicht uebernommen werden');
});

/* ═══════════ 4. Sammler: Unterschriften, bdocDocs, Uebersichts-Historie (voll ausgefuehrt) ═══════════ */

async function sammlerLokal(L, ls) {
  /* boLoadBdocStore wird REAL geschnitten (das Feld docs ist Teil der Korrektur), ebenso der
     komplette Sammler ab boFetch. fetch existiert im vm bewusst NICHT - boFetch faengt den
     ReferenceError und liefert null, exakt der Offline-Weg des Lokalmodus. */
  const bdoc = schnipsel('function boLoadBdocStore(){', '\n');
  const kern = schnipsel('async function boFetch(url){', 'function boTripDriverName');
  const ctx = { console, localStorage: ls };
  ctx.window = {
    isBueroLocalMode: () => true,
    loadBueroLocal: () => L,
    __buLocalItems: () => [{ caseId: '1', aenderungsart: 'W' }]
  };
  ctx.boHalfYearStart = () => '2026-07-01';
  vm.createContext(ctx);
  vm.runInContext(`${bdoc}\n${kern}\nthis.sammeln=boCollectData;`, ctx, { filename: 'bo-collect-restluecken.js' });
  return await ctx.sammeln();
}

test('Sammler: lokale Unterschriften-Bilder, bdocDocs und die VOLLE Historie wandern mit (ausgefuehrt)', async () => {
  const ls = speicherStub({
    'betreuungsbuero.signatures.v1': JSON.stringify([
      { id: 's1', name: 'Chef', dataUrl: 'data:image/png;base64,AAAA', visibility: 'private', isOwn: true }
    ]),
    'betreuungsbuero.bueroDocs.v1': JSON.stringify({
      docs: { buero_brief: { fields: { bl_subject: { value: 'Aktueller Stand' } } } },
      archives: [{ id: 'a1', docId: 'buero_brief' }],
      sends: [{ id: 'v1', docId: 'buero_brief' }]
    })
  });
  const data = await sammlerLokal({
    buOverviewEntries: [
      { caseId: '1', periodStart: '2026-07-01', aenderungsart: 'W' },
      { caseId: '1', periodStart: '2026-01-01', aenderungsart: 'ALT' }
    ]
  }, ls);
  assert.equal(data.isLocal, true);
  /* (2) Unterschriften: bisher exportierte der Lokalzweig ein hartes [] - der ZIP-Kommentar
     nennt die signatureImages aber ausdruecklich als Restore-Argument der JSON. */
  assert.equal(data.signatureImages.length, 1, 'lokale Unterschriften-Bilder fehlen weiterhin im Export');
  assert.equal(data.signatureImages[0].name, 'Chef');
  /* (3) Buero-Dokumente: die AKTUELLEN Staende (docs) zusaetzlich zu Archiv/Versand. */
  assert.ok(data.bdocDocs.buero_brief, 'die aktuellen Buero-Dokument-Staende fehlen im Export');
  assert.equal(data.bdocArchives.length, 1);
  assert.equal(data.bdocSends.length, 1);
  /* (4) Historie: buActive traegt nur den aktuellen Zeitraum - buOverviewEntries ALLE. */
  assert.equal(data.buOverviewEntries.length, 2, 'aeltere Meldezeitraeume fehlen weiterhin im Export');
  assert.equal(data.buOverviewEntries[1].aenderungsart, 'ALT');
});

/* ═══════════ 4b. Sammler: lokal geht nichts hinaus (Fehlertest 30.08.2026) ═══════════ */

/* Sechs Abrufe (mileage rates/drivers, finance transactions/receipts, admin/users,
   send-mail/signature) waren als EINZIGE dieser Liste nicht modusbewusst. Lokal liegen alle
   /api-Routen hinter requireOnlineMode - es waren sechs sichere 403 bei jedem Start UND bei
   jedem Besuch von „Datenverwaltung" (daBueroPresent ruft den Sammler, 3-Sekunden-Cache).
   Der Sammler oben laesst fetch bewusst WEG; hier wird es gezaehlt - nur so ist messbar, was
   wirklich hinausgeht. */
async function sammlerMitZaehler(lokal) {
  const bdoc = schnipsel('function boLoadBdocStore(){', '\n');
  const kern = schnipsel('async function boFetch(url){', 'function boTripDriverName');
  const rufe = [];
  const ctx = { console, localStorage: speicherStub() };
  ctx.fetch = async (url) => {
    rufe.push(String(url).split('?')[0]);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  ctx.window = { isBueroLocalMode: () => lokal, loadBueroLocal: () => ({}), __buLocalItems: () => [] };
  ctx.boHalfYearStart = () => '2026-07-01';
  vm.createContext(ctx);
  vm.runInContext(`${bdoc}\n${kern}\nthis.sammeln=boCollectData;`, ctx, { filename: 'bo-collect-403.js' });
  return { rufe, daten: await ctx.sammeln() };
}

const NUR_ONLINE_ABRUFE = ['/api/mileage/rates', '/api/mileage/drivers', '/api/finance/transactions',
  '/api/finance/receipts', '/api/admin/users', '/api/send-mail/signature'];

test('Sammler: im Lokal-Modus geht keine einzige Server-Anfrage hinaus (ausgefuehrt)', async () => {
  const { rufe, daten } = await sammlerMitZaehler(true);
  assert.deepEqual(rufe, [], `Lokal wurden Server-Routen abgefragt (dort immer 403): ${rufe.join(', ')}`);
  /* Gegenprobe zur Absicht: die Werte bleiben, was sie vorher NACH dem 403 waren - das Gate
     aendert nur den Verkehr, nicht den Inhalt der Sicherung. */
  assert.equal(daten.users, null, 'die Nutzerliste ist lokal kein Server-Wert mehr');
  assert.equal(daten.mailSignature, '', 'die Mail-Signatur ist lokal kein Server-Wert mehr');
  for (const feld of ['rates', 'drivers', 'transactions', 'receipts']) {
    assert.deepEqual([...daten[feld]], [], `${feld} kommt lokal nicht mehr leer zurueck`);
  }
});

test('Sammler: online werden die sechs Server-Werte weiterhin geholt (Gegenprobe)', async () => {
  const { rufe } = await sammlerMitZaehler(false);
  for (const url of NUR_ONLINE_ABRUFE) {
    assert.ok(rufe.includes(url), `Online fehlt der Abruf ${url} - da wurde zu viel weggegatet`);
  }
});

/* ═══════════ 5. Import: Unterschriften/Buero-Dokumente/Historie zurueck (ausgefuehrt) ═══════════ */

function restoreKontext() {
  const kern = schnipsel('      // Unterschriften-Bilder LOKAL zurückspielen', '      // E-Mail-Vorlagen (büroweit + eigene)');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(`this.einspielen=async function(data,localStorage,window,daToast){\n${kern}\n};`, ctx, { filename: 'restore-restluecken.js' });
  return ctx;
}

test('Import: Unterschriften-Dedupe lokal, Buero-Dokumente additiv, Historie je (caseId,periodStart)', async () => {
  const ctx = restoreKontext();
  const ls = speicherStub({
    'betreuungsbuero.signatures.v1': JSON.stringify([{ id: 's1', name: 'Chef', dataUrl: 'data:image/png;base64,AAAA', visibility: 'private' }]),
    'betreuungsbuero.bueroDocs.v1': JSON.stringify({
      docs: { buero_brief: { fields: { f: 'GEPFLEGT' } } },
      archives: [{ id: 'a1' }], sends: [], favByDoc: { buero_brief: 'a1' }
    })
  });
  const toasts = [];
  const fenster = { bueroLocal: { buOverviewEntries: [{ caseId: '1', periodStart: '2026-01-01', aenderungsart: 'EIGEN' }] } };
  fenster.saveBueroLocal = () => { fenster._gespeichert = true; };
  await ctx.einspielen({
    /* 'Chef' OHNE visibility: die Normierung muss trotzdem auf den Bestand treffen (sonst
       Dublette bei jedem weiteren Import derselben Datei); 'Vertretung' ist wirklich neu. */
    signatureImages: [
      { name: 'Chef', dataUrl: 'data:image/png;base64,BBBB' },
      { name: 'Vertretung', dataUrl: 'data:image/png;base64,CCCC', visibility: 'public' }
    ],
    bdocDocs: { buero_brief: { fields: { f: 'AUS SICHERUNG' } }, buero_vollmacht: { fields: {} } },
    bdocArchives: [{ id: 'a1', label: 'doppelt' }, { id: 'a2' }],
    bdocSends: [{ id: 'v1' }],
    buOverviewEntries: [
      { caseId: '1', periodStart: '2026-01-01', aenderungsart: 'FREMD' },
      { caseId: '2', periodStart: '2026-01-01', aenderungsart: 'NEU' }
    ]
  }, ls, fenster, (t) => toasts.push(t));

  /* (2) Unterschriften: eine kam dazu, die vorhandene blieb unangetastet. */
  const sigs = JSON.parse(ls._roh['betreuungsbuero.signatures.v1']);
  assert.equal(sigs.length, 2, 'Unterschriften-Dedupe versagt (Dublette oder nichts importiert)');
  assert.equal(sigs[0].dataUrl, 'data:image/png;base64,AAAA', 'die vorhandene Unterschrift wurde ueberschrieben');
  assert.equal(sigs[1].name, 'Vertretung');
  assert.equal(sigs[1].visibility, 'public');

  /* (3) Buero-Dokumente: Bestand gewinnt, Fehlendes kommt, fremde Felder bleiben. */
  const st = JSON.parse(ls._roh['betreuungsbuero.bueroDocs.v1']);
  assert.equal(st.docs.buero_brief.fields.f, 'GEPFLEGT', 'der gepflegte Dokumentstand wurde ueberschrieben');
  assert.ok(st.docs.buero_vollmacht, 'das fehlende Dokument wurde nicht ergaenzt');
  assert.equal(st.archives.length, 2, 'Archiv-Dedupe je id versagt');
  assert.equal(st.archives[0].label, undefined, 'die vorhandene Archivfassung wurde ueberschrieben');
  assert.equal(st.sends.length, 1, 'die Versandhistorie wurde nicht ergaenzt');
  assert.equal(st.favByDoc.buero_brief, 'a1', 'fremde Speicherfelder (favByDoc) gingen beim Merge verloren');

  /* (4) Historie: (caseId,periodStart)-Dedupe, vorhandene Eintraege gewinnen. */
  const bu = fenster.bueroLocal.buOverviewEntries;
  assert.equal(bu.length, 2, 'die fehlende Meldung wurde nicht ergaenzt');
  assert.equal(bu[0].aenderungsart, 'EIGEN', 'die gepflegte Meldung wurde ueberschrieben');
  assert.equal(bu[1].caseId, '2');
  assert.equal(fenster._gespeichert, true, 'der Historie-Merge persistiert nicht (saveBueroLocal fehlt)');
});

/* ═══════════ 6. Kalender-JSON: Aufgaben-Handsortierung (ausgefuehrt) ═══════════ */

test('Kalender & Aufgaben (JSON): die Handsortierung wandert mit und kommt NUR bei Leerstand zurueck', () => {
  /* Export-Seite: die echte Payload-Funktion. */
  const payloadKern = schnipsel('function calendarTodoLocalPayload(){', 'function calendarTodoHasAny(){');
  const ctx = { console, window: {}, localStorage: speicherStub({
    'betreuungsbuero.todos.v1': JSON.stringify([{ id: 't1' }, { id: 't2' }]),
    'betreuungsbuero.todoManualOrder.v1': JSON.stringify(['t2', 't1'])
  }) };
  vm.createContext(ctx);
  vm.runInContext(`${payloadKern}\nthis.payload=calendarTodoLocalPayload();`, ctx, { filename: 'cal-todo-payload.js' });
  assert.deepEqual(Array.from(ctx.payload.todoOrder), ['t2', 't1'], 'die Handsortierung fehlt in der Kalender-Aufgaben-JSON');
  assert.equal(ctx.payload.todos.length, 2, 'Bestandsfeld der Payload beschaedigt');

  /* Import-Seite: der lokale Zweig ab den beiden setItem-Zeilen. */
  const importKern = schnipsel("    localStorage.setItem(window.CAL_STORAGE_KEY||'betreuungsbuero.calendarEvents.v1',JSON.stringify(events));", '    window.__markCalendarTodoJsonSynced();');
  const ctx2 = { console };
  vm.createContext(ctx2);
  vm.runInContext(`this.einspielen=function(events,todos,data,localStorage,window){\n${importKern}\n};`, ctx2, { filename: 'cal-todo-import.js' });

  /* (1) Leerstand -> Sortierung kommt aus der Sicherung. */
  const ls1 = speicherStub();
  ctx2.einspielen([], [{ id: 't1' }], { todoOrder: ['t2', 't1'] }, ls1, {});
  assert.deepEqual(JSON.parse(ls1._roh['betreuungsbuero.todoManualOrder.v1']), ['t2', 't1'],
    'bei Leerstand muss die Handsortierung zurueckgespielt werden');

  /* (2) Gepflegte Sortierung -> die Sicherung darf sie NICHT ueberschreiben. */
  const ls2 = speicherStub({ 'betreuungsbuero.todoManualOrder.v1': JSON.stringify(['eigene']) });
  ctx2.einspielen([], [], { todoOrder: ['fremde'] }, ls2, {});
  assert.deepEqual(JSON.parse(ls2._roh['betreuungsbuero.todoManualOrder.v1']), ['eigene'],
    'eine gepflegte Handsortierung wurde von der Sicherung ueberschrieben');

  /* (3) Muell-Eintraege in der Sicherung werden verworfen. */
  const ls3 = speicherStub();
  ctx2.einspielen([], [], { todoOrder: [{ boese: true }, 't1'] }, ls3, {});
  assert.deepEqual(JSON.parse(ls3._roh['betreuungsbuero.todoManualOrder.v1']), ['t1'],
    'fremde Typen in der Sortierungs-Sicherung muessen verworfen werden');
});
