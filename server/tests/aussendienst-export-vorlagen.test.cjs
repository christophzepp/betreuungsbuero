'use strict';
/* Außendienst-Export: Formularvorlagen-Selbstprüfung (Nutzerfund 29./30.08.2026).

   Der Nutzer bekam beim Erzeugen: „Ausgewählte Formularvorlage tpl_kg1/kg11e/kgan/
   tpl_v159_care_application_person/_zepp fehlt oder ist leer" - und die Datei wurde
   verweigert. Drei Ursachen, alle hier verankert:

   1. Fünf Altbestands-Blöcke tragen type="application/pdf;base64" (Strichpunkt). Die
      Selbstprüfung bestand auf dem Bindestrich und lehnte korrekt befüllte Blöcke ab.
   2. Die Kuratierung (v221/v222) ENTFERNT die stillgelegten Originale der beiden
      Betreuungsanträge aus dem DOM - der Sammler verlangte sie trotzdem weiter.
   3. Beim Nachstellen in Chrome platzte die alte RegExp-Suche über die ~70-MB-Datei
      mit „Maximum call stack size exceeded" - und zwar erst beim ECHTEN Treffer, also
      genau dann, wenn alles stimmt (Safari kam durch). Die Prüfung arbeitet jetzt
      scanfrei über indexOf-Schnitte.

   Dazu: die DejaVu-Schriftblöcke (Phase 5.2) hängen an keinem Dokument und wurden seit
   der schlanken Auslieferung nie nachgeladen - jede seither erzeugte Außendienst-Datei
   reiste ohne eingebettete Schrift, der PDF-Bau unterwegs fiel still auf Helvetica
   zurück. Sie sind jetzt Pflichtblöcke des Exports.

   Die Prüfung wird hier AUSGEFÜHRT (vm), nicht nur gepinnt. */
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

/* pruefeInhalt aus der Auslieferung schneiden und ausführen. */
function pruefe(inhalt, sollBefuellt, snapId, mit, ohne, customPdf, defErwartet) {
  const src = schnipsel('function pruefeInhalt(', '\n  /* ---------- Einbau ins Nutzer-Menü ----------');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.__f=pruefeInhalt;', ctx);
  return ctx.__f(inhalt, sollBefuellt || {}, snapId || 'AD-TEST', mit || [], ohne || [], customPdf || [], !!defErwartet);
}

const B64 = 'JVBERi0'.padEnd(200, 'A'); // >100 Zeichen reine Base64
function block(id, typ, inhalt) {
  return `<script id="${id}" type="${typ}" data-server-template="1">${inhalt}</scr` + `ipt>`;
}

test('Selbstprüfung: der Strichpunkt-Typ (tpl_kg*) gilt als vorhanden - genau der gemeldete Fehler', () => {
  const datei = 'AD-TEST ' + block('tpl_kg1', 'application/pdf;base64', B64)
    + block('tpl_normal', 'application/pdf-base64', B64);
  const erg = pruefe(datei, {}, 'AD-TEST', ['tpl_kg1', 'tpl_normal'], []);
  /* vm-Arrays tragen den Sandkasten-Prototyp - deepStrictEqual gegen [] scheitert daran. */
  assert.strictEqual(erg.fehler.length, 0, 'Befüllte Blöcke beider Schreibweisen wurden abgelehnt: ' + [...erg.fehler]);
  assert.ok(erg.ok);
});

test('Selbstprüfung: fehlende und leere gewählte Vorlagen fallen weiter auf', () => {
  const datei = 'AD-TEST ' + block('tpl_leer', 'application/pdf-base64', '');
  const erg = pruefe(datei, {}, 'AD-TEST', ['tpl_leer', 'tpl_fehlt'], []);
  assert.strictEqual(erg.fehler.length, 2, 'Leer und fehlend müssen beide gemeldet werden: ' + erg.fehler);
  assert.ok(!erg.ok);
});

test('Selbstprüfung: eine abgewählte, dennoch befüllte Vorlage fällt weiter auf', () => {
  const datei = 'AD-TEST ' + block('tpl_abgewaehlt', 'application/pdf;base64', B64);
  const erg = pruefe(datei, {}, 'AD-TEST', [], ['tpl_abgewaehlt']);
  assert.strictEqual(erg.fehler.length, 1, 'Die Dennoch-enthalten-Wache ist stumm geworden');
});

test('Selbstprüfung: eine Code-Fundstelle der id täuscht den Schnitt nicht', () => {
  /* indexOf findet zuerst die id in einer Code-Zeichenkette - der Schnitt muss weitersuchen. */
  const datei = 'AD-TEST var x=\'id="tpl_kg1"\'; mehr Code; '
    + block('tpl_kg1', 'application/pdf;base64', B64);
  const erg = pruefe(datei, {}, 'AD-TEST', ['tpl_kg1'], []);
  assert.strictEqual(erg.fehler.length, 0, 'Die Code-Fundstelle hat die echte Blocksuche verdrängt: ' + [...erg.fehler]);
});

test('Selbstprüfung: eigene Vordrucke (cfpdf:) werden weiter geprüft', () => {
  const mitVordruck = 'AD-TEST <script id="cfpdf:custom_x" type="application/pdf-base64">' + B64 + '</scr' + 'ipt>';
  assert.ok(pruefe(mitVordruck, {}, 'AD-TEST', [], [], ['custom_x']).ok);
  const ohneVordruck = 'AD-TEST';
  assert.strictEqual(pruefe(ohneVordruck, {}, 'AD-TEST', [], [], ['custom_x']).fehler.length, 1);
});

test('Selbstprüfung arbeitet scanfrei - keine Volltext-RegExp über die Riesendatei mehr', () => {
  const src = schnipsel('function pruefeInhalt(', '\n  /* ---------- Einbau ins Nutzer-Menü ----------');
  assert.ok(!/new RegExp\([^)]*pdf\[;-\]base64/.test(src) && !/new RegExp\([^)]*pdf-base64/.test(src),
    'Die Vorlagen-Prüfung baut wieder RegExp-Volltextsuchen - Chrome sprengt daran den Stapel');
  assert.match(src, /function vorlagenInhalt\(/, 'Der indexOf-Schnitt fehlt');
  assert.match(src, /application\\\/pdf\[;-\]base64/, 'Der Tag-Test akzeptiert nicht mehr beide type-Schreibweisen');
});

test('Sammler: entfernte (stillgelegte) Originale werden nicht mehr verlangt', () => {
  /* v221/v222 entfernen tpl_v159_care_application_person/_zepp aus dem DOM. */
  assert.match(HTML, /var imDokument=function\(elementId\)\{try\{return !!document\.getElementById\(elementId\);\}catch\(_e\)\{return false;\}\};/,
    'Der Existenz-Filter des Vorlagen-Sammlers fehlt');
  assert.match(HTML, /if\(istStatisch\(elementId\)&&imDokument\(elementId\)\)alleVorlagenIds\[elementId\]=true;/,
    'alleVorlagenIds nimmt wieder Einträge ohne DOM-Block auf');
  assert.match(HTML, /if\(istStatisch\(elementId\)&&imDokument\(elementId\)\)mitVorlagenIds\[elementId\]=true;/,
    'mitVorlagenIds verlangt wieder Blöcke, die die Kuratierung entfernt hat');
  /* Die Stilllegung selbst bleibt bestehen - sonst wäre der Filter sinnlos. */
  assert.match(HTML, /document\.getElementById\('tpl_v159_care_application_person'\)\?\.remove\(\);/,
    'Die Kuratierung v221 entfernt den Block nicht mehr - dann gehört der Filter überdacht');
});

test('Pflichtblöcke: die DejaVu-Schriften reisen wieder in jeder Außendienst-Datei', () => {
  assert.match(HTML, /var AD_PFLICHT_VORLAGEN=\['tpl_font_dejavu_regular','tpl_font_dejavu_bold'\];/,
    'Die Pflichtblock-Liste fehlt');
  assert.match(HTML, /return \(!!mitVorlagenIds\[x\.id\]\|\|adPflicht\[x\.id\]\)&&!x\.textContent\.trim\(\);/,
    'Das Nachladen holt die Schriftblöcke nicht mehr');
  assert.match(HTML, /Object\.keys\(mitVorlagenIds\)\.concat\(AD_PFLICHT_VORLAGEN\)/,
    'Die Selbstprüfung verlangt die Schriftblöcke nicht mehr');
  /* Der Leser, dessen stiller Helvetica-Rückfall das Loch verdeckte: */
  assert.match(HTML, /Eigene Schrift nicht verfügbar – Helvetica-Fallback/,
    'Der Rückfall-Warnhinweis in unifiedDocumentFonts ist weg - dann bitte neu prüfen, wie ein Schriftverlust auffällt');
});

test('Jeder Abbruch schließt die Fortschrittsanzeige - kein hängendes „Bitte warten" mehr', () => {
  assert.match(HTML, /function meldeAbbruch\(kurz\)\{/,
    'Der Abbruch-Melder fehlt');
  /* Screenshot des Nutzers: Abbruch der Selbstprüfung + hängender Toast. Alle neun frühen
     returns rufen den Melder; hier die drei wichtigsten wortwörtlich: */
  for (const stelle of [
    "meldeAbbruch('Die Selbstprüfung fand eine Abweichung.');",
    "meldeAbbruch('Kein Fall ausgewählt.');",
    "meldeAbbruch('Eine Formularvorlage war nicht ladbar.');",
  ]) {
    assert.ok(HTML.includes(stelle), `Abbruchstelle ohne Toast-Schließung: ${stelle}`);
  }
  const anzahl = (HTML.match(/meldeAbbruch\(/g) || []).length;
  assert.ok(anzahl >= 11, `Nur ${anzahl} meldeAbbruch-Stellen (Definition + 10 Rufe erwartet)`);
});
