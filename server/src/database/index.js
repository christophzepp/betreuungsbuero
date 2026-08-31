// Datenbank-Zugriff: SQLite ist ab Phase 2.1.1 die massgebliche Datenquelle fuer Faelle im
// Online-Modus (Stammdaten, Berichte, Falldokumentation), nicht mehr nur Index/Koordination.
// Excel/JSON dienen nur noch als Migrations-/Backup-Format (siehe Plan
// "Phase 2.1.1: Online-Modus auf Datenbank + Echtzeit-Sync umstellen, Admin-Panel").

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { DATABASE_PATH, configuredPath } = require('../config/paths');

// Tests and maintenance tools can select an isolated database after the shared
// path module was loaded. Resolve the environment override at database-open
// time to preserve that isolation while retaining the central fallback.
const DB_PATH = configuredPath(process.env.DB_PATH, DATABASE_PATH);
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    allow_local INTEGER NOT NULL DEFAULT 1,
    allow_online INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    allow_case_management INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    file_number TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id),
    stammdaten_json TEXT NOT NULL DEFAULT '{}',
    stammdaten_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    stammdaten_updated_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS case_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL REFERENCES cases(id),
    report_id TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id),
    UNIQUE(case_id, report_id)
  );

  CREATE TABLE IF NOT EXISTS case_doku_entries (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id),
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS case_contacts (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id),
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );

  -- Büroweite (fallübergreifende) Kontakte (Nutzerwunsch: geteiltes Büro-Adressbuch). Analog zu
  -- case_contacts (ein JSON-Blob pro Kontakt), aber OHNE case_id - diese Kontakte gehören dem Büro
  -- und sind für alle Nutzer sichtbar. Ersetzt den bisher rein clientseitigen localStorage-Speicher
  -- der büro-eigenen Kontakte, damit sie geräte-/nutzerübergreifend geteilt werden.
  CREATE TABLE IF NOT EXISTS office_contacts (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );

  -- Generischer büroweiter JSON-Speicher (Nutzerwunsch 2026-07-17): geteilte, fallübergreifende
  -- Client-Zustände, für die keine eigene Tabelle lohnt - je Schlüssel EIN JSON-Blob. Erste Nutzer:
  -- 'ai_chats' (Verläufe der KI-Fallbesprechungen/Dokument-Interviews), 'case_intakes' und
  -- 'case_outtakes' (Zwischenstände + abgeschlossene Läufe der Fallbeginn-/Fallabschluss-
  -- Assistenten). Schlüssel-Whitelist in routes/office-json.js.
  CREATE TABLE IF NOT EXISTS office_json (
    key TEXT PRIMARY KEY,
    data_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );

  -- Datei-Zwischenspeicher des gefuehrten Fallbeginns (Nutzerwunsch 2026-07-18): die im Intake
  -- hochgeladenen Original-Dateien liegen bis zum Abschluss des Laufs auf dem Server, damit ein
  -- Zwischenstand JEDERZEIT exakt fortgesetzt werden kann (Datei-Bytes reisen nicht im
  -- office_json-Zwischenstand mit - dessen 15-MB-Deckel ist fuer Zustaende, nicht fuer Akten).
  CREATE TABLE IF NOT EXISTS intake_files (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_intake_files_draft ON intake_files(draft_id);

  -- Hochgeladene PDF-Vordrucke zu selbst gebauten Formularen (Formulareditor, 24.08.2026):
  -- eine Vorlage je Formular-id. Bytes gehoeren NICHT in office_json['custom_forms'] (15-MB-Deckel,
  -- Zustaende statt Akten) - eigene Bytes-Ablage nach dem Muster von intake_files. Nur der
  -- Bruttoinhalt (BLOB); alles Anzeigerelevante steht in der custom_forms-Definition.
  CREATE TABLE IF NOT EXISTS custom_form_templates (
    form_id    TEXT PRIMARY KEY,
    file_name  TEXT NOT NULL DEFAULT 'vordruck.pdf',
    mime_type  TEXT NOT NULL DEFAULT 'application/pdf',
    size       INTEGER NOT NULL DEFAULT 0,
    data       BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );

  -- Unterschriften (Nutzerwunsch): mehrere hochladbare Signaturbilder statt der einen fest im Client
  -- einkodierten SIGNATURE_DATA. Sichtbarkeit nach demselben Muster wie calendar_connections:
  -- owner_user_id = wem sie gehoert; visibility 'private' = nur der Eigentuemer sieht/nutzt sie,
  -- 'public' = bueroweit fuer alle berechtigten Nutzer. Durchgesetzt wird das in routes/signatures.js
  -- (Liste + Zugriff: visibility='public' ODER owner_user_id = ich).
  -- data_url = vollstaendige data:image/...;base64-URL (wie SIGNATURE_DATA bisher), damit Editor und
  -- PDF-Export sie unveraendert einsetzen koennen; Groesse serverseitig begrenzt (siehe Route).
  CREATE TABLE IF NOT EXISTS signatures (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL DEFAULT '',
    data_url TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );

  -- Phase 6: Dokumenten-Zwischenspeicher fuer den Mail-Editor im Sendemenue (siehe Plan Abschnitt Z)
  -- - im Online-Modus sollen generierte Berichte/Anlagen serverseitig je Fall verfuegbar bleiben,
  -- damit der Mail-Editor sie auch in einer spaeteren Sitzung automatisch anbieten kann, ohne dass
  -- der Nutzer sie erneut hochladen muss. Nur Metadaten hier - die eigentlichen Bytes liegen als
  -- Datei unter runtime/data/case-documents/<caseId>/<id>-<dateiname> (siehe server/index.js), nicht
  -- in SQLite, um die Datenbankdatei klein zu halten.
  CREATE TABLE IF NOT EXISTS case_documents (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id),
    filename TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    report_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER REFERENCES users(id),
    actor_username TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS office_ai_config (
    provider TEXT PRIMARY KEY,
    api_key_encrypted TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    endpoint TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS office_send_credentials (
    service TEXT PRIMARY KEY,
    username TEXT NOT NULL DEFAULT '',
    password_encrypted TEXT NOT NULL DEFAULT '',
    login_url TEXT NOT NULL DEFAULT '',
    inbox_url TEXT NOT NULL DEFAULT '',
    compose_url TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Phase 5: Mail-Engine fuer "Passwort vergessen" (siehe Plan Abschnitt Q) - eine einzige,
  -- buerobezogene SMTP-Konfiguration (kein Konto pro Nutzer), daher Singleton-Zeile per
  -- CHECK(id = 1) statt einer Nutzer-/Provider-Fremdschluessel-Spalte.
  CREATE TABLE IF NOT EXISTS smtp_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    host TEXT NOT NULL DEFAULT '',
    port INTEGER NOT NULL DEFAULT 587,
    secure INTEGER NOT NULL DEFAULT 0,
    username TEXT NOT NULL DEFAULT '',
    password_encrypted TEXT NOT NULL DEFAULT '',
    from_address TEXT NOT NULL DEFAULT '',
    admin_recipient TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Phase 7: Kalender + Aufgabenverwaltung (siehe Plan Abschnitt AB) - Termine/Aufgaben sind
  -- buerobezogen sichtbar (wie Faelle), nicht privat je Nutzer, da sie sich meist auf einen
  -- Betreuungsfall beziehen und im Team geteilt werden sollen. "source" unterscheidet lokal
  -- angelegte/importierte Eintraege von per CalDAV aus Nextcloud gespiegelten (external_uid+
  -- external_href fuer PUT-Updates zurueck an Nextcloud, external_etag fuer Aenderungserkennung
  -- beim naechsten Sync-Lauf).
  CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'local',
    external_uid TEXT NOT NULL DEFAULT '',
    external_href TEXT NOT NULL DEFAULT '',
    external_etag TEXT NOT NULL DEFAULT '',
    case_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_at);


  CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    due_at TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0,
    priority TEXT NOT NULL DEFAULT 'normal',
    source TEXT NOT NULL DEFAULT 'local',
    external_uid TEXT NOT NULL DEFAULT '',
    external_href TEXT NOT NULL DEFAULT '',
    external_etag TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(due_at);

  -- Alte Singleton-CalDAV-Verbindung (nur Nextcloud) - abgeloest durch calendar_connections unten
  -- (Plan Abschnitt AE, "mehrere Kalenderverbindungen gleichzeitig"). Tabelle bleibt bestehen (keine
  -- destruktive Migration), eine ggf. vorhandene Zeile wird beim Start einmalig nach
  -- calendar_connections uebernommen (siehe migrateLegacyCaldavConfig() unten), der Code liest
  -- diese Tabelle danach nicht mehr.
  CREATE TABLE IF NOT EXISTS caldav_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL DEFAULT '',
    password_encrypted TEXT NOT NULL DEFAULT '',
    calendar_url TEXT NOT NULL DEFAULT '',
    todo_url TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Buerobezogene Kalenderverbindungen (Plan Abschnitt AE) - MEHRERE gleichzeitig aktive
  -- Verbindungen ueber verschiedene Anbieter hinweg (Nutzerentscheidung: "wie im urspruenglichen
  -- Wunsch beschrieben - Nextcloud UND z.B. Outlook gleichzeitig, in einem gemeinsamen Kalender
  -- zusammengefuehrt"), daher eine echte Tabelle statt eines Singletons wie zuvor.
  -- provider: 'nextcloud' | 'icloud' | 'google' | 'microsoft'.
  -- CalDAV-Anbieter (nextcloud/icloud) nutzen username/password_encrypted/calendar_url/todo_url
  -- (Basic Auth, siehe caldav.js - beide sprechen Standard-CalDAV nach RFC 4791).
  -- OAuth-Anbieter (google/microsoft) nutzen client_id/client_secret_encrypted (pro Verbindung, da
  -- theoretisch unterschiedliche Cloud-Projekte moeglich sind) sowie die nach dem Autorisierungs-
  -- Handshake gespeicherten access_token_encrypted/refresh_token_encrypted/token_expires_at.
  -- calendar_id/task_list_id speichern die vom Admin nach dem Verbinden ausgewaehlte konkrete
  -- Google-/Microsoft-Kalender- bzw. Aufgabenlisten-ID (ein Konto kann mehrere Kalender haben).
  CREATE TABLE IF NOT EXISTS calendar_connections (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    username TEXT NOT NULL DEFAULT '',
    password_encrypted TEXT NOT NULL DEFAULT '',
    calendar_url TEXT NOT NULL DEFAULT '',
    todo_url TEXT NOT NULL DEFAULT '',
    client_id TEXT NOT NULL DEFAULT '',
    client_secret_encrypted TEXT NOT NULL DEFAULT '',
    access_token_encrypted TEXT NOT NULL DEFAULT '',
    refresh_token_encrypted TEXT NOT NULL DEFAULT '',
    token_expires_at TEXT NOT NULL DEFAULT '',
    calendar_id TEXT NOT NULL DEFAULT '',
    task_list_id TEXT NOT NULL DEFAULT '',
    account_label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Nutzerwunsch Runde 11: buero-weite Stammdaten (Firmenname/Ansprechpartner/Adresse/Kontakt/
  -- Bankverbindungen/Logo), dynamisch im Briefkopf und in der App-Marke (Sidebar-Logo, Login-Hero)
  -- genutzt statt der bisher fest einprogrammierten OFFICE-Konstante im Client. Singleton wie
  -- smtp_config (CHECK(id=1)) - es gibt nur EIN Buero. maps_api_key_encrypted liegt hier statt in
  -- einer eigenen Tabelle, da es sich um einen einzigen buero-weiten Schluessel handelt (fuer die
  -- Fahrtkostennachweis-Entfernungsberechnung, siehe routes/mileage.js).
  CREATE TABLE IF NOT EXISTS office_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    company_name TEXT NOT NULL DEFAULT '',
    salutation TEXT NOT NULL DEFAULT '',
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    street TEXT NOT NULL DEFAULT '',
    postal_code TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    mobile TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    fax TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    tax_number TEXT NOT NULL DEFAULT '',
    vat_id TEXT NOT NULL DEFAULT '',
    logo_filename TEXT NOT NULL DEFAULT '',
    logo_mime_type TEXT NOT NULL DEFAULT '',
    maps_api_key_encrypted TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 1:n Kindtabellen (mehrere Bankverbindungen/Mitarbeitende moeglich) - eigene Tabelle statt
  -- JSON-Spalte, damit einzelne Zeilen unabhaengig angelegt/geloescht werden koennen (gleiches
  -- Muster wie z.B. private_vehicles/mileage_trips).
  CREATE TABLE IF NOT EXISTS office_bank_accounts (
    id TEXT PRIMARY KEY,
    bank_name TEXT NOT NULL DEFAULT '',
    iban TEXT NOT NULL DEFAULT '',
    bic TEXT NOT NULL DEFAULT '',
    account_holder TEXT NOT NULL DEFAULT '',
    account_type TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Nutzerwunsch Runde 12: Karten-/Navigationseinstellungen (Entfernungsberechnung, Adress-
  -- vervollstaendigung) aus den Buerostammdaten herausgeloest in ein eigenes, buero-weites Singleton
  -- (gleiches CHECK(id=1)-Muster wie office_profile/smtp_config) - mehrere Kartenanbieter zur Auswahl
  -- (Google Maps, OpenStreetMap/OSRM ohne Schluessel, HERE), active_provider legt fest, welcher davon
  -- fuer Entfernungsberechnung/Adressvervollstaendigung tatsaechlich verwendet wird.
  CREATE TABLE IF NOT EXISTS map_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    active_provider TEXT NOT NULL DEFAULT 'osm',
    google_maps_api_key_encrypted TEXT NOT NULL DEFAULT '',
    here_api_key_encrypted TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Phase 4: granulare Content-Rechte je Nutzer (Fälle/Dokumente getrennt nach Ansehen/Bearbeiten -
// siehe Plan "Phase 4", Abschnitt K). `CREATE TABLE IF NOT EXISTS` legt diese Spalten bei einer
// bereits bestehenden users-Tabelle NICHT nachtraeglich an, daher hier eine idempotente
// ALTER-TABLE-Nachruestung. Default 1 (erlaubt), damit bereits bestehende Online-Nutzer nach dem
// Update nicht unbeabsichtigt ausgesperrt werden - Einschraenkung ist ab jetzt Admin-Opt-out, nicht
// impliziter Opt-in.
function addColumnIfMissing(table, column, ddl) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (existing.includes(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;   /* true = in DIESEM Lauf angelegt (fuer einmalige Datenmigrationen) */
}
/* Verarbeitungsverzeichnis (Nutzerwunsch 25.08.2026): das bestehende audit_log wird zum
   bueroweiten Verarbeitungs-Log erweitert, statt ein zweites Protokoll danebenzustellen (es haengt
   bereits in Vollsicherung, Recht viewAuditLog, Admin-Tab und CSV-Export). Alle Spalten additiv
   mit Default - Altzeilen bleiben gueltig.
     kategorie  aenderung|loeschung|offenlegung|zugriff|verwaltung  (Art der Verarbeitung)
     zweck      betreuungsfuehrung|abrechnung|verwaltung|it-betrieb (Zweckbindung, Art. 30 DSGVO)
     empfaenger nur bei kategorie='offenlegung': an wen die Daten gingen
     kanal      mail|fax|ebo|export|druck|api                        (Weg der Weitergabe) */

addColumnIfMissing('audit_log', 'case_id', "case_id TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('audit_log', 'kategorie', "kategorie TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('audit_log', 'zweck', "zweck TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('audit_log', 'empfaenger', "empfaenger TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('audit_log', 'kanal', "kanal TEXT NOT NULL DEFAULT ''");
/* Ohne Index ist die Admin-Liste ein Full-Table-Scan mit Sortierung; mit dem Verarbeitungs-Log
   waechst die Tabelle deutlich schneller als bisher (~3 Zeilen/Tag). */
db.exec("CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_audit_log_case ON audit_log(case_id)");

addColumnIfMissing('users', 'can_view_cases', 'can_view_cases INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('users', 'can_edit_cases', 'can_edit_cases INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('users', 'can_view_documents', 'can_view_documents INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('users', 'can_edit_documents', 'can_edit_documents INTEGER NOT NULL DEFAULT 1');
// Plan Abschnitt AL, Phase 3: Finanzen enthaelt Klarnamen-Gehaltsdaten (Geschaeftsgeheimnis) - eigene,
// von Fallverwaltung/Dokumenten UNABHAENGIGE granulare Berechtigung (nicht an can_view_cases/
// can_edit_cases gekoppelt), Default 1 aus demselben "kein unbeabsichtigtes Aussperren"-Grund wie oben.
addColumnIfMissing('users', 'can_view_finance', 'can_view_finance INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('users', 'can_edit_finance', 'can_edit_finance INTEGER NOT NULL DEFAULT 1');
// Nutzerwunsch: Admins (immer) und einzelne freigeschaltete Nutzer sollen per Button im
// Nutzer-Menü zwischen Lokal- und Online-Modus wechseln koennen, ohne sich neu anzumelden. Default
// 0 (nicht erlaubt) - im Unterschied zu den Content-Rechten oben ist das eine neue Faehigkeit, kein
// bestehendes Verhalten, das nicht unbeabsichtigt eingeschraenkt werden darf.
addColumnIfMissing('users', 'allow_mode_switch', 'allow_mode_switch INTEGER NOT NULL DEFAULT 0');
// Nutzerwunsch: die Mail-Einstellungen (bisher nur im Admin-Menue) sollen im Verbindungs-Untermenue
// auch fuer einzelne, vom Admin freigeschaltete Nutzer erreichbar sein, ohne vollen Admin-Zugang zu
// gewaehren. Default 0 aus demselben Grund wie bei allow_mode_switch - eine neue Faehigkeit, kein
// bestehendes Verhalten.
addColumnIfMissing('users', 'can_manage_mail_settings', 'can_manage_mail_settings INTEGER NOT NULL DEFAULT 0');
// Nutzerwunsch Runde 11 Nachtrag: der eigenstaendige Seitenleisten-Editor fuer Buerostammdaten
// (siehe office-profile-shortcut-script-v1) soll nicht nur Admins, sondern auch einzelnen vom Admin
// freigeschalteten Nutzern echtes Bearbeiten erlauben - alle anderen sehen dort nur eine
// schreibgeschuetzte Ansicht. Gleiches Default-0-Muster wie can_manage_mail_settings.
addColumnIfMissing('users', 'can_manage_office_profile', 'can_manage_office_profile INTEGER NOT NULL DEFAULT 0');
// Nutzerwunsch Runde 12: Karten-/Navigationseinstellungen sind jetzt ein eigenstaendiges Modul
// (siehe map_settings-Tabelle oben), braucht daher eine eigene, unabhaengige Bearbeiten-Berechtigung
// - gleiches Default-0-Delegationsmuster wie can_manage_office_profile/can_manage_mail_settings.
addColumnIfMissing('users', 'can_manage_map_settings', 'can_manage_map_settings INTEGER NOT NULL DEFAULT 0');
// Nutzerwunsch Runde 12: separate Vorname/Nachname-Felder (bisher gab es nur den freien
// display_name) - noetig fuer die neue Fahrer-Auswahl im Fahrtkostennachweis, die Mitarbeitende
// als "Vorname Nachname" auflisten soll statt des ggf. abweichend formatierten Anzeigenamens.
addColumnIfMissing('users', 'first_name', "first_name TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('users', 'last_name', "last_name TEXT NOT NULL DEFAULT ''");

// Plan Abschnitt AV (Admin-Panel-Grossumbau, per Rueckfrage bestaetigt): erweiterte
// Nutzerprofil-Stammdaten. Alle optional - kein Feld erzwingt eine Neuanlage-Pflicht.
addColumnIfMissing('users', 'salutation', "salutation TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('users', 'email', "email TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('users', 'phone', "phone TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('users', 'mobile', "mobile TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('users', 'job_title', "job_title TEXT NOT NULL DEFAULT ''");
// Kuerzel (2-3 Buchstaben, z. B. CZ/MZ/RZ wie in den echten Fahrtenbuch-Blattnamen) - fuer
// Dokument-/Fahrten-Zuordnungen und kompakte Anzeigen.
addColumnIfMissing('users', 'initials', "initials TEXT NOT NULL DEFAULT ''");
// Mitarbeiterkennung (Nutzerwunsch): festes Muster "MA 1", "MA 2", ... - macht Nutzer/Mitarbeitende
// mit den Finanzen-Posten ("Gehalt MA 1", "Arbeitgeberanteil GSV MA 1") und der Buero-Excel
// (Bürostammdaten-Blatt, Spalte "Mitarbeiterkürzel") abgleichbar.
addColumnIfMissing('users', 'ma_kennung', "ma_kennung TEXT NOT NULL DEFAULT ''");
// office_employees ist seit Etappe 4 (30.08.2026) abgebaut - die Rolle uebernimmt `persons`
// (extra_json lebt dort weiter). Die Bestandsuebernahme unten liest die Alt-Tabelle nur noch,
// FALLS sie in einer Bestands-Datenbank existiert, und loescht sie danach endgueltig.
// HINWEIS: die Nachruestspalten fuer private_vehicles/mileage_trips (note/halter_name/fahrer_name)
// stehen NACH deren CREATE TABLE weiter unten - ein addColumnIfMissing vor der Tabellenerzeugung
// wuerde auf einer frischen Datenbank crashen (beim Roundtrip-Test mit leerer DB gefunden).
addColumnIfMissing('users', 'joined_at', "joined_at TEXT NOT NULL DEFAULT ''");
// Austrittsdatum (Nutzerwunsch nach Abschnitt AV) - rein informativ; die Anmeldesperre laeuft
// weiterhin ausschliesslich ueber `active` (bewusst kein automatisches Sperren am Austrittstag).
addColumnIfMissing('users', 'left_at', "left_at TEXT NOT NULL DEFAULT ''");
// Nur fuer Admins sichtbares Freitext-Notizfeld (publicUser() liefert es NUR ueber die
// Admin-Nutzerverwaltung aus, nicht ueber /api/me - siehe routes/admin.js vs. routes/auth.js).
addColumnIfMissing('users', 'notes', "notes TEXT NOT NULL DEFAULT ''");
// Deaktivieren statt Loeschen: Login gesperrt (siehe routes/auth.js), alle Historie/Zuordnungen
// (updated_by, Fahrten, Audit-Log) bleiben erhalten. Default 1 = aktiv.
addColumnIfMissing('users', 'active', 'active INTEGER NOT NULL DEFAULT 1');
// Persoenliche Farbe aus der Client-Kalenderpalette (CAL_EVENT_COLORS) - leerer String = keine.
addColumnIfMissing('users', 'calendar_color', "calendar_color TEXT NOT NULL DEFAULT ''");

// Plan Abschnitt AV: Rechte-Matrix {local:{...},online:{...}} als JSON (siehe permissions.js fuer
// den Katalog). NULL = noch nie gesetzt -> wird unten einmalig aus den Altspalten befuellt.
addColumnIfMissing('users', 'permissions_json', 'permissions_json TEXT');

// Einmalige, idempotente Uebernahme der Alt-Rechtespalten in die neue Matrix: nur fuer Zeilen, die
// noch KEIN permissions_json haben (laeuft bei jedem Start, tut nach der ersten Uebernahme nichts
// mehr; neue Nutzer bekommen ihr JSON direkt beim Anlegen). Beide Modus-Zweige erhalten dieselben
// Werte - die bisherige Rechte-Semantik war modusunabhaengig, Bestandsnutzer verhalten sich also
// exakt wie vor dem Umbau, bis ein Admin gezielt je Modus differenziert.
(function migrateLegacyPermissionsOnce() {
  const { serializePermissions } = require('../middleware/authorization');
  const rows = db.prepare('SELECT * FROM users WHERE permissions_json IS NULL').all();
  if (!rows.length) return;
  const update = db.prepare('UPDATE users SET permissions_json = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const row of rows) update.run(serializePermissions(null, row), row.id);
  });
  tx();
})();

// Plan Abschnitt AV: Admin-VORGABEN fuer den Lokal-Modus je Einstellungsbereich ('ai', 'send',
// 'maps', 'office', 'mail'). Bewusst eine generische Key-Value-Tabelle statt einer mode-Spalte in
// jeder der fuenf bestehenden Konfigtabellen (die haetten alle einen PK-Umbau = Tabellen-Neuaufbau
// in SQLite gebraucht): die Online-Konfiguration bleibt die echte Betriebskonfiguration in ihren
// bisherigen Tabellen, die Lokal-Seite ist reine "Vorgabe", die beim Lokal-Login an den Client
// ausgeliefert wird (siehe decryptedLocalDefaults() in routes/auth.js). Wert als komplettes,
// verschluesseltes JSON (kann API-Keys/Passwoerter enthalten - gleiche AES-256-GCM-Verschluesselung
// wie die uebrigen Zugangsdaten, siehe crypto.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS local_mode_defaults (
    area TEXT PRIMARY KEY,
    value_encrypted TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );
`);

// Multi-User-Zugangsdaten (Nutzerwunsch): pro Nutzer und Bereich eine EIGENE Übersteuerung der
// bueroweiten Admin-Vorgaben. Standard ist immer die Admin-Vorgabe (die bestehenden office_*-Tabellen);
// ein Nutzer MIT der jeweiligen Berechtigung (manageCredentials fuer ai/send, manageMailSettings fuer
// smtp, manageMapSettings fuer maps) kann hier einen eigenen Wert hinterlegen, der dann NUR fuer ihn
// gilt. Loescht er ihn wieder (bzw. schaltet auf "Admin-Vorgabe"), faellt er automatisch auf die
// Admin-Vorgabe zurueck. Wert = komplettes, verschluesseltes JSON (AES-256-GCM wie die uebrigen
// Zugangsdaten, siehe crypto.js) - gleiche Form wie local_mode_defaults, aber pro (user_id, area).
db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings_overrides (
    user_id INTEGER NOT NULL REFERENCES users(id),
    area TEXT NOT NULL,
    value_encrypted TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, area)
  );
`);

// Einmalige Datenuebernahme: der Google-Maps-Schluessel lag bisher in office_profile (Buerostamm-
// daten) - jetzt, wo Karteneinstellungen ein eigenes Modul sind, wird ein dort bereits gesetzter
// Schluessel genau EINMAL nach map_settings uebernommen (nicht geloescht in office_profile, das waere
// eine riskante ALTER TABLE DROP COLUMN auf SQLite - der alte Wert bleibt einfach ungenutzt liegen).
(function migrateLegacyMapsKeyOnce() {
  const officeRow = db.prepare('SELECT maps_api_key_encrypted FROM office_profile WHERE id = 1').get();
  if (!officeRow || !officeRow.maps_api_key_encrypted) return;
  const mapRow = db.prepare('SELECT google_maps_api_key_encrypted FROM map_settings WHERE id = 1').get();
  if (mapRow && mapRow.google_maps_api_key_encrypted) return;
  db.prepare(`
    INSERT INTO map_settings (id, active_provider, google_maps_api_key_encrypted)
    VALUES (1, 'google', @key)
    ON CONFLICT(id) DO UPDATE SET active_provider = 'google', google_maps_api_key_encrypted = excluded.google_maps_api_key_encrypted
  `).run({ key: officeRow.maps_api_key_encrypted });
})();

// Plan Abschnitt AE: Termine/Aufgaben merken sich jetzt, aus WELCHER Kalenderverbindung sie
// gespiegelt wurden (statt nur des generischen "source"-Textlabels) - noetig, sobald mehrere
// Verbindungen gleichzeitig aktiv sein koennen, damit ein Sync-Lauf einer Verbindung nicht die von
// einer ANDEREN Verbindung gespiegelten Eintraege faelschlich als "verwaist" entfernt.
addColumnIfMissing('calendar_events', 'connection_id', 'connection_id TEXT REFERENCES calendar_connections(id)');
addColumnIfMissing('todos', 'connection_id', 'connection_id TEXT REFERENCES calendar_connections(id)');

// Nutzerwunsch: Serientermine/wiederkehrende Aufgaben. recurrence_rule ist eine JSON-Zeichenkette
// {freq:'daily'|'weekly'|'monthly'|'yearly', interval, until, count} oder leer ('' = kein
// Wiederholungstermin) - bewusst KEIN RRULE-String, da die eigentliche Wiederholungs-Expansion rein
// clientseitig fuer die Anzeige passiert (siehe calendar-todo-script-v1, expandCalendarEvents()) und
// ein einfaches JSON-Objekt dafuer direkter nutzbar ist als ein RFC5545-RRULE-String. Seit dem
// Serientermin-Sync (server/recurrence.js) wird dieses Modell beim Push/Pull in die drei externen
// Wiederholungs-Datenformate uebersetzt (RFC5545-RRULE bei CalDAV UND Google, Microsoft-Graph-
// recurrence-Objekt) und zurueck - Serientermine werden also mitsynchronisiert.
// start_at (nur todos) ist ein optionales "Bearbeitungsstart"-Datum, getrennt von due_at (Faellig).
addColumnIfMissing('calendar_events', 'recurrence_rule', "recurrence_rule TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('todos', 'recurrence_rule', "recurrence_rule TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('todos', 'start_at', "start_at TEXT NOT NULL DEFAULT ''");

// Fallzuordnung für Termine/Aufgaben: case_id ist die belastbare Zuordnung,
// case_label bleibt als Anzeige- und Altbestandsfeld erhalten. Ein Label wird
// nur dann einmalig nachgezogen, wenn es exakt einen Fall damit gibt.
addColumnIfMissing('calendar_events', 'case_label', "case_label TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('todos', 'case_label', "case_label TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('calendar_events', 'case_id', "case_id TEXT NOT NULL DEFAULT ''");
db.exec(`
  UPDATE calendar_events
     SET case_id = (
       SELECT MIN(id) FROM cases WHERE cases.label = calendar_events.case_label
     )
   WHERE case_id = ''
     AND case_label != ''
     AND (
       SELECT COUNT(*) FROM cases WHERE cases.label = calendar_events.case_label
     ) = 1;
  CREATE INDEX IF NOT EXISTS idx_calendar_events_case_id ON calendar_events(case_id);
  CREATE TRIGGER IF NOT EXISTS calendar_events_case_id_from_unique_label_insert
  AFTER INSERT ON calendar_events
  WHEN NEW.case_id = ''
   AND NEW.case_label != ''
   AND (SELECT COUNT(*) FROM cases WHERE cases.label = NEW.case_label) = 1
  BEGIN
    UPDATE calendar_events
       SET case_id = (SELECT MIN(id) FROM cases WHERE cases.label = NEW.case_label)
     WHERE id = NEW.id AND case_id = '';
  END;
  CREATE TRIGGER IF NOT EXISTS calendar_events_case_id_from_unique_label_update
  AFTER UPDATE OF case_id, case_label ON calendar_events
  WHEN NEW.case_id = ''
   AND NEW.case_label != ''
   AND (SELECT COUNT(*) FROM cases WHERE cases.label = NEW.case_label) = 1
  BEGIN
    UPDATE calendar_events
       SET case_id = (SELECT MIN(id) FROM cases WHERE cases.label = NEW.case_label)
     WHERE id = NEW.id AND case_id = '';
  END;
`);

// Aufgaben, Wiedervorlagen und Fristen teilen sich weiterhin die robuste Aufgaben-Infrastruktur,
// sind fachlich aber eigenstaendige Eintragstypen. Die Quellfelder verhindern Doppelanlagen und
// halten z. B. eine Dokument-Wiedervorlage mit genau ihrem Ursprungsdokument verbunden.
addColumnIfMissing('todos', 'item_type', "item_type TEXT NOT NULL DEFAULT 'task'");
addColumnIfMissing('todos', 'case_id', "case_id TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('todos', 'source_type', "source_type TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('todos', 'source_id', "source_id TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('todos', 'source_module', "source_module TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('todos', 'source_ref', "source_ref TEXT NOT NULL DEFAULT ''");
db.exec(`
  UPDATE todos
     SET item_type = 'followup'
   WHERE item_type = 'task'
     AND (lower(title) LIKE 'wiedervorlage:%'
       OR lower(description) LIKE '%[wiedervorlage]%');
  UPDATE todos
     SET item_type = 'deadline'
   WHERE item_type = 'task'
     AND lower(title) LIKE 'frist:%';
  UPDATE todos
     SET case_id = (
       SELECT MIN(id) FROM cases WHERE cases.label = todos.case_label
     )
   WHERE case_id = ''
     AND case_label != ''
     AND (
       SELECT COUNT(*) FROM cases WHERE cases.label = todos.case_label
     ) = 1;
  CREATE INDEX IF NOT EXISTS idx_todos_case_id ON todos(case_id);
  CREATE INDEX IF NOT EXISTS idx_todos_item_type_due ON todos(item_type, done, due_at);
  CREATE INDEX IF NOT EXISTS idx_todos_source_link ON todos(source_type, source_id);
  CREATE TRIGGER IF NOT EXISTS todos_case_id_from_unique_label_insert
  AFTER INSERT ON todos
  WHEN NEW.case_id = ''
   AND NEW.case_label != ''
   AND (SELECT COUNT(*) FROM cases WHERE cases.label = NEW.case_label) = 1
  BEGIN
    UPDATE todos
       SET case_id = (SELECT MIN(id) FROM cases WHERE cases.label = NEW.case_label)
     WHERE id = NEW.id AND case_id = '';
  END;
  CREATE TRIGGER IF NOT EXISTS todos_case_id_from_unique_label_update
  AFTER UPDATE OF case_id, case_label ON todos
  WHEN NEW.case_id = ''
   AND NEW.case_label != ''
   AND (SELECT COUNT(*) FROM cases WHERE cases.label = NEW.case_label) = 1
  BEGIN
    UPDATE todos
       SET case_id = (SELECT MIN(id) FROM cases WHERE cases.label = NEW.case_label)
     WHERE id = NEW.id AND case_id = '';
  END;
`);

// Nutzerwunsch: Online-Besprechungen (Video-Call-Link) sollen sich an einem Termin hinterlegen
// lassen, damit dieser direkt anklickbar in der Terminuebersicht erscheint (analog zum bereits
// bestehenden Karten-Link fuer den Ort) - nur bei calendar_events, Aufgaben haben keinen Zeitpunkt
// fuer eine Besprechung.
addColumnIfMissing('calendar_events', 'online_url', "online_url TEXT NOT NULL DEFAULT ''");

// Nutzerwunsch: Kalendereintraegen soll optional eine eigene Farbe zugewiesen werden koennen, um sie
// im Raster/den Chips optisch auseinanderzuhalten (z. B. Vor-Ort-Termine vs. interne Fristen). Leerer
// String = Standardfarbe (--blue), keine Enum-Einschraenkung auf DB-Ebene - die Palette lebt rein im
// Client (CAL_EVENT_COLORS), damit neue Farben ohne Migration ergaenzt werden koennen.
addColumnIfMissing('calendar_events', 'color', "color TEXT NOT NULL DEFAULT ''");

// Multi-User-Kalender (Nutzerwunsch): jede Kalenderverbindung gehoert entweder dem BUERO
// (owner_user_id = NULL, vom Admin vorgegeben) oder EINEM Nutzer (owner_user_id gesetzt); zusaetzlich
// ist jede Verbindung "public" (bueroweit fuer alle sichtbar) oder "private" (nur der Eigentuemer sieht
// deren Termine/Aufgaben). Termine/Aufgaben erben owner_user_id + visibility von ihrer Verbindung
// (manuell angelegte ohne Verbindung bleiben bueroweit/public = bisheriges Verhalten). Sichtbarkeit
// wird bei GET /api/calendar/events bzw. /api/todos durchgesetzt: public ODER owner_user_id = ich.
addColumnIfMissing('calendar_connections', 'owner_user_id', 'owner_user_id INTEGER REFERENCES users(id)');
addColumnIfMissing('calendar_connections', 'visibility', "visibility TEXT NOT NULL DEFAULT 'public'");
addColumnIfMissing('calendar_events', 'owner_user_id', 'owner_user_id INTEGER REFERENCES users(id)');
addColumnIfMissing('calendar_events', 'visibility', "visibility TEXT NOT NULL DEFAULT 'public'");
addColumnIfMissing('todos', 'owner_user_id', 'owner_user_id INTEGER REFERENCES users(id)');
addColumnIfMissing('todos', 'visibility', "visibility TEXT NOT NULL DEFAULT 'public'");

// Anlagen an Termine/Aufgaben (Nutzerwunsch) - gleiches Muster wie case_documents (Metadaten in
// SQLite, Bytes auf der Platte unter runtime/data/calendar-event-attachments|todo-attachments/<id>/).
db.exec(`
  CREATE TABLE IF NOT EXISTS calendar_event_attachments (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES calendar_events(id),
    filename TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS todo_attachments (
    id TEXT PRIMARY KEY,
    todo_id TEXT NOT NULL REFERENCES todos(id),
    filename TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id)
  );
`);

// Nutzerwunsch: MEHRERE Kalender/Aufgabenlisten je Verbindung (Konto) statt bisher genau einem.
// Eine Verbindung (calendar_connections) kann jetzt beliebig viele entdeckte Kalender-/Aufgaben-
// Sammlungen fuehren; je Zeile hier = EINE solche Sammlung. selected=1 heisst "wird synchronisiert
// und in den Ansichten angeboten". kind trennt Termin-Kalender ('event') von Aufgabenlisten ('task').
// remote_id: bei OAuth die Google-/Microsoft-Kalender-/Listen-ID, bei CalDAV die Collection-URL (href).
// color: Hex-Farbe (vom Anbieter uebernommen oder zugewiesen) fuer den Farbpunkt in der Ansicht -
//        leer = Client-Fallback aus CAL_EVENT_COLORS. Bewusst KEINE Enum-Einschraenkung.
db.exec(`
  CREATE TABLE IF NOT EXISTS connection_calendars (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES calendar_connections(id),
    kind TEXT NOT NULL DEFAULT 'event',
    remote_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    selected INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_connection_calendars_conn ON connection_calendars(connection_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_calendars_uni ON connection_calendars(connection_id, kind, remote_id);
`);

// Termine/Aufgaben merken sich zusaetzlich zur connection_id, aus WELCHEM Kalender der Verbindung sie
// stammen (calendar_ref = connection_calendars.remote_id), damit die Ansicht-Haekchen je Kalender
// filtern koennen und ein Sync-Lauf eines Kalenders nicht die Eintraege eines ANDEREN Kalenders
// derselben Verbindung als verwaist entfernt. Leer = manuell angelegt oder Alt-Datenbestand.
addColumnIfMissing('calendar_events', 'calendar_ref', "calendar_ref TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('todos', 'calendar_ref', "calendar_ref TEXT NOT NULL DEFAULT ''");

// ===== Online-Kontakte-Synchronisation (Nutzerwunsch) =====
// Kontakte werden über DIESELBEN Verbindungen wie Kalender/Aufgaben synchronisiert (CardDAV bei
// Nextcloud/iCloud, People-API bei Google, Graph /me/contacts bei Microsoft). Ein Adressbuch je
// Konto wird als weitere Sammlung mit kind='contact' in connection_calendars geführt (remote_id =
// CardDAV-Collection-URL bzw. Google-Group-/Graph-Folder-Id, leer = Standard-Adressbuch des Kontos).
// Pro Verbindung steuert contacts_sync_mode, OB und WIE Kontakte abgeglichen werden:
//   'off'    = keine Kontaktsynchronisation (Standard)
//   'manual' = nur auf Knopfdruck
//   'auto'   = zusätzlich automatisch im Timer-Intervall (wie Kalender/Aufgaben)
addColumnIfMissing('calendar_connections', 'contacts_sync_mode', "contacts_sync_mode TEXT NOT NULL DEFAULT 'off'");

// ===== Aufgaben-Sync-Ausbau (PLAN-AUFGABEN-SYNC, Etappen 1-6) =====
// deadline_export: Fristen-/Wiedervorlage-Aufgaben duerfen in diese Verbindung EXPORTIERT werden
//   (strikter Nur-Export, Nutzerentscheidung 02.08.2026 - eingehende Aenderungen verwirft der
//   Waechter in sync/runner.js und haelt das im Sync-Journal fest). Standard aus, damit sich
//   bestehende Google/Microsoft/Nextcloud-Verbindungen nicht unangekuendigt anders verhalten.
addColumnIfMissing('calendar_connections', 'deadline_export', 'deadline_export INTEGER NOT NULL DEFAULT 0');
// OpenProject-Statuszuordnung: Workflows sind je Instanz konfigurierbar, deshalb merkt sich die
// Verbindung, welcher /api/v3/statuses/<id>-Href "offen" bzw. "erledigt" bedeutet.
addColumnIfMissing('calendar_connections', 'task_status_open', "task_status_open TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('calendar_connections', 'task_status_done', "task_status_done TEXT NOT NULL DEFAULT ''");
// Nur-Lese-Kalenderabo (Etappe 5): OpenProjects iCal-URL je Projekt (Token steckt in der URL).
addColumnIfMissing('calendar_connections', 'ical_url', "ical_url TEXT NOT NULL DEFAULT ''");
// Webhook-Sofort-Sync (Etappe 3): Vikunja ruft /api/sync-hooks/vikunja/<id> und weist sich mit
// diesem Geheimnis aus (HMAC-Signatur oder ?s=-Parameter).
addColumnIfMissing('calendar_connections', 'webhook_secret', "webhook_secret TEXT NOT NULL DEFAULT ''");

db.exec(`
  -- Sync-Journal (Plan C.5): verworfen/repariert/Konflikt - nachvollziehbar statt stumm.
  -- Betriebsprotokoll wie audit_log: Teil der SQLite-Vollsicherung, kein portables Artefakt.
  CREATE TABLE IF NOT EXISTS sync_journal (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    connection_id TEXT,
    direction TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    local_type TEXT NOT NULL DEFAULT '',
    local_id TEXT NOT NULL DEFAULT '',
    remote_id TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_sync_journal_ts ON sync_journal(ts DESC);

  -- Projekt je Fall (Nutzerentscheidung 02.08.2026): welche entfernte Projekt-ID einer
  -- Vikunja-/OpenProject-Verbindung zu welchem Fall gehoert. Aufgaben eines Falls laufen in
  -- dessen Projekt; Aufgaben AUS dem Projekt bekommen beim Spiegeln den Fall zugeordnet.
  CREATE TABLE IF NOT EXISTS connection_case_projects (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES calendar_connections(id),
    case_id TEXT NOT NULL,
    remote_project_id TEXT NOT NULL,
    remote_project_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(connection_id, case_id)
  );

  -- Aufgaben-Feed (Etappe 4): widerrufliche Tokens fuer den schreibarmen CalDAV-/VTODO-Feed
  -- unter /dav-feed/<token>/ (z. B. fuer Super Productivitys CalDAV-Anbindung). Wie api_tokens
  -- wird NUR der SHA-256-Hash gespeichert; der Klartext existiert einzig in der Anlage-Antwort.
  CREATE TABLE IF NOT EXISTS feed_tokens (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
  );
`);

// Synchronisierte Kontakte landen NICHT direkt in einem Verzeichnis (sonst würde man versehentlich
// eine fallspezifische Kontaktliste vollknallen), sondern in dieser Import-Ablage. Von dort übernimmt
// der Nutzer sie bewusst in ein Adressbuch (Büro ODER ein Fall). status: 'new' = in der Ablage,
// 'moved' = übernommen, 'dismissed' = verworfen. Dedup über UNIQUE(connection_id, addressbook_ref,
// external_uid): ein bereits gesehener Kontakt wird nicht erneut in die Ablage gelegt.
db.exec(`
  CREATE TABLE IF NOT EXISTS office_contact_imports (
    id TEXT PRIMARY KEY,
    connection_id TEXT REFERENCES calendar_connections(id),
    addressbook_ref TEXT NOT NULL DEFAULT '',
    external_uid TEXT NOT NULL DEFAULT '',
    external_href TEXT NOT NULL DEFAULT '',
    external_etag TEXT NOT NULL DEFAULT '',
    data_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'new',
    target_kind TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_office_contact_imports_conn ON office_contact_imports(connection_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_office_contact_imports_uni ON office_contact_imports(connection_id, addressbook_ref, external_uid);
`);
// Herkunft an übernommenen Kontakten festhalten: external_uid (+ Verbindung), damit ein Kontakt nur
// EINMAL synchronisiert wird, solange er im System ist. Verschwindet er (gelöscht), wird er beim
// nächsten Sync wieder in die Ablage gelegt. Gilt für Büro- UND Fallkontakte.
addColumnIfMissing('office_contacts', 'external_uid', "external_uid TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('office_contacts', 'connection_id', "connection_id TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('case_contacts', 'external_uid', "external_uid TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('case_contacts', 'connection_id', "connection_id TEXT NOT NULL DEFAULT ''");

// Einmalige, idempotente Uebernahme der bisherigen EINZEL-Auswahl je Verbindung in die neue
// connection_calendars-Tabelle: existiert fuer eine Verbindung noch keine Kalenderzeile, wird die
// bisher genutzte Sammlung (OAuth: calendar_id/task_list_id, CalDAV: calendar_url/todo_url) als je
// eine selected=1-Zeile angelegt. So bleibt das Verhalten nach dem Update unveraendert, bis der Admin
// per Discovery weitere Kalender aktiviert. Laeuft bei jedem Start, tut nach erster Uebernahme nichts.
function migrateSingleCalendarSelections() {
  const conns = db.prepare('SELECT * FROM calendar_connections').all();
  const hasAny = db.prepare('SELECT id FROM connection_calendars WHERE connection_id = ? LIMIT 1');
  const ins = db.prepare(`
    INSERT OR IGNORE INTO connection_calendars (id, connection_id, kind, remote_id, name, color, selected, position)
    VALUES (@id, @connId, @kind, @remoteId, @name, '', 1, @position)
  `);
  const crypto = require('crypto');
  // Backfill: bereits gespiegelte Termine/Aufgaben (aus der Zeit vor calendar_ref) tragen die
  // Kalender-Kennung ihrer bisherigen EINZEL-Quelle nach. Zwingend, damit der neue, nach calendar_ref
  // getrennte Sync sie wiedererkennt statt Duplikate anzulegen. Nur gespiegelte (external_uid != '')
  // und noch nicht getaggte (calendar_ref = '') Zeilen.
  const backfillEv = db.prepare("UPDATE calendar_events SET calendar_ref = @ref WHERE connection_id = @connId AND external_uid != '' AND (calendar_ref IS NULL OR calendar_ref = '')");
  const backfillTd = db.prepare("UPDATE todos SET calendar_ref = @ref WHERE connection_id = @connId AND external_uid != '' AND (calendar_ref IS NULL OR calendar_ref = '')");
  for (const c of conns) {
    const isCaldav = c.provider === 'nextcloud' || c.provider === 'icloud';
    const eventRef = isCaldav ? c.calendar_url : c.calendar_id;
    const taskRef = isCaldav ? c.todo_url : c.task_list_id;
    const label = c.display_name || c.account_label || '';
    if (!hasAny.get(c.id)) { // Auswahlzeilen nur einmal anlegen (idempotent)
      if (eventRef) ins.run({ id: crypto.randomUUID(), connId: c.id, kind: 'event', remoteId: eventRef, name: label || 'Kalender', position: 0 });
      if (taskRef) ins.run({ id: crypto.randomUUID(), connId: c.id, kind: 'task', remoteId: taskRef, name: label ? (label + ' – Aufgaben') : 'Aufgaben', position: 1 });
    }
    // Backfill laeuft unabhaengig (auch fuer bereits migrierte Verbindungen, falls Alt-Zeilen ohne ref existieren).
    if (eventRef) backfillEv.run({ ref: eventRef, connId: c.id });
    if (taskRef) backfillTd.run({ ref: taskRef, connId: c.id });
  }
}
migrateSingleCalendarSelections();

// Einmalige Uebernahme der alten Singleton-Nextcloud-Verbindung (falls vorhanden) in die neue
// calendar_connections-Tabelle - idempotent (per INSERT ... WHERE NOT EXISTS), laeuft bei jedem
// Start, tut aber nach der ersten erfolgreichen Uebernahme nichts mehr.
function migrateLegacyCaldavConfig() {
  const legacy = db.prepare('SELECT * FROM caldav_config WHERE id = 1').get();
  if (!legacy || !legacy.username) return;
  const alreadyMigrated = db.prepare("SELECT id FROM calendar_connections WHERE provider = 'nextcloud' LIMIT 1").get();
  if (alreadyMigrated) return;
  db.prepare(`
    INSERT INTO calendar_connections (id, provider, display_name, username, password_encrypted, calendar_url, todo_url)
    VALUES (@id, 'nextcloud', 'Nextcloud', @username, @passwordEncrypted, @calendarUrl, @todoUrl)
  `).run({
    id: require('crypto').randomUUID(),
    username: legacy.username,
    passwordEncrypted: legacy.password_encrypted,
    calendarUrl: legacy.calendar_url,
    todoUrl: legacy.todo_url
  });
}
migrateLegacyCaldavConfig();

// Plan Abschnitt AL, Phase 1: Fallarchivierung - ein archivierter Fall soll aus der normalen
// Fallauswahl/-suche verschwinden, bleibt aber ueber ein eigenes "Fallarchiv" erreichbar und landet
// beim ZIP-Export in einem separaten Archiv/-Unterordner. Reine Flag-Umschaltung (kein Loeschen,
// keine Aenderung an stammdaten_json/case_reports/etc.) - archivierte Faelle bleiben vollstaendig
// erhalten und koennen jederzeit zurueckgeholt werden.
// Kontotyp je Bankverbindung (Nutzerwunsch nach Abschnitt AX): Geschäfts-/Privat-/Anderkonto usw. -
// freier Text (die Auswahlliste lebt im Client), Nachruestung fuer bestehende Datenbanken.
addColumnIfMissing('office_bank_accounts', 'account_type', "account_type TEXT NOT NULL DEFAULT ''");
// Akademische Grade/Studienabschlüsse fürs Büroprofil (Nutzerwunsch Abschnitt BC) - erscheinen
// im Briefkopf/in der Fußzeile hinter dem Namen.
addColumnIfMissing('office_profile', 'academic_degree', "academic_degree TEXT NOT NULL DEFAULT ''");

// Posteingang (Nutzerwunsch Abschnitt BB): gescannte Eingangspost; case_id
// trägt die eindeutige Fallzuordnung, leere IDs bleiben Büroorganisation.
// Datei-Bytes liegen auf der Platte (runtime/data/inbox-documents/<id>, gleiches Muster wie
// case-documents), hier nur Metadaten + OCR-Text + KI-Ergebnisse. suggestions_json ist die
// anpassbare Vorschlagsliste (Termine/Aufgaben/Doku-Eintraege/zu erstellende Dokumente).
db.exec(`
  CREATE TABLE IF NOT EXISTS inbox_documents (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    case_id TEXT NOT NULL DEFAULT '',
    case_label TEXT NOT NULL DEFAULT '',
    sender TEXT NOT NULL DEFAULT '',
    short_desc TEXT NOT NULL DEFAULT '',
    inbox_date TEXT NOT NULL DEFAULT '',
    received_date TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    ocr_text TEXT NOT NULL DEFAULT '',
    ai_notes TEXT NOT NULL DEFAULT '',
    suggestions_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'neu',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
addColumnIfMissing('cases', 'archived', 'archived INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('cases', 'archived_at', "archived_at TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('cases', 'archived_by', 'archived_by INTEGER REFERENCES users(id)');
// Posteingang: Tagesablage / Datumsswitcher. Bleibt unabhängig vom Schreibdatum des Dokuments,
// damit ein später korrigiertes received_date den Posteingangstag nicht verschiebt.
addColumnIfMissing('inbox_documents', 'inbox_date', "inbox_date TEXT NOT NULL DEFAULT ''");
// Posteingang: KI-Empfehlung zur Aufbewahrung je Dokument (Nutzerwunsch) - als JSON
// {recommendation, reason}, leer/'' wenn (noch) keine Analyse vorliegt.
addColumnIfMissing('inbox_documents', 'retention_json', "retention_json TEXT NOT NULL DEFAULT ''");
// Posteingang: Widerspruchs-/Antragsfrist je Dokument (Nutzerwunsch) - als JSON
// {type, baseDate, dueDate, status, note}, leer/'' wenn keine Frist gesetzt/erkannt.
addColumnIfMissing('inbox_documents', 'frist_json', "frist_json TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('inbox_documents', 'case_id', "case_id TEXT NOT NULL DEFAULT ''");
db.exec(`
  UPDATE inbox_documents
     SET case_id = (
       SELECT MIN(id) FROM cases WHERE cases.label = inbox_documents.case_label
     )
   WHERE case_id = ''
     AND case_label != ''
     AND (
       SELECT COUNT(*) FROM cases WHERE cases.label = inbox_documents.case_label
     ) = 1;
  CREATE INDEX IF NOT EXISTS idx_inbox_documents_case_id ON inbox_documents(case_id);
  CREATE TRIGGER IF NOT EXISTS inbox_documents_case_id_from_unique_label_insert
  AFTER INSERT ON inbox_documents
  WHEN NEW.case_id = ''
   AND NEW.case_label != ''
   AND (SELECT COUNT(*) FROM cases WHERE cases.label = NEW.case_label) = 1
  BEGIN
    UPDATE inbox_documents
       SET case_id = (SELECT MIN(id) FROM cases WHERE cases.label = NEW.case_label)
     WHERE id = NEW.id AND case_id = '';
  END;
  CREATE TRIGGER IF NOT EXISTS inbox_documents_case_id_from_unique_label_update
  AFTER UPDATE OF case_id, case_label ON inbox_documents
  WHEN NEW.case_id = ''
   AND NEW.case_label != ''
   AND (SELECT COUNT(*) FROM cases WHERE cases.label = NEW.case_label) = 1
  BEGIN
    UPDATE inbox_documents
       SET case_id = (SELECT MIN(id) FROM cases WHERE cases.label = NEW.case_label)
     WHERE id = NEW.id AND case_id = '';
  END;
`);

// Plan Abschnitt AL, Phase 2: Betreuungsuebersicht/Halbjahresmeldung ans Betreuungsgericht bzw. die
// Betreuungsbehoerde. Die eigentlichen Fallangaben (Gericht/Aktenzeichen/Name/...) kommen live aus
// cases.stammdaten_json - hier wird NUR das transiente, meldezeitraum-bezogene Zusatzfeld je Fall
// gespeichert (Aenderungsart/Uebergabe an), das sich pro Halbjahr neu aendert und NICHT Teil der
// eigentlichen Stammdaten ist. UNIQUE(case_id, period_start) - genau ein Eintrag je Fall und
// Meldezeitraum, erneutes Speichern desselben Zeitraums aktualisiert ihn (siehe upsert in
// routes/betreuungsuebersicht.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS betreuung_overview_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL REFERENCES cases(id),
    period_start TEXT NOT NULL,
    aenderungsart TEXT NOT NULL DEFAULT '',
    uebergabe_an TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id),
    UNIQUE(case_id, period_start)
  );
`);

// Plan Abschnitt AL, Phase 3: Buero-weite Finanzen (laufende/einmalige Ausgaben und Einnahmen des
// Buero-Betriebs selbst - NICHT fallbezogen, siehe Architekturentscheidung "buerowehnte DB-Module
// statt Case-Stammdaten-Writeback"). summe_monatlich ist nur bei frequenz='jaehrlich'/'halbjaehrlich'
// sinnvoll befuellt (Monatsumrechnung fuers UI), datum nur bei frequenz='einmalig'. Summen/Bilanz
// werden bewusst NICHT gespeichert, sondern bei jedem Laden live aus den Zeilen berechnet (wie im
// Original-Excel per SUM-Formel) - Vermeidet Drift zwischen gespeicherter Summe und Zeileninhalt.
db.exec(`
  CREATE TABLE IF NOT EXISTS finance_entries (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    posten TEXT NOT NULL DEFAULT '',
    partner TEXT NOT NULL DEFAULT '',
    frequenz TEXT NOT NULL DEFAULT 'monatlich',
    summe_gesamt REAL NOT NULL DEFAULT 0,
    summe_monatlich REAL,
    datum TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );
`);

// Plan Abschnitt AL, Phase 4: Buero-weite Ausgangsrechnungen (kein Gehaltsbezug, daher hinter der
// BESTEHENDEN Fallverwaltungs-Berechtigung, keine neue eigene Berechtigung noetig - anders als
// Finanzen). case_label ist ein optionales, freies Textfeld (analog zu calendar_events/todos'
// case_label) statt eines FK-Verweises - dieselbe "Zuordnung ueber Bezeichnungstext, kein
// nachzupflegender Verweis"-Begruendung wie dort. differenz (Eingangsbetrag - Summe) wird bewusst
// NICHT gespeichert, sondern clientseitig live berechnet.
db.exec(`
  CREATE TABLE IF NOT EXISTS outgoing_invoices (
    id TEXT PRIMARY KEY,
    re_datum TEXT NOT NULL DEFAULT '',
    re_nummer TEXT NOT NULL DEFAULT '',
    empfaenger TEXT NOT NULL DEFAULT '',
    verwendungszweck TEXT NOT NULL DEFAULT '',
    case_label TEXT NOT NULL DEFAULT '',
    rechnungszeitraum TEXT NOT NULL DEFAULT '',
    summe REAL NOT NULL DEFAULT 0,
    eingang_datum TEXT,
    eingangsbetrag REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );
`);

/* Vergütungs-Pipeline (Nutzerwunsch 25.08.2026): die Ausgangsrechnung bekommt einen echten
   Lebenslauf. Bisher gab es NUR Eingangsdatum/-betrag - daraus leiteten drei Stellen der App
   drei WIDERSPRUECHLICHE "offen"-Begriffe ab, und "ueberfaellig" war mangels Faelligkeit gar
   nicht berechenbar. Alle Spalten additiv mit Default, Altzeilen bleiben gueltig.
     status      gestellt|bewilligt|teilbezahlt|bezahlt|storniert (leer = aus den Daten abgeleitet)
     faellig_am  Zahlungsziel (ISO), Standard 30 Tage ab Rechnungsdatum
     bewilligt_am Festsetzungsbeschluss der Staatskasse (ISO)
     report_id / case_id  Rueckweg zum Verguetungsantrag bzw. Fall (bisher nur Freitext-Label) */
addColumnIfMissing('outgoing_invoices', 'status', "status TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('outgoing_invoices', 'faellig_am', "faellig_am TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('outgoing_invoices', 'bewilligt_am', "bewilligt_am TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('outgoing_invoices', 'report_id', "report_id TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('outgoing_invoices', 'case_id', "case_id TEXT NOT NULL DEFAULT ''");
db.exec("CREATE INDEX IF NOT EXISTS idx_outgoing_invoices_status ON outgoing_invoices(status)");

/* Altbestand nachziehen - woertlich dasselbe Verfahren wie bei calendar_events und
   inbox_documents: Ein Label wird NUR dann zur Kennung erhoben, wenn es GENAU EINEN Fall
   mit exakt diesem Label gibt. Bei Mehrdeutigkeit oder abweichender Schreibweise bleibt die
   Kennung leer und das Label traegt weiter - lieber kein Verweis als ein falscher.
   Die beiden Trigger fangen die Wege ab, die keine Kennung mitschicken (Excel-Import,
   Altclients, MCP): sie ziehen die Kennung nachtraeglich, ohne je eine gesetzte zu ueberschreiben. */
db.exec(`
  UPDATE outgoing_invoices
     SET case_id = (SELECT MIN(id) FROM cases WHERE cases.label = outgoing_invoices.case_label)
   WHERE case_id = ''
     AND case_label != ''
     AND (SELECT COUNT(*) FROM cases WHERE cases.label = outgoing_invoices.case_label) = 1;
  CREATE INDEX IF NOT EXISTS idx_outgoing_invoices_case_id ON outgoing_invoices(case_id);
  CREATE TRIGGER IF NOT EXISTS outgoing_invoices_case_id_from_unique_label_insert
  AFTER INSERT ON outgoing_invoices
  WHEN NEW.case_id = ''
   AND NEW.case_label != ''
   AND (SELECT COUNT(*) FROM cases WHERE cases.label = NEW.case_label) = 1
  BEGIN
    UPDATE outgoing_invoices
       SET case_id = (SELECT MIN(id) FROM cases WHERE cases.label = NEW.case_label)
     WHERE id = NEW.id AND case_id = '';
  END;
  CREATE TRIGGER IF NOT EXISTS outgoing_invoices_case_id_from_unique_label_update
  AFTER UPDATE OF case_id, case_label ON outgoing_invoices
  WHEN NEW.case_id = ''
   AND NEW.case_label != ''
   AND (SELECT COUNT(*) FROM cases WHERE cases.label = NEW.case_label) = 1
  BEGIN
    UPDATE outgoing_invoices
       SET case_id = (SELECT MIN(id) FROM cases WHERE cases.label = NEW.case_label)
     WHERE id = NEW.id AND case_id = '';
  END;
`);


// Plan Abschnitt AL, Phase 5: Fahrtkostennachweis - bewusst NUR das im Nutzer-Vorschlag selbst
// beschriebene "Ergaenzungsmodul: Private Mitarbeiterfahrzeuge und Fahrtkostenerstattung", NICHT das
// volle GoBD-Fahrtenbuch fuer Dienstwagen (Hash-Verkettung, Periodenabschluss, Kilometerstands-
// Plausibilitaet) - die echten Fahrtenbuch-CZ/MZ/RZ-Quelldaten enthalten nachweislich keinen
// Dienstwagen/keine Kilometerstaende, nur Privatfahrzeug-Kennzeichen + Einzelfahrten + 0,30-EUR/km-
// Pauschale (siehe Plan-Kontext). Kein Rechte-Neubau noetig - Sichtbarkeit ist zeilenbasiert
// (fahrer_user_id = eigene Fahrten vs. is_admin = alle, siehe routes/mileage.js), keine neue
// granulare Berechtigung wie bei Finanzen.
db.exec(`
  CREATE TABLE IF NOT EXISTS private_vehicles (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    kennzeichen TEXT NOT NULL DEFAULT '',
    hersteller_modell TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'aktiv',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS mileage_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gueltig_ab TEXT NOT NULL,
    gueltig_bis TEXT,
    betrag_pro_km REAL NOT NULL,
    grundlage TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS mileage_trips (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES private_vehicles(id),
    fahrer_user_id INTEGER NOT NULL REFERENCES users(id),
    datum TEXT NOT NULL DEFAULT '',
    fahranlass TEXT NOT NULL DEFAULT '',
    case_label TEXT NOT NULL DEFAULT '',
    start_adresse TEXT NOT NULL DEFAULT '',
    ziel_adresse TEXT NOT NULL DEFAULT '',
    kilometer REAL NOT NULL DEFAULT 0,
    erstattungsbetrag_snapshot REAL NOT NULL DEFAULT 0,
    rate_id_snapshot INTEGER REFERENCES mileage_rates(id),
    status TEXT NOT NULL DEFAULT 'entwurf',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
// Grosse Buero-Runde (Nachruestspalten, bewusst NACH den CREATE TABLEs - siehe Hinweis oben):
// note/halter_name = Anmerkung- und Halter/in-Spalte des Fahrzeuge-Blatts der Buero-Excel;
// fahrer_name = Klartext-Fahrer aus den Fahrtenbuechern fuer Fahrer ohne eigenes Nutzerkonto
// (publicTrip bevorzugt diesen Text, sonst den ueber fahrer_user_id aufgeloesten Namen).
addColumnIfMissing('private_vehicles', 'note', "note TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('private_vehicles', 'halter_name', "halter_name TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('mileage_trips', 'fahrer_name', "fahrer_name TEXT NOT NULL DEFAULT ''");
// Finanzen: die Buero-Excel ist nach der HANDSORTIERUNG des Nutzers geordnet (nicht alphabetisch) -
// ohne eigene Sortierspalte wuerde der Excel-Roundtrip die Zeilenreihenfolge verwuerfeln.
addColumnIfMissing('finance_entries', 'sort_order', 'sort_order INTEGER NOT NULL DEFAULT 0');

// Default-Kilometerpauschale (0,30 EUR/km, wie in den echten Fahrtenbuch-Quelldaten vorgefunden) -
// nur einmalig seeden, damit ein Neustart des Servers keine Duplikate anlegt. Admin-anpassbar
// (behebt die im Nutzer-Vorschlag zurecht kritisierte "kein hartkodierter Betrag"-Anforderung -
// der Betrag lebt in der DB, nicht im Code).
if (!db.prepare('SELECT id FROM mileage_rates LIMIT 1').get()) {
  db.prepare(`
    INSERT INTO mileage_rates (gueltig_ab, gueltig_bis, betrag_pro_km, grundlage)
    VALUES ('2000-01-01', NULL, 0.30, 'Standard-Kilometerpauschale (admin-anpassbar)')
  `).run();
}

// Nutzerwunsch (Runde 6): "Unterschriftenoptionen fehlen" - Fahrer bestaetigt beim Einreichen per
// getipptem Namen die Richtigkeit der Angaben (fahrer_unterschrift/-am), Admin-Pruefung stempelt
// beim Statuswechsel automatisch den eigenen Anzeigenamen (pruefer_unterschrift/-am) - kein
// eigenes Signatur-Widget/Canvas noetig, deckt den Zweck (nachvollziehbare Bestaetigung) fuer
// realistische Bueronutzung ausreichend ab.
addColumnIfMissing('mileage_trips', 'fahrer_unterschrift', "fahrer_unterschrift TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('mileage_trips', 'fahrer_unterschrift_am', "fahrer_unterschrift_am TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('mileage_trips', 'pruefer_unterschrift', "pruefer_unterschrift TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('mileage_trips', 'pruefer_unterschrift_am', "pruefer_unterschrift_am TEXT NOT NULL DEFAULT ''");

// Nutzerwunsch Runde 9: Finanzen-Detailliste fuer die Buchhaltung - Kontoauszuege/Umsatzuebersichten
// und Belege/Rechnungen werden hochgeladen, lokal geparst bzw. per Hybrid-OCR erkannt (gleiche
// Technik wie bei der bestehenden Rechnungslegung, siehe dortige acc*-Funktionen), aber ANDERS als
// dort bewusst SERVERSEITIG gespeichert (Ruecksprache: Speicherbedarf fuer ein kleines Buero liegt
// bei ca. 0,5-2 GB/Jahr, unproblematisch) - ueberlebt dadurch ein Neuladen, mehrere Nutzer koennen
// an derselben Zuordnung weiterarbeiten. Datei-Bytes liegen wie bei case_documents auf der Platte,
// nicht in SQLite (runtime/data/finance-statements/, runtime/data/finance-receipts/).
addColumnIfMissing('finance_entries', 'konto', "konto TEXT NOT NULL DEFAULT 'geschaeftlich'");

// Mail-Signatur (Nutzerwunsch Signatureditor): buerobezogen wie die uebrige SMTP-Konfiguration,
// KEIN Geheimnis (daher unverschluesselt) - wird im Mail-Editor unter die Nachricht gesetzt.
addColumnIfMissing('smtp_config', 'signature', "signature TEXT NOT NULL DEFAULT ''");
// Versandart (Nutzerwunsch): 'smtp' (nodemailer) ODER 'microsoft' (Microsoft Graph /me/sendMail über
// eine autorisierte Microsoft-Kalenderverbindung). Bei 'microsoft' wird nicht der SMTP-Server, sondern
// die per graph_connection_id referenzierte calendar_connections-Zeile (provider='microsoft') genutzt.
addColumnIfMissing('smtp_config', 'transport', "transport TEXT NOT NULL DEFAULT 'smtp'");
addColumnIfMissing('smtp_config', 'graph_connection_id', "graph_connection_id TEXT NOT NULL DEFAULT ''");

db.exec(`
  CREATE TABLE IF NOT EXISTS finance_statements (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    konto TEXT NOT NULL DEFAULT 'geschaeftlich',
    parse_status TEXT NOT NULL DEFAULT 'pending',
    parse_error TEXT NOT NULL DEFAULT '',
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    uploaded_by INTEGER REFERENCES users(id)
  );

  -- Einzelne Buchungszeilen: entweder aus einem hochgeladenen Kontoauszug geparst
  -- (statement_id gesetzt) oder von Hand angelegt (statement_id NULL).
  CREATE TABLE IF NOT EXISTS finance_transactions (
    id TEXT PRIMARY KEY,
    statement_id TEXT REFERENCES finance_statements(id),
    konto TEXT NOT NULL DEFAULT 'geschaeftlich',
    booking_date TEXT NOT NULL DEFAULT '',
    counterparty TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    is_private_suspect INTEGER NOT NULL DEFAULT 0,
    private_reason TEXT NOT NULL DEFAULT '',
    matched_entry_id TEXT REFERENCES finance_entries(id),
    status TEXT NOT NULL DEFAULT 'offen',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS finance_receipts (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    issuer TEXT NOT NULL DEFAULT '',
    invoice_number TEXT NOT NULL DEFAULT '',
    invoice_date TEXT NOT NULL DEFAULT '',
    total_amount REAL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    confidence REAL NOT NULL DEFAULT 0,
    ocr_status TEXT NOT NULL DEFAULT 'pending',
    ocr_text TEXT NOT NULL DEFAULT '',
    matched_transaction_id TEXT REFERENCES finance_transactions(id),
    matched_entry_id TEXT REFERENCES finance_entries(id),
    status TEXT NOT NULL DEFAULT 'offen',
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    uploaded_by INTEGER REFERENCES users(id)
  );
`);

// Bank-Sync-Fluss (Plan Abschnitt BR, Phase B3): Buero-Bankverbindungen materialisieren ihre
// Umsaetze als synthetisches finance_statement (source='fints', connection_id) - dadurch greifen
// die bestehende Statement-Gruppierung, der CSV-Download und das KI-Beleg-Matching unveraendert.
// bank_tx_hash dedupliziert finance_transactions gegen erneute Syncs UND manuell importierte
// Auszuege desselben Kontos.
addColumnIfMissing('finance_statements', 'source', "source TEXT NOT NULL DEFAULT 'upload'");
addColumnIfMissing('finance_statements', 'connection_id', 'connection_id TEXT');
addColumnIfMissing('finance_transactions', 'bank_tx_hash', "bank_tx_hash TEXT NOT NULL DEFAULT ''");

// Browser-Extension "Formular-Assistent" (Plan Abschnitt BR, Phase E1): persoenliche API-Tokens
// fuer die Bearer-Authentifizierung der /api/ext/*-Fassade. Es wird NUR der SHA-256-Hash des
// Tokens gespeichert (Klartext existiert einzig in der Anlage-Response) - ein DB-Leak gibt damit
// keine nutzbaren Tokens preis. revoked=1 statt DELETE, damit der Audit-Bezug erhalten bleibt.
db.exec(`
  CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
  );

  -- Site-Profile der Browser-Extension (Plan Abschnitt BR, Phase E3+): einmal "trainierte"
  -- Formular-Zuordnungen (Felder -> Datenschluessel UND Buttons -> Aktionen wie Weiter/Upload)
  -- werden buero-weit geteilt - die wachsende Bibliothek an Online-Formularen (Nutzerwunsch).
  -- mapping_json = {version, urlPatterns[], contextDefault, fields[], actions[]}; deleted=1
  -- statt DELETE (Audit-Bezug + Cache-Invalidierung ueber updated_at).
  CREATE TABLE IF NOT EXISTS site_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    url_pattern TEXT NOT NULL DEFAULT '',
    mapping_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id),
    deleted INTEGER NOT NULL DEFAULT 0
  );

  -- Bank-Direktverbindungen via FinTS/HBCI (Plan Abschnitt BR, Phase B2). scope='office' fuers
  -- Buero-Konto (Buchhaltung) oder 'case' fuer ein Konto der betreuten Person (Rechnungslegung,
  -- case_id gesetzt). pin_encrypted = AES-256-GCM ueber crypto.js (leave-empty-keeps-existing wie
  -- office_send_credentials). status: neu|ok|needs_tan|fehler. fints_url kommt aus bank-directory
  -- (BLZ-Lookup) oder manuell. sca_valid_until = grobe PSD2-90-Tage-Marke.
  CREATE TABLE IF NOT EXISTS bank_connections (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'office' CHECK(scope IN ('office','case')),
    case_id TEXT REFERENCES cases(id),
    bank_name TEXT NOT NULL DEFAULT '',
    blz TEXT NOT NULL DEFAULT '',
    fints_url TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    pin_encrypted TEXT NOT NULL DEFAULT '',
    tan_mechanism TEXT NOT NULL DEFAULT '',
    tan_medium TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'neu',
    status_detail TEXT NOT NULL DEFAULT '',
    sca_valid_until TEXT,
    last_sync_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Beim Verbindungstest per SEPA-Kontenabruf entdeckte Konten; enabled steuert, welche Konten
  -- kuenftig synchronisiert werden.
  CREATE TABLE IF NOT EXISTS bank_accounts_discovered (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES bank_connections(id),
    iban TEXT NOT NULL DEFAULT '',
    bic TEXT NOT NULL DEFAULT '',
    account_name TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Rohe, deduplizierte Kontobewegungen ALLER Verbindungen (Buero + Fall). Der Buero-Fluss (B3)
  -- materialisiert zusaetzlich in finance_transactions; der Fall-Fluss (B4) wird client-seitig in
  -- die Rechnungslegung uebernommen. dedupe_hash = sha256(iban|datum|betrag|norm(zweck)|norm(gegenpartei)).
  CREATE TABLE IF NOT EXISTS bank_transactions (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES bank_connections(id),
    account_iban TEXT NOT NULL DEFAULT '',
    booking_date TEXT NOT NULL DEFAULT '',
    value_date TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    counterparty TEXT NOT NULL DEFAULT '',
    counterparty_iban TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL DEFAULT '',
    balance_after REAL,
    raw_json TEXT NOT NULL DEFAULT '',
    dedupe_hash TEXT NOT NULL UNIQUE,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ===== Banking ueber Hibiscus Payment Server (2026-07-26, siehe PLAN-Bankanbindung.md) =====
// Der 2026-07 entfernte FinTS-Direktweg wird NICHT wiederbelebt; stattdessen spricht der Server
// mit einem lokal betriebenen Hibiscus Payment Server (XML-RPC, server/hibiscus.js). Die alten
// bank_*-Tabellen werden weiterverwendet: bank_connections liefert nur noch die Anker-Zeile
// 'hibiscus-gateway' (NOT-NULL-Referenzen bleiben erfuellt), Konten/Umsaetze laufen wie geplant
// ueber bank_accounts_discovered/bank_transactions.
db.exec(`
  -- Eine Zeile (id=1): Verbindung zum Hibiscus Payment Server. password_encrypted via crypto.js
  -- (leave-empty-keeps-existing wie office_send_credentials).
  CREATE TABLE IF NOT EXISTS bank_gateway_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    url TEXT NOT NULL DEFAULT 'https://localhost:8080',
    password_encrypted TEXT NOT NULL DEFAULT '',
    allow_self_signed INTEGER NOT NULL DEFAULT 1,
    sync_enabled INTEGER NOT NULL DEFAULT 0,
    sync_interval_min INTEGER NOT NULL DEFAULT 240,
    last_sync_at TEXT,
    last_sync_status TEXT NOT NULL DEFAULT '',
    updated_at TEXT,
    updated_by INTEGER REFERENCES users(id)
  );

  -- Zahlungsauftraege mit Lebenszyklus. Die Ausfuehrung uebernimmt Hibiscus (inkl. TAN);
  -- wir fuehren Entwurf -> Freigabe -> Einreichung -> Abgleich mit dem spaeteren Umsatz.
  -- end_to_end_id verbindet den Auftrag mit der tatsaechlichen Bankbuchung (Stufe-8-Abgleich).
  CREATE TABLE IF NOT EXISTS bank_payment_orders (
    id TEXT PRIMARY KEY,
    case_id TEXT REFERENCES cases(id),
    source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','debt','recurring')),
    source_ref TEXT NOT NULL DEFAULT '',
    konto_iban TEXT NOT NULL DEFAULT '',
    empfaenger_name TEXT NOT NULL DEFAULT '',
    empfaenger_iban TEXT NOT NULL DEFAULT '',
    empfaenger_bic TEXT NOT NULL DEFAULT '',
    betrag_cents INTEGER NOT NULL DEFAULT 0,
    zweck TEXT NOT NULL DEFAULT '',
    termin TEXT NOT NULL DEFAULT '',
    end_to_end_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'entwurf'
      CHECK(status IN ('entwurf','freigegeben','eingereicht','ausgefuehrt','fehler','storniert')),
    status_detail TEXT NOT NULL DEFAULT '',
    hibiscus_auftrag_id TEXT NOT NULL DEFAULT '',
    matched_tx_id TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    approved_by INTEGER REFERENCES users(id),
    approved_by_name TEXT NOT NULL DEFAULT '',
    approved_at TEXT,
    submitted_at TEXT,
    updated_at TEXT
  );

  -- Intervall-Zahlungen ("Intervall statt Dauerauftrag"): der taegliche Lauf erzeugt aus
  -- faelligen Eintraegen ENTWUERFE in bank_payment_orders - nie eine stille Einreichung.
  -- Eingereicht wird gesammelt (eine TAN je Konto) oder einzeln, immer durch eine Person.
  CREATE TABLE IF NOT EXISTS bank_recurring_payments (
    id TEXT PRIMARY KEY,
    case_id TEXT REFERENCES cases(id),
    konto_iban TEXT NOT NULL DEFAULT '',
    empfaenger_name TEXT NOT NULL DEFAULT '',
    empfaenger_iban TEXT NOT NULL DEFAULT '',
    empfaenger_bic TEXT NOT NULL DEFAULT '',
    betrag_cents INTEGER NOT NULL DEFAULT 0,
    zweck TEXT NOT NULL DEFAULT '',
    intervall TEXT NOT NULL DEFAULT 'monatlich'
      CHECK(intervall IN ('woechentlich','monatlich','vierteljaehrlich','halbjaehrlich','jaehrlich')),
    ausfuehrungstag INTEGER NOT NULL DEFAULT 1,
    start_date TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    next_due TEXT NOT NULL DEFAULT '',
    aktiv INTEGER NOT NULL DEFAULT 1,
    notiz TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  );
`);
// Hibiscus-Erweiterungen an den Bestandstabellen. dedupe_hash bleibt der UNIQUE-Anker; bei
// Hibiscus-Umsaetzen ist er 'hx:'+Umsatz-ID (bankstabil - die inhaltsbasierten Hashes brechen,
// sobald die Bank den Verwendungszweck nachformatiert).
addColumnIfMissing('bank_accounts_discovered', 'hibiscus_id', "hibiscus_id TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('bank_accounts_discovered', 'saldo', 'saldo REAL');
addColumnIfMissing('bank_accounts_discovered', 'saldo_date', "saldo_date TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('bank_accounts_discovered', 'currency', "currency TEXT NOT NULL DEFAULT 'EUR'");
addColumnIfMissing('bank_accounts_discovered', 'holder', "holder TEXT NOT NULL DEFAULT ''");
// Standard bleibt die automatische IBAN-Zuordnung aus den Fall-Stammdaten. Im Modus "manual"
// ueberschreibt manual_case_id diese Zuordnung; NULL bedeutet dann bewusst "Buero / nicht
// zugeordnet". So kann ein Nutzer auch eine automatische Zuordnung gezielt aufheben.
addColumnIfMissing('bank_accounts_discovered', 'case_assignment_mode',
  "case_assignment_mode TEXT NOT NULL DEFAULT 'auto' CHECK(case_assignment_mode IN ('auto','manual'))");
addColumnIfMissing('bank_accounts_discovered', 'manual_case_id', 'manual_case_id TEXT REFERENCES cases(id)');
addColumnIfMissing('bank_accounts_discovered', 'manual_case_updated_at', 'manual_case_updated_at TEXT');
addColumnIfMissing('bank_accounts_discovered', 'manual_case_updated_by',
  'manual_case_updated_by INTEGER REFERENCES users(id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_bank_accounts_manual_case ON bank_accounts_discovered(manual_case_id)');
addColumnIfMissing('bank_transactions', 'hibiscus_id', "hibiscus_id TEXT NOT NULL DEFAULT ''");
// Tagesmarke des automatischen Intervall-Laufs (der Scheduler erzeugt Entwuerfe nur 1x taeglich).
addColumnIfMissing('bank_gateway_config', 'last_recurring_run', "last_recurring_run TEXT NOT NULL DEFAULT ''");
// HINWEIS: die Nachruestung von mcp_clients.allowed_scopes stand frueher HIER - also VOR dem
// CREATE TABLE mcp_clients weiter unten. Auf einer bestehenden Datenbank fiel das nicht auf
// (die Tabelle gab es ja schon), auf einer FRISCHEN Datenbank brach der Serverstart dagegen mit
// "SqliteError: no such table: mcp_clients" ab. Sie steht jetzt direkt hinter dem CREATE TABLE
// (siehe unten). Regel fuer alle kuenftigen Aenderungen: addColumnIfMissing/CREATE INDEX/ALTER
// gehoeren IMMER hinter das CREATE TABLE ihrer Tabelle - die Datei wird beim Laden von oben nach
// unten ausgefuehrt.

// ===== MCP-Server (KI-Fernzugriff, 2026-07-26 - PLAN-MCP-Server.md) =====
// OAuth-2.1-Fundament (Clients via Dynamic Client Registration, Codes mit PKCE S256, Tokens mit
// Rotation) + Vorschlags-Zwischenspeicher (Bestaetigungsmechanik: der Schreibvorgang nimmt seine
// WERTE aus dem serverseitigen Vorschlag, vom Client kommt nur die Auswahl) + Aufrufprotokoll.
// Alle Token/Codes werden NUR als SHA-256-Hash gespeichert.
db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    enabled INTEGER NOT NULL DEFAULT 1,
    public_url TEXT NOT NULL DEFAULT '',
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS mcp_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    redirect_uris_json TEXT NOT NULL DEFAULT '[]',
    secret_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS mcp_auth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    code_challenge TEXT NOT NULL,
    resource TEXT NOT NULL DEFAULT '',
    redirect_uri TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS mcp_tokens (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('access','refresh')),
    token_hash TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    resource TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    rotated_from TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS mcp_proposals (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    client_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    case_id TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'offen'
      CHECK(status IN ('offen','uebernommen','verworfen','verfallen')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT,
    result_json TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS mcp_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER,
    client_id TEXT NOT NULL DEFAULT '',
    tool TEXT NOT NULL DEFAULT '',
    ok INTEGER NOT NULL DEFAULT 1,
    case_id TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT ''
  );
`);
// Nachruestung an mcp_clients - MUSS hinter dem CREATE TABLE oben stehen (siehe Hinweis weiter
// oben): '' = uneingeschraenkt; sonst Space-Liste (nachtraegliche Einschraenkung je Client).
addColumnIfMissing('mcp_clients', 'allowed_scopes', "allowed_scopes TEXT NOT NULL DEFAULT ''");
try { db.prepare('INSERT OR IGNORE INTO mcp_settings (id) VALUES (1)').run(); } catch (_e) { /* idempotent */ }
// Anker-Verbindung fuer die NOT-NULL-Referenzen der Bestandstabellen.
try {
  db.prepare(`INSERT OR IGNORE INTO bank_connections (id, scope, bank_name, status)
    VALUES ('hibiscus-gateway', 'office', 'Hibiscus Payment Server', 'neu')`).run();
  // Rueckfallweg ohne FinTS: manuell hochgeladene MT940/CAMT-Dateien haengen an dieser Anker-
  // Verbindung, damit bank_transactions.connection_id referenziell sauber bleibt.
  db.prepare(`INSERT OR IGNORE INTO bank_connections (id, scope, bank_name, status)
    VALUES ('datei-import', 'office', 'Kontoauszugs-Dateien (MT940/CAMT)', 'neu')`).run();
} catch (_e) { /* Tabelle existiert immer; IGNORE deckt Wiederholungen */ }

// Site-Profil-Nutzungsstatistik (Feature v0.2.0 #11): Anwendungszahl + Feld-Treffer/-Fehlschlaege
// je Profil -> "veraltet?"-Warnung, wenn die Trefferquote sinkt (Website hat sich geaendert).
addColumnIfMissing('site_profiles', 'apply_count', 'apply_count INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('site_profiles', 'field_hits', 'field_hits INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('site_profiles', 'field_misses', 'field_misses INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('site_profiles', 'last_applied_at', "last_applied_at TEXT NOT NULL DEFAULT ''");

// ===== E-Mail-Baustein (Nutzerwunsch 2026-07-18): vollwertiges Postfach im Client =====
// mail_accounts: mehrere Konten von Anfang an - klassisches IMAP/SMTP (GMX, Web.de, Gmail per
// App-Passwort ...) ODER kind='microsoft' (liest/sendet ueber die Graph-Kalenderverbindung, weil
// Basic-Auth-IMAP bei M365 abgeschaltet ist). Passwoerter AES-verschluesselt wie smtp_config.
// Sichtbarkeit wie calendar_connections: private sieht nur der Eigentuemer, public das ganze Buero.
// folder_prefs_json: Ordner-Darstellung je Konto {sortMode:'manual'|'alpha', order:[pfade]}.
// mail_drafts: Entwuerfe + Postausgang LOKAL in der DB (einheitlich fuer alle Kontoarten, statt
// je Anbieter andere Entwurfs-Mechaniken) - data_json ist der opake Composer-Zustand des Clients.
db.exec(`
  CREATE TABLE IF NOT EXISTS mail_accounts (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'imap',
    email TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    imap_host TEXT NOT NULL DEFAULT '',
    imap_port INTEGER NOT NULL DEFAULT 993,
    imap_secure INTEGER NOT NULL DEFAULT 1,
    imap_user TEXT NOT NULL DEFAULT '',
    imap_pass_encrypted TEXT NOT NULL DEFAULT '',
    smtp_host TEXT NOT NULL DEFAULT '',
    smtp_port INTEGER NOT NULL DEFAULT 587,
    smtp_secure INTEGER NOT NULL DEFAULT 0,
    smtp_user TEXT NOT NULL DEFAULT '',
    smtp_pass_encrypted TEXT NOT NULL DEFAULT '',
    graph_connection_id TEXT NOT NULL DEFAULT '',
    owner_user_id INTEGER REFERENCES users(id),
    visibility TEXT NOT NULL DEFAULT 'private',
    sort_order INTEGER NOT NULL DEFAULT 0,
    folder_prefs_json TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mail_drafts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'draft',
    data_json TEXT NOT NULL DEFAULT '{}',
    owner_user_id INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Mail Tier 1-3 (Nutzerwunsch 2026-07-18): Signatur + Antwort-an je Konto, geplanter Versand
// (send_at an Entwürfen), E-Mail-Vorlagen, persönliche Mail-Einstellungen und Eingangs-Regeln.
addColumnIfMissing('mail_accounts', 'signature', "signature TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('mail_accounts', 'reply_to', "reply_to TEXT NOT NULL DEFAULT ''");
/* Signaturquelle je Konto (Nutzerentscheidung 28.08.2026). Vorher gab es DREI Signaturspeicher
   mit fester, unsichtbarer Rangfolge: Konto > persoenlich > Buero - man sah nie, welche zieht.
   Jetzt zwei Texte (Buero, persoenlich) und je Konto die sichtbare Wahl, welcher gilt.
   'office' als Vorgabe: bei der Umstellung geht JEDES Konto auf die Buero-Signatur, damit
   zunaechst niemand ohne Signatur sendet. Die Stufe 'Konto-Signatur' entfaellt ersatzlos;
   vorhandene Texte werden einmalig entfernt (bewusste Entscheidung, siehe Migration unten). */
addColumnIfMissing('mail_accounts', 'signature_source', "signature_source TEXT NOT NULL DEFAULT 'office'");
/* Einmalige Umstellung: die abgeloesten Konto-Signaturen wandern in eine Merkzeile, damit das
   Buero sie beim ersten Oeffnen noch einmal sehen und bei Bedarf kopieren kann - danach sind sie
   fort. Ohne diesen Zwischenschritt waere das Verwerfen unwiderruflich und unsichtbar. */
try {
  const offen = db.prepare("SELECT id, label, signature FROM mail_accounts WHERE signature IS NOT NULL AND TRIM(signature) <> ''").all();
  if (offen.length) {
    db.prepare("INSERT OR REPLACE INTO office_json (key, data_json) VALUES ('mail_signaturen_abgeloest', ?)")
      .run(JSON.stringify({ stand: new Date().toISOString(), konten: offen }));
    db.prepare("UPDATE mail_accounts SET signature = '' WHERE TRIM(signature) <> ''").run();
  }
} catch (_e) { /* Beiwerk - darf den Start nie verhindern */ }
addColumnIfMissing('mail_drafts', 'send_at', "send_at TEXT NOT NULL DEFAULT ''");
db.exec(`
  CREATE TABLE IF NOT EXISTS mail_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    owner_user_id INTEGER REFERENCES users(id),
    visibility TEXT NOT NULL DEFAULT 'private',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Persönliche Mail-Einstellungen je Nutzer (Sendeverzögerung, Standardkonto, Zitier-/Signatur-
  -- Position, Warnungen, Standard-Bcc, persönliche Signatur ...) als opaker JSON-Blob.
  CREATE TABLE IF NOT EXISTS mail_prefs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    prefs_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Eingangs-Regeln (serverseitig im Mail-Watcher angewendet): match_field/op/value -> action.
  -- account_id='' = für alle sichtbaren Konten; visibility wie überall (privat/büroweit).
  CREATE TABLE IF NOT EXISTS mail_rules (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER REFERENCES users(id),
    visibility TEXT NOT NULL DEFAULT 'private',
    account_id TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    match_field TEXT NOT NULL DEFAULT 'from',
    match_op TEXT NOT NULL DEFAULT 'contains',
    match_value TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT 'move',
    action_target TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Wiedervorlage (Snooze): Mail liegt bis wake_at im "Wiedervorlage"-Ordner (folder), danach holt
  -- der Scheduler sie per Message-ID-Suche zurueck in den Posteingang (UIDs aendern sich beim Move).
  CREATE TABLE IF NOT EXISTS mail_snoozes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL DEFAULT '',
    folder TEXT NOT NULL DEFAULT '',
    message_id TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    wake_at TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    owner_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
// Automatisches Leeren (Tage; 0 = aus) je Konto fuer Papierkorb und Spam.
addColumnIfMissing('mail_accounts', 'trash_retention_days', 'trash_retention_days INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('mail_accounts', 'junk_retention_days', 'junk_retention_days INTEGER NOT NULL DEFAULT 0');
// Nachlade-Fenster (0=Immer/alle) + lokale Speicherdauer des Envelope-Caches (0=Immer behalten).
addColumnIfMissing('calendar_events', 'reminder_at', "reminder_at TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('mail_accounts', 'sync_window_days', 'sync_window_days INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('mail_accounts', 'cache_retention_days', 'cache_retention_days INTEGER NOT NULL DEFAULT 31');
// Eigene Farbe des Kontos (Farbpunkt in der Seitenleiste; per Klick im Client wählbar).
addColumnIfMissing('mail_accounts', 'color', "color TEXT NOT NULL DEFAULT ''");
// Lokaler Envelope-Zwischenspeicher (Nutzerwunsch "Mails auf meinem Server mitspeichern"): je
// Konto/Ordner/UID die Listen-Metadaten (Absender/Betreff/Datum/Flags). Dient dem sofortigen
// Wiederanzeigen und als Offline-Rückfall, wenn der Mailserver kurz nicht erreichbar ist. Retention
// steuert die Aufbewahrung; der Nachrichtentext selbst wird weiterhin live geladen.
db.exec(`
  CREATE TABLE IF NOT EXISTS mail_cache (
    account_id TEXT NOT NULL,
    folder TEXT NOT NULL,
    uid TEXT NOT NULL,
    env_json TEXT NOT NULL DEFAULT '{}',
    msg_date TEXT NOT NULL DEFAULT '',
    cached_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (account_id, folder, uid)
  );
  CREATE INDEX IF NOT EXISTS idx_mail_cache_acc_folder ON mail_cache(account_id, folder, msg_date);
`);

// Vereinheitlichung Mail (Nutzerwunsch 2026-07-18): Zugangsdaten liegen NUR noch in mail_accounts,
// der bueroweite Systemversand (smtp_config) verweist per send_account_id auf ein Konto. Die alten
// Zugangsdaten-Spalten bleiben als Fallback stehen (sqlite-Spalten-Drop lohnt nicht; mail.js nutzt
// sie nur noch, wenn kein/ein geloeschtes Konto referenziert ist).
addColumnIfMissing('smtp_config', 'send_account_id', "send_account_id TEXT NOT NULL DEFAULT ''");

/* ---------------------------------------------------------------------------
   Fallbezogene Sichtbarkeit (2026-07-26, nach Audit).
   Vorher gab es KEINE Fall-Zuordnung im Datenmodell: jeder angemeldete Nutzer konnte ueber
   /api/cases, /api/inbox, /api/betreuungsuebersicht usw. saemtliche Fallakten des Bueros lesen.
   Die einzige Pruefung sass im Dokumentenmodul und verglich den Anzeigenamen per Teilstring
   gegen das Freitextfeld "rechtlicherBetreuer" - fehleranfaellig in beide Richtungen.
   Ab jetzt: owner_user_id als echte Zuordnung + case_access fuer gezielte Freigaben.
   --------------------------------------------------------------------------- */
const ownerNeu = addColumnIfMissing('cases', 'owner_user_id', 'owner_user_id INTEGER');
db.exec(`
  CREATE TABLE IF NOT EXISTS case_access (
    case_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    level TEXT NOT NULL DEFAULT 'read',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by INTEGER,
    PRIMARY KEY (case_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_case_access_user ON case_access(user_id);
  CREATE INDEX IF NOT EXISTS idx_cases_owner ON cases(owner_user_id);
`);
if (ownerNeu) {
  /* Erstzuweisung, ausdruecklich so gewuenscht: alle Bestandsfaelle gehen an den ersten Admin,
     von dort werden sie in der Oberflaeche verteilt. Laeuft genau einmal (siehe ownerNeu). */
  const ersterAdmin = db.prepare('SELECT id, username FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get();
  if (ersterAdmin) {
    const r = db.prepare('UPDATE cases SET owner_user_id = ? WHERE owner_user_id IS NULL').run(ersterAdmin.id);
    console.log(`[Fallrechte] Erstzuweisung: ${r.changes} Fall/Faelle dem Konto "${ersterAdmin.username}" zugeordnet. Verteilung in der Fallverwaltung.`);
  } else {
    console.log('[Fallrechte] Kein Admin-Konto gefunden - alle Faelle bleiben ohne Eigentuemer (und damit fuer alle sichtbar).');
  }
}
// Einmalige Uebernahme: bestehende Alt-Zugangsdaten werden zu einem bueroweiten Konto
// "Systemversand (uebernommen)" und referenziert - der laufende Versand wechselt nahtlos.
try {
  const smtpRow = db.prepare('SELECT * FROM smtp_config WHERE id = 1').get();
  const hasLegacy = smtpRow && (smtpRow.transport === 'microsoft' ? !!smtpRow.graph_connection_id : !!smtpRow.host);
  if (smtpRow && !smtpRow.send_account_id && hasLegacy) {
    const nodeCrypto = require('crypto');
    const accId = nodeCrypto.randomUUID();
    const fm = String(smtpRow.from_address || '').match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
    const accEmail = fm ? fm[2].trim() : String(smtpRow.from_address || '').trim();
    const accName = fm ? fm[1].trim() : '';
    const isMs = smtpRow.transport === 'microsoft';
    db.prepare(`INSERT INTO mail_accounts
      (id, label, kind, email, from_name, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_encrypted, graph_connection_id, owner_user_id, visibility, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,'public',(SELECT COALESCE(MAX(sort_order),0)+1 FROM mail_accounts))`).run(
      accId, 'Systemversand (übernommen)', isMs ? 'microsoft' : 'imap', accEmail, accName,
      isMs ? '' : (smtpRow.host || ''), smtpRow.port || 587, smtpRow.secure ? 1 : 0,
      isMs ? '' : (smtpRow.username || ''), isMs ? '' : (smtpRow.password_encrypted || ''),
      isMs ? (smtpRow.graph_connection_id || '') : ''
    );
    db.prepare("UPDATE smtp_config SET send_account_id = ?, updated_at = datetime('now') WHERE id = 1").run(accId);
  }
} catch (_e) { /* Die Uebernahme darf den Serverstart nie verhindern - Fallback bleibt die Alt-Config. */ }

// Dokumente-Modul (Plan D1, 2026-07-25): Schema liegt in einer eigenen Datei, damit der
// Testharnisch (DB-Kopie) exakt dasselbe Schema anlegt - siehe documents-schema.js.
require('../modules/documents/schema').ensure(db);

// Nutzerbezogene Oberflaechenpraeferenzen. Fachlich neutrale UI-Zustaende wie die zuletzt
// verwendeten Filter der Falluebersicht gehoeren weder in eine Fallakte noch in Modul-Tabellen.
// Der zusammengesetzte Schluessel trennt dieselbe Praeferenz sauber zwischen Benutzerkonten.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_ui_prefs (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pref_key TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, pref_key)
  );
  CREATE INDEX IF NOT EXISTS idx_user_ui_prefs_key ON user_ui_prefs(pref_key);
`);

/* ---------------------------------------------------------------------------
   Erstinbetriebnahme (Nutzerauftrag 2026-07-26).
   Auf einer komplett leeren Datenbank gibt es weder Nutzerkonto noch Buerodaten - die App waere
   unbedienbar. server/routes/setup.js oeffnet dafuer EINMALIG einen Einrichtungsweg unter /setup.
   Diese Tabelle ist die dauerhafte Marke "wurde eingerichtet".

   Warum eine eigene Marke und nicht einfach "keine Zeile in users"?
   Weil der Einrichtungsweg einen Administrator anlegt. Waere "Tabelle users leer" das einzige
   Kriterium, liesse sich der Weg durch ein DELETE auf users jederzeit wieder oeffnen - eine
   Hintertuer zum Anlegen eines Administrators. Die Marke ueberlebt genau das.
   Zweite, davon unabhaengige Absicherung in routes/setup.js: sqlite_sequence merkt sich fuer die
   AUTOINCREMENT-Tabelle users den hoechsten je vergebenen Schluessel; ein DELETE setzt ihn NICHT
   zurueck. Es muessten also beide Spuren zugleich manipuliert werden.
   --------------------------------------------------------------------------- */
db.exec(`
  CREATE TABLE IF NOT EXISTS app_setup (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_by TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT ''
  );
`);
/* Bestandsinstallationen versiegeln: gibt es bereits Nutzer, aber noch keine Marke, wird sie beim
   ersten Start nach diesem Update gesetzt. Das ist der EINZIGE Schreibvorgang dieses Bausteins auf
   einer bestehenden Installation und beruehrt ausschliesslich die neue Tabelle app_setup - keine
   vorhandene Zeile wird geaendert, keine Pflichtangabe kommt hinzu, der Nutzer merkt nichts davon.
   Ohne diesen Schritt haetten gewachsene Installationen gar keine Marke. */
try {
  const hatNutzer = db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
  const hatMarke = !!db.prepare('SELECT id FROM app_setup WHERE id = 1').get();
  if (hatNutzer && !hatMarke) {
    db.prepare('INSERT INTO app_setup (id, completed_by, note) VALUES (1, ?, ?)')
      .run('', 'Bestandsinstallation - Marke beim ersten Start nach dem Update gesetzt.');
  }
} catch (_e) { /* darf den Serverstart nie verhindern */ }

/* ---------------------------------------------------------------------------
   Nutzer-zu-Nutzer-Chat (Nutzerwunsch 2026-08-12).
   Büro-interner Chat zwischen den Konten dieses Büros: Direktnachrichten und Gruppen,
   optional mit Fall-/Dokument-Verweisen (refs_json), kleinen Anlagen (BLOB in der DB,
   wie intake_files - der Dokumentenspeicher ist für Akten, nicht für Chat-Schnipsel)
   und KI-Beiträgen (kind='ki': sender_user_id ist NULL, ai_requested_by hält fest,
   WER die KI gefragt hat). direct_key ('kleinereUserId:groessereUserId') macht die
   Direkt-Unterhaltung zweier Nutzer per UNIQUE dedupe-sicher; Gruppen haben NULL.
   last_read_at je Teilnehmer trägt die Ungelesen-Zählung; chat_user_status hält den
   MANUELL gewählten Präsenzstatus (an/abwesend/beschäftigt/unsichtbar) - ob jemand
   tatsächlich verbunden ist, weiß nur die WebSocket-Schicht (realtime/websocket.js).
   --------------------------------------------------------------------------- */
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'direct',
    title TEXT NOT NULL DEFAULT '',
    direct_key TEXT UNIQUE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_participants (
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_read_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),
    kind TEXT NOT NULL DEFAULT 'user',
    sender_user_id INTEGER REFERENCES users(id),
    ai_requested_by INTEGER REFERENCES users(id),
    body TEXT NOT NULL DEFAULT '',
    refs_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES chat_messages(id),
    name TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    data BLOB
  );

  CREATE TABLE IF NOT EXISTS chat_user_status (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'online',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
`);

/* ---------------------------------------------------------------------------
   Personenregister (Etappe 1 des Personen-Plans, 29.08.2026).
   EINE Zeile je Mensch - Nutzerkonto, Mitarbeiter/in ohne Konto oder externe Person.
   Ein Konto ist ein VERWEIS auf die Person (user_id), kein eigener Personendatensatz.
   Die Kennung ("MA 1") ist das stabile Pseudonym fuer die anonymisierten Gehaltsangaben:
   eindeutig erzwungen (Teilindex) und nie wiederverwendet - interne Personen werden deshalb
   grundsaetzlich deaktiviert statt geloescht, ihre Kennung bleibt vergeben.
   --------------------------------------------------------------------------- */
db.exec(`
  CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    art TEXT NOT NULL DEFAULT 'intern',
    user_id INTEGER REFERENCES users(id),
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    salutation TEXT NOT NULL DEFAULT '',
    funktion TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    mobile TEXT NOT NULL DEFAULT '',
    kennung TEXT NOT NULL DEFAULT '',
    joined_at TEXT NOT NULL DEFAULT '',
    left_at TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    aktiv INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_user ON persons(user_id) WHERE user_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_kennung ON persons(kennung) WHERE kennung <> '';
`);
// Konto-/Rechte-Spalten aus dem Mitarbeitende-Blatt der Buero-Excel fuer Personen OHNE Konto
// (frueher office_employees.extra_json) - beliebiges JSON, unveraendert durchgereicht, bis ein
// Konto existiert. Nachruest-Spalte, damit bereits angelegte persons-Tabellen sie bekommen.
addColumnIfMissing('persons', 'extra_json', "extra_json TEXT NOT NULL DEFAULT ''");
// Etappe 3 (29.08.2026): Personalkosten-Posten verweisen auf die Person - der Betreff bleibt
// reine Beschreibung. Aufgeloest wird JE BETRACHTER (Klarnamen-Recht -> Name, sonst nur die
// Kennung als Pseudonym; die personId verlaesst den Server dann gar nicht erst).
addColumnIfMissing('finance_entries', 'person_id', 'person_id TEXT');
/* "Fuehrt eigene Betreuungen" (30.08.2026, Nutzerentscheidung): bis hierhin RIET die App aus
   dem Freitext der Funktion (/betreuer/i), wer rechtliche:r Betreuer:in ist - "Rechtliche
   Betreuung" oder ein Tippfehler kippten die Erkennung still. Jetzt ein ausdrueckliches Feld.
   Gespiegelt in users (dauerhafte Kompatibilitaetsschicht, siehe persons-routes-Kopf). */
addColumnIfMissing('persons', 'ist_betreuer', 'ist_betreuer INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'ist_betreuer', 'ist_betreuer INTEGER NOT NULL DEFAULT 0');
// Demo-Modus (30.08.2026): Vorfuehrkonten Demo1..Demo20 sind echte Nutzerzeilen (der Chat
// haengt an users), aber strikt markiert - Sichtbarkeit und Login laufen ueber dieses Flag.
// Bewusst als LETZTE users-Spalte, damit der Recovery-Spaltenvertrag (portable-data.js)
// die Schemareihenfolge weiter abbildet.
addColumnIfMissing('users', 'is_demo', 'is_demo INTEGER NOT NULL DEFAULT 0');
/* Einmalige Ableitung aus dem Bestand: genau die Regel, die bisher zur Laufzeit galt.
   Marker in office_json, damit ein spaeter bewusst ENTFERNTES Haekchen nicht beim naechsten
   Start zurueckkehrt. */
(function betreuerHaekchenAusFunktionAbleiten() {
  const marker = db.prepare("SELECT key FROM office_json WHERE key = 'personen_betreuer_flag'").get();
  if (marker) return;
  db.transaction(() => {
    db.prepare("UPDATE persons SET ist_betreuer = 1 WHERE funktion LIKE '%betreuer%' COLLATE NOCASE").run();
    db.prepare("UPDATE users SET ist_betreuer = 1 WHERE job_title LIKE '%betreuer%' COLLATE NOCASE").run();
    db.prepare("INSERT INTO office_json (key, data_json) VALUES ('personen_betreuer_flag', ?)")
      .run(JSON.stringify({ at: new Date().toISOString() }));
  })();
})();

/* Uebernahme des Bestands ins Personenregister - SELBSTHEILEND (Bugjagd 30.08.2026):
   Die erste Fassung lief "nur auf leerer persons-Tabelle" und verschluckte Fehler. Das riss
   zwei Loecher: (1) scheiterte die Uebernahme (z. B. SQLITE_BUSY), setzte die Wertemigration
   darunter trotzdem ihren Einmal-Marker - die Namensschluessel blieben fuer immer stehen.
   (2) Legte danach irgendwer eine Person an (die Wertemigration selbst tut das fuer Externe!),
   blockierte der Leerheits-Check jeden weiteren Versuch, und der Abbau-Sicherheitsgurt
   ("persons nicht leer => uebernommen") warf office_employees samt NIE uebernommener
   Mitarbeiter weg - endgueltig, denn Vor-Register-Sicherungen sind bewusst gesperrt.
   Deshalb jetzt: fill-only je Bestandsstueck statt Alles-oder-nichts-Gate, Uebernahme und
   DROP der Alt-Tabelle in EINER Transaktion, und Fehler werfen DURCH (der Serverstart
   scheitert sichtbar, der naechste Start versucht es erneut - nie stiller Datenverlust).
   1. Jedes Nutzerkonto OHNE persons-Zeile wird eine Person (Profilfelder wandern mit).
   2. Existiert office_employees noch, haengt sich jeder Eintrag per Namensabgleich an die
      vorhandene INTERNE Person (fehlende Felder auffuellen) oder wird eine eigene Person
      ohne Konto; direkt danach faellt die Alt-Tabelle - im selben Commit.
   Kennungs-Kollisionen (zweimal "MA 1"): die zweite Person verliert die Kennung - das ist
   ehrlicher als stilles Umnummerieren, der Admin sieht die Luecke im Personen-Menue.
   ALTE SICHERUNGEN: bewusst KEINE Altlasten-Kompatibilitaet (Nutzerentscheidung 29.08.2026,
   "App in Entwicklung") - migriert wird nur die LIVE-Datenbank. */
(function personenBestandUebernehmen() {
  const ohnePerson = db.prepare(`SELECT u.* FROM users u
    LEFT JOIN persons p ON p.user_id = u.id
    WHERE p.id IS NULL AND COALESCE(u.is_demo, 0) = 0`).all();
  const altTabelle = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='office_employees'").get();
  if (!ohnePerson.length && !altTabelle) return;
  const normName = (a, b) => (String(a || '').trim() + ' ' + String(b || '').trim())
    .toLowerCase().replace(/\s+/g, ' ').trim();
  const einf = db.prepare(`INSERT INTO persons (id, art, user_id, first_name, last_name, salutation,
    funktion, email, phone, mobile, kennung, joined_at, left_at, notes, aktiv)
    VALUES (@id, 'intern', @userId, @firstName, @lastName, @salutation, @funktion, @email, @phone,
      @mobile, @kennung, @joinedAt, @leftAt, @notes, @aktiv)`);
  /* Vergebene Kennungen aus dem BESTEHENDEN Register vorbelegen - der Lauf darf auch auf
     teilbefuelltem Register keine Dublette erzeugen (partieller UNIQUE-Index wuerfe sonst). */
  const habenKennung = new Set(db.prepare("SELECT kennung FROM persons WHERE kennung <> ''")
    .all().map((r) => r.kennung.toLowerCase()));
  const kennungFrei = (k) => {
    k = String(k || '').trim();
    if (!k) return '';
    if (habenKennung.has(k.toLowerCase())) return '';
    habenKennung.add(k.toLowerCase());
    return k;
  };
  db.transaction(() => {
    /* Namensabgleich gegen alle INTERNEN Personen (auch die aus frueheren Teil-Laeufen) -
       Externe zaehlen nicht, sonst haengte sich ein Mitarbeiter an einen externen Betreuer. */
    const proName = new Map();
    for (const p of db.prepare("SELECT id, first_name, last_name FROM persons WHERE art = 'intern'").all()) {
      const key = normName(p.first_name, p.last_name);
      if (key && !proName.has(key)) proName.set(key, p.id);
    }
    for (const u of ohnePerson) {
      const id = require('crypto').randomUUID();
      einf.run({
        id, userId: u.id, firstName: u.first_name || '', lastName: u.last_name || '',
        salutation: u.salutation || '', funktion: u.job_title || '', email: u.email || '',
        phone: u.phone || '', mobile: u.mobile || '', kennung: kennungFrei(u.ma_kennung),
        joinedAt: u.joined_at || '', leftAt: u.left_at || '', notes: u.notes || '',
        aktiv: u.active === 0 ? 0 : 1
      });
      const key = normName(u.first_name, u.last_name);
      if (key && !proName.has(key)) proName.set(key, id);
    }
    for (const e of altTabelle ? db.prepare('SELECT * FROM office_employees ORDER BY sort_order, created_at').all() : []) {
      const key = normName(e.first_name, e.last_name);
      const vorhandene = key ? proName.get(key) : null;
      if (vorhandene) {
        /* Dublette Nutzer+Mitarbeiter: an der Person nur AUFFUELLEN, nie ueberschreiben -
           das Nutzerprofil ist der juengere, gepflegtere Stand. */
        const p = db.prepare('SELECT * FROM persons WHERE id = ?').get(vorhandene);
        db.prepare(`UPDATE persons SET funktion = ?, email = ?, phone = ?, kennung = ?,
          updated_at = datetime('now') WHERE id = ?`).run(
          p.funktion || e.role || '', p.email || e.email || '', p.phone || e.phone || '',
          p.kennung || kennungFrei(e.ma_kennung), vorhandene);
      } else {
        const id = require('crypto').randomUUID();
        einf.run({
          id, userId: null, firstName: e.first_name || '', lastName: e.last_name || '',
          salutation: '', funktion: e.role || '', email: e.email || '', phone: e.phone || '',
          mobile: '', kennung: kennungFrei(e.ma_kennung), joinedAt: '', leftAt: '', notes: '', aktiv: 1
        });
        if (e.extra_json) db.prepare('UPDATE persons SET extra_json = ? WHERE id = ?').run(e.extra_json, id);
        if (key && !proName.has(key)) proName.set(key, id);
      }
    }
    /* Etappe 4: die Alt-Tabelle faellt IM SELBEN COMMIT wie ihre Uebernahme - entweder beides
       oder nichts. Ein separater "Sicherheitsgurt" ist damit ueberfluessig (und war loechrig). */
    if (altTabelle) db.exec('DROP TABLE office_employees');
  })();
})();

/* ---------------------------------------------------------------------------
   Etappe 2 (29.08.2026): Bestandswerte auf die Personen-ID umschreiben.
   Betroffen sind die drei Namensschluessel-Ablagen: Fallfelder (rechtlicherBetreuer/vertretung
   in stammdaten_json), der Vertretungsplan (person/vertretung + das kurzlebige externe[]-
   Verzeichnis vom Vormittag) und die Qualifikationen (entries-Schluessel).
   'extern:<Name>'-Werte werden zu echten Register-Personen (art extern).
   Laeuft EINMAL (Marker in office_json), in einer Transaktion. Nicht aufloesbare Werte
   bleiben unveraendert stehen - der Client zeigt sie als "(nicht in Liste)", das ist
   ehrlicher als stilles Leeren. ALTE SICHERUNGEN werden bewusst nicht bedient
   (Nutzerentscheidung: keine Altlasten-Kompatibilitaet). */
(function personenWerteAufIdUmschreiben() {
  try {
    const marker = db.prepare("SELECT data_json FROM office_json WHERE key = 'personen_e2'").get();
    if (marker) return;
    const alle = db.prepare('SELECT * FROM persons').all();
    const normName = (a, b) => (String(a || '').trim() + ' ' + String(b || '').trim())
      .toLowerCase().replace(/\s+/g, ' ').trim();
    const proName = new Map();
    const ids = new Set();
    for (const p of alle) {
      ids.add(p.id);
      const k = normName(p.first_name, p.last_name);
      if (k && !proName.has(k)) proName.set(k, p.id);
    }
    const externAnlegen = db.prepare(`INSERT INTO persons (id, art, user_id, last_name, aktiv)
      VALUES (?, 'extern', NULL, ?, 1)`);
    const externeProName = new Map(alle.filter((p) => p.art === 'extern')
      .map((p) => [normName(p.first_name, p.last_name), p.id]));
    const ensureExtern = (name) => {
      name = String(name || '').trim();
      if (!name) return '';
      const k = normName('', name);
      if (externeProName.has(k)) return externeProName.get(k);
      const id = require('crypto').randomUUID();
      externAnlegen.run(id, name);
      externeProName.set(k, id);
      ids.add(id);
      return id;
    };
    const mapWert = (v) => {
      v = String(v == null ? '' : v).trim();
      if (!v) return '';
      if (ids.has(v)) return v;
      if (v.startsWith('extern:')) return ensureExtern(v.slice(7)) || v;
      return proName.get(v.toLowerCase().replace(/\s+/g, ' ')) || v;
    };
    db.transaction(() => {
      /* 1. Fallfelder. */
      for (const row of db.prepare('SELECT id, stammdaten_json FROM cases').all()) {
        let sd;
        try { sd = JSON.parse(row.stammdaten_json || '{}') || {}; } catch (_e) { continue; }
        let geaendert = false;
        for (const feld of ['rechtlicherBetreuer', 'vertretung']) {
          const alt = typeof sd[feld] === 'string' ? sd[feld] : '';
          if (!alt) continue;
          const neu = mapWert(alt);
          if (neu !== alt) { sd[feld] = neu; geaendert = true; }
        }
        if (geaendert) {
          db.prepare('UPDATE cases SET stammdaten_json = ? WHERE id = ?')
            .run(JSON.stringify(sd), row.id);
        }
      }
      /* 2. Vertretungsplan (+ externe[] ins Register ueberfuehren und aus dem Blob entfernen). */
      const vpRow = db.prepare("SELECT data_json FROM office_json WHERE key = 'vertretungsplan'").get();
      if (vpRow) {
        try {
          const vp = JSON.parse(vpRow.data_json || '{}') || {};
          (Array.isArray(vp.externe) ? vp.externe : []).forEach((e) => ensureExtern(e && e.name));
          delete vp.externe;
          vp.eintraege = (Array.isArray(vp.eintraege) ? vp.eintraege : []).map((e) => ({
            ...e, person: mapWert(e && e.person), vertretung: mapWert(e && e.vertretung),
          }));
          db.prepare("UPDATE office_json SET data_json = ?, updated_at = datetime('now') WHERE key = 'vertretungsplan'")
            .run(JSON.stringify(vp));
        } catch (_e) { /* kaputter Blob kippt die Migration nicht */ }
      }
      /* 3. Qualifikationen: entries-Schluessel. Ein Ziel-Schluessel, der schon belegt ist,
         laesst den alten Eintrag unangetastet (kein stilles Verschmelzen von Daten). */
      const qmRow = db.prepare("SELECT data_json FROM office_json WHERE key = 'qualifikationen'").get();
      if (qmRow) {
        try {
          const qm = JSON.parse(qmRow.data_json || '{}') || {};
          const entries = (qm.entries && typeof qm.entries === 'object') ? qm.entries : {};
          const neu = {};
          for (const [k, wert] of Object.entries(entries)) {
            const ziel = mapWert(k);
            if (ziel !== k && !entries[ziel] && !neu[ziel]) neu[ziel] = wert;
            else neu[k] = wert;
          }
          qm.entries = neu;
          db.prepare("UPDATE office_json SET data_json = ?, updated_at = datetime('now') WHERE key = 'qualifikationen'")
            .run(JSON.stringify(qm));
        } catch (_e) { /* dito */ }
      }
      db.prepare("INSERT INTO office_json (key, data_json) VALUES ('personen_e2', ?)")
        .run(JSON.stringify({ done: true, am: new Date().toISOString() }));
    })();
  } catch (error) {
    console.error('Personen-Wertemigration (Etappe 2) fehlgeschlagen:', error.message);
  }
})();

module.exports = db;
