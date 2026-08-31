/* Scroll-Prüf-Zwischenspeicher der Mobil-Schale (Nutzerfund 03.08.2026: "Finanzen hängt sich
 * beim Scrollen auf").
 *
 * Ursache: handleScroll lief bei JEDEM Scroll-Ereignis durch bis zu sechs
 * document.querySelector-Kaskaden über das gesamte Dokument (darunter ein 14-teiliges :is()).
 * Bei langen Listen fror die Seite. Die Antworten hängen aber nur vom Fensteraufbau ab.
 *
 * Dieser Prüfstand führt die ECHTEN eingebauten Funktionen aus (per Klammerzählung
 * geschnitten) und misst das Leistungsversprechen direkt: viele Scroll-Ereignisse,
 * EIN Kaskadenlauf.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function schneiden(startMarke) {
  const start = html.indexOf(startMarke);
  assert.notStrictEqual(start, -1, `${startMarke} fehlt.`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`${startMarke} ist nicht geschlossen.`);
}

function fakeShell() {
  const classes = new Set();
  return { classes, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } };
}

function bauSandbox() {
  const modal = { classes: new Set(), classList: null };
  modal.classList = { add: (c) => modal.classes.add(c), remove: (c) => modal.classes.delete(c), contains: (c) => modal.classes.has(c) };
  const zustand = {
    queryCount: 0,
    // Was die Kaskade "sieht": je Prüfschlüssel eine Antwort (null = kein Treffer).
    antworten: {},
    workspaceScroller: { id: 'body-scroller' }
  };
  const workspaceView = {
    querySelector: (sel) => (sel === '.fr-view #frList' ? null : zustand.workspaceScroller)
  };
  const sandbox = {
    document: {
      getElementById: (id) => (id === 'modal' ? modal : null),
      querySelector: (sel) => {
        zustand.queryCount += 1;
        if (sel.includes('data-mobile-view-profile="workspace"')) return zustand.antworten.workspace ? workspaceView : null;
        for (const key of Object.keys(zustand.antworten)) {
          if (zustand.antworten[key] && sel.includes(key)) return {};
        }
        return null;
      }
    },
    isMobileActive: () => true,
    shell: fakeShell(),
    sheet: null,
    window: {}, // handleScroll unterscheidet Fenster- von inneren Rollern per Identität
    // Steuerbare Uhr: die Wechsel-Sperrfrist (250 ms) wird im Rückkopplungstest exakt gestellt.
    __jetzt: 100000
  };
  sandbox.Date = { now: () => sandbox.__jetzt };
  const quelle = [
    'let scrollProbe = null; let lastWindowScroll = 0; let shellToggleAt = 0; const nestedScrollState = new Map();',
    schneiden('function computeScrollProbe()'),
    schneiden('function handleScroll(target, current)'),
    'this.handleScroll = handleScroll; this.setProbe = (v) => { scrollProbe = v; };'
  ].join('\n');
  vm.createContext(sandbox);
  vm.runInContext(quelle, sandbox);
  return { sandbox, zustand, modal };
}

test('Viele Scroll-Ereignisse, EIN Kaskadenlauf (das war der Finanzen-Hänger)', () => {
  const { sandbox, zustand } = bauSandbox();
  zustand.antworten = { workspace: true };
  const scroller = zustand.workspaceScroller;
  for (let y = 0; y <= 600; y += 12) sandbox.handleScroll(scroller, y);
  assert.ok(zustand.queryCount <= 6,
    `Die Selektor-Kaskade darf je Aufbau nur EINMAL laufen (gemessen: ${zustand.queryCount} Abfragen für 51 Scroll-Ereignisse).`);
  assert.equal(sandbox.shell.classes.has('is-hidden'), true,
    'Stetiges Herunterrollen muss die Leiste weiterhin ausblenden.');
  sandbox.handleScroll(scroller, 0);
  assert.equal(sandbox.shell.classes.has('is-hidden'), false,
    'Zurück an den Anfang muss die Leiste weiterhin einblenden.');
});

test('Fremde Roller bleiben ausgesperrt, offene Editoren halten die Leiste sichtbar', () => {
  const { sandbox, zustand } = bauSandbox();
  zustand.antworten = { workspace: true };
  sandbox.handleScroll({ id: 'anderer' }, 500);
  assert.equal(sandbox.shell.classes.has('is-hidden'), false,
    'Nur der aktive Arbeitsflächen-Roller darf die Leiste steuern.');

  const editor = bauSandbox();
  editor.zustand.antworten = { 'finance-form': true };
  editor.sandbox.shell.classes.add('is-hidden');
  editor.sandbox.handleScroll(editor.zustand.workspaceScroller, 400);
  assert.equal(editor.sandbox.shell.classes.has('is-hidden'), false,
    'Bei offenem Editor muss die Leiste sichtbar werden (unverändertes Verhalten).');
});

test('Fenster zu (nur Klassenwechsel!) wird ohne Beobachter erkannt und rechnet genau einmal neu', () => {
  const { sandbox, zustand, modal } = bauSandbox();
  zustand.antworten = { workspace: true };
  sandbox.handleScroll(zustand.workspaceScroller, 100);
  const nachAufbau = zustand.queryCount;

  // Fenster schließen:在 der Anwendung nur classList.add('hidden') - kein childList-Ereignis.
  modal.classes.add('hidden');
  zustand.antworten = {};
  sandbox.handleScroll(sandbox, 0); // beliebiges Ziel: freier Modus rechnet einmal neu
  assert.ok(zustand.queryCount > nachAufbau, 'Der Sichtbarkeits-Stempel muss den Wechsel bemerken.');
  const nachSchliessen = zustand.queryCount;
  for (let y = 0; y <= 240; y += 12) sandbox.handleScroll(sandbox, y);
  assert.equal(zustand.queryCount, nachSchliessen,
    'Nach der einmaligen Neuberechnung darf wieder keine Kaskade je Ereignis laufen.');
});

test('Die Verdrahtung: jeder Neuaufbau verwirft den Zwischenspeicher', () => {
  const queue = schneiden('function queueMobileAdaptation()');
  assert.ok(queue.includes('scrollProbe = null'),
    'queueMobileAdaptation muss den Scroll-Prüf-Zwischenspeicher verwerfen - sonst steuert ein alter Aufbau die Leiste.');
});

test('Rückkopplung gekappt: ein Umschalt-Echo kippt die Leiste nicht mehr zurück (der Finanzen-Hänger, 2. Wurzel)', () => {
  const { sandbox, zustand } = bauSandbox();
  zustand.antworten = { workspace: true };
  const scroller = zustand.workspaceScroller;

  // Nutzer rollt herunter -> Leiste blendet aus (erster Wechsel, Sperrfrist frei).
  sandbox.handleScroll(scroller, 100);
  sandbox.handleScroll(scroller, 200);
  assert.equal(sandbox.shell.classes.has('is-hidden'), true);

  // 10 ms später: das Layout-Echo des Umschaltens (Scrollposition nachgezogen, Delta umgekehrt).
  sandbox.__jetzt += 10;
  sandbox.handleScroll(scroller, 188);
  assert.equal(sandbox.shell.classes.has('is-hidden'), true,
    'Das Echo (Gegen-Delta innerhalb der Sperrfrist) darf die Leiste NICHT zurückkippen - genau das war die Endlosschleife.');

  // Nach Ablauf der Sperrfrist gewinnt echtes Hochrollen wieder.
  sandbox.__jetzt += 300;
  sandbox.handleScroll(scroller, 170);
  assert.equal(sandbox.shell.classes.has('is-hidden'), false,
    'Echtes Hochrollen nach der Sperrfrist muss die Leiste einblenden.');

  // Der Seitenanfang blendet IMMER ein, auch mitten in der Sperrfrist.
  sandbox.__jetzt += 300; // Sperrfrist des letzten Wechsels ablaufen lassen
  sandbox.handleScroll(scroller, 400);
  sandbox.handleScroll(scroller, 520);
  assert.equal(sandbox.shell.classes.has('is-hidden'), true);
  sandbox.__jetzt += 10;
  sandbox.handleScroll(scroller, 0);
  assert.equal(sandbox.shell.classes.has('is-hidden'), false,
    'Der Seitenanfang ist die Ausnahme von der Sperrfrist.');
});

test('Die 1. Wurzel ist wirklich entfernt: kein :has koppelt mehr an die versteckte Leiste', () => {
  assert.ok(!html.includes(':has(.mobile-online-shell.is-hidden)'),
    'Eine :has(.mobile-online-shell.is-hidden)-Regel würde jeden Leisten-Wechsel wieder zu einem Reflow der Modul-Liste machen (78px-Sprung -> Scroll-Echo -> Endlosschleife).');
});
