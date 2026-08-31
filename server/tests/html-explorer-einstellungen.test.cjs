'use strict';
/* Pins fuer den Umbau der Datei-Explorer-Einstellungen (08/2026, nach Mockup v2):
   Ueberblick zuerst, Sicherung als eigener Abschnitt, Sprungleiste mit Warnpunkt,
   Reichweiten-Marken mit Farbpunkt, Zwei-Spalten-Raster im Einstellungsmenue,
   EINE Export-Karte, eingeklappte Anlege-Formulare, Experten-Klappe der Vollsicherung. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

test('Abschnittsfolge: Ueberblick zuerst, Sicherung eigener Abschnitt', () => {
  assert.match(HTML, /\.dok-cfg-grid>\.cfg-k12\{order:1\}/, 'Speicherplatz steht als erste Karte im Ueberblick');
  assert.match(HTML, /\.dok-cfg-grid>\.cfg-k1\{order:11\}/, 'Wurzel eroeffnet Ablage & Ordnung');
  assert.match(HTML, /\.dok-cfg-grid>\.cfg-k15\{order:24\}/, 'Export-Ablage schliesst Automatik ab');
  assert.match(HTML, /\.dok-cfg-grid>\.cfg-k6\{order:31\}/, 'Sicherung ist ein eigener Abschnitt');
  assert.match(HTML, /\.dok-cfg-grid>\.cfg-k17\{order:45\}/, 'Fallordner-Paarung beendet Verbindungen');
  const sekte = HTML.match(/class="cfg-sekt" data-sekt="\d"/g) || [];
  assert.strictEqual(sekte.length, 5, 'genau fuenf Abschnitts-Ueberschriften mit data-sekt');
  assert.match(HTML, /data-sekt="0" style="order:0">Überblick – erst sehen, dann stellen</);
  assert.match(HTML, /data-sekt="3" style="order:30">Sicherung – Status · Manuell · Zeitpläne · Erweitert</);
  assert.doesNotMatch(HTML, /class="cfg-sekt" style="order:/, 'kein Abschnitt ohne data-sekt uebrig');
});

test('Karten einspaltig ueber die volle Breite (Nutzerwunsch 30.08.)', () => {
  /* Das Mockup zeigte ein Zwei-Spalten-Raster; nach der ersten Livesicht kam die Ansage
     "Ich haette die Karten lieber ueber die gesamte Breite, als in 2er-Reihe!" - also
     einspaltig UEBERALL. Der Grid-Wrapper bleibt (einheitliche Abstaende, order-Mechanik). */
  assert.match(HTML, /\.dok-cfg-grid\{display:grid;grid-template-columns:1fr;gap:12px/, 'Grid-Wrapper einspaltig');
  assert.doesNotMatch(HTML, /\.dok-cfg-embed \.dok-cfg-grid\{grid-template-columns:repeat/, 'die Zwei-Spalten-Regel ist zurueck');
  assert.doesNotMatch(HTML, /dok-vollbreit/, 'Reste der Vollbreit-Mechanik leben noch');
  assert.match(HTML, /\.dok-cfg-grid>\.dok-karte:hover\{box-shadow/, 'Karten heben sich beim Ueberfahren (Mockup)');
});

test('Sprungleiste: Markup, Springen, Aktiv-Nachfuehrung und Warnpunkt', () => {
  /* Anzeige-Bug 30.08.: sticky top:0 klebt an der PADDING-Innenkante des Scrollers, der
     Inhalt clippt aber erst an der Box-Kante - im padding-top-Streifen (Dialog 18px,
     .set-inhalt 16px) scrollte der Inhalt sichtbar UEBER der Leiste vorbei. Das negative
     top klebt die Leiste bis an die Clipping-Kante. Die Werte sind an die Wirt-Paddings
     GEKOPPELT (.dok-cfg-scroll padding:18px..., .set-inhalt padding:16px...). */
  assert.match(HTML, /\.dok-cfg-nav\{order:-1;position:sticky;top:-18px/, 'Leiste klebt nicht an der Clipping-Kante des Dialogs');
  assert.match(HTML, /\.dok-cfg-embed \.dok-cfg-nav\{top:-16px\}/, 'Leiste klebt nicht an der Clipping-Kante des Einstellungsmenues');
  assert.match(HTML, /\.set-inhalt\{overflow:auto;padding:16px 22px 26px/, 'Das .set-inhalt-Padding hat sich geaendert - top:-16px der Sprungleiste passt nicht mehr');
  assert.match(HTML, /\.dok-cfg-scroll\{[^}]*padding:18px 20px 14px\}/, 'Das Dialog-Padding hat sich geaendert - top:-18px der Sprungleiste passt nicht mehr');
  assert.match(HTML, /\.dok-cfg-nav a\.aktiv\{background:var\(--blue\)/, 'aktiver Chip ist blau gefuellt');
  assert.match(HTML, /\.dok-cfg-nav a:hover\{background:var\(--blue-soft\)\}/, 'Chip-Hover wie im Mockup');
  assert.match(HTML, /scroll-margin-top:64px/, 'Abschnitte springen unter der Leiste ein');
  assert.match(HTML, /__dok\.cfgSpringen=function\(a,i\)\{/, 'Springen-Funktion vorhanden');
  assert.match(HTML, /var abzug=\(nav\?nav\.getBoundingClientRect\(\)\.height:0\)\+10;/, 'Springen rechnet mit der echten Leistenhoehe (zweizeilige Leiste im schmalen Dialog)');
  assert.match(HTML, /function cfgNavBinden\(wurzel\)\{/, 'Aktiv-Nachfuehrung vorhanden');
  assert.match(HTML, /if\(navWurzel\)cfgNavBinden\(navWurzel\);/, 'Nachfuehrung wird nach dem Rendern gebunden');
  assert.match(HTML, /window\.addEventListener\('scroll',tick,\{passive:true,capture:true\}\)/, 'Capture-Listener am Fenster faengt auch Container-Scrolls (Scroller steht beim Binden noch nicht fest)');
  assert.match(HTML, /window\.removeEventListener\('scroll',tick,true\)/, 'Listener raeumt sich nach Re-Render selbst ab');
  /* Warnpunkt (Mockup): roter Punkt am Ueberblick-Chip, gespeist aus der Speicherplatz-Pruefung. */
  assert.match(HTML, /\.dok-cfg-nav \.warnpunkt\{width:8px;height:8px;border-radius:50%/, 'Warnpunkt-Optik definiert');
  assert.match(HTML, /<span class="warnpunkt" title="Warnung: wenig Speicherplatz"><\/span>/, 'Warnpunkt sitzt am Ueberblick-Chip');
  assert.match(HTML, /navWp\.classList\.toggle\('an',knapp\)/, 'speicherLaden schaltet den Warnpunkt');
  assert.match(HTML, /\.dok-cfg-nav a b\{font-weight:800\}/, 'Ueberblick-Chip ist fett wie im Mockup');
});

test('Reichweiten-Marken: Mockup-Farben mit Farbpunkt (buero gruen, ich blau, geraet violett)', () => {
  assert.match(HTML, /\.dok-marke::before\{content:"";width:6px;height:6px;border-radius:50%;background:currentColor/, 'Marken tragen den Farbpunkt');
  assert.match(HTML, /\.dok-marke\.mb\{background:#eef7ef;color:#237a3b;border:1px solid #cfe7d4\}/, 'Bueroweit ist gruen wie im Mockup');
  assert.match(HTML, /\.dok-marke\.mp\{background:#eaf3fb;color:#25628f;border:1px solid #cadff0\}/, 'Nur Sie ist blau wie im Mockup');
  assert.match(HTML, /\.dok-marke\.mg\{background:#f3eefa;color:#6b4d95;border:1px solid #ddd0ee\}/, 'Dieses Geraet ist violett wie im Mockup');
  const bueroweit = (HTML.match(/<span class="dok-marke mb">Büroweit<\/span>/g) || []).length;
  assert.ok(bueroweit >= 11, 'bueroweite Karten tragen die Marke (Legende + mind. 10 Karten), gefunden: ' + bueroweit);
  assert.match(HTML, /Als Laufwerk freigeben \(WebDAV\)<span class="dok-marke mp">Nur Sie<\/span>/, 'WebDAV-Freigabe ist persoenlich markiert');
  assert.match(HTML, /Export-Ablage<span class="dok-marke mg">Dieses Gerät<\/span>/, 'Export-Ablage ist geraetebezogen markiert');
  assert.doesNotMatch(HTML, /Dokumentenspeicher-Wurzel \(büroweit\)/, 'Klammerzusatz der Wurzel durch Marke ersetzt');
  assert.doesNotMatch(HTML, /automatisch erkennen \(büroweit\)/, 'Klammerzusatz der Texterkennung durch Marke ersetzt');
});

test('Anlege-Formulare eingeklappt: Karten zeigen wie im Mockup erst den Kopf', () => {
  assert.match(HTML, /<details class="dok-klappe"><summary>Verbindung hinzufügen …<\/summary>'\+mntFormulareHTML\(\)/, 'WebDAV/Lokal-Formulare in der Klappe');
  assert.match(HTML, /<details class="dok-klappe"><summary>Bei Microsoft oder Google anmelden …<\/summary>/, 'OneDrive/GDrive-Anmeldung in der Klappe');
  assert.match(HTML, /<details class="dok-klappe"><summary>\+ Import-Eingang anlegen …<\/summary>/, 'Import-Formular in der Klappe');
  assert.match(HTML, /<details class="dok-klappe"><summary>\+ Paarung anlegen …<\/summary>/, 'Paarungs-Formular in der Klappe');
  assert.ok(HTML.indexOf('onclick="__dok.paarErkennen()"') < HTML.indexOf('<details class="dok-klappe"><summary>+ Paarung anlegen …'),
    'Fallordner-Erkennen bleibt sofort sichtbar VOR der Klappe (Mockup)');
  /* Nach Aenderungen wird der OFFENE Ort neu gezeichnet - eingebettet legte sich sonst der Vollbild-Dialog darueber. */
  assert.match(HTML, /function cfgNeuZeichnen\(\)\{/, 'Neuzeichnen-Helfer vorhanden');
  assert.match(HTML, /try\{await ladeBaum\(\);\}catch\(_lb\)\{\}\n    cfgNeuZeichnen\(\);/, 'Verbindung-Anlegen zeichnet den offenen Ort neu (Baum nur best-effort: /tree wirft 400 ohne offenes Modul)');
  assert.match(HTML, /async function ladeMounts\(\)\{/, 'Verbindungsliste hat einen eigenen, nie werfenden Lader');
  assert.match(HTML, /D\.cfg=cfg;[\s\S]{0,300}await ladeMounts\(\);/, 'einstellungen() laedt die Verbindungsliste selbst - eingebettet lief ladeBaum nie');
  assert.match(HTML, /cfgNeuZeichnen\(\);render\(\);/, 'Verbindung-Entfernen zeichnet den offenen Ort neu');
  assert.match(HTML, /setTimeout\(function\(\)\{ cfgNeuZeichnen\(\); \},400\);/, 'OAuth-Rueckkehr zeichnet den offenen Ort neu');
  /* Die Formular-IDs muessen erhalten bleiben - die Lade-/Anlege-Funktionen greifen per getElementById zu. */
  for (const id of ['dokMwLabel', 'dokOdLabel', 'dokGdLabel', 'dokImpLabel', 'dokPaarLabel']) {
    assert.match(HTML, new RegExp('id="' + id + '"'), id + ' ist beim Einklappen verloren gegangen');
  }
});

test('Export-Ablage: nur noch EINE Karte, Doppelkarte samt Funktion entfernt', () => {
  assert.doesNotMatch(HTML, /cfg-k18/, 'die doppelte Export-Karte ist weg');
  assert.doesNotMatch(HTML, /id="dokExpModus"/, 'alte Modus-Auswahl entfernt');
  assert.doesNotMatch(HTML, /id="dokExpZiel"/, 'altes Zielfeld entfernt');
  assert.doesNotMatch(HTML, /__dok\.expAblage\s*=/, 'alte Speicherfunktion entfernt');
  assert.match(HTML, /id="dokExpAblModus"/, 'die verbleibende Karte nutzt weiter dokExpAblModus');
  assert.match(HTML, /__dok\.exportAblageSpeichern=function/, 'ihre Speicherfunktion bleibt');
  assert.match(HTML, /id="dokExpAblBereich"/, 'der Nachfrage-Dialog des Download-Abgriffs bleibt unberuehrt');
  assert.match(HTML, /Bei „Automatisch" wird der Zielordner angelegt, falls er fehlt/, 'Erklaerdetail der alten Karte wandert in die verbleibende');
});

test('Sicherung: gegliedert in Stand/Zeitplaene, Experten-Klappe mit sichtbaren Pflichtteilen', () => {
  /* Gliederung (Mockup: Status · Manuell · Zeitplaene · Erweitert) */
  assert.match(HTML, /<div class="dok-bk-teil">Stand der Sicherung<\/div>'\+gesundHtml/, 'Stand-Ueberschrift vor der Ampel');
  assert.match(HTML, /<div class="dok-bk-teil">Zeitpläne<\/div>/, 'Zeitplaene-Ueberschrift vor Liste und Formular');
  assert.match(HTML, /var fuellung=status==='ok'\?'#f0f7f1':\(status==='critical'\?'#fdeeec':'#fff7ec'\);/, 'Status-Kachel ist getoent wie die Mockup-Warn-Kachel');
  assert.match(HTML, /Gesamtsicherung<\/strong> ist hier direkt aktivierbar, aber erst ein bewusst angelegter und aktivierter Zeitplan macht sie automatisch\.<\/p>/, 'k6-Intro ist auf den Kernsatz gekuerzt');
  assert.match(HTML, /Die Gesamtsicherung eines Zeitplans sichert SQLite konsistent/, 'die Detail-Saetze stehen jetzt bei den Zeitplaenen');
  /* Klappe */
  const anfang = HTML.indexOf('<details id="dokBkExperten" class="dok-klappe">');
  assert.ok(anfang > 0, 'Klappe vorhanden');
  assert.match(HTML, /<details id="dokBkExperten" class="dok-klappe"><summary>Erweiterte Absicherung – Generationenplan, verschlüsselte Zweitkopie, Erfolgs-Heartbeat<\/summary>/);
  assert.match(HTML, /Für den Normalbetrieb genügen die Vorgaben\./, 'Erklaerungssatz oeffnet die Klappe (Mockup)');
  const bestaetigung = HTML.indexOf('id="dokBkLocalEncrypted"');
  const retention = HTML.indexOf('id="dokBkRetention"');
  const heartbeatTimeout = HTML.indexOf('id="dokBkHeartbeatTimeout"');
  const ende = HTML.indexOf("+'</details>'", anfang);
  const aktionen = HTML.indexOf('id="dokBkZielAktionen"');
  assert.ok(bestaetigung < anfang, 'Verschluesselungs-Bestaetigung bleibt VOR der Klappe sichtbar');
  assert.ok(anfang < retention && retention < ende, 'Generationenplan liegt in der Klappe');
  assert.ok(anfang < heartbeatTimeout && heartbeatTimeout < ende, 'Heartbeat liegt in der Klappe');
  assert.ok(ende < aktionen, 'Vorpruefungs-Knoepfe bleiben NACH der Klappe sichtbar');
  assert.match(HTML, /var klappe=el\('dokBkExperten'\);if\(klappe\)klappe\.open=true;/, 'Bearbeiten oeffnet die Klappe');
});

test('Dunkelmodus: neue Klassen sind abgedeckt', () => {
  assert.match(HTML, /html\[data-theme="dark"\] \.dok-cfg-nav a\.aktiv\{background:#2f6e9f/);
  assert.match(HTML, /html\[data-theme="dark"\] \.dok-marke\.mb\{background:#20402a/, 'Bueroweit-Marke dunkelgruen');
  assert.match(HTML, /html\[data-theme="dark"\] \.dok-marke\.mg\{background:#33284a/);
  assert.match(HTML, /html\[data-theme="dark"\] \.dok-klappe\[open\]\{background:#14232c/);
  assert.match(HTML, /html\[data-theme="dark"\] \.dok-bk-teil\{color:#9fb5c3/);
  assert.match(HTML, /html\[data-theme="dark"\] \.dok-cfg-nav \.warnpunkt\{background:#f07870/, 'Warnpunkt bleibt im Dunkeln sichtbar (Skeptiker-Fund)');
  assert.match(HTML, /html\[data-theme="dark"\] \.dok-bk-status\{background:#243038/, 'getoente Status-Kachel hat eine Dunkel-Entsprechung');
});

test('Lesbarkeit: Kartentexte mit Lesebreite', () => {
  assert.match(HTML, /\.dok-cfg-grid \.dok-karte>p\{max-width:80ch\}/);
});
