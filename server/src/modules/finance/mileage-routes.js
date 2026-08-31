// Büroorganisation - Fahrtkostennachweis (Plan Abschnitt AL, Phase 5): schlankes Ergänzungsmodul für
// private Mitarbeiterfahrzeuge - KEIN volles GoBD-Fahrtenbuch für Dienstwagen (siehe db.js-Kommentar
// zur Begründung). Sichtbarkeit ist zeilenbasiert statt über eine neue granulare Berechtigung:
// jeder Mitarbeiter sieht/erfasst nur eigene Fahrzeuge/Fahrten (fahrer_user_id/owner_user_id = eigene
// userId), Admins sehen und prüfen alles (einfacher Freigabe-Workflow: entwurf → eingereicht →
// geprüft/genehmigt oder abgelehnt → ausgezahlt - keine vollständige State-Machine nötig für den
// realistischen Nutzungsfall von drei Mitarbeitenden).

const express = require('express');
const crypto = require('crypto');
const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const mapProviders = require('../../integrations/maps/providers');
const { requireAuth } = require('../../middleware/authentication');

const router = express.Router();
router.use(requireAuth);
// Echtzeit (2026-07-19): erfolgreiche Schreiboperationen an alle Fenster/Nutzer melden.
router.use(require('../office/events').middleware('mileage'));

const NON_ADMIN_SETTABLE_STATUS = ['entwurf', 'eingereicht'];
const ALL_STATUS = ['entwurf', 'eingereicht', 'geprueft', 'genehmigt', 'ausgezahlt', 'abgelehnt'];

const listVehiclesStmt = db.prepare('SELECT * FROM private_vehicles ORDER BY kennzeichen COLLATE NOCASE');
const listOwnVehiclesStmt = db.prepare('SELECT * FROM private_vehicles WHERE owner_user_id = ? ORDER BY kennzeichen COLLATE NOCASE');
const getVehicleStmt = db.prepare('SELECT * FROM private_vehicles WHERE id = ?');
const insertVehicleStmt = db.prepare(`
  INSERT INTO private_vehicles (id, owner_user_id, kennzeichen, hersteller_modell, status, note, halter_name)
  VALUES (@id, @ownerUserId, @kennzeichen, @herstellerModell, @status, @note, @halterName)
`);
const updateVehicleStmt = db.prepare(`
  UPDATE private_vehicles SET kennzeichen=@kennzeichen, hersteller_modell=@herstellerModell, status=@status, note=@note, halter_name=@halterName WHERE id=@id
`);
const deleteVehicleStmt = db.prepare('DELETE FROM private_vehicles WHERE id = ?');
const deleteTripsForVehicleStmt = db.prepare('DELETE FROM mileage_trips WHERE vehicle_id = ?');

const listRatesStmt = db.prepare('SELECT * FROM mileage_rates ORDER BY gueltig_ab DESC');
const getRateStmt = db.prepare('SELECT * FROM mileage_rates WHERE id = ?');
const insertRateStmt = db.prepare(`
  INSERT INTO mileage_rates (gueltig_ab, gueltig_bis, betrag_pro_km, grundlage)
  VALUES (@gueltigAb, @gueltigBis, @betragProKm, @grundlage)
`);
const updateRateStmt = db.prepare(`
  UPDATE mileage_rates SET gueltig_ab=@gueltigAb, gueltig_bis=@gueltigBis, betrag_pro_km=@betragProKm, grundlage=@grundlage WHERE id=@id
`);
const deleteRateStmt = db.prepare('DELETE FROM mileage_rates WHERE id = ?');
const rateForDateStmt = db.prepare(`
  SELECT * FROM mileage_rates
  WHERE gueltig_ab <= ? AND (gueltig_bis IS NULL OR gueltig_bis = '' OR gueltig_bis >= ?)
  ORDER BY gueltig_ab DESC LIMIT 1
`);

const listAllTripsStmt = db.prepare('SELECT * FROM mileage_trips ORDER BY datum DESC, created_at DESC');
const listOwnTripsStmt = db.prepare('SELECT * FROM mileage_trips WHERE fahrer_user_id = ? ORDER BY datum DESC, created_at DESC');
const getTripStmt = db.prepare('SELECT * FROM mileage_trips WHERE id = ?');
const insertTripStmt = db.prepare(`
  INSERT INTO mileage_trips (id, vehicle_id, fahrer_user_id, datum, fahranlass, case_label, start_adresse, ziel_adresse, kilometer, erstattungsbetrag_snapshot, rate_id_snapshot, status, fahrer_name)
  VALUES (@id, @vehicleId, @fahrerUserId, @datum, @fahranlass, @caseLabel, @startAdresse, @zielAdresse, @kilometer, @erstattungsbetragSnapshot, @rateIdSnapshot, @status, @fahrerName)
`);
const updateTripStmt = db.prepare(`
  UPDATE mileage_trips SET vehicle_id=@vehicleId, fahrer_user_id=@fahrerUserId, datum=@datum, fahranlass=@fahranlass, case_label=@caseLabel, start_adresse=@startAdresse,
    ziel_adresse=@zielAdresse, kilometer=@kilometer, erstattungsbetrag_snapshot=@erstattungsbetragSnapshot, rate_id_snapshot=@rateIdSnapshot,
    status=@status, fahrer_name=@fahrerName, fahrer_unterschrift=@fahrerUnterschrift, fahrer_unterschrift_am=@fahrerUnterschriftAm,
    pruefer_unterschrift=@prueferUnterschrift, pruefer_unterschrift_am=@prueferUnterschriftAm, updated_at=datetime('now')
  WHERE id=@id
`);
const deleteTripStmt = db.prepare('DELETE FROM mileage_trips WHERE id = ?');

function isAdmin(req) { return !!req.session.isAdmin; }
// Plan Abschnitt AV: "Fahrtkosten pruefen/genehmigen" ist jetzt ein eigenes, delegierbares Recht
// (Session-Flag canApproveMileage, modusdifferenziert gesetzt - siehe applySessionPermissions in
// routes/auth.js) - Admins bleiben implizit immer Pruefer. Gilt fuer den FAHRTEN-Bereich (alle
// Fahrten sehen, Status pruefen/genehmigen/ablehnen/auszahlen); Fahrzeug- und Pauschalen-Verwaltung
// bleiben unveraendert eigentums- bzw. admin-gebunden.
function isApprover(req) { return !!req.session.isAdmin || !!req.session.canApproveMileage; }

function publicVehicle(row) {
  return { id: row.id, ownerUserId: row.owner_user_id, kennzeichen: row.kennzeichen, herstellerModell: row.hersteller_modell, status: row.status, note: row.note || '', halterName: row.halter_name || '' };
}
function publicRate(row) {
  return { id: row.id, gueltigAb: row.gueltig_ab, gueltigBis: row.gueltig_bis || '', betragProKm: row.betrag_pro_km, grundlage: row.grundlage };
}
const getUserForDriverNameStmt = db.prepare('SELECT username, display_name, first_name, last_name FROM users WHERE id = ?');
// Nutzerwunsch Runde 12: Fahrer ist jetzt frei waehlbar statt implizit "der/die Anlegende" - die
// Fahrtenliste soll den Namen anzeigen koennen, daher hier "Vorname Nachname" (Fallback: Anzeige-
// name/Nutzername) aufloesen statt nur die rohe userId zurueckzugeben.
function driverDisplayName(u) {
  if (!u) return '';
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return full || u.display_name || u.username || '';
}
function publicTrip(row) {
  return {
    id: row.id, vehicleId: row.vehicle_id, fahrerUserId: row.fahrer_user_id,
    // Klartext-Fahrer (Excel-Import ohne passendes Nutzerkonto) hat Vorrang vor der Aufloesung
    // ueber fahrer_user_id - siehe db.js-Kommentar zu mileage_trips.fahrer_name.
    fahrerName: row.fahrer_name || driverDisplayName(row.fahrer_user_id ? getUserForDriverNameStmt.get(row.fahrer_user_id) : null),
    datum: row.datum, fahranlass: row.fahranlass,
    caseLabel: row.case_label, startAdresse: row.start_adresse, zielAdresse: row.ziel_adresse, kilometer: row.kilometer,
    erstattungsbetrag: row.erstattungsbetrag_snapshot, status: row.status, updatedAt: row.updated_at,
    fahrerUnterschrift: row.fahrer_unterschrift || '', fahrerUnterschriftAm: row.fahrer_unterschrift_am || '',
    prueferUnterschrift: row.pruefer_unterschrift || '', prueferUnterschriftAm: row.pruefer_unterschrift_am || ''
  };
}

// Kilometerpauschale zum Fahrtdatum ermitteln (nicht die "aktuell gültige" - eine spätere
// Ratenänderung darf bereits erfasste Altfahrten nicht rückwirkend verändern).
function currentRateForDate(dateIso) {
  return rateForDateStmt.get(dateIso, dateIso) || listRatesStmt.all()[0] || null;
}

function vehiclesBody(req) {
  const rows = isAdmin(req) ? listVehiclesStmt.all() : listOwnVehiclesStmt.all(req.session.userId);
  return { vehicles: rows.map(publicVehicle) };
}

function tripsBody(req) {
  const rows = isApprover(req) ? listAllTripsStmt.all() : listOwnTripsStmt.all(req.session.userId);
  return { trips: rows.map(publicTrip) };
}

// ===== Fahrer (Nutzerwunsch Runde 12) =====
// Alle angemeldeten Nutzer duerfen die Namensliste sehen (fuer die Fahrer-Auswahl im Formular) -
// keine sensiblen Felder, nur id + Anzeigename.
const listDriverCandidatesStmt = db.prepare(`
  SELECT id, username, display_name, first_name, last_name FROM users
  WHERE allow_local = 1 OR allow_online = 1
  ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE, username COLLATE NOCASE
`);
router.get('/drivers', (req, res) => {
  res.json({ drivers: listDriverCandidatesStmt.all().map((u) => ({ id: u.id, name: driverDisplayName(u) })) });
});

// ===== Fahrzeuge =====
router.get('/vehicles', (req, res) => {
  res.json(vehiclesBody(req));
});

router.post('/vehicles', (req, res) => {
  const { kennzeichen, herstellerModell, note, halterName } = req.body || {};
  if (!kennzeichen || !String(kennzeichen).trim()) return res.status(400).json({ error: 'Kennzeichen erforderlich.' });
  const row = { id: crypto.randomUUID(), ownerUserId: req.session.userId, kennzeichen: String(kennzeichen).trim(), herstellerModell: herstellerModell || '', status: 'aktiv', note: note || '', halterName: halterName || '' };
  insertVehicleStmt.run(row);
  res.status(201).json({ vehicle: publicVehicle(getVehicleStmt.get(row.id)) });
});

router.put('/vehicles/:id', (req, res) => {
  const row = getVehicleStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fahrzeug nicht gefunden.' });
  if (!isAdmin(req) && row.owner_user_id !== req.session.userId) return res.status(403).json({ error: 'Kein Zugriff auf dieses Fahrzeug.' });
  const { kennzeichen, herstellerModell, status, note, halterName } = req.body || {};
  updateVehicleStmt.run({
    id: row.id,
    kennzeichen: kennzeichen != null ? String(kennzeichen).trim() : row.kennzeichen,
    herstellerModell: herstellerModell != null ? herstellerModell : row.hersteller_modell,
    status: status != null ? status : row.status,
    note: note != null ? String(note) : (row.note || ''),
    halterName: halterName != null ? String(halterName) : (row.halter_name || '')
  });
  res.json({ vehicle: publicVehicle(getVehicleStmt.get(row.id)) });
});

router.delete('/vehicles/:id', (req, res) => {
  const row = getVehicleStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fahrzeug nicht gefunden.' });
  if (!isAdmin(req) && row.owner_user_id !== req.session.userId) return res.status(403).json({ error: 'Kein Zugriff auf dieses Fahrzeug.' });
  deleteTripsForVehicleStmt.run(row.id);
  deleteVehicleStmt.run(row.id);
  res.json({ ok: true });
});

// ===== Kilometerpauschalen (nur Admin schreibt, alle lesen) =====
router.get('/rates', (req, res) => {
  res.json({ rates: listRatesStmt.all().map(publicRate) });
});

router.post('/rates', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Nur Admins können Kilometerpauschalen anlegen.' });
  const { gueltigAb, gueltigBis, betragProKm, grundlage } = req.body || {};
  if (!gueltigAb || betragProKm == null) return res.status(400).json({ error: 'Gültig ab und Betrag pro km erforderlich.' });
  const info = insertRateStmt.run({ gueltigAb, gueltigBis: gueltigBis || null, betragProKm: Number(betragProKm), grundlage: grundlage || '' });
  res.status(201).json({ rate: publicRate(getRateStmt.get(info.lastInsertRowid)) });
});

router.put('/rates/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Nur Admins können Kilometerpauschalen bearbeiten.' });
  const row = getRateStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Pauschale nicht gefunden.' });
  const { gueltigAb, gueltigBis, betragProKm, grundlage } = req.body || {};
  updateRateStmt.run({
    id: row.id,
    gueltigAb: gueltigAb != null ? gueltigAb : row.gueltig_ab,
    gueltigBis: gueltigBis !== undefined ? (gueltigBis || null) : row.gueltig_bis,
    betragProKm: betragProKm != null ? Number(betragProKm) : row.betrag_pro_km,
    grundlage: grundlage != null ? grundlage : row.grundlage
  });
  res.json({ rate: publicRate(getRateStmt.get(row.id)) });
});

router.delete('/rates/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Nur Admins können Kilometerpauschalen löschen.' });
  if (!getRateStmt.get(req.params.id)) return res.status(404).json({ error: 'Pauschale nicht gefunden.' });
  deleteRateStmt.run(req.params.id);
  res.json({ ok: true });
});

// ===== Fahrten =====
router.get('/trips', (req, res) => {
  res.json(tripsBody(req));
});

router.post('/trips', (req, res) => {
  const { vehicleId, datum, fahranlass, caseLabel, startAdresse, zielAdresse, kilometer, fahrerUserId, fahrerName } = req.body || {};
  if (!vehicleId || !datum || !kilometer) return res.status(400).json({ error: 'Fahrzeug, Datum und Kilometer erforderlich.' });
  const vehicle = getVehicleStmt.get(vehicleId);
  if (!vehicle) return res.status(404).json({ error: 'Fahrzeug nicht gefunden.' });
  if (!isAdmin(req) && vehicle.owner_user_id !== req.session.userId) return res.status(403).json({ error: 'Kein Zugriff auf dieses Fahrzeug.' });
  const rate = currentRateForDate(datum);
  const km = Number(kilometer) || 0;
  const row = {
    id: crypto.randomUUID(),
    vehicleId,
    // Nutzerwunsch Runde 12: der Fahrer ist jetzt frei waehlbar (z.B. wenn jemand eine Fahrt fuer
    // eine/n Kolleg/in eintraegt), Default bleibt weiterhin die eigene userId.
    fahrerUserId: fahrerUserId || req.session.userId,
    datum,
    fahranlass: fahranlass || '',
    caseLabel: caseLabel || '',
    startAdresse: startAdresse || '',
    zielAdresse: zielAdresse || '',
    kilometer: km,
    erstattungsbetragSnapshot: rate ? Math.round(km * rate.betrag_pro_km * 100) / 100 : 0,
    rateIdSnapshot: rate ? rate.id : null,
    status: 'entwurf',
    fahrerName: fahrerName != null ? String(fahrerName) : ''
  };
  insertTripStmt.run(row);
  res.status(201).json({ trip: publicTrip(getTripStmt.get(row.id)) });
});

router.put('/trips/:id', (req, res) => {
  const row = getTripStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fahrt nicht gefunden.' });
  const admin = isApprover(req);
  const owner = row.fahrer_user_id === req.session.userId;
  if (!admin && !owner) return res.status(403).json({ error: 'Kein Zugriff auf diese Fahrt.' });
  if (!admin && !NON_ADMIN_SETTABLE_STATUS.includes(row.status)) {
    return res.status(403).json({ error: 'Diese Fahrt wurde bereits geprüft und kann nicht mehr durch den Fahrer bearbeitet werden.' });
  }
  const { vehicleId, datum, fahranlass, caseLabel, startAdresse, zielAdresse, kilometer, status, fahrerUnterschrift, fahrerUserId, fahrerName } = req.body || {};
  if (status != null) {
    if (!ALL_STATUS.includes(status)) return res.status(400).json({ error: 'Ungültiger Status.' });
    if (!admin && !NON_ADMIN_SETTABLE_STATUS.includes(status)) return res.status(403).json({ error: 'Nur Admins können diesen Status setzen.' });
  }
  // Unterschriftenoptionen (Nutzerwunsch Runde 6): der Fahrer bestaetigt das Einreichen per
  // getipptem Namen - ohne Unterschrift kein Statuswechsel auf "eingereicht". Die Pruef-
  // Unterschrift (Admin) wird dagegen automatisch beim Statuswechsel durch einen Admin gestempelt,
  // kein Zusatzklick noetig, da es sich um die eigene, bereits authentifizierte Aktion handelt.
  if (status === 'eingereicht' && !admin) {
    if (!fahrerUnterschrift || !String(fahrerUnterschrift).trim()) {
      return res.status(400).json({ error: 'Bitte die Angaben durch Eingabe Ihres Namens bestätigen.' });
    }
  }
  const nextDatum = datum != null ? datum : row.datum;
  const nextKm = kilometer != null ? Number(kilometer) || 0 : row.kilometer;
  const dateOrRateChanged = (datum != null && datum !== row.datum) || (kilometer != null && Number(kilometer) !== row.kilometer);
  const rate = dateOrRateChanged ? currentRateForDate(nextDatum) : null;
  const now = new Date().toISOString().slice(0, 10);
  const settingFahrerSignature = status === 'eingereicht' && !admin && fahrerUnterschrift;
  const settingPrueferSignature = status != null && admin && status !== row.status;
  updateTripStmt.run({
    id: row.id,
    vehicleId: vehicleId != null ? vehicleId : row.vehicle_id,
    fahrerUserId: fahrerUserId != null ? fahrerUserId : row.fahrer_user_id,
    datum: nextDatum,
    fahranlass: fahranlass != null ? fahranlass : row.fahranlass,
    caseLabel: caseLabel != null ? caseLabel : row.case_label,
    startAdresse: startAdresse != null ? startAdresse : row.start_adresse,
    zielAdresse: zielAdresse != null ? zielAdresse : row.ziel_adresse,
    kilometer: nextKm,
    erstattungsbetragSnapshot: rate ? Math.round(nextKm * rate.betrag_pro_km * 100) / 100 : row.erstattungsbetrag_snapshot,
    rateIdSnapshot: rate ? rate.id : row.rate_id_snapshot,
    status: status != null ? status : row.status,
    fahrerName: fahrerName != null ? String(fahrerName) : (row.fahrer_name || ''),
    fahrerUnterschrift: settingFahrerSignature ? String(fahrerUnterschrift).trim() : row.fahrer_unterschrift,
    fahrerUnterschriftAm: settingFahrerSignature ? now : row.fahrer_unterschrift_am,
    prueferUnterschrift: settingPrueferSignature ? (req.session.displayName || '') : row.pruefer_unterschrift,
    prueferUnterschriftAm: settingPrueferSignature ? now : row.pruefer_unterschrift_am
  });
  res.json({ trip: publicTrip(getTripStmt.get(row.id)) });
});

router.delete('/trips/:id', (req, res) => {
  const row = getTripStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fahrt nicht gefunden.' });
  const admin = isApprover(req);
  const owner = row.fahrer_user_id === req.session.userId;
  if (!admin && !owner) return res.status(403).json({ error: 'Kein Zugriff auf diese Fahrt.' });
  if (!admin && !NON_ADMIN_SETTABLE_STATUS.includes(row.status)) {
    return res.status(403).json({ error: 'Diese Fahrt wurde bereits geprüft und kann nicht mehr durch den Fahrer gelöscht werden.' });
  }
  deleteTripStmt.run(row.id);
  res.json({ ok: true });
});

// Nutzerwunsch Runde 11/12: Entfernungsberechnung zwischen Start- und Zieladresse - bewusst
// serverseitig aufgerufen statt clientseitig, damit ein evtl. hinterlegter Anbieter-API-Schluessel
// NIE an den Browser ausgeliefert wird (gleiches Geheimhaltungsprinzip wie SMTP-Passwort/AI-Keys -
// nur das Berechnungsergebnis verlaesst den Server). Welcher Anbieter (Google/OpenStreetMap/HERE)
// tatsaechlich genutzt wird, legt server/map-providers.js anhand von map_settings.active_provider
// fest (siehe Einstellungen → Karten-Einstellungen) - diese Route kennt die Provider-Details nicht.
router.get('/distance', async (req, res) => {
  const origin = String(req.query.origin || '').trim();
  const destination = String(req.query.destination || '').trim();
  if (!origin || !destination) return res.status(400).json({ error: 'Start- und Zieladresse erforderlich.' });
  try {
    const km = await mapProviders.computeDistanceKm(origin, destination, mapProviders.resolveUserMapRow(req.session.userId, req.session.mode));
    res.json({ km });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Entfernungsberechnung fehlgeschlagen.' });
  }
});

module.exports = router;
module.exports.intern = { vehiclesBody, tripsBody };
