'use strict';

/* Pruefstand fuer die Verknuepfung Ausgangsrechnung <-> Verguetungsantrag <-> Fall (25.08.2026).

   Ausgangslage: Die Datenbank trug seit dem Pipeline-Umbau die Spalten report_id und case_id,
   der Server nahm sie entgegen - aber KEIN einziger Client-Weg fuellte sie. Die Verbindung hing
   damit weiterhin allein an der RE-Nummer im Dokumenttext und riss beim Umbenennen still.

   Festgenagelt wird deshalb beides: dass die vier Anlagewege die Kennung mitgeben, UND dass der
   Altbestand (Rechnungen, die nur ein Etikett tragen) dabei nichts verliert. Wo es geht, wird
   ausgefuehrt statt gegrept. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');

const APP = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP, 'utf8');
const lies = (...teile) => fs.readFileSync(path.join(__dirname, '..', ...teile), 'utf8');

/* Schneidet einen Bereich zwischen zwei eindeutigen Marken heraus. */
function region(von, bis, wieso) {
  const a = html.indexOf(von);
  const b = html.indexOf(bis, a + 1);
  assert.ok(a > 0 && b > a, `${wieso}: Bereich nicht auffindbar`);
  return html.slice(a, b);
}

/* ─────────────── Client: der gemeinsame Fallbezug-Vergleicher ─────────────── */

function vergleicher() {
  const code = region('function invoiceNrmLabel(x){', 'window.__invoiceNrmLabel=', 'Vergleicher');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${code}\nthis.f={invoiceNrmLabel,invoiceGehoertZuFall};`, ctx, { filename: 'vergleicher.js' });
  return ctx.f;
}

test('Fallbezug: Kennung schlaegt Etikett, Etikett bleibt Rueckfallebene', () => {
  const { invoiceGehoertZuFall: passt, invoiceNrmLabel: nrm } = vergleicher();

  /* Neue Rechnungen tragen die Kennung - dann zaehlt ausschliesslich sie. */
  assert.equal(passt({ caseId: 'c1', caseLabel: 'Nowak, Halina' }, 'c1', 'Nowak, Halina'), true);
  assert.equal(passt({ caseId: 'c1', caseLabel: 'Nowak, Halina' }, 'c2', 'Nowak, Halina'), false,
    'gleiches Etikett bei anderer Kennung darf NICHT zusammenfallen');

  /* Altbestand ohne Kennung: der normalisierte Etikettenvergleich rettet die Zuordnung. */
  assert.equal(passt({ caseLabel: 'Nowak, Halina' }, 'c1', 'Halina Nowak'), true,
    'Schreibweise "Nachname, Vorname" vs "Vorname Nachname" muss zusammenfinden');
  assert.equal(passt({ caseLabel: 'Nowak, Halina (Betreuung)' }, 'c1', 'Halina Nowak'), true,
    'Klammerzusatz darf nicht trennen');
  assert.equal(passt({ caseLabel: 'Meier, Max' }, 'c1', 'Halina Nowak'), false);

  /* Ohne jeden Bezug darf nichts zusammenfallen - sonst zaehlt jede fallfreie Rechnung mit. */
  assert.equal(passt({ caseLabel: '' }, 'c1', ''), false);
  assert.equal(passt(null, 'c1', 'Nowak, Halina'), false);

  assert.equal(nrm('Nowak, Halina'), nrm('Halina  NOWAK'), 'Normalisierung nicht schreibweisenfest');
});

/* ─────────────── Client: die Fallauswahl im Rechnungsformular ─────────────── */

function formularAuswahl(faelle) {
  const teile = [
    region('function invoiceNrmLabel(x){', 'window.__invoiceNrmLabel=', 'Vergleicher'),
    region('function invoiceCaseSelectHTML(inv){', 'function invoiceFormHTML(){', 'Select-Bauer'),
    region('function invoiceCaseAuswahl(){', 'window.__invoiceSave=', 'Auswahl-Leser'),
  ].join('\n');
  const ctx = {
    esc: (s) => String(s == null ? '' : s),
    escAttr: (s) => String(s == null ? '' : s).replace(/"/g, '&quot;'),
    invoiceCases: faelle,
    document: null,
  };
  vm.createContext(ctx);
  vm.runInContext(`${teile}\nthis.f={invoiceCaseSelectHTML,invoiceCaseAuswahl};`, ctx, { filename: 'auswahl.js' });
  return { f: ctx.f, ctx };
}

const FAELLE = [{ id: 'c1', label: 'Nowak, Halina' }, { id: 'c2', label: 'Rothenberg, Dieter' }];

test('Fallauswahl: Vorauswahl ueber Kennung, ueber Etikett und der verwaiste Sonderfall', () => {
  const { f } = formularAuswahl(FAELLE);

  /* (1) Kennung gesetzt -> genau dieser Fall vorausgewaehlt. */
  const a = f.invoiceCaseSelectHTML({ caseId: 'c2', caseLabel: 'Rothenberg, Dieter' });
  assert.match(a, /<option value="c2"[^>]* selected>/, 'Kennung waehlt den Fall nicht vor');
  assert.ok(!a.includes('__keep'), 'unnoetige Halte-Zeile');

  /* (2) Nur ein Etikett (Altbestand) und es passt -> trotzdem vorausgewaehlt, in ABWEICHENDER
         Schreibweise. Vorher fiel genau das durch und der Bezug ging beim Speichern verloren. */
  const b = f.invoiceCaseSelectHTML({ caseLabel: 'Halina Nowak' });
  assert.match(b, /<option value="c1"[^>]* selected>/, 'Etikett findet den Fall nicht');

  /* (3) Etikett ohne lebenden Fall -> Halte-Zeile, damit das Speichern es nicht loescht. */
  const c = f.invoiceCaseSelectHTML({ caseLabel: 'Meier, Max' });
  assert.match(c, /<option value="__keep"[^>]*selected>/, 'verwaistes Etikett wird nicht gehalten');
  assert.ok(c.includes('nicht mehr im Bestand'), 'Halte-Zeile ohne Erklaerung');

  /* (4) Verwaiste KENNUNG, aber passendes Etikett -> der Fall wird trotzdem gefunden. */
  const d = f.invoiceCaseSelectHTML({ caseId: 'geloescht', caseLabel: 'Nowak, Halina' });
  assert.match(d, /<option value="c1"[^>]* selected>/, 'Etikett-Rueckfall bei toter Kennung fehlt');

  /* (5) Gar kein Bezug -> die Leerzeile ist gewaehlt. */
  const e = f.invoiceCaseSelectHTML({});
  assert.match(e, /<option value="" data-label=""[^>]* selected>/, 'Leerzeile nicht vorausgewaehlt');

  /* (6) Kennung OHNE Etikett und ohne lebenden Fall (archivierter Fall, Rechnung aus dem
         Verguetungsantrag). Ohne Halte-Zeile stuende "Kein Fall zugeordnet" vorgewaehlt da -
         und das naechste Speichern loeschte die einzige belastbare Verknuepfung. */
  const g = f.invoiceCaseSelectHTML({ caseId: 'archiviert-1', caseLabel: '' });
  assert.match(g, /<option value="__keep"[^>]*selected>/, 'Kennung ohne Etikett wird nicht gehalten');
  assert.ok(g.includes('Fall nicht in der Liste'), 'Ersatztext fuer die etikettlose Halte-Zeile fehlt');
});

test('Fallauswahl: das Speichern liest Kennung UND Etikett als Paar', () => {
  const { f, ctx } = formularAuswahl(FAELLE);
  const wahl = (wert, label) => {
    ctx.document = { getElementById: () => ({ value: wert, selectedOptions: [{ getAttribute: () => label }] }) };
    return f.invoiceCaseAuswahl();
  };
  /* Feldweise vergleichen: Objekte aus einem vm-Kontext tragen eine FREMDE Prototypenkette,
     deshalb scheitert deepStrictEqual an strukturgleichen Werten. */
  const gleich = (ist, soll, wieso) => {
    assert.equal(ist.caseId, soll.caseId, `${wieso}: Kennung`);
    assert.equal(ist.caseLabel, soll.caseLabel, `${wieso}: Etikett`);
  };
  gleich(wahl('c1', 'Nowak, Halina'), { caseLabel: 'Nowak, Halina', caseId: 'c1' }, 'gewaehlter Fall');
  /* Die Halte-Zeile behaelt das Etikett und schickt die Kennung GAR NICHT mit - nicht ''!
     Ein leerer Wert heisst serverseitig „ausdruecklich geloest“ (invoice-routes.js: caseId
     gesendet = geaendert) und raeumte die Verknuepfung einer Rechnung ab, deren Fall lediglich
     archiviert oder dem Bearbeiter nicht zugewiesen ist. Gemessen wird das ERGEBNIS: der
     Schluessel darf in der zusammengebauten Nutzlast nicht auftauchen. */
  const halten = wahl('__keep', 'Meier, Max');
  assert.equal(halten.caseLabel, 'Meier, Max', 'verwaistes Etikett: Etikett');
  assert.ok(!('caseId' in halten), 'Halte-Zeile schickt weiterhin eine (leere) Kennung mit');
  const nutzlast = JSON.parse(JSON.stringify({ reNummer: 'RE-2026-0100', ...halten }));
  assert.ok(!('caseId' in nutzlast), 'die zusammengebaute Nutzlast traegt trotzdem eine Kennung');
  /* "Kein Fall zugeordnet" loescht beides - das ist eine bewusste Nutzerangabe. */
  gleich(wahl('', ''), { caseLabel: '', caseId: '' }, 'ausdruecklich kein Fall');
  /* Realistischer Grenzfall: das Formular ist gar nicht gezeichnet, getElementById liefert null.
     (Ein fehlendes document gibt es im Browser nicht - das zu pruefen waere Theater.) */
  ctx.document = { getElementById: () => null };
  gleich(f.invoiceCaseAuswahl(), { caseLabel: '', caseId: '' }, 'ohne gezeichnetes Formular');
});

/* ─────────────── Client: die vier Anlagewege ─────────────── */

test('Alle Anlagewege geben Kennung und Dokumentart mit', () => {
  /* (1) Schnelldialog-Kern nimmt beide Felder entgegen. */
  assert.ok(html.includes("caseId:String(p.caseId||''),reportId:String(p.reportId||'')"),
    '__invoiceQuickCreate reicht caseId/reportId nicht durch');

  /* (2) Der Aufrufer im Fall-Schnellmenue gibt die Fallkennung, die er ohnehin hat. */
  assert.ok(html.includes("caseLabel:ctx.label||'',caseId:ctx.id||'',reportId:'remuneration'"),
    'COVQ wirft ctx.id weiterhin weg');

  /* (3) Die Bruecke aus dem Verguetungsantrag. */
  assert.ok(html.includes("caseId:String(window.__activeServerCaseId||''),"),
    'pushRemunerationInvoice ohne Fallkennung');
  assert.match(html, /caseId:String\(window\.__activeServerCaseId\|\|''\),\s*\n\s*reportId:'remuneration',/,
    'pushRemunerationInvoice ohne Dokumentart');

  /* (4) Der Posteingang und die Rueckrichtung werden AUSGEFUEHRT geprueft (siehe unten) -
         eine Zeichenkette hat hier zweimal das Gegenteil dessen bewiesen, was sie behauptete. */
});

/* ─────────────── Posteingang: Fallkennung nur bei unveraendertem Fall ─────────────── */

/* Nur der Kopf der Funktion samt Finanz- und Rechnungszweig - der Rest der Maskenlogik ist
   fuer diese Frage ohne Belang und braucht Stubs, die nichts beweisen. */
function posteingangSchreiber(lokal) {
  const nrm = region('function invoiceNrmLabel(x){', 'function invoiceGehoertZuFall(', 'Normalisierer');
  const rumpf = region('async function inboxActionWrite(doc,s){', "  if(ak==='buero.mileage'){", 'Posteingang');
  const gesendet = [];
  const ctx = {
    console,
    inboxIsLocal: () => !!lokal,
    fetch: async (url, opt) => { gesendet.push({ url, body: JSON.parse(opt.body) }); return { ok: true }; },
  };
  ctx.window = ctx;
  ctx.bueroLocal = { invoiceEntries: [] };
  ctx.newBueroLocalId = () => 'lokal-1';
  ctx.saveBueroLocal = () => {};
  ctx.__invoiceStandardFaellig = () => '';
  vm.createContext(ctx);
  vm.runInContext(`${nrm}\nwindow.__invoiceNrmLabel=invoiceNrmLabel;\n${rumpf}}\nthis.schreibe=inboxActionWrite;`,
    ctx, { filename: 'posteingang.js' });
  return { schreibe: ctx.schreibe, gesendet, ctx };
}

test('Posteingang: die Kennung geht nur mit, solange der Fall nicht umgestellt wurde (ausgefuehrt)', async () => {
  const doc = { caseId: 'fall-1', caseLabel: 'Nowak, Halina', receivedDate: '2026-08-01', shortDesc: 'Rechnung' };
  const maske = (caseLabel) => ({ actionKey: 'buero.invoice', form: { reNummer: 'RE-2026-0001', caseLabel, summe: '100' } });

  /* (1) Nichts umgestellt -> die Kennung des Dokuments spart der Rechnung das Namensraten. */
  const a = posteingangSchreiber(false);
  await a.schreibe(doc, maske('Nowak, Halina'));
  assert.equal(a.gesendet[0].body.caseId, 'fall-1', 'unveraenderter Fall verliert seine Kennung');

  /* (2) Andere Schreibweise, derselbe Fall - der Vergleich ist normalisiert. */
  const b = posteingangSchreiber(false);
  await b.schreibe(doc, maske('Halina Nowak'));
  assert.equal(b.gesendet[0].body.caseId, 'fall-1', 'Schreibweisenvergleich greift nicht');

  /* (3) Der Nutzer waehlt in der Maske einen ANDEREN Fall: die Kennung des Dokuments darf
         nicht mitgehen, sonst zaehlte die Rechnung unsichtbar weiter bei Nowak, waehrend
         Liste und Excel Rothenberg zeigen. Ohne Kennung loest der Insert-Trigger das
         eindeutige Etikett serverseitig richtig auf. */
  const c = posteingangSchreiber(false);
  await c.schreibe(doc, maske('Rothenberg, Dieter'));
  assert.equal(c.gesendet[0].body.caseId, '', 'umgestellter Fall behaelt die alte Kennung');
  assert.equal(c.gesendet[0].body.caseLabel, 'Rothenberg, Dieter');

  /* (4) "- (kein Fall) -": der Nutzer will ausdruecklich keinen Fall. */
  const d = posteingangSchreiber(false);
  await d.schreibe(doc, maske(''));
  assert.equal(d.gesendet[0].body.caseId, '', 'trotz "kein Fall" bleibt die Kennung stehen');

  /* (5) Dieselbe Regel im Lokalbetrieb - dort gibt es keinen Trigger, der etwas heilen wuerde. */
  const e = posteingangSchreiber(true);
  await e.schreibe(doc, maske('Rothenberg, Dieter'));
  assert.equal(e.ctx.bueroLocal.invoiceEntries[0].caseId, '', 'Lokalzweig schreibt die falsche Kennung');

  /* (6) Ein Dokument ohne Fallbezug erfindet keinen. */
  const g = posteingangSchreiber(false);
  await g.schreibe({ caseId: '', caseLabel: '' }, maske('Rothenberg, Dieter'));
  assert.equal(g.gesendet[0].body.caseId, '');
});

/* ─────────────── Rueckverweis: Antrag -> erzeugte Rechnung ─────────────── */

function antragsBruecke(antwort, lokal) {
  const rumpf = region('async function pushRemunerationInvoice(recipientFallback){',
    '// entry.autoInvoiceCreated', 'Antrags-Bruecke');
  const report = { meta: { invoiceNumber: 'RE-2026-0001', periodFrom: '', periodTo: '' } };
  const ctx = {
    console,
    state: { reports: { remuneration: report }, caseData: { care: { courtName: 'AG Beispiel' } } },
    saveState: () => {},
    toast: () => {},
    remunerationTotal: () => 291,
    fetchNextInvoiceNumber: async () => 'RE-2026-0001',
    invoiceCaseLabel: async () => 'Nowak, Halina',
    /* Genau die Antwortform der eigenen Route: res.status(201).json({invoice: publicInvoice(...)}). */
    fetch: async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(antwort)) }),
  };
  ctx.window = ctx;
  ctx.__activeServerCaseId = 'fall-1';
  ctx.isBueroLocalMode = () => !!lokal;
  ctx.bueroLocal = { invoiceEntries: [] };
  ctx.newBueroLocalId = () => 'lokal-1';
  ctx.saveBueroLocal = () => {};
  ctx.__invoiceStandardFaellig = () => '';
  vm.createContext(ctx);
  vm.runInContext(`${rumpf}\nthis.push=pushRemunerationInvoice;`, ctx, { filename: 'bruecke.js' });
  return { push: ctx.push, report, ctx };
}

test('Rueckverweis Antrag -> Rechnung wird auch online gesetzt (ausgefuehrt)', async () => {
  /* Frueher wurde eine Ebene zu hoch gelesen (angelegt.id statt angelegt.invoice.id) - der
     Zweig schlug damit zu 100 % fehl, ohne Fehler, ohne Toast, ohne Log. Deshalb wird hier
     das ERGEBNIS gemessen und nicht der Wortlaut der Zeile. */
  const a = antragsBruecke({ invoice: { id: 'srv-42', reNummer: 'RE-2026-0001' } }, false);
  assert.equal(await a.push(''), 'RE-2026-0001');
  assert.equal(a.report.meta.invoiceId, 'srv-42', 'Rueckverweis bleibt online leer');
  /* Die Vorwaertsrichtung darf davon unberuehrt bleiben. */
  assert.equal(a.ctx.__activeServerCaseId, 'fall-1');

  /* Ein blanker Datensatz ohne Huelle wird weiterhin gelesen (Altclient, fremde Route). */
  const b = antragsBruecke({ id: 'blank-7' }, false);
  await b.push('');
  assert.equal(b.report.meta.invoiceId, 'blank-7');

  /* Antwort ohne Kennung: kein Absturz und vor allem kein erfundener Wert. */
  const c = antragsBruecke({ invoice: {} }, false);
  await c.push('');
  assert.equal(c.report.meta.invoiceId, undefined);

  /* Der Lokalbetrieb bleibt, wie er war. */
  const d = antragsBruecke({}, true);
  await d.push('');
  assert.equal(d.report.meta.invoiceId, 'lokal-1');
});

test('Excel-Reimport zerstoert die Verknuepfung nicht mehr', () => {
  /* Der Reimport loeschte bisher ALLE Rechnungen und legte sie neu an - damit waeren Status,
     Zahlungsziel, Bewilligungsdatum und die frische Verknuepfung bei jedem Import weg gewesen. */
  assert.ok(!/for\(const e of ex\)await bvJson\(`\/api\/invoices\/\$\{e\.id\}`,'DELETE'\)/.test(html),
    'Reimport loescht weiterhin den gesamten Rechnungsbestand');
  assert.ok(html.includes("const m=schluessel?ex.find(r0=>nr(r0.reNummer)===schluessel&&!vergeben.has(r0.id)):null;"),
    'Abgleich ueber die RE-Nummer fehlt');
  /* Der Reimport MUSS beziffern, was er stehen gelassen hat - sonst liest sich "3 neu" wie
     "3 Rechnungen insgesamt". Geprueft wird die Aussage, nicht ihr Wortlaut: die erste Fassung
     dieses Pins verlangte die transliterierte Schreibweise 'unberuehrt' und wurde rot, als der
     Nutzertext auf das richtige 'unberührt' korrigiert wurde. */
  assert.match(html, /neu, \$\{[^}]*\} aktualisiert, \$\{[^}]*\} unber(ue|ü)hrt/,
    'Reimport meldet nicht, was er stehen liess');
});

test('Excel-Reimport im Lokalmodus gleicht ab statt zu ersetzen (ausgefuehrt)', () => {
  /* Der Lokalzweig ersetzte den GESAMTEN Bestand und vergab dabei neue Kennungen - Fallbezug,
     Dokumentart, Status, Zahlungsziel und Festsetzungsbeschluss waren nach jedem Reimport weg,
     obwohl das Blatt sie gar nicht kennt. Der Zweig wird hier ausgefuehrt. */
  /* Endmarke MIT fuehrendem Zeilenumbruch - sonst trifft indexOf das tiefer eingerueckte
     "else{" der Schleife im Zweig selbst. */
  const roh = region('      if(local){\n        /* 25.08.2026: auch im Lokalbetrieb', '\n      else{', 'Lokaler Reimport');
  let zaehler = 0;
  const ctx = { console };
  ctx.window = ctx;
  ctx.newBueroLocalId = () => 'neu-' + (++zaehler);
  vm.createContext(ctx);
  vm.runInContext(`this.reimport=function(local,L,list,rep){\n${roh}\n};`, ctx, { filename: 'reimport.js' });

  const L = { invoiceEntries: [{
    id: 'lokal-1', reNummer: 'RE-2026-0001', empfaenger: 'AG', caseId: 'fall-17',
    reportId: 'remuneration', status: 'bewilligt', faelligAm: '2026-09-24',
    bewilligtAm: '2026-08-20', summe: 291,
  }] };
  const meldungen = [];
  ctx.reimport(true, L, [
    { reDatum: '01.08.2026', reNummer: 'RE-2026-0001', empfaenger: 'Amtsgericht', caseLabel: 'Nowak, Halina', summe: 291 },
    { reDatum: '02.08.2026', reNummer: 'RE-2026-0002', empfaenger: 'Landeskasse', caseLabel: '', summe: 100 },
  ], (bereich, text) => meldungen.push(text));

  assert.equal(L.invoiceEntries.length, 2, 'die neue Blattzeile wurde nicht ergaenzt');
  const alt = L.invoiceEntries.find((x) => x.reNummer === 'RE-2026-0001');
  assert.equal(alt.id, 'lokal-1', 'neue Kennung vergeben - report.meta.invoiceId zeigt ins Leere');
  assert.equal(alt.caseId, 'fall-17', 'Fallverknuepfung vernichtet');
  assert.equal(alt.reportId, 'remuneration', 'Dokumentart vernichtet');
  assert.equal(alt.status, 'bewilligt', 'Status vernichtet');
  assert.equal(alt.faelligAm, '2026-09-24', 'Zahlungsziel vernichtet');
  assert.equal(alt.bewilligtAm, '2026-08-20', 'Festsetzungsbeschluss vernichtet');
  assert.equal(alt.empfaenger, 'Amtsgericht', 'die Korrektur aus dem Blatt kam nicht an');
  assert.match(meldungen[0], /1 neu, 1 aktualisiert, 0 unber(ue|ü)hrt/, 'Meldung nennt nicht, was geschah');

  /* Dublettensperre wie online: zwei Blattzeilen mit derselben RE-Nummer duerfen nicht beide
     auf denselben Bestandssatz gehen - die zweite wird angelegt. */
  const L2 = { invoiceEntries: [{ id: 'lokal-9', reNummer: 'RE-2026-0007', caseId: 'fall-9' }] };
  ctx.reimport(true, L2, [{ reNummer: 'RE-2026-0007', empfaenger: 'A' }, { reNummer: 'RE-2026-0007', empfaenger: 'B' }], () => {});
  assert.equal(L2.invoiceEntries.length, 2, 'Dublettensperre fehlt');
  assert.equal(L2.invoiceEntries[0].caseId, 'fall-9');

  /* Zeilen ohne RE-Nummer sind nicht abgleichbar und werden angelegt, nie zusammengefuehrt. */
  const L3 = { invoiceEntries: [{ id: 'lokal-5', reNummer: '', caseId: 'fall-5' }] };
  ctx.reimport(true, L3, [{ reNummer: '', empfaenger: 'Ohne Nummer' }], () => {});
  assert.equal(L3.invoiceEntries.length, 2, 'Zeile ohne RE-Nummer wurde zusammengefuehrt');
  assert.equal(L3.invoiceEntries[0].caseId, 'fall-5');
});

test('Vorausschau und Fall-Dashboard vergleichen ueber die Kennung', () => {
  assert.ok(html.includes('const gestellteIds=new Set(invoiceEntries.map(x=>String(x.caseId||\'\').trim()).filter(Boolean));'),
    'Pipeline-Vorausschau kennt die Kennung nicht');
  /* Bis 31.08.2026 stand hier eine Textprobe auf computeOpen() im Fallabschluss-Assistenten.
     Diese Funktion war jedoch seit dem Umbau auf renderOpen()/coLoad*() niemand mehr aufgerufen -
     die Zusage galt also fuer Code, der gar nicht lief. Der lebende Pfad vergleicht in
     coCaseMatch() zuerst ueber die Kennung und faellt erst danach auf das Etikett zurueck;
     genau das wird jetzt geprueft. */
  assert.ok(html.includes('const itemId=String(item&&item.caseId||\'\');\n  if(itemId)return !!ref.caseId&&itemId===ref.caseId;'),
    'Fall-Dashboard vergleicht weiterhin strikt auf Textgleichheit');
});

test('Vorausschau: das Etikett wirkt nur noch als Rueckfallebene (ausgefuehrt)', () => {
  /* Die Etikettenmenge wurde aus ALLEN Rechnungen gebildet - auch aus denen mit belastbarer
     Kennung. Eine Rechnung fuer "Mueller, Hans" markierte damit jeden gleichnamigen anderen
     Fall als abgerechnet und verdeckte dessen offene Verguetungsfrist. */
  const nrm = region('function invoiceNrmLabel(x){', 'function invoiceGehoertZuFall(', 'Normalisierer');
  const mengen = region('  const gestellteIds=new Set(', '  const vorschau=', 'Vorausschau-Mengen');
  const regel = region('    const schonGestellt=', '    const faelligDe=', 'Vorausschau-Regel');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(`${nrm}\nthis.pruefe=function(invoiceEntries,fristen){\n${mengen}\n`
    + `return fristen.map(function(f){\n${regel}\nreturn !!schonGestellt;});\n};`,
    ctx, { filename: 'vorausschau.js' });

  const rechnungen = [
    { caseId: 'a1', caseLabel: 'Mueller, Hans' },   /* neu, mit Kennung */
    { caseId: '', caseLabel: 'Alt, Anna' },          /* Altbestand ohne Kennung */
  ];
  const r = ctx.pruefe(rechnungen, [
    { caseId: 'a1', label: 'Mueller, Hans' },
    { caseId: 'b1', label: 'Mueller, Hans' },
    { caseId: 'c1', label: 'Hans Mueller' },
    { caseId: 'e1', label: 'Alt, Anna' },
    { caseId: 'd1', label: 'Schmidt, Eva' },
  ]);
  assert.equal(r[0], true, 'die eigene Frist wird nicht mehr als abgerechnet erkannt');
  assert.equal(r[1], false, 'namensgleicher Fall gilt weiterhin faelschlich als abgerechnet');
  assert.equal(r[2], false, 'andere Schreibweise desselben Namens ebenso');
  assert.equal(r[3], true, 'Altrechnung ohne Kennung verliert ihren Etikettenbezug');
  assert.equal(r[4], false);
});

/* ─────────────── Server: Pruefung, Erhalt und Altbestand ─────────────── */

test('Server: Fallkennung wird geprueft, Altbestand nachgezogen (ausgefuehrt)', () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'verkn-test-'));
  const alterRoot = process.env.RUNTIME_ROOT;
  process.env.RUNTIME_ROOT = runtime;
  const leeren = () => {
    for (const key of Object.keys(require.cache)) {
      if (key.includes(path.join('server', 'src'))) delete require.cache[key];
    }
  };
  leeren();
  try {
    const db = require('../src/database');
    /* outgoing_invoices.updated_by zeigt auf users(id) - ohne Nutzer scheitert schon das Anlegen
       am Fremdschluessel. Das ist kein Testkunstgriff, sondern die echte Schemabedingung. */
    db.prepare('INSERT INTO users (id, username, password_hash, is_admin) VALUES (1, ?, ?, 1)')
      .run('pruefer', 'x');
    const neuerFall = (id, label) =>
      db.prepare('INSERT INTO cases (id, label, stammdaten_json) VALUES (?,?,?)').run(id, label, '{}');
    neuerFall('fall-1', 'Nowak, Halina');
    /* Zwei Faelle mit demselben Etikett: der Nachzug MUSS hier schweigen. */
    neuerFall('fall-2', 'Doppel, Name');
    neuerFall('fall-3', 'Doppel, Name');

    const router = require('../src/modules/finance/invoice-routes');
    const rufe = (pfad, methode, body, params) => new Promise((res) => {
      const layer = router.stack.find((l) => l.route && l.route.path === pfad && l.route.methods[methode]);
      assert.ok(layer, `Route ${methode} ${pfad} fehlt`);
      const handler = layer.route.stack[layer.route.stack.length - 1].handle;
      let code = 200;
      const antwort = {
        json: (d) => res({ code, ...d }),
        status: (c) => { code = c; return antwort; },
      };
      handler({ query: {}, params: params || {}, body: body || {}, session: { userId: 1, isAdmin: true, canViewCases: true, canEditCases: true } },
        antwort, () => {});
    });

    return (async () => {
      /* (1) Eine echte Kennung wird uebernommen. */
      const gut = await rufe('/', 'post', { reNummer: 'RE-2026-9001', summe: 291, caseId: 'fall-1', reportId: 'remuneration', caseLabel: 'Nowak, Halina' });
      assert.equal(gut.invoice.caseId, 'fall-1');
      assert.equal(gut.invoice.reportId, 'remuneration');

      /* (2) Eine erfundene Kennung wird abgewiesen - ein Verweis ins Leere waere schlechter
             als das Freitextfeld, das er ersetzt. */
      const schlecht = await rufe('/', 'post', { reNummer: 'RE-2026-9002', summe: 10, caseId: 'gibt-es-nicht' });
      assert.equal(schlecht.code, 400, 'erfundene Fallkennung wurde angenommen');

      /* (3) Ohne Kennung bleibt es erlaubt - fallfreie Rechnungen (Bueromiete) gibt es weiter. */
      const ohne = await rufe('/', 'post', { reNummer: 'RE-2026-9003', summe: 60, empfaenger: 'Vermieter' });
      assert.equal(ohne.invoice.caseId, '');

      /* (4) Der Trigger zieht ein EINDEUTIGES Etikett nach - der Weg, den Excel-Import und
             Altclients nehmen, die die Kennung gar nicht kennen. */
      const perLabel = await rufe('/', 'post', { reNummer: 'RE-2026-9004', summe: 100, caseLabel: 'Nowak, Halina' });
      assert.equal(perLabel.invoice.caseId, 'fall-1', 'eindeutiges Etikett wurde nicht nachgezogen');

      /* (5) Bei mehrdeutigem Etikett schweigt der Nachzug - lieber kein Verweis als ein falscher. */
      const doppelt = await rufe('/', 'post', { reNummer: 'RE-2026-9005', summe: 100, caseLabel: 'Doppel, Name' });
      assert.equal(doppelt.invoice.caseId, '', 'mehrdeutiges Etikett wurde falsch aufgeloest');

      /* (6) Ein PUT ohne caseId laesst die Verknuepfung stehen - genau daran haengt, dass ein
             Excel-Reimport sie nicht abraeumt. */
      const bearbeitet = await rufe('/:id', 'put', { summe: 300 }, { id: gut.invoice.id });
      assert.equal(bearbeitet.invoice.caseId, 'fall-1', 'PUT hat die Verknuepfung abgeraeumt');
      assert.equal(bearbeitet.invoice.reportId, 'remuneration');

      /* (7) Ein PUT mit leerer caseId loest bewusst - der Nutzer hat "Kein Fall" gewaehlt.
             Der Trigger darf das nicht sofort rueckgaengig machen, solange kein Etikett dasteht. */
      const geloest = await rufe('/:id', 'put', { caseId: '', caseLabel: '' }, { id: gut.invoice.id });
      assert.equal(geloest.invoice.caseId, '', 'ausdrueckliches Loesen wirkt nicht');

      /* (8) Eine erfundene Kennung im PUT wird ebenso abgewiesen. */
      const putSchlecht = await rufe('/:id', 'put', { caseId: 'auch-nicht' }, { id: gut.invoice.id });
      assert.equal(putSchlecht.code, 400, 'erfundene Kennung im PUT angenommen');
    })();
  } finally {
    leeren();
    if (alterRoot === undefined) delete process.env.RUNTIME_ROOT; else process.env.RUNTIME_ROOT = alterRoot;
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});

test('Server: Dokumentart wird nur der FORM nach geprueft', () => {
  const routes = lies('src', 'modules', 'finance', 'invoice-routes.js');
  assert.ok(routes.includes('function fallPruefen(caseId)'), 'Fallpruefer fehlt');
  assert.ok(routes.includes('function dokumentart(reportId)'), 'Formpruefung der Dokumentart fehlt');
  /* Welche Dokumentarten es gibt, weiss allein der Client - der Server darf keine Liste pflegen,
     die beim naechsten neuen Bericht veraltet. */
  assert.ok(!routes.includes("new Set(['remuneration'"), 'Server pflegt eine Dokumentart-Liste');

  const dbjs = lies('src', 'database', 'index.js');
  assert.ok(dbjs.includes('outgoing_invoices_case_id_from_unique_label_insert'), 'Insert-Trigger fehlt');
  assert.ok(dbjs.includes('outgoing_invoices_case_id_from_unique_label_update'), 'Update-Trigger fehlt');
  assert.ok(dbjs.includes('idx_outgoing_invoices_case_id'), 'Index auf die Fallkennung fehlt');
});

test('Blockzahl bleibt bei 309', () => {
  assert.equal((html.match(/\n<script/g) || []).length, 309, 'Blockzahl veraendert');
});
