'use strict';
/* Demonstrationsfall 1 - Margarete Auerbach.
   Profil: 85 Jahre, Demenz vom Alzheimer-Typ, stationaere Pflege, Pflegegrad 4,
   nennenswertes Vermoegen (Wohnungsverkauf mit gerichtlicher Genehmigung),
   Betreuung seit 2019 - der "lange" Fall mit sieben Jahren Falldokumentation. */

const L = require('./lib');
const F = 'a';

const person = {
  salutation: 'Frau', title: '', gender: 'weiblich',
  firstName: 'Margarete', lastName: 'Auerbach', birthName: 'Hoffmann',
  birthDate: '14.03.1941', birthPlace: 'Bad Kreuznach', birthCountry: 'Deutschland',
  nationality: 'deutsch', nationality2: '',
  maritalStatus: 'verwitwet', maritalSince: '19.11.2016',
  religion: 'römisch-katholisch',
  street: 'Rheinallee', streetOnly: 'Rheinallee', house: '27', houseNumber: '27', houseLetter: '',
  postal: '56154', postalCode: '56154', city: 'Boppard', postbox: '', country: 'Deutschland',
  foreignCity: '',
  address: 'Rheinallee 27, 56154 Boppard',
  institution: 'Seniorenzentrum Sankt Elisabeth, Mainzer Straße 118, 56154 Boppard',
  phone: '06742/884120', mobile: '', email: '', fax: '',
  idCardNumber: 'L7KQ4M2ZP', residencePermitNumber: '',
  taxId: '48 512 903 774', pensionInsuranceNumber: '14 140341 H 512',
  contributionNumber: 'AOK 1441-903-774', socialOfficeNumber: 'SA-RLP/BOP-2019-4471',
  fullName: 'Margarete Auerbach'
};

const care = {
  authorityName: 'Betreuungsbehörde Rhein-Hunsrück-Kreis',
  authorityCity: 'Simmern/Hunsrück',
  authorityFileNumber: 'BB 2019/0417',
  courtName: 'Amtsgericht St. Goarshausen',
  courtStreet: 'Bahnhofstraße 8', courtPostbox: '', courtPostal: '56346', courtCity: 'St. Goarshausen',
  courtAddressComplete: 'True',
  courtAddressSource: 'Bürostammdaten / Justizportal Rheinland-Pfalz',
  courtVerificationStatus: 'verified',
  courtVerificationCheckedAt: '2026-01-08T08:12:00.000Z',
  fileNumber: '7 XVII 214/19',
  requestDate: '02.07.2019',
  preliminaryOrderDate: '26.07.2019',
  orderDate: '05.09.2019',
  officeHandoverDate: '10.09.2019',
  startDate: '12.09.2019',
  takeoverDate: '12.09.2019',
  handoverDate: '',
  reportPeriod: '01.10. - 30.09.',
  reviewDate: '11.09.2026',
  endDate: '',
  homePlacement: 'ja',
  nextAccountingDue: '31.10.2026',
  taskAreaDetails: [
    { name: 'Vermögenssorge', consentReservation: true },
    { name: 'Gesundheitssorge', consentReservation: false },
    { name: 'Aufenthaltsbestimmung', consentReservation: false },
    { name: 'Wohnungsangelegenheiten', consentReservation: false },
    { name: 'Heim- und Pflegeangelegenheiten', consentReservation: false },
    { name: 'Vertretung gegenüber Behörden, Versicherungen, Renten- und Sozialleistungsträgern', consentReservation: false },
    { name: 'Post- und Fernmeldeangelegenheiten', consentReservation: false }
  ]
};
care.taskAreas = care.taskAreaDetails.map((t) => t.name);

const healthInfo = {
  insurance: 'AOK Rheinland-Pfalz/Saarland',
  insuranceNumber: 'A144190377',
  careLevel: '4',
  bloodType: '0+',
  allergies: 'Penicillin (Exanthem), Jodhaltige Kontrastmittel, Pflasterklebstoff',
  diagnosesNotes: 'Fortgeschrittene Demenz. Aufklärung stets über die Betreuung; Einwilligungsfähigkeit für invasive Maßnahmen nicht gegeben (fachärztliche Stellungnahme Dr. Kohlmeyer vom 18.02.2024).',
  diagnoses: [
    { icd: 'F00.1', text: 'Demenz bei Alzheimer-Krankheit mit spätem Beginn', since: '2018-11-20' },
    { icd: 'I10.90', text: 'Essentielle arterielle Hypertonie', since: '2004-05-14' },
    { icd: 'M80.08', text: 'Postmenopausale Osteoporose mit pathologischer Fraktur', since: '2017-03-02' },
    { icd: 'E11.90', text: 'Diabetes mellitus Typ 2, ohne Komplikationen', since: '2011-09-08' },
    { icd: 'H91.1', text: 'Presbyakusis beidseits, Hörgeräteversorgung', since: '2015-06-22' },
    { icd: 'F05.1', text: 'Delir bei Demenz (rezidivierend, zuletzt 03/2025)', since: '2022-01-17' }
  ],
  medications: [
    { name: 'Donepezil', dose: '10 mg', schedule: '0-0-1' },
    { name: 'Ramipril', dose: '5 mg', schedule: '1-0-0' },
    { name: 'Metformin', dose: '500 mg', schedule: '1-0-1' },
    { name: 'Alendronsäure', dose: '70 mg', schedule: '1x wöchentlich, montags' },
    { name: 'Colecalciferol', dose: '1000 I.E.', schedule: '1-0-0' },
    { name: 'Pantoprazol', dose: '20 mg', schedule: '1-0-0' },
    { name: 'Melperon', dose: '25 mg', schedule: '0-0-1, bei Unruhe' }
  ],
  doctors: [
    { name: 'Dr. med. Annegret Kohlmeyer', field: 'Fachärztin für Psychiatrie und Psychotherapie / Gerontopsychiatrie', phone: '06742/301188', email: 'praxis@kohlmeyer-boppard.de' },
    { name: 'Dr. med. Tobias Reinhard', field: 'Allgemeinmedizin (Heimarzt)', phone: '06742/449021', email: 'kontakt@hausarzt-reinhard.de' },
    { name: 'Dr. med. Silke Baumgart', field: 'Innere Medizin / Diabetologie', phone: '02621/778430', email: 'diabetologie@mzk-lahnstein.de' },
    { name: 'Prof. Dr. med. Ulrich Franzen', field: 'Orthopädie und Unfallchirurgie', phone: '0261/4960', email: 'orthopaedie@klinikum-kemperhof.de' },
    { name: 'Marion Seibold', field: 'Zahnmedizin (aufsuchende Behandlung im Heim)', phone: '06742/812255', email: 'praxis@zahn-seibold.de' }
  ],
  emergency: [
    { name: 'Karin Auerbach-Petri', relation: 'Tochter', phone: '0261/9034128', email: 'k.petri@example-mail.de' },
    { name: 'Dr. Stefan Auerbach', relation: 'Sohn', phone: '0221/5540912', email: 's.auerbach@example-mail.de' },
    { name: 'Seniorenzentrum Sankt Elisabeth – Wohnbereich 2', relation: 'Einrichtung / Pflegedienstleitung', phone: '06742/884120', email: 'wb2@st-elisabeth-boppard.de' }
  ],
  appointments: [
    { id: L.id('hia', F, 1), doctor: 'Dr. Kohlmeyer', reason: 'Gerontopsychiatrische Verlaufskontrolle, Anpassung Melperon', from: '2024-02-18', to: '', note: 'MMST 12/30. Betreuerin/Betreuer anwesend.', recommendation: 'Neurokognitive Kontrolle in 6 Monaten' },
    { id: L.id('hia', F, 2), doctor: 'Dr. Reinhard', reason: 'Quartalsvisite, Blutdruckeinstellung', from: '2024-07-11', to: '', note: 'RR 158/92, Ramipril auf 5 mg erhöht.', recommendation: 'Wöchentliche RR-Kontrolle durch Pflege' },
    { id: L.id('hia', F, 3), doctor: 'Dr. Baumgart', reason: 'Diabetologisches Assessment, HbA1c 7,4 %', from: '2025-01-22', to: '', note: 'Kostform angepasst, keine Insulinpflicht.', recommendation: 'HbA1c-Kontrolle halbjährlich' },
    { id: L.id('hia', F, 4), doctor: 'Dr. Kohlmeyer', reason: 'Stellungnahme zur Einwilligungsfähigkeit', from: '2025-03-06', to: '', note: 'Schriftliche Stellungnahme für das Betreuungsgericht erstellt.', recommendation: 'Alle invasiven Maßnahmen über die Betreuung' },
    { id: L.id('hia', F, 5), doctor: 'Marion Seibold', reason: 'Aufsuchende Zahnbehandlung, Prothesenanpassung', from: '2025-09-17', to: '', note: 'Druckstelle Unterkiefer behoben.', recommendation: 'Kontrolle in 3 Monaten' },
    { id: L.id('hia', F, 6), doctor: 'Prof. Dr. Franzen', reason: 'Kontrolle nach Hüft-TEP links', from: '2026-04-09', to: '', note: 'Belastungsstabil, Gehen mit Rollator im Wohnbereich.', recommendation: 'Physiotherapie 2x wöchentlich fortführen' },
    { id: L.id('hia', F, 7), doctor: 'Dr. Reinhard', reason: 'Grippe- und Pneumokokken-Schutzimpfung', from: '2026-10-08', to: '', note: 'Einwilligung durch die Betreuung erteilt.', recommendation: 'Jährliche Wiederholung' }
  ],
  hospital: [
    { id: L.id('hih', F, 1), clinic: 'Gemeinschaftsklinikum Mittelrhein, Kemperhof Koblenz', reason: 'Pertrochantäre Femurfraktur rechts nach Sturz, osteosynthetische Versorgung', from: '2019-06-18', to: '2019-07-04', note: 'Sturz in der eigenen Wohnung; Auslöser des Betreuungsverfahrens.', recommendation: 'Anschlussheilbehandlung, Prüfung der häuslichen Versorgung' },
    { id: L.id('hih', F, 2), clinic: 'Median Reha-Klinik Bad Salzig', reason: 'Geriatrische Anschlussheilbehandlung', from: '2019-07-04', to: '2019-08-16', note: 'Rückkehr in die eigene Wohnung wurde als nicht tragfähig eingeschätzt.', recommendation: 'Heimaufnahme, Pflegegradantrag' },
    { id: L.id('hih', F, 3), clinic: 'Marienhaus Klinikum St. Elisabeth Neuwied', reason: 'Harnwegsinfekt mit Delir und Exsikkose', from: '2022-01-17', to: '2022-01-29', note: 'Fixierung wurde ausdrücklich abgelehnt; Sitzwache organisiert.', recommendation: 'Trinkprotokoll, Delirprophylaxe' },
    { id: L.id('hih', F, 4), clinic: 'Gemeinschaftsklinikum Mittelrhein, Kemperhof Koblenz', reason: 'Mediale Schenkelhalsfraktur links, Hüft-TEP', from: '2026-02-11', to: '2026-02-27', note: 'Einwilligung in die Operation durch die Betreuung nach § 1829 BGB, gerichtliche Genehmigung nicht erforderlich (kein begründetes Risiko im Sinne des Abs. 2).', recommendation: 'Kurzzeitpflege/Mobilisation im Heim' },
    { id: L.id('hih', F, 5), clinic: 'Median Reha-Klinik Bad Salzig', reason: 'Geriatrische Rehabilitation nach Hüft-TEP', from: '2026-02-27', to: '2026-03-24', note: 'Rückverlegung in den vertrauten Wohnbereich 2.', recommendation: 'Physiotherapie, Sturzprophylaxe' }
  ],
  procedures: [
    { id: L.id('hip', F, 1), procedure: 'Osteosynthese proximaler Femur rechts (PFNA)', doctor: 'Prof. Dr. Franzen', from: '2019-06-19', to: '2019-06-19', note: 'Notfallindikation, Einwilligung durch vorläufige Betreuung.', recommendation: 'Materialentfernung nicht geplant' },
    { id: L.id('hip', F, 2), procedure: 'Hüft-Totalendoprothese links (zementiert)', doctor: 'Prof. Dr. Franzen', from: '2026-02-12', to: '2026-02-12', note: 'Aufklärung am 11.02.2026 mit der Betreuung; Patientenverfügung berücksichtigt.', recommendation: 'Belastung nach Maßgabe, Thromboseprophylaxe 5 Wochen' },
    { id: L.id('hip', F, 3), procedure: 'Hörgeräteversorgung beidseits, Neuanpassung', doctor: 'Hörzentrum Boppard', from: '2024-05-14', to: '2024-06-11', note: 'Kostenübernahme AOK und Eigenanteil aus der Handkasse.', recommendation: 'Halbjährliche Nachjustierung' },
    { id: L.id('hip', F, 4), procedure: 'Kataraktoperation rechtes Auge', doctor: 'Dr. med. Petra Lindner, Augenzentrum Koblenz', from: '2023-11-08', to: '2023-11-08', note: 'Ambulant, Begleitung durch die Tochter.', recommendation: 'Linkes Auge im Folgejahr, bislang nicht gewünscht' },
    { id: L.id('hip', F, 5), procedure: 'Anpassung Pflegebett und Wechseldruckmatratze', doctor: 'Sanitätshaus Rheinvital', from: '2025-05-20', to: '2025-05-20', note: 'Hilfsmittelrezept Dr. Reinhard, Genehmigung AOK.', recommendation: 'Jährliche Wartung' }
  ]
};

const schulden = [
  L.schuld(F, 1, {
    erfasstAm: '2019-10-08', forderungsbeginn: '2019-03-01',
    glaeubiger: 'Stadtwerke Boppard GmbH', kategorie: 'Stromschulden',
    aktenzeichen: 'SWB-2019-114872', hauptforderung: 986.4, mahnkosten: 12.5,
    ratenhoehe: 100, status: 'erledigt', basisGezahlt: 998.9,
    erledigtAm: '2020-08-14', verwendungszweck: 'Kd.-Nr. 114872 Auerbach',
    notizen: 'Rückstände aus der Zeit vor der Betreuung; vollständig ausgeglichen.'
  }),
  L.schuld(F, 2, {
    erfasstAm: '2019-10-08', forderungsbeginn: '2018-06-01',
    glaeubiger: 'Seniorenzentrum Sankt Elisabeth gGmbH', kategorie: 'Heimkosten / Pflegesatz (stationäre Einrichtung)',
    aktenzeichen: 'HV-2019-0442', hauptforderung: 4380, mahnkosten: 0,
    ratenhoehe: 300, ratenintervall: 'monatlich', status: 'erledigt',
    basisGezahlt: 4380, erledigtAm: '2021-11-30', dauerauftrag: false,
    verwendungszweck: 'Eigenanteil Auerbach, Az. HV-2019-0442',
    notizen: 'Rückstand des Eigenanteils bis zur Bewilligung der Hilfe zur Pflege; nach Wohnungsverkauf getilgt.'
  }),
  L.schuld(F, 3, {
    erfasstAm: '2021-04-19', forderungsbeginn: '2021-01-01',
    glaeubiger: 'Finanzamt Sankt Goarshausen', kategorie: 'Steuerschulden (Finanzamt)',
    aktenzeichen: '30/241/50218', hauptforderung: 1742.0, mahnkosten: 25,
    ratenhoehe: 150, status: 'erledigt', basisGezahlt: 1767,
    erledigtAm: '2022-03-15',
    notizen: 'Nachzahlung aus der Veräußerung des Wertpapierdepots; Steuererklärung 2020 durch Steuerbüro Wendel erstellt.'
  }),
  L.schuld(F, 4, {
    erfasstAm: '2025-06-11', forderungsbeginn: '2025-04-01',
    glaeubiger: 'Sanitätshaus Rheinvital GmbH', kategorie: 'Heil- und Hilfsmittel (Schuhe, Orthesen, Rollator etc.)',
    aktenzeichen: 'RV-25-8817', hauptforderung: 486.9, mahnkosten: 5,
    ratenhoehe: 80, ratenintervall: 'monatlich', status: 'Ratenzahlung',
    dauerauftrag: true, verwendungszweck: 'RV-25-8817 Eigenanteil Pflegebett',
    bankverbindung: { iban: 'DE29 5705 0120 0000 4471 88', bic: 'MALADE51KOB', kontoinhaber: 'Sanitätshaus Rheinvital GmbH' },
    raten: [['2025-07-01', 80], ['2025-08-01', 80], ['2025-09-01', 80], ['2025-10-01', 80], ['2025-11-01', 80]],
    notizen: 'Eigenanteil Pflegebett und Wechseldruckmatratze, Ratenvereinbarung vom 26.06.2025.'
  })
];

const konten = [
  { name: 'Girokonto (Verwaltungskonto)', art: 'Girokonto', bank: 'Sparkasse Koblenz', inhaber: 'Margarete Auerbach', iban: 'DE68 5705 0120 0019 4471 03', bic: 'MALADE51KOB', anfang: 3184.22, ende: 4922.71, einnahmen: 24880.44, ausgaben: 23141.95 },
  { name: 'Sparkonto (Rücklage Bestattung)', art: 'Sparkonto', bank: 'Sparkasse Koblenz', inhaber: 'Margarete Auerbach', iban: 'DE21 5705 0120 0044 7118 90', bic: 'MALADE51KOB', anfang: 8500.0, ende: 8562.4, einnahmen: 62.4, ausgaben: 0 },
  { name: 'Verwahrgeldkonto der Einrichtung', art: 'Treuhandkonto', bank: 'Seniorenzentrum Sankt Elisabeth gGmbH', inhaber: 'Margarete Auerbach (Verwahrgeld)', iban: 'DE44 5705 0120 0000 8841 20', bic: 'MALADE51KOB', anfang: 210.5, ende: 176.3, einnahmen: 1200, ausgaben: 1234.2 }
];

module.exports = {
  label: 'Auerbach, Margarete',
  fileNumber: '7 XVII 214/19',
  createdAt: '2019-09-12 09:20:00',
  betreuer: 'christoph zepp',
  uebersicht: { periodStart: '2026-07-01', aenderungsart: 'unverändert fortgeführt', uebergabeAn: '' },
  kontaktmonitor: { turnusDays: 90, baseline: '2026-07-14', lastContact: '2026-08-11', lastArt: 'persönlich (Einrichtung / Klinik)' },

  stammdaten: {
    person,
    care,
    rechtlicherBetreuer: 'christoph zepp',
    health: {
      careLevel: '4', disabilityDegree: '100',
      marks: ['G', 'aG', 'H', 'B', 'RF'], marksText: 'G, aG, H, B, RF',
      copayExemption: 'ja, befreit bis 31.12.2026', valueMark: 'ja',
      insurer: 'AOK Rheinland-Pfalz/Saarland', insuranceNumber: 'A144190377'
    },
    healthInfo,
    benefits: [
      { category: 'Rente', basis: 'SGB VI', benefitName: 'Regelaltersrente', applicationDate: '02.01.2006', validUntil: 'unbefristet', provider: 'Deutsche Rentenversicherung Rheinland-Pfalz', fileNumber: '14 140341 H 512' },
      { category: 'Rente', basis: 'SGB VI', benefitName: 'Große Witwenrente', applicationDate: '05.12.2016', validUntil: 'unbefristet', provider: 'Deutsche Rentenversicherung Rheinland-Pfalz', fileNumber: '14 140341 H 512 W' },
      { category: 'Rente', basis: 'Tarifvertrag', benefitName: 'Betriebsrente (Zusatzversorgung)', applicationDate: '02.01.2006', validUntil: 'unbefristet', provider: 'VBL Karlsruhe', fileNumber: 'VBL 8814-2290-1' },
      { category: 'Pflege', basis: 'SGB XI', benefitName: 'Vollstationäre Pflege, Pflegegrad 4', applicationDate: '21.08.2019', validUntil: 'unbefristet', provider: 'AOK Pflegekasse Rheinland-Pfalz/Saarland', fileNumber: 'PK-A144190377' },
      { category: 'Sozialhilfe', basis: 'SGB XII (7. Kapitel)', benefitName: 'Hilfe zur Pflege in Einrichtungen', applicationDate: '14.10.2019', validUntil: '31.12.2026', provider: 'Kreisverwaltung Rhein-Hunsrück-Kreis, Sozialamt', fileNumber: 'SA-RLP/BOP-2019-4471' },
      { category: 'Schwerbehindertenrecht', basis: 'SGB IX', benefitName: 'Schwerbehindertenausweis GdB 100, Merkzeichen G/aG/H/B/RF', applicationDate: '30.09.2019', validUntil: '31.10.2029', provider: 'Landesamt für Soziales, Jugend und Versorgung Koblenz', fileNumber: 'SB 2019/114 402' },
      { category: 'Rundfunk', basis: 'RBStV', benefitName: 'Befreiung vom Rundfunkbeitrag (Merkzeichen RF ermäßigt)', applicationDate: '12.11.2019', validUntil: '31.10.2029', provider: 'ARD ZDF Deutschlandradio Beitragsservice', fileNumber: '431 998 227' }
    ],
    identifiers: [
      { type: 'Personalausweis', number: 'L7KQ4M2ZP', validUntil: '22.05.2028', status: 'gültig' },
      { type: 'Steuerliche Identifikationsnummer', number: '48 512 903 774', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Rentenversicherungsnummer', number: '14 140341 H 512', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Krankenversichertennummer', number: 'A144190377', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Schwerbehindertenausweis', number: 'SB 2019/114 402', validUntil: '31.10.2029', status: 'gültig' },
      { type: 'Kunden-/Mitgliedsnummer', number: '431 998 227', validUntil: 'unbefristet', status: 'aktiv' },
      { type: 'Aktenzeichen / Geschäftszeichen', number: 'SA-RLP/BOP-2019-4471', validUntil: '31.12.2026', status: 'aktiv' }
    ],
    insurances: [
      { type: 'Gesundheitsversicherung (gesetzlich)', institution: 'AOK Rheinland-Pfalz/Saarland', number: 'A144190377', details: 'Pflichtversichert als Rentnerin (KVdR), zuzahlungsbefreit bis 31.12.2026' },
      { type: 'Pflegeversicherung', institution: 'AOK Pflegekasse Rheinland-Pfalz/Saarland', number: 'PK-A144190377', details: 'Pflegegrad 4 seit 01.10.2019, Höherstufung von 3 auf 4 am 01.05.2023' },
      { type: 'Privathaftpflicht', institution: 'Provinzial Rheinland Versicherung AG', number: 'PH-4471-908-2', details: 'Jahresbeitrag 78,40 €, fällig 01.04., Einzugsermächtigung' },
      { type: 'Hausratversicherung', institution: 'Provinzial Rheinland Versicherung AG', number: 'HR-4471-908-3', details: 'Zum 31.03.2021 nach Wohnungsverkauf gekündigt' },
      { type: 'Sterbegeldversicherung', institution: 'Monuta Versicherungen', number: 'STG-88 220 141', details: 'Versicherungssumme 6.500 €, beitragsfrei seit 2018, Bezugsrecht Bestattungshaus Kremer' },
      { type: 'Unfallversicherung', institution: 'DEVK Versicherungen', number: 'UV-2211-4478', details: 'Zum 01.01.2020 gekündigt, kein Bedarf in stationärer Versorgung' }
    ],
    banks: [
      { type: 'Girokonto', institution: 'Sparkasse Koblenz', bankName: 'Sparkasse Koblenz', iban: 'DE68 5705 0120 0019 4471 03', bic: 'MALADE51KOB', accountHolder: 'Margarete Auerbach', saldo: '4922,71', saldoDatum: '31.07.2026', verwendungszweck: 'Verwaltungskonto der Betreuung', connectionId: '' },
      { type: 'Sparkonto', institution: 'Sparkasse Koblenz', bankName: 'Sparkasse Koblenz', iban: 'DE21 5705 0120 0044 7118 90', bic: 'MALADE51KOB', accountHolder: 'Margarete Auerbach', saldo: '8562,40', saldoDatum: '31.07.2026', verwendungszweck: 'Rücklage Bestattungsvorsorge (Sperrvermerk beantragt)', connectionId: '' },
      { type: 'Treuhandkonto', institution: 'Seniorenzentrum Sankt Elisabeth gGmbH', bankName: 'Sparkasse Koblenz', iban: 'DE44 5705 0120 0000 8841 20', bic: 'MALADE51KOB', accountHolder: 'Margarete Auerbach (Verwahrgeld)', saldo: '176,30', saldoDatum: '31.07.2026', verwendungszweck: 'Verwahrgeld / Barbetrag der Einrichtung', connectionId: '' },
      { type: 'Wertpapierdepot', institution: 'Sparkasse Koblenz', bankName: 'Deka Investment', iban: 'Depot 194471-03-D', bic: 'MALADE51KOB', accountHolder: 'Margarete Auerbach', saldo: '0,00', saldoDatum: '18.02.2022', verwendungszweck: 'Aufgelöst 02/2022, Erlös auf Girokonto', connectionId: '' }
    ],
    budget: { type: 'Barbetrag', amount: '135,00', method: 'Bar an die Einrichtung' },
    assetManagement: [
      { type: 'Barbetrag', amount: '135,00', method: 'Bar an die Einrichtung' },
      { type: 'Bekleidungsgeld', amount: '32,00', method: 'Überweisung' },
      { type: 'Taschengeld', amount: '25,00', method: 'Bar an die betreute Person' }
    ],
    accommodation: {
      type: 'Pflegeheim',
      currentResidence: {
        sameAsRegistered: false,
        institution: 'Seniorenzentrum Sankt Elisabeth gGmbH, Wohnbereich 2, Zimmer 214',
        type: 'Heim/Einrichtung',
        street: 'Mainzer Straße', houseNumber: '118', houseLetter: '',
        postalCode: '56154', city: 'Boppard', postbox: '', foreignCity: '', country: 'Deutschland'
      },
      monthlyCost: '3284,60', serviceCosts: '', electricityCosts: '', gasCosts: '',
      basicRent: '3284,60', heatingCosts: '', heatingType: 'Zentralheizung',
      hotWater: 'Zentral (über Heizung)', hotWaterPreparation: 'Zentral (über Heizung)', heating: 'Zentralheizung',
      housingSecurity: { status: 'secured', details: 'Heimvertrag vom 10.09.2019, unbefristet' },
      accessibility: { status: 'accessible', details: 'Vollständig barrierefrei, Aufzug, Pflegebad' },
      currentProblems: { status: 'none', details: 'Derzeit keine' },
      supportForms: ['Vollstationäre Pflege', 'Soziale Betreuung nach § 43b SGB XI', 'Physiotherapie', 'Aufsuchende zahnärztliche Versorgung'],
      supportDetails: 'Pflege rund um die Uhr durch den Wohnbereich 2. Zusätzlich Physiotherapie zweimal wöchentlich, Betreuungsassistenz nach § 43b SGB XI täglich, Friseur- und Fußpflegedienst im Haus.',
      housingSecurityEntries: [
        L.wohnEintrag(F, 'security', 1, { von: '2019-09-12', bis: '2021-03-31', status: 'at_risk', details: 'Eigene Zweizimmerwohnung Rheinallee 27 stand nach der Heimaufnahme leer; doppelte Kostenlast Miete und Heimentgelt.' }),
        L.wohnEintrag(F, 'security', 2, { von: '2021-04-01', status: 'secured', details: 'Heimplatz durch unbefristeten Heimvertrag gesichert; Eigentumswohnung mit gerichtlicher Genehmigung veräußert.', stand: '2026-07-14' })
      ],
      accessibilityEntries: [
        L.wohnEintrag(F, 'accessibility', 1, { von: '2019-09-12', bis: '2021-03-31', status: 'not_accessible', details: 'Alte Wohnung im 2. Obergeschoss ohne Aufzug, Badewanne ohne Einstiegshilfe.' }),
        L.wohnEintrag(F, 'accessibility', 2, { von: '2019-08-16', status: 'accessible', details: 'Einrichtung vollständig barrierefrei: Aufzug, bodengleiche Dusche, Pflegebad, Handläufe, Zimmer rollstuhlgerecht.', stand: '2026-03-24' })
      ],
      currentProblemEntries: [
        L.wohnEintrag(F, 'problems', 1, { von: '2022-01-17', bis: '2022-03-01', status: 'present', details: 'Nächtliche Unruhe und Hinlauftendenz nach Delir; Sitzwache und Sensormatte organisiert.' }),
        L.wohnEintrag(F, 'problems', 2, { von: '2026-02-27', bis: '2026-05-30', status: 'present', details: 'Nach Hüft-TEP zeitweise Zimmerwechsel in ein Pflegezimmer im Erdgeschoss erforderlich.' }),
        L.wohnEintrag(F, 'problems', 3, { von: '2026-06-01', status: 'none', details: 'Rückkehr in das vertraute Zimmer 214, keine aktuellen Probleme.', stand: '2026-08-11' })
      ],
      supportEntries: [
        L.wohnEintrag(F, 'support', 1, { von: '2019-08-16', status: 'active', formen: ['Vollstationäre Pflege', 'Soziale Betreuung nach § 43b SGB XI'], details: 'Pflegegrad 4, Wohnbereich 2, Bezugspflege durch Frau Özdemir.', stand: '2026-08-11' }),
        L.wohnEintrag(F, 'support', 2, { von: '2026-03-24', status: 'active', formen: ['Physiotherapie'], details: 'Zweimal wöchentlich Gangschulung nach Hüft-TEP, Verordnung Dr. Reinhard.', stand: '2026-08-11' }),
        L.wohnEintrag(F, 'support', 3, { von: '2020-02-01', bis: '2023-04-30', status: 'ended', formen: ['Ehrenamtliche Begleitung'], details: 'Besuchsdienst der Pfarrgemeinde St. Severus, beendet nach Umzug der Ehrenamtlichen.' })
      ]
    },
    provisions: L.vorsorge([
      ['patientenverfuegung', 'Hinterlegt', 'PV 2014/03'],
      ['vorsorgevollmacht', 'Widerrufen', '7 XVII 214/19'],
      ['betreuungsverfuegung', 'Vorhanden', 'BV 2014/03'],
      ['testament', 'Beim Notar hinterlegt', 'UR-Nr. 214/2013'],
      ['vorsorgeregister', 'Im Zentralen Vorsorgeregister eingetragen', 'ZVR 4471-8890-21'],
      ['bestattungsinstitut', 'Vorhanden', 'BV-2018-0091'],
      ['bestattungsvorsorge', 'Vorhanden', 'BV-2018-0091'],
      ['sterbegeldversicherung', 'Vorhanden', 'STG 88 220 141'],
      ['organspende', 'Ausdrücklich abgelehnt', '--'],
      ['totenfuersorge', 'Vorhanden', '--'],
      ['kontovollmacht', 'Widerrufen', '--'],
      ['digitaler_nachlass', 'Nicht vorhanden', '--']
    ]),
    socialNetwork: [
      { status: 'Aktiv', role: 'Kinder', detail: 'Tochter', salutation: 'Sehr geehrte Frau', title: '', firstName: 'Karin', lastName: 'Auerbach-Petri', institution: '', street: 'Hohenzollernstraße', house: '41', postal: '56068', city: 'Koblenz', phone: '0261 / 9034128', mobile: '0171 / 4478210', email: 'k.petri@example-mail.de', fullName: 'Karin Auerbach-Petri', address: 'Hohenzollernstraße 41, 56068 Koblenz', birthDate: '02.08.1968' },
      { status: 'Aktiv', role: 'Kinder', detail: 'Sohn', salutation: 'Sehr geehrter Herr', title: 'Dr.', firstName: 'Stefan', lastName: 'Auerbach', institution: '', street: 'Sülzburgstraße', house: '112', postal: '50937', city: 'Köln', phone: '0221 / 5540912', mobile: '0160 / 9928114', email: 's.auerbach@example-mail.de', fullName: 'Dr. Stefan Auerbach', address: 'Sülzburgstraße 112, 50937 Köln', birthDate: '17.01.1971' },
      { status: 'Aktiv', role: 'Familie', detail: 'Enkelin', salutation: 'Sehr geehrte Frau', firstName: 'Lea', lastName: 'Petri', institution: '', street: 'Hohenzollernstraße', house: '41', postal: '56068', city: 'Koblenz', phone: '', mobile: '0157 / 33440921', email: 'lea.petri@example-mail.de', fullName: 'Lea Petri', address: 'Hohenzollernstraße 41, 56068 Koblenz', birthDate: '11.04.1998' },
      { status: 'Aktiv', role: 'Peer / Bezugsperson', detail: 'Bezugspflegekraft', salutation: 'Sehr geehrte Frau', firstName: 'Ayşe', lastName: 'Özdemir', institution: 'Seniorenzentrum Sankt Elisabeth, Wohnbereich 2', street: 'Mainzer Straße', house: '118', postal: '56154', city: 'Boppard', phone: '06742 / 884122', mobile: '', email: 'wb2@st-elisabeth-boppard.de', fullName: 'Ayşe Özdemir', address: 'Mainzer Straße 118, 56154 Boppard' },
      { status: 'Aktiv', role: 'Vereinswesen', detail: 'Besuchsdienst Pfarrgemeinde', salutation: 'Sehr geehrte Frau', firstName: 'Hildegard', lastName: 'Braun', institution: 'Pfarrgemeinde St. Severus Boppard', street: 'Marktplatz', house: '3', postal: '56154', city: 'Boppard', phone: '06742 / 2214', mobile: '', email: 'besuchsdienst@st-severus-boppard.de', fullName: 'Hildegard Braun', address: 'Marktplatz 3, 56154 Boppard' },
      { status: 'Beendet', role: 'Nachbarschaft', detail: 'frühere Nachbarin Rheinallee', salutation: 'Sehr geehrte Frau', firstName: 'Ursula', lastName: 'Weinand', institution: '', street: 'Rheinallee', house: '27', postal: '56154', city: 'Boppard', phone: '06742 / 801944', mobile: '', email: '', fullName: 'Ursula Weinand', address: 'Rheinallee 27, 56154 Boppard' },
      { status: 'Aktiv', role: 'Betreuung', detail: 'rechtliche Betreuung', salutation: 'Sehr geehrter Herr', firstName: 'Christoph', lastName: 'Zepp', institution: 'Testbüroname', street: 'Marktplatz', house: '8', postal: '56346', city: 'St. Goarshausen', phone: '06771 / 959410', mobile: '', email: 'kanzlei@testbueroname.de', fullName: 'Christoph Zepp', address: 'Marktplatz 8, 56346 St. Goarshausen' }
    ],
    contactProfile: {
      understanding: 'with_support',
      trust: 'good',
      cooperation: 'cooperative',
      participation: 'with_support',
      conflicts: 'occasional',
      assessedAt: '2026-07-14',
      communicationMethods: ['spoken', 'simple_language', 'gesture', 'third_party'],
      communicationSupport: 'Kurze Sätze, ein Thema je Besuch, Ansprache von vorne wegen der Schwerhörigkeit; Hörgeräte müssen eingesetzt sein. Vormittags deutlich aufnahmefähiger als nachmittags. Schriftliche Unterlagen werden nicht mehr erfasst, wichtige Punkte werden mit der Tochter nachbesprochen.',
      conflictDescription: 'Wiederkehrend beim Thema Rückkehr in die eigene Wohnung. Frau Auerbach fragt bei fast jedem Besuch danach; die Antwort wird ruhig und ohne Konfrontation wiederholt. Kein Konflikt mit der Einrichtung oder der Familie.',
      evidenceSource: 'Eigene Besuche 14.07.2026 und 11.08.2026, Auskunft Bezugspflege Frau Özdemir, Stellungnahme Dr. Kohlmeyer vom 06.03.2025',
      canInitiateContact: 'nein',
      initiationSupport: 'Kontaktaufnahme über die Pflegedienstleitung des Wohnbereichs 2 oder über die Tochter',
      initiationChannels: ['facility', 'third_party', 'in_person'],
      initiationLimitationReason: 'Aufgrund der fortgeschrittenen Demenz kann Frau Auerbach weder Telefonnummern noch Anlässe erinnern. Ein Telefon steht im Zimmer, wird jedoch seit 2023 nicht mehr eigenständig genutzt.',
      reportRemarks: 'Die persönlichen Kontakte finden regelmäßig alle sechs bis acht Wochen im Wohnbereich 2 statt, zusätzlich anlassbezogen bei Krankenhausaufenthalten und Hilfeplangesprächen. Frau Auerbach erkennt die Betreuungsperson wieder, kann den rechtlichen Zusammenhang jedoch nicht mehr benennen. Die Zusammenarbeit mit der Einrichtung und den beiden Kindern ist verlässlich und konfliktfrei.'
    },
    handkasse: L.handkasse(F, [
      ['2026-01-08', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag Januar an die Einrichtung', 'Barbetrag', 135],
      ['2026-01-15', 'ausgabe', 'Friseursalon im Haus', 'Waschen und Schneiden', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 22],
      ['2026-01-24', 'ausgabe', 'Seniorenzentrum St. Elisabeth', 'Café-Nachmittag und Kuchen', 'Teilnahmebeiträge an Gruppenangeboten, Kursen, Begegnungsstätten', 9.5],
      ['2026-02-05', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag Februar an die Einrichtung', 'Barbetrag', 135],
      ['2026-02-06', 'ausgabe', 'Fußpflege Sonnenschein', 'Medizinische Fußpflege', 'Pflegeprodukte (Inkontinenzmaterial, Pflegemittel)', 28],
      ['2026-02-10', 'ausgabe', 'Kiosk Seniorenzentrum', 'Zeitschriften und Süßigkeiten', 'Zeitungen / Zeitschriften / Online-Abos', 14.4],
      ['2026-03-04', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag März an die Einrichtung', 'Barbetrag', 135],
      ['2026-03-19', 'ausgabe', 'Sanitätshaus Rheinvital', 'Eigenanteil Kompressionsstrümpfe', 'Heil- und Hilfsmittel (Schuhe, Orthesen, Rollator etc.)', 21],
      ['2026-03-27', 'ausgabe', 'Modehaus Krämer Boppard', 'Zwei Nachthemden und Hausschuhe', 'Kleidung / Schuhe', 78.9],
      ['2026-04-02', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag April an die Einrichtung', 'Barbetrag', 135],
      ['2026-04-11', 'ausgabe', 'Friseursalon im Haus', 'Waschen, Schneiden, Legen', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 26],
      ['2026-04-22', 'ausgabe', 'Bäckerei Zens', 'Geburtstagskuchen Wohnbereich', 'Geschenke (für Angehörige, Freunde)', 34.2],
      ['2026-05-06', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag Mai an die Einrichtung', 'Barbetrag', 135],
      ['2026-05-14', 'ausgabe', 'Fußpflege Sonnenschein', 'Medizinische Fußpflege', 'Pflegeprodukte (Inkontinenzmaterial, Pflegemittel)', 28],
      ['2026-05-28', 'ausgabe', 'Seniorenzentrum St. Elisabeth', 'Ausflug Rheinpromenade mit Begleitung', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 18],
      ['2026-06-03', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag Juni an die Einrichtung', 'Barbetrag', 135],
      ['2026-06-17', 'ausgabe', 'Hörzentrum Boppard', 'Batterien und Reinigungsset Hörgeräte', 'Heil- und Hilfsmittel (Schuhe, Orthesen, Rollator etc.)', 19.8],
      ['2026-06-30', 'ausgabe', 'Kiosk Seniorenzentrum', 'Zeitschriften Juni', 'Zeitungen / Zeitschriften / Online-Abos', 12.6],
      ['2026-07-02', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag Juli an die Einrichtung', 'Barbetrag', 135],
      ['2026-07-14', 'ausgabe', 'Friseursalon im Haus', 'Waschen und Schneiden', 'Freizeitangebote (Kino, Ausflüge, Schwimmbad etc.)', 22],
      ['2026-07-29', 'ausgabe', 'Modehaus Krämer Boppard', 'Sommerkleidung, drei Blusen', 'Kleidung / Schuhe', 96.5],
      ['2026-08-05', 'einnahme', 'Sparkasse Koblenz', 'Barbetrag August an die Einrichtung', 'Barbetrag', 135],
      ['2026-08-11', 'ausgabe', 'Fußpflege Sonnenschein', 'Medizinische Fußpflege', 'Pflegeprodukte (Inkontinenzmaterial, Pflegemittel)', 28]
    ]),
    assets: {
      begin: L.posten(F, 'vab', [
        ['Bargeld', 'Bargeldbestand in der Wohnung bei Betreuungsübernahme', '', 240],
        ['Girokonto', 'Kontostand 12.09.2019', 'Sparkasse Koblenz', 1842.16],
        ['Sparkonto', 'Sparbuch Nr. 44711890', 'Sparkasse Koblenz', 6200],
        ['Wertpapierdepot', 'Deka-Fondsdepot, 214 Anteile DekaFonds CF', 'Sparkasse Koblenz', 19740.5],
        ['Eigenheim / Eigentumswohnung', 'Zweizimmerwohnung Rheinallee 27, 56154 Boppard, 58 m², Grundbuch Boppard Bl. 4471', '', 142000],
        ['Wertvolle Möbel / Haushaltsgeräte (sofern von Bedeutung)', 'Hausrat der Wohnung, Schätzwert', '', 3500],
        ['Schmuck / Uhren', 'Eheringe, Goldkette, Brosche (im Tresor der Einrichtung)', '', 1450],
        ['Rückzahlungsansprüche (z. B. aus Kautionen, Mietkaution)', 'Nebenkostenguthaben 2018/2019', 'Stadtwerke Boppard GmbH', 184.3]
      ]),
      end: L.posten(F, 'vae', [
        ['Girokonto', 'Kontostand 31.07.2026, Verwaltungskonto', 'Sparkasse Koblenz', 4922.71],
        ['Sparkonto', 'Rücklage Bestattungsvorsorge', 'Sparkasse Koblenz', 8562.4],
        ['Treuhandkonto', 'Verwahrgeld der Einrichtung', 'Seniorenzentrum Sankt Elisabeth gGmbH', 176.3],
        ['Bargeld', 'Barbestand im Zimmer (Portemonnaie)', '', 45],
        ['Schmuck / Uhren', 'Eheringe, Goldkette, Brosche (Tresor der Einrichtung)', '', 1450],
        ['Wertvolle Möbel / Haushaltsgeräte (sofern von Bedeutung)', 'Persönliche Einrichtung Zimmer 214 (Sessel, Kommode, Bilder)', '', 900]
      ]),
      debtsBegin: [
        ...L.posten(F, 'vsb', [
          ['Nebenkosten / Betriebskosten', 'Wohngeldrückstand Eigentümergemeinschaft 2019', 'Hausverwaltung Rheinblick GmbH', 612.4],
          ['Heimkosten / Pflegesatz (stationäre Einrichtung)', 'Rückstand Eigenanteil bis 09/2019', 'Seniorenzentrum Sankt Elisabeth gGmbH', 4380]
        ]),
        ...L.schuldenSpiegel(schulden, 'begin')
      ],
      debtsEnd: [
        ...L.posten(F, 'vse', [
          ['Heimkosten / Pflegesatz (stationäre Einrichtung)', 'Laufender Eigenanteil Juli 2026, fällig 15.08.2026', 'Seniorenzentrum Sankt Elisabeth gGmbH', 412.6]
        ]),
        ...L.schuldenSpiegel(schulden, 'end')
      ]
    },
    livelihood: {
      income: L.einnahmen(F, [
        ['Gesetzliche Altersrente', 'Regelaltersrente, Zahlbetrag nach KV/PV-Abzug', 'Deutsche Rentenversicherung Rheinland-Pfalz', 'monatlich', 1184.22],
        ['Witwen- / Witwerrente', 'Große Witwenrente, Zahlbetrag', 'Deutsche Rentenversicherung Rheinland-Pfalz', 'monatlich', 612.88],
        ['Betriebsrente / Zusatzversorgung (z. B. VBL)', 'Zusatzversorgung öffentlicher Dienst', 'VBL Karlsruhe', 'monatlich', 214.4],
        ['Sozialhilfe – Hilfe zum Lebensunterhalt', 'Hilfe zur Pflege in Einrichtungen, aufstockend', 'Kreisverwaltung Rhein-Hunsrück-Kreis', 'monatlich', 1273.1],
        ['Zinsen (Guthaben auf Spar- und Tagesgeldkonten)', 'Sparzinsen Rücklagenkonto', 'Sparkasse Koblenz', 'jährlich', 5.2]
      ]),
      expenses: L.ausgaben(F, [
        ['Heimkosten / Pflegesatz (stationäre Einrichtung)', 'Gesamtheimentgelt inkl. Investitionskosten und Ausbildungsumlage', 'Seniorenzentrum Sankt Elisabeth gGmbH', 'monatlich', 3284.6, 'Laufende Kosten'],
        ['Haftpflichtversicherung', 'Privathaftpflicht, Jahresbeitrag umgelegt', 'Provinzial Rheinland Versicherung AG', 'jährlich', 6.53, 'Laufende Kosten'],
        ['Zuzahlungen Medikamente (Rezeptgebühren)', 'Zuzahlungsbefreiung seit 01.01.2020, kein laufender Aufwand', 'AOK Rheinland-Pfalz/Saarland', 'monatlich', 0, ''],
        ['Aufwandsentschädigung / Vergütung Berufsbetreuer (soweit vom Vermögen gezahlt)', 'Vergütung nach VBVG, vierteljährlich aus dem Vermögen', 'Testbüroname', 'vierteljährlich', 89.5, 'Laufende Kosten'],
        ['Kontoführungsgebühren', 'Girokonto Sparkasse Koblenz', 'Sparkasse Koblenz', 'monatlich', 4.9, 'Laufende Kosten'],
        ['Kleidung / Schuhe', 'Bekleidungspauschale aus dem Barbetrag', '', 'monatlich', 32, ''],
        ['Ratenzahlung Versandhandel / Möbelhaus / Elektronikmarkt', 'Rate Eigenanteil Pflegebett', 'Sanitätshaus Rheinvital GmbH', 'monatlich', 80, 'Ratenzahlungsvereinbarung geschlossen'],
        ['Teilnahmebeiträge an Gruppenangeboten, Kursen, Begegnungsstätten', 'Café-Nachmittage und Hausveranstaltungen', 'Seniorenzentrum Sankt Elisabeth gGmbH', 'monatlich', 12, '']
      ])
    },
    schuldenregulierung: schulden,
    approvals: L.genehmigungen(F, [
      ['2020-11-16', 'Wohnungsauflösung / Kündigung Mietvertrag', 'Auflösung des Hausrats der Eigentumswohnung Rheinallee 27 und Übergabe an den Käufer', 'Beratungsbedarf', 'genehmigt', '2020-12-14', '2021-02-27', 'Beschluss des Amtsgerichts St. Goarshausen vom 14.12.2020. Persönliche Erinnerungsstücke wurden vor der Auflösung gesichert und in das Zimmer 214 verbracht.'],
      ['2020-11-16', 'Größere Vermögensverfügung / Grundstücksgeschäft', 'Verkauf der Eigentumswohnung Rheinallee 27, 56154 Boppard, Kaufpreis 149.000 €', 'Widerstand nach Beratung', 'genehmigt', '2021-01-25', '2021-03-31', 'Genehmigung nach §§ 1850, 1855 BGB. Frau Auerbach lehnte den Verkauf zunächst ab; nach zwei Gesprächen und Erörterung der doppelten Kostenlast erklärte sie sich einverstanden, äußerte den Wunsch aber weiterhin ambivalent. Verkehrswertgutachten vom 02.10.2020 (142.000 €), erzielter Kaufpreis darüber.'],
      ['2021-04-08', 'Sonstiges', 'Anlage des Verkaufserlöses als Sparguthaben mit Sperrvermerk zugunsten der Bestattungsvorsorge', 'Einwilligung', 'genehmigt', '2021-05-11', '2021-05-20', 'Sperrvereinbarung mit der Sparkasse Koblenz; Freigabe nur mit gerichtlicher Genehmigung.'],
      ['2022-01-18', 'Freiheitsentziehende Maßnahme (§ 1831 Abs. 4 BGB)', 'Sensormatte und Bettseitenteile während des Delirs im Marienhaus Klinikum', 'Widerstand', 'abgelehnt', '', '', 'Antrag wurde nach Rücksprache mit der Klinik zurückgenommen; stattdessen Sitzwache und Niederflurbett. Kein Beschluss erforderlich.'],
      ['2023-02-14', 'Erbausschlagung / Erbauseinandersetzung', 'Ausschlagung des Erbes nach der verstorbenen Schwester Elfriede Hoffmann (überschuldeter Nachlass)', 'Beratungsbedarf', 'genehmigt', '2023-03-02', '2023-03-09', 'Nachlassverbindlichkeiten 21.400 €, Aktiva 3.100 €. Ausschlagung zur Niederschrift beim Nachlassgericht Bad Kreuznach am 09.03.2023.'],
      ['2026-02-10', 'Einwilligung in gefährliche Heilbehandlung / Operation (§ 1829 BGB)', 'Implantation einer Hüft-Totalendoprothese links nach medialer Schenkelhalsfraktur', 'Einwilligung nach Beratung', 'erledigt', '', '2026-02-12', 'Nach ärztlicher Aufklärung am 11.02.2026 kein begründetes Risiko im Sinne des § 1829 Abs. 2 BGB; gerichtliche Genehmigung damit entbehrlich. Patientenverfügung geprüft, Operation von ihr gedeckt.'],
      ['2026-06-22', 'Sonstiges', 'Teilfreigabe von 1.200 € aus dem gesperrten Sparguthaben für Bestattungsvorsorge-Nachzahlung', 'Einwilligung', 'beantragt', '', '', 'Antrag beim Betreuungsgericht eingereicht am 22.06.2026, Anhörung angekündigt.']
    ]),
    fristen: L.fristen(F, [
      ['Jahresbericht 01.10.2025 – 30.09.2026 an das Betreuungsgericht', 'Bericht', 'Amtsgericht St. Goarshausen', '2026-09-30', '2026-10-31', 'high', 'offen', 'Berichtszeitraum 01.10. bis 30.09., § 1863 Abs. 3 BGB.'],
      ['Rechnungslegung 01.10.2025 – 30.09.2026', 'Rechnungslegung', 'Amtsgericht St. Goarshausen', '2026-09-30', '2026-10-31', 'high', 'offen', 'Mit Kontoauszügen aller drei Konten und Belegen über 50 €.'],
      ['Weiterbewilligungsantrag Hilfe zur Pflege ab 01.01.2027', 'Weiterbewilligung', 'Kreisverwaltung Rhein-Hunsrück-Kreis, Sozialamt', '2026-12-31', '2026-11-15', 'high', 'offen', 'Bewilligung läuft zum 31.12.2026 aus; Nachweise über Renten und Vermögen beifügen.'],
      ['Vergütungsantrag 3. Quartal 2026 (VBVG)', 'Sonstige', 'Amtsgericht St. Goarshausen', '2026-09-30', '2026-10-15', 'normal', 'offen', 'Vermögende Betreute, Vergütung aus dem Vermögen.'],
      ['Gerichtliche Überprüfung der Betreuung', 'Sonstige', 'Amtsgericht St. Goarshausen', '2019-09-12', '2026-09-11', 'high', 'offen', 'Überprüfungsfrist nach § 294 Abs. 3 FamFG, sieben Jahre nach Bestellung.'],
      ['Stellungnahme zur Teilfreigabe Sparguthaben', 'Stellungnahme', 'Amtsgericht St. Goarshausen', '2026-06-22', '2026-09-05', 'normal', 'offen', 'Gericht hat um ergänzende Begründung und Vorlage des Vorsorgevertrages gebeten.'],
      ['Verlängerung Zuzahlungsbefreiung 2027', 'Antrag', 'AOK Rheinland-Pfalz/Saarland', '2026-12-31', '2026-12-01', 'normal', 'offen', 'Belastungsgrenze nach § 62 SGB V, Nachweis der Bruttoeinnahmen.'],
      ['Hilfeplangespräch / Pflegevisite Wohnbereich 2', 'Sonstige', 'Seniorenzentrum Sankt Elisabeth gGmbH', '2026-08-11', '2026-10-20', 'normal', 'offen', 'Halbjährliche Pflegeplanung, Teilnahme der Tochter angefragt.']
    ]),
    goalDecisionPlanning: L.planung(F, [
      {
        typ: 'wish', titel: 'Rückkehr in die eigene Wohnung', bereich: 'Wohnen',
        beschreibung: 'Frau Auerbach äußert bei fast jedem Besuch den Wunsch, wieder in ihre Wohnung in der Rheinallee zu ziehen. Der Wunsch wird ernst genommen und dokumentiert, ist nach dem Verkauf der Wohnung 2021 jedoch nicht mehr erfüllbar.',
        aussage: '„Ich möchte wieder nach Hause, in meine eigenen vier Wände."',
        status: 'Zurückgestellt', prioritaet: 'Hoch', zustaendig: 'Christoph Zepp',
        angelegt: '2019-10-02', stand: '2026-07-14', zieldatum: '', pruefdatum: '2027-01-15',
        quelle: 'Persönliches Gespräch am 02.10.2019, seither fortlaufend', favorit: true,
        module: ['doku', 'approval'], fortschritt: 0,
        verlauf: [
          ['2019-10-02', 'Eintrag angelegt', 'Wunsch erstmals geäußert'],
          ['2021-03-31', 'Eintrag bearbeitet', 'Wohnung veräußert – Wunsch nicht mehr erfüllbar, bleibt dokumentiert'],
          ['2026-07-14', 'Eintrag geprüft', 'Wunsch wird weiterhin regelmäßig geäußert; Umgang: ruhige Wiederholung ohne Konfrontation']
        ]
      },
      {
        typ: 'need', titel: 'Sicherung der Heimfinanzierung', bereich: 'Finanzen & Vermögen',
        beschreibung: 'Das monatliche Heimentgelt von 3.284,60 € übersteigt die eigenen Einkünfte deutlich. Ohne dauerhafte Hilfe zur Pflege ist der Heimplatz nicht finanzierbar.',
        status: 'In Bearbeitung', prioritaet: 'Dringend', zustaendig: 'Christoph Zepp',
        angelegt: '2019-10-14', stand: '2026-08-04', zieldatum: '2026-11-15', pruefdatum: '2026-11-15',
        quelle: 'Heimvertrag und Rentenbescheide', module: ['doku', 'deadline', 'task'], fortschritt: 70,
        verlauf: [
          ['2019-10-14', 'Eintrag angelegt', 'Erstantrag Hilfe zur Pflege gestellt'],
          ['2021-04-19', 'Eintrag bearbeitet', 'Nach Wohnungsverkauf zunächst Einsatz des Vermögens, Leistung ruhte bis 08/2022'],
          ['2026-08-04', 'Eintrag bearbeitet', 'Weiterbewilligung ab 01.01.2027 vorbereitet']
        ]
      },
      {
        typ: 'goal', titel: 'Erhalt der Mobilität nach der Hüftoperation', bereich: 'Gesundheit & Pflege',
        beschreibung: 'Frau Auerbach soll sich im Wohnbereich wieder selbstständig mit dem Rollator bewegen können, um an den Mahlzeiten im Speisesaal und am Café-Nachmittag teilzunehmen.',
        status: 'Erreicht', prioritaet: 'Hoch', zustaendig: 'Wohnbereich 2 / Physiotherapie',
        angelegt: '2026-03-24', stand: '2026-07-14', zieldatum: '2026-06-30', pruefdatum: '2026-09-30',
        quelle: 'Reha-Entlassbericht Median Bad Salzig vom 24.03.2026',
        module: ['doku', 'task', 'calendar'], fortschritt: 100, favorit: true,
        smart: {
          formulation: 'Frau Auerbach geht bis zum 30.06.2026 wieder selbstständig mit dem Rollator zu den Mahlzeiten im Speisesaal.',
          specific: 'Gehstrecke Zimmer 214 bis Speisesaal (ca. 45 Meter) ohne personelle Hilfe',
          measurable: 'Pflegedokumentation: mindestens fünf von sieben Tagen pro Woche selbstständig',
          attractive: 'Teilnahme am gemeinsamen Essen ist ihr wichtig und stabilisiert den Tagesrhythmus',
          realistic: 'Vor der Fraktur war die Strecke möglich; Physiotherapie zweimal wöchentlich verordnet',
          timeBound: 'bis 30.06.2026, Überprüfung im Pflegevisitengespräch'
        },
        verlauf: [
          ['2026-03-24', 'Eintrag angelegt', 'Nach Rückkehr aus der Reha'],
          ['2026-05-20', 'Eintrag bearbeitet', 'Gehstrecke 25 Meter mit Aufsicht erreicht'],
          ['2026-07-14', 'Eintrag abgeschlossen', 'Ziel erreicht, Teilnahme an Mahlzeiten und Café-Nachmittag regelmäßig']
        ]
      },
      {
        typ: 'measure', titel: 'Bestattungsvorsorge absichern', bereich: 'Vorsorge',
        beschreibung: 'Der 2018 geschlossene Vorsorgevertrag mit dem Bestattungshaus Kremer soll durch das gesperrte Sparguthaben und die Sterbegeldversicherung vollständig gedeckt sein. Nachzahlung von 1.200 € wegen Preisanpassung erforderlich.',
        status: 'Zur Entscheidung', prioritaet: 'Normal', zustaendig: 'Christoph Zepp',
        angelegt: '2026-06-05', stand: '2026-06-22', zieldatum: '2026-10-31', pruefdatum: '2026-10-31',
        quelle: 'Schreiben Bestattungshaus Kremer vom 28.05.2026',
        module: ['approval', 'doku', 'deadline'], fortschritt: 40,
        verlauf: [
          ['2026-06-05', 'Eintrag angelegt', 'Preisanpassung des Vorsorgevertrages mitgeteilt'],
          ['2026-06-22', 'Eintrag bearbeitet', 'Antrag auf Teilfreigabe beim Betreuungsgericht eingereicht']
        ]
      },
      {
        typ: 'decision', titel: 'Keine künstliche Ernährung über PEG-Sonde', bereich: 'Gesundheit & Pflege',
        beschreibung: 'Die Patientenverfügung vom 12.03.2014 schließt eine künstliche Ernährung über eine PEG-Sonde bei fortgeschrittener Demenz ausdrücklich aus. Diese Festlegung wurde mit Dr. Reinhard, Dr. Kohlmeyer und der Pflegedienstleitung besprochen und in der Pflegedokumentation hinterlegt.',
        status: 'Abgeschlossen', prioritaet: 'Hoch', zustaendig: 'Christoph Zepp',
        angelegt: '2025-03-06', stand: '2025-03-20', zieldatum: '2025-03-20', pruefdatum: '2027-03-01',
        quelle: 'Patientenverfügung Ziff. 3 und 4, Gespräch mit den Kindern am 15.03.2025',
        module: ['doku', 'approval'], fortschritt: 100,
        verlauf: [
          ['2025-03-06', 'Eintrag angelegt', 'Nach der Stellungnahme zur Einwilligungsfähigkeit'],
          ['2025-03-15', 'Eintrag bearbeitet', 'Abstimmung mit Tochter und Sohn, beide tragen die Festlegung mit'],
          ['2025-03-20', 'Eintrag abgeschlossen', 'In Pflegedokumentation und Notfallbogen hinterlegt']
        ]
      },
      {
        typ: 'review', titel: 'Überprüfung der Erforderlichkeit der Betreuung', bereich: 'Behörden & Recht',
        beschreibung: 'Zum 11.09.2026 steht die gerichtliche Überprüfung nach sieben Jahren an. Zu prüfen ist, ob alle Aufgabenkreise weiterhin erforderlich sind, insbesondere die Wohnungsangelegenheiten nach dem Verkauf der Wohnung.',
        status: 'Offen', prioritaet: 'Hoch', zustaendig: 'Christoph Zepp',
        angelegt: '2026-05-04', stand: '2026-08-04', zieldatum: '2026-09-11', pruefdatum: '2026-09-11',
        quelle: 'Fristenkalender / § 294 Abs. 3 FamFG',
        module: ['deadline', 'doku'], fortschritt: 25,
        verlauf: [
          ['2026-05-04', 'Eintrag angelegt', 'Überprüfungsfrist vorgemerkt'],
          ['2026-08-04', 'Eintrag bearbeitet', 'Vorschlag: Aufgabenkreis Wohnungsangelegenheiten kann entfallen']
        ]
      },
      {
        typ: 'wish', titel: 'Regelmäßiger Kontakt zu den Enkelkindern', bereich: 'Soziales Umfeld',
        beschreibung: 'Frau Auerbach freut sich sichtbar über die Besuche ihrer Enkelin Lea. Sie wünscht sich häufigeren Kontakt, kann ihn aber nicht selbst anbahnen.',
        status: 'In Bearbeitung', prioritaet: 'Normal', zustaendig: 'Karin Auerbach-Petri',
        angelegt: '2024-04-18', stand: '2026-07-14', zieldatum: '', pruefdatum: '2026-12-15',
        quelle: 'Beobachtung bei Besuchen, Gespräch mit der Tochter',
        module: ['doku', 'calendar'], fortschritt: 60,
        verlauf: [
          ['2024-04-18', 'Eintrag angelegt', 'Wunsch nach mehr Familienkontakt'],
          ['2026-07-14', 'Eintrag bearbeitet', 'Enkelin besucht seit 2025 etwa alle sechs Wochen']
        ]
      },
      {
        typ: 'need', titel: 'Hörgeräteversorgung sicherstellen', bereich: 'Gesundheit & Pflege',
        beschreibung: 'Ohne funktionierende Hörgeräte bricht die Verständigung fast vollständig zusammen. Batterien, Reinigung und jährliche Nachjustierung müssen verlässlich organisiert sein.',
        status: 'In Bearbeitung', prioritaet: 'Hoch', zustaendig: 'Wohnbereich 2',
        angelegt: '2024-05-14', stand: '2026-06-17', zieldatum: '', pruefdatum: '2026-11-30',
        quelle: 'Neuanpassung Hörzentrum Boppard 05/2024',
        module: ['doku', 'task'], fortschritt: 80,
        verlauf: [
          ['2024-05-14', 'Eintrag angelegt', 'Neuanpassung beider Geräte'],
          ['2026-06-17', 'Eintrag bearbeitet', 'Batterievorrat und Reinigungsset über die Handkasse beschafft']
        ]
      }
    ]),
    accounting: L.rechnungslegung(F, {
      von: '2025-10-01', bis: '2026-09-30',
      konten,
      vermoegen: [
        ['Bargeld und Bankguthaben', 'Giro-, Spar- und Verwahrgeldkonto', 11894.72, 13661.41],
        ['Kunstgegenstände und Schmuck', 'Eheringe, Goldkette, Brosche', 1450, 1450],
        ['Haushaltsgegenstände', 'Persönliche Einrichtung Zimmer 214', 1100, 900]
      ],
      verbindlichkeiten: [
        ['Sanitätshaus Rheinvital GmbH', 'Eigenanteil Pflegebett, Ratenvereinbarung 6/2025', 491.9, 91.9],
        ['Seniorenzentrum Sankt Elisabeth gGmbH', 'Laufender Eigenanteil, jeweils Folgemonat', 408.2, 412.6]
      ],
      schenkungen: [
        ['Lea Petri', 'Geldgeschenk zum Studienabschluss (angemessene Gelegenheitsschenkung)', '2025-11-22', 150],
        ['Pfarrgemeinde St. Severus', 'Spende Weihnachtskollekte, langjährige Gewohnheit', '2025-12-24', 30]
      ]
    }),
    exportHistory: [],
    archives: [],
    history: [],
    contacts: [],
    contactMerges: [],
    promptHints: 'Fortgeschrittene Demenz: Berichte sachlich und knapp halten, Wünsche der betreuten Person ausdrücklich als geäußerte Wünsche kennzeichnen, nicht als Vereinbarungen. Vermögende Betreute: Vergütung aus dem Vermögen, Rechnungslegungspflicht.',
    derived: {}
  },

  kontakte: [
    { kategorie: 'behoerden', rolle: 'Betreuungsgericht', institution: 'Amtsgericht St. Goarshausen', strasse: 'Bahnhofstraße', hausnummer: '8', plz: '56346', ort: 'St. Goarshausen', telefon: '06771/9330', fax: '06771/933140', mail: 'poststelle.ag-goh@ko.mjv.rlp.de', aktenzeichen: '7 XVII 214/19', gericht: 'Amtsgericht St. Goarshausen', gerichtsAz: '7 XVII 214/19' },
    { kategorie: 'behoerden', rolle: 'Betreuungsbehörde', institution: 'Kreisverwaltung Rhein-Hunsrück-Kreis, Betreuungsbehörde', strasse: 'Ludwigstraße', hausnummer: '3-5', plz: '55469', ort: 'Simmern/Hunsrück', telefon: '06761/820', mail: 'betreuungsbehoerde@rhein-hunsrueck.de', aktenzeichen: 'BB 2019/0417' },
    { kategorie: 'behoerden', rolle: 'Sozialamt - Hilfe zum Lebensunterhalt', institution: 'Kreisverwaltung Rhein-Hunsrück-Kreis, Sozialamt', strasse: 'Ludwigstraße', hausnummer: '3-5', plz: '55469', ort: 'Simmern/Hunsrück', telefon: '06761/8215', fax: '06761/821590', mail: 'sozialamt@rhein-hunsrueck.de', aktenzeichen: 'SA-RLP/BOP-2019-4471', anrede: 'Sehr geehrte Damen und Herren' },
    { kategorie: 'behoerden', rolle: 'LSJV / Versorgungsamt', institution: 'Landesamt für Soziales, Jugend und Versorgung', strasse: 'Rheinallee', hausnummer: '97-101', plz: '55118', ort: 'Mainz', telefon: '06131/9670', mail: 'poststelle@lsjv.rlp.de', aktenzeichen: 'SB 2019/114 402' },
    { kategorie: 'behoerden', rolle: 'Finanzverwaltung / Finanzamt', institution: 'Finanzamt St. Goarshausen', strasse: 'Bahnhofstraße', hausnummer: '30', plz: '56346', ort: 'St. Goarshausen', telefon: '06771/9440', aktenzeichen: '30/241/50218' , mail: 'poststelle@fa-st-goarshausen.fin-rlp.de' },
    { kategorie: 'behoerden', rolle: 'Einwohnermeldeamt', institution: 'Stadtverwaltung Boppard, Bürgerbüro', strasse: 'Marktplatz', hausnummer: '1', plz: '56154', ort: 'Boppard', telefon: '06742/1010', mail: 'buergerbuero@boppard.de' },
    { kategorie: 'behoerden', rolle: 'Nachlassgericht', institution: 'Amtsgericht Bad Kreuznach, Nachlassgericht', strasse: 'Ringstraße', hausnummer: '79', plz: '55543', ort: 'Bad Kreuznach', telefon: '0671/8360', aktenzeichen: 'VI 214/23', vorgang: 'Ausschlagung Nachlass Elfriede Hoffmann' , mail: 'poststelle.ag-bad-kreuznach@ko.mjv.rlp.de' },
    { kategorie: 'gesundheit', rolle: 'Gerontopsychiatrie', anrede: 'Sehr geehrte Frau', titel: 'Dr. med.', vorname: 'Annegret', nachname: 'Kohlmeyer', institution: 'Praxis für Psychiatrie und Psychotherapie', strasse: 'Oberstraße', hausnummer: '44', plz: '56154', ort: 'Boppard', telefon: '06742/301188', fax: '06742/301189', mail: 'praxis@kohlmeyer-boppard.de' },
    { kategorie: 'gesundheit', rolle: 'Allgemeinmedizin', anrede: 'Sehr geehrter Herr', titel: 'Dr. med.', vorname: 'Tobias', nachname: 'Reinhard', institution: 'Hausarztpraxis am Rhein (Heimarzt)', strasse: 'Rheinallee', hausnummer: '12', plz: '56154', ort: 'Boppard', telefon: '06742/449021', mail: 'kontakt@hausarzt-reinhard.de' },
    { kategorie: 'gesundheit', rolle: 'Diabetologie', anrede: 'Sehr geehrte Frau', titel: 'Dr. med.', vorname: 'Silke', nachname: 'Baumgart', institution: 'Medizinisches Zentrum Lahnstein', strasse: 'Adolfstraße', hausnummer: '9', plz: '56112', ort: 'Lahnstein', telefon: '02621/778430', mail: 'diabetologie@mzk-lahnstein.de' },
    { kategorie: 'gesundheit', rolle: 'Krankenhaus', institution: 'Gemeinschaftsklinikum Mittelrhein, Kemperhof', strasse: 'Koblenzer Straße', hausnummer: '115-155', plz: '56073', ort: 'Koblenz', telefon: '0261/4960', mail: 'info@gk-mittelrhein.de', vorgang: 'Hüft-TEP 02/2026' },
    { kategorie: 'gesundheit', rolle: 'stationäre Pflege', institution: 'Seniorenzentrum Sankt Elisabeth gGmbH', strasse: 'Mainzer Straße', hausnummer: '118', plz: '56154', ort: 'Boppard', telefon: '06742/884120', fax: '06742/884129', mail: 'verwaltung@st-elisabeth-boppard.de', aktenzeichen: 'HV-2019-0442' },
    { kategorie: 'gesundheit', rolle: 'Medizinischer Dienst (MD)', institution: 'Medizinischer Dienst Rheinland-Pfalz', strasse: 'Albiger Straße', hausnummer: '19d', plz: '55232', ort: 'Alzey', telefon: '06731/4860', vorgang: 'Pflegegradbegutachtung 04/2023' , mail: 'info@md-rlp.de' },
    { kategorie: 'gesundheit', rolle: 'Apotheke', institution: 'Severus-Apotheke Boppard', strasse: 'Oberstraße', hausnummer: '112', plz: '56154', ort: 'Boppard', telefon: '06742/2280', mail: 'info@severus-apotheke.de', vorgang: 'Blisterversorgung Wohnbereich 2' },
    { kategorie: 'gesundheit', rolle: 'Zahnmedizin', anrede: 'Sehr geehrte Frau', vorname: 'Marion', nachname: 'Seibold', institution: 'Zahnarztpraxis Seibold (aufsuchende Behandlung)', strasse: 'Kirchgasse', hausnummer: '7', plz: '56154', ort: 'Boppard', telefon: '06742/812255', mail: 'praxis@zahn-seibold.de' },
    { kategorie: 'finanzen', rolle: 'Bankinstut', institution: 'Sparkasse Koblenz', strasse: 'Bahnhofstraße', hausnummer: '11', plz: '56068', ort: 'Koblenz', telefon: '0261/3930', mail: 'info@sparkasse-koblenz.de', iban: 'DE68 5705 0120 0019 4471 03', bic: 'MALADE51KOB', bank: 'Sparkasse Koblenz' },
    { kategorie: 'finanzen', rolle: 'Steuerberatung/Buchhaltung', institution: 'Steuerbüro Wendel & Partner', strasse: 'Koblenzer Straße', hausnummer: '18', plz: '56154', ort: 'Boppard', telefon: '06742/939200', mail: 'kanzlei@wendel-steuer.de', vorgang: 'Einkommensteuererklärung 2020-2025' },
    { kategorie: 'finanzen', rolle: 'Gläubiger', institution: 'Sanitätshaus Rheinvital GmbH', strasse: 'Emser Straße', hausnummer: '204', plz: '56076', ort: 'Koblenz', telefon: '0261/442180', mail: 'buchhaltung@rheinvital.de', aktenzeichen: 'RV-25-8817', iban: 'DE29 5705 0120 0000 4471 88', bic: 'MALADE51KOB' },
    { kategorie: 'finanzen', rolle: 'Abonoment', institution: 'ARD ZDF Deutschlandradio Beitragsservice', strasse: '', hausnummer: '', plz: '50656', ort: 'Köln', postfach: '50656 Köln', telefon: '01806/999555', aktenzeichen: '431 998 227' , mail: 'service@rundfunkbeitrag.de' },
    { kategorie: 'versicherungen', rolle: 'Gesundheitsversicherung (gesetzlich)', institution: 'AOK Rheinland-Pfalz/Saarland', strasse: 'Eisenbahnstraße', hausnummer: '6-8', plz: '67655', ort: 'Kaiserslautern', telefon: '0800/0265637', mail: 'service@rps.aok.de', aktenzeichen: 'A144190377' },
    { kategorie: 'versicherungen', rolle: 'Pflegezusatzversicherung', institution: 'AOK Pflegekasse Rheinland-Pfalz/Saarland', strasse: 'Eisenbahnstraße', hausnummer: '6-8', plz: '67655', ort: 'Kaiserslautern', telefon: '0800/0265637', aktenzeichen: 'PK-A144190377' , mail: 'pflegekasse@rps.aok.de' },
    { kategorie: 'versicherungen', rolle: 'Rentenversicherung', institution: 'Deutsche Rentenversicherung Rheinland-Pfalz', strasse: 'Eichendorffstraße', hausnummer: '4-6', plz: '67346', ort: 'Speyer', telefon: '06232/170', mail: 'service@drv-rlp.de', aktenzeichen: '14 140341 H 512' },
    { kategorie: 'versicherungen', rolle: 'Privathatfplicht', institution: 'Provinzial Rheinland Versicherung AG', strasse: 'Provinzialplatz', hausnummer: '1', plz: '40591', ort: 'Düsseldorf', telefon: '0211/9780', aktenzeichen: 'PH-4471-908-2' , mail: 'service@provinzial.de' },
    { kategorie: 'versicherungen', rolle: 'Sterbegeldversicherung', institution: 'Monuta Versicherungen', strasse: 'Kaiserstraße', hausnummer: '18', plz: '40479', ort: 'Düsseldorf', telefon: '0211/58671000', aktenzeichen: 'STG-88 220 141' , mail: 'info@monuta.de' },
    { kategorie: 'unterkunft', rolle: 'Einrichtungsträger', institution: 'Seniorenzentrum Sankt Elisabeth gGmbH, Verwaltung', strasse: 'Mainzer Straße', hausnummer: '118', plz: '56154', ort: 'Boppard', telefon: '06742/884100', fax: '06742/884129', mail: 'verwaltung@st-elisabeth-boppard.de', aktenzeichen: 'HV-2019-0442', iban: 'DE44 5705 0120 0000 8841 20', bic: 'MALADE51KOB' },
    { kategorie: 'unterkunft', rolle: 'Beitragsservice', status: 'Befreit', institution: 'ARD ZDF Deutschlandradio Beitragsservice', plz: '50656', ort: 'Köln', telefon: '01806/999555', aktenzeichen: '431 998 227' , mail: 'service@rundfunkbeitrag.de' , postfach: '50656 Köln' },
    { kategorie: 'unterkunft', rolle: 'Vermieter', status: 'Beendet', institution: 'Hausverwaltung Rheinblick GmbH (WEG Rheinallee 27)', strasse: 'Rheinallee', hausnummer: '2', plz: '56154', ort: 'Boppard', telefon: '06742/801200', mail: 'weg@rheinblick-hv.de', vorgang: 'WEG-Verwaltung bis Verkauf 31.03.2021' },
    { kategorie: 'soziales', rolle: 'Tochter', anrede: 'Sehr geehrte Frau', vorname: 'Karin', nachname: 'Auerbach-Petri', strasse: 'Hohenzollernstraße', hausnummer: '41', plz: '56068', ort: 'Koblenz', telefon: '0261/9034128', mobil: '0171/4478210', mail: 'k.petri@example-mail.de' },
    { kategorie: 'soziales', rolle: 'Sohn', anrede: 'Sehr geehrter Herr', titel: 'Dr.', vorname: 'Stefan', nachname: 'Auerbach', strasse: 'Sülzburgstraße', hausnummer: '112', plz: '50937', ort: 'Köln', telefon: '0221/5540912', mobil: '0160/9928114', mail: 's.auerbach@example-mail.de' },
    { kategorie: 'soziales', rolle: 'Enkel', anrede: 'Sehr geehrte Frau', vorname: 'Lea', nachname: 'Petri', strasse: 'Hohenzollernstraße', hausnummer: '41', plz: '56068', ort: 'Koblenz', mobil: '0157/33440921', mail: 'lea.petri@example-mail.de' , telefon: '0261/9014477' },
    { kategorie: 'soziales', rolle: 'Verein (Ehrenamt)', anrede: 'Sehr geehrte Frau', vorname: 'Hildegard', nachname: 'Braun', institution: 'Besuchsdienst Pfarrgemeinde St. Severus', strasse: 'Marktplatz', hausnummer: '3', plz: '56154', ort: 'Boppard', telefon: '06742/2214', mail: 'besuchsdienst@st-severus-boppard.de' },
    { kategorie: 'soziales', rolle: 'aktuelle Betreuung', anrede: 'Sehr geehrter Herr', vorname: 'Christoph', nachname: 'Zepp', institution: 'Betreuungsbüro Rheinblick', strasse: 'Marktplatz', hausnummer: '8', plz: '56346', ort: 'St. Goarshausen', telefon: '06771/959410', mail: 'kanzlei@betreuungsbuero-rheinblick.de' }
  ],

  doku: L.doku([
    ['2019-09-12', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Betreuungsspezifischer Vorgang', 'Übernahme einer neuen Betreuung / Erstgespräch / Aktenanlage', 'Schriftlich (Brief)', 'Bestellungsurkunde erhalten', 'Beschluss vom 05.09.2019 zugestellt. Aufgabenkreise: Vermögenssorge (mit Einwilligungsvorbehalt), Gesundheitssorge, Aufenthaltsbestimmung, Wohnungsangelegenheiten, Heim- und Pflegeangelegenheiten, Behördenvertretung, Post- und Fernmeldeangelegenheiten. Akte angelegt, Register 00-12 im Dokumentenspeicher erzeugt.'],
    ['2019-09-18', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Beratungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Erstbesuch im Seniorenzentrum', 'Erster persönlicher Kontakt im Wohnbereich 2, Zimmer 214. Frau Auerbach war freundlich zugewandt, konnte den Anlass des Besuches nicht einordnen. Sie äußerte den Wunsch, „bald wieder nach Hause" zu können. Aufgabenkreise in einfacher Sprache erklärt, Visitenkarte am Zimmerschrank hinterlegt.'],
    ['2019-09-25', 'Gesundheit, Pflege & Rehabilitation', 'Stationäre Pflegeeinrichtung / Wohnheim', 'Beratung, Abstimmung & Hilfeplanung', 'Kontakt / Koordination mit Pflegedienst / Einrichtung', 'persönlich (Einrichtung / Klinik)', 'Heimvertrag und Kostenstruktur besprochen', 'Gespräch mit der Verwaltungsleitung. Heimentgelt zum damaligen Zeitpunkt 2.914,80 €. Rückstand des Eigenanteils von 4.380 € aus der Zeit vor der Betreuung festgestellt. Ratenzahlung von 300 € monatlich vereinbart.'],
    ['2019-10-02', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Beratung, Abstimmung & Hilfeplanung', 'Beratungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Wünsche und Vorstellungen erhoben', 'Frau Auerbach wünscht sich vor allem die Rückkehr in ihre Wohnung. Sie legt Wert auf gepflegtes Äußeres (Friseur), auf ihre Zeitschriften und darauf, dass die Kinder regelmäßig kommen. Wunsch nach Rückkehr in „Bedarfe & Wille" aufgenommen.'],
    ['2019-10-08', 'Finanzen, Vermögen & Schulden', 'Bank / Sparkasse', 'Finanzen, Vermögen & Schulden', 'Kontoeröffnung / Kontoschließung', 'persönlich (Gericht / Behörde)', 'Konten umgestellt', 'Bestellungsurkunde bei der Sparkasse Koblenz vorgelegt. Girokonto auf Betreuerverfügung umgestellt, Online-Banking der Tochter gelöscht. Vermögensübersicht erstellt: Girokonto 1.842,16 €, Sparbuch 6.200 €, Depot 19.740,50 €, Eigentumswohnung.'],
    ['2019-10-14', 'Sozialleistungsträger & öffentliche Stellen', 'Sozialamt (inkl. Grundsicherung, Hilfe zum Lebensunterhalt)', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Erstantrag Hilfe zur Pflege', 'Antrag auf Hilfe zur Pflege in Einrichtungen nach dem 7. Kapitel SGB XII gestellt. Unterlagen: Rentenbescheide, Heimvertrag, Pflegegradbescheid, Vermögensaufstellung, Kontoauszüge der letzten drei Monate.'],
    ['2019-11-06', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Betreuungsspezifischer Vorgang', 'Vermögensübersicht erstellen / aktualisieren', 'Schriftlich (Brief)', 'Vermögensverzeichnis eingereicht', 'Vermögensverzeichnis zum Stichtag 12.09.2019 mit acht Positionen und zwei Verbindlichkeiten eingereicht. Wohnung mit vorläufigem Wert von 142.000 € angesetzt.'],
    ['2019-12-11', 'Sozialleistungsträger & öffentliche Stellen', 'Sozialamt (inkl. Grundsicherung, Hilfe zum Lebensunterhalt)', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Bewilligungsbescheid mit Vorbehalt', 'Hilfe zur Pflege dem Grunde nach bewilligt, jedoch Hinweis auf einzusetzendes Vermögen (Eigentumswohnung). Leistung zunächst darlehensweise nach § 91 SGB XII.'],
    ['2020-03-04', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Gespräch geführt', 'persönlich (Einrichtung / Klinik)', 'Quartalsbesuch', 'Frau Auerbach war orientiert zur Person, nicht zu Zeit und Ort. Sie hat den Besuch sichtlich genossen und mehrfach nach ihrem verstorbenen Mann gefragt. Pflege berichtet von gutem Allgemeinzustand.'],
    ['2020-06-17', 'Wohnen, Energie & Kommunikation', 'Vermieter:in / Wohnungsunternehmen / Hausverwaltung', 'Wohnen, Aufenthalt & Unterbringung', 'Unterkunftsangelegenheit (Sicherung Unterkunft, Mietrückstände etc.)', 'telefonisch', 'Wohngeldrückstand der WEG geklärt', 'Hausverwaltung Rheinblick meldet Wohngeldrückstand von 612,40 €. Aus dem Girokonto ausgeglichen. Hinweis, dass die Wohnung dauerhaft leer steht und Kosten von rund 340 € monatlich verursacht.'],
    ['2020-09-30', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Betreuungsspezifischer Vorgang', 'Jahresbericht / Entwicklungsbericht', 'Schriftlich (Brief)', 'Erster Jahresbericht', 'Jahresbericht 12.09.2019 bis 30.09.2020 nebst Rechnungslegung eingereicht. Hinweis auf die wirtschaftliche Notwendigkeit, die Eigentumswohnung zu veräußern.'],
    ['2020-10-08', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Beratung, Abstimmung & Hilfeplanung', 'Beratungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Erstes Gespräch über den Wohnungsverkauf', 'Frau Auerbach lehnte den Verkauf klar ab („Das ist mein Zuhause"). Kein Drängen; Gespräch nach 20 Minuten beendet und für einen späteren Termin vertagt. Wille dokumentiert.'],
    ['2020-11-05', 'Betroffene Person / unmittelbares Umfeld', 'Familie / Angehörige', 'Beratung, Abstimmung & Hilfeplanung', 'Helferkonferenz / Fallbesprechung durchgeführt', 'persönlich (Betreuungsbüro)', 'Familiengespräch zum Wohnungsverkauf', 'Tochter und Sohn im Büro. Beide tragen den Verkauf mit, möchten aber, dass die Mutter nicht überrumpelt wird. Vereinbart: zweites Gespräch mit der Mutter im Beisein der Tochter.'],
    ['2020-11-12', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Beratung, Abstimmung & Hilfeplanung', 'Beratungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Zweites Gespräch, Tochter anwesend', 'Nach ruhiger Erläuterung der doppelten Kostenlast erklärte Frau Auerbach: „Wenn es sein muss, dann macht das." Sie blieb dabei ambivalent und fragte anschließend erneut, wann sie nach Hause könne. Zustimmung als „Einwilligung nach Beratung mit fortbestehendem Widerstreben" gewertet.'],
    ['2020-11-16', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Antrag auf Genehmigung des Wohnungsverkaufs', 'Antrag nach §§ 1850, 1855 BGB nebst Verkehrswertgutachten (142.000 €), Exposé und Entwurf des Kaufvertrages. Zugleich Antrag auf Genehmigung der Haushaltsauflösung.'],
    ['2020-12-14', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Genehmigung Haushaltsauflösung erteilt', 'Beschluss vom 14.12.2020: Haushaltsauflösung genehmigt. Auflage, persönliche Erinnerungsstücke zu sichern.'],
    ['2021-01-25', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Genehmigung des Kaufvertrages', 'Beschluss vom 25.01.2021: Verkauf zum Preis von 149.000 € genehmigt. Rechtskraft am 12.02.2021, Rechtskraftzeugnis dem Notariat übersandt.'],
    ['2021-02-27', 'Wohnen, Energie & Kommunikation', 'Umzugsunternehmen', 'Wohnen, Aufenthalt & Unterbringung', 'Wohnungsauflösung / Entrümpelung', 'persönlich (Hausbesuch)', 'Haushaltsauflösung durchgeführt', 'Auflösung durch Firma Klarhaus, Koblenz. Vorab gesichert: Fotoalben, Hochzeitsbild, Nähkästchen, Kaffeeservice, drei Bilder – in das Zimmer 214 verbracht. Erlös aus dem Verkauf des Hausrats 480 €.'],
    ['2021-03-31', 'Sonstige Akteure', 'Rechtsanwält:in / Notar:in', 'Finanzen, Vermögen & Schulden', 'Vermögensübersicht erstellen / aktualisieren', 'persönlich (Gericht / Behörde)', 'Eigentumsübergang vollzogen', 'Kaufpreis 149.000 € auf dem Girokonto eingegangen (abzüglich Notar- und Grundbuchkosten 2.184 €). Eigentumsumschreibung vollzogen. Wohngeld- und Versicherungsverträge zum 31.03.2021 gekündigt.'],
    ['2021-04-08', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'Schriftlich (Brief)', 'Anlage des Erlöses beantragt', 'Antrag auf Genehmigung der Anlage eines Teilbetrages von 8.500 € als gesperrtes Sparguthaben zugunsten der Bestattungsvorsorge. Restbetrag wird für den Eigenanteil eingesetzt.'],
    ['2021-04-19', 'Sozialleistungsträger & öffentliche Stellen', 'Sozialamt (inkl. Grundsicherung, Hilfe zum Lebensunterhalt)', 'Anträge, Verfahren & Rechtliches', 'Anschreiben', 'Schriftlich (Brief)', 'Vermögenseinsatz angezeigt', 'Verkaufserlös angezeigt. Hilfe zur Pflege ruht ab 01.05.2021, solange das Vermögen oberhalb des Schonbetrages liegt. Darlehen aus 2019/2020 wurde verrechnet.'],
    ['2021-11-30', 'Wohnen, Energie & Kommunikation', 'Einrichtungsträger (Heim, betreutes Wohnen, besondere Wohnform)', 'Finanzen, Vermögen & Schulden', 'Überweisung / Rechnung bezahlen', 'Schriftlich (E-Mail)', 'Heimkostenrückstand getilgt', 'Restbetrag des Eigenanteilsrückstandes vollständig ausgeglichen. Ratenvereinbarung damit erledigt.'],
    ['2022-01-17', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhausaufnahme organisieren', 'telefonisch', 'Notfalleinweisung wegen Delir', 'Der Wohnbereich meldet zunehmende Verwirrtheit, Fieber und Trinkverweigerung. Einweisung in das Marienhaus Klinikum Neuwied. Einwilligung in die Aufnahme und die Basisdiagnostik erteilt.'],
    ['2022-01-18', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Einwilligung in medizinische Maßnahmen / Aufklärungsgespräch', 'telefonisch', 'Fixierung abgelehnt', 'Die Klinik regte Bettseitenteile und eine Fixierung an. Nach Rücksprache mit Dr. Kohlmeyer und den Kindern abgelehnt. Stattdessen Sitzwache über den Besuchsdienst und Niederflurbett organisiert. Kein Antrag nach § 1831 BGB gestellt.'],
    ['2022-01-29', 'Gesundheit, Pflege & Rehabilitation', 'Sozialdienst Klinik/Einrichtung', 'Gesundheit, Pflege & Rehabilitation', 'Entlassungsmanagement / Überleitung', 'telefonisch', 'Rückverlegung in den Wohnbereich', 'Entlassung zurück in das Seniorenzentrum. Empfehlung: Trinkprotokoll, Delirprophylaxe, Sensormatte nachts.'],
    ['2022-03-15', 'Finanzen, Vermögen & Schulden', 'Finanzamt', 'Finanzen, Vermögen & Schulden', 'Steuererklärung / Steuerbescheid bearbeiten', 'Schriftlich (Brief)', 'Steuernachzahlung ausgeglichen', 'Nachzahlung 1.767 € aus der Auflösung des Wertpapierdepots vollständig gezahlt. Steuerbüro Wendel erstellt künftig die Erklärungen.'],
    ['2022-09-14', 'Sozialleistungsträger & öffentliche Stellen', 'Sozialamt (inkl. Grundsicherung, Hilfe zum Lebensunterhalt)', 'Anträge, Verfahren & Rechtliches', 'Weiterbewilligungsantrag', 'Schriftlich (Brief)', 'Hilfe zur Pflege wieder beantragt', 'Vermögen unter den Schonbetrag gesunken. Weiterbewilligung ab 01.10.2022 beantragt, Nachweise über die Verwendung des Verkaufserlöses beigefügt.'],
    ['2022-11-08', 'Sozialleistungsträger & öffentliche Stellen', 'Sozialamt (inkl. Grundsicherung, Hilfe zum Lebensunterhalt)', 'Anträge, Verfahren & Rechtliches', 'Antragsstellung', 'Schriftlich (Brief)', 'Bewilligung ab 01.10.2022', 'Hilfe zur Pflege in Höhe von zunächst 1.104,80 € monatlich bewilligt. Gesperrtes Sparguthaben wurde als zweckgebundene Bestattungsvorsorge anerkannt und nicht angerechnet.'],
    ['2023-02-14', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Nachlassgericht', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Sterbefallmeldung / Nachlassinformation', 'Schriftlich (Brief)', 'Nachlass der Schwester angezeigt', 'Mitteilung des Nachlassgerichts Bad Kreuznach über den Tod der Schwester Elfriede Hoffmann. Nachlassverzeichnis angefordert: Aktiva 3.100 €, Passiva 21.400 €.'],
    ['2023-03-09', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Nachlassgericht', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'persönlich (Gericht / Behörde)', 'Erbausschlagung erklärt', 'Nach Genehmigung des Betreuungsgerichts vom 02.03.2023 Ausschlagung zur Niederschrift des Nachlassgerichts erklärt. Frau Auerbach wurde über den Vorgang informiert, konnte ihn nicht einordnen.'],
    ['2023-04-26', 'Gesundheit, Pflege & Rehabilitation', 'Medizinischer Dienst', 'Gesundheit, Pflege & Rehabilitation', 'Pflegegrad-Antrag / Höherstufung', 'persönlich (Einrichtung / Klinik)', 'Begutachtung zur Höherstufung', 'Höherstufungsantrag von Pflegegrad 3 auf 4 gestellt. Begutachtung im Beisein der Bezugspflegekraft. Gutachten empfiehlt Pflegegrad 4.'],
    ['2023-05-22', 'Gesundheit, Pflege & Rehabilitation', 'Krankenkasse / Pflegekasse', 'Gesundheit, Pflege & Rehabilitation', 'Pflegegrad-Antrag / Höherstufung', 'Schriftlich (Brief)', 'Pflegegrad 4 bewilligt', 'Bewilligung rückwirkend zum 01.05.2023. Sozialamt über die Änderung informiert, Eigenanteil neu berechnet.'],
    ['2023-11-08', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Einwilligung in medizinische Maßnahmen / Aufklärungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Kataraktoperation rechts', 'Ambulante Operation im Augenzentrum Koblenz. Aufklärung am 30.10.2023, Einwilligung durch die Betreuung. Begleitung durch die Tochter. Verlauf komplikationslos.'],
    ['2024-02-18', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'persönlich (Einrichtung / Klinik)', 'Gerontopsychiatrische Verlaufskontrolle', 'MMST 12/30 (2022: 17/30). Dr. Kohlmeyer empfiehlt Beibehaltung von Donepezil und bedarfsweise Melperon zur Nacht. Hinweis auf zunehmend eingeschränkte Einwilligungsfähigkeit.'],
    ['2024-05-14', 'Gesundheit, Pflege & Rehabilitation', 'Sanitätshaus', 'Alltagsorganisation & praktische Unterstützung', 'Organisation von Hilfsmitteln (Rollator, Pflegebett, Hilfsmittelrezept)', 'persönlich (Einrichtung / Klinik)', 'Hörgeräte neu angepasst', 'Beide Geräte durch das Hörzentrum Boppard neu angepasst. Kostenübernahme AOK, Eigenanteil 220 € aus dem Girokonto. Verständigung danach deutlich verbessert.'],
    ['2024-09-27', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Betreuungsspezifischer Vorgang', 'Jahresbericht / Entwicklungsbericht', 'Schriftlich (E-Mail)', 'Jahresbericht 2023/2024', 'Bericht und Rechnungslegung für 01.10.2023 bis 30.09.2024 eingereicht. Keine Beanstandungen des Rechtspflegers.'],
    ['2025-03-06', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztgespräch / Befundbesprechung', 'persönlich (Einrichtung / Klinik)', 'Stellungnahme zur Einwilligungsfähigkeit', 'Dr. Kohlmeyer bescheinigt schriftlich, dass eine Einwilligungsfähigkeit für invasive Maßnahmen nicht mehr gegeben ist. Die natürliche Willensäußerung ist weiterhin zu beachten.'],
    ['2025-03-15', 'Betroffene Person / unmittelbares Umfeld', 'Familie / Angehörige', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Dokumentation von Vollmachten / Patientenverfügung / Vorsorgevollmacht', 'persönlich (Betreuungsbüro)', 'Patientenverfügung mit den Kindern besprochen', 'Inhalt der Patientenverfügung vom 12.03.2014 mit Tochter und Sohn durchgegangen, insbesondere Ziff. 3 (keine künstliche Ernährung über PEG). Beide tragen die Festlegung mit. Kopie an den Wohnbereich und den Heimarzt.'],
    ['2025-05-20', 'Gesundheit, Pflege & Rehabilitation', 'Sanitätshaus', 'Alltagsorganisation & praktische Unterstützung', 'Organisation von Hilfsmitteln (Rollator, Pflegebett, Hilfsmittelrezept)', 'persönlich (Einrichtung / Klinik)', 'Pflegebett und Wechseldruckmatratze', 'Lieferung und Einweisung durch Rheinvital. Eigenanteil 486,90 €, Ratenvereinbarung über 80 € monatlich ab Juli 2025.'],
    ['2025-09-17', 'Gesundheit, Pflege & Rehabilitation', 'Fachärzt:innen', 'Gesundheit, Pflege & Rehabilitation', 'Arztbegleitung', 'persönlich (Einrichtung / Klinik)', 'Aufsuchende Zahnbehandlung', 'Druckstelle im Unterkiefer durch Frau Seibold behoben, Prothese unterfüttert. Frau Auerbach kooperierte gut.'],
    ['2025-11-22', 'Betroffene Person / unmittelbares Umfeld', 'Kinder', 'Finanzen, Vermögen & Schulden', 'Haushaltsplan / Budgetbesprechung', 'telefonisch', 'Gelegenheitsschenkung Enkelin', 'Die Tochter bittet um ein Geldgeschenk von 150 € zum Studienabschluss der Enkelin. Als angemessene Gelegenheitsschenkung im Sinne des § 1854 Nr. 8 BGB eingeordnet und ausgeführt; in der Rechnungslegung gesondert ausgewiesen.'],
    ['2026-02-10', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhausaufnahme organisieren', 'telefonisch', 'Sturz mit Schenkelhalsfraktur links', 'Sturz im Zimmer beim nächtlichen Toilettengang. Einweisung in den Kemperhof Koblenz. Röntgen: mediale Schenkelhalsfraktur links.'],
    ['2026-02-11', 'Gesundheit, Pflege & Rehabilitation', 'Krankenhaus, Klinik, Psychiatrie', 'Gesundheit, Pflege & Rehabilitation', 'Einwilligung in medizinische Maßnahmen / Aufklärungsgespräch', 'persönlich (Einrichtung / Klinik)', 'Aufklärung und Einwilligung Hüft-TEP', 'Aufklärungsgespräch mit Prof. Franzen. Kein begründetes Risiko im Sinne des § 1829 Abs. 2 BGB, gerichtliche Genehmigung entbehrlich. Patientenverfügung geprüft: Operation ist von ihr gedeckt. Einwilligung erteilt. Frau Auerbach nickte auf die Frage, ob die Schmerzen weggehen sollten.'],
    ['2026-02-27', 'Gesundheit, Pflege & Rehabilitation', 'Reha-Einrichtungen', 'Gesundheit, Pflege & Rehabilitation', 'Reha-Maßnahme begleiten', 'Schriftlich (E-Mail)', 'Verlegung in die Median Reha-Klinik', 'Geriatrische Rehabilitation in Bad Salzig, Verlegung direkt aus der Klinik. Kostenzusage der AOK liegt vor. Heimplatz wird für die Dauer freigehalten (Abwesenheitsentgelt).'],
    ['2026-03-24', 'Gesundheit, Pflege & Rehabilitation', 'Reha-Einrichtungen', 'Gesundheit, Pflege & Rehabilitation', 'Entlassungsmanagement / Überleitung', 'persönlich (Einrichtung / Klinik)', 'Rückkehr in den Wohnbereich', 'Entlassung zurück nach St. Elisabeth. Gehstrecke mit Rollator etwa 15 Meter. Physiotherapie zweimal wöchentlich verordnet. Ziel „Erhalt der Mobilität" angelegt.'],
    ['2026-05-20', 'Gesundheit, Pflege & Rehabilitation', 'Stationäre Pflegeeinrichtung / Wohnheim', 'Kontrolle, Prüfung & Nachverfolgung', 'Pflegevisite / Pflegegespräch', 'persönlich (Einrichtung / Klinik)', 'Zwischenstand Mobilität', 'Gehstrecke 25 Meter mit Aufsicht. Rückkehr in das eigene Zimmer 214 ab 01.06.2026 geplant.'],
    ['2026-06-05', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Vorsorgeregister / Vorsorgedokumente', 'Vorsorge, Nachlass & Sterbeangelegenheiten', 'Dokumentation von Vollmachten / Patientenverfügung / Vorsorgevollmacht', 'Schriftlich (Brief)', 'Preisanpassung Bestattungsvorsorge', 'Bestattungshaus Kremer teilt eine Anpassung des Vorsorgevertrages um 1.200 € mit. Prüfung ergibt, dass die Rücklage andernfalls nicht mehr auskömmlich ist.'],
    ['2026-06-22', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Anträge, Verfahren & Rechtliches', 'Genehmigungsantrag', 'eBO', 'Teilfreigabe Sparguthaben beantragt', 'Antrag auf Genehmigung der Entnahme von 1.200 € aus dem gesperrten Sparguthaben. Vorsorgevertrag und Preisanpassungsschreiben beigefügt.'],
    ['2026-07-14', 'Betroffene Person / unmittelbares Umfeld', 'Betreute Person', 'Kommunikation & Kontakt', 'Gespräch geführt', 'persönlich (Einrichtung / Klinik)', 'Persönlicher Kontakt und Einschätzung', 'Frau Auerbach saß mit Hörgeräten im Aufenthaltsraum und erkannte die Betreuungsperson wieder. Sie berichtete vom Café-Nachmittag. Auf die Frage nach ihren Wünschen wieder: nach Hause. Kontakt- und Zusammenarbeitsprofil aktualisiert.'],
    ['2026-08-04', 'Gerichte, Betreuungsbehörden & Justiz', 'Betreuungsgericht (Amtsgericht)', 'Kontrolle, Prüfung & Nachverfolgung', 'Berichterstattung', 'Aktenvermerk / intern', 'Vorbereitung der Überprüfung', 'Überprüfung nach sieben Jahren zum 11.09.2026 vorbereitet. Vorschlag: Aufgabenkreis Wohnungsangelegenheiten aufheben, übrige Kreise fortführen. Einwilligungsvorbehalt für die Vermögenssorge weiterhin erforderlich.'],
    ['2026-08-11', 'Gesundheit, Pflege & Rehabilitation', 'Stationäre Pflegeeinrichtung / Wohnheim', 'Beratung, Abstimmung & Hilfeplanung', 'Pflegevisite / Pflegegespräch', 'persönlich (Einrichtung / Klinik)', 'Pflegeplanung und Barbetrag', 'Halbjährliche Pflegeplanung mit der Bezugspflege. Ziel Mobilität erreicht. Barbetrag August übergeben, Handkasse abgerechnet und quittiert. Nächstes Hilfeplangespräch am 20.10.2026.']
  ]),

  termine: [
    { titel: 'Persönlicher Besuch Frau Auerbach (Wohnbereich 2)', start: '2026-09-15T10:00:00', ende: '2026-09-15T11:00:00', ort: 'Seniorenzentrum Sankt Elisabeth, Mainzer Straße 118, 56154 Boppard', beschreibung: 'Regelbesuch. Themen: Jahresbericht, Wohlbefinden nach der Operation, Barbetrag September.' },
    { titel: 'Hilfeplangespräch / Pflegevisite', start: '2026-10-20T14:00:00', ende: '2026-10-20T15:30:00', ort: 'Seniorenzentrum Sankt Elisabeth, Wohnbereich 2', beschreibung: 'Halbjährliche Pflegeplanung. Teilnahme der Tochter angefragt.' },
    { titel: 'Anhörung Betreuungsgericht – Überprüfung der Betreuung', start: '2026-09-03T09:30:00', ende: '2026-09-03T10:15:00', ort: 'Amtsgericht St. Goarshausen, Bahnhofstraße 8', beschreibung: 'Überprüfung nach § 294 Abs. 3 FamFG. Vorschlag zur Aufhebung des Aufgabenkreises Wohnungsangelegenheiten mitbringen.' },
    { titel: 'Abgabe Jahresbericht und Rechnungslegung 2025/2026', start: '2026-10-30T09:00:00', ende: '2026-10-30T09:30:00', ort: 'Testbüroname, Marktplatz 8', ganztags: 0, beschreibung: 'Fristablauf 31.10.2026. Kontoauszüge aller drei Konten und Belege über 50 € beifügen.' },
    { titel: 'Termin Bestattungshaus Kremer – Vorsorgevertrag anpassen', start: '2026-09-24T15:00:00', ende: '2026-09-24T16:00:00', ort: 'Bestattungshaus Kremer, Rheinallee 61, 56154 Boppard', beschreibung: 'Nur nach Vorliegen der gerichtlichen Genehmigung zur Teilfreigabe.' },
    { titel: 'Kontrolltermin Prof. Franzen (Hüft-TEP)', start: '2026-11-05T11:15:00', ende: '2026-11-05T12:00:00', ort: 'Gemeinschaftsklinikum Mittelrhein, Kemperhof Koblenz', beschreibung: 'Fahrdienst über die Einrichtung bestellen, Begleitung durch die Tochter zugesagt.' }
  ],

  aufgaben: [
    { titel: 'Jahresbericht 2025/2026 schreiben', beschreibung: 'Abschnitte A bis C. Persönlichen Eindruck vom Besuch am 15.09.2026 einarbeiten.', faellig: '2026-10-24', prio: 'hoch' },
    { titel: 'Rechnungslegung: Belege über 50 € zusammenstellen', beschreibung: 'Sanitätshaus, Modehaus Krämer, Hörzentrum, Bestattungsvorsorge. Verwahrgeldkonto der Einrichtung anfordern.', faellig: '2026-10-20', prio: 'hoch' },
    { titel: 'Weiterbewilligung Hilfe zur Pflege ab 01.01.2027 vorbereiten', beschreibung: 'Rentenanpassungsmitteilungen 07/2026, Kontoauszüge der letzten drei Monate, Nachweis der zweckgebundenen Bestattungsrücklage.', faellig: '2026-11-10', prio: 'hoch' },
    { titel: 'Sachstand Teilfreigabe Sparguthaben beim Gericht erfragen', beschreibung: 'Antrag vom 22.06.2026, bislang keine Entscheidung. Stellungnahme bis 05.09.2026 erbeten.', faellig: '2026-09-01', prio: 'normal' },
    { titel: 'Vergütungsantrag 3. Quartal 2026 stellen', beschreibung: 'Vermögende Betreute, Vergütung aus dem Vermögen, Stundenansatz nach Wohnform stationär.', faellig: '2026-10-12', prio: 'normal' },
    { titel: 'Zuzahlungsbefreiung 2027 beantragen', beschreibung: 'Antrag bei der AOK mit Nachweis der Bruttoeinnahmen; Belastungsgrenze 2 % bzw. 1 % bei chronischer Erkrankung prüfen.', faellig: '2026-11-28', prio: 'normal' },
    { titel: 'Barbetrag September an die Einrichtung übergeben', beschreibung: '135 € gegen Quittung, Handkasse fortschreiben.', faellig: '2026-09-04', prio: 'normal' },
    { titel: 'Hörgeräte-Nachjustierung terminieren', beschreibung: 'Halbjährliche Kontrolle beim Hörzentrum Boppard, Fahrdienst der Einrichtung nutzen.', faellig: '2026-11-27', prio: 'niedrig' }
  ],

  fahrten: [
    { datum: '2026-02-11', anlass: 'Aufklärungsgespräch und Einwilligung Hüft-TEP', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Kemperhof, Koblenzer Straße 115, 56073 Koblenz', km: 78.4 },
    { datum: '2026-03-24', anlass: 'Rückkehr aus der Reha begleiten, Übergabegespräch', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Mainzer Straße 118, 56154 Boppard', km: 44.2 },
    { datum: '2026-07-14', anlass: 'Persönlicher Besuch und Kontakt-Einschätzung', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Mainzer Straße 118, 56154 Boppard', km: 44.2 },
    { datum: '2026-08-11', anlass: 'Pflegevisite, Barbetragsübergabe', start: 'Marktplatz 8, 56346 St. Goarshausen', ziel: 'Mainzer Straße 118, 56154 Boppard', km: 44.2 }
  ],

  rechnungen: [
    { datum: '2026-01-12', nummer: 'RE-2026-0031', empfaenger: 'Margarete Auerbach, vertreten durch die Betreuung', zweck: 'Betreuervergütung 4. Quartal 2025 (VBVG, vermögend, stationär)', zeitraum: '01.10.2025 - 31.12.2025', summe: 268.5, eingang: '2026-01-28', eingangsbetrag: 268.5 },
    { datum: '2026-04-14', nummer: 'RE-2026-0118', empfaenger: 'Margarete Auerbach, vertreten durch die Betreuung', zweck: 'Betreuervergütung 1. Quartal 2026 (VBVG, vermögend, stationär)', zeitraum: '01.01.2026 - 31.03.2026', summe: 268.5, eingang: '2026-04-29', eingangsbetrag: 268.5 },
    { datum: '2026-07-10', nummer: 'RE-2026-0204', empfaenger: 'Margarete Auerbach, vertreten durch die Betreuung', zweck: 'Betreuervergütung 2. Quartal 2026 (VBVG, vermögend, stationär)', zeitraum: '01.04.2026 - 30.06.2026', summe: 268.5, eingang: '2026-07-24', eingangsbetrag: 268.5 }
  ],

  exporte: [
    L.ausgang(F, 1, {
      datum: '2019-10-08', zeit: '1042', reportId: 'letter_bank_registration',
      dokumentTitel: 'Bankanmeldung', exportMode: 'letterhead',
      empfaenger: 'Sparkasse Koblenz, Bahnhofstraße 11, 56068 Koblenz',
      empfaengerZeilen: ['Sparkasse Koblenz', 'Abteilung Kontoführung', 'Bahnhofstraße 11', '56068 Koblenz'],
      betreff: 'Betreuung Margarete Auerbach – Anzeige der Betreuerbestellung – Az. 7 XVII 214/19',
      body: 'Sehr geehrte Damen und Herren,\n\nanliegend übersende ich die Anzeige der Betreuerbestellung nebst beglaubigter Ausfertigung des Beschlusses.\n\nMit freundlichen Grüßen\nChristoph Zepp',
      status: 'sent', channel: 'post', notiz: 'Persönlich in der Filiale vorgelegt, Eingangsstempel auf der Zweitschrift.',
      dokuGruppe: 'Finanzen, Vermögen & Schulden', dokuAkteur: 'Bank / Sparkasse',
      dokuArt: 'Finanzen, Vermögen & Schulden', dokuDetail: 'Kontoeröffnung / Kontoschließung',
      inhalt: {
        bezug: 'Betreuung Margarete Auerbach, geb. 14.03.1941 – Az. 7 XVII 214/19',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'mit Beschluss des Amtsgerichts St. Goarshausen vom 05.09.2019 – Az. 7 XVII 214/19 – bin ich zum rechtlichen Betreuer von Frau Margarete Auerbach, geboren am 14.03.1941, bestellt worden. Der Aufgabenkreis umfasst unter anderem die Vermögenssorge; für diesen Bereich ist zugleich ein Einwilligungsvorbehalt angeordnet.\n\nIch bitte Sie daher, die Konten der betreuten Person – Girokonto DE68 5705 0120 0019 4471 03 und Sparkonto DE21 5705 0120 0044 7118 90 – auf meine Verfügungsberechtigung umzustellen und sämtliche Kontoauszüge, Mitteilungen und Bescheide ausschließlich an meine Büroanschrift zu senden.\n\nEtwaige Vollmachten Dritter bitte ich zu löschen; die 2014 erteilte Vorsorgevollmacht ist mit dem Betreuungsbeschluss widerrufen worden. Ein bestehender Online-Banking-Zugang ist zu deaktivieren.\n\nEine beglaubigte Ausfertigung der Bestellungsurkunde füge ich bei und lege sie gern zusätzlich im Original in der Filiale vor.',
        anlagen: ['Beglaubigte Ausfertigung des Beschlusses vom 05.09.2019']
      }
    }),
    L.ausgang(F, 2, {
      datum: '2019-11-12', zeit: '1508', reportId: 'broadcast_exemption_application',
      dokumentTitel: 'Befreiungsantrag', exportMode: 'letterhead',
      empfaenger: 'ARD ZDF Deutschlandradio Beitragsservice, 50656 Köln',
      empfaengerZeilen: ['ARD ZDF Deutschlandradio Beitragsservice', '50656 Köln'],
      betreff: 'Betreuung Margarete Auerbach – Antrag auf Ermäßigung des Rundfunkbeitrags – Beitragsnummer 431 998 227',
      status: 'sent', channel: 'post',
      dokuGruppe: 'Wohnen, Energie & Kommunikation', dokuAkteur: 'Energie-/ Telefon-/ Internet-Dienstleister',
      dokuDetail: 'Antragsstellung',
      inhalt: {
        bezug: 'Beitragsnummer 431 998 227 – Margarete Auerbach, geb. 14.03.1941',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'für Frau Margarete Auerbach beantrage ich die Ermäßigung des Rundfunkbeitrags auf ein Drittel nach § 4 Abs. 2 Satz 1 Nr. 3 RBStV.\n\nFrau Auerbach ist schwerbehindert mit einem Grad der Behinderung von 100 und dem Merkzeichen RF (Az. SB 2019/114 402, gültig bis 31.10.2029). Sie lebt seit dem 16.08.2019 vollstationär im Seniorenzentrum Sankt Elisabeth in Boppard.\n\nIch bitte um Berücksichtigung ab dem 01.12.2019 und um Zusendung sämtlicher Bescheide ausschließlich an meine Büroanschrift.',
        anlagen: ['Kopie des Schwerbehindertenausweises', 'Meldebescheinigung der Einrichtung', 'Beglaubigte Ausfertigung der Bestellungsurkunde']
      }
    }),
    L.ausgang(F, 3, {
      datum: '2019-12-16', zeit: '1134', reportId: 'initial', art: 'bericht',
      dokumentTitel: 'Anfangsbericht', exportMode: 'original',
      empfaenger: 'Amtsgericht St. Goarshausen, Bahnhofstraße 8, 56346 St. Goarshausen',
      betreff: 'Betreuung Margarete Auerbach – Anfangsbericht – Az. 7 XVII 214/19',
      status: 'sent', channel: 'post', notiz: 'Mit Vermögensverzeichnis vom 06.11.2019 verbunden eingereicht.',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Betreuungsspezifischer Vorgang', dokuDetail: 'Berichterstattung',
      inhalt: {
        kopf: ['Amtsgericht St. Goarshausen · Az. 7 XVII 214/19', 'Betreute Person: Margarete Auerbach, geb. Hoffmann, geb. 14.03.1941', 'Betreuungsbeginn: 12.09.2019 · Berichtsstichtag: 16.12.2019'],
        ortDatum: 'St. Goarshausen, 16.12.2019',
        abschnitte: [
          { titel: '1. Persönliche Situation', felder: [
            ['Meldeanschrift', 'Rheinallee 27, 56154 Boppard'],
            ['Derzeitiger Aufenthaltsort', 'Seniorenzentrum Sankt Elisabeth, Mainzer Straße 118, 56154 Boppard, Wohnbereich 2, Zimmer 214'],
            ['Art des Aufenthalts', 'Heim/Einrichtung'],
            ['Pflegegrad', '3 (Höherstufung auf 4 zum 01.05.2023 erfolgte später)'],
            ['Behandelnde Ärztinnen und Ärzte', 'Dr. med. Tobias Reinhard (Heimarzt), Dr. med. Annegret Kohlmeyer (Gerontopsychiatrie), Prof. Dr. med. Ulrich Franzen (Orthopädie)']
          ] },
          { titel: '2. Ziele der Betreuung und Maßnahmen', felder: [
            ['Ziele der Betreuung', 'Sicherung der Finanzierung des Heimplatzes und damit des Lebensmittelpunktes. Erhalt der Selbstständigkeit im Wohnbereich. Sicherstellung der medizinischen Versorgung. Wahrung der Festlegungen der Patientenverfügung. Erhalt der familiären Kontakte.'],
            ['Ergriffene und geplante Maßnahmen', 'Antrag auf Hilfe zur Pflege vom 14.10.2019. Umstellung der Konten und Kündigung nicht mehr benötigter Verträge. Ausgleich des Eigenanteilsrückstandes über eine Ratenvereinbarung. Geplant: Prüfung und Vorbereitung der Veräußerung der Eigentumswohnung mit gerichtlicher Genehmigung, Antrag auf Schwerbehindertenausweis und Rundfunkbeitragsbefreiung.'],
            ['Handeln gegen den Willen der betreuten Person', 'Der Wunsch nach Rückkehr in die eigene Wohnung kann nicht erfüllt werden. Er wird jedes Mal ernst genommen, dokumentiert und ruhig beantwortet. Freiheitsentziehende Maßnahmen wurden nicht ergriffen.']
          ] },
          { titel: '3. Wünsche der betreuten Person', felder: [
            ['Kann die betreute Person persönliche Wünsche äußern?', 'bedingt'],
            ['Wünsche und Erwartungen hinsichtlich der Betreuung', 'Rückkehr in die eigene Wohnung; regelmäßige Besuche der Kinder; Friseurtermin; eigene Zeitschriften; „nicht zur Last fallen".'],
            ['Erster persönlicher Kontakt', '18.09.2019'],
            ['Zahl der Kontakte seitdem', '4'],
            ['Geplante zeitliche Abstände weiterer Kontakte', 'alle sechs bis acht Wochen, zusätzlich anlassbezogen']
          ] }
        ]
      }
    }),
    L.ausgang(F, 4, {
      datum: '2020-11-16', zeit: '0917', reportId: 'court_approval',
      dokumentTitel: 'Betreuungsgerichtliche Genehmigung', exportMode: 'letterhead',
      empfaenger: 'Amtsgericht St. Goarshausen, Bahnhofstraße 8, 56346 St. Goarshausen',
      empfaengerZeilen: ['Amtsgericht St. Goarshausen', '- Betreuungsgericht -', 'Bahnhofstraße 8', '56346 St. Goarshausen'],
      betreff: 'Betreuung Margarete Auerbach – Antrag auf Genehmigung des Wohnungsverkaufs – Az. 7 XVII 214/19',
      status: 'sent', channel: 'post',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuDetail: 'Genehmigungsantrag',
      inhalt: {
        bezug: 'Betreuungssache Margarete Auerbach – Az. 7 XVII 214/19',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'namens der betreuten Person beantrage ich die betreuungsgerichtliche Genehmigung des beabsichtigten Verkaufs der Eigentumswohnung Rheinallee 27, 56154 Boppard (Grundbuch von Boppard, Blatt 4471, 58 m²) zum Kaufpreis von 149.000,00 € sowie die Genehmigung der anschließenden Auflösung des Hausrats.\n\nDie Wohnung steht seit der Heimaufnahme am 16.08.2019 leer und verursacht monatliche Kosten von rund 340,00 €, die neben dem Heimentgelt von derzeit 2.914,80 € zu tragen sind. Eine Rückkehr in die eigene Häuslichkeit ist nach übereinstimmender Einschätzung der Reha-Klinik Bad Salzig und des Hausarztes nicht tragfähig. Ohne Verwertung ist die Finanzierung des Heimplatzes mittelfristig nicht gesichert; die Hilfe zur Pflege wird derzeit nur darlehensweise nach § 91 SGB XII gewährt.\n\nDer Verkehrswert wurde mit Gutachten vom 02.10.2020 auf 142.000,00 € festgesetzt; der ausgehandelte Kaufpreis liegt darüber.\n\nFrau Auerbach lehnte den Verkauf im Gespräch am 08.10.2020 zunächst ab. In einem zweiten Gespräch am 12.11.2020 im Beisein ihrer Tochter erklärte sie nach ruhiger Erläuterung der doppelten Kostenlast: „Wenn es sein muss, dann macht das." Ihr Widerstreben besteht fort und wird hiermit ausdrücklich mitgeteilt. Persönliche Erinnerungsstücke werden vor der Auflösung gesichert und in ihr Zimmer verbracht.',
        anlagen: ['Verkehrswertgutachten vom 02.10.2020', 'Entwurf des notariellen Kaufvertrages', 'Exposé', 'Vermerk über die Gespräche vom 08.10. und 12.11.2020']
      }
    }),
    L.ausgang(F, 5, {
      datum: '2024-09-27', zeit: '1622', reportId: 'annual_assets', art: 'bericht',
      dokumentTitel: 'Jahresbericht mit Vermögenssorge', exportMode: 'combined',
      empfaenger: 'Amtsgericht St. Goarshausen, Bahnhofstraße 8, 56346 St. Goarshausen',
      betreff: 'Betreuung Margarete Auerbach – Jahresbericht 01.10.2023 – 30.09.2024 – Az. 7 XVII 214/19',
      mail: 'poststelle.ag-goh@ko.mjv.rlp.de',
      status: 'sent', channel: 'mail', notiz: 'Rechtspflegerin hat den Eingang am 30.09.2024 bestätigt, keine Beanstandungen.',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Betreuungsspezifischer Vorgang', dokuDetail: 'Jahresbericht / Entwicklungsbericht',
      inhalt: {
        kopf: ['Amtsgericht St. Goarshausen · Az. 7 XVII 214/19', 'Betreute Person: Margarete Auerbach, geb. Hoffmann, geb. 14.03.1941', 'Berichtszeitraum: 01.10.2023 bis 30.09.2024'],
        ortDatum: 'St. Goarshausen, 27.09.2024',
        abschnitte: [
          { titel: 'A. Persönliche Verhältnisse', felder: [
            ['Ständiger Aufenthalt', 'Seniorenzentrum Sankt Elisabeth, Mainzer Straße 118, 56154 Boppard, Wohnbereich 2, Zimmer 214'],
            ['Heimunterbringung', 'ja'],
            ['Geschlossene Abteilung', 'nein'],
            ['Persönlicher Eindruck', 'Frau Auerbach war im Berichtszeitraum körperlich stabil und äußerlich gepflegt. Der kognitive Abbau ist fortgeschritten; der MMST lag im Februar 2024 bei 12 von 30 Punkten gegenüber 17 von 30 im Jahr 2022. Sie nimmt weiterhin am Café-Nachmittag teil und singt bei Musikangeboten mit. Die im Mai 2024 neu angepassten Hörgeräte haben die Verständigung deutlich verbessert.'],
            ['Entwicklung des Zustands', 'verschlechtert'],
            ['Bewertung der weiteren Betreuung', 'weiter erforderlich']
          ] },
          { titel: 'B. Wirtschaftliche Verhältnisse', felder: [
            ['Heimkosten pro Monat', '3.104,20 €'],
            ['Kostenträger der Unterkunft', 'Eigene Einkünfte, ergänzend Hilfe zur Pflege der Kreisverwaltung Rhein-Hunsrück-Kreis'],
            ['Im Berichtszeitraum erworbene oder geerbte Sachen und Rechte', 'Keine.'],
            ['Genehmigungs- oder anzeigepflichtige Tätigkeiten', 'Keine.']
          ] },
          { titel: 'C. Tätigkeit des Betreuers', felder: [
            ['Sonstige berichtenswerte Entwicklungen', 'Die Hörgeräteversorgung wurde im Mai 2024 erneuert; der Eigenanteil von 220,00 € wurde aus dem Girokonto beglichen. Die zweckgebundene Bestattungsrücklage von 8.500,00 € bleibt unangetastet.'],
            ['Wurde der Bericht mit der betreuten Person besprochen?', 'ja, am 20.09.2024']
          ] }
        ]
      }
    }),
    L.ausgang(F, 6, {
      datum: '2026-06-22', zeit: '1405', reportId: 'court_approval',
      dokumentTitel: 'Betreuungsgerichtliche Genehmigung', exportMode: 'letterhead',
      empfaenger: 'Amtsgericht St. Goarshausen, Bahnhofstraße 8, 56346 St. Goarshausen',
      empfaengerZeilen: ['Amtsgericht St. Goarshausen', '- Betreuungsgericht -', 'Bahnhofstraße 8', '56346 St. Goarshausen'],
      betreff: 'Betreuung Margarete Auerbach – Antrag auf Teilfreigabe aus gesperrtem Sparguthaben – Az. 7 XVII 214/19',
      status: 'sent', channel: 'ebo', notiz: 'Über das eBO eingereicht; Eingangsbestätigung liegt vor. Entscheidung steht aus.',
      dokuGruppe: 'Gerichte, Betreuungsbehörden & Justiz', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuDetail: 'Genehmigungsantrag',
      inhalt: {
        bezug: 'Betreuungssache Margarete Auerbach – Az. 7 XVII 214/19',
        anrede: 'Sehr geehrte Damen und Herren,',
        text: 'namens der betreuten Person beantrage ich die Genehmigung der Entnahme eines Teilbetrages von 1.200,00 € aus dem gesperrten Sparkonto DE21 5705 0120 0044 7118 90 bei der Sparkasse Koblenz.\n\nFrau Auerbach hat bereits 2018 – vor Einrichtung der Betreuung – einen Bestattungsvorsorgevertrag geschlossen und wiederholt geäußert, dass für ihre Beerdigung etwas beiseitegelegt sein soll. Zur Absicherung dieses Wunsches wurde der Verkaufserlös der Eigentumswohnung in Höhe von 8.500,00 € mit Genehmigung vom 11.05.2021 als gesperrtes Sparguthaben angelegt.\n\nMit Schreiben vom 28.05.2026 hat das Bestattungshaus Kremer eine Anpassung des Vertragspreises um 1.200,00 € mitgeteilt. Ohne die Nachzahlung wäre die vereinbarte Leistung nicht mehr vollständig gedeckt; der Differenzbetrag müsste im Sterbefall aus dem Nachlass oder von den Kindern getragen werden.\n\nDie Entnahme ist zweckentsprechend und lässt die Rücklage mit dann 7.362,40 € weiterhin oberhalb des vereinbarten Bestattungspreises. Die Sozialhilfeleistung wird nicht berührt, weil die Rücklage als zweckgebundene Bestattungsvorsorge anerkannt ist.',
        anlagen: ['Vorsorgevertrag vom 09.03.2018', 'Preisanpassungsschreiben vom 28.05.2026', 'Kontoauszug zum 31.05.2026', 'Bestätigung der Sparkasse über den Sperrvermerk']
      }
    }),
    L.ausgang(F, 7, {
      datum: '2026-07-10', zeit: '0948', reportId: 'remuneration_pdf', art: 'bericht',
      dokumentTitel: 'Betreuervergütungen', exportMode: 'original',
      empfaenger: 'Amtsgericht St. Goarshausen, Bahnhofstraße 8, 56346 St. Goarshausen',
      betreff: 'Betreuung Margarete Auerbach – Vergütungsantrag 2. Quartal 2026 – Az. 7 XVII 214/19',
      status: 'sent', channel: 'ebo',
      dokuGruppe: 'Büroorganisation / interne Bearbeitung', dokuAkteur: 'Betreuungsgericht (Amtsgericht)',
      dokuArt: 'Büroorganisation / interne Bearbeitung', dokuDetail: 'Berichterstattung',
      inhalt: {
        kopf: ['Amtsgericht St. Goarshausen · Az. 7 XVII 214/19', 'Betreute Person: Margarete Auerbach, geb. 14.03.1941'],
        ortDatum: 'St. Goarshausen, 10.07.2026',
        abschnitte: [
          { titel: 'Abrechnungsabschnitt', felder: [
            ['Zeitraum', '01.04.2026 bis 30.06.2026'],
            ['Vergütungsstufe', '2 (ab dem 25. Monat der Betreuung)'],
            ['Wohnform', 'stationäre Einrichtung / gleichgestellte Wohnform'],
            ['Vermögensstatus', 'vermögend – Vergütung wird aus dem Vermögen entnommen'],
            ['Monatliche Pauschale', '89,50 €'],
            ['Gesamtbetrag', '268,50 €']
          ] },
          { titel: 'Ergänzende Angaben', felder: [
            ['Grundlage', '§ 9 VBVG, Vergütungstabelle B'],
            ['Anlagen', 'Kontoauszug des Verwaltungskontos zum 30.06.2026, Bescheinigung des Seniorenzentrums Sankt Elisabeth über die Wohnform vom 02.07.2026'],
            ['Hinweis', 'Die Vergütung für das Vorquartal ist am 29.04.2026 dem Verwaltungskonto entnommen worden.']
          ] }
        ]
      }
    })
  ],

  archive: [
    L.archiv(F, 1, {
      reportId: 'initial', titel: 'Anfangsbericht', archiviertAm: '2019-12-16', zeit: '11:34',
      erstelltAm: '2019-10-20', von: '12.09.2019', bis: '16.12.2019',
      name: '191216 1134 Amtsgericht St. Goarshausen Anfangsbericht',
      notiz: 'Beim Betreuungsgericht eingereichte Fassung des Anfangsberichts. Grundlage für die Fortschreibung in den Jahresberichten.',
      felder: {
        registered_address: 'Rheinallee 27, 56154 Boppard',
        current_residence: 'Seniorenzentrum Sankt Elisabeth, Mainzer Straße 118, 56154 Boppard, Wohnbereich 2, Zimmer 214',
        care_level: '3',
        resources: 'Frau Auerbach ist freundlich zugewandt und kontaktfreudig. Sie nimmt gern am Café-Nachmittag und an Gottesdiensten teil, findet sich im Wohnbereich räumlich zurecht und bewältigt die Körperpflege mit Anleitung weitgehend selbstständig.',
        goals: 'Sicherung der Finanzierung des Heimplatzes. Erhalt der Selbstständigkeit im Wohnbereich. Sicherstellung der medizinischen Versorgung. Wahrung der Patientenverfügung. Erhalt der familiären Kontakte.',
        measures: 'Antrag auf Hilfe zur Pflege vom 14.10.2019. Umstellung der Konten. Ratenvereinbarung über den Eigenanteilsrückstand. Geplant: Veräußerung der Eigentumswohnung mit gerichtlicher Genehmigung, Schwerbehindertenausweis, Rundfunkbeitragsbefreiung.',
        first_contact: '2019-09-18',
        contact_count: 4,
        future_contacts: 'alle sechs bis acht Wochen, zusätzlich anlassbezogen'
      }
    }),
    L.archiv(F, 2, {
      reportId: 'annual_assets', titel: 'Jahresbericht mit Vermögenssorge', archiviertAm: '2024-09-27', zeit: '16:22',
      erstelltAm: '2024-08-30', von: '01.10.2023', bis: '30.09.2024',
      name: '240927 1622 Amtsgericht St. Goarshausen Jahresbericht mit Vermögenssorge',
      notiz: 'Eingereichter Jahresbericht 2023/2024. Keine Beanstandungen des Rechtspflegers.',
      felder: {
        residence: 'Seniorenzentrum Sankt Elisabeth, Mainzer Straße 118, 56154 Boppard, Wohnbereich 2, Zimmer 214',
        home_placement: 'ja',
        closed_unit: 'nein',
        personal_impression: 'Frau Auerbach war im Berichtszeitraum körperlich stabil und äußerlich gepflegt. Der kognitive Abbau ist fortgeschritten; der MMST lag im Februar 2024 bei 12 von 30 Punkten gegenüber 17 von 30 im Jahr 2022. Sie nimmt weiterhin am Café-Nachmittag teil und singt bei Musikangeboten mit. Die im Mai 2024 neu angepassten Hörgeräte haben die Verständigung deutlich verbessert.',
        condition_change: 'verschlechtert',
        care_need: 'weiter erforderlich',
        housing_costs: '3104,20',
        other_report: 'Die Hörgeräteversorgung wurde im Mai 2024 erneuert; der Eigenanteil von 220,00 € wurde aus dem Girokonto beglichen. Die zweckgebundene Bestattungsrücklage von 8.500,00 € bleibt unangetastet.',
        discussed: 'ja',
        discussed_date: '2024-09-20'
      }
    }),
    L.archiv(F, 3, {
      reportId: 'annual_assets', titel: 'Jahresbericht mit Vermögenssorge', archiviertAm: '2025-10-24', zeit: '10:05',
      erstelltAm: '2025-09-15', von: '01.10.2024', bis: '30.09.2025',
      name: '251024 1005 Amtsgericht St. Goarshausen Jahresbericht mit Vermögenssorge',
      notiz: 'Eingereichter Jahresbericht 2024/2025 – Vorbericht für den laufenden Berichtszeitraum.',
      felder: {
        residence: 'Seniorenzentrum Sankt Elisabeth, Mainzer Straße 118, 56154 Boppard, Wohnbereich 2, Zimmer 214',
        home_placement: 'ja',
        closed_unit: 'nein',
        personal_impression: 'Der Zustand war im Berichtszeitraum unverändert. Frau Auerbach bewegte sich sicher mit dem Rollator, nahm an den Mahlzeiten im Speisesaal teil und wirkte bei allen Besuchen ausgeglichen. Im Mai 2025 wurde ein Pflegebett mit Wechseldruckmatratze angeschafft; im September 2025 erfolgte eine aufsuchende Zahnbehandlung.',
        condition_change: 'nicht verändert',
        care_need: 'weiter erforderlich',
        housing_costs: '3198,40',
        other_report: 'Für das Pflegebett und die Wechseldruckmatratze fällt ein Eigenanteil von 486,90 € an, der ab Juli 2025 in Raten von 80,00 € monatlich getilgt wird. Im November 2025 wurde der Enkelin zum Studienabschluss ein Geldgeschenk von 150,00 € als angemessene Gelegenheitsschenkung zugewandt.',
        discussed: 'ja',
        discussed_date: '2025-10-14'
      }
    })
  ],

  berichte: {
    initial: L.bericht({
      registered_address: 'Rheinallee 27, 56154 Boppard',
      current_residence: 'Seniorenzentrum Sankt Elisabeth, Mainzer Straße 118, 56154 Boppard, Wohnbereich 2, Zimmer 214',
      residence_type: ['Heim/Einrichtung'],
      planned_housing_changes: 'Ein Wechsel der Wohnform ist nicht geplant. Die eigene Eigentumswohnung in der Rheinallee 27 steht seit der Heimaufnahme im August 2019 leer und verursacht monatliche Kosten von rund 340 €. Eine Rückkehr in die eigene Häuslichkeit ist nach übereinstimmender Einschätzung der Reha-Klinik und des Hausarztes nicht tragfähig. Die Veräußerung der Wohnung wird geprüft und wäre gerichtlich zu genehmigen.',
      housing_notes: 'Das Zimmer 214 liegt im Wohnbereich 2 im ersten Obergeschoss und ist über einen Aufzug erreichbar. Frau Auerbach hat eigene Möbelstücke, Bilder und Fotos mitgebracht. Sie findet den Weg zum Speisesaal und zum Aufenthaltsraum selbstständig.',
      treating_doctors: 'Dr. med. Tobias Reinhard, Allgemeinmedizin (Heimarzt), Rheinallee 12, 56154 Boppard, 06742/449021\nDr. med. Annegret Kohlmeyer, Gerontopsychiatrie, Oberstraße 44, 56154 Boppard, 06742/301188\nProf. Dr. med. Ulrich Franzen, Orthopädie und Unfallchirurgie, Kemperhof Koblenz, 0261/4960',
      severe_diseases: 'Demenz bei Alzheimer-Krankheit mit spätem Beginn (F00.1), erstdiagnostiziert im November 2018. Arterielle Hypertonie, Diabetes mellitus Typ 2 ohne Insulinpflicht, postmenopausale Osteoporose mit stattgehabter pertrochantärer Femurfraktur rechts im Juni 2019, Presbyakusis beidseits mit Hörgeräteversorgung.',
      treatment_care: 'Vollstationäre Versorgung im Seniorenzentrum Sankt Elisabeth seit dem 16.08.2019. Medikamentöse Behandlung mit Donepezil, Ramipril, Metformin, Alendronsäure und Colecalciferol; die Verblisterung erfolgt über die Severus-Apotheke. Hausärztliche Quartalsvisiten durch Dr. Reinhard, fachärztliche Verlaufskontrollen bei Dr. Kohlmeyer. Nach der Fraktur regelmäßige Physiotherapie.',
      resources: 'Frau Auerbach ist freundlich zugewandt und kontaktfreudig. Sie nimmt gern am Café-Nachmittag und an Gottesdiensten teil, singt Lieder ihrer Jugend fehlerfrei mit und findet sich im Wohnbereich räumlich zurecht. Die Körperpflege gelingt mit Anleitung weitgehend selbstständig; das Essen nimmt sie ohne Hilfe zu sich. Auf ein gepflegtes Äußeres legt sie großen Wert. Der Kontakt zu Tochter, Sohn und Enkelin ist stabil und wird von ihr sichtbar genossen.',
      impairments: 'Erhebliche Störung des Kurzzeitgedächtnisses und der zeitlichen wie örtlichen Orientierung. Frau Auerbach kann Geldwerte nicht mehr einschätzen, Schriftstücke nicht mehr erfassen und Termine nicht erinnern. Telefonate führt sie seit 2023 nicht mehr selbstständig. Aufgrund der Schwerhörigkeit bricht die Verständigung ohne eingesetzte Hörgeräte fast vollständig zusammen. Nach der Fraktur besteht ein erhöhtes Sturzrisiko; die Gehstrecke ist auf wenige Meter mit Rollator begrenzt.',
      care_level: '4',
      care_allowance: 'nicht einschlägig',
      health_notes: 'Zuzahlungsbefreiung nach § 62 SGB V besteht. Eine Patientenverfügung vom 12.03.2014 liegt vor und ist in der Pflegedokumentation hinterlegt; sie schließt eine künstliche Ernährung über eine PEG-Sonde bei fortgeschrittener Demenz aus.',
      relatives: 'Karin Auerbach-Petri (Tochter), Hohenzollernstraße 41, 56068 Koblenz, 0261/9034128\nDr. Stefan Auerbach (Sohn), Sülzburgstraße 112, 50937 Köln, 0221/5540912\nLea Petri (Enkelin), Hohenzollernstraße 41, 56068 Koblenz',
      family_situation: 'Frau Auerbach ist seit dem 19.11.2016 verwitwet. Aus der Ehe stammen zwei Kinder. Die Tochter wohnt in Koblenz und besucht ihre Mutter etwa alle zwei Wochen, der Sohn kommt aus Köln alle sechs bis acht Wochen. Beide Kinder sind erreichbar, tragen Entscheidungen mit und haben ausdrücklich erklärt, die rechtliche Betreuung nicht selbst führen zu wollen. Konflikte innerhalb der Familie bestehen nicht.',
      social_contacts: 'Wichtigste Bezugsperson im Alltag ist die Bezugspflegekraft Frau Ayşe Özdemir im Wohnbereich 2. Der Besuchsdienst der Pfarrgemeinde St. Severus kommt alle zwei Wochen. Zur früheren Nachbarin Frau Weinand besteht seit dem Umzug kein Kontakt mehr.',
      relationship: 'Das Verhältnis ist von Beginn an vertrauensvoll. Frau Auerbach erkennt die Betreuungsperson bei den Besuchen wieder und begrüßt sie freundlich, kann den rechtlichen Zusammenhang jedoch nicht mehr benennen. Die Besuche finden alle sechs bis acht Wochen im Wohnbereich statt, zusätzlich anlassbezogen. Gespräche werden kurz gehalten und auf ein Thema begrenzt.',
      social_notes: 'Frau Auerbach reagiert auf Musik und alte Fotografien besonders gut. Gespräche über die Wohnung in der Rheinallee lösen regelmäßig den Wunsch nach Rückkehr aus; dieser wird ernst genommen, ruhig beantwortet und nicht diskutiert.',
      employment_status: 'Rente',
      employer_occupation: 'Bis 2006 Verwaltungsangestellte bei der Stadtverwaltung Boppard; seither Regelaltersrente',
      daily_life: 'Der Tag ist durch den Rhythmus des Wohnbereichs strukturiert: Frühstück im Speisesaal, vormittags Betreuungsangebote wie Gedächtnistraining oder Sitzgymnastik, nach dem Mittagessen eine Ruhephase, nachmittags Café-Nachmittag oder Besuch. Frau Auerbach ist vormittags deutlich aufnahmefähiger. Am späten Nachmittag treten gelegentlich Unruhe und Suchverhalten auf.',
      goals: 'Sicherung der Finanzierung des Heimplatzes und damit des Lebensmittelpunktes. Erhalt der Selbstständigkeit im Wohnbereich, insbesondere der Mobilität und der Teilnahme an den Mahlzeiten in Gemeinschaft. Sicherstellung der medizinischen Versorgung einschließlich der Hörgeräteversorgung. Wahrung der in der Patientenverfügung niedergelegten Festlegungen. Erhalt der familiären Kontakte.',
      measures: 'Antrag auf Hilfe zur Pflege nach dem 7. Kapitel SGB XII vom 14.10.2019. Umstellung der Konten und Kündigung nicht mehr benötigter Verträge. Ausgleich des Eigenanteilsrückstandes über eine Ratenvereinbarung mit der Einrichtung. Ausgleich der Energie- und Wohngeldrückstände. Geplant: Prüfung und Vorbereitung der Veräußerung der Eigentumswohnung mit gerichtlicher Genehmigung, Beantragung des Schwerbehindertenausweises und der Rundfunkbeitragsbefreiung.',
      against_will: 'Der Wunsch nach Rückkehr in die eigene Wohnung kann nicht erfüllt werden. Frau Auerbach äußert ihn regelmäßig. Er wird jedes Mal ernst genommen, dokumentiert und ruhig beantwortet. Eine Rückkehr scheitert an der fehlenden Tragfähigkeit der häuslichen Versorgung; freiheitsentziehende Maßnahmen wurden nicht ergriffen und werden auch nicht angestrebt.',
      special_matters: 'Zu regeln sind die Verwertung der Eigentumswohnung einschließlich der Haushaltsauflösung, die Sicherung der zweckgebundenen Bestattungsvorsorge und die Klärung des Umgangs mit dem Wertpapierdepot.',
      goal_notes: 'Die Aufgabenkreise Wohnungsangelegenheiten und Vermögenssorge stehen im ersten Jahr im Vordergrund.',
      can_express_wishes: 'bedingt',
      wishes_care: 'Frau Auerbach wünscht sich, in ihre Wohnung zurückzukehren. Darüber hinaus äußert sie den Wunsch nach regelmäßigen Besuchen ihrer Kinder, nach dem Friseurtermin, nach ihren Zeitschriften und danach, „nicht zur Last zu fallen".',
      wishes_assets: 'Konkrete Vorstellungen zur Vermögensverwaltung äußert Frau Auerbach nicht mehr. Sie hat wiederholt gesagt, dass „für die Beerdigung etwas beiseitegelegt" sein soll; dieser Wunsch wird durch die zweckgebundene Rücklage und den Vorsorgevertrag umgesetzt.',
      desired_outcome: 'Aus ihrer Sicht soll sie in vertrauter Umgebung leben, gepflegt und ordentlich gekleidet sein und regelmäßig Besuch bekommen.',
      prevent_outcome: 'Sie möchte niemandem zur Last fallen und nicht in ein Krankenhaus verlegt werden. Wiederholt hat sie geäußert, „keine Maschinen" zu wollen; dies deckt sich mit der Patientenverfügung.',
      unfulfillable_wishes: 'Die Rückkehr in die eigene Wohnung ist nicht erfüllbar, weil eine häusliche Versorgung mit Pflegegrad 4 und fortgeschrittener Demenz nicht sicherzustellen ist und die Wohnung veräußert werden muss, um den Heimplatz zu finanzieren.',
      self_managed_assets: 'Frau Auerbach verwaltet keinen Teil ihres Vermögens mehr selbst. Sie erhält einen monatlichen Barbetrag, der über die Einrichtung verwahrt und quittiert wird.',
      first_contact: '2019-09-18',
      contact_count: 4,
      future_contacts: 'alle sechs bis acht Wochen, zusätzlich anlassbezogen',
      can_initiate_contact: 'nein',
      contact_limit_reason: 'Fortgeschrittene Demenz; Telefonnummern und Anlässe können nicht erinnert werden. Kontaktaufnahme über die Pflegedienstleitung.',
      contact_notes: 'Termine werden mit dem Wohnbereich abgestimmt und vormittags gelegt.'
    }, '2019-12-16'),

    annual_assets: L.bericht({
      residence: 'Seniorenzentrum Sankt Elisabeth, Mainzer Straße 118, 56154 Boppard, Wohnbereich 2, Zimmer 214',
      home_placement: 'ja',
      closed_unit: 'nein',
      care_providers: ['Personal des Heims / der Einrichtung', 'Angehörige', 'Betreuer/in'],
      personal_impression: 'Frau Auerbach war bei den Besuchen im Berichtszeitraum durchgehend freundlich zugewandt und äußerlich sehr gepflegt. Der kognitive Abbau ist gegenüber dem Vorjahr fortgeschritten; der MMST lag im Februar 2024 bei 12 von 30 Punkten. Die Schenkelhalsfraktur im Februar 2026 stellte den deutlichsten Einschnitt dar. Nach der geriatrischen Rehabilitation hat Frau Auerbach ihre Gehfähigkeit mit dem Rollator wiedererlangt und nimmt seit Juni 2026 erneut an den Mahlzeiten im Speisesaal und am Café-Nachmittag teil. Beim Besuch am 14.07.2026 saß sie im Aufenthaltsraum, erkannte die Betreuungsperson wieder und berichtete unaufgefordert vom Kuchen.',
      condition_change: 'nicht verändert',
      care_need: 'weiter erforderlich',
      care_need_reason: 'Frau Auerbach kann ihre finanziellen, gesundheitlichen und behördlichen Angelegenheiten aufgrund der fortgeschrittenen Demenz nicht mehr selbst besorgen. Sie erfasst Schriftstücke nicht mehr, kann Geldwerte nicht einschätzen und Termine nicht erinnern. Eine Vorsorgevollmacht besteht nicht mehr; die frühere Vollmacht wurde mit dem Beschluss vom 05.09.2019 widerrufen. Im Berichtszeitraum waren die Einwilligung in eine Hüftoperation, die Weiterbewilligung der Hilfe zur Pflege und ein Genehmigungsantrag zur Bestattungsvorsorge zu bearbeiten. Der Einwilligungsvorbehalt für die Vermögenssorge bleibt erforderlich, weil Frau Auerbach im Wohnbereich wiederholt Geld verschenken wollte. Der Aufgabenkreis Wohnungsangelegenheiten kann nach dem vollzogenen Verkauf entfallen.',
      last_contact: '2026-08-11',
      contact_frequency: 'nach Bedarf',
      contact_description: 'Im Berichtszeitraum fanden sieben persönliche Kontakte im Wohnbereich statt, davon zwei anlässlich des Krankenhaus- und Reha-Aufenthalts, sowie zahlreiche Telefonate mit der Bezugspflege, der Verwaltung und den Kindern. Die Gespräche werden kurz gehalten, vormittags geführt und auf ein Thema beschränkt. Angelegenheiten von Gewicht – Operation, Verkauf, Bestattungsvorsorge – wurden jeweils in einfacher Sprache erläutert und, soweit möglich, mit ihr abgestimmt; ergänzend wurden die Kinder einbezogen.',
      assets_detail: [],
      custody_cash_control: ['regelmäßige Einsicht in Verwendungsnachweise', 'Vorlage von Kopien', 'bestimmungsgemäße Verwendung bestätigt'],
      income_detail: [],
      housing_costs: '3284,60',
      housing_cost_carrier: 'Eigene Einkünfte, ergänzend Hilfe zur Pflege der Kreisverwaltung Rhein-Hunsrück-Kreis (Az. SA-RLP/BOP-2019-4471)',
      acquisitions: 'Im Berichtszeitraum wurden keine Sachen oder Rechte erworben oder geerbt. Angeschafft wurden Bekleidung und ein Reinigungsset für die Hörgeräte aus dem Barbetrag.',
      legal_activities: 'Einwilligung in die Implantation einer Hüft-Totalendoprothese am 11.02.2026 nach § 1829 BGB; eine gerichtliche Genehmigung war nicht erforderlich, weil kein begründetes Risiko im Sinne des Absatzes 2 bestand. Antrag auf Genehmigung einer Teilentnahme von 1.200 € aus dem gesperrten Sparguthaben vom 22.06.2026, Entscheidung steht aus. Eine Gelegenheitsschenkung von 150 € an die Enkelin wurde nach § 1854 Nr. 8 BGB als angemessen eingeordnet.',
      other_report: 'Der Verkauf der Eigentumswohnung ist seit 2021 abgeschlossen; der Erlös ist bis auf die zweckgebundene Bestattungsrücklage verbraucht. Die Hilfe zur Pflege läuft zum 31.12.2026 aus, der Weiterbewilligungsantrag ist vorbereitet. Der Vorsorgevertrag mit dem Bestattungshaus Kremer wurde um 1.200 € angepasst; die Rücklage ist andernfalls nicht mehr auskömmlich. Zum 11.09.2026 steht die gerichtliche Überprüfung nach sieben Jahren an.',
      discussed: 'ja',
      discussed_date: '2026-08-11',
      discussed_reason: '',
      view_contacts: 'Frau Auerbach freut sich sichtbar über Besuche und sagt regelmäßig, es sei „schön, dass mal jemand kommt". Die Häufigkeit der Kontakte bewertet sie nicht; auf Nachfrage wünscht sie sich häufigeren Besuch ihrer Enkelin.',
      view_goals: 'Die Betreuungsziele kann Frau Auerbach nicht mehr benennen. Auf die Frage, ob es ihr im Haus gut gehe, antwortete sie bejahend und ergänzte, sie wolle aber „irgendwann wieder heim".',
      view_need: 'Die Frage nach der Erforderlichkeit der Betreuung kann Frau Auerbach nicht beantworten. Sie äußert keine Ablehnung; auf die Erklärung, dass die Betreuungsperson sich um „das Geld und die Ämter" kümmert, reagierte sie zustimmend.'
    }, '2026-08-11'),

    asset_inventory: L.bericht({
      avi_court: 'Amtsgericht St. Goarshausen',
      avi_file_number: '7 XVII 214/19',
      avi_person: 'Margarete Auerbach, geb. Hoffmann',
      avi_birth: '1941-03-14',
      avi_date: '2019-09-12',
      avi_monthly_expenses: '3010,80',
      avi_notes: 'Vermögensverzeichnis zum Stichtag des Betreuungsbeginns. Die Eigentumswohnung Rheinallee 27, 56154 Boppard (Grundbuch Boppard Blatt 4471, 58 m²) ist mit einem vorläufigen Wert von 142.000 € angesetzt; ein Verkehrswertgutachten lag zum Stichtag noch nicht vor und wurde am 02.10.2020 nachgereicht. Das Deka-Fondsdepot ist mit dem Kurswert vom 12.09.2019 bewertet. Der Hausrat wurde vor Ort geschätzt. Verbindlichkeiten: Wohngeldrückstand der Eigentümergemeinschaft 612,40 €, Eigenanteilsrückstand der Einrichtung 4.380,00 €, Stromrückstand 998,90 €.'
    }, '2019-11-06'),

    remuneration: L.bericht({
      rem_stage: '2',
      rem_request_type: 'Folgeantrag',
      rem_continuous: 'nein'
    }, '2026-07-10'),

    remuneration_pdf: L.bericht({
      remuneration_pdf_name: 'Margarete Auerbach',
      remuneration_pdf_birth: '1941-03-14',
      remuneration_pdf_address: 'Rheinallee 27, 56154 Boppard',
      remuneration_pdf_reference: '7 XVII 214/19',
      remuneration_pdf_details: 'Vergütungsabschnitt 01.04.2026 bis 30.06.2026. Vergütung nach § 9 VBVG, Vergütungstabelle B (stationäre Einrichtung), Vergütungsstufe 2, ab dem 25. Monat der Betreuung. Monatliche Pauschale 89,50 €, Abrechnungszeitraum drei Monate, Gesamtbetrag 268,50 €. Die betreute Person ist seit dem Verkauf der Eigentumswohnung im Jahr 2021 nicht mehr mittellos; die Vergütung wird deshalb aus dem Vermögen entnommen.',
      remuneration_pdf_attachments: 'Kontoauszug des Verwaltungskontos zum 30.06.2026, Nachweis über die Wohnform (Bescheinigung des Seniorenzentrums Sankt Elisabeth vom 02.07.2026).',
      remuneration_pdf_notes: 'Die Vergütung für das Vorquartal ist am 29.04.2026 dem Verwaltungskonto entnommen worden.'
    }, '2026-07-10'),

    court_approval: L.bericht({
      ca_art: 'Genehmigung der Entnahme aus einem gesperrten Sparguthaben',
      ca_rechtsgrundlage: 'Vermögensangelegenheit (§§ 1848 ff. BGB)',
      ca_vorgang: 'Entnahme eines Teilbetrages von 1.200,00 € aus dem gesperrten Sparkonto DE21 5705 0120 0044 7118 90 bei der Sparkasse Koblenz zur Nachzahlung auf den Bestattungsvorsorgevertrag mit dem Bestattungshaus Kremer, Boppard (Vertrag BV-2018-0091).',
      ca_wille: 'Einwilligung',
      ca_begruendung: 'Frau Auerbach hat bereits im Jahr 2018 – vor Einrichtung der Betreuung – einen Bestattungsvorsorgevertrag geschlossen und wiederholt geäußert, dass für ihre Beerdigung etwas beiseitegelegt sein soll. Zur Absicherung dieses Wunsches wurde der Verkaufserlös der Eigentumswohnung in Höhe von 8.500 € mit Genehmigung des Gerichts vom 11.05.2021 als gesperrtes Sparguthaben angelegt. Mit Schreiben vom 28.05.2026 hat das Bestattungshaus Kremer eine Anpassung des Vertragspreises um 1.200 € mitgeteilt. Ohne die Nachzahlung wäre die vereinbarte Leistung nicht mehr vollständig gedeckt; der Differenzbetrag müsste im Sterbefall aus dem Nachlass oder von den Kindern getragen werden. Die Entnahme ist zweckentsprechend, dient unmittelbar dem geäußerten Willen der betreuten Person und lässt die Rücklage mit dann 7.362,40 € weiterhin oberhalb des vereinbarten Bestattungspreises. Die Sozialhilfeleistung wird durch die Entnahme nicht berührt, weil die Rücklage als zweckgebundene Bestattungsvorsorge anerkannt ist.',
      ca_ergaenzung: 'Beigefügt: Vorsorgevertrag vom 09.03.2018, Preisanpassungsschreiben vom 28.05.2026, Kontoauszug des Sparkontos zum 31.05.2026, Bestätigung der Sparkasse über den Sperrvermerk.'
    }, '2026-06-22'),

    self_management: L.bericht({
      sm_period_from: '2025-10-01',
      sm_period_to: '2026-09-30',
      sm_scope: [],
      sm_bank: 'Sparkasse Koblenz, Filiale Boppard',
      sm_iban: 'DE68 5705 0120 0019 4471 03',
      sm_bic: '',
      sm_transactions: 'Keine. Frau Auerbach verwaltet keinen Teil ihres Vermögens selbst und veranlasst weder Überweisungen noch Barabhebungen. Sie erhält einen monatlichen Barbetrag von 135 €, der an die Einrichtung übergeben und dort über das Verwahrgeldkonto abgerechnet wird.',
      sm_discussed: 'nein',
      sm_assets_care_needed: 'ja',
      sm_no_signature_reason: 'Frau Auerbach kann aufgrund der fortgeschrittenen Demenz vom Alzheimer-Typ (F00.1) den Inhalt der Erklärung nicht erfassen und nicht rechtswirksam unterschreiben. Die fachärztliche Stellungnahme von Dr. med. Annegret Kohlmeyer vom 06.03.2025 bestätigt, dass eine Einsichtsfähigkeit in rechtsgeschäftliche Zusammenhänge nicht mehr besteht.',
      sm_hearing: 'ja',
      sm_hearing_reason: ''
    }, '2026-08-04'),

    advance_directive: L.bericht({
      ad_person_name: 'Margarete Auerbach, geb. Hoffmann',
      ad_person_birth: '1941-03-14',
      ad_person_address: 'Rheinallee 27, 56154 Boppard',
      ad_motivation: 'Frau Auerbach hat die Verfügung am 12.03.2014 im Vollbesitz ihrer geistigen Kräfte errichtet. Sie hat darin festgehalten, dass ihr ein Sterben in Würde und ohne Apparatemedizin wichtiger ist als eine Verlängerung des Lebens um jeden Preis. Prägend war die lange Krankheitsgeschichte ihres 2016 verstorbenen Ehemannes.',
      ad_experiences: 'Frau Auerbach hat ihren Ehemann über zwei Jahre gepflegt und dessen intensivmedizinische Behandlung in den letzten Wochen als belastend und würdelos erlebt. Bekannte Erkrankungen zum Zeitpunkt der Errichtung: arterielle Hypertonie, Diabetes mellitus Typ 2, Osteoporose. Die Demenz wurde erst 2018 diagnostiziert.',
      ad_situations: ['weit fortgeschrittener Hirnabbauprozess mit fehlender natürlicher Nahrungsaufnahme', 'Endstadium einer unheilbaren tödlichen Erkrankung', 'unabwendbarer unmittelbarer Sterbeprozess'],
      ad_situation_other: '',
      ad_general_treatment: 'lebenserhaltende Maßnahmen unterlassen/einstellen, palliativ behandeln',
      ad_pain: 'fachgerecht einschließlich bewusstseinsdämpfender Mittel wenn erforderlich',
      ad_nutrition: 'unterlassen/einstellen',
      ad_fluids: 'unterlassen/einstellen',
      ad_ventilation: 'nicht durchführen/einstellen',
      ad_dialysis: 'nicht durchführen/einstellen',
      ad_antibiotics: 'nur zur Beschwerdelinderung',
      ad_blood: 'zulassen',
      ad_circulation: 'nicht gestatten',
      ad_resuscitation: 'unterlassen',
      ad_organs: 'Ablehnung',
      ad_organ_priority: 'Patientenverfügung geht vor',
      ad_stay: ['vertraute Umgebung', 'Pflegeeinrichtung', 'Palliativteam'],
      ad_companions: 'Tochter Karin Auerbach-Petri und Sohn Dr. Stefan Auerbach. Seelsorgliche Begleitung durch die katholische Pfarrgemeinde St. Severus ist ausdrücklich gewünscht.',
      ad_stay_notes: 'Eine Verlegung in ein Krankenhaus soll in der Sterbephase unterbleiben. Frau Auerbach soll im vertrauten Zimmer 214 des Wohnbereichs 2 bleiben; die Einrichtung hat die palliative Begleitung zugesagt und arbeitet mit dem Palliativteam Rhein-Mosel zusammen.',
      ad_hearing_person: 'Karin Auerbach-Petri (Tochter), Hohenzollernstraße 41, 56068 Koblenz, 0261/9034128. Ersatzweise Dr. Stefan Auerbach (Sohn), 0221/5540912.',
      ad_excluded_person: 'Keine.',
      ad_power: 'nein',
      ad_authorized_person: 'Die 2014 erteilte Vorsorgevollmacht wurde mit dem Beschluss des Amtsgerichts St. Goarshausen vom 05.09.2019 widerrufen.',
      ad_care_directive: 'ja',
      ad_desired_carer: 'In der Betreuungsverfügung vom 12.03.2014 hat Frau Auerbach ihre Tochter als Wunschbetreuerin benannt. Die Tochter hat die Übernahme 2019 gegenüber dem Gericht abgelehnt; eine berufliche Betreuung wurde eingerichtet.',
      ad_medical_advice: 'ärztlich beraten und aufgeklärt',
      ad_supported_by: 'Errichtung am 12.03.2014 nach Beratung durch den damaligen Hausarzt Dr. med. Werner Lang und unter Verwendung der Textbausteine des Bundesministeriums der Justiz.',
      ad_storage: 'Original in Register 09 der Fallakte. Kopien: Pflegedokumentation des Wohnbereichs 2, Heimarzt Dr. Reinhard, Tochter Karin Auerbach-Petri. Hinweiskarte im Portemonnaie.',
      ad_witness: ''
    }, '2025-03-20'),

    funeral_directive: L.bericht({
      fd_name: 'Margarete Auerbach, geb. Hoffmann',
      fd_birth: '14.03.1941',
      fd_street: 'Rheinallee 27',
      fd_postal_city: '56154 Boppard',
      fd_cremation: 'nein',
      fd_special_form: 'Erdbestattung im bestehenden Familiengrab auf dem Friedhof Boppard, Abteilung C, Grabstelle 214, an der Seite des 2016 verstorbenen Ehemannes. Kirchliche Trauerfeier in St. Severus mit Orgelmusik. Statt Kränzen wird um Spenden an den Besuchsdienst der Pfarrgemeinde gebeten. Diese Wünsche hat Frau Auerbach im Vorsorgevertrag vom 09.03.2018 selbst festgelegt.',
      fd_primary: 'Karin Auerbach-Petri, geb. 02.08.1968, Hohenzollernstraße 41, 56068 Koblenz, Telefon 0261/9034128',
      fd_substitute: 'Dr. Stefan Auerbach, geb. 17.01.1971, Sülzburgstraße 112, 50937 Köln, Telefon 0221/5540912',
      fd_memorial_recipients: 'Nicht einschlägig, da keine Einäscherung gewünscht ist.',
      fd_remaining_ashes: 'Nicht einschlägig.'
    }, '2026-06-05'),

    letter_bank_registration: L.bericht({
      letter_recipient_institution: 'Sparkasse Koblenz',
      letter_recipient_name: 'Abteilung Kontoführung',
      letter_recipient_street: 'Bahnhofstraße 11',
      letter_recipient_postal_city: '56068 Koblenz',
      letter_recipient_email: '',
      letter_reference: 'Betreuung Margarete Auerbach, geb. 14.03.1941 – Az. 7 XVII 214/19',
      letter_subject: 'Anzeige der Betreuerbestellung und Umstellung der Kontoverfügung',
      letter_salutation: 'Sehr geehrte Damen und Herren,',
      letter_takeover_date: '2019-09-12',
      letter_body: 'mit Beschluss des Amtsgerichts St. Goarshausen vom 05.09.2019 – Az. 7 XVII 214/19 – bin ich zum rechtlichen Betreuer von Frau Margarete Auerbach, geboren am 14.03.1941, bestellt worden. Der Aufgabenkreis umfasst unter anderem die Vermögenssorge; für diesen Bereich ist zugleich ein Einwilligungsvorbehalt angeordnet.\n\nIch bitte Sie daher, die Konten der betreuten Person – Girokonto DE68 5705 0120 0019 4471 03 und Sparkonto DE21 5705 0120 0044 7118 90 – auf meine Verfügungsberechtigung umzustellen und sämtliche Kontoauszüge, Mitteilungen und Bescheide ausschließlich an meine Büroanschrift zu senden.\n\nEtwaige Vollmachten Dritter bitte ich zu löschen; die 2014 erteilte Vorsorgevollmacht ist mit dem Betreuungsbeschluss widerrufen worden. Ein bestehender Online-Banking-Zugang ist zu deaktivieren.\n\nEine beglaubigte Ausfertigung der Bestellungsurkunde füge ich bei und lege sie auf Wunsch gern zusätzlich im Original in der Filiale vor.',
      letter_additions: 'Anlage: Beglaubigte Ausfertigung des Beschlusses vom 05.09.2019'
    }, '2019-10-08'),

    broadcast_exemption_application: L.bericht({
      broadcast_exemption_application_name: 'Margarete Auerbach',
      broadcast_exemption_application_birth: '1941-03-14',
      broadcast_exemption_application_address: 'Seniorenzentrum Sankt Elisabeth, Mainzer Straße 118, 56154 Boppard',
      broadcast_exemption_application_reference: '7 XVII 214/19',
      broadcast_exemption_application_number: '431 998 227',
      broadcast_exemption_application_reason: 'Frau Auerbach ist schwerbehindert mit einem Grad der Behinderung von 100 und dem Merkzeichen RF. Sie lebt seit dem 16.08.2019 vollstationär im Seniorenzentrum Sankt Elisabeth in Boppard. Es wird die Ermäßigung des Rundfunkbeitrags auf ein Drittel nach § 4 Abs. 2 Satz 1 Nr. 3 RBStV beantragt.',
      broadcast_exemption_application_period: 'ab 01.12.2019, zunächst bis zur Gültigkeitsdauer des Schwerbehindertenausweises am 31.10.2029',
      broadcast_exemption_application_evidence: 'Kopie des Schwerbehindertenausweises (Az. SB 2019/114 402, GdB 100, Merkzeichen G, aG, H, B, RF), Meldebescheinigung der Einrichtung, beglaubigte Ausfertigung der Bestellungsurkunde.',
      broadcast_exemption_application_notes: 'Sämtliche Bescheide und Mitteilungen bitte ausschließlich an die Betreuung senden: Testbüroname, Marktplatz 8, 56346 St. Goarshausen.'
    }, '2019-11-12')
  }
};

/* Faehigkeiten & Alltag: Istzustand je Lebensbereich, Alltagsgestaltung und
   Wunschaeusserung. Grundlage sind Hausbesuche in der Einrichtung, die
   Pflegedokumentation und die Angaben der Tochter. */
module.exports.faehigkeiten = L.profil(F, {
  stand: '2026-08-11',
  bereiche: {
    communication: {
      ressourcen: 'Frau Auerbach spricht in kurzen, grammatikalisch vollständigen Sätzen und begrüßt vertraute Personen namentlich. Sie versteht einfache Fragen zuverlässig, wenn man langsam, von vorn und in ruhiger Umgebung spricht. Gefühlslagen teilt sie deutlich mit – Zustimmung durch Handdruck und Lächeln, Ablehnung durch Wegdrehen. Alte Lieder singt sie textsicher mit und nutzt das sichtbar als Gesprächseinstieg.',
      einschraenkungen: 'Wortfindungsstörungen bei Substantiven, sie behilft sich mit Umschreibungen. Komplexe oder mehrteilige Fragen überfordern sie; Inhalte eines Gesprächs sind nach etwa zehn Minuten nicht mehr abrufbar. Die Hörgeräteversorgung ist seit dem Verlust des rechten Geräts im Mai 2026 unvollständig, wodurch sie in Gruppensituationen kaum noch folgen kann und sich zurückzieht.',
      bedarfe: ['gdp-a-08'],
      quelle: 'Hausbesuche 14.07. und 11.08.2026, Pflegedokumentation Haus Rheinblick',
      erhoben: '2026-08-11', wiedervorlage: '2026-11-30'
    },
    orientation: {
      ressourcen: 'Zur eigenen Person ist Frau Auerbach sicher orientiert: Name, Geburtsdatum und Geburtsort nennt sie richtig. Im Wohnbereich findet sie ihr Zimmer und den Speisesaal selbstständig. Bei einfachen Alltagsentscheidungen – Kleidung, Getränk, Teilnahme an der Singgruppe – äußert sie eine klare, über die Zeit stabile Präferenz.',
      einschraenkungen: 'Zeitlich desorientiert: Jahr, Jahreszeit und Wochentag werden nicht zutreffend benannt, der verstorbene Ehemann wird häufig als lebend erlebt. Situativ teilorientiert; die eigene Wohnung in Sankt Goarshausen hält sie weiterhin für bewohnt. Tragweite und Folgen finanzieller oder gesundheitlicher Entscheidungen kann sie nicht erfassen – die freie Willensbestimmung ist insoweit ausgeschlossen (MDK-Gutachten vom 04.03.2025).',
      quelle: 'MDK-Gutachten 04.03.2025, ärztliche Stellungnahme Dr. Sauerbier vom 22.06.2026',
      erhoben: '2026-06-22', wiedervorlage: '2027-06-30'
    },
    mobility: {
      ressourcen: 'Nach der Hüft-TEP im Oktober 2024 geht Frau Auerbach mit dem Rollator wieder etwa 40 Meter am Stück und nimmt an der wöchentlichen Sitzgymnastik teil. Transfers Bett–Rollstuhl gelingen mit Anleitung und einer Hilfsperson. Den Innenhof erreicht sie im Rollstuhl geschoben und hält sich dort gern auf.',
      einschraenkungen: 'Sturzgefahr bei Dunkelheit und nachts; drei dokumentierte Stürze seit 2024, zuletzt am 03.02.2026 ohne Fraktur. Treppen sind nicht mehr möglich. Außerhalb der Einrichtung ist sie vollständig auf Begleitung angewiesen. Die Gehstrecke schwankt tagesformabhängig erheblich.',
      quelle: 'Pflegedokumentation, Sturzprotokolle Haus Rheinblick, Physiotherapiebericht 30.06.2026',
      erhoben: '2026-07-14', wiedervorlage: '2026-08-15'
    },
    health_selfcare: {
      ressourcen: 'Frau Auerbach isst und trinkt selbstständig, wenn ihr das Essen mundgerecht gereicht wird, und äußert Vorlieben deutlich. Beim Waschen des Gesichts und der Hände beteiligt sie sich aktiv. Schmerzen zeigt sie mimisch verlässlich an, sodass die Bedarfsmedikation gut gesteuert werden kann.',
      einschraenkungen: 'Pflegegrad 4. Körperpflege, Ankleiden und Toilettengang nur mit vollständiger Übernahme; nachts Inkontinenzversorgung. Die Medikamentengabe erfolgt gestellt durch die Pflege, eine eigenständige Einnahme ist ausgeschlossen. Gewichtsverlust von 4 kg zwischen Januar und Juni 2026, seither Trinkprotokoll und hochkalorische Zusatznahrung.',
      quelle: 'Pflegedokumentation Haus Rheinblick, Pflegevisite 11.08.2026',
      erhoben: '2026-08-11', wiedervorlage: '2026-12-15'
    },
    housing_household: {
      ressourcen: 'Das Einzelzimmer im zweiten Obergeschoss ist mit eigenen Möbeln, Bildern und dem Sekretär ihres Mannes eingerichtet; Frau Auerbach erkennt es zuverlässig als ihr Zimmer wieder. Kleine Handgriffe wie das Falten von Servietten oder das Gießen der Fensterbank-Pflanze übernimmt sie gern und mit sichtbarer Freude.',
      einschraenkungen: 'Eine eigene Haushaltsführung ist vollständig aufgehoben; Einkauf, Wäsche, Reinigung und Mahlzeiten übernimmt die Einrichtung. Die frühere Eigentumswohnung wurde 2025 mit betreuungsgerichtlicher Genehmigung veräußert – ein Umstand, an den Frau Auerbach sich nicht erinnert und der in Gesprächen behutsam übergangen wird.',
      quelle: 'Hausbesuch 14.07.2026, Heimvertrag vom 01.11.2019',
      erhoben: '2026-07-14', wiedervorlage: '2027-07-31'
    },
    daily_social: {
      ressourcen: 'Feste Bezugspflegekraft Frau Oswald; Frau Auerbach sucht ihre Nähe aktiv. Die Singgruppe am Mittwoch besucht sie regelmäßig und beteiligt sich textsicher. Die Tochter kommt vierzehntägig, die Enkelkinder alle sechs bis acht Wochen – diese Besuche heben die Stimmung über mehrere Tage messbar. Zum katholischen Gottesdienst in der Hauskapelle geht sie gern.',
      einschraenkungen: 'Von sich aus knüpft sie keine neuen Kontakte und bleibt in der Gruppe still, seit die Hörgeräteversorgung unvollständig ist. Am späten Nachmittag treten regelmäßig Unruhe und Hinlauftendenz auf. Der Sohn in Hamburg meldet sich nur telefonisch, was sie mehrfach beklagt hat.',
      quelle: 'Betreuungsdokumentation Sozialer Dienst, Hausbesuche 2026',
      erhoben: '2026-08-11', wiedervorlage: '2026-10-31'
    },
    work_education: {
      ressourcen: 'Frau Auerbach war bis 2006 als Verwaltungsangestellte bei der Kreisverwaltung tätig und erzählt aus dieser Zeit lebhaft und detailreich; Berufsbiografie und Fachvokabular sind erhalten und lassen sich als Gesprächsanker nutzen. Sie liest Überschriften der Tageszeitung laut vor.',
      einschraenkungen: 'Eine berufliche oder ehrenamtliche Tätigkeit besteht seit dem Ruhestand 2006 nicht mehr und ist nicht mehr herstellbar. Sinnentnehmendes Lesen längerer Texte gelingt nicht; ein Bildungsbedarf im Sinne der Teilhabe wird nicht gesehen.',
      quelle: 'Biografiebogen der Einrichtung, Angaben der Tochter vom 14.07.2026',
      erhoben: '2026-07-14', bericht: false
    },
    authorities_law: {
      ressourcen: 'Frau Auerbach unterschreibt mit ihrem vollen Namen und erkennt amtliche Umschläge als „wichtige Post". Bei Besuchen des Betreuers reicht sie ungeöffnete Post zuverlässig weiter und wirkt dadurch aktiv an der Erledigung mit.',
      einschraenkungen: 'Inhalt und Rechtsfolgen von Bescheiden werden nicht erfasst. Fristen und Widerspruchsmöglichkeiten kann sie nicht erkennen. Der Aufgabenkreis umfasst deshalb die Vertretung gegenüber Behörden vollständig; ein Einwilligungsvorbehalt besteht nicht und ist nach derzeitiger Einschätzung auch nicht erforderlich, weil sie im Rechtsverkehr nicht mehr eigenständig auftritt.',
      quelle: 'Betreuerbericht 2026, Beschluss AG St. Goarshausen vom 12.09.2019',
      erhoben: '2026-08-06', wiedervorlage: '2027-03-31'
    },
    finance_assets: {
      ressourcen: 'Das Taschengeld aus der Handkasse verwaltet Frau Auerbach in einer Geldbörse und bezahlt damit am Kiosk der Einrichtung selbstständig Süßigkeiten und Zeitschriften. Über Beträge bis etwa zehn Euro trifft sie eigene Entscheidungen und freut sich sichtbar über diese Selbstbestimmung.',
      einschraenkungen: 'Überblick über Renteneinkünfte, Heimkosten und Vermögen besteht nicht; die Höhe der Heimkosten wird deutlich unterschätzt. Kontoführung, Zahlungsverkehr und die Abwicklung des Wohnungsverkaufs erfolgen vollständig durch den Betreuer. Erhebliche Gefährdung durch Haustürgeschäfte bestand vor Betreuungsbeginn; in der Einrichtung besteht diese Gefahr nicht mehr.',
      bedarfe: ['gdp-a-02'],
      quelle: 'Rechnungslegung 2025, Handkassenbuch, Hausbesuch 11.08.2026',
      erhoben: '2026-08-11', wiedervorlage: '2027-01-31'
    }
  },
  alltag: {
    zusammenfassung: 'Frau Auerbach lebt seit November 2019 vollstationär im Seniorenzentrum Haus Rheinblick. Ihr Alltag ist vollständig durch die Einrichtung strukturiert und verläuft in einem gleichbleibenden, für sie gut verträglichen Rhythmus. Sie wirkt in vertrauter Umgebung überwiegend zufrieden und ausgeglichen; Unruhe tritt vor allem am späten Nachmittag und bei Abweichungen vom gewohnten Ablauf auf.',
    tagesablauf: 'Aufstehen gegen 7:30 Uhr mit Unterstützung, Frühstück im Speisesaal des Wohnbereichs. Vormittags Sitzgymnastik (dienstags), Singgruppe (mittwochs) oder Aufenthalt im Innenhof. Mittagessen 12:00 Uhr, anschließend Mittagsruhe bis etwa 14:30 Uhr. Nachmittags Kaffeerunde, danach häufig Unruhephase mit Wandern auf dem Flur. Abendessen 17:30 Uhr, Zubettgehen zwischen 19:30 und 20:00 Uhr.',
    haushalt: 'Vollständig durch die Einrichtung übernommen: Mahlzeiten, Wäsche, Zimmerreinigung und Einkäufe des täglichen Bedarfs. Persönliche Anschaffungen (Kleidung, Pflegeartikel) organisiert die Tochter in Absprache mit dem Betreuer über die Handkasse.',
    selbstversorgung: 'Körperpflege und Ankleiden werden übernommen, Frau Auerbach beteiligt sich an einzelnen Schritten. Essen und Trinken selbstständig bei mundgerechter Zubereitung; Trinkmenge wird protokolliert. Medikamente werden gestellt und die Einnahme kontrolliert. Nachts Inkontinenzversorgung und zweistündliche Kontrollgänge.',
    beschaeftigung: 'Singgruppe mittwochs, Sitzgymnastik dienstags, Gedächtnistraining in der Kleingruppe donnerstags (Teilnahme schwankend), Gottesdienst in der Hauskapelle sonntags. Zusätzlich Einzelbetreuung nach § 43b SGB XI zweimal wöchentlich für 30 Minuten, meist Vorlesen oder Fotoalben ansehen.',
    teilhabe: 'Besuche der Tochter vierzehntägig, der Enkelkinder alle sechs bis acht Wochen, gelegentliche Telefonate mit dem Sohn. Innerhalb der Einrichtung feste Tischgemeinschaft mit zwei Mitbewohnerinnen. Sommerfest und Adventsfeier besucht sie regelmäßig in Begleitung der Tochter.',
    unterstuetzung: 'Vollstationäre Pflege rund um die Uhr, Bezugspflege Frau Oswald. Zusätzliche Betreuungsleistungen nach § 43b SGB XI. Hausärztliche Versorgung durch Dr. Sauerbier mit vierzehntägiger Visite in der Einrichtung. Physiotherapie einmal wöchentlich. Rechtliche Betreuung mit vierteljährlichem Hausbesuch.',
    quelle: 'Pflegedokumentation, Hausbesuche 14.07. und 11.08.2026, Gespräch mit Bezugspflegekraft',
    erhoben: '2026-08-11', wiedervorlage: '2027-02-28'
  },
  wunsch: {
    status: 'bedingt',
    begruendung: 'Frau Auerbach äußert Wünsche des unmittelbaren Erlebens zuverlässig und nachvollziehbar – Essen, Getränke, Kleidung, Musik, Nähe oder Rückzug. Tragweitige Wünsche kann sie nicht mehr abwägend formulieren: Der wiederholt geäußerte Wunsch nach Rückkehr in die eigene Wohnung bezieht sich erkennbar auf die Wohnung ihrer Kindheit und ist Ausdruck eines Sicherheitsbedürfnisses, nicht einer geprüften Entscheidung. Frühere Willensbekundungen aus der Patientenverfügung von 2016 werden deshalb ergänzend herangezogen.',
    unterstuetzung: 'Kurze, geschlossene Fragen mit höchstens zwei Auswahlmöglichkeiten; Auswahl möglichst gegenständlich zeigen. Ruhige Umgebung ohne Nebengeräusche, Blickkontakt und ausreichend Zeit. Vollständige Hörgeräteversorgung ist Voraussetzung. Vormittags ist die Äußerungsfähigkeit deutlich besser als am späten Nachmittag. Bei bedeutsamen Fragen wird die Tochter als vertraute Person hinzugezogen.',
    wege: ['spoken', 'simple_language', 'gesture', 'third_party'],
    quelle: 'Hausbesuche 2026, Patientenverfügung vom 08.11.2016, Gespräch mit der Tochter',
    erhoben: '2026-08-11', wiedervorlage: '2027-02-28'
  },
  verlauf: [
    ['2025-03-04', 'Profil erstmals angelegt (Grundlage MDK-Gutachten)'],
    ['2025-11-18', 'Bereiche „Mobilität" und „Gesundheit und Selbstversorgung" nach Hüftoperation aktualisiert'],
    ['2026-06-22', 'Bereich „Orientierung und Entscheidungsfindung" nach ärztlicher Stellungnahme aktualisiert'],
    ['2026-07-14', 'Alltagsgestaltung und Wohnen nach Hausbesuch fortgeschrieben'],
    ['2026-08-11', 'Gesamtprofil zum Jahresbericht überprüft und fortgeschrieben']
  ]
});
