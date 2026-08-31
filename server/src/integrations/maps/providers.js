// Karten-/Navigationsanbieter (Nutzerwunsch Runde 12): buero-weit EIN aktiver Anbieter
// (map_settings.active_provider), von hier aus fuer Entfernungsberechnung UND Adressvervollstaendigung
// dispatcht - ein zentraler Ort statt Provider-Verzweigungslogik in jeder aufrufenden Route
// (aktuell nur routes/mileage.js's /distance und routes/map-settings.js's /complete-address, aber
// bewusst generisch gehalten fuer spaetere weitere Verwendungsstellen).
//
// OpenStreetMap ist bewusst der Vorgabe-Anbieter (map_settings-Default 'osm', siehe db.js): Nominatim
// (Geokodierung) und der oeffentliche OSRM-Demo-Router (Routenberechnung) sind BEIDE kostenlos und
// brauchen keinen API-Schluessel - im Unterschied zu Google/HERE funktioniert die Entfernungsberechnung
// damit ohne jede Konfiguration "out of the box". Nominatims Nutzungsbedingungen verlangen einen
// aussagekraeftigen User-Agent-Header UND ein niedriges Anfragetempo - beides ist nur serverseitig
// zuverlaessig umsetzbar (Browser-fetch kann keinen eigenen User-Agent setzen), daher laeuft OSM hier
// IMMER ueber den Server, auch wenn der Client selbst im Lokal-Modus laeuft (siehe client-seitiges
// Gegenstueck in mileage-script-v1, das im Lokal-Modus fuer OSM ebenfalls diese Server-Endpunkte statt
// eines Direktaufrufs nutzt - anders als bei Google, wo der Lokal-Modus mangels Server-Geheimhaltung
// auf die clientseitige JS-SDK ausweichen muss).

const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');

const getMapSettingsStmt = db.prepare('SELECT * FROM map_settings WHERE id = 1');

function getMapSettingsRow() {
  return getMapSettingsStmt.get() || { active_provider: 'osm', google_maps_api_key_encrypted: '', here_api_key_encrypted: '' };
}

function decryptOrThrow(encrypted, label) {
  if (!encrypted) throw new Error(`Kein ${label}-API-Schlüssel hinterlegt (siehe Einstellungen → Karten-Einstellungen).`);
  let key;
  try { key = cryptoHelper.decrypt(encrypted); } catch (_e) {
    throw new Error('API-Schlüssel konnte nicht entschlüsselt werden.');
  }
  if (!key) throw new Error(`Kein ${label}-API-Schlüssel hinterlegt (siehe Einstellungen → Karten-Einstellungen).`);
  return key;
}

// Nominatim-Nutzungsbedingungen: max. 1 Anfrage/Sekunde, aussagekraeftiger User-Agent - fuer die
// Anfrage-Menge dieser App (interaktive Einzelklicks, kein Batch) reicht ein simpler In-Memory-
// Zeitstempel ohne Warteschlange.
let lastNominatimCallAt = 0;
async function nominatimGeocode(query) {
  const now = Date.now();
  const wait = Math.max(0, 1000 - (now - lastNominatimCallAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimCallAt = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Betreuungsbuero-Dokumentenassistent/1.0 (Adressvervollstaendigung)' } });
  if (!res.ok) throw new Error('OpenStreetMap (Nominatim) nicht erreichbar.');
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('Adresse nicht gefunden.');
  return data[0];
}

async function osrmDistanceKm(origin, destination) {
  const [o, d] = await Promise.all([nominatimGeocode(origin), nominatimGeocode(destination)]);
  const url = `https://router.project-osrm.org/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}?overview=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('OSRM-Router nicht erreichbar.');
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('Route konnte nicht berechnet werden. Bitte Adressen prüfen.');
  return Math.round((data.routes[0].distance / 1000) * 10) / 10;
}

async function googleDistanceKm(origin, destination, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') throw new Error(`Google Maps: ${data.error_message || data.status}`);
  const element = data.rows?.[0]?.elements?.[0];
  if (!element || element.status !== 'OK') throw new Error('Route konnte nicht berechnet werden. Bitte Adressen prüfen.');
  return Math.round((element.distance.value / 1000) * 10) / 10;
}

async function hereDistanceKm(origin, destination, apiKey) {
  const [o, d] = await Promise.all([hereGeocode(origin, apiKey), hereGeocode(destination, apiKey)]);
  const url = `https://router.hereapi.com/v8/routes?transportMode=car&origin=${o.lat},${o.lng}&destination=${d.lat},${d.lng}&return=summary&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(`HERE: ${data.title || data.error_description || res.status}`);
  const summary = data.routes?.[0]?.sections?.[0]?.summary;
  if (!summary) throw new Error('Route konnte nicht berechnet werden. Bitte Adressen prüfen.');
  return Math.round((summary.length / 1000) * 10) / 10;
}

async function hereGeocode(query, apiKey) {
  const url = `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(query)}&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(`HERE: ${data.title || data.error_description || res.status}`);
  const item = data.items?.[0];
  if (!item) throw new Error('Adresse nicht gefunden.');
  return { lat: item.position.lat, lng: item.position.lng, label: item.address?.label || query };
}

// Multi-User (Nutzerwunsch): ein Nutzer mit manageMapSettings kann eigene Karten-Zugangsdaten
// hinterlegen (user_settings_overrides.area='maps', Form {activeProvider,googleMapsApiKey,hereApiKey}).
// overrideToRow() formt sie in dieselbe Zeilengestalt wie map_settings; resolveUserMapRow() liefert
// die fuer den handelnden Nutzer effektive Zeile (eigene sonst Admin-Vorgabe). Lazy require.
function overrideToRow(ov) {
  if (!ov || typeof ov !== 'object') return null;
  return {
    active_provider: ov.activeProvider || 'osm',
    google_maps_api_key_encrypted: ov.googleMapsApiKey ? cryptoHelper.encrypt(String(ov.googleMapsApiKey)) : '',
    here_api_key_encrypted: ov.hereApiKey ? cryptoHelper.encrypt(String(ov.hereApiKey)) : ''
  };
}
function resolveUserMapRow(userId, mode) {
  if (!userId) return getMapSettingsRow();
  try {
    const userSettings = require('../../modules/settings/user-settings');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const ov = user ? userSettings.effectiveOverride(user, mode, 'maps') : null;
    return ov ? overrideToRow(ov) : getMapSettingsRow();
  } catch (_e) { return getMapSettingsRow(); }
}

async function computeDistanceKm(origin, destination, settingsRow) {
  const row = settingsRow || getMapSettingsRow();
  const provider = row.active_provider || 'osm';
  if (provider === 'google') {
    const apiKey = decryptOrThrow(row.google_maps_api_key_encrypted, 'Google-Maps');
    return googleDistanceKm(origin, destination, apiKey);
  }
  if (provider === 'here') {
    const apiKey = decryptOrThrow(row.here_api_key_encrypted, 'HERE');
    return hereDistanceKm(origin, destination, apiKey);
  }
  return osrmDistanceKm(origin, destination);
}

async function completeAddress(query, settingsRow) {
  const row = settingsRow || getMapSettingsRow();
  const provider = row.active_provider || 'osm';
  if (provider === 'google') {
    const apiKey = decryptOrThrow(row.google_maps_api_key_encrypted, 'Google-Maps');
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'OK' || !data.results?.[0]) throw new Error(`Google Maps: ${data.error_message || data.status || 'Adresse nicht gefunden.'}`);
    return data.results[0].formatted_address;
  }
  if (provider === 'here') {
    const apiKey = decryptOrThrow(row.here_api_key_encrypted, 'HERE');
    const item = await hereGeocode(query, apiKey);
    return item.label;
  }
  const item = await nominatimGeocode(query);
  return item.display_name;
}

module.exports = { getMapSettingsRow, computeDistanceKm, completeAddress, overrideToRow, resolveUserMapRow };
