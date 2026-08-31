'use strict';
/* Demonstrationsfall 3 - Dieter Rothenberg.
   Profil: 57 Jahre, Korsakow-Syndrom nach langjaehriger Alkoholabhaengigkeit,
   stationaere sozialtherapeutische Wohnform, Erwerbsminderungsrente,
   laufendes Verbraucherinsolvenzverfahren, Betreuung seit 2021 -
   der Fall mit Insolvenz, Wohnungsaufloesung und Kontaktabbruch zur Familie. */

const L = require('./lib');
const F = 'r';

const person = {
  salutation: 'Herr', title: '', gender: 'männlich',
  firstName: 'Dieter', lastName: 'Rothenberg', birthName: '',
  birthDate: '05.11.1968', birthPlace: 'Gelsenkirchen', birthCountry: 'Deutschland',
  nationality: 'deutsch', nationality2: '',
  maritalStatus: 'geschieden', maritalSince: '14.06.2013',
  religion: 'evangelisch',
  street: 'Alte Poststraße', streetOnly: 'Alte Poststraße', house: '9', houseNumber: '9', houseLetter: '',
  postal: '56377', postalCode: '56377', city: 'Nassau', postbox: '', country: 'Deutschland',
  foreignCity: '',
  address: 'Alte Poststraße 9, 56377 Nassau',
  institution: 'Sozialtherapeutische Wohnstätte Haus Lahnblick, Alte Poststraße 9, 56377 Nassau',
  phone: '02604/941370', mobile: '0176/44120988', email: '', fax: '',
  idCardNumber: 'R5N8T3QWD', residencePermitNumber: '',
  taxId: '27 993 410 662', pensionInsuranceNumber: '18 051168 R 097',
  contributionNumber: 'BARMER 9908-511-68', socialOfficeNumber: 'EGH-RLK 2021/2288',
  fullName: 'Dieter Rothenberg'
};

const care = {
  authorityName: 'Betreuungsbehörde Rhein-Lahn-Kreis',
  authorityCity: 'Bad Ems',
  authorityFileNumber: 'BB-RLK 2021/0902',
  courtName: 'Amtsgericht Diez',
  courtStreet: 'Wilhelmstraße 12', courtPostbox: '', courtPostal: '65582', courtCity: 'Diez',
  courtAddressComplete: 'True',
  courtAddressSource: 'Justizportal Rheinland-Pfalz, geprüft 09.02.2026',
  courtVerificationStatus: 'verified',
  courtVerificationCheckedAt: '2026-02-09T07:44:00.000Z',
  fileNumber: '12 XVII 305/21',
  requestDate: '18.01.2021',
  preliminaryOrderDate: '05.02.2021',
  orderDate: '22.03.2021',
  officeHandoverDate: '29.03.2021',
  startDate: '01.04.2021',
  takeoverDate: '01.04.2021',
  handoverDate: '',
  reportPeriod: '01.04. - 31.03.',
  reviewDate: '31.03.2028',
  endDate: '',
  homePlacement: 'ja',
  nextAccountingDue: '30.04.2027',
  taskAreaDetails: [
    { name: 'Vermögenssorge', consentReservation: true },
    { name: 'Gesundheitssorge', consentReservation: false },
    { name: 'Aufenthaltsbestimmung', consentReservation: false },
    { name: 'Wohnungsangelegenheiten', consentReservation: false },
    { name: 'Wohnungsauflösung', consentReservation: false },
    { name: 'Heim- und Pflegeangelegenheiten', consentReservation: false },
    { name: 'Vertretung gegenüber Behörden, Versicherungen, Renten- und Sozialleistungsträgern', consentReservation: false },
    { name: 'Post- und Fernmeldeangelegenheiten', consentReservation: false },
    { name: 'Vertretung gegenüber Gerichten', consentReservation: false }
  ]
};
care.taskAreas = care.taskAreaDetails.map((t) => t.name);

const healthInfo = {
  insurance: 'BARMER',
  insuranceNumber: 'B990851168',
  careLevel: '2',
  bloodType: 'B+',
  allergies: 'Keine bekannten Allergien.',
  diagnosesNotes: 'Korsakow-Syndrom mit ausgeprägter anterograder Amnesie und Konfabulationsneigung. Herr Rothenberg wirkt im Gespräch orientiert und antwortet flüssig; die Angaben sind jedoch häufig konfabuliert. Für die Berichterstattung gilt: Auskünfte immer mit der Einrichtung abgleichen.',
  diagnoses: [
    { icd: 'F10.6', text: 'Amnestisches Syndrom durch Alkohol (Korsakow-Syndrom)', since: '2020-09-14' },
    { icd: 'F10.2', text: 'Alkoholabhängigkeitssyndrom, gegenwärtig abstinent in beschützender Umgebung', since: '1998-05-01' },
    { icd: 'K70.3', text: 'Alkoholische Leberzirrhose, Child-Pugh A', since: '2019-03-22' },
    { icd: 'G62.1', text: 'Alkohol-Polyneuropathie beider Beine', since: '2018-11-30' },
    { icd: 'I48.0', text: 'Paroxysmales Vorhofflimmern, unter Antikoagulation', since: '2022-07-19' },
    { icd: 'E51.2', text: 'Wernicke-Enzephalopathie, Zustand nach', since: '2020-09-14' },
    { icd: 'F17.2', text: 'Abhängigkeitssyndrom durch Tabak', since: '1985-01-01' }
  ],
  medications: [
    { name: 'Thiamin (Vitamin B1)', dose: '100 mg', schedule: '1-1-0' },
    { name: 'Apixaban', dose: '5 mg', schedule: '1-0-1' },
    { name: 'Bisoprolol', dose: '2,5 mg', schedule: '1-0-0' },
    { name: 'Spironolacton', dose: '50 mg', schedule: '1-0-0' },
    { name: 'Pregabalin', dose: '75 mg', schedule: '1-0-1' },
    { name: 'Vitamin-B-Komplex', dose: '1 Kapsel', schedule: '1-0-0' }
  ],
  doctors: [
    { name: 'Dr. med. Heiko Brandstätter', field: 'Allgemeinmedizin (Heimarzt Haus Lahnblick)', phone: '02604/970120', email: 'praxis@brandstaetter-nassau.de' },
    { name: 'Dr. med. Petra Ohlrogge', field: 'Neurologie', phone: '02603/941800', email: 'neurologie@mvz-bad-ems.de' },
    { name: 'Dr. med. Amir Farsad', field: 'Gastroenterologie / Hepatologie', phone: '0261/4962210', email: 'hepatologie@gk-mittelrhein.de' },
    { name: 'Dr. med. Susanne Kellermann', field: 'Kardiologie', phone: '02603/998410', email: 'kardio@mvz-bad-ems.de' }
  ],
  emergency: [
    { name: 'Haus Lahnblick – Nachtdienst', relation: 'Einrichtung', phone: '02604/941370', email: 'lahnblick@diakonie-westerwald.de' },
    { name: 'Marco Rothenberg', relation: 'Sohn (Kontakt seit 2024 wieder aufgenommen)', phone: '', email: 'm.rothenberg88@example-mail.de' },
    { name: 'Christoph Zepp', relation: 'Rechtliche Betreuung', phone: '06771/959410', email: 'kanzlei@testbueroname.de' }
  ],
  appointments: [
    { id: L.id('hia', F, 1), doctor: 'Dr. Brandstätter', reason: 'Quartalsvisite, INR-freie Kontrolle unter Apixaban', from: '2026-01-20', to: '', note: 'Kreatinin stabil, keine Blutungszeichen.', recommendation: 'Laborkontrolle in drei Monaten' },
    { id: L.id('hia', F, 2), doctor: 'Dr. Farsad', reason: 'Sonografie Leber, Ösophagusvarizen-Screening', from: '2026-02-17', to: '', note: 'Child-Pugh A stabil, keine Varizen Grad II.', recommendation: 'Kontrolle in 12 Monaten, Abstinenz halten' },
    { id: L.id('hia', F, 3), doctor: 'Dr. Ohlrogge', reason: 'Neurologische Verlaufskontrolle Korsakow', from: '2026-03-12', to: '', note: 'Anterograde Amnesie unverändert, Alltagsfähigkeiten in strukturierter Umgebung erhalten.', recommendation: 'Beschützende Wohnform weiterhin erforderlich' },
    { id: L.id('hia', F, 4), doctor: 'Dr. Kellermann', reason: 'Kardiologische Kontrolle, Langzeit-EKG', from: '2026-05-06', to: '', note: 'Zwei kurze Vorhofflimmer-Episoden, frequenzkontrolliert.', recommendation: 'Bisoprolol unverändert' },
    { id: L.id('hia', F, 5), doctor: 'Dr. Brandstätter', reason: 'Hausbesuch nach Sturz im Bad', from: '2026-06-29', to: '', note: 'Prellung Hüfte links, kein Bruch. Sturz bei Polyneuropathie.', recommendation: 'Haltegriffe im Bad, Physiotherapie' },
    { id: L.id('hia', F, 6), doctor: 'Dr. Brandstätter', reason: 'Attest für das Insolvenzgericht (Reisefähigkeit)', from: '2026-07-22', to: '', note: 'Attest zur Befreiung vom persönlichen Erscheinen im Schlusstermin.', recommendation: '' }
  ],
  hospital: [
    { id: L.id('hih', F, 1), clinic: 'Paracelsus-Klinik Bad Ems, Innere Medizin', reason: 'Wernicke-Enzephalopathie, Delirium tremens nach Entzug', from: '2020-09-14', to: '2020-10-08', note: 'Auslöser des Betreuungsverfahrens. Nach Entlassung Übergang in die Entwöhnung.', recommendation: 'Langzeitentwöhnung, beschützende Wohnform prüfen' },
    { id: L.id('hih', F, 2), clinic: 'Fachklinik Eußerthal, Suchtrehabilitation', reason: 'Stationäre Entwöhnungsbehandlung (Langzeittherapie)', from: '2020-11-02', to: '2021-03-26', note: 'Regulär beendet. Rückkehr in die frühere Wohnung wurde als nicht tragfähig eingeschätzt.', recommendation: 'Adaption in sozialtherapeutischer Wohnstätte' },
    { id: L.id('hih', F, 3), clinic: 'Gemeinschaftsklinikum Mittelrhein, Kemperhof Koblenz', reason: 'Erstdiagnose Vorhofflimmern mit Tachyarrhythmie', from: '2022-07-19', to: '2022-07-26', note: 'Einleitung der Antikoagulation mit Apixaban.', recommendation: 'Kardiologische Anbindung' },
    { id: L.id('hih', F, 4), clinic: 'Paracelsus-Klinik Bad Ems, Innere Medizin', reason: 'Dekompensierte Leberzirrhose mit Aszites', from: '2023-05-11', to: '2023-05-30', note: 'Rückfall mit Alkoholkonsum im April 2023 während eines unbegleiteten Wochenendes.', recommendation: 'Wiederaufnahme der Abstinenz, Ausgänge nur begleitet' },
    { id: L.id('hih', F, 5), clinic: 'Paracelsus-Klinik Bad Ems, Chirurgie', reason: 'Radiusfraktur rechts nach Sturz, konservative Versorgung', from: '2025-01-08', to: '2025-01-13', note: 'Sturz auf Glatteis vor der Einrichtung.', recommendation: 'Gipsverband sechs Wochen, Ergotherapie' }
  ],
  procedures: [
    { id: L.id('hip', F, 1), procedure: 'Aszitespunktion (2,4 Liter)', doctor: 'Dr. Farsad', from: '2023-05-14', to: '2023-05-14', note: 'Einwilligung durch die Betreuung; Herr Rothenberg konnte die Maßnahme nicht überblicken.', recommendation: 'Diuretische Therapie, Kochsalzrestriktion' },
    { id: L.id('hip', F, 2), procedure: 'Gastroskopie mit Varizen-Screening', doctor: 'Dr. Farsad', from: '2026-02-17', to: '2026-02-17', note: 'Keine behandlungsbedürftigen Varizen.', recommendation: 'Kontrolle in 12 Monaten' },
    { id: L.id('hip', F, 3), procedure: 'Zahnsanierung mit Teilprothese Oberkiefer', doctor: 'Zahnarztpraxis Kesselring, Nassau', from: '2024-02-05', to: '2024-06-18', note: 'Härtefallregelung der BARMER, Eigenanteil 0 €.', recommendation: 'Halbjährliche Kontrolle' },
    { id: L.id('hip', F, 4), procedure: 'Anpassung orthopädischer Schuhe bei Polyneuropathie', doctor: 'Sanitätshaus Lahntal', from: '2025-09-24', to: '2025-10-22', note: 'Rezept Dr. Brandstätter, Kostenübernahme BARMER, Eigenanteil 34 €.', recommendation: 'Jährliche Kontrolle der Passform' }
  ]
};

const schulden = [
  L.schuld(F, 1, {
    erfasstAm: '2021-05-12', forderungsbeginn: '2016-01-01',
    glaeubiger: 'Finanzamt Diez', kategorie: 'Steuerschulden (Finanzamt)',
    aktenzeichen: '31/224/91106', hauptforderung: 18420.55, mahnkosten: 0,
    status: 'offen', basisGezahlt: 0,
    notizen: 'Zur Insolvenztabelle angemeldet (Verfahren 4 IK 118/23). Steuerschulden aus der selbstständigen Tätigkeit als Fliesenleger 2014-2018. Zur Insolvenztabelle angemeldet und festgestellt.'
  }),
  L.schuld(F, 2, {
    erfasstAm: '2021-05-12', forderungsbeginn: '2015-06-01',
    glaeubiger: 'Techniker Krankenkasse (Beiträge Selbstständigkeit)', kategorie: 'Beitragsschulden gesetzliche Krankenkasse',
    aktenzeichen: 'TK-2015-880 447', hauptforderung: 9884.2, mahnkosten: 320,
    status: 'offen', basisGezahlt: 0,
    notizen: 'Zur Insolvenztabelle angemeldet (Verfahren 4 IK 118/23). Beitragsrückstände als freiwillig Versicherter. Zur Insolvenztabelle angemeldet und festgestellt.'
  }),
  L.schuld(F, 3, {
    erfasstAm: '2021-05-12', forderungsbeginn: '2017-03-01',
    glaeubiger: 'Sparkasse Koblenz', kategorie: 'Ratenkredit (Konsumkredit)',
    aktenzeichen: 'DKR-2017-44 112 908', hauptforderung: 14260.0, prozesskosten: 812.4,
    status: 'tituliert', basisGezahlt: 0,
    notizen: 'Zur Insolvenztabelle angemeldet (Verfahren 4 IK 118/23). Betriebsmittelkredit, gekündigt am 14.09.2019. Vollstreckungsbescheid. Zur Insolvenztabelle angemeldet und festgestellt.'
  }),
  L.schuld(F, 4, {
    erfasstAm: '2021-05-12', forderungsbeginn: '2019-01-01',
    glaeubiger: 'Berufsgenossenschaft der Bauwirtschaft', kategorie: 'Rückforderungen von Kranken-/Renten-/Unfallversicherung',
    aktenzeichen: 'BG BAU 4471-2019', hauptforderung: 3412.8, mahnkosten: 92,
    status: 'offen', basisGezahlt: 0,
    notizen: 'Zur Insolvenztabelle angemeldet (Verfahren 4 IK 118/23). Beitragsrückstände als Unternehmer. Zur Insolvenztabelle angemeldet und festgestellt.'
  }),
  L.schuld(F, 5, {
    erfasstAm: '2021-05-12', forderungsbeginn: '2019-08-01',
    glaeubiger: 'Frau Ilona Rothenberg (geschiedene Ehefrau)', kategorie: 'Unterhaltsrückstände (Kindesunterhalt, Ehegattenunterhalt)',
    aktenzeichen: '4 F 218/19 AG Diez', hauptforderung: 6840.0, mahnkosten: 0,
    status: 'tituliert', basisGezahlt: 0,
    notizen: 'Zur Insolvenztabelle angemeldet (Verfahren 4 IK 118/23). Kindesunterhaltsrückstände für den Sohn Marco bis zu dessen Volljährigkeit. Forderung ist als Unterhaltsrückstand aus vorsätzlich pflichtwidrig unterlassener Unterhaltszahlung angemeldet; die Restschuldbefreiung erfasst sie möglicherweise nicht (§ 302 Nr. 1 InsO). Rechtliche Klärung im Schlusstermin.'
  }),
  L.schuld(F, 6, {
    erfasstAm: '2021-06-02', forderungsbeginn: '2020-11-01',
    glaeubiger: 'Wohnungsbaugesellschaft Bad Ems mbH', kategorie: 'Mietschulden',
    aktenzeichen: 'WBE-2020-1188', hauptforderung: 2184.0, mahnkosten: 45,
    status: 'erledigt', basisGezahlt: 2229, erledigtAm: '2021-08-30',
    notizen: 'Mietrückstand während der Klinik- und Rehazeit. Nach Wohnungsauflösung mit der Kaution und aus dem Restguthaben verrechnet.'
  }),
  L.schuld(F, 7, {
    erfasstAm: '2024-11-14', forderungsbeginn: '2024-09-01',
    glaeubiger: 'Sanitätshaus Lahntal GmbH', kategorie: 'Heil- und Hilfsmittel (Schuhe, Orthesen, Rollator etc.)',
    aktenzeichen: 'SL-24-2290', hauptforderung: 68, mahnkosten: 0,
    status: 'erledigt', basisGezahlt: 68, erledigtAm: '2025-11-05',
    notizen: 'Eigenanteil orthopädische Schuhe, aus dem Barbetrag in zwei Raten beglichen. Neuverbindlichkeit nach Insolvenzeröffnung, deshalb außerhalb der Tabelle.'
  })
];

module.exports = {
  label: 'Rothenberg, Dieter',
  fileNumber: '12 XVII 305/21',
  createdAt: '2021-04-01 08:40:00',
  betreuer: 'christoph zepp',
  uebersicht: { periodStart: '2026-07-01', aenderungsart: 'unverändert fortgeführt', uebergabeAn: '' },
  kontaktmonitor: { turnusDays: 90, baseline: '2026-05-19', lastContact: '2026-07-28', lastArt: 'persönlich (Einrichtung / Klinik)' },

  stammdaten: {
    person,
    care,
    rechtlicherBetreuer: 'christoph zepp',
    health: {
      careLevel: '2', disabilityDegree: '80',
      marks: ['G', 'B'], marksText: 'G, B',
      copayExemption: 'ja, befreit bis 31.12.2026', valueMark: 'ja',
      insurer: 'BARMER', insuranceNumber: 'B990851168'
    },
    healthInfo,
    benefits: [
      { category: 'Rente', basis: 'SGB VI', benefitName: 'Rente wegen voller Erwerbsminderung (befristet)', applicationDate: '19.11.2020', validUntil: '30.11.2027', provider: 'Deutsche Rentenversicherung Rheinland-Pfalz', fileNumber: '18 051168 R 097' },
      { category: 'Sozialhilfe', basis: 'SGB XII (4. Kapitel)', benefitName: 'Grundsicherung bei Erwerbsminderung, aufstockend', applicationDate: '12.04.2021', validUntil: '30.06.2027', provider: 'Kreisverwaltung Rhein-Lahn-Kreis, Sozialamt', fileNumber: 'GruSi-RLK 2021/1104' },
      { category: 'Eingliederungshilfe', basis: 'SGB IX (Teil 2)', benefitName: 'Besondere Wohnform mit Assistenzleistungen (Haus Lahnblick)', applicationDate: '08.02.2021', validUntil: '31.03.2028', provider: 'Landesamt für Soziales, Jugend und Versorgung – Eingliederungshilfe', fileNumber: 'EGH-RLK 2021/2288' },
      { category: 'Pflege', basis: 'SGB XI', benefitName: 'Pflegegrad 2', applicationDate: '02.08.2022', validUntil: 'unbefristet', provider: 'BARMER Pflegekasse', fileNumber: 'PK-B990851168' },
      { category: 'Schwerbehindertenrecht', basis: 'SGB IX', benefitName: 'GdB 80, Merkzeichen G und B', applicationDate: '15.06.2021', validUntil: '30.06.2028', provider: 'Landesamt für Soziales, Jugend und Versorgung Koblenz', fileNumber: 'SB 2021/88 402' },
      { category: 'Rundfunk', basis: 'RBStV', benefitName: 'Befreiung vom Rundfunkbeitrag (Grundsicherung)', applicationDate: '20.05.2021', validUntil: '30.06.2027', provider: 'ARD ZDF Deutschlandradio Beitragsservice', fileNumber: '774 220 918' },
      { category: 'Mobilität', basis: 'SGB IX', benefitName: 'Wertmarke zur unentgeltlichen Beförderung', applicationDate: '15.06.2021', validUntil: '30.06.2027', provider: 'Landesamt für Soziales, Jugend und Versorgung Koblenz', fileNumber: 'WM 2021/88 402' }
    ],
    identifiers: [
      { type: 'Personalausweis', number: 'R5N8T3QWD', validUntil: '03.08.2031', status: 'gültig' },
      { type: 'Steuerliche Identifikationsnummer', number: '27 993 410 662', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Rentenversicherungsnummer', number: '18 051168 R 097', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Krankenversichertennummer', number: 'B990851168', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Schwerbehindertenausweis', number: 'SB 2021/88 402', validUntil: '30.06.2028', status: 'gültig' },
      { type: 'Aktenzeichen / Geschäftszeichen', number: '4 IK 118/23 (AG Montabaur)', validUntil: 'laufend', status: 'aktiv' },
      { type: 'Aktenzeichen / Geschäftszeichen', number: 'GruSi-RLK 2021/1104', validUntil: '30.06.2027', status: 'aktiv' },
      { type: 'Kunden-/Mitgliedsnummer', number: '774 220 918', validUntil: '30.06.2027', status: 'aktiv' },
      { type: 'Sonstige Nummer', number: 'Führerschein eingezogen 11/2019', validUntil: '', status: 'entzogen' }
    ],
    insurances: [
      { type: 'Gesundheitsversicherung (gesetzlich)', institution: 'BARMER', number: 'B990851168', details: 'Pflichtversichert als Rentner (KVdR) seit 01.12.2020, zuzahlungsbefreit' },
      { type: 'Pflegeversicherung', institution: 'BARMER Pflegekasse', number: 'PK-B990851168', details: 'Pflegegrad 2 seit 01.09.2022' },
      { type: 'Privathatfplicht', institution: 'Debeka Allgemeine Versicherung AG', number: 'PHV 220 991 06', details: 'Gruppenvertrag über die Einrichtung, Beitrag im Entgelt enthalten' },
      { type: 'Sterbegeldversicherung', institution: 'nicht vorhanden', number: '--', details: 'Keine Bestattungsvorsorge; Sozialbestattung nach § 74 SGB XII wäre einschlägig' },
      { type: 'KFZ-Versicherung', institution: 'HDI Versicherung AG', number: 'KFZ-118 220 44', details: 'Zum 30.11.2019 nach Entzug der Fahrerlaubnis gekündigt' }
    ],
    banks: [
      { type: 'P-Konto', institution: 'Sparkasse Koblenz', bankName: 'Sparkasse Koblenz', iban: 'DE95 5705 0120 0022 8804 71', bic: 'MALADE51KOB', accountHolder: 'Dieter Rothenberg', saldo: '162,85', saldoDatum: '31.07.2026', verwendungszweck: 'Pfändungsschutzkonto seit 18.05.2021, Verwaltungskonto der Betreuung', connectionId: '' },
      { type: 'Treuhandkonto', institution: 'Diakonisches Werk Westerwald gGmbH', bankName: 'Sparkasse Westerwald-Sieg', iban: 'DE60 5735 1030 0000 9413 70', bic: 'MALADE51AKI', accountHolder: 'Dieter Rothenberg (Barbetragskonto)', saldo: '94,20', saldoDatum: '31.07.2026', verwendungszweck: 'Barbetragsverwaltung der Einrichtung', connectionId: '' }
    ],
    budget: { type: 'Barbetrag', amount: '135,00', method: 'Bar an die Einrichtung' },
    assetManagement: [
      { type: 'Barbetrag', amount: '135,00', method: 'Bar an die Einrichtung' },
      { type: 'Bekleidungsgeld', amount: '38,00', method: 'Überweisung' },
      { type: 'Wochengeld', amount: '30,00', method: 'Bar an die betreute Person' }
    ],
    accommodation: {
      type: 'Wohnheim',
      currentResidence: {
        sameAsRegistered: true,
        institution: 'Sozialtherapeutische Wohnstätte Haus Lahnblick, Diakonisches Werk Westerwald gGmbH, Zimmer 1.07',
        type: 'Heim/Einrichtung',
        street: 'Alte Poststraße', houseNumber: '9', houseLetter: '',
        postalCode: '56377', city: 'Nassau', postbox: '', foreignCity: '', country: 'Deutschland'
      },
      monthlyCost: '2914,00', serviceCosts: '', electricityCosts: '', gasCosts: '',
      basicRent: '486,00', heatingCosts: '112,00', heatingType: 'Zentralheizung',
      hotWater: 'Zentral (über Heizung)', hotWaterPreparation: 'Zentral (über Heizung)', heating: 'Zentralheizung',
      housingSecurity: { status: 'secured', details: 'Wohn- und Betreuungsvertrag vom 26.03.2021, unbefristet' },
      accessibility: { status: 'partial', details: 'Aufzug vorhanden, Bad im Zimmer ohne Haltegriffe – nachgerüstet 07/2026' },
      currentProblems: { status: 'none', details: 'Derzeit keine' },
      supportForms: ['Besondere Wohnform mit Assistenz', 'Suchtnachsorge', 'Arbeitstherapie', 'Ambulante Pflege im Haus'],
      supportDetails: 'Rund-um-die-Uhr-Assistenz im Haus Lahnblick, Bezugsassistenz Herr Kleinschmidt. Arbeitstherapeutische Beschäftigung in der hauseigenen Holzwerkstatt an vier Vormittagen. Suchtnachsorgegruppe wöchentlich. Ausgänge nach Absprache, seit dem Rückfall 2023 in der Regel begleitet.',
      housingSecurityEntries: [
        L.wohnEintrag(F, 'security', 1, { von: '2021-04-01', bis: '2021-08-30', status: 'at_risk', details: 'Frühere Mietwohnung in Bad Ems mit 2.184 € Rückstand, Kündigung durch die Wohnungsbaugesellschaft. Parallel Heimplatz im Haus Lahnblick.' }),
        L.wohnEintrag(F, 'security', 2, { von: '2021-08-31', status: 'secured', details: 'Wohnung aufgelöst und übergeben; Platz im Haus Lahnblick durch unbefristeten Wohn- und Betreuungsvertrag gesichert.', stand: '2026-07-28' })
      ],
      accessibilityEntries: [
        L.wohnEintrag(F, 'accessibility', 1, { von: '2021-04-01', bis: '2026-07-14', status: 'partial', details: 'Zimmer im ersten Obergeschoss mit Aufzug erreichbar; Dusche ohne Haltegriffe, bei Polyneuropathie erhöhtes Sturzrisiko.' }),
        L.wohnEintrag(F, 'accessibility', 2, { von: '2026-07-15', status: 'accessible', details: 'Nach dem Sturz vom 28.06.2026 Haltegriffe und rutschhemmende Matte in der Dusche nachgerüstet.', stand: '2026-07-28' })
      ],
      currentProblemEntries: [
        L.wohnEintrag(F, 'problems', 1, { von: '2023-04-15', bis: '2023-08-31', status: 'present', details: 'Alkoholrückfall während eines unbegleiteten Wochenendausgangs, danach dekompensierte Leberzirrhose. Ausgangsregelung neu gefasst.' }),
        L.wohnEintrag(F, 'problems', 2, { von: '2026-06-28', bis: '2026-07-14', status: 'present', details: 'Sturz im Bad mit Hüftprellung; Umbau der Dusche veranlasst.' }),
        L.wohnEintrag(F, 'problems', 3, { von: '2026-07-15', status: 'none', details: 'Bad nachgerüstet, keine weiteren Stürze.', stand: '2026-07-28' })
      ],
      supportEntries: [
        L.wohnEintrag(F, 'support', 1, { von: '2021-04-01', status: 'active', formen: ['Besondere Wohnform mit Assistenz'], details: 'Rund-um-die-Uhr-Assistenz, Bezugsassistenz Herr Kleinschmidt. Medikamentengabe, Strukturierung des Tages, Begleitung zu Terminen.', stand: '2026-07-28' }),
        L.wohnEintrag(F, 'support', 2, { von: '2021-05-10', status: 'active', formen: ['Arbeitstherapie'], details: 'Holzwerkstatt des Hauses an vier Vormittagen, Anerkennungsbetrag 1,20 €/Stunde.', stand: '2026-07-28' }),
        L.wohnEintrag(F, 'support', 3, { von: '2023-09-01', status: 'active', formen: ['Suchtnachsorge'], details: 'Wöchentliche Nachsorgegruppe der Fachklinik Eußerthal, im Haus durchgeführt. Nach dem Rückfall 2023 verbindlich vereinbart.', stand: '2026-07-28' }),
        L.wohnEintrag(F, 'support', 4, { von: '2022-09-01', status: 'active', formen: ['Ambulante Pflege im Haus'], details: 'Pflegegrad 2, Unterstützung bei Körperpflege und Medikamentenmanagement.', stand: '2026-07-28' })
      ]
    },
    provisions: L.vorsorge([
      ['patientenverfuegung', 'Nicht vorhanden', '--'],
      ['betreuungsverfuegung', 'Nicht vorhanden', '--'],
      ['vorsorgevollmacht', 'Nicht vorhanden', '--'],
      ['testament', 'Nicht vorhanden', '--'],
      ['vorsorgeregister', 'Nicht vorhanden', '--'],
      ['bestattungsvorsorge', 'Nicht vorhanden', '--'],
      ['totenfuersorge', 'Vorhanden', '--'],
      ['organspende', 'Nicht vorhanden', '--'],
      ['kontovollmacht', 'Nicht vorhanden', '--'],
      ['digitaler_nachlass', 'Nicht vorhanden', '--']
    ]),
    socialNetwork: [
      { status: 'Aktiv', role: 'Sohn', detail: 'Sohn, Kontakt seit 2024 wieder aufgenommen', salutation: 'Sehr geehrter Herr', firstName: 'Marco', lastName: 'Rothenberg', institution: '', street: 'Nordring', house: '18', postal: '45894', city: 'Gelsenkirchen', phone: '', mobile: '0152 / 88044712', email: 'm.rothenberg88@example-mail.de', fullName: 'Marco Rothenberg', address: 'Nordring 18, 45894 Gelsenkirchen', birthDate: '12.09.1998' },
      { status: 'Beendet', role: 'Ehepartnerschaft', detail: 'geschiedene Ehefrau, kein Kontakt', salutation: 'Sehr geehrte Frau', firstName: 'Ilona', lastName: 'Rothenberg', institution: '', street: 'Nordring', house: '18', postal: '45894', city: 'Gelsenkirchen', phone: '', mobile: '', email: '', fullName: 'Ilona Rothenberg', address: 'Nordring 18, 45894 Gelsenkirchen' },
      { status: 'Beendet', role: 'Bruder', detail: 'Bruder, Kontakt 2019 abgebrochen', salutation: 'Sehr geehrter Herr', firstName: 'Wolfgang', lastName: 'Rothenberg', institution: '', street: 'Buerer Straße', house: '204', postal: '45899', city: 'Gelsenkirchen', phone: '0209 / 4471228', mobile: '', email: '', fullName: 'Wolfgang Rothenberg', address: 'Buerer Straße 204, 45899 Gelsenkirchen' },
      { status: 'Aktiv', role: 'Peer / Bezugsperson', detail: 'Bezugsassistenz Haus Lahnblick', salutation: 'Sehr geehrter Herr', firstName: 'Tim', lastName: 'Kleinschmidt', institution: 'Haus Lahnblick, Diakonisches Werk Westerwald gGmbH', street: 'Alte Poststraße', house: '9', postal: '56377', city: 'Nassau', phone: '02604 / 941374', mobile: '', email: 'kleinschmidt@diakonie-westerwald.de', fullName: 'Tim Kleinschmidt', address: 'Alte Poststraße 9, 56377 Nassau' },
      { status: 'Aktiv', role: 'Peer / Bezugsperson', detail: 'Mitbewohner und Werkstattkollege', salutation: 'Sehr geehrter Herr', firstName: 'Reinhold', lastName: 'Pfeiffer', institution: 'Haus Lahnblick', street: 'Alte Poststraße', house: '9', postal: '56377', city: 'Nassau', phone: '', mobile: '', email: '', fullName: 'Reinhold Pfeiffer', address: 'Alte Poststraße 9, 56377 Nassau' },
      { status: 'Aktiv', role: 'Verein (Ehrenamt)', detail: 'Suchtnachsorgegruppe', salutation: 'Sehr geehrte Damen und Herren', institution: 'Kreuzbund Diözesanverband Limburg, Gruppe Nassau', street: 'Bahnhofstraße', house: '22', postal: '56377', city: 'Nassau', phone: '02604 / 950188', mobile: '', email: 'nassau@kreuzbund-limburg.de', fullName: 'Kreuzbund Gruppe Nassau', address: 'Bahnhofstraße 22, 56377 Nassau' },
      { status: 'Aktiv', role: 'Betreuung', detail: 'rechtliche Betreuung', salutation: 'Sehr geehrter Herr', firstName: 'Christoph', lastName: 'Zepp', institution: 'Testbüroname', street: 'Marktplatz', house: '8', postal: '56346', city: 'St. Goarshausen', phone: '06771 / 959410', mobile: '', email: 'kanzlei@testbueroname.de', fullName: 'Christoph Zepp', address: 'Marktplatz 8, 56346 St. Goarshausen' }
    ],
    contactProfile: {
      understanding: 'with_support',
      trust: 'good',
      cooperation: 'cooperative',
      participation: 'with_support',
      conflicts: 'none',
      assessedAt: '2026-05-19',
      communicationMethods: ['spoken', 'simple_language', 'writing'],
      communicationSupport: 'Herr Rothenberg wirkt im Gespräch orientiert und antwortet flüssig, konfabuliert aber regelmäßig. Angaben zu Terminen, Beträgen und Vereinbarungen müssen grundsätzlich mit der Bezugsassistenz abgeglichen werden. Bewährt hat sich, Vereinbarungen schriftlich auf einem Zettel festzuhalten, den er in die Brusttasche steckt, und dieselbe Information zusätzlich an Herrn Kleinschmidt zu geben.',
      conflictDescription: 'Keine Konflikte. Herr Rothenberg ist durchweg freundlich und zugewandt und stimmt Vorschlägen im Gespräch fast immer zu – auch dann, wenn er sie nicht überblickt. Gerade deshalb wird bei Entscheidungen von Gewicht auf mehrfache Erörterung an verschiedenen Tagen geachtet.',
      evidenceSource: 'Besuche am 19.05.2026 und 28.07.2026, Rückmeldung der Bezugsassistenz Herr Kleinschmidt, neurologischer Befund Dr. Ohlrogge vom 12.03.2026',
      canInitiateContact: 'bedingt',
      initiationSupport: 'Über die Bezugsassistenz oder das Diensttelefon des Hauses; eigenes Mobiltelefon vorhanden, Nummern sind eingespeichert',
      initiationChannels: ['facility', 'third_party', 'mobile'],
      initiationLimitationReason: 'Herr Rothenberg besitzt ein Mobiltelefon und ruft gelegentlich an, kann den Anlass des Anrufs jedoch häufig nicht benennen oder verwechselt Gesprächspartner. Verlässlich läuft die Kontaktaufnahme über die Einrichtung.',
      reportRemarks: 'Die persönlichen Kontakte finden etwa alle acht bis zehn Wochen im Haus Lahnblick statt, ergänzt durch regelmäßige Telefonate mit der Bezugsassistenz. Herr Rothenberg erkennt die Betreuungsperson wieder und begrüßt sie herzlich, kann Inhalte vorangegangener Gespräche jedoch nicht erinnern. Wichtige Informationen werden deshalb bei jedem Besuch erneut und in einfacher Sprache mitgeteilt und zusätzlich der Einrichtung schriftlich übermittelt. Die Zusammenarbeit mit dem Haus Lahnblick ist eng und verlässlich.'
    },
    handkasse: L.handkasse(F, [
      ['2026-02-03', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag Februar an die Einrichtung', 'Barbetrag', 135],
      ['2026-02-07', 'ausgabe', 'Kiosk Haus Lahnblick', 'Tabak und Getränke', 'Zeitungen / Zeitschriften / Online-Abos', 42],
      ['2026-02-21', 'ausgabe', 'Friseur Haarwerk Nassau', 'Haarschnitt', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 16],
      ['2026-03-03', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag März an die Einrichtung', 'Barbetrag', 135],
      ['2026-03-14', 'ausgabe', 'Kiosk Haus Lahnblick', 'Tabak und Getränke', 'Zeitungen / Zeitschriften / Online-Abos', 46],
      ['2026-03-21', 'ausgabe', 'Haus Lahnblick', 'Ausflug Freilichtmuseum Hachenburg', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 22],
      ['2026-04-02', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag April an die Einrichtung', 'Barbetrag', 135],
      ['2026-04-11', 'ausgabe', 'Kiosk Haus Lahnblick', 'Tabak und Getränke', 'Zeitungen / Zeitschriften / Online-Abos', 44],
      ['2026-04-25', 'ausgabe', 'Deichmann Bad Ems', 'Hausschuhe und Socken', 'Kleidung / Schuhe', 38.9],
      ['2026-05-04', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag Mai an die Einrichtung', 'Barbetrag', 135],
      ['2026-05-09', 'ausgabe', 'Kiosk Haus Lahnblick', 'Tabak und Getränke', 'Zeitungen / Zeitschriften / Online-Abos', 45],
      ['2026-05-19', 'ausgabe', 'Dieter Rothenberg', 'Wochengeld bei Besuch übergeben', 'Taschengeldzahlungen an Angehörige (falls vereinbart)', 30],
      ['2026-06-02', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag Juni an die Einrichtung', 'Barbetrag', 135],
      ['2026-06-13', 'ausgabe', 'Kiosk Haus Lahnblick', 'Tabak und Getränke', 'Zeitungen / Zeitschriften / Online-Abos', 43],
      ['2026-06-20', 'ausgabe', 'Friseur Haarwerk Nassau', 'Haarschnitt', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 16],
      ['2026-07-02', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag Juli an die Einrichtung', 'Barbetrag', 135],
      ['2026-07-11', 'ausgabe', 'Kiosk Haus Lahnblick', 'Tabak und Getränke', 'Zeitungen / Zeitschriften / Online-Abos', 47],
      ['2026-07-18', 'ausgabe', 'Bahnhofsbuchhandlung Bad Ems', 'Kreuzworträtselhefte', 'Zeitungen / Zeitschriften / Online-Abos', 11.8],
      ['2026-07-28', 'ausgabe', 'Dieter Rothenberg', 'Wochengeld bei Besuch übergeben', 'Taschengeldzahlungen an Angehörige (falls vereinbart)', 30],
      ['2026-08-04', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag August an die Einrichtung', 'Barbetrag', 135],
      ['2026-08-12', 'ausgabe', 'Kiosk Haus Lahnblick', 'Tabak und Getränke', 'Zeitungen / Zeitschriften / Online-Abos', 45]
    ]),
    assets: {
      begin: L.posten(F, 'vab', [
        ['Bargeld', 'Barbestand bei Betreuungsübernahme (Klinikverwahrung)', '', 82.4],
        ['Girokonto', 'Kontostand 01.04.2021, überzogen', 'Sparkasse Koblenz', -1284.6],
        ['Rückzahlungsansprüche (z. B. aus Kautionen, Mietkaution)', 'Mietkaution Wohnungsbaugesellschaft Bad Ems', 'Sparkasse Koblenz', 1290],
        ['Wertvolle Möbel / Haushaltsgeräte (sofern von Bedeutung)', 'Hausrat der Wohnung Bad Ems, Schätzwert', '', 900],
        ['Pkw / Motorrad / Wohnmobil / Anhänger / Boot', 'VW Caddy, Baujahr 2009, stillgelegt seit 11/2019', '', 1400],
        ['Steuererstattungsansprüche', 'Erstattung Einkommensteuer 2018/2019, geschätzt', 'Finanzamt Diez', 340]
      ]),
      end: L.posten(F, 'vae', [
        ['P-Konto', 'Kontostand 31.07.2026', 'Sparkasse Koblenz', 162.85],
        ['Treuhandkonto', 'Barbetragskonto der Einrichtung', 'Diakonisches Werk Westerwald gGmbH', 94.2],
        ['Bargeld', 'Barbestand im Zimmer', '', 25],
        ['Wertvolle Möbel / Haushaltsgeräte (sofern von Bedeutung)', 'Persönliche Ausstattung Zimmer 1.07 (Fernseher, Radio, Kommode)', '', 420]
      ]),
      debtsBegin: [
        ...L.posten(F, 'vsb', [
          ['Dispokredit / Kontoüberziehung', 'Überziehung Girokonto bei Betreuungsbeginn', 'Sparkasse Koblenz', 1284.6]
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
        ['Rente wegen voller / teilweiser Erwerbsminderung', 'Rente wegen voller Erwerbsminderung, Zahlbetrag', 'Deutsche Rentenversicherung Rheinland-Pfalz', 'monatlich', 742.18],
        ['Grundsicherung im Alter und bei Erwerbsminderung', 'Grundsicherung nach dem 4. Kapitel SGB XII, aufstockend', 'Kreisverwaltung Rhein-Lahn-Kreis', 'monatlich', 396.4],
        ['Geldleistungen aus der Eingliederungshilfe (z. B. Persönliches Budget)', 'Fachleistungen der besonderen Wohnform (Sachleistung)', 'Landesamt für Soziales, Jugend und Versorgung', 'monatlich', 0],
        ['Werkstattlohn (WfbM)', 'Anerkennungsbetrag Arbeitstherapie Holzwerkstatt', 'Diakonisches Werk Westerwald gGmbH', 'monatlich', 52.8]
      ]),
      expenses: L.ausgaben(F, [
        ['Heimkosten / Pflegesatz (stationäre Einrichtung)', 'Gesamtentgelt der besonderen Wohnform (Existenzsichernder und Fachleistungsanteil)', 'Diakonisches Werk Westerwald gGmbH', 'monatlich', 2914, 'Laufende Kosten'],
        ['Miete', 'Existenzsichernder Anteil (Wohnraum) im Gesamtentgelt', 'Diakonisches Werk Westerwald gGmbH', 'monatlich', 486, 'Laufende Kosten'],
        ['Heizung / Gas / Fernwärme', 'Heizkostenanteil im Gesamtentgelt', 'Diakonisches Werk Westerwald gGmbH', 'monatlich', 112, 'Laufende Kosten'],
        ['Handyvertrag / Prepaid-Aufladung', 'Prepaid-Guthaben', 'Aldi Talk', 'monatlich', 10, 'Laufende Kosten'],
        ['Kontoführungsgebühren', 'P-Konto Sparkasse Koblenz', 'Sparkasse Koblenz', 'monatlich', 6.9, 'Laufende Kosten'],
        ['Kleidung / Schuhe', 'Bekleidungspauschale', '', 'monatlich', 38, ''],
        ['Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 'Hausausflüge und Friseur', 'Diakonisches Werk Westerwald gGmbH', 'monatlich', 22, ''],
        ['Zeitungen / Zeitschriften / Online-Abos', 'Tabak, Getränke und Rätselhefte am Hauskiosk', '', 'monatlich', 45, '']
      ])
    },
    schuldenregulierung: schulden,
    approvals: L.genehmigungen(F, [
      ['2021-06-10', 'Wohnungsauflösung / Kündigung Mietvertrag', 'Kündigung des Mietverhältnisses Kurstraße 44, 56130 Bad Ems, und Auflösung des Hausrats', 'Widerstand nach Beratung', 'genehmigt', '2021-07-14', '2021-08-30', 'Genehmigung nach § 1833 BGB. Herr Rothenberg wollte die Wohnung zunächst behalten; nach drei Gesprächen an verschiedenen Tagen und einem gemeinsamen Besuch der leerstehenden Wohnung stimmte er zu. Persönliche Gegenstände, Fotos und Werkzeuge wurden gesichert.'],
      ['2023-05-13', 'Einwilligung in gefährliche Heilbehandlung / Operation (§ 1829 BGB)', 'Aszitespunktion bei dekompensierter Leberzirrhose', 'Beratungsbedarf', 'erledigt', '', '2023-05-14', 'Kein begründetes Risiko im Sinne des § 1829 Abs. 2 BGB; gerichtliche Genehmigung nicht erforderlich. Einwilligung durch die Betreuung nach Aufklärung durch Dr. Farsad; Herr Rothenberg konnte die Maßnahme nicht überblicken.'],
      ['2023-09-04', 'Sonstiges', 'Antrag auf Eröffnung des Verbraucherinsolvenzverfahrens und Erteilung der Restschuldbefreiung', 'Einwilligung', 'genehmigt', '2023-10-11', '2023-11-06', 'Genehmigung nach § 1854 Nr. 4 BGB (Eingehung einer Verbindlichkeit / Verfahrenshandlung von Gewicht). Zuvor außergerichtlicher Einigungsversuch über die Schuldnerberatung gescheitert (Bescheinigung vom 22.08.2023).'],
      ['2024-08-19', 'Prozessführung / Vergleich', 'Verzicht auf die Geltendmachung von Ansprüchen gegen den früheren Steuerberater wegen fehlerhafter Beratung', 'Beratungsbedarf', 'genehmigt', '2024-09-24', '2024-10-02', 'Die Verjährung war bereits eingetreten; ein Prozess wäre aussichtslos gewesen. Anwaltliche Erstberatung vom 05.08.2024 beigefügt.'],
      ['2026-03-30', 'Sonstiges', 'Zustimmung zur Verwertung des stillgelegten VW Caddy durch den Insolvenzverwalter', 'Einwilligung', 'genehmigt', '2026-04-28', '2026-05-15', 'Fahrzeug seit 11/2019 stillgelegt, Restwert 620 €. Herr Rothenberg hat der Verwertung zugestimmt; die Fahrerlaubnis wurde 2019 entzogen und wird nicht wiedererteilt.'],
      ['2026-07-06', 'Sonstiges', 'Nachrüstung von Haltegriffen im Bad des Zimmers 1.07 auf Kosten der Einrichtung', 'Einwilligung', 'erledigt', '', '2026-07-14', 'Keine Genehmigung erforderlich; Maßnahme der Einrichtung nach dem Sturz vom 28.06.2026.']
    ]),
    fristen: L.fristen(F, [
      ['Schlusstermin Insolvenzverfahren 4 IK 118/23', 'Sonstige', 'Amtsgericht Montabaur – Insolvenzgericht', '2026-11-06', '2026-11-19', 'high', 'offen', 'Ende der dreijährigen Abtretungsfrist am 06.11.2026. Antrag auf Befreiung vom persönlichen Erscheinen gestellt, Attest Dr. Brandstätter vom 22.07.2026 beigefügt.'],
      ['Jahresbericht 01.04.2025 – 31.03.2026 an das Betreuungsgericht', 'Bericht', 'Amtsgericht Diez', '2026-03-31', '2026-04-30', 'high', 'erledigt', 'Eingereicht am 21.04.2026 nebst Rechnungslegung.'],
      ['Weiterbewilligung Grundsicherung ab 01.07.2027', 'Weiterbewilligung', 'Kreisverwaltung Rhein-Lahn-Kreis, Sozialamt', '2027-06-30', '2027-05-15', 'high', 'offen', 'Bewilligungszeitraum endet 30.06.2027.'],
      ['Weiterbewilligungsantrag Erwerbsminderungsrente', 'Antrag', 'Deutsche Rentenversicherung Rheinland-Pfalz', '2027-11-30', '2027-05-31', 'high', 'offen', 'Befristete Rente läuft am 30.11.2027 aus; Antrag sechs Monate vorher, ärztliche Unterlagen von Dr. Ohlrogge und Dr. Farsad beifügen.'],
      ['Fortschreibung Gesamtplan Eingliederungshilfe', 'Antrag', 'Landesamt für Soziales, Jugend und Versorgung', '2028-03-31', '2027-12-31', 'normal', 'offen', 'Bewilligung der besonderen Wohnform bis 31.03.2028.'],
      ['Vergütungsantrag 3. Quartal 2026 (VBVG)', 'Sonstige', 'Amtsgericht Diez', '2026-09-30', '2026-10-15', 'normal', 'offen', 'Mittellos, Staatskasse, stationäre Einrichtung, ab dem 25. Monat.'],
      ['Verlängerung Schwerbehindertenausweis und Wertmarke', 'Antrag', 'Landesamt für Soziales, Jugend und Versorgung Koblenz', '2028-06-30', '2028-04-30', 'normal', 'offen', 'Ausweis und Wertmarke gültig bis 30.06.2028.'],
      ['Verlängerung Zuzahlungsbefreiung 2027', 'Antrag', 'BARMER', '2026-12-31', '2026-12-05', 'normal', 'offen', 'Grundsicherungsbescheid als Nachweis.']
    ]),
    goalDecisionPlanning: L.planung(F, [
      {
        typ: 'need', titel: 'Beschützende Wohnform sichern', bereich: 'Wohnen',
        beschreibung: 'Aufgrund des Korsakow-Syndroms ist eine eigenständige Lebensführung dauerhaft ausgeschlossen. Das Haus Lahnblick bietet Struktur, Medikamentengabe und Suchtnachsorge und ist damit die Grundlage der Abstinenz.',
        status: 'In Bearbeitung', prioritaet: 'Dringend', zustaendig: 'Christoph Zepp',
        angelegt: '2021-04-08', stand: '2026-07-28', zieldatum: '', pruefdatum: '2027-12-31',
        quelle: 'Entlassbericht Fachklinik Eußerthal vom 26.03.2021', favorit: true,
        module: ['doku', 'deadline'], fortschritt: 90,
        verlauf: [
          ['2021-04-08', 'Eintrag angelegt', 'Nach Einzug in das Haus Lahnblick'],
          ['2023-08-31', 'Eintrag bearbeitet', 'Nach dem Rückfall Ausgangsregelung angepasst, Platz erhalten'],
          ['2026-07-28', 'Eintrag geprüft', 'Bewilligung bis 31.03.2028 gesichert']
        ]
      },
      {
        typ: 'goal', titel: 'Restschuldbefreiung erreichen', bereich: 'Finanzen & Vermögen',
        beschreibung: 'Verbindlichkeiten von rund 54.000 € aus der gescheiterten Selbstständigkeit. Über das Verbraucherinsolvenzverfahren soll die Restschuldbefreiung nach drei Jahren erreicht werden.',
        status: 'In Bearbeitung', prioritaet: 'Hoch', zustaendig: 'Christoph Zepp',
        angelegt: '2023-08-22', stand: '2026-07-22', zieldatum: '2026-11-06', pruefdatum: '2026-11-19',
        quelle: 'Bescheinigung über das Scheitern des außergerichtlichen Einigungsversuchs', favorit: true,
        module: ['doku', 'approval', 'deadline'], fortschritt: 85,
        smart: {
          formulation: 'Bis zum 06.11.2026 endet die Abtretungsfrist; die Restschuldbefreiung wird im Anschluss erteilt.',
          specific: 'Verfahren 4 IK 118/23 beim Amtsgericht Montabaur',
          measurable: 'Beschluss über die Erteilung der Restschuldbefreiung',
          attractive: 'Herr Rothenberg wäre erstmals seit zwölf Jahren schuldenfrei',
          realistic: 'Alle Obliegenheiten wurden erfüllt, kein pfändbares Einkommen',
          timeBound: 'Abtretungsfrist bis 06.11.2026, Schlusstermin am 19.11.2026'
        },
        verlauf: [
          ['2023-08-22', 'Eintrag angelegt', 'Außergerichtlicher Einigungsversuch gescheitert'],
          ['2023-11-06', 'Eintrag bearbeitet', 'Verfahren eröffnet'],
          ['2026-05-15', 'Eintrag bearbeitet', 'Fahrzeug verwertet, keine weiteren Massegegenstände'],
          ['2026-07-22', 'Eintrag bearbeitet', 'Attest zur Befreiung vom persönlichen Erscheinen eingereicht']
        ]
      },
      {
        typ: 'goal', titel: 'Abstinenz halten', bereich: 'Gesundheit & Pflege',
        beschreibung: 'Nach dem Rückfall im April 2023 mit anschließender Dekompensation der Leberzirrhose ist die Abstinenz überlebenswichtig. Ausgänge finden seither in der Regel begleitet statt; die Nachsorgegruppe ist verbindlich.',
        status: 'In Bearbeitung', prioritaet: 'Dringend', zustaendig: 'Haus Lahnblick / Dieter Rothenberg',
        angelegt: '2023-06-01', stand: '2026-07-28', zieldatum: '', pruefdatum: '2026-12-31',
        quelle: 'Entlassbericht Paracelsus-Klinik vom 30.05.2023', favorit: true,
        module: ['doku', 'calendar'], fortschritt: 95,
        verlauf: [
          ['2023-06-01', 'Eintrag angelegt', 'Nach dem Rückfall'],
          ['2023-09-01', 'Eintrag bearbeitet', 'Suchtnachsorgegruppe verbindlich vereinbart'],
          ['2026-07-28', 'Eintrag geprüft', 'Seit April 2023 abstinent, Leberwerte stabil']
        ]
      },
      {
        typ: 'wish', titel: 'Kontakt zum Sohn halten', bereich: 'Soziales Umfeld',
        beschreibung: 'Herr Rothenberg spricht bei fast jedem Besuch von seinem Sohn Marco. Der Kontakt war seit 2019 abgebrochen und wurde 2024 auf Initiative des Sohnes wieder aufgenommen.',
        aussage: '„Mein Junge kommt bald wieder, der arbeitet jetzt bei der Bahn."',
        status: 'In Bearbeitung', prioritaet: 'Hoch', zustaendig: 'Dieter Rothenberg',
        angelegt: '2021-09-14', stand: '2026-07-28', zieldatum: '', pruefdatum: '2026-12-31',
        quelle: 'Fortlaufende Äußerungen bei Besuchen', favorit: true,
        module: ['doku', 'calendar'], fortschritt: 70,
        verlauf: [
          ['2021-09-14', 'Eintrag angelegt', 'Wunsch nach Kontakt zum Sohn'],
          ['2024-04-27', 'Eintrag bearbeitet', 'Sohn meldet sich von sich aus, erster Besuch im Mai 2024'],
          ['2026-07-28', 'Eintrag geprüft', 'Zwei bis drei Besuche jährlich, monatliche Telefonate']
        ]
      },
      {
        typ: 'decision', titel: 'Keine Wiedererteilung der Fahrerlaubnis anstreben', bereich: 'Alltag & Selbstständigkeit',
        beschreibung: 'Herr Rothenberg fragt wiederholt nach seinem Führerschein. Eine Wiedererteilung ist wegen des Korsakow-Syndroms medizinisch ausgeschlossen. Die Entscheidung wurde mit ihm, der Einrichtung und Dr. Ohlrogge besprochen und dokumentiert; das Fahrzeug wurde 2026 verwertet.',
        status: 'Abgeschlossen', prioritaet: 'Normal', zustaendig: 'Christoph Zepp',
        angelegt: '2022-03-08', stand: '2026-05-15', zieldatum: '2026-05-15', pruefdatum: '',
        quelle: 'Neurologische Stellungnahme Dr. Ohlrogge vom 21.02.2022',
        module: ['doku', 'approval'], fortschritt: 100,
        verlauf: [
          ['2022-03-08', 'Eintrag angelegt', 'Wiederholte Nachfragen nach dem Führerschein'],
          ['2022-04-11', 'Eintrag bearbeitet', 'Ärztliche Stellungnahme eingeholt, mit Herrn Rothenberg besprochen'],
          ['2026-05-15', 'Eintrag abgeschlossen', 'Fahrzeug durch den Insolvenzverwalter verwertet']
        ]
      },
      {
        typ: 'measure', titel: 'Sturzprophylaxe im Bad', bereich: 'Wohnen',
        beschreibung: 'Nach dem Sturz vom 28.06.2026 wurden Haltegriffe und eine rutschhemmende Matte in der Dusche nachgerüstet. Zusätzlich wurde Physiotherapie zur Gangsicherheit bei Polyneuropathie verordnet.',
        status: 'Abgeschlossen', prioritaet: 'Hoch', zustaendig: 'Haus Lahnblick',
        angelegt: '2026-06-29', stand: '2026-07-15', zieldatum: '2026-07-31', pruefdatum: '2026-12-31',
        quelle: 'Sturzereignis vom 28.06.2026, Hausbesuch Dr. Brandstätter',
        module: ['doku', 'task'], fortschritt: 100,
        verlauf: [
          ['2026-06-29', 'Eintrag angelegt', 'Nach dem Sturz'],
          ['2026-07-14', 'Eintrag bearbeitet', 'Haltegriffe montiert'],
          ['2026-07-15', 'Eintrag abgeschlossen', 'Physiotherapie zweimal wöchentlich begonnen']
        ]
      },
      {
        typ: 'review', titel: 'Umgang mit der Unterhaltsforderung nach Restschuldbefreiung', bereich: 'Finanzen & Vermögen',
        beschreibung: 'Die Unterhaltsrückstände gegenüber der geschiedenen Ehefrau in Höhe von 6.840 € könnten nach § 302 Nr. 1 InsO von der Restschuldbefreiung ausgenommen sein. Zu klären ist, ob die Forderung als vorsätzlich pflichtwidrig unterlassene Unterhaltszahlung angemeldet wurde.',
        status: 'Zur Prüfung', prioritaet: 'Hoch', zustaendig: 'Christoph Zepp',
        angelegt: '2026-04-14', stand: '2026-07-22', zieldatum: '2026-11-19', pruefdatum: '2026-11-19',
        quelle: 'Insolvenztabelle, Anmeldung vom 12.01.2024',
        module: ['doku', 'deadline'], fortschritt: 40,
        verlauf: [
          ['2026-04-14', 'Eintrag angelegt', 'Prüfung der Tabellenanmeldung'],
          ['2026-07-22', 'Eintrag bearbeitet', 'Anfrage an den Insolvenzverwalter zur Attributierung gestellt']
        ]
      },
      {
        typ: 'need', titel: 'Verlängerung der Erwerbsminderungsrente vorbereiten', bereich: 'Behörden & Recht',
        beschreibung: 'Die befristete Rente wegen voller Erwerbsminderung endet am 30.11.2027. Ohne rechtzeitige Weiterbewilligung entfiele die Haupteinnahmequelle; die Grundsicherung müsste vollständig einspringen.',
        status: 'Offen', prioritaet: 'Normal', zustaendig: 'Christoph Zepp',
        angelegt: '2026-05-19', stand: '2026-05-19', zieldatum: '2027-05-31', pruefdatum: '2027-05-31',
        quelle: 'Rentenbescheid vom 04.12.2020',
        module: ['deadline', 'doku'], fortschritt: 10,
        verlauf: [['2026-05-19', 'Eintrag angelegt', 'Frist vorgemerkt']]
      }
    ]),
    accounting: L.rechnungslegung(F, {
      von: '2025-04-01', bis: '2026-03-31',
      konten: [
        { name: 'P-Konto (Verwaltungskonto)', art: 'P-Konto', bank: 'Sparkasse Koblenz', inhaber: 'Dieter Rothenberg', iban: 'DE95 5705 0120 0022 8804 71', bic: 'MALADE51KOB', anfang: 148.2, ende: 162.85, einnahmen: 14300.16, ausgaben: 14285.51 },
        { name: 'Barbetragskonto der Einrichtung', art: 'Treuhandkonto', bank: 'Sparkasse Westerwald-Sieg', inhaber: 'Dieter Rothenberg (Barbetrag)', iban: 'DE60 5735 1030 0000 9413 70', bic: 'MALADE51AKI', anfang: 118.6, ende: 94.2, einnahmen: 1620, ausgaben: 1644.4 }
      ],
      vermoegen: [
        ['Bargeld und Bankguthaben', 'P-Konto und Barbetragskonto', 266.8, 257.05],
        ['Fahrzeuge', 'VW Caddy, stillgelegt, im Mai 2026 durch den Insolvenzverwalter verwertet', 620, 0],
        ['Haushaltsgegenstände', 'Persönliche Ausstattung Zimmer 1.07', 460, 420]
      ],
      verbindlichkeiten: [
        ['Insolvenztabelle (fünf Gläubiger)', 'Verbraucherinsolvenzverfahren 4 IK 118/23 AG Montabaur, festgestellte Forderungen', 54041.95, 54041.95],
        ['Sanitätshaus Lahntal GmbH', 'Eigenanteil orthopädische Schuhe, Neuverbindlichkeit', 34, 0]
      ],
      schenkungen: []
    }),
    exportHistory: [],
    archives: [],
    history: [],
    contacts: [],
    contactMerges: [],
    promptHints: 'Korsakow-Syndrom mit Konfabulation: Aussagen von Herrn Rothenberg niemals ungeprüft in Berichte übernehmen, sondern mit der Bezugsassistenz abgleichen und als „eigene Angabe" kennzeichnen. Laufendes Insolvenzverfahren – keine Zahlungen an Insolvenzgläubiger.',
    derived: {}
  },

  kontakte: [
    { kategorie: 'behoerden', rolle: 'Betreuungsgericht', institution: 'Amtsgericht Diez', strasse: 'Wilhelmstraße', hausnummer: '12', plz: '65582', ort: 'Diez', telefon: '06432/6070', fax: '06432/607180', mail: 'poststelle.ag-diz@ko.mjv.rlp.de', aktenzeichen: '12 XVII 305/21', gericht: 'Amtsgericht Diez', gerichtsAz: '12 XVII 305/21' },
    { kategorie: 'behoerden', rolle: 'Insolvenzgericht', institution: 'Amtsgericht Montabaur – Insolvenzgericht', strasse: 'Bahnhofstraße', hausnummer: '47', plz: '56410', ort: 'Montabaur', telefon: '02602/1420', mail: 'poststelle.ag-mt@ko.mjv.rlp.de', aktenzeichen: '4 IK 118/23' },
    { kategorie: 'behoerden', rolle: 'Betreuungsbehörde', institution: 'Kreisverwaltung Rhein-Lahn-Kreis, Betreuungsbehörde', strasse: 'Insel Silberau', hausnummer: '1', plz: '56130', ort: 'Bad Ems', telefon: '02603/9720', mail: 'betreuungsbehoerde@rhein-lahn.rlp.de', aktenzeichen: 'BB-RLK 2021/0902' },
    { kategorie: 'behoerden', rolle: 'Sozialamt - Grundsicherung', institution: 'Kreisverwaltung Rhein-Lahn-Kreis, Sozialamt', strasse: 'Insel Silberau', hausnummer: '1', plz: '56130', ort: 'Bad Ems', telefon: '02603/97230', fax: '02603/972399', mail: 'sozialamt@rhein-lahn.rlp.de', aktenzeichen: 'GruSi-RLK 2021/1104' },
    { kategorie: 'behoerden', rolle: 'Sozialamt - Rehabilitation- und Teilhabeleistungen', institution: 'Landesamt für Soziales, Jugend und Versorgung – Eingliederungshilfe', strasse: 'Baedekerstraße', hausnummer: '2-20', plz: '56073', ort: 'Koblenz', telefon: '0261/40410', mail: 'poststelle@lsjv.rlp.de', aktenzeichen: 'EGH-RLK 2021/2288' },
    { kategorie: 'behoerden', rolle: 'Finanzverwaltung / Finanzamt', institution: 'Finanzamt Diez', strasse: 'Wilhelmstraße', hausnummer: '17', plz: '65582', ort: 'Diez', telefon: '06432/6010', aktenzeichen: '31/224/91106' , mail: 'poststelle@fa-diez.fin-rlp.de' },
    { kategorie: 'behoerden', rolle: 'LSJV / Versorgungsamt', institution: 'Landesamt für Soziales, Jugend und Versorgung Koblenz', strasse: 'Baedekerstraße', hausnummer: '2-20', plz: '56073', ort: 'Koblenz', telefon: '0261/40410', aktenzeichen: 'SB 2021/88 402' , mail: 'poststelle@landesamt-soziales.de' },
    { kategorie: 'behoerden', rolle: 'Familiengericht', institution: 'Amtsgericht Diez – Familiengericht', strasse: 'Wilhelmstraße', hausnummer: '12', plz: '65582', ort: 'Diez', telefon: '06432/6070', aktenzeichen: '4 F 218/19', vorgang: 'Unterhaltstitel Kindesunterhalt' , mail: 'poststelle.ag-diez@ko.mjv.rlp.de' },
    { kategorie: 'gesundheit', rolle: 'Allgemeinmedizin', anrede: 'Sehr geehrter Herr', titel: 'Dr. med.', vorname: 'Heiko', nachname: 'Brandstätter', institution: 'Hausarztpraxis Nassau (Heimarzt)', strasse: 'Bahnhofstraße', hausnummer: '5', plz: '56377', ort: 'Nassau', telefon: '02604/970120', mail: 'praxis@brandstaetter-nassau.de' },
    { kategorie: 'gesundheit', rolle: 'Neurologie', anrede: 'Sehr geehrte Frau', titel: 'Dr. med.', vorname: 'Petra', nachname: 'Ohlrogge', institution: 'MVZ Bad Ems, Neurologie', strasse: 'Römerstraße', hausnummer: '112', plz: '56130', ort: 'Bad Ems', telefon: '02603/941800', mail: 'neurologie@mvz-bad-ems.de' },
    { kategorie: 'gesundheit', rolle: 'Gastroenterologie', anrede: 'Sehr geehrter Herr', titel: 'Dr. med.', vorname: 'Amir', nachname: 'Farsad', institution: 'Gemeinschaftsklinikum Mittelrhein, Hepatologie', strasse: 'Koblenzer Straße', hausnummer: '115-155', plz: '56073', ort: 'Koblenz', telefon: '0261/4962210', mail: 'hepatologie@gk-mittelrhein.de' },
    { kategorie: 'gesundheit', rolle: 'Kardiologie', anrede: 'Sehr geehrte Frau', titel: 'Dr. med.', vorname: 'Susanne', nachname: 'Kellermann', institution: 'MVZ Bad Ems, Kardiologie', strasse: 'Römerstraße', hausnummer: '112', plz: '56130', ort: 'Bad Ems', telefon: '02603/998410', mail: 'kardio@mvz-bad-ems.de' },
    { kategorie: 'gesundheit', rolle: 'Krankenhaus', institution: 'Paracelsus-Klinik Bad Ems', strasse: 'Wilhelmsallee', hausnummer: '1', plz: '56130', ort: 'Bad Ems', telefon: '02603/9210', mail: 'info@paracelsus-kliniken.de' },
    { kategorie: 'gesundheit', rolle: 'Rheaklinik', institution: 'Fachklinik Eußerthal (Suchtrehabilitation)', strasse: 'Hauptstraße', hausnummer: '30', plz: '76857', ort: 'Eußerthal', telefon: '06345/9560', mail: 'info@fachklinik-eusserthal.de', vorgang: 'Langzeittherapie 11/2020 - 03/2021, Nachsorge' },
    { kategorie: 'gesundheit', rolle: 'stationäre Pflege', institution: 'Haus Lahnblick, Diakonisches Werk Westerwald gGmbH', strasse: 'Alte Poststraße', hausnummer: '9', plz: '56377', ort: 'Nassau', telefon: '02604/941370', fax: '02604/941379', mail: 'lahnblick@diakonie-westerwald.de', aktenzeichen: 'EGH-RLK 2021/2288', iban: 'DE60 5735 1030 0000 9413 70', bic: 'MALADE51AKI' },
    { kategorie: 'gesundheit', rolle: 'Zahnmedizin', anrede: 'Sehr geehrte Frau', vorname: 'Britta', nachname: 'Kesselring', institution: 'Zahnarztpraxis Kesselring', strasse: 'Marktplatz', hausnummer: '4', plz: '56377', ort: 'Nassau', telefon: '02604/941188' , mail: 'praxis@zahnarztpraxis-kesselring.de' },
    { kategorie: 'gesundheit', rolle: 'Apotheke', institution: 'Lahn-Apotheke Nassau', strasse: 'Bahnhofstraße', hausnummer: '11', plz: '56377', ort: 'Nassau', telefon: '02604/6120', vorgang: 'Blisterversorgung Haus Lahnblick' , mail: 'info@lahn-apotheke-nassau.de' },
    { kategorie: 'finanzen', rolle: 'Bankinstut', institution: 'Sparkasse Koblenz', strasse: 'Bahnhofstraße', hausnummer: '11', plz: '56068', ort: 'Koblenz', telefon: '0261/3930', iban: 'DE95 5705 0120 0022 8804 71', bic: 'MALADE51KOB', bank: 'Sparkasse Koblenz', vorgang: 'P-Konto seit 18.05.2021' , mail: 'service@sparkasse-koblenz.de' },
    { kategorie: 'finanzen', rolle: 'Schuldnerberatungsstelle', institution: 'Diakonisches Werk Rhein-Lahn, Schuldner- und Insolvenzberatung', strasse: 'Grabenstraße', hausnummer: '18', plz: '56130', ort: 'Bad Ems', telefon: '02603/94170', mail: 'schuldnerberatung@diakonie-rhein-lahn.de', vorgang: 'Bescheinigung § 305 InsO vom 22.08.2023' },
    { kategorie: 'finanzen', rolle: 'Insolvenzgericht', anrede: 'Sehr geehrte Frau', titel: 'Rechtsanwältin', vorname: 'Kathrin', nachname: 'Vollmer', institution: 'Insolvenzverwaltung Vollmer & Kollegen', strasse: 'Löhrstraße', hausnummer: '78', plz: '56068', ort: 'Koblenz', telefon: '0261/9142200', mail: 'kanzlei@vollmer-insolvenz.de', aktenzeichen: '4 IK 118/23' },
    { kategorie: 'finanzen', rolle: 'Gläubiger', institution: 'Berufsgenossenschaft der Bauwirtschaft', strasse: 'Hildegardstraße', hausnummer: '29-30', plz: '10715', ort: 'Berlin', telefon: '030/857810', aktenzeichen: 'BG BAU 4471-2019' , mail: 'service@bgbau.de' },
    { kategorie: 'finanzen', rolle: 'Steuerberatung/Buchhaltung', status: 'Beendet', institution: 'Steuerkanzlei Hübner (ehemals)', strasse: 'Koblenzer Straße', hausnummer: '9', plz: '56130', ort: 'Bad Ems', telefon: '02603/930440', vorgang: 'Mandat 2014-2019, Ansprüche verjährt' , mail: 'service@steuerkanzlei-huebner.de' },
    { kategorie: 'versicherungen', rolle: 'Gesundheitsversicherung (gesetzlich)', institution: 'BARMER', strasse: 'Axel-Springer-Straße', hausnummer: '44', plz: '10969', ort: 'Berlin', telefon: '0800/3331010', mail: 'service@barmer.de', aktenzeichen: 'B990851168' },
    { kategorie: 'versicherungen', rolle: 'Pflegezusatzversicherung', institution: 'BARMER Pflegekasse', strasse: 'Axel-Springer-Straße', hausnummer: '44', plz: '10969', ort: 'Berlin', telefon: '0800/3331010', aktenzeichen: 'PK-B990851168' , mail: 'service@barmer.de' },
    { kategorie: 'versicherungen', rolle: 'Rentenversicherung', institution: 'Deutsche Rentenversicherung Rheinland-Pfalz', strasse: 'Eichendorffstraße', hausnummer: '4-6', plz: '67346', ort: 'Speyer', telefon: '06232/170', aktenzeichen: '18 051168 R 097' , mail: 'service@deutsche-rentenversicherung.de' },
    { kategorie: 'versicherungen', rolle: 'Privathatfplicht', institution: 'Debeka Allgemeine Versicherung AG (Gruppenvertrag der Einrichtung)', strasse: 'Ferdinand-Sauerbruch-Straße', hausnummer: '18', plz: '56073', ort: 'Koblenz', telefon: '0261/9410', aktenzeichen: 'PHV 220 991 06' , mail: 'service@debeka.de' },
    { kategorie: 'arbeit', rolle: 'Tagesförderstätte', institution: 'Holzwerkstatt Haus Lahnblick (Arbeitstherapie)', strasse: 'Alte Poststraße', hausnummer: '9', plz: '56377', ort: 'Nassau', telefon: '02604/941376', vorgang: 'Vier Vormittage wöchentlich, Anerkennungsbetrag' , mail: 'info@holzwerkstatt-haus-lahnblick.de' },
    { kategorie: 'arbeit', rolle: 'Arbeitgeber', status: 'Beendet', institution: 'Rothenberg Fliesenlegerbetrieb (eigene Selbstständigkeit)', strasse: 'Kurstraße', hausnummer: '44', plz: '56130', ort: 'Bad Ems', vorgang: 'Gewerbe abgemeldet 31.12.2018' , mail: 'info@fliesen-rothenberg.de' , telefon: '02603/941255' },
    { kategorie: 'unterkunft', rolle: 'Einrichtungsträger', institution: 'Diakonisches Werk Westerwald gGmbH', strasse: 'Rheinstraße', hausnummer: '41', plz: '56410', ort: 'Montabaur', telefon: '02602/1600', mail: 'info@diakonie-westerwald.de', aktenzeichen: 'Wohn- und Betreuungsvertrag vom 26.03.2021' },
    { kategorie: 'unterkunft', rolle: 'Vermieter', status: 'Beendet', institution: 'Wohnungsbaugesellschaft Bad Ems mbH', strasse: 'Grabenstraße', hausnummer: '5', plz: '56130', ort: 'Bad Ems', telefon: '02603/93440', aktenzeichen: 'WBE-2020-1188', vorgang: 'Mietverhältnis Kurstraße 44, beendet 31.08.2021' , mail: 'info@wbg-bad-ems.de' },
    { kategorie: 'unterkunft', rolle: 'Beitragsservice', status: 'Befreit', institution: 'ARD ZDF Deutschlandradio Beitragsservice', plz: '50656', ort: 'Köln', telefon: '01806/999555', aktenzeichen: '774 220 918' , mail: 'service@rundfunkbeitrag.de' , postfach: '50656 Köln' },
    { kategorie: 'soziales', rolle: 'Sohn', anrede: 'Sehr geehrter Herr', vorname: 'Marco', nachname: 'Rothenberg', strasse: 'Nordring', hausnummer: '18', plz: '45894', ort: 'Gelsenkirchen', mobil: '0152/88044712', mail: 'm.rothenberg88@example-mail.de' , telefon: '0209/3380921' },
    { kategorie: 'soziales', rolle: 'Ehemalige Betreuung', status: 'Beendet', anrede: 'Sehr geehrte Frau', vorname: 'Ilona', nachname: 'Rothenberg', strasse: 'Nordring', hausnummer: '18', plz: '45894', ort: 'Gelsenkirchen', vorgang: 'Geschiedene Ehefrau, Unterhaltsgläubigerin, kein Kontakt' , mail: 'ilona.rothenberg@example-mail.de' , telefon: '0209/3380922' },
    { kategorie: 'soziales', rolle: 'Bruder', status: 'Beendet', anrede: 'Sehr geehrter Herr', vorname: 'Wolfgang', nachname: 'Rothenberg', strasse: 'Buerer Straße', hausnummer: '204', plz: '45899', ort: 'Gelsenkirchen', telefon: '0209/4471228', vorgang: 'Kontakt 2019 abgebrochen' , mail: 'wolfgang.rothenberg@example-mail.de' },
    { kategorie: 'soziales', rolle: 'Peer / Bezugsperson', anrede: 'Sehr geehrter Herr', vorname: 'Tim', nachname: 'Kleinschmidt', institution: 'Haus Lahnblick, Bezugsassistenz', strasse: 'Alte Poststraße', hausnummer: '9', plz: '56377', ort: 'Nassau', telefon: '02604/941374', mail: 'kleinschmidt@diakonie-westerwald.de' },
    { kategorie: 'soziales', rolle: 'Verein (Ehrenamt)', institution: 'Kreuzbund Gruppe Nassau (Suchtselbsthilfe)', strasse: 'Bahnhofstraße', hausnummer: '22', plz: '56377', ort: 'Nassau', telefon: '02604/950188', mail: 'nassau@kreuzbund-limburg.de' },
    { kategorie: 'soziales', rolle: 'aktuelle Betreuung', anrede: 'Sehr geehrter Herr', vorname: 'Christoph', nachname: 'Zepp', institution: 'Betreuungsbüro Rheinblick', strasse: 'Marktplatz', hausnummer: '8', plz: '56346', ort: 'St. Goarshausen', telefon: '06771/959410', mail: 'kanzlei@betreuungsbuero-rheinblick.de' }
  ],

  doku: L.doku([
    ['2021-04-01', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Betreuungsspezifischer Vorgang', 'Übernahme einer neuen Betreuung / Erstgespräch / Aktenanlage', 'Schriftlich (Brief)', 'Bestellung nach vorläufiger Betreuung', 'Beschluss vom 22.03.2021 nach vorläufiger Betreuung seit 05.02.2021. Neun Aufgabenkreise einschließlich Wohnungsauflösung und Vertretung gegenüber Gerichten. Einwilligungsvorbehalt für die Vermögenssorge.'],
    ['2021-04-08', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Beratungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Erstbesuch im Haus Lahnblick', 'Herr Rothenberg war nach der Entwöhnungsbehandlung zwei Wochen zuvor eingezogen. Er wirkte im Gespräch orientiert und erzählte flüssig von seinem Betrieb, verwechselte dabei jedoch Jahreszahlen und Orte. Die Bezugsassistenz bestätigte die Konfabulationsneigung. Vereinbart: Informationen immer auch schriftlich an die Einrichtung.'],
    ['2021-04-12', 'Sozialleistungsträger & öffentliche Stellen', 'Grundsicherungsamt', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Grundsicherung beantragt', 'Antrag auf Grundsicherung bei Erwerbsminderung nach dem 4. Kapitel SGB XII. Die Erwerbsminderungsrente von 742,18 € deckt das Gesamtentgelt der Wohnform nicht.'],
    ['2021-05-12', 'Finanzen, Vermögen & Schulden', 'Inkassounternehmen / Gläubiger', 'Finanzen, Vermögen & Schulden', 'Schuldenklärung / Ratenzahlungsvereinbarung', 'Schriftlich (Brief)', 'Gläubigerermittlung', 'Sechs Gläubiger ermittelt, Gesamtforderung rund 54.000 €, überwiegend aus der 2018 aufgegebenen Selbstständigkeit als Fliesenleger. Kontakt zur Schuldnerberatung des Diakonischen Werks aufgenommen.'],
    ['2021-05-18', 'Finanzen, Vermögen & Schulden', 'Bank / Sparkasse', 'Finanzen, Vermögen & Schulden', 'Kontoeröffnung / Kontoschließung', 'persönlich (Gericht / Behörde)', 'P-Konto eingerichtet', 'Girokonto in ein Pfändungsschutzkonto umgewandelt. Überziehung von 1.284,60 € durch die Sparkasse zur Insolvenztabelle vorgemerkt.'],
    ['2021-06-10', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Wohnungsauflösung beantragt', 'Antrag auf Genehmigung der Kündigung des Mietverhältnisses Kurstraße 44 nach § 1833 BGB. Herr Rothenberg wollte die Wohnung zunächst behalten; drei Gespräche an verschiedenen Tagen geführt.'],
    ['2021-06-24', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Wohnen, Aufenthalt & Unterbringung', 'Beratungsgespräch', 'persönlich (Hausbesuch)', 'Gemeinsamer Besuch der Wohnung', 'Fahrt nach Bad Ems mit Herrn Rothenberg. Beim Anblick der leerstehenden Wohnung erklärte er von sich aus: „Das schaffe ich nicht mehr allein." Zustimmung zur Auflösung; persönliche Gegenstände ausgewählt.'],
    ['2021-07-14', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Genehmigung erteilt', 'Beschluss vom 14.07.2021: Kündigung und Haushaltsauflösung genehmigt.'],
    ['2021-08-30', 'Wohnen, Energie & Kommunikation', 'Umzugsunternehmen', 'Wohnen, Aufenthalt & Unterbringung', 'Wohnungsauflösung / Entrümpelung', 'persönlich (Hausbesuch)', 'Wohnung übergeben', 'Auflösung und Übergabe an die Wohnungsbaugesellschaft. Kaution von 1.290 € mit dem Mietrückstand verrechnet, Restbetrag aus dem Verkauf des Hausrats. Fotos, Werkzeugkiste und Vereinsabzeichen in das Zimmer 1.07 verbracht.'],
    ['2021-09-14', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Gespräch geführt', 'persönlich (Einrichtung / Klinik)', 'Quartalsbesuch, Wunsch nach Sohnkontakt', 'Herr Rothenberg spricht viel von seinem Sohn Marco, zu dem seit 2019 kein Kontakt besteht. Wunsch aufgenommen. Ein Brief an die letzte bekannte Anschrift blieb zunächst unbeantwortet.'],
    ['2022-03-08', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Alltagsorganisation & praktische Unterstützung', 'Beratungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Nachfragen nach dem Führerschein', 'Herr Rothenberg fragt wiederholt nach seinem Führerschein und dem Auto. Neurologische Stellungnahme angefordert, um die Frage abschließend klären zu können.'],
    ['2022-04-11', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'Schriftlich (Brief)', 'Neurologische Stellungnahme', 'Dr. Ohlrogge: Wiedererteilung der Fahrerlaubnis bei Korsakow-Syndrom ausgeschlossen. Ergebnis Herrn Rothenberg in einfacher Sprache erläutert; er nahm es ruhig auf und fragte in den Folgemonaten erneut.'],
    ['2022-07-19', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhausaufnahme organisieren', 'telefonisch', 'Erstdiagnose Vorhofflimmern', 'Aufnahme im Kemperhof mit Tachyarrhythmie. Einleitung der Antikoagulation mit Apixaban. Einwilligung durch die Betreuung nach Aufklärung.'],
    ['2022-08-02', 'Gesundheit, Pflege & Rehabilitation', 'Krankenkasse / Pflegekasse', 'Gesundheit, Pflege & Rehabilitation', 'Pflegegrad-Antrag / Höherstufung', 'Schriftlich (Brief)', 'Pflegegrad beantragt', 'Antrag auf Pflegeleistungen. Begutachtung am 24.08.2022 im Haus Lahnblick, Pflegegrad 2 ab 01.09.2022 bewilligt.'],
    ['2023-04-15', 'Gesundheit, Pflege & Rehabilitation', 'Stationäre Pflegeeinrichtung / Wohnheim', 'Gesundheit, Pflege & Rehabilitation', 'Krisenintervention im Alltag', 'telefonisch', 'Alkoholrückfall gemeldet', 'Die Einrichtung meldet einen Rückfall während eines unbegleiteten Wochenendausgangs. Herr Rothenberg kehrte alkoholisiert zurück. Sofortige Abstimmung mit der Bezugsassistenz und Dr. Brandstätter.'],
    ['2023-05-11', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhausaufnahme organisieren', 'telefonisch', 'Dekompensierte Leberzirrhose', 'Aufnahme in die Paracelsus-Klinik mit Aszites und Ödemen. Aufklärung über die Punktion durch Dr. Farsad, Einwilligung durch die Betreuung.'],
    ['2023-06-01', 'Gesundheit, Pflege & Rehabilitation', 'Stationäre Pflegeeinrichtung / Wohnheim', 'Beratung, Abstimmung & Hilfeplanung', 'Helferkonferenz / Fallbesprechung durchgeführt', 'persönlich (Einrichtung / Klinik)', 'Ausgangsregelung neu gefasst', 'Fallbesprechung mit Einrichtungsleitung, Bezugsassistenz, Dr. Brandstätter und Herrn Rothenberg. Ergebnis: Ausgänge künftig in der Regel begleitet, verbindliche Teilnahme an der Suchtnachsorgegruppe. Herr Rothenberg stimmte zu und äußerte selbst, er wolle „das nicht noch mal".'],
    ['2023-08-22', 'Finanzen, Vermögen & Schulden', 'Schuldnerberatungsstelle', 'Finanzen, Vermögen & Schulden', 'Schuldenklärung / Ratenzahlungsvereinbarung', 'persönlich (Gericht / Behörde)', 'Außergerichtlicher Einigungsversuch gescheitert', 'Vergleichsangebot von 4 % der Forderungen aus der Barbetragsrücklage wurde von drei Gläubigern abgelehnt. Bescheinigung nach § 305 InsO ausgestellt.'],
    ['2023-09-04', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Genehmigung des Insolvenzantrags beantragt', 'Antrag auf betreuungsgerichtliche Genehmigung zur Stellung des Verbraucherinsolvenzantrags. Vermögensübersicht und Bescheinigung der Schuldnerberatung beigefügt.'],
    ['2023-10-11', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Genehmigung erteilt', 'Beschluss vom 11.10.2023: Stellung des Insolvenzantrags genehmigt. Rechtskraft am 27.10.2023.'],
    ['2023-11-06', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Insolvenzverfahren eröffnet', 'Amtsgericht Montabaur eröffnet das Verbraucherinsolvenzverfahren, Az. 4 IK 118/23. Rechtsanwältin Vollmer zur Treuhänderin bestellt. Beginn der dreijährigen Abtretungsfrist am 06.11.2023.'],
    ['2024-01-12', 'Finanzen, Vermögen & Schulden', 'Inkassounternehmen / Gläubiger', 'Finanzen, Vermögen & Schulden', 'Mahnung / Inkasso bearbeiten', 'Schriftlich (Brief)', 'Forderungsanmeldungen geprüft', 'Fünf Forderungen zur Tabelle angemeldet, insgesamt 54.041,95 €. Die Unterhaltsforderung der geschiedenen Ehefrau ist als Forderung aus vorsätzlich pflichtwidrig unterlassener Unterhaltszahlung angemeldet. Kein Widerspruch erhoben.'],
    ['2024-04-27', 'Betroffene Person / unmittelbares Umfeld', 'Kinder', 'Kommunikation & Kontakt', 'Gespräch geführt', 'telefonisch', 'Sohn meldet sich', 'Marco Rothenberg ruft von sich aus im Büro an. Er habe den Brief von 2021 erst spät erhalten und lange gebraucht. Er möchte den Vater besuchen. Kontakt zur Einrichtung vermittelt.'],
    ['2024-05-25', 'Betroffene Person / unmittelbares Umfeld', 'Kinder', 'Kommunikation & Kontakt', 'Gespräch geführt', 'persönlich (Einrichtung / Klinik)', 'Erster Besuch des Sohnes', 'Marco Rothenberg besucht seinen Vater im Haus Lahnblick. Nach Auskunft der Bezugsassistenz ein bewegender, aber gelungener Besuch. Herr Rothenberg sprach danach wochenlang davon.'],
    ['2024-08-19', 'Sonstige Akteure', 'Rechtsanwält:in / Notar:in', 'Anträge, Verfahren & Rechtliches', 'Beratungsgespräch', 'persönlich (Betreuungsbüro)', 'Ansprüche gegen den Steuerberater geprüft', 'Anwaltliche Erstberatung zur Frage, ob Ansprüche gegen die frühere Steuerkanzlei bestehen. Ergebnis: Verjährung eingetreten, Klage aussichtslos. Genehmigung des Verzichts beim Betreuungsgericht beantragt.'],
    ['2025-01-08', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhausaufnahme organisieren', 'telefonisch', 'Radiusfraktur nach Sturz', 'Sturz auf Glatteis vor der Einrichtung. Konservative Versorgung mit Gipsverband, Entlassung nach fünf Tagen. Ergotherapie verordnet.'],
    ['2025-09-24', 'Gesundheit, Pflege & Rehabilitation', 'Sanitätshaus', 'Alltagsorganisation & praktische Unterstützung', 'Organisation von Hilfsmitteln (Rollator, Pflegebett, Hilfsmittelrezept)', 'persönlich (Einrichtung / Klinik)', 'Orthopädische Schuhe angepasst', 'Bei Polyneuropathie orthopädische Maßschuhe verordnet. Eigenanteil 34 € aus dem Barbetrag in zwei Raten.'],
    ['2026-01-20', 'Gesundheit, Pflege & Rehabilitation', 'Hausärzt:in', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'Schriftlich (E-Mail)', 'Quartalsvisite', 'Dr. Brandstätter berichtet stabile Werte unter Apixaban, keine Blutungszeichen. Kreatinin im Normbereich.'],
    ['2026-02-17', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'Schriftlich (Brief)', 'Leberbefund stabil', 'Child-Pugh A unverändert, keine behandlungsbedürftigen Ösophagusvarizen. Dr. Farsad betont die Bedeutung der fortgesetzten Abstinenz.'],
    ['2026-03-12', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Kontrolle, Prüfung & Nachverfolgung', 'Stellungnahme', 'Schriftlich (Brief)', 'Neurologische Verlaufskontrolle', 'Dr. Ohlrogge: anterograde Amnesie unverändert, Alltagsfähigkeiten in strukturierter Umgebung erhalten. Eine beschützende Wohnform bleibt erforderlich.'],
    ['2026-03-30', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'eBO', 'Verwertung des Fahrzeugs', 'Der Insolvenzverwalter beabsichtigt die Verwertung des stillgelegten VW Caddy (Restwert 620 €). Herr Rothenberg hat zugestimmt. Genehmigung beim Betreuungsgericht beantragt.'],
    ['2026-04-21', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Betreuungsspezifischer Vorgang', 'Jahresbericht / Entwicklungsbericht', 'eBO', 'Jahresbericht 2025/2026', 'Bericht und Rechnungslegung für 01.04.2025 bis 31.03.2026 eingereicht. Hinweis auf das laufende Insolvenzverfahren und das Ende der Abtretungsfrist am 06.11.2026.'],
    ['2026-05-15', 'Finanzen, Vermögen & Schulden', 'Finanzdienstleister / Vermögensverwaltung', 'Finanzen, Vermögen & Schulden', 'Vermögensübersicht erstellen / aktualisieren', 'Schriftlich (E-Mail)', 'Fahrzeug verwertet', 'Verwertung des VW Caddy durch die Insolvenzverwaltung, Erlös 620 € zur Masse. Damit keine weiteren Massegegenstände.'],
    ['2026-05-19', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Gespräch geführt', 'persönlich (Einrichtung / Klinik)', 'Persönlicher Besuch und Einschätzung', 'Herr Rothenberg begrüßte herzlich, erinnerte den letzten Besuch nicht. Er berichtete stolz von der Holzwerkstatt und einem Vogelhaus, das er gebaut habe – nach Auskunft der Bezugsassistenz zutreffend. Wochengeld übergeben. Kontakt- und Zusammenarbeitsprofil aktualisiert.'],
    ['2026-06-29', 'Gesundheit, Pflege & Rehabilitation', 'Hausärzt:in', 'Gesundheit, Pflege & Rehabilitation', 'Krisenintervention im Alltag', 'telefonisch', 'Sturz im Bad', 'Sturz beim Duschen, Prellung der linken Hüfte, kein Bruch. Dr. Brandstätter empfiehlt Haltegriffe und Physiotherapie. Mit der Einrichtung sofort abgestimmt.'],
    ['2026-07-14', 'Wohnen, Energie & Kommunikation', 'Einrichtungsträger (Heim, betreutes Wohnen, besondere Wohnform)', 'Wohnen, Aufenthalt & Unterbringung', 'Organisation von Hilfsmitteln (Rollator, Pflegebett, Hilfsmittelrezept)', 'Schriftlich (E-Mail)', 'Bad nachgerüstet', 'Haltegriffe und rutschhemmende Matte montiert, Kosten trägt die Einrichtung. Physiotherapie zweimal wöchentlich begonnen.'],
    ['2026-07-22', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Stellungnahme', 'Schriftlich (Brief)', 'Attest für das Insolvenzgericht', 'Antrag auf Befreiung vom persönlichen Erscheinen im Schlusstermin beim Amtsgericht Montabaur gestellt, Attest Dr. Brandstätter beigefügt. Die Betreuung wird den Termin wahrnehmen.'],
    ['2026-07-28', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Gespräch geführt', 'persönlich (Einrichtung / Klinik)', 'Besuch, Wochengeld, Sachstand Insolvenz', 'Herr Rothenberg wirkte nach dem Sturz wieder sicher, nutzt die Haltegriffe. Über das Ende der Abtretungsfrist informiert; er reagierte mit „Dann bin ich die los?" und freute sich sichtlich. Die Information wurde schriftlich an die Bezugsassistenz weitergegeben.'],
    ['2026-08-12', 'Wohnen, Energie & Kommunikation', 'Einrichtungsträger (Heim, betreutes Wohnen, besondere Wohnform)', 'Finanzen, Vermögen & Schulden', 'Bargeldversorgung / Taschengeld auszahlen', 'Schriftlich (E-Mail)', 'Barbetrag August abgerechnet', 'Barbetragsabrechnung Juli der Einrichtung geprüft und quittiert. Ausgaben plausibel, überwiegend Tabak und Kioskeinkäufe.']
  ]),

  termine: [
    { titel: 'Schlusstermin Insolvenzverfahren 4 IK 118/23', start: '2026-11-19T10:00:00', ende: '2026-11-19T11:00:00', ort: 'Amtsgericht Montabaur, Bahnhofstraße 47, 56410 Montabaur', beschreibung: 'Herr Rothenberg ist vom persönlichen Erscheinen befreit; Wahrnehmung durch die Betreuung. Frage der Unterhaltsforderung nach § 302 Nr. 1 InsO klären.' },
    { titel: 'Besuch Haus Lahnblick', start: '2026-10-06T14:30:00', ende: '2026-10-06T15:30:00', ort: 'Haus Lahnblick, Alte Poststraße 9, 56377 Nassau', beschreibung: 'Regelbesuch. Themen: Insolvenzschlusstermin, Sturzprophylaxe, Wochengeld.' },
    { titel: 'Kardiologische Kontrolle Dr. Kellermann', start: '2026-11-04T09:15:00', ende: '2026-11-04T10:00:00', ort: 'MVZ Bad Ems, Römerstraße 112, 56130 Bad Ems', beschreibung: 'Langzeit-EKG-Kontrolle. Begleitung durch die Einrichtung.' },
    { titel: 'Hilfeplangespräch Haus Lahnblick', start: '2026-09-22T10:00:00', ende: '2026-09-22T11:30:00', ort: 'Haus Lahnblick, Alte Poststraße 9, 56377 Nassau', beschreibung: 'Halbjährliche Fortschreibung der Assistenzplanung. Bezugsassistenz Herr Kleinschmidt.' },
    { titel: 'Besuch des Sohnes Marco Rothenberg', start: '2026-09-12T13:00:00', ende: '2026-09-12T17:00:00', ort: 'Haus Lahnblick, Nassau', beschreibung: 'Angekündigter Besuch. Nur informativ; Einrichtung ist verständigt.' }
  ],

  aufgaben: [
    { titel: 'Schlusstermin Insolvenz vorbereiten', beschreibung: 'Unterlagen zusammenstellen: Vermögensübersicht, Nachweis der Obliegenheitserfüllung, Attest zur Befreiung. Frage der Unterhaltsforderung nach § 302 Nr. 1 InsO klären.', faellig: '2026-11-12', prio: 'hoch' },
    { titel: 'Anfrage an Insolvenzverwaltung zur Unterhaltsforderung', beschreibung: 'Rechtsanwältin Vollmer um Auskunft bitten, ob die Forderung der geschiedenen Ehefrau als Forderung aus vorsätzlich pflichtwidrig unterlassener Unterhaltszahlung attributiert ist.', faellig: '2026-09-04', prio: 'hoch' },
    { titel: 'Vergütungsantrag 3. Quartal 2026 stellen', beschreibung: 'Mittellos, Staatskasse, stationäre Einrichtung, ab dem 25. Monat.', faellig: '2026-10-12', prio: 'normal' },
    { titel: 'Zuzahlungsbefreiung 2027 bei der BARMER beantragen', beschreibung: 'Grundsicherungsbescheid als Nachweis der Bruttoeinnahmen beifügen.', faellig: '2026-12-02', prio: 'normal' },
    { titel: 'Weiterbewilligung Erwerbsminderungsrente vorbereiten', beschreibung: 'Befristung endet 30.11.2027. Befundberichte von Dr. Ohlrogge, Dr. Farsad und Dr. Brandstätter anfordern; Antrag im Mai 2027 stellen.', faellig: '2027-04-30', prio: 'normal' },
    { titel: 'Barbetragsabrechnung der Einrichtung prüfen', beschreibung: 'Monatliche Abrechnung des Barbetragskontos abgleichen und für die Rechnungslegung ablegen.', faellig: '2026-09-10', prio: 'niedrig' },
    { titel: 'Sohn über den Termin am 19.11.2026 informieren', beschreibung: 'Marco Rothenberg hat um Information über wesentliche Entwicklungen gebeten; Einwilligung des Vaters liegt vor.', faellig: '2026-11-05', prio: 'niedrig' }
  ],

  fahrten: [
    { datum: '2026-05-19', anlass: 'Besuch im Haus Lahnblick, Wochengeld, Kontakteinschätzung', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Alte Poststraße 9, 56377 Nassau', km: 38.6 },
    { datum: '2026-07-28', anlass: 'Besuch nach Sturz, Sachstand Insolvenz', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Alte Poststraße 9, 56377 Nassau', km: 38.6 },
    { datum: '2026-03-30', anlass: 'Termin Insolvenzverwaltung, Fahrzeugverwertung', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Löhrstraße 78, 56068 Koblenz', km: 52.4 }
  ],

  rechnungen: [
    { datum: '2026-01-15', nummer: 'RE-2026-0037', empfaenger: 'Landesjustizkasse Mainz (Staatskasse)', zweck: 'Betreuervergütung (VBVG, mittellos, stationäre Einrichtung)', zeitraum: '01.10.2025 - 31.12.2025', summe: 294, eingang: '2026-02-04', eingangsbetrag: 294 },
    { datum: '2026-04-13', nummer: 'RE-2026-0112', empfaenger: 'Landesjustizkasse Mainz (Staatskasse)', zweck: 'Betreuervergütung (VBVG, mittellos, stationäre Einrichtung)', zeitraum: '01.01.2026 - 31.03.2026', summe: 294, eingang: '2026-05-02', eingangsbetrag: 294 },
    { datum: '2026-07-13', nummer: 'RE-2026-0209', empfaenger: 'Landesjustizkasse Mainz (Staatskasse)', zweck: 'Betreuervergütung (VBVG, mittellos, stationäre Einrichtung)', zeitraum: '01.04.2026 - 30.06.2026', summe: 294, eingang: '', eingangsbetrag: null }
  ],

  exporte: [
    L.ausgang(F, 1, {
      datum: '2021-06-10', zeit: '1024', reportId: 'court_approval',
      dokumentTitel: 'Betreuungsgerichtliche Genehmigung', exportMode: 'letterhead',
      empfaenger: 'Amtsgericht Diez, Wilhelmstraße 12, 65582 Diez',
      empfaengerZeilen: ['Amtsgericht Diez', '- Betreuungsgericht -', 'Wilhelmstraße 12', '65582 Diez'],
      betreff: 'Betreuung Dieter Rothenberg – Antrag auf Genehmigung der Wohnungskündigung – Az. 12 XVII 305/21',
      status: 'sent', channel: 'post',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuDetail: 'Genehmigungsantrag',
      inhalt: {
        bezug: 'Betreuungssache Dieter Rothenberg – Az. 12 XVII 305/21',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'namens der betreuten Person beantrage ich die Genehmigung der Kündigung des Mietverhältnisses über die Wohnung Kurstraße 44, 56130 Bad Ems, sowie der anschließenden Auflösung des Hausrats nach § 1833 BGB.\n\nHerr Rothenberg lebt seit dem 26.03.2021 in der sozialtherapeutischen Wohnstätte Haus Lahnblick in Nassau. Die frühere Mietwohnung steht seit seiner Klinikaufnahme im September 2020 leer; der Mietrückstand beläuft sich auf 2.184,00 €, die laufende Miete auf 468,00 € monatlich. Die Wohnungsbaugesellschaft Bad Ems hat eine Kündigung angekündigt.\n\nEine Rückkehr in die eigene Häuslichkeit ist nach dem Entlassbericht der Fachklinik Eußerthal vom 26.03.2021 und nach Einschätzung des Hauses Lahnblick dauerhaft ausgeschlossen. Das Korsakow-Syndrom lässt eine eigenständige Lebensführung nicht zu.\n\nHerr Rothenberg wollte die Wohnung zunächst behalten. Am 24.06.2021 habe ich ihn zu einem gemeinsamen Besuch der leerstehenden Wohnung begleitet. Dort erklärte er von sich aus: „Das schaffe ich nicht mehr allein." Er hat der Auflösung anschließend zugestimmt und persönliche Gegenstände ausgewählt, die in sein Zimmer verbracht werden sollen.',
        anlagen: ['Entlassbericht der Fachklinik Eußerthal vom 26.03.2021', 'Mietvertrag und Rückstandsaufstellung', 'Vermerk über den Wohnungsbesuch vom 24.06.2021']
      }
    }),
    L.ausgang(F, 2, {
      datum: '2021-07-02', zeit: '1516', reportId: 'initial', art: 'bericht',
      dokumentTitel: 'Anfangsbericht', exportMode: 'original',
      empfaenger: 'Amtsgericht Diez, Wilhelmstraße 12, 65582 Diez',
      betreff: 'Betreuung Dieter Rothenberg – Anfangsbericht – Az. 12 XVII 305/21',
      status: 'sent', channel: 'post',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Betreuungsspezifischer Vorgang', dokuDetail: 'Berichterstattung',
      inhalt: {
        kopf: ['Amtsgericht Diez · Az. 12 XVII 305/21', 'Betreute Person: Dieter Rothenberg, geb. 05.11.1968', 'Betreuungsbeginn: 01.04.2021 · Berichtsstichtag: 02.07.2021'],
        ortDatum: 'St. Goarshausen, 02.07.2021',
        abschnitte: [
          { titel: '1. Persönliche Situation', felder: [
            ['Derzeitiger Aufenthaltsort', 'Sozialtherapeutische Wohnstätte Haus Lahnblick, Alte Poststraße 9, 56377 Nassau, Zimmer 1.07'],
            ['Schwerwiegende Krankheiten', 'Amnestisches Syndrom durch Alkohol (Korsakow-Syndrom) nach Wernicke-Enzephalopathie im September 2020. Alkoholabhängigkeitssyndrom, gegenwärtig abstinent in beschützender Umgebung. Alkoholische Leberzirrhose Child-Pugh A und Alkohol-Polyneuropathie beider Beine.'],
            ['Fähigkeiten und Ressourcen', 'Herr Rothenberg ist freundlich, umgänglich und im Kontakt zugewandt. Handwerkliche Fertigkeiten aus seinem früheren Beruf als Fliesenleger sind erhalten; in der Holzwerkstatt arbeitet er konzentriert. Alltagsverrichtungen bewältigt er in strukturierter Umgebung selbstständig.'],
            ['Beeinträchtigungen', 'Ausgeprägte anterograde Amnesie: Neue Informationen werden nach wenigen Minuten nicht mehr erinnert. Die entstehenden Lücken füllt Herr Rothenberg unbewusst mit Konfabulationen, wodurch er im Gespräch orientierter wirkt, als er ist. Eine eigenständige Lebensführung ist ihm dauerhaft nicht möglich.']
          ] },
          { titel: '2. Ziele der Betreuung und Maßnahmen', felder: [
            ['Ziele der Betreuung', 'Sicherung der beschützenden Wohnform als Grundlage der Abstinenz. Sicherung des Lebensunterhalts durch Grundsicherung ergänzend zur Erwerbsminderungsrente. Auflösung der nicht mehr benötigten Wohnung. Ordnung der Verbindlichkeiten aus der gescheiterten Selbstständigkeit. Aufbau einer verlässlichen medizinischen Versorgung.'],
            ['Ergriffene und geplante Maßnahmen', 'Antrag auf Grundsicherung vom 12.04.2021. Umwandlung des überzogenen Girokontos in ein P-Konto. Ermittlung sämtlicher Gläubiger, Kontakt zur Schuldnerberatung. Geplant: Genehmigung der Wohnungskündigung, Pflegegradantrag, Schwerbehindertenausweis, Prüfung eines Verbraucherinsolvenzverfahrens.'],
            ['Handeln gegen den Willen der betreuten Person', 'Die beabsichtigte Auflösung der Wohnung entsprach zunächst nicht dem geäußerten Wunsch. Nach drei Gesprächen und einem gemeinsamen Besuch der Wohnung hat Herr Rothenberg zugestimmt.']
          ] },
          { titel: '3. Wünsche der betreuten Person', felder: [
            ['Kann die betreute Person persönliche Wünsche äußern?', 'bedingt'],
            ['Wünsche und Erwartungen', 'Herr Rothenberg wünscht sich, „dass alles wieder in Ordnung kommt", und äußert regelmäßig den Wunsch nach Kontakt zu seinem Sohn. Er möchte in der Holzwerkstatt arbeiten und fragt nach seinem Führerschein.'],
            ['Nicht erfüllbare Wünsche', 'Die Wiedererteilung der Fahrerlaubnis ist wegen des Korsakow-Syndroms medizinisch ausgeschlossen. Der Erhalt der Wohnung ist wirtschaftlich nicht darstellbar und pflegerisch nicht tragfähig.'],
            ['Erster persönlicher Kontakt', '08.04.2021']
          ] }
        ]
      }
    }),
    L.ausgang(F, 3, {
      datum: '2023-09-04', zeit: '1131', reportId: 'court_approval',
      dokumentTitel: 'Betreuungsgerichtliche Genehmigung', exportMode: 'letterhead',
      empfaenger: 'Amtsgericht Diez, Wilhelmstraße 12, 65582 Diez',
      empfaengerZeilen: ['Amtsgericht Diez', '- Betreuungsgericht -', 'Wilhelmstraße 12', '65582 Diez'],
      betreff: 'Betreuung Dieter Rothenberg – Antrag auf Genehmigung eines Verbraucherinsolvenzantrags – Az. 12 XVII 305/21',
      status: 'sent', channel: 'post',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuDetail: 'Genehmigungsantrag',
      inhalt: {
        bezug: 'Betreuungssache Dieter Rothenberg – Az. 12 XVII 305/21',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'namens der betreuten Person beantrage ich die Genehmigung, beim Amtsgericht Montabaur die Eröffnung des Verbraucherinsolvenzverfahrens und die Erteilung der Restschuldbefreiung zu beantragen.\n\nHerr Rothenberg hat Verbindlichkeiten von rund 54.000,00 € aus seiner bis Ende 2018 betriebenen Selbstständigkeit als Fliesenlegermeister. Die größten Positionen sind Steuerschulden von 18.420,55 €, Beitragsrückstände der Techniker Krankenkasse von 10.204,20 €, ein gekündigter Betriebsmittelkredit der Sparkasse Koblenz über 15.072,40 € nebst Vollstreckungsbescheid, Beiträge der Berufsgenossenschaft der Bauwirtschaft von 3.504,80 € und Unterhaltsrückstände von 6.840,00 €.\n\nDem stehen monatliche Einkünfte von 742,18 € Erwerbsminderungsrente und 52,80 € Anerkennungsbetrag aus der Arbeitstherapie gegenüber; pfändbares Einkommen besteht nicht. Ein außergerichtlicher Einigungsversuch über die Schuldnerberatung des Diakonischen Werks ist am 22.08.2023 gescheitert; das Vergleichsangebot von 4 vom Hundert wurde von drei Gläubigern abgelehnt. Die Bescheinigung nach § 305 InsO liegt bei.\n\nOhne Restschuldbefreiung bliebe Herr Rothenberg dauerhaft überschuldet. Ein wirtschaftlicher Nachteil ist nicht ersichtlich, weil kein verwertbares Vermögen vorhanden ist. Herr Rothenberg hat dem Vorgehen am 28.08.2023 zugestimmt; das Verfahren wurde ihm in einfacher Sprache erläutert.',
        anlagen: ['Bescheinigung nach § 305 InsO vom 22.08.2023', 'Gläubiger- und Forderungsverzeichnis', 'Vermögensübersicht', 'Rentenbescheid']
      }
    }),
    L.ausgang(F, 4, {
      datum: '2026-03-30', zeit: '1247', reportId: 'court_approval',
      dokumentTitel: 'Betreuungsgerichtliche Genehmigung', exportMode: 'letterhead',
      empfaenger: 'Amtsgericht Diez, Wilhelmstraße 12, 65582 Diez',
      empfaengerZeilen: ['Amtsgericht Diez', '- Betreuungsgericht -', 'Wilhelmstraße 12', '65582 Diez'],
      betreff: 'Betreuung Dieter Rothenberg – Zustimmung zur Fahrzeugverwertung im Insolvenzverfahren – Az. 12 XVII 305/21',
      status: 'sent', channel: 'ebo',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuDetail: 'Genehmigungsantrag',
      inhalt: {
        bezug: 'Betreuungssache Dieter Rothenberg – Az. 12 XVII 305/21',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'namens der betreuten Person beantrage ich die Genehmigung der Zustimmung zur freihändigen Verwertung des Personenkraftwagens VW Caddy, Erstzulassung 2009, seit November 2019 stillgelegt, durch die Insolvenzverwalterin Rechtsanwältin Kathrin Vollmer im Verfahren 4 IK 118/23 des Amtsgerichts Montabaur. Der geschätzte Verwertungserlös beträgt 620,00 €.\n\nHerrn Rothenberg wurde die Fahrerlaubnis im November 2019 entzogen; eine Wiedererteilung ist wegen des Korsakow-Syndroms nach der neurologischen Stellungnahme von Dr. med. Petra Ohlrogge vom 21.02.2022 medizinisch ausgeschlossen. Das Fahrzeug hat für ihn keinen Nutzen mehr, verursacht Standkosten und verliert weiter an Wert. Es gehört zur Insolvenzmasse; die Verwertung ist ohnehin Aufgabe der Verwalterin.\n\nDie Zustimmung erspart eine gerichtliche Auseinandersetzung über die Herausgabe und beschleunigt das Verfahren, dessen Abtretungsfrist am 06.11.2026 endet. Herr Rothenberg wurde am 24.03. und – bewusst an einem zweiten Tag – am 28.03.2026 über den Vorgang informiert und hat beide Male zugestimmt; beim zweiten Gespräch sagte er von sich aus, er fahre ja doch nicht mehr.',
        anlagen: ['Schreiben der Insolvenzverwaltung vom 18.03.2026', 'Wertermittlung', 'Neurologische Stellungnahme vom 21.02.2022', 'Vermerk über die beiden Gespräche']
      }
    }),
    L.ausgang(F, 5, {
      datum: '2026-04-21', zeit: '1108', reportId: 'annual_noassets', art: 'bericht',
      dokumentTitel: 'Jahresbericht ohne Vermögenssorge', exportMode: 'original',
      empfaenger: 'Amtsgericht Diez, Wilhelmstraße 12, 65582 Diez',
      betreff: 'Betreuung Dieter Rothenberg – Jahresbericht 01.04.2025 – 31.03.2026 – Az. 12 XVII 305/21',
      status: 'sent', channel: 'ebo',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Betreuungsspezifischer Vorgang', dokuDetail: 'Jahresbericht / Entwicklungsbericht',
      inhalt: {
        kopf: ['Amtsgericht Diez · Az. 12 XVII 305/21', 'Betreute Person: Dieter Rothenberg, geb. 05.11.1968', 'Berichtszeitraum: 01.04.2025 bis 31.03.2026'],
        ortDatum: 'St. Goarshausen, 21.04.2026',
        abschnitte: [
          { titel: 'Persönliche Verhältnisse', felder: [
            ['Ständiger Aufenthalt', 'Haus Lahnblick, Alte Poststraße 9, 56377 Nassau, Zimmer 1.07'],
            ['Heimunterbringung', 'ja'],
            ['Persönlicher Eindruck', 'Herr Rothenberg war im Berichtszeitraum durchgehend freundlich, umgänglich und körperlich weitgehend stabil. Die Abstinenz besteht seit April 2023 ununterbrochen, die Leberwerte sind stabil. In der Holzwerkstatt arbeitet er weiterhin an vier Vormittagen und zeigt seine Arbeiten stolz vor. Die anterograde Amnesie ist unverändert ausgeprägt.'],
            ['Entwicklung des Zustands', 'nicht verändert'],
            ['Bewertung der weiteren Betreuung', 'weiter erforderlich']
          ] },
          { titel: 'Begründung und Vermögen', felder: [
            ['Erforderlichkeit', 'Das Korsakow-Syndrom führt zu einer dauerhaften anterograden Amnesie. Hinzu kommt eine Konfabulationsneigung, die Herrn Rothenberg im Gespräch orientierter erscheinen lässt, als er ist – gerade dies macht ihn im Rechtsverkehr besonders schutzbedürftig. Eine Besserung ist nach neurologischer Einschätzung nicht zu erwarten.'],
            ['Ungefähres Vermögen', 'P-Konto 162,85 €, Barbetragskonto der Einrichtung 94,20 €, persönliche Ausstattung rund 420 €. Zur Insolvenztabelle festgestellte Forderungen 54.041,95 €.']
          ] },
          { titel: 'Sonstiges', felder: [
            ['Berichtenswerte Entwicklungen', 'Das Verbraucherinsolvenzverfahren läuft seit dem 06.11.2023. Die dreijährige Abtretungsfrist endet am 06.11.2026, der Schlusstermin ist auf den 19.11.2026 bestimmt. Sämtliche Obliegenheiten wurden erfüllt. Offen ist, ob die Unterhaltsforderung der geschiedenen Ehefrau nach § 302 Nr. 1 InsO von der Restschuldbefreiung ausgenommen ist. Der Kontakt zum Sohn besteht seit 2024 wieder und hat sich stabilisiert.'],
            ['Besprochen mit der betreuten Person', 'ja, zuletzt am 28.07.2026']
          ] }
        ]
      }
    }),
    L.ausgang(F, 6, {
      datum: '2026-07-13', zeit: '0904', reportId: 'remuneration_pdf', art: 'bericht',
      dokumentTitel: 'Betreuervergütungen', exportMode: 'original',
      empfaenger: 'Amtsgericht Diez, Wilhelmstraße 12, 65582 Diez',
      betreff: 'Betreuung Dieter Rothenberg – Vergütungsantrag 2. Quartal 2026 – Az. 12 XVII 305/21',
      status: 'sent', channel: 'ebo',
      dokuGruppe: 'Büroorganisation / interne Bearbeitung', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Büroorganisation / interne Bearbeitung', dokuDetail: 'Berichterstattung',
      inhalt: {
        kopf: ['Amtsgericht Diez · Az. 12 XVII 305/21', 'Betreute Person: Dieter Rothenberg, geb. 05.11.1968'],
        ortDatum: 'St. Goarshausen, 13.07.2026',
        abschnitte: [
          { titel: 'Abrechnungsabschnitt', felder: [
            ['Zeitraum', '01.04.2026 bis 30.06.2026'],
            ['Vergütungsstufe', '2 (ab dem 25. Monat der Betreuung)'],
            ['Wohnform', 'stationäre Einrichtung / gleichgestellte Wohnform'],
            ['Vermögensstatus', 'mittellos – Zahlung aus der Staatskasse'],
            ['Monatliche Pauschale', '98,00 €'],
            ['Gesamtbetrag', '294,00 €']
          ] },
          { titel: 'Ergänzende Angaben', felder: [
            ['Grundlage', '§ 8 VBVG, Vergütungstabelle B'],
            ['Anlagen', 'Bewilligungsbescheid Grundsicherung vom 12.06.2026, Bescheinigung des Diakonischen Werks Westerwald über die Wohnform vom 02.07.2026'],
            ['Hinweis', 'Das laufende Verbraucherinsolvenzverfahren 4 IK 118/23 berührt den Vergütungsanspruch nicht.']
          ] }
        ]
      }
    }),
    L.ausgang(F, 7, {
      datum: '2026-08-12', zeit: '1533', reportId: 'sgb12_social_assistance_short', art: 'bericht',
      dokumentTitel: 'Kurzantrag Sozialhilfe SGB XII', exportMode: 'letterhead',
      empfaenger: 'Kreisverwaltung Rhein-Lahn-Kreis, Sozialamt, Insel Silberau 1, 56130 Bad Ems',
      betreff: 'Weiterbewilligung Grundsicherung ab 01.07.2027 – Dieter Rothenberg – GruSi-RLK 2021/1104',
      status: 'created', notiz: 'Entwurf für die Weiterbewilligung; wird im Mai 2027 mit aktuellen Nachweisen versendet.',
      dokuGruppe: 'Sozialleistungsträger & öffentliche Stellen', dokuAkteur: 'Grundsicherungsamt',
      dokuDetail: 'Weiterbewilligungsantrag',
      inhalt: {
        kopf: ['Kreisverwaltung Rhein-Lahn-Kreis, Sozialamt · GruSi-RLK 2021/1104', 'Dieter Rothenberg, geb. 05.11.1968, Haus Lahnblick, Alte Poststraße 9, 56377 Nassau'],
        ortDatum: 'St. Goarshausen, 12.08.2026',
        abschnitte: [
          { titel: 'Beantragte Leistung', felder: [
            ['Leistung', 'Weiterbewilligung der Grundsicherung bei Erwerbsminderung nach dem 4. Kapitel SGB XII'],
            ['Zeitraum', '01.07.2027 bis 30.06.2028'],
            ['Haushalt', 'Alleinstehend, besondere Wohnform des Diakonischen Werks Westerwald gGmbH; keine Einstandsgemeinschaft.']
          ] },
          { titel: 'Einkommen und Vermögen', felder: [
            ['Einkommen', 'Erwerbsminderungsrente 742,18 €, Anerkennungsbetrag Arbeitstherapie 52,80 € monatlich. Die Rente ist bis 30.11.2027 befristet; die Weiterbewilligung wird gesondert beantragt.'],
            ['Vermögen', 'P-Konto 162,85 €, Barbetragskonto 94,20 €. Kein verwertbares Vermögen. Verbraucherinsolvenzverfahren 4 IK 118/23, Abtretungsfrist bis 06.11.2026.'],
            ['Anlagen', 'Rentenanpassungsmitteilung, Kontoauszüge der letzten drei Monate, Bescheid über die Eingliederungshilfe, Entgeltbescheinigung der Einrichtung']
          ] }
        ]
      }
    })
  ],

  archive: [
    L.archiv(F, 1, {
      reportId: 'initial', titel: 'Anfangsbericht', archiviertAm: '2021-07-02', zeit: '15:16',
      erstelltAm: '2021-05-18', von: '01.04.2021', bis: '02.07.2021',
      name: '210702 1516 Amtsgericht Diez Anfangsbericht',
      notiz: 'Beim Betreuungsgericht eingereichte Fassung des Anfangsberichts.',
      felder: {
        current_residence: 'Sozialtherapeutische Wohnstätte Haus Lahnblick, Alte Poststraße 9, 56377 Nassau, Zimmer 1.07',
        goals: 'Sicherung der beschützenden Wohnform. Sicherung des Lebensunterhalts. Auflösung der nicht mehr benötigten Wohnung. Ordnung der Verbindlichkeiten. Aufbau einer verlässlichen medizinischen Versorgung.',
        measures: 'Antrag auf Grundsicherung vom 12.04.2021. Umwandlung des Girokontos in ein P-Konto. Ermittlung sämtlicher Gläubiger, Kontakt zur Schuldnerberatung.',
        against_will: 'Die beabsichtigte Auflösung der Wohnung entsprach zunächst nicht dem geäußerten Wunsch; nach drei Gesprächen und einem gemeinsamen Wohnungsbesuch hat Herr Rothenberg zugestimmt.',
        unfulfillable_wishes: 'Die Wiedererteilung der Fahrerlaubnis ist medizinisch ausgeschlossen. Der Erhalt der Wohnung ist wirtschaftlich nicht darstellbar.',
        first_contact: '2021-04-08',
        contact_count: 3
      }
    }),
    L.archiv(F, 2, {
      reportId: 'annual_noassets', titel: 'Jahresbericht ohne Vermögenssorge', archiviertAm: '2025-04-22', zeit: '09:48',
      erstelltAm: '2025-03-28', von: '01.04.2024', bis: '31.03.2025',
      name: '250422 0948 Amtsgericht Diez Jahresbericht ohne Vermögenssorge',
      notiz: 'Eingereichter Jahresbericht 2024/2025 – erstes volles Jahr im Insolvenzverfahren.',
      felder: {
        residence: 'Haus Lahnblick, Alte Poststraße 9, 56377 Nassau, Zimmer 1.07',
        home_placement: 'ja',
        personal_impression: 'Der Zustand war im Berichtszeitraum stabil. Im Januar 2025 zog sich Herr Rothenberg bei einem Sturz auf Glatteis eine Radiusfraktur zu, die konservativ versorgt wurde; nach zehn Einheiten Ergotherapie war die Funktion wiederhergestellt. Der im April 2024 wieder aufgenommene Kontakt zu seinem Sohn hat sich gefestigt.',
        condition_change: 'nicht verändert',
        care_need: 'weiter erforderlich',
        approx_assets: 'P-Konto 148,20 €, Barbetragskonto 118,60 €, Fahrzeug (stillgelegt) rund 620 €. Zur Insolvenztabelle festgestellte Forderungen 54.041,95 €.',
        discussed: 'ja',
        discussed_date: '2025-04-14'
      }
    }),
    L.archiv(F, 3, {
      reportId: 'annual_noassets', titel: 'Jahresbericht ohne Vermögenssorge', archiviertAm: '2026-04-21', zeit: '11:08',
      erstelltAm: '2026-03-30', von: '01.04.2025', bis: '31.03.2026',
      name: '260421 1108 Amtsgericht Diez Jahresbericht ohne Vermögenssorge',
      notiz: 'Eingereichte Fassung mit Hinweis auf das Ende der Abtretungsfrist am 06.11.2026.',
      felder: {
        residence: 'Haus Lahnblick, Alte Poststraße 9, 56377 Nassau, Zimmer 1.07',
        home_placement: 'ja',
        personal_impression: 'Herr Rothenberg war durchgehend freundlich, umgänglich und körperlich weitgehend stabil. Die Abstinenz besteht seit April 2023 ununterbrochen. Der Sturz im Bad am 28.06.2026 hat ihn vorübergehend verunsichert; nach dem Anbringen der Haltegriffe bewegt er sich wieder sicher.',
        condition_change: 'nicht verändert',
        care_need: 'weiter erforderlich',
        approx_assets: 'P-Konto 162,85 €, Barbetragskonto 94,20 €. Das Fahrzeug wurde im Mai 2026 durch die Insolvenzverwaltung verwertet.',
        discussed: 'ja',
        discussed_date: '2026-07-28'
      }
    })
  ],

  berichte: {
    initial: L.bericht({
      registered_address: 'Alte Poststraße 9, 56377 Nassau',
      current_residence: 'Sozialtherapeutische Wohnstätte Haus Lahnblick, Alte Poststraße 9, 56377 Nassau, Zimmer 1.07',
      residence_type: ['Heim/Einrichtung'],
      planned_housing_changes: 'Die frühere Mietwohnung in der Kurstraße 44 in Bad Ems steht seit der Klinikaufnahme im September 2020 leer und weist einen Rückstand von 2.184 € auf. Eine Rückkehr ist nach übereinstimmender Einschätzung der Fachklinik Eußerthal und des Hauses Lahnblick ausgeschlossen. Die Kündigung und Auflösung der Wohnung ist vorzubereiten und bedarf der Genehmigung des Betreuungsgerichts.',
      housing_notes: 'Das Zimmer 1.07 im Haus Lahnblick ist über einen Aufzug erreichbar. Herr Rothenberg hat einige persönliche Gegenstände mitgebracht; weitere sollen bei der Wohnungsauflösung gesichert werden.',
      treating_doctors: 'Dr. med. Heiko Brandstätter, Allgemeinmedizin (Heimarzt), Bahnhofstraße 5, 56377 Nassau, 02604/970120\nDr. med. Petra Ohlrogge, Neurologie, MVZ Bad Ems, 02603/941800',
      severe_diseases: 'Amnestisches Syndrom durch Alkohol (Korsakow-Syndrom) nach Wernicke-Enzephalopathie im September 2020. Alkoholabhängigkeitssyndrom, gegenwärtig abstinent in beschützender Umgebung. Alkoholische Leberzirrhose Child-Pugh A und Alkohol-Polyneuropathie beider Beine.',
      treatment_care: 'Nach der Akutbehandlung in der Paracelsus-Klinik Bad Ems folgte eine stationäre Entwöhnungsbehandlung in der Fachklinik Eußerthal von November 2020 bis März 2021. Seit dem 26.03.2021 lebt Herr Rothenberg in der sozialtherapeutischen Wohnstätte Haus Lahnblick mit Rund-um-die-Uhr-Assistenz. Medikamentöse Behandlung mit Thiamin und Vitamin-B-Komplex, hausärztliche Betreuung durch Dr. Brandstätter.',
      resources: 'Herr Rothenberg ist freundlich, umgänglich und im Kontakt zugewandt. Handwerkliche Fertigkeiten aus seinem früheren Beruf als Fliesenleger sind erhalten; in der Holzwerkstatt des Hauses arbeitet er konzentriert und mit sichtbarer Freude. Alltagsverrichtungen wie Körperpflege und Ankleiden bewältigt er in strukturierter Umgebung selbstständig. Er hält sich zuverlässig an die Hausregeln und ist seit Oktober 2020 abstinent.',
      impairments: 'Im Vordergrund steht eine ausgeprägte anterograde Amnesie: Neue Informationen werden nach wenigen Minuten nicht mehr erinnert. Die entstehenden Lücken füllt Herr Rothenberg unbewusst mit Konfabulationen, wodurch er im Gespräch orientierter wirkt, als er ist. Termine, Beträge und Vereinbarungen kann er nicht behalten. Eine eigenständige Lebensführung, die Verwaltung von Geld und der Umgang mit Behördenpost sind ihm dauerhaft nicht möglich. Durch die Polyneuropathie besteht zusätzlich ein erhöhtes Sturzrisiko.',
      care_level: '',
      care_allowance: 'nicht beantragt',
      health_notes: 'Ein Pflegegradantrag und ein Antrag auf Feststellung der Schwerbehinderung sind vorzubereiten.',
      relatives: 'Marco Rothenberg (Sohn), Nordring 18, 45894 Gelsenkirchen – kein Kontakt seit 2019\nIlona Rothenberg (geschiedene Ehefrau), Gelsenkirchen – kein Kontakt, Unterhaltsgläubigerin\nWolfgang Rothenberg (Bruder), Gelsenkirchen – Kontakt 2019 abgebrochen',
      family_situation: 'Herr Rothenberg ist seit 2013 geschieden und hat einen erwachsenen Sohn. Zur Familie besteht seit 2019 kein Kontakt; nach Auskunft der Fachklinik war die Alkoholerkrankung der Anlass des Abbruchs. Es bestehen Unterhaltsrückstände gegenüber der geschiedenen Ehefrau aus einem Titel des Amtsgerichts Diez.',
      social_contacts: 'Tragfähige Kontakte bestehen derzeit ausschließlich innerhalb der Einrichtung, insbesondere zur Bezugsassistenz und zu einem Mitbewohner aus der Holzwerkstatt.',
      relationship: 'Das Verhältnis ist freundlich und unbelastet. Herr Rothenberg begrüßt die Betreuungsperson bei jedem Besuch herzlich, erinnert vorangegangene Gespräche jedoch nicht. Informationen werden deshalb bei jedem Besuch erneut mitgeteilt und zusätzlich schriftlich an die Einrichtung übermittelt.',
      social_notes: 'Herr Rothenberg stimmt im Gespräch fast allem zu. Bei Entscheidungen von Gewicht wird deshalb an mehreren Tagen erneut gesprochen, um eine belastbare Willensäußerung zu erhalten.',
      employment_status: 'erwerbsgemindert',
      employer_occupation: 'Bis 31.12.2018 selbstständiger Fliesenlegermeister mit eigenem Betrieb in Bad Ems; seit 01.12.2020 Rente wegen voller Erwerbsminderung',
      daily_life: 'Der Tag ist durch das Haus Lahnblick strukturiert: gemeinsames Frühstück, vormittags Arbeitstherapie in der Holzwerkstatt, Mittagessen, nachmittags Freizeit oder Gruppenangebote. Herr Rothenberg hält den Rhythmus zuverlässig ein und schätzt die Werkstatt besonders.',
      goals: 'Sicherung der beschützenden Wohnform als Grundlage der Abstinenz und der Alltagsbewältigung. Sicherung des Lebensunterhalts durch Grundsicherung ergänzend zur Erwerbsminderungsrente. Auflösung der nicht mehr benötigten Wohnung und Beendigung der doppelten Kostenlast. Ordnung der Verbindlichkeiten aus der gescheiterten Selbstständigkeit. Aufbau einer verlässlichen medizinischen Versorgung, insbesondere hepatologisch.',
      measures: 'Antrag auf Grundsicherung bei Erwerbsminderung vom 12.04.2021. Umwandlung des überzogenen Girokontos in ein Pfändungsschutzkonto. Ermittlung sämtlicher Gläubiger und Kontaktaufnahme zur Schuldnerberatung des Diakonischen Werks. Geplant: Antrag auf Genehmigung der Wohnungskündigung und -auflösung, Antrag auf Pflegeleistungen und auf Feststellung der Schwerbehinderung, Prüfung eines Verbraucherinsolvenzverfahrens.',
      against_will: 'Die beabsichtigte Auflösung der Wohnung entspricht derzeit nicht dem geäußerten Wunsch von Herrn Rothenberg; er möchte die Wohnung behalten. Es wurden bereits zwei Gespräche geführt, ein weiteres sowie ein gemeinsamer Besuch der Wohnung sind vorgesehen, bevor ein Antrag gestellt wird.',
      special_matters: 'Zu klären sind die Steuerschulden aus der Selbstständigkeit, die Beitragsrückstände bei Krankenkasse und Berufsgenossenschaft sowie die Unterhaltsrückstände.',
      goal_notes: 'Vorrang haben die Sicherung der Wohnform und die Beendigung der doppelten Wohnkosten.',
      can_express_wishes: 'bedingt',
      wishes_care: 'Herr Rothenberg wünscht sich, „dass alles wieder in Ordnung kommt", und äußert regelmäßig den Wunsch nach Kontakt zu seinem Sohn. Er möchte in der Holzwerkstatt arbeiten und fragt nach seinem Führerschein.',
      wishes_assets: 'Konkrete Vorstellungen zur Vermögensverwaltung äußert er nicht. Er wünscht sich Geld für Tabak und Kioskeinkäufe und dass „nichts angeschrieben wird".',
      desired_outcome: 'Kontakt zum Sohn, Weiterarbeit in der Werkstatt, ein ruhiges Leben ohne Ärger mit Ämtern.',
      prevent_outcome: 'Er möchte nicht zurück in die Klinik und nicht „auf der Straße landen".',
      unfulfillable_wishes: 'Die Wiedererteilung der Fahrerlaubnis ist wegen des Korsakow-Syndroms medizinisch ausgeschlossen. Der Erhalt der Wohnung ist wirtschaftlich nicht darstellbar und pflegerisch nicht tragfähig.',
      self_managed_assets: 'Herr Rothenberg verwaltet kein Vermögen selbst. Ein Barbetrag wird über die Einrichtung verwahrt und in wöchentlichen Teilbeträgen ausgegeben.',
      first_contact: '2021-04-08',
      contact_count: 3,
      future_contacts: 'alle acht bis zehn Wochen in der Einrichtung, dazwischen telefonisch über die Bezugsassistenz',
      can_initiate_contact: 'bedingt',
      contact_limit_reason: 'Herr Rothenberg besitzt ein Mobiltelefon, kann den Anlass eines Anrufs aber häufig nicht benennen. Verlässlich läuft die Kontaktaufnahme über die Einrichtung.',
      contact_notes: 'Alle Informationen werden zusätzlich schriftlich an die Bezugsassistenz übermittelt.'
    }, '2021-07-02'),

    annual_noassets: L.bericht({
      residence: 'Haus Lahnblick, Alte Poststraße 9, 56377 Nassau, Zimmer 1.07',
      home_placement: 'ja',
      closed_unit: 'nein',
      housing_relinquished: 'ja',
      care_providers: ['Personal des Heims / der Einrichtung', 'Betreuer/in'],
      personal_impression: 'Herr Rothenberg war im Berichtszeitraum durchgehend freundlich, umgänglich und körperlich weitgehend stabil. Der Sturz im Bad am 28.06.2026 hat ihn vorübergehend verunsichert; nach dem Anbringen der Haltegriffe bewegt er sich wieder sicher. Die Abstinenz besteht seit April 2023 ununterbrochen, die Leberwerte sind stabil. In der Holzwerkstatt arbeitet er weiterhin an vier Vormittagen und zeigt seine Arbeiten stolz vor. Die anterograde Amnesie ist unverändert ausgeprägt: Beim Besuch am 28.07.2026 erinnerte er den Besuch vom 19.05.2026 nicht.',
      condition_change: 'nicht verändert',
      care_need: 'weiter erforderlich',
      care_need_reason: 'Das Korsakow-Syndrom führt zu einer dauerhaften anterograden Amnesie. Herr Rothenberg kann Informationen nicht behalten, Termine nicht erinnern und Geldbeträge nicht einordnen. Hinzu kommt eine Konfabulationsneigung, die ihn im Gespräch orientierter erscheinen lässt, als er ist – gerade dies macht ihn im Rechtsverkehr besonders schutzbedürftig, weil er Zustimmung signalisiert, ohne den Gegenstand zu erfassen. Im Berichtszeitraum waren die Verwertung des Fahrzeugs im Insolvenzverfahren, die Vorbereitung des Schlusstermins und die Abstimmung baulicher Maßnahmen nach dem Sturz zu bearbeiten. Eine Besserung ist nach neurologischer Einschätzung nicht zu erwarten. Der Einwilligungsvorbehalt für die Vermögenssorge bleibt erforderlich.',
      last_contact: '2026-07-28',
      contact_frequency: 'vierteljährlich',
      contact_description: 'Im Berichtszeitraum fanden vier persönliche Besuche im Haus Lahnblick statt sowie regelmäßige Telefonate mit der Bezugsassistenz Herrn Kleinschmidt, in der Regel monatlich und anlassbezogen häufiger. Die Gespräche mit Herrn Rothenberg werden in einfacher Sprache geführt, auf ein Thema begrenzt und schriftlich auf einem Zettel festgehalten, den er einsteckt. Dieselbe Information geht zusätzlich an die Bezugsassistenz. Angelegenheiten von Gewicht werden an mehreren Tagen wiederholt erörtert.',
      approx_assets: 'Pfändungsschutzkonto 162,85 € und Barbetragskonto der Einrichtung 94,20 € zum 31.07.2026, Bargeld rund 25 €, persönliche Ausstattung des Zimmers 1.07 rund 420 €. Zur Insolvenztabelle festgestellte Forderungen von 54.041,95 €. Erwerbungen oder Erbschaften gab es nicht; der stillgelegte VW Caddy wurde im Mai 2026 durch die Insolvenzverwaltung verwertet. Als genehmigungspflichtige Handlung war die Zustimmung zu dieser Verwertung erforderlich, genehmigt durch Beschluss des Amtsgerichts Diez vom 28.04.2026; hinzu kam der Antrag auf Befreiung vom persönlichen Erscheinen im Insolvenzschlusstermin vom 22.07.2026.',
      other_report: 'Das Verbraucherinsolvenzverfahren 4 IK 118/23 beim Amtsgericht Montabaur läuft seit dem 06.11.2023. Die dreijährige Abtretungsfrist endet am 06.11.2026, der Schlusstermin ist auf den 19.11.2026 bestimmt. Sämtliche Obliegenheiten wurden erfüllt. Offen ist, ob die Unterhaltsforderung der geschiedenen Ehefrau von 6.840 € nach § 302 Nr. 1 InsO von der Restschuldbefreiung ausgenommen ist; eine Anfrage an die Insolvenzverwaltung ist gestellt. Der Kontakt zum Sohn Marco Rothenberg besteht seit 2024 wieder und hat sich mit zwei bis drei Besuchen jährlich und monatlichen Telefonaten stabilisiert.',
      discussed: 'ja',
      discussed_date: '2026-07-28',
      discussed_reason: '',
      view_contacts: 'Herr Rothenberg freut sich über die Besuche und sagt regelmäßig, es sei „schön, dass Sie da sind". Eine Bewertung der Häufigkeit ist ihm nicht möglich, weil er die vorangegangenen Besuche nicht erinnert.',
      view_goals: 'Auf die Frage nach seinen Zielen nennt Herr Rothenberg die Werkstatt und den Kontakt zu seinem Sohn. Zum Thema Schulden äußerte er beim Besuch am 28.07.2026: „Dann bin ich die los?" und freute sich sichtlich.',
      view_need: 'Herr Rothenberg hält die Betreuung für erforderlich und sagt, er sei froh, dass „sich jemand um den ganzen Papierkram kümmert". Eine vertiefte Auseinandersetzung mit der Frage ist ihm nicht möglich.'
    }, '2026-04-21'),

    court_approval: L.bericht({
      ca_art: 'Genehmigung der Zustimmung zur Verwertung eines Fahrzeugs im Insolvenzverfahren',
      ca_rechtsgrundlage: 'Vermögensangelegenheit (§§ 1848 ff. BGB)',
      ca_vorgang: 'Zustimmung zur freihändigen Verwertung des Personenkraftwagens VW Caddy, amtliches Kennzeichen seit 11/2019 abgemeldet, Erstzulassung 2009, durch die Insolvenzverwalterin Rechtsanwältin Kathrin Vollmer im Verbraucherinsolvenzverfahren 4 IK 118/23 des Amtsgerichts Montabaur. Der geschätzte Verwertungserlös beträgt 620,00 €.',
      ca_wille: 'Einwilligung',
      ca_begruendung: 'Das Fahrzeug steht seit November 2019 stillgelegt bei einem früheren Nachbarn in Bad Ems. Herrn Rothenberg wurde die Fahrerlaubnis im November 2019 entzogen; eine Wiedererteilung ist wegen des Korsakow-Syndroms nach der neurologischen Stellungnahme von Dr. Ohlrogge vom 21.02.2022 medizinisch ausgeschlossen. Das Fahrzeug hat für Herrn Rothenberg keinen Nutzen mehr, verursacht aber Standkosten und verliert weiter an Wert. Es gehört zur Insolvenzmasse; die Verwertung ist ohnehin Aufgabe der Verwalterin. Die Zustimmung erspart eine gerichtliche Auseinandersetzung über die Herausgabe und beschleunigt das Verfahren, dessen Abtretungsfrist am 06.11.2026 endet. Herr Rothenberg wurde am 24.03.2026 und erneut am 28.03.2026 – bewusst an zwei verschiedenen Tagen – über den Vorgang informiert und hat beide Male zugestimmt; beim zweiten Gespräch sagte er von sich aus, er fahre ja doch nicht mehr.',
      ca_ergaenzung: 'Beigefügt: Schreiben der Insolvenzverwaltung vom 18.03.2026, Wertermittlung, neurologische Stellungnahme Dr. Ohlrogge vom 21.02.2022, Vermerk über die beiden Gespräche mit Herrn Rothenberg.'
    }, '2026-03-30'),

    remuneration: L.bericht({
      rem_stage: '2',
      rem_request_type: 'Folgeantrag',
      rem_continuous: 'nein'
    }, '2026-07-13'),

    remuneration_pdf: L.bericht({
      remuneration_pdf_name: 'Dieter Rothenberg',
      remuneration_pdf_birth: '1968-11-05',
      remuneration_pdf_address: 'Alte Poststraße 9, 56377 Nassau',
      remuneration_pdf_reference: '12 XVII 305/21',
      remuneration_pdf_details: 'Vergütungsabschnitt 01.04.2026 bis 30.06.2026. Vergütung nach § 8 VBVG, Vergütungstabelle B (stationäre Einrichtung / gleichgestellte Wohnform), Vergütungsstufe 2, ab dem 25. Monat der Betreuung. Monatliche Pauschale 98,00 €, Abrechnungszeitraum drei Monate, Gesamtbetrag 294,00 €. Herr Rothenberg ist mittellos; die Vergütung wird aus der Staatskasse beantragt. Das laufende Verbraucherinsolvenzverfahren 4 IK 118/23 berührt den Vergütungsanspruch nicht.',
      remuneration_pdf_attachments: 'Bewilligungsbescheid Grundsicherung der Kreisverwaltung Rhein-Lahn-Kreis vom 12.06.2026 (GruSi-RLK 2021/1104), Bescheinigung des Diakonischen Werks Westerwald über die Wohnform vom 02.07.2026.',
      remuneration_pdf_notes: 'Die Wohnform hat sich im Abrechnungszeitraum nicht geändert. Die Vergütung für das Vorquartal ist am 02.05.2026 eingegangen.'
    }, '2026-07-13'),

    sgb12_social_assistance_short: L.bericht({
      sgb12_social_assistance_short_name: 'Dieter Rothenberg',
      sgb12_social_assistance_short_birth: '1968-11-05',
      sgb12_social_assistance_short_address: 'Haus Lahnblick, Alte Poststraße 9, 56377 Nassau',
      sgb12_social_assistance_short_reference: 'GruSi-RLK 2021/1104',
      sgb12_social_assistance_short_benefit: 'Weiterbewilligung der Grundsicherung bei Erwerbsminderung nach dem 4. Kapitel SGB XII',
      sgb12_social_assistance_short_start: '01.07.2027, Bewilligungszeitraum zwölf Monate',
      sgb12_social_assistance_short_household: 'Herr Rothenberg lebt seit dem 26.03.2021 in der sozialtherapeutischen Wohnstätte Haus Lahnblick, Zimmer 1.07. Eine Einstandsgemeinschaft besteht nicht. Er ist geschieden; der erwachsene Sohn lebt in Gelsenkirchen und ist nicht unterhaltspflichtig.',
      sgb12_social_assistance_short_income: 'Rente wegen voller Erwerbsminderung der Deutschen Rentenversicherung Rheinland-Pfalz, Zahlbetrag 742,18 € monatlich (befristet bis 30.11.2027, Weiterbewilligung wird gesondert beantragt). Anerkennungsbetrag aus der Arbeitstherapie in der Holzwerkstatt des Hauses, 52,80 € monatlich. Weitere Einnahmen bestehen nicht.',
      sgb12_social_assistance_short_assets: 'P-Konto bei der Sparkasse Koblenz mit 162,85 € (Stand 31.07.2026), Barbetragskonto der Einrichtung mit 94,20 €. Kein verwertbares Vermögen. Über das Vermögen ist am 06.11.2023 das Verbraucherinsolvenzverfahren eröffnet worden (Amtsgericht Montabaur, 4 IK 118/23); die dreijährige Abtretungsfrist endet am 06.11.2026, der Schlusstermin ist auf den 19.11.2026 bestimmt. Der als Massegegenstand geführte Personenkraftwagen wurde im Mai 2026 verwertet.',
      sgb12_social_assistance_short_needs: 'Amnestisches Syndrom durch Alkohol (Korsakow-Syndrom, F10.6) mit ausgeprägter anterograder Amnesie, alkoholische Leberzirrhose Child-Pugh A, Alkohol-Polyneuropathie, paroxysmales Vorhofflimmern unter Antikoagulation. Pflegegrad 2, Grad der Behinderung 80 mit den Merkzeichen G und B. Eine eigenständige Lebensführung ist dauerhaft ausgeschlossen; die beschützende Wohnform ist nach der neurologischen Stellungnahme von Dr. med. Petra Ohlrogge vom 12.03.2026 weiterhin erforderlich.',
      sgb12_social_assistance_short_notes: 'Beigefügt: Rentenanpassungsmitteilung 07/2027, Kontoauszüge beider Konten der letzten drei Monate, Bescheid über die Eingliederungshilfe (EGH-RLK 2021/2288), Entgeltbescheinigung des Diakonischen Werks Westerwald. Sämtliche Bescheide bitte ausschließlich an die Betreuung senden.'
    }, '2026-08-12'),

    sgb12_asset_declaration: L.bericht({
      sgb12_asset_declaration_name: 'Dieter Rothenberg',
      sgb12_asset_declaration_birth: '1968-11-05',
      sgb12_asset_declaration_address: 'Haus Lahnblick, Alte Poststraße 9, 56377 Nassau',
      sgb12_asset_declaration_reference: 'GruSi-RLK 2021/1104',
      sgb12_asset_declaration_benefit: 'Grundsicherung im Alter und bei Erwerbsminderung',
      sgb12_asset_declaration_start: 'Stichtag 31.07.2026',
      sgb12_asset_declaration_household: 'Alleinstehend, besondere Wohnform des Diakonischen Werks Westerwald gGmbH.',
      sgb12_asset_declaration_income: 'Erwerbsminderungsrente 742,18 €, Anerkennungsbetrag Arbeitstherapie 52,80 €, ergänzende Grundsicherung 396,40 € monatlich.',
      sgb12_asset_declaration_assets: 'Pfändungsschutzkonto DE95 5705 0120 0022 8804 71 bei der Sparkasse Koblenz: 162,85 €. Barbetragskonto der Einrichtung DE60 5735 1030 0000 9413 70: 94,20 €. Bargeld im Zimmer: rund 25,00 €. Persönliche Ausstattung des Zimmers 1.07 (Fernseher, Radio, Kommode), Zeitwert etwa 420,00 €. Kein Grundvermögen, keine Lebens- oder Sterbegeldversicherung, keine Wertpapiere. Der stillgelegte Personenkraftwagen VW Caddy wurde am 15.05.2026 durch die Insolvenzverwaltung verwertet. Das Gesamtvermögen liegt deutlich unterhalb des Schonbetrages nach § 90 Abs. 2 Nr. 9 SGB XII in Verbindung mit der Verordnung zu § 90 Abs. 2 Nr. 9 SGB XII.',
      sgb12_asset_declaration_needs: 'Pflegegrad 2, Grad der Behinderung 80 mit den Merkzeichen G und B.',
      sgb12_asset_declaration_notes: 'Zur Insolvenztabelle festgestellte Forderungen von insgesamt 54.041,95 € (Finanzamt Diez, Techniker Krankenkasse, Sparkasse Koblenz, Berufsgenossenschaft der Bauwirtschaft, Unterhaltsrückstände). Zahlungen an Insolvenzgläubiger erfolgen nicht.'
    }, '2026-08-12'),

    discharge: L.bericht({
      dis_period_from: '2021-04-01',
      dis_period_to: '',
      dis_waiver: '',
      dis_release: '',
      dis_notes: 'Vorbereitender Entwurf für den Fall der Beendigung der Betreuung. Derzeit besteht kein Anlass; die Betreuung wird fortgeführt und ist gerichtlich bis zum 31.03.2028 zu überprüfen. Zu beachten wäre bei einer späteren Beendigung, dass Herr Rothenberg eine Entlastungserklärung wegen des Korsakow-Syndroms nicht wirksam abgeben kann; die Schlussrechnungslegung wäre daher in jedem Fall dem Betreuungsgericht vorzulegen.',
      pdf_0001: 'Amtsgericht Diez',
      pdf_0002: 'Wilhelmstraße 12',
      pdf_0003: '65582 Diez',
      pdf_0004: '12 XVII 305/21',
      pdf_0005: 'Dieter Rothenberg',
      pdf_0006: '05.11.1968',
      pdf_0008: '01.04.2021',
      pdf_0010: 'Christoph Zepp',
      pdf_0011: 'Marktplatz 8, 56346 St. Goarshausen',
      pdf_0012: '06771/959410'
    }, '2026-04-21')
  }
};

/* Faehigkeiten & Alltag: Istzustand je Lebensbereich, Alltagsgestaltung und
   Wunschaeusserung. Grundlage sind Besuche in der Einrichtung, die
   Teilhabedokumentation und die neuropsychologische Testung. */
module.exports.faehigkeiten = L.profil(F, {
  stand: '2026-08-04',
  bereiche: {
    communication: {
      ressourcen: 'Herr Rothenberg spricht flüssig, wortgewandt und humorvoll; im Erstkontakt wirkt er unauffällig und kompetent. Er formuliert Anliegen klar, kann Bedürfnisse benennen und beteiligt sich in der Bewohnerversammlung. Sein Fachwissen aus der Zeit als Elektroinstallateur ist erhalten und er erklärt technische Zusammenhänge korrekt.',
      einschraenkungen: 'Ausgeprägte Konfabulationen: Gedächtnislücken werden ohne Täuschungsabsicht mit erfundenen, in sich stimmigen Inhalten gefüllt. Angaben zu Terminen, Gesprächen und Vereinbarungen sind deshalb nicht belastbar und müssen grundsätzlich gegengeprüft werden. Zugesagtes wird nicht erinnert; Absprachen sind ohne schriftliche Fixierung wirkungslos.',
      quelle: 'Neuropsychologische Testung Klinik Sonnenhalde vom 18.02.2025, Teilhabedokumentation',
      erhoben: '2026-08-04', wiedervorlage: '2027-02-28'
    },
    orientation: {
      ressourcen: 'Zur eigenen Person vollständig orientiert. Im Haus und im nahen Umfeld findet er sich sicher zurecht und geht selbstständig zum Kiosk und zum Bäcker. Der Wochenplan an seiner Zimmertür wird von ihm genutzt und er richtet sich danach.',
      einschraenkungen: 'Schwere Störung des Kurzzeitgedächtnisses und der zeitlichen Orientierung; der aktuelle Wochentag wird häufig falsch benannt, Ereignisse der letzten Tage sind nicht abrufbar. Eine Anosognosie besteht: Er hält sich für weitgehend gesund und die Betreuung für überflüssig, was Entscheidungen zu Wohnform und Finanzen betrifft. Die freie Willensbestimmung ist in diesen Bereichen aufgehoben.',
      bedarfe: ['gdp-r-01'],
      quelle: 'Neuropsychologische Testung 18.02.2025, ärztliches Zeugnis Dr. Ferrand vom 11.05.2026',
      erhoben: '2026-05-11', wiedervorlage: '2027-05-31'
    },
    mobility: {
      ressourcen: 'Gehfähig ohne Hilfsmittel innerhalb des Hauses und im Ortskern. Er nutzt bekannte Wege selbstständig und hält die vereinbarte Rückkehrzeit meist ein. Fahrrad fährt er auf dem Gelände sicher.',
      einschraenkungen: 'Gangunsicherheit bei Ermüdung und leichte Ataxie als Folge der Polyneuropathie; zwei Stürze 2025, seither Haltegriffe und rutschfeste Matte im Bad. Öffentliche Verkehrsmittel nutzt er nur auf bekannten Strecken und verpasst regelmäßig die Umstiege. Eine Fahrerlaubnis besteht seit dem Entzug 2019 nicht mehr; eine Wiedererteilung wird nicht angestrebt.',
      quelle: 'Sturzprotokolle Haus am Mühlbach, Ergotherapiebericht 30.04.2026',
      erhoben: '2026-06-16', wiedervorlage: '2026-08-18'
    },
    health_selfcare: {
      ressourcen: 'Körperpflege und Ankleiden erledigt Herr Rothenberg nach morgendlicher Erinnerung selbstständig. Er isst mit gutem Appetit in der Hausgemeinschaft mit und hat seit 2024 acht Kilogramm zugenommen. Alkoholabstinenz seit dem 14.09.2021, die er selbst mit Stolz benennt. An der Suchtgruppe im Haus nimmt er verlässlich teil.',
      einschraenkungen: 'Die Medikamenteneinnahme ist ohne Stellen und Sichtkontrolle nicht sicher; ohne Erinnerung wird sie schlicht vergessen. Arzttermine kann er nicht selbst organisieren oder erinnern. Wund- und Fußpflege bei diabetischer Polyneuropathie muss angeleitet werden. Zahnstatus saniert 2024 nach jahrelanger Vernachlässigung.',
      quelle: 'Pflegedokumentation Haus am Mühlbach, Hausarztbericht Dr. Ferrand vom 11.05.2026',
      erhoben: '2026-08-04', wiedervorlage: '2026-11-30'
    },
    housing_household: {
      ressourcen: 'Sein Einzelzimmer in der besonderen Wohnform hält Herr Rothenberg mit täglicher Erinnerung in ordentlichem Zustand. Beim wöchentlichen Küchendienst der Wohngruppe arbeitet er zuverlässig mit und übernimmt gern handwerkliche Kleinigkeiten im Haus – Lampen wechseln, Regale montieren –, was ihm sichtbar guttut.',
      einschraenkungen: 'Eine eigene Haushaltsführung ist nicht möglich: Einkauf, Wäsche und Mahlzeiten übernimmt die Einrichtung. Der Versuch des Betreuten Einzelwohnens 2021 scheiterte binnen vier Monaten an Verwahrlosung und erneutem Alkoholkonsum. Herd und offenes Feuer sind wegen der Vergesslichkeit nicht zugänglich. Die frühere Mietwohnung in Boppard wurde 2021 aufgelöst.',
      bedarfe: ['gdp-r-01'],
      quelle: 'Teilhabedokumentation Haus am Mühlbach, Betreuerbericht 2026',
      erhoben: '2026-08-04', wiedervorlage: '2027-04-30'
    },
    daily_social: {
      ressourcen: 'In der Wohngruppe gut integriert; zu zwei Mitbewohnern besteht ein freundschaftlicher Kontakt mit gemeinsamen Spaziergängen und Kartenspiel. Zur Bezugsbetreuerin Frau Adamczyk hat er ein tragfähiges Verhältnis. Der Sohn meldet sich seit 2024 wieder etwa vierteljährlich telefonisch, was Herr Rothenberg als das Wichtigste in seinem Leben bezeichnet. An Hausfesten nimmt er gern teil.',
      einschraenkungen: 'Verabredungen außerhalb des Hauses vergisst er regelmäßig, was zu Enttäuschungen auf beiden Seiten führt. Neue Kontakte hält er nicht über längere Zeit. Zur früheren Partnerin und zum Bruder besteht kein Kontakt mehr. Bei Kritik reagiert er gereizt und zieht sich für einige Stunden zurück.',
      bedarfe: [],
      quelle: 'Teilhabedokumentation, Gespräch mit der Bezugsbetreuung vom 04.08.2026',
      erhoben: '2026-08-04', wiedervorlage: '2026-12-31'
    },
    work_education: {
      ressourcen: 'Ausgebildeter Elektroinstallateur mit Gesellenbrief von 1988 und zwanzig Jahren Berufserfahrung; das Fachwissen ist erhalten und praktisch abrufbar. In der Tagesstruktur der Einrichtung arbeitet er vier Vormittage in der Woche in der Holzwerkstatt und fertigt dort Vogelhäuser und Nistkästen für den Weihnachtsmarkt.',
      einschraenkungen: 'Eine Tätigkeit auf dem allgemeinen Arbeitsmarkt ist wegen der Gedächtnisstörung ausgeschlossen; Arbeitsaufträge müssen kleinschrittig und wiederholt gegeben werden. Auch eine Beschäftigung in der Werkstatt für behinderte Menschen wurde 2022 geprüft und wegen der fehlenden Merkfähigkeit als nicht tragfähig eingeschätzt. Erwerbsminderungsrente auf Dauer, befristet bis 30.09.2027.',
      bedarfe: ['gdp-r-08'],
      quelle: 'Stellungnahme Werkstatt 2022, Tagesstrukturbericht vom 30.06.2026',
      erhoben: '2026-07-02', wiedervorlage: '2027-01-31'
    },
    authorities_law: {
      ressourcen: 'Herr Rothenberg legt eingehende Post ungeöffnet in eine dafür eingerichtete Ablage und übergibt sie beim Besuch vollständig. Bei Terminen mit der Insolvenzverwalterin ist er anwesend, verhält sich kooperativ und unterschreibt nach Erläuterung.',
      einschraenkungen: 'Inhalte und Folgen von Schreiben werden weder erfasst noch behalten; er berichtet in gutem Glauben Falsches über den Stand von Verfahren. Fristen kann er nicht wahren. Das Verbraucherinsolvenzverfahren wird vollständig durch den Betreuer geführt. Für die Vermögenssorge besteht seit 2021 ein Einwilligungsvorbehalt.',
      quelle: 'Betreuerbericht 2026, Beschluss AG St. Goar vom 19.10.2021',
      erhoben: '2026-08-04', wiedervorlage: '2026-10-15'
    },
    finance_assets: {
      ressourcen: 'Das wöchentliche Taschengeld von 35 € nimmt Herr Rothenberg freitags in der Verwaltung entgegen und teilt es sich über die Woche überwiegend gut ein. Er kennt den Betrag, fragt ihn zuverlässig ab und akzeptiert die Regelung ohne Streit.',
      einschraenkungen: 'Ein Überblick über Einkünfte, Barbetrag und Verbindlichkeiten besteht nicht; die Insolvenz und ihre Bedeutung erinnert er nicht dauerhaft. Vor Betreuungsbeginn entstanden Schulden von rund 38.000 €, unter anderem durch Kredite, die er auf Zuruf Dritter unterschrieb. Nach Restschuldbefreiung besteht diese Gefährdung unverändert fort, weshalb der Einwilligungsvorbehalt notwendig bleibt.',
      bedarfe: [],
      quelle: 'Rechnungslegung 2025, Bericht der Insolvenzverwalterin vom 12.06.2026',
      erhoben: '2026-08-04', wiedervorlage: '2027-06-30'
    }
  },
  alltag: {
    zusammenfassung: 'Herr Rothenberg lebt seit Januar 2022 in der besonderen Wohnform Haus am Mühlbach in Emmelshausen. Sein Alltag ist durch die Tagesstruktur der Einrichtung getragen; innerhalb dieses Rahmens bewegt er sich weitgehend selbstständig und zufrieden. Die Struktur ersetzt das, was das Gedächtnis nicht mehr leistet – ohne sie bricht die Alltagsbewältigung innerhalb weniger Tage zusammen, wie der gescheiterte Versuch des Einzelwohnens 2021 gezeigt hat.',
    tagesablauf: 'Wecken 6:45 Uhr, Frühstück in der Wohngruppe um 7:30 Uhr mit Ausgabe der gestellten Morgenmedikation. Montags bis donnerstags 9:00 bis 12:00 Uhr Holzwerkstatt. Mittagessen 12:30 Uhr, danach Mittagspause. Nachmittags Spaziergang, Kartenspiel oder Einkauf am Kiosk. Freitags Taschengeldausgabe und Suchtgruppe um 16:00 Uhr. Abendessen 18:00 Uhr, Abendmedikation 20:00 Uhr, Zubettgehen gegen 22:00 Uhr.',
    haushalt: 'Das eigene Zimmer räumt er nach täglicher Erinnerung auf; die Grundreinigung übernimmt der Hauswirtschaftsdienst wöchentlich. Wäsche wird von der Einrichtung gewaschen. Am Küchendienst der Wohngruppe nimmt er einmal wöchentlich teil und deckt zuverlässig ein. Selbstständiges Kochen findet nicht statt.',
    selbstversorgung: 'Körperpflege nach Erinnerung selbstständig, Duschen an drei Tagen der Woche. Medikamente werden gestellt und die Einnahme sichtkontrolliert. Fußpflege bei diabetischer Polyneuropathie alle sechs Wochen durch die Podologie. Ernährung über die Gemeinschaftsverpflegung, Gewicht stabil bei 79 kg. Alkoholabstinenz seit September 2021.',
    beschaeftigung: 'Holzwerkstatt der Einrichtung an vier Vormittagen wöchentlich. Suchtgruppe freitags. Einmal monatlich Ausflug der Wohngruppe. Gelegentliche handwerkliche Hilfsdienste im Haus, die ihm besonders wichtig sind. Fernsehen und Kartenspiel als Abendbeschäftigung.',
    teilhabe: 'Freundschaftlicher Kontakt zu zwei Mitbewohnern. Vierteljährliche Telefonate mit dem Sohn, ein Besuch im Jahr 2025 nach fünf Jahren ohne Kontakt. Teilnahme an Hausfesten und am jährlichen Ausflug. Kontakt zum Kiosk am Ort, wo er bekannt ist. Kein Vereinsleben.',
    unterstuetzung: 'Besondere Wohnform mit Rund-um-die-Uhr-Betreuung (Haus am Mühlbach, Bezugsbetreuung Frau Adamczyk), Eingliederungshilfe nach §§ 90 ff. SGB IX. Tagesstruktur mit Holzwerkstatt. Suchtgruppe im Haus. Hausärztliche Versorgung Dr. Ferrand mit monatlicher Visite. Podologie sechswöchentlich. Rechtliche Betreuung mit monatlichem Besuch.',
    quelle: 'Teilhabedokumentation, Besuch in der Einrichtung am 04.08.2026',
    erhoben: '2026-08-04', wiedervorlage: '2027-03-31'
  },
  wunsch: {
    status: 'bedingt',
    begruendung: 'Wünsche des Alltags äußert Herr Rothenberg klar und beständig: Verbleib in der Wohngruppe, Arbeit in der Holzwerkstatt, Kontakt zum Sohn. Bei Fragen mit längerer Tragweite ist die Äußerung nicht belastbar, weil er den zugrunde liegenden Sachverhalt nicht erinnert und Lücken konfabulatorisch füllt; auf dieselbe Frage folgen an verschiedenen Tagen unterschiedliche Antworten. Wiederholt geäußerte, über Monate stabile Wünsche werden deshalb höher gewichtet als Einzeläußerungen.',
    unterstuetzung: 'Fragen schriftlich vorlegen und im Beisein der Bezugsbetreuung besprechen; das Ergebnis im Protokoll festhalten und beim nächsten Termin erneut vorlesen. Bedeutsame Fragen an mindestens zwei verschiedenen Terminen stellen und die Antworten vergleichen. Keine Entscheidungen im Anschluss an belastende Nachrichten.',
    wege: ['spoken', 'simple_language', 'third_party'],
    quelle: 'Besuche 2025 und 2026, neuropsychologische Testung vom 18.02.2025',
    erhoben: '2026-08-04', wiedervorlage: '2027-03-31'
  },
  verlauf: [
    ['2025-02-20', 'Profil erstmals angelegt (nach neuropsychologischer Testung)'],
    ['2025-09-08', 'Bereich „Mobilität" nach zwei Stürzen aktualisiert'],
    ['2026-05-11', 'Bereich „Orientierung und Entscheidungsfindung" nach ärztlichem Zeugnis fortgeschrieben'],
    ['2026-08-04', 'Gesamtprofil zur Fortschreibung des Gesamtplans überprüft']
  ]
});
