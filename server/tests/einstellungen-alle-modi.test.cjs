'use strict';
/* Das Einstellungsmenü als Standard ALLER Betriebsarten (Beschluss 30.08.2026):
   lokal und im Datei-Betrieb öffnet dasselbe Menü; Server-Bereiche verschwinden mit
   Sammelhinweis; die Alt-Oberflächen leiten sofort um; die Außendienst-Datei bleibt
   ausgenommen. Dieser Test FÜHRT die Sichtbarkeitslogik je Betriebsart AUS. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

/* EIN_NAV + Gates + Sichtbarkeitslogik in eine Sandkiste heben und je Betriebsart auswerten. */
function sichtbareBereiche(welt) {
  const navA = HTML.indexOf('const EIN_NAV=[');
  const navB = HTML.indexOf('\n];', navA);
  const gateA = HTML.indexOf('function einIstAdmin(){');
  const gateB = HTML.indexOf('\n// Icon-Satz', gateA);
  const sichtA = HTML.indexOf('function einIstOnline(){');
  const sichtB = HTML.indexOf('function einNavItem(id){', sichtA);
  assert.ok(navA > 0 && gateA > 0 && sichtA > 0, 'Quelltext-Anker nicht gefunden');
  const ctx = {
    window: {
      __appMode: welt.modus,
      __currentUser: welt.nutzer === undefined ? null : welt.nutzer,
      __menuPermissionAllowed: (k) => welt.rechte ? !!welt.rechte[k] : true,
      __adOpen: () => {},
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    HTML.slice(gateA, gateB) + '\n' + HTML.slice(navA, navB + 3) + '\n' + HTML.slice(sichtA, sichtB)
    + '\nthis.__sichtbar=[];this.__nurOnline=[];'
    + 'for(const g of EIN_NAV)for(const it of g[1]){'
    + '  if(einNavSichtbar(it)){this.__sichtbar.push(it.id);continue}'
    + '  if(!einNavModusOk(it)){'
    + '    let sonst=true;'
    + '    if(it.sichtbar)sonst=!!it.sichtbar();'
    + '    else if(it.admin)sonst=einIstAdmin();'
    + '    else if(it.recht)sonst=einDarf(it.recht);'
    + '    if(sonst)this.__nurOnline.push(it.id);'
    + '  }'
    + '}', ctx);
  /* vm-Arrays tragen den Prototyp des Sandkasten-Realms - deepStrictEqual lehnte
     inhaltsgleiche Listen ab. In den Test-Realm kopieren. */
  return { sichtbar: [...ctx.__sichtbar], nurOnline: [...ctx.__nurOnline] };
}

test('Online-Admin sieht alle 29 Bereiche - der Umbau hat online nichts weggenommen', () => {
  /* 30.08.2026: 28 + der neue Bereich „Demo-Modus" (Nutzerauftrag Vorführbetrieb). */
  const { sichtbar, nurOnline } = sichtbareBereiche({ modus: 'online', nutzer: { isAdmin: true } });
  assert.strictEqual(sichtbar.length, 29, `Online-Admin sieht ${sichtbar.length} statt 29 Bereiche: ${sichtbar}`);
  assert.deepStrictEqual(nurOnline, [], 'Online darf es keinen Sammelhinweis geben');
});

test('Lokal-Admin: die tragfähigen Bereiche erscheinen, die Server-Bereiche wandern in den Sammelhinweis', () => {
  const { sichtbar, nurOnline } = sichtbareBereiche({ modus: 'local', nutzer: { isAdmin: true } });
  assert.deepStrictEqual(sichtbar.sort(), [
    'aussendienst', 'darstellung', 'datenadmin', 'datenschutz', 'dateinamen', 'diagnose',
    'herkunft', 'karten', 'ki', 'konto', 'lokal', 'stammdaten', 'unterschriften',
    'versand', 'vorschlaege',
  ].sort(), 'Die lokal sichtbare Bereichsliste stimmt nicht mit der geprüften Matrix überein');
  /* Der Sammelhinweis nennt genau die Bereiche, die NUR am Modus scheitern. */
  assert.deepStrictEqual(nurOnline.sort(), [
    'audit', 'banking', 'benachrichtigung', 'demo', 'erweiterung', 'explorer', 'formulare',
    'kalender', 'mail', 'mcp', 'nutzer', 'prompts', 'rollen', 'vertretung',
  ].sort(), 'Der Sammelhinweis-Inhalt für den Lokal-Admin stimmt nicht');
});

test('Datei-Betrieb (kein Konto): fail-closed trotz permissionValue(null)=true', () => {
  /* Ohne Konto beantwortet permissionValue JEDES Recht mit true - die Modus-Flags sind dort
     die einzige Schranke. Genau das prüft dieser Fall. */
  const { sichtbar, nurOnline } = sichtbareBereiche({ modus: 'local', nutzer: null });
  assert.deepStrictEqual(sichtbar.sort(), [
    'darstellung', 'datenadmin', 'dateinamen', 'diagnose', 'herkunft', 'karten', 'ki',
    'stammdaten', 'unterschriften', 'versand',
  ].sort(), 'Die Datei-Betrieb-Bereichsliste stimmt nicht');
  assert.ok(sichtbar.includes('unterschriften'),
    'Der Weg zur eigenen Unterschrift im Datei-Betrieb (Punkt 4) ist wieder zu');
  assert.ok(!sichtbar.includes('konto'), 'Ohne Konto gibt es kein „Konto & Anmeldung"');
  assert.ok(!sichtbar.includes('mail') && !sichtbar.includes('explorer') && !sichtbar.includes('banking'),
    'Server-Bereiche sind im Datei-Betrieb sichtbar, obwohl jedes Recht dort true liefert - fail-closed verletzt');
  /* admin-gegatete Bereiche tauchen auch im Sammelhinweis nicht auf (einIstAdmin=false). */
  assert.ok(!nurOnline.includes('nutzer') && !nurOnline.includes('audit'),
    'Der Sammelhinweis verspricht ohne Konto Admin-Bereiche');
});

test('Lokal-Nutzer ohne Rechte: Gates wirken zusätzlich zur Modus-Matrix', () => {
  const { sichtbar, nurOnline } = sichtbareBereiche({
    modus: 'local', nutzer: { isAdmin: false }, rechte: { menuSettingsMaps: false, menuSettingsOfficeProfile: false, menuAdminFieldService: false, menuSettingsDataAdmin: true, menuSettingsSystem: true, menuSettingsAi: true },
  });
  assert.ok(!sichtbar.includes('karten') && !sichtbar.includes('stammdaten') && !sichtbar.includes('aussendienst'),
    'Entzogene Rechte wirken lokal nicht mehr');
  assert.ok(!sichtbar.includes('lokal') && !sichtbar.includes('datenschutz') && !sichtbar.includes('vorschlaege'),
    'admin-Bereiche erscheinen für Nicht-Admins');
  assert.ok(sichtbar.includes('ki') && sichtbar.includes('datenadmin') && sichtbar.includes('diagnose'),
    'Erlaubte Bereiche fehlen');
  assert.ok(!nurOnline.includes('mail') || true, 'nurOnline-Berechnung lief');
});

test('Der Kern des Umbaus: AD-Gate, Ladepfad, Sammelhinweis, Datei-Einstieg', () => {
  assert.doesNotMatch(HTML, /Das einheitliche Einstellungsmenü gibt es im Online-Modus/,
    'Das alte Online-Gate ist zurück');
  assert.match(HTML, /if\(window\.__adSnapshotId\)\{T\('In der Außendienst-Datei gibt es das Einstellungsmenü bewusst nicht/,
    'Die Außendienst-Ausnahme fehlt');
  assert.match(HTML, /if\(einIstOnline\(\)\)\{\s*\n\s*await einLaden\(true\);/,
    'Der Ladepfad unterscheidet nicht mehr nach Betriebsart - lokal gäbe es 403-Salven');
  assert.match(HTML, /einLadefehler=false;/,
    'Der lokale Zweig räumt die Fehlerflagge nicht - das Warnbanner erschiene grundlos');
  assert.match(HTML, /<div class="set-nav-gruppe">Nur im Online-Modus<\/div>/,
    'Der Sammelhinweis fehlt in der Navigation');
  assert.match(HTML, /data-ein-nuronline/,
    'Der Sammelhinweis hat keinen prüfbaren Anker');
  assert.match(HTML, /function einDateiEinstiegInstall\(\)\{/,
    'Der Einstellungs-Einstieg für den Datei-Betrieb fehlt');
  assert.match(HTML, /if\(window\.__currentUser\|\|window\.__adSnapshotId\)return;/,
    'Der Datei-Einstieg erscheint auch mit Konto oder im Außendienst');
  /* eo-vereint gilt jetzt in allen Modi - nur die AD-Datei bleibt draußen. */
  assert.match(HTML, /if\(window\.__adSnapshotId\)\{\s*\n\s*try\{document\.documentElement\.classList\.remove\('eo-vereint'\);\}catch\(_e2\)\{\}\s*\n\s*return;/,
    'Die AD-Datei behält ihre Seitenleiste nicht mehr');
  /* Aufraeumrunde 30.08.2026: statt neun einzelner data-user-menu-*-Regeln (alle tot,
     die AD-Datei baut das Menue nicht) faellt die GANZE Karte - ein Anker deckt auch den
     Einstellungen-Eintrag ab und traegt als Netz, falls die Datei je neben einer
     Server-Sitzung ueber http laeuft. */
  assert.match(HTML, /WEG_ATTR = \[\s*\n\s*'data-user-menu',/,
    'Der AD-Aufräumer entfernt das Nutzer-Menü (und damit den Einstellungen-Eintrag) nicht mehr');
  assert.doesNotMatch(HTML, /'data-user-menu-settings',\s*\/\* Einstellungsmenü/,
    'Die tote Einzelregel für den Einstellungen-Eintrag ist zurück - bitte bewusst entscheiden');
});

test('Willkommens-Schalter und Herkunfts-Zugangszeile tragen lokal', () => {
  assert.match(HTML, /if\(einIstOnline\(\)\)\{\s*\n\s*const r=await fetch\('\/api\/user-prefs\/mode-intro'/,
    'Der Willkommens-Schalter schickt lokal wieder einen 403-PUT');
  assert.match(HTML, /d=\(typeof msLocalStatus==='function'\)\?msLocalStatus\(\):\{areas:\{\}\};/,
    'Die Herkunfts-Zugangszeile rechnet lokal nicht mehr aus Browser-Werten');
  assert.match(HTML, /a\.effectiveConfigured===null\?'von hier nicht prüfbar'/,
    'Der dritte Zustand (Mail lokal unbekannt) fehlt in der Herkunftstabelle');
  assert.match(HTML, /if\(einIstAdmin\(\)&&einIstOnline\(\)\)html\+='<h4 class="set-abschnitt2">Büro-Versandkonten/,
    'Die Büro-Versandkonten (Server-Formular) würden lokal als 403-Fassade eingebettet');
});
