// Statusanzeige des einheitlichen Einstellungsmenues (Nutzerwunsch 27.08.2026).
//
// Im Lokal-Modus traegt jeder Eintrag der Einstellungsleiste einen Indikator (gruener Haken =
// eingerichtet, grauer Punkt = noch nichts). Beim Umbau auf das Online-Menue sind die Indikatoren
// verloren gegangen. Acht davon holt sich der Client wieder ueber die BESTEHENDEN Aktualisierer
// (sie zielen per data-...-status-Attribut, das die Navigationseintraege jetzt tragen). Die
// uebrigen Bereiche brauchen Zahlen aus der Datenbank - die liefert diese eine Route, statt bei
// jedem Oeffnen des Menues ein Dutzend Einzelabfragen zu starten.
//
// RECHTE: Jedes Feld haengt an demselben Recht wie sein Bereich im Menue. Wer den Bereich nicht
// sehen darf, bekommt das Feld gar nicht erst - sonst verriete der Indikator, wie viele Nutzer
// oder Faelle das Buero hat. Fehlende Felder zeichnet der Client als neutralen Punkt.

const express = require('express');
const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');
const { requireAuth } = require('../../middleware/authentication');

const router = express.Router();
router.use(requireAuth);

/* Eine fehlende Tabelle oder ein kaputter JSON-Blob darf NIE die ganze Antwort kippen -
   ein Indikator ist Beiwerk, kein Grund fuer eine 500 auf dem Weg ins Einstellungsmenue. */
function zahl(sql, ...args) {
  try {
    const r = db.prepare(sql).get(...args);
    return r ? Number(Object.values(r)[0]) || 0 : 0;
  } catch (_e) { return null; }
}

function blob(key) {
  try {
    const r = db.prepare('SELECT data_json FROM office_json WHERE key = ?').get(key);
    return r && r.data_json ? JSON.parse(r.data_json) : null;
  } catch (_e) { return null; }
}

function laenge(wert) {
  if (Array.isArray(wert)) return wert.length;
  if (wert && typeof wert === 'object') return Object.keys(wert).length;
  return 0;
}

router.get('/', (req, res) => {
  const s = req.session || {};
  const admin = !!s.isAdmin;
  const out = {};

  /* ---- KI-Verbindung: wie viele Anbieter sind SERVERSEITIG eingerichtet ----
     Der alte Indikator data-ai-status haengt an state.ui.aiDirect.status - dem KI-Zustand des
     BROWSERS. Online wird die KI serverseitig konfiguriert, der Browser-Zustand bleibt leer,
     und der Punkt stand darum dauerhaft auf „Nicht geprueft" (am Pruefstand nachgewiesen, alle
     sechs Knoten gleichermassen). Diese Zahl sagt stattdessen, was online wirklich zaehlt.
     Kein Geheimnis: /api/my-settings verraet jedem angemeldeten Nutzer ohnehin, ob die
     Buero-Vorgabe je Bereich nutzbar konfiguriert ist. Schluessel werden NIE ausgeliefert -
     nur gezaehlt, ob einer entschluesselbar und nicht leer ist. */
  out.ki = (function () {
    try {
      let n = 0;
      for (const r of db.prepare('SELECT api_key_encrypted FROM office_ai_config').all()) {
        let klar = '';
        try { klar = cryptoHelper.decrypt(r.api_key_encrypted); } catch (_e) { klar = ''; }
        if (klar) n++;
      }
      return n;
    } catch (_e) { return null; }
  })();

  /* Davon AKTIV GEPRUEFT (Nutzerwunsch 30.08.2026): der gruene Haken verlangt einen
     erfolgreichen Verbindungstest, nicht nur einen hinterlegten Schluessel. Flags von
     Anbietern ohne (entschluesselbaren) Schluessel zaehlen nicht - ein Key-Wechsel
     loescht sein Flag ohnehin (admin/routes.js kiPruefstatusLoeschen). */
  out.kiGeprueft = (function () {
    try {
      const r = db.prepare("SELECT data_json FROM office_json WHERE key = 'ki_pruefstatus'").get();
      let flags = {};
      try { flags = (JSON.parse((r || {}).data_json || '{}') || {}).anbieter || {}; } catch (_e) { flags = {}; }
      let g = 0;
      for (const row of db.prepare('SELECT provider, api_key_encrypted FROM office_ai_config').all()) {
        let klar = '';
        try { klar = cryptoHelper.decrypt(row.api_key_encrypted); } catch (_e) { klar = ''; }
        if (klar && flags[row.provider] && flags[row.provider].ok) g++;
      }
      return g;
    } catch (_e) { return null; }
  })();

  // ---- Fuer alle: die eigenen Unterschriften (eigene + bueroweit geteilte) ----
  out.unterschriften = zahl(
    "SELECT COUNT(*) AS n FROM signatures WHERE owner_user_id = ? OR visibility = 'office'",
    s.userId
  );

  // ---- Fuer alle mit Erweiterungs-Recht: die EIGENEN, nicht widerrufenen Zugaenge ----
  if (admin || s.canUseExtension) {
    out.erweiterung = zahl(
      'SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND (revoked IS NULL OR revoked = 0)',
      s.userId
    );
  }

  /* ---- Fallzahl: nur fuer wen sie ohnehin kein Geheimnis ist ----
     canViewAllCases sieht jeden Fall des Bueros - die Zahl verraet dieser Person nichts Neues.
     Wer nur eigene Faelle sehen darf, bekommt das Feld nicht (der Client zeigt dann einen
     neutralen Punkt). Es gibt KEIN canManageCaseData in der Session - die Datenadministration
     haengt am Menuerecht menuSettingsDataAdmin, und Menuerechte kennt der Server nicht. */
  if (admin || s.canViewAllCases) {
    out.faelle = zahl('SELECT COUNT(*) AS n FROM cases');
  }

  // ---- Verarbeitungs-Log: eigenes Leserecht, unabhaengig von isAdmin ----
  if (admin || s.canViewAuditLog) out.audit = zahl('SELECT COUNT(*) AS n FROM audit_log');

  // ---- Ab hier nur Admins: die zugehoerigen Bereiche sind im Menue admin-only ----
  if (admin) {
    out.nutzer = zahl('SELECT COUNT(*) AS n FROM users WHERE active = 1');
    /* Personenregister (Etappe 1): der Menuepunkt heisst jetzt "Personen" und zaehlt ALLE
       aktiven Personen - mit Konto, ohne Konto, extern. */
    out.personen = zahl('SELECT COUNT(*) AS n FROM persons WHERE aktiv = 1');
    out.mcp = zahl('SELECT COUNT(*) AS n FROM mcp_tokens WHERE revoked IS NULL OR revoked = 0');
    out.formulare = zahl('SELECT COUNT(*) AS n FROM custom_form_templates');

    const rollen = blob('rollen');
    out.rollen = laenge(rollen && rollen.rollen);

    const vorgaben = blob('einstellungs_vorgaben');
    out.vorgaben = laenge(vorgaben && vorgaben.vorgaben);

    const vertretung = blob('vertretungsplan');
    out.vertretung = laenge(vertretung && (vertretung.eintraege || vertretung.plan || vertretung));

    /* Datenschutz gilt als gepflegt, sobald VVT oder TOM Eintraege haben - die Auskuenfte
       und Pannen sind Ereignisse, kein Einrichtungsschritt. */
    const ds = blob('datenschutz');
    out.datenschutz = laenge(ds && ds.vvt) + laenge(ds && ds.tom);

    const vs = blob('suggestion_registry');
    out.vorschlaege = laenge(vs && (vs.listen || vs.registry || vs));
  }

  /* ===== Zusatzzahlen fuer die Systemdiagnose (31.08.2026) =================================
     Die Diagnose stammte aus der Zeit, als die Software eine Ein-Personen-Anwendung mit Excel-
     und PDF-Ausgabe war: sie zeigte Programmfassung, Browser, Adressverzeichnis und den
     JSON/Excel-Sicherungsstand. Von allem, was seither dazugekommen ist - Server, Postfaecher,
     Kalenderverbindungen, Banking, Personenregister, Dokumentenspeicher -, wusste sie nichts.
     Statt dafuer ein Dutzend Einzelabfragen zu starten (der Grund, aus dem es diese Route
     ueberhaupt gibt), liefert sie die Zahlen gleich mit. Jedes Feld haengt am selben Recht wie
     sein Bereich; fehlt das Recht, fehlt das Feld, und die Diagnose schreibt einen Strich. */
  if (admin || s.canViewCases) {
    out.termine = zahl('SELECT COUNT(*) AS n FROM calendar_events');
    out.aufgaben = zahl('SELECT COUNT(*) AS n FROM todos');
  }
  if (admin || s.canViewDocuments) {
    out.dokumente = zahl('SELECT COUNT(*) AS n FROM case_documents');
  }
  if (admin || s.canViewFinance) {
    out.rechnungen = zahl('SELECT COUNT(*) AS n FROM outgoing_invoices');
    out.belege = zahl('SELECT COUNT(*) AS n FROM finance_receipts');
  }
  if (admin || s.canManageMailSettings) {
    out.mailkonten = zahl('SELECT COUNT(*) AS n FROM mail_accounts');
  }
  if (admin || s.canManageCalendarConnections) {
    out.kalenderverbindungen = zahl('SELECT COUNT(*) AS n FROM calendar_connections');
  }
  if (admin || s.canViewBankData) {
    out.bankverbindungen = zahl('SELECT COUNT(*) AS n FROM bank_connections');
  }
  /* Laeuft die naechtliche Dokumentensicherung ueberhaupt noch? Der Taktgeber schreibt seinen
     Herzschlag in doc_backup_scheduler_state; ein alter Herzschlag ist der einzige Hinweis
     darauf, dass niemand mehr sichert - und der gehoert in eine Diagnose. Admin-only, weil der
     ganze Sicherungsbereich es ist. */
  if (admin) {
    try {
      const r = db.prepare(
        'SELECT health_status, heartbeat_at, last_tick_at FROM doc_backup_scheduler_state WHERE id = 1'
      ).get();
      if (r) {
        out.sicherung = {
          status: String(r.health_status || ''),
          herzschlag: String(r.heartbeat_at || ''),
          letzterLauf: String(r.last_tick_at || '')
        };
      }
    } catch (_e) { /* Tabelle fehlt (Altbestand): Feld entfaellt, die Diagnose zeigt einen Strich */ }
  }

  res.json({ ok: true, status: out });
});

module.exports = router;
