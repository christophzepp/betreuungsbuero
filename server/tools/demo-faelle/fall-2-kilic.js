'use strict';
/* Demonstrationsfall 2 - Emre Kilic.
   Profil: 33 Jahre, paranoide Schizophrenie, eigene Wohnung mit ambulanter
   Unterstuetzung, Buergergeld, erhebliche Schulden, Unterbringung 2023,
   Betreuung seit 2022 - der Fall mit Schuldenregulierung und SGB-II-Bezug. */

const L = require('./lib');
const F = 'k';

const person = {
  salutation: 'Herr', title: '', gender: 'männlich',
  firstName: 'Emre', lastName: 'Kilic', birthName: '',
  birthDate: '22.08.1993', birthPlace: 'Mainz', birthCountry: 'Deutschland',
  nationality: 'deutsch', nationality2: 'türkisch',
  maritalStatus: 'ledig', maritalSince: '',
  religion: 'muslimisch',
  street: 'Gutenbergstraße', streetOnly: 'Gutenbergstraße', house: '14', houseNumber: '14', houseLetter: 'b',
  postal: '55411', postalCode: '55411', city: 'Bingen am Rhein', postbox: '', country: 'Deutschland',
  foreignCity: '',
  address: 'Gutenbergstraße 14b, 55411 Bingen am Rhein',
  institution: '',
  phone: '', mobile: '0157/88214470', email: 'e.kilic93@example-mail.de', fax: '',
  idCardNumber: 'T22M9K4LX', residencePermitNumber: '',
  taxId: '61 204 887 351', pensionInsuranceNumber: '52 220893 K 044',
  contributionNumber: 'TK 4471-220-893', socialOfficeNumber: 'JC 55411 // BG 0917442',
  fullName: 'Emre Kilic'
};

const care = {
  authorityName: 'Betreuungsbehörde Landkreis Mainz-Bingen',
  authorityCity: 'Ingelheim am Rhein',
  authorityFileNumber: 'BtB 2022/1188',
  courtName: 'Amtsgericht Bingen am Rhein',
  courtStreet: 'Mainzer Straße 21', courtPostbox: '', courtPostal: '55411', courtCity: 'Bingen am Rhein',
  courtAddressComplete: 'True',
  courtAddressSource: 'Justizportal Rheinland-Pfalz, geprüft 14.01.2026',
  courtVerificationStatus: 'verified',
  courtVerificationCheckedAt: '2026-01-14T09:05:00.000Z',
  fileNumber: '4 XVII 88/22',
  requestDate: '11.03.2022',
  preliminaryOrderDate: '',
  orderDate: '19.05.2022',
  officeHandoverDate: '23.05.2022',
  startDate: '24.05.2022',
  takeoverDate: '24.05.2022',
  handoverDate: '',
  reportPeriod: '01.06. - 31.05.',
  reviewDate: '23.05.2029',
  endDate: '',
  homePlacement: 'nein',
  nextAccountingDue: '30.06.2027',
  taskAreaDetails: [
    { name: 'Vermögenssorge', consentReservation: true },
    { name: 'Gesundheitssorge', consentReservation: false },
    { name: 'Aufenthaltsbestimmung', consentReservation: false },
    { name: 'Wohnungsangelegenheiten', consentReservation: false },
    { name: 'Vertretung gegenüber Behörden, Versicherungen, Renten- und Sozialleistungsträgern', consentReservation: false },
    { name: 'Geltendmachung von Ansprüchen auf Sozialleistungen', consentReservation: false },
    { name: 'Post- und Fernmeldeangelegenheiten', consentReservation: false }
  ]
};
care.taskAreas = care.taskAreaDetails.map((t) => t.name);

const healthInfo = {
  insurance: 'Techniker Krankenkasse',
  insuranceNumber: 'T447122089',
  careLevel: '',
  bloodType: 'A+',
  allergies: 'Keine bekannten Arzneimittelallergien. Unverträglichkeit gegenüber Olanzapin (starke Gewichtszunahme, abgesetzt 2023).',
  diagnosesNotes: 'Bei akuter Exazerbation Krankheitseinsicht deutlich eingeschränkt. Im stabilen Zustand ist Herr Kilic voll einwilligungsfähig und entscheidet selbst; Absprachen zu Depotgabe und Kontoverfügungen sind dann verlässlich.',
  diagnoses: [
    { icd: 'F20.0', text: 'Paranoide Schizophrenie, episodisch mit stabilem Residuum', since: '2016-04-11' },
    { icd: 'F17.2', text: 'Abhängigkeitssyndrom durch Tabak', since: '2012-01-01' },
    { icd: 'F12.1', text: 'Schädlicher Gebrauch von Cannabinoiden (aktuell abstinent seit 03/2024)', since: '2015-08-20' },
    { icd: 'E66.00', text: 'Adipositas Grad I (medikamentenassoziiert)', since: '2023-02-14' },
    { icd: 'K21.0', text: 'Gastroösophageale Refluxkrankheit mit Ösophagitis', since: '2021-11-05' }
  ],
  medications: [
    { name: 'Paliperidon-Depot (Xeplion)', dose: '100 mg', schedule: 'alle 4 Wochen i.m., Depotgabe in der Praxis' },
    { name: 'Sertralin', dose: '50 mg', schedule: '1-0-0' },
    { name: 'Pantoprazol', dose: '40 mg', schedule: '1-0-0' },
    { name: 'Lorazepam', dose: '0,5 mg', schedule: 'bei Bedarf, maximal 1x täglich' },
    { name: 'Nicotinersatz (Pflaster)', dose: '14 mg', schedule: '1-0-0, Reduktionsplan' }
  ],
  doctors: [
    { name: 'Dr. med. Jan Hüttenberger', field: 'Facharzt für Psychiatrie und Psychotherapie', phone: '06721/994120', email: 'praxis@huettenberger-bingen.de' },
    { name: 'Dr. med. Farida Nasser', field: 'Allgemeinmedizin (Hausärztin)', phone: '06721/301744', email: 'praxis.nasser@example-mail.de' },
    { name: 'Sophie Lindqvist (M.Sc.)', field: 'Psychologische Psychotherapie, Verhaltenstherapie', phone: '06721/886310', email: 'praxis@lindqvist-psychotherapie.de' },
    { name: 'Dr. med. Ralf Steinbrück', field: 'Gastroenterologie', phone: '06131/9214420', email: 'gastro@mvz-mainz-west.de' }
  ],
  emergency: [
    { name: 'Ayla Kilic', relation: 'Mutter', phone: '06132/447291', email: 'ayla.kilic@example-mail.de' },
    { name: 'Sozialpsychiatrischer Dienst Mainz-Bingen', relation: 'Krisendienst', phone: '06132/787360', email: 'spdi@mainz-bingen.de' },
    { name: 'Betreutes Wohnen Rheinhessen e. V. – Frau Wehrle', relation: 'Ambulante Bezugsbetreuung', phone: '06721/443015', email: 'wehrle@bewo-rheinhessen.de' }
  ],
  appointments: [
    { id: L.id('hia', F, 1), doctor: 'Dr. Hüttenberger', reason: 'Depotgabe Paliperidon, Verlaufsgespräch', from: '2026-01-14', to: '', note: 'Stabil, keine Positivsymptomatik. Gewicht 96 kg.', recommendation: 'Depot alle vier Wochen beibehalten' },
    { id: L.id('hia', F, 2), doctor: 'Dr. Nasser', reason: 'Gesundheitscheck, Laborkontrolle', from: '2026-02-05', to: '', note: 'HbA1c 5,6 %, Lipide grenzwertig.', recommendation: 'Bewegung, Ernährungsberatung' },
    { id: L.id('hia', F, 3), doctor: 'Sophie Lindqvist', reason: 'Verhaltenstherapie, Sitzung 34 von 60', from: '2026-03-11', to: '', note: 'Schwerpunkt Frühwarnzeichen und Umgang mit Stimmen.', recommendation: 'Wöchentliche Sitzungen fortführen' },
    { id: L.id('hia', F, 4), doctor: 'Dr. Steinbrück', reason: 'Gastroskopie-Kontrolle nach Refluxösophagitis', from: '2026-04-23', to: '', note: 'Deutliche Besserung unter Pantoprazol.', recommendation: 'Kontrolle in 12 Monaten' },
    { id: L.id('hia', F, 5), doctor: 'Dr. Hüttenberger', reason: 'Depotgabe, Anpassung Sertralin', from: '2026-06-10', to: '', note: 'Antriebsminderung im Frühjahr, Sertralin von 25 auf 50 mg erhöht.', recommendation: 'Kontrolle in vier Wochen' },
    { id: L.id('hia', F, 6), doctor: 'Dr. Hüttenberger', reason: 'Depotgabe, Stellungnahme für die Betreuungsbehörde', from: '2026-08-05', to: '', note: 'Stellungnahme zur Erforderlichkeit der Betreuung erstellt.', recommendation: 'Betreuung in reduziertem Umfang weiterführen' }
  ],
  hospital: [
    { id: L.id('hih', F, 1), clinic: 'Rheinhessen-Fachklinik Alzey, Station P3', reason: 'Erstmanifestation einer paranoiden Psychose mit Wahnvorstellungen', from: '2016-04-11', to: '2016-06-02', note: 'Freiwillige Aufnahme über die Rettungsstelle.', recommendation: 'Ambulante psychiatrische Weiterbehandlung' },
    { id: L.id('hih', F, 2), clinic: 'Rheinhessen-Fachklinik Alzey, Station P1 (geschützt)', reason: 'Akute Exazerbation mit Eigengefährdung, Unterbringung nach § 1831 BGB', from: '2023-01-19', to: '2023-03-08', note: 'Gerichtliche Genehmigung der Unterbringung vom 20.01.2023, verlängert bis 15.03.2023. Herr Kilic widersprach der Aufnahme.', recommendation: 'Umstellung auf Depotmedikation, Anbindung Betreutes Wohnen' },
    { id: L.id('hih', F, 3), clinic: 'Rheinhessen-Fachklinik Alzey, Tagesklinik Bingen', reason: 'Teilstationäre Stabilisierung nach Rückfall', from: '2024-02-26', to: '2024-04-19', note: 'Freiwillig, im Einvernehmen. Auslöser: Kündigung der Beschäftigung und Cannabiskonsum.', recommendation: 'Suchtberatung, Tagesstruktur über die WfbM prüfen' },
    { id: L.id('hih', F, 4), clinic: 'St. Hildegard Krankenhaus Bingen, Innere Medizin', reason: 'Refluxösophagitis Grad B, Gastroskopie', from: '2021-11-05', to: '2021-11-09', note: 'Vor Einrichtung der Betreuung.', recommendation: 'Protonenpumpenhemmer dauerhaft' }
  ],
  procedures: [
    { id: L.id('hip', F, 1), procedure: 'Umstellung auf Paliperidon-Depot', doctor: 'Dr. Hüttenberger', from: '2023-02-14', to: '2023-03-08', note: 'Nach Unverträglichkeit von Olanzapin. Herr Kilic hat der Umstellung im stabilen Zustand ausdrücklich zugestimmt.', recommendation: 'Depot alle vier Wochen, Erinnerung über die Bezugsbetreuung' },
    { id: L.id('hip', F, 2), procedure: 'Gastroskopie mit Biopsie', doctor: 'Dr. Steinbrück', from: '2026-04-23', to: '2026-04-23', note: 'Ambulant, Einwilligung durch Herrn Kilic selbst.', recommendation: 'Kontrolle in 12 Monaten' },
    { id: L.id('hip', F, 3), procedure: 'Zahnsanierung, drei Füllungen und Zahnreinigung', doctor: 'Zahnarztpraxis Dr. Ohlmann, Bingen', from: '2025-09-02', to: '2025-11-18', note: 'Eigenanteil über Härtefallregelung der TK reduziert.', recommendation: 'Halbjährliche Kontrolle' }
  ]
};

const schulden = [
  L.schuld(F, 1, {
    erfasstAm: '2022-06-14', forderungsbeginn: '2019-09-01',
    glaeubiger: 'Jobcenter Landkreis Mainz-Bingen', kategorie: 'Rückforderungen Jobcenter (SGB II)',
    aktenzeichen: 'BG 0917442 / E-2019-4471', hauptforderung: 3184.6, mahnkosten: 0,
    ratenhoehe: 42, ratenintervall: 'monatlich', status: 'Ratenzahlung',
    dauerauftrag: false, basisGezahlt: 1176,
    verwendungszweck: 'BG 0917442 Aufrechnung',
    notizen: 'Aufhebungs- und Erstattungsbescheid wegen verspätet angezeigter Beschäftigung 2019. Aufrechnung mit 10 % des Regelbedarfs direkt aus der Leistung; kein eigener Zahlungsvorgang.',
    raten: [['2025-01-01', 42], ['2025-02-01', 42], ['2025-03-01', 42], ['2025-04-01', 42], ['2025-05-01', 42], ['2025-06-01', 42], ['2025-07-01', 42], ['2025-08-01', 42], ['2025-09-01', 42], ['2025-10-01', 42], ['2025-11-01', 42], ['2025-12-01', 42], ['2026-01-01', 42], ['2026-02-01', 42], ['2026-03-01', 42], ['2026-04-01', 42], ['2026-05-01', 42], ['2026-06-01', 42], ['2026-07-01', 42], ['2026-08-01', 42]]
  }),
  L.schuld(F, 2, {
    erfasstAm: '2022-06-14', forderungsbeginn: '2021-05-01',
    glaeubiger: 'Vodafone GmbH / Inkasso Riverty GmbH', kategorie: 'Handyvertrag / Mobilfunk',
    aktenzeichen: 'RIV-2021-884471', hauptforderung: 1284.9, mahnkosten: 68.5,
    bearbeitungskosten: 40, prozesskosten: 0,
    ratenhoehe: 30, ratenintervall: 'monatlich', status: 'Ratenzahlung',
    dauerauftrag: true, basisGezahlt: 300,
    bankverbindung: { iban: 'DE87 3705 0198 0000 8844 71', bic: 'COLSDE33XXX', kontoinhaber: 'Riverty GmbH' },
    verwendungszweck: 'RIV-2021-884471 Kilic',
    notizen: 'Drei parallele Mobilfunkverträge in der akuten Phase 2021 abgeschlossen. Zwei Verträge wurden storniert, dieser blieb bestehen. Ratenvereinbarung vom 08.08.2022.',
    raten: [['2025-01-15', 30], ['2025-02-15', 30], ['2025-03-15', 30], ['2025-04-15', 30], ['2025-05-15', 30], ['2025-06-15', 30], ['2025-07-15', 30], ['2025-08-15', 30], ['2025-09-15', 30], ['2025-10-15', 30], ['2025-11-15', 30], ['2025-12-15', 30], ['2026-01-15', 30], ['2026-02-15', 30], ['2026-03-15', 30], ['2026-04-15', 30], ['2026-05-15', 30], ['2026-06-15', 30], ['2026-07-15', 30], ['2026-08-15', 30]]
  }),
  L.schuld(F, 3, {
    erfasstAm: '2022-06-14', forderungsbeginn: '2021-03-01',
    glaeubiger: 'Otto GmbH & Co KG', kategorie: 'Versandhandel / Online-Shop (z. B. Otto, Amazon, Klarna etc.)',
    aktenzeichen: 'OTT-90 447 122', hauptforderung: 2418.35, mahnkosten: 42,
    prozesskosten: 189.6,
    ratenhoehe: 25, ratenintervall: 'monatlich', status: 'tituliert',
    dauerauftrag: true, basisGezahlt: 450,
    verwendungszweck: 'OTT-90 447 122',
    notizen: 'Vollstreckungsbescheid des Amtsgerichts Mainz vom 14.02.2022. Elektronikbestellungen in der akuten Phase. Titel läuft bis 2052; Ratenzahlung vereinbart, keine Vollstreckung.',
    raten: [['2025-01-20', 25], ['2025-03-20', 25], ['2025-05-20', 25], ['2025-07-20', 25], ['2025-09-20', 25], ['2025-11-20', 25], ['2026-01-20', 25], ['2026-03-20', 25], ['2026-05-20', 25], ['2026-07-20', 25]]
  }),
  L.schuld(F, 4, {
    erfasstAm: '2022-07-05', forderungsbeginn: '2022-01-01',
    glaeubiger: 'Stadtwerke Bingen GmbH', kategorie: 'Stromschulden',
    aktenzeichen: 'SWB-22-114 908', hauptforderung: 894.2, mahnkosten: 15,
    status: 'erledigt', basisGezahlt: 909.2, erledigtAm: '2023-06-30',
    notizen: 'Sperrandrohung im Juni 2022. Direktzahlung aus dem Bürgergeld nach § 22 Abs. 8 SGB II beantragt und bewilligt; Rückstand bis Juni 2023 vollständig getilgt.'
  }),
  L.schuld(F, 5, {
    erfasstAm: '2023-04-11', forderungsbeginn: '2023-01-01',
    glaeubiger: 'Wohnbau Bingen GmbH', kategorie: 'Mietschulden',
    aktenzeichen: 'WB-2023-0447', hauptforderung: 1746.0, mahnkosten: 0,
    status: 'erledigt', basisGezahlt: 1746, erledigtAm: '2023-05-24',
    notizen: 'Mietrückstand aus der Zeit der Unterbringung Januar bis März 2023. Übernahme als Darlehen nach § 22 Abs. 8 SGB II; Kündigung der Wohnung damit abgewendet.'
  }),
  L.schuld(F, 6, {
    erfasstAm: '2024-05-02', forderungsbeginn: '2024-03-01',
    glaeubiger: 'Justizkasse Mainz', kategorie: 'Bußgelder / Verwarnungen (Ordnungsamt, Polizei)',
    aktenzeichen: 'JK 4471-2024-118', hauptforderung: 320, mahnkosten: 28.5,
    ratenhoehe: 20, ratenintervall: 'monatlich', status: 'Ratenzahlung',
    basisGezahlt: 120,
    verwendungszweck: 'JK 4471-2024-118',
    notizen: 'Bußgeld wegen Fahrens ohne Fahrschein (dreimal). Ratenzahlung bewilligt; Sozialticket beantragt, um Wiederholung zu vermeiden.',
    raten: [['2025-06-05', 20], ['2025-09-05', 20], ['2025-12-05', 20], ['2026-03-05', 20], ['2026-06-05', 20]]
  })
];

module.exports = {
  label: 'Kilic, Emre',
  fileNumber: '4 XVII 88/22',
  createdAt: '2022-05-24 11:05:00',
  betreuer: 'christoph zepp',
  uebersicht: { periodStart: '2026-07-01', aenderungsart: 'unverändert fortgeführt', uebergabeAn: '' },
  kontaktmonitor: { turnusDays: 60, baseline: '2026-06-16', lastContact: '2026-08-06', lastArt: 'persönlich (Hausbesuch)' },

  stammdaten: {
    person,
    care,
    rechtlicherBetreuer: 'christoph zepp',
    health: {
      careLevel: '', disabilityDegree: '50',
      marks: ['G'], marksText: 'G',
      copayExemption: 'ja, befreit bis 31.12.2026', valueMark: 'nein',
      insurer: 'Techniker Krankenkasse', insuranceNumber: 'T447122089'
    },
    healthInfo,
    benefits: [
      { category: 'Grundsicherung', basis: 'SGB II', benefitName: 'Bürgergeld (Regelbedarf und Kosten der Unterkunft)', applicationDate: '02.06.2022', validUntil: '31.03.2027', provider: 'Jobcenter Landkreis Mainz-Bingen', fileNumber: 'BG 0917442' },
      { category: 'Eingliederungshilfe', basis: 'SGB IX (Teil 2)', benefitName: 'Ambulant Betreutes Wohnen, 3,5 Fachleistungsstunden wöchentlich', applicationDate: '20.03.2023', validUntil: '31.12.2026', provider: 'Landesamt für Soziales, Jugend und Versorgung – Eingliederungshilfe', fileNumber: 'EGH 2023/4471' },
      { category: 'Schwerbehindertenrecht', basis: 'SGB IX', benefitName: 'GdB 50, Merkzeichen G', applicationDate: '14.09.2022', validUntil: '30.09.2027', provider: 'Landesamt für Soziales, Jugend und Versorgung Mainz', fileNumber: 'SB 2022/90 118' },
      { category: 'Rundfunk', basis: 'RBStV', benefitName: 'Befreiung vom Rundfunkbeitrag (Bürgergeldbezug)', applicationDate: '18.07.2022', validUntil: '31.03.2027', provider: 'ARD ZDF Deutschlandradio Beitragsservice', fileNumber: '512 447 108' },
      { category: 'Gesundheit', basis: 'SGB V', benefitName: 'Zuzahlungsbefreiung nach § 62 SGB V', applicationDate: '09.01.2026', validUntil: '31.12.2026', provider: 'Techniker Krankenkasse', fileNumber: 'T447122089' },
      { category: 'Mobilität', basis: 'Landesrecht RLP', benefitName: 'Deutschlandticket Sozial (ermäßigt)', applicationDate: '11.06.2024', validUntil: 'laufend', provider: 'Landkreis Mainz-Bingen', fileNumber: 'DT-S 2024/8814' }
    ],
    identifiers: [
      { type: 'Personalausweis', number: 'T22M9K4LX', validUntil: '09.02.2030', status: 'gültig' },
      { type: 'Steuerliche Identifikationsnummer', number: '61 204 887 351', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Rentenversicherungsnummer', number: '52 220893 K 044', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Krankenversichertennummer', number: 'T447122089', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Schwerbehindertenausweis', number: 'SB 2022/90 118', validUntil: '30.09.2027', status: 'gültig' },
      { type: 'Aktenzeichen / Geschäftszeichen', number: 'BG 0917442', validUntil: '31.03.2027', status: 'aktiv' },
      { type: 'Kunden-/Mitgliedsnummer', number: '512 447 108', validUntil: '31.03.2027', status: 'aktiv' },
      { type: 'Reisepass', number: 'C4471X22M', validUntil: '17.06.2027', status: 'gültig' }
    ],
    insurances: [
      { type: 'Gesundheitsversicherung (gesetzlich)', institution: 'Techniker Krankenkasse', number: 'T447122089', details: 'Pflichtversichert über den Bürgergeldbezug, zuzahlungsbefreit 2026' },
      { type: 'Pflegeversicherung', institution: 'TK Pflegeversicherung', number: 'T447122089-P', details: 'Kein Pflegegrad, Antrag bislang nicht gestellt' },
      { type: 'Privathatfplicht', institution: 'HUK-COBURG', number: 'HP 88 447 122', details: 'Jahresbeitrag 62,90 €, fällig 01.09., Direktzahlung aus dem Girokonto' },
      { type: 'Hausratversicherung', institution: 'HUK-COBURG', number: 'HR 88 447 123', details: 'Versicherungssumme 18.000 €, Jahresbeitrag 74,20 €' },
      { type: 'Rechtschutzversicherung', institution: 'ARAG SE', number: 'RS 22-114-908', details: 'Zum 31.12.2022 gekündigt, Beitrag nicht tragbar' }
    ],
    banks: [
      { type: 'P-Konto', institution: 'Sparkasse Rhein-Nahe', bankName: 'Sparkasse Rhein-Nahe', iban: 'DE13 5605 0180 0004 4712 20', bic: 'MALADE51KRE', accountHolder: 'Emre Kilic', saldo: '218,44', saldoDatum: '31.07.2026', verwendungszweck: 'Pfändungsschutzkonto seit 12.07.2022, Grundfreibetrag bescheinigt', connectionId: '' },
      { type: 'Basiskonto', institution: 'Sparkasse Rhein-Nahe', bankName: 'Sparkasse Rhein-Nahe', iban: 'DE41 5605 0180 0004 4712 21', bic: 'MALADE51KRE', accountHolder: 'Emre Kilic', saldo: '640,00', saldoDatum: '31.07.2026', verwendungszweck: 'Nebenkonto für Rücklagen (Kaution, Zahnersatz)', connectionId: '' }
    ],
    budget: { type: 'Wochengeld', amount: '90,00', method: 'Überweisung' },
    assetManagement: [
      { type: 'Wochengeld', amount: '90,00', method: 'Überweisung' },
      { type: 'Barbetrag', amount: '40,00', method: 'Bar an die betreute Person' }
    ],
    accommodation: {
      type: 'Eigene Wohnung (zur Miete)',
      currentResidence: {
        sameAsRegistered: true,
        institution: '', type: 'eigene Häuslichkeit',
        street: 'Gutenbergstraße', houseNumber: '14', houseLetter: 'b',
        postalCode: '55411', city: 'Bingen am Rhein', postbox: '', foreignCity: '', country: 'Deutschland'
      },
      monthlyCost: '464,00', serviceCosts: '118,00', electricityCosts: '61,00', gasCosts: '',
      basicRent: '464,00', heatingCosts: '84,00', heatingType: 'Gasheizung',
      hotWater: 'Zentral (über Heizung)', hotWaterPreparation: 'Zentral (über Heizung)', heating: 'Gasheizung',
      housingSecurity: { status: 'secured', details: 'Unbefristeter Mietvertrag seit 01.09.2019, Kündigung 2023 abgewendet' },
      accessibility: { status: 'partial', details: '2. Obergeschoss ohne Aufzug; für Herrn Kilic ohne Einschränkung nutzbar' },
      currentProblems: { status: 'none', details: 'Derzeit keine' },
      supportForms: ['Ambulant Betreutes Wohnen', 'Sozialpsychiatrischer Dienst', 'Psychotherapie', 'Suchtberatung'],
      supportDetails: 'Ambulant Betreutes Wohnen über den Verein Betreutes Wohnen Rheinhessen mit 3,5 Fachleistungsstunden wöchentlich (Bezugsbetreuung Frau Wehrle). Wöchentliche Verhaltenstherapie bei Frau Lindqvist. Suchtberatung der Caritas alle vier Wochen. Der Sozialpsychiatrische Dienst ist als Krisenanlaufstelle eingebunden.',
      housingSecurityEntries: [
        L.wohnEintrag(F, 'security', 1, { von: '2022-05-24', bis: '2023-01-18', status: 'secured', details: 'Mietvertrag seit 01.09.2019, keine Rückstände zum Betreuungsbeginn.' }),
        L.wohnEintrag(F, 'security', 2, { von: '2023-01-19', bis: '2023-05-24', status: 'at_risk', details: 'Mietrückstand von 1.746 € während der Unterbringung; fristlose Kündigung der Wohnbau Bingen vom 03.04.2023.' }),
        L.wohnEintrag(F, 'security', 3, { von: '2023-05-25', status: 'secured', details: 'Kündigung nach Darlehensübernahme durch das Jobcenter zurückgenommen; Mietverhältnis ungestört fortgeführt.', stand: '2026-08-06' })
      ],
      accessibilityEntries: [
        L.wohnEintrag(F, 'accessibility', 1, { von: '2022-05-24', status: 'partial', details: 'Wohnung im 2. Obergeschoss ohne Aufzug. Für Herrn Kilic derzeit ohne Bedeutung; bei Mobilitätseinschränkung wäre ein Wechsel nötig.', stand: '2026-06-16' })
      ],
      currentProblemEntries: [
        L.wohnEintrag(F, 'problems', 1, { von: '2023-01-19', bis: '2023-06-30', status: 'present', details: 'Verwahrlosung der Wohnung während der akuten Phase; Grundreinigung durch die Bezugsbetreuung organisiert. Stromsperre angedroht.' }),
        L.wohnEintrag(F, 'problems', 2, { von: '2024-02-26', bis: '2024-06-30', status: 'present', details: 'Erneuter Rückzug und Vermüllung nach Rückfall; Unterstützung durch das Betreute Wohnen intensiviert.' }),
        L.wohnEintrag(F, 'problems', 3, { von: '2024-07-01', status: 'none', details: 'Wohnung wird selbstständig in Ordnung gehalten, Reinigungsplan mit der Bezugsbetreuung eingeführt.', stand: '2026-08-06' })
      ],
      supportEntries: [
        L.wohnEintrag(F, 'support', 1, { von: '2023-04-01', status: 'active', formen: ['Ambulant Betreutes Wohnen'], details: '3,5 Fachleistungsstunden wöchentlich, Bezugsbetreuung Frau Wehrle. Schwerpunkte: Haushalt, Tagesstruktur, Medikamentenerinnerung.', stand: '2026-08-06' }),
        L.wohnEintrag(F, 'support', 2, { von: '2024-05-06', status: 'active', formen: ['Psychotherapie'], details: 'Verhaltenstherapie, 60 Sitzungen bewilligt, Frau Lindqvist.', stand: '2026-03-11' }),
        L.wohnEintrag(F, 'support', 3, { von: '2024-03-18', status: 'active', formen: ['Suchtberatung'], details: 'Caritas-Suchtberatung Bingen, vierwöchentlich; Cannabisabstinenz seit 03/2024.', stand: '2026-08-06' }),
        L.wohnEintrag(F, 'support', 4, { von: '2022-06-01', bis: '2023-03-31', status: 'ended', formen: ['Sozialpsychiatrischer Dienst'], details: 'Aufsuchende Begleitung vor Beginn des Betreuten Wohnens.' })
      ]
    },
    provisions: L.vorsorge([
      ['patientenverfuegung', 'In Vorbereitung', '--'],
      ['betreuungsverfuegung', 'Nicht vorhanden', '--'],
      ['vorsorgevollmacht', 'Nicht vorhanden', '--'],
      ['testament', 'Nicht vorhanden', '--'],
      ['vorsorgeregister', 'Nicht vorhanden', '--'],
      ['kontovollmacht', 'Nicht vorhanden', '--'],
      ['organspende', 'Vorhanden', '--'],
      ['digitaler_nachlass', 'Hinterlegt', '--'],
      ['sonstiges_vorsorge', 'Vorhanden', 'BV-AZ-2023-118']
    ]),
    socialNetwork: [
      { status: 'Aktiv', role: 'Mutter', detail: 'Mutter', salutation: 'Sehr geehrte Frau', firstName: 'Ayla', lastName: 'Kilic', institution: '', street: 'Wilhelmstraße', house: '9', postal: '55218', city: 'Ingelheim am Rhein', phone: '06132 / 447291', mobile: '0176 / 22884471', email: 'ayla.kilic@example-mail.de', fullName: 'Ayla Kilic', address: 'Wilhelmstraße 9, 55218 Ingelheim am Rhein', birthDate: '04.02.1965' },
      { status: 'Aktiv', role: 'Schwester', detail: 'Schwester', salutation: 'Sehr geehrte Frau', firstName: 'Derya', lastName: 'Kilic-Baumann', institution: '', street: 'Rheinstraße', house: '52', postal: '55116', city: 'Mainz', phone: '', mobile: '0151 / 44712208', email: 'derya.kb@example-mail.de', fullName: 'Derya Kilic-Baumann', address: 'Rheinstraße 52, 55116 Mainz', birthDate: '30.05.1990' },
      { status: 'Beendet', role: 'Vater', detail: 'Vater, kein Kontakt seit 2018', salutation: 'Sehr geehrter Herr', firstName: 'Mehmet', lastName: 'Kilic', institution: '', street: '', house: '', postal: '', city: 'Izmir', phone: '', mobile: '', email: '', fullName: 'Mehmet Kilic', address: 'Izmir, Türkei' },
      { status: 'Aktiv', role: 'Betreuung', detail: 'Ambulante Bezugsbetreuung', salutation: 'Sehr geehrte Frau', firstName: 'Nicole', lastName: 'Wehrle', institution: 'Betreutes Wohnen Rheinhessen e. V.', street: 'Rochusallee', house: '7', postal: '55411', city: 'Bingen am Rhein', phone: '06721 / 443015', mobile: '0170 / 8844712', email: 'wehrle@bewo-rheinhessen.de', fullName: 'Nicole Wehrle', address: 'Rochusallee 7, 55411 Bingen am Rhein' },
      { status: 'Aktiv', role: 'Freund:in', detail: 'Freund aus der Selbsthilfegruppe', salutation: 'Sehr geehrter Herr', firstName: 'Tobias', lastName: 'Grunwald', institution: '', street: 'Vorstadt', house: '31', postal: '55411', city: 'Bingen am Rhein', phone: '', mobile: '0160 / 44718820', email: '', fullName: 'Tobias Grunwald', address: 'Vorstadt 31, 55411 Bingen am Rhein' },
      { status: 'Aktiv', role: 'Verein (Freizeit)', detail: 'Selbsthilfegruppe Psychose-Erfahrene', salutation: 'Sehr geehrte Damen und Herren', firstName: '', lastName: '', institution: 'Selbsthilfegruppe „Rheinlicht" im Haus der Begegnung', street: 'Freidhof', house: '10', postal: '55411', city: 'Bingen am Rhein', phone: '06721 / 990244', mobile: '', email: 'rheinlicht@shg-bingen.de', fullName: 'Selbsthilfegruppe „Rheinlicht"', address: 'Freidhof 10, 55411 Bingen am Rhein' },
      { status: 'Aktiv', role: 'Betreuung', detail: 'rechtliche Betreuung', salutation: 'Sehr geehrter Herr', firstName: 'Christoph', lastName: 'Zepp', institution: 'Testbüroname', street: 'Marktplatz', house: '8', postal: '56346', city: 'St. Goarshausen', phone: '06771 / 959410', mobile: '', email: 'kanzlei@testbueroname.de', fullName: 'Christoph Zepp', address: 'Marktplatz 8, 56346 St. Goarshausen' }
    ],
    contactProfile: {
      understanding: 'good',
      trust: 'good',
      cooperation: 'variable',
      participation: 'active',
      conflicts: 'occasional',
      assessedAt: '2026-06-16',
      communicationMethods: ['spoken', 'writing'],
      communicationSupport: 'Im stabilen Zustand ist keine besondere Unterstützung erforderlich. Herr Kilic liest Schriftstücke selbst und stellt gezielte Rückfragen. In belasteten Phasen hilft es, Termine schriftlich per Kurznachricht zu bestätigen und Behördenpost gemeinsam durchzugehen.',
      conflictDescription: 'Gelegentliche Konflikte über die Höhe des wöchentlichen Auszahlungsbetrages und über den Einwilligungsvorbehalt. Herr Kilic empfindet den Vorbehalt als bevormundend, erkennt aber im Rückblick auf die Vertragsabschlüsse von 2021 dessen Zweck an. Die Konflikte werden sachlich ausgetragen und enden regelmäßig mit einer Verständigung.',
      evidenceSource: 'Hausbesuche am 16.06.2026 und 06.08.2026, Rückmeldung der Bezugsbetreuung Frau Wehrle, Stellungnahme Dr. Hüttenberger vom 05.08.2026',
      canInitiateContact: 'ja',
      initiationSupport: 'Keine Unterstützung erforderlich; Herr Kilic meldet sich telefonisch oder per Kurznachricht',
      initiationChannels: ['mobile', 'email', 'in_person'],
      initiationLimitationReason: '',
      reportRemarks: 'Herr Kilic nimmt eigenständig Kontakt auf, meist per Kurznachricht, und hält vereinbarte Termine zuverlässig ein. Die Zusammenarbeit ist im stabilen Zustand partnerschaftlich; er trifft Entscheidungen selbst und lässt sich beraten. In akuten Phasen bricht der Kontakt ab, dann läuft die Verständigung über die Bezugsbetreuung des Betreuten Wohnens. Persönliche Kontakte finden etwa alle acht Wochen als Hausbesuch statt.'
    },
    handkasse: L.handkasse(F, [
      ['2026-03-02', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 10', 'Barbetrag', 90],
      ['2026-03-09', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 11', 'Barbetrag', 90],
      ['2026-03-11', 'ausgabe', 'Praxis Lindqvist', 'Fahrtkosten Therapie (Bus)', 'Fahrkarte ÖPNV / Deutschlandticket', 6.4],
      ['2026-03-16', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 12', 'Barbetrag', 90],
      ['2026-03-23', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 13', 'Barbetrag', 90],
      ['2026-03-28', 'ausgabe', 'Severus-Drogerie Bingen', 'Hygieneartikel und Waschmittel', 'Pflegeprodukte (Inkontinenzmaterial, Pflegemittel)', 24.8],
      ['2026-04-06', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 15', 'Barbetrag', 90],
      ['2026-04-14', 'ausgabe', 'Zahnarztpraxis Dr. Ohlmann', 'Eigenanteil Zahnreinigung', 'Zahnersatz / Brille / Hörgeräte (Eigenanteil)', 45],
      ['2026-04-20', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 17', 'Barbetrag', 90],
      ['2026-04-23', 'ausgabe', 'MVZ Mainz-West', 'Fahrtkosten Gastroskopie', 'Einzelfahrscheine / Taxi', 18.6],
      ['2026-05-04', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 19', 'Barbetrag', 90],
      ['2026-05-11', 'ausgabe', 'Sport 2000 Bingen', 'Laufschuhe (Bewegungsprogramm)', 'Kleidung / Schuhe', 79.9],
      ['2026-05-18', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 21', 'Barbetrag', 90],
      ['2026-06-01', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 23', 'Barbetrag', 90],
      ['2026-06-16', 'ausgabe', 'Emre Kilic', 'Barauszahlung bei Hausbesuch', 'Taschengeldzahlungen an Angehörige (falls vereinbart)', 40],
      ['2026-06-22', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 26', 'Barbetrag', 90],
      ['2026-07-06', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 28', 'Barbetrag', 90],
      ['2026-07-13', 'ausgabe', 'Selbsthilfegruppe Rheinlicht', 'Beitrag Sommerausflug', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 15],
      ['2026-07-20', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 30', 'Barbetrag', 90],
      ['2026-08-03', 'einnahme', 'Sparkasse Rhein-Nahe', 'Wochengeld KW 32', 'Barbetrag', 90],
      ['2026-08-06', 'ausgabe', 'Emre Kilic', 'Barauszahlung bei Hausbesuch', 'Taschengeldzahlungen an Angehörige (falls vereinbart)', 40]
    ]),
    assets: {
      begin: L.posten(F, 'vab', [
        ['Bargeld', 'Bargeldbestand bei Betreuungsübernahme', '', 35],
        ['Girokonto', 'Kontostand 24.05.2022, vor Umstellung auf P-Konto', 'Sparkasse Rhein-Nahe', -412.8],
        ['Rückzahlungsansprüche (z. B. aus Kautionen, Mietkaution)', 'Mietkaution Wohnbau Bingen, Kautionssparbuch', 'Sparkasse Rhein-Nahe', 1392],
        ['Wertvolle Möbel / Haushaltsgeräte (sofern von Bedeutung)', 'Wohnungseinrichtung, Schätzwert', '', 1800],
        ['Pkw / Motorrad / Wohnmobil / Anhänger / Boot', 'Roller Piaggio, Baujahr 2014, abgemeldet', '', 450]
      ]),
      end: L.posten(F, 'vae', [
        ['P-Konto', 'Kontostand 31.07.2026', 'Sparkasse Rhein-Nahe', 218.44],
        ['Basiskonto', 'Rücklagenkonto (Kaution, Zahnersatz)', 'Sparkasse Rhein-Nahe', 640],
        ['Rückzahlungsansprüche (z. B. aus Kautionen, Mietkaution)', 'Mietkaution Wohnbau Bingen, verzinst', 'Sparkasse Rhein-Nahe', 1441.2],
        ['Wertvolle Möbel / Haushaltsgeräte (sofern von Bedeutung)', 'Wohnungseinrichtung, Schätzwert', '', 2100],
        ['Bargeld', 'Barbestand nach Hausbesuch 06.08.2026', '', 40]
      ]),
      debtsBegin: [
        ...L.posten(F, 'vsb', [
          ['Dispokredit / Kontoüberziehung', 'Überziehung Girokonto bei Betreuungsbeginn', 'Sparkasse Rhein-Nahe', 412.8]
        ]),
        ...L.schuldenSpiegel(schulden, 'begin')
      ],
      debtsEnd: [
        ...L.posten(F, 'vse', []),
        ...L.schuldenSpiegel(schulden, 'end')
      ]
    },
    livelihood: {
      income: L.einnahmen(F, [
        ['Bürgergeld (früher ALG II)', 'Regelbedarf Alleinstehender, abzüglich Aufrechnung 10 %', 'Jobcenter Landkreis Mainz-Bingen', 'monatlich', 466.2],
        ['Bürgergeld (früher ALG II)', 'Bedarf für Unterkunft und Heizung (Direktzahlung an den Vermieter)', 'Jobcenter Landkreis Mainz-Bingen', 'monatlich', 582],
        ['Geldleistungen aus der Eingliederungshilfe (z. B. Persönliches Budget)', 'Fachleistungsstunden Betreutes Wohnen (Sachleistung, kein Zahlbetrag)', 'Landesamt für Soziales, Jugend und Versorgung', 'monatlich', 0],
        ['Regelmäßige freiwillige Zuwendungen / Taschengeld von Angehörigen', 'Zuwendung der Mutter zum Geburtstag und zu Feiertagen', 'Ayla Kilic', 'jährlich', 12.5]
      ]),
      expenses: L.ausgaben(F, [
        ['Miete', 'Grundmiete Gutenbergstraße 14b, Direktzahlung durch das Jobcenter', 'Wohnbau Bingen GmbH', 'monatlich', 464, 'Laufende Kosten'],
        ['Nebenkosten / Betriebskosten (Hausgeld, Hausmeister, Müll etc.)', 'Betriebskostenvorauszahlung', 'Wohnbau Bingen GmbH', 'monatlich', 118, 'Laufende Kosten'],
        ['Strom', 'Abschlag Stromlieferung, Direktzahlung nach § 22 Abs. 8 SGB II', 'Stadtwerke Bingen GmbH', 'monatlich', 61, 'Laufende Kosten'],
        ['Handyvertrag / Prepaid-Aufladung', 'Mobilfunk-Basistarif', 'Congstar', 'monatlich', 12, 'Laufende Kosten'],
        ['Haftpflichtversicherung', 'Privathaftpflicht, Jahresbeitrag umgelegt', 'HUK-COBURG', 'jährlich', 5.24, 'Laufende Kosten'],
        ['Hausratversicherung', 'Jahresbeitrag umgelegt', 'HUK-COBURG', 'jährlich', 6.18, 'Laufende Kosten'],
        ['Fahrkarte ÖPNV / Deutschlandticket', 'Deutschlandticket Sozial', 'Landkreis Mainz-Bingen', 'monatlich', 29, 'Laufende Kosten'],
        ['Inkasso-Ratenzahlungen', 'Rate Riverty (Mobilfunkforderung)', 'Riverty GmbH', 'monatlich', 30, 'Ratenzahlungsvereinbarung geschlossen'],
        ['Ratenzahlung Versandhandel / Möbelhaus / Elektronikmarkt', 'Rate Otto GmbH, tituliert', 'Otto GmbH & Co KG', 'vierteljährlich', 8.33, 'Mahnbescheid / Vollstreckungsbescheid'],
        ['Rückzahlungsvereinbarungen mit Behörden (Jobcenter, Sozialamt, Familienkasse etc.)', 'Aufrechnung Erstattungsforderung', 'Jobcenter Landkreis Mainz-Bingen', 'monatlich', 42, 'Laufende Kosten'],
        ['Ratenkredite (Bankkredit, Konsumkredit)', 'Rate Justizkasse (Bußgeld)', 'Justizkasse Mainz', 'vierteljährlich', 6.67, 'Ratenzahlungsvereinbarung geschlossen'],
        ['Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 'Selbsthilfegruppe und Freizeit', '', 'monatlich', 20, '']
      ])
    },
    schuldenregulierung: schulden,
    approvals: L.genehmigungen(F, [
      ['2023-01-19', 'Freiheitsentziehende Unterbringung (§ 1831 BGB)', 'Geschlossene Unterbringung in der Rheinhessen-Fachklinik Alzey wegen akuter Eigengefährdung bei paranoider Psychose', 'Widerstand', 'genehmigt', '2023-01-20', '2023-01-19', 'Einstweilige Anordnung vom 20.01.2023, Hauptsachebeschluss vom 02.02.2023, befristet bis 15.03.2023. Herr Kilic widersprach der Aufnahme ausdrücklich. Anhörung durch die Richterin in der Klinik am 25.01.2023, Verfahrenspflegerin bestellt.'],
      ['2023-02-27', 'Freiheitsentziehende Unterbringung (§ 1831 BGB)', 'Verlängerung der Unterbringung um vier Wochen', 'Beratungsbedarf', 'abgelehnt', '2023-03-06', '', 'Verlängerungsantrag nach Rücksprache mit der Station zurückgenommen, weil Herr Kilic der Depotmedikation zustimmte und eine offene Weiterbehandlung möglich war. Entlassung am 08.03.2023.'],
      ['2023-03-20', 'Sonstiges', 'Abschluss einer Behandlungsvereinbarung mit der Rheinhessen-Fachklinik Alzey', 'Einwilligung', 'erledigt', '', '2023-03-03', 'Keine gerichtliche Genehmigung erforderlich. Herr Kilic hat die Vereinbarung selbst unterzeichnet; sie regelt Ansprechpersonen, Medikation und Vorgehen im Krisenfall.'],
      ['2023-04-14', 'Sonstiges', 'Aufnahme eines Darlehens nach § 22 Abs. 8 SGB II zur Übernahme der Mietschulden von 1.746 €', 'Einwilligung', 'genehmigt', '2023-05-09', '2023-05-24', 'Darlehen des Jobcenters; Genehmigung nach § 1854 Nr. 3 BGB eingeholt. Tilgung durch Aufrechnung von 5 % des Regelbedarfs, seit 03/2025 vollständig getilgt.'],
      ['2024-03-05', 'Heimvertrag / Wechsel der Wohnform', 'Prüfung eines Wechsels in eine stationäre sozialtherapeutische Wohnform nach dem Rückfall', 'Widerstand', 'abgelehnt', '', '', 'Herr Kilic lehnte den Wechsel entschieden ab. Nach Erörterung mit Klinik und Betreutem Wohnen wurde stattdessen die ambulante Unterstützung von 2 auf 3,5 Fachleistungsstunden erhöht. Der Wille wurde beachtet; die Entscheidung hat sich als tragfähig erwiesen.'],
      ['2026-05-12', 'Sonstiges', 'Abschluss einer Patientenverfügung und Behandlungsvereinbarung auf eigenen Wunsch', 'Einwilligung', 'offen', '', '', 'Herr Kilic möchte für künftige Krisen selbst festlegen, welche Medikation er wünscht und welche nicht. Entwurf gemeinsam mit Frau Lindqvist erarbeitet; noch nicht unterzeichnet.']
    ]),
    fristen: L.fristen(F, [
      ['Weiterbewilligungsantrag Bürgergeld ab 01.04.2027', 'Weiterbewilligung', 'Jobcenter Landkreis Mainz-Bingen', '2027-03-31', '2027-02-28', 'high', 'offen', 'Bewilligungsabschnitt endet am 31.03.2027; Antrag spätestens einen Monat vorher.'],
      ['Jahresbericht 01.06.2025 – 31.05.2026 an das Betreuungsgericht', 'Bericht', 'Amtsgericht Bingen am Rhein', '2026-05-31', '2026-06-30', 'high', 'erledigt', 'Eingereicht am 24.06.2026, Eingangsbestätigung liegt vor.'],
      ['Fortschreibung Gesamtplan Eingliederungshilfe', 'Antrag', 'Landesamt für Soziales, Jugend und Versorgung', '2026-12-31', '2026-10-31', 'high', 'offen', 'Bewilligung der Fachleistungsstunden läuft zum 31.12.2026 aus; Teilhabeplankonferenz beantragen.'],
      ['Widerspruch gegen Betriebskostenabrechnung 2025', 'Widerspruch', 'Wohnbau Bingen GmbH', '2026-07-18', '2026-08-31', 'high', 'offen', 'Nachforderung von 384,20 €. Prüfung durch den Mieterverein ergab Fehler bei der Heizkostenverteilung.'],
      ['Verlängerung Zuzahlungsbefreiung 2027', 'Antrag', 'Techniker Krankenkasse', '2026-12-31', '2026-12-05', 'normal', 'offen', 'Bürgergeldbescheid als Nachweis beifügen.'],
      ['Vergütungsantrag 3. Quartal 2026 (VBVG)', 'Sonstige', 'Amtsgericht Bingen am Rhein', '2026-08-31', '2026-09-15', 'normal', 'offen', 'Mittellose Betreute, Zahlung aus der Staatskasse, Wohnform: eigene Häuslichkeit.'],
      ['Verlängerung Schwerbehindertenausweis', 'Antrag', 'Landesamt für Soziales, Jugend und Versorgung Mainz', '2027-09-30', '2027-07-31', 'normal', 'offen', 'Ausweis gültig bis 30.09.2027, Verlängerung drei Monate vorher.'],
      ['Patientenverfügung fertigstellen und unterzeichnen', 'Sonstige', '', '2026-05-12', '2026-10-30', 'normal', 'offen', 'Entwurf liegt vor; Termin mit Frau Lindqvist und Dr. Hüttenberger vereinbaren.']
    ]),
    goalDecisionPlanning: L.planung(F, [
      {
        typ: 'goal', titel: 'Wohnung dauerhaft sichern', bereich: 'Wohnen',
        beschreibung: 'Die Wohnung in der Gutenbergstraße ist der wichtigste Stabilitätsanker. Mietzahlungen laufen als Direktzahlung über das Jobcenter, Rückstände sollen nicht mehr entstehen.',
        status: 'Erreicht', prioritaet: 'Dringend', zustaendig: 'Christoph Zepp',
        angelegt: '2023-04-05', stand: '2026-08-06', zieldatum: '2023-06-30', pruefdatum: '2027-01-31',
        quelle: 'Fristlose Kündigung der Wohnbau Bingen vom 03.04.2023', favorit: true,
        module: ['doku', 'approval', 'deadline'], fortschritt: 100,
        smart: {
          formulation: 'Die Kündigung wird bis zum 30.06.2023 zurückgenommen und ab Juli 2023 entstehen keine neuen Mietrückstände.',
          specific: 'Rückstand 1.746 € ausgleichen, Direktzahlung an den Vermieter einrichten',
          measurable: 'Rücknahmeerklärung der Wohnbau, monatlicher Abgleich der Mietzahlung',
          attractive: 'Herr Kilic möchte unbedingt in seiner Wohnung bleiben',
          realistic: 'Darlehen nach § 22 Abs. 8 SGB II ist vorgesehen',
          timeBound: 'bis 30.06.2023, danach jährliche Kontrolle'
        },
        verlauf: [
          ['2023-04-05', 'Eintrag angelegt', 'Nach Zugang der Kündigung'],
          ['2023-05-24', 'Eintrag bearbeitet', 'Darlehen bewilligt, Rückstand ausgeglichen'],
          ['2023-06-14', 'Eintrag abgeschlossen', 'Kündigung zurückgenommen'],
          ['2026-08-06', 'Eintrag geprüft', 'Seit drei Jahren keine Rückstände']
        ]
      },
      {
        typ: 'need', titel: 'Entschuldung und Übersicht über die Forderungen', bereich: 'Finanzen & Vermögen',
        beschreibung: 'Sechs Forderungen aus der akuten Phase 2021/2022 mit ursprünglich rund 9.900 €. Ziel ist ein geordneter Abbau ohne Vollstreckung und ohne Verlust des P-Kontos.',
        status: 'In Bearbeitung', prioritaet: 'Hoch', zustaendig: 'Christoph Zepp',
        angelegt: '2022-06-14', stand: '2026-08-06', zieldatum: '2029-12-31', pruefdatum: '2026-12-31',
        quelle: 'Gläubigeranschreiben nach Betreuungsbeginn', module: ['doku', 'deadline'], fortschritt: 55,
        verlauf: [
          ['2022-06-14', 'Eintrag angelegt', 'Sechs Gläubiger ermittelt'],
          ['2023-06-30', 'Eintrag bearbeitet', 'Stromschulden vollständig getilgt'],
          ['2025-03-31', 'Eintrag bearbeitet', 'Mietdarlehen getilgt'],
          ['2026-08-06', 'Eintrag bearbeitet', 'Restforderungen rund 4.500 €, alle in Ratenzahlung']
        ]
      },
      {
        typ: 'measure', titel: 'Depotmedikation verlässlich sicherstellen', bereich: 'Gesundheit & Pflege',
        beschreibung: 'Die vierwöchige Depotgabe ist der entscheidende Faktor für die Stabilität. Termine werden im Kalender geführt, die Bezugsbetreuung erinnert zwei Tage vorher.',
        status: 'In Bearbeitung', prioritaet: 'Dringend', zustaendig: 'Nicole Wehrle / Dr. Hüttenberger',
        angelegt: '2023-03-10', stand: '2026-08-05', zieldatum: '', pruefdatum: '2026-12-31',
        quelle: 'Entlassbericht Rheinhessen-Fachklinik vom 08.03.2023', favorit: true,
        module: ['doku', 'calendar', 'task'], fortschritt: 90,
        verlauf: [
          ['2023-03-10', 'Eintrag angelegt', 'Nach Umstellung auf Paliperidon-Depot'],
          ['2024-03-01', 'Eintrag bearbeitet', 'Zwei versäumte Termine im Februar 2024, Rückfall'],
          ['2026-08-05', 'Eintrag geprüft', 'Seit 04/2024 kein Termin mehr versäumt']
        ]
      },
      {
        typ: 'wish', titel: 'Wieder arbeiten gehen', bereich: 'Arbeit, Bildung & Teilhabe',
        beschreibung: 'Herr Kilic möchte eine Tätigkeit aufnehmen, am liebsten wieder im Lager oder in der Logistik. Er lehnt eine Werkstatt für behinderte Menschen ab und wünscht sich den allgemeinen Arbeitsmarkt.',
        aussage: '„Ich will nicht den ganzen Tag rumsitzen. Ich will arbeiten, aber nicht in einer Werkstatt."',
        status: 'In Bearbeitung', prioritaet: 'Hoch', zustaendig: 'Emre Kilic',
        angelegt: '2024-09-16', stand: '2026-07-02', zieldatum: '2027-06-30', pruefdatum: '2026-12-15',
        quelle: 'Gespräch beim Hausbesuch am 16.09.2024', favorit: true,
        module: ['doku', 'task', 'calendar'], fortschritt: 45,
        verlauf: [
          ['2024-09-16', 'Eintrag angelegt', 'Wunsch nach Beschäftigung geäußert'],
          ['2025-05-19', 'Eintrag bearbeitet', 'Beratung beim Integrationsfachdienst aufgenommen'],
          ['2026-07-02', 'Eintrag bearbeitet', 'Praktikum bei der Tafel Bingen, zwei Vormittage wöchentlich']
        ]
      },
      {
        typ: 'decision', titel: 'Kein Wechsel in eine stationäre Wohnform', bereich: 'Wohnen',
        beschreibung: 'Nach dem Rückfall im Frühjahr 2024 wurde ein Wechsel in eine sozialtherapeutische Wohneinrichtung erwogen. Herr Kilic hat dies entschieden abgelehnt. Die Entscheidung fiel für den Verbleib in der eigenen Wohnung bei erhöhter ambulanter Unterstützung.',
        status: 'Abgeschlossen', prioritaet: 'Hoch', zustaendig: 'Christoph Zepp',
        angelegt: '2024-03-05', stand: '2024-04-19', zieldatum: '2024-04-19', pruefdatum: '2026-12-31',
        quelle: 'Anregung der Tagesklinik, Fallkonferenz vom 18.03.2024',
        module: ['doku', 'approval'], fortschritt: 100,
        verlauf: [
          ['2024-03-05', 'Eintrag angelegt', 'Anregung der Tagesklinik'],
          ['2024-03-18', 'Eintrag bearbeitet', 'Fallkonferenz mit Klinik, Betreutem Wohnen und Mutter'],
          ['2024-04-19', 'Eintrag abgeschlossen', 'Verbleib in der Wohnung, Fachleistungsstunden von 2 auf 3,5 erhöht']
        ]
      },
      {
        typ: 'goal', titel: 'Cannabisabstinenz halten', bereich: 'Gesundheit & Pflege',
        beschreibung: 'Der Rückfall im Februar 2024 stand in unmittelbarem Zusammenhang mit erneutem Cannabiskonsum. Herr Kilic hat sich selbst zur Abstinenz entschieden und nutzt die Suchtberatung der Caritas.',
        status: 'In Bearbeitung', prioritaet: 'Hoch', zustaendig: 'Emre Kilic',
        angelegt: '2024-03-18', stand: '2026-08-06', zieldatum: '', pruefdatum: '2026-11-30',
        quelle: 'Eigene Entscheidung, Suchtberatung Caritas',
        module: ['doku'], fortschritt: 85,
        verlauf: [
          ['2024-03-18', 'Eintrag angelegt', 'Nach dem Rückfall'],
          ['2025-03-18', 'Eintrag bearbeitet', 'Ein Jahr abstinent'],
          ['2026-08-06', 'Eintrag geprüft', 'Weiterhin abstinent, Selbsthilfegruppe wird genutzt']
        ]
      },
      {
        typ: 'review', titel: 'Einwilligungsvorbehalt überprüfen', bereich: 'Behörden & Recht',
        beschreibung: 'Der Einwilligungsvorbehalt für die Vermögenssorge wurde 2022 wegen der Vertragsabschlüsse in der akuten Phase angeordnet. Seit drei Jahren sind keine neuen Verbindlichkeiten entstanden. Zu prüfen ist, ob er aufgehoben oder auf Verträge über 200 € beschränkt werden kann.',
        status: 'Zur Prüfung', prioritaet: 'Normal', zustaendig: 'Christoph Zepp',
        angelegt: '2026-06-16', stand: '2026-08-06', zieldatum: '2026-11-30', pruefdatum: '2026-11-30',
        quelle: 'Anregung von Herrn Kilic beim Hausbesuch am 16.06.2026',
        module: ['doku', 'deadline'], fortschritt: 30,
        verlauf: [
          ['2026-06-16', 'Eintrag angelegt', 'Herr Kilic regt die Aufhebung an'],
          ['2026-08-05', 'Eintrag bearbeitet', 'Stellungnahme Dr. Hüttenberger eingeholt: Beschränkung befürwortet']
        ]
      },
      {
        typ: 'need', titel: 'Zahnsanierung abschließen', bereich: 'Gesundheit & Pflege',
        beschreibung: 'Nach jahrelanger Vernachlässigung war eine umfangreiche Zahnsanierung erforderlich. Der Eigenanteil wird über das Rücklagenkonto angespart.',
        status: 'Abgeschlossen', prioritaet: 'Normal', zustaendig: 'Emre Kilic',
        angelegt: '2025-08-11', stand: '2026-04-14', zieldatum: '2026-03-31', pruefdatum: '2026-09-30',
        quelle: 'Hausbesuch 11.08.2025, Zahnschmerzen',
        module: ['doku', 'task'], fortschritt: 100,
        verlauf: [
          ['2025-08-11', 'Eintrag angelegt', 'Behandlungsbedarf festgestellt'],
          ['2025-11-18', 'Eintrag bearbeitet', 'Drei Füllungen abgeschlossen, Härtefallregelung bewilligt'],
          ['2026-04-14', 'Eintrag abgeschlossen', 'Prophylaxe etabliert, halbjährliche Kontrolle vereinbart']
        ]
      }
    ]),
    accounting: L.rechnungslegung(F, {
      von: '2025-06-01', bis: '2026-05-31',
      konten: [
        { name: 'P-Konto (Verwaltungskonto)', art: 'P-Konto', bank: 'Sparkasse Rhein-Nahe', inhaber: 'Emre Kilic', iban: 'DE13 5605 0180 0004 4712 20', bic: 'MALADE51KRE', anfang: 184.9, ende: 218.44, einnahmen: 12580.4, ausgaben: 12546.86 },
        { name: 'Basiskonto (Rücklagen)', art: 'Basiskonto', bank: 'Sparkasse Rhein-Nahe', inhaber: 'Emre Kilic', iban: 'DE41 5605 0180 0004 4712 21', bic: 'MALADE51KRE', anfang: 400, ende: 640, einnahmen: 480, ausgaben: 240 }
      ],
      vermoegen: [
        ['Bargeld und Bankguthaben', 'P-Konto und Basiskonto', 584.9, 858.44],
        ['Forderungen', 'Mietkaution Wohnbau Bingen (Kautionssparbuch)', 1428.6, 1441.2],
        ['Haushaltsgegenstände', 'Wohnungseinrichtung', 2000, 2100]
      ],
      verbindlichkeiten: [
        ['Jobcenter Landkreis Mainz-Bingen', 'Erstattungsforderung, Aufrechnung 10 % Regelbedarf', 2512.6, 2008.6],
        ['Riverty GmbH (Vodafone)', 'Mobilfunkforderung, Ratenzahlung 30 €', 1173.4, 813.4],
        ['Otto GmbH & Co KG', 'Vollstreckungsbescheid AG Mainz, Ratenzahlung', 2049.95, 1949.95],
        ['Justizkasse Mainz', 'Bußgeld, Ratenzahlung 20 €', 168.5, 108.5]
      ],
      schenkungen: []
    }),
    exportHistory: [],
    archives: [],
    history: [],
    contacts: [],
    contactMerges: [],
    promptHints: 'Herr Kilic ist im stabilen Zustand voll einwilligungsfähig und entscheidet selbst. Berichte sollen seine eigene Sicht ausdrücklich wiedergeben. Unterstützte Entscheidungsfindung vor Stellvertretung; die Ablehnung der stationären Wohnform ist eine bewusst respektierte Willensentscheidung.',
    derived: {}
  },

  kontakte: [
    { kategorie: 'behoerden', rolle: 'Betreuungsgericht', institution: 'Amtsgericht Bingen am Rhein', strasse: 'Mainzer Straße', hausnummer: '21', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/9110', fax: '06721/911180', mail: 'poststelle.ag-bin@ko.mjv.rlp.de', aktenzeichen: '4 XVII 88/22', gericht: 'Amtsgericht Bingen am Rhein', gerichtsAz: '4 XVII 88/22' },
    { kategorie: 'behoerden', rolle: 'Betreuungsbehörde', institution: 'Kreisverwaltung Mainz-Bingen, Betreuungsbehörde', strasse: 'Georg-Rückert-Straße', hausnummer: '11', plz: '55218', ort: 'Ingelheim am Rhein', telefon: '06132/7870', mail: 'betreuungsbehoerde@mainz-bingen.de', aktenzeichen: 'BtB 2022/1188' },
    { kategorie: 'behoerden', rolle: 'Jobcenter', institution: 'Jobcenter Landkreis Mainz-Bingen, Standort Bingen', strasse: 'Rochusallee', hausnummer: '5', plz: '55411', ort: 'Bingen am Rhein', telefon: '06132/78710', fax: '06132/787199', mail: 'jobcenter-mainz-bingen@jobcenter-ge.de', aktenzeichen: 'BG 0917442' },
    { kategorie: 'behoerden', rolle: 'LSJV / Versorgungsamt', institution: 'Landesamt für Soziales, Jugend und Versorgung – Eingliederungshilfe', strasse: 'Rheinallee', hausnummer: '97-101', plz: '55118', ort: 'Mainz', telefon: '06131/9670', mail: 'poststelle@lsjv.rlp.de', aktenzeichen: 'EGH 2023/4471' },
    { kategorie: 'behoerden', rolle: 'Sozialpsychiatrischer Dienst', institution: 'Kreisverwaltung Mainz-Bingen, Sozialpsychiatrischer Dienst', strasse: 'Georg-Rückert-Straße', hausnummer: '11', plz: '55218', ort: 'Ingelheim am Rhein', telefon: '06132/787360', mail: 'spdi@mainz-bingen.de' },
    { kategorie: 'behoerden', rolle: 'Strafgericht - Amtsgericht', institution: 'Justizkasse Mainz', strasse: 'Ernst-Ludwig-Straße', hausnummer: '7', plz: '55116', ort: 'Mainz', telefon: '06131/1410', aktenzeichen: 'JK 4471-2024-118' , mail: 'poststelle@justizkasse-mainz.de' },
    { kategorie: 'gesundheit', rolle: 'Psychiater', anrede: 'Sehr geehrter Herr', titel: 'Dr. med.', vorname: 'Jan', nachname: 'Hüttenberger', institution: 'Praxis für Psychiatrie und Psychotherapie', strasse: 'Hospitalstraße', hausnummer: '2', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/994120', fax: '06721/994121', mail: 'praxis@huettenberger-bingen.de' },
    { kategorie: 'gesundheit', rolle: 'Allgemeinmedizin', anrede: 'Sehr geehrte Frau', titel: 'Dr. med.', vorname: 'Farida', nachname: 'Nasser', institution: 'Hausarztpraxis Bingen-Büdesheim', strasse: 'Koblenzer Straße', hausnummer: '77', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/301744', mail: 'praxis.nasser@example-mail.de' },
    { kategorie: 'gesundheit', rolle: 'Psychologe', anrede: 'Sehr geehrte Frau', vorname: 'Sophie', nachname: 'Lindqvist', institution: 'Praxis für Psychotherapie', strasse: 'Rheinkai', hausnummer: '18', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/886310', mail: 'praxis@lindqvist-psychotherapie.de' },
    { kategorie: 'gesundheit', rolle: 'Krankenhaus', institution: 'Rheinhessen-Fachklinik Alzey', strasse: 'Dautenheimer Landstraße', hausnummer: '66', plz: '55232', ort: 'Alzey', telefon: '06731/500', mail: 'info@rfk-alzey.de', vorgang: 'Behandlungsvereinbarung BV-AZ-2023-118' },
    { kategorie: 'gesundheit', rolle: 'Gastroenterologie', anrede: 'Sehr geehrter Herr', titel: 'Dr. med.', vorname: 'Ralf', nachname: 'Steinbrück', institution: 'MVZ Mainz-West', strasse: 'Wallstraße', hausnummer: '3', plz: '55122', ort: 'Mainz', telefon: '06131/9214420', mail: 'gastro@mvz-mainz-west.de' },
    { kategorie: 'gesundheit', rolle: 'Suchtmedizin', institution: 'Caritas Suchtberatung Bingen', strasse: 'Vorstadt', hausnummer: '4', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/917330', mail: 'suchtberatung@caritas-bingen.de' },
    { kategorie: 'gesundheit', rolle: 'Zahnmedizin', anrede: 'Sehr geehrter Herr', titel: 'Dr.', vorname: 'Kai', nachname: 'Ohlmann', institution: 'Zahnarztpraxis Dr. Ohlmann', strasse: 'Basilikastraße', hausnummer: '12', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/13340', mail: 'praxis@zahn-ohlmann.de' },
    { kategorie: 'gesundheit', rolle: 'Apotheke', institution: 'Rochus-Apotheke Bingen', strasse: 'Rochusallee', hausnummer: '22', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/12240', mail: 'info@rochus-apotheke-bingen.de' },
    { kategorie: 'finanzen', rolle: 'Bankinstut', institution: 'Sparkasse Rhein-Nahe', strasse: 'Kornmarkt', hausnummer: '5', plz: '55545', ort: 'Bad Kreuznach', telefon: '0671/9410', mail: 'info@sparkasse-rhein-nahe.de', iban: 'DE13 5605 0180 0004 4712 20', bic: 'MALADE51KRE', bank: 'Sparkasse Rhein-Nahe', vorgang: 'P-Konto, Grundfreibetrag bescheinigt' },
    { kategorie: 'finanzen', rolle: 'Schuldnerberatungsstelle', institution: 'Schuldner- und Insolvenzberatung Caritas Rheinhessen', strasse: 'Holzhofstraße', hausnummer: '8', plz: '55116', ort: 'Mainz', telefon: '06131/2826280', mail: 'schuldnerberatung@caritas-mz.de', vorgang: 'Beratung seit 09/2022' },
    { kategorie: 'finanzen', rolle: 'Gläubiger', institution: 'Riverty GmbH (vormals Arvato Financial Solutions)', strasse: 'Gütersloher Straße', hausnummer: '123', plz: '33415', ort: 'Verl', telefon: '05241/8043000', aktenzeichen: 'RIV-2021-884471', iban: 'DE87 3705 0198 0000 8844 71', bic: 'COLSDE33XXX' , mail: 'service@riverty.de' },
    { kategorie: 'finanzen', rolle: 'Gläubiger', institution: 'Otto GmbH & Co KG', strasse: 'Werner-Otto-Straße', hausnummer: '1-7', plz: '22179', ort: 'Hamburg', telefon: '040/64610', aktenzeichen: 'OTT-90 447 122', vorgang: 'Vollstreckungsbescheid AG Mainz vom 14.02.2022' , mail: 'service@otto.de' },
    { kategorie: 'finanzen', rolle: 'Mobilfunk', institution: 'Congstar (Telekom Deutschland GmbH)', strasse: 'Bayenwerft', hausnummer: '12-14', plz: '50678', ort: 'Köln', telefon: '0221/79700', aktenzeichen: 'CG-4471-2208' , mail: 'service@congstar.de' },
    { kategorie: 'finanzen', rolle: 'Nebenkostenanbieter Strom', institution: 'Stadtwerke Bingen GmbH', strasse: 'Rupertusstraße', hausnummer: '11', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/9060', mail: 'kundenservice@stadtwerke-bingen.de', aktenzeichen: 'SWB-22-114 908' },
    { kategorie: 'versicherungen', rolle: 'Gesundheitsversicherung (gesetzlich)', institution: 'Techniker Krankenkasse', strasse: 'Bramfelder Straße', hausnummer: '140', plz: '22305', ort: 'Hamburg', telefon: '0800/2858585', mail: 'service@tk.de', aktenzeichen: 'T447122089' },
    { kategorie: 'versicherungen', rolle: 'Privathatfplicht', institution: 'HUK-COBURG', strasse: 'Bahnhofsplatz', hausnummer: '1', plz: '96450', ort: 'Coburg', telefon: '09561/960', aktenzeichen: 'HP 88 447 122' , mail: 'service@huk-coburg.de' },
    { kategorie: 'versicherungen', rolle: 'Hausratversicherung', institution: 'HUK-COBURG', strasse: 'Bahnhofsplatz', hausnummer: '1', plz: '96450', ort: 'Coburg', telefon: '09561/960', aktenzeichen: 'HR 88 447 123' , mail: 'service@huk-coburg.de' },
    { kategorie: 'arbeit', rolle: 'Arbeitgeber', status: 'Beendet', institution: 'Logistikzentrum Rheinhessen GmbH', strasse: 'Industriestraße', hausnummer: '40', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/990100', vorgang: 'Beschäftigung 04/2021 bis 02/2024, betriebsbedingt gekündigt' , mail: 'info@logistikzentrum-rheinhessen.de' },
    { kategorie: 'arbeit', rolle: 'Arbeitgeber', status: 'Beabsichtigt', institution: 'Tafel Bingen e. V. (Praktikum)', strasse: 'Mainzer Straße', hausnummer: '68', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/994488', mail: 'info@tafel-bingen.de', vorgang: 'Praktikum zwei Vormittage wöchentlich seit 07/2026' },
    { kategorie: 'unterkunft', rolle: 'Vermieter', institution: 'Wohnbau Bingen GmbH', strasse: 'Am Ohmbach', hausnummer: '3', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/91800', fax: '06721/918099', mail: 'service@wohnbau-bingen.de', aktenzeichen: 'WB-2023-0447', iban: 'DE73 5605 0180 0000 4471 20', bic: 'MALADE51KRE' },
    { kategorie: 'unterkunft', rolle: 'Nebenkostenanbieter Strom', institution: 'Stadtwerke Bingen GmbH', strasse: 'Rupertusstraße', hausnummer: '11', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/9060', aktenzeichen: 'SWB-22-114 908' , mail: 'info@stadtwerke-bingen.de' },
    { kategorie: 'unterkunft', rolle: 'Beitragsservice', status: 'Befreit', institution: 'ARD ZDF Deutschlandradio Beitragsservice', plz: '50656', ort: 'Köln', telefon: '01806/999555', aktenzeichen: '512 447 108' , mail: 'service@rundfunkbeitrag.de' , postfach: '50656 Köln' },
    { kategorie: 'unterkunft', rolle: 'Einrichtungsträger', institution: 'Betreutes Wohnen Rheinhessen e. V.', strasse: 'Rochusallee', hausnummer: '7', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/443015', mail: 'info@bewo-rheinhessen.de', aktenzeichen: 'EGH 2023/4471' },
    { kategorie: 'soziales', rolle: 'Mutter', anrede: 'Sehr geehrte Frau', vorname: 'Ayla', nachname: 'Kilic', strasse: 'Wilhelmstraße', hausnummer: '9', plz: '55218', ort: 'Ingelheim am Rhein', telefon: '06132/447291', mobil: '0176/22884471', mail: 'ayla.kilic@example-mail.de' },
    { kategorie: 'soziales', rolle: 'Schwester', anrede: 'Sehr geehrte Frau', vorname: 'Derya', nachname: 'Kilic-Baumann', strasse: 'Rheinstraße', hausnummer: '52', plz: '55116', ort: 'Mainz', mobil: '0151/44712208', mail: 'derya.kb@example-mail.de' , telefon: '06131/2287140' },
    { kategorie: 'soziales', rolle: 'Vater', status: 'Beendet', anrede: 'Sehr geehrter Herr', vorname: 'Mehmet', nachname: 'Kilic', ort: 'Izmir', vorgang: 'Kein Kontakt seit 2018' , mail: 'mehmet.kilic@example-mail.de' , telefon: '+90 232 4451182' , strasse: 'Gazi Bulvarı' , hausnummer: '74' , plz: '35230' },
    { kategorie: 'soziales', rolle: 'Peer / Bezugsperson', anrede: 'Sehr geehrte Frau', vorname: 'Nicole', nachname: 'Wehrle', institution: 'Betreutes Wohnen Rheinhessen e. V.', strasse: 'Rochusallee', hausnummer: '7', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/443015', mobil: '0170/8844712', mail: 'wehrle@bewo-rheinhessen.de' },
    { kategorie: 'soziales', rolle: 'Verein (Freizeit)', institution: 'Selbsthilfegruppe „Rheinlicht"', strasse: 'Freidhof', hausnummer: '10', plz: '55411', ort: 'Bingen am Rhein', telefon: '06721/990244', mail: 'rheinlicht@shg-bingen.de' },
    { kategorie: 'soziales', rolle: 'aktuelle Betreuung', anrede: 'Sehr geehrter Herr', vorname: 'Christoph', nachname: 'Zepp', institution: 'Betreuungsbüro Rheinblick', strasse: 'Marktplatz', hausnummer: '8', plz: '56346', ort: 'St. Goarshausen', telefon: '06771/959410', mail: 'kanzlei@betreuungsbuero-rheinblick.de' }
  ],

  doku: L.doku([
    ['2022-05-24', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Betreuungsspezifischer Vorgang', 'Übernahme einer neuen Betreuung / Erstgespräch / Aktenanlage', 'Schriftlich (Brief)', 'Bestellung zugestellt', 'Beschluss vom 19.05.2022. Sieben Aufgabenkreise, Einwilligungsvorbehalt für die Vermögenssorge. Anlass des Verfahrens: mehrere in einer akuten Krankheitsphase abgeschlossene Verträge und drohende Wohnungslosigkeit.'],
    ['2022-06-01', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Beratungsgespräch', 'persönlich (Hausbesuch)', 'Erstgespräch in der Wohnung', 'Herr Kilic empfing offen und zugewandt. Er schilderte die Zeit vor der Betreuung als „chaotisch" und war erleichtert, dass sich jemand um die Post kümmert. Den Einwilligungsvorbehalt kritisierte er von Anfang an. Vereinbart: wöchentliches Auszahlungsbudget von 90 €, Post kommt über die Betreuung.'],
    ['2022-06-14', 'Finanzen, Vermögen & Schulden', 'Inkassounternehmen / Gläubiger', 'Finanzen, Vermögen & Schulden', 'Schuldenklärung / Ratenzahlungsvereinbarung', 'Schriftlich (Brief)', 'Gläubigeranschreiben versandt', 'Sechs Gläubiger angeschrieben und um Forderungsaufstellung gebeten. Gesamtforderung nach Rücklauf rund 9.900 €. Schuldenmodul angelegt.'],
    ['2022-06-28', 'Sozialleistungsträger & öffentliche Stellen', 'Jobcenter', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'persönlich (Gericht / Behörde)', 'Bürgergeld beantragt', 'Weiterbewilligung und Klärung der Erstattungsforderung aus 2019. Vereinbart: Aufrechnung mit 10 % des Regelbedarfs statt Vollstreckung.'],
    ['2022-07-12', 'Finanzen, Vermögen & Schulden', 'Bank / Sparkasse', 'Finanzen, Vermögen & Schulden', 'Kontoeröffnung / Kontoschließung', 'persönlich (Gericht / Behörde)', 'Girokonto in P-Konto umgewandelt', 'Umwandlung in ein Pfändungsschutzkonto. Bescheinigung über den Grundfreibetrag durch die Schuldnerberatung. Zusätzlich Basiskonto als Rücklagenkonto eröffnet.'],
    ['2022-07-18', 'Wohnen, Energie & Kommunikation', 'Energie-/ Telefon-/ Internet-Dienstleister', 'Wohnen, Aufenthalt & Unterbringung', 'Unterkunftsangelegenheit (Sicherung Unterkunft, Mietrückstände etc.)', 'telefonisch', 'Stromsperre abgewendet', 'Stadtwerke Bingen hatten die Sperre für den 25.07.2022 angedroht. Direktzahlung des Abschlags nach § 22 Abs. 8 SGB II beantragt; Sperre ausgesetzt.'],
    ['2022-08-08', 'Finanzen, Vermögen & Schulden', 'Inkassounternehmen / Gläubiger', 'Finanzen, Vermögen & Schulden', 'Schuldenklärung / Ratenzahlungsvereinbarung', 'Schriftlich (Brief)', 'Ratenvereinbarung Riverty', 'Ratenzahlung von 30 € monatlich vereinbart, Verzicht auf weitere Kosten. Dauerauftrag eingerichtet.'],
    ['2022-09-14', 'Sozialleistungsträger & öffentliche Stellen', 'Sozialverwaltungsbehörde', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Schwerbehindertenausweis beantragt', 'Antrag beim LSJV Mainz mit Befundbericht Dr. Hüttenberger. GdB 50 und Merkzeichen G am 21.11.2022 zuerkannt.'],
    ['2022-11-03', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Hausbesuch durchgeführt', 'persönlich (Hausbesuch)', 'Quartalsbesuch', 'Wohnung aufgeräumt, Herr Kilic wirkt stabil. Er arbeitet seit April 2021 im Logistikzentrum und ist stolz darauf. Nebeneinkommen wird korrekt beim Jobcenter angezeigt.'],
    ['2023-01-16', 'Gesundheit, Pflege & Rehabilitation', 'Ambulanter Pflegedienst', 'Gesundheit, Pflege & Rehabilitation', 'Krisenintervention im Alltag', 'telefonisch', 'Krisenmeldung des Sozialpsychiatrischen Dienstes', 'Nachbarn hatten die Polizei gerufen. Herr Kilic äußerte Verfolgungsideen, hatte die Wohnungstür verbarrikadiert und seit Tagen nichts gegessen. Hausbesuch des SpDi; Herr Kilic verweigerte die Aufnahme.'],
    ['2023-01-19', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhausaufnahme organisieren', 'persönlich (Hausbesuch)', 'Unterbringung veranlasst', 'Nach erneutem Hausbesuch mit dem SpDi und ärztlichem Zeugnis Antrag auf Genehmigung der Unterbringung nach § 1831 BGB gestellt. Herr Kilic widersprach ausdrücklich. Aufnahme in die Rheinhessen-Fachklinik Alzey, Station P1.'],
    ['2023-01-25', 'Gerichte, Betreuungsbehörden & Justiz', 'Richter:in', 'Anträge, Verfahren & Rechtliches', 'Anhörung (Vorbereitung / Teilnahme / Äußerung)', 'persönlich (Gericht / Behörde)', 'Anhörung in der Klinik', 'Persönliche Anhörung durch die Richterin auf der Station. Verfahrenspflegerin Rechtsanwältin Sander bestellt. Herr Kilic lehnte die Unterbringung ab, konnte die Gefährdung nicht einschätzen. Beschluss bis 15.03.2023.'],
    ['2023-02-14', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'persönlich (Einrichtung / Klinik)', 'Umstellung auf Depot besprochen', 'Olanzapin wegen Gewichtszunahme abgesetzt. Herr Kilic stimmte im stabilisierten Zustand der Umstellung auf Paliperidon-Depot ausdrücklich selbst zu.'],
    ['2023-03-03', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Dokumentation von Vollmachten / Patientenverfügung / Vorsorgevollmacht', 'persönlich (Einrichtung / Klinik)', 'Behandlungsvereinbarung geschlossen', 'Herr Kilic unterzeichnete selbst eine Behandlungsvereinbarung mit der Klinik: Wunschmedikation Paliperidon, keine Fixierung, Ansprechpartner Mutter und Betreuung, Wunsch nach frühzeitiger ambulanter Krisenintervention.'],
    ['2023-03-08', 'Gesundheit, Pflege & Rehabilitation', 'Sozialdienst Klinik/Einrichtung', 'Gesundheit, Pflege & Rehabilitation', 'Entlassungsmanagement / Überleitung', 'persönlich (Einrichtung / Klinik)', 'Entlassung nach Hause', 'Entlassung in die eigene Wohnung. Verlängerungsantrag wurde zurückgenommen. Antrag auf Ambulant Betreutes Wohnen vorbereitet.'],
    ['2023-03-20', 'Sozialleistungsträger & öffentliche Stellen', 'Sozialverwaltungsbehörde', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Eingliederungshilfe beantragt', 'Antrag auf Ambulant Betreutes Wohnen nach Teil 2 SGB IX. Bedarfsermittlung nach dem Instrument BEI_RP am 12.04.2023.'],
    ['2023-04-03', 'Wohnen, Energie & Kommunikation', 'Vermieter:in / Wohnungsunternehmen / Hausverwaltung', 'Wohnen, Aufenthalt & Unterbringung', 'Unterkunftsangelegenheit (Sicherung Unterkunft, Mietrückstände etc.)', 'Schriftlich (Brief)', 'Fristlose Kündigung erhalten', 'Wohnbau Bingen kündigt wegen 1.746 € Mietrückstand aus der Zeit der Unterbringung. Sofortige Kontaktaufnahme, Darlehensantrag beim Jobcenter gestellt.'],
    ['2023-05-24', 'Sozialleistungsträger & öffentliche Stellen', 'Jobcenter', 'Wohnen, Aufenthalt & Unterbringung', 'Unterkunftsangelegenheit (Sicherung Unterkunft, Mietrückstände etc.)', 'Schriftlich (Brief)', 'Mietschulden übernommen', 'Darlehen nach § 22 Abs. 8 SGB II bewilligt und direkt an die Wohnbau überwiesen. Tilgung durch Aufrechnung von 5 % des Regelbedarfs.'],
    ['2023-06-14', 'Wohnen, Energie & Kommunikation', 'Vermieter:in / Wohnungsunternehmen / Hausverwaltung', 'Wohnen, Aufenthalt & Unterbringung', 'Unterkunftsangelegenheit (Sicherung Unterkunft, Mietrückstände etc.)', 'Schriftlich (Brief)', 'Kündigung zurückgenommen', 'Wohnbau nimmt die Kündigung zurück. Mietverhältnis wird unverändert fortgeführt. Ziel „Wohnung dauerhaft sichern" erreicht.'],
    ['2023-07-11', 'Wohnen, Energie & Kommunikation', 'Einrichtungsträger (Heim, betreutes Wohnen, besondere Wohnform)', 'Beratung, Abstimmung & Hilfeplanung', 'Hilfeplangespräch / Teilhabeplan / Gesamtplanverfahren', 'persönlich (Hausbesuch)', 'Start des Betreuten Wohnens', 'Zwei Fachleistungsstunden wöchentlich bewilligt, Bezugsbetreuung Frau Wehrle. Schwerpunkte: Haushalt, Tagesstruktur, Medikamentenerinnerung.'],
    ['2024-02-26', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhausaufnahme organisieren', 'telefonisch', 'Freiwillige teilstationäre Aufnahme', 'Nach betriebsbedingter Kündigung im Logistikzentrum erneuter Cannabiskonsum und zwei versäumte Depottermine. Herr Kilic meldete sich selbst und bat um Hilfe. Tagesklinik Bingen ab 26.02.2024.'],
    ['2024-03-05', 'Gesundheit, Pflege & Rehabilitation', 'Sozialdienst Klinik/Einrichtung', 'Beratung, Abstimmung & Hilfeplanung', 'Beratungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Stationäre Wohnform erwogen', 'Die Tagesklinik regte einen Wechsel in eine sozialtherapeutische Wohneinrichtung an. Herr Kilic lehnte dies entschieden ab: „Dann verliere ich alles, was ich noch habe."'],
    ['2024-03-18', 'Gesundheit, Pflege & Rehabilitation', 'Sozialdienst Klinik/Einrichtung', 'Beratung, Abstimmung & Hilfeplanung', 'Helferkonferenz / Fallbesprechung durchgeführt', 'persönlich (Einrichtung / Klinik)', 'Fallkonferenz', 'Teilnehmende: Tagesklinik, Betreutes Wohnen, Mutter, Betreuung, Herr Kilic. Ergebnis: Verbleib in der Wohnung, Erhöhung der Fachleistungsstunden von 2 auf 3,5, Anbindung an die Suchtberatung, Antrag auf Psychotherapie.'],
    ['2024-04-19', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Entlassungsmanagement / Überleitung', 'Schriftlich (E-Mail)', 'Entlassung aus der Tagesklinik', 'Stabiler Zustand, Depot wieder regelmäßig. Entscheidung gegen die stationäre Wohnform als Willensentscheidung dokumentiert.'],
    ['2024-05-06', 'Gesundheit, Pflege & Rehabilitation', 'Psychotherapeut:innen', 'Gesundheit, Pflege & Rehabilitation', 'Beratungsgespräch', 'Schriftlich (Brief)', 'Psychotherapie bewilligt', '60 Sitzungen Verhaltenstherapie bei Frau Lindqvist bewilligt. Beginn 13.05.2024, wöchentlich.'],
    ['2024-09-16', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Arbeit, Beschäftigung, Bildung & Teilhabe', 'Beratungsgespräch', 'persönlich (Hausbesuch)', 'Wunsch nach Arbeit', 'Herr Kilic möchte wieder arbeiten, lehnt eine Werkstatt aber ab. Wunsch in „Bedarfe & Wille" aufgenommen. Kontakt zum Integrationsfachdienst vereinbart.'],
    ['2025-03-18', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Gesundheit, Pflege & Rehabilitation', 'Beratungsgespräch', 'telefonisch', 'Ein Jahr Abstinenz', 'Herr Kilic berichtet stolz von einem Jahr Cannabisabstinenz. Die Suchtberatung bestätigt regelmäßige Teilnahme.'],
    ['2025-05-19', 'Arbeit, Bildung & Teilhabe', 'Reha-Träger', 'Arbeit, Beschäftigung, Bildung & Teilhabe', 'Reha-/Teilhabe am Arbeitsleben (Integrationsfachdienst, WfbM etc.)', 'persönlich (Gericht / Behörde)', 'Beratung Integrationsfachdienst', 'Erstgespräch beim Integrationsfachdienst Mainz-Bingen. Empfehlung: Belastungserprobung über ein Praktikum, danach Prüfung eines Budgets für Arbeit.'],
    ['2025-08-11', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Gesundheit, Pflege & Rehabilitation', 'Arzttermin vereinbaren / absagen', 'persönlich (Hausbesuch)', 'Zahnbehandlung eingeleitet', 'Herr Kilic klagt seit Wochen über Zahnschmerzen. Termin bei Dr. Ohlmann vereinbart, Härtefallantrag bei der TK gestellt. Rücklage auf dem Basiskonto aufgebaut.'],
    ['2025-11-18', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztbegleitung', 'Schriftlich (E-Mail)', 'Zahnsanierung abgeschlossen', 'Drei Füllungen und professionelle Zahnreinigung. Eigenanteil 210 € aus dem Rücklagenkonto. Halbjährliche Prophylaxe vereinbart.'],
    ['2026-01-14', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'Schriftlich (E-Mail)', 'Depotgabe und Verlaufsgespräch', 'Dr. Hüttenberger bestätigt einen stabilen Verlauf ohne Positivsymptomatik seit April 2024. Gewicht 96 kg, Bewegungsprogramm empfohlen.'],
    ['2026-04-23', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztbegleitung', 'persönlich (Einrichtung / Klinik)', 'Gastroskopie-Kontrolle', 'Deutliche Besserung der Refluxösophagitis. Herr Kilic hat selbst eingewilligt und den Termin allein wahrgenommen.'],
    ['2026-06-10', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'telefonisch', 'Sertralin erhöht', 'Antriebsminderung im Frühjahr. Sertralin von 25 auf 50 mg erhöht, Kontrolle in vier Wochen.'],
    ['2026-06-16', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Hausbesuch durchgeführt', 'persönlich (Hausbesuch)', 'Hausbesuch und Wunsch nach Aufhebung des Vorbehalts', 'Wohnung sauber und geordnet. Herr Kilic bittet ausdrücklich um Aufhebung des Einwilligungsvorbehalts: „Ich habe seit drei Jahren nichts mehr unterschrieben, was Geld kostet." Prüfauftrag in „Bedarfe & Wille" angelegt. Kontakt- und Zusammenarbeitsprofil aktualisiert.'],
    ['2026-06-24', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Betreuungsspezifischer Vorgang', 'Jahresbericht / Entwicklungsbericht', 'eBO', 'Jahresbericht 2025/2026', 'Bericht für 01.06.2025 bis 31.05.2026 über das eBO eingereicht. Anregung zur Beschränkung des Einwilligungsvorbehalts auf Verträge über 200 € aufgenommen.'],
    ['2026-07-02', 'Arbeit, Bildung & Teilhabe', 'Arbeitgeber:in / Ausbildungsbetrieb', 'Arbeit, Beschäftigung, Bildung & Teilhabe', 'Anmeldung / Teilnahme an Freizeit- und Teilhabeangeboten', 'telefonisch', 'Praktikum bei der Tafel begonnen', 'Zwei Vormittage wöchentlich, Sortierung und Ausgabe. Rückmeldung nach vier Wochen positiv. Nächster Schritt: Prüfung eines Budgets für Arbeit.'],
    ['2026-07-18', 'Wohnen, Energie & Kommunikation', 'Vermieter:in / Wohnungsunternehmen / Hausverwaltung', 'Kontrolle, Prüfung & Nachverfolgung', 'Mieterhöhung prüfen / verhandeln', 'Schriftlich (Brief)', 'Betriebskostenabrechnung 2025 geprüft', 'Nachforderung von 384,20 €. Prüfung durch den Mieterverein ergab einen Fehler bei der Verteilung der Heizkosten. Widerspruch vorbereitet, Frist 31.08.2026.'],
    ['2026-08-05', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Kontrolle, Prüfung & Nachverfolgung', 'Stellungnahme', 'Schriftlich (E-Mail)', 'Stellungnahme zur Betreuung', 'Dr. Hüttenberger befürwortet die Fortführung der Betreuung, hält aber eine Beschränkung des Einwilligungsvorbehalts auf Rechtsgeschäfte über 200 € für vertretbar.'],
    ['2026-08-06', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Hausbesuch durchgeführt', 'persönlich (Hausbesuch)', 'Hausbesuch, Barauszahlung, Sachstand', 'Herr Kilic berichtet zufrieden vom Praktikum. Barauszahlung 40 €, Handkasse abgerechnet. Widerspruch gegen die Betriebskostenabrechnung gemeinsam durchgesprochen und unterschrieben.']
  ]),

  termine: [
    { titel: 'Depotgabe Paliperidon – Dr. Hüttenberger', start: '2026-09-02T09:30:00', ende: '2026-09-02T10:00:00', ort: 'Praxis Dr. Hüttenberger, Hospitalstraße 2, 55411 Bingen', beschreibung: 'Vierwöchentlicher Termin. Frau Wehrle erinnert zwei Tage vorher.' },
    { titel: 'Depotgabe Paliperidon – Dr. Hüttenberger', start: '2026-09-30T09:30:00', ende: '2026-09-30T10:00:00', ort: 'Praxis Dr. Hüttenberger, Hospitalstraße 2, 55411 Bingen', beschreibung: 'Vierwöchentlicher Termin.' },
    { titel: 'Hausbesuch Herr Kilic', start: '2026-10-08T14:00:00', ende: '2026-10-08T15:00:00', ort: 'Gutenbergstraße 14b, 55411 Bingen am Rhein', beschreibung: 'Regelbesuch alle acht Wochen. Themen: Praktikum, Gesamtplan Eingliederungshilfe, Betriebskostenwiderspruch.' },
    { titel: 'Teilhabeplankonferenz Eingliederungshilfe', start: '2026-10-27T10:00:00', ende: '2026-10-27T11:30:00', ort: 'Kreisverwaltung Mainz-Bingen, Georg-Rückert-Straße 11, 55218 Ingelheim', beschreibung: 'Fortschreibung des Gesamtplans. Teilnahme von Herrn Kilic und Frau Wehrle zugesagt.' },
    { titel: 'Termin Integrationsfachdienst – Budget für Arbeit', start: '2026-09-17T11:00:00', ende: '2026-09-17T12:00:00', ort: 'Integrationsfachdienst Mainz-Bingen, Kaiserstraße 30, 55116 Mainz', beschreibung: 'Auswertung des Praktikums bei der Tafel, Prüfung eines Budgets für Arbeit.' },
    { titel: 'Selbsthilfegruppe „Rheinlicht"', start: '2026-09-09T18:00:00', ende: '2026-09-09T20:00:00', ort: 'Haus der Begegnung, Freidhof 10, 55411 Bingen', beschreibung: 'Vierzehntägig. Herr Kilic nimmt selbstständig teil; nur informativ im Kalender.' }
  ],

  aufgaben: [
    { titel: 'Widerspruch Betriebskostenabrechnung 2025 absenden', beschreibung: 'Frist 31.08.2026. Prüfbericht des Mietervereins beifügen, Heizkostenverteilung nach § 7 HeizkostenV rügen.', faellig: '2026-08-28', prio: 'hoch' },
    { titel: 'Fortschreibung Gesamtplan Eingliederungshilfe beantragen', beschreibung: 'Bewilligung endet 31.12.2026. Antrag mit Sachstandsbericht des Betreuten Wohnens und Stellungnahme Dr. Hüttenberger.', faellig: '2026-10-24', prio: 'hoch' },
    { titel: 'Anregung zur Beschränkung des Einwilligungsvorbehalts einreichen', beschreibung: 'Stellungnahme Dr. Hüttenberger vom 05.08.2026 beifügen; Vorschlag: Vorbehalt nur für Rechtsgeschäfte über 200 €.', faellig: '2026-09-30', prio: 'normal' },
    { titel: 'Vergütungsantrag 3. Quartal 2026 stellen', beschreibung: 'Mittellos, Staatskasse, eigene Häuslichkeit, ab dem 25. Monat.', faellig: '2026-09-12', prio: 'normal' },
    { titel: 'Budget für Arbeit vorbereiten', beschreibung: 'Praktikumsbescheinigung der Tafel anfordern, Unterlagen für den Integrationsfachdienst zusammenstellen.', faellig: '2026-09-15', prio: 'normal' },
    { titel: 'Patientenverfügung fertigstellen', beschreibung: 'Entwurf vom 12.05.2026 mit Frau Lindqvist und Dr. Hüttenberger abstimmen, Unterzeichnungstermin vereinbaren.', faellig: '2026-10-26', prio: 'normal' },
    { titel: 'Schuldenstand zum Jahresende aktualisieren', beschreibung: 'Aktuelle Forderungsaufstellungen bei Riverty, Otto und der Justizkasse anfordern.', faellig: '2026-12-15', prio: 'niedrig' },
    { titel: 'Sachstand Rentenkonto klären', beschreibung: 'Kontenklärung bei der DRV anstoßen; Zeiten der Beschäftigung 2021-2024 und Anrechnungszeiten prüfen.', faellig: '2026-11-20', prio: 'niedrig' }
  ],

  fahrten: [
    { datum: '2026-06-16', anlass: 'Hausbesuch, Kontakteinschätzung', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Gutenbergstraße 14b, 55411 Bingen am Rhein', km: 96.8 },
    { datum: '2026-07-18', anlass: 'Termin Mieterverein, Prüfung der Betriebskostenabrechnung', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Rochusallee 5, 55411 Bingen am Rhein', km: 94.4 },
    { datum: '2026-08-06', anlass: 'Hausbesuch, Barauszahlung, Widerspruch unterschreiben', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Gutenbergstraße 14b, 55411 Bingen am Rhein', km: 96.8 }
  ],

  rechnungen: [
    { datum: '2026-03-06', nummer: 'RE-2026-0084', empfaenger: 'Landesjustizkasse Mainz (Staatskasse)', zweck: 'Betreuervergütung 4. Quartal 2025 (VBVG, mittellos, eigene Häuslichkeit)', zeitraum: '01.12.2025 - 28.02.2026', summe: 402, eingang: '2026-03-27', eingangsbetrag: 402 },
    { datum: '2026-06-09', nummer: 'RE-2026-0177', empfaenger: 'Landesjustizkasse Mainz (Staatskasse)', zweck: 'Betreuervergütung (VBVG, mittellos, eigene Häuslichkeit)', zeitraum: '01.03.2026 - 31.05.2026', summe: 402, eingang: '2026-06-30', eingangsbetrag: 402 }
  ],

  exporte: [
    L.ausgang(F, 1, {
      datum: '2022-07-12', zeit: '1120', reportId: 'letter_bank_registration',
      dokumentTitel: 'Bankanmeldung', exportMode: 'letterhead',
      empfaenger: 'Sparkasse Rhein-Nahe, Kornmarkt 5, 55545 Bad Kreuznach',
      empfaengerZeilen: ['Sparkasse Rhein-Nahe', 'Abteilung Kontoführung', 'Kornmarkt 5', '55545 Bad Kreuznach'],
      betreff: 'Betreuung Emre Kilic – Betreuerbestellung und Umwandlung in ein P-Konto – Az. 4 XVII 88/22',
      status: 'sent', channel: 'post', notiz: 'Persönlich mit Herrn Kilic in der Filiale vorgelegt.',
      dokuGruppe: 'Finanzen, Vermögen & Schulden', dokuAkteur: 'Bank / Sparkasse',
      dokuArt: 'Finanzen, Vermögen & Schulden', dokuDetail: 'Kontoeröffnung / Kontoschließung',
      inhalt: {
        bezug: 'Betreuung Emre Kilic, geb. 22.08.1993 – Az. 4 XVII 88/22',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'mit Beschluss des Amtsgerichts Bingen am Rhein vom 19.05.2022 bin ich zum rechtlichen Betreuer von Herrn Emre Kilic bestellt worden. Der Aufgabenkreis umfasst die Vermögenssorge; für diesen Bereich besteht ein Einwilligungsvorbehalt.\n\nHerr Kilic beantragt die Umwandlung seines Girokontos DE13 5605 0180 0004 4712 20 in ein Pfändungsschutzkonto nach § 850k ZPO. Die Bescheinigung über den Grundfreibetrag der Schuldner- und Insolvenzberatung der Caritas Rheinhessen liegt bei.\n\nZusätzlich bitten wir um Eröffnung eines Basiskontos als Rücklagenkonto. Sämtliche Kontoauszüge und Mitteilungen sind künftig an meine Büroanschrift zu senden.',
        anlagen: ['Beglaubigte Ausfertigung des Beschlusses vom 19.05.2022', 'Bescheinigung über den Grundfreibetrag']
      }
    }),
    L.ausgang(F, 2, {
      datum: '2022-08-22', zeit: '1455', reportId: 'initial', art: 'bericht',
      dokumentTitel: 'Anfangsbericht', exportMode: 'original',
      empfaenger: 'Amtsgericht Bingen am Rhein, Mainzer Straße 21, 55411 Bingen am Rhein',
      betreff: 'Betreuung Emre Kilic – Anfangsbericht – Az. 4 XVII 88/22',
      status: 'sent', channel: 'post',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Betreuungsspezifischer Vorgang', dokuDetail: 'Berichterstattung',
      inhalt: {
        kopf: ['Amtsgericht Bingen am Rhein · Az. 4 XVII 88/22', 'Betreute Person: Emre Kilic, geb. 22.08.1993', 'Betreuungsbeginn: 24.05.2022 · Berichtsstichtag: 22.08.2022'],
        ortDatum: 'St. Goarshausen, 22.08.2022',
        abschnitte: [
          { titel: '1. Persönliche Situation', felder: [
            ['Meldeanschrift', 'Gutenbergstraße 14b, 55411 Bingen am Rhein'],
            ['Art des Aufenthalts', 'eigene Häuslichkeit'],
            ['Schwerwiegende Krankheiten', 'Paranoide Schizophrenie (F20.0), erstmanifestiert 2016 mit stationärer Behandlung. Episodischer Verlauf mit stabilem Residuum. Zusätzlich schädlicher Gebrauch von Cannabinoiden und eine 2021 diagnostizierte Refluxösophagitis.'],
            ['Fähigkeiten und Ressourcen', 'Herr Kilic ist im stabilen Zustand freundlich, offen und humorvoll. Er gestaltet seinen Alltag weitgehend selbstständig, kocht selbst, nutzt öffentliche Verkehrsmittel und ist seit April 2021 im Logistikzentrum Rheinhessen beschäftigt. Zur Mutter und zur Schwester besteht enger, tragfähiger Kontakt.'],
            ['Beeinträchtigungen', 'In akuten Krankheitsphasen treten Verfolgungs- und Beeinträchtigungsideen auf. Die Krankheitseinsicht ist dann aufgehoben, der Kontakt bricht ab, Post bleibt ungeöffnet. In der Phase 2021 wurden drei Mobilfunkverträge und Bestellungen über rund 2.400 € abgeschlossen, deren Tragweite nicht überblickt wurde.']
          ] },
          { titel: '2. Ziele der Betreuung und Maßnahmen', felder: [
            ['Ziele der Betreuung', 'Sicherung der Wohnung. Ordnung der finanziellen Lage mit Übersicht über alle Forderungen und Ratenvereinbarungen ohne Vollstreckung. Sicherung der Sozialleistungen und Abwendung der Stromsperre. Stabilisierung der medizinischen Behandlung. Erhalt der Beschäftigung, solange sie trägt.'],
            ['Ergriffene und geplante Maßnahmen', 'Umwandlung in ein P-Konto und Eröffnung eines Rücklagenkontos. Anschreiben aller sechs Gläubiger. Ratenvereinbarung mit Riverty über 30 € monatlich. Direktzahlung des Stromabschlags nach § 22 Abs. 8 SGB II und dadurch Abwendung der Sperre. Aufrechnung statt Vollstreckung beim Jobcenter. Geplant: Schwerbehindertenausweis, Anbindung an die Schuldnerberatung, Prüfung des Ambulant Betreuten Wohnens.'],
            ['Handeln gegen den Willen der betreuten Person', 'Der Einwilligungsvorbehalt entspricht nicht dem Willen von Herrn Kilic. Er wurde vom Gericht wegen der Vertragsabschlüsse in der akuten Phase 2021 angeordnet und wird ihm gegenüber offen begründet.']
          ] },
          { titel: '3. Wünsche der betreuten Person', felder: [
            ['Kann die betreute Person persönliche Wünsche äußern?', 'ja'],
            ['Wünsche und Erwartungen hinsichtlich der Betreuung', 'Herr Kilic wünscht sich, dass ihm die Betreuung „den Papierkram abnimmt", ihn aber ansonsten selbst entscheiden lässt. Er möchte über alles informiert werden und keine Entscheidung über seinen Kopf hinweg.'],
            ['Erster persönlicher Kontakt', '01.06.2022'],
            ['Geplante zeitliche Abstände weiterer Kontakte', 'etwa alle acht Wochen als Hausbesuch, dazwischen telefonisch']
          ] }
        ]
      }
    }),
    L.ausgang(F, 3, {
      datum: '2023-01-19', zeit: '1738', reportId: 'court_approval',
      dokumentTitel: 'Betreuungsgerichtliche Genehmigung', exportMode: 'letterhead',
      empfaenger: 'Amtsgericht Bingen am Rhein, Mainzer Straße 21, 55411 Bingen am Rhein',
      empfaengerZeilen: ['Amtsgericht Bingen am Rhein', '- Betreuungsgericht -', 'Mainzer Straße 21', '55411 Bingen am Rhein'],
      betreff: 'Betreuung Emre Kilic – Eilantrag auf Genehmigung einer Unterbringung nach § 1831 BGB – Az. 4 XVII 88/22',
      fax: '06721/911180',
      status: 'sent', channel: 'fax', notiz: 'Eilantrag per Fax um 17:38 Uhr; einstweilige Anordnung erging am Folgetag.',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuDetail: 'Genehmigungsantrag',
      inhalt: {
        bezug: 'Betreuungssache Emre Kilic – Az. 4 XVII 88/22 – EILT SEHR',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'namens der betreuten Person beantrage ich die Genehmigung der geschlossenen Unterbringung von Herrn Emre Kilic in der Rheinhessen-Fachklinik Alzey nach § 1831 Abs. 1 Nr. 1 BGB, zunächst befristet bis zum 15.03.2023, sowie den Erlass einer einstweiligen Anordnung.\n\nHerr Kilic befindet sich seit mehreren Tagen in einer akuten psychotischen Episode. Nachbarn haben am 16.01.2023 die Polizei gerufen. Bei zwei Hausbesuchen – am 16.01. und am 19.01.2023, jeweils gemeinsam mit dem Sozialpsychiatrischen Dienst – zeigte sich folgendes Bild: Die Wohnungstür war von innen verbarrikadiert, Herr Kilic äußerte Verfolgungsideen und gab an, seit mehreren Tagen weder gegessen noch getrunken zu haben, weil die Lebensmittel vergiftet seien. Er wirkte deutlich abgemagert und exsikkiert.\n\nEs besteht die konkrete Gefahr, dass Herr Kilic sich durch die Nahrungs- und Flüssigkeitsverweigerung einen erheblichen gesundheitlichen Schaden zufügt. Eine ambulante Behandlung ist derzeit nicht möglich, weil die Krankheitseinsicht vollständig aufgehoben ist; Herr Kilic hat die freiwillige Aufnahme ausdrücklich abgelehnt.\n\nDer Widerspruch der betreuten Person wird hiermit ausdrücklich mitgeteilt. Ein ärztliches Zeugnis des Sozialpsychiatrischen Dienstes vom heutigen Tage liegt bei. Ich rege die Bestellung einer Verfahrenspflegerin an.',
        anlagen: ['Ärztliches Zeugnis des Sozialpsychiatrischen Dienstes vom 19.01.2023', 'Vermerk über die Hausbesuche vom 16.01. und 19.01.2023']
      }
    }),
    L.ausgang(F, 4, {
      datum: '2026-02-24', zeit: '1015', reportId: 'citizen_benefit_continuation', art: 'bericht',
      dokumentTitel: 'Weiterbewilligungsantrag Bürgergeld', exportMode: 'original',
      empfaenger: 'Jobcenter Landkreis Mainz-Bingen, Rochusallee 5, 55411 Bingen am Rhein',
      betreff: 'Weiterbewilligungsantrag Bürgergeld ab 01.04.2026 – BG 0917442',
      status: 'sent', channel: 'post',
      dokuGruppe: 'Sozialleistungsträger & öffentliche Stellen', dokuAkteur: 'Jobcenter',
      dokuDetail: 'Weiterbewilligungsantrag',
      inhalt: {
        kopf: ['Jobcenter Landkreis Mainz-Bingen · BG 0917442', 'Emre Kilic, geb. 22.08.1993, Gutenbergstraße 14b, 55411 Bingen am Rhein'],
        ortDatum: 'St. Goarshausen, 24.02.2026',
        abschnitte: [
          { titel: 'Bewilligungszeitraum und Haushalt', felder: [
            ['Ende des laufenden Bewilligungszeitraums', '03.2026'],
            ['Beantragter Zeitraum', '01.04.2026 bis 31.03.2027'],
            ['Alleinlebend', 'ja'],
            ['Wohnverhältnis', 'Miete / sonstiges Wohnverhältnis']
          ] },
          { titel: 'Bedarf für Unterkunft und Heizung', felder: [
            ['Grundmiete', '464,00 €'], ['Nebenkosten', '118,00 €'],
            ['Gesamtmiete', '582,00 €'],
            ['Hinweis', 'Heizkosten sind in den Nebenkosten enthalten; Strom wird direkt mit den Stadtwerken Bingen abgerechnet.']
          ] },
          { titel: 'Einkommen und Änderungen', felder: [
            ['Erwerbseinkommen', 'nein'],
            ['Sonstiges Einkommen', 'Seit Juli 2026 ist ein unentgeltliches Praktikum bei der Tafel Bingen e. V. an zwei Vormittagen wöchentlich vorgesehen. Eine Vergütung wird nicht gezahlt.'],
            ['Absehbare Änderungen', 'Für Anfang 2027 ist die Erprobung eines Budgets für Arbeit über den Integrationsfachdienst vorgesehen. Ein Arbeitsverhältnis wird unverzüglich angezeigt.'],
            ['Anlagen', 'Mietbescheinigung der Wohnbau Bingen GmbH, Kontoauszüge der letzten drei Monate beider Konten, Bescheid über die Eingliederungshilfe, Betriebskostenabrechnung 2025 nebst eingelegtem Widerspruch']
          ] }
        ]
      }
    }),
    L.ausgang(F, 5, {
      datum: '2026-06-24', zeit: '0912', reportId: 'annual_noassets', art: 'bericht',
      dokumentTitel: 'Jahresbericht ohne Vermögenssorge', exportMode: 'original',
      empfaenger: 'Amtsgericht Bingen am Rhein, Mainzer Straße 21, 55411 Bingen am Rhein',
      betreff: 'Betreuung Emre Kilic – Jahresbericht 01.06.2025 – 31.05.2026 – Az. 4 XVII 88/22',
      status: 'sent', channel: 'ebo', notiz: 'Über das eBO eingereicht; Eingangsbestätigung liegt vor.',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Betreuungsspezifischer Vorgang', dokuDetail: 'Jahresbericht / Entwicklungsbericht',
      inhalt: {
        kopf: ['Amtsgericht Bingen am Rhein · Az. 4 XVII 88/22', 'Betreute Person: Emre Kilic, geb. 22.08.1993', 'Berichtszeitraum: 01.06.2025 bis 31.05.2026'],
        ortDatum: 'St. Goarshausen, 24.06.2026',
        abschnitte: [
          { titel: 'Persönliche Verhältnisse', felder: [
            ['Ständiger Aufenthalt', 'Gutenbergstraße 14b, 55411 Bingen am Rhein'],
            ['Heimunterbringung', 'nein'],
            ['Persönlicher Eindruck', 'Herr Kilic war im gesamten Berichtszeitraum stabil. Bei beiden Hausbesuchen war die Wohnung sauber und geordnet, er selbst gepflegt und gut gelaunt. Die Depotgabe hat er seit April 2024 kein einziges Mal versäumt. Deutlich spürbar ist sein Wunsch nach mehr Eigenständigkeit.'],
            ['Entwicklung des Zustands', 'gebessert'],
            ['Bewertung der weiteren Betreuung', 'Aufgabenbereiche sollten geändert werden']
          ] },
          { titel: 'Begründung', felder: [
            ['Erforderlichkeit', 'Die Betreuung bleibt in den Aufgabenkreisen Vermögenssorge, Behördenvertretung, Sozialleistungen und Wohnungsangelegenheiten erforderlich, weil Herr Kilic in akuten Krankheitsphasen den Überblick über Post, Fristen und Zahlungen vollständig verliert und die Folgen einer solchen Phase existenzbedrohend sind. Der Einwilligungsvorbehalt sollte nach drei Jahren ohne neue Verbindlichkeiten auf Rechtsgeschäfte über 200 € beschränkt werden; Dr. Hüttenberger hält dies in seiner Stellungnahme vom 05.08.2026 für vertretbar.'],
            ['Ungefähres Vermögen', 'P-Konto 218,44 €, Basiskonto 640,00 €, Mietkaution 1.441,20 €. Restverbindlichkeiten rund 4.500 €, sämtlich in Ratenzahlung.']
          ] },
          { titel: 'Sichtweise der betreuten Person', felder: [
            ['Zu den Kontakten', 'Herr Kilic bewertet die Kontakte als „genau richtig". Häufigere Besuche empfände er als Kontrolle, seltenere als Vernachlässigung.'],
            ['Zur Erforderlichkeit', 'Er hält die Betreuung für die Behörden und die Schulden weiterhin für sinnvoll. Beim Einwilligungsvorbehalt widerspricht er: „Das brauche ich nicht mehr."']
          ] }
        ]
      }
    }),
    L.ausgang(F, 6, {
      datum: '2026-08-06', zeit: '1630', reportId: 'free_document',
      dokumentTitel: 'Freidokument', exportMode: 'letterhead',
      empfaenger: 'Wohnbau Bingen GmbH, Am Ohmbach 3, 55411 Bingen am Rhein',
      empfaengerZeilen: ['Wohnbau Bingen GmbH', 'Am Ohmbach 3', '55411 Bingen am Rhein'],
      betreff: 'Widerspruch gegen die Betriebskostenabrechnung 2025 – Gutenbergstraße 14b',
      mail: 'service@wohnbau-bingen.de',
      status: 'sent', channel: 'mail', notiz: 'Von Herrn Kilic beim Hausbesuch gegengelesen und unterschrieben.',
      dokuGruppe: 'Wohnen, Energie & Kommunikation', dokuAkteur: 'Vermieter:in / Wohnungsunternehmen / Hausverwaltung',
      dokuArt: 'Kontrolle, Prüfung & Nachverfolgung', dokuDetail: 'Widerspruch',
      inhalt: {
        bezug: 'Mietvertrag Gutenbergstraße 14b, 55411 Bingen am Rhein – Emre Kilic',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'gegen Ihre Betriebskostenabrechnung für das Jahr 2025 vom 18.06.2026, zugegangen am 21.06.2026, lege ich namens und in Vollmacht meines Betreuten, Herrn Emre Kilic, hiermit fristgerecht Widerspruch ein.\n\nDie Abrechnung weist eine Nachforderung von 384,20 € aus. Die Prüfung durch den Mieterverein Bingen ergab, dass die Heizkosten entgegen § 7 Abs. 1 HeizkostenV nicht zu mindestens 50 vom Hundert nach dem erfassten Verbrauch verteilt wurden, sondern vollständig nach der Wohnfläche. Zudem ist der Ansatz für die Position „Hausmeisterdienste" gegenüber dem Vorjahr um 41 vom Hundert gestiegen, ohne dass hierfür eine Erläuterung beigefügt wäre.\n\nIch bitte daher um eine korrigierte Abrechnung sowie um Einsicht in die zugrunde liegenden Belege nach § 259 BGB. Bis zur Klärung wird die Nachforderung nicht ausgeglichen; ein Zurückbehaltungsrecht wird ausdrücklich geltend gemacht.\n\nFür eine Rückmeldung bis zum 30.09.2026 wäre ich dankbar.',
        anlagen: ['Prüfbericht des Mietervereins Bingen vom 30.07.2026']
      }
    }),
    L.ausgang(F, 7, {
      datum: '2026-08-06', zeit: '1712', reportId: 'sgb9_initial_application', art: 'bericht',
      dokumentTitel: 'Formloser Antrag SGB IX', exportMode: 'letterhead',
      empfaenger: 'Landesamt für Soziales, Jugend und Versorgung – Eingliederungshilfe, Rheinallee 97-101, 55118 Mainz',
      betreff: 'Fortschreibung der Assistenzleistungen ab 01.01.2027 – Emre Kilic – EGH 2023/4471',
      mail: 'poststelle@lsjv.rlp.de',
      status: 'prepared', vorbereitet: 'mail',
      notiz: 'Entwurf steht; wird nach der Teilhabeplankonferenz am 27.10.2026 abschließend abgestimmt und dann versendet.',
      dokuGruppe: 'Sozialleistungsträger & öffentliche Stellen', dokuAkteur: 'Sozialverwaltungsbehörde',
      dokuDetail: 'Antragsstellung',
      inhalt: {
        kopf: ['Landesamt für Soziales, Jugend und Versorgung – Eingliederungshilfe · EGH 2023/4471', 'Emre Kilic, geb. 22.08.1993, Gutenbergstraße 14b, 55411 Bingen am Rhein'],
        ortDatum: 'St. Goarshausen, 06.08.2026',
        abschnitte: [
          { titel: 'Beantragte Leistung', felder: [
            ['Leistung', 'Fortschreibung der Assistenzleistungen zur selbstbestimmten Lebensführung in eigenem Wohnraum (Ambulant Betreutes Wohnen, § 78 SGB IX) mit 3,5 Fachleistungsstunden wöchentlich'],
            ['Leistungsbeginn', '01.01.2027, Bewilligungszeitraum zunächst zwei Jahre']
          ] },
          { titel: 'Begründung', felder: [
            ['Bedarf', 'Paranoide Schizophrenie mit episodischem Verlauf. In stabilen Phasen führt Herr Kilic seinen Haushalt selbstständig; in akuten Phasen bricht die Alltagsbewältigung innerhalb weniger Tage zusammen. 2023 stand die Wohnung deshalb unmittelbar vor dem Verlust. Seit der Erhöhung der Fachleistungsstunden auf 3,5 im April 2024 ist der Verlauf stabil. Die wöchentliche Begleitung stützt die Alltagsstruktur und erkennt Frühwarnzeichen, bevor eine Krise eskaliert. Eine Reduzierung würde gerade diese Frühwarnfunktion entfallen lassen.'],
            ['Mitwirkung', 'Herr Kilic beantragt die Fortschreibung ausdrücklich selbst und nimmt an der Teilhabeplankonferenz am 27.10.2026 teil.'],
            ['Anlagen', 'Sachstandsbericht des Betreuten Wohnens Rheinhessen e. V. vom 31.07.2026, fachärztliche Stellungnahme Dr. med. Jan Hüttenberger vom 05.08.2026, aktueller Bürgergeldbescheid']
          ] }
        ]
      }
    })
  ],

  archive: [
    L.archiv(F, 1, {
      reportId: 'initial', titel: 'Anfangsbericht', archiviertAm: '2022-08-22', zeit: '14:55',
      erstelltAm: '2022-07-04', von: '24.05.2022', bis: '22.08.2022',
      name: '220822 1455 Amtsgericht Bingen am Rhein Anfangsbericht',
      notiz: 'Beim Betreuungsgericht eingereichte Fassung des Anfangsberichts.',
      felder: {
        registered_address: 'Gutenbergstraße 14b, 55411 Bingen am Rhein',
        employment_status: 'Arbeitsverhältnis',
        employer_occupation: 'Logistikzentrum Rheinhessen GmbH, Bingen – Lagermitarbeiter in Teilzeit seit 04/2021',
        goals: 'Sicherung der Wohnung. Ordnung der finanziellen Lage. Sicherung der Sozialleistungen und Abwendung der Stromsperre. Stabilisierung der medizinischen Behandlung. Erhalt der Beschäftigung, solange sie trägt.',
        measures: 'Umwandlung in ein P-Konto und Eröffnung eines Rücklagenkontos. Anschreiben aller sechs Gläubiger. Ratenvereinbarung mit Riverty. Direktzahlung des Stromabschlags. Aufrechnung statt Vollstreckung beim Jobcenter.',
        against_will: 'Der Einwilligungsvorbehalt für die Vermögenssorge entspricht nicht dem Willen von Herrn Kilic.',
        first_contact: '2022-06-01',
        contact_count: 3
      }
    }),
    L.archiv(F, 2, {
      reportId: 'annual_noassets', titel: 'Jahresbericht ohne Vermögenssorge', archiviertAm: '2025-06-18', zeit: '10:40',
      erstelltAm: '2025-05-22', von: '01.06.2024', bis: '31.05.2025',
      name: '250618 1040 Amtsgericht Bingen am Rhein Jahresbericht ohne Vermögenssorge',
      notiz: 'Eingereichter Jahresbericht 2024/2025 – erstes volles Jahr nach dem Rückfall im Frühjahr 2024.',
      felder: {
        residence: 'Gutenbergstraße 14b, 55411 Bingen am Rhein',
        home_placement: 'nein',
        personal_impression: 'Nach dem Rückfall im Februar 2024 und der teilstationären Behandlung hat sich Herr Kilic im Berichtszeitraum deutlich stabilisiert. Die Fachleistungsstunden des Betreuten Wohnens wurden im April 2024 von zwei auf 3,5 erhöht; seither ist kein Depottermin mehr versäumt worden. Die Cannabisabstinenz besteht seit März 2024.',
        condition_change: 'gebessert',
        care_need: 'weiter erforderlich',
        care_need_reason: 'Die Erfahrungen der Jahre 2023 und 2024 zeigen, dass in akuten Phasen binnen weniger Tage existenzbedrohende Folgen entstehen. Der Einwilligungsvorbehalt bleibt vorerst erforderlich; eine Überprüfung wird für 2026 in Aussicht genommen.',
        approx_assets: 'P-Konto 184,90 €, Basiskonto 400,00 €, Mietkaution 1.428,60 €. Restverbindlichkeiten rund 5.900 €.',
        discussed: 'ja',
        discussed_date: '2025-06-10'
      }
    }),
    L.archiv(F, 3, {
      reportId: 'annual_noassets', titel: 'Jahresbericht ohne Vermögenssorge', archiviertAm: '2026-06-24', zeit: '09:12',
      erstelltAm: '2026-06-01', von: '01.06.2025', bis: '31.05.2026',
      name: '260624 0912 Amtsgericht Bingen am Rhein Jahresbericht ohne Vermögenssorge',
      notiz: 'Eingereichte Fassung mit der Anregung, den Einwilligungsvorbehalt auf Rechtsgeschäfte über 200 € zu beschränken.',
      felder: {
        residence: 'Gutenbergstraße 14b, 55411 Bingen am Rhein',
        home_placement: 'nein',
        personal_impression: 'Herr Kilic war im gesamten Berichtszeitraum stabil. Bei beiden Hausbesuchen war die Wohnung sauber und geordnet, er selbst gepflegt und gut gelaunt. Die Depotgabe hat er seit April 2024 kein einziges Mal versäumt.',
        condition_change: 'gebessert',
        care_need: 'Aufgabenbereiche sollten geändert werden',
        approx_assets: 'P-Konto 218,44 €, Basiskonto 640,00 €, Mietkaution 1.441,20 €. Restverbindlichkeiten rund 4.500 €.',
        discussed: 'ja',
        discussed_date: '2026-06-16'
      }
    })
  ],

  berichte: {
    initial: L.bericht({
      registered_address: 'Gutenbergstraße 14b, 55411 Bingen am Rhein',
      current_residence: 'Gutenbergstraße 14b, 55411 Bingen am Rhein (eigene Wohnung)',
      residence_type: ['eigene Häuslichkeit'],
      planned_housing_changes: 'Ein Wohnungswechsel ist nicht geplant und von Herrn Kilic ausdrücklich nicht gewünscht. Die Wohnung ist seit 2019 sein Lebensmittelpunkt und für ihn der wichtigste Stabilitätsanker.',
      housing_notes: 'Zweizimmerwohnung mit 54 m² im zweiten Obergeschoss ohne Aufzug. Bei Betreuungsbeginn war die Wohnung stark unaufgeräumt, aber nicht verwahrlost. Die Kosten der Unterkunft von 582 € liegen innerhalb der Angemessenheitsgrenze des Landkreises.',
      treating_doctors: 'Dr. med. Jan Hüttenberger, Psychiatrie und Psychotherapie, Hospitalstraße 2, 55411 Bingen, 06721/994120\nDr. med. Farida Nasser, Allgemeinmedizin, Koblenzer Straße 77, 55411 Bingen, 06721/301744',
      severe_diseases: 'Paranoide Schizophrenie (F20.0), erstmanifestiert 2016 mit stationärer Behandlung in der Rheinhessen-Fachklinik Alzey. Episodischer Verlauf mit stabilem Residuum. Zusätzlich schädlicher Gebrauch von Cannabinoiden und Nikotinabhängigkeit sowie eine 2021 diagnostizierte Refluxösophagitis.',
      treatment_care: 'Ambulante fachärztliche Behandlung bei Dr. Hüttenberger, derzeit orale Medikation mit Risperidon. Hausärztliche Versorgung bei Dr. Nasser. Eine Psychotherapie besteht bislang nicht; der Sozialpsychiatrische Dienst begleitet aufsuchend.',
      resources: 'Herr Kilic ist im stabilen Zustand freundlich, offen und humorvoll. Er kann seinen Alltag weitgehend selbstständig gestalten, kocht selbst, nutzt öffentliche Verkehrsmittel und ist seit April 2021 sozialversicherungspflichtig im Logistikzentrum Rheinhessen beschäftigt. Er nimmt Termine wahr, wenn sie ihm rechtzeitig bekannt sind, und ist bereit, Hilfe anzunehmen. Zur Mutter und zur Schwester besteht ein enger, tragfähiger Kontakt.',
      impairments: 'In akuten Krankheitsphasen treten Verfolgungs- und Beeinträchtigungsideen auf. Die Krankheitseinsicht ist dann aufgehoben, der Kontakt bricht ab, Post bleibt ungeöffnet und Termine werden versäumt. In der Phase 2021 hat Herr Kilic drei Mobilfunkverträge und Bestellungen über rund 2.400 € abgeschlossen, deren Tragweite er nicht überblickte. Daraus resultieren Verbindlichkeiten von rund 9.900 €.',
      care_level: '',
      care_allowance: 'nicht beantragt',
      health_notes: 'Ein Schwerbehindertenausweis ist bislang nicht beantragt; dies soll nachgeholt werden.',
      relatives: 'Ayla Kilic (Mutter), Wilhelmstraße 9, 55218 Ingelheim am Rhein, 06132/447291\nDerya Kilic-Baumann (Schwester), Rheinstraße 52, 55116 Mainz\nMehmet Kilic (Vater), Izmir/Türkei, kein Kontakt seit 2018',
      family_situation: 'Herr Kilic ist ledig und kinderlos. Die Mutter lebt in Ingelheim und hat regelmäßigen, unterstützenden Kontakt; sie ist bei Krisen die erste Ansprechpartnerin. Die Schwester lebt in Mainz und hält telefonischen Kontakt. Zum Vater, der in der Türkei lebt, besteht seit 2018 kein Kontakt mehr. Die Familie hat wiederholt versucht zu helfen, war mit den finanziellen Folgen der Krankheitsphasen aber überfordert.',
      social_contacts: 'Ein Freund aus der früheren Beschäftigung, Herr Grunwald, hält Kontakt. Weitere tragfähige Kontakte bestehen derzeit nicht; die Teilnahme an einer Selbsthilfegruppe wurde angeregt.',
      relationship: 'Das Verhältnis ist von Beginn an sachlich und offen. Herr Kilic hat der Einrichtung der Betreuung im Grundsatz zugestimmt und war erleichtert, dass sich jemand um die Post und die Gläubiger kümmert. Den Einwilligungsvorbehalt kritisiert er offen. Vereinbart wurden ein wöchentliches Auszahlungsbudget von 90 € und ein Hausbesuch etwa alle acht Wochen.',
      social_notes: 'Herr Kilic legt Wert darauf, als Erwachsener behandelt zu werden und Entscheidungen selbst zu treffen. Dieser Anspruch wird respektiert; die Betreuung greift nur ein, wo es zwingend erforderlich ist.',
      employment_status: 'Arbeitsverhältnis',
      employer_occupation: 'Logistikzentrum Rheinhessen GmbH, Bingen – Lagermitarbeiter in Teilzeit seit 04/2021',
      daily_life: 'Herr Kilic arbeitet an vier Tagen in der Woche vormittags im Lager. Nachmittags ist er meist zu Hause, kocht selbst und sieht fern. Der Tagesrhythmus ist verschoben; er geht spät zu Bett und steht spät auf, was an Arbeitstagen zu Problemen führen kann. Am Wochenende besucht er gelegentlich seine Mutter in Ingelheim.',
      goals: 'Sicherung der Wohnung und Vermeidung weiterer Mietrückstände. Ordnung in die finanzielle Lage bringen: Übersicht über alle Forderungen, Ratenvereinbarungen ohne Vollstreckung, Einrichtung eines Pfändungsschutzkontos. Sicherung der laufenden Sozialleistungen und Abwendung der Stromsperre. Stabilisierung der medizinischen Behandlung und Aufbau einer verlässlichen Anbindung. Erhalt der Beschäftigung, solange sie trägt.',
      measures: 'Umwandlung des Girokontos in ein P-Konto und Eröffnung eines Basiskontos als Rücklage. Anschreiben aller sechs Gläubiger und Erhebung des Forderungsstandes. Ratenvereinbarung mit Riverty über 30 € monatlich. Beantragung der Direktzahlung des Stromabschlags nach § 22 Abs. 8 SGB II und dadurch Abwendung der angedrohten Stromsperre. Weiterbewilligung des Bürgergeldes und Vereinbarung einer Aufrechnung statt Vollstreckung. Geplant: Antrag auf Schwerbehindertenausweis, Anbindung an die Schuldnerberatung, Prüfung des Anspruchs auf Ambulant Betreutes Wohnen.',
      against_will: 'Der Einwilligungsvorbehalt für die Vermögenssorge entspricht nicht dem Willen von Herrn Kilic. Er wurde vom Gericht angeordnet, weil in der akuten Phase 2021 Verträge mit erheblichen Folgen abgeschlossen wurden. Die Anordnung wird ihm gegenüber offen begründet; eine Überprüfung ist für den Fall dauerhafter Stabilität in Aussicht gestellt.',
      special_matters: 'Zu regeln sind die Erstattungsforderung des Jobcenters aus 2019, der Vollstreckungsbescheid der Otto GmbH und die Frage, ob eine Verbraucherinsolvenz sinnvoll ist. Die Schuldnerberatung rät derzeit davon ab, weil die Forderungen in Raten bedient werden können.',
      goal_notes: 'Vorrang haben die Sicherung der Wohnung und der Energieversorgung.',
      can_express_wishes: 'ja',
      wishes_care: 'Herr Kilic wünscht sich, dass ihm die Betreuung „den Papierkram abnimmt", ihn aber ansonsten selbst entscheiden lässt. Er möchte über alles informiert werden und keine Entscheidung über seinen Kopf hinweg.',
      wishes_assets: 'Er wünscht ein festes wöchentliches Budget, über das er frei verfügen kann, und dass ihm gesagt wird, wie viel Geld noch da ist. Ein monatlicher Betrag wäre ihm zu unübersichtlich.',
      desired_outcome: 'In seiner Wohnung bleiben, weiterarbeiten und irgendwann schuldenfrei sein.',
      prevent_outcome: 'Er möchte auf keinen Fall wieder in eine Klinik eingewiesen werden und nicht in ein Heim oder eine Wohngruppe ziehen.',
      unfulfillable_wishes: 'Die sofortige Aufhebung des Einwilligungsvorbehalts kann derzeit nicht befürwortet werden, weil die Vertragsabschlüsse der akuten Phase erst wenige Monate zurückliegen.',
      self_managed_assets: 'Herr Kilic verwaltet das wöchentliche Budget von 90 € vollständig selbst und rechnet darüber nicht ab. Über größere Anschaffungen wird gemeinsam entschieden.',
      first_contact: '2022-06-01',
      contact_count: 3,
      future_contacts: 'etwa alle acht Wochen als Hausbesuch, dazwischen telefonisch',
      can_initiate_contact: 'ja',
      contact_limit_reason: '',
      contact_notes: 'In akuten Phasen bricht der Kontakt ab; dann läuft die Verständigung über die Mutter und den Sozialpsychiatrischen Dienst.'
    }, '2022-08-22'),

    annual_noassets: L.bericht({
      residence: 'Gutenbergstraße 14b, 55411 Bingen am Rhein',
      home_placement: 'nein',
      closed_unit: 'nein',
      housing_relinquished: 'nein',
      care_providers: ['versorgt sich selbst', 'sonstige'],
      personal_impression: 'Herr Kilic war im gesamten Berichtszeitraum stabil. Bei beiden Hausbesuchen war die Wohnung sauber und geordnet, er selbst gepflegt und gut gelaunt. Er berichtet offen über Belastungen, meldet sich von sich aus, wenn etwas nicht stimmt, und hält Absprachen ein. Die Depotgabe hat er seit April 2024 kein einziges Mal versäumt. Deutlich spürbar ist sein Wunsch nach mehr Eigenständigkeit: Beim Besuch am 16.06.2026 hat er von sich aus die Aufhebung des Einwilligungsvorbehalts angesprochen und dies mit drei Jahren ohne neue Verbindlichkeiten begründet.',
      condition_change: 'gebessert',
      care_need: 'Aufgabenbereiche sollten geändert werden',
      care_need_reason: 'Die Betreuung bleibt in den Aufgabenkreisen Vermögenssorge, Behördenvertretung, Sozialleistungen und Wohnungsangelegenheiten erforderlich, weil Herr Kilic in akuten Krankheitsphasen den Überblick über Post, Fristen und Zahlungen vollständig verliert und die Folgen einer solchen Phase – Mietrückstand, Kündigung, Stromsperre – existenzbedrohend sind. Für die Gesundheitssorge ist die Betreuung nur noch für den Krisenfall bedeutsam; im stabilen Zustand entscheidet Herr Kilic selbst und nimmt Termine eigenständig wahr. Der Einwilligungsvorbehalt sollte nach drei Jahren ohne neue Verbindlichkeiten auf Rechtsgeschäfte über 200 € beschränkt werden. Dr. Hüttenberger hält dies in seiner Stellungnahme vom 05.08.2026 für vertretbar.',
      last_contact: '2026-08-06',
      contact_frequency: 'nach Bedarf',
      contact_description: 'Im Berichtszeitraum fanden fünf persönliche Hausbesuche sowie zahlreiche Telefonate und Kurznachrichten statt. Herr Kilic meldet sich von sich aus, wenn Post kommt, die er nicht einordnen kann. Bei den Besuchen wird die Post gemeinsam durchgegangen, der Kontostand besprochen und der Schuldenstand aktualisiert. Entscheidungen werden gemeinsam vorbereitet und von ihm getroffen; die Betreuung setzt sie um.',
      approx_assets: 'Pfändungsschutzkonto 218,44 € und Basiskonto (Rücklage) 640,00 € zum 31.07.2026, Mietkaution 1.441,20 €, Wohnungseinrichtung rund 2.100 €. Verbindlichkeiten aus der akuten Krankheitsphase 2021/2022 noch rund 4.500 €, sämtlich in Ratenzahlung ohne Vollstreckung. Erwerbungen oder Erbschaften gab es nicht; angeschafft wurden Laufschuhe für das ärztlich empfohlene Bewegungsprogramm. Genehmigungs- oder anzeigepflichtige Geschäfte waren im Berichtszeitraum nicht zu tätigen.',
      other_report: 'Herr Kilic hat im Juli 2026 ein Praktikum bei der Tafel Bingen aufgenommen und arbeitet dort an zwei Vormittagen wöchentlich. Der Integrationsfachdienst prüft ein Budget für Arbeit. Die Cannabisabstinenz besteht seit März 2024. Die Bewilligung der Eingliederungshilfe läuft zum 31.12.2026 aus; die Fortschreibung des Gesamtplans ist beantragt. Gegen die Betriebskostenabrechnung 2025 wurde Widerspruch eingelegt.',
      discussed: 'ja',
      discussed_date: '2026-06-16',
      discussed_reason: '',
      view_contacts: 'Herr Kilic bewertet die Kontakte als „genau richtig". Häufigere Besuche empfände er als Kontrolle, seltenere als Vernachlässigung. Er schätzt, dass er selbst anrufen kann, wenn etwas ist.',
      view_goals: 'Er teilt die Ziele Wohnungssicherung und Entschuldung ausdrücklich. Beim Thema Arbeit betont er, dass er den allgemeinen Arbeitsmarkt anstrebt und eine Werkstatt weiterhin ablehnt.',
      view_need: 'Herr Kilic hält die Betreuung für die Behörden und die Schulden weiterhin für sinnvoll. Beim Einwilligungsvorbehalt widerspricht er: „Das brauche ich nicht mehr." Diese Einschätzung wird in Teilen geteilt; eine Beschränkung wird angeregt.'
    }, '2026-06-24'),

    remuneration: L.bericht({
      rem_stage: '2',
      rem_request_type: 'Folgeantrag',
      rem_continuous: 'nein'
    }, '2026-06-09'),

    remuneration_pdf: L.bericht({
      remuneration_pdf_name: 'Emre Kilic',
      remuneration_pdf_birth: '1993-08-22',
      remuneration_pdf_address: 'Gutenbergstraße 14b, 55411 Bingen am Rhein',
      remuneration_pdf_reference: '4 XVII 88/22',
      remuneration_pdf_details: 'Vergütungsabschnitt 01.03.2026 bis 31.05.2026. Vergütung nach § 8 VBVG, Vergütungstabelle A (eigene Häuslichkeit), Vergütungsstufe 2, ab dem 25. Monat der Betreuung. Monatliche Pauschale 134,00 €, Abrechnungszeitraum drei Monate, Gesamtbetrag 402,00 €. Herr Kilic ist mittellos im Sinne des § 1880 BGB; die Vergütung wird aus der Staatskasse beantragt.',
      remuneration_pdf_attachments: 'Bewilligungsbescheid des Jobcenters Landkreis Mainz-Bingen vom 24.02.2026 (BG 0917442) als Nachweis der Mittellosigkeit, Meldebescheinigung.',
      remuneration_pdf_notes: 'Die Wohnform hat sich im Abrechnungszeitraum nicht geändert.'
    }, '2026-06-09'),

    citizen_benefit_continuation: L.bericht({
      wba_period_end: '03.2027',
      wba_first_name: 'Emre',
      wba_last_name: 'Kilic',
      wba_birth_date: '22.08.1993',
      wba_bg_number: 'BG 0917442',
      wba_street: 'Gutenbergstraße',
      wba_house_no: '14b',
      wba_postal: '55411',
      wba_city: 'Bingen am Rhein',
      wba_lives_alone: 'ja',
      wba_housing_needs: 'ja',
      wba_housing_type: 'Miete / sonstiges Wohnverhältnis',
      wba_basic_rent: '464',
      wba_service_costs: '118',
      wba_heating_costs: '0',
      wba_other_housing_costs: '0',
      wba_inclusive_rent: '582',
      wba_employment_income: 'nein',
      wba_deductions_changed: 'nein',
      wba_self_employed: 'nein',
      wba_allowances: 'nein',
      wba_social_income: 'nein',
      wba_other_income: 'nein',
      wba_other_income_details: 'Seit Juli 2026 nimmt Herr Kilic an zwei Vormittagen wöchentlich an einem unentgeltlichen Praktikum bei der Tafel Bingen e. V. teil. Eine Vergütung oder Aufwandsentschädigung wird nicht gezahlt; anrechenbare Einnahmen entstehen dadurch nicht.',
      wba_foreseeable_changes: ['Erwerbsfähigkeit / gesundheitliche Lage'],
      wba_foreseeable_details: 'Für Anfang 2027 ist die Erprobung eines Budgets für Arbeit über den Integrationsfachdienst vorgesehen. Sobald ein Arbeitsverhältnis zustande kommt, wird dies unverzüglich angezeigt.',
      wba_third_party_claim: 'nein',
      wba_accident: 'nein',
      wba_unreported_changes: 'nein',
      wba_attachments: ['Kontoauszüge der letzten drei Monate', 'Nachweise Unterkunft und Heizung', 'weitere Anlagen'],
      wba_attachments_other: 'Mietbescheinigung der Wohnbau Bingen GmbH vom 12.02.2026, Betriebskostenabrechnung 2025 nebst eingelegtem Widerspruch, Bescheid über die Eingliederungshilfe (EGH 2023/4471), Praktikumsbescheinigung der Tafel Bingen.',
      wba_applicant_date: '2026-02-24',
      wba_guardian_date: '2026-02-24'
    }, '2026-02-24'),

    sgb9_initial_application: L.bericht({
      sgb9_initial_application_name: 'Emre Kilic',
      sgb9_initial_application_birth: '1993-08-22',
      sgb9_initial_application_address: 'Gutenbergstraße 14b, 55411 Bingen am Rhein',
      sgb9_initial_application_reference: 'EGH 2023/4471',
      sgb9_initial_application_benefit: 'Fortschreibung der Assistenzleistungen zur selbstbestimmten Lebensführung in eigenem Wohnraum (Ambulant Betreutes Wohnen, § 78 SGB IX) mit 3,5 Fachleistungsstunden wöchentlich',
      sgb9_initial_application_start: '01.01.2027, Bewilligungszeitraum zunächst zwei Jahre',
      sgb9_initial_application_household: 'Herr Kilic lebt allein in einer Zweizimmerwohnung mit 54 m² im zweiten Obergeschoss. Eine Bedarfsgemeinschaft besteht nicht. Die Mutter wohnt in Ingelheim am Rhein und ist im Krisenfall erste Ansprechpartnerin, kann die laufende Unterstützung aber nicht leisten.',
      sgb9_initial_application_income: 'Bürgergeld nach dem SGB II (Jobcenter Landkreis Mainz-Bingen, BG 0917442): Regelbedarf 506,00 € abzüglich einer Aufrechnung von 10 % (50,60 €), zuzüglich Bedarf für Unterkunft und Heizung von 582,00 € als Direktzahlung an den Vermieter. Weitere Einnahmen bestehen nicht; das Praktikum bei der Tafel Bingen ist unentgeltlich.',
      sgb9_initial_application_assets: 'P-Konto bei der Sparkasse Rhein-Nahe mit 218,44 € (Stand 31.07.2026), Basiskonto als Rücklage mit 640,00 €, Mietkaution 1.441,20 €. Verbindlichkeiten von rund 4.500 € aus der akuten Krankheitsphase 2021/2022 werden über Ratenvereinbarungen bedient; eine Vollstreckung findet nicht statt. Verwertbares Vermögen oberhalb des Schonbetrages besteht nicht.',
      sgb9_initial_application_needs: 'Paranoide Schizophrenie (F20.0) mit episodischem Verlauf und stabilem Residuum, erstmanifestiert 2016. Zwei Krisen mit stationärer beziehungsweise teilstationärer Behandlung 2023 und 2024. In stabilen Phasen führt Herr Kilic seinen Haushalt selbstständig; in akuten Phasen bricht die Alltagsbewältigung innerhalb weniger Tage zusammen: Post bleibt ungeöffnet, Termine werden versäumt, die Wohnung verwahrlost. 2023 stand die Wohnung deshalb unmittelbar vor dem Verlust. Seit der Erhöhung der Fachleistungsstunden von 2 auf 3,5 im April 2024 ist der Verlauf durchgehend stabil. Die wöchentliche Begleitung erfüllt zwei Funktionen: Sie stützt die Alltagsstruktur und erkennt Frühwarnzeichen, bevor eine Krise eskaliert. Eine Reduzierung würde gerade diese Frühwarnfunktion entfallen lassen.',
      sgb9_initial_application_notes: 'Herr Kilic beantragt die Fortschreibung ausdrücklich selbst und nimmt an der Teilhabeplankonferenz am 27.10.2026 teil. Beigefügt: Sachstandsbericht des Betreuten Wohnens Rheinhessen e. V. vom 31.07.2026, fachärztliche Stellungnahme Dr. med. Jan Hüttenberger vom 05.08.2026, aktueller Bürgergeldbescheid.'
    }, '2026-08-06'),

    free_document: L.bericht({
      free_subject: 'Widerspruch gegen die Betriebskostenabrechnung 2025',
      free_reference: 'Betriebskostenabrechnung 2025 – Mietvertrag Gutenbergstraße 14b, 55411 Bingen am Rhein',
      free_text: '<p>Sehr geehrte Damen und Herren,</p><p>gegen Ihre Betriebskostenabrechnung für das Jahr 2025 vom 18.06.2026, zugegangen am 21.06.2026, lege ich namens und in Vollmacht meines Betreuten, Herrn Emre Kilic, hiermit fristgerecht Widerspruch ein.</p><p>Die Abrechnung weist eine Nachforderung von 384,20 € aus. Die Prüfung durch den Mieterverein Bingen ergab, dass die Heizkosten entgegen § 7 Abs. 1 HeizkostenV nicht zu mindestens 50 vom Hundert nach dem erfassten Verbrauch verteilt wurden, sondern vollständig nach der Wohnfläche. Zudem ist der Ansatz für die Position „Hausmeisterdienste" gegenüber dem Vorjahr um 41 vom Hundert gestiegen, ohne dass hierfür eine Erläuterung beigefügt wäre.</p><p>Ich bitte daher um eine korrigierte Abrechnung sowie um Einsicht in die zugrunde liegenden Belege nach § 259 BGB. Bis zur Klärung wird die Nachforderung nicht ausgeglichen; ein Zurückbehaltungsrecht wird ausdrücklich geltend gemacht.</p><p>Für eine Rückmeldung bis zum 30.09.2026 wäre ich dankbar.</p>',
    }, '2026-08-06')
  }
};

/* Faehigkeiten & Alltag: Istzustand je Lebensbereich, Alltagsgestaltung und
   Wunschaeusserung. Grundlage sind Hausbesuche, der Sachstandsbericht des
   Betreuten Wohnens und die Angaben von Herrn Kilic selbst. */
module.exports.faehigkeiten = L.profil(F, {
  stand: '2026-08-06',
  bereiche: {
    communication: {
      ressourcen: 'Herr Kilic drückt sich sprachlich differenziert aus, führt Telefonate mit Behörden selbstständig und schreibt E-Mails. Er kann Anliegen sachlich vortragen und hat in der Teilhabeplankonferenz 2024 seine Position eigenständig vertreten. Deutsch und Türkisch beherrscht er auf muttersprachlichem Niveau und übersetzt für seine Mutter.',
      einschraenkungen: 'In akuten Krankheitsphasen bricht die Kommunikation weitgehend ab: Er geht nicht ans Telefon, öffnet keine Post und meidet Kontakt – 2023 über sechs Wochen hinweg. Bei Misstrauensschüben deutet er neutrale Formulierungen in Bescheiden als Bedrohung. Konflikte spricht er selten von sich aus an, sondern zieht sich zurück.',
      quelle: 'Hausbesuche 2026, Sachstandsbericht Betreutes Wohnen Rheinhessen e. V. vom 31.07.2026',
      erhoben: '2026-08-06', wiedervorlage: '2027-02-28'
    },
    orientation: {
      ressourcen: 'Zu Person, Ort, Zeit und Situation vollständig orientiert. Er überblickt seine rechtliche Situation, kennt den Umfang der Betreuung und weiß, welche Entscheidungen er selbst trifft. Bei Alltagsentscheidungen wägt er nachvollziehbar ab und begründet seine Wahl.',
      einschraenkungen: 'In der Prodromalphase treten Beziehungsideen und Bedeutungszuschreibungen auf, die die Realitätsprüfung vorübergehend einschränken; 2023 führte dies zur Unterbringung nach § 1831 BGB. Bei Entscheidungen mit langem Zeithorizont – Ratenverträge, Versicherungsabschlüsse – neigt er auch in stabilen Phasen dazu, Folgekosten zu unterschätzen.',
      quelle: 'Fachärztliche Stellungnahme Dr. Hüttenberger vom 05.08.2026',
      erhoben: '2026-08-05', wiedervorlage: '2027-08-31'
    },
    mobility: {
      ressourcen: 'Uneingeschränkt mobil. Herr Kilic fährt Fahrrad, nutzt Bus und Bahn selbstständig auch für längere Strecken und war 2025 allein bei Verwandten in Mainz. Termine außerhalb Bingens erreicht er ohne Begleitung.',
      einschraenkungen: 'Keine körperlichen Einschränkungen. In Phasen erhöhter Anspannung meidet er volle Busse und größere Bahnhöfe, was einzelne Termine zur Folge hatte, die er nicht wahrgenommen hat.',
      quelle: 'Hausbesuch 12.05.2026, Angaben von Herrn Kilic',
      erhoben: '2026-05-12', bericht: false
    },
    health_selfcare: {
      ressourcen: 'Die vierwöchentliche Depotmedikation nimmt Herr Kilic seit April 2024 zuverlässig wahr und trägt die Termine selbst in sein Handy ein. Fachärztliche Termine bei Dr. Hüttenberger und die Suchtberatung besucht er eigenständig. Er erkennt eigene Frühwarnzeichen – Schlafstörungen und vermehrtes Grübeln – zunehmend selbst und hat sich 2025 zweimal von sich aus früher vorgestellt. Cannabisabstinenz seit März 2024.',
      einschraenkungen: 'In akuten Phasen setzt er die Medikation eigenmächtig ab, so 2023 und 2024. Die Körperpflege vernachlässigt er dann ebenso wie regelmäßige Mahlzeiten. Die Zahnsanierung wurde erst nach mehrfacher Terminvermittlung abgeschlossen. Nikotinkonsum von rund 20 Zigaretten täglich; ein Reduktionsversuch 2025 wurde abgebrochen.',
      bedarfe: ['gdp-k-08'],
      quelle: 'Fachärztliche Stellungnahme 05.08.2026, Sachstandsbericht Betreutes Wohnen',
      erhoben: '2026-08-06', wiedervorlage: '2026-08-20'
    },
    housing_household: {
      ressourcen: 'In stabilen Phasen führt Herr Kilic seine Zweizimmerwohnung selbstständig: Er kocht regelmäßig, hält Küche und Bad sauber und wäscht seine Wäsche. Seit Einführung des Reinigungsplans mit der Bezugsbetreuung im Juli 2024 ist der Zustand der Wohnung durchgehend ordentlich. Die Wohnung ist ihm wichtig und er benennt sie selbst als seinen wichtigsten Halt.',
      einschraenkungen: 'In akuten Phasen bricht die Haushaltsführung binnen weniger Tage zusammen; 2023 und Anfang 2024 kam es zu Vermüllung und Geruchsbelästigung. Reparaturmeldungen an den Vermieter und die Kommunikation mit der Hausverwaltung übernimmt er nicht von sich aus. Die Wohnung liegt im zweiten Obergeschoss ohne Aufzug, was derzeit unproblematisch ist.',
      quelle: 'Hausbesuche 12.05. und 06.08.2026, Sachstandsbericht Betreutes Wohnen',
      erhoben: '2026-08-06', wiedervorlage: '2027-01-31'
    },
    daily_social: {
      ressourcen: 'Feste wöchentliche Struktur durch das Praktikum bei der Tafel Bingen (dienstags und donnerstags) und die Bezugsbetreuung montags. Kontakt zur Mutter in Ingelheim mehrmals wöchentlich telefonisch, Besuche etwa monatlich. Im Sportverein spielt er unregelmäßig Fußball. Zur Bezugsbetreuerin Frau Wehrle besteht ein tragfähiges Vertrauensverhältnis über drei Jahre.',
      einschraenkungen: 'Der Freundeskreis ist seit der Erkrankung stark ausgedünnt; zu den früheren Freunden besteht kaum noch Kontakt, teils bewusst wegen des Cannabiskonsums im alten Umfeld. Neue Kontakte knüpft er kaum. An Wochenenden ohne Termine bleibt er häufig den ganzen Tag in der Wohnung. Zum Vater besteht seit 2019 kein Kontakt.',
      quelle: 'Hausbesuche 2026, Angaben von Herrn Kilic und der Bezugsbetreuung',
      erhoben: '2026-08-06', wiedervorlage: '2026-11-30'
    },
    work_education: {
      ressourcen: 'Abgeschlossene Ausbildung zum Fachlageristen (2014) und Berufserfahrung bis 2021. Seit Oktober 2025 unentgeltliches Praktikum bei der Tafel Bingen mit zwei Vormittagen pro Woche, das er bislang zuverlässig wahrnimmt und aus dem er sichtbar Selbstwert zieht. Gabelstaplerschein vorhanden und gültig. Er möchte ausdrücklich wieder arbeiten.',
      einschraenkungen: 'Seit 2021 keine sozialversicherungspflichtige Beschäftigung. Eine Belastung von mehr als etwa vier Stunden am Stück führte 2024 im Arbeitsversuch zu Erschöpfung und Rückzug. Schichtarbeit ist wegen des Schlaf-Wach-Rhythmus und der Medikation ausgeschlossen. Bewerbungsunterlagen erstellt er nicht selbstständig.',
      quelle: 'Arbeitsversuch 2024, Praktikumsrückmeldung Tafel Bingen vom 30.06.2026',
      erhoben: '2026-07-08', wiedervorlage: '2026-12-31'
    },
    authorities_law: {
      ressourcen: 'Herr Kilic öffnet seine Post in stabilen Phasen selbst, sortiert Behördenschreiben aus und legt sie zum Hausbesuch bereit. Er ruft beim Jobcenter an, meldet Änderungen und hat 2025 einen Weiterbewilligungsantrag mit Unterstützung selbst ausgefüllt. Termine bei Behörden nimmt er allein wahr.',
      einschraenkungen: 'Fristen erkennt er nicht zuverlässig; unbeantwortete Schreiben führten 2022 zu einer vorübergehenden Leistungseinstellung. Rechtsmittel formuliert er nicht selbst. In akuten Phasen bleibt Post ungeöffnet liegen. Ein Einwilligungsvorbehalt für den Bereich Vermögenssorge besteht seit 2022 und steht 2026 zur Überprüfung an.',
      quelle: 'Betreuerbericht 2026, Beschluss AG Bingen vom 07.06.2022',
      erhoben: '2026-08-06', wiedervorlage: '2026-10-31'
    },
    finance_assets: {
      ressourcen: 'Über das Verfügungsbudget von 60 € wöchentlich entscheidet Herr Kilic selbstständig und kommt damit regelmäßig aus. Er kennt seine Kontostände, nutzt Online-Banking lesend und meldet ungewöhnliche Abbuchungen von sich aus. Den Ratenplänen zur Entschuldung hat er zugestimmt und fragt aktiv nach dem Stand der Restforderungen.',
      einschraenkungen: 'In der akuten Phase 2021/2022 entstanden Verbindlichkeiten von rund 9.900 € durch Onlinebestellungen, Mobilfunk- und Abonnementverträge. Größere Beträge kann er nicht über einen Monat hinweg einteilen. Verträge unterschreibt er ohne Prüfung der Folgekosten; deshalb besteht der Einwilligungsvorbehalt. Das P-Konto weist regelmäßig zum Monatsende einen Stand unter 50 € auf.',
      bedarfe: ['gdp-k-02'],
      quelle: 'Rechnungslegung 2025, Schuldenübersicht Stand 31.07.2026',
      erhoben: '2026-08-06', wiedervorlage: '2026-12-31'
    }
  },
  alltag: {
    zusammenfassung: 'Herr Kilic lebt allein in einer Zweizimmerwohnung in Bingen und führt seinen Alltag in stabilen Phasen weitgehend selbstständig. Die Woche ist durch das Praktikum, den Termin mit der Bezugsbetreuung und die Depotgabe strukturiert. Der Verlauf ist seit April 2024 durchgehend stabil. Die Wochenenden ohne feste Termine sind der anfälligste Teil der Woche.',
    tagesablauf: 'Aufstehen zwischen 8:00 und 9:30 Uhr, an Praktikumstagen um 7:00 Uhr. Dienstags und donnerstags 8:30 bis 12:30 Uhr Tafel Bingen. Montags 10:00 Uhr Bezugsbetreuung in der Wohnung. Nachmittags Einkauf, Haushalt oder Spaziergang am Rheinufer. Abends überwiegend Fernsehen und Handy. Zubettgehen selten vor Mitternacht; unter Depotmedikation schläft er durch.',
    haushalt: 'Kocht an vier bis fünf Tagen der Woche selbst, überwiegend einfache warme Mahlzeiten. Einkauf einmal wöchentlich im Discounter mit Einkaufszettel. Wäsche alle zehn bis vierzehn Tage. Reinigungsplan mit der Bezugsbetreuung seit Juli 2024, wird zu etwa achtzig Prozent eingehalten. Kleinreparaturen und Vermieterkontakt übernimmt die rechtliche Betreuung.',
    selbstversorgung: 'Körperpflege und Kleidung altersentsprechend und unauffällig. Depotmedikation alle vier Wochen in der Praxis Dr. Hüttenberger, Termine trägt er selbst ein. Ernährung ausgewogen, Gewicht stabil. Nikotinkonsum rund 20 Zigaretten täglich, Cannabisabstinenz seit März 2024, monatliche Kontrolle über die Suchtberatung.',
    beschaeftigung: 'Praktikum Tafel Bingen zwei Vormittage wöchentlich seit Oktober 2025. Unregelmäßige Teilnahme am Fußballtraining des SV Bingerbrück. Psychotherapie vierzehntägig bei Frau Lindqvist seit Mai 2024. Suchtberatung der Caritas vierwöchentlich.',
    teilhabe: 'Enger telefonischer Kontakt zur Mutter, monatliche Besuche in Ingelheim, gemeinsame Feiertage. Kontakt zur Schwester lockerer, etwa vierteljährlich. Im Praktikum kollegialer Kontakt zu zwei Mitarbeitenden der Tafel. Vereinzelte Kontakte im Sportverein. Eigene Freundschaften bestehen derzeit nicht.',
    unterstuetzung: 'Ambulant Betreutes Wohnen mit 3,5 Fachleistungsstunden wöchentlich (Betreutes Wohnen Rheinhessen e. V., Bezugsbetreuung Frau Wehrle). Facharzt Dr. Hüttenberger vierwöchentlich. Psychotherapie vierzehntägig. Caritas-Suchtberatung vierwöchentlich. Rechtliche Betreuung mit monatlichem Kontakt und vierteljährlichem Hausbesuch.',
    quelle: 'Hausbesuch 06.08.2026, Sachstandsbericht Betreutes Wohnen vom 31.07.2026',
    erhoben: '2026-08-06', wiedervorlage: '2027-01-31'
  },
  wunsch: {
    status: 'ja',
    begruendung: 'Herr Kilic äußert seine Wünsche klar, begründet und beständig. Er hat in der Teilhabeplankonferenz 2024 eigenständig widersprochen, als eine stationäre Wohnform vorgeschlagen wurde, und seine Gründe schriftlich nachgereicht. Auch unangenehme Anliegen bringt er vor, wenn ihm Zeit gelassen wird.',
    unterstuetzung: 'Bei komplexen Entscheidungen: schriftliche Zusammenfassung der Möglichkeiten und mindestens eine Woche Bedenkzeit; er entscheidet erkennbar besser, wenn er nicht im Gespräch antworten muss. In Phasen erhöhter Anspannung sollten wichtige Entscheidungen verschoben werden. Auf Wunsch wird die Bezugsbetreuerin hinzugezogen.',
    wege: ['spoken', 'writing'],
    quelle: 'Teilhabeplankonferenz 21.11.2024, Hausbesuche 2026',
    erhoben: '2026-08-06', wiedervorlage: '2027-08-31'
  },
  verlauf: [
    ['2023-05-30', 'Profil erstmals angelegt (nach Unterbringung und Wohnungssicherung)'],
    ['2024-04-18', 'Bereiche „Gesundheit und Selbstversorgung" und „Wohnen und Haushaltsführung" nach Erhöhung der Fachleistungsstunden aktualisiert'],
    ['2025-10-14', 'Bereich „Arbeit und Bildung" nach Beginn des Praktikums fortgeschrieben'],
    ['2026-08-06', 'Gesamtprofil für die Fortschreibung der Eingliederungshilfe überprüft']
  ]
});
