'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'), 'utf8');
const script = html.split('<script id="fristen-script-v1">')[1].split('</script>')[0];
function between(start, end, source = script) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
function fixture(now = '2026-09-16', online = false) {
  let today = now, seq = 0, saves = 0;
  const c = { Date, console, state: { caseData: { care: { startDate: '2026-08-31' }, fristen: [] } },
    window: { __appMode: online ? 'online' : 'local', __activeServerCaseId: 'a', __onlineCaseCache: new Map(), caseRegistry: [] },
    fullName: () => 'Mara Hoffmann', saveState: () => saves++, toast: () => {}, render: () => {},
    frReconcile: async () => {}, frAutoDokuV168: async () => {}, refreshInd: () => {},
  };
  vm.createContext(c);
  vm.runInContext(between('function esc2(', 'const FR_CATS=') +
    between('const FR_CATS=', 'function catLabel(') +
    between('function frData(', '// ---- Wiederkehrende') +
    between('function caseName(', 'async function fristCases(') +
    between('function __caseDeadlines(', '// ---- Kalender-/Aufgaben-Anbindung') +
    between('function normFrist(', 'function frAutoDokuV168(') +
    between('function advance(', '// Öffentliche Schnittstelle für den Posteingang:') +
    between('window.__frNormalize=', 'window.__frUpdateFrist=') +
    between('function frMobileCaseId(', 'function frMobileFilter(') +
    between('window.__remDeadlinesFor=', 'window.__startGenDeadlines=', html), c);
  c.today0 = () => new Date(today + 'T00:00:00');
  c.newId = () => 'fr-' + (++seq);
  c.frItems = [{ caseId: 'a', firstName: 'Mara', lastName: 'Hoffmann', startDate: '2026-08-31' }];
  return { c, setToday: value => today = value, saves: () => saves,
    suggestions: () => c.buildDeadlines(c.frItems),
    rules: (src = c.state.caseData.care) => c.__caseDeadlines(src),
    adopt: d => c.window.__frTakeDerived(d.cat, d.label, d.dueIso, d.interval),
  };
}
test('Anfangsbericht und Vermögensverzeichnis: drei Kalendermonate, Monatsende und Schaltjahr', () => {
  for (const [start, expected] of [['2026-08-31', '2026-11-30'], ['31.08.2026', '2026-11-30'], ['2023-11-30', '2024-02-29'], ['2024-11-30', '2025-02-28'], ['2026-01-01', '2026-04-01']]) {
    const f = fixture(expected);
    for (const category of ['anfangsbericht', 'vermoegensverzeichnis']) {
      const d = f.rules({ startDate: start }).find(x => x.cat === category);
      assert.equal(d.dueIso, expected); assert.equal(d.interval, ''); assert.equal(d.remindDays, 30);
    }
  }
});
test('Jahresbericht/Rechnungslegung frühestens ein Jahr nach Beginn; konkreter Gerichtstermin geht vor', () => {
  const f = fixture('2026-01-05');
  const rules = f.rules({ startDate: '2026-01-01', nextAccountingDue: '2027-03-15' });
  assert.equal(rules.find(d => d.cat === 'jahresbericht').dueIso, '2027-01-01');
  assert.equal(rules.find(d => d.cat === 'rechnungslegung').dueIso, '2027-03-15');
  assert.equal(f.rules({ startDate: '2027-02-01' }).find(d => d.cat === 'jahresbericht').dueIso, '2028-02-01');
  f.setToday('2025-01-01');
  assert.equal(f.rules({ startDate: '2024-02-29' }).find(d => d.cat === 'jahresbericht').dueIso, '2025-02-28');
});
test('Quartalsabrechnung erst nach drei Monaten; Monatsende bleibt ohne Drift verankert', () => {
  const f = fixture('2026-01-31');
  assert.equal(f.c.isoOf(f.c.quarterlyDue('2026-01-31')), '2026-05-01');
  f.setToday('2026-07-15');
  assert.equal(f.c.isoOf(f.c.quarterlyDue('2026-01-31')), '2026-08-01');
  f.setToday('2026-06-15');
  const d = f.rules({ startDate: '2026-01-01' }).find(x => x.cat === 'verguetung');
  assert.equal(d.dueIso, '2026-07-02'); assert.match(d.label, /möglich.*§ 14/); assert.match(d.note, /15 Monate/);
});
test('Einstweilige Anordnung und gerichtlicher Überprüfungstermin bleiben getrennt', () => {
  const f = fixture('2027-02-01');
  const rules = f.rules({ startDate: '2020-03-15', preliminaryOrderDate: '2026-08-31', reviewDate: '2027-04-12' });
  const reviews = rules.filter(d => d.cat === 'ueberpruefung');
  assert.deepEqual(Array.from(reviews, d => d.dueIso), ['2027-02-28', '2027-04-12']);
  assert.notEqual(reviews[0].derivedKey, reviews[1].derivedKey);
  assert.match(reviews[0].note, /bis zu ein Jahr/);
  const fallback = f.rules({ startDate: '2020-03-15' }).find(d => d.cat === 'ueberpruefung');
  assert.match(fallback.label, /§ 295 FamFG/); assert.match(fallback.note, /zwei Jahren/);
});
test('Ungültige Kalenderdaten erzeugen keine normalisierten Fantasietermine', () => {
  const f = fixture();
  for (const startDate of ['', '2026-02-30', '31.02.2026', '2026-13-01', 'kein Datum']) assert.equal(f.rules({ startDate }).length, 0, startDate);
});
test('Übernahme verschwindet sofort, bleibt nach Bearbeiten, Erledigen und Neuladen erkannt', () => {
  for (const routing of ['calendar', 'todo', 'both', 'none']) {
    const f = fixture(), d = f.rules().find(x => x.cat === 'anfangsbericht');
    const fr = f.adopt(d); fr.routing = routing;
    assert.ok(f.saves());
    assert.equal(f.suggestions().some(x => x.cat === d.cat), false);
    fr.title = 'Bericht an Gericht senden'; fr.dueDate = '2026-12-15'; fr.category = 'sonstige'; fr.status = 'erledigt';
    f.c.state.caseData = JSON.parse(JSON.stringify(f.c.state.caseData));
    assert.equal(f.suggestions().some(x => x.cat === d.cat), false);
    f.adopt(d); assert.equal(f.c.state.caseData.fristen.length, 1);
    f.c.state.caseData.fristen = [];
    assert.equal(f.suggestions().some(x => x.cat === d.cat), true);
  }
});
test('Alte Übernahmen mit 28/42 Tagen werden erkannt, auch erledigt oder über Posteingang angelegt', () => {
  const f = fixture();
  for (const [category, dueDate] of [['anfangsbericht', '2026-09-28'], ['vermoegensverzeichnis', '2026-10-12']]) {
    const d = f.rules().find(x => x.cat === category);
    f.c.state.caseData.fristen.push({ category, title: d.label, dueDate, source: 'inbox', status: 'erledigt' });
  }
  assert.equal(f.suggestions().some(d => ['anfangsbericht', 'vermoegensverzeichnis'].includes(d.cat)), false);
});
test('Andere Fristen gleicher Kategorie und anderer Betreuungsbeginn bleiben sichtbar', () => {
  const f = fixture(), d = f.rules().find(x => x.cat === 'anfangsbericht');
  f.c.state.caseData.fristen.push({ category: d.cat, title: 'Anfangsbericht rückfragen', dueDate: d.dueIso });
  assert.equal(f.suggestions().some(x => x.cat === d.cat), true);
  f.adopt(d); f.c.state.caseData.care.startDate = '2026-09-01';
  assert.equal(f.suggestions().some(x => x.cat === d.cat), true);
});
test('Wiederholungsserie ist übernommen; erledigter Einzeltermin verdeckt kein Folgejahr', () => {
  const f = fixture(), d = f.rules().find(x => x.cat === 'jahresbericht'), fr = f.adopt(d);
  f.setToday('2027-12-01');
  assert.equal(f.suggestions().some(x => x.cat === d.cat), false);
  fr.status = 'erledigt'; fr.interval = '';
  assert.equal(f.suggestions().some(x => x.cat === d.cat), true);
});
test('Fallübergreifend: aktive Daten vor Cache; namensgleicher Fremdfall bleibt unabhängig', () => {
  for (const online of [true, false]) {
    const f = fixture('2026-09-16', online), d = f.rules().find(x => x.cat === 'anfangsbericht');
    f.c.frItems.push({ ...f.c.frItems[0], caseId: 'b' });
    const foreign = { care: { startDate: '2026-08-31' }, fristen: [] };
    f.c.window.__onlineCaseCache.set('a', { data: { stammdaten: { fristen: [] } } });
    f.c.window.__onlineCaseCache.set('b', { data: { stammdaten: foreign } });
    f.c.window.caseRegistry = [{ id: 'b', state: { caseData: foreign } }];
    f.adopt(d);
    assert.deepEqual(Array.from(f.suggestions().filter(x => x.cat === d.cat), x => x.it.caseId), ['b']);
    foreign.fristen.push({ ...f.c.state.caseData.fristen[0] });
    assert.equal(f.suggestions().some(x => x.cat === d.cat), false);
  }
});
test('Mobile und Desktop-Datenbasis zeigen übernommene Frist genau einmal', () => {
  const f = fixture(), d = f.rules().find(x => x.cat === 'anfangsbericht');
  f.c.frAllOwnFristen = () => f.c.state.caseData.fristen.map(fr => ({ caseId: 'a', fr }));
  f.adopt(d);
  const rows = f.c.frMobileItems().filter(x => x.fr.category === d.cat);
  assert.equal(rows.length, 1); assert.equal(rows[0].kind, 'own');
});
test('Automatische Fallanlage erhält dieselbe Herkunft und dieselben Fristen', () => {
  const f = fixture();
  const initial = f.c.window.__startDeadlinesFor(f.c.state.caseData);
  const report = initial.find(x => x.category === 'anfangsbericht');
  assert.equal(report.dueDate, '2026-11-30'); assert.ok(report.derivedKey); assert.equal(report.derivedDueDate, report.dueDate);
  const payment = f.c.window.__remDeadlinesFor(f.c.state.caseData)[0];
  assert.ok(payment.derivedKey); assert.equal(payment.dueDate, '2026-12-01');
});
test('Posteingang und Fallintake erhalten Herkunft auch bei Korrekturen und verhindern doppelte Übernahme', () => {
  const f = fixture(), d = f.c.window.__startDeadlinesFor(f.c.state.caseData).find(x => x.category === 'anfangsbericht');
  const id = f.c.window.__frAddFromInbox({ ...d, title: 'Bericht vorbereiten', dueDate: '2026-11-20', routing: 'todo' });
  const saved = f.c.state.caseData.fristen[0];
  assert.equal(saved.source, 'derived'); assert.equal(saved.derivedDueDate, '2026-11-30');
  assert.equal(f.suggestions().some(x => x.cat === d.category), false);
  assert.equal(f.c.window.__frFindFrist(d).id, id);
  assert.equal(f.c.window.__frAddFromInbox(d), id);
  assert.equal(f.c.state.caseData.fristen.length, 1);
  assert.equal(saved.dueDate, '2026-11-20'); assert.equal(saved.routing, 'todo');
});
test('Schon erledigte alte Quartalsfrist erscheint nach Korrektur des Abrechnungsbeginns nicht erneut', () => {
  const f = fixture('2026-12-10');
  f.c.state.caseData.fristen.push({ category: 'verguetung', title: 'Vergütungsabrechnung fällig (vierteljährlich, VBVG)', dueDate: '2026-11-30', interval: 'quarterly', status: 'erledigt', source: 'derived' });
  assert.equal(f.suggestions().some(x => x.cat === 'verguetung'), false);
  f.setToday('2027-03-10');
  assert.equal(f.suggestions().some(x => x.cat === 'verguetung'), true);
});
test('Folgetermine gesetzlicher Serien bleiben an Monatsende und Schaltjahr gebunden', () => {
  const f = fixture();
  for (const [derivedKey, dueDate, interval, expected] of [
    ['verguetung:2026-01-30', '2026-05-01', 'quarterly', '2026-07-31'],
    ['jahresbericht:2024-02-29', '2027-02-28', 'yearly', '2028-02-29'],
    ['rechnungslegung:2024-02-29', '2027-02-28', 'yearly', '2028-02-29'],
  ]) {
    assert.equal(f.c.isoOf(f.c.frNextDue({ derivedKey, dueDate, derivedDueDate: dueDate, interval })), expected);
  }
  assert.equal(f.c.isoOf(f.c.frNextDue({ derivedKey: 'verguetung:2026-01-30', dueDate: '2026-05-15', derivedDueDate: '2026-05-01', interval: 'quarterly' })), '2026-08-15');
});
test('Gleichnamige Fälle haben auch in der Oberfläche unterschiedliche Vorschlagskennungen', () => {
  const f = fixture();
  f.c.frAllOwnFristen = () => [];
  f.c.frItems.push({ ...f.c.frItems[0], caseId: 'b' });
  const rows = f.c.frMobileItems();
  assert.equal(new Set(rows.map(x => x.key)).size, rows.length);
});
