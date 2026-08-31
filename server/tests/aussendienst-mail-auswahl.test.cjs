'use strict';
/* Außendienst: Mail-Ordner-Auswahl und Aufräumrunde (Nutzerentscheide 30.08.2026).

   Beschlossen wurde:
   • Ordnerliste je Konto im Erstell-Dialog (Standard: alles an außer Papierkorb/Spam),
   • die 100er-Grenze je Ordner BLEIBT und wird ehrlich ausgewiesen,
   • Posteingang + Qualifikationsmanager reisen unterwegs nicht mehr als Menüpunkte mit,
   • drei Einstellungs-Reste bleiben (KI/Diagnose/Stammdaten-Ansicht), der Rest wird
     aufgeräumt: ein Nutzer-Menü-Anker statt neun toter Einzelregeln, kein Doppelbau
     (calconn, Kompat-Datenadmin), Admin-Panel-Hintertür zu,
   • die Mail-Liste im Büro blättert echt (offset) statt am Limit zu ersticken.

   Der Sammler-Filter wird AUSGEFÜHRT (vm mit fetch-Attrappe), nicht nur gepinnt. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

function schnipsel(von, bis) {
  const a = HTML.indexOf(von);
  assert.ok(a >= 0, `Anker fehlt: ${von}`);
  const b = HTML.indexOf(bis, a);
  assert.ok(b > a, `Endanker fehlt: ${bis}`);
  return HTML.slice(a, b);
}

/* __adMailSammeln mit fetch-Attrappe ausführen: zwei Konten, je drei Ordner. */
async function sammle(konten) {
  const src = schnipsel('  function jsonHolen(pfad) {', '  /* D16: Falldateien des Dokumentenspeichers');
  const antworten = {
    '/api/mailbox/accounts': { accounts: [{ id: 'a1', label: 'Büro' }, { id: 'a2', label: 'Privat' }] },
    '/api/mailbox/drafts': { drafts: [] },
    '/api/mailbox/templates': { templates: [] },
    '/api/mailbox/prefs': { prefs: {} },
  };
  for (const acc of ['a1', 'a2']) {
    antworten[`/api/mailbox/accounts/${acc}/folders`] = { folders: [
      { path: 'INBOX', name: 'Posteingang', specialUse: '\\Inbox' },
      { path: 'Archiv/2026', name: '2026', specialUse: '' },
      { path: 'Trash', name: 'Papierkorb', specialUse: '\\Trash' },
    ] };
  }
  const rufe = [];
  const ctx = {
    window: {},
    Promise, Object, Array, JSON, Math, Date, String, Number, isNaN, Error, encodeURIComponent,
    fetch: async (url) => {
      const pfad = String(url).split('?')[0];
      rufe.push(String(url));
      if (antworten[pfad]) return { ok: true, json: async () => antworten[pfad] };
      if (/\/messages$/.test(pfad)) {
        return { ok: true, json: async () => ({ messages: [
          { uid: 'u1', date: new Date().toISOString(), subject: 'Test' },
        ] }) };
      }
      if (/\/message$/.test(pfad)) return { ok: true, json: async () => ({ message: { html: 'x' } }) };
      return { ok: false, status: 404, json: async () => ({}) };
    },
  };
  vm.createContext(ctx);
  /* Der Schnipsel beginnt hinter der MAIL-Konstante des Blocks - hier nachreichen. */
  vm.runInContext("var MAIL='/api/mailbox';\n" + src + '\nthis.__sammeln=window.__adMailSammeln;', ctx);
  return { erg: await ctx.__sammeln({ wochen: 4, anhaenge: false, konten }, () => {}), rufe };
}

test('Sammler: ohne Auswahl reist alles mit (Altverhalten bleibt)', async () => {
  const { erg } = await sammle(null);
  assert.strictEqual(erg.daten.konten.length, 2);
  assert.strictEqual((erg.daten.ordner.a1 || []).length, 3, 'Ohne Auswahl müssen alle Ordner mitreisen');
});

test('Sammler: abgewähltes Konto und abgewählte Ordner bleiben vollständig zu Hause', async () => {
  const { erg, rufe } = await sammle({
    a2: { an: false, ordner: {} },
    a1: { an: true, ordner: { 'Trash': false } },
  });
  assert.deepStrictEqual(erg.daten.konten.map((a) => a.id), ['a1'], 'Das abgewählte Konto ist mitgereist');
  assert.deepStrictEqual((erg.daten.ordner.a1 || []).map((f) => f.path).sort(), ['Archiv/2026', 'INBOX'],
    'Der abgewählte Papierkorb reist mit (oder ein gewählter Ordner fehlt)');
  assert.ok(!erg.daten.ordner.a2, 'Für das abgewählte Konto wurden dennoch Ordner abgelegt');
  assert.ok(!rufe.some((u) => u.includes('/accounts/a2/messages')),
    'Für das abgewählte Konto wurden dennoch Nachrichten abgerufen');
  assert.ok(!rufe.some((u) => u.includes('folder=Trash')),
    'Für den abgewählten Ordner wurden dennoch Nachrichten abgerufen');
  assert.ok(erg.bericht.uebersprungen.some((t) => /Konto\/Konten abgewählt/.test(t)),
    'Der Bericht verschweigt das abgewählte Konto');
});

test('Sammler: fehlende Einträge gelten als angewählt (Neues fehlt nicht still)', async () => {
  const { erg } = await sammle({ a1: { an: true, ordner: {} } }); /* a2 hat keinen Eintrag */
  assert.strictEqual(erg.daten.konten.length, 2, 'Ein Konto ohne Eintrag muss mitreisen');
  assert.strictEqual((erg.daten.ordner.a1 || []).length, 3, 'Ordner ohne Eintrag müssen mitreisen');
});

test('Sammler: alle Konten abgewählt wird ehrlich gemeldet', async () => {
  const { erg } = await sammle({ a1: { an: false }, a2: { an: false } });
  assert.ok(erg.bericht.fehler.some((f) => /Alle Mailkonten abgewählt/.test(f)),
    'Die Voll-Abwahl muss im Bericht stehen, nicht wie ein leerer Server aussehen');
});

test('Die 100er-Grenze: angefordert wird nicht mehr als der Server je liefert', () => {
  assert.match(HTML, /var proOrdner = Math\.max\(1, Math\.min\(100, \+opt\.proOrdner \|\| 100\)\);/,
    'Der Sammler fordert wieder mehr an, als die Server-Leitplanke (100) hergibt');
  assert.match(HTML, /höchstens die <b>neuesten 100 Nachrichten<\/b> mit/,
    'Der Erstell-Dialog verschweigt die 100er-Grenze wieder');
  assert.match(HTML, /sie liegt außerhalb des gewählten Zeitfensters, jenseits der 100 neuesten ihres Ordners oder in einem abgewählten Ordner\./,
    'Der Unterwegs-Hinweis nennt wieder nur das Zeitfenster als Grund');
});

test('Dialog: Ordnerwahl mit Papierkorb/Spam-Vorgabe ist verdrahtet', () => {
  assert.match(HTML, /id="adMailKonten"/, 'Der Ordnerwahl-Container fehlt im Dialog');
  assert.match(HTML, /k\.ordner\[f\.path\]=!\(f\.specialUse==='\\\\Trash'\|\|f\.specialUse==='\\\\Junk'\);/,
    'Die Vorgabe „alles außer Papierkorb und Spam" fehlt');
  assert.match(HTML, /window\.__adMailKontenLaden=adMailKontenLaden;/, 'Der Nachlader ist nicht veröffentlicht');
  assert.match(HTML, /window\.__adMailOrdnerWahl=function\(accId,pfad,an\)\{/, 'Der Ordner-Handler fehlt');
  /* Nutzerwunsch 30.08. (Praxis: 67 Outlook-Ordner): je Konto zwei Sammel-Knöpfe, die die
     aufgeklappte Liste NICHT neu zeichnen (sie klappte sonst wieder zu). */
  assert.match(HTML, /window\.__adMailOrdnerAlle=function\(accId,an,knopf\)\{/,
    'Die Alle-auswählen/-abwählen-Knöpfe je Konto fehlen');
  assert.match(HTML, /kasten\.querySelectorAll\('input\[data-pfad\]'\)\.forEach\(function\(c\)\{c\.checked=!!an;\}\);/,
    'Die Sammel-Knöpfe ziehen die Häkchen nicht mehr im Ort nach (Neuzeichnen klappte die Liste zu)');
  const alleKnoepfe = (HTML.match(/__adMailOrdnerAlle\(\\/g) || []).length; /* nur die onclick-Aufrufe */
  assert.strictEqual(alleKnoepfe, 2, 'Es fehlen die beiden Knopf-Aufrufe je Konto (' + alleKnoepfe + ' Fundstellen)');
  /* Nutzerwunsch 30.08. (2. Runde): die Alle-auswählen/-abwählen-Bedienung ist TEXT wie im
     Adressbuch (.ab-link-btn) - kein Knopf-Kasten. Gilt für Fälle, Dokumente UND Ordner. */
  assert.match(HTML, /\.ad-bulk-btn\{display:inline!important;background:none!important;border:none!important/,
    'Die Alle-Bedienung ist wieder ein Knopf-Kasten statt Textlink (Adressbuch-Vorbild)');
  assert.match(HTML, /html\[data-theme="dark"\] #modal:has\(\.ad-dialog\) \.ad-bulk-btn\{background:none!important;border:none!important;color:#8fc6ea!important\}/,
    'Die Dunkel-Fassung der Textlinks fehlt');
  const trenner = (HTML.match(/<span class="ad-bulk-sep">·<\/span>/g) || []).length;
  assert.strictEqual(trenner, 3, 'Der Punkt-Trenner fehlt an einer der drei Alle-Zeilen (' + trenner + '/3)');
  /* Der Lader startet nach dem Zeichnen des Dialogs - nicht davor (Dialog bliebe sonst stehen). */
  assert.match(HTML, /zeichnen\(\);\s*\n\s*\/\* Ordnerliste nachladen, ohne den Dialog aufzuhalten/,
    'Der Ordner-Nachlader hängt nicht mehr am Dialog-Aufbau');
});

test('Aufräumrunde: kein Doppelbau, Hintertür zu', () => {
  /* calconn: im AD nicht mehr bauen (wurde sofort wieder versteckt). */
  /* 30.08. Demo-Vollausbau: __wieOnline() = online ODER demo - im AD ist beides false,
     die AD-Ausnahme gilt also unverändert (zusätzlich hält !__adSnapshotId). */
  assert.match(HTML, /window\.addEventListener\('appLoginReady',\(\)=>\{ if\(window\.__wieOnline\(\)&&!window\.__adSnapshotId\)\{ install\(\);/,
    'Der Kalender-Verbindungs-Eintrag wird im AD wieder gebaut (und sofort versteckt)');
  /* Kompat-Datenadmin: der Bau ist raus, der programmatische Weg bleibt. */
  assert.doesNotMatch(HTML, /installCaseAdminMenu\(\);\s*\n\s*patchOnlineSync\(\);/,
    'Der Kompat-Durchgang baut die Datenadministration wieder (und der Aufräumer versteckt sie sofort)');
  assert.match(HTML, /open:openCase,openAdmin:openAdmin/,
    'Der programmatische Weg (__onlineCaseSync.openAdmin) ist verloren gegangen');
  /* Admin-Panel: gleicher Riegel wie am Einstellungsmenü. */
  assert.match(HTML, /if\(window\.__adSnapshotId\)\{try\{toast\('In der Außendienst-Datei gibt es die Verwaltung bewusst nicht/,
    'Die Admin-Panel-Hintertür im Außendienst steht wieder offen');
});

test('AD-Datei: Reinladeassistent hält die Dokumente nicht mehr gefangen (Nutzerfund 30.08.)', () => {
  /* Die AD-Datei bootet ohne Fall im Browser-Speicher; der Assistent (Runde 17) wartete auf
     einen "Weiter", den es dort nie gibt - buildStartNav blieb auf no-case, #startNav
     (Falldaten/Dokumente) wurde nie gebaut. Die Datei bringt ihre Fälle mit - genau das
     sagt das Boot-Flag. */
  assert.match(HTML, /window\.__startWizardHadCaseAtBoot=true;\s*\n\s*var erster=\(window\.caseRegistry\[0\]\|\|\{\}\)\.id;/,
    'Das Boot-Flag vor dem ersten Fallöffnen fehlt - unterwegs erscheinen wieder keine Dokumente');
});

test('AD-Aufräumer: die Markierung versteckt selbst - der Rechte-Anwender deckt nichts mehr auf', () => {
  /* Nutzerfund 30.08.: applyMenuPermissionUI läuft NACH dem Aufräumer und setzte
     style.display zurück (Datei-Betrieb: jeder darf alles) - Karten/Export/Datenadmin
     standen wieder in der Leiste. Jetzt trägt data-ad-weg die Ausblendung per CSS. */
  assert.match(HTML, /html\[data-ad-runtime\] \[data-ad-weg\],/,
    'Die CSS-Ausblendung über die data-ad-weg-Markierung fehlt');
  for (const attr of ['data-dok-settings-menu', 'data-bank-settings-menu']) {
    assert.ok(HTML.includes(`'${attr}',`) || HTML.includes(`'${attr}'`),
      `Der geklonte Server-Eintrag ${attr} hat keine Entfernen-Regel mehr`);
  }
});

test('Mail-Liste im Büro blättert echt statt am Limit zu ersticken', () => {
  assert.match(HTML, /const anfuegen=MX\.list\.nachladen===true&&MX\.list\.messages\.length>0;/,
    'Der Anfüge-Modus der Mail-Liste fehlt');
  assert.match(HTML, /const offset=anfuegen\?MX\.list\.messages\.length:0;/,
    'Die Liste blättert nicht mehr über den offset');
  assert.match(HTML, /const bekannt=new Set\(MX\.list\.messages\.map\(m=>String\(m\.uid\)\)\);/,
    'Die Dubletten-Wache beim Anfügen fehlt (offset verschiebt sich bei neuer Post)');
  assert.match(HTML, /more\(\)\{MX\.list\.nachladen=true;MX\.list\.limit\+=40;loadList\(false\)\.finally/,
    'Der Mehr-Knopf setzt das Anfüge-Zeichen nicht mehr (oder verliert das Limit-Wachstum des Gesamt-Posteingangs)');
  /* Der Gesamt-Posteingang ist die STANDARD-Ansicht - mit einem Konto stand er vor dem
     Umbau bei 100 fest (je Konto lief das wachsende Limit in die Server-Leitplanke).
     Am Prüfstand belegt: 40->240 in 40er-Schritten, Knopf verschwindet bei Gesamtzahl. */
  assert.match(HTML, /const anfuegenU=MX\.list\.nachladen===true&&MX\.list\.messages\.length>0;/,
    'Das Blättern des Gesamt-Posteingangs fehlt');
  assert.match(HTML, /const offU=anfuegenU\?MX\.list\.messages\.filter\(m=>String\(m\.__acc\)===String\(a\.id\)\)\.length:0;/,
    'Der je-Konto-offset des Gesamt-Posteingangs fehlt (jede Kontoliste zählt ihre eigenen geladenen Nachrichten)');
});
