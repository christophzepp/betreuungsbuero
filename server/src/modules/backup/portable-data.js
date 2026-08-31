'use strict';

const crypto = require('crypto');
const {
  DEMO_CASES,
  isDemoUsername,
  isDemoCaseId,
  isDemoCaseLabel
} = require('../demo/data-identities');

function identifier(value) {
  const name = String(value || '');
  if (!/^[a-z][a-z0-9_]*$/i.test(name)) throw new Error('Ungültiger Tabellen- oder Spaltenname.');
  return `"${name}"`;
}

/*
 * Eine Registrierung ist die einzige Quelle dafür, welche SQLite-Tabelle zu welchem
 * Sicherungsartefakt gehört. Die Gruppen haben bewusst unterschiedliche Inhalte:
 * - security/credentials: sicherheitsrelevante, verschlüsselt materialisierte Daten
 * - office: lesbares Büroabbild (ohne Dokumentbytes/Geheimnisse)
 * - calendar: das kleine Kalender-/Aufgabenabbild
 * - case: Tabellen, aus denen ein Fall anhand eines belastbaren Schlüssels gelesen werden kann
 * - module: rückwärtskompatibler Admin-Export der Fachdaten
 *
 * Eine Tabelle darf in mehreren Gruppen stehen. Neue Tabellen werden dadurch an genau einer
 * Stelle klassifiziert; Generator und Admin-Route können nicht mehr mit eigenen Listen driften.
 */
const TABLE_REGISTRY = Object.freeze([
  {
    key: 'users', table: 'users', groups: ['security'],
    // Nutzerkennungen werden von umfangreicher Fachhistorie referenziert. Beim
    // Restore werden fehlende Nutzer deshalb sicher neutralisiert statt gelöscht.
    replacePolicy: 'neutralize'
  },
  // Sitzungen sind absichtlich nur klassifiziert, aber in keinem portablen Artefakt:
  // nach einem Disaster-Restore müssen sich alle Nutzer neu anmelden.
  { key: 'sessions', table: 'sessions', groups: [], restore: false },
  { key: 'apiTokens', table: 'api_tokens', groups: ['security'], restorePolicy: 'explicit-token' },
  // Ab Schema 3 sind security und credentials disjunkt. Damit kann die Reihenfolge
  // zweier Teil-Restores nie mehr dieselbe Tabelle mit verschiedenen Generationen überschreiben.
  { key: 'smtpConfig', table: 'smtp_config', groups: ['credentials'] },
  {
    key: 'calendarConnections', table: 'calendar_connections', groups: ['credentials'],
    replacePolicy: 'neutralize'
  },
  { key: 'caldavConfig', table: 'caldav_config', groups: ['credentials'] },
  { key: 'officeAiConfig', table: 'office_ai_config', groups: ['credentials'] },
  { key: 'officeSendCredentials', table: 'office_send_credentials', groups: ['credentials'] },
  { key: 'userSettingsOverrides', table: 'user_settings_overrides', groups: ['credentials'] },
  { key: 'localModeDefaults', table: 'local_mode_defaults', groups: ['credentials'] },
  { key: 'mapSettings', table: 'map_settings', groups: ['credentials'] },
  {
    key: 'mailAccounts', table: 'mail_accounts', groups: ['credentials'],
    replacePolicy: 'neutralize'
  },
  { key: 'mailPrefs', table: 'mail_prefs', groups: ['security'] },
  { key: 'mailRules', table: 'mail_rules', groups: ['security'] },
  { key: 'mailSnoozes', table: 'mail_snoozes', groups: ['security'] },
  {
    key: 'bankConnections', table: 'bank_connections',
    groups: ['credentials', 'case'], caseColumn: 'case_id',
    replacePolicy: 'neutralize',
    caseOmitColumns: ['pin_encrypted']
  },
  { key: 'bankAccountsDiscovered', table: 'bank_accounts_discovered', groups: ['case'], caseVia: 'bank_accounts' },
  { key: 'bankTransactions', table: 'bank_transactions', groups: ['case'], caseVia: 'bank_connections' },
  { key: 'bankGatewayConfig', table: 'bank_gateway_config', groups: ['credentials'] },
  { key: 'mcpSettings', table: 'mcp_settings', groups: ['security'] },
  { key: 'mcpClients', table: 'mcp_clients', groups: ['security'] },
  { key: 'mcpTokens', table: 'mcp_tokens', groups: ['security'], restorePolicy: 'explicit-token' },
  { key: 'docWebdavTokens', table: 'doc_webdav_tokens', groups: ['security'], restorePolicy: 'explicit-token' },
  // Aufgaben-Feed-Tokens (PLAN-AUFGABEN-SYNC Etappe 4): gleiche Behandlung wie die übrigen
  // Token-Tabellen - nur auf ausdrücklichen Wunsch wiederherstellen.
  { key: 'feedTokens', table: 'feed_tokens', groups: ['security'], restorePolicy: 'explicit-token' },
  { key: 'docMounts', table: 'doc_mounts', groups: ['credentials', 'office'] },
  {
    key: 'caseAccess', table: 'case_access', groups: ['security'],
    caseExcludedReason: 'Interne Mitarbeiterberechtigungen gehören nicht in eine Fallübergabe.'
  },
  // Das Audit-Protokoll ist Bestandteil der konsistenten SQLite-Vollsicherung. Es darf
  // ausdrücklich NICHT durch ein portables Teilabbild ersetzt werden: Eine Begrenzung
  // des JSON-Artefakts hatte beim Recovery sonst die ältere Vollhistorie gelöscht.
  { key: 'auditLog', table: 'audit_log', groups: [], restore: false,
    /* Traegt seit dem Verarbeitungs-Log (25.08.2026) eine case_id-Spalte, gehoert aber NICHT in
       eine Fallübergabe: es ist der bueroweite Nachweis der Verarbeitungstaetigkeiten samt
       Klarnamen der Mitarbeitenden - fremde Falleintraege und Personaldaten haetten dort nichts
       zu suchen. In der SQLite-Vollsicherung ist es wie bisher vollstaendig enthalten. */
    caseExcludedReason: 'Bueroweites Verarbeitungs-Log mit Mitarbeiter-Klarnamen - gehoert nicht in eine Fallübergabe.' },
  // Sync-Journal (PLAN-AUFGABEN-SYNC C.5): Betriebsprotokoll wie das Audit-Log - Teil der
  // SQLite-Vollsicherung, aber kein portables Teilabbild (ein begrenztes JSON hätte beim
  // Recovery sonst die ältere Vollhistorie ersetzt).
  { key: 'syncJournal', table: 'sync_journal', groups: [], restore: false },

  { key: 'officeProfile', table: 'office_profile', groups: ['office', 'module'] },
  { key: 'officeBankAccounts', table: 'office_bank_accounts', groups: ['office', 'module'] },
  // Personenregister (Etappe 1, 29.08.2026): EINE Zeile je Mensch (Konto/ohne Konto/extern).
  // office_employees ist seit Etappe 4 (30.08.2026) abgebaut - Sicherungen aus der Zeit davor
  // lehnt restorePayload mit einer klaren Meldung ab (siehe dort).
  { key: 'persons', table: 'persons', groups: ['office', 'module'] },
  { key: 'officeContacts', table: 'office_contacts', groups: ['office', 'module'] },
  { key: 'financeEntries', table: 'finance_entries', groups: ['office', 'module'] },
  { key: 'financeStatements', table: 'finance_statements', groups: ['office', 'module'] },
  { key: 'financeTransactions', table: 'finance_transactions', groups: ['office', 'module'] },
  { key: 'financeReceipts', table: 'finance_receipts', groups: ['office', 'module'] },
  { key: 'outgoingInvoices', table: 'outgoing_invoices', groups: ['office', 'module'],
    /* Traegt seit der Verguetungs-Pipeline (25.08.2026) eine case_id, bleibt aber Buchhaltung des
       BUEROS: eine Fallübergabe uebergibt die Betreuung, nicht die eigenen Honorarforderungen.
       In Buero-/Modulabbild und Vollsicherung ist die Tabelle unveraendert vollstaendig enthalten. */
    caseExcludedReason: 'Honorarbuchhaltung des Bueros - gehoert nicht in eine Fallübergabe.' },
  { key: 'privateVehicles', table: 'private_vehicles', groups: ['office', 'module'] },
  { key: 'mileageTrips', table: 'mileage_trips', groups: ['office', 'module'] },
  { key: 'mileageRates', table: 'mileage_rates', groups: ['office', 'module'] },
  { key: 'betreuungOverviewEntries', table: 'betreuung_overview_entries', groups: ['office', 'module', 'case'], caseColumn: 'case_id' },
  { key: 'inboxDocuments', table: 'inbox_documents', groups: ['office', 'module', 'case'], caseColumn: 'case_id' },
  /* Generischer Schluessel-Blob-Speicher; wird bewusst als GANZE Tabelle gefuehrt (SELECT *),
     nicht ueber eine Schluesselliste - neue Schluessel sind dadurch automatisch gesichert.
     Seit 25.08.2026 liegt hier auch 'datenschutz' (Verarbeitungsverzeichnis, TOM, Auskunfts-
     ersuchen, Datenpannen). Das ist RICHTIG so und erfordert keine eigene Zeile: Die Tabelle
     hat keine case_id und gehoert nicht zur Gruppe 'case', reist also nie in einer Fall-
     uebergabe mit. Buero-/Modulabbild und SQLite-Vollsicherung sind admin- bzw. verwaltungs-
     geschuetzt (Moduldaten-Route admin-only, Bueroabbild im Bereich 'management') - dieselbe
     Schranke, die schon fuer Mitarbeiter- und Gehaltsdaten in dieser Liste gilt. */
  { key: 'officeJson', table: 'office_json', groups: ['office', 'module'] },
  { key: 'caseReports', table: 'case_reports', groups: ['office', 'module', 'case'], caseColumn: 'case_id', caseOrder: 'report_id' },
  { key: 'connectionCalendars', table: 'connection_calendars', groups: ['office', 'module'] },
  {
    key: 'connectionCaseProjects', table: 'connection_case_projects', groups: ['office', 'module'],
    caseExcludedReason: 'Projekt-IDs fremder Werkzeuge (Vikunja/OpenProject) dieses Büros - in einer Fallübergabe wertlos bis irreführend.'
  },
  { key: 'officeContactImports', table: 'office_contact_imports', groups: ['office', 'module'] },
  { key: 'siteProfiles', table: 'site_profiles', groups: ['office', 'module'] },
  { key: 'mailDrafts', table: 'mail_drafts', groups: ['office', 'module'] },
  { key: 'mailTemplates', table: 'mail_templates', groups: ['office', 'module'] },
  { key: 'bankPaymentOrders', table: 'bank_payment_orders', groups: ['office', 'module', 'case'], caseColumn: 'case_id' },
  { key: 'bankRecurringPayments', table: 'bank_recurring_payments', groups: ['office', 'module', 'case'], caseColumn: 'case_id' },
  { key: 'mcpProposals', table: 'mcp_proposals', groups: ['office', 'module', 'case'], caseColumn: 'case_id' },
  { key: 'mcpLog', table: 'mcp_log', groups: ['office', 'module', 'case'], caseColumn: 'case_id' },
  { key: 'appSetup', table: 'app_setup', groups: ['office', 'module'] },

  { key: 'cases', table: 'cases', groups: ['module', 'case'], casePrimary: true },
  { key: 'caseDokuEntries', table: 'case_doku_entries', groups: ['module', 'case'], caseColumn: 'case_id', caseOrder: 'created_at,id' },
  { key: 'caseContacts', table: 'case_contacts', groups: ['module', 'case'], caseColumn: 'case_id', caseOrder: 'created_at,id' },
  { key: 'caseDocuments', table: 'case_documents', groups: ['module', 'case'], caseColumn: 'case_id', metadataOnly: true },
  { key: 'calendarEvents', table: 'calendar_events', groups: ['calendar', 'module', 'case'], caseColumn: 'case_id', order: 'start_at,id' },
  { key: 'todos', table: 'todos', groups: ['calendar', 'module', 'case'], caseColumn: 'case_id', order: 'due_at,id' },
  { key: 'calendarEventAttachments', table: 'calendar_event_attachments', groups: ['calendar', 'module', 'case'], caseVia: 'calendar_events', metadataOnly: true },
  { key: 'todoAttachments', table: 'todo_attachments', groups: ['calendar', 'module', 'case'], caseVia: 'todos', metadataOnly: true },
  { key: 'intakeFiles', table: 'intake_files', groups: ['module'], omitColumns: ['data'], metadataOnly: true },
  // Vordruck-Bytes selbst gebauter Formulare: wie intake_files/signatures reisen die Bytes NUR in der
  // SQLite-Vollsicherung (Vordruck ist austauschbar); portabel nur Metadaten, Restore uebersprungen.
  // Die Formular-DEFINITION selbst wandert portabel ueber office_json['custom_forms'].
  { key: 'customFormTemplates', table: 'custom_form_templates', groups: ['office', 'module'], omitColumns: ['data'], metadataOnly: true, restore: false },
  { key: 'signatures', table: 'signatures', groups: ['module'], omitColumns: ['data_url'], metadataOnly: true, restore: false },
  { key: 'caseIntakeOcr', table: 'case_intake_ocr', groups: ['office', 'module'] },

  { key: 'docFolders', table: 'doc_folders', groups: ['office', 'module', 'case'], caseColumn: 'case_id' },
  { key: 'docFiles', table: 'doc_files', groups: ['office', 'module', 'case'], caseColumn: 'case_id', metadataOnly: true },
  { key: 'docLinks', table: 'doc_links', groups: ['office', 'module', 'case'], caseVia: 'doc_files' },
  { key: 'docCaseRoots', table: 'doc_case_roots', groups: ['office', 'module', 'case'], caseColumn: 'case_id' },
  { key: 'docVersions', table: 'doc_versions', groups: ['office', 'module', 'case'], caseVia: 'doc_files', metadataOnly: true },
  { key: 'docAnnotations', table: 'doc_annotations', groups: ['office', 'module', 'case'], caseVia: 'doc_files' },
  {
    key: 'docMaterializations', table: 'doc_materializations',
    groups: ['office', 'module', 'case'], caseScope: true,
    generatedState: true
  },
  { key: 'docUserPrefs', table: 'doc_user_prefs', groups: ['office', 'module'] },
  { key: 'userUiPrefs', table: 'user_ui_prefs', groups: ['office', 'module'] },
  { key: 'docActivity', table: 'doc_activity', groups: ['office', 'module', 'case'], caseColumn: 'case_id' },
  {
    key: 'docBackupJobs', table: 'doc_backup_jobs', groups: ['office', 'module'],
    officeOmitColumns: [
      'last_run_at', 'last_result', 'run_started_at', 'last_scheduled_at',
      'next_retry_at', 'retry_count', 'last_success_at', 'mount_cursor_at', 'last_failure_at',
      'last_warning_at', 'last_warning_key', 'last_mail_at', 'last_mail_error'
    ]
  },
  {
    key: 'docBackupSchedulerState', table: 'doc_backup_scheduler_state',
    groups: ['office', 'module'], generatedState: true
  },
  {
    key: 'docImportJobs', table: 'doc_import_jobs', groups: ['office', 'module'],
    officeOmitColumns: ['last_run_at', 'last_result']
  },
  {
    key: 'docImportState', table: 'doc_import_state', groups: ['office', 'module'],
    officeOmitColumns: ['imported_at']
  },
  {
    key: 'docPairJobs', table: 'doc_pair_jobs', groups: ['office', 'module'],
    officeOmitColumns: ['last_run_at', 'last_result']
  },
  {
    key: 'docPairState', table: 'doc_pair_state', groups: ['office', 'module'],
    officeOmitColumns: ['synced_at']
  },
  { key: 'docModuleImport', table: 'doc_module_import', groups: ['office', 'module'] },
  { key: 'docIntegrityRuns', table: 'doc_integrity_runs', groups: ['office', 'module'] },
  { key: 'docIntegrityFindings', table: 'doc_integrity_findings', groups: ['office', 'module'] },
  { key: 'docMigrationRuns', table: 'doc_migration_runs', groups: ['office', 'module'] },
  { key: 'docMigrationItems', table: 'doc_migration_items', groups: ['office', 'module'] },
  { key: 'docMaintenancePlans', table: 'doc_maintenance_plans', groups: ['office', 'module'] },

  // Nutzer-zu-Nutzer-Chat (Nutzerwunsch 2026-08-12): büro-interne Unterhaltungen ohne Fallbezug
  // (keine case_id-Spalten) und ohne Geheimnisse - lesbares Büroabbild + Modul-Export genügen,
  // ein Recovery-Spaltenvertrag ist nicht nötig. Anlagenbytes bleiben wie bei intake_files
  // draußen (omitColumns) - Büro-/Modulabbild transportieren grundsätzlich keine Datei-Inhalte.
  { key: 'chatConversations', table: 'chat_conversations', groups: ['office', 'module'] },
  { key: 'chatParticipants', table: 'chat_participants', groups: ['office', 'module'] },
  { key: 'chatMessages', table: 'chat_messages', groups: ['office', 'module'] },
  { key: 'chatAttachments', table: 'chat_attachments', groups: ['office', 'module'], omitColumns: ['data'], metadataOnly: true },
  { key: 'chatUserStatus', table: 'chat_user_status', groups: ['office', 'module'] }
].map((entry) => Object.freeze({ ...entry, groups: Object.freeze(entry.groups.slice()) })));

/*
 * Fail-closed-Vertrag der portablen Recovery-Artefakte. SELECT * allein reicht
 * nicht: Eine versehentlich fehlende, aber leere Spalte wäre in den Zeilen nicht
 * erkennbar und könnte als scheinbar vollständiges Abbild veröffentlicht werden.
 *
 * Die Liste ist absichtlich exakt. Jede additive Schemaänderung an einer
 * Security-/Credentials-Tabelle muss deshalb hier klassifiziert werden, bevor
 * wieder ein neues Recovery-Paar erzeugt werden kann.
 */
function recoveryColumns(value) {
  return Object.freeze(String(value || '').trim().split(/\s+/).filter(Boolean));
}

const RECOVERY_SCHEMA_COLUMNS = Object.freeze({
  users: recoveryColumns(`
    id username password_hash display_name allow_local allow_online is_admin allow_case_management
    created_at can_view_cases can_edit_cases can_view_documents can_edit_documents can_view_finance
    can_edit_finance allow_mode_switch can_manage_mail_settings can_manage_office_profile
    can_manage_map_settings first_name last_name salutation email phone mobile job_title initials
    ma_kennung joined_at left_at notes active calendar_color permissions_json ist_betreuer
    is_demo
  `),
  api_tokens: recoveryColumns('id user_id token_hash label created_at last_used_at revoked'),
  smtp_config: recoveryColumns(`
    id host port secure username password_encrypted from_address admin_recipient updated_at
    signature transport graph_connection_id send_account_id
  `),
  calendar_connections: recoveryColumns(`
    id provider display_name enabled username password_encrypted calendar_url todo_url client_id
    client_secret_encrypted access_token_encrypted refresh_token_encrypted token_expires_at
    calendar_id task_list_id account_label created_at updated_at owner_user_id visibility
    contacts_sync_mode deadline_export task_status_open task_status_done ical_url webhook_secret
  `),
  caldav_config: recoveryColumns('id username password_encrypted calendar_url todo_url updated_at'),
  office_ai_config: recoveryColumns('provider api_key_encrypted model endpoint updated_at'),
  office_send_credentials: recoveryColumns(`
    service username password_encrypted login_url inbox_url compose_url updated_at
  `),
  user_settings_overrides: recoveryColumns('user_id area value_encrypted updated_at'),
  local_mode_defaults: recoveryColumns('area value_encrypted updated_at updated_by'),
  map_settings: recoveryColumns(`
    id active_provider google_maps_api_key_encrypted here_api_key_encrypted updated_at
  `),
  mail_accounts: recoveryColumns(`
    id label kind email from_name imap_host imap_port imap_secure imap_user imap_pass_encrypted
    smtp_host smtp_port smtp_secure smtp_user smtp_pass_encrypted graph_connection_id owner_user_id
    visibility sort_order folder_prefs_json created_at updated_at signature reply_to signature_source
    trash_retention_days junk_retention_days sync_window_days cache_retention_days color
  `),
  mail_prefs: recoveryColumns('user_id prefs_json updated_at'),
  mail_rules: recoveryColumns(`
    id owner_user_id visibility account_id enabled match_field match_op match_value action
    action_target sort_order created_at
  `),
  mail_snoozes: recoveryColumns(`
    id account_id folder message_id subject wake_at attempts owner_user_id created_at
  `),
  bank_connections: recoveryColumns(`
    id scope case_id bank_name blz fints_url username pin_encrypted tan_mechanism tan_medium status
    status_detail sca_valid_until last_sync_at created_by created_at
  `),
  bank_gateway_config: recoveryColumns(`
    id url password_encrypted allow_self_signed sync_enabled sync_interval_min last_sync_at
    last_sync_status updated_at updated_by last_recurring_run
  `),
  mcp_settings: recoveryColumns('id enabled public_url updated_at'),
  mcp_clients: recoveryColumns(`
    id name redirect_uris_json secret_hash created_at last_used_at revoked allowed_scopes
  `),
  mcp_tokens: recoveryColumns(`
    id kind token_hash client_id user_id scope resource expires_at revoked rotated_from created_at
    last_used_at
  `),
  doc_webdav_tokens: recoveryColumns('id user_id label pass_hash created_at last_used_at'),
  feed_tokens: recoveryColumns('id label token_hash created_by created_at last_used_at revoked'),
  doc_mounts: recoveryColumns('id label kind config_json enabled created_by created_at'),
  case_access: recoveryColumns('case_id user_id level created_at created_by')
});

const CASE_OWNER_REQUIRED_COLUMNS = Object.freeze(['id', 'owner_user_id']);

const BACKUP_EXCLUDED_TABLES = Object.freeze({
  recovery_security_state: 'Interner Wiederanlaufzustand; reist nur in der SQLite-Vollsicherung mit und wird nie aus einem JSON-Teilabbild importiert.',
  mail_cache: 'Vom Mailserver erneut ladbarer Nachrichtencache.',
  mcp_auth_codes: 'Kurzlebige, einmal verwendbare Autorisierungscodes.',
  doc_text: 'Aus den Originaldateien neu aufbaubarer Volltextindex.',
  doc_text_config: 'SQLite-FTS5-interne Schattentabelle.',
  doc_text_content: 'SQLite-FTS5-interne Schattentabelle.',
  doc_text_data: 'SQLite-FTS5-interne Schattentabelle.',
  doc_text_docsize: 'SQLite-FTS5-interne Schattentabelle.',
  doc_text_idx: 'SQLite-FTS5-interne Schattentabelle.'
});

function registryFor(group) {
  return TABLE_REGISTRY.filter((entry) => entry.groups.includes(group));
}

const SECURITY_TABLES = Object.freeze(Object.fromEntries(
  registryFor('security').map(({ key, table }) => [key, table])
));
const CREDENTIAL_TABLES = Object.freeze(Object.fromEntries(
  registryFor('credentials').map(({ key, table }) => [key, table])
));

function safeAll(db, table, order, options) {
  const opts = options || {};
  identifier(table);
  const suffix = `${order ? ` ORDER BY ${order}` : ''}${opts.limit ? ` LIMIT ${Number(opts.limit)}` : ''}`;
  try {
    return db.prepare(`SELECT * FROM ${table}${suffix}`).all();
  } catch (error) {
    if (opts.optionalMissing && /no such table/i.test(String(error && error.message || error))) return null;
    const wrapped = new Error(`Sicherungstabelle ${table} konnte nicht gelesen werden.`);
    wrapped.code = 'BACKUP_TABLE_READ_FAILED';
    wrapped.table = table;
    wrapped.cause = error;
    throw wrapped;
  }
}

const PORTABLE_SECRET_COLUMNS = Object.freeze({
  smtpConfig: Object.freeze(['password_encrypted']),
  calendarConnections: Object.freeze([
    'password_encrypted', 'client_secret_encrypted',
    'access_token_encrypted', 'refresh_token_encrypted'
  ]),
  caldavConfig: Object.freeze(['password_encrypted']),
  officeAiConfig: Object.freeze(['api_key_encrypted']),
  officeSendCredentials: Object.freeze(['password_encrypted']),
  userSettingsOverrides: Object.freeze(['value_encrypted']),
  localModeDefaults: Object.freeze(['value_encrypted']),
  mapSettings: Object.freeze(['google_maps_api_key_encrypted', 'here_api_key_encrypted']),
  mailAccounts: Object.freeze(['imap_pass_encrypted', 'smtp_pass_encrypted']),
  bankConnections: Object.freeze(['pin_encrypted']),
  bankGatewayConfig: Object.freeze(['password_encrypted'])
});
const MOUNT_SECRET_FIELDS = Object.freeze(['passEnc', 'clientSecretEnc', 'refreshEnc', 'accessEnc']);
const PORTABLE_MARKER = '__recovery_secrets';

// Gemeinsame Quelle auch für den Wiederanlauf-Check: Jede direkt verschlüsselte
// Spalte, die portabel umgewickelt wird, muss vor der Freigabe mit dem aktuellen
// ENCRYPTION_KEY lesbar sein. Neue Zugangsdatenfelder werden dadurch nicht in
// Generator und Quarantänelogik getrennt nachgetragen.
function portableSecretLocations() {
  const tableByKey = new Map(registryFor('credentials').map((entry) => [entry.key, entry.table]));
  return Object.entries(PORTABLE_SECRET_COLUMNS).flatMap(([key, columns]) => {
    const table = tableByKey.get(key);
    return table ? columns.map((column) => Object.freeze({ table, column })) : [];
  });
}

function recoverySchemaContract(group) {
  const scope = group === 'security' ? 'security' : (group === 'credentials' ? 'credentials' : '');
  if (!scope) throw new Error('Unbekannter Recovery-Artefaktbereich.');
  const tables = {};
  for (const spec of registryFor(scope)) {
    const columns = RECOVERY_SCHEMA_COLUMNS[spec.table];
    if (!columns || !columns.length) {
      const error = new Error(`Für die Recovery-Tabelle ${spec.table} fehlt der Spaltenvertrag.`);
      error.code = 'BACKUP_RECOVERY_SCHEMA_CONTRACT_MISSING';
      error.table = spec.table;
      throw error;
    }
    tables[spec.table] = columns.slice();
  }
  return {
    version: 1,
    scope,
    tables,
    ...(scope === 'security' ? { caseOwners: CASE_OWNER_REQUIRED_COLUMNS.slice() } : {})
  };
}

function tableSchemaColumns(db, table) {
  identifier(table);
  try {
    return db.prepare(`PRAGMA table_info(${identifier(table)})`).all()
      .map((column) => String(column && column.name || ''))
      .filter(Boolean);
  } catch (error) {
    const wrapped = new Error(`Schema der Sicherungstabelle ${table} konnte nicht gelesen werden.`);
    wrapped.code = 'BACKUP_TABLE_SCHEMA_READ_FAILED';
    wrapped.table = table;
    wrapped.cause = error;
    throw wrapped;
  }
}

function assertRecoveryTableSchema(db, spec) {
  const expected = RECOVERY_SCHEMA_COLUMNS[spec.table];
  if (!expected || !expected.length) {
    const error = new Error(`Für die Recovery-Tabelle ${spec.table} fehlt der Spaltenvertrag.`);
    error.code = 'BACKUP_RECOVERY_SCHEMA_CONTRACT_MISSING';
    error.table = spec.table;
    throw error;
  }
  const actual = tableSchemaColumns(db, spec.table);
  if (!actual.length) {
    if (spec.recoveryOptional === true) return null;
    const error = new Error(`Die verpflichtende Recovery-Tabelle ${spec.table} fehlt.`);
    error.code = 'BACKUP_REQUIRED_TABLE_MISSING';
    error.table = spec.table;
    throw error;
  }
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((column) => !actualSet.has(column));
  const unexpected = actual.filter((column) => !expectedSet.has(column));
  if (missing.length || unexpected.length) {
    const error = new Error(
      `Das Schema der Recovery-Tabelle ${spec.table} weicht vom vollständigen Sicherungsvertrag ab.`
    );
    error.code = 'BACKUP_REQUIRED_COLUMNS_MISMATCH';
    error.table = spec.table;
    error.missingColumns = missing;
    error.unexpectedColumns = unexpected;
    throw error;
  }
  return actual;
}

function readRegisteredTable(db, spec, omittedTables, options) {
  const opts = options || {};
  if (opts.strictRecoverySchema) {
    const columns = assertRecoveryTableSchema(db, spec);
    if (columns === null) {
      omittedTables.push(spec.table);
      return [];
    }
  }
  const rows = safeAll(db, spec.table, spec.order, {
    limit: spec.limit,
    // Optionale Feature-Tabellen können in alten Sicherungen und kleinen, isolierten
    // Testdatenbanken fehlen. Das wird im Artefakt ausdrücklich ausgewiesen. Andere
    // SQL-Fehler werden nie in eine scheinbar echte leere Tabelle umgewandelt.
    optionalMissing: !opts.strictRecoverySchema || spec.recoveryOptional === true
  });
  if (rows === null) {
    omittedTables.push(spec.table);
    return [];
  }
  let result = rows;
  if (spec.omitColumns && spec.omitColumns.length) {
    const omitted = new Set(spec.omitColumns);
    result = rows.map((row) => Object.fromEntries(
      Object.entries(row).filter(([column]) => !omitted.has(column))
    ));
  }
  // SQLite garantiert ohne ORDER BY keine Zeilenreihenfolge. Die portable
  // Quellrevision muss dennoch bei identischen Daten stabil bleiben.
  if (opts.strictRecoverySchema) {
    result = result.slice().sort((left, right) =>
      Buffer.from(stableJson(left), 'utf8').compare(Buffer.from(stableJson(right), 'utf8'))
    );
  }
  return result;
}

function omitRowColumns(rows, columns) {
  if (!Array.isArray(rows) || !Array.isArray(columns) || !columns.length) return rows;
  const omitted = new Set(columns);
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).filter(([column]) => !omitted.has(column))
  ));
}

function securityData(db, options) {
  const opt = options || {};
  const result = {
    type: 'betreuungsbuero-sicherheit',
    version: 2,
    exportedAt: opt.exportedAt || new Date().toISOString(),
    omittedTables: []
  };
  if (opt.strictRecoverySchema) result.recoverySchema = recoverySchemaContract('security');
  for (const spec of registryFor('security')) {
    result[spec.key] = readRegisteredTable(db, spec, result.omittedTables, opt);
  }
  try {
    if (opt.strictRecoverySchema) {
      const actual = tableSchemaColumns(db, 'cases');
      const missing = CASE_OWNER_REQUIRED_COLUMNS.filter((column) => !actual.includes(column));
      if (missing.length) {
        const error = new Error('Die verpflichtenden Spalten der Fallzuständigkeiten fehlen.');
        error.code = 'BACKUP_REQUIRED_COLUMNS_MISMATCH';
        error.table = 'cases';
        error.missingColumns = missing;
        throw error;
      }
    }
    result.caseOwners = db.prepare(
      'SELECT id AS case_id, owner_user_id FROM cases WHERE owner_user_id IS NOT NULL ORDER BY id'
    ).all();
  } catch (error) {
    if (error && String(error.code || '').startsWith('BACKUP_')) throw error;
    if (!opt.strictRecoverySchema
        && /no such (table|column)/i.test(String(error && error.message || error))) {
      result.caseOwners = [];
      result.omittedTables.push('cases.owner_user_id');
    } else {
      const wrapped = new Error('Fallzuständigkeiten konnten nicht für die Sicherung gelesen werden.');
      wrapped.code = 'BACKUP_CASE_OWNERS_READ_FAILED';
      wrapped.cause = error;
      throw wrapped;
    }
  }
  return result;
}

function credentialsData(db, options) {
  const opt = options || {};
  const result = {
    type: 'betreuungsbuero-zugangsdaten',
    version: 2,
    exportedAt: opt.exportedAt || new Date().toISOString(),
    omittedTables: []
  };
  if (opt.strictRecoverySchema) result.recoverySchema = recoverySchemaContract('credentials');
  for (const spec of registryFor('credentials')) {
    result[spec.key] = readRegisteredTable(db, spec, result.omittedTables, opt);
  }
  return result;
}

function portableRows(rows, fields, cryptoHelper, label) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const copy = { ...row };
    const secrets = {};
    for (const field of fields) {
      const encrypted = String(copy[field] || '');
      if (!encrypted) continue;
      try {
        secrets[field] = cryptoHelper.decryptStrict(encrypted);
      } catch (error) {
        throw new Error(`${label}[${index}].${field} kann mit dem aktuellen ENCRYPTION_KEY nicht entschlüsselt werden: ${error.message || error}`);
      }
      copy[field] = '';
    }
    if (Object.keys(secrets).length) copy[PORTABLE_MARKER] = secrets;
    return copy;
  });
}

function portableMountRows(rows, cryptoHelper, label) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const copy = { ...row };
    let config;
    try { config = JSON.parse(copy.config_json || '{}'); }
    catch (_error) { throw new Error(`${label}[${index}].config_json ist kein gültiges JSON.`); }
    const secrets = {};
    for (const field of MOUNT_SECRET_FIELDS) {
      const encrypted = String(config[field] || '');
      if (!encrypted) continue;
      try {
        secrets[`config_json.${field}`] = cryptoHelper.decryptStrict(encrypted);
      } catch (error) {
        throw new Error(`${label}[${index}].config_json.${field} kann mit dem aktuellen ENCRYPTION_KEY nicht entschlüsselt werden: ${error.message || error}`);
      }
      config[field] = '';
    }
    copy.config_json = JSON.stringify(config);
    if (Object.keys(secrets).length) copy[PORTABLE_MARKER] = secrets;
    return copy;
  });
}

function portablePayload(source, cryptoHelper) {
  if (!cryptoHelper || typeof cryptoHelper.decryptStrict !== 'function') {
    throw new Error('Der interne Verschlüsselungsdienst ist nicht verfügbar.');
  }
  const result = { ...source, version: 3 };
  for (const [key, fields] of Object.entries(PORTABLE_SECRET_COLUMNS)) {
    if (Array.isArray(result[key])) result[key] = portableRows(result[key], fields, cryptoHelper, key);
  }
  if (Array.isArray(result.docMounts)) {
    result.docMounts = portableMountRows(result.docMounts, cryptoHelper, 'docMounts');
  }
  result.portableSecrets = true;
  return result;
}

function portableSecurityData(db, cryptoHelper, options) {
  return portablePayload(securityData(db, { ...(options || {}), strictRecoverySchema: true }), cryptoHelper);
}

function portableCredentialsData(db, cryptoHelper, options) {
  return portablePayload(credentialsData(db, { ...(options || {}), strictRecoverySchema: true }), cryptoHelper);
}

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ':' + stableJson(value[key])
    ).join(',') + '}';
  }
  return JSON.stringify(value);
}

function withoutVolatileRecoveryFields(payload) {
  const copy = { ...payload };
  delete copy.exportedAt;
  delete copy.recoveryGeneration;
  return copy;
}

/*
 * Beide portablen Artefakte müssen aus demselben SQLite-Lesefenster stammen.
 * better-sqlite3 arbeitet synchron; die umschließende Transaktion hält zusätzlich
 * für beide Generatoren denselben Snapshot. Die gemeinsame Revision ist ein Hash
 * der tatsächlich portabel aufbereiteten Nutzlasten, nicht bloß ein Zeitstempel.
 */
function createPortableRecoveryBundle(db, cryptoHelper, options) {
  const opt = options || {};
  const generationId = String(opt.generationId || crypto.randomUUID());
  const createdAt = String(opt.createdAt || new Date().toISOString());
  const build = () => {
    const security = portableSecurityData(db, cryptoHelper, { exportedAt: createdAt });
    const credentials = portableCredentialsData(db, cryptoHelper, { exportedAt: createdAt });
    const revisionInput = stableJson({
      security: withoutVolatileRecoveryFields(security),
      credentials: withoutVolatileRecoveryFields(credentials)
    });
    const sourceRevision = crypto.createHash('sha256').update(revisionInput, 'utf8').digest('hex');
    security.recoveryGeneration = {
      generationId, sourceRevision, createdAt, artifactScope: 'security'
    };
    credentials.recoveryGeneration = {
      generationId, sourceRevision, createdAt, artifactScope: 'credentials'
    };
    return { generationId, sourceRevision, createdAt, security, credentials };
  };
  if (db && typeof db.transaction === 'function') return db.transaction(build)();
  return build();
}

function portableRecoverySourceRevision(db, cryptoHelper) {
  return createPortableRecoveryBundle(db, cryptoHelper, {
    generationId: 'revision-only',
    createdAt: '1970-01-01T00:00:00.000Z'
  }).sourceRevision;
}

function restorePortableRows(rows, fields, cryptoHelper, label) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const copy = { ...row };
    const secrets = copy[PORTABLE_MARKER] || {};
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) {
      throw new Error(`${label}[${index}] enthält ungültige portable Geheimnisse.`);
    }
    const allowed = new Set(fields);
    for (const key of Object.keys(secrets)) {
      if (!allowed.has(key)) throw new Error(`${label}[${index}] enthält ein unbekanntes Geheimnisfeld.`);
    }
    for (const field of fields) {
      if (copy[field]) {
        throw new Error(`${label}[${index}].${field} enthält im portablen Schema unerwarteten internen Ciphertext.`);
      }
      if (Object.prototype.hasOwnProperty.call(secrets, field)) {
        copy[field] = cryptoHelper.encrypt(String(secrets[field]));
      }
    }
    delete copy[PORTABLE_MARKER];
    return copy;
  });
}

function restorePortableMountRows(rows, cryptoHelper, label) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const copy = { ...row };
    const secrets = copy[PORTABLE_MARKER] || {};
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) {
      throw new Error(`${label}[${index}] enthält ungültige portable Geheimnisse.`);
    }
    let config;
    try { config = JSON.parse(copy.config_json || '{}'); }
    catch (_error) { throw new Error(`${label}[${index}].config_json ist kein gültiges JSON.`); }
    const allowed = new Set(MOUNT_SECRET_FIELDS.map((field) => `config_json.${field}`));
    for (const key of Object.keys(secrets)) {
      if (!allowed.has(key)) throw new Error(`${label}[${index}] enthält ein unbekanntes Mount-Geheimnisfeld.`);
    }
    for (const field of MOUNT_SECRET_FIELDS) {
      const portableKey = `config_json.${field}`;
      if (config[field]) {
        throw new Error(`${label}[${index}].${portableKey} enthält im portablen Schema unerwarteten internen Ciphertext.`);
      }
      if (Object.prototype.hasOwnProperty.call(secrets, portableKey)) {
        config[field] = cryptoHelper.encrypt(String(secrets[portableKey]));
      }
    }
    copy.config_json = JSON.stringify(config);
    delete copy[PORTABLE_MARKER];
    return copy;
  });
}

function rehydratePortableSecrets(source, cryptoHelper) {
  if (!source || Number(source.version) !== 3 || source.portableSecrets !== true) {
    throw new Error('Die portablen Geheimnisse fehlen oder haben eine unbekannte Version.');
  }
  if (!cryptoHelper || typeof cryptoHelper.encrypt !== 'function') {
    throw new Error('Der interne Verschlüsselungsdienst ist nicht verfügbar.');
  }
  const result = { ...source };
  for (const [key, fields] of Object.entries(PORTABLE_SECRET_COLUMNS)) {
    if (Array.isArray(result[key])) result[key] = restorePortableRows(result[key], fields, cryptoHelper, key);
  }
  if (Array.isArray(result.docMounts)) {
    result.docMounts = restorePortableMountRows(result.docMounts, cryptoHelper, 'docMounts');
  }
  delete result.portableSecrets;
  return result;
}

function redactMountRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const copy = { ...row };
    try {
      const config = JSON.parse(copy.config_json || '{}');
      for (const field of MOUNT_SECRET_FIELDS) delete config[field];
      copy.config_json = JSON.stringify(config);
    } catch (_error) {
      copy.config_json = '{}';
    }
    return copy;
  });
}

/*
 * Demo-Daten sind Vorfuehrmaterial, keine Arbeitsdaten. Die Vorfuehrkonten muessen als echte
 * users-Zeilen existieren, damit Anmeldung, Rechteansicht und Chat realistisch funktionieren.
 * Genau deshalb darf ein schlichtes SELECT * sie nicht in lesbare Buero-/Modulabbilder ziehen.
 *
 * Der Zusammenhang der Chat-Tabellen wird hier einmal aufgeloest: Eine Unterhaltung mit einem
 * Demo-Teilnehmer ist durch die serverseitige Sichtbarkeitstrennung immer eine reine Demo-
 * Unterhaltung. Nachrichten und Anlagen werden ueber ihre Eltern ebenfalls ausgeschlossen.
 */
function demoExportScope(db) {
  const users = safeAll(db, 'users', 'id', { optionalMissing: true }) || [];
  const userIds = new Set(users
    .filter((row) => Number(row.is_demo || 0) === 1 || isDemoUsername(row.username))
    .map((row) => String(row.id)));
  const persons = safeAll(db, 'persons', 'id', { optionalMissing: true }) || [];
  const personIds = new Set(persons
    .filter((row) => userIds.has(String(row.user_id)))
    .map((row) => String(row.id)));
  const cases = safeAll(db, 'cases', 'id', { optionalMissing: true }) || [];
  const caseIds = new Set(DEMO_CASES.map((entry) => entry.id));
  const caseLabels = new Set(DEMO_CASES.map((entry) => entry.label.toLocaleLowerCase('de')));
  cases.forEach((row) => {
    if (!isDemoCaseId(row.id)) return;
    caseIds.add(String(row.id));
    if (row.label) caseLabels.add(String(row.label).trim().toLocaleLowerCase('de'));
  });
  const participants = safeAll(db, 'chat_participants', 'conversation_id,user_id', { optionalMissing: true }) || [];
  const conversationIds = new Set(participants
    .filter((row) => userIds.has(String(row.user_id)))
    .map((row) => String(row.conversation_id)));
  const conversations = safeAll(db, 'chat_conversations', 'id', { optionalMissing: true }) || [];
  conversations.forEach((row) => {
    if (userIds.has(String(row.created_by))) conversationIds.add(String(row.id));
  });
  const messages = safeAll(db, 'chat_messages', 'id', { optionalMissing: true }) || [];
  const messageIds = new Set(messages
    .filter((row) => conversationIds.has(String(row.conversation_id))
      || userIds.has(String(row.sender_user_id)))
    .map((row) => String(row.id)));
  const caseRef = (row) => caseIds.has(String(row.case_id || row.caseId || ''))
    || caseLabels.has(String(row.case_label || row.caseLabel || '').trim().toLocaleLowerCase('de'));
  const calendarEventIds = new Set((safeAll(db, 'calendar_events', 'id', { optionalMissing: true }) || [])
    .filter(caseRef).map((row) => String(row.id)));
  const todoIds = new Set((safeAll(db, 'todos', 'id', { optionalMissing: true }) || [])
    .filter(caseRef).map((row) => String(row.id)));
  const docFileIds = new Set((safeAll(db, 'doc_files', 'id', { optionalMissing: true }) || [])
    .filter(caseRef).map((row) => String(row.id)));
  return {
    userIds, personIds, caseIds, caseLabels, conversationIds, messageIds,
    calendarEventIds, todoIds, docFileIds
  };
}

const DROP_DEMO_VALUE = Symbol('drop-demo-value');

function directDemoReference(row, scope, table) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  if (Number(row.is_demo || row.isDemo || 0) === 1) return true;
  const usernames = [
    row.username, row.actor_username, row.actorUsername, row.fahrer_username, row.fahrerUsername,
    row.extra && row.extra.username, row.details && row.details.username
  ];
  if (usernames.some(isDemoUsername)) return true;
  const userColumns = [
    'user_id', 'userId', 'owner_user_id', 'ownerUserId', 'created_by', 'createdBy',
    'updated_by', 'updatedBy', 'actor_user_id', 'actorUserId', 'sender_user_id',
    'senderUserId', 'fahrer_user_id', 'fahrerUserId'
  ];
  if (userColumns.some((column) => row[column] != null
    && scope.userIds.has(String(row[column])))) return true;
  const personColumns = ['person_id', 'personId', 'owner_person_id', 'ownerPersonId'];
  if (personColumns.some((column) => row[column] != null
    && scope.personIds.has(String(row[column])))) return true;
  const caseIds = [row.case_id, row.caseId, row.fall_id, row.fallId];
  if (caseIds.some((value) => value != null && scope.caseIds.has(String(value)))) return true;
  if ((row.scope_type === 'case' || row.scopeType === 'case')
    && scope.caseIds.has(String(row.scope_id || row.scopeId || ''))) return true;
  if ((row.target_type === 'case' || row.targetType === 'case')
    && scope.caseIds.has(String(row.target_id || row.targetId || ''))) return true;
  const labels = [row.case_label, row.caseLabel, row.fall_label, row.fallLabel, row.betreuungsfall];
  if (labels.some((value) => scope.caseLabels.has(String(value || '').trim().toLocaleLowerCase('de'))
    || isDemoCaseLabel(value))) return true;
  if (table === 'cases' && scope.caseIds.has(String(row.id))) return true;
  if (table === 'calendar_event_attachments' && scope.calendarEventIds.has(String(row.event_id))) return true;
  if (table === 'todo_attachments' && scope.todoIds.has(String(row.todo_id))) return true;
  if (['doc_links', 'doc_versions', 'doc_annotations'].includes(table)
    && scope.docFileIds.has(String(row.file_id))) return true;
  if ((table === 'chat_conversations' || table === 'chat_participants')
    && scope.conversationIds.has(String(row.conversation_id != null ? row.conversation_id : row.id))) return true;
  if (table === 'chat_messages' && scope.conversationIds.has(String(row.conversation_id))) return true;
  if (table === 'chat_attachments' && scope.messageIds.has(String(row.message_id))) return true;
  return false;
}

function containsDemoReference(value, scope, table) {
  if (!value || typeof value !== 'object') return false;
  if (directDemoReference(value, scope, table)) return true;
  return Object.values(value).some((child) => containsDemoReference(child, scope, table));
}

function cleanDemoValue(value, scope) {
  if (Array.isArray(value)) {
    return value.map((entry) => cleanDemoValue(entry, scope)).filter((entry) => entry !== DROP_DEMO_VALUE);
  }
  if (!value || typeof value !== 'object') return value;
  if (directDemoReference(value, scope, '')) return DROP_DEMO_VALUE;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (scope.caseIds.has(String(key)) || scope.personIds.has(String(key))
      || scope.caseLabels.has(String(key).trim().toLocaleLowerCase('de'))) continue;
    const cleaned = cleanDemoValue(child, scope);
    if (cleaned !== DROP_DEMO_VALUE) out[key] = cleaned;
  }
  return out;
}

function withoutDemoRows(table, rows, scope) {
  if (!Array.isArray(rows)) return rows;
  // Der Ein-/Aus-Schalter ist Betriebszustand der Vorführung, kein Büro-Arbeitsstand. Ein
  // späterer Import darf den Demo-Modus nicht beiläufig wieder einschalten.
  const source = table === 'office_json'
    ? rows.filter((row) => String(row.key || '') !== 'demo_modus')
    : rows;
  if (!scope) return source;
  return source.filter((row) => {
    if (directDemoReference(row, scope, table)) return false;
    if (table === 'audit_log') {
      try {
        if (containsDemoReference(JSON.parse(row.details_json || '{}'), scope, table)) return false;
      } catch (_error) { /* Ein unlesbares Details-Feld wird unveraendert exportiert. */ }
    }
    return true;
  }).map((row) => {
    if (table !== 'office_json') return row;
    try {
      const cleaned = cleanDemoValue(JSON.parse(row.data_json || '{}'), scope);
      return { ...row, data_json: JSON.stringify(cleaned === DROP_DEMO_VALUE ? {} : cleaned) };
    } catch (_error) {
      return row;
    }
  });
}

function calendarTodoData(db) {
  const out = {
    type: 'betreuungsbuero-kalender-aufgaben',
    version: 2,
    exportedAt: new Date().toISOString(),
    omittedTables: []
  };
  const demoScope = demoExportScope(db);
  for (const spec of registryFor('calendar')) {
    out[spec.key] = withoutDemoRows(
      spec.table,
      readRegisteredTable(db, spec, out.omittedTables),
      demoScope
    );
  }
  return out;
}

function officeData(db, options) {
  const out = {
    type: 'betreuungsbuero-bueroorganisation',
    version: 2,
    exportedAt: new Date().toISOString(),
    tables: {},
    omittedTables: []
  };
  const demoScope = demoExportScope(db);
  for (const spec of registryFor('office')) {
    const table = spec.table;
    let rows = readRegisteredTable(db, spec, out.omittedTables);
    rows = withoutDemoRows(table, rows, demoScope);
    if (spec.generatedState) {
      // Die Statuszeilen beschreiben genau die Abbilder, die aus diesem Objekt
      // entstehen. Die Tabelle bleibt zur vollständigen Registrierung im Format,
      // ihr abgeleiteter Inhalt darf aber nicht die eigene Quellrevision ändern.
      rows = [];
    }
    rows = omitRowColumns(rows, spec.officeOmitColumns);
    if (table === 'doc_files') {
      // Index und logischer Pfad ja, Dokumentbytes nein; verschlüsselte
      // Verwaltungsabbilder werden nicht rekursiv in sich selbst eingebettet.
      rows = rows.filter((row) => String(row.area || '') !== 'management' && !Number(row.managed || 0));
    }
    if (table === 'doc_folders') rows = rows.filter((row) => String(row.area || '') !== 'management');
    if (table === 'doc_mounts') rows = redactMountRows(rows);
    if (table === 'office_profile') {
      rows = rows.map((row) => ({ ...row, maps_api_key_encrypted: '' }));
    }
    out.tables[table] = rows;
  }
  if (options && options.intakeOcr && out.tables.office_json) {
    out.tables.office_json = out.tables.office_json.map((row) => {
      if (row.key !== 'case_intakes') return row;
      try {
        return { ...row, data_json: JSON.stringify(options.intakeOcr.hydrate(JSON.parse(row.data_json || '{}'))) };
      } catch (error) {
        const wrapped = new Error('Der ausgelagerte Fallbeginn-OCR-Text konnte nicht verlustfrei in das Büroabbild eingesetzt werden.');
        wrapped.code = 'BACKUP_OCR_HYDRATION_FAILED';
        wrapped.cause = error;
        throw wrapped;
      }
    });
  }
  return out;
}

function caseRows(db, spec, caseId, omittedTables) {
  const id = String(caseId || '');
  let sql;
  if (spec.casePrimary) {
    sql = `SELECT * FROM ${identifier(spec.table)} WHERE id=?`;
  } else if (spec.caseColumn) {
    sql = `SELECT * FROM ${identifier(spec.table)} WHERE ${identifier(spec.caseColumn)}=?`;
  } else if (spec.caseScope) {
    sql = `SELECT * FROM ${identifier(spec.table)} WHERE scope_type='case' AND scope_id=?`;
  } else if (spec.caseVia === 'bank_connections') {
    sql = `SELECT child.* FROM ${identifier(spec.table)} child
             JOIN bank_connections parent ON parent.id=child.connection_id
            WHERE parent.case_id=?`;
  } else if (spec.caseVia === 'bank_accounts') {
    sql = `SELECT child.* FROM ${identifier(spec.table)} child
             JOIN bank_connections parent ON parent.id=child.connection_id
            WHERE parent.case_id=? OR child.manual_case_id=?`;
  } else if (spec.caseVia === 'calendar_events') {
    sql = `SELECT child.* FROM ${identifier(spec.table)} child
             JOIN calendar_events parent ON parent.id=child.event_id
            WHERE parent.case_id=?`;
  } else if (spec.caseVia === 'todos') {
    sql = `SELECT child.* FROM ${identifier(spec.table)} child
             JOIN todos parent ON parent.id=child.todo_id
            WHERE parent.case_id=?`;
  } else if (spec.caseVia === 'doc_files') {
    sql = `SELECT child.* FROM ${identifier(spec.table)} child
             JOIN doc_files parent ON parent.id=child.file_id
            WHERE parent.case_id=?`;
  } else {
    throw new Error(`Für ${spec.table} fehlt eine sichere Fallzuordnung.`);
  }
  if (spec.caseOrder) sql += ` ORDER BY ${spec.caseOrder}`;
  try {
    const statement = db.prepare(sql);
    const rows = spec.casePrimary
      ? (statement.get(id) || null)
      : (spec.caseVia === 'bank_accounts' ? statement.all(id, id) : statement.all(id));
    if (!spec.caseOmitColumns || !spec.caseOmitColumns.length || rows == null) return rows;
    const omitted = new Set(spec.caseOmitColumns);
    const redact = (row) => Object.fromEntries(
      Object.entries(row).filter(([column]) => !omitted.has(column))
    );
    return Array.isArray(rows) ? rows.map(redact) : redact(rows);
  } catch (error) {
    if (/no such table/i.test(String(error && error.message || error))) {
      omittedTables.push(spec.table);
      return spec.casePrimary ? null : [];
    }
    const wrapped = new Error(`Falltabelle ${spec.table} konnte nicht gelesen werden.`);
    wrapped.code = 'BACKUP_CASE_TABLE_READ_FAILED';
    wrapped.table = spec.table;
    wrapped.cause = error;
    throw wrapped;
  }
}

function caseData(db, caseId) {
  const omittedTables = [];
  const tables = {};
  for (const spec of registryFor('case')) {
    let rows = caseRows(db, spec, caseId, omittedTables);
    if (spec.generatedState) {
      // Materialisierungsstatus ist jederzeit aus den fachlichen Daten neu
      // erzeugbar und würde die Fallsicherung sonst rekursiv invalidieren.
      rows = [];
    }
    if (spec.table === 'doc_files' && Array.isArray(rows)) {
      // Automatisch gepflegte Stammdatenabbilder gehören als echte Dateien auf
      // die Platte, aber nicht als Metadaten wieder in ihre eigene Quelle.
      rows = rows.filter((row) => !Number(row.managed || 0));
    }
    tables[spec.table] = rows;
  }
  const files = Array.isArray(tables.doc_files)
    ? tables.doc_files
      .filter((row) => String(row.deleted_at || '') === '' && !Number(row.managed || 0))
      .map((row) => {
        const allowed = [
          'id', 'area', 'case_id', 'folder_id', 'name', 'mime_type', 'size', 'sha256',
          'created_at', 'updated_at', 'storage_relpath', 'artifact_kind', 'visibility'
        ];
        return Object.fromEntries(allowed.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]));
      })
      .sort((a, b) => String(a.storage_relpath || '').localeCompare(String(b.storage_relpath || ''), 'de'))
    : [];
  return {
    type: 'betreuungsbuero-fallsicherung',
    version: 2,
    exportedAt: new Date().toISOString(),
    omittedTables: [...new Set(omittedTables)],
    tables,
    // Rückwärtskompatible Namen für bestehende §-1872- und Fallmaterialisierungswege.
    case: tables.cases || null,
    reports: tables.case_reports || [],
    documentation: tables.case_doku_entries || [],
    contacts: tables.case_contacts || [],
    files
  };
}

function moduleData(db, options) {
  const out = {
    type: 'betreuungsbuero-moduldaten',
    version: 3,
    exportedAt: new Date().toISOString(),
    hinweis: 'Fachdaten ohne Datei-Inhalte. Dokumentenspeicher und Anlagen sind nur als Metadaten enthalten.',
    omittedTables: []
  };
  const demoScope = demoExportScope(db);
  for (const spec of registryFor('module')) {
    let rows = readRegisteredTable(db, spec, out.omittedTables);
    rows = withoutDemoRows(spec.table, rows, demoScope);
    if (spec.table === 'doc_files') {
      rows = rows.filter((row) => String(row.area || '') !== 'management' && !Number(row.managed || 0));
    }
    out[spec.key] = rows;
  }
  if (options && options.intakeOcr && Array.isArray(out.officeJson)) {
    out.officeJson = out.officeJson.map((row) => {
      if (row.key !== 'case_intakes') return row;
      try {
        return { ...row, data_json: JSON.stringify(options.intakeOcr.hydrate(JSON.parse(row.data_json || '{}'))) };
      } catch (error) {
        const wrapped = new Error('Der ausgelagerte Fallbeginn-OCR-Text konnte nicht verlustfrei in die Moduldaten eingesetzt werden.');
        wrapped.code = 'BACKUP_OCR_HYDRATION_FAILED';
        wrapped.cause = error;
        throw wrapped;
      }
    });
  }
  return out;
}

/*
 * Lesbarer Arbeitsdatenvertrag fuer den Browser-ZIP-Export.
 *
 * Dieses Abbild ist absichtlich KEIN Restore- oder Datenbank-Dump: Es macht die fuer die
 * taegliche Arbeit benoetigten Nutzer-/Rechtezuordnungen, den fachlichen Verlauf und einen
 * Dokumentenindex portabel nachvollziehbar, ohne Sitzungen, Passwort-Hashes, Tokens,
 * verschluesselte Zugangsdaten, Speicherpfade oder Datei-Bytes zu veroeffentlichen.
 */
function workExportData(db) {
  const json = (value, fallback) => {
    if (value && typeof value === 'object') return value;
    try { return JSON.parse(String(value || '')); } catch (_error) { return fallback; }
  };
  const rows = (table, order) => safeAll(db, table, order, { optionalMissing: true }) || [];

  const demoScope = demoExportScope(db);
  const allUserRows = rows('users', 'id');
  const demoUserIds = demoScope.userIds;
  const users = allUserRows.filter((row) => Number(row.is_demo || 0) !== 1
    && !isDemoUsername(row.username)).map((row) => ({
    id: row.id,
    username: row.username || '',
    displayName: row.display_name || row.username || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    salutation: row.salutation || '',
    jobTitle: row.job_title || '',
    initials: row.initials || '',
    maKennung: row.ma_kennung || '',
    joinedAt: row.joined_at || '',
    leftAt: row.left_at || '',
    active: row.active !== 0,
    isAdmin: row.is_admin === 1,
    istBetreuer: row.ist_betreuer === 1,
    allowLocal: row.allow_local === 1,
    allowOnline: row.allow_online === 1,
    allowModeSwitch: row.allow_mode_switch === 1,
    permissions: json(row.permissions_json, {}),
    createdAt: row.created_at || ''
  }));

  const cases = withoutDemoRows('cases', rows('cases', 'id'), demoScope);
  const caseById = new Map(cases.map((row) => [String(row.id), row]));
  const userById = new Map(users.map((row) => [String(row.id), row]));
  const caseAccess = withoutDemoRows('case_access', rows('case_access', 'case_id,user_id'), demoScope)
    .filter((row) => userById.has(String(row.user_id)))
    .map((row) => ({
    caseId: row.case_id,
    caseLabel: (caseById.get(String(row.case_id)) || {}).label || '',
    userId: row.user_id,
    username: (userById.get(String(row.user_id)) || {}).username || '',
    level: row.level || '',
    createdAt: row.created_at || '',
    createdBy: row.created_by == null || demoUserIds.has(String(row.created_by)) ? null : row.created_by
  }));
  const caseAssignments = cases.map((row) => ({
    caseId: row.id,
    caseLabel: row.label || '',
    fileNumber: row.file_number || '',
    archived: row.archived === 1,
    ownerUserId: row.owner_user_id == null || !userById.has(String(row.owner_user_id)) ? null : row.owner_user_id,
    ownerUsername: row.owner_user_id == null || !userById.has(String(row.owner_user_id))
      ? ''
      : ((userById.get(String(row.owner_user_id)) || {}).username || ''),
    access: caseAccess.filter((entry) => String(entry.caseId) === String(row.id))
  }));

  const processingHistory = withoutDemoRows('audit_log', rows('audit_log', 'id'), demoScope)
    .map((row) => ({
    id: row.id,
    createdAt: row.created_at || '',
    actorUserId: row.actor_user_id == null ? null : row.actor_user_id,
    actorUsername: row.actor_username || '',
    action: row.action || '',
    targetType: row.target_type || '',
    targetId: row.target_id || '',
    caseId: row.case_id || '',
    category: row.kategorie || '',
    purpose: row.zweck || '',
    recipient: row.empfaenger || '',
    channel: row.kanal || '',
    details: json(row.details_json, {})
  }));

  const folders = withoutDemoRows(
    'doc_folders',
    rows('doc_folders', 'area,case_id,parent_id,sort_order,name'),
    demoScope
  ).filter(
    (row) => String(row.area || '') !== 'management'
  );
  const folderById = new Map(folders.map((row) => [String(row.id), row]));
  const folderPath = (folderId) => {
    const names = [];
    const seen = new Set();
    let current = folderById.get(String(folderId || ''));
    while (current && !seen.has(String(current.id))) {
      seen.add(String(current.id));
      if (current.name) names.unshift(String(current.name));
      current = folderById.get(String(current.parent_id || ''));
    }
    return names.join('/');
  };
  const documentIndex = withoutDemoRows(
    'doc_files',
    rows('doc_files', 'area,case_id,folder_id,name,id'),
    demoScope
  )
    .filter((row) => String(row.area || '') !== 'management' && !Number(row.managed || 0))
    .map((row) => ({
      id: row.id,
      area: row.area || '',
      caseId: row.case_id || '',
      caseLabel: (caseById.get(String(row.case_id || '')) || {}).label || '',
      folderId: row.folder_id || '',
      folderPath: folderPath(row.folder_id),
      name: row.name || '',
      mimeType: row.mime_type || '',
      size: Number(row.size) || 0,
      pages: Number(row.pages) || 0,
      sha256: row.sha256 || '',
      ocrStatus: row.ocr_status || '',
      deletedAt: row.deleted_at || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || ''
    }));

  return {
    type: 'betreuungsbuero-arbeitsdaten-zusatz',
    version: 1,
    exportedAt: new Date().toISOString(),
    users,
    caseAssignments,
    processingHistory,
    documentIndex,
    exclusions: {
      documentBytes: true,
      databaseImage: true,
      sessions: true,
      serverCredentials: true,
      recoveryFiles: true,
      synchronizationJournal: true,
      demoModeData: true
    }
  };
}

class RestoreValidationError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'RestoreValidationError';
    this.code = detail && detail.code || 'RESTORE_VALIDATION_FAILED';
    this.detail = detail || {};
  }
}

function restoreDefinitions(group, options) {
  const opt = options || {};
  const dependencyPriority = {
    users: -200,
    cases: -190,
    mileage_rates: -180,
    private_vehicles: -170,
    finance_entries: -170,
    finance_statements: -160,
    bank_connections: -160,
    calendar_connections: -160,
    calendar_events: -150,
    todos: -150,
    doc_folders: -150,
    doc_files: -140,
    doc_integrity_runs: -140,
    doc_migration_runs: -140,
    case_reports: -130,
    case_doku_entries: -130,
    case_contacts: -130,
    case_documents: -130,
    betreuung_overview_entries: -130,
    inbox_documents: -130,
    finance_transactions: -130,
    mileage_trips: -130,
    bank_accounts_discovered: -130,
    bank_transactions: -120,
    finance_receipts: -120,
    calendar_event_attachments: -120,
    todo_attachments: -120,
    doc_links: -120,
    doc_versions: -120,
    doc_annotations: -120,
    doc_materializations: -110,
    doc_integrity_findings: -110,
    doc_migration_items: -110,
    audit_log: 100
  };
  return registryFor(group)
    .map((spec, index) => ({
      key: spec.key,
      table: spec.table,
      mode: spec.restorePolicy === 'explicit-token' && opt.tokenDisposition !== 'restore'
        ? 'skip'
        : (spec.restore === false || spec.table === 'intake_files'
        ? 'skip'
        : 'replace'),
      skipReason: spec.restorePolicy === 'explicit-token' && opt.tokenDisposition !== 'restore'
        ? 'token_discarded'
        : (spec.restore === false || spec.table === 'intake_files'
        ? 'metadata_without_document_bytes'
        : ''),
      restorePolicy: spec.restorePolicy || '',
      restoreGroup: group,
      replacePolicy: spec.replacePolicy || '',
      _order: index
    }))
    .sort((a, b) =>
      (dependencyPriority[a.table] || 0) - (dependencyPriority[b.table] || 0)
      || a._order - b._order
    )
    .map(({ _order, ...definition }) => definition);
}

function validatePortableRecoveryPayload(payload, group) {
  const scope = group === 'security' ? 'security' : (group === 'credentials' ? 'credentials' : '');
  if (!scope || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Die portable Recovery-Nutzlast oder ihr Artefaktbereich ist ungültig.');
  }
  const expectedType = scope === 'security'
    ? 'betreuungsbuero-sicherheit'
    : 'betreuungsbuero-zugangsdaten';
  if (payload.type !== expectedType || Number(payload.version) !== 3) {
    throw new Error('Typ oder Version der portablen Recovery-Nutzlast ist ungültig.');
  }
  const expectedSchema = recoverySchemaContract(scope);
  const schema = payload.recoverySchema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)
      || Number(schema.version) !== expectedSchema.version
      || schema.scope !== scope
      || !schema.tables || typeof schema.tables !== 'object' || Array.isArray(schema.tables)) {
    throw new Error('Der authentifizierte Spaltenvertrag des Recovery-Abbilds fehlt oder ist ungültig.');
  }
  const expectedTables = Object.keys(expectedSchema.tables).sort();
  const actualTables = Object.keys(schema.tables).sort();
  if (stableJson(actualTables) !== stableJson(expectedTables)) {
    throw new Error('Der authentifizierte Spaltenvertrag enthält nicht genau die verpflichtenden Recovery-Tabellen.');
  }
  for (const table of expectedTables) {
    if (!Array.isArray(schema.tables[table])
        || stableJson(schema.tables[table]) !== stableJson(expectedSchema.tables[table])) {
      throw new Error(`Der authentifizierte Spaltenvertrag für ${table} ist unvollständig oder unbekannt.`);
    }
  }
  if (scope === 'security'
      && (!Array.isArray(schema.caseOwners)
        || stableJson(schema.caseOwners) !== stableJson(expectedSchema.caseOwners))) {
    throw new Error('Der authentifizierte Spaltenvertrag der Fallzuständigkeiten ist unvollständig.');
  }
  const omitted = Array.isArray(payload.omittedTables) ? payload.omittedTables.map(String) : null;
  if (!omitted) {
    throw new Error('Die authentifizierte Liste ausgelassener Recovery-Tabellen fehlt.');
  }
  const optional = new Set(
    registryFor(scope).filter((spec) => spec.recoveryOptional === true).map((spec) => spec.table)
  );
  const invalidOmissions = omitted.filter((table) => !optional.has(table));
  if (invalidOmissions.length) {
    throw new Error(
      `Das Recovery-Abbild lässt verpflichtende Tabellen oder Spalten aus: ${invalidOmissions.join(', ')}.`
    );
  }
  const definitions = restoreDefinitions(
    scope,
    scope === 'security' ? { tokenDisposition: 'restore' } : undefined
  );
  for (const definition of definitions) {
    if (!Object.prototype.hasOwnProperty.call(payload, definition.key)) {
      throw new Error(`Die authentifizierte Nutzlast enthält die Pflichttabelle ${definition.table} nicht.`);
    }
    const rows = payload[definition.key];
    if (!Array.isArray(rows)) {
      throw new Error(`Die authentifizierte Pflichttabelle ${definition.table} ist keine Liste.`);
    }
    for (let index = 0; index < rows.length; index++) {
      if (!rows[index] || typeof rows[index] !== 'object' || Array.isArray(rows[index])) {
        throw new Error(`Die authentifizierte Pflichttabelle ${definition.table} enthält in Zeile ${index + 1} keinen Datensatz.`);
      }
      const expectedColumns = expectedSchema.tables[definition.table];
      const missingColumns = expectedColumns.filter((column) =>
        !Object.prototype.hasOwnProperty.call(rows[index], column)
      );
      const markerAllowed = Object.prototype.hasOwnProperty.call(PORTABLE_SECRET_COLUMNS, definition.key)
        || definition.key === 'docMounts';
      const allowedColumns = new Set([
        ...expectedColumns,
        ...(markerAllowed ? [PORTABLE_MARKER] : [])
      ]);
      const unknownColumns = Object.keys(rows[index]).filter((column) => !allowedColumns.has(column));
      if (missingColumns.length || unknownColumns.length) {
        throw new Error(
          `Die authentifizierte Pflichttabelle ${definition.table} enthält in Zeile ${index + 1} `
          + 'nicht genau den vollständigen Spaltenvertrag.'
        );
      }
    }
  }
  if (scope === 'security') {
    if (!Object.prototype.hasOwnProperty.call(payload, 'caseOwners') || !Array.isArray(payload.caseOwners)) {
      throw new Error('Die authentifizierte Nutzlast enthält keine gültige Liste der Fallzuständigkeiten.');
    }
    if (payload.caseOwners.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error('Die authentifizierte Liste der Fallzuständigkeiten enthält keinen gültigen Datensatz.');
    }
    for (let index = 0; index < payload.caseOwners.length; index++) {
      const keys = Object.keys(payload.caseOwners[index]).sort();
      if (stableJson(keys) !== stableJson(['case_id', 'owner_user_id'])) {
        throw new Error(
          `Die authentifizierte Fallzuständigkeit in Zeile ${index + 1} ist unvollständig oder unbekannt.`
        );
      }
    }
  }
  // Validiert Marker und zulässige Geheimnisfelder ohne einen dauerhaft nutzbaren
  // internen Ciphertext zu erzeugen.
  rehydratePortableSecrets(payload, {
    encrypt(value) { return `validated:${String(value).length}`; }
  });
  return { scope, definitions };
}

function restoreTableInfo(db, table) {
  let info;
  try { info = db.prepare(`PRAGMA table_info(${identifier(table)})`).all(); }
  catch (error) {
    throw new RestoreValidationError(`Zieltabelle ${table} kann nicht geprüft werden.`, {
      code: 'RESTORE_TARGET_SCHEMA_UNAVAILABLE', table
    });
  }
  if (!Array.isArray(info) || !info.length) {
    throw new RestoreValidationError(`Zieltabelle ${table} ist nicht vorhanden.`, {
      code: 'RESTORE_TARGET_TABLE_MISSING', table
    });
  }
  return info;
}

function emptyTableReport(expected) {
  return {
    expected: Number(expected) || 0,
    accepted: 0,
    restored: 0,
    wouldRestore: 0,
    skipped: 0,
    rejected: 0,
    deleted: 0,
    wouldDelete: 0,
    neutralized: 0,
    wouldNeutralize: 0,
    skipReasons: {}
  };
}

function addSkip(report, reason) {
  report.skipped++;
  report.skipReasons[reason] = (report.skipReasons[reason] || 0) + 1;
}

function rejectRestore(table, rowIndex, code, message, field) {
  throw new RestoreValidationError(message, {
    code, table, rowIndex, ...(field ? { field } : {})
  });
}

function normalizedRestoreRows(table, rows) {
  if (rows == null) return [];
  if (!Array.isArray(rows)) {
    rejectRestore(table, null, 'RESTORE_ROWS_NOT_ARRAY', `Die Sicherungsdaten für ${table} sind keine Liste.`);
  }
  return rows;
}

function restoreRows(db, table, rows, mode, options) {
  const opts = options || {};
  const list = normalizedRestoreRows(table, rows);
  const report = emptyTableReport(list.length);
  if (!list.length) return report;

  if (mode === 'skip') {
    const validColumns = new Set(restoreTableInfo(db, table).map((column) => column.name));
    for (let index = 0; index < list.length; index++) {
      const row = list[index];
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        rejectRestore(table, index, 'RESTORE_ROW_NOT_OBJECT', `Zeile ${index + 1} für ${table} ist kein Datensatz.`);
      }
      const unknown = Object.keys(row).find((column) => !validColumns.has(column));
      if (unknown) {
        rejectRestore(
          table, index, 'RESTORE_UNKNOWN_COLUMN',
          `Zeile ${index + 1} für ${table} enthält eine unbekannte Spalte.`, unknown
        );
      }
      addSkip(report, opts.skipReason || 'explicitly_not_restorable');
    }
    return report;
  }

  const tableInfo = restoreTableInfo(db, table);
  const validColumns = new Set(tableInfo.map((column) => column.name));
  const requiredColumns = tableInfo.filter((column) =>
    Number(column.pk) > 0 || (Number(column.notnull) === 1 && column.dflt_value == null)
  );
  const primaryKeyColumns = tableInfo
    .filter((column) => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((column) => column.name);
  if (mode !== 'ignore' && !primaryKeyColumns.length) {
    throw new RestoreValidationError(`Zieltabelle ${table} besitzt keinen sicheren Primärschlüssel für den Restore.`, {
      code: 'RESTORE_TARGET_PRIMARY_KEY_MISSING', table
    });
  }
  const statements = new Map();

  for (let index = 0; index < list.length; index++) {
    const row = list[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      rejectRestore(table, index, 'RESTORE_ROW_NOT_OBJECT', `Zeile ${index + 1} für ${table} ist kein Datensatz.`);
    }
    const columns = Object.keys(row).sort();
    if (!columns.length) {
      rejectRestore(table, index, 'RESTORE_ROW_EMPTY', `Zeile ${index + 1} für ${table} enthält keine Spalten.`);
    }
    for (const column of columns) {
      if (!validColumns.has(column)) {
        rejectRestore(
          table, index, 'RESTORE_UNKNOWN_COLUMN',
          `Zeile ${index + 1} für ${table} enthält eine unbekannte Spalte.`, column
        );
      }
    }
    for (const column of requiredColumns) {
      if (!Object.hasOwn(row, column.name) || row[column.name] == null) {
        rejectRestore(
          table, index, 'RESTORE_REQUIRED_COLUMN_MISSING',
          `Zeile ${index + 1} für ${table} enthält eine erforderliche Spalte nicht.`, column.name
        );
      }
    }

    // Bewusst zulässige Ausnahme: Die Sitzung, über die der Admin gerade restauriert,
    // darf nicht durch ihren alten Stand ersetzt werden. Sie erscheint im Bericht.
    if (table === 'sessions' && opts.currentSid && String(row.sid || '') === String(opts.currentSid)) {
      addSkip(report, 'current_session');
      continue;
    }
    const signature = columns.join('\u0000');
    let statement = statements.get(signature);
    if (!statement) {
      const insert = `${mode === 'ignore' ? 'INSERT OR IGNORE' : 'INSERT'} INTO ${identifier(table)} `
        + `(${columns.map(identifier).join(',')})`
        + ` VALUES (${columns.map((column) => `@${column}`).join(',')})`;
      const mutableColumns = columns.filter((column) => !primaryKeyColumns.includes(column));
      const conflict = mode === 'ignore'
        ? ''
        : ` ON CONFLICT (${primaryKeyColumns.map(identifier).join(',')}) `
          + (mutableColumns.length
            ? `DO UPDATE SET ${mutableColumns.map((column) =>
              `${identifier(column)}=excluded.${identifier(column)}`
            ).join(',')}`
            : 'DO NOTHING');
      const sql = insert + conflict;
      try { statement = db.prepare(sql); }
      catch (_error) {
        rejectRestore(
          table, index, 'RESTORE_STATEMENT_INVALID',
          `Die Spaltenkombination in Zeile ${index + 1} für ${table} ist nicht wiederherstellbar.`
        );
      }
      statements.set(signature, statement);
    }
    /* Personenregister (Sicherungs-Audit 30.08.2026): eine einzige persons-Zeile mit
       FK-/UNIQUE-Konflikt kippte frueher den GESAMTEN Restore (Voll-Rollback mit generischer
       Meldung) - Sicherungen von vor einer Nutzerloeschung oder Kennung-Umvergabe waren
       damit unbrauchbar. Statt zu scheitern wird die Zeile entschaerft und der Konflikt
       im Bericht gezaehlt: fehlt das Nutzerkonto (oder haengt es an einer anderen Person),
       kommt die Person OHNE Kontoverknuepfung zurueck; traegt eine andere Live-Person die
       Kennung, kommt sie OHNE Kennung zurueck. Die Person selbst geht nie verloren. */
    if (table === 'persons') {
      if (row.user_id != null && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(row.user_id)) {
        row.user_id = null;
        addSkip(report, 'person_konto_fehlt_verknuepfung_geloest');
      }
      if (row.user_id != null
          && db.prepare('SELECT 1 FROM persons WHERE user_id = ? AND id <> ?').get(row.user_id, String(row.id || ''))) {
        row.user_id = null;
        addSkip(report, 'person_konto_anderweitig_verknuepft');
      }
      if (String(row.kennung || '').trim()
          && db.prepare('SELECT 1 FROM persons WHERE kennung = ? COLLATE NOCASE AND id <> ?')
            .get(String(row.kennung).trim(), String(row.id || ''))) {
        row.kennung = '';
        addSkip(report, 'person_kennung_anderweitig_vergeben');
      }
    }
    const params = {};
    for (const column of columns) params[column] = row[column] === undefined ? null : row[column];
    try {
      const info = statement.run(params);
      report.accepted++;
      if (Number(info.changes) === 0) addSkip(report, 'existing_row');
      else if (opts.dryRun) report.wouldRestore += Number(info.changes) || 0;
      else report.restored += Number(info.changes) || 0;
    } catch (_error) {
      rejectRestore(
        table, index, 'RESTORE_ROW_CONSTRAINT_FAILED',
        `Zeile ${index + 1} für ${table} verletzt das Zielschema und wurde nicht übernommen.`
      );
    }
  }
  return report;
}

const NEUTRALIZE_COLUMNS = Object.freeze({
  users: Object.freeze({
    active: 0,
    is_admin: 0,
    allow_local: 0,
    allow_online: 0,
    allow_case_management: 0,
    allow_mode_switch: 0,
    can_view_cases: 0,
    can_edit_cases: 0,
    can_view_documents: 0,
    can_edit_documents: 0,
    can_view_finance: 0,
    can_edit_finance: 0,
    can_manage_mail_settings: 0,
    can_manage_office_profile: 0,
    can_manage_map_settings: 0,
    permissions_json: '{}'
  }),
  calendar_connections: Object.freeze({
    enabled: 0,
    password_encrypted: '',
    client_secret_encrypted: '',
    access_token_encrypted: '',
    refresh_token_encrypted: '',
    token_expires_at: ''
  }),
  mail_accounts: Object.freeze({
    kind: 'disabled',
    imap_host: '',
    imap_user: '',
    imap_pass_encrypted: '',
    smtp_host: '',
    smtp_user: '',
    smtp_pass_encrypted: '',
    graph_connection_id: ''
  }),
  bank_connections: Object.freeze({
    username: '',
    pin_encrypted: '',
    tan_mechanism: '',
    tan_medium: '',
    status: 'disabled',
    status_detail: 'Durch Sicherheitswiederherstellung deaktiviert',
    sca_valid_until: '',
    last_sync_at: ''
  })
});

function prepareReplacement(db, definition, dryRun) {
  const table = definition.table;
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${identifier(table)}`).get();
  const count = Number(row && row.n) || 0;
  if (definition.replacePolicy === 'neutralize') {
    const validColumns = new Set(restoreTableInfo(db, table).map((column) => column.name));
    const configured = NEUTRALIZE_COLUMNS[table] || {};
    const entries = Object.entries(configured).filter(([column]) => validColumns.has(column));
    if (!entries.length) {
      throw new RestoreValidationError(`Für die referenzerhaltende Ersetzung von ${table} fehlt eine sichere Neutralisierungsregel.`, {
        code: 'RESTORE_NEUTRALIZE_POLICY_MISSING', table
      });
    }
    if (count) {
      const params = {};
      const assignments = entries.map(([column, value], index) => {
        const parameter = `v${index}`;
        params[parameter] = value;
        return `${identifier(column)}=@${parameter}`;
      });
      db.prepare(`UPDATE ${identifier(table)} SET ${assignments.join(',')}`).run(params);
    }
    return {
      deleted: 0,
      wouldDelete: 0,
      neutralized: dryRun ? 0 : count,
      wouldNeutralize: dryRun ? count : 0
    };
  }
  if (count) db.prepare(`DELETE FROM ${identifier(table)}`).run();
  return {
    deleted: dryRun ? 0 : count,
    wouldDelete: dryRun ? count : 0,
    neutralized: 0,
    wouldNeutralize: 0
  };
}

function caseOwnerReport(db, rows, options) {
  const opts = options || {};
  const list = normalizedRestoreRows('case_owners', rows);
  const report = emptyTableReport(list.length);
  if (!list.length) return report;
  let caseExists;
  let userExists;
  let update;
  try {
    caseExists = db.prepare('SELECT 1 FROM cases WHERE id = ?');
    userExists = db.prepare('SELECT 1 FROM users WHERE id = ?');
    update = db.prepare('UPDATE cases SET owner_user_id = ? WHERE id = ?');
  } catch (_error) {
    throw new RestoreValidationError('Fallzuständigkeiten können im Zielschema nicht geprüft werden.', {
      code: 'RESTORE_CASE_OWNER_SCHEMA_UNAVAILABLE', table: 'case_owners'
    });
  }
  for (let index = 0; index < list.length; index++) {
    const row = list[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      rejectRestore('case_owners', index, 'RESTORE_ROW_NOT_OBJECT', `Zeile ${index + 1} der Fallzuständigkeiten ist kein Datensatz.`);
    }
    const keys = Object.keys(row);
    const unknown = keys.find((key) => key !== 'case_id' && key !== 'owner_user_id');
    if (unknown) {
      rejectRestore(
        'case_owners', index, 'RESTORE_UNKNOWN_COLUMN',
        `Zeile ${index + 1} der Fallzuständigkeiten enthält eine unbekannte Spalte.`, unknown
      );
    }
    const caseId = String(row.case_id || '');
    if (!caseId) {
      rejectRestore(
        'case_owners', index, 'RESTORE_CASE_ID_MISSING',
        `Zeile ${index + 1} der Fallzuständigkeiten enthält keine Fallkennung.`, 'case_id'
      );
    }
    const ownerId = row.owner_user_id == null ? null : Number(row.owner_user_id);
    if (ownerId != null && (!Number.isInteger(ownerId) || ownerId < 1)) {
      rejectRestore(
        'case_owners', index, 'RESTORE_OWNER_ID_INVALID',
        `Zeile ${index + 1} der Fallzuständigkeiten enthält keine gültige Nutzerkennung.`, 'owner_user_id'
      );
    }
    if (!caseExists.get(caseId)) {
      if (opts.strictSkips) {
        rejectRestore(
          'case_owners', index, 'RESTORE_CASE_NOT_FOUND',
          `Der Fall aus Zeile ${index + 1} der Fallzuständigkeiten existiert im Ziel nicht.`, 'case_id'
        );
      }
      addSkip(report, 'case_not_found');
      continue;
    }
    if (ownerId != null && !userExists.get(ownerId)) {
      if (opts.strictSkips) {
        rejectRestore(
          'case_owners', index, 'RESTORE_OWNER_NOT_FOUND',
          `Der Nutzer aus Zeile ${index + 1} der Fallzuständigkeiten existiert im Ziel nicht.`, 'owner_user_id'
        );
      }
      addSkip(report, 'owner_not_found');
      continue;
    }
    const changes = Number(update.run(ownerId, caseId).changes) || 0;
    if (opts.dryRun) report.wouldRestore += changes;
    else report.restored += changes;
    report.accepted++;
  }
  return report;
}

function summarizeRestore(tables) {
  const totals = {
    expected: 0,
    accepted: 0,
    restored: 0,
    wouldRestore: 0,
    skipped: 0,
    rejected: 0,
    deleted: 0,
    wouldDelete: 0,
    neutralized: 0,
    wouldNeutralize: 0
  };
  for (const report of Object.values(tables)) {
    for (const key of Object.keys(totals)) totals[key] += Number(report[key]) || 0;
  }
  return totals;
}

function rollbackReport(report, error) {
  for (const table of Object.values(report.tables)) {
    table.accepted = 0;
    table.restored = 0;
    table.wouldRestore = 0;
    table.deleted = 0;
    table.wouldDelete = 0;
    table.neutralized = 0;
    table.wouldNeutralize = 0;
  }
  const detail = error && error.detail || {};
  if (detail.table) {
    if (!report.tables[detail.table]) report.tables[detail.table] = emptyTableReport(0);
    if (!report.tables[detail.table].rejected) report.tables[detail.table].rejected++;
  }
  report.rolledBack = true;
  report.totals = summarizeRestore(report.tables);
  return report;
}

let restorePreviewSequence = 0;

function assertForeignKeyIntegrity(db) {
  let violations;
  try { violations = db.prepare('PRAGMA foreign_key_check').all(); }
  catch (error) {
    throw new RestoreValidationError('Die Fremdschlüsselprüfung des Restore-Ziels ist fehlgeschlagen.', {
      code: 'RESTORE_FOREIGN_KEY_CHECK_FAILED'
    });
  }
  if (Array.isArray(violations) && violations.length) {
    const first = violations[0] || {};
    throw new RestoreValidationError(
      'Die Wiederherstellung würde ungültige Datenbankbeziehungen hinterlassen.',
      {
        code: 'RESTORE_FOREIGN_KEY_VIOLATION',
        table: String(first.table || ''),
        parent: String(first.parent || ''),
        rowId: first.rowid == null ? null : first.rowid,
        violations: violations.length
      }
    );
  }
}

function executeRollbackPreview(db, execute) {
  const savepoint = `restore_preview_${++restorePreviewSequence}`;
  db.exec(`SAVEPOINT ${identifier(savepoint)}`);
  try {
    execute();
    db.exec(`ROLLBACK TO ${identifier(savepoint)}`);
    db.exec(`RELEASE ${identifier(savepoint)}`);
  } catch (error) {
    try { db.exec(`ROLLBACK TO ${identifier(savepoint)}`); } catch (_rollbackError) { /* best effort */ }
    try { db.exec(`RELEASE ${identifier(savepoint)}`); } catch (_releaseError) { /* best effort */ }
    throw error;
  }
}

function restorePayload(db, payload, definitions, options) {
  const opts = options || {};
  const report = { rolledBack: false, tables: {}, totals: {} };
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  const fail = (error) => {
    error.restoreReport = rollbackReport(report, error);
    throw error;
  };
  if (!source) {
    fail(new RestoreValidationError('Die Sicherungsnutzlast ist kein Objekt.', {
      code: 'RESTORE_PAYLOAD_NOT_OBJECT'
    }));
  }
  if (opts.expectedType && source.type !== opts.expectedType) {
    fail(new RestoreValidationError('Der Typ der Sicherungsnutzlast ist ungültig.', {
      code: 'RESTORE_PAYLOAD_TYPE_MISMATCH'
    }));
  }
  const expectedVersions = Array.isArray(opts.expectedVersions)
    ? opts.expectedVersions.map(Number)
    : (opts.expectedVersion === undefined ? [] : [Number(opts.expectedVersion)]);
  if (expectedVersions.length && !expectedVersions.includes(Number(source.version))) {
    fail(new RestoreValidationError('Die Version der Sicherungsnutzlast wird nicht unterstützt.', {
      code: 'RESTORE_PAYLOAD_VERSION_UNSUPPORTED'
    }));
  }
  for (const definition of definitions || []) {
    const rows = source[definition.key];
    report.tables[definition.table] = emptyTableReport(Array.isArray(rows) ? rows.length : 0);
    if (!Object.hasOwn(source, definition.key)) {
      /* Vor-Register-Sicherung erkennen (Etappe 4, 30.08.2026): ihr fehlt `persons`, dafuer
         traegt sie noch `officeEmployees`. Die generische Meldung "Tabelle persons fehlt"
         waere technisch richtig, aber unverstaendlich - hier steht stattdessen, WAS die
         Sicherung ist und warum sie nicht mehr geht (Nutzerentscheidung: keine
         Altlasten-Kompatibilitaet, aber ehrliche Ablehnung statt stillem Bruch). */
      if (definition.key === 'persons' && Object.hasOwn(source, 'officeEmployees')) {
        fail(new RestoreValidationError('Diese Sicherung stammt aus einer Programmversion vor dem Personenregister (August 2026) und kann nicht mehr eingelesen werden. Bitte eine aktuelle Sicherung aus der laufenden Version verwenden.', {
          code: 'RESTORE_PRE_PERSONS_BACKUP', table: definition.table, key: definition.key
        }));
      }
      fail(new RestoreValidationError(`Die Sicherungsnutzlast enthält die Tabelle ${definition.table} nicht.`, {
        code: 'RESTORE_PAYLOAD_KEY_MISSING', table: definition.table, key: definition.key
      }));
    }
    if (!Array.isArray(rows)) {
      fail(new RestoreValidationError(`Die Sicherungsdaten für ${definition.table} sind keine Liste.`, {
        code: 'RESTORE_ROWS_NOT_ARRAY', table: definition.table, key: definition.key
      }));
    }
  }
  if (opts.includeCaseOwners) {
    report.tables.case_owners = emptyTableReport(Array.isArray(source.caseOwners) ? source.caseOwners.length : 0);
    if (!Object.hasOwn(source, 'caseOwners')) {
      fail(new RestoreValidationError('Die Sicherungsnutzlast enthält die Fallzuständigkeiten nicht.', {
        code: 'RESTORE_PAYLOAD_KEY_MISSING', table: 'case_owners', key: 'caseOwners'
      }));
    }
    if (!Array.isArray(source.caseOwners)) {
      fail(new RestoreValidationError('Die Fallzuständigkeiten sind keine Liste.', {
        code: 'RESTORE_ROWS_NOT_ARRAY', table: 'case_owners', key: 'caseOwners'
      }));
    }
  }
  const execute = () => {
    const replacements = (definitions || []).filter((definition) =>
      ['security', 'credentials'].includes(definition.restoreGroup)
      && (definition.mode === 'replace' || definition.restorePolicy === 'explicit-token')
    );
    const replacementStats = new Map();
    // Erst child-first leeren/neutralisieren, anschließend unten parent-first
    // aus dem authentifizierten Abbild aufbauen. Alles liegt in derselben
    // restorePayload-Transaktion; foreign_keys bleibt durchgehend aktiv.
    for (const definition of replacements.slice().reverse()) {
      replacementStats.set(
        definition.table,
        prepareReplacement(db, definition, !!opts.dryRun)
      );
    }
    for (const definition of definitions || []) {
      const sourceRows = source[definition.key];
      const tableReport = restoreRows(db, definition.table, sourceRows, definition.mode || 'replace', {
        currentSid: opts.currentSid,
        dryRun: opts.dryRun,
        skipReason: definition.skipReason
      });
      Object.assign(tableReport, replacementStats.get(definition.table) || {});
      report.tables[definition.table] = tableReport;
    }
    if (opts.includeCaseOwners) {
      report.tables.case_owners = caseOwnerReport(db, source.caseOwners, {
        dryRun: opts.dryRun,
        strictSkips: !!opts.strictSkips
      });
    }
    report.totals = summarizeRestore(report.tables);
    if (opts.strictSkips) {
      const allowed = new Set(Array.isArray(opts.allowedSkipReasons) ? opts.allowedSkipReasons : []);
      for (const [table, tableReport] of Object.entries(report.tables)) {
        const unexpected = Object.entries(tableReport.skipReasons || {})
          .filter(([reason, count]) => Number(count) > 0 && !allowed.has(reason));
        if (unexpected.length) {
          throw new RestoreValidationError(
            `Die Wiederherstellung von ${table} würde unerwartet Datensätze auslassen.`,
            {
              code: 'RESTORE_UNEXPECTED_SKIP',
              table,
              skipReasons: Object.fromEntries(unexpected)
            }
          );
        }
      }
    }
    if (typeof opts.afterExecute === 'function') {
      opts.afterExecute({ db, report, source, dryRun: !!opts.dryRun });
    }
    assertForeignKeyIntegrity(db);
  };
  try {
    if (opts.dryRun) executeRollbackPreview(db, execute);
    else db.transaction(execute)();
    return report;
  } catch (error) {
    fail(error);
  }
}

function legacyRestoredCounts(report) {
  return Object.fromEntries(
    Object.entries(report && report.tables || {}).map(([table, value]) => [table, Number(value.restored) || 0])
  );
}

module.exports = {
  BACKUP_EXCLUDED_TABLES,
  CREDENTIAL_TABLES,
  SECURITY_TABLES,
  TABLE_REGISTRY,
  calendarTodoData,
  caseData,
  createPortableRecoveryBundle,
  credentialsData,
  legacyRestoredCounts,
  moduleData,
  officeData,
  portableCredentialsData,
  portableMountSecretFields: () => MOUNT_SECRET_FIELDS.slice(),
  portableRecoverySourceRevision,
  portableSecretLocations,
  portableSecurityData,
  recoverySchemaContract,
  registryFor,
  rehydratePortableSecrets,
  redactMountRows,
  validatePortableRecoveryPayload,
  restoreDefinitions,
  restorePayload,
  restoreRows,
  safeAll,
  securityData,
  workExportData,
  tokenRestoreTables: () => registryFor('security')
    .filter((entry) => entry.restorePolicy === 'explicit-token')
    .map((entry) => entry.table),
  _test: {
    MOUNT_SECRET_FIELDS,
    PORTABLE_MARKER,
    PORTABLE_SECRET_COLUMNS,
    RestoreValidationError,
    caseOwnerReport,
    stableJson,
    summarizeRestore,
    withoutVolatileRecoveryFields
  }
};
