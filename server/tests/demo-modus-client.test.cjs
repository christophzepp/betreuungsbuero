'use strict';
/* Demo-Modus (Nutzerauftrag 30.08.2026) - Clientseite der Auslieferungsdatei.

   Verankert: der Marker-gesteuerte RAM-Tausch (Block aussendienst-2a), der zweistufige
   Demo-Boot im Login-Gate (Marker+Neuladen, dann Paket in die Wegwerf-Ablage), der
   Demo-Knopf der Anmeldeseite, der eigene Einstellungsbereich, die Chat-Freigaben, das
   NEUE Übungspostfach (fünf Fallordner, relative Zukunftsfristen, keine Karteileichen
   Mustermann/Beispiel mehr) und die generelle Umbenennung der beiden Bürovorlagen
   („Übernahmebereitschaft Betreuer"). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

test('RAM-Wegwerfspeicher: der Demo-Marker aktiviert den Tausch des Außendienst-Blocks', () => {
  assert.match(HTML, /demoBoot=window\.sessionStorage\.getItem\('betreuungsbuero\.demoBoot\.v1'\)==='1';/,
    'Der Demo-Marker wird nicht mehr vor dem Tausch gelesen');
  assert.match(HTML, /if\(!kennung&&!demoBoot\)return;/,
    'Die Tausch-Bedingung kennt den Demo-Modus nicht mehr - Änderungen landeten im echten Browser-Speicher');
  assert.match(HTML, /window\.__demoSpeicherAktiv=true;/, 'Das Tausch-Signal für das Login-Gate fehlt');
  assert.match(HTML, /window\.__demoMarkerLoeschen=function\(\)/, 'Der Rückweg (Marker löschen nach Abmelden) fehlt');
  assert.match(HTML, /Object\.defineProperty\(window,'indexedDB',\{value:undefined,configurable:true\}\)/,
    'IndexedDB bleibt in der Vorführung offen - Zweitschriften würden echt geschrieben');
  /* FAIL-CLOSED (Nutzerentscheid 30.08.: „Start verweigern"). Das Erfolgs-Signal darf ERST
     nach geglücktem Tausch gesetzt werden - vorher war es fail-open: Schlug der Tausch fehl,
     schrieb demoBoot das Vorführpaket in den ECHTEN Browser-Speicher und überschrieb
     Bürostammdaten, Adressbuch, Termine und Aufgaben. */
  assert.match(HTML, /if\(demoBoot&&okL&&okS\)window\.__demoSpeicherAktiv=true;/,
    'Das Speicher-Erfolgssignal hängt nicht mehr am tatsächlichen Tausch');
  const vorSignal = HTML.indexOf("window.__demoSpeicherAktiv=true");
  assert.ok(HTML.slice(0, vorSignal).includes('var okL=ersetzen('),
    'Das Erfolgssignal steht wieder VOR dem Tausch - fail-open');
  assert.match(HTML, /if\(window\.__adSpeicherFehler\|\|!window\.__demoSpeicherAktiv\)\{/,
    'demoBoot startet wieder ohne Prüfung des Wegwerf-Speichers');
  assert.ok(HTML.includes('Der Vorführbetrieb kann in diesem Browser nicht sicher starten.'),
    'Der verständliche Grund für die Startverweigerung fehlt');
});

test('Login-Gate: Demo-Zweig, Paket-Boot und Rückkehr in den echten Speicher', () => {
  assert.match(HTML, /if\(mode==='demo'\)\{\s*\n\s*if\(!window\.__demoSpeicherAktiv\)\{/,
    'Der zweistufige Demo-Einstieg (Marker+Neuladen) fehlt in onLoggedIn');
  assert.match(HTML, /async function demoBoot\(user\)\{/, 'Der Vorführ-Boot fehlt');
  assert.match(HTML, /fetch\('\/api\/demo\/paket',\{credentials:'same-origin'\}\)/, 'Das Vorführpaket wird nicht geladen');
  for (const key of ['betreuungsbuero.bueroLocal.v1', 'betreuungsbuero.bueroAdress.v1', 'betreuungsbuero.calendarEvents.v1', 'betreuungsbuero.todos.v1']) {
    assert.ok(HTML.includes(`localStorage.setItem('${key}',JSON.stringify(`), `Der Boot füllt ${key} nicht`);
  }
  assert.match(HTML, /window\.__startWizardHadCaseAtBoot=true;\s*\n\s*\}catch\(fehler\)\{/,
    'Ohne das Assistenten-Flag bliebe die Vorführung in der reduzierten Ansicht hängen (siehe Außendienst-Fund)');
  /* Rückkehr: ohne Sitzung, aber mit aktivem Tausch, würde ein echter Login im Wegwerf-Speicher landen. */
  assert.match(HTML, /if\(window\.__demoSpeicherAktiv\)\{\s*\n\s*try\{if\(window\.__demoMarkerLoeschen\)window\.__demoMarkerLoeschen\(\);\}catch\(_e\)\{\}\s*\n\s*location\.reload\(\);/,
    'Die Rückkehr aus der Demo in den echten Speicher fehlt in showLoginForm');
});

test('Anmeldeseite: der Demo-Knopf hängt am Server-Schalter', () => {
  assert.match(HTML, /data-mode="demo" aria-pressed="false" style="display:none" data-login-demo-btn/,
    'Der dritte Modus-Knopf fehlt');
  assert.match(HTML, /fetch\('\/api\/setup\/state',\{credentials:'same-origin'\}\)/,
    'Die Anmeldeseite fragt den Demo-Schalter nicht ab');
  /* Nutzerauftrag 30.08. abends: KEINE Zugangsdaten auf der Anmeldeseite - sie ist ohne
     Anmeldung erreichbar. Die Konten stehen nur in den Einstellungen unter „Demo-Modus". */
  assert.ok(!HTML.includes('data-login-demo-hint'),
    'Der Kontenhinweis ist auf der Anmeldeseite zurück - dort gehören keine Passwörter hin');
  assert.ok(!HTML.includes('Vorführzugang: Demo1'),
    'Die Vorführ-Zugangsdaten stehen wieder auf der öffentlich erreichbaren Anmeldeseite');
  assert.ok(HTML.includes("konten.push('<tr><td>DemoAdmin'+i+'</td><td>DemoAdminPasswort'+i+'</td><td>Administration</td></tr>')"),
    'Die Kontentabelle im Einstellungsbereich kennt die Verwaltungsreihe nicht');
  /* Einstellungsmenü: dieselben Bereiche wie online, nur der Demo-Schalter bleibt der
     echten Administration vorbehalten. */
  assert.ok(HTML.includes("if(window.__demoModus)return item.id!=='demo';"),
    'Das Einstellungsmenü blendet in der Vorführung wieder Bereiche aus');
});

test('Einstellungsmenü: eigener Bereich „Demo-Modus" unter dem Lokalen Modus', () => {
  assert.match(HTML, /\{id:'lokal',name:'Lokaler Modus',admin:true,lokal:true\},/,
    'Der Anker-Bereich Lokaler Modus fehlt');
  assert.match(HTML, /\{id:'demo',name:'Demo-Modus',admin:true\}\]\]/,
    'Der Bereich Demo-Modus fehlt oder steht nicht direkt unter dem Lokalen Modus');
  assert.match(HTML, /demo:\{unter:'Ein schaltbarer Vorführbetrieb/,
    'Der Einbett-Eintrag des Demo-Bereichs fehlt');
  assert.match(HTML, /async function einSeiteDemoModus\(host\)\{/, 'Der Seiten-Renderer fehlt');
  assert.match(HTML, /window\.__demoSchalterSetzen=async function\(an,knopf\)\{/, 'Der Schalter-Setter fehlt');
  assert.match(HTML, /fetch\('\/api\/demo\/schalter',\{method:'PUT'/, 'Der Schalter-PUT fehlt');
});

test('Chat und Echtzeit sind für die Vorführung freigegeben - sonst nichts', () => {
  assert.match(HTML, /if\(built\|\|!detail\|\|\(detail\.mode!=='online'&&!window\.__demoModus\)\)return;/,
    'Der Nutzerchat startet in der Vorführung nicht mehr');
  assert.match(HTML, /if\(window\.__appMode!=='online'&&!window\.__demoModus\)\{/,
    'Die Echtzeit-Verbindung (Chat-Transport) bleibt in der Vorführung zu');
  assert.match(HTML, /if\(window\.__demoModus\)return 'demo';/,
    '__runtimeMode kennt den Vorführbetrieb nicht mehr');
});

test('Übungspostfach: neue Geschichten zu den fünf Fällen, keine Karteileichen, nie verstrichene Fristen', () => {
  const a = HTML.indexOf('function mxDemoStore(){');
  const e = HTML.indexOf('function mxDemoApi', a);
  const store = HTML.slice(a, e);
  assert.ok(a > 0 && e > a, 'mxDemoStore nicht gefunden');
  for (const person of ['Auerbach, Margarete', 'Kilic, Emre', 'Nowak, Halina', 'Rothenberg, Dieter', 'Weidmann, Jonas']) {
    assert.ok(store.includes(`Betreute Personen/${person}`), `Der Fallordner „${person}" fehlt im Übungspostfach`);
  }
  assert.ok(!store.includes('Mustermann, Max') && !store.includes('Beispiel, Anna'),
    'Die alten Karteileichen Mustermann/Beispiel sind zurück im Übungspostfach');
  assert.match(store, /var inTagen=function\(n\)\{/,
    'Der Zukunfts-Datumshelfer fehlt - genannte Fristen würden wieder veralten');
  assert.ok(!/\b15\.08\.2026\b/.test(store), 'Ein festes (verstreichbares) Fristdatum steht wieder im Postfach');
  assert.match(store, /post@betreuungsbuero-mustermensch\.de/, 'Das Postfach gehört nicht mehr dem Musterbüro');
  /* Nutzerentscheid 30.08. (2. Runde): der alte Handweg „Demo-Postfach laden" existiert in
     den normalen Betriebsarten nicht mehr - der Knopf erscheint nur im Demo, als Zurücksetzer
     (Beschriftung „Demo-Postfach zurücksetzen", 3. Runde statt „Übungspostfach"). */
  assert.ok(!HTML.includes('Demo-Postfach laden'), 'Der alte Lade-Knopf ist zurück in den normalen Modi');
  assert.match(HTML, /\+\(embedded\|\|!window\.__demoModus\?'':'<button type="button" class="mx-btn" title="Lädt das fiktive Demo-Postfach frisch/,
    'Der Zurücksetzer-Knopf ist nicht mehr auf den Demo-Modus begrenzt');
  assert.ok(HTML.includes('>Demo-Postfach zurücksetzen</button>'), 'Die gewünschte Knopf-Beschriftung fehlt');
  /* Immer geladen, aber LEISE: die Vorführung schaltet nur die Datenquelle scharf. Die
     Mail-App darf sich beim Anmelden nicht selbst öffnen - der Nutzer landet auf der
     Startseite (Nutzerkorrektur 30.08., 3. Runde). */
  assert.match(HTML, /if\(!\(\(ev&&ev\.detail&&ev\.detail\.demo\)\|\|window\.__demoModus\)\)return;[\s\S]{0,300}?setTimeout\(function\(\)\{try\{window\.__mxDemoActivate\(true\);\}catch\(_e\)\{\}\},50\);/,
    'Das Demo-Postfach lädt in der Vorführung nicht mehr von selbst (leise)');
  /* Der leise Zweig lädt seit 30.08. zusätzlich die Ordner (für die Ungelesen-Zähler) und
     kehrt DANN zurück - die Mail-App darf sich weiterhin nicht selbst öffnen. */
  assert.match(HTML, /window\.__mxDemoActivate=async function\(leise\)\{[\s\S]{0,300}?if\(leise===true\)\{[\s\S]{0,900}?return;\s*\}[\s\S]{0,160}?window\.openMailApp\(\)/,
    'Der leise Rückweg fehlt - die Mail-App würde sich beim Demo-Login wieder selbst öffnen');
  /* Nutzerentscheid 30.08. (4. Runde): ONLINE ist die Grundlage der Vorführung - kein
     Mail-Einstieg darf in der Demo mehr „nur im Online-Modus" melden. Alle fünf Wächter
     (openMailApp, ComposeTo, ComposePopout, QuickCompose, QuickSync) kennen MX.demo. */
  const gesperrt = (HTML.match(/\(window\.__appMode\|\|''\)!=='online'\)\{(?:try\{[^}]*\}catch\(_e\)\{\})?toast\('Das E-Mail-Postfach ist nur im Online-Modus/g) || []).length;
  const frei = (HTML.match(/!MX\.demo&&[^\n]*\(window\.__appMode\|\|''\)!=='online'\)\{(?:try\{[^}]*\}catch\(_e\)\{\})?toast\('Das E-Mail-Postfach ist nur im Online-Modus/g) || []).length;
  assert.strictEqual(gesperrt, frei, `${gesperrt - frei} Mail-Einstieg(e) ohne Demo-Ausnahme (Wächter gesamt: ${gesperrt})`);
  assert.ok(frei >= 5, `Nur ${frei} Mail-Wächter gefunden (5 erwartet) - Zählmuster prüfen`);
  /* Nutzerkorrektur „zu wenig Demo-Mails": das Postfach ist auf ~50 Nachrichten gefüllt. */
  const anzahl = (store.match(/\bM\(\{/g) || []).length;
  assert.ok(anzahl >= 45, `Nur ${anzahl} Nachrichten im Übungspostfach (mindestens 45 erwartet)`);
});

test('Demo-Intro: eigene Variante, erscheint bei jeder Anmeldung, Mustermensch-Marke erzeugt', () => {
  /* Nutzerauftrag 30.08. (3. Runde): das Modus-Intro zeigte in der Vorführung den
     Lokal-Modus-Text - jetzt eigene Beschreibung, eigenes Badge, keine Gesehen-Merker. */
  assert.match(HTML, /const DEMO_DESC='Ein Vorführbetrieb zum gefahrlosen Kennenlernen/,
    'Die Demo-Beschreibung des Intros fehlt');
  assert.ok(HTML.includes("${mode==='online'?'Online-Modus':mode==='demo'?'Demo-Modus':'Lokal-Modus'}"),
    'Das Intro-Badge kennt die Demo-Variante nicht');
  assert.ok(HTML.includes("${mode==='online'?ONLINE_DESC:mode==='demo'?DEMO_DESC:LOCAL_DESC}"),
    'Der Intro-Text kennt die Demo-Variante nicht');
  assert.match(HTML, /const demo=!!\(detail&&detail\.demo\)\|\|!!window\.__demoModus;\s*\n\s*const mode=demo\?'demo':/,
    'launch() erkennt die Vorführung nicht mehr');
  /* Nutzerwunsch 30.08. spät: einmal je ANMELDUNG statt bei jedem Fenster. Der Merker liegt
     im ECHTEN Sitzungsspeicher - ein weiteres Fenster erbt ihn, das Abmelden löscht ihn. */
  assert.ok(HTML.includes("const seen=demo?demoGesehen:(mode==='online'"),
    'Das Intro merkt sich in der Vorführung nichts mehr - es käme in jedem Fenster erneut');
  assert.match(HTML, /demoGesehen=window\.__demoEchtesSession&&window\.__demoEchtesSession\.getItem\('betreuungsbuero\.demoIntroGesehen\.v1'\)==='1'/,
    'Der Intro-Merker der Vorführung fehlt');
  assert.match(HTML, /window\.__demoEchtesSession\.setItem\('betreuungsbuero\.demoIntroGesehen\.v1','1'\)/,
    'Der Weiter-Klick merkt sich das Intro nicht');
  assert.match(HTML, /echtesSession\.removeItem\('betreuungsbuero\.demoIntroGesehen\.v1'\)/,
    'Das Abmelden setzt das Intro nicht zurück');
  /* Die öffentliche Programmdatei bleibt ohne statisches Bürologo; die Vorführung erzeugt
     ihre rein fiktive Mustermensch-Marke selbst, auch wenn die beiden Logo-Hosts leer sind. */
  assert.ok(HTML.includes('<div class="brand brand-source-hidden" id="workspaceBrandSource"></div>'),
    'Die öffentliche Programmdatei enthält wieder eine statische Büromarke');
  assert.match(HTML, /var demoMarke='data:image\/svg\+xml;utf8,'\+encodeURIComponent\('<svg [^']*Max Mustermensch/,
    'Der gezeichnete Mustermensch-Briefkopf fehlt');
  assert.ok(HTML.includes("['workspaceBrandSource','heroLogo'].forEach(function(id)"),
    'Die Demo-Marke wird in leeren Logo-Hosts nicht mehr neu angelegt');
  assert.ok(HTML.includes('window.bueroLocal.officeProfile.logoDataUrl=demoMarke'),
    'Der anschließende Büroprofil-Abgleich würde die Demo-Marke wieder entfernen');
  assert.ok(HTML.includes("document.querySelectorAll('#startTodayBrandLogo img,#loginGateAppBootMark img,.brand img')"),
    'Der Marken-Tausch erreicht nicht mehr alle bereits vorhandenen Ableger');
});

test('Online-Grundlage (Nutzerentscheid 30.08., 4. Runde): Attrappen statt Lokal-Blockaden', () => {
  /* „Der Demo-Modus soll den Online-Modus als Grundlage haben" - die Vorführung bekommt die
     app-mode-online-Klasse (versteckt u.a. den Datei-Einlese-Assistenten der Startseite),
     und die vier Server-Features antworten aus RAM-Attrappen statt „nur im Online-Modus". */
  assert.ok(HTML.includes("document.documentElement.classList.toggle('app-mode-online', e.detail?.mode==='online'||e.detail?.demo===true);"),
    'Die Vorführung bekommt die Online-Klasse nicht mehr - der Einlese-Assistent wäre zurück');
  assert.ok(HTML.includes('html.app-mode-online #startPage .step-grid{display:none!important}'),
    'Die Versteck-Regel des Einlese-Assistenten fehlt');
  assert.match(HTML, /window\.__wieOnline=function\(\)\{return window\.__appMode==='online'\|\|!!window\.__demoModus;\};/,
    'Der Anzeige-Helfer „wie Online zeigen" fehlt');
  /* Banking: eigener api()-Fänger + Datenbestand je Demofall. */
  assert.match(HTML, /function bkDemoStore\(\)\{/, 'Der Banking-Attrappen-Bestand fehlt');
  assert.match(HTML, /window\.__bankDemoApi=async function\(method,url,body\)\{/, 'Der Banking-Fänger fehlt');
  assert.match(HTML, /if\(window\.__demoModus\)\{const demo=await window\.__bankDemoApi\(method,url,body\);if\(demo!==undefined\)return demo;\}/,
    'Der Banking-api\(\)-Helfer fragt die Attrappe nicht mehr zuerst');
  for (const fall of ['Auerbach', 'Kilic', 'Nowak', 'Rothenberg', 'Weidmann']) {
    assert.ok(new RegExp('\\{re:/' + fall + '/').test(HTML), `Das Banking-Profil für ${fall} fehlt`);
  }
  assert.match(HTML, /if\(window\.__appMode!=='online'&&!window\.__demoModus\)\{\s*\n\s*accToast\('Das Banking steht nur im Online-Betrieb/,
    'Der Zahlungsabgleich sperrt die Vorführung wieder aus');
  assert.match(HTML, /if\(!caseId&&window\.__demoModus\)\{try\{caseId=String\(\(typeof window\.caseIdentityOf==='function'\?window\.caseIdentityOf\(state\):''\)\|\|''\);\}catch\(_e\)\{\}\}/,
    'Ohne die Registry-Kennung fände der Zahlungsabgleich in der Demo keinen Fall');
  /* KI-Suche: vorbereitete, gekennzeichnete Antworten. */
  assert.match(HTML, /function navKiDemoAntwort\(frage\)\{/, 'Die KI-Attrappe fehlt');
  assert.match(HTML, /if\(window\.__demoModus\)\{zeige\(navKiDemoAntwort\(frage\)\);return\}/,
    'Die KI-Suche nutzt die Attrappe nicht mehr');
  assert.ok(HTML.includes('Vorführbetrieb: vorbereitete Antwort ohne echte KI-Verbindung.'),
    'Die Kennzeichnung der Vorführ-Antwort fehlt - das wäre eine vorgetäuschte echte KI');
  /* Kontakte: Fänger nur für Ablage/Sync/Export, Übernahme über den echten vCard-Weg. */
  assert.match(HTML, /window\.__ciDemoFetch=function\(url,init\)\{/, 'Der Kontakt-Fänger fehlt');
  assert.ok(HTML.includes("if(url.indexOf('/api/office-contacts')===0){"),
    'Der fetch-Umweg ist nicht mehr auf office-contacts begrenzt');
  assert.ok(HTML.includes("window.__baImportBueroContacts([Object.assign({status:'Aktiv'},eintrag.data)])"),
    'Die Übernahme in die Bürokontakte läuft nicht mehr über den echten vCard-Weg');
  assert.match(HTML, /if\(window\.__appMode!=='online'&&!window\.__demoModus\)\{if\(window\.toast\)toast\('Die Online-Kontakt-Synchronisation/,
    'Die Import-Ablage sperrt die Vorführung wieder aus');
  /* Startseiten-Texte (2. Nutzer-Sichtprobe): die Online-Umschreibung (Überschrift ohne
     Assistenten-Nummer „2.") greift auch in der Demo - aber mit EIGENEN, ehrlichen Sätzen
     für Datenschutz-Hinweis und Leerzustand (kein „wird zentral gespeichert" im Wegwerf-RAM). */
  assert.ok(HTML.includes("if(window.__appMode!=='online'&&!window.__demoModus)return;"),
    'Der Online-Textblock der Startseite lässt die Demo wieder aus - die „2. Erkannte Stammdaten"-Nummer wäre zurück');
  assert.match(HTML, /const PRIVACY_DEMO='Hinweis: Im Demo-Modus bleiben sämtliche Änderungen nur im Arbeitsspeicher/,
    'Der ehrliche Demo-Datenschutzhinweis fehlt');
  assert.ok(HTML.includes("const priv=document.getElementById('startPrivacyHint');if(priv)priv.textContent=demo?PRIVACY_DEMO:PRIVACY;"),
    'Die Demo bekäme den falschen Server-Speicher-Hinweis');
  assert.ok(HTML.includes('bleiben aber nur in dieser Vorführung.'),
    'Der Stammdaten-Untertitel der Demo (ohne Speicher-Behauptung) fehlt');
  /* Sichtbarkeit: die beiden Online-Knöpfe des Adressbuchs erscheinen auch in der Demo. */
  const wieOnlineKnoepfe = (HTML.match(/\$\{window\.__wieOnline\(\)\?`<button/g) || []).length;
  assert.strictEqual(wieOnlineKnoepfe, 2, `${wieOnlineKnoepfe} statt 2 Adressbuch-Knöpfe über __wieOnline sichtbar`);
});

test('Online-Grundlage, 5. Runde: Badge D, Mail-Karte, Fallwechsler-Brücke, Banking-Einstieg', () => {
  /* Nutzerkorrektur 30.08. („Unten steht nach wie vor L und Mail ist auch nicht da!"):
     Ergebnis des 294-Stellen-Sweeps - 7 verifizierte UI-Öffnungen, Brücke für die
     Fallwechsler-Familie, Banking-Seitenleiste, Chat-Totmann-Uhr, ehrliche Texte. */
  assert.ok(HTML.includes("modeEl.textContent=mode==='online'?'O':mode==='demo'?'D':'L';"),
    'Das Nutzer-Menü zeigt in der Vorführung wieder das irreführende „L"');
  assert.ok(HTML.includes("showBadge(user,'demo');"), 'demoBoot meldet dem Nutzer-Menü nicht mehr den Demo-Modus');
  assert.ok(HTML.includes('.ai-status-indicator.mode-demo{'), 'Die Badge-Farbe der Vorführung fehlt');
  assert.ok(HTML.includes("(mode==='demo'?'':'<button type=\"button\" data-user-menu-pw>Passwort ändern</button>')"),
    'Der Passwort-ändern-Eintrag ist zurück in der Vorführung (geteilte Konten!)');
  /* E-Mail-Karte der Seitenleiste + EventSource-Wache (Race: stille Aktivierung kommt 50ms später). */
  assert.ok(HTML.includes("if(!e.detail||(e.detail.mode!=='online'&&e.detail.demo!==true))return;"),
    'Die E-Mail-Seitenleisten-Karte fehlt der Vorführung wieder');
  assert.ok(HTML.includes("if(MXN.es||typeof EventSource==='undefined'||MX.demo||window.__demoModus)return;"),
    'Die EventSource liefe beim Demo-Login gegen den Server an (MX.demo ist da noch false)');
  /* Fallwechsler-Brücke: Cache aus der Registry, open() auf switchToCase umgehängt. */
  assert.ok(HTML.includes('window.__onlineCaseCache=new Map(registry.map(function(r){return [r.id,{label:r.label,fileNumber:r.fileNumber'),
    'demoBoot füllt den Fall-Cache nicht mehr - alle Modul-Fallwechsler blieben leer');
  assert.match(HTML, /if\(window\.__onlineCaseSync\)window\.__onlineCaseSync\.open=async function\(id\)\{/,
    'Die open\(\)-Brücke auf switchToCase fehlt - Fallwechsel liefe gegen den Server');
  const wechslerGates = (HTML.match(/if\(!window\.__wieOnline\(\)\)return '';/g) || []).length;
  assert.ok(wechslerGates >= 7, `Nur ${wechslerGates} Fallwechsler-Gates über __wieOnline (7 erwartet: ab/hk/hi/ap/fpHub/housing/scope)`);
  assert.ok(HTML.includes("if(window.__demoModus){cases=(window.caseRegistry||[]).map(r=>({id:r.id,label:r.label}));}"),
    'Die Archiv-/Versand-Modale bekämen ihre Fallliste wieder vom gesperrten Server');
  /* Banking-Seitenleiste + Einstellungs-Umleitung am online-only Einstellungsbereich vorbei. */
  assert.ok(HTML.includes('if(!window.__wieOnline())return; /* Banking braucht den Server - in der Vorführung die RAM-Attrappe */'),
    'Der Banking-Einstieg fehlt der Vorführung wieder');
  assert.ok(HTML.includes("if(!window.__adSnapshotId&&!window.__demoModus&&window.openEinstellungenApp)return window.openEinstellungenApp('banking');"),
    'Banking-Einstellungen liefen in der Demo wieder in den online-only Einstellungsbereich');
  /* Chat-Totmann-Uhr gilt auch für die Demo-WebSocket. */
  assert.ok(HTML.includes('if(!window.__wieOnline()||!ws)return;'),
    'Heartbeat/Totmann-Uhr lassen die Demo-Chatverbindung wieder unbewacht');
  /* Sidebar-Suche und Fallübersicht speisen sich aus Registry bzw. Übungspostfach. */
  assert.ok(HTML.includes("faelle=(window.caseRegistry||[]).map(r=>({id:r.id,label:r.label,fileNumber:r.fileNumber||''}))"),
    'Die Fallsuche der Seitenleiste ist in der Vorführung wieder leer');
  assert.match(HTML, /window\.__mxDemoCaseMessages=function\(caseLabel\)\{/,
    'Die Fall-E-Mails der Fallübersicht fehlen der Vorführung');
});

test('Bürovorlagen: generell umbenannt, Alt-Erkennung unangetastet', () => {
  assert.ok(!HTML.includes('Übernahmebereitschaft Zepp'), 'Der alte Vorlagen-Titel mit Klarnamen ist zurück');
  assert.match(HTML, /title:'Betreuungsantrag – Übernahmebereitschaft Betreuer'/, 'Der neue Antrags-Titel fehlt');
  assert.match(HTML, /title:'Betreuerwechsel – Übernahmebereitschaft Betreuer'/, 'Der neue Wechsel-Titel fehlt');
  assert.match(HTML, /label:'Einverständnis mit der Übernahme durch die neue Betreuungsperson'/,
    'Das umbenannte Einverständnis-Feld fehlt');
  assert.ok(!HTML.includes("defaultValue:'St. Goarshausen'"), 'Eine Orts-Vorbelegung mit dem echten Büroort ist zurück');
  /* Die Migrations-Erkennung ALTER Bestände braucht die historischen Texte wortwörtlich. */
  assert.match(HTML, /V159_LEGACY_CARE_APPLICATION_STATEMENT='Hiermit erkläre ich, dass ich dringend Unterstützung in Form einer rechtlichen Betreuung zur Bewältigung meiner Lebensherausforderungen benötige\. Ich bitte um Einrichtung einer rechtlichen Betreuung und möchte, dass diese Betreuung durch Herrn Christoph Zepp, Marktplatz 8, 56346 St\. Goarshausen, übernommen wird\.'/,
    'Die Legacy-Erkennungskonstante wurde verändert - Altbestände würden nicht mehr migriert');
  assert.match(HTML, /\|\|String\(entry\.value\|\|''\)\.trim\(\)===NEUTRAL;/,
    'Der neue Neutraltext gilt nicht als unangetastet - er bliebe nach dem Seeden stehen');
});
