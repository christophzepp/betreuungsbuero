'use strict';

/* Pruefstand fuer die drei Module vom 25.08.2026:
     - Vertretung (je Fall in der Datenadministration + je Person im Admin-Panel)
     - Aufbewahrungsfrist im Fallabschluss (Hinweis + an-/abschaltbarer Kalendereintrag)
     - Verarbeitungs-Log (bueroweites Protokoll jeder Aenderung und jeder Weitergabe)
   Die Middleware wird mit synthetischen Anfragen AUSGEFUEHRT, nicht nur gegrept. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);
const lies = (...teile) => fs.readFileSync(path.join(__dirname, '..', ...teile), 'utf8');

/* ─────────────────────────── Vertretung ─────────────────────────── */

test('Vertretung: Spalte in der Falltabelle, beide Aufrufer bedient', () => {
  assert.ok(html.includes('data-vt-case='), 'Auswahlfeld fehlt in der Falltabelle');
  assert.ok(html.includes('window.__caseSetVertretung'), 'Speicher-Handler fehlt');
  assert.match(html, /<th title="Wer vertritt bei Abwesenheit[^"]*">Vertretung<\/th>/, 'Kopfzelle fehlt');
  /* Die Leerzeile muss die neue Spalte mitzaehlen, sonst rutscht sie aus der Tabelle. */
  /* 29.08.: +1 durch die Spalte „Zuletzt bearbeitet" (Zusammenfuehrung der Falllisten). */
  assert.ok(html.includes('colspan="${canManage?10:9}"'), 'colspan der Leerzeile nicht nachgezogen');
  /* Datenadministration (Modal) und Admin-Panel teilen dasselbe Markup -> eine Fuellung genuegt. */
  assert.ok(html.includes("select.da-vt[data-vt-case]"), 'Fuellung spricht die Vertretungsspalte nicht an');
  assert.ok(html.includes('nachziehen(\'select.da-vt[data-vt-case]\',\'data-vt-case\',assignVt)'),
    'Zuweisungen der Vertretung werden nicht nachgezogen');
});

test('Vertretung: reine Angabe - vergibt keine Zugriffsrechte', () => {
  const i = html.indexOf('window.__caseSetVertretung=async function');
  /* 30.08. Demo-Vollausbau: vor dem PATCH steht jetzt der RAM-Zweig der Vorführung -
     das Fenster muss den Server-Zweig weiterhin einschließen. */
  const block = html.slice(i, i + 3400);
  assert.ok(/patches:\[\{path:'vertretung'/.test(block), 'speichert nicht als Stammdatenfeld');
  assert.ok(!/case_access|canViewCases|grantAccess/.test(block), 'fasst Zugriffsrechte an');
  assert.ok(html.includes('vergibt bewusst KEINE Zugriffsrechte'), 'Absicht nicht dokumentiert');
});

test('Vertretung: Vertretungsplan je Person ist als Admin-Tab verdrahtet', () => {
  assert.ok(html.includes("['vertretung','Vertretung']"), 'Nav-Eintrag fehlt');
  assert.ok(html.includes("activeTab==='vertretung'"), 'renderActiveTab-Zweig fehlt');
  assert.ok(html.includes('async function renderVertretungTab(body)'), 'Renderer fehlt');
  assert.ok(html.includes('window.__vertretungsplanAktiv'), 'Abfrage der laufenden Vertretungen fehlt');
  /* Serverablage freigeschaltet und schreibgeschuetzt wie custom_forms */
  const jsonRoutes = lies('src', 'modules', 'office', 'json-routes.js');
  assert.match(jsonRoutes, /const KEYS = new Set\(\[[^\]]*'vertretungsplan'/, 'Whitelist-Eintrag fehlt');
  assert.ok(jsonRoutes.includes("req.params.key === 'vertretungsplan'"), 'Schreibrecht nicht gesetzt');
});

/* ─────────────────────── Aufbewahrung im Fallabschluss ─────────────────────── */

test('Aufbewahrung: Schalter, Jahre und Zieldatum im Fallabschluss', () => {
  assert.ok(html.includes('id="coRetCal"'), 'Schalter fehlt');
  assert.ok(html.includes('window.__coRetToggle'), 'Umschalter fehlt');
  assert.ok(html.includes('window.__coRetYears'), 'Jahres-Einsteller fehlt');
  assert.ok(html.includes('function coRetZiel()'), 'Berechnung des Zieldatums fehlt');
  /* Zwischenstand: ohne Whitelist-Eintrag ueberlebt der Schalter kein Speichern des Entwurfs. */
  assert.ok(html.includes('retCal:CO.retCal!==false'), 'Schalter fehlt in der Entwurfs-Whitelist');
  assert.ok(html.includes("CO.retCal=st.retCal!==false"), 'Schalter wird beim Fortsetzen nicht gelesen');
  assert.ok(html.includes('CO.retCal=true;CO.retYears=10;CO.retEventId='), 'kein Zuruecksetzen beim Oeffnen');
});

test('Aufbewahrung: Termin entsteht erst beim Uebernehmen, nur einmal', () => {
  assert.ok(html.includes('async function coRetTerminAnlegen()'), 'Anlage-Funktion fehlt');
  assert.ok(html.includes("if(CO.retEventId)return 'Der Aufbewahrungs-Termin war bereits vorgemerkt.'"),
    'kein Schutz gegen doppelte Termine');
  assert.ok(html.includes('window.__calCreateItem'), 'nutzt nicht den vorhandenen Kalenderweg');
  /* Angelegt wird im Uebernehmen-Schritt - nicht beim blossen Anzeigen des Schritts. */
  const i = html.indexOf('window.__coApplyEnd=async function()');
  assert.ok(i > 0, 'coApplyEnd nicht mehr async');
  assert.ok(html.slice(i, i + 900).includes('coRetTerminAnlegen()'), 'Termin wird beim Uebernehmen nicht angelegt');
  assert.ok(html.includes('await window.__coApplyEnd();'), 'Archivieren wartet nicht auf das Uebernehmen');
});

test('Aufbewahrung: Zieldatum rechnet 10 Jahre ab Betreuungsende', () => {
  /* Dieselbe Rechnung wie coRetZiel, isoliert nachgestellt. */
  const ziel = (endDate, jahre) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate) || /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(endDate);
    if (!m) return null;
    const iso = m[0].includes('.') ? `${m[3]}-${m[2]}-${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(`${iso}T09:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    d.setFullYear(d.getFullYear() + jahre);
    const z = (n) => String(n).padStart(2, '0');
    return `${z(d.getDate())}.${z(d.getMonth() + 1)}.${d.getFullYear()}`;
  };
  assert.equal(ziel('2026-08-25', 10), '25.08.2036');
  assert.equal(ziel('25.08.2026', 10), '25.08.2036', 'deutsches Datum muss ebenso gehen');
  assert.equal(ziel('', 10), null, 'ohne Betreuungsende kein Termin');
});

/* ─────────────────────────── Verarbeitungs-Log ─────────────────────────── */

test('Verarbeitungs-Log: Schema, Indizes und Sicherungs-Einordnung', () => {
  const dbSrc = lies('src', 'database', 'index.js');
  for (const spalte of ['case_id', 'kategorie', 'zweck', 'empfaenger', 'kanal']) {
    assert.ok(dbSrc.includes(`addColumnIfMissing('audit_log', '${spalte}'`), `Spalte ${spalte} fehlt`);
  }
  assert.ok(dbSrc.includes('idx_audit_log_created'), 'Index auf created_at fehlt');
  /* Mit case_id-Spalte verlangt der Sicherungs-Pruefstand eine Fall-Einordnung. */
  const backupSrc = lies('src', 'modules', 'backup', 'portable-data.js');
  assert.match(backupSrc, /table: 'audit_log'[\s\S]{0,600}?caseExcludedReason/,
    'audit_log ist nicht als fallausgeschlossen begruendet');
});

test('Verarbeitungs-Log: Middleware ordnet Aktionen korrekt ein (ausgefuehrt)', () => {
  /* Eigene Datenbank im Temp-Verzeichnis, damit der Test nichts Fremdes beschreibt. */
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'vlog-test-'));
  const alterRoot = process.env.RUNTIME_ROOT;
  process.env.RUNTIME_ROOT = runtime;
  /* Frische Modulinstanzen erzwingen (Datenbank haengt am Pfad). */
  for (const key of Object.keys(require.cache)) {
    if (key.includes(path.join('server', 'src'))) delete require.cache[key];
  }
  try {
    const { verarbeitungsLog } = require('../src/middleware/audit');
    const db = require('../src/database');
    const mw = verarbeitungsLog();
    const lauf = (method, url, body, status) => {
      const handlers = {};
      const req = { method, originalUrl: url, url, body: body || {}, session: { userId: 1, displayName: 'Pruefstand' } };
      const res = { statusCode: status || 200, on: (ev, fn) => { handlers[ev] = fn; } };
      mw(req, res, () => { if (handlers.finish) handlers.finish(); });
    };
    const vorher = db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
    lauf('PATCH', '/api/cases/de300002-0000-4000-8000-000000000002/stammdaten', {});
    lauf('POST', '/api/mailx/send', { to: 'gericht@example.de' });
    lauf('DELETE', '/api/documents/abc', {});
    lauf('POST', '/api/invoices', {});
    lauf('GET', '/api/cases/xyz', {});                    // Lesezugriff: bewusst nicht protokolliert
    lauf('POST', '/api/cases/xyz/stammdaten', {}, 403);   // abgewiesen: kein Verarbeitungsvorgang
    const neu = db.prepare('SELECT action, kategorie, zweck, kanal, case_id, empfaenger FROM audit_log ORDER BY id')
      .all().slice(vorher);
    assert.equal(neu.length, 4, 'Lesezugriff oder abgewiesene Anfrage wurden protokolliert');

    const stammdaten = neu[0];
    assert.equal(stammdaten.kategorie, 'aenderung');
    assert.equal(stammdaten.zweck, 'betreuungsfuehrung');
    assert.equal(stammdaten.case_id, 'de300002-0000-4000-8000-000000000002', 'Fallbezug nicht erkannt');

    const mail = neu[1];
    assert.equal(mail.kategorie, 'offenlegung', 'Weitergabe nicht als Offenlegung erfasst');
    assert.equal(mail.kanal, 'mail');
    assert.equal(mail.empfaenger, 'gericht@example.de');
    assert.equal(mail.zweck, 'betreuungsfuehrung');

    assert.equal(neu[2].kategorie, 'loeschung', 'DELETE nicht als Loeschung erfasst');
    assert.equal(neu[3].zweck, 'abrechnung', 'Rechnungswesen falsch eingeordnet');

    /* Der Inhalt der Aenderung darf NIE im Protokoll landen - erlaubt ist nur der
       Entprellungs-Vermerk der laufenden Fallbearbeitung. */
    const erlaubt = new Set(['{}', '{"entprellt":"ein Eintrag je Stunde"}']);
    const details = db.prepare('SELECT details_json FROM audit_log ORDER BY id DESC LIMIT 4').all();
    details.forEach((d) => assert.ok(erlaubt.has(d.details_json), 'Middleware speichert Koerperinhalte: ' + d.details_json));

    /* Entprellung: ein zweiter Autosave-Takt derselben Route darf KEINE zweite Zeile erzeugen. */
    const vorEntprellung = db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
    lauf('PATCH', '/api/cases/de300002-0000-4000-8000-000000000002/stammdaten', {});
    lauf('PATCH', '/api/cases/de300002-0000-4000-8000-000000000002/stammdaten', {});
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c, vorEntprellung,
      'Autosave-Takt wird nicht entprellt - das Log wuerde geflutet');

    /* Akteur auch ohne Sitzung: die Browser-Erweiterung schreibt mit req.extUser. */
    const vorExt = db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
    const handlers = {};
    const reqExt = { method: 'POST', originalUrl: '/api/ext/todos', url: '/api/ext/todos', body: {},
      extUser: { id: 7, username: 'erweiterung' } };
    mw(reqExt, { statusCode: 200, on: (ev, fn) => { handlers[ev] = fn; }, end() {} }, () => { handlers.finish(); });
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c, vorExt + 1,
      'Schreibvorgang der Erweiterung wurde nicht protokolliert');
  } finally {
    for (const key of Object.keys(require.cache)) {
      if (key.includes(path.join('server', 'src'))) delete require.cache[key];
    }
    if (alterRoot === undefined) delete process.env.RUNTIME_ROOT; else process.env.RUNTIME_ROOT = alterRoot;
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});

test('Verarbeitungs-Log: Anmeldungen werden protokolliert, Doppelschreiben verhindert', () => {
  const auth = lies('src', 'modules', 'auth', 'routes.js');
  assert.ok(auth.includes("'auth.login'"), 'erfolgreiche Anmeldung fehlt');
  assert.ok(auth.includes("'auth.login_failed'"), 'Fehlversuch fehlt');
  assert.ok(auth.includes("'auth.logout'"), 'Abmeldung fehlt');
  const audit = lies('src', 'middleware', 'audit.js');
  assert.ok(audit.includes('req.__auditGeschrieben = true'), 'kein Schutz gegen doppelte Eintraege');
  assert.ok(audit.includes('if (req.__auditGeschrieben) return;'), 'Middleware prueft den Schutz nicht');
  const index = lies('index.js');
  assert.ok(index.includes("verarbeitungsLog()"), 'Middleware nicht eingehaengt');
});

test('Verarbeitungs-Log: Admin-Ansicht filtert und zeigt die neuen Merkmale', () => {
  const adminSrc = lies('src', 'modules', 'admin', 'routes.js');
  for (const f of ['von', 'bis', 'nutzer', 'kategorie', 'fall', 'suche']) {
    assert.ok(adminSrc.includes(`req.query.${f}`), `Filter ${f} fehlt in der Route`);
  }
  assert.ok(adminSrc.includes('gesamt'), 'Gesamtzahl fehlt in der Antwort');
  assert.ok(html.includes('window.__auditFilterSetzen'), 'Filterleiste fehlt in der Oberflaeche');
  assert.ok(html.includes('Verarbeitungs-Log'), 'Ueberschrift fehlt');
  assert.ok(html.includes('Lesezugriffe werden bewusst nicht protokolliert'), 'Grenze nicht benannt');
});

/* ─── Nachtrag: die Befunde der adversarialen Review (25.08.2026) ─── */

test('Review-Fix: Aufbewahrungs-Termin traegt Fallbezug und wandert nicht nach aussen', () => {
  const i = html.indexOf('async function coRetTerminAnlegen()');
  const block = html.slice(i, i + 2400);
  /* Ohne caseId gilt ein Termin serverseitig als Bueroorganisation und ist fuer JEDEN Nutzer mit
     Fall-Sichtrecht lesbar - samt Klarnamen der betreuten Person. */
  assert.ok(block.includes('caseId:fallId'), 'Termin ohne Fallbezug - waere bueroweit sichtbar');
  assert.ok(block.includes("connectionId:'local'"), 'Termin wuerde ungefragt nach aussen gespiegelt');
  assert.ok(block.includes("window.__appMode==='online'&&!fallId"), 'kein Abbruch ohne eindeutige Fall-ID');
  /* Ganztags-Konvention: Ende am Folgetag 00:00, sonst DTEND==DTSTART im ICS/CalDAV. */
  assert.ok(block.includes("ziel.next+'T00:00:00'"), 'Ganztags-Ende verletzt die Konvention');
});

test('Review-Fix: Aenderung nach dem Anlegen nimmt den alten Termin zurueck', () => {
  assert.ok(html.includes('async function coRetTerminWeg()'), 'Ruecknahme fehlt');
  assert.ok(html.includes('window.__calRemoveItem'), 'Kalender-Loeschweg nicht exportiert');
  assert.ok(html.includes('if(neu!==CO.retYears)await coRetTerminWeg();'), 'Jahreswechsel zieht den Termin nicht nach');
  assert.ok(html.includes('if(!an)await coRetTerminWeg();'), 'Abschalten entfernt den Termin nicht');
});

test('Review-Fix: Betreuungsende wandert korrekt zwischen deutschem und ISO-Format', () => {
  assert.ok(html.includes('function coIsoDate(wert)'), 'DE->ISO-Helfer fehlt');
  assert.ok(html.includes('coIsoDate((cd().care&&cd().care.endDate)'), 'importiertes Enddatum wird nicht angezeigt');
  assert.ok(html.includes('c.care.endDate=coDeDate(CO.endDate)'), 'ISO wuerde in ein deutsches Feld zurueckgeschrieben');
});

test('Review-Fix: groesste Weitergabe (Fallübergabe-ZIP) wird protokolliert', () => {
  const docs = lies('src', 'modules', 'documents', 'routes.js');
  assert.ok(docs.includes("'case.handover_zip'"), 'Fallübergabe-Paket bleibt unprotokolliert');
  assert.match(docs, /case\.handover_zip[\s\S]{0,300}kategorie: 'offenlegung'/, 'nicht als Weitergabe eingeordnet');
  assert.ok(!/handover_zip[\s\S]{0,300}(inhalt|content|body:)/i.test(docs), 'Protokoll wuerde Inhalte tragen');
});

test('Review-Fix: Auth-Vorgaenge und fremde Zugangswege sind erfasst', () => {
  const auth = lies('src', 'modules', 'auth', 'routes.js');
  assert.ok(auth.includes("'auth.password_changed'"), 'Passwortwechsel fehlt');
  assert.ok(auth.includes("'auth.mode_switched'"), 'Moduswechsel fehlt');
  const audit = lies('src', 'middleware', 'audit.js');
  assert.ok(audit.includes('function akteur(req)'), 'Akteur wird nur aus der Sitzung gelesen');
  assert.ok(audit.includes('req.extUser'), 'Erweiterung bliebe unprotokolliert');
  /* Rueckfallebene: die 54 Altaufrufe bekommen ihre Kategorie/Zweck jetzt zentral. */
  assert.ok(audit.includes('const v = verarbeitung || ableiten(req);'), 'Altaufrufe blieben ohne Kategorie');
});

test('Review-Fix: CSV-Export folgt dem Filter und traegt die Verarbeitungs-Merkmale', () => {
  const i = html.indexOf('async function exportAuditLog()');
  const block = html.slice(i, i + 1600);
  assert.ok(block.includes('auditAbfrage()'), 'Export ignoriert den gesetzten Filter');
  for (const spalte of ['Kategorie', 'Zweck', 'Fall', 'Kanal', 'Empfänger']) {
    assert.ok(block.includes(`'${spalte}'`), `Spalte ${spalte} fehlt im Export`);
  }
});

test('Review-Fix: Zeitfilter rechnet Ortszeit nach UTC, Vertretungsplan nutzt Ortszeit', () => {
  const adminSrc = lies('src', 'modules', 'admin', 'routes.js');
  assert.ok(adminSrc.includes("datetime(?, 'utc')"), 'Filtergrenzen vergleichen Ortszeit gegen UTC');
  assert.ok(html.includes('function vertretungHeute()'), 'Vertretungsplan rechnet weiter in UTC');
  /* Nur den Vertretungs-Bereich pruefen - andere Module haben eigene, hier nicht betroffene Stellen. */
  const vi = html.indexOf('let vertretungStand=');
  const vBlock = html.slice(vi, html.indexOf('async function renderDataAdminTab', vi));
  assert.ok(!vBlock.includes("new Date().toISOString().slice(0,10)"), 'UTC-Rest im Vertretungsplan');
  assert.ok((vBlock.match(/vertretungHeute\(\)/g) || []).length >= 2, 'Ortszeit-Helfer nicht ueberall genutzt');
});

test('Vertretung: auch externe Personen können vertreten (29.08.2026)', () => {
  /* Nutzerwunsch: „Auch externe Betreuer können Vertretungen übernehmen". Seit Etappe 2 sind
     Externe regulÄre REGISTER-Personen (art extern) - Plan und Fallfelder speichern ihre
     Personen-ID; das kurzlebige 'extern:'-Präfix vom Vormittag ist restlos raus (die
     Servermigration schreibt Altwerte um, siehe eigener Test). */
  assert.ok(!html.includes("VT_EXTERN") && !html.includes('vtExternName'),
    'Das abgelöste extern:-Präfix lebt noch im Client');

  /* UI: die Wahl „Externe Person …" NUR bei „Vertreten durch" - abwesend sein kann nur eine
     eigene Person, der Plan verwaltet die Abwesenheiten DIESES Büros. */
  assert.ok(html.includes("auswahl('vertretung','','— Vertretung wählen —',true)"),
    'Die Vertretungs-Auswahl bietet keine externe Person an');
  assert.ok(!html.includes("auswahl('person','','— Person wählen —',true)"),
    'Die Abwesend-Auswahl bietet externe Personen an');

  /* Das Namensfeld ist ein eigenes Reihen-Feld, erscheint erst mit der Wahl, und Eintragen
     legt die Person im REGISTER an (deren ID wird der Planwert). */
  assert.ok(html.includes('data-vtfeld-extern-wrap') && html.includes('window.__vertretungExternUmschalten'),
    'Das ein-/ausblendbare Namensfeld fehlt');
  assert.ok(html.includes("if(!name){toast('Bitte den Namen der externen Person angeben.');return}")
    && html.includes('const neuePerson=await window.__personExternAnlegen(name);')
    && html.includes('vertretung=neuePerson.id;'),
    'Eintragen legt keine Register-Person an bzw. speichert nicht deren ID');

  /* Beide Leser zeigen Externe am art-Kennzeichen: die Plan-Tabelle und der „laut Plan"-
     Hinweis der Datenadministration. */
  assert.ok(html.includes("return p.name+(p.art==='extern'?' (extern)':(p.maKennung?' ('+p.maKennung+')':''));"),
    'Die Leser kennzeichnen Externe nicht mehr');
});


test('Vertretung: EINE Seite für beides – Abschnitte statt Doppel-Überschrift, Je-Fall-Karte geteilt', () => {
  /* Nutzerentscheidungen 29.08.2026 (abgefragt): „Seite ergänzen, Spalte bleibt" und
     „Externe auch je Fall". Dazu der Nutzerfund „Die doppelte Überschrift ist nicht notwendig":
     eingebettet trägt die SEITE Titel und Hauptsatz - im Baustein stehen nur noch die zwei
     Abschnittstitel „Bei Abwesenheit" und „Je Fall". */
  assert.ok(html.includes("const eingebettet=!!(body.closest&&body.closest('.set-einbett'));")
    && html.includes(">Bei Abwesenheit</h3>") === false, 'Abschnittsbau fehlt');
  assert.ok(html.includes("abschnitt('Bei Abwesenheit'") && html.includes("abschnitt('Je Fall'"),
    'Die zwei Abschnitte fehlen');
  assert.ok(!html.includes('<h3 style="margin:0;color:var(--blue);font-size:16px">Vertretung bei Abwesenheit</h3>'),
    'Die alte Voll-Überschrift doppelt wieder mit dem Seitentitel');
  assert.ok(html.includes("unter:'Wer vertritt wen — nach Zeitraum bei Abwesenheit und dauerhaft je Fall.'"),
    'Der Seiten-Untertitel deckt die Je-Fall-Karte nicht ab');

  /* Die Je-Fall-Tabelle nutzt WÖRTLICH dieselben Auswahlfelder wie die Datenadministration
     (select.da-rb/.da-vt samt data-Attributen): __caseAdminFillBetreuer füllt sie,
     __caseSetBetreuer/__caseSetVertretung speichern - geteilter Code, kann nicht
     auseinanderlaufen. Am Prüfstand: Eintrag je Fall erscheint wortgleich in beiden Tabellen. */
  /* Endanker mit '=async': der blosse Funktionsname steht als onclick/onchange-Text schon im
     Formular-Markup INNERHALB des Tabs und wuerde den Ausschnitt nach 1000 Zeichen kappen. */
  const tab = html.slice(html.indexOf('async function renderVertretungTab(body)'),
    html.indexOf('window.__vertretungNeu=async function'));
  assert.ok(tab.includes('select class="da-rb" data-rb-case=') && tab.includes('select class="da-vt" data-vt-case='),
    'Die Je-Fall-Karte baut eigene statt der geteilten Auswahlfelder');
  assert.ok(tab.includes('if(window.__caseAdminFillBetreuer)window.__caseAdminFillBetreuer()'),
    'Die Je-Fall-Auswahlen blieben auf „— lädt …" stehen');

  /* Externe je Fall: die Wahl öffnet ein Namensfeld IN der Zelle (Enter übernimmt, Escape
     bricht ab und fällt auf den Merker zurück); gespeichert wird dasselbe extern:-Präfix.
     Am Prüfstand: Escape → „— ohne —", Enter → Stammdaten 'extern:RA Dr. Hofmann, Mainz'. */
  assert.ok(html.includes("if(val==='__extern__'){if(el)caseVertretungExternFragen(caseId,el);return;}"),
    'Die Fall-Vertretung kennt die Externe-Person-Wahl nicht');
  assert.ok(html.includes('function caseVertretungExternFragen(caseId,sel)') && html.includes("sel.value=sel.dataset.vorher||'';"),
    'Abbruch fällt nicht auf den vorherigen Wert zurück');
  /* Etappe 2: gespeicherte Werte sind Personen-IDs. Fehlt die Option (deaktiviert/gelöscht),
     kommt der Klarname aus der VOLLEN Personenliste - nie eine rohe ID in der Auswahl.
     Sicherungs-Audit 30.08.2026: das Label heißt jetzt neutral "Unbekannte Person (nicht im
     Register)" - "entfernt" war bei importierten Fällen aus fremden Installationen schlicht
     falsch (die Person war nie da). */
  assert.ok(html.includes("var bekannt=persons.find(function(p){return p.key===cur;});")
    && html.includes("'Unbekannte Person (nicht im Register)'"),
    'Gespeicherte Personen-IDs erscheinen roh statt als Klarname');
});

test('Externe Personen: das Register speist alle Auswahlen – Blob-Verzeichnis und Präfix sind raus', () => {
  /* Etappe 2 (29.08.2026 abends): Das Vormittags-Verzeichnis vertretungsplan.externe[] ist im
     Personenregister aufgegangen. EINE Quelle (art extern) für Plan-Formular, Je-Fall-Karte
     und Datenadministrations-Spalte; gelöscht wird im Bereich Personen (dort sind Externe
     löschbar, siehe personen-register.test). */
  assert.ok(html.includes("function vertretungLeer(){return {version:1,eintraege:[]}}"),
    'Der Plan-Leerstand trägt wieder ein eigenes Externen-Verzeichnis');
  assert.ok(!html.includes('vertretungStand.externe'),
    'Der Client liest wieder aus dem abgelösten Blob-Verzeichnis');
  assert.ok(html.includes('window.__personExternAnlegen=async function(name)'),
    'Die gemeinsame Register-Anlage für Externe fehlt');
  /* Beide Anlagewege nutzen das Register: Plan-Formular über den Helfer, die Fallzelle direkt
     (sie lebt in einem anderen Block und POSTet selbst - gleiche Route, gleiche Wirkung). */
  assert.ok(html.includes('const neuePerson=await window.__personExternAnlegen(name);'),
    'Das Plan-Formular legt Externe nicht im Register an');
  assert.ok(html.includes("body:JSON.stringify({lastName:name,art:'extern'})"),
    'Die Fallzellen-Anlage legt Externe nicht im Register an');

  /* Die Auswahl-Gruppen kommen aus der Personenliste (aktiv, art extern) - in der
     Datenadministration UND im Plan-Formular. */
  assert.ok(html.includes("var externe=waehlbar.filter(function(p){return p.art==='extern';});"),
    'Die Fall-Auswahlen bauen die Externen-Gruppe nicht aus dem Register');
  assert.ok(html.includes("const externe=personen.filter(p=>p.aktiv!==false&&p.art==='extern');"),
    'Das Plan-Formular baut die Externen-Gruppe nicht aus dem Register');
});

