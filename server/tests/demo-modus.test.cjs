'use strict';
/* Demo-Modus (Nutzerauftrag 30.08.2026) - Serverseite, AUSGEFÜHRT gegen eine Wegwerf-DB.

   Geprüft wird die ganze Kette: Admin-Schalter (legt die zwanzig Vorführkonten an bzw.
   deaktiviert sie und räumt ihre Chats), Login-Sperren in beide Richtungen (Demo-Konten
   nur über den Demo-Zugang, echte Konten nie darüber, alles nur bei eingeschaltetem
   Schalter), die Online-Schranke mit ihrer einzigen Demo-Ausnahme (/chat) sowie die
   Chat-Sichtbarkeitstrennung. Das Vorführpaket selbst wird einmal echt gebaut und auf
   Vollständigkeit UND Verfremdung geprüft (kein Klarname/keine Anschrift des Büros). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-demo-test-'));
process.env.RUNTIME_ROOT = TEMP;

const db = require('../src/database/index');
db.prepare(`INSERT INTO users (id,username,password_hash,display_name,allow_local,allow_online,is_admin)
  VALUES (1,'pruefadmin','x','Pruefadmin',1,1,1)`).run();

const demoRoutes = require('../src/modules/demo/routes');
const chatRoutes = require('../src/modules/chat/routes');
const { requireOnlineMode } = require('../src/middleware/authentication');

let server = null;
let sitzung = {};
function serverStarten() {
  if (server) return server;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = Object.assign({}, sitzung); next(); });
  app.use('/api/demo', demoRoutes);
  app.use('/api', requireOnlineMode);
  app.use('/api/chat', chatRoutes);
  server = app.listen(0);
  return server;
}
function ruf(methode, pfad, koerper) {
  const port = serverStarten().address().port;
  const daten = koerper === undefined ? null : JSON.stringify(koerper);
  return new Promise((auf, ab) => {
    const anfrage = http.request({ port, method: methode, path: pfad,
      headers: daten ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(daten) } : {} },
      (antwort) => {
        let text = '';
        antwort.on('data', (t) => { text += t; });
        antwort.on('end', () => {
          let json = null; try { json = JSON.parse(text); } catch (_e) {}
          auf({ status: antwort.statusCode, json, text });
        });
      });
    anfrage.on('error', ab);
    if (daten) anfrage.write(daten);
    anfrage.end();
  });
}

test('Schalter: einschalten legt die zwanzig Vorführkonten an, ausschalten räumt ab', async () => {
  assert.strictEqual(demoRoutes.demoErlaubt(), false, 'Frisch installiert muss der Demo-Modus aus sein');

  sitzung = { userId: 1, isAdmin: true, mode: 'online' };
  const an = await ruf('PUT', '/api/demo/schalter', { an: true });
  assert.strictEqual(an.status, 200);
  assert.strictEqual(an.json.konten, 20);
  assert.strictEqual(demoRoutes.demoErlaubt(), true);
  const zahl = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_demo=1 AND active=1').get().n;
  assert.strictEqual(zahl, 40, 'Es müssen genau 40 aktive Vorführkonten existieren (20 Mitarbeitende + 20 Admins)');

  /* Nur Online-Admins dürfen schalten. */
  sitzung = { userId: 1, isAdmin: false, mode: 'online' };
  assert.strictEqual((await ruf('PUT', '/api/demo/schalter', { an: false })).status, 403);
  sitzung = { userId: 1, isAdmin: true, mode: 'local' };
  assert.strictEqual((await ruf('PUT', '/api/demo/schalter', { an: false })).status, 403);

  /* Demo-Chats entstehen und werden beim Ausschalten restlos entfernt. */
  const demoA = db.prepare("SELECT id FROM users WHERE username='Demo1'").get().id;
  const demoB = db.prepare("SELECT id FROM users WHERE username='Demo2'").get().id;
  db.prepare("INSERT INTO chat_conversations (id,type,title,direct_key,created_by) VALUES ('demo-conv','direct','',?,?)")
    .run(`${Math.min(demoA, demoB)}:${Math.max(demoA, demoB)}`, demoA);
  db.prepare("INSERT INTO chat_participants (conversation_id,user_id) VALUES ('demo-conv',?)").run(demoA);
  db.prepare("INSERT INTO chat_participants (conversation_id,user_id) VALUES ('demo-conv',?)").run(demoB);
  db.prepare("INSERT INTO chat_messages (id,conversation_id,kind,sender_user_id,body,refs_json) VALUES ('demo-msg','demo-conv','user',?,?,'[]')")
    .run(demoA, 'Hallo');
  /* MIT ANLAGE (adversariale Prüfrunde 30.08.): foreign_keys steht auf ON und chat_attachments
     hängt über message_id an chat_messages. Die frühere Aufräumung löschte erst die Nachricht
     (Fremdschlüssel-Verletzung -> Abbruch) und suchte die Anlage danach über eine Spalte, die
     es dort gar nicht gibt. Ergebnis: Sobald EINE Vorführung einen Anhang enthielt, ließ sich
     der Demo-Modus nicht mehr ausschalten und die Datei blieb in der Betriebsdatenbank. */
  db.prepare('INSERT INTO chat_attachments (id,message_id,name,mime,size,data) VALUES (?,?,?,?,?,?)')
    .run('demo-anh', 'demo-msg', 'probe.pdf', 'application/pdf', 4, Buffer.from('test'));

  sitzung = { userId: 1, isAdmin: true, mode: 'online' };
  const aus = await ruf('PUT', '/api/demo/schalter', { an: false });
  assert.strictEqual(aus.status, 200);
  assert.strictEqual(demoRoutes.demoErlaubt(), false);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_demo=1 AND active=1').get().n, 0,
    'Ausschalten muss die Vorführkonten deaktivieren');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM chat_conversations WHERE id='demo-conv'").get().n, 0,
    'Demo-Unterhaltungen müssen beim Ausschalten gelöscht werden');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE id='demo-msg'").get().n, 0,
    'Demo-Nachrichten müssen beim Ausschalten gelöscht werden');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM chat_attachments WHERE id='demo-anh'").get().n, 0,
    'Die Anlage blieb in der Betriebsdatenbank - der Demo-Modus wäre nicht mehr abschaltbar');

  /* Wieder einschalten für die Folgetests. */
  await ruf('PUT', '/api/demo/schalter', { an: true });
});

test('Login-Regeln: Vorführkonten nur über den Demo-Zugang, echte nie darüber (Quelltext-Pins)', () => {
  /* Der komplette Login-Fluss braucht express-session samt Kennwortprüfung - die Regeln
     selbst sind schlank und werden hier am Quelltext festgemacht (der Prüfstand hat den
     HTTP-Weg vollständig belegt: Demo1/demo=200, Demo1/online=403, pruefadmin/demo=403). */
  const auth = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'auth', 'routes.js'), 'utf8');
  assert.match(auth, /\['local', 'online', 'demo'\]\.includes\(mode\)/, 'Der Demo-Modus fehlt in der Login-Whitelist');
  assert.match(auth, /if \(!demoErlaubt\(\)\) return res\.status\(403\)\.json\(\{ error: 'Der Demo-Modus ist ausgeschaltet\.' \}\);/,
    'Der Schalter wird beim Demo-Login nicht mehr geprüft');
  assert.match(auth, /if \(!user\.is_demo\) return res\.status\(403\)\.json\(\{ error: 'Dieses Konto ist kein Vorführkonto\.' \}\);/,
    'Echte Konten könnten sich über den Demo-Zugang anmelden');
  assert.match(auth, /\} else if \(user\.is_demo\) \{\s*\n\s*return res\.status\(403\)\.json\(\{ error: 'Vorführkonten melden sich über den Demo-Zugang an\.' \}\);/,
    'Vorführkonten könnten sich online/lokal anmelden');
  assert.match(auth, /session\.isDemo = !!user\.is_demo;/, 'Die Sitzung trägt die Demo-Markierung nicht');
  assert.match(auth, /if \(req\.session\.isDemo\) return res\.status\(403\)\.json\(\{ error: 'Im Demo-Modus gibt es keinen Moduswechsel\.' \}\);/,
    'Vorführkonten könnten den Modus wechseln');
});

test('Online-Schranke: Demo-Sitzungen erreichen NUR den Chat', async () => {
  sitzung = { userId: db.prepare("SELECT id FROM users WHERE username='Demo1'").get().id, mode: 'demo', isDemo: true };
  const chat = await ruf('GET', '/api/chat/users');
  assert.strictEqual(chat.status, 200, 'Der Chat muss für Demo-Sitzungen offen sein');
  const gesperrt = await ruf('GET', '/api/irgendwas');
  assert.strictEqual(gesperrt.status, 403, 'Alles außer dem Chat muss für Demo-Sitzungen gesperrt bleiben');
});

test('Selbstheilung: fehlende Kontenreihen entstehen beim Serverstart (Nutzerfund: DemoAdmin-Login schlug fehl)', () => {
  /* Die Konten entstanden bisher NUR im Moment des Einschaltens. Wer den Schalter schon
     vorher an hatte, bekam neu hinzugekommene Reihen nie - der Login als DemoAdmin1
     scheiterte mit „Nutzername oder Passwort falsch". Am Prüfstand nachgestellt: Schalter an,
     nur Demo1 vorhanden -> nach dem Laden des Routers sind alle 40 Konten da (7,3 s). */
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'demo', 'routes.js'), 'utf8');
  assert.match(quelle, /setImmediate\(\(\) => \{/, 'Die Selbstheilung beim Serverstart fehlt');
  assert.ok(quelle.includes("const fehlt = !getDemoUserStmt.get('DemoAdmin' + DEMO_ANZAHL) || !getDemoUserStmt.get('Demo' + DEMO_ANZAHL);"),
    'Die Prüfung auf fehlende Kontenreihen fehlt - neue Reihen entstünden nie');
  assert.ok(quelle.includes('if (!demoErlaubt()) return;'),
    'Die Selbstheilung läuft auch bei ausgeschaltetem Demo-Modus');
});

test('Vorführkonten: zwei Reihen - Mitarbeitende und Administration (Nutzerentscheid 30.08.)', () => {
  /* Ohne die Admin-Reihe fehlten der Vorführung genau die Bereiche, die den Online-Modus
     ausmachen: Personen, Rollen, Bürovorgaben, Verwaltungsseiten. */
  const admins = db.prepare("SELECT username, is_admin FROM users WHERE is_demo = 1 AND username LIKE 'DemoAdmin%' ORDER BY id").all();
  assert.strictEqual(admins.length, 20, 'Es fehlen Vorführkonten mit Verwaltungssicht');
  assert.ok(admins.every((u) => u.is_admin === 1), 'Ein DemoAdmin-Konto hat kein Admin-Recht');
  const normale = db.prepare("SELECT is_admin FROM users WHERE is_demo = 1 AND username NOT LIKE 'DemoAdmin%'").all();
  assert.strictEqual(normale.length, 20);
  assert.ok(normale.every((u) => u.is_admin === 0), 'Ein Mitarbeitenden-Konto hat versehentlich Admin-Recht');
});

test('Chat-Trennung: Demo sieht nur Demo, echt sieht nur echt - auch bei der Teilnehmerwahl', async () => {
  const demo1 = db.prepare("SELECT id FROM users WHERE username='Demo1'").get().id;
  const demo2 = db.prepare("SELECT id FROM users WHERE username='Demo2'").get().id;

  sitzung = { userId: demo1, mode: 'demo', isDemo: true };
  const demoListe = await ruf('GET', '/api/chat/users');
  assert.strictEqual(demoListe.json.users.length, 40, 'Demo-Sitzungen sehen genau die 40 Vorführkonten (beide Reihen)');
  /* Beide Reihen: „Demo 1" (Mitarbeitende) und „Demo-Admin 1" (Verwaltung). */
  assert.ok(demoListe.json.users.every((u) => /^Demo[- ]/.test(u.displayName)), 'Ein echtes Konto ist in die Demo-Liste geraten');

  sitzung = { userId: 1, mode: 'online', isDemo: false };
  const echtListe = await ruf('GET', '/api/chat/users');
  assert.ok(echtListe.json.users.every((u) => !/^Demo[- ]/.test(u.displayName)), 'Ein Vorführkonto ist in der echten Nutzerliste sichtbar');

  const quer = await ruf('POST', '/api/chat/conversations', { participantIds: [demo2] });
  assert.strictEqual(quer.status, 404, 'Ein echtes Konto darf kein Vorführkonto als Teilnehmer wählen (fail-closed)');

  sitzung = { userId: demo1, mode: 'demo', isDemo: true };
  const conv = await ruf('POST', '/api/chat/conversations', { participantIds: [demo2] });
  assert.strictEqual(conv.status, 201, 'Demo-zu-Demo-Unterhaltungen müssen möglich sein');
  const msg = await ruf('POST', `/api/chat/conversations/${conv.json.conversation.id}/messages`, { body: 'Testnachricht' });
  assert.strictEqual(msg.status, 201, 'Demo-Nachrichten müssen gespeichert werden');
});

test('Vorführpaket: vollständig, bebildert und restlos verfremdet', { timeout: 120000 }, () => {
  const { bauePaket } = require('../tools/demo-faelle/paket');
  const paket = bauePaket();
  assert.strictEqual(paket.faelle.length, 5, 'Es müssen genau fünf Fälle im Paket sein');
  const labels = paket.faelle.map((f) => f.label).sort();
  assert.deepStrictEqual(labels, ['Auerbach, Margarete', 'Kilic, Emre', 'Nowak, Halina', 'Rothenberg, Dieter', 'Weidmann, Jonas'],
    'Die fünf Demofälle stimmen nicht');
  for (const f of paket.faelle) {
    assert.ok(String(f.state.caseData.person.photo || '').startsWith('data:image/jpeg;base64,'),
      `${f.label}: Das Passfoto fehlt oder hat das falsche Format`);
    assert.ok(f.state.caseData.person.photo.length > 10000, `${f.label}: Das Passfoto ist verdächtig klein`);
    assert.ok((f.state.caseData.contacts || []).length >= 30, `${f.label}: Die Kontakte fehlen`);
  }
  assert.ok(paket.kalender.length >= 20 && paket.aufgaben.length >= 20, 'Termine/Aufgaben fehlen im Paket');
  assert.strictEqual(paket.buero.officeProfile.companyName, 'Betreuungsbüro Mustermensch');
  assert.strictEqual(paket.buero.officeProfile.city, 'Musterstadt');
  for (const k of paket.buero.bueroKontakte) {
    assert.ok(k.phone && k.email && k.postal && k.city, 'Ein Büro-Musterkontakt ist nicht voll ausgefüllt');
  }
  /* Die Verfremdung: nichts im GESAMTEN Paket darf auf das echte Büro deuten. */
  const s = JSON.stringify(paket);
  /* STRUKTURELLE Verfremdung (Befund 30.08., adversariale Runde): Die Fallvorlagen trugen
     dutzende ECHTE Rufnummern und E-Mail-Adressen realer Behörden und Einrichtungen der
     Region - eine Blacklist erwischt so etwas nie. Deshalb wird hier bewiesen, dass im
     fertigen Paket AUSSCHLIESSLICH Muster-Rufnummern und Muster-Domänen vorkommen. */
  const rufnummern = [...new Set(s.match(/\b0\d{2,5}\s?[/-]\s?\d{3,9}\b|\b0\d{9,14}\b/g) || [])];
  const fremdeNummern = rufnummern.filter((n) => {
    const z = n.replace(/[^0-9]/g, '');
    return !z.startsWith('01234') && !z.startsWith('0171');
  });
  assert.deepStrictEqual(fremdeNummern, [], `Nicht-Muster-Rufnummern im Vorführpaket: ${fremdeNummern.slice(0, 5).join(', ')}`);
  const adressen = [...new Set(s.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || [])];
  const fremdeAdressen = adressen.filter((a) => !/(\.example\.de|@betreuungsbuero-mustermensch\.de)$/i.test(a));
  assert.deepStrictEqual(fremdeAdressen, [], `Nicht-Muster-E-Mails im Vorführpaket: ${fremdeAdressen.slice(0, 5).join(', ')}`);
  assert.ok(rufnummern.length > 3 && adressen.length > 3, 'Die Prüfmuster greifen nicht mehr - Paketform geändert?');
  /* Datenfixes 30.08. (Nutzerentscheid): deutsches Datum in den Rechnungen und EINE Frist
     mit der Kategorie, auf die die Vergütungs-Vorausschau filtert (exakt 'verguetung' -
     kleingeschrieben und ohne Umlaut, wie der Client vergleicht). */
  const rechnungen = paket.buero.invoiceEntries || [];
  assert.ok(rechnungen.length > 5, 'Keine Vorführ-Rechnungen im Paket');
  for (const re of rechnungen) {
    for (const [feld, wert] of [['reDatum', re.reDatum], ['eingangDatum', re.eingangDatum]]) {
      if (!wert) continue;
      assert.ok(!/^\d{4}-\d{2}-\d{2}$/.test(String(wert)), `Rechnung ${re.reNummer}: ${feld} steht im ISO-Format (${wert})`);
    }
  }
  const vergFristen = [];
  (paket.faelle || []).forEach((f) => (((f.state || {}).caseData || {}).fristen || [])
    .forEach((fr) => { if (fr.category === 'verguetung') vergFristen.push(fr.title); }));
  assert.ok(vergFristen.length >= 1, 'Keine Frist mit category "verguetung" - die Vergütungs-Vorausschau bliebe leer');

  /* Nutzerfund 30.08. abends: In der Vorführung standen ALLE Zähler der Kopfzeile auf 0
     („Heute keine Termine"), und Fristen erschienen nie im Kalender-Widget. Ursachen:
     feste Fixture-Daten und fehlende deadline-Einträge in der Aufgabenliste (das Widget
     zeichnet ausschliesslich daraus). Beides wird im Paketbau behoben - hier festgehalten. */
  /* LOKALER Kalendertag, nicht UTC (Fund 31.08.2026 kurz nach Mitternacht): Das Vorführpaket
     verschiebt seine Daten auf den lokalen Tag - und genau den zeigt die Anwendung auch an.
     Mit toISOString() prüfte der Test bis 2 Uhr MESZ gegen den Vortag. */
  const heute = (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
  const inTagen = (n) => { const d = new Date(Date.now() + n * 86400000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const aufg = paket.aufgaben || [];
  const fristenEintraege = aufg.filter((t) => t.itemType === 'deadline');
  assert.ok(fristenEintraege.length >= 30,
    `Nur ${fristenEintraege.length} Fristen in der Aufgabenliste - ohne sie bleibt der Kalender ohne rote Punkte`);
  assert.ok(fristenEintraege.every((t) => t.dueAt && t.caseLabel),
    'Eine gespiegelte Frist hat kein Fälligkeitsdatum oder keinen Fallbezug');
  const heuteFaellig = aufg.filter((t) => String(t.dueAt || '').slice(0, 10) === heute && !t.done);
  assert.ok(heuteFaellig.length >= 5, `Nur ${heuteFaellig.length} heute fällige Einträge - die Kopfzeile bliebe bei 0`);
  /* Jede Kachel der Kopfzeile zählt HEUTE fällige Posten - je Art muss also etwas anliegen,
     sonst steht dort 0, während die Seitenleiste (alle offenen) zweistellig zählt. */
  for (const art of ['deadline', 'task', 'followup']) {
    const n = aufg.filter((t) => t.itemType === art && String(t.dueAt || '').slice(0, 10) === heute && !t.done).length;
    assert.ok(n >= 3, `Nur ${n} heute fällige Einträge der Art ${art} - die zugehörige Kachel bliebe fast leer`);
  }
  const termineHeute = (paket.kalender || []).filter((e) => String(e.startAt || '').slice(0, 10) === heute);
  assert.ok(termineHeute.length >= 4, `Nur ${termineHeute.length} Termine heute - das Widget meldete „Heute keine Termine"`);
  const naechsteWoche = (paket.kalender || []).filter((e) => {
    const d = String(e.startAt || '').slice(0, 10); return d >= heute && d <= inTagen(7);
  });
  assert.ok(naechsteWoche.length >= 10, 'Zu wenig in den kommenden sieben Tagen - die Vorführung wirkt leer');
  /* Der Zeitversatz hält den Bestand aktuell, ohne Stammdaten zu verschieben. */
  assert.ok(typeof paket.versatzTage === 'number', 'Der Zeitversatz fehlt im Paket');
  const gebdaten = (paket.faelle || []).map((f) => ((f.state.caseData || {}).person || {}).birthDate).filter(Boolean);
  /* Geburtsdaten stehen im deutschen Format (TT.MM.JJJJ) - der Versatz greift bewusst nur
     auf ISO-Werte und lässt sie damit unangetastet. */
  assert.ok(gebdaten.length >= 5, 'Geburtsdaten fehlen im Paket');
  assert.ok(gebdaten.every((d) => /^\d{2}\.\d{2}\.(19|20)\d{2}$/.test(String(d))),
    'Ein Geburtsdatum hat nicht mehr die erwartete Form - wurde es vom Versatz erfasst?');
  assert.ok(gebdaten.every((d) => Number(String(d).slice(6)) < 2010),
    'Ein Geburtsdatum wurde mitverschoben - der Versatz darf nur Termine, Aufgaben und Fristen betreffen');

  /* ORTE UND EINRICHTUNGEN der Region (Nutzerentscheid 30.08.: „auch verfremden"). Die
     Fallvorlagen sind aus echten Unterlagen abgeleitet; ohne diese Prüfung deutete die
     Vorführung über Gerichte, Kliniken und Ortsnamen auf das Einzugsgebiet des Büros.
     Bundesweite Kassen und Versicherer bleiben bewusst stehen - sie verraten nichts. */
  for (const ort of ['Koblenz', 'Neuwied', 'Boppard', 'Bingen', 'Bad Ems', 'Lahnstein', 'Montabaur',
    'Diez', 'Nassau', 'Hunsrück', 'Rheinhessen', 'Mittelrhein', 'Kemperhof', 'Wiedblick', 'Severus',
    'Rheinblick', 'Löhrcenter', 'Hüttenberger', 'Bad Kreuznach', 'Ingelheim',
    'Alzey', 'Hildegard', 'Ohlmann', 'Eußerthal', 'Lahnblick']) {
    assert.strictEqual(s.split(ort).length - 1, 0, `Regionale Angabe „${ort}" steckt noch im Vorführpaket`);
  }
  const plz = [...new Set(s.match(/\b\d{5}\b/g) || [])].filter((z) => /^(5[0-6]|65)/.test(z));
  assert.deepStrictEqual(plz, [], `Postleitzahlen der Region im Paket: ${plz.join(', ')}`);
  /* Gegenprobe: die bundesweiten Häuser sollen NICHT wegverfremdet worden sein. */
  assert.ok(/AOK|BARMER|DAK|Debeka|Rentenversicherung/.test(s),
    'Auch die bundesweiten Kassen sind verschwunden - die Vorführung verliert ihre Wiedererkennbarkeit');

  for (const wort of ['Zepp', 'zepp', 'Goarshausen', 'Marktplatz 8', '56346', '29818142', 'betreuungen.', '959410', 'testbueroname']) {
    assert.strictEqual(s.split(wort).length - 1, 0, `Verfremdung unvollständig: „${wort}" steckt noch im Paket`);
  }
});

test('Aufräumen', () => {
  if (server) server.close();
  assert.ok(true);
});
