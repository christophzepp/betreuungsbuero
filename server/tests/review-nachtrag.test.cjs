'use strict';

/* Nachtrag zur adversarialen Review vom 25.08.2026 - die Befunde, die in server/src lagen.
 *
 * Gepruefte Szenarien (alle AUSGEFUEHRT gegen eine Wegwerf-Datenbank, nicht gegrept - genau daran
 * sind die Vorgaenger gescheitert: sie pinnten Zeichenketten und blieben deshalb gruen):
 *
 *   BEFUND 6  Ein PUT auf /api/invoices/:id mit GEAENDERTEM Etikett, aber ohne Kennung - die
 *             Nutzlast des Excel-Reimports - liess Etikett und Kennung dauerhaft auseinander-
 *             laufen: die Liste druckte Fall B, gezaehlt wurde weiter Fall A.
 *   BEFUND 12 Die beim Seeden aus der Unterkunftsart GERATENE Wohnform (Herkunft 'master') zaehlte
 *             im Controlling als gepflegte Angabe; die Kachel meldete "Angabe fehlt: 0".
 *   AUFTRAG   /api/controlling liefert Klarnamen nur noch an Konten mit Fall-Sichtrecht. Wurde es
 *             entzogen, bleibt die Auswertung vollstaendig, aber ohne Namen.
 *
 * Aufbau wie in rechnung-verknuepfung.test.cjs: eigener RUNTIME_ROOT, geleerter Modul-
 * Zwischenspeicher (database/index.js ist ein Singleton), Aufruf des letzten Handlers der Route
 * mit einer selbstgebauten Sitzung. Kein fester Port, keine Produktivdatenbank.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Alle Module unterhalb server/src vergessen - sonst haengt die naechste Wegwerf-Datenbank an
   der Verbindung der vorigen. */
function cacheLeeren() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(path.join('server', 'src'))) delete require.cache[key];
  }
}

/* Ruft den EIGENTLICHEN Handler einer Route auf (den letzten der Kette) und umgeht damit die
   Express-Wachen - die Rechte stecken in der uebergebenen Sitzung, genau darum geht es hier. */
function rufer(router) {
  return (pfad, methode, req) => new Promise((fertig) => {
    const layer = router.stack.find((l) => l.route && l.route.path === pfad && l.route.methods[methode]);
    assert.ok(layer, `Route ${methode} ${pfad} fehlt`);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    let code = 200;
    const antwort = {
      json: (d) => fertig({ code, ...d }),
      status: (c) => { code = c; return antwort; },
    };
    handler({ query: {}, params: {}, body: {}, ...req }, antwort, () => {});
  });
}

function mitWegwerfDatenbank(vorbereiten) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'review-nachtrag-'));
  const alterRoot = process.env.RUNTIME_ROOT;
  process.env.RUNTIME_ROOT = runtime;
  cacheLeeren();
  const db = require('../src/database');
  const aufraeumen = () => {
    try { db.close(); } catch (_e) { /* schon zu */ }
    cacheLeeren();
    if (alterRoot === undefined) delete process.env.RUNTIME_ROOT; else process.env.RUNTIME_ROOT = alterRoot;
    fs.rmSync(runtime, { recursive: true, force: true });
  };
  try {
    return vorbereiten(db, aufraeumen);
  } catch (fehler) {
    aufraeumen();
    throw fehler;
  }
}

/* ───────── BEFUND 6: Etikett geaendert, Kennung nicht mitgeschickt ───────── */

test('Rechnung: ein geaendertes Etikett ohne Kennung zieht die Kennung mit (ausgefuehrt)', () => {
  return mitWegwerfDatenbank((db, aufraeumen) => {
    /* outgoing_invoices.updated_by zeigt auf users(id) - ohne Nutzer scheitert schon das Anlegen
       am Fremdschluessel. Echte Schemabedingung, kein Testkunstgriff. */
    db.prepare('INSERT INTO users (id, username, password_hash, is_admin) VALUES (1, ?, ?, 1)')
      .run('nachtrag', 'x');
    const neuerFall = db.prepare('INSERT INTO cases (id, label, stammdaten_json) VALUES (?,?,?)');
    neuerFall.run('fall-1', 'Nowak, Halina', '{}');
    neuerFall.run('fall-2', 'Rothenberg, Dieter', '{}');
    /* Zwei Faelle mit demselben Etikett: hier MUSS die Aufloesung schweigen. */
    neuerFall.run('fall-3', 'Doppel, Name', '{}');
    neuerFall.run('fall-4', 'Doppel, Name', '{}');

    const rufe = rufer(require('../src/modules/finance/invoice-routes'));
    const sitzung = { userId: 1, isAdmin: true, canViewCases: true, canEditCases: true };
    const post = (body) => rufe('/', 'post', { body, session: sitzung });
    const put = (id, body) => rufe('/:id', 'put', { params: { id }, body, session: sitzung });
    const roh = (id) => db.prepare('SELECT case_id, case_label, report_id, status FROM outgoing_invoices WHERE id = ?').get(id);

    return (async () => {
      try {
        const angelegt = await post({
          reNummer: 'RE-2026-7001', summe: 1188, caseId: 'fall-1',
          caseLabel: 'Nowak, Halina', reportId: 'remuneration', status: 'bewilligt',
        });
        assert.equal(angelegt.invoice.caseId, 'fall-1');

        /* (1) Der Kern des Befundes: die Nutzlast des Excel-Reimports. Neun Spalten, Spalte E
               traegt das Etikett, eine Kennung kennt das Blatt nicht. Frueher blieb 'fall-1'
               stehen und ueberstimmte fortan das neue Etikett. */
        const reimport = await put(angelegt.invoice.id, {
          reDatum: '', reNummer: 'RE-2026-7001', empfaenger: 'Landeskasse', verwendungszweck: '',
          caseLabel: 'Rothenberg, Dieter', rechnungszeitraum: '', summe: 1188,
          eingangDatum: '', eingangsbetrag: '',
        });
        assert.equal(reimport.invoice.caseId, 'fall-2',
          'die Kennung ist dem geaenderten Etikett nicht gefolgt - Etikett und Kennung laufen auseinander');
        assert.deepEqual(roh(angelegt.invoice.id), {
          case_id: 'fall-2', case_label: 'Rothenberg, Dieter', report_id: 'remuneration', status: 'bewilligt',
        }, 'die Rohzeile widerspricht sich, oder der Reimport hat Dokumentart/Status verloren');

        /* (2) Ein UNVERAENDERTES Etikett darf nichts ausloesen - genau daran haengt, dass ein
               Reimport die Verknuepfung nicht abraeumt (die erklaerte Absicht der Route). */
        const nochmal = await put(angelegt.invoice.id, { caseLabel: 'Rothenberg, Dieter', summe: 1200 });
        assert.equal(nochmal.invoice.caseId, 'fall-2', 'ein unveraendertes Etikett hat die Kennung angetastet');

        /* (3) Auch reine Randleerzeichen sind keine Fallaenderung - der Reimport trimmt jede
               Zelle, ein getrimmtes Etikett ist dasselbe Etikett. */
        const leerzeichen = await put(angelegt.invoice.id, { caseLabel: '  Rothenberg, Dieter  ' });
        assert.equal(leerzeichen.invoice.caseId, 'fall-2', 'Randleerzeichen haben die Kennung geloest');

        /* (4) Mehrdeutiges Etikett: lieber kein Verweis als ein falscher - dieselbe Regel, die
               der Trigger seit jeher anwendet. */
        const mehrdeutig = await put(angelegt.invoice.id, { caseLabel: 'Doppel, Name' });
        assert.equal(mehrdeutig.invoice.caseId, '', 'ein mehrdeutiges Etikett wurde auf einen Fall geraten');

        /* (5) Geleertes Etikett (aelteres Blatt, Spalte E leer): der Datensatz sagt danach
               "kein Fall" - und zaehlt auch bei keinem mehr mit. */
        const geleert = await put(angelegt.invoice.id, { caseLabel: '' });
        assert.equal(geleert.invoice.caseId, '');
        assert.equal(geleert.invoice.caseLabel, '');

        /* (6) Rueckversicherung gegen eine Ueberreaktion: OHNE caseLabel bleibt alles, wie es
               ist. Die Wege "als bezahlt buchen" und "als bewilligt vermerken" schicken genau
               solche Teilnutzlasten - sie duerfen die Verknuepfung nicht anfassen. */
        const zweite = await post({ reNummer: 'RE-2026-7002', summe: 400, caseId: 'fall-1', caseLabel: 'Nowak, Halina' });
        const gebucht = await put(zweite.invoice.id, { status: 'bezahlt', eingangsbetrag: 400 });
        assert.equal(gebucht.invoice.caseId, 'fall-1', 'eine Teilnutzlast ohne Etikett hat die Kennung geloest');
        assert.equal(gebucht.invoice.caseLabel, 'Nowak, Halina');
      } finally {
        aufraeumen();
      }
    })();
  });
});

/* ───────── BEFUND 12 + Auftrag: Controlling ───────── */

/* Genau die Form, in der flushReportSync eine Dokumentzeile ablegt: je Feld ein Eintrag mit
   value/source/reviewed. `source` ist der Unterschied zwischen "vom Programm vorbelegt" und
   "von Hand gepflegt" - und damit der ganze Befund 12. */
const antragDoku = (housing, source) => JSON.stringify({
  fields: {
    rem_sections: {
      value: [{ from: '01.01.2026', to: '', status: '', housing, duration: 'AUTO' }],
      ...(source === undefined ? {} : { source }),
      reviewed: true,
    },
  },
});

test('Controlling: geratene Wohnform zaehlt nicht, Klarnamen nur mit Fall-Sichtrecht (ausgefuehrt)', () => {
  return mitWegwerfDatenbank((db, aufraeumen) => {
    const neuerFall = db.prepare(
      'INSERT INTO cases (id, label, file_number, stammdaten_json, owner_user_id) VALUES (?,?,?,?,NULL)'
    );
    const neuerAntrag = db.prepare('INSERT INTO case_reports (case_id, report_id, data_json) VALUES (?,?,?)');
    /* Stammdaten OHNE die drei Verguetungsfelder - nur so kommt der Rueckfall auf den Antrag
       ueberhaupt zum Zug. owner_user_id bleibt NULL: so entsteht jeder neu angelegte Fall, und
       genau solche Faelle gibt sichtbareFaelle() jedem Konto frei. */
    const stammdaten = JSON.stringify({ care: { startDate: '01.01.2025' }, rechtlicherBetreuer: 'Anna Beispiel' });

    /* (a) Der Befund: das Programm hat die Wohnform beim Seeden aus der Unterkunftsart geraten. */
    neuerFall.run('f-geraten', 'Raten, Rita', '17 XVII 1/26', stammdaten);
    neuerAntrag.run('f-geraten', 'remuneration', antragDoku('A', 'master'));
    /* (b) Von Hand in der Tabelle gesetzt (updateTableCell schreibt 'manual') - MUSS zaehlen.
           Dieser Fall traegt bewusst KEIN Aktenzeichen, damit die Ersatzbezeichnung greift. */
    neuerFall.run('f-hand', 'Hand, Hanna', '', stammdaten);
    neuerAntrag.run('f-hand', 'remuneration', antragDoku('S', 'manual'));
    /* (c) Alt-Backup ohne Herkunftsfeld - darf nicht mit weggeworfen werden. */
    neuerFall.run('f-alt', 'Alt, Anton', '17 XVII 3/24', stammdaten);
    neuerAntrag.run('f-alt', 'remuneration', antragDoku('S', undefined));

    const rufe = rufer(require('../src/modules/controlling/routes'));
    const abrufen = (session) => rufe('/', 'get', { session });
    /* Drei Konten, die sich NUR im Fall-Sichtrecht unterscheiden. */
    const chefin = { userId: 1, isAdmin: true };
    const fallbearbeiterin = { userId: 2, isAdmin: false, canViewControlling: true, canViewCases: true };
    const buchhaltung = { userId: 3, isAdmin: false, canViewControlling: true, canViewCases: false };

    return (async () => {
      try {
        const alsAdmin = await abrufen(chefin);
        const holen = (daten, id) => daten.faelle.find((f) => f.caseId === id);

        /* ── Befund 12 ── */
        const geraten = holen(alsAdmin, 'f-geraten');
        assert.equal(geraten.housingCategory, '',
          'die aus der Unterkunftsart GERATENE Wohnform wird weiterhin als Angabe ausgeliefert');
        assert.equal(geraten.quelle, '',
          'ein vom Programm vorbelegter Wert darf nicht als "aus dem letzten Verguetungsantrag" gelten');

        const hand = holen(alsAdmin, 'f-hand');
        assert.equal(hand.housingCategory, 'S', 'eine von Hand gepflegte Wohnform ging verloren');
        assert.equal(hand.quelle, 'antrag');

        const alt = holen(alsAdmin, 'f-alt');
        assert.equal(alt.housingCategory, 'S', 'ein Datenstand ohne Herkunftsfeld wurde faelschlich verworfen');
        assert.equal(alt.quelle, 'antrag');

        /* ── Auftrag: Klarnamen nur mit Fall-Sichtrecht ── */
        assert.equal(alsAdmin.anonymisiert, false, 'die Verwaltung darf nicht anonymisiert werden');
        assert.equal(holen(alsAdmin, 'f-hand').label, 'Hand, Hanna');

        const mitFallrecht = await abrufen(fallbearbeiterin);
        assert.equal(mitFallrecht.anonymisiert, false);
        assert.equal(holen(mitFallrecht, 'f-hand').label, 'Hand, Hanna',
          'mit Fall-Sichtrecht muss der Klarname stehen bleiben');

        const ohneFallrecht = await abrufen(buchhaltung);
        assert.equal(ohneFallrecht.anonymisiert, true,
          'die Antwort verschweigt, dass in der Namensspalte eine Ersatzbezeichnung steht');
        assert.doesNotMatch(JSON.stringify(ohneFallrecht), /Raten|Rita|Hanna|Anton/,
          'ein Klarname ist trotz entzogenem Fall-Sichtrecht in der Antwort gelandet');
        assert.equal(holen(ohneFallrecht, 'f-geraten').label, '17 XVII 1/26',
          'statt des Namens gehoert das Aktenzeichen in die Spalte');
        const ohneAz = ohneFallrecht.faelle.findIndex((f) => f.caseId === 'f-hand');
        assert.equal(ohneFallrecht.faelle[ohneAz].label, `Fall ${ohneAz + 1}`,
          'ohne Aktenzeichen fehlt die neutrale Ersatzbezeichnung');

        /* Eingeschraenkt wird NUR die Identifizierbarkeit: alles andere muss Zeile fuer Zeile
           gleich bleiben, sonst rechnet die Buchhaltung mit anderen Zahlen als die Verwaltung. */
        const ohneLabel = (d) => d.faelle.map(({ label, ...rest }) => rest);
        assert.deepEqual(ohneLabel(ohneFallrecht), ohneLabel(alsAdmin),
          'die Anonymisierung hat Zahlen, Zuordnung oder Reihenfolge veraendert');
        assert.equal(ohneFallrecht.gesamt, alsAdmin.gesamt);
        assert.equal(ohneFallrecht.vollstaendig, true);
        assert.deepEqual(
          ohneFallrecht.faelle.map((f) => f.betreuer),
          alsAdmin.faelle.map((f) => f.betreuer),
          'die Auslastung je Betreuer darf sich nicht veraendern'
        );
      } finally {
        aufraeumen();
      }
    })();
  });
});
