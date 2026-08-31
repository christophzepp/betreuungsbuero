// Büroweite Echtzeit-Ereignisse (Nutzerwunsch 2026-07-19): Server-Tabellen ohne Fall-Raum
// (Kalender, Aufgaben, Büro-Adressbuch, Büro-Finanzen, Vorlagen, Fall-Liste, Posteingang …)
// melden erfolgreiche Schreiboperationen an ALLE verbundenen Fenster/Nutzer, damit offene
// Ansichten sofort neu zeichnen. Entkoppelt vom WebSocket-Modul: ws.js registriert beim Start
// den Notifier (setNotifier); die Routen feuern nur emit() - kein zirkuläres require.

let notifier = null;

exports.setNotifier = (fn) => { notifier = fn; };

exports.emit = (area, payload) => {
  try { if (notifier) notifier(String(area || ''), payload || {}); } catch (_e) { /* nie werfen */ }
};

// Express-Middleware-Fabrik: meldet jede ERFOLGREICHE Nicht-GET-Antwort des Routers als Ereignis.
// pathFilter (optional, RegExp) begrenzt auf bestimmte Unterpfade (z. B. mailbox nur Vorlagen/Regeln).
exports.middleware = (area, pathFilter) => (req, res, next) => {
  if (req.method === 'GET') return next();
  if (pathFilter && !pathFilter.test(req.path)) return next();
  res.on('finish', () => {
    if (res.statusCode < 400) exports.emit(area, { method: req.method, path: req.path });
  });
  next();
};
