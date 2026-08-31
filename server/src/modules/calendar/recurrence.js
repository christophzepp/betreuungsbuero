// Gemeinsame Uebersetzung zwischen dem App-eigenen Wiederholungsmodell {freq,interval,until,count}
// (siehe parseRecurrenceRule im Client) und den drei externen Kalenderformaten:
//   - RFC5545 RRULE-String  (CalDAV: Nextcloud/iCloud  UND  Google Calendar)
//   - Microsoft-Graph recurrence-Objekt {pattern,range}
// Diese Runde hebt die bisher bewusste Grenze auf ("Serientermine werden nicht synchronisiert") -
// das App-Modell (feste "alle N Tage/Wochen/Monate/Jahre [bis Datum | N mal]"-Regel ohne
// Wochentags-/Monatstags-Einschraenkung) bildet sich verlustfrei auf FREQ/INTERVAL/UNTIL/COUNT ab.
// Bewusst NICHT abgebildet (jenseits des App-Modells): BYDAY/BYMONTHDAY-Detailregeln, mehrere
// Wochentage, relativeMonthly/relativeYearly - solche extern angelegten Serien werden beim Pull auf
// ihre Basisfrequenz reduziert (die Einzeltermine bleiben im externen Kalender korrekt, nur die
// Feindetails der Regel sind im schlanken App-Modell nicht darstellbar).

const FREQ_TO_ICS = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
const ICS_TO_FREQ = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const GRAPH_TYPE_TO_FREQ = {
  daily: 'daily', weekly: 'weekly',
  absoluteMonthly: 'monthly', relativeMonthly: 'monthly',
  absoluteYearly: 'yearly', relativeYearly: 'yearly'
};

function pad(n) { return String(n).padStart(2, '0'); }

// Nimmt entweder den in der DB gespeicherten JSON-String oder ein bereits geparstes Objekt entgegen.
function parseModel(raw) {
  if (!raw) return null;
  let r = raw;
  if (typeof raw === 'string') {
    try { r = JSON.parse(raw); } catch (_e) { return null; }
  }
  if (!r || !r.freq || !FREQ_TO_ICS[r.freq]) return null;
  return {
    freq: r.freq,
    interval: Math.max(1, Number(r.interval) || 1),
    until: r.until ? String(r.until).slice(0, 10) : '',
    count: Math.max(0, Number(r.count) || 0)
  };
}

function stringifyModel(model) {
  if (!model) return '';
  return JSON.stringify({ freq: model.freq, interval: model.interval, until: model.until || '', count: model.count || 0 });
}

// startAt "2026-07-09T09:00:00(Z)" -> Kalendertag-Bestandteile inkl. Wochentag (0=So..6=Sa). Bewusst
// ueber Date.UTC des reinen Datumsteils, damit die Zeitzone/Uhrzeit den Wochentag nicht verschiebt.
function startDateParts(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, dow };
}

// ===== RFC5545 RRULE (CalDAV + Google) =====

/* UNTIL muss nach RFC 5545 (3.3.10) dieselbe Wertart tragen wie DTSTART:
     - DTSTART als DATE (ganztaegig)        -> UNTIL als DATE           ("20260930")
     - DTSTART als schwebende Ortszeit      -> UNTIL schwebend          ("20260930T235959")
     - DTSTART in UTC / mit Zeitzonenbezug  -> UNTIL in UTC             ("20260930T235959Z")
   Bis 31.08.2026 wurde IMMER die UTC-Form geschrieben, auch bei ganztaegigen Serien. Strenge
   Gegenstellen (Outlook/Exchange, manche CalDAV-Server) weisen so einen Termin ab oder verwerfen
   die Wiederholung - der Serientermin kam beim Empfaenger als Einzeltermin oder gar nicht an.
   untilForm: 'date' | 'floating' | 'utc' (Vorgabe 'utc' - unveraendertes Verhalten fuer Aufrufer
   ohne Angabe). */
function modelToRRule(raw, untilForm) {
  const rule = parseModel(raw);
  if (!rule) return '';
  let s = `FREQ=${FREQ_TO_ICS[rule.freq]}`;
  if (rule.interval > 1) s += `;INTERVAL=${rule.interval}`;
  if (rule.count) s += `;COUNT=${rule.count}`;
  else if (rule.until) {
    const tag = rule.until.replace(/-/g, '');
    const endung = untilForm === 'date' ? '' : (untilForm === 'floating' ? 'T235959' : 'T235959Z');
    s += `;UNTIL=${tag}${endung}`;
  }
  return s;
}

// Akzeptiert "FREQ=WEEKLY;INTERVAL=2;COUNT=5" mit oder ohne fuehrendes "RRULE:". Liefert ein Modell-
// Objekt oder null (bei unbekannter/fehlender FREQ).
function rruleToModel(rrule) {
  const str = String(rrule || '').replace(/^RRULE:/i, '').trim();
  if (!str) return null;
  const parts = {};
  for (const kv of str.split(';')) {
    const idx = kv.indexOf('=');
    if (idx < 0) continue;
    parts[kv.slice(0, idx).toUpperCase().trim()] = kv.slice(idx + 1).trim();
  }
  const freq = ICS_TO_FREQ[(parts.FREQ || '').toUpperCase()];
  if (!freq) return null;
  const model = { freq, interval: Math.max(1, Number(parts.INTERVAL) || 1), until: '', count: 0 };
  if (parts.COUNT) model.count = Math.max(0, Number(parts.COUNT) || 0);
  else if (parts.UNTIL) {
    const m = String(parts.UNTIL).match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) model.until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  return model;
}
function rruleToModelJson(rrule) { return stringifyModel(rruleToModel(rrule)); }

// Google liefert die Wiederholung als Array von Zeilen (RRULE/EXDATE/RDATE) - wir lesen nur die RRULE.
function googleRecurrenceToModelJson(arr) {
  if (!Array.isArray(arr)) return '';
  const line = arr.find((l) => /^RRULE:/i.test(String(l || '')));
  return line ? rruleToModelJson(line) : '';
}
/* Google erwartet bei Ganztagsterminen (start.date) ebenfalls ein DATE in UNTIL; getaktete
   Termine reicht die Anbindung mit ausdruecklicher Zeitzone weiter, dort bleibt die UTC-Form. */
function modelToGoogleRecurrence(raw, allDay) {
  const rrule = modelToRRule(raw, allDay ? 'date' : 'utc');
  return rrule ? [`RRULE:${rrule}`] : null;
}

// ===== Microsoft Graph recurrence {pattern,range} =====

function modelToGraphRecurrence(raw, startAtIso) {
  const rule = parseModel(raw);
  if (!rule) return null;
  const start = startDateParts(startAtIso);
  if (!start) return null;
  const pattern = { interval: rule.interval };
  if (rule.freq === 'daily') pattern.type = 'daily';
  else if (rule.freq === 'weekly') { pattern.type = 'weekly'; pattern.daysOfWeek = [WEEKDAYS[start.dow]]; pattern.firstDayOfWeek = 'monday'; }
  else if (rule.freq === 'monthly') { pattern.type = 'absoluteMonthly'; pattern.dayOfMonth = start.day; }
  else if (rule.freq === 'yearly') { pattern.type = 'absoluteYearly'; pattern.month = start.month; pattern.dayOfMonth = start.day; }
  else return null;
  const range = { startDate: `${start.year}-${pad(start.month)}-${pad(start.day)}` };
  if (rule.count) { range.type = 'numbered'; range.numberOfOccurrences = rule.count; }
  else if (rule.until) { range.type = 'endDate'; range.endDate = rule.until; }
  else { range.type = 'noEnd'; }
  return { pattern, range };
}

function graphRecurrenceToModelJson(rec) {
  if (!rec || !rec.pattern) return '';
  const p = rec.pattern, r = rec.range || {};
  const freq = GRAPH_TYPE_TO_FREQ[p.type];
  if (!freq) return '';
  const model = { freq, interval: Math.max(1, Number(p.interval) || 1), until: '', count: 0 };
  if (r.type === 'numbered' && r.numberOfOccurrences) model.count = Math.max(0, Number(r.numberOfOccurrences) || 0);
  else if (r.type === 'endDate' && r.endDate) model.until = String(r.endDate).slice(0, 10);
  return stringifyModel(model);
}

module.exports = {
  parseModel, stringifyModel,
  modelToRRule, rruleToModel, rruleToModelJson,
  modelToGoogleRecurrence, googleRecurrenceToModelJson,
  modelToGraphRecurrence, graphRecurrenceToModelJson
};
