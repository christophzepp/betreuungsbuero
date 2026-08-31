/* Monatsraster der Kalender-Vollansicht: Wochenzeile als CSS-Grid + Ansichts-Menue.
 *
 * Hintergrund: Bei zwei sich ueberschneidenden Mehrtagesterminen (Termin 1 endet an dem Tag, an dem
 * Termin 2 beginnt) sprang Termin 2 am Folgetag eine Zeile nach oben. Ursache war, dass die "Zeile"
 * eines Balkens nichts weiter war als seine Position im Stapel EINER Tageszelle. Seit dem Umbau ist
 * jede Wochenzeile ein Grid, ein Mehrtagestermin ein Element ueber mehrere Spalten, und die Zeile
 * wird EINMAL JE WOCHE ueber die ganze Spanne vergeben.
 *
 * Dieser Prueflauf loest die reinen Rechenfunktionen aus der HTML heraus und laesst sie mit Stubs
 * laufen - so ist der Fehler als solcher pruefbar, nicht nur das Vorhandensein von Zeichenketten.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

/* ---------- Quelltext-Ausschnitte ---------- */
function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `Funktion ${name} fehlt.`);
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}' && --depth === 0) return html.slice(start, j + 1);
  }
  throw new Error(`Funktion ${name} ist nicht geschlossen.`);
}
function constSource(name) {
  // Bewusst ohne Regex: ein ^...$-Muster mit /m ueber die 70-MB-Datei kostet Sekunden je Aufruf.
  const start = html.indexOf(`\nconst ${name}=`);
  assert.notStrictEqual(start, -1, `Konstante ${name} fehlt.`);
  const end = html.indexOf('\n', start + 1);
  return html.slice(start + 1, end);
}

function blockSource(name) {
  // Mehrzeilige Konstanten-Bloecke (z.B. CAL_VIEW_DEFAULTS) bis zur schliessenden Klammer.
  const start = html.indexOf(`\nconst ${name}=`);
  assert.notStrictEqual(start, -1, `Konstante ${name} fehlt.`);
  let depth = 0;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { if (--depth === 0) return html.slice(start + 1, html.indexOf('\n', j)); }
  }
  throw new Error(`Konstante ${name} ist nicht geschlossen.`);
}

/* Einmal herausloesen, nicht je Testfall - die Datei ist gross. */
const PRELUDE = [
  constSource('CAL_VIEW_KEY'),
  blockSource('CAL_VIEW_DEFAULTS'),
  constSource('CAL_VIEW_LANE_CHOICES'),
  constSource('CAL_VIEW_HOUR_CHOICES'),
  constSource('CAL_VIEW_HEIGHT_CHOICES'),
  blockSource('CAL_VIEW_SCOPES'),
  blockSource('CAL_VIEW_TEXTS'),
  functionSource('calViewPrefs'),
  functionSource('calSaveViewPrefs'),
  functionSource('calHourHeight'),
  functionSource('calTimeWindow'),
  functionSource('calViewMenuHTML'),
  functionSource('calGridSegKey'),
  functionSource('calGridWeekSegments'),
  functionSource('calGridAssignLanes'),
  functionSource('calendarMonthGridProHTML'),
  functionSource('calendarTimeGridHTML')
].join('\n');

/* ---------- Laufumgebung mit Stubs der App-Helfer ---------- */
const pad = (n) => String(n).padStart(2, '0');
function buildContext(prefs) {
  const store = {};
  if (prefs) store['betreuung.calendarView.v1'] = JSON.stringify(prefs);
  const context = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    window: {},
    localDateKey: (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    toLocalInputDate: (s) => String(s).slice(0, 10),
    isoWeekNumber: (d) => {
      const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7) + 3);
      return 1 + Math.round((x - new Date(Date.UTC(x.getUTCFullYear(), 0, 4))) / (7 * 86400000));
    },
    eventHex: (e) => e.hex || '',
    itemTitleWithCase: (e, title) => title,
    repeatIconHTML: () => '',
    realItemId: (e) => e.masterId || e.id,
    esc: (s) => String(s),
    escAttr: (s) => String(s).replace(/"/g, '&quot;'),
    fmtTimeDE: (s) => String(s).slice(11, 16),
    shouldShowCaseContext: () => false,
    calFullFilter: '__all__',
    calFullExpandedEventId: null,
    __calVisPanelOpen: false,
    itemCaseLabel: () => '',
    caseContextChipHTML: () => '',
    mapsLinkHTML: (v) => (v ? `<a>${v}</a>` : ''),
    onlineLinkHTML: (v) => (v ? `<a>${v}</a>` : '')
  };
  vm.createContext(context);
  vm.runInContext(PRELUDE, context);
  vm.runInContext(functionSource('calFullEventRowHTML'), context);
  return context;
}

/* Tagessegmente wie splitMultiDay() sie erzeugt (inklusive segGroup je Vorkommen). */
function multiDay(occurrenceId, masterId, title, from, to, hex) {
  const out = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    out.push({
      id: `${occurrenceId}::md${key}`, segGroup: occurrenceId, masterId,
      isMultiDaySegment: true, allDay: true, title, hex,
      startAt: `${key}T00:00:00`, endAt: `${key}T23:59:59`,
      segFirst: key === from, segLast: key === to
    });
  }
  return out;
}
function timed(id, title, day, time, hex) {
  return { id, title, hex, startAt: `${day}T${time}:00`, endAt: `${day}T${time}:00` };
}

function bars(markup) {
  return [...markup.matchAll(/<div class="(calgrid-bar[^"]*)" style="grid-column:(\d+)\/(\d+);grid-row:(\d+);[^"]*" title="([^"]*)"/g)]
    .map((m) => ({ cls: m[1], firstCol: +m[2], lastCol: +m[3] - 1, row: +m[4], title: m[5] }));
}
function chips(markup) {
  return [...markup.matchAll(/<div class="calgrid-chip" style="grid-column:(\d+)\/(\d+);grid-row:(\d+);[^"]*" title="([^"]*)"/g)]
    .map((m) => ({ col: +m[1], row: +m[3], title: m[4] }));
}

/* Der gemeldete Fall: Urlaub 06.-12.08., Klinikaufenthalt 12.-18.08. (ueberschneiden sich am 12.),
   Betreuerwechsel 17.-21.08. und mehrere Einzeltermine am 12.08. */
const AUGUST = new Date(2026, 7, 1);
const SZENARIO = [
  ...multiDay('e2', 'e2', 'Urlaub Frau Berger', '2026-08-06', '2026-08-12', '#2f6e9f'),
  ...multiDay('e3', 'e3', 'Klinikaufenthalt Herr Sander', '2026-08-12', '2026-08-18', '#a36400'),
  ...multiDay('e4', 'e4', 'Betreuerwechsel Akte 2024/118', '2026-08-17', '2026-08-21', '#237a3b'),
  timed('s2', 'Gerichtstermin AG Bonn', '2026-08-11', '09:30', '#1f4e78'),
  timed('s3', 'Jahresbericht abgeben', '2026-08-12', '11:00', '#1f4e78'),
  timed('s4', 'Telefonat Heimleitung', '2026-08-12', '16:15', '#1f4e78'),
  timed('s5', 'Kassenpruefung', '2026-08-12', '17:30', '#1f4e78'),
  timed('s6', 'Hausbesuch Herr Milke', '2026-08-13', '14:00', '#1f4e78')
];

test('Jede Wochenzeile ist ein Grid, Termine spannen echte Spalten', () => {
  assert(html.includes('.calgrid-week-row{display:grid;grid-template-columns:var(--calgrid-kw) repeat(7,minmax(0,1fr))'),
    'Wochenzeile ist kein Grid mehr.');
  assert(html.includes('.calgrid-day{grid-row:1/-1'), 'Tageszelle spannt nicht mehr die volle Wochenzeile.');
  assert(html.includes('.calgrid-wrap.calgrid-no-kw{--calgrid-kw:0px}'), 'Abschaltbare KW-Spalte fehlt.');
  assert(html.includes('html.cal-dragging :is(.calgrid-bar,.calgrid-chip,.calgrid-more){pointer-events:none}'),
    'Termine werden beim Ziehen nicht durchlaessig - Ablegen auf der Zelle darunter waere blockiert.');
  assert(html.includes("document.documentElement.classList.add('cal-dragging')"),
    'Der Drag-Start setzt die Durchlaessigkeits-Klasse nicht.');
});

test('Mehrtagestermine tragen einen Gruppenschluessel je Vorkommen', () => {
  assert(html.includes('segGroup:e.id'), 'splitMultiDay() setzt kein segGroup.');
  assert(html.includes('function calGridSegKey(e){return (e&&e.segGroup)||(e&&e.id)||\'\'}'),
    'Gruppenschluessel greift nicht auf segGroup zurueck.');
});

test('Der gemeldete Zeilensprung tritt nicht mehr auf', () => {
  const markup = buildContext(null).calendarMonthGridProHTML(AUGUST, SZENARIO, '2026-08-12');
  const klinik = bars(markup).filter((b) => b.title.startsWith('Klinikaufenthalt'));
  assert.equal(klinik.length, 2, 'Der Klinikaufenthalt muesste zwei Wochenabschnitte haben.');
  const zeilen = new Set(klinik.map((b) => b.row));
  assert.equal(zeilen.size, 1, `Der Termin wechselt die Zeile: ${[...zeilen].join(' / ')}`);
  // Ein Abschnitt je Woche - nicht ein Element je Tag.
  const mi_bis_so = klinik.find((b) => b.firstCol === 4);
  assert(mi_bis_so, 'Der Abschnitt ab Mittwoch fehlt.');
  assert.equal(mi_bis_so.lastCol, 8, 'Der Abschnitt laeuft nicht bis zum Sonntag durch.');
  assert(mi_bis_so.cls.includes('md-first'), 'Der echte Terminbeginn hat keine runde Kappe.');
  assert(!mi_bis_so.cls.includes('md-last'), 'Ein weiterlaufender Abschnitt darf keine Endkappe haben.');
  // Auch der Nachbartermin bleibt in seiner Zeile.
  const urlaub = bars(markup).filter((b) => b.title.startsWith('Urlaub'));
  assert.equal(new Set(urlaub.map((b) => b.row)).size, 1, 'Der Urlaub wechselt die Zeile.');
});

test('Zeilentreue ueber den Wochenwechsel laesst sich abschalten', () => {
  const ohne = buildContext({ carryLanes: false }).calendarMonthGridProHTML(AUGUST, SZENARIO, '');
  const klinik = bars(ohne).filter((b) => b.title.startsWith('Klinikaufenthalt'));
  assert.equal(new Set(klinik.map((b) => b.row)).size, 2,
    'Ohne Zeilentreue muesste der Termin die Wochenzeile wechseln duerfen.');
  // Innerhalb EINER Woche bleibt die Zeile trotzdem stabil - das ist baulich so, nicht einstellbar.
  klinik.forEach((b) => assert(b.firstCol < b.lastCol || b.firstCol === b.lastCol));
});

test('Einzeltermine stehen buendig unter den Balken', () => {
  const buendig = buildContext(null);
  const markup = buendig.calendarMonthGridProHTML(AUGUST, SZENARIO, '');
  const inKw33 = chips(markup).filter((c) => ['Gerichtstermin AG Bonn', 'Jahresbericht abgeben', 'Hausbesuch Herr Milke'].includes(c.title));
  assert.equal(inKw33.length, 3, 'Nicht alle sichtbaren Einzeltermine der Woche gefunden.');
  assert.equal(new Set(inKw33.map((c) => c.row)).size, 1, 'Die Einzeltermine stehen nicht auf einer Linie.');

  const gestapelt = buildContext({ alignSingles: false }).calendarMonthGridProHTML(AUGUST, SZENARIO, '');
  const frei = chips(gestapelt).filter((c) => c.title === 'Gerichtstermin AG Bonn');
  assert.equal(frei.length, 1);
  assert(frei[0].row < inKw33[0].row, 'Abgeschaltet muesste der Einzeltermin weiter oben sitzen.');
});

test('Zeilen je Woche begrenzen die Anzeige und erzeugen "+N weitere"', () => {
  const drei = buildContext(null).calendarMonthGridProHTML(AUGUST, SZENARIO, '');
  const zwei = buildContext({ lanes: 2 }).calendarMonthGridProHTML(AUGUST, SZENARIO, '');
  const alle = buildContext({ lanes: 0 }).calendarMonthGridProHTML(AUGUST, SZENARIO, '');
  const zaehle = (m) => [...m.matchAll(/class="calgrid-more"[^>]*>\+(\d+) weitere/g)].map((x) => +x[1]);
  assert.deepEqual(zaehle(drei), [2], 'Bei drei Zeilen muessten am 12.08. zwei Termine verborgen sein.');
  assert.equal(zaehle(zwei).reduce((a, b) => a + b, 0) > 2, true, 'Zwei Zeilen muessten mehr verbergen.');
  assert.deepEqual(zaehle(alle), [], 'Mit "alle" darf nichts verborgen bleiben.');
  assert(drei.includes('onclick="window.__calendarDayClick('), '"+N weitere" oeffnet den Tag nicht.');
});

test('Kalenderwochen, Folgetitel und Zeilennummern sind schaltbar', () => {
  const standard = buildContext(null).calendarMonthGridProHTML(AUGUST, SZENARIO, '');
  assert(/class="calgrid-kw"/.test(standard), 'KW-Spalte fehlt in der Voreinstellung.');
  assert(!/calgrid-no-kw/.test(standard), 'KW-Abschaltklasse steht faelschlich.');
  assert(!/calgrid-lane-no/.test(standard), 'Zeilennummern sind nicht die Voreinstellung.');
  // Titel in Folgewochen: der zweite Abschnitt des Klinikaufenthalts traegt in der Voreinstellung
  // seinen Titel, abgeschaltet bleibt er leer.
  const fortsetzung = (m) => bars(m).find((b) => b.title.startsWith('Klinikaufenthalt') && !b.cls.includes('md-first'));
  assert(new RegExp(`grid-row:${fortsetzung(standard).row};[^"]*" title="Klinikaufenthalt[^"]*"[^>]*>Klinikaufenthalt`).test(standard),
    'Der Titel wird in der Folgewoche nicht wiederholt.');

  const knapp = buildContext({ weekNumbers: false, repeatTitle: false, laneNumbers: true })
    .calendarMonthGridProHTML(AUGUST, SZENARIO, '');
  assert(!/class="calgrid-kw"/.test(knapp), 'KW-Spalte laesst sich nicht abschalten.');
  assert(/calgrid-no-kw/.test(knapp), 'Rahmen bekommt die KW-Abschaltklasse nicht.');
  assert(/calgrid-lane-no/.test(knapp), 'Zeilennummern lassen sich nicht einblenden.');
  assert(/title="Klinikaufenthalt[^"]*"[^>]*><\/div>/.test(knapp) || !/>Klinikaufenthalt Herr Sander<\/div>[\s\S]*>Klinikaufenthalt Herr Sander</.test(knapp),
    'Ohne Wiederholung duerfte der Titel nur einmal stehen.');
});

test('Zwei Vorkommen desselben Serientermins verschmelzen nicht', () => {
  const serie = [
    ...multiDay('S1::2026-08-03', 'S1', 'Serientermin', '2026-08-03', '2026-08-04'),
    ...multiDay('S1::2026-08-06', 'S1', 'Serientermin', '2026-08-06', '2026-08-07')
  ];
  const markup = buildContext(null).calendarMonthGridProHTML(AUGUST, serie, '');
  const gefunden = bars(markup);
  assert.equal(gefunden.length, 2, 'Die beiden Wiederholungen wurden zu einem Balken verschmolzen.');
  gefunden.forEach((b) => assert.equal(b.lastCol - b.firstCol, 1, 'Ein Vorkommen umfasst zwei Tage.'));
});

test('Tageszellen bleiben Klick-, Drag- und Drop-Ziel', () => {
  const markup = buildContext(null).calendarMonthGridProHTML(AUGUST, SZENARIO, '2026-08-12');
  assert(markup.includes('ondragover="window.__calDragOverCell(event)"'), 'Drop-Ziel der Tageszelle fehlt.');
  assert(markup.includes('ondrop="window.__calDropOnMonthDay(event,'), 'Drop-Handler der Tageszelle fehlt.');
  assert(/class="calgrid-day[^"]*" style="grid-column:\d+" data-cal-day="/.test(markup), 'Tageszelle sitzt nicht in ihrer Spalte.');
  assert(markup.includes('calgrid-selected'), 'Der ausgewaehlte Tag wird nicht hervorgehoben.');
  assert(markup.includes('calgrid-day-last'), 'Der Sonntag bekommt keine Randmarkierung.');
  // Einzeltermine liegen ueber der Zelle und brauchen den Tagesklick daher selbst.
  assert(/class="calgrid-chip"[^>]*onclick="window\.__calendarDayClick\('2026-08-\d\d'\)"/.test(markup),
    'Ein Klick auf einen Einzeltermin waehlt den Tag nicht mehr aus.');
  assert(/class="calgrid-bar[^"]*"[^>]*onclick="event\.stopPropagation\(\);window\.__calendarShowEditForm\(/.test(markup),
    'Ein Klick auf einen Balken oeffnet den Termin nicht mehr.');
});

test('Das Ansichts-Menue haengt in beiden Werkzeugleisten', () => {
  assert(html.includes('function calViewMenuHTML(mode)'), 'Menue-Baustein fehlt.');
  assert(html.includes('window.__calViewPrefSet=function(name,value)'), 'Schalter-Handler fehlt.');
  assert(html.includes('window.__calViewPrefReset=function()'), 'Zuruecksetzen fehlt.');
  const eingebaut = html.split('${calViewMenuHTML(calFullViewMode)}').length - 1;
  assert.equal(eingebaut, 2, 'Das Menue muss in der mobilen UND der Schreibtisch-Leiste stehen.');

  // Das Menue wirklich bauen lassen - die Schalter entstehen erst aus der Vorlage.
  const menue = buildContext(null).calViewMenuHTML('month');
  assert(menue.includes('data-kind="view"'), 'Das Menue nutzt nicht die Mechanik der Sichtbarkeitsleiste.');
  assert(menue.includes('class="cal-vis-panel cal-view-panel"'), 'Das Menue ist kein Ausklappmenue der Leiste.');
  ['weekNumbers', 'repeatTitle', 'alignSingles', 'carryLanes', 'laneNumbers'].forEach((name) => {
    assert(menue.includes(`window.__calViewPrefSet('${name}',this.checked)`), `Schalter ${name} fehlt im Menue.`);
  });
  [2, 3, 4, 0].forEach((n) => {
    assert(menue.includes(`window.__calViewPrefSet('lanes',${n})`), `Zeilenzahl ${n} fehlt im Menue.`);
  });
  assert(menue.includes('window.__calViewPrefReset()'), 'Zuruecksetzen fehlt im Menue.');
  assert(menue.includes('Gilt für die Monatsansicht'), 'Der Geltungshinweis fehlt.');

  // Die Haekchen spiegeln den gespeicherten Stand.
  const angehakt = (m) => (m.match(/type="checkbox" checked/g) || []).length;
  assert.equal(angehakt(menue), 4, 'In der Voreinstellung sind vier der fuenf Schalter an.');
  assert.equal(angehakt(buildContext({ weekNumbers: false, repeatTitle: false, alignSingles: false, carryLanes: false, laneNumbers: false }).calViewMenuHTML('month')),
    0, 'Abgeschaltete Schalter werden weiterhin als angehakt gezeigt.');
});

/* ===================== Woche / Tag ===================== */

const WOCHE = Array.from({ length: 7 }, (_, i) => new Date(2026, 7, 10 + i)); // Mo 10.08. - So 16.08.
function alldayBars(markup) {
  return [...markup.matchAll(/<div class="(caltime-allday-chip[^"]*)" style="grid-column:(\d+)\/(\d+);grid-row:(\d+);[^"]*"[^>]*title="([^"]*)"/g)]
    .map((m) => ({ cls: m[1], firstCol: +m[2], lastCol: +m[3] - 1, row: +m[4], title: m[5] }));
}

test('Kopf, Ganztagszeile und Stundenraster teilen in Tag und Woche exakt dieselben Spalten', () => {
  [1, 5, 7].forEach((dayCount) => {
    const markup = buildContext(null).calendarTimeGridHTML(WOCHE.slice(0, dayCount), SZENARIO);
    const expected = `grid-template-columns:44px repeat(${dayCount},minmax(0,1fr))`;
    const header = markup.match(/id="calTimeHeaderRow" style="([^"]+)"/);
    const allday = markup.match(/id="calTimeAlldayRow" style="([^"]+)"/);
    const body = markup.match(/class="caltime-body" style="([^"]+)"/);
    assert(header && header[1].includes(expected), `Der Kopf besitzt bei ${dayCount} Tagen nicht das gemeinsame Raster.`);
    assert(allday && allday[1].includes(expected), `Die Ganztagszeile besitzt bei ${dayCount} Tagen nicht das gemeinsame Raster.`);
    assert(body && body[1].includes(expected), `Das Stundenraster besitzt bei ${dayCount} Tagen nicht das gemeinsame Raster.`);
    assert.equal((markup.match(/class="caltime-daycol-header(?:\s|\")/g) || []).length, dayCount,
      `Die Kopfzeile enthält bei ${dayCount} Tagen nicht genau ${dayCount} Tagesspalten.`);
    assert.equal((markup.match(/class="caltime-allday-col(?:\s|\")/g) || []).length, dayCount,
      `Die Ganztagszeile enthält bei ${dayCount} Tagen nicht genau ${dayCount} Tagesspalten.`);
    assert.equal((markup.match(/class="caltime-daycol(?:\s|\")/g) || []).length, dayCount,
      `Das Stundenraster enthält bei ${dayCount} Tagen nicht genau ${dayCount} Tagesspalten.`);
  });
});

test('Die Ganztags-Zeile der Wochenansicht springt nicht mehr die Zeile', () => {
  const markup = buildContext(null).calendarTimeGridHTML(WOCHE, SZENARIO);
  const klinik = alldayBars(markup).filter((b) => b.title.startsWith('Klinikaufenthalt'));
  assert.equal(klinik.length, 1, 'Der Mehrtagestermin muss EIN Element über mehrere Spalten sein.');
  assert.equal(klinik[0].firstCol, 4, 'Der Balken beginnt nicht am Mittwoch.');
  assert.equal(klinik[0].lastCol, 8, 'Der Balken läuft nicht bis zum Sonntag durch.');
  assert(klinik[0].cls.includes('md-first'), 'Der echte Beginn hat keine runde Kappe.');
  assert(!klinik[0].cls.includes('md-last'), 'Ein weiterlaufender Ausschnitt darf keine Endkappe haben.');
  const urlaub = alldayBars(markup).filter((b) => b.title.startsWith('Urlaub'));
  assert.equal(urlaub.length, 1);
  assert.notEqual(urlaub[0].row, klinik[0].row, 'Zwei sich überschneidende Balken teilen sich eine Zeile.');
  // Regression: ein Fortsetzungsbalken ohne Titel hat keinen Inhalt. Ohne feste Hoehe fiel er auf
  // Rahmenhoehe zusammen und sah wie ein duenner Strich aus.
  assert(html.includes('.caltime-allday-chip{align-self:center;z-index:2;box-sizing:border-box;height:19px'),
    'Der Ganztags-Balken hat keine feste Höhe und kann bei leerem Titel zusammenfallen.');
  const ohneTitel = buildContext({ repeatTitle: false }).calendarTimeGridHTML(WOCHE, SZENARIO);
  const leer = alldayBars(ohneTitel).find((b) => b.title.startsWith('Urlaub'));
  assert(leer, 'Der Balken verschwindet, wenn der Titel nicht wiederholt wird.');
  // Die Tagesspalte bleibt Drop-Ziel und liegt unter den Terminen.
  assert(markup.includes('class="caltime-allday-col" style="grid-column:'), 'Tagesspalte sitzt nicht im Raster.');
  assert(markup.includes('ondrop="window.__calDropOnMonthDay(event,'), 'Ganztags-Spalte ist kein Drop-Ziel mehr.');
});

test('Das Zeitfenster kürzt leere Randstunden, versteckt aber nie einen Termin', () => {
  const stunden = (m) => (m.match(/class="caltime-hour-label"/g) || []).length;
  const ganz = buildContext(null).calendarTimeGridHTML(WOCHE, SZENARIO);
  assert.equal(stunden(ganz), 24, 'Voreinstellung ist der ganze Tag.');

  // 08-18 Uhr, aber im Szenario liegt ein Termin um 09:30 und einer um 17:30 - beide passen hinein.
  const eng = buildContext({ hours: '8-18' }).calendarTimeGridHTML(WOCHE, SZENARIO);
  assert.equal(stunden(eng), 10, 'Das eingestellte Fenster wird nicht angewandt.');
  assert(eng.includes('--caltime-from:8'), 'Der Fensteranfang steht nicht am Rahmen.');

  // Ein Termin um 06:15 muss das Fenster nach vorn aufziehen.
  const frueh = buildContext({ hours: '8-18' })
    .calendarTimeGridHTML(WOCHE, [...SZENARIO, timed('s0', 'Frühtermin', '2026-08-11', '06:15', '#1f4e78')]);
  assert.equal(stunden(frueh), 12, 'Das Fenster weitet sich nicht auf einen früheren Termin.');
  assert(frueh.includes('--caltime-from:6'), 'Der aufgeweitete Anfang steht nicht am Rahmen.');
  assert(frueh.includes('Frühtermin'), 'Der frühe Termin fehlt in der Ansicht.');
});

test('Die Stundenhöhe ist einstellbar und steht am Rahmen', () => {
  [34, 48, 66].forEach((h) => {
    const markup = buildContext({ hourHeight: h }).calendarTimeGridHTML(WOCHE, SZENARIO);
    assert(markup.includes(`--caltime-hour:${h}px`), `Stundenhöhe ${h} steht nicht am Rahmen.`);
    assert(markup.includes(`height:${h}px`), `Stundenhöhe ${h} wirkt nicht auf die Stundenzeile.`);
    assert(markup.includes(`height:${24 * h}px`), `Gesamthöhe passt nicht zu Stundenhöhe ${h}.`);
  });
  assert(html.includes("calTimeGridHourPx(col),from=calTimeGridFromHour(col)"),
    'Der Drag-Geist rechnet nicht mit der gezeichneten Stundenhöhe.');
  assert(html.includes('calTimeGridHourPx(ev.currentTarget),from=calTimeGridFromHour(ev.currentTarget)'),
    'Der Drop-Handler rechnet nicht mit der gezeichneten Stundenhöhe.');
  assert(html.includes("getPropertyValue(name)"), 'Die Drag-Handler lesen die Werte nicht vom Rahmen.');
});

test('Der Wochentitel überlebt ausgeblendete Wochenenden', () => {
  // Regression: der Titel griff auf days[6] zu. Mit ausgeblendetem Wochenende hat die Liste nur
  // fünf Einträge - die Ansicht warf, und weil calFullViewMode das Schliessen überlebt, liess sich
  // der Kalender danach ÜBERHAUPT nicht mehr öffnen.
  const zeile = html.split('\n').find((l) => l.includes('· KW ${isoWeekNumber('));
  assert(zeile, 'Die Titelzeile der Wochenansicht wurde nicht gefunden.');
  assert(!/days\[6\]/.test(zeile), 'Der Titel greift wieder auf den siebten Tag der gefilterten Liste zu.');
  assert(zeile.includes('wholeWeek[6]'), 'Der Titel bildet sich nicht aus der vollen Woche.');

  // Die ECHTE Zeile aus der Datei ausführen - einmal mit sieben, einmal mit fünf Tagen.
  const woche = Array.from({ length: 7 }, (_, i) => new Date(2026, 6, 27 + i));
  [7, 5].forEach((anzahl) => {
    const context = { wholeWeek: woche, days: woche.slice(0, anzahl), isoWeekNumber: () => 31, title: '' };
    vm.createContext(context);
    vm.runInContext(zeile.trim(), context);
    assert(/^27\.07\. – 02\.08\.2026 · KW 31/.test(context.title), `Titel bei ${anzahl} Tagen falsch: ${context.title}`);
    assert.equal(context.title.includes('Mo–Fr'), anzahl < 7, `Der Mo–Fr-Hinweis stimmt bei ${anzahl} Tagen nicht.`);
  });
});

test('Ein Fehler in einer Ansicht sperrt nicht den ganzen Kalender', () => {
  assert(html.includes('const baueAnsicht=(modus)=>{'), 'Der Ansichtsaufbau ist nicht gekapselt.');
  assert(html.includes('baueAnsicht(calFullViewMode);'), 'Der Aufbau läuft nicht über die Kapselung.');
  assert(html.includes("calFullViewMode='month';"), 'Es gibt keinen Rückfall auf die Monatsansicht.');
  assert(html.includes("baueAnsicht('month');"), 'Der Rückfall baut die Monatsansicht nicht auf.');
  assert(html.includes('zurück zur Monatsansicht'), 'Der Rückfall bleibt stumm.');
  // Der Umschalter muss NACH dem Aufbau entstehen, sonst hebt er nach einem Rückfall die falsche
  // Schaltfläche hervor.
  assert(html.indexOf('const viewSwitchHTML=') > html.indexOf('baueAnsicht(calFullViewMode);'),
    'Der Ansichts-Umschalter wird vor dem Aufbau gebildet.');
});

test('Die Wochenansicht kann auf Montag bis Freitag verkürzt werden', () => {
  assert(html.includes("calViewPrefs().weekends||(d.getDay()!==0&&d.getDay()!==6)"),
    'Die Wochenansicht filtert die Wochenenden nicht heraus.');
  const fuenf = buildContext(null).calendarTimeGridHTML(WOCHE.slice(0, 5), SZENARIO);
  assert(fuenf.includes('grid-template-columns:44px repeat(5,minmax(0,1fr))'), 'Fünf Tage ergeben kein Fünf-Spalten-Raster.');
  const sieben = buildContext(null).calendarTimeGridHTML(WOCHE, SZENARIO);
  assert(sieben.includes('grid-template-columns:44px repeat(7,minmax(0,1fr))'), 'Sieben Tage ergeben kein Sieben-Spalten-Raster.');
  // Ein Balken, der nur bis Sonntag reicht, endet in der Fünf-Tage-Woche am Freitag.
  const klinik = alldayBars(fuenf).find((b) => b.title.startsWith('Klinikaufenthalt'));
  assert.equal(klinik.lastCol, 6, 'Der Balken läuft über die letzte sichtbare Spalte hinaus.');
});

/* ===================== Liste ===================== */

test('Die Listenansicht kann Zusatzzeilen ausblenden', () => {
  const mitOrt = { id: 'x1', title: 'Gerichtstermin', startAt: '2026-08-11T09:30:00', endAt: '2026-08-11T10:30:00', location: 'AG Bonn' };
  const mitAn = buildContext(null).calFullEventRowHTML(mitOrt);
  assert(mitAn.includes('calagenda-meta'), 'Die Zusatzzeile fehlt in der Voreinstellung.');
  const mitAus = buildContext({ agendaMeta: false }).calFullEventRowHTML(mitOrt);
  assert(!mitAus.includes('calagenda-meta'), 'Die Zusatzzeile lässt sich nicht abschalten.');

  const aufgabe = { id: 'x2', __calItemKind: 'todo', title: 'Jahresbericht', description: 'Lange Erläuterung', startAt: '2026-08-11T09:00:00' };
  assert(buildContext(null).calFullEventRowHTML(aufgabe).includes('Lange Erläuterung'), 'Die Beschreibung fehlt.');
  assert(!buildContext({ agendaMeta: false }).calFullEventRowHTML(aufgabe).includes('Lange Erläuterung'),
    'Die Beschreibung lässt sich nicht abschalten.');
});

test('Vergangene Einträge und kompakte Zeilen sind in der Liste verdrahtet', () => {
  assert(html.includes('rows=rows.filter(e=>toLocalInputDate(e.startAt)>=heute)'),
    'Die Liste blendet vergangene Einträge nicht tageweise aus.');
  assert(html.includes('vergangene ausgeblendet'), 'Die Liste sagt nicht an, wie viel sie verbirgt.');
  assert(html.includes("prefs.agendaCompact?' calagenda-compact':''"), 'Die kompakte Darstellung ist nicht verdrahtet.');
  assert(html.includes('.calagenda-list-all.calagenda-compact{gap:1px}'), 'Das CSS der kompakten Darstellung fehlt.');
});

/* ===================== Menue je Ansicht ===================== */

test('Jede Ansicht bekommt genau die Schalter, die dort wirken', () => {
  const ctx = buildContext(null);
  const erwartet = {
    month: ['weekNumbers', 'repeatTitle', 'alignSingles', 'carryLanes', 'laneNumbers'],
    week: ['weekends', 'repeatTitle'],
    day: ['repeatTitle'],
    agenda: ['agendaPast', 'agendaMeta', 'agendaCompact']
  };
  const alle = ['weekNumbers', 'repeatTitle', 'alignSingles', 'carryLanes', 'laneNumbers', 'weekends', 'agendaPast', 'agendaMeta', 'agendaCompact'];
  Object.entries(erwartet).forEach(([mode, namen]) => {
    const menue = ctx.calViewMenuHTML(mode);
    alle.forEach((name) => {
      const drin = menue.includes(`window.__calViewPrefSet('${name}',this.checked)`);
      assert.equal(drin, namen.includes(name), `${mode}: Schalter ${name} ${drin ? 'steht zu Unrecht' : 'fehlt'} im Menü.`);
    });
  });
  // Auswahlgruppen: Zeilen nur im Monat, Zeitfenster/Stundenhöhe nur in Woche und Tag.
  assert(ctx.calViewMenuHTML('month').includes("window.__calViewPrefSet('lanes',3)"), 'Zeilenzahl fehlt im Monat.');
  assert(!ctx.calViewMenuHTML('week').includes("window.__calViewPrefSet('lanes',"), 'Zeilenzahl steht zu Unrecht in der Woche.');
  ['week', 'day'].forEach((mode) => {
    assert(ctx.calViewMenuHTML(mode).includes("window.__calViewPrefSet('hours','8-18')"), `${mode}: Zeitfenster fehlt.`);
    assert(ctx.calViewMenuHTML(mode).includes("window.__calViewPrefSet('hourHeight',66)"), `${mode}: Stundenhöhe fehlt.`);
  });
  assert(!ctx.calViewMenuHTML('agenda').includes("window.__calViewPrefSet('hours',"), 'Zeitfenster steht zu Unrecht in der Liste.');
  // Der Geltungshinweis nennt die richtige Ansicht.
  assert(ctx.calViewMenuHTML('agenda').includes('Gilt für die Listenansicht'), 'Der Geltungshinweis stimmt nicht.');
  assert(ctx.calViewMenuHTML('week').includes('Gilt für die Wochenansicht'), 'Der Geltungshinweis stimmt nicht.');
  // Das Menü hängt jetzt in JEDER Ansicht in der Werkzeugleiste, mobil wie am Schreibtisch.
  assert.equal(html.split('${calViewMenuHTML(calFullViewMode)}').length - 1, 2,
    'Das Menü muss in beiden Werkzeugleisten stehen.');
});

test('Alle JavaScript-Bloecke der HTML bleiben syntaktisch gueltig', () => {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match, index = 0, jsBlocks = 0;
  while ((match = re.exec(html))) {
    index += 1;
    if (/\btype\s*=\s*(['"]?)(?!text\/javascript|application\/javascript|module)\w/i.test(match[1] || '')) continue;
    jsBlocks += 1;
    new vm.Script(match[2], { filename: `calendar-month-grid-${index}.js` });
  }
  assert(jsBlocks > 200, 'Unerwartet wenige JavaScript-Bloecke gefunden.');
});
