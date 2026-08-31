/* Verwaiste Vollmasken-Klassen am geteilten #modal (Nutzerfund 03.08.2026).
 *
 * Gemeldet: "Nach dem Bearbeiten einer Rechnung lässt sich diese mobile Ansicht nicht mehr
 * scrollen" - und kurz darauf: "Alle mobilen Ansichten lassen sich dann nicht mehr scrollen."
 * Ursache: invoice-/mileage-/finance-/todo-mobile-form-open leben am GETEILTEN #modal und
 * tragen overflow:hidden für den Körper. Wer die Maske über das Schließen-Kreuz oder die
 * untere Menüleiste verließ (statt Speichern/Abbrechen), nahm die Klasse mit ins nächste
 * Modul - dort passte "#modal.invoice-mobile-form-open #modalBody { overflow:hidden }"
 * weiterhin, und nichts rollte mehr.
 *
 * Der Fix ist eine zentrale Regel in adaptMobileTopLevelView: eine Vollmasken-Klasse ist nur
 * gültig, solange die Wurzel ihres Moduls wirklich im Körper steht. Dieser Prüfstand führt die
 * ECHTE eingebaute Funktion aus (per Klammerzählung geschnitten) und sichert die Verdrahtung.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

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

test('pruneStaleFormStates räumt genau die Klassen ab, deren Modul nicht mehr sichtbar ist', () => {
  const quelle = schneiden('const MOBILE_FORM_STATE_CLASSES = [', '[', ']')
    + ';\n' + schneiden('function pruneStaleFormStates(', '{', '}');
  // Der Pruner fragt die Modul-Registry, ob ein ANDERES Modul sichtbar ist - hier eine
  // nachgestellte Registry mit der Handkasse als Beispielmodul.
  const sandbox = { ACTIONS: [{ id: 'hk', mobileRoot: '.hk-view' }, { id: 'invoices', mobileRoot: '.invoice-view' }] };
  vm.createContext(sandbox);
  vm.runInContext(quelle + '\nthis.prune = pruneStaleFormStates; this.KLASSEN = MOBILE_FORM_STATE_CLASSES;', sandbox);

  // Array.from zieht das Ergebnis in den Test-Realm - Arrays aus dem vm-Kontext tragen ein
  // fremdes Array.prototype, und strict-deepEqual vergleicht Prototypen mit.
  assert.deepEqual(Array.from(sandbox.KLASSEN, (k) => String(k[0])).sort(), [
    'calendar-mobile-form-open', 'finance-mobile-form-open', 'invoice-mobile-form-open', 'mileage-mobile-form-open', 'todo-mobile-form-open'
  ], 'Alle fünf Vollmasken-Klassen müssen erfasst sein.');

  function fakeModal(...klassen) {
    const set = new Set(klassen);
    return { set, classList: { contains: (c) => set.has(c), remove: (c) => set.delete(c) } };
  }
  const rootMit = (selektoren) => ({ querySelector: (sel) => (selektoren.includes(sel) ? {} : null) });

  // Szenario des Nutzerfunds: Rechnungsmaske offen gelassen, dann anderes Modul (Handkasse).
  const modal = fakeModal('invoice-mobile-form-open', 'hidden-egal');
  sandbox.prune(modal, rootMit(['.hk-view']));
  assert.equal(modal.set.has('invoice-mobile-form-open'), false, 'Die verwaiste Rechnungs-Klasse muss fliegen.');
  assert.equal(modal.set.has('hidden-egal'), true, 'Fremde Klassen bleiben unangetastet.');

  // Gegenprobe: solange die Rechnungsansicht wirklich da ist, bleibt die Klasse stehen.
  const modal2 = fakeModal('invoice-mobile-form-open');
  sandbox.prune(modal2, rootMit(['.invoice-view']));
  assert.equal(modal2.set.has('invoice-mobile-form-open'), true, 'Bei sichtbarem Modul darf nichts abgeräumt werden.');

  // Ladeplatzhalter (Nutzerfund 03.08.2026, Rechnungsmaske): renderInvoiceModal zeigt zwischen
  // Klasse-Setzen und Fertigaufbau kurz "Lädt …" - KEIN Modul ist erkennbar. Die Klasse muss
  // diesen Zwischenstand überleben, sonst öffnet die Vollmaske nie.
  const modal4 = fakeModal('invoice-mobile-form-open');
  sandbox.prune(modal4, rootMit([]));
  assert.equal(modal4.set.has('invoice-mobile-form-open'), true,
    'Der Ladeplatzhalter desselben Moduls darf die Vollmaske nicht abräumen.');

  // Ohne Wurzel (Körper leer/fehlt): alles fliegt.
  const modal3 = fakeModal('mileage-mobile-form-open', 'finance-mobile-form-open');
  sandbox.prune(modal3, null);
  assert.equal(modal3.set.size, 0);
});

test('Die Verdrahtung: Aufräumen läuft bei jedem Ansichtswechsel UND beim Schließen', () => {
  const adapt = schneiden('function adaptMobileTopLevelView(', '{', '}');
  assert.ok(adapt.includes('pruneStaleFormStates(modal, root)'),
    'adaptMobileTopLevelView muss die verwaisten Klassen bei jedem Durchlauf prüfen.');
  // Zweiter Anlauf 03.08.2026: der "kein Modul erkennbar"-Zweig räumte mit der VOLLEN Räumung
  // auch die Vollmasken-Klassen ab - eine Zeile nach der Ladelücken-Ausnahme des Pruners.
  // Dort darf nur noch die sanfte Variante laufen.
  assert.ok(adapt.includes('softClearMobileTopLevelView(root)'),
    'Der kein-Modul-Zweig muss die sanfte Räumung nutzen (Ladelücke!).');
  const nachPrune = adapt.slice(adapt.indexOf('pruneStaleFormStates'));
  assert.ok(!nachPrune.includes('clearMobileTopLevelView()'),
    'Nach dem Pruner darf im offenen Fenster nie die volle Räumung laufen - sie würde die Vollmasken-Klassen abräumen.');

  const clear = schneiden('function clearMobileTopLevelView(', '{', '}');
  assert.ok(clear.includes('MOBILE_FORM_STATE_CLASSES'),
    'Beim Schließen des Fensters müssen alle Vollmasken-Klassen abgeräumt werden.');
  assert.ok(clear.includes("modal.classList.remove('mobile-row-focus')"),
    'Auch die Einzel-Datensatz-Vollansicht darf ein geschlossenes Fenster nicht überleben.');

  const soft = schneiden('function softClearMobileTopLevelView(', '{', '}');
  assert.ok(!soft.includes('MOBILE_FORM_STATE_CLASSES'),
    'Die sanfte Räumung darf die Vollmasken-Klassen NICHT anfassen - das entscheidet der Pruner.');
});

test('Lebenslauf der Rechnungsmaske durch die ECHTEN Funktionen: setzen → laden → aufbauen → wechseln → schließen', () => {
  // Genau der Ablauf, der zweimal brach: renderInvoiceModal setzt die Klasse, zeigt "Lädt …"
  // (kein Modul erkennbar), baut dann fertig auf. Hier läuft der eingebaute Code (per
  // Klammerzählung geschnitten) gegen einen nachgestellten Fensterbau.
  const quelle = [
    schneiden('const MOBILE_FORM_STATE_CLASSES = [', '[', ']') + ';',
    schneiden('function pruneStaleFormStates(', '{', '}'),
    schneiden('function clearMobileTopLevelView(', '{', '}'),
    schneiden('function softClearMobileTopLevelView(', '{', '}'),
    schneiden('function adaptMobileTopLevelView(', '{', '}')
  ].join('\n');

  function fakeElement(id) {
    const classes = new Set();
    return {
      id, hidden: false, dataset: {}, _classes: classes, _visible: [],
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); }
      },
      querySelector(sel) { return this._visible.includes(sel) ? {} : null; }
    };
  }
  const modal = fakeElement('modal');
  const body = fakeElement('modalBody');
  const sandbox = {
    ACTIONS: [
      { id: 'invoices', mobileRoot: '.invoice-view', mobileProfile: 'workspace' },
      { id: 'hk', mobileRoot: '.hk-view', mobileProfile: 'workspace' }
    ],
    document: {
      getElementById: (id) => (id === 'modal' ? modal : (id === 'modalBody' ? body : null))
    }
  };
  sandbox.ACTION_MAP = new Map(sandbox.ACTIONS.map((a) => [a.id, a]));
  vm.createContext(sandbox);
  vm.runInContext('let activeMobileActionId = null;\n' + quelle + '\nthis.adapt = adaptMobileTopLevelView;', sandbox);

  // 1) renderInvoiceModal: Klasse gesetzt, dann "Lädt …" (keine Modulwurzel) → Klasse überlebt.
  modal.classList.add('invoice-mobile-form-open');
  body._visible = [];
  sandbox.adapt(body);
  assert.equal(modal.classList.contains('invoice-mobile-form-open'), true,
    'Die Ladelücke darf die frisch gesetzte Vollmasken-Klasse nicht abräumen.');

  // 2) Fertiger Aufbau: Rechnungsansicht steht → Klasse bleibt, Profil wird gestempelt.
  body._visible = ['.invoice-view'];
  sandbox.adapt(body);
  assert.equal(modal.classList.contains('invoice-mobile-form-open'), true, 'Die offene Maske muss offen bleiben.');
  assert.equal(modal.dataset.mobileViewProfile, 'workspace');
  assert.equal(body.classList.contains('mobile-top-view-body-v171'), true);

  // 3) Modulwechsel zur Handkasse OHNE Speichern/Abbrechen → Klasse fliegt (der Scroll-Hänger von gestern).
  body._visible = ['.hk-view'];
  sandbox.adapt(body);
  assert.equal(modal.classList.contains('invoice-mobile-form-open'), false,
    'Beim echten Modulwechsel muss die verwaiste Klasse fliegen.');

  // 4) Fenster zu → volle Räumung inklusive Einzel-Datensatz-Vollansicht.
  modal.classList.add('mileage-mobile-form-open');
  modal.classList.add('mobile-row-focus');
  modal.classList.add('hidden');
  sandbox.adapt(body);
  assert.equal(modal.classList.contains('mileage-mobile-form-open'), false);
  assert.equal(modal.classList.contains('mobile-row-focus'), false);
});

test('Die fünf Klassen sind keine Erfindung des Tests: jede hat ihre Umschaltstelle im Modul', () => {
  for (const cls of ['invoice-mobile-form-open', 'mileage-mobile-form-open', 'finance-mobile-form-open', 'todo-mobile-form-open', 'calendar-mobile-form-open']) {
    assert.ok(html.includes(`classList.toggle('${cls}'`) || html.includes(`classList.remove('${cls}')`) || html.includes(`classList.add('${cls}')`),
      `${cls} hat keine Umschaltstelle mehr - dann gehört sie auch nicht in die Aufräumliste.`);
  }
});

test('Rechnungs-Vollmaske: die Ausblendliste trifft die echten Klassen der Ansicht', () => {
  // Der Nutzerfund vom 03.08. war ein Klassen-Timing-Problem; das hier sichert die zweite
  // denkbare Bruchstelle - dass Markup und Ausblendliste auseinanderdriften.
  /* Seit der Verguetungs-Pipeline (25.08.2026) gehoert auch .invoice-pipeline in die Liste -
     sonst schiebt sie im Formular-Vollbild die Fusszeile aus dem Bild. */
  assert.ok(html.includes('.invoice-view > :is(.invoice-primary-actions,.invoice-pipeline,.finance-filter-row,.invoice-table-wrap)'),
    'Die Ausblendliste der Rechnungs-Vollmaske fehlt oder kennt die Pipeline nicht.');
  assert.ok(html.includes('class="invoice-pipeline"'), 'Pipeline-Klasse verschoben.');
  assert.ok(html.includes('class="button-row invoice-primary-actions"'), 'Werkzeugleisten-Klasse verschoben.');
  assert.ok(html.includes('<div class="finance-filter-row">') , 'Filterzeilen-Klasse verschoben.');
  assert.ok(html.includes('class="invoice-table-wrap'), 'Tabellen-Klasse verschoben.');
  assert.ok(html.includes('id="invoiceFormArea"'), 'Der Formularbereich (bleibt sichtbar) fehlt.');
});

test('Kalender-Vollmaske: Formular markiert den Pfad, CSS blendet den Rest aus (Nutzerwunsch 03.08.2026)', () => {
  const form = schneiden('async function renderCalendarForm(', '{', '}');
  assert.ok(form.includes('cal-mform-keep'), 'Die Formularkarte muss als Behalten-Wurzel markiert sein.');
  assert.ok(form.includes("classList.add('cal-mform-path')"), 'Der Weg zum Fensterkörper muss markiert werden.');
  assert.ok(form.includes("modal.classList.add('calendar-mobile-form-open')"), 'Ohne Fensterklasse greift kein Vollbild-CSS.');
  assert.ok(form.includes("document.querySelectorAll('.cal-mform-path')"), 'Alte Pfadmarken müssen vor dem Neusetzen abgeräumt werden.');
  assert.ok(form.includes("classList.contains('mobile-online-active')"), 'Am Schreibtisch darf die Maske nie greifen.');

  // Beide Einbauorte des Formulars werden vom selben Pfadmuster abgedeckt:
  assert.ok(form.includes('(inlineTarget||document.getElementById(\'calFullNewForm\'))'),
    'Formular-Einbauorte (Bereich oben UND Agenda-Akkordeon) müssen gemeinsam behandelt werden.');

  assert.ok(html.includes('#modal.calendar-mobile-form-open #modalBody.mobile-top-view-body-v171 > :not(.cal-mform-path)'),
    'Die Ausblend-Regel für Nachbarn des Pfads fehlt.');
  assert.ok(!/calendar-mobile-form-open[^{]*:has\(/.test(html),
    'Bewusst ohne :has() - der Safari-Scrollbefund aus den Finanzen gilt auch hier.');
});

test('Benutzermenü: Hell/Dunkel-Wechsel und Abmelden (Nutzerwunsch 03.08.2026)', () => {
  const menue = schneiden('function openUserMenu(', '{', '}');
  assert.ok(menue.includes('data-mobile-logout'), 'Abmelden muss im Benutzermenü bleiben.');
  assert.ok(menue.includes('data-mobile-theme'), 'Der Darstellungs-Wechsel fehlt im Benutzermenü.');
  assert.ok(menue.includes('AppTheme.togglePreference'),
    'Der Wechsel muss über AppTheme laufen (persistiert serverseitig und stellt den Zeitplan ab).');
  assert.ok(menue.includes('data-theme-icon') && menue.includes('data-theme-state'),
    'Symbol und Zustandstext sollen von AppTheme selbst gepflegt werden (refreshControls).');
  assert.ok(menue.includes('themeBtn.remove()'),
    'Ohne AppTheme (Altbestand) darf kein toter Knopf stehen bleiben.');

  // Und die genutzte AppTheme-Schnittstelle existiert wirklich:
  assert.ok(html.includes('togglePreference:async function'), 'AppTheme.togglePreference fehlt.');
});
