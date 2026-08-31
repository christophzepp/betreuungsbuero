// Fill-Dictionary: baut aus der filldata-Antwort des Servers ODER einem lokal importierten
// Fall alle fuer Online-Formulare nutzbaren Datenwerte. Der rekursive Flattener ist absichtlich
// schemaoffen: neue Fallfelder erscheinen ohne eine weitere feste Feldliste automatisch.
/* global bxaNorm */

// Deutsche Bereichs-Labels (Anzeige). Unbekannte/neue Bereiche fallen auf einen lesbar
// aufbereiteten Schluessel zurueck und bleiben dadurch ohne Funktionsverlust nutzbar.
const BXA_SECTION_LABELS = {
  person: 'Person', care: 'Betreuung', health: 'Gesundheit', benefits: 'Leistungsbezug',
  identifiers: 'Identifikationsnummern', insurances: 'Versicherungen', banks: 'Bankdaten',
  budget: 'Budget', accommodation: 'Unterkunft', housing: 'Unterkunft', provisions: 'Vorsorge',
  socialNetwork: 'Soziales Netzwerk', contactProfile: 'Kontaktprofil', assets: 'Vermögen',
  livelihood: 'Lebensunterhalt', assetManagement: 'Verfügungsstellung',
  schuldenregulierung: 'Schuldenregulierung', fristen: 'Fristen', healthInfo: 'Gesundheitsinfos',
  handkasse: 'Handkasse', approvals: 'Genehmigungen', vehicles: 'Fahrzeuge',
  goalDecisionPlanning: 'Bedarfe & Wille', rechtlicherBetreuer: 'Rechtliche/r Betreuer/in',
  accounting: 'Rechnungslegung', history: 'Betreuungsverlauf', derived: 'Abgeleitete Werte',
  promptHints: 'Zusätzliche Fallhinweise'
};

// Nur Bereiche mit einer eigenen, vollständigeren Quelle oder reiner technischer Buchhaltung
// auslassen. Betreuungsverlauf, abgeleitete Werte und Fallhinweise sind datentragend und werden
// seit v0.4.8 bewusst NICHT mehr ausgeschlossen.
const BXA_FLAT_EXCLUDE = ['contacts', 'documentationEntries', 'exportHistory', 'archives', 'contactMerges'];

// Teilpfade, die innerhalb von "Bedarfe & Wille" reine Änderungs-/Verknüpfungsmetadaten sind.
// Die eigentlichen Datensätze und alle fachlichen Felder bleiben vollständig enthalten.
const BXA_GDP_SKIP = ['history', 'links', 'linkedEntries', 'moduleLinks', 'reportSelections'];

const BXA_FIELD_LABELS = {
  firstName: 'Vorname', lastName: 'Nachname', fullName: 'vollständiger Name', birthName: 'Geburtsname',
  birthDate: 'Geburtsdatum', birthPlace: 'Geburtsort', birthCountry: 'Geburtsland', salutation: 'Anrede',
  title: 'Titel', role: 'Rolle', status: 'Status', institution: 'Institution', category: 'Kategorie',
  street: 'Straße', streetFull: 'Straße + Hausnummer', house: 'Hausnummer', houseNumber: 'Hausnummer',
  houseLetter: 'Hausnummernzusatz', postal: 'PLZ', postalCode: 'PLZ', city: 'Ort', country: 'Land',
  postbox: 'Postfach', phone: 'Telefon', mobile: 'Mobiltelefon', email: 'E-Mail', fax: 'Fax',
  fileNumber: 'Aktenzeichen', processNumber: 'Vorgangsnummer', bankName: 'Bank', iban: 'IBAN', bic: 'BIC',
  accountHolder: 'Kontoinhaber/in', accountType: 'Kontoart', maKennung: 'Mitarbeiterkennung',
  companyName: 'Büroname', academicDegree: 'akademischer Grad', taxNumber: 'Steuernummer', vatId: 'USt-IdNr.',
  website: 'Webseite', label: 'Bezeichnung', note: 'Notiz', detail: 'Details', freeDetail: 'Freitext',
  actor: 'Akteur/in', actorGroup: 'Akteursgruppe', contactType: 'Kontaktart', date: 'Datum', year: 'Jahr'
};

function bxaHumanLabel(key) {
  if (BXA_FIELD_LABELS[key]) return BXA_FIELD_LABELS[key];
  return String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-zäöüß0-9])([A-ZÄÖÜ])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function bxaIsScalar(v) { return v == null || ['string', 'number', 'boolean'].includes(typeof v); }
function bxaScalarText(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nein';
  const text = String(v);
  // Bilder/Dateien sind Dokumentquellen und dürfen nicht als mehrmegabytegroßer Formularwert
  // im Dictionary landen. Sie stehen im Upload-Helfer separat zur Verfügung.
  if (/^data:[^;,]+(?:;[^,]*)?;base64,/i.test(text)) return '';
  return text;
}

// Rekursiver Flattener: Sektion -> Pfad-Zeilen. Jede nichtleere skalare Blattzelle wird nutzbar;
// dadurch werden auch künftig neu ergänzte Felder automatisch erfasst.
function bxaFlattenInto(out, prefix, value, labelPrefix, group) {
  if (bxaIsScalar(value)) {
    const text = bxaScalarText(value).trim();
    if (text !== '') out.push({ key: prefix, label: labelPrefix, value: text, group });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => bxaFlattenInto(out, prefix + '.' + i, item, labelPrefix + ' #' + (i + 1), group));
    return;
  }
  if (typeof value === 'object') {
    for (const k of Object.keys(value)) {
      if (k.startsWith('_')) continue;
      if (prefix.startsWith('case:goalDecisionPlanning') && BXA_GDP_SKIP.includes(k)) continue;
      if (k === 'ui') continue; // reine Filter-/Ansichtszustände, keine Falldaten
      bxaFlattenInto(out, prefix + '.' + k, value[k], labelPrefix + ' · ' + bxaHumanLabel(k), group);
    }
  }
}

function bxaSectionGroup(section) {
  if (section === 'banks' || section === 'accounting') return 'konto';
  if (section === 'care') return 'gericht_behoerde';
  if (section === 'rechtlicherBetreuer') return 'betreuer_buero';
  return 'betreute_person';
}

function bxaFirstValue(obj, names) {
  for (const name of names) {
    if (!obj || !Object.prototype.hasOwnProperty.call(obj, name)) continue;
    const value = bxaScalarText(obj[name]).trim();
    if (value !== '') return value;
  }
  return '';
}

function bxaCombinedNumber(obj, direct, area, number) {
  return bxaFirstValue(obj, direct) || [bxaFirstValue(obj, area), bxaFirstValue(obj, number)].filter(Boolean).join('/');
}

const BXA_CONTACT_FIELDS = [
  ['status', 'Status', ['status']], ['role', 'Rolle', ['role', 'rolle']],
  ['salutation', 'Anrede', ['salutation', 'anrede']], ['title', 'Titel', ['title', 'titel']],
  ['firstName', 'Vorname', ['firstName', 'vorname']], ['lastName', 'Nachname', ['lastName', 'nachname']],
  ['institution', 'Institution', ['institution']], ['street', 'Straße', ['street', 'strasse']],
  ['house', 'Hausnummer', ['house', 'houseNumber', 'hausnummer']], ['houseLetter', 'Hausnummernzusatz', ['houseLetter', 'hausbuchstabe']],
  ['postalCode', 'PLZ', ['postalCode', 'postal', 'plz']], ['city', 'Ort', ['city', 'ort']],
  ['country', 'Land', ['country', 'land']], ['postbox', 'Postfach', ['postbox', 'postfach']],
  ['email', 'E-Mail', ['email', 'mail']], ['fileNumber', 'Aktenzeichen', ['fileNumber', 'aktenzeichen']],
  ['processNumber', 'Vorgangsnummer', ['processNumber', 'vorgang']], ['iban', 'IBAN', ['iban']],
  ['bic', 'BIC', ['bic']], ['bankName', 'Bank', ['bankName', 'bank']],
  ['category', 'Kategorie', ['category', 'kategorie']], ['courtName', 'Gericht', ['courtNameRef', 'gericht']],
  ['courtFileNumber', 'Gerichtsaktenzeichen', ['courtFileNumberRef', 'gerichtsAz']]
];

function bxaContactRows(contact, prefix, heading) {
  const out = [];
  const used = new Set(['id', 'key', 'createdAt', 'updatedAt', 'created_at', 'updated_at']);
  const add = (key, label, value) => {
    const text = bxaScalarText(value).trim();
    if (text) out.push({ key: prefix + '.' + key, label: heading + ' · ' + label, value: text, group: 'kontakt' });
  };
  for (const [key, label, aliases] of BXA_CONTACT_FIELDS) {
    aliases.forEach((name) => used.add(name));
    add(key, label, bxaFirstValue(contact, aliases));
  }
  for (const name of ['phone', 'telefon', 'phoneArea', 'phoneNumber']) used.add(name);
  for (const name of ['mobile', 'mobil', 'mobileArea', 'mobileNumber']) used.add(name);
  for (const name of ['fax', 'faxArea', 'faxNumber']) used.add(name);
  add('phone', 'Telefon', bxaCombinedNumber(contact, ['phone', 'telefon'], ['phoneArea'], ['phoneNumber']));
  add('mobile', 'Mobiltelefon', bxaCombinedNumber(contact, ['mobile', 'mobil'], ['mobileArea'], ['mobileNumber']));
  add('fax', 'Fax', bxaCombinedNumber(contact, ['fax'], ['faxArea'], ['faxNumber']));

  const first = bxaFirstValue(contact, ['firstName', 'vorname']);
  const last = bxaFirstValue(contact, ['lastName', 'nachname']);
  const full = [first, last].filter(Boolean).join(' ');
  if (full) add('fullName', 'vollständiger Name', full);
  const street = bxaFirstValue(contact, ['street', 'strasse']);
  const house = [bxaFirstValue(contact, ['house', 'houseNumber', 'hausnummer']), bxaFirstValue(contact, ['houseLetter', 'hausbuchstabe'])].filter(Boolean).join('');
  if (street || house) add('streetFull', 'Straße + Hausnummer', [street, house].filter(Boolean).join(' '));
  const postal = bxaFirstValue(contact, ['postalCode', 'postal', 'plz']);
  const city = bxaFirstValue(contact, ['city', 'ort']);
  if (postal || city) add('postalCity', 'PLZ + Ort', [postal, city].filter(Boolean).join(' '));

  // Nicht katalogisierte, aber datentragende Kontaktfelder bleiben ebenfalls erreichbar.
  for (const key of Object.keys(contact || {})) {
    if (key.startsWith('_') || used.has(key)) continue;
    bxaFlattenInto(out, prefix + '.' + key, contact[key], heading + ' · ' + bxaHumanLabel(key), 'kontakt');
  }
  return out;
}

// Stabile, indexunabhängige Schlüssel für den im Panel aktiv gewählten Kontakt.
// eslint-disable-next-line no-unused-vars
function bxaBuildActiveContactDictionary(contact) {
  return bxaContactRows(contact || {}, 'kontakt', 'Aktiver Kontakt');
}

function bxaReportValue(field) {
  if (field && typeof field === 'object' && !Array.isArray(field)
      && Object.prototype.hasOwnProperty.call(field, 'value')) return field.value;
  return field;
}

function bxaAddReports(out, reports) {
  const source = reports && typeof reports === 'object' ? reports : {};
  for (const [reportId, wrapped] of Object.entries(source)) {
    const data = wrapped && wrapped.data && typeof wrapped.data === 'object' ? wrapped.data : wrapped;
    const fields = data && data.fields && typeof data.fields === 'object' ? data.fields : {};
    for (const [fieldId, field] of Object.entries(fields)) {
      bxaFlattenInto(
        out,
        'report:' + reportId + '.' + fieldId,
        bxaReportValue(field),
        'Dokument „' + bxaHumanLabel(reportId) + '“ · ' + bxaHumanLabel(fieldId),
        'betreute_person'
      );
    }
  }
}

function bxaLooseNorm(value) {
  if (typeof bxaNorm === 'function') return bxaNorm(value);
  return String(value || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
}

function bxaAssignedCaregiver(caseData, employees, officeProfile) {
  const raw = caseData && caseData.rechtlicherBetreuer;
  const wanted = bxaLooseNorm(raw && typeof raw === 'object' ? (raw.id || raw.key || raw.name || raw.label) : raw);
  const match = wanted && (employees || []).find((employee) => {
    const full = [employee.firstName, employee.lastName].filter(Boolean).join(' ');
    return [employee.id, employee.key, employee.maKennung, full, employee.lastName]
      .some((value) => value && bxaLooseNorm(value) === wanted);
  });
  if (!match) return officeProfile || {};
  return { ...(match.extra && typeof match.extra === 'object' ? match.extra : {}), ...match };
}

// Haupteinstieg: filldata = {case, caseData, contacts, reports, documentationEntries,
// officeProfile, officeBankAccounts, officeEmployees} (Server oder lokaler Import).
// eslint-disable-next-line no-unused-vars
function bxaBuildDictionary(filldata) {
  const out = [];
  const cd = filldata.caseData || {};

  // ===== Fall-Metadaten =====
  const caseMeta = filldata.case || {};
  if (bxaScalarText(caseMeta.label).trim()) out.push({ key: 'case:label', label: 'Fall · Bezeichnung', value: String(caseMeta.label).trim(), group: 'betreute_person' });
  if (bxaScalarText(caseMeta.fileNumber).trim()) out.push({ key: 'case:fileNumber', label: 'Fall · Aktenzeichen', value: String(caseMeta.fileNumber).trim(), group: 'gericht_behoerde' });

  // ===== Fall-Sektionen =====
  for (const section of Object.keys(cd)) {
    if (BXA_FLAT_EXCLUDE.includes(section)) continue;
    const label = BXA_SECTION_LABELS[section] || bxaHumanLabel(section);
    bxaFlattenInto(out, 'case:' + section, cd[section], label, bxaSectionGroup(section));
  }

  // Komfort-Ableitungen für häufig kombinierte Formularfelder.
  const p = cd.person || {};
  const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ');
  if (fullName && !p.fullName) out.push({ key: 'case:person.fullName', label: 'Person · vollständiger Name', value: fullName, group: 'betreute_person' });
  const house = [p.house || p.houseNumber, p.houseLetter].filter(Boolean).join('');
  const streetFull = [p.street || p.streetOnly, house].filter(Boolean).join(' ');
  if (streetFull && !p.streetFull) out.push({ key: 'case:person.streetFull', label: 'Person · Straße + Nr.', value: streetFull, group: 'betreute_person' });
  const postalCity = [p.postal || p.postalCode, p.city || p.foreignCity].filter(Boolean).join(' ');
  if (postalCity) out.push({ key: 'case:person.postalCity', label: 'Person · PLZ + Ort', value: postalCity, group: 'betreute_person' });

  // ===== Bedarfe & Wille: zusätzlich sprechende, typbasierte Schlüssel =====
  const BXA_GDP_TYP = { wish: 'Wunsch', goal: 'Ziel', need: 'Bedarf', measure: 'Maßnahme', decision: 'Entscheidung', review: 'Überprüfung' };
  const gdpRecs = (cd.goalDecisionPlanning && Array.isArray(cd.goalDecisionPlanning.records)) ? cd.goalDecisionPlanning.records : [];
  const gdpCounts = {};
  gdpRecs.forEach((record) => {
    if (!record) return;
    const type = BXA_GDP_TYP[String(record.type || '')] || 'Eintrag';
    gdpCounts[type] = (gdpCounts[type] || 0) + 1;
    const number = gdpCounts[type];
    const base = 'case:gdp.' + String(record.type || 'entry') + '.' + number;
    const title = bxaScalarText(record.title || record.statement).trim();
    if (title) out.push({ key: base + '.title', label: type + ' #' + number + ' · Titel', value: title, group: 'betreute_person' });
    for (const [field, label] of [['description', 'Beschreibung'], ['area', 'Lebensbereich'], ['status', 'Status'],
      ['priority', 'Priorität'], ['responsible', 'Verantwortlich'], ['targetDate', 'Zieldatum'],
      ['reviewDate', 'Prüftermin'], ['progress', 'Fortschritt']]) {
      const value = bxaScalarText(record[field]).trim();
      if (value) out.push({ key: base + '.' + field, label: type + ' #' + number + ' · ' + label, value, group: 'betreute_person' });
    }
  });

  // ===== Aktuelle Dokument-/Berichtsfelder und Falldokumentation =====
  bxaAddReports(out, filldata.reports || {});
  const documentation = Array.isArray(filldata.documentationEntries)
    ? filldata.documentationEntries
    : (Array.isArray(cd.documentationEntries) ? cd.documentationEntries : []);
  documentation.forEach((entry, index) => {
    bxaFlattenInto(out, 'doku:' + index, entry, 'Falldokumentation #' + (index + 1), 'betreute_person');
  });

  // ===== Kontakte (deutsche und englische Feldnamen + sämtliche Zusatzfelder) =====
  (filldata.contacts || []).forEach((contact, index) => {
    const institution = bxaFirstValue(contact, ['institution']);
    const name = [bxaFirstValue(contact, ['firstName', 'vorname']), bxaFirstValue(contact, ['lastName', 'nachname'])].filter(Boolean).join(' ');
    const heading = 'Kontakt „' + (institution || name || ('Kontakt ' + (index + 1))) + '“';
    out.push(...bxaContactRows(contact, 'contact:' + index, heading));
  });

  // ===== Büro, Bankkonten und Mitarbeitende =====
  const office = filldata.officeProfile || {};
  for (const field of Object.keys(office)) {
    if (field === 'hasLogo' || field === 'updatedAt' || field === 'id') continue;
    bxaFlattenInto(out, 'office:' + field, office[field], 'Büro · ' + bxaHumanLabel(field), 'betreuer_buero');
  }
  (filldata.officeBankAccounts || []).forEach((bank, index) => {
    for (const field of Object.keys(bank || {})) {
      if (field === 'id' || field === 'sortOrder') continue;
      bxaFlattenInto(out, 'office:bank.' + index + '.' + field, bank[field], 'Büro-Konto #' + (index + 1) + ' · ' + bxaHumanLabel(field), 'betreuer_buero');
    }
  });
  const employees = filldata.officeEmployees || [];
  employees.forEach((employee, index) => {
    const base = 'office:employee.' + index;
    const heading = 'Mitarbeiter/in #' + (index + 1);
    for (const field of Object.keys(employee || {})) {
      if (field === 'id' || field === 'sortOrder') continue;
      bxaFlattenInto(out, base + '.' + field, employee[field], heading + ' · ' + bxaHumanLabel(field), 'betreuer_buero');
    }
    const name = [employee.firstName, employee.lastName].filter(Boolean).join(' ');
    if (name) out.push({ key: base + '.fullName', label: heading + ' · vollständiger Name', value: name, group: 'betreuer_buero' });
  });

  // Die generischen Betreuer-Schlüssel zeigen auf die im Fall zugeordnete Person; nur wenn keine
  // Zuordnung aufgelöst werden kann, bleibt das Büroprofil der sichere Rückfall.
  const caregiver = bxaAssignedCaregiver(cd, employees, office);
  const caregiverName = [caregiver.firstName, caregiver.lastName].filter(Boolean).join(' ');
  for (const field of ['salutation', 'academicDegree', 'firstName', 'lastName', 'role', 'street', 'postalCode', 'city', 'country', 'phone', 'mobile', 'email', 'fax', 'maKennung']) {
    const value = bxaScalarText(caregiver[field]).trim();
    if (value) out.push({ key: 'betreuer:' + field, label: 'Betreuer/in · ' + bxaHumanLabel(field), value, group: 'betreuer_buero' });
  }
  if (caregiverName) out.push({ key: 'betreuer:fullName', label: 'Betreuer/in · vollständiger Name', value: caregiverName, group: 'betreuer_buero' });

  return out;
}

// Nachschlage-Hilfe: key -> Eintrag (für Profil-Anwendung und KI-Mappings).
// eslint-disable-next-line no-unused-vars
function bxaDictionaryIndex(dict) {
  const map = new Map();
  for (const entry of dict) map.set(entry.key, entry);
  return map;
}
