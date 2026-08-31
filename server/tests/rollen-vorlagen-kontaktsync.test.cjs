/* 30.08.2026: (1) Rollen-Vorlagenkatalog im Einstellungsmenü (typische Betreuungsbüro-Rollen
   mit fertigen Rechte-Schablonen, Übernahme als normale bearbeitbare Rolle) und
   (2) automatischer Rückschreibweg für Büro-Kontakte aus dem Außendienst. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

const os = require('node:os');
function frischeDb(t) {
  const temp = process.env.__AUDIT_TEMP || fs.mkdtempSync(path.join(os.tmpdir(), 'rollen-'));
  process.env.__AUDIT_TEMP = temp;
  t.after(() => { delete process.env.__AUDIT_TEMP; fs.rmSync(temp, { recursive: true, force: true }); });
  process.env.DB_PATH = path.join(temp, 'test.sqlite3');
  delete require.cache[require.resolve('../src/database/index')];
  for (const k of Object.keys(require.cache)) {
    if (/modules[\\/](office|admin)[\\/]/.test(k)) delete require.cache[k];
  }
  return require('../src/database/index');
}

function schnipsel(von, bis) {
  const i = html.indexOf(von);
  assert.ok(i >= 0, 'Anker nicht gefunden: ' + von.slice(0, 60));
  const j = html.indexOf(bis, i);
  assert.ok(j > i, 'End-Anker nicht gefunden: ' + bis.slice(0, 60));
  return html.slice(i, j);
}

test('Rollen-Vorlagen: 8 Rollen, jede an-Liste besteht nur aus ECHTEN Rechte-Keys', () => {
  /* Der Katalog wird im vm ECHT ausgeführt - ein Tippfehler in einer Key-Liste wäre sonst
     eine stille Niete (das Recht bliebe einfach false). */
  const colsSrc = schnipsel('const BO_RIGHT_COLS=[', '];') + '];';
  const katalogSrc = schnipsel('const EIN_ROLLEN_BASIS=', 'function einSeiteRollen(){');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(colsSrc + '\nwindow.__alleRechteKeys=BO_RIGHT_COLS.map(x=>x[1]);\n' + katalogSrc
    + '\nthis.__vorlagen=EIN_ROLLEN_VORLAGEN;\nthis.__matrix=einVorlagenMatrix;', ctx);
  const keys = new Set(ctx.window.__alleRechteKeys);
  assert.equal(keys.size, 83, 'Der Rechte-Katalog hat nicht mehr 83 Einträge');
  const vorlagen = ctx.__vorlagen;
  assert.equal(vorlagen.length, 9, 'Es sollen 9 Vorlagen sein');
  const namen = vorlagen.map((v) => v.name);
  for (const n of ['Büroleitung / Inhaber:in', 'Betreuer:in (Fallführung)', 'Betreuungsassistenz / Verwaltung',
    'Buchhaltung / Vergütung', 'Auszubildende / Praktikum', 'Studentische Hilfskraft (HIWI)',
    'Verhinderungsbetreuung (extern)', 'Datenschutz (intern/extern)', 'IT-Administration']) {
    assert.ok(namen.includes(n), 'Vorlage fehlt: ' + n);
  }
  for (const v of vorlagen) {
    assert.ok(String(v.beschreibung || '').length > 40, 'Beschreibung zu dünn: ' + v.name);
    if (v.an === '*') continue;
    for (const k of v.an) assert.ok(keys.has(k), `Vorlage „${v.name}“ nennt unbekanntes Recht: ${k}`);
  }
  /* Matrixbau: vollständige 2-Zweige-Matrix (einMatrixVollstaendig verlangt ≥60 je Zweig). */
  const m = ctx.__matrix(vorlagen.find((v) => v.name === 'Datenschutz (intern/extern)').an);
  assert.equal(Object.keys(m.local).length, 83);
  assert.equal(Object.keys(m.online).length, 83);
  assert.equal(m.online.viewAuditLog, true);
  assert.equal(m.online.viewFinance, false, 'Datenschutz darf keine Bürofinanzen sehen');
  assert.equal(m.online.viewCases, false, 'Datenschutz hat keinen laufenden Falldaten-Zugriff');
  const alle = ctx.__matrix('*');
  assert.ok(Object.values(alle.online).every(Boolean), 'Die Leitungs-Vorlage muss Vollzugriff tragen');
  /* Fachliche Kernabgrenzungen (BtOG/DSGVO-recherchiert): */
  const b = ctx.__matrix(vorlagen.find((v) => v.name === 'Betreuer:in (Fallführung)').an).online;
  assert.ok(b.viewCases && b.editCases && b.useFieldService && !b.viewFinance && !b.financePersonNames && !b.viewAllCases,
    'Fallführung: volle Fallarbeit, aber keine Bürofinanzen/Klarnamen und kein Alle-Fälle-Recht');
  const bu = ctx.__matrix(vorlagen.find((v) => v.name === 'Buchhaltung / Vergütung').an).online;
  assert.ok(bu.viewFinance && bu.editFinance && bu.financePersonNames && bu.viewControlling && !bu.editCases,
    'Buchhaltung: Finanzen samt Klarnamen, aber keine Fallbearbeitung');
  const azubi = ctx.__matrix(vorlagen.find((v) => v.name === 'Auszubildende / Praktikum').an).online;
  assert.ok(azubi.viewCases && !azubi.editCases && !azubi.sendMail && !azubi.menuCaseFileHealth && !azubi.initiatePayments,
    'Auszubildende: nur lesend, ohne Gesundheitsbereich, Außenkommunikation und Zahlungen');
  const hiwi = ctx.__matrix(vorlagen.find((v) => v.name === 'Studentische Hilfskraft (HIWI)').an).online;
  assert.ok(hiwi.viewCases && hiwi.editDocuments && hiwi.useAi && hiwi.menuFileExplorer,
    'HIWI: Zuarbeit an Schriftstücken, Recherche und Ablage müssen möglich sein');
  assert.ok(!hiwi.editCases && !hiwi.sendMail && !hiwi.menuCaseFileHealth && !hiwi.menuCaseFileAssets
    && !hiwi.viewFinance && !hiwi.initiatePayments && !hiwi.viewAllCases,
    'HIWI: keine Fallentscheidungen, keine Außenkommunikation, keine Gesundheits-/Vermögens-/Finanzbereiche');
  const azubi2 = ctx.__matrix(vorlagen.find((v) => v.name === 'Auszubildende / Praktikum').an).online;
  assert.ok(!azubi2.editDocuments && !azubi2.useAi,
    'Die Azubi-Rolle muss enger bleiben als die HIWI-Rolle (sonst wären die Vorlagen deckungsgleich)');
  const vb = ctx.__matrix(vorlagen.find((v) => v.name === 'Verhinderungsbetreuung (extern)').an).online;
  assert.ok(vb.editCases && vb.useFieldService && !vb.viewAllCases && !vb.viewFinance && !vb.manageOfficeProfile,
    'Verhinderungsbetreuung: Fallarbeit + Außendienst, aber nur freigegebene Fälle und kein Büro-Innenleben');
});

test('Rollen-Vorlagen: Übernahme + Bearbeiten sind verdrahtet', () => {
  assert.ok(html.includes('data-ein-vorlage="'), 'Der Übernehmen-Knopf fehlt');
  assert.ok(html.includes("rechte:einVorlagenMatrix(v.an)"), 'Die Übernahme legt keine Rechte-Schablone bei');
  assert.ok(html.includes('Bereits als Rolle übernommen.'), 'Doppelte Übernahme wird nicht verhindert/angezeigt');
  assert.ok(html.includes('data-ein-rolle-bearbeiten="'), 'Der Bearbeiten-Knopf an Rollen-Karten fehlt');
  assert.ok(html.includes("if(d.rollen.some(r=>r.id!==id&&r.name===name)){T('Diese Rolle gibt es schon.');return false}"),
    'Das Umbenennen prüft Namens-Dubletten nicht');
  assert.ok(html.includes("if(typeof window!=='undefined')window.__alleRechteKeys=BO_RIGHT_COLS.map(x=>x[1]);"),
    'Der Rechte-Katalog ist nicht als Key-Liste exportiert (Vorlagen-Matrizen wären abgehängt)');
});

test('Kontakt-Rückweg: Außendienst-Kontakte werden automatisch ins Büro zurückgeschrieben', () => {
  /* Unterbau: der Adressbuch-Schlüssel existiert als Array (Hinweg) UND {contacts,merges}
     (baSave) - EINE Normalisierung, in beiden Vergleichs-Lesern benutzt. */
  const norm = schnipsel('window.__adKontakteAusRoh=function(raw){', 'return {contacts:[],merges:[]};\n  };')
    + 'return {contacts:[],merges:[]};\n  };';
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(norm, ctx);
  assert.deepEqual(ctx.window.__adKontakteAusRoh('[{"id":"x"}]'), { contacts: [{ id: 'x' }], merges: [] });
  assert.deepEqual(ctx.window.__adKontakteAusRoh({ contacts: [{ id: 'y' }], merges: [{ id: 'm' }] }),
    { contacts: [{ id: 'y' }], merges: [{ id: 'm' }] });
  assert.deepEqual(ctx.window.__adKontakteAusRoh('kaputt'), { contacts: [], merges: [] });
  assert.equal((html.match(/root\.bueroKontakte=knorm\.contacts;/g) || []).length, 2,
    'bueroRoot UND __adBueroJetzt müssen denselben normalisierten Bestand lesen');
  assert.ok(html.includes('if(Array.isArray(v))return {contacts:v,merges:[]};'),
    'baStore toleriert das flache Hinweg-Array nicht - das Adressbuch wäre unterwegs leer');
  assert.ok(html.includes("'bueroKontakte':          {recipes:[['institution','lastName','firstName'],['email']]},"),
    'Der LISTS-Steckbrief für bueroKontakte fehlt');
  /* Rückschreibpfad selbst: Verteiler-Zweig + office-contacts-Eigenheiten. */
  assert.ok(html.includes("else if(/^bueroKontakte(#|$)/.test(r.addr))bk.push(r);"),
    'Der Verteiler kennt den bueroKontakte-Zweig nicht (Zeilen liefen in „kein Rückschreibpfad“)');
  assert.ok(html.includes('async function applyBueroKontakte(rows){'), 'applyBueroKontakte fehlt');
  const apply = schnipsel('async function applyBueroKontakte(rows){', 'window.__adApplyBueroRows=');
  assert.ok(apply.includes("Object.assign({},x&&x.data,{id:x&&x.id})"), 'GET wird nicht wie __baLoadServerBuero abgeflacht');
  assert.ok(apply.includes("body:JSON.stringify({data:bkData(a.entry)})"), 'Bodys müssen {data:…}-verpackt sein');
  assert.ok(html.includes("delete e.id; delete e.__unsaved; delete e[''];"),
    'Die lokale Notfall-id (und das Existenzzeilen-Leerfeld) reisen in den Server-Body');
  assert.ok(apply.includes("await window.__baLoadServerBuero();"), 'Der Adressbuch-Cache wird nach dem Schreiben nicht nachgezogen');
});

test('Umbau: Rollen-Wahl sitzt bei der Person, der Rollen-Reiter pflegt nur den Katalog', () => {
  /* Nutzerentscheidung 30.08.2026: "Personen" ist das zentrale Menü je Mensch - dort wird die
     Rolle gewählt; "Rollen & Vorgaben" definiert nur noch, welche Rollen es gibt. */
  assert.ok(!html.includes('data-ein-zuweisung='), 'Die alte Zuweisungstabelle lebt noch im Rollen-Reiter');
  assert.ok(html.includes('data-ein-zupersonen'), 'Der Sprung zum Personen-Bereich fehlt');
  assert.ok(html.includes("window.__einSpringe('nutzer')"), 'Der Sprungknopf führt nicht zum Personen-Bereich');
  assert.ok(html.includes('window.__einRollenApi={'), 'Die Rollen-API für das Personen-Menü fehlt');
  assert.ok(html.includes('id="adminUserRolle" disabled data-user-rolle='),
    'Das Rollen-Feld im Nutzerprofil fehlt (oder startet nicht gesperrt – Lade-Race)');
  assert.ok(html.includes('async function adminRolleFuellen()'), 'Die asynchrone Befüllung fehlt');
  assert.ok(html.includes("if(userDetailTab==='profil')adminRolleFuellen();"),
    'Die Befüllung hängt nicht am Profil-Render');
  assert.ok(html.includes('await window.__einRollenApi.setzen(uid,sel.value||'), 'Die Wahl speichert nicht über die API');
  assert.ok(html.includes('erst die Zuweisungen im Bereich Personen lösen'),
    'Der Lösch-Guard nennt den neuen Ort der Zuweisungen nicht');
  assert.ok(html.includes('lässt sich erst nach „Konto anlegen“ zuweisen'),
    'Konto-lose Personen erfahren nicht, warum sie keine Rolle wählen können');
  /* GUI-Politur: Vorlagen als Karten-Grid mit abgesetzter Klappe, eigener Anlege-Abschnitt. */
  assert.ok(html.includes('set-vklappe set-vorlagen-klappe'), 'Die Vorlagen-Klappe ist nicht abgesetzt');
  assert.ok(html.includes('<h4 class="set-abschnitt">Eigene Rolle anlegen</h4>'), 'Der Anlege-Abschnitt hat keine Überschrift');
});

test('Funktion vs. Rolle: getrennte Felder, Betreuer per Häkchen statt Textraten', (t) => {
  /* Nutzerbefund 30.08.2026: „Funktion im Büro“ und „Rolle im Büro“ waren nicht unterscheidbar.
     Entscheidungen: beide bleiben (klar benannt + Erklärzeile), die Betreuer-Erkennung läuft
     über ein ausdrückliches Häkchen statt über /betreuer/i im Freitext, und die
     Vorschlagsliste nennt Berufsbezeichnungen statt Rollennamen. */
  assert.ok(html.includes('<label>Funktion / Berufsbezeichnung</label>'), 'Das Funktions-Feld ist nicht geschärft');
  assert.ok(html.includes('<label>Rolle (Rechte &amp; Vorgaben)</label>'), 'Das Rollen-Feld ist nicht geschärft');
  assert.ok(html.includes('Berufsbezeichnung – steht in Listen und Excel.')
    && html.includes('Was sie in der Software darf – Rechte und Vorgaben.')
    && html.includes('Steht dann bei Fällen in der Betreuer-Auswahl.'),
    'Die Erklärzeilen unter den Feldern fehlen');
  assert.ok(html.includes('id="adminUserIstBetreuer"') && html.includes('id="perIstBetreuer"'),
    'Das Häkchen fehlt in einem der beiden Formulare (Konto-Person / Person ohne Konto)');
  assert.ok(html.includes("istBetreuer:!!document.getElementById('adminUserIstBetreuer')?.checked"),
    'Das Nutzerprofil sendet das Häkchen nicht');
  assert.ok(html.includes("isBetreuer:(p.istBetreuer!=null?!!p.istBetreuer:isBetreuerRole(p.funktion))"),
    'gatherPersons rät die Betreuer-Eigenschaft wieder aus dem Text');
  assert.ok(html.includes("officeJobTitle:['Berufsbetreuer/in','Verwaltungsfachkraft'"),
    'Die Vorschlagsliste nennt weiter Rollennamen statt Berufsbezeichnungen');
  assert.ok(!html.includes("'Büroorganisation','Funktion / Rolle'"), 'Die Listen-Beschriftung heißt noch „Funktion / Rolle“');

  /* Migration am echten Schema: Bestand mit „Berufsbetreuer/in“ wird automatisch angehakt,
     Verwaltungskräfte nicht - und der Marker verhindert, dass ein bewusst entferntes Häkchen
     beim nächsten Start zurückkehrt. */
  const db = frischeDb(t);
  db.prepare("INSERT INTO users (id, username, password_hash, first_name, last_name, job_title) VALUES (5,'sf','x','Sabine','Falkner','Berufsbetreuer/in')").run();
  db.prepare("INSERT INTO persons (id, art, first_name, last_name, funktion) VALUES ('p-betr','intern','Sabine','Falkner','Berufsbetreuer/in')").run();
  db.prepare("INSERT INTO persons (id, art, first_name, last_name, funktion) VALUES ('p-verw','intern','Karim','Denizli','Verwaltung')").run();
  db.prepare("DELETE FROM office_json WHERE key = 'personen_betreuer_flag'").run();
  db.prepare("UPDATE persons SET ist_betreuer = 0").run();
  db.close();
  const db2 = frischeDb(t);   // zweiter Start: Ableitung läuft
  assert.equal(db2.prepare("SELECT ist_betreuer AS b FROM persons WHERE id = 'p-betr'").get().b, 1,
    'Bestehende Betreuer:innen wurden nicht automatisch angehakt');
  assert.equal(db2.prepare("SELECT ist_betreuer AS b FROM persons WHERE id = 'p-verw'").get().b, 0,
    'Eine Verwaltungskraft wurde fälschlich als Betreuerin angehakt');
  assert.ok(db2.prepare("SELECT key FROM office_json WHERE key = 'personen_betreuer_flag'").get(),
    'Der Einmal-Marker fehlt – ein entferntes Häkchen käme beim nächsten Start zurück');
  db2.prepare("UPDATE persons SET ist_betreuer = 0 WHERE id = 'p-betr'").run();
  db2.close();
  const db3 = frischeDb(t);   // dritter Start: Marker hält, Häkchen bleibt entfernt
  assert.equal(db3.prepare("SELECT ist_betreuer AS b FROM persons WHERE id = 'p-betr'").get().b, 0,
    'Der Marker greift nicht – ein bewusst entferntes Häkchen kehrte zurück');
});

test('Personen-Profil: gegliedert, ohne doppelte Darstellungsfelder', () => {
  /* Nutzerbefund 30.08.2026: 20 Felder ohne Ordnung, und Hell/Dunkel + Nachtdarstellung gab es
     ZWEIMAL – hier im Profil und unter „Darstellung & Bedienung“ (dort samt Büro-/Rollen-/
     Personen-Vorgabe). Die Profil-Felder sind raus, das Formular ist in vier Abschnitte
     gegliedert. */
  assert.ok(!html.includes('adminUserThemePreference') && !html.includes('adminUserThemeScheduleEnabled'),
    'Die doppelten Darstellungsfelder stehen wieder im Personen-Profil');
  assert.ok(!html.includes("themePreference:val('adminUserThemePreference')"),
    'Der Formular-Sammler schickt wieder eine Darstellungs-Wahl mit (überschreibt die eigene Wahl der Person)');
  /* Der Verweis-Satz auf „Darstellung & Bedienung“ ist auf Nutzerwunsch (30.08.2026) wieder
     entfernt - die Felder sind weg, der Erklärsatz dazu war überflüssiger Text im Formular. */
  assert.ok(!html.includes('Hell/Dunkel und die automatische Nachtdarstellung wählt jede Person selbst'),
    'Der entfernte Verweis-Satz steht wieder im Formular');
  for (const t of ['Zugang', 'Person', 'Im Büro', 'Anzeige &amp; Notizen']) {
    assert.ok(html.includes(`${'${'}profilAbschnitt('${t.replace('&amp;', '&')}')}`),
      `Der Abschnitt „${t}“ fehlt im Profil-Formular`);
  }
  assert.ok(html.includes('.profil-abschnitt{grid-column:1/-1'),
    'Die Abschnittsleiste bricht die Grid-Spalten (grid-column fehlt)');
  /* Die Feld-IDs müssen erhalten bleiben – Sammler und Prüfstand hängen daran. */
  for (const id of ['adminUserDisplayName', 'adminUserFirstName', 'adminUserLastName', 'adminUserJobTitle',
    'adminUserIstBetreuer', 'adminUserMaKennung', 'adminUserInitials', 'adminUserWeeklyHours',
    'adminUserJoinedAt', 'adminUserLeftAt', 'adminUserCalendarColor', 'adminUserNotes', 'adminUserRolle']) {
    assert.ok(html.includes(id), `Feld-ID ${id} ist beim Umbau verloren gegangen`);
  }
});

test('KI-Fernzugriff: Verbindungs-Karte mit kopierbarer Adresse statt doppeltem Fließtext', () => {
  /* Nutzerwunsch 30.08.2026 „optimiere dieses Layout“: Die Server-URL ist das, was man hier
     tatsächlich braucht (Eintrag als Connector in ChatGPT/Claude) – sie stand zweimal als
     bloßer Text und ließ sich nicht kopieren; der Untertitel wiederholte nur den Titel. */
  assert.ok(!html.includes("mcp:{unter:'KI-Fernzugriff (MCP) verwalten.'"),
    'Der Untertitel wiederholt wieder nur den Seitentitel');
  assert.ok(html.includes('id="mcpAdmResource"') && html.includes('window.__mcpCopyResource'),
    'Die kopierbare Adresse samt Kopieren-Knopf fehlt');
  assert.ok(html.includes('window.__mcpCopyResource=async function(btn){'), 'Die Kopier-Funktion fehlt');
  assert.ok(html.includes("if(!document.execCommand('copy'))throw new Error('execCommand');"),
    'Der Kopier-Rückfall meldet Erfolg, ohne ihn zu prüfen (execCommand wirft nicht, es liefert false)');
  /* Der Ein/Aus-Zustand steht als Marke im Titel der Verbindungs-Karte. */
  assert.ok(html.includes("+(d.enabled?'<span class=\"bk2-chip ausgefuehrt\">eingeschaltet</span>'"),
    'Der Ein/Aus-Zustand fehlt an der Verbindungs-Karte');
  /* Die Adresse wird nur noch EINMAL ausgegeben (im Feld) – nicht mehr zusätzlich im Info-
     Text und im leeren Clients-Kasten. */
  assert.equal((html.match(/esc\(d\.effectiveResource\)/g) || []).length, 0,
    'Die Adresse steht wieder als Fließtext in der Seite (Dopplung)');
  assert.ok(html.includes("att(d.effectiveResource)"), 'Die Adresse fehlt im Kopierfeld');
  /* Alle Karten über die volle Breite (Nutzerwunsch 30.08.2026) - über eine EIGENE Klasse,
     damit .bk2-settings-grid in den anderen Bereichen zweispaltig bleibt. Gemessen bei
     1500px Viewport: alle vier Karten 1137px breit an derselben linken Kante. */
  assert.ok(html.includes('class="bk2-settings-grid mcp-voll"'), 'Das MCP-Grid trägt die Voll-Breite-Klasse nicht');
  assert.ok(html.includes('.bk2 .bk2-settings-grid.mcp-voll{grid-template-columns:1fr}'),
    'Die Voll-Breite-Regel fehlt');
  assert.ok(html.includes('.bk2 .bk2-settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))'),
    'Die allgemeine Grid-Regel wurde verändert – das beträfe auch andere Bereiche');
  /* Der Not-Aus stand in einer 190px-Spalte des bk2-form-Rasters und brach zweizeilig um;
     class="wide" gibt ihm die ganze Zeile (gemessen: Label 19px hoch = eine Zeile). */
  assert.ok(html.includes('<label class="wide" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="mcpAdmEnabled"'),
    'Der Not-Aus-Schalter bricht wieder auf zwei Zeilen um (class="wide" fehlt)');
});

test('Nutzer löschen: alle users-Fremdschlüssel aus dem Schema, ehrliche Absage statt 500er', async (t) => {
  /* Nutzerbefund 30.08.2026: „Interner Serverfehler" beim Löschen eines Kontos. Ursache: eine
     handgepflegte Liste von 8 Spalten, während inzwischen 53 Spalten auf users verweisen –
     eine einzige Chat-Teilnahme oder Mail-Einstellung genügte, und das Konto war unlöschbar.
     Die Landkarte kommt jetzt aus dem Schema; unbekannte Pflicht-Referenzen blockieren mit
     Meldung, statt zu raten. */
  const db = frischeDb(t);
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: 1, isAdmin: true, canManageUsers: true }; next(); });
  app.use('/api/admin', require('../src/modules/admin/routes'));
  const srv = app.listen(0);
  t.after(() => srv.close());
  const basis = `http://127.0.0.1:${srv.address().port}`;
  const ruf = (m, w, b) => fetch(basis + w, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });

  db.prepare("INSERT INTO users (id, username, password_hash, is_admin, active, allow_online) VALUES (1,'chef','x',1,1,1)").run();
  const antwort = await ruf('POST', '/api/admin/users', { username: 'weg', password: 'Kurz-Zeit-11', firstName: 'Timo', lastName: 'Test' });
  const angelegt = await antwort.json();
  assert.ok(angelegt.user, `Nutzer nicht angelegt (HTTP ${antwort.status}): ${JSON.stringify(angelegt).slice(0, 200)}`);
  const id = angelegt.user.id;

  /* Genau die Spuren, an denen es beim Nutzer scheiterte – plus eine Urheberschaft, die
     ERHALTEN bleiben muss (der Finanzposten darf nicht mitgelöscht werden). */
  db.prepare("INSERT INTO chat_conversations (id, created_by) VALUES ('c1', 1)").run();
  db.prepare('INSERT INTO chat_participants (conversation_id, user_id) VALUES (?,?)').run('c1', id);
  db.prepare('INSERT OR IGNORE INTO mail_prefs (user_id) VALUES (?)').run(id);
  db.prepare("INSERT INTO finance_entries (id, kind, posten, updated_by) VALUES ('f1','ausgabe','Miete',?)").run(id);

  const weg = await ruf('DELETE', '/api/admin/users/' + id);
  assert.equal(weg.status, 200, 'Ein Konto mit Chat-Teilnahme/Mail-Einstellung ließ sich nicht löschen (der 500er ist zurück)');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(id).n, 0, 'Das Konto ist noch da');
  const posten = db.prepare("SELECT updated_by AS u FROM finance_entries WHERE id = 'f1'").get();
  assert.ok(posten && posten.u === null, 'Der Finanzposten wurde mitgelöscht statt nur die Urheberschaft zu lösen');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_participants WHERE user_id = ?').get(id).n, 0,
    'Die Chat-Teilnahme des gelöschten Kontos blieb stehen');

  /* Abrechnungsrelevante Daten blockieren – mit Meldung und Hinweis auf das Deaktivieren. */
  const zweit = await (await ruf('POST', '/api/admin/users', { username: 'fahrer', password: 'Kurz-Zeit-11' })).json();
  const spalten = db.prepare('PRAGMA table_info(private_vehicles)').all();
  const werte = { id: 'v1', owner_user_id: zweit.user.id };
  for (const c of spalten) if (c.notnull && c.dflt_value === null && !c.pk && !(c.name in werte)) werte[c.name] = 'Test';
  const namen = Object.keys(werte);
  db.prepare(`INSERT INTO private_vehicles (${namen.join(',')}) VALUES (${namen.map((k) => '@' + k).join(',')})`).run(werte);
  const blockiert = await ruf('DELETE', '/api/admin/users/' + zweit.user.id);
  assert.equal(blockiert.status, 409, 'Ein Konto mit eigenen Fahrzeugen wurde stillschweigend gelöscht oder warf 500');
  const meldung = await blockiert.json();
  assert.equal(meldung.code, 'USER_DELETE_BLOCKED');
  assert.match(meldung.error, /deaktivieren/, 'Die Absage nennt den schonenden Weg nicht');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM private_vehicles WHERE id = 'v1'").get().n, 1, 'Das Fahrzeug wurde doch gelöscht');

  /* Strukturprüfung: KEINE users-Referenz fällt durch – auch künftige nicht. */
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'admin', 'routes.js'), 'utf8');
  assert.ok(quelle.includes('function userFremdschluesselKarte()'), 'Die Landkarte kommt wieder aus einer Handliste');
  assert.ok(quelle.includes("modus: 'blockieren', was: tabelle"),
    'Unbekannte Pflicht-Referenzen werden geraten statt blockiert (stiller Datenverlust möglich)');
  assert.ok(quelle.includes('!spalte.notnull && !spalte.pk'),
    'Primärschlüssel-Spalten werden wieder auf NULL gesetzt (SQLITE_MISMATCH, z. B. mail_prefs)');
});
