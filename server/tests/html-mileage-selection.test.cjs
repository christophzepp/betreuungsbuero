/* Fahrtkostennachweis: Ein Haken ist kein Grund für einen Vollaufbau.
 *
 * Gemeldet wurde: beim Ankreuzen einer Fahrt wurde die Seite kurz weiß und die Liste sprang an
 * den Anfang. Ursache war, dass die Auswahl-Handler renderMileageModal() riefen - das setzt
 * "Lädt …" in den Körper, holt die Fahrten ERNEUT vom Server und baut anschließend alles neu auf.
 * Die Auswahl lebt aber ausschließlich im Browser (mileageSelectedTripIds); es gibt nichts
 * nachzuladen.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const htmlPath = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

/* Den Rumpf einer window.__x=function(...){...}-Zuweisung über Klammerzählung holen.
   Einige Handler sind async - beide Schreibweisen müssen greifen. */
function handlerBody(name) {
  let start = html.indexOf(`window.${name}=function`);
  if (start === -1) start = html.indexOf(`window.${name}=async function`);
  assert.notStrictEqual(start, -1, `Handler ${name} fehlt.`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Handler ${name} ist nicht geschlossen.`);
}

test('Die Auswahl-Handler bauen die Ansicht nicht mehr komplett neu', () => {
  ['__mileageToggleSelect', '__mileageToggleSelectYear', '__mileageSelectAll', '__mileageSelectNone']
    .forEach((name) => {
      const body = handlerBody(name);
      assert(!body.includes('renderMileageModal'),
        `${name} ruft weiterhin den Vollaufbau - das erzeugt das weiße Aufblitzen und den Sprung nach oben.`);
      assert(body.includes('refreshMileageSelectionUI()'),
        `${name} zieht die Auswahl nicht leichtgewichtig nach.`);
    });
});

test('Der leichte Nachzug aktualisiert genau das, was von der Auswahl abhängt', () => {
  const start = html.indexOf('function refreshMileageSelectionUI()');
  assert.notStrictEqual(start, -1, 'Der leichte Nachzug fehlt.');
  let depth = 0, end = -1;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) { end = i; break; }
  }
  const fn = html.slice(start, end + 1);

  assert(fn.includes('mileageBulkBarHTML()'), 'Die Sammelleiste („N ausgewählt“) wird nicht nachgezogen.');
  assert(fn.includes('__mileageToggleSelectYear'), 'Die Jahres-Sammelhaken werden nicht nachgezogen.');
  assert(fn.includes('__mileageToggleSelect('), 'Die Haken der einzelnen Zeilen werden nicht nachgezogen.');
  // Kein Nachladen, kein Platzhalter - genau das war die Ursache.
  assert(!fn.includes('loadMileageData'), 'Der Nachzug lädt erneut vom Server.');
  assert(!fn.includes('Lädt'), 'Der Nachzug setzt wieder einen Ladeplatzhalter.');
  assert(!fn.includes('renderMileageModal'), 'Der Nachzug ruft doch den Vollaufbau.');
});

test('Löschen und Statuswechsel bauen weiterhin vollständig neu', () => {
  // Dort ändern sich Serverdaten - ein leichter Nachzug wäre dort falsch.
  ['__mileageBulkDelete', '__mileageBulkStatus'].forEach((name) => {
    const body = handlerBody(name);
    assert(body.includes('renderMileageModal'),
      `${name} muss nach der Serveränderung vollständig neu aufbauen.`);
  });
});

test('Der Vollaufbau setzt weiterhin Platzhalter und lädt nach', () => {
  // Gegenprobe: an renderMileageModal() selbst wurde nichts verändert.
  const start = html.indexOf('async function renderMileageModal()');
  assert.notStrictEqual(start, -1, 'renderMileageModal() fehlt.');
  const kopf = html.slice(start, start + 700);
  assert(kopf.includes('Lädt …'), 'Der Vollaufbau zeigt keinen Ladehinweis mehr.');
  assert(kopf.includes('await loadMileageData()'), 'Der Vollaufbau lädt die Fahrten nicht mehr.');
});
