'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(
  __dirname,
  '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
), 'utf8');

function script(id) {
  const match = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `${id} fehlt.`);
  return match[1];
}

const generator = script('aussendienst-1-v1');
const loader = script('aussendienst-2b-v1');

test('Außendienst zeigt alle Editordokumente standardmäßig ausgewählt mit Sammelaktionen', () => {
  assert.match(generator, /function dokumenteLesen\(\)/);
  assert.match(generator, /SICHT\.dokumentListe=dokumenteLesen\(\)/);
  assert.match(generator, /SICHT\.dokumentListe\.forEach\(function\(d\)\{SICHT\.dokumente\[d\.id\]=true;\}\)/);
  assert.match(generator, /2\. Welche Dokumente sollen mit\?/);
  assert.match(generator, /class="ad-bulk-actions" aria-label="Dokumentauswahl bearbeiten"/);
  assert.match(generator, /class="ad-bulk-btn" onclick="window\.__adDokAlle\(true\)"/);
  assert.match(html, /\.ad-bulk-actions\{display:flex!important;[^}]*visibility:visible!important\}/);
  /* 30.08.2026 (Nutzerwunsch, 2. Runde): aus den Knopf-Kästen wurden dezente Textlinks
     nach dem Vorbild der Adressbuch-Zeile (.ab-link-btn) - display:inline, ohne Rahmen. */
  assert.match(html, /\.ad-bulk-btn\{display:inline!important;background:none!important;border:none!important[^}]*visibility:visible!important;opacity:1!important\}/);
  assert.match(generator, /onclick="window\.__adDokAlle\(true\)"[^>]*>Alle auswählen</);
  assert.match(generator, /onclick="window\.__adDokAlle\(false\)"[^>]*>Alle abwählen</);
  assert.match(generator, /data-ad-dokument="'\+i\+'" checked/);
  assert.match(generator, /window\.__adDokument=function\(i,an\)/);
  assert.match(generator, /window\.__adDokAlle=function\(an\)/);
});

test('nur ausgewählte Berichte und Berichtsarchive reisen in den Falldaten mit', () => {
  const start = generator.indexOf('  function adDokuPayloadKind(p){');
  const end = generator.indexOf('\n\n  /* ---------- Erzeugung ---------- */', start);
  assert.ok(start >= 0 && end > start, 'Transportfilter ist nicht extrahierbar.');
  const context = vm.createContext({ JSON, Array, Set, String });
  new vm.Script(
    generator.slice(start, end) + '\nthis.transport=adDokuTransportState;',
    { filename: 'aussendienst-dokument-transport.js' }
  ).runInContext(context);

  const original = {
    reports: {
      initial: { fields: { a: { value: 'mit' } } },
      closing: { fields: { b: { value: 'nicht mit' } } }
    },
    archives: [
      { reportId: 'initial', data: { secret: 'mit' } },
      { reportId: 'closing', data: { secret: 'nicht mit' } }
    ],
    caseData: { documentationEntries: [] }
  };
  const result = context.transport(original, ['initial']);
  assert.deepEqual(Object.keys(result.reports), ['initial']);
  assert.equal(result.archives.length, 1);
  assert.equal(result.archives[0].reportId, 'initial');
  assert.ok(original.reports.closing, 'Ausgangszustand darf nicht verändert werden');
});

test('Auswahl wird im Snapshot gespeichert und amtliche PDF-Vorlagen werden passend reduziert', () => {
  assert.match(generator, /dokumente:dokumente\.map\(function\(d\)\{return \{id:d\.id,title:d\.title\};\}\)/);
  assert.match(generator, /kopf\.pdfVorlagen=Object\.keys\(mitVorlagenIds\)/);
  assert.match(generator, /if\(mitVorlagenIds\[id\]\)return;[\s\S]*?if\(node\)node\.remove\(\)/);
  /* 30.08.2026: Das Nachladen holt zusätzlich die DejaVu-Pflichtblöcke (adPflicht) - seit der
     schlanken Auslieferung reisten die Schriften sonst leer, und der PDF-Bau unterwegs fiel
     still auf Helvetica zurück (Details: aussendienst-export-vorlagen.test.cjs). */
  assert.match(generator, /filter\(function\(x\)\{return \(!!mitVorlagenIds\[x\.id\]\|\|adPflicht\[x\.id\]\)&&!x\.textContent\.trim\(\);\}\)/);
  assert.match(generator, /Ausgewählte Formularvorlage .* fehlt oder ist leer/);
  assert.match(generator, /Abgewählte Formularvorlage .* ist dennoch enthalten/);
  assert.doesNotMatch(generator, /vorlagen<60/);
});

test('Außendienst-Lader begrenzt den Dokumenteneditor auf die mitgenommene Auswahl', () => {
  assert.match(loader, /if\(p\.kopf&&Array\.isArray\(p\.kopf\.dokumente\)\)/);
  assert.match(loader, /window\.__adDokumentIds=dokumentIds\.slice\(\)/);
  assert.match(loader, /REPORTS\.splice\(0,REPORTS\.length,\.\.\.REPORTS\.filter/);
  assert.match(loader, /dokumentErlaubt\.has\(String\(r&&r\.id\|\|''\)\)/);
  assert.match(loader, /currentReport=REPORTS\[0\]\?REPORTS\[0\]\.id:''/);
});

test('geklonte laufende Berichtsanzeige wird vor dem Download geleert', () => {
  assert.match(generator, /var reportContainer=klon\.querySelector\('#reportContainer'\);\s*if\(reportContainer\)reportContainer\.innerHTML=''/);
});
