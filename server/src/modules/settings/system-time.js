'use strict';

const DEFAULT_TIME_ZONE = 'Europe/Berlin';
const KEY = 'system_time';
function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 100) return false;
  try { new Intl.DateTimeFormat('de-DE', { timeZone: value }).format(); return true; }
  catch (_) { return false; }
}
function get(db) {
  let saved;
  try { saved = JSON.parse(db.prepare('SELECT data_json FROM office_json WHERE key=?').get(KEY)?.data_json || '{}').timeZone; } catch (_) {}
  return { timeZone: validTimeZone(saved) ? saved : DEFAULT_TIME_ZONE, now: new Date().toISOString() };
}
function apply(db) { const settings = get(db); process.env.TZ = settings.timeZone; return settings; }
function set(db, timeZone, userId) {
  if (!validTimeZone(timeZone)) throw new Error('Bitte eine gültige IANA-Zeitzone wählen, zum Beispiel Europe/Berlin.');
  db.prepare(`INSERT INTO office_json(key,data_json,updated_by) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json,updated_by=excluded.updated_by,updated_at=datetime('now')`)
    .run(KEY, JSON.stringify({timeZone}), userId);
  return apply(db);
}
function utcDayBoundary(day, next = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error('Ungültiges Datum.');
  const date = new Date(day + 'T00:00:00');
  if (next) date.setDate(date.getDate() + 1);
  return date.toISOString().replace('T', ' ').slice(0, 19);
}
module.exports = { get, set, apply, validTimeZone, utcDayBoundary };
