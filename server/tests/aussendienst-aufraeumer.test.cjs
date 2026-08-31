'use strict';
/* Der Außendienst-Aufräumer und seine BLEIBT-Liste (Nutzerauftrag 30.08.2026, Punkt 5).

   Die Liste erzwingt NICHTS - sie dokumentiert nur, was unterwegs stehen bleiben soll. Genau
   deshalb ist sie unbemerkt von der Wirklichkeit abgedriftet: Zwei ihrer vier Einträge stimmten
   nicht. „Sicherung" wird an zwei anderen Stellen bewusst ausgeblendet, und ein Bedienelement
   namens „Dateinamen-Vorlagen" gibt es überhaupt nicht.

   Dieser Test macht die Liste prüfbar. Er stellt drei Fragen, die beide Fehler gefunden hätten:
     1. Steht ein BLEIBT-Eintrag zugleich auf einer Entfernen-Liste?
     2. Wird ein BLEIBT-Eintrag von der Ausblend-CSS des Außendiensts getroffen?
     3. Gibt es jeden genannten Namen überhaupt als Beschriftung? */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');

/* Ein Array-Literal aus dem Quelltext holen (die Einträge tragen Kommentare, deshalb erst
   schneiden, dann die Zeichenketten einsammeln). */
function liste(name) {
  const a = HTML.indexOf('var ' + name + ' = [');
  assert.ok(a > 0, `Liste ${name} nicht gefunden`);
  const b = HTML.indexOf('];', a);
  assert.ok(b > a, `Ende von ${name} nicht gefunden`);
  return [...HTML.slice(a, b).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/* Die Ausblend-CSS des Außendiensts: welche data-Attribute werden dort hart versteckt? */
function ausgeblendeteAttribute() {
  const a = HTML.indexOf('<style id="aussendienst-kompat-style-v1">');
  assert.ok(a > 0, 'Der Ausblend-Stilblock des Außendiensts fehlt');
  const b = HTML.indexOf('</style>', a);
  return [...HTML.slice(a, b).matchAll(/html\[data-ad-runtime\]\s*\[([a-z-]+)\]/g)].map((m) => m[1]);
}

/* Die Übersetzung Attribut -> Klarname, die der Außendienst für seine „was fehlt und warum"-
   Liste ohnehin pflegt. Sie ist die Brücke zwischen CSS-Selektor und BLEIBT-Eintrag. */
function attributNamen() {
  const a = HTML.indexOf('function markerName(m){');
  assert.ok(a > 0, 'markerName nicht gefunden');
  const b = HTML.indexOf('};', a);
  const karte = {};
  for (const m of HTML.slice(a, b).matchAll(/'(data-[a-z-]+)':'([^']+)'/g)) karte[m[1]] = m[2];
  return karte;
}

test('BLEIBT verspricht nichts, was anderswo entfernt wird', () => {
  const bleibt = liste('BLEIBT');
  const weg = new Set([...liste('WEG_TEXT'), ...liste('WEG_TEXT_OHNE_KI')]);
  for (const eintrag of bleibt) {
    assert.ok(!weg.has(eintrag),
      `„${eintrag}" steht auf der BLEIBT-Liste UND auf einer Entfernen-Liste`);
  }

  /* Der Fall „Sicherung": nicht über eine Beschriftungs-Liste entfernt, sondern per CSS.
     Lehre vom 30.08.2026: Diese Prüfung hing zuvor an [data-backup-menu] - einem Selektor,
     den KEIN Element je trug (der Kundschafter fand ihn als tote Regel; der Test war nur
     deshalb grün). Wirksam sind [data-backup-status-menu]/.backup-status-menu plus die
     Beschriftungs-Regel des Kompat-Durchgangs. Jetzt hängt die Prüfung am echten Anker. */
  const namen = attributNamen();
  const perCss = ausgeblendeteAttribute().map((attr) => namen[attr]).filter(Boolean);
  assert.ok(perCss.includes('Sicherungsstatus'),
    'Die Sicherungs-Gruppe wird unterwegs nicht mehr per CSS ausgeblendet - dann stimmt die Begründung in BLEIBT nicht mehr');
  assert.ok(!ausgeblendeteAttribute().includes('data-backup-menu'),
    'Der tote Selektor data-backup-menu ist zurück in der Ausblend-CSS');
  assert.match(HTML, /html\[data-ad-runtime\] \[data-inbox-menu\]|'data-inbox-menu',/,
    'Der Posteingang wird unterwegs nicht mehr entfernt (Nutzerentscheid 30.08.2026)');
  assert.match(HTML, /'data-quali-menu',\s*\/\* Qualifikationsmanager/,
    'Der Qualifikationsmanager wird unterwegs nicht mehr entfernt (Nutzerentscheid 30.08.2026)');
  for (const eintrag of bleibt) {
    assert.ok(!perCss.includes(eintrag),
      `„${eintrag}" soll laut BLEIBT bleiben, wird aber von der Außendienst-CSS ausgeblendet`);
  }
});

test('Jeder BLEIBT-Eintrag existiert überhaupt als Beschriftung', () => {
  /* Der Fall „Dateinamen-Vorlagen": ein Name, den es als Bedienelement nie gab. */
  for (const eintrag of liste('BLEIBT')) {
    const alsText = new RegExp('>\\s*' + eintrag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.match(HTML, alsText,
      `„${eintrag}" steht auf der BLEIBT-Liste, kommt aber nirgends als Beschriftung vor`);
  }
  assert.deepStrictEqual(liste('BLEIBT'), ['Bürostammdaten', 'Systemdiagnose'],
    'Der Bestand der BLEIBT-Liste hat sich geändert - bitte bewusst prüfen, ob er stimmt');
});

test('Das Ausblenden der Sicherung bleibt begründet - sonst wirkt es wie ein Defekt', () => {
  /* Die Ausblendung ist nur vertretbar, weil der Nutzer erfährt, warum. Beides muss zusammen
     bestehen bleiben: die Markierung mit dem Grund UND der erklärende Satz dazu. */
  assert.match(HTML, /el\.setAttribute\('data-ad-weg','aussendienst-ohne-sicherung'\);/,
    'Die Sicherungs-Gruppe wird ausgeblendet, ohne den Grund zu hinterlegen');
  assert.match(HTML, /if\(g==='aussendienst-ohne-sicherung'\)return 'Im Außendienst bewusst ausgeblendet\. Rückweg ist die Änderungsdatei über „Zwischenstand sichern“\.';/,
    'Die Erklärung zum ausgeblendeten Sicherungs-Menü fehlt');
});

test('Die wirkungslose Promptbibliothek-Regel ist entfernt - samt Begründung', () => {
  assert.deepStrictEqual(liste('WEG_TEXT_OHNE_KI'), ['KI-Direktverbindung'],
    'Die Ohne-KI-Liste enthält wieder einen Eintrag, der Dialoge betrifft');
  /* Sie war wirkungslos, WEIL der Durchgang Dialoge auslässt. Fällt diese Ausnahme, ändert sich
     die Lage - dann gehört die Entscheidung neu getroffen statt still gekippt. */
  assert.match(HTML, /try \{ if \(knoepfe\[k\]\.closest && knoepfe\[k\]\.closest\('#modal'\)\) continue; \} catch \(_e\) \{\}/,
    'Der Durchgang lässt Dialoge nicht mehr aus - dann war die Begründung für das Entfernen der Regel hinfällig');
  assert.match(HTML, /Ein Eintrag, der\s*\n\s*bauartbedingt wirkungslos ist, gehoert nicht in die Liste/,
    'Die Begründung, warum die Regel entfernt wurde, fehlt');
});
