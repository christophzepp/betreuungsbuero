// Audit-Log fuer administrative Aktionen (Phase 2.2). Bewusst NUR fuer echte Admin-/Fallverwaltungs-
// Vorgaenge gedacht (Nutzer-/Zugangsdaten-/Fall-Verwaltung), NICHT fuer laufende Fallbearbeitung
// (Stammdaten-/Berichts-/Falldokumentations-/Kontakt-Patches) - siehe Plan "Phase 2.2".

const db = require('../database/index');

const insertStmt = db.prepare(`
  INSERT INTO audit_log (actor_user_id, actor_username, action, target_type, target_id, details_json,
                         case_id, kategorie, zweck, empfaenger, kanal)
  VALUES (@actorUserId, @actorUsername, @action, @targetType, @targetId, @detailsJson,
          @caseId, @kategorie, @zweck, @empfaenger, @kanal)
`);

/* Akteur aus allen Zugangswegen: Sitzung (Oberflaeche), Erweiterungs-Token (req.extUser) und
   - falls vorhanden - Fernzugriff. Ohne das blieben Schreibvorgaenge der Browser-Erweiterung und
   des MCP-Fernzugriffs ohne jede Protokollzeile. */
function akteur(req) {
  if (req && req.session && req.session.userId) {
    return { id: req.session.userId, name: req.session.displayName || '' };
  }
  if (req && req.extUser && req.extUser.id) {
    return { id: req.extUser.id, name: (req.extUser.displayName || req.extUser.username || '') + ' (Erweiterung)' };
  }
  if (req && req.mcpUser && req.mcpUser.id) {
    return { id: req.mcpUser.id, name: (req.mcpUser.displayName || '') + ' (Fernzugriff)' };
  }
  return null;
}

function logAction(req, action, targetType, targetId, details, verarbeitung) {
  const wer = akteur(req);
  /* Rueckfallebene fuer die 54 Altaufrufe: ohne sie blieben genau die neuen DSGVO-Spalten leer. */
  const v = verarbeitung || ableiten(req);
  const row = {
    actorUserId: (wer && wer.id) || null,
    actorUsername: (wer && wer.name) || '',
    action,
    targetType: targetType || '',
    targetId: String(targetId || ''),
    detailsJson: JSON.stringify(details || {}),
    caseId: String(v.caseId || (targetType === 'case' ? targetId : '') || ''),
    kategorie: String(v.kategorie || ''),
    zweck: String(v.zweck || ''),
    empfaenger: String(v.empfaenger || ''),
    kanal: String(v.kanal || '')
  };
  try {
    if (req) req.__auditGeschrieben = true;   // die Sammel-Middleware haelt sich dann zurueck
    insertStmt.run(row);
  } catch (error) {
    // Ein Security-Restore kann den gerade handelnden alten Admin bewusst aus
    // der wiederhergestellten Nutzerliste entfernen. Der Klarname im
    // unveränderlichen Audit-Eintrag bleibt erhalten; nur die nun ungültige
    // Fremdschlüsselreferenz wird in diesem eng begrenzten Fall neutralisiert.
    if (row.actorUserId != null && /FOREIGN KEY constraint failed/i.test(String(error && error.message || error))) {
      try {
        insertStmt.run({ ...row, actorUserId: null });
        return;
      } catch (retryError) {
        console.error('Audit-Log fehlgeschlagen', retryError);
        return;
      }
    }
    console.error('Audit-Log fehlgeschlagen', error);
  }
}

/* ══════════════ Verarbeitungs-Log (bueroweit, Nutzerwunsch 25.08.2026) ══════════════
   Statt 54 Einzelaufrufe zu vervielfachen, protokolliert EINE Middleware jede ERFOLGREICHE
   veraendernde Anfrage. Bewusste Grenzen (Nutzerentscheidung "Aenderungen + Weitergaben"):
     - nur POST/PUT/PATCH/DELETE, keine Lesezugriffe (GET) -> ~50-200 Zeilen/Tag statt 5.000+
     - nur Statuscode < 400 (ein abgelehnter Versuch ist kein Verarbeitungsvorgang; Fehlversuche
       bei der Anmeldung protokolliert der Auth-Zweig gesondert)
     - kein Koerperinhalt: es wird NIE gespeichert, WAS geaendert wurde (das Log darf nicht selbst
       zur Zweitkopie der Falldaten werden), nur Weg, Zweck und Bezug.
   Doppelschreib-Schutz: Routen, die schon logAction() rufen, setzen req.__auditGeschrieben. */

/* Weg der Weitergabe je Pfadmuster - bestimmt zugleich kategorie='offenlegung'. */
const WEITERGABE = [
  [/^\/api\/mail(x)?\//, 'mail'], [/\/send(-|$|\/)/, 'mail'], [/^\/api\/simple-fax\//, 'fax'],
  [/^\/api\/ebo\//, 'ebo'], [/\/export(-|$|\/)/, 'export'], [/^\/api\/handover/, 'export'],
  [/^\/api\/backup/, 'export'],
];
const ZWECK = [
  [/^\/api\/(cases|case-|reports|documents|doc-|contacts|calendar|todos|fristen)/, 'betreuungsfuehrung'],
  /* Korrespondenz und Fallübergabe dienen der Betreuungsfuehrung, nicht der Bueroverwaltung. */
  [/^\/api\/(mail|mailx|simple-fax|ebo|handover)/, 'betreuungsfuehrung'],
  /* Fallbezogene Blobs des bueroweiten JSON-Speichers dienen der Betreuungsfuehrung. */
  [/^\/api\/office-json\/(case_intakes|case_outtakes|kontaktmonitor|mailx_case_links|aussendienst_ledger)/, 'betreuungsfuehrung'],
  [/^\/api\/(finance|invoices|banking|accounting)/, 'abrechnung'],
  [/^\/api\/(admin|users|office|settings|auth)(?=\/|$)/, 'verwaltung'],
];
const FALL_MUSTER = /\/api\/(?:cases|case-[a-z-]+)\/([A-Za-z0-9-]{6,})/;

function ersteTreffer(liste, pfad, standard) {
  for (const [muster, wert] of liste) if (muster.test(pfad)) return wert;
  return standard;
}

/* Einordnung eines Vorgangs aus Methode und Pfad - gemeinsam genutzt von der Sammel-Middleware
   und (als Rueckfallebene) von den vorhandenen logAction-Aufrufen. */
function ableiten(req) {
  try {
    if (!req || !req.method) return {};
    const pfad = String(req.originalUrl || req.url || '').split('?')[0];
    if (!pfad) return {};
    const methode = String(req.method).toUpperCase();
    const kanal = ersteTreffer(WEITERGABE, pfad, '');
    const treffer = FALL_MUSTER.exec(pfad);
    return {
      caseId: (treffer && treffer[1]) || String((req.body && req.body.caseId) || ''),
      kategorie: kanal ? 'offenlegung' : (methode === 'DELETE' ? 'loeschung' : (methode === 'GET' ? 'zugriff' : 'aenderung')),
      zweck: ersteTreffer(ZWECK, pfad, 'verwaltung'),
      empfaenger: kanal ? String((req.body && (req.body.to || req.body.empfaenger || req.body.recipient)) || '') : '',
      kanal,
    };
  } catch (_error) { return {}; }
}

/* Laufende Fallbearbeitung tippt im Sekundentakt (Autosave ~600 ms). Diese Pfade werden
   ENTPRELLT: ein Eintrag je Nutzer+Fall+Pfad und Stunde. Ohne das entstuenden tausende
   Zeilen taeglich statt der geplanten Groessenordnung - und das Protokoll waere unlesbar. */
const ENTPRELLT = [
  /^\/api\/cases\/[^/]+\/(stammdaten|reports|doku-entries|contacts)(\/|$)/,
  /^\/api\/office-json\//,
];
const entprellSpeicher = new Map();
function entprellen(schluessel) {
  const jetzt = Date.now();
  const letzte = entprellSpeicher.get(schluessel) || 0;
  if (jetzt - letzte < 3600000) return false;           // innerhalb der Stunde: nicht erneut schreiben
  entprellSpeicher.set(schluessel, jetzt);
  if (entprellSpeicher.size > 5000) {                    // einfache Obergrenze gegen unbegrenztes Wachstum
    for (const [k, t] of entprellSpeicher) if (jetzt - t > 3600000) entprellSpeicher.delete(k);
  }
  return true;
}

function verarbeitungsLog() {
  return (req, res, next) => {
    const methode = String(req.method || '').toUpperCase();
    if (methode === 'GET' || methode === 'HEAD' || methode === 'OPTIONS') return next();
    let geschrieben = false;
    const schreiben = () => {
      if (geschrieben) return;
      geschrieben = true;
      try {
        if (res.statusCode >= 400) return;                 // nur erfolgreiche Vorgaenge
        if (req.__auditGeschrieben) return;                // Route hat selbst protokolliert
        const wer = akteur(req);
        if (!wer) return;                                   // ohne erkennbaren Akteur nichts schreiben
        const pfad = String(req.originalUrl || req.url || '').split('?')[0];
        /* Laufende Fallbearbeitung entprellen (siehe ENTPRELLT) - sonst flutet der Autosave-Takt. */
        if (ENTPRELLT.some((m) => m.test(pfad))) {
          const v0 = ableiten(req);
          if (!entprellen(wer.id + '|' + (v0.caseId || '') + '|' + pfad)) return;
          return logAction(req, methode + ' ' + pfad, 'route', '', { entprellt: 'ein Eintrag je Stunde' }, v0);
        }
        logAction(req, methode + ' ' + pfad, 'route', '', {}, ableiten(req));
      } catch (_error) { /* Protokollieren darf die Anfrage nie stoeren */ }
    };
    res.on('finish', schreiben);
    /* Abgebrochene oder gestreamte Antworten erreichen 'finish' nicht immer - end() umhuellen. */
    const endeOriginal = res.end;
    res.end = function (...args) { const r = endeOriginal.apply(this, args); try { schreiben(); } catch (_e) {} return r; };
    next();
  };
}

module.exports = { logAction, verarbeitungsLog };
