'use strict';

/* Pruefstand fuer die vier DSGVO-Nachweise vom 25.08.2026:
     - Verzeichnis von Verarbeitungstaetigkeiten (Art. 30)
     - TOM-Dokumentation (Art. 32)
     - Auskunftsersuchen betroffener Personen (Art. 15, Frist Art. 12 Abs. 3)
     - Datenpannen (Art. 33, 72-Stunden-Frist)

   Leitgedanke dieses Pruefstands: Rechte und Fristen werden AUSGEFUEHRT, nicht gegrept.
   Ein grep beweist nur, dass eine Zeichenfolge existiert - nicht, dass ein Nutzer mit dem
   falschen Recht tatsaechlich abgewiesen wird und einer mit dem richtigen durchkommt. Deshalb
   laeuft die Rechte-Matrix gegen einen echten Express-Router mit Wegwerf-Datenbank, und der
   Oberflaechenteil wird zeilengenau aus der Auslieferungsdatei geschnitten und in einem
   vm-Kontext ausgefuehrt. Was hier gruen ist, ist am ausgelieferten Code gemessen. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');
const lies = (...teile) => fs.readFileSync(path.join(__dirname, '..', ...teile), 'utf8');

/* ═══════════════════ Der Datenschutz-Code aus der Auslieferungsdatei ═══════════════════
   Es wird bewusst NICHT nachgebaut, sondern aus der HTML-Datei ausgeschnitten. Ein Nachbau
   wuerde beweisen, dass der Nachbau stimmt; hier soll die Auslieferung stimmen. Die Anker
   sind Kommentar-/Funktionsanfaenge statt Zeilennummern, damit spaetere Einschuebe den
   Pruefstand nicht verschieben. */

function schnipsel(von, bis) {
  const a = html.indexOf(von);
  assert.ok(a >= 0, `Anker fehlt in der Auslieferungsdatei: ${von}`);
  const b = html.indexOf(bis, a);
  assert.ok(b > a, `Endanker fehlt hinter "${von}": ${bis}`);
  /* Doppelte Anker wuerden den falschen Ausschnitt liefern - lieber laut scheitern. */
  assert.equal(html.indexOf(von, a + 1), -1, `Anker ist nicht eindeutig: ${von}`);
  return html.slice(a, b);
}

/* Drei zusammenhaengende Bereiche des Datenschutz-Bausteins:
     1. Vorlagen (VVT/TOM), Saeuberung und die Erstbefuellung,
     2. die Fristenrechnung,
     3. der an-/abschaltbare Kalendereintrag. */
const DS_QUELLE = [
  schnipsel('const VVT_VORLAGE=[', 'function dsLokal()'),
  schnipsel('function dsHeute(){', '/* ── Kalendereintrag je Frist'),
  schnipsel('async function dsTerminAnlegen(bereich,e){', '/* ── Zugriff auf einzelne Eintraege'),
  /* const/function bleiben im vm-Kontext sonst unsichtbar - hier eingesammelt. */
  'globalThis.__ds={VVT_VORLAGE,TOM_VORLAGE,DS_TOM_GRUPPEN,dsLeer,dsSaeubern,dsIstJungfraeulich,'
  + 'dsVorlagenEinsetzen,dsFristAuskunft,dsFristPanne,dsTagPlus,dsStundePlus,dsStundenBis,'
  + 'dsTageBis,dsTerminAnlegen,dsTerminWeg};'
].join('\n');

/* Listen aus dem vm-Kontext tragen dessen eigenen Array-Prototyp; deepStrictEqual vergleicht
   den mit. Array.from baut die Liste in DIESEM Kontext neu auf, damit verglichen wird, was
   drinsteht - und nicht, aus welchem Realm sie stammt. */
const kennungen = (liste) => Array.from(liste, (e) => e.id);

/* Frischer Kontext je Test: die Kalender-Attrappe soll nicht zwischen Tests durchschlagen. */
function dsKontext() {
  const kalender = { angelegt: [], geloescht: [], hinweise: [] };
  const ctx = {
    window: {
      __calCreateItem: async (ev) => { kalender.angelegt.push(ev); return { id: 'kal-' + kalender.angelegt.length }; },
      __calRemoveItem: async (id) => { kalender.geloescht.push(id); }
    },
    esc: (s) => String(s),
    toast: (t) => { kalender.hinweise.push(String(t)); }
  };
  vm.createContext(ctx);
  vm.runInContext(DS_QUELLE, ctx, { filename: 'datenschutz-baustein.js' });
  return { ds: ctx.__ds, kalender, ctx };
}

/* ═══════════════════════════ 1. Serverseitige Rechte ═══════════════════════════
   Wegwerf-Datenbank im Temp-Verzeichnis; DB_PATH muss VOR dem ersten require der
   Datenbank stehen, deshalb hier auf Modulebene. */
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'datenschutz-test-'));
process.env.DB_PATH = path.join(TEMP, 'datenschutz.sqlite3');

let server = null;
let sitzung = {};

function serverStarten() {
  if (server) return server;
  const express = require('express');
  /* Die Datenbank meldet beim ersten Oeffnen das fehlende Admin-Konto - im Pruefstand Rauschen. */
  const alterLog = console.log;
  let db;
  try {
    console.log = (...args) => {
      if (!String(args[0] || '').startsWith('[Fallrechte]')) alterLog(...args);
    };
    db = require('../src/database/index');
  } finally { console.log = alterLog; }
  db.prepare(`INSERT INTO users (id,username,password_hash,display_name,allow_local,allow_online,is_admin)
    VALUES (1,'pruefstand','x','Pruefstand',1,1,0)`).run();

  const app = express();
  app.use(express.json());
  /* Die Sitzung wird je Prueffall gesetzt - genau das ist der Gegenstand der Messung. */
  app.use((req, _res, next) => { req.session = Object.assign({ userId: 1, mode: 'online' }, sitzung); next(); });
  app.use('/api/office-json', require('../src/modules/office/json-routes'));
  server = app.listen(0);
  return server;
}

function ruf(methode, pfad, koerper) {
  const port = serverStarten().address().port;
  const daten = koerper === undefined ? null : JSON.stringify(koerper);
  return new Promise((auf, ab) => {
    const anfrage = http.request({
      port, method: methode, path: pfad,
      headers: daten ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(daten) } : {}
    }, (antwort) => {
      let text = '';
      antwort.on('data', (c) => { text += c; });
      antwort.on('end', () => auf({ status: antwort.statusCode, text }));
    });
    anfrage.on('error', ab);
    if (daten) anfrage.write(daten);
    anfrage.end();
  });
}

/* Alle Schluessel der Whitelist, aus der Quelle gelesen statt abgeschrieben - so faellt ein
   kuenftig ergaenzter Schluessel diesem Pruefstand automatisch in die Haende. */
function whitelistSchluessel() {
  const quelle = lies('src', 'modules', 'office', 'json-routes.js');
  const treffer = /const KEYS = new Set\(\[([^\]]*)\]\)/.exec(quelle);
  assert.ok(treffer, 'Die Schluessel-Whitelist (KEYS) wurde nicht gefunden.');
  return treffer[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

test.after(() => {
  if (server) server.close();
  fs.rmSync(TEMP, { recursive: true, force: true });
});

test('Ablage: datenschutz steht in der Whitelist und hat eigene Schranken', () => {
  const quelle = lies('src', 'modules', 'office', 'json-routes.js');
  assert.match(quelle, /const KEYS = new Set\(\[[^\]]*'datenschutz'/, 'Whitelist-Eintrag fehlt - PUT liefe ins Leere');
  assert.ok(whitelistSchluessel().includes('datenschutz'), 'datenschutz nicht in der ausgelesenen Whitelist');
  assert.ok(quelle.includes('LESE_SCHRANKEN'), 'Lese-Schranken-Tabelle fehlt');
  assert.ok(quelle.includes('SCHREIB_SCHRANKEN'), 'Schreib-Schranken-Tabelle fehlt');
  /* Map statt Objekt: '__proto__' als Schluesselname darf keine Regel vortaeuschen. */
  assert.match(quelle, /const LESE_SCHRANKEN = new Map\(/, 'LESE_SCHRANKEN ist keine Map');
  assert.match(quelle, /const SCHREIB_SCHRANKEN = new Map\(/, 'SCHREIB_SCHRANKEN ist keine Map');
});

test('Rechte (ausgefuehrt): Schreiben verlangt isAdmin || canManageOfficeProfile', async () => {
  const nutzlast = { data: { vvt: [], tom: [], auskuenfte: [], pannen: [] } };
  const faelle = [
    ['Admin', { isAdmin: true }, 200],
    ['Buerostammdaten verwalten', { canManageOfficeProfile: 1 }, 200],
    /* canViewAuditLog darf LESEN, aber ausdruecklich nicht schreiben. */
    ['nur Audit-Log einsehen', { canViewAuditLog: 1 }, 403],
    ['nur Fallrechte', { canViewCases: 1, canEditCases: 1 }, 403],
    ['ohne alles', {}, 403]
  ];
  for (const [name, s, erwartet] of faelle) {
    sitzung = s;
    const a = await ruf('PUT', '/api/office-json/datenschutz', nutzlast);
    assert.equal(a.status, erwartet, `PUT datenschutz als "${name}" ergab ${a.status} statt ${erwartet}`);
  }
  /* Gegenprobe, dass 200 nicht bloss ein durchgewinktes 200 ohne Wirkung ist. */
  sitzung = { canManageOfficeProfile: 1, canViewAuditLog: 1 };
  await ruf('PUT', '/api/office-json/datenschutz', { data: { vvt: [{ id: 'probe' }], tom: [], auskuenfte: [], pannen: [] } });
  const gelesen = await ruf('GET', '/api/office-json/datenschutz');
  assert.equal(gelesen.status, 200);
  assert.equal(JSON.parse(gelesen.text).data.vvt[0].id, 'probe', 'Geschriebenes kam nicht zurueck');
});

test('Rechte (ausgefuehrt): die Lese-Schranke greift nur fuer die eigens geschuetzten Schluessel', async () => {
  /* Der Kern der Nutzerentscheidung: Fall-Sichtrecht schliesst die Datenschutz-Nachweise
     NICHT auf (dort stehen Klarnamen betroffener Personen), aendert aber an keinem anderen
     Schluessel etwas. */
  sitzung = { canViewCases: 1, canEditCases: 1 };
  const ds = await ruf('GET', '/api/office-json/datenschutz');
  assert.equal(ds.status, 403, 'Fall-Sichtrecht oeffnet die Datenschutz-Nachweise');
  assert.match(JSON.parse(ds.text).error, /Datenschutz-Nachweise einzusehen/, 'unpassende Fehlermeldung');

  const vertretung = await ruf('GET', '/api/office-json/vertretungsplan');
  assert.equal(vertretung.status, 200, 'Der Vertretungsplan ist fuer Fall-Sichtrecht nicht mehr lesbar');

  /* Vollstaendig statt stichprobenartig: JEDER Bestandsschluessel muss sich fuer diese
     Sitzung genauso verhalten wie vor dem Umbau. Ausnahmen sind nur der neue Schluessel und
     der Aussendienst, der seit jeher ein eigenes Recht verlangt (checkKeyPermission). */
  /* 28.08.2026 kam 'mail_signaturen_abgeloest' dazu: die einmalige Merkzeile mit den
     abgeloesten Konto-Signaturen enthaelt Klartext aus fremden Postfaechern und ist deshalb
     ebenfalls nur fuer Verwaltende lesbar - dieselbe Begruendung wie bei 'datenschutz'. */
  const ausnahmen = new Set(['datenschutz', 'aussendienst_ledger', 'mail_signaturen_abgeloest']);
  for (const key of whitelistSchluessel()) {
    const a = await ruf('GET', '/api/office-json/' + key);
    const erwartet = ausnahmen.has(key) ? 403 : 200;
    assert.equal(a.status, erwartet, `GET ${key} mit Fall-Sichtrecht ergab ${a.status} statt ${erwartet}`);
  }

  /* Und die Gegenrichtung: wer NUR das Audit-Log sehen darf (die typische Rolle der/des
     Datenschutzbeauftragten), kommt an datenschutz - aber an nichts sonst. */
  sitzung = { canViewAuditLog: 1 };
  assert.equal((await ruf('GET', '/api/office-json/datenschutz')).status, 200,
    'Audit-Log-Recht oeffnet die Datenschutz-Nachweise nicht');
  assert.equal((await ruf('GET', '/api/office-json/vertretungsplan')).status, 403,
    'Audit-Log-Recht oeffnet ploetzlich fremde Schluessel');
  assert.equal((await ruf('GET', '/api/office-json/ui_prefs')).status, 403,
    'Audit-Log-Recht oeffnet ploetzlich fremde Schluessel');
  /* Die Signatur-Merkzeile haengt an der MAIL-Verwaltung, nicht an der Datenschutzrolle. */
  assert.equal((await ruf('GET', '/api/office-json/mail_signaturen_abgeloest')).status, 403,
    'Audit-Log-Recht oeffnet die abgeloesten Konto-Signaturen');
  sitzung = { canManageMailSettings: 1 };
  assert.equal((await ruf('GET', '/api/office-json/mail_signaturen_abgeloest')).status, 200,
    'Mail-Verwaltung kommt nicht an die abgeloesten Konto-Signaturen');
});

test('Rechte (ausgefuehrt): unbekannte Schluessel verraten sich nicht', async () => {
  /* Reihenfolge erst Recht, dann Whitelist: ohne Recht gibt es 403, nicht 404 - sonst liesse
     sich die Schluesselliste durch Ausprobieren abfragen. */
  sitzung = {};
  assert.equal((await ruf('GET', '/api/office-json/gibtesnicht')).status, 403);
  sitzung = { canViewCases: 1 };
  assert.equal((await ruf('GET', '/api/office-json/gibtesnicht')).status, 404);
  /* Ein Schluesselname aus der Prototypenkette darf keine Regel finden. */
  sitzung = { canViewCases: 1 };
  assert.equal((await ruf('GET', '/api/office-json/__proto__')).status, 404);
  assert.equal((await ruf('GET', '/api/office-json/constructor')).status, 404);
});

/* ═══════════════════════ 2. Fachlicher Startbestand (Vorlagen) ═══════════════════════ */

/* Stabile Kennungen: Sie sind der Vertrag zwischen Programmfassungen. Aendert sich eine,
   erkennt eine spaetere Fassung den Eintrag nicht wieder und legt ihn doppelt an oder
   ueberschreibt die Aenderungen des Bueros. Deshalb stehen sie hier woertlich. */
const VVT_IDS = ['vvt_betreuungsfuehrung', 'vvt_vermoegenssorge', 'vvt_verguetung', 'vvt_post',
  'vvt_personal', 'vvt_it', 'vvt_ki'];
const TOM_IDS = ['tom_zutritt', 'tom_zugang', 'tom_zugriff', 'tom_trennung', 'tom_pseudo',
  'tom_weitergabe', 'tom_eingabe', 'tom_auftrag', 'tom_verfuegbar', 'tom_belastbar',
  'tom_ueberpruefung', 'tom_schulung'];
/* Diese vier kann nur das Buero beantworten (Raeume, Vertraege, Turnus, Schulungen). Eine
   vorausgefuellte Behauptung ueber fremde Raeume waere schlimmer als eine offene Zeile. */
const TOM_OHNE_PROGRAMM = ['tom_zutritt', 'tom_auftrag', 'tom_ueberpruefung', 'tom_schulung'];

test('Vorlage: alle sieben Verarbeitungstaetigkeiten mit stabilen Kennungen', () => {
  const { ds } = dsKontext();
  assert.equal(ds.VVT_VORLAGE.length, 7, 'Anzahl der Verarbeitungstaetigkeiten weicht ab');
  assert.deepEqual(kennungen(ds.VVT_VORLAGE), VVT_IDS, 'Kennungen oder Reihenfolge weichen ab');

  /* Art. 30 Abs. 1 verlangt je Taetigkeit einen festen Satz Angaben - keine darf leer sein,
     sonst ist das Verzeichnis als Nachweis wertlos. */
  const PFLICHT = ['name', 'zweck', 'rechtsgrundlage', 'betroffene', 'daten', 'empfaenger', 'drittland', 'frist', 'tom'];
  for (const e of ds.VVT_VORLAGE) {
    for (const feld of PFLICHT) {
      assert.ok(typeof e[feld] === 'string' && e[feld].trim().length > 0,
        `Pflichtangabe "${feld}" fehlt bei ${e.id}`);
    }
    assert.equal(e.vomProgramm, true, `${e.id} ist nicht als Programmvorschlag gekennzeichnet`);
  }
  /* Der KI-Eintrag darf kein beruhigendes "nein" behaupten: ob ein Drittlandtransfer
     stattfindet, haengt am tatsaechlich eingesetzten Anbieter. */
  const ki = ds.VVT_VORLAGE.find((e) => e.id === 'vvt_ki');
  assert.match(ki.drittland, /PRÜFEN/, 'Der KI-Eintrag behauptet einen Drittlandstatus, den er nicht kennt');
  assert.equal(ki.warnung, true, 'Der KI-Eintrag ist nicht als pruefbeduerftig markiert');
  assert.ok(ds.VVT_VORLAGE.filter((e) => e.id !== 'vvt_ki').every((e) => e.drittland === 'nein'),
    'Ein Eintrag ohne Drittlandbezug traegt keine klare Angabe');
});

test('Vorlage: alle zwoelf TOM-Punkte mit stabilen Kennungen und gueltigen Gruppen', () => {
  const { ds } = dsKontext();
  assert.equal(ds.TOM_VORLAGE.length, 12, 'Anzahl der TOM-Punkte weicht ab');
  assert.deepEqual(kennungen(ds.TOM_VORLAGE), TOM_IDS, 'Kennungen oder Reihenfolge weichen ab');
  for (const e of ds.TOM_VORLAGE) {
    assert.ok(e.name && e.name.trim(), `${e.id} ohne Namen`);
    /* Die Frage ist der eigentliche Nutzen der leeren Zeilen: sie sagt dem Buero, was zu
       beantworten ist. Ohne Frage ist eine leere Zeile nur eine leere Zeile. */
    assert.ok(e.frage && e.frage.trim(), `${e.id} ohne Leitfrage`);
    assert.ok(ds.DS_TOM_GRUPPEN.includes(e.gruppe),
      `${e.id} hat die unbekannte Gruppe "${e.gruppe}" - die Saeuberung wuerde sie verwerfen`);
  }
});

test('Vorlage: TOM-Punkte ohne Programmbezug starten ohne Beschreibung und ohne Status', () => {
  const { ds } = dsKontext();
  const offen = kennungen(Array.from(ds.TOM_VORLAGE).filter((e) => e.vomProgramm === false));
  assert.deepEqual(offen, TOM_OHNE_PROGRAMM, 'Die Aufteilung "vom Programm" / "vom Buero" weicht ab');
  for (const e of ds.TOM_VORLAGE) {
    if (e.vomProgramm) {
      /* Gegenprobe: sonst waere der Test auch dann gruen, wenn ALLES leer bliebe. */
      assert.ok(e.beschreibung && e.beschreibung.trim().length > 20,
        `${e.id} ist als "vom Programm" gekennzeichnet, sagt aber nichts aus`);
    } else {
      assert.equal(e.beschreibung, '', `${e.id} behauptet etwas ueber das Buero, das das Programm nicht wissen kann`);
      assert.ok(!e.stand, `${e.id} startet mit einem Status, den niemand bewertet hat`);
    }
  }
  /* Auch nach der Saeuberung (so landet es im Speicher) darf kein Status entstehen. */
  const eingesetzt = ds.dsVorlagenEinsetzen(ds.dsLeer());
  for (const id of TOM_OHNE_PROGRAMM) {
    const e = eingesetzt.tom.find((x) => x.id === id);
    assert.ok(e, `${id} ist nach der Erstbefuellung verschwunden`);
    assert.equal(e.beschreibung, '', `${id} wurde bei der Saeuberung befuellt`);
    assert.equal(e.stand, '', `${id} bekam bei der Saeuberung einen Status`);
  }
});

test('Vorlage: die Saeuberung laesst die stabilen Kennungen unangetastet', () => {
  /* dsKennung schneidet Sonderzeichen weg (die Kennungen landen in onclick-Attributen).
     Wuerde eine Vorlagen-Kennung dabei veraendert, waere die Wiedererkennung dahin. */
  const { ds } = dsKontext();
  const eingesetzt = ds.dsVorlagenEinsetzen(ds.dsLeer());
  assert.deepEqual(kennungen(eingesetzt.vvt), VVT_IDS);
  assert.deepEqual(kennungen(eingesetzt.tom), TOM_IDS);
});

/* ═══════════════════════ 3. Erstbefuellung greift genau einmal ═══════════════════════ */

test('Erstbefuellung (ausgefuehrt): leer -> Vorlage, danach nie wieder', () => {
  const { ds } = dsKontext();
  /* Genau die Logik der Aufrufstelle in renderDatenschutzTab, damit der Test das echte
     Zusammenspiel misst und nicht nur die Einzelfunktionen. */
  const oeffnen = (stand) => (ds.dsIstJungfraeulich(stand) ? ds.dsVorlagenEinsetzen(stand) : stand);

  const leer = ds.dsLeer();
  assert.equal(ds.dsIstJungfraeulich(leer), true, 'Ein leerer Datensatz gilt nicht als jungfraeulich');
  const ersteOeffnung = oeffnen(leer);
  assert.equal(ersteOeffnung.vvt.length, 7, 'Die Vorlage wurde beim ersten Oeffnen nicht eingesetzt');
  assert.equal(ersteOeffnung.tom.length, 12, 'Die TOM-Vorlage wurde beim ersten Oeffnen nicht eingesetzt');

  /* Das Buero loescht eine Vorlagenzeile: sie bleibt als entfernt:true stehen (Papierkorb). */
  const nachLoeschen = JSON.parse(JSON.stringify(ersteOeffnung));
  nachLoeschen.vvt.find((e) => e.id === 'vvt_ki').entfernt = true;
  const gespeichert = ds.dsSaeubern(nachLoeschen);
  assert.equal(gespeichert.vvt.find((e) => e.id === 'vvt_ki').entfernt, true,
    'entfernt:true ueberlebt die Saeuberung nicht');

  assert.equal(ds.dsIstJungfraeulich(gespeichert), false, 'Ein befuellter Datensatz gilt als jungfraeulich');
  const zweiteOeffnung = oeffnen(gespeichert);
  const wieder = zweiteOeffnung.vvt.find((e) => e.id === 'vvt_ki');
  assert.equal(wieder.entfernt, true, 'Die geloeschte Vorlagenzeile kam beim zweiten Oeffnen zurueck');
  assert.equal(zweiteOeffnung.vvt.filter((e) => e.id === 'vvt_ki').length, 1,
    'Die Vorlagenzeile wurde ein zweites Mal angelegt');
  /* Auch eine geaenderte Zeile darf nicht ueberschrieben werden. */
  const dritte = JSON.parse(JSON.stringify(zweiteOeffnung));
  dritte.vvt.find((e) => e.id === 'vvt_post').zweck = 'Vom Büro selbst formuliert.';
  const nachDritter = oeffnen(ds.dsSaeubern(dritte));
  assert.equal(nachDritter.vvt.find((e) => e.id === 'vvt_post').zweck, 'Vom Büro selbst formuliert.',
    'Eine vom Buero geaenderte Zeile wurde von der Vorlage ueberschrieben');
});

test('Erstbefuellung (ausgefuehrt): auch ein leergeraeumtes Verzeichnis bleibt leer', () => {
  const { ds } = dsKontext();
  /* Grenzfall mit echtem Schadenspotenzial: Das Buero haelt alle sieben Taetigkeiten fuer
     unpassend und entfernt sie. Die Zeilen bleiben als entfernt:true stehen - der Datensatz
     ist also nicht leer und darf NICHT neu befuellt werden. */
  const alles = ds.dsVorlagenEinsetzen(ds.dsLeer());
  alles.vvt.forEach((e) => { e.entfernt = true; });
  alles.tom.forEach((e) => { e.entfernt = true; });
  const gespeichert = ds.dsSaeubern(alles);
  assert.equal(ds.dsIstJungfraeulich(gespeichert), false,
    'Ein vollstaendig leergeraeumtes Verzeichnis wuerde beim naechsten Oeffnen wieder aufgefuellt');
  assert.ok(gespeichert.vvt.every((e) => e.entfernt), 'Der Papierkorb hat Zeilen verloren');

  /* Umgekehrt: ein Datensatz, in dem NUR eine Datenpanne oder ein Auskunftsersuchen steht,
     hat mit Verzeichnis und TOM nichts zu tun. Wer zuerst eine Panne erfasst und danach das
     Verzeichnis oeffnet, bekaeme den fachlichen Startbestand sonst NIE - und stuende vor einem
     leeren Art.-30-Verzeichnis, ohne Weg zurueck. Deshalb prueft die Schranke nur die beiden
     Listen, die ueberhaupt vorbefuellt werden. */
  const nurPanne = ds.dsSaeubern({ pannen: [{ id: 'panne-1', entdeckt: '2026-08-25T09:00' }] });
  assert.equal(ds.dsIstJungfraeulich(nurPanne), true,
    'Eine Datenpanne sperrt weiterhin die Erstbefuellung von Verzeichnis und TOM');
  const nachOeffnen = ds.dsVorlagenEinsetzen(nurPanne);
  assert.equal(nachOeffnen.vvt.length, 7, 'Das Verzeichnis blieb leer');
  assert.equal(nachOeffnen.tom.length, 12, 'Die TOM-Liste blieb leer');
  assert.equal(nachOeffnen.pannen.length, 1, 'Die bereits erfasste Datenpanne ging verloren');

  const nurAuskunft = ds.dsSaeubern({ auskuenfte: [{ id: 'ausk-1', eingang: '2026-08-25' }] });
  assert.equal(ds.dsIstJungfraeulich(nurAuskunft), true);

  /* Steht dagegen auch nur EINE Zeile im Verzeichnis oder in den TOM, wird nicht mehr
     vorbefuellt - auch dann nicht, wenn es die einzige ist. */
  const eineVvtZeile = ds.dsSaeubern({ vvt: [{ id: 'vvt_eigen', name: 'Eigene Taetigkeit' }] });
  assert.equal(ds.dsIstJungfraeulich(eineVvtZeile), false);
  const eineTomZeile = ds.dsSaeubern({ tom: [{ id: 'tom_eigen', name: 'Eigene Massnahme' }] });
  assert.equal(ds.dsIstJungfraeulich(eineTomZeile), false);
});

/* ═══════════════════════════════ 4. Fristen ═══════════════════════════════ */

test('Frist Auskunftsersuchen: ein Monat ab Eingang (Art. 12 Abs. 3 DSGVO)', () => {
  const { ds } = dsKontext();
  const f = ds.dsFristAuskunft;
  assert.equal(f('2026-08-25'), '2026-09-25', 'Regelfall: derselbe Tag im Folgemonat');
  assert.equal(f('2026-08-01'), '2026-09-01');

  /* Monatsende: gibt es den Tag im Folgemonat nicht, endet die Frist am letzten Tag des
     Folgemonats (Art. 3 Abs. 2 lit. c der Fristenverordnung 1182/71). Ein naiver
     "Monat + 1" liefe hier auf den 03.03. ueber - eine um Tage zu lange Frist. */
  assert.equal(f('2026-01-31'), '2026-02-28', 'Monatsende laeuft ins naechste Monat ueber');
  assert.equal(f('2026-01-30'), '2026-02-28');
  assert.equal(f('2026-01-29'), '2026-02-28');
  assert.equal(f('2026-03-31'), '2026-04-30', '31. in einen 30-Tage-Monat');
  assert.equal(f('2026-05-31'), '2026-06-30');

  /* Schaltjahr: 2028 hat einen 29. Februar, 2027 nicht. */
  assert.equal(f('2028-01-31'), '2028-02-29', 'Schaltjahr wird nicht erkannt');
  assert.equal(f('2028-01-29'), '2028-02-29');
  assert.equal(f('2027-01-31'), '2027-02-28');
  assert.equal(f('2028-02-29'), '2028-03-29', 'Eingang am Schalttag');

  /* Jahreswechsel */
  assert.equal(f('2026-12-15'), '2027-01-15');
  assert.equal(f('2026-12-31'), '2027-01-31');
  assert.equal(f('2026-11-30'), '2026-12-30');

  /* Unbrauchbare Eingaben liefern keine Frist - dann darf auch kein Termin entstehen. */
  assert.equal(f(''), '', 'Leerer Eingang liefert eine Frist');
  assert.equal(f('25.08.2026'), '', 'Deutsches Datum wird stillschweigend fehlgedeutet');
  assert.equal(f(null), '');
  /* dsIso prueft seit 25.08.2026 die GUELTIGKEIT und nicht nur die Form: ein unmoeglicher Monat
     oder Tag lief frueher in Date.UTC ueber und erzeugte aus "2026-13-01" die Frist
     "2027-02-01". Aus der Oberflaeche ist das nicht erreichbar (input type="date"), aus einem
     Import oder einer von Hand bearbeiteten Sicherung sehr wohl - und eine erfundene Frist ist
     schlimmer als gar keine, weil daraus ein Kalendertermin und eine Ampel entstehen. */
  assert.equal(f('2026-13-01'), '', 'Unmoeglicher Monat liefert weiterhin eine Frist');
  assert.equal(f('2026-00-10'), '', 'Monat 0 liefert eine Frist');
  assert.equal(f('2026-02-30'), '', '30. Februar liefert eine Frist');
  assert.equal(f('2027-02-29'), '', '29.02. in einem Nicht-Schaltjahr liefert eine Frist');
  assert.equal(f('2026-04-31'), '', '31. in einem 30-Tage-Monat liefert eine Frist');
  assert.equal(f('2026-01-00'), '', 'Tag 0 liefert eine Frist');
  /* Und die gueltigen Grenzwerte bleiben gueltig. */
  assert.equal(f('2028-02-29'), '2028-03-29');
  assert.equal(f('2026-12-31'), '2027-01-31');
});

test('dsIso: nur ein wirklich existierendes Datum wird gespeichert (ausgefuehrt)', () => {
  const { ds } = dsKontext();
  /* Die Saeuberung ist der einzige Weg in den Speicher - was hier durchrutscht, steht spaeter
     in Verzeichnis, Auskunftsregister und Ausdruck. */
  const gereinigt = ds.dsSaeubern({
    verantwortlicher: { stand: '2026-13-01' },
    auskuenfte: [
      { id: 'ausk-1', eingang: '2026-02-30', frist: '2026-09-25', erledigtAm: '2026-08-25' },
      { id: 'ausk-2', eingang: '2026-08-25' },
    ],
  });
  assert.equal(gereinigt.verantwortlicher.stand, '', 'unmoeglicher Stand wurde gespeichert');
  assert.equal(gereinigt.auskuenfte[0].eingang, '', 'unmoeglicher Eingang wurde gespeichert');
  assert.equal(gereinigt.auskuenfte[0].frist, '2026-09-25', 'eine gueltige Frist ging verloren');
  assert.equal(gereinigt.auskuenfte[0].erledigtAm, '2026-08-25');
  assert.equal(gereinigt.auskuenfte[1].eingang, '2026-08-25', 'ein gueltiger Eingang ging verloren');
});

test('Frist Datenpanne: 72 Stunden ab Entdeckung, in Stunden gerechnet (Art. 33 Abs. 1)', () => {
  const { ds } = dsKontext();
  const f = ds.dsFristPanne;
  assert.equal(f('2026-08-25T14:30'), '2026-08-28T14:30', 'Regelfall: exakt drei Tage spaeter zur selben Uhrzeit');
  assert.equal(f('2026-08-25T00:00'), '2026-08-28T00:00');

  /* Monatsende, Jahreswechsel und Schaltjahr */
  assert.equal(f('2026-08-30T23:00'), '2026-09-02T23:00', 'Monatsende');
  assert.equal(f('2026-12-30T23:00'), '2027-01-02T23:00', 'Jahreswechsel');
  assert.equal(f('2028-02-27T12:00'), '2028-03-01T12:00', 'Schaltjahr: 27.02. + 72 h = 01.03.');
  assert.equal(f('2027-02-26T12:00'), '2027-03-01T12:00', 'kein Schaltjahr: 26.02. + 72 h = 01.03.');

  /* Der eigentliche Vertrag: EXAKT 72 Stunden Echtzeit, nicht "drei Kalendertage". Die
     Differenz wird in Millisekunden gemessen und ist damit unabhaengig von der Zeitzone
     des Pruefrechners - auch ueber eine Sommerzeit-Umstellung hinweg, bei der sich die
     angezeigte Uhrzeit verschieben DARF, die Frist aber nicht. */
  const genau72 = 72 * 3600 * 1000;
  for (const start of ['2026-08-25T14:30', '2026-03-27T02:30', '2026-10-23T12:00', '2027-11-03T08:15']) {
    const abstand = new Date(f(start)).getTime() - new Date(start).getTime();
    assert.equal(abstand, genau72, `Frist ab ${start} ist nicht exakt 72 Stunden lang (${abstand / 3600000} h)`);
  }

  /* Der Unterschied zwischen "72 Stunden" und "drei Kalendertagen" wird erst an einer
     Sommerzeit-Umstellung sichtbar: dort verschiebt sich die UHRZEIT, weil der Tag 23 oder 25
     Stunden hat. Ein "+3 Tage" haette hier dieselbe Uhrzeit und waere um eine Stunde falsch -
     bei einer Meldefrist an die Aufsichtsbehoerde keine Kleinigkeit. Damit der Beweis nicht
     von der Zone des Pruefrechners abhaengt, wird sie dafuer kurz festgenagelt. */
  const alteZone = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Berlin';
    const { ds: dsBerlin } = dsKontext();   // frischer Kontext, damit die Zone greift
    /* Ende der Sommerzeit am 29.03.2026 (02:00 -> 03:00): der Tag hat 23 Stunden. */
    assert.equal(dsBerlin.dsFristPanne('2026-03-27T12:00'), '2026-03-30T13:00',
      'Die Frist rechnet in Kalendertagen statt in Stunden (Beginn der Sommerzeit)');
    /* Ende der Sommerzeit am 25.10.2026 (03:00 -> 02:00): der Tag hat 25 Stunden. */
    assert.equal(dsBerlin.dsFristPanne('2026-10-23T12:00'), '2026-10-26T11:00',
      'Die Frist rechnet in Kalendertagen statt in Stunden (Ende der Sommerzeit)');
  } finally {
    if (alteZone === undefined) delete process.env.TZ; else process.env.TZ = alteZone;
  }

  /* Sekundengenaue Eingaben werden auf Minuten gekuerzt, Unbrauchbares liefert nichts. */
  assert.equal(f('2026-08-25T14:30:59'), '2026-08-28T14:30');
  assert.equal(f(''), '', 'Leerer Entdeckungszeitpunkt liefert eine Frist');
  assert.equal(f('2026-08-25'), '', 'Datum ohne Uhrzeit liefert eine Frist - 72 h waeren nicht bestimmbar');
  assert.equal(f(null), '');
});

test('Fristanzeige: verbleibende Zeit und Ueberfaelligkeit werden gerechnet', () => {
  const { ds } = dsKontext();
  /* Tage: dsTageBis rechnet gegen den heutigen Tag - deshalb relativ gepruef, nicht absolut. */
  const heute = new Date();
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const inTagen = (n) => { const d = new Date(heute); d.setDate(d.getDate() + n); return iso(d); };
  assert.equal(ds.dsTageBis(inTagen(0)), 0, 'heute faellig');
  assert.equal(ds.dsTageBis(inTagen(30)), 30);
  assert.equal(ds.dsTageBis(inTagen(-5)), -5, 'Ueberfaelligkeit wird nicht negativ gezaehlt');

  /* Stunden: 5,5 h in der Zukunft muss abgerundet 5 ergeben, Vergangenes negativ sein. */
  const zeitIso = (ms) => {
    const d = new Date(ms), z = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T' + z(d.getHours()) + ':' + z(d.getMinutes());
  };
  assert.equal(ds.dsStundenBis(zeitIso(Date.now() + 5.5 * 3600000)), 5, 'Reststunden werden nicht abgerundet');
  assert.ok(ds.dsStundenBis(zeitIso(Date.now() - 2.5 * 3600000)) < 0, 'Ueberfaelligkeit wird nicht negativ gezaehlt');
  assert.equal(ds.dsStundenBis('unsinn'), null, 'Unbrauchbare Zeit liefert eine Stundenzahl');

  /* Ganztags-Konvention des Kalenders: Ende am Folgetag 00:00. */
  assert.equal(ds.dsTagPlus('2026-09-25', 1), '2026-09-26');
  assert.equal(ds.dsTagPlus('2026-09-30', 1), '2026-10-01', 'Monatsende');
  assert.equal(ds.dsTagPlus('2028-02-28', 1), '2028-02-29', 'Schaltjahr');
  assert.equal(ds.dsTagPlus('2026-12-31', 1), '2027-01-01', 'Jahreswechsel');
});

/* ═══════════════════ 5. Kalendereintrag: neutral und nur lokal ═══════════════════ */

/* Diese Termine haben KEINEN Fallbezug. Serverseitig gelten Termine ohne caseId als
   Bueroorganisation und sind damit fuer jeden Kalendernutzer lesbar. Was hier in Titel oder
   Beschreibung steht, sieht also das ganze Buero - deshalb weder Namen noch Vorfall. */
const NEUTRALE_TITEL = {
  auskuenfte: 'Frist: Auskunftsersuchen beantworten',
  pannen: 'Frist: Meldung einer Datenschutzverletzung'
};

test('Kalender (ausgefuehrt): Termin ist lokal und traegt weder Namen noch Vorfall', async () => {
  const { ds, kalender } = dsKontext();

  /* Markierungen, die im Termin auf keinen Fall auftauchen duerfen. */
  const auskunft = {
    id: 'ausk-1', eingang: '2026-08-25', betroffene: 'Frieda Fremdname',
    art: 'Auskunft', kanal: 'Brief', notiz: 'Anwaltskanzlei Mustermann', ergebnis: ''
  };
  const panne = {
    id: 'panne-1', entdeckt: '2026-08-25T09:00',
    beschreibung: 'USB-Stick mit Klientenakten im Zug liegen gelassen',
    betroffeneZahl: '14', risiko: 'hoch'
  };
  const verboten = ['Fremdname', 'Frieda', 'Mustermann', 'USB-Stick', 'Klientenakten', 'Zug liegen'];

  const a = await ds.dsTerminAnlegen('auskuenfte', auskunft);
  assert.equal(a.ok, true, a.text);
  assert.equal(a.terminId, 'kal-1', 'Die Termin-Kennung wird nicht zurueckgegeben - Abschalten waere unmoeglich');
  const p = await ds.dsTerminAnlegen('pannen', panne);
  assert.equal(p.ok, true, p.text);

  assert.equal(kalender.angelegt.length, 2);
  const [evA, evP] = kalender.angelegt;

  assert.equal(evA.title, NEUTRALE_TITEL.auskuenfte, 'Titel des Auskunftstermins ist nicht der neutrale');
  assert.equal(evP.title, NEUTRALE_TITEL.pannen, 'Titel des Pannentermins ist nicht der neutrale');

  for (const ev of kalender.angelegt) {
    /* connectionId:'local' verhindert die automatische Spiegelung zu Google/Microsoft/CalDAV.
       Ohne diese Zeile landete eine Datenschutzfrist ungefragt auf einem fremden Konto. */
    assert.equal(ev.connectionId, 'local', 'Der Termin wuerde zu einem externen Kalender gespiegelt');
    const alles = JSON.stringify(ev);
    for (const wort of verboten) {
      assert.ok(!alles.includes(wort), `Der Termin verraet "${wort}" - er ist bueroweit sichtbar`);
    }
    /* Auch kein freies Textfeld darf den Vorgang durchreichen. */
    assert.ok(!('location' in ev) || !ev.location, 'Der Termin traegt einen Ort');
  }

  /* Fristen im Termin: der Monat bzw. die 72 Stunden. */
  assert.equal(evA.startAt, '2026-09-25T00:00:00', 'Auskunftstermin steht nicht am Fristtag');
  assert.equal(evA.endAt, '2026-09-26T00:00:00', 'Ganztags-Ende verletzt die Konvention (Folgetag 00:00)');
  assert.equal(evA.allDay, true);
  assert.equal(evP.startAt, '2026-08-28T09:00:00', 'Pannentermin steht nicht am Ende der 72 Stunden');
  assert.equal(evP.allDay, false, 'Eine 72-Stunden-Frist als Ganztagstermin waere irrefuehrend');
});

test('Kalender (ausgefuehrt): ohne Kennung oder Frist entsteht gar kein Termin', async () => {
  const { ds, kalender } = dsKontext();
  const ohneId = await ds.dsTerminAnlegen('auskuenfte', { id: '', eingang: '2026-08-25' });
  assert.equal(ohneId.ok, false, 'Ein Termin ohne eindeutige Kennung wurde angelegt');
  const ohneEingang = await ds.dsTerminAnlegen('auskuenfte', { id: 'ausk-2', eingang: '' });
  assert.equal(ohneEingang.ok, false, 'Ein Termin ohne berechenbare Frist wurde angelegt');
  const ohneEntdeckung = await ds.dsTerminAnlegen('pannen', { id: 'panne-2', entdeckt: '' });
  assert.equal(ohneEntdeckung.ok, false, 'Ein Pannentermin ohne Entdeckungszeitpunkt wurde angelegt');
  assert.equal(kalender.angelegt.length, 0, 'Es wurde trotzdem in den Kalender geschrieben');
  /* Ein stummes Scheitern waere schlimmer als gar kein Termin - das Buero muss es erfahren. */
  for (const r of [ohneId, ohneEingang, ohneEntdeckung]) {
    assert.ok(r.text && r.text.trim(), 'Das Scheitern bleibt unbemerkt');
  }
});

test('Kalender (ausgefuehrt): Abschalten nimmt den Termin wieder zurueck', async () => {
  const { ds, kalender } = dsKontext();
  const e = { id: 'ausk-3', eingang: '2026-08-25' };
  const r = await ds.dsTerminAnlegen('auskuenfte', e);
  await ds.dsTerminWeg(r.terminId);
  assert.deepEqual(Array.from(kalender.geloescht), ['kal-1'], 'Der Termin wurde beim Abschalten nicht entfernt');
  /* Ohne gemerkte Kennung darf nichts geloescht werden - sonst traefe es einen fremden Termin. */
  await ds.dsTerminWeg('');
  assert.equal(kalender.geloescht.length, 1, 'Ein Aufruf ohne Kennung loescht irgendetwas');
});

/* ═══════════ 6. Laden, Speichern und die Sperre gegen den Totalverlust ═══════════
   Der gefaehrlichste Weg dieses Bausteins: der Reiter laedt den Bestand, haelt einen
   Fehlschlag fuer ein leeres Buero, setzt die Vorlage ein und schreibt sie zurueck. Der PUT
   ersetzt den Blob VOLLSTAENDIG und office_json hat keine Historie - Auskunftsersuchen nach
   Art. 15 und Datenpannen nach Art. 33 waeren unwiederbringlich weg. Deshalb wird hier der
   ganze Ablauf ausgefuehrt: dsLaden mit einer fetch-Attrappe, danach die Aufrufstelle
   renderDatenschutzTab und zuletzt der Schreibweg __dsFeld. */

const DS_ABLAGE = [
  schnipsel("  const DS_SCHLUESSEL='datenschutz';", '  /* ── Fristen ──'),
  schnipsel('  function dsHeute(){', '  /* ── Kalendereintrag je Frist'),
  schnipsel('  async function dsTerminAnlegen(bereich,e){', '  /* ── Zugriff auf einzelne Eintraege'),
  schnipsel('  function dsListe(bereich){', '  /* ── Bausteine der Oberflaeche'),
  schnipsel('  async function renderDatenschutzTab(body){', '  /* ── Bedienung'),
  schnipsel('  const DS_NEUZEICHNEN={', '  window.__dsNeu='),
  /* dsZeichnen zeichnet die Oberflaeche - fuer diese Fragen zaehlt nur, DASS gezeichnet wird. */
  'function dsZeichnen(){ globalThis.__gezeichnet=(globalThis.__gezeichnet||0)+1; }',
  'globalThis.__ablage={dsLaden,dsSpeichern,dsLeer,dsSaeubern,dsFinde,dsVorlagenEinsetzen,'
  + 'renderDatenschutzTab,istVorlagenstand:window.__dsIstVorlagenstand,'
  + 'feld:window.__dsFeld,kopf:window.__dsKopf,stand:()=>dsStand,geladen:()=>dsGeladen};'
].join('\n');

/* @param antwort  null = fetch wirft, sonst {ok,status,data}. */
function ablageKontext(antwort, rechte) {
  const puts = [];
  const meldungen = [];
  const ctx = {
    console,
    esc: (s) => String(s == null ? '' : s),
    escAttr: (s) => String(s == null ? '' : s),
    toast: (t) => meldungen.push(String(t)),
    fetch: async (url, opt) => {
      if (opt && opt.method === 'PUT') { puts.push(JSON.parse(opt.body)); return { ok: true, json: async () => ({}) }; }
      if (!antwort) throw new Error('Netzabriss');
      if (!antwort.ok) return { ok: false, status: antwort.status || 500, json: async () => ({}) };
      return { ok: true, json: async () => JSON.parse(JSON.stringify({ data: antwort.data })) };
    },
    location: { protocol: 'https:' },
  };
  ctx.window = ctx;
  ctx.__appMode = 'online';
  ctx.__currentUser = rechte || { isAdmin: true };
  ctx.__officeProfile = null;
  ctx.__calCreateItem = async () => ({ id: 'kal-1' });
  ctx.__calRemoveItem = async () => {};
  vm.createContext(ctx);
  vm.runInContext(DS_ABLAGE, ctx, { filename: 'datenschutz-ablage.js' });
  return { a: ctx.__ablage, puts, meldungen, ctx };
}

/* Ein gepflegter Bestand, wie ihn ein Buero nach Wochen hat. */
const GEPFLEGT = {
  version: 1,
  verantwortlicher: { name: 'Betreuungsbüro Beispiel', anschrift: 'Hauptstr. 1', vertreter: '',
    dsb: 'Frau Datenschutz', dsbKontakt: '', aufsichtsbehoerde: 'LfDI', stand: '2026-08-01' },
  vvt: [{ id: 'vvt_betreuungsfuehrung', name: 'Führung rechtlicher Betreuungen', zweck: 'Vom Büro formuliert.' }],
  tom: [{ id: 'tom_zugang', gruppe: 'Vertraulichkeit', name: 'Zugangskontrolle', stand: 'umgesetzt' }],
  auskuenfte: [{ id: 'ausk-1', eingang: '2026-08-10', betroffene: 'Nowak, Halina' }],
  pannen: [{ id: 'panne-1', entdeckt: '2026-08-12T09:00', beschreibung: 'Brief an falschen Empfänger' }],
};

test('Laden (ausgefuehrt): ein Fehlschlag ist NICHT dasselbe wie ein leeres Buero', async () => {
  for (const fall of [{ ok: false, status: 500 }, { ok: false, status: 502 }, null]) {
    const { a } = ablageKontext(fall);
    assert.equal(await a.dsLaden(), null,
      `Ladefehler ${JSON.stringify(fall)} liefert weiterhin einen leeren Datensatz`);
  }
  /* Ein Server, der wirklich nichts gespeichert hat, liefert weiterhin den leeren Datensatz. */
  const leer = ablageKontext({ ok: true, data: null });
  const stand = await leer.a.dsLaden();
  assert.ok(stand, 'ein echter Leerbestand wird faelschlich als Ladefehler gedeutet');
  assert.equal(stand.vvt.length, 0);
});

test('Reiter (ausgefuehrt): ein Ladefehler schreibt NICHTS und sagt es ehrlich', async () => {
  const { a, puts, ctx } = ablageKontext({ ok: false, status: 502 });
  const body = { innerHTML: '' };
  await a.renderDatenschutzTab(body);
  assert.equal(puts.length, 0, 'Der Reiter hat die Vorlage ueber den Bestand geschrieben');
  assert.match(body.innerHTML, /nicht geladen werden/, 'Der Nutzer sieht eine leere Maske statt einer Meldung');
  assert.equal(a.stand(), null, 'Der Zustand steht auf einem Ersatz-Datensatz');
  assert.equal(a.geladen(), false, 'Der Schreibweg ist weiterhin offen');

  /* Der ENTSCHEIDENDE zweite Teil (Lauf B des Befunds): auch spaetere Eingaben duerfen nicht
     durchkommen. Frueher genuegte ein einziger Tastendruck, um den leeren Ersatzstand als
     Gesamtdatensatz ueber die Dokumentation zu schreiben. */
  await a.kopf('name', 'Irgendein Büro');
  assert.equal(puts.length, 0, 'Eine Eingabe nach dem Ladefehler hat den Bestand ueberschrieben');
  await assert.rejects(() => a.dsSpeichern(ctx.__ablage.dsLeer()), /nicht geladen/,
    'dsSpeichern schreibt trotz fehlgeschlagenem Laden');
});

test('Reiter (ausgefuehrt): ein gepflegter Bestand wird gelesen und nicht angetastet', async () => {
  const { a, puts } = ablageKontext({ ok: true, data: GEPFLEGT });
  await a.renderDatenschutzTab({ innerHTML: '' });
  assert.equal(puts.length, 0, 'Ein gepflegter Bestand loeste einen Schreibvorgang aus');
  assert.equal(a.stand().auskuenfte.length, 1, 'Auskunftsersuchen verloren');
  assert.equal(a.stand().pannen.length, 1, 'Datenpannen verloren');
  assert.equal(a.stand().verantwortlicher.dsb, 'Frau Datenschutz');
  assert.equal(a.geladen(), true, 'Der Schreibweg blieb gesperrt, obwohl geladen wurde');

  /* Jetzt darf gespeichert werden - und zwar der GELADENE Stand, nicht die Vorlage. */
  await a.kopf('vertreter', 'Frau Inhaberin');
  assert.equal(puts.length, 1, 'Eine Eingabe wurde nicht gespeichert');
  assert.equal(puts[0].data.auskuenfte.length, 1, 'Das Speichern hat die Auskunftsersuchen abgeraeumt');
  assert.equal(puts[0].data.verantwortlicher.vertreter, 'Frau Inhaberin');
});

test('Reiter (ausgefuehrt): ein wirklich leeres Buero bekommt die Vorlage genau einmal', async () => {
  const { a, puts } = ablageKontext({ ok: true, data: null });
  await a.renderDatenschutzTab({ innerHTML: '' });
  assert.equal(puts.length, 1, 'Die Erstbefuellung unterbleibt jetzt auch im Normalfall');
  assert.equal(puts[0].data.vvt.length, 7);
  assert.equal(puts[0].data.tom.length, 12);
});

/* ═══════════ 7. „Vom Buero geprueft“ ist eine Aussage, kein Nebeneffekt ═══════════ */

test('Verzeichnis (ausgefuehrt): ein geaendertes Feld stempelt die Zeile nicht als geprueft', async () => {
  const { a } = ablageKontext({ ok: true, data: null });
  await a.renderDatenschutzTab({ innerHTML: '' });
  const vorher = a.stand().vvt.find((e) => e.id === 'vvt_vermoegenssorge');
  assert.equal(vorher.vomProgramm, true);
  assert.equal(vorher.geprueft, false);

  /* Das Buero korrigiert NUR die Bezeichnung. Acht weitere Pflichtangaben derselben Zeile -
     darunter die Rechtsgrundlage - sind damit nicht geprueft. */
  await a.feld('vvt', 'vvt_vermoegenssorge', 'name', 'Vermögenssorge');
  const nachher = a.stand().vvt.find((e) => e.id === 'vvt_vermoegenssorge');
  assert.equal(nachher.name, 'Vermögenssorge', 'Die Aenderung kam gar nicht an');
  assert.equal(nachher.geprueft, false,
    'Ein einziges Feld stempelt die Zeile weiterhin als „vom Büro geprüft“');

  /* Erst die ausdrueckliche Bestaetigung setzt das Merkmal - und die gibt es als Knopf. */
  await a.feld('vvt', 'vvt_vermoegenssorge', 'geprueft', true);
  assert.equal(a.stand().vvt.find((e) => e.id === 'vvt_vermoegenssorge').geprueft, true,
    'Die ausdrueckliche Bestaetigung wirkt nicht');
});

test('Verzeichnis: die Bestaetigung steht als eigener Knopf im Kartenfuss', () => {
  const karte = schnipsel('  function dsVvtKarteHTML(e){', '  function dsVvtHTML(){');
  assert.match(karte, /e\.vomProgramm&&!e\.geprueft/, 'Der Knopf erscheint unabhaengig vom Zustand');
  assert.ok(karte.includes("\\'geprueft\\',true)"),
    'Es gibt keinen Weg, eine Zeile ausdruecklich zu bestaetigen');
  assert.ok(karte.includes('Alle Angaben dieser Zeile geprüft'), 'Der Knopf traegt keine klare Beschriftung');
  /* Die Marke muss nach der Bestaetigung sofort verschwinden - sonst wirkt der Knopf tot.
     'name' steht seit dem 29.08. NICHT mehr in der Liste: dsZeichnen ersetzt den ganzen
     Unterreiter und verschluckte damit Eingaben im Nachbarfeld (Review-Befund). Der Name wird
     stattdessen punktuell im Kartenkopf nachgezogen. */
  const neu = schnipsel('  const DS_NEUZEICHNEN={', '  window.__dsUnter=');
  assert.match(neu, /vvt:\['geprueft'\]/, 'Nach der Bestaetigung wird nicht neu gezeichnet');
});

/* ═══════════ 8. Lokale Buerosicherung traegt die Dokumentation mit ═══════════ */

test('Lokalsicherung: die Datenschutz-Dokumentation wird gesammelt UND zurueckgeschrieben', () => {
  /* Lokal gibt es keine Serverroute, die office_json generisch dumpt - der Sammler arbeitet
     mit einer festen Feldliste. Fehlt der Schluessel dort, meldet die Sicherung „✓“ und die
     gesamte DSGVO-Dokumentation ist beim naechsten Rechnerwechsel weg. */
  assert.ok(html.includes("ui_prefs:{fileNameStyle:L.fileNameStyle||''},datenschutz:L.datenschutz||null}"),
    'Der lokale Sammler nimmt die Datenschutz-Dokumentation nicht mit');

  /* Der Einlese-Weg ausgefuehrt: er darf einen vorhandenen Bestand NIE ueberschreiben. */
  const roh = schnipsel('          const dsSic=data.officeJson.datenschutz;', '          try{window.saveBueroLocal()}');
  const { a } = ablageKontext({ ok: true, data: null });
  const ctx2 = { console };
  ctx2.window = { __dsIstVorlagenstand: a.istVorlagenstand };
  vm.createContext(ctx2);
  vm.runInContext(`this.einlesen=function(L,data){\n${roh}\n};`, ctx2, { filename: 'ds-einlesen.js' });

  /* (1) Nichts lokal vorhanden (geleerter Browserspeicher, neuer Rechner) -> zurueckschreiben. */
  const leer = {};
  ctx2.einlesen(leer, { officeJson: { datenschutz: GEPFLEGT } });
  assert.equal(leer.datenschutz.auskuenfte.length, 1, 'Die Sicherung wurde nicht eingelesen');

  /* (2) Nur die Programmvorlage steht da (der Reiter wurde einmal geoeffnet) -> ersetzen. */
  const nurVorlage = { datenschutz: a.dsVorlagenEinsetzen(a.dsLeer()) };
  ctx2.einlesen(nurVorlage, { officeJson: { datenschutz: GEPFLEGT } });
  assert.equal(nurVorlage.datenschutz.pannen.length, 1,
    'Ein einmal geoeffneter Reiter verhindert die Wiederherstellung');

  /* (3) Ein gepflegter Bestand wird NICHT von einer aelteren Sicherung ueberschrieben. */
  const gepflegt = { datenschutz: { pannen: [{ id: 'panne-9' }], vvt: [], tom: [], auskuenfte: [] } };
  ctx2.einlesen(gepflegt, { officeJson: { datenschutz: GEPFLEGT } });
  assert.equal(gepflegt.datenschutz.pannen[0].id, 'panne-9',
    'Eine Sicherung hat den gepflegten lokalen Bestand ueberschrieben');

  /* (4) Eine Sicherung ohne den Schluessel raeumt nichts ab. */
  const unberuehrt = { datenschutz: { pannen: [{ id: 'panne-9' }] } };
  ctx2.einlesen(unberuehrt, { officeJson: {} });
  assert.equal(unberuehrt.datenschutz.pannen[0].id, 'panne-9');
});

/* ════════════════════════ 9. Auslieferungsdatei unversehrt ════════════════════════ */

test('Auslieferung: die Blockzahl bleibt bei 309', () => {
  const bloecke = (html.match(/\n<script/g) || []).length;
  assert.equal(bloecke, 309,
    `Die Auslieferungsdatei hat ${bloecke} <script>-Bloecke statt 309 - neuer Code gehoert in einen vorhandenen Block.`);
});

test('Auslieferung: der Datenschutz-Baustein haengt an denselben Rechten wie der Server', () => {
  /* Die Oberflaeche darf nichts anzeigen, was der Server nicht herausgeben wuerde - sonst
     zeigt ein Nutzer ohne Recht eine leere Seite statt eines Hinweises (oder umgekehrt). */
  const anzeige = schnipsel('function dsDarfSchreiben()', '/* ── Fristen ──');
  assert.match(anzeige, /u\.isAdmin\|\|u\.canManageOfficeProfile\)/, 'Schreibrecht der Oberflaeche weicht ab');
  assert.match(anzeige, /u\.isAdmin\|\|u\.canManageOfficeProfile\|\|u\.canViewAuditLog/,
    'Leserecht der Oberflaeche weicht vom Server ab');
});

test('GUI-Runde 29.08.: eine Kopfleiste, feste Raster, gedeckelte Breiten', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

  /* (1) Anlegen und „Zum Vorlegen" teilen sich in allen VIER Reitern eine Zeile - vorher zwei
     gestapelte Balken vor dem Inhalt (Nutzerfund, Bildschirmfotos aller vier Reiter). */
  assert.equal((html.match(/<div class="ds-kopfleiste">'/g) || []).length, 4,
    'Nicht alle vier Datenschutz-Reiter nutzen die gemeinsame Kopfleiste');
  assert.ok(!html.includes('<div class="ds-werkzeuge"><button type="button" class="btn" onclick="window.__dsNeu('),
    'Der Anlegen-Knopf steht wieder in einer eigenen Reihe über der Vorlegen-Leiste');
  assert.ok(html.includes('.ds-kopfleiste{display:flex;gap:8px 14px;align-items:center;justify-content:space-between'),
    'Die Kopfleiste verteilt Anlegen und Vorlegen nicht mehr auf eine Zeile');

  /* (2) Auskunft + Pannen: festes Vierer-Raster statt auto-fit (dieselbe Entscheidung wie beim
     Reiter „Verantwortlicher": auto-fit machte bei breitem Fenster fünf Spalten mit Waisenfeld).
     Am Prüfstand: vier Spalten à 265,75px, gedeckelt auf 1120. */
  /* Drei seit dem Review vom 29.08.: auch die VVT-Karten nutzen das Vierer-Raster - vorher
     streute auto-fit ihre acht Textfelder je Wirt in 3-4 ungedeckelte Spalten, während das
     Bezeichnungs-Feld darüber bei 1120px endete. */
  assert.equal((html.match(/<div class="ds-raster vier">/g) || []).length, 3,
    'Nicht alle drei Vorgangs-Karten (VVT, Auskunft, Pannen) nutzen das feste Vierer-Raster');
  assert.ok(html.includes('.ds-raster.vier{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 16px;max-width:1120px}'),
    'Das Vierer-Raster ist nicht mehr fest und gedeckelt');

  /* (3) TOM: die zwei Auswahlfelder waren von auto-fit auf je ~700px gezogen; das dashed
     Frist-Feld der Pannen lief über die volle Kartenbreite. */
  assert.ok(html.includes('.ds-tom .ds-raster.zwei{max-width:720px}'),
    'Die TOM-Auswahlfelder wachsen wieder auf Kartenbreite');
  /* 29.08. nachgezogen (Nutzerwunsch): Das Frist-Feld steht IM Vierer-Raster als erstes Feld
     der zweiten Reihe - vor der Meldung, denn erst läuft die Frist, dann wird gemeldet. Die
     Sonderklasse „schmal" ist damit ersatzlos entfallen. */
  assert.ok(html.includes("+'<div class=\"ds-feld\"><label>Frist für die Meldung"),
    'Das 72-Stunden-Frist-Feld fehlt');
  assert.ok(!html.includes('ds-feld schmal'),
    'Die Sonderklasse „schmal" ist zurück - das Frist-Feld gehört ins Raster');

  /* (4) TOM-Fußzeile: Herkunftshinweis links, Entfernen rechts - eine Zeile statt zwei. */
  assert.ok(html.includes("'<div class=\"ds-kartenfuss mit-hinweis\">'+herkunft"),
    'Herkunftshinweis und Entfernen-Knopf stehen wieder in zwei getrennten Zeilen');
  assert.ok(html.includes(':herkunft)'),
    'Im Nur-Lese-Fall fehlt der Herkunftshinweis (dort gibt es keine Fußzeile)');

  /* (5) Dunkelmodus: die rahmenlose Vorlegen-Gruppe darf keine Fläche mehr bekommen, und ihr
     Etikett braucht ohne hellen Kasten eine hellere Farbe. */
  assert.ok(html.includes('.ds-kopfleiste .ds-ausgabe{background:none!important}'),
    'Die Admin-Panel-Dunkelregel malt wieder einen Kasten um die rahmenlose Vorlegen-Gruppe');
  assert.ok(html.includes('html[data-theme="dark"] .ds-kopfleiste .ds-ausgabetitel{color:#a9bdcb}'),
    'Das Vorlegen-Etikett bleibt im Dunkelmodus auf der Auf-hellem-Kasten-Farbe');
});

test('GUI-Runde 29.08. II: alle Felder einer Karte sind gleich hoch', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

  /* Nutzerwunsch 29.08. („achte stärker darauf, dass die Felder die gleichen Höhen haben") -
     drei Quellen ungleicher Höhen, am Prüfstand vor/nach gemessen:
       (1) date-/datetime-Eingaben sind in Safari höher als <select> daneben,
       (2) die VVT-Textfelder trugen gemischte rows (4/4/3/3 und 3/3/4/3),
       (3) das Frist-Anzeigefeld bemaß sich aus seinem Text.
     Nachher: JEDER Einzeiler 34px, JEDES Textfeld 76px, Fristfelder 34px - in allen Reitern. */
  assert.ok(html.includes('#modal .ds-feld :is(input,select){height:34px;box-sizing:border-box;padding:0 8px}'),
    'Die gemeinsame Höhe der Einzeiler fehlt');
  assert.ok(html.includes('#modal .ds-feld textarea{height:76px;min-height:76px}'),
    'Die gemeinsame Höhe der Textfelder fehlt');
  assert.ok(html.includes('#modal .ds-fristfeld{height:34px;box-sizing:border-box;display:flex;align-items:center;padding:0 8px}'),
    'Das Frist-Anzeigefeld fluchtet nicht mehr mit den Feldern daneben');
  /* Der #modal-Anker ist Pflicht: `.modal-box ... textarea` (0,2,1) setzt height:auto und
     schlüge eine bloße Klassenregel - dieselbe Falle wie beim Verantwortlicher-Reiter. */
  assert.ok(!/[^l] \.ds-feld textarea\{height/.test(html),
    'Die Textfeld-Höhe hängt nicht mehr am #modal-Anker und verliert gegen .modal-box textarea');
});

test('GUI-Runde 29.08. III: Fristen vor Erledigung, Terminschalter bei der Frist, sprechender TOM-Knopf', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

  /* (1+2) Erst läuft die Frist, dann wird erledigt/gemeldet - in beiden Vorgangs-Karten. */
  const auskunft = html.slice(html.indexOf('function dsAuskunftKarteHTML'), html.indexOf('function dsAuskunftHTML'));
  assert.ok(auskunft.indexOf('Frist (1 Monat ab Eingang)') < auskunft.indexOf("'erledigtAm'"),
    'Auskunft: die Frist steht wieder HINTER dem Erledigt-Feld');
  const pannen = html.slice(html.indexOf('function dsPanneKarteHTML'), html.indexOf('function dsPannenHTML'));
  assert.ok(pannen.indexOf('Frist für die Meldung') < pannen.indexOf("'gemeldetAm'"),
    'Pannen: die Frist steht wieder hinter der Meldung (oder in eigener Zeile unter dem Raster)');

  /* (3) Der Kalendertermin-Schalter gehört zur Frist: direkt nach dem Raster, VOR den
     Freitextfeldern - in beiden Karten. */
  assert.ok(auskunft.indexOf("dsTerminSchalter('auskuenfte'") < auskunft.indexOf("'ergebnis'"),
    'Auskunft: der Terminschalter steht wieder unter den Freitextfeldern');
  assert.ok(pannen.indexOf("dsTerminSchalter('pannen'") < pannen.indexOf("'beschreibung','Art der Verletzung"),
    'Pannen: der Terminschalter steht wieder unter den Freitextfeldern');

  /* (4) Der TOM-Knopf sagt, was er tut - und das Anlegen springt zum neuen Eintrag, denn eine
     neue Maßnahme landet am Ende der Gruppe Vertraulichkeit, außerhalb des Sichtfelds. */
  assert.ok(html.includes('>+ Eigene Maßnahme hinzufügen</button>'),
    'Der TOM-Knopf heißt wieder nur „Maßnahme hinzufügen" - unklar, was er anlegt');
  assert.ok(html.includes('für Vorkehrungen des Büros, die das Programm nicht kennt'),
    'Die Erklärung am TOM-Knopf fehlt');
  assert.ok(html.includes("const knoten=document.querySelector('[data-ds-id=\"'+neu.id+'\"]');"),
    'Das Anlegen springt nicht mehr zum neuen Eintrag');
  assert.equal((html.match(/data-ds-id="'\+escAttr\(e\.id\)\+'"/g) || []).length, 4,
    'Nicht alle vier Karten-Wrapper (TOM + drei offene Karten) tragen den Sprung-Anker');

  /* Review-Befunde 29.08., mitbehoben: Überfällig-Zähler mit Frist-Fallback wie Karte und
     Alarmzeile; Warnbanner unter dem 1120px-Deckel; Spaltenstufen messen den CONTAINER statt
     den Viewport (um den Raster liegen je Wirt ~300px Rahmen). */
  /* Seit dem Einbau der Fristverlängerung liest der Zähler die WIRKSAME Frist über
     dsFristAuskunftEff - die enthält den Fallback und die Verlängerung. */
  assert.ok(html.includes('const ueberfaellig=liste.filter(e=>{const f=dsFristAuskunftEff(e);'),
    'Der Überfällig-Zähler nutzt nicht die wirksame Frist');
  assert.ok(html.includes('.ds-koerper>.ds-warnbanner{max-width:1120px;box-sizing:border-box}'),
    'Der Prüfbanner läuft wieder über die Formularkante hinaus');
  assert.ok(html.includes('container-type:inline-size}') && html.includes('@container(max-width:1080px){.ds-raster.vier'),
    'Die Spaltenstufen messen wieder den Viewport statt der echten Rasterbreite');
  assert.ok(!/@media\(max-width:1150px\)\{\.ds-raster\.vier/.test(html),
    'Die alte Viewport-Stufe ist zurück');
});

test('Auskunftsersuchen: die Fristverlängerung nach Art. 12 Abs. 3 S. 2 ist einstellbar', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

  /* Nutzerfund 29.08.: Der Hinweistext nannte die Verlängerung samt Mitteilungs- und
     Begründungspflicht - einstellen ließ sie sich nicht. Jetzt drei zusammengehörige Felder. */
  assert.ok(html.includes("const DS_VERLAENGERUNG=[['','keine Verlängerung'],['1','um 1 Monat'],['2','um 2 Monate']];"),
    'Die Auswahl der Verlängerungsdauer fehlt');
  ['verlaengerung', 'verlaengertAm', 'verlaengerungGrund'].forEach(f => {
    assert.ok(new RegExp(f + ':ds(Wahl|Iso|Txt)').test(html),
      `Das Feld ${f} wird nicht gesäubert - dann kommt es gar nicht erst in den Speicher`);
    assert.ok(html.includes("'" + f + "'"), `Das Feld ${f} wird nicht angeboten`);
  });

  /* Die Fristrechnung: `frist` bleibt die URSPRÜNGLICHE Monatsfrist (kein Wandern des Bestands
     nötig) und ist zugleich der Stichtag für die Mitteilung; die wirksame Frist wird berechnet.
     Am Prüfstand über die Monatsenden gegengerechnet - dort brechen solche Fristen sonst:
       30.11.2026 +1+2 -> 28.02.2027 · 31.12.2026 +1+2 -> 31.03.2027
       31.03.2026 +1+1 -> 30.05.2026 · 31.01.2026 +1    -> 28.02.2026 */
  assert.ok(html.includes('function dsMonatPlus(iso,n){') && html.includes('function dsFristAuskunft(eingang){return dsMonatPlus(eingang,1)}'),
    'Die Monatsrechnung ist nicht mehr verallgemeinert');
  assert.ok(html.includes('function dsFristBasis(e){') && html.includes('function dsFristAuskunftEff(e){'),
    'Basis- und wirksame Frist sind nicht mehr getrennt');
  /* ALLE Frist-Leser müssen die wirksame Frist nehmen - sonst mahnt eine Stelle den alten Tag an. */
  ['const frist=dsFristAuskunftEff(e);', 'const f=dsFristAuskunftEff(e);',
   'const frist=auskunft?dsFristAuskunftEff(e):dsFristPanne(e.entdeckt);'].forEach(t => {
    assert.ok(html.includes(t), `Ein Frist-Leser rechnet ohne Verlängerung: ${t}`);
  });
  assert.ok(!/e\.frist\|\|dsFristAuskunft\(e\.eingang\)/.test(html),
    'Irgendwo wird die Frist wieder ohne Verlängerung gelesen');

  /* Die Verlängerung wirkt nur mit rechtzeitiger Mitteilung UND Begründung - fehlt eines,
     sagt die Karte es. Der Grund-Text löst dabei ein Neuzeichnen aus, sonst meldete der
     Hinweis „Die Gründe fehlen" weiter, nachdem sie eingetragen waren. */
  assert.ok(html.includes("luecken.push('Der Tag der Mitteilung ist noch nicht vermerkt.')"),
    'Die fehlende Mitteilung wird nicht mehr angemahnt');
  assert.ok(html.includes("else if(basis&&e.verlaengertAm>basis)"),
    'Eine verspätete Mitteilung wird nicht mehr erkannt');
  assert.ok(html.includes("luecken.push('Die Gründe für die Verzögerung fehlen.')"),
    'Die fehlende Begründung wird nicht mehr angemahnt');
  assert.ok(/auskuenfte:\[[^\]]*'verlaengerungGrund'\]/.test(html),
    'Der Begründungstext zeichnet die Karte nicht neu - der Hinweis bleibt dann stehen');

  /* Kalendertermin und Ausdruck dürfen die verlängerte Frist nicht verschweigen. */
  assert.ok(html.includes("' Diese Frist wurde um '+(+e.verlaengerung)+"),
    'Der Kalendertermin erwähnt die Verlängerung nicht');
  assert.ok(html.includes("' · um '+mon+(mon===1?' Monat':' Monate')+' verlängert'"),
    'Der Ausdruck „Offene Vorgänge" weist die Verlängerung nicht aus');
  assert.ok(!html.includes("'Frist (1 Monat, Art. 12 Abs. 3)'"),
    'Der PDF-Spaltenkopf behauptet weiterhin „1 Monat" - bei verlängerter Frist ist das falsch');
});

test('Vorlagenpunkte sind wiederherstellbar – Bibliothek statt Papierkorb', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

  /* Nutzerfund 29.08.: „Ich kann vorgegebene Einträge löschen, sie dann aber nicht mehr neu
     anlegen." Ursache: `vomProgramm` entschied über Papierkorb-oder-endgültig-weg, sagt aber
     etwas anderes - dass der BESCHREIBUNGSTEXT vom Programm stammt. Die vier TOM-Punkte, die
     bewusst leer starten (Zutritt, Auftrag, Überprüfung, Schulung), tragen deshalb false und
     wurden endgültig gelöscht. Maßgeblich ist jetzt die Herkunft der KENNUNG. */
  assert.ok(html.includes('const DS_VORLAGEN={vvt:VVT_VORLAGE,tom:TOM_VORLAGE};'),
    'Das Vorlagen-Register fehlt');
  assert.ok(html.includes("if(dsIstVorlage(bereich,e.id)){"),
    'Das Löschen entscheidet wieder über vomProgramm - dann sind vier TOM-Punkte unwiederbringlich');
  /* Gegenprobe am Datenbestand: genau diese vier tragen vomProgramm:false und wären mit dem
     alten Kriterium verloren gewesen. */
  ['tom_zutritt', 'tom_auftrag', 'tom_ueberpruefung', 'tom_schulung'].forEach(id => {
    const stelle = html.indexOf("id:'" + id + "'");
    assert.ok(stelle > 0, `Vorlagenpunkt ${id} fehlt`);
    assert.ok(/vomProgramm:false/.test(html.slice(stelle, stelle + 500)),
      `${id} trägt nicht mehr vomProgramm:false - der Prüfstein muss dann neu begründet werden`);
  });

  /* Die Bibliothek geht von der VORLAGE aus, nicht vom Bestand - nur so kommen Punkte zurück,
     die vor der Reparatur endgültig gelöscht wurden (am Prüfstand simuliert: tom_auftrag hart
     aus dem Blob entfernt -> erscheint in der Liste -> „Aufnehmen" legt ihn neu an). */
  assert.ok(html.includes('function dsBibliothekHTML(bereich,einzahl,mehrzahl){'),
    'Die Bibliothek fehlt');
  assert.ok(!html.includes('function dsPapierkorbHTML('), 'Der alte Papierkorb ist zurück');
  assert.ok(html.includes('const ausVorlage=(DS_VORLAGEN[bereich]||[]).map(v=>{'),
    'Die Bibliothek geht wieder vom Bestand statt von der Vorlage aus');
  assert.ok(html.includes("const verwaist=liste.filter(e=>e.entfernt&&!dsIstVorlage(bereich,e.id))"),
    'Entfernte Einträge ohne Vorlagen-Entsprechung wären für immer verborgen');
  assert.ok(html.includes("dsBibliothekHTML('vvt'") && html.includes("dsBibliothekHTML('tom'"),
    'Nicht beide Reiter nutzen die Bibliothek');

  /* Ein Knopf, zwei Herkünfte - und neu angelegte Punkte landen an ihrer VORLAGENPOSITION.
     Am Prüfstand gegengeprüft: nach dem Aufnehmen stand die Reihenfolge wieder exakt wie in
     der Vorlage (tom_auftrag zwischen tom_eingabe und tom_verfuegbar). */
  assert.ok(html.includes('window.__dsAufnehmen=async function(bereich,id){'),
    'Der gemeinsame Aufnehmen-Weg fehlt');
  assert.ok(html.includes('if(da){da.entfernt=false;dsOffen[id]=true;}'),
    'Ein im Bestand vorhandener Punkt verliert beim Aufnehmen seine Angaben – oder der Sprung zum Eintrag greift nicht (die zugeklappte VVT-Karte trägt kein data-ds-id)');
  /* Die Bibliothek zeigt die GESPEICHERTEN Angaben, nicht den Vorlagentext - sonst wäre ein
     umbenannter entfernter Eintrag dort nicht wiederzuerkennen. Und die beiden Herkünfte sind
     unterscheidbar: „entfernt – kommt mit den bisherigen Angaben zurück" gegen „neu aus der
     Vorlage". Der frühere pauschale Satz war für den zweiten Fall falsch. */
  assert.ok(html.includes("return {id:v.id,name:(da&&da.name)||v.name,"),
    'Die Bibliothek zeigt wieder den Vorlagentext statt der gespeicherten Angaben');
  assert.ok(html.includes("?'<span class=\"ds-mini\">entfernt – kommt mit den bisherigen Angaben zurück</span>'"),
    'Die beiden Herkünfte in der Bibliothek sind wieder nicht unterscheidbar');
  /* Reste des abgelösten Papierkorbs: __dsZurueck hatte keinen Aufrufer mehr, dsEntfernte auch
     nicht - beides lädt dazu ein, später am falschen Weg weiterzubauen. */
  assert.ok(!html.includes('__dsZurueck'), 'Der tote Wiederherstellungsweg __dsZurueck ist zurück');
  assert.ok(!html.includes('function dsEntfernte('), 'Der tote Helfer dsEntfernte ist zurück');
  assert.ok(html.includes('if(r>meinPlatz){ziel=i;break}'),
    'Neu aufgenommene Punkte werden wieder ans Ende gehängt statt einsortiert');
});

test('Eigene TOM-Maßnahmen sind gleichwertig: Bezeichnung und Leitfrage bearbeitbar', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

  /* Beim Nachbau des Nutzerfundes aufgefallen: Der Name stand nur als <strong> - eine selbst
     angelegte Maßnahme hieß dauerhaft „Neue Maßnahme" und hatte keine Leitfrage. In der
     TOM-Dokumentation für die Aufsichtsbehörde stand bei ihr dann nichts, wo bei den
     Vorlagenpunkten die Frage steht. Bei VORLAGEN-Punkten bleiben beide fest: die Leitfrage ist
     der Anker, an dem die Bibliothek den Punkt wiedererkennt. */
  assert.ok(html.includes("const ausVorlage=dsIstVorlage('tom',e.id);"),
    'Die TOM-Karte unterscheidet nicht mehr zwischen Vorlage und eigenem Punkt');
  assert.ok(html.includes("dsEinzeile('tom',e.id,'name','Bezeichnung der Maßnahme'"),
    'Eigene Maßnahmen lassen sich wieder nicht benennen');
  assert.ok(html.includes("dsEinzeile('tom',e.id,'frage','Leitfrage'"),
    'Eigene Maßnahmen bekommen keine Leitfrage');
  assert.ok(html.includes("'<div class=\"ds-mini\">Eigene Maßnahme dieses Büros.</div>'"),
    'Der Herkunftshinweis behauptet bei eigenen Punkten weiter etwas über die Programmvorlage');
  /* KORRIGIERT nach dem Review vom 29.08.: 'name' und 'frage' dürfen NICHT neu zeichnen.
     dsZeichnen ersetzt den ganzen Unterreiter (ziel.innerHTML) - wer die Bezeichnung tippt, mit
     Tab ins Feld daneben springt und dort weiterschreibt, verlöre das Getippte, sobald der PUT
     zurück ist. Für Auswahlfelder ist das Neuzeichnen harmlos (ein <select> ist mit dem change
     schon verlassen), für Textfelder ist es ein Datenverlust-Pfad. Der Kartenkopf wird deshalb
     punktuell nachgezogen. */
  assert.ok(/tom:\['stand','gruppe'\],/.test(html) && /vvt:\['geprueft'\],/.test(html),
    'Ein Textfeld zeichnet wieder den ganzen Reiter neu - das verschluckt Eingaben im Nachbarfeld');
  assert.ok(html.includes("if(feld==='name'&&typeof document!=='undefined'&&document.querySelector){")
         && html.includes("kopf.textContent=String(wert||'')"),
    'Der Kartenkopf wird beim Umbenennen nicht mehr punktuell nachgezogen');
});
