'use strict';
/* Demonstrationsfall 4 - Halina Nowak.
   Profil: 68 Jahre, primaer progrediente Multiple Sklerose, eigene barrierefreie
   Wohnung mit Assistenz, Pflegegrad 3, GdB 100 (aG, H, B, RF), Witwe seit 2024
   mit Erbfall und Grundstueck, Betreuung seit 2023 - der Fall mit Erbschaft,
   Wohnungsanpassung und voll erhaltener Entscheidungsfaehigkeit. */

const L = require('./lib');
const F = 'n';

const person = {
  salutation: 'Frau', title: '', gender: 'weiblich',
  firstName: 'Halina', lastName: 'Nowak', birthName: 'Wisniewska',
  birthDate: '30.06.1957', birthPlace: 'Wrocław', birthCountry: 'Polen',
  nationality: 'deutsch', nationality2: 'polnisch',
  maritalStatus: 'verwitwet', maritalSince: '08.11.2024',
  religion: 'römisch-katholisch',
  street: 'Blücherstraße', streetOnly: 'Blücherstraße', house: '62', houseNumber: '62', houseLetter: '',
  postal: '56073', postalCode: '56073', city: 'Koblenz', postbox: '', country: 'Deutschland',
  foreignCity: '',
  address: 'Blücherstraße 62, 56073 Koblenz',
  institution: '',
  phone: '0261/4471290', mobile: '0170/22885614', email: 'h.nowak57@example-mail.de', fax: '',
  idCardNumber: 'N9W4H2LKC', residencePermitNumber: '',
  taxId: '55 118 640 227', pensionInsuranceNumber: '61 300657 N 118',
  contributionNumber: 'DAK 6402-300-657', socialOfficeNumber: 'SA-KO 2023/5514',
  fullName: 'Halina Nowak'
};

const care = {
  authorityName: 'Betreuungsbehörde der Stadt Koblenz',
  authorityCity: 'Koblenz',
  authorityFileNumber: 'BtB-KO 2023/0771',
  courtName: 'Amtsgericht Koblenz',
  courtStreet: 'Karmeliterstraße 14', courtPostbox: '', courtPostal: '56068', courtCity: 'Koblenz',
  courtAddressComplete: 'True',
  courtAddressSource: 'Justizportal Rheinland-Pfalz, geprüft 21.01.2026',
  courtVerificationStatus: 'verified',
  courtVerificationCheckedAt: '2026-01-21T10:18:00.000Z',
  fileNumber: '2 XVII 431/23',
  requestDate: '06.02.2023',
  preliminaryOrderDate: '',
  orderDate: '17.04.2023',
  officeHandoverDate: '20.04.2023',
  startDate: '21.04.2023',
  takeoverDate: '21.04.2023',
  handoverDate: '',
  reportPeriod: '01.05. - 30.04.',
  reviewDate: '20.04.2030',
  endDate: '',
  homePlacement: 'nein',
  nextAccountingDue: '31.05.2027',
  taskAreaDetails: [
    { name: 'Vermögenssorge', consentReservation: false },
    { name: 'Gesundheitssorge', consentReservation: false },
    { name: 'Wohnungsangelegenheiten', consentReservation: false },
    { name: 'Vertretung gegenüber Behörden, Versicherungen, Renten- und Sozialleistungsträgern', consentReservation: false },
    { name: 'Geltendmachung von Ansprüchen auf Sozialleistungen', consentReservation: false },
    { name: 'Post- und Fernmeldeangelegenheiten', consentReservation: false }
  ]
};
care.taskAreas = care.taskAreaDetails.map((t) => t.name);

const healthInfo = {
  insurance: 'DAK-Gesundheit',
  insuranceNumber: 'D640230065',
  careLevel: '3',
  bloodType: 'AB-',
  allergies: 'Latex (Kontaktekzem), Sulfonamide (Exanthem)',
  diagnosesNotes: 'Frau Nowak ist uneingeschränkt einwilligungsfähig und trifft alle Entscheidungen selbst. Die Betreuung ist wegen der körperlichen Einschränkungen und des Schreibvermögens eingerichtet, nicht wegen einer Beeinträchtigung der Willensbildung. Absprachen sind ausnahmslos verlässlich.',
  diagnoses: [
    { icd: 'G35.20', text: 'Multiple Sklerose, primär progredienter Verlauf, EDSS 7,0', since: '2009-03-17' },
    { icd: 'N31.9', text: 'Neurogene Blasenentleerungsstörung, intermittierender Selbstkatheterismus', since: '2016-08-04' },
    { icd: 'M62.50', text: 'Muskelatrophie und Spastik der unteren Extremitäten', since: '2014-05-19' },
    { icd: 'F32.1', text: 'Mittelgradige depressive Episode (rezidivierend, zuletzt 12/2024)', since: '2018-02-06' },
    { icd: 'K59.00', text: 'Chronische Obstipation bei neurogener Darmstörung', since: '2017-01-23' },
    { icd: 'L89.13', text: 'Dekubitus Grad 2 Steißbein, abgeheilt 04/2025', since: '2025-01-28' },
    { icd: 'H47.01', text: 'Zustand nach Optikusneuritis rechts mit Restvisusminderung', since: '2009-03-17' }
  ],
  medications: [
    { name: 'Ocrelizumab (Infusion)', dose: '600 mg', schedule: 'alle 6 Monate als Infusion in der Tagesklinik' },
    { name: 'Baclofen', dose: '25 mg', schedule: '1-1-1' },
    { name: 'Tizanidin', dose: '2 mg', schedule: '0-0-1' },
    { name: 'Duloxetin', dose: '60 mg', schedule: '1-0-0' },
    { name: 'Macrogol', dose: '1 Beutel', schedule: '1-0-0' },
    { name: 'Colecalciferol', dose: '2000 I.E.', schedule: '1-0-0' },
    { name: 'Ibuprofen', dose: '400 mg', schedule: 'bei Bedarf, maximal 3x täglich' }
  ],
  doctors: [
    { name: 'Prof. Dr. med. Katharina Reisinger', field: 'Neurologie, MS-Ambulanz', phone: '0261/4962880', email: 'ms-ambulanz@gk-mittelrhein.de' },
    { name: 'Dr. med. Bernd Sauerwein', field: 'Allgemeinmedizin (Hausarzt)', phone: '0261/3374120', email: 'praxis@sauerwein-koblenz.de' },
    { name: 'Dr. med. Anette Kilian', field: 'Urologie', phone: '0261/9928140', email: 'urologie@mvz-rhein-mosel.de' },
    { name: 'Dr. med. Jürgen Petrasch', field: 'Psychiatrie und Psychotherapie', phone: '0261/1330880', email: 'praxis@petrasch-koblenz.de' },
    { name: 'Melanie Görtz', field: 'Physiotherapie (Bobath, Hausbesuche)', phone: '0261/4478812', email: 'praxis@physio-goertz.de' }
  ],
  emergency: [
    { name: 'Agnieszka Bauer', relation: 'Schwester', phone: '0221/8841207', email: 'a.bauer@example-mail.de' },
    { name: 'Pflegedienst Rhein-Mosel – Rufbereitschaft', relation: 'Ambulanter Pflegedienst', phone: '0261/9042100', email: 'einsatzleitung@pflege-rhein-mosel.de' },
    { name: 'Christoph Zepp', relation: 'Rechtliche Betreuung', phone: '06771/959410', email: 'kanzlei@testbueroname.de' }
  ],
  appointments: [
    { id: L.id('hia', F, 1), doctor: 'Prof. Dr. Reisinger', reason: 'Ocrelizumab-Infusion, MS-Verlaufskontrolle', from: '2026-01-27', to: '', note: 'EDSS 7,0 unverändert. Kein Schub seit 2023.', recommendation: 'Nächste Infusion 07/2026' },
    { id: L.id('hia', F, 2), doctor: 'Dr. Kilian', reason: 'Urologische Kontrolle, Harnwegsinfektprophylaxe', from: '2026-02-24', to: '', note: 'Zwei Infekte im Vorjahr, Restharn unauffällig.', recommendation: 'Katheterschulung auffrischen, Trinkmenge' },
    { id: L.id('hia', F, 3), doctor: 'Dr. Petrasch', reason: 'Psychiatrische Verlaufskontrolle nach Trauerreaktion', from: '2026-03-17', to: '', note: 'Deutliche Besserung gegenüber 12/2024. Duloxetin unverändert.', recommendation: 'Kontrolle in sechs Monaten' },
    { id: L.id('hia', F, 4), doctor: 'Dr. Sauerwein', reason: 'Hausbesuch, Hilfsmittelverordnung Elektrorollstuhl', from: '2026-04-08', to: '', note: 'Verordnung für die Neuversorgung ausgestellt.', recommendation: 'Antrag bei der DAK' },
    { id: L.id('hia', F, 5), doctor: 'Prof. Dr. Reisinger', reason: 'Ocrelizumab-Infusion', from: '2026-07-21', to: '', note: 'Infusion komplikationslos, Fahrdienst über die Krankenkasse.', recommendation: 'Nächste Infusion 01/2027' },
    { id: L.id('hia', F, 6), doctor: 'Melanie Görtz', reason: 'Physiotherapie nach Bobath, Hausbesuch', from: '2026-08-10', to: '', note: 'Zweimal wöchentlich, Transfertraining und Kontrakturprophylaxe.', recommendation: 'Folgeverordnung anfordern' }
  ],
  hospital: [
    { id: L.id('hih', F, 1), clinic: 'Gemeinschaftsklinikum Mittelrhein, Neurologie Koblenz', reason: 'Erstdiagnose Multiple Sklerose nach Optikusneuritis', from: '2009-03-17', to: '2009-03-28', note: 'Vor Einrichtung der Betreuung.', recommendation: 'Verlaufskontrolle in der MS-Ambulanz' },
    { id: L.id('hih', F, 2), clinic: 'Gemeinschaftsklinikum Mittelrhein, Urologie', reason: 'Urosepsis bei komplizierter Harnwegsinfektion', from: '2023-08-14', to: '2023-08-27', note: 'Erster größerer Vorfall nach Betreuungsbeginn. Auslöser: unzureichende Katheterhygiene bei fehlender Assistenz.', recommendation: 'Ambulanter Pflegedienst, Katheterschulung' },
    { id: L.id('hih', F, 3), clinic: 'MEDIAN Reha-Zentrum Bad Salzig, Neurologie', reason: 'Neurologische Rehabilitation (Phase D)', from: '2024-02-05', to: '2024-03-18', note: 'Verbesserung der Transferfähigkeit, Anpassung des Rollstuhls.', recommendation: 'Wohnraumanpassung, Assistenz im Alltag' },
    { id: L.id('hih', F, 4), clinic: 'Gemeinschaftsklinikum Mittelrhein, Chirurgie', reason: 'Dekubitus Grad 2 Steißbein, chirurgisches Débridement', from: '2025-02-03', to: '2025-02-11', note: 'Entstanden nach längerer Sitzdauer bei defektem Rollstuhlkissen.', recommendation: 'Neue Sitzkissenversorgung, Lagerungsplan' },
    { id: L.id('hih', F, 5), clinic: 'Katholisches Klinikum Koblenz-Montabaur, Innere Medizin', reason: 'Pyelonephritis rechts', from: '2025-10-19', to: '2025-10-26', note: 'Antibiotische Therapie, komplikationsloser Verlauf.', recommendation: 'Infektprophylaxe, urologische Kontrolle' }
  ],
  procedures: [
    { id: L.id('hip', F, 1), procedure: 'Anpassung Elektrorollstuhl mit Sitzkantelung', doctor: 'Sanitätshaus Vitalis Koblenz', from: '2024-04-22', to: '2024-06-10', note: 'Kostenübernahme DAK nach Widerspruch; Eigenanteil 0 €.', recommendation: 'Jährliche Wartung, Sitzkissen alle zwei Jahre' },
    { id: L.id('hip', F, 2), procedure: 'Wohnraumanpassung: bodengleiche Dusche, Türverbreiterungen, Rampe', doctor: 'Handwerksbetrieb Lehnert GmbH', from: '2024-09-02', to: '2024-11-15', note: 'Zuschuss der Pflegekasse 4.180 €, Restkosten aus dem Nachlass.', recommendation: 'Abnahme durch die Wohnberatung erfolgt' },
    { id: L.id('hip', F, 3), procedure: 'Chirurgisches Débridement Dekubitus Steißbein', doctor: 'Gemeinschaftsklinikum Mittelrhein', from: '2025-02-04', to: '2025-02-04', note: 'Einwilligung durch Frau Nowak selbst.', recommendation: 'Wundmanagement über den Pflegedienst' },
    { id: L.id('hip', F, 4), procedure: 'Neuversorgung Sitzkissen (Wechseldruck)', doctor: 'Sanitätshaus Vitalis Koblenz', from: '2025-03-11', to: '2025-03-25', note: 'Nach dem Dekubitus, Kostenübernahme DAK.', recommendation: 'Kontrolle der Passform halbjährlich' },
    { id: L.id('hip', F, 5), procedure: 'Ocrelizumab-Infusionstherapie (laufend)', doctor: 'Prof. Dr. Reisinger', from: '2019-05-14', to: '', note: 'Halbjährliche Infusion in der neurologischen Tagesklinik.', recommendation: 'Fortführung, Immunstatus vor jeder Gabe' }
  ]
};

const schulden = [
  L.schuld(F, 1, {
    erfasstAm: '2023-05-30', forderungsbeginn: '2022-11-01',
    glaeubiger: 'Evangelisches Stift St. Martin (Klinikrechnung)', kategorie: 'Zuzahlungen bei Arzt-/Zahnarztbesuchen',
    aktenzeichen: 'KR-2022-88147', hauptforderung: 428.6, mahnkosten: 12,
    status: 'erledigt', basisGezahlt: 440.6, erledigtAm: '2023-09-15',
    notizen: 'Krankenhauszuzahlungen 2022, vor Betreuungsbeginn nicht bearbeitet. Nach Zuzahlungsbefreiung Erstattung eines Teilbetrages erwirkt.'
  }),
  L.schuld(F, 2, {
    erfasstAm: '2023-05-30', forderungsbeginn: '2021-01-01',
    glaeubiger: 'Sanitätshaus Vitalis Koblenz GmbH', kategorie: 'Heil- und Hilfsmittel (Schuhe, Orthesen, Rollator etc.)',
    aktenzeichen: 'VIT-2021-4407', hauptforderung: 1284.5, mahnkosten: 24,
    ratenhoehe: 100, ratenintervall: 'monatlich', status: 'erledigt',
    basisGezahlt: 1308.5, erledigtAm: '2024-12-20',
    notizen: 'Eigenanteile für Hilfsmittel aus den Jahren 2021 und 2022. Ratenzahlung ab 07/2023, nach dem Erbfall vollständig getilgt.'
  }),
  L.schuld(F, 3, {
    erfasstAm: '2024-12-04', forderungsbeginn: '2024-11-08',
    glaeubiger: 'Bestattungshaus Sander, Koblenz', kategorie: 'Bestattungsvorsorge / Bestattungskosten',
    aktenzeichen: 'BS-2024-1188', hauptforderung: 5240.0, mahnkosten: 0,
    status: 'erledigt', basisGezahlt: 5240, erledigtAm: '2025-01-31',
    notizen: 'Bestattungskosten für den verstorbenen Ehemann Andrzej Nowak. Als Erbin und Totenfürsorgeberechtigte getragen; aus dem Nachlass beglichen.'
  }),
  L.schuld(F, 4, {
    erfasstAm: '2025-06-17', forderungsbeginn: '2025-05-01',
    glaeubiger: 'Handwerksbetrieb Lehnert GmbH', kategorie: 'Renovierung / Schönheitsreparaturen',
    aktenzeichen: 'LH-2024-2290', hauptforderung: 3860.0, mahnkosten: 0,
    ratenhoehe: 400, ratenintervall: 'monatlich', status: 'Ratenzahlung',
    dauerauftrag: true, basisGezahlt: 1200,
    bankverbindung: { iban: 'DE31 5705 0120 0000 2290 14', bic: 'MALADE51KOB', kontoinhaber: 'Lehnert GmbH' },
    verwendungszweck: 'LH-2024-2290 Wohnraumanpassung Nowak',
    raten: [['2025-07-05', 400], ['2025-08-05', 400], ['2025-09-05', 400]],
    notizen: 'Restkosten der Wohnraumanpassung nach Abzug des Pflegekassenzuschusses von 4.180 €. Ratenvereinbarung, Restbetrag wird nach dem Grundstücksverkauf abgelöst.'
  }),
  L.schuld(F, 5, {
    erfasstAm: '2025-03-12', forderungsbeginn: '2024-11-08',
    glaeubiger: 'Finanzamt Koblenz', kategorie: 'Steuerschulden (Finanzamt)',
    aktenzeichen: '22/118/64027', hauptforderung: 940.0, mahnkosten: 0,
    status: 'erledigt', basisGezahlt: 940, erledigtAm: '2025-05-28',
    notizen: 'Einkommensteuernachzahlung für 2024 (Zusammenveranlagung im Todesjahr des Ehemannes). Aus dem Nachlass beglichen.'
  })
];

module.exports = {
  label: 'Nowak, Halina',
  fileNumber: '2 XVII 431/23',
  createdAt: '2023-04-21 10:15:00',
  betreuer: 'christoph zepp',
  uebersicht: { periodStart: '2026-07-01', aenderungsart: 'unverändert fortgeführt', uebergabeAn: '' },
  kontaktmonitor: { turnusDays: 60, baseline: '2026-06-24', lastContact: '2026-08-13', lastArt: 'persönlich (Hausbesuch)' },

  stammdaten: {
    person,
    care,
    rechtlicherBetreuer: 'christoph zepp',
    health: {
      careLevel: '3', disabilityDegree: '100',
      marks: ['G', 'aG', 'H', 'B', 'RF'], marksText: 'G, aG, H, B, RF',
      copayExemption: 'ja, chronisch krank, 1 % der Bruttoeinnahmen', valueMark: 'ja',
      insurer: 'DAK-Gesundheit', insuranceNumber: 'D640230065'
    },
    healthInfo,
    benefits: [
      { category: 'Rente', basis: 'SGB VI', benefitName: 'Rente wegen voller Erwerbsminderung, unbefristet', applicationDate: '11.09.2014', validUntil: 'unbefristet', provider: 'Deutsche Rentenversicherung Rheinland-Pfalz', fileNumber: '61 300657 N 118' },
      { category: 'Rente', basis: 'SGB VI', benefitName: 'Große Witwenrente', applicationDate: '02.12.2024', validUntil: 'unbefristet', provider: 'Deutsche Rentenversicherung Bund', fileNumber: '61 300657 N 118 W' },
      { category: 'Pflege', basis: 'SGB XI', benefitName: 'Pflegegeld und Pflegesachleistung (Kombinationsleistung), Pflegegrad 3', applicationDate: '18.07.2023', validUntil: 'unbefristet', provider: 'DAK-Gesundheit Pflegekasse', fileNumber: 'PK-D640230065' },
      { category: 'Pflege', basis: 'SGB XI', benefitName: 'Zuschuss zur wohnumfeldverbessernden Maßnahme (4.180 €)', applicationDate: '15.05.2024', validUntil: 'verbraucht', provider: 'DAK-Gesundheit Pflegekasse', fileNumber: 'WUM-2024-8814' },
      { category: 'Eingliederungshilfe', basis: 'SGB IX (Teil 2)', benefitName: 'Assistenzleistungen zur Teilhabe am gemeinschaftlichen und kulturellen Leben, 6 Stunden wöchentlich', applicationDate: '09.09.2024', validUntil: '31.08.2027', provider: 'Stadtverwaltung Koblenz, Amt für Soziales – Eingliederungshilfe', fileNumber: 'EGH-KO 2024/3390' },
      { category: 'Schwerbehindertenrecht', basis: 'SGB IX', benefitName: 'GdB 100, Merkzeichen G, aG, H, B und RF', applicationDate: '04.03.2015', validUntil: 'unbefristet', provider: 'Landesamt für Soziales, Jugend und Versorgung Koblenz', fileNumber: 'SB 2015/64 118' },
      { category: 'Rundfunk', basis: 'RBStV', benefitName: 'Befreiung vom Rundfunkbeitrag (Merkzeichen RF)', applicationDate: '22.03.2015', validUntil: 'unbefristet', provider: 'ARD ZDF Deutschlandradio Beitragsservice', fileNumber: '660 224 015' },
      { category: 'Mobilität', basis: 'SGB IX', benefitName: 'Wertmarke zur unentgeltlichen Beförderung, unentgeltlich bei Merkzeichen aG', applicationDate: '04.03.2015', validUntil: '28.02.2027', provider: 'Landesamt für Soziales, Jugend und Versorgung Koblenz', fileNumber: 'WM 2015/64 118' }
    ],
    identifiers: [
      { type: 'Personalausweis', number: 'N9W4H2LKC', validUntil: '15.11.2029', status: 'gültig' },
      { type: 'Steuerliche Identifikationsnummer', number: '55 118 640 227', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Rentenversicherungsnummer', number: '61 300657 N 118', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Krankenversichertennummer', number: 'D640230065', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Schwerbehindertenausweis', number: 'SB 2015/64 118', validUntil: 'unbefristet', status: 'gültig' },
      { type: 'Kunden-/Mitgliedsnummer', number: '660 224 015', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Aktenzeichen / Geschäftszeichen', number: 'EGH-KO 2024/3390', validUntil: '31.08.2027', status: 'aktiv' },
      { type: 'Aktenzeichen / Geschäftszeichen', number: 'VI 882/24 (Nachlassgericht Koblenz)', validUntil: '', status: 'aktiv' },
      { type: 'Reisepass', number: 'D9W22H140', validUntil: '04.05.2028', status: 'gültig' }
    ],
    insurances: [
      { type: 'Gesundheitsversicherung (gesetzlich)', institution: 'DAK-Gesundheit', number: 'D640230065', details: 'Pflichtversichert als Rentnerin, chronisch krank (Belastungsgrenze 1 %)' },
      { type: 'Pflegezusatzversicherung', institution: 'DAK-Gesundheit Pflegekasse', number: 'PK-D640230065', details: 'Pflegegrad 3 seit 01.08.2023, Kombinationsleistung 60 % Sachleistung / 40 % Pflegegeld' },
      { type: 'Privathatfplicht', institution: 'Nürnberger Versicherung', number: 'PHV 2290-6402', details: 'Jahresbeitrag 84,60 €, fällig 01.02.' },
      { type: 'Hausratversicherung', institution: 'Nürnberger Versicherung', number: 'HRV 2290-6403', details: 'Versicherungssumme 42.000 €, Jahresbeitrag 118,40 €' },
      { type: 'Rechtschutzversicherung', institution: 'ADVOCARD Rechtsschutzversicherung', number: 'RS 6402-1188', details: 'Verkehrs- und Sozialrechtsschutz, Jahresbeitrag 214,80 €. Wurde beim Widerspruch gegen die Rollstuhlablehnung in Anspruch genommen.' },
      { type: 'Lebensversicherung', institution: 'Allianz Lebensversicherungs-AG', number: 'LV 88 402 1157', details: 'Kapitallebensversicherung des verstorbenen Ehemannes, Auszahlung 18.420 € am 14.01.2025' },
      { type: 'Sterbegeldversicherung', institution: 'LV 1871', number: 'STG 6402-9915', details: 'Versicherungssumme 8.000 €, laufender Beitrag 24,80 € monatlich' }
    ],
    banks: [
      { type: 'Girokonto', institution: 'Sparkasse Koblenz', bankName: 'Sparkasse Koblenz', iban: 'DE24 5705 0120 0064 0230 65', bic: 'MALADE51KOB', accountHolder: 'Halina Nowak', saldo: '2418,66', saldoDatum: '31.07.2026', verwendungszweck: 'Verwaltungskonto der Betreuung, laufende Zahlungen', connectionId: '' },
      { type: 'Tagesgeldkonto', institution: 'Sparkasse Koblenz', bankName: 'Sparkasse Koblenz', iban: 'DE96 5705 0120 0064 0230 66', bic: 'MALADE51KOB', accountHolder: 'Halina Nowak', saldo: '14280,00', saldoDatum: '31.07.2026', verwendungszweck: 'Nachlass Ehemann, Rücklage für Hilfsmittel und Umbau', connectionId: '' },
      { type: 'Sparkonto', institution: 'Volksbank RheinAhrEifel', bankName: 'Volksbank RheinAhrEifel eG', iban: 'DE58 5776 1591 0022 9014 88', bic: 'GENODED1BNA', accountHolder: 'Halina Nowak', saldo: '3100,00', saldoDatum: '31.07.2026', verwendungszweck: 'Altbestand, Rücklage Bestattung', connectionId: '' },
      { type: 'Girokonto', institution: 'Sparkasse Koblenz', bankName: 'Sparkasse Koblenz', iban: 'DE77 5705 0120 0088 4712 09', bic: 'MALADE51KOB', accountHolder: 'Andrzej Nowak (Nachlasskonto)', saldo: '0,00', saldoDatum: '28.02.2025', verwendungszweck: 'Nachlasskonto, aufgelöst am 28.02.2025', connectionId: '' }
    ],
    budget: { type: 'Monatsgeld', amount: '420,00', method: 'Überweisung' },
    assetManagement: [
      { type: 'Monatsgeld', amount: '420,00', method: 'Überweisung' },
      { type: 'Barbetrag', amount: '80,00', method: 'Bar an die betreute Person' }
    ],
    accommodation: {
      type: 'Eigene Wohnung (zur Miete)',
      currentResidence: {
        sameAsRegistered: true,
        institution: '', type: 'eigene Häuslichkeit',
        street: 'Blücherstraße', houseNumber: '62', houseLetter: '',
        postalCode: '56073', city: 'Koblenz', postbox: '', foreignCity: '', country: 'Deutschland'
      },
      monthlyCost: '684,00', serviceCosts: '184,00', electricityCosts: '78,00', gasCosts: '',
      basicRent: '684,00', heatingCosts: '96,00', heatingType: 'Fernwärme',
      hotWater: 'Zentral (über Heizung)', hotWaterPreparation: 'Zentral (über Heizung)', heating: 'Fernwärme',
      housingSecurity: { status: 'secured', details: 'Unbefristeter Mietvertrag seit 01.03.2011, Vermieterin stimmte dem Umbau schriftlich zu' },
      accessibility: { status: 'accessible', details: 'Nach dem Umbau 2024 vollständig barrierefrei: Rampe, verbreiterte Türen, bodengleiche Dusche, unterfahrbare Küche' },
      currentProblems: { status: 'none', details: 'Derzeit keine' },
      supportForms: ['Ambulanter Pflegedienst', 'Assistenzleistungen der Eingliederungshilfe', 'Physiotherapie', 'Hausnotruf', 'Fahrdienst'],
      supportDetails: 'Ambulanter Pflegedienst Rhein-Mosel dreimal täglich (Körperpflege, Katheterversorgung, Medikamentengabe). Assistenzleistungen der Eingliederungshilfe mit sechs Stunden wöchentlich für Einkäufe, Behördengänge und Teilhabe. Physiotherapie nach Bobath zweimal wöchentlich als Hausbesuch. Hausnotruf der Malteser. Fahrdienst für Arzttermine über die Krankenkasse.',
      housingSecurityEntries: [
        L.wohnEintrag(F, 'security', 1, { von: '2023-04-21', status: 'secured', details: 'Unbefristeter Mietvertrag seit 01.03.2011. Nach dem Tod des Ehemannes Eintritt in das Mietverhältnis nach § 563 BGB bestätigt.', stand: '2026-06-24' })
      ],
      accessibilityEntries: [
        L.wohnEintrag(F, 'accessibility', 1, { von: '2023-04-21', bis: '2024-11-14', status: 'partial', details: 'Erdgeschosswohnung mit zwei Stufen am Eingang, Badewanne, zu schmale Türen zum Bad und zum Schlafzimmer. Rollstuhlnutzung nur eingeschränkt möglich.' }),
        L.wohnEintrag(F, 'accessibility', 2, { von: '2024-11-15', status: 'accessible', details: 'Nach dem Umbau: Außenrampe, drei verbreiterte Türen, bodengleiche Dusche mit Duschklappsitz, unterfahrbare Küchenzeile, Haltegriffe. Abnahme durch die Wohnberatung der Stadt Koblenz am 15.11.2024.', stand: '2026-06-24' })
      ],
      currentProblemEntries: [
        L.wohnEintrag(F, 'problems', 1, { von: '2023-08-14', bis: '2023-11-30', status: 'present', details: 'Nach der Urosepsis zeigte sich, dass die alleinige Versorgung ohne Pflegedienst nicht tragfähig war.' }),
        L.wohnEintrag(F, 'problems', 2, { von: '2024-11-08', bis: '2025-06-30', status: 'present', details: 'Nach dem Tod des Ehemannes entfiel die tägliche Unterstützung durch ihn; Trauerreaktion mit depressiver Episode, Versorgungslücken am Abend.' }),
        L.wohnEintrag(F, 'problems', 3, { von: '2025-07-01', status: 'none', details: 'Versorgungslücken durch Aufstockung des Pflegedienstes und die Assistenzleistungen geschlossen.', stand: '2026-08-13' })
      ],
      supportEntries: [
        L.wohnEintrag(F, 'support', 1, { von: '2023-09-01', status: 'active', formen: ['Ambulanter Pflegedienst'], details: 'Pflegedienst Rhein-Mosel, seit 12/2024 dreimal täglich (zuvor zweimal). Körperpflege, intermittierender Katheterismus, Medikamentengabe, Wundkontrolle.', stand: '2026-08-13' }),
        L.wohnEintrag(F, 'support', 2, { von: '2025-01-02', status: 'active', formen: ['Assistenzleistungen der Eingliederungshilfe'], details: 'Sechs Stunden wöchentlich für Einkäufe, Behördengänge, Begleitung zu kulturellen Veranstaltungen. Assistenzkraft Frau Duschek.', stand: '2026-08-13' }),
        L.wohnEintrag(F, 'support', 3, { von: '2023-05-15', status: 'active', formen: ['Physiotherapie'], details: 'Bobath-Therapie zweimal wöchentlich als Hausbesuch, Frau Görtz.', stand: '2026-08-10' }),
        L.wohnEintrag(F, 'support', 4, { von: '2024-12-01', status: 'active', formen: ['Hausnotruf'], details: 'Malteser Hausnotruf mit Funkfinger, Kostenübernahme durch die Pflegekasse.', stand: '2026-06-24' }),
        L.wohnEintrag(F, 'support', 5, { von: '2023-04-21', bis: '2024-11-08', status: 'ended', formen: ['Unterstützung durch Angehörige'], details: 'Tägliche Unterstützung durch den Ehemann Andrzej Nowak bis zu dessen Tod am 08.11.2024.' })
      ]
    },
    provisions: L.vorsorge([
      ['patientenverfuegung', 'Im Zentralen Vorsorgeregister eingetragen', 'PV-2023-0612'],
      ['betreuungsverfuegung', 'Vorhanden', 'BV-2023-0612'],
      ['vorsorgevollmacht', 'Vorhanden', 'VV-2023-0612'],
      ['testament', 'Hinterlegt', 'HV 2025/0344'],
      ['vorsorgeregister', 'Im Zentralen Vorsorgeregister eingetragen', 'ZVR 6402-3006-57'],
      ['bestattungsinstitut', 'Vorhanden', 'BS-2024-1188'],
      ['sterbegeldversicherung', 'Vorhanden', 'STG 6402-9915'],
      ['organspende', 'Vorhanden', '--'],
      ['totenfuersorge', 'Vorhanden', '--'],
      ['kontovollmacht', 'Nicht vorhanden', '--'],
      ['digitaler_nachlass', 'Beim Notar hinterlegt', 'UR 2025/0344'],
      ['erbvertrag', 'Nicht vorhanden', '--']
    ]),
    socialNetwork: [
      { status: 'Aktiv', role: 'Schwester', detail: 'Schwester, wichtigste Bezugsperson', salutation: 'Sehr geehrte Frau', firstName: 'Agnieszka', lastName: 'Bauer', institution: '', street: 'Dürener Straße', house: '187', postal: '50931', city: 'Köln', phone: '0221 / 8841207', mobile: '0176 / 44029918', email: 'a.bauer@example-mail.de', fullName: 'Agnieszka Bauer', address: 'Dürener Straße 187, 50931 Köln', birthDate: '19.02.1961' },
      { status: 'Beendet', role: 'Ehepartnerschaft', detail: 'Ehemann, verstorben am 08.11.2024', salutation: 'Sehr geehrter Herr', firstName: 'Andrzej', lastName: 'Nowak', institution: '', street: 'Blücherstraße', house: '62', postal: '56073', city: 'Koblenz', phone: '', mobile: '', email: '', fullName: 'Andrzej Nowak', address: 'Blücherstraße 62, 56073 Koblenz', birthDate: '14.09.1953' },
      { status: 'Aktiv', role: 'Nichte', detail: 'Nichte, Tochter der Schwester', salutation: 'Sehr geehrte Frau', firstName: 'Julia', lastName: 'Bauer', institution: '', street: 'Dürener Straße', house: '187', postal: '50931', city: 'Köln', phone: '', mobile: '0151 / 66402238', email: 'julia.bauer@example-mail.de', fullName: 'Julia Bauer', address: 'Dürener Straße 187, 50931 Köln' },
      { status: 'Aktiv', role: 'Peer / Bezugsperson', detail: 'Assistenzkraft der Eingliederungshilfe', salutation: 'Sehr geehrte Frau', firstName: 'Beata', lastName: 'Duschek', institution: 'Assistenzdienst Selbstbestimmt Leben Koblenz e. V.', street: 'Casinostraße', house: '14', postal: '56068', city: 'Koblenz', phone: '0261 / 3390118', mobile: '0170 / 3390118', email: 'duschek@sl-koblenz.de', fullName: 'Beata Duschek', address: 'Casinostraße 14, 56068 Koblenz' },
      { status: 'Aktiv', role: 'Peer / Bezugsperson', detail: 'Pflegedienstleitung', salutation: 'Sehr geehrter Herr', firstName: 'Sven', lastName: 'Ackermann', institution: 'Pflegedienst Rhein-Mosel GmbH', street: 'Andernacher Straße', house: '90', postal: '56070', city: 'Koblenz', phone: '0261 / 9042100', mobile: '', email: 'einsatzleitung@pflege-rhein-mosel.de', fullName: 'Sven Ackermann', address: 'Andernacher Straße 90, 56070 Koblenz' },
      { status: 'Aktiv', role: 'Verein (Freizeit)', detail: 'MS-Selbsthilfegruppe', salutation: 'Sehr geehrte Damen und Herren', institution: 'DMSG-Kontaktgruppe Koblenz', street: 'Hohenfelder Straße', house: '12', postal: '56068', city: 'Koblenz', phone: '0261 / 1330440', mobile: '', email: 'koblenz@dmsg-rlp.de', fullName: 'DMSG-Kontaktgruppe Koblenz', address: 'Hohenfelder Straße 12, 56068 Koblenz' },
      { status: 'Aktiv', role: 'Nachbarschaft', detail: 'Nachbarin, hilft bei Post und kleinen Besorgungen', salutation: 'Sehr geehrte Frau', firstName: 'Renate', lastName: 'Kuhlmann', institution: '', street: 'Blücherstraße', house: '62', postal: '56073', city: 'Koblenz', phone: '0261 / 4471288', mobile: '', email: '', fullName: 'Renate Kuhlmann', address: 'Blücherstraße 62, 56073 Koblenz' },
      { status: 'Aktiv', role: 'Betreuung', detail: 'rechtliche Betreuung', salutation: 'Sehr geehrter Herr', firstName: 'Christoph', lastName: 'Zepp', institution: 'Testbüroname', street: 'Marktplatz', house: '8', postal: '56346', city: 'St. Goarshausen', phone: '06771 / 959410', mobile: '', email: 'kanzlei@testbueroname.de', fullName: 'Christoph Zepp', address: 'Marktplatz 8, 56346 St. Goarshausen' }
    ],
    contactProfile: {
      understanding: 'good',
      trust: 'good',
      cooperation: 'cooperative',
      participation: 'active',
      conflicts: 'none',
      assessedAt: '2026-06-24',
      communicationMethods: ['spoken', 'writing', 'device'],
      communicationSupport: 'Sprachlich keinerlei Einschränkung. Frau Nowak liest und versteht auch komplexe Schriftstücke, ermüdet jedoch schnell; Unterlagen werden deshalb vorab per E-Mail geschickt, damit sie sie in eigenem Tempo lesen kann. Das Schreiben von Hand ist wegen der Feinmotorik nicht mehr möglich – Unterschriften bereitet sie mit einem Griffverdicker vor, längere Texte diktiert sie in ihr Tablet.',
      conflictDescription: 'Keine Konflikte. Meinungsverschiedenheiten – etwa über die Höhe der Rücklage für Hilfsmittel – werden offen besprochen und entschieden; die Entscheidung trifft Frau Nowak.',
      evidenceSource: 'Hausbesuche am 24.06.2026 und 13.08.2026, laufende E-Mail-Korrespondenz, Rückmeldung des Pflegedienstes und der Assistenzkraft',
      canInitiateContact: 'ja',
      initiationSupport: 'Keine Unterstützung erforderlich; Frau Nowak nutzt Telefon, E-Mail und Sprachnachrichten',
      initiationChannels: ['phone', 'mobile', 'email', 'in_person'],
      initiationLimitationReason: '',
      reportRemarks: 'Frau Nowak ist uneingeschränkt entscheidungsfähig und nutzt die Betreuung ausdrücklich als Unterstützung bei Schriftverkehr, Anträgen und Widerspruchsverfahren, nicht als Stellvertretung in der Willensbildung. Sie bereitet Termine vor, stellt gezielte Fragen und legt Wert darauf, jeden Antrag vor der Absendung zu lesen. Persönliche Kontakte finden etwa alle sechs bis acht Wochen als Hausbesuch statt, dazwischen laufender Austausch per E-Mail und Telefon. Die Zusammenarbeit ist partnerschaftlich und ausgesprochen verlässlich.'
    },
    handkasse: L.handkasse(F, [
      ['2026-02-02', 'einnahme', 'Sparkasse Koblenz', 'Monatsgeld Februar', 'Barbetrag', 420],
      ['2026-02-09', 'ausgabe', 'Apotheke am Löhrcenter', 'Zuzahlungen Rezepte', 'Zuzahlungen Medikamente (Rezeptgebühren)', 22],
      ['2026-02-14', 'ausgabe', 'Assistenzdienst Selbstbestimmt Leben', 'Eigenanteil Begleitung Theaterbesuch', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 18],
      ['2026-02-27', 'ausgabe', 'Sanitätshaus Vitalis', 'Katheterzubehör, Eigenanteil', 'Heil- und Hilfsmittel (Schuhe, Orthesen, Rollator etc.)', 31.5],
      ['2026-03-02', 'einnahme', 'Sparkasse Koblenz', 'Monatsgeld März', 'Barbetrag', 420],
      ['2026-03-18', 'ausgabe', 'Buchhandlung Reuffel', 'Bücher und Hörbücher', 'Hobbys (Basteln, Musik, Spiele, Bücher)', 46.8],
      ['2026-03-29', 'ausgabe', 'Friseur mobil Weber', 'Hausbesuch Friseur', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 38],
      ['2026-04-01', 'einnahme', 'Sparkasse Koblenz', 'Monatsgeld April', 'Barbetrag', 420],
      ['2026-04-15', 'ausgabe', 'Rewe Lieferservice', 'Wocheneinkauf mit Assistenz', 'Kleidung / Schuhe', 96.4],
      ['2026-04-24', 'ausgabe', 'DMSG Kontaktgruppe', 'Jahresbeitrag Selbsthilfegruppe', 'Vereinsbeiträge (Sport, Musik, etc.)', 36],
      ['2026-05-04', 'einnahme', 'Sparkasse Koblenz', 'Monatsgeld Mai', 'Barbetrag', 420],
      ['2026-05-12', 'ausgabe', 'Apotheke am Löhrcenter', 'Zuzahlungen Rezepte', 'Zuzahlungen Medikamente (Rezeptgebühren)', 18],
      ['2026-05-23', 'ausgabe', 'Blumen Lehnhoff', 'Grabschmuck Ehemann', 'Geschenke (für Angehörige, Freunde)', 42],
      ['2026-06-02', 'einnahme', 'Sparkasse Koblenz', 'Monatsgeld Juni', 'Barbetrag', 420],
      ['2026-06-17', 'ausgabe', 'Sanitätshaus Vitalis', 'Ersatzhandschuhe und Desinfektionsmittel', 'Pflegeprodukte (Inkontinenzmaterial, Pflegemittel)', 27.9],
      ['2026-06-24', 'ausgabe', 'Halina Nowak', 'Barauszahlung bei Hausbesuch', 'Taschengeldzahlungen an Angehörige (falls vereinbart)', 80],
      ['2026-07-01', 'einnahme', 'Sparkasse Koblenz', 'Monatsgeld Juli', 'Barbetrag', 420],
      ['2026-07-21', 'ausgabe', 'Fahrdienst Sander', 'Eigenanteil Fahrt zur Infusion', 'Einzelfahrscheine / Taxi', 10],
      ['2026-07-30', 'ausgabe', 'Buchhandlung Reuffel', 'Hörbuch-Abonnement', 'Zeitungen / Zeitschriften / Online-Abos', 24.9],
      ['2026-08-03', 'einnahme', 'Sparkasse Koblenz', 'Monatsgeld August', 'Barbetrag', 420],
      ['2026-08-13', 'ausgabe', 'Halina Nowak', 'Barauszahlung bei Hausbesuch', 'Taschengeldzahlungen an Angehörige (falls vereinbart)', 80]
    ]),
    assets: {
      begin: L.posten(F, 'vab', [
        ['Bargeld', 'Bargeldbestand bei Betreuungsübernahme', '', 120],
        ['Girokonto', 'Kontostand 21.04.2023', 'Sparkasse Koblenz', 842.18],
        ['Sparkonto', 'Sparbuch Volksbank RheinAhrEifel', 'Volksbank RheinAhrEifel eG', 2860],
        ['Wertvolle Möbel / Haushaltsgeräte (sofern von Bedeutung)', 'Wohnungseinrichtung, Schätzwert', '', 4200],
        ['Rückzahlungsansprüche (z. B. aus Kautionen, Mietkaution)', 'Mietkaution Wohnbaugesellschaft Koblenz', 'Sparkasse Koblenz', 1620],
        ['Nachlassforderungen (Erbansprüche, Pflichtteilsansprüche)', 'Anwartschaft aus der Lebensversicherung des Ehemannes (Bezugsrecht)', 'Allianz Lebensversicherungs-AG', 0]
      ]),
      end: L.posten(F, 'vae', [
        ['Girokonto', 'Kontostand 31.07.2026, Verwaltungskonto', 'Sparkasse Koblenz', 2418.66],
        ['Tagesgeldkonto', 'Rücklage aus dem Nachlass', 'Sparkasse Koblenz', 14280],
        ['Sparkonto', 'Rücklage Bestattung', 'Volksbank RheinAhrEifel eG', 3100],
        ['Baugrundstück / Ackerland / Wald', 'Miterbenanteil an einem unbebauten Grundstück in Plaidt, Flur 4 Nr. 118, 620 m², Verkehrswert 21.700 €, Anteil 1/2', '', 10850],
        ['Rückzahlungsansprüche (z. B. aus Kautionen, Mietkaution)', 'Mietkaution, verzinst', 'Sparkasse Koblenz', 1682.4],
        ['Wertvolle Möbel / Haushaltsgeräte (sofern von Bedeutung)', 'Wohnungseinrichtung nach Umbau', '', 4600],
        ['Schmuck / Uhren', 'Eheringe und Bernsteinkette (Erbstück)', '', 780],
        ['Bargeld', 'Barbestand nach Hausbesuch 13.08.2026', '', 80]
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
        ['Rente wegen voller / teilweiser Erwerbsminderung', 'Rente wegen voller Erwerbsminderung, unbefristet, Zahlbetrag', 'Deutsche Rentenversicherung Rheinland-Pfalz', 'monatlich', 1043.72],
        ['Witwen- / Witwerrente', 'Große Witwenrente nach Andrzej Nowak', 'Deutsche Rentenversicherung Bund', 'monatlich', 486.3],
        ['Pflegegeld aus der Pflegeversicherung (Pflegegrad)', 'Pflegegeld-Anteil der Kombinationsleistung, Pflegegrad 3', 'DAK-Gesundheit Pflegekasse', 'monatlich', 236],
        ['Geldleistungen aus der Eingliederungshilfe (z. B. Persönliches Budget)', 'Assistenzleistungen als Sachleistung über den Assistenzdienst', 'Stadtverwaltung Koblenz', 'monatlich', 0],
        ['Zinsen (Guthaben auf Spar- und Tagesgeldkonten)', 'Zinsen Tagesgeld- und Sparkonto', 'Sparkasse Koblenz / Volksbank', 'jährlich', 31.4]
      ]),
      expenses: L.ausgaben(F, [
        ['Miete', 'Grundmiete Blücherstraße 62', 'Wohnbaugesellschaft Koblenz mbH', 'monatlich', 684, 'Laufende Kosten'],
        ['Nebenkosten / Betriebskosten (Hausgeld, Hausmeister, Müll etc.)', 'Betriebskostenvorauszahlung', 'Wohnbaugesellschaft Koblenz mbH', 'monatlich', 184, 'Laufende Kosten'],
        ['Heizung / Gas / Fernwärme', 'Fernwärmeabschlag', 'Energieversorgung Mittelrhein AG', 'monatlich', 96, 'Laufende Kosten'],
        ['Strom', 'Stromabschlag', 'Energieversorgung Mittelrhein AG', 'monatlich', 78, 'Laufende Kosten'],
        ['Eigenanteil ambulanter Pflegedienst', 'Eigenanteil über der Sachleistung des Pflegegrades 3', 'Pflegedienst Rhein-Mosel GmbH', 'monatlich', 148.4, 'Laufende Kosten'],
        ['Festnetz / Internet', 'Telefon- und Internetanschluss', 'Vodafone Kabel Deutschland', 'monatlich', 39.9, 'Laufende Kosten'],
        ['Handyvertrag / Prepaid-Aufladung', 'Mobilfunk mit Datenvolumen für das Tablet', 'Telekom Deutschland', 'monatlich', 24.9, 'Laufende Kosten'],
        ['Haftpflichtversicherung', 'Privathaftpflicht, Jahresbeitrag umgelegt', 'Nürnberger Versicherung', 'jährlich', 7.05, 'Laufende Kosten'],
        ['Hausratversicherung', 'Jahresbeitrag umgelegt', 'Nürnberger Versicherung', 'jährlich', 9.87, 'Laufende Kosten'],
        ['Rechtsschutzversicherung', 'Jahresbeitrag umgelegt', 'ADVOCARD Rechtsschutzversicherung', 'jährlich', 17.9, 'Laufende Kosten'],
        ['Lebens-/Rentenversicherung (Beiträge)', 'Sterbegeldversicherung', 'LV 1871', 'monatlich', 24.8, 'Laufende Kosten'],
        ['Renovierung / Schönheitsreparaturen', 'Rate Wohnraumanpassung', 'Handwerksbetrieb Lehnert GmbH', 'monatlich', 400, 'Ratenzahlungsvereinbarung geschlossen'],
        ['Zuzahlungen Medikamente (Rezeptgebühren)', 'Zuzahlungen bis zur Belastungsgrenze von 1 %', 'DAK-Gesundheit', 'monatlich', 20, ''],
        ['Vereinsbeiträge (Sport, Musik, etc.)', 'DMSG-Kontaktgruppe', 'DMSG Landesverband RLP', 'jährlich', 3, ''],
        ['Kontoführungsgebühren', 'Girokonto Sparkasse Koblenz', 'Sparkasse Koblenz', 'monatlich', 5.9, 'Laufende Kosten']
      ])
    },
    schuldenregulierung: schulden,
    approvals: L.genehmigungen(F, [
      ['2024-12-09', 'Erbausschlagung / Erbauseinandersetzung', 'Annahme der Erbschaft nach dem verstorbenen Ehemann Andrzej Nowak (gesetzliche Erbfolge, Erbteil 1/2 neben der Mutter des Erblassers)', 'Einwilligung', 'genehmigt', '2025-01-16', '2025-01-24', 'Nachlassaufstellung: Lebensversicherung 18.420 €, Girokontoguthaben 4.284 €, hälftiger Miterbenanteil an einem unbebauten Grundstück in Plaidt (Verkehrswert 21.700 €), Verbindlichkeiten 6.180 € (Bestattung und Steuernachzahlung). Der Nachlass ist eindeutig werthaltig; eine Ausschlagung kam nicht in Betracht. Genehmigung nach § 1852 Nr. 2 BGB.'],
      ['2025-02-20', 'Größere Vermögensverfügung / Grundstücksgeschäft', 'Anlage des Nachlasserlöses von 14.280 € als Tagesgeld mit Zweckbindung für Hilfsmittel und Wohnraumanpassung', 'Einwilligung', 'genehmigt', '2025-03-14', '2025-03-20', 'Frau Nowak wünscht ausdrücklich eine Rücklage für die absehbare Neuversorgung des Elektrorollstuhls und für Restkosten des Umbaus. Anlage mündelsicher bei der Sparkasse Koblenz.'],
      ['2026-05-11', 'Größere Vermögensverfügung / Grundstücksgeschäft', 'Veräußerung des hälftigen Miterbenanteils an dem unbebauten Grundstück Plaidt, Flur 4 Nr. 118, an die Miterbin zum Preis von 11.200 €', 'Einwilligung', 'beantragt', '', '', 'Frau Nowak hat für das Grundstück keine Verwendung; die Miterbin (Mutter des Erblassers) möchte es übernehmen. Verkehrswertgutachten vom 22.04.2026: 21.700 € für die Gesamtfläche. Der angebotene Preis liegt über dem hälftigen Verkehrswert. Antrag beim Amtsgericht Koblenz eingereicht; Anhörung angekündigt.'],
      ['2026-06-30', 'Sonstiges', 'Abschluss eines Vertrages über die Neuversorgung mit einem Elektrorollstuhl (Eigenanteil 1.840 €)', 'Einwilligung', 'genehmigt', '2026-07-24', '', 'Die DAK übernimmt die Basisversorgung; der Eigenanteil betrifft die Sitzkantelung und die Kopfstütze. Genehmigung nach § 1854 Nr. 4 BGB, weil der Vertrag über den laufenden Bedarf hinausgeht.'],
      ['2025-04-28', 'Prozessführung / Vergleich', 'Widerspruch und ggf. Klage gegen den Ablehnungsbescheid der DAK zur Rollstuhlversorgung', 'Einwilligung', 'erledigt', '', '2025-06-19', 'Der Widerspruch war erfolgreich; ein Klageverfahren wurde nicht erforderlich. Rechtsschutzversicherung war eingeschaltet.']
    ]),
    fristen: L.fristen(F, [
      ['Jahresbericht 01.05.2025 – 30.04.2026 an das Betreuungsgericht', 'Bericht', 'Amtsgericht Koblenz', '2026-04-30', '2026-05-31', 'high', 'erledigt', 'Eingereicht am 22.05.2026 nebst Rechnungslegung.'],
      ['Anhörung zur Grundstücksveräußerung', 'Anhörung', 'Amtsgericht Koblenz', '2026-05-11', '2026-09-16', 'high', 'offen', 'Termin angekündigt; Verkehrswertgutachten und Kaufvertragsentwurf liegen dem Gericht vor.'],
      ['Fortschreibung Gesamtplan Assistenzleistungen', 'Antrag', 'Stadtverwaltung Koblenz, Amt für Soziales', '2027-08-31', '2027-06-30', 'normal', 'offen', 'Bewilligung der sechs Wochenstunden läuft zum 31.08.2027 aus.'],
      ['Erklärung zur Erbschaftsteuer', 'Antrag', 'Finanzamt Koblenz', '2026-11-30', '2026-10-15', 'high', 'offen', 'Nach dem Grundstücksverkauf. Freibetrag der Ehegattin 500.000 € – voraussichtlich keine Steuer, Erklärung dennoch angefordert.'],
      ['Verlängerung Wertmarke zur unentgeltlichen Beförderung', 'Antrag', 'Landesamt für Soziales, Jugend und Versorgung Koblenz', '2027-02-28', '2027-01-15', 'normal', 'offen', 'Wertmarke gültig bis 28.02.2027; bei Merkzeichen aG unentgeltlich.'],
      /* Kategorie 'Vergütung' (Nutzerentscheid 30.08.2026): Die Vorausschau der
         Vergütungs-Pipeline filtert auf genau diese Kategorie - mit 'Sonstige' blieb der
         erste Abschnitt der Pipeline in der Vorführung dauerhaft leer. */
      ['Vergütungsantrag 3. Quartal 2026 (VBVG)', 'verguetung', 'Amtsgericht Koblenz', '2026-07-31', '2026-08-31', 'normal', 'offen', 'Vermögend seit dem Erbfall; Vergütung aus dem Vermögen.'],
      ['Folgeverordnung Physiotherapie anfordern', 'Sonstige', 'Dr. med. Bernd Sauerwein', '2026-08-10', '2026-09-30', 'normal', 'offen', 'Aktuelle Verordnung umfasst zehn Einheiten, endet Ende September.'],
      ['Widerspruchsfrist Betriebskostenabrechnung 2025', 'Widerspruch', 'Wohnbaugesellschaft Koblenz mbH', '2026-06-30', '2026-12-31', 'normal', 'offen', 'Abrechnung ergab ein Guthaben von 142,80 €; Prüfung ergab keine Beanstandung. Frist wird nur beobachtet.']
    ]),
    goalDecisionPlanning: L.planung(F, [
      {
        typ: 'goal', titel: 'Selbstständiges Wohnen in der eigenen Wohnung erhalten', bereich: 'Wohnen',
        beschreibung: 'Frau Nowak will unter allen Umständen in ihrer Wohnung bleiben. Nach dem Tod des Ehemannes und mit fortschreitender MS ist dies nur durch die Kombination aus barrierefreiem Umbau, Pflegedienst und Assistenzleistungen möglich.',
        aussage: '„Solange ich hier wohnen kann, geht es mir gut. Ein Heim kommt für mich nicht in Frage."',
        status: 'In Bearbeitung', prioritaet: 'Dringend', zustaendig: 'Halina Nowak',
        angelegt: '2023-04-28', stand: '2026-08-13', zieldatum: '', pruefdatum: '2027-04-30',
        quelle: 'Erstgespräch am 28.04.2023', favorit: true,
        module: ['doku', 'approval', 'task', 'deadline'], fortschritt: 85,
        smart: {
          formulation: 'Frau Nowak lebt weiterhin in der eigenen Wohnung; die Versorgung ist rund um die Uhr abgesichert.',
          specific: 'Barrierefreier Umbau, dreimal tägliche Pflege, sechs Stunden Assistenz wöchentlich, Hausnotruf',
          measurable: 'Keine Versorgungslücke, kein Krankenhausaufenthalt wegen Versorgungsmangels',
          attractive: 'Die Wohnung ist ihr Lebensmittelpunkt seit 2011',
          realistic: 'Alle Bausteine sind bewilligt und finanziert',
          timeBound: 'fortlaufend, Überprüfung jährlich zum Berichtstermin'
        },
        verlauf: [
          ['2023-04-28', 'Eintrag angelegt', 'Wunsch beim Erstgespräch'],
          ['2023-09-01', 'Eintrag bearbeitet', 'Pflegedienst zweimal täglich eingerichtet'],
          ['2024-11-15', 'Eintrag bearbeitet', 'Wohnraumanpassung abgeschlossen und abgenommen'],
          ['2025-01-02', 'Eintrag bearbeitet', 'Assistenzleistungen mit sechs Wochenstunden begonnen'],
          ['2026-08-13', 'Eintrag geprüft', 'Versorgung stabil, keine Lücken']
        ]
      },
      {
        typ: 'need', titel: 'Erbfall abwickeln und Nachlass ordnen', bereich: 'Finanzen & Vermögen',
        beschreibung: 'Nach dem Tod des Ehemannes am 08.11.2024 sind Erbschaftsannahme, Auflösung des Nachlasskontos, Lebensversicherung, Bestattungskosten und der Miterbenanteil an einem Grundstück zu regeln.',
        status: 'In Bearbeitung', prioritaet: 'Hoch', zustaendig: 'Christoph Zepp',
        angelegt: '2024-11-14', stand: '2026-05-11', zieldatum: '2026-12-31', pruefdatum: '2026-11-30',
        quelle: 'Sterbefall vom 08.11.2024', favorit: true,
        module: ['doku', 'approval', 'deadline'], fortschritt: 75,
        verlauf: [
          ['2024-11-14', 'Eintrag angelegt', 'Nach dem Sterbefall'],
          ['2025-01-24', 'Eintrag bearbeitet', 'Erbschaft angenommen, Genehmigung erteilt'],
          ['2025-02-28', 'Eintrag bearbeitet', 'Nachlasskonto aufgelöst, Lebensversicherung ausgezahlt'],
          ['2026-05-11', 'Eintrag bearbeitet', 'Antrag auf Genehmigung des Grundstücksverkaufs gestellt']
        ]
      },
      {
        typ: 'measure', titel: 'Neuversorgung Elektrorollstuhl', bereich: 'Gesundheit & Pflege',
        beschreibung: 'Der 2024 angepasste Elektrorollstuhl ist nach zwei Jahren intensiver Nutzung verschlissen. Die DAK übernimmt die Basisversorgung; für Sitzkantelung und Kopfstütze fällt ein Eigenanteil von 1.840 € an, der aus der zweckgebundenen Rücklage bestritten wird.',
        status: 'In Bearbeitung', prioritaet: 'Hoch', zustaendig: 'Christoph Zepp',
        angelegt: '2026-04-08', stand: '2026-07-24', zieldatum: '2026-10-31', pruefdatum: '2026-10-31',
        quelle: 'Hausbesuch Dr. Sauerwein am 08.04.2026',
        module: ['doku', 'approval', 'task'], fortschritt: 60,
        verlauf: [
          ['2026-04-08', 'Eintrag angelegt', 'Verordnung durch Dr. Sauerwein'],
          ['2026-06-30', 'Eintrag bearbeitet', 'Kostenvoranschlag Vitalis, Genehmigung beantragt'],
          ['2026-07-24', 'Eintrag bearbeitet', 'Genehmigung des Betreuungsgerichts erteilt']
        ]
      },
      {
        typ: 'wish', titel: 'Teilhabe am kulturellen Leben', bereich: 'Arbeit, Bildung & Teilhabe',
        beschreibung: 'Frau Nowak besucht gern Theater, Konzerte und Lesungen. Ohne Begleitung ist ihr das nicht möglich. Die Assistenzleistungen der Eingliederungshilfe decken hierfür einen Teil der Stunden ab.',
        aussage: '„Ich möchte nicht nur versorgt werden. Ich möchte auch etwas erleben."',
        status: 'In Bearbeitung', prioritaet: 'Normal', zustaendig: 'Beata Duschek',
        angelegt: '2024-09-09', stand: '2026-06-24', zieldatum: '', pruefdatum: '2027-06-30',
        quelle: 'Antrag auf Assistenzleistungen vom 09.09.2024', favorit: true,
        module: ['doku', 'calendar'], fortschritt: 70,
        verlauf: [
          ['2024-09-09', 'Eintrag angelegt', 'Beim Antrag auf Assistenzleistungen'],
          ['2025-01-02', 'Eintrag bearbeitet', 'Assistenz startet, zwei Stunden je Woche für Teilhabe'],
          ['2026-06-24', 'Eintrag geprüft', 'Regelmäßige Theater- und Konzertbesuche, DMSG-Gruppe monatlich']
        ]
      },
      {
        typ: 'decision', titel: 'Keine invasive Beatmung, keine PEG-Sonde', bereich: 'Vorsorge',
        beschreibung: 'Frau Nowak hat am 12.06.2023 mit anwaltlicher Beratung eine Patientenverfügung errichtet. Sie schließt eine invasive Beatmung und eine künstliche Ernährung über eine PEG-Sonde für den Fall eines weit fortgeschrittenen Krankheitsstadiums aus. Die Verfügung wurde 2025 nach dem Tod des Ehemannes bestätigt.',
        status: 'Abgeschlossen', prioritaet: 'Hoch', zustaendig: 'Halina Nowak',
        angelegt: '2023-06-12', stand: '2025-06-11', zieldatum: '2023-06-12', pruefdatum: '2028-06-30',
        quelle: 'Eigene Entscheidung, anwaltliche Beratung Rechtsanwältin Hoffmann',
        module: ['doku'], fortschritt: 100,
        verlauf: [
          ['2023-06-12', 'Eintrag angelegt', 'Patientenverfügung errichtet'],
          ['2023-06-28', 'Eintrag bearbeitet', 'Eintragung im Zentralen Vorsorgeregister'],
          ['2025-06-11', 'Eintrag abgeschlossen', 'Nach dem Tod des Ehemannes überprüft und unverändert bestätigt']
        ]
      },
      {
        typ: 'need', titel: 'Harnwegsinfekte vermeiden', bereich: 'Gesundheit & Pflege',
        beschreibung: 'Bei neurogener Blasenentleerungsstörung mit intermittierendem Selbstkatheterismus besteht ein hohes Infektrisiko. 2023 kam es zu einer Urosepsis, 2025 zu einer Pyelonephritis.',
        status: 'In Bearbeitung', prioritaet: 'Hoch', zustaendig: 'Pflegedienst Rhein-Mosel',
        angelegt: '2023-08-28', stand: '2026-02-24', zieldatum: '', pruefdatum: '2026-12-31',
        quelle: 'Entlassbericht nach Urosepsis vom 27.08.2023',
        module: ['doku', 'task'], fortschritt: 65,
        verlauf: [
          ['2023-08-28', 'Eintrag angelegt', 'Nach der Urosepsis'],
          ['2023-09-01', 'Eintrag bearbeitet', 'Katheterversorgung durch den Pflegedienst übernommen'],
          ['2026-02-24', 'Eintrag bearbeitet', 'Katheterschulung aufgefrischt, Trinkprotokoll eingeführt']
        ]
      },
      {
        typ: 'review', titel: 'Prüfung: Persönliches Budget statt Sachleistung', bereich: 'Behörden & Recht',
        beschreibung: 'Frau Nowak erwägt, die Assistenzleistungen künftig als Persönliches Budget zu beziehen, um die Assistenzkraft selbst auswählen und die Zeiten flexibler legen zu können. Zu prüfen sind Arbeitgeberpflichten, Abrechnungsaufwand und die Frage, wer im Verhinderungsfall einspringt.',
        status: 'Zur Prüfung', prioritaet: 'Normal', zustaendig: 'Halina Nowak',
        angelegt: '2026-06-24', stand: '2026-08-13', zieldatum: '2027-06-30', pruefdatum: '2027-03-31',
        quelle: 'Anregung von Frau Nowak beim Hausbesuch am 24.06.2026',
        module: ['doku', 'deadline'], fortschritt: 20,
        verlauf: [
          ['2026-06-24', 'Eintrag angelegt', 'Anregung von Frau Nowak'],
          ['2026-08-13', 'Eintrag bearbeitet', 'Beratungstermin bei der EUTB vereinbart']
        ]
      },
      {
        typ: 'goal', titel: 'Trauerbewältigung und psychische Stabilisierung', bereich: 'Gesundheit & Pflege',
        beschreibung: 'Nach dem Tod des Ehemannes im November 2024 kam es zu einer mittelgradigen depressiven Episode. Behandlung mit Duloxetin und Gesprächen bei Dr. Petrasch; zusätzlich Trauergruppe der Hospizgesellschaft.',
        status: 'Erreicht', prioritaet: 'Hoch', zustaendig: 'Halina Nowak',
        angelegt: '2024-12-16', stand: '2026-03-17', zieldatum: '2026-03-31', pruefdatum: '2026-09-30',
        quelle: 'Befund Dr. Petrasch vom 16.12.2024',
        module: ['doku', 'calendar'], fortschritt: 100,
        verlauf: [
          ['2024-12-16', 'Eintrag angelegt', 'Depressive Episode diagnostiziert'],
          ['2025-03-04', 'Eintrag bearbeitet', 'Teilnahme an der Trauergruppe begonnen'],
          ['2026-03-17', 'Eintrag abgeschlossen', 'Deutliche Besserung, Medikation unverändert fortgeführt']
        ]
      }
    ]),
    accounting: L.rechnungslegung(F, {
      von: '2025-05-01', bis: '2026-04-30',
      konten: [
        { name: 'Girokonto (Verwaltungskonto)', art: 'Girokonto', bank: 'Sparkasse Koblenz', inhaber: 'Halina Nowak', iban: 'DE24 5705 0120 0064 0230 65', bic: 'MALADE51KOB', anfang: 1984.2, ende: 2418.66, einnahmen: 21144.24, ausgaben: 20709.78 },
        { name: 'Tagesgeldkonto (Rücklage Nachlass)', art: 'Tagesgeldkonto', bank: 'Sparkasse Koblenz', inhaber: 'Halina Nowak', iban: 'DE96 5705 0120 0064 0230 66', bic: 'MALADE51KOB', anfang: 15200, ende: 14280, einnahmen: 280, ausgaben: 1200 },
        { name: 'Sparkonto (Rücklage Bestattung)', art: 'Sparkonto', bank: 'Volksbank RheinAhrEifel eG', inhaber: 'Halina Nowak', iban: 'DE58 5776 1591 0022 9014 88', bic: 'GENODED1BNA', anfang: 3080, ende: 3100, einnahmen: 20, ausgaben: 0 }
      ],
      vermoegen: [
        ['Bargeld und Bankguthaben', 'Giro-, Tagesgeld- und Sparkonto', 20264.2, 19798.66],
        ['Grundvermögen', 'Miterbenanteil unbebautes Grundstück Plaidt, Flur 4 Nr. 118, Anteil 1/2', 10850, 10850],
        ['Forderungen', 'Mietkaution, verzinst', 1668.9, 1682.4],
        ['Haushaltsgegenstände', 'Wohnungseinrichtung nach Umbau', 4600, 4600],
        ['Kunstgegenstände und Schmuck', 'Eheringe und Bernsteinkette', 780, 780]
      ],
      verbindlichkeiten: [
        ['Handwerksbetrieb Lehnert GmbH', 'Restkosten Wohnraumanpassung, Ratenvereinbarung 400 € monatlich', 3860, 2660]
      ],
      schenkungen: [
        ['Julia Bauer', 'Geldgeschenk zum 25. Geburtstag der Nichte (angemessene Gelegenheitsschenkung)', '2025-08-14', 200],
        ['DMSG-Kontaktgruppe Koblenz', 'Spende zur Weihnachtsfeier der Gruppe', '2025-12-11', 50]
      ]
    }),
    exportHistory: [],
    archives: [],
    history: [],
    contacts: [],
    contactMerges: [],
    promptHints: 'Frau Nowak ist uneingeschränkt entscheidungsfähig. Die Betreuung ist wegen der körperlichen Einschränkungen eingerichtet, nicht wegen einer Beeinträchtigung der Willensbildung. Berichte müssen erkennbar machen, dass alle Entscheidungen von ihr selbst getroffen werden. Vermögende Betreute seit dem Erbfall 2025.',
    derived: {}
  },

  kontakte: [
    { kategorie: 'behoerden', rolle: 'Betreuungsgericht', institution: 'Amtsgericht Koblenz', strasse: 'Karmeliterstraße', hausnummer: '14', plz: '56068', ort: 'Koblenz', telefon: '0261/1020', fax: '0261/1022960', mail: 'poststelle.ag-ko@ko.mjv.rlp.de', aktenzeichen: '2 XVII 431/23', gericht: 'Amtsgericht Koblenz', gerichtsAz: '2 XVII 431/23' },
    { kategorie: 'behoerden', rolle: 'Nachlassgericht', institution: 'Amtsgericht Koblenz – Nachlassgericht', strasse: 'Karmeliterstraße', hausnummer: '14', plz: '56068', ort: 'Koblenz', telefon: '0261/1020', aktenzeichen: 'VI 882/24', vorgang: 'Nachlass Andrzej Nowak' , mail: 'poststelle.ag-koblenz@ko.mjv.rlp.de' },
    { kategorie: 'behoerden', rolle: 'Betreuungsbehörde', institution: 'Stadtverwaltung Koblenz, Betreuungsbehörde', strasse: 'Rathauspassage', hausnummer: '2', plz: '56068', ort: 'Koblenz', telefon: '0261/1290', mail: 'betreuungsbehoerde@stadt.koblenz.de', aktenzeichen: 'BtB-KO 2023/0771' },
    { kategorie: 'behoerden', rolle: 'Sozialamt - Rehabilitation- und Teilhabeleistungen', institution: 'Stadtverwaltung Koblenz, Amt für Soziales – Eingliederungshilfe', strasse: 'Rathauspassage', hausnummer: '2', plz: '56068', ort: 'Koblenz', telefon: '0261/1291500', mail: 'eingliederungshilfe@stadt.koblenz.de', aktenzeichen: 'EGH-KO 2024/3390' },
    { kategorie: 'behoerden', rolle: 'LSJV / Versorgungsamt', institution: 'Landesamt für Soziales, Jugend und Versorgung Koblenz', strasse: 'Baedekerstraße', hausnummer: '2-20', plz: '56073', ort: 'Koblenz', telefon: '0261/40410', aktenzeichen: 'SB 2015/64 118' , mail: 'poststelle@landesamt-soziales.de' },
    { kategorie: 'behoerden', rolle: 'Finanzverwaltung / Finanzamt', institution: 'Finanzamt Koblenz', strasse: 'Ferdinand-Sauerbruch-Straße', hausnummer: '19', plz: '56073', ort: 'Koblenz', telefon: '0261/49320', aktenzeichen: '22/118/64027' , mail: 'poststelle@fa-koblenz.fin-rlp.de' },
    { kategorie: 'behoerden', rolle: 'Alltagsbegleitung', institution: 'Ergänzende unabhängige Teilhabeberatung (EUTB) Koblenz', strasse: 'Casinostraße', hausnummer: '14', plz: '56068', ort: 'Koblenz', telefon: '0261/3390200', mail: 'eutb@sl-koblenz.de', vorgang: 'Beratung Persönliches Budget' },
    { kategorie: 'gesundheit', rolle: 'Neurologie', anrede: 'Sehr geehrte Frau', titel: 'Prof. Dr. med.', vorname: 'Katharina', nachname: 'Reisinger', institution: 'Gemeinschaftsklinikum Mittelrhein, MS-Ambulanz', strasse: 'Koblenzer Straße', hausnummer: '115-155', plz: '56073', ort: 'Koblenz', telefon: '0261/4962880', mail: 'ms-ambulanz@gk-mittelrhein.de' },
    { kategorie: 'gesundheit', rolle: 'Allgemeinmedizin', anrede: 'Sehr geehrter Herr', titel: 'Dr. med.', vorname: 'Bernd', nachname: 'Sauerwein', institution: 'Hausarztpraxis Koblenz-Süd', strasse: 'Löhrstraße', hausnummer: '88', plz: '56068', ort: 'Koblenz', telefon: '0261/3374120', mail: 'praxis@sauerwein-koblenz.de' },
    { kategorie: 'gesundheit', rolle: 'Urologie', anrede: 'Sehr geehrte Frau', titel: 'Dr. med.', vorname: 'Anette', nachname: 'Kilian', institution: 'MVZ Rhein-Mosel, Urologie', strasse: 'Moselweißer Straße', hausnummer: '20', plz: '56073', ort: 'Koblenz', telefon: '0261/9928140', mail: 'urologie@mvz-rhein-mosel.de' },
    { kategorie: 'gesundheit', rolle: 'Psychiater', anrede: 'Sehr geehrter Herr', titel: 'Dr. med.', vorname: 'Jürgen', nachname: 'Petrasch', institution: 'Praxis für Psychiatrie und Psychotherapie', strasse: 'Hohenfelder Straße', hausnummer: '22', plz: '56068', ort: 'Koblenz', telefon: '0261/1330880', mail: 'praxis@petrasch-koblenz.de' },
    { kategorie: 'gesundheit', rolle: 'Ergotherapie', anrede: 'Sehr geehrte Frau', vorname: 'Melanie', nachname: 'Görtz', institution: 'Praxis für Physiotherapie Görtz (Hausbesuche)', strasse: 'Rheinstraße', hausnummer: '44', plz: '56068', ort: 'Koblenz', telefon: '0261/4478812', mail: 'praxis@physio-goertz.de' },
    { kategorie: 'gesundheit', rolle: 'ambulanter Pflegedienst', institution: 'Pflegedienst Rhein-Mosel GmbH', strasse: 'Andernacher Straße', hausnummer: '90', plz: '56070', ort: 'Koblenz', telefon: '0261/9042100', fax: '0261/9042109', mail: 'einsatzleitung@pflege-rhein-mosel.de', iban: 'DE64 5705 0120 0090 4210 05', bic: 'MALADE51KOB' },
    { kategorie: 'gesundheit', rolle: 'Krankenhaus', institution: 'Gemeinschaftsklinikum Mittelrhein, Kemperhof', strasse: 'Koblenzer Straße', hausnummer: '115-155', plz: '56073', ort: 'Koblenz', telefon: '0261/4960' , mail: 'info@gk-mittelrhein.de' },
    { kategorie: 'gesundheit', rolle: 'Apotheke', institution: 'Apotheke am Löhrcenter', strasse: 'Hohenfelder Straße', hausnummer: '22', plz: '56068', ort: 'Koblenz', telefon: '0261/3040', mail: 'info@apotheke-loehrcenter.de' },
    { kategorie: 'finanzen', rolle: 'Bankinstut', institution: 'Sparkasse Koblenz', strasse: 'Bahnhofstraße', hausnummer: '11', plz: '56068', ort: 'Koblenz', telefon: '0261/3930', iban: 'DE24 5705 0120 0064 0230 65', bic: 'MALADE51KOB', bank: 'Sparkasse Koblenz' , mail: 'service@sparkasse-koblenz.de' },
    { kategorie: 'finanzen', rolle: 'Kreditinstitut', institution: 'Volksbank RheinAhrEifel eG', strasse: 'Ringstraße', hausnummer: '6', plz: '53474', ort: 'Bad Neuenahr-Ahrweiler', telefon: '02641/8880', iban: 'DE58 5776 1591 0022 9014 88', bic: 'GENODED1BNA', bank: 'Volksbank RheinAhrEifel eG' , mail: 'service@volksbank-rheinahreifel.de' },
    { kategorie: 'finanzen', rolle: 'Gläubiger', institution: 'Handwerksbetrieb Lehnert GmbH', strasse: 'Industriestraße', hausnummer: '22', plz: '56218', ort: 'Mülheim-Kärlich', telefon: '02630/955120', mail: 'buero@lehnert-bau.de', aktenzeichen: 'LH-2024-2290', iban: 'DE31 5705 0120 0000 2290 14', bic: 'MALADE51KOB' },
    { kategorie: 'finanzen', rolle: 'Steuerberatung/Buchhaltung', institution: 'Steuerkanzlei Rheinblick Koblenz', strasse: 'Schlossstraße', hausnummer: '10', plz: '56068', ort: 'Koblenz', telefon: '0261/9142880', mail: 'kanzlei@rheinblick-steuer.de', vorgang: 'Erbschaftsteuererklärung 2026' },
    { kategorie: 'versicherungen', rolle: 'Gesundheitsversicherung (gesetzlich)', institution: 'DAK-Gesundheit', strasse: 'Nagelsweg', hausnummer: '27-31', plz: '20097', ort: 'Hamburg', telefon: '040/325325555', mail: 'service@dak.de', aktenzeichen: 'D640230065' },
    { kategorie: 'versicherungen', rolle: 'Pflegezusatzversicherung', institution: 'DAK-Gesundheit Pflegekasse', strasse: 'Nagelsweg', hausnummer: '27-31', plz: '20097', ort: 'Hamburg', telefon: '040/325325555', aktenzeichen: 'PK-D640230065' , mail: 'service@dak-gesundheit-pflegekasse.de' },
    { kategorie: 'versicherungen', rolle: 'Rentenversicherung', institution: 'Deutsche Rentenversicherung Rheinland-Pfalz', strasse: 'Eichendorffstraße', hausnummer: '4-6', plz: '67346', ort: 'Speyer', telefon: '06232/170', aktenzeichen: '61 300657 N 118' , mail: 'service@deutsche-rentenversicherung.de' },
    { kategorie: 'versicherungen', rolle: 'Rechtschutzversicherung', institution: 'ADVOCARD Rechtsschutzversicherung AG', strasse: 'Neue Rabenstraße', hausnummer: '15-19', plz: '20354', ort: 'Hamburg', telefon: '040/23730', aktenzeichen: 'RS 6402-1188' , mail: 'service@advocard.de' },
    { kategorie: 'versicherungen', rolle: 'Lebensversicherung', institution: 'Allianz Lebensversicherungs-AG', strasse: 'Reinsburgstraße', hausnummer: '19', plz: '70178', ort: 'Stuttgart', telefon: '0711/6630', aktenzeichen: 'LV 88 402 1157', vorgang: 'Nachlass Andrzej Nowak, ausgezahlt 14.01.2025' , mail: 'service@allianz-lebensversicherungs.de' },
    { kategorie: 'versicherungen', rolle: 'Sterbegeldversicherung', institution: 'LV 1871 Lebensversicherung', strasse: 'Maximiliansplatz', hausnummer: '5', plz: '80333', ort: 'München', telefon: '089/551670', aktenzeichen: 'STG 6402-9915' , mail: 'service@lv-1871-lebensversicherung.de' },
    { kategorie: 'versicherungen', rolle: 'Hausratversicherung', institution: 'Nürnberger Versicherung', strasse: 'Ostendstraße', hausnummer: '100', plz: '90334', ort: 'Nürnberg', telefon: '0911/5310', aktenzeichen: 'HRV 2290-6403' , mail: 'service@nuernberger-versicherung.de' },
    { kategorie: 'unterkunft', rolle: 'Vermieter', institution: 'Wohnbaugesellschaft Koblenz mbH', strasse: 'Neustadt', hausnummer: '18', plz: '56068', ort: 'Koblenz', telefon: '0261/30110', fax: '0261/3011199', mail: 'service@wohnbau-koblenz.de', vorgang: 'Mietvertrag seit 01.03.2011, Umbauzustimmung 12.06.2024', iban: 'DE18 5705 0120 0030 1100 18', bic: 'MALADE51KOB' },
    { kategorie: 'unterkunft', rolle: 'Nebenkostenanbieter Strom', institution: 'Energieversorgung Mittelrhein AG', strasse: 'Schützenstraße', hausnummer: '80-82', plz: '56068', ort: 'Koblenz', telefon: '0261/402100', mail: 'service@evm.de', aktenzeichen: 'EVM-6402-3006' },
    { kategorie: 'unterkunft', rolle: 'Nebenkostenanbieter Gas', institution: 'Energieversorgung Mittelrhein AG (Fernwärme)', strasse: 'Schützenstraße', hausnummer: '80-82', plz: '56068', ort: 'Koblenz', telefon: '0261/402100', aktenzeichen: 'EVM-FW-6402' , mail: 'info@energieversorgung-mittelrhein.de' },
    { kategorie: 'unterkunft', rolle: 'Beitragsservice', status: 'Befreit', institution: 'ARD ZDF Deutschlandradio Beitragsservice', plz: '50656', ort: 'Köln', telefon: '01806/999555', aktenzeichen: '660 224 015' , mail: 'service@rundfunkbeitrag.de' , postfach: '50656 Köln' },
    { kategorie: 'unterkunft', rolle: 'Einrichtungsträger', institution: 'Assistenzdienst Selbstbestimmt Leben Koblenz e. V.', strasse: 'Casinostraße', hausnummer: '14', plz: '56068', ort: 'Koblenz', telefon: '0261/3390118', mail: 'info@sl-koblenz.de', aktenzeichen: 'EGH-KO 2024/3390' },
    { kategorie: 'soziales', rolle: 'Schwester', anrede: 'Sehr geehrte Frau', vorname: 'Agnieszka', nachname: 'Bauer', strasse: 'Dürener Straße', hausnummer: '187', plz: '50931', ort: 'Köln', telefon: '0221/8841207', mobil: '0176/44029918', mail: 'a.bauer@example-mail.de' },
    { kategorie: 'soziales', rolle: 'Nichte', anrede: 'Sehr geehrte Frau', vorname: 'Julia', nachname: 'Bauer', strasse: 'Dürener Straße', hausnummer: '187', plz: '50931', ort: 'Köln', mobil: '0151/66402238', mail: 'julia.bauer@example-mail.de' , telefon: '0221/5570318' },
    { kategorie: 'soziales', rolle: 'Ehepartnerschaft', status: 'Beendet', anrede: 'Sehr geehrter Herr', vorname: 'Andrzej', nachname: 'Nowak', strasse: 'Blücherstraße', hausnummer: '62', plz: '56073', ort: 'Koblenz', vorgang: 'Verstorben am 08.11.2024' , mail: 'andrzej.nowak@example-mail.de' , telefon: '0261/9014512' },
    { kategorie: 'soziales', rolle: 'Peer / Bezugsperson', anrede: 'Sehr geehrte Frau', vorname: 'Beata', nachname: 'Duschek', institution: 'Assistenzdienst Selbstbestimmt Leben Koblenz e. V.', strasse: 'Casinostraße', hausnummer: '14', plz: '56068', ort: 'Koblenz', telefon: '0261/3390118', mobil: '0170/3390118', mail: 'duschek@sl-koblenz.de' },
    { kategorie: 'soziales', rolle: 'Nachbar:in', anrede: 'Sehr geehrte Frau', vorname: 'Renate', nachname: 'Kuhlmann', strasse: 'Blücherstraße', hausnummer: '62', plz: '56073', ort: 'Koblenz', telefon: '0261/4471288' , mail: 'renate.kuhlmann@example-mail.de' },
    { kategorie: 'soziales', rolle: 'Verein (Freizeit)', institution: 'DMSG-Kontaktgruppe Koblenz', strasse: 'Hohenfelder Straße', hausnummer: '12', plz: '56068', ort: 'Koblenz', telefon: '0261/1330440', mail: 'koblenz@dmsg-rlp.de' },
    { kategorie: 'soziales', rolle: 'aktuelle Betreuung', anrede: 'Sehr geehrter Herr', vorname: 'Christoph', nachname: 'Zepp', institution: 'Betreuungsbüro Rheinblick', strasse: 'Marktplatz', hausnummer: '8', plz: '56346', ort: 'St. Goarshausen', telefon: '06771/959410', mail: 'kanzlei@betreuungsbuero-rheinblick.de' }
  ],

  doku: L.doku([
    ['2023-04-21', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Betreuungsspezifischer Vorgang', 'Übernahme einer neuen Betreuung / Erstgespräch / Aktenanlage', 'Schriftlich (Brief)', 'Bestellung zugestellt', 'Beschluss vom 17.04.2023. Sechs Aufgabenkreise, kein Einwilligungsvorbehalt. Die Betreuung wurde von Frau Nowak selbst angeregt, weil sie den Schriftverkehr wegen der Feinmotorik nicht mehr bewältigen konnte.'],
    ['2023-04-28', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Beratungsgespräch', 'persönlich (Hausbesuch)', 'Erstgespräch in der Wohnung', 'Frau Nowak empfing gemeinsam mit ihrem Ehemann. Sie ist geistig vollständig präsent, formuliert präzise und hatte eine Liste offener Punkte vorbereitet. Sie stellte klar: „Ich möchte, dass Sie schreiben, was ich entscheide." Vereinbart: Unterlagen vorab per E-Mail, Hausbesuche alle sechs bis acht Wochen.'],
    ['2023-05-15', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Organisation von Hilfsmitteln (Rollator, Pflegebett, Hilfsmittelrezept)', 'Schriftlich (Brief)', 'Physiotherapie verordnet', 'Bobath-Therapie zweimal wöchentlich als Hausbesuch verordnet. Praxis Görtz übernimmt.'],
    ['2023-05-30', 'Finanzen, Vermögen & Schulden', 'Inkassounternehmen / Gläubiger', 'Finanzen, Vermögen & Schulden', 'Schuldenklärung / Ratenzahlungsvereinbarung', 'Schriftlich (Brief)', 'Offene Forderungen erhoben', 'Zwei offene Forderungen ermittelt: Krankenhauszuzahlungen 428,60 € und Hilfsmittel-Eigenanteile 1.284,50 €. Beide entstanden, weil der Schriftverkehr liegen geblieben war. Ratenzahlung vereinbart.'],
    ['2023-06-12', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Vorsorgeregister / Vorsorgedokumente', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Dokumentation von Vollmachten / Patientenverfügung / Vorsorgevollmacht', 'persönlich (Betreuungsbüro)', 'Patientenverfügung errichtet', 'Frau Nowak errichtet mit anwaltlicher Beratung eine Patientenverfügung, eine Betreuungsverfügung und eine auf Gesundheitsangelegenheiten beschränkte Vorsorgevollmacht für ihre Schwester. Sie hat die Formulierungen selbst diktiert.'],
    ['2023-07-18', 'Gesundheit, Pflege & Rehabilitation', 'Krankenkasse / Pflegekasse', 'Gesundheit, Pflege & Rehabilitation', 'Pflegegrad-Antrag / Höherstufung', 'Schriftlich (Brief)', 'Pflegegrad beantragt', 'Erstantrag auf Pflegeleistungen. Begutachtung am 09.08.2023 in der Wohnung. Pflegegrad 3 ab 01.08.2023 bewilligt.'],
    ['2023-08-14', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhausaufnahme organisieren', 'telefonisch', 'Urosepsis, Notaufnahme', 'Der Ehemann meldet hohes Fieber und Verwirrtheit. Notaufnahme im Kemperhof, Diagnose Urosepsis bei komplizierter Harnwegsinfektion. Frau Nowak willigte selbst in alle Maßnahmen ein.'],
    ['2023-08-28', 'Gesundheit, Pflege & Rehabilitation', 'Sozialdienst Klinik/Einrichtung', 'Beratung, Abstimmung & Hilfeplanung', 'Beratungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Versorgungslücke erkannt', 'Der Sozialdienst weist darauf hin, dass die Katheterversorgung durch den Ehemann nicht fachgerecht möglich ist. Frau Nowak stimmt der Einschaltung eines Pflegedienstes zu, nachdem sie zunächst gezögert hatte.'],
    ['2023-09-01', 'Gesundheit, Pflege & Rehabilitation', 'Ambulanter Pflegedienst', 'Gesundheit, Pflege & Rehabilitation', 'Kontakt / Koordination mit Pflegedienst / Einrichtung', 'persönlich (Hausbesuch)', 'Pflegedienst beginnt', 'Pflegedienst Rhein-Mosel übernimmt zweimal täglich Körperpflege, Katheterversorgung und Medikamentengabe. Erstgespräch mit der Pflegedienstleitung in der Wohnung.'],
    ['2024-02-05', 'Gesundheit, Pflege & Rehabilitation', 'Reha-Einrichtungen', 'Gesundheit, Pflege & Rehabilitation', 'Reha-Maßnahme begleiten', 'Schriftlich (Brief)', 'Neurologische Rehabilitation', 'Sechswöchige Rehabilitation im MEDIAN Reha-Zentrum Bad Salzig. Ziel: Erhalt der Transferfähigkeit. Der Ehemann besuchte täglich.'],
    ['2024-03-18', 'Gesundheit, Pflege & Rehabilitation', 'Reha-Einrichtungen', 'Wohnen, Aufenthalt & Unterbringung', 'Entlassungsmanagement / Überleitung', 'Schriftlich (Brief)', 'Empfehlung Wohnraumanpassung', 'Der Entlassbericht empfiehlt dringend eine barrierefreie Anpassung der Wohnung: Rampe, Türverbreiterungen, bodengleiche Dusche. Ohne Anpassung sei der Verbleib mittelfristig gefährdet.'],
    ['2024-04-22', 'Gesundheit, Pflege & Rehabilitation', 'Sanitätshaus', 'Alltagsorganisation & praktische Unterstützung', 'Organisation von Hilfsmitteln (Rollator, Pflegebett, Hilfsmittelrezept)', 'persönlich (Hausbesuch)', 'Elektrorollstuhl beantragt', 'Anpassung eines Elektrorollstuhls mit Sitzkantelung durch das Sanitätshaus Vitalis. Antrag bei der DAK gestellt.'],
    ['2024-05-15', 'Gesundheit, Pflege & Rehabilitation', 'Krankenkasse / Pflegekasse', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Wohnumfeldverbessernde Maßnahme beantragt', 'Antrag auf Zuschuss nach § 40 Abs. 4 SGB XI. Drei Kostenvoranschläge, Empfehlung der Wohnberatung und der Reha-Entlassbericht beigefügt.'],
    ['2024-06-12', 'Wohnen, Energie & Kommunikation', 'Vermieter:in / Wohnungsunternehmen / Hausverwaltung', 'Wohnen, Aufenthalt & Unterbringung', 'Unterkunftsangelegenheit (Sicherung Unterkunft, Mietrückstände etc.)', 'Schriftlich (Brief)', 'Zustimmung des Vermieters', 'Die Wohnbaugesellschaft Koblenz stimmt dem Umbau schriftlich zu und verzichtet auf einen Rückbau bei Auszug. Ein wesentlicher Erfolg für die Wohnsicherheit.'],
    ['2024-07-30', 'Gesundheit, Pflege & Rehabilitation', 'Krankenkasse / Pflegekasse', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Zuschuss bewilligt', 'Pflegekasse bewilligt 4.180 € für die wohnumfeldverbessernde Maßnahme. Restkosten von 3.860 € bleiben offen; Ratenvereinbarung mit dem Handwerksbetrieb.'],
    ['2024-09-02', 'Wohnen, Energie & Kommunikation', 'Umzugsunternehmen', 'Wohnen, Aufenthalt & Unterbringung', 'Umzug organisieren / begleiten', 'persönlich (Hausbesuch)', 'Umbau begonnen', 'Beginn der Umbauarbeiten durch die Lehnert GmbH. Frau Nowak wohnte während der Bauzeit bei ihrer Schwester in Köln.'],
    ['2024-09-09', 'Sozialleistungsträger & öffentliche Stellen', 'Sozialverwaltungsbehörde', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Assistenzleistungen beantragt', 'Antrag auf Assistenzleistungen zur Teilhabe am gemeinschaftlichen und kulturellen Leben nach § 78 SGB IX, sechs Stunden wöchentlich. Frau Nowak hat den Bedarf selbst beschrieben.'],
    ['2024-11-08', 'Betroffene Person / unmittelbares Umfeld', 'Partnerperson', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Sterbefallmeldung / Nachlassinformation', 'telefonisch', 'Ehemann verstorben', 'Andrzej Nowak verstirbt zu Hause an einem Herzinfarkt. Die Schwester meldet den Sterbefall. Sofortiger Hausbesuch, Organisation des Bestatters und Unterstützung bei den Formalitäten.'],
    ['2024-11-14', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Nachlassgericht', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Sterbefallmeldung / Nachlassinformation', 'Schriftlich (Brief)', 'Nachlass ermittelt', 'Nachlassaufstellung erstellt: Lebensversicherung 18.420 €, Girokonto 4.284 €, hälftiger Miterbenanteil an einem Grundstück in Plaidt. Verbindlichkeiten 6.180 €. Gesetzliche Erbfolge, Erbteil 1/2 neben der Mutter des Erblassers.'],
    ['2024-11-15', 'Wohnen, Energie & Kommunikation', 'Einrichtungsträger (Heim, betreutes Wohnen, besondere Wohnform)', 'Wohnen, Aufenthalt & Unterbringung', 'Wohnungsabnahme / Wohnungsübergabe', 'persönlich (Hausbesuch)', 'Umbau abgenommen', 'Abnahme des barrierefreien Umbaus durch die Wohnberatung der Stadt Koblenz. Rampe, drei verbreiterte Türen, bodengleiche Dusche, unterfahrbare Küche. Frau Nowak kehrt aus Köln zurück.'],
    ['2024-12-04', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Bestattungsunternehmen', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Sterbefallmeldung / Nachlassinformation', 'Schriftlich (Brief)', 'Bestattungskosten', 'Rechnung des Bestattungshauses Sander über 5.240 €. Als Erbin und Totenfürsorgeberechtigte zu tragen; Begleichung nach Auszahlung der Lebensversicherung vorgesehen.'],
    ['2024-12-09', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Annahme der Erbschaft beantragt', 'Antrag auf Genehmigung der Annahme der Erbschaft nach § 1852 Nr. 2 BGB. Nachlassaufstellung und Verkehrswertgutachten des Grundstücks beigefügt.'],
    ['2024-12-16', 'Gesundheit, Pflege & Rehabilitation', 'Psychotherapeut:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'Schriftlich (Brief)', 'Depressive Episode', 'Dr. Petrasch diagnostiziert eine mittelgradige depressive Episode als Trauerreaktion. Beginn mit Duloxetin. Frau Nowak hat sich selbst um den Termin gekümmert.'],
    ['2024-12-20', 'Gesundheit, Pflege & Rehabilitation', 'Ambulanter Pflegedienst', 'Gesundheit, Pflege & Rehabilitation', 'Kontakt / Koordination mit Pflegedienst / Einrichtung', 'telefonisch', 'Pflegedienst aufgestockt', 'Nach dem Wegfall der Unterstützung durch den Ehemann Erhöhung auf dreimal täglich. Abendeinsatz neu.'],
    ['2025-01-16', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Erbschaftsannahme genehmigt', 'Beschluss vom 16.01.2025: Annahme der Erbschaft genehmigt. Rechtskraft 24.01.2025.'],
    ['2025-01-28', 'Gesundheit, Pflege & Rehabilitation', 'Ambulanter Pflegedienst', 'Gesundheit, Pflege & Rehabilitation', 'Pflegevisite / Pflegegespräch', 'telefonisch', 'Dekubitus festgestellt', 'Der Pflegedienst meldet einen Dekubitus Grad 2 am Steißbein, entstanden durch ein defektes Rollstuhlkissen. Sofortige Vorstellung in der Klinik veranlasst.'],
    ['2025-02-11', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Entlassungsmanagement / Überleitung', 'Schriftlich (Brief)', 'Entlassung nach Débridement', 'Entlassung nach chirurgischer Wundversorgung. Wundmanagement über den Pflegedienst, neues Wechseldruck-Sitzkissen beantragt.'],
    ['2025-02-28', 'Finanzen, Vermögen & Schulden', 'Bank / Sparkasse', 'Finanzen, Vermögen & Schulden', 'Kontoeröffnung / Kontoschließung', 'persönlich (Gericht / Behörde)', 'Nachlasskonto aufgelöst', 'Auflösung des Kontos des Erblassers. Guthaben von 4.284 € auf das Girokonto von Frau Nowak übertragen. Lebensversicherung von 18.420 € am 14.01.2025 eingegangen. Bestattungskosten und Steuernachzahlung beglichen.'],
    ['2025-03-04', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Beratung, Abstimmung & Hilfeplanung', 'Anmeldung / Teilnahme an Freizeit- und Teilhabeangeboten', 'persönlich (Hausbesuch)', 'Trauergruppe', 'Frau Nowak beginnt die Teilnahme an der Trauergruppe der Hospizgesellschaft. Sie berichtet, das helfe ihr mehr als die Tabletten.'],
    ['2025-03-14', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Anlage des Nachlasses genehmigt', 'Genehmigung der Anlage von 14.280 € als Tagesgeld mit Zweckbindung für Hilfsmittel und Umbaurestkosten.'],
    ['2025-04-28', 'Gesundheit, Pflege & Rehabilitation', 'Krankenkasse / Pflegekasse', 'Anträge, Verfahren & Rechtliches', 'Widerspruch', 'Schriftlich (Brief)', 'Widerspruch gegen Rollstuhlablehnung', 'Die DAK lehnt die Kostenübernahme für das Wechseldruck-Sitzkissen ab. Widerspruch unter Beifügung des Klinikberichts über den Dekubitus. Rechtsschutzversicherung eingeschaltet.'],
    ['2025-06-19', 'Gesundheit, Pflege & Rehabilitation', 'Krankenkasse / Pflegekasse', 'Anträge, Verfahren & Rechtliches', 'Widerspruch', 'Schriftlich (Brief)', 'Widerspruch erfolgreich', 'Abhilfebescheid der DAK: Sitzkissen wird übernommen. Klageverfahren nicht erforderlich.'],
    ['2025-10-19', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhausaufnahme organisieren', 'telefonisch', 'Pyelonephritis', 'Aufnahme im Katholischen Klinikum wegen einer Nierenbeckenentzündung. Antibiotische Therapie, komplikationsloser Verlauf. Frau Nowak entschied selbst über alle Maßnahmen.'],
    ['2026-01-27', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztbegleitung', 'Schriftlich (Brief)', 'Ocrelizumab-Infusion', 'Halbjährliche Infusion in der MS-Ambulanz. EDSS 7,0 unverändert, kein Schub seit 2023. Fahrdienst über die Krankenkasse.'],
    ['2026-03-17', 'Gesundheit, Pflege & Rehabilitation', 'Psychotherapeut:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'Schriftlich (Brief)', 'Psychische Stabilisierung', 'Dr. Petrasch bescheinigt eine deutliche Besserung gegenüber Dezember 2024. Medikation unverändert, Kontrolle in sechs Monaten.'],
    ['2026-04-08', 'Gesundheit, Pflege & Rehabilitation', 'Hausärzt:in', 'Alltagsorganisation & praktische Unterstützung', 'Organisation von Hilfsmitteln (Rollator, Pflegebett, Hilfsmittelrezept)', 'persönlich (Hausbesuch)', 'Neuversorgung Rollstuhl verordnet', 'Der Elektrorollstuhl von 2024 ist verschlissen. Dr. Sauerwein stellt die Verordnung für eine Neuversorgung aus.'],
    ['2026-04-22', 'Finanzen, Vermögen & Schulden', 'Finanzdienstleister / Vermögensverwaltung', 'Finanzen, Vermögen & Schulden', 'Vermögensübersicht erstellen / aktualisieren', 'Schriftlich (Brief)', 'Verkehrswertgutachten Grundstück', 'Gutachten des Gutachterausschusses: Verkehrswert des unbebauten Grundstücks in Plaidt 21.700 €. Die Miterbin bietet 11.200 € für den hälftigen Anteil.'],
    ['2026-05-11', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'eBO', 'Grundstücksverkauf beantragt', 'Antrag auf Genehmigung der Veräußerung des hälftigen Miterbenanteils zum Preis von 11.200 €. Frau Nowak hat für das Grundstück keine Verwendung und wünscht den Verkauf ausdrücklich. Verkehrswertgutachten und Kaufvertragsentwurf beigefügt.'],
    ['2026-05-22', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Betreuungsspezifischer Vorgang', 'Jahresbericht / Entwicklungsbericht', 'eBO', 'Jahresbericht 2025/2026', 'Bericht und Rechnungslegung für 01.05.2025 bis 30.04.2026 eingereicht. Hinweis auf den Erbfall und die daraus folgende Rechnungslegungspflicht.'],
    ['2026-06-24', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Hausbesuch durchgeführt', 'persönlich (Hausbesuch)', 'Hausbesuch, Persönliches Budget angesprochen', 'Frau Nowak hatte wie immer eine Liste vorbereitet. Sie regt an, die Assistenzleistungen künftig als Persönliches Budget zu beziehen, um die Assistenzkraft selbst auszuwählen. Prüfauftrag angelegt, Beratungstermin bei der EUTB vereinbart. Kontakt- und Zusammenarbeitsprofil aktualisiert.'],
    ['2026-06-30', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'eBO', 'Rollstuhlvertrag zur Genehmigung', 'Antrag auf Genehmigung des Vertrages über die Neuversorgung mit einem Elektrorollstuhl (Eigenanteil 1.840 € für Sitzkantelung und Kopfstütze) nach § 1854 Nr. 4 BGB.'],
    ['2026-07-21', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztbegleitung', 'Schriftlich (E-Mail)', 'Ocrelizumab-Infusion Juli', 'Infusion komplikationslos. Nächste Gabe im Januar 2027.'],
    ['2026-07-24', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Rollstuhlvertrag genehmigt', 'Beschluss vom 24.07.2026: Vertrag genehmigt. Bestellung beim Sanitätshaus Vitalis ausgelöst, Lieferzeit etwa zehn Wochen.'],
    ['2026-08-13', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Hausbesuch durchgeführt', 'persönlich (Hausbesuch)', 'Hausbesuch, Sachstand Grundstück und Rollstuhl', 'Frau Nowak wirkte stabil und gut gelaunt. Sachstand zur Grundstücksveräußerung besprochen, Anhörung am 16.09.2026 angekündigt. Barauszahlung 80 €. Sie las den Entwurf der Erbschaftsteuererklärung und stellte drei Rückfragen zum Freibetrag.']
  ]),

  termine: [
    { titel: 'Anhörung Amtsgericht Koblenz – Grundstücksveräußerung', start: '2026-09-16T10:30:00', ende: '2026-09-16T11:15:00', ort: 'Blücherstraße 62, 56073 Koblenz (Anhörung in der Wohnung)', beschreibung: 'Die Rechtspflegerin hört Frau Nowak in der Wohnung an, weil ein Erscheinen bei Gericht nicht zumutbar ist.' },
    { titel: 'Hausbesuch Frau Nowak', start: '2026-10-07T14:00:00', ende: '2026-10-07T15:15:00', ort: 'Blücherstraße 62, 56073 Koblenz', beschreibung: 'Regelbesuch. Themen: Grundstücksverkauf, Lieferung Elektrorollstuhl, Erbschaftsteuererklärung.' },
    { titel: 'Beratungstermin EUTB – Persönliches Budget', start: '2026-09-29T11:00:00', ende: '2026-09-29T12:30:00', ort: 'EUTB Koblenz, Casinostraße 14, 56068 Koblenz', beschreibung: 'Frau Nowak nimmt mit Assistenz teil; die Betreuung begleitet.' },
    { titel: 'Anpassung und Auslieferung Elektrorollstuhl', start: '2026-10-15T09:30:00', ende: '2026-10-15T11:30:00', ort: 'Blücherstraße 62, 56073 Koblenz', beschreibung: 'Sanitätshaus Vitalis liefert und passt an. Physiotherapeutin Frau Görtz nimmt teil.' },
    { titel: 'Ocrelizumab-Infusion (MS-Ambulanz)', start: '2027-01-26T08:30:00', ende: '2027-01-26T13:00:00', ort: 'Gemeinschaftsklinikum Mittelrhein, MS-Ambulanz, Koblenz', beschreibung: 'Halbjährliche Infusion. Fahrdienst über die Krankenkasse bestellen.' },
    { titel: 'DMSG-Kontaktgruppe Koblenz', start: '2026-09-10T16:00:00', ende: '2026-09-10T18:00:00', ort: 'Hohenfelder Straße 12, 56068 Koblenz', beschreibung: 'Monatliches Treffen. Begleitung durch die Assistenzkraft Frau Duschek.' }
  ],

  aufgaben: [
    { titel: 'Anhörung zur Grundstücksveräußerung vorbereiten', beschreibung: 'Verkehrswertgutachten, Kaufvertragsentwurf und Stellungnahme zur Zweckmäßigkeit bereitlegen. Frau Nowak wünscht, selbst zu sprechen.', faellig: '2026-09-14', prio: 'hoch' },
    { titel: 'Erbschaftsteuererklärung fertigstellen', beschreibung: 'Zusammen mit der Steuerkanzlei Rheinblick. Freibetrag der Ehegattin 500.000 €; voraussichtlich keine Steuer, Erklärung dennoch angefordert.', faellig: '2026-10-12', prio: 'hoch' },
    { titel: 'Lieferung Elektrorollstuhl nachhalten', beschreibung: 'Sanitätshaus Vitalis, Lieferzeit etwa zehn Wochen ab 24.07.2026. Anpassungstermin mit der Physiotherapie abstimmen.', faellig: '2026-10-02', prio: 'normal' },
    { titel: 'Restbetrag Wohnraumanpassung nach Grundstücksverkauf ablösen', beschreibung: 'Restforderung Lehnert GmbH 2.660 €. Nach Eingang des Kaufpreises in einer Summe ablösen und Ratenvereinbarung beenden.', faellig: '2026-11-30', prio: 'normal' },
    { titel: 'Folgeverordnung Physiotherapie anfordern', beschreibung: 'Aktuelle Verordnung endet Ende September. Rezept bei Dr. Sauerwein anfordern, Praxis Görtz informieren.', faellig: '2026-09-18', prio: 'normal' },
    { titel: 'Vergütungsantrag 3. Quartal 2026 stellen', beschreibung: 'Seit dem Erbfall vermögend; Vergütung aus dem Vermögen, eigene Häuslichkeit.', faellig: '2026-08-28', prio: 'normal' },
    { titel: 'Unterlagen für die EUTB-Beratung zusammenstellen', beschreibung: 'Bewilligungsbescheid Assistenzleistungen, Stundennachweise des Assistenzdienstes, Fragenliste von Frau Nowak.', faellig: '2026-09-25', prio: 'niedrig' },
    { titel: 'Wertmarke 2027 rechtzeitig verlängern', beschreibung: 'Gültig bis 28.02.2027; bei Merkzeichen aG unentgeltlich. Antrag im Januar stellen.', faellig: '2027-01-12', prio: 'niedrig' }
  ],

  fahrten: [
    { datum: '2026-06-24', anlass: 'Hausbesuch, Kontakteinschätzung, Persönliches Budget', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Blücherstraße 62, 56073 Koblenz', km: 62.8 },
    { datum: '2026-04-22', anlass: 'Gutachterausschuss, Einsichtnahme Verkehrswertgutachten', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Rathauspassage 2, 56068 Koblenz', km: 60.4 },
    { datum: '2026-08-13', anlass: 'Hausbesuch, Erbschaftsteuererklärung, Barauszahlung', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Blücherstraße 62, 56073 Koblenz', km: 62.8 }
  ],

  rechnungen: [
    { datum: '2026-02-11', nummer: 'RE-2026-0059', empfaenger: 'Halina Nowak, vertreten durch die Betreuung', zweck: 'Betreuervergütung (VBVG, vermögend, eigene Häuslichkeit)', zeitraum: '01.11.2025 - 31.01.2026', summe: 291, eingang: '2026-02-25', eingangsbetrag: 291 },
    { datum: '2026-05-12', nummer: 'RE-2026-0148', empfaenger: 'Halina Nowak, vertreten durch die Betreuung', zweck: 'Betreuervergütung (VBVG, vermögend, eigene Häuslichkeit)', zeitraum: '01.02.2026 - 30.04.2026', summe: 291, eingang: '2026-05-27', eingangsbetrag: 291 },
    { datum: '2026-08-11', nummer: 'RE-2026-0231', empfaenger: 'Halina Nowak, vertreten durch die Betreuung', zweck: 'Betreuervergütung (VBVG, vermögend, eigene Häuslichkeit)', zeitraum: '01.05.2026 - 31.07.2026', summe: 291, eingang: '', eingangsbetrag: null }
  ],

  exporte: [
    L.ausgang(F, 1, {
      datum: '2023-07-20', zeit: '1348', reportId: 'initial', art: 'bericht',
      dokumentTitel: 'Anfangsbericht', exportMode: 'original',
      empfaenger: 'Amtsgericht Koblenz, Karmeliterstraße 14, 56068 Koblenz',
      betreff: 'Betreuung Halina Nowak – Anfangsbericht – Az. 2 XVII 431/23',
      status: 'sent', channel: 'post', notiz: 'Frau Nowak hat den Bericht vor der Einreichung vollständig gelesen und freigegeben.',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Betreuungsspezifischer Vorgang', dokuDetail: 'Berichterstattung',
      inhalt: {
        kopf: ['Amtsgericht Koblenz · Az. 2 XVII 431/23', 'Betreute Person: Halina Nowak, geb. Wisniewska, geb. 30.06.1957', 'Betreuungsbeginn: 21.04.2023 · Berichtsstichtag: 20.07.2023'],
        ortDatum: 'St. Goarshausen, 20.07.2023',
        abschnitte: [
          { titel: '1. Persönliche Situation', felder: [
            ['Meldeanschrift', 'Blücherstraße 62, 56073 Koblenz'],
            ['Art des Aufenthalts', 'eigene Häuslichkeit'],
            ['Schwerwiegende Krankheiten', 'Multiple Sklerose mit primär progredientem Verlauf, Erstdiagnose 2009 nach einer Optikusneuritis, aktuell EDSS 7,0. Neurogene Blasenentleerungsstörung mit intermittierendem Selbstkatheterismus, Spastik und Muskelatrophie der unteren Extremitäten.'],
            ['Fähigkeiten und Ressourcen', 'Frau Nowak ist geistig vollständig präsent, formuliert präzise und bereitet Gespräche vor. Sie hat bis 2014 als Bibliothekarin gearbeitet, kennt ihre Erkrankung genau, kann Befunde einordnen und trifft alle Entscheidungen selbstständig und wohlüberlegt.'],
            ['Beeinträchtigungen', 'Im Vordergrund stehen die körperlichen Einschränkungen: Frau Nowak ist auf einen Rollstuhl angewiesen, Transfers gelingen nur mit Hilfe. Die Feinmotorik der Hände ist so eingeschränkt, dass Handschrift nicht mehr möglich ist und das Ausfüllen von Formularen scheitert.']
          ] },
          { titel: '2. Ziele der Betreuung und Maßnahmen', felder: [
            ['Ziele der Betreuung', 'Sicherung der pflegerischen Versorgung durch Beantragung eines Pflegegrades und Einbindung professioneller Hilfe, um den Ehemann zu entlasten. Klärung der offenen Forderungen. Vorbereitung der barrierefreien Anpassung der Wohnung. Errichtung von Vorsorgedokumenten nach ihrem Willen. Erhalt des selbstbestimmten Wohnens.'],
            ['Ergriffene und geplante Maßnahmen', 'Erhebung sämtlicher offener Forderungen und Ratenvereinbarungen mit beiden Gläubigern. Verordnung und Organisation der Physiotherapie als Hausbesuch. Geplant: Pflegegradantrag, Errichtung von Patientenverfügung, Betreuungsverfügung und Vorsorgevollmacht, Prüfung der Wohnraumanpassung und der Hilfsmittelversorgung.'],
            ['Handeln gegen den Willen der betreuten Person', 'Es wurde nichts gegen den Willen von Frau Nowak veranlasst. Sie entscheidet in allen Angelegenheiten selbst; die Betreuung setzt ihre Entscheidungen um.']
          ] },
          { titel: '3. Wünsche der betreuten Person', felder: [
            ['Kann die betreute Person persönliche Wünsche äußern?', 'ja'],
            ['Wünsche und Erwartungen', 'Frau Nowak wünscht Unterstützung beim Schriftverkehr, bei Anträgen und bei Widerspruchsverfahren. Entscheidungen möchte sie ausnahmslos selbst treffen. Sie legt Wert darauf, dass ihr Ehemann entlastet wird.'],
            ['Was soll verhindert werden?', 'Ein Umzug in ein Pflegeheim kommt für sie unter keinen Umständen in Frage. Ebenso lehnt sie es ab, dass ihr Ehemann sich über seine Kräfte hinaus aufreibt.'],
            ['Erster persönlicher Kontakt', '28.04.2023']
          ] }
        ]
      }
    }),
    L.ausgang(F, 2, {
      datum: '2023-06-12', zeit: '1620', reportId: 'advance_directive', art: 'bericht',
      dokumentTitel: 'Patientenverfügung', exportMode: 'print',
      empfaenger: 'Halina Nowak (Ausfertigung für die verfügende Person)',
      betreff: 'Patientenverfügung Halina Nowak vom 12.06.2023',
      status: 'printed', channel: 'print', notiz: 'Dreifach ausgedruckt: Original für Frau Nowak, Kopien für Hausarzt und Schwester.',
      dokuGruppe: 'Vorsorge, Nachlass & Sterbeangelegenheiten', dokuAkteur: 'Vorsorgeregister / Vorsorgedokumente',
      dokuArt: 'Vorsorge, Nachlass & Sterbeangelegenheiten', dokuDetail: 'Dokumentation von Vollmachten / Patientenverfügung / Vorsorgevollmacht',
      inhalt: {
        kopf: ['Patientenverfügung nach § 1827 BGB', 'Halina Nowak, geb. Wisniewska, geb. 30.06.1957, Blücherstraße 62, 56073 Koblenz'],
        ortDatum: 'Koblenz, 12.06.2023',
        unterschrift: false,
        abschnitte: [
          { titel: 'Motivation und Werte', felder: [
            ['Grundhaltung', 'Solange ich mich mitteilen kann, will ich leben und behandelt werden. Verliere ich diese Fähigkeit dauerhaft, sollen lebensverlängernde Maßnahmen unterbleiben.'],
            ['Bekannte Erkrankungen', 'Multiple Sklerose mit primär progredientem Verlauf seit 2009, neurogene Blasenentleerungsstörung, Spastik der unteren Extremitäten.']
          ] },
          { titel: 'Festlegungen', felder: [
            ['Geltungssituationen', 'Unwiederbringlicher Verlust der Einsichts- und Kommunikationsfähigkeit; Endstadium einer unheilbaren tödlichen Erkrankung; unabwendbarer unmittelbarer Sterbeprozess. Zusätzlich: dauerhafter Verlust der Fähigkeit zur sprachlichen oder gestützten Verständigung.'],
            ['Künstliche Ernährung', 'unterlassen / einstellen'],
            ['Künstliche Flüssigkeitszufuhr', 'unterlassen / einstellen'],
            ['Invasive Beatmung', 'nicht durchführen / einstellen'],
            ['Nicht-invasive Beatmung zur Symptomlinderung', 'ausdrücklich gewünscht'],
            ['Wiederbelebung', 'unterlassen'],
            ['Schmerz- und Symptombehandlung', 'fachgerecht einschließlich bewusstseinsdämpfender Mittel, wenn erforderlich'],
            ['Antibiotika', 'zulassen, solange die Kommunikationsfähigkeit erhalten ist'],
            ['Organspende', 'Zustimmung mit Ausnahme der Augenhornhaut']
          ] },
          { titel: 'Beteiligte und Aufbewahrung', felder: [
            ['Anzuhörende Person', 'Agnieszka Bauer (Schwester), Dürener Straße 187, 50931 Köln – zugleich Vorsorgebevollmächtigte für Gesundheitsangelegenheiten'],
            ['Ärztliche Beratung', 'Prof. Dr. med. Katharina Reisinger (MS-Ambulanz) am 12.06.2023'],
            ['Aufbewahrung', 'Original bei Frau Nowak; Kopien: Fallakte Register 09, Hausarzt Dr. Sauerwein, MS-Ambulanz, Schwester. Eingetragen im Zentralen Vorsorgeregister unter ZVR 6402-3006-57.']
          ] }
        ]
      }
    }),
    L.ausgang(F, 3, {
      datum: '2024-05-15', zeit: '1005', reportId: 'free_document',
      dokumentTitel: 'Freidokument', exportMode: 'letterhead',
      empfaenger: 'DAK-Gesundheit Pflegekasse, Nagelsweg 27-31, 20097 Hamburg',
      empfaengerZeilen: ['DAK-Gesundheit', 'Pflegekasse', 'Nagelsweg 27-31', '20097 Hamburg'],
      betreff: 'Antrag auf Zuschuss zu einer wohnumfeldverbessernden Maßnahme – Halina Nowak – D640230065',
      status: 'sent', channel: 'post',
      dokuGruppe: 'Gesundheit, Pflege & Rehabilitation', dokuAkteur: 'Krankenkasse / Pflegekasse',
      dokuDetail: 'Antragsstellung',
      inhalt: {
        bezug: 'Halina Nowak, geb. 30.06.1957 – Versichertennummer D640230065 – Pflegegrad 3',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'namens von Frau Halina Nowak beantrage ich einen Zuschuss zu Maßnahmen zur Verbesserung des individuellen Wohnumfeldes nach § 40 Abs. 4 SGB XI.\n\nFrau Nowak lebt mit einer primär progredienten Multiplen Sklerose (EDSS 7,0) in einer Erdgeschosswohnung. Der Zugang ist durch zwei Stufen versperrt, das Bad verfügt nur über eine Badewanne, und die Türen zum Bad und zum Schlafzimmer sind für den Rollstuhl zu schmal. Der Entlassbericht des MEDIAN Reha-Zentrums Bad Salzig vom 18.03.2024 empfiehlt die Anpassung ausdrücklich und weist darauf hin, dass der Verbleib in der Wohnung ohne sie mittelfristig gefährdet ist.\n\nGeplant sind eine Außenrampe, die Verbreiterung von drei Türen, der Umbau der Badewanne zu einer bodengleichen Dusche mit Duschklappsitz sowie eine unterfahrbare Küchenzeile. Drei Kostenvoranschläge und die Empfehlung der Wohnberatung der Stadt Koblenz liegen bei. Die Vermieterin hat dem Umbau am 12.06.2024 schriftlich zugestimmt und verzichtet auf einen Rückbau.\n\nIch bitte um Bewilligung des Höchstbetrages und um Nachricht, sobald mit den Arbeiten begonnen werden darf.',
        anlagen: ['Entlassbericht MEDIAN Reha-Zentrum Bad Salzig vom 18.03.2024', 'Drei Kostenvoranschläge', 'Empfehlung der Wohnberatung der Stadt Koblenz', 'Zustimmung der Vermieterin']
      }
    }),
    L.ausgang(F, 4, {
      datum: '2026-02-18', zeit: '0930', reportId: 'rent_certificate', art: 'bericht',
      dokumentTitel: 'Mietbescheinigung', exportMode: 'original',
      empfaenger: 'Wohnbaugesellschaft Koblenz mbH, Neustadt 18, 56068 Koblenz',
      betreff: 'Mietbescheinigung Halina Nowak – Blücherstraße 62, 56073 Koblenz',
      mail: 'service@wohnbau-koblenz.de',
      status: 'sent', channel: 'mail', notiz: 'Von der Vermieterin am 25.02.2026 ausgefüllt zurückgesandt.',
      dokuGruppe: 'Wohnen, Energie & Kommunikation', dokuAkteur: 'Vermieter:in / Wohnungsunternehmen / Hausverwaltung',
      dokuArt: 'Wohnen, Aufenthalt & Unterbringung', dokuDetail: 'Unterkunftsangelegenheit (Sicherung Unterkunft, Mietrückstände etc.)',
      inhalt: {
        kopf: ['Mietbescheinigung', 'Halina Nowak, Blücherstraße 62, 56073 Koblenz'],
        ortDatum: 'St. Goarshausen, 18.02.2026',
        abschnitte: [
          { titel: 'Mietverhältnis', felder: [
            ['Mieterin', 'Halina Nowak'], ['Anschrift', 'Blücherstraße 62, 56073 Koblenz, Erdgeschoss links'],
            ['Mietverhältnis seit', '01.03.2011'], ['Stellung', 'Hauptmieterin'],
            ['Wohnfläche', '78 m²'], ['Zimmer', '3'], ['Bewohnerzahl', '1']
          ] },
          { titel: 'Kosten', felder: [
            ['Grundmiete', '684,00 €'], ['Betriebskostenvorauszahlung', '184,00 €'],
            ['Heizkostenvorauszahlung (Fernwärme)', '96,00 €'], ['Gesamtwarmmiete', '964,00 €'],
            ['Heizung', 'Fernwärme über die Energieversorgung Mittelrhein AG, zentrale Warmwasserbereitung, Verbrauchserfassung über Wärmemengenzähler je Wohnung'],
            ['Hinweis', 'Strom wird direkt mit der Energieversorgung Mittelrhein abgerechnet und beträgt derzeit 78,00 € monatlich.']
          ] }
        ]
      }
    }),
    L.ausgang(F, 5, {
      datum: '2026-05-11', zeit: '1442', reportId: 'court_approval',
      dokumentTitel: 'Betreuungsgerichtliche Genehmigung', exportMode: 'letterhead',
      empfaenger: 'Amtsgericht Koblenz, Karmeliterstraße 14, 56068 Koblenz',
      empfaengerZeilen: ['Amtsgericht Koblenz', '- Betreuungsgericht -', 'Karmeliterstraße 14', '56068 Koblenz'],
      betreff: 'Betreuung Halina Nowak – Antrag auf Genehmigung einer Grundstücksveräußerung – Az. 2 XVII 431/23',
      status: 'sent', channel: 'ebo', notiz: 'Anhörung von Frau Nowak in der Wohnung für den 16.09.2026 angekündigt.',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuDetail: 'Genehmigungsantrag',
      inhalt: {
        bezug: 'Betreuungssache Halina Nowak – Az. 2 XVII 431/23',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'namens der betreuten Person beantrage ich die Genehmigung der Veräußerung ihres hälftigen Miterbenanteils an dem unbebauten Grundstück in 56637 Plaidt, Gemarkung Plaidt, Flur 4, Flurstück 118, Größe 620 m², an die Miterbin Frau Krystyna Nowak zum Kaufpreis von 11.200,00 €.\n\nDas Grundstück stammt aus dem Nachlass des am 08.11.2024 verstorbenen Ehemannes. Frau Nowak ist zu einem Anteil von 1/2 Miterbin neben der Mutter des Erblassers. Das Grundstück ist unbebaut, nicht erschlossen und wird nicht genutzt; es verursacht Grundsteuer und Pflegeaufwand. Für Frau Nowak, die auf einen Rollstuhl angewiesen ist und in Koblenz lebt, hat es keinerlei Nutzen.\n\nDer Gutachterausschuss hat den Verkehrswert der Gesamtfläche mit Gutachten vom 22.04.2026 auf 21.700,00 € festgesetzt; der hälftige Anteil entspricht damit 10.850,00 €. Der angebotene Kaufpreis liegt darüber. Eine Teilungsversteigerung wäre wirtschaftlich nachteilig und würde das Verhältnis zur Miterbin belasten.\n\nFrau Nowak wünscht den Verkauf ausdrücklich und hat den Kaufvertragsentwurf selbst gelesen und mit Erklärung vom 08.05.2026 freigegeben. Der Erlös soll zur Ablösung der Restforderung aus der Wohnraumanpassung und zur Aufstockung der Hilfsmittelrücklage verwendet werden.',
        anlagen: ['Verkehrswertgutachten des Gutachterausschusses vom 22.04.2026', 'Entwurf des notariellen Kaufvertrages', 'Erbschein vom 05.02.2025', 'Nachlassverzeichnis', 'Erklärung von Frau Nowak vom 08.05.2026']
      }
    }),
    L.ausgang(F, 6, {
      datum: '2026-05-22', zeit: '1130', reportId: 'annual_assets', art: 'bericht',
      dokumentTitel: 'Jahresbericht mit Vermögenssorge', exportMode: 'combined',
      empfaenger: 'Amtsgericht Koblenz, Karmeliterstraße 14, 56068 Koblenz',
      betreff: 'Betreuung Halina Nowak – Jahresbericht 01.05.2025 – 30.04.2026 – Az. 2 XVII 431/23',
      status: 'sent', channel: 'ebo', notiz: 'Vor der Einreichung am 20.05.2026 gemeinsam mit Frau Nowak durchgegangen.',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Betreuungsspezifischer Vorgang', dokuDetail: 'Jahresbericht / Entwicklungsbericht',
      inhalt: {
        kopf: ['Amtsgericht Koblenz · Az. 2 XVII 431/23', 'Betreute Person: Halina Nowak, geb. 30.06.1957', 'Berichtszeitraum: 01.05.2025 bis 30.04.2026'],
        ortDatum: 'St. Goarshausen, 22.05.2026',
        abschnitte: [
          { titel: 'A. Persönliche Verhältnisse', felder: [
            ['Ständiger Aufenthalt', 'Blücherstraße 62, 56073 Koblenz'],
            ['Heimunterbringung', 'nein'],
            ['Persönlicher Eindruck', 'Frau Nowak war im Berichtszeitraum psychisch deutlich stabiler als im Vorjahr. Die Trauerreaktion nach dem Tod ihres Mannes im November 2024 hat sich mit medikamentöser Behandlung und der Trauergruppe weitgehend zurückgebildet. Körperlich ist der Zustand bei einem EDSS von 7,0 unverändert; ein Schub ist seit 2023 nicht aufgetreten.'],
            ['Entwicklung des Zustands', 'nicht verändert'],
            ['Bewertung der weiteren Betreuung', 'weiter erforderlich']
          ] },
          { titel: 'B. Wirtschaftliche Verhältnisse', felder: [
            ['Heim-, Unterbringungs- oder Mietkosten pro Monat', '946,00 €'],
            ['Kostenträger der Unterkunft', 'Eigene Einkünfte (Erwerbsminderungs- und Witwenrente)'],
            ['Erworbene oder geerbte Sachen und Rechte', 'Aus dem Nachlass des am 08.11.2024 verstorbenen Ehemannes ein hälftiger Miterbenanteil an einem unbebauten Grundstück in Plaidt sowie eine Lebensversicherung über 18.420,00 € und ein Kontoguthaben von 4.284,00 €.'],
            ['Genehmigungspflichtige Tätigkeiten', 'Antrag auf Genehmigung der Veräußerung des Miterbenanteils vom 11.05.2026 (Entscheidung steht aus) und Antrag auf Genehmigung des Vertrages über die Neuversorgung mit einem Elektrorollstuhl vom 30.06.2026.']
          ] },
          { titel: 'C. Tätigkeit des Betreuers', felder: [
            ['Sonstige berichtenswerte Entwicklungen', 'Die Wohnraumanpassung ist seit November 2024 abgeschlossen und hat sich als tragfähig erwiesen. Die Assistenzleistungen mit sechs Wochenstunden haben die Teilhabe spürbar verbessert: Frau Nowak besucht wieder Theater und Konzerte und nimmt monatlich an der DMSG-Kontaktgruppe teil.'],
            ['Besprochen mit der betreuten Person', 'ja, am 20.05.2026']
          ] }
        ]
      }
    }),
    L.ausgang(F, 7, {
      datum: '2026-08-11', zeit: '1015', reportId: 'remuneration_pdf', art: 'bericht',
      dokumentTitel: 'Betreuervergütungen', exportMode: 'original',
      empfaenger: 'Amtsgericht Koblenz, Karmeliterstraße 14, 56068 Koblenz',
      betreff: 'Betreuung Halina Nowak – Vergütungsantrag 01.05.2026 – 31.07.2026 – Az. 2 XVII 431/23',
      status: 'prepared', vorbereitet: 'ebo', notiz: 'Frau Nowak hat der Entnahme aus dem Vermögen am 13.08.2026 zugestimmt; Versand danach.',
      dokuGruppe: 'Büroorganisation / interne Bearbeitung', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Büroorganisation / interne Bearbeitung', dokuDetail: 'Berichterstattung',
      inhalt: {
        kopf: ['Amtsgericht Koblenz · Az. 2 XVII 431/23', 'Betreute Person: Halina Nowak, geb. 30.06.1957'],
        ortDatum: 'St. Goarshausen, 11.08.2026',
        abschnitte: [
          { titel: 'Abrechnungsabschnitt', felder: [
            ['Zeitraum', '01.05.2026 bis 31.07.2026'],
            ['Vergütungsstufe', '2 (ab dem 25. Monat der Betreuung)'],
            ['Wohnform', 'eigene Häuslichkeit'],
            ['Vermögensstatus', 'vermögend seit dem Erbfall im Januar 2025 – Entnahme aus dem Vermögen'],
            ['Monatliche Pauschale', '97,00 €'],
            ['Gesamtbetrag', '291,00 €']
          ] },
          { titel: 'Ergänzende Angaben', felder: [
            ['Grundlage', '§ 9 VBVG, Vergütungstabelle A'],
            ['Anlagen', 'Kontoauszug des Verwaltungskontos zum 31.07.2026, Vermögensübersicht zum Stichtag 31.07.2026']
          ] }
        ]
      }
    })
  ],

  archive: [
    L.archiv(F, 1, {
      reportId: 'initial', titel: 'Anfangsbericht', archiviertAm: '2023-07-20', zeit: '13:48',
      erstelltAm: '2023-06-05', von: '21.04.2023', bis: '20.07.2023',
      name: '230720 1348 Amtsgericht Koblenz Anfangsbericht',
      notiz: 'Beim Betreuungsgericht eingereichte Fassung; von Frau Nowak vor der Einreichung vollständig gelesen und freigegeben.',
      felder: {
        registered_address: 'Blücherstraße 62, 56073 Koblenz',
        care_level: '',
        relationship: 'Das Verhältnis ist von Beginn an partnerschaftlich und sachlich. Frau Nowak hat die Betreuung selbst angeregt und die Aufgabenkreise mitformuliert. Beim Erstgespräch hat sie klargestellt: „Ich möchte, dass Sie schreiben, was ich entscheide."',
        goals: 'Sicherung der pflegerischen Versorgung und Entlastung des Ehemannes. Klärung der offenen Forderungen. Vorbereitung der barrierefreien Wohnraumanpassung. Errichtung von Vorsorgedokumenten. Erhalt des selbstbestimmten Wohnens.',
        measures: 'Erhebung sämtlicher offener Forderungen und Ratenvereinbarungen. Organisation der Physiotherapie als Hausbesuch. Geplant: Pflegegradantrag, Vorsorgedokumente, Wohnraumanpassung, Hilfsmittelversorgung.',
        against_will: 'Es wurde nichts gegen den Willen von Frau Nowak veranlasst.',
        first_contact: '2023-04-28',
        contact_count: 4
      }
    }),
    L.archiv(F, 2, {
      reportId: 'annual_assets', titel: 'Jahresbericht mit Vermögenssorge', archiviertAm: '2025-05-26', zeit: '15:02',
      erstelltAm: '2025-04-28', von: '01.05.2024', bis: '30.04.2025',
      name: '250526 1502 Amtsgericht Koblenz Jahresbericht mit Vermögenssorge',
      notiz: 'Eingereichter Jahresbericht 2024/2025 – erster Bericht nach dem Tod des Ehemannes und mit Rechnungslegung.',
      felder: {
        residence: 'Blücherstraße 62, 56073 Koblenz',
        home_placement: 'nein',
        closed_unit: 'nein',
        personal_impression: 'Der Berichtszeitraum war von zwei Einschnitten geprägt: dem Abschluss der barrierefreien Wohnraumanpassung im November 2024 und dem plötzlichen Tod des Ehemannes am 08.11.2024. Frau Nowak hat mit einer mittelgradigen depressiven Episode reagiert, die seit Dezember 2024 behandelt wird. Der Dekubitus im Januar 2025 entstand durch ein defektes Rollstuhlkissen und ist im April 2025 abgeheilt.',
        condition_change: 'verschlechtert',
        care_need: 'weiter erforderlich',
        housing_costs: '928,00',
        acquisitions: 'Aus dem Nachlass des Ehemannes: Lebensversicherung 18.420,00 €, Kontoguthaben 4.284,00 €, hälftiger Miterbenanteil an einem unbebauten Grundstück in Plaidt.',
        legal_activities: 'Annahme der Erbschaft, genehmigt mit Beschluss vom 16.01.2025. Anlage des Nachlasserlöses als zweckgebundenes Tagesgeld, genehmigt mit Beschluss vom 14.03.2025.',
        discussed: 'ja',
        discussed_date: '2025-05-19'
      }
    }),
    L.archiv(F, 3, {
      reportId: 'annual_assets', titel: 'Jahresbericht mit Vermögenssorge', archiviertAm: '2026-05-22', zeit: '11:30',
      erstelltAm: '2026-04-27', von: '01.05.2025', bis: '30.04.2026',
      name: '260522 1130 Amtsgericht Koblenz Jahresbericht mit Vermögenssorge',
      notiz: 'Eingereichte Fassung 2025/2026 – Vorbericht für den laufenden Berichtszeitraum.',
      felder: {
        residence: 'Blücherstraße 62, 56073 Koblenz',
        home_placement: 'nein',
        closed_unit: 'nein',
        personal_impression: 'Frau Nowak war im Berichtszeitraum psychisch deutlich stabiler als im Vorjahr. Körperlich ist der Zustand bei einem EDSS von 7,0 unverändert; ein Schub ist seit 2023 nicht aufgetreten. Bemerkenswert ist ihre Eigeninitiative: Die Anregung, die Assistenzleistungen künftig als Persönliches Budget zu beziehen, kam von ihr.',
        condition_change: 'nicht verändert',
        care_need: 'weiter erforderlich',
        housing_costs: '946,00',
        other_report: 'Die Wohnraumanpassung hat sich als tragfähig erwiesen. Die Restkosten von zunächst 3.860,00 € werden in Raten getilgt und sollen nach dem Grundstücksverkauf abgelöst werden. Die Assistenzleistungen haben die Teilhabe spürbar verbessert.',
        discussed: 'ja',
        discussed_date: '2026-05-20'
      }
    })
  ],

  berichte: {
    initial: L.bericht({
      registered_address: 'Blücherstraße 62, 56073 Koblenz',
      current_residence: 'Blücherstraße 62, 56073 Koblenz (eigene Wohnung, gemeinsam mit dem Ehemann)',
      residence_type: ['eigene Häuslichkeit'],
      planned_housing_changes: 'Ein Umzug ist nicht geplant und wird von Frau Nowak ausdrücklich abgelehnt. Absehbar ist jedoch ein Anpassungsbedarf: Zwei Stufen am Hauseingang, eine Badewanne und zu schmale Türen erschweren die Rollstuhlnutzung bereits jetzt.',
      housing_notes: 'Dreizimmerwohnung mit 78 m² im Erdgeschoss, Mietvertrag seit 2011. Die Wohnung ist gut geschnitten und grundsätzlich für eine barrierefreie Anpassung geeignet.',
      treating_doctors: 'Prof. Dr. med. Katharina Reisinger, Neurologie/MS-Ambulanz, GK Mittelrhein Koblenz, 0261/4962880\nDr. med. Bernd Sauerwein, Allgemeinmedizin, Löhrstraße 88, 56068 Koblenz, 0261/3374120\nDr. med. Anette Kilian, Urologie, MVZ Rhein-Mosel, 0261/9928140',
      severe_diseases: 'Multiple Sklerose mit primär progredientem Verlauf, Erstdiagnose 2009 nach einer Optikusneuritis, aktuell EDSS 7,0. Neurogene Blasenentleerungsstörung mit intermittierendem Selbstkatheterismus, Spastik und Muskelatrophie der unteren Extremitäten, chronische Obstipation bei neurogener Darmstörung.',
      treatment_care: 'Halbjährliche Infusionstherapie mit Ocrelizumab in der MS-Ambulanz seit 2019. Antispastische Behandlung mit Baclofen und Tizanidin. Hausärztliche Versorgung durch Dr. Sauerwein. Bis zur Betreuungsübernahme wurde die Pflege ausschließlich durch den Ehemann geleistet; ein Pflegegrad war nicht beantragt.',
      resources: 'Frau Nowak ist geistig vollständig präsent, formuliert präzise und bereitet Gespräche vor. Sie hat bis 2014 als Bibliothekarin gearbeitet, liest viel und verfolgt das Zeitgeschehen. Sie kennt ihre Erkrankung genau, kann Befunde einordnen und trifft alle Entscheidungen selbstständig und wohlüberlegt. Der Ehemann unterstützt sie täglich; zur Schwester in Köln besteht enger Kontakt.',
      impairments: 'Im Vordergrund stehen die körperlichen Einschränkungen: Frau Nowak ist auf einen Rollstuhl angewiesen, Transfers gelingen nur mit Hilfe. Die Feinmotorik der Hände ist so eingeschränkt, dass Handschrift nicht mehr möglich ist und das Ausfüllen von Formularen scheitert. Längeres Lesen ermüdet wegen der Restvisusminderung rechts. Die Erkrankung schreitet fort; eine Besserung ist nicht zu erwarten.',
      care_level: '',
      care_allowance: 'nicht beantragt',
      health_notes: 'Ein Pflegegrad ist bislang nicht beantragt, obwohl der Bedarf offenkundig besteht. Der Antrag ist vordringlich.',
      relatives: 'Andrzej Nowak (Ehemann), Blücherstraße 62, 56073 Koblenz\nAgnieszka Bauer (Schwester), Dürener Straße 187, 50931 Köln, 0221/8841207\nJulia Bauer (Nichte), Köln',
      family_situation: 'Frau Nowak ist seit 1982 verheiratet; das Ehepaar ist 1989 aus Polen nach Deutschland gekommen. Kinder gibt es nicht. Der Ehemann ist 70 Jahre alt und übernimmt die tägliche Pflege; er wirkt dabei zunehmend belastet. Die Schwester lebt in Köln und kommt etwa monatlich.',
      social_contacts: 'Kontakt zu einer Nachbarin im Haus, die Post und kleine Besorgungen übernimmt. Frühere Kolleginnen aus der Bibliothek melden sich noch gelegentlich. Eine Anbindung an die MS-Selbsthilfegruppe besteht bislang nicht.',
      relationship: 'Das Verhältnis ist von Beginn an partnerschaftlich und sachlich. Frau Nowak hat die Betreuung selbst angeregt und die Aufgabenkreise mitformuliert. Sie hat beim Erstgespräch klargestellt: „Ich möchte, dass Sie schreiben, was ich entscheide." Daran orientiert sich die Zusammenarbeit.',
      social_notes: 'Frau Nowak legt Wert darauf, jeden Antrag vor der Absendung selbst zu lesen. Unterlagen werden ihr deshalb vorab per E-Mail geschickt.',
      employment_status: 'erwerbsgemindert',
      employer_occupation: 'Bis 2014 Bibliothekarin bei der Stadtbibliothek Koblenz; seither Rente wegen voller Erwerbsminderung',
      daily_life: 'Der Tag beginnt spät, weil Aufstehen und Körperpflege viel Zeit brauchen. Vormittags liest Frau Nowak oder erledigt Korrespondenz am Tablet, nachmittags kommt zweimal wöchentlich die Physiotherapie. Der Ehemann übernimmt Einkauf und Haushalt. Ausflüge sind selten, weil die Begleitung fehlt.',
      goals: 'Sicherung der pflegerischen Versorgung durch Beantragung eines Pflegegrades und Einbindung professioneller Hilfe, um den Ehemann zu entlasten. Klärung und Erledigung der offenen Forderungen aus liegen gebliebenem Schriftverkehr. Vorbereitung der barrierefreien Anpassung der Wohnung. Errichtung von Vorsorgedokumenten nach ihrem Willen. Erhalt des selbstbestimmten Wohnens.',
      measures: 'Erhebung sämtlicher offener Forderungen und Ratenvereinbarungen mit beiden Gläubigern. Verordnung und Organisation der Physiotherapie als Hausbesuch. Geplant: Antrag auf Pflegeleistungen, Errichtung von Patientenverfügung, Betreuungsverfügung und Vorsorgevollmacht, Prüfung der Wohnraumanpassung und der Hilfsmittelversorgung.',
      against_will: 'Es wurde bisher nichts gegen den Willen von Frau Nowak veranlasst. Sie entscheidet in allen Angelegenheiten selbst; die Betreuung setzt ihre Entscheidungen um.',
      special_matters: 'Zu klären sind die Hilfsmittelversorgung mit einem Elektrorollstuhl und die Frage, ob der Ehemann die Pflege dauerhaft leisten kann.',
      goal_notes: 'Vorrang haben der Pflegegradantrag und die Entlastung des Ehemannes.',
      can_express_wishes: 'ja',
      wishes_care: 'Frau Nowak wünscht Unterstützung beim Schriftverkehr, bei Anträgen und bei Widerspruchsverfahren. Entscheidungen möchte sie ausnahmslos selbst treffen. Sie legt Wert darauf, dass ihr Ehemann entlastet wird.',
      wishes_assets: 'Sie möchte über den laufenden Bedarf frei verfügen und einen monatlichen Betrag erhalten, über den sie nicht abrechnet. Größere Anschaffungen bespricht sie vorher.',
      desired_outcome: 'In der eigenen Wohnung bleiben, den Alltag selbst bestimmen und wieder am kulturellen Leben teilnehmen können.',
      prevent_outcome: 'Ein Umzug in ein Pflegeheim kommt für sie unter keinen Umständen in Frage. Ebenso lehnt sie es ab, dass ihr Ehemann sich über seine Kräfte hinaus aufreibt.',
      unfulfillable_wishes: 'Derzeit sind keine Wünsche unerfüllbar.',
      self_managed_assets: 'Frau Nowak verwaltet ihr Monatsgeld vollständig selbst und entscheidet über alle Ausgaben. Die Betreuung führt lediglich die Überweisungen aus, weil ihr das Unterschreiben und die Bedienung des Online-Bankings schwerfallen.',
      first_contact: '2023-04-28',
      contact_count: 4,
      future_contacts: 'alle sechs bis acht Wochen als Hausbesuch, dazwischen laufend per E-Mail und Telefon',
      can_initiate_contact: 'ja',
      contact_limit_reason: '',
      contact_notes: 'Frau Nowak nutzt Telefon, E-Mail und Sprachnachrichten und meldet sich zuverlässig selbst.'
    }, '2023-07-20'),

    annual_assets: L.bericht({
      residence: 'Blücherstraße 62, 56073 Koblenz',
      home_placement: 'nein',
      closed_unit: 'nein',
      care_providers: ['ambulante Pflegedienste', 'versorgt sich selbst', 'sonstige'],
      personal_impression: 'Frau Nowak war im Berichtszeitraum psychisch deutlich stabiler als im Vorjahr. Die Trauerreaktion nach dem Tod ihres Mannes im November 2024 hat sich mit medikamentöser Behandlung und der Trauergruppe weitgehend zurückgebildet; Dr. Petrasch bescheinigt dies in seinem Befund vom 17.03.2026. Körperlich ist der Zustand bei einem EDSS von 7,0 unverändert; ein Schub ist seit 2023 nicht aufgetreten. Bei beiden Hausbesuchen wirkte sie zugewandt, gut informiert und hatte jeweils eine schriftliche Liste offener Punkte vorbereitet. Bemerkenswert ist ihre Eigeninitiative: Die Anregung, die Assistenzleistungen künftig als Persönliches Budget zu beziehen, kam von ihr.',
      condition_change: 'nicht verändert',
      care_need: 'weiter erforderlich',
      care_need_reason: 'Die Betreuung ist ausschließlich wegen der körperlichen Einschränkungen erforderlich, nicht wegen einer Beeinträchtigung der Willensbildung. Frau Nowak ist uneingeschränkt einwilligungs- und geschäftsfähig; sie trifft sämtliche Entscheidungen selbst. Aufgrund der Feinmotorikstörung kann sie jedoch nicht mehr von Hand schreiben, keine Formulare ausfüllen und keine Unterschriften ohne Hilfsmittel leisten. Im Berichtszeitraum waren die Abwicklung des Erbfalls, ein Genehmigungsverfahren zur Grundstücksveräußerung, ein Widerspruchsverfahren gegen die Krankenkasse und die Beschaffung eines Elektrorollstuhls zu bearbeiten – Vorgänge mit erheblichem Schriftverkehr. Eine Aufhebung der Betreuung kommt daher nicht in Betracht; eine Erweiterung ist ebenfalls nicht erforderlich.',
      last_contact: '2026-08-13',
      contact_frequency: 'nach Bedarf',
      contact_description: 'Im Berichtszeitraum fanden sechs persönliche Hausbesuche statt, dazu laufender Austausch per E-Mail und Telefon, im Schnitt zweimal wöchentlich. Frau Nowak bereitet jedes Gespräch vor und erhält alle Unterlagen vorab per E-Mail, damit sie sie in eigenem Tempo lesen kann. Kein Antrag und kein Schriftsatz wird abgesandt, ohne dass sie ihn zuvor freigegeben hat. Bei der Anhörung zur Grundstücksveräußerung hat sie ausdrücklich darum gebeten, selbst zu sprechen.',
      assets_detail: [],
      custody_cash_control: [],
      income_detail: [],
      housing_costs: '946,00',
      housing_cost_carrier: 'Eigene Einkünfte (Erwerbsminderungs- und Witwenrente)',
      acquisitions: 'Aus dem Nachlass des am 08.11.2024 verstorbenen Ehemannes ist ein hälftiger Miterbenanteil an einem unbebauten Grundstück in Plaidt, Flur 4 Nr. 118, zugefallen (Verkehrswert der Gesamtfläche 21.700 €). Außerdem wurden eine Lebensversicherung über 18.420 € und ein Kontoguthaben von 4.284 € vereinnahmt. Angeschafft wurde ein Wechseldruck-Sitzkissen nach dem Dekubitus.',
      legal_activities: 'Antrag auf Genehmigung der Veräußerung des Miterbenanteils vom 11.05.2026, Entscheidung steht aus. Antrag auf Genehmigung des Vertrages über die Neuversorgung mit einem Elektrorollstuhl vom 30.06.2026, genehmigt durch Beschluss vom 24.07.2026. Zwei Gelegenheitsschenkungen (200 € an die Nichte zum 25. Geburtstag, 50 € Spende an die DMSG-Kontaktgruppe) wurden nach § 1854 Nr. 8 BGB als angemessen eingeordnet.',
      other_report: 'Die Wohnraumanpassung ist seit November 2024 abgeschlossen und hat sich als tragfähig erwiesen; die Wohnung ist vollständig barrierefrei. Die Restkosten von zunächst 3.860 € werden in Raten getilgt und sollen nach dem Grundstücksverkauf in einer Summe abgelöst werden. Die Assistenzleistungen mit sechs Wochenstunden haben die Teilhabe spürbar verbessert: Frau Nowak besucht wieder Theater und Konzerte und nimmt monatlich an der DMSG-Kontaktgruppe teil.',
      discussed: 'ja',
      discussed_date: '2026-05-20',
      discussed_reason: '',
      view_contacts: 'Frau Nowak hält die Kontaktdichte für angemessen und schätzt besonders, dass Rückfragen per E-Mail kurzfristig beantwortet werden. Sie hat angeregt, den Jahresbericht künftig vor der Einreichung gemeinsam durchzugehen – dies wurde umgesetzt.',
      view_goals: 'Sie teilt die Ziele uneingeschränkt und hat sie im Wesentlichen selbst formuliert. Beim Thema Persönliches Budget möchte sie ergebnisoffen prüfen und betont, dass sie die Verantwortung für die Abrechnung nicht unterschätzt.',
      view_need: 'Frau Nowak hält die Betreuung weiterhin für erforderlich und hat dies bei der Besprechung des Berichts am 20.05.2026 ausdrücklich bestätigt: Ohne Unterstützung beim Schriftverkehr wäre sie „aufgeschmissen". Eine Erweiterung der Aufgabenkreise lehnt sie ab.'
    }, '2026-05-22'),

    court_approval: L.bericht({
      ca_art: 'Genehmigung der Veräußerung eines Miterbenanteils an einem Grundstück',
      ca_rechtsgrundlage: 'Vermögensangelegenheit (§§ 1848 ff. BGB)',
      ca_vorgang: 'Veräußerung des hälftigen Miterbenanteils an dem unbebauten Grundstück in 56637 Plaidt, Gemarkung Plaidt, Flur 4, Flurstück 118, Größe 620 m², an die Miterbin Frau Krystyna Nowak zum Kaufpreis von 11.200,00 €.',
      ca_wille: 'Einwilligung',
      ca_begruendung: 'Das Grundstück stammt aus dem Nachlass des am 08.11.2024 verstorbenen Ehemannes. Frau Nowak ist zu einem Anteil von 1/2 Miterbin neben der Mutter des Erblassers. Das Grundstück ist unbebaut, nicht erschlossen und wird nicht genutzt; es verursacht Grundsteuer und Pflegeaufwand. Für Frau Nowak, die auf einen Rollstuhl angewiesen ist und in Koblenz lebt, hat es keinerlei Nutzen. Die Miterbin möchte den Anteil übernehmen, um das Grundstück in der Familie zu halten. Der Gutachterausschuss hat den Verkehrswert der Gesamtfläche mit Gutachten vom 22.04.2026 auf 21.700 € festgesetzt; der hälftige Anteil entspricht damit 10.850 €. Der angebotene Kaufpreis von 11.200 € liegt darüber. Eine Teilungsversteigerung wäre wirtschaftlich nachteilig und würde das Verhältnis zur Miterbin belasten. Frau Nowak wünscht den Verkauf ausdrücklich und hat den Kaufvertragsentwurf selbst gelesen und freigegeben. Der Erlös soll zur Ablösung der Restforderung aus der Wohnraumanpassung und zur Aufstockung der Hilfsmittelrücklage verwendet werden.',
      ca_ergaenzung: 'Beigefügt: Verkehrswertgutachten des Gutachterausschusses vom 22.04.2026, Entwurf des notariellen Kaufvertrages, Erbschein vom 05.02.2025, Nachlassverzeichnis, Erklärung von Frau Nowak vom 08.05.2026.'
    }, '2026-05-11'),

    remuneration: L.bericht({
      rem_stage: '2',
      rem_request_type: 'Folgeantrag',
      rem_continuous: 'nein'
    }, '2026-08-11'),

    remuneration_pdf: L.bericht({
      remuneration_pdf_name: 'Halina Nowak',
      remuneration_pdf_birth: '1957-06-30',
      remuneration_pdf_address: 'Blücherstraße 62, 56073 Koblenz',
      remuneration_pdf_reference: '2 XVII 431/23',
      remuneration_pdf_details: 'Vergütungsabschnitt 01.05.2026 bis 31.07.2026. Vergütung nach § 9 VBVG, Vergütungstabelle A (eigene Häuslichkeit), Vergütungsstufe 2, ab dem 25. Monat der Betreuung. Monatliche Pauschale 97,00 €, Abrechnungszeitraum drei Monate, Gesamtbetrag 291,00 €. Frau Nowak ist seit dem Erbfall im Januar 2025 nicht mehr mittellos; die Vergütung wird aus dem Vermögen entnommen.',
      remuneration_pdf_attachments: 'Kontoauszug des Verwaltungskontos zum 31.07.2026, Vermögensübersicht zum Stichtag 31.07.2026.',
      remuneration_pdf_notes: 'Frau Nowak wurde über die Entnahme aus dem Vermögen unterrichtet und hat ihr am 13.08.2026 ausdrücklich zugestimmt.'
    }, '2026-08-11'),

    asset_inventory: L.bericht({
      avi_court: 'Amtsgericht Koblenz',
      avi_file_number: '2 XVII 431/23',
      avi_person: 'Halina Nowak, geb. Wisniewska',
      avi_birth: '1957-06-30',
      avi_date: '2023-04-21',
      avi_monthly_expenses: '1584,60',
      avi_notes: 'Vermögensverzeichnis zum Stichtag des Betreuungsbeginns. Zum Stichtag bestand kein Grundvermögen; der hälftige Miterbenanteil an dem unbebauten Grundstück in Plaidt (Gemarkung Plaidt, Flur 4, Flurstück 118, 620 m²) ist erst durch den Erbfall nach dem am 08.11.2024 verstorbenen Ehemann hinzugekommen und in der Fortschreibung vom 14.11.2024 nachgetragen. Ebenfalls nachgetragen sind die Lebensversicherung der Allianz über 18.420,00 € und das Guthaben des Nachlasskontos von 4.284,00 €. Verbindlichkeiten zum Stichtag: Krankenhauszuzahlungen 440,60 € und Hilfsmittel-Eigenanteile 1.308,50 €, beide inzwischen vollständig getilgt.'
    }, '2023-06-05'),

    court_approval: L.bericht({
      ca_art: 'Genehmigung der Veräußerung eines Miterbenanteils an einem Grundstück',
      ca_rechtsgrundlage: 'Vermögensangelegenheit (§§ 1848 ff. BGB)',
      ca_vorgang: 'Veräußerung des hälftigen Miterbenanteils an dem unbebauten Grundstück in 56637 Plaidt, Gemarkung Plaidt, Flur 4, Flurstück 118, Größe 620 m², an die Miterbin Frau Krystyna Nowak zum Kaufpreis von 11.200,00 €.',
      ca_wille: 'Einwilligung',
      ca_begruendung: 'Das Grundstück stammt aus dem Nachlass des am 08.11.2024 verstorbenen Ehemannes. Frau Nowak ist zu einem Anteil von 1/2 Miterbin neben der Mutter des Erblassers. Das Grundstück ist unbebaut, nicht erschlossen und wird nicht genutzt; es verursacht Grundsteuer und Pflegeaufwand. Für Frau Nowak, die auf einen Rollstuhl angewiesen ist und in Koblenz lebt, hat es keinerlei Nutzen. Die Miterbin möchte den Anteil übernehmen, um das Grundstück in der Familie zu halten. Der Gutachterausschuss hat den Verkehrswert der Gesamtfläche mit Gutachten vom 22.04.2026 auf 21.700 € festgesetzt; der hälftige Anteil entspricht damit 10.850 €. Der angebotene Kaufpreis von 11.200 € liegt darüber. Eine Teilungsversteigerung wäre wirtschaftlich nachteilig und würde das Verhältnis zur Miterbin belasten. Frau Nowak wünscht den Verkauf ausdrücklich und hat den Kaufvertragsentwurf selbst gelesen und freigegeben. Der Erlös soll zur Ablösung der Restforderung aus der Wohnraumanpassung und zur Aufstockung der Hilfsmittelrücklage verwendet werden.',
      ca_ergaenzung: 'Beigefügt: Verkehrswertgutachten des Gutachterausschusses vom 22.04.2026, Entwurf des notariellen Kaufvertrages, Erbschein vom 05.02.2025, Nachlassverzeichnis, Erklärung von Frau Nowak vom 08.05.2026.'
    }, '2026-05-11'),

    advance_directive: L.bericht({
      ad_person_name: 'Halina Nowak, geb. Wisniewska',
      ad_person_birth: '1957-06-30',
      ad_person_address: 'Blücherstraße 62, 56073 Koblenz',
      ad_motivation: 'Frau Nowak hat die Verfügung am 12.06.2023 mit anwaltlicher Beratung selbst diktiert. Ihr ist wichtig, dass die Behandlung sich am Erhalt der Verständigungsfähigkeit orientiert: Solange sie sich mitteilen kann, will sie leben und behandelt werden. Verliert sie diese Fähigkeit dauerhaft, sollen lebensverlängernde Maßnahmen unterbleiben.',
      ad_experiences: 'Multiple Sklerose mit primär progredientem Verlauf seit 2009, aktuell EDSS 7,0. Neurogene Blasenentleerungsstörung mit intermittierendem Selbstkatheterismus, Spastik der unteren Extremitäten, chronische Obstipation. Frau Nowak kennt den Verlauf ihrer Erkrankung genau und hat den Tod ihres Ehemannes im November 2024 als plötzlich, aber friedlich erlebt.',
      ad_situations: ['unwiederbringlicher Verlust der Einsichts- und Kommunikationsfähigkeit durch Gehirnschädigung', 'Endstadium einer unheilbaren tödlichen Erkrankung', 'unabwendbarer unmittelbarer Sterbeprozess'],
      ad_situation_other: 'Zusätzlich: dauerhafter Verlust der Fähigkeit zur sprachlichen oder gestützten Verständigung infolge des Fortschreitens der Multiplen Sklerose.',
      ad_general_treatment: 'lebenserhaltende Maßnahmen unterlassen/einstellen, palliativ behandeln',
      ad_pain: 'fachgerecht einschließlich bewusstseinsdämpfender Mittel wenn erforderlich',
      ad_nutrition: 'unterlassen/einstellen',
      ad_fluids: 'unterlassen/einstellen',
      ad_ventilation: 'nicht durchführen/einstellen',
      ad_dialysis: 'nicht durchführen/einstellen',
      ad_antibiotics: 'zulassen',
      ad_blood: 'zulassen',
      ad_circulation: 'zulassen',
      ad_resuscitation: 'unterlassen',
      ad_organs: 'Zustimmung laut Organspendeausweis',
      ad_organ_priority: 'Patientenverfügung geht vor',
      ad_stay: ['vertraute Umgebung', 'Palliativteam', 'Hospiz'],
      ad_companions: 'Schwester Agnieszka Bauer, Köln. Seelsorgliche Begleitung durch die katholische Gemeinde Liebfrauen Koblenz ist gewünscht.',
      ad_stay_notes: 'Frau Nowak möchte so lange wie möglich in ihrer barrierefrei umgebauten Wohnung bleiben. Erst wenn eine Versorgung dort nicht mehr möglich ist, kommt ein Hospiz in Betracht; ein Pflegeheim lehnt sie ausdrücklich ab. Eine nicht-invasive Beatmung zur Linderung von Atemnot ist ausdrücklich gewünscht.',
      ad_hearing_person: 'Agnieszka Bauer (Schwester), Dürener Straße 187, 50931 Köln, 0221/8841207 – zugleich Vorsorgebevollmächtigte für Gesundheitsangelegenheiten.',
      ad_excluded_person: 'Keine.',
      ad_power: 'ja',
      ad_authorized_person: 'Agnieszka Bauer, geb. 19.02.1961, Dürener Straße 187, 50931 Köln. Die Vollmacht vom 12.06.2023 ist ausdrücklich auf Gesundheitsangelegenheiten beschränkt; Vermögensangelegenheiten sind nicht umfasst.',
      ad_care_directive: 'ja',
      ad_desired_carer: 'Für den Fall einer Erweiterung der Betreuung wünscht Frau Nowak ausdrücklich die Fortführung durch die jetzige Betreuungsperson.',
      ad_medical_advice: 'ärztlich beraten und aufgeklärt',
      ad_supported_by: 'Anwaltliche Beratung durch Rechtsanwältin Hoffmann, Koblenz, am 05.06.2023; ärztliche Beratung durch Prof. Dr. med. Katharina Reisinger (MS-Ambulanz) am 12.06.2023.',
      ad_storage: 'Original bei Frau Nowak in der Wohnung (oberste Schublade des Sekretärs, gekennzeichnet). Kopien: Register 09 der Fallakte, Hausarzt Dr. Sauerwein, MS-Ambulanz, Schwester Agnieszka Bauer. Eingetragen im Zentralen Vorsorgeregister unter ZVR 6402-3006-57.',
      ad_witness: ''
    }, '2025-06-11'),

    power_of_attorney: L.bericht({
      poa_grantor: 'Halina Nowak, geb. Wisniewska',
      poa_grantor_birth: '30.06.1957',
      poa_grantor_birthplace: 'Wrocław',
      poa_grantor_address: 'Blücherstraße 62, 56073 Koblenz',
      poa_grantor_contact: '0261/4471290, 0170/22885614, h.nowak57@example-mail.de',
      poa_agent: 'Agnieszka Bauer',
      poa_agent_birth: '19.02.1961',
      poa_agent_address: 'Dürener Straße 187, 50931 Köln',
      poa_agent_contact: '0221/8841207, 0176/44029918, a.bauer@example-mail.de',
      poa_health_general: 'ja',
      poa_risky_treatment: 'ja',
      poa_records: 'ja',
      poa_detention: 'nein',
      poa_restraints: 'nein',
      poa_coercion: 'nein',
      poa_hospital_transport: 'ja',
      poa_residence: 'nein',
      poa_current_lease: 'nein',
      poa_new_lease: 'nein',
      poa_care_contract: 'nein',
      poa_authorities: 'nein',
      poa_assets: 'nein',
      poa_disposals: 'nein',
      poa_payments: 'nein',
      poa_liabilities: 'nein',
      poa_bank: 'nein',
      poa_gifts: 'nein',
      poa_exclusions: 'Die Vollmacht ist ausdrücklich auf Gesundheitsangelegenheiten beschränkt. Vermögenssorge, Wohnungsangelegenheiten und die Vertretung gegenüber Behörden sind ausgenommen; hierfür besteht die rechtliche Betreuung. Freiheitsentziehende Maßnahmen und ärztliche Zwangsmaßnahmen sind ausdrücklich nicht umfasst.',
      poa_post: 'nein',
      poa_court: 'nein',
      poa_subpower: 'nein',
      poa_care_nomination: 'ja',
      poa_after_death: 'ja',
      poa_other: 'Für den Fall, dass eine rechtliche Betreuung auch für Gesundheitsangelegenheiten erforderlich werden sollte, wünscht Frau Nowak ausdrücklich, dass ihre Schwester als Betreuerin bestellt oder – falls diese die Übernahme ablehnt – die jetzige berufliche Betreuung fortgeführt wird. Die Vollmacht gilt über den Tod hinaus, soweit es die Totenfürsorge betrifft.'
    }, '2023-06-12'),

    rent_certificate: L.bericht({
      rent_tenant: 'Halina Nowak',
      rent_address: 'Blücherstraße 62, 56073 Koblenz',
      rent_floor: 'Erdgeschoss',
      rent_status: 'Hauptmieter',
      rent_furnished: 'leer',
      rent_basic_since: '2026-01-01',
      rent_basic: '684',
      rent_extra_since: '2026-01-01',
      rent_extra: '184',
      rent_cost_details: 'Grundmiete 684,00 €, Betriebskostenvorauszahlung 184,00 €, Heizkostenvorauszahlung (Fernwärme) 96,00 €. Strom wird direkt mit der Energieversorgung Mittelrhein abgerechnet und beträgt derzeit 78,00 € monatlich. Gesamtwarmmiete 964,00 €.',
      rent_first_ready: '1968-05-01',
      rent_year: '1968',
      rent_movein: '2011-03-01',
      rent_size: '78',
      rent_rooms: '3',
      rent_kitchens: '1',
      rent_baths: '1',
      rent_heating: 'Fernwärme über die Energieversorgung Mittelrhein AG, zentrale Warmwasserbereitung. Verbrauchserfassung über Wärmemengenzähler je Wohnung.',
      rent_people: '1',
      landlord_name: 'Wohnbaugesellschaft Koblenz mbH',
      landlord_address: 'Neustadt 18, 56068 Koblenz',
      landlord_phone: '0261/30110',
      landlord_bank: 'Sparkasse Koblenz, IBAN DE18 5705 0120 0030 1100 18, BIC MALADE51KOB',
      rent_certificate_name: 'Halina Nowak',
      rent_certificate_property: 'Blücherstraße 62, 56073 Koblenz, Erdgeschoss links',
      rent_certificate_basic: '684',
      rent_certificate_service: '184',
      rent_certificate_heating: '96',
      rent_certificate_start: '2011-03-01',
      rent_certificate_size: '78',
      rent_certificate_rooms: '3',
      rent_certificate_landlord: 'Wohnbaugesellschaft Koblenz mbH, Neustadt 18, 56068 Koblenz'
    }, '2026-02-18')
  }
};

/* Faehigkeiten & Alltag: Istzustand je Lebensbereich, Alltagsgestaltung und
   Wunschaeusserung. Frau Nowak ist voll entscheidungsfaehig; das Profil ist
   gemeinsam mit ihr erhoben und von ihr gegengelesen worden. */
module.exports.faehigkeiten = L.profil(F, {
  stand: '2026-08-07',
  bereiche: {
    communication: {
      ressourcen: 'Frau Nowak spricht klar, strukturiert und mit gutem Ausdruck. Sie führt Telefonate mit Behörden und Ärzten selbst, formuliert Widersprüche inhaltlich vor und korrigiert Entwürfe des Betreuers präzise. Deutsch und Polnisch beherrscht sie sicher. Sie fragt nach, wenn sie etwas nicht verstanden hat, und benennt ihre Grenzen offen.',
      einschraenkungen: 'Bei Erschöpfung – regelmäßig ab dem späten Nachmittag und in Schubphasen – treten Wortfindungsstörungen und eine verlangsamte Sprechweise auf. Längeres Schreiben mit der Hand ist wegen des Intentionstremors nicht mehr möglich; sie nutzt eine Tastatur und Spracheingabe. Telefonate von mehr als etwa zwanzig Minuten ermüden sie deutlich.',
      quelle: 'Hausbesuche 2026, Angaben von Frau Nowak',
      erhoben: '2026-08-07', wiedervorlage: '2027-08-31'
    },
    orientation: {
      ressourcen: 'Vollständig orientiert und uneingeschränkt entscheidungsfähig. Frau Nowak überblickt ihre rechtliche und wirtschaftliche Situation, bereitet Entscheidungen selbst vor und trifft sie begründet. Sie hat die Betreuung selbst angeregt, kennt den Aufgabenkreis genau und verlangt zu Recht, dass nichts ohne ihre Zustimmung geschieht.',
      einschraenkungen: 'Kognitive Einschränkungen liegen nicht vor. In akuten Schüben ist die Konzentrationsfähigkeit für einige Wochen herabgesetzt, sodass sie umfangreiche Unterlagen in dieser Zeit nicht durcharbeiten kann und Entscheidungen bewusst vertagt – eine von ihr selbst gesetzte Regel.',
      quelle: 'Fachärztliches Attest Dr. Steinkamp vom 03.04.2026, Hausbesuche',
      erhoben: '2026-04-03', wiedervorlage: '2028-04-30'
    },
    mobility: {
      ressourcen: 'Innerhalb der barrierefreien Wohnung bewegt sich Frau Nowak mit dem Rollator selbstständig und legt kurze Strecken auch frei gehend zurück. Den Elektrorollstuhl bedient sie sicher und nutzt ihn für Wege im Stadtgebiet; Einkäufe und Arztbesuche in Boppard erledigt sie damit allein. Transfers Bett–Rollstuhl gelingen ohne Hilfe.',
      einschraenkungen: 'Gehstrecke frei höchstens 15 Meter, mit Rollator etwa 80 Meter, danach Spastik und Erschöpfung. Treppen sind nicht möglich. Der Elektrorollstuhl aus dem Jahr 2018 ist reparaturanfällig; seit dem Ausfall im Mai 2026 war sie zwei Wochen an die Wohnung gebunden. Bahnreisen nur mit vorangemeldeter Mobilitätshilfe. Wärme verschlechtert die Symptomatik deutlich.',
      bedarfe: [],
      quelle: 'Hilfsmittelbericht Sanitätshaus vom 22.05.2026, Physiotherapiebericht 30.06.2026',
      erhoben: '2026-06-30', wiedervorlage: '2026-08-19'
    },
    health_selfcare: {
      ressourcen: 'Frau Nowak steuert ihre Erkrankung informiert und eigenverantwortlich: Sie führt ein Symptomtagebuch, kennt ihre Medikation im Detail, bereitet sie wöchentlich selbst in der Dosette vor und meldet Nebenwirkungen zeitnah. Die Selbstinjektion der Basistherapie führt sie selbstständig durch. Beim Waschen und Ankleiden benötigt sie nur bei den unteren Extremitäten Hilfe.',
      einschraenkungen: 'Pflegegrad 3. Duschen, Anziehen von Strümpfen und Schuhen sowie Intimpflege werden vom Pflegedienst übernommen. Neurogene Blasenstörung mit intermittierendem Selbstkatheterismus viermal täglich und wiederkehrenden Harnwegsinfekten – vier Infekte im Jahr 2025, zwei bereits 2026. Fatigue begrenzt die belastbare Zeit auf etwa vier bis fünf Stunden am Tag.',
      bedarfe: ['gdp-n-06'],
      quelle: 'Pflegedokumentation Sozialstation Boppard, Arztbericht Dr. Steinkamp vom 03.04.2026',
      erhoben: '2026-08-07', wiedervorlage: '2026-10-31'
    },
    housing_household: {
      ressourcen: 'Die barrierefreie Zweizimmerwohnung mit ebenerdiger Dusche und unterfahrbarer Küchenzeile hat Frau Nowak 2024 selbst ausgesucht; sie ist mit dem Umbau sehr zufrieden. Einfache Mahlzeiten bereitet sie im Sitzen selbst zu, den Wocheneinkauf erledigt sie online. Sie organisiert Handwerker und Termine für die Wohnung eigenständig.',
      einschraenkungen: 'Bodenreinigung, Fensterputzen, Bettwäschewechsel und das Tragen von Wäschekörben kann sie nicht mehr übernehmen; hierfür kommt zweimal wöchentlich eine Haushaltshilfe. Arbeiten über Kopf und in Bodennähe sind ausgeschlossen. Der Balkon ist nur mit Schwelle erreichbar; die Anpassung ist beantragt und noch nicht bewilligt.',
      bedarfe: [],
      quelle: 'Hausbesuche 04.06. und 07.08.2026, Wohnraumanpassungsantrag vom 19.03.2026',
      erhoben: '2026-08-07', wiedervorlage: '2026-12-15'
    },
    daily_social: {
      ressourcen: 'Frau Nowak pflegt ein tragfähiges Netz: die Tochter in Koblenz mit wöchentlichen Besuchen, zwei enge Freundinnen aus der früheren Kollegenschaft, die MS-Selbsthilfegruppe Rhein-Mosel, in der sie seit 2019 aktiv ist und seit 2024 die Kasse führt. Den Literaturkreis der Stadtbücherei besucht sie monatlich. Sie nutzt Videotelefonie zu Verwandten in Polen.',
      einschraenkungen: 'Spontane Verabredungen sind wegen der Fatigue und der Fahrdienstplanung kaum möglich; alles muss mehrere Tage im Voraus organisiert werden. Abendveranstaltungen sagt sie regelmäßig ab. Kulturangebote in Koblenz und Mainz sind wegen fehlender barrierefreier Anfahrt oft nicht erreichbar, was sie als deutliche Einschränkung ihrer Teilhabe erlebt.',
      bedarfe: [],
      quelle: 'Hausbesuch 07.08.2026, Angaben von Frau Nowak',
      erhoben: '2026-08-07', wiedervorlage: '2027-02-28'
    },
    work_education: {
      ressourcen: 'Ausgebildete Bankkauffrau mit 34 Berufsjahren bei der Kreissparkasse, zuletzt in der Kreditsachbearbeitung; das Fachwissen nutzt sie bis heute – in der Selbsthilfegruppe führt sie die Kasse und berät andere Mitglieder in Antragsfragen. Sie arbeitet sicher am Rechner, nutzt Onlinebanking, Tabellenkalkulation und Videokonferenzen.',
      einschraenkungen: 'Erwerbsunfähigkeit seit 2021, volle Erwerbsminderungsrente auf Dauer. Eine berufliche Wiedereingliederung ist wegen der Fatigue und der Schubfrequenz ausgeschlossen und wird von ihr auch nicht angestrebt. Belastbarkeit für konzentrierte Tätigkeit etwa zwei Stunden am Vormittag.',
      quelle: 'Rentenbescheid vom 14.07.2021, Angaben von Frau Nowak',
      erhoben: '2026-06-04', bericht: false
    },
    authorities_law: {
      ressourcen: 'Frau Nowak führt ihre Behördenangelegenheiten inhaltlich selbst: Sie liest jeden Bescheid, prüft die Berechnung, erkennt Fehler und entwirft Widersprüche vor. Fristen notiert sie in ihrem Kalender und erinnert den Betreuer daran. Der Aufgabenkreis dient ausdrücklich der Entlastung, nicht der Ersetzung ihres Willens.',
      einschraenkungen: 'Die körperliche Erledigung – Schriftverkehr ausfertigen, Behördengänge, längere Telefonate, Aktenzusammenstellung – überfordert ihre Kräfte und wird deshalb übernommen. In Schubphasen ist sie über mehrere Wochen nicht in der Lage, Verfahren zu betreiben; hier war 2025 der Widerspruch gegen die Pflegegradeinstufung ohne Betreuung fristgefährdet.',
      bedarfe: [],
      quelle: 'Betreuerbericht 2026, Beschluss AG St. Goar vom 08.11.2023',
      erhoben: '2026-08-07', wiedervorlage: '2027-11-30'
    },
    finance_assets: {
      ressourcen: 'Frau Nowak verwaltet ihr Girokonto selbst, führt ein Haushaltsbuch und hat einen vollständigen Überblick über Einnahmen, Ausgaben und Rücklagen. Sie entscheidet über alle Ausgaben selbst und stimmt größere Anschaffungen mit dem Betreuer nur ab, weil sie es für sinnvoll hält – ein Einwilligungsvorbehalt besteht nicht und ist nicht erforderlich.',
      einschraenkungen: 'Der Erbfall nach dem Tod ihres Bruders im Februar 2026 mit einem Grundstücksanteil in Oberwesel übersteigt ihre Kräfte in der Abwicklung: Grundbuchangelegenheiten, Erbengemeinschaft und Nachlassverzeichnis erfordern Termine und Schriftverkehr, die sie körperlich nicht leisten kann. Inhaltlich trifft sie alle Entscheidungen dazu selbst.',
      bedarfe: ['gdp-n-02'],
      quelle: 'Rechnungslegung 2025, Nachlassunterlagen Stand 31.07.2026',
      erhoben: '2026-08-07', wiedervorlage: '2026-11-30'
    }
  },
  alltag: {
    zusammenfassung: 'Frau Nowak lebt seit August 2024 allein in einer barrierefreien Zweizimmerwohnung in Boppard. Sie gestaltet ihren Alltag selbstbestimmt und plant ihn sorgfältig um ihre begrenzte Tagesenergie herum. Die Betreuung ist eine ausdrücklich gewünschte Entlastung bei der körperlichen Erledigung, nicht bei der Entscheidung. Belastende Punkte sind die Abhängigkeit vom Fahrdienst, der reparaturanfällige Elektrorollstuhl und die Abwicklung des Erbfalls.',
    tagesablauf: 'Aufstehen gegen 7:30 Uhr, Pflegedienst 8:00 Uhr für Dusche und Ankleiden. Frühstück und Zeitung, danach der konzentrierte Teil des Tages: Post, Telefonate, Selbsthilfegruppe. Mittagessen selbst zubereitet oder Essen auf Rädern, anschließend verbindliche Ruhephase von 13:00 bis 15:00 Uhr. Nachmittags Besuche, Physiotherapie oder ein Ausflug mit dem Elektrorollstuhl. Pflegedienst 19:30 Uhr, Abend meist lesend oder mit Videotelefonaten.',
    haushalt: 'Einfache Mahlzeiten bereitet sie im Sitzen an der unterfahrbaren Küchenzeile selbst zu; an drei Tagen kommt Essen auf Rädern. Wocheneinkauf über einen Lieferdienst, den sie selbst bestellt. Haushaltshilfe zweimal wöchentlich für Reinigung, Wäsche und Bettwäsche. Rechnungen, Termine und Handwerker organisiert sie selbst.',
    selbstversorgung: 'Pflegedienst zweimal täglich für Dusche, Ankleiden, Kompressionsstrümpfe und Unterstützung beim Katheterismus. Medikamente stellt sie selbst wöchentlich, die Basistherapie injiziert sie selbst. Symptomtagebuch wird täglich geführt. Intermittierender Selbstkatheterismus viermal täglich. Trinkmenge wird wegen der Harnwegsinfekte protokolliert.',
    beschaeftigung: 'MS-Selbsthilfegruppe Rhein-Mosel zweimal monatlich, Kassenführung seit 2024. Literaturkreis der Stadtbücherei monatlich. Physiotherapie zweimal wöchentlich, Ergotherapie einmal wöchentlich. Regelmäßiges Lesen, Hörbücher und ein Onlinekurs zur polnischen Literatur.',
    teilhabe: 'Tochter Marta besucht wöchentlich, telefoniert fast täglich. Zwei enge Freundinnen mit regelmäßigen Besuchen. Kontakt zur Familie des verstorbenen Bruders in Polen per Videotelefonie. Nachbarschaftliche Kontakte im Haus, die Nachbarin nimmt Pakete an. Kulturelle Teilhabe außerhalb Boppards ist eingeschränkt und ein von ihr benanntes Ziel.',
    unterstuetzung: 'Pflegedienst Sozialstation Boppard zweimal täglich (Pflegegrad 3). Haushaltshilfe zweimal wöchentlich über die Verhinderungspflege. Essen auf Rädern an drei Tagen. Physio- und Ergotherapie. Fahrdienst nach Voranmeldung. Neurologische Behandlung Dr. Steinkamp vierteljährlich. Rechtliche Betreuung mit monatlichem Hausbesuch.',
    quelle: 'Hausbesuch 07.08.2026, gemeinsam mit Frau Nowak erhoben und von ihr freigegeben',
    erhoben: '2026-08-07', wiedervorlage: '2027-02-28'
  },
  wunsch: {
    status: 'ja',
    begruendung: 'Frau Nowak äußert ihre Wünsche uneingeschränkt, begründet und in der Sache treffend. Sie widerspricht deutlich, wenn ihr etwas nicht passt, und hat die Aufgabenkreise der Betreuung selbst vorgeschlagen. Eine Unterstützung bei der Willensbildung ist nicht erforderlich.',
    unterstuetzung: 'Keine Unterstützung bei der Willensbildung nötig. Für Gespräche gilt lediglich: Termine am Vormittag legen, umfangreiche Unterlagen mindestens drei Tage vorher schriftlich zusenden, in Schubphasen Entscheidungen auf ihren Wunsch vertagen.',
    wege: ['spoken', 'writing'],
    quelle: 'Hausbesuche 2024 bis 2026, Anregung der Betreuung durch Frau Nowak selbst',
    erhoben: '2026-08-07', wiedervorlage: '2028-08-31'
  },
  verlauf: [
    ['2024-01-22', 'Profil erstmals gemeinsam mit Frau Nowak angelegt'],
    ['2024-09-03', 'Bereiche „Wohnen und Haushaltsführung" und „Mobilität" nach dem Umzug in die barrierefreie Wohnung aktualisiert'],
    ['2026-03-05', 'Bereich „Finanzen und Vermögen" nach dem Erbfall fortgeschrieben'],
    ['2026-06-30', 'Bereich „Mobilität" nach Ausfall des Elektrorollstuhls aktualisiert'],
    ['2026-08-07', 'Gesamtprofil mit Frau Nowak durchgesprochen und freigegeben']
  ]
});
