'use strict';
/* Demo-Modus, Online-Grundlage (Nutzerentscheid 30.08.2026) - AUSGEFÜHRTE Prüfungen der
   RAM-Attrappen. Die Fragmente werden aus der Auslieferungsdatei geschnitten und in einem
   vm-Kontext mit Stub-window betrieben: Banking (Bestand + Fänger), Kontakt-Ablage-Fänger,
   KI-Vorführantworten. So sind Saldo-Ketten, IBAN-Prüfziffern und die Auftrags-Lebensläufe
   echt gerechnet, nicht nur als Text verankert. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

function schnitt(vonMarke, bisMarke) {
  const a = HTML.indexOf(vonMarke);
  const e = HTML.indexOf(bisMarke, a);
  assert.ok(a > 0 && e > a, `Fragment nicht gefunden: ${vonMarke.slice(0, 40)}`);
  return HTML.slice(a, e);
}

const REGISTRY = [
  { id: 'auerbach|margarete|14.03.1941|7 XVII 214/19', label: 'Auerbach, Margarete', fileNumber: '7 XVII 214/19' },
  { id: 'kilic|emre', label: 'Kilic, Emre', fileNumber: '4 XVII 88/22' },
  { id: 'nowak|halina', label: 'Nowak, Halina', fileNumber: '2 XVII 431/23' },
  { id: 'rothenberg|dieter', label: 'Rothenberg, Dieter', fileNumber: '12 XVII 305/21' },
  { id: 'weidmann|jonas', label: 'Weidmann, Jonas', fileNumber: '9 XVII 62/23' }
];

function bankKontext() {
  const fenster = { __demoModus: true, caseRegistry: REGISTRY.map((r) => ({ ...r })), __currentUser: { displayName: 'Demo 1' } };
  const code = schnitt('let bkDemo=null;', 'async function api(method,url,body){');
  const ctx = { window: fenster, Date, Math, JSON, String, Number, Array, Object, RegExp, parseInt, decodeURIComponent, BigInt };
  vm.createContext(ctx);
  new vm.Script(code + '\n;__exp={store:bkDemoStore};', { filename: 'bank-attrappe.js' }).runInContext(ctx);
  return ctx;
}

function ibanPruefzifferOk(iban) {
  const um = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const z of um) r = (r * 10 + Number(z)) % 97;
  return r === 1;
}

test('Banking-Attrappe: fünf Konten, gültige IBANs, lückenlose Saldo-Ketten', async () => {
  const ctx = bankKontext();
  const r = await ctx.window.__bankDemoApi('GET', '/api/bank/accounts');
  assert.strictEqual(r.accounts.length, 5, 'Nicht je Demofall ein Konto');
  assert.strictEqual(r.assignableCases.length, 5);
  for (const konto of r.accounts) {
    assert.ok(ibanPruefzifferOk(konto.iban), `IBAN ${konto.iban} hat eine falsche Prüfziffer`);
    assert.ok(REGISTRY.some((f) => f.id === konto.caseId), 'Konto trägt keine Registry-Kennung');
    const tx = (await ctx.window.__bankDemoApi('GET', '/api/bank/transactions?iban=' + konto.iban)).transactions;
    assert.ok(tx.length >= 10, `Nur ${tx.length} Umsätze für ${konto.caseLabel}`);
    assert.strictEqual(tx[0].balanceAfter, konto.saldo, 'Neuester Umsatz endet nicht am Kontosaldo');
    for (let i = 0; i + 1 < tx.length; i++) {
      assert.ok(tx[i].bookingDate >= tx[i + 1].bookingDate, 'Umsätze nicht absteigend sortiert');
      const erwartet = Math.round((tx[i].balanceAfter - tx[i].amount) * 100) / 100;
      assert.strictEqual(tx[i + 1].balanceAfter, erwartet, `Saldo-Kette reißt bei ${konto.caseLabel} (#${i})`);
    }
  }
  /* Zeitraum- und Limit-Filter arbeiten wirklich. */
  const iban = r.accounts[0].iban;
  const alle = await ctx.window.__bankDemoApi('GET', '/api/bank/transactions?iban=' + iban);
  const halb = await ctx.window.__bankDemoApi('GET', '/api/bank/transactions?iban=' + iban + '&limit=3');
  assert.strictEqual(halb.geliefert, 3);
  assert.strictEqual(halb.gesamt, alle.gesamt);
  assert.ok(halb.gekappt && halb.hinweis.includes('von ' + alle.gesamt));
});

test('Banking-Attrappe: Auftrags-Lebenslauf entwurf → freigegeben → eingereicht, nie echt', async () => {
  const ctx = bankKontext();
  const konten = (await ctx.window.__bankDemoApi('GET', '/api/bank/accounts')).accounts;
  const neu = await ctx.window.__bankDemoApi('POST', '/api/bank/orders',
    { kontoIban: konten[0].iban, empfaengerName: 'Apotheke am Markt', betragCents: 4150, zweck: 'Testauftrag' });
  assert.strictEqual(neu.order.status, 'entwurf');
  assert.strictEqual(neu.order.caseId, konten[0].caseId, 'Auftrag erbt die Fall-Kennung des Kontos nicht');
  const frei = await ctx.window.__bankDemoApi('POST', '/api/bank/orders/' + neu.order.id + '/approve');
  assert.strictEqual(frei.order.status, 'freigegeben');
  assert.strictEqual(frei.order.approvedByName, 'Demo 1');
  const ein = await ctx.window.__bankDemoApi('POST', '/api/bank/orders/' + neu.order.id + '/submit');
  assert.strictEqual(ein.order.status, 'eingereicht');
  assert.match(ein.order.statusDetail, /Vorführbetrieb/, 'Die Einreichung ist nicht als Attrappe gekennzeichnet');
  await ctx.window.__bankDemoApi('DELETE', '/api/bank/orders/' + neu.order.id);
  const rest = await ctx.window.__bankDemoApi('GET', '/api/bank/orders');
  assert.ok(!rest.orders.some((o) => o.id === neu.order.id), 'Gelöschter Auftrag lebt weiter');
  /* Pflichtfelder wie am Server. */
  await assert.rejects(() => ctx.window.__bankDemoApi('POST', '/api/bank/orders', { kontoIban: konten[0].iban, empfaengerName: 'X', betragCents: 0, zweck: 'x' }), /größer als 0/);
  /* Ohne Demo-Modus fasst der Fänger nichts an. */
  ctx.window.__demoModus = false;
  assert.strictEqual(await ctx.window.__bankDemoApi('GET', '/api/bank/accounts'), undefined);
});

test('Zahlungsvorschläge-Attrappe: sicherer Treffer für die Nowak-Rechnung, RAM-Matching wie am Server', async () => {
  const bctx = bankKontext();
  /* Datengrundlage: das Nowak-Konto trägt die Vergütungs-Abbuchung mit RE-Nummer. */
  const konten = (await bctx.window.__bankDemoApi('GET', '/api/bank/accounts')).accounts;
  const nowak = konten.find((k) => /Nowak/.test(k.caseLabel));
  const tx = (await bctx.window.__bankDemoApi('GET', '/api/bank/transactions?iban=' + nowak.iban)).transactions;
  const verguetung = tx.find((t) => /RE-2026-0231/.test(t.purpose));
  assert.ok(verguetung, 'Die Vergütungs-Buchung mit RE-Nummer fehlt im Nowak-Konto');
  assert.strictEqual(verguetung.amount, -291);
  /* Matching: die geschnittene Client-Funktion gegen Attrappe + RAM-Rechnung laufen lassen. */
  const code = schnitt('async function invoicePipelineVorschlaege(){', 'window.__invoiceVorschlagBuchen=');
  const ctx = {
    window: { __demoModus: true, __appMode: 'local', __bankDemoApi: bctx.window.__bankDemoApi,
      bueroLocal: { invoiceEntries: [
        { id: 'r-nowak', reNummer: 'RE-2026-0231', summe: 291, reDatum: '', status: 'gestellt' },
        { id: 'r-alt', reNummer: 'RE-2025-9999', summe: 123.45, reDatum: '', status: 'bezahlt' }
      ] } },
    invoiceIstOffen: (re) => re.status !== 'bezahlt',
    invoiceIso: () => '',
    encodeURIComponent, Math, String, Number, Set, JSON, Array, Object,
    location: { protocol: 'https:' }, fetch: () => { throw new Error('Demo darf nicht fetchen'); }
  };
  vm.createContext(ctx);
  new vm.Script(code + '\n;__exp=invoicePipelineVorschlaege;', { filename: 'vorschlaege-attrappe.js' }).runInContext(ctx);
  const vorschlaege = await ctx.__exp();
  assert.strictEqual(vorschlaege.length, 1, 'Genau ein Vorschlag erwartet (bezahlte Rechnung darf keinen bekommen)');
  const v = vorschlaege[0];
  assert.strictEqual(v.invoiceId, 'r-nowak');
  assert.strictEqual(v.guete, 'sicher', 'Nummer+Betrag zusammen müssen als sicher gelten');
  assert.strictEqual(v.betrag, 291);
  assert.match(v.zahler, /Mustermensch/);
});

test('Kontakt-Ablage-Attrappe: Ablauf übernehmen/verwerfen/wiederherstellen, Sync-Nachschub einmalig', async () => {
  const uebernommen = [];
  const fenster = {
    __demoModus: true,
    __baImportBueroContacts: (recs) => { uebernommen.push(...recs); return { added: recs.length, skipped: 0 }; },
    __baCollectRows: () => new Array(12)
  };
  const code = schnitt('window.__ciDemoStore=null;', '/* ---------- Demo-Modus (Vollausbau 30.08.): Kalender-Verbindungs-Attrappe');
  const ctx = { window: fenster, JSON, String, Object, Array, Promise, Response, decodeURIComponent };
  vm.createContext(ctx);
  new vm.Script(code, { filename: 'kontakt-attrappe.js' }).runInContext(ctx);
  const rufe = async (url, init) => { const r = ctx.window.__ciDemoFetch(url, init || {}); return r ? { status: r.status, body: JSON.parse(await r.text()) } : null; };

  const quellen = await rufe('/api/office-contacts/sources');
  assert.strictEqual(quellen.body.sources[0].displayName, 'Musterkonto (Vorführung)');
  assert.strictEqual((await rufe('/api/office-contacts/imports')).body.imports.length, 3);
  /* Verwerfen und Wiederherstellen wandern zwischen den Listen. */
  await rufe('/api/office-contacts/imports/ci2/dismiss', { method: 'POST' });
  assert.strictEqual((await rufe('/api/office-contacts/imports')).body.imports.length, 2);
  assert.strictEqual((await rufe('/api/office-contacts/imports?status=dismissed')).body.imports.length, 1);
  await rufe('/api/office-contacts/imports/ci2/restore', { method: 'POST' });
  assert.strictEqual((await rufe('/api/office-contacts/imports')).body.imports.length, 3);
  /* Übernahme ins Büro nutzt den echten vCard-Weg. */
  await rufe('/api/office-contacts/imports/ci1/move', { method: 'POST', body: JSON.stringify({ target: 'office' }) });
  assert.strictEqual(uebernommen.length, 1);
  assert.strictEqual(uebernommen[0].lastName, 'Sommer');
  assert.strictEqual(uebernommen[0].status, 'Aktiv');
  /* Sync liefert genau EINMAL Nachschub. */
  assert.strictEqual((await rufe('/api/office-contacts/imports/sync', { method: 'POST' })).body.added, 1);
  assert.strictEqual((await rufe('/api/office-contacts/imports/sync', { method: 'POST' })).body.added, 0);
  /* Export zählt die angekreuzten, sonst die Adressbuch-Zeilen. */
  assert.strictEqual((await rufe('/api/office-contacts/export', { method: 'POST', body: JSON.stringify({ contactIds: ['a', 'b'] }) })).body.exported, 2);
  assert.strictEqual((await rufe('/api/office-contacts/export', { method: 'POST', body: JSON.stringify({ source: { kind: 'office' } }) })).body.exported, 12);
  /* Unbekannte office-contacts-Wege bleiben unangefasst (null = normaler fetch). */
  assert.strictEqual(ctx.window.__ciDemoFetch('/api/office-contacts', { method: 'GET' }), null);
});

test('KI-Vorführantworten: Themen treffen, Kennzeichnung immer dabei', () => {
  const code = schnitt('function navKiDemoAntwort(frage){', '/* @ki: Frage in natuerlicher Sprache.');
  const ctx = { esc: (t) => String(t) };
  vm.createContext(ctx);
  new vm.Script(code + '\n;__exp=navKiDemoAntwort;', { filename: 'ki-attrappe.js' }).runInContext(ctx);
  const frag = ctx.__exp;
  assert.match(frag('Wann ist der Jahresbericht fällig?'), /Auerbach[\s\S]*7 XVII 214\/19/);
  assert.match(frag('Wie hoch ist der Kontostand von Frau Nowak?'), /2\.197 Euro/);
  assert.match(frag('völlig unbekanntes Thema xyz'), /vorbereitete Antworten zu Beispielthemen/);
  for (const frage of ['Jahresbericht', 'Miete', 'Medikation', 'Kontostand', 'Gesamtplan', 'irgendwas']) {
    assert.match(frag(frage), /Vorführbetrieb: vorbereitete Antwort ohne echte KI-Verbindung\./,
      `Antwort auf „${frage}" ist nicht als Vorführ-Antwort gekennzeichnet`);
  }
});

/* ---------- Vollausbau 30.08. (Nutzerauswahl): vier weitere Attrappen ---------- */
function fetchKontext(vonMarke, bisMarke, fenster) {
  const code = schnitt(vonMarke, bisMarke);
  const ctx = { window: fenster, JSON, String, Object, Array, Number, Math, Date, Set, Promise, Response,
    decodeURIComponent, encodeURIComponent, RegExp };
  vm.createContext(ctx);
  new vm.Script(code, { filename: 'attrappe.js' }).runInContext(ctx);
  return ctx;
}
const rufe = async (fenster, feld, url, init) => {
  const r = fenster[feld](url, init || {});
  return r ? { status: r.status, body: JSON.parse(await r.text()) } : null;
};

test('Kalender-Attrappe: ein Musterkonto, Listen-Auswahl wirkt, Neuanlage ehrlich abgelehnt', async () => {
  const fenster = { __demoModus: true, __ciDemoFetch: () => new Response(JSON.stringify({ ok: true, added: 1, errors: [] }), { status: 200 }) };
  fetchKontext('/* ---------- Demo-Modus (Vollausbau 30.08.): Kalender-Verbindungs-Attrappe',
    '/* ---------- Demo-Modus (Vollausbau 30.08.): Datei-Explorer-Attrappe', fenster);
  /* Der schlanke Indikator-Endpunkt zeigt nur ANGEHAKTE Listen - sonst bliebe der Punkt grau. */
  const kurz = await rufe(fenster, '__calDemoFetch', '/api/calendar/connections');
  assert.strictEqual(kurz.body.connections.length, 1);
  assert.strictEqual(kurz.body.connections[0].calendars.length, 2, 'Nur die angehakten Listen (2 von 3) gehören in die Kurzform');
  /* Die Kontakt-Attrappe und die Kalender-Attrappe müssen dieselbe Verbindung meinen. */
  const voll = await rufe(fenster, '__calDemoFetch', '/api/admin/calendar-connections');
  assert.strictEqual(voll.body.connections[0].id, 'demo-conn', 'Nur mit derselben id greifen Kontakt-Export und -Sync');
  assert.strictEqual(voll.body.connections[0].displayName, 'Musterkonto (Vorführung)');
  assert.deepStrictEqual(voll.body.connections[0].addressbooks.map((a) => a.remoteId), ['', 'beruf']);
  /* Listen-Auswahl wirkt auf die Kurzform durch. */
  await rufe(fenster, '__calDemoFetch', '/api/admin/calendar-connections/demo-conn/calendars',
    { method: 'PUT', body: JSON.stringify({ selectedIds: ['cal-demo-1'], colors: { 'cal-demo-1': '#123456' } }) });
  const danach = await rufe(fenster, '__calDemoFetch', '/api/calendar/connections');
  assert.strictEqual(danach.body.connections[0].calendars.length, 1, 'Abwählen kam in der Kurzform nicht an');
  assert.strictEqual(danach.body.connections[0].calendars[0].color, '#123456');
  /* Kontakt-Sync delegiert an die Kontakt-Ablage; Neuanlage wird ehrlich abgelehnt. */
  const sync = await rufe(fenster, '__calDemoFetch', '/api/admin/calendar-connections/demo-conn/sync-contacts', { method: 'POST' });
  assert.strictEqual(sync.body.added, 1, 'sync-contacts delegiert nicht an die Kontakt-Ablage');
  const neu = await rufe(fenster, '__calDemoFetch', '/api/admin/calendar-connections', { method: 'POST' });
  assert.strictEqual(neu.status, 400);
  assert.match(neu.body.error, /Vorführung/);
  /* Fremde Wege bleiben unangetastet. */
  assert.strictEqual(fenster.__calDemoFetch('/api/calendar/sync', { method: 'POST' }), null);
});

test('Explorer-Attrappe: 13 Register je Fall, Listing ohne Inhalte, Schreibwege gesperrt', async () => {
  const fenster = { __demoModus: true, caseRegistry: REGISTRY.map((r) => ({ ...r })) };
  fetchKontext('/* ---------- Demo-Modus (Vollausbau 30.08.): Datei-Explorer-Attrappe',
    '(function(){\n  const echtesFetch=window.fetch;', fenster);
  const fall = REGISTRY[0];
  const baum = await rufe(fenster, '__dokDemoFetch', '/api/documents/tree?area=case&caseId=' + encodeURIComponent(fall.id));
  assert.strictEqual(baum.body.folders.length, 13, 'Die Fallakte braucht alle 13 Register der Server-Taxonomie');
  assert.strictEqual(baum.body.folders[0].name, '00 - Eingang');
  assert.strictEqual(baum.body.folders[12].name, '12 - Abschluss & Herausgabe');
  assert.ok(Object.values(baum.body.fileCounts).some((n) => n > 0), 'Kein einziger Zähler gefüllt');
  /* Adversariale Prüfrunde 30.08.: Der Baum sucht Wurzelordner mit kinderVon(pid) und
     vergleicht STRIKT gegen (pid||'') - mit parentId:null wäre der ganze Baum leer
     geblieben. Deshalb hier die echte Client-Logik nachvollziehen, nicht nur die Anzahl. */
  const wurzeln = baum.body.folders.filter((f) => f.parentId === ('' || ''));
  assert.strictEqual(wurzeln.length, 13, 'Die Register erscheinen nicht als Wurzelordner (parentId muss "" sein, nicht null)');
  assert.ok(baum.body.folders.every((f) => f.parentId !== null && f.parentId !== undefined),
    'Ein Attrappen-Ordner trägt null als parentId - der Explorer-Baum bliebe leer');
  /* Ordner-Semantik wie am echten Server: /list filtert IMMER auf folderId - auch auf den
     leeren Wert. Ohne das zeigte „(Hauptordner)" den Zähler 0 und listete daneben alles. */
  const wurzelListe = await rufe(fenster, '__dokDemoFetch', '/api/documents/list?area=case&caseId=' + encodeURIComponent(fall.id));
  assert.strictEqual(wurzelListe.body.files.length, 0, 'Die Wurzel darf keine Dateien listen - sie liegen in den Registern');
  const alleOrdner = baum.body.folders.map((f) => f.id);
  const sammle = async (caseId, ordnerIds) => {
    const out = [];
    for (const oid of ordnerIds) {
      const r = await rufe(fenster, '__dokDemoFetch', '/api/documents/list?area=case&caseId=' + encodeURIComponent(caseId) + '&folderId=' + oid);
      out.push(...r.body.files);
    }
    return { body: { files: out } };
  };
  const baum2 = await rufe(fenster, '__dokDemoFetch', '/api/documents/tree?area=case&caseId=' + encodeURIComponent(REGISTRY[1].id));
  const liste1 = await sammle(fall.id, alleOrdner);
  const liste2 = await sammle(REGISTRY[1].id, baum2.body.folders.map((f) => f.id));
  assert.ok(liste1.body.files.length > 0 && liste2.body.files.length > 0);
  assert.strictEqual(liste1.body.files.filter((f) => liste2.body.files.some((g) => g.id === f.id)).length, 0,
    'Die Fallbereiche vermischen sich');
  assert.ok(liste1.body.files.every((f) => f.ocrStatus === 'none'), 'ocrStatus muss none sein, sonst laufen OCR-Nachläufe an');
  /* Ordnerfilter, Suche und Statistik arbeiten wirklich. */
  const einOrdner = liste1.body.files[0].folderId;
  const gefiltert = await rufe(fenster, '__dokDemoFetch', '/api/documents/list?area=case&caseId=' + encodeURIComponent(fall.id) + '&folderId=' + einOrdner);
  assert.ok(gefiltert.body.files.length > 0 && gefiltert.body.files.every((f) => f.folderId === einOrdner));
  /* Riegel-Reihenfolge: ein SCHREIBversuch an einer Datei meldet „schreibgeschützt",
     nicht „kein Dateiinhalt" (der Posteingang machte aus letzterem sogar eine falsche
     Aussage über einen ausstehenden Server-Neustart). */
  const schreibAnDatei = await rufe(fenster, '__dokDemoFetch', '/api/documents/files/dok-demo-d1', { method: 'PATCH' });
  assert.strictEqual(schreibAnDatei.status, 403);
  assert.match(schreibAnDatei.body.error, /schreibgeschützt/);
  const suche = await rufe(fenster, '__dokDemoFetch', '/api/documents/search?area=case&caseId=' + encodeURIComponent(fall.id) + '&q=' + encodeURIComponent(liste1.body.files[0].name.slice(0, 6)));
  assert.ok(suche.body.nameHits.length >= 1, 'Namenssuche findet nichts');
  assert.strictEqual(suche.body.hits.length, 0, 'Volltexttreffer gibt es ohne Inhalte nicht');
  /* Dateiinhalte: seit 30.08. abends ein ECHTES PDF (pdf-lib), damit die Leseansicht
     funktioniert. Der Zweig liefert ein Promise<Response> - der fetch-Wrapper löst das über
     Promise.resolve auf; hier deshalb ausdrücklich awaiten. */
  const inhaltRoh = fenster.__dokDemoFetch('/api/documents/files/' + liste1.body.files[0].id, {});
  assert.ok(inhaltRoh && typeof inhaltRoh.then === 'function', 'Der Datei-Zweig liefert kein Promise mehr');
  const inhalt = await inhaltRoh;
  /* In DIESER Prüfumgebung fehlt pdf-lib - der Zweig muss dann sauber in seinen Fehlerpfad
     laufen statt zu werfen. Die echte Erzeugung (gültiges PDF, Seitenzahl wie angegeben)
     wurde am Prüfstand mit der eingebetteten pdf-lib gemessen und ist unten als Code-Pin
     festgehalten. */
  assert.strictEqual(inhalt.status, 404, 'Ohne pdf-lib muss der Datei-Zweig sauber scheitern, nicht werfen');
  assert.match(JSON.parse(await inhalt.text()).error, /ließ sich kein Inhalt erzeugen/);
  /* Unbekannte Datei: weiterhin ein ehrlicher 404. */
  const fehlt = await fenster.__dokDemoFetch('/api/documents/files/gibtsnicht', {});
  assert.strictEqual(fehlt.status, 404);
  /* Schreibwege: 403; prefs bleibt gutmütig. */
  const schreib = await rufe(fenster, '__dokDemoFetch', '/api/documents/folders', { method: 'POST' });
  assert.strictEqual(schreib.status, 403);
  assert.match(schreib.body.error, /schreibgeschützt/);
  assert.strictEqual((await rufe(fenster, '__dokDemoFetch', '/api/documents/prefs', { method: 'PUT' })).body.ok, true);
  /* Der Fänger versorgt auch die Fallliste - und lässt fremde Wege durch. */
  const faelle = await rufe(fenster, '__dokDemoFetch', '/api/cases');
  assert.strictEqual(faelle.body.cases.length, 5);
  assert.strictEqual(fenster.__dokDemoFetch('/api/cases', { method: 'POST' }), null, 'Fall-Anlage darf nicht abgefangen werden');
  assert.strictEqual(fenster.__dokDemoFetch('/api/invoices', {}), null);
  /* Nicht-Admin-Realität: Sicherungs-Zustand bleibt gesperrt, Job-Listen leer. */
  assert.strictEqual((await rufe(fenster, '__dokDemoFetch', '/api/documents/backup-health')).status, 403);
  assert.deepStrictEqual((await rufe(fenster, '__dokDemoFetch', '/api/documents/import-jobs')).body, { verwalten: false, jobs: [] });
  assert.strictEqual((await rufe(fenster, '__dokDemoFetch', '/api/documents/wiedervorlagen')).body.eintraege.length, 2);
  /* Kein wohlwollendes {ok:true}: Datei-liefernde Wege (Übergabepaket-ZIP) dürfen keinen
     Erfolg vortäuschen - sonst speichert die App einen JSON-Rumpf als vermeintliche ZIP. */
  const unbekannt = await rufe(fenster, '__dokDemoFetch', '/api/documents/falluebergabe-zip?caseId=' + encodeURIComponent(fall.id));
  assert.strictEqual(unbekannt.status, 404, 'Unbekannte Dokumente-Wege melden wieder falschen Erfolg');
  assert.match(unbekannt.body.error, /Vorführung/);
});

test('Formular-Attrappe: Seed, RAM-CRUD und Pflichtfeld wie am Server', async () => {
  const fenster = { __demoModus: true, __currentUser: { displayName: 'Demo 1' } };
  fetchKontext('/* Demo-Modus (Vollausbau 30.08.): Site-Profile-Attrappe.', 'async function ofLoad(){', fenster);
  const start = await rufe(fenster, '__ofDemoFetch', '/api/site-profiles');
  assert.strictEqual(start.body.profiles.length, 3);
  assert.ok(start.body.profiles.every((p) => /example\.de/.test(JSON.stringify(p.mapping) + p.urlPattern)),
    'Die Vorführ-Profile müssen auf fiktive example.de-Adressen zeigen');
  const neu = await rufe(fenster, '__ofDemoFetch', '/api/site-profiles', { method: 'POST', body: JSON.stringify({ name: 'Neues Profil' }) });
  assert.strictEqual(neu.status, 201);
  const nachAnlage = await rufe(fenster, '__ofDemoFetch', '/api/site-profiles');
  assert.strictEqual(nachAnlage.body.profiles.length, 4);
  assert.strictEqual(nachAnlage.body.profiles[3].updatedBy, 'Demo 1');
  const leer = await rufe(fenster, '__ofDemoFetch', '/api/site-profiles', { method: 'POST', body: JSON.stringify({}) });
  assert.strictEqual(leer.status, 400);
  assert.strictEqual(leer.body.error, 'Name fehlt.');
  const geaendert = await rufe(fenster, '__ofDemoFetch', '/api/site-profiles/' + neu.body.id, { method: 'PUT', body: JSON.stringify({ name: 'Umbenannt' }) });
  assert.strictEqual(geaendert.body.profile.name, 'Umbenannt');
  await rufe(fenster, '__ofDemoFetch', '/api/site-profiles/' + neu.body.id, { method: 'DELETE' });
  assert.strictEqual((await rufe(fenster, '__ofDemoFetch', '/api/site-profiles')).body.profiles.length, 3);
  assert.strictEqual((await rufe(fenster, '__ofDemoFetch', '/api/site-profiles/gibtsnicht', { method: 'PUT', body: '{}' })).status, 404);
  assert.strictEqual(fenster.__ofDemoFetch('/api/site-profiles/x/apply-stat', { method: 'POST' }), null);
});

test('Vertretungs-Attrappe: Seed passt zum RAM-Personenregister der Vorführung', () => {
  /* Der Plan verweist auf Personen-IDs - ein Seed mit unbekannten IDs zeigte leere Zeilen. */
  const seed = schnitt('function vertretungDemoSeed(){', 'function vertretungLeer()');
  const register = schnitt('window.bueroLocal.persons=[', 'if(typeof saveBueroLocal===');
  for (const id of ['demo-pers-1', 'demo-pers-2', 'demo-pers-ext-1']) {
    assert.ok(seed.includes(`'${id}'`), `Der Vertretungs-Seed nennt ${id} nicht`);
    assert.ok(register.includes(`id:'${id}'`), `Das RAM-Personenregister kennt ${id} nicht`);
  }
  assert.match(register, /art:'extern'/, 'Ohne externe Person fehlt die Extern-Gruppe im Auswahlfeld');
  assert.ok(!/patches:\[\{path:'vertretung'/.test(schnitt('if(window.__demoModus){\n      try{\n        var zielV=', 'toastMsg(val?')),
    'Der Demo-Zweig der Vertretung darf keinen Server-PATCH enthalten');
});

test('Datenadministration: Fallliste aus der Registry, Schreibwege gesperrt', () => {
  /* Der Demo-Zweig endet mit return - deshalb in eine Funktion gewickelt ausführen. */
  const code = schnitt('if(window.__demoModus){\n      serverCases=(window.caseRegistry||[]).map(function(r){',
    '    if(!force&&serverCasesFetchInFlight)');
  const ctx = { window: { __demoModus: true, caseRegistry: [{ id: 'k1', label: 'Auerbach, Margarete', fileNumber: '7 XVII 214/19',
    state: { caseData: { person: { lastName: 'Auerbach', firstName: 'Margarete', birthDate: '1941-03-14' }, contacts: [1, 2, 3], documentationEntries: [1] }, reports: { a: {}, b: {} }, ui: { exportHistory: [1] } } }] },
    serverCases: [], serverCasesFetchedAt: 0, Array, Object, String, Boolean, Date };
  vm.createContext(ctx);
  new vm.Script('__exp=(function(){' + code + '})();', { filename: 'datenadmin-attrappe.js' }).runInContext(ctx);
  const [fall] = ctx.__exp;
  assert.ok(ctx.serverCasesFetchedAt > 0, 'Der Demo-Zweig setzt den Zeitstempel nicht - die 10s-Drossel liefe ins Leere');
  assert.strictEqual(fall.id, 'k1', 'Die Kennung MUSS die Registry-Kennung bleiben - daran hängt die open()-Brücke');
  assert.strictEqual(fall.hasStammdaten, true);
  assert.strictEqual(fall.contactsCount, 3);
  assert.strictEqual(fall.reportsCount, 2);
  assert.strictEqual(fall.dokuCount, 1);
  assert.strictEqual(fall.exportHistoryCount, 1);
  assert.strictEqual(fall.archived, false);
  /* Alle Schreibwege der Fallverwaltung tragen die Vorführ-Sperre. */
  const gesperrt = (HTML.match(/if\(demoSperre\(\)\)return( null)?;/g) || []).length;
  assert.ok(gesperrt >= 13, `Nur ${gesperrt} Schreibwege der Fallverwaltung sind gesperrt (mindestens 13 erwartet)`);
  assert.match(HTML, /function demoSperre\(\)\{if\(window\.__demoModus\)\{toast\('In der Vorführung nicht möglich/,
    'Die Vorführ-Sperre der Fallverwaltung fehlt');
});

test('Reihenfolge-Vertrag: __wieOnline steht vor jedem Aufrufer', () => {
  /* Selbst gefundene Zeitbombe (30.08.): Der Wohnen-Fallwechsler ruft __wieOnline aus einem
     Block OBERHALB des Modus-Blocks. Solange alle Aufrufe in Funktionskörpern stehen, geht es
     gut - aber ein künftiger Top-Level-Aufruf gäbe einen TypeError beim Laden. Deshalb steht
     die Definition jetzt im ERSTEN Skriptblock; dieser Pin hält das fest. */
  const def = HTML.indexOf('window.__wieOnline=function()');
  assert.ok(def > 0, 'Der Anzeige-Helfer fehlt');
  const ersterBlock = HTML.indexOf('<script id="app-login-ready-replay-script-v1">');
  const zweiterBlock = HTML.indexOf('\n<script', ersterBlock + 10);
  assert.ok(def > ersterBlock && def < zweiterBlock,
    'Die __wieOnline-Definition liegt nicht mehr im ersten Skriptblock - Reihenfolge-Zeitbombe');
  let vorher = 0;
  for (let i = HTML.indexOf('window.__wieOnline()'); i > -1 && i < def; i = HTML.indexOf('window.__wieOnline()', i + 1)) vorher++;
  assert.strictEqual(vorher, 0, `${vorher} __wieOnline-Aufrufe stehen vor der Definition`);
});

test('Feinschliff 30.08.: ausgegraute Schreibwege, offener Fall markiert, ehrliche Texte', () => {
  /* GRUPPE 1 - eine Engstelle graut den ganzen Explorer aus (Nutzerentscheid „sichtbar,
     aber ausgegraut"); dazu die drei Bedienstellen, die darfSchreiben() umgingen. */
  assert.match(HTML, /function darfSchreiben\(\)\{if\(window\.__demoModus\)return false;/,
    'Der Explorer bietet in der Vorführung wieder Schreibfunktionen an, die nur Fehler erzeugen');
  assert.ok(HTML.includes("var wlSchreib=darfSchreiben();"),
    'Die Sammelleiste (Mehrfachauswahl) prüft wieder keine Rechte - auch online ein Fund');
  assert.ok(HTML.includes("+(darfSchreiben()?' <a onclick=\"__dok.tagDialog("),
    'Die „ändern"-Links der Details-Leiste prüfen wieder keine Rechte');
  assert.ok(HTML.includes("(D.bereich==='case'&&D.caseId&&darfSchreiben())?''"),
    '„In Falldoku verknüpfen" ist wieder offen - der Weg POSTet am Attrappen-Fänger vorbei');
  /* /files/zip ist trotz POST ein Leseweg und darf nicht „schreibgeschützt" melden. */
  assert.ok(HTML.indexOf("if(pfad==='/api/documents/files/zip')") < HTML.indexOf("if(methode!=='GET'&&pfad!=='/api/documents/prefs')"),
    'Die ZIP-Ausnahme steht nicht mehr vor dem Schreib-Riegel');

  /* GRUPPE 2 - Anzeige-Wahrheit getrennt von der Server-Wahrheit. */
  assert.match(HTML, /function demoOffenerFallId\(\)\{/, 'Der Anzeige-Helfer für den offenen Vorführfall fehlt');
  assert.ok(HTML.includes("const istOffen=isActive||(String(c.id)===demoOffenerFallId());"),
    'Die Fallliste kennt die Anzeige-Wahrheit nicht mehr');
  assert.ok(HTML.includes('disabled title="Dieser Vorführfall ist gerade geöffnet.">Geöffnet</button>'),
    'Der offene Vorführfall bekommt wieder den scharfen „Schließen"-Knopf oder gar keine Markierung');
  assert.match(HTML, /function closeServerCase\(\)\{\s*\n[^\n]*\n[^\n]*\n\s*if\(demoSperre\(\)\)return;/,
    'closeServerCase ist in der Vorführung wieder scharf - es setzt den Arbeitsstand zurück');
  assert.ok(HTML.includes("window.bueroLocal.kontaktmonitor=kmRoh.map(function(e){"),
    'Der Kontaktmonitor-Bestand der Vorführung wird nicht mehr umgesetzt (Form + Fallkennung)');

  /* GRUPPE 3 - „Entfernen" entfernt wirklich; Lazy-Getter niemals per =null „löschen". */
  assert.ok(HTML.includes("if(!rest&&methode==='DELETE'){st.entfernt=true;v.enabled=false;"),
    'Das Entfernen der Kalenderverbindung baut den Seed wieder neu statt zu entfernen');
  assert.ok(HTML.includes("(window.__calDemoStore&&window.__calDemoStore.entfernt)?[]"),
    'Die Kontakt-Attrappe bietet das entfernte Konto weiter an - die Vorführung widerspricht sich');
  assert.ok(HTML.includes("if(!window.__wieOnline()){calConnectionsCache=[];return calConnectionsCache}"),
    'Das Terminformular zeigt in der Vorführung wieder keinen Speicherort');
  /* Die DATENwege des Kalenders müssen an isOnline() bleiben (RAM statt 403). */
  assert.match(HTML, /async function calCreate\([\s\S]{0,400}?isOnline\(\)/,
    'Ein Kalender-Datenweg hängt nicht mehr an isOnline() - die Demo liefe in die Server-Schranke');

  /* GRUPPE 4 - keine falschen Speicher-Versprechen. */
  assert.match(HTML, /const HERO_DEMO='Ein Vorführbetrieb zum gefahrlosen Kennenlernen/,
    'Der ehrliche Hero-Text der Vorführung fehlt');
  assert.ok(HTML.includes("if(hero)hero.textContent=demo?HERO_DEMO:HERO;"),
    'Die Vorführung bekommt wieder das Server-Versprechen des Online-Textes');
  assert.ok(HTML.includes('<b>Vorführbetrieb:</b> Beispielprofile für Online-Formulare'),
    'Die Formular-Verwaltung behauptet in der Vorführung wieder büroweite Speicherung');
});

test('Fallbezug: die Vorführung kennt ihren offenen Fall (Nutzerfund: fehlende Umschalter)', () => {
  /* WURZELFEHLER, den mehrere Einzelrunden übersehen haben: activeCaseRef() gab in der
     Vorführung null zurück (prüfte isOnline() und __activeServerCaseId, das dort bewusst
     leer bleibt). Folge: In Kalender und Aufgaben fehlte der Umschalter „Alle / Dieser Fall"
     komplett - miniScopeToggleHTML liefert ohne activeLabel eine leere Zeichenkette. Der Fix
     ist EIN zentraler Helfer statt vieler Einzelstellen. */
  assert.match(HTML, /window\.__offenerFallId=function\(\)\{/, 'Der zentrale Fall-Helfer fehlt');
  assert.match(HTML, /window\.__offenerFallLabel=function\(\)\{/, 'Der Label-Helfer fehlt');
  /* Online unverändert: der Helfer gibt dort __activeServerCaseId zurück. */
  assert.match(HTML, /if\(window\.__activeServerCaseId\)return String\(window\.__activeServerCaseId\);/,
    'Der Helfer liefert online nicht mehr die Server-Kennung - Regressionsgefahr');
  const a = HTML.indexOf('async function activeCaseRef(){');
  const block = HTML.slice(a, a + 700);
  assert.ok(block.includes('if(window.__demoModus){'),
    'activeCaseRef ist wieder blind für die Vorführung - Kalender und Aufgaben verlieren ihren Umschalter');
  assert.ok(block.includes('window.__offenerFallId?window.__offenerFallId():'),
    'activeCaseRef nutzt den zentralen Helfer nicht');
  /* Klassen-Fix: ALLE Modul-Fallumschalter über denselben Helfer (Adressbuch, Handkasse,
     Gesundheit, Genehmigungen, Fristen, Schulden, Wohnen/Fähigkeiten, Archiv-Modale …). */
  const umgestellt = (HTML.match(/window\.__offenerFallId\?window\.__offenerFallId\(\)/g) || []).length;
  assert.ok(umgestellt >= 22, `Nur ${umgestellt} Fallbezug-Stellen nutzen den Helfer (mindestens 22 erwartet)`);
  assert.ok(!/const activeId=window\.__activeServerCaseId\|\|'';/.test(HTML),
    'Ein Modul-Umschalter liest wieder direkt __activeServerCaseId - in der Vorführung immer leer');
});

test('Angleichung 30.08. abends: Verwaltungssicht, alle Bereiche, Meine Einstellungen', () => {
  /* Nutzerentscheid: „maximal identisch" - die Vorführung bekam eine zweite Kontenreihe
     (DemoAdmin1..20) und zeigt dieselben Einstellungsbereiche wie der Online-Betrieb. */
  assert.ok(HTML.includes("if(window.__demoModus)return item.id!=='demo';"),
    'Das Einstellungsmenü ist wieder fail-closed - der Vorführung fehlten 13 von 29 Bereichen');
  assert.match(HTML, /if\(window\.__demoModus\)\{einVorgaben=einVorgaben\|\|\[\];einRollenDaten=einRollenDaten\|\|\{rollen:\[\],zuweisungen:\{\}\};return;\}/,
    'Das Vorgaben-Laden läuft in der Vorführung wieder gegen den Server (403 + Schreibwächter)');
  /* Meine Einstellungen + Optik-Angleichungen der letzten Runde. */
  assert.ok(HTML.includes("function calendarCardHTML(){"), 'Kalender-Karte nicht gefunden');
  const cc = HTML.indexOf('function calendarCardHTML(){');
  assert.ok(HTML.slice(cc, cc + 260).includes('if(!window.__wieOnline())return'),
    'Die Kalender-Karte zeigt in der Vorführung wieder die Lokal-Fassung');
  assert.ok(HTML.includes('const local=!window.__wieOnline();'),
    'Die Karten in „Meine Einstellungen" fallen wieder auf die Browser-Werte zurück');
  assert.ok(HTML.includes("if(socialEditorIndexV160<0 && window.__wieOnline()"),
    'Der Ziel-Fall-Picker im Sozialen Netzwerk fehlt der Vorführung wieder');
  assert.ok(HTML.includes("else if(v==='intern')toast(window.__wieOnline()?"),
    'Der Download-Ziel-Hinweis weicht in der Vorführung wieder ab');
});

test('Verwaltungs-Attrappe: die sieben freigeschalteten Bereiche haben eine Datengrundlage', async () => {
  /* Nutzerentscheid 30.08. abends: Nachdem alle 29 Einstellungsbereiche sichtbar wurden,
     riefen sieben davon Admin-Routen, die der Server für Demo-Sitzungen sperrt. Ohne
     Attrappe zeigten sie Fehler statt Inhalt. */
  const fenster = { __demoModus: true, bueroLocal: { persons: [
    { id: 'demo-pers-1', firstName: 'Max', lastName: 'Mustermensch', art: 'intern' }
  ] }, saveBueroLocal: () => {} };
  fetchKontext('/* ---------- Demo-Modus (Nutzerentscheid 30.08.2026): Verwaltungs-Attrappe',
    '(function(){\n  const echtesFetch=window.fetch;', fenster);
  const hol = async (u, init) => { const r = fenster.__admDemoFetch(u, init || {}); return r ? { status: r.status, body: JSON.parse(await r.text()) } : null; };

  const personen = await hol('/api/persons');
  assert.strictEqual(personen.body.persons.length, 1, 'Die Personenliste speist sich nicht aus dem RAM-Register');
  assert.strictEqual(personen.body.persons[0].name, 'Max Mustermensch', 'Der Anzeigename wird nicht gebildet');
  const nutzer = await hol('/api/admin/users');
  assert.ok(nutzer.body.users.length >= 3, 'Keine Vorführ-Nutzerkonten');
  assert.ok(nutzer.body.users.some((u) => u.isAdmin), 'Kein Konto mit Verwaltungssicht');
  assert.ok(nutzer.body.users.every((u) => u.permissions && u.email), 'publicUser-Felder unvollständig - die Liste bliebe leer');
  assert.ok((await hol('/api/admin/audit-log')).body.entries.length >= 3, 'Verarbeitungs-Log ohne Einträge');
  assert.strictEqual((await hol('/api/admin/smtp-config')).body.fromAddress, 'post@betreuungsbuero-mustermensch.de');
  assert.ok((await hol('/api/admin/send-credentials')).body.services.length >= 3, 'Versandwege ohne Dienste');
  assert.ok((await hol('/api/admin/feed-tokens')).body.tokens.length >= 1, 'Kein Feed-Zugang in der Vorführung');
  assert.ok((await hol('/api/admin/sync-journal')).body.entries.length >= 2, 'Sync-Protokoll leer');
  assert.ok((await hol('/api/ext-tokens')).body.tokens.length >= 1, 'Erweiterungs-Zugang fehlt');
  /* Schreibwege: ehrlich abgelehnt, nichts wird verändert. */
  assert.strictEqual((await hol('/api/admin/users/9001', { method: 'PUT' })).status, 400);
  assert.match((await hol('/api/admin/feed-tokens', { method: 'POST' })).body.error, /Vorführung/);
  /* Der Kalender behält seinen eigenen Fänger - der Verwaltungs-Fänger lässt ihn durch. */
  assert.strictEqual(fenster.__admDemoFetch('/api/admin/calendar-connections', {}), null,
    'Der Verwaltungs-Fänger schnappt sich die Kalender-Routen');
  assert.strictEqual(fenster.__admDemoFetch('/api/invoices', {}), null);
});

test('Vorführung liefert die Anwendung nicht als Datei aus (Nutzerfund 30.08. abends)', () => {
  /* Ein Vorführbesucher konnte als Demo-Admin die komplette Programmdatei, die Blanko-Version
     und die Außendienst-Datei herunterladen. Nutzerentscheid: Bereiche bleiben SICHTBAR,
     die erzeugenden Knöpfe sind gesperrt. Ehrliche Grenze: Wer die Seite im Browser hat,
     kann sie über „Sichern unter" ohnehin speichern - das hier nimmt den eingebauten Weg. */
  const gesperrt = (HTML.match(/window\.__demoModus\?' disabled title="In der Vorführung/g) || []).length;
  assert.ok(gesperrt >= 3, `Nur ${gesperrt} Download-Knöpfe sind in der Vorführung gesperrt (3 erwartet)`);
  /* Tiefenverteidigung: die Funktionen selbst riegeln ab, nicht nur die Knöpfe. */
  assert.match(HTML, /async function downloadAppHtml\(blank\)\{[\s\S]{0,420}?if\(window\.__demoModus\)\{try\{toast\('In der Vorführung werden keine Programmdateien ausgeliefert\.'\)/,
    'downloadAppHtml liefert in der Vorführung wieder die volle Anwendung aus');
  assert.match(HTML, /function downloadAllCredentialsHTML\([^)]*\)\{[\s\S]{0,260}?if\(window\.__demoModus\)\{try\{toast\('In der Vorführung werden keine Programmdateien ausgeliefert\.'\)/,
    'Der Zugangsdatenexport ist in der Vorführung wieder offen');
  assert.match(HTML, /window\.__adErzeugen=async function\(\)\{[\s\S]{0,260}?if\(window\.__demoModus\)\{try\{toast\('In der Vorführung wird keine mitnehmbare Datei erzeugt\.'\)/,
    'Die Außendienst-Datei lässt sich in der Vorführung wieder erzeugen');
  /* NACHGEZOGEN nach Nutzerfund: Beim Programmdatei-Knopf fehlte ein Anführungszeichen -
     das disabled landete IM id-Wert (id="lmDownloadBtn disabled title=") und war damit
     wirkungslos. Und ohne Ausgegraut-Regel sah selbst ein korrekt gesperrter Knopf
     einladend aus (es gibt bis heute keine globale .btn:disabled-Regel). */
  for (const id of ['lmDownloadBtn', 'lmBlankBtn', 'adStart']) {
    const m = HTML.match(new RegExp('<button[^>]*id="' + id + '"[^>]*>'));
    assert.ok(m, `Knopf ${id} nicht gefunden`);
    assert.ok(/id="[a-zA-Z]+"/.test(m[0]),
      `Der id-Wert von ${id} ist verunreinigt - ein fehlendes Anführungszeichen macht disabled wirkungslos`);
    assert.ok(/disabled title="In der Vorführung/.test(m[0]),
      `${id} trägt die Vorführ-Sperre nicht als eigenes Attribut`);
  }
  assert.match(HTML, /#lmDownloadBtn:disabled,#lmBlankBtn:disabled,#adStart:disabled,[\s\S]{0,120}\{opacity:\.45;cursor:not-allowed\}/,
    'Die gesperrten Knöpfe sehen wieder aus wie aktive - die Sperre wäre unsichtbar');
  /* Die Bereiche selbst bleiben sichtbar (Nutzerentscheid „sichtbar, gesperrt"). */
  assert.ok(HTML.includes('Vorführbetrieb: Die Anwendung wird hier nicht als Datei ausgeliefert'),
    'Der erklärende Hinweis im Bereich „Lokaler Modus" fehlt');
  assert.ok(HTML.includes('Vorführbetrieb: Die mitnehmbare Datei enthielte die vollständige Anwendung'),
    'Der erklärende Hinweis im Außendienst-Bereich fehlt');
});

test('Vorführdaten kommen wirklich an: Paket-Cache und Mail-Zähler (Nutzerfund 30.08.)', () => {
  /* Zwei Gründe, warum neue Vorführdaten den Nutzer nicht erreichten:
     1. Der Server hielt das gebaute Paket für die GESAMTE Laufzeit im Speicher - ohne
        Neustart sah man den alten Bestand, obwohl der Paketbau längst mehr lieferte.
     2. Die Ungelesen-Zähler (Kopfzeile + Seitenleiste) entstehen erst beim Ordner-Abruf.
        Die stille Postfach-Aktivierung löste ihn nie aus - der Zähler blieb auf 0/„•". */
  const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'demo', 'routes.js'), 'utf8');
  assert.match(server, /function quellenStand\(\)/, 'Der Paket-Cache hängt wieder blind an der Serverlaufzeit');
  assert.ok(server.includes('if (paketCache && stand === paketStand) return Promise.resolve(paketCache);'),
    'Der Cache prüft die Änderungszeit der Vorführdaten nicht mehr');
  assert.ok(server.includes('if (paketCache && stand !== paketStand) { paketCache = null; }'),
    'Ein veralteter Cache wird nicht mehr verworfen');
  assert.match(HTML, /if\(leise===true\)\{[\s\S]{0,700}?await Promise\.all\(\(MX\.accounts\|\|\[\]\)\.map\(a=>loadFolders\(a\.id,true\)\)\);/,
    'Die stille Postfach-Aktivierung lädt die Ordner nicht - die Ungelesen-Zähler blieben leer');
  assert.match(HTML, /if\(leise===true\)\{[\s\S]{0,800}?mxUpdateNavBadge\(\);/,
    'Das Seitenleisten-Abzeichen wird nach der stillen Aktivierung nicht aktualisiert');
});

test('Fallwechsel-Toast: kein Excel-Hinweis in der Vorführung (Nutzerfund 30.08.)', () => {
  /* Der Zusatz „Für den Excel-Export bitte die Stammdaten-Datei erneut auswählen" gehört
     zum Datei-Arbeitsfluss des Lokal-Modus. In der Vorführung gibt es keine Excel-Datei -
     dort meldet der Wechsel nur noch, welcher Fall geöffnet wurde. */
  assert.ok(HTML.includes('if(window.__demoModus)toast(`Fall „${entry.label}“ geladen.`);'),
    'Der Vorführ-Toast beim Fallwechsel fehlt');
  assert.match(HTML, /else if\(!entry\.masterArchive\)toast\(`Fall „\$\{entry\.label\}“ geladen\. Für den Excel-Export/,
    'Der Lokal-Modus hat seinen Excel-Hinweis verloren - dort ist er richtig');
});

test('Datenfülle und Leseansicht (Nutzerfund: kaum Mail, kaum Dateien, leere Leseansicht)', () => {
  /* 1. Kalender-Widget: Es zeichnete AUSSCHLIESSLICH echte Termine - Fristen (rot),
     Wiedervorlagen (orange) und Aufgaben (lila) kannte nur die Vollansicht. Deshalb gab es
     im Widget nie einen roten Punkt, auch online nicht. */
  assert.match(HTML, /const pseudo=await calTodoPseudoEvents\(\(activeRef&&calMiniFilter==='case'\)\?activeRef:null\);/,
    'Das Kalender-Widget holt die Pseudo-Einträge nicht - kein roter Punkt für Fristen');
  assert.ok(HTML.includes('const gridHTML=calendarMonthGridHTML(now,rasterEvents,false);'),
    'Das Monatsraster zeichnet wieder nur echte Termine');
  /* 2. Postfach: Der Posteingang hatte nur neun Nachrichten (der Rest lag in Ordnern). */
  const a = HTML.indexOf('function mxDemoStore(){');
  const e = HTML.indexOf('function mxDemoApi', a);
  const store = HTML.slice(a, e);
  const alle = (store.match(/\bM\(\{/g) || []).length;
  const posteingang = (store.match(/\bM\(\{(?!__folder)/g) || []).length;
  assert.ok(alle >= 60, `Nur ${alle} Nachrichten im Übungspostfach`);
  assert.ok(posteingang >= 18, `Nur ${posteingang} Nachrichten im Posteingang - er wirkte leer`);
  /* 3. Explorer: je Fall ein voller Aktensatz statt drei bis vier Dateien. */
  const d = HTML.indexOf('const GEMEINSAM=[');
  const dEnd = HTML.indexOf('const jetzt=new Date().toISOString();', d);
  const dateien = (HTML.slice(d, dEnd).match(/\[\d+,'/g) || []).length;
  assert.ok(dateien >= 55, `Nur ${dateien} Beispieldateien insgesamt - der Explorer wirkte leer`);
  /* 4. Leseansicht: echte, mehrseitige PDFs statt Platzhaltertext. Am Prüfstand mit der
     eingebetteten pdf-lib erzeugt und geladen: gültiger Kopf, 6 Seiten, Cache greift. */
  assert.match(HTML, /async function dokDemoPdf\(datei\)\{/, 'Der PDF-Erzeuger der Vorführung fehlt');
  assert.ok(HTML.includes('const lib=window.PDFLib||window[\'pdf-lib\'];'),
    'Der PDF-Erzeuger greift nicht mehr auf die eingebettete pdf-lib zu');
  assert.match(HTML, /return dokDemoPdf\(datei\)\s*\n\s*\.then\(bytes=>new Response\(bytes,\{status:200,headers:\{'Content-Type':'application\/pdf'/,
    'Die Datei-Route liefert keinen PDF-Inhalt mehr');
  /* Der Fänger MUSS synchron bleiben - als async wäre sein Rückgabewert immer truthy und
     er verschluckte auch Wege, die durchgereicht werden sollen. */
  assert.ok(HTML.includes('window.__dokDemoFetch=function(url,init){'),
    'Der Explorer-Fänger ist async geworden - er verschluckt dann fremde Wege');
  /* 5. KEIN Kurzschluss mehr vor dem Laden: Ein früherer Demo-Zweig in docLaden zeigte einen
     Platzhaltertext und kehrte zurück, BEVOR das Dokument geholt wurde. Nach dem Umstieg auf
     echte PDFs verhinderte genau er das Lesen (Nutzerfund „wieso kann ich diese Dokumente
     nicht lesen?"). Dasselbe galt für „Öffnen im neuen Tab". */
  assert.ok(!HTML.includes('Diese Datei ist ein Platzhalter'),
    'Der Platzhalter-Kurzschluss in der Leseansicht ist zurück - die Vorführ-PDFs würden nie geladen');
  assert.ok(!HTML.includes('Vorführung: Beispieldatei ohne Inhalt'),
    'Das Öffnen im neuen Tab ist in der Vorführung wieder abgeklemmt');
  assert.ok(!HTML.includes('ohne Dateiinhalte'),
    'Die Fußzeile behauptet weiterhin, es gäbe keine Dateiinhalte');
  const dl = HTML.indexOf('async function docLaden(fid){');
  assert.ok(dl > 0 && !HTML.slice(dl, dl + 700).includes('if(window.__demoModus){'),
    'docLaden hat wieder einen Demo-Kurzschluss vor dem Laden');
});

test('Fallwechsler: einheitliche Beschriftung mit Aktenzeichen (Nutzerfund 30.08.)', () => {
  /* Im Wechsler standen zwei Formate nebeneinander: „Auerbach, Margarete" (aus dem Paket)
     und „Dieter Rothenberg (12 XVII 305/21)". Grund: updateActiveCaseSnapshot überschreibt
     entry.label beim Verlassen eines Falls mit caseLabelOf(state) - ein einmal geöffneter
     Fall bekam damit das App-Format, alle anderen behielten das Paket-Format. Die Registry
     wird jetzt von Anfang an mit derselben Funktion beschriftet. */
  assert.match(HTML, /if\(typeof window\.caseLabelOf==='function'\)beschriftung=window\.caseLabelOf\(f\.state\)\|\|f\.label;/,
    'Die Vorführ-Registry beschriftet nicht mehr mit caseLabelOf - im Wechsler stünden wieder zwei Formate');
  assert.ok(HTML.includes('return {id:kennung||f.label,label:beschriftung,'),
    'Der Registry-Eintrag übernimmt die einheitliche Beschriftung nicht');
  /* Der Kontaktmonitor ordnet deshalb über den Nachnamen zu, nicht über das ganze Label. */
  assert.match(HTML, /const nachLabel=new Map\(registry\.map\(function\(r\)\{return \[nachname\(r\.label\),r\.id\];\}\)\);/,
    'Die Kontaktmonitor-Zuordnung vergleicht wieder ganze Labels - sie träfe nie');
  /* Nutzerwunsch 30.08. spät: „Nachname, Vorname (Az.)" - in ALLEN Betriebsarten. */
  assert.match(HTML, /const name=\(nach&&vor\)\?`\$\{nach\}, \$\{vor\}`:\(nach\|\|vor\|\|'Unbenannter Fall'\);/,
    'Die Fall-Beschriftung steht wieder auf „Vorname Nachname"');
  assert.ok(HTML.includes("return {id,label:(az&&roh.indexOf(az)<0)?(roh+' ('+az+')'):roh};"),
    'Der Online-Fallwechsler zeigt das Aktenzeichen nicht - die Modi wären wieder uneinheitlich');
});

test('Fallwechsler: auch der GEÖFFNETE Fall trägt sein Aktenzeichen (Nutzerfund 30.08. abends)', () => {
  /* Befund: Im Wechsler stand jeder Fall als „Nachname, Vorname (Az.)" - nur der gerade
     geöffnete als „Kilic, Emre". Ursache: Der Login öffnet den zuletzt genutzten Fall sofort,
     also BEVOR der Vorlade-Cache ihn hat; openServerCase legte den Eintrag dann ohne
     fileNumber an, und preloadAllCasesIntoCache überspringt jeden bereits gecachten Fall -
     das Aktenzeichen wurde nie nachgetragen. Beide Enden werden hier ausgeführt geprüft. */

  // 1) Der Wechsler selbst: Aktenzeichen notfalls aus den Falldaten.
  const rumpf = schnitt('list=cache?[...cache.entries()].map(([id,e])=>{', '}):[];') + '}):[];';
  const cache = new Map([
    // wie vorgeladen (Aktenzeichen aus der Fallliste)
    ['a', { label: 'Auerbach, Margarete', fileNumber: '7 XVII 214/19', data: { stammdaten: { care: { fileNumber: '7 XVII 214/19' } } } }],
    // der beim Login sofort geöffnete Fall: KEIN fileNumber im Cache-Eintrag
    ['k', { label: 'Kilic, Emre', data: { stammdaten: { person: { lastName: 'Kilic' }, care: { fileNumber: '4 XVII 88/22' } } } }],
    // Vorführung: dort trägt der Eintrag state.caseData statt stammdaten
    ['n', { label: 'Nowak, Halina', fileNumber: '', data: { caseData: { person: { lastName: 'Nowak' }, care: { fileNumber: '2 XVII 431/23' } } } }],
    // Aktenzeichen steckt schon im Label - nicht doppeln
    ['r', { label: 'Rothenberg, Dieter (12 XVII 305/21)', fileNumber: '12 XVII 305/21', data: {} }],
    // gar kein Aktenzeichen - keine leere Klammer
    ['w', { label: 'Weidmann, Jonas', fileNumber: '', data: { stammdaten: { care: {} } } }]
  ]);
  const ctx = { cache, list: null, String, Object, Array, Map };
  vm.createContext(ctx);
  new vm.Script(rumpf, { filename: 'fallwechsler.js' }).runInContext(ctx);
  const beschriftung = Object.fromEntries(ctx.list.map((e) => [e.id, e.label]));
  assert.strictEqual(beschriftung.k, 'Kilic, Emre (4 XVII 88/22)',
    'Der geöffnete Fall steht wieder ohne Aktenzeichen im Wechsler');
  assert.strictEqual(beschriftung.n, 'Nowak, Halina (2 XVII 431/23)',
    'In der Vorführung (state.caseData) fehlt das Aktenzeichen');
  assert.strictEqual(beschriftung.a, 'Auerbach, Margarete (7 XVII 214/19)');
  assert.strictEqual(beschriftung.r, 'Rothenberg, Dieter (12 XVII 305/21)',
    'Das Aktenzeichen wird verdoppelt, wenn es schon im Label steht');
  assert.strictEqual(beschriftung.w, 'Weidmann, Jonas',
    'Ohne Aktenzeichen darf keine leere Klammer entstehen');

  // 2) Die Ursache: der Cache-Eintrag beim Öffnen trägt das Aktenzeichen jetzt mit.
  const bau = schnitt("let azNeu=String((cached&&cached.fileNumber)||'').trim();", ',accDropped:false};') + ',accDropped:false};';
  const ctx2 = {
    cached: null, label: 'Kilic, Emre', caseId: 'de300002',
    serverCases: [{ id: 'de300002', label: 'Kilic, Emre', fileNumber: '4 XVII 88/22' }],
    data: { stammdaten: { care: { fileNumber: '4 XVII 88/22' } } },
    Date, String, Object, Array
  };
  vm.createContext(ctx2);
  new vm.Script(bau, { filename: 'cache-eintrag.js' }).runInContext(ctx2);
  assert.strictEqual(ctx2.cached.fileNumber, '4 XVII 88/22',
    'Der Cache-Eintrag des geöffneten Falls entsteht wieder ohne Aktenzeichen');
  // Auch ohne Fallliste (Cache-Aufbau läuft noch): aus den Stammdaten.
  const ctx3 = { ...ctx2, cached: null, serverCases: [] };
  vm.createContext(ctx3);
  new vm.Script(bau, { filename: 'cache-eintrag-2.js' }).runInContext(ctx3);
  assert.strictEqual(ctx3.cached.fileNumber, '4 XVII 88/22',
    'Ohne geladene Fallliste bleibt das Aktenzeichen liegen');
});
