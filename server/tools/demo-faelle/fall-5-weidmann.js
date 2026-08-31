'use strict';
/* Demonstrationsfall 5 - Jonas Weidmann.
   Profil: 21 Jahre, fruehkindlicher Autismus mit leichter Intelligenzminderung,
   Werkstatt fuer behinderte Menschen und Aussenwohngruppe, Eingliederungshilfe,
   Eltern als aktive Unterstuetzer, Betreuung seit der Volljaehrigkeit 2023 -
   der junge Fall mit Uebergang Schule/Beruf, Budget fuer Arbeit und Elternkonflikt. */

const L = require('./lib');
const F = 'w';

const person = {
  salutation: 'Herr', title: '', gender: 'männlich',
  firstName: 'Jonas', lastName: 'Weidmann', birthName: '',
  birthDate: '17.02.2005', birthPlace: 'Neuwied', birthCountry: 'Deutschland',
  nationality: 'deutsch', nationality2: '',
  maritalStatus: 'ledig', maritalSince: '',
  religion: 'evangelisch',
  street: 'Wiedbachstraße', streetOnly: 'Wiedbachstraße', house: '28', houseNumber: '28', houseLetter: '',
  postal: '56567', postalCode: '56567', city: 'Neuwied', postbox: '', country: 'Deutschland',
  foreignCity: '',
  address: 'Wiedbachstraße 28, 56567 Neuwied',
  institution: 'Außenwohngruppe „Wiedblick" der Lebenshilfe Neuwied, Wiedbachstraße 28, 56567 Neuwied',
  phone: '02631/9440215', mobile: '0159/02214477', email: 'jonas.weidmann@example-mail.de', fax: '',
  idCardNumber: 'W2K5J8MRT', residencePermitNumber: '',
  taxId: '39 447 120 885', pensionInsuranceNumber: '25 170205 W 044',
  contributionNumber: 'AOK 4471-170-205', socialOfficeNumber: 'EGH-NR 2023/1157',
  fullName: 'Jonas Weidmann'
};

const care = {
  authorityName: 'Betreuungsbehörde Landkreis Neuwied',
  authorityCity: 'Neuwied',
  authorityFileNumber: 'BtB-NR 2023/0288',
  courtName: 'Amtsgericht Neuwied',
  courtStreet: 'Hermannstraße 34', courtPostbox: '', courtPostal: '56564', courtCity: 'Neuwied',
  courtAddressComplete: 'True',
  courtAddressSource: 'Justizportal Rheinland-Pfalz, geprüft 03.02.2026',
  courtVerificationStatus: 'verified',
  courtVerificationCheckedAt: '2026-02-03T08:55:00.000Z',
  fileNumber: '9 XVII 62/23',
  requestDate: '14.11.2022',
  preliminaryOrderDate: '',
  orderDate: '06.02.2023',
  officeHandoverDate: '15.02.2023',
  startDate: '17.02.2023',
  takeoverDate: '17.02.2023',
  handoverDate: '',
  reportPeriod: '01.03. - 28.02.',
  reviewDate: '16.02.2030',
  endDate: '',
  homePlacement: 'ja',
  nextAccountingDue: '31.03.2027',
  taskAreaDetails: [
    { name: 'Vermögenssorge', consentReservation: true },
    { name: 'Gesundheitssorge', consentReservation: false },
    { name: 'Aufenthaltsbestimmung', consentReservation: false },
    { name: 'Wohnungsangelegenheiten', consentReservation: false },
    { name: 'Vertretung gegenüber Behörden, Versicherungen, Renten- und Sozialleistungsträgern', consentReservation: false },
    { name: 'Geltendmachung von Ansprüchen auf Sozialleistungen', consentReservation: false },
    { name: 'Heim- und Pflegeangelegenheiten', consentReservation: false },
    { name: 'Post- und Fernmeldeangelegenheiten', consentReservation: false }
  ]
};
care.taskAreas = care.taskAreaDetails.map((t) => t.name);

const healthInfo = {
  insurance: 'AOK Rheinland-Pfalz/Saarland',
  insuranceNumber: 'A447117020',
  careLevel: '2',
  bloodType: 'A-',
  allergies: 'Erdnüsse (anaphylaktische Reaktion 2013, Notfallset vorhanden), Hausstaubmilben',
  diagnosesNotes: 'Jonas Weidmann kann seinen Willen deutlich äußern, benötigt für komplexe Entscheidungen aber Unterstützung in leichter Sprache und Bedenkzeit. Entscheidungen niemals im ersten Gespräch abfragen; bewährt hat sich, eine Frage zu stellen und die Antwort beim nächsten Termin zu besprechen. Reizarme Umgebung, feste Abläufe und Ankündigung von Veränderungen sind wesentlich.',
  diagnoses: [
    { icd: 'F84.0', text: 'Frühkindlicher Autismus', since: '2009-06-15' },
    { icd: 'F70.1', text: 'Leichte Intelligenzminderung mit deutlicher Verhaltensstörung', since: '2011-09-08' },
    { icd: 'G40.3', text: 'Generalisierte idiopathische Epilepsie, anfallsfrei seit 2021', since: '2016-04-02' },
    { icd: 'F98.8', text: 'Stereotype Bewegungsstörungen', since: '2010-03-11' },
    { icd: 'T78.2', text: 'Anaphylaktische Reaktion auf Erdnüsse', since: '2013-05-27' },
    { icd: 'K59.09', text: 'Chronische Obstipation', since: '2019-11-14' }
  ],
  medications: [
    { name: 'Levetiracetam', dose: '500 mg', schedule: '1-0-1' },
    { name: 'Risperidon', dose: '1 mg', schedule: '0-0-1' },
    { name: 'Melatonin', dose: '2 mg retard', schedule: '0-0-1' },
    { name: 'Macrogol', dose: '1 Beutel', schedule: '1-0-0' },
    { name: 'Adrenalin-Autoinjektor', dose: '300 µg', schedule: 'Notfallmedikation, im Rucksack und in der Werkstatt' }
  ],
  doctors: [
    { name: 'Dr. med. Cornelia Bracht', field: 'Fachärztin für Kinder- und Jugendpsychiatrie / Transitionsambulanz', phone: '02631/8404120', email: 'transition@rfk-neuwied.de' },
    { name: 'Dr. med. Peter Ostermann', field: 'Allgemeinmedizin (Hausarzt)', phone: '02631/354180', email: 'praxis@ostermann-neuwied.de' },
    { name: 'Dr. med. Ingrid Wahlbrink', field: 'Neurologie / Epileptologie', phone: '0261/4962440', email: 'epilepsie@gk-mittelrhein.de' },
    { name: 'Dr. med. Kai Löffler', field: 'Zahnmedizin (Behandlung in Sedierung)', phone: '02631/221900', email: 'praxis@zahn-loeffler-nr.de' }
  ],
  emergency: [
    { name: 'Sabine Weidmann', relation: 'Mutter', phone: '02631/774120', email: 's.weidmann@example-mail.de' },
    { name: 'Thomas Weidmann', relation: 'Vater', phone: '', email: 't.weidmann@example-mail.de' },
    { name: 'Außenwohngruppe Wiedblick – Nachtbereitschaft', relation: 'Einrichtung', phone: '02631/9440215', email: 'wiedblick@lebenshilfe-neuwied.de' }
  ],
  appointments: [
    { id: L.id('hia', F, 1), doctor: 'Dr. Bracht', reason: 'Transitionsambulanz, Verlaufskontrolle Risperidon', from: '2026-01-13', to: '', note: 'Deutlich weniger Anspannungsepisoden seit dem Umzug in die Wohngruppe.', recommendation: 'Dosis unverändert, Kontrolle in sechs Monaten' },
    { id: L.id('hia', F, 2), doctor: 'Dr. Wahlbrink', reason: 'Epilepsie-Kontrolle, EEG und Spiegelbestimmung', from: '2026-02-19', to: '', note: 'Anfallsfrei seit 2021, EEG unauffällig.', recommendation: 'Reduktionsversuch Levetiracetam erwägen, Entscheidung im Herbst' },
    { id: L.id('hia', F, 3), doctor: 'Dr. Löffler', reason: 'Zahnsanierung in Sedierung', from: '2026-03-25', to: '', note: 'Zwei Füllungen und Zahnsteinentfernung. Vorbereitung mit Bildkarten über zwei Wochen.', recommendation: 'Halbjährliche Kontrolle, Prophylaxe im Wohnbereich' },
    { id: L.id('hia', F, 4), doctor: 'Dr. Ostermann', reason: 'Jahresuntersuchung, Auffrischung Notfallset', from: '2026-05-07', to: '', note: 'Adrenalin-Autoinjektoren erneuert, Einweisung der Werkstatt aufgefrischt.', recommendation: 'Jährliche Wiederholung' },
    { id: L.id('hia', F, 5), doctor: 'Dr. Bracht', reason: 'Stellungnahme für das Gesamtplanverfahren', from: '2026-06-24', to: '', note: 'Befürwortet die Erprobung eines Budgets für Arbeit mit engmaschiger Begleitung.', recommendation: '' },
    { id: L.id('hia', F, 6), doctor: 'Dr. Wahlbrink', reason: 'Besprechung Reduktionsversuch Antiepileptikum', from: '2026-09-15', to: '', note: 'Termin vereinbart; Jonas Weidmann wird mit Bildkarten vorbereitet.', recommendation: '' }
  ],
  hospital: [
    { id: L.id('hih', F, 1), clinic: 'Marienhaus Klinikum St. Elisabeth Neuwied, Kinderklinik', reason: 'Anaphylaktische Reaktion nach Erdnussverzehr', from: '2013-05-27', to: '2013-05-30', note: 'Vor Einrichtung der Betreuung. Seither Notfallset.', recommendation: 'Allergenkarenz, Notfallset immer mitführen' },
    { id: L.id('hih', F, 2), clinic: 'Gemeinschaftsklinikum Mittelrhein, Neuropädiatrie Koblenz', reason: 'Erstmanifestation generalisierter Anfälle, Einstellung auf Levetiracetam', from: '2016-04-02', to: '2016-04-14', note: 'Vor Einrichtung der Betreuung.', recommendation: 'Regelmäßige EEG-Kontrollen' },
    { id: L.id('hih', F, 3), clinic: 'Rheinhessen-Fachklinik Alzey, Klinik für Menschen mit geistiger Behinderung', reason: 'Krisenaufnahme bei massiver Anspannung mit Selbstverletzung', from: '2023-09-04', to: '2023-10-20', note: 'Auslöser: abrupter Wechsel der Bezugsbetreuung in der damaligen Wohngruppe. Freiwillige Aufnahme mit Zustimmung von Jonas Weidmann. Einstellung auf Risperidon.', recommendation: 'Reizarme Wohnform, feste Bezugspersonen, Wechsel ankündigen' },
    { id: L.id('hih', F, 4), clinic: 'Marienhaus Klinikum St. Elisabeth Neuwied, Chirurgie', reason: 'Distale Radiusfraktur links nach Sturz in der Werkstatt', from: '2025-04-14', to: '2025-04-17', note: 'Konservative Versorgung. Aufklärung mit Bildkarten, Einwilligung durch Jonas Weidmann selbst nach Erläuterung.', recommendation: 'Gips fünf Wochen, danach Ergotherapie' }
  ],
  procedures: [
    { id: L.id('hip', F, 1), procedure: 'Zahnsanierung in Sedierung (drei Sitzungen)', doctor: 'Dr. Löffler', from: '2024-05-14', to: '2024-09-10', note: 'Behandlung in Sedierung wegen ausgeprägter Behandlungsangst. Einwilligung durch die Betreuung nach Aufklärung; Jonas Weidmann hat nach Erläuterung mit Bildkarten zugestimmt.', recommendation: 'Halbjährliche Kontrolle' },
    { id: L.id('hip', F, 2), procedure: 'Zahnsanierung in Sedierung (Kontrolle und zwei Füllungen)', doctor: 'Dr. Löffler', from: '2026-03-25', to: '2026-03-25', note: 'Vorbereitung mit Bildkarten über zwei Wochen; Ablauf verlief deutlich ruhiger als 2024.', recommendation: 'Prophylaxe im Wohnbereich fortführen' },
    { id: L.id('hip', F, 3), procedure: 'Anpassung Kommunikationstablet mit Symbolsoftware (MetaTalkDE)', doctor: 'Sanitätshaus Rheinvital / Beratungsstelle UK', from: '2024-11-05', to: '2025-01-20', note: 'Kostenübernahme durch die AOK nach Widerspruch.', recommendation: 'Jährliche Aktualisierung des Vokabulars' },
    { id: L.id('hip', F, 4), procedure: 'Ergotherapie nach Radiusfraktur', doctor: 'Praxis Sonnenschein Neuwied', from: '2025-05-26', to: '2025-08-11', note: 'Zehn Einheiten, volle Funktion wiederhergestellt.', recommendation: 'Kein weiterer Bedarf' }
  ]
};

const schulden = [
  L.schuld(F, 1, {
    erfasstAm: '2023-06-08', forderungsbeginn: '2023-03-01',
    glaeubiger: 'Telefónica Germany (o2)', kategorie: 'Handyvertrag / Mobilfunk',
    aktenzeichen: 'O2-2023-447120', hauptforderung: 684.9, mahnkosten: 18.5,
    ratenhoehe: 40, ratenintervall: 'monatlich', status: 'erledigt',
    basisGezahlt: 703.4, erledigtAm: '2024-11-15',
    notizen: 'Vertrag mit Gerätekauf, im März 2023 im Einkaufszentrum abgeschlossen. Anlass für den Einwilligungsvorbehalt. Ratenzahlung vereinbart, vollständig getilgt.'
  }),
  L.schuld(F, 2, {
    erfasstAm: '2024-02-19', forderungsbeginn: '2024-01-01',
    glaeubiger: 'Lebenshilfe Neuwied gGmbH (Verpflegungsanteil)', kategorie: 'Heimkosten / Pflegesatz (stationäre Einrichtung)',
    aktenzeichen: 'LH-NR-2024-0088', hauptforderung: 412.8, mahnkosten: 0,
    status: 'erledigt', basisGezahlt: 412.8, erledigtAm: '2024-04-30',
    notizen: 'Rückstand des Verpflegungsanteils, entstanden durch eine verspätete Bewilligung der Grundsicherung. Nach Nachzahlung des Sozialamts ausgeglichen.'
  }),
  L.schuld(F, 3, {
    erfasstAm: '2025-07-14', forderungsbeginn: '2025-06-01',
    glaeubiger: 'Sanitätshaus Rheinvital GmbH', kategorie: 'Heil- und Hilfsmittel (Schuhe, Orthesen, Rollator etc.)',
    aktenzeichen: 'RV-25-6640', hauptforderung: 289, mahnkosten: 0,
    ratenhoehe: 50, ratenintervall: 'monatlich', status: 'Ratenzahlung',
    dauerauftrag: true, basisGezahlt: 0,
    bankverbindung: { iban: 'DE29 5705 0120 0000 4471 88', bic: 'MALADE51KOB', kontoinhaber: 'Sanitätshaus Rheinvital GmbH' },
    verwendungszweck: 'RV-25-6640 Schutzhülle und Halterung Kommunikationstablet',
    raten: [['2025-08-01', 50], ['2025-09-01', 50], ['2025-10-01', 50], ['2025-11-01', 50]],
    notizen: 'Eigenanteil für die robuste Schutzhülle und die Rollstuhl-/Tischhalterung des Kommunikationstablets; von der Kasse nicht übernommen.'
  })
];

module.exports = {
  label: 'Weidmann, Jonas',
  fileNumber: '9 XVII 62/23',
  createdAt: '2023-02-17 09:30:00',
  betreuer: 'christoph zepp',
  uebersicht: { periodStart: '2026-07-01', aenderungsart: 'unverändert fortgeführt', uebergabeAn: '' },
  kontaktmonitor: { turnusDays: 60, baseline: '2026-06-09', lastContact: '2026-08-07', lastArt: 'persönlich (Einrichtung / Klinik)' },

  stammdaten: {
    person,
    care,
    rechtlicherBetreuer: 'christoph zepp',
    health: {
      careLevel: '2', disabilityDegree: '90',
      marks: ['G', 'B', 'H'], marksText: 'G, B, H',
      copayExemption: 'ja, befreit bis 31.12.2026', valueMark: 'ja',
      insurer: 'AOK Rheinland-Pfalz/Saarland', insuranceNumber: 'A447117020'
    },
    healthInfo,
    benefits: [
      { category: 'Grundsicherung', basis: 'SGB XII (4. Kapitel)', benefitName: 'Grundsicherung bei Erwerbsminderung (dauerhaft voll erwerbsgemindert)', applicationDate: '20.02.2023', validUntil: '31.08.2027', provider: 'Kreisverwaltung Neuwied, Sozialamt', fileNumber: 'GruSi-NR 2023/0844' },
      { category: 'Eingliederungshilfe', basis: 'SGB IX (Teil 2)', benefitName: 'Leistungen im Arbeitsbereich einer Werkstatt für behinderte Menschen', applicationDate: '11.05.2023', validUntil: 'unbefristet', provider: 'Landesamt für Soziales, Jugend und Versorgung – Eingliederungshilfe', fileNumber: 'EGH-NR 2023/1157' },
      { category: 'Eingliederungshilfe', basis: 'SGB IX (Teil 2)', benefitName: 'Besondere Wohnform – Außenwohngruppe mit Assistenz', applicationDate: '02.11.2023', validUntil: '31.10.2027', provider: 'Landesamt für Soziales, Jugend und Versorgung – Eingliederungshilfe', fileNumber: 'EGH-NR 2023/1157-W' },
      { category: 'Pflege', basis: 'SGB XI', benefitName: 'Pflegegrad 2', applicationDate: '15.03.2023', validUntil: 'unbefristet', provider: 'AOK Pflegekasse Rheinland-Pfalz/Saarland', fileNumber: 'PK-A447117020' },
      { category: 'Schwerbehindertenrecht', basis: 'SGB IX', benefitName: 'GdB 90, Merkzeichen G, B und H', applicationDate: '08.03.2023', validUntil: '31.03.2028', provider: 'Landesamt für Soziales, Jugend und Versorgung Koblenz', fileNumber: 'SB 2023/44 712' },
      { category: 'Rundfunk', basis: 'RBStV', benefitName: 'Befreiung vom Rundfunkbeitrag (Merkzeichen H / Grundsicherung)', applicationDate: '19.04.2023', validUntil: '31.08.2027', provider: 'ARD ZDF Deutschlandradio Beitragsservice', fileNumber: '885 447 122' },
      { category: 'Mobilität', basis: 'SGB IX', benefitName: 'Wertmarke zur unentgeltlichen Beförderung, unentgeltlich bei Merkzeichen H', applicationDate: '08.03.2023', validUntil: '31.03.2028', provider: 'Landesamt für Soziales, Jugend und Versorgung Koblenz', fileNumber: 'WM 2023/44 712' },
      { category: 'Familienleistung', basis: 'EStG / BKGG', benefitName: 'Kindergeld über die Volljährigkeit hinaus wegen Behinderung, Abzweigung an die betreute Person', applicationDate: '06.03.2023', validUntil: 'unbefristet', provider: 'Familienkasse Rheinland-Pfalz-Saarland', fileNumber: 'FK 447 120 885' }
    ],
    identifiers: [
      { type: 'Personalausweis', number: 'W2K5J8MRT', validUntil: '21.02.2029', status: 'gültig' },
      { type: 'Steuerliche Identifikationsnummer', number: '39 447 120 885', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Rentenversicherungsnummer', number: '25 170205 W 044', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Krankenversichertennummer', number: 'A447117020', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Schwerbehindertenausweis', number: 'SB 2023/44 712', validUntil: '31.03.2028', status: 'gültig' },
      { type: 'Aktenzeichen / Geschäftszeichen', number: 'EGH-NR 2023/1157', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Aktenzeichen / Geschäftszeichen', number: 'GruSi-NR 2023/0844', validUntil: '31.08.2027', status: 'aktiv' },
      { type: 'Kunden-/Mitgliedsnummer', number: 'FK 447 120 885', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Kunden-/Mitgliedsnummer', number: '885 447 122', validUntil: '31.08.2027', status: 'aktiv' }
    ],
    insurances: [
      { type: 'Gesundheitsversicherung (gesetzlich)', institution: 'AOK Rheinland-Pfalz/Saarland', number: 'A447117020', details: 'Pflichtversichert über die Werkstatt (§ 5 Abs. 1 Nr. 7 SGB V), zuzahlungsbefreit' },
      { type: 'Pflegezusatzversicherung', institution: 'AOK Pflegekasse Rheinland-Pfalz/Saarland', number: 'PK-A447117020', details: 'Pflegegrad 2 seit 01.04.2023' },
      { type: 'Rentenversicherung', institution: 'Deutsche Rentenversicherung Bund', number: '25 170205 W 044', details: 'Pflichtversichert über die WfbM, Beiträge nach 80 % der Bezugsgröße' },
      { type: 'Unfallversicherung', institution: 'Unfallkasse Rheinland-Pfalz', number: 'UK-WfbM-4471', details: 'Gesetzliche Unfallversicherung über die Werkstatt' },
      { type: 'Privathatfplicht', institution: 'Gothaer Allgemeine Versicherung AG', number: 'PHV 8854-4712', details: 'Eigene Police seit 01.03.2023, Jahresbeitrag 68,40 € (zuvor über die Eltern mitversichert)' },
      { type: 'Hausratversicherung', institution: 'nicht erforderlich', number: '--', details: 'Zimmer in der Wohngruppe, Inventar über die Einrichtung versichert' }
    ],
    banks: [
      { type: 'Girokonto', institution: 'Sparkasse Neuwied', bankName: 'Sparkasse Neuwied', iban: 'DE47 5745 0120 0044 7117 02', bic: 'MALADE51NWD', accountHolder: 'Jonas Weidmann', saldo: '486,22', saldoDatum: '31.07.2026', verwendungszweck: 'Verwaltungskonto der Betreuung', connectionId: '' },
      { type: 'Sparkonto', institution: 'Sparkasse Neuwied', bankName: 'Sparkasse Neuwied', iban: 'DE20 5745 0120 0044 7117 03', bic: 'MALADE51NWD', accountHolder: 'Jonas Weidmann', saldo: '2840,00', saldoDatum: '31.07.2026', verwendungszweck: 'Ansparung (Schonvermögen), Ziel: eigene Wohnung', connectionId: '' },
      { type: 'Treuhandkonto', institution: 'Lebenshilfe Neuwied gGmbH', bankName: 'Sparkasse Neuwied', iban: 'DE93 5745 0120 0094 4021 50', bic: 'MALADE51NWD', accountHolder: 'Jonas Weidmann (Barbetrag Wohngruppe)', saldo: '68,40', saldoDatum: '31.07.2026', verwendungszweck: 'Barbetragsverwaltung der Wohngruppe', connectionId: '' }
    ],
    budget: { type: 'Wochengeld', amount: '55,00', method: 'Bar an die betreute Person' },
    assetManagement: [
      { type: 'Wochengeld', amount: '55,00', method: 'Bar an die betreute Person' },
      { type: 'Bekleidungsgeld', amount: '45,00', method: 'Überweisung' },
      { type: 'Barbetrag', amount: '30,00', method: 'Bar an die Einrichtung' }
    ],
    accommodation: {
      type: 'Wohnheim',
      currentResidence: {
        sameAsRegistered: true,
        institution: 'Außenwohngruppe „Wiedblick" der Lebenshilfe Neuwied gGmbH, Appartement 4',
        type: 'Heim/Einrichtung',
        street: 'Wiedbachstraße', houseNumber: '28', houseLetter: '',
        postalCode: '56567', city: 'Neuwied', postbox: '', foreignCity: '', country: 'Deutschland'
      },
      monthlyCost: '2148,00', serviceCosts: '', electricityCosts: '', gasCosts: '',
      basicRent: '398,00', heatingCosts: '92,00', heatingType: 'Gasheizung',
      hotWater: 'Zentral (über Heizung)', hotWaterPreparation: 'Zentral (über Heizung)', heating: 'Gasheizung',
      housingSecurity: { status: 'secured', details: 'Wohn- und Betreuungsvertrag vom 24.10.2023, unbefristet' },
      accessibility: { status: 'accessible', details: 'Erdgeschoss, schwellenlos, reizarm gestaltet; eigenes Appartement mit Bad' },
      currentProblems: { status: 'none', details: 'Derzeit keine' },
      supportForms: ['Besondere Wohnform mit Assistenz', 'Werkstatt für behinderte Menschen', 'Unterstützte Kommunikation', 'Heilpädagogische Begleitung'],
      supportDetails: 'Außenwohngruppe mit sechs Plätzen und Assistenz am Morgen, am Abend und am Wochenende, Nachtbereitschaft im Haupthaus. Bezugsassistenz Frau Ivanova. Werktags Arbeit im Arbeitsbereich der Werkstatt Neuwied (Montage und Verpackung). Unterstützte Kommunikation über ein Tablet mit Symbolsoftware. Heilpädagogische Einzelbegleitung einmal wöchentlich.',
      housingSecurityEntries: [
        L.wohnEintrag(F, 'security', 1, { von: '2023-02-17', bis: '2023-10-31', status: 'temporary', details: 'Zunächst weiter im Elternhaus in Neuwied-Engers; Übergang in eine Wohnform war Gegenstand des Gesamtplanverfahrens.' }),
        L.wohnEintrag(F, 'security', 2, { von: '2023-11-01', bis: '2024-08-31', status: 'at_risk', details: 'Erste Wohngruppe „Am Mühlbach": nach dem Wechsel der Bezugsbetreuung massive Anspannung, Krisenaufnahme, danach nicht mehr tragfähig.' }),
        L.wohnEintrag(F, 'security', 3, { von: '2024-09-01', status: 'secured', details: 'Umzug in die Außenwohngruppe „Wiedblick" mit eigenem Appartement und reizärmerer Struktur. Unbefristeter Wohn- und Betreuungsvertrag.', stand: '2026-08-07' })
      ],
      accessibilityEntries: [
        L.wohnEintrag(F, 'accessibility', 1, { von: '2024-09-01', status: 'accessible', details: 'Erdgeschossappartement, schwellenlos, eigenes Bad, reizarm gestaltet (gedämpfte Farben, schallabsorbierende Elemente, Rückzugsecke).', stand: '2026-06-09' })
      ],
      currentProblemEntries: [
        L.wohnEintrag(F, 'problems', 1, { von: '2023-08-15', bis: '2024-08-31', status: 'present', details: 'Massive Anspannung mit Selbstverletzung nach abruptem Wechsel der Bezugsbetreuung; Krisenaufnahme in der Rheinhessen-Fachklinik.' }),
        L.wohnEintrag(F, 'problems', 2, { von: '2025-04-14', bis: '2025-08-11', status: 'present', details: 'Nach der Radiusfraktur eingeschränkte Selbstständigkeit beim Anziehen und in der Werkstatt; vorübergehend erhöhter Assistenzbedarf.' }),
        L.wohnEintrag(F, 'problems', 3, { von: '2025-08-12', status: 'none', details: 'Volle Funktion wiederhergestellt, keine aktuellen Probleme.', stand: '2026-08-07' })
      ],
      supportEntries: [
        L.wohnEintrag(F, 'support', 1, { von: '2024-09-01', status: 'active', formen: ['Besondere Wohnform mit Assistenz'], details: 'Außenwohngruppe Wiedblick, Assistenz morgens, abends und am Wochenende, Nachtbereitschaft. Bezugsassistenz Frau Ivanova seit Einzug – ein Wechsel wird ausdrücklich vermieden.', stand: '2026-08-07' }),
        L.wohnEintrag(F, 'support', 2, { von: '2023-08-01', status: 'active', formen: ['Werkstatt für behinderte Menschen'], details: 'Berufsbildungsbereich 08/2023 bis 07/2025, seither Arbeitsbereich Montage und Verpackung.', stand: '2026-08-07' }),
        L.wohnEintrag(F, 'support', 3, { von: '2025-01-20', status: 'active', formen: ['Unterstützte Kommunikation'], details: 'Kommunikationstablet mit Symbolsoftware MetaTalkDE, Vokabular jährlich aktualisiert; Schulung von Wohngruppe, Werkstatt und Eltern erfolgt.', stand: '2026-08-07' }),
        L.wohnEintrag(F, 'support', 4, { von: '2024-10-01', status: 'active', formen: ['Heilpädagogische Begleitung'], details: 'Einmal wöchentlich Einzelbegleitung, Schwerpunkt Selbstwirksamkeit und Umgang mit Veränderungen.', stand: '2026-08-07' }),
        L.wohnEintrag(F, 'support', 5, { von: '2023-02-17', bis: '2023-10-31', status: 'ended', formen: ['Unterstützung durch Angehörige'], details: 'Vollständige Versorgung im Elternhaus bis zum Umzug in die erste Wohngruppe.' })
      ]
    },
    provisions: L.vorsorge([
      ['patientenverfuegung', 'Nicht vorhanden', '--'],
      ['betreuungsverfuegung', 'Nicht vorhanden', '--'],
      ['vorsorgevollmacht', 'Nicht vorhanden', '--'],
      ['testament', 'Nicht vorhanden', '--'],
      ['vorsorgeregister', 'Nicht vorhanden', '--'],
      ['organspende', 'Unbekannt', '--'],
      ['totenfuersorge', 'Vorhanden', '--'],
      ['sonstiges_vorsorge', 'Vorhanden', 'NP-2024-0311'],
      ['digitaler_nachlass', 'Nicht vorhanden', '--'],
      ['kontovollmacht', 'Nicht vorhanden', '--'],
      ['bestattungsvorsorge', 'Nicht vorhanden', '--']
    ]),
    socialNetwork: [
      { status: 'Aktiv', role: 'Mutter', detail: 'Mutter, sehr engagiert', salutation: 'Sehr geehrte Frau', firstName: 'Sabine', lastName: 'Weidmann', institution: '', street: 'Am Kirchberg', house: '14', postal: '56566', city: 'Neuwied', phone: '02631 / 774120', mobile: '0171 / 4471228', email: 's.weidmann@example-mail.de', fullName: 'Sabine Weidmann', address: 'Am Kirchberg 14, 56566 Neuwied', birthDate: '08.07.1972' },
      { status: 'Aktiv', role: 'Vater', detail: 'Vater', salutation: 'Sehr geehrter Herr', firstName: 'Thomas', lastName: 'Weidmann', institution: '', street: 'Am Kirchberg', house: '14', postal: '56566', city: 'Neuwied', phone: '02631 / 774120', mobile: '0172 / 8840217', email: 't.weidmann@example-mail.de', fullName: 'Thomas Weidmann', address: 'Am Kirchberg 14, 56566 Neuwied', birthDate: '22.11.1969' },
      { status: 'Aktiv', role: 'Schwester', detail: 'Schwester, Studentin', salutation: 'Sehr geehrte Frau', firstName: 'Lena', lastName: 'Weidmann', institution: '', street: 'Kaiser-Friedrich-Straße', house: '9', postal: '55116', city: 'Mainz', phone: '', mobile: '0157 / 22447118', email: 'lena.weidmann@example-mail.de', fullName: 'Lena Weidmann', address: 'Kaiser-Friedrich-Straße 9, 55116 Mainz', birthDate: '03.09.2001' },
      { status: 'Aktiv', role: 'Peer / Bezugsperson', detail: 'Bezugsassistenz Wohngruppe', salutation: 'Sehr geehrte Frau', firstName: 'Nadja', lastName: 'Ivanova', institution: 'Lebenshilfe Neuwied gGmbH, Außenwohngruppe Wiedblick', street: 'Wiedbachstraße', house: '28', postal: '56567', city: 'Neuwied', phone: '02631 / 9440215', mobile: '', email: 'ivanova@lebenshilfe-neuwied.de', fullName: 'Nadja Ivanova', address: 'Wiedbachstraße 28, 56567 Neuwied' },
      { status: 'Aktiv', role: 'Peer / Bezugsperson', detail: 'Gruppenleitung Werkstatt', salutation: 'Sehr geehrter Herr', firstName: 'Rainer', lastName: 'Dombrowski', institution: 'Werkstatt Neuwied der Lebenshilfe, Arbeitsbereich Montage', street: 'Industriestraße', house: '17', postal: '56566', city: 'Neuwied', phone: '02631 / 944100', mobile: '', email: 'dombrowski@lebenshilfe-neuwied.de', fullName: 'Rainer Dombrowski', address: 'Industriestraße 17, 56566 Neuwied' },
      { status: 'Aktiv', role: 'Freund:in', detail: 'Mitbewohner und Werkstattkollege', salutation: 'Sehr geehrter Herr', firstName: 'Kevin', lastName: 'Ackermann', institution: 'Außenwohngruppe Wiedblick', street: 'Wiedbachstraße', house: '28', postal: '56567', city: 'Neuwied', phone: '', mobile: '', email: '', fullName: 'Kevin Ackermann', address: 'Wiedbachstraße 28, 56567 Neuwied' },
      { status: 'Aktiv', role: 'Verein (Freizeit)', detail: 'Fußballgruppe Special Olympics', salutation: 'Sehr geehrte Damen und Herren', institution: 'TuS Neuwied, Inklusive Fußballgruppe', street: 'Sportplatzweg', house: '3', postal: '56566', city: 'Neuwied', phone: '02631 / 887720', mobile: '', email: 'inklusion@tus-neuwied.de', fullName: 'TuS Neuwied – Inklusive Fußballgruppe', address: 'Sportplatzweg 3, 56566 Neuwied' },
      { status: 'Aktiv', role: 'Betreuung', detail: 'rechtliche Betreuung', salutation: 'Sehr geehrter Herr', firstName: 'Christoph', lastName: 'Zepp', institution: 'Testbüroname', street: 'Marktplatz', house: '8', postal: '56346', city: 'St. Goarshausen', phone: '06771 / 959410', mobile: '', email: 'kanzlei@testbueroname.de', fullName: 'Christoph Zepp', address: 'Marktplatz 8, 56346 St. Goarshausen' }
    ],
    contactProfile: {
      understanding: 'with_support',
      trust: 'good',
      cooperation: 'cooperative',
      participation: 'with_support',
      conflicts: 'occasional',
      assessedAt: '2026-06-09',
      communicationMethods: ['spoken', 'simple_language', 'device', 'gesture', 'third_party'],
      communicationSupport: 'Leichte Sprache, kurze Sätze, jeweils nur eine Frage. Jonas Weidmann nutzt seit 2025 ein Kommunikationstablet mit Symbolsoftware, mit dem er auch längere Aussagen zusammensetzt. Termine werden mit Bildkarten angekündigt, Veränderungen mindestens zwei Wochen vorher. Entscheidungen werden nie im ersten Gespräch abgefragt: Die Frage wird gestellt, ein Termin zum Nachdenken vereinbart und die Antwort beim nächsten Besuch besprochen. Bei Anspannung hilft der Rückzug in sein Appartement.',
      conflictDescription: 'Gelegentliche Spannungen nicht mit Jonas Weidmann selbst, sondern zwischen seinem geäußerten Willen und den Sorgen seiner Eltern – etwa bei der Erprobung des Budgets für Arbeit, die die Mutter zunächst ablehnte. Die Konflikte werden in gemeinsamen Gesprächen bearbeitet; maßgeblich ist der Wille von Jonas Weidmann.',
      evidenceSource: 'Besuche am 09.06.2026 und 07.08.2026, Rückmeldung der Bezugsassistenz Frau Ivanova und der Gruppenleitung Herrn Dombrowski, Stellungnahme Dr. Bracht vom 24.06.2026',
      canInitiateContact: 'bedingt',
      initiationSupport: 'Mit Unterstützung der Bezugsassistenz; eigenständig per Sprachnachricht auf dem Mobiltelefon',
      initiationChannels: ['mobile', 'facility', 'third_party', 'in_person'],
      initiationLimitationReason: 'Jonas Weidmann kann eine Sprachnachricht senden, wenn ihm ein Anliegen wichtig ist, und tut dies etwa alle zwei Monate. Ein Telefonat zu führen oder ein Anliegen strukturiert vorzutragen gelingt ihm nicht; dabei unterstützt die Bezugsassistenz.',
      reportRemarks: 'Persönliche Kontakte finden etwa alle sechs bis acht Wochen in der Außenwohngruppe statt, zusätzlich bei Gesamtplan- und Werkstattterminen. Jonas Weidmann erkennt die Betreuungsperson und begrüßt sie mit einer festen Geste. Über das Kommunikationstablet äußert er sich zunehmend eigenständig zu Wünschen. Wesentliche Entscheidungen werden mit Bedenkzeit über zwei Termine vorbereitet. Die Zusammenarbeit mit Wohngruppe und Werkstatt ist eng; mit den Eltern besteht regelmäßiger Austausch, bei dem der Wille von Jonas Weidmann ausdrücklich im Mittelpunkt steht.'
    },
    handkasse: L.handkasse(F, [
      ['2026-03-02', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 10', 'Barbetrag', 55],
      ['2026-03-07', 'ausgabe', 'Kiosk am Sportplatz', 'Getränke nach dem Fußballtraining', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 6.5],
      ['2026-03-09', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 11', 'Barbetrag', 55],
      ['2026-03-16', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 12', 'Barbetrag', 55],
      ['2026-03-21', 'ausgabe', 'Media Markt Neuwied', 'Kopfhörer (Lärmschutz)', 'Anschaffung PC/Tablet/Handy', 64.9],
      ['2026-03-23', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 13', 'Barbetrag', 55],
      ['2026-04-06', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 15', 'Barbetrag', 55],
      ['2026-04-11', 'ausgabe', 'Kino Metropol Neuwied', 'Kinobesuch mit der Wohngruppe', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 12],
      ['2026-04-20', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 17', 'Barbetrag', 55],
      ['2026-04-25', 'ausgabe', 'C&A Neuwied', 'Sommerkleidung, zwei Hosen und Shirts', 'Kleidung / Schuhe', 89.9],
      ['2026-05-04', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 19', 'Barbetrag', 55],
      ['2026-05-16', 'ausgabe', 'TuS Neuwied', 'Halbjahresbeitrag Fußballgruppe', 'Vereinsbeiträge (Sport, Musik, etc.)', 42],
      ['2026-05-18', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 21', 'Barbetrag', 55],
      ['2026-06-01', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 23', 'Barbetrag', 55],
      ['2026-06-09', 'ausgabe', 'Jonas Weidmann', 'Barauszahlung bei Besuch', 'Taschengeldzahlungen an Angehörige (falls vereinbart)', 30],
      ['2026-06-15', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 25', 'Barbetrag', 55],
      ['2026-06-27', 'ausgabe', 'Freizeitbad Deichwelle', 'Schwimmbadbesuch mit der Wohngruppe', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 9.5],
      ['2026-07-06', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 28', 'Barbetrag', 55],
      ['2026-07-18', 'ausgabe', 'Werkstatt Neuwied', 'Beitrag Sommerfest und Grillen', 'Teilnahmebeiträge an Gruppenangeboten, Kursen, Begegnungsstätten', 8],
      ['2026-07-20', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 30', 'Barbetrag', 55],
      ['2026-08-03', 'einnahme', 'Sparkasse Neuwied', 'Wochengeld KW 32', 'Barbetrag', 55],
      ['2026-08-07', 'ausgabe', 'Jonas Weidmann', 'Barauszahlung bei Besuch', 'Taschengeldzahlungen an Angehörige (falls vereinbart)', 30]
    ]),
    assets: {
      begin: L.posten(F, 'vab', [
        ['Bargeld', 'Barbestand bei Betreuungsübernahme', '', 45],
        ['Girokonto', 'Kontostand 17.02.2023, Jugendkonto', 'Sparkasse Neuwied', 312.4],
        ['Sparkonto', 'Sparbuch, von den Eltern seit der Geburt bespart', 'Sparkasse Neuwied', 4820],
        ['Wertvolle Möbel / Haushaltsgeräte (sofern von Bedeutung)', 'Persönliche Ausstattung im Elternhaus (Schreibtisch, Bett, Regal)', '', 700],
        ['Guthaben aus Bonus-/Treueprogrammen (wenn nennenswert)', 'Guthaben Prepaid-Karte', '', 18.6]
      ]),
      end: L.posten(F, 'vae', [
        ['Girokonto', 'Kontostand 31.07.2026, Verwaltungskonto', 'Sparkasse Neuwied', 486.22],
        ['Sparkonto', 'Ansparung (Schonvermögen), Ziel eigene Wohnung', 'Sparkasse Neuwied', 2840],
        ['Treuhandkonto', 'Barbetragskonto der Wohngruppe', 'Lebenshilfe Neuwied gGmbH', 68.4],
        ['Wertvolle Möbel / Haushaltsgeräte (sofern von Bedeutung)', 'Ausstattung Appartement 4 (Bett, Schrank, Schreibtisch, Fernseher)', '', 1450],
        ['Bargeld', 'Barbestand nach Besuch 07.08.2026', '', 30]
      ]),
      debtsBegin: [
        ...L.posten(F, 'vsb', []),
        ...L.schuldenSpiegel(schulden, 'begin')
      ],
      debtsEnd: [
        ...L.posten(F, 'vse', []),
        ...L.schuldenSpiegel(schulden, 'end')
      ]
    },
    livelihood: {
      income: L.einnahmen(F, [
        ['Werkstattlohn (WfbM)', 'Arbeitsentgelt im Arbeitsbereich (Grundbetrag und Steigerungsbetrag)', 'Werkstatt Neuwied der Lebenshilfe', 'monatlich', 226],
        ['Grundsicherung im Alter und bei Erwerbsminderung', 'Grundsicherung nach dem 4. Kapitel SGB XII, existenzsichernder Bedarf in der besonderen Wohnform', 'Kreisverwaltung Neuwied, Sozialamt', 'monatlich', 743.5],
        ['Kindergeld', 'Kindergeld über die Volljährigkeit hinaus wegen Behinderung, an die betreute Person abgezweigt', 'Familienkasse Rheinland-Pfalz-Saarland', 'monatlich', 255],
        ['Geldleistungen aus der Eingliederungshilfe (z. B. Persönliches Budget)', 'Fachleistungen Wohnen und Arbeiten (Sachleistung)', 'Landesamt für Soziales, Jugend und Versorgung', 'monatlich', 0],
        ['Regelmäßige freiwillige Zuwendungen / Taschengeld von Angehörigen', 'Zuwendung der Eltern zu Geburtstag und Weihnachten', 'Sabine und Thomas Weidmann', 'jährlich', 25]
      ]),
      expenses: L.ausgaben(F, [
        ['Heimkosten / Pflegesatz (stationäre Einrichtung)', 'Gesamtentgelt der Außenwohngruppe (existenzsichernder Anteil und Fachleistungen)', 'Lebenshilfe Neuwied gGmbH', 'monatlich', 2148, 'Laufende Kosten'],
        ['Miete', 'Existenzsichernder Anteil (Wohnraum) im Gesamtentgelt', 'Lebenshilfe Neuwied gGmbH', 'monatlich', 398, 'Laufende Kosten'],
        ['Heizung / Gas / Fernwärme', 'Heizkostenanteil im Gesamtentgelt', 'Lebenshilfe Neuwied gGmbH', 'monatlich', 92, 'Laufende Kosten'],
        ['Handyvertrag / Prepaid-Aufladung', 'Prepaid-Guthaben Mobiltelefon', 'Aldi Talk', 'monatlich', 10, 'Laufende Kosten'],
        ['Haftpflichtversicherung', 'Privathaftpflicht, Jahresbeitrag umgelegt', 'Gothaer Allgemeine Versicherung AG', 'jährlich', 5.7, 'Laufende Kosten'],
        ['Kontoführungsgebühren', 'Girokonto Sparkasse Neuwied', 'Sparkasse Neuwied', 'monatlich', 3.9, 'Laufende Kosten'],
        ['Kleidung / Schuhe', 'Bekleidungspauschale', '', 'monatlich', 45, ''],
        ['Vereinsbeiträge (Sport, Musik, etc.)', 'Inklusive Fußballgruppe TuS Neuwied', 'TuS Neuwied', 'halbjährlich', 7, ''],
        ['Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 'Kino, Schwimmbad, Ausflüge der Wohngruppe', '', 'monatlich', 25, ''],
        ['Ratenzahlung Versandhandel / Möbelhaus / Elektronikmarkt', 'Rate Eigenanteil Zubehör Kommunikationstablet', 'Sanitätshaus Rheinvital GmbH', 'monatlich', 50, 'Ratenzahlungsvereinbarung geschlossen'],
        ['Anschaffung PC/Tablet/Handy', 'Ansparung für Ersatzgerät und Zubehör', '', 'monatlich', 20, '']
      ])
    },
    schuldenregulierung: schulden,
    approvals: L.genehmigungen(F, [
      ['2023-10-16', 'Heimvertrag / Wechsel der Wohnform', 'Abschluss des Wohn- und Betreuungsvertrages mit der Wohngruppe „Am Mühlbach" der Lebenshilfe Neuwied', 'Einwilligung nach Beratung', 'genehmigt', '2023-10-24', '2023-11-01', 'Erster Auszug aus dem Elternhaus. Jonas Weidmann hat nach Probewohnen an drei Wochenenden und mit Bedenkzeit über zwei Termine zugestimmt. Die Eltern trugen die Entscheidung mit.'],
      ['2024-07-22', 'Heimvertrag / Wechsel der Wohnform', 'Kündigung des Wohn- und Betreuungsvertrages „Am Mühlbach" und Abschluss eines neuen Vertrages mit der Außenwohngruppe „Wiedblick"', 'Einwilligung', 'genehmigt', '2024-08-13', '2024-09-01', 'Nach der Krise im Herbst 2023 war die erste Wohngruppe nicht mehr tragfähig. Jonas Weidmann hat die neue Gruppe zweimal besucht und über sein Tablet deutlich „ja" und „ruhig" geäußert.'],
      ['2024-04-29', 'Einwilligung in gefährliche Heilbehandlung / Operation (§ 1829 BGB)', 'Zahnsanierung in Sedierung (drei Sitzungen)', 'Einwilligung nach Beratung', 'erledigt', '', '2024-05-14', 'Kein begründetes Risiko im Sinne des § 1829 Abs. 2 BGB; gerichtliche Genehmigung nicht erforderlich. Aufklärung durch Dr. Löffler, Vorbereitung mit Bildkarten. Jonas Weidmann hat nach der Erläuterung zugestimmt.'],
      ['2024-11-05', 'Sonstiges', 'Beschaffung eines Kommunikationstablets mit Symbolsoftware, Widerspruch gegen den Ablehnungsbescheid der AOK', 'Einwilligung', 'erledigt', '', '2025-01-20', 'Keine Genehmigung erforderlich. Widerspruch mit Stellungnahme der Beratungsstelle für Unterstützte Kommunikation; die AOK half ab.'],
      ['2026-02-10', 'Sonstiges', 'Erprobung eines Budgets für Arbeit bei der Gärtnerei Hoffmann (Übergang aus dem Arbeitsbereich der Werkstatt)', 'Einwilligung', 'beantragt', '', '', 'Jonas Weidmann äußert seit Sommer 2025 wiederholt den Wunsch, „draußen" zu arbeiten. Die Mutter hat erhebliche Bedenken. Nach zwei gemeinsamen Gesprächen und der Stellungnahme von Dr. Bracht wurde die Erprobung im Gesamtplanverfahren beantragt.'],
      ['2026-08-05', 'Sonstiges', 'Reduktionsversuch der antiepileptischen Medikation (Levetiracetam) nach fünf anfallsfreien Jahren', 'Beratungsbedarf', 'erwogen', '', '', 'Dr. Wahlbrink hält einen Reduktionsversuch für vertretbar. Vor der Entscheidung sind die Auswirkungen mit Jonas Weidmann in leichter Sprache zu erörtern und die Eltern einzubeziehen. Termin am 15.09.2026.']
    ]),
    fristen: L.fristen(F, [
      ['Gesamtplankonferenz – Budget für Arbeit', 'Antrag', 'Landesamt für Soziales, Jugend und Versorgung', '2026-02-10', '2026-09-24', 'high', 'offen', 'Konferenz terminiert. Teilnahme von Jonas Weidmann, den Eltern, Werkstatt, Wohngruppe und Integrationsfachdienst.'],
      ['Jahresbericht 01.03.2025 – 28.02.2026 an das Betreuungsgericht', 'Bericht', 'Amtsgericht Neuwied', '2026-02-28', '2026-03-31', 'high', 'erledigt', 'Eingereicht am 24.03.2026 nebst Rechnungslegung.'],
      ['Weiterbewilligung Grundsicherung ab 01.09.2027', 'Weiterbewilligung', 'Kreisverwaltung Neuwied, Sozialamt', '2027-08-31', '2027-07-15', 'high', 'offen', 'Bewilligungszeitraum endet 31.08.2027.'],
      ['Fortschreibung Gesamtplan Wohnen', 'Antrag', 'Landesamt für Soziales, Jugend und Versorgung', '2027-10-31', '2027-08-31', 'normal', 'offen', 'Bewilligung der besonderen Wohnform bis 31.10.2027.'],
      ['Entscheidung über Reduktionsversuch Levetiracetam', 'Sonstige', 'Dr. med. Ingrid Wahlbrink', '2026-08-05', '2026-09-15', 'normal', 'offen', 'Vor der Entscheidung Erörterung in leichter Sprache und Gespräch mit den Eltern.'],
      ['Verlängerung Schwerbehindertenausweis und Wertmarke', 'Antrag', 'Landesamt für Soziales, Jugend und Versorgung Koblenz', '2028-03-31', '2028-01-31', 'normal', 'offen', 'Ausweis und Wertmarke gültig bis 31.03.2028.'],
      ['Vergütungsantrag 3. Quartal 2026 (VBVG)', 'Sonstige', 'Amtsgericht Neuwied', '2026-08-31', '2026-09-15', 'normal', 'offen', 'Mittellos, Staatskasse, stationäre Einrichtung, ab dem 25. Monat.'],
      ['Verlängerung Zuzahlungsbefreiung 2027', 'Antrag', 'AOK Rheinland-Pfalz/Saarland', '2026-12-31', '2026-12-05', 'normal', 'offen', 'Grundsicherungsbescheid als Nachweis.']
    ]),
    goalDecisionPlanning: L.planung(F, [
      {
        typ: 'wish', titel: 'Draußen arbeiten statt in der Werkstatt', bereich: 'Arbeit, Bildung & Teilhabe',
        beschreibung: 'Jonas Weidmann äußert seit Sommer 2025 wiederholt und aus eigenem Antrieb den Wunsch, außerhalb der Werkstatt zu arbeiten. Über sein Kommunikationstablet hat er dies mehrfach mit den Symbolen „arbeiten", „draußen" und „Pflanzen" ausgedrückt. Ein Praktikum in einer Gärtnerei soll erprobt werden.',
        aussage: '„Arbeiten. Draußen. Pflanzen." (über das Kommunikationstablet, 12.07.2025 und mehrfach danach)',
        status: 'In Bearbeitung', prioritaet: 'Hoch', zustaendig: 'Jonas Weidmann',
        angelegt: '2025-07-12', stand: '2026-08-07', zieldatum: '2027-03-31', pruefdatum: '2026-09-24',
        quelle: 'Eigene Äußerung über Unterstützte Kommunikation', favorit: true,
        module: ['doku', 'approval', 'deadline', 'calendar'], fortschritt: 45,
        smart: {
          formulation: 'Jonas Weidmann erprobt bis zum 31.03.2027 eine Tätigkeit außerhalb der Werkstatt im Rahmen eines Budgets für Arbeit.',
          specific: 'Praktikum in der Gärtnerei Hoffmann, zunächst zwei Tage wöchentlich',
          measurable: 'Praktikumsbericht der Gärtnerei und Rückmeldung des Integrationsfachdienstes nach drei Monaten',
          attractive: 'Es ist sein eigener, wiederholt geäußerter Wunsch',
          realistic: 'Der Arbeitsbereich der Werkstatt bleibt als Rückkehroption erhalten',
          timeBound: 'Gesamtplankonferenz 24.09.2026, Beginn der Erprobung Anfang 2027'
        },
        verlauf: [
          ['2025-07-12', 'Eintrag angelegt', 'Erstmals über das Tablet geäußert'],
          ['2025-11-18', 'Eintrag bearbeitet', 'Wunsch mehrfach wiederholt; Gespräch mit der Werkstatt'],
          ['2026-02-10', 'Eintrag bearbeitet', 'Antrag auf Erprobung eines Budgets für Arbeit gestellt'],
          ['2026-06-24', 'Eintrag bearbeitet', 'Stellungnahme Dr. Bracht befürwortet die Erprobung'],
          ['2026-08-07', 'Eintrag geprüft', 'Gesamtplankonferenz für den 24.09.2026 terminiert']
        ]
      },
      {
        typ: 'need', titel: 'Stabile, reizarme Wohnform mit festen Bezugspersonen', bereich: 'Wohnen',
        beschreibung: 'Die Krise im Herbst 2023 wurde durch einen abrupten Wechsel der Bezugsbetreuung ausgelöst. Seit dem Umzug in die Außenwohngruppe Wiedblick mit eigenem Appartement und durchgehend derselben Bezugsassistenz ist Jonas Weidmann stabil.',
        status: 'In Bearbeitung', prioritaet: 'Dringend', zustaendig: 'Christoph Zepp',
        angelegt: '2023-10-25', stand: '2026-08-07', zieldatum: '', pruefdatum: '2027-08-31',
        quelle: 'Entlassbericht Rheinhessen-Fachklinik vom 20.10.2023', favorit: true,
        module: ['doku', 'approval', 'deadline'], fortschritt: 90,
        verlauf: [
          ['2023-10-25', 'Eintrag angelegt', 'Nach der Krisenaufnahme'],
          ['2024-09-01', 'Eintrag bearbeitet', 'Umzug in die Außenwohngruppe Wiedblick'],
          ['2026-08-07', 'Eintrag geprüft', 'Seit zwei Jahren stabil, keine Anspannungskrisen']
        ]
      },
      {
        typ: 'measure', titel: 'Unterstützte Kommunikation ausbauen', bereich: 'Alltag & Selbstständigkeit',
        beschreibung: 'Das Kommunikationstablet mit Symbolsoftware hat die Verständigung grundlegend verändert. Jonas Weidmann äußert seither eigenständig Wünsche, die zuvor nicht erkennbar waren. Das Vokabular wird jährlich erweitert, Wohngruppe, Werkstatt und Eltern werden geschult.',
        status: 'In Bearbeitung', prioritaet: 'Hoch', zustaendig: 'Nadja Ivanova',
        angelegt: '2024-11-05', stand: '2026-08-07', zieldatum: '', pruefdatum: '2027-01-31',
        quelle: 'Empfehlung der Beratungsstelle für Unterstützte Kommunikation', favorit: true,
        module: ['doku', 'task'], fortschritt: 75,
        verlauf: [
          ['2024-11-05', 'Eintrag angelegt', 'Beratung und Antrag bei der AOK'],
          ['2025-01-20', 'Eintrag bearbeitet', 'Gerät geliefert, Schulung durchgeführt'],
          ['2025-07-12', 'Eintrag bearbeitet', 'Erste eigenständige Äußerung eines Berufswunsches'],
          ['2026-08-07', 'Eintrag geprüft', 'Vokabular um Arbeitsbegriffe erweitert']
        ]
      },
      {
        typ: 'decision', titel: 'Verbleib in der Außenwohngruppe statt Rückkehr ins Elternhaus', bereich: 'Wohnen',
        beschreibung: 'Nach der Krise 2023 wollten die Eltern Jonas Weidmann wieder zu Hause aufnehmen. Nach ausführlicher Erörterung mit ihm, der Klinik und der Lebenshilfe fiel die Entscheidung für einen Wechsel der Wohngruppe statt einer Rückkehr. Jonas Weidmann hat sich mit Bedenkzeit über zwei Termine dafür ausgesprochen.',
        status: 'Abgeschlossen', prioritaet: 'Hoch', zustaendig: 'Christoph Zepp',
        angelegt: '2023-11-20', stand: '2024-09-01', zieldatum: '2024-09-01', pruefdatum: '2027-08-31',
        quelle: 'Gespräche mit Jonas Weidmann, den Eltern und der Klinik im November 2023',
        module: ['doku', 'approval'], fortschritt: 100,
        verlauf: [
          ['2023-11-20', 'Eintrag angelegt', 'Eltern regen Rückkehr an'],
          ['2024-01-15', 'Eintrag bearbeitet', 'Zwei Gespräche mit Jonas Weidmann; er möchte nicht zurück'],
          ['2024-08-13', 'Eintrag bearbeitet', 'Wechsel der Wohngruppe genehmigt'],
          ['2024-09-01', 'Eintrag abgeschlossen', 'Umzug in die Außenwohngruppe Wiedblick']
        ]
      },
      {
        typ: 'goal', titel: 'Selbstständigkeit im Alltag erweitern', bereich: 'Alltag & Selbstständigkeit',
        beschreibung: 'Jonas Weidmann soll schrittweise mehr Alltagsschritte selbst übernehmen: den Weg zur Werkstatt allein mit dem Bus, den eigenen Einkauf, die Wäsche. Die heilpädagogische Begleitung arbeitet daran wöchentlich.',
        status: 'In Bearbeitung', prioritaet: 'Normal', zustaendig: 'Lebenshilfe Neuwied',
        angelegt: '2024-10-01', stand: '2026-06-09', zieldatum: '2027-06-30', pruefdatum: '2026-12-31',
        quelle: 'Gesamtplan vom 12.09.2024',
        module: ['doku', 'task'], fortschritt: 55,
        verlauf: [
          ['2024-10-01', 'Eintrag angelegt', 'Ziel im Gesamtplan verankert'],
          ['2025-06-10', 'Eintrag bearbeitet', 'Busweg zur Werkstatt gelingt allein'],
          ['2026-06-09', 'Eintrag bearbeitet', 'Einkauf mit Bildliste gelingt mit Begleitung im Hintergrund']
        ]
      },
      {
        typ: 'wish', titel: 'Eigene Wohnung später einmal', bereich: 'Persönliche Wünsche',
        beschreibung: 'Jonas Weidmann äußert gelegentlich den Wunsch nach einer eigenen Wohnung „wie Lena". Der Wunsch ist derzeit nicht umsetzbar, wird aber ernst genommen und dokumentiert; auf dem Sparkonto wird im Rahmen des Schonvermögens angespart.',
        aussage: '„Wohnung. Alleine. Wie Lena."',
        status: 'Zurückgestellt', prioritaet: 'Normal', zustaendig: 'Jonas Weidmann',
        angelegt: '2025-09-08', stand: '2026-08-07', zieldatum: '', pruefdatum: '2028-06-30',
        quelle: 'Äußerung über das Kommunikationstablet nach dem Besuch bei der Schwester',
        module: ['doku'], fortschritt: 10,
        verlauf: [
          ['2025-09-08', 'Eintrag angelegt', 'Wunsch nach dem Besuch bei der Schwester in Mainz'],
          ['2026-08-07', 'Eintrag geprüft', 'Wunsch besteht fort; Ansparung auf dem Sparkonto, Prüfung nach dem Budget für Arbeit']
        ]
      },
      {
        typ: 'review', titel: 'Reduktion der antiepileptischen Medikation prüfen', bereich: 'Gesundheit & Pflege',
        beschreibung: 'Jonas Weidmann ist seit 2021 anfallsfrei, das EEG ist unauffällig. Dr. Wahlbrink hält einen Reduktionsversuch für vertretbar. Zu klären sind Nutzen, Risiko eines Rückfalls und die Auswirkungen auf Werkstatt und Wohngruppe.',
        status: 'Zur Entscheidung', prioritaet: 'Hoch', zustaendig: 'Christoph Zepp',
        angelegt: '2026-02-19', stand: '2026-08-05', zieldatum: '2026-09-15', pruefdatum: '2026-09-15',
        quelle: 'EEG-Kontrolle vom 19.02.2026',
        module: ['doku', 'approval', 'calendar'], fortschritt: 35,
        verlauf: [
          ['2026-02-19', 'Eintrag angelegt', 'Anregung von Dr. Wahlbrink'],
          ['2026-08-05', 'Eintrag bearbeitet', 'Erörterung in leichter Sprache vorbereitet, Termin 15.09.2026']
        ]
      },
      {
        typ: 'need', titel: 'Allergiemanagement sicherstellen', bereich: 'Gesundheit & Pflege',
        beschreibung: 'Bei anaphylaktischer Erdnussallergie muss in Wohngruppe, Werkstatt und bei Ausflügen sichergestellt sein, dass das Notfallset griffbereit ist und alle Beteiligten die Anwendung beherrschen.',
        status: 'In Bearbeitung', prioritaet: 'Dringend', zustaendig: 'Christoph Zepp',
        angelegt: '2023-03-09', stand: '2026-05-07', zieldatum: '', pruefdatum: '2027-05-31',
        quelle: 'Notfallpass, Hausarzt Dr. Ostermann',
        module: ['doku', 'task'], fortschritt: 95,
        verlauf: [
          ['2023-03-09', 'Eintrag angelegt', 'Nach Betreuungsübernahme'],
          ['2024-03-11', 'Eintrag bearbeitet', 'Notfall- und Kommunikationspass erstellt und verteilt'],
          ['2026-05-07', 'Eintrag geprüft', 'Autoinjektoren erneuert, Einweisung aufgefrischt']
        ]
      }
    ]),
    accounting: L.rechnungslegung(F, {
      von: '2025-03-01', bis: '2026-02-28',
      konten: [
        { name: 'Girokonto (Verwaltungskonto)', art: 'Girokonto', bank: 'Sparkasse Neuwied', inhaber: 'Jonas Weidmann', iban: 'DE47 5745 0120 0044 7117 02', bic: 'MALADE51NWD', anfang: 402.8, ende: 486.22, einnahmen: 14694.0, ausgaben: 14610.58 },
        { name: 'Sparkonto (Ansparung Schonvermögen)', art: 'Sparkonto', bank: 'Sparkasse Neuwied', inhaber: 'Jonas Weidmann', iban: 'DE20 5745 0120 0044 7117 03', bic: 'MALADE51NWD', anfang: 2600, ende: 2840, einnahmen: 250, ausgaben: 10 },
        { name: 'Barbetragskonto der Wohngruppe', art: 'Treuhandkonto', bank: 'Sparkasse Neuwied', inhaber: 'Jonas Weidmann (Barbetrag)', iban: 'DE93 5745 0120 0094 4021 50', bic: 'MALADE51NWD', anfang: 82.6, ende: 68.4, einnahmen: 360, ausgaben: 374.2 }
      ],
      vermoegen: [
        ['Bargeld und Bankguthaben', 'Giro-, Spar- und Barbetragskonto', 3085.4, 3394.62],
        ['Haushaltsgegenstände', 'Ausstattung Appartement 4', 1380, 1450]
      ],
      verbindlichkeiten: [
        ['Sanitätshaus Rheinvital GmbH', 'Eigenanteil Zubehör Kommunikationstablet, Ratenvereinbarung 50 € monatlich', 289, 89]
      ],
      schenkungen: []
    }),
    exportHistory: [],
    archives: [],
    history: [],
    contacts: [],
    contactMerges: [],
    promptHints: 'Junger Erwachsener mit Autismus: Berichte sollen deutlich machen, dass Wünsche über Unterstützte Kommunikation eigenständig geäußert werden und maßgeblich sind. Entscheidungen werden mit Bedenkzeit über zwei Termine vorbereitet. Elternwünsche sind nicht mit dem Willen der betreuten Person gleichzusetzen.',
    derived: {}
  },

  kontakte: [
    { kategorie: 'behoerden', rolle: 'Betreuungsgericht', institution: 'Amtsgericht Neuwied', strasse: 'Hermannstraße', hausnummer: '34', plz: '56564', ort: 'Neuwied', telefon: '02631/8030', fax: '02631/803180', mail: 'poststelle.ag-nr@ko.mjv.rlp.de', aktenzeichen: '9 XVII 62/23', gericht: 'Amtsgericht Neuwied', gerichtsAz: '9 XVII 62/23' },
    { kategorie: 'behoerden', rolle: 'Betreuungsbehörde', institution: 'Kreisverwaltung Neuwied, Betreuungsbehörde', strasse: 'Wilhelm-Leuschner-Straße', hausnummer: '9', plz: '56564', ort: 'Neuwied', telefon: '02631/8030', mail: 'betreuungsbehoerde@kreis-neuwied.de', aktenzeichen: 'BtB-NR 2023/0288' },
    { kategorie: 'behoerden', rolle: 'Sozialamt - Grundsicherung', institution: 'Kreisverwaltung Neuwied, Sozialamt', strasse: 'Wilhelm-Leuschner-Straße', hausnummer: '9', plz: '56564', ort: 'Neuwied', telefon: '02631/803360', fax: '02631/803399', mail: 'sozialamt@kreis-neuwied.de', aktenzeichen: 'GruSi-NR 2023/0844' },
    { kategorie: 'behoerden', rolle: 'Sozialamt - Rehabilitation- und Teilhabeleistungen', institution: 'Landesamt für Soziales, Jugend und Versorgung – Eingliederungshilfe', strasse: 'Baedekerstraße', hausnummer: '2-20', plz: '56073', ort: 'Koblenz', telefon: '0261/40410', mail: 'poststelle@lsjv.rlp.de', aktenzeichen: 'EGH-NR 2023/1157' },
    { kategorie: 'behoerden', rolle: 'Familienkasse', institution: 'Familienkasse Rheinland-Pfalz-Saarland', strasse: 'Brückenstraße', hausnummer: '10', plz: '54290', ort: 'Trier', telefon: '0800/4555530', aktenzeichen: 'FK 447 120 885', vorgang: 'Kindergeld über die Volljährigkeit hinaus, Abzweigung' , mail: 'familienkasse-rps@arbeitsagentur.de' },
    { kategorie: 'behoerden', rolle: 'LSJV / Versorgungsamt', institution: 'Landesamt für Soziales, Jugend und Versorgung Koblenz', strasse: 'Baedekerstraße', hausnummer: '2-20', plz: '56073', ort: 'Koblenz', telefon: '0261/40410', aktenzeichen: 'SB 2023/44 712' , mail: 'poststelle@landesamt-soziales.de' },
    { kategorie: 'behoerden', rolle: 'Schulamt', status: 'Beendet', institution: 'Christiane-Herzog-Schule, Förderschwerpunkt ganzheitliche Entwicklung', strasse: 'Schulstraße', hausnummer: '18', plz: '56567', ort: 'Neuwied', telefon: '02631/941200', vorgang: 'Schulbesuch bis 07/2023' , mail: 'poststelle@christiane-herzog-schule.de' },
    { kategorie: 'gesundheit', rolle: 'Gerontopsychiatrie', anrede: 'Sehr geehrte Frau', titel: 'Dr. med.', vorname: 'Cornelia', nachname: 'Bracht', institution: 'Rheinhessen-Fachklinik, Transitionsambulanz Neuwied', strasse: 'Heddesdorfer Straße', hausnummer: '20', plz: '56564', ort: 'Neuwied', telefon: '02631/8404120', mail: 'transition@rfk-neuwied.de' },
    { kategorie: 'gesundheit', rolle: 'Allgemeinmedizin', anrede: 'Sehr geehrter Herr', titel: 'Dr. med.', vorname: 'Peter', nachname: 'Ostermann', institution: 'Hausarztpraxis Neuwied-Engers', strasse: 'Hauptstraße', hausnummer: '62', plz: '56566', ort: 'Neuwied', telefon: '02631/354180', mail: 'praxis@ostermann-neuwied.de' },
    { kategorie: 'gesundheit', rolle: 'Neurologie', anrede: 'Sehr geehrte Frau', titel: 'Dr. med.', vorname: 'Ingrid', nachname: 'Wahlbrink', institution: 'Gemeinschaftsklinikum Mittelrhein, Epilepsieambulanz', strasse: 'Koblenzer Straße', hausnummer: '115-155', plz: '56073', ort: 'Koblenz', telefon: '0261/4962440', mail: 'epilepsie@gk-mittelrhein.de' },
    { kategorie: 'gesundheit', rolle: 'Zahnmedizin', anrede: 'Sehr geehrter Herr', titel: 'Dr. med.', vorname: 'Kai', nachname: 'Löffler', institution: 'Zahnarztpraxis Dr. Löffler (Behandlung in Sedierung)', strasse: 'Marktstraße', hausnummer: '48', plz: '56564', ort: 'Neuwied', telefon: '02631/221900', mail: 'praxis@zahn-loeffler-nr.de' },
    { kategorie: 'gesundheit', rolle: 'Krankenhaus', institution: 'Marienhaus Klinikum St. Elisabeth Neuwied', strasse: 'Friedrich-Ebert-Straße', hausnummer: '59', plz: '56564', ort: 'Neuwied', telefon: '02631/820' , mail: 'info@marienhaus-neuwied.de' },
    { kategorie: 'gesundheit', rolle: 'Ergotherapie', institution: 'Praxis Sonnenschein – Ergotherapie und Heilpädagogik', strasse: 'Langendorfer Straße', hausnummer: '104', plz: '56564', ort: 'Neuwied', telefon: '02631/9440880', mail: 'info@praxis-sonnenschein-nr.de' },
    { kategorie: 'gesundheit', rolle: 'Apotheke', institution: 'Wiedbach-Apotheke Neuwied', strasse: 'Wiedbachstraße', hausnummer: '11', plz: '56567', ort: 'Neuwied', telefon: '02631/74410', vorgang: 'Blisterversorgung Wohngruppe' , mail: 'info@wiedbach-apotheke-neuwied.de' },
    { kategorie: 'gesundheit', rolle: 'stationäre Pflege', institution: 'Lebenshilfe Neuwied gGmbH, Außenwohngruppe Wiedblick', strasse: 'Wiedbachstraße', hausnummer: '28', plz: '56567', ort: 'Neuwied', telefon: '02631/9440215', mail: 'wiedblick@lebenshilfe-neuwied.de', aktenzeichen: 'EGH-NR 2023/1157-W' },
    { kategorie: 'finanzen', rolle: 'Bankinstut', institution: 'Sparkasse Neuwied', strasse: 'Kirchstraße', hausnummer: '2', plz: '56564', ort: 'Neuwied', telefon: '02631/8600', mail: 'info@sparkasse-neuwied.de', iban: 'DE47 5745 0120 0044 7117 02', bic: 'MALADE51NWD', bank: 'Sparkasse Neuwied' },
    { kategorie: 'finanzen', rolle: 'Gläubiger', institution: 'Sanitätshaus Rheinvital GmbH', strasse: 'Emser Straße', hausnummer: '204', plz: '56076', ort: 'Koblenz', telefon: '0261/442180', mail: 'buchhaltung@rheinvital.de', aktenzeichen: 'RV-25-6640', iban: 'DE29 5705 0120 0000 4471 88', bic: 'MALADE51KOB' },
    { kategorie: 'finanzen', rolle: 'Mobilfunk', institution: 'Aldi Talk (Medion Mobile)', strasse: 'Am Zehnthof', hausnummer: '77', plz: '45307', ort: 'Essen', telefon: '01177/1157', aktenzeichen: 'AT-4471-1702' , mail: 'service@aldi-talk.de' },
    { kategorie: 'finanzen', rolle: 'Abonoment', status: 'Beendet', institution: 'Telefónica Germany (o2)', strasse: 'Georg-Brauchle-Ring', hausnummer: '50', plz: '80992', ort: 'München', telefon: '089/24420', aktenzeichen: 'O2-2023-447120', vorgang: 'Vertrag 03/2023, gekündigt und getilgt 11/2024' , mail: 'service@o2online.de' },
    { kategorie: 'versicherungen', rolle: 'Gesundheitsversicherung (gesetzlich)', institution: 'AOK Rheinland-Pfalz/Saarland', strasse: 'Eisenbahnstraße', hausnummer: '6-8', plz: '67655', ort: 'Kaiserslautern', telefon: '0800/0265637', mail: 'service@rps.aok.de', aktenzeichen: 'A447117020' },
    { kategorie: 'versicherungen', rolle: 'Pflegezusatzversicherung', institution: 'AOK Pflegekasse Rheinland-Pfalz/Saarland', strasse: 'Eisenbahnstraße', hausnummer: '6-8', plz: '67655', ort: 'Kaiserslautern', telefon: '0800/0265637', aktenzeichen: 'PK-A447117020' , mail: 'pflegekasse@rps.aok.de' },
    { kategorie: 'versicherungen', rolle: 'Rentenversicherung', institution: 'Deutsche Rentenversicherung Bund', strasse: 'Ruhrstraße', hausnummer: '2', plz: '10709', ort: 'Berlin', telefon: '0800/10004800', aktenzeichen: '25 170205 W 044' , mail: 'service@deutsche-rentenversicherung.de' },
    { kategorie: 'versicherungen', rolle: 'Privathatfplicht', institution: 'Gothaer Allgemeine Versicherung AG', strasse: 'Gothaer Allee', hausnummer: '1', plz: '50969', ort: 'Köln', telefon: '0221/3080', aktenzeichen: 'PHV 8854-4712' , mail: 'service@gothaer.de' },
    { kategorie: 'versicherungen', rolle: 'Unfallversicherung', institution: 'Unfallkasse Rheinland-Pfalz', strasse: 'Orensteinstraße', hausnummer: '10', plz: '56626', ort: 'Andernach', telefon: '02632/9600', aktenzeichen: 'UK-WfbM-4471' , mail: 'service@unfallkasse-rheinland-pfalz.de' },
    { kategorie: 'arbeit', rolle: 'WfBm', institution: 'Werkstatt Neuwied der Lebenshilfe, Arbeitsbereich Montage und Verpackung', strasse: 'Industriestraße', hausnummer: '17', plz: '56566', ort: 'Neuwied', telefon: '02631/944100', fax: '02631/944199', mail: 'werkstatt@lebenshilfe-neuwied.de', aktenzeichen: 'EGH-NR 2023/1157' },
    { kategorie: 'arbeit', rolle: 'Arbeitgeber', status: 'Beabsichtigt', institution: 'Gärtnerei Hoffmann GmbH', strasse: 'Rheinstraße', hausnummer: '212', plz: '56566', ort: 'Neuwied', telefon: '02631/771480', mail: 'info@gaertnerei-hoffmann-nr.de', vorgang: 'Vorgesehene Erprobung Budget für Arbeit ab 2027' },
    { kategorie: 'arbeit', rolle: 'Tagesförderstätte', institution: 'Integrationsfachdienst Nord-Rheinland-Pfalz', strasse: 'Hochstraße', hausnummer: '44', plz: '56564', ort: 'Neuwied', telefon: '02631/9448820', mail: 'neuwied@ifd-nordrlp.de', vorgang: 'Begleitung Budget für Arbeit' },
    { kategorie: 'unterkunft', rolle: 'Einrichtungsträger', institution: 'Lebenshilfe Neuwied gGmbH', strasse: 'Heddesdorfer Straße', hausnummer: '33', plz: '56564', ort: 'Neuwied', telefon: '02631/94400', fax: '02631/944099', mail: 'info@lebenshilfe-neuwied.de', aktenzeichen: 'Wohn- und Betreuungsvertrag vom 24.10.2023', iban: 'DE93 5745 0120 0094 4021 50', bic: 'MALADE51NWD' },
    { kategorie: 'unterkunft', rolle: 'Beitragsservice', status: 'Befreit', institution: 'ARD ZDF Deutschlandradio Beitragsservice', plz: '50656', ort: 'Köln', telefon: '01806/999555', aktenzeichen: '885 447 122' , mail: 'service@rundfunkbeitrag.de' , postfach: '50656 Köln' },
    { kategorie: 'unterkunft', rolle: 'Vermieter', status: 'Beendet', institution: 'Wohngruppe „Am Mühlbach" der Lebenshilfe Neuwied', strasse: 'Mühlbachstraße', hausnummer: '7', plz: '56566', ort: 'Neuwied', telefon: '02631/944180', vorgang: 'Wohnform 11/2023 bis 08/2024' , mail: 'wohngruppe@lebenshilfe-neuwied.de' },
    { kategorie: 'soziales', rolle: 'Mutter', anrede: 'Sehr geehrte Frau', vorname: 'Sabine', nachname: 'Weidmann', strasse: 'Am Kirchberg', hausnummer: '14', plz: '56566', ort: 'Neuwied', telefon: '02631/774120', mobil: '0171/4471228', mail: 's.weidmann@example-mail.de' },
    { kategorie: 'soziales', rolle: 'Vater', anrede: 'Sehr geehrter Herr', vorname: 'Thomas', nachname: 'Weidmann', strasse: 'Am Kirchberg', hausnummer: '14', plz: '56566', ort: 'Neuwied', telefon: '02631/774120', mobil: '0172/8840217', mail: 't.weidmann@example-mail.de' },
    { kategorie: 'soziales', rolle: 'Schwester', anrede: 'Sehr geehrte Frau', vorname: 'Lena', nachname: 'Weidmann', strasse: 'Kaiser-Friedrich-Straße', hausnummer: '9', plz: '55116', ort: 'Mainz', mobil: '0157/22447118', mail: 'lena.weidmann@example-mail.de' , telefon: '06131/2287165' },
    { kategorie: 'soziales', rolle: 'Peer / Bezugsperson', anrede: 'Sehr geehrte Frau', vorname: 'Nadja', nachname: 'Ivanova', institution: 'Lebenshilfe Neuwied, Außenwohngruppe Wiedblick', strasse: 'Wiedbachstraße', hausnummer: '28', plz: '56567', ort: 'Neuwied', telefon: '02631/9440215', mail: 'ivanova@lebenshilfe-neuwied.de' },
    { kategorie: 'soziales', rolle: 'Peer / Bezugsperson', anrede: 'Sehr geehrter Herr', vorname: 'Rainer', nachname: 'Dombrowski', institution: 'Werkstatt Neuwied, Gruppenleitung Montage', strasse: 'Industriestraße', hausnummer: '17', plz: '56566', ort: 'Neuwied', telefon: '02631/944100', mail: 'dombrowski@lebenshilfe-neuwied.de' },
    { kategorie: 'soziales', rolle: 'Verein (Freizeit)', institution: 'TuS Neuwied – Inklusive Fußballgruppe', strasse: 'Sportplatzweg', hausnummer: '3', plz: '56566', ort: 'Neuwied', telefon: '02631/887720', mail: 'inklusion@tus-neuwied.de' },
    { kategorie: 'soziales', rolle: 'aktuelle Betreuung', anrede: 'Sehr geehrter Herr', vorname: 'Christoph', nachname: 'Zepp', institution: 'Betreuungsbüro Rheinblick', strasse: 'Marktplatz', hausnummer: '8', plz: '56346', ort: 'St. Goarshausen', telefon: '06771/959410', mail: 'kanzlei@betreuungsbuero-rheinblick.de' }
  ],

  doku: L.doku([
    ['2023-02-17', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Betreuungsspezifischer Vorgang', 'Übernahme einer neuen Betreuung / Erstgespräch / Aktenanlage', 'Schriftlich (Brief)', 'Bestellung zum 18. Geburtstag', 'Beschluss vom 06.02.2023, wirksam mit Eintritt der Volljährigkeit am 17.02.2023. Acht Aufgabenkreise, Einwilligungsvorbehalt für die Vermögenssorge. Das Verfahren war von der Schule und den Eltern rechtzeitig angeregt worden.'],
    ['2023-02-24', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Beratungsgespräch', 'persönlich (Hausbesuch)', 'Erstbesuch im Elternhaus', 'Erstes Kennenlernen im Elternhaus in Neuwied-Engers, im Beisein beider Eltern. Jonas Weidmann verhielt sich zunächst abwartend, zeigte dann seine Sammlung von Zugmodellen. Verständigung über kurze Sätze und Gesten. Vereinbart: Besuche werden immer eine Woche vorher angekündigt.'],
    ['2023-02-20', 'Sozialleistungsträger & öffentliche Stellen', 'Grundsicherungsamt', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Grundsicherung beantragt', 'Antrag auf Grundsicherung bei Erwerbsminderung nach dem 4. Kapitel SGB XII. Dauerhafte volle Erwerbsminderung wird durch die Aufnahme in die Werkstatt vermutet.'],
    ['2023-03-06', 'Sozialleistungsträger & öffentliche Stellen', 'Familienkasse', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Kindergeld und Abzweigung', 'Weiterzahlung des Kindergeldes über die Volljährigkeit hinaus wegen Behinderung beantragt, zugleich Abzweigung an die betreute Person. Die Eltern haben der Abzweigung zugestimmt.'],
    ['2023-03-08', 'Sozialleistungsträger & öffentliche Stellen', 'Sozialverwaltungsbehörde', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Schwerbehindertenausweis', 'Neuantrag nach Volljährigkeit. GdB 90 mit Merkzeichen G, B und H am 27.04.2023 zuerkannt.'],
    ['2023-03-09', 'Gesundheit, Pflege & Rehabilitation', 'Hausärzt:in', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'persönlich (Betreuungsbüro)', 'Allergiemanagement', 'Gespräch mit Dr. Ostermann zur Erdnussallergie. Zwei Adrenalin-Autoinjektoren verordnet, Einweisung für Schule und Elternhaus organisiert. Notfallpass in Vorbereitung.'],
    ['2023-05-11', 'Arbeit, Bildung & Teilhabe', 'Werkstatt für Menschen mit Behinderung', 'Arbeit, Beschäftigung, Bildung & Teilhabe', 'Reha-/Teilhabe am Arbeitsleben (Integrationsfachdienst, WfbM etc.)', 'persönlich (Gericht / Behörde)', 'Aufnahme in die Werkstatt beantragt', 'Antrag auf Leistungen im Eingangsverfahren und Berufsbildungsbereich der Werkstatt Neuwied. Übergang aus der Christiane-Herzog-Schule zum 01.08.2023.'],
    ['2023-06-08', 'Finanzen, Vermögen & Schulden', 'Inkassounternehmen / Gläubiger', 'Finanzen, Vermögen & Schulden', 'Mahnung / Inkasso bearbeiten', 'Schriftlich (Brief)', 'Mobilfunkvertrag mit Gerätekauf', 'Mahnung von o2 über 684,90 €. Jonas Weidmann hatte im März 2023 im Einkaufszentrum einen Vertrag mit Gerätekauf abgeschlossen. Widerruf war verfristet. Ratenzahlung von 40 € monatlich vereinbart. Dieser Vorgang war der Anlass für den Einwilligungsvorbehalt.'],
    ['2023-08-01', 'Arbeit, Bildung & Teilhabe', 'Werkstatt für Menschen mit Behinderung', 'Arbeit, Beschäftigung, Bildung & Teilhabe', 'Anmeldung / Teilnahme an Freizeit- und Teilhabeangeboten', 'persönlich (Einrichtung / Klinik)', 'Start Berufsbildungsbereich', 'Beginn im Eingangsverfahren der Werkstatt Neuwied. Erste Rückmeldungen positiv; Jonas Weidmann kommt mit den festen Abläufen gut zurecht.'],
    ['2023-08-15', 'Gesundheit, Pflege & Rehabilitation', 'Einrichtungsträger (Heim, betreutes Wohnen, besondere Wohnform)', 'Gesundheit, Pflege & Rehabilitation', 'Krisenintervention im Alltag', 'telefonisch', 'Erste Anspannungskrise', 'Die Schule meldet, dass Jonas Weidmann seit dem Wechsel massiv angespannt ist und sich in den Unterarm beißt. Termin bei Dr. Bracht kurzfristig organisiert.'],
    ['2023-09-04', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhausaufnahme organisieren', 'persönlich (Einrichtung / Klinik)', 'Krisenaufnahme in Alzey', 'Freiwillige Aufnahme in die Klinik für Menschen mit geistiger Behinderung. Auslöser war ein abrupter Wechsel der Bezugsbetreuung. Jonas Weidmann hat der Aufnahme nach Erläuterung mit Bildkarten zugestimmt. Einstellung auf Risperidon.'],
    ['2023-10-20', 'Gesundheit, Pflege & Rehabilitation', 'Sozialdienst Klinik/Einrichtung', 'Gesundheit, Pflege & Rehabilitation', 'Entlassungsmanagement / Überleitung', 'persönlich (Einrichtung / Klinik)', 'Entlassung mit klaren Empfehlungen', 'Entlassbericht: reizarme Wohnform, feste Bezugspersonen, Veränderungen mindestens zwei Wochen vorher ankündigen. Diese Empfehlungen wurden zur Grundlage aller weiteren Entscheidungen.'],
    ['2023-10-16', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Heimvertrag zur Genehmigung', 'Antrag auf Genehmigung des Wohn- und Betreuungsvertrages mit der Wohngruppe „Am Mühlbach". Jonas Weidmann hat nach Probewohnen an drei Wochenenden und Bedenkzeit über zwei Termine zugestimmt.'],
    ['2023-11-01', 'Wohnen, Energie & Kommunikation', 'Einrichtungsträger (Heim, betreutes Wohnen, besondere Wohnform)', 'Wohnen, Aufenthalt & Unterbringung', 'Umzug organisieren / begleiten', 'persönlich (Hausbesuch)', 'Auszug aus dem Elternhaus', 'Umzug in die Wohngruppe „Am Mühlbach". Die Eltern haben den Umzug begleitet; die Mutter war sichtlich belastet.'],
    ['2023-11-20', 'Betroffene Person / unmittelbares Umfeld', 'Familie / Angehörige', 'Beratung, Abstimmung & Hilfeplanung', 'Beratungsgespräch', 'persönlich (Betreuungsbüro)', 'Eltern regen Rückkehr an', 'Nach der Krise möchten die Eltern Jonas Weidmann wieder zu Hause aufnehmen. Ausführliches Gespräch: Der Wunsch der Eltern ist verständlich, maßgeblich ist jedoch der Wille von Jonas Weidmann. Vereinbart: zwei getrennte Gespräche mit ihm.'],
    ['2024-01-15', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Beratung, Abstimmung & Hilfeplanung', 'Beratungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Zwei Gespräche zur Wohnform', 'In zwei Gesprächen mit Bildkarten und Bedenkzeit hat Jonas Weidmann klar zum Ausdruck gebracht, dass er nicht zurück ins Elternhaus möchte, wohl aber die laute Gruppe verlassen will. Ergebnis: Suche nach einer ruhigeren Wohnform.'],
    ['2024-02-19', 'Wohnen, Energie & Kommunikation', 'Einrichtungsträger (Heim, betreutes Wohnen, besondere Wohnform)', 'Finanzen, Vermögen & Schulden', 'Überweisung / Rechnung bezahlen', 'Schriftlich (Brief)', 'Rückstand Verpflegungsanteil', 'Rückstand von 412,80 € durch die verspätete Bewilligung der Grundsicherung. Nach Nachzahlung des Sozialamts vollständig ausgeglichen.'],
    ['2024-04-29', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Einwilligung in medizinische Maßnahmen / Aufklärungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Zahnsanierung in Sedierung', 'Aufklärung durch Dr. Löffler. Wegen ausgeprägter Behandlungsangst ist eine Behandlung nur in Sedierung möglich. Vorbereitung mit Bildkarten; Jonas Weidmann hat nach der Erläuterung zugestimmt. Kein begründetes Risiko im Sinne des § 1829 Abs. 2 BGB.'],
    ['2024-07-22', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Wechsel der Wohngruppe beantragt', 'Antrag auf Genehmigung der Kündigung und des neuen Vertrages mit der Außenwohngruppe „Wiedblick". Jonas Weidmann hat die neue Gruppe zweimal besucht und über sein Tablet „ja" und „ruhig" geäußert.'],
    ['2024-09-01', 'Wohnen, Energie & Kommunikation', 'Einrichtungsträger (Heim, betreutes Wohnen, besondere Wohnform)', 'Wohnen, Aufenthalt & Unterbringung', 'Wechsel der Einrichtung / Wohnform', 'persönlich (Hausbesuch)', 'Umzug in die Außenwohngruppe', 'Umzug in das Appartement 4 der Außenwohngruppe Wiedblick. Eigenes Bad, reizarme Gestaltung, feste Bezugsassistenz Frau Ivanova. Der Umzug wurde vier Wochen vorher mit einem Bildkalender vorbereitet.'],
    ['2024-09-12', 'Sozialleistungsträger & öffentliche Stellen', 'Sozialverwaltungsbehörde', 'Beratung, Abstimmung & Hilfeplanung', 'Hilfeplangespräch / Teilhabeplan / Gesamtplanverfahren', 'persönlich (Gericht / Behörde)', 'Gesamtplankonferenz', 'Erste Gesamtplankonferenz nach dem Umzug. Ziele: stabile Wohnform, Erweiterung der Selbstständigkeit, Prüfung von Unterstützter Kommunikation. Jonas Weidmann nahm teil und zeigte auf Symbole.'],
    ['2024-11-05', 'Gesundheit, Pflege & Rehabilitation', 'Sanitätshaus', 'Alltagsorganisation & praktische Unterstützung', 'Organisation von Hilfsmitteln (Rollator, Pflegebett, Hilfsmittelrezept)', 'persönlich (Einrichtung / Klinik)', 'Kommunikationstablet beantragt', 'Beratung durch die Beratungsstelle für Unterstützte Kommunikation. Antrag auf ein Tablet mit Symbolsoftware bei der AOK gestellt.'],
    ['2024-12-11', 'Gesundheit, Pflege & Rehabilitation', 'Krankenkasse / Pflegekasse', 'Anträge, Verfahren & Rechtliches', 'Widerspruch', 'Schriftlich (Brief)', 'Widerspruch gegen Ablehnung', 'Die AOK lehnt das Kommunikationsgerät zunächst ab. Widerspruch mit ausführlicher Stellungnahme der Beratungsstelle und Befundbericht Dr. Bracht.'],
    ['2025-01-20', 'Gesundheit, Pflege & Rehabilitation', 'Krankenkasse / Pflegekasse', 'Anträge, Verfahren & Rechtliches', 'Widerspruch', 'Schriftlich (Brief)', 'Widerspruch erfolgreich', 'Abhilfebescheid der AOK. Gerät geliefert, Schulung von Wohngruppe, Werkstatt und Eltern durchgeführt. Eigenanteil nur für Schutzhülle und Halterung.'],
    ['2025-04-14', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhausaufnahme organisieren', 'telefonisch', 'Sturz in der Werkstatt', 'Distale Radiusfraktur links nach Sturz. Konservative Versorgung im Marienhaus Klinikum. Aufklärung mit Bildkarten; Jonas Weidmann hat selbst eingewilligt.'],
    ['2025-06-10', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Alltagsorganisation & praktische Unterstützung', 'Beratungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Busweg gelingt allein', 'Jonas Weidmann fährt seit Mai selbstständig mit dem Bus zur Werkstatt. Ein wichtiger Schritt; er zeigt beim Besuch stolz seinen Fahrausweis.'],
    ['2025-07-12', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Arbeit, Beschäftigung, Bildung & Teilhabe', 'Beratungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Berufswunsch über das Tablet geäußert', 'Auf die offene Frage nach seinen Wünschen setzte Jonas Weidmann über das Kommunikationstablet die Symbole „arbeiten", „draußen" und „Pflanzen" zusammen. Erste eigenständig geäußerte berufliche Vorstellung. Wunsch in „Bedarfe & Wille" aufgenommen.'],
    ['2025-08-04', 'Arbeit, Bildung & Teilhabe', 'Werkstatt für Menschen mit Behinderung', 'Arbeit, Beschäftigung, Bildung & Teilhabe', 'Reha-/Teilhabe am Arbeitsleben (Integrationsfachdienst, WfbM etc.)', 'persönlich (Einrichtung / Klinik)', 'Übergang in den Arbeitsbereich', 'Nach zwei Jahren Berufsbildungsbereich Wechsel in den Arbeitsbereich Montage und Verpackung. Gruppenleitung Herr Dombrowski.'],
    ['2025-09-08', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Gespräch geführt', 'persönlich (Einrichtung / Klinik)', 'Wunsch nach eigener Wohnung', 'Nach einem Wochenendbesuch bei der Schwester in Mainz äußert Jonas Weidmann über das Tablet: „Wohnung. Alleine. Wie Lena." Wunsch aufgenommen und zurückgestellt; Ansparung auf dem Sparkonto fortgeführt.'],
    ['2025-11-18', 'Arbeit, Bildung & Teilhabe', 'Werkstatt für Menschen mit Behinderung', 'Beratung, Abstimmung & Hilfeplanung', 'Beratungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Berufswunsch mit der Werkstatt besprochen', 'Die Werkstatt hält eine Erprobung außerhalb grundsätzlich für möglich, weist aber auf die Notwendigkeit einer engen Begleitung hin. Kontakt zum Integrationsfachdienst hergestellt.'],
    ['2026-01-13', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'Schriftlich (Brief)', 'Verlaufskontrolle Transitionsambulanz', 'Dr. Bracht berichtet deutlich weniger Anspannungsepisoden seit dem Umzug. Risperidon unverändert.'],
    ['2026-02-10', 'Sozialleistungsträger & öffentliche Stellen', 'Sozialverwaltungsbehörde', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Budget für Arbeit beantragt', 'Antrag auf Erprobung eines Budgets für Arbeit im Rahmen des Gesamtplanverfahrens. Beigefügt: Rückmeldung der Werkstatt, Stellungnahme des Integrationsfachdienstes, Bereitschaftserklärung der Gärtnerei Hoffmann.'],
    ['2026-02-19', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'Schriftlich (Brief)', 'Epilepsie-Kontrolle', 'EEG unauffällig, seit 2021 anfallsfrei. Dr. Wahlbrink regt einen Reduktionsversuch des Levetiracetam an. Prüfauftrag angelegt.'],
    ['2026-03-04', 'Betroffene Person / unmittelbares Umfeld', 'Familie / Angehörige', 'Beratung, Abstimmung & Hilfeplanung', 'Beratungsgespräch', 'persönlich (Betreuungsbüro)', 'Bedenken der Mutter zum Budget für Arbeit', 'Frau Weidmann äußert erhebliche Sorgen: Sie befürchtet Überforderung und einen Rückfall in die Krise von 2023. Ausführliches Gespräch über die Rückkehroption in die Werkstatt und die engmaschige Begleitung durch den Integrationsfachdienst. Klarstellung, dass der Wille von Jonas Weidmann maßgeblich ist.'],
    ['2026-03-25', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztbegleitung', 'persönlich (Einrichtung / Klinik)', 'Zahnbehandlung in Sedierung', 'Zwei Füllungen und Zahnsteinentfernung. Die Vorbereitung mit Bildkarten über zwei Wochen hat sich bewährt; der Ablauf verlief deutlich ruhiger als 2024.'],
    ['2026-03-24', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Betreuungsspezifischer Vorgang', 'Jahresbericht / Entwicklungsbericht', 'eBO', 'Jahresbericht 2025/2026', 'Bericht und Rechnungslegung für 01.03.2025 bis 28.02.2026 eingereicht. Schwerpunkt: eigenständig geäußerter Berufswunsch und die daraus folgende Prüfung eines Budgets für Arbeit.'],
    ['2026-05-07', 'Gesundheit, Pflege & Rehabilitation', 'Hausärzt:in', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'persönlich (Einrichtung / Klinik)', 'Notfallset erneuert', 'Jahresuntersuchung bei Dr. Ostermann. Adrenalin-Autoinjektoren erneuert, Einweisung der Werkstatt und der Wohngruppe aufgefrischt. Notfall- und Kommunikationspass aktualisiert.'],
    ['2026-06-09', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Gespräch geführt', 'persönlich (Einrichtung / Klinik)', 'Besuch, Wunsch bestätigt', 'Jonas Weidmann bestätigt den Berufswunsch erneut und ohne Nachfrage. Er hat auf dem Tablet ein neues Symbolfeld „Gärtnerei" anlegen lassen. Barauszahlung 30 €. Kontakt- und Zusammenarbeitsprofil aktualisiert.'],
    ['2026-06-24', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Kontrolle, Prüfung & Nachverfolgung', 'Stellungnahme', 'Schriftlich (Brief)', 'Stellungnahme für das Gesamtplanverfahren', 'Dr. Bracht befürwortet die Erprobung eines Budgets für Arbeit ausdrücklich, sofern die Begleitung engmaschig ist und die Rückkehr in die Werkstatt jederzeit möglich bleibt.'],
    ['2026-07-30', 'Sozialleistungsträger & öffentliche Stellen', 'Sozialverwaltungsbehörde', 'Beratung, Abstimmung & Hilfeplanung', 'Hilfeplangespräch / Teilhabeplan / Gesamtplanverfahren', 'Schriftlich (E-Mail)', 'Gesamtplankonferenz terminiert', 'Konferenz für den 24.09.2026 terminiert. Teilnahme von Jonas Weidmann, beiden Eltern, Werkstatt, Wohngruppe und Integrationsfachdienst zugesagt.'],
    ['2026-08-05', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Beratungsgespräch', 'telefonisch', 'Reduktionsversuch vorbereitet', 'Rücksprache mit Dr. Wahlbrink. Vor der Entscheidung über die Reduktion des Levetiracetam ist der Sachverhalt mit Jonas Weidmann in leichter Sprache zu erörtern und mit den Eltern zu besprechen. Termin am 15.09.2026.'],
    ['2026-08-07', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Gespräch geführt', 'persönlich (Einrichtung / Klinik)', 'Besuch, Vorbereitung der Gesamtplankonferenz', 'Die Konferenz am 24.09.2026 mit Bildkarten angekündigt und den Ablauf erklärt. Jonas Weidmann möchte teilnehmen und selbst „zeigen, was er will". Barauszahlung 30 €, Handkasse abgerechnet.']
  ]),

  termine: [
    { titel: 'Gesamtplankonferenz – Budget für Arbeit', start: '2026-09-24T10:00:00', ende: '2026-09-24T12:00:00', ort: 'Kreisverwaltung Neuwied, Wilhelm-Leuschner-Straße 9, 56564 Neuwied', beschreibung: 'Teilnahme von Jonas Weidmann, beiden Eltern, Werkstatt, Wohngruppe und Integrationsfachdienst. Bildkarten und Kommunikationstablet mitbringen.' },
    { titel: 'Termin Dr. Wahlbrink – Reduktion Levetiracetam', start: '2026-09-15T14:00:00', ende: '2026-09-15T15:00:00', ort: 'Epilepsieambulanz, GK Mittelrhein, Koblenzer Straße 115, 56073 Koblenz', beschreibung: 'Entscheidung über den Reduktionsversuch. Vorher Erörterung in leichter Sprache, Eltern sind eingeladen.' },
    { titel: 'Besuch Außenwohngruppe Wiedblick', start: '2026-10-13T15:00:00', ende: '2026-10-13T16:00:00', ort: 'Wiedbachstraße 28, 56567 Neuwied', beschreibung: 'Regelbesuch. Themen: Ergebnis der Gesamtplankonferenz, Wochengeld, Winterkleidung.' },
    { titel: 'Depot- und Verlaufstermin Dr. Bracht (Transitionsambulanz)', start: '2026-07-14T11:00:00', ende: '2026-07-14T11:45:00', ort: 'Transitionsambulanz, Heddesdorfer Straße 20, 56564 Neuwied', beschreibung: 'Halbjährliche Verlaufskontrolle Risperidon.' },
    { titel: 'Elterngespräch zum Budget für Arbeit', start: '2026-09-08T17:00:00', ende: '2026-09-08T18:00:00', ort: 'Testbüroname, Marktplatz 8, 56346 St. Goarshausen', beschreibung: 'Vorbereitung der Gesamtplankonferenz mit Sabine und Thomas Weidmann. Sorgen der Mutter aufgreifen, Rückkehroption erläutern.' },
    { titel: 'Fußballtraining Inklusive Gruppe TuS Neuwied', start: '2026-09-05T10:00:00', ende: '2026-09-05T11:30:00', ort: 'Sportplatzweg 3, 56566 Neuwied', beschreibung: 'Samstags. Nur informativ; Jonas Weidmann nimmt selbstständig teil.' }
  ],

  aufgaben: [
    { titel: 'Gesamtplankonferenz vorbereiten', beschreibung: 'Unterlagen zusammenstellen: Stellungnahme Dr. Bracht, Rückmeldung der Werkstatt, Bereitschaftserklärung Gärtnerei Hoffmann, Dokumentation der geäußerten Wünsche seit 07/2025. Bildkarten für Jonas Weidmann vorbereiten.', faellig: '2026-09-18', prio: 'hoch' },
    { titel: 'Elterngespräch am 08.09.2026 vorbereiten', beschreibung: 'Sorgen der Mutter ernst nehmen und schriftlich festhalten, welche Sicherungen es gibt: Rückkehrrecht in die Werkstatt, Begleitung durch den Integrationsfachdienst, Probephase.', faellig: '2026-09-05', prio: 'hoch' },
    { titel: 'Erörterung zur Medikamentenreduktion in leichter Sprache vorbereiten', beschreibung: 'Mit der Bezugsassistenz Bildkarten für „Tablette weniger" und „Anfall" erstellen. Erste Erörterung eine Woche vor dem Termin.', faellig: '2026-09-08', prio: 'hoch' },
    { titel: 'Vergütungsantrag 3. Quartal 2026 stellen', beschreibung: 'Mittellos, Staatskasse, stationäre Einrichtung, ab dem 25. Monat.', faellig: '2026-09-12', prio: 'normal' },
    { titel: 'Winterkleidung mit der Wohngruppe beschaffen', beschreibung: 'Bekleidungspauschale angespart. Einkauf mit Bildliste, Jonas Weidmann wählt selbst aus.', faellig: '2026-10-16', prio: 'normal' },
    { titel: 'Letzte Rate Sanitätshaus Rheinvital abschließen', beschreibung: 'Restbetrag 89 €. Nach Zahlung Ratenvereinbarung beenden und Bestätigung anfordern.', faellig: '2026-10-01', prio: 'niedrig' },
    { titel: 'Zuzahlungsbefreiung 2027 bei der AOK beantragen', beschreibung: 'Grundsicherungsbescheid als Nachweis beifügen.', faellig: '2026-12-02', prio: 'normal' },
    { titel: 'Vokabular des Kommunikationstablets erweitern', beschreibung: 'Mit der Beratungsstelle UK Termin vereinbaren; Arbeitsbegriffe für die Gärtnerei ergänzen.', faellig: '2026-11-13', prio: 'niedrig' }
  ],

  fahrten: [
    { datum: '2026-06-09', anlass: 'Besuch in der Wohngruppe, Kontakteinschätzung', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Wiedbachstraße 28, 56567 Neuwied', km: 72.4 },
    { datum: '2026-02-19', anlass: 'Begleitung EEG-Kontrolle in der Epilepsieambulanz', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Koblenzer Straße 115, 56073 Koblenz', km: 64.6 },
    { datum: '2026-03-25', anlass: 'Begleitung Zahnbehandlung in Sedierung', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Marktstraße 48, 56564 Neuwied', km: 70.2 },
    { datum: '2026-08-07', anlass: 'Besuch, Vorbereitung Gesamtplankonferenz', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Wiedbachstraße 28, 56567 Neuwied', km: 72.4 }
  ],

  rechnungen: [
    { datum: '2026-03-09', nummer: 'RE-2026-0091', empfaenger: 'Landesjustizkasse Mainz (Staatskasse)', zweck: 'Betreuervergütung (VBVG, mittellos, stationäre Einrichtung)', zeitraum: '01.12.2025 - 28.02.2026', summe: 294, eingang: '2026-03-30', eingangsbetrag: 294 },
    { datum: '2026-06-11', nummer: 'RE-2026-0181', empfaenger: 'Landesjustizkasse Mainz (Staatskasse)', zweck: 'Betreuervergütung (VBVG, mittellos, stationäre Einrichtung)', zeitraum: '01.03.2026 - 31.05.2026', summe: 294, eingang: '2026-07-02', eingangsbetrag: 294 }
  ],

  exporte: [
    L.ausgang(F, 1, {
      datum: '2023-04-19', zeit: '1122', reportId: 'broadcast_exemption_application',
      dokumentTitel: 'Befreiungsantrag', exportMode: 'letterhead',
      empfaenger: 'ARD ZDF Deutschlandradio Beitragsservice, 50656 Köln',
      empfaengerZeilen: ['ARD ZDF Deutschlandradio Beitragsservice', '50656 Köln'],
      betreff: 'Antrag auf Befreiung vom Rundfunkbeitrag – Jonas Weidmann – Beitragsnummer 885 447 122',
      status: 'sent', channel: 'post',
      dokuGruppe: 'Wohnen, Energie & Kommunikation', dokuAkteur: 'Energie-/ Telefon-/ Internet-Dienstleister',
      dokuDetail: 'Antragsstellung',
      inhalt: {
        bezug: 'Beitragsnummer 885 447 122 – Jonas Weidmann, geb. 17.02.2005',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'für Herrn Jonas Weidmann beantrage ich die Befreiung vom Rundfunkbeitrag nach § 4 Abs. 1 Nr. 6 RBStV.\n\nHerr Weidmann bezieht seit dem 01.03.2023 Grundsicherung bei Erwerbsminderung nach dem 4. Kapitel SGB XII (Kreisverwaltung Neuwied, GruSi-NR 2023/0844). Ergänzend besteht ein Grad der Behinderung von 90 mit dem Merkzeichen H.\n\nDie Befreiung wird ab dem 01.09.2023 beantragt, jeweils für die Dauer des Bewilligungszeitraums. Ich bitte um Zusendung sämtlicher Bescheide ausschließlich an meine Büroanschrift.',
        anlagen: ['Bewilligungsbescheid über die Grundsicherung', 'Kopie des Schwerbehindertenausweises (SB 2023/44 712)', 'Beglaubigte Ausfertigung der Bestellungsurkunde vom 06.02.2023']
      }
    }),
    L.ausgang(F, 2, {
      datum: '2023-06-14', zeit: '1440', reportId: 'initial', art: 'bericht',
      dokumentTitel: 'Anfangsbericht', exportMode: 'original',
      empfaenger: 'Amtsgericht Neuwied, Hermannstraße 34, 56564 Neuwied',
      betreff: 'Betreuung Jonas Weidmann – Anfangsbericht – Az. 9 XVII 62/23',
      status: 'sent', channel: 'post',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Betreuungsspezifischer Vorgang', dokuDetail: 'Berichterstattung',
      inhalt: {
        kopf: ['Amtsgericht Neuwied · Az. 9 XVII 62/23', 'Betreute Person: Jonas Weidmann, geb. 17.02.2005', 'Betreuungsbeginn: 17.02.2023 (Eintritt der Volljährigkeit) · Berichtsstichtag: 14.06.2023'],
        ortDatum: 'St. Goarshausen, 14.06.2023',
        abschnitte: [
          { titel: '1. Persönliche Situation', felder: [
            ['Meldeanschrift', 'Am Kirchberg 14, 56566 Neuwied (Elternhaus)'],
            ['Art des Aufenthalts', 'eigene Häuslichkeit'],
            ['Schwerwiegende Krankheiten', 'Frühkindlicher Autismus (F84.0), diagnostiziert 2009. Leichte Intelligenzminderung mit deutlicher Verhaltensstörung (F70.1). Generalisierte idiopathische Epilepsie, seit 2021 anfallsfrei unter Levetiracetam. Anaphylaktische Erdnussallergie mit Notfallset.'],
            ['Fähigkeiten und Ressourcen', 'Jonas Weidmann hat ein sehr gutes visuelles Gedächtnis und eine ausgeprägte Detailwahrnehmung. Er kennt sich mit Zügen und Fahrplänen aus und ordnet seine Modellsammlung eigenständig. Feste Abläufe hält er zuverlässig ein. Er kann sich sprachlich in kurzen Sätzen verständigen und zeigt deutlich, was er möchte und was nicht.'],
            ['Beeinträchtigungen', 'Die Verständigung ist auf einfache Sprache und kurze Sätze angewiesen; komplexe Zusammenhänge erfasst Jonas Weidmann nicht. Veränderungen und unangekündigte Abweichungen führen zu erheblicher Anspannung, in deren Folge es zu selbstverletzendem Verhalten kommen kann. Die Tragweite rechtsgeschäftlicher Erklärungen kann er nicht überblicken.']
          ] },
          { titel: '2. Ziele der Betreuung und Maßnahmen', felder: [
            ['Ziele der Betreuung', 'Sicherung des Lebensunterhalts nach dem Wegfall des Kindesunterhalts. Gestaltung des Übergangs von der Schule in den Berufsbildungsbereich der Werkstatt. Beantragung der behinderungsbedingten Nachteilsausgleiche. Sicherstellung des Allergie- und Anfallsmanagements. Schrittweise Vorbereitung einer eigenen Wohnform.'],
            ['Ergriffene und geplante Maßnahmen', 'Antrag auf Grundsicherung vom 20.02.2023. Antrag auf Weiterzahlung und Abzweigung des Kindergeldes vom 06.03.2023. Neuantrag Schwerbehindertenausweis vom 08.03.2023. Verordnung von zwei Adrenalin-Autoinjektoren. Antrag auf Aufnahme in die Werkstatt vom 11.05.2023. Geplant: Pflegegradantrag, Notfall- und Kommunikationspass, eigene Haftpflichtversicherung.'],
            ['Handeln gegen den Willen der betreuten Person', 'Bislang wurde nichts gegen den Willen von Jonas Weidmann veranlasst.']
          ] },
          { titel: '3. Wünsche der betreuten Person', felder: [
            ['Kann die betreute Person persönliche Wünsche äußern?', 'bedingt'],
            ['Wünsche und Erwartungen', 'Jonas Weidmann äußert Wünsche vor allem konkret und im Alltag: Er möchte weiter Fußball spielen, seine Zugmodelle behalten und dass sich Abläufe nicht ändern.'],
            ['Nicht erfüllbare Wünsche', 'Der Wunsch, dass sich nichts ändert, kollidiert mit dem bevorstehenden Schulabschluss; dieser Übergang wird mit langem Vorlauf und einem Bildkalender vorbereitet.'],
            ['Erster persönlicher Kontakt', '24.02.2023']
          ] }
        ]
      }
    }),
    L.ausgang(F, 3, {
      datum: '2026-02-10', zeit: '1055', reportId: 'sgb9_initial_application', art: 'bericht',
      dokumentTitel: 'Hauptantrag Eingliederungshilfe', exportMode: 'letterhead',
      empfaenger: 'Landesamt für Soziales, Jugend und Versorgung – Eingliederungshilfe, Baedekerstraße 2-20, 56073 Koblenz',
      betreff: 'Antrag auf Erprobung eines Budgets für Arbeit – Jonas Weidmann – EGH-NR 2023/1157',
      status: 'sent', channel: 'post', notiz: 'Gesamtplankonferenz für den 24.09.2026 terminiert.',
      dokuGruppe: 'Sozialleistungsträger & öffentliche Stellen', dokuAkteur: 'Sozialverwaltungsbehörde',
      dokuArt: 'Arbeit, Beschäftigung, Bildung & Teilhabe', dokuDetail: 'Antragsstellung',
      inhalt: {
        kopf: ['Landesamt für Soziales, Jugend und Versorgung – Eingliederungshilfe · EGH-NR 2023/1157', 'Jonas Weidmann, geb. 17.02.2005, Wiedbachstraße 28, 56567 Neuwied'],
        ortDatum: 'St. Goarshausen, 10.02.2026',
        abschnitte: [
          { titel: 'Beantragte Leistung', felder: [
            ['Leistung', 'Budget für Arbeit nach § 61 SGB IX – Erprobung einer Tätigkeit auf dem allgemeinen Arbeitsmarkt bei der Gärtnerei Hoffmann GmbH'],
            ['Umfang', 'Zunächst zwei Tage wöchentlich, Begleitung durch den Integrationsfachdienst Nord-Rheinland-Pfalz, uneingeschränktes Rückkehrrecht in den Arbeitsbereich der Werkstatt'],
            ['Beginn', 'Anfang 2027, zunächst für sechs Monate']
          ] },
          { titel: 'Begründung', felder: [
            ['Wille der betreuten Person', 'Jonas Weidmann äußert seit Juli 2025 wiederholt und aus eigenem Antrieb den Wunsch, außerhalb der Werkstatt und im Freien zu arbeiten. Diese Äußerung ist bemerkenswert, weil sie über sein Kommunikationstablet ohne Vorgabe eines Themas entstanden ist und seither unverändert wiederholt wurde – zuletzt am 09.06.2026 unaufgefordert. Er hat sich hierfür ein eigenes Symbolfeld „Gärtnerei" anlegen lassen.'],
            ['Fachliche Einschätzung', 'Die Gruppenleitung der Werkstatt hält eine Erprobung für möglich. Dr. med. Cornelia Bracht befürwortet sie in ihrer Stellungnahme vom 24.06.2026 ausdrücklich, sofern die Begleitung engmaschig erfolgt und die Rückkehr in die Werkstatt jederzeit möglich bleibt. Die Gärtnerei Hoffmann hat eine Bereitschaftserklärung abgegeben.'],
            ['Sicherungen', 'Der Sorge der Mutter vor einer Überforderung – wie bei der Krise im Herbst 2023 – wird durch die begrenzte Stundenzahl, die Begleitung durch den Integrationsfachdienst und das uneingeschränkte Rückkehrrecht Rechnung getragen.'],
            ['Mitwirkung', 'Jonas Weidmann nimmt an der Gesamtplankonferenz teil und bringt sein Kommunikationstablet mit.']
          ] }
        ]
      }
    }),
    L.ausgang(F, 4, {
      datum: '2026-03-24', zeit: '1017', reportId: 'annual_noassets', art: 'bericht',
      dokumentTitel: 'Jahresbericht ohne Vermögenssorge', exportMode: 'original',
      empfaenger: 'Amtsgericht Neuwied, Hermannstraße 34, 56564 Neuwied',
      betreff: 'Betreuung Jonas Weidmann – Jahresbericht 01.03.2025 – 28.02.2026 – Az. 9 XVII 62/23',
      status: 'sent', channel: 'ebo',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Betreuungsspezifischer Vorgang', dokuDetail: 'Jahresbericht / Entwicklungsbericht',
      inhalt: {
        kopf: ['Amtsgericht Neuwied · Az. 9 XVII 62/23', 'Betreute Person: Jonas Weidmann, geb. 17.02.2005', 'Berichtszeitraum: 01.03.2025 bis 28.02.2026'],
        ortDatum: 'St. Goarshausen, 24.03.2026',
        abschnitte: [
          { titel: 'Persönliche Verhältnisse', felder: [
            ['Ständiger Aufenthalt', 'Außenwohngruppe „Wiedblick" der Lebenshilfe Neuwied, Wiedbachstraße 28, 56567 Neuwied, Appartement 4'],
            ['Heimunterbringung', 'ja'],
            ['Persönlicher Eindruck', 'Jonas Weidmann war im Berichtszeitraum durchgehend stabil und wirkte bei beiden Besuchen ausgeglichen und zugewandt. Die deutlichste Entwicklung betrifft die Kommunikation: Seit der Versorgung mit dem Kommunikationstablet im Januar 2025 äußert er eigenständig Wünsche, die zuvor nicht erkennbar waren. Auch die Selbstständigkeit hat zugenommen: Den Weg zur Werkstatt legt er seit Mai 2025 allein mit dem Bus zurück.'],
            ['Entwicklung des Zustands', 'gebessert'],
            ['Bewertung der weiteren Betreuung', 'weiter erforderlich']
          ] },
          { titel: 'Begründung und Vermögen', felder: [
            ['Erforderlichkeit', 'Jonas Weidmann kann die Tragweite rechtsgeschäftlicher Erklärungen nicht überblicken; der im März 2023 abgeschlossene Mobilfunkvertrag über 684,90 € zeigt dies deutlich. Zugleich ist er sehr wohl in der Lage, seinen Willen zu äußern, und tut dies über die Unterstützte Kommunikation zunehmend differenziert. Die Betreuung hat deshalb vor allem die Aufgabe, diesen Willen zu ermitteln, ihm gegenüber Dritten Geltung zu verschaffen und die rechtlichen Schritte umzusetzen.'],
            ['Ungefähres Vermögen', 'Girokonto 486,22 €, Sparkonto (Schonvermögen) 2.840,00 €, Barbetragskonto der Wohngruppe 68,40 €. Restverbindlichkeit 89,00 € gegenüber dem Sanitätshaus Rheinvital.']
          ] },
          { titel: 'Sonstiges', felder: [
            ['Berichtenswerte Entwicklungen', 'Der wesentliche Vorgang ist der eigenständig geäußerte Wunsch, außerhalb der Werkstatt zu arbeiten. Die Werkstatt hält eine Erprobung für möglich, Dr. Bracht befürwortet sie, und die Gärtnerei Hoffmann hat eine Bereitschaftserklärung abgegeben. Die Mutter hat erhebliche Bedenken; hierzu fand am 04.03.2026 ein ausführliches Gespräch statt.'],
            ['Sichtweise der betreuten Person', 'Auf die Frage nach den Besuchen zeigte Jonas Weidmann auf dem Tablet das Symbol „gut". Den Wunsch nach einer Arbeit außerhalb der Werkstatt hat er wiederholt und unaufgefordert bestätigt.']
          ] }
        ]
      }
    }),
    L.ausgang(F, 5, {
      datum: '2026-06-11', zeit: '0855', reportId: 'remuneration_pdf', art: 'bericht',
      dokumentTitel: 'Betreuervergütungen', exportMode: 'original',
      empfaenger: 'Amtsgericht Neuwied, Hermannstraße 34, 56564 Neuwied',
      betreff: 'Betreuung Jonas Weidmann – Vergütungsantrag 01.03.2026 – 31.05.2026 – Az. 9 XVII 62/23',
      status: 'sent', channel: 'ebo',
      dokuGruppe: 'Büroorganisation / interne Bearbeitung', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Büroorganisation / interne Bearbeitung', dokuDetail: 'Berichterstattung',
      inhalt: {
        kopf: ['Amtsgericht Neuwied · Az. 9 XVII 62/23', 'Betreute Person: Jonas Weidmann, geb. 17.02.2005'],
        ortDatum: 'St. Goarshausen, 11.06.2026',
        abschnitte: [
          { titel: 'Abrechnungsabschnitt', felder: [
            ['Zeitraum', '01.03.2026 bis 31.05.2026'],
            ['Vergütungsstufe', '2 (ab dem 25. Monat der Betreuung)'],
            ['Wohnform', 'stationäre Einrichtung / gleichgestellte Wohnform'],
            ['Vermögensstatus', 'mittellos – Zahlung aus der Staatskasse'],
            ['Monatliche Pauschale', '98,00 €'],
            ['Gesamtbetrag', '294,00 €']
          ] },
          { titel: 'Ergänzende Angaben', felder: [
            ['Grundlage', '§ 8 VBVG, Vergütungstabelle B'],
            ['Anlagen', 'Bewilligungsbescheid Grundsicherung vom 14.08.2025, Bescheinigung der Lebenshilfe Neuwied gGmbH über die Wohnform vom 03.06.2026']
          ] }
        ]
      }
    }),
    L.ausgang(F, 6, {
      datum: '2026-06-15', zeit: '1338', reportId: 'letter_information_notice',
      dokumentTitel: 'Behörden-Mitteilung', exportMode: 'letterhead',
      empfaenger: 'Familienkasse Rheinland-Pfalz-Saarland, Brückenstraße 10, 54290 Trier',
      empfaengerZeilen: ['Familienkasse Rheinland-Pfalz-Saarland', 'Brückenstraße 10', '54290 Trier'],
      betreff: 'Kindergeld für Jonas Weidmann – Mitteilung über die unveränderte Fortdauer der Anspruchsvoraussetzungen – FK 447 120 885',
      mail: 'familienkasse-rheinland-pfalz-saarland@arbeitsagentur.de',
      status: 'sent', channel: 'mail',
      dokuGruppe: 'Sozialleistungsträger & öffentliche Stellen', dokuAkteur: 'Familienkasse',
      dokuArt: 'Kontrolle, Prüfung & Nachverfolgung', dokuDetail: 'Anschreiben',
      inhalt: {
        bezug: 'Kindergeldnummer FK 447 120 885 – Jonas Weidmann, geb. 17.02.2005',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'in der oben genannten Angelegenheit zeige ich an, dass sich die Verhältnisse gegenüber Ihrem Bescheid vom 27.04.2023 nicht geändert haben.\n\nHerr Jonas Weidmann ist weiterhin außerstande, sich selbst zu unterhalten. Er arbeitet seit dem 04.08.2025 im Arbeitsbereich der Werkstatt Neuwied der Lebenshilfe und erzielt dort ein Arbeitsentgelt von 226,00 € monatlich. Ergänzend bezieht er Grundsicherung bei Erwerbsminderung nach dem 4. Kapitel SGB XII. Der Grad der Behinderung beträgt unverändert 90 mit den Merkzeichen G, B und H; die Behinderung ist vor Vollendung des 25. Lebensjahres eingetreten.\n\nDie mit Bescheid vom 27.04.2023 angeordnete Abzweigung des Kindergeldes an die betreute Person soll unverändert fortbestehen. Herr Weidmann lebt seit dem 01.09.2024 in einer besonderen Wohnform der Eingliederungshilfe; die Eltern kommen für seinen Unterhalt nicht auf.\n\nSollten weitere Nachweise erforderlich sein, reiche ich diese gern nach.',
        anlagen: ['Entgeltbescheinigung der Werkstatt Neuwied vom 03.06.2026', 'Bewilligungsbescheid Grundsicherung vom 14.08.2025', 'Kopie des Schwerbehindertenausweises']
      }
    }),
    L.ausgang(F, 7, {
      datum: '2026-08-07', zeit: '1650', reportId: 'sgb12_social_assistance_short', art: 'bericht',
      dokumentTitel: 'Kurzantrag Sozialhilfe SGB XII', exportMode: 'letterhead',
      empfaenger: 'Kreisverwaltung Neuwied, Sozialamt, Wilhelm-Leuschner-Straße 9, 56564 Neuwied',
      betreff: 'Weiterbewilligung Grundsicherung ab 01.09.2027 – Jonas Weidmann – GruSi-NR 2023/0844',
      status: 'created', notiz: 'Entwurf; wird nach dem Ergebnis der Gesamtplankonferenz und mit aktuellen Nachweisen im Juli 2027 versendet.',
      dokuGruppe: 'Sozialleistungsträger & öffentliche Stellen', dokuAkteur: 'Grundsicherungsamt',
      dokuDetail: 'Weiterbewilligungsantrag',
      inhalt: {
        kopf: ['Kreisverwaltung Neuwied, Sozialamt · GruSi-NR 2023/0844', 'Jonas Weidmann, geb. 17.02.2005, Wiedbachstraße 28, 56567 Neuwied'],
        ortDatum: 'St. Goarshausen, 07.08.2026',
        abschnitte: [
          { titel: 'Beantragte Leistung', felder: [
            ['Leistung', 'Weiterbewilligung der Grundsicherung bei Erwerbsminderung nach dem 4. Kapitel SGB XII'],
            ['Zeitraum', '01.09.2027 bis 31.08.2028'],
            ['Haushalt', 'Besondere Wohnform der Eingliederungshilfe mit eigenem Appartement; keine Einstandsgemeinschaft.']
          ] },
          { titel: 'Einkommen und Vermögen', felder: [
            ['Einkommen', 'Arbeitsentgelt der Werkstatt Neuwied 226,00 €, Kindergeld (abgezweigt) 255,00 €, ergänzende Grundsicherung 743,50 € monatlich.'],
            ['Vermögen', 'Girokonto 486,22 €, Sparkonto 2.840,00 €, Barbetragskonto 68,40 €. Das Sparguthaben liegt innerhalb des Schonbetrages.'],
            ['Absehbare Änderung', 'Sofern die Erprobung eines Budgets für Arbeit beginnt, tritt an die Stelle des Werkstattlohns ein Arbeitsentgelt des Arbeitgebers, ergänzt um einen Lohnkostenzuschuss. Dies wird unverzüglich angezeigt.'],
            ['Anlagen', 'Entgeltbescheinigung, Kontoauszüge aller drei Konten der letzten drei Monate, Bescheid über die Eingliederungshilfe, Entgeltbescheinigung der Wohngruppe, Kindergeldbescheid']
          ] }
        ]
      }
    })
  ],

  archive: [
    L.archiv(F, 1, {
      reportId: 'initial', titel: 'Anfangsbericht', archiviertAm: '2023-06-14', zeit: '14:40',
      erstelltAm: '2023-05-02', von: '17.02.2023', bis: '14.06.2023',
      name: '230614 1440 Amtsgericht Neuwied Anfangsbericht',
      notiz: 'Beim Betreuungsgericht eingereichte Fassung des Anfangsberichts, erstellt im ersten Jahr nach Eintritt der Volljährigkeit.',
      felder: {
        registered_address: 'Am Kirchberg 14, 56566 Neuwied (Elternhaus)',
        employment_status: 'Beschäftigungsangebot / Tagesstruktur',
        employer_occupation: 'Bis 07/2023 Christiane-Herzog-Schule; ab 08/2023 Berufsbildungsbereich der Werkstatt Neuwied',
        goals: 'Sicherung des Lebensunterhalts nach dem Wegfall des Kindesunterhalts. Gestaltung des Übergangs von der Schule in die Werkstatt. Beantragung der Nachteilsausgleiche. Sicherstellung des Allergie- und Anfallsmanagements. Schrittweise Vorbereitung einer eigenen Wohnform.',
        measures: 'Antrag auf Grundsicherung, Kindergeld mit Abzweigung, Schwerbehindertenausweis. Verordnung von zwei Adrenalin-Autoinjektoren. Antrag auf Aufnahme in die Werkstatt.',
        can_express_wishes: 'bedingt',
        first_contact: '2023-02-24',
        contact_count: 3
      }
    }),
    L.archiv(F, 2, {
      reportId: 'annual_noassets', titel: 'Jahresbericht ohne Vermögenssorge', archiviertAm: '2025-03-20', zeit: '09:35',
      erstelltAm: '2025-02-24', von: '01.03.2024', bis: '28.02.2025',
      name: '250320 0935 Amtsgericht Neuwied Jahresbericht ohne Vermögenssorge',
      notiz: 'Eingereichter Jahresbericht 2024/2025 – erster Bericht nach dem Wechsel in die Außenwohngruppe.',
      felder: {
        residence: 'Außenwohngruppe „Wiedblick" der Lebenshilfe Neuwied, Wiedbachstraße 28, 56567 Neuwied, Appartement 4',
        home_placement: 'ja',
        personal_impression: 'Der Wechsel in die Außenwohngruppe zum 01.09.2024 hat sich als richtig erwiesen. Seit dem Umzug in das eigene, reizarm gestaltete Appartement und mit durchgehend derselben Bezugsassistenz sind keine Anspannungskrisen mehr aufgetreten. Im Januar 2025 wurde das Kommunikationstablet geliefert; die Schulung von Wohngruppe, Werkstatt und Eltern ist abgeschlossen.',
        condition_change: 'gebessert',
        care_need: 'weiter erforderlich',
        care_need_reason: 'Die Tragweite rechtsgeschäftlicher Erklärungen kann Jonas Weidmann nicht überblicken; behördliche Verfahren kann er nicht führen. Zugleich ist er in der Lage, seinen Willen zu äußern.',
        approx_assets: 'Girokonto 402,80 €, Sparkonto 2.600,00 €, Barbetragskonto 82,60 €.',
        discussed: 'ja',
        discussed_date: '2025-03-12'
      }
    }),
    L.archiv(F, 3, {
      reportId: 'annual_noassets', titel: 'Jahresbericht ohne Vermögenssorge', archiviertAm: '2026-03-24', zeit: '10:17',
      erstelltAm: '2026-02-26', von: '01.03.2025', bis: '28.02.2026',
      name: '260324 1017 Amtsgericht Neuwied Jahresbericht ohne Vermögenssorge',
      notiz: 'Eingereichte Fassung mit dem eigenständig geäußerten Berufswunsch als Schwerpunkt.',
      felder: {
        residence: 'Außenwohngruppe „Wiedblick" der Lebenshilfe Neuwied, Wiedbachstraße 28, 56567 Neuwied, Appartement 4',
        home_placement: 'ja',
        personal_impression: 'Jonas Weidmann war im Berichtszeitraum durchgehend stabil. Die deutlichste Entwicklung betrifft die Kommunikation: Seit der Versorgung mit dem Kommunikationstablet im Januar 2025 äußert er eigenständig Wünsche, die zuvor nicht erkennbar waren. Im Juli 2025 hat er erstmals aus eigenem Antrieb einen Berufswunsch formuliert.',
        condition_change: 'gebessert',
        care_need: 'weiter erforderlich',
        approx_assets: 'Girokonto 486,22 €, Sparkonto 2.840,00 €, Barbetragskonto 68,40 €. Restverbindlichkeit 89,00 €.',
        discussed: 'ja',
        discussed_date: '2026-03-18'
      }
    })
  ],

  berichte: {
    initial: L.bericht({
      registered_address: 'Am Kirchberg 14, 56566 Neuwied (Elternhaus)',
      current_residence: 'Am Kirchberg 14, 56566 Neuwied (Elternhaus)',
      residence_type: ['eigene Häuslichkeit'],
      planned_housing_changes: 'Jonas Weidmann lebt bei seinen Eltern. Im Rahmen des Übergangs von der Schule in die Werkstatt ist zu prüfen, ob und wann ein Umzug in eine Wohnform der Eingliederungshilfe sinnvoll ist. Die Eltern halten dies mittelfristig für erforderlich, möchten den Schritt aber nicht überstürzen.',
      housing_notes: 'Jonas Weidmann bewohnt ein eigenes Zimmer im Elternhaus. Der Haushalt ist auf seine Bedürfnisse eingerichtet: feste Abläufe, ruhige Umgebung, Rückzugsmöglichkeit.',
      treating_doctors: 'Dr. med. Cornelia Bracht, Kinder- und Jugendpsychiatrie / Transitionsambulanz, Heddesdorfer Straße 20, 56564 Neuwied, 02631/8404120\nDr. med. Peter Ostermann, Allgemeinmedizin, Hauptstraße 62, 56566 Neuwied, 02631/354180\nDr. med. Ingrid Wahlbrink, Epileptologie, GK Mittelrhein Koblenz, 0261/4962440',
      severe_diseases: 'Frühkindlicher Autismus (F84.0), diagnostiziert 2009. Leichte Intelligenzminderung mit deutlicher Verhaltensstörung (F70.1). Generalisierte idiopathische Epilepsie (G40.3), seit 2021 anfallsfrei unter Levetiracetam. Anaphylaktische Erdnussallergie mit Notfallset.',
      treatment_care: 'Ambulante fachärztliche Anbindung an die Transitionsambulanz der Rheinhessen-Fachklinik. Antiepileptische Dauermedikation mit Levetiracetam, Melatonin zur Schlafregulation. Bislang keine dauerhafte Psychopharmakotherapie. Die Pflege erfolgt vollständig durch die Eltern; ein Pflegegrad ist nicht beantragt.',
      resources: 'Jonas Weidmann hat ein sehr gutes visuelles Gedächtnis und eine ausgeprägte Detailwahrnehmung. Er kennt sich mit Zügen und Fahrplänen aus und ordnet seine Modellsammlung eigenständig. Feste Abläufe hält er zuverlässig ein. Er kann sich sprachlich in kurzen Sätzen verständigen und zeigt deutlich, was er möchte und was nicht. Der Kontakt zur Familie ist eng und tragfähig; die Schwester hat ein gutes, unbefangenes Verhältnis zu ihm.',
      impairments: 'Die Verständigung ist auf einfache Sprache und kurze Sätze angewiesen; komplexe Zusammenhänge erfasst Jonas Weidmann nicht. Veränderungen und unangekündigte Abweichungen von gewohnten Abläufen führen zu erheblicher Anspannung, in deren Folge es zu selbstverletzendem Verhalten kommen kann. Die Tragweite rechtsgeschäftlicher Erklärungen kann er nicht überblicken. Geldwerte kann er nicht einschätzen.',
      care_level: '',
      care_allowance: 'nicht beantragt',
      health_notes: 'Ein Pflegegrad ist trotz erheblichen Unterstützungsbedarfs bislang nicht beantragt; der Antrag ist vordringlich. Das Notfallset für die Erdnussallergie ist zu erneuern und die Einweisung aufzufrischen.',
      relatives: 'Sabine Weidmann (Mutter), Am Kirchberg 14, 56566 Neuwied, 02631/774120\nThomas Weidmann (Vater), ebenda\nLena Weidmann (Schwester), Mainz',
      family_situation: 'Jonas Weidmann lebt bei seinen Eltern, die ihn seit der Geburt umfassend versorgen und sehr engagiert sind. Die Mutter hat ihre Berufstätigkeit reduziert. Die ältere Schwester studiert in Mainz und kommt regelmäßig nach Hause. Die Familie hat die Einrichtung der Betreuung selbst angeregt, weil den Eltern bewusst war, dass ihre elterliche Sorge mit der Volljährigkeit endet.',
      social_contacts: 'Kontakte bestehen über die Schule und die inklusive Fußballgruppe des TuS Neuwied, an der Jonas Weidmann seit 2019 samstags teilnimmt. Freundschaften außerhalb dieser Zusammenhänge bestehen nicht.',
      relationship: 'Das Verhältnis ist beim Erstbesuch freundlich und abwartend gewesen. Jonas Weidmann hat nach einiger Zeit seine Zugmodelle gezeigt – nach Auskunft der Eltern ein Zeichen von Vertrauen. Vereinbart wurde, dass Besuche stets eine Woche vorher angekündigt werden.',
      social_notes: 'Es ist wesentlich, Jonas Weidmann selbst zu fragen und nicht nur über ihn zu sprechen, auch wenn die Eltern schneller antworten. Diese Haltung wurde mit der Familie besprochen.',
      employment_status: 'Beschäftigungsangebot / Tagesstruktur',
      employer_occupation: 'Bis 07/2023 Christiane-Herzog-Schule (Förderschwerpunkt ganzheitliche Entwicklung); ab 08/2023 Berufsbildungsbereich der Werkstatt Neuwied',
      daily_life: 'Der Tag folgt einem festen Ablauf: Schulbus um 7:20 Uhr, Schule bis 15:00 Uhr, nachmittags Modelleisenbahn oder Spaziergang mit dem Vater, abends feste Rituale. Samstags Fußballtraining. Abweichungen werden mit einem Bildkalender angekündigt.',
      goals: 'Sicherung des Lebensunterhalts nach dem Wegfall des Kindesunterhalts durch Grundsicherung und Weiterzahlung des Kindergeldes. Gestaltung des Übergangs von der Schule in den Berufsbildungsbereich der Werkstatt. Beantragung der behinderungsbedingten Nachteilsausgleiche (Schwerbehindertenausweis, Wertmarke, Pflegegrad). Sicherstellung des Allergie- und Anfallsmanagements. Schrittweise Vorbereitung einer eigenen Wohnform.',
      measures: 'Antrag auf Grundsicherung bei Erwerbsminderung vom 20.02.2023. Antrag auf Weiterzahlung und Abzweigung des Kindergeldes vom 06.03.2023. Neuantrag Schwerbehindertenausweis vom 08.03.2023. Verordnung von zwei Adrenalin-Autoinjektoren und Organisation der Einweisung. Antrag auf Aufnahme in die Werkstatt vom 11.05.2023. Geplant: Pflegegradantrag, Erstellung eines Notfall- und Kommunikationspasses, eigene Haftpflichtversicherung.',
      against_will: 'Bislang wurde nichts gegen den Willen von Jonas Weidmann veranlasst.',
      special_matters: 'Zu klären ist, ob und wann ein Umzug in eine Wohnform der Eingliederungshilfe erfolgen soll, sowie die Frage der Verselbstständigung gegenüber den sehr fürsorglichen Eltern.',
      goal_notes: 'Der Übergang von der Schule in die Werkstatt ist im ersten Jahr der wichtigste Vorgang.',
      can_express_wishes: 'bedingt',
      wishes_care: 'Jonas Weidmann äußert Wünsche vor allem konkret und im Alltag: Er möchte weiter Fußball spielen, seine Zugmodelle behalten und dass sich Abläufe nicht ändern. Zur Betreuung selbst kann er sich nicht äußern.',
      wishes_assets: 'Er wünscht sich Geld für den Kiosk und für Zugmodelle. Ein wöchentliches Budget in bar ist ihm vertraut.',
      desired_outcome: 'Dass alles so bleibt, wie es ist: gleiche Menschen, gleiche Abläufe, Fußball am Samstag.',
      prevent_outcome: 'Unangekündigte Veränderungen und laute, unruhige Umgebungen.',
      unfulfillable_wishes: 'Derzeit sind keine geäußerten Wünsche unerfüllbar. Der Wunsch, dass sich nichts ändert, kollidiert allerdings mit dem bevorstehenden Schulabschluss; dieser Übergang wird mit langem Vorlauf und einem Bildkalender vorbereitet.',
      self_managed_assets: 'Jonas Weidmann verfügt über ein wöchentliches Budget in bar, über das er selbst entscheidet. Ein Einwilligungsvorbehalt für die Vermögenssorge besteht, weil er die Tragweite von Verträgen nicht überblickt.',
      first_contact: '2023-02-24',
      contact_count: 3,
      future_contacts: 'alle sechs bis acht Wochen, jeweils eine Woche vorher angekündigt',
      can_initiate_contact: 'nein',
      contact_limit_reason: 'Jonas Weidmann kann ein Anliegen nicht strukturiert vortragen und nutzt das Telefon nicht selbstständig. Kontaktaufnahme über die Eltern.',
      contact_notes: 'Besuche werden mit einem Bildkalender angekündigt.'
    }, '2023-06-14'),

    annual_noassets: L.bericht({
      residence: 'Außenwohngruppe „Wiedblick" der Lebenshilfe Neuwied, Wiedbachstraße 28, 56567 Neuwied, Appartement 4',
      home_placement: 'ja',
      closed_unit: 'nein',
      housing_relinquished: 'nicht einschlägig',
      care_providers: ['Personal des Heims / der Einrichtung', 'Angehörige', 'versorgt sich selbst'],
      personal_impression: 'Jonas Weidmann war im Berichtszeitraum durchgehend stabil und wirkte bei beiden Besuchen ausgeglichen und zugewandt. Die deutlichste Entwicklung betrifft die Kommunikation: Seit der Versorgung mit dem Kommunikationstablet im Januar 2025 äußert er eigenständig Wünsche, die zuvor nicht erkennbar waren. Im Juli 2025 hat er erstmals aus eigenem Antrieb einen Berufswunsch formuliert und diesen seither mehrfach unverändert wiederholt – zuletzt beim Besuch am 09.06.2026, ohne dass danach gefragt worden war. Auch die Selbstständigkeit hat zugenommen: Den Weg zur Werkstatt legt er seit Mai 2025 allein mit dem Bus zurück.',
      condition_change: 'gebessert',
      care_need: 'weiter erforderlich',
      care_need_reason: 'Jonas Weidmann kann die Tragweite rechtsgeschäftlicher Erklärungen nicht überblicken; der im März 2023 abgeschlossene Mobilfunkvertrag mit Gerätekauf über 684,90 € zeigt dies deutlich. Behördliche Verfahren – Grundsicherung, Eingliederungshilfe, Widerspruchsverfahren gegen die Krankenkasse – kann er nicht führen. Zugleich ist er sehr wohl in der Lage, seinen Willen zu äußern, und tut dies über die Unterstützte Kommunikation zunehmend differenziert. Die Betreuung hat deshalb vor allem die Aufgabe, diesen Willen zu ermitteln, ihm gegenüber Dritten Geltung zu verschaffen und die rechtlichen Schritte umzusetzen. Der Einwilligungsvorbehalt für die Vermögenssorge bleibt erforderlich. Eine Einschränkung der Aufgabenkreise kommt derzeit nicht in Betracht, weil mit dem Budget für Arbeit ein Verfahren von erheblicher Tragweite ansteht.',
      last_contact: '2026-08-07',
      contact_frequency: 'nach Bedarf',
      contact_description: 'Im Berichtszeitraum fanden fünf persönliche Besuche in der Außenwohngruppe statt sowie Termine bei der Zahnbehandlung und ein Elterngespräch im Büro. Besuche werden stets eine Woche vorher mit Bildkarten angekündigt. Gespräche werden in leichter Sprache und mit dem Kommunikationstablet geführt; jeweils nur eine Frage. Entscheidungen von Gewicht werden über zwei Termine mit Bedenkzeit vorbereitet. Ergänzend besteht regelmäßiger telefonischer Austausch mit der Bezugsassistenz Frau Ivanova und der Gruppenleitung Herrn Dombrowski sowie etwa monatlicher Kontakt zu den Eltern.',
      approx_assets: 'Girokonto 486,22 €, Sparkonto (Ansparung im Rahmen des Schonvermögens) 2.840,00 € und Barbetragskonto der Wohngruppe 68,40 € zum 31.07.2026; Ausstattung des Appartements rund 1.450 €. Restverbindlichkeit gegenüber dem Sanitätshaus Rheinvital 89,00 €. Erwerbungen oder Erbschaften gab es nicht; angeschafft wurden Lärmschutzkopfhörer und Sommerkleidung aus dem Wochengeld. Genehmigungspflichtige Geschäfte waren nicht zu tätigen; der Antrag auf Erprobung eines Budgets für Arbeit vom 10.02.2026 ist keine genehmigungsbedürftige Verfügung, wurde aber wegen seiner Tragweite in den Genehmigungen dokumentiert.',
      other_report: 'Der wesentliche Vorgang des Berichtszeitraums ist der eigenständig geäußerte Wunsch von Jonas Weidmann, außerhalb der Werkstatt zu arbeiten. Er hat ihn erstmals im Juli 2025 über das Kommunikationstablet formuliert und seither mehrfach bestätigt. Die Werkstatt hält eine Erprobung für möglich, Dr. Bracht befürwortet sie mit der Maßgabe engmaschiger Begleitung, und die Gärtnerei Hoffmann hat eine Bereitschaftserklärung abgegeben. Die Mutter hat erhebliche Bedenken und befürchtet eine Überforderung wie 2023; hierzu fand am 04.03.2026 ein ausführliches Gespräch statt, ein weiteres ist für den 08.09.2026 vorgesehen. Die Gesamtplankonferenz findet am 24.09.2026 statt. Daneben steht die Entscheidung über einen Reduktionsversuch der antiepileptischen Medikation an.',
      discussed: 'ja',
      discussed_date: '2026-03-18',
      discussed_reason: '',
      view_contacts: 'Auf die Frage nach den Besuchen zeigte Jonas Weidmann auf dem Tablet das Symbol „gut". Die Ankündigung mit Bildkarten ist ihm wichtig; ein unangekündigter Besuch im November 2025 hat ihn erkennbar irritiert und wird nicht wiederholt.',
      view_goals: 'Den Wunsch nach einer Arbeit außerhalb der Werkstatt hat Jonas Weidmann wiederholt und unaufgefordert bestätigt. Er hat sich auf dem Tablet ein eigenes Symbolfeld „Gärtnerei" anlegen lassen. Zum Wunsch nach einer eigenen Wohnung äußert er sich seltener, hält ihn aber aufrecht.',
      view_need: 'Die Frage nach der Erforderlichkeit der Betreuung kann Jonas Weidmann nicht beantworten. Auf die Frage, ob es gut sei, dass jemand die Briefe macht, zeigte er „ja".'
    }, '2026-03-24'),

    remuneration: L.bericht({
      rem_stage: '2',
      rem_request_type: 'Folgeantrag',
      rem_continuous: 'nein'
    }, '2026-06-11'),

    remuneration_pdf: L.bericht({
      remuneration_pdf_name: 'Jonas Weidmann',
      remuneration_pdf_birth: '2005-02-17',
      remuneration_pdf_address: 'Wiedbachstraße 28, 56567 Neuwied',
      remuneration_pdf_reference: '9 XVII 62/23',
      remuneration_pdf_details: 'Vergütungsabschnitt 01.03.2026 bis 31.05.2026. Vergütung nach § 8 VBVG, Vergütungstabelle B (stationäre Einrichtung / gleichgestellte Wohnform), Vergütungsstufe 2, ab dem 25. Monat der Betreuung. Monatliche Pauschale 98,00 €, Abrechnungszeitraum drei Monate, Gesamtbetrag 294,00 €. Herr Weidmann ist mittellos; die Vergütung wird aus der Staatskasse beantragt.',
      remuneration_pdf_attachments: 'Bewilligungsbescheid Grundsicherung der Kreisverwaltung Neuwied vom 14.08.2025 (GruSi-NR 2023/0844), Bescheinigung der Lebenshilfe Neuwied gGmbH über die Wohnform vom 03.06.2026.',
      remuneration_pdf_notes: 'Die Wohnform hat sich im Abrechnungszeitraum nicht geändert. Ab einer möglichen Erprobung eines Budgets für Arbeit im Jahr 2027 bleibt die Wohnform unverändert.'
    }, '2026-06-11'),

    sgb9_initial_application: L.bericht({
      sgb9_initial_application_name: 'Jonas Weidmann',
      sgb9_initial_application_birth: '2005-02-17',
      sgb9_initial_application_address: 'Außenwohngruppe „Wiedblick", Wiedbachstraße 28, 56567 Neuwied',
      sgb9_initial_application_reference: 'EGH-NR 2023/1157',
      sgb9_initial_application_benefit: 'Budget für Arbeit nach § 61 SGB IX – Erprobung einer Tätigkeit auf dem allgemeinen Arbeitsmarkt bei der Gärtnerei Hoffmann GmbH, zunächst zwei Tage wöchentlich, mit Begleitung durch den Integrationsfachdienst und uneingeschränktem Rückkehrrecht in den Arbeitsbereich der Werkstatt',
      sgb9_initial_application_start: 'Beginn der Erprobung Anfang 2027, zunächst für sechs Monate',
      sgb9_initial_application_household: 'Herr Weidmann lebt seit dem 01.09.2024 im Appartement 4 der Außenwohngruppe „Wiedblick" der Lebenshilfe Neuwied gGmbH mit sechs Plätzen. Assistenz morgens, abends und am Wochenende, Nachtbereitschaft im Haupthaus. Bezugsassistenz ist seit dem Einzug durchgehend Frau Nadja Ivanova. Die Eltern wohnen in Neuwied-Engers und haben engen Kontakt.',
      sgb9_initial_application_income: 'Arbeitsentgelt im Arbeitsbereich der Werkstatt Neuwied (Grundbetrag und Steigerungsbetrag) 226,00 € monatlich. Grundsicherung bei Erwerbsminderung nach dem 4. Kapitel SGB XII 743,50 € monatlich. Kindergeld über die Volljährigkeit hinaus wegen Behinderung, an die betreute Person abgezweigt, 255,00 € monatlich.',
      sgb9_initial_application_assets: 'Girokonto bei der Sparkasse Neuwied mit 486,22 € (Stand 31.07.2026), Sparkonto als Ansparung im Rahmen des Schonvermögens mit 2.840,00 €, Barbetragskonto der Wohngruppe mit 68,40 €. Restverbindlichkeit gegenüber dem Sanitätshaus Rheinvital von 89,00 € aus dem Eigenanteil für das Zubehör des Kommunikationstablets. Verwertbares Vermögen oberhalb des Schonbetrages besteht nicht.',
      sgb9_initial_application_needs: 'Frühkindlicher Autismus (F84.0) und leichte Intelligenzminderung mit deutlicher Verhaltensstörung (F70.1); generalisierte Epilepsie, seit 2021 anfallsfrei; anaphylaktische Erdnussallergie mit Notfallset. Grad der Behinderung 90 mit den Merkzeichen G, B und H, Pflegegrad 2. Herr Weidmann arbeitet seit August 2023 in der Werkstatt Neuwied, seit August 2025 im Arbeitsbereich Montage und Verpackung. Seit Juli 2025 äußert er wiederholt und aus eigenem Antrieb über sein Kommunikationstablet den Wunsch, außerhalb der Werkstatt und im Freien zu arbeiten; er hat sich hierfür ein eigenes Symbolfeld „Gärtnerei" anlegen lassen. Der Wunsch entspricht seinen erkennbaren Stärken: ausdauernde Arbeit an gleichförmigen Aufgaben, sehr gutes visuelles Gedächtnis, gutes Zurechtkommen mit festen Abläufen im Freien. Die Gruppenleitung der Werkstatt hält eine Erprobung für möglich, Dr. med. Cornelia Bracht befürwortet sie in ihrer Stellungnahme vom 24.06.2026 unter der Maßgabe engmaschiger Begleitung, und die Gärtnerei Hoffmann hat eine Bereitschaftserklärung abgegeben.',
      sgb9_initial_application_notes: 'Die Sorge der Mutter vor einer Überforderung – wie bei der Krise im Herbst 2023 – wird ernst genommen; ihr wird durch die begrenzte Stundenzahl, die Begleitung durch den Integrationsfachdienst Nord-Rheinland-Pfalz und das uneingeschränkte Rückkehrrecht in die Werkstatt Rechnung getragen. Herr Weidmann nimmt an der Gesamtplankonferenz am 24.09.2026 teil und bringt sein Kommunikationstablet mit; beim Besuch am 07.08.2026 hat er erklärt, er wolle selbst „zeigen, was er will".'
    }, '2026-08-07'),

    sgb12_social_assistance_short: L.bericht({
      sgb12_social_assistance_short_name: 'Jonas Weidmann',
      sgb12_social_assistance_short_birth: '2005-02-17',
      sgb12_social_assistance_short_address: 'Außenwohngruppe „Wiedblick", Wiedbachstraße 28, 56567 Neuwied',
      sgb12_social_assistance_short_reference: 'GruSi-NR 2023/0844',
      sgb12_social_assistance_short_benefit: 'Weiterbewilligung der Grundsicherung bei Erwerbsminderung nach dem 4. Kapitel SGB XII',
      sgb12_social_assistance_short_start: '01.09.2027, Bewilligungszeitraum zwölf Monate',
      sgb12_social_assistance_short_household: 'Herr Weidmann lebt in einer besonderen Wohnform der Eingliederungshilfe mit eigenem Appartement. Eine Einstandsgemeinschaft besteht nicht.',
      sgb12_social_assistance_short_income: 'Arbeitsentgelt der Werkstatt Neuwied 226,00 €, Kindergeld über die Volljährigkeit hinaus 255,00 € (abgezweigt an die betreute Person), ergänzende Grundsicherung 743,50 € monatlich.',
      sgb12_social_assistance_short_assets: 'Girokonto 486,22 €, Sparkonto 2.840,00 €, Barbetragskonto der Wohngruppe 68,40 € (Stand 31.07.2026). Das Sparguthaben liegt innerhalb des Schonbetrages. Kein Grundvermögen, keine Lebensversicherung.',
      sgb12_social_assistance_short_needs: 'Frühkindlicher Autismus, leichte Intelligenzminderung, Epilepsie (anfallsfrei), anaphylaktische Erdnussallergie. Grad der Behinderung 90 mit den Merkzeichen G, B und H, Pflegegrad 2. Dauerhaft voll erwerbsgemindert; Werkstattbeschäftigung im Arbeitsbereich.',
      sgb12_social_assistance_short_notes: 'Sofern die Erprobung eines Budgets für Arbeit beginnt, ändert sich die Einkommenssituation: Statt des Werkstattlohns tritt ein Arbeitsentgelt des Arbeitgebers, ergänzt um einen Lohnkostenzuschuss. Dies wird unverzüglich angezeigt. Beigefügt: Entgeltbescheinigung der Werkstatt, Kontoauszüge aller drei Konten der letzten drei Monate, Bescheid über die Eingliederungshilfe, Entgeltbescheinigung der Wohngruppe, Kindergeldbescheid.'
    }, '2026-08-07'),

    letter_information_notice: L.bericht({
      letter_recipient_institution: 'Familienkasse Rheinland-Pfalz-Saarland',
      letter_recipient_name: '',
      letter_recipient_street: 'Brückenstraße 10',
      letter_recipient_postal_city: '54290 Trier',
      letter_recipient_email: '',
      letter_reference: 'Kindergeld für Jonas Weidmann, geb. 17.02.2005 – Kindergeldnummer FK 447 120 885',
      letter_subject: 'Mitteilung über die unveränderte Fortdauer der Anspruchsvoraussetzungen',
      letter_salutation: 'Sehr geehrte Damen und Herren,',
      letter_body: 'in der oben genannten Angelegenheit zeige ich an, dass sich die Verhältnisse gegenüber Ihrem Bescheid vom 27.04.2023 nicht geändert haben.\n\nHerr Jonas Weidmann ist weiterhin außerstande, sich selbst zu unterhalten. Er arbeitet seit dem 04.08.2025 im Arbeitsbereich der Werkstatt Neuwied der Lebenshilfe und erzielt dort ein Arbeitsentgelt von 226,00 € monatlich. Ergänzend bezieht er Grundsicherung bei Erwerbsminderung nach dem 4. Kapitel SGB XII. Der Grad der Behinderung beträgt unverändert 90 mit den Merkzeichen G, B und H; die Behinderung ist vor Vollendung des 25. Lebensjahres eingetreten.\n\nDie mit Bescheid vom 27.04.2023 angeordnete Abzweigung des Kindergeldes an die betreute Person soll unverändert fortbestehen. Herr Weidmann lebt seit dem 01.09.2024 in einer besonderen Wohnform der Eingliederungshilfe; die Eltern kommen für seinen Unterhalt nicht auf.\n\nSollten weitere Nachweise erforderlich sein, reiche ich diese gern nach.',
      letter_additions: 'Anlagen: Entgeltbescheinigung der Werkstatt Neuwied vom 03.06.2026, Bewilligungsbescheid Grundsicherung vom 14.08.2025, Kopie des Schwerbehindertenausweises'
    }, '2026-06-15'),

    broadcast_exemption_application: L.bericht({
      broadcast_exemption_application_name: 'Jonas Weidmann',
      broadcast_exemption_application_birth: '2005-02-17',
      broadcast_exemption_application_address: 'Außenwohngruppe „Wiedblick", Wiedbachstraße 28, 56567 Neuwied',
      broadcast_exemption_application_reference: '9 XVII 62/23',
      broadcast_exemption_application_number: '885 447 122',
      broadcast_exemption_application_reason: 'Herr Weidmann bezieht Grundsicherung bei Erwerbsminderung nach dem 4. Kapitel SGB XII (Kreisverwaltung Neuwied, GruSi-NR 2023/0844). Es wird die Befreiung vom Rundfunkbeitrag nach § 4 Abs. 1 Nr. 6 RBStV beantragt. Ergänzend besteht ein Grad der Behinderung von 90 mit dem Merkzeichen H.',
      broadcast_exemption_application_period: 'ab 01.09.2023, jeweils für die Dauer des Bewilligungszeitraums, derzeit bis 31.08.2027',
      broadcast_exemption_application_evidence: 'Bewilligungsbescheid über die Grundsicherung, Kopie des Schwerbehindertenausweises (SB 2023/44 712), beglaubigte Ausfertigung der Bestellungsurkunde vom 06.02.2023.',
      broadcast_exemption_application_notes: 'Bescheide bitte ausschließlich an die Betreuung senden: Testbüroname, Marktplatz 8, 56346 St. Goarshausen. Die Anschrift der betreuten Person hat sich zum 01.09.2024 geändert (zuvor Wohngruppe „Am Mühlbach", Mühlbachstraße 7, 56566 Neuwied).'
    }, '2023-04-19')
  }
};

/* Faehigkeiten & Alltag: Istzustand je Lebensbereich, Alltagsgestaltung und
   Wunschaeusserung. Erhoben mit Unterstuetzter Kommunikation gemeinsam mit
   Jonas Weidmann, der Bezugsbetreuung und dem Fachdienst der Werkstatt. */
module.exports.faehigkeiten = L.profil(F, {
  stand: '2026-08-10',
  bereiche: {
    communication: {
      ressourcen: 'Jonas Weidmann verfügt über einen aktiven Wortschatz von etwa 120 gesprochenen Wörtern und bildet Zweiwortsätze. Sein Talker mit 84 Feldern bedient er sicher und zunehmend spontan; er bildet damit Sätze aus drei bis vier Symbolen und hat 2026 begonnen, von sich aus Fragen zu stellen. Der Wochenplan in Bildkarten wird von ihm selbstständig genutzt. Zustimmung und Ablehnung äußert er unmissverständlich.',
      einschraenkungen: 'Lautsprache ist für Fremde kaum verständlich. Abstrakte Inhalte, Zeitangaben über den Tag hinaus und Konditionalsätze erreicht er über den Talker nicht. Bei Reizüberflutung verstummt er vollständig und legt den Talker weg. Ironie und Redewendungen versteht er wörtlich. Ohne Vorbereitung mit Bildmaterial gelingt Kommunikation in fremder Umgebung nicht.',
      quelle: 'Bericht Fachdienst Unterstützte Kommunikation vom 15.06.2026, Beobachtung Hausbesuche',
      erhoben: '2026-08-10', wiedervorlage: '2026-12-15'
    },
    orientation: {
      ressourcen: 'Zur eigenen Person und zu vertrauten Orten sicher orientiert. Den Weg von der Außenwohngruppe zur Werkstatt legt er seit März 2026 selbstständig zurück. Den Tagesablauf kennt er auswendig und weist auf Abweichungen hin. Bei Wahlmöglichkeiten mit zwei Bildkarten entscheidet er zügig und beständig.',
      einschraenkungen: 'Zeitliche Orientierung über den Tag hinaus fehlt; Begriffe wie „nächste Woche" oder „in einem Monat" sind ohne Kalenderbild nicht zugänglich. Tragweite von Entscheidungen mit finanziellen oder rechtlichen Folgen kann er nicht erfassen. Unangekündigte Änderungen im Ablauf lösen erhebliche Anspannung bis hin zu selbstverletzendem Verhalten aus.',
      quelle: 'Entwicklungsbericht Lebenshilfe vom 30.06.2026, Sachverständigengutachten vom 14.12.2022',
      erhoben: '2026-06-30', wiedervorlage: '2027-06-30'
    },
    mobility: {
      ressourcen: 'Körperlich uneingeschränkt beweglich und sportlich; er schwimmt sicher und fährt Fahrrad. Den 900 Meter langen Weg zwischen Außenwohngruppe und Werkstatt geht er allein und hält dabei die eingeübte Route und die Ampeln zuverlässig ein. Beim Wandern in der Gruppe hat er Ausdauer.',
      einschraenkungen: 'Öffentliche Verkehrsmittel nutzt er nicht selbstständig; ein Trainingsversuch 2025 wurde nach zwei Fahrten wegen Überforderung im vollen Bus abgebrochen. Bei Abweichungen von der bekannten Route – Baustelle, Umleitung – bleibt er stehen und wartet. Fremde Wege sind nur in Begleitung möglich. In Menschenmengen kommt es zu Reizüberflutung.',
      bedarfe: [],
      quelle: 'Mobilitätstraining Lebenshilfe 2025/2026, Bericht Außenwohngruppe vom 30.06.2026',
      erhoben: '2026-06-30', wiedervorlage: '2027-03-31'
    },
    health_selfcare: {
      ressourcen: 'Waschen, Zähneputzen und Ankleiden erledigt Jonas Weidmann nach der eingeübten Bildfolge selbstständig; die Reihenfolge hält er zuverlässig ein. Er isst selbstständig und zeigt deutlich an, wenn er satt ist. Seine Medikamente nimmt er auf Aufforderung mit der Bildkarte ohne Widerstand ein. Unwohlsein zeigt er durch Rückzug und Handzeichen verlässlich an.',
      einschraenkungen: 'Antiepileptische Dauermedikation bei fokaler Epilepsie; letzter Anfall am 12.11.2025. Die Einnahme wird gestellt und kontrolliert, eine eigenständige Dosierung ist ausgeschlossen. Schwere Nussallergie mit dokumentierter anaphylaktischer Reaktion 2023 – Notfallset muss stets mitgeführt werden, die Gefahr kann er selbst nicht einschätzen. Stark eingeschränktes Essensspektrum (etwa zwölf akzeptierte Gerichte). Schmerzen benennt er nicht.',
      bedarfe: ['gdp-w-08'],
      quelle: 'Bericht Außenwohngruppe vom 30.06.2026, Arztbrief Dr. Kohlmeyer vom 21.05.2026',
      erhoben: '2026-08-10', wiedervorlage: '2026-08-21'
    },
    housing_household: {
      ressourcen: 'Sein Zimmer in der Außenwohngruppe hält er nach der Bildfolge in Ordnung: Bett machen, Wäsche in den Korb, Schreibtisch aufräumen. Beim Tischdecken und Abräumen hat er einen festen Dienst, den er zuverlässig und gern erfüllt. Die eigene Wäsche sortiert er nach Farben vor. Das reizarme Zimmer mit festen Plätzen für alle Gegenstände ist für ihn wichtig und er achtet selbst darauf.',
      einschraenkungen: 'Kochen, Einkaufen und Wäschewaschen sind nur mit vollständiger Anleitung möglich; der Herd ist gesichert. Veränderungen in der Zimmereinrichtung lösen Anspannung aus. Ein Wohnen ohne Rund-um-die-Uhr-Erreichbarkeit von Fachkräften ist derzeit nicht vorstellbar – die Eltern wünschen die Rückkehr ins Elternhaus, Jonas Weidmann selbst hat sich dagegen ausgesprochen.',
      bedarfe: ['gdp-w-02'],
      quelle: 'Bericht Außenwohngruppe vom 30.06.2026, Hausbesuch 10.08.2026',
      erhoben: '2026-08-10', wiedervorlage: '2026-11-15'
    },
    daily_social: {
      ressourcen: 'In der Vierer-Wohngruppe fühlt er sich sichtlich wohl; zu einem Mitbewohner besteht eine stabile Freundschaft mit gemeinsamem Fußballschauen. Zur Bezugsbetreuerin Frau Kilian hat er ein enges Vertrauensverhältnis. Die Eltern besuchen ihn vierzehntägig, er freut sich darauf und zeigt es deutlich. Im Schwimmverein für Menschen mit Behinderung trainiert er wöchentlich und hat 2025 an einem Wettkampf teilgenommen.',
      einschraenkungen: 'Von sich aus initiiert er keine Kontakte. Größere Gruppen und laute Umgebungen meidet er; das Sommerfest 2025 musste er nach zwanzig Minuten verlassen. Konflikte in der Wohngruppe kann er nicht sprachlich klären, es kommt zu Rückzug oder selbstverletzendem Verhalten. Kontakte außerhalb der Einrichtung bestehen außer zur Familie nicht.',
      bedarfe: [],
      quelle: 'Bericht Außenwohngruppe vom 30.06.2026, Gespräch mit Frau Kilian',
      erhoben: '2026-08-10', wiedervorlage: '2027-01-31'
    },
    work_education: {
      ressourcen: 'Seit August 2023 im Arbeitsbereich der Werkstatt der Lebenshilfe Rhein-Lahn, Gruppe Montage. Bei gleichbleibenden Montagetätigkeiten arbeitet er präzise, ausdauernd und mit einer Fehlerquote unter der Gruppendurchschnitts. Seit April 2026 nimmt er an der Außenarbeitsgruppe Grünpflege teil – zwei Tage pro Woche im Freien –, was er über den Talker wiederholt als seinen Lieblingsteil der Woche benennt. Schulabschluss der Förderschule mit Schwerpunkt geistige Entwicklung 2023.',
      einschraenkungen: 'Neue Arbeitsschritte müssen über mehrere Wochen kleinschrittig eingeübt werden. Wechselnde Aufträge am selben Tag überfordern ihn. Lesen und Schreiben nur in Einzelwörtern und dem eigenen Namen; Rechnen im Zahlenraum bis zehn mit Anschauungsmaterial. Ein Budget für Arbeit auf dem allgemeinen Arbeitsmarkt setzt eine dauerhafte Jobcoach-Begleitung voraus und ist derzeit in Prüfung.',
      bedarfe: [],
      quelle: 'Entwicklungsbericht Werkstatt vom 30.06.2026, Fachausschussprotokoll vom 12.05.2026',
      erhoben: '2026-07-06', wiedervorlage: '2026-10-31'
    },
    authorities_law: {
      ressourcen: 'Jonas Weidmann unterschreibt mit seinem Namen und erkennt Formulare als „wichtiges Papier". Bei der Teilhabeplankonferenz war er anwesend, hat mit dem Talker zwei eigene Beiträge geleistet und zur Frage der Wohnform selbst klar Position bezogen – die Konferenz ist diesem Votum gefolgt.',
      einschraenkungen: 'Inhalt und Rechtsfolgen von Bescheiden sind ihm nicht zugänglich. Fristen, Widerspruch und Antragswesen kann er nicht erfassen. Sämtliche Behördenangelegenheiten werden vertretungsweise geführt; ein Einwilligungsvorbehalt besteht nicht, weil er im Rechtsverkehr nicht eigenständig auftritt und keine Selbstschädigung durch Vermögensverfügungen zu besorgen ist.',
      quelle: 'Betreuerbericht 2026, Beschluss AG Diez vom 09.02.2023, Teilhabeplankonferenz 12.05.2026',
      erhoben: '2026-08-06', wiedervorlage: '2027-02-28'
    },
    finance_assets: {
      ressourcen: 'Das wöchentliche Taschengeld von 25 € hebt er mit Begleitung selbst ab und bezahlt damit im Kiosk und in der Werkstattkantine. Münzen erkennt er, den Bezahlvorgang beherrscht er. Über kleine Anschaffungen – Fußballtrikot, Comics, Süßigkeiten – entscheidet er selbst und freut sich sichtbar über diese Selbstständigkeit.',
      einschraenkungen: 'Der Wert von Beträgen über etwa zwanzig Euro ist ihm nicht zugänglich; ein Bezug zwischen Arbeitsentgelt, Kosten der Wohngruppe und Taschengeld besteht nicht. Kontoführung, Werkstattentgelt, Grundsicherung und Ansparungen werden vollständig durch die Betreuung geführt. Eine Gefährdung durch eigene Vermögensverfügungen besteht nicht, da er allein keine Geschäfte abschließt.',
      quelle: 'Rechnungslegung 2025, Barbetragsabrechnung Außenwohngruppe',
      erhoben: '2026-08-06', wiedervorlage: '2027-07-31'
    }
  },
  alltag: {
    zusammenfassung: 'Jonas Weidmann lebt seit August 2023 in der Außenwohngruppe der Lebenshilfe Rhein-Lahn in Diez und arbeitet im Arbeitsbereich der Werkstatt. Sein Alltag ist streng strukturiert und visualisiert; innerhalb dieses Rahmens ist er zufrieden, ausgeglichen und in vielen Schritten selbstständig. Die Vorhersehbarkeit des Ablaufs ist die zentrale Voraussetzung seiner Stabilität – Abweichungen ohne Ankündigung führen verlässlich zu Anspannung.',
    tagesablauf: 'Aufstehen 6:15 Uhr nach Bildfolge, Morgenpflege selbstständig, Frühstück 7:00 Uhr mit Medikamentengabe. Fußweg zur Werkstatt allein, Arbeitsbeginn 8:00 Uhr; dienstags und donnerstags Außenarbeitsgruppe Grünpflege. Mittagessen in der Werkstattkantine. Arbeitsende 15:30 Uhr, Rückweg allein. Nachmittags Zimmerdienst, Freizeit mit festem Angebot (Schwimmen mittwochs, Spaziergang freitags). Abendessen 18:00 Uhr mit Tischdienst, Abendmedikation 20:00 Uhr, Zubettgehen 21:30 Uhr nach immer gleicher Abendroutine.',
    haushalt: 'Zimmerpflege nach Bildfolge selbstständig, Wäsche vorsortieren und in den Korb bringen selbstständig. Tischdienst dreimal wöchentlich. Waschmaschine, Kochen und Einkauf nur mit vollständiger Anleitung; das Anleiten übernimmt die Wohngruppe. Der Herd ist gesichert, Reinigungsmittel sind verschlossen.',
    selbstversorgung: 'Körperpflege, Zähneputzen und Ankleiden nach eingeübter Bildfolge selbstständig; Kontrolle durch die Fachkraft. Medikamente werden gestellt und die Einnahme kontrolliert. Notfallset gegen die Nussallergie wird bei jedem Verlassen des Geländes mitgeführt, Verantwortung liegt bei den Begleitpersonen. Essensplan nach den zwölf akzeptierten Gerichten; neue Speisen werden in kleinen Schritten angeboten.',
    beschaeftigung: 'Arbeitsbereich Werkstatt Montage an drei Tagen, Außenarbeitsgruppe Grünpflege an zwei Tagen. Schwimmtraining mittwochs im Verein. Wöchentliche Einheit Unterstützte Kommunikation mit dem Fachdienst. Freizeitangebote der Wohngruppe. Zu Hause Fußballbilder sortieren und Musik hören.',
    teilhabe: 'Vierzehntägige Besuche der Eltern, meist am Sonntag im Elternhaus in Nassau. Feste Freundschaft zu einem Mitbewohner. Schwimmverein für Menschen mit Behinderung mit wöchentlichem Training und gelegentlichen Wettkämpfen. Kontakt zur älteren Schwester per Videotelefonie etwa monatlich. Kontakte außerhalb des Systems Einrichtung bestehen nicht.',
    unterstuetzung: 'Außenwohngruppe der Lebenshilfe Rhein-Lahn mit 24-Stunden-Erreichbarkeit, Bezugsbetreuung Frau Kilian (Eingliederungshilfe §§ 90 ff. SGB IX). Werkstatt für behinderte Menschen im Arbeitsbereich. Fachdienst Unterstützte Kommunikation wöchentlich. Neuropädiatrische Anbindung Dr. Kohlmeyer vierteljährlich. Rechtliche Betreuung mit monatlichem Besuch.',
    quelle: 'Hausbesuch 10.08.2026, Bericht der Außenwohngruppe vom 30.06.2026',
    erhoben: '2026-08-10', wiedervorlage: '2027-01-31'
  },
  wunsch: {
    status: 'bedingt',
    begruendung: 'Jonas Weidmann äußert Wünsche zuverlässig, wenn sie in Bildern oder über den Talker angeboten werden und sich auf Konkretes und zeitlich Nahes beziehen. Zwischen zwei vorgelegten Möglichkeiten entscheidet er beständig; die Entscheidung für die Außenarbeitsgruppe und gegen die Rückkehr ins Elternhaus hat er über viele Monate unverändert wiederholt. Bei abstrakten oder weit in der Zukunft liegenden Fragen ist eine eigenständige Äußerung nicht möglich; hier wird der mutmaßliche Wille aus beobachtetem Verhalten und beständigen Präferenzen erschlossen.',
    unterstuetzung: 'Talker mit 84 Feldern, Bildkarten und Fotos der jeweiligen Orte und Personen. Höchstens zwei Auswahlmöglichkeiten gleichzeitig. Vorbereitung mit Bildmaterial mindestens einen Tag vorher. Reizarme Umgebung, keine Zeitnot, Anwesenheit der Bezugsbetreuerin Frau Kilian. Wichtige Fragen an mindestens drei Terminen wiederholen und die Antworten protokollieren. Die Wünsche der Eltern sind getrennt zu dokumentieren und nicht mit seinen zu vermischen.',
    wege: ['spoken', 'simple_language', 'gesture', 'device', 'third_party'],
    quelle: 'Fachdienst Unterstützte Kommunikation, Teilhabeplankonferenz 12.05.2026',
    erhoben: '2026-08-10', wiedervorlage: '2026-12-15'
  },
  verlauf: [
    ['2023-03-14', 'Profil erstmals angelegt (Übernahme aus dem Gesamtplan der Eingliederungshilfe)'],
    ['2023-09-05', 'Bereiche „Wohnen und Haushaltsführung" und „Alltag und soziale Teilhabe" nach Einzug in die Außenwohngruppe aktualisiert'],
    ['2026-04-20', 'Bereich „Arbeit und Bildung" nach Beginn der Außenarbeitsgruppe fortgeschrieben'],
    ['2026-06-15', 'Bereich „Kommunikation und Verständigung" nach Bericht des Fachdienstes aktualisiert'],
    ['2026-08-10', 'Gesamtprofil zur Teilhabeplanung überprüft und fortgeschrieben']
  ]
});
