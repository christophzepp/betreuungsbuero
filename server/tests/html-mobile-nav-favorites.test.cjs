/* Untere Leiste: bis zu 8 Favoriten + Mehr, Drag-&-Drop-Live-Vorschau, Online-Formulare
 * mobil ausgeblendet (Nutzerwünsche 03.08.2026).
 *
 * Der Kern (sanitizePreferences) läuft hier als ECHTER Code im vm - mit einer nachgestellten
 * ACTIONS-Liste, weil die echte an window-Funktionen hängt. Der Rest ist Verdrahtungsprüfung
 * auf dem Quelltext, im Stil der übrigen HTML-Prüfstände.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');
/* 30.08.2026 (Nutzerentscheid): Archiv und Export-/Versandhistorie stehen direkt hinter dem
   Datei-Explorer - alles, was mit den Papieren eines Falls zu tun hat, beieinander. Bewusst
   NICHT auf den vorderen Plätzen: die wandern als Favoriten in die untere Leiste. */
const expectedDefaultOrder = [
  'start', 'case-chat', 'master-data', 'case-overview', 'documentation', 'calendar',
  'tasks', 'deadlines', 'followups', 'contacts', 'mail', 'documents',
  'case-archive', 'send-history',
  'banking', 'cash',
  'assets', 'livelihood', 'debts', 'health', 'housing', 'abilities', 'needs', 'approvals',
  'contact-monitor',
  'supervision', 'inbox', 'finance', 'invoices', 'mileage', 'qualifications', 'user'
];

function schneiden(startMarke, offen, zu) {
  const start = html.indexOf(startMarke);
  assert.notStrictEqual(start, -1, `${startMarke} fehlt.`);
  let depth = 0;
  for (let i = html.indexOf(offen, start); i < html.length; i++) {
    if (html[i] === offen) depth++;
    else if (html[i] === zu && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`${startMarke} ist nicht geschlossen.`);
}

test('sanitizePreferences: Deckel 8, Verstecktes fliegt auch aus alten Speicherständen', () => {
  const quelle = [
    schneiden('const DEFAULT_ORDER = ', '[', ']') + ';',
    schneiden('const MAX_PINNED = ', '=', ';').replace(/;?$/, ';'),
    schneiden('const MOBILE_HIDDEN_ACTIONS = new Set(', '(', ')') + ';',
    schneiden('function mobileVisible(', '{', '}'),
    schneiden('const MOBILE_CASE_DOMAIN_ORDER = ', '[', ']') + ';',
    schneiden('function normalizeMobileCaseDomainOrder(', '{', '}'),
    schneiden('function sanitizePreferences(', '{', '}')
  ].join('\n');
  const sandbox = {
    ACTIONS: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'online-forms'].map((id) => ({ id })),
    DEFAULT_PINNED: ['a1', 'a2']
  };
  vm.createContext(sandbox);
  vm.runInContext(quelle + '\nthis.sanitize = sanitizePreferences; this.MAX = MAX_PINNED;', sandbox);

  assert.equal(sandbox.MAX, 8, 'Der Deckel muss bei acht liegen.');

  const voll = sandbox.sanitize({
    pinned: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'],
    order: []
  });
  assert.equal(Array.from(voll.pinned).length, 8, 'Mehr als acht Angeheftete werden gekappt.');

  // Online-Formulare: selbst wenn ein alter Speicherstand sie noch trägt, kommen sie weder in
  // die Leiste noch in die Mehr-Reihenfolge.
  const alt = sandbox.sanitize({ pinned: ['online-forms', 'a1'], order: ['online-forms', 'a2'] });
  assert.ok(!Array.from(alt.pinned).includes('online-forms'), 'Versteckte Bereiche dürfen nicht angeheftet bleiben.');
  assert.ok(!Array.from(alt.order).includes('online-forms'), 'Versteckte Bereiche gehören nicht in die Reihenfolge.');
  assert.ok(Array.from(alt.order).includes('a3'), 'Fehlende sichtbare Bereiche werden weiterhin ergänzt.');
});

test('Die mobile Standardreihenfolge enthält alle 32 freigegebenen Bereiche', () => {
  const defaultQuelle = schneiden('const DEFAULT_ORDER = ', '[', ']') + ';';
  const actionQuelle = schneiden('const ACTIONS = ', '[', ']');
  const registeredIds = Array.from(actionQuelle.matchAll(/\{\s*id:\s*'([^']+)'/g), (match) => match[1]);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(defaultQuelle + '\nthis.DEFAULT = DEFAULT_ORDER;', sandbox);

  assert.deepEqual(Array.from(sandbox.DEFAULT), expectedDefaultOrder,
    'Die Reihenfolge muss exakt den drei freigegebenen Screenshots folgen.');
  assert.equal(new Set(expectedDefaultOrder).size, expectedDefaultOrder.length,
    'Der mobile Standard darf keinen Bereich doppelt enthalten.');
  assert.deepEqual([...expectedDefaultOrder].sort(), registeredIds.filter((id) => id !== 'online-forms').sort(),
    'Der Standard muss jeden mobil sichtbaren Registry-Bereich genau einmal enthalten.');
  assert.ok(html.includes('order: [...DEFAULT_ORDER]'),
    'Auch der erste Render vor dem Laden der Präferenzen muss die neue Standardfolge verwenden.');
  const mobileScriptStart = html.indexOf('<script id="mobile-online-shell-v1-js">');
  const mobileScriptEnd = html.indexOf('</script>', mobileScriptStart);
  const defaultOrderPosition = html.indexOf('const DEFAULT_ORDER = ', mobileScriptStart);
  assert.ok(mobileScriptStart >= 0 && defaultOrderPosition > mobileScriptStart && defaultOrderPosition < mobileScriptEnd,
    'Die Standardfolge muss im reinen Smartphone-Shell-Skript bleiben; Desktop-Code darf sie nicht übernehmen.');
});

test('Gespeicherte Nutzerreihenfolge bleibt erhalten; die Fallmodule werden fachlich einsortiert', () => {
  const quelle = [
    schneiden('const DEFAULT_ORDER = ', '[', ']') + ';',
    schneiden('const MAX_PINNED = ', '=', ';').replace(/;?$/, ';'),
    schneiden('const MOBILE_HIDDEN_ACTIONS = new Set(', '(', ')') + ';',
    schneiden('function mobileVisible(', '{', '}'),
    schneiden('const MOBILE_CASE_DOMAIN_ORDER = ', '[', ']') + ';',
    schneiden('function normalizeMobileCaseDomainOrder(', '{', '}'),
    schneiden('function sanitizePreferences(', '{', '}')
  ].join('\n');
  const sandbox = {
    ACTIONS: [...expectedDefaultOrder, 'online-forms'].map((id) => ({ id })),
    DEFAULT_PINNED: ['case-chat', 'case-overview', 'documentation', 'mail']
  };
  vm.createContext(sandbox);
  vm.runInContext(quelle + '\nthis.sanitize = sanitizePreferences;', sandbox);

  const neu = sandbox.sanitize(null);
  assert.deepEqual(Array.from(neu.order), expectedDefaultOrder, 'Ein neues Profil muss mit der neuen Standardfolge starten.');

  const eigeneReihenfolge = ['finance', 'start', 'calendar'];
  const gespeichert = sandbox.sanitize({ order: eigeneReihenfolge, pinned: ['calendar'] });
  const eigeneImErgebnis = Array.from(gespeichert.order).filter((id) => eigeneReihenfolge.includes(id));
  assert.deepEqual(eigeneImErgebnis, eigeneReihenfolge,
    'Eine bereits vom Nutzer gespeicherte Reihenfolge darf nicht auf den Standard zurückgesetzt werden.');
  assert.deepEqual([...Array.from(gespeichert.order)].sort(), [...expectedDefaultOrder].sort(),
    'Es müssen genau die sichtbaren Bereiche enthalten sein - keiner doppelt, keiner fehlt.');
  /* Nachzügler werden fachlich einsortiert statt ans Ende gehängt (Nutzerfund 30.08.2026:
     Archiv und Versandhistorie standen hinter dem Benutzermenü). Der praxisnahe Fall ist ein
     vollständiges Profil, dem nur die neuen Bereiche fehlen. */
  const folge = Array.from(gespeichert.order);
  assert.strictEqual(folge.indexOf('case-archive') + 1, folge.indexOf('send-history'),
    'Archiv und Versandhistorie gehören direkt nebeneinander.');
  const nurNeu = sandbox.sanitize({ order: expectedDefaultOrder.filter((id) => !['case-archive', 'send-history'].includes(id)), pinned: ['calendar'] });
  const nf = Array.from(nurNeu.order);
  assert.strictEqual(nf[nf.indexOf('documents') + 1], 'case-archive',
    'Ein Nachzügler muss direkt hinter seinem Standard-Vorgänger einsortiert werden - nicht am Listenende.');
  assert.strictEqual(nf[nf.indexOf('documents') + 2], 'send-history');
  assert.strictEqual(nf.indexOf('user'), nf.length - 1,
    'Das Benutzermenü bleibt am Ende - die Nachzügler drängeln sich nicht dahinter.');
  assert.deepEqual(nf.filter((id) => !['case-archive', 'send-history'].includes(id)),
    expectedDefaultOrder.filter((id) => !['case-archive', 'send-history'].includes(id)),
    'Alle übrigen Positionen bleiben unangetastet.');
  assert.deepEqual(Array.from(gespeichert.pinned), ['calendar'],
    'Die neue Standardreihenfolge darf die gespeicherte Pin-Auswahl nicht verändern.');

  const alterStand = expectedDefaultOrder.filter((id) => !['housing', 'abilities'].includes(id))
    .concat(['housing', 'abilities']);
  const migriert = sandbox.sanitize({
    order: alterStand,
    pinned: ['needs', 'health', 'abilities', 'housing']
  });
  const bereichsfolge = Array.from(migriert.order)
    .filter((id) => ['health', 'housing', 'abilities', 'needs'].includes(id));
  assert.deepEqual(bereichsfolge, ['health', 'housing', 'abilities', 'needs'],
    'Altprofile dürfen Wohnen und Fähigkeiten nicht länger ans Listenende anhängen.');
  assert.deepEqual(Array.from(migriert.pinned), ['health', 'housing', 'abilities', 'needs'],
    'Auch angeheftete Fallmodule müssen dieselbe fachliche Reihenfolge besitzen.');
});

test('Die Leiste rendert bis zu 8 Favoriten und meldet ihre Knopfzahl fürs CSS', () => {
  const render = schneiden('function renderBottomNavigation(', '{', '}');
  assert.ok(render.includes('.slice(0, MAX_PINNED)'), 'Die Leiste muss auf MAX_PINNED begrenzen (nicht mehr fest auf 4).');
  assert.ok(render.includes('.filter(mobileVisible)'), 'Versteckte Bereiche dürfen nie in die Leiste.');
  assert.ok(render.includes('dataset.navCount'), 'Ohne data-nav-count kann das CSS die Knopfgröße nicht stufen.');

  // Und das CSS kennt die dichteste Stufe wirklich:
  assert.ok(html.includes('[data-nav-count="9"]'), 'Die CSS-Dichtestufe für 8 Favoriten + Mehr fehlt.');
  assert.ok(html.includes('grid-auto-columns: minmax(0, 1fr)'), 'Die Leiste muss ihre Spalten dynamisch aus der Knopfzahl bilden.');
});

test('Anpassen-Dialog: horizontale Live-Vorschau mit Zieh-Umsortierung', () => {
  const editor = schneiden('function openNavigationEditor(', '{', '}');
  assert.ok(editor.includes('mobile-nav-preview'), 'Die Live-Vorschau fehlt im Anpassen-Dialog.');
  assert.ok(editor.includes("addEventListener('pointerdown', startPreviewDrag)"), 'Die Chips müssen per Pointer ziehbar sein (Finger UND Maus).');
  assert.ok(editor.includes('setPointerCapture'), 'Ohne Pointer-Capture reißt die Geste beim Verlassen des Chips ab.');
  assert.ok(editor.includes('preview.insertBefore(chip'), 'Während des Ziehens wird der Knopf verschoben, nicht neu gerendert (sonst stirbt die Geste).');
  assert.ok(editor.includes("Array.from(preview.querySelectorAll('[data-preview-id]'))"), 'Die neue Reihenfolge muss aus dem DOM abgelesen werden.');

  // Optisches Feedback vor dem Loslassen (Nutzerwunsch 03.08.2026):
  assert.ok(editor.includes('scale(1.07) rotate(1.5deg)'),
    'Der Geist muss dem Finger folgen (Inline-Transform mit Anhebung), nicht nur in Zellen springen.');
  assert.ok(editor.includes('el.getBoundingClientRect().left'),
    'Die Nachbarn müssen per FLIP gleiten - Position vorher/nachher messen und weich auflösen.');
  assert.ok(editor.includes('preview.scrollLeft +='),
    'Ohne Randrollen ist bei acht Knöpfen das ferne Ende der Reihe nicht erreichbar.');
  assert.ok(editor.includes("addEventListener('transitionend', settle") && editor.includes('window.setTimeout(settle'),
    'Das Einrasten braucht die Rückfallebene, sonst hängt der Dialog ohne transitionend fest.');
  assert.ok(html.includes('.mobile-nav-preview.is-reordering .mobile-nav-preview-chip:not(.is-dragging)'),
    'Während der Geste müssen die übrigen Knöpfe sichtbar zurücktreten.');
  assert.ok(editor.includes('workingPinned.length >= MAX_PINNED'), 'Die Stecknadel muss beim neuen Deckel (8) stoppen, nicht bei vier.');
  assert.ok(!/höchstens vier/.test(editor), 'Der alte Vier-Bereiche-Hinweistext darf nicht überleben.');

  // touch-action:none an den Chips: sonst scrollt die Seite mit dem Finger statt zu ziehen.
  const chipCss = html.indexOf('.mobile-nav-preview-chip {');
  assert.notStrictEqual(chipCss, -1);
  assert.ok(html.slice(chipCss, chipCss + 600).includes('touch-action: none'),
    'Ohne touch-action:none kämpft das Ziehen gegen das Mitrollen der Seite.');
});

test('Mehr-Menü und Editor blenden Online-Formulare aus, die Erkennung bleibt', () => {
  const more = schneiden('function openMoreMenu(', '{', '}');
  assert.ok(more.includes('state.order.filter(mobileVisible)'), 'Das Mehr-Menü muss versteckte Bereiche auslassen.');
  const editor = schneiden('function openNavigationEditor(', '{', '}');
  assert.ok(editor.includes('workingOrder.filter(mobileVisible)'), 'Der Anpassen-Dialog muss versteckte Bereiche auslassen.');
  assert.ok(html.includes("MOBILE_HIDDEN_ACTIONS = new Set(['online-forms'])"), 'Online-Formulare sind der versteckte Bereich.');
  // Die Registry behält den Eintrag - eine trotzdem geöffnete Ansicht wird weiter erkannt/formatiert.
  assert.ok(html.includes("id: 'online-forms'"), 'Der Registry-Eintrag muss erhalten bleiben (Ansichtserkennung).');
});
