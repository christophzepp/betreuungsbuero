'use strict';

/* Pruefstand fuer den Gesamtexport (ZIP) im Online-Modus (Umbau 25.08.2026):
     1. Der Online-Zweig faellt nach erfolglosen download-latest-Versuchen per Rueckfrage in den
        Browser-ZIP-Bau durch (keine Sackgasse mehr) - der Hinweis nennt Dokumentenspeicher UND
        Server-Datenbank; 403 an der Jobs-Liste bzw. der download-latest-Vorpruefung fuehrt zum
        Administratoren-Grundtext statt zum "keine Sicherung vorhanden"-Text.
     2. Je Fall wird FRISCH geladen (fetchCaseState ueber GET /api/cases/:id/load), sequenziell -
        die Rechnungslegung (accounting) eines NICHT-aktiven Falls landet im Datensicherung.json.
     3. Archivierte Faelle laufen in den Archiv/-Ordner der ZIP.
     4. Dateinamen: lokal wortgleich weiter "Lokaler Arbeitsdatenexport.zip", online der neue Name.
     5. WAS-FEHLT.txt liegt im Ordner Büroorganisation und benennt die Kernluecken.
     6. Die Pins aus html-runtime-modes.test.cjs gelten weiter (Sektion ohne /api/admin/).
     7. Die Blockzahl bleibt bei 309.
     8. Wurzelbehebung 25.08.2026 (Nutzerlauf 20:58): alte 21-Blatt-Servervorlagen im
        OpenXML-SDK-Stil (<x:sheet ...>, xmlns:r nur je Element) muessen durch
        boNormalizeTemplateWorkbookXml praefixfrei und mit Root-xmlns:r laufen - sonst warf
        boClonePlan "Prototyp-Blatt fehlt in der Vorlage: Fahrtenbuch KFZ" und riss xlsx+ods+csv
        UND die JSON aus der ZIP. Die kuratierte 31.08.-Vorlage ist bereits Standard-OOXML;
        getestet WIRD hier weiterhin gegen die ECHTE Vorlagendatei des Servers.
        (Der volle boBuildAll-Weg lief zusaetzlich im vm-Pruefstand mit den echten Daten der
        Installation durch: 23 Blaetter, ODS 653 KB, 23 CSVs, keine Duplikate, warnings=[].)
     9. Fail-visible: scheitert der Betreuungsorganisations-Bau (aeusserer Wurf) oder nur die
        JSON (innerer Wurf), traegt die ZIP "Büroorganisation/FEHLER Betreuungsorganisation.txt",
        WAS-FEHLT.txt beginnt mit einer ACHTUNG-Zeile, und statt des Erfolgs-Toasts kommt die
        Warnform (__workToast.warn, CSS .work-toast.warn) - nichts fluestert mehr nur in die
        Konsole.

   Leitgedanke wie in datenschutz.test.cjs / html-buero-json-sicherung.test.cjs: der Code wird
   AUS DER AUSLIEFERUNGSDATEI geschnitten und in einem vm-Kontext AUSGEFUEHRT - gemessen wird die
   Auslieferung, kein Nachbau. Der komplette Block case-backup-all-v161 laeuft samt dem echten
   fetchCaseState aus online-case-sync-script-v1 gegen eine fetch-Attrappe. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

function schnipsel(von, bis) {
  const a = html.indexOf(von);
  assert.ok(a >= 0, `Anker fehlt in der Auslieferungsdatei: ${von}`);
  const b = html.indexOf(bis, a + von.length);
  assert.ok(b > a, `Endanker fehlt hinter "${von}": ${bis}`);
  /* Doppelte Anker wuerden den falschen Ausschnitt liefern - lieber laut scheitern. */
  assert.equal(html.indexOf(von, a + 1), -1, `Anker ist nicht eindeutig: ${von}`);
  return html.slice(a, b);
}

/* Der komplette Skriptblock der Gesamtsicherung (IIFE) - OHNE die <script>-Klammern. */
const blockQuelle = (() => {
  const anker = '<script id="case-backup-all-v161">';
  return schnipsel(anker, '\n</script>').slice(anker.length);
})();

/* Der ECHTE Einzelfall-Frischabruf aus online-case-sync-script-v1: er ist die vom Export
   benutzte fetchState-Quelle (window.__onlineCaseSync.fetchState=fetchCaseState) und liest
   GET /api/cases/:id/load. Er wird hier mit derselben fetch-Attrappe betrieben. */
const fetchStateQuelle = schnipsel(
  '  async function fetchCaseState(caseId){',
  '\n\n  // "Reinladen/Rausladen/Archivieren"-Logik'
);

/* ═══════════════════ vm-Fahrbahn: ein Export-Lauf mit Protokoll ═══════════════════ */

function antwortAttrappe(status, jsonWert) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => jsonWert,
    body: { cancel() {} }
  };
}

async function fuehreExportAus(cfg) {
  const protokoll = {
    toasts: [], confirms: [], alerts: [], fetchUrls: [], downloads: [],
    zipEntries: null, listAufrufe: [], fetchStateAufrufe: [],
    maxParallel: 0, preloadCacheAufrufe: 0, workToasts: []
  };
  const ctx = { console, TextEncoder, TextDecoder };
  ctx.window = ctx;
  ctx.localStorage = { getItem: () => null, setItem: () => {} };
  ctx.toast = (t) => { protokoll.toasts.push(String(t)); };
  ctx.alert = (t) => { protokoll.alerts.push(String(t)); };
  ctx.confirm = (t) => { protokoll.confirms.push(String(t)); return cfg.confirmAntwort !== false; };
  /* Kein echter Timer: das revokeObjectURL-setTimeout soll den Testprozess nicht offenhalten. */
  ctx.setTimeout = () => 0;
  ctx.URL = { createObjectURL: () => 'blob:pruefstand', revokeObjectURL: () => {} };
  ctx.Blob = class BlobAttrappe { constructor(teile, opts) { this.teile = teile; this.opts = opts; } };
  ctx.document = {
    createElement: () => {
      const a = { href: '', download: '', rel: '' };
      a.click = () => protokoll.downloads.push({ href: a.href, download: a.download });
      a.remove = () => {};
      return a;
    },
    body: { appendChild: () => {} }
  };
  ctx.fileTimestamp = () => '2026-08-25 1200';
  ctx.fileNamePerson = () => 'Person';
  ctx.fullName = () => 'Aktiv, Anna';
  ctx.caseHasData = () => false;
  ctx.exportProject = () => {};
  ctx.flattenStammdatenToRows = () => [];
  ctx.rowsToCsv = () => '';
  ctx.stammdatenToOdsBytes = () => new Uint8Array(0);
  ctx.adressverzeichnisToOdsBytes = () => new Uint8Array(0);
  ctx.contactsToRows = () => [];
  ctx.rowsToOds = () => new Uint8Array(0);
  ctx.curatedFachCsvEntries = () => [];
  ctx.phase4ZipStore = (entries) => { protokoll.zipEntries = Array.from(entries); return new Uint8Array([80, 75, 3, 4]); };
  /* Wie im Original entsteht das Datensicherung.json waehrend die Schleife `state` auf den
     jeweiligen Fall getauscht hat - der Stub serialisiert genau diesen Zustand. So ist messbar,
     WELCHER Datenstand (frisch inkl. accounting oder nicht) im JSON des Falls landet. */
  ctx.captureDownloadDuring = async (fn) => {
    await fn();
    return new TextEncoder().encode(JSON.stringify((ctx.state && ctx.state.caseData) || {}));
  };
  /* Toast-Varianten protokollieren: der Export unterscheidet Erfolg (success) von der Warnform
     (warn, CSS .work-toast.warn) - genau diese Unterscheidung wird in den Fail-visible-Pruef-
     faellen gemessen. */
  const wtEintrag = (art) => (id, message) => { protokoll.workToasts.push({ art, id: String(id), message: String(message || '') }); };
  ctx.__workToast = {
    start: wtEintrag('start'), update: wtEintrag('update'), success: wtEintrag('success'),
    warn: wtEintrag('warn'), error: wtEintrag('error'), close: wtEintrag('close')
  };
  /* Fail-visible-Prueffaelle stellen hier eine werfende bzw. liefernde Engine bereit. */
  if (cfg.bueroorgBuildAll) ctx.__bueroorgBuildAll = cfg.bueroorgBuildAll;
  if (cfg.bueroorgCollectData) ctx.__bueroorgCollectData = cfg.bueroorgCollectData;
  ctx.__runtimeMode = () => cfg.modus;
  ctx.__appMode = cfg.modus === 'online' ? 'online' : 'local';
  ctx.__demoModus = cfg.modus === 'demo';
  ctx.__currentUser = { isAdmin: true };
  ctx.__activeServerCaseId = cfg.aktivId || null;
  if (cfg.caseRegistry) ctx.caseRegistry = cfg.caseRegistry;
  const antworten = cfg.antworten || {};
  const fetchAttrappe = async (url) => {
    protokoll.fetchUrls.push(String(url));
    /* Der Mikrotask-Wechsel gibt einem (verbotenen) Parallel-Abruf die Chance, sich zu
       ueberlappen - nur echte Sequenz haelt maxParallel bei 1. */
    await new Promise((r) => setImmediate(r));
    const antwort = antworten[String(url)];
    return antwort || antwortAttrappe(404, null);
  };
  ctx.fetch = fetchAttrappe;
  ctx.priorityFetch = fetchAttrappe;

  vm.createContext(ctx);
  /* Die Auslieferungs-Globale (in der HTML-Datei von frueheren Bloecken deklariert) - hier
     vorab deklarieren, damit die strikten Zuweisungen des Blocks greifen. */
  vm.runInContext('var state=null, parsedMasterArchive=null, parsedAddressArchive=null;', ctx, { filename: 'globale.js' });
  vm.runInContext(blockQuelle, ctx, { filename: 'case-backup-all-v161.js' });
  vm.runInContext(
    `globalThis.__fetchCaseStateEcht=(function(){\n${fetchStateQuelle}\nreturn fetchCaseState;})();`,
    ctx, { filename: 'online-case-sync-fetchstate.js' }
  );

  if (cfg.aktivState) ctx.state = cfg.aktivState;
  if (cfg.modus === 'online') {
    let laufend = 0;
    ctx.__onlineCaseSync = {
      list: async (force) => { protokoll.listAufrufe.push(force); return cfg.fallListe || []; },
      preloadCache: async () => { protokoll.preloadCacheAufrufe++; },
      fetchState: async (id) => {
        protokoll.fetchStateAufrufe.push(String(id));
        laufend++;
        protokoll.maxParallel = Math.max(protokoll.maxParallel, laufend);
        try { return await ctx.__fetchCaseStateEcht(id); } finally { laufend--; }
      }
    };
  }

  await ctx.downloadAllCasesZip();
  return protokoll;
}

/* ═══════════════════ Standard-Szenario online: 3 Faelle, keine Serversicherung ═══════════════════ */

function fallBundle(stammdaten) {
  /* Antwortform von GET /api/cases/:id/load - alle vier Pflichtschluessel, sonst faellt
     fetchCaseState auf die vier Einzelrouten zurueck. */
  return {
    stammdaten: { data: stammdaten },
    reports: { reports: [] },
    dokuEntries: { entries: [] },
    contacts: { contacts: [] }
  };
}

function onlineKonfiguration() {
  return {
    modus: 'online',
    aktivId: 'fall-a',
    aktivState: { caseData: { person: { lastName: 'Aktiv', firstName: 'Anna' }, care: { fileNumber: 'AZ 1' }, contacts: [] } },
    fallListe: [
      { id: 'fall-a', label: 'Aktiv, Anna', archived: false },
      { id: 'fall-b', label: 'Bruch, Bernd', archived: false },
      { id: 'fall-c', label: 'Chronik, Clara', archived: true }
    ],
    antworten: {
      '/api/documents/backup-jobs': antwortAttrappe(200, { jobs: [{ id: 'job-1', ziel: { art: 'gesamt' } }] }),
      '/api/documents/backup-jobs/job-1/download-latest': antwortAttrappe(404, null),
      '/api/cases/fall-b/load': antwortAttrappe(200, fallBundle({
        person: { lastName: 'Bruch', firstName: 'Bernd' },
        care: { fileNumber: 'AZ 2' },
        accounting: { probe: 'KONTOSTAND-77,77' }
      })),
      '/api/cases/fall-c/load': antwortAttrappe(200, fallBundle({
        person: { lastName: 'Chronik', firstName: 'Clara' }
      }))
    }
  };
}

/* Ein einziger ausgefuehrter Online-Lauf, von mehreren Prueffaellen ausgewertet. */
let onlineLaufProm = null;
function onlineLauf() {
  if (!onlineLaufProm) onlineLaufProm = fuehreExportAus(onlineKonfiguration());
  return onlineLaufProm;
}

let lokalLaufProm = null;
function lokalLauf() {
  if (!lokalLaufProm) {
    lokalLaufProm = fuehreExportAus({
      modus: 'local',
      caseRegistry: [{
        label: 'Lokal, Ludwig', archived: false, masterArchive: null, addressArchive: null,
        state: { caseData: { person: { lastName: 'Lokal', firstName: 'Ludwig' }, care: { fileNumber: 'AZ 9' }, contacts: [] } }
      }]
    });
  }
  return lokalLaufProm;
}

const entryNamen = (p) => p.zipEntries.map((e) => String(e.name));
const entryText = (p, name) => {
  const eintrag = p.zipEntries.find((e) => String(e.name) === name);
  assert.ok(eintrag, `ZIP-Eintrag fehlt: ${name}`);
  return new TextDecoder().decode(eintrag.data);
};

/* ═══════════════════ 1. Rueckfall statt Sackgasse + Hinweistext ═══════════════════ */

test('Online ohne abrufbare Serversicherung: Rueckfrage nennt Dokumentenspeicher UND Datenbank, danach laeuft der ZIP-Bau', async () => {
  const p = await onlineLauf();
  assert.equal(p.confirms.length, 1, 'Es muss genau EINE Rueckfrage geben');
  const frage = p.confirms[0];
  assert.match(frage, /keine abgeschlossene serverseitige Gesamtsicherung/,
    'Ohne 403 muss der Grund "keine Sicherung vorhanden" sein');
  assert.match(frage, /Dokumentenspeicher/, 'Der Hinweis muss den Dokumentenspeicher nennen');
  assert.match(frage, /Server-Datenbank/, 'Der Hinweis muss die Server-Datenbank nennen');
  assert.match(frage, /Sicherung & Synchronisation/, 'Der Hinweis muss den Weg zur Serversicherung zeigen');
  /* Kein return mehr am Toast: nach OK wird die ZIP tatsaechlich gebaut und heruntergeladen. */
  assert.ok(Array.isArray(p.zipEntries) && p.zipEntries.length > 0,
    'Nach der Rueckfrage muss der Browser-ZIP-Bau laufen (alter Code endete hier als Sackgasse)');
  assert.equal(p.downloads.length, 1, 'Die ZIP muss als Download ausgeloest werden');
});

test('403 an der Jobs-Liste: Administratoren-Grundtext, Abbrechen bricht wirklich ab', async () => {
  const cfg = onlineKonfiguration();
  cfg.antworten['/api/documents/backup-jobs'] = antwortAttrappe(403, null);
  cfg.confirmAntwort = false;
  const p = await fuehreExportAus(cfg);
  assert.equal(p.confirms.length, 1);
  assert.match(p.confirms[0], /nur Administratoren/,
    'Ein 403 muss als Berechtigungsproblem benannt werden, nicht als "keine Sicherung"');
  assert.equal(p.zipEntries, null, 'Abbrechen darf keinen ZIP-Bau starten');
  assert.equal(p.downloads.length, 0, 'Abbrechen darf keinen Download ausloesen');
});

test('403 an der download-latest-Vorpruefung: ebenfalls Administratoren-Grundtext', async () => {
  const cfg = onlineKonfiguration();
  cfg.antworten['/api/documents/backup-jobs/job-1/download-latest'] = antwortAttrappe(403, null);
  cfg.confirmAntwort = false;
  const p = await fuehreExportAus(cfg);
  assert.equal(p.confirms.length, 1);
  assert.match(p.confirms[0], /nur Administratoren/);
});

test('Abrufbare Serversicherung: direkter Download bleibt der Vorrangweg, keine Rueckfrage', async () => {
  const cfg = onlineKonfiguration();
  cfg.antworten['/api/documents/backup-jobs/job-1/download-latest'] = antwortAttrappe(206, null);
  const p = await fuehreExportAus(cfg);
  assert.equal(p.confirms.length, 0, 'Bei vorhandener Serversicherung darf keine Rueckfrage kommen');
  assert.equal(p.zipEntries, null, 'Der Browser-ZIP-Bau darf dann nicht laufen');
  assert.equal(p.downloads.length, 1);
  assert.match(p.downloads[0].href, /\/download-latest$/);
  assert.ok(p.toasts.some((t) => t.includes('serverseitige Gesamtsicherung')));
});

/* ═══════════════════ 2. Frischladung je Fall, sequenziell, accounting ═══════════════════ */

test('Frischladung: jeder nicht-aktive Fall laeuft ueber fetchCaseState -> GET /api/cases/:id/load, sequenziell', async () => {
  const p = await onlineLauf();
  assert.deepEqual(p.listAufrufe, [true], 'Die Fallliste muss mit force=true geholt werden');
  assert.deepEqual(p.fetchStateAufrufe, ['fall-b', 'fall-c'],
    'Beide nicht-aktiven Faelle muessen frisch geladen werden - der aktive nicht');
  assert.equal(p.maxParallel, 1, 'Die Frischladung muss SEQUENZIELL laufen (kein Promise.all-Sturm)');
  assert.equal(p.preloadCacheAufrufe, 0, 'Der Cache-Vorlader darf im Frisch-Pfad nicht laufen');
  assert.ok(p.fetchUrls.includes('/api/cases/fall-b/load'), 'fetchCaseState muss die /load-Route lesen');
  assert.ok(p.fetchUrls.includes('/api/cases/fall-c/load'));
  assert.ok(!p.fetchUrls.includes('/api/cases/fall-a/load'),
    'Der aktive Fall nimmt den Live-Zustand, nicht den Server-Stand');
});

test('Altbestand: die fünf fest gekennzeichneten Vorführfälle werden auch in einer echten Online-Liste übersprungen', async () => {
  const cfg = onlineKonfiguration();
  const demoId = 'de300001-0000-4000-8000-000000000001';
  cfg.fallListe.push({ id: demoId, label: 'Auerbach, Margarete', archived: false });
  cfg.antworten[`/api/cases/${demoId}/load`] = antwortAttrappe(200, fallBundle({
    person: { lastName: 'Auerbach', firstName: 'Margarete' }
  }));
  const lauf = await fuehreExportAus(cfg);
  assert.ok(!lauf.fetchStateAufrufe.includes(demoId), 'Vorführfall wurde trotz technischer Demo-ID geladen');
  assert.ok(!lauf.fetchUrls.includes(`/api/cases/${demoId}/load`), 'Vorführfall wurde vom Server abgerufen');
  assert.ok(!(lauf.zipEntries || []).some((entry) => String(entry.name || '').includes('Auerbach')),
    'Vorführfall hat einen Ordner in der Arbeitsdaten-ZIP erhalten');
});

test('Die Rechnungslegung eines NICHT-aktiven Falls landet in dessen Datensicherung.json', async () => {
  const p = await onlineLauf();
  const json = entryText(p, 'Bruch, Bernd (AZ 2)/2026-08-25 1200 Person Datensicherung.json');
  assert.ok(json.includes('"accounting"'),
    'accounting fehlt - der Export hat offenbar den Cache-Stand (accDropped) statt der Frischladung genutzt');
  assert.ok(json.includes('KONTOSTAND-77,77'), 'Der frisch geladene Rechnungslegungs-Inhalt fehlt');
  /* Der aktive Fall kommt aus dem Live-Zustand und traegt seinen eigenen Ordner. */
  assert.ok(entryNamen(p).some((n) => n.startsWith('Aktiv, Anna (AZ 1)/')),
    'Der aktive Fall fehlt im ZIP');
});

/* ═══════════════════ 3. Archivierte Faelle im Archiv/-Ordner ═══════════════════ */

test('Archivierte Faelle landen im Archiv/-Ordner der ZIP', async () => {
  const p = await onlineLauf();
  const namen = entryNamen(p);
  assert.ok(namen.some((n) => n.startsWith('Archiv/Chronik, Clara/')),
    'Der archivierte Fall fehlt im Archiv/-Ordner');
  assert.ok(!namen.some((n) => !n.startsWith('Archiv/') && n.startsWith('Chronik, Clara')),
    'Der archivierte Fall liegt faelschlich neben den aktuellen Faellen');
});

/* ═══════════════════ 4. Dateinamen je Modus ═══════════════════ */

test('Dateiname online: "Arbeitsdatenexport (online).zip" mit Zeitstempel', async () => {
  const p = await onlineLauf();
  assert.equal(p.downloads[0].download, '2026-08-25 1200 Arbeitsdatenexport (online).zip');
  assert.ok(p.toasts.some((t) => t.includes('Arbeitsdatenexport (online)')),
    'Der Erfolgs-Toast muss den Online-Namen tragen');
});

test('Dateiname lokal: wortgleich weiter "Lokaler Arbeitsdatenexport.zip"', async () => {
  const p = await lokalLauf();
  assert.equal(p.downloads.length, 1);
  assert.equal(p.downloads[0].download, '2026-08-25 1200 Lokaler Arbeitsdatenexport.zip');
  assert.equal(p.confirms.length, 0, 'Im Lokalmodus darf keine Online-Rueckfrage kommen');
  assert.equal(p.fetchUrls.length, 0, 'Im Lokalmodus darf kein Serverabruf laufen');
  assert.ok(entryNamen(p).some((n) => n.startsWith('Lokal, Ludwig (AZ 9)/')));
});

test('Demo-Modus: Arbeitsdatenexport bricht vor Abruf, Fallsammlung und ZIP-Bau ab', async () => {
  const p = await fuehreExportAus({
    modus: 'demo',
    caseRegistry: [{
      label: 'Auerbach, Margarete',
      state: { caseData: { person: { lastName: 'Auerbach', firstName: 'Margarete' } } }
    }]
  });
  assert.equal(p.fetchUrls.length, 0, 'Demo-Sperre muss vor jedem Serverabruf greifen');
  assert.equal(p.zipEntries, null, 'Aus Vorführdaten darf kein ZIP entstehen');
  assert.equal(p.downloads.length, 0, 'Aus Vorführdaten darf kein Download entstehen');
  assert.ok(p.toasts.some((text) => /Demo-Daten werden nicht gesichert/.test(text)),
    'Die Sperre muss verständlich benannt werden');
});

/* ═══════════════════ 5. WAS-FEHLT.txt ═══════════════════ */

test('WAS-FEHLT.txt liegt NUR online unter Büroorganisation und benennt die Kernluecken', async () => {
  const p = await onlineLauf();
  assert.ok(entryNamen(p).includes('Büroorganisation/WAS-FEHLT.txt'), 'WAS-FEHLT.txt fehlt im Ordner Büroorganisation');
  assert.ok(!entryNamen(p).includes('WAS-FEHLT.txt'), 'WAS-FEHLT.txt darf nicht im ZIP-Wurzelordner liegen');
  const text = entryText(p, 'Büroorganisation/WAS-FEHLT.txt');
  /* TextDecoder verschluckt eine fuehrende BOM - deshalb hier die rohen Bytes pruefen. */
  const bytes = p.zipEntries.find((e) => String(e.name) === 'Büroorganisation/WAS-FEHLT.txt').data;
  assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xEF, 0xBB, 0xBF],
    'BOM fehlt - Windows-Editor zeigt Umlaute falsch');
  assert.ok(text.includes('\r\n'), 'CRLF fehlt - Windows-Editor zeigt eine einzige Zeile');
  assert.match(text, /Dokumentenspeicher/);
  assert.match(text, /Server-Datenbank/);
  assert.match(text, /Rechnungslegung/);
  assert.match(text, /Karten-API-Schlüssel/);
  assert.match(text, /Vorführdaten des Demo-Modus \(bewusst vollständig ausgeschlossen\)/);
  assert.match(text, /Sicherung & Synchronisation/);

  const lokal = await lokalLauf();
  assert.ok(!entryNamen(lokal).includes('Büroorganisation/WAS-FEHLT.txt'),
    'Der lokale Export darf keine WAS-FEHLT.txt tragen (sein Inhalt beschreibt den Online-Bau)');
});

/* ═══════════════════ 6. Pins aus html-runtime-modes.test.cjs ═══════════════════ */

test('Die Betriebsarten-Pins gelten weiter: Sektion ohne /api/admin/, lokaler Name lebt', () => {
  const legacyExport = schnipsel(
    '  window.downloadAllCasesZip=async function(){',
    '\n\n  /* ===== Sammel-Indikator:'
  );
  assert.match(legacyExport, /if\(backupMode==='online'\)/);
  assert.match(legacyExport, /Lokaler Arbeitsdatenexport\.zip/);
  assert.doesNotMatch(legacyExport, /\/api\/admin\//,
    'Die Export-Sektion darf keine Admin-Routen anfassen');
  assert.doesNotMatch(legacyExport, /Sicherheit\.json[^.]/,
    'Sicherheitsdaten gehoeren nicht in den Arbeitsdatenexport');
  /* Die Verdrahtung der Frischladung ist Teil der Auslieferung, nicht nur der Attrappe. */
  assert.ok(legacyExport.includes('frisch:true,mitArchiv:true'),
    'Der Online-Zweig muss die frische Sammlung MIT Archiv anfordern');
  assert.ok(html.includes('fetchState:fetchCaseState,'),
    'window.__onlineCaseSync muss fetchCaseState als fetchState exportieren');
});

/* ═══════════════ 8. Wurzelbehebung: OpenXML-SDK-Vorlage (28.07.2026) ═══════════════ */

/* Mini-ZIP-Leser (nur fuer den Prueffall): liest einen Eintrag der echten .xlsx-Vorlage ueber
   das zentrale Verzeichnis - ohne Fremdpakete, store und deflate genuegen. */
function leseZipEintrag(buf, name) {
  const zlib = require('node:zlib');
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
      return (methode === 8 ? zlib.inflateRawSync(daten) : daten).toString('utf8');
    }
    pos += 46 + nameLen + extraLen + kommLen;
  }
  assert.fail(`ZIP-Eintrag fehlt in der Vorlage: ${name}`);
}

const TEMPLATE_XLSX = path.join(__dirname, '..', 'assets', 'templates', 'Bueroorganisation_blank.xlsx');

test('Die kuratierte 31.08.-Vorlage ist unverändert Server- und eingebettete Blankovorlage', () => {
  const buf = fs.readFileSync(TEMPLATE_XLSX);
  assert.equal(
    crypto.createHash('sha256').update(buf).digest('hex'),
    'bf49dd31a60f42164a6b8788e09c729c1039d7956244ea22dff19ae858b5151a',
    'Die Servervorlage entspricht nicht mehr der vom Nutzer kuratierten Arbeitsmappe'
  );
  const eingebettet = /bueroorganisation:\{name:'Betreuungsorganisation',b64:'([^']+)'\}/.exec(html);
  assert.ok(eingebettet, 'Die eingebettete Blankovorlage fehlt');
  assert.deepEqual(Buffer.from(eingebettet[1], 'base64'), buf,
    'Server- und eingebettete Blankovorlage sind nicht bytegleich');
});

/* Die ECHTEN Engine-Bausteine aus der Auslieferung, im vm ausgefuehrt. */
function engineKontext() {
  const helferQuelle = schnipsel('function boEscXml(s){', '\n// ===== Fristen-Arbeitsmappe');
  const normQuelle = schnipsel('function boNormalizeTemplateWorkbookXml(xml){', '\nasync function boBuildWorkbook');
  const idsQuelle = schnipsel('function boNormalizeWorkbookSheetIds(xml){', '\nfunction boInjectQualifikationenSheet');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(helferQuelle + '\n' + normQuelle + '\n' + idsQuelle, ctx, { filename: 'bueroorg-engine.js' });
  return ctx;
}

test('Die kuratierte Servervorlage ist Standard-OOXML und boClonePlan läuft bereits auf dem Rohformat', () => {
  const buf = fs.readFileSync(TEMPLATE_XLSX);
  const wbRoh = leseZipEintrag(buf, 'xl/workbook.xml');
  assert.doesNotMatch(wbRoh, /<x:sheet\b/, 'Die neue Vorlage darf den alten OpenXML-SDK-Präfixstil nicht tragen');
  assert.match(wbRoh.match(/<workbook\b[^>]*>/)[0], / xmlns:r=/,
    'Die kuratierte Vorlage muss xmlns:r am Workbook-Root deklarieren');
  const e = engineKontext();
  const ctxRoh = { wbXml: wbRoh, relsXml: leseZipEintrag(buf, 'xl/_rels/workbook.xml.rels'), ctXml: leseZipEintrag(buf, '[Content_Types].xml'), partSources: new Map(), cloneCounter: 1 };
  const plan = e.boClonePlan(ctxRoh, 'Fahrtenbuch KFZ', ['Fahrtenbuch AA', 'Fahrtenbuch BB']);
  assert.equal(plan.length, 2, 'Beide Fahrzeugblätter müssen schon aus der Rohvorlage planbar sein');
  assert.equal(plan[1].path, 'xl/worksheets/sheet22.xml',
    'Neue Blätter müssen Excels fortlaufendes sheetN.xml-Schema verwenden');
  assert.match(ctxRoh.wbXml, /<sheet name="Fahrtenbuch BB"[^>]*r:id="rId\d+"\/>/,
    'Der zweite Fahrzeugklon fehlt im rohen Workbook');
  const uidA = e.boCloneWorksheetUid('xl/worksheets/sheet22.xml');
  const uidB = e.boCloneWorksheetUid('xl/worksheets/sheet23.xml');
  assert.match(uidA, /^\{[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$/,
    'Die interne Excel-Blattkennung des Klons ist keine gültige GUID');
  assert.notEqual(uidA, uidB,
    'Zwei Fahrtenbuchklone dürfen nicht dieselbe xr:uid tragen – Excel würde die Mappe reparieren');
  assert.equal(
    e.boShiftSharedFormula('IF(I69="","",I69-G69)', 'J69', 'J71'),
    'IF(I71="","",I71-G71)',
    'Eine Shared Formula muss für jede Folgezelle in eine vollständige Einzel-Formel übersetzt werden'
  );
  assert.equal(
    e.boShiftSharedFormula('SUM($A$1,B2,"C3")', 'D4', 'F7'),
    'SUM($A$1,D5,"C3")',
    'Absolute Bezüge und Zelltexte dürfen beim Auflösen einer Shared Formula nicht verschoben werden'
  );
});

test('boNormalizeTemplateWorkbookXml: Praefixe weg, xmlns:r am Root - boClonePlan, Blattverzeichnis-Regex und sheetId-Normierung laufen auf der echten Vorlage', () => {
  const buf = fs.readFileSync(TEMPLATE_XLSX);
  const e = engineKontext();
  const wbNorm = e.boNormalizeTemplateWorkbookXml(leseZipEintrag(buf, 'xl/workbook.xml'));
  assert.doesNotMatch(wbNorm, /<x:/, 'Kein Element darf das x:-Praefix behalten');
  assert.match(wbNorm.match(/<workbook\b[^>]*>/)[0], / xmlns:r="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships"/,
    'xmlns:r muss am Root gebunden sein, sonst sind injizierte <sheet ... r:id="rIdN"/>-Tags Namespace-ungueltig und das ODS/CSV-Ruecklesen faellt still leer aus');
  assert.match(wbNorm.match(/<workbook\b[^>]*>/)[0], / xmlns="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/,
    'Die spreadsheetml-Hauptnamespace muss zur Default-Namespace werden');

  const ctx = { wbXml: wbNorm, relsXml: leseZipEintrag(buf, 'xl/_rels/workbook.xml.rels'), ctXml: leseZipEintrag(buf, '[Content_Types].xml'), partSources: new Map(), cloneCounter: 1 };
  /* Zwei Fahrzeuge wie in der echten Installation: 1 Umbenennung + 1 injizierter Klon. */
  const plan = e.boClonePlan(ctx, 'Fahrtenbuch KFZ', ['Fahrtenbuch AA', 'Fahrtenbuch BB']);
  assert.equal(plan.length, 2, 'Beide Fahrzeug-Blaetter muessen geplant werden');
  assert.match(ctx.wbXml, /<sheet name="Fahrtenbuch AA"/, 'Das Prototyp-Blatt muss umbenannt sein');
  assert.match(ctx.wbXml, /<sheet name="Fahrtenbuch BB"[^>]*r:id="rId\d+"\/>/, 'Der Klon muss injiziert sein');

  /* Blattverzeichnis-Regex (sheetMap-Form): ALLE 21 Vorlagenblaetter + 1 Klon muessen matchen -
     vorher fand sie auf der Praefix-Vorlage NULL Blaetter und alle fill* liefen still ins Leere. */
  const tags = [...ctx.wbXml.matchAll(/<sheet\b[^>]*\/>/g)];
  assert.equal(tags.length, 22, `Blattverzeichnis unvollstaendig: ${tags.length} statt 22 Tags`);
  assert.ok(tags.some((t) => /name="Qualifikationen"/.test(t[0])), 'Das Qualifikationen-Blatt der Vorlage muss im Verzeichnis stehen');

  const mitIds = e.boNormalizeWorkbookSheetIds(ctx.wbXml);
  const ids = [...mitIds.matchAll(/sheetId="(\d+)"/g)].map((m) => +m[1]);
  assert.deepEqual(ids, ids.map((_, i) => i + 1), 'Die sheetIds muessen fortlaufend normiert sein');
  assert.equal((mitIds.match(/state="visible"/g) || []).length, 22, 'Jedes Blatt braucht state="visible"');

  const app = e.boSyncAppSheetProperties(leseZipEintrag(buf, 'docProps/app.xml'), mitIds);
  assert.match(app, /<vt:i4>22<\/vt:i4>/,
    'HeadingPairs muss nach dem Klonen die echte Arbeitsblattanzahl tragen');
  assert.match(app, /<TitlesOfParts><vt:vector size="22" baseType="lpstr">/,
    'TitlesOfParts muss nach dem Klonen 22 Namen ankündigen');
  assert.match(app, /<vt:lpstr>Fahrtenbuch BB<\/vt:lpstr>/,
    'Der neue Blattname fehlt in den Excel-Dokumenteigenschaften');
});

test('Verdrahtung in der Auslieferung: Normalisierung am Ladepfad, Qualifikationen ohne Duplikat', () => {
  assert.ok(html.includes("wbXml:boNormalizeTemplateWorkbookXml(await readText('xl/workbook.xml'))"),
    'boBuildWorkbook muss die Vorlage beim Laden normalisieren - sonst prueft der Engine-Test eine unbenutzte Funktion');
  /* Folgeschaden-Sperre: die 21-Blatt-Vorlage fuehrt "Qualifikationen" selbst; ein unbedingtes
     push in boBuildAll ergaebe ein doppeltes Blatt in ODS/CSV. */
  assert.ok(html.includes("if(!sheets.some(s=>s.name==='Qualifikationen'))sheets.push({name:'Qualifikationen'"),
    'boBuildAll darf Qualifikationen nur anhaengen, wenn die Mappe es nicht schon traegt');
  assert.match(html, /if\(ctx\.partSources\.has\(path\)\)[\s\S]*?setAttributeNS\([\s\S]*?'xr:uid',boCloneWorksheetUid\(path\)/,
    'Der echte Fahrtenbuch-Klonpfad vergibt keine eindeutige xr:uid');
  assert.match(html, /const worksheetUids=new Map\(\);[\s\S]*?worksheetUids\.has\(uid\)[\s\S]*?doppelte Excel-Blattkennung/,
    'Die Schlussprüfung erkennt doppelte interne Excel-Blattkennungen nicht');
  assert.match(html, /ctx\.appXml=boSyncAppSheetProperties\(ctx\.appXml,ctx\.wbXml\)/,
    'Die Dokumenteigenschaften werden nicht an die echte Blattliste angeglichen');
  assert.match(html, /sst\.documentElement\.setAttribute\('count',String\(sharedCount\)\)/,
    'sharedStrings\/@count wird nach inlineStr- und Löschoperationen nicht neu berechnet');
  assert.match(html, /boNormalizeWorksheetFormulas\(d\);[\s\S]*?if\(ctx\.partSources\.has\(path\)\)/,
    'Shared Formulas werden nicht vor der Datenbefüllung in Einzel-Formeln aufgelöst');
  assert.match(html, /boNormalizeWorksheetFormulas\(doc\);[\s\S]*?const rows=\[\.\.\.doc\.getElementsByTagNameNS\(BO_NS,'row'\)\]/,
    'Die finale XLSX-Sanitisierung prüft keine verwaisten Shared Formulas');
  assert.match(html, /Verwaiste Shared Formula si=/,
    'Der Export bricht bei einer Shared Formula ohne Gruppenursprung nicht sichtbar ab');
});

/* ═══════════════ 9. Fail-visible: Betreuungsorganisations-Fehlschlag in der ZIP ═══════════════ */

function fehlerEintragName() { return 'Büroorganisation/FEHLER Betreuungsorganisation.txt'; }

test('Aeusserer Wurf (__bueroorgBuildAll): FEHLER-Datei in der ZIP, Warn-Toast statt Erfolgs-Toast, ACHTUNG-Zeile ganz oben in WAS-FEHLT.txt', async () => {
  const cfg = onlineKonfiguration();
  cfg.bueroorgBuildAll = async () => { throw new Error('Prototyp-Blatt fehlt in der Vorlage: Fahrtenbuch KFZ'); };
  const p = await fuehreExportAus(cfg);

  /* a) Die FEHLER-Datei liegt im Buero-Ordner und benennt Zeitpunkt, Fehler und Tragweite. */
  assert.ok(entryNamen(p).includes(fehlerEintragName()), 'Die FEHLER-Datei fehlt in der ZIP');
  const ftext = entryText(p, fehlerEintragName());
  assert.match(ftext, /Zeitpunkt: /);
  assert.match(ftext, /Prototyp-Blatt fehlt in der Vorlage: Fahrtenbuch KFZ/);
  assert.match(ftext, /die Mappe \(xlsx\/ods\/csv\) UND die JSON/,
    'Der aeussere Wurf reisst Mappe UND JSON - genau das muss die Datei sagen');
  assert.match(ftext, /NICHT als vollständige Sicherung/);
  const fbytes = p.zipEntries.find((e) => String(e.name) === fehlerEintragName()).data;
  assert.deepEqual([fbytes[0], fbytes[1], fbytes[2]], [0xEF, 0xBB, 0xBF], 'BOM fehlt (Windows-Editor)');
  assert.ok(ftext.includes('\r\n'), 'CRLF fehlt (Windows-Editor)');
  /* Die Mappe darf dann natuerlich nicht zusaetzlich in der ZIP liegen. */
  assert.ok(!entryNamen(p).some((n) => n.endsWith('Betreuungsorganisation.xlsx')),
    'Nach dem Wurf darf keine (leere) Mappe in der ZIP liegen');

  /* b) Warnform statt Erfolg: __workToast.warn, KEIN __workToast.success fuer den Export. */
  assert.ok(p.workToasts.some((w) => w.art === 'warn' && w.id === 'gesamtexport'),
    'Der Warn-Toast (Warnform .work-toast.warn) fehlt');
  assert.ok(!p.workToasts.some((w) => w.art === 'success' && w.id === 'gesamtexport'),
    'Der Erfolgs-Toast darf bei fehlender Betreuungsorganisation NICHT erscheinen');
  assert.ok(p.toasts.some((t) => t.includes('UNVOLLSTÄNDIG')),
    'Auch der Text-Toast muss die Unvollstaendigkeit benennen');
  assert.ok(p.alerts.some((t) => t.includes('Betreuungsorganisation')),
    'Der UNVOLLSTAENDIG-Hinweis nach dem Download muss den Fehlschlag listen');

  /* c) WAS-FEHLT.txt beginnt mit der ACHTUNG-Zeile (nach BOM). */
  const wasFehlt = entryText(p, 'Büroorganisation/WAS-FEHLT.txt');
  assert.ok(wasFehlt.split('\r\n')[0].startsWith('ACHTUNG: Die Betreuungsorganisation fehlt'),
    'Die ACHTUNG-Zeile muss GANZ OBEN in WAS-FEHLT.txt stehen');
  assert.match(wasFehlt, /FEHLER Betreuungsorganisation\.txt/,
    'WAS-FEHLT.txt muss auf die FEHLER-Datei verweisen');
});

test('Innerer Wurf (nur JSON): Mappe bleibt in der ZIP, FEHLER-Datei benennt die fehlende JSON, Warnform statt Erfolg', async () => {
  const cfg = onlineKonfiguration();
  cfg.bueroorgBuildAll = async () => ({ xlsx: new Uint8Array([1]), ods: new Uint8Array([2]), csvs: [{ name: 'Blatt', text: 'a' }] });
  cfg.bueroorgCollectData = async () => { throw new Error('Server-Endpunkt nicht erreichbar'); };
  const p = await fuehreExportAus(cfg);
  assert.ok(entryNamen(p).some((n) => n.endsWith('Betreuungsorganisation.xlsx')), 'Die Mappe selbst war erfolgreich und muss in der ZIP bleiben');
  assert.ok(!entryNamen(p).some((n) => n.endsWith('Betreuungsorganisation.json')), 'Die JSON konnte nicht gebaut werden');
  const ftext = entryText(p, fehlerEintragName());
  assert.match(ftext, /die JSON \(verlustfreier Restore-Weg\)/, 'Die FEHLER-Datei muss die JSON als fehlend benennen');
  assert.match(ftext, /Server-Endpunkt nicht erreichbar/);
  assert.ok(p.workToasts.some((w) => w.art === 'warn' && w.id === 'gesamtexport'));
  assert.ok(!p.workToasts.some((w) => w.art === 'success' && w.id === 'gesamtexport'));
});

test('Gegenlauf ohne Wurf: keine FEHLER-Datei, Erfolgs-Toast, keine ACHTUNG-Zeile', async () => {
  const cfg = onlineKonfiguration();
  cfg.bueroorgBuildAll = async () => ({ xlsx: new Uint8Array([1]), ods: new Uint8Array([2]), csvs: [{ name: 'Blatt', text: 'a' }] });
  cfg.bueroorgCollectData = async () => ({ users: [{ id: 1 }], moduleData: {} });
  const p = await fuehreExportAus(cfg);
  assert.ok(!entryNamen(p).includes(fehlerEintragName()), 'Ohne Wurf darf keine FEHLER-Datei entstehen');
  assert.ok(entryNamen(p).some((n) => n.endsWith('Betreuungsorganisation.xlsx')));
  assert.ok(entryNamen(p).some((n) => n.endsWith('Betreuungsorganisation.json')));
  assert.ok(p.workToasts.some((w) => w.art === 'success' && w.id === 'gesamtexport'), 'Der Erfolgs-Toast muss im Gutfall erscheinen');
  assert.ok(!p.workToasts.some((w) => w.art === 'warn' && w.id === 'gesamtexport'), 'Im Gutfall darf kein Warn-Toast kommen');
  assert.ok(!p.toasts.some((t) => t.includes('UNVOLLSTÄNDIG')));
  const wasFehlt = entryText(p, 'Büroorganisation/WAS-FEHLT.txt');
  assert.ok(!wasFehlt.includes('ACHTUNG: Die Betreuungsorganisation fehlt'),
    'Ohne Fehlschlag darf WAS-FEHLT.txt keine ACHTUNG-Zeile tragen');
});

/* Die Warnform selbst ist Teil der Auslieferung: __workToast.warn nutzt die amber CSS-Klasse. */
test('Auslieferung: __workToast traegt die Warnform (type warn, .work-toast.warn existiert im CSS)', () => {
  assert.ok(html.includes(".toast.work-toast.warn{"), 'Die Warn-CSS-Klasse fehlt');
  const warnZeile = schnipsel("  warn:(id,message,o)=>workToast(id,{", '\n');
  assert.match(warnZeile, /type:'warn'/, '__workToast.warn muss die warn-Variante setzen');
});

/* ═══════════════════ 7. Blockzahl ═══════════════════ */

test('Auslieferung: die Blockzahl bleibt bei 309', () => {
  const bloecke = (html.match(/\n<script/g) || []).length;
  assert.equal(bloecke, 309, 'Scriptblockzahl hat sich veraendert.');
});

/* ─── Nachtrag 25.08. ~22:00: der v255-Blatt-Injektor verseuchte fremde Mappen ───
   Beim ersten echten Online-Export trugen Betreuungsorganisation UND Adressverzeichnis
   ploetzlich die zwoelf Fall-Blaetter "01 - Stammdaten" bis "12 - Wohnen": der
   phase4ZipStore-Wrapper hielt JEDE roh gepackte Mappe fuer die Stammdaten-Mappe.
   Vorbestand seit v255; sichtbar erst, seit die Buero-Mappe denselben Packer nutzt. */
test('v255-Injektor behandelt nur Stammdaten-Mappen (ausgefuehrt)', () => {
  const a = html.indexOf('const zipKernV255=window.phase4ZipStore;');
  const b = html.indexOf('/* Blanko-Vorlage: die kuratierte Stammdaten-Vorlage', a);
  assert.ok(a > 0 && b > a, 'Wrapper nicht auffindbar');
  const enc = new TextEncoder();
  const lauf = (wbXml) => {
    const ctx = {
      window: { phase4ZipStore: (e) => e },
      TextDecoder,
      console,
      parsedMasterArchive: null,
      beruehrt: [],
    };
    ctx.ergaenzeFehlendeBlaetterV255 = (e) => { ctx.beruehrt.push('ergaenzen'); return e; };
    ctx.injiziereZusatzblaetterV255 = (e) => { ctx.beruehrt.push('injizieren'); return e; };
    vm.createContext(ctx);
    /* phase4ZipStore-Referenzzeile am Ende des Wrappers ist blockintern - abfangen. */
    vm.runInContext('let phase4ZipStore;\n' + html.slice(a, b), ctx, { filename: 'v255-wrapper.js' });
    ctx.window.phase4ZipStore([{ name: 'xl/workbook.xml', data: enc.encode(wbXml) }]);
    return ctx.beruehrt;
  };
  /* Buero-/Adress-/Controlling-Mappe: keine nummerierten Stammdaten-Blaetter -> unangetastet. */
  assert.deepEqual(lauf('<workbook><sheets><sheet name="Bürostammdaten" r:id="rId1"/></sheets></workbook>'), [],
    'fremde Mappe bekam Zusatzblaetter');
  /* Stammdaten-Mappe: wird weiterhin ergaenzt und injiziert. */
  assert.deepEqual(lauf('<workbook><sheets><sheet name="01 - Stammdaten" r:id="rId1"/></sheets></workbook>'),
    ['ergaenzen', 'injizieren'], 'Stammdaten-Mappe verlor die Zusatzblatt-Pflege');
});

test('Moduldaten-Fehlschlag nennt den echten Status statt zu raten', () => {
  assert.ok(html.includes("data.__moduleDatenStatus='HTTP '+mdAntwort.status"), 'Status wird nicht erfasst');
  assert.ok(html.includes("boJsonModuldatenGrund=(boData&&boData.__moduleDatenStatus)||''"), 'Grund erreicht die ZIP nicht');
  assert.ok(html.includes("'der Abruf scheiterte: '+boJsonModuldatenGrund"), 'WAS-FEHLT nennt den Status nicht');
  assert.ok(!html.includes('Moduldaten (Dokumentenspeicher-Metadaten, Editorstände u. a.) – der Abruf blieb leer (Admin-Recht erforderlich)'),
    'die ratende Ursachen-Zeile lebt noch');
});
