'use strict';

const { AsyncLocalStorage } = require('async_hooks');

/*
 * Kurze anwendungsweite Schreibschranke für konsistente Vollsicherungen.
 * Sobald eine Sicherung die Schranke anfordert, werden keine neuen mutierenden
 * HTTP-Aufrufe angenommen. Bereits laufende Schreibanforderungen dürfen sauber
 * enden; erst danach startet die SQLite-/Dateibaumaufnahme.
 */

let activeWrites = 0;
let requested = false;
let active = false;
let owner = '';
const drainWaiters = new Set();
const writeContext = new AsyncLocalStorage();
const REQUEST_WRITE = Symbol('applicationRequestWrite');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/*
 * Einige OAuth-Antworten kommen protokollbedingt als GET zurück, schreiben aber
 * anschließend Tokens/Secrets in SQLite. Da diese Middleware absichtlich vor
 * den Routern sitzt, kann sie sich nicht auf Express-Routenmetadaten verlassen.
 * Die kleine Positivliste bildet deshalb nur die bekannten Callback-Semantiken
 * ab; normale GET-/HEAD-Anfragen bleiben auch während einer Sicherung lesbar.
 *
 * HEAD wird ebenfalls erfasst: Express kann eine GET-Route als HEAD-Fallback
 * ausführen, wenn keine eigene HEAD-Route registriert ist.
 */
const MUTATING_SAFE_METHOD_PATHS = Object.freeze([
  /^\/api\/admin\/calendar-connections\/oauth\/callback\/[^/]+\/?$/,
  /^\/api\/admin\/calendar-connections\/[^/]+\/available-(?:calendars|addressbooks)\/?$/,
  /^\/api\/documents\/oauth\/[^/]+\/callback\/?$/,
  /^\/api\/documents\/mounts\/[^/]+\/(?:list|file)\/?$/,
  /^\/api\/documents\/falluebergabe-zip\/?$/,
  /^\/api\/documents\/tree\/?$/,
  /^\/api\/documents\/files\/[^/]+\/versionen\/?$/,
  /^\/api\/documents\/aktivitaet\/?$/,
  /^\/api\/mailbox\/accounts\/[^/]+\/(?:folders|messages|message|attachment|raw|autoreply)\/?$/,
  /^\/api\/mailbox\/case-messages\/?$/
]);

function requestPath(req) {
  if (req && typeof req.path === 'string') return req.path;
  const raw = String(req && (req.originalUrl || req.url) || '');
  return raw.split(/[?#]/, 1)[0] || '/';
}

function isMutatingRequest(req) {
  const method = String(req && req.method || '').toUpperCase();
  if (!SAFE_METHODS.has(method)) return true;
  if (method === 'OPTIONS') return false;
  const pathname = requestPath(req);
  return MUTATING_SAFE_METHOD_PATHS.some((pattern) => pattern.test(pathname));
}

function notifyDrained() {
  if (activeWrites !== 0) return;
  for (const resolve of drainWaiters) resolve();
  drainWaiters.clear();
}

/*
 * "close" ist ausdrücklich KEIN Abschlussvertrag: Der Browser kann die
 * Verbindung schließen, während der Handler noch Dateien/SQLite ändert. Der
 * Zähler endet erst bei finish oder wenn der Handler res.end() aufruft. Das
 * eingehängte end() ist der praktische Vertrag für abgebrochene Antworten, bei
 * denen Node anschließend kein finish mehr emittiert. Asynchrone Schreibarbeit
 * nach res.end() muss als eigener withWrite()-Lauf gestartet werden.
 */
function finishOnce(req, res, done) {
  let finished = false;
  let scheduled = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    res.removeListener('finish', scheduleFinish);
    if (req && req[REQUEST_WRITE]) req[REQUEST_WRITE].released = true;
    done();
  };
  const scheduleFinish = () => {
    if (finished || scheduled) return;
    scheduled = true;
    queueMicrotask(finish);
  };
  res.once('finish', scheduleFinish);
  if (typeof res.end === 'function') {
    const originalEnd = res.end;
    res.end = function writeBarrierEnd(...args) {
      let result;
      try {
        result = originalEnd.apply(this, args);
      } finally {
        // Synchroner Code direkt nach res.end() gehört noch zum Handler.
        scheduleFinish();
      }
      return result;
    };
  }
  return scheduleFinish;
}

function middleware(req, res, next) {
  if (!isMutatingRequest(req)) return next();
  if (requested || active) {
    res.setHeader('Retry-After', '5');
    return res.status(503).json({
      error: 'Die Anwendung erstellt gerade eine konsistente Gesamtsicherung. Bitte den Schreibvorgang in wenigen Sekunden erneut ausführen.',
      code: 'backup_write_barrier'
    });
  }
  activeWrites += 1;
  const token = {
    barrier: module.exports,
    kind: 'request',
    name: `${String(req && req.method || '')} ${requestPath(req)}`.trim(),
    released: false
  };
  req[REQUEST_WRITE] = token;
  token.complete = finishOnce(req, res, () => {
    activeWrites = Math.max(0, activeWrites - 1);
    notifyDrained();
  });
  writeContext.run(token, next);
}

/*
 * Nicht jeder Schreiber läuft in einem HTTP-Request (z. B. Kalenderabruf,
 * Mail-Outbox oder Bank-Scheduler). Diese API nimmt einen solchen Lauf noch vor
 * dem ersten await atomar in denselben Zähler auf. Ist eine Sicherung bereits
 * angefordert/aktiv, startet fn gar nicht; der Aufrufer kann den Lauf anhand des
 * strukturierten Ergebnisses auf seinen nächsten Takt verschieben.
 */
async function withWrite(name, fn) {
  if (typeof fn !== 'function') throw new TypeError('withWrite benötigt eine Schreibfunktion.');
  const inherited = writeContext.getStore();
  if (inherited && inherited.barrier === module.exports && !inherited.released) {
    return {
      started: true,
      skipped: false,
      nested: true,
      value: await fn()
    };
  }
  if (requested || active) {
    return {
      started: false,
      skipped: true,
      code: 'backup_write_barrier',
      name: String(name || '').slice(0, 100)
    };
  }
  activeWrites += 1;
  const token = {
    barrier: module.exports,
    kind: 'background',
    name: String(name || '').slice(0, 100),
    released: false
  };
  try {
    return {
      started: true,
      skipped: false,
      value: await writeContext.run(token, fn)
    };
  } finally {
    token.released = true;
    activeWrites = Math.max(0, activeWrites - 1);
    notifyDrained();
  }
}

/*
 * Von einem HTTP-Handler bewusst abgekoppelte Arbeit darf dessen Request-
 * Kontext nicht erben. Sonst würde sie nach der 202-Antwort unsichtbar
 * weiterschreiben oder ein begin() auf den eigenen Request-Zähler warten.
 */
function runDetached(fn) {
  if (typeof fn !== 'function') throw new TypeError('runDetached benötigt eine Funktion.');
  return writeContext.run(null, fn);
}

function completeRequest(req) {
  const token = req && req[REQUEST_WRITE];
  if (!token || token.released || typeof token.complete !== 'function') return false;
  token.complete();
  return true;
}

async function begin(name, options) {
  if (requested || active) throw new Error('Eine Sicherungs-Schreibsperre ist bereits aktiv.');
  requested = true;
  owner = String(name || 'Gesamtsicherung').slice(0, 100);
  const timeoutMs = Math.max(1000, Number(options && options.timeoutMs) || 5 * 60 * 1000);
  if (activeWrites) {
    let timer;
    try {
      await Promise.race([
        new Promise((resolve) => drainWaiters.add(resolve)),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Laufende Schreibvorgänge wurden vor der Gesamtsicherung nicht rechtzeitig beendet.')), timeoutMs);
          if (timer.unref) timer.unref();
        })
      ]);
    } catch (error) {
      requested = false;
      owner = '';
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  active = true;
  requested = false;
  return {
    release() {
      if (!active) return;
      active = false;
      owner = '';
    }
  };
}

async function withBarrier(name, fn, options) {
  const handle = await begin(name, options);
  try {
    return await fn();
  } finally {
    handle.release();
  }
}

function status() {
  return { requested, active, activeWrites, owner };
}

function resetForTests() {
  requested = false;
  active = false;
  activeWrites = 0;
  owner = '';
  drainWaiters.clear();
}

module.exports = {
  middleware,
  begin,
  withWrite,
  withBarrier,
  runDetached,
  completeRequest,
  status,
  _test: {
    isMutatingRequest,
    requestPath,
    resetForTests,
    currentContext: () => writeContext.getStore() || null
  }
};
