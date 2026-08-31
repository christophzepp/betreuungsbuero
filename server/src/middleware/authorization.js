// Rechteverwaltung-Neuaufbau (Plan Abschnitt AV): jedes inhaltliche Recht existiert getrennt fuer
// den Lokal- und den Online-Modus (users.permissions_json = {"local":{...},"online":{...}}).
// Die alten Einzelspalten (can_view_cases, ...) bleiben als Fallback-Quelle bestehen - beim ersten
// Serverstart nach dem Update werden sie einmalig in BEIDE Modus-Zweige uebernommen (bisherige
// Semantik war modusunabhaengig, Verhalten von Bestandsnutzern aendert sich dadurch nicht).
// is_admin ist bewusst KEIN Eintrag in dieser Matrix: Admins haben per Definition IMMER alle
// Rechte in BEIDEN Modi (jede Pruefstelle prueft isAdmin zuerst, siehe auth.js/effektive Flags in
// routes/auth.js) - ein abschaltbares Admin-Teilrecht waere ein Widerspruch in sich.

// Katalog: key -> {legacy: Spaltenname in users (null = neues Recht ohne Altspalte),
//                  default: Startwert fuer neue Nutzer/fehlende Eintraege}
const PERMISSION_DEFS = {
  viewCases:                { legacy: 'can_view_cases', default: true },
  editCases:                { legacy: 'can_edit_cases', default: true },
  caseManagement:           { legacy: 'allow_case_management', default: false },
  viewDocuments:            { legacy: 'can_view_documents', default: true },
  editDocuments:            { legacy: 'can_edit_documents', default: true },
  viewFinance:              { legacy: 'can_view_finance', default: true },
  editFinance:              { legacy: 'can_edit_finance', default: true },
  manageMailSettings:       { legacy: 'can_manage_mail_settings', default: false },
  manageOfficeProfile:      { legacy: 'can_manage_office_profile', default: false },
  manageMapSettings:        { legacy: 'can_manage_map_settings', default: false },
  // Neue Rechte (Plan Abschnitt AV, per Rueckfrage bestaetigt):
  // manageCredentials: darf Admin-Vorgaben fuer Zugangsdaten/API-Keys (KI + Versandkonten) mit
  // EIGENEN Werten ueberschreiben (Lokal-Modus-Praezedenzlogik) bzw. online eigene Werte pflegen.
  manageCredentials:        { legacy: null, default: false },
  // manageCalendarConnections: CalDAV/Google/Microsoft-Kalenderverbindungen einrichten (bisher admin-only).
  manageCalendarConnections:{ legacy: null, default: false },
  // approveMileage: eingereichte Fahrten anderer pruefen/genehmigen/ablehnen/auszahlen (bisher admin-only).
  approveMileage:           { legacy: null, default: false },
  // viewAuditLog: Lesezugriff auf das Admin-Protokoll ohne vollen Admin-Zugang.
  viewAuditLog:             { legacy: null, default: false },
  // Rechte-Audit 2026-07-17 (Nutzerwunsch): KI-Bausteine (Chats, Posteingang-KI, Intake/Outtake,
  // Erweiterungs-KI) pro Nutzer abschaltbar - Kosten-/Datenschutzkontrolle. Default AN, damit sich
  // fuer Bestandsnutzer nichts aendert (gleiches Muster wie view/edit-Rechte).
  useAi:                    { legacy: null, default: true },
  // Dokumente: alle Fallakten sehen (aus = nur Faelle, bei denen die Person als
  // rechtlicher Betreuer in den Stammdaten steht; Bueroorganisation bleibt sichtbar).
  docsAllCases:             { legacy: null, default: true },
  // viewAllCases (2026-07-26): alle Fallakten des Bueros sehen. AUS = nur eigene Faelle
  // (cases.owner_user_id) plus ausdruecklich freigegebene (case_access) plus Faelle ohne
  // Eigentuemer. Default AUS - mit Default AN waere die Sperre wirkungslos. Admins sowieso alles.
  viewAllCases:             { legacy: null, default: false },
  // sendMail: E-Mail-/Fax-Versand ueber die Buerokonten (/api/send-mail). Bisher reichte Login -
  // damit konnten auch Nur-Lese-Nutzer versenden. Default AN (kein Verhaltensbruch).
  sendMail:                 { legacy: null, default: true },
  // useFieldService: Außendienstpakete erzeugen/importieren. Getrennt vom Menue-Recht, damit ein
  // Nutzer den Eintrag auch sichtbar haben kann, ohne die Funktion wirklich ausfuehren zu duerfen.
  useFieldService:          { legacy: null, default: true },
  // useExtension: Browser-Erweiterung/Formular-Assistent nutzen. Getrennt von useAi, weil die
  // Erweiterung auch reine Formular-/Falldatenfunktionen ohne KI hat.
  useExtension:             { legacy: null, default: true },
  // viewAllQualifications (Qualifikationsmanager, 2026-07-21): darf ALLE Qualifikationseintraege
  // sehen (sonst nur den eigenen). Admins sowieso alle. Default AUS (Delegationsrecht wie approveMileage).
  viewAllQualifications:    { legacy: null, default: false },
  // financePersonNames (Etappe 3, 29.08.2026): Personalkosten-Posten tragen ein Personen-Feld;
  // OHNE dieses Recht liefert der Server statt Name+ID nur die Kennung ("MA 1") - die
  // Gehaltszuordnung bleibt pseudonym. Setzen/AEndern des Feldes verlangt das Recht ebenfalls
  // (wer zuordnet, kennt die Zuordnung). Admins haben es immer.
  financePersonNames:       { legacy: null, default: false },
  // Banking ueber Hibiscus (2026-07-26): drei getrennte Rechte, weil Sehen, Verwalten und
  // ZAHLEN drei verschiedene Gefahrenstufen sind. viewBankData default AN (wie viewFinance -
  // es gibt noch keine Bankdaten, also kein Verhaltensbruch; die Fallrechte begrenzen ohnehin
  // auf sichtbare Faelle). manageBankConnections = Gateway-Zugang/Konten verwalten
  // (Delegationsrecht wie manageCalendarConnections, default AUS). initiatePayments =
  // Ueberweisungen anlegen/freigeben/einreichen - das gefaehrlichste Recht der ganzen Matrix,
  // default AUS und ausdruecklich zu vergeben.
  viewBankData:             { legacy: null, default: true },
  manageBankConnections:    { legacy: null, default: false },
  initiatePayments:         { legacy: null, default: false },
  // viewControlling (2026-08-25): eigener Reiter "Controlling". Er fuehrt zwei Dinge zusammen, die
  // das Programm sonst bewusst getrennt haelt: Geld (Verguetungssummen je Fall) und Fallidentitaeten
  // (welcher Betreuer fuehrt welche Faelle). Eine UND-Verknuepfung aus viewFinance + viewAllCases
  // waere zwar naheliegend, haette aber jeden Finanzsachbearbeiter automatisch zum Mitleser der
  // Fallverteilung gemacht - und umgekehrt. Der Nutzer hat sich deshalb am 25.08.2026 ausdruecklich
  // fuer ein eigenes, frei vergebbares Recht entschieden: default AUS, jeder ausser dem Admin
  // (hasPermission laesst is_admin vorbei) braucht es ausdruecklich zugeteilt.
  viewControlling:          { legacy: null, default: false },

  // Menue-Rechte (2026-07-24): steuern Sichtbarkeit und Aufrufbarkeit der linken App-Menues.
  // Default AN, damit Bestandsnutzer nach dem Update keine Menues verlieren.
  menuDashboard:            { legacy: null, default: true },
  menuStammdaten:           { legacy: null, default: true },
  menuAiCase:               { legacy: null, default: true },
  menuDocumentation:        { legacy: null, default: true },
  menuCalendar:             { legacy: null, default: true },
  menuTasks:                { legacy: null, default: true },
  menuDeadlines:            { legacy: null, default: true },
  menuEmail:                { legacy: null, default: true },
  menuAddressbook:          { legacy: null, default: true },
  menuCaseFile:             { legacy: null, default: true },
  menuCaseFileArchive:      { legacy: null, default: true },
  menuCaseFileSendHistory:  { legacy: null, default: true },
  menuCaseFileCash:         { legacy: null, default: true },
  menuCaseFileAssets:       { legacy: null, default: true },
  menuCaseFileLivelihood:   { legacy: null, default: true },
  menuCaseFileDebtRegulation:{ legacy: null, default: true },
  menuCaseFileHousing:      { legacy: null, default: true },
  menuCaseFileHealth:       { legacy: null, default: true },
  menuCaseFileApprovals:    { legacy: null, default: true },
  menuCaseFileFolderGenerator:{ legacy: null, default: true },
  menuCaseOrganization:     { legacy: null, default: true },
  menuCaseOrgCases:         { legacy: null, default: true },
  menuCaseOrgArchive:       { legacy: null, default: true },
  menuCaseOrgOverview:      { legacy: null, default: true },
  menuCaseOrgContactMonitor:{ legacy: null, default: true },
  menuCaseOrgIntake:        { legacy: null, default: true },
  menuCaseOrgOuttake:       { legacy: null, default: true },
  menuOfficeOrganization:   { legacy: null, default: true },
  menuOfficeInbox:          { legacy: null, default: true },
  menuOfficeOnlineForms:    { legacy: null, default: true },
  menuOfficeFinance:        { legacy: null, default: true },
  menuOfficeInvoices:       { legacy: null, default: true },
  menuOfficeMileage:        { legacy: null, default: true },
  menuOfficeQualifications: { legacy: null, default: true },
  menuBackup:               { legacy: null, default: true },
  menuSettings:             { legacy: null, default: true },
  menuSettingsDataAdmin:    { legacy: null, default: true },
  menuSettingsOfficeProfile:{ legacy: null, default: true },
  menuSettingsSendAccounts: { legacy: null, default: true },
  menuSettingsMail:         { legacy: null, default: true },
  menuSettingsCalendarContacts:{ legacy: null, default: true },
  menuSettingsMaps:         { legacy: null, default: true },
  menuSettingsAi:           { legacy: null, default: true },
  menuSettingsSystem:       { legacy: null, default: true },
  menuAdmin:                { legacy: null, default: true },
  menuAdminPanel:           { legacy: null, default: true },
  menuAdminModeSwitch:      { legacy: null, default: true },
  menuAdminFieldService:    { legacy: null, default: true },
  menuAdminPassword:        { legacy: null, default: true },
  menuAdminMySettings:      { legacy: null, default: true },
  menuAdminExtensionTokens: { legacy: null, default: true },
  // 2026-07-26 nachgetragen (Audit): diese drei Menuepunkte hatten als einzige KEIN eigenes
  // Sichtbarkeitsrecht. Datei-Explorer ist seit dem Umbau ein eigener Hauptmenuepunkt und war
  // dadurch auch nicht mehr ueber die Fallakte-Gruppe abgedeckt.
  menuFileExplorer:         { legacy: null, default: true },
  menuCaseFileGoalPlanning: { legacy: null, default: true },
  menuSettingsFileExplorer: { legacy: null, default: true },
  menuCaseFileBanking:      { legacy: null, default: true },
  menuSettingsBanking:      { legacy: null, default: true },
  menuAdminLogout:          { legacy: null, default: true }
};

const PERMISSION_KEYS = Object.keys(PERMISSION_DEFS);
const MODES = ['local', 'online'];

// Baut einen vollstaendigen Modus-Zweig: fehlende/unbekannte Schluessel werden auf den
// Katalog-Default bzw. (falls vorhanden) die Altspalte des Nutzers zurueckgefuehrt.
//
// SICHERHEIT (Audit 2026-07-26, Befund B1c): Die Pruefung lautete frueher "key in branch". Der
// in-Operator sucht AUCH auf der Prototypenkette. Ein einziger Eintrag auf Object.prototype -
// wie ihn die Pfad-Luecke in mcp-tools.js/routes/cases.js erzeugen konnte - galt damit als
// gesetztes Recht fuer JEDEN Nutzer, in beiden Modi, prozessweit bis zum Serverneustart. Das war
// die Stelle, die aus einem Schreibfehler eine Rechteausweitung machte. hasOwnProperty.call sieht
// nur EIGENE Eigenschaften des tatsaechlich gespeicherten permissions_json und ist fuer normale
// Daten byte-identisch im Ergebnis (JSON.parse legt alle Schluessel als eigene Eigenschaften an).
const eigen = (o, k) => Object.prototype.hasOwnProperty.call(Object(o), k);

function normalizeBranch(branch, userRow) {
  const out = {};
  for (const key of PERMISSION_KEYS) {
    const def = PERMISSION_DEFS[key];
    if (branch && typeof branch === 'object' && eigen(branch, key)) {
      out[key] = !!branch[key];
    } else if (def.legacy && userRow && userRow[def.legacy] != null) {
      out[key] = !!userRow[def.legacy];
    } else {
      out[key] = def.default;
    }
  }
  return out;
}

// Liest die effektive {local,online}-Matrix eines users-Datensatzes: permissions_json falls
// vorhanden (fehlende Schluessel werden aufgefuellt), sonst vollstaendig aus den Altspalten.
function parseUserPermissions(userRow) {
  let parsed = null;
  if (userRow && userRow.permissions_json) {
    try { parsed = JSON.parse(userRow.permissions_json); } catch (_e) { parsed = null; }
  }
  return {
    local: normalizeBranch(parsed && parsed.local, userRow),
    online: normalizeBranch(parsed && parsed.online, userRow)
  };
}

// Effektives Recht: Admin schlaegt alles, sonst der Modus-Zweig.
function hasPermission(userRow, mode, key) {
  if (!userRow) return false;
  if (userRow.is_admin) return true;
  const perms = parseUserPermissions(userRow);
  const branch = perms[MODES.includes(mode) ? mode : 'online'];
  return !!branch[key];
}

// Normalisiert eine vom Client geschickte Matrix (z.B. aus dem Admin-Formular) zu einem
// speicherbaren JSON-String - unbekannte Schluessel werden verworfen, fehlende mit den
// Katalog-Defaults aufgefuellt (userRow=null: reine Defaults, fuer Neuanlage).
function serializePermissions(input, userRow) {
  const matrix = {
    local: normalizeBranch(input && input.local, userRow),
    online: normalizeBranch(input && input.online, userRow)
  };
  return JSON.stringify(matrix);
}

module.exports = { PERMISSION_DEFS, PERMISSION_KEYS, MODES, parseUserPermissions, hasPermission, serializePermissions, normalizeBranch };
