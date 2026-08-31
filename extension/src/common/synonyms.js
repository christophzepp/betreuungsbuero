// Deutsches Synonym-Lexikon fuer die heuristische Feldzuordnung (Plan Abschnitt BR, Phase E2).
// Schluessel = kanonische Dictionary-Keys (siehe dictionary.js), Werte = normalisierte Suchbegriffe
// (Vergleich nach bxaNorm(): lowercase, Umlaute aufgeloest, nur [a-z0-9]). Zusaetzlich:
// autocomplete-Attribut-Signale (starke Treffer) und Kontextwoerter zur Gruppen-Disambiguierung
// (Behoerdenformulare fragen betreute Person UND gesetzlichen Vertreter ab!).
// eslint-disable-next-line no-unused-vars
function bxaNorm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// eslint-disable-next-line no-unused-vars
const BXA_SYNONYMS = {
  // ===== Person (betreute Person; identische Begriffe gelten fuer Betreuer-Felder, die Gruppe
  // entscheidet der Kontext) =====
  'person.lastName':   ['nachname', 'name', 'familienname', 'zuname', 'familien name'],
  'person.firstName':  ['vorname', 'vornamen', 'rufname'],
  'person.birthName':  ['geburtsname'],
  'person.birthDate':  ['geburtsdatum', 'geb datum', 'geburtstag', 'geboren am', 'geburts datum'],
  'person.birthPlace': ['geburtsort', 'geboren in'],
  'person.birthCountry': ['geburtsland'],
  'person.gender':     ['geschlecht', 'anrede'],
  'person.salutation': ['anrede'],
  'person.title':      ['titel', 'akademischer grad'],
  'person.maritalStatus': ['familienstand'],
  'person.nationality': ['staatsangehoerigkeit', 'nationalitaet', 'staatsbuergerschaft'],
  'person.religion':   ['religion', 'konfession'],
  'person.street':     ['strasse', 'str', 'anschrift', 'adresse'],
  // Kombi-Felder ("Straße und Hausnummer" in EINEM Feld) -> abgeleiteter Kombi-Wert streetFull,
  // sonst wuerde nur der Strassenname OHNE Hausnummer eingesetzt (Pruefbericht 2026-07-17).
  'person.streetFull': ['strasse hausnummer', 'strasse und hausnummer', 'strasse nr', 'strasse haus nr'],
  'person.fullName':   ['vollstaendiger name', 'vor und nachname', 'vor und zuname'],
  // AUDIT 2026-07-17: Die echten caseData-Schluessel heissen house/houseLetter/postal (nicht
  // houseNumber/postalCode) - mit den alten Schluesseln matchten PLZ + Hausnummer heuristisch NIE.
  'person.house':      ['hausnummer', 'haus nr', 'nr', 'hausnr'],
  'person.houseNumber':['hausnummer', 'haus nr', 'nr', 'hausnr'],
  'person.houseLetter': ['hausbuchstabe', 'zusatz'],
  'person.postal':     ['plz', 'postleitzahl'],
  'person.postalCode': ['plz', 'postleitzahl'],
  'person.city':       ['ort', 'wohnort', 'stadt'],
  'person.country':    ['land', 'staat'],
  'person.postbox':    ['postfach'],
  'person.phone':      ['telefon', 'telefonnummer', 'festnetz', 'tel'],
  'person.mobile':     ['mobil', 'handy', 'mobilnummer', 'mobiltelefon'],
  'person.fax':        ['fax', 'telefax', 'faxnummer', 'fax nr', 'zielrufnummer', 'empfaengernummer'],
  'person.email':      ['e mail', 'email', 'mail', 'e mail adresse'],
  'person.taxId':      ['steuer id', 'steuerliche identifikationsnummer', 'steuer identifikationsnummer', 'idnr', 'steuernummer'],
  'person.pensionInsuranceNumber': ['rentenversicherungsnummer', 'rvnr', 'versicherungsnummer', 'sozialversicherungsnummer', 'rv nummer'],
  'person.idCardNumber': ['ausweisnummer', 'personalausweisnummer', 'ausweis nr'],
  'person.contributionNumber': ['beitragsnummer', 'beitragskonto', 'beitragsservice', 'teilnehmernummer', 'beitragskontonummer'],
  'healthInfo.pflegegrad': ['pflegegrad', 'pflegestufe'],
  'healthInfo.careLevel': ['pflegegrad', 'pflegestufe'],
  'health.careLevel': ['pflegegrad', 'pflegestufe'],

  // ===== Betreuung / Gericht / Behoerde =====
  'care.fileNumber':   ['aktenzeichen', 'az', 'geschaeftszeichen', 'gz', 'geschaeftsnummer'],
  'care.courtName':    ['betreuungsgericht', 'amtsgericht', 'gericht'],
  'care.authorityName': ['betreuungsbehoerde', 'behoerde'],
  'care.authorityFileNumber': ['aktenzeichen behoerde'],
  'care.startDate':    ['betreuung seit', 'bestellt seit', 'beginn der betreuung'],

  // ===== Konto (betreute Person, banks[0]) =====
  'banks.0.iban':      ['iban'],
  'banks.0.bic':       ['bic', 'swift', 'swift bic'],
  'banks.0.bankName':  ['bank', 'kreditinstitut', 'geldinstitut', 'name der bank'],
  'banks.0.accountHolder': ['kontoinhaber', 'kontoinhaberin'],

  // ===== Unterkunft =====
  'accommodation.type': ['wohnform', 'unterkunft', 'wohnsituation'],

  // ===== Buero/Betreuer (eigene Keys - Begriffe, die EXPLIZIT aufs Buero zielen) =====
  'office.companyName': ['firma', 'firmenname', 'unternehmen', 'buero', 'kanzlei', 'organisation', 'institution'],
  'office.street':     ['strasse'],
  'office.postalCode': ['plz', 'postleitzahl'],
  'office.city':       ['ort', 'stadt'],
  'office.phone':      ['telefon', 'telefonnummer'],
  'office.fax':        ['fax', 'faxnummer', 'absendernummer'],
  'office.email':      ['e mail', 'email'],
  'office.taxNumber':  ['steuernummer'],
  'office.vatId':      ['umsatzsteuer id', 'ust id', 'ust idnr'],
  'betreuer.lastName': ['nachname', 'name'],
  'betreuer.firstName': ['vorname'],
  'betreuer.fullName': ['name des betreuers', 'betreuer', 'gesetzlicher vertreter', 'vertreter']
};

// autocomplete-Attribut -> kanonischer Key (starkes Signal, WHATWG-Standardwerte).
// eslint-disable-next-line no-unused-vars
const BXA_AUTOCOMPLETE_MAP = {
  'family-name': 'person.lastName',
  'given-name': 'person.firstName',
  'additional-name': 'person.firstName',
  'name': 'person.lastName',
  'bday': 'person.birthDate',
  'street-address': 'person.street',
  'address-line1': 'person.street',
  'postal-code': 'person.postal',
  'address-level2': 'person.city',
  'country-name': 'person.country',
  'tel': 'person.phone',
  'email': 'person.email',
  'honorific-prefix': 'person.salutation'
};

// Kontextwoerter (Sektionsueberschriften/legend/umgebender Text) -> Gruppenpraeferenz.
// eslint-disable-next-line no-unused-vars
const BXA_CONTEXT_GROUPS = {
  betreuer_buero: ['betreuer', 'betreuerin', 'gesetzlicher vertreter', 'gesetzliche vertretung', 'bevollmaechtigter', 'bevollmaechtigte', 'vertreter', 'vormund', 'pfleger', 'rechtliche vertretung', 'antragstellervertreter', 'vertretungsberechtigte'],
  betreute_person: ['betreute person', 'betreuter', 'betroffene', 'betroffener', 'antragsteller', 'antragstellerin', 'versicherte', 'versicherter', 'mitglied', 'leistungsberechtigte', 'kunde', 'kundin', 'person', 'kind']
};
