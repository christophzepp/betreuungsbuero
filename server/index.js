// Express-App-Einstieg: dient die bestehende Single-File-HTML-App UND die neue API vom
// selben Origin aus (kein CORS noetig - siehe Plan, Abschnitt "Neue Projektstruktur").

const path = require('path');
const fs = require('fs');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const {
  OUTPUTS_ROOT,
  TEMPLATES_ROOT,
  OCR_ASSETS_ROOT
} = require('./src/config/paths');
require('./src/modules/recovery/runtime-artifact-guard').assertNoIncompleteRuntimeRestore(
  process.env.RUNTIME_ARTIFACT_RESTORE_STATE_DIR
);
const express = require('express');
const db = require('./src/database/index');
const recoveryMode = require('./src/modules/recovery/mode').ensure(db);
const writeBarrier = require('./src/middleware/application-write-barrier');
const { createSessionMiddleware, requireAuth, requireOnlineMode } = require('./src/middleware/authentication');
const authRoutes = require('./src/modules/auth/routes');
const caseRoutes = require('./src/modules/cases/routes');
const chatRoutes = require('./src/modules/chat/routes');
const demoRoutes = require('./src/modules/demo/routes');
const adminRoutes = require('./src/modules/admin/routes');
const mailSettingsRoutes = require('./src/modules/mail/settings-routes');
const mailRoutes = require('./src/modules/mail/routes');
const calendarRoutes = require('./src/modules/calendar/routes');
const todosRoutes = require('./src/modules/calendar/todo-routes');
const betreuungsuebersichtRoutes = require('./src/modules/care-overview/routes');
const controllingRoutes = require('./src/modules/controlling/routes');
const financeRoutes = require('./src/modules/finance/routes');
const invoiceRoutes = require('./src/modules/finance/invoice-routes');
const mileageRoutes = require('./src/modules/finance/mileage-routes');
const officeProfileRoutes = require('./src/modules/office/profile-routes');
const personsRoutes = require('./src/modules/office/persons-routes');
const mapSettingsRoutes = require('./src/integrations/maps/settings-routes');
const inboxRoutes = require('./src/modules/mail/inbox-routes');
const extRoutes = require('./src/integrations/extensions/routes');
const { createRealtimeServer } = require('./src/realtime/websocket');
const { startAutoSync } = require('./src/modules/sync/runner');

const PORT = Number(process.env.PORT) || 8935;
const OUTPUTS_DIR = OUTPUTS_ROOT;
const APP_FILE = process.env.APP_FILE || 'Betreuungsbuero_Dokumentenassistent_v0_7.html';
const TEMPLATES_DIR = TEMPLATES_ROOT;
const TEMPLATE_FILES = {
  stammdaten: 'Stammdaten_blank.xlsx',
  adressverzeichnis: 'Adressverzeichnis_blank.xlsx',
  // Plan Abschnitt AL: Buero-weite Vorlagen (aus der echten Buero-Excel abgeleitet, Werte geleert,
  // Formeln/Kopfzeilen/Formatierung erhalten - siehe server/assets/templates/*.xlsx-Erzeugungsskript-Notiz).
  betreuungsuebersicht: 'Betreuungsuebersicht_blank.xlsx',
  finanzen: 'Finanzen_blank.xlsx',
  ausgangsrechnungen: 'Ausgangsrechnungen_blank.xlsx',
  // Phase 5: neu erstellt (nicht 1:1 aus der Nutzerdatei kopiert wie die drei obigen) - eigenes,
  // einjaehriges Blockschema mit zusaetzlicher Erstattung-Spalte je Fahrt statt der urspruenglichen
  // Sheet-weiten Pauschalformel (siehe server/routes/mileage.js-Kommentar zur Begruendung).
  fahrtkostennachweis: 'Fahrtkostennachweis_blank.xlsx',
  // Nutzerwunsch Runde 8: eine kombinierte Excel-Datei mit allen vier Buero-Modulen als eigene
  // Sheets (Finanzen, Ausgangsrechnungen, Fahrtkostennachweis, Betreuungsuebersicht) - offline aus
  // den vier obigen Einzel-Vorlagen zusammengesetzt (Werte/Styles/Formeln je Sheet 1:1 uebernommen,
  // siehe scratchpad/build_combined_template.py), da ein Laufzeit-Merge mehrerer .xlsx-Archive
  // (unterschiedliche styles.xml-Indizes je Quelldatei) unnoetig riskant waere.
  buerverwaltung: 'Buerverwaltung_blank.xlsx',
  // Grosse Buero-Runde: kuratierte zentrale Betreuungsorganisations-Excel des Nutzers
  // (inkl. Fristen, Büro-Adressbuch, Büro-Dokumente, Qualifikationen sowie zwei Fahrtenbuch-
  // PROTOTYPEN 'Fahrtenbuch KFZ'/'Fahrtenbuch Fahrer', die der Export je Fahrzeug/Fahrer klont).
  // Blanko-Vorlage mit Layout/Formeln/Datenvalidierungen; Werte werden beim Export injiziert.
  bueroorganisation: 'Bueroorganisation_blank.xlsx'
};

const app = express();
app.disable('x-powered-by');
app.use(recoveryMode.rawGate);
app.use(writeBarrier.middleware);

// Hinter einem Reverse-Proxy/Cloudflare Tunnel noetig, damit sichere Cookies/IP-Erkennung
// korrekt funktionieren, sobald COOKIE_SECURE=1 gesetzt wird.
app.set('trust proxy', 1);

// Dokumente als Netzlaufwerk (Plan D7): eigener WebDAV-Endpunkt mit App-Passwoertern.
// BEWUSST vor express.json montiert, damit PUT-Koerper (Dateiinhalte) unangetastet bleiben.
app.use('/webdav', require('./src/integrations/storage/webdav'));

// Aufgaben-Feed als schreibarmer CalDAV-Endpunkt (PLAN-AUFGABEN-SYNC, Etappe 4): Token-URL statt
// Sitzung, eigene Koerperbehandlung (XML/ICS) - deshalb wie /webdav VOR express.json und VOR der
// Sitzungs-Middleware montiert. Auth + Schreibgrenzen liegen im Handler selbst.
app.use('/dav-feed', require('./src/modules/feeds/dav-routes'));

// Strom-Upload grosser Dateien (Nutzerauftrag 2026-07-27): der Koerper ist die ROHE Datei und
// wird direkt auf die Platte geschrieben. BEWUSST vor express.json montiert - genau wie /webdav,
// damit der Body-Parser den Strom nicht verschluckt (er wuerde ihn zwar wegen des Content-Type
// durchreichen, aber die Reihenfolge ist hier die belastbare Zusage, nicht eine Nebenwirkung).
// Die Sitzungs-Middleware wird HIER schon gebraucht, weil die globale erst weiter unten steht;
// derselbe Middleware-Aufbau wird unten wiederverwendet. Der Pfadzweig /api/documents/strom wird
// von diesem Router VOLLSTAENDIG beantwortet (Catch-all am Ende), also laeuft kein Aufruf
// zweimal durch express-session.
const sessionMiddleware = createSessionMiddleware();
if (recoveryMode.isActive()) {
  app.use('/api/documents/strom', (_req, res) => res.status(503).json({
    error: 'Der Strom-Upload ist während der geschützten Wiederherstellung gesperrt.',
    code: 'RECOVERY_MODE_ACTIVE'
  }));
} else {
  app.use(
    '/api/documents/strom',
    sessionMiddleware,
    requireOnlineMode,
    require('./src/modules/documents/stream')
  );
}

// Anlagen kommen teilweise base64-kodiert im JSON-Body (Dokumenten-Zwischenspeicher,
// Mail-Versand und Falldokumentations-Anlagen). 350mb deckt das Doku-Limit von 250MB
// plus den ~33% Base64-Overhead und JSON-Rahmen ab.
// BEWUSST NICHT weiter angehoben (2026-07-27): gemessen kostet eine 250-MB-Datei auf diesem Weg
// +1364 MB Arbeitsspeicher. Alles Grosse laeuft ueber den Strom-Upload oben.
const JSON_DECKEL = 350 * 1024 * 1024;

// Zu grosser JSON-Koerper: SOFORT ablehnen, statt ihn erst vollstaendig zu verschlucken.
// Gemessen 2026-07-27: body-parser meldet zwar sofort 413, ruft danach aber stream.resume()
// und wartet mit onFinished(req, ...) auf das ENDE der Anfrage, bevor es antwortet - der Client
// muss also erst seine vollen 400 MB hochladen, um zu erfahren, dass sie zu gross sind. Bleibt
// die angekuendigte Menge aus, haengt die Anfrage bis zur Zeitgrenze des Servers (die weiter
// unten bewusst auf 60 Minuten steht, damit 1-GB-Uploads durchkommen). Diese Vorpruefung nimmt
// beides weg: die Antwort steht nach Millisekunden, ohne ein einziges Nutzbyte zu lesen.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const len = Number(req.headers['content-length'] || 0);
  if (!len || len <= JSON_DECKEL) return next();
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return next();
  const mb = (n) => (n / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
  res.setHeader('Connection', 'close');
  res.on('finish', () => { setTimeout(() => { try { req.destroy(); } catch (_e) { /* zu ist zu */ } }, 50); });
  return res.status(413).json({
    error: `Der Upload ist zu groß für diesen Weg (Anfrage ${mb(len)}, Deckel ${mb(JSON_DECKEL)} inklusive der ~33 % Base64-Aufblähung). `
      + 'Große Dateien bitte über den Strom-Upload des Dokumente-Moduls hochladen - dort sind bis 1024 MB möglich.'
  });
});
app.use(express.json({ limit: JSON_DECKEL }));

// express.json hat keinen eigenen Fehlerweg: bei ueberschrittenem Koerperdeckel antwortete der
// Server bisher mit Express' HTML-Fehlerseite samt Stacktrace und absolutem Serverpfad - der
// Client konnte sie nicht lesen und meldete nur "Serverfehler (413)". Jetzt kommt JSON mit der
// Zahl, um die es geht. (Muster: routes/mcp.js hat dafuer schon lange einen eigenen Handler.)
app.use((err, req, res, next) => {
  if (!err || res.headersSent) return next(err);
  const status = Number(err.status || err.statusCode) || 0;
  if (status === 413 || err.type === 'entity.too.large') {
    const gr = Number(err.length || req.headers['content-length'] || 0);
    const grText = gr ? (gr / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB' : 'unbekannt groß';
    return res.status(413).json({
      error: `Der Upload ist zu groß für diesen Weg (Anfrage ${grText}, Deckel 350,0 MB inklusive der ~33 % Base64-Aufblähung). `
        + 'Große Dateien bitte über den Strom-Upload des Dokumente-Moduls hochladen - dort sind bis 1024 MB möglich.'
    });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Der Anfragekörper ist kein gültiges JSON.' });
  return next(err);
});

// Erstinbetriebnahme (Nutzerauftrag 2026-07-26): auf einer leeren Datenbank gibt es kein Konto,
// kein Buero und keine Rechte - /setup legt beides einmalig an. BEWUSST vor der Session-Middleware
// montiert: der Einrichtungsweg braucht keine Sitzung und soll auch dann erreichbar sein, wenn am
// Sitzungsspeicher etwas klemmt. Sobald der Server eingerichtet ist, liefern die Routen nur noch
// eine Hinweisseite bzw. 409 - siehe routes/setup.js (dreifach abgesicherte, dauerhafte Sperre).
const setupRoutes = require('./src/modules/admin/setup-routes');
app.use(setupRoutes);

app.use(sessionMiddleware);
app.use('/api', recoveryMode.apiGate);

app.use('/api', authRoutes);
// Login, /me, Passwortwechsel und bewusster Moduswechsel liegen oberhalb.
// Alle folgenden Fach-/Dokument-APIs sind verbindlich Onlinefunktionen; eine
// local-Session darf sie nicht durch direkte HTTP-Aufrufe erreichen.
/* Demo-Modus (30.08.2026): /api/demo/paket bedient gerade NICHT-Online-Sitzungen
   (mode='demo') und muss deshalb VOR der Online-Schranke haengen; die Schalter-Routen
   pruefen selbst streng (Online-Admin). */
app.use('/api/demo', demoRoutes);
/* Formularvorlagen ebenfalls VOR der Schranke (Nutzerentscheid 30.08.2026): Die Route
   liefert ausschliesslich BLANKO-Vorlagen aus der Auslieferungsdatei - keinerlei Fall- oder
   Personendaten - und verlangt weiterhin eine Anmeldung (requireAuth). Ohne sie scheiterte
   in der Vorfuehrung jeder amtliche PDF-Export mit 403, also genau der Arbeitsschritt, um
   den es in dieser Software geht. Die eigentliche Handler-Definition steht weiter unten
   (slimDelivery); deshalb hier nur die Weiterleitung an sie, sobald sie existiert. */
app.get('/api/pdf-vorlagen/:elementId', requireAuth, (req, res, next) => slimDelivery.vorlagenHandler(req, res, next));
app.use('/api', requireOnlineMode);
// Verarbeitungs-Log (Nutzerwunsch 25.08.2026): protokolliert jede erfolgreiche veraendernde
// Anfrage bueroweit (Aenderungen + Weitergaben, keine Lesezugriffe) - siehe middleware/audit.js.
app.use('/api', require('./src/middleware/audit').verarbeitungsLog());
// Webhook-Wecker (PLAN-AUFGABEN-SYNC, Etappe 3): sitzungslos, abgesichert ueber das je Verbindung
// hinterlegte Secret (HMAC oder ?s=). requireOnlineMode laesst sitzungslose Anfragen durch;
// der Endpunkt loest nur einen Abgleich aus und schreibt selbst keine Nutzdaten.
app.use('/api/sync-hooks', require('./src/modules/sync/hook-routes'));
app.use('/api/cases', caseRoutes);
// mailSettingsRoutes VOR adminRoutes mounten: beide teilen sich das '/api/admin'-Praefix, aber
// mailSettingsRoutes nutzt die permissivere requireMailSettings-Middleware (isAdmin ODER
// can_manage_mail_settings) statt adminRoutes' striktem requireAdmin - muss die /smtp-config*-Pfade
// daher zuerst abfangen, sonst wuerde adminRoutes' requireAdmin nicht-admin-aber-berechtigte
// Nutzer vorher aussperren.
app.use('/api/admin', mailSettingsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/send-mail', mailRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/todos', todosRoutes);
app.use('/api/betreuungsuebersicht', betreuungsuebersichtRoutes);
app.use('/api/controlling', controllingRoutes);
app.use('/api/finance', financeRoutes);
// Banking ueber Hibiscus Payment Server (2026-07-26): Routen + zeitgesteuerter Umsatzabruf.
const bankRoutes = require('./src/modules/finance/bank-routes');
app.use('/api/bank', bankRoutes);
if (!recoveryMode.isActive()) bankRoutes.startScheduler();
// MCP-Fernzugriff (2026-07-26, PLAN-MCP-Server.md): OAuth-2.1-Endpunkte (well-known/register/
// authorize/token) liegen bewusst auf App-Ebene ausserhalb von /api - Clients erwarten sie an
// der Wurzel. /mcp ist der eigentliche Werkzeug-Endpunkt (Bearer-geschuetzt, Not-Aus im Admin).
// Im Recovery-Modus werden die Module gar nicht erst geladen: mcp-oauth besitzt einen
// Bereinigungstimer, der sonst trotz gesperrter HTTP-Routen in die quarantänisierte DB schreiben
// würde. Das vorgeschaltete rawGate beantwortet diese Pfade dann geschlossen mit 503.
if (!recoveryMode.isActive()) {
  app.use(require('./src/integrations/mcp/oauth-routes'));
  app.use(require('./src/integrations/mcp/routes'));
}
app.use('/api/invoices', invoiceRoutes);
app.use('/api/mileage', mileageRoutes);
app.use('/api/office-profile', officeProfileRoutes);
// Personenregister (Etappe 1, 29.08.2026): EINE Liste fuer Nutzer, Mitarbeitende ohne Konto
// und externe Personen - siehe persons-routes.js.
app.use('/api/persons', personsRoutes);
// Büroweite (fallübergreifende) Kontakte - geteiltes Büro-Adressbuch (Nutzerwunsch). Eigener Speicher
// office_contacts, damit büro-eigene Kontakte nutzer-/geräteübergreifend geteilt sind (statt localStorage).
app.use('/api/office-contacts', require('./src/modules/office/contact-routes'));
app.use('/api/office-json', require('./src/modules/office/json-routes'));
app.use('/api/ai-relay', require('./src/integrations/ai/routes'));
// Datei-Zwischenspeicher des gefuehrten Fallbeginns (bis zum Abschluss des Laufs; siehe Route).
app.use('/api/intake-files', require('./src/modules/cases/intake-file-routes'));
// PDF-Vordrucke selbst gebauter Formulare (Formulareditor): eigene Bytes-Ablage neben der
// custom_forms-Definition in office_json (5-MB-PDF je Vordruck; Bytes gehoeren nicht in den JSON-Deckel).
app.use('/api/formular-vorlagen', require('./src/modules/office/form-template-routes'));
// Unterschriften je Nutzer (privat oder bueroweit geteilt) - loest die eine fest einkodierte
// SIGNATURE_DATA im Client ab (Nutzerwunsch).
app.use('/api/signatures', require('./src/modules/documents/signature-routes'));
app.use('/api/map-settings', mapSettingsRoutes);
// Multi-User-Zugangsdaten (Nutzerwunsch): Selbstbedienung eigener Overrides je Einstellungsbereich
// (KI/Versand/Mail/Karten) - Status + Setzen/Zuruecksetzen, jeweils rechte-gegatet (siehe Route).
app.use('/api/my-settings', require('./src/modules/settings/my-settings-routes'));
// Kleine benutzerbezogene Oberflaechenzustaende, derzeit die Mehrfachfilter der Falluebersicht.
app.use('/api/user-prefs', require('./src/modules/settings/user-preference-routes'));
// Indikator-Zahlen fuer die Navigation des einheitlichen Einstellungsmenues (27.08.2026).
app.use('/api/einstellungen-status', require('./src/modules/settings/status-routes'));
// Nutzer-zu-Nutzer-Chat (Nutzerwunsch 2026-08-12): büro-interner Chat für alle Konten
// (requireAuth genügt, kein eigenes Rechte-Flag). Echtzeit-Zustellung siehe setRealtime unten.
app.use('/api/chat', chatRoutes);
app.use('/api/inbox', inboxRoutes);
// E-Mail-Baustein (Postfach: Konten/Ordner/Nachrichten/Versand/Entwuerfe), Nutzerwunsch 2026-07-18.
if (recoveryMode.isActive()) {
  app.use('/api/mailbox', (_req, res) => res.status(503).json({
    error: 'Postfachdienste sind während der geschützten Wiederherstellung gesperrt.',
    code: 'RECOVERY_MODE_ACTIVE'
  }));
} else {
  app.use('/api/mailbox', require('./src/modules/mail/mailbox-routes'));
}
// Online-Formulare: session-authentifizierte Verwaltung der trainierten Site-Profile (dieselbe
// Tabelle wie die Extension-Bearer-Route, hier fuer das App-Modul "Online-Formulare").
app.use('/api/site-profiles', require('./src/integrations/extensions/site-profile-routes'));
// Browser-Extension "Formular-Assistent" (Plan Abschnitt BR, Phase E1): Bearer-Token-Fassade
// (/api/ext) + Session-basierte Token-Verwaltung (/api/ext-tokens, in der App bedient).
// CORS fuer /api/ext/*: Extension-SEITEN (Panel/Options, moz-extension:// bzw. chrome-extension://)
// rufen diese Endpunkte cross-origin auf. Chrome umgeht CORS ueber host_permissions automatisch,
// FIREFOX-Extension-Seiten jedoch NICHT zuverlaessig -> hier explizite CORS-Header. Auth laeuft
// per Bearer-Token (KEINE Cookies), daher ist Allow-Origin:* unbedenklich (keine Credentials).
// Muss VOR extRoutes stehen, damit der OPTIONS-Preflight nicht in die Auth-Middleware (401) laeuft.
app.use('/api/ext', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api/ext', extRoutes);
app.use('/api/ext-tokens', extRoutes.tokensRouter);
// Ablage/Auslieferung der installierbaren Erweiterungs-Pakete pro Browser (Admin hinterlegt, jeder
// eingeloggte Nutzer installiert über „Erweiterungs-Zugänge").
app.use('/api/ext-artifacts', require('./src/integrations/extensions/artifact-routes'));
// Super-Productivity-Plugin „Betreuungsbüro Sync" (Nutzerwunsch 30.08.2026): wird aus dem
// mitgelieferten Quellordner sp-plugin/ frisch gepackt und in den Einstellungen unter
// „Browser-Erweiterung" zum Download angeboten - es nutzt dieselben API-Tokens wie die Erweiterung.
app.use('/api/sp-plugin', require('./src/integrations/sp-plugin/routes'));
// Dokumente-Modul (Plan D1, Nutzerauftrag 2026-07-25): zentraler Dokumentenspeicher mit virtuellem
// Ordnerbaum, Blobs unter runtime/data/files/, Papierkorb, Volltext-Index und Anmerkungen.
app.use('/api/documents', require('./src/modules/documents/routes'));

// Eingebettete PDF-Originalvorlagen einzeln ausliefern (PDF-Umbauplan Phase 2): die App-Datei
// kommt vom Server ohne die ~56 MB Vorlagen-Bloecke (siehe app-slim-delivery.js weiter unten);
// der Client holt eine Vorlage erst im Exportmoment ueber diese Route nach.
const { createSlimDelivery } = require('./src/app-slim-delivery');
const slimDelivery = createSlimDelivery(path.join(OUTPUTS_DIR, APP_FILE));
/* Die Route steht oben VOR der Online-Schranke (siehe dort) - hier bleibt nur der Verweis,
   damit die Reihenfolge beim Lesen nicht überrascht. */

// Leere Excel-Vorlagen fuer den Backup-/Migrations-Fluss im Online-Modus (siehe Plan
// "Phase 2.1.1", Abschnitt "Datenmodell" - statische Dateien, nicht pro Fall).
app.get('/api/templates/:kind', requireAuth, (req, res) => {
  const filename = TEMPLATE_FILES[req.params.kind];
  if (!filename) return res.status(400).json({ error: 'Unbekannte Vorlage.' });
  const filePath = path.join(TEMPLATES_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Vorlage nicht gefunden.' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('X-Filename', encodeURIComponent(filename));
  fs.createReadStream(filePath).pipe(res);
});

// OCR-/PDF-Bausteine vom EIGENEN Server (Nutzerentscheid 2026-07-17): tesseract.js + Worker +
// WASM-Kerne + deu/eng-Sprachdaten + pdf.js - statt Dritt-CDNs (jsdelivr/cdnjs/projectnaptha).
// Version fest eingepinnt (tesseract.js 5.1.1 / core 5.1.1 / tessdata 4.0.0 / pdf.js 3.11.174);
// Updates BEWUSST nur zusammen mit Software-Updates, nie automatisch (reproduzierbare OCR!).
// Lange Cache-Zeit ist richtig: die Dateien aendern sich nur mit einem neuen Einpinnen.
app.use('/ocr-assets', express.static(OCR_ASSETS_ROOT, {
  setHeaders(res) { res.setHeader('Cache-Control', 'public, max-age=2592000'); }
}));

// Weiche zur Ersteinrichtung - erst HIER, hinter allen /api-Routen: ein noch nicht eingerichteter
// Server schickt Seitenaufrufe nach /setup, laesst API-Aufrufe aber unveraendert (401 bleibt 401).
// Ist der Server eingerichtet, gibt die Weiche sofort ab und aendert gar nichts.
app.use(setupRoutes.guard);

// Sicherungs- und Arbeitskopien duerfen NIE oeffentlich ausgeliefert werden (PDF-Umbauplan
// Phase 1.1, 13.08.2026): alte .bak-Fassungen der App-Datei trugen eingebettete
// Zugangsdaten-Bloecke und waren ueber express.static frei abrufbar. Die Dateien liegen jetzt
// in server/backups/app-datei/; dieser Guard verhindert, dass kuenftig abgelegte Kopien
// (.bak/.tmp/~ u. ae.) wieder oeffentlich werden.
app.use((req, res, next) => {
  if (/\.(bak|tmp|orig|old|swp)$|~$/i.test(req.path)) return res.status(404).end();
  next();
});

// Schlanke Auslieferung der App-Datei (PDF-Umbauplan Phase 2): die Vorlagen-Bloecke werden
// beim Ausliefern geleert (~15 statt 70 MB); die Datei auf der Platte bleibt unveraendert
// (file://-Lokalmodus, Pruefstaende, Backups). Einzelvorlagen: /api/pdf-vorlagen/:elementId.
app.get(['/', `/${APP_FILE}`], slimDelivery.appHandler);

app.use(
  express.static(OUTPUTS_DIR, {
    index: APP_FILE,
    setHeaders(res) {
      // Waehrend der Entwicklung nicht aggressiv cachen, damit Aenderungen an der HTML-Datei
      // sofort sichtbar sind. no-cache erlaubt Conditional GET: express.static liefert
      // ETag/Last-Modified, unveraenderte Dateien kommen als 304 statt als 70-MB-Volltransfer.
      res.setHeader('Cache-Control', 'no-cache');
    }
  })
);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

const httpServer = http.createServer(app);
/* Zeitgrenze fuer eine ganze Anfrage (Nutzerauftrag 2026-07-27). Node bricht sonst nach
   requestTimeout = 300000 ms ab: gemessen braucht ein 100-MB-Upload dafuer mindestens
   3,7 Mbit/s Upstream - eine 1-GB-Datei waere auf gewoehnlichem DSL chancenlos und der Nutzer
   saehe nach fuenf Minuten "Serverfehler (408)" mit LEEREM Antwortkoerper. Jetzt 60 Minuten
   (per REQUEST_TIMEOUT_MS anpassbar, 0 = aus).
   headersTimeout bleibt bei 60 s - DAS ist der eigentliche Slowloris-Schutz: der KOPF muss
   schnell da sein, der Koerper darf dauern. */
httpServer.requestTimeout = process.env.REQUEST_TIMEOUT_MS === undefined ? 60 * 60 * 1000 : Number(process.env.REQUEST_TIMEOUT_MS);
httpServer.headersTimeout = 60 * 1000;
const realtime = recoveryMode.isActive()
  ? {
    broadcastToCase() { /* Quarantäne: kein WebSocket-Dienst. */ },
    // Nutzerchat (Nutzerwunsch 2026-08-12): dieselbe Quarantäne-Attrappe für die drei
    // Chat-Methoden, sonst stürzte der Recovery-Modus beim ersten Chat-Aufruf ab.
    sendToUsers() { /* Quarantäne: kein WebSocket-Dienst. */ },
    broadcastChatPresence() { /* Quarantäne: kein WebSocket-Dienst. */ },
    onlineUserIds() { return new Set(); }
  }
  : createRealtimeServer(httpServer);
caseRoutes.setRealtime(realtime);
chatRoutes.setRealtime(realtime);

httpServer.listen(PORT, () => {
  console.log(`Betreuungsbuero-Server laeuft auf http://localhost:${PORT}`);
  console.log(`App-Datei: ${path.join(OUTPUTS_DIR, APP_FILE)}`);
  // Automatischer Kalender/Aufgaben-Abgleich (Nutzerwunsch: Minutentakt) - zieht Aenderungen, die
  // extern (Nextcloud/Handy/Outlook) gemacht wurden, ohne manuellen "Synchronisieren"-Klick herein.
  // Intervall per CALENDAR_SYNC_INTERVAL_SECONDS anpassbar (0 = aus), Standard 60s.
  if (recoveryMode.isActive()) {
    console.warn('[Recovery] Geschützter Wiederherstellungsmodus aktiv: Hintergrundjobs, '
      + 'Integrationen, WebDAV und Fach-APIs bleiben bis zur geprüften Freigabe und einem Neustart gesperrt.');
  } else {
    startAutoSync();
    // Automatische Sicherung des Dokumentenspeichers (Plan D8): Minutentakt ueber doc_backup_jobs.
    require('./src/modules/backup/document-backup').start();
    // Automatisch gepflegte, ohne die Software lesbare Fall-/Büroabbilder. Die
    // Generatoren laufen ausschließlich serverseitig im Onlinebetrieb.
    require('./src/modules/documents/materializations').start({
      db,
      documents: require('./src/modules/documents/routes').intern
    });
    // Konfigurierbarer nächtlicher Plattenabgleich (Schnell-/Vollprüfung).
    require('./src/modules/documents/maintenance').start({
      db,
      documents: require('./src/modules/documents/routes').intern
    });
  }
});
