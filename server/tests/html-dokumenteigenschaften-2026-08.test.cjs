'use strict';

/* Pruefstand fuer die Ueberarbeitung der Dokumenteneigenschaften vom 24.08.2026: kuratierte
   Stand-Angaben statt Leerstellen, eine einheitliche Schreibweise, die Auskunft wie ein Dokument
   auf seine Vorlage kommt, und eine Sammelansicht ueber alle Dokumente. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);
const v159Line = html.split('\n').find((line) => line.startsWith('const V159={'));
const v159 = JSON.parse(v159Line.slice('const V159='.length, -1));
const nachId = new Map(v159.catalog.map((e) => [e.id, e]));

test('Recherchierte Stand-Angaben sind eingetragen', () => {
  /* Der Aufdruck im PDF lautet "0103   01.2017" - die Ziffern im Dateinamen sind die
     Formularnummer, nicht der Stand. */
  assert.equal(nachId.get('broadcast_registration').templateDate, '01/2017');
  assert.equal(nachId.get('broadcast_change_notice').templateDate, '01/2017');
  assert.match(nachId.get('broadcast_exemption_application').templateDate, /Online-Formular/);
  assert.equal(nachId.get('sgb12_social_assistance_short').templateDate.slice(0, 7), '12/2006');
  for (const id of ['sgb12_initial_application', 'sgb9_initial_application', 'naturalization_application']) {
    assert.match(nachId.get(id).templateDate, /regional unterschiedlich/,
      `${id}: die Auskunft zur regionalen Streuung fehlt`);
    assert.ok(nachId.get(id).sourceUrl, `${id}: Belegquelle fehlt`);
  }
});

test('Die Schreibweise der Staende ist vereinheitlicht', () => {
  const erlaubt = /^(--|\d{2}\/\d{4}|\d{2}\.\d{2}\.\d{4})$/;
  const abweichend = v159.catalog
    .filter((e) => e.templateDate && !erlaubt.test(e.templateDate))
    .map((e) => `${e.id}: ${e.templateDate}`);
  /* Ausformulierte Auskuenfte sind gewollt - Monatsnamen und Punkt-Schreibweise nicht. */
  for (const eintrag of abweichend) {
    assert.ok(/regional|kein |Online-Antrag|nur in Berlin|Arbeitsvorlage|Arbeitsfassung|Vordruck erzeugt/.test(eintrag),
      `Uneinheitliche Schreibweise: ${eintrag}`);
  }
  assert.ok(!v159.catalog.some((e) => /^(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+\d{4}$/.test(e.templateDate || '')),
    'Monatsnamen sind nicht in MM/JJJJ umgesetzt');
});

test('Der Dialog sagt, wie die Angaben auf die Vorlage kommen', () => {
  assert.ok(html.includes('function dokUebernahmeart(id){'), 'Die Auskunft zur Übernahmeart fehlt');
  assert.match(html, /<dt>Übernahme der Angaben<\/dt>/, 'Die Zeile fehlt im Informationsraster');
  /* Ein Beiblatt entsteht nur auf dem koordinatenbasierten Weg. */
  assert.ok(html.includes("return cfg&&cfg.mode==='flat'?`${grund} · dazu ein Beiblatt"),
    'Der Beiblatt-Hinweis haengt nicht am tatsaechlichen Ausgabeweg');
  /* Wo die Sperre eine Entscheidung ist, steht das statt "noch nicht freigegeben". */
  assert.ok(html.includes('const DOK_ORIGINAL_HINWEIS={'), 'Die dokumentbezogene Auskunft fehlt');
  assert.match(html, /Die Rechnungslegung behält ihren eigenen Ausdruck/, 'Die Rechnungslegung sagt weiterhin das Falsche');
});

test('Die Positionsprobe ist aus dem Dialog erreichbar', () => {
  assert.ok(html.includes('async function downloadCoordinateTestPdf(reportId){'),
    'Der Testdruck laesst sich nicht fuer ein bestimmtes Dokument aufrufen');
  assert.match(html, /Positionen im Vordruck prüfen/, 'Der Knopf fehlt im Dialog');
});

test('Die Sammelansicht trennt offene Befunde von bewussten Festlegungen', () => {
  assert.ok(html.includes('function zeigeVorlagenuebersicht('), 'Die Sammelansicht fehlt');
  assert.ok(html.includes('const DOK_BEWUSSTE_FESTLEGUNG={'), 'Bewusste Festlegungen werden nicht unterschieden');
  assert.ok(html.includes("return {art:'festlegung'"), 'Eine Festlegung wird wie eine Luecke gemeldet');
  /* Eigene Buerodokumente werden nicht nach Stand und Belegquelle gefragt. */
  assert.ok(html.includes("const eigeneVorlage=!d.template||d.template==='--';"),
    'Eigene Buerodokumente loesen weiterhin Fehlalarm aus');
  assert.match(html, /Alle Vorlagen im Überblick/, 'Der Einstieg im Dialog fehlt');
  /* Die stillgelegten Dokumente sind benannt, nicht rot markiert. */
  for (const id of ['care_application_person', 'power_of_attorney', 'accounting']) {
    assert.ok(new RegExp(`${id}:'`).test(html), `${id} fehlt in den bewussten Festlegungen`);
  }
});

test('Jedes Dokument hat eine Stand-Auskunft', () => {
  const ohne = v159.catalog.filter((e) => !e.templateDate).map((e) => e.id);
  assert.deepEqual(ohne, [], 'Dokumente ohne Stand-Angabe');
});

test('Zwei Fehldeutungen sind korrigiert', () => {
  /* "Version 50035 - ABF-FORTAQ 2/2025" ist ein Auflagenzaehler, kein Monat. Die Katalogseite der
     Rentenversicherung weist Version 35, Stand 01.07.2026 aus. */
  assert.equal(nachId.get('pension_application').templateDate, '01.07.2026');
  assert.ok(!/02\/2025/.test(nachId.get('pension_application').templateDate));
  /* Eingebettet ist nicht R0210 (15 Seiten), sondern die vierseitige Zweitausfertigung R210e. */
  assert.match(nachId.get('drv_confidentiality_release').template, /R210e/);
  assert.match(nachId.get('drv_confidentiality_release').sourceUrl, /R210e/);
  /* "26104" ist keine amtliche Formularnummer - die Entlastungserklaerung heisst F 292. */
  assert.match(nachId.get('discharge').template, /F 292/);
  assert.ok(!/26104/.test(nachId.get('discharge').template));
});
