'use strict';
/* Baut das Vorführpaket des Demo-Modus (Nutzerauftrag 30.08.2026).

   WEG: Die fünf Demofälle existieren als Datenmodule (fall-1..5). Statt die
   Modul→App-Zustand-Übersetzung zu duplizieren, läuft hier die BESTEHENDE, geprüfte
   Kette in einer Wegwerf-Datenbank: create-admin → seed.js → fall-export.js, alles
   als Kindprozesse mit RUNTIME_ROOT auf einem Temp-Ordner. Anschließend werden die
   Bürobestände (Termine, Aufgaben, Fahrten, Rechnungen, Kontaktmonitor,
   Qualifikationen) direkt aus der Wegwerf-DB gelesen und in die Lokalmodus-Formate
   gebracht - der Demo-Browser hält alles nur im Arbeitsspeicher.

   VERFREMDUNG: Die Fixtures nennen den echten Betreuer samt Anschrift und Gericht
   (Christoph Zepp, Marktplatz 8, 56346 St. Goarshausen). Das Paket ersetzt diese
   Angaben textuell im GESAMTEN Bestand durch das Musterbüro - eine Stelle, die alles
   erwischt, statt vieler einzelner Feldkorrekturen:
       Betreuungsbüro Mustermensch · Max Mustermensch
       Musterstraße 1 · 12345 Musterstadt
   Passfotos: Die fünf festen Zuordnungen in DEMO_FOTO_DATEIEN werden als
   JPEG-DataURL in person.photo geschrieben (wie __caseFotoSet sie speichert).
   Fehlt eine Datei, bricht der Paketbau ab: Eine Vorführung ohne die fest
   zugehörigen Portraits darf nicht unbemerkt ausgeliefert werden. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');
const FOTO_ORDNER = path.join(__dirname, 'fotos');
const DEMO_FOTO_DATEIEN = Object.freeze({
  'Auerbach, Margarete': 'Margarete_Auerbach.jpg',
  'Kilic, Emre': 'Emre_Kilic.jpg',
  'Nowak, Halina': 'Halina_Nowak.jpg',
  'Rothenberg, Dieter': 'Dieter_Rothenberg.jpg',
  'Weidmann, Jonas': 'Jonas_Weidmann.jpg'
});

const MUSTER_BUERO = {
  companyName: 'Betreuungsbüro Mustermensch',
  salutation: 'Herr',
  firstName: 'Max',
  lastName: 'Mustermensch',
  academicDegree: '',
  street: 'Musterstraße 1',
  postalCode: '12345',
  city: 'Musterstadt',
  country: 'Deutschland',
  phone: '01234/567890',
  mobile: '0170/1234567',
  email: 'post@betreuungsbuero-mustermensch.de',
  fax: '01234/567891',
  website: 'www.betreuungsbuero-mustermensch.de',
  taxNumber: '12/345/67890',
  vatId: '',
  logoDataUrl: ''
};

/* Büroweite Musterkontakte (baStore-Format) - bewusst voll ausgefüllt. */
const MUSTER_BUEROKONTAKTE = [
  { salutation: 'Frau', title: '', firstName: 'Petra', lastName: 'Beispielmann', institution: 'Betreuungsgericht Musterstadt', role: 'Rechtspflegerin', street: 'Gerichtsweg', house: '3', postal: '12345', city: 'Musterstadt', phone: '01234/900100', mobile: '', email: 'p.beispielmann@ag-musterstadt.example.de', fax: '01234/900101', status: 'aktiv' },
  { salutation: 'Herr', title: '', firstName: 'Karl', lastName: 'Musterfall', institution: 'Betreuungsbehörde Landkreis Muster', role: 'Fachdienst Betreuungen', street: 'Kreishausallee', house: '12', postal: '12345', city: 'Musterstadt', phone: '01234/880220', mobile: '', email: 'k.musterfall@landkreis-muster.example.de', fax: '01234/880221', status: 'aktiv' },
  { salutation: 'Frau', title: 'Dr. med.', firstName: 'Ines', lastName: 'Probehaus', institution: 'Hausarztpraxis am Musterplatz', role: 'Hausärztin', street: 'Musterplatz', house: '7', postal: '12345', city: 'Musterstadt', phone: '01234/770330', mobile: '', email: 'praxis@probehaus.example.de', fax: '01234/770331', status: 'aktiv' },
  { salutation: 'Frau', title: '', firstName: 'Sabine', lastName: 'Testreich', institution: 'Musterbank eG', role: 'Kundenberaterin Betreuungskonten', street: 'Bankgasse', house: '2', postal: '12345', city: 'Musterstadt', phone: '01234/660440', mobile: '', email: 's.testreich@musterbank.example.de', fax: '', status: 'aktiv' },
  { salutation: 'Herr', title: '', firstName: 'Deniz', lastName: 'Beispiel', institution: 'Pflegedienst Sonnenschein GmbH', role: 'Pflegedienstleitung', street: 'Sonnenweg', house: '15', postal: '12345', city: 'Musterstadt', phone: '01234/550660', mobile: '0171/9876543', email: 'leitung@pflegedienst-sonnenschein.example.de', fax: '', status: 'aktiv' },
  { salutation: 'Frau', title: '', firstName: 'Helene', lastName: 'Aktenklar', institution: 'AOK Muster', role: 'Sachbearbeitung Pflegeleistungen', street: 'Kassenstraße', house: '9', postal: '12345', city: 'Musterstadt', phone: '01234/440770', mobile: '', email: 'h.aktenklar@aok-muster.example.de', fax: '01234/440771', status: 'aktiv' }
];

/* Gezielt und in dieser Reihenfolge (längere Muster zuerst). */
const VERFREMDUNG = [
  ['Christoph Zepp', 'Max Mustermensch'],
  ['christoph zepp', 'max mustermensch'],
  ['Betreuungsbüro Zepp', 'Betreuungsbüro Mustermensch'],
  ['Zepp', 'Mustermensch'],
  ['zepp', 'mustermensch'],
  ['Marktplatz 8', 'Musterstraße 1'],
  ['56346', '12345'],
  ['St. Goarshausen', 'Musterstadt'],
  ['Goarshausen', 'Musterstadt'],

  /* ORTE UND EINRICHTUNGEN DER REGION (Nutzerentscheid 30.08.2026 nach der adversarialen
     Prüfrunde): Die Fallvorlagen sind aus echten Unterlagen abgeleitet und nannten durchgängig
     die realen Orte, Gerichte, Kliniken und Vereine des Einzugsgebiets - zusammen über 700
     Stellen. In einer Vorführung mit öffentlich bekannten Zugangsdaten deutet das direkt auf
     das Büro. Bundesweite Einrichtungen (AOK, BARMER, DAK, Debeka, Allianz, Deutsche
     Rentenversicherung …) bleiben bewusst stehen: Sie kommen in jedem Betreuungsbüro
     Deutschlands vor und verraten nichts. LANGE Namen stehen vor kurzen, damit
     „Bingen am Rhein" nicht als „Musterbrück am Rhein" endet. */
  ['Bingen am Rhein', 'Musterbrück'],
  ['Bingen', 'Musterbrück'],
  ['Alzey', 'Musterau'],
  ['St. Hildegard', 'St. Musterhild'],
  ['Hildegard', 'Musterhild'],
  ['Ohlmann', 'Musterhand'],
  ['Eußerthal', 'Musterthal'],
  ['Lahnblick', 'Musterblick'],
  ['Lahnhöhe', 'Musterhöhe'],
  ['Lahntal', 'Mustertal'],
  ['Mainz-Bingen', 'Musterland-Musterbrück'],
  ['Simmern/Hunsrück', 'Musterheim'],
  ['Bad Kreuznach', 'Musterquell'],
  ['Rhein-Hunsrück', 'Musterhöhe'],
  ['Rhein-Lahn', 'Musteraue'],
  ['Rhein-Mosel', 'Mustertal'],
  ['Rheinhessen', 'Musterhessen'],
  ['Mittelrhein', 'Mustertal'],
  ['Koblenz', 'Musterstadt'],
  ['Neuwied', 'Musterberg'],
  ['Boppard', 'Musterbach'],
  ['Bad Ems', 'Musterbrunn'],
  ['Lahnstein', 'Musterfels'],
  ['Montabaur', 'Musterhausen'],
  ['Ingelheim am Rhein', 'Musterweiler'],
  ['Ingelheim', 'Musterweiler'],
  ['Hunsrück', 'Musterhöhe'],
  ['Nassau', 'Musterdorf'],
  ['Diez', 'Musterdorf'],
  ['Wiedbachstraße', 'Musterbachstraße'],
  ['Wiedblick', 'Musterblick'],
  ['Kemperhof', 'Musterhof'],
  ['St. Severus', 'St. Mustertreu'],
  ['Severus', 'Mustertreu'],
  ['Löhrcenter', 'Musterpassage'],
  ['Christiane-Herzog', 'Muster-Sonnenweg'],
  ['Hüttenberger', 'Musterberger'],
  ['Betreuungsbüro Rheinblick', 'Betreuungsbüro Musterblick'],
  ['Rheinblick', 'Musterblick']
];

/* STRUKTURELLE Verfremdung (Befund 30.08.2026, adversariale Prüfrunde): Die Liste oben
   fasst nur bekannte Zeichenketten (Name, Anschrift, Ort). Durch sie rutschten sämtliche
   TELEFONNUMMERN, E-MAIL-ADRESSEN und WEB-DOMÄNEN der Fallvorlagen ungefiltert ins
   Vorführpaket - darunter die echte Rufnummer des Büros und die echten Adressen realer
   Behörden und Einrichtungen der Region. Eine Blacklist ist dafür der falsche Ansatz:
   sie kann nur erwischen, woran jemand gedacht hat. Deshalb wird jede Nummer und jede
   Adresse strukturell ersetzt - deterministisch, damit derselbe Kontakt überall dieselbe
   Ersatzangabe behält und die Vorführdaten in sich stimmig bleiben. */
const MUSTER_DOMAIN = 'example.de';
function slug(text, ersatz) {
  const s = String(text || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || ersatz;
}
function strukturVerfremden(text) {
  const tel = new Map();
  const mail = new Map();
  const domainZaehler = { n: 1 };
  let out = String(text);

  /* Telefon/Fax: alles, was mit 0 beginnt und wie eine Rufnummer aussieht - mit oder ohne
     Trenner. Aktenzeichen (7 XVII 214/19), IBANs (DE..) und Datumsangaben beginnen nicht
     mit einer 0 vor dem Trenner bzw. haben andere Form und bleiben unberührt. */
  out = out.replace(/\b0\d{2,5}\s?[/-]\s?\d{3,9}\b|\b0\d{9,14}\b/g, (treffer) => {
    const schluessel = treffer.replace(/[^0-9]/g, '');
    if (schluessel.startsWith('01234') || schluessel.startsWith('0171987')) return treffer;
    if (!tel.has(schluessel)) {
      const nr = tel.size + 1;
      /* Mobil bleibt Mobil, Festnetz bleibt Festnetz - sonst wirkte die Vorführung unstimmig. */
      tel.set(schluessel, /^01[5-7]/.test(schluessel)
        ? '0171/98' + String(10000 + nr).slice(-5)
        : '01234/' + String(500000 + nr * 37).slice(-6));
    }
    return tel.get(schluessel);
  });

  /* Getrennte Rufnummern-Felder: Die Stammdaten speichern Vorwahl und Anschluss EINZELN
     ("phoneArea":"06771","phoneNumber":"959410") - zusammenhängend sucht die Regel oben
     dort vergeblich, und genau so überlebte die echte Bürorufnummer die erste Fassung.
     Deshalb zusätzlich jedes Rufnummern-FELD am Schlüsselnamen fassen. */
  out = out.replace(/"([A-Za-z_]*?(?:phone|mobile|fax|telefon|tel)[A-Za-z_]*?)"\s*:\s*"([0-9][0-9 /()+-]{2,})"/gi, (treffer, key, wert) => {
    const ziffern = wert.replace(/[^0-9]/g, '');
    if (!ziffern || ziffern.startsWith('01234') || ziffern.startsWith('0171')) return treffer;
    let ersatz;
    if (/area$/i.test(key)) ersatz = /^01[5-7]/.test(ziffern) ? '0171' : '01234';
    else if (/number$/i.test(key)) {
      if (!tel.has('#teil#' + ziffern)) tel.set('#teil#' + ziffern, String(500000 + tel.size * 41).slice(-6));
      ersatz = tel.get('#teil#' + ziffern);
    } else {
      if (!tel.has(ziffern)) tel.set(ziffern, /^01[5-7]/.test(ziffern) ? '0171/98' + String(10000 + tel.size).slice(-5) : '01234/' + String(500000 + tel.size * 37).slice(-6));
      ersatz = tel.get(ziffern);
    }
    return '"' + key + '":"' + ersatz + '"';
  });

  /* POSTLEITZAHLEN der Region: Feldweise (jede fünfstellige PLZ) und im Freitext gezielt die
     Bereiche 50-56xxx/65xxx - so bleibt kein Ort über seine Kennzahl erkennbar. Beträge und
     Aktenzeichen sind nicht betroffen: sie tragen Komma, Punkt oder Buchstaben. */
  out = out.replace(/"(postal|plz|postalCode|zip|postleitzahl)"\s*:\s*"(\d{5})"/gi, '"$1":"12345"');
  out = out.replace(/\b(?:5[0-6]\d{3}|65\d{3})\b/g, '12345');

  /* E-Mail: Lokalteil bleibt sprechend, die Domäne wird zur Musterdomäne. */
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (treffer) => {
    const [lokal, domain] = treffer.split('@');
    if (/(^|\.)example\.[a-z]+$/i.test(domain) || /mustermensch/i.test(domain)) return treffer;
    const schluessel = treffer.toLowerCase();
    if (!mail.has(schluessel)) {
      /* Die Domäne wird VOLLSTÄNDIG ersetzt, nicht nur die Endung: sonst überlebte der
         echte Haus-/Ortsname (kanzlei@echterName.de -> kanzlei@echterName.example.de).
         Je echter Domäne EINE Musterdomäne, damit Kontakte desselben Hauses zusammenpassen. */
      const haus = String(domain).toLowerCase();
      if (!mail.has('#domain#' + haus)) mail.set('#domain#' + haus, 'muster' + (domainZaehler.n++) + '.' + MUSTER_DOMAIN);
      mail.set(schluessel, slug(lokal, 'kontakt') + '@' + mail.get('#domain#' + haus));
    }
    return mail.get(schluessel);
  });

  /* Web-Adressen ohne @ (www./https://): dieselbe Musterdomäne. */
  out = out.replace(/\b(?:https?:\/\/)?www\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (treffer) => {
    if (/example\.|mustermensch/i.test(treffer)) return treffer;
    return 'www.muster' + (domainZaehler.n++) + '.' + MUSTER_DOMAIN;
  });

  return out;
}

function verfremde(text) {
  let out = String(text);
  for (const [von, nach] of VERFREMDUNG) out = out.split(von).join(nach);
  return strukturVerfremden(out);
}

/* ISO (JJJJ-MM-TT) -> deutsches Datum; alles andere bleibt unverändert. */
function deDatum(wert) {
  const t = String(wert || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : t;
}

function fotoDataUrl(datei) {
  const voll = path.join(FOTO_ORDNER, datei);
  if (!fs.existsSync(voll)) throw new Error(`Fest verdrahtetes Demo-Passfoto fehlt: ${datei}`);
  return 'data:image/jpeg;base64,' + fs.readFileSync(voll).toString('base64');
}

function camel(spalte) {
  return spalte.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
}
function zeileCamel(row) {
  const out = {};
  for (const k of Object.keys(row)) out[camel(k)] = row[k];
  return out;
}

function bauePaket() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-demo-paket-'));
  const exportZiel = path.join(tmp, 'export');
  try {
    /* Im Produktionscontainer sind DB_PATH, DOCUMENTS_DATA_ROOT und weitere Pfade
       ABSOLUT gesetzt. Nur RUNTIME_ROOT zu überschreiben reicht deshalb nicht: Die
       spezielleren Variablen gewinnen in config/paths.js und seed.js schreibt dann
       die fünf Vorführ-Fälle in die echte Online-Datenbank. Der nachfolgende Export
       findet mehr als fünf Fälle, der Demo-Endpunkt antwortet mit 500 und die
       Vorführ-Fälle erscheinen gleichzeitig im Online-Modus.

       Alle schreibbaren Pfade des Paketbaus werden daher ausdrücklich unter denselben
       Wegwerf-Ordner gezwungen. OUTPUTS_DIR/SP_PLUGIN_DIR bleiben unverändert, weil
       sie nur lesend auf Programmdateien zeigen. */
    const env = Object.assign({}, process.env, {
      RUNTIME_ROOT: tmp,
      DB_PATH: path.join(tmp, 'database', 'betreuungsbuero.sqlite3'),
      DATA_DIR: path.join(tmp, 'data'),
      DOCUMENTS_DATA_ROOT: path.join(tmp, 'data'),
      EXTENSION_ARTIFACTS_DIR: path.join(tmp, 'extension-artifacts'),
      RUNTIME_SECRETS_DIR: path.join(tmp, 'secrets'),
      DOCUMENT_RECOVERY_KEY_FILE: path.join(tmp, 'secrets', 'document-recovery-key'),
      TOTAL_BACKUP_DESTINATION: path.join(tmp, 'backups'),
      RUNTIME_ARTIFACT_RESTORE_STATE_DIR: path.join(tmp, 'restore-rollback')
    });
    const opts = { cwd: SERVER_ROOT, env, stdio: 'pipe' };
    execFileSync(process.execPath, [path.join('tools', 'admin', 'create-admin.js'),
      '--username', 'paketbau', '--password', 'Wegwerf-Paketbau-0000!', '--admin', '--local', '--online'], opts);
    execFileSync(process.execPath, [path.join('tools', 'demo-faelle', 'seed.js')], opts);
    execFileSync(process.execPath, [path.join('tools', 'fall-export.js'), '--ziel', exportZiel], opts);

    /* Die fünf Fall-Sicherungen einsammeln (Dateiname trägt den Personennamen). */
    const faelle = [];
    for (const datei of fs.readdirSync(exportZiel).filter((f) => f.endsWith('.json')).sort()) {
      const inhalt = JSON.parse(fs.readFileSync(path.join(exportZiel, datei), 'utf8'));
      const person = (inhalt.caseData && inhalt.caseData.person) || {};
      const label = `${person.lastName || '?'}, ${person.firstName || '?'}`;
      const fotoName = DEMO_FOTO_DATEIEN[label];
      if (!fotoName) throw new Error(`Keine feste Demo-Passfoto-Zuordnung für ${label}`);
      inhalt.caseData.person.photo = fotoDataUrl(fotoName);
      faelle.push({
        label,
        fileNumber: (inhalt.caseData.care && inhalt.caseData.care.fileNumber) || '',
        state: inhalt
      });
    }
    if (faelle.length !== 5) throw new Error(`Erwartet 5 Fall-Sicherungen, gefunden: ${faelle.length}`);

    /* Bürobestände aus der Wegwerf-DB in die Lokalmodus-Formate. */
    const db = new Database(path.join(tmp, 'database', 'betreuungsbuero.sqlite3'), { readonly: true });
    let kalender = []; let aufgaben = []; let fahrzeuge = []; let fahrten = []; let rechnungen = [];
    let kontaktmonitor = null; let qualifikationen = null;
    try {
      kalender = db.prepare('SELECT id, title, description, location, start_at, end_at, all_day, case_id FROM calendar_events ORDER BY start_at').all()
        .map((r) => ({ id: r.id, title: r.title, description: r.description, location: r.location, startAt: r.start_at, endAt: r.end_at, allDay: !!r.all_day, caseId: r.case_id || '' }));
      aufgaben = db.prepare('SELECT * FROM todos ORDER BY due_at').all().map((r) => {
        const t = zeileCamel(r); t.done = !!r.done; return t;
      });
      fahrzeuge = db.prepare('SELECT * FROM private_vehicles').all().map(zeileCamel);
      fahrten = db.prepare('SELECT * FROM mileage_trips ORDER BY datum').all().map((r) => ({
        id: r.id, vehicleId: r.vehicle_id, fahrerUserId: null, datum: r.datum,
        fahranlass: r.fahranlass, caseLabel: r.case_label, startAdresse: r.start_adresse,
        zielAdresse: r.ziel_adresse, kilometer: r.kilometer,
        erstattungsbetrag: r.erstattungsbetrag_snapshot, status: r.status || 'entwurf',
        fahrerUnterschrift: '', fahrerUnterschriftAm: '', prueferUnterschrift: '', prueferUnterschriftAm: ''
      }));
      rechnungen = db.prepare('SELECT * FROM outgoing_invoices ORDER BY re_datum').all().map((r) => ({
        /* deDatum (Nutzerentscheid 30.08.2026): Die Rechnungsliste gibt reDatum und
           eingangDatum ROH aus - der reguläre Schreibweg der Anwendung speichert dort
           deutsches Datum. Aus der Wegwerf-Datenbank kommen ISO-Werte, die in der
           Vorführung als „2026-02-11" in jeder Zeile standen (und nach einer Buchung
           mit deutschen Werten gemischt erschienen). */
        id: r.id, reDatum: deDatum(r.re_datum), reNummer: r.re_nummer, empfaenger: r.empfaenger,
        verwendungszweck: r.verwendungszweck, caseLabel: r.case_label,
        rechnungszeitraum: r.rechnungszeitraum, summe: r.summe,
        eingangDatum: deDatum(r.eingang_datum) || null, eingangsbetrag: r.eingangsbetrag,
        status: r.status || '', faelligAm: r.faellig_am || '', bewilligtAm: r.bewilligt_am || ''
      }));
      const oj = (key) => {
        const row = db.prepare('SELECT data_json FROM office_json WHERE key = ?').get(key);
        try { return row && row.data_json ? JSON.parse(row.data_json) : null; } catch (_e) { return null; }
      };
      kontaktmonitor = (function(){ const km = oj('kontaktmonitor'); return (km && Array.isArray(km.entries)) ? km.entries : (Array.isArray(km) ? km : []); })(); /* Paketform = bueroLocal-Form (Array), s. Client-Zweig in demoBoot */
      qualifikationen = oj('qualifikationen');
    } finally { db.close(); }

    const bueroKontakte = MUSTER_BUEROKONTAKTE.map((k, i) => Object.assign({ id: 'demo-bk-' + (i + 1) }, k));

    /* ---- Zeitliche Ausrichtung + Fristen im Kalender (Nutzerfund 30.08.2026) ----
       ZWEI Befunde aus der Vorführung:
       1. Alle Zähler der Kopfzeile standen auf 0 und der Kalender meldete „Heute keine
          Termine": Die Fixtures tragen FESTE Kalendertage, die inzwischen vorbei sind.
          Deshalb werden Termine, Aufgaben, Wiedervorlagen und Fristen um denselben
          Tagesversatz verschoben, sodass die Vorführung immer „lebt" - die zeitlichen
          ABSTÄNDE untereinander bleiben dabei exakt erhalten. Bewusst NICHT verschoben:
          Geburtsdaten, Betreuungsbeginn, Aktenzeichen-Daten, Rechnungsdaten.
       2. Fristen erschienen nie im Kalender-Widget: Es zeichnet ausschliesslich aus der
          Aufgabenliste (calTodoPseudoEvents -> todoItems), und dort lag keine einzige
          Frist. Jede Fall-Frist bekommt deshalb zusätzlich einen Aufgaben-Eintrag mit
          itemType 'deadline' - genau die Form, aus der das Widget den ROTEN Punkt baut. */
    const BEZUGSTAG = '2026-08-30';
    /* Versatz in GANZEN KALENDERTAGEN der lokalen Zeitzone rechnen (Fund der Suite 31.08.2026,
       kurz nach Mitternacht): Vorher lief der Vergleich gegen 12:00 UTC und wurde gerundet -
       zwischen Mitternacht und ~14 Uhr MESZ kam dabei ein Tag zu wenig heraus. Die Vorführung
       zeigte dann „Heute keine Termine", während die Kopfzeile den heutigen Tag zählte. */
    const heuteMitternacht = new Date(); heuteMitternacht.setHours(0, 0, 0, 0);
    const bezugMitternacht = new Date(`${BEZUGSTAG}T00:00:00`);
    const versatzTage = Math.round((heuteMitternacht.getTime() - bezugMitternacht.getTime()) / 86400000);
    const schiebeIso = (wert) => {
      const t = String(wert || '');
      const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(t);
      if (!m || !versatzTage) return t;
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      d.setUTCDate(d.getUTCDate() + versatzTage);
      return d.toISOString().slice(0, 10) + m[4];
    };
    kalender = kalender.map((e) => Object.assign({}, e, { startAt: schiebeIso(e.startAt), endAt: schiebeIso(e.endAt) }));
    aufgaben = aufgaben.map((t) => Object.assign({}, t, {
      dueAt: schiebeIso(t.dueAt), startAt: schiebeIso(t.startAt), remindAt: schiebeIso(t.remindAt)
    }));
    /* Fristen: im Fall verschieben UND als deadline-Aufgabe spiegeln. */
    let fristenNr = 0;
    for (const fall of faelle) {
      const cd = (fall.state && fall.state.caseData) || {};
      if (!Array.isArray(cd.fristen)) continue;
      cd.fristen = cd.fristen.map((fr) => Object.assign({}, fr, {
        dueDate: schiebeIso(fr.dueDate), baseDate: schiebeIso(fr.baseDate)
      }));
      for (const fr of cd.fristen) {
        if (!fr || fr.status === 'erledigt' || !fr.dueDate) continue;
        aufgaben.push({
          id: 'demo-frist-' + (++fristenNr),
          title: fr.title || fr.formName || 'Frist',
          description: [fr.institution, fr.note].filter(Boolean).join(' · '),
          dueAt: fr.dueDate,
          done: false,
          itemType: 'deadline',
          sourceType: 'deadline',
          sourceModule: 'deadline',
          sourceId: String(fr.id || ''),
          caseId: fall.id || '',
          caseLabel: fall.label || '',
          priority: fr.priority || 'normal'
        });
      }
    }

    /* ---- „Heute lebt" (Nutzerfund: alle Zähler der Kopfzeile standen auf 0) ----
       Der Versatz oben hält den Bestand aktuell, aber die Fixtures haben am Vorführtag
       selbst nichts liegen. Je Fall kommt deshalb ein kleiner Satz fallbezogener Einträge
       dazu, deren Daten RELATIV zu heute berechnet werden - so zeigt die Kopfzeile echte
       Zahlen, der Kalender hat Punkte und die Listen sind nicht leer. Die Texte greifen die
       Geschichte des jeweiligen Falls auf (Heim, Jobcenter, Wohnung, Wohngruppe, WfbM). */
    /* Datumsstrings sind KALENDERTAGE, keine Zeitpunkte: mit toISOString() (UTC) lieferte
       tagIso(0) zwischen Mitternacht und 2 Uhr MESZ noch den Vortag - die Vorführung stand dann
       morgens mit leerer Kopfzeile da (Fund 31.08.2026). Deshalb den lokalen Tag ausgeben;
       zeitIso bleibt bewusst UTC, dort ist der Zeitpunkt absolut. */
    const tagIso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
    const zeitIso = (n, std, min) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(std, min || 0, 0, 0); return d.toISOString(); };
    const LEBEN = [
      [/Auerbach/, {
        fristen: [[0, 'Jahresbericht an das Amtsgericht', 'Amtsgericht Musterstadt'], [12, 'Rechnungslegung einreichen', 'Amtsgericht Musterstadt']],
        termine: [[0, 10, 30, 'Pflegevisite in der Seniorenresidenz', 'Seniorenresidenz Rheinblick'],
                  [2, 14, 0, 'Angehörigengespräch zur Höherstufung', 'Seniorenresidenz Rheinblick'],
                  [9, 9, 30, 'Begutachtung Medizinischer Dienst', 'Seniorenresidenz Rheinblick']],
        aufgaben: [[0, 'Jahresbericht zusammenstellen', 'Unterlagen für das Amtsgericht sortieren'],
                   [1, 'Heimentgelt-Anpassung prüfen', 'Widerspruchsfrist beachten'],
                   [4, 'Rollator-Rechnung ablegen', 'Eigenanteil 68,90 EUR']],
        wiedervorlagen: [[0, 'Rückmeldung Pflegekasse abwarten', 'Höherstufungsantrag läuft']]
      }],
      [/Kilic/, {
        fristen: [[0, 'Mitwirkung Jobcenter: Unterlagen', 'Jobcenter Musterstadt'], [9, 'Weiterbewilligungsantrag', 'Jobcenter Musterstadt']],
        termine: [[0, 13, 0, 'Hausbesuch Herr Kilic', 'Gutenbergstraße 14b'],
                  [3, 10, 30, 'Depotmedikation Praxis Dr. Steinbach', 'Gemeinschaftspraxis'],
                  [7, 11, 15, 'Anhörung Betreuungsgericht', 'Amtsgericht, Zimmer 114']],
        aufgaben: [[0, 'Kontoauszüge ans Jobcenter senden', 'Mitwirkung Weiterbewilligung'],
                   [2, 'Ratenzahlung Stadtwerke bestätigen', 'Erste Rate zum Monatsende'],
                   [5, 'Soziotherapie-Startgespräch vorbereiten', '']],
        wiedervorlagen: [[0, 'Eingangsbestätigung Jobcenter prüfen', ''], [6, 'Stromabschlag kontrollieren', '']]
      }],
      [/Nowak/, {
        fristen: [[0, 'Widerspruch Nebenkostenabrechnung', 'Wohnbau Musterstadt eG'], [15, 'Vergütungsantrag einreichen', 'Amtsgericht Musterstadt']],
        termine: [[0, 14, 0, 'Besprechung Nebenkostenabrechnung', 'bei Frau Nowak'],
                  [1, 11, 0, 'Krankengymnastik begleiten', 'Physiotherapie Vital'],
                  [5, 9, 0, 'Belegeinsicht Wohnbau', 'Geschäftsstelle Wohnbau']],
        aufgaben: [[0, 'Nebenkostenabrechnung nachrechnen', 'Nachzahlung erscheint zu hoch'],
                   [1, 'Vergütungsantrag 3. Quartal stellen', 'Vermögend - Vergütung aus dem Vermögen'],
                   [3, 'Wohngeld-Bescheid ablegen', '']],
        wiedervorlagen: [[0, 'Antwort Vermieter abwarten', 'Belegeinsicht angefragt']]
      }],
      [/Rothenberg/, {
        fristen: [[0, 'Stellungnahme Gesamtplan', 'Sozialamt Landkreis Muster'], [11, 'Barbetrag-Nachweis', 'Wohnverbund Am Lindenhof']],
        termine: [[0, 9, 0, 'Gespräch mit der Wohngruppenleitung', 'Wohnverbund Am Lindenhof'],
                  [4, 14, 0, 'Gesamtplankonferenz', 'Sozialamt, Dienststelle'],
                  [10, 10, 0, 'Hausarzttermin begleiten', 'Praxis am Musterplatz']],
        aufgaben: [[0, 'Barbetrag-Abrechnung prüfen', 'Quartalsabrechnung der Wohngruppe'],
                   [2, 'Sachstand an die Betreuungsbehörde', ''],
                   [6, 'Zuzahlungen Apotheke abrechnen', '41,50 EUR']],
        wiedervorlagen: [[0, 'Förderplan anfordern', 'Alltagstraining läuft']]
      }],
      [/Weidmann/, {
        fristen: [[0, 'Nachweis Kindergeld', 'Familienkasse Muster'], [20, 'Überprüfung Grundsicherung', 'Grundsicherungsamt']],
        termine: [[0, 15, 30, 'Telefonat mit den Eltern', ''],
                  [2, 9, 0, 'Entwicklungsgespräch in der Werkstatt', 'WfbM Musterwerkstätten'],
                  [8, 13, 0, 'Termin Optiker (Brille abholen)', 'Optik Sehklar']],
        aufgaben: [[0, 'Nachweis Werkstattbeschäftigung senden', 'Familienkasse, Kindergeld'],
                   [3, 'Wochenendbesuch abstimmen', 'Fahrdienst informieren'],
                   [5, 'Brillenrechnung prüfen', 'Eigenanteil 129,00 EUR']],
        wiedervorlagen: [[0, 'Rückmeldung Familienkasse', '']]
      }]
    ];
    let lebenNr = 0;
    for (const fall of faelle) {
      const satz = LEBEN.find((e) => e[0].test(String(fall.label || '')));
      if (!satz) continue;
      const d = satz[1];
      (d.termine || []).forEach(([tag, std, min, titel, ort]) => {
        kalender.push({ id: 'demo-cal-' + (++lebenNr), title: titel, description: '', location: ort || '',
          startAt: zeitIso(tag, std, min), endAt: zeitIso(tag, std + 1, min), allDay: false,
          caseId: fall.id || '', caseLabel: fall.label || '' });
      });
      (d.aufgaben || []).forEach(([tag, titel, beschreibung]) => {
        aufgaben.push({ id: 'demo-task-' + (++lebenNr), title: titel, description: beschreibung || '',
          dueAt: tagIso(tag), done: false, itemType: 'task', caseId: fall.id || '', caseLabel: fall.label || '',
          priority: tag === 0 ? 'hoch' : 'normal' });
      });
      (d.wiedervorlagen || []).forEach(([tag, titel, beschreibung]) => {
        aufgaben.push({ id: 'demo-wv-' + (++lebenNr), title: titel, description: beschreibung || '',
          dueAt: tagIso(tag), done: false, itemType: 'followup', caseId: fall.id || '', caseLabel: fall.label || '',
          priority: 'normal' });
      });
      /* Je Fall auch eine FRIST mit nahem Datum - sonst blieb der Fristen-Zähler der
         Kopfzeile auf 0, während die Seitenleiste sieben zählte (die zählt alle offenen,
         die Kopfzeile nur die heute fälligen). Sie entsteht im Fall UND als deadline-
         Aufgabe, damit sie zugleich im Kalender als roter Punkt erscheint. */
      const cdFall = (fall.state && fall.state.caseData) || {};
      if (Array.isArray(cdFall.fristen) && (d.fristen || []).length) {
        (d.fristen || []).forEach(([tag, titel, stelle]) => {
          const id = 'demo-fr-' + (++lebenNr);
          cdFall.fristen.push({ id, title: titel, category: 'sonstige', formName: '', institution: stelle || '',
            baseDate: tagIso(tag - 14), dueDate: tagIso(tag), interval: '', routing: 'both',
            priority: tag === 0 ? 'hoch' : 'normal', status: 'offen', note: '' });
          aufgaben.push({ id: 'demo-frt-' + lebenNr, title: titel, description: stelle || '',
            dueAt: tagIso(tag), done: false, itemType: 'deadline', sourceType: 'deadline',
            sourceModule: 'deadline', sourceId: id, caseId: fall.id || '', caseLabel: fall.label || '',
            priority: tag === 0 ? 'hoch' : 'normal' });
        });
      }
    }

    const paket = {
      erzeugtAm: new Date().toISOString(),
      versatzTage,
      faelle,
      buero: {
        officeProfile: MUSTER_BUERO,
        officeBankAccounts: [{ bankName: 'Musterbank eG', iban: 'DE89 3704 0044 0532 0130 00', bic: 'MUSTDEFFXXX', accountHolder: 'Betreuungsbüro Mustermensch', accountType: 'Geschäftskonto' }],
        officeEmployees: [{ maKennung: 'MM1', firstName: 'Max', lastName: 'Mustermensch', role: 'Rechtlicher Betreuer', email: MUSTER_BUERO.email, phone: MUSTER_BUERO.phone }],
        mileageVehicles: fahrzeuge,
        mileageTrips: fahrten,
        invoiceEntries: rechnungen,
        kontaktmonitor,
        qualifikationen,
        bueroKontakte
      },
      kalender,
      aufgaben
    };

    /* Verfremdung über den GESAMTEN Bestand - erst serialisieren, dann ersetzen. */
    return JSON.parse(verfremde(JSON.stringify(paket)));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_e) { /* Temp bleibt notfalls liegen */ }
  }
}

module.exports = { bauePaket, MUSTER_BUERO, VERFREMDUNG, strukturVerfremden, DEMO_FOTO_DATEIEN };

if (require.main === module) {
  /* --json: reines Paket auf stdout - so baut der Server das Paket in einem KINDPROZESS
     statt synchron im Request-Handler (der execFileSync-Weg blockierte den Node-Eventloop
     und damit alle echten Nutzer für die Dauer des Baus; Befund 30.08.2026). */
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(bauePaket()));
    return;
  }
  const p = bauePaket();
  const bytes = Buffer.byteLength(JSON.stringify(p));
  console.log(`Vorführpaket gebaut: ${p.faelle.length} Fälle, ${p.kalender.length} Termine, ${p.aufgaben.length} Aufgaben, ${(bytes / 1048576).toFixed(1)} MB`);
}
