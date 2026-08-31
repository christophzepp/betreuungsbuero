'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(
  path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

function functionSource(name, nextMarker) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} fehlt`);
  const end = html.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `${name}: Endmarke fehlt`);
  return html.slice(start, end).trim();
}

const baselineSource = functionSource('ogBuildBaseline', '\n\nfunction ogEnsurePlan');
const baselineContext = {
  result: null,
  ogAddChild(parent, name, origin) {
    const node = { id: `id-${parent.children.length}`, name, origin, children: [] };
    parent.children.push(node);
    return node;
  }
};
vm.createContext(baselineContext);
new vm.Script(`${baselineSource}\nresult=ogBuildBaseline({});`).runInContext(baselineContext);
assert.deepStrictEqual(
  Array.from(baselineContext.result.children, (node) => node.name),
  [
    '00 - Eingang',
    '01 - Stammdaten',
    '02 - Kerndokumente',
    '03 - Behörden & Gerichte',
    '04 - Gesundheit & Pflege',
    '05 - Finanzen',
    '06 - Versicherungen',
    '07 - Arbeit & Alltagsstruktur',
    '08 - Unterkunft & Aufenthalt',
    '09 - Persönliches',
    '10 - Berichte & Rechnungslegung',
    '11 - Betreuungsführung',
    '12 - Abschluss & Herausgabe'
  ]
);
assert.ok(baselineContext.result.children.every((node) => node.children.length === 0));

const guessSource = functionSource('ciFolderGuess', '\nfunction ciFolderResolve');
const paths = Array.from(baselineContext.result.children, (node) => node.name);
const guessContext = {
  ciOgSegKey(value) {
    return String(value || '').normalize('NFC').toLocaleLowerCase('de-DE');
  },
  paths,
  answer: ''
};
vm.createContext(guessContext);
new vm.Script(guessSource).runInContext(guessContext);
const expectCode = (text, code) => {
  guessContext.text = text;
  guessContext.answer = vm.runInContext('ciFolderGuess(text,paths)', guessContext);
  assert.match(guessContext.answer, new RegExp(`^${code}\\b`), `${text} -> ${guessContext.answer}`);
};
expectCode('Bescheid Grundsicherung vom Sozialamt', '05');
expectCode('Vorsorgevollmacht', '02');
expectCode('Hausbesuch Dokumentationseintrag', '11');
expectCode('Jahresbericht Rechnungslegung', '10');
expectCode('Unterlagen an Erben herausgeben', '12');
expectCode('völlig unbekannter Gegenstand', '00');

const standardSource = html.slice(
  html.indexOf('__dok.standardOrdner=async function(){'),
  html.indexOf('\n__dok.ordnerMenue', html.indexOf('__dok.standardOrdner=async function(){'))
);
assert.match(standardSource, /\/folders\/standard/);
assert.doesNotMatch(standardSource, /01 Gericht & Verfahren|folders\/bulk/);
assert.doesNotMatch(html, /Standard-Ordnerstruktur anlegen \(01–06\)/);
assert.match(
  html,
  /Die erste Pfadebene ist verbindlich und vollständig: 00 - Eingang,[\s\S]*12 - Abschluss & Herausgabe/
);
assert.doesNotMatch(
  html,
  /Hauptkategorien sind fest vorgegeben und bilden die erste Pfadebene: 01 - Stammdaten/
);
assert.doesNotMatch(html, /Modulordner \/ Betreuerausweis/);
assert.match(html, /window\.__inboxCasePick=function\(id,caseId\)/);
assert.match(html, /caseId:selectedCaseId\('calNewCaseLabel'\)/);
assert.match(html, /caseId:selectedCaseId\('todoNewCaseLabel'\)/);
assert.match(html, /mehrdeutig\. Bitte den Fall mit Geburtsdatum erneut auswählen/);

console.log('HTML-Dokumenttaxonomie: Register 00–12, eindeutige Fall-IDs und Explorer-Endpunkt ok');
