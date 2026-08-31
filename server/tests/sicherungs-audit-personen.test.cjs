/* Sicherungs-Audit 30.08.2026 (nach dem Personenregister-Umbau): Pins auf die geschlossenen
   Luecken in Excel/CSV/ODS, JSON, Uebergabepaketen, Lokal- und Aussendienstmodus.
   Jeder Test nennt den Fund, den er festnagelt. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');
const src = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

function frischeDb(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  process.env.DB_PATH = path.join(temp, 'test.sqlite3');
  delete require.cache[require.resolve('../src/database/index')];
  for (const k of Object.keys(require.cache)) {
    if (/modules[\\/](office|admin|backup|documents)[\\/]/.test(k)) delete require.cache[k];
  }
  const db = require('../src/database/index');
  t.after(() => { try { db.close(); } catch (_e) {} });
  return db;
}

test('Excel-Rundlauf leert nichts mehr: leere Zellen heißen "keine Angabe"', () => {
  /* Fund (hoch): Export ohne Admin/Klarnamen-Recht -> Spalten E/I/J/K/M/AH/AI leer; der
     Admin-Import schrieb die Leerstrings unbedingt -> Kennung, Notizen, Ein-/Austritt u. a.
     ALLER Konten still geloescht (und via Spiegel auch in persons). */
  assert.ok(html.includes("const nurGefuellt={salutation:e.extra.salutation,mobile:e.extra.mobile,initials:e.extra.initials,maKennung:e.maKennung,joinedAt:e.extra.joinedAt,leftAt:e.extra.leftAt,notes:e.extra.notes,calendarColor:e.extra.calendarColor};"),
    'Der users-PUT des Imports schickt Leerwerte wieder unbedingt');
  assert.ok(html.includes("if(String(nurGefuellt[k]||'').trim())body[k]=nurGefuellt[k];else leerUebersprungen=true;"),
    'Der Leerwert-Filter fehlt');
  assert.ok(html.includes("if(String(e.maKennung||'').trim())body.maKennung=e.maKennung;"),
    'Der employees-Zweig leert Kennungen wieder per Import');
  assert.ok(html.includes('const extraGehalt=e.extra&&(Object.keys(e.extra.rights||{}).length||'),
    'Leere extra-Objekte putzen wieder das gepflegte extra_json weg');
  assert.ok(html.includes('Leere Zellen wurden nicht übernommen'), 'Der Importbericht verschweigt den Leerwert-Schutz');
});

test('Excel-Export trägt die Personen-Profilfelder und das volle extra wieder', () => {
  /* Fund (hoch/mittel): boCollectData warf salutation/mobile/joinedAt/leftAt/notes weg und
     baute extra nur noch als {username} - konto-lose Personen verloren beim Rundlauf ihre
     Konto-Planspalten, und die Profilfelder fehlten in JEDER Excel/CSV/ODS/JSON-Sicherung. */
  assert.ok(html.includes("const extraJeId=new Map(((employees?.employees)||[]).map(e=>[e.id,e.extra||null]));"),
    'Das volle extra_json der Konto-losen reist nicht mehr mit');
  assert.ok(html.includes("phone:p.phone,mobile:p.mobile||'',salutation:p.salutation||'',joinedAt:p.joinedAt||'',"),
    'Die Personen-Profilfelder fehlen im Export-Mapping');
  assert.ok(html.includes("ew(rn,'I',e.mobile||(u?u.mobile:'')||x.mobile||'','text');"),
    'Der Blatt-Füller bevorzugt die Personen-Spalte nicht');
  assert.ok(html.includes('exportHinweis:(!local&&!(usersResp?.users))?'),
    'Der unvollständige Nicht-Admin-Export warnt nicht mehr');
  assert.ok(html.includes('if(data.exportHinweis)warnings.push(data.exportHinweis);'),
    'Die Export-Warnung erreicht den Nutzer nicht');
});

test('Personen-IDs erscheinen nie mehr roh in Dokumenten und Dateinamen', (t) => {
  /* Fund (hoch): Betreuungsantrag/Einverständnis druckten die UUID, der Dateinamen-Baustein
     BETREUER lieferte sie großgeschrieben. Jetzt: EINE Auflösung, unauflösbar -> leer. */
  assert.ok(html.includes('window.__personAnzeigename=function(wert){'), 'Die zentrale Auflösung fehlt');
  assert.ok(html.includes('const stored=window.__personAnzeigename?window.__personAnzeigename(storedRoh):storedRoh;'),
    'Der Betreuungsantrag nutzt die Auflösung nicht');
  assert.ok(html.includes("v['BETREUER']=(bp&&bp.name)||(istId?'':titelFall(bk));"),
    'Der Dateinamen-Baustein fällt wieder auf die rohe UUID zurück');
  /* Serverseite: personAnzeigeName am echten Register gemessen. */
  const db = frischeDb(t);
  db.prepare("INSERT INTO persons (id, art, first_name, last_name) VALUES ('11111111-2222-4333-8444-555555555555','intern','Sabine','Falkner')").run();
  const personen = require('../src/modules/office/persons-routes');
  assert.equal(personen.personAnzeigeName('11111111-2222-4333-8444-555555555555'), 'Sabine Falkner');
  assert.equal(personen.personAnzeigeName('Karim Denizli'), 'Karim Denizli', 'Altwerte müssen unverändert durchlaufen');
  assert.equal(personen.personAnzeigeName('99999999-9999-4999-8999-999999999999'), '', 'Unauflösbare IDs müssen leer werden');
  /* Übergabepaket + Stammdaten-Abbild reichern den Namen an (ID bleibt der Datenwert). */
  assert.ok(src('modules', 'documents', 'routes.js').includes("sd[`${feld}Name`] = name;"),
    'Die Fallübergabe trägt keinen Begleitnamen');
  assert.ok(src('modules', 'documents', 'materializations.js').includes("data[`${feld}Name`] = name;"),
    'Das Stammdaten.xlsx-Abbild trägt keinen Begleitnamen');
  assert.ok(html.includes("if(name&&name!==cd[feld])cd[feld+'Name']=name;"),
    'Die Client-Fall-JSON trägt keinen Begleitnamen');
});

test('Büro-JSON trägt Register + Vertretungsplan/Qualifikationen/Kontaktmonitor; Gesamtimport liest sie', () => {
  /* Funde (mittel): die Büro-JSON eines Nicht-Admins trug weder das Personenregister noch
     vertretungsplan/qualifikationen/kontaktmonitor; der Gesamtimport las die eigene
     Betreuungsorganisation.json NIE ein - das Restore-Gegenstück stellte das Register nicht her. */
  assert.ok(html.includes("Object.assign(data.officeJson,{vertretungsplan:await oj('vertretungsplan'),qualifikationen:await oj('qualifikationen'),kontaktmonitor:await oj('kontaktmonitor')});"),
    'Die drei office_json-Bestände fehlen wieder in der Online-Büro-JSON');
  assert.ok(html.includes("if(pr.ok)data.persons=(await pr.json()).persons||[];"),
    'Das Personenregister fehlt in der Online-Büro-JSON');
  assert.ok(html.includes('data.persons=Array.isArray(L.persons)?L.persons:[];'),
    'Das mitgereiste Register fehlt in der lokalen Büro-JSON');
  assert.ok(html.includes('if(Array.isArray(data.persons)&&data.persons.length)L.persons=data.persons;'),
    'Der Lokal-Import spielt das Register nicht zurück (Whitelist-Trias verletzt)');
  assert.ok(html.includes('async importBueroJsonText(text){'), 'Der faktorisierte JSON-Import-Kern fehlt');
  assert.ok(html.includes('const boJsonName=topNames.find(n=>/(Betreuungsorganisation|Buerverwaltung).*\\.json$/i.test(boBase(n))'),
    'Der Gesamtimport erkennt die Betreuungsorganisation.json nicht');
  assert.ok(html.includes('Personenregister mit den Personen-IDs'), 'WAS-FEHLT.txt verschweigt das Register wieder');
});

test('Finanzen: Lokal-Import behält die Kennung; Kennung-Leeren mit Zuordnung ist gesperrt', async (t) => {
  /* Funde (niedrig/mittel): der Lokalzweig des Finanz-Imports warf Spalte G weg (Außendienst
     verlor die Personalkosten-Anzeige); und wer die Kennung einer zugeordneten Person leerte,
     riss den nächsten Excel-Rundlauf (G leer -> Zuordnung weg). */
  assert.ok(html.includes("...(String(_kennung||'').trim()?{personKennung:String(_kennung).trim()}:{})"),
    'Der lokale Finanz-Import verwirft die Personen-Spalte wieder');
  const db = frischeDb(t);
  const express = require('express');
  const personsRoutes = require('../src/modules/office/persons-routes');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: 1, isAdmin: true }; next(); });
  app.use('/api/persons', personsRoutes);
  const srv = app.listen(0);
  t.after(() => srv.close());
  const basis = `http://127.0.0.1:${srv.address().port}`;
  const ruf = (m, w, b) => fetch(basis + w, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const p1 = await (await ruf('POST', '/api/persons', { firstName: 'Miriam', lastName: 'Osei', kennung: 'MA 4' })).json();
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1,'a','x')").run();
  db.prepare(`INSERT INTO finance_entries (id, kind, posten, person_id, updated_by) VALUES ('f1','ausgabe','Gehalt',?,1)`).run(p1.person.id);
  assert.equal((await ruf('PUT', '/api/persons/' + p1.person.id, { kennung: '' })).status, 409,
    'Die Kennung einer zugeordneten Person ließ sich leeren (Rundlauf-Anker weg)');

  /* Externe mit Fall-/Plan-Verweis: Löschen verlangt erst das Entfernen der Verweise -
     sonst bliebe eine tote UUID in jeder künftigen Sicherung. */
  const ext = await (await ruf('POST', '/api/persons', { lastName: 'RA Hofmann', art: 'extern' })).json();
  db.prepare("INSERT INTO cases (id, label, stammdaten_json) VALUES ('c1','Fall', ?)").run(JSON.stringify({ vertretung: ext.person.id }));
  assert.equal((await ruf('DELETE', '/api/persons/' + ext.person.id)).status, 409, 'Externe mit Fallverweis ließ sich löschen');
  db.prepare("UPDATE cases SET stammdaten_json = '{}' WHERE id = 'c1'").run();
  assert.equal((await ruf('DELETE', '/api/persons/' + ext.person.id)).status, 200, 'Externe ohne Verweis muss löschbar bleiben');
});

test('Server-Restore: eine kaputte persons-Zeile kippt nicht mehr den ganzen Restore', () => {
  /* Fund (mittel): Sicherungen von vor einer Nutzerlöschung (persons.user_id -> gelöschter
     User, FK) oder Kennung-Umvergabe (UNIQUE) liefen in den Voll-Rollback. Jetzt wird die
     Zeile entschärft (Verknüpfung/Kennung weg, Person bleibt) und im Bericht gezählt. */
  const pd = src('modules', 'backup', 'portable-data.js');
  const block = pd.slice(pd.indexOf("if (table === 'persons') {"), pd.indexOf('const params = {};'));
  assert.ok(block.includes("addSkip(report, 'person_konto_fehlt_verknuepfung_geloest');"), 'FK-Entschärfung fehlt');
  assert.ok(block.includes("addSkip(report, 'person_konto_anderweitig_verknuepft');"), 'user_id-UNIQUE-Entschärfung fehlt');
  assert.ok(block.includes("addSkip(report, 'person_kennung_anderweitig_vergeben');"), 'Kennung-UNIQUE-Entschärfung fehlt');
});

test('Außendienst: Zweitschrift stellt alle vier Teile wieder her, Büro-Kontakte reisen im Diff', () => {
  /* Funde (hoch): der Zweitschrift-Restore übernahm nur registry+bueroLocal - Termine,
     Aufgaben und Offline-Postausgang der Vorsitzung waren nach einem Absturz stumm weg.
     Büro-Kontakte fehlten in Zweitschrift UND Rückgabe-Diff komplett. */
  assert.ok(html.includes('var lsAlt=alt.localStorage||{};'), 'Der Restore stellt die localStorage-Keys nicht wieder her');
  assert.ok(html.includes('mdA.postausgang=alt.mail.postausgang||[];'), 'Der Restore stellt den Offline-Postausgang nicht wieder her');
  assert.ok(html.includes("return !(e&&e.__ad);}).concat(alt.mail.entwuerfe||[]);"), 'Unterwegs-Entwürfe kommen nicht zurück');
  assert.ok(html.includes("'betreuungsbuero.bueroAdress.v1'];"), 'Büro-Kontakte fehlen in der Zweitschrift');
  /* 30.08. nachmittags ausgebaut: aus dem reinen Mitreisen wurde der automatische
     Rückschreibweg (applyBueroKontakte) - der Diff liest jetzt den NORMALISIERTEN Bestand
     (Array vom Hinweg ODER {contacts,merges} von baSave), Pins dazu in
     rollen-vorlagen-kontaktsync.test.cjs. */
  assert.ok(html.includes('root.bueroKontakte=knorm.contacts;'),
    'Büro-Kontakte fehlen im Rückgabe-Diff (Arbeit verschwände stumm)');
});
