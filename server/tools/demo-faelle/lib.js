'use strict';
/* Bausteine fuer die fuenf fiktiven Demonstrationsfaelle (server/tools/demo-faelle/).
   Alle Personen, Anschriften, Aktenzeichen, Bankverbindungen und Befunde sind frei erfunden.
   Die Datumsformate folgen exakt der App: Stammdaten/Falldokumentation in TT.MM.JJJJ,
   Modul-Listen (Fristen, Genehmigungen, Handkasse, Ziele, Wohnen) in ISO JJJJ-MM-TT. */

/* Stabile, sprechende Kennungen - bewusst NICHT zufaellig, damit ein erneuter Lauf des
   Seeders dieselben IDs erzeugt und Verknuepfungen (Schulden -> Vermoegensverzeichnis,
   Frist -> Kalender/Aufgabe) reproduzierbar bleiben. */
function id(prefix, fall, nr) {
  return `${prefix}${fall}${String(nr).padStart(3, '0')}`;
}

/* TT.MM.JJJJ aus ISO. Die Stammdaten- und Doku-Felder erwarten das deutsche Format. */
function de(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
}

function jahr(iso) {
  return String(iso || '').slice(0, 4);
}

/* Falldokumentation: kompakte Tupel -> vollstaendige Eintraege.
   [ISO-Datum, Akteursgruppe, Akteur, Vorgangsart, Vorgangsdetails, Kontaktart, Freifeld, Notiz] */
function doku(rows) {
  return rows.map(([datum, gruppe, akteur, art, detail, kontakt, frei, notiz]) => ({
    date: de(datum),
    year: jahr(datum),
    actorGroup: gruppe,
    actor: akteur,
    type: art,
    detail,
    contactType: kontakt,
    freeDetail: frei || '',
    note: notiz || ''
  }));
}

/* Handkasse: [ISO, 'ausgabe'|'einnahme', Empfaenger, Zweck, Kategorie, Betrag] */
function handkasse(fall, rows) {
  return rows.map(([datum, typ, empfaenger, zweck, kategorie, betrag], i) => ({
    id: id('hk', fall, i + 1),
    date: datum,
    type: typ,
    recipient: empfaenger,
    purpose: zweck,
    category: kategorie,
    amount: String(betrag),
    interval: ''
  }));
}

/* Vermoegensaufstellung: [Kategorie, Details, Institut, Betrag] */
function posten(fall, praefix, rows) {
  return rows.map(([kategorie, details, institut, betrag], i) => ({
    id: id(praefix, fall, i + 1),
    category: kategorie,
    details,
    institution: institut,
    amount: String(betrag)
  }));
}

/* Lebensunterhalt Einnahmen: [Kategorie, Beschreibung, Zahlstelle, Frequenz, monatlich] */
function einnahmen(fall, rows) {
  return rows.map(([kategorie, beschreibung, stelle, frequenz, monatlich], i) => ({
    id: id('lui', fall, i + 1),
    category: kategorie,
    description: beschreibung,
    provider: stelle,
    frequency: frequenz,
    total: '',
    monthly: String(monatlich)
  }));
}

/* Lebensunterhalt Ausgaben: [Kategorie, Beschreibung, Glaeubiger, Frequenz, monatlich, Status] */
function ausgaben(fall, rows) {
  return rows.map(([kategorie, beschreibung, glaeubiger, frequenz, monatlich, status], i) => ({
    id: id('lua', fall, i + 1),
    category: kategorie,
    description: beschreibung,
    creditor: glaeubiger,
    frequency: frequenz,
    total: '',
    monthly: String(monatlich),
    status: status || ''
  }));
}

/* Schuldenregulierung: ein Datensatz je Forderung, inklusive geleisteter Raten.
   basisGezahlt + payments ergeben den Restbetrag, den das Modul in die
   Vermoegensaufstellung spiegelt (Eintraege 'sr:<id>' in debtsBegin/debtsEnd). */
function schuld(fall, nr, spec) {
  const payments = (spec.raten || []).map(([datum, betrag], i) => ({
    id: id('srp', fall, nr * 100 + i + 1),
    date: datum,
    amount: Number(betrag),
    note: ''
  }));
  return {
    id: id('sr', fall, nr),
    erfasstAm: spec.erfasstAm,
    forderungsbeginn: spec.forderungsbeginn || '',
    glaeubiger: spec.glaeubiger,
    kategorie: spec.kategorie,
    aktenzeichen: spec.aktenzeichen || '',
    hauptforderung: String(spec.hauptforderung),
    mahnkosten: String(spec.mahnkosten || ''),
    bearbeitungskosten: String(spec.bearbeitungskosten || ''),
    prozesskosten: String(spec.prozesskosten || ''),
    ratenhoehe: String(spec.ratenhoehe || ''),
    ratenintervall: spec.ratenintervall || 'monatlich',
    status: spec.status || 'Ratenzahlung',
    dauerauftrag: !!spec.dauerauftrag,
    bankverbindung: spec.bankverbindung || {},
    verwendungszweck: spec.verwendungszweck || '',
    notizen: spec.notizen || '',
    payments,
    basisGezahlt: String(spec.basisGezahlt || ''),
    erledigtAm: spec.erledigtAm || '',
    pausiertSeit: ''
  };
}

/* Restforderung einer Schuld (Hauptforderung + Kosten - Zahlungen). */
function schuldRest(s) {
  const zahl = (v) => (v === '' || v == null ? 0 : Number(v));
  const summe = zahl(s.hauptforderung) + zahl(s.mahnkosten) + zahl(s.bearbeitungskosten) + zahl(s.prozesskosten);
  const gezahlt = zahl(s.basisGezahlt) + (s.payments || []).reduce((a, p) => a + Number(p.amount || 0), 0);
  return Math.round((summe - gezahlt) * 100) / 100;
}

/* Spiegelzeilen der Schuldenregulierung fuer die Vermoegensaufstellung (wie im Modul:
   Anfang = volle Forderung zum Stichtag, Ende = aktueller Rest). */
function schuldenSpiegel(schulden, zeitpunkt) {
  return schulden.map((s) => {
    const zahl = (v) => (v === '' || v == null ? 0 : Number(v));
    const summe = zahl(s.hauptforderung) + zahl(s.mahnkosten) + zahl(s.bearbeitungskosten) + zahl(s.prozesskosten);
    return {
      id: `sr:${s.id}`,
      category: s.kategorie,
      details: [s.aktenzeichen && `Az. ${s.aktenzeichen}`, s.glaeubiger].filter(Boolean).join(' · '),
      institution: s.glaeubiger,
      amount: zeitpunkt === 'begin' ? summe : schuldRest(s),
      source: 'schuldenregulierung',
      sourceId: s.id
    };
  });
}

/* Genehmigungen (Fallakte > Genehmigungen). */
function genehmigungen(fall, rows) {
  return rows.map(([datum, kategorie, sache, wille, status, beschluss, umsetzung, notiz], i) => ({
    id: id('ap', fall, i + 1),
    date: datum,
    category: kategorie,
    matter: sache,
    wille,
    status,
    decisionDate: beschluss || '',
    umsetzungDate: umsetzung || '',
    note: notiz || '',
    sourceModule: '',
    sourceId: '',
    sourceType: '',
    sourceRef: '',
    linkedActionKind: ''
  }));
}

/* Fristen (Menue Fristen). routing 'both' erzeugt in der App Kalender- und Aufgabeneintrag;
   die Demo-Daten setzen die Verknuepfungen selbst, siehe seed.js. */
function fristen(fall, rows) {
  return rows.map(([titel, kategorie, stelle, basis, faellig, prio, status, notiz], i) => ({
    id: id('fr', fall, i + 1),
    title: titel,
    category: kategorie,
    formName: '',
    institution: stelle,
    baseDate: basis || '',
    dueDate: faellig,
    interval: '',
    routing: 'both',
    remindDays: 14,
    priority: prio,
    status,
    note: notiz || '',
    source: 'manual',
    calEventId: '',
    todoId: ''
  }));
}

/* Bedarfe & Wille (Ziel-, Wunsch- und Entscheidungsplanung).
   Aufbau exakt wie das Modul ihn schreibt: version 3, records[] mit history und smart. */
function planung(fall, rows) {
  const records = rows.map((r, i) => {
    const stempel = `${r.angelegt}T09:12:00.000Z`;
    return {
      id: `gdp-${fall}-${String(i + 1).padStart(2, '0')}`,
      type: r.typ,
      title: r.titel,
      description: r.beschreibung,
      statement: r.aussage || '',
      area: r.bereich,
      status: r.status,
      priority: r.prioritaet,
      responsible: r.zustaendig || '',
      targetDate: r.zieldatum || '',
      reviewDate: r.pruefdatum || '',
      source: r.quelle || '',
      progress: r.fortschritt || 0,
      favorite: !!r.favorit,
      createdAt: stempel,
      updatedAt: `${r.stand || r.angelegt}T16:40:00.000Z`,
      parentId: '',
      links: (r.module || []).map((m) => ({
        module: m,
        label: {
          doku: 'Falldokumentation', task: 'Aufgaben', deadline: 'Fristen',
          calendar: 'Kalender', approval: 'Genehmigungen'
        }[m] || m
      })),
      history: (r.verlauf || [[r.angelegt, 'Eintrag angelegt', r.status]]).map(([datum, aktion, notiz]) => ({
        at: `${datum}T09:12:00.000Z`, action: aktion, note: notiz || ''
      })),
      smart: r.smart || { formulation: '', specific: '', measurable: '', attractive: '', realistic: '', timeBound: '' },
      linkedEntries: []
    };
  });
  return { version: 3, records };
}

/* Wohnen: Verlaufseintraege (Wohnsicherheit, Barrierefreiheit, Probleme, Unterstuetzung). */
function wohnEintrag(fall, art, nr, spec) {
  const base = {
    id: `housing-${art}-${fall}-${nr}`,
    entryDate: spec.von,
    endDate: spec.bis || '',
    createdAt: `${spec.von}T10:00:00.000Z`,
    updatedAt: `${spec.stand || spec.von}T10:00:00.000Z`,
    status: spec.status,
    details: spec.details
  };
  if (art === 'support') base.forms = spec.formen || [];
  return base;
}

/* Adressbuch des Falls. Die Zeilennummer (_row) folgt den festen Excel-Bloecken der
   Adressverzeichnis-Vorlage; ohne sie sortiert die Oberflaeche die Kategorie nicht zu. */
const ADRESS_BLOECKE = {
  behoerden: 3, gesundheit: 23, finanzen: 43, versicherungen: 63,
  arbeit: 83, unterkunft: 103, soziales: 116
};

function kontakte(person, rows) {
  const zaehler = {};
  return rows.map((r) => {
    zaehler[r.kategorie] = (zaehler[r.kategorie] || 0) + 1;
    const tel = String(r.telefon || '').split('/');
    const mob = String(r.mobil || '').split('/');
    const fax = String(r.fax || '').split('/');
    return {
      status: r.status || 'Aktiv',
      role: r.rolle,
      salutation: r.anrede || 'Sehr geehrte Damen und Herren',
      title: r.titel || '',
      firstName: r.vorname || '',
      lastName: r.nachname || '',
      institution: r.institution || '',
      street: r.strasse || '',
      house: r.hausnummer || '',
      houseLetter: '',
      postal: r.plz || '',
      city: r.ort || '',
      postbox: r.postfach || '',
      phoneArea: tel[0] || '', phoneNumber: tel[1] || '',
      mobileArea: mob[0] || '', mobileNumber: mob[1] || '',
      email: r.mail || '',
      faxArea: fax[0] || '', faxNumber: fax[1] || '',
      fileNumber: r.aktenzeichen || '',
      processNumber: r.vorgang || '',
      iban: r.iban || '', bic: r.bic || '', bankName: r.bank || '',
      clientFirstName: person.firstName,
      clientLastName: person.lastName,
      clientStreet: person.street,
      clientHouse: person.house,
      clientHouseLetter: '',
      clientPostal: person.postal,
      clientCity: person.city,
      clientBirthDate: person.birthDate,
      courtNameRef: r.gericht || '',
      courtFileNumberRef: r.gerichtsAz || '',
      _row: ADRESS_BLOECKE[r.kategorie] + zaehler[r.kategorie] - 1,
      _category: r.kategorie,
      phone: tel.filter(Boolean).join(' / '),
      mobile: mob.filter(Boolean).join(' / '),
      fax: fax.filter(Boolean).join(' / ')
    };
  });
}

/* Berichtsfelder: value/source/reviewed wie das Formularmodul sie ablegt. */
function bericht(felder, stand) {
  const fields = {};
  for (const [key, value] of Object.entries(felder)) {
    fields[key] = {
      value,
      source: 'manual',
      reviewed: true,
      cleared: false,
      updatedAt: `${stand}T11:30:00.000Z`
    };
  }
  return { fields };
}

/* Vorsorgekatalog (Spiegel von PROVISION_TYPES_V156). */
const VORSORGE_LABEL = {
  patientenverfuegung: 'Patientenverfügung',
  betreuungsverfuegung: 'Betreuungsverfügung',
  vorsorgevollmacht: 'Vorsorgevollmacht',
  testament: 'Testament',
  vorsorgeregister: 'Zentrales Vorsorgeregister',
  bestattungsinstitut: 'Bestattungsinstitut',
  organspende: 'Organspende',
  totenfuersorge: 'Totenfürsorge',
  sorgerechtsverfuegung: 'Sorgerechtsverfügung',
  kontovollmacht: 'Kontovollmacht (Bank)',
  generalvollmacht: 'Generalvollmacht',
  bestattungsvorsorge: 'Bestattungsvorsorgevertrag',
  sterbegeldversicherung: 'Sterbegeldversicherung',
  erbvertrag: 'Erbvertrag',
  digitaler_nachlass: 'Digitaler Nachlass',
  sonstiges_vorsorge: 'Sonstiges Vorsorgedokument'
};

function vorsorge(eintraege) {
  const out = {};
  for (const [key, status, az] of eintraege) {
    out[key] = { label: VORSORGE_LABEL[key] || key, status, fileNumber: az || '--' };
  }
  return out;
}

/* Rechnungslegung (Fallakte > Rechnungslegung / Bericht 'accounting'). */
function rechnungslegung(fall, spec) {
  return {
    v: 1,
    version: 2,
    periodFrom: spec.von,
    periodTo: spec.bis,
    activeStep: 1,
    accounts: (spec.konten || []).map((k, i) => ({
      id: id('acck', fall, i + 1),
      name: k.name,
      type: k.art,
      bank: k.bank,
      holder: k.inhaber,
      iban: k.iban,
      bic: k.bic,
      openingBalance: k.anfang,
      closingBalance: k.ende,
      statementClosing: k.ende,
      transactions: [],
      income: k.einnahmen || 0,
      expenses: k.ausgaben || 0
    })),
    sources: [],
    liabilities: (spec.verbindlichkeiten || []).map(([glaeubiger, grund, anfang, ende], i) => ({
      id: id('accl', fall, i + 1), creditor: glaeubiger, reason: grund, start: anfang, end: ende
    })),
    gifts: (spec.schenkungen || []).map(([empfaenger, was, datum, betrag], i) => ({
      id: id('accg', fall, i + 1), recipient: empfaenger, description: was, date: datum, amount: betrag
    })),
    assets: (spec.vermoegen || []).map(([kategorie, beschreibung, anfang, ende], i) => ({
      id: id('acca', fall, i + 1), category: kategorie, description: beschreibung, start: anfang, end: ende
    })),
    settings: { dateTolerance: 21, amountTolerance: 0.02, receiptThreshold: 50, autoAssignScore: 86 },
    ui: { accountFilter: 'all', query: '', issueFilter: 'all', invoiceFilter: 'all' }
  };
}

/* Export- und Versandhistorie: ein Eintrag entspricht genau einem erzeugten Dokument.
   `art` steuert die PDF-Vorlage in dokumente.js ('brief' oder 'bericht'), `inhalt` liefert
   deren Bausteine. Die Kennung, der Dateiname und der Beleg (exportRef) entstehen erst beim
   Ablegen im Dokumentenspeicher - siehe seed.js. */
function ausgang(fall, nr, spec) {
  return {
    id: `ex-${fall}-${String(nr).padStart(2, '0')}`,
    datum: spec.datum,
    zeit: spec.zeit || '0930',
    reportId: spec.reportId,
    dokumentTitel: spec.dokumentTitel,
    exportMode: spec.exportMode || 'letterhead',
    empfaenger: spec.empfaenger,
    empfaengerZeilen: spec.empfaengerZeilen || [],
    recipientEmail: spec.mail || '',
    recipientFax: spec.fax || '',
    betreff: spec.betreff,
    body: spec.body || '',
    status: spec.status || 'sent',
    channel: spec.channel || '',
    preparedChannel: spec.vorbereitet || spec.channel || '',
    note: spec.notiz || '',
    art: spec.art || 'brief',
    inhalt: spec.inhalt || {},
    verlauf: spec.verlauf || null,
    dokuGruppe: spec.dokuGruppe || 'Sonstige Akteure',
    dokuAkteur: spec.dokuAkteur || '',
    dokuArt: spec.dokuArt || 'Anträge, Verfahren & Rechtliches',
    dokuDetail: spec.dokuDetail || 'Dokumentenversand'
  };
}

/* Fallakte > Archiv: archivierter Berichtsstand ("Vorbericht"). data.fields hat dieselbe
   Form wie ein Bericht, meta traegt Zeitraum und Zeitstempel. */
function ortsZeitpunkt(datum, uhrzeit) {
  const [j, m, t] = String(datum).split('-').map(Number);
  const [hh, mm] = String(uhrzeit || '11:20').split(':').map(Number);
  return new Date(j, m - 1, t, hh, mm).toISOString();
}

function archiv(fall, nr, spec) {
  const felder = {};
  for (const [key, value] of Object.entries(spec.felder || {})) {
    felder[key] = {
      value, source: 'manual', reviewed: true, cleared: false,
      updatedAt: ortsZeitpunkt(spec.archiviertAm, spec.zeit)
    };
  }
  return {
    id: `ar-${fall}-${String(nr).padStart(2, '0')}`,
    reportId: spec.reportId,
    title: spec.titel,
    archivedAt: ortsZeitpunkt(spec.archiviertAm, spec.zeit),
    periodFrom: spec.von,
    periodTo: spec.bis,
    customName: spec.name,
    notes: spec.notiz,
    notesAutoFilled: false,
    data: {
      fields: felder,
      meta: {
        createdAt: ortsZeitpunkt(spec.erstelltAm || spec.archiviertAm, '09:00'),
        updatedAt: ortsZeitpunkt(spec.archiviertAm, spec.zeit),
        periodFrom: spec.von,
        periodTo: spec.bis
      }
    }
  };
}

/* Faehigkeiten & Alltag (goalDecisionPlanning.functionalProfile).
   Aufbau exakt wie der Hub speichert: assessments[] je Bereich in der Reihenfolge
   der DOMAIN_LABELS, dailyLife, wishExpression, updatedAt und history. */
const FP_BEREICHE = [
  'communication', 'orientation', 'mobility', 'health_selfcare', 'housing_household',
  'daily_social', 'work_education', 'authorities_law', 'finance_assets'
];

function profil(fall, spec) {
  const stempel = `${spec.stand}T16:40:00.000Z`;
  const assessments = FP_BEREICHE.filter((key) => spec.bereiche[key]).map((domain) => {
    const b = spec.bereiche[domain];
    return {
      id: `assessment-${fall}-${domain.replace(/_/g, '-')}`,
      domain,
      resources: b.ressourcen,
      impairments: b.einschraenkungen,
      linkedNeedIds: b.bedarfe || [],
      source: b.quelle,
      assessedAt: b.erhoben,
      reviewDate: b.wiedervorlage || '',
      active: b.aktuell !== false,
      includeInReports: b.bericht !== false
    };
  });
  const d = spec.alltag, w = spec.wunsch;
  return {
    version: 1,
    assessments,
    dailyLife: {
      summary: d.zusammenfassung,
      routine: d.tagesablauf,
      household: d.haushalt,
      selfCare: d.selbstversorgung,
      occupation: d.beschaeftigung,
      socialParticipation: d.teilhabe,
      assistance: d.unterstuetzung,
      source: d.quelle,
      assessedAt: d.erhoben,
      reviewDate: d.wiedervorlage || '',
      includeInReports: d.bericht !== false
    },
    wishExpression: {
      status: w.status,
      reason: w.begruendung || '',
      support: w.unterstuetzung || '',
      communicationMethods: w.wege || [],
      source: w.quelle,
      assessedAt: w.erhoben,
      reviewDate: w.wiedervorlage || '',
      includeInReports: w.bericht !== false
    },
    updatedAt: stempel,
    history: (spec.verlauf || []).map(([datum, aktion]) => ({
      at: `${datum}T16:40:00.000Z`, action: aktion, previousUpdatedAt: ''
    }))
  };
}

module.exports = {
  id, de, jahr, ausgang, archiv, doku, handkasse, posten, einnahmen, ausgaben,
  schuld, schuldRest, schuldenSpiegel, genehmigungen, fristen, planung,
  wohnEintrag, kontakte, bericht, vorsorge, rechnungslegung, profil, VORSORGE_LABEL
};
