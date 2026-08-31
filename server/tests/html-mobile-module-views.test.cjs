/* Smartphone-Feinschliff der fachlichen Arbeitsansichten.
 *
 * Betrifft: Datei-Explorer, Handkasse, Vermögensaufstellung, Kalender, Lebensunterhalt,
 * Schuldenregulierung, Banking, Gesundheit sowie Wünsche und Bedarfe.
 *
 * Die wichtigste Zusicherung ist NICHT, dass eine bestimmte Regel existiert, sondern dass die
 * Desktop-Darstellung unerreichbar bleibt: jede Regel muss in der bestehenden 1024-px-Abfrage
 * stehen UND an html.mobile-online-active hängen. Fällt eine von beiden Bedingungen weg, greift
 * die Regel auch am Schreibtisch.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const htmlPath = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const BANNER = 'Smartphone-Feinschliff der fachlichen Arbeitsansichten';

/* Es gibt mehrere 1024-px-Abfragen. Gesucht ist die, die den Feinschliff enthält - über
   Klammerzählung ab jedem Kandidaten. */
function mobileMediaBlock() {
  const marke = '@media (max-width: 1024px) {';
  for (let start = html.indexOf(marke); start !== -1; start = html.indexOf(marke, start + 1)) {
    let depth = 0;
    for (let i = html.indexOf('{', start); i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}' && --depth === 0) {
        const text = html.slice(start, i + 1);
        if (text.includes(BANNER)) return { start, end: i, text };
        break;
      }
    }
  }
  throw new Error('Keine 1024-px-Abfrage enthält den Feinschliff.');
}

/* Eine Selektorliste an ihren Kommas trennen - aber nur an denen AUSSERHALB von :is()/:not(),
   sonst zerfaellt ein einziger Selektor in Bruchstuecke ohne die Mobil-Klasse. */
function splitSelectorList(selector) {
  const parts = [];
  let depth = 0, buffer = '';
  for (const c of selector) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(buffer); buffer = ''; continue; }
    buffer += c;
  }
  if (buffer.trim()) parts.push(buffer);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/* Alle Selektoren eines CSS-Ausschnitts: der Text vor jeder öffnenden Klammer. */
function selectors(css) {
  const out = [];
  let buffer = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      const sel = buffer.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (sel) out.push(sel);
      buffer = '';
    } else if (c === '}') buffer = '';
    else buffer += c;
  }
  return out;
}


/* Ausschnitt ab dem KOMMENTARANFANG des Feinschliffs - beginnt man erst beim Banner, bleibt ein
   herrenloses *\/ im Text und die Kommentarzeilen wuerden als Selektoren gelesen. */
function feinschliff(block) {
  const bannerAt = block.text.indexOf(BANNER);
  assert.notStrictEqual(bannerAt, -1, 'Der Abschnitt des Feinschliffs fehlt.');
  const commentAt = block.text.lastIndexOf('/*', bannerAt);
  return block.text.slice(commentAt === -1 ? bannerAt : commentAt);
}

test('Der Feinschliff steht vollständig innerhalb der Mobil-Abfrage', () => {
  const block = mobileMediaBlock();
  const bannerAt = html.indexOf(BANNER);
  assert.notStrictEqual(bannerAt, -1, 'Der Abschnitt des Feinschliffs fehlt.');
  assert(bannerAt > block.start && bannerAt < block.end,
    'Der Feinschliff steht außerhalb der 1024-px-Abfrage und würde den Desktop erreichen.');
  assert.equal(html.split(BANNER).length - 1, 1, 'Der Abschnitt existiert mehrfach.');
});

test('Keine Regel des Feinschliffs kann die Desktop-Ansicht erreichen', () => {
  const block = mobileMediaBlock();
  const abschnitt = feinschliff(block);
  const gefunden = selectors(abschnitt);
  assert(gefunden.length > 30, `Unerwartet wenige Regeln im Feinschliff: ${gefunden.length}`);
  const ungekapselt = gefunden.filter((sel) => {
    if (sel.startsWith('@media')) return false; // verschachtelte Breitenabfrage, selbst geprüft
    // Jeder einzelne Selektor einer Liste muss die Mobil-Klasse tragen.
    return splitSelectorList(sel).some((teil) => !teil.startsWith('html.mobile-online-active'));
  });
  assert.deepEqual(ungekapselt, [], `Nicht an html.mobile-online-active gebunden:\n${ungekapselt.join('\n')}`);

  // Auch die verschachtelte Abfrage für sehr schmale Geräte muss gekapselt sein.
  const engAt = abschnitt.indexOf('@media (max-width: 430px)');
  assert.notStrictEqual(engAt, -1, 'Die Abfrage für sehr schmale Geräte fehlt.');
  selectors(abschnitt.slice(engAt)).forEach((sel) => {
    if (sel.startsWith('@media')) return;
    assert(sel.startsWith('html.mobile-online-active'), `Ungekapselt in der 430-px-Abfrage: ${sel}`);
  });
});

test('Jedes der neun Module wird im Feinschliff behandelt', () => {
  const block = mobileMediaBlock();
  const abschnitt = feinschliff(block);
  const module = {
    'Datei-Explorer': ['.dok-wz', '.dok-kacheln'],
    Handkasse: ['.hk-filterzeile', '.hk-del'],
    'Vermögensaufstellung': ['.va-grid2', '.va-actions'],
    Kalender: ['.cal-mobile-toolrow', '.cal-view-row'],
    Lebensunterhalt: ['.lu-view .hk-table', '.lu-grid'],
    Schuldenregulierung: ['.sr-editor', '.sr-iconbtn'],
    Banking: ['.bk2-case-assign', '.bk2-settings-grid'],
    Gesundheit: ['.hi-dir-row', '.hi-table'],
    'Wünsche und Bedarfe': ['.gdp-main', '.gdp-linked-action-row.secondary']
  };
  Object.entries(module).forEach(([name, klassen]) => {
    klassen.forEach((k) => assert(abschnitt.includes(k), `${name}: ${k} wird nicht behandelt.`));
  });
});

test('Die Handkassenaktionen stehen nur mobil direkt unter dem Jahrfilter', () => {
  const scriptStart = html.indexOf('<script id="handkasse-script-v1">');
  const scriptEnd = html.indexOf('</script>', scriptStart);
  assert.notStrictEqual(scriptStart, -1, 'Das Handkassen-Skript fehlt.');
  assert.notStrictEqual(scriptEnd, -1, 'Das Ende des Handkassen-Skripts fehlt.');
  const handkasse = html.slice(scriptStart, scriptEnd);
  const bodyStart = handkasse.indexOf('function bodyHTML(){');
  const bodyEnd = handkasse.indexOf('\nfunction render()', bodyStart);
  const body = handkasse.slice(bodyStart, bodyEnd);

  const filterAt = body.indexOf('class="hk-filterzeile"');
  const mobileActionsAt = body.indexOf('class="hk-mobile-actions"');
  const tableAt = body.indexOf('class="modal-scroll"');
  const desktopFootAt = body.indexOf('class="hk-foot"');
  assert(filterAt >= 0 && mobileActionsAt > filterAt,
    'Die mobile Aktionsleiste steht nicht direkt hinter Fall-/Jahrfilter.');
  assert(tableAt > mobileActionsAt,
    'Die Buchungsliste steht nicht mehr unter der mobilen Aktionsleiste.');
  assert(desktopFootAt > tableAt,
    'Die bestehende Desktop-Fußleiste wurde vor die Buchungsliste verschoben.');

  const mobileActions = body.slice(mobileActionsAt, body.indexOf('${caseOpen()', mobileActionsAt));
  ['__hkAdd()', '__hkPdf()', '__hkExcel()', '__hkToAccounting()'].forEach((handler) => {
    assert(mobileActions.includes(handler), `Die mobile Handkassenaktion ${handler} fehlt.`);
  });

  // Die zusätzliche Leiste bleibt am Desktop unsichtbar; dessen bisherige Fußleiste bleibt Flex.
  assert(html.includes('.hk-mobile-actions{display:none}'),
    'Die mobile Aktionsleiste ist außerhalb des Smartphone-Profils nicht verborgen.');
  assert(html.includes('.hk-foot{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px}'),
    'Die Desktop-Fußleiste der Handkasse wurde verändert.');

  const abschnitt = feinschliff(mobileMediaBlock()).replace(/\n\s*/g, ' ');
  assert(/\.hk-mobile-actions \{[^}]*display: grid[^}]*repeat\(2, minmax\(0, 1fr\)\)/.test(abschnitt),
    'Die mobile Aktionsleiste wird nicht als zweispaltige Leiste eingeblendet.');
  assert(/\.hk-foot > :is\(\.hk-add-action,\.hk-export-actions\) \{[^}]*display: none/.test(abschnitt),
    'Die unteren Button-Duplikate bleiben mobil sichtbar.');
});

test('Fall und Jahr der Handkasse stehen nur mobil linksbündig untereinander', () => {
  // Der gemeinsame DOM bleibt für den Desktop unverändert; es gibt keine mobile Kopie des Filters.
  assert(html.includes('${hkSwitcherHTML()}${hkJahrWahlHTML()}'),
    'Fall- und Jahresauswahl wurden im Handkassen-DOM getrennt oder vertauscht.');
  assert.equal((html.match(/\$\{hkJahrWahlHTML\(\)\}/g) || []).length, 1,
    'Die Jahresauswahl darf nicht als mobile Kopie dupliziert werden.');

  const abschnitt = feinschliff(mobileMediaBlock()).replace(/\n\s*/g, ' ');
  assert(/\.hk-view > \.hk-filterzeile \{[^}]*display: grid[^}]*grid-template-columns: minmax\(0, 1fr\)[^}]*align-items: stretch/.test(abschnitt),
    'Fall und Jahr stehen mobil nicht in einer vollbreiten Einspaltenfolge.');
  assert(/\.hk-filterzeile > :is\(\.hk-switcher,label\.hk-jahr\) \{[^}]*grid-template-columns: 42px minmax\(0, 1fr\)[^}]*width: 100%[^}]*max-width: none[^}]*text-align: left/.test(abschnitt),
    'Fall- und Jahreszeile besitzen mobil nicht dieselbe linke Picker-Kante.');
  assert(/\.hk-filterzeile :is\(\.hk-switcher > select,label\.hk-jahr > select\) \{[^}]*width: 100%[^}]*max-width: none[^}]*height: 48px/.test(abschnitt),
    'Fall- und Jahr-Picker sind mobil nicht gleich breit und gleich hoch.');

  // Gegenprobe: Die Desktop-Basis bleibt die bisherige flexible, kompakte Filterzeile.
  assert(html.includes('.hk-filterzeile{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:0 0 8px}'),
    'Die Desktop-Filterzeile der Handkasse wurde verändert.');
  assert(html.includes('class="hk-jahr" style="display:inline-flex') &&
    html.includes('margin:0;flex:0 0 auto;width:auto" onchange="window.__hkJahr'),
  'Die Desktop-Jahresauswahl wurde statt ausschließlich mobil verändert.');
  assert(html.includes('margin:0;flex:0 1 460px;min-width:0'),
    'Die Desktopbreite des Fallwechslers wurde verändert.');
});

test('Aktuelle Fälle und Archiv bilden mobil einen fugenlosen 50-50-Umschalter', () => {
  assert(html.includes('class="cal-view-switch bu-scope-switch"'),
    'Der Umschalter der Betreuungsübersicht fehlt.');

  const abschnitt = feinschliff(mobileMediaBlock()).replace(/\n\s*/g, ' ');
  assert(/\.cal-view-switch\.bu-scope-switch \{[^}]*display: grid[^}]*repeat\(2, minmax\(0, 1fr\)\)[^}]*gap: 0[^}]*width: 100%/.test(abschnitt),
    'Zwischen „Aktuelle Fälle“ und „Archiv“ bleibt mobil eine sichtbare Fuge.');
  assert(/\.cal-view-switch\.bu-scope-switch > button \{[^}]*width: 100%[^}]*min-width: 0[^}]*margin: 0/.test(abschnitt),
    'Die beiden mobilen Segmente teilen die verfügbare Breite nicht stabil hälftig.');

  // Gegenprobe: Der Desktop behält seinen ursprünglichen Inline-Flex-Umschalter und Trenner.
  assert(html.includes('.cal-view-switch{display:inline-flex;border:1px solid var(--line);border-radius:7px;overflow:hidden}'),
    'Die Desktop-Basis des Ansichts-Umschalters wurde verändert.');
  assert(html.includes('.cal-view-switch button:first-child{border-left:none}'),
    'Der Desktop-Trenner des Ansichts-Umschalters wurde verändert.');
});

test('Die Mindestbreiten und festen Pixelraster des Desktops sind mobil aufgehoben', () => {
  const block = mobileMediaBlock();
  const abschnitt = feinschliff(block);
  // Lebensunterhalt: 1180px Tabellenmindestbreite ist die Ursache für seitliches Scrollen.
  assert(/\.lu-view \.hk-table \{[^}]*min-width: 0/.test(abschnitt.replace(/\n\s*/g, ' ')),
    'Die 1180-px-Mindestbreite der Lebensunterhalt-Tabelle wird mobil nicht aufgehoben.');
  assert(html.includes('.lu-view .hk-table{min-width:1180px}'),
    'Die Desktop-Regel wurde verändert - sie muss unangetastet bleiben.');
  // Banking: Fallzuordnung 230px/360px.
  assert(html.includes('min-width:230px;max-width:360px'), 'Die Banking-Desktopregel wurde verändert.');
  assert(/\.bk2-case-assign \{[^}]*min-width: 0[^}]*max-width: none/.test(abschnitt.replace(/\n\s*/g, ' ')),
    'Die Mindest-/Höchstbreite der Banking-Fallzuordnung wird mobil nicht aufgehoben.');
  // Wünsche/Bedarfe: 326px Seitenstreifen und sechsspaltige Aktionsreihe.
  assert(html.includes('.gdp-main{min-height:0;display:grid;grid-template-columns:326px'),
    'Die Desktopregel der Wünsche-Ansicht wurde verändert.');
  assert(html.includes('.gdp-linked-action-row.secondary{grid-template-columns:repeat(6,minmax(0,1fr))}'),
    'Die sechsspaltige Desktop-Aktionsreihe wurde verändert.');
  assert(/\.gdp-linked-action-row\.secondary[\s\S]{0,120}?repeat\(2, minmax\(0, 1fr\)\)/.test(abschnitt),
    'Die sechsspaltige Aktionsreihe wird mobil nicht auf zwei Spalten gebracht.');
  // Gesundheit: 210px/160px-Raster.
  assert(html.includes('.hi-dir-row{display:grid;grid-template-columns:210px 160px 1fr'),
    'Die Desktopregel der Gesundheitsansicht wurde verändert.');
});

test('Die mobile Kalenderleiste hat für das Ansichts-Menü eine eigene Spalte', () => {
  const block = mobileMediaBlock();
  const abschnitt = feinschliff(block);
  const raster = abschnitt.match(/\.cal-mobile-toolrow \{[^}]*\}/);
  assert(raster, 'Das mobile Spaltenraster der Kalenderleiste fehlt im Feinschliff.');
  const spalten = (raster[0].match(/minmax\(/g) || []).length;
  assert.equal(spalten, 7, `Die Leiste hat ${spalten} Spalten - mit dem Ansichts-Menü sind es sieben Elemente.`);
  // Reihenfolge: Ansicht (5) vor ICS (6) vor Synchronisieren (7).
  ['.cal-vis-panel.cal-view-panel {\n    order: 5', '.cal-ics-menu {\n    order: 6', '.sync-grey {\n    order: 7']
    .forEach((teil) => assert(abschnitt.includes(teil), `Reihenfolge fehlt: ${teil.split(' {')[0]}`));
});

test('Die Module hängen weiterhin im gemeinsamen Smartphone-Profil', () => {
  // Der Feinschliff ergänzt das Profil, er ersetzt es nicht - sonst fehlten Vollbildrahmen,
  // Karten-Tabellen und der einzelne Inhaltsscroller.
  const erwartet = {
    documents: 'bespoke', cash: 'workspace', assets: 'workspace', calendar: 'workspace',
    livelihood: 'workspace', debts: 'workspace', banking: 'workspace', health: 'workspace',
    housing: 'workspace', abilities: 'standalone', needs: 'workspace'
  };
  Object.entries(erwartet).forEach(([id, profil]) => {
    const zeile = html.split('\n').find((l) => l.includes(`{ id: '${id}',`));
    assert(zeile, `Modul ${id} fehlt in der mobilen Aktionsliste.`);
    assert(zeile.includes(`mobileProfile: '${profil}'`), `Modul ${id} hat nicht mehr das Profil ${profil}.`);
  });
});

test('Modul-eigene Innenscroller sind im Smartphone-Profil freigegeben', () => {
  /* Im Profil gibt es GENAU EINEN äußeren Scroller. Trägt ein Modulrahmen selbst
     overflow:hidden oder eine gebundene Höhe, ist sein Inhalt schlicht abgeschnitten - der
     äußere Scroller sieht nichts davon, und ein verschachtelter Scroller ist auf einem Telefon
     nicht bedienbar. Deshalb muss jeder solche Rahmen in der Freigabeliste stehen. */
  const block = mobileMediaBlock();
  const listeAb = block.text.indexOf('Frühere Modul-Scroller');
  assert.notStrictEqual(listeAb, -1, 'Die Freigabeliste der Modul-Scroller fehlt.');
  const regel = block.text.slice(listeAb, block.text.indexOf('}', block.text.indexOf('overscroll-behavior', listeAb)));
  ['.gdp-workspace', '.gdp-content', '.gdp-records', '.gdp-detail', '.gdp-sidebar',
    '.sreg-left', '.sreg-list', '.dok-app'].forEach((k) => {
    assert(regel.includes(k), `${k} fehlt in der Freigabeliste - sein Inhalt bleibt mobil abgeschnitten.`);
  });
  ['height: auto', 'max-height: none', 'overflow: visible'].forEach((p) => {
    assert(regel.includes(p), `Die Freigabe setzt ${p} nicht mehr.`);
  });

  // Gegenprobe: die abschneidenden Desktop-Regeln bleiben unangetastet.
  assert(html.includes('.gdp-workspace{display:grid;grid-template-rows:auto auto minmax(0,1fr);border:1px solid var(--gdp-line);border-radius:8px;overflow:hidden'),
    'Die Desktop-Regel von .gdp-workspace wurde verändert.');
  /* 28.08.2026, zweiter Schritt: Die Deckelung ist von der LISTE auf die SPALTE gewandert.
     Erst hatte .sreg-list eine feste Hoehe (620px, ragte am MacBook heraus), dann eine an der
     Fensterhoehe. Beides liess die linke Spalte auf ihrer Eigenhoehe stehen, waehrend die rechte
     weiterlief - gewuenscht ist aber, dass beide gleich weit nach unten reichen. Jetzt streckt
     .sreg-shell die Spalte (align-items:stretch), .sreg-left deckelt sie an der Bildschirmhoehe
     und die Liste fuellt nur noch den Rest. Der Zweck dieser Gegenprobe bleibt derselbe: Am
     Schreibtisch begrenzt eine Regel die Hoehe - genau die, die das Smartphone-Profil oben
     wieder freigibt (dort stehen .sreg-left UND .sreg-list in der Freigabeliste). */
  assert(html.includes('max-height:calc(90vh - 220px);min-height:min(360px,calc(90vh - 220px))'),
    'Die Desktop-Deckelung von .sreg-left wurde verändert.');
  assert(html.includes('.sreg-list{flex:1 1 auto;min-height:0;overflow:auto}'),
    'Die Liste fuellt nicht mehr den Rest der Spalte.');
  assert(html.includes('.sreg-shell{display:grid;grid-template-columns:290px minmax(0,1fr);gap:16px;align-items:stretch}'),
    'Die linke Spalte waechst nicht mehr mit der rechten mit.');
});

test('Der Finanz-Posten ist mobil eine eigene Vollbildmaske', () => {
  /* Gleiche Mechanik wie bei der Ausgangsrechnung: eine Klasse am #modal, gesetzt nur wenn das
     Formular offen UND die mobile Ansicht aktiv ist. Am Schreibtisch existiert sie nie. */
  assert(html.includes("classList.toggle('finance-mobile-form-open',\n    financeFormOpen&&document.documentElement.classList.contains('mobile-online-active'))"),
    'Der Schalter der Finanz-Vollbildmaske fehlt oder prüft die mobile Ansicht nicht.');
  // Vorbild unverändert.
  assert(html.includes("invoiceModal.classList.toggle('invoice-mobile-form-open',invoiceFormOpen&&document.documentElement.classList.contains('mobile-online-active'))"),
    'Das Vorbild der Rechnungsmaske wurde verändert.');

  const block = mobileMediaBlock();
  const abschnitt = feinschliff(block);
  // Übersicht tritt zurück, das Formular bekommt die volle Höhe.
  assert(/\.finance-view > :is\(\.button-row, \.modal-scroll\) \{[^}]*display: none/.test(abschnitt.replace(/\n\s*/g, ' ')),
    'Die Postenübersicht wird während der Maske nicht ausgeblendet.');
  assert(abschnitt.includes('#financeFormArea'), 'Der Formularbereich bekommt keine eigene Höhe.');
  assert(/\.finance-form > \.button-row \{[^}]*grid-template-columns: repeat\(2/.test(abschnitt.replace(/\n\s*/g, ' ')),
    'Speichern/Abbrechen stehen nicht als Paar am Fuß.');
  // Und: kein Scrollen - der Körper wird während der Maske stillgelegt.
  assert(/finance-mobile-form-open\[data-mobile-view-profile="workspace"\] #modalBody[^{]*\{[^}]*overflow: hidden/.test(abschnitt.replace(/\n\s*/g, ' ')),
    'Der äußere Scroller wird während der Maske nicht stillgelegt.');
});

test('Der Datei-Explorer hat mobil einen einzigen Scroller und einen vollbreiten Ordnerbaum', () => {
  const block = mobileMediaBlock();
  const abschnitt = feinschliff(block);
  const flach = abschnitt.replace(/\n\s*/g, ' ');

  // Der äußere Körper scrollt, die inneren Rahmen nicht mehr.
  assert(/#modal:has\(\.dok-app\) #modalBody \{[^}]*overflow-y: auto/.test(flach),
    'Der Datei-Explorer bekommt keinen äußeren Scroller.');
  assert(/:is\(\.dok-app, \.dok-mitte, \.dok-lauf\)[^{]*\{[^}]*overflow: visible/.test(flach),
    'Die inneren Rahmen des Explorers sind nicht freigegeben.');
  // BEIDE Achsen: clip/visible ist ein unzulässiges Paar und erzeugt wieder einen Scroller.
  assert(!/:is\(\.dok-app, \.dok-mitte, \.dok-lauf\)[^{]*\{[^}]*overflow-y: visible/.test(flach),
    'Es wird nur overflow-y gesetzt - zusammen mit dem früheren overflow-x:clip entsteht wieder ein Scroller.');

  /* SPEZIFITÄTSFALLE - der eigentliche Grund, warum zwei Versuche scheiterten.
     Die blockierende Regel ist "html.mobile-online-active #modalBody > *" mit
     overflow-x:hidden !important, Spezifität (1,1,1). Eine Freigabe der Form
     ":is(.dok-app, …)" hat nur (0,2,1) und kommt dagegen NIE an - die ID entscheidet
     zuerst. Die Freigabe muss #modalBody selbst im Selektor führen. */
  assert(html.includes('html.mobile-online-active #modalBody > *'),
    'Die blockierende Regel wurde entfernt oder umbenannt - dieser Test muss dann angepasst werden.');
  const freigabe = flach.match(/[^{}]*:is\(\.dok-app, \.dok-mitte, \.dok-lauf\)[^{]*\{[^}]*overflow: visible[^}]*\}/);
  assert(freigabe, 'Die Freigaberegel wurde nicht gefunden.');
  assert(/#modalBody/.test(freigabe[0]),
    'Die Freigabe führt #modalBody nicht im Selektor - mit (0,2,1) verliert sie gegen '
    + '"#modalBody > *" (1,1,1), und .dok-app wird wieder ein eigener Scrollcontainer.');
  assert(/#modalBody > \.dok-app/.test(flach),
    'Für .dok-app als direktes Kind fehlt die ausdrücklich höher gewichtete Freigabe.');
  assert(/\.dok-tisch thead th \{[^}]*position: static/.test(flach),
    'Der klebende Tabellenkopf bliebe ohne eigenen Scroller mitten im Bild hängen.');

  // Ordnerbaum über die ganze Breite, als Überlagerung, mit Platz für die Hauptnavigation.
  /* Es gibt inzwischen ZWEI Regeln fuer den Ordnerbaum: die Hauptregel mit Breite und Lage,
     und eine kurze, die bei verschwindender Navigation nur das bottom nachzieht. Gesucht ist
     hier ausdruecklich die Hauptregel - also die mit position:fixed. */
  const baum = [...flach.matchAll(/\.dok-app\.dok-narrow > \.dok-baum \{[^}]*\}/g)]
    .map((treffer) => treffer[0])
    .find((block) => /position: fixed/.test(block));
  assert(baum, 'Die mobile Hauptregel des Ordnerbaums fehlt.');
  assert(/width: 100%/.test(baum), 'Der Ordnerbaum nutzt nicht die volle Breite.');
  assert(/position: fixed/.test(baum), 'Der Ordnerbaum ist keine Überlagerung der ganzen Ansicht.');
  assert(/bottom: calc\(64px/.test(baum), 'Der Ordnerbaum lässt keinen Platz für die Hauptnavigation.');

  // Nur die Pfadleiste bleibt oben stehen - alles darüber scrollt weg.
  const pfad = flach.match(/html\.mobile-online-active \.dok-pfad \{[^}]*\}/);
  assert(pfad, 'Die Pfadleiste hat keine mobile Regel.');
  assert(/position: sticky/.test(pfad[0]) && /top: 0/.test(pfad[0]),
    'Die Leiste mit den Pfeilen bleibt beim Scrollen nicht oben stehen.');
  assert(/background: var\(--paper\)/.test(pfad[0]),
    'Ohne eigenen Hintergrund scheint der Inhalt durch die klebende Leiste.');

  /* Die Sicherheitszone der Hauptnavigation wird für ÜBERLAGERUNGEN (Kontextmenü, Ordnerbaum)
     freigegeben, sobald diese beim Scrollen verschwindet - sonst schwebt das Kontextmenü über
     einem leeren Streifen.

     UMGEBAUT 03.08.2026: früher hing das an Root-:has(…is-hidden)-Regeln. Deren zweiter
     Zwilling (padding-bottom des Modalrahmens = des einzigen Scrollers) erzeugte eine
     Rückkopplung: Leisten-Umschalten -> 78px-Reflow -> nachgezogene Scrollposition ->
     Gegen-Delta -> Leiste kippt zurück -> Endlosschleife ("Finanzen hängt sich auf").
     Jetzt führt ein Beobachter die schlichte Klasse mobile-shell-verdeckt am <html> nach;
     nachrücken dürfen nur noch Überlagerungen, nie der Scroller. */
  ['.dok-pop', '.dok-app.dok-narrow > .dok-baum'].forEach((sel) => {
    const re = new RegExp(`html\\.mobile-online-active\\.mobile-shell-verdeckt[^{]*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    assert(re.test(flach), `${sel} gibt die Sicherheitszone der Navigation nicht frei.`);
  });
  // Der Beobachter, der die Klasse nachführt, muss existieren und auf die Leiste zeigen.
  assert(html.includes("classList.toggle('mobile-shell-verdeckt'"),
    'Die Mobil-Schale führt die Verdeckt-Klasse nicht mehr nach.');
  assert(html.includes("attributeFilter: ['class']"),
    'Der Verdeckt-Beobachter fehlt (attributes/class an der Leiste).');
  // Gegenprobe der Rückkopplung: KEINE :has-Kopplung an die versteckte Leiste - und der
  // Scroller (Modalrahmen) rückt NIE nach (sein Reflow war die Endlosschleife).
  assert(!html.includes(':has(.mobile-online-shell.is-hidden)'),
    'Eine :has-Kopplung an die versteckte Leiste würde die Scroll-Rückkopplung wieder öffnen.');
  assert(!/mobile-shell-verdeckt[^{]*\.modal-box/.test(flach),
    'Der Modalrahmen darf bei verdeckter Leiste nicht nachrücken (78px-Reflow = Endlosschleife).');

  // Gegenprobe: die Desktop-Regeln des Explorers sind unangetastet.
  assert(html.includes('.dok-lauf{flex:1 1 auto;overflow:auto;padding:0 12px 12px;min-height:0}'),
    'Die Desktop-Regel der Dateiliste wurde verändert.');
  assert(html.includes('width:min(268px,86%)'), 'Die Desktop-Regel des Ordnerbaums wurde verändert.');
});

test('Ein Ordnerklick schließt den Baum auf schmalen Geräten wieder', () => {
  /* Der Baum liegt mobil als Überlagerung über dem Inhalt. Bliebe er nach der Wahl offen,
     verdeckte er genau das Ergebnis des eigenen Klicks. */
  assert(html.includes('baum.__dokAutoZu'), 'Der Selbstschluss des Ordnerbaums fehlt.');
  assert(html.includes("if(!app.classList.contains('dok-narrow'))return;"),
    'Der Selbstschluss greift nicht nur auf schmalen Geräten - am Schreibtisch würde er stören.');
  assert(html.includes("if(e.target.closest('.dok-chev'))return;"),
    'Das Auf-/Zuklappen eines Astes würde den Baum fälschlich schließen.');
  assert(html.includes("if(!e.target.closest('.dok-o,.dok-bh'))return;"),
    'Es wird nicht auf eine echte Ordnerzeile geprüft.');
  assert(html.includes("app.classList.remove('dok-show-baum');\n        var knopf="),
    'Der Baum wird beim Ordnerklick nicht geschlossen.');
  // Der gemerkte Zustand muss mitgeführt werden, sonst klappt er beim nächsten Aufbau wieder auf.
  assert(/baumOffen=false;\s*app\.classList\.remove\('dok-show-baum'\)/.test(html),
    'Der gemerkte Offen-Zustand wird nicht zurückgesetzt - der Baum käme beim Neuaufbau zurück.');
});

test('Die Auslösebedingung der mobilen Ansicht bleibt unverändert', () => {
  // Ausdrücklicher Wunsch: die mobile Ansicht darf NUR auf Telefonen und grob auflösenden
  // Tablets greifen. Weder die Breitenschwelle noch die Klasse dürfen sich verschieben.
  // Zwei 1024-px-Abfragen sind der gewachsene Bestand (Grundlayout und Modulprofile).
  assert.equal(html.split('@media (max-width: 1024px) {').length - 1, 2,
    'Die Zahl der 1024-px-Mobilabfragen hat sich verändert - die Auslöseschwelle wurde angefasst.');
  assert(html.includes('mobile-online-active'), 'Die Mobil-Klasse fehlt.');
  // Der Feinschliff bringt genau eine zusätzliche, engere Abfrage mit - und die sitzt INNERHALB
  // der Mobilabfrage, verschiebt die Schwelle also nicht.
  const block = mobileMediaBlock();
  assert(block.text.includes('@media (max-width: 430px)'),
    'Die enge Zusatzabfrage des Feinschliffs fehlt.');
});

/* Nutzerentscheid 30.08.2026: Archiv und Export-/Versandhistorie kommen aufs Telefon; die
   übrigen fehlenden Bereiche (Ordnergenerator, Fallorganisation, Berichte, Online-Formulare,
   Sicherung, Einstellungen, Admin) bleiben bewusst Schreibtischarbeit. Die Registry wird
   AUSGEFÜHRT geprüft: Doppelte Wurzeln sind der Fehler, der hier wehtut - adaptMobileTopLevelView
   nimmt den ERSTEN Treffer, ein zweites Modul mit derselben Wurzel bekäme nie sein Profil. */
test('Mobil-Registry: Archiv und Versandhistorie sind eingetragen, jede Wurzel bleibt eindeutig', () => {
  const vm = require('node:vm');
  const von = html.indexOf('  const ACTIONS = [');
  const bis = html.indexOf('\n  ];', von);
  assert.ok(von > 0 && bis > von, 'Die Mobil-Registry wurde nicht gefunden.');
  const quelle = html.slice(von, bis + 5);
  const ctx = {
    openMobileStartPage: () => {}, openFollowups: () => {}, openMobileAbilities: () => {},
    openUserMenu: () => {}, ACTIONS: null
  };
  vm.createContext(ctx);
  new vm.Script(quelle + '\n;globalThis.__actions=ACTIONS;', { filename: 'mobile-registry.js' }).runInContext(ctx);
  const actions = ctx.__actions;
  assert.ok(Array.isArray(actions) && actions.length > 25, 'Registry konnte nicht ausgeführt werden.');

  const archiv = actions.find((a) => a.id === 'case-archive');
  const versand = actions.find((a) => a.id === 'send-history');
  assert.ok(archiv, 'Archiv fehlt in der mobilen Navigation.');
  assert.ok(versand, 'Export- und Versandhistorie fehlt in der mobilen Navigation.');
  /* Vergleich über join: Die Felder stammen aus dem vm-Kontext und tragen dessen Array-Prototyp. */
  assert.strictEqual(archiv.fns.join(','), 'openArchiveView');
  assert.strictEqual(versand.fns.join(','), 'showExportHistory',
    'Die FALLBEZOGENE Historie ist gemeint (showExportHistory), nicht die büroweite (__bdocShowSends).');
  assert.strictEqual(archiv.mobileRoot, '#archiveViewBody',
    'Beide Ansichten tragen .archive-toolbar - die Wurzel muss die innere Liste sein.');
  assert.strictEqual(versand.mobileRoot, '#phase4HistoryList');
  for (const a of [archiv, versand]) {
    assert.strictEqual(a.mobileProfile, 'workspace', 'Beide nutzen den gemeinsamen Vollhöhen-Scroller.');
    assert.ok(a.short && a.short.length <= 12, `Kurzname zu lang: ${a.short}`);
  }

  /* Zwei Einträge dürfen sich eine Wurzel nur teilen, wenn sie wirklich dieselbe Ansicht sind
     (Fallübersicht und Wiedervorlagen zeichnen beide in .cov-shell). Alles andere ist ein Fehler:
     adaptMobileTopLevelView nimmt den ERSTEN Treffer und würde dem zweiten Modul sein Profil
     wegnehmen. */
  const DIESELBE_ANSICHT = new Map([['.cov-shell', 'case-overview,followups']]);
  const belegt = new Map();
  for (const a of actions) {
    for (const sel of String(a.mobileRoot || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (belegt.has(sel)) {
        const paar = [belegt.get(sel), a.id].join(',');
        assert.strictEqual(DIESELBE_ANSICHT.get(sel), paar,
          `Wurzel „${sel}" doppelt: ${paar} - das zweite Modul bekäme nie sein Mobil-Profil.`);
        const erster = actions.find((x) => x.id === belegt.get(sel));
        assert.strictEqual(erster.mobileProfile, a.mobileProfile,
          `Geteilte Wurzel „${sel}" mit verschiedenen Profilen.`);
        continue;
      }
      belegt.set(sel, a.id);
    }
  }
  const ids = actions.map((a) => a.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'Doppelte Kennung in der Registry.');

  /* Ohne Platz in der Standardreihenfolge landen sie nur hinten dran. */
  const ordVon = html.indexOf('  const DEFAULT_ORDER = [');
  const ordBis = html.indexOf('\n  ];', ordVon);
  const ordnung = html.slice(ordVon, ordBis);
  assert.ok(ordnung.includes("'case-archive'") && ordnung.includes("'send-history'"),
    'Beide Bereiche fehlen in der Standardreihenfolge des Mehr-Menüs.');
  assert.ok(ordnung.indexOf("'documents'") < ordnung.indexOf("'case-archive'")
    && ordnung.indexOf("'case-archive'") < ordnung.indexOf("'banking'"),
    'Die beiden gehören direkt hinter den Datei-Explorer - und nicht auf die Favoritenplätze.');
  assert.ok(ordnung.indexOf("'case-archive'") > ordnung.indexOf("'tasks'"),
    'Sie dürfen nicht in die vorderen Plätze rutschen, die als Favoriten in der Leiste landen.');

  /* Was bewusst NICHT mitkommt (Nutzerentscheid) - schützt vor stillem Nachrutschen. */
  for (const draussen of ['folder-generator', 'case-list', 'case-intake', 'case-outtake', 'reports', 'backup', 'settings', 'admin']) {
    assert.ok(!ids.includes(draussen), `${draussen} sollte mobil NICHT angeboten werden.`);
  }
});

test('Archiv und Versandhistorie: Schaltflächen stehen mobil untereinander', () => {
  /* Nutzerfund 30.08.2026: Die allgemeine Mobilregel legt Aktionsgruppen in ZWEI Spalten -
     bei „JSON herunterladen", „Arbeitsstand bearbeiten" oder „Als Vorlage übernehmen" wurde
     dadurch jede zweite Beschriftung umgebrochen. Diese beiden Ansichten stapeln deshalb. */
  const einspaltig = /html\.mobile-online-active #modalBody\.mobile-top-view-body-v171 :is\(\s*\n\s*\.phase4-history-actions,\s*\n\s*\.archive-actions\s*\n\s*\) \{\s*\n\s*grid-template-columns: minmax\(0, 1fr\) !important;/;
  assert.ok(einspaltig.test(html),
    'Die Einspalten-Regel für Historie und Archiv fehlt.');
  assert.ok(/html\.mobile-online-active #modalBody\.mobile-top-view-body-v171 \.exa-zeile \.exa-btn \{[\s\S]{0,180}?width: 100% !important;/.test(html),
    'Auch die Knöpfe des Dokumentenspeichers gehören auf volle Breite.');
  /* Beide Regeln müssen NACH der allgemeinen Zweispalten-Regel stehen, sonst gewinnt diese. */
  const zweispaltig = html.indexOf('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;');
  const einspaltigPos = html.search(einspaltig);
  assert.ok(zweispaltig > 0 && einspaltigPos > 0,
    'Die allgemeine Zweispalten-Regel wurde nicht gefunden.');
  /* Die Ausnahme steht direkt vor dem Knopf-Teil der allgemeinen Regel - entscheidend ist, dass
     sie NACH deren Spaltendefinition kommt. */
  assert.ok(einspaltigPos > zweispaltig,
    'Die Einspalten-Ausnahme steht vor der allgemeinen Regel und würde überschrieben.');
});

test('Mobil: kein leerer Streifen rechts - Modulbreiten dürfen die Vollbreite nicht schlagen', () => {
  /* Nutzerfund 30.08.2026 in der Archivansicht: Module setzen ihre Fensterbreite über eigene
     :has()-Regeln, teils mit !important (#modal:has(#archiveViewBody) → min(900px,96vw)).
     Diese Selektoren tragen ZWEI ID-Anteile und schlugen die Mobilregel mit nur einem -
     übrig blieben 4 % Breite Hintergrund am rechten Rand. */
  const regel = /html\.mobile-online-active #modal#modal > \.modal-box \{\s*\n\s*width: 100vw !important;\s*\n\s*max-width: none !important;\s*\n\s*\}/;
  assert.ok(regel.test(html),
    'Die Vollbreiten-Regel mit doppelter #modal-Kennung fehlt - Modulregeln gewinnen wieder.');
  /* Sie muss in EINER der 1024-px-Abfragen stehen und an der Mobilklasse hängen, sonst wirkt
     sie auch am Schreibtisch (dort sind die schmaleren Modulbreiten gewollt). */
  const stelle = html.search(regel);
  const marke = '@media (max-width: 1024px) {';
  let drin = false;
  for (let start = html.indexOf(marke); start !== -1 && !drin; start = html.indexOf(marke, start + 1)) {
    let depth = 0;
    for (let i = html.indexOf('{', start); i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}' && --depth === 0) {
        if (stelle > start && stelle < i) drin = true;
        break;
      }
    }
  }
  assert.ok(drin,
    'Die Regel steht außerhalb jeder 1024-px-Abfrage und würde den Schreibtisch verändern.');
  /* Gegenprobe: Die Modulregeln selbst bleiben unangetastet - am Schreibtisch behält das
     Archiv seine 900px. */
  assert.ok(/#modal:has\(#archiveViewBody\)[^{]*\{[^}]*min\(900px, ?96vw\)/.test(html),
    'Die Desktop-Breite des Archivs wurde versehentlich mitgeändert.');
});
