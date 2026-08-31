/* Vollansicht eines einzelnen Datensatzes auf dem Telefon.
 *
 * Handkasse, Lebensunterhalt, Schuldenregulierung und die Genehmigungen sind am Schreibtisch
 * durchgängig beschreibbare Tabellen - jede Zeile IST ein Formular. Auf dem Telefon wurde
 * daraus eine endlose Kette von Eingabemasken. Gewünscht war, dass „hinzufügen" den neuen
 * Eintrag allein und formatfüllend zeigt.
 *
 * Die harte Zusage dabei: am Schreibtisch ändert sich nichts. Deshalb prüft diese Datei vor
 * allem, dass jede Regel und jeder Zweig der Mechanik an der mobilen Ansicht hängt.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const htmlPath = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function funktion(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `${name}() fehlt.`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`${name}() ist nicht geschlossen.`);
}

test('Die Mechanik ist vollständig vorhanden', () => {
  ['mobRowKey', 'mobRows', 'mobRowKeys', 'mobFocusBar', 'mobFocusClear', 'mobFocusApply', 'mobFocusObserve']
    .forEach((name) => funktion(name));
});

test('Der Auslöser hängt an den vier Anlegen-Schaltflächen - und nur an ihnen', () => {
  const marke = "/__(sr|hk|lu|ap)Add\\s*\\(/.test(btn.getAttribute('onclick') || '')";
  assert(html.includes(marke), 'Der Klick-Aufpasser prüft nicht mehr auf die vier Anlegen-Aufrufe.');

  // Gegenprobe: __srAddPayment() legt eine Zahlung an, keinen Datensatz - der Ausdruck darf
  // dort NICHT greifen, sonst würde jede erfasste Zahlung die Liste ausblenden.
  const re = /__(sr|hk|lu|ap)Add\s*\(/;
  assert(re.test("window.__srAdd()"), 'Neue Schuld wird nicht erkannt.');
  assert(re.test("window.__hkAdd()"), 'Neue Buchung wird nicht erkannt.');
  assert(re.test("window.__luAdd('income')"), 'Neue Einnahme wird nicht erkannt.');
  assert(re.test("window.__apAdd()"), 'Neue Genehmigung wird nicht erkannt.');
  assert(!re.test("window.__srAddPayment('x')"), 'Eine Zahlung würde fälschlich die Vollansicht öffnen.');
});

test('Ohne mobile Ansicht passiert nichts', () => {
  // Der Auslöser steigt sofort aus, und das Anwenden räumt auf statt zu markieren.
  const anwenden = funktion('mobFocusApply');
  assert(anwenden.includes('!isMobileActive()'),
    'mobFocusApply() prüft die mobile Ansicht nicht - am Schreibtisch bliebe die Vollansicht stehen.');
  assert(/mobFocusKey \|\| !modal \|\| !body/.test(anwenden.replace(/\s+/g, ' ')),
    'mobFocusApply() steigt nicht mehr geschlossen aus, wenn nichts herausgestellt ist.');

  const klickStart = html.indexOf("if (!/__(sr|hk|lu|ap)Add");
  const kopf = html.slice(html.lastIndexOf("document.addEventListener('click'", klickStart), klickStart);
  assert(kopf.includes('if (!isMobileActive()) return;'),
    'Der Klick-Aufpasser läuft auch am Schreibtisch weiter.');
});

test('Jede Regel der Vollansicht ist auf die mobile Ansicht begrenzt', () => {
  const von = html.indexOf('html.mobile-online-active #modal.mobile-row-focus .mob-ed-path');
  assert.notStrictEqual(von, -1, 'Der Formatblock der Vollansicht fehlt.');
  const bis = html.indexOf('/* ===', von);
  // Kommentare zuerst heraus - sonst landet ihr Fließtext als vermeintlicher Selektor
  // vor dem nächsten Regelsatz.
  const block = html.slice(von, bis === -1 ? von + 4000 : bis).replace(/\/\*[\s\S]*?\*\//g, '');

  // Selektoren sind alles vor der öffnenden Klammer eines Regelsatzes.
  const selektoren = [];
  block.replace(/([^{}]+)\{[^{}]*\}/g, (_m, sel) => {
    sel.split(',').forEach((s) => { const t = s.trim(); if (t && !t.startsWith('/*')) selektoren.push(t); });
    return '';
  });
  assert(selektoren.length >= 5, 'Der Formatblock wurde nicht erkannt.');
  selektoren.forEach((sel) => {
    assert(sel.startsWith('html.mobile-online-active'),
      `Regel greift auch am Schreibtisch: ${sel}`);
  });
});

test('Der Rückweg ist immer vorhanden', () => {
  const bar = funktion('mobFocusBar');
  assert(bar.includes('mob-focus-bar'), 'Die Fußleiste trägt ihre Klasse nicht mehr.');
  assert(/Fertig/.test(bar), 'Die Fußleiste hat keine Rückweg-Beschriftung mehr.');
  assert(bar.includes('mobFocusClear'), 'Die Fußleiste räumt die Vollansicht nicht mehr auf.');

  const aufraeumen = funktion('mobFocusClear');
  assert(/mobFocusKey = ''/.test(aufraeumen), 'mobFocusClear() vergisst den Schlüssel nicht.');
  assert(aufraeumen.includes('mobFocusApply()'), 'mobFocusClear() zeichnet nicht neu.');
});

test('Der Beobachter sieht nur Aufbauten, nicht die eigenen Markierungen', () => {
  const beobachten = funktion('mobFocusObserve');
  assert(beobachten.includes('childList: true'), 'Neuaufbauten werden nicht beobachtet.');
  assert(!/attributes\s*:\s*true/.test(beobachten),
    'Attribute werden beobachtet - das Setzen der Markierungen löste den Beobachter endlos erneut aus.');
});
