'use strict';

/* Vollstaendigkeits-Wachhund fuer die Sicherungswege (25.08.2026):

     1. Rechte-Abgleich Excel<->Server: die Rechtematrix-Spalten der Buero-Excel
        (BO_RIGHT_COLS in der App) muessen EXAKT die PERMISSION_KEYS des Servers tragen.
        Konvention (am Bestand geprueft): auch ALLE menu*-Rechte stehen in der Excel
        (Spalten AM..CK ff.) - deshalb strenge Mengengleichheit in beide Richtungen.
        Das ist der Wachhund, den es bisher nicht gab: ein kuenftiges neues Recht ohne
        Excel-Spalte macht diesen Prueffall rot, BEVOR die Sicherung still Rechte verliert.
     2. Rechte-Rundlauf: boYNLO (Export) und der ynlo-Decoder (Reimport) sind
        Umkehrfunktionen - mit dem ECHTEN Code aus der Auslieferungsdatei ausgefuehrt.
     3. Stammdaten-Excel-Rundlauf der drei Verguetungsfelder: die ECHTEN Schreib- und
        Lese-Schleifen (stammdatenApplyEdits-Gerichtszeile / extractMaster-Override v156)
        werden aus der Auslieferung geschnitten und im vm gegeneinander ausgefuehrt.
     4.-6. JSON-Sicherung: ZIP nutzt die angereicherte Sammlung (ohne /api/admin/-Text),
        der Online-Export traegt datenschutz, und die fuenf nur-lokalen Bestaende stehen
        in Export-Zweig UND Import-Merge UND loadBueroLocal-Whitelist.
     7. Blockzahl 309 (Zeilenanfaenge "<script").

   Wie in datenschutz.test.cjs/html-master-zusatzblaetter.test.cjs wird Code AUS DER
   AUSLIEFERUNGSDATEI geschnitten und ausgefuehrt - gemessen wird die Auslieferung,
   kein Nachbau. Nur triviale Randhelfer (phase4SetCell-Rekorder, localStorage) sind Stubs. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

const { PERMISSION_KEYS } = require('../src/middleware/authorization.js');

/* Schneidet [von, bis) aus der Auslieferung; beide Anker muessen eindeutig sein,
   sonst prueft der Test womoeglich eine falsche Stelle und luegt gruen. */
function schnipsel(von, bis) {
  const a = html.indexOf(von);
  assert.ok(a >= 0, `Anker fehlt in der Auslieferungsdatei: ${von}`);
  assert.equal(html.indexOf(von, a + 1), -1, `Anker ist nicht eindeutig: ${von}`);
  const b = html.indexOf(bis, a);
  assert.ok(b > a, `Endanker fehlt hinter "${von}": ${bis}`);
  return html.slice(a, b);
}

/* Wie schnipsel, aber INKLUSIVE des Endankers - fuer Schleifen, deren schliessende
   Klammer Teil des Schnitts sein muss. */
function schnipselMit(von, bis) {
  const teil = schnipsel(von, bis);
  return teil + bis;
}

/* Identisch zur App-Normierung (die Verguetungs-Uebersetzung fuehrt bewusst ihre eigene,
   blockunabhaengige Variante; die Kopfzeilen-norm der Excel-Wege verhaelt sich fuer die
   hier benutzten Beschriftungen gleich). */
const normA = v => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* Wegwerf-localStorage wie im Browser, aber pruefbar. */
function speicherStub(anfang) {
  const ablage = Object.assign({}, anfang || {});
  return {
    getItem: (k) => (k in ablage ? ablage[k] : null),
    setItem: (k, v) => { ablage[k] = String(v); },
    _roh: ablage
  };
}

/* ═══════════ 1. Rechte-Abgleich Excel <-> Server (der neue Wachhund) ═══════════ */

function ladeRechteMatrix() {
  /* BO_RIGHT_COLS/BO_RIGHT_LABELS als ECHTER Code ausgefuehrt (die Liste traegt
     Kommentare - eine Regex-Zerlegung wuerde bei der naechsten Anmerkung brechen). */
  const kern = schnipsel('const BO_RIGHT_COLS=[', 'window.__bueroorgMaps=');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(`${kern}\nthis.COLS=BO_RIGHT_COLS;this.LABELS=BO_RIGHT_LABELS;`, ctx, { filename: 'bo-right-cols.js' });
  return ctx;
}

test('Rechtematrix: jedes Server-Recht hat GENAU EINE Excel-Spalte - und umgekehrt', () => {
  const { COLS, LABELS } = ladeRechteMatrix();
  /* Array.from statt COLS.map: die Liste stammt aus dem vm-Realm - deepEqual wuerde sonst
     an fremden Array-Prototypen scheitern statt am Inhalt. */
  const excelKeys = Array.from(COLS, ([, key]) => key);
  const excelSet = new Set(excelKeys);

  /* Richtung 1 - der eigentliche Wachhund: ein neues Recht in PERMISSION_DEFS ohne
     Excel-Spalte ginge bei Excel-Export/-Reimport still verloren (der Reimport setzt
     nur Rechte, deren Spalte er findet). Wer hier landet: das neue Recht ans ENDE von
     BO_RIGHT_COLS anhaengen (naechster freier Spaltenbuchstabe), NIE mittendrin -
     siehe die Spalten-Kollisions-Historie vom 2026-07-26 im Listen-Kommentar. */
  const ohneSpalte = PERMISSION_KEYS.filter(k => !excelSet.has(k));
  assert.deepEqual(ohneSpalte, [],
    `Server-Rechte OHNE Excel-Spalte (Mitarbeitende-Blatt wuerde sie beim Reimport verlieren): ${ohneSpalte.join(', ')}`);

  /* Richtung 2: eine Excel-Spalte fuer ein Recht, das der Server nicht kennt, schriebe
     beim Reimport wirkungslose Eintraege in permissions_json - Scheinsicherheit. */
  const ohneRecht = excelKeys.filter(k => !PERMISSION_KEYS.includes(k));
  assert.deepEqual(ohneRecht, [],
    `Excel-Spalten ohne Server-Recht (permissions_json wuerde wirkungslose Schluessel tragen): ${ohneRecht.join(', ')}`);

  /* Konvention bestaetigt: menu*-Rechte stehen MIT in der Excel - Mengengleichheit gilt. */
  assert.equal(excelKeys.length, PERMISSION_KEYS.length, 'Excel-Spalten und Server-Rechte muessen 1:1 sein');

  /* Historischer Fehlerfall (2026-07-26): zwei Rechte auf demselben Spaltenbuchstaben.
     Buchstaben UND Schluessel muessen eindeutig bleiben. */
  const buchstaben = Array.from(COLS, ([col]) => col);
  assert.equal(new Set(buchstaben).size, buchstaben.length,
    `doppelte Spaltenbuchstaben in BO_RIGHT_COLS: ${buchstaben.filter((c, i) => buchstaben.indexOf(c) !== i).join(', ')}`);
  assert.equal(excelSet.size, excelKeys.length,
    `doppelte Rechte-Schluessel in BO_RIGHT_COLS: ${excelKeys.filter((k, i) => excelKeys.indexOf(k) !== i).join(', ')}`);

  /* Jede Spalte braucht ihre deutsche Beschriftung: headW schreibt sonst den rohen
     Schluessel in die Kopfzeile (BO_RIGHT_LABELS[key]||key) - lesbar, aber Stilbruch,
     und der Bestand ist heute vollstaendig beschriftet. */
  const ohneLabel = excelKeys.filter(k => !(k in LABELS));
  assert.deepEqual(ohneLabel, [], `Rechte ohne Kopfzeilen-Beschriftung: ${ohneLabel.join(', ')}`);

  /* Verdrahtung: Kopfzeile, Zeilen-Schreiber und Reimport laufen wirklich ueber die Liste. */
  assert.ok(html.includes('for(const [col,key] of BO_RIGHT_COLS)headW('), 'Kopfzeilen-Schreiber haengt nicht an BO_RIGHT_COLS');
  assert.ok(html.includes("for(const [col,key] of BO_RIGHT_COLS){const v=bvStr(bvCell(row,col));if(v)rights[key]=v.toUpperCase()}"),
    'der Reimport liest die Rechte nicht ueber BO_RIGHT_COLS');
});

/* ═══════════ 2. Rechte-Rundlauf: boYNLO und ynlo sind Umkehrfunktionen ═══════════ */

test('Y/L/O/N: Kodierung und Decoder des Reimports invertieren einander (alle vier Kombinationen)', () => {
  /* Beide Seiten als ECHTER Code aus der Auslieferung - nicht nachgebaut. */
  const encoder = schnipsel('function boYNLO(perms,key){', 'function boYN(v){');
  const decoderZeile = schnipselMit('const ynlo=(v)=>', ':null;');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(`${encoder}\n${decoderZeile}\nthis.enc=boYNLO;this.dec=ynlo;`, ctx, { filename: 'ynlo-rundlauf.js' });

  const erwartet = { 'NN': 'N', 'NO': 'O', 'LN': 'L', 'LO': 'Y' };
  for (const lokal of [false, true]) {
    for (const online of [false, true]) {
      const brief = ctx.enc({ local: { x: lokal }, online: { x: online } }, 'x');
      assert.equal(brief, erwartet[(lokal ? 'L' : 'N') + (online ? 'O' : 'N')],
        `Kodierung falsch fuer lokal=${lokal}, online=${online}`);
      const zurueck = ctx.dec(brief);
      assert.ok(zurueck, `Decoder kennt den Buchstaben ${brief} nicht`);
      assert.equal(zurueck.local, lokal, `Rundlauf verliert das Lokal-Recht (${brief})`);
      assert.equal(zurueck.online, online, `Rundlauf verliert das Online-Recht (${brief})`);
    }
  }
  /* Gegenrichtung: jeder Buchstabe uebersteht Decoder -> Encoder. */
  for (const brief of ['Y', 'L', 'O', 'N']) {
    const b = ctx.dec(brief);
    assert.equal(ctx.enc({ local: { x: b.local }, online: { x: b.online } }, 'x'), brief,
      `Buchstabe ${brief} uebersteht den Rueckweg nicht`);
  }
  /* Leere/fremde Zellen duerfen KEIN Recht setzen (der Reimport laesst den Bestand stehen). */
  assert.equal(ctx.dec(''), null, 'eine leere Zelle darf kein Recht setzen');
  assert.equal(ctx.dec('X'), null, 'ein unbekannter Buchstabe darf kein Recht setzen');
  /* Verdrahtung: der Excel-Schreiber nutzt boYNLO je Nutzerkonto. */
  assert.ok(html.includes('boYNLO(u.permissions,key)'), 'der Excel-Export kodiert nicht ueber boYNLO');
});

/* ═══════════ 3. Stammdaten-Excel-Rundlauf der drei Verguetungsfelder ═══════════ */

function verguetungsKontext() {
  /* norm wie in den Excel-Bloecken der App (Umlaut-Entschaerfung + Kleinschreibung) -
     Kopfzeilen-Suche und Spaltenanbau der geschnittenen Schleifen laufen darueber. */
  const ctx = { console, norm: normA };
  ctx.window = ctx;
  vm.createContext(ctx);
  /* Die EINE Uebersetzungsstelle der App (Auswahl + Spaltenliste + beide Richtungen). */
  const uebersetzung = schnipsel('window.__careVerguetungsAuswahl={', 'function caseReviewAuswahlHTML');
  /* Echte Excel-Helfer aus der Auslieferung: Spaltensuche, Klartext-Putzer, Feld-Schreiber
     und die Spaltenbuchstaben-Rechnung - nur phase4SetCell (XML-Schreiber) und der
     Stil-Kloner werden durch Rekorder/Leerlauf ersetzt, denn hier geht es um WERTE. */
  const helfer = schnipsel('  function stammdatenColIndex(headerInfo,...aliases){', '  window.stammdatenColIndex=stammdatenColIndex;');
  const spalten = schnipsel('function numberToColLetters(n){', '\n');
  /* Die ECHTE Schreib-Schleife der Gerichtszeile (stammdatenApplyEdits) ... */
  const exportLauf = schnipselMit('          const vgKopfRn=careH.r+1+shift', "d.care[vgPath.split('.')[1]]),vgLabel);\n          }");
  /* ... und die ECHTE Lese-Schleife (extractMaster-Override v156). Der for-Kopf steht
     mehrfach im Code, darum ueber die eindeutige vgIdx-Zeile rueckwaerts verankert. */
  const idxA = html.indexOf('const vgIdx=careH.norm.indexOf(norm(vgLabel));');
  assert.ok(idxA >= 0, 'Lese-Schleife (vgIdx) nicht auffindbar');
  const forA = html.lastIndexOf('for(const[vgPath,vgLabel]of(window.__careVerguetungSpalten||[])){', idxA);
  assert.ok(forA >= 0, 'for-Kopf der Lese-Schleife nicht auffindbar');
  const endeText = "if(vgCode!==null)d.care[vgPath.split('.')[1]]=vgCode;\n          }";
  const endeA = html.indexOf(endeText, forA);
  assert.ok(endeA > forA, 'Ende der Lese-Schleife nicht auffindbar');
  const importLauf = html.slice(forA, endeA + endeText.length);

  vm.runInContext([
    uebersetzung,
    spalten,
    helfer,
    /* Rekorder statt XML: jede geschriebene Zelle landet unter "Zeile!Spalte". */
    'function phase4SetCell(doc,rowNum,col,value){doc[rowNum+"!"+col]=value}',
    'function stammdatenCloneCellStyle(){/* Stil ist fuer den Werte-Rundlauf ohne Belang */}',
    `this.exportLauf=function(doc,careH,rn,shift,d){\n${exportLauf}\n};`,
    `this.importLauf=function(careH,row,d){\n${importLauf}\n};`
  ].join('\n'), ctx, { filename: 'verguetung-rundlauf.js' });
  return ctx;
}

function frischeKopfzeile() {
  /* Gerichtszeilen-Kopf einer Alt-Mappe OHNE die drei Verguetungsspalten. */
  const kopf = ['Behörde', 'Ort', 'Aktenzeichen', 'Betreuung seit…'];
  return { r: 6, row: kopf.slice(), norm: kopf.map(normA) };
}

test('Verguetungsfelder: Codes raus als Klartext, Klartext rein als Codes - mit den echten Schleifen', () => {
  const ctx = verguetungsKontext();
  const careH = frischeKopfzeile();
  const doc = {};

  /* Export einer Alt-Mappe: die Schleife muss die drei Kopfzellen selbst anbauen
     (Merkzeichen-Muster) und die KLARTEXTE schreiben - nicht die internen Codes. */
  ctx.exportLauf(doc, careH, 8, 0, { care: { remStage: '2', assetStatus: 'M', housingCategory: 'S' } });
  assert.equal(doc['7!E'], 'Vergütungsstufe', 'erste Kopfzelle fehlt oder sitzt falsch');
  assert.equal(doc['7!F'], 'Vermögensstatus', 'zweite Kopfzelle fehlt oder sitzt falsch');
  assert.equal(doc['7!G'], 'Wohnform (Vergütung)', 'dritte Kopfzelle fehlt oder sitzt falsch');
  assert.equal(doc['8!E'], '2');
  assert.equal(doc['8!F'], 'mittellos', 'in der Excel muss der Klartext stehen, nicht der Code M');
  assert.equal(doc['8!G'], 'stationär', 'in der Excel muss der Klartext stehen, nicht der Code S');
  assert.equal(careH.row.length, 7, 'die Kopfzeilen-Verwaltung muss mitwachsen');

  /* Zweiter Export derselben Mappe: KEIN weiterer Spaltenanbau, Werte werden ersetzt. */
  ctx.exportLauf(doc, careH, 8, 0, { care: { remStage: '1', assetStatus: 'NM', housingCategory: 'A' } });
  assert.equal(careH.row.length, 7, 'zweiter Export darf keine neuen Spalten anbauen');
  assert.equal(doc['8!F'], 'nicht mittellos', 'zweiter Export muss den Wert in der Spalte ersetzen');

  /* Rueckweg: die exportierten Klartexte werden ueber die echte Lese-Schleife wieder Codes. */
  const zeile = [];
  for (const buchst of ['E', 'F', 'G']) zeile[careH.norm.indexOf(normA(doc['7!' + buchst]))] = doc['8!' + buchst];
  const d2 = { care: {} };
  ctx.importLauf(careH, zeile, d2);
  assert.equal(d2.care.remStage, '1', 'Verguetungsstufe uebersteht den Rundlauf nicht');
  assert.equal(d2.care.assetStatus, 'NM', 'Vermoegensstatus muss als Code zurueckkommen');
  assert.equal(d2.care.housingCategory, 'A', 'Wohnform muss als Code zurueckkommen');
});

test('Verguetungsfelder: toleranter Import - m/M/mittellos treffen, Unbekanntes laesst den Bestand stehen', () => {
  const ctx = verguetungsKontext();
  const careH = frischeKopfzeile();
  ctx.exportLauf({}, careH, 8, 0, { care: {} }); // baut nur die drei Kopfzellen an

  /* Handeingaben in der Excel: Code klein, Klartext gemischt, Code exakt. */
  for (const [eingabe, code] of [['m', 'M'], ['Mittellos', 'M'], ['MITTELLOS', 'M'], ['NM', 'NM'], ['nicht mittellos', 'NM']]) {
    const zeile = [];
    zeile[careH.norm.indexOf(normA('Vermögensstatus'))] = eingabe;
    const d = { care: { assetStatus: 'ALT' } };
    ctx.importLauf(careH, zeile, d);
    assert.equal(d.care.assetStatus, code, `Eingabe „${eingabe}“ muss auf den Code ${code} treffen`);
  }

  /* Unbekanntes wird verworfen, NIE geraten - der Maskenbestand bleibt. */
  const zeile = [];
  zeile[careH.norm.indexOf(normA('Vergütungsstufe'))] = 'Stufe 9';
  const d = { care: { remStage: '2' } };
  ctx.importLauf(careH, zeile, d);
  assert.equal(d.care.remStage, '2', 'ein unbekannter Excel-Wert darf den Bestand nicht anfassen');

  /* Alt-Mappe ohne die Spalten: gar nichts anfassen (der exakte norm-Vergleich statt
     idxV156 verhindert den Leere-Kopfzelle-Treffer, der den Bestand leeren wuerde). */
  const alt = frischeKopfzeile();
  const dAlt = { care: { remStage: '1', assetStatus: 'M', housingCategory: 'S' } };
  ctx.importLauf(alt, [], dAlt);
  assert.deepEqual(dAlt.care, { remStage: '1', assetStatus: 'M', housingCategory: 'S' },
    'ohne Verguetungsspalten muss der Maskenbestand unangetastet bleiben');
});

/* ═══════════ 4. Gesamtsicherungs-ZIP: angereicherte Sammlung, kein /api/admin/ ═══════════ */

test('ZIP-JSON: Anreicherung existiert, die ZIP ruft sie mit Rueckfall, Sektion bleibt /api/admin/-frei', () => {
  assert.ok(html.includes('async function daBueroDatenAngereichert(){'), 'die faktorisierte Anreicherung fehlt');
  assert.ok(html.includes('window.__bueroorgCollectDataAngereichert=daBueroDatenAngereichert;'),
    'die Anreicherung ist nicht als window-Funktion veroeffentlicht');
  assert.ok(html.includes('const data=await daBueroDatenAngereichert();'),
    'der Einzel-Export (exportBueroJson) laeuft nicht mehr ueber die gemeinsame Anreicherung');

  const zip = schnipsel('  window.downloadAllCasesZip=async function(){', '\n\n  /* ===== Sammel-Indikator:');
  assert.ok(zip.includes("typeof window.__bueroorgCollectDataAngereichert==='function'?window.__bueroorgCollectDataAngereichert():window.__bueroorgCollectData()"),
    'die ZIP sammelt roh statt angereichert (oder ohne Rueckfall auf die Blockreihenfolge)');
  /* Pin des Betriebsarten-Pruefstands: der ZIP-Block laeuft nur im Lokalmodus und darf
     keine Admin-Routen ansprechen. */
  assert.doesNotMatch(zip, /\/api\/admin\//, 'in der downloadAllCasesZip-Sektion steht wieder /api/admin/-Text');
});

/* ═══════════ 5.+6. Buero-JSON: Online-Feldliste und die fuenf nur-lokalen Bestaende ═══════════ */

/* Fuehrt die KOMPLETTE Anreicherungsfunktion im Lokalmodus aus - genau der Weg, den
   ZIP und Einzel-Export teilen. Ein Fehler hier hiesse: beide Sicherungen unvollstaendig. */
async function angereichertLokal(L, ls, fenster) {
  const kern = schnipselMit('async function daBueroDatenAngereichert(){', '\nwindow.__bueroorgCollectDataAngereichert=daBueroDatenAngereichert;');
  const ctx = { console, localStorage: ls };
  ctx.window = Object.assign({ __bueroorgCollectData: async () => ({ rohdaten: true }), bueroLocal: L }, fenster || {});
  vm.createContext(ctx);
  vm.runInContext(kern, ctx, { filename: 'da-angereichert.js' });
  return await ctx.window.__bueroorgCollectDataAngereichert();
}

test('Online-Export: die officeJson-Feldliste traegt datenschutz', () => {
  const fn = schnipsel('async function daBueroDatenAngereichert(){', 'window.__bueroorgCollectDataAngereichert=');
  assert.ok(fn.includes("datenschutz:await oj('datenschutz')"),
    'der Online-Zweig holt die Datenschutz-Dokumentation nicht (Nicht-Admin-Weg bliebe leer)');
});

test('Lokal-Export: die fuenf nachgeruesteten Bestaende wandern mit (ausgefuehrt)', async () => {
  const data = await angereichertLokal({
    kontaktmonitor: [{ caseId: '7', turnusDays: 30 }],
    qualifikationen: { entries: { 'anna|beispiel': { qualification: 'B.A.' } } },
    mapSettings: { activeProvider: 'here', hereApiKey: 'k-1' },
    stammdatenSuggestions: { plz: ['04103'] },
    suggestionRegistry: { version: 1, fields: { sd_titel: {} } },
    aiChats: [], caseOuttakes: [], fileNameStyle: '', datenschutz: null
  }, speicherStub({ bb_suggestion_registry_v1: JSON.stringify({ version: 1, fields: { km_art: {} } }) }));
  assert.equal(data.rohdaten, true, 'die Anreicherung muss auf der rohen Sammlung aufsetzen');
  const oj = data.officeJson;
  assert.equal(oj.kontaktmonitor.entries[0].caseId, '7', 'Kontaktmonitor fehlt im Export');
  assert.ok(oj.qualifikationen.entries['anna|beispiel'], 'Qualifikationen fehlen im Export');
  assert.equal(oj.map_settings.hereApiKey, 'k-1', 'Karten-Einstellungen fehlen im Export');
  assert.deepEqual(Array.from(oj.stammdaten_suggestions.plz), ['04103'], 'Stammdaten-Vorschlaege fehlen im Export');
  assert.ok(oj.suggestion_registry.fields.km_art, 'die Registry muss aus dem FUEHRENDEN localStorage-Stand kommen');
});

test('Import-Merge: alle fuenf Bestaende werden zurueckgespielt, gepflegte Arbeit gewinnt (ausgefuehrt)', () => {
  const kern = schnipsel('          /* Lückenschluss 25.08.2026 (Gegenstück', '          const dsSic=data.officeJson.datenschutz;');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(`this.einspielen=function(L,data,localStorage,window){\n${kern}\n};`, ctx, { filename: 'buero-json-import-merge.js' });

  const L = {
    kontaktmonitor: [{ caseId: '1', turnusDays: 30 }],
    qualifikationen: { entries: { alt: { qualification: 'bleibt' } } },
    mapSettings: { activeProvider: 'here', hereApiKey: 'eigen' },
    stammdatenSuggestions: { plz: ['04103'] }
  };
  const ls = speicherStub();
  let adoptiert = null;
  ctx.einspielen(L, { officeJson: {
    kontaktmonitor: { entries: [{ caseId: '1', turnusDays: 90 }, { caseId: '2', turnusDays: 60 }] },
    qualifikationen: { entries: { alt: { qualification: 'aus-sicherung' }, neu: { qualification: 'kommt' } } },
    suggestion_registry: { version: 1, fields: { km_art: {} } },
    map_settings: { activeProvider: 'google', googleMapsApiKey: 'fremd' },
    stammdaten_suggestions: { plz: ['99999'], ort: ['Leipzig'] }
  } }, ls, { __suggestionRegistry: { adopt: (d) => { adoptiert = d; } }, __stammdatenSuggestions: {} });

  /* Kontaktmonitor: fachlicher Schluessel caseId - gepflegter Turnus bleibt, Fehlendes kommt. */
  assert.equal(L.kontaktmonitor.length, 2, 'der fehlende Fall wurde nicht ergaenzt');
  assert.equal(L.kontaktmonitor[0].turnusDays, 30, 'die Sicherung hat den gepflegten Turnus ueberschrieben');
  /* Qualifikationen: je Personen-Schluessel - Bestand gewinnt, Fehlendes kommt. */
  assert.equal(L.qualifikationen.entries.alt.qualification, 'bleibt');
  assert.equal(L.qualifikationen.entries.neu.qualification, 'kommt');
  /* Registry: hier Leerstand -> uebernehmen UND in die laufende Sitzung adoptieren. */
  assert.ok(ls._roh.bb_suggestion_registry_v1, 'die Registry wurde nicht in den fuehrenden localStorage-Schluessel gelegt');
  assert.ok(adoptiert && adoptiert.fields.km_art, 'die laufende Sitzung uebernimmt die Registry nicht (adopt fehlt)');
  /* Karten: eingetragene API-Schluessel = gepflegt -> die Sicherung darf NICHT hinein. */
  assert.equal(L.mapSettings.hereApiKey, 'eigen', 'eingetragene API-Schluessel wurden ueberschrieben');
  assert.equal(L.mapSettings.googleMapsApiKey, undefined, 'die fremde Karten-Konfiguration wurde vermischt');
  /* Stammdaten-Vorschlaege: je Feld - gepflegtes Feld bleibt, fehlendes Feld kommt. */
  assert.deepEqual(L.stammdatenSuggestions.plz, ['04103'], 'das gepflegte Vorschlagsfeld wurde ueberschrieben');
  assert.deepEqual(L.stammdatenSuggestions.ort, ['Leipzig'], 'das fehlende Vorschlagsfeld wurde nicht ergaenzt');
});

test('loadBueroLocal-Whitelist: die fuenf Bestaende ueberleben das Neuladen (ausgefuehrt)', () => {
  /* Die Whitelist baut window.bueroLocal komplett neu - was hier fehlt, ist nach jedem
     Reload weg und der naechste Export laese es leer. Genau dieser Verlustweg wird geprueft. */
  const kern = schnipsel('function loadBueroLocal(){', 'function saveBueroLocal(){');
  const ctx = {
    console,
    BUERO_LOCAL_KEY: 'betreuungsbuero.bueroLocal.v1',
    localStorage: speicherStub({ 'betreuungsbuero.bueroLocal.v1': JSON.stringify({
      kontaktmonitor: [{ caseId: '7', turnusDays: 30 }],
      qualifikationen: { entries: { 'anna|beispiel': { qualification: 'B.A.' } } },
      mapSettings: { activeProvider: 'here', hereApiKey: 'k-1' },
      stammdatenSuggestions: { plz: ['04103'] },
      suggestionRegistry: { version: 1, fields: { km_art: {} } }
    }) }),
    emptyOfficeProfile: () => ({}),
    emptyMapSettings: () => ({ activeProvider: 'osm', googleMapsApiKey: '', hereApiKey: '' })
  };
  vm.createContext(ctx);
  vm.runInContext(`${kern}\nthis.L=loadBueroLocal();`, ctx, { filename: 'load-buero-local.js' });
  const L = ctx.L;
  assert.equal(L.kontaktmonitor.length, 1, 'Kontaktmonitor wird beim Neuladen verworfen');
  assert.ok(L.qualifikationen.entries['anna|beispiel'], 'Qualifikationen werden beim Neuladen verworfen');
  assert.equal(L.mapSettings.hereApiKey, 'k-1', 'Karten-Einstellungen werden beim Neuladen verworfen');
  assert.deepEqual(Array.from(L.stammdatenSuggestions.plz), ['04103'], 'Stammdaten-Vorschlaege werden beim Neuladen verworfen');
  assert.ok(L.suggestionRegistry.fields.km_art, 'der Registry-Spiegel wird beim Neuladen verworfen');
});

/* ═══════════ 7. Blockzahl ═══════════ */

test('die Auslieferung behaelt exakt 309 Script-Bloecke', () => {
  const bloecke = html.split('\n').filter((zeile) => zeile.startsWith('<script')).length;
  assert.equal(bloecke, 309, 'Blockzahl-Regel verletzt: neue Bloecke einfuegen ist verboten, Code gehoert in bestehende');
});
