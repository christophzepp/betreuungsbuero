// Generischer büroweiter JSON-Speicher (Nutzerwunsch 2026-07-17): EIN Blob je Schlüssel, geteilt für
// alle berechtigten Nutzer. Bewusst mit Schlüssel-WHITELIST statt freiem KV: jeder neue Verbraucher
// wird hier eingetragen, damit der Speicher nicht zur unkontrollierten Ablage wird.
// Erste Verbraucher: KI-Chat-Verläufe sowie Zwischenstände/Abschlüsse der Fallbeginn-/Fallabschluss-
// Assistenten. Rechte wie die übrigen Büro-Daten: Lesen mit Fall-Sichtrecht, Schreiben mit
// Fall-Bearbeitungsrecht (kein Admin nötig - vgl. Kommentar in routes/office-contacts.js /sources).
// Seit 25.08.2026 gilt das als STANDARD: einzelne Schlüssel dürfen davon abweichen, siehe die
// Tabellen LESE_SCHRANKEN/SCHREIB_SCHRANKEN weiter unten (bisher nur 'datenschutz').

const express = require('express');
const db = require('../../database/index');
const { requireAuth, requireViewCases, requireEditCases } = require('../../middleware/authentication');

const router = express.Router();
const intakeOcr = require('../cases/intake-ocr').createIntakeOcrStore(db);
router.use(requireAuth);
// Echtzeit (2026-07-19): erfolgreiche Schreiboperationen an alle Fenster/Nutzer melden.
router.use(require('./events').middleware('officeJson'));

// 'ui_prefs': büroweite Oberflächen-Vorgaben (z. B. Dateinamen-Stil der Exporte) – gepflegt im
// Admin-Panel, gelesen von allen Online-Clients beim Login; eigene Nutzerwahl geht vor.
// 'mailx_case_links': büroweite Zuordnung E-Mail → Fall (aus dem Postfach „In Falldokumentation
// ablegen"). Damit die Zuordnung ein Neuladen überlebt und im Büro-Backup mitwandert.
// 'mailx-labels': büroweite Namen der 6 Mail-Label-Slots (Altbug 2026-07-19 behoben: der Client
// nutzte den Schlüssel längst, er fehlte aber in der Whitelist - Speichern lief ins Leere).
// 'kontaktmonitor': büroweite Kontakt-Turnus/-Verlauf je Fall (§ 1863 BGB). 'qualifikationen':
// Qualifikationsmanager (je Person Qualifikation/Einstufung/Fortbildungen/Sonderaufgaben/Stunden/
// Nachweise). Beide nutzten den Store längst, fehlten aber in der Whitelist -> Speichern lief still
// ins Leere (PUT 404, vom Client verschluckt), Turnus/Qualifikationen gingen bei jedem Reload verloren.
// 'custom_forms': selbst gebaute Formulare des Bueros (Formulareditor, 24.08.2026) - Katalog-
// eintraege, Schemata, Koordinatenkarten und die Ausblendliste mitgelieferter Dokumente.
// KEINE PDF-Bytes (15-MB-Deckel); hochgeladene Vordrucke bekommen eine eigene Bytes-Route.
// 'datenschutz': EIN bueroweiter Datensatz mit den vier DSGVO-Nachweisen (25.08.2026) -
// Verzeichnis der Verarbeitungstaetigkeiten (Art. 30), TOM-Dokumentation (Art. 32),
// Auskunftsersuchen betroffener Personen (Art. 15) und Datenpannen (Art. 33), dazu die Angaben
// zum Verantwortlichen, zur/zum Datenschutzbeauftragten und zur Aufsichtsbehoerde. Der Schluessel
// ist der EINZIGE mit einer eigenen LESE-Schranke: Auskuenfte und Pannen nennen Klarnamen
// betroffener Personen, deshalb reicht das Fall-Sichtrecht hier NICHT (siehe LESE_SCHRANKEN).
const KEYS = new Set(['ai_chats', 'case_intakes', 'case_outtakes', 'ui_prefs', 'suggestion_registry', 'mailx_case_links', 'mailx-labels', 'kontaktmonitor', 'qualifikationen', 'aussendienst_ledger', 'custom_forms', 'vertretungsplan', 'datenschutz', 'einstellungs_vorgaben', 'rollen', 'mail_signaturen_abgeloest']);

/* Lese- und Schreib-Schranken JE SCHLUESSEL (25.08.2026).
   WARUM eine Tabelle statt einer weiteren if-Kette in den Routen: In diesem einen Topf liegt sehr
   Unterschiedliches nebeneinander - von harmlosen Oberflaechen-Vorgaben bis zu Nachweismaterial
   mit Klarnamen. Wer kuenftig einen Schluessel ergaenzt, soll an EINER Stelle entscheiden muessen,
   wer ihn sehen und wer ihn aendern darf, statt die Antwort ueber die Routen zu verteilen.
   WICHTIG - kein Verhaltensbruch: Was hier NICHT eingetragen ist, laeuft exakt wie bisher, also
   Lesen mit dem Fall-Sichtrecht (requireViewCases) und Schreiben mit dem Fall-Bearbeitungsrecht
   (requireEditCases) samt den gewachsenen Sonderpruefungen unten in der PUT-Route. Es steht daher
   bewusst nur 'datenschutz' darin; alle Bestandsschluessel bleiben unberuehrt. */
const LESE_SCHRANKEN = new Map([
  // 'einstellungs_vorgaben' (Buero-/Rollen-/Personen-Vorgaben des einheitlichen Einstellungs-
  // menues) und 'rollen' (Rollennamen + Zuweisungen) muessen fuer JEDE angemeldete Person lesbar
  // sein - eine Vorgabe, die die betroffene Person nicht laden darf, kann nicht wirken.
  // Die Rechte-SCHABLONEN im 'rollen'-Blob sind dagegen Verwaltungsmaterial (bislang nur ueber
  // die admin-gegatete Nutzerliste sichtbar): die GET-Route ENTFERNT sie deshalb beim
  // Ausliefern an alle, die nicht Admin sind oder Buerostammdaten verwalten (siehe Redaktion
  // in der GET-Route). Anwenden koennen Schablonen ohnehin nur Admins (PUT /api/admin/users).
  ['einstellungs_vorgaben', {
    erlaubt: (session) => !!session,
    fehler: 'Nicht angemeldet.'
  }],
  ['rollen', {
    erlaubt: (session) => !!session,
    fehler: 'Nicht angemeldet.'
  }],
  // 'datenschutz' fuehrt Auskunftsersuchen und Datenpannen. Beide nennen die NAMEN betroffener
  // Personen und schildern Vorfaelle. Das ist Governance-Material der Bueroleitung und kein
  // Fallwissen - ein (womoeglich auf wenige Faelle beschraenktes) Fall-Sichtrecht darf es nicht
  // aufschliessen. Sehen darf es, wer das Buero verwaltet oder ohnehin das Verarbeitungs-Log
  // einsehen darf; beides sind Rechte, die genau diese Aufsichtsrolle beschreiben.
  ['datenschutz', {
    erlaubt: (session) => !!(session && (session.isAdmin || session.canManageOfficeProfile || session.canViewAuditLog)),
    fehler: 'Keine Berechtigung, die Datenschutz-Nachweise einzusehen.'
  }],
  /* Abgeloeste Konto-Signaturen (28.08.2026): Klartext aus fremden Postfaechern. Ohne Eintrag
     HIER griffe die Vorgabe requireViewCases - dann koennte jede Person mit Fall-Sichtrecht
     die Signaturen aller Kolleginnen lesen. Dieselbe Schranke wie beim Schreiben. */
  ['mail_signaturen_abgeloest', {
    erlaubt: (session) => !!(session && (session.isAdmin || session.canManageMailSettings)),
    fehler: 'Keine Berechtigung, die abgelösten Konto-Signaturen einzusehen.'
  }]
]);

const SCHREIB_SCHRANKEN = new Map([
  // Vorgaben und Rollen des einheitlichen Einstellungsmenues: schreiben darf, wer auch die
  // uebrigen bueroweiten Oberflaechen-Vorgaben pflegt (Admin oder Buerostammdaten-Recht).
  // BEWUSST ohne Fall-Bearbeitungsrecht davor - dieselbe Begruendung wie bei 'datenschutz'.
  ['einstellungs_vorgaben', {
    erlaubt: (session) => !!(session && (session.isAdmin || session.canManageOfficeProfile)),
    fehler: 'Keine Berechtigung, Einstellungs-Vorgaben zu ändern.'
  }],
  ['rollen', {
    erlaubt: (session) => !!(session && (session.isAdmin || session.canManageOfficeProfile)),
    fehler: 'Keine Berechtigung, Rollen zu ändern.'
  }],
  // Schreiben wie bei den uebrigen Buerostammdaten: Admin oder Buerostammdaten-Verwaltung.
  // BEWUSST OHNE zusaetzliches Fall-Bearbeitungsrecht (darin liegt der Unterschied zum sonst
  // gleichen 'vertretungsplan' unten): Die Lese-Schranke oben laesst eine datenschutzbeauftragte
  // Person ausdruecklich OHNE Fallrechte an das Verzeichnis. Bliebe requireEditCases davor,
  // koennte genau diese Person alles oeffnen, aber nichts speichern.
  ['datenschutz', {
    erlaubt: (session) => !!(session && (session.isAdmin || session.canManageOfficeProfile)),
    fehler: 'Keine Berechtigung, die Datenschutz-Nachweise zu ändern.'
  }],
  /* Einmalige Merkzeile fuer die abgeloesten Konto-Signaturen (28.08.2026). Sie enthaelt
     Klartext aus fremden Postfaechern - deshalb NUR fuer Verwaltende, lesend wie schreibend.
     Nach dem einmaligen Abraeumen im Menue ist sie leer. */
  ['mail_signaturen_abgeloest', {
    erlaubt: (session) => !!(session && (session.isAdmin || session.canManageMailSettings)),
    fehler: 'Keine Berechtigung, die abgelösten Konto-Signaturen zu sehen oder zu ändern.'
  }]
]);

/* Baut aus einer Schranken-Tabelle eine Middleware. Ohne Sondereintrag wird die bisherige
   Standard-Middleware unveraendert durchgereicht - deshalb bleibt auch die REIHENFOLGE erhalten:
   erst das Recht, dann die Whitelist. Ein Nutzer ohne Recht bekommt also weiterhin 403 statt
   ueber ein 404 zu erfahren, welche Schluessel es gibt. */
function schrankeFuer(tabelle, standard) {
  return (req, res, next) => {
    const regel = tabelle.get(req.params.key);
    if (!regel) return standard(req, res, next);
    if (!regel.erlaubt(req.session)) return res.status(403).json({ error: regel.fehler });
    return next();
  };
}

const darfSchluesselLesen = schrankeFuer(LESE_SCHRANKEN, requireViewCases);
const darfSchluesselSchreiben = schrankeFuer(SCHREIB_SCHRANKEN, requireEditCases);

const getStmt = db.prepare('SELECT data_json, updated_at FROM office_json WHERE key = ?');
const { sichtbareFaelle, darfSehen, darfBearbeiten } = require('../cases/case-visibility');
const { isDemoCaseId } = require('../demo/data-identities');

/* Fallbezogene Sichtbarkeit (2026-07-26): einige buroweite Bloecke fuehren Eintraege je Fall
   (kontaktmonitor: entries[].caseId). Beim Ausliefern werden fremde Faelle entfernt. Der
   gespeicherte Blob bleibt unangetastet - geschrieben wird weiterhin der ganze Datensatz. */
const FALLBEZOGENE_SCHLUESSEL = new Set(['kontaktmonitor', 'case_intakes']);

function intakeId(entry) {
  return String((entry && (entry.id || entry.draftId)) || '').trim();
}

function intakeCaseId(entry) {
  return String((entry && entry.state && entry.state.targetCaseId) || '').trim();
}

function intakeOwnerId(entry) {
  return Number((entry && (entry.ownerUserId || (entry.state && entry.state.ownerUserId))) || 0) || 0;
}

function intakeErlaubt(entry, session, schreiben) {
  if (!session || !session.userId) return false;
  if (session.isAdmin) return true;
  const caseId = intakeCaseId(entry);
  if (caseId) return schreiben ? darfBearbeiten(session, caseId) : darfSehen(session, caseId);
  const owner = intakeOwnerId(entry);
  // Datenschutz: Altdrafts ohne Fall- und Eigentümerzuordnung dürfen nicht
  // versehentlich büroweit sichtbar werden. Nur ein Admin darf sie sehen und
  // ausdrücklich zuordnen; neue Entwürfe erhalten beim Anlegen sofort ownerUserId.
  return owner > 0 && owner === Number(session.userId);
}

function caseIntakesFiltern(data, session) {
  const copy = data && typeof data === 'object' ? data : {};
  const entries = Array.isArray(copy.entries) ? copy.entries : [];
  const unassignedCount = entries.filter((entry) => !intakeCaseId(entry) && !intakeOwnerId(entry)).length;
  return {
    ...copy,
    entries: entries.filter((entry) => intakeErlaubt(entry, session, false)),
    ...(session && session.isAdmin && unassignedCount
      ? { migrationRequired: { kind: 'case_intakes_unassigned', count: unassignedCount } }
      : {})
  };
}

function fallEintraegeFiltern(key, roh, session) {
  if (!FALLBEZOGENE_SCHLUESSEL.has(key)) return roh;
  try {
    const daten = JSON.parse(roh);
    if (!daten || !Array.isArray(daten.entries)) return roh;
    if (key === 'case_intakes') return JSON.stringify(caseIntakesFiltern(daten, session));
    const erlaubt = sichtbareFaelle(session);
    daten.entries = daten.entries.filter((e) => {
      const id = String((e && e.caseId) || '');
      if (isDemoCaseId(id)) return false;
      return erlaubt === null || !id || erlaubt.has(id);
    });
    return JSON.stringify(daten);
  } catch (_e) { return roh; }
}
const putStmt = db.prepare(`INSERT INTO office_json (key, data_json, updated_by) VALUES (@key, @dataJson, @userId)
  ON CONFLICT(key) DO UPDATE SET data_json = @dataJson, updated_at = datetime('now'), updated_by = @userId`);

function markOfficeMaterialization() {
  try {
    const service = require('../documents/materializations').current();
    if (service && typeof service.markOfficeDirty === 'function') service.markOfficeDirty();
  } catch (_error) { /* Der Scanner bleibt das Sicherheitsnetz. */ }
}

function intakeByDraftId(draftId) {
  const row = getStmt.get('case_intakes');
  if (!row) return null;
  let data;
  try { data = JSON.parse(row.data_json || '{}'); } catch (_error) { return null; }
  return (Array.isArray(data.entries) ? data.entries : [])
    .find((entry) => intakeId(entry) === String(draftId || '').trim()) || null;
}

function mergeCaseIntakes(input, session) {
  const incoming = input && typeof input === 'object' ? input : {};
  const list = Array.isArray(incoming.entries) ? incoming.entries : [];
  const row = getStmt.get('case_intakes');
  let existing = {};
  try { existing = row ? JSON.parse(row.data_json || '{}') : {}; } catch (_error) { existing = {}; }
  const previous = Array.isArray(existing.entries) ? existing.entries : [];
  const oldById = new Map(previous.map((entry) => [intakeId(entry), entry]));
  const ids = new Set();
  for (const entry of list) {
    const id = intakeId(entry);
    if (!id) throw new Error('Fallbeginn-Eintrag ohne Kennung.');
    if (ids.has(id)) throw new Error(`Fallbeginn-Kennung ist doppelt vorhanden: ${id}`);
    ids.add(id);
    const before = oldById.get(id);
    // Ein neuer, noch fallloser Entwurf darf vom angemeldeten Bearbeiter
    // angelegt werden; er wird unten vor dem Speichern zwingend ihm zugeordnet.
    const newUnassigned = !before && !intakeCaseId(entry) && !intakeOwnerId(entry);
    if (!newUnassigned && !intakeErlaubt(entry, session, true)) {
      const error = new Error('Ein Fallbeginn gehört zu einem Fall, den Sie nicht bearbeiten dürfen.');
      error.status = 403;
      throw error;
    }
  }
  const normalized = list.map((entry) => {
    const before = oldById.get(intakeId(entry));
    if (before && !intakeErlaubt(before, session, true)) {
      const error = new Error('Ein fremder Fallbeginn darf nicht verändert oder einem anderen Fall zugeordnet werden.');
      error.status = 403;
      throw error;
    }
    return {
      ...entry,
      ownerUserId: intakeOwnerId(before) || intakeOwnerId(entry) || Number(session.userId)
    };
  });
  // Nicht sichtbare Einträge dürfen beim Speichern einer gefilterten Liste weder
  // verschwinden noch überschrieben werden.
  for (const entry of previous) {
    if (!intakeErlaubt(entry, session, true) && !normalized.some((item) => intakeId(item) === intakeId(entry))) {
      normalized.push(entry);
    }
  }
  return { ...existing, ...incoming, entries: normalized };
}

function checkKeyPermission(req, res) {
  if (req.params.key === 'aussendienst_ledger' && !(req.session.isAdmin || req.session.canUseFieldService)) {
    res.status(403).json({ error: 'Keine Berechtigung, den Außendienstmodus zu nutzen.' });
    return false;
  }
  return true;
}

// Der Fallbeginn lädt seinen großen OCR-Volltext nur beim tatsächlichen
// Fortsetzen nach. Listen, Dashboard und der 20-Sekunden-Abgleich erhalten
// ausschließlich Verfügbarkeit, Länge, Anzahl und Prüfsumme.
/* ===== Qualifikationsmanager: "alle Eintraege" ist ein RECHT, keine Anzeigefrage ==========
   Befund 31.08.2026. Das Recht viewAllQualifications ist im Rechtekatalog beschrieben als
   "Qualifikationsmanager: alle Eintraege sehen (sonst nur den eigenen)". Durchgesetzt wurde es
   aber nur an zwei Stellen: in der Oberflaeche (canSeeAll() im Block qualimanager-script-v1) und
   im MCP-Werkzeug. Der Web-Weg lief ueber die VORGABE dieses Speichers - Lesen mit dem
   Fall-Sichtrecht. Damit bekam jede angemeldete Person mit Fall-Sichtrecht ueber
   GET /api/office-json/qualifikationen die Qualifikationen, Fortbildungen, Stundenumfaenge und
   Nachweise ALLER Mitarbeitenden; die Beschraenkung auf den eigenen Eintrag existierte nur im
   Browser. Das sind Personaldaten von Kolleginnen und Kollegen - sie gehoeren hinter dieselbe
   Schranke wie ihre Anzeige.

   Warum eine Redaktion und keine Lese-Schranke: Ohne das Recht darf man den EIGENEN Eintrag sehr
   wohl sehen und pflegen - ein glattes 403 wuerde den Qualifikationsmanager fuer alle anderen
   unbrauchbar machen. Deshalb wie beim 'rollen'-Blob: ausliefern, aber nur den eigenen Teil.

   Und warum das Schreiben zusammenfuehren MUSS: Der Client speichert immer den ganzen Blob. Ein
   Browser, der nur den eigenen Eintrag erhalten hat, wuerde beim Speichern alle uebrigen
   loeschen. Die Zusammenfuehrung unten uebernimmt vom eingehenden Stand ausschliesslich die
   eigenen Schluessel und laesst den Rest unangetastet. */
function eigeneQualiSchluessel(session) {
  const schluessel = new Set();
  const uid = session && session.userId;
  if (!uid) return schluessel;
  const namensSchluessel = (vor, nach) => String(String(vor || '').trim() + ' ' + String(nach || '').trim())
    .toLowerCase().replace(/\s+/g, ' ').trim();
  try {
    const u = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(uid);
    if (u) {
      const k = namensSchluessel(u.first_name, u.last_name);
      if (k) schluessel.add(k);
    }
  } catch (_e) { /* Namensspalten fehlen (Altbestand): dann traegt nur die Personen-ID */ }
  try {
    /* Seit dem Personenregister ist der Eintragsschluessel die Personen-ID; aeltere Bestaende
       tragen den Namensschluessel. Beide Formen zaehlen als "eigener Eintrag". */
    for (const r of db.prepare('SELECT id, first_name, last_name FROM persons WHERE user_id = ?').all(uid)) {
      if (r.id) schluessel.add(String(r.id));
      const k = namensSchluessel(r.first_name, r.last_name);
      if (k) schluessel.add(k);
    }
  } catch (_e) { /* Tabelle fehlt: Namensschluessel bleibt */ }
  return schluessel;
}

function istEigenerQualiSchluessel(schluessel, k) {
  const s = String(k == null ? '' : k);
  return schluessel.has(s) || schluessel.has(s.toLowerCase());
}

function nurEigeneQualifikationen(data, session) {
  const eigene = eigeneQualiSchluessel(session);
  const alle = (data && typeof data.entries === 'object' && data.entries) || {};
  const gefiltert = {};
  for (const k of Object.keys(alle)) {
    if (istEigenerQualiSchluessel(eigene, k)) gefiltert[k] = alle[k];
  }
  return Object.assign({}, data, { entries: gefiltert });
}

function mergeQualifikationen(neu, session) {
  const eigene = eigeneQualiSchluessel(session);
  let bestand = {};
  try {
    const row = getStmt.get('qualifikationen');
    bestand = row ? JSON.parse(row.data_json || '{}') : {};
  } catch (_e) { bestand = {}; }
  const alt = (bestand && typeof bestand.entries === 'object' && bestand.entries) || {};
  const eingehend = (neu && typeof neu.entries === 'object' && neu.entries) || {};
  const zusammen = Object.assign({}, alt);
  for (const k of Object.keys(eingehend)) {
    if (istEigenerQualiSchluessel(eigene, k)) zusammen[k] = eingehend[k];
  }
  /* Auch das Loeschen des EIGENEN Eintrags muss ankommen - sonst liesse er sich nie entfernen. */
  for (const k of Object.keys(alt)) {
    if (istEigenerQualiSchluessel(eigene, k) && !Object.prototype.hasOwnProperty.call(eingehend, k)) {
      delete zusammen[k];
    }
  }
  /* Nur die Eintraege werden zusammengefuehrt; uebrige Felder des Blobs bleiben, wie sie waren -
     wer nicht alle Eintraege sehen darf, aendert auch keine bueroweiten Rahmenangaben. */
  return Object.assign({}, bestand, { entries: zusammen });
}

router.get('/case_intakes/ocr/:draftId', requireViewCases, (req, res) => {
  try {
    const entry = intakeByDraftId(req.params.draftId);
    if (!entry) return res.status(404).json({ error: 'Fallbeginn nicht gefunden.' });
    if (!intakeErlaubt(entry, req.session, false)) {
      return res.status(403).json({ error: 'Dieser Fallbeginn gehört nicht zu einem sichtbaren Fall.' });
    }
    const stored = intakeOcr.load(req.params.draftId);
    if (!stored) return res.status(404).json({ error: 'Kein OCR-Volltext für diesen Fallbeginn gespeichert.' });
    res.json({ draftId: String(req.params.draftId), ocr: stored.payload, meta: stored.meta });
  } catch (error) {
    res.status(409).json({ error: error.message || String(error) });
  }
});

router.put('/case_intakes/ocr/:draftId', requireEditCases, (req, res) => {
  try {
    const entry = intakeByDraftId(req.params.draftId);
    if (!entry) return res.status(404).json({ error: 'Fallbeginn nicht gefunden.' });
    if (!intakeErlaubt(entry, req.session, true)) {
      return res.status(403).json({ error: 'Sie dürfen diesen Fallbeginn nicht bearbeiten.' });
    }
    if (!Array.isArray(req.body && req.body.ocr)) {
      return res.status(400).json({ error: 'OCR muss eine Dokumentliste sein.' });
    }
    const meta = intakeOcr.save(req.params.draftId, req.body.ocr);
    markOfficeMaterialization();
    res.json({ ok: true, meta });
  } catch (error) {
    res.status(400).json({ error: error.message || String(error) });
  }
});

router.get('/:key', darfSchluesselLesen, (req, res) => {
  if (!KEYS.has(req.params.key)) return res.status(404).json({ error: 'Unbekannter Speicher-Schlüssel.' });
  if (!checkKeyPermission(req, res)) return;
  const row = getStmt.get(req.params.key);
  /* Fallbezogene Sichtbarkeit (2026-07-26): fallbezogene Eintraege fremder Faelle entfernen. */
  const roh = row ? fallEintraegeFiltern(req.params.key, row.data_json || '{}', req.session) : '{}';
  let data = JSON.parse(roh || '{}');
  // Rollen-Blob: Rechte-SCHABLONEN nur fuer Verwaltende. Rollennamen und Zuweisungen bleiben
  // fuer alle lesbar (die Vorgaben-Aufloesung Person>Rolle>Buero braucht sie), die Matrizen
  // selbst waren vor diesem Menue ausschliesslich ueber die admin-gegatete Nutzerliste
  // sichtbar - das bleibt so (Review-Befund 27.08.2026).
  if (req.params.key === 'rollen' && !(req.session.isAdmin || req.session.canManageOfficeProfile)) {
    if (data && Array.isArray(data.rollen)) {
      data = Object.assign({}, data, { rollen: data.rollen.map((r) => Object.assign({}, r, { rechte: null })) });
    }
  }
  if (req.params.key === 'qualifikationen'
      && !(req.session.isAdmin || req.session.canViewAllQualifications)) {
    data = nurEigeneQualifikationen(data, req.session);
  }
  if (req.params.key === 'case_intakes') {
    data = req.query.hydrateOcr === '1' ? intakeOcr.hydrate(data) : intakeOcr.addMetadata(data);
  }
  res.json({ data, updatedAt: row ? row.updated_at : null });
});

router.put('/:key', darfSchluesselSchreiben, (req, res) => {
  if (!KEYS.has(req.params.key)) return res.status(404).json({ error: 'Unbekannter Speicher-Schlüssel.' });
  if (!checkKeyPermission(req, res)) return;
  // Rechte-Audit 2026-07-17: 'ui_prefs' sind bueroweite OBERFLAECHEN-VORGABEN (z. B. Dateinamen-
  // Stil) und werden im Admin-Panel gepflegt - Schreiben verlangt daher Buerostammdaten-Recht oder
  // Admin, nicht bloss Fallbearbeitung (sonst koennte jeder Fall-Bearbeiter Buerovorgaben umstellen).
  if ((req.params.key === 'ui_prefs' || req.params.key === 'suggestion_registry' || req.params.key === 'custom_forms' || req.params.key === 'vertretungsplan') && !(req.session.isAdmin || req.session.canManageOfficeProfile)) {
    return res.status(403).json({ error: 'Keine Berechtigung, büroweite Oberflächen-Vorgaben zu ändern.' });
  }
  let data = (req.body && req.body.data) !== undefined ? req.body.data : {};
  if (req.params.key === 'qualifikationen'
      && !(req.session.isAdmin || req.session.canViewAllQualifications)) {
    data = mergeQualifikationen(data, req.session);
  }
  if (req.params.key === 'case_intakes') {
    try {
      data = mergeCaseIntakes(data, req.session);
      data = intakeOcr.stripStore(data);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message || String(error) });
    }
  }
  const dataJson = JSON.stringify(data);
  // Schutz vor Ausuferung (der Speicher ist für Zustände, nicht für Dateien): 15 MB je Schlüssel.
  if (dataJson.length > 15 * 1024 * 1024) return res.status(413).json({ error: 'Der Speicherinhalt ist zu groß (max. 15 MB je Schlüssel).' });
  putStmt.run({ key: req.params.key, dataJson, userId: req.session.userId });
  markOfficeMaterialization();
  res.json({ ok: true });
});

module.exports = router;
