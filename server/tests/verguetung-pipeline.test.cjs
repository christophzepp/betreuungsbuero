'use strict';

/* Pruefstand fuer die Verguetungs-Pipeline (25.08.2026):
     - EINE Statuswahrheit statt der drei widerspruechlichen "offen"-Begriffe
     - Zahlungsziel (30 Tage) und daraus abgeleitete Ueberfaelligkeit
     - Nummernkreis erkennt beide Serien
     - Zahlungsabgleich gegen die Kontoumsaetze der Buerofinanzen
   Statuslogik und Serverroute werden AUSGEFUEHRT, nicht nur gegrept. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);
const lies = (...teile) => fs.readFileSync(path.join(__dirname, '..', ...teile), 'utf8');

/* Die Statusfunktionen aus dem Rechnungsblock isoliert ausfuehrbar machen. */
function statusFunktionen() {
  const a = html.indexOf('function invoiceIso(wert){');
  const b = html.indexOf('function invoiceRowHTML(inv){');
  assert.ok(a > 0 && b > a, 'Statusfunktionen nicht extrahierbar');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${html.slice(a, b)}
    this.f={invoiceStatusOf,invoiceIstOffen,invoiceOffenerBetrag,invoiceStandardFaellig,invoiceIso,invoiceHeuteIso,invoiceIstBewilligt};`,
  ctx, { filename: 'invoice-status.js' });
  return ctx.f;
}

const inTagen = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('Statuswahrheit: alle Zustaende werden korrekt abgeleitet', () => {
  const { invoiceStatusOf: st } = statusFunktionen();
  assert.equal(st({ summe: 294, faelligAm: inTagen(5) }), 'gestellt');
  assert.equal(st({ summe: 294, faelligAm: inTagen(-1) }), 'ueberfaellig', 'Faelligkeit ueberschritten');
  assert.equal(st({ summe: 294, status: 'bewilligt', faelligAm: inTagen(5) }), 'bewilligt');
  assert.equal(st({ summe: 294, status: 'bewilligt', faelligAm: inTagen(-1) }), 'ueberfaellig',
    'auch eine bewilligte Rechnung wird ueberfaellig');
  assert.equal(st({ summe: 294, eingangsbetrag: 294 }), 'bezahlt');
  assert.equal(st({ summe: 294, eingangDatum: '01.08.2026' }), 'bezahlt', 'Gebucht-Knopf setzt nur das Datum');
  assert.equal(st({ summe: 294, status: 'storniert', eingangsbetrag: 294 }), 'storniert', 'storniert schlaegt alles');
  /* Der alte Widerspruch: teilbezahlt galt im Menue als bezahlt, im Dashboard als offen. */
  assert.equal(st({ summe: 294, eingangsbetrag: 100, eingangDatum: '01.08.2026' }), 'teilbezahlt');
  /* Centdifferenzen (Rundung/Gebuehren) duerfen keine Dauerbaustelle erzeugen. */
  assert.equal(st({ summe: 294, eingangsbetrag: 293.999 }), 'bezahlt');
});

test('Statuswahrheit: offener Betrag und Zahlungsziel', () => {
  const { invoiceIstOffen: offen, invoiceOffenerBetrag: rest, invoiceStandardFaellig: faellig } = statusFunktionen();
  assert.equal(rest({ summe: 294, eingangsbetrag: 100 }), 194, 'Restforderung falsch');
  assert.equal(rest({ summe: 294, eingangsbetrag: 294 }), 0, 'bezahlte Rechnung hat keinen Rest');
  assert.equal(offen({ summe: 294, eingangsbetrag: 100 }), true);
  assert.equal(offen({ summe: 294, eingangsbetrag: 294 }), false);
  assert.equal(offen({ summe: 294, status: 'storniert' }), false, 'storniert ist nicht offen');
  /* Zahlungsziel: 30 Tage ab Rechnungsdatum, deutsches wie ISO-Datum. */
  assert.equal(faellig('25.08.2026'), '2026-09-24');
  assert.equal(faellig('2026-08-25'), '2026-09-24');
  assert.equal(faellig(''), '', 'ohne Rechnungsdatum kein Zahlungsziel');
});

test('Statuswahrheit: alle Verbraucher nutzen dieselbe Funktion', () => {
  assert.ok(html.includes('window.__invoiceStatus=invoiceStatusOf'), 'Statusfunktion nicht exportiert');
  assert.ok(html.includes('window.__invoiceOffen=invoiceIstOffen'), 'Offen-Funktion nicht exportiert');
  /* Die drei frueheren Eigenbau-Ableitungen duerfen nicht mehr allein stehen. */
  assert.ok(!html.includes('inv.filter(x=>x&&!x.eingangDatum).length'), 'Menue-Abzeichen rechnet noch selbst');
  assert.ok(!/const invOpen=\(invoices\|\|\[\]\)\.filter\(function\(inv\)\{const d=/.test(html),
    'Dashboard-Panel rechnet noch selbst');
  assert.ok(!html.includes('paid=!!(x.eingangDatum||Number(x.eingangsbetrag)>0)'), 'Fall-Zeitleiste rechnet noch selbst');
  /* Vier Umstellungen: Menue, Dashboard, Zeitleiste, Fallabschluss-Checkliste. */
  assert.ok((html.match(/window\.__invoiceOffen\?/g) || []).length >= 3, 'nicht alle Verbraucher umgestellt');
});

test('Ansicht: Statusspalte, Faelligkeit und Pipeline sind verdrahtet', () => {
  assert.ok(html.includes('<th>Status</th><th>Fällig</th>'), 'Spalten fehlen im Tabellenkopf');
  assert.ok(html.includes('colspan="13"'), 'Leerzustand nicht auf 13 Spalten nachgezogen');
  assert.ok(html.includes('window.__invoiceMarkApproved'), 'Bewilligt-Aktion fehlt');
  assert.ok(html.includes('invoiceFormFaellig'), 'Zahlungsziel fehlt im Formular');
  assert.ok(html.includes('invoiceFormStatus'), 'Status fehlt im Formular');
  assert.ok(html.includes('function invoicePipelineHTML()'), 'Pipeline-Ansicht fehlt');
  assert.ok(html.includes('window.__invoicePipelineToggle'), 'Pipeline-Umschalter fehlt');
  assert.ok(html.includes('async function invoicePipelineFristen()'), 'Vorausschau fehlt');
  assert.ok(html.includes('window.__invoiceVorschlagBuchen'), 'Buchen aus dem Vorschlag fehlt');
  /* Gebucht/Bewilligt schreiben den Status mit - sonst faellt die Ansicht auf die Ableitung zurueck. */
  assert.ok(html.includes("status:'bezahlt'"), 'Gebucht-Knopf setzt den Status nicht');
});

test('Dashboard-Panel "Verguetungsantraege" war dauerhaft leer - Filter repariert', () => {
  /* Der Titelfilter suchte "Vergütungsantrag…", die Erzeuger vergeben aber
     "Vergütungsabrechnung fällig (…, VBVG)". Jetzt entscheidet die Kategorie. */
  assert.ok(!/if\(\/\^\\s\*verg\[uü\]tungsantrag\/i\.test\(String\(fr\.title\|\|''\)\)\)vergOpen/.test(html),
    'alter Titelfilter steht noch');
  assert.ok(html.includes("String(fr.category||'')==='verguetung'"), 'Kategoriefilter fehlt');
});

test('Server: Statusfelder, Zahlungsziel und Sicherungs-Einordnung', () => {
  const dbSrc = lies('src', 'database', 'index.js');
  for (const spalte of ['status', 'faellig_am', 'bewilligt_am', 'report_id', 'case_id']) {
    assert.ok(dbSrc.includes(`addColumnIfMissing('outgoing_invoices', '${spalte}'`), `Spalte ${spalte} fehlt`);
  }
  /* Die Migration MUSS hinter der Tabellenanlage stehen, sonst startet der Server nicht. */
  assert.ok(dbSrc.indexOf('CREATE TABLE IF NOT EXISTS outgoing_invoices')
    < dbSrc.indexOf("addColumnIfMissing('outgoing_invoices', 'status'"),
  'Spalten werden vor der Tabellenanlage ergaenzt - der Server bricht beim Start ab');
  const routes = lies('src', 'modules', 'finance', 'invoice-routes.js');
  assert.ok(routes.includes('function standardFaelligkeit'), 'Zahlungsziel-Regel fehlt');
  assert.ok(routes.includes("const STATUS = new Set(['', 'gestellt', 'bewilligt', 'teilbezahlt', 'bezahlt', 'storniert'])"),
    'Statusmodell fehlt oder weicht ab');
  /* Mit case_id-Spalte verlangt der Sicherungs-Pruefstand eine Fall-Einordnung. */
  const backup = lies('src', 'modules', 'backup', 'portable-data.js');
  assert.match(backup, /table: 'outgoing_invoices'[\s\S]{0,600}?caseExcludedReason/,
    'outgoing_invoices ist nicht als fallausgeschlossen begruendet');
});

test('Server: Nummernkreis und Zahlungsabgleich (ausgefuehrt)', () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-test-'));
  const alterRoot = process.env.RUNTIME_ROOT;
  process.env.RUNTIME_ROOT = runtime;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(path.join('server', 'src'))) delete require.cache[key];
  }
  try {
    const db = require('../src/database');
    const ins = db.prepare(`INSERT INTO outgoing_invoices (id,re_datum,re_nummer,empfaenger,verwendungszweck,case_label,rechnungszeitraum,summe,status,faellig_am)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    ins.run(crypto.randomUUID(), '2026-08-01', 'RE-2026-0231', 'Landesjustizkasse', 'Betreuervergütung', 'Nowak, Halina', '', 291, 'gestellt', '2026-08-31');
    ins.run(crypto.randomUUID(), '2026-07-13', 'RE-2026-0209', 'Landesjustizkasse', 'Betreuervergütung', 'Rothenberg, Dieter', '', 294, 'gestellt', '2026-08-12');
    const stId = crypto.randomUUID();
    db.prepare('INSERT INTO finance_statements (id,filename,konto) VALUES (?,?,?)').run(stId, 'auszug.csv', 'geschaeftlich');
    const tx = db.prepare(`INSERT INTO finance_transactions (id,statement_id,konto,booking_date,counterparty,purpose,amount) VALUES (?,?,?,?,?,?,?)`);
    tx.run(crypto.randomUUID(), stId, 'geschaeftlich', '2026-08-20', 'Landesjustizkasse', 'Verguetung RE-2026-0231 Nowak', 291);
    tx.run(crypto.randomUUID(), stId, 'geschaeftlich', '2026-08-05', 'Landesjustizkasse', 'Zahlung ohne Nummer', 294);
    tx.run(crypto.randomUUID(), stId, 'geschaeftlich', '2026-08-18', 'Fremd', 'Nichts passendes', 77.5);

    const router = require('../src/modules/finance/invoice-routes');
    const rufe = (pfad, methode, query) => new Promise((res) => {
      const layer = router.stack.find((l) => l.route && l.route.path === pfad && l.route.methods[methode]);
      assert.ok(layer, `Route ${methode} ${pfad} fehlt`);
      const handler = layer.route.stack[layer.route.stack.length - 1].handle;
      handler({ query: query || {}, params: {}, body: {}, session: { userId: 1, isAdmin: true, canViewCases: true } },
        { json: res, status: () => ({ json: res }) }, () => {});
    });

    return (async () => {
      /* Nummernkreis: die vorhandene RE-Serie muss fortgesetzt werden, nicht eine zweite begonnen. */
      const nn = await rufe('/next-number', 'get', { year: '2026' });
      assert.equal(nn.nextNumber, 'RE-2026-0232', 'zweiter Nummernkreis wuerde beginnen');
      assert.equal(nn.serie, 'RE');

      const v = await rufe('/zahlungsvorschlaege', 'get', {});
      assert.equal(v.vorschlaege.length, 2, 'fremde Buchung wurde mitgeschleppt oder Treffer fehlen');
      const sicher = v.vorschlaege.find((x) => x.reNummer === 'RE-2026-0231');
      assert.equal(sicher.guete, 'sicher', 'Nummer im Verwendungszweck + Betrag muss "sicher" ergeben');
      assert.equal(sicher.betrag, 291);
      const nurBetrag = v.vorschlaege.find((x) => x.reNummer === 'RE-2026-0209');
      assert.equal(nurBetrag.guete, 'betrag', 'Betragstreffer ohne Nummer falsch eingestuft');
      assert.ok(!v.vorschlaege.some((x) => Number(x.betrag) === 77.5), 'unpassende Buchung vorgeschlagen');
    })();
  } finally {
    for (const key of Object.keys(require.cache)) {
      if (key.includes(path.join('server', 'src'))) delete require.cache[key];
    }
    if (alterRoot === undefined) delete process.env.RUNTIME_ROOT; else process.env.RUNTIME_ROOT = alterRoot;
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});

/* ─── Nachtrag: die Befunde der adversarialen Review (25.08.2026) ─── */

test('Review-Fix: gesetzte Zahlungsstatus, Nullsumme und abgeleitete Faelligkeit', () => {
  const { invoiceStatusOf: st, invoiceIstBewilligt: bew } = statusFunktionen();
  /* Zwei der fuenf Auswahlwerte im Formular waren wirkungslos. */
  assert.equal(st({ summe: 294, status: 'bezahlt', faelligAm: inTagen(-30) }), 'bezahlt',
    'gesetzter Status bezahlt wurde ignoriert');
  assert.equal(st({ summe: 294, status: 'teilbezahlt' }), 'teilbezahlt', 'gesetzter Status teilbezahlt wurde ignoriert');
  /* Null-/Gutschriftrechnung liess sich nie abschliessen. */
  assert.equal(st({ summe: 0, eingangDatum: '25.08.2026', status: 'bezahlt' }), 'bezahlt');
  /* Altbestand hat kein faellig_am - ohne Ableitung koennte er nie ueberfaellig werden. */
  assert.equal(st({ summe: 294, reDatum: '01.01.2020' }), 'ueberfaellig', 'Faelligkeit wird nicht abgeleitet');
  /* Bewilligung darf durch 'ueberfaellig' nicht unsichtbar werden. */
  assert.equal(bew({ summe: 294, status: 'bewilligt', faelligAm: inTagen(-5) }), true);
  assert.ok(html.includes('function invoiceIstBewilligt(inv)'), 'Bewilligungs-Merkmal fehlt');
  assert.ok(html.includes('!invoiceIstBewilligt(inv))?`<button'), 'Bewilligt-Knopf erscheint erneut');
});

test('Review-Fix: Zahlungsziel ueberlebt das Bearbeiten', () => {
  /* Das Formular fuellte ISO in ein Feld, das nur TT.MM.JJJJ akzeptiert -> beim Speichern leer. */
  assert.ok(html.includes("window.__isoToGermanDate(invoiceIso(inv.faelligAm))"),
    'Zahlungsziel wird nicht im deutschen Format ins Formular gefuellt');
  const routes = lies('src', 'modules', 'finance', 'invoice-routes.js');
  assert.match(routes, /faelligAm: faelligAm !== undefined[\s\S]{0,200}standardFaelligkeit\(reDatum != null \? reDatum : row\.re_datum\)/,
    'PUT setzt den 30-Tage-Standard nicht - Bearbeiten wuerde das Ziel loeschen');
  assert.ok(routes.includes("faelligAm: row.faellig_am || standardFaelligkeit(row.re_datum)"),
    'Altbestand bekommt beim Lesen keine abgeleitete Faelligkeit');
});

test('Review-Fix: Zahlungsvorschlaege sind rechtegeschuetzt, gedeckelt und dublettenfrei', () => {
  const routes = lies('src', 'modules', 'finance', 'invoice-routes.js');
  /* Die Route liest Buerofinanz-Buchungen - ohne Finanzrecht waere das eine Rechteumgehung. */
  assert.match(routes, /router\.get\('\/zahlungsvorschlaege', requireViewCases, requireViewFinance/,
    'Kontobuchungen ohne Finanzrecht erreichbar');
  assert.ok(routes.includes('const vergeben = new Set()'), 'kein Schutz gegen Doppelvorschlag derselben Buchung');
  assert.ok(routes.includes('const MAX = 200'), 'Vorschlagsliste ist ungedeckelt');
  assert.ok(routes.includes('const istOffen = (r) =>'), 'Serverfilter folgt nicht der Statuswahrheit');
  /* Eine zweite Teilzahlung muss sich addieren, nicht die erste ueberschreiben. */
  assert.ok(html.includes('const gesamt=Math.round((alt+(Number(betrag)||0))*100)/100'),
    'Teilzahlung wuerde die erste Zahlung loeschen');
});

test('Review-Fix: Nummernserie im Client und ueber den Jahreswechsel', () => {
  assert.ok(html.includes("return d.nextNumber||d.number||''"), 'Client las das falsche JSON-Feld');
  assert.ok(html.includes("langIrgendwann=/^RE-\\d{4}-\\d{4,}$/"), 'Lokalmodus kennt die RE-Serie nicht');
  const routes = lies('src', 'modules', 'finance', 'invoice-routes.js');
  assert.ok(routes.includes('reSerieGefuehrt'), 'Jahreswechsel faellt auf das Altformat zurueck');
  assert.ok(routes.includes('\\\\d{4,}'), 'Nummernueberlauf bei 9999 nicht abgefangen');
});

test('Review-Fix: Ansicht, Exporte, Dark-Mode und Lokalmodus', () => {
  /* Label-Vergleich der Vorausschau: "Mustermann, Max" vs "Max Mustermann". Geprueft wird die
     VERHALTENSWEISE, nicht der Funktionsname - die erste Fassung dieses Prueffalls pinnte
     'const nrmLabel=(x)=>' woertlich und wurde beim Umbenennen rot, ohne dass etwas kaputt war. */
  assert.ok(/function invoiceNrmLabel\(|const nrmLabel=\(x\)=>/.test(html), 'Label-Abgleich nicht normalisiert');
  assert.ok(html.includes(".replace(/\\s*\\([^)]*\\)\\s*$/,'')"), 'Klammerzusatz wird nicht entfernt');
  /* Exporte kennen die neuen Spalten. */
  assert.ok(html.includes("'Differenz in €','Status','Fällig'"), 'Excel-Export ohne Status/Fällig');
  assert.ok(html.includes("{key:'status',label:'Status'"), 'PDF-Export ohne Status');
  assert.ok(html.includes("html[data-theme=\"dark\"] .invoice-pipeline{"), 'Dark-Mode fehlt');
  /* Lokal angelegte Rechnungen (Brücke, Posteingang) brauchen Fälligkeit und Status. */
  assert.equal((html.match(/faelligAm:\(window\.__invoiceStandardFaellig\?/g) || []).length, 3,
    'nicht alle lokalen Anlegepfade setzen Faelligkeit/Status');
});
