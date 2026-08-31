'use strict';

/* Pruefstand fuer die Vorlagenrunde 23.08.2026: vier eingebettete Original-PDFs wurden gegen die
   Vordrucke des Amtsgerichts Bad Duerkheim getauscht, zwei Dokumente kamen neu hinzu (Erweiterung
   des Aufgabenkreises, Todesmitteilung an das Gericht) und beide sind ueber eine Koordinatenkarte
   fuer den Originalexport freigegeben. Der wichtigste Punkt: In der Rechnungslegung steckte zuvor
   eine ausgefuellte 19-seitige Fremdabrechnung als angebliche Blankovorlage. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

const v159Line = html.split('\n').find((line) => line.startsWith('const V159={'));
assert.ok(v159Line, 'V159-Katalogzeile fehlt');
const v159 = JSON.parse(v159Line.slice('const V159='.length, -1));
const nachId = new Map(v159.catalog.map((eintrag) => [eintrag.id, eintrag]));

const NEUE = ['care_extension', 'death_notice_court'];

test('Die beiden neuen Dokumente stehen vollstaendig im Katalog', () => {
  const erwartet = {
    care_extension: { group: 'cat_01', title: 'Erweiterung des Aufgabenkreises', pages: '4 Seite(n)', kuerzel: 'EAK' },
    death_notice_court: { group: 'cat_04', title: 'Todesmitteilung an das Gericht', pages: '1 Seite(n)', kuerzel: 'TM' }
  };
  for (const id of NEUE) {
    const eintrag = nachId.get(id);
    assert.ok(eintrag, `${id} fehlt im Katalog`);
    assert.equal(eintrag.title, erwartet[id].title);
    assert.equal(eintrag.group, erwartet[id].group);
    assert.equal(eintrag.pages, erwartet[id].pages);
    assert.equal(eintrag.authority, 'Betreuungsgericht');
    assert.match(eintrag.author, /Staatsmann/, `${id}: Urheber der Vorlage fehlt`);
    assert.match(eintrag.sourceUrl, /^https:\/\/agduw\.justiz\.rlp\.de\//, `${id}: Belegquelle fehlt`);
    assert.ok(html.includes(`${id}:'${erwartet[id].kuerzel}'`), `${id}: Seitenleisten-Kuerzel fehlt`);
    assert.ok(html.includes(`id="tpl_v159_${id}"`), `${id}: eingebettete Vorlage fehlt`);
    assert.ok(v159.pdfTemplates[id], `${id}: Vorlagenbeschreibung fehlt`);
    assert.ok(v159.flatSchemas[id], `${id}: Schema fehlt`);
  }
});

const MIT_KARTE = ['care_extension', 'death_notice_court', 'closing', 'annual_noassets',
  'care_suggestion', 'initial', 'annual_assets', 'funeral_directive'];

function karteLesen(id) {
  const start = html.indexOf('const OFFICIAL_COORDINATE_MAPS={');
  assert.ok(start > 0, 'Koordinatenkarten fehlen');
  const treffer = html.slice(start).match(new RegExp(`\\n  ${id}:(\\{.*?\\}),\\n`, 's'));
  assert.ok(treffer, `${id}: keine Koordinatenkarte eingetragen`);
  return JSON.parse(treffer[1]);
}
function schemaFelder(id) {
  /* Der SCHEMAS-Block der App hat Vorrang: die V159-flatSchemas werden nur eingesetzt, wenn dort
     noch kein Schema steht (siehe die Zuweisung "if(!SCHEMAS[id])SCHEMAS[id]=schema"). */
  const block = html.slice(html.indexOf('const SCHEMAS={'));
  const anfang = block.indexOf(`\n${id}:{sections:[`);
  if (anfang > 0) {
    const teil = block.slice(anfang, block.indexOf('\n]},\n', anfang));
    const felder = [...teil.matchAll(/\{id:'([a-z_0-9]+)'/g)].map((m) => ({ id: m[1] }));
    assert.ok(felder.length, `${id}: Schema im SCHEMAS-Block ist leer`);
    return felder;
  }
  assert.ok(v159.flatSchemas[id], `${id}: Schema nicht gefunden`);
  return v159.flatSchemas[id].sections.flatMap((a) => a.fields);
}

test('Jedes Schemafeld der zugeordneten Dokumente hat eine Position', () => {
  for (const id of MIT_KARTE) {
    const zuordnung = karteLesen(id);
    const zugeordnet = new Set([...Object.keys(zuordnung.text || {}), ...Object.keys(zuordnung.checks || {}),
      ...Object.keys(zuordnung.tables || {})]);
    const fehlend = schemaFelder(id).filter((f) => !zugeordnet.has(f.id)).map((f) => f.id);
    assert.deepEqual(fehlend, [], `${id}: nicht zugeordnete Felder`);

    /* Positionen muessen auf einer vorhandenen Seite und innerhalb des Blattes liegen. */
    const seiten = v159.pdfTemplates[id].pages;
    for (const [feld, spec] of Object.entries({ ...(zuordnung.text || {}) })) {
      assert.ok(spec.page >= 0 && spec.page < seiten, `${id}/${feld}: Seite ${spec.page} gibt es nicht`);
      assert.ok(spec.y > 0 && spec.y < 842, `${id}/${feld}: y=${spec.y} liegt ausserhalb der Seite`);
      assert.ok(spec.x > 0 && spec.x + (spec.width || 0) <= 596, `${id}/${feld}: ragt ueber den Rand`);
    }
    for (const [feld, optionen] of Object.entries(zuordnung.checks || {})) {
      for (const [wert, spec] of Object.entries(optionen)) {
        if (spec === null) continue;
        assert.ok(spec.page >= 0 && spec.page < seiten, `${id}/${feld}/${wert}: Seite ${spec.page} gibt es nicht`);
        assert.ok(spec.y > 0 && spec.y < 842, `${id}/${feld}/${wert}: y ausserhalb der Seite`);
      }
    }
  }
});

test('Jede Auswahloption hat eine Position oder ist bewusst leer', () => {
  for (const id of ['care_extension', 'death_notice_court']) {
    const zuordnung = karteLesen(id);
    for (const feld of v159.flatSchemas[id].sections.flatMap((a) => a.fields)) {
      if (!['checks', 'select'].includes(feld.type)) continue;
      const positionen = (zuordnung.checks || {})[feld.id] || {};
      for (const option of feld.options.filter(Boolean)) {
        assert.ok(option in positionen, `${id}/${feld.id}: Option "${option}" fehlt in der Karte`);
      }
    }
  }
});

test('Kopffelder aus den Stammdaten sind angebunden', () => {
  assert.match(html, /window\.__stammwertV262=function/, 'Stammdaten-Aufloeser fehlt');
  assert.ok(html.includes("id.startsWith('stamm.')"), 'Die Koordinatenkarten greifen nicht auf Stammdaten zu');
  /* Die Totenfuersorgeverfuegung ist ein persoenliches Dokument ohne Absender- und Gerichtsblock;
     dort wird nur Ort und Datum gesetzt. */
  for (const id of MIT_KARTE) {
    const schluessel = Object.keys(karteLesen(id).text || {}).filter((k) => k.startsWith('stamm.'));
    const erwartet = id === 'funeral_directive' ? 1 : 3;
    assert.ok(schluessel.length >= erwartet, `${id}: Kopffelder sind nicht aus den Stammdaten belegt`);
  }
  /* Der Schlussbericht traegt den Briefkopf des Gerichts bereits eingedruckt. */
  assert.ok(!Object.keys(karteLesen('closing').text).some((k) => k.startsWith('stamm.gericht')),
    'closing ueberschreibt den eingedruckten Gerichtsbriefkopf');
  /* Die Vordrucke mit leerem Briefkopf muessen das Gericht dagegen selbst setzen. */
  for (const id of ['annual_noassets', 'care_suggestion', 'initial', 'annual_assets']) {
    assert.ok(Object.keys(karteLesen(id).text).some((k) => k.startsWith('stamm.gericht')),
      `${id}: leerer Briefkopf bleibt ohne Gericht`);
  }
});

test('Was der Vordruck nicht fasst, kommt auf ein Beiblatt statt zu verschwinden', () => {
  /* Die Vordrucke sehen das selbst vor ("Für weitere Mitteilungen bitte Beiblatt verwenden!").
     Der Vordruck wird trotzdem vollständig befüllt - das Beiblatt trägt nur den Überhang. */
  assert.ok(html.includes('async function zeichneBeiblatt('), 'Das Beiblatt fehlt');
  assert.match(html, /Beiblatt zum Vordruck/, 'Das Beiblatt hat keine Überschrift');
  assert.ok(html.includes('if(beiblatt.length)await zeichneBeiblatt('), 'Das Beiblatt wird nicht angehängt');
  /* Zu langer Text und Auswahlwerte ohne Kästchen landen dort mit ihrer Feldbezeichnung. */
  assert.ok(html.includes('zuLang.push({label:schemaField(appId,reportId)?.label||appId,text:roh})'),
    'Überlaufender Text wird nicht mit Inhalt gesammelt');
  assert.ok(html.includes('else if(spec!==null&&!isEmpty(val))ohnePosition.push({label:'),
    'Auswahlwerte ohne Position landen nicht auf dem Beiblatt');
  /* Ein Feld, das der Vordruck gar nicht kennt, ebenfalls. */
  assert.ok(html.includes('for(const feld of allSchemaFields(reportId)){'),
    'Nicht zugeordnete Felder werden nicht aufgenommen');
});

test('Getauschte Vorlagen tragen ihre recherchierte Herkunft', () => {
  /* Bad Duerkheim: gerichtseigener forumSTAR-Ausdruck. */
  for (const id of ['closing', 'accounting']) {
    const eintrag = nachId.get(id);
    assert.match(eintrag.author, /forumSTAR/, `${id}: Urheber der Vorlage nicht kuratiert`);
    assert.match(eintrag.sourceUrl, /agduw\.justiz\.rlp\.de/, `${id}: Belegquelle fehlt`);
    assert.equal(v159.pdfTemplates[id].version, 'bereitgestellt 23.08.2026');
  }
  /* Jahresberichte: landeseinheitliche Fassung mit ausgewiesenem Stand und leerem Briefkopf. */
  for (const id of ['annual_assets', 'annual_noassets']) {
    const eintrag = nachId.get(id);
    assert.equal(eintrag.templateDate, '04.12.2024', `${id}: Stand fehlt`);
    assert.match(eintrag.author, /OLG Koblenz/, `${id}: Urheber der Vorlage nicht kuratiert`);
    assert.match(eintrag.sourceUrl, /Zentrale_Seiten/, `${id}: nicht die zentrale Landesfassung`);
    assert.ok(!/Bad D.rkheim/.test(eintrag.sourceLabel || ''), `${id}: haengt noch am gerichtseigenen Ausdruck`);
  }
  /* Betreuungsanregung: neu, nach neuem Recht. */
  const anregung = nachId.get('care_suggestion');
  assert.ok(anregung, 'Betreuungsanregung fehlt im Katalog');
  assert.equal(anregung.templateDate, '05.12.2024');
  assert.equal(anregung.group, 'cat_01');
  assert.ok(html.includes("care_suggestion:'BAnr'"), 'Kuerzel der Betreuungsanregung fehlt');
  /* Todesanzeige heisst jetzt nach Empfaenger. */
  assert.equal(nachId.get('letter_death_notice').title, 'Todesmitteilung an Dritte');
  /* Die alte Rechnungslegung war ein ausgefuelltes 19-Seiten-Dokument einer fremden Person. */
  assert.equal(nachId.get('accounting').pages, '2 Seite(n)');
  assert.equal(v159.pdfTemplates.accounting.pages, 2);
  assert.ok(!/Rechnungslegung - mit Buchungslisten/.test(html), 'Die ausgefuellte Fremdabrechnung steckt noch in der Datei');
});

test('Rechnungslegung ist nicht mehr pauschal von der Originalvorlage ausgenommen', () => {
  const helfer = html.slice(html.indexOf('function dokOhneOriginalvorlage(id){'));
  const ende = helfer.indexOf('\n}');
  assert.ok(!/id===\s*'accounting'/.test(helfer.slice(0, ende)), 'accounting wird weiterhin hart ausgeschlossen');
});

test('Nicht freigegebene Originalvorlagen sind im Exportdialog gesperrt', () => {
  assert.ok(
    html.includes("${originalUnavailable||!OFFICIAL_PDF_TEMPLATES[id]?.ready?'disabled':''}"),
    'Der Haken "Originalvorlage" laesst sich trotz fehlender Freigabe setzen'
  );
});

test('Dokumente ohne ausfüllbaren Amtsvordruck sind dauerhaft ausgegraut', () => {
  assert.match(html, /const DOK_OHNE_AMTSVORDRUCK=\['advance_directive','remuneration_pdf'\]/,
    'Patientenverfügung und Vergütungsantrag werden nicht dauerhaft ausgegraut');
  assert.ok(html.includes('if(DOK_OHNE_AMTSVORDRUCK.includes(id))return true;'),
    'Die Liste wirkt nicht auf die Ausgabeart Originalvorlage');
});

test('Tabellen lassen sich über die Kategorie zuordnen', () => {
  assert.ok(html.includes("const spalten=[].concat(table.zuordnenNach||'type');"),
    'Kategoriegeführte Tabellenzeilen fehlen');
  assert.ok(html.includes('if(!gruppen.has(y))gruppen.set(y,{zeileSpec,posten:[]});'),
    'Mehrere Posten auf derselben Vordruckzeile werden nicht zusammengefasst');
  assert.ok(html.includes("if(abweichung[col]===false)continue;"), 'Zeilenweise Spaltenausnahmen fehlen');
  const karte = karteLesen('annual_assets');
  assert.ok(karte.tables && karte.tables.assets_detail && karte.tables.income_detail,
    'Der Jahresbericht mit Vermögenssorge hat keine Tabellenzuordnung');
  for (const [feld, tabelle] of Object.entries(karte.tables)) {
    assert.ok(tabelle.zeilen && Object.keys(tabelle.zeilen).length > 3, `${feld}: zu wenige Zeilen`);
    for (const [bez, spec] of Object.entries(tabelle.zeilen)) {
      assert.ok(spec.y > 0 && spec.y < 842, `${feld}/${bez}: y=${spec.y} liegt ausserhalb der Seite`);
    }
  }
});

test('Die Totenfürsorgeverfügung folgt jetzt dem Vordruck', () => {
  const felder = schemaFelder('funeral_directive').map((f) => f.id);
  for (const pflicht of ['fd_burial_type', 'fd_river', 'fd_urn_division', 'fd_primary_name', 'fd_memorial_name']) {
    assert.ok(felder.includes(pflicht), `${pflicht} fehlt im Schema`);
  }
  assert.ok(!felder.includes('fd_cremation'), 'Das Einäscherungs-Feld gibt es im Vordruck nicht');
  /* Die Unterschriftszeile bleibt für die eigenhändige Unterschrift frei. */
  assert.equal(karteLesen('funeral_directive').checks.fd_signature_declarant.true, null);
});

test('Vermögensverzeichnis: alle Anker des eigenen Erzeugers sind gesetzt', () => {
  const vorlage = v159.pdfTemplates.asset_inventory;
  assert.equal(vorlage.mode, 'asset-coordinate', 'Der eigene Erzeuger ist nicht mehr zuständig');
  assert.equal(vorlage.pages, 6);
  assert.match(nachId.get('asset_inventory').template, /BS 10/, 'Nicht die Fassung BS 10');
  assert.equal(nachId.get('asset_inventory').templateDate, '01/2023');

  /* Die Namen, die der Erzeuger anspricht, muessen alle in assetCoordinates stehen: fehlt einer,
     verschwindet die Angabe im Export lautlos. */
  const erzeuger = html.slice(html.indexOf('async function v159CreateAssetInventoryPdf('));
  const rumpf = erzeuger.slice(0, erzeuger.indexOf('\n}'));
  const grenzen = [...rumpf.matchAll(/\.slice\(0,\s*(\d+)\)/g)].map((m) => Number(m[1]));
  const zeilen = grenzen.length ? Math.max(...grenzen) : 2;
  const gebraucht = new Set();
  for (const t of rumpf.matchAll(/put(?:Amount)?\(\s*(?:`([^`]*)`|'([^']*)')/g)) {
    const roh = t[1] || t[2];
    if (!roh.includes('${')) { gebraucht.add(roh); continue }
    for (let i = 0; i < zeilen; i++) gebraucht.add(roh.replace(/\$\{i\+(\d)\}/g, (_m, d) => String(i + Number(d))));
  }
  const aggregat = rumpf.slice(rumpf.indexOf('const aggregate=['));
  for (const z of aggregat.slice(0, aggregat.indexOf(']\n') + 1).matchAll(/\['([^']*)','([^']*)',(?:'([^']*)'|null)\]/g)) {
    gebraucht.add(z[2]);
    if (z[3]) gebraucht.add(z[3]);
  }
  const anker = v159.assetCoordinates;
  const fehlend = [...gebraucht].filter((name) => !(name in anker));
  assert.deepEqual(fehlend, [], 'Anker fehlen');

  for (const [name, rect] of Object.entries(anker)) {
    assert.ok(rect.page >= 0 && rect.page < vorlage.pages, `${name}: Seite ${rect.page} gibt es nicht`);
    assert.ok(rect.y >= 0 && rect.y + rect.height <= 842, `${name}: liegt ausserhalb des Blattes`);
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 596, `${name}: ragt ueber den Rand`);
  }
  /* Vorgedruckte Musterwerte (Summen, Erzeugungsdatum) werden vor dem Schreiben abgedeckt. */
  assert.ok(html.includes('if(spec.clear&&text)page.drawRectangle('), 'Ueberdecken fehlt');
  for (const name of ['EUR 1', 'Summe Seite 1', 'Summe Seite 2', 'Vermögen gesamt', 'Summe Schulden', 'Text1']) {
    assert.equal(anker[name].clear, true, `${name}: der vorgedruckte Wert wird nicht abgedeckt`);
  }
  /* Der Unterschriftsort kommt aus den Stammdaten, nicht mehr fest verdrahtet. */
  assert.ok(!/put\('Ort','St\. Goarshausen'\)/.test(html), 'Der Ort ist weiterhin fest verdrahtet');
});
