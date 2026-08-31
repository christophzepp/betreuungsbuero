'use strict';
/* Nutzerchat auf dem Telefon (Nutzerwunsch 30.08.2026): „Auch der Chat muss eine
   ganzseitige Ansicht werden!" - vorher schwebte das Panel als Kästchen über der
   Startseite. Geprüft wird der Vertrag beider Ebenen: Vollfläche über der Mobilnavigation
   UND der Wechsel Übersicht <-> Unterhaltung (die linke Spalte ist unter 900px
   ausgeblendet, ohne Wechsel wäre die Übersicht auf dem Telefon unerreichbar). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

test('Chat füllt auf dem Telefon die Fläche über der Mobilnavigation', () => {
  /* Nutzerfund 30.08. abends: Ein freier Streifen UNTER dem Panel zeigte die Startseite -
     und die ließ sich wegscrollen. Das Panel deckt den ganzen Schirm ab und hält den Platz
     für die Navigationsleiste als eigene Polsterung frei. */
  assert.match(html, /html\.mobile-online-active \.uchat-panel\{position:fixed;inset:0;width:auto;height:auto;max-height:none;border:0;border-radius:0;box-shadow:none;padding-bottom:env\(safe-area-inset-bottom,0px\);overscroll-behavior:contain\}/,
    'Das Chat-Panel muss den ganzen Bildschirm abdecken - kein Streifen, keine Reserve.');
  assert.match(html, /html\.mobile-online-active \.uchat-log,\s*\n\s*html\.mobile-online-active \.uchat-side-list\{overscroll-behavior:contain\}/,
    'Am Ende des Verlaufs darf die Seite dahinter nicht mitscrollen.');
  /* Nutzerwunsch 30.08. abends: Im ganzseitigen Chat braucht es die untere Menüleiste gar
     nicht - sie tauchte beim Scrollen der Seite dahinter auf und wieder ab. Solange das Panel
     offen ist, ist sie weg UND die Seite dahinter steht fest. */
  assert.match(html, /html\.mobile-online-active\.uchat-voll-v262 \.mobile-online-shell\{display:none!important\}/,
    'Im Vollbild-Chat darf die Mobilnavigation nicht erscheinen.');
  assert.match(html, /html\.mobile-online-active\.uchat-voll-v262,\s*\n\s*html\.mobile-online-active\.uchat-voll-v262 body\{overflow:hidden!important;overscroll-behavior:none!important\}/,
    'Die Seite hinter dem Chat muss festgestellt sein.');
  assert.match(html, /vollScrollY=window\.scrollY\|\|wurzel\.scrollTop\|\|0;\s*\n\s*wurzel\.classList\.add\('uchat-voll-v262'\);/,
    'Die Rollposition muss VOR dem Feststellen gemerkt werden - sonst springt die Seite beim Einklappen auf 0.');
  assert.match(html, /function vollbildAus\(\)\{[\s\S]{0,320}?classList\.remove\('uchat-voll-v262'\);[\s\S]{0,200}?window\.scrollTo\(0,y\)/,
    'Beim Einklappen müssen Leiste, Beweglichkeit und Rollposition zurückkommen.');
  assert.match(html, /function closePanel\(\)\{[\s\S]{0,220}?vollbildAus\(\);/,
    'Einklappen muss das Vollbild verlassen.');
  assert.match(html, /function teardown\(\)\{vollbildAus\(\);/,
    'Auch beim Abbau des Chats (Abmelden) muss die Leiste zurückkommen.');
  /* Die Regel muss NACH der alten Breitenregel stehen, sonst gewinnt calc(100vw - 16px). */
  assert.ok(html.indexOf('html.mobile-online-active .uchat-panel{width:calc(100vw - 16px)}')
    < html.indexOf('html.mobile-online-active .uchat-panel{position:fixed;inset:0;'),
    'Die Vollflächen-Regel steht vor der alten Breitenregel und würde überschrieben.');
  /* Der Umbruchpunkt ist derselbe, an dem die linke Spalte verschwindet (900px). */
  assert.match(html, /@media\(max-width:900px\)\{\.uchat-body\{grid-template-columns:1fr\}\.uchat-side\{display:none\}\}/,
    'Der bestehende Umbruchpunkt der linken Spalte darf sich nicht verschieben.');
  assert.match(html, /html\.mobile-online-active \.uchat-body\{grid-template-columns:minmax\(0,1fr\);grid-template-rows:minmax\(0,1fr\)\}/,
    'Die sichtbare Ebene muss die ganze Panelhöhe bekommen.');
});

test('Genau eine Ebene je Bildschirm: Übersicht ODER Unterhaltung', () => {
  assert.match(html, /html\.mobile-online-active \.uchat-panel \.uchat-side\{display:flex;border-right:0\}/,
    'Ohne offene Unterhaltung gehört der Bildschirm der Übersicht.');
  assert.match(html, /html\.mobile-online-active \.uchat-panel \.uchat-main\{display:none\}/,
    'Die Unterhaltung darf nicht zusätzlich unter der Übersicht liegen.');
  assert.match(html, /html\.mobile-online-active \.uchat-panel\.uchat-thread-v262 \.uchat-side\{display:none\}/);
  assert.match(html, /html\.mobile-online-active \.uchat-panel\.uchat-thread-v262 \.uchat-main\{display:flex\}/,
    'Mit offener Unterhaltung füllt diese den Bildschirm.');
  /* Der Zurück-Pfeil existiert nur mobil - am Schreibtisch stehen beide Spalten nebeneinander. */
  assert.match(html, /\.uchat-back-v262\{display:none;/,
    'Der Zurück-Pfeil darf am Schreibtisch nicht auftauchen.');
  assert.match(html, /html\.mobile-online-active \.uchat-back-v262\{display:inline-flex\}/);
  assert.match(html, /html\[data-theme="dark"\] \.uchat-back-v262\{color:#9fb1c1\}/,
    'Der Zurück-Pfeil braucht auch im dunklen Modus eine Farbe.');
});

test('Jeder Weg in eine Unterhaltung schaltet die Telefonansicht um', () => {
  /* Liste, Kontakt, neue Gruppe und Hinweisfenster laufen alle über selectConv - deshalb
     genügt dort EIN Schalter. Bricht das auseinander, führt ein Weg ins Leere. */
  assert.match(html, /async function selectConv\(id\)\{activeConvId=id;[\s\S]{0,400}?const pnl=\$\('uchatPanel'\);if\(pnl\)pnl\.classList\.add\('uchat-thread-v262'\);/,
    'selectConv muss auf die Unterhaltungsebene schalten.');
  const wege = html.match(/selectConv\(/g) || [];
  assert.ok(wege.length >= 6, `Erwartet mehrere Einstiege über selectConv, gefunden: ${wege.length}`);
  assert.match(html, /if\(!c\)\{head\.innerHTML='';\$\('uchatComposer'\)\.style\.display='none';const leer=\$\('uchatPanel'\);if\(leer\)leer\.classList\.remove\('uchat-thread-v262'\);return\}/,
    'Ohne Unterhaltung (z. B. gelöscht) muss die Übersicht zurückkommen.');
  assert.match(html, /<button type="button" class="uchat-back-v262" id="uchatBackV262" title="Zurück zur Übersicht" aria-label="Zurück zur Übersicht">'\+ICO\.back\+'<\/button>/,
    'Der Unterhaltungskopf trägt den Zurück-Pfeil.');
  assert.match(html, /const zurueck=\$\('uchatBackV262'\);\s*\n\s*if\(zurueck\)zurueck\.addEventListener\('click',\(\)=>\{const pnl=\$\('uchatPanel'\);if\(pnl\)pnl\.classList\.remove\('uchat-thread-v262'\)\}\);/,
    'Der Zurück-Pfeil muss nach jedem Neuzeichnen des Kopfes wieder verdrahtet sein.');
  assert.match(html, /back:'<svg viewBox="0 0 24 24"[^']*<path d="M15 5l-7 7 7 7"\/><\/svg>'/,
    'Das Pfeil-Symbol fehlt in der Icon-Sammlung des Chats.');
});
