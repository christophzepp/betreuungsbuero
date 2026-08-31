'use strict';

/* Vorlagentabelle der Systemdiagnose (Neufassung 31.08.2026).

   Vorher trug die Tabelle zwei Spalten, die nichts unterschieden: "Mapping" zeigte eine
   Kurationsnummer (bei 60 von 69 Vorlagen schlicht "1"), und der Status meldete für 65 Vorlagen
   gleichlautend "Prüfung empfohlen". Für die acht Vorlagen mit "Nicht bereit" fehlte dagegen das
   Entscheidende - der Grund. Fünf davon sind bewusst abgelöst (eine kuratierte Arbeitsfassung
   ersetzt den amtlichen Vordruck; bei der Vorsorgevollmacht trägt die Quelle 46 unbeschriftete
   Kontrollkästchen), drei warten wirklich noch auf ihre Zuordnung. Zwei sehr verschiedene
   Aussagen, die gleich aussahen.

   Geprüft wird deshalb: die Tabelle rechnet mit den Zahlen der Anwendung, sie nennt bei
   "Nicht bereit" den Grund, und jede Stelle, die eine Vorlage stilllegt, hinterlässt diesen Grund
   auch in den Daten. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_HTML = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(APP_HTML, 'utf8');

function schnipsel(von, bis) {
  const a = html.indexOf(von);
  assert.ok(a >= 0, `Anker fehlt: ${von}`);
  assert.equal(html.indexOf(von, a + 1), -1, `Anker nicht eindeutig: ${von}`);
  const b = html.indexOf(bis, a);
  assert.ok(b > a, `Endanker fehlt hinter "${von}": ${bis}`);
  return html.slice(a, b);
}

/* Führt die Bausteine der Tabelle mit einer künstlichen Dokumenten- und Vorlagenliste aus. */
function tabelleBauen(registry, diagnose, berichte) {
  const quelle = schnipsel('  function templateDiagnose(id){', '  function esc(v){');
  const umgebung = {
    OFFICIAL_TEMPLATE_REGISTRY: registry,
    REPORTS: berichte || Object.keys(registry).map((id) => ({ id, title: registry[id].title })),
    esc: (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    window: { officialTemplateDiagnostics: (id) => diagnose[id] || null },
    zeilen: null, kopf: null
  };
  vm.runInNewContext(`${quelle}\nzeilen = templateRows(); kopf = templateSummary();`, umgebung);
  return { zeilen: umgebung.zeilen, kopf: umgebung.kopf };
}

test('Die Zuordnung kommt aus der Rechnung der Anwendung, nicht aus einer Kurationsnummer', () => {
  const { zeilen } = tabelleBauen({
    voll: { title: 'Vollständig', version: '01/2026', pages: 3, mode: 'auto-acro', mappingVersion: 1, ready: true, tested: false },
    offen: { title: 'Mit Lücken', version: '01/2026', pages: 2, mode: 'acroform', mappingVersion: 1, ready: true, tested: false }
  }, {
    voll: { mappedApp: 34, schemaUnmapped: [] },
    offen: { mappedApp: 12, schemaUnmapped: ['a', 'b', 'c'] }
  });
  assert.match(zeilen, /vollständig \(34\)/, 'die Zahl der zugeordneten Felder fehlt');
  assert.match(zeilen, /3 Felder offen/, 'offene Felder werden nicht benannt');
  assert.equal(zeilen.includes('Prüfung empfohlen'), false, 'der nichtssagende Sammelstatus ist zurück');
});

test('Bewusst abgelöste Vordrucke sind kein Mangel und nennen den Grund', () => {
  /* Nutzerentscheid 31.08.2026: Die vier Betreuungsvordrucke sollen nicht mehr wie ein Defekt
     aussehen. Sie tragen jetzt den eigenen Status "abgelöst" - ohne Warnfarbe, mit Begründung.
     Der Exportschalter bleibt unangetastet: bei zweien ist die eingebettete PDF entfernt. */
  const { zeilen } = tabelleBauen({
    abgeloest: {
      title: 'Alter Vordruck', version: '05.07.2026', pages: 1, mode: 'auto-acro', ready: false, tested: false,
      note: 'Bewusst abgelöst: Eine kuratierte Arbeitsfassung ersetzt diesen Vordruck; die Altvorlage wird nicht mehr als Exportziel angeboten.'
    },
    offen: {
      title: 'Wartend', version: '05.07.2026', pages: 2, mode: 'flat-direct-pending', ready: false, tested: false,
      note: 'Noch keine visuell geprüfte Direktzuordnung vorhanden.'
    }
  }, { abgeloest: { mappedApp: 4, schemaUnmapped: [] }, offen: { mappedApp: 0, schemaUnmapped: ['x'] } });
  assert.match(zeilen, />abgelöst/, 'der eigene Status "abgelöst" fehlt');
  assert.match(zeilen, /Bewusst abgelöst/, 'der Grund steht nicht in der Zeile');
  assert.match(zeilen, /phase6-bad">Nicht bereit/, 'die wirklich offene Vorlage ist nicht mehr markiert');
  assert.equal(/phase6-bad">abgelöst/.test(zeilen), false, 'abgelöst darf nicht als Mangel erscheinen');
});

test('Die Bezeichnung kommt aus der Dokumentenliste, nicht aus der Vorlagen-Nutzlast', () => {
  /* Fünf Namen waren veraltet, weil Umbenennungen nur im Dokument nachgezogen wurden -
     "Betreuungsantrag CZ" hieß in der Seitenleiste längst "Betreuungsantrag Betreuer". */
  const { zeilen } = tabelleBauen(
    { care_application_zepp: { title: 'Betreuungsantrag CZ', version: '05.07.2026', pages: 1, mode: 'auto-acro', ready: true, tested: false } },
    { care_application_zepp: { mappedApp: 8, schemaUnmapped: [] } },
    [{ id: 'care_application_zepp', title: 'Betreuungsantrag Betreuer' }]
  );
  assert.match(zeilen, /Betreuungsantrag Betreuer/, 'der aktuelle Name fehlt');
  assert.equal(zeilen.includes('Betreuungsantrag CZ'), false, 'der veraltete Name steht noch in der Tabelle');
});

test('Auch die vom Programm erzeugten Dokumente stehen in der Liste', () => {
  /* Die Tabelle zeigte 69 amtliche Vordrucke - die Anwendung führt 89 Dokumente. Anschreiben,
     Freidokumente und Büropost fehlten vollständig. */
  const { zeilen, kopf } = tabelleBauen(
    { mit_vordruck: { title: 'Mit Vordruck', version: '01/2026', pages: 2, mode: 'flat', ready: true, tested: false } },
    { mit_vordruck: { mappedApp: 9, schemaUnmapped: [] } },
    [{ id: 'mit_vordruck', title: 'Mit Vordruck' }, { id: 'brief', title: 'Betreuungsanzeige' }, { id: 'frei', title: 'Freidokument' }]
  );
  assert.match(zeilen, /Betreuungsanzeige/, 'Anschreiben fehlen in der Liste');
  assert.match(zeilen, /Freidokument/, 'Freidokumente fehlen in der Liste');
  assert.match(zeilen, /erzeugt/, 'die Technik "erzeugt" fehlt');
  assert.match(kopf, /3 Dokumente · 1 mit amtlichem Vordruck · 2 vom Programm erzeugt/);
});

test('Ein sehr langer Grund bricht nicht mitten im Wort ab', () => {
  const lang = 'Diese flache Original-PDF besitzt keine Formularfelder. Für sie ist noch keine visuell geprüfte Direktzuordnung vorhanden; ein generisches Ausfüllblatt wird bewusst nicht mehr angehängt.';
  const { zeilen } = tabelleBauen({
    warten: { title: 'Wartend', version: '05.07.2026', pages: 2, mode: 'flat-direct-pending', ready: false, tested: false, note: lang }
  }, { warten: { mappedApp: 0, schemaUnmapped: ['x'] } });
  const treffer = zeilen.match(/<small>([^<]*)<\/small>/);
  assert.ok(treffer, 'kein Begründungstext gefunden');
  const text = treffer[1];
  assert.ok(text.length <= 175, `Begründung zu lang: ${text.length}`);
  assert.ok(text.endsWith('…') || text.length === lang.length, 'abgeschnitten ohne Auslassungszeichen');
  assert.equal(/\S…$/.test(text), false, 'mitten im Wort abgeschnitten');
});

test('Die Kopfzeile trennt bewusste Ablösungen von offenen Zuordnungen', () => {
  const { kopf } = tabelleBauen({
    a: { title: 'A', pages: 1, ready: true, tested: true },
    b: { title: 'B', pages: 1, ready: true, tested: false },
    c: { title: 'C', pages: 1, ready: false, tested: false, note: 'Bewusst abgelöst: …' },
    d: { title: 'D', pages: 1, ready: false, tested: false, note: 'Noch keine visuell geprüfte Direktzuordnung vorhanden.' }
  }, { a: { schemaUnmapped: [] }, b: { schemaUnmapped: [] }, c: { schemaUnmapped: [] }, d: { schemaUnmapped: ['x'] } });
  assert.match(kopf, /4 Dokumente · 4 mit amtlichem Vordruck/);
  assert.match(kopf, /1 sichtgeprüft/);
  assert.match(kopf, /1 abgelöst \(Originalexport bewusst stillgelegt\)/);
  assert.match(kopf, /1 nicht bereit/);
});

test('Jede Stilllegung hinterlässt ihren Grund in den Daten', () => {
  /* Ohne diese Zusage stünde in der Tabelle wieder ein "Nicht bereit" ohne Erklärung - genau der
     Zustand, der die vier Betreuungsvordrucke wie einen Defekt aussehen ließ. */
  const stellen = html.match(/OFFICIAL_PDF_TEMPLATES\[[A-Z_]+\][^\n]{0,40}\.ready\s*=\s*false/g) || [];
  assert.ok(stellen.length >= 5, `zu wenige Stilllegungen gefunden: ${stellen.length}`);
  const ohneGrund = [];
  const re = /OFFICIAL_PDF_TEMPLATES\[([A-Z_]+)\]([^\n]{0,60})\.ready\s*=\s*false/g;
  let m;
  while ((m = re.exec(html))) {
    const umfeld = html.slice(m.index, m.index + 400);
    if (!/\.note\s*=/.test(umfeld)) ohneGrund.push(m[1] + ' bei Zeichen ' + m.index);
  }
  assert.deepEqual(ohneGrund, [], 'Stilllegung ohne Begründung');
});

test('Die sichtbaren Begründungen tragen echte Umlaute', () => {
  /* Nur die ZUGEWIESENEN Begründungen prüfen, nicht die Kommentare: im Quelltext dieser Datei sind
     ASCII-Umschreibungen (ae/oe/ue) Hausstil, in der Anzeige wären sie ein Fehler. */
  const zuweisungen = html.match(/\.note\s*=\s*'([^']{10,400})'/g) || [];
  assert.ok(zuweisungen.length >= 5, `zu wenige Begründungen gefunden: ${zuweisungen.length}`);
  for (const z of zuweisungen) {
    for (const platzhalter of ['abgeloest', 'Kontrollkaesten', 'fuer ', 'ueber ', 'moeglich']) {
      assert.equal(z.includes(platzhalter), false, `Platzhaltertext in sichtbarer Begründung: ${z.slice(0, 90)}`);
    }
  }
  assert.ok(html.includes('Bewusst abgelöst: Eine kuratierte Arbeitsfassung'), 'Begründungstext fehlt');
  assert.ok(html.includes('46 kontextlose Kontrollkästchen'), 'Begründung der Vorsorgevollmacht fehlt');
});

test('Die kuratierte Vorlagenliste ist vollständig beziffert', () => {
  const i = html.indexOf('"pdfTemplates":{');
  assert.ok(i > 0, 'kuratierte Vorlagenliste fehlt');
  const start = i + '"pdfTemplates":'.length;
  let tiefe = 0, j = start;
  for (; j < html.length; j++) {
    if (html[j] === '{') tiefe++;
    else if (html[j] === '}' && --tiefe === 0) break;
  }
  const liste = JSON.parse(html.slice(start, j + 1));
  const anzahl = Object.keys(liste).length;
  assert.ok(anzahl >= 60, `unerwartet wenige Vorlagen: ${anzahl}`);
  for (const [id, v] of Object.entries(liste)) {
    assert.ok(Number.isInteger(v.pages) && v.pages > 0, `Seitenzahl fehlt oder ist unbrauchbar: ${id}`);
    assert.ok(typeof v.mode === 'string' && v.mode, `Technik fehlt: ${id}`);
  }
});
